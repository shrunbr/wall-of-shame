CREATE TABLE IF NOT EXISTS webhook_logs (
    id SERIAL PRIMARY KEY,
    dst_host VARCHAR(45),
    dst_port INTEGER,
    local_time TIMESTAMP,
    local_time_adjusted TIMESTAMP,
    logtype INTEGER,
    node_id VARCHAR(100),
    src_host VARCHAR(45),
    src_port INTEGER,
    utc_time TIMESTAMP,
    logdata_localversion VARCHAR(999),
    logdata_password VARCHAR(999),
    logdata_remoteversion VARCHAR(999),
    logdata_username VARCHAR(999),
    logdata_session VARCHAR(999)
);