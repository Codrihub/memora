//! Version history over HTTP: list, read and diff old revisions, restore as a new
//! revision, per-key privacy, and 409 for a vault without git.

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

fn write(vault: &std::path::Path, rel: &str, body: &str) {
    let p = vault.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

async fn env(tag: &str, git: bool) -> Env {
    let db = Db::open_temp().unwrap();
    memora_mcp::sync_catalog(&db).unwrap();
    let vault = std::env::temp_dir().join(format!("memora-hist-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&vault);
    write(&vault, "Notes/plan.md", "# Plan\nfirst draft\n");
    write(&vault, "Private/diary.md", "# Diary\nsecret words\n");
    db.write(|tx| {
        memora_state::settings::set_vault(tx, Some(vault.to_str().unwrap()), memora_state::now())
    })
    .unwrap();
    let store = Arc::new(Mutex::new(MemoryStore::new(&vault)));
    if git {
        let ok = std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(&vault)
            .status()
            .unwrap()
            .success();
        assert!(ok);
        store.lock().unwrap().git_commit("start history");
    }
    store.lock().unwrap().reindex().unwrap();
    let st = AppState::new(db, store, String::new(), Guard::new(""), vec![]).unwrap();
    let app = build_router(st.clone());
    let mut e = Env {
        app,
        vault,
        sid: String::new(),
    };
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
    let res = send(&mut e, req).await;
    assert_eq!(res.0, StatusCode::OK, "{}", res.2);
    e.sid = res.1;
    e
}

#[derive(Clone, Copy)]
enum Who<'a> {
    Owner,
    /// The owner's cookie without the Origin header (a cross-site POST).
    OwnerNoOrigin,
    Key(&'a str),
}

/// `(status, session cookie from Set-Cookie or "", body)`.
async fn send(e: &mut Env, mut req: Request<Body>) -> (StatusCode, String, Value) {
    let peer: SocketAddr = "127.0.0.1:40000".parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(peer));
    let res = e.app.call(req).await.unwrap();
    let status = res.status();
    let cookie = res
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|c| c.to_str().ok())
        .and_then(|c| c.strip_prefix("memora_sess="))
        .map(|c| c.split(';').next().unwrap_or("").to_string())
        .unwrap_or_default();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 22)
        .await
        .unwrap();
    (
        status,
        cookie,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn call(
    e: &mut Env,
    method: Method,
    path: &str,
    body: Option<Value>,
    who: Who<'_>,
) -> (StatusCode, Value) {
    let mut b = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, HOST)
        .header(header::CONTENT_TYPE, "application/json");
    match who {
        Who::Owner => {
            b = b
                .header(header::COOKIE, format!("memora_sess={}", e.sid))
                .header(header::ORIGIN, format!("http://{HOST}"));
        }
        Who::OwnerNoOrigin => b = b.header(header::COOKIE, format!("memora_sess={}", e.sid)),
        Who::Key(k) => b = b.header(header::AUTHORIZATION, format!("Bearer {k}")),
    }
    let req = b
        .body(body.map_or_else(Body::empty, |v| Body::from(v.to_string())))
        .unwrap();
    let (s, _, v) = send(e, req).await;
    (s, v)
}

async fn get(e: &mut Env, who: Who<'_>, path: &str) -> (StatusCode, Value) {
    call(e, Method::GET, path, None, who).await
}

async fn post(e: &mut Env, who: Who<'_>, path: &str, body: Value) -> (StatusCode, Value) {
    call(e, Method::POST, path, Some(body), who).await
}

async fn new_key(e: &mut Env, name: &str, scopes: &[&str]) -> (String, String) {
    let (s, b) = post(
        e,
        Who::Owner,
        "/api/keys",
        json!({"name": name, "scopes": scopes}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    (
        b["key"].as_str().unwrap().to_string(),
        b["id"].as_str().unwrap().to_string(),
    )
}

async fn save(e: &mut Env, who: Who<'_>, path: &str, content: &str) {
    let (s, b) = post(
        e,
        who,
        "/api/save",
        json!({"path": path, "content": content}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
}

fn versions(b: &Value) -> Vec<Value> {
    b["versions"].as_array().unwrap().clone()
}

#[tokio::test]
async fn history_lists_reads_and_restores_as_a_new_version() {
    let mut e = env("flow", true).await;
    let (key, _) = new_key(&mut e, "Scribe", &["read", "write"]).await;
    save(
        &mut e,
        Who::Owner,
        "Notes/plan.md",
        "# Plan\nsecond draft\n",
    )
    .await;
    save(
        &mut e,
        Who::Key(&key),
        "Notes/plan.md",
        "# Plan\nthird draft\n",
    )
    .await;

    // Newest first, numbered from the oldest (1) to the current one (total).
    let (s, b) = get(&mut e, Who::Owner, "/api/history?path=Notes/plan.md").await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["total"], 3, "{b}");
    let v = versions(&b);
    assert_eq!(v.len(), 3);
    assert_eq!(
        v.iter()
            .map(|x| x["version"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        [3, 2, 1]
    );
    assert!(v.iter().all(|x| x["total"] == 3));
    // Web writes name their caller: the key, then the owner (stored lowercased).
    assert_eq!(v[0]["author"], "Scribe");
    assert_eq!(v[0]["owner"], false);
    assert_eq!(v[1]["author"], "owner");
    assert_eq!(v[1]["owner"], true);
    assert_eq!(v[0]["message"], "edit: Notes/plan.md");
    // `.md` is optional and `limit` keeps the numbers.
    let (s, b) = get(&mut e, Who::Owner, "/api/history?path=Notes/plan&limit=1").await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(versions(&b).len(), 1);
    assert_eq!(b["versions"][0]["version"], 3);
    assert_eq!(b["total"], 3);
    let (s, _) = get(
        &mut e,
        Who::Owner,
        "/api/history?path=Notes/plan.md&limit=0",
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // Version 1, read back and rendered.
    let first = v[2]["rev"].as_str().unwrap().to_string();
    let (s, b) = get(
        &mut e,
        Who::Owner,
        &format!("/api/note-at?path=Notes/plan.md&rev={first}"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["content"], "# Plan\nfirst draft\n");
    assert!(b["html"].as_str().unwrap().contains("first draft"), "{b}");
    let (s, b) = get(
        &mut e,
        Who::Owner,
        "/api/note-at?path=Notes/plan.md&rev=nosuchrev",
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{b}");
    assert!(b["error"].as_str().unwrap().contains("unknown revision"));

    // What changed from version 1 to now.
    let (s, b) = get(
        &mut e,
        Who::Owner,
        &format!("/api/diff?path=Notes/plan.md&a={first}"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["changed"], true);
    assert!(b["diff"].as_str().unwrap().contains("-first draft"), "{b}");
    assert!(b["diff"].as_str().unwrap().contains("+third draft"), "{b}");

    // Restoring version 1 of 3 makes version 4; nothing is lost.
    let (s, b) = post(
        &mut e,
        Who::Owner,
        "/api/history/restore",
        json!({"path": "Notes/plan.md", "rev": first}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["changed"], true);
    assert_eq!(b["version"], 4);
    assert_eq!(b["total"], 4);
    assert_eq!(
        std::fs::read_to_string(e.vault.join("Notes/plan.md")).unwrap(),
        "# Plan\nfirst draft\n"
    );
    let (_, b) = get(&mut e, Who::Owner, "/api/history?path=Notes/plan.md").await;
    assert_eq!(b["total"], 4);
    assert_eq!(b["versions"][0]["author"], "owner");
    assert!(b["versions"][0]["message"]
        .as_str()
        .unwrap()
        .starts_with("restore: Notes/plan.md@"));
    // The third draft is still there, as version 3.
    let third = b["versions"][1]["rev"].as_str().unwrap().to_string();
    let (_, b) = get(
        &mut e,
        Who::Owner,
        &format!("/api/note-at?path=Notes/plan.md&rev={third}"),
    )
    .await;
    assert_eq!(b["content"], "# Plan\nthird draft\n");

    // Restoring what the note already holds adds nothing.
    let (s, b) = post(
        &mut e,
        Who::Owner,
        "/api/history/restore",
        json!({"path": "Notes/plan.md", "rev": first}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["changed"], false);
    assert_eq!(b["total"], 4);

    // A cross-site POST and a missing rev are refused.
    let (s, _) = post(
        &mut e,
        Who::OwnerNoOrigin,
        "/api/history/restore",
        json!({"path": "Notes/plan.md", "rev": first}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = post(
        &mut e,
        Who::Owner,
        "/api/history/restore",
        json!({"path": "Notes/plan.md"}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn history_follows_renames() {
    let mut e = env("rename", true).await;
    save(
        &mut e,
        Who::Owner,
        "Notes/plan.md",
        "# Plan\nsecond draft\n",
    )
    .await;
    let (s, b) = post(
        &mut e,
        Who::Owner,
        "/api/rename",
        json!({"path": "Notes/plan.md", "name": "roadmap"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    let (s, b) = get(&mut e, Who::Owner, "/api/history?path=Notes/roadmap.md").await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["total"], 3, "{b}");
    // Older revisions name the path they had then.
    assert_eq!(b["versions"][2]["path"], "Notes/plan.md");
    let first = b["versions"][2]["rev"].as_str().unwrap().to_string();
    let (s, b) = get(
        &mut e,
        Who::Owner,
        &format!("/api/note-at?path=Notes/roadmap.md&rev={first}"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["content"], "# Plan\nfirst draft\n");
    // Restoring under the old name is refused and names the new one.
    let (s, b) = post(
        &mut e,
        Who::Owner,
        "/api/history/restore",
        json!({"path": "Notes/plan.md", "rev": first}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{b}");
    assert!(
        b["error"].as_str().unwrap().contains("Notes/roadmap.md"),
        "{b}"
    );
}

#[tokio::test]
async fn hidden_paths_have_no_history_for_the_key_they_are_hidden_from() {
    let mut e = env("privacy", true).await;
    let (kr, idr) = new_key(&mut e, "Reader", &["read", "write"]).await;
    let (ko, _) = new_key(&mut e, "Other", &["read"]).await;
    save(
        &mut e,
        Who::Owner,
        "Private/diary.md",
        "# Diary\nmore secrets\n",
    )
    .await;
    let body = json!({"path": "Private", "kind": "folder", "mode": "deny", "keys": [idr]});
    let (s, b) = call(
        &mut e,
        Method::PUT,
        "/api/privacy/path",
        Some(body),
        Who::Owner,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");

    let (s, b) = get(&mut e, Who::Key(&kr), "/api/history?path=Private/diary.md").await;
    assert_eq!(s, StatusCode::NOT_FOUND, "{b}");
    assert!(!b.to_string().contains("secret"), "{b}");
    let (s, _) = get(
        &mut e,
        Who::Key(&kr),
        "/api/note-at?path=Private/diary.md&rev=HEAD~1",
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = get(
        &mut e,
        Who::Key(&kr),
        "/api/diff?path=Private/diary.md&a=HEAD~1",
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = post(
        &mut e,
        Who::Key(&kr),
        "/api/history/restore",
        json!({"path": "Private/diary.md", "rev": "HEAD~1"}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(
        std::fs::read_to_string(e.vault.join("Private/diary.md")).unwrap(),
        "# Diary\nmore secrets\n"
    );
    // A restricted key never gets a folder's or the whole vault's history.
    let (s, _) = get(&mut e, Who::Key(&kr), "/api/history?path=Notes").await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    // The owner and keys the rule does not name see it; restoring needs `write`.
    let (s, b) = get(&mut e, Who::Owner, "/api/history?path=Private/diary.md").await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["total"], 2);
    let (s, b) = get(&mut e, Who::Key(&ko), "/api/history?path=Private/diary.md").await;
    assert_eq!(s, StatusCode::OK, "{b}");
    let (s, b) = post(
        &mut e,
        Who::Key(&ko),
        "/api/history/restore",
        json!({"path": "Private/diary.md", "rev": "HEAD~1"}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{b}");
    assert_eq!(b["required_scope"], "write");
}

#[tokio::test]
async fn history_off_says_how_to_turn_it_on() {
    let mut e = env("off", false).await;
    for path in [
        "/api/history?path=Notes/plan.md",
        "/api/note-at?path=Notes/plan.md&rev=HEAD",
        "/api/diff?path=Notes/plan.md&a=HEAD",
    ] {
        let (s, b) = get(&mut e, Who::Owner, path).await;
        assert_eq!(s, StatusCode::CONFLICT, "{path}: {b}");
        assert_eq!(b["history"], false);
        assert!(b["error"].as_str().unwrap().contains("git init"), "{b}");
    }
    let (s, b) = post(
        &mut e,
        Who::Owner,
        "/api/history/restore",
        json!({"path": "Notes/plan.md", "rev": "HEAD"}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{b}");
    assert_eq!(b["history"], false);
    // Saving still works without history.
    save(&mut e, Who::Owner, "Notes/plan.md", "# Plan\nno history\n").await;
}

#[tokio::test]
async fn deleting_for_good_over_http_needs_admin_for_keys() {
    let mut e = env("permanent", true).await;
    let (writer, _) = new_key(&mut e, "Writer", &["read", "write"]).await;
    let (admin, _) = new_key(&mut e, "Admin", &["read", "write", "admin"]).await;
    save(&mut e, Who::Owner, "Notes/plan.md", "# Plan\nKILO-SECRET\n").await;
    write(&e.vault, "Notes/other.md", "# Other\n");
    write(&e.vault, "Notes/third.md", "# Third\n");

    // A write key may move to the Trash, never delete for good.
    let (s, b) = post(
        &mut e,
        Who::Key(&writer),
        "/api/delete",
        json!({"path": "Notes/plan.md"}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{b}");
    assert_eq!(b["required_scope"], "admin");
    assert!(
        b["error"].as_str().unwrap().contains("mode \"trash\""),
        "{b}"
    );
    let (s, _) = post(
        &mut e,
        Who::Key(&writer),
        "/api/delete",
        json!({"path": "Notes/plan.md", "mode": "delete"}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert!(e.vault.join("Notes/plan.md").exists());
    let (s, b) = post(
        &mut e,
        Who::Key(&writer),
        "/api/delete",
        json!({"path": "Notes/third.md", "mode": "trash"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");

    // An admin key and the owner's session delete for good, history included.
    let (s, b) = post(
        &mut e,
        Who::Key(&admin),
        "/api/delete",
        json!({"path": "Notes/plan.md"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert!(!e.vault.join("Notes/plan.md").exists());
    let (s, _) = get(&mut e, Who::Owner, "/api/history?path=Notes/plan.md").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let log = std::process::Command::new("git")
        .args(["log", "--all", "-p"])
        .current_dir(&e.vault)
        .output()
        .unwrap();
    assert!(!String::from_utf8_lossy(&log.stdout).contains("KILO-SECRET"));
    let (s, b) = post(
        &mut e,
        Who::Owner,
        "/api/delete",
        json!({"path": "Notes/other.md"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert!(!e.vault.join("Notes/other.md").exists());
}
