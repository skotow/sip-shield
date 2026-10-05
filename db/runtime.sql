CREATE TABLE IF NOT EXISTS version (table_name VARCHAR(32) PRIMARY KEY, table_version INT NOT NULL);
INSERT INTO version VALUES('trusted',6) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS trusted (id SERIAL PRIMARY KEY,src_ip VARCHAR(50) NOT NULL,proto VARCHAR(4) NOT NULL,from_pattern VARCHAR(64),ruri_pattern VARCHAR(64),tag VARCHAR(64),priority INT NOT NULL DEFAULT 0);
INSERT INTO version VALUES ('address',6),('dispatcher',4),('runtime_kv',2) ON CONFLICT (table_name) DO UPDATE SET table_version=EXCLUDED.table_version;
CREATE TABLE IF NOT EXISTS address (
 id SERIAL PRIMARY KEY, grp INT NOT NULL, ip_addr VARCHAR(50) NOT NULL,
 mask INT NOT NULL, port INT NOT NULL DEFAULT 0, tag VARCHAR(64), bank INT NOT NULL
);
CREATE TABLE IF NOT EXISTS dispatcher (
 id SERIAL PRIMARY KEY, setid INT NOT NULL, destination VARCHAR(192) NOT NULL,
 flags INT NOT NULL DEFAULT 0, priority INT NOT NULL DEFAULT 0,
 attrs VARCHAR(128) NOT NULL DEFAULT '', description VARCHAR(64) NOT NULL DEFAULT '', bank INT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_kv (
 id SERIAL PRIMARY KEY, key_name VARCHAR(255) NOT NULL UNIQUE, key_type INT NOT NULL DEFAULT 0,
 value_type INT NOT NULL DEFAULT 0, key_value TEXT NOT NULL, expires INT NOT NULL DEFAULT 0, bank INT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_state (id INT PRIMARY KEY CHECK(id=1), bank INT NOT NULL DEFAULT 0);
INSERT INTO runtime_state VALUES(1,0) ON CONFLICT DO NOTHING;
ALTER TABLE runtime_state ADD COLUMN IF NOT EXISTS ip_bank INT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS runtime_selector (LIKE runtime_kv INCLUDING ALL);
INSERT INTO version VALUES('runtime_selector',2) ON CONFLICT DO NOTHING;
INSERT INTO runtime_selector(key_name,value_type,key_value,bank) VALUES('bank',1,'0',0),('ipbank',1,'0',0) ON CONFLICT DO NOTHING;
INSERT INTO runtime_selector(key_name,value_type,key_value,bank) SELECT 'generation',1,(bank+ip_bank*2)::text,0 FROM runtime_state WHERE id=1 ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS runtime_requests (
 id UUID PRIMARY KEY, status TEXT NOT NULL DEFAULT 'queued', kind TEXT NOT NULL DEFAULT 'all',
 message TEXT NOT NULL DEFAULT 'Waiting for runtime worker', error TEXT, requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ
);
ALTER TABLE blocked_ips ADD COLUMN IF NOT EXISTS policy TEXT NOT NULL DEFAULT 'block' CHECK(policy IN ('allow','block'));
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS event_key TEXT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS call_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS sip_events_event_key ON sip_events(event_key);
ALTER TABLE sip_events DROP CONSTRAINT IF EXISTS sip_events_action_check;
ALTER TABLE sip_events ADD CONSTRAINT sip_events_action_check CHECK(action IN ('allowed','blocked','would_block'));
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS response_code INT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS threshold INT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS window_seconds INT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS block_seconds INT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS behavior_rule_id INT;
CREATE TABLE IF NOT EXISTS behavior_rules (
 id SERIAL PRIMARY KEY, name TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true,
 metric TEXT NOT NULL CHECK(metric IN ('invite','register','options','response_404','response_403')),
 threshold INT NOT NULL CHECK(threshold BETWEEN 1 AND 100000),
 window_seconds INT NOT NULL CHECK(window_seconds BETWEEN 1 AND 3600),
 block_seconds INT NOT NULL CHECK(block_seconds BETWEEN 1 AND 86400),
 action TEXT NOT NULL CHECK(action IN ('alert_only','block')),
 customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
 revision INT NOT NULL DEFAULT 1
);
-- Seed only once; deleting defaults must not recreate them on API restart.
CREATE TABLE IF NOT EXISTS feature_migrations (name TEXT PRIMARY KEY);
WITH first_install AS (
 INSERT INTO feature_migrations VALUES('auto_defense_v1') ON CONFLICT DO NOTHING RETURNING name
)
INSERT INTO behavior_rules(name,metric,threshold,window_seconds,block_seconds,action)
SELECT defaults.* FROM first_install CROSS JOIN (VALUES
 ('INVITE flood','invite',100,1,600,'block'),
 ('REGISTER burst','register',30,60,1800,'block'),
 ('OPTIONS flood','options',200,60,600,'block'),
 ('404 scan','response_404',50,60,1800,'block'),
 ('403 failures','response_403',30,60,1800,'block')
) AS defaults(name,metric,threshold,window_seconds,block_seconds,action);
CREATE TABLE IF NOT EXISTS sip_messages (
 id BIGSERIAL PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, call_id TEXT NOT NULL,
 captured_at TIMESTAMPTZ NOT NULL, source_ip TEXT NOT NULL, source_port INT NOT NULL,
 destination_ip TEXT NOT NULL, destination_port INT NOT NULL, transport TEXT NOT NULL,
 source_role TEXT NOT NULL, destination_role TEXT NOT NULL,
 first_line TEXT NOT NULL, method TEXT, response_code INT, cseq TEXT,
 message TEXT NOT NULL, size_bytes INT NOT NULL, truncated BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS sip_messages_call_time ON sip_messages(call_id,captured_at,id);
CREATE INDEX IF NOT EXISTS sip_events_call_time ON sip_events(call_id,created_at,id);

-- SIP Explorer stores metadata only; optional enrichment remains NULL if unknown.
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS source_port INT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS transport TEXT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS from_domain TEXT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS to_domain TEXT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS request_uri TEXT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS called_number TEXT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS caller_id TEXT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS backend_host TEXT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS backend_port INT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS response_reason TEXT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS asn BIGINT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS asn_name TEXT;
ALTER TABLE sip_events ADD COLUMN IF NOT EXISTS country TEXT;
CREATE INDEX IF NOT EXISTS sip_events_search_time ON sip_events(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS sip_events_search_source ON sip_events(source_ip,created_at DESC);
CREATE INDEX IF NOT EXISTS sip_events_search_number ON sip_events(called_number,created_at DESC);
CREATE INDEX IF NOT EXISTS sip_events_search_backend ON sip_events(backend_host,created_at DESC);
CREATE INDEX IF NOT EXISTS sip_events_search_response ON sip_events(response_code,created_at DESC);
CREATE INDEX IF NOT EXISTS sip_events_search_method ON sip_events(method,created_at DESC);
CREATE INDEX IF NOT EXISTS sip_events_search_action ON sip_events(action,created_at DESC);
CREATE INDEX IF NOT EXISTS sip_events_search_customer ON sip_events(customer_id,created_at DESC);
