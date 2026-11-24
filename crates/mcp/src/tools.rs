//! The remaining MCP tools, each mapping onto a `*_impl` vault operation in `memora_core`.

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
            "Git revision history of a note, newest first, as an array of {rev, date, author, message, version, total} (plus `path` for commits made under an earlier name: the history follows renames). `version` numbers the revisions from 1 (the oldest) to `total` (the current one), whatever `limit` is. `author` is the agent or user whose call made the change; changes made outside Memora show the vault's git user. Needs version history on (the vault is a git repository); otherwise it says how to turn it on.",
            "Before restoring or comparing an older version.",
            json!({"path":{"type":"string"},"limit":{"type":"integer","default":20,"minimum":1}}),
            &["path"],
        ),
        spec(
            "get_note_at",
            "version",
            "Read a note as it was at a specific revision. `rev` is one revision: a `rev` from get_history, a snapshot tag (`snap-<label>`), `HEAD~1`, or `HEAD@{2026-01-31}` (the last commit at or before that date). A renamed note is found under its old name.",
            "To see what the note looked like previously.",
            json!({"path":{"type":"string"},"rev":{"type":"string","description":"A revision from get_history, snap-<label>, HEAD~1 or HEAD@{<date>}"}}),
            &["path", "rev"],
        ),
        spec(
            "diff",
            "version",
            "Unified diff of a note between two revisions, or `rev_a` against the current note when `rev_b` is left out. Each of `rev_a` / `rev_b` is one revision (no `a..b` ranges); an unknown revision is an error. `changed` is false when there is no difference.",
            "To see what changed before restoring.",
            json!({"path":{"type":"string"},"rev_a":{"type":"string"},"rev_b":{"type":"string"}}),
            &["path", "rev_a"],
        ),
        spec(
            "restore_memory",
            "version",
            "Restore a note to an older revision (the restore is a new commit, so it can be undone too). Give the note's current path: its older content is found even under a previous name. Restoring the old path of a renamed note is refused and names the current path.",
            "To undo an unwanted change.",
            json!({"path":{"type":"string"},"rev":{"type":"string"}}),
            &["path", "rev"],
        ),
        spec(
            "snapshot",
            "version",
            "Snapshot the whole vault: commits pending changes, then tags the last commit as `snap-<label>`. Use `snap-<label>` as `rev` in get_note_at, diff and restore_memory. The label uses letters, digits, '.', '_' and '-' (spaces become '-'), at most 40 characters, and must not exist yet. Needs version history on.",
            "Before a large or risky change.",
            json!({"label":{"type":"string","maxLength":40}}),
            &["label"],
        ),
        spec(
            "soft_delete",
            "version",
            "Move a note to .Trash (still recoverable with restore_trash; list_trash shows the trash). The trash remembers where the note came from. A name already taken in the trash gets a suffix (Plan-1.md).",
            "Same as delete_memory without `permanent`.",
            json!({"path":{"type":"string"}}),
            &["path"],
        ),
        spec(
            "restore_trash",
            "version",
            "Restore a note from .Trash. `name` is the trash name as list_trash shows it (`.md` optional). By default the note goes back to the path it was deleted from, under its original name; `into` puts it in that folder instead (`Root` = the top level). Refused when the target path is taken.",
            "To bring back a note deleted by mistake.",
            json!({"name":{"type":"string"},"into":{"type":"string","description":"Folder to restore into; default: where the note was deleted from"}}),
            &["name"],
        ),
        spec(
            "list_trash",
            "version",
            "Notes in .Trash, newest first: {name, path, original, deleted, by, title}. `name` is what restore_trash takes, `original` the path it was deleted from, `deleted` when (both null for notes trashed by older versions), `by` who deleted it ({id, name, kind}; null when unknown).",
            "Before restore_trash, to find a deleted note.",
            json!({}),
            &[],
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
            "Find and replace across many notes; supports regex and dry-run. `find` must not be empty (with regex it must not match an empty string). `folder` limits it to that folder and all its subfolders (`Root` = top-level notes only); a missing folder is an error. With `regex`, `replace` may use $1 or ${name} for groups (write ${1} when letters or digits follow, $$ for a literal $); naming a group the pattern lacks is an error. Without regex, `replace` is literal.",
            "For safe bulk text edits (dry-run first).",
            json!({"find":{"type":"string"},"replace":{"type":"string"},"folder":{"type":"string"},"regex":{"type":"boolean","default":false},"dry_run":{"type":"boolean","default":false}}),
            &["find", "replace"],
        ),
        spec(
            "bulk_delete",
            "write",
            "Move many notes to .Trash at once (recoverable with restore_trash), by path list and / or folder; `folder` includes all its subfolders (`Root` = top-level notes only). Every path is checked first: if any is missing, outside the vault, a folder or not a note, nothing is deleted and the error lists them. `.md` may be left out. Returns the trash name of each note.",
            "To clear a batch of notes in a single step.",
            json!({"paths":{"type":"array","items":{"type":"string"}},"folder":{"type":"string"}}),
            &[],
        ),
        // ---- collab ----
        spec(
            "lock_node",
            "collab",
            "Lock a note in your own name for `ttl` seconds (5-86400): while it is locked, \
             other agents cannot save, patch, move, rename or delete it. Calling it again \
             renews your lock; a note another agent holds is refused.",
            "Before editing a note another agent may be using.",
            json!({"path":{"type":"string","description":"The note, e.g. Notes/Ideas.md (.md optional)"},"owner":{"type":"string","description":"Optional; locks are always taken in your own name"},"ttl":{"type":"integer","default":300,"minimum":5,"maximum":86400}}),
            &["path"],
        ),
        spec(
            "release_lock",
            "collab",
            "Release a note lock you hold (only its holder can release it).",
            "After you finish editing.",
            json!({"path":{"type":"string"},"owner":{"type":"string","description":"Optional; must be you"}}),
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
            "Ping another agent with '> @agent: message' appended to a note (message up to 4000 characters; every line stays inside the quote).",
            "To hand off a task through the vault instead of chat.",
            json!({"agent":{"type":"string","description":"Agent name, one line; a leading @ is optional"},"path":{"type":"string"},"message":{"type":"string"}}),
            &["agent", "path", "message"],
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
            json!({"since":{"type":"number"},"folder":{"type":"string"},"actor":{"type":"string"},"limit":{"type":"integer","default":50,"minimum":1,"maximum":2000}}),
            &[],
        ),
        spec(
            "presence",
            "ops",
            "Agents active within the last `window` seconds.",
            "To see who is working right now.",
            json!({"window":{"type":"integer","default":300,"minimum":1}}),
            &[],
        ),
        spec(
            "get_logs",
            "ops",
            "Vault activity log over a time range: today, yesterday, latest (7 days), week, all, or Nd (last N days, e.g. 1d, 30d).",
            "To audit what happened during a period.",
            json!({"range":{"type":"string","default":"1d"},"actor":{"type":"string"},"limit":{"type":"integer","default":100,"minimum":1,"maximum":2000}}),
            &[],
        ),
        spec(
            "search_logs",
            "ops",
            "Search the activity log by keyword.",
            "When you need a specific trace, such as a note or an action.",
            json!({"q":{"type":"string"},"range":{"type":"string","default":"7d","description":"today, yesterday, latest, week, all, or Nd"},"actor":{"type":"string"},"limit":{"type":"integer","default":100,"minimum":1,"maximum":2000}}),
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
            "Note count (sub folders included) and metadata for one folder ('Root' = notes at the top level). A missing folder is an error.",
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
            "Set a folder's color, icon, and description (at most 500 characters). An empty string clears a field. Root has no metadata.",
            "To control how the folder appears in the UI.",
            json!({"folder":{"type":"string"},"color":{"type":"string","description":"Hex color such as #22c55e."},"icon":{"type":"string","description":"One emoji, or an icon name: star, book, code, brain, flask, briefcase, archive, inbox, user, users, calendar, bulb, heart, credit-card, wallet, cpu, key, lock, shield, server, database, terminal, cloud, globe, home, settings, tag, mail, chart, dollar, cart, rocket, wrench, image, music, map, school, file."},"desc":{"type":"string"}}),
            &["folder"],
        ),
        spec(
            "get_folder_meta",
            "ops",
            "Folder metadata (color/icon/description); no argument returns every folder. A missing folder is an error.",
            "To build the folder display in the UI.",
            json!({"folder":{"type":"string"}}),
            &[],
        ),
        // ---- identity ----
        spec(
            "set_my_name",
            "identity",
            "Change your display alias without changing your actor id. 1-32 characters, no control or text-direction characters, and not a name another agent or the owner already uses.",
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
        // ---- images beside notes ----
        spec(
            "upload_image",
            "note",
            "Store an image (PNG, JPEG, WebP or GIF, told by its bytes) in the folder of a note, up to the server's image size limit. The name is cleaned (letters, digits, '-', '_') and gets the extension of the real kind; an identical file there is reused, another name gets -1, -2... Returns {path, name, bytes, url, markdown}; `markdown` (`![name](path:name.webp)`) shows the image in that note. With append the line is added to the end of the note. Images follow their note: moved, trashed, restored and deleted with it.",
            "When an image belongs in a note: a screenshot, a diagram, a photo. Web images can stay as https URLs instead.",
            json!({"path":{"type":"string","description":"The note the image belongs to ('Folder/Note.md'); the image is stored in that note's folder"},"name":{"type":"string","description":"File name, e.g. 'diagram.png'"},"data":{"type":"string","description":"The image bytes as base64 (or a data:image/...;base64, URL)"},"alt":{"type":"string","description":"Alt text for the markdown line (default: the file name)"},"append":{"type":"boolean","default":false,"description":"Also add the image line to the end of the note"}}),
            &["path", "name", "data"],
        ),
        spec(
            "list_images",
            "note",
            "Images of one folder (never its sub folders or parents), each with {path, name, bytes, url, used_in:[{note, title, heading}]} naming the notes of that folder that show it and the section it sits in. With path: the images that note shows (with heading) plus every image of its folder.",
            "To see what images a folder or a note has before reusing, linking or cleaning them up.",
            json!({"folder":{"type":"string","description":"Folder path ('Root' or empty = top level)"},"path":{"type":"string","description":"A note path instead of a folder"}}),
            &[],
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
        // ---- kanban boards (Obsidian Kanban format) ----
        // Four categories, four permission switches: read boards, change cards and lanes,
        // create / rename / move / delete boards, embed boards in notes.
        spec(
            "kanban_list_boards",
            "kanban",
            "Kanban boards in the vault: notes whose frontmatter has `kanban-plugin` (the Obsidian Kanban format). Each is {path, title, lanes:[{title, cards}], cards, done, archived, version, mtime, style:{color, icon}, due (the due date YYYY-MM-DD of every open card that has one: compare with today to find what is overdue), date_colors (the board's Obsidian date-colors rules, or null), embedded_in (notes that put it in with ![[...]]), linked_from (notes that only link to it)}, most recently changed first. One note is one board. To start a board use kanban_board action create (or convert an existing list note). Several boards in one note: make one board note per board, then embed each in the note with kanban_embed (a `![[Board name]]` line); the note shows every embedded board live, to work on in place.",
            "To find the boards before reading or changing one, and when asked for a board, or for several boards in one note.",
            json!({"folder":{"type":"string","description":"Only boards in this folder and its subfolders ('Root' = top level)"}}),
            &[],
        ),
        spec(
            "kanban_due",
            "kanban",
            "Open cards with a due date across every board: {today, days, counts:{overdue, today, upcoming}, overdue, due_today, upcoming}. Each card is {board (path), board_title, lane, lane_index, card (the id the other kanban tools take), title, date (YYYY-MM-DD), block}. A card's due date is its earliest date; done and archived cards are left out. `upcoming` covers the `days` after today (default 7). Tick a card off with kanban_update_card {path: board, card, checked: true}, or move it with kanban_move_card.",
            "When asked what is overdue, due today or due soon, across boards or in a folder, before reading each board.",
            json!({"range":{"type":"string","enum":["overdue","today","upcoming","all"],"description":"Only one list (default all)"},"days":{"type":"integer","description":"How many days after today count as upcoming (default 7, at most 366)"},"today":{"type":"string","description":"Today as YYYY-MM-DD in the user's time zone (default: the server's local day)"},"folder":{"type":"string","description":"Only boards in this folder and its subfolders"}}),
            &[],
        ),
        spec(
            "kanban_get_board",
            "kanban",
            "Read one board: {path, version, lanes:[{index, title, max_items, color, complete, cards}], archive, counts, style:{color, icon}, tag_colors:{tag:{color, background}}, settings, embedded_in, linked_from}: `embedded_in` lists the notes that put the board in with ![[...]] and `linked_from` those that only link to it (which notes use this board). A card is {id, text, title, checked, task, tags, links, dates, times, block, color, checklist:[{text, done}], fields:{text, links, tags, date, time}}; `fields` is the card read as a form (`text` without the links, tags, date, time, checklist lines and block id). `id` names the card in the other kanban tools (it changes when the card's text changes, not when it moves or is checked). `complete` lanes mark the cards moved into them as done; `max_items` is the lane's WIP limit (0 = none). `settings` is the board's whole Obsidian Kanban settings object. Pass `version` to the write tools so a board changed meanwhile is not overwritten.",
            "Before adding, moving or changing cards, lanes or the board.",
            json!({"path":{"type":"string","description":"The board note ('Folder/Board.md', .md optional) or its name"}}),
            &["path"],
        ),
        spec(
            "kanban_add_card",
            "kanban_cards",
            "Add a card to a lane of a board, written as `- [ ] text` (more lines are indented under it, as Obsidian does). Prefer the structured fields over writing the syntax by hand: `links`, `tags`, `date`, `time`, `checklist` and `color` are written in the board's own format (its date trigger and format). Returns the board and `card`, the new card's id. The note is saved as a normal edit (history, activity).",
            "To put a new task on a board.",
            json!({"path":{"type":"string","description":"The board note"},"lane":{"type":"string","description":"Lane title (case is ignored when no lane matches exactly), or its position from 0 written as digits"},"text":{"type":"string","description":"Card text; first line is the title"},"position":{"type":"integer","minimum":0,"description":"Card position in the lane, 0 = top; default: the bottom"},"checked":{"type":"boolean","default":false,"description":"Add it as done"},"links":{"type":"array","items":{"type":"string"},"description":"Notes to link, as [[note]] (names or paths)"},"tags":{"type":"array","items":{"type":"string"},"description":"Tags, without #"},"date":{"type":"string","description":"Due date YYYY-MM-DD"},"time":{"type":"string","description":"Due time HH:mm"},"checklist":{"type":"array","items":{"type":"object","properties":{"text":{"type":"string"},"done":{"type":"boolean"}}},"description":"Sub-tasks [{text, done}], written as `- [ ]` lines under the card"},"color":{"type":"string","description":"Card color, e.g. #f59e0b"},"version":{"type":"string","description":"The board's version from kanban_get_board; refused when the board changed since"}}),
            &["path", "lane", "text"],
        ),
        spec(
            "kanban_move_card",
            "kanban_cards",
            "Move a card to another lane (or to another position in the same lane). Moving into a lane marked complete checks the card; moving out of one unchecks it. Only the card's lines move: the rest of the note stays byte for byte. Returns the board and the card's id.",
            "To change a task's status on a board.",
            json!({"path":{"type":"string","description":"The board note"},"card":{"type":"string","description":"Card id from kanban_get_board"},"lane":{"type":"string","description":"Target lane title, or its position from 0 written as digits"},"position":{"type":"integer","minimum":0,"description":"Position in the target lane, 0 = top; default: the bottom"},"version":{"type":"string","description":"The board's version from kanban_get_board; refused when the board changed since"}}),
            &["path", "card", "lane"],
        ),
        spec(
            "kanban_update_card",
            "kanban_cards",
            "Change a card through its fields, applied over its current text: `text` replaces the free text (the card's `fields.text`: links, tags, date, time, checklist and block id stay unless you change them too), `links`, `tags`, `date` (\"\" clears), `time` (\"\" clears), `checklist` (the whole list of sub-tasks [{text, done}]; [] removes them), `color` (null clears), `checked`. Fields you leave out stay as they are, and lines nobody changed stay byte for byte. Prefer these fields to editing the syntax by hand. `archived` true moves the card to the board's Archive, false brings an archived card back to `lane` (default the first lane); it is a change of its own. Returns the board and the card's id after the change.",
            "To edit, tick off or archive a task, or change its links, tags, due date, checklist or color.",
            json!({"path":{"type":"string","description":"The board note"},"card":{"type":"string","description":"Card id from kanban_get_board"},"text":{"type":"string","description":"The new free text (without links, tags, date, time and checklist)"},"checked":{"type":"boolean"},"links":{"type":"array","items":{"type":"string"},"description":"Linked notes, the whole list"},"tags":{"type":"array","items":{"type":"string"},"description":"Tags without #, the whole list"},"date":{"type":"string","description":"YYYY-MM-DD, or \"\" to clear"},"time":{"type":"string","description":"HH:mm, or \"\" to clear"},"checklist":{"type":"array","items":{"type":"object","properties":{"text":{"type":"string"},"done":{"type":"boolean"}}},"description":"The whole checklist [{text, done}]"},"color":{"type":"string","description":"A color such as #f59e0b, or null to clear"},"archived":{"type":"boolean","description":"true: archive the card; false: restore it from the archive"},"lane":{"type":"string","description":"With archived false: the lane to restore into (title or position as digits)"},"version":{"type":"string","description":"The board's version from kanban_get_board; refused when the board changed since"}}),
            &["path", "card"],
        ),
        spec(
            "kanban_card",
            "kanban_cards",
            "Duplicate a card (the copy goes just below it, with its color), delete it for good, or restore an archived card into `lane` (default the first lane). Returns the board and `card` (the copy's or the restored card's id).",
            "To copy, remove or bring back a card.",
            json!({"path":{"type":"string","description":"The board note"},"card":{"type":"string","description":"Card id from kanban_get_board"},"action":{"type":"string","enum":["duplicate","delete","restore"]},"lane":{"type":"string","description":"restore: the lane to restore into"},"version":{"type":"string","description":"The board's version from kanban_get_board; refused when the board changed since"}}),
            &["path", "card", "action"],
        ),
        spec(
            "kanban_lane",
            "kanban_cards",
            "Change the lanes of a board: add (`title`, `position`), rename (`lane`, `title`; the WIP limit and color stay), move (`lane`, `position` from 0), delete (an empty lane), duplicate (`lane`, optional new `title`; cards copied too), archive_cards (archive every card of `lane`), clear (delete every card of `lane`), color (`lane`, `color` or null), limit (`lane`, `max`: the WIP limit written ` (N)` after the title, 0 removes it). Returns the board.",
            "To organise a board's columns.",
            json!({"path":{"type":"string","description":"The board note"},"action":{"type":"string","enum":["add","rename","move","delete","duplicate","archive_cards","clear","color","limit"]},"lane":{"type":"string","description":"The lane: its title, or its position from 0 written as digits"},"title":{"type":"string","description":"add / rename / duplicate: the lane's name"},"position":{"type":"integer","minimum":0,"description":"add / move: position among the lanes, 0 = first"},"color":{"type":"string","description":"color: a color such as #22c55e, or null to clear"},"max":{"type":"integer","minimum":0,"description":"limit: most cards in the lane, 0 = no limit"},"version":{"type":"string","description":"The board's version from kanban_get_board; refused when the board changed since"}}),
            &["path", "action"],
        ),
        spec(
            "kanban_board",
            "kanban_boards",
            "Boards as notes. create: a new board note `title` in `folder` with `lanes` (default To do, Doing, Done) in the Obsidian Kanban format. convert: turn the note `path` into a board (headings become lanes, list items cards; other text is dropped and counted; the old text stays in the note's history). rename (`to` = new name), move (`to` or `folder` = destination folder), duplicate, delete (to the Trash): the same as the note tools, links and history follow. style: the board's `color` and `icon` (null clears). tag_color: `tag`'s `color` and `background` (Obsidian Kanban's tag-colors; color null removes it). settings: Obsidian Kanban settings as `settings` {key: value, null removes}: date-colors (array of {isToday?, isBefore?, isAfter?, distance?, unit?, direction?, color?, backgroundColor?}), tag-colors, lane-width, date-format, time-format, date-trigger, time-trigger, date-display-format, show-checkboxes, hide-tags-in-title, hide-date-in-title, show-relative-date, link-date-to-daily-note, new-card-insertion-method, archive-with-date, max-archive-size and the plugin's other display settings. One note is one board: for several boards in one note, create one board per board and embed each with kanban_embed.",
            "To start, convert, rename, move, copy, delete or style a board.",
            json!({"action":{"type":"string","enum":["create","convert","rename","move","duplicate","delete","style","tag_color","settings"]},"path":{"type":"string","description":"The board (or for convert, the note)"},"folder":{"type":"string","description":"create: the folder (default Memory; 'Root' = top level); move: the destination folder"},"title":{"type":"string","description":"create: the board's name"},"lanes":{"type":"array","items":{"type":"string"},"description":"create: the lane names; convert: names for the default To do / Doing / Done lanes"},"to":{"type":"string","description":"rename: the new name; move: the destination folder"},"color":{"type":"string","description":"style / tag_color: a color, or null to clear"},"icon":{"type":"string","description":"style: an emoji, or null to clear"},"tag":{"type":"string","description":"tag_color: the tag, e.g. #urgent"},"background":{"type":"string","description":"tag_color: the tag's background color"},"settings":{"type":"object","description":"settings: {key: value}; null removes a key"},"version":{"type":"string","description":"style / tag_color / settings: the board's version from kanban_get_board"}}),
            &["action"],
        ),
        spec(
            "kanban_embed",
            "kanban_embed",
            "Embed a board in a note: adds a line `![[Board name]]` at the end of `note` (after a blank line), which shows the board live there. With `remove` true, takes out every line that is only an embed of or a link to that board. `board` must be a board; a note can embed several boards (one board per board note). A normal save of the note.",
            "To show one or more boards inside a note, or to take one out.",
            json!({"note":{"type":"string","description":"The note to change (path or name)"},"board":{"type":"string","description":"The board to embed (path or name)"},"remove":{"type":"boolean","default":false,"description":"true: remove the board's embed lines instead"}}),
            &["note", "board"],
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
            "Pin an existing note or folder to the owner's Pinned list (shared by every browser), or move a pin to another position (an already pinned item without position keeps its place; already_pinned says so). Pins follow their note or folder through renames and moves; deleting the item removes its pin. At most 200 pins.",
            "When the owner asks to keep a note or folder at hand in the sidebar.",
            json!({"path":{"type":"string","description":"Vault path of a note (e.g. 'Work/Plan.md') or folder (e.g. 'Work')"},"kind":{"type":"string","enum":["note","folder"],"description":"Default: what the path is on disk"},"position":{"type":"integer","minimum":0,"description":"0 = top; default: the end"}}),
            &["path"],
        ),
        spec(
            "unpin",
            "ux",
            "Remove a note or folder from the owner's Pinned list. The note or folder itself is not touched. Without kind, a path that no longer exists (a missing pin) matches a pin of either kind.",
            "When the owner no longer wants an item pinned, or a pin is missing.",
            json!({"path":{"type":"string"},"kind":{"type":"string","enum":["note","folder"]}}),
            &["path"],
        ),
        spec(
            "rename_folder",
            "ops",
            "Rename a folder in place; its notes, sub folders, color and icon move along, and wikilinks naming its notes by path are rewritten (links_updated counts the notes changed). The name is one folder name (no / or \\); spaces become _ and characters other than letters, digits, _ and - are dropped (note says so). 'Root' is reserved.",
            "To fix or tidy a folder name.",
            json!({"folder":{"type":"string","description":"Folder path, e.g. 'Work/Plans'"},"name":{"type":"string","description":"New name (one segment)"}}),
            &["folder", "name"],
        ),
        spec(
            "move_folder",
            "ops",
            "Move a folder with everything in it into another folder ('' or 'Root' = top level). A missing destination folder is created (created: true). Wikilinks naming its notes by path are rewritten (links_updated counts the notes changed).",
            "To nest a folder under another, or lift a sub folder out to the top.",
            json!({"folder":{"type":"string"},"into":{"type":"string","description":"Destination parent folder, relative to the vault; '' or 'Root' = top level"}}),
            &["folder"],
        ),
        spec(
            "move_folder_contents",
            "ops",
            "Move every note and sub folder inside a folder into another folder, then remove the emptied folder. Clashing names get a -N suffix; a missing destination is created (created: true); wikilinks to the moved notes are rewritten (links_updated). If a move fails part way, the error names the item and lists what already moved.",
            "To merge one folder into another or flatten a folder.",
            json!({"folder":{"type":"string"},"into":{"type":"string","description":"Destination folder, relative to the vault; '' or 'Root' = top level"}}),
            &["folder"],
        ),
        spec(
            "delete_folder",
            "ops",
            "Delete a folder. By default its notes (at any depth) move up to the folder's parent (Root for a top-level folder), keeping the sub folder structure below it: deleting A/B moves A/B/n.md to A/n.md and A/B/C/m.md to A/C/m.md. `into` moves them into another existing folder instead (same structure below it). Clashing names get a -N suffix; other files in the folder are deleted; wikilinks to the moved notes are rewritten. The result lists moved (new paths) and moved_to. mode \"trash\" moves every note to .Trash instead (list_trash / restore_trash bring them back; links are left as they are) and lists them in trashed.",
            "To clear folder structure you no longer use.",
            json!({"folder":{"type":"string"},"into":{"type":"string","description":"Existing folder that receives the notes; omit for the folder's parent, 'Root' = top level. Not with mode trash."},"mode":{"type":"string","enum":["move","trash"],"description":"move (default): keep the notes by moving them; trash: move every note to .Trash"}}),
            &["folder"],
        ),
    ]
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/// Most entries `get_events`, `get_logs` and `search_logs` return in one call.
pub const MAX_LOG_LIMIT: i64 = 2000;

/// The `limit` argument of the event / log tools: `default` when absent, refused
/// outside 1..=[`MAX_LOG_LIMIT`].
fn limit_arg(args: &Value, default: usize) -> anyhow::Result<usize> {
    match args.get("limit") {
        None | Some(Value::Null) => Ok(default),
        Some(v) => match v.as_i64() {
            Some(n) if (1..=MAX_LOG_LIMIT).contains(&n) => Ok(n as usize),
            _ => anyhow::bail!("limit must be 1-{MAX_LOG_LIMIT} (got {v})"),
        },
    }
}

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
                let limit = match args.get("limit") {
                    None | Some(Value::Null) => 20,
                    Some(v) => match v.as_i64() {
                        Some(n) if n >= 1 => n as usize,
                        _ => anyhow::bail!("limit must be a whole number of at least 1"),
                    },
                };
                json!(store.get_history_impl(&s("path"), limit)?)
            }
            "get_note_at" => {
                // Shape: {ok, path, rev, content}.
                let p = s("path");
                let r = s("rev");
                json!({"ok": true, "path": p, "rev": r,
                       "content": store.get_note_at_impl(&p, &r)?})
            }
            "diff" => store.diff_impl(&s("path"), &s("rev_a"), &s("rev_b"))?,
            "restore_memory" => {
                let p = s("path");
                let v = store.restore_impl(&p, &s("rev"))?;
                crate::publish_node("node_updated", actor, store, &p);
                v
            }
            "snapshot" => store.snapshot_impl(&s("label"))?,
            "soft_delete" => {
                let p = s("path");
                let r = store.soft_delete_impl(&p)?;
                crate::publish_node("node_deleted", actor, store, &p);
                r
            }
            "list_trash" => json!(store.list_trash_impl()),
            "restore_trash" => {
                // No `into`: back to where the note was deleted from.
                let r = store.restore_trash_impl(&s("name"), &s("into"))?;
                if let Some(p) = r.get("path").and_then(|v| v.as_str()) {
                    let p = p.to_string();
                    crate::publish_node("node_created", actor, store, &p);
                }
                r
            }

            // ---------------- write ----------------
            "batch_create" => {
                let out = store.batch_create_impl(&arr("notes"))?;
                // One node_created per note, as create_memory sends, so open browsers
                // and digest see them.
                for r in &out {
                    if let Some(p) = r.get("path").and_then(|v| v.as_str()) {
                        crate::publish_node("node_created", actor, store, p);
                    }
                }
                json!(out)
            }
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
                let paths = match args.get("paths") {
                    None | Some(Value::Null) => None,
                    Some(Value::Array(a)) => Some(a.clone()),
                    Some(_) => anyhow::bail!("paths must be an array of strings"),
                };
                store.bulk_delete_impl(paths.as_deref(), opt("folder").as_deref())?
            }

            // ---------------- collab ----------------
            // Need the caller's identity: handled in `McpServer::exec_tool`.
            "lock_node" | "release_lock" => anyhow::bail!("{name} is handled by the server"),
            "get_locks" => json!(store.get_locks_impl()),
            "mention_agent" => store.mention_agent_impl(&s("agent"), &s("path"), &s("message"))?,
            "get_assignments" => json!(store.get_assignments_impl(opt("agent").as_deref())),

            // ---------------- events / ops ----------------
            "get_events" => json!(store.get_events_impl(
                args.get("since").and_then(|v| v.as_f64()),
                opt("folder").as_deref(),
                opt("actor").as_deref(),
                limit_arg(args, 50)?,
            )),
            "presence" => {
                let window = match args.get("window") {
                    None | Some(Value::Null) => 300,
                    Some(v) => v.as_i64().filter(|n| *n >= 1).ok_or_else(|| {
                        anyhow::anyhow!(
                            "window must be at least 1 second (got {v}); leave it out for 300"
                        )
                    })?,
                };
                json!(store.presence_impl(window))
            }
            "get_logs" | "search_logs" => {
                let range = s("range");
                if !MemoryStore::log_range_ok(&range) {
                    anyhow::bail!("unknown range {range:?}: use {}", MemoryStore::LOG_RANGES);
                }
                let range = if range.trim().is_empty() {
                    if name == "get_logs" { "1d" } else { "7d" }.to_string()
                } else {
                    range
                };
                let q = if name == "search_logs" {
                    s("q")
                } else {
                    String::new()
                };
                store.get_logs_impl(&range, &q, &s("actor"), limit_arg(args, 100)?)
            }
            "digest" => store.digest_impl(
                opt("folder").as_deref(),
                args.get("since").and_then(|v| v.as_f64()),
                i("limit", 50),
            ),
            "healthcheck" => store.healthcheck_impl(),
            "folder_stats" => store.folder_stats_impl(&s("folder"))?,
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
            "get_folder_meta" => store.get_folder_meta_impl(opt("folder").as_deref())?,

            // ---------------- identity ----------------
            // Needs the key list: handled in `McpServer::set_my_name`.
            "set_my_name" => anyhow::bail!("{name} is handled by the server"),
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
                write_private(&dest, &bytes)?;
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
            "upload_image" => {
                let note = s("path");
                let Some(bytes) = memora_core::vault::decode_base64(&s("data")) else {
                    anyhow::bail!(
                        "data must be the image as base64 (or a data:image/...;base64, URL)"
                    );
                };
                let mut out = store.save_image_impl(
                    &note,
                    &s("name"),
                    &bytes,
                    memora_core::vault::image_max_bytes(),
                )?;
                if b("append", false) {
                    let alt = opt("alt")
                        .unwrap_or_else(|| out["name"].as_str().unwrap_or("image").to_string());
                    let line = format!(
                        "![{}](path:{})",
                        alt.replace(['[', ']', '\n'], " "),
                        out["name"].as_str().unwrap_or("")
                    );
                    store.patch_memory_impl(
                        &note,
                        &[json!({"op": "append", "text": format!("\n{line}\n")})],
                    )?;
                    out["appended"] = json!(true);
                    out["markdown"] = json!(line);
                }
                out
            }
            "list_images" => match opt("path") {
                Some(p) => store.note_images_impl(&p)?,
                None => {
                    let folder = opt("folder").unwrap_or_else(|| "Root".to_string());
                    json!({"folder": folder, "images": store.folder_images_impl(&folder)?})
                }
            },
            "get_todos" => json!(store.get_todos_impl(opt("path").as_deref())?),
            "follow_ups" => store.follow_ups_impl(i("limit", 50)),
            "validate_memory" => store.validate_memory_impl(&s("path"))?,

            // ---------------- kanban ----------------
            "kanban_list_boards" => {
                let boards = store.kanban_list_impl(opt("folder").as_deref())?;
                json!({"count": boards.len(), "boards": boards})
            }
            "kanban_due" => store.kanban_due_impl(
                opt("today").as_deref(),
                args.get("days")
                    .and_then(|v| v.as_u64())
                    .map(|d| d.min(366) as u32),
                opt("range").as_deref(),
                opt("folder").as_deref(),
            )?,
            "kanban_get_board" => store.kanban_get_impl(&s("path"), false)?,
            "kanban_add_card" | "kanban_move_card" | "kanban_update_card" | "kanban_card"
            | "kanban_lane" => {
                let op = kanban_op(name, args)?;
                kanban_apply(store, actor, &s("path"), opt("version").as_deref(), &op)?
            }
            "kanban_board" => kanban_board(store, actor, args)?,
            "kanban_embed" => {
                let v = store.kanban_embed_impl(&s("note"), &s("board"), b("remove", false))?;
                if v["changed"] == json!(true) {
                    if let Some(rel) = v["note"].as_str() {
                        crate::publish_node("node_updated", actor, store, rel);
                    }
                }
                v
            }

            // ---------------- misc ----------------
            "delete_folder" => folder_changed(
                actor,
                store.delete_folder_with(
                    &s("folder"),
                    opt("into").as_deref(),
                    opt("mode").as_deref(),
                )?,
            ),
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

/// Apply a board edit and tell open browsers when the note changed.
fn kanban_apply(
    store: &MemoryStore,
    actor: &str,
    path: &str,
    version: Option<&str>,
    op: &memora_core::vault::kanban::Op,
) -> anyhow::Result<Value> {
    let v = store.kanban_apply_impl(path, version, op, false)?;
    if v["changed"] == json!(true) {
        if let Some(rel) = v["path"].as_str() {
            crate::publish_node("node_updated", actor, store, rel);
        }
    }
    Ok(v)
}

/// `kanban_board`: boards as notes (create, convert, rename, move, duplicate, delete) and
/// their look (style, tag colors, settings).
fn kanban_board(store: &MemoryStore, actor: &str, args: &Value) -> anyhow::Result<Value> {
    use memora_core::vault::kanban::Op;
    let s = |k: &str| {
        args.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let lanes: Option<Vec<String>> = args.get("lanes").and_then(|v| v.as_array()).map(|a| {
        a.iter()
            .filter_map(|x| x.as_str().map(str::to_string))
            .collect()
    });
    let need = |k: &str, what: &str| {
        let v = s(k);
        if v.is_empty() {
            anyhow::bail!("{k} is required for this action: {what}");
        }
        Ok(v)
    };
    let action = s("action");
    let path = || need("path", "the board");
    let version = args.get("version").and_then(|v| v.as_str());
    let apply = |op: Op| -> anyhow::Result<Value> {
        let p = path()?;
        kanban_apply(store, actor, &p, version, &op)
    };
    Ok(match action.as_str() {
        "create" => {
            let title = need("title", "the board's name")?;
            let folder = match s("folder") {
                f if f.is_empty() => "Memory".to_string(),
                f => f,
            };
            let rel = store.kanban_create_impl(&folder, &title, lanes.as_deref())?;
            crate::publish_node("node_created", actor, store, &rel);
            let mut v = store.kanban_get_impl(&rel, false)?;
            v["ok"] = json!(true);
            v["created"] = json!(true);
            crate::with_title_notice(v, &title, &rel)
        }
        "convert" => {
            let r = store.kanban_convert_impl(&path()?, lanes.as_deref())?;
            let rel = r["path"].as_str().unwrap_or_default().to_string();
            crate::publish_node("node_updated", actor, store, &rel);
            let mut v = store.kanban_get_impl(&rel, false)?;
            v["ok"] = json!(true);
            v["converted"] =
                json!({"lanes": r["lanes"], "cards": r["cards"], "dropped": r["dropped"]});
            v
        }
        "rename" => {
            let from = store.kanban_board_path(&path()?)?;
            let (to, links) = store.rename_note(&from, &need("to", "the new name")?)?;
            memora_core::events::hub().publish(json!({
                "type": "node_renamed", "actor": actor,
                "old_path": from, "node": store.node_payload(&to),
            }));
            json!({"ok": true, "from": from, "path": to, "links_updated": links})
        }
        "move" => {
            let from = store.kanban_board_path(&path()?)?;
            let folder = match s("to") {
                t if t.is_empty() => need("folder", "the destination folder ('Root' = top level)")?,
                t => t,
            };
            let (to, links) = store.move_note(&from, &folder)?;
            memora_core::events::hub().publish(json!({
                "type": "node_renamed", "actor": actor,
                "old_path": from, "node": store.node_payload(&to),
            }));
            json!({"ok": true, "from": from, "to": to, "path": to, "links_updated": links})
        }
        "duplicate" => {
            let from = store.kanban_board_path(&path()?)?;
            let to = store.duplicate_memory_impl(&from)?;
            crate::publish_node("node_created", actor, store, &to);
            json!({"ok": true, "from": from, "path": to})
        }
        "delete" => {
            let p = store.kanban_board_path(&path()?)?;
            let r = store.soft_delete_impl(&p)?;
            let id = std::path::Path::new(&p)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            memora_core::events::hub().publish(json!({
                "type": "node_deleted", "actor": actor, "id": id, "path": p,
                "trashed": true, "to": r["to"],
            }));
            json!({"ok": true, "path": p, "trashed": true, "to": r["to"]})
        }
        "style" => {
            let mut o = json!({"type": "set_board_style"});
            for k in ["color", "icon"] {
                if let Some(v) = args.get(k) {
                    o[k] = v.clone();
                }
            }
            apply(Op::from_json(&o)?)?
        }
        "tag_color" => {
            let mut o = json!({"type": "set_tag_color", "tag": need("tag", "the tag, e.g. #urgent")?,
                "color": args.get("color").cloned().unwrap_or(Value::Null)});
            if let Some(b) = args.get("background") {
                o["background"] = b.clone();
            }
            apply(Op::from_json(&o)?)?
        }
        "settings" => {
            let Some(set) = args.get("settings").filter(|v| v.is_object()) else {
                anyhow::bail!("settings is required for this action: an object of setting keys and values (null removes one)");
            };
            apply(Op::from_json(
                &json!({"type": "set_settings", "settings": set}),
            )?)?
        }
        "" => anyhow::bail!("action is required"),
        other => anyhow::bail!("unknown action {other:?}"),
    })
}

/// The board edit a kanban card or lane tool asks for.
fn kanban_op(name: &str, args: &Value) -> anyhow::Result<memora_core::vault::kanban::Op> {
    use memora_core::vault::kanban::{CardEdit, LaneRef, Op};
    let s = |k: &str| {
        args.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    let lane = |k: &str| args.get(k).and_then(LaneRef::from_json);
    let position = args
        .get("position")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize);
    let need_lane = || {
        lane("lane")
            .ok_or_else(|| anyhow::anyhow!("lane is required: a lane title or its position"))
    };
    let color = || -> anyhow::Result<Option<String>> {
        match args.get("color") {
            None => anyhow::bail!("color is required: a color such as #22c55e, or null to clear"),
            Some(c) => Ok(memora_core::vault::kanban::card::clean_color(c)?),
        }
    };
    Ok(match name {
        "kanban_add_card" => {
            let edit = CardEdit::from_json(args, false)?;
            Op::AddCard {
                lane: need_lane()?,
                text: s("text"),
                position,
                checked: args
                    .get("checked")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                edit: (!edit.is_empty()).then(|| Box::new(edit)),
            }
        }
        "kanban_move_card" => Op::MoveCard {
            card: s("card"),
            lane: need_lane()?,
            position,
        },
        "kanban_card" => match s("action").as_str() {
            "duplicate" => Op::DuplicateCard { card: s("card") },
            "delete" => Op::DeleteCard { card: s("card") },
            "restore" => Op::RestoreCard {
                card: s("card"),
                lane: lane("lane"),
            },
            other => anyhow::bail!("unknown action {other:?}: use duplicate, delete or restore"),
        },
        "kanban_lane" => {
            let title = || -> anyhow::Result<String> {
                let t = s("title");
                if t.trim().is_empty() {
                    anyhow::bail!("title is required for this action: the lane's name");
                }
                Ok(t)
            };
            match s("action").as_str() {
                "add" => Op::AddLane {
                    title: title()?,
                    position,
                },
                "rename" => Op::RenameLane {
                    lane: need_lane()?,
                    title: title()?,
                },
                "move" => Op::MoveLane {
                    lane: need_lane()?,
                    position: position.ok_or_else(|| {
                        anyhow::anyhow!("position is required to move a lane (0 = first)")
                    })?,
                },
                "delete" => Op::DeleteLane { lane: need_lane()? },
                "duplicate" => Op::DuplicateLane {
                    lane: need_lane()?,
                    title: Some(s("title")).filter(|t| !t.trim().is_empty()),
                },
                "archive_cards" => Op::ArchiveLaneCards { lane: need_lane()? },
                "clear" => Op::ClearLane { lane: need_lane()? },
                "color" => Op::SetLaneColor {
                    lane: need_lane()?,
                    color: color()?,
                },
                "limit" => Op::SetLaneLimit {
                    lane: need_lane()?,
                    max: args.get("max").and_then(|v| v.as_u64()).ok_or_else(|| {
                        anyhow::anyhow!("max is required: the most cards in the lane, 0 = no limit")
                    })?,
                },
                other => anyhow::bail!(
                    "unknown action {other:?}: use add, rename, move, delete, duplicate, archive_cards, clear, color or limit"
                ),
            }
        }
        _ => {
            let edit = CardEdit::from_json(args, true)?;
            match args.get("archived").and_then(|v| v.as_bool()) {
                Some(true) if edit.is_empty() => Op::ArchiveCard { card: s("card") },
                Some(false) if edit.is_empty() => Op::RestoreCard {
                    card: s("card"),
                    lane: lane("lane"),
                },
                Some(_) => anyhow::bail!(
                    "archived is a change of its own: call kanban_update_card once for the card's fields, then again for archived"
                ),
                None => Op::EditCard {
                    card: s("card"),
                    edit: Box::new(edit),
                },
            }
        }
    })
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

/// The full path of `name` in the exchange folder `dir`. Only plain `.zip` names
/// (`[A-Za-z0-9._-]`, no leading dot) are accepted, so no other path can be reached.
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

/// Write an exchange zip readable by the server's user only (0600 on Unix).
fn write_private(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let _ = std::fs::remove_file(path);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)?.write_all(bytes)
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
    fn delete_folder_takes_into_and_trash_mode() {
        use serde_json::json;
        let d = tmp("delfolder");
        for (f, body) in [("A/B/n.md", "n"), ("Keep/k.md", "k"), ("T/S/t.md", "t")] {
            let p = d.join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
        let store = memora_core::MemoryStore::new(&d);
        let call = |args: serde_json::Value| {
            super::call_extra(&store, "delete_folder", &args, "test", &d.join("x")).unwrap()
        };
        let v = call(json!({"folder": "A/B", "into": "Keep"})).unwrap();
        assert_eq!(v["moved_to"], "Keep");
        assert!(d.join("Keep/n.md").is_file() && !d.join("A/B").exists());
        assert!(call(json!({"folder": "T", "mode": "wipe"})).is_err());
        assert!(call(json!({"folder": "T", "into": "Keep", "mode": "trash"})).is_err());
        let v = call(json!({"folder": "T", "mode": "trash"})).unwrap();
        assert_eq!(v["count"], 1);
        assert!(!d.join("T").exists() && d.join(".Trash/t.md").is_file());
        std::fs::remove_dir_all(&d).ok();
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
