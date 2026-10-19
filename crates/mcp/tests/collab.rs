//! Collaboration and admin tools as agents see them: soft locks bind other agents,
//! lock paths are validated and normalized, mentions cannot inject lines, event / log
//! arguments are validated, display names cannot impersonate, and the admin / privacy
//! tools refuse calls that would silently do something else.

use memora_core::MemoryStore;
use memora_gateway::{KeyPermissions, ToolGrant};
use memora_mcp::{Caller, McpServer, RpcRequest};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("memora-collab-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("vault/Notes")).unwrap();
    std::fs::create_dir_all(dir.join("vault/Private")).unwrap();
    std::fs::create_dir_all(dir.join("state")).unwrap();
    std::fs::write(dir.join("vault/Notes/Ideas.md"), "# Ideas\n").unwrap();
    std::fs::write(dir.join("vault/Readme.md"), "# Readme\n").unwrap();
    std::fs::write(dir.join("vault/Private/Secret.md"), "# Secret\n").unwrap();
    dir
}

fn server(dir: &Path) -> McpServer {
    let store = MemoryStore::new(dir.join("vault").to_string_lossy().to_string());
    let db = memora_state::Db::open(&dir.join("state")).unwrap();
    memora_mcp::sync_catalog(&db).unwrap();
    let srv = McpServer::new(Arc::new(Mutex::new(store)), db);
    srv.db()
        .write(|tx| {
            for (i, (id, name)) in [("k_a", "full-agent"), ("k_b", "other-agent")]
                .iter()
                .enumerate()
            {
                memora_state::keys::create(
                    tx,
                    &memora_state::keys::NewApiKey {
                        id: id.to_string(),
                        name: name.to_string(),
                        hash: format!("{:064x}", i + 1),
                        prefix: format!("mem_{i}x"),
                        scopes: memora_state::keys::Scope::default_set(),
                        tools: memora_state::keys::ToolGrant::All,
                    },
                    1,
                )?;
            }
            memora_state::owner::set_owner(
                tx,
                "alice",
                "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaEE",
                1,
            )
        })
        .unwrap();
    srv
}

fn agent(id: &str, name: &str) -> Caller {
    Caller::key(
        id,
        KeyPermissions {
            enabled: true,
            scopes: ["mcp", "read", "write"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
            tools: ToolGrant::All,
        },
        None,
    )
    .named(name)
}

fn a() -> Caller {
    agent("k_a", "full-agent")
}

fn b() -> Caller {
    agent("k_b", "other-agent")
}

fn owner() -> Caller {
    Caller::full("alice")
}

/// `(is_error, text)` of a tools/call.
fn call(srv: &McpServer, caller: &Caller, name: &str, args: Value) -> (bool, String) {
    let req = RpcRequest {
        jsonrpc: Some("2.0".into()),
        id: Some(json!(1)),
        method: "tools/call".into(),
        params: json!({"name": name, "arguments": args}),
    };
    let r = serde_json::to_value(srv.handle_as(&req, caller)).unwrap();
    assert!(r.get("error").is_none(), "{name}: unexpected RPC error {r}");
    let text = r["result"]["content"][0]["text"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    (r["result"]["isError"] == true, text)
}

fn ok(srv: &McpServer, caller: &Caller, name: &str, args: Value) -> Value {
    let (e, t) = call(srv, caller, name, args);
    assert!(!e, "{name}: {t}");
    serde_json::from_str(&t).unwrap_or(Value::String(t))
}

fn fails(srv: &McpServer, caller: &Caller, name: &str, args: Value) -> String {
    let (e, t) = call(srv, caller, name, args.clone());
    assert!(e, "{name} {args} should fail: {t}");
    t
}

#[test]
fn locks_belong_to_the_caller_and_bind_other_agents() {
    let dir = scratch("own");
    let srv = server(&dir);
    let v = ok(&srv, &a(), "lock_node", json!({"path": "Notes/Ideas.md"}));
    assert_eq!(v["owner"], "full-agent");
    assert_eq!(v["ttl"], 300);

    // Another key can neither take, release, nor impersonate the holder.
    let t = fails(&srv, &b(), "lock_node", json!({"path": "Notes/Ideas.md"}));
    assert!(t.contains("locked by full-agent"), "{t}");
    let t = fails(
        &srv,
        &b(),
        "release_lock",
        json!({"path": "Notes/Ideas.md", "owner": "full-agent"}),
    );
    assert!(t.contains("owner must be you (other-agent)"), "{t}");
    let t = fails(
        &srv,
        &b(),
        "release_lock",
        json!({"path": "Notes/Ideas.md"}),
    );
    assert!(
        t.contains("locked by full-agent; only full-agent can release it"),
        "{t}"
    );
    let t = fails(
        &srv,
        &b(),
        "lock_node",
        json!({"path": "Readme.md", "owner": "full-agent"}),
    );
    assert!(t.contains("owner must be you"), "{t}");

    // Writes by another key are refused; nothing changes.
    for (tool, args) in [
        (
            "save_memory",
            json!({"path": "Notes/Ideas.md", "content": "x"}),
        ),
        (
            "patch_memory",
            json!({"path": "Notes/Ideas.md", "ops": [{"op": "append", "text": "x"}]}),
        ),
        ("delete_memory", json!({"path": "Notes/Ideas.md"})),
        (
            "mention_agent",
            json!({"path": "Notes/Ideas.md", "agent": "x", "message": "hi"}),
        ),
        ("delete_folder", json!({"folder": "Notes"})),
        ("bulk_replace", json!({"find": "Ideas", "replace": "Gone"})),
    ] {
        let t = fails(&srv, &b(), tool, args);
        assert!(
            t.contains("Notes/Ideas.md is locked by full-agent for"),
            "{tool}: {t}"
        );
    }
    assert_eq!(
        std::fs::read_to_string(dir.join("vault/Notes/Ideas.md")).unwrap(),
        "# Ideas\n"
    );
    // Reads still work; the holder and the owner may write.
    ok(&srv, &b(), "read_memory", json!({"path": "Notes/Ideas.md"}));
    ok(
        &srv,
        &a(),
        "save_memory",
        json!({"path": "Notes/Ideas.md", "content": "# Ideas\nmine\n"}),
    );
    ok(
        &srv,
        &owner(),
        "save_memory",
        json!({"path": "Notes/Ideas.md", "content": "# Ideas\nowner\n"}),
    );

    // The holder renews and releases; the owner's session may clear any lock.
    ok(
        &srv,
        &a(),
        "lock_node",
        json!({"path": "Notes/Ideas", "ttl": 60}),
    );
    let v = ok(
        &srv,
        &a(),
        "release_lock",
        json!({"path": "notes/ideas.md"}),
    );
    assert_eq!(v["released"], true);
    let v = ok(
        &srv,
        &a(),
        "release_lock",
        json!({"path": "Notes/Ideas.md"}),
    );
    assert_eq!(v["released"], false);
    ok(&srv, &a(), "lock_node", json!({"path": "Readme.md"}));
    let v = ok(&srv, &owner(), "release_lock", json!({"path": "Readme"}));
    assert_eq!(v["released"], true);
    ok(
        &srv,
        &b(),
        "save_memory",
        json!({"path": "Readme.md", "content": "# Readme\nb\n"}),
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn lock_paths_and_ttl_are_validated() {
    let dir = scratch("paths");
    let srv = server(&dir);
    for (path, want) in [
        ("Nope.md", "not found: Nope.md"),
        ("../../etc/passwd", "path escapes the vault"),
        ("", "path is required"),
        ("Notes", "is a folder"),
    ] {
        let t = fails(&srv, &a(), "lock_node", json!({"path": path}));
        assert!(t.contains(want), "{path}: {t}");
    }
    // One note, however it is spelled.
    for p in ["Readme", "readme.md", "Readme.md"] {
        let v = ok(&srv, &a(), "lock_node", json!({"path": p}));
        assert_eq!(v["path"], "Readme.md", "{p}");
    }
    let locks = ok(&srv, &a(), "get_locks", json!({}));
    assert_eq!(locks.as_array().unwrap().len(), 1, "{locks}");

    for ttl in [json!(0), json!(-5), json!(4), json!(86401), json!(i64::MAX)] {
        let t = fails(
            &srv,
            &a(),
            "lock_node",
            json!({"path": "Notes/Ideas.md", "ttl": ttl}),
        );
        assert!(
            t.contains("ttl must be 5-86400 seconds") || t.contains("must be at least 5"),
            "{ttl}: {t}"
        );
    }
    let v = ok(
        &srv,
        &a(),
        "lock_node",
        json!({"path": "Notes/Ideas.md", "ttl": 86400}),
    );
    assert_eq!(v["ttl"], 86400);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn mentions_stay_inside_their_quote() {
    let dir = scratch("mention");
    let srv = server(&dir);
    let t = fails(
        &srv,
        &a(),
        "mention_agent",
        json!({"path": "Readme.md", "agent": "a b\n> @evil: injected", "message": "hi"}),
    );
    assert!(t.contains("single name"), "{t}");
    for (agent, msg, want) in [
        ("", "hi", "agent is required"),
        ("@", "hi", "agent is required"),
        ("bob", "  ", "message is required"),
    ] {
        let t = fails(
            &srv,
            &a(),
            "mention_agent",
            json!({"path": "Readme.md", "agent": agent, "message": msg}),
        );
        assert!(t.contains(want), "{agent:?} {msg:?}: {t}");
    }
    let long = "x".repeat(4001);
    let t = fails(
        &srv,
        &a(),
        "mention_agent",
        json!({"path": "Readme.md", "agent": "bob", "message": long}),
    );
    assert!(t.contains("at most 4000 characters"), "{t}");

    let v = ok(
        &srv,
        &a(),
        "mention_agent",
        json!({"path": "Readme.md", "agent": "@bob", "message": "line one\n# not a heading\r\nthree"}),
    );
    assert_eq!(v["agent"], "bob");
    let body = std::fs::read_to_string(dir.join("vault/Readme.md")).unwrap();
    assert!(
        body.ends_with("\n\n> @bob: line one\n> # not a heading\n> three"),
        "{body:?}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn event_and_log_arguments_are_validated() {
    let dir = scratch("logs");
    let srv = server(&dir);
    for tool in ["get_events", "get_logs"] {
        for limit in [json!(0), json!(-1), json!(2001), json!(u64::MAX)] {
            let t = fails(&srv, &a(), tool, json!({"limit": limit}));
            assert!(
                t.contains("limit must be") || t.contains("at least"),
                "{tool} {limit}: {t}"
            );
        }
        ok(&srv, &a(), tool, json!({"limit": 2000}));
    }
    let t = fails(&srv, &a(), "search_logs", json!({"q": "x", "limit": 0}));
    assert!(t.contains("limit must be") || t.contains("at least"), "{t}");
    for range in ["bogus", "-1d", "1y", "2026-10-01", "0d"] {
        for (tool, args) in [
            ("get_logs", json!({"range": range})),
            ("search_logs", json!({"q": "x", "range": range})),
        ] {
            let t = fails(&srv, &a(), tool, args);
            assert!(
                t.contains("unknown range") && t.contains("yesterday"),
                "{t}"
            );
        }
    }
    for range in [
        "today",
        "Yesterday",
        "latest",
        "week",
        "1w",
        "all",
        "30d",
        "1.5d",
        "",
    ] {
        let v = ok(&srv, &a(), "get_logs", json!({"range": range}));
        assert!(v.get("events").is_some(), "{range}: {v}");
    }
    for w in [0, -1] {
        fails(&srv, &a(), "presence", json!({"window": w}));
    }
    ok(&srv, &a(), "presence", json!({"window": 1}));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn display_names_cannot_impersonate_or_hide_characters() {
    let dir = scratch("name");
    let srv = server(&dir);
    for (name, want) in [
        ("other-agent", "already used"),
        ("OTHER-AGENT", "already used"),
        ("owner", "already used"),
        ("Alice", "already used"),
        ("bad\nname", "control characters"),
        ("nul\0", "control characters"),
        ("abc\u{202E}gpj", "text-direction"),
        ("   ", "1-32 characters; spaces at the ends are removed"),
        (&"x".repeat(33), "1-32 characters"),
    ] {
        let t = fails(&srv, &a(), "set_my_name", json!({"name": name}));
        assert!(t.contains(want), "{name:?}: {t}");
    }
    let v = ok(&srv, &a(), "set_my_name", json!({"name": "  Scout  "}));
    assert_eq!(v["alias"], "Scout");
    // Own key name is fine; another agent cannot take the alias.
    ok(&srv, &a(), "set_my_name", json!({"name": "full-agent"}));
    ok(&srv, &a(), "set_my_name", json!({"name": "Scout"}));
    let t = fails(&srv, &b(), "set_my_name", json!({"name": "scout"}));
    assert!(t.contains("already used"), "{t}");

    let t = fails(&srv, &a(), "set_my_color", json!({"color": "red"}));
    assert!(t.contains("color must be a hex color like #f59e0b"), "{t}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn admin_and_privacy_tools_refuse_silent_surprises() {
    let dir = scratch("admin");
    let srv = server(&dir);
    let o = owner();
    for t in ["admin_list_tools", "admin_set_tool", "privacy_set"] {
        let m = fails(
            &srv,
            &o,
            "admin_set_tool",
            json!({"name": t, "enabled": false}),
        );
        assert!(m.contains("admin tools cannot be switched off"), "{m}");
    }
    let m = fails(
        &srv,
        &o,
        "admin_set_tool",
        json!({"name": "", "enabled": false}),
    );
    assert!(m.contains("admin_list_tools"), "{m}");

    // A real rule, then an empty deny list must not wipe it.
    ok(
        &srv,
        &o,
        "privacy_set",
        json!({"path": "Private", "agents": ["other-agent"]}),
    );
    for agents in [json!([]), json!([""]), json!([" "])] {
        let m = fails(
            &srv,
            &o,
            "privacy_set",
            json!({"path": "Private", "agents": agents}),
        );
        assert!(m.contains("use privacy_clear"), "{m}");
    }
    let t = fails(
        &srv,
        &b(),
        "read_memory",
        json!({"path": "Private/Secret.md"}),
    );
    assert!(t.contains("not found"), "{t}");
    // allow_only with nobody: allowed, with a warning.
    let v = ok(
        &srv,
        &o,
        "privacy_set",
        json!({"path": "Notes/Ideas.md", "mode": "allow_only", "agents": []}),
    );
    assert!(
        v["warning"].as_str().unwrap().contains("every agent"),
        "{v}"
    );
    ok(&srv, &o, "privacy_clear", json!({"path": "Notes/Ideas.md"}));

    // Kind must match the disk; absolute paths and Root are refused; missing warns.
    let m = fails(
        &srv,
        &o,
        "privacy_set",
        json!({"path": "Private/Secret.md", "kind": "folder", "agents": ["k_b"]}),
    );
    assert!(m.contains("is a node on disk, not a folder"), "{m}");
    let m = fails(
        &srv,
        &o,
        "privacy_set",
        json!({"path": "Private", "kind": "node", "agents": ["k_b"]}),
    );
    assert!(m.contains("is a folder on disk"), "{m}");
    let m = fails(
        &srv,
        &o,
        "privacy_set",
        json!({"path": "/etc/passwd", "agents": ["k_b"]}),
    );
    assert!(m.contains("not an absolute path"), "{m}");
    let m = fails(
        &srv,
        &o,
        "privacy_set",
        json!({"path": "Root", "kind": "folder", "agents": ["k_b"]}),
    );
    assert!(m.contains("vault root cannot be private"), "{m}");
    let v = ok(
        &srv,
        &o,
        "privacy_set",
        json!({"path": "Later/Plan.md", "agents": ["k_b"]}),
    );
    assert!(
        v["warning"]
            .as_str()
            .unwrap()
            .contains("does not exist yet"),
        "{v}"
    );

    // Clearing: a real removal vs nothing to remove.
    let v = ok(&srv, &o, "privacy_clear", json!({"path": "Later/Plan.md"}));
    assert_eq!(v["removed"], true, "{v}");
    let v = ok(&srv, &o, "privacy_clear", json!({"path": "Later/Plan.md"}));
    assert_eq!(v["removed"], false, "{v}");
    assert!(
        v["note"].as_str().unwrap().contains("no rule to remove"),
        "{v}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn creating_over_a_hidden_item_says_already_exists() {
    let dir = scratch("create");
    let srv = server(&dir);
    ok(
        &srv,
        &owner(),
        "privacy_set",
        json!({"path": "Private", "agents": ["other-agent"]}),
    );
    ok(
        &srv,
        &owner(),
        "privacy_set",
        json!({"path": "Notes/Ideas.md", "agents": ["other-agent"]}),
    );
    let t = fails(&srv, &b(), "create_folder", json!({"name": "Private"}));
    assert!(t.contains("already exists: Private"), "{t}");
    let t = fails(
        &srv,
        &b(),
        "create_memory",
        json!({"title": "Ideas", "folder": "Notes"}),
    );
    assert!(t.contains("already exists: Notes/Ideas.md"), "{t}");
    // Visible duplicates answer the same way.
    let t = fails(
        &srv,
        &a(),
        "create_memory",
        json!({"title": "Ideas", "folder": "Notes"}),
    );
    assert!(t.contains("already exists: Notes/Ideas.md"), "{t}");
    // A hidden note still cannot be locked or read (not found).
    let t = fails(&srv, &b(), "lock_node", json!({"path": "Notes/Ideas.md"}));
    assert!(t.contains("not found"), "{t}");
    let _ = std::fs::remove_dir_all(&dir);
}
