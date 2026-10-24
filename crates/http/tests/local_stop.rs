//! `POST /_stop`: accepted only from loopback, not proxied, with the stop token.

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use memora_core::MemoryStore;
use memora_http::shutdown::{
    publish_stop_token, set_stop_token, withdraw_stop_token, STOP_TOKEN_FILE, STOP_TOKEN_HEADER,
};
use memora_http::{build_router, guard::Guard, AppState};
use memora_state::Db;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tower::Service;

fn app() -> (AppState, Router) {
    let db = Db::open_temp().unwrap();
    memora_mcp::sync_catalog(&db).unwrap();
    let store = Arc::new(Mutex::new(MemoryStore::new("")));
    let st = AppState::new(db, store, String::new(), Guard::new(""), vec![]).unwrap();
    let app = build_router(st.clone());
    (st, app)
}

async fn stop(app: &mut Router, peer: &str, token: Option<&str>, forwarded: bool) -> StatusCode {
    let mut b = Request::builder()
        .method(Method::POST)
        .uri("/_stop")
        .header(header::HOST, "127.0.0.1:8400");
    if let Some(t) = token {
        b = b.header(STOP_TOKEN_HEADER, t);
    }
    if forwarded {
        b = b.header("x-forwarded-for", "203.0.113.9");
    }
    let mut req = b.body(Body::empty()).unwrap();
    let peer: SocketAddr = peer.parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(peer));
    app.call(req).await.unwrap().status()
}

// One test: the accepted token is process-wide state.
#[tokio::test]
async fn only_local_callers_with_the_token_may_stop_the_server() {
    let (st, mut app) = app();

    // No token published: nothing is accepted.
    set_stop_token(None);
    assert_eq!(
        stop(&mut app, "127.0.0.1:40000", Some("stop_x"), false).await,
        StatusCode::FORBIDDEN
    );

    // The token is written to the state dir and accepted from loopback only.
    let state = st.db.state_dir().to_path_buf();
    publish_stop_token(&state).unwrap();
    let token = std::fs::read_to_string(state.join(STOP_TOKEN_FILE)).unwrap();
    assert!(token.starts_with("stop_") && token.len() > 40);

    assert_eq!(
        stop(&mut app, "127.0.0.1:40000", None, false).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        stop(&mut app, "127.0.0.1:40000", Some(""), false).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        stop(&mut app, "127.0.0.1:40000", Some("stop_wrong"), false).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        stop(&mut app, "192.168.1.20:40000", Some(&token), false).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        stop(&mut app, "127.0.0.1:40000", Some(&token), true).await,
        StatusCode::FORBIDDEN,
        "a local reverse proxy must not pass a remote caller through"
    );
    assert_eq!(
        stop(&mut app, "127.0.0.1:40000", Some(&token), false).await,
        StatusCode::OK
    );
    assert_eq!(
        stop(&mut app, "[::1]:40000", Some(&token), false).await,
        StatusCode::OK
    );

    // On exit the token is withdrawn and its file removed.
    withdraw_stop_token(&state);
    assert!(!state.join(STOP_TOKEN_FILE).exists());
    assert_eq!(
        stop(&mut app, "127.0.0.1:40000", Some(&token), false).await,
        StatusCode::FORBIDDEN
    );
}
