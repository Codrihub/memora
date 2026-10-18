//! Per-agent privacy through the router: a folder hidden from key C and a note hidden
//! from key B stay invisible to them on every agent surface (HTTP API and MCP: read,
//! search, graph, tree, stats, backlinks, wikilinks, tags, files, events), writes into
//! or onto hidden paths are refused with the same "not found" as a missing path, the
//! owner session and other keys see everything, and node rules follow renames and moves.

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use memora_core::MemoryStore;
use memora_http::{build_router, cache, guard::Guard, AppState};
use memora_state::arm::ArmMode;
use memora_state::Db;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tower::Service;

const HOST: &str = "localhost:8477";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

struct Env {
    app: Router,
    vault: PathBuf,
    sid: String,
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.vault);
    }
}

fn write(vault: &std::path::Path, rel: &str, body: &[u8]) {
    let p = vault.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

async fn env(tag: &str) -> Env {
    let db = Db::open_temp().unwrap();
    memora_mcp::sync_catalog(&db).unwrap();
    let vault = std::env::temp_dir().join(format!("memora-priv-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&vault);
    write(
        &vault,
        "Private/plan.md",
        b"# Plan\nzebra plan #confidential [[hub]] ![[pic.png]]\n",
    );
    write(&vault, "Private/pic.png", PNG);
    write(
        &vault,
        "Notes/secret.md",
        b"# Secret\nzebra secret #confidential [[hub]]\n",
    );
    write(
        &vault,
        "Notes/open.md",
        b"# Open\nopen words [[secret]] [[plan]]\n",
    );
    write(&vault, "Public/hub.md", b"# Hub\nzebra hub\n");
    write(
        &vault,
        "Public/secret.md",
        b"# Other secret\nsame name, other folder\n",
    );
    db.write(|tx| {
        memora_state::settings::set_vault(tx, Some(vault.to_str().unwrap()), memora_state::now())
    })
    .unwrap();
    // Persist realtime events into this vault (the hub is global; this binary has one test).
    memora_core::events::hub().set_events_path(vault.join(".events.jsonl"));
    let store = Arc::new(Mutex::new(MemoryStore::new(&vault)));
    store.lock().unwrap().reindex().unwrap();
    let st = AppState::new(db, store, String::new(), Guard::new(""), vec![]).unwrap();
    let app = build_router(st.clone());
    let mut e = Env {
        app,
        vault,
        sid: String::new(),
    };
    // Owner session.
    let cli = Db::open(st.db.state_dir()).unwrap();
    let hash = cache::code_hash("JKMN-PQRS");
    cli.write(|tx| memora_state::arm::arm(tx, ArmMode::Bootstrap, 300, &hash, memora_state::now()))
        .unwrap();
    let (status, headers, body) = raw(
        &mut e,
        Method::POST,
        "/api/auth/bootstrap",
        Some(
            json!({"code": "JKMN-PQRS", "username": "Owner", "password": "correct horse battery"}),
        ),
        Who::Nobody,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let c = headers[header::SET_COOKIE].to_str().unwrap();
    e.sid = c
        .strip_prefix("memora_sess=")
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    e
}

#[derive(Clone, Copy)]
enum Who<'a> {
    Nobody,
    Owner,
    Key(&'a str),
}

async fn raw(
    e: &mut Env,
    method: Method,
    path: &str,
    body: Option<Value>,
    who: Who<'_>,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    let mut b = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, HOST)
        .header(header::CONTENT_TYPE, "application/json");
    match who {
        Who::Nobody => {}
        Who::Owner => {
            b = b
                .header(header::COOKIE, format!("memora_sess={}", e.sid))
                .header(header::ORIGIN, format!("http://{HOST}"));
        }
        Who::Key(k) => b = b.header(header::AUTHORIZATION, format!("Bearer {k}")),
    }
    let mut req = b
        .body(body.map_or_else(Body::empty, |v| Body::from(v.to_string())))
        .unwrap();
    let peer: SocketAddr = "127.0.0.1:40000".parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(peer));
    let res = e.app.call(req).await.unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 22)
        .await
        .unwrap();
    (
        status,
        headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn get(e: &mut Env, who: Who<'_>, path: &str) -> (StatusCode, Value) {
    let (s, _, b) = raw(e, Method::GET, path, None, who).await;
    (s, b)
}

async fn post(e: &mut Env, who: Who<'_>, path: &str, body: Value) -> (StatusCode, Value) {
    let (s, _, b) = raw(e, Method::POST, path, Some(body), who).await;
    (s, b)
}

/// `tools/call` over `/mcp`: `(isError, text)`.
async fn mcp(e: &mut Env, who: Who<'_>, tool: &str, args: Value) -> (bool, String) {
    let body = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                      "params": {"name": tool, "arguments": args}});
    let (s, _, b) = raw(e, Method::POST, "/mcp", Some(body), who).await;
    assert_eq!(s, StatusCode::OK, "{b}");
    if let Some(err) = b.get("error") {
        return (true, err.to_string());
    }
    (
        b["result"]["isError"].as_bool().unwrap(),
        b["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or("")
            .to_string(),
    )
}

async fn new_key(e: &mut Env, name: &str, scopes: &[&str]) -> (String, String) {
    let (s, b) = post(
        e,
        Who::Owner,
        "/api/keys",
        json!({"name": name, "scopes": scopes}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    (
        b["key"].as_str().unwrap().to_string(),
        b["id"].as_str().unwrap().to_string(),
    )
}

async fn set_rule(
    e: &mut Env,
    who: Who<'_>,
    path: &str,
    kind: &str,
    mode: &str,
    keys: &[&str],
) -> (StatusCode, Value) {
    let body = json!({"path": path, "kind": kind, "mode": mode, "keys": keys});
    let (s, _, b) = raw(e, Method::PUT, "/api/privacy/path", Some(body), who).await;
    (s, b)
}

/// Every place a hidden path could surface in an answer.
fn leaks(v: &Value, hidden: &[&str]) -> Option<String> {
    let s = v.to_string().to_lowercase();
    hidden
        .iter()
        .find(|h| s.contains(&h.to_lowercase()))
        .map(|h| format!("{h} in {v}"))
}

#[tokio::test]
async fn hidden_paths_never_reach_the_agents_they_are_hidden_from() {
    let mut e = env("leaks").await;
    let (ka, ida) = new_key(&mut e, "Agent A", &["mcp", "read", "write"]).await;
    let (kb, idb) = new_key(&mut e, "Agent B", &["mcp", "read", "write"]).await;
    let (kc, idc) = new_key(&mut e, "Agent C", &["mcp", "read", "write"]).await;
    let (a, b, c) = (Who::Key(&ka), Who::Key(&kb), Who::Key(&kc));

    // The owner hides the folder from C and the note from B.
    let (s, r) = set_rule(&mut e, Who::Owner, "Private", "folder", "deny", &[&idc]).await;
    assert_eq!(s, StatusCode::OK, "{r}");
    assert_eq!(r["private"], true);
    let (s, r) = set_rule(
        &mut e,
        Who::Owner,
        "Notes/secret.md",
        "node",
        "deny",
        &[&idb],
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r}");
    let mut can_see: Vec<(String, bool)> = r["agents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| {
            (
                a["id"].as_str().unwrap().to_string(),
                a["can_see"].as_bool().unwrap(),
            )
        })
        .collect();
    can_see.sort();
    let mut want = vec![
        (ida.clone(), true),
        (idb.clone(), false),
        (idc.clone(), true),
    ];
    want.sort();
    assert_eq!(can_see, want);

    // An agent without the admin scope cannot read or change rules.
    let (s, _) = get(&mut e, c, "/api/privacy").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = set_rule(&mut e, c, "Private", "folder", "deny", &[]).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (err, _) = mcp(&mut e, c, "privacy_clear", json!({"path": "Private"})).await;
    assert!(err);

    // A works in the private folder: its activity lands in the event log.
    let (err, _) = mcp(&mut e, a, "read_memory", json!({"path": "Private/plan.md"})).await;
    assert!(!err);
    let (err, _) = mcp(
        &mut e,
        a,
        "add_tags",
        json!({"path": "Private/plan.md", "tags": "busy"}),
    )
    .await;
    assert!(!err);
    let (_, all) = get(&mut e, Who::Owner, "/api/logs?range=all").await;
    assert!(
        all.to_string().contains("Private/plan.md"),
        "the owner sees it: {all}"
    );

    // ---- C: the folder does not exist ----
    let hidden_c = ["Private/", "plan.md", "pic.png"];
    let missing = get(&mut e, c, "/api/note?path=Nope/x.md").await;
    for p in [
        "Private/plan.md",
        "private/plan.md",
        "Private//plan.md",
        "./Private/plan.md",
    ] {
        let (s, body) = get(&mut e, c, &format!("/api/note?path={p}")).await;
        assert_eq!(s, missing.0, "{p}: {body}");
        assert_eq!(body["error"], json!(format!("not found: {p}")), "{p}");
    }
    for (path, _) in [
        ("/api/search?q=zebra", 0),
        ("/api/graph", 0),
        ("/api/tree", 0),
        ("/api/note?path=Public/hub.md", 0),
        ("/api/note?path=Notes/open.md", 0),
        ("/api/folder-meta", 0),
        ("/api/events?limit=500", 0),
        ("/api/logs?range=all", 0),
    ] {
        let (s, body) = get(&mut e, c, path).await;
        assert_eq!(s, StatusCode::OK, "{path}: {body}");
        assert_eq!(leaks(&body, &hidden_c), None, "{path}");
    }
    let (_, stats) = get(&mut e, c, "/api/stats").await;
    assert_eq!(stats["notes"], 4);
    let (s, _) = get(&mut e, c, "/api/vault/file?path=Private/pic.png").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = get(&mut e, a, "/api/vault/file?path=Private/pic.png").await;
    assert_eq!(s, StatusCode::OK);
    for (tool, args) in [
        ("search_memory", json!({"query": "zebra"})),
        ("list_memory", json!({})),
        ("get_graph", json!({})),
        ("list_folders", json!({})),
        ("get_tags", json!({})),
        ("search_by_tag", json!({"tag": "confidential"})),
        (
            "get_neighbors",
            json!({"path": "Public/hub.md", "depth": 2}),
        ),
        ("read_memory", json!({"path": "Public/hub.md"})),
        ("get_hubs", json!({})),
        ("query_memory", json!({})),
        ("broken_links", json!({})),
        ("stale_detection", json!({"days": 0})),
        ("get_todos", json!({})),
        ("find_similar", json!({"path": "Public/hub.md"})),
        ("get_events", json!({"limit": 500})),
        ("get_logs", json!({"range": "all"})),
        ("get_folder_meta", json!({})),
        ("get_locks", json!({})),
    ] {
        let (err, text) = mcp(&mut e, c, tool, args).await;
        assert!(!err, "{tool}: {text}");
        assert_eq!(leaks(&json!(text), &hidden_c), None, "{tool}");
    }
    let (_, stats) = mcp(&mut e, c, "get_stats", json!({})).await;
    assert!(stats.contains("\"notes\":4"), "{stats}");
    let (err, text) = mcp(&mut e, c, "read_memory", json!({"path": "Private/plan.md"})).await;
    assert!(err);
    assert_eq!(text, "not found: Private/plan.md");
    let (_, missing_text) = mcp(&mut e, c, "read_memory", json!({"path": "Nope/plan.md"})).await;
    assert_eq!(missing_text, "not found: Nope/plan.md");
    for (tool, args) in [
        (
            "get_note_at",
            json!({"path": "Private/plan.md", "rev": "HEAD"}),
        ),
        ("get_neighbors", json!({"path": "Private/plan.md"})),
        ("link_stats", json!({"path": "Private/plan.md"})),
    ] {
        let (err, text) = mcp(&mut e, c, tool, args).await;
        assert!(err, "{tool}: {text}");
    }

    // Writes into, onto or out of the hidden folder: refused, nothing changes.
    for (path, body) in [
        ("/api/create", json!({"title": "drop", "folder": "Private"})),
        (
            "/api/save",
            json!({"path": "Private/plan.md", "content": "x"}),
        ),
        (
            "/api/move",
            json!({"path": "Public/hub.md", "folder": "Private"}),
        ),
        (
            "/api/move",
            json!({"path": "Private/plan.md", "folder": "Public"}),
        ),
        (
            "/api/rename",
            json!({"path": "Private/plan.md", "name": "x"}),
        ),
        ("/api/delete", json!({"path": "Private/plan.md"})),
        ("/api/folder", json!({"name": "Private/Sub"})),
        (
            "/api/folder/rename",
            json!({"folder": "Private", "name": "Open"}),
        ),
        (
            "/api/folder/rename",
            json!({"folder": "Public", "name": "Private"}),
        ),
        (
            "/api/folder/move",
            json!({"folder": "Public", "into": "Private"}),
        ),
        ("/api/delete-folder", json!({"folder": "Private"})),
        (
            "/api/folder-meta",
            json!({"folder": "Private", "color": "#ff0000"}),
        ),
    ] {
        let (s, r) = post(&mut e, c, path, body.clone()).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{path} {body}: {r}");
    }
    for (tool, args) in [
        (
            "create_memory",
            json!({"title": "drop", "folder": "Private"}),
        ),
        (
            "save_memory",
            json!({"path": "Private/plan.md", "content": "x"}),
        ),
        (
            "patch_memory",
            json!({"path": "Private/plan.md", "ops": []}),
        ),
        (
            "move_memory",
            json!({"path": "Public/hub.md", "folder": "Private"}),
        ),
        (
            "rename_memory",
            json!({"path": "Private/plan.md", "new_name": "x"}),
        ),
        ("delete_memory", json!({"path": "Private/plan.md"})),
        ("soft_delete", json!({"path": "Private/plan.md"})),
        (
            "rename_folder",
            json!({"folder": "Private", "name": "Open"}),
        ),
        (
            "move_folder",
            json!({"folder": "Public", "into": "Private"}),
        ),
        ("delete_folder", json!({"folder": "Private"})),
        ("add_tags", json!({"path": "Private/plan.md", "tags": "x"})),
        ("duplicate_memory", json!({"path": "Private/plan.md"})),
        (
            "merge_memory",
            json!({"paths": ["Public/hub.md"], "into": "Private/plan.md"}),
        ),
    ] {
        let (err, text) = mcp(&mut e, c, tool, args).await;
        assert!(err, "{tool}: {text}");
    }
    let (_, r) = mcp(
        &mut e,
        c,
        "bulk_delete",
        json!({"paths": ["Private/plan.md"]}),
    )
    .await;
    assert!(r.contains("\"count\":0"), "{r}");
    let (_, r) = mcp(
        &mut e,
        c,
        "bulk_replace",
        json!({"find": "zebra", "replace": "lion"}),
    )
    .await;
    assert!(!r.contains("Private"), "{r}");
    assert!(std::fs::read_to_string(e.vault.join("Private/plan.md"))
        .unwrap()
        .contains("zebra plan"));
    assert!(!e.vault.join("Private/drop.md").exists());
    assert!(!e.vault.join("Private/Sub").exists());

    // ---- B: the note is hidden, the folder is not ----
    let (s, _) = get(&mut e, b, "/api/note?path=Notes/secret.md").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, r) = get(&mut e, b, "/api/note?path=Public/secret.md").await;
    assert_eq!(
        s,
        StatusCode::OK,
        "same name in another folder stays visible: {r}"
    );
    let (s, _) = get(&mut e, b, "/api/note?path=Private/plan.md").await;
    assert_eq!(s, StatusCode::OK);
    // Rename onto the hidden note's path, or move into its place: not found.
    let (s, _) = post(
        &mut e,
        b,
        "/api/rename",
        json!({"path": "Notes/open.md", "name": "secret"}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = post(
        &mut e,
        b,
        "/api/move",
        json!({"path": "Public/secret.md", "folder": "Notes"}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    // A folder holding the hidden note cannot be moved, renamed or deleted by B.
    let (s, _) = post(
        &mut e,
        b,
        "/api/folder/rename",
        json!({"folder": "Notes", "name": "N2"}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = post(&mut e, b, "/api/delete-folder", json!({"folder": "Notes"})).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    // Wikilinks in a visible note do not resolve to the hidden note.
    let (_, open) = get(&mut e, b, "/api/note?path=Notes/open.md").await;
    assert!(
        !open["html"].as_str().unwrap().contains("Notes/secret"),
        "{open}"
    );
    let (_, hub) = get(&mut e, b, "/api/note?path=Public/hub.md").await;
    assert_eq!(leaks(&hub["backlinks"], &["Notes/secret"]), None);
    let (_, graph) = get(&mut e, b, "/api/graph").await;
    assert_eq!(leaks(&graph, &["Notes/secret"]), None);

    // ---- A and the owner see everything ----
    for who in [a, Who::Owner] {
        let (s, _) = get(&mut e, who, "/api/note?path=Private/plan.md").await;
        assert_eq!(s, StatusCode::OK);
        let (s, _) = get(&mut e, who, "/api/note?path=Notes/secret.md").await;
        assert_eq!(s, StatusCode::OK);
        let (_, stats) = get(&mut e, who, "/api/stats").await;
        let (_, tree) = get(&mut e, who, "/api/tree").await;
        assert_eq!(stats["notes"], 5, "{tree}");
    }
    let (_, hits) = get(&mut e, Who::Owner, "/api/search?q=zebra").await;
    assert!(hits.to_string().contains("Private/plan.md"), "{hits}");

    // ---- The node rule follows renames and moves ----
    let (s, r) = post(
        &mut e,
        Who::Owner,
        "/api/rename",
        json!({"path": "Notes/secret.md", "name": "renamed"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r}");
    let (s, _) = get(&mut e, b, "/api/note?path=Notes/renamed.md").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (err, _) = mcp(
        &mut e,
        a,
        "move_memory",
        json!({"path": "Notes/renamed.md", "folder": "Archive"}),
    )
    .await;
    assert!(!err);
    let (s, _) = get(&mut e, b, "/api/note?path=Archive/renamed.md").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = get(&mut e, a, "/api/note?path=Archive/renamed.md").await;
    assert_eq!(s, StatusCode::OK);
    let (_, r) = get(
        &mut e,
        Who::Owner,
        "/api/privacy/path?path=Archive/renamed.md&kind=node",
    )
    .await;
    assert_eq!(r["own_rules"][0]["path"], "Archive/renamed.md", "{r}");
    // Events naming the note under its former paths stay hidden from B too.
    for path in ["/api/events?limit=500", "/api/logs?range=all"] {
        let (_, body) = get(&mut e, b, path).await;
        assert_eq!(
            leaks(
                &body,
                &["Notes/secret.md", "Notes/renamed.md", "Archive/renamed.md"]
            ),
            None,
            "{path}"
        );
    }
    let (_, body) = get(&mut e, Who::Owner, "/api/logs?range=all").await;
    assert!(
        body.to_string().contains("Notes/renamed.md"),
        "the owner sees the history"
    );
    // A note moved out of the private folder loses the folder's protection.
    let (s, _) = post(
        &mut e,
        Who::Owner,
        "/api/move",
        json!({"path": "Private/plan.md", "folder": "Public"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = get(&mut e, c, "/api/note?path=Public/plan.md").await;
    assert_eq!(s, StatusCode::OK);
    // The folder rule follows a folder rename.
    let (s, r) = post(
        &mut e,
        Who::Owner,
        "/api/folder/rename",
        json!({"folder": "Private", "name": "Vaulted"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r}");
    let (s, _) = get(&mut e, c, "/api/vault/file?path=Vaulted/pic.png").await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    // ---- Admin agents manage rules over MCP; changes are audit-logged ----
    let (kd, _) = new_key(&mut e, "Admin D", &["mcp", "read", "write", "admin"]).await;
    let d = Who::Key(&kd);
    let (err, text) = mcp(
        &mut e,
        d,
        "privacy_set",
        json!({"path": "Public/hub.md", "mode": "allow_only", "agents": ["Agent A"]}),
    )
    .await;
    assert!(!err, "{text}");
    let (s, _) = get(&mut e, b, "/api/note?path=Public/hub.md").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = get(&mut e, a, "/api/note?path=Public/hub.md").await;
    assert_eq!(s, StatusCode::OK);
    let (err, text) = mcp(&mut e, d, "privacy_list", json!({})).await;
    assert!(!err && text.contains("Public/hub.md"), "{text}");
    let (err, _) = mcp(&mut e, d, "privacy_clear", json!({"path": "Public/hub.md"})).await;
    assert!(!err);
    let (s, _) = get(&mut e, b, "/api/note?path=Public/hub.md").await;
    assert_eq!(s, StatusCode::OK);
    let (_, ev) = get(&mut e, Who::Owner, "/api/auth/events?q=privacy").await;
    let names: Vec<&str> = ev["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["event"].as_str().unwrap())
        .collect();
    assert!(
        names.contains(&"privacy_set") && names.contains(&"privacy_clear"),
        "{names:?}"
    );
    assert!(names.contains(&"privacy_follow"), "{names:?}");
}
