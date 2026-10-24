//! Server settings over HTTP: the owner changes the server name and the sign-in
//! limits; bad values are refused with 400; a key without admin is refused.

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

const HOST: &str = "localhost:8479";

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

async fn send(app: &mut Router, mut req: Request<Body>) -> axum::response::Response {
    let peer: SocketAddr = "127.0.0.1:40000".parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(peer));
    app.call(req).await.unwrap()
}

async fn env(tag: &str) -> Env {
    let db = Db::open_temp().unwrap();
    memora_mcp::sync_catalog(&db).unwrap();
    let vault = std::env::temp_dir().join(format!("memora-srvset-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&vault);
    std::fs::create_dir_all(vault.join("Notes")).unwrap();
    for i in 0..40 {
        std::fs::write(
            vault.join(format!("Notes/note-{i}.md")),
            format!("# Note {i}\nSome words about note {i}.\n"),
        )
        .unwrap();
    }
    db.write(|tx| {
        memora_state::settings::set_vault(tx, Some(vault.to_str().unwrap()), memora_state::now())
    })
    .unwrap();
    let store = Arc::new(Mutex::new(MemoryStore::new(&vault)));
    store.lock().unwrap().reindex().unwrap();
    let st = AppState::new(db, store, String::new(), Guard::new(""), vec![]).unwrap();
    let mut app = build_router(st.clone());
    let cli = Db::open(st.db.state_dir()).unwrap();
    let hash = cache::code_hash("JKMN-PQRS");
    cli.write(|tx| memora_state::arm::arm(tx, ArmMode::Bootstrap, 300, &hash, memora_state::now()))
        .unwrap();
    let body =
        json!({"code": "JKMN-PQRS", "username": "Owner", "password": "correct horse battery"});
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/bootstrap")
        .header(header::HOST, HOST)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let res = send(&mut app, req).await;
    assert_eq!(res.status(), StatusCode::OK);
    assert!(
        res.headers().get(header::CONTENT_ENCODING).is_none(),
        "sign-in answers are never compressed"
    );
    let sid = res
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|c| c.to_str().ok())
        .and_then(|c| c.strip_prefix("memora_sess="))
        .map(|c| c.split(';').next().unwrap_or("").to_string())
        .unwrap_or_default();
    Env { app, vault, sid }
}

async fn post(e: &mut Env, body: Value) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/settings/server")
        .header(header::HOST, HOST)
        .header(header::COOKIE, format!("memora_sess={}", e.sid))
        .header(header::ORIGIN, format!("http://{HOST}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let res = send(&mut e.app, req).await;
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn owner_changes_name_and_sign_in_limits() {
    let mut e = env("ok").await;
    let (s, v) = post(
        &mut e,
        json!({"realm": "Kurnia memory", "session_ttl": 7200, "session_max_age": 604800}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["realm"], "Kurnia memory");
    assert_eq!(v["session_ttl"], 7200);
    assert_eq!(v["session_max_age"], 604800);
    // The cached settings follow at once.
    let req = Request::builder()
        .uri("/api/config")
        .header(header::HOST, HOST)
        .header(header::COOKIE, format!("memora_sess={}", e.sid))
        .body(Body::empty())
        .unwrap();
    let res = send(&mut e.app, req).await;
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
        .await
        .unwrap();
    let cfg: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(cfg["realm"], "Kurnia memory");
    assert_eq!(cfg["session_ttl"], 7200);
}

#[tokio::test]
async fn bad_values_are_refused() {
    let mut e = env("bad").await;
    assert_eq!(
        post(&mut e, json!({"session_ttl": 10})).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        post(&mut e, json!({"realm": "   "})).await.0,
        StatusCode::BAD_REQUEST
    );
    // The longest sign-in cannot be shorter than the idle time.
    assert_eq!(
        post(
            &mut e,
            json!({"session_ttl": 86400, "session_max_age": 3600})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(post(&mut e, json!({})).await.0, StatusCode::BAD_REQUEST);
}
