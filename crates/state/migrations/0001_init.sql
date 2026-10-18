-- Memora state database, migration 1 (docs/DATABASE.md section 2).
--
-- Applied by src/migrate.rs inside one BEGIN IMMEDIATE transaction together with
-- `PRAGMA user_version = 1`. Conventions: times are INTEGER unix seconds UTC; booleans
-- are INTEGER CHECK (x IN (0,1)); every table is STRICT; ids keep the legacy formats.

PRAGMA application_id = 1296387407;          -- 0x4D454D4F 'MEMO': refuse to open foreign files
-- user_version is managed by the migration runner.

CREATE TABLE meta (                            -- import markers, schema notes
  key   TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 64),
  value TEXT NOT NULL
) STRICT;

-- Single owner, enforced by the schema: at most one row, id is always 1.
CREATE TABLE owner (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  username      TEXT NOT NULL CHECK (length(username) BETWEEN 1 AND 32
                  AND username = lower(username)
                  AND username NOT GLOB '*[^a-z0-9._-]*'),
  password_hash TEXT NOT NULL CHECK (password_hash GLOB '$argon2id$*'),
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  display_name  TEXT NOT NULL DEFAULT '' CHECK (length(display_name) <= 64),
  created_at    INTEGER NOT NULL,
  password_changed_at INTEGER NOT NULL
) STRICT;

-- Instance settings (gateway.json "settings" + config.json "vault"): one typed row.
CREATE TABLE settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  realm            TEXT    NOT NULL DEFAULT 'Memora' CHECK (length(realm) BETWEEN 1 AND 64),
  session_ttl      INTEGER NOT NULL DEFAULT 10800 CHECK (session_ttl BETWEEN 300 AND 2592000),
  session_max_age  INTEGER NOT NULL DEFAULT 0     CHECK (session_max_age = 0 OR session_max_age >= session_ttl),
  min_password_len INTEGER NOT NULL DEFAULT 10    CHECK (min_password_len BETWEEN 10 AND 256),
  vault_path       TEXT CHECK (vault_path IS NULL OR (length(vault_path) BETWEEN 1 AND 4096
                                                      AND vault_path GLOB '/*')),  -- absolute only
  updated_at       INTEGER NOT NULL
) STRICT;
INSERT INTO settings (id, updated_at) VALUES (1, unixepoch());

-- memora.env replacement: only known keys; process env applies when a key has no row.
-- Provisioning secrets (MEMORA_ADMIN_PASSWORD, MEMORA_API_KEY) are deliberately NOT allowed:
-- they are consumed once into owner/api_key hashes and never stored in plaintext.
CREATE TABLE server_config (
  key        TEXT PRIMARY KEY CHECK (key IN ('MEMORA_PORT','MEMORA_BIND','MEMORA_BASE_URL',
               'MEMORA_DOMAIN','MEMORA_TRUSTED_PROXIES','MEMORA_ARM_TTL','MEMORA_VAULT',
               'MEMORA_VAULT_AUTO','MEMORA_ADMIN_USER','RUST_LOG')),
  value      TEXT NOT NULL CHECK (length(value) <= 2048),
  updated_at INTEGER NOT NULL,
  CHECK (key <> 'MEMORA_PORT'     OR (CAST(value AS INTEGER) BETWEEN 1 AND 65535 AND value NOT GLOB '*[^0-9]*')),
  CHECK (key <> 'MEMORA_ARM_TTL'  OR (CAST(value AS INTEGER) BETWEEN 30 AND 86400 AND value NOT GLOB '*[^0-9]*')),
  CHECK (key <> 'MEMORA_VAULT_AUTO' OR value IN ('true','false'))
) STRICT;

-- MCP tool catalog mirror, synced from memora_mcp::catalog() at server start, so per-key
-- and global tool switches can be foreign keys (unknown tool names are impossible).
CREATE TABLE tool (
  name    TEXT PRIMARY KEY CHECK (name GLOB '[a-z]*' AND name NOT GLOB '*[^a-z0-9_]*'),
  retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0,1))   -- gone from the catalog
) STRICT;

CREATE TABLE tool_disabled (                   -- tools.json "disabled"
  tool_name   TEXT PRIMARY KEY REFERENCES tool(name) ON UPDATE CASCADE,
  disabled_at INTEGER NOT NULL
) STRICT;

CREATE TABLE api_key (
  id          TEXT PRIMARY KEY CHECK (id GLOB 'k_*' AND length(id) BETWEEN 3 AND 40),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  hash        TEXT NOT NULL UNIQUE CHECK (                -- sha256 hex, or legacy argon2id
                (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*') OR hash GLOB '$argon2id$*'),
  prefix      TEXT NOT NULL CHECK (length(prefix) BETWEEN 4 AND 16),
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  tools_all   INTEGER NOT NULL DEFAULT 1 CHECK (tools_all IN (0,1)),  -- "tools": "*"
  created_at  INTEGER NOT NULL,
  grace_until INTEGER,                                    -- key roll grace period
  deleted_at  INTEGER,                                    -- trash (api_keys_deleted)
  CHECK (deleted_at IS NULL OR deleted_at >= created_at)
) STRICT;
CREATE INDEX api_key_live ON api_key(hash) WHERE deleted_at IS NULL;

CREATE TABLE api_key_scope (
  key_id TEXT NOT NULL REFERENCES api_key(id) ON DELETE CASCADE,
  scope  TEXT NOT NULL CHECK (scope IN ('mcp','read','write','admin')),
  PRIMARY KEY (key_id, scope)
) STRICT, WITHOUT ROWID;

CREATE TABLE api_key_tool (                    -- only meaningful when tools_all = 0
  key_id    TEXT NOT NULL REFERENCES api_key(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL REFERENCES tool(name) ON UPDATE CASCADE,
  PRIMARY KEY (key_id, tool_name)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER api_key_tool_requires_list BEFORE INSERT ON api_key_tool
WHEN (SELECT tools_all FROM api_key WHERE id = NEW.key_id) = 1
BEGIN SELECT RAISE(ABORT, 'api_key_tool: key has tools_all = 1'); END;
CREATE TRIGGER api_key_tools_all_clears AFTER UPDATE OF tools_all ON api_key
WHEN NEW.tools_all = 1 BEGIN DELETE FROM api_key_tool WHERE key_id = NEW.id; END;

-- key-usage.json; separate table so the usage flush never touches api_key
-- (and never bumps the "keys" revision).
CREATE TABLE api_key_usage (
  key_id    TEXT PRIMARY KEY REFERENCES api_key(id) ON DELETE CASCADE,
  last_used INTEGER NOT NULL,
  last_ip   TEXT CHECK (last_ip IS NULL OR length(last_ip) <= 45),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0)
) STRICT;

-- KeyTracker events (memory-only before). Batched inserts, retention 30 days.
CREATE TABLE api_key_event (
  id     INTEGER PRIMARY KEY,
  key_id TEXT NOT NULL REFERENCES api_key(id) ON DELETE CASCADE,
  at     INTEGER NOT NULL,
  ip     TEXT CHECK (ip IS NULL OR length(ip) <= 45),
  tool   TEXT NOT NULL CHECK (length(tool) BETWEEN 1 AND 64),  -- no FK: also HTTP route names
  path   TEXT CHECK (path IS NULL OR length(path) <= 1024)
) STRICT;
CREATE INDEX api_key_event_key_at ON api_key_event(key_id, at DESC);
CREATE INDEX api_key_event_key_ip ON api_key_event(key_id, ip);   -- is_new_ip()
CREATE INDEX api_key_event_at     ON api_key_event(at);            -- retention

-- Browser sessions. The cookie value is never stored: sid_hash = sha256(sid) hex.
-- The CLI identifies sessions by an 8+ char prefix of sid_hash.
CREATE TABLE session (
  sid_hash   TEXT PRIMARY KEY CHECK (length(sid_hash) = 64 AND sid_hash NOT GLOB '*[^0-9a-f]*'),
  owner_id   INTEGER NOT NULL DEFAULT 1 REFERENCES owner(id) ON DELETE CASCADE,
  source     TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 32),
  alias      TEXT CHECK (alias IS NULL OR length(alias) <= 64),
  ip         TEXT CHECK (ip IS NULL OR length(ip) <= 45),
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL CHECK (last_seen >= created_at)
) STRICT, WITHOUT ROWID;
CREATE INDEX session_last_seen ON session(last_seen);

-- Arm window + LOCKED + last burned window (arm.json, lock.json, arm-burned.json): one row
-- whose shape is validated per state, so "armed without a code" cannot exist.
CREATE TABLE arm_state (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  state       TEXT NOT NULL CHECK (state IN ('idle','armed','locked')),
  mode        TEXT CHECK (mode IN ('bootstrap','reset')),
  armed_at    INTEGER,
  ttl         INTEGER CHECK (ttl BETWEEN 30 AND 86400),
  code_hash   TEXT CHECK (code_hash IS NULL OR (length(code_hash) = 64 AND code_hash NOT GLOB '*[^0-9a-f]*')),
  locked_at   INTEGER,
  burned_at   INTEGER, burned_ip TEXT, burned_mode TEXT CHECK (burned_mode IN ('bootstrap','reset')),
  CHECK (state <> 'armed'  OR (mode IS NOT NULL AND armed_at IS NOT NULL AND ttl IS NOT NULL AND code_hash IS NOT NULL)),
  CHECK (state =  'armed'  OR code_hash IS NULL),            -- code dies with the window
  CHECK (state <> 'locked' OR locked_at IS NOT NULL),
  CHECK ((burned_at IS NULL) = (burned_ip IS NULL))
) STRICT;
INSERT INTO arm_state (id, state) VALUES (1, 'idle');

-- access_stack.json: ordered rules + default action.
CREATE TABLE access_policy (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  default_allow INTEGER NOT NULL DEFAULT 1 CHECK (default_allow IN (0,1))
) STRICT;
INSERT INTO access_policy (id) VALUES (1);
CREATE TABLE access_rule (
  id       TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 40),
  position INTEGER NOT NULL UNIQUE CHECK (position >= 0),    -- evaluation order
  kind     TEXT NOT NULL CHECK (kind IN ('ip','range','cidr','domain','all')),
  value    TEXT NOT NULL CHECK (length(value) <= 255),
  action   TEXT NOT NULL CHECK (action IN ('allow','block')),
  enabled  INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  note     TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  CHECK (kind = 'all' OR length(value) > 0)
) STRICT;

-- activity.jsonl. Event names stay open (Rust enum is the source), but shaped.
CREATE TABLE activity (
  id     INTEGER PRIMARY KEY,
  at     INTEGER NOT NULL,
  event  TEXT NOT NULL CHECK (length(event) BETWEEN 1 AND 48 AND event NOT GLOB '*[^a-z0-9_]*'),
  ip     TEXT CHECK (ip IS NULL OR length(ip) <= 45),
  actor  TEXT CHECK (actor IS NULL OR length(actor) <= 64),   -- username or key id or 'cli'
  detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 2000)
) STRICT;
CREATE INDEX activity_at    ON activity(at DESC);
CREATE INDEX activity_event ON activity(event, at DESC);

-- Requests from memora-cli to the running server, for state that lives in server memory.
CREATE TABLE control_request (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('limiter_reset','reload_all')),
  requested_at INTEGER NOT NULL,
  requested_by TEXT NOT NULL CHECK (length(requested_by) BETWEEN 1 AND 64),
  done_at      INTEGER,
  result       TEXT CHECK (result IS NULL OR length(result) <= 500)
) STRICT;
CREATE INDEX control_request_pending ON control_request(id) WHERE done_at IS NULL;

-- Change notification: one counter per cache domain, bumped by triggers, so no code path
-- can forget to signal a change. Created last, so the seed rows above start at rev 0.
-- (session, activity, usage, events, control_request: no revision; read from the DB directly.)
CREATE TABLE revision (
  domain TEXT PRIMARY KEY CHECK (domain IN ('auth','keys','tools','access','settings','arm')),
  rev    INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO revision(domain) VALUES ('auth'),('keys'),('tools'),('access'),('settings'),('arm');

-- One trigger per (table, INSERT|UPDATE|DELETE). Mapping (kept in sync with
-- migrate::REVISION_TRIGGERS, checked by a test):
-- owner->auth; api_key, api_key_scope, api_key_tool->keys; tool_disabled->tools;
-- access_policy, access_rule->access; settings, server_config->settings; arm_state->arm.
CREATE TRIGGER owner_rev_i AFTER INSERT ON owner
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'auth'; END;
CREATE TRIGGER owner_rev_u AFTER UPDATE ON owner
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'auth'; END;
CREATE TRIGGER owner_rev_d AFTER DELETE ON owner
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'auth'; END;
CREATE TRIGGER api_key_rev_i AFTER INSERT ON api_key
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'keys'; END;
CREATE TRIGGER api_key_rev_u AFTER UPDATE ON api_key
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'keys'; END;
CREATE TRIGGER api_key_rev_d AFTER DELETE ON api_key
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'keys'; END;
CREATE TRIGGER api_key_scope_rev_i AFTER INSERT ON api_key_scope
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'keys'; END;
CREATE TRIGGER api_key_scope_rev_u AFTER UPDATE ON api_key_scope
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'keys'; END;
CREATE TRIGGER api_key_scope_rev_d AFTER DELETE ON api_key_scope
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'keys'; END;
CREATE TRIGGER api_key_tool_rev_i AFTER INSERT ON api_key_tool
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'keys'; END;
CREATE TRIGGER api_key_tool_rev_u AFTER UPDATE ON api_key_tool
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'keys'; END;
CREATE TRIGGER api_key_tool_rev_d AFTER DELETE ON api_key_tool
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'keys'; END;
CREATE TRIGGER tool_disabled_rev_i AFTER INSERT ON tool_disabled
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'tools'; END;
CREATE TRIGGER tool_disabled_rev_u AFTER UPDATE ON tool_disabled
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'tools'; END;
CREATE TRIGGER tool_disabled_rev_d AFTER DELETE ON tool_disabled
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'tools'; END;
CREATE TRIGGER access_policy_rev_i AFTER INSERT ON access_policy
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'access'; END;
CREATE TRIGGER access_policy_rev_u AFTER UPDATE ON access_policy
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'access'; END;
CREATE TRIGGER access_policy_rev_d AFTER DELETE ON access_policy
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'access'; END;
CREATE TRIGGER access_rule_rev_i AFTER INSERT ON access_rule
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'access'; END;
CREATE TRIGGER access_rule_rev_u AFTER UPDATE ON access_rule
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'access'; END;
CREATE TRIGGER access_rule_rev_d AFTER DELETE ON access_rule
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'access'; END;
CREATE TRIGGER settings_rev_i AFTER INSERT ON settings
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'settings'; END;
CREATE TRIGGER settings_rev_u AFTER UPDATE ON settings
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'settings'; END;
CREATE TRIGGER settings_rev_d AFTER DELETE ON settings
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'settings'; END;
CREATE TRIGGER server_config_rev_i AFTER INSERT ON server_config
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'settings'; END;
CREATE TRIGGER server_config_rev_u AFTER UPDATE ON server_config
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'settings'; END;
CREATE TRIGGER server_config_rev_d AFTER DELETE ON server_config
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'settings'; END;
CREATE TRIGGER arm_state_rev_i AFTER INSERT ON arm_state
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'arm'; END;
CREATE TRIGGER arm_state_rev_u AFTER UPDATE ON arm_state
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'arm'; END;
CREATE TRIGGER arm_state_rev_d AFTER DELETE ON arm_state
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'arm'; END;
