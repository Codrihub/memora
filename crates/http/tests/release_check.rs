//! `MEMORA_UPDATE_CHECK=false` disables the release check (own binary: sets the env).

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Method, Request, StatusCode};
use memora_core::MemoryStore;
use memora_http::{build_router, cache, guard::Guard, release, AppState};
use memora_state::arm::ArmMode;
use memora_state::Db;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tower::Service;

const HOST: &str = "localhost:8476";

async fn call(
    app: &mut axum::Router,
    method: Method,
    path: &str,
    body: Option<Value>,
    cookie: Option<&str>,
) -> (StatusCode, Option<String>, Value) {
    let mut b = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, HOST)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, format!("memora_sess={c}"));
    }
    let mut req = b
        .body(body.map_or_else(Body::empty, |v| Body::from(v.to_string())))
        .unwrap();
    let peer: SocketAddr = "127.0.0.1:40000".parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(peer));
    let res = app.call(req).await.unwrap();
    let status = res.status();
    let cookie = res
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|c| c.to_str().ok())
        .and_then(|c| c.strip_prefix("memora_sess="))
        .and_then(|c| c.split(';').next())
        .map(str::to_string);
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
        .await
        .unwrap();
    (
        status,
        cookie,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn disabled_check_reports_disabled_without_network() {
    std::env::set_var("MEMORA_UPDATE_CHECK", "false");
    assert!(!release::enabled());

    let db = Db::open_temp().unwrap();
    memora_mcp::sync_catalog(&db).unwrap();
    let assets = std::env::temp_dir().join(format!("memora-http-rel-{}", std::process::id()));
    std::fs::create_dir_all(&assets).unwrap();
    let st = AppState::new(
        db,
        Arc::new(Mutex::new(MemoryStore::new(""))),
        assets.to_string_lossy().to_string(),
        Guard::new(""),
        vec![],
    )
    .unwrap();
    let mut app = build_router(st.clone());

    // Disabled: spawning starts nothing.
    release::spawn();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert_eq!(release::attempts(), 0, "no network check when disabled");

    // Owner session.
    let hash = cache::code_hash("JKMN-PQRS");
    st.db
        .write(|tx| memora_state::arm::arm(tx, ArmMode::Bootstrap, 300, &hash, memora_state::now()))
        .unwrap();
    let (s, sid, body) = call(
        &mut app,
        Method::POST,
        "/api/auth/bootstrap",
        Some(
            json!({"code": "JKMN-PQRS", "username": "Owner", "password": "correct horse battery"}),
        ),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{body}");
    let sid = sid.expect("session cookie");

    // Not exposed without a session.
    let (s, _, _) = call(&mut app, Method::GET, "/api/config", None, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    let (s, _, cfg) = call(&mut app, Method::GET, "/api/config", None, Some(&sid)).await;
    assert_eq!(s, StatusCode::OK, "{cfg}");
    assert_eq!(cfg["version"], env!("CARGO_PKG_VERSION"));
    let u = &cfg["update"];
    assert_eq!(u["state"], "disabled");
    assert_eq!(u["current"], env!("CARGO_PKG_VERSION"));
    assert_eq!(u["available"], false);
    assert_eq!(u["latest"], Value::Null);
    assert_eq!(u["checked_at"], Value::Null);
    assert_eq!(release::attempts(), 0);

    // /healthz does not carry the release check.
    let (_, _, h) = call(&mut app, Method::GET, "/healthz", None, None).await;
    assert!(h.get("update").is_none(), "{h}");

    let _ = std::fs::remove_dir_all(&assets);
}
