-- Migration 4: OAuth 2.1 for remote MCP clients (Claude, ChatGPT, ...). A client is
-- registered dynamically (RFC 7591, kind 'dcr'), by its client metadata document
-- URL (kind 'cimd'), or by the owner (kind 'manual'). Every authorized connection
-- becomes an ordinary API key (the access token), so permissions, colors, activity
-- and revocation work as for any agent; `oauth_grant` holds the refresh token.
CREATE TABLE oauth_client (
  client_id     TEXT PRIMARY KEY CHECK (length(client_id) BETWEEN 8 AND 512),
  name          TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 200),
  redirect_uris TEXT NOT NULL CHECK (json_valid(redirect_uris) AND json_type(redirect_uris) = 'array'),
  kind          TEXT NOT NULL CHECK (kind IN ('dcr', 'cimd', 'manual')),
  created_at    INTEGER NOT NULL,
  fetched_at    INTEGER
) STRICT;

-- One-time authorization codes (sha256 of the code), PKCE S256 only, short-lived.
CREATE TABLE oauth_code (
  code_hash    TEXT PRIMARY KEY CHECK (length(code_hash) = 64),
  client_id    TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  challenge    TEXT NOT NULL CHECK (length(challenge) BETWEEN 43 AND 128),
  resource     TEXT,
  user         TEXT NOT NULL,
  expires_at   INTEGER NOT NULL
) STRICT;

-- Refresh tokens (sha256), one per live connection; rotated on every use.
CREATE TABLE oauth_grant (
  refresh_hash TEXT PRIMARY KEY CHECK (length(refresh_hash) = 64),
  key_id       TEXT NOT NULL REFERENCES api_key(id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL,
  created_at   INTEGER NOT NULL
) STRICT;
CREATE INDEX oauth_grant_key ON oauth_grant(key_id);
