//! Activity log, access stack, retention.

use memora_state::access::{self, AccessAction, AccessRule, AccessStack, RuleKind};
use memora_state::activity::{self, ActivityQuery, NewActivity};
use memora_state::retention::{self, RetentionPolicy};
use memora_state::{Db, Error};
use rusqlite::params;

const DAY: i64 = 86_400;

fn ev(db: &Db, event: &str, ip: Option<&str>, actor: Option<&str>, detail: &str, at: i64) -> i64 {
    db.write(|tx| {
        activity::log(
            tx,
            &NewActivity {
                event,
                ip,
                actor,
                detail,
            },
            at,
        )
    })
    .unwrap()
}

#[test]
fn log_and_recent_newest_first() {
    let db = Db::open_temp().unwrap();
    ev(
        &db,
        "login_ok",
        Some("10.0.0.1"),
        Some("alice"),
        "browser",
        100,
    );
    ev(
        &db,
        "auth_fail",
        Some("10.0.0.2"),
        None,
        "bad password",
        200,
    );
    ev(
        &db,
        "key_created",
        None,
        Some("cli"),
        "Deploy_Bot (memora-cli)",
        200,
    );
    ev(&db, "key_fail", Some("192.168.1.9"), None, "", 50);

    let all = db.read(|c| activity::recent(c, 10, None)).unwrap();
    let names: Vec<_> = all.iter().map(|e| e.event.as_str()).collect();
    // at DESC, then id DESC for ties.
    assert_eq!(names, ["key_created", "auth_fail", "login_ok", "key_fail"]);

    let two = db.read(|c| activity::recent(c, 2, None)).unwrap();
    assert_eq!(two.len(), 2);
    assert!(db
        .read(|c| activity::recent(c, 0, None))
        .unwrap()
        .is_empty());

    // Case-insensitive text query over event / ip / actor / detail.
    let q = |s: &str| db.read(|c| activity::recent(c, 10, Some(s))).unwrap();
    assert_eq!(q("ALICE").len(), 1);
    assert_eq!(q("192.168").len(), 1);
    assert_eq!(q("deploy_bot")[0].event, "key_created");
    assert_eq!(q("PASSWORD")[0].event, "auth_fail");
    assert_eq!(q("_fail").len(), 2); // '_' is literal, not a LIKE wildcard
    assert_eq!(q("%").len(), 0);
    assert_eq!(q("   ").len(), 4);

    // Legacy JSON shape.
    let j = q("alice")[0].to_json();
    assert_eq!(
        j,
        serde_json::json!({"at": 100, "event": "login_ok", "ip": "10.0.0.1", "user": "alice", "detail": "browser"})
    );
}

#[test]
fn filter_by_events_failures_and_cursor() {
    let db = Db::open_temp().unwrap();
    for (i, e) in [
        "login_ok",
        "auth_fail",
        "cooldown",
        "logout",
        "key_fail",
        "login_fail",
        "code_burned",
    ]
    .iter()
    .enumerate()
    {
        ev(&db, e, None, None, "", 1000 + i as i64);
    }
    let fails = db.read(|c| activity::recent_failures(c, 100)).unwrap();
    let names: Vec<_> = fails.iter().map(|e| e.event.as_str()).collect();
    assert_eq!(
        names,
        [
            "code_burned",
            "login_fail",
            "key_fail",
            "cooldown",
            "auth_fail"
        ]
    );
    assert_eq!(
        db.read(|c| activity::recent_failures(c, 2)).unwrap().len(),
        2
    );

    let only = db
        .read(|c| {
            activity::query(
                c,
                10,
                &ActivityQuery {
                    events: &["logout", "login_ok"],
                    ..Default::default()
                },
            )
        })
        .unwrap();
    assert_eq!(
        only.iter().map(|e| e.event.as_str()).collect::<Vec<_>>(),
        ["logout", "login_ok"]
    );

    // events + failures_only = intersection.
    let both = db
        .read(|c| {
            activity::query(
                c,
                10,
                &ActivityQuery {
                    events: &["logout", "cooldown"],
                    failures_only: true,
                    ..Default::default()
                },
            )
        })
        .unwrap();
    assert_eq!(both.len(), 1);
    assert_eq!(both[0].event, "cooldown");

    // events + text + cursor combine.
    let page1 = db.read(|c| activity::recent(c, 3, None)).unwrap();
    let last = page1.last().unwrap();
    let page2 = db
        .read(|c| {
            activity::query(
                c,
                10,
                &ActivityQuery {
                    before: Some((last.at, last.id)),
                    ..Default::default()
                },
            )
        })
        .unwrap();
    assert_eq!(page1.len() + page2.len(), 7);
    assert!(page2.iter().all(|e| e.at < last.at));
}

#[test]
fn log_validates_and_truncates() {
    let db = Db::open_temp().unwrap();
    let r = db.write(|tx| {
        activity::log(
            tx,
            &NewActivity {
                event: "Bad-Name",
                ip: None,
                actor: None,
                detail: "",
            },
            1,
        )
    });
    assert!(matches!(r, Err(Error::Invalid { .. })));
    let long = "é".repeat(5000);
    ev(&db, "x", Some(&"1".repeat(60)), Some(&long), &long, 1);
    let e = &db.read(|c| activity::recent(c, 1, None)).unwrap()[0];
    assert_eq!(e.detail.chars().count(), 2000);
    assert_eq!(e.actor.as_ref().unwrap().chars().count(), 64);
    assert_eq!(e.ip.as_ref().unwrap().len(), 45);
    // Empty ip/actor become NULL.
    ev(&db, "y", Some(""), Some(""), "", 2);
    let e = &db.read(|c| activity::recent(c, 1, None)).unwrap()[0];
    assert_eq!((e.ip.clone(), e.actor.clone()), (None, None));
}

#[test]
fn log_activity_never_fails() {
    let db = Db::open_temp().unwrap();
    activity::log_activity(&db, "signin", Some("1.2.3.4"), Some("bob"), "ok");
    activity::log_activity(&db, "NOT VALID", None, None, ""); // dropped silently
    let all = db.read(|c| activity::recent(c, 10, None)).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].event, "signin");
    assert!(all[0].at > 1_600_000_000);
    assert_eq!(db.read(activity::count).unwrap(), 1);
}

fn rule(id: &str, kind: RuleKind, value: &str, action: AccessAction) -> AccessRule {
    AccessRule {
        id: id.into(),
        kind,
        value: value.into(),
        action,
        enabled: true,
        note: String::new(),
    }
}

#[test]
fn access_roundtrip_preserves_order_and_default() {
    let db = Db::open_temp().unwrap();
    let fresh = db.read(access::load).unwrap();
    assert_eq!(
        fresh,
        AccessStack {
            rules: vec![],
            default_allow: true
        }
    );
    assert_eq!(fresh, AccessStack::default());

    let mut stack = AccessStack {
        rules: vec![
            rule(
                "z-first",
                RuleKind::Cidr,
                "10.0.0.0/24",
                AccessAction::Allow,
            ),
            rule("a-second", RuleKind::Ip, "2001:db8::1", AccessAction::Block),
            rule(
                "m",
                RuleKind::Range,
                "192.168.1.10 - 192.168.1.20",
                AccessAction::Allow,
            ),
            rule("d", RuleKind::Domain, "*.Example.com", AccessAction::Allow),
            AccessRule {
                note: "catch-all".into(),
                enabled: false,
                ..rule("all", RuleKind::All, "*", AccessAction::Block)
            },
        ],
        default_allow: false,
    };
    db.write(|tx| access::save(tx, &stack)).unwrap();
    assert_eq!(db.read(access::load).unwrap(), stack);

    // Reorder + shrink, flip default.
    stack.rules.reverse();
    stack.rules.pop();
    stack.default_allow = true;
    db.write(|tx| access::save(tx, &stack)).unwrap();
    assert_eq!(db.read(access::load).unwrap(), stack);
    let positions: Vec<i64> = db
        .read(|c| {
            let mut s = c.prepare("SELECT position FROM access_rule ORDER BY position")?;
            let v = s
                .query_map([], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()?;
            Ok(v)
        })
        .unwrap();
    assert_eq!(positions, [0, 1, 2, 3]);

    // JSON shape matches access_stack.json.
    let j = serde_json::to_value(&stack.rules[0]).unwrap();
    assert_eq!(j["kind"], "all");
    assert_eq!(j["action"], "block");
}

#[test]
fn access_save_rejects_bad_rules_atomically() {
    let db = Db::open_temp().unwrap();
    let good = AccessStack {
        rules: vec![rule("ok", RuleKind::Ip, "1.2.3.4", AccessAction::Block)],
        default_allow: true,
    };
    db.write(|tx| access::save(tx, &good)).unwrap();

    let bad_rules = [
        rule("x", RuleKind::Ip, " 1.2.3.4", AccessAction::Block),
        rule("x", RuleKind::Ip, "1.2.3", AccessAction::Block),
        rule("x", RuleKind::Cidr, "10.0.0.0/33", AccessAction::Block),
        rule("x", RuleKind::Cidr, "10.0.0.0", AccessAction::Block),
        rule("x", RuleKind::Cidr, "::/129", AccessAction::Block),
        rule("x", RuleKind::Range, "10.0.0.1", AccessAction::Block),
        rule("x", RuleKind::Range, "::1-::2", AccessAction::Block),
        rule("x", RuleKind::Domain, "", AccessAction::Block),
        rule("x", RuleKind::Domain, "exa mple.com", AccessAction::Block),
        rule("x", RuleKind::Domain, "*.", AccessAction::Block),
        rule("", RuleKind::All, "", AccessAction::Block),
        rule(&"i".repeat(41), RuleKind::All, "", AccessAction::Block),
        rule("x", RuleKind::All, &"v".repeat(256), AccessAction::Block),
    ];
    for r in bad_rules {
        let s = AccessStack {
            rules: vec![r.clone()],
            default_allow: false,
        };
        let res = db.write(|tx| access::save(tx, &s));
        assert!(matches!(res, Err(Error::Invalid { .. })), "accepted {r:?}");
    }
    let dup = AccessStack {
        rules: vec![
            rule("d", RuleKind::All, "", AccessAction::Block),
            rule("d", RuleKind::All, "", AccessAction::Allow),
        ],
        default_allow: false,
    };
    assert!(matches!(
        db.write(|tx| access::save(tx, &dup)),
        Err(Error::Invalid { .. })
    ));
    // Nothing changed.
    assert_eq!(db.read(access::load).unwrap(), good);
    assert!(access::validate_rule(&rule("x", RuleKind::Cidr, "::/0", AccessAction::Allow)).is_ok());
    assert!(access::validate_rule(&rule(
        "x",
        RuleKind::Domain,
        "localhost",
        AccessAction::Allow
    ))
    .is_ok());
}

fn count(db: &Db, sql: &str) -> i64 {
    db.read(|c| Ok(c.query_row(sql, [], |r| r.get(0))?))
        .unwrap()
}

#[test]
fn retention_activity_age_and_row_cap() {
    let db = Db::open_temp().unwrap();
    let now = 1_000 * DAY;
    db.write(|tx| {
        for i in 0..50 {
            activity::log(
                tx,
                &NewActivity {
                    event: "old",
                    ip: None,
                    actor: None,
                    detail: "",
                },
                now - 400 * DAY + i,
            )?;
        }
        for i in 0..120 {
            activity::log(
                tx,
                &NewActivity {
                    event: "new",
                    ip: None,
                    actor: None,
                    detail: "",
                },
                now - 10 * DAY + i,
            )?;
        }
        Ok(())
    })
    .unwrap();
    let policy = RetentionPolicy {
        activity_max_rows: 100,
        batch: 7,
        ..Default::default()
    };

    // One batch is bounded.
    let rep = db
        .write(|tx| retention::prune_batch(tx, &policy, now))
        .unwrap();
    assert_eq!(rep.activity, 7);

    let rep = retention::prune(&db, &policy, now).unwrap();
    assert_eq!(rep.activity, 170 - 100 - 7);
    assert_eq!(count(&db, "SELECT count(*) FROM activity"), 100);
    assert_eq!(
        count(&db, "SELECT count(*) FROM activity WHERE event = 'old'"),
        0
    );
    // The newest 100 are the ones kept.
    assert_eq!(
        count(&db, "SELECT min(at) FROM activity"),
        now - 10 * DAY + 20
    );
    // Idempotent.
    assert_eq!(
        retention::prune(&db, &policy, now).unwrap(),
        Default::default()
    );

    // Age alone (row cap not reached): default policy keeps 365 days.
    let rep = retention::prune(&db, &RetentionPolicy::default(), now + 360 * DAY).unwrap();
    assert_eq!(rep.activity, 100);
}

#[test]
fn retention_key_events_sessions_control() {
    let db = Db::open_temp().unwrap();
    let now = 1_000 * DAY;
    let hash = "a".repeat(64);
    db.write(|tx| {
        tx.execute(
            "INSERT INTO owner (id, username, password_hash, created_at, password_changed_at)
             VALUES (1, 'alice', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', 1, 1)",
            [],
        )?;
        // A live key (not trashed: keys::purge is not exercised here).
        tx.execute(
            "INSERT INTO api_key (id, name, hash, prefix, created_at) VALUES ('k_1', 'k', ?1, 'mk_a', 1)",
            params![hash],
        )?;
        for i in 0..20 {
            let at = if i < 8 { now - 31 * DAY } else { now - DAY };
            tx.execute(
                "INSERT INTO api_key_event (key_id, at, ip, tool) VALUES ('k_1', ?1, '1.1.1.1', 'search')",
                params![at + i],
            )?;
        }
        let sid = |c: char| c.to_string().repeat(64);
        // ttl default 10800: idle 4h -> gone; idle 1h -> live.
        for (c, created, seen) in [('1', now - 5 * 3600, now - 4 * 3600), ('2', now - 2 * 3600, now - 3600)] {
            tx.execute(
                "INSERT INTO session (sid_hash, source, created_at, last_seen) VALUES (?1, 'password', ?2, ?3)",
                params![sid(c), created, seen],
            )?;
        }
        // Control: done 2 days ago (delete), done 1h ago (keep), pending 2h (expire),
        // pending 1 min (keep).
        for (req, done) in [(now - 3 * DAY, Some(now - 2 * DAY)), (now - 7200, Some(now - 3600)), (now - 7200, None), (now - 60, None)] {
            tx.execute(
                "INSERT INTO control_request (kind, requested_at, requested_by, done_at) VALUES ('reload_all', ?1, 'cli:root', ?2)",
                params![req, done],
            )?;
        }
        Ok(())
    })
    .unwrap();

    let policy = RetentionPolicy {
        key_event_max_rows: 10,
        batch: 3,
        ..Default::default()
    };
    let rep = retention::prune(&db, &policy, now).unwrap();
    assert_eq!(rep.key_events, 10); // 8 by age, then 2 more by the 10-row cap
    assert_eq!(count(&db, "SELECT count(*) FROM api_key_event"), 10);
    assert_eq!(
        count(&db, "SELECT min(at) FROM api_key_event"),
        now - DAY + 10
    );
    assert_eq!(rep.sessions, 1);
    assert_eq!(count(&db, "SELECT count(*) FROM session"), 1);
    assert_eq!(rep.control_deleted, 1);
    assert_eq!(rep.control_expired, 1);
    assert_eq!(
        count(
            &db,
            "SELECT count(*) FROM control_request WHERE result = 'expired' AND done_at IS NOT NULL"
        ),
        1
    );
    assert_eq!(
        count(
            &db,
            "SELECT count(*) FROM control_request WHERE done_at IS NULL"
        ),
        1
    );
    assert_eq!(rep.keys_purged, 0);
    assert_eq!(count(&db, "SELECT count(*) FROM api_key"), 1);
}
