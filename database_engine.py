# database_engine.py
import sqlite3

DB_FILE = 'lector_vocabulario.sqlite'

def init_db():
    # Usamos 'with' para garantizar que la conexión se maneje correctamente.
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS vocabulary (
                id INTEGER PRIMARY KEY,
                word_text TEXT NOT NULL,
                source_language TEXT NOT NULL,
                target_language TEXT NOT NULL,
                translation TEXT,
                learning_status TEXT DEFAULT 'nueva',
                UNIQUE(word_text, source_language, target_language)
            )
        ''')

def save_translation(word, source_lang, target_lang, translation):
    try:
        with sqlite3.connect(DB_FILE) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO vocabulary (word_text, source_language, target_language, translation, learning_status)
                VALUES (?, ?, ?, ?, ?)
            ''', (word, source_lang, target_lang, translation, 'nueva'))
    except sqlite3.IntegrityError:
        # La palabra para esta combinación de idiomas ya existe, no hacemos nada.
        pass

def get_translation(word, source_lang, target_lang):
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT translation, learning_status FROM vocabulary WHERE word_text = ? AND source_language = ? AND target_language = ?", (word, source_lang, target_lang))
        result = cursor.fetchone()
        if result:
            return {'translation': result[0], 'status': result[1]}
        return None

def update_learning_status(word, source_lang, target_lang, status):
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE vocabulary SET learning_status = ? WHERE word_text = ? AND source_language = ? AND target_language = ?", (status, word, source_lang, target_lang))
        return cursor.rowcount > 0

def get_statuses_for_words(words, source_lang, target_lang):
    if not words:
        return {}
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        placeholders = ','.join('?' for _ in words)
        query = f"SELECT word_text, learning_status FROM vocabulary WHERE word_text IN ({placeholders}) AND source_language = ? AND target_language = ?"
        params = words + [source_lang, target_lang]
        cursor.execute(query, params)
        return {row[0]: row[1] for row in cursor.fetchall()}

def get_all_vocabulary(status_filter=None):
    with sqlite3.connect(DB_FILE) as conn:
        # Hacemos que la conexión devuelva filas que se comportan como diccionarios
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        query = "SELECT word_text, source_language, target_language, translation, learning_status FROM vocabulary"
        if status_filter and status_filter != 'todos':
            query += " WHERE learning_status = ?"
            cursor.execute(query, (status_filter,))
        else:
            cursor.execute(query)
        
        # Convertimos las filas a diccionarios estándar para devolver JSON
        return [dict(row) for row in cursor.fetchall()]

def edit_word_translation(word, source_lang, target_lang, new_translation):
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE vocabulary SET translation = ? WHERE word_text = ? AND source_language = ? AND target_language = ?", (new_translation, word, source_lang, target_lang))
        return cursor.rowcount > 0

def delete_word(word, source_lang, target_lang):
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM vocabulary WHERE word_text = ? AND source_language = ? AND target_language = ?", (word, source_lang, target_lang))
        return cursor.rowcount > 0