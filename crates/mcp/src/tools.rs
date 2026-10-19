//! `tools`: the remaining MCP tools, mapping onto `memora_core` vault operations.
//!
//! Kept separate from `lib.rs` so the base catalog stays readable. Every tool
//! here calls a `*_impl` helper in `crates/core/src/vault.rs`, so it behaves
//! exactly like the UI and HTTP surfaces.

use crate::ToolSpec;
use memora_core::MemoryStore;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

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
            "Subgraph around one note: the notes within `depth` hops (nearest first, the note itself included), at most `max_nodes` of them (`truncated` says whether more were in reach), and every link between them as a directed edge source -> target (a two-way link is two edges).",
            "To see local context without pulling the whole graph.",
            json!({"path":{"type":"string","description":"Note path ('Folder/Note.md', .md optional) or note name"},"depth":{"type":"integer","default":1,"minimum":0},"max_nodes":{"type":"integer","default":60,"minimum":1}}),
            &["path"],
        ),
        spec(
            "find_path",
            "graph",
            "Shortest wikilink path between two notes, following links in either direction.",
            "To learn how two topics connect.",
            json!({"source":{"type":"string","description":"Note path ('Folder/Note.md', .md optional) or note name"},"target":{"type":"string","description":"Note path ('Folder/Note.md', .md optional) or note name"}}),
            &["source", "target"],
        ),
        spec(
            "get_hubs",
            "graph",
            "Most connected notes, the vault hubs. `degree` = number of distinct other notes linked to or from the note (resolved wikilinks only; self-links and broken links do not count), the same as get_graph and link_stats.",
            "To find the most central notes in the vault.",
            json!({"limit":{"type":"integer","default":10,"minimum":0}}),
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
            "Links of one note: `links_to` / `outgoing` (notes it links to), `linked_from` / `incoming` (notes linking to it), `degree` (distinct notes in either direction) and `unresolved` (link targets matching no note). Only resolved links between two different notes count, each once.",
            "Before cleaning up the links of a note.",
            json!({"path":{"type":"string","description":"Note path ('Folder/Note.md', .md optional) or note name"}}),
            &["path"],
        ),
        // ---- query ----
        spec(
            "query_memory",
            "query",
            "Filter notes by folder, tags and frontmatter author, type, status. All given filters must match.",
            "When you need a metadata-based list rather than a full-text search.",
            json!({"folder":{"type":"string","description":"Folder path, e.g. 'Projects/Atlas'; includes its subfolders; case-sensitive like paths; 'Root' = top level"},"tags":{"type":"string","description":"Comma-separated; every tag required; case-insensitive, leading # optional"},"author":{"type":"string","description":"Case-insensitive"},"type":{"type":"string","description":"Case-insensitive"},"status":{"type":"string","description":"Case-insensitive"},"limit":{"type":"integer","default":50,"minimum":0,"description":"0 returns nothing"}}),
            &[],
        ),
        spec(
            "find_similar",
            "query",
            "Notes most similar to a given note (shared tags and words).",
            "For deduplication or finding notes worth merging.",
            json!({"path":{"type":"string","description":"Note path ('Folder/Note.md', .md optional) or note name"},"limit":{"type":"integer","default":8,"minimum":0}}),
            &["path"],
        ),
        spec(
            "suggest_links",
            "query",
            "Similar notes that are NOT yet linked from this one.",
            "To add useful wikilinks.",
            json!({"path":{"type":"string","description":"Note path ('Folder/Note.md', .md optional) or note name"},"limit":{"type":"integer","default":8,"minimum":0}}),
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
            "Rename a tag across the whole vault (frontmatter and inline #tags; matching ignores case). The new name must be a valid tag (letters, digits, - _ / .). Renaming a tag no note has is an error.",
            "When consolidating duplicate or misspelled tags.",
            json!({"old":{"type":"string"},"new":{"type":"string"}}),
            &["old", "new"],
        ),
        spec(
            "merge_tag",
            "query",
            "Merge tag `a` into tag `b` across every note (dedup; matching ignores case). `b` must be a valid tag (letters, digits, - _ / .); merging a tag no note has is an error.",
            "To tidy up synonymous tags.",
            json!({"a":{"type":"string"},"b":{"type":"string"}}),
            &["a", "b"],
        ),
        // ---- tags per note ----
        spec(
            "add_tags",
            "tag",
            "Add one or more tags to a note's frontmatter. A tag may contain only letters, digits and - _ / . (a leading # is dropped). Matching ignores case: a tag already there in another case is kept as written.",
            "To make a note discoverable by tag.",
            json!({"path":{"type":"string"},"tags":{"type":"string","description":"Comma-separated"}}),
            &["path", "tags"],
        ),
        spec(
            "remove_tags",
            "tag",
            "Remove tags from a note's frontmatter (matching ignores case). A tag the note does not have is reported in `note`.",
            "To clear tags that no longer apply.",
            json!({"path":{"type":"string"},"tags":{"type":"string"}}),
            &["path", "tags"],
        ),
        spec(
            "set_tags",
            "tag",
            "Replace a note's entire frontmatter tag list with exactly these tags (comma-separated; letters, digits, - _ / . only; \"\" clears).",
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
            "Create many notes in one call. Each item is {title (required), content, folder (default Memory)}; titles follow create_memory's rules. Items are checked first: when any is malformed (no title, a wrong type, an unknown key) nothing is created. Then each note is created on its own and the reply lists one result per item ({ok, path} or {ok:false, item, error}).",
            "For migrations or bulk imports.",
            json!({"notes":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"content":{"type":"string"},"folder":{"type":"string","default":"Memory"}},"required":["title"],"additionalProperties":false}}}),
            &["notes"],
        ),
        spec(
            "duplicate_memory",
            "write",
            "Duplicate a note as '<name>-copy' in the same folder (a long name is shortened so the suffix fits the 80-character limit).",
            "To use a note as the starting point for a new one.",
            json!({"path":{"type":"string"}}),
            &["path"],
        ),
        spec(
            "merge_memory",
            "write",
            "Merge notes into one target note: the body of each note in `paths` (without its frontmatter) is appended to `into` under a '## from <name>' heading, and its tags are added to the target's tags. `into` is created when missing ('.md' optional). The source notes are kept; delete them afterwards if you no longer need them.",
            "To consolidate notes whose content is scattered.",
            json!({"paths":{"type":"array","items":{"type":"string"},"description":"Existing notes to merge, each once, not including `into`"},"into":{"type":"string","description":"Target note path, e.g. 'Notes/All.md'"}}),
            &["paths", "into"],
        ),
        spec(
            "template_create",
            "write",
            "Create a note from a template, a note in Templates/. {{name}} placeholders are filled from `variables`; {{title}} (the note title) and {{date}} (today, YYYY-MM-DD) are built in unless given.",
            "So new notes match the folder's format.",
            json!({"template":{"type":"string","description":"Template name in Templates/, e.g. 'Meeting' or 'Meeting.md'"},"title":{"type":"string"},"folder":{"type":"string","default":"Root"},"variables":{"type":"object"}}),
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
            "Activity summary over the newest logged events: event counts per actor and per type, and the notes touched (at most `limit`; `truncated` says whether more were).",
            "For a daily report or a handover between agents.",
            json!({"folder":{"type":"string","description":"Folder path; includes its subfolders"},"since":{"type":"number","description":"Only events after this time, in Unix seconds"},"limit":{"type":"integer","default":50,"minimum":0,"description":"Most notes_touched to list"}}),
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
            json!({"days":{"type":"integer","default":30,"minimum":0}}),
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
            "Export notes or folders as a zip of markdown into this server's exchange folder (private to this Memora instance). Every path must exist. An existing zip of the same name is only replaced with `overwrite`.",
            "To back up or move part of the vault.",
            json!({"paths":{"type":"array","items":{"type":"string"}},"out_path":{"type":"string","description":"File name only (name.zip); written to the server's exchange folder"},"overwrite":{"type":"boolean","default":false,"description":"Replace an existing zip named out_path"}}),
            &["paths"],
        ),
        spec(
            "import_memory",
            "interop",
            "Import the .md notes of a zip in this server's exchange folder. The reply lists added, overwritten (only with `overwrite`), skipped (existing notes kept), unsafe (absolute or escaping paths, with a reason) and failed entries.",
            "To bring in an export from another machine.",
            json!({"zip_path":{"type":"string","description":"File name of a zip in the server's exchange folder (as export_memory returns)"},"overwrite":{"type":"boolean","default":false}}),
            &["zip_path"],
        ),
        // ---- ux ----
        spec(
            "get_todos",
            "ux",
            "Extract checklist items ('- [ ] text', '- [x] text') from one note or the whole vault; empty items are skipped.",
            "To see outstanding work.",
            json!({"path":{"type":"string","description":"Note path ('Folder/Note.md', .md optional) or note name; omit for the whole vault"}}),
            &[],
        ),
        spec(
            "follow_ups",
            "ux",
            "Notes whose frontmatter status is still awaiting action: pending, open, todo, in-progress, waiting or blocked (case-insensitive; '_' or a space works for '-'). Returns {notes, count, truncated}.",
            "To chase pending items.",
            json!({"limit":{"type":"integer","default":50,"minimum":0}}),
            &[],
        ),
        spec(
            "validate_memory",
            "ux",
            "Check a note: frontmatter (present and well formed), a valid 'created' date, tags, and broken links (named in the issue and in `broken_links`).",
            "Before treating a note as finished.",
            json!({"path":{"type":"string"}}),
            &["path"],
        ),
        // ---- pins (handled in `McpServer::call_pins`: they live in the state database) ----
        spec(
            "list_pins",
            "ux",
            "The owner's pinned notes and folders, in the order the sidebar shows them. Each pin has kind (note or folder), path, position and missing (true when the path no longer exists, e.g. renamed outside Memora).",
            "To find the notes and folders the owner keeps at hand, or before pinning or unpinning.",
            json!({}),
            &[],
        ),
        spec(
            "pin",
            "ux",
            "Pin an existing note or folder to the owner's Pinned list (shared by every browser), or move a pin to another position. Pins follow their note or folder through renames and moves; deleting the item removes its pin. At most 200 pins.",
            "When the owner asks to keep a note or folder at hand in the sidebar.",
            json!({"path":{"type":"string","description":"Vault path of a note (e.g. 'Work/Plan.md') or folder (e.g. 'Work')"},"kind":{"type":"string","enum":["note","folder"],"description":"Default: what the path is on disk"},"position":{"type":"integer","minimum":0,"description":"0 = top; default: the end"}}),
            &["path"],
        ),
        spec(
            "unpin",
            "ux",
            "Remove a note or folder from the owner's Pinned list. The note or folder itself is not touched.",
            "When the owner no longer wants an item pinned, or a pin is missing.",
            json!({"path":{"type":"string"},"kind":{"type":"string","enum":["note","folder"]}}),
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
    exchange: &Path,
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
                // Echo the names as applied: trimmed, without a leading `#`.
                let a = s("a").trim().trim_start_matches('#').trim().to_string();
                let bb = s("b").trim().trim_start_matches('#').trim().to_string();
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
            "batch_create" => json!(store.batch_create_impl(&arr("notes"))?),
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
                    if v.trim().is_empty() {
                        "Root".to_string()
                    } else {
                        v
                    }
                };
                let title = s("title");
                if title.trim().is_empty() {
                    anyhow::bail!("title is required");
                }
                let created =
                    store.template_create_impl(&s("template"), &title, &folder, Some(&vars))?;
                crate::with_title_notice(json!({"ok": true, "path": created}), &title, &created)
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
                i("limit", 50),
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
            // Need the state database: handled in `McpServer::call_pins`.
            "list_pins" | "pin" | "unpin" => anyhow::bail!("{name} is handled by the server"),
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
                let given = s("out_path");
                // Only a plain file name, written into the one export folder:
                // an agent never picks a place on the server's disk.
                let (name, dest) = if given.is_empty() {
                    // Whole seconds; a second export within the same second gets a suffix.
                    let stamp = memora_core::vault::now_secs() as u64;
                    let mut n = 1;
                    loop {
                        let name = match n {
                            1 => format!("memora-export-{stamp}.zip"),
                            _ => format!("memora-export-{stamp}-{n}.zip"),
                        };
                        let dest = exchange_file(exchange, &name)?;
                        if !dest.exists() {
                            break (name, dest);
                        }
                        n += 1;
                    }
                } else {
                    let dest = exchange_file(exchange, &given)?;
                    (given, dest)
                };
                let replaced = dest.exists();
                if replaced && !b("overwrite", false) {
                    anyhow::bail!(
                        "{name} already exists in the exchange folder; pass overwrite: true to replace it, or choose another out_path"
                    );
                }
                std::fs::write(&dest, &bytes)?;
                // Only the file name: the server's disk layout stays private, and
                // import_memory takes the same name.
                json!({"ok": true, "path": name, "name": name, "bytes": bytes.len(), "replaced": replaced})
            }
            "import_memory" => {
                let name = s("zip_path");
                if name.trim().is_empty() {
                    anyhow::bail!("zip_path is required: the file name export_memory returned");
                }
                let data = match std::fs::read(exchange_file(exchange, &name)?) {
                    Ok(d) => d,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                        anyhow::bail!("{name} not found in the exchange folder")
                    }
                    Err(e) => return Err(e.into()),
                };
                store.import_zip_impl(&data, b("overwrite", false))?
            }

            // ---------------- ux ----------------
            "get_todos" => json!(store.get_todos_impl(opt("path").as_deref())?),
            "follow_ups" => store.follow_ups_impl(i("limit", 50)),
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

/// The full path of `name` in `dir`, the exchange folder where `export_memory`
/// writes and `import_memory` reads zips (`<state>/exchange`: one per Memora
/// instance, created private). Only plain names (`[A-Za-z0-9._-]`, ending in
/// `.zip`, no leading dot) are accepted, so a tool call can never read or write
/// anywhere else on the server.
fn exchange_file(dir: &Path, name: &str) -> std::io::Result<PathBuf> {
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
    let not_private = || {
        std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "the exchange folder is not a private folder of this server; remove it and retry",
        )
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
        match std::fs::DirBuilder::new().mode(0o700).create(dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e),
        }
        // Never follow a symlink planted in its place; a folder of ours that is
        // open to others (made before the mode was set) is closed again.
        let meta = std::fs::symlink_metadata(dir)?;
        // SAFETY: geteuid has no preconditions.
        let me = unsafe { libc::geteuid() };
        if !meta.is_dir() || meta.uid() != me {
            return Err(not_private());
        }
        if meta.mode() & 0o077 != 0 {
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        }
    }
    #[cfg(not(unix))]
    {
        match std::fs::create_dir(dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e),
        }
        if !std::fs::symlink_metadata(dir)?.is_dir() {
            return Err(not_private());
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

    fn tmp(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("memora-xchg-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn exchange_names_are_plain_zip_files() {
        let state = tmp("names");
        let dir = state.join("exchange");
        for bad in ["", "../x.zip", "a/b.zip", ".x.zip", "x.tar", "x .zip"] {
            assert!(exchange_file(&dir, bad).is_err(), "{bad:?} accepted");
        }
        let ok = exchange_file(&dir, "plain-name_1.zip").unwrap();
        assert_eq!(ok, dir.join("plain-name_1.zip"));
        std::fs::remove_dir_all(&state).ok();
    }

    #[test]
    #[cfg(unix)]
    fn exchange_folder_is_private_per_state_dir() {
        use std::os::unix::fs::PermissionsExt;
        let state = tmp("private");
        let dir = state.join("exchange");
        exchange_file(&dir, "a.zip").unwrap();
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700);
        // Opened up by someone: closed again on next use.
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        exchange_file(&dir, "a.zip").unwrap();
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700);
        std::fs::remove_dir_all(&state).ok();
    }

    #[test]
    #[cfg(unix)]
    fn exchange_refuses_symlinks() {
        let state = tmp("links");
        let dir = state.join("exchange");
        let path = exchange_file(&dir, "link.zip").unwrap();
        std::os::unix::fs::symlink("/etc/hostname", &path).unwrap();
        assert!(exchange_file(&dir, "link.zip").is_err());
        // Nor a symlinked exchange folder.
        let other = state.join("exchange2");
        std::os::unix::fs::symlink("/tmp", &other).unwrap();
        assert!(exchange_file(&other, "x.zip").is_err());
        std::fs::remove_dir_all(&state).ok();
    }
}
