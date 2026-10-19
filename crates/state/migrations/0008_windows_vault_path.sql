-- Migration 8: accept Windows absolute vault paths.
--
-- settings.vault_path only allowed paths starting with '/', so a server on Windows could
-- never store its vault. SQLite cannot change a CHECK in place, so the one-row table is
-- rebuilt with the same columns and data, and its revision triggers are recreated.
-- Accepted now: '/...' (Unix), 'C:\...' or 'C:/...' (drive), '\\server\share...' (UNC).
-- Relative paths are still refused.
CREATE TABLE settings_new (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  realm            TEXT    NOT NULL DEFAULT 'Memora' CHECK (length(realm) BETWEEN 1 AND 64),
  session_ttl      INTEGER NOT NULL DEFAULT 10800 CHECK (session_ttl BETWEEN 300 AND 2592000),
  session_max_age  INTEGER NOT NULL DEFAULT 0     CHECK (session_max_age = 0 OR session_max_age >= session_ttl),
  min_password_len INTEGER NOT NULL DEFAULT 10    CHECK (min_password_len BETWEEN 10 AND 256),
  vault_path       TEXT CHECK (vault_path IS NULL OR (length(vault_path) BETWEEN 1 AND 4096
                                                      AND (vault_path GLOB '/*'
                                                           OR vault_path GLOB '[A-Za-z]:[\/]*'
                                                           OR vault_path GLOB '\\?*'))),
  updated_at       INTEGER NOT NULL,
  log_max_mb       INTEGER NOT NULL DEFAULT 8 CHECK (log_max_mb BETWEEN 1 AND 512),
  log_max_days     INTEGER NOT NULL DEFAULT 0 CHECK (log_max_days BETWEEN 0 AND 3650)
) STRICT;

INSERT INTO settings_new (id, realm, session_ttl, session_max_age, min_password_len,
                          vault_path, updated_at, log_max_mb, log_max_days)
SELECT id, realm, session_ttl, session_max_age, min_password_len,
       vault_path, updated_at, log_max_mb, log_max_days
FROM settings;

DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;

CREATE TRIGGER settings_rev_i AFTER INSERT ON settings
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'settings'; END;
CREATE TRIGGER settings_rev_u AFTER UPDATE ON settings
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'settings'; END;
CREATE TRIGGER settings_rev_d AFTER DELETE ON settings
BEGIN UPDATE revision SET rev = rev + 1 WHERE domain = 'settings'; END;
