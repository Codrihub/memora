//! Response compression: signed-in GET answers under `/api/` are gzip-compressed
//! when the client accepts it; pages, sign-in answers and writes are not.

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use memora_core::MemoryStore;
use memora_http::{build_router, cache, guard::Guard, AppState};
use memora_state::arm::ArmMode;
use memora_state::Db;
use serde_json::json;
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
    let vault = std::env::temp_dir().join(format!("memora-gzip-{tag}-{}", std::process::id()));
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
        .header(header::ACCEPT_ENCODING, "gzip")
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

async fn get(e: &mut Env, path: &str) -> axum::response::Response {
    let req = Request::builder()
        .method(Method::GET)
        .uri(path)
        .header(header::HOST, HOST)
        .header(header::COOKIE, format!("memora_sess={}", e.sid))
        .header(header::ACCEPT_ENCODING, "gzip")
        .body(Body::empty())
        .unwrap();
    send(&mut e.app, req).await
}

#[tokio::test]
async fn api_reads_are_gzipped_and_pages_are_not() {
    let mut e = env("a").await;
    let res = get(&mut e, "/api/tree").await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers()
            .get(header::CONTENT_ENCODING)
            .and_then(|v| v.to_str().ok()),
        Some("gzip")
    );
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 22)
        .await
        .unwrap();
    let mut out = String::new();
    std::io::Read::read_to_string(&mut flate2::read::GzDecoder::new(&bytes[..]), &mut out).unwrap();
    assert!(out.contains("note-7"), "the gzip body is the JSON");

    let page = get(&mut e, "/settings").await;
    assert!(
        page.headers().get(header::CONTENT_ENCODING).is_none(),
        "HTML pages are never compressed here"
    );
}

#[tokio::test]
async fn no_gzip_without_accept_encoding() {
    let mut e = env("b").await;
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/tree")
        .header(header::HOST, HOST)
        .header(header::COOKIE, format!("memora_sess={}", e.sid))
        .body(Body::empty())
        .unwrap();
    let res = send(&mut e.app, req).await;
    assert_eq!(res.status(), StatusCode::OK);
    assert!(res.headers().get(header::CONTENT_ENCODING).is_none());
}
