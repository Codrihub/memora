//! Legacy JSON import (docs/DATABASE.md section 4) and the
//! export-json rollback round trip. Fixtures: `tests/fixtures/legacy/<case>/`.

use memora_state::legacy::{
    export_json, import_legacy, ImportStatus, LEGACY_FILES, META_LEGACY_IMPORT,
};
use memora_state::{Db, Error};
use std::path::{Path, PathBuf};

/// A private copy of a fixture directory, removed on drop.
struct Scratch(PathBuf);

impl Scratch {
    fn new(fixture: Option<&str>) -> Scratch {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "memora-legacy-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        if let Some(f) = fixture {
            let src = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/legacy")
                .join(f);
            for e in std::fs::read_dir(src).unwrap() {
                let e = e.unwrap();
                std::fs::copy(e.path(), dir.join(e.file_name())).unwrap();
            }
        }
        Scratch(dir)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn count(db: &Db, table: &str) -> i64 {
    db.read(|c| Ok(c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?))
        .unwrap()
}

fn meta(db: &Db) -> Option<String> {
    db.read(|c| {
        Ok(c.query_row(
            "SELECT value FROM meta WHERE key = ?1",
            [META_LEGACY_IMPORT],
            |r| r.get(0),
        )
        .ok())
    })
    .unwrap()
}

/// Every row of `table` as debug strings, sorted (for comparing two databases).
fn dump(db: &Db, sql: &str) -> Vec<String> {
    db.read(|c| {
        let mut stmt = c.prepare(sql)?;
        let n = stmt.column_count();
        let mut rows: Vec<String> = stmt
            .query_map([], |r| {
                let mut s = Vec::new();
                for i in 0..n {
                    s.push(format!("{:?}", r.get::<_, rusqlite::types::Value>(i)?));
                }
                Ok(s.join("|"))
            })?
            .collect::<rusqlite::Result<_>>()?;
        rows.sort();
        Ok(rows)
    })
    .unwrap()
}

fn legacy_left(dir: &Path) -> Vec<&'static str> {
    LEGACY_FILES
        .iter()
        .copied()
        .filter(|f| dir.join(f).exists())
        .collect()
}

#[test]
fn typical_import_counts_archive_and_second_run() {
    let s = Scratch::new(Some("typical"));
    let db = Db::open(&s.0).unwrap();
    let rep = import_legacy(&db, &s.0).unwrap();
    assert_eq!(rep.status, ImportStatus::Imported);

    let row = |t: &str| rep.rows.get(t).copied().unwrap_or(0);
    let skip = |t: &str| rep.skipped.get(t).copied().unwrap_or(0);
    assert_eq!(row("owner"), 1);
    assert_eq!(row("api_key"), 4);
    assert_eq!(row("api_key_scope"), 2 + 3 + 4 + 1); // k_new, k_old (defaults), k_argon, k_gone
    assert_eq!(row("api_key_tool"), 2);
    assert_eq!(row("api_key_usage"), 2); // key-usage.json k_new + record usage of k_old
    assert_eq!(row("tool"), 3); // empty catalog: search_notes, read_note, delete_note as retired
    assert_eq!(row("tool_disabled"), 1);
    assert_eq!(row("server_config"), 3); // PORT, BIND, RUST_LOG (empty BASE_URL = unset)
    assert_eq!(row("access_rule"), 2);
    assert_eq!(row("session"), 2);
    assert_eq!(row("activity"), 3);
    assert_eq!(row("arm_state"), 1);
    assert_eq!(skip("activity_bad_lines"), 3);
    assert_eq!(skip("sessions_expired"), 1);
    assert_eq!(skip("sessions_not_owner"), 1);
    assert_eq!(skip("sessions_signed_out"), 1);
    assert_eq!(skip("key_usage_unknown_key"), 1);
    assert_eq!(skip("tools_disabled_invalid_name"), 1);
    assert_eq!(skip("tools_unknown_added_retired"), 3);
    assert_eq!(skip("key_prefix_missing"), 1);
    assert_eq!(skip("key_created_missing"), 1);
    assert_eq!(skip("env_unknown_keys"), 1);
    assert_eq!(skip("gateway_settings_ignored"), 2);
    assert_eq!(skip("access_rules_invalid"), 1);
    assert_eq!(skip("key_grace_until_dropped"), 1);
    assert_eq!(
        rep.dropped_secrets,
        vec!["MEMORA_ADMIN_PASSWORD".to_string()]
    );

    // Values.
    db.read(|c| {
        let (user, display): (String, String) =
            c.query_row("SELECT username, display_name FROM owner", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?;
        assert_eq!((user.as_str(), display.as_str()), ("alice", "Alice"));
        let (hash, enabled, created, tools_all): (String, i64, i64, i64) = c.query_row(
            "SELECT hash, enabled, created_at, tools_all FROM api_key WHERE id = 'k_old'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        assert_eq!(
            hash,
            "b".repeat(64),
            "sha256 hex is normalised to lower case"
        );
        assert_eq!((enabled, created, tools_all), (0, 1791978570, 1));
        let (deleted, prefix): (Option<i64>, String) = c.query_row(
            "SELECT deleted_at, prefix FROM api_key WHERE id = 'k_gone'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        assert!(deleted.is_some());
        assert_eq!(prefix, "(unknown)");
        let usage: (i64, i64) = c.query_row(
            "SELECT last_used, use_count FROM api_key_usage WHERE key_id = 'k_old'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        assert_eq!(usage, (1792022400, 7));
        let st: (String, i64, i64, Option<String>) = c.query_row(
            "SELECT realm, session_ttl, min_password_len, vault_path FROM settings",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        assert_eq!(
            st,
            ("My Memora".into(), 7200, 12, Some("/srv/vault".into()))
        );
        let arm: (String, Option<i64>, Option<String>, Option<i64>) = c.query_row(
            "SELECT state, locked_at, code_hash, burned_at FROM arm_state",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        assert_eq!(
            arm,
            ("locked".into(), Some(1700000300), None, Some(1700000500))
        );
        let allow: i64 =
            c.query_row("SELECT default_allow FROM access_policy", [], |r| r.get(0))?;
        assert_eq!(allow, 0);
        let first: String =
            c.query_row("SELECT id FROM access_rule WHERE position = 0", [], |r| {
                r.get(0)
            })?;
        assert_eq!(first, "r1");
        let ua: i64 = c.query_row("SELECT max(length(user_agent)) FROM session", [], |r| {
            r.get(0)
        })?;
        assert_eq!(ua, 300);
        let sids: i64 = c.query_row(
            "SELECT count(*) FROM session WHERE sid_hash GLOB 'sid*'",
            [],
            |r| r.get(0),
        )?;
        assert_eq!(sids, 0, "raw session ids are never stored");
        let marker: i64 = c.query_row(
            "SELECT count(*) FROM activity WHERE event = 'state_imported'",
            [],
            |r| r.get(0),
        )?;
        assert_eq!(marker, 1);
        Ok(())
    })
    .unwrap();

    // Archive layout.
    let archived = rep.archived_to.clone().expect("archived");
    assert!(archived
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("legacy-json-"));
    assert_eq!(archived.parent(), Some(s.0.as_path()));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&archived).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
    }
    assert!(
        legacy_left(&s.0).is_empty(),
        "left: {:?}",
        legacy_left(&s.0)
    );
    assert_eq!(legacy_left(&archived).len(), 13); // every legacy file but lock.json
    let m = meta(&db).unwrap();
    assert!(m.contains(" gateway.json=") && m.contains(" activity.jsonl.1="));

    // Second run: no-op.
    let before = dump(&db, "SELECT * FROM activity");
    let again = import_legacy(&db, &s.0).unwrap();
    assert_eq!(again.status, ImportStatus::AlreadyImported);
    assert!(again.rows.is_empty());
    assert_eq!(dump(&db, "SELECT * FROM activity"), before);
    assert_eq!(count(&db, "api_key"), 4);
}

#[test]
fn fresh_install_records_none() {
    let s = Scratch::new(None);
    let db = Db::open(&s.0).unwrap();
    let rep = import_legacy(&db, &s.0).unwrap();
    assert_eq!(rep.status, ImportStatus::FreshInstall);
    assert_eq!(meta(&db).as_deref(), Some("none"));
    assert_eq!(rep.archived_to, None);
    let again = import_legacy(&db, &s.0).unwrap();
    assert_eq!(again.status, ImportStatus::AlreadyImported);
    assert_eq!(again.archived_to, None);
}

fn assert_aborted(fixture: &str, needle: &[&str]) {
    let s = Scratch::new(Some(fixture));
    let db = Db::open(&s.0).unwrap();
    let left_before = legacy_left(&s.0);
    match import_legacy(&db, &s.0) {
        Err(e @ Error::Invalid { .. }) => {
            let msg = e.to_string();
            for n in needle {
                assert!(msg.contains(n), "{fixture}: {msg:?} should mention {n}");
            }
        }
        other => panic!("{fixture}: expected Error::Invalid, got {other:?}"),
    }
    assert_eq!(meta(&db), None, "{fixture}: no marker");
    for t in ["owner", "api_key", "activity", "session"] {
        assert_eq!(count(&db, t), 0, "{fixture}: {t} half-imported");
    }
    assert_eq!(
        legacy_left(&s.0),
        left_before,
        "{fixture}: files must stay in place"
    );
}

#[test]
fn two_users_abort() {
    assert_aborted("two_users", &["gateway.json users", "alice", "bob"]);
}

#[test]
fn corrupt_key_aborts_everything() {
    assert_aborted("bad_key", &["gateway.json api_keys", "k_bad"]);
}

#[test]
fn torn_sessions_are_skipped() {
    let s = Scratch::new(Some("torn_sessions"));
    let db = Db::open(&s.0).unwrap();
    let rep = import_legacy(&db, &s.0).unwrap();
    assert_eq!(rep.status, ImportStatus::Imported);
    assert_eq!(rep.skipped.get("sessions_file_unreadable"), Some(&1));
    assert_eq!(count(&db, "owner"), 1);
    assert_eq!(count(&db, "session"), 0);
}

#[test]
fn open_arm_window_survives_and_wins_over_lock() {
    let s = Scratch::new(Some("armed"));
    let db = Db::open(&s.0).unwrap();
    import_legacy(&db, &s.0).unwrap();
    let arm = dump(
        &db,
        "SELECT state, mode, ttl, code_hash, locked_at FROM arm_state",
    );
    assert_eq!(
        arm,
        vec![format!(
            "Text(\"armed\")|Text(\"bootstrap\")|Integer(600)|Text(\"{}\")|Null",
            "e".repeat(64)
        )]
    );
}

#[test]
fn interrupted_archive_is_completed_and_changed_files_kept() {
    let s = Scratch::new(Some("typical"));
    let db = Db::open(&s.0).unwrap();
    let rep = import_legacy(&db, &s.0).unwrap();
    let archived = rep.archived_to.unwrap();
    // Simulate a crash between commit and move for two files, one of which was then
    // rewritten (e.g. by an old binary).
    std::fs::rename(archived.join("tools.json"), s.0.join("tools.json")).unwrap();
    std::fs::write(
        s.0.join("activity.jsonl"),
        "{\"at\":1,\"event\":\"later\"}\n",
    )
    .unwrap();
    let again = import_legacy(&db, &s.0).unwrap();
    assert_eq!(again.status, ImportStatus::AlreadyImported);
    assert_eq!(again.archived_to.as_deref(), Some(archived.as_path()));
    assert!(archived.join("tools.json").exists());
    assert!(s.0.join("activity.jsonl").exists());
    assert_eq!(again.skipped.get("archive_changed_since_import"), Some(&1));
}

#[test]
fn export_json_round_trips() {
    let a = Scratch::new(Some("typical"));
    let db1 = Db::open(&a.0).unwrap();
    import_legacy(&db1, &a.0).unwrap();

    let b = Scratch::new(None);
    let written = export_json(&db1, &b.0).unwrap();
    let names: Vec<String> = written
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    for f in [
        "gateway.json",
        "config.json",
        "memora.env",
        "tools.json",
        "access_stack.json",
        "sessions.json",
        "key-usage.json",
        "lock.json",
        "arm-burned.json",
        "activity.jsonl",
    ] {
        assert!(names.iter().any(|n| n == f), "{f} not written: {names:?}");
    }
    assert!(!b.0.join("arm.json").exists());
    let g: serde_json::Value =
        serde_json::from_slice(&std::fs::read(b.0.join("gateway.json")).unwrap()).unwrap();
    assert!(g["users"]["alice"]["password"]
        .as_str()
        .unwrap()
        .starts_with("$argon2id$"));
    assert_eq!(
        g["api_keys"]["k_new"]["tools"],
        serde_json::json!(["read_note", "search_notes"])
    );
    assert_eq!(g["api_keys"]["k_argon"]["tools"], "*");
    assert!(g["api_keys_deleted"]["k_gone"].is_object());
    assert_eq!(g["settings"]["session_ttl"], 7200);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(b.0.join("gateway.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    // Re-import the export into a second database: everything but sessions (raw ids are
    // not recoverable) and the import's own activity row must match.
    let db2 = Db::open(&b.0).unwrap();
    let rep = import_legacy(&db2, &b.0).unwrap();
    assert_eq!(rep.status, ImportStatus::Imported);
    assert!(!rep.skipped.contains_key("activity_bad_lines"));
    for sql in [
        "SELECT * FROM owner",
        "SELECT * FROM api_key",
        "SELECT * FROM api_key_scope",
        "SELECT * FROM api_key_tool",
        "SELECT * FROM api_key_usage",
        "SELECT * FROM tool",
        "SELECT * FROM tool_disabled",
        "SELECT key, value FROM server_config",
        "SELECT realm, session_ttl, session_max_age, min_password_len, vault_path FROM settings",
        "SELECT * FROM access_policy",
        "SELECT * FROM access_rule",
        "SELECT state, code_hash, locked_at, burned_at, burned_ip, burned_mode FROM arm_state",
    ] {
        assert_eq!(dump(&db1, sql), dump(&db2, sql), "{sql}");
    }
    let acts = "SELECT at, event, ip, actor, detail FROM activity";
    let mut want = dump(&db1, acts);
    let got = dump(&db2, acts);
    assert_eq!(got.len(), want.len() + 1);
    want.retain(|r| !got.contains(r));
    assert!(want.is_empty(), "lost activity rows: {want:?}");
    assert_eq!(count(&db2, "session"), 0);
}

/// End-to-end import of a copy of a real state dir: `LEGACY_STATE_DIR=<copy> cargo test
/// --release -p memora-state --test legacy -- --ignored --nocapture`. Prints counts only.
#[test]
#[ignore]
fn import_real_state_copy() {
    let dir = PathBuf::from(std::env::var("LEGACY_STATE_DIR").expect("LEGACY_STATE_DIR"));
    let db = Db::open(&dir).unwrap();
    let rep = import_legacy(&db, &dir).unwrap();
    println!("status: {:?}", rep.status);
    println!("rows: {:?}", rep.rows);
    println!("skipped: {:?}", rep.skipped);
    println!("dropped secrets: {:?}", rep.dropped_secrets);
    println!("archived to: {:?}", rep.archived_to);
    let again = import_legacy(&db, &dir).unwrap();
    assert_eq!(again.status, ImportStatus::AlreadyImported);
    let out = dir.join("export-roundtrip");
    let written = export_json(&db, &out).unwrap();
    println!("exported {} files", written.len());
    let db2 = Db::open(&out).unwrap();
    let rep2 = import_legacy(&db2, &out).unwrap();
    for sql in [
        "SELECT * FROM owner",
        "SELECT * FROM api_key",
        "SELECT * FROM api_key_scope",
        "SELECT * FROM api_key_usage",
        "SELECT key, value FROM server_config",
        "SELECT realm, session_ttl, session_max_age, min_password_len, vault_path FROM settings",
        "SELECT state, code_hash, locked_at, burned_at, burned_ip, burned_mode FROM arm_state",
        "SELECT * FROM access_rule",
    ] {
        assert_eq!(dump(&db, sql), dump(&db2, sql), "{sql}");
    }
    println!("re-import of export: rows {:?}", rep2.rows);
}
