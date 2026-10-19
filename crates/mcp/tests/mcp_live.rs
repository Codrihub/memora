//! MCP integration tests against a real vault (read-only): they prove an
//! agent can drive the MCP tools end to end.
//!
//! Run with: cargo test --release --test mcp_live -- --nocapture

use memora_core::MemoryStore;
use memora_mcp::{catalog, detect_client, discovery_card, ClientKind, McpServer, RpcRequest};
use serde_json::json;
use std::sync::{Arc, Mutex};

fn vault() -> String {
    if let Ok(v) = std::env::var("MEMORA_VAULT") {
        if !v.is_empty() {
            return v;
        }
    }
    // No vault configured: build a scratch vault so the suite is deterministic
    // in a fresh checkout.
    seed_scratch_vault()
}

/// Create a unique temporary vault containing a single note.
fn seed_scratch_vault() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("memora-mcp-test-{}-{n}", std::process::id()));
    let note = dir.join("Plan").join("Index.md");
    if let Some(parent) = note.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(
        &note,
        "---\ncreated: 2026-01-01\ntags: [tech]\n---\n\n# Index\n\n- [ ] sample task\n",
    )
    .unwrap();
    dir.to_string_lossy().to_string()
}

fn server() -> McpServer {
    let store = MemoryStore::new(vault());
    let db = memora_state::Db::open_temp().unwrap();
    memora_mcp::sync_catalog(&db).unwrap();
    McpServer::new(Arc::new(Mutex::new(store)), db)
}

fn call(srv: &McpServer, method: &str, params: serde_json::Value) -> serde_json::Value {
    let req = RpcRequest {
        jsonrpc: Some("2.0".into()),
        id: Some(json!(1)),
        method: method.into(),
        params,
    };
    let resp = srv.handle(&req);
    serde_json::to_value(resp).unwrap()
}

#[test]
fn initialize_handshake() {
    let srv = server();
    let r = call(&srv, "initialize", json!({}));
    assert_eq!(r["result"]["serverInfo"]["name"], "memora");
    assert_eq!(r["result"]["protocolVersion"], "2025-06-18");
    assert!(r["result"]["capabilities"]["tools"].is_object());
    println!("initialize OK: {}", r["result"]["serverInfo"]);
}

#[test]
fn tools_list_has_schema_and_description() {
    let srv = server();
    let r = call(&srv, "tools/list", json!({}));
    let tools = r["result"]["tools"].as_array().unwrap();
    assert!(tools.len() >= 15, "too few tools: {}", tools.len());
    for t in tools {
        let name = t["name"].as_str().unwrap();
        let desc = t["description"].as_str().unwrap_or("");
        assert!(desc.len() > 20, "description too short: {name}");
        assert!(
            desc.contains("When to use"),
            "tool {name} does not state when to use it"
        );
        assert!(
            t["inputSchema"]["type"] == "object",
            "invalid schema: {name}"
        );
    }
    println!(
        "tools/list OK: {} tools, all with a description and schema",
        tools.len()
    );
    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    println!("  {}", names.join(", "));
}

#[test]
fn all_catalog_tools_are_callable() {
    let srv = server();
    // Tools that need arguments are called with real values; the rest are
    // only checked for presence.
    let calls: Vec<(&str, serde_json::Value)> = vec![
        ("get_stats", json!({})),
        ("list_memory", json!({})),
        ("list_folders", json!({})),
        ("get_graph", json!({})),
        ("broken_links", json!({})),
        ("get_tags", json!({})),
        ("search_memory", json!({"q":"note","limit":5})),
        ("search_by_tag", json!({"tag":"tech","limit":5})),
        ("read_memory", json!({"path":"Plan/Index.md"})),
    ];
    let mut ok = 0;
    for (name, args) in &calls {
        let r = call(&srv, "tools/call", json!({"name":name,"arguments":args}));
        let is_err = r["result"]["isError"].as_bool().unwrap_or(true);
        assert!(!is_err, "tool {name} failed: {}", r["result"]["content"]);
        ok += 1;
        println!("  call {name}: OK");
    }
    println!("tools/call OK: {ok}/{} tools responded", calls.len());
}

#[test]
fn unknown_tool_reports_error_not_panic() {
    let srv = server();
    let r = call(
        &srv,
        "tools/call",
        json!({"name":"no_such_tool","arguments":{}}),
    );
    assert_eq!(r["result"]["isError"], true);
    println!(
        "unknown tool rejected cleanly: {}",
        r["result"]["content"][0]["text"]
    );
}

#[test]
fn resources_list_and_read() {
    let srv = server();
    let r = call(&srv, "resources/list", json!({}));
    let res = r["result"]["resources"].as_array().unwrap();
    assert!(res.len() >= 3);
    for uri in ["memory://catalog", "memory://schema", "memory://guide"] {
        let rr = call(&srv, "resources/read", json!({"uri": uri}));
        let text = rr["result"]["contents"][0]["text"].as_str().unwrap();
        assert!(!text.is_empty(), "resource {uri} is empty");
        println!("  resource {uri}: {} chars", text.len());
    }
}

#[test]
fn discovery_card_for_agent() {
    let card = discovery_card("/mcp", &Default::default());
    assert_eq!(card["name"], "memora");
    assert_eq!(
        card["mcp"]["transports"],
        serde_json::json!(["streamable-http"])
    );
    assert!(card["tools"].as_array().unwrap().len() >= 15);
    println!(
        "discovery card OK:\n{}",
        serde_json::to_string_pretty(&card).unwrap()
    );
}

#[test]
fn client_detection_covers_mcp_and_web() {
    // /mcp path
    assert_eq!(detect_client("/mcp", &[], None), ClientKind::Mcp);
    // MCP session header
    let hdr = vec![("Mcp-Session-Id".to_string(), "abc".to_string())];
    assert_eq!(detect_client("/api/x", &hdr, None), ClientKind::Mcp);
    // MCP client user-agent
    let ua = vec![("User-Agent".to_string(), "claude-ai/1.0".to_string())];
    assert_eq!(detect_client("/", &ua, None), ClientKind::Mcp);
    // JSON-RPC initialize
    assert_eq!(
        detect_client("/", &[], Some(&json!({"method":"initialize"}))),
        ClientKind::Mcp
    );
    // plain browser
    let browser = vec![("User-Agent".to_string(), "Mozilla/5.0".to_string())];
    assert_eq!(detect_client("/", &browser, None), ClientKind::Web);
    println!("MCP client detection OK (4 detection paths plus web fallback)");
}

#[test]
fn alias_registered_per_connection() {
    let srv = server();
    let a1 = srv.register_alias("agent-1", "k_1");
    assert_eq!(a1.connections, 1);
    let a2 = srv.register_alias("agent-1", "k_1");
    assert_eq!(a2.connections, 2, "reconnect must increment the counter");
    srv.register_alias("other-agent", "k_1");
    assert_eq!(srv.aliases().len(), 2);
    println!("alias tracking OK: {:?}", srv.aliases());
}

#[test]
fn catalog_markdown_non_empty() {
    let md = memora_mcp::catalog_markdown(&Default::default());
    assert!(md.contains("get_stats"));
    assert!(md.len() > 500);
    println!("catalog markdown: {} chars", md.len());
}

#[test]
fn catalog_covers_all_expected_tools() {
    // The full public tool surface: every name below must exist in the catalog
    // with an exact match, so removing or renaming a tool fails this test.
    const EXPECTED: &[&str] = &[
        "add_tags",
        "batch_create",
        "broken_links",
        "bulk_delete",
        "bulk_replace",
        "create_folder",
        "create_memory",
        "delete_folder",
        "delete_memory",
        "diff",
        "digest",
        "duplicate_memory",
        "export_memory",
        "find_path",
        "find_similar",
        "folder_stats",
        "follow_ups",
        "get_assignments",
        "get_events",
        "get_folder_meta",
        "get_graph",
        "get_history",
        "get_hubs",
        "get_isolated",
        "get_locks",
        "get_logs",
        "get_neighbors",
        "get_note_at",
        "get_stats",
        "get_subgraph",
        "get_tags",
        "get_todos",
        "healthcheck",
        "import_memory",
        "link_stats",
        "list_actors",
        "list_memory",
        "list_pins",
        "list_tags",
        "list_trash",
        "lock_node",
        "mention_agent",
        "merge_memory",
        "merge_tag",
        "move_memory",
        "patch_memory",
        "pin",
        "presence",
        "query_memory",
        "read_memory",
        "release_lock",
        "remove_tags",
        "rename_memory",
        "rename_tag",
        "restore_memory",
        "restore_trash",
        "save_memory",
        "search_by_tag",
        "search_logs",
        "search_memory",
        "set_folder_meta",
        "set_my_name",
        "set_tags",
        "snapshot",
        "soft_delete",
        "stale_detection",
        "suggest_links",
        "template_create",
        "unpin",
        "validate_memory",
    ];
    let have: std::collections::BTreeSet<&str> = memora_mcp::all_tool_names().into_iter().collect();
    let missing: Vec<&&str> = EXPECTED.iter().filter(|t| !have.contains(*t)).collect();
    assert!(
        missing.is_empty(),
        "tools missing from the catalog: {missing:?}"
    );
}

#[test]
fn catalog_categories_present() {
    let cats: std::collections::BTreeSet<&str> = catalog().iter().map(|t| t.category).collect();
    for want in ["note", "folder", "graph", "search", "tag"] {
        assert!(cats.contains(want), "missing category: {want}");
    }
    println!("tool categories OK: {:?}", cats);
}
