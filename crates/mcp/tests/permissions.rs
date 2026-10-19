//! Tool switches and per-key permissions: filtered `tools/list`, `-32003`
//! refusals on `tools/call`, and the admin tools.

use memora_core::MemoryStore;
use memora_gateway::{KeyPermissions, ToolGrant};
use memora_mcp::{Caller, McpServer, RpcRequest};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("memora-perm-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("vault/Plan")).unwrap();
    std::fs::create_dir_all(dir.join("state")).unwrap();
    std::fs::write(dir.join("vault/Plan/Index.md"), "# Index\n").unwrap();
    dir
}

fn server(dir: &Path) -> McpServer {
    let store = MemoryStore::new(dir.join("vault").to_string_lossy().to_string());
    let db = memora_state::Db::open(&dir.join("state")).unwrap();
    memora_mcp::sync_catalog(&db).unwrap();
    McpServer::new(Arc::new(Mutex::new(store)), db)
}

/// Switch a tool from another connection, as `memora-cli` would.
fn cli_set_tool(dir: &Path, name: &str, enabled: bool) {
    let db = memora_state::Db::open(&dir.join("state")).unwrap();
    db.write(|tx| memora_state::tools::set_enabled(tx, name, enabled, memora_state::now()))
        .unwrap();
}

fn rpc(srv: &McpServer, caller: &Caller, method: &str, params: Value) -> Value {
    let req = RpcRequest {
        jsonrpc: Some("2.0".into()),
        id: Some(json!(1)),
        method: method.into(),
        params,
    };
    serde_json::to_value(srv.handle_as(&req, caller)).unwrap()
}

fn names(v: &Value) -> Vec<String> {
    v["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap().to_string())
        .collect()
}

fn key(scopes: &[&str], tools: ToolGrant) -> Caller {
    Caller::key(
        "k_test",
        KeyPermissions {
            enabled: true,
            scopes: scopes.iter().map(|s| s.to_string()).collect(),
            tools,
        },
        Some("127.0.0.1".into()),
    )
}

#[test]
fn list_and_call_follow_key_and_switches() {
    let dir = scratch("list");
    let srv = server(&dir);
    let all = memora_mcp::catalog().len();

    let def = key(&["mcp", "read", "write"], ToolGrant::All);
    let l = names(&rpc(&srv, &def, "tools/list", json!({})));
    assert_eq!(
        l.len(),
        all,
        "default key sees every catalog tool, no admin tools"
    );
    assert!(!l.iter().any(|n| n.starts_with("admin_")));

    // Restricted key: only its tools.
    let only = key(
        &["mcp"],
        ToolGrant::Only(["get_stats".to_string()].into_iter().collect()),
    );
    assert_eq!(
        names(&rpc(&srv, &only, "tools/list", json!({}))),
        vec!["get_stats"]
    );
    let r = rpc(&srv, &only, "tools/call", json!({"name":"list_memory"}));
    assert_eq!(r["error"]["code"], -32003);
    assert_eq!(
        r["error"]["message"],
        "tool not allowed for this API key: list_memory"
    );
    let r = rpc(&srv, &only, "tools/call", json!({"name":"get_stats"}));
    assert_eq!(r["result"]["isError"], false);

    // Global switch: hidden and refused for everyone, including full access.
    cli_set_tool(&dir, "get_stats", false);
    // The HTTP server calls reload_tools when the `tools` domain changes.
    assert!(srv.reload_tools());
    assert!(!names(&rpc(&srv, &def, "tools/list", json!({}))).contains(&"get_stats".to_string()));
    for c in [&def, &only, &Caller::full("owner")] {
        let r = rpc(&srv, c, "tools/call", json!({"name":"get_stats"}));
        assert_eq!(r["error"]["code"], -32003);
        assert_eq!(
            r["error"]["message"],
            "tool disabled on this server: get_stats"
        );
    }
    cli_set_tool(&dir, "get_stats", true);
    srv.reload_tools();
    let r = rpc(&srv, &def, "tools/call", json!({"name":"get_stats"}));
    assert_eq!(
        r["result"]["isError"], false,
        "CLI switch applies after reload"
    );

    // A key without the mcp scope sees nothing.
    let nomcp = key(&["read"], ToolGrant::All);
    assert!(names(&rpc(&srv, &nomcp, "tools/list", json!({}))).is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn admin_tools_need_admin_scope() {
    let dir = scratch("admin");
    let srv = server(&dir);
    let def = key(&["mcp", "read", "write"], ToolGrant::All);
    let r = rpc(&srv, &def, "tools/call", json!({"name":"admin_list_tools"}));
    assert_eq!(r["error"]["code"], -32003);

    let admin = key(&["mcp", "admin"], ToolGrant::Only(Default::default()));
    let l = names(&rpc(&srv, &admin, "tools/list", json!({})));
    assert_eq!(
        l,
        vec![
            "admin_list_tools",
            "admin_set_tool",
            "privacy_list",
            "privacy_set",
            "privacy_clear"
        ]
    );

    let r = rpc(
        &srv,
        &admin,
        "tools/call",
        json!({"name":"admin_set_tool","arguments":{"name":"delete_memory","enabled":false}}),
    );
    assert_eq!(r["result"]["isError"], false, "{r}");
    assert!(srv.disabled_tools().contains("delete_memory"));
    let db = srv.db();
    assert!(db
        .read(memora_state::tools::disabled)
        .unwrap()
        .contains("delete_memory"));
    let log = db
        .read(|c| memora_state::activity::recent(c, 10, None))
        .unwrap();
    assert!(log
        .iter()
        .any(|e| e.event == "tool_disabled" && e.actor.as_deref() == Some("key:k_test")));

    let r = rpc(
        &srv,
        &admin,
        "tools/call",
        json!({"name":"admin_list_tools"}),
    );
    let text = r["result"]["content"][0]["text"].as_str().unwrap();
    let v: Value = serde_json::from_str(text).unwrap();
    let del = v["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "delete_memory")
        .unwrap();
    assert_eq!(del["enabled"], false);

    let r = rpc(
        &srv,
        &admin,
        "tools/call",
        json!({"name":"admin_set_tool","arguments":{"name":"nope","enabled":false}}),
    );
    assert_eq!(r["result"]["isError"], true);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn read_only_key_cannot_write() {
    let dir = scratch("scopes");
    let srv = server(&dir);
    let ro = key(&["mcp", "read"], ToolGrant::All);

    // tools/list: only read-only tools.
    let l = names(&rpc(&srv, &ro, "tools/list", json!({})));
    assert!(l.contains(&"read_memory".to_string()));
    assert!(l.contains(&"folder_stats".to_string()));
    for t in memora_mcp::catalog() {
        let needs_write = memora_mcp::required_scope(t.name) == Some("write");
        assert_eq!(
            l.contains(&t.name.to_string()),
            !needs_write,
            "{} listed for a read-only key: {}",
            t.name,
            !needs_write
        );
    }

    // Every write tool is refused before it runs, with a clear message.
    let writes = [
        "create_memory",
        "save_memory",
        "patch_memory",
        "delete_memory",
        "move_memory",
        "rename_memory",
        "create_folder",
        "delete_folder",
        "move_folder",
        "rename_folder",
        "bulk_delete",
        "soft_delete",
        "set_tags",
        "import_memory",
    ];
    for name in writes {
        assert_eq!(memora_mcp::required_scope(name), Some("write"), "{name}");
        let r = rpc(
            &srv,
            &ro,
            "tools/call",
            json!({"name": name, "arguments": {"path":"Plan/Index.md","folder":"Plan","title":"X","content":"x"}}),
        );
        assert_eq!(r["error"]["code"], -32003, "{name}: {r}");
        assert_eq!(
            r["error"]["message"],
            format!("API key lacks the 'write' scope for tool: {name}")
        );
    }
    assert!(
        dir.join("vault/Plan/Index.md").exists(),
        "nothing was deleted"
    );
    assert!(!dir.join("vault/Plan/X.md").exists(), "nothing was created");

    // Read tools still work; an explicit tool grant does not bypass the scope.
    let r = rpc(
        &srv,
        &ro,
        "tools/call",
        json!({"name":"read_memory","arguments":{"path":"Plan/Index.md"}}),
    );
    assert_eq!(r["result"]["isError"], false, "{r}");
    let granted = key(
        &["mcp", "read"],
        ToolGrant::Only(["create_memory".to_string()].into_iter().collect()),
    );
    assert!(names(&rpc(&srv, &granted, "tools/list", json!({}))).is_empty());
    let r = rpc(
        &srv,
        &granted,
        "tools/call",
        json!({"name":"create_memory","arguments":{"folder":"Plan","title":"X"}}),
    );
    assert_eq!(r["error"]["code"], -32003);

    // With `write` the same call goes through; full access is unaffected.
    let rw = key(&["mcp", "read", "write"], ToolGrant::All);
    let r = rpc(
        &srv,
        &rw,
        "tools/call",
        json!({"name":"create_memory","arguments":{"folder":"Plan","title":"X","content":"x"}}),
    );
    assert_eq!(r["result"]["isError"], false, "{r}");
    let r = rpc(
        &srv,
        &Caller::full("owner"),
        "tools/call",
        json!({"name":"create_folder","arguments":{"name":"Owner"}}),
    );
    assert!(r.get("error").is_none(), "{r}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn folder_stats_counts_nested_folders() {
    let dir = scratch("fstats");
    std::fs::create_dir_all(dir.join("vault/Projects/Memora/Deep")).unwrap();
    std::fs::write(dir.join("vault/Projects/Top.md"), "# Top\n").unwrap();
    std::fs::write(dir.join("vault/Projects/Memora/A.md"), "# A\n").unwrap();
    std::fs::write(dir.join("vault/Projects/Memora/B.md"), "# B\n").unwrap();
    std::fs::write(dir.join("vault/Projects/Memora/Deep/C.md"), "# C\n").unwrap();
    std::fs::write(dir.join("vault/Loose.md"), "# Loose\n").unwrap();
    let srv = server(&dir);
    let stats = |folder: &str| -> Value {
        let r = rpc(
            &srv,
            &Caller::full("owner"),
            "tools/call",
            json!({"name":"folder_stats","arguments":{"folder":folder}}),
        );
        serde_json::from_str(r["result"]["content"][0]["text"].as_str().unwrap()).unwrap()
    };
    assert_eq!(stats("Projects")["notes"], 4);
    assert_eq!(stats("Projects/Memora")["notes"], 3);
    assert_eq!(stats("Projects/Memora/")["notes"], 3);
    assert_eq!(stats("Projects/Memora/Deep")["notes"], 1);
    // No prefix matches: a folder that does not exist is an error, not zero notes.
    let r = rpc(
        &srv,
        &Caller::full("owner"),
        "tools/call",
        json!({"name":"folder_stats","arguments":{"folder":"Projects/Mem"}}),
    );
    assert_eq!(r["result"]["isError"], true, "{r}");
    assert_eq!(stats("Plan")["notes"], 1);
    assert_eq!(stats("Root")["notes"], 1);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn export_needs_paths_and_returns_only_the_file_name() {
    let dir = scratch("export");
    let srv = server(&dir);
    let owner = Caller::full("owner");
    let r = rpc(
        &srv,
        &owner,
        "tools/call",
        json!({"name":"export_memory","arguments":{}}),
    );
    assert_eq!(r["result"]["isError"], true, "{r}");

    let name = format!("perm-export-{}.zip", std::process::id());
    let r = rpc(
        &srv,
        &owner,
        "tools/call",
        json!({"name":"export_memory","arguments":{"paths":["Plan"],"out_path":name}}),
    );
    assert_eq!(r["result"]["isError"], false, "{r}");
    let v: Value =
        serde_json::from_str(r["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(v["path"], name.as_str());
    assert_eq!(v["name"], name.as_str());
    assert!(v["bytes"].as_u64().unwrap() > 0);

    let r = rpc(
        &srv,
        &owner,
        "tools/call",
        json!({"name":"import_memory","arguments":{"zip_path":name}}),
    );
    assert_eq!(r["result"]["isError"], false, "{r}");
    let _ = std::fs::remove_file(std::env::temp_dir().join("memora-exchange").join(&name));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn pin_tools_follow_scopes_grants_and_privacy() {
    let dir = scratch("pins");
    let srv = server(&dir);
    std::fs::create_dir_all(dir.join("vault/Secret")).unwrap();
    std::fs::write(dir.join("vault/Secret/s.md"), "# S\n").unwrap();
    let text = |r: &Value| -> Value {
        assert_eq!(r["result"]["isError"], false, "{r}");
        serde_json::from_str(r["result"]["content"][0]["text"].as_str().unwrap()).unwrap()
    };
    let rw = key(&["mcp", "read", "write"], ToolGrant::All);
    let ro = key(&["mcp", "read"], ToolGrant::All);

    // Scopes: list_pins is read-only, pin and unpin need `write`.
    assert_eq!(memora_mcp::required_scope("list_pins"), None);
    for name in ["pin", "unpin"] {
        assert_eq!(memora_mcp::required_scope(name), Some("write"), "{name}");
        let r = rpc(
            &srv,
            &ro,
            "tools/call",
            json!({"name": name, "arguments": {"path": "Plan/Index.md"}}),
        );
        assert_eq!(r["error"]["code"], -32003, "{name}: {r}");
        assert_eq!(
            r["error"]["message"],
            format!("API key lacks the 'write' scope for tool: {name}")
        );
    }
    let l = names(&rpc(&srv, &ro, "tools/list", json!({})));
    assert!(l.contains(&"list_pins".to_string()));
    assert!(!l.contains(&"pin".to_string()) && !l.contains(&"unpin".to_string()));
    assert!(srv.db().read(memora_state::pins::list).unwrap().is_empty());

    // A write key pins (kind from disk, `.md` optional) and lists.
    let v = text(&rpc(
        &srv,
        &rw,
        "tools/call",
        json!({"name":"pin","arguments":{"path":"Plan/Index"}}),
    ));
    assert_eq!(v["pins"][0]["path"], "Plan/Index.md");
    assert_eq!(v["pins"][0]["kind"], "note");
    let v = text(&rpc(
        &srv,
        &rw,
        "tools/call",
        json!({"name":"pin","arguments":{"path":"Secret","position":0}}),
    ));
    assert_eq!(v["pins"][0]["path"], "Secret");
    assert_eq!(v["pins"][0]["kind"], "folder");
    assert_eq!(v["count"], 2);
    let v = text(&rpc(&srv, &ro, "tools/call", json!({"name":"list_pins"})));
    assert_eq!(v["count"], 2);
    assert_eq!(v["pins"][1]["missing"], false);

    // Paths outside the vault, hidden or missing are refused.
    for bad in ["../etc/passwd", "/etc", ".Trash/x.md", "Nope.md"] {
        let r = rpc(
            &srv,
            &rw,
            "tools/call",
            json!({"name":"pin","arguments":{"path": bad}}),
        );
        assert_eq!(r["result"]["isError"], true, "{bad}: {r}");
    }

    // A tool grant without `pin` refuses it even with the write scope.
    let only_list = key(
        &["mcp", "read", "write"],
        ToolGrant::Only(["list_pins".to_string()].into_iter().collect()),
    );
    let r = rpc(
        &srv,
        &only_list,
        "tools/call",
        json!({"name":"unpin","arguments":{"path":"Secret"}}),
    );
    assert_eq!(r["error"]["code"], -32003, "{r}");

    // A key whose privacy rules hide Secret neither sees nor changes that pin.
    srv.db()
        .write(|tx| {
            memora_state::keys::create(
                tx,
                &memora_state::keys::NewApiKey {
                    id: "k_test".into(),
                    name: "test".into(),
                    hash: format!("{:064x}", 9),
                    prefix: "mem_t".into(),
                    scopes: memora_state::keys::Scope::default_set(),
                    tools: memora_state::keys::ToolGrant::All,
                },
                1,
            )?;
            memora_state::privacy::set(
                tx,
                memora_state::privacy::Kind::Folder,
                "Secret",
                memora_state::privacy::Mode::Deny,
                &["k_test".to_string()].into(),
                1,
            )?;
            Ok(())
        })
        .unwrap();
    let v = text(&rpc(&srv, &rw, "tools/call", json!({"name":"list_pins"})));
    assert_eq!(v["count"], 1, "{v}");
    assert_eq!(v["pins"][0]["path"], "Plan/Index.md");
    assert_eq!(v["pins"][0]["position"], 0);
    let r = rpc(
        &srv,
        &rw,
        "tools/call",
        json!({"name":"unpin","arguments":{"path":"Secret","kind":"folder"}}),
    );
    assert_eq!(r["result"]["isError"], true, "{r}");
    assert_eq!(srv.db().read(memora_state::pins::list).unwrap().len(), 2);

    // The owner (full access) still sees both and may unpin.
    let owner = Caller::full("owner");
    let v = text(&rpc(
        &srv,
        &owner,
        "tools/call",
        json!({"name":"unpin","arguments":{"path":"Secret"}}),
    ));
    assert_eq!(v["removed"], true);
    assert_eq!(v["count"], 1);
    let _ = std::fs::remove_dir_all(&dir);
}
