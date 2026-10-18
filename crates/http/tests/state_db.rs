//! The server on the SQLite state database (docs/DATABASE.md), driven through the
//! router: setup window with a one-try code, single owner, sessions stored as sha256,
//! CSRF on cookie writes, API keys with scopes, MCP filtering, CLI sign-out and limiter
//! reset through the database, and nothing but `memora.db*` in the state folder.

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
    }
}

fn env(tag: &str) -> Env {
    let db = Db::open_temp().unwrap();
    memora_mcp::sync_catalog(&db).unwrap();
    let vault = std::env::temp_dir().join(format!("memora-http-db-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&vault);
    std::fs::create_dir_all(vault.join("Plan")).unwrap();
    std::fs::write(vault.join("Plan/Index.md"), "# Index\n").unwrap();
    db.write(|tx| {
        memora_state::settings::set_vault(tx, Some(vault.to_str().unwrap()), memora_state::now())
    })
    .unwrap();
    let store = Arc::new(Mutex::new(MemoryStore::new(&vault)));
    let st = AppState::new(
        db,
        store,
        "/nonexistent-assets".into(),
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

#[tokio::test]
async fn setup_login_keys_mcp_and_cli_signout() {
    let mut e = env("flow");
    let other = cli(&e);

    // Fresh install: no owner, no window.
    let r = call(
        &mut e,
        Method::GET,
        "/api/auth/state",
        None,
        Opts::default(),
    )
    .await;
    assert_eq!(r.body["bootstrap"], true);
    assert_eq!(r.body["armed"], false);

    // The CLI opens a window; the server sees it on the next request.
    arm(&other, ArmMode::Bootstrap, "ABCD-EFGH");
    let r = call(
        &mut e,
        Method::GET,
        "/api/auth/state",
        None,
        Opts::default(),
    )
    .await;
    assert_eq!(r.body["armed"], true);
    assert_eq!(r.body["mode"], "bootstrap");

    // A wrong code burns the window: the right code no longer works.
    let r = bootstrap(&mut e, "WRON-GCOD").await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(r.body["burned"], true);
    let r = bootstrap(&mut e, "ABCD-EFGH").await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    let w = e.st.db.read(memora_state::arm::get).unwrap();
    assert!(w.last_burn.is_some());

    // New window, right code (separators and case do not matter).
    arm(&other, ArmMode::Bootstrap, "JKMN-PQRS");
    let r = bootstrap(&mut e, "jkmn pqrs").await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["user"], "owner");
    let sid = r.cookie();
    // Only the sha256 of the session id is stored.
    let sessions = e.st.db.read(memora_state::session::list).unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].sid_hash, memora_gateway::hash_api_key(&sid));
    assert_ne!(sessions[0].sid_hash, sid);

    // Single owner: a second setup is refused even with a fresh window.
    arm(&other, ArmMode::Bootstrap, "TUVW-XYZ2");
    let r = bootstrap(&mut e, "TUVW-XYZ2").await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    other.write(memora_state::arm::disarm).unwrap();

    let me = Opts {
        cookie: Some(&sid),
        ..Default::default()
    };
    let r = call(&mut e, Method::GET, "/api/auth/me", None, me).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["user"], "owner");

    // Cookie writes need a same-origin header (CSRF).
    let body = json!({"name": "agent", "scopes": ["mcp", "read"]});
    let r = call(
        &mut e,
        Method::POST,
        "/api/keys",
        Some(body.clone()),
        Opts {
            cookie: Some(&sid),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    let r = call(
        &mut e,
        Method::POST,
        "/api/keys",
        Some(body),
        Opts {
            cookie: Some(&sid),
            same_origin: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["scopes"], json!(["mcp", "read"]));
    let raw = r.body["key"].as_str().unwrap().to_string();
    let id = r.body["id"].as_str().unwrap().to_string();
    let stored =
        e.st.db
            .read(|c| memora_state::keys::get(c, &id))
            .unwrap()
            .unwrap();
    assert_eq!(stored.hash, memora_gateway::hash_api_key(&raw));

    // Scopes: no admin -> key management refused; mcp -> tools/list works.
    let k = || Opts {
        key: Some(&raw),
        ..Default::default()
    };
    let r = call(
        &mut e,
        Method::GET,
        "/api/keys",
        None,
        Opts {
            key: Some(&raw),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    let list = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"});
    let r = call(&mut e, Method::POST, "/mcp", Some(list.clone()), k()).await;
    assert_eq!(r.status, StatusCode::OK);
    let n = r.body["result"]["tools"].as_array().unwrap().len();
    // An `mcp` + `read` key sees only the read-only tools (write tools need `write`).
    let read_only = memora_mcp::catalog()
        .iter()
        .filter(|t| memora_mcp::required_scope(t.name).is_none())
        .count();
    assert_eq!(n, read_only);
    assert!(n < memora_mcp::catalog().len());

    // A tool switched off by the CLI disappears on the next request.
    other
        .write(|tx| memora_state::tools::set_enabled(tx, "get_stats", false, memora_state::now()))
        .unwrap();
    let r = call(&mut e, Method::POST, "/mcp", Some(list), k()).await;
    assert_eq!(r.body["result"]["tools"].as_array().unwrap().len(), n - 1);

    // Usage is buffered and written by the flusher.
    cache::flush_all(&e.st);
    let u =
        e.st.db
            .read(|c| memora_state::usage::usage(c, &id))
            .unwrap()
            .unwrap();
    assert_eq!(u.use_count, 3);

    // A bad key is refused and logged.
    let r = call(
        &mut e,
        Method::POST,
        "/mcp",
        Some(json!({})),
        Opts {
            key: Some("memora_live_nope"),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);

    // CLI sign-out: rows deleted by another process end the session at once.
    other.write(memora_state::session::revoke_all).unwrap();
    let r = call(
        &mut e,
        Method::GET,
        "/api/auth/me",
        None,
        Opts {
            cookie: Some(&sid),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);

    // Sign in again; the key list (session) shows usage.
    let login = json!({"username": "OWNER", "password": PASSWORD});
    let r = call(
        &mut e,
        Method::POST,
        "/api/auth/login",
        Some(login),
        Opts::default(),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let sid = r.cookie();
    let r = call(
        &mut e,
        Method::GET,
        "/api/keys",
        None,
        Opts {
            cookie: Some(&sid),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.body["count"], 1);
    assert_eq!(r.body["keys"][0]["uses"], 3);

    // Trash and restore.
    let o = || Opts {
        cookie: Some(&sid),
        same_origin: true,
        ..Default::default()
    };
    let r = call(
        &mut e,
        Method::POST,
        "/api/keys/delete",
        Some(json!({"id": id})),
        o(),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    let r = call(&mut e, Method::POST, "/mcp", Some(json!({})), k()).await;
    assert_eq!(
        r.status,
        StatusCode::UNAUTHORIZED,
        "trashed key no longer works"
    );
    let r = call(
        &mut e,
        Method::POST,
        "/api/keys/restore",
        Some(json!({"id": id})),
        o(),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    let r = call(
        &mut e,
        Method::POST,
        "/api/keys/restore",
        Some(json!({"id": id})),
        o(),
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);

    // Activity went to the database.
    let r = call(
        &mut e,
        Method::GET,
        "/api/auth/events?limit=500",
        None,
        Opts {
            cookie: Some(&sid),
            ..Default::default()
        },
    )
    .await;
    let events: Vec<String> = r.body["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["event"].as_str().unwrap().to_string())
        .collect();
    for ev in [
        "code_burned",
        "setup_done",
        "key_created",
        "key_fail",
        "login_ok",
        "key_deleted",
        "key_restored",
    ] {
        assert!(events.iter().any(|x| x == ev), "{ev} missing in {events:?}");
    }

    // The server wrote nothing but the database (and the key-sealing master key)
    // into the state folder.
    cache::flush_all(&e.st);
    let mut files: Vec<String> = std::fs::read_dir(e.st.db.state_dir())
        .unwrap()
        .map(|d| d.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    files.sort();
    assert!(
        files
            .iter()
            .all(|f| f.starts_with("memora.db") || f == "key-seal.bin"),
        "unexpected files in the state dir: {files:?}"
    );
}

#[tokio::test]
async fn password_change_reset_and_limiter_reset() {
    let mut e = env("pw");
    let other = cli(&e);
    arm(&other, ArmMode::Bootstrap, "ABCD-EFGH");
    let r = bootstrap(&mut e, "ABCD-EFGH").await;
    assert_eq!(r.status, StatusCode::OK);
    let a = r.cookie();
    let login = json!({"username": "owner", "password": PASSWORD});
    let r = call(
        &mut e,
        Method::POST,
        "/api/auth/login",
        Some(login.clone()),
        Opts::default(),
    )
    .await;
    let b = r.cookie();

    // Password change keeps this device and signs out the other. Passwords are
    // never trimmed, so a trailing space is part of the new one.
    let body = json!({"current": PASSWORD, "password": "another long password ", "confirm": "another long password "});
    let r = call(
        &mut e,
        Method::POST,
        "/api/settings/password",
        Some(body),
        Opts {
            cookie: Some(&a),
            same_origin: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["revoked_sessions"], 1);
    let r = call(
        &mut e,
        Method::GET,
        "/api/auth/me",
        None,
        Opts {
            cookie: Some(&a),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    let r = call(
        &mut e,
        Method::GET,
        "/api/auth/me",
        None,
        Opts {
            cookie: Some(&b),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    let r = call(
        &mut e,
        Method::POST,
        "/api/auth/login",
        Some(json!({"username": "owner", "password": "another long password "})),
        Opts::default(),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);

    // Five wrong passwords from one outside IP start a cooldown.
    let ext = || Opts {
        peer: Some("203.0.113.7"),
        ..Default::default()
    };
    let wrong = json!({"username": "owner", "password": "nope nope nope"});
    let mut last = StatusCode::OK;
    for _ in 0..5 {
        last = call(
            &mut e,
            Method::POST,
            "/api/auth/login",
            Some(wrong.clone()),
            ext(),
        )
        .await
        .status;
    }
    assert_eq!(last, StatusCode::TOO_MANY_REQUESTS);
    let r = call(
        &mut e,
        Method::POST,
        "/api/auth/login",
        Some(wrong.clone()),
        ext(),
    )
    .await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);

    // memora-cli limiter reset: a control request the server acknowledges.
    let id = other
        .write(|tx| {
            memora_state::control::request(
                tx,
                memora_state::control::ControlKind::LimiterReset,
                "cli:test",
                memora_state::now(),
            )
        })
        .unwrap();
    cache::serve_control(&e.st);
    let req = other
        .read(|c| memora_state::control::get(c, id))
        .unwrap()
        .unwrap();
    assert_eq!(req.result.as_deref(), Some("cleared"));
    let r = call(&mut e, Method::POST, "/api/auth/login", Some(wrong), ext()).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED, "cooldown cleared");

    // Reset in the browser: renames, signs out every device, closes the window.
    arm(&other, ArmMode::Reset, "QRST-UVWX");
    let body = json!({"code": "QRST-UVWX", "username": "boss", "password": "third long password"});
    let r = call(
        &mut e,
        Method::POST,
        "/api/auth/reset",
        Some(body.clone()),
        Opts::default(),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let r = call(
        &mut e,
        Method::GET,
        "/api/auth/me",
        None,
        Opts {
            cookie: Some(&a),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    // The code was used up with the reset.
    let r = call(
        &mut e,
        Method::POST,
        "/api/auth/reset",
        Some(body),
        Opts::default(),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    let login = json!({"username": "boss", "password": "third long password"});
    let r = call(
        &mut e,
        Method::POST,
        "/api/auth/login",
        Some(login),
        Opts::default(),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["user"], "boss");
}

#[tokio::test]
async fn expired_window_locks_the_instance() {
    let mut e = env("lock");
    let other = cli(&e);
    let hash = cache::code_hash("ABCD-EFGH");
    // Armed long ago with the minimum ttl: expired.
    other
        .write(|tx| {
            memora_state::arm::arm(tx, ArmMode::Bootstrap, 30, &hash, memora_state::now() - 100)
        })
        .unwrap();
    let r = call(
        &mut e,
        Method::GET,
        "/api/auth/state",
        None,
        Opts::default(),
    )
    .await;
    assert_eq!(r.body["locked"], true);
    assert_eq!(r.body["armed"], false);
    let r = call(&mut e, Method::GET, "/api/stats", None, Opts::default()).await;
    assert_eq!(r.status, StatusCode::LOCKED);
    // Machine endpoints answer JSON, never a redirect to the lock screen.
    for (m, path) in [
        (Method::POST, "/oauth/token"),
        (Method::GET, "/.well-known/oauth-authorization-server"),
    ] {
        let r = call(&mut e, m, path, Some(json!({})), Opts::default()).await;
        assert_eq!(r.status, StatusCode::LOCKED, "{path}");
        assert_eq!(r.body["locked"], true, "{path}");
    }
    let w = other.read(memora_state::arm::get).unwrap();
    assert_eq!(
        w.status,
        memora_state::arm::ArmStatus::Locked,
        "the lock is stored"
    );
    other.write(memora_state::arm::unlock).unwrap();
    let r = call(
        &mut e,
        Method::GET,
        "/api/auth/state",
        None,
        Opts::default(),
    )
    .await;
    assert_eq!(r.body["locked"], false);
}
