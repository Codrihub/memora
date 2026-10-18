//! Sessions (hashed ids, expiry, revoke variants, cap, last_seen buffering) and
//! control requests (lifecycle, ack timeout), including two `Db` handles on one file.

use memora_state::control::{self, ControlKind};
use memora_state::session::{self, LastSeenBuffer, NewSession, Session, MAX_SESSIONS};
use memora_state::{Db, Error, Transaction};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

const TTL: i64 = 3600;
const T0: i64 = 1_700_000_000;

fn hash(n: u64) -> String {
    format!("{n:064x}")
}

fn with_owner() -> Db {
    let db = Db::open_temp().unwrap();
    db.write(|tx| {
        tx.execute(
            "INSERT INTO owner (id, username, password_hash, created_at, password_changed_at)
             VALUES (1, 'admin', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', 1, 1)",
            [],
        )?;
        Ok(())
    })
    .unwrap();
    db
}

fn new(sid_hash: &str) -> NewSession {
    NewSession {
        sid_hash: sid_hash.to_string(),
        source: "password".into(),
        ip: Some("203.0.113.7".into()),
        user_agent: Some("Firefox".into()),
    }
}

fn create(db: &Db, sid_hash: &str, now: i64) -> Session {
    db.write(|tx| session::create(tx, &new(sid_hash), TTL, 0, now))
        .unwrap()
}

fn lookup(db: &Db, sid_hash: &str, max_age: i64, now: i64) -> Option<Session> {
    db.read(|c| session::lookup(c, sid_hash, TTL, max_age, now))
        .unwrap()
}

fn count(db: &Db) -> usize {
    db.read(session::list).unwrap().len()
}

#[test]
fn create_validates_and_needs_owner() {
    let db = Db::open_temp().unwrap();
    let e = db
        .write(|tx| session::create(tx, &new(&hash(1)), TTL, 0, T0))
        .unwrap_err();
    assert!(e.is_constraint(), "no owner -> FK violation, got {e}");

    let db = with_owner();
    for bad in ["abc", &"A".repeat(64), &"g".repeat(64)] {
        let e = db
            .write(|tx| session::create(tx, &new(bad), TTL, 0, T0))
            .unwrap_err();
        assert!(matches!(e, Error::Invalid { .. }), "{bad}: {e}");
    }
    let mut n = new(&hash(1));
    n.source = String::new();
    assert!(matches!(
        db.write(|tx| session::create(tx, &n, TTL, 0, T0)),
        Err(Error::Invalid { .. })
    ));
    let mut n = new(&hash(1));
    n.user_agent = Some("x".repeat(1000));
    let s = db.write(|tx| session::create(tx, &n, TTL, 0, T0)).unwrap();
    assert_eq!(s.user_agent.as_ref().unwrap().len(), 300);
    assert_eq!(lookup(&db, &hash(1), 0, T0), Some(s.clone()));
    // Duplicate hash is refused by the primary key.
    assert!(db
        .write(|tx| session::create(tx, &n, TTL, 0, T0))
        .unwrap_err()
        .is_constraint());
    assert_eq!(s.short_id(), &hash(1)[..8]);
}

#[test]
fn idle_and_absolute_expiry() {
    let db = with_owner();
    let s = create(&db, &hash(1), T0);
    assert!(
        lookup(&db, &hash(1), 0, T0 + TTL).is_some(),
        "exactly at ttl is still live"
    );
    assert!(
        lookup(&db, &hash(1), 0, T0 + TTL + 1).is_none(),
        "idle timeout"
    );
    assert!(s.is_live(TTL, 0, T0 + TTL) && !s.is_live(TTL, 0, T0 + TTL + 1));
    assert_eq!(s.remaining(TTL, T0 + 100), TTL - 100);
    assert_eq!(s.remaining(TTL, T0 + TTL * 2), 0);
    assert!(lookup(&db, "nope", 0, T0).is_none());

    // Sliding window: keep touching it; the absolute max age still ends it.
    let max_age = 2 * TTL;
    let mut now = T0;
    while now < T0 + max_age {
        now += TTL / 2;
        let live = lookup(&db, &hash(1), max_age, now);
        assert_eq!(live.is_some(), now - T0 <= max_age, "at +{}", now - T0);
        db.write(|tx| session::touch_many(tx, &BTreeMap::from([(hash(1), now)])))
            .unwrap();
    }
    assert!(
        lookup(&db, &hash(1), max_age, T0 + max_age + 1).is_none(),
        "absolute max age"
    );
    assert!(
        lookup(&db, &hash(1), 0, T0 + max_age + 1).is_some(),
        "fine without max age"
    );

    // prune removes both kinds; lookup itself never writes.
    create(&db, &hash(2), T0 + max_age);
    assert_eq!(count(&db), 2);
    let n = db
        .write(|tx| session::prune(tx, TTL, max_age, T0 + max_age + 1))
        .unwrap();
    assert_eq!(n, 1);
    assert!(lookup(&db, &hash(2), max_age, T0 + max_age + 1).is_some());
    let n = db
        .write(|tx| session::prune(tx, TTL, 0, T0 + max_age + TTL + 1))
        .unwrap();
    assert_eq!(n, 1);
    assert_eq!(count(&db), 0);
}

#[test]
fn revoke_variants() {
    let db = with_owner();
    // Two hashes sharing their first 10 chars, one distinct.
    let a = format!("abcdef0123{}", "0".repeat(54));
    let b = format!("abcdef0123{}", "1".repeat(54));
    let c = format!("ffff{}", "2".repeat(60));
    for h in [&a, &b, &c] {
        create(&db, h, T0);
    }

    // Prefix validation.
    for bad in ["abcdef0", "abcdef0x", "abcdef01%", "abcdef01_", ""] {
        let e = db.write(|tx| session::revoke_prefix(tx, bad)).unwrap_err();
        assert!(matches!(e, Error::Invalid { .. }), "{bad:?}: {e}");
    }
    // Ambiguous prefix: refused, nothing deleted.
    let e = db
        .write(|tx| session::revoke_prefix(tx, "abcdef01"))
        .unwrap_err();
    assert!(matches!(e, Error::Conflict(_)), "{e}");
    assert_eq!(count(&db), 3);
    // Unique prefix (uppercase and whitespace tolerated).
    assert_eq!(
        db.write(|tx| session::revoke_prefix(tx, " ABCDEF01231 "))
            .unwrap(),
        1
    );
    assert!(lookup(&db, &b, 0, T0).is_none());
    assert!(lookup(&db, &a, 0, T0).is_some());
    // No match.
    assert_eq!(
        db.write(|tx| session::revoke_prefix(tx, "12345678"))
            .unwrap(),
        0
    );
    // Full hash works as a prefix too.
    assert_eq!(db.write(|tx| session::revoke_prefix(tx, &c)).unwrap(), 1);

    // revoke / revoke_others / revoke_all.
    create(&db, &b, T0);
    create(&db, &c, T0);
    assert!(db.write(|tx| session::revoke(tx, &a)).unwrap());
    assert!(!db.write(|tx| session::revoke(tx, &a)).unwrap());
    assert_eq!(db.write(|tx| session::revoke_others(tx, &b)).unwrap(), 1);
    assert_eq!(db.read(session::list).unwrap()[0].sid_hash, b);
    create(&db, &a, T0);
    assert_eq!(db.write(session::revoke_all).unwrap(), 2);
    assert_eq!(count(&db), 0);

    // Deleting the owner cascades.
    create(&db, &a, T0);
    db.write(|tx| Ok(tx.execute("DELETE FROM owner", [])?))
        .unwrap();
    assert_eq!(count(&db), 0);
}

#[test]
fn alias_and_user_agent() {
    let db = with_owner();
    create(&db, &hash(1), T0);
    db.write(|tx| session::set_alias(tx, &hash(1), Some(" laptop ")))
        .unwrap();
    db.write(|tx| session::set_user_agent(tx, &hash(1), Some(&"u".repeat(400))))
        .unwrap();
    let s = lookup(&db, &hash(1), 0, T0).unwrap();
    assert_eq!(s.alias.as_deref(), Some("laptop"));
    assert_eq!(s.user_agent.unwrap().chars().count(), 300);
    db.write(|tx| session::set_alias(tx, &hash(1), Some("")))
        .unwrap();
    assert_eq!(lookup(&db, &hash(1), 0, T0).unwrap().alias, None);
    assert!(matches!(
        db.write(|tx| session::set_alias(tx, &hash(1), Some(&"x".repeat(65)))),
        Err(Error::Invalid { .. })
    ));
    assert!(matches!(
        db.write(|tx| session::set_alias(tx, &hash(2), Some("x"))),
        Err(Error::NotFound(_))
    ));
    db.write(|tx| session::set_user_agent(tx, &hash(2), Some("gone")))
        .unwrap();
}

#[test]
fn cap_evicts_oldest() {
    let db = with_owner();
    db.write(|tx: &Transaction<'_>| {
        for i in 0..MAX_SESSIONS as u64 {
            session::create(tx, &new(&hash(i)), TTL, 0, T0 + i as i64)?;
        }
        Ok(())
    })
    .unwrap();
    assert_eq!(count(&db), MAX_SESSIONS);
    // Session 0 was used recently, so session 1 is now the oldest by last_seen.
    let now = T0 + MAX_SESSIONS as i64;
    db.write(|tx| session::touch_many(tx, &BTreeMap::from([(hash(0), now)])))
        .unwrap();
    create(&db, &hash(5000), now);
    assert_eq!(count(&db), MAX_SESSIONS);
    assert!(lookup(&db, &hash(1), 0, now).is_none(), "oldest evicted");
    assert!(lookup(&db, &hash(0), 0, now).is_some());
    assert!(lookup(&db, &hash(5000), 0, now).is_some());
    // Expired sessions are pruned first, so no live one is evicted needlessly.
    // Sessions 1..=900 (last_seen T0+i) are idle-expired at `later`.
    let later = T0 + 900 + TTL + 1;
    create(&db, &hash(6000), later);
    // Left: 0, 901..=999, 5000, 6000.
    assert_eq!(count(&db), 1 + 99 + 1 + 1);
}

#[test]
fn last_seen_buffer_coalesces() {
    let db = with_owner();
    let s = create(&db, &hash(1), T0);
    let mut buf = LastSeenBuffer::default();
    assert!(!buf.note(&s, T0 + 30), "fresh enough: nothing to write");
    assert!(buf.note(&s, T0 + 60));
    assert!(buf.note(&s, T0 + 70), "already pending: advanced in place");
    assert!(buf.note(&s, T0 + 65), "never moves back");
    assert_eq!(buf.pending.len(), 1);
    assert_eq!(buf.pending[&hash(1)], T0 + 70);
    // Not yet written: the DB still has the old value.
    assert_eq!(lookup(&db, &hash(1), 0, T0 + 70).unwrap().last_seen, T0);

    // A deleted session in the batch is skipped.
    buf.pending.insert(hash(2), T0 + 70);
    assert_eq!(buf.flush(&db).unwrap(), 1);
    assert!(buf.pending.is_empty());
    assert_eq!(buf.flush(&db).unwrap(), 0);
    let s = lookup(&db, &hash(1), 0, T0 + 70).unwrap();
    assert_eq!(s.last_seen, T0 + 70);
    // touch_many never moves backwards.
    db.write(|tx| session::touch_many(tx, &BTreeMap::from([(hash(1), T0 + 10)])))
        .unwrap();
    assert_eq!(
        lookup(&db, &hash(1), 0, T0 + 70).unwrap().last_seen,
        T0 + 70
    );
    // The flush is what slides the window.
    assert!(lookup(&db, &hash(1), 0, T0 + 70 + TTL).is_some());

    // Bounded memory.
    let mut buf = LastSeenBuffer::default();
    for i in 0..(MAX_SESSIONS as u64 + 50) {
        let mut s = s.clone();
        s.sid_hash = hash(i + 10);
        buf.note(&s, T0 + 1000);
    }
    assert_eq!(buf.pending.len(), MAX_SESSIONS);
}

#[test]
fn control_request_lifecycle() {
    let db = Db::open_temp().unwrap();
    assert!(matches!(
        db.write(|tx| control::request(tx, ControlKind::LimiterReset, "", T0)),
        Err(Error::Invalid { .. })
    ));
    let a = db
        .write(|tx| control::request(tx, ControlKind::LimiterReset, "cli:root", T0))
        .unwrap();
    let b = db
        .write(|tx| control::request(tx, ControlKind::ReloadAll, "cli:root", T0 + 1))
        .unwrap();
    let p = db.read(control::pending).unwrap();
    assert_eq!(
        p.iter().map(|r| (r.id, r.kind)).collect::<Vec<_>>(),
        vec![(a, ControlKind::LimiterReset), (b, ControlKind::ReloadAll)]
    );
    assert_eq!(p[0].requested_by, "cli:root");
    assert_eq!(p[0].done_at, None);

    db.write(|tx| control::complete(tx, a, &"r".repeat(600), T0 + 2))
        .unwrap();
    let r = db.read(|c| control::get(c, a)).unwrap().unwrap();
    assert_eq!(r.done_at, Some(T0 + 2));
    assert_eq!(r.result.as_ref().unwrap().len(), 500);
    assert!(r.acknowledged());
    // Second completion does not overwrite the first.
    db.write(|tx| control::complete(tx, a, "again", T0 + 3))
        .unwrap();
    assert_eq!(
        db.read(|c| control::get(c, a)).unwrap().unwrap().done_at,
        Some(T0 + 2)
    );
    assert!(matches!(
        db.write(|tx| control::complete(tx, 999, "x", T0)),
        Err(Error::NotFound(_))
    ));
    assert_eq!(db.read(control::pending).unwrap().len(), 1);
    assert!(db.read(|c| control::get(c, 999)).unwrap().is_none());
    assert_eq!(
        "reload_all".parse::<ControlKind>().unwrap(),
        ControlKind::ReloadAll
    );

    // Already done: wait_for_ack returns at once.
    let r = control::wait_for_ack(&db, a, Duration::from_secs(5))
        .unwrap()
        .unwrap();
    assert_eq!(r.id, a);
    assert!(matches!(
        control::wait_for_ack(&db, 999, Duration::ZERO),
        Err(Error::NotFound(_))
    ));
}

#[test]
fn ack_timeout_expires_request() {
    let db = Db::open_temp().unwrap();
    let id = db
        .write(|tx| control::request(tx, ControlKind::LimiterReset, "cli:test", T0))
        .unwrap();
    let started = Instant::now();
    assert!(control::wait_for_ack(&db, id, Duration::from_millis(200))
        .unwrap()
        .is_none());
    assert!(started.elapsed() >= Duration::from_millis(200));
    assert!(started.elapsed() < Duration::from_secs(2));
    // Expired: no longer pending, so a server started later does not act on it.
    assert!(db.read(control::pending).unwrap().is_empty());
    let r = db.read(|c| control::get(c, id)).unwrap().unwrap();
    assert_eq!(r.result.as_deref(), Some(control::EXPIRED));
    assert!(!r.acknowledged());
    // A late server completion does not override it.
    db.write(|tx| control::complete(tx, id, "cleared", T0 + 9))
        .unwrap();
    assert!(control::wait_for_ack(&db, id, Duration::ZERO)
        .unwrap()
        .is_none());
}

#[test]
fn cli_and_server_handles_on_one_file() {
    let server = with_owner();
    let cli = Db::open(server.state_dir()).unwrap();

    // Server creates a session; CLI sees it, signs it out; the next server lookup fails.
    create(&server, &hash(42), T0);
    let rows = cli.read(session::list).unwrap();
    assert_eq!(rows.len(), 1);
    let short = rows[0].short_id().to_string();
    assert_eq!(
        cli.write(|tx| session::revoke_prefix(tx, &short)).unwrap(),
        1
    );
    assert!(lookup(&server, &hash(42), 0, T0).is_none());
    create(&server, &hash(43), T0);
    assert_eq!(cli.write(session::revoke_all).unwrap(), 1);
    assert!(lookup(&server, &hash(43), 0, T0).is_none());

    // Control request answered by a server thread polling `pending`.
    let srv = server.clone();
    let worker = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            let reqs = srv.read(control::pending).unwrap();
            if let Some(r) = reqs.first() {
                srv.write(|tx| {
                    control::complete(tx, r.id, "cleared 2 cooldowns", memora_state::now())
                })
                .unwrap();
                return r.kind;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("server never saw the request");
    });
    let id = cli
        .write(|tx| {
            control::request(
                tx,
                ControlKind::LimiterReset,
                "cli:root",
                memora_state::now(),
            )
        })
        .unwrap();
    let ack = control::wait_for_ack(&cli, id, Duration::from_secs(3))
        .unwrap()
        .expect("acked");
    assert_eq!(ack.result.as_deref(), Some("cleared 2 cooldowns"));
    assert_eq!(worker.join().unwrap(), ControlKind::LimiterReset);
}

#[test]
fn revoked_reasons_are_remembered_for_a_while() {
    use memora_state::session::{remember_revoked, revoked_reason, REVOKED_REASON_TTL};
    let a = "ab".repeat(32);
    let b = "cd".repeat(32);
    remember_revoked(
        [a.clone(), "not-a-hash".to_string()],
        "password_changed",
        1_000,
    );
    assert_eq!(
        revoked_reason(&a, 1_001).as_deref(),
        Some("password_changed")
    );
    assert_eq!(revoked_reason(&b, 1_001), None);
    assert_eq!(revoked_reason("not-a-hash", 1_001), None);
    assert_eq!(revoked_reason(&a, 1_000 + REVOKED_REASON_TTL + 1), None);
}
