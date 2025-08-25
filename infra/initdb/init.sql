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
    logdata_hostname VARCHAR(999),
    logdata_path VARCHAR(999),
    logdata_useragent VARCHAR(999),
    logdata_localversion VARCHAR(999),
    logdata_password VARCHAR(999),
    logdata_remoteversion VARCHAR(999),
    logdata_username VARCHAR(999),
    logdata_session VARCHAR(999)
);

CREATE TABLE IF NOT EXISTS source_details (
    id SERIAL PRIMARY KEY,
    first_seen TIMESTAMP,
    last_seen TIMESTAMP,
    times_seen INTEGER,
    src_host VARCHAR(255),
    src_countrycode VARCHAR(2),
    src_region VARCHAR(10),
    src_regionname VARCHAR(255),
    src_city VARCHAR(255),
    src_zip VARCHAR(25),
    src_latitude DECIMAL(9,6),
    src_longitude DECIMAL(9,6),
    src_timezone VARCHAR(50),
    src_isp VARCHAR(255),
    src_org VARCHAR(255),
    src_asnum INTEGER,
    src_asorg VARCHAR(255),
    src_reversedns VARCHAR(999),
    src_mobile BOOLEAN,
    src_proxy BOOLEAN,
    src_hosting BOOLEAN
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_details_src_host ON source_details (src_host);