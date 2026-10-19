//! Search and graph tools through `tools/call`: search finds notes on disk without
//! any write (also notes added behind the server's back), graph tools resolve paths
//! alike and agree on links, and negative counts are refused by the schemas.

use memora_core::MemoryStore;
use memora_mcp::{Caller, McpServer, RpcRequest};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("memora-gs-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("vault/Graph/Sub")).unwrap();
    std::fs::create_dir_all(dir.join("state")).unwrap();
    let w = |p: &str, c: &str| std::fs::write(dir.join("vault").join(p), c).unwrap();
    w("Graph/A.md", "alpha zebra [[B]] [[A]] [[Nope]]\n");
    w("Graph/B.md", "beta alpha [[A]]\n- [ ] ship it\n- [ ] \n");
    w(
        "Graph/Sub/F.md",
        "---\nstatus: waiting\n---\nfox [[A]] #Deep\n",
    );
    dir
}

fn server(dir: &Path) -> McpServer {
    // No reindex: the server must find what is on disk by itself.
    let store = MemoryStore::new(dir.join("vault").to_string_lossy().to_string());
    let db = memora_state::Db::open(&dir.join("state")).unwrap();
    memora_mcp::sync_catalog(&db).unwrap();
    McpServer::new(Arc::new(Mutex::new(store)), db)
}

fn call(srv: &McpServer, name: &str, args: Value) -> (bool, String) {
    let req = RpcRequest {
        jsonrpc: Some("2.0".into()),
        id: Some(json!(1)),
        method: "tools/call".into(),
        params: json!({"name": name, "arguments": args}),
    };
    let r = serde_json::to_value(srv.handle_as(&req, &Caller::full("owner"))).unwrap();
    let text = r["result"]["content"][0]["text"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    (r["result"]["isError"] == true, text)
}

fn ok(srv: &McpServer, name: &str, args: Value) -> Value {
    let (e, text) = call(srv, name, args);
    assert!(!e, "{name}: {text}");
    serde_json::from_str(&text).unwrap()
}

#[test]
fn search_finds_notes_on_disk_and_external_changes() {
    let dir = scratch("fresh");
    let srv = server(&dir);
    let hits = ok(&srv, "search_memory", json!({"q": "zebra"}));
    assert_eq!(hits.as_array().unwrap().len(), 1, "{hits}");
    assert_eq!(hits[0]["path"], "Graph/A.md");
    // A note copied in from outside (Obsidian, git pull) shows up at once.
    std::fs::write(dir.join("vault/Graph/New.md"), "outside zebra\n").unwrap();
    let hits = ok(&srv, "search_memory", json!({"q": "zebra"}));
    assert_eq!(hits.as_array().unwrap().len(), 2, "{hits}");
    // ... and leaves again when removed outside.
    std::fs::remove_file(dir.join("vault/Graph/New.md")).unwrap();
    let hits = ok(&srv, "search_memory", json!({"q": "zebra"}));
    assert_eq!(hits.as_array().unwrap().len(), 1, "{hits}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn graph_tools_resolve_paths_and_agree_on_links() {
    let dir = scratch("graph");
    let srv = server(&dir);
    let ls = ok(&srv, "link_stats", json!({"path": "Graph/A"}));
    assert_eq!(ls["path"], "Graph/A.md");
    assert_eq!(ls["links_to"], json!(["B"]));
    assert_eq!(ls["linked_from"], json!(["B", "F"]));
    assert_eq!(ls["unresolved"], json!(["Nope"]));
    assert_eq!(ls["degree"], 2);
    let hubs = ok(&srv, "get_hubs", json!({}));
    assert_eq!(hubs[0]["name"], "A");
    assert_eq!(hubs[0]["degree"], 2);
    let g = ok(&srv, "get_graph", json!({}));
    let a = g["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "A")
        .unwrap();
    assert_eq!(a["degree"], 2);
    // B->A, A->B, F->A.
    assert_eq!(g["links"].as_array().unwrap().len(), 3, "{g}");
    assert_eq!(ok(&srv, "get_stats", json!({}))["links"], 3);

    for bad in ["Nope.md", "", "/etc/passwd", "Graph", "../x.md"] {
        let (e, text) = call(&srv, "link_stats", json!({"path": bad}));
        assert!(e, "{bad:?}: {text}");
    }
    let (e, text) = call(&srv, "find_path", json!({"source": "A", "target": "Zed"}));
    assert!(e && text.contains("target not found: Zed"), "{text}");
    assert_eq!(
        ok(&srv, "find_similar", json!({"path": "A"}))[0]["name"],
        "B"
    );
    assert!(ok(&srv, "suggest_links", json!({"path": "A"})).is_array());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn query_todos_and_follow_ups() {
    let dir = scratch("query");
    let srv = server(&dir);
    let q = ok(
        &srv,
        "query_memory",
        json!({"folder": "Graph/Sub", "tags": "#deep"}),
    );
    assert_eq!(q.as_array().unwrap().len(), 1, "{q}");
    assert_eq!(q[0]["path"], "Graph/Sub/F.md");
    assert_eq!(
        ok(&srv, "query_memory", json!({"folder": "Graph/"}))
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(ok(&srv, "query_memory", json!({"limit": 0})), json!([]));

    let t = ok(&srv, "get_todos", json!({"path": "Graph/B"}));
    assert_eq!(
        t,
        json!([{"path": "Graph/B.md", "done": false, "text": "ship it", "line": 2}])
    );
    let (e, text) = call(&srv, "get_todos", json!({"path": "Nope.md"}));
    assert!(e && text.contains("not found: Nope.md"), "{text}");
    let (e, _) = call(&srv, "get_todos", json!({"path": "../x.md"}));
    assert!(e);

    let f = ok(&srv, "follow_ups", json!({}));
    assert_eq!(f["count"], 1, "{f}");
    assert_eq!(f["notes"][0]["status"], "waiting");
    let f = ok(&srv, "follow_ups", json!({"limit": 0}));
    assert_eq!(f["truncated"], true);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn negative_counts_are_refused() {
    let dir = scratch("neg");
    let srv = server(&dir);
    for (tool, args) in [
        ("search_memory", json!({"q": "zebra", "limit": -1})),
        ("get_neighbors", json!({"path": "A", "depth": -1})),
        ("get_subgraph", json!({"path": "A", "max_nodes": 0})),
        ("get_subgraph", json!({"path": "A", "depth": -2})),
        ("get_hubs", json!({"limit": -1})),
        ("find_similar", json!({"path": "A", "limit": -1})),
        ("suggest_links", json!({"path": "A", "limit": -1})),
        ("query_memory", json!({"limit": -1})),
        ("stale_detection", json!({"days": -1})),
        ("follow_ups", json!({"limit": -1})),
        ("digest", json!({"limit": -1})),
    ] {
        let (e, text) = call(&srv, tool, args.clone());
        assert!(
            e && text.contains("must be at least"),
            "{tool} {args}: {text}"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}
