import os
import io
import base64
import re
import sys  # <-- 1. Importar sys
import logging
from logging.handlers import RotatingFileHandler
from flask import Flask, request, jsonify, render_template
import webview
from PIL import Image
from pdf2image import convert_from_bytes
from google.cloud import vision
from google.cloud import translate_v2 as translate
import database_engine

# --- 2. FUNCIÓN PARA OBTENER RUTAS DE ARCHIVOS ---
def resource_path(relative_path):
    """ Obtiene la ruta absoluta al recurso, funciona para desarrollo y para PyInstaller """
    try:
        # PyInstaller crea una carpeta temporal y guarda la ruta en _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")

    return os.path.join(base_path, relative_path)

# --- 3. USAR LA FUNCIÓN PARA LAS RUTAS CRÍTICAS ---
# Ruta para las credenciales de Google
credentials_path = resource_path("google-credentials.json")
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = credentials_path

# --- CONFIGURACIÓN DE FLASK Y LOGGER ---
app = Flask(__name__, static_folder='static', template_folder='templates')

# Ruta para el archivo de log
log_file = resource_path('app.log') 
try:
    handler = RotatingFileHandler(log_file, maxBytes=100000, backupCount=3)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s [in %(pathname)s:%(lineno)d]')
    handler.setFormatter(formatter)
    app.logger.addHandler(handler)
    app.logger.setLevel(logging.ERROR)
except Exception as e:
    print(f"Error al configurar el logger: {e}")

database_engine.init_db()

# --- ENDPOINTS CON LOGGING IMPLEMENTADO ---

@app.route('/')
def home(): 
    return render_template("index.html")

@app.route('/get_supported_languages', methods=['GET'])
def get_supported_languages():
    try:
        translate_client = translate.Client()
        return jsonify(translate_client.get_languages())
    except Exception as e:
        app.logger.error(f"Error en /get_supported_languages: {e}", exc_info=True) # <-- LOGGING AÑADIDO
        return jsonify({"error": str(e)}), 500

@app.route('/update_word_status', methods=['POST'])
def update_word_status():
    try:
        data = request.json
        success = database_engine.update_learning_status(data.get('word'), data.get('target_lang'), data.get('status'))
        return jsonify({'success': success})
    except Exception as e:
        app.logger.error(f"Error en /update_word_status: {e}", exc_info=True) # <-- LOGGING AÑADIDO
        return jsonify({'error': str(e)}), 500

@app.route('/get_vocabulary_status', methods=['POST'])
def get_vocabulary_status():
    try:
        data = request.json
        words = data.get('words', [])
        target_lang = data.get('target_lang', 'es')
        normalized_words = [re.sub(r'[^\w\s-]', '', word).lower() for word in words]
        statuses = database_engine.get_statuses_for_words(normalized_words, target_lang)
        return jsonify(statuses)
    except Exception as e:
        app.logger.error(f"Error en /get_vocabulary_status: {e}", exc_info=True) # <-- LOGGING AÑADIDO
        return jsonify({'error': str(e)}), 500

@app.route('/get_vocabulary', methods=['GET'])
def get_vocabulary():
    try:
        status_filter = request.args.get('status', None)
        vocab_list = database_engine.get_all_vocabulary(status_filter)
        return jsonify(vocab_list)
    except Exception as e:
        app.logger.error(f"Error en /get_vocabulary: {e}", exc_info=True) # <-- LOGGING AÑADIDO
        return jsonify({'error': str(e)}), 500

@app.route('/edit_word', methods=['POST'])
def edit_word():
    try:
        data = request.json
        success = database_engine.edit_word_translation(data.get('word'), data.get('translation'), data.get('target_lang'))
        return jsonify({'success': success})
    except Exception as e:
        app.logger.error(f"Error en /edit_word: {e}", exc_info=True) # <-- LOGGING AÑADIDO
        return jsonify({'error': str(e)}), 500

@app.route('/delete_word', methods=['POST'])
def delete_word():
    try:
        data = request.json
        success = database_engine.delete_word(data.get('word'), data.get('target_lang'))
        return jsonify({'success': success})
    except Exception as e:
        app.logger.error(f"Error en /delete_word: {e}", exc_info=True) # <-- LOGGING AÑADIDO
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
            if response.error.message: raise Exception(response.error.message)
            response_pages.append({'text': response.full_text_annotation.text, 'image_b64': base64.b64encode(content).decode('utf-8')})
        return jsonify({'pages': response_pages})
    except Exception as e:
        app.logger.error(f"Error en /process: {e}", exc_info=True) # <-- LOGGING AÑADIDO
        return jsonify({'error': f'Error del servidor: {e.__class__.__name__}'}), 500

@app.route('/translate', methods=['POST'])
def translate_text():
    try:
        data = request.json
        raw_word = data.get('word', '')
        target_lang = data.get('target_lang', 'es')
        word = re.sub(r'[^\w\s-]', '', raw_word).lower()
        if not word: return jsonify({'error': 'Palabra inválida'}), 400
        cached_data = database_engine.get_translation(word, target_lang)
        if cached_data: return jsonify({**cached_data, 'source': 'cache'})
        translate_client = translate.Client()
        result = translate_client.translate(word, target_language=target_lang)
        api_translation = result['translatedText']
        database_engine.save_translation(word, target_lang, api_translation)
        return jsonify({'translation': api_translation, 'status': 'nueva', 'source': 'api'})
    except Exception as e:
        app.logger.error(f"Error en /translate: {e}", exc_info=True) # <-- LOGGING AÑADIDO
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    webview.create_window('Lector Inteligente', app, width=1280, height=800, resizable=True)
    webview.start(debug=False) # Es buena idea ponerlo en False para la versión final