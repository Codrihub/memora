//! Note tools over MCP: folder defaults and refusals, title notices, list
//! grouping by full folder, normalized paths, and the per-instance exchange
//! folder used by export_memory / import_memory.

use memora_core::MemoryStore;
use memora_mcp::{Caller, McpServer, RpcRequest};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("memora-notes-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("vault/Notes")).unwrap();
    std::fs::create_dir_all(dir.join("vault/Projects/Atlas")).unwrap();
    std::fs::create_dir_all(dir.join("state")).unwrap();
    std::fs::write(dir.join("vault/Notes/Ideas.md"), "# Ideas\n").unwrap();
    std::fs::write(dir.join("vault/Projects/Atlas/Overview.md"), "# O\n").unwrap();
    dir
}

fn server(dir: &Path) -> McpServer {
    let store = MemoryStore::new(dir.join("vault").to_string_lossy().to_string());
    let db = memora_state::Db::open(&dir.join("state")).unwrap();
    memora_mcp::sync_catalog(&db).unwrap();
    McpServer::new(Arc::new(Mutex::new(store)), db)
}

/// `Ok(result)` or `Err(error text)`.
fn call(srv: &McpServer, name: &str, args: Value) -> Result<Value, String> {
    let req = RpcRequest {
        jsonrpc: Some("2.0".into()),
        id: Some(json!(1)),
        method: "tools/call".into(),
        params: json!({"name": name, "arguments": args}),
    };
    let r = serde_json::to_value(srv.handle_as(&req, &Caller::full("owner"))).unwrap();
    let text = r["result"]["content"][0]["text"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    if r["result"]["isError"] == true {
        Err(text)
    } else {
        Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
    }
}

#[test]
fn create_and_move_folders() {
    let dir = scratch("folders");
    let srv = server(&dir);
    let r = call(
        &srv,
        "create_memory",
        json!({"title": "A", "folder": "   "}),
    )
    .unwrap();
    assert_eq!(r["path"], "Memory/A.md");
    let e = call(
        &srv,
        "create_memory",
        json!({"title": "evil", "folder": "/etc"}),
    )
    .unwrap_err();
    assert!(e.contains("folder must be relative to the vault"), "{e}");
    let r = call(
        &srv,
        "create_memory",
        json!({"title": "Ideas.md", "folder": "Notes"}),
    );
    assert!(r.unwrap_err().contains("already exists"));
    let r = call(
        &srv,
        "create_memory",
        json!({"title": "Rocket: 🚀?", "folder": "Notes"}),
    )
    .unwrap();
    assert_eq!(r["path"], "Notes/Rocket 🚀.md");
    assert_eq!(r["renamed_from"], "Rocket: 🚀?");
    assert!(r["note"].as_str().unwrap().contains("Notes/Rocket 🚀.md"));
    let e = call(
        &srv,
        "move_memory",
        json!({"path": "Memory/A.md", "folder": ""}),
    )
    .unwrap_err();
    assert!(
        e.contains("folder is required") && e.contains("Root"),
        "{e}"
    );
    let r = call(
        &srv,
        "move_memory",
        json!({"path": "Memory\\A.md", "folder": "Root"}),
    )
    .unwrap();
    assert_eq!(
        (r["from"].as_str(), r["to"].as_str()),
        (Some("Memory/A.md"), Some("A.md"))
    );
    let r = call(&srv, "batch_create", json!({"notes": [{"title": "B"}]})).unwrap();
    assert_eq!(r[0]["path"], "Memory/B.md");
    let r = call(
        &srv,
        "save_memory",
        json!({"path": "Notes\\Ideas.md", "content": "x"}),
    )
    .unwrap();
    assert_eq!(r["path"], "Notes/Ideas.md");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn list_memory_groups_by_full_folder() {
    let dir = scratch("list");
    let srv = server(&dir);
    std::fs::write(dir.join("vault/Top.md"), "t").unwrap();
    let r = call(&srv, "list_memory", json!({})).unwrap();
    assert_eq!(r["Projects/Atlas"][0]["path"], "Projects/Atlas/Overview.md");
    assert_eq!(r["Projects/Atlas"][0]["folder"], "Projects/Atlas");
    assert!(r.get("Projects").is_none(), "{r}");
    assert_eq!(r["Root"][0]["folder"], "Root");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn template_create_reports_renamed_titles() {
    let dir = scratch("tpl");
    let srv = server(&dir);
    std::fs::create_dir_all(dir.join("vault/Templates")).unwrap();
    std::fs::write(dir.join("vault/Templates/Day.md"), "# {{title}}").unwrap();
    let e = call(
        &srv,
        "template_create",
        json!({"template": "Notes/Ideas.md", "title": "x"}),
    );
    assert!(e.unwrap_err().contains("template not found"));
    let r = call(
        &srv,
        "template_create",
        json!({"template": "Day", "title": "Mon | ✨"}),
    )
    .unwrap();
    assert_eq!(r["path"], "Mon ✨.md");
    assert_eq!(r["renamed_from"], "Mon | ✨");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn exchange_lives_in_the_state_dir() {
    let dir = scratch("exchange");
    let srv = server(&dir);
    let e = call(&srv, "export_memory", json!({"paths": ["Nope.md"]})).unwrap_err();
    assert!(e.contains("not found: Nope.md"), "{e}");
    let r = call(&srv, "export_memory", json!({"paths": ["Notes"]})).unwrap();
    let name = r["name"].as_str().unwrap().to_string();
    let stamp = name
        .strip_prefix("memora-export-")
        .and_then(|n| n.strip_suffix(".zip"))
        .unwrap();
    assert!(stamp.bytes().all(|b| b.is_ascii_digit()), "{name}");
    assert!(dir.join("state/exchange").join(&name).is_file());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.join("state/exchange"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o700);
    }
    let args = json!({"paths": ["Notes"], "out_path": "n.zip"});
    assert_eq!(
        call(&srv, "export_memory", args.clone()).unwrap()["replaced"],
        false
    );
    let e = call(&srv, "export_memory", args).unwrap_err();
    assert!(
        e.contains("already exists") && e.contains("overwrite"),
        "{e}"
    );
    let r = call(
        &srv,
        "export_memory",
        json!({"paths": ["Notes"], "out_path": "n.zip", "overwrite": true}),
    )
    .unwrap();
    assert_eq!(r["replaced"], true);
    let e = call(&srv, "import_memory", json!({"zip_path": "nope.zip"})).unwrap_err();
    assert!(
        e.contains("nope.zip not found in the exchange folder"),
        "{e}"
    );
    std::fs::write(dir.join("state/exchange/bad.zip"), "plain text").unwrap();
    let e = call(&srv, "import_memory", json!({"zip_path": "bad.zip"})).unwrap_err();
    assert!(e.contains("not a valid zip file"), "{e}");
    let r = call(
        &srv,
        "import_memory",
        json!({"zip_path": "n.zip", "overwrite": true}),
    )
    .unwrap();
    assert_eq!(r["overwritten"], json!(["Notes/Ideas.md"]));
    std::fs::remove_dir_all(&dir).ok();
}
