//! Owner repository.

use memora_state::{owner, Db, Error};
use rusqlite::params;

const ARGON_A: &str = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaEE";
const ARGON_B: &str = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaEI";
const SID_1: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const SID_2: &str = "2222222222222222222222222222222222222222222222222222222222222222";

fn add_session(db: &Db, sid: &str) {
    db.write(|tx| {
        tx.execute(
            "INSERT INTO session (sid_hash, source, created_at, last_seen) VALUES (?1, 'web', 1, 1)",
            params![sid],
        )?;
        Ok(())
    })
    .unwrap();
}

fn sessions(db: &Db) -> i64 {
    db.read(|c| Ok(c.query_row("SELECT count(*) FROM session", [], |r| r.get(0))?))
        .unwrap()
}

fn owners(db: &Db) -> i64 {
    db.read(|c| Ok(c.query_row("SELECT count(*) FROM owner", [], |r| r.get(0))?))
        .unwrap()
}

#[test]
fn valid_username_rules() {
    assert!(owner::valid_username("admin"));
    assert!(owner::valid_username("a.b-c_d9"));
    assert!(owner::valid_username(&"x".repeat(32)));
    assert!(!owner::valid_username(&"x".repeat(33)));
    assert!(!owner::valid_username(""));
    assert!(!owner::valid_username("a b"));
    assert!(!owner::valid_username("ädmin"));
    assert_eq!(owner::normalize_username(" Admin ").unwrap(), "admin");
    assert!(matches!(
        owner::normalize_username("no/slash"),
        Err(Error::Invalid { .. })
    ));
}

#[test]
fn empty_db_has_no_owner() {
    let db = Db::open_temp().unwrap();
    assert_eq!(db.read(owner::get).unwrap(), None);
    assert_eq!(db.read(owner::owner_name).unwrap(), None);
}

#[test]
fn set_owner_creates_lowercased() {
    let db = Db::open_temp().unwrap();
    db.write(|tx| owner::set_owner(tx, "Alice", ARGON_A, 100))
        .unwrap();
    let o = db.read(owner::get).unwrap().unwrap();
    assert_eq!(o.username, "alice");
    assert_eq!(o.password_hash, ARGON_A);
    assert!(o.enabled);
    assert_eq!(o.display_name, "");
    assert_eq!((o.created_at, o.password_changed_at), (100, 100));
    assert_eq!(
        db.read(owner::owner_name).unwrap().as_deref(),
        Some("alice")
    );
    // password hash never serialised
    let j = serde_json::to_value(&o).unwrap();
    assert!(j.get("password_hash").is_none());
}

#[test]
fn set_owner_rejects_bad_input() {
    let db = Db::open_temp().unwrap();
    let e = db
        .write(|tx| owner::set_owner(tx, "bad name", ARGON_A, 1))
        .unwrap_err();
    assert!(
        matches!(
            e,
            Error::Invalid {
                field: "username",
                ..
            }
        ),
        "{e}"
    );
    let e = db
        .write(|tx| owner::set_owner(tx, "bob", "plain", 1))
        .unwrap_err();
    assert!(
        matches!(
            e,
            Error::Invalid {
                field: "password_hash",
                ..
            }
        ),
        "{e}"
    );
    assert_eq!(owners(&db), 0);
}

#[test]
fn second_set_owner_replaces_and_revokes_on_new_hash() {
    let db = Db::open_temp().unwrap();
    db.write(|tx| owner::set_owner(tx, "alice", ARGON_A, 100))
        .unwrap();
    db.write(|tx| owner::set_display_name(tx, "Alice A."))
        .unwrap();
    db.write(|tx| owner::set_enabled(tx, false)).unwrap();
    add_session(&db, SID_1);

    // same hash: no revocation, password_changed_at unchanged, re-enabled
    db.write(|tx| owner::set_owner(tx, "alice", ARGON_A, 200))
        .unwrap();
    let o = db.read(owner::get).unwrap().unwrap();
    assert_eq!(o.password_changed_at, 100);
    assert!(o.enabled);
    assert_eq!(sessions(&db), 1);

    // new name + hash: replaces the one row, revokes sessions
    db.write(|tx| owner::set_owner(tx, "Bob", ARGON_B, 300))
        .unwrap();
    assert_eq!(owners(&db), 1);
    let o = db.read(owner::get).unwrap().unwrap();
    assert_eq!(o.username, "bob");
    assert_eq!(o.password_hash, ARGON_B);
    assert_eq!(o.created_at, 100);
    assert_eq!(o.password_changed_at, 300);
    assert_eq!(o.display_name, "Alice A.");
    assert_eq!(sessions(&db), 0);
}

#[test]
fn change_password_keeps_current_session_and_logs() {
    let db = Db::open_temp().unwrap();
    assert!(matches!(
        db.write(|tx| owner::change_password(tx, ARGON_B, None, None, 5)),
        Err(Error::NotFound(_))
    ));
    db.write(|tx| owner::set_owner(tx, "alice", ARGON_A, 100))
        .unwrap();
    add_session(&db, SID_1);
    add_session(&db, SID_2);
    let n = db
        .write(|tx| owner::change_password(tx, ARGON_B, Some(SID_1), Some("10.0.0.1"), 500))
        .unwrap();
    assert_eq!(n, 1);
    assert_eq!(sessions(&db), 1);
    let o = db.read(owner::get).unwrap().unwrap();
    assert_eq!(
        (o.password_hash.as_str(), o.password_changed_at),
        (ARGON_B, 500)
    );
    let (ev, ip, actor): (String, String, String) = db
        .read(|c| {
            Ok(
                c.query_row("SELECT event, ip, actor FROM activity", [], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                })?,
            )
        })
        .unwrap();
    assert_eq!(
        (ev.as_str(), ip.as_str(), actor.as_str()),
        ("password_changed", "10.0.0.1", "alice")
    );

    // without a session to keep, all go
    let n = db
        .write(|tx| owner::change_password(tx, ARGON_A, None, None, 600))
        .unwrap();
    assert_eq!(n, 1);
    assert_eq!(sessions(&db), 0);
    // bad hash rejected, nothing changed
    assert!(db
        .write(|tx| owner::change_password(tx, "x", None, None, 700))
        .is_err());
    assert_eq!(
        db.read(owner::get).unwrap().unwrap().password_changed_at,
        600
    );
}

#[test]
fn rename_display_name_enabled() {
    let db = Db::open_temp().unwrap();
    assert!(matches!(
        db.write(|tx| owner::rename(tx, "x")),
        Err(Error::NotFound(_))
    ));
    assert!(matches!(
        db.write(|tx| owner::set_display_name(tx, "x")),
        Err(Error::NotFound(_))
    ));
    assert!(matches!(
        db.write(|tx| owner::set_enabled(tx, true)),
        Err(Error::NotFound(_))
    ));

    db.write(|tx| owner::set_owner(tx, "alice", ARGON_A, 1))
        .unwrap();
    add_session(&db, SID_1);
    db.write(|tx| owner::rename(tx, "Carol")).unwrap();
    assert_eq!(
        db.read(owner::owner_name).unwrap().as_deref(),
        Some("carol")
    );
    assert_eq!(sessions(&db), 1, "rename keeps sessions");
    assert!(matches!(
        db.write(|tx| owner::rename(tx, "")),
        Err(Error::Invalid { .. })
    ));

    db.write(|tx| owner::set_display_name(tx, "  Carol C  "))
        .unwrap();
    assert_eq!(
        db.read(owner::get).unwrap().unwrap().display_name,
        "Carol C"
    );
    db.write(|tx| owner::set_display_name(tx, &"é".repeat(64)))
        .unwrap();
    assert!(matches!(
        db.write(|tx| owner::set_display_name(tx, &"é".repeat(65))),
        Err(Error::Invalid { .. })
    ));
    assert!(db.write(|tx| owner::set_display_name(tx, "a\nb")).is_err());

    db.write(|tx| owner::set_enabled(tx, false)).unwrap();
    assert!(!db.read(owner::get).unwrap().unwrap().enabled);
    db.write(|tx| owner::set_enabled(tx, true)).unwrap();
    assert!(db.read(owner::get).unwrap().unwrap().enabled);
}
