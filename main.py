from flask import Flask, request, jsonify
from dotenv import load_dotenv
import json
import os
import psycopg2
from psycopg2.extras import RealDictCursor

app = Flask(__name__)

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
    data = None
    if request.is_json:
        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({"status": "error", "message": "Invalid JSON"}), 400
    else:
        try:
            if len(request.form) == 1:
                form_value = next(iter(request.form.values()))
                data = json.loads(form_value)
            else:
                data = request.form.to_dict()
        except Exception:
            return jsonify({"status": "error", "message": "Invalid form data"}), 400

    # Insert into database
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        logdata = data.get("logdata", {})
        cur.execute("""
            INSERT INTO webhook_logs (
                dst_host, dst_port, local_time, local_time_adjusted, logtype, node_id,
                src_host, src_port, utc_time,
                logdata_localversion, logdata_password, logdata_remoteversion, logdata_username, logdata_session
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            data.get("dst_host"),
            data.get("dst_port"),
            data.get("local_time"),
            data.get("local_time_adjusted"),
            data.get("logtype"),
            data.get("node_id"),
            data.get("src_host"),
            data.get("src_port"),
            data.get("utc_time"),
            logdata.get("LOCALVERSION"),
            logdata.get("PASSWORD"),
            logdata.get("REMOTEVERSION"),
            logdata.get("USERNAME"),
            logdata.get("SESSION"),
        ))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        return jsonify({"status": "error", "message": f"DB error: {str(e)}"}), 500

    return jsonify({"status": "success", "received": data}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5050)