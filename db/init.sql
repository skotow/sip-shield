CREATE TABLE customers (
 id SERIAL PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL UNIQUE,
 backend_host TEXT NOT NULL, backend_port INT NOT NULL DEFAULT 5060 CHECK (backend_port BETWEEN 1 AND 65535),
 enabled BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE blocked_ips (
 id SERIAL PRIMARY KEY, customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
 ip_cidr TEXT NOT NULL CHECK (ip_cidr::inet IS NOT NULL), reason TEXT,
 expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE blocked_user_agents (
 id SERIAL PRIMARY KEY, customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
 pattern TEXT NOT NULL, reason TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE blocked_prefixes (
 id SERIAL PRIMARY KEY, customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
 prefix TEXT NOT NULL, reason TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE sip_events (
 id SERIAL PRIMARY KEY, customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
 source_ip TEXT, method TEXT, from_user TEXT, to_user TEXT, user_agent TEXT,
 destination TEXT, action TEXT NOT NULL CHECK (action IN ('allowed','blocked')),
 reason TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX sip_events_created_at ON sip_events(created_at DESC);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
INSERT INTO customers (name,domain,backend_host,backend_port)
 VALUES ('Demo PBX','demo.sipshield.local','127.0.0.1',5070);
