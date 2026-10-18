//! UI backend through the router: `ai_activity` events from `/mcp` carry the
//! API key's NAME (`actor_kind: "agent"`) or the browser user, with `start`/`end`
//! pairs; `/api/aliases`, `/api/events` and `/api/auth/events` expose the name; and
//! `GET/PUT /api/ui/layout/{name}` (browser session only, same-origin, size and name
//! checks).

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
    let vault = std::env::temp_dir().join(format!("memora-http-ui-{tag}-{}", std::process::id()));
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
    std::fs::write(vault.join("secret.txt"), "TOP-SECRET").unwrap();
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

fn drain(rx: &mut tokio::sync::broadcast::Receiver<Arc<str>>, actor: &str) -> Vec<Value> {
    let mut out = Vec::new();
    while let Ok(line) = rx.try_recv() {
        let v: Value = serde_json::from_str(&line).unwrap();
        if v["actor"] == actor && v["type"] == "ai_activity" {
            out.push(v);
        }
    }
    out
}

#[tokio::test]
async fn mcp_activity_is_named_after_the_key() {
    let mut e = env("actor");
    // Persist events into this vault (main.rs does this at start; the hub is global and
    // only this test in this binary reads the log).
    memora_core::events::hub().set_events_path(e.vault.join(".events.jsonl"));
    let sid = signed_in(&mut e).await;
    let (raw, id) = new_key(&mut e, &sid, "http-ui-bot", &["mcp", "read", "admin"]).await;
    let mut rx = memora_core::events::hub().subscribe();
    let key = || Opts {
        key: Some(&raw),
        ..Default::default()
    };

    // initialize registers the alias; tools/call publishes start + end.
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(rpc("initialize", json!({}))),
        key(),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(rpc(
            "tools/call",
            json!({"name": "read_memory", "arguments": {"path": "Plan/Index.md"}}),
        )),
        key(),
    )
    .await;
    assert_eq!(r.body["result"]["isError"], false, "{}", r.body);
    let evs = drain(&mut rx, "http-ui-bot");
    assert_eq!(evs.len(), 2, "{evs:?}");
    assert_eq!(evs[0]["phase"], "start");
    assert_eq!(evs[1]["phase"], "end");
    for v in &evs {
        assert_eq!(v["actor_kind"], "agent");
        assert_eq!(v["actor_id"], id.as_str());
        assert_eq!(v["paths"], json!(["Plan/Index.md"]));
    }
    assert_eq!(evs[0]["call_id"], evs[1]["call_id"]);
    assert_eq!(evs[1]["ok"], true);

    // The browser calling /mcp is the user.
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(rpc(
            "tools/call",
            json!({"name": "get_stats", "arguments": {}}),
        )),
        Opts {
            cookie: Some(&sid),
            same_origin: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let evs = drain(&mut rx, "owner");
    assert_eq!(evs.len(), 2, "{evs:?}");
    assert!(evs.iter().all(|v| v["actor_kind"] == "user"));

    // /api/aliases: the key's name next to the old fields.
    let r = call(&mut e, Method::GET, "/api/aliases", None, key()).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let a = r.body["aliases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["key_id"] == id.as_str())
        .unwrap()
        .clone();
    assert_eq!(a["key_name"], "http-ui-bot");
    assert_eq!(a["alias"], "http-ui-bot");
    assert_eq!(a["actor"], "http-ui-bot");
    assert_eq!(a["actor_kind"], "agent");
    assert_eq!(a["connections"], 1);

    // /api/events: the persisted start event carries the name (end events are realtime only).
    let r = call(
        &mut e,
        Method::GET,
        "/api/events?actor=http-ui-bot&limit=50",
        None,
        key(),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let evs = r.body["events"].as_array().unwrap();
    assert_eq!(evs.len(), 1, "{evs:?}");
    assert_eq!(evs[0]["action"], "read_memory");
    assert_eq!(evs[0]["actor_kind"], "agent");
    assert_eq!(r.body["count"], 1);

    // An activity row from an API-key call (admin tool) shows the key's name, the old
    // `user` field keeps `key:<id>`.
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(rpc(
            "tools/call",
            json!({"name": "admin_set_tool", "arguments": {"name": "diff", "enabled": false}}),
        )),
        key(),
    )
    .await;
    assert_eq!(r.body["result"]["isError"], false, "{}", r.body);
    let r = call(
        &mut e,
        Method::GET,
        "/api/auth/events?limit=50",
        None,
        Opts {
            cookie: Some(&sid),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let rows = r.body["events"].as_array().unwrap();
    let off = rows.iter().find(|r| r["event"] == "tool_disabled").unwrap();
    assert_eq!(off["actor"], "http-ui-bot");
    assert_eq!(off["actor_kind"], "agent");
    assert_eq!(off["actor_id"], id.as_str());
    assert_eq!(off["user"], format!("key:{id}"));
    let made = rows.iter().find(|r| r["event"] == "key_created").unwrap();
    assert_eq!(made["actor"], "owner");
    assert_eq!(made["actor_kind"], "user");
}

#[tokio::test]
async fn ui_layout_get_put() {
    let mut e = env("layout");
    let sid = signed_in(&mut e).await;
    let browser = |same_origin: bool| Opts {
        cookie: Some(&sid),
        same_origin,
        ..Default::default()
    };

    // Never saved.
    let r = call(
        &mut e,
        Method::GET,
        "/api/ui/layout/canvas",
        None,
        browser(false),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(
        r.body,
        json!({"name": "canvas", "data": null, "updated_at": null})
    );

    // Save and read back.
    let doc = json!({"cards": {"Plan/Index.md": {"x": 10, "y": -4.5}}, "frames": []});
    let r = call(
        &mut e,
        Method::PUT,
        "/api/ui/layout/canvas",
        Some(json!({ "data": doc })),
        browser(true),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["ok"], true);
    let at = r.body["updated_at"].as_i64().unwrap();
    assert!(at > 0);
    let r = call(
        &mut e,
        Method::GET,
        "/api/ui/layout/canvas",
        None,
        browser(false),
    )
    .await;
    assert_eq!(
        r.body,
        json!({"name": "canvas", "data": doc, "updated_at": at})
    );
    // Other names are separate.
    let r = call(
        &mut e,
        Method::GET,
        "/api/ui/layout/graph",
        None,
        browser(false),
    )
    .await;
    assert_eq!(r.body["data"], Value::Null);

    // Cross-site write refused.
    let r = call(
        &mut e,
        Method::PUT,
        "/api/ui/layout/canvas",
        Some(json!({"data": 1})),
        browser(false),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    // Bad names: 400 on both verbs.
    for bad in ["Canvas", "a.b", &"a".repeat(41) as &str] {
        let p = format!("/api/ui/layout/{bad}");
        let r = call(&mut e, Method::GET, &p, None, browser(false)).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{bad}");
        let r = call(
            &mut e,
            Method::PUT,
            &p,
            Some(json!({"data": 1})),
            browser(true),
        )
        .await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{bad}");
    }

    // Body shape.
    let r = call(
        &mut e,
        Method::PUT,
        "/api/ui/layout/canvas",
        Some(json!({"x": 1})),
        browser(true),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = call(
        &mut e,
        Method::PUT,
        "/api/ui/layout/canvas",
        Some(json!([1])),
        browser(true),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    // Size: data over 512 KiB is 413 (body under the 600 KiB limit), a body over
    // 600 KiB is refused by the limit, exactly 512 KiB is accepted.
    let max = memora_state::ui_layout::DATA_MAX;
    let big = json!({"data": "x".repeat(max - 1)});
    let r = call(
        &mut e,
        Method::PUT,
        "/api/ui/layout/big",
        Some(big),
        browser(true),
    )
    .await;
    assert_eq!(r.status, StatusCode::PAYLOAD_TOO_LARGE, "{}", r.body);
    let huge = json!({"data": "x".repeat(700 * 1024)});
    let r = call(
        &mut e,
        Method::PUT,
        "/api/ui/layout/big",
        Some(huge),
        browser(true),
    )
    .await;
    assert_eq!(r.status, StatusCode::PAYLOAD_TOO_LARGE);
    let fits = json!({"data": "x".repeat(max - 2)});
    let r = call(
        &mut e,
        Method::PUT,
        "/api/ui/layout/big",
        Some(fits),
        browser(true),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    // The failed writes left the old canvas document alone.
    let r = call(
        &mut e,
        Method::GET,
        "/api/ui/layout/canvas",
        None,
        browser(false),
    )
    .await;
    assert_eq!(r.body["data"], doc);

    // API keys: 403 (even with every scope).
    let (raw, _) = new_key(
        &mut e,
        &sid,
        "layout-bot",
        &["mcp", "read", "write", "admin"],
    )
    .await;
    let key = || Opts {
        key: Some(&raw),
        ..Default::default()
    };
    let r = call(&mut e, Method::GET, "/api/ui/layout/canvas", None, key()).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN, "{}", r.body);
    let r = call(
        &mut e,
        Method::PUT,
        "/api/ui/layout/canvas",
        Some(json!({"data": 1})),
        key(),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN, "{}", r.body);

    // No credentials at all: 401.
    let r = call(
        &mut e,
        Method::GET,
        "/api/ui/layout/canvas",
        None,
        Opts::default(),
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
}

async fn get_page(
    e: &mut Env,
    path: &str,
    cookie: Option<&str>,
) -> (StatusCode, HeaderMap, String) {
    let mut b = Request::builder()
        .method(Method::GET)
        .uri(path)
        .header(header::HOST, HOST);
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, format!("memora_sess={c}"));
    }
    let mut req = b.body(Body::empty()).unwrap();
    let peer: SocketAddr = "127.0.0.1:40000".parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(peer));
    let res = e.app.call(req).await.unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
        .await
        .unwrap();
    (status, headers, String::from_utf8_lossy(&bytes).to_string())
}

#[tokio::test]
async fn deep_links_serve_the_app_shell() {
    let mut e = env("deeplink");
    let sid = signed_in(&mut e).await;
    let pages = [
        "/brain",
        "/nodes",
        "/graph",
        "/canvas",
        "/tags",
        "/activity",
        "/agents",
        "/tools",
        "/access",
        "/settings",
        "/overview",
        "/home",
        "/vault",
        "/logs",
        "/keys",
        "/docs",
        "/docs/agent-instructions",
        "/node/Plan%2FIndex.md",
        "/node/Plan/Index.md",
        "/node/..%2F..%2Fsecret.txt",
        "/node/../../secret.txt",
        "/node/..%2F..%2Fetc%2Fpasswd",
    ];
    for p in pages {
        let (status, headers, body) = get_page(&mut e, p, Some(&sid)).await;
        assert_eq!(status, StatusCode::OK, "{p}");
        assert!(body.contains("<title>SHELL</title>"), "{p}: {body}");
        assert!(
            !body.contains("TOP-SECRET") && !body.contains("root:"),
            "{p}"
        );
        assert!(body.contains("<script nonce=\""), "{p}: nonce");
        assert!(headers[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap()
            .contains("nonce-"));
        assert_eq!(
            headers[header::CACHE_CONTROL],
            "no-cache, no-store, must-revalidate"
        );
    }
    // No session: sign in, then come back (`/login?r=<path>`, percent-encoded).
    for (p, to) in [
        ("/brain", "/login?r=/brain"),
        ("/canvas", "/login?r=/canvas"),
        ("/node/Plan%2FIndex.md", "/login?r=/node/Plan%252FIndex.md"),
        ("/settings", "/login?r=/settings"),
        ("/docs/mcp", "/login?r=/docs/mcp"),
    ] {
        let (status, headers, _) = get_page(&mut e, p, None).await;
        assert_eq!(status, StatusCode::FOUND, "{p}");
        assert_eq!(headers[header::LOCATION], to, "{p}");
    }
    // `/tools` without a session stays the public tool catalog.
    let (status, _, body) = get_page(&mut e, "/tools", None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.contains("Tool Catalog"));
    // Control characters: 400.
    for p in ["/node/%00", "/node/a%0Ab", "/node/x%1F", "/node/%7F"] {
        let (status, _, body) = get_page(&mut e, p, Some(&sid)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{p}");
        assert!(!body.contains("SHELL"));
    }
    // Neighbouring paths are not app routes.
    for p in ["/brainx", "/graph/extra", "/nodes/x"] {
        let (status, _, body) = get_page(&mut e, p, Some(&sid)).await;
        assert_ne!(status, StatusCode::OK, "{p}");
        assert!(!body.contains("SHELL"), "{p}");
    }
}

#[tokio::test]
async fn realtime_socket_is_for_the_owner_browser_only() {
    let mut e = env("ws");
    let sid = signed_in(&mut e).await;
    let (key, _) = new_key(
        &mut e,
        &sid,
        "all-scopes",
        &["read", "write", "mcp", "admin"],
    )
    .await;
    // An API key, whatever its scopes and headers, never reaches the event stream
    // (it carries note paths that per-agent privacy would hide from that key).
    for same_origin in [false, true] {
        let r = call(
            &mut e,
            Method::GET,
            "/ws",
            None,
            Opts {
                key: Some(&key),
                same_origin,
                ..Default::default()
            },
        )
        .await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{}", r.body);
    }
    // A session from a foreign origin is refused (cross-site WebSocket hijacking).
    let r = call(
        &mut e,
        Method::GET,
        "/ws",
        None,
        Opts {
            cookie: Some(&sid),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    // The owner's same-origin session passes the gate (no upgrade headers here,
    // so the WebSocket extractor answers, not the auth gate).
    let r = call(
        &mut e,
        Method::GET,
        "/ws",
        None,
        Opts {
            cookie: Some(&sid),
            same_origin: true,
            ..Default::default()
        },
    )
    .await;
    assert!(
        r.status != StatusCode::UNAUTHORIZED && r.status != StatusCode::FORBIDDEN,
        "{}",
        r.status
    );
}

#[tokio::test]
async fn folder_meta_accepts_only_hex_colors() {
    let mut e = env("fmeta");
    let sid = signed_in(&mut e).await;
    let o = || Opts {
        cookie: Some(&sid),
        same_origin: true,
        ..Default::default()
    };
    for bad in ["red;background:url(x)", "#12345g", "\"><b>", "#1234"] {
        let body = json!({"folder": "Plan", "color": bad});
        let r = call(&mut e, Method::POST, "/api/folder-meta", Some(body), o()).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{bad}: {}", r.body);
    }
    let long_icon = "x".repeat(41);
    let body = json!({"folder": "Plan", "icon": long_icon});
    let r = call(&mut e, Method::POST, "/api/folder-meta", Some(body), o()).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    let body = json!({"folder": "Plan", "color": "#3B82F6"});
    let r = call(&mut e, Method::POST, "/api/folder-meta", Some(body), o()).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let body = json!({"folder": "Plan", "color": ""});
    let r = call(&mut e, Method::POST, "/api/folder-meta", Some(body), o()).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
}

/// S256 PKCE challenge of `verifier`.
fn pkce_challenge(verifier: &str) -> String {
    let hex = memora_gateway::hash_api_key(verifier);
    let bytes: Vec<u8> = (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect();
    memora_gateway::base64url(&bytes)
}

#[tokio::test]
async fn oauth_token_checks_run_before_the_code_is_used_up() {
    use memora_state::oauth as store;
    let mut e = env("oauth");
    let _sid = signed_in(&mut e).await;
    let verifier = "v".repeat(50);
    let now = memora_state::now();
    let cb = "https://client.example/cb";
    e.st.db
        .write(|tx| {
            for id in ["client-a", "client-b"] {
                store::put_client(
                    tx,
                    &store::Client {
                        client_id: id.into(),
                        name: id.into(),
                        redirect_uris: vec![cb.into()],
                        kind: "manual".into(),
                        created_at: now,
                        fetched_at: None,
                    },
                )?;
            }
            store::put_code(
                tx,
                &store::Code {
                    code_hash: memora_gateway::hash_api_key("the-code"),
                    client_id: "client-a".into(),
                    redirect_uri: cb.into(),
                    challenge: pkce_challenge(&verifier),
                    resource: None,
                    user: "owner".into(),
                    expires_at: now + 600,
                },
            )
        })
        .unwrap();
    let token = |client: &str, v: &str| {
        json!({"grant_type": "authorization_code", "code": "the-code",
               "client_id": client, "code_verifier": v, "redirect_uri": cb})
    };
    // Wrong client, wrong verifier: refused, and the code still works afterwards.
    for body in [
        token("client-b", &verifier),
        token("client-a", &"w".repeat(50)),
    ] {
        let r = call(
            &mut e,
            Method::POST,
            "/oauth/token",
            Some(body),
            Opts::default(),
        )
        .await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
        assert_eq!(r.body["error"], "invalid_grant");
    }
    let r = call(
        &mut e,
        Method::POST,
        "/oauth/token",
        Some(token("client-a", &verifier)),
        Opts::default(),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let refresh = r.body["refresh_token"].as_str().unwrap().to_string();
    // Used once: gone.
    let r = call(
        &mut e,
        Method::POST,
        "/oauth/token",
        Some(token("client-a", &verifier)),
        Opts::default(),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    // A refresh token presented by another client stays valid for its own.
    let rt = |client: &str| json!({"grant_type": "refresh_token", "refresh_token": refresh, "client_id": client});
    let r = call(
        &mut e,
        Method::POST,
        "/oauth/token",
        Some(rt("client-b")),
        Opts::default(),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    let r = call(
        &mut e,
        Method::POST,
        "/oauth/token",
        Some(rt("client-a")),
        Opts::default(),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
}

#[tokio::test]
async fn access_rules_and_key_scopes_refuse_ambiguous_input() {
    let mut e = env("rules");
    let sid = signed_in(&mut e).await;
    let o = || Opts {
        cookie: Some(&sid),
        same_origin: true,
        ..Default::default()
    };
    let add = json!({"op": "add", "kind": "ip", "value": "203.0.113.9", "action": "block"});
    let r = call(&mut e, Method::POST, "/api/access/rules", Some(add), o()).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let typo = json!({"op": "add", "kind": "ip", "value": "203.0.113.10", "action": "alow"});
    let r = call(&mut e, Method::POST, "/api/access/rules", Some(typo), o()).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    // A remove without kind and value would match every rule.
    let all = json!({"op": "remove"});
    let r = call(&mut e, Method::POST, "/api/access/rules", Some(all), o()).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    assert_eq!(cache::rd(&e.st.cache.access).rules.len(), 1);

    let (_, id) = new_key(&mut e, &sid, "agent", &["read", "mcp"]).await;
    let empty = json!({"id": id, "scopes": []});
    let r = call(&mut e, Method::POST, "/api/keys/update", Some(empty), o()).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
}

/// A service worker obeys its own script's CSP: it must be allowed to fetch
/// same-origin pages, or every navigation falls back to the offline page.
#[tokio::test]
async fn service_worker_may_fetch_same_origin() {
    let mut e = env("swcsp");
    let (status, headers, _) = get_page(&mut e, "/sw.js", None).await;
    assert_eq!(status, StatusCode::OK);
    let csp = headers[header::CONTENT_SECURITY_POLICY].to_str().unwrap();
    assert!(csp.contains("connect-src 'self'"), "{csp}");
    assert!(csp.contains("default-src 'none'"), "{csp}");
}
