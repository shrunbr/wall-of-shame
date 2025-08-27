import asyncio
import os
import ipaddress
import threading
import re
import requests
import time
import logging
import json
from decimal import Decimal
from fastapi import FastAPI, Request, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from dotenv import load_dotenv
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from psycopg_pool import AsyncConnectionPool, pool
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app):
    dsn = (
        f"host={os.getenv('POSTGRES_HOST')} "
        f"port={os.getenv('POSTGRES_PORT')} "
        f"dbname={os.getenv('POSTGRES_DB')} "
        f"user={os.getenv('POSTGRES_USER')} "
        f"password={os.getenv('POSTGRES_PASSWORD')}"
    )
    # create the pool object (constructor no longer opens it)
    pool = AsyncConnectionPool(
        conninfo=dsn,
        min_size=int(os.getenv("DB_POOL_MIN", "1")),
        max_size=int(os.getenv("DB_POOL_MAX", "10")),
        open=False
    )
    # explicitly open the pool to avoid the deprecation warning
    await pool.open()
    app.state.db_pool = pool

    try:
        yield
    finally:
        # close the pool on shutdown
        await app.state.db_pool.close()

app = FastAPI(lifespan=lifespan)
load_dotenv()

_build_dir = os.path.join(os.path.dirname(__file__), "frontend", "build")
app.mount("/static", StaticFiles(directory=os.path.join(_build_dir, "static")), name="static")

# Rate limit / caching / duplicate guard for Geo lookups
#ENABLE_GLOBAL_COLLECTOR = str(os.getenv("ENABLE_GLOBAL_COLLECTOR", "false")).lower() not in ("1", "true", "yes")
#GLOBAL_COLLECTOR_URL = os.getenv("GLOBAL_COLLECTOR_URL", "https://shame.shrunbr.dev/api/webhook")
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

async def _ip_exists_async(conn, ip):
    async with conn.cursor() as c:
        await c.execute("SELECT 1 FROM source_details WHERE src_host=%s LIMIT 1", (ip,))
        row = await c.fetchone()
        return row is not None

async def _insert_geo_row_async(conn, base, geo):
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

    with_params = {
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
    }

    async with conn.cursor() as cur:
        await cur.execute("""
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
        """, with_params)

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

def schedule_geo_lookup(event, background: BackgroundTasks = None, app=None):
    ip = event.get("src_host")
    if not ip:
        return
    if not _is_public_candidate(ip):
        return

    try:
        background.add_task(_geo_worker_async, app, ip, event)
        return
    except Exception as e:
        logger.error(f"Failed to schedule background task: {e}")
        return

async def _geo_worker_async(app, ip, event):
    lock = _acquire_ip_lock(ip)
    try:
        pool = app.state.db_pool
        async with pool.connection() as conn:
            # Decide whether to fetch geo (only if new IP)
            exists = await _ip_exists_async(conn, ip)
            geo = None
            if not exists:
                # _fetch_geo is blocking (requests); run in threadpool
                geo = await asyncio.to_thread(_fetch_geo, ip)
            # Upsert row (increments times_seen even if geo is None)
            await _insert_geo_row_async(conn, event, geo or {})
            await conn.commit()
    finally:
        lock.release()

#def _forward_to_global_collector(payload):
#    """
#    Send the webhook payload to the global collector. This runs in a background
#    thread so it cannot delay the primary webhook flow.
#    """
#    try:
#        # send as JSON; short timeout and swallow errors
#        requests.post(GLOBAL_COLLECTOR_URL, json=payload, timeout=5)
#    except Exception:
#        # intentionally ignore errors (collector is best-effort)
#        pass

def serialize_datetimes(obj):
    if isinstance(obj, dict):
        return {k: serialize_datetimes(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [serialize_datetimes(i) for i in obj]
    elif isinstance(obj, datetime):
        return obj.strftime('%Y-%m-%d %H:%M:%S %z')
    elif isinstance(obj, Decimal):
        return float(obj)
    else:
        return obj

@app.post("/api/webhook")
async def webhook(request: Request, background: BackgroundTasks):
    data = None

    # Try JSON parsing first, useful for direct API testing
    try:
        body = await request.body()
        if body:
            try:
                data = await request.json()
            except Exception:
                pass
    except Exception:
        pass

    # If not JSON, try as form, how OpenCanary sends the data
    if data is None:
        try:
            form = await request.form()
            if "message" in form:
                try:
                    data = json.loads(form["message"])
                except Exception as e:
                    return JSONResponse(
                        content={"status": "error", "message": f"Failed to parse form data: {e}"},
                        status_code=400,
                    )
            else:
                return JSONResponse(
                    content={"status": "error", "message": "No 'message' field in form data."},
                    status_code=400,
                )
        except Exception as e:
            return JSONResponse(
                content={"status": "error", "message": f"Failed to read form data: {e}"},
                status_code=400,
            )

    if not data or data.get("src_host") == "":
        return JSONResponse(
            content={"status": "error", "message": "src_host is not defined."},
            status_code=400,
        )

    pool = request.app.state.db_pool
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            logdata = data.get("logdata", {}) or {}
            await cur.execute("""
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
        await conn.commit()

    schedule_geo_lookup(data, background=background, app=request.app)

    return JSONResponse(content={"status": "success", "received": data}, status_code=200)

@app.get('/api/logs')
async def get_logs(request: Request, page: int = 1, per_page: int = 10, src: str | None = None):
    """
    If `src` is provided: return logs for that src_host (most recent first).
    Otherwise: return paginated list of distinct src_host with last_seen and count.
    Response:
      { status: "success", data: [...], total: <int>, page: <int>, per_page: <int> }
    """
    try:
        per_page = max(1, min(int(per_page), 1000))
        page = max(1, int(page))
        pool = request.app.state.db_pool
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                if src:
                    # Return logs for a single source (most recent first)
                    await cur.execute("""
                        SELECT * FROM webhook_logs
                        WHERE src_host = %s
                        ORDER BY utc_time DESC NULLS LAST
                    """, (src,))
                    rows = await cur.fetchall()
                    columns = [desc[0] for desc in cur.description]
                    data = [dict(zip(columns, row)) for row in rows]
                    data = serialize_datetimes(data)
                    return JSONResponse(content={"status": "success", "data": data}, status_code=200)

                # Total distinct sources
                await cur.execute("SELECT COUNT(DISTINCT src_host) FROM webhook_logs WHERE src_host IS NOT NULL AND src_host != ''")
                total_row = await cur.fetchone()
                total = total_row[0] if total_row else 0

                offset = (page - 1) * per_page
                # Return one row per src_host: latest utc_time and count
                await cur.execute("""
                    SELECT src_host, MAX(utc_time) AS last_seen, COUNT(*) AS times_seen
                    FROM webhook_logs
                    WHERE src_host IS NOT NULL AND src_host != ''
                    GROUP BY src_host
                    ORDER BY last_seen DESC NULLS LAST
                    LIMIT %s OFFSET %s
                """, (per_page, offset))
                rows = await cur.fetchall()
                columns = [desc[0] for desc in cur.description]
                data = [dict(zip(columns, row)) for row in rows]
                data = serialize_datetimes(data)
                return JSONResponse(content={"status": "success", "data": data, "total": total, "page": page, "per_page": per_page}, status_code=200)
    except Exception as e:
        logger.error(f"Failed to retrieve logs: {e}")
        return JSONResponse(content={"status": "error", "message": "Failed to retrieve logs"}, status_code=500)

@app.get('/api/source_details/{src_host}')
async def get_source_details(src_host: str, request: Request):
    try:
        pool = request.app.state.db_pool
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT * FROM source_details WHERE src_host = %s", (src_host,))
                rows = await cur.fetchall()
                columns = [desc[0] for desc in cur.description]
                data = [dict(zip(columns, row)) for row in rows]
                data = serialize_datetimes(data)
                return JSONResponse(content={"status": "success", "data": data}, status_code=200)
    except Exception as e:
        logger.error(f"Failed to retrieve source details for {src_host}: {e}")
        return JSONResponse(content={"status": "error", "message": "Failed to retrieve source details"}, status_code=500)

@app.post('/api/source_details/batch')
async def get_source_details_batch(request: Request):
    try:
        data = await request.json()
        ips = data.get('ips', [])
        if not ips:
            return JSONResponse(content={"status": "error", "message": "ips is required"}, status_code=400)

        pool = request.app.state.db_pool
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT src_host, src_isocountrycode FROM source_details WHERE src_host = ANY(%s)", (ips,))
                rows = await cur.fetchall()
                result = {row[0]: row[1] for row in rows}
                return JSONResponse(content={"status": "success", "data": result}, status_code=200)
    except Exception as e:
        logger.error(f"Failed to retrieve source details for batch: {e}")
        return JSONResponse(content={"status": "error", "message": "Failed to retrieve source details"}, status_code=500)

@app.get('/api/topstats')
async def get_top_stats(request: Request):
    try:
        pool = request.app.state.db_pool
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute("""
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
                row = await cur.fetchone()
                if row:
                    columns = [desc[0] for desc in cur.description]
                    top_stats = dict(zip(columns, row))
                else:
                    top_stats = {}

                await cur.execute("""
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
                             ),
                             top_node AS (
                                 SELECT node_id AS value, COUNT(*) AS cnt
                                 FROM webhook_logs
                                 WHERE node_id IS NOT NULL AND node_id != ''
                                 GROUP BY node_id
                                 ORDER BY cnt DESC, value ASC
                                 LIMIT 1
                             )
                             SELECT
                                 (SELECT value FROM top_username) AS top_username,
                                 (SELECT value FROM top_password) AS top_password,
                                 (SELECT value FROM top_node) AS top_node
                            """)
                row = await cur.fetchone()
                if row:
                    columns = [desc[0] for desc in cur.description]
                    row_dict = dict(zip(columns, row))
                    top_stats.update(row_dict)

                return JSONResponse(content=top_stats, status_code=200)
    except Exception as e:
        logger.error(f"Failed to retrieve top stats: {e}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.get("/", include_in_schema=False)
async def _index():
    return FileResponse(os.path.join(_build_dir, "index.html"))

@app.get("/{full_path:path}", include_in_schema=False)
async def _spa_fallback(full_path: str):
    candidate = os.path.join(_build_dir, full_path)
    # If the requested file exists in the build directory, return it (allows asset requests).
    if full_path and os.path.exists(candidate) and os.path.isfile(candidate):
        return FileResponse(candidate)
    # Otherwise return index.html so the SPA client router can handle the path.
    return FileResponse(os.path.join(_build_dir, "index.html"))

if __name__ == "__main__":
    # run with an ASGI server for FastAPI
    uvicorn.run("main:app", host="0.0.0.0", port=8081, reload=False)