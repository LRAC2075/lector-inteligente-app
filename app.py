import os
import io
import base64
import re
import sys
import logging
from logging.handlers import RotatingFileHandler
from flask import Flask, request, jsonify, render_template
import webview
from PIL import Image
from pdf2image import convert_from_bytes
from google.cloud import vision
from google.cloud import translate_v2 as translate
import database_engine
import html

# --- CACHÉ DE TRADUCCIÓN EN MEMORIA ---
# Guardará temporalmente las frases traducidas para evitar llamadas repetidas a la API.
translation_cache = {}

# --- IMPORTS PARA TOKENIZACIÓN CJK ---
try:
    import jieba
    from janome.tokenizer import Tokenizer as JanomeTokenizer
    from konlpy.tag import Okt
    CJK_LIBRARIES_LOADED = True
    # Inicializar tokenizers una vez para mejorar el rendimiento
    janome_tokenizer = JanomeTokenizer()
    okt_tokenizer = Okt()
except ImportError as e:
    CJK_LIBRARIES_LOADED = False
    print(f"ADVERTENCIA: No se pudieron cargar las librerías CJK. Funcionalidad limitada. Error: {e}")

def resource_path(relative_path):
    """ Obtiene la ruta absoluta al recurso, funciona para desarrollo y para PyInstaller """
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

# --- CONFIGURACIÓN DE RUTAS Y FLASK ---
credentials_path = resource_path("google-credentials.json")
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = credentials_path

app = Flask(__name__, static_folder='static', template_folder='templates')

# --- CONFIGURACIÓN DE LOGGER ---
log_file = resource_path('app.log') 
try:
    handler = RotatingFileHandler(log_file, maxBytes=100000, backupCount=3)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s [in %(pathname)s:%(lineno)d]')
    handler.setFormatter(formatter)
    app.logger.addHandler(handler)
    app.logger.setLevel(logging.ERROR)
except Exception as e:
    print(f"Error al configurar el logger: {e}")

# Inicializar la base de datos con la nueva estructura
database_engine.init_db()

# --- ENDPOINTS ---

@app.route('/')
def home(): 
    return render_template("index.html")

@app.route('/get_supported_languages', methods=['GET'])
def get_supported_languages():
    try:
        translate_client = translate.Client()
        return jsonify(translate_client.get_languages())
    except Exception as e:
        app.logger.error(f"Error en /get_supported_languages: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.route('/update_word_status', methods=['POST'])
def update_word_status():
    try:
        data = request.json
        success = database_engine.update_learning_status(
            data.get('word'), 
            data.get('source_lang').split('-')[0], 
            data.get('target_lang'), 
            data.get('status')
        )
        return jsonify({'success': success})
    except Exception as e:
        app.logger.error(f"Error en /update_word_status: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/get_vocabulary_status', methods=['POST'])
def get_vocabulary_status():
    try:
        data = request.json
        words = data.get('words', [])
        source_lang = data.get('source_lang').split('-')[0]
        target_lang = data.get('target_lang', 'es')
        normalized_words = [word.lower().replace('[.,:;!?]$', '') for word in words]
        statuses = database_engine.get_statuses_for_words(normalized_words, source_lang, target_lang)
        return jsonify(statuses)
    except Exception as e:
        app.logger.error(f"Error en /get_vocabulary_status: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/get_vocabulary', methods=['GET'])
def get_vocabulary():
    try:
        status_filter = request.args.get('status', None)
        lang_filter = request.args.get('lang', None) # <-- Recibimos el nuevo filtro
        vocab_list = database_engine.get_all_vocabulary(status_filter, lang_filter)
        return jsonify(vocab_list)
    except Exception as e:
        app.logger.error(f"Error en /get_vocabulary: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/edit_word', methods=['POST'])
def edit_word():
    try:
        data = request.json
        success = database_engine.edit_word_translation(
            data.get('word'), 
            data.get('source_lang'), 
            data.get('target_lang'), 
            data.get('translation')
        )
        return jsonify({'success': success})
    except Exception as e:
        app.logger.error(f"Error en /edit_word: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/delete_word', methods=['POST'])
def delete_word():
    try:
        data = request.json
        success = database_engine.delete_word(
            data.get('word'), 
            data.get('source_lang'), 
            data.get('target_lang')
        )
        return jsonify({'success': success})
    except Exception as e:
        app.logger.error(f"Error en /delete_word: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/process', methods=['POST'])
def process_file():
    try:
        file = request.files.get('file')
        source_lang = request.form.get('source_lang', 'en-US')
        if not file: return jsonify({'error': 'No se recibió ningún archivo.'}), 400
        
        vision_client = vision.ImageAnnotatorClient()
        response_pages = []
        file_bytes = file.read()
        
        lang_code = source_lang.split('-')[0]
        image_context = vision.ImageContext(language_hints=[lang_code])
        
        images_from_file = convert_from_bytes(file_bytes, dpi=200) if file.filename.lower().endswith('.pdf') else [Image.open(io.BytesIO(file_bytes))]

        for img in images_from_file:
            with io.BytesIO() as output:
                img.save(output, format="PNG")
                content = output.getvalue()
            
            image = vision.Image(content=content)
            response = vision_client.document_text_detection(image=image, image_context=image_context)
            if response.error.message: raise Exception(f"Error de Google Vision: {response.error.message}")
            
            full_text = response.full_text_annotation.text
            text_data = {}

            if CJK_LIBRARIES_LOADED and lang_code in ['zh', 'ja', 'ko']:
                tokens = []
                if lang_code == 'zh':
                    tokens = list(jieba.cut(full_text))
                elif lang_code == 'ja':
                    tokens = [token.surface for token in janome_tokenizer.tokenize(full_text)]
                elif lang_code == 'ko':
                    tokens = okt_tokenizer.morphs(full_text)
                
                tokens = [token for token in tokens if token.strip()]
                text_data = {"type": "tokenized", "tokens": tokens}
            else:
                text_data = {"type": "plain", "text": full_text}
            
            response_pages.append({
                'full_text': full_text,
                'text_data': text_data,
                'image_b64': base64.b64encode(content).decode('utf-8')
            })
            
        return jsonify({'pages': response_pages})
    except Exception as e:
        app.logger.error(f"Error en /process: {e}", exc_info=True)
        return jsonify({'error': f'Error del servidor: {e.__class__.__name__}'}), 500

@app.route('/translate', methods=['POST'])
def translate_text():
    try:
        data = request.json
        raw_word = data.get('word', '')
        sentence = data.get('sentence', '')
        source_lang = data.get('source_lang', 'en').split('-')[0]
        target_lang = data.get('target_lang', 'es')

        # Si el idioma de origen y destino son el mismo, no hacemos nada más.
        if source_lang == target_lang:
            word_to_save = re.sub(r'[^\w\s-]', '', raw_word).lower()
            database_engine.save_translation(word_to_save, source_lang, target_lang, word_to_save)
            database_engine.update_learning_status(word_to_save, source_lang, target_lang, 'conocida')
            return jsonify({
                'translation': word_to_save,
                'status': 'conocida',
                'source': 'same_language'
            })

        word = re.sub(r'[^\w\s-]', '', raw_word).lower()
        if not word: return jsonify({'error': 'Palabra inválida'}), 400

        translate_client = translate.Client()
        response_data = {}

        # Traducción de la palabra individual (esta lógica no cambia)
        cached_data = database_engine.get_translation(word, source_lang, target_lang)
        if cached_data:
            response_data = {**cached_data, 'source': 'cache'}
        else:
            result = translate_client.translate(word, target_language=target_lang, source_language=source_lang)
            api_translation = html.unescape(result['translatedText'])
            database_engine.save_translation(word, source_lang, target_lang, api_translation)
            response_data = {'translation': api_translation, 'status': 'nueva', 'source': 'api'}

        # --- INICIO DE LA LÓGICA DE CACHÉ PARA LA FRASE ---
        if sentence:
            # Creamos una clave única para la caché con la frase y los idiomas.
            cache_key = (sentence, source_lang, target_lang)
            
            # 1. Comprobamos si la traducción ya está en nuestra caché.
            if cache_key in translation_cache:
                translated_sentence = translation_cache[cache_key]
            else:
                # 2. Si no está, la traducimos y la guardamos en la caché.
                sentence_result = translate_client.translate(sentence, target_language=target_lang, source_language=source_lang)
                translated_sentence = html.unescape(sentence_result['translatedText'])
                translation_cache[cache_key] = translated_sentence

            response_data['source_sentence'] = sentence
            response_data['translated_sentence'] = translated_sentence
        # --- FIN DE LA LÓGICA DE CACHÉ ---

        return jsonify(response_data)

    except Exception as e:
        app.logger.error(f"Error en /translate: {e}", exc_info=True)
        # ... (manejo de errores)
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    webview.create_window('Lector Inteligente', app, width=1280, height=800, resizable=True)
    webview.start(debug=False)