//! The server on the SQLite state database, through the router: setup window, owner,
//! sessions, CSRF, key scopes, CLI sign-out and limiter reset, state folder contents.

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

async fn bootstrap_from(e: &mut Env, code: &str, peer: Option<&str>) -> Resp {
    let body = json!({"code": code, "username": "Owner", "password": PASSWORD});
    call(
        e,
        Method::POST,
        "/api/auth/bootstrap",
        Some(body),
        Opts {
            peer,
            ..Default::default()
        },
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

    // A wrong code spends a small per-IP budget, then that IP cools down.
    let r = bootstrap(&mut e, "WRON-GCOD").await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(r.body["burned"], false);
    let w = e.st.db.read(memora_state::arm::get).unwrap();
    assert!(w.last_burn.is_none());
    let far = Some("203.0.113.77");
    for i in 0..memora_http::guard::CODE_IP_LIMIT {
        let r = bootstrap_from(&mut e, "WRON-GCOD", far).await;
        let want = if i + 1 < memora_http::guard::CODE_IP_LIMIT {
            StatusCode::FORBIDDEN
        } else {
            StatusCode::TOO_MANY_REQUESTS
        };
        assert_eq!(r.status, want, "miss {i}: {}", r.body);
    }
    let r = bootstrap_from(&mut e, "ABCD-EFGH", far).await;
    assert_eq!(
        r.status,
        StatusCode::TOO_MANY_REQUESTS,
        "that IP is cooling down"
    );
    // Many wrong codes from many places do close the window and void the code.
    let mut last = None;
    for i in 0..memora_http::guard::CODE_WINDOW_LIMIT {
        let ip = format!("198.51.100.{}", i % 250 + 1);
        last = Some(bootstrap_from(&mut e, "WRON-GCOD", Some(&ip)).await);
        if last.as_ref().unwrap().body["burned"] == true {
            break;
        }
    }
    assert_eq!(last.unwrap().body["burned"], true);
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
    // The latest call is reported too (unix seconds), for the live panel.
    assert!(
        r.body["keys"][0]["last_used"].as_i64().unwrap_or(0) > 0,
        "{}",
        r.body
    );

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

    // Only the database and the key-sealing master key are in the state folder.
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
async fn expired_window_never_locks_the_instance() {
    let mut e = env("lock");
    let other = cli(&e);
    arm(&other, ArmMode::Bootstrap, "ABCD-EFGH");
    let r = bootstrap(&mut e, "ABCD-EFGH").await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let sid = r.cookie();
    let r = call(
        &mut e,
        Method::POST,
        "/api/keys",
        Some(json!({"name": "agent", "scopes": ["mcp", "read"]})),
        Opts {
            cookie: Some(&sid),
            same_origin: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let raw = r.body["key"].as_str().unwrap().to_string();
    let list = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"});
    let agent = || Opts {
        key: Some(&raw),
        ..Default::default()
    };

    // A reset window armed long ago with the minimum ttl: expired, never used.
    let hash = cache::code_hash("JKMN-PQRS");
    other
        .write(|tx| {
            memora_state::arm::arm(tx, ArmMode::Reset, 30, &hash, memora_state::now() - 100)
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
    assert_eq!(r.body["locked"], false);
    assert_eq!(r.body["armed"], false);
    assert_eq!(r.body["expired"], "reset");
    let r = call(&mut e, Method::POST, "/mcp", Some(list.clone()), agent()).await;
    assert_eq!(r.status, StatusCode::OK, "agents keep working");
    let me = Opts {
        cookie: Some(&sid),
        ..Default::default()
    };
    let r = call(&mut e, Method::GET, "/api/auth/me", None, me).await;
    assert_eq!(r.status, StatusCode::OK, "the owner stays signed in");
    let w = other.read(memora_state::arm::get).unwrap();
    assert_eq!(
        w.status,
        memora_state::arm::ArmStatus::Idle,
        "stored as idle"
    );

    // A lock an older version took when a window ran out is lifted.
    other
        .write(|tx| {
            tx.execute(
                "UPDATE arm_state SET state = 'locked', mode = 'bootstrap', armed_at = 1000,
                   ttl = 300, locked_at = 1400 WHERE id = 1",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    let r = call(&mut e, Method::POST, "/mcp", Some(list.clone()), agent()).await;
    assert_eq!(r.status, StatusCode::OK, "old expiry lock lifted");
    let r = call(
        &mut e,
        Method::GET,
        "/api/auth/state",
        None,
        Opts::default(),
    )
    .await;
    assert_eq!(r.body["locked"], false);

    // Only an explicit lock stops agents and the UI.
    other
        .write(|tx| memora_state::arm::lock(tx, memora_state::now()))
        .unwrap();
    let r = call(&mut e, Method::POST, "/mcp", Some(list.clone()), agent()).await;
    assert_eq!(r.status, StatusCode::LOCKED);
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
    // Pages go to plain /login (no extra query).
    let r = call(&mut e, Method::GET, "/brain", None, Opts::default()).await;
    assert_eq!(r.headers[header::LOCATION], "/login");
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
    let r = call(&mut e, Method::POST, "/mcp", Some(list), agent()).await;
    assert_eq!(r.status, StatusCode::OK);
}

/// Failed logins from many addresses only switch on slow mode; the owner still gets in.
#[tokio::test]
async fn failed_logins_from_many_ips_do_not_lock_out_the_owner() {
    let mut e = env("lockout");
    let other = cli(&e);
    arm(&other, ArmMode::Bootstrap, "ABCD-EFGH");
    assert_eq!(bootstrap(&mut e, "ABCD-EFGH").await.status, StatusCode::OK);
    let wrong = json!({"username": "owner", "password": "nope nope nope"});
    for i in 0..30 {
        let ip = format!("203.0.113.{}", i + 1);
        let r = call(
            &mut e,
            Method::POST,
            "/api/auth/login",
            Some(wrong.clone()),
            Opts {
                peer: Some(&ip),
                ..Default::default()
            },
        )
        .await;
        assert_ne!(r.status, StatusCode::OK);
    }
    assert!(e.st.guard.account_hot());
    // An attacking address in slow mode is cut off after a single miss.
    let r = call(
        &mut e,
        Method::POST,
        "/api/auth/login",
        Some(wrong.clone()),
        Opts {
            peer: Some("192.0.2.200"),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);
    // The owner, from a fresh address, still gets in.
    let r = call(
        &mut e,
        Method::POST,
        "/api/auth/login",
        Some(json!({"username": "owner", "password": PASSWORD})),
        Opts {
            peer: Some("198.51.100.42"),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
}

/// One address may register only a few OAuth clients.
#[tokio::test]
async fn client_registration_is_limited_per_ip() {
    let mut e = env("dcr");
    let body = json!({"client_name": "x", "redirect_uris": ["https://e.example/cb"]});
    let mut codes = Vec::new();
    for _ in 0..12 {
        let r = call(
            &mut e,
            Method::POST,
            "/oauth/register",
            Some(body.clone()),
            Opts {
                peer: Some("203.0.113.50"),
                ..Default::default()
            },
        )
        .await;
        codes.push(r.status);
    }
    assert!(
        codes[..10].iter().all(|c| *c == StatusCode::CREATED),
        "{codes:?}"
    );
    assert_eq!(codes[11], StatusCode::TOO_MANY_REQUESTS);
    // Another address still can.
    let r = call(
        &mut e,
        Method::POST,
        "/oauth/register",
        Some(body),
        Opts {
            peer: Some("198.51.100.50"),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED);
}

async fn me_status(e: &mut Env, sid: &str) -> StatusCode {
    let o = Opts {
        cookie: Some(sid),
        ..Default::default()
    };
    call(e, Method::GET, "/api/auth/me", None, o).await.status
}

/// `/logout` is POST only and same-origin: a link, image or cross-site form
/// on another page must not sign the owner out.
#[tokio::test]
async fn logout_is_post_only_and_same_origin() {
    let mut e = env("logout");
    let other = cli(&e);
    arm(&other, ArmMode::Bootstrap, "ABCD-EFGH");
    let r = bootstrap(&mut e, "ABCD-EFGH").await;
    assert_eq!(r.status, StatusCode::OK);
    let sid = r.cookie();
    let with = |same_origin| Opts {
        cookie: Some(&sid),
        same_origin,
        ..Default::default()
    };
    let r = call(&mut e, Method::GET, "/logout", None, with(true)).await;
    assert_eq!(r.status, StatusCode::METHOD_NOT_ALLOWED);
    let r = call(&mut e, Method::POST, "/logout", None, with(false)).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(
        me_status(&mut e, &sid).await,
        StatusCode::OK,
        "still signed in"
    );
    let r = call(&mut e, Method::POST, "/logout", None, with(true)).await;
    assert_eq!(r.status, StatusCode::FOUND);
    assert_eq!(me_status(&mut e, &sid).await, StatusCode::UNAUTHORIZED);
}
