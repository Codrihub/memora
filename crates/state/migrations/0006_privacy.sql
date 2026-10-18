-- Migration 6: per-agent privacy rules for vault folders and notes ("nodes").
--
-- A rule hides one vault path from agents (API keys, OAuth connections are keys too):
--   kind 'folder': the folder itself and everything below it (path without a trailing /);
--   kind 'node'  : one note (path including its .md extension).
--   mode 'deny'       : hidden from the keys listed in privacy_rule_key;
--   mode 'allow_only' : hidden from every key NOT listed (also from keys created later).
-- Rules add up: a path is hidden from a key when ANY rule covering it hides it. The
-- signed-in owner always sees everything. Paths are vault-relative and normalized by
-- memora_state::privacy::normalize_path; matching is case-insensitive.
-- Several rows may share (kind, path) after a rename onto a path that had a rule; they
-- simply add up. No revision trigger: rules are read per agent request.
-- IF NOT EXISTS keeps a re-run harmless.
CREATE TABLE IF NOT EXISTS privacy_rule (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('folder', 'node')),
  path       TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 1024
                                  AND path NOT GLOB '/*' AND path NOT GLOB '*/'),
  mode       TEXT NOT NULL CHECK (mode IN ('deny', 'allow_only')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS privacy_rule_path ON privacy_rule(path COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS privacy_rule_key (
  rule_id INTEGER NOT NULL REFERENCES privacy_rule(id) ON DELETE CASCADE,
  key_id  TEXT NOT NULL REFERENCES api_key(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, key_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS privacy_rule_key_key ON privacy_rule_key(key_id);

-- Former paths of a rule (before renames / moves), at most 64 per rule. Only used to
-- keep event and log lines that name the protected item under an old path away from
-- the agents the rule hides it from; they never hide a file that lives there now.
CREATE TABLE IF NOT EXISTS privacy_trail (
  rule_id INTEGER NOT NULL REFERENCES privacy_rule(id) ON DELETE CASCADE,
  path    TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 1024),
  PRIMARY KEY (rule_id, path)
) STRICT;
