//! Keys, tool catalog/switches, effective access, usage buffer and events.

use memora_state::keys::{self, ApiKey, KeyPatch, NewApiKey, Scope, ToolDenial, ToolGrant};
use memora_state::usage::{self, UsageBuffer, MAX_PENDING_EVENTS};
use memora_state::{tools, Db, Domain, Error};
use std::collections::BTreeSet;

fn h(c: char) -> String {
    std::iter::repeat_n(c, 64).collect()
}

fn set(names: &[&str]) -> BTreeSet<String> {
    names.iter().map(|s| s.to_string()).collect()
}

fn new_key(id: &str, hash: &str, tools: ToolGrant) -> NewApiKey {
    NewApiKey {
        id: id.into(),
        name: "agent".into(),
        hash: hash.into(),
        prefix: "memora_live_".into(),
        scopes: Scope::default_set(),
        tools,
    }
}

fn db_with_catalog() -> Db {
    let db = Db::open_temp().unwrap();
    db.write(|tx| tools::sync_catalog(tx, &["search", "read_note", "delete_note"]))
        .unwrap();
    db
}

fn create(db: &Db, k: NewApiKey) -> memora_state::Result<ApiKey> {
    db.write(|tx| keys::create(tx, &k, 100))
}

#[test]
fn create_get_list_and_find_by_hash() {
    let db = db_with_catalog();
    let a = create(&db, new_key("k_a", &h('a'), ToolGrant::All)).unwrap();
    assert!(a.enabled && a.has_scope(Scope::Mcp) && !a.has_scope(Scope::Admin));
    assert_eq!(a.tools, ToolGrant::All);
    assert_eq!(
        (a.created_at, a.grace_until, a.deleted_at),
        (100, None, None)
    );
    let b = create(
        &db,
        new_key("k_b", &h('b'), ToolGrant::Only(set(&["search"]))),
    )
    .unwrap();
    assert_eq!(b.tools, ToolGrant::Only(set(&["search"])));
    let empty = create(
        &db,
        new_key("k_c", &h('c'), ToolGrant::Only(BTreeSet::new())),
    )
    .unwrap();
    assert_eq!(empty.tools, ToolGrant::Only(BTreeSet::new()));

    db.read(|c| {
        assert_eq!(keys::list(c)?.len(), 3);
        assert_eq!(keys::find_by_hash(c, &h('b'))?, Some(b.clone()));
        assert_eq!(keys::find_by_hash(c, &h('d'))?, None);
        assert_eq!(keys::get(c, "k_a")?, Some(a.clone()));
        assert_eq!(keys::get(c, "k_zz")?, None);
        Ok(())
    })
    .unwrap();
}

#[test]
fn find_by_hash_uses_an_index() {
    let db = db_with_catalog();
    let plan: Vec<String> = db
        .read(|c| {
            let mut st = c.prepare(
                "EXPLAIN QUERY PLAN SELECT id FROM api_key WHERE hash = ?1 AND deleted_at IS NULL",
            )?;
            let rows = st.query_map([h('a')], |r| r.get::<_, String>(3))?;
            Ok(rows.collect::<rusqlite::Result<_>>()?)
        })
        .unwrap();
    assert!(
        plan.iter()
            .any(|p| p.contains("USING INDEX") || p.contains("USING COVERING INDEX")),
        "{plan:?}"
    );
}

#[test]
fn invalid_input_and_constraints_map_to_invalid_or_conflict() {
    let db = db_with_catalog();
    create(&db, new_key("k_a", &h('a'), ToolGrant::All)).unwrap();

    // Duplicates (detected by the DB) -> Conflict.
    let e = create(&db, new_key("k_a", &h('b'), ToolGrant::All)).unwrap_err();
    assert!(matches!(e, Error::Conflict(_)), "{e}");
    let e = create(&db, new_key("k_b", &h('a'), ToolGrant::All)).unwrap_err();
    assert!(matches!(e, Error::Conflict(_)), "{e}");

    // Rust-side validation -> Invalid with the field.
    let cases: Vec<(NewApiKey, &str)> = vec![
        (new_key("x_bad", &h('c'), ToolGrant::All), "id"),
        (new_key("k_c", "", ToolGrant::All), "hash"),
        (new_key("k_c", &h('C'), ToolGrant::All), "hash"),
        (
            new_key("k_c", &h('c'), ToolGrant::Only(set(&["nope"]))),
            "tools",
        ),
        (
            NewApiKey {
                name: String::new(),
                ..new_key("k_c", &h('c'), ToolGrant::All)
            },
            "name",
        ),
        (
            NewApiKey {
                prefix: "abc".into(),
                ..new_key("k_c", &h('c'), ToolGrant::All)
            },
            "prefix",
        ),
    ];
    for (k, field) in cases {
        match create(&db, k) {
            Err(Error::Invalid { field: f, .. }) => assert_eq!(f, field),
            other => panic!("{field}: {other:?}"),
        }
    }
    // Nothing half-written by the failed transactions.
    assert_eq!(db.read(keys::list).unwrap().len(), 1);

    // Updates: unknown tool -> Invalid, unknown/trashed id -> NotFound.
    let e = db
        .write(|tx| {
            keys::update(
                tx,
                "k_a",
                &KeyPatch {
                    tools: Some(ToolGrant::Only(set(&["zzz"]))),
                    ..Default::default()
                },
            )
        })
        .unwrap_err();
    assert!(matches!(e, Error::Invalid { field: "tools", .. }), "{e}");
    let e = db
        .write(|tx| keys::update(tx, "k_none", &KeyPatch::default()))
        .unwrap_err();
    assert!(matches!(e, Error::NotFound(_)));

    // Raw SQL backstop: a per-key tool unknown to the catalog fails at the DB level.
    let e = db
        .write(|tx| {
            tx.execute("UPDATE api_key SET tools_all = 0 WHERE id = 'k_a'", [])?;
            Ok(tx.execute("INSERT INTO api_key_tool VALUES ('k_a', 'ghost')", [])?)
        })
        .unwrap_err();
    assert!(e.is_constraint(), "{e}");
}

#[test]
fn update_scopes_tools_name_enabled() {
    let db = db_with_catalog();
    create(&db, new_key("k_a", &h('a'), ToolGrant::All)).unwrap();
    let k = db
        .write(|tx| {
            keys::update(
                tx,
                "k_a",
                &KeyPatch {
                    name: Some("renamed".into()),
                    enabled: Some(false),
                    scopes: Some([Scope::Read, Scope::Admin].into_iter().collect()),
                    tools: Some(ToolGrant::Only(set(&["search", "read_note"]))),
                },
            )
        })
        .unwrap();
    assert_eq!(k.name, "renamed");
    assert!(!k.enabled && k.has_scope(Scope::Admin) && !k.has_scope(Scope::Mcp));
    assert_eq!(k.tools, ToolGrant::Only(set(&["search", "read_note"])));
    // Back to "*": the trigger clears the list.
    let k = db
        .write(|tx| {
            keys::update(
                tx,
                "k_a",
                &KeyPatch {
                    tools: Some(ToolGrant::All),
                    ..Default::default()
                },
            )
        })
        .unwrap();
    assert_eq!(k.tools, ToolGrant::All);
    let rows: i64 = db
        .read(|c| Ok(c.query_row("SELECT count(*) FROM api_key_tool", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(rows, 0);
    // Empty scopes are allowed (key can do nothing).
    let k = db
        .write(|tx| {
            keys::update(
                tx,
                "k_a",
                &KeyPatch {
                    scopes: Some(BTreeSet::new()),
                    ..Default::default()
                },
            )
        })
        .unwrap();
    assert!(k.scopes.is_empty());
}

#[test]
fn roll_invalidates_old_hash_immediately() {
    let db = db_with_catalog();
    create(
        &db,
        new_key("k_a", &h('a'), ToolGrant::Only(set(&["search"]))),
    )
    .unwrap();
    db.write(|tx| {
        keys::update(
            tx,
            "k_a",
            &KeyPatch {
                enabled: Some(false),
                ..Default::default()
            },
        )
    })
    .unwrap();
    let k = db
        .write(|tx| keys::roll(tx, "k_a", &h('b'), "memora_new_"))
        .unwrap();
    assert_eq!(
        (k.hash.as_str(), k.prefix.as_str(), k.enabled),
        (h('b').as_str(), "memora_new_", true)
    );
    assert_eq!(k.grace_until, None);
    assert_eq!(
        k.tools,
        ToolGrant::Only(set(&["search"])),
        "permissions survive a roll"
    );
    db.read(|c| {
        assert!(keys::find_by_hash(c, &h('a'))?.is_none());
        assert_eq!(
            keys::find_by_hash(c, &h('b'))?.map(|k| k.id),
            Some("k_a".into())
        );
        Ok(())
    })
    .unwrap();
    // Same material again, unknown id, hash of another key.
    assert!(matches!(
        db.write(|tx| keys::roll(tx, "k_a", &h('b'), "memora_new_")),
        Err(Error::Invalid { .. })
    ));
    assert!(matches!(
        db.write(|tx| keys::roll(tx, "k_x", &h('c'), "memora_new_")),
        Err(Error::NotFound(_))
    ));
    create(&db, new_key("k_c", &h('c'), ToolGrant::All)).unwrap();
    assert!(matches!(
        db.write(|tx| keys::roll(tx, "k_a", &h('c'), "memora_new_")),
        Err(Error::Conflict(_))
    ));
}

#[test]
fn trash_restore_round_trip_and_purge() {
    let db = db_with_catalog();
    let orig = create(
        &db,
        new_key("k_a", &h('a'), ToolGrant::Only(set(&["read_note"]))),
    )
    .unwrap();
    create(&db, new_key("k_b", &h('b'), ToolGrant::All)).unwrap();
    let mut buf = UsageBuffer::default();
    buf.record("k_a", Some("10.0.0.1".into()), "search", None, 150);
    buf.flush(&db).unwrap();

    db.write(|tx| keys::trash(tx, "k_a", 200)).unwrap();
    db.read(|c| {
        assert!(
            keys::find_by_hash(c, &h('a'))?.is_none(),
            "trashed keys do not authenticate"
        );
        assert_eq!(
            keys::list(c)?
                .iter()
                .map(|k| k.id.as_str())
                .collect::<Vec<_>>(),
            ["k_b"]
        );
        let t = keys::list_trash(c)?;
        assert_eq!((t.len(), t[0].deleted_at), (1, Some(200)));
        assert_eq!(keys::trashed_before(c, 201)?, ["k_a"]);
        assert!(keys::trashed_before(c, 200)?.is_empty());
        Ok(())
    })
    .unwrap();
    assert!(matches!(
        db.write(|tx| keys::trash(tx, "k_a", 300)),
        Err(Error::NotFound(_))
    ));
    assert!(matches!(
        db.write(|tx| keys::update(tx, "k_a", &KeyPatch::default())),
        Err(Error::NotFound(_))
    ));
    assert!(matches!(
        db.write(|tx| keys::restore(tx, "k_b")),
        Err(Error::NotFound(_))
    ));
    // A trashed key's hash cannot be reused (it can still be restored).
    assert!(matches!(
        create(&db, new_key("k_z", &h('a'), ToolGrant::All)),
        Err(Error::Conflict(_))
    ));

    db.write(|tx| keys::restore(tx, "k_a")).unwrap();
    let back = db
        .read(|c| keys::find_by_hash(c, &h('a')))
        .unwrap()
        .unwrap();
    assert_eq!(back, orig, "restore brings back scopes and tools unchanged");
    assert_eq!(
        db.read(|c| usage::usage(c, "k_a"))
            .unwrap()
            .unwrap()
            .use_count,
        1
    );

    // Purge cascades scopes, tools, usage, events.
    db.write(|tx| keys::trash(tx, "k_a", 50)).unwrap(); // clamped to created_at
    assert_eq!(
        db.read(|c| keys::get(c, "k_a"))
            .unwrap()
            .unwrap()
            .deleted_at,
        Some(100)
    );
    assert!(db.write(|tx| keys::purge(tx, "k_a")).unwrap());
    assert!(!db.write(|tx| keys::purge(tx, "k_a")).unwrap());
    let left: i64 = db
        .read(|c| {
            Ok(c.query_row(
                "SELECT (SELECT count(*) FROM api_key_scope WHERE key_id='k_a')
                      + (SELECT count(*) FROM api_key_tool WHERE key_id='k_a')
                      + (SELECT count(*) FROM api_key_usage WHERE key_id='k_a')
                      + (SELECT count(*) FROM api_key_event WHERE key_id='k_a')",
                [],
                |r| r.get(0),
            )?)
        })
        .unwrap();
    assert_eq!(left, 0);
}

#[test]
fn key_writes_bump_keys_revision() {
    let db = db_with_catalog();
    let other = Db::open(db.state_dir()).unwrap();
    other.changed_domains().unwrap();
    create(&db, new_key("k_a", &h('a'), ToolGrant::All)).unwrap();
    assert!(other.changed_domains().unwrap().contains(&Domain::Keys));
    db.write(|tx| tools::set_enabled(tx, "search", false, 5))
        .unwrap();
    assert!(other.changed_domains().unwrap().contains(&Domain::Tools));
}

#[test]
fn catalog_sync_add_retire_revive() {
    let db = Db::open_temp().unwrap();
    let s = db
        .write(|tx| tools::sync_catalog(tx, &["search", "read_note", "delete_note"]))
        .unwrap();
    assert_eq!(s.added, ["delete_note", "read_note", "search"]);
    let again = db
        .write(|tx| tools::sync_catalog(tx, &["search", "read_note", "delete_note"]))
        .unwrap();
    assert!(again.is_empty(), "no-op sync writes nothing");

    create(
        &db,
        new_key(
            "k_a",
            &h('a'),
            ToolGrant::Only(set(&["search", "delete_note"])),
        ),
    )
    .unwrap();
    db.write(|tx| tools::set_enabled(tx, "delete_note", false, 7))
        .unwrap();

    // delete_note disappears from the catalog.
    let s = db
        .write(|tx| tools::sync_catalog(tx, &["search", "read_note", "new_tool"]))
        .unwrap();
    assert_eq!(
        (s.added, s.retired, s.revived),
        (
            vec!["new_tool".to_string()],
            vec!["delete_note".to_string()],
            vec![]
        )
    );
    db.read(|c| {
        assert_eq!(
            tools::catalog(c)?,
            set(&["new_tool", "read_note", "search"])
        );
        assert!(
            tools::disabled(c)?.is_empty(),
            "switch of a retired tool is dormant"
        );
        let info = tools::list(c)?;
        let del = info.iter().find(|t| t.name == "delete_note").unwrap();
        assert!(del.retired && del.disabled_at == Some(7));
        // The grant row stays (FK valid) but is hidden from the key.
        assert_eq!(
            keys::get(c, "k_a")?.unwrap().tools,
            ToolGrant::Only(set(&["search"]))
        );
        let rows: i64 = c.query_row(
            "SELECT count(*) FROM api_key_tool WHERE key_id='k_a'",
            [],
            |r| r.get(0),
        )?;
        assert_eq!(rows, 2);
        let fk: i64 = c.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })?;
        assert_eq!(fk, 0);
        Ok(())
    })
    .unwrap();
    // Retired tools cannot be granted or switched.
    let e = db
        .write(|tx| {
            keys::update(
                tx,
                "k_a",
                &KeyPatch {
                    tools: Some(ToolGrant::Only(set(&["delete_note"]))),
                    ..Default::default()
                },
            )
        })
        .unwrap_err();
    assert!(matches!(e, Error::Invalid { field: "tools", .. }));
    assert!(matches!(
        db.write(|tx| tools::set_enabled(tx, "delete_note", true, 8)),
        Err(Error::NotFound(_))
    ));

    // It comes back: grant and switch apply again.
    let s = db
        .write(|tx| tools::sync_catalog(tx, &["search", "read_note", "new_tool", "delete_note"]))
        .unwrap();
    assert_eq!(s.revived, ["delete_note"]);
    db.read(|c| {
        assert_eq!(
            keys::get(c, "k_a")?.unwrap().tools,
            ToolGrant::Only(set(&["search", "delete_note"]))
        );
        assert_eq!(tools::disabled(c)?, set(&["delete_note"]));
        Ok(())
    })
    .unwrap();

    // Bad names fail the whole sync.
    let e = db
        .write(|tx| tools::sync_catalog(tx, &["ok_name", "Bad-Name"]))
        .unwrap_err();
    assert!(matches!(e, Error::Invalid { .. }));
    assert!(!db.read(tools::catalog).unwrap().contains("ok_name"));
}

#[test]
fn global_switches() {
    let db = db_with_catalog();
    db.write(|tx| tools::set_enabled(tx, "delete_note", false, 10))
        .unwrap();
    db.write(|tx| tools::set_enabled(tx, "delete_note", false, 20))
        .unwrap();
    db.write(|tx| tools::set_enabled(tx, "search", true, 20))
        .unwrap(); // no-op
    db.read(|c| {
        assert_eq!(tools::disabled(c)?, set(&["delete_note"]));
        let t = tools::list(c)?;
        assert_eq!(
            t.iter()
                .find(|t| t.name == "delete_note")
                .unwrap()
                .disabled_at,
            Some(10)
        );
        Ok(())
    })
    .unwrap();
    db.write(|tx| tools::set_enabled(tx, "delete_note", true, 30))
        .unwrap();
    assert!(db.read(tools::disabled).unwrap().is_empty());
    assert!(matches!(
        db.write(|tx| tools::set_enabled(tx, "nope", false, 1)),
        Err(Error::NotFound(_))
    ));
}

#[test]
fn effective_access_matches_contract() {
    let db = db_with_catalog();
    let def = create(&db, new_key("k_a", &h('a'), ToolGrant::All)).unwrap();
    let none = BTreeSet::new();
    let off = set(&["delete_note"]);
    assert_eq!(keys::tool_access(Some(&def), &none, "delete_note"), Ok(()));
    assert_eq!(
        keys::tool_access(Some(&def), &off, "delete_note"),
        Err(ToolDenial::Disabled)
    );
    assert_eq!(
        keys::tool_access(None, &off, "delete_note"),
        Err(ToolDenial::Disabled)
    );
    assert_eq!(keys::tool_access(None, &off, "search"), Ok(()));

    let only = ApiKey {
        tools: ToolGrant::Only(set(&["search"])),
        ..def.clone()
    };
    assert_eq!(keys::tool_access(Some(&only), &none, "search"), Ok(()));
    assert_eq!(
        keys::tool_access(Some(&only), &none, "read_note"),
        Err(ToolDenial::NotAllowed)
    );
    let no_mcp = ApiKey {
        scopes: [Scope::Read].into_iter().collect(),
        ..def.clone()
    };
    assert_eq!(
        keys::tool_access(Some(&no_mcp), &none, "search"),
        Err(ToolDenial::NotAllowed)
    );
    let disabled_key = ApiKey {
        enabled: false,
        ..def.clone()
    };
    assert_eq!(
        keys::tool_access(Some(&disabled_key), &off, "delete_note"),
        Err(ToolDenial::NotAllowed)
    );
    assert_eq!(
        ToolDenial::NotAllowed.message("x"),
        "tool not allowed for this API key: x"
    );
    assert_eq!(
        ToolDenial::Disabled.message("x"),
        "tool disabled on this server: x"
    );

    db.write(|tx| tools::set_enabled(tx, "delete_note", false, 1))
        .unwrap();
    db.read(|c| {
        assert_eq!(
            keys::allowed_tools(c, Some(&def))?,
            set(&["read_note", "search"])
        );
        assert_eq!(keys::allowed_tools(c, Some(&only))?, set(&["search"]));
        assert!(keys::allowed_tools(c, Some(&no_mcp))?.is_empty());
        assert_eq!(keys::allowed_tools(c, None)?, set(&["read_note", "search"]));
        Ok(())
    })
    .unwrap();
}

#[test]
fn usage_buffer_flush_and_queries() {
    let db = db_with_catalog();
    create(&db, new_key("k_a", &h('a'), ToolGrant::All)).unwrap();
    create(&db, new_key("k_b", &h('b'), ToolGrant::All)).unwrap();
    let mut buf = UsageBuffer::default();
    assert_eq!(buf.flush(&db).unwrap(), 0);
    buf.record(
        "k_a",
        Some("10.0.0.1".into()),
        "search",
        Some("/mcp".into()),
        1000,
    );
    buf.record("k_a", None, "read_note", None, 1001);
    buf.record(
        "k_b",
        Some("10.0.0.9".into()),
        "",
        Some("x".repeat(5000)),
        1002,
    );
    buf.record("k_gone", Some("1.1.1.1".into()), "search", None, 1003);
    assert!(buf.has_ip("k_a", "10.0.0.1") && !buf.has_ip("k_a", "10.0.0.2"));
    // 2 usage rows + 3 events (k_gone does not exist: skipped, no FK error).
    assert_eq!(buf.flush(&db).unwrap(), 5);
    assert!(buf.is_empty());

    buf.record("k_a", Some("10.0.0.2".into()), "search", None, 2000);
    buf.flush(&db).unwrap();
    db.read(|c| {
        let u = usage::usage(c, "k_a")?.unwrap();
        assert_eq!(
            (u.use_count, u.last_used, u.last_ip.as_deref()),
            (3, 2000, Some("10.0.0.2"))
        );
        assert_eq!(usage::all_usage(c)?.len(), 2);
        assert!(usage::usage(c, "k_gone")?.is_none());
        let ev = usage::events_for_key(c, "k_a", 2)?;
        assert_eq!(ev.iter().map(|e| e.at).collect::<Vec<_>>(), [2000, 1001]);
        assert!(ev[0].id.is_some());
        let b = usage::events_for_key(c, "k_b", 10)?;
        assert_eq!(
            (b[0].tool.as_str(), b[0].path.as_ref().unwrap().len()),
            ("unknown", 1024)
        );
        Ok(())
    })
    .unwrap();
    // A use without IP keeps the last known IP.
    buf.record("k_a", None, "search", None, 3000);
    buf.flush(&db).unwrap();
    let u = db.read(|c| usage::usage(c, "k_a")).unwrap().unwrap();
    assert_eq!(u.last_ip.as_deref(), Some("10.0.0.2"));
}

#[test]
fn usage_flush_skips_purged_keys_and_take_merge() {
    let db = db_with_catalog();
    create(&db, new_key("k_a", &h('a'), ToolGrant::All)).unwrap();
    let mut buf = UsageBuffer::default();
    buf.record("k_a", Some("10.0.0.1".into()), "search", None, 10);
    db.write(|tx| keys::purge(tx, "k_a")).unwrap();
    assert_eq!(buf.flush(&db).unwrap(), 0);

    // take/merge: a failed flush puts the batch back.
    create(&db, new_key("k_a", &h('a'), ToolGrant::All)).unwrap();
    let mut shared = UsageBuffer::default();
    shared.record("k_a", Some("10.0.0.1".into()), "search", None, 10);
    let batch = shared.take();
    assert!(shared.is_empty());
    shared.record("k_a", None, "search", None, 20);
    shared.merge(batch);
    assert_eq!(shared.pending_usage["k_a"].use_count, 2);
    assert_eq!(
        shared.pending_usage["k_a"].last_ip.as_deref(),
        Some("10.0.0.1")
    );
    assert_eq!(
        shared
            .pending_events
            .iter()
            .map(|e| e.at)
            .collect::<Vec<_>>(),
        [10, 20]
    );
    shared.flush(&db).unwrap();
    assert_eq!(
        db.read(|c| usage::usage(c, "k_a"))
            .unwrap()
            .unwrap()
            .use_count,
        2
    );
}

#[test]
fn usage_buffer_is_bounded() {
    let mut buf = UsageBuffer::default();
    for i in 0..(MAX_PENDING_EVENTS + 5) {
        buf.record("k_a", None, "search", None, i as i64);
    }
    assert!(buf.pending_events.len() <= MAX_PENDING_EVENTS);
    assert!(buf.dropped > 0);
    assert_eq!(
        buf.pending_usage["k_a"].use_count,
        (MAX_PENDING_EVENTS + 5) as u64
    );
    assert_eq!(
        buf.pending_events.last().unwrap().at,
        (MAX_PENDING_EVENTS + 4) as i64
    );
    for i in 0..(usage::MAX_PENDING_KEYS + 10) {
        buf.record(&format!("k_{i}"), None, "t", None, 1);
    }
    assert!(buf.pending_usage.len() <= usage::MAX_PENDING_KEYS);
    assert!(buf.pending_events.len() <= MAX_PENDING_EVENTS);
}

#[test]
fn new_ip_detection() {
    let db = db_with_catalog();
    create(&db, new_key("k_a", &h('a'), ToolGrant::All)).unwrap();
    let mut buf = UsageBuffer::default();
    db.read(|c| {
        assert!(
            !usage::is_new_ip(c, "k_a", "10.0.0.1")?,
            "no history = not an anomaly"
        );
        Ok(())
    })
    .unwrap();
    buf.record("k_a", None, "search", None, 1);
    buf.record("k_a", Some("10.0.0.1".into()), "search", None, 2);
    db.read(|c| {
        assert!(usage::is_new_ip_buffered(c, &buf, "k_a", "10.0.0.2")?);
        assert!(!usage::is_new_ip_buffered(c, &buf, "k_a", "10.0.0.1")?);
        Ok(())
    })
    .unwrap();
    buf.flush(&db).unwrap();
    db.read(|c| {
        assert!(usage::is_new_ip(c, "k_a", "10.0.0.2")?);
        assert!(!usage::is_new_ip(c, "k_a", "10.0.0.1")?);
        assert!(!usage::is_new_ip(c, "k_other", "10.0.0.1")?);
        assert!(usage::is_new_ip_buffered(c, &UsageBuffer::default(), "k_a", "10.0.0.2")?);
        assert!(!usage::is_new_ip_buffered(c, &UsageBuffer::default(), "k_a", "10.0.0.1")?);
        // Both probes are index lookups.
        let mut st = c.prepare(
            "EXPLAIN QUERY PLAN SELECT EXISTS (SELECT 1 FROM api_key_event WHERE key_id = ?1 AND ip >= ''),
                    EXISTS (SELECT 1 FROM api_key_event WHERE key_id = ?1 AND ip = ?2)",
        )?;
        let plan = st
            .query_map(["k_a", "x"], |r| r.get::<_, String>(3))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let uses = plan.iter().filter(|p| p.contains("api_key_event_key_ip")).count();
        assert_eq!(uses, 2, "{plan:?}");
        assert!(!plan.iter().any(|p| p.starts_with("SCAN api_key_event")), "{plan:?}");
        Ok(())
    })
    .unwrap();
}
