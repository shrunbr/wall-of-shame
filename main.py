from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv
import json
import os
import psycopg2
import threading
import time
import re
import requests
import ipaddress
from datetime import datetime, timezone
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

# Rate limit / caching / duplicate guard for Geo lookups
ENABLE_GLOBAL_COLLECTOR = str(os.getenv("ENABLE_GLOBAL_COLLECTOR", "true")).lower() not in ("0", "false", "no")
GLOBAL_COLLECTOR_URL = os.getenv("GLOBAL_COLLECTOR_URL", "https://shame.shrunbr.dev/api/webhook")
_IP_API_FIELDS = "17039359"
_RATE_LIMIT = 45  # per 60 seconds for this server
_call_times = []
_call_lock = threading.Lock()

_ip_locks = {}
_ip_locks_lock = threading.Lock()
_as_regex = re.compile(r'^AS(\d+)\s*(.*)$')

_EXCLUDED_NETS_V4 = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),  # CGNAT
]

def _is_public_candidate(ip_str: str) -> bool:
    """
    Return True if IP should be looked up (public routable), False if excluded.
    Handles IP Addressing (skips private, loopback, link-local, multicast, unspecified).
    """
    try:
        ip_obj = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    if ip_obj.version == 4:
        for net in _EXCLUDED_NETS_V4:
            if ip_obj in net:
                return False
    # Generic exclusions
    if (ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local or
        ip_obj.is_multicast or ip_obj.is_reserved or ip_obj.is_unspecified):
        return False
    return True

def _acquire_ip_lock(ip):
    with _ip_locks_lock:
        lock = _ip_locks.get(ip)
        if not lock:
            lock = threading.Lock()
            _ip_locks[ip] = lock
    lock.acquire()
    return lock

def _within_rate_limit():
    now = time.time()
    with _call_lock:
        while _call_times and now - _call_times[0] > 60:
            _call_times.pop(0)
        if len(_call_times) >= _RATE_LIMIT:
            return False
        _call_times.append(now)
        return True

def _ip_exists(conn, ip):
    with conn.cursor() as c:
        c.execute("SELECT 1 FROM source_details WHERE src_host=%s LIMIT 1", (ip,))
        return c.fetchone() is not None

def _insert_geo_row(conn, base, geo):
    """
    Upsert geo data.
    New IP:
      first_seen = last_seen = webhook utc_time (or now)
      times_seen = 1
    Existing IP (conflict):
      last_seen = GREATEST(existing.last_seen, new.last_seen)
      times_seen = times_seen + 1
      (other geo fields remain unchanged)
    """
    asnum = None
    asorg = None
    if geo and geo.get("as"):
        m = _as_regex.match(geo["as"])
        if m:
            try:
                asnum = int(m.group(1))
            except ValueError:
                asnum = None
            asorg = (m.group(2) or None)
        else:
            asorg = geo.get("as")

    ts = base.get("utc_time") or datetime.now(timezone.utc)

    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO source_details (
                first_seen, last_seen, times_seen,
                src_host, src_country, src_isocountrycode, src_region, src_regionname, src_city, src_zip,
                src_latitude, src_longitude, src_timezone,
                src_isp, src_org, src_asnum, src_asorg, src_reversedns,
                src_mobile, src_proxy, src_hosting
            ) VALUES (
                %(first_seen)s, %(last_seen)s, %(times_seen)s,
                %(src_host)s, %(src_country)s, %(src_isocountrycode)s, %(src_region)s, %(src_regionname)s, %(src_city)s, %(src_zip)s,
                %(src_latitude)s, %(src_longitude)s, %(src_timezone)s,
                %(src_isp)s, %(src_org)s, %(src_asnum)s, %(src_asorg)s, %(src_reversedns)s,
                %(src_mobile)s, %(src_proxy)s, %(src_hosting)s
            )
            ON CONFLICT (src_host)
            DO UPDATE SET
                last_seen = GREATEST(source_details.last_seen, EXCLUDED.last_seen),
                times_seen = source_details.times_seen + 1
        """, {
            "first_seen": ts,
            "last_seen": ts,
            "times_seen": 1,
            "src_host": base.get("src_host"),
            "src_country": geo.get("country") if geo else None,
            "src_isocountrycode": geo.get("countryCode") if geo else None,
            "src_region": geo.get("region") if geo else None,
            "src_regionname": geo.get("regionName") if geo else None,
            "src_city": geo.get("city") if geo else None,
            "src_zip": geo.get("zip") if geo else None,
            "src_latitude": geo.get("lat") if geo else None,
            "src_longitude": geo.get("lon") if geo else None,
            "src_timezone": geo.get("timezone") if geo else None,
            "src_isp": geo.get("isp") if geo else None,
            "src_org": geo.get("org") if geo else None,
            "src_asnum": asnum,
            "src_asorg": asorg,
            "src_reversedns": geo.get("reverse") if geo else None,
            "src_mobile": geo.get("mobile") if geo else None,
            "src_proxy": geo.get("proxy") if geo else None,
            "src_hosting": geo.get("hosting") if geo else None
        })

def _fetch_geo(ip):
    if not _within_rate_limit():
        return None
    try:
        r = requests.get(f"http://ip-api.com/json/{ip}?fields={_IP_API_FIELDS}", timeout=5)
        if r.status_code == 200:
            j = r.json()
            if j.get("status") == "success":
                return j
    except Exception:
        pass
    return None

def schedule_geo_lookup(event):
    ip = event.get("src_host")
    if not ip:
        return
    if not _is_public_candidate(ip):
        return
    t = threading.Thread(target=_geo_worker, args=(ip, event), daemon=True)
    t.start()

def _geo_worker(ip, event):
    lock = _acquire_ip_lock(ip)
    try:
        conn = get_db_connection()
        try:
            # Decide whether to fetch geo (only if new IP)
            exists = _ip_exists(conn, ip)
            geo = None
            if not exists:
                geo = _fetch_geo(ip)
            # Upsert row (increments times_seen even if geo is None)
            _insert_geo_row(conn, event, geo or {})
            conn.commit()
        finally:
            try:
                conn.close()
            except Exception:
                pass
    finally:
        lock.release()

def _forward_to_global_collector(payload):
    """
    Send the webhook payload to the global collector. This runs in a background
    thread so it cannot delay the primary webhook flow.
    """
    try:
        # send as JSON; short timeout and swallow errors
        requests.post(GLOBAL_COLLECTOR_URL, json=payload, timeout=5)
    except Exception:
        # intentionally ignore errors (collector is best-effort)
        pass

# Webhook endpoint (unchanged)
@app.route('/api/webhook', methods=['POST'])
def webhook():
    data = None
    if request.is_json:
        try:
            data = request.get_json(force=True)
        except Exception as e:
            return jsonify({"status": "error", "message": f"Invalid JSON: {str(e)}"}), 400
    else:
        try:
            if len(request.form) == 1:
                form_value = next(iter(request.form.values()))
                data = json.loads(form_value)
            else:
                data = request.form.to_dict()
        except Exception as e:
            return jsonify({"status": "error", "message": f"Invalid form data: {str(e)}"}), 400

    # Insert into database
    try:
        if data.get("src_host") == "":
            return jsonify({"status": "error", "message": f"src_host is not defined."}), 400
        conn = get_db_connection()
        cur = conn.cursor()
        logdata = data.get("logdata", {})
        cur.execute("""
            INSERT INTO webhook_logs (
                dst_host, dst_port, local_time, local_time_adjusted, logtype, node_id,
                src_host, src_port, utc_time,
                logdata_hostname, logdata_path, logdata_useragent, logdata_localversion, logdata_password, logdata_remoteversion, logdata_username, logdata_session
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
            logdata.get("HOSTNAME"),
            logdata.get("PATH"),
            logdata.get("USERAGENT"),
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
    
    # Geo lookup (non-blocking)
    schedule_geo_lookup(data)

    if ENABLE_GLOBAL_COLLECTOR:
        try:
            t = threading.Thread(target=_forward_to_global_collector, args=(data,), daemon=True)
            t.start()
        except Exception:
            pass

    return jsonify({"status": "success", "received": data}), 200


# API endpoint for logs
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

# API endpoint for source details by IP
@app.route('/api/source_details/<ip>', methods=['GET'])
def get_source_details(ip):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM source_details WHERE src_host = %s", (ip,))
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row:
            return jsonify(row)
        else:
            return jsonify({'error': 'Not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/source_details/batch', methods=['POST'])
def get_source_details_batch():
    try:
        data = request.get_json(force=True)
        ips = data.get('ips', [])
        if not isinstance(ips, list) or not ips:
            return jsonify({})
        conn = get_db_connection()
        cur = conn.cursor()
        # Only select needed columns for geo/country/flag
        cur.execute("""
            SELECT src_host, src_isocountrycode
            FROM source_details
            WHERE src_host = ANY(%s)
        """, (ips,))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        # Map: ip -> row (or None)
        result = {ip: None for ip in ips}
        for row in rows:
            result[row['src_host']] = row
        return jsonify(result)
    except Exception as e:
        return jsonify({}), 500

# API endpoint for top stats (source IP, AS number, ISP, country)
@app.route('/api/topstats', methods=['GET'])
def get_top_stats():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            WITH
            top_src_host AS (
                SELECT src_host AS value, SUM(times_seen) AS cnt
                FROM source_details
                WHERE src_host IS NOT NULL AND src_host != ''
                GROUP BY src_host
                ORDER BY cnt DESC, value ASC
                LIMIT 1
            ),
            top_asnum AS (
                SELECT src_asnum::text AS value, SUM(times_seen) AS cnt
                FROM source_details
                WHERE src_asnum IS NOT NULL
                GROUP BY src_asnum
                ORDER BY cnt DESC, value ASC
                LIMIT 1
            ),
            top_isp AS (
                SELECT src_isp AS value, SUM(times_seen) AS cnt
                FROM source_details
                WHERE src_isp IS NOT NULL AND src_isp != ''
                GROUP BY src_isp
                ORDER BY cnt DESC, value ASC
                LIMIT 1
            ),
            top_country AS (
                SELECT src_country AS value, SUM(times_seen) AS cnt
                FROM source_details
                WHERE src_country IS NOT NULL AND src_country != ''
                GROUP BY src_country
                ORDER BY cnt DESC, value ASC
                LIMIT 1
            )
            SELECT
                (SELECT value FROM top_src_host) AS top_src,
                (SELECT value FROM top_asnum) AS top_as,
                (SELECT value FROM top_isp) AS top_isp,
                (SELECT value FROM top_country) AS top_country
        """)
        row = cur.fetchone()
        top_stats = dict(row) if row else {}

        # Top username and password from webhook_logs
        cur.execute("""
            WITH
            top_username AS (
                SELECT logdata_username AS value, COUNT(*) AS cnt
                FROM webhook_logs
                WHERE logdata_username IS NOT NULL AND logdata_username != ''
                GROUP BY logdata_username
                ORDER BY cnt DESC, value ASC
                LIMIT 1
            ),
            top_password AS (
                SELECT logdata_password AS value, COUNT(*) AS cnt
                FROM webhook_logs
                WHERE logdata_password IS NOT NULL AND logdata_password != ''
                GROUP BY logdata_password
                ORDER BY cnt DESC, value ASC
                LIMIT 1
            )
            SELECT
                (SELECT value FROM top_username) AS top_username,
                (SELECT value FROM top_password) AS top_password
        """)
        row = cur.fetchone()
        if row:
            top_stats.update(row)

        cur.close()
        conn.close()
        return jsonify(top_stats)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Serve React build
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_react(path):
    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8081)