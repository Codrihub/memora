//! Schema migrations on `PRAGMA user_version` (docs/DATABASE.md section 4).
//!
//! Migrations are embedded SQL files. Each is applied in its own `BEGIN IMMEDIATE`
//! transaction together with the `user_version` bump, so a crash leaves either the old or
//! the new schema, and two processes opening a fresh file at once apply it exactly once
//! (the second re-reads `user_version` after acquiring the write lock).

use crate::{Domain, Error, Result};
use rusqlite::{Connection, TransactionBehavior};
use std::path::Path;

/// `PRAGMA application_id` of a Memora state database: ASCII `MEMO`.
pub const APPLICATION_ID: i64 = 0x4D45_4D4F;

/// Migration `n` (1-based) is `MIGRATIONS[n - 1]`. Append only; never edit a released one.
pub const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/0001_init.sql"),
    include_str!("../migrations/0002_ui_layout.sql"),
    include_str!("../migrations/0003_colors_logs.sql"),
    include_str!("../migrations/0004_oauth.sql"),
    include_str!("../migrations/0005_key_secret.sql"),
    include_str!("../migrations/0006_privacy.sql"),
    include_str!("../migrations/0007_pins.sql"),
    include_str!("../migrations/0008_windows_vault_path.sql"),
];

/// The schema version this binary writes (`user_version` after all migrations).
pub const SCHEMA_VERSION: i64 = MIGRATIONS.len() as i64;

/// Tables whose changes bump a [`Domain`] revision (one trigger per INSERT / UPDATE /
/// DELETE, named `<table>_rev_{i,u,d}`). Must match the triggers in the SQL files; a test
/// checks it.
pub const REVISION_TRIGGERS: &[(&str, Domain)] = &[
    ("owner", Domain::Auth),
    ("api_key", Domain::Keys),
    ("api_key_scope", Domain::Keys),
    ("api_key_tool", Domain::Keys),
    ("tool_disabled", Domain::Tools),
    ("access_policy", Domain::Access),
    ("access_rule", Domain::Access),
    ("settings", Domain::Settings),
    ("server_config", Domain::Settings),
    ("arm_state", Domain::Arm),
];

/// `PRAGMA user_version`.
pub fn user_version(conn: &Connection) -> Result<i64> {
    Ok(conn.pragma_query_value(None, "user_version", |r| r.get(0))?)
}

/// Refuse files that are not Memora databases or are newer than this binary.
/// Returns the current `user_version`.
pub(crate) fn check_identity(conn: &Connection, path: &Path) -> Result<i64> {
    let app: i64 = conn.pragma_query_value(None, "application_id", |r| r.get(0))?;
    let version = user_version(conn)?;
    let foreign = || Error::ForeignFile {
        path: path.display().to_string(),
        found: app,
    };
    if app != 0 && app != APPLICATION_ID {
        return Err(foreign());
    }
    if app == 0 {
        // No id yet: only an empty database may become a Memora one.
        let objects: i64 =
            conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0))?;
        if objects > 0 || version != 0 {
            return Err(foreign());
        }
    }
    if version > SCHEMA_VERSION {
        return Err(Error::TooNew {
            found: version,
            supported: SCHEMA_VERSION,
        });
    }
    Ok(version)
}

/// Apply every pending migration. Idempotent; returns how many were applied by this call.
/// `path` is only used in error messages.
pub fn run(conn: &mut Connection, path: &Path) -> Result<usize> {
    // Fast path without the write lock: already current (the usual case).
    if check_identity(conn, path)? == SCHEMA_VERSION {
        return Ok(0);
    }
    let mut applied = 0;
    loop {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Re-check under the write lock: another process may have migrated meanwhile.
        let version = check_identity(&tx, path)?;
        if version >= SCHEMA_VERSION {
            tx.commit()?;
            return Ok(applied);
        }
        let next = version + 1;
        tx.execute_batch(MIGRATIONS[version as usize])?;
        tx.pragma_update(None, "user_version", next)?;
        tx.commit()?;
        applied += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Db;

    #[test]
    fn fresh_db_is_current_and_reopen_is_noop() {
        let db = Db::open_temp().unwrap();
        let dir = db.state_dir().to_path_buf();
        db.read(|c| {
            assert_eq!(user_version(c)?, SCHEMA_VERSION);
            let app: i64 = c.pragma_query_value(None, "application_id", |r| r.get(0))?;
            assert_eq!(app, APPLICATION_ID);
            Ok(())
        })
        .unwrap();
        // Second open of the same file (and a direct second run) applies nothing.
        let again = Db::open(&dir).unwrap();
        let mut conn = Connection::open(again.path()).unwrap();
        assert_eq!(run(&mut conn, again.path()).unwrap(), 0);
        // Seed rows were inserted exactly once.
        let n: i64 = again
            .read(|c| Ok(c.query_row("SELECT count(*) FROM arm_state", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(n, 1);
        // Revisions start at zero: seeding happens before the triggers exist.
        let revs = again.revisions().unwrap();
        assert!(revs.values().all(|r| *r == 0), "{revs:?}");
        assert_eq!(revs.len(), Domain::ALL.len());
    }

    #[test]
    fn revision_triggers_match_table() {
        let db = Db::open_temp().unwrap();
        db.read(|c| {
            let mut stmt = c.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name GLOB '*_rev_*'",
            )?;
            let mut names: Vec<String> = stmt
                .query_map([], |r| r.get(0))?
                .collect::<Result<_, _>>()?;
            names.sort();
            let mut want: Vec<String> = REVISION_TRIGGERS
                .iter()
                .flat_map(|(t, _)| ["i", "u", "d"].map(|op| format!("{t}_rev_{op}")))
                .collect();
            want.sort();
            assert_eq!(names, want);
            // Each trigger bumps the domain the table maps to.
            for (table, domain) in REVISION_TRIGGERS {
                for op in ["i", "u", "d"] {
                    let sql: String = c.query_row(
                        "SELECT sql FROM sqlite_master WHERE name = ?1",
                        [format!("{table}_rev_{op}")],
                        |r| r.get(0),
                    )?;
                    assert!(
                        sql.contains(&format!("domain = '{}'", domain.as_str())),
                        "{table}_rev_{op}: {sql}"
                    );
                }
            }
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn v1_database_upgrades_to_ui_layout() {
        let db = Db::open_temp().unwrap();
        let dir = db.state_dir().join("v1");
        std::fs::create_dir(&dir).unwrap();
        {
            // A database as a schema-1 binary left it, with a row in it.
            let mut c = Connection::open(dir.join(crate::DB_FILE)).unwrap();
            let tx = c.transaction().unwrap();
            tx.execute_batch(MIGRATIONS[0]).unwrap();
            tx.pragma_update(None, "user_version", 1).unwrap();
            tx.execute(
                "INSERT INTO activity (at, event, detail) VALUES (1, 'kept', '')",
                [],
            )
            .unwrap();
            tx.commit().unwrap();
        }
        let up = Db::open(&dir).unwrap();
        up.read(|c| {
            assert_eq!(user_version(c)?, SCHEMA_VERSION);
            // Migration 3 columns exist with their defaults.
            let (mb, days): (i64, i64) = c.query_row(
                "SELECT log_max_mb, log_max_days FROM settings WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            assert_eq!((mb, days), (8, 0));
            let t: i64 = c.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'ui_layout'",
                [],
                |r| r.get(0),
            )?;
            assert_eq!(t, 1);
            // Migration 7: the pins table, empty.
            let pins: i64 = c.query_row("SELECT count(*) FROM pin", [], |r| r.get(0))?;
            assert_eq!(pins, 0);
            let kept: i64 = c.query_row(
                "SELECT count(*) FROM activity WHERE event = 'kept'",
                [],
                |r| r.get(0),
            )?;
            assert_eq!(kept, 1);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn refuses_foreign_and_newer_files() {
        let db = Db::open_temp().unwrap();
        let dir = db.state_dir().to_path_buf();
        // Newer schema than this binary.
        let other = dir.join("newer");
        std::fs::create_dir(&other).unwrap();
        drop(Db::open(&other).unwrap());
        Connection::open(other.join(crate::DB_FILE))
            .unwrap()
            .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        assert!(matches!(Db::open(&other), Err(Error::TooNew { .. })));

        // Some other application's SQLite file.
        let foreign = dir.join("foreign");
        std::fs::create_dir(&foreign).unwrap();
        Connection::open(foreign.join(crate::DB_FILE))
            .unwrap()
            .execute_batch("CREATE TABLE t(x);")
            .unwrap();
        assert!(matches!(Db::open(&foreign), Err(Error::ForeignFile { .. })));

        // Wrong application id.
        let wrong = dir.join("wrong");
        std::fs::create_dir(&wrong).unwrap();
        Connection::open(wrong.join(crate::DB_FILE))
            .unwrap()
            .pragma_update(None, "application_id", 42)
            .unwrap();
        assert!(matches!(
            Db::open(&wrong),
            Err(Error::ForeignFile { found: 42, .. })
        ));
    }
}
