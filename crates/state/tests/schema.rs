//! Schema: invalid data is rejected at the DB level (raw SQL); pragmas and permissions,
//! change detection across connections, writer serialisation.

use memora_state::{Db, Domain, Error, Transaction};
use rusqlite::params;

const HASH_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ARGON: &str = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA";

fn sql(db: &Db, stmt: &str) -> Result<usize, Error> {
    db.write(|tx| Ok(tx.execute(stmt, [])?))
}

fn assert_rejected(r: Result<usize, Error>, what: &str) {
    match r {
        Err(e) => assert!(
            e.is_constraint(),
            "{what}: expected a constraint error, got {e}"
        ),
        Ok(_) => panic!("{what}: the schema accepted it"),
    }
}

fn insert_owner(tx: &Transaction<'_>, id: Option<i64>, name: &str) -> rusqlite::Result<usize> {
    tx.execute(
        "INSERT INTO owner (id, username, password_hash, created_at, password_changed_at)
         VALUES (?1, ?2, ?3, 1, 1)",
        params![id, name, ARGON],
    )
}

fn insert_key(
    tx: &Transaction<'_>,
    id: &str,
    hash: &str,
    tools_all: i64,
) -> rusqlite::Result<usize> {
    tx.execute(
        "INSERT INTO api_key (id, name, hash, prefix, tools_all, created_at)
         VALUES (?1, 'agent', ?2, 'memora_live_', ?3, 1)",
        params![id, hash, tools_all],
    )
}

#[test]
fn pragmas_are_applied() {
    let db = Db::open_temp().unwrap();
    db.read(|c| {
        let get = |p: &str| -> rusqlite::Result<String> {
            c.query_row(&format!("PRAGMA {p}"), [], |r| {
                r.get::<_, rusqlite::types::Value>(0)
            })
            .map(|v| match v {
                rusqlite::types::Value::Integer(i) => i.to_string(),
                rusqlite::types::Value::Text(t) => t,
                other => format!("{other:?}"),
            })
        };
        assert_eq!(get("journal_mode")?, "wal");
        assert_eq!(get("foreign_keys")?, "1");
        assert_eq!(get("synchronous")?, "2"); // FULL
        assert_eq!(get("busy_timeout")?, "5000");
        assert_eq!(get("secure_delete")?, "1");
        assert_eq!(get("trusted_schema")?, "0");
        assert_eq!(get("journal_size_limit")?, (4 * 1024 * 1024).to_string());
        assert_eq!(
            get("application_id")?,
            memora_state::APPLICATION_ID.to_string()
        );
        assert_eq!(get("query_only")?, "1"); // the read connection
        Ok(())
    })
    .unwrap();
    // The read connection cannot write.
    let r = db.read(|c| Ok(c.execute("DELETE FROM meta", [])?));
    assert!(r.is_err());
}

#[test]
fn second_owner_is_rejected() {
    let db = Db::open_temp().unwrap();
    db.write(|tx| Ok(insert_owner(tx, None, "alice")?)).unwrap();
    assert_rejected(
        db.write(|tx| Ok(insert_owner(tx, None, "bob")?)),
        "auto id owner",
    );
    assert_rejected(
        db.write(|tx| Ok(insert_owner(tx, Some(2), "bob")?)),
        "owner id 2",
    );
    assert_rejected(
        db.write(|tx| Ok(insert_owner(tx, Some(1), "bob")?)),
        "duplicate id 1",
    );
    let n: i64 = db
        .read(|c| Ok(c.query_row("SELECT count(*) FROM owner", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(n, 1);
    // Shape checks on the one row.
    assert_rejected(
        sql(&db, "UPDATE owner SET username = 'Alice'"),
        "uppercase username",
    );
    assert_rejected(
        sql(&db, "UPDATE owner SET username = 'a b'"),
        "space in username",
    );
    assert_rejected(
        sql(&db, "UPDATE owner SET password_hash = 'plain'"),
        "non-argon2 hash",
    );
    sql(&db, "UPDATE owner SET username = 'a.b_c-d9'").unwrap();
}

#[test]
fn key_with_empty_or_bad_hash_is_rejected() {
    let db = Db::open_temp().unwrap();
    assert_rejected(
        db.write(|tx| Ok(insert_key(tx, "k_1", "", 1)?)),
        "empty hash",
    );
    assert_rejected(
        db.write(|tx| Ok(insert_key(tx, "k_1", &HASH_A.to_uppercase(), 1)?)),
        "uppercase hex",
    );
    assert_rejected(
        sql(&db, "INSERT INTO api_key (id, name, prefix, created_at) VALUES ('k_1','a','memora_live_',1)"),
        "missing hash",
    );
    assert_rejected(
        db.write(|tx| Ok(insert_key(tx, "x_1", HASH_A, 1)?)),
        "id without k_",
    );
    db.write(|tx| Ok(insert_key(tx, "k_1", HASH_A, 1)?))
        .unwrap();
    db.write(|tx| Ok(insert_key(tx, "k_legacy", ARGON, 1)?))
        .unwrap();
    assert_rejected(
        db.write(|tx| Ok(insert_key(tx, "k_2", HASH_A, 1)?)),
        "duplicate hash",
    );
    assert_rejected(
        sql(
            &db,
            "INSERT INTO api_key_scope (key_id, scope) VALUES ('k_1', 'root')",
        ),
        "unknown scope",
    );
    assert_rejected(
        sql(&db, "UPDATE api_key SET deleted_at = 0 WHERE id = 'k_1'"),
        "deleted before created",
    );
}

#[test]
fn armed_window_without_code_is_rejected() {
    let db = Db::open_temp().unwrap();
    assert_rejected(
        sql(
            &db,
            "UPDATE arm_state SET state='armed', mode='bootstrap', armed_at=1, ttl=600",
        ),
        "armed without code_hash",
    );
    assert_rejected(
        sql(
            &db,
            &format!(
                "UPDATE arm_state SET state='armed', armed_at=1, ttl=600, code_hash='{HASH_A}'"
            ),
        ),
        "armed without mode",
    );
    sql(
        &db,
        &format!("UPDATE arm_state SET state='armed', mode='reset', armed_at=1, ttl=600, code_hash='{HASH_A}'"),
    )
    .unwrap();
    // Leaving the armed state must drop the code.
    assert_rejected(
        sql(&db, "UPDATE arm_state SET state='idle'"),
        "idle keeping the code",
    );
    assert_rejected(
        sql(&db, "UPDATE arm_state SET state='locked', code_hash=NULL"),
        "locked without time",
    );
    sql(
        &db,
        "UPDATE arm_state SET state='locked', locked_at=5, code_hash=NULL",
    )
    .unwrap();
    assert_rejected(
        sql(&db, "UPDATE arm_state SET burned_at=5"),
        "burn without ip",
    );
    assert_rejected(
        sql(&db, "INSERT INTO arm_state (id, state) VALUES (2, 'idle')"),
        "second arm row",
    );
}

#[test]
fn per_key_tool_must_be_in_catalog() {
    let db = Db::open_temp().unwrap();
    sql(&db, "INSERT INTO tool (name) VALUES ('get_stats')").unwrap();
    db.write(|tx| Ok(insert_key(tx, "k_list", HASH_A, 0)? + insert_key(tx, "k_all", HASH_B, 1)?))
        .unwrap();
    assert_rejected(
        sql(
            &db,
            "INSERT INTO api_key_tool (key_id, tool_name) VALUES ('k_list', 'nope')",
        ),
        "unknown tool",
    );
    sql(
        &db,
        "INSERT INTO api_key_tool (key_id, tool_name) VALUES ('k_list', 'get_stats')",
    )
    .unwrap();
    assert_rejected(
        sql(
            &db,
            "INSERT INTO api_key_tool (key_id, tool_name) VALUES ('k_all', 'get_stats')",
        ),
        "tool list on a tools_all key",
    );
    assert_rejected(
        sql(
            &db,
            "INSERT INTO tool_disabled (tool_name, disabled_at) VALUES ('nope', 1)",
        ),
        "global switch for unknown tool",
    );
    assert_rejected(
        sql(&db, "INSERT INTO tool (name) VALUES ('Bad-Name')"),
        "tool name shape",
    );
    // Switching a key to "*" clears its list.
    sql(&db, "UPDATE api_key SET tools_all = 1 WHERE id = 'k_list'").unwrap();
    let n: i64 = db
        .read(|c| Ok(c.query_row("SELECT count(*) FROM api_key_tool", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(n, 0);
    // Deleting a key cascades.
    sql(
        &db,
        "INSERT INTO api_key_scope (key_id, scope) VALUES ('k_all', 'mcp')",
    )
    .unwrap();
    sql(&db, "DELETE FROM api_key WHERE id = 'k_all'").unwrap();
    let n: i64 = db
        .read(|c| Ok(c.query_row("SELECT count(*) FROM api_key_scope", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(n, 0);
}

#[test]
fn other_constraints() {
    let db = Db::open_temp().unwrap();
    assert_rejected(
        sql(
            &db,
            "INSERT INTO server_config VALUES ('MEMORA_ADMIN_PASSWORD', 'secret', 1)",
        ),
        "plaintext secret in server_config",
    );
    assert_rejected(
        sql(
            &db,
            "INSERT INTO server_config VALUES ('MEMORA_PORT', '70000', 1)",
        ),
        "port range",
    );
    assert_rejected(
        sql(
            &db,
            "INSERT INTO server_config VALUES ('MEMORA_PORT', '80a', 1)",
        ),
        "port digits",
    );
    sql(
        &db,
        "INSERT INTO server_config VALUES ('MEMORA_PORT', '8080', 1)",
    )
    .unwrap();
    assert_rejected(
        sql(&db, "UPDATE settings SET vault_path = 'relative/dir'"),
        "relative vault",
    );
    assert_rejected(
        sql(&db, "UPDATE settings SET session_ttl = 10"),
        "ttl too short",
    );
    assert_rejected(
        sql(&db, &format!("INSERT INTO session (sid_hash, source, created_at, last_seen) VALUES ('{HASH_A}', 'password', 1, 1)")),
        "session without owner",
    );
    assert_rejected(
        sql(
            &db,
            "INSERT INTO activity (at, event) VALUES (1, 'Bad Event')",
        ),
        "event shape",
    );
    assert_rejected(
        sql(&db, "INSERT INTO access_rule (id, position, kind, value, action) VALUES ('r1', 0, 'ip', '', 'allow')"),
        "empty ip rule",
    );
    // Owner delete cascades to sessions.
    db.write(|tx| Ok(insert_owner(tx, Some(1), "alice")?))
        .unwrap();
    sql(&db, &format!("INSERT INTO session (sid_hash, source, created_at, last_seen) VALUES ('{HASH_A}', 'password', 1, 1)")).unwrap();
    sql(&db, "DELETE FROM owner").unwrap();
    let n: i64 = db
        .read(|c| Ok(c.query_row("SELECT count(*) FROM session", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(n, 0);
}

#[test]
fn write_rolls_back_on_error() {
    let db = Db::open_temp().unwrap();
    let r: Result<(), Error> = db.write(|tx| {
        tx.execute("INSERT INTO meta VALUES ('k', 'v')", [])?;
        Err(Error::Conflict("abort".into()))
    });
    assert!(r.is_err());
    let n: i64 = db
        .read(|c| Ok(c.query_row("SELECT count(*) FROM meta", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(n, 0);
}

#[test]
fn change_detection_across_connections() {
    let server = Db::open_temp().unwrap();
    let cli = Db::open(server.state_dir()).unwrap(); // second handle = other process
    assert!(server.changed_domains().unwrap().is_empty());

    cli.write(|tx| Ok(insert_owner(tx, Some(1), "alice")?))
        .unwrap();
    assert_eq!(server.changed_domains().unwrap(), vec![Domain::Auth]);
    assert!(
        server.changed_domains().unwrap().is_empty(),
        "reported once"
    );

    // A commit that touches no revisioned table changes data_version but no domain.
    cli.write(|tx| Ok(tx.execute("INSERT INTO activity (at, event) VALUES (1, 'signin')", [])?))
        .unwrap();
    assert!(server.changed_domains().unwrap().is_empty());

    // Several domains in one transaction.
    cli.write(|tx| {
        insert_key(tx, "k_1", HASH_A, 1)?;
        tx.execute("UPDATE settings SET realm = 'Home'", [])?;
        tx.execute("INSERT INTO tool (name) VALUES ('get_stats')", [])?;
        tx.execute("INSERT INTO tool_disabled VALUES ('get_stats', 1)", [])?;
        Ok(())
    })
    .unwrap();
    assert_eq!(
        server.changed_domains().unwrap(),
        vec![Domain::Keys, Domain::Tools, Domain::Settings]
    );

    // A rolled-back write signals nothing.
    let _ = cli.write(|tx| -> Result<(), Error> {
        tx.execute("UPDATE arm_state SET state = 'locked', locked_at = 1", [])?;
        Err(Error::Conflict("abort".into()))
    });
    assert!(server.changed_domains().unwrap().is_empty());

    // The server's own writes are reported too (its read connection is separate).
    sql(&server, "UPDATE access_policy SET default_allow = 0").unwrap();
    assert_eq!(server.changed_domains().unwrap(), vec![Domain::Access]);

    let revs = cli.revisions().unwrap();
    assert_eq!(revs[&Domain::Auth], 1);
    assert_eq!(revs[&Domain::Arm], 0);
}

#[test]
fn concurrent_writers_lose_no_update() {
    let a = Db::open_temp().unwrap();
    let b = Db::open(a.state_dir()).unwrap();
    sql(&a, "INSERT INTO meta VALUES ('counter', '0')").unwrap();
    let threads: Vec<_> = (0..8)
        .map(|i| {
            let db = if i % 2 == 0 { a.clone() } else { b.clone() };
            std::thread::spawn(move || {
                for _ in 0..25 {
                    // Read-modify-write in Rust: safe because BEGIN IMMEDIATE takes the
                    // write lock before the read.
                    db.write(|tx| {
                        let v: String = tx.query_row(
                            "SELECT value FROM meta WHERE key = 'counter'",
                            [],
                            |r| r.get(0),
                        )?;
                        let n: i64 = v.parse().unwrap();
                        tx.execute(
                            "UPDATE meta SET value = ?1 WHERE key = 'counter'",
                            [(n + 1).to_string()],
                        )?;
                        Ok(())
                    })
                    .unwrap();
                }
            })
        })
        .collect();
    for t in threads {
        t.join().unwrap();
    }
    let v: String = a
        .read(|c| {
            Ok(
                c.query_row("SELECT value FROM meta WHERE key = 'counter'", [], |r| {
                    r.get(0)
                })?,
            )
        })
        .unwrap();
    assert_eq!(v, "200");
}

#[cfg(unix)]
#[test]
fn files_are_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = Db::open_temp().unwrap();
    let dir = tmp.state_dir().join("fresh-state");
    let db = Db::open(&dir).unwrap();
    sql(&db, "INSERT INTO meta VALUES ('k', 'v')").unwrap();
    let mode = |p: &std::path::Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&dir), 0o700, "state dir");
    for name in ["memora.db", "memora.db-wal", "memora.db-shm"] {
        let p = dir.join(name);
        assert!(p.exists(), "{name} missing");
        assert_eq!(mode(&p), 0o600, "{name}");
    }
    // A pre-existing loose file is tightened on open.
    drop(db);
    std::fs::set_permissions(
        dir.join("memora.db"),
        std::fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    let _db = Db::open(&dir).unwrap();
    assert_eq!(mode(&dir.join("memora.db")), 0o600);
}
