//! Instance settings (realm, session lifetimes, password policy, vault), table `settings`
//! (one row, always present). `suggested_vault` stays env-only (it reads `MEMORA_VAULT`,
//! see [`crate::config::effective`]).

use crate::{Error, Result};
use rusqlite::{params, Connection, Transaction};

/// Vault folder used when neither the DB nor `MEMORA_VAULT` names one.
pub const DEFAULT_VAULT: &str = "data";

/// The settings row. Bounds are enforced by the schema (see DDL); the repository
/// validates first to return a readable `Error::Invalid`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Settings {
    /// 1-64 chars. Default `Memora`.
    pub realm: String,
    /// Idle timeout in seconds, 300..=2_592_000. Default 10_800 (3 h).
    pub session_ttl: i64,
    /// Absolute cap in seconds; 0 = none, else >= `session_ttl`.
    pub session_max_age: i64,
    /// 10..=256. Default 10.
    pub min_password_len: i64,
    /// Absolute vault folder; `None` until one is chosen.
    pub vault_path: Option<String>,
    pub updated_at: i64,
}

/// Partial update; `None` fields are left unchanged.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SettingsPatch {
    pub realm: Option<String>,
    pub session_ttl: Option<i64>,
    pub session_max_age: Option<i64>,
    pub min_password_len: Option<i64>,
}

/// Bounds mirrored from the DDL, for readable errors before the CHECK fires.
pub const REALM_MAX: usize = 64;
pub const SESSION_TTL_RANGE: std::ops::RangeInclusive<i64> = 300..=2_592_000;
pub const MIN_PASSWORD_LEN_RANGE: std::ops::RangeInclusive<i64> = 10..=256;
pub const VAULT_PATH_MAX: usize = 4096;

pub fn get(conn: &Connection) -> Result<Settings> {
    Ok(conn.query_row(
        "SELECT realm, session_ttl, session_max_age, min_password_len, vault_path, updated_at
         FROM settings WHERE id = 1",
        [],
        |r| {
            Ok(Settings {
                realm: r.get(0)?,
                session_ttl: r.get(1)?,
                session_max_age: r.get(2)?,
                min_password_len: r.get(3)?,
                vault_path: r.get(4)?,
                updated_at: r.get(5)?,
            })
        },
    )?)
}

/// Apply `patch` (bumps the `settings` revision); returns the new row. Every field is
/// validated against the merged result (`session_max_age` is 0 or >= `session_ttl`);
/// nothing is written when any field is invalid.
pub fn update(tx: &Transaction<'_>, patch: &SettingsPatch, now: i64) -> Result<Settings> {
    let mut s = get(tx)?;
    if let Some(realm) = &patch.realm {
        let realm = realm.trim();
        let n = realm.chars().count();
        if n == 0 || n > REALM_MAX || realm.chars().any(char::is_control) {
            return Err(Error::invalid("realm", "1-64 printable characters"));
        }
        s.realm = realm.to_string();
    }
    if let Some(ttl) = patch.session_ttl {
        if !SESSION_TTL_RANGE.contains(&ttl) {
            return Err(Error::invalid("session_ttl", "300-2592000 seconds"));
        }
        s.session_ttl = ttl;
    }
    if let Some(max_age) = patch.session_max_age {
        s.session_max_age = max_age;
    }
    if s.session_max_age != 0 && s.session_max_age < s.session_ttl {
        return Err(Error::invalid(
            "session_max_age",
            format!("0 (no cap) or at least session_ttl ({})", s.session_ttl),
        ));
    }
    if let Some(len) = patch.min_password_len {
        if !MIN_PASSWORD_LEN_RANGE.contains(&len) {
            return Err(Error::invalid("min_password_len", "10-256"));
        }
        s.min_password_len = len;
    }
    tx.execute(
        "UPDATE settings SET realm = ?1, session_ttl = ?2, session_max_age = ?3,
           min_password_len = ?4, updated_at = ?5 WHERE id = 1",
        params![
            s.realm,
            s.session_ttl,
            s.session_max_age,
            s.min_password_len,
            now
        ],
    )?;
    s.updated_at = now;
    Ok(s)
}

/// The configured vault folder. `None` means no vault has been chosen yet: the server then
/// serves only the account and settings surface.
pub fn configured_vault(conn: &Connection) -> Result<Option<String>> {
    Ok(
        conn.query_row("SELECT vault_path FROM settings WHERE id = 1", [], |r| {
            r.get(0)
        })?,
    )
}

/// Set or clear the vault folder. Must be absolute; surrounding whitespace is trimmed and
/// an empty path clears it like `None`.
pub fn set_vault(tx: &Transaction<'_>, path: Option<&str>, now: i64) -> Result<()> {
    let path = path.map(str::trim).filter(|p| !p.is_empty());
    if let Some(p) = path {
        if !p.starts_with('/') {
            return Err(Error::invalid(
                "vault_path",
                format!("{p} is not an absolute path"),
            ));
        }
        if p.len() > VAULT_PATH_MAX || p.contains('\0') {
            return Err(Error::invalid("vault_path", "too long or contains NUL"));
        }
    }
    tx.execute(
        "UPDATE settings SET vault_path = ?1, updated_at = ?2 WHERE id = 1",
        params![path, now],
    )?;
    Ok(())
}

/// The vault folder offered as the default when choosing one: effective `MEMORA_VAULT` (a
/// `server_config` row, else the process environment), trimmed, `None` when unset or empty.
pub fn suggested_vault(conn: &Connection) -> Result<Option<String>> {
    Ok(crate::config::effective(conn, "MEMORA_VAULT")?
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty()))
}

/// DB vault, else `MEMORA_VAULT` (a `server_config` row, else the process environment),
/// else [`DEFAULT_VAULT`].
pub fn resolve_vault(conn: &Connection) -> Result<String> {
    if let Some(v) = configured_vault(conn)? {
        return Ok(v);
    }
    Ok(suggested_vault(conn)?.unwrap_or_else(|| DEFAULT_VAULT.to_string()))
}

/// Vault event log limits: `(max_mb, max_days)`; days 0 = keep by size only.
pub fn log_limits(conn: &Connection) -> Result<(i64, i64)> {
    Ok(conn.query_row(
        "SELECT log_max_mb, log_max_days FROM settings WHERE id = 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}

pub const LOG_MAX_MB_RANGE: std::ops::RangeInclusive<i64> = 1..=512;
pub const LOG_MAX_DAYS_RANGE: std::ops::RangeInclusive<i64> = 0..=3650;

/// Set the event log limits (bumps the `settings` revision).
pub fn set_log_limits(
    tx: &Transaction<'_>,
    max_mb: i64,
    max_days: i64,
    now: i64,
) -> Result<(i64, i64)> {
    if !LOG_MAX_MB_RANGE.contains(&max_mb) {
        return Err(Error::invalid("log_max_mb", "1-512 MB"));
    }
    if !LOG_MAX_DAYS_RANGE.contains(&max_days) {
        return Err(Error::invalid("log_max_days", "0 (no limit) to 3650 days"));
    }
    tx.execute(
        "UPDATE settings SET log_max_mb = ?1, log_max_days = ?2, updated_at = ?3 WHERE id = 1",
        params![max_mb, max_days, now],
    )?;
    Ok((max_mb, max_days))
}
