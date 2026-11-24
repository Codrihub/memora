//! Kanban tools through `tools/call`: an agent lists boards, adds a card and moves it,
//! each change is one commit in the note's history and one `node_updated` event, a stale
//! `version` is refused, and the rest of the Obsidian file stays as it was.

use memora_core::MemoryStore;
use memora_mcp::{Caller, McpServer, RpcRequest};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const BOARD: &str = "---\n\nkanban-plugin: basic\n\n---\n\n## To do\n\n- [ ] Write the brief [[Atlas]] #docs\n\n\n## Doing\n\n\n\n## Done\n\n**Complete**\n\n\n\n%% kanban:settings\n```\n{\"kanban-plugin\":\"basic\",\"lane-width\":300}\n```\n%%";

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("memora-kb-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("vault/Work")).unwrap();
    std::fs::create_dir_all(dir.join("state")).unwrap();
    std::fs::write(dir.join("vault/Work/Board.md"), BOARD).unwrap();
    std::fs::write(dir.join("vault/Work/Atlas.md"), "# Atlas\n").unwrap();
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
    let r = serde_json::to_value(srv.handle_as(&req, &Caller::full("planner"))).unwrap();
    let text = r["result"]["content"][0]["text"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    (r["result"]["isError"] == true, text)
}

fn ok(srv: &McpServer, name: &str, args: Value) -> Value {
    let (e, text) = call(srv, name, args);
    assert!(!e, "{name}: {text}");
    serde_json::from_str(&text).unwrap()
}

/// The four kanban categories: one permission switch each in the tools UI.
const KANBAN_TOOLS: &[(&str, &str)] = &[
    ("kanban_list_boards", "kanban"),
    ("kanban_due", "kanban"),
    ("kanban_get_board", "kanban"),
    ("kanban_add_card", "kanban_cards"),
    ("kanban_move_card", "kanban_cards"),
    ("kanban_update_card", "kanban_cards"),
    ("kanban_card", "kanban_cards"),
    ("kanban_lane", "kanban_cards"),
    ("kanban_board", "kanban_boards"),
    ("kanban_embed", "kanban_embed"),
];

#[test]
fn kanban_tools_are_in_the_catalog() {
    let names = memora_mcp::all_tool_names();
    for (t, cat) in KANBAN_TOOLS {
        assert!(names.contains(t), "{t} missing");
        let spec = memora_mcp::catalog()
            .into_iter()
            .find(|s| s.name == *t)
            .unwrap();
        assert_eq!(spec.category, *cat, "{t}");
        assert!(!spec.description.is_empty() && !spec.when.is_empty());
        // Read tools need no scope beyond mcp; every write tool needs `write`.
        let want = if *cat == "kanban" {
            None
        } else {
            Some("write")
        };
        assert_eq!(memora_mcp::required_scope(t), want, "{t}");
    }
    // Every catalog tool is in the state database and on by default, as note tools are.
    let dir = scratch("catalog");
    let srv = server(&dir);
    let on = srv
        .db()
        .read(|c| memora_state::keys::allowed_tools(c, None))
        .unwrap();
    for (t, _) in KANBAN_TOOLS {
        assert!(on.contains(*t), "{t} is not on by default");
    }
    assert!(on.contains("create_memory"));
    // A default key lists them; a read-only key only the read tools and is refused writes.
    let rw = key(&["mcp", "read", "write"]);
    let listed = list_names(&srv, &rw);
    let ro = key(&["mcp", "read"]);
    let listed_ro = list_names(&srv, &ro);
    for (t, cat) in KANBAN_TOOLS {
        assert!(listed.contains(&t.to_string()), "{t}");
        assert_eq!(listed_ro.contains(&t.to_string()), *cat == "kanban", "{t}");
    }
    for (t, args) in [
        ("kanban_board", json!({"action": "create", "title": "X"})),
        (
            "kanban_lane",
            json!({"path": "Work/Board.md", "action": "add", "title": "X"}),
        ),
        (
            "kanban_card",
            json!({"path": "Work/Board.md", "card": "x", "action": "delete"}),
        ),
        (
            "kanban_embed",
            json!({"note": "Work/Atlas.md", "board": "Work/Board.md"}),
        ),
    ] {
        let r = rpc_as(&srv, &ro, t, args);
        assert_eq!(r["error"]["code"], -32003, "{t}: {r}");
    }
    assert_eq!(
        std::fs::read_to_string(dir.join("vault/Work/Board.md")).unwrap(),
        BOARD
    );
    let _ = std::fs::remove_dir_all(&dir);
}

fn key(scopes: &[&str]) -> Caller {
    Caller::key(
        "k_kb",
        memora_gateway::KeyPermissions {
            enabled: true,
            scopes: scopes.iter().map(|s| s.to_string()).collect(),
            tools: memora_gateway::ToolGrant::All,
        },
        Some("127.0.0.1".into()),
    )
}

fn rpc_as(srv: &McpServer, caller: &Caller, name: &str, args: Value) -> Value {
    let req = RpcRequest {
        jsonrpc: Some("2.0".into()),
        id: Some(json!(1)),
        method: "tools/call".into(),
        params: json!({"name": name, "arguments": args}),
    };
    serde_json::to_value(srv.handle_as(&req, caller)).unwrap()
}

fn list_names(srv: &McpServer, caller: &Caller) -> Vec<String> {
    let req = RpcRequest {
        jsonrpc: Some("2.0".into()),
        id: Some(json!(1)),
        method: "tools/list".into(),
        params: json!({}),
    };
    let r = serde_json::to_value(srv.handle_as(&req, caller)).unwrap();
    r["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap().to_string())
        .collect()
}

fn card_id(board: &Value, lane: usize, text_start: &str) -> String {
    board["lanes"][lane]["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["text"].as_str().unwrap().starts_with(text_start))
        .unwrap_or_else(|| panic!("no card {text_start} in {board}"))["id"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn boards_are_created_converted_renamed_moved_copied_and_deleted() {
    let dir = scratch("boards");
    let vault = dir.join("vault");
    std::fs::write(
        vault.join("Work/List.md"),
        "---\ntags: [x]\n---\n- [ ] open one\n- [x] done one\n\nA paragraph\n",
    )
    .unwrap();
    let srv = server(&dir);
    let mut events = memora_core::events::hub().subscribe();

    // create: default lanes, the last one Complete.
    let c = ok(
        &srv,
        "kanban_board",
        json!({"action": "create", "folder": "Work", "title": "Sprint"}),
    );
    assert_eq!(c["path"], "Work/Sprint.md");
    let titles: Vec<&str> = c["lanes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["title"].as_str().unwrap())
        .collect();
    assert_eq!(titles, ["To do", "Doing", "Done"]);
    assert_eq!(c["lanes"][2]["complete"], true);
    let c2 = ok(
        &srv,
        "kanban_board",
        json!({"action": "create", "folder": "Work", "title": "Roadmap", "lanes": ["Now", "Next", "Later", "Never"]}),
    );
    assert_eq!(c2["counts"]["lanes"], 4);
    let (e, text) = call(
        &srv,
        "kanban_board",
        json!({"action": "create", "folder": "Work", "title": "Sprint"}),
    );
    assert!(e && text.contains("already exists"), "{text}");

    // convert: the old text stays in history, other text is counted.
    let v = ok(
        &srv,
        "kanban_board",
        json!({"action": "convert", "path": "Work/List", "lanes": ["Offen", "Dabei", "Fertig"]}),
    );
    assert_eq!(
        v["converted"],
        json!({"lanes": 3, "cards": 2, "dropped": 1})
    );
    assert_eq!(v["lanes"][0]["title"], "Offen");
    assert_eq!(v["lanes"][2]["cards"][0]["text"], "done one");
    let on_disk = std::fs::read_to_string(vault.join("Work/List.md")).unwrap();
    assert!(on_disk.starts_with("---\n\ntags: [x]\nkanban-plugin: basic\n\n---\n\n## Offen\n"));
    let (e, text) = call(
        &srv,
        "kanban_board",
        json!({"action": "convert", "path": "Work/List"}),
    );
    assert!(e && text.contains("already a Kanban board"), "{text}");

    // style, tag colors and settings round trip.
    let v = ok(
        &srv,
        "kanban_board",
        json!({"action": "style", "path": "Work/Sprint", "color": "#0ea5e9", "icon": "🚀"}),
    );
    assert_eq!(v["style"], json!({"color": "#0ea5e9", "icon": "🚀"}));
    let v = ok(
        &srv,
        "kanban_board",
        json!({"action": "tag_color", "path": "Work/Sprint", "tag": "#urgent", "color": "#fff", "background": "#dc2626", "version": v["version"]}),
    );
    assert_eq!(
        v["tag_colors"]["urgent"],
        json!({"color": "#fff", "background": "#dc2626"})
    );
    let v = ok(
        &srv,
        "kanban_board",
        json!({"action": "settings", "path": "Work/Sprint", "settings": {"lane-width": 320, "date-colors": [{"isToday": true, "backgroundColor": "#fde68a"}], "show-checkboxes": true}}),
    );
    assert_eq!(v["settings"]["lane-width"], 320);
    assert_eq!(v["settings"]["date-colors"][0]["isToday"], true);
    let (e, text) = call(
        &srv,
        "kanban_board",
        json!({"action": "settings", "path": "Work/Sprint", "settings": {"memora": {}}}),
    );
    assert!(e && text.contains("not a board setting"), "{text}");
    let (e, text) = call(
        &srv,
        "kanban_board",
        json!({"action": "style", "path": "Work/Sprint", "color": "#000", "version": "000000000000"}),
    );
    assert!(e && text.contains("board changed"), "{text}");
    ok(
        &srv,
        "kanban_board",
        json!({"action": "style", "path": "Work/Sprint", "color": null, "icon": null}),
    );
    ok(
        &srv,
        "kanban_board",
        json!({"action": "tag_color", "path": "Work/Sprint", "tag": "urgent", "color": null}),
    );
    let v = ok(
        &srv,
        "kanban_board",
        json!({"action": "settings", "path": "Work/Sprint", "settings": {"lane-width": null, "date-colors": null, "show-checkboxes": null}}),
    );
    assert_eq!(v["settings"], json!({"kanban-plugin": "basic"}));
    assert_eq!(
        std::fs::read_to_string(vault.join("Work/Sprint.md")).unwrap(),
        memora_core::vault::kanban::default_board(
            &memora_core::vault::kanban::default_lanes(None).unwrap()
        )
    );

    // rename, move, duplicate, delete: like the note tools.
    std::fs::write(vault.join("Work/Home.md"), "# Home\n\n![[Sprint]]\n").unwrap();
    let v = ok(
        &srv,
        "kanban_board",
        json!({"action": "rename", "path": "Work/Sprint", "to": "Sprint 2"}),
    );
    assert_eq!(v["path"], "Work/Sprint 2.md");
    assert_eq!(
        std::fs::read_to_string(vault.join("Work/Home.md")).unwrap(),
        "# Home\n\n![[Sprint 2]]\n"
    );
    let v = ok(
        &srv,
        "kanban_board",
        json!({"action": "move", "path": "Work/Sprint 2", "to": "Archive"}),
    );
    assert_eq!(v["to"], "Archive/Sprint 2.md");
    let v = ok(
        &srv,
        "kanban_board",
        json!({"action": "duplicate", "path": "Archive/Sprint 2"}),
    );
    assert_eq!(v["path"], "Archive/Sprint 2-copy.md");
    let v = ok(
        &srv,
        "kanban_board",
        json!({"action": "delete", "path": "Archive/Sprint 2-copy"}),
    );
    assert_eq!(v["trashed"], true);
    assert!(!vault.join("Archive/Sprint 2-copy.md").exists());
    // Notes that are not boards are refused by the board actions.
    for action in ["rename", "move", "duplicate", "delete", "style"] {
        let (e, text) = call(
            &srv,
            "kanban_board",
            json!({"action": action, "path": "Work/Atlas", "to": "X", "color": "red"}),
        );
        assert!(e && text.contains("not a Kanban board"), "{action}: {text}");
    }
    let mut seen = std::collections::BTreeSet::new();
    while let Ok(ev) = events.try_recv() {
        let v: Value = serde_json::from_str(&ev).unwrap();
        if v["actor"] == "planner" {
            seen.insert(v["type"].as_str().unwrap_or("").to_string());
        }
    }
    for t in [
        "node_created",
        "node_updated",
        "node_renamed",
        "node_deleted",
    ] {
        assert!(seen.contains(t), "no {t} event: {seen:?}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn lanes_and_cards_with_fields_checklists_and_colors() {
    let dir = scratch("lanes");
    let vault = dir.join("vault");
    let srv = server(&dir);
    let p = "Work/Board.md";

    // Lanes: add, rename, duplicate, color, limit, archive_cards, clear, delete.
    let v = ok(
        &srv,
        "kanban_lane",
        json!({"path": p, "action": "add", "title": "Review", "position": 1}),
    );
    assert_eq!(v["lanes"][1]["title"], "Review");
    let v = ok(
        &srv,
        "kanban_lane",
        json!({"path": p, "action": "rename", "lane": "Review", "title": "QA", "version": v["version"]}),
    );
    assert_eq!(v["lanes"][1]["title"], "QA");
    ok(
        &srv,
        "kanban_lane",
        json!({"path": p, "action": "move", "lane": "QA", "position": 3}),
    );
    let v = ok(
        &srv,
        "kanban_lane",
        json!({"path": p, "action": "color", "lane": "To do", "color": "#22c55e"}),
    );
    assert_eq!(v["lanes"][0]["color"], "#22c55e");
    let v = ok(
        &srv,
        "kanban_lane",
        json!({"path": p, "action": "limit", "lane": "To do", "max": 3}),
    );
    assert_eq!(v["lanes"][0]["max_items"], 3);
    let v = ok(
        &srv,
        "kanban_lane",
        json!({"path": p, "action": "duplicate", "lane": "To do", "title": "To do 2"}),
    );
    assert_eq!(v["lanes"][1]["title"], "To do 2");
    assert_eq!(v["lanes"][1]["color"], "#22c55e");
    assert_eq!(v["lanes"][1]["max_items"], 3);
    assert_eq!(v["lanes"][1]["cards"][0]["links"], json!(["Atlas"]));
    let v = ok(
        &srv,
        "kanban_lane",
        json!({"path": p, "action": "archive_cards", "lane": "To do 2"}),
    );
    assert_eq!(v["counts"]["archived"], 1);
    assert_eq!(v["lanes"][1]["cards"].as_array().unwrap().len(), 0);
    ok(
        &srv,
        "kanban_lane",
        json!({"path": p, "action": "delete", "lane": "To do 2"}),
    );
    let (e, text) = call(
        &srv,
        "kanban_lane",
        json!({"path": p, "action": "limit", "lane": "To do"}),
    );
    assert!(e && text.contains("max is required"), "{text}");

    // Cards with structured fields, a checklist and a color.
    let v = ok(
        &srv,
        "kanban_add_card",
        json!({"path": p, "lane": "Doing", "text": "Ship the release", "links": ["Atlas"], "tags": ["release"],
               "date": "2026-12-01", "time": "09:30", "checklist": [{"text": "changelog", "done": true}, {"text": "tag"}], "color": "#f59e0b"}),
    );
    let card = v["card"].as_str().unwrap().to_string();
    let c = &v["lanes"][1]["cards"][0];
    assert_eq!(c["id"], json!(card));
    assert_eq!(
        c["fields"],
        json!({"text": "Ship the release", "links": ["Atlas"], "tags": ["release"], "date": "2026-12-01", "time": "09:30"})
    );
    assert_eq!(
        c["checklist"],
        json!([{"text": "changelog", "done": true}, {"text": "tag", "done": false}])
    );
    assert_eq!(c["color"], "#f59e0b");
    let block = c["block"].as_str().unwrap().to_string();
    let on_disk = std::fs::read_to_string(vault.join(p)).unwrap();
    assert!(on_disk.contains(&format!(
        "- [ ] Ship the release [[Atlas]] #release @{{2026-12-01}} @@{{09:30}} ^{block}\n\t- [x] changelog\n\t- [ ] tag\n"
    )), "{on_disk}");
    // Colours under Memora's own key (next to where archived cards came from).
    assert!(on_disk.contains("\"memora\":{"), "{on_disk}");
    assert!(
        on_disk.contains(&format!("\"cards\":{{\"{block}\":\"#f59e0b\"}}")),
        "{on_disk}"
    );

    // update_card: fields over the current text; untouched parts stay.
    let v = ok(
        &srv,
        "kanban_update_card",
        json!({"path": p, "card": card, "text": "Ship 1.0", "date": "", "checklist": [{"text": "changelog", "done": true}, {"text": "tag", "done": true}, {"text": "announce"}]}),
    );
    let card = v["card"].as_str().unwrap().to_string();
    let c = &v["lanes"][1]["cards"][0];
    assert_eq!(c["fields"]["text"], "Ship 1.0");
    assert_eq!(c["fields"]["date"], "");
    assert_eq!(c["fields"]["links"], json!(["Atlas"]));
    assert_eq!(
        c["checklist"][2],
        json!({"text": "announce", "done": false})
    );
    assert_eq!(c["color"], "#f59e0b");
    let v = ok(
        &srv,
        "kanban_update_card",
        json!({"path": p, "card": card, "color": null, "checked": true}),
    );
    let card = v["card"].as_str().unwrap().to_string();
    assert_eq!(v["lanes"][1]["cards"][0]["color"], Value::Null);
    assert_eq!(v["lanes"][1]["cards"][0]["checked"], true);
    let (e, text) = call(
        &srv,
        "kanban_update_card",
        json!({"path": p, "card": card, "date": "1 Dec"}),
    );
    assert!(e && text.contains("YYYY-MM-DD"), "{text}");

    // kanban_card: duplicate, delete, restore.
    let v = ok(
        &srv,
        "kanban_card",
        json!({"path": p, "card": card, "action": "duplicate"}),
    );
    let copy = v["card"].as_str().unwrap().to_string();
    assert_eq!(v["lanes"][1]["cards"].as_array().unwrap().len(), 2);
    assert_eq!(v["lanes"][1]["cards"][1]["id"], json!(copy));
    let v = ok(
        &srv,
        "kanban_card",
        json!({"path": p, "card": copy, "action": "delete"}),
    );
    assert_eq!(v["lanes"][1]["cards"].as_array().unwrap().len(), 1);
    let archived = v["archive"][0]["id"].as_str().unwrap().to_string();
    let v = ok(
        &srv,
        "kanban_card",
        json!({"path": p, "card": archived, "action": "restore", "lane": "Doing"}),
    );
    assert_eq!(v["counts"]["archived"], 0);
    assert_eq!(v["lanes"][1]["cards"].as_array().unwrap().len(), 2);
    let id = card_id(&v, 1, "Write the brief");
    let v = ok(
        &srv,
        "kanban_lane",
        json!({"path": p, "action": "clear", "lane": "Doing"}),
    );
    assert_eq!(v["lanes"][1]["cards"].as_array().unwrap().len(), 0);
    let (e, _) = call(
        &srv,
        "kanban_card",
        json!({"path": p, "card": id, "action": "delete"}),
    );
    assert!(e, "the card went with the lane");
    // The settings the board started with are still there.
    let on_disk = std::fs::read_to_string(vault.join(p)).unwrap();
    assert!(
        on_disk.contains("{\"kanban-plugin\":\"basic\",\"lane-width\":300"),
        "{on_disk}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn boards_are_embedded_in_notes() {
    let dir = scratch("embed");
    let vault = dir.join("vault");
    std::fs::create_dir_all(vault.join("Other")).unwrap();
    std::fs::write(vault.join("Other/Board.md"), BOARD).unwrap();
    std::fs::write(vault.join("Work/Plan.md"), "# Plan\n\nSome text\n").unwrap();
    let srv = server(&dir);
    let v = ok(
        &srv,
        "kanban_embed",
        json!({"note": "Work/Plan", "board": "Work/Board"}),
    );
    assert_eq!(v["link"], "![[Board]]");
    assert_eq!(v["changed"], true);
    // Two notes named Board: the other one is linked by its path.
    let v = ok(
        &srv,
        "kanban_embed",
        json!({"note": "Work/Plan", "board": "Other/Board.md"}),
    );
    assert_eq!(v["link"], "![[Other/Board]]");
    assert_eq!(
        std::fs::read_to_string(vault.join("Work/Plan.md")).unwrap(),
        "# Plan\n\nSome text\n\n![[Board]]\n\n![[Other/Board]]\n"
    );
    let v = ok(
        &srv,
        "kanban_embed",
        json!({"note": "Work/Plan", "board": "Work/Board"}),
    );
    assert_eq!(v["already"], true);
    ok(
        &srv,
        "kanban_embed",
        json!({"note": "Work/Plan", "board": "Other/Board", "remove": true}),
    );
    let v = ok(
        &srv,
        "kanban_embed",
        json!({"note": "Work/Plan", "board": "Work/Board", "remove": true}),
    );
    assert_eq!(v["removed"], 1);
    assert_eq!(
        std::fs::read_to_string(vault.join("Work/Plan.md")).unwrap(),
        "# Plan\n\nSome text\n"
    );
    for (args, want) in [
        (
            json!({"note": "Work/Plan", "board": "Work/Atlas"}),
            "not a Kanban board",
        ),
        (
            json!({"note": "Work/Board", "board": "Work/Board"}),
            "cannot embed itself",
        ),
        (
            json!({"note": "Other/Board", "board": "Work/Board"}),
            "is a board",
        ),
    ] {
        let (e, text) = call(&srv, "kanban_embed", args.clone());
        assert!(e && text.contains(want), "{args}: {text}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn private_boards_and_locked_notes_are_refused() {
    let dir = scratch("privacy");
    let vault = dir.join("vault");
    std::fs::create_dir_all(vault.join("Secret")).unwrap();
    std::fs::write(vault.join("Secret/Hidden.md"), BOARD).unwrap();
    let srv = server(&dir);
    srv.db()
        .write(|tx| {
            for id in ["k_kb", "k_other"] {
                memora_state::keys::create(
                    tx,
                    &memora_state::keys::NewApiKey {
                        id: id.into(),
                        name: id.into(),
                        hash: format!("{:064x}", id.len() + id.as_bytes()[2] as usize),
                        prefix: format!("mem_{}", &id[2..4]),
                        scopes: memora_state::keys::Scope::default_set(),
                        tools: memora_state::keys::ToolGrant::All,
                    },
                    1,
                )?;
            }
            memora_state::privacy::set(
                tx,
                memora_state::privacy::Kind::Folder,
                "Secret",
                memora_state::privacy::Mode::Deny,
                &["k_kb".to_string()].into(),
                1,
            )?;
            Ok(())
        })
        .unwrap();
    let me = key(&["mcp", "read", "write"]);
    let text = |r: &Value| {
        r["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or("")
            .to_string()
    };
    let r = rpc_as(&srv, &me, "kanban_list_boards", json!({}));
    assert!(!text(&r).contains("Secret"), "{r}");
    let r = rpc_as(
        &srv,
        &me,
        "kanban_due",
        json!({"today": "2000-01-01", "days": 366}),
    );
    assert!(!text(&r).contains("Secret"), "{r}");
    for (t, args) in [
        ("kanban_get_board", json!({"path": "Secret/Hidden"})),
        (
            "kanban_lane",
            json!({"path": "Secret/Hidden.md", "action": "add", "title": "X"}),
        ),
        (
            "kanban_board",
            json!({"action": "rename", "path": "Secret/Hidden", "to": "Y"}),
        ),
        (
            "kanban_board",
            json!({"action": "create", "folder": "Secret", "title": "New"}),
        ),
        (
            "kanban_embed",
            json!({"note": "Work/Atlas", "board": "Secret/Hidden"}),
        ),
    ] {
        let r = rpc_as(&srv, &me, t, args);
        assert_eq!(r["result"]["isError"], true, "{t}: {r}");
        assert!(!text(&r).contains("is not a Kanban board"), "{t}: {r}");
    }
    assert!(!vault.join("Secret/New.md").exists());
    assert_eq!(
        std::fs::read_to_string(vault.join("Secret/Hidden.md")).unwrap(),
        BOARD
    );
    assert!(std::fs::read_to_string(vault.join("Work/Atlas.md")).unwrap() == "# Atlas\n");

    // A note another agent locked is not changed by an embed.
    let other = Caller::key(
        "k_other",
        memora_gateway::KeyPermissions {
            enabled: true,
            scopes: vec!["mcp".into(), "read".into(), "write".into()],
            tools: memora_gateway::ToolGrant::All,
        },
        None,
    );
    let r = rpc_as(&srv, &other, "lock_node", json!({"path": "Work/Atlas.md"}));
    assert_eq!(r["result"]["isError"], false, "{r}");
    let r = rpc_as(
        &srv,
        &me,
        "kanban_embed",
        json!({"note": "Work/Atlas.md", "board": "Work/Board"}),
    );
    assert_eq!(r["result"]["isError"], true, "{r}");
    assert!(text(&r).contains("locked"), "{r}");
    let r = rpc_as(
        &srv,
        &me,
        "kanban_lane",
        json!({"path": "Work/Board.md", "action": "add", "title": "Z"}),
    );
    assert_eq!(r["result"]["isError"], false, "{r}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn agent_adds_and_moves_a_card() {
    let dir = scratch("flow");
    let vault = dir.join("vault");
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .args(args)
            .current_dir(&vault)
            .output()
            .unwrap()
    };
    let history = git(&["init", "-q"]).status.success();
    if history {
        git(&[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.com",
            "add",
            "-A",
        ]);
        git(&[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.com",
            "commit",
            "-qm",
            "init",
        ]);
    }
    let srv = server(&dir);
    let mut events = memora_core::events::hub().subscribe();

    let list = ok(&srv, "kanban_list_boards", json!({}));
    assert_eq!(list["count"], 1, "{list}");
    assert_eq!(list["boards"][0]["path"], "Work/Board.md");
    assert_eq!(list["boards"][0]["lanes"][0]["title"], "To do");

    let b = ok(&srv, "kanban_get_board", json!({"path": "Work/Board"}));
    let v0 = b["version"].as_str().unwrap().to_string();
    assert_eq!(b["lanes"][0]["cards"][0]["links"], json!(["Atlas"]));

    let added = ok(
        &srv,
        "kanban_add_card",
        json!({"path": "Work/Board.md", "lane": "to do", "text": "Review the plan @{2026-12-01}", "version": v0}),
    );
    // The card is due: kanban_due finds it with its board, lane and id.
    let due = ok(
        &srv,
        "kanban_due",
        json!({"today": "2026-11-28", "range": "upcoming"}),
    );
    assert_eq!(
        due["counts"],
        json!({"overdue": 0, "today": 0, "upcoming": 1}),
        "{due}"
    );
    assert_eq!(due["upcoming"][0]["board"], "Work/Board.md");
    assert_eq!(due["upcoming"][0]["lane"], "To do");
    assert_eq!(due["upcoming"][0]["date"], "2026-12-01");
    let late = ok(&srv, "kanban_due", json!({"today": "2026-12-05"}));
    assert_eq!(late["counts"]["overdue"], 1, "{late}");
    let card = added["card"].as_str().unwrap().to_string();
    assert_eq!(added["lanes"][0]["cards"][1]["id"], json!(card));
    let v1 = added["version"].as_str().unwrap().to_string();

    // The old version is stale now: nothing is written.
    let (e, text) = call(
        &srv,
        "kanban_move_card",
        json!({"path": "Work/Board.md", "card": card, "lane": "Doing", "version": v0}),
    );
    assert!(e && text.contains("board changed"), "{text}");

    let moved = ok(
        &srv,
        "kanban_move_card",
        json!({"path": "Work/Board.md", "card": card, "lane": "1", "version": v1}),
    );
    assert_eq!(
        moved["lanes"][1]["cards"][0]["text"],
        "Review the plan @{2026-12-01}"
    );
    assert_eq!(moved["card"], json!(card));

    let done = ok(
        &srv,
        "kanban_move_card",
        json!({"path": "Work/Board.md", "card": card, "lane": "Done"}),
    );
    assert_eq!(done["lanes"][2]["cards"][0]["checked"], true);

    let archived = ok(
        &srv,
        "kanban_update_card",
        json!({"path": "Work/Board.md", "card": card, "archived": true}),
    );
    assert_eq!(archived["counts"]["archived"], 1);
    let (e, _) = call(
        &srv,
        "kanban_update_card",
        json!({"path": "Work/Board.md", "card": card, "archived": true, "text": "x"}),
    );
    assert!(e);

    let on_disk = std::fs::read_to_string(vault.join("Work/Board.md")).unwrap();
    assert!(
        on_disk.contains("## Archive\n\n- [x] Review the plan @{2026-12-01}\n\n\n%% kanban:settings\n```\n{\"kanban-plugin\":\"basic\",\"lane-width\":300,\"memora\":{\"archived\":{"),
        "{on_disk}"
    );
    // The archive says which lane the card left.
    let read = ok(&srv, "kanban_get_board", json!({"path": "Work/Board.md"}));
    assert!(read["archive"][0]["archived_from"].is_string(), "{read}");
    assert!(on_disk.starts_with(
        "---\n\nkanban-plugin: basic\n\n---\n\n## To do\n\n- [ ] Write the brief [[Atlas]] #docs\n"
    ));

    // Every change told open browsers which note changed, and who changed it. The event hub is
    // shared by every test in this binary, so events from tests running alongside are skipped.
    let mut updates = 0;
    while let Ok(ev) = events.try_recv() {
        let v: Value = serde_json::from_str(&ev).unwrap();
        if v["type"] == "node_updated"
            && v["node"]["path"] == "Work/Board.md"
            && v["actor"] == "planner"
        {
            updates += 1;
        }
    }
    assert!(updates >= 4, "{updates} node_updated events");

    if history {
        let h = ok(&srv, "get_history", json!({"path": "Work/Board.md"}));
        let msgs: Vec<&str> = h
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["message"].as_str().unwrap_or(""))
            .collect();
        assert!(
            msgs.iter()
                .any(|m| m.starts_with("kanban: move card to Doing")),
            "{msgs:?}"
        );
        assert!(
            msgs.iter()
                .any(|m| m.starts_with("kanban: add card to To do")),
            "{msgs:?}"
        );
        assert_eq!(h[0]["author"], "planner", "{h}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn notes_that_are_not_boards_are_refused() {
    let dir = scratch("plain");
    let srv = server(&dir);
    let (e, text) = call(&srv, "kanban_get_board", json!({"path": "Work/Atlas.md"}));
    assert!(e && text.contains("not a Kanban board"), "{text}");
    let (e, _) = call(
        &srv,
        "kanban_add_card",
        json!({"path": "Work/Atlas.md", "lane": "0", "text": "x"}),
    );
    assert!(e);
    assert_eq!(
        std::fs::read_to_string(dir.join("vault/Work/Atlas.md")).unwrap(),
        "# Atlas\n"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
