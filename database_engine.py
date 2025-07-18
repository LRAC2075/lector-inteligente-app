# database_engine.py
import sqlite3
import re

DB_FILE = "lector_inteligente_vocabulario.db"

def init_db():
    """Inicializa la base de datos y la tabla si no existen."""
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS vocabulary (
            id INTEGER PRIMARY KEY,
            word_text TEXT NOT NULL,
            target_language TEXT NOT NULL,
            translation TEXT,
            learning_status TEXT NOT NULL DEFAULT 'nueva',
            UNIQUE(word_text, target_language)
        )
        """)
    print("Base de datos inicializada correctamente.")

def save_translation(word, target_lang, translation):
    """Guarda una nueva traducción. El estado por defecto es 'nueva'."""
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT OR IGNORE INTO vocabulary (word_text, target_language, translation)
        VALUES (?, ?, ?)
        """, (word, target_lang, translation))
    print(f"Traducción para '{word}' -> '{translation}' guardada.")

def get_translation(word, target_lang):
    """Busca una traducción y su estado en la base de datos."""
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT translation, learning_status 
        FROM vocabulary 
        WHERE word_text = ? AND target_language = ?
        """, (word, target_lang))
        result = cursor.fetchone()
        if result:
            print(f"Traducción para '{word}' encontrada en la DB con estado '{result[1]}'.")
            return {"translation": result[0], "status": result[1]}
        return None

def update_learning_status(word, target_lang, new_status):
    """Actualiza el estado de aprendizaje de una palabra."""
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("""
        UPDATE vocabulary 
        SET learning_status = ? 
        WHERE word_text = ? AND target_language = ?
        """, (new_status, word, target_lang))
        if cursor.rowcount > 0:
            print(f"Estado de '{word}' actualizado a '{new_status}'.")
            return True
        return False
    
def get_statuses_for_words(words, target_lang):
    """
    Recibe una lista de palabras y devuelve un diccionario con sus estados.
    """
    if not words:
        return {}
    
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # Creamos los placeholders (?,?,?) para la consulta SQL de forma segura
    placeholders = ','.join(['?'] * len(words))
    query = f"""
    SELECT word_text, learning_status 
    FROM vocabulary 
    WHERE word_text IN ({placeholders}) AND target_language = ?
    """
    
    # Los parámetros para la consulta son todas las palabras más el idioma
    params = words + [target_lang]
    cursor.execute(query, params)
    
    # Creamos un diccionario de {palabra: estado} para devolverlo
    statuses = {row[0]: row[1] for row in cursor.fetchall()}
    conn.close()
    
    return statuses

def get_all_vocabulary(status_filter=None):
    """
    Devuelve una lista de todo el vocabulario guardado.
    Opcionalmente, filtra por estado de aprendizaje si se proporciona un filtro.
    """
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        query = "SELECT word_text, translation, target_language, learning_status FROM vocabulary"
        params = []

        if status_filter and status_filter != 'todos':
            query += " WHERE learning_status = ?"
            params.append(status_filter)
        
        # Ordenamos primero por idioma, y luego por palabra.
        query += " ORDER BY target_language ASC, word_text ASC"

        cursor.execute(query, params)
        vocabulary_list = [dict(row) for row in cursor.fetchall()]
        
        return vocabulary_list
    
def edit_word_translation(old_word, new_translation, target_lang):
    """Actualiza la traducción de una palabra específica."""
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("""
        UPDATE vocabulary
        SET translation = ?
        WHERE word_text = ? AND target_language = ?
        """, (new_translation, old_word, target_lang))
        return cursor.rowcount > 0

def delete_word(word, target_lang):
    """Elimina una palabra de la base de datos."""
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("""
        DELETE FROM vocabulary
        WHERE word_text = ? AND target_language = ?
        """, (word, target_lang))
        return cursor.rowcount > 0