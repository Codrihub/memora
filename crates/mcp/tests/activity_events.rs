//! `ai_activity` realtime events from MCP tool calls: actor identity (key name / user),
//! `start` + `end` pairs sharing a `call_id`, `paths` from arguments and results, and
//! node events named by the same actor.

use memora_core::MemoryStore;
use memora_gateway::KeyPermissions;
use memora_mcp::{Caller, McpServer, RpcRequest};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast::Receiver;

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("memora-act-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("vault/Plan")).unwrap();
    std::fs::create_dir_all(dir.join("state")).unwrap();
    std::fs::write(
        dir.join("vault/Plan/Index.md"),
        "# Index\nzebra apples [[Other]]\n",
    )
    .unwrap();
    std::fs::write(dir.join("vault/Plan/Other.md"), "# Other\nzebra pears\n").unwrap();
    dir
}

fn server(dir: &Path) -> McpServer {
    let store = MemoryStore::new(dir.join("vault").to_string_lossy().to_string());
    store.reindex().unwrap();
    let db = memora_state::Db::open(&dir.join("state")).unwrap();
    memora_mcp::sync_catalog(&db).unwrap();
    McpServer::new(Arc::new(Mutex::new(store)), db)
}

fn call(srv: &McpServer, caller: &Caller, tool: &str, args: Value) -> Value {
    let req = RpcRequest {
        jsonrpc: Some("2.0".into()),
        id: Some(json!(1)),
        method: "tools/call".into(),
        params: json!({"name": tool, "arguments": args}),
    };
    serde_json::to_value(srv.handle_as(&req, caller)).unwrap()
}

/// Events published so far whose `actor` is `actor` (the hub is process-global and
/// tests run in parallel, so every test uses its own actor).
fn drain(rx: &mut Receiver<Arc<str>>, actor: &str) -> Vec<Value> {
    let mut out = Vec::new();
    while let Ok(line) = rx.try_recv() {
        let v: Value = serde_json::from_str(&line).unwrap();
        if v["actor"] == actor {
            out.push(v);
        }
    }
    out
}

fn activity(evs: &[Value]) -> Vec<&Value> {
    evs.iter().filter(|e| e["type"] == "ai_activity").collect()
}

fn agent(id: &str, name: &str) -> Caller {
    Caller::key(id, KeyPermissions::default(), Some("127.0.0.1".into())).named(name)
}

#[test]
fn key_call_carries_name_paths_and_end_event() {
    let dir = scratch("key");
    let srv = server(&dir);
    let mut rx = memora_core::events::hub().subscribe();
    let bot = agent("k_actkey1", "research-bot");

    let r = call(&srv, &bot, "read_memory", json!({"path": "Plan/Index.md"}));
    assert_eq!(r["result"]["isError"], false, "{r}");
    let evs = drain(&mut rx, "research-bot");
    let act = activity(&evs);
    assert_eq!(act.len(), 2, "{evs:?}");
    let (s, e) = (act[0], act[1]);
    assert_eq!(s["phase"], "start");
    assert_eq!(e["phase"], "end");
    for v in [s, e] {
        assert_eq!(v["actor"], "research-bot");
        assert_eq!(v["actor_kind"], "agent");
        assert_eq!(v["actor_id"], "k_actkey1");
        assert_eq!(v["action"], "read_memory");
        assert_eq!(v["label"], "Plan/Index.md");
        assert_eq!(v["paths"], json!(["Plan/Index.md"]));
        assert!(v.to_string().len() < 2048);
    }
    assert_eq!(s["call_id"], e["call_id"]);
    assert!(s["call_id"].as_str().is_some_and(|c| !c.is_empty()));
    assert_eq!(e["ok"], true);
    assert!(e["ms"].as_u64().is_some());
    // A read-only call's start is published after it ran (it is the row the log
    // keeps), so it already carries the outcome: no reader shows it as running.
    assert_eq!(s["ok"], true);
    assert!(s["ms"].as_u64().is_some());

    // A key without a name falls back to its id.
    let anon = Caller::key("k_actanon", KeyPermissions::default(), None).named("  ");
    call(&srv, &anon, "get_stats", json!({}));
    let evs = drain(&mut rx, "k_actanon");
    assert_eq!(activity(&evs).len(), 2);
    assert_eq!(evs[0]["actor_kind"], "agent");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn search_results_become_paths_on_start() {
    let dir = scratch("search");
    let srv = server(&dir);
    let mut rx = memora_core::events::hub().subscribe();
    let bot = agent("k_actsrch", "search-bot");
    let r = call(&srv, &bot, "search_memory", json!({"query": "zebra"}));
    assert_eq!(r["result"]["isError"], false, "{r}");
    let evs = drain(&mut rx, "search-bot");
    let act = activity(&evs);
    assert_eq!(act.len(), 2, "{evs:?}");
    let mut paths: Vec<String> = serde_json::from_value(act[0]["paths"].clone()).unwrap();
    paths.sort();
    assert_eq!(paths, ["Plan/Index.md", "Plan/Other.md"]);
    assert_eq!(act[0]["phase"], "start");
    assert_eq!(act[0]["label"], "zebra");
    assert_eq!(act[1]["paths"], act[0]["paths"]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn writes_start_before_and_end_with_result_paths() {
    let dir = scratch("write");
    let srv = server(&dir);
    let mut rx = memora_core::events::hub().subscribe();
    let bot = agent("k_actwrt1", "writer-bot");

    let r = call(
        &srv,
        &bot,
        "create_memory",
        json!({"title": "Fresh", "folder": "Plan", "content": "hi"}),
    );
    assert_eq!(r["result"]["isError"], false, "{r}");
    let evs = drain(&mut rx, "writer-bot");
    let types: Vec<String> = evs
        .iter()
        .map(|e| format!("{}:{}", e["type"], e["phase"]))
        .collect();
    // start, node_created (same actor), end.
    assert_eq!(
        types,
        [
            "\"ai_activity\":\"start\"",
            "\"node_created\":null",
            "\"ai_activity\":\"end\""
        ],
        "{evs:?}"
    );
    assert_eq!(evs[0]["paths"], json!([]));
    // A write's start goes out before it runs: no outcome yet.
    assert!(evs[0].get("ok").is_none() && evs[0].get("ms").is_none());
    let created = evs[2]["paths"][0].as_str().unwrap().to_string();
    assert!(created.ends_with("Fresh.md"), "{created}");
    assert_eq!(evs[1]["actor"], "writer-bot");

    // Move: the argument path on start, plus the destination on end.
    call(
        &srv,
        &bot,
        "move_memory",
        json!({"path": created, "folder": "Archive"}),
    );
    let evs = drain(&mut rx, "writer-bot");
    let act = activity(&evs);
    assert_eq!(act[0]["paths"], json!([created]));
    let end_paths = act[1]["paths"].as_array().unwrap();
    assert_eq!(end_paths.len(), 2, "{end_paths:?}");
    assert!(end_paths[1].as_str().unwrap().starts_with("Archive/"));
    assert_eq!(act[0]["call_id"], act[1]["call_id"]);

    // A failing call ends with ok:false and a short error.
    let r = call(
        &srv,
        &bot,
        "read_memory",
        json!({"path": "Nope/missing.md"}),
    );
    assert_eq!(r["result"]["isError"], true);
    let evs = drain(&mut rx, "writer-bot");
    let end = activity(&evs)
        .into_iter()
        .find(|e| e["phase"] == "end")
        .unwrap()
        .clone();
    assert_eq!(end["ok"], false);
    assert!(end["error"]
        .as_str()
        .is_some_and(|m| !m.is_empty() && m.len() <= 400));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn browser_caller_is_a_user_and_ids_differ_per_call() {
    let dir = scratch("user");
    let srv = server(&dir);
    let mut rx = memora_core::events::hub().subscribe();
    let me = Caller::full("act-owner");
    call(&srv, &me, "get_stats", json!({}));
    call(&srv, &me, "get_stats", json!({}));
    let evs = drain(&mut rx, "act-owner");
    let act = activity(&evs);
    assert_eq!(act.len(), 4);
    assert!(act.iter().all(|e| e["actor_kind"] == "user"));
    assert_eq!(act[0]["call_id"], act[1]["call_id"]);
    assert_ne!(act[0]["call_id"], act[2]["call_id"]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn initialize_registers_the_key_name_as_alias() {
    let dir = scratch("alias");
    let srv = server(&dir);
    let req = RpcRequest {
        jsonrpc: Some("2.0".into()),
        id: Some(json!(1)),
        method: "initialize".into(),
        params: json!({}),
    };
    srv.handle_as(&req, &agent("k_actals1", "alias-bot"));
    srv.handle_as(&req, &agent("k_actals1", "alias-bot"));
    srv.handle_as(&req, &Caller::full("owner"));
    let list = srv.aliases();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].alias, "alias-bot");
    assert_eq!(list[0].key_id, "k_actals1");
    assert_eq!(list[0].key_name.as_deref(), Some("alias-bot"));
    assert_eq!(list[0].connections, 2);
    let _ = std::fs::remove_dir_all(&dir);
}
