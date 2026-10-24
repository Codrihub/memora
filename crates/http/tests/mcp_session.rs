//! MCP Streamable HTTP sessions: ids are never refused, and an SSE-capable session
//! hears `notifications/tools/list_changed` once per catalog change.

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
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

const HOST: &str = "localhost:8476";
const PASSWORD: &str = "correct horse battery";

struct Env {
    st: AppState,
    app: Router,
    vault: PathBuf,
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.vault);
        let _ = std::fs::remove_dir_all(self.vault.with_extension("assets"));
    }
}

fn env(tag: &str) -> Env {
    let db = Db::open_temp().unwrap();
    memora_mcp::sync_catalog(&db).unwrap();
    let vault = std::env::temp_dir().join(format!(
        "memora-http-mcp-session-{tag}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&vault);
    std::fs::create_dir_all(vault.join("Plan")).unwrap();
    std::fs::write(vault.join("Plan/Index.md"), "# Index\n").unwrap();
    db.write(|tx| {
        memora_state::settings::set_vault(tx, Some(vault.to_str().unwrap()), memora_state::now())
    })
    .unwrap();
    // The app shell, outside the vault (deep-link tests prove no other file is read).
    let assets = vault.with_extension("assets");
    let _ = std::fs::remove_dir_all(&assets);
    std::fs::create_dir_all(&assets).unwrap();
    std::fs::write(
        assets.join("index.html"),
        "<!doctype html><title>SHELL</title><script>boot()</script>",
    )
    .unwrap();
    std::fs::write(
        assets.join("sw.js"),
        "self.addEventListener('fetch', () => {});\n",
    )
    .unwrap();
    let store = Arc::new(Mutex::new(MemoryStore::new(&vault)));
    let st = AppState::new(
        db,
        store,
        assets.to_string_lossy().to_string(),
        Guard::new(""),
        vec![],
    )
    .unwrap();
    let app = build_router(st.clone());
    Env { st, app, vault }
}

/// Another connection to the same database, as `memora-cli` would open it.
fn cli(e: &Env) -> Db {
    Db::open(e.st.db.state_dir()).unwrap()
}

fn arm(db: &Db, mode: ArmMode, code: &str) {
    let hash = cache::code_hash(code);
    db.write(|tx| memora_state::arm::arm(tx, mode, 300, &hash, memora_state::now()))
        .unwrap();
}

struct Resp {
    status: StatusCode,
    headers: HeaderMap,
    body: Value,
    raw: String,
}

impl Resp {
    fn cookie(&self) -> String {
        let c = self.headers[header::SET_COOKIE].to_str().unwrap();
        c.strip_prefix("memora_sess=")
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string()
    }
}

#[derive(Default)]
struct Opts<'a> {
    cookie: Option<&'a str>,
    key: Option<&'a str>,
    same_origin: bool,
    peer: Option<&'a str>,
    session: Option<&'a str>,
    sse: bool,
}

async fn call(e: &mut Env, method: Method, path: &str, body: Option<Value>, o: Opts<'_>) -> Resp {
    let mut b = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, HOST)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(c) = o.cookie {
        b = b.header(header::COOKIE, format!("memora_sess={c}"));
    }
    if let Some(k) = o.key {
        b = b.header(header::AUTHORIZATION, format!("Bearer {k}"));
    }
    if o.sse {
        b = b.header(header::ACCEPT, "application/json, text/event-stream");
    }
    if let Some(s) = o.session {
        b = b.header("mcp-session-id", s);
    }
    if o.same_origin {
        b = b.header(header::ORIGIN, format!("http://{HOST}"));
    }
    let mut req = b
        .body(match body {
            Some(v) => Body::from(v.to_string()),
            None => Body::empty(),
        })
        .unwrap();
    let peer: SocketAddr = format!("{}:40000", o.peer.unwrap_or("127.0.0.1"))
        .parse()
        .unwrap();
    req.extensions_mut().insert(ConnectInfo(peer));
    let res = e.app.call(req).await.unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
        .await
        .unwrap();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Resp {
        status,
        headers,
        body,
        raw: String::from_utf8_lossy(&bytes).to_string(),
    }
}

async fn bootstrap(e: &mut Env, code: &str) -> Resp {
    let body = json!({"code": code, "username": "Owner", "password": PASSWORD});
    call(
        e,
        Method::POST,
        "/api/auth/bootstrap",
        Some(body),
        Opts::default(),
    )
    .await
}

/// Signed-in owner session cookie.
async fn signed_in(e: &mut Env) -> String {
    arm(&cli(e), ArmMode::Bootstrap, "JKMN-PQRS");
    let r = bootstrap(e, "JKMN-PQRS").await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    r.cookie()
}

/// Create an API key from the browser; returns (raw key, id).
async fn new_key(e: &mut Env, sid: &str, name: &str, scopes: &[&str]) -> (String, String) {
    let r = call(
        e,
        Method::POST,
        "/api/keys",
        Some(json!({"name": name, "scopes": scopes})),
        Opts {
            cookie: Some(sid),
            same_origin: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    (
        r.body["key"].as_str().unwrap().to_string(),
        r.body["id"].as_str().unwrap().to_string(),
    )
}

fn rpc(method: &str, params: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
}

fn browser(sid: &str) -> Opts<'_> {
    Opts {
        cookie: Some(sid),
        same_origin: true,
        ..Default::default()
    }
}

fn as_key<'a>(key: &'a str, session: Option<&'a str>) -> Opts<'a> {
    Opts {
        key: Some(key),
        session,
        sse: true,
        ..Default::default()
    }
}

/// An SSE answer's events (`data:` lines as JSON), or `None` for a JSON answer.
fn sse_events(r: &Resp) -> Option<Vec<Value>> {
    let ct = r.headers.get(header::CONTENT_TYPE)?.to_str().unwrap();
    if !ct.starts_with("text/event-stream") {
        return None;
    }
    Some(
        r.raw
            .lines()
            .filter_map(|l| l.strip_prefix("data: "))
            .map(|d| serde_json::from_str(d).unwrap())
            .collect(),
    )
}

/// The JSON-RPC response of a JSON or SSE answer, and whether `list_changed` came first.
fn response(r: &Resp) -> (Value, bool) {
    assert_eq!(r.status, StatusCode::OK, "{}", r.raw);
    match sse_events(r) {
        None => (r.body.clone(), false),
        Some(ev) => {
            assert_eq!(ev.len(), 2, "{}", r.raw);
            assert_eq!(ev[0]["method"], "notifications/tools/list_changed");
            assert!(ev[0].get("id").is_none());
            (ev[1].clone(), true)
        }
    }
}

fn names(v: &Value) -> Vec<String> {
    v["result"]["tools"]
        .as_array()
        .unwrap_or_else(|| panic!("no tools: {v}"))
        .iter()
        .map(|t| t["name"].as_str().unwrap().to_string())
        .collect()
}

async fn initialize(e: &mut Env, key: &str, session: Option<&str>) -> String {
    let r = call(
        e,
        Method::POST,
        "/mcp",
        Some(rpc("initialize", json!({"protocolVersion": "2025-06-18"}))),
        as_key(key, session),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.raw);
    assert!(sse_events(&r).is_none(), "initialize is plain JSON");
    assert_eq!(r.body["result"]["serverInfo"]["name"], "memora");
    assert_eq!(
        r.body["result"]["capabilities"]["tools"]["listChanged"],
        true
    );
    let sid = r.headers["mcp-session-id"].to_str().unwrap().to_string();
    assert!(sid.bytes().all(|b| (0x21..=0x7e).contains(&b)), "{sid}");
    let (epoch, rand) = sid.split_once('.').unwrap();
    assert_eq!(epoch.len(), 16);
    assert_eq!(rand.len(), 32);
    sid
}

async fn tools_list_with(e: &mut Env, o: Opts<'_>) -> (Vec<String>, bool) {
    let r = call(
        e,
        Method::POST,
        "/mcp",
        Some(rpc("tools/list", json!({}))),
        o,
    )
    .await;
    let (v, changed) = response(&r);
    (names(&v), changed)
}

async fn tools_list(e: &mut Env, key: &str, session: Option<&str>) -> (Vec<String>, bool) {
    tools_list_with(e, as_key(key, session)).await
}

async fn switch_tool(e: &mut Env, sid: &str, name: &str, enabled: bool) {
    let r = call(
        e,
        Method::POST,
        "/api/tools",
        Some(json!({"name": name, "enabled": enabled})),
        browser(sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
}

const PIN: &str = "pin";
fn has(list: &[String], n: &str) -> bool {
    list.iter().any(|x| x == n)
}

#[tokio::test]
async fn changed_catalogs_stream_list_changed_once() {
    let mut e = env("stale");
    let sid = signed_in(&mut e).await;
    let (key, _) = new_key(&mut e, &sid, "agent1", &["read", "write", "mcp"]).await;

    let s1 = initialize(&mut e, &key, None).await;
    let s1b = initialize(&mut e, &key, None).await;
    assert_ne!(s1, s1b);
    assert_eq!(s1.split('.').next(), s1b.split('.').next());

    // Same catalog: plain JSON, pin tools listed.
    let (list, changed) = tools_list(&mut e, &key, Some(&s1)).await;
    assert!(!changed);
    for t in ["list_pins", "pin", "unpin"] {
        assert!(has(&list, t), "{t} missing: {list:?}");
    }

    // A tool is switched off: the next request hears list_changed, once.
    switch_tool(&mut e, &sid, PIN, false).await;
    let (list, changed) = tools_list(&mut e, &key, Some(&s1)).await;
    assert!(changed);
    assert!(!has(&list, PIN));
    let (list, changed) = tools_list(&mut e, &key, Some(&s1)).await;
    assert!(!changed);
    assert!(!has(&list, PIN));
    // Another session from before the change hears it on a tools/call too.
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(rpc(
            "tools/call",
            json!({"name": "list_pins", "arguments": {}}),
        )),
        as_key(&key, Some(&s1b)),
    )
    .await;
    let (v, changed) = response(&r);
    assert!(changed);
    assert_eq!(v["result"]["isError"], false, "{v}");
    // Notifications are never wrapped.
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(json!({"jsonrpc": "2.0", "method": "notifications/initialized"})),
        as_key(&key, Some(&s1)),
    )
    .await;
    assert_eq!(r.status, StatusCode::ACCEPTED);

    // Switched back on: told again, and the tool is back.
    switch_tool(&mut e, &sid, PIN, true).await;
    let (list, changed) = tools_list(&mut e, &key, Some(&s1)).await;
    assert!(changed);
    assert!(has(&list, PIN));
    let (_, changed) = tools_list(&mut e, &key, Some(&s1)).await;
    assert!(!changed);
    // s1b last heard "pin off"; it is told about "pin on" too.
    let (list, changed) = tools_list(&mut e, &key, Some(&s1b)).await;
    assert!(changed);
    assert!(has(&list, PIN));
    // A session from before a change that was undone saw nothing different.
    let s2 = initialize(&mut e, &key, None).await;
    switch_tool(&mut e, &sid, PIN, false).await;
    switch_tool(&mut e, &sid, PIN, true).await;
    let (_, changed) = tools_list(&mut e, &key, Some(&s2)).await;
    assert!(!changed);
}

#[tokio::test]
async fn json_only_and_stateless_clients_get_json() {
    let mut e = env("jsononly");
    let sid = signed_in(&mut e).await;
    let (key, _) = new_key(&mut e, &sid, "agent1", &["read", "write", "mcp"]).await;
    let s = initialize(&mut e, &key, None).await;
    switch_tool(&mut e, &sid, PIN, false).await;
    // No event streams accepted: plain JSON, nothing recorded...
    let json_only = Opts {
        key: Some(&key),
        session: Some(&s),
        ..Default::default()
    };
    let (list, changed) = tools_list_with(&mut e, json_only).await;
    assert!(!changed);
    assert!(!has(&list, PIN));
    // ...so the same session still hears it once it accepts streams.
    let (_, changed) = tools_list(&mut e, &key, Some(&s)).await;
    assert!(changed);
    // No session id: plain JSON.
    let (list, changed) = tools_list(&mut e, &key, None).await;
    assert!(!changed);
    assert!(!has(&list, PIN));
}

#[tokio::test]
async fn unknown_and_malformed_ids_are_harmless() {
    let mut e = env("malformed");
    let sid = signed_in(&mut e).await;
    let (key, _) = new_key(&mut e, &sid, "agent1", &["read", "write", "mcp"]).await;
    let good = initialize(&mut e, &key, None).await;
    let rand = good.split_once('.').unwrap().1.to_string();
    // An id from another epoch (older server, before a restart): it is told.
    let other = format!("0123456789abcdef.{rand}");
    let (_, changed) = tools_list(&mut e, &key, Some(&other)).await;
    assert!(changed);
    let (_, changed) = tools_list(&mut e, &key, Some(&other)).await;
    assert!(!changed);
    // Malformed ids count as no session: plain answers, never an error.
    let long = "f".repeat(300);
    for bad in [
        "",
        "garbage",
        ".",
        "abc.",
        ".abc",
        "zz.yy",
        long.as_str(),
        "1.2.3",
    ] {
        let (list, changed) = tools_list(&mut e, &key, Some(bad)).await;
        assert!(!changed, "{bad:?}");
        assert!(has(&list, PIN));
    }
    let (_, changed) = tools_list(&mut e, &key, Some(&good)).await;
    assert!(!changed);
}

#[tokio::test]
async fn key_grant_changes_the_epoch() {
    let mut e = env("grant");
    let sid = signed_in(&mut e).await;
    let (read_key, _) = new_key(&mut e, &sid, "reader", &["read", "mcp"]).await;
    let (write_key, _) = new_key(&mut e, &sid, "writer", &["read", "write", "mcp"]).await;
    let r = initialize(&mut e, &read_key, None).await;
    let w = initialize(&mut e, &write_key, None).await;
    assert_ne!(r.split('.').next(), w.split('.').next());
    let (list, changed) = tools_list(&mut e, &read_key, Some(&r)).await;
    assert!(!changed);
    assert!(!has(&list, PIN));
    // The reader's session id used by the writer: a different catalog, so it is told.
    let (list, changed) = tools_list(&mut e, &write_key, Some(&r)).await;
    assert!(changed);
    assert!(has(&list, PIN));
}

#[tokio::test]
async fn delete_ends_a_session_and_auth_is_unchanged() {
    let mut e = env("delete");
    let sid = signed_in(&mut e).await;
    let (key, _) = new_key(&mut e, &sid, "agent1", &["read", "write", "mcp"]).await;
    let s = initialize(&mut e, &key, None).await;
    let r = call(&mut e, Method::DELETE, "/mcp", None, as_key(&key, Some(&s))).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    let r = call(
        &mut e,
        Method::DELETE,
        "/mcp",
        None,
        as_key(&key, Some("x")),
    )
    .await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    // Without a session id there is nothing to end; GET has no stream.
    let r = call(&mut e, Method::DELETE, "/mcp", None, as_key(&key, None)).await;
    assert_eq!(r.status, StatusCode::METHOD_NOT_ALLOWED);
    let r = call(&mut e, Method::GET, "/mcp", None, as_key(&key, Some(&s))).await;
    assert_eq!(r.status, StatusCode::METHOD_NOT_ALLOWED);
    // An ended session's id still works (nothing is refused).
    let (_, changed) = tools_list(&mut e, &key, Some(&s)).await;
    assert!(!changed);
    // Auth still comes first: no key, a wrong key, or a key without `mcp`.
    let r = call(
        &mut e,
        Method::DELETE,
        "/mcp",
        None,
        Opts {
            session: Some(&s),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    assert!(r.headers.contains_key(header::WWW_AUTHENTICATE));
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(rpc("tools/list", json!({}))),
        as_key("memora_live_00000000000000000000000000000000", Some(&s)),
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    let (no_mcp, _) = new_key(&mut e, &sid, "api-only", &["read"]).await;
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(rpc("initialize", json!({}))),
        as_key(&no_mcp, None),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert!(!r.headers.contains_key("mcp-session-id"));
}

#[tokio::test]
async fn browser_sessions_get_an_id_too() {
    let mut e = env("browser");
    let sid = signed_in(&mut e).await;
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(rpc("initialize", json!({}))),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    let s = r.headers["mcp-session-id"].to_str().unwrap().to_string();
    let (list, changed) = tools_list_with(
        &mut e,
        Opts {
            session: Some(&s),
            sse: true,
            ..browser(&sid)
        },
    )
    .await;
    assert!(!changed);
    assert!(has(&list, "admin_list_tools"));
}

#[tokio::test]
async fn mcp_pin_changes_name_the_agent_but_no_path() {
    let mut e = env("pinactor");
    let sid = signed_in(&mut e).await;
    let (key, id) = new_key(&mut e, &sid, "pin-actor-agent", &["read", "write", "mcp"]).await;
    let mut rx = memora_core::events::hub().subscribe();
    for tool in ["pin", "unpin"] {
        let r = call(
            &mut e,
            Method::POST,
            "/mcp",
            Some(rpc(
                "tools/call",
                json!({"name": tool, "arguments": {"path": "Plan/Index.md"}}),
            )),
            as_key(&key, None),
        )
        .await;
        assert_eq!(r.body["result"]["isError"], false, "{}", r.body);
    }
    // A browser pin names nobody.
    let r = call(
        &mut e,
        Method::POST,
        "/api/pins/pin",
        Some(json!({"kind": "note", "path": "Plan/Index.md"})),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let mut mine = 0;
    let mut anonymous = 0;
    while let Ok(line) = rx.try_recv() {
        let v: Value = serde_json::from_str(&line).unwrap();
        if v["type"] != "pins_changed" {
            continue;
        }
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert!(
            keys.iter().all(
                |k| ["type", "actor", "actor_id", "actor_kind"].contains(&k.as_str())
                    || k.starts_with('_')
            ),
            "{v}"
        );
        assert!(!line.contains("Index"), "{line}");
        if v["actor"] == "pin-actor-agent" {
            assert_eq!(v["actor_id"], id.as_str());
            assert_eq!(v["actor_kind"], "agent");
            mine += 1;
        } else if v.get("actor").is_none() {
            anonymous += 1;
        }
    }
    assert_eq!(mine, 2);
    assert!(anonymous >= 1);
}
