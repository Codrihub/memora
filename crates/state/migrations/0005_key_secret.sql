-- Migration 5: an encrypted copy of API keys created or rolled from the dashboard, so
-- the owner can show the key again (after re-entering the password) to fill in
-- connection guides. `sealed` is base64url(nonce || ChaCha20-Poly1305 ciphertext)
-- under a master key kept in the state folder (key-seal.bin), never in this database.
CREATE TABLE api_key_secret (
  key_id TEXT PRIMARY KEY REFERENCES api_key(id) ON DELETE CASCADE,
  sealed TEXT NOT NULL CHECK (length(sealed) BETWEEN 40 AND 400)
) STRICT, WITHOUT ROWID;
