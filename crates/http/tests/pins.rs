//! `/api/pins` through the router: browser session only (API keys 403, cross-site
//! writes 403), path and size checks, and pins that follow renames, folder moves and
//! deletes made over HTTP and over MCP, with missing paths reported.

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
    let vault = std::env::temp_dir().join(format!("memora-http-pins-{tag}-{}", std::process::id()));
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

fn browser(sid: &str) -> Opts<'_> {
    Opts {
        cookie: Some(sid),
        same_origin: true,
        ..Default::default()
    }
}

fn listed(v: &Value) -> Vec<String> {
    v["pins"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            format!(
                "{}:{}{}",
                p["kind"].as_str().unwrap(),
                p["path"].as_str().unwrap(),
                if p["missing"] == true {
                    " (missing)"
                } else {
                    ""
                }
            )
        })
        .collect()
}

async fn pins(e: &mut Env, sid: &str) -> Vec<String> {
    let r = call(e, Method::GET, "/api/pins", None, browser(sid)).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    listed(&r.body)
}

async fn pin(e: &mut Env, sid: &str, kind: &str, path: &str) -> Resp {
    call(
        e,
        Method::POST,
        "/api/pins/pin",
        Some(json!({"kind": kind, "path": path})),
        browser(sid),
    )
    .await
}

#[tokio::test]
async fn pins_are_for_the_owner_browser_only() {
    let mut e = env("auth");
    let sid = signed_in(&mut e).await;
    let (k, _) = new_key(&mut e, &sid, "agent", &["read", "write", "mcp", "admin"]).await;

    // No session: 401 on every verb.
    for (m, p) in [
        (Method::GET, "/api/pins"),
        (Method::PUT, "/api/pins"),
        (Method::POST, "/api/pins/pin"),
        (Method::POST, "/api/pins/unpin"),
    ] {
        let r = call(
            &mut e,
            m.clone(),
            p,
            Some(json!({"pins": []})),
            Opts::default(),
        )
        .await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{m} {p}: {}", r.body);
        // An API key, even an admin one, is refused.
        let r = call(
            &mut e,
            m.clone(),
            p,
            Some(json!({"pins": [], "kind": "note", "path": "Plan/Index.md"})),
            Opts {
                key: Some(&k),
                ..Default::default()
            },
        )
        .await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{m} {p}: {}", r.body);
    }

    // Cross-site writes are refused and change nothing.
    for (m, p, body) in [
        (
            Method::PUT,
            "/api/pins",
            json!({"pins": [{"kind": "note", "path": "Plan/Index.md"}]}),
        ),
        (
            Method::POST,
            "/api/pins/pin",
            json!({"kind": "note", "path": "Plan/Index.md"}),
        ),
    ] {
        let r = call(
            &mut e,
            m,
            p,
            Some(body),
            Opts {
                cookie: Some(&sid),
                ..Default::default()
            },
        )
        .await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{p}: {}", r.body);
    }
    assert!(pins(&mut e, &sid).await.is_empty());
}

#[tokio::test]
async fn pin_paths_and_sizes_are_checked() {
    let mut e = env("check");
    let sid = signed_in(&mut e).await;
    let long = format!("{}.md", "a".repeat(1100));
    for (kind, path) in [
        ("note", "../secret.txt"),
        ("note", "../../etc/passwd.md"),
        ("note", "/etc/passwd.md"),
        ("note", "Plan/../x.md"),
        ("note", "a\u{0}b.md"),
        ("note", ".git/config.md"),
        ("note", "Plan\\Index.md"),
        ("note", "secret.txt"),
        ("note", long.as_str()),
        ("folder", "Plan/"),
        ("file", "Plan/Index.md"),
    ] {
        let r = pin(&mut e, &sid, kind, path).await;
        assert_eq!(
            r.status,
            StatusCode::BAD_REQUEST,
            "{kind} {path:?}: {}",
            r.body
        );
        let r = call(
            &mut e,
            Method::PUT,
            "/api/pins",
            Some(json!({"pins": [{"kind": kind, "path": path}]})),
            browser(&sid),
        )
        .await;
        assert_eq!(
            r.status,
            StatusCode::BAD_REQUEST,
            "{kind} {path:?}: {}",
            r.body
        );
    }
    // A valid path that does not exist cannot be pinned (but may be kept by PUT).
    let r = pin(&mut e, &sid, "note", "Plan/Nope.md").await;
    assert_eq!(r.status, StatusCode::NOT_FOUND, "{}", r.body);
    let r = pin(&mut e, &sid, "folder", "Plan/Index.md").await;
    assert_eq!(r.status, StatusCode::NOT_FOUND, "a note is not a folder");
    // Malformed bodies.
    for body in [
        json!([]),
        json!({"pins": "x"}),
        json!({"pins": [{"path": "a.md"}]}),
    ] {
        let r = call(&mut e, Method::PUT, "/api/pins", Some(body), browser(&sid)).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    }
    let r = call(
        &mut e,
        Method::POST,
        "/api/pins/pin",
        Some(json!({"kind": "note", "path": "Plan/Index.md", "position": -1})),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    // At most 200 pins.
    let many: Vec<Value> = (0..201)
        .map(|i| json!({"kind": "note", "path": format!("n{i}.md")}))
        .collect();
    let r = call(
        &mut e,
        Method::PUT,
        "/api/pins",
        Some(json!({ "pins": many })),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    // Oversized bodies are cut off before parsing.
    let huge = json!({"pins": [], "pad": "x".repeat(300 * 1024)});
    let r = call(&mut e, Method::PUT, "/api/pins", Some(huge), browser(&sid)).await;
    assert_eq!(r.status, StatusCode::PAYLOAD_TOO_LARGE);
    let r = call(
        &mut e,
        Method::POST,
        "/api/pins/pin",
        Some(json!({"kind": "note", "path": "Plan/Index.md", "pad": "x".repeat(16 * 1024)})),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(pins(&mut e, &sid).await.is_empty());
}

#[tokio::test]
async fn pins_follow_http_and_mcp_changes() {
    let mut e = env("follow");
    let sid = signed_in(&mut e).await;
    std::fs::create_dir_all(e.vault.join("Plan/Sub")).unwrap();
    std::fs::write(e.vault.join("Plan/Sub/deep.md"), "# Deep\n").unwrap();
    std::fs::write(e.vault.join("top.md"), "# Top\n").unwrap();
    let mut rx = memora_core::events::hub().subscribe();

    assert_eq!(
        pin(&mut e, &sid, "note", "Plan/Index.md").await.status,
        StatusCode::OK
    );
    assert_eq!(
        pin(&mut e, &sid, "note", "Plan/Sub/deep.md").await.status,
        StatusCode::OK
    );
    assert_eq!(
        pin(&mut e, &sid, "folder", "Plan/Sub").await.status,
        StatusCode::OK
    );
    let r = call(
        &mut e,
        Method::POST,
        "/api/pins/pin",
        Some(json!({"kind": "note", "path": "top.md", "position": 0})),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(
        listed(&r.body),
        [
            "note:top.md",
            "note:Plan/Index.md",
            "note:Plan/Sub/deep.md",
            "folder:Plan/Sub"
        ]
    );
    // Browsers hear about it; the event carries nothing else.
    let mut seen = Vec::new();
    while let Ok(line) = rx.try_recv() {
        let v: Value = serde_json::from_str(&line).unwrap();
        if v["type"] == "pins_changed" {
            seen.push(v);
        }
    }
    assert!(!seen.is_empty());
    for v in &seen {
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert!(
            keys.iter().all(|k| *k == "type" || k.starts_with('_')),
            "{v}"
        );
    }

    // A note rename over HTTP.
    let r = call(
        &mut e,
        Method::POST,
        "/api/rename",
        Some(json!({"path": "Plan/Index.md", "name": "Start"})),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    // A folder move over HTTP: the pinned notes and sub folder inside follow.
    std::fs::create_dir_all(e.vault.join("Archive")).unwrap();
    let r = call(
        &mut e,
        Method::POST,
        "/api/folder/move",
        Some(json!({"folder": "Plan", "into": "Archive"})),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(
        pins(&mut e, &sid).await,
        [
            "note:top.md",
            "note:Archive/Plan/Start.md",
            "note:Archive/Plan/Sub/deep.md",
            "folder:Archive/Plan/Sub"
        ]
    );

    // An agent renames and moves over MCP: the pins follow too.
    let (k, _) = new_key(&mut e, &sid, "agent", &["read", "write", "mcp"]).await;
    let agent = || Opts {
        key: Some(&k),
        ..Default::default()
    };
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(rpc(
            "tools/call",
            json!({"name": "rename_folder", "arguments": {"folder": "Archive/Plan", "name": "Done"}}),
        )),
        agent(),
    )
    .await;
    assert_eq!(r.body["result"]["isError"], false, "{}", r.body);
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(rpc(
            "tools/call",
            json!({"name": "move_memory", "arguments": {"path": "top.md", "folder": "Archive"}}),
        )),
        agent(),
    )
    .await;
    assert_eq!(r.body["result"]["isError"], false, "{}", r.body);
    assert_eq!(
        pins(&mut e, &sid).await,
        [
            "note:Archive/top.md",
            "note:Archive/Done/Start.md",
            "note:Archive/Done/Sub/deep.md",
            "folder:Archive/Done/Sub"
        ]
    );

    // Deletes drop pins: a note, then a folder with a pinned note inside.
    let r = call(
        &mut e,
        Method::POST,
        "/api/delete",
        Some(json!({"path": "Archive/Done/Start.md"})),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    std::fs::remove_file(e.vault.join("Archive/Done/Sub/deep.md")).unwrap();
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(rpc(
            "tools/call",
            json!({"name": "delete_folder", "arguments": {"folder": "Archive/Done/Sub"}}),
        )),
        agent(),
    )
    .await;
    assert_eq!(r.body["result"]["isError"], false, "{}", r.body);
    // Every pin under the deleted folder goes, even one whose note was already gone.
    assert_eq!(pins(&mut e, &sid).await, ["note:Archive/top.md"]);

    // Renamed outside Memora: missing, never dropped silently; removable with PUT.
    std::fs::rename(
        e.vault.join("Archive/top.md"),
        e.vault.join("Archive/moved.md"),
    )
    .unwrap();
    assert_eq!(pins(&mut e, &sid).await, ["note:Archive/top.md (missing)"]);
    let r = call(
        &mut e,
        Method::PUT,
        "/api/pins",
        Some(json!({"pins": [
            {"kind": "note", "path": "Archive/top.md"},
            {"kind": "note", "path": "Archive/moved.md"},
        ]})),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(
        listed(&r.body),
        ["note:Archive/top.md (missing)", "note:Archive/moved.md"]
    );
    let r = call(
        &mut e,
        Method::POST,
        "/api/pins/unpin",
        Some(json!({"kind": "note", "path": "Archive/top.md"})),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["removed"], true);
    assert_eq!(pins(&mut e, &sid).await, ["note:Archive/moved.md"]);
}
