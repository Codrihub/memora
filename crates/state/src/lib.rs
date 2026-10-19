//! `memora-state`: the SQLite state database behind the Memora server and CLI.
//!
//! Design and contract: `docs/DATABASE.md`. One file, `<MEMORA_STATE>/memora.db`, in WAL
//! mode, opened directly by both the server and `memora-cli`. No SQL lives outside this
//! crate: other crates call the typed repository modules below.
//!
//! Layout:
//! * [`db`]: [`Db`] open / pragmas / permissions, [`Db::write`] (`BEGIN IMMEDIATE`),
//!   [`Db::read`].
//! * [`migrate`]: `PRAGMA user_version` migration runner.
//! * [`watch`]: cross-process change detection ([`Db::changed_domains`]).
//! * Repositories, one module per table group. Write functions take a
//!   `&rusqlite::Transaction` so they can only run inside [`Db::write`] and compose into one
//!   atomic transaction; read functions take a `&rusqlite::Connection` (a transaction
//!   derefs to one, so reads also work inside a write).
//!
//! Secrets never reach this crate in plaintext: callers pass sha256 / argon2id hashes
//! (session ids, API keys, setup codes, passwords). The only hashing done here is sha256
//! in the [`legacy`] import (legacy session ids, file fingerprints).
//!
//! Threading: [`Db`] is `Clone + Send + Sync` (connections behind mutexes). Calls block for
//! microseconds up to `busy_timeout` (5 s) when another process holds the write lock, so
//! async code should call it from `tokio::task::spawn_blocking`.

pub mod db;
pub mod migrate;
pub mod watch;

// Repository modules.
pub mod access;
pub mod activity;
pub mod arm;
pub mod config;
pub mod control;
pub mod keys;
pub mod legacy;
pub mod oauth;
pub mod owner;
pub mod pins;
pub mod privacy;
pub mod retention;
pub mod session;
pub mod settings;
pub mod tools;
pub mod ui_layout;
pub mod usage;

pub use db::{Db, DB_FILE};
pub use migrate::{APPLICATION_ID, SCHEMA_VERSION};
pub use rusqlite::{Connection, Transaction};

use std::fmt;
use std::str::FromStr;

/// Errors from the state database and its repositories.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// SQLite error, including constraint violations (the schema is the backstop for
    /// invalid data, see [`Error::is_constraint`]).
    #[error("state database: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("state database I/O: {0}")]
    Io(#[from] std::io::Error),
    /// The file is an SQLite database but not a Memora one (wrong `application_id`, or
    /// tables without the Memora id).
    #[error("{path} is not a Memora state database (application_id {found:#x})")]
    ForeignFile { path: String, found: i64 },
    /// The database was written by a newer Memora (schema `found` > `supported`).
    #[error(
        "state database schema version {found} is newer than this binary supports ({supported}); \
         downgrade: restore the backup taken before upgrading"
    )]
    TooNew { found: i64, supported: i64 },
    /// Input rejected by the repository layer before reaching SQL (bad username, CIDR, ...).
    #[error("invalid {field}: {reason}")]
    Invalid { field: &'static str, reason: String },
    /// A row the caller named does not exist (key id, session prefix, ...).
    #[error("{0} not found")]
    NotFound(String),
    /// The operation conflicts with the current state (e.g. arming while locked, an
    /// ambiguous session prefix).
    #[error("{0}")]
    Conflict(String),
}

impl Error {
    /// True when SQLite rejected the write because of a CHECK / UNIQUE / FK / NOT NULL
    /// constraint or a `RAISE(ABORT)` trigger.
    pub fn is_constraint(&self) -> bool {
        matches!(
            self,
            Error::Sqlite(rusqlite::Error::SqliteFailure(e, _))
                if e.code == rusqlite::ErrorCode::ConstraintViolation
        )
    }

    /// Shorthand for [`Error::Invalid`].
    pub fn invalid(field: &'static str, reason: impl Into<String>) -> Self {
        Error::Invalid {
            field,
            reason: reason.into(),
        }
    }
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// A cache domain with its own revision counter (table `revision`). Bumped by triggers
/// whenever a table of that domain changes; see [`Db::changed_domains`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Domain {
    /// `owner`.
    Auth,
    /// `api_key`, `api_key_scope`, `api_key_tool`.
    Keys,
    /// `tool_disabled`.
    Tools,
    /// `access_policy`, `access_rule`.
    Access,
    /// `settings`, `server_config`.
    Settings,
    /// `arm_state`.
    Arm,
}

impl Domain {
    pub const ALL: [Domain; 6] = [
        Domain::Auth,
        Domain::Keys,
        Domain::Tools,
        Domain::Access,
        Domain::Settings,
        Domain::Arm,
    ];

    /// The `revision.domain` value.
    pub fn as_str(self) -> &'static str {
        match self {
            Domain::Auth => "auth",
            Domain::Keys => "keys",
            Domain::Tools => "tools",
            Domain::Access => "access",
            Domain::Settings => "settings",
            Domain::Arm => "arm",
        }
    }
}

impl fmt::Display for Domain {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Domain {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self> {
        Domain::ALL
            .into_iter()
            .find(|d| d.as_str() == s)
            .ok_or_else(|| Error::invalid("domain", s.to_string()))
    }
}

/// Current unix time in seconds (UTC), the unit of every time column.
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Whether `p` is an absolute folder path as `settings.vault_path` stores it: `/...`
/// everywhere, plus `C:\...` and `\\server\share` on Windows.
pub fn is_absolute_path(p: &str) -> bool {
    p.starts_with('/') || std::path::Path::new(p).is_absolute()
}

/// `canonicalize`, but on Windows without the `\\?\` prefix it adds to local
/// drive paths, so stored and printed paths stay readable and usable by other
/// tools (git). UNC paths keep their verbatim form.
pub fn canonical_path(p: &std::path::Path) -> std::io::Result<std::path::PathBuf> {
    let c = p.canonicalize()?;
    #[cfg(windows)]
    if let Some(s) = c.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        if !s.starts_with(r"UNC\") {
            return Ok(std::path::PathBuf::from(s));
        }
    }
    Ok(c)
}

/// Constant-time byte comparison for hash checks done in Rust (setup codes).
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_roundtrip() {
        for d in Domain::ALL {
            assert_eq!(d.as_str().parse::<Domain>().unwrap(), d);
        }
        assert!("nope".parse::<Domain>().is_err());
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }

    #[test]
    fn canonical_paths_are_plain_and_absolute() {
        let tmp = std::env::temp_dir();
        let c = canonical_path(&tmp).unwrap();
        assert!(c.is_absolute());
        assert!(!c.to_string_lossy().starts_with(r"\\?\"));
        assert!(is_absolute_path(&c.to_string_lossy()));
        assert!(canonical_path(&tmp.join("memora-no-such-dir-x7")).is_err());
    }
}
