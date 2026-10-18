//! `tools`: the remaining MCP tools, mapping onto `memora_core` vault operations.
//!
//! Kept separate from `lib.rs` so the base catalog stays readable. Every tool
//! here calls a `*_impl` helper in `crates/core/src/vault.rs`, so it behaves
//! exactly like the UI and HTTP surfaces.

use crate::ToolSpec;
use memora_core::MemoryStore;
use serde_json::{json, Map, Value};
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

fn spec(
    name: &'static str,
    category: &'static str,
    description: &'static str,
    when: &'static str,
    props: Value,
    required: &[&str],
) -> ToolSpec {
    ToolSpec {
        name,
        category,
        description,
        when,
        input_schema: json!({"type":"object","properties":props,"required":required}),
    }
}

pub fn extra_specs() -> Vec<ToolSpec> {
    vec![
        // ---- graph ----
        spec(
            "get_subgraph",
            "graph",
            "Subgraph around one note up to `depth` hops, capped at `max_nodes`.",
            "To see local context without pulling the whole graph.",
            json!({"path":{"type":"string"},"depth":{"type":"integer","default":1},"max_nodes":{"type":"integer","default":60}}),
            &["path"],
        ),
        spec(
            "find_path",
            "graph",
            "Shortest wikilink path between two notes.",
            "To learn how two topics connect.",
            json!({"source":{"type":"string"},"target":{"type":"string"}}),
            &["source", "target"],
        ),
        spec(
            "get_hubs",
            "graph",
            "Most connected notes, the vault hubs.",
            "To find the most central notes in the vault.",
            json!({"limit":{"type":"integer","default":10}}),
            &[],
        ),
        spec(
            "get_isolated",
            "graph",
            "Notes with no incoming or outgoing links.",
            "Candidates to tidy up or connect.",
            json!({}),
            &[],
        ),
        spec(
            "link_stats",
            "graph",
            "Link degree of one note: outgoing, incoming, and unresolved targets.",
            "Before cleaning up the links of a note.",
            json!({"path":{"type":"string"}}),
            &["path"],
        ),
        // ---- query ----
        spec(
            "query_memory",
            "query",
            "Filter notes by frontmatter: folder, tag, author, type, status.",
            "When you need a metadata-based list rather than a full-text search.",
            json!({"folder":{"type":"string"},"tags":{"type":"string"},"author":{"type":"string"},"type":{"type":"string"},"status":{"type":"string"},"limit":{"type":"integer","default":50}}),
            &[],
        ),
        spec(
            "find_similar",
            "query",
            "Notes most similar to a given note (shared tags and words).",
            "For deduplication or finding notes worth merging.",
            json!({"path":{"type":"string"},"limit":{"type":"integer","default":8}}),
            &["path"],
        ),
        spec(
            "suggest_links",
            "query",
            "Similar notes that are NOT yet linked from this one.",
            "To add useful wikilinks.",
            json!({"path":{"type":"string"},"limit":{"type":"integer","default":8}}),
            &["path"],
        ),
        spec(
            "list_tags",
            "query",
            "Every tag in the vault with its usage count.",
            "For taxonomy navigation or tag audits.",
            json!({}),
            &[],
        ),
        spec(
            "rename_tag",
            "query",
            "Rename a tag across the whole vault.",
            "When consolidating duplicate or misspelled tags.",
            json!({"old":{"type":"string"},"new":{"type":"string"}}),
            &["old", "new"],
        ),
        spec(
            "merge_tag",
            "query",
            "Merge tag `a` into tag `b` across every note (dedup).",
            "To tidy up synonymous tags.",
            json!({"a":{"type":"string"},"b":{"type":"string"}}),
            &["a", "b"],
        ),
        // ---- tags per note ----
        spec(
            "add_tags",
            "tag",
            "Add one or more tags to a note's frontmatter.",
            "To make a note discoverable by tag.",
            json!({"path":{"type":"string"},"tags":{"type":"string","description":"Comma-separated"}}),
            &["path", "tags"],
        ),
        spec(
            "remove_tags",
            "tag",
            "Remove tags from a note's frontmatter.",
            "To clear tags that no longer apply.",
            json!({"path":{"type":"string"},"tags":{"type":"string"}}),
            &["path", "tags"],
        ),
        spec(
            "set_tags",
            "tag",
            "Replace a note's entire tag list.",
            "When you want to set tags explicitly rather than add to them.",
            json!({"path":{"type":"string"},"tags":{"type":"string"}}),
            &["path", "tags"],
        ),
        // ---- versioning ----
        spec(
            "get_history",
            "version",
            "Git revision history of a note.",
            "Before restoring or comparing an older version.",
            json!({"path":{"type":"string"},"limit":{"type":"integer","default":20}}),
            &["path"],
        ),
        spec(
            "get_note_at",
            "version",
            "Read a note as it was at a specific revision.",
            "To see what the note looked like previously.",
            json!({"path":{"type":"string"},"rev":{"type":"string"}}),
            &["path", "rev"],
        ),
        spec(
            "diff",
            "version",
            "Diff a note between two revisions (or a revision against the working tree).",
            "To see what changed before restoring.",
            json!({"path":{"type":"string"},"rev_a":{"type":"string"},"rev_b":{"type":"string"}}),
            &["path", "rev_a"],
        ),
        spec(
            "restore_memory",
            "version",
            "Restore a note to an older revision.",
            "To undo an unwanted change.",
            json!({"path":{"type":"string"},"rev":{"type":"string"}}),
            &["path", "rev"],
        ),
        spec(
            "snapshot",
            "version",
            "Tag the whole vault at a point in time (git tag).",
            "Before a large or risky change.",
            json!({"label":{"type":"string"}}),
            &["label"],
        ),
        spec(
            "soft_delete",
            "version",
            "Move a note to .Trash (still recoverable).",
            "When you are not ready to delete permanently.",
            json!({"path":{"type":"string"}}),
            &["path"],
        ),
        spec(
            "restore_trash",
            "version",
            "Restore a note from .Trash into a folder.",
            "To bring back a note deleted by mistake.",
            json!({"name":{"type":"string"},"into":{"type":"string","default":"Root"}}),
            &["name"],
        ),
        // ---- write ----
        spec(
            "batch_create",
            "write",
            "Create many notes in one call.",
            "For migrations or bulk imports.",
            json!({"notes":{"type":"array","items":{"type":"object"}}}),
            &["notes"],
        ),
        spec(
            "duplicate_memory",
            "write",
            "Duplicate a note as '<name>-copy' in the same folder.",
            "To use a note as the starting point for a new one.",
            json!({"path":{"type":"string"}}),
            &["path"],
        ),
        spec(
            "merge_memory",
            "write",
            "Merge several notes into one target note.",
            "To consolidate notes whose content is scattered.",
            json!({"paths":{"type":"array","items":{"type":"string"}},"into":{"type":"string"}}),
            &["paths", "into"],
        ),
        spec(
            "template_create",
            "write",
            "Create a note from a file in Templates/ with {{var}} substitution.",
            "So new notes match the folder's format.",
            json!({"template":{"type":"string"},"title":{"type":"string"},"folder":{"type":"string","default":"Root"},"variables":{"type":"object"}}),
            &["template", "title"],
        ),
        spec(
            "bulk_replace",
            "write",
            "Find and replace across many notes; supports regex and dry-run.",
            "For safe bulk text edits (dry-run first).",
            json!({"find":{"type":"string"},"replace":{"type":"string"},"folder":{"type":"string"},"regex":{"type":"boolean","default":false},"dry_run":{"type":"boolean","default":false}}),
            &["find", "replace"],
        ),
        spec(
            "bulk_delete",
            "write",
            "Delete many notes at once, by path list or folder.",
            "To clear a batch of notes in a single step.",
            json!({"paths":{"type":"array","items":{"type":"string"}},"folder":{"type":"string"}}),
            &[],
        ),
        // ---- collab ----
        spec(
            "lock_node",
            "collab",
            "Take a soft lock on a note so other agents do not overwrite it.",
            "Before editing a note another agent may be using.",
            json!({"path":{"type":"string"},"owner":{"type":"string"},"ttl":{"type":"integer","default":300}}),
            &["path"],
        ),
        spec(
            "release_lock",
            "collab",
            "Release a note lock you hold.",
            "After you finish editing.",
            json!({"path":{"type":"string"},"owner":{"type":"string"}}),
            &["path"],
        ),
        spec(
            "get_locks",
            "collab",
            "Notes that currently hold an active lock.",
            "Before writing, to see which notes are taken.",
            json!({}),
            &[],
        ),
        spec(
            "mention_agent",
            "collab",
            "Ping another agent with '> @agent: message' inside a note.",
            "To hand off a task through the vault instead of chat.",
            json!({"agent":{"type":"string"},"path":{"type":"string"},"message":{"type":"string"}}),
            &["agent", "path"],
        ),
        spec(
            "get_assignments",
            "collab",
            "Notes whose frontmatter has `assigned_to`.",
            "To see each agent's workload.",
            json!({"agent":{"type":"string"}}),
            &[],
        ),
        // ---- events / ops ----
        spec(
            "get_events",
            "ops",
            "Recent activity: notes created, updated, or deleted.",
            "To see what just happened in the vault.",
            json!({"since":{"type":"number"},"folder":{"type":"string"},"actor":{"type":"string"},"limit":{"type":"integer","default":50}}),
            &[],
        ),
        spec(
            "presence",
            "ops",
            "Agents active within the last `window` seconds.",
            "To see who is working right now.",
            json!({"window":{"type":"integer","default":300}}),
            &[],
        ),
        spec(
            "get_logs",
            "ops",
            "Vault activity log over a time range (1d, 7d, today, yesterday).",
            "To audit what happened during a period.",
            json!({"range":{"type":"string","default":"1d"},"actor":{"type":"string"},"limit":{"type":"integer","default":100}}),
            &[],
        ),
        spec(
            "search_logs",
            "ops",
            "Search the activity log by keyword.",
            "When you need a specific trace, such as a note or an action.",
            json!({"q":{"type":"string"},"range":{"type":"string","default":"7d"},"actor":{"type":"string"},"limit":{"type":"integer","default":100}}),
            &["q"],
        ),
        spec(
            "digest",
            "ops",
            "Activity summary: event counts per actor and per type.",
            "For a daily report or a handover between agents.",
            json!({"folder":{"type":"string"},"since":{"type":"number"}}),
            &[],
        ),
        spec(
            "healthcheck",
            "ops",
            "Vault health: note count, broken links, orphans, git status.",
            "As a routine check before and after work.",
            json!({}),
            &[],
        ),
        spec(
            "folder_stats",
            "ops",
            "Note count and metadata for one folder.",
            "To inspect a folder before adding notes to it.",
            json!({"folder":{"type":"string"}}),
            &["folder"],
        ),
        spec(
            "stale_detection",
            "ops",
            "Notes untouched for more than `days` days.",
            "Candidates for archiving or review.",
            json!({"days":{"type":"integer","default":30}}),
            &[],
        ),
        spec(
            "set_folder_meta",
            "ops",
            "Set a folder's color, icon, and description.",
            "To control how the folder appears in the UI.",
            json!({"folder":{"type":"string"},"color":{"type":"string","description":"Hex color such as #22c55e."},"icon":{"type":"string","description":"One emoji, or an icon name: star, book, code, brain, flask, briefcase, archive, inbox, user, users, calendar, bulb, heart, credit-card, wallet, cpu, key, lock, shield, server, database, terminal, cloud, globe, home, settings, tag, mail, chart, dollar, cart, rocket, wrench, image, music, map, school, file."},"desc":{"type":"string"}}),
            &["folder"],
        ),
        spec(
            "get_folder_meta",
            "ops",
            "Folder metadata (color/icon/description); no argument returns every folder.",
            "To build the folder display in the UI.",
            json!({"folder":{"type":"string"}}),
            &[],
        ),
        // ---- identity ----
        spec(
            "set_my_name",
            "identity",
            "Change your display alias without changing your actor id.",
            "So your activity trace is easy for humans to read.",
            json!({"name":{"type":"string"}}),
            &["name"],
        ),
        spec(
            "set_my_color",
            "identity",
            "Set your display color (#rrggbb) in Memora; empty resets it. Only for API keys.",
            "So people can tell you apart from other agents, even ones with the same name.",
            json!({"color":{"type":"string","description":"Hex color like #f59e0b, or '' to reset"}}),
            &["color"],
        ),
        spec(
            "list_actors",
            "identity",
            "Every known actor and its alias.",
            "To inspect the registered identities.",
            json!({}),
            &[],
        ),
        // ---- interop ----
        spec(
            "export_memory",
            "interop",
            "Export notes or folders as a zip of markdown.",
            "To back up or move part of the vault.",
            json!({"paths":{"type":"array","items":{"type":"string"}},"out_path":{"type":"string","description":"File name only (name.zip); written to the server's exchange folder"}}),
            &["paths"],
        ),
        spec(
            "import_memory",
            "interop",
            "Import notes from a markdown zip.",
            "To bring in an export from another machine.",
            json!({"zip_path":{"type":"string","description":"File name of a zip in the server's exchange folder (as export_memory returns)"},"overwrite":{"type":"boolean","default":false}}),
            &["zip_path"],
        ),
        // ---- ux ----
        spec(
            "get_todos",
            "ux",
            "Extract checklist items ('- [ ]') from one note or the whole vault.",
            "To see outstanding work.",
            json!({"path":{"type":"string"}}),
            &[],
        ),
        spec(
            "follow_ups",
            "ux",
            "Notes whose status is still awaiting action.",
            "To chase pending items.",
            json!({}),
            &[],
        ),
        spec(
            "validate_memory",
            "ux",
            "Check a note: frontmatter, created date, tags, broken links.",
            "Before treating a note as finished.",
            json!({"path":{"type":"string"}}),
            &["path"],
        ),
        spec(
            "rename_folder",
            "ops",
            "Rename a folder in place; its notes, sub folders, color and icon move along.",
            "To fix or tidy a folder name.",
            json!({"folder":{"type":"string","description":"Folder path, e.g. 'Work/Plans'"},"name":{"type":"string","description":"New name (one segment)"}}),
            &["folder", "name"],
        ),
        spec(
            "move_folder",
            "ops",
            "Move a folder with everything in it into another folder ('' or 'Root' = top level).",
            "To nest a folder under another, or lift a sub folder out to the top.",
            json!({"folder":{"type":"string"},"into":{"type":"string","description":"Destination parent folder; '' = top level"}}),
            &["folder"],
        ),
        spec(
            "move_folder_contents",
            "ops",
            "Move every note and sub folder inside a folder into another folder, then remove the emptied folder. Clashing names get a -N suffix.",
            "To merge one folder into another or flatten a folder.",
            json!({"folder":{"type":"string"},"into":{"type":"string","description":"Destination folder; '' = top level"}}),
            &["folder"],
        ),
        spec(
            "delete_folder",
            "ops",
            "Delete a folder; its notes are moved to Root.",
            "To clear folder structure you no longer use.",
            json!({"folder":{"type":"string"}}),
            &["folder"],
        ),
    ]
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/// Run an additional tool. `None` means the name does not belong to this module.
pub fn call_extra(
    store: &MemoryStore,
    name: &str,
    args: &Value,
    actor: &str,
) -> Option<anyhow::Result<Value>> {
    if !extra_specs().iter().any(|t| t.name == name) {
        return None;
    }
    let s = |k: &str| {
        args.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    let opt = |k: &str| {
        let v = s(k);
        if v.is_empty() {
            None
        } else {
            Some(v)
        }
    };
    let i = |k: &str, d: usize| {
        args.get(k)
            .and_then(|v| v.as_i64())
            .map(|v| v as usize)
            .unwrap_or(d)
    };
    let b = |k: &str, d: bool| args.get(k).and_then(|v| v.as_bool()).unwrap_or(d);
    let arr = |k: &str| {
        args.get(k)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    };
    let tags_of = |k: &str| {
        args.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .split(',')
            .map(|x| x.trim().trim_start_matches('#').to_string())
            .filter(|x| !x.is_empty())
            .collect::<Vec<_>>()
    };

    let out: anyhow::Result<Value> = (|| -> anyhow::Result<Value> {
        Ok(match name {
            // ---------------- graph ----------------
            "get_subgraph" => {
                store.get_subgraph_impl(&s("path"), i("depth", 1), i("max_nodes", 60))?
            }
            "find_path" => store.find_path_impl(&s("source"), &s("target"))?,
            "get_hubs" => json!(store.get_hubs_impl(i("limit", 10))),
            "get_isolated" => json!(store.get_isolated_impl()),
            "link_stats" => store.link_stats_impl(&s("path"))?,

            // ---------------- query ----------------
            "query_memory" => json!(store.query_memory_impl(
                opt("folder").as_deref(),
                opt("tags").as_deref(),
                opt("author").as_deref(),
                opt("type").as_deref(),
                opt("status").as_deref(),
                i("limit", 50),
            )),
            "find_similar" => json!(store.find_similar_impl(&s("path"), i("limit", 8))?),
            "suggest_links" => json!(store.suggest_links_impl(&s("path"), i("limit", 8))?),
            "list_tags" => json!(store.list_tags_impl()),
            "rename_tag" => store.rename_tag_impl(&s("old"), &s("new"))?,
            "merge_tag" => {
                let a = s("a");
                let bb = s("b");
                if a.is_empty() || bb.is_empty() {
                    anyhow::bail!("both `a` and `b` are required");
                }
                let mut r = store.rename_tag_impl(&a, &bb)?;
                if let Some(o) = r.as_object_mut() {
                    o.insert("merged".into(), json!(a));
                    o.insert("into".into(), json!(bb));
                }
                r
            }

            // ---------------- tags per note ----------------
            "add_tags" => {
                let p = s("path");
                let v = store.add_tags_impl(&p, &tags_of("tags").join(","))?;
                crate::publish_node("node_updated", actor, store, &p);
                v
            }
            "remove_tags" => {
                let p = s("path");
                let v = store.remove_tags_impl(&p, &tags_of("tags").join(","))?;
                crate::publish_node("node_updated", actor, store, &p);
                v
            }
            "set_tags" => {
                let p = s("path");
                let v = store.set_tags_impl(&p, &tags_of("tags").join(","))?;
                crate::publish_node("node_updated", actor, store, &p);
                v
            }

            // ---------------- versioning ----------------
            "get_history" => {
                // Returns a list; a single entry is unwrapped to a bare object.
                let h = store.get_history_impl(&s("path"), i("limit", 20));
                let arr: Vec<Value> = h.into_iter().collect();
                if arr.len() == 1 {
                    arr.into_iter().next().unwrap_or(json!({}))
                } else {
                    Value::Array(arr)
                }
            }
            "get_note_at" => {
                // Shape: {ok, path, rev, content}.
                let p = s("path");
                let r = s("rev");
                json!({"ok": true, "path": p, "rev": r,
                       "content": store.get_note_at_impl(&p, &r)?})
            }
            "diff" => json!(store.diff_impl(&s("path"), &s("rev_a"), &s("rev_b"))),
            "restore_memory" => {
                let p = s("path");
                let v = store.restore_impl(&p, &s("rev"))?;
                crate::publish_node("node_updated", actor, store, &p);
                v
            }
            "snapshot" => store.snapshot_impl(&s("label")),
            "soft_delete" => {
                let p = s("path");
                let r = store.soft_delete_impl(&p)?;
                crate::publish_node("node_deleted", actor, store, &p);
                r
            }
            "restore_trash" => {
                let into = {
                    let v = s("into");
                    if v.is_empty() {
                        "Root".to_string()
                    } else {
                        v
                    }
                };
                let r = store.restore_trash_impl(&s("name"), &into)?;
                if let Some(p) = r.get("path").and_then(|v| v.as_str()) {
                    let p = p.to_string();
                    crate::publish_node("node_created", actor, store, &p);
                }
                r
            }

            // ---------------- write ----------------
            "batch_create" => json!(store.batch_create_impl(&arr("notes"))),
            "duplicate_memory" => json!({
                "ok": true,
                "path": store.duplicate_memory_impl(&s("path"))?
            }),
            "merge_memory" => store.merge_memory_impl(&arr("paths"), &s("into"))?,
            "template_create" => {
                let vars = args
                    .get("variables")
                    .and_then(|v| v.as_object())
                    .cloned()
                    .unwrap_or_else(Map::new);
                let folder = {
                    let v = s("folder");
                    if v.is_empty() {
                        "Root".to_string()
                    } else {
                        v
                    }
                };
                let created = store.template_create_impl(
                    &s("template"),
                    &s("title"),
                    &folder,
                    Some(&vars),
                )?;
                json!({"ok": true, "path": created})
            }
            "bulk_replace" => store.bulk_replace_impl(
                &s("find"),
                &s("replace"),
                opt("folder").as_deref(),
                b("regex", false),
                b("dry_run", false),
            )?,
            "bulk_delete" => {
                let paths = args.get("paths").and_then(|v| v.as_array()).cloned();
                store.bulk_delete_impl(paths.as_deref(), opt("folder").as_deref())?
            }

            // ---------------- collab ----------------
            "lock_node" => {
                let owner = {
                    let v = s("owner");
                    if v.is_empty() {
                        actor.to_string()
                    } else {
                        v
                    }
                };
                store.lock_node_impl(&s("path"), &owner, i("ttl", 300) as i64)
            }
            "release_lock" => {
                let owner = {
                    let v = s("owner");
                    if v.is_empty() {
                        actor.to_string()
                    } else {
                        v
                    }
                };
                store.release_lock_impl(&s("path"), &owner)
            }
            "get_locks" => json!(store.get_locks_impl()),
            "mention_agent" => store.mention_agent_impl(&s("agent"), &s("path"), &s("message"))?,
            "get_assignments" => json!(store.get_assignments_impl(opt("agent").as_deref())),

            // ---------------- events / ops ----------------
            "get_events" => json!(store.get_events_impl(
                args.get("since").and_then(|v| v.as_f64()),
                opt("folder").as_deref(),
                opt("actor").as_deref(),
                i("limit", 50),
            )),
            "presence" => json!(store.presence_impl(i("window", 300) as i64)),
            "get_logs" => {
                let range = {
                    let v = s("range");
                    if v.is_empty() {
                        "1d".to_string()
                    } else {
                        v
                    }
                };
                store.get_logs_impl(&range, "", &s("actor"), i("limit", 100))
            }
            "search_logs" => store.get_logs_impl(
                &{
                    let v = s("range");
                    if v.is_empty() {
                        "7d".to_string()
                    } else {
                        v
                    }
                },
                &s("q"),
                &s("actor"),
                i("limit", 100),
            ),
            "digest" => store.digest_impl(
                opt("folder").as_deref(),
                args.get("since").and_then(|v| v.as_f64()),
            ),
            "healthcheck" => store.healthcheck_impl(),
            "folder_stats" => store.folder_stats_impl(&s("folder")),
            "stale_detection" => json!(store.stale_detection_impl(i("days", 30) as i64)),
            "set_folder_meta" => {
                // A present but empty field clears it.
                let field = |k: &str| args.get(k).and_then(|v| v.as_str());
                let v = store.set_folder_meta_impl(
                    &s("folder"),
                    field("color"),
                    field("icon"),
                    field("desc"),
                )?;
                memora_core::events::hub()
                    .publish(json!({"type": "folder_meta", "actor": actor, "folder": s("folder")}));
                v
            }
            "get_folder_meta" => store.get_folder_meta_impl(opt("folder").as_deref()),

            // ---------------- identity ----------------
            "set_my_name" => {
                let n = s("name");
                if n.is_empty() {
                    anyhow::bail!("name is required");
                }
                store.set_actor_alias(actor, &n)?
            }
            // Needs the caller's key: handled in `McpServer::call_tool_by`.
            "set_my_color" => anyhow::bail!("set_my_color needs an API key caller"),
            "list_actors" => {
                let r = store.list_actors_impl();
                let aliases = r.get("aliases").cloned().unwrap_or(json!({}));
                // Shape: {me, aliases}.
                json!({"me": actor, "aliases": aliases})
            }

            // ---------------- interop ----------------
            "export_memory" => {
                let paths = arr("paths");
                if !paths
                    .iter()
                    .any(|p| p.as_str().is_some_and(|p| !p.trim().is_empty()))
                {
                    anyhow::bail!("paths is required: the notes or folders to export");
                }
                let bytes = store.export_zip_impl(&paths)?;
                let name = s("out_path");
                let name = if name.is_empty() {
                    format!("memora-export-{}.zip", memora_core::vault::now_secs())
                } else {
                    name
                };
                // Only a plain file name, written into the one export folder:
                // an agent never picks a place on the server's disk.
                let dest = exchange_file(&name)?;
                std::fs::write(&dest, &bytes)?;
                // Only the file name: the server's disk layout stays private, and
                // import_memory takes the same name.
                json!({"ok": true, "path": name, "name": name, "bytes": bytes.len()})
            }
            "import_memory" => {
                let data = std::fs::read(exchange_file(&s("zip_path"))?)?;
                store.import_zip_impl(&data, b("overwrite", false))?
            }

            // ---------------- ux ----------------
            "get_todos" => json!(store.get_todos_impl(opt("path").as_deref())),
            "follow_ups" => json!(store.follow_ups_impl()),
            "validate_memory" => store.validate_memory_impl(&s("path"))?,

            // ---------------- misc ----------------
            "delete_folder" => folder_changed(actor, store.delete_folder_impl(&s("folder"))?),
            "rename_folder" => {
                folder_changed(actor, store.rename_folder_impl(&s("folder"), &s("name"))?)
            }
            "move_folder" => {
                folder_changed(actor, store.move_folder_impl(&s("folder"), &s("into"))?)
            }
            "move_folder_contents" => folder_changed(
                actor,
                store.move_folder_contents_impl(&s("folder"), &s("into"))?,
            ),

            _ => anyhow::bail!("unknown tool: {name}"),
        })
    })();

    Some(out)
}

/// Tell browsers the folder tree changed (they reload it), then pass `v` through.
fn folder_changed(actor: &str, v: Value) -> Value {
    memora_core::events::hub()
        .publish(json!({"type": "folder_changed", "actor": actor, "detail": v}));
    v
}

/// Names of every additional tool (used by `all_tool_names`).
pub fn extra_names() -> Vec<&'static str> {
    extra_specs().iter().map(|t| t.name).collect()
}

/// The folder where `export_memory` writes and `import_memory` reads zips
/// (`<temp>/memora-exchange`), and the full path of `name` in it. Only plain
/// names (`[A-Za-z0-9._-]`, ending in `.zip`, no leading dot) are accepted, so
/// a tool call can never read or write anywhere else on the server.
fn exchange_file(name: &str) -> std::io::Result<PathBuf> {
    let ok = !name.is_empty()
        && name.len() <= 120
        && !name.starts_with('.')
        && name.ends_with(".zip")
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
    if !ok {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "use a plain file name ending in .zip (letters, digits, . _ -); exports live in the server's exchange folder",
        ));
    }
    let dir = std::env::temp_dir().join("memora-exchange");
    {
        use std::os::unix::fs::{DirBuilderExt, MetadataExt};
        match std::fs::DirBuilder::new().mode(0o700).create(&dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e),
        }
        // The temp dir is shared: refuse a folder (or file) another user could have
        // planted, so an export can never be redirected through a symlink.
        let meta = std::fs::symlink_metadata(&dir)?;
        // SAFETY: geteuid has no preconditions.
        let me = unsafe { libc::geteuid() };
        if !meta.is_dir() || meta.uid() != me || meta.mode() & 0o022 != 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!(
                    "{} is not a private folder of this server; remove it and retry",
                    dir.display()
                ),
            ));
        }
    }
    let path = dir.join(name);
    if std::fs::symlink_metadata(&path).is_ok_and(|m| !m.is_file()) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("{name} is not a regular file"),
        ));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::exchange_file;

    #[test]
    fn exchange_names_are_plain_zip_files() {
        for bad in ["", "../x.zip", "a/b.zip", ".x.zip", "x.tar", "x .zip"] {
            assert!(exchange_file(bad).is_err(), "{bad:?} accepted");
        }
        let ok = exchange_file("plain-name_1.zip").unwrap();
        assert!(ok.ends_with("memora-exchange/plain-name_1.zip"));
    }

    #[test]
    fn exchange_refuses_symlinks() {
        let name = format!("link-{}.zip", std::process::id());
        let path = exchange_file(&name).unwrap();
        let _ = std::fs::remove_file(&path);
        std::os::unix::fs::symlink("/etc/hostname", &path).unwrap();
        assert!(exchange_file(&name).is_err());
        std::fs::remove_file(&path).unwrap();
    }
}
