//! Server configuration (table `server_config`) and environment provisioning.
//!
//! Precedence: DB row > process env > default. Provisioning secrets
//! (`MEMORA_ADMIN_PASSWORD`, `MEMORA_API_KEY`) are not storable (schema CHECK); they are
//! consumed into hashes by [`provision`].

use crate::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};

/// Keys `server_config` accepts, in display order, with the help text shown by the CLI.
/// Mirrors the CHECK in the DDL (`MEMORA_ADMIN_PASSWORD` and `MEMORA_API_KEY` are absent
/// on purpose).
pub const CONFIG_KEYS: &[(&str, &str)] = &[
    ("MEMORA_PORT", "HTTP port (API, MCP, web UI and realtime share it)"),
    ("MEMORA_BIND", "Bind address: 0.0.0.0 for every interface, 127.0.0.1 behind a local proxy"),
    ("MEMORA_BASE_URL", "Public URL, e.g. https://memory.example.com (its host is also an allowed domain)"),
    ("MEMORA_DOMAIN", "Allowed hostnames, comma separated (*.example.com works); other hosts get 404. Empty: any host"),
    ("MEMORA_TRUSTED_PROXIES", "IPs of reverse proxies whose X-Forwarded-For is trusted (loopback always is)"),
    ("MEMORA_ARM_TTL", "Default setup / reset window length in seconds"),
    ("MEMORA_VAULT", "Suggested vault folder (in Docker: the mounted volume, e.g. /data)"),
    ("MEMORA_VAULT_AUTO", "true: use MEMORA_VAULT right away instead of asking in the browser"),
    ("MEMORA_ADMIN_USER", "Owner created at startup when no owner exists (needs MEMORA_ADMIN_PASSWORD)"),
    ("RUST_LOG", "Log filter, e.g. info or memora=debug"),
];

/// Environment variables that are never stored (consumed once into hashes).
pub const SECRET_ENV_KEYS: &[&str] = &["MEMORA_ADMIN_PASSWORD", "MEMORA_API_KEY"];

/// One `server_config` row.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ConfigEntry {
    pub key: String,
    pub value: String,
    pub updated_at: i64,
}

/// True for keys in [`CONFIG_KEYS`].
pub fn is_known_key(key: &str) -> bool {
    CONFIG_KEYS.iter().any(|(k, _)| *k == key)
}

/// Maximum stored value length (schema CHECK).
pub const VALUE_MAX: usize = 2048;

/// Built-in default of `key`, used by [`effective`] when neither a row nor the process
/// environment sets it (same defaults as the server's `env_or` calls).
pub fn default_value(key: &str) -> Option<&'static str> {
    match key {
        "MEMORA_PORT" => Some("8400"),
        "MEMORA_BIND" => Some("127.0.0.1"),
        "MEMORA_ARM_TTL" => Some("300"),
        "MEMORA_VAULT_AUTO" => Some("false"),
        "MEMORA_ADMIN_USER" => Some("admin"),
        _ => None,
    }
}

/// Validate and normalise `value` for `key` (trimmed; `MEMORA_VAULT_AUTO` accepts
/// 1/true/yes/on and 0/false/no/off and is stored as `true` / `false`).
/// `Error::Invalid` for unknown keys, provisioning secrets and bad values.
pub fn validate(key: &str, value: &str) -> Result<String> {
    check_key(key)?;
    let v = value.trim();
    if v.len() > VALUE_MAX {
        return Err(Error::invalid(
            "config value",
            format!("{key}: longer than {VALUE_MAX} bytes"),
        ));
    }
    if v.chars().any(char::is_control) {
        return Err(Error::invalid(
            "config value",
            format!("{key}: control characters are not allowed"),
        ));
    }
    let number = |lo: i64, hi: i64| -> Result<String> {
        match v.parse::<i64>() {
            Ok(n) if v.bytes().all(|b| b.is_ascii_digit()) && (lo..=hi).contains(&n) => {
                Ok(n.to_string())
            }
            _ => Err(Error::invalid(
                "config value",
                format!("{key}: a number from {lo} to {hi}"),
            )),
        }
    };
    match key {
        "MEMORA_PORT" => number(1, 65535),
        "MEMORA_ARM_TTL" => number(30, 86400),
        "MEMORA_VAULT_AUTO" => match v.to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Ok("true".into()),
            "0" | "false" | "no" | "off" => Ok("false".into()),
            _ => Err(Error::invalid(
                "config value",
                format!("{key}: true or false"),
            )),
        },
        "MEMORA_ADMIN_USER" => crate::owner::normalize_username(v),
        _ => Ok(v.to_string()),
    }
}

/// `Error::Invalid` unless `key` is in [`CONFIG_KEYS`]; secrets get their own message.
pub fn check_key(key: &str) -> Result<()> {
    if SECRET_ENV_KEYS.contains(&key) {
        return Err(Error::invalid(
            "config key",
            format!("{key} is a secret and is never stored; set it in the environment"),
        ));
    }
    if !is_known_key(key) {
        return Err(Error::invalid("config key", format!("unknown key {key}")));
    }
    Ok(())
}

/// The stored value of `key`, if any.
pub fn get(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT value FROM server_config WHERE key = ?1",
            [key],
            |r| r.get(0),
        )
        .optional()?)
}

/// Every stored row in [`CONFIG_KEYS`] order.
pub fn list(conn: &Connection) -> Result<Vec<ConfigEntry>> {
    let mut stmt = conn.prepare("SELECT key, value, updated_at FROM server_config")?;
    let mut rows = stmt
        .query_map([], |r| {
            Ok(ConfigEntry {
                key: r.get(0)?,
                value: r.get(1)?,
                updated_at: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let pos = |k: &str| {
        CONFIG_KEYS
            .iter()
            .position(|(c, _)| *c == k)
            .unwrap_or(usize::MAX)
    };
    rows.sort_by_key(|e| pos(&e.key));
    Ok(rows)
}

/// Set `key` to `value`, or delete the row with `None` / empty. Unknown keys and the
/// secrets in [`SECRET_ENV_KEYS`] -> `Error::Invalid`; values are checked and normalised by
/// [`validate`].
pub fn set(tx: &Transaction<'_>, key: &str, value: Option<&str>, now: i64) -> Result<()> {
    let value = value.map(str::trim).filter(|v| !v.is_empty());
    // The key is checked even when deleting, so typos are reported.
    check_key(key)?;
    match value.map(|v| validate(key, v)).transpose()? {
        Some(v) => tx.execute(
            "INSERT INTO server_config (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
             WHERE value <> excluded.value",
            params![key, v, now],
        )?,
        None => tx.execute("DELETE FROM server_config WHERE key = ?1", [key])?,
    };
    Ok(())
}

/// DB row, else the process environment (non-empty), else [`default_value`].
pub fn effective(conn: &Connection, key: &str) -> Result<Option<String>> {
    if is_known_key(key) {
        if let Some(v) = get(conn, key)?.filter(|v| !v.is_empty()) {
            return Ok(Some(v));
        }
    }
    if let Some(v) = std::env::var(key).ok().filter(|v| !v.trim().is_empty()) {
        return Ok(Some(v));
    }
    Ok(default_value(key).map(str::to_string))
}

/// Export every stored row into the process environment. Call before any thread starts
/// (`std::env::set_var`). Returns the keys applied. A row with an empty value (possible
/// only from an import) removes the variable.
pub fn apply_to_env(conn: &Connection) -> Result<Vec<String>> {
    let mut applied = Vec::new();
    for e in list(conn)? {
        if !is_known_key(&e.key) || e.value.contains('\0') {
            continue;
        }
        if e.value.is_empty() {
            std::env::remove_var(&e.key);
        } else {
            std::env::set_var(&e.key, &e.value);
            applied.push(e.key);
        }
    }
    Ok(applied)
}

/// Inputs for [`provision`], already validated and hashed by the caller (hashing and
/// `EnvConfig` parsing stay in `memora-gateway`). Fields are `None` when the env var is
/// unset or was rejected (too short, invalid name).
#[derive(Debug, Clone, Default)]
pub struct Provision {
    /// `MEMORA_ADMIN_USER` + argon2id hash of `MEMORA_ADMIN_PASSWORD`.
    pub owner: Option<(String, String)>,
    /// sha256 hex + display prefix of `MEMORA_API_KEY`; stored as key
    /// [`ENV_KEY_ID`].
    pub api_key: Option<ProvisionKey>,
    /// `MEMORA_VAULT` when `MEMORA_VAULT_AUTO=true` and the folder is writable.
    pub vault_auto: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProvisionKey {
    pub hash: String,
    pub prefix: String,
}

/// Id of the API key installed from `MEMORA_API_KEY`.
pub const ENV_KEY_ID: &str = "k_env";

/// Apply environment defaults in one transaction. Never overwrites an existing owner or a
/// configured vault; replaces the [`ENV_KEY_ID`] key only when its hash differs. Returns
/// lines for the startup log.
pub fn provision(tx: &Transaction<'_>, input: &Provision, now: i64) -> Result<Vec<String>> {
    let mut done = Vec::new();
    if let Some((user, hash)) = &input.owner {
        match crate::owner::owner_name(tx)? {
            Some(owner) => done.push(format!(
                "MEMORA_ADMIN_PASSWORD ignored: owner {owner} already exists"
            )),
            None => match crate::owner::normalize_username(user) {
                Err(_) => {
                    done.push("MEMORA_ADMIN_USER is not a valid username; no owner created".into())
                }
                Ok(name) => {
                    crate::owner::set_owner(tx, &name, hash, now)?;
                    done.push(format!("owner {name} created from the environment"));
                }
            },
        }
    }
    if let Some(key) = &input.api_key {
        if provision_key(tx, key, now)? {
            done.push("default API key installed from MEMORA_API_KEY".into());
        }
    }
    if let Some(v) = &input.vault_auto {
        if crate::settings::configured_vault(tx)?.is_none() {
            match crate::settings::set_vault(tx, Some(v), now) {
                Ok(()) => done.push(format!("vault set to {} (MEMORA_VAULT_AUTO)", v.trim())),
                Err(Error::Invalid { reason, .. }) => {
                    done.push(format!("MEMORA_VAULT_AUTO: {reason}; vault left unset"))
                }
                Err(e) => return Err(e),
            }
        }
    }
    Ok(done)
}

/// Install or replace the [`ENV_KEY_ID`] key. Returns false when a live key with the
/// same hash is already there. A replaced or trashed key is reset to the defaults
/// (enabled, all tools, scopes mcp/read/write), keeping its usage history.
fn provision_key(tx: &Transaction<'_>, key: &ProvisionKey, now: i64) -> Result<bool> {
    let hash = key.hash.trim().to_ascii_lowercase();
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(Error::invalid("api_key hash", "expected sha256 hex"));
    }
    if !(4..=16).contains(&key.prefix.chars().count()) {
        return Err(Error::invalid("api_key prefix", "4-16 characters"));
    }
    let same: bool = tx
        .query_row(
            "SELECT hash = ?2 AND deleted_at IS NULL FROM api_key WHERE id = ?1",
            params![ENV_KEY_ID, hash],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(false);
    if same {
        return Ok(false);
    }
    tx.execute(
        "INSERT INTO api_key (id, name, hash, prefix, enabled, tools_all, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 1, ?5)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, hash = excluded.hash,
           prefix = excluded.prefix, enabled = 1, tools_all = 1,
           created_at = excluded.created_at, grace_until = NULL, deleted_at = NULL",
        params![ENV_KEY_ID, ENV_KEY_NAME, hash, key.prefix, now],
    )?;
    // A sealed copy from a dashboard roll would now show the wrong key.
    crate::keys::drop_secret(tx, ENV_KEY_ID)?;
    tx.execute("DELETE FROM api_key_scope WHERE key_id = ?1", [ENV_KEY_ID])?;
    for scope in ENV_KEY_SCOPES {
        tx.execute(
            "INSERT INTO api_key_scope (key_id, scope) VALUES (?1, ?2)",
            params![ENV_KEY_ID, scope],
        )?;
    }
    Ok(true)
}

/// Name of the [`ENV_KEY_ID`] key.
pub const ENV_KEY_NAME: &str = "default (MEMORA_API_KEY)";
/// Scopes of the [`ENV_KEY_ID`] key (the default key scopes).
pub const ENV_KEY_SCOPES: [&str; 3] = ["mcp", "read", "write"];
