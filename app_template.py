import os
from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv
import json
import psycopg2
from psycopg2.extras import RealDictCursor

app = Flask(__name__, static_folder='frontend/build', static_url_path='/')

load_dotenv()

def get_db_connection():
    return psycopg2.connect(
        dbname=os.getenv("POSTGRES_DB"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD"),
        host=os.getenv("POSTGRES_HOST"),
        port=os.getenv("POSTGRES_PORT"),
        cursor_factory=RealDictCursor
    )

@app.route('/webhook', methods=['POST'])
def webhook():
    # ...existing code...
    pass

@app.route('/api/logs', methods=['GET'])
def get_logs():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM webhook_logs")
        logs = cur.fetchall()
        cur.close()
        conn.close()
        return jsonify({'logs': logs})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_react(path):
    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
