-- Migration 3: an optional display color per API key (#rrggbb, lowercase), so agents
-- with the same name stay apart in every activity view (set from the dashboard, the
-- REST API or the MCP tool `set_my_color`); and the size / age limits of the vault
-- event log (.events.jsonl), set in Settings.
ALTER TABLE api_key ADD COLUMN color TEXT
  CHECK (color IS NULL OR (length(color) = 7 AND color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'));
ALTER TABLE settings ADD COLUMN log_max_mb INTEGER NOT NULL DEFAULT 8 CHECK (log_max_mb BETWEEN 1 AND 512);
ALTER TABLE settings ADD COLUMN log_max_days INTEGER NOT NULL DEFAULT 0 CHECK (log_max_days BETWEEN 0 AND 3650);
