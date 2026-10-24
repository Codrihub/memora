//! The Trash over HTTP and MCP: who deleted, list, restore beside a taken name, and
//! deleting for good (admin keys only).

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
    let vault =
        std::env::temp_dir().join(format!("memora-http-trash-{tag}-{}", std::process::id()));
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

fn mcp_call(name: &str, args: Value) -> Value {
    rpc("tools/call", json!({"name": name, "arguments": args}))
}

async fn trash(e: &mut Env, sid: &str) -> Vec<Value> {
    let r = call(e, Method::GET, "/api/trash", None, browser(sid)).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    r.body["items"].as_array().unwrap().clone()
}

#[tokio::test]
async fn web_trash_lists_restores_and_deletes_for_good() {
    let mut e = env("web");
    std::fs::write(
        e.vault.join("Plan/Launch_plan.md"),
        "---\ntitle: Launch plan\n---\nx",
    )
    .unwrap();
    std::fs::write(e.vault.join("Plan/Other.md"), "o").unwrap();
    let sid = signed_in(&mut e).await;

    let r = call(
        &mut e,
        Method::POST,
        "/api/delete",
        Some(json!({"path": "Plan/Launch_plan.md", "mode": "trash"})),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["to"], ".Trash/Launch_plan.md");
    assert!(!e.vault.join("Plan/Launch_plan.md").exists());
    let bad = call(
        &mut e,
        Method::POST,
        "/api/delete",
        Some(json!({"path": "Plan/Other.md", "mode": "shred"})),
        browser(&sid),
    )
    .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);

    let items = trash(&mut e, &sid).await;
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["name"], "Launch_plan.md");
    assert_eq!(items[0]["original"], "Plan/Launch_plan.md");
    assert_eq!(items[0]["title"], "Launch plan");
    // Usernames are stored lowercased.
    assert_eq!(items[0]["by"]["name"], "owner");
    assert_eq!(items[0]["by"]["kind"], "user");

    // Restore while the old name is taken: the note comes back beside it.
    std::fs::write(e.vault.join("Plan/Launch_plan.md"), "new").unwrap();
    let r = call(
        &mut e,
        Method::POST,
        "/api/trash/restore",
        Some(json!({"name": "Launch_plan.md"})),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["path"], "Plan/Launch_plan-1.md");
    assert_eq!(r.body["renamed"], true);
    let gone = call(
        &mut e,
        Method::POST,
        "/api/trash/restore",
        Some(json!({"name": "Launch_plan.md"})),
        browser(&sid),
    )
    .await;
    assert_eq!(gone.status, StatusCode::NOT_FOUND, "{}", gone.body);

    // Delete one for good, then empty the rest.
    for p in ["Plan/Other.md", "Plan/Index.md"] {
        let r = call(
            &mut e,
            Method::POST,
            "/api/delete",
            Some(json!({"path": p, "mode": "trash"})),
            browser(&sid),
        )
        .await;
        assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    }
    let r = call(
        &mut e,
        Method::POST,
        "/api/trash/delete",
        Some(json!({"name": "Other"})),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["name"], "Other.md");
    assert!(!e.vault.join(".Trash/Other.md").exists());
    let r = call(
        &mut e,
        Method::POST,
        "/api/trash/empty",
        Some(json!({})),
        browser(&sid),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["count"], 1);
    assert!(trash(&mut e, &sid).await.is_empty());

    // Cross-site writes are refused.
    let r = call(
        &mut e,
        Method::POST,
        "/api/trash/empty",
        Some(json!({})),
        Opts {
            cookie: Some(&sid),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN, "{}", r.body);
}

#[tokio::test]
async fn keys_need_admin_to_delete_for_good_and_mcp_delete_goes_to_the_trash() {
    let mut e = env("keys");
    std::fs::write(e.vault.join("Plan/a.md"), "a").unwrap();
    std::fs::write(e.vault.join("Plan/b.md"), "b").unwrap();
    let sid = signed_in(&mut e).await;
    let (writer, _) = new_key(&mut e, &sid, "Writer", &["read", "write", "mcp"]).await;
    let (admin, _) = new_key(&mut e, &sid, "Boss", &["read", "write", "mcp", "admin"]).await;
    fn key(k: &str) -> Opts<'_> {
        Opts {
            key: Some(k),
            ..Default::default()
        }
    }
    let w = writer.clone();

    // delete_memory: to the trash, recorded as the key.
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(mcp_call("delete_memory", json!({"path": "Plan/a.md"}))),
        key(&w),
    )
    .await;
    assert_eq!(r.body["result"]["isError"], false, "{}", r.body);
    assert!(e.vault.join(".Trash/a.md").is_file());
    let items = trash(&mut e, &sid).await;
    assert_eq!(items[0]["by"]["name"], "Writer");
    assert_eq!(items[0]["by"]["kind"], "agent");

    // `permanent` is for admin keys only.
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(mcp_call(
            "delete_memory",
            json!({"path": "Plan/b.md", "permanent": true}),
        )),
        key(&w),
    )
    .await;
    assert_eq!(r.body["result"]["isError"], true, "{}", r.body);
    assert!(e.vault.join("Plan/b.md").is_file());
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(mcp_call(
            "delete_memory",
            json!({"path": "Plan/b.md", "permanent": true}),
        )),
        key(&admin),
    )
    .await;
    assert_eq!(r.body["result"]["isError"], false, "{}", r.body);
    assert!(!e.vault.join("Plan/b.md").exists());
    assert!(!e.vault.join(".Trash/b.md").exists());

    // REST: a write key lists and restores, but cannot delete for good.
    let r = call(&mut e, Method::GET, "/api/trash", None, key(&w)).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    for path in ["/api/trash/delete", "/api/trash/empty"] {
        let r = call(
            &mut e,
            Method::POST,
            path,
            Some(json!({"name": "a.md"})),
            key(&w),
        )
        .await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{path}: {}", r.body);
    }
    let r = call(
        &mut e,
        Method::POST,
        "/api/trash/restore",
        Some(json!({"name": "a"})),
        key(&w),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert!(e.vault.join("Plan/a.md").is_file());
}
