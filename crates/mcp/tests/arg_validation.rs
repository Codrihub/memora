//! `tools/call` arguments are checked against each tool's `inputSchema` before the tool
//! runs; refusals name the problem and list the arguments, and the vault is unchanged.

use memora_core::MemoryStore;
use memora_mcp::{admin_catalog, catalog, Caller, McpServer, RpcRequest};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("memora-args-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("vault/Plan")).unwrap();
    std::fs::create_dir_all(dir.join("vault/Work")).unwrap();
    std::fs::create_dir_all(dir.join("state")).unwrap();
    std::fs::write(
        dir.join("vault/Plan/Index.md"),
        "---\ntags: [tech]\n---\n\n# Index\n\nSee [[Work/Todo]].\n",
    )
    .unwrap();
    std::fs::write(dir.join("vault/Work/Todo.md"), "# Todo\n\n- [ ] ship\n").unwrap();
    dir
}

fn server(dir: &Path) -> McpServer {
    let store = MemoryStore::new(dir.join("vault").to_string_lossy().to_string());
    let db = memora_state::Db::open(&dir.join("state")).unwrap();
    memora_mcp::sync_catalog(&db).unwrap();
    McpServer::new(Arc::new(Mutex::new(store)), db)
}

fn call(srv: &McpServer, name: &str, args: Value) -> (bool, String) {
    let req = RpcRequest {
        jsonrpc: Some("2.0".into()),
        id: Some(json!(1)),
        method: "tools/call".into(),
        params: json!({"name": name, "arguments": args}),
    };
    let r = serde_json::to_value(srv.handle_as(&req, &Caller::full("owner"))).unwrap();
    assert!(r.get("error").is_none(), "{name}: unexpected RPC error {r}");
    let text = r["result"]["content"][0]["text"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    (r["result"]["isError"] == true, text)
}

/// A value of the right JSON type for a schema property.
fn sample(spec: &Value) -> Value {
    if let Some(e) = spec.get("enum").and_then(|e| e.as_array()) {
        return e[0].clone();
    }
    match spec.get("type").and_then(|t| t.as_str()) {
        Some("integer") | Some("number") => json!(1),
        Some("boolean") => json!(true),
        Some("array") => json!([]),
        Some("object") => json!({}),
        _ => json!("Plan/Index.md"),
    }
}

/// A value of the wrong JSON type for a schema property.
fn wrong(spec: &Value) -> Value {
    match spec.get("type").and_then(|t| t.as_str()) {
        Some("string") => json!(42),
        Some(_) => json!("not-the-right-type"),
        None => Value::Null,
    }
}

fn every_tool() -> Vec<(String, Value)> {
    let mut v: Vec<(String, Value)> = catalog()
        .into_iter()
        .map(|t| (t.name.to_string(), t.input_schema))
        .collect();
    v.extend(
        admin_catalog()
            .into_iter()
            .map(|t| (t.name.to_string(), t.input_schema)),
    );
    v
}

fn required(schema: &Value) -> Vec<String> {
    schema["required"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().map(String::from))
        .collect()
}

fn props(schema: &Value) -> serde_json::Map<String, Value> {
    schema["properties"]
        .as_object()
        .cloned()
        .unwrap_or_default()
}

/// The vault files, to prove a refused call changed nothing.
fn files(dir: &Path) -> Vec<String> {
    fn walk(p: &Path, root: &Path, out: &mut Vec<String>) {
        for e in std::fs::read_dir(p).unwrap().flatten() {
            let path = e.path();
            if path.is_dir() {
                walk(&path, root, out);
            } else {
                let body = std::fs::read_to_string(&path).unwrap_or_default();
                out.push(format!(
                    "{}:{}",
                    path.strip_prefix(root).unwrap().display(),
                    body.len()
                ));
            }
        }
    }
    let mut out = Vec::new();
    let root = dir.join("vault");
    walk(&root, &root, &mut out);
    out.sort();
    out
}

#[test]
fn every_tool_refuses_unknown_missing_and_mistyped_arguments() {
    let dir = scratch("sweep");
    let srv = server(&dir);
    let before = files(&dir);
    let mut checked = 0;
    for (name, schema) in every_tool() {
        let ps = props(&schema);
        let base: serde_json::Map<String, Value> = required(&schema)
            .iter()
            .map(|k| (k.clone(), sample(&ps[k])))
            .collect();

        // An unknown argument next to valid ones.
        let mut args = base.clone();
        args.insert("zz_bogus".into(), json!("x"));
        let (is_err, text) = call(&srv, &name, Value::Object(args));
        assert!(is_err, "{name}: unknown argument accepted");
        assert!(
            text.contains("unknown argument `zz_bogus`") && text.starts_with(&format!("{name}:")),
            "{name}: unclear message: {text}"
        );
        checked += 1;

        // Each required argument left out.
        for k in required(&schema) {
            let mut args = base.clone();
            args.remove(&k);
            let (is_err, text) = call(&srv, &name, Value::Object(args));
            assert!(is_err, "{name}: missing `{k}` accepted");
            assert!(
                text.contains(&format!("missing required argument `{k}`"))
                    && text.contains("Arguments:"),
                "{name}: unclear message: {text}"
            );
            checked += 1;
        }

        // Each argument with the wrong JSON type.
        for (k, spec) in &ps {
            let bad = wrong(spec);
            if bad.is_null() {
                continue;
            }
            let mut args = base.clone();
            args.insert(k.clone(), bad);
            let (is_err, text) = call(&srv, &name, Value::Object(args));
            assert!(is_err, "{name}: mistyped `{k}` accepted");
            assert!(
                text.contains(&format!("`{k}` must be")),
                "{name}: unclear message: {text}"
            );
            checked += 1;
        }

        // Arguments that are not an object.
        let (is_err, text) = call(&srv, &name, json!(["Plan/Index.md"]));
        assert!(
            is_err && text.contains("must be a JSON object"),
            "{name}: {text}"
        );
        checked += 1;
    }
    assert!(checked > 300, "only {checked} cases ran");
    assert_eq!(before, files(&dir), "a refused call changed the vault");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_reported_mistakes_are_refused_and_change_nothing() {
    let dir = scratch("reported");
    let srv = server(&dir);

    // move_memory with a wrong or missing `folder` must not move the note.
    let (is_err, text) = call(
        &srv,
        "move_memory",
        json!({"path": "Plan/Index.md", "new_path": "Plan/Memora/Index.md"}),
    );
    assert!(is_err);
    assert!(text.contains("unknown argument `new_path`"), "{text}");
    assert!(text.contains("folder (string, required)"), "{text}");
    assert!(dir.join("vault/Plan/Index.md").exists());
    assert!(!dir.join("vault/Index.md").exists());

    let (is_err, text) = call(&srv, "move_memory", json!({"path": "Plan/Index.md"}));
    assert!(
        is_err && text.contains("missing required argument `folder`"),
        "{text}"
    );
    assert!(dir.join("vault/Plan/Index.md").exists());

    // create_memory takes no `path`.
    let (is_err, text) = call(
        &srv,
        "create_memory",
        json!({"path": "Plan/New.md", "title": "New", "content": "x"}),
    );
    assert!(is_err && text.contains("unknown argument `path`"), "{text}");
    assert!(!dir.join("vault/Memory").exists());

    // patch_memory's `ops` must be an array.
    let (is_err, text) = call(
        &srv,
        "patch_memory",
        json!({"path": "Plan/Index.md", "ops": {"op": "append", "text": "x"}}),
    );
    assert!(
        is_err && text.contains("`ops` must be an array (got an object)"),
        "{text}"
    );

    // An enum value outside the list.
    let (is_err, text) = call(&srv, "pin", json!({"path": "Plan", "kind": "tag"}));
    assert!(
        is_err && text.contains("must be one of 'note', 'folder'"),
        "{text}"
    );

    // A minimum.
    let (is_err, text) = call(&srv, "pin", json!({"path": "Plan", "position": -1}));
    assert!(is_err, "{text}");

    // The correct calls still work.
    let (is_err, text) = call(
        &srv,
        "move_memory",
        json!({"path": "Plan/Index.md", "folder": "Work"}),
    );
    assert!(!is_err, "{text}");
    assert!(dir.join("vault/Work/Index.md").exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn documented_aliases_nulls_and_empty_arguments_still_work() {
    let dir = scratch("compat");
    let srv = server(&dir);

    // search_memory takes `query` as well as `q`.
    let (is_err, text) = call(&srv, "search_memory", json!({"query": "Index"}));
    assert!(!is_err, "{text}");
    let (is_err, text) = call(&srv, "search_memory", json!({"q": "Index", "limit": 3}));
    assert!(!is_err, "{text}");

    // An optional argument sent as null counts as left out.
    let (is_err, text) = call(&srv, "list_memory", json!({}));
    assert!(!is_err, "{text}");
    let (is_err, text) = call(&srv, "search_memory", json!({"q": "Index", "limit": null}));
    assert!(!is_err, "{text}");

    // A required argument sent as null is missing.
    let (is_err, text) = call(&srv, "read_memory", json!({"path": null}));
    assert!(
        is_err && text.contains("missing required argument `path`"),
        "{text}"
    );

    // No arguments at all for a tool that takes none.
    let req = RpcRequest {
        jsonrpc: Some("2.0".into()),
        id: Some(json!(1)),
        method: "tools/call".into(),
        params: json!({"name": "get_stats"}),
    };
    let r = serde_json::to_value(srv.handle_as(&req, &Caller::full("owner"))).unwrap();
    assert_eq!(r["result"]["isError"], false, "{r}");

    // get_tags with a path, search_by_tag with a limit are accepted.
    let (is_err, text) = call(&srv, "get_tags", json!({"path": "Plan/Index.md"}));
    assert!(!is_err, "{text}");
    let (is_err, text) = call(&srv, "search_by_tag", json!({"tag": "tech", "limit": 5}));
    assert!(!is_err, "{text}");

    // An unknown tool is a tool error that points at tools/list.
    let (is_err, text) = call(&srv, "no_such_tool", json!({}));
    assert!(is_err && text.contains("tools/list"), "{text}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn tag_tools_refuse_unsafe_tags_and_echo_normalized_names() {
    let dir = scratch("tags");
    let srv = server(&dir);
    let index = dir.join("vault/Plan/Index.md");
    let before = std::fs::read_to_string(&index).unwrap();
    for bad in [
        "ok\nstatus: hacked",
        "ok\n---\nbody",
        "[brack]",
        "a,b]",
        "quo\"te",
    ] {
        let (is_err, text) = call(
            &srv,
            "add_tags",
            json!({"path": "Plan/Index.md", "tags": bad}),
        );
        assert!(
            is_err && text.contains("a tag may contain only"),
            "{bad:?}: {text}"
        );
        let (is_err, _) = call(
            &srv,
            "set_tags",
            json!({"path": "Plan/Index.md", "tags": bad}),
        );
        assert!(is_err, "{bad:?}");
    }
    let (is_err, text) = call(&srv, "rename_tag", json!({"old": "tech", "new": "a,b"}));
    assert!(is_err, "{text}");
    assert_eq!(std::fs::read_to_string(&index).unwrap(), before);

    let (is_err, text) = call(&srv, "merge_tag", json!({"a": "#TECH", "b": " #project "}));
    assert!(!is_err, "{text}");
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["merged"], "TECH");
    assert_eq!(v["into"], "project");
    assert_eq!(v["renamed"], "TECH -> project");
    let (is_err, text) = call(&srv, "merge_tag", json!({"a": "nope", "b": "project"}));
    assert!(
        is_err && text.contains("tag 'nope' is not on any note"),
        "{text}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
