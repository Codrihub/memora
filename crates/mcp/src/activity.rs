//! `ai_activity` realtime events for MCP tool calls.
//!
//! Every tool call publishes two events sharing one `call_id`:
//!
//! ```json
//! {"type":"ai_activity","phase":"start","call_id":"…","actor":"my-agent","actor_kind":"agent",
//!  "actor_id":"k_1a2b3c4d","action":"read_memory","label":"Plan/Index.md","paths":["Plan/Index.md"]}
//! {"type":"ai_activity","phase":"end","call_id":"…","actor":"my-agent","actor_kind":"agent",
//!  "actor_id":"k_1a2b3c4d","action":"read_memory","label":"Plan/Index.md","paths":["Plan/Index.md"],
//!  "ok":true,"ms":3}
//! ```
//!
//! * `paths`: vault-relative note paths from the arguments (`path`, `paths`, `from`, `to`,
//!   ...) plus, when cheap, paths found in the result (search hits, the created / moved
//!   note). At most [`MAX_PATHS`], each at most [`MAX_PATH_LEN`] bytes.
//! * Read-only tools run first and then publish `start` (with the result paths) and `end`
//!   back to back; mutating tools publish `start` before running, so a UI sees the write
//!   coming, and `end` (with the result paths) after.
//! * `end` events are realtime only: the hub does not persist them to `.events.jsonl` or
//!   the replay ring (see `memora_core::events`).

use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use crate::Caller;

/// Most paths carried by one event.
pub const MAX_PATHS: usize = 20;
/// Longest path carried (bytes); longer strings are dropped, not truncated.
pub const MAX_PATH_LEN: usize = 512;
/// Longest `label` (chars).
pub const MAX_LABEL: usize = 160;
/// Longest `error` on a failed `end` event (chars).
pub const MAX_ERROR: usize = 200;

/// Tools that do not change the vault or server state: their `start` event is
/// published after the call so it can carry the result paths.
const READ_ONLY: &[&str] = &[
    "get_stats",
    "list_memory",
    "read_memory",
    "search_memory",
    "get_graph",
    "get_neighbors",
    "broken_links",
    "get_tags",
    "search_by_tag",
    "list_folders",
    "get_subgraph",
    "find_path",
    "get_hubs",
    "get_isolated",
    "link_stats",
    "query_memory",
    "find_similar",
    "suggest_links",
    "list_tags",
    "get_history",
    "get_note_at",
    "diff",
    "get_locks",
    "get_assignments",
    "get_events",
    "presence",
    "get_logs",
    "search_logs",
    "digest",
    "healthcheck",
    "folder_stats",
    "stale_detection",
    "get_folder_meta",
    "list_actors",
    "get_todos",
    "follow_ups",
    "validate_memory",
    "admin_list_tools",
    "privacy_list",
];

/// Whole-vault overviews: their results list notes the call did not really "touch",
/// so no result paths are taken from them.
const NO_RESULT_PATHS: &[&str] = &[
    "get_stats",
    "list_memory",
    "get_graph",
    "broken_links",
    "list_folders",
    "get_hubs",
    "get_isolated",
    "link_stats",
    "list_tags",
    "get_locks",
    "get_assignments",
    "get_events",
    "presence",
    "get_logs",
    "search_logs",
    "digest",
    "healthcheck",
    "folder_stats",
    "stale_detection",
    "list_actors",
    "follow_ups",
    "export_memory",
    "admin_list_tools",
    "admin_set_tool",
];

/// Whether `tool` only reads.
pub fn is_read_only(tool: &str) -> bool {
    READ_ONLY.contains(&tool)
}

/// A new id shared by the `start` and `end` events of one call.
pub fn new_call_id() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    static BOOT: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    let boot = *BOOT.get_or_init(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_micros() as u64)
            .unwrap_or(0)
    });
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    format!("c{:x}-{n:x}", boot & 0xffff_ffff_ffff)
}

/// Collects distinct paths up to [`MAX_PATHS`].
#[derive(Debug, Default, Clone)]
pub struct Paths(Vec<String>);

impl Paths {
    pub fn push(&mut self, p: &str) {
        let p = p.trim();
        if p.is_empty() || p.len() > MAX_PATH_LEN || self.full() {
            return;
        }
        if !self.0.iter().any(|x| x == p) {
            self.0.push(p.to_string());
        }
    }

    fn full(&self) -> bool {
        self.0.len() >= MAX_PATHS
    }

    pub fn as_slice(&self) -> &[String] {
        &self.0
    }
}

/// Note paths named by the tool arguments.
pub fn arg_paths(tool: &str, args: &Value) -> Paths {
    let mut out = Paths::default();
    let str_of = |k: &str| args.get(k).and_then(|v| v.as_str());
    let mut keys: Vec<&str> = vec!["path", "from", "to", "old_path", "new_path"];
    match tool {
        "find_path" => keys.extend(["source", "target"]),
        "merge_memory" => keys.push("into"),
        _ => {}
    }
    for k in keys {
        if let Some(p) = str_of(k) {
            out.push(p);
        }
    }
    if let Some(arr) = args.get("paths").and_then(|v| v.as_array()) {
        for p in arr.iter().filter_map(|v| v.as_str()) {
            out.push(p);
        }
    }
    out
}

/// Add note paths found in a tool result (bounded walk, stops once full).
pub fn add_result_paths(tool: &str, result: &Value, out: &mut Paths) {
    if NO_RESULT_PATHS.contains(&tool) {
        return;
    }
    walk(result, 0, out);
}

fn walk(v: &Value, depth: usize, out: &mut Paths) {
    if out.full() || depth > 3 {
        return;
    }
    match v {
        Value::Object(m) => {
            for k in ["path", "to", "new_path"] {
                if let Some(p) = m.get(k).and_then(|x| x.as_str()) {
                    out.push(p);
                }
            }
            if let Some(arr) = m.get("paths").and_then(|x| x.as_array()) {
                for p in arr.iter().filter_map(|x| x.as_str()) {
                    out.push(p);
                }
            }
            for (k, child) in m {
                // `content`, `frontmatter` etc. are note bodies, not references.
                if matches!(k.as_str(), "content" | "frontmatter" | "body" | "text") {
                    continue;
                }
                if child.is_object() || child.is_array() {
                    walk(child, depth + 1, out);
                }
                if out.full() {
                    return;
                }
            }
        }
        Value::Array(a) => {
            for child in a.iter().take(200) {
                if child.is_object() || child.is_array() {
                    walk(child, depth + 1, out);
                }
                if out.full() {
                    return;
                }
            }
        }
        _ => {}
    }
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut t: String = s.chars().take(max.saturating_sub(1)).collect();
        t.push('…');
        t
    }
}

/// The fields shared by both phases.
fn base(caller: &Caller, call_id: &str, tool: &str, label: &str, paths: &[String]) -> Value {
    json!({
        "type": "ai_activity",
        "call_id": call_id,
        "actor": caller.actor(),
        "actor_kind": caller.actor_kind(),
        "actor_id": caller.id,
        "action": tool,
        "label": clip(label, MAX_LABEL),
        "paths": paths,
    })
}

/// The `start` event.
pub fn start_event(
    caller: &Caller,
    call_id: &str,
    tool: &str,
    label: &str,
    paths: &[String],
) -> Value {
    let mut v = base(caller, call_id, tool, label, paths);
    v["phase"] = json!("start");
    v
}

/// The `end` event. `error` is the failure message (clipped), if any.
pub fn end_event(
    caller: &Caller,
    call_id: &str,
    tool: &str,
    label: &str,
    paths: &[String],
    ms: u64,
    error: Option<&str>,
) -> Value {
    let mut v = base(caller, call_id, tool, label, paths);
    v["phase"] = json!("end");
    v["ok"] = json!(error.is_none());
    v["ms"] = json!(ms);
    if let Some(e) = error {
        v["error"] = json!(clip(e, MAX_ERROR));
    }
    v
}

/// Run `f` as tool call `tool` by `caller`, publishing its `start` and `end` events.
pub fn traced(
    caller: &Caller,
    tool: &str,
    args: &Value,
    label: &str,
    f: impl FnOnce() -> anyhow::Result<Value>,
) -> anyhow::Result<Value> {
    let hub = memora_core::events::hub();
    let call_id = new_call_id();
    let mut paths = arg_paths(tool, args);
    let read_only = is_read_only(tool);
    if !read_only {
        hub.publish(start_event(caller, &call_id, tool, label, paths.as_slice()));
    }
    let t0 = Instant::now();
    let res = f();
    let ms = t0.elapsed().as_millis() as u64;
    if let Ok(v) = &res {
        add_result_paths(tool, v, &mut paths);
    }
    if read_only {
        hub.publish(start_event(caller, &call_id, tool, label, paths.as_slice()));
    }
    let err = res.as_ref().err().map(|e| e.to_string());
    hub.publish(end_event(
        caller,
        &call_id,
        tool,
        label,
        paths.as_slice(),
        ms,
        err.as_deref(),
    ));
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arg_paths_cover_path_fields() {
        let p = arg_paths(
            "merge_memory",
            &json!({"paths": ["A/x.md", "B/y.md", "A/x.md"], "into": "C/z.md"}),
        );
        assert_eq!(p.as_slice(), ["C/z.md", "A/x.md", "B/y.md"]);
        let p = arg_paths("find_path", &json!({"source": "a.md", "target": "b.md"}));
        assert_eq!(p.as_slice(), ["a.md", "b.md"]);
        // `into` of other tools is a folder, not a note.
        assert!(arg_paths("restore_trash", &json!({"into": "Root"}))
            .as_slice()
            .is_empty());
        let many: Vec<String> = (0..50).map(|i| format!("n{i}.md")).collect();
        assert_eq!(
            arg_paths("bulk_delete", &json!({ "paths": many }))
                .as_slice()
                .len(),
            MAX_PATHS
        );
        let long = "x".repeat(MAX_PATH_LEN + 1);
        assert!(arg_paths("read_memory", &json!({ "path": long }))
            .as_slice()
            .is_empty());
    }

    #[test]
    fn result_paths_are_bounded_and_skip_bodies() {
        let mut p = Paths::default();
        let hits: Vec<Value> = (0..40)
            .map(|i| json!({"path": format!("h{i}.md"), "content": {"path": "no.md"}}))
            .collect();
        add_result_paths("search_memory", &json!(hits), &mut p);
        assert_eq!(p.as_slice().len(), MAX_PATHS);
        assert!(!p.as_slice().iter().any(|x| x == "no.md"));
        let mut p = Paths::default();
        add_result_paths(
            "move_memory",
            &json!({"ok": true, "from": "a.md", "to": "B/a.md"}),
            &mut p,
        );
        assert_eq!(p.as_slice(), ["B/a.md"]);
        let mut p = Paths::default();
        add_result_paths("get_graph", &json!({"nodes": [{"path": "a.md"}]}), &mut p);
        assert!(p.as_slice().is_empty());
    }

    #[test]
    fn event_shapes() {
        let c = Caller::key("k_1", memora_gateway::KeyPermissions::default(), None).named("bot");
        let s = start_event(&c, "c1", "read_memory", "x.md", &["x.md".into()]);
        assert_eq!(
            s,
            json!({"type":"ai_activity","phase":"start","call_id":"c1","actor":"bot",
                   "actor_kind":"agent","actor_id":"k_1","action":"read_memory",
                   "label":"x.md","paths":["x.md"]})
        );
        let e = end_event(&c, "c1", "read_memory", "x.md", &[], 7, Some("boom"));
        assert_eq!(e["phase"], "end");
        assert_eq!(e["ok"], false);
        assert_eq!(e["ms"], 7);
        assert_eq!(e["error"], "boom");
        let u = start_event(&Caller::full("owner"), "c2", "get_stats", "", &[]);
        assert_eq!(
            (u["actor"].as_str(), u["actor_kind"].as_str()),
            (Some("owner"), Some("user"))
        );
        // Label is clipped.
        let l = start_event(&c, "c3", "search_memory", &"q".repeat(1000), &[]);
        assert_eq!(l["label"].as_str().unwrap().chars().count(), MAX_LABEL);
    }

    #[test]
    fn call_ids_are_unique() {
        let a = new_call_id();
        let b = new_call_id();
        assert_ne!(a, b);
    }
}
