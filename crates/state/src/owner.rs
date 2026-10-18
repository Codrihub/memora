//! The single owner account, table `owner`.
//!
//! The schema allows at most one row (`id = 1`). Sessions reference `owner_id`, so a
//! rename needs no session update. Passwords arrive as argon2id PHC strings
//! (`$argon2id$...`); hashing stays in `memora-gateway`.

use crate::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};

/// The owner row.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Owner {
    /// Lowercase, 1-32 chars of `[a-z0-9._-]`.
    pub username: String,
    /// argon2id PHC string. Never serialised to clients.
    #[serde(skip)]
    pub password_hash: String,
    pub enabled: bool,
    /// At most 64 chars; the UI shows the username.
    pub display_name: String,
    pub created_at: i64,
    pub password_changed_at: i64,
}

/// Same rule as `memora_gateway::valid_username`, after lowercasing: 1-32 chars of
/// ASCII alphanumerics, `-`, `_`, `.`.
pub fn valid_username(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 32
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Maximum length of [`Owner::display_name`] in characters (schema CHECK).
pub const DISPLAY_NAME_MAX: usize = 64;

/// Lowercase and validate a username; `Error::Invalid` (field `username`) when bad.
pub fn normalize_username(name: &str) -> Result<String> {
    let name = name.trim().to_ascii_lowercase();
    if valid_username(&name) {
        Ok(name)
    } else {
        Err(Error::invalid(
            "username",
            "1-32 characters of a-z, 0-9, '.', '_' or '-'",
        ))
    }
}

fn check_password_hash(hash: &str) -> Result<()> {
    if hash.starts_with("$argon2id$") {
        Ok(())
    } else {
        Err(Error::invalid(
            "password_hash",
            "expected an argon2id PHC string",
        ))
    }
}

fn row_to_owner(r: &rusqlite::Row<'_>) -> rusqlite::Result<Owner> {
    Ok(Owner {
        username: r.get(0)?,
        password_hash: r.get(1)?,
        enabled: r.get::<_, i64>(2)? != 0,
        display_name: r.get(3)?,
        created_at: r.get(4)?,
        password_changed_at: r.get(5)?,
    })
}

/// The owner, if one exists.
pub fn get(conn: &Connection) -> Result<Option<Owner>> {
    Ok(conn
        .query_row(
            "SELECT username, password_hash, enabled, display_name, created_at, password_changed_at
             FROM owner WHERE id = 1",
            [],
            row_to_owner,
        )
        .optional()?)
}

/// Username of the owner, if any.
pub fn owner_name(conn: &Connection) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT username FROM owner WHERE id = 1", [], |r| r.get(0))
        .optional()?)
}

/// Make `username` (lowercased) the one and only account with `password_hash`. Creates the
/// row or replaces username + hash of the existing one; sets `enabled = 1`. Validates with
/// [`valid_username`] first (`Error::Invalid`). When the hash changes, revokes every
/// session (in this same transaction) and records `password_changed_at = now`.
pub fn set_owner(
    tx: &Transaction<'_>,
    username: &str,
    password_hash: &str,
    now: i64,
) -> Result<()> {
    let username = normalize_username(username)?;
    check_password_hash(password_hash)?;
    match get(tx)? {
        None => {
            tx.execute(
                "INSERT INTO owner (id, username, password_hash, enabled, created_at, password_changed_at)
                 VALUES (1, ?1, ?2, 1, ?3, ?3)",
                params![username, password_hash, now],
            )?;
        }
        Some(cur) => {
            let hash_changed = cur.password_hash != password_hash;
            tx.execute(
                "UPDATE owner SET username = ?1, password_hash = ?2, enabled = 1,
                   password_changed_at = CASE WHEN ?3 THEN ?4 ELSE password_changed_at END
                 WHERE id = 1",
                params![username, password_hash, hash_changed, now],
            )?;
            if hash_changed {
                tx.execute("DELETE FROM session", [])?;
            }
        }
    }
    Ok(())
}

/// Password change from the browser: update the hash, delete every session except
/// `keep_sid_hash`, log `password_changed`, all in `tx`. Returns sessions revoked.
/// `Error::NotFound` when there is no owner.
pub fn change_password(
    tx: &Transaction<'_>,
    password_hash: &str,
    keep_sid_hash: Option<&str>,
    ip: Option<&str>,
    now: i64,
) -> Result<usize> {
    check_password_hash(password_hash)?;
    let name = owner_name(tx)?.ok_or_else(|| Error::NotFound("owner".into()))?;
    tx.execute(
        "UPDATE owner SET password_hash = ?1, password_changed_at = ?2 WHERE id = 1",
        params![password_hash, now],
    )?;
    let revoked = match keep_sid_hash {
        Some(keep) => tx.execute("DELETE FROM session WHERE sid_hash <> ?1", [keep])?,
        None => tx.execute("DELETE FROM session", [])?,
    };
    tx.execute(
        "INSERT INTO activity (at, event, ip, actor, detail) VALUES (?1, 'password_changed', ?2, ?3, ?4)",
        params![now, ip, name, format!("{revoked} session(s) signed out")],
    )?;
    Ok(revoked)
}

/// Rename the owner (sessions stay valid). `Error::NotFound` when there is no owner.
pub fn rename(tx: &Transaction<'_>, new_username: &str) -> Result<()> {
    let name = normalize_username(new_username)?;
    expect_owner(tx.execute("UPDATE owner SET username = ?1 WHERE id = 1", [name])?)
}

/// Set the display name (trimmed, at most [`DISPLAY_NAME_MAX`] characters; empty clears).
/// `Error::NotFound` when there is no owner.
pub fn set_display_name(tx: &Transaction<'_>, display_name: &str) -> Result<()> {
    let display_name = display_name.trim();
    if display_name.chars().count() > DISPLAY_NAME_MAX {
        return Err(Error::invalid("display_name", "at most 64 characters"));
    }
    if display_name.chars().any(char::is_control) {
        return Err(Error::invalid(
            "display_name",
            "control characters are not allowed",
        ));
    }
    expect_owner(tx.execute(
        "UPDATE owner SET display_name = ?1 WHERE id = 1",
        [display_name],
    )?)
}

/// Enable or disable sign-in for the owner. `Error::NotFound` when there is no owner.
pub fn set_enabled(tx: &Transaction<'_>, enabled: bool) -> Result<()> {
    expect_owner(tx.execute("UPDATE owner SET enabled = ?1 WHERE id = 1", [enabled])?)
}

fn expect_owner(changed: usize) -> Result<()> {
    if changed == 0 {
        Err(Error::NotFound("owner".into()))
    } else {
        Ok(())
    }
}
