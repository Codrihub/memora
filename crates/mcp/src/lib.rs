//! MCP server: tool catalog and JSON-RPC 2.0 transport for the MCP spec.
//!
//! Implements:
//!   * `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`
//!   * a tool catalog with name, description (what it does and when to use it),
//!     category, and input schema
//!   * a discovery card served at `/.well-known/mcp.json`
//!   * MCP client detection from the JSON-RPC body, headers, or user-agent
//!
//! Every tool maps onto `memora_core::MemoryStore`, so anything the UI can do
//! an agent can do over MCP.

use memora_core::privacy::PathView;
use memora_core::MemoryStore;
use memora_gateway::{KeyPermissions, ToolDenial};
use memora_state::Db;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::sync::{Arc, Mutex, RwLock};

pub mod activity;
pub mod privacy;
pub mod tools;

pub const SERVER_NAME: &str = "memora";
pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Full catalog: the base tools plus the additional ones defined in `tools`.
pub fn catalog() -> Vec<ToolSpec> {
    let mut v = base_catalog();
    v.extend(tools::extra_specs());
    v
}

// ---------------------------------------------------------------------------
// Tool catalog
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ToolSpec {
    pub name: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    /// When to use the tool, to help an agent pick the right one.
    pub when: &'static str,
    pub input_schema: Value,
}

fn obj(props: Value, required: &[&str]) -> Value {
    json!({"type":"object","properties":props,"required":required})
}

/// Names of every registered tool (base + additional). Used by the coverage test.
pub fn all_tool_names() -> Vec<&'static str> {
    let mut v: Vec<&'static str> = base_catalog().iter().map(|t| t.name).collect();
    v.extend(tools::extra_names());
    v.sort_unstable();
    v
}

/// Base catalog. The remaining tools live in `tools.rs`.
pub fn base_catalog() -> Vec<ToolSpec> {
    use serde_json::json as j;
    vec![
        ToolSpec {
            name: "get_stats",
            category: "search",
            description: "Counts of notes, links, and folders in the vault.",
            when: "First call to size up the vault before exploring.",
            input_schema: obj(j!({}), &[]),
        },
        ToolSpec {
            name: "list_memory",
            category: "note",
            description: "Every note grouped by folder, most recently modified first.",
            when: "To see the vault structure or browse without a keyword.",
            input_schema: obj(j!({}), &[]),
        },
        ToolSpec {
            name: "read_memory",
            category: "note",
            description: "Read one note: markdown body, frontmatter, tags, and backlinks.",
            when: "After search or list gives you a path.",
            input_schema: obj(
                j!({"path": {"type":"string","description":"Relative path, e.g. 'Tech/foo.md'"}}),
                &["path"],
            ),
        },
        ToolSpec {
            name: "create_memory",
            category: "note",
            description: "Create a new note in a folder.",
            when: "To store new information.",
            input_schema: obj(
                j!({
                    "title": {"type":"string","description":"Note title; also the file name"},
                    "folder": {"type":"string","description":"Folder path, e.g. 'Tech' ('Root' = top level)","default":"Memory"},
                    "content": {"type":"string","description":"Markdown body (omit for a stub with frontmatter)"}
                }),
                &["title"],
            ),
        },
        ToolSpec {
            name: "save_memory",
            category: "note",
            description: "Replace the entire content of an existing note.",
            when: "For a full rewrite; use patch_memory for small edits.",
            input_schema: obj(
                j!({"path": {"type":"string"}, "content": {"type":"string"}}),
                &["path", "content"],
            ),
        },
        ToolSpec {
            name: "patch_memory",
            category: "note",
            description:
                "Apply partial edits: append, prepend, replace, set_field, add_tag, remove_tag.",
            when: "Cheaper than save_memory for small changes.",
            input_schema: obj(
                j!({"path": {"type":"string"}, "ops": {"type":"array","items":{"type":"object"}}}),
                &["path", "ops"],
            ),
        },
        ToolSpec {
            name: "delete_memory",
            category: "note",
            description: "Delete a note (recoverable from git history).",
            when: "To discard a note you no longer need.",
            input_schema: obj(j!({"path": {"type":"string"}}), &["path"]),
        },
        ToolSpec {
            name: "move_memory",
            category: "note",
            description: "Move a note into another folder.",
            when: "To tidy the vault; wikilinks survive because they resolve by note name.",
            input_schema: obj(
                j!({"path": {"type":"string"}, "folder": {"type":"string"}}),
                &["path", "folder"],
            ),
        },
        ToolSpec {
            name: "rename_memory",
            category: "note",
            description: "Rename a note in place, keeping its folder.",
            when: "To fix a title without moving the note.",
            input_schema: obj(
                j!({"path": {"type":"string"}, "new_name": {"type":"string"}}),
                &["path", "new_name"],
            ),
        },
        ToolSpec {
            name: "search_memory",
            category: "search",
            description: "Search notes by words in the title or body; supports `tag:x` and `#x`.",
            when: "Main entry point for finding information.",
            input_schema: obj(
                j!({"q": {"type":"string"}, "limit": {"type":"integer","default":12}}),
                &["q"],
            ),
        },
        ToolSpec {
            name: "get_graph",
            category: "graph",
            description: "The whole memory graph: nodes (notes) and resolved wikilink edges.",
            when: "To understand how notes relate to each other.",
            input_schema: obj(j!({}), &[]),
        },
        ToolSpec {
            name: "get_neighbors",
            category: "graph",
            description: "Notes within N hops of a given note.",
            when: "To explore the context around one topic.",
            input_schema: obj(
                j!({"path": {"type":"string"}, "depth": {"type":"integer","default":1}}),
                &["path"],
            ),
        },
        ToolSpec {
            name: "broken_links",
            category: "graph",
            description: "Wikilinks that point at notes that do not exist.",
            when: "Vault health check.",
            input_schema: obj(j!({}), &[]),
        },
        ToolSpec {
            name: "get_tags",
            category: "tag",
            description: "Every tag in the vault with its usage count.",
            when: "To see the existing taxonomy before adding a new tag.",
            input_schema: obj(j!({}), &[]),
        },
        ToolSpec {
            name: "search_by_tag",
            category: "tag",
            description: "Every note carrying a given tag.",
            when: "To collect notes that share a theme.",
            input_schema: obj(j!({"tag": {"type":"string"}}), &["tag"]),
        },
        ToolSpec {
            name: "list_folders",
            category: "folder",
            description: "Folders with their note counts and stored color/icon.",
            when: "Before creating or moving notes, to keep folders consistent.",
            input_schema: obj(j!({}), &[]),
        },
        ToolSpec {
            name: "create_folder",
            category: "folder",
            description: "Create a new folder.",
            when: "To set up a home for a new topic.",
            input_schema: obj(j!({"name": {"type":"string"}}), &["name"]),
        },
    ]
}

/// Discovery card served at `/.well-known/mcp.json`.
/// `disabled` are the globally switched-off tools ([`McpServer::disabled_tools`]).
pub fn discovery_card(endpoint: &str, disabled: &BTreeSet<String>) -> Value {
    // Full catalog, with globally disabled tools marked `enabled: false`.
    let tools = tools_status(disabled)["tools"].clone();
    json!({
        "name": SERVER_NAME,
        "version": SERVER_VERSION,
        "description": "Memora: a markdown vault with graph, search, and history, fully controllable over MCP.",
        "mcp": {
            "endpoint": endpoint,
            "transports": ["streamable-http"],
            "protocolVersion": "2025-06-18"
        },
        "auth": {
            "type": "api-key",
            "headers": ["Authorization: Bearer <key>", "X-API-Key: <key>"],
            "oauth": "/.well-known/oauth-authorization-server"
        },
        "capabilities": {"tools": true, "resources": true, "prompts": false},
        "tools": tools,
        "resources": [{"uri":"memory://catalog","name":"Tool catalog"},{"uri":"memory://schema","name":"Data schema"},{"uri":"memory://guide","name":"Agent guide"}]
    })
}

// ---------------------------------------------------------------------------
// MCP client detection
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum ClientKind {
    Mcp,
    Web,
    Api,
}

/// Classify a request as an MCP client, a browser, or a plain API call.
/// Order: path, then headers (MCP session id, user-agent), then JSON-RPC shape.
pub fn detect_client(path: &str, headers: &[(String, String)], body: Option<&Value>) -> ClientKind {
    if path.starts_with("/mcp") {
        return ClientKind::Mcp;
    }
    for (k, v) in headers {
        let k = k.to_lowercase();
        if k == "mcp-session-id" {
            return ClientKind::Mcp;
        }
        if k == "user-agent" {
            let v = v.to_lowercase();
            for marker in [
                "claude", "cursor", "cline", "mcp", "hermes", "continue", "zed",
            ] {
                if v.contains(marker) {
                    return ClientKind::Mcp;
                }
            }
        }
    }
    if let Some(b) = body {
        if let Some(m) = b.get("method").and_then(|m| m.as_str()) {
            if matches!(
                m,
                "initialize" | "tools/list" | "tools/call" | "resources/list"
            ) {
                return ClientKind::Mcp;
            }
        }
    }
    ClientKind::Web
}

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub jsonrpc: Option<String>,
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct RpcResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

pub fn ok(id: Value, result: Value) -> RpcResponse {
    RpcResponse {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    }
}

pub fn err(id: Value, code: i64, message: impl Into<String>) -> RpcResponse {
    RpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(RpcError {
            code,
            message: message.into(),
        }),
    }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/// Actor/alias record for per-connection tracking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AliasRecord {
    pub alias: String,
    pub key_id: String,
    /// The API key's name when it was registered (`None` for older records).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_name: Option<String>,
    pub first_seen: i64,
    pub last_seen: i64,
    pub connections: u64,
}

/// MCP protocol revisions this server speaks, newest first.
pub const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

/// The client's requested revision when supported, else the newest one.
fn negotiate_version(params: &Value) -> &'static str {
    let want = params
        .get("protocolVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    PROTOCOL_VERSIONS
        .iter()
        .find(|v| **v == want)
        .copied()
        .unwrap_or(PROTOCOL_VERSIONS[0])
}

/// Who is calling the MCP server, and with which permissions.
#[derive(Debug, Clone)]
pub struct Caller {
    /// Actor id for activity tracking and the activity log
    /// (the key id for API keys, the user name for browser sessions).
    pub id: String,
    /// Display name: the API key's name (see [`Caller::named`]). `None` for browser
    /// sessions and local use, where `id` already is the user name.
    pub name: Option<String>,
    /// `None` = full access (browser session, local stdio). Global tool
    /// switches still apply.
    pub perms: Option<KeyPermissions>,
    /// Caller IP, for the activity log.
    pub ip: Option<String>,
}

impl Caller {
    /// A full-access caller (browser session or local use).
    pub fn full(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: None,
            perms: None,
            ip: None,
        }
    }

    /// An API key caller.
    pub fn key(id: impl Into<String>, perms: KeyPermissions, ip: Option<String>) -> Self {
        Self {
            id: id.into(),
            name: None,
            perms: Some(perms),
            ip,
        }
    }

    /// Set the display name (an API key's name). Blank names are ignored.
    pub fn named(mut self, name: impl Into<String>) -> Self {
        let n: String = name.into();
        let n = n.trim();
        self.name = (!n.is_empty()).then(|| n.to_string());
        self
    }

    /// Who the realtime events and the vault event log name: the key's name for an
    /// API key (falling back to its id), the user name for a browser session.
    pub fn actor(&self) -> &str {
        self.name.as_deref().unwrap_or(&self.id)
    }

    /// `"agent"` for API keys, `"user"` for browser sessions and local use.
    pub fn actor_kind(&self) -> &'static str {
        if self.perms.is_some() {
            "agent"
        } else {
            "user"
        }
    }

    /// Whether the caller may use the MCP admin tools (`admin` + `mcp` scopes
    /// on an enabled key, or a full-access caller).
    pub fn is_admin(&self) -> bool {
        match &self.perms {
            None => true,
            Some(p) => p.enabled && p.has_scope("mcp") && p.has_scope("admin"),
        }
    }

    /// Name written to the activity log's `user` field.
    pub fn log_name(&self) -> String {
        match self.perms {
            Some(_) => format!("key:{}", self.id),
            None => self.id.clone(),
        }
    }
}

/// The key scope catalog tool `name` needs besides `mcp`: `write` for every tool that
/// is not read-only (fail closed, so a new tool needs `write` until it is listed as
/// read-only), none for read-only tools.
pub fn required_scope(name: &str) -> Option<&'static str> {
    (!activity::is_read_only(name)).then_some("write")
}

/// The scope an API key caller lacks for catalog tool `name`, if any. Full-access
/// callers lack nothing.
fn missing_scope(caller: &Caller, name: &str) -> Option<&'static str> {
    let p = caller.perms.as_ref()?;
    required_scope(name).filter(|s| !p.has_scope(s))
}

/// Admin tools: only listed and callable for keys with the `admin` scope.
/// They are not part of `catalog()`, so they cannot be switched off
/// globally or granted through a key's `tools` list.
pub fn admin_catalog() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "admin_list_tools",
            category: "admin",
            description: "Every MCP tool on this server with its global on/off switch.",
            when: "Before changing which tools are available.",
            input_schema: obj(json!({}), &[]),
        },
        ToolSpec {
            name: "admin_set_tool",
            category: "admin",
            description: "Switch one tool on or off for every API key on this server.",
            when: "To disable a risky tool (e.g. delete_memory) server-wide, or re-enable it.",
            input_schema: obj(
                json!({"name": {"type":"string"}, "enabled": {"type":"boolean"}}),
                &["name", "enabled"],
            ),
        },
        ToolSpec {
            name: "privacy_list",
            category: "admin",
            description: "Privacy rules that hide notes or folders from agents. With `path`: \
                that note or folder's own rule, the folder rules it inherits, and which agents \
                can see it. Without: every rule.",
            when: "Before changing which agents may see a note or folder.",
            input_schema: obj(
                json!({"path": {"type":"string","description":"Vault path of a note (with .md) or folder"},
                       "kind": {"type":"string","enum":["node","folder"]}}),
                &[],
            ),
        },
        ToolSpec {
            name: "privacy_set",
            category: "admin",
            description: "Hide a note (kind node) or a folder and everything in it (kind \
                folder) from agents. mode deny (default): hidden from the listed agents. \
                mode allow_only: only the listed agents can see it. Agents are key ids or \
                names. Replaces the path's rule; a node rule follows the note when it is \
                renamed or moved. The owner always sees everything.",
            when: "When the owner asks to keep a note or folder away from some agents.",
            input_schema: obj(
                json!({"path": {"type":"string"},
                       "kind": {"type":"string","enum":["node","folder"]},
                       "mode": {"type":"string","enum":["deny","allow_only"],"default":"deny"},
                       "agents": {"type":"array","items":{"type":"string"}}}),
                &["path", "agents"],
            ),
        },
        ToolSpec {
            name: "privacy_clear",
            category: "admin",
            description: "Remove the privacy rule of a note or folder (rules of parent \
                folders still apply).",
            when: "When a note or folder should be visible to every agent again.",
            input_schema: obj(
                json!({"path": {"type":"string"}, "kind": {"type":"string","enum":["node","folder"]}}),
                &["path"],
            ),
        },
    ]
}

/// `{tools: [{name, category, description, enabled}]}` (GET /api/tools,
/// `admin_list_tools`).
pub fn tools_status(disabled: &BTreeSet<String>) -> Value {
    json!({"tools": catalog().iter().map(|t| json!({
        "name": t.name, "category": t.category, "description": t.description,
        "enabled": !disabled.contains(t.name),
    })).collect::<Vec<_>>()})
}

/// Whether `name` is a tool in the (switchable) catalog.
pub fn is_catalog_tool(name: &str) -> bool {
    catalog().iter().any(|t| t.name == name)
}

/// Mirror the MCP catalog into the state database (table `tool`), so global switches and
/// per-key tool grants can reference it. Run once at server start, before the caches
/// load and before the legacy import (whose per-key tool lists need the catalog).
pub fn sync_catalog(db: &Db) -> memora_state::Result<memora_state::tools::CatalogSync> {
    let names: Vec<&'static str> = catalog().iter().map(|t| t.name).collect();
    db.write(|tx| memora_state::tools::sync_catalog(tx, &names))
}

pub struct McpServer {
    store: Arc<Mutex<MemoryStore>>,
    aliases: Arc<Mutex<Vec<AliasRecord>>>,
    db: Db,
    /// Globally disabled tools (table `tool_disabled`). Loaded at construction and
    /// refreshed by [`McpServer::reload_tools`], which the HTTP server calls when the
    /// `tools` domain changes (another process, e.g. `memora-cli`, switched a tool).
    disabled: RwLock<BTreeSet<String>>,
}

impl McpServer {
    /// MCP server over `store`; tool switches live in `db`. The catalog must already be
    /// synced into `db` ([`sync_catalog`]).
    pub fn new(store: Arc<Mutex<MemoryStore>>, db: Db) -> Self {
        let srv = Self {
            store,
            aliases: Arc::new(Mutex::new(Vec::new())),
            db,
            disabled: RwLock::new(BTreeSet::new()),
        };
        // Privacy rules follow notes and folders through renames, moves and deletes.
        srv.store
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .set_path_hook(Some(privacy::path_hook(srv.db.clone())));
        srv.reload_tools();
        srv
    }

    /// The state database this server reads its tool switches from.
    pub fn db(&self) -> &Db {
        &self.db
    }

    /// The paths `caller` may see: `None` (everything) for full-access callers and for
    /// keys no privacy rule restricts; a filtering view otherwise (fail closed).
    pub fn view_for(&self, caller: &Caller) -> Option<Arc<dyn PathView>> {
        match caller.perms {
            None => None,
            Some(_) => privacy::view_for_key(&self.db, &caller.id),
        }
    }

    /// Re-read the global tool switches from the database. Keeps the previous set when
    /// the read fails (the database is busy for longer than its busy timeout).
    pub fn reload_tools(&self) -> bool {
        match self.db.read(memora_state::tools::disabled) {
            Ok(set) => {
                *self.disabled.write().unwrap_or_else(|e| e.into_inner()) = set;
                true
            }
            Err(_) => false,
        }
    }

    /// Globally disabled tools (cached; see [`McpServer::reload_tools`]).
    pub fn disabled_tools(&self) -> BTreeSet<String> {
        self.disabled
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Switch a catalog tool on or off, invalidate the cache and log it.
    pub fn set_tool_enabled(
        &self,
        name: &str,
        enabled: bool,
        ip: Option<&str>,
        user: Option<&str>,
    ) -> anyhow::Result<()> {
        if !is_catalog_tool(name) {
            anyhow::bail!("unknown tool: {name}");
        }
        let event = if enabled {
            "tool_enabled"
        } else {
            "tool_disabled"
        };
        self.db.write(|tx| {
            let now = memora_state::now();
            memora_state::tools::set_enabled(tx, name, enabled, now)?;
            let ev = memora_state::activity::NewActivity {
                event,
                ip,
                actor: user,
                detail: name,
            };
            memora_state::activity::log(tx, &ev, now)?;
            Ok(())
        })?;
        self.reload_tools();
        Ok(())
    }

    /// Catalog entries the caller may use (plus admin tools for admins).
    pub fn visible_tools(&self, caller: &Caller) -> Vec<ToolSpec> {
        let disabled = self.disabled_tools();
        let mut v: Vec<ToolSpec> = catalog()
            .into_iter()
            .filter(|t| {
                memora_gateway::tool_access(caller.perms.as_ref(), &disabled, t.name).is_ok()
                    && missing_scope(caller, t.name).is_none()
            })
            .collect();
        if caller.is_admin() {
            v.extend(admin_catalog());
        }
        v
    }

    /// Refusal for `tools/call`, if any. Unknown names return `None` and fall
    /// through to the normal "unknown tool" result.
    fn refusal(&self, caller: &Caller, name: &str) -> Option<String> {
        if admin_catalog().iter().any(|t| t.name == name) {
            return (!caller.is_admin()).then(|| ToolDenial::NotAllowed.message(name));
        }
        if !is_catalog_tool(name) {
            return None;
        }
        if let Err(d) =
            memora_gateway::tool_access(caller.perms.as_ref(), &self.disabled_tools(), name)
        {
            return Some(d.message(name));
        }
        missing_scope(caller, name)
            .map(|scope| format!("API key lacks the '{scope}' scope for tool: {name}"))
    }

    fn call_admin(&self, caller: &Caller, name: &str, args: &Value) -> anyhow::Result<Value> {
        match name {
            "admin_list_tools" => Ok(tools_status(&self.disabled_tools())),
            "privacy_list" | "privacy_set" | "privacy_clear" => {
                self.call_privacy(caller, name, args)
            }
            "admin_set_tool" => {
                let tool = args.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let Some(enabled) = args.get("enabled").and_then(|v| v.as_bool()) else {
                    anyhow::bail!("enabled (boolean) is required");
                };
                self.set_tool_enabled(
                    tool,
                    enabled,
                    caller.ip.as_deref(),
                    Some(&caller.log_name()),
                )?;
                Ok(json!({"ok": true, "name": tool, "enabled": enabled}))
            }
            _ => anyhow::bail!("unknown tool: {name}"),
        }
    }

    /// The privacy admin tools.
    fn call_privacy(&self, caller: &Caller, name: &str, args: &Value) -> anyhow::Result<Value> {
        use memora_state::privacy::{Kind, Mode};
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        // Kind: as given, else what the path is on disk (a folder, or a note).
        let kind = || -> anyhow::Result<Kind> {
            if let Some(k) = args.get("kind").and_then(|v| v.as_str()) {
                return Ok(k.parse()?);
            }
            let norm = memora_state::privacy::normalize_path(path)?;
            let root = self
                .store
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .root()
                .to_path_buf();
            Ok(if root.join(&norm).is_dir() {
                Kind::Folder
            } else {
                Kind::Node
            })
        };
        let actor = caller.log_name();
        match name {
            "privacy_list" if path.is_empty() => Ok(self.db.read(privacy::list_json)?),
            "privacy_list" => {
                let k = kind()?;
                Ok(self.db.read(|c| privacy::describe(c, path, k))?)
            }
            "privacy_set" => {
                let mode: Mode = args
                    .get("mode")
                    .and_then(|v| v.as_str())
                    .unwrap_or("deny")
                    .parse()?;
                let agents: Vec<String> = match args.get("agents") {
                    Some(Value::Array(a)) => a
                        .iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect(),
                    Some(Value::String(s)) => s.split(',').map(str::to_string).collect(),
                    _ => Vec::new(),
                };
                let k = kind()?;
                Ok(privacy::set_rule(
                    &self.db,
                    k,
                    path,
                    mode,
                    &agents,
                    Some(&actor),
                    caller.ip.as_deref(),
                )?)
            }
            _ => {
                let k = kind()?;
                Ok(privacy::clear_rule(
                    &self.db,
                    k,
                    path,
                    Some(&actor),
                    caller.ip.as_deref(),
                )?)
            }
        }
    }

    /// Register the alias for an MCP connection (one alias per connection).
    pub fn register_alias(&self, alias: &str, key_id: &str) -> AliasRecord {
        self.register_alias_named(alias, key_id, None)
    }

    /// [`McpServer::register_alias`] with the API key's name.
    pub fn register_alias_named(
        &self,
        alias: &str,
        key_id: &str,
        key_name: Option<&str>,
    ) -> AliasRecord {
        let now = now_secs();
        let mut list = self.aliases.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(r) = list
            .iter_mut()
            .find(|r| r.alias == alias && r.key_id == key_id)
        {
            r.last_seen = now;
            r.connections += 1;
            if key_name.is_some() {
                r.key_name = key_name.map(str::to_string);
            }
            return r.clone();
        }
        // Bounded: the oldest record goes once 200 are tracked.
        if list.len() >= 200 {
            if let Some(i) = list
                .iter()
                .enumerate()
                .min_by_key(|(_, r)| r.last_seen)
                .map(|(i, _)| i)
            {
                list.remove(i);
            }
        }
        let rec = AliasRecord {
            alias: alias.to_string(),
            key_id: key_id.to_string(),
            key_name: key_name.map(str::to_string),
            first_seen: now,
            last_seen: now,
            connections: 1,
        };
        list.push(rec.clone());
        rec
    }

    pub fn aliases(&self) -> Vec<AliasRecord> {
        self.aliases
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Handle a single MCP JSON-RPC request with full access (local use).
    pub fn handle(&self, req: &RpcRequest) -> RpcResponse {
        self.handle_as(req, &Caller::full("local"))
    }

    /// Handle a single MCP JSON-RPC request on behalf of `caller`:
    /// `tools/list` is filtered and `tools/call` refused (`-32003`) by the
    /// caller's permissions and the global tool switches.
    pub fn handle_as(&self, req: &RpcRequest, caller: &Caller) -> RpcResponse {
        let id = req.id.clone().unwrap_or(Value::Null);
        match req.method.as_str() {
            "initialize" => {
                // One alias record per API-key connection, named after the key.
                if caller.perms.is_some() {
                    self.register_alias_named(caller.actor(), &caller.id, caller.name.as_deref());
                }
                ok(
                    id,
                    json!({
                        "protocolVersion": negotiate_version(&req.params),
                        "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                        "capabilities": {"tools": {"listChanged": false}, "resources": {"listChanged": false}}
                    }),
                )
            }
            "notifications/initialized" => ok(id, json!({})),
            "tools/list" => {
                let tools: Vec<Value> = self
                    .visible_tools(caller)
                    .iter()
                    .map(|t| {
                        json!({
                            "name": t.name,
                            "description": format!("{} When to use: {}", t.description, t.when),
                            "inputSchema": t.input_schema,
                            "_meta": {"category": t.category}
                        })
                    })
                    .collect();
                ok(id, json!({"tools": tools}))
            }
            "tools/call" => {
                let name = req
                    .params
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let args = req.params.get("arguments").cloned().unwrap_or(json!({}));
                if let Some(msg) = self.refusal(caller, name) {
                    return err(id, -32003, msg);
                }
                let result = if admin_catalog().iter().any(|t| t.name == name) {
                    activity::traced(caller, name, &args, activity_label(name, &args), || {
                        self.call_admin(caller, name, &args)
                    })
                } else {
                    self.call_tool_by(name, &args, caller)
                };
                match result {
                    Ok(v) => ok(
                        id,
                        json!({"content":[{"type":"text","text": v.to_string()}],"isError":false}),
                    ),
                    Err(e) => ok(
                        id,
                        json!({"content":[{"type":"text","text": e.to_string()}],"isError":true}),
                    ),
                }
            }
            "resources/list" => ok(
                id,
                json!({"resources":[
                    {"uri":"memory://catalog","name":"Tool catalog","mimeType":"application/json","description":"Every MCP tool and what it is for"},
                    {"uri":"memory://schema","name":"Data schema","mimeType":"application/json","description":"Shape of note, folder, and graph data"},
                    {"uri":"memory://guide","name":"Agent guide","mimeType":"text/markdown","description":"How to use this server as an agent"}
                ]}),
            ),
            "resources/read" => {
                let uri = req.params.get("uri").and_then(|v| v.as_str()).unwrap_or("");
                let mime = if uri == "memory://guide" {
                    "text/markdown"
                } else {
                    "application/json"
                };
                let text = match uri {
                    "memory://catalog" => serde_json::to_string_pretty(
                        &catalog()
                            .iter()
                            .map(|t| {
                                json!({"name":t.name,"category":t.category,
                                       "description":t.description,"when":t.when,
                                       "inputSchema":t.input_schema})
                            })
                            .collect::<Vec<_>>(),
                    )
                    .unwrap_or_default(),
                    "memory://schema" => json!({
                        "note": {"path":"string","name":"string","folder":"string","content":"markdown","tags":["string"],"frontmatter":"object"},
                        "folder": {"name":"string","count":"integer","color":"hex","icon":"emoji"},
                        "graph": {"nodes":["GraphNode"],"links":[{"source":"note name","target":"note name"}]},
                        "activity": {"ts":"unix","actor":"alias","tool":"string","action":"string","path":"string"}
                    })
                    .to_string(),
                    "memory://guide" => GUIDE.to_string(),
                    _ => {
                        return err(id, -32602, format!("unknown resource: {uri}"));
                    }
                };
                ok(
                    id,
                    json!({"contents":[{"uri":uri,"mimeType":mime,"text":text}]}),
                )
            }
            other => err(id, -32601, format!("unsupported method: {other}")),
        }
    }

    /// Execute a tool on behalf of `caller`. Every call is published to the
    /// realtime stream as an `ai_activity` `start` / `end` pair (see [`activity`]),
    /// named by [`Caller::actor`]; node events carry the same actor. This single
    /// hook covers all tools, including read-only ones, so no call escapes the
    /// activity log. Permissions are NOT checked here (see `handle_as`).
    pub fn call_tool_by(&self, name: &str, args: &Value, caller: &Caller) -> anyhow::Result<Value> {
        activity::traced(caller, name, args, activity_label(name, args), || {
            if name == "set_my_color" {
                return self.set_my_color(caller, args);
            }
            self.exec_tool(name, args, caller.actor(), self.view_for(caller))
        })
    }

    /// `set_my_color`: the calling API key's display color.
    fn set_my_color(&self, caller: &Caller, args: &Value) -> anyhow::Result<Value> {
        if caller.perms.is_none() {
            anyhow::bail!("only API keys have a display color");
        }
        let color = args.get("color").and_then(|v| v.as_str()).unwrap_or("");
        let key = self
            .db
            .write(|tx| memora_state::keys::set_color(tx, &caller.id, Some(color)))?;
        memora_core::events::hub().publish(json!({
            "type": "key_color", "actor": caller.actor(), "actor_id": caller.id, "color": key.color,
        }));
        Ok(json!({"ok": true, "id": key.id, "name": key.name, "color": key.color}))
    }

    fn exec_tool(
        &self,
        name: &str,
        args: &Value,
        actor: &str,
        view: Option<Arc<dyn PathView>>,
    ) -> anyhow::Result<Value> {
        // Locked for this caller: an agent's view hides its private paths everywhere.
        let store = memora_core::privacy::lock_as(&self.store, view);
        let s = |k: &str| {
            args.get(k)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        let i = |k: &str, d: usize| {
            args.get(k)
                .and_then(|v| v.as_i64())
                .map(|v| v as usize)
                .unwrap_or(d)
        };
        let ops = || {
            args.get("ops")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
        };

        Ok(match name {
            "patch_memory" => {
                let v = store.patch_memory_impl(&s("path"), ops().as_slice())?;
                publish_node("node_updated", actor, &store, &s("path"));
                v
            }
            "get_stats" => serde_json::to_value(store.stats())?,
            "list_memory" => {
                // Shape: {folder: [{path, name, folder, mtime}, ...]}.
                let tree = store.tree();
                let mut obj = serde_json::Map::new();
                for (folder, notes) in tree {
                    let arr: Vec<Value> = notes
                        .iter()
                        .map(|n| {
                            json!({"path": n.path, "name": n.name, "folder": n.folder, "mtime": n.mtime})
                        })
                        .collect();
                    obj.insert(folder, json!(arr));
                }
                Value::Object(obj)
            }
            "read_memory" => store.read_note_impl(&s("path"))?,
            "create_memory" => {
                let title = s("title");
                let content = args.get("content").and_then(|v| v.as_str());
                if title.is_empty() {
                    anyhow::bail!("title is required");
                }
                let folder = {
                    let f = s("folder");
                    if f.is_empty() {
                        "Memory".to_string()
                    } else {
                        f
                    }
                };
                let path = store.create_impl(&title, &folder, content)?;
                publish_node("node_created", actor, &store, &path);
                json!({"ok": true, "path": path})
            }
            "save_memory" => {
                store.save_impl(&s("path"), &s("content"))?;
                publish_node("node_updated", actor, &store, &s("path"));
                json!({"ok": true, "path": s("path")})
            }
            "delete_memory" => {
                let path = s("path");
                store.delete_impl(&path)?;
                memora_core::events::hub().publish(json!({
                    "type": "node_deleted", "actor": actor,
                    "id": std::path::Path::new(&path)
                        .file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
                    "path": path,
                }));
                json!({"ok": true, "path": path})
            }
            "move_memory" => {
                let from = s("path");
                let to = store.move_impl(&from, &s("folder"))?;
                memora_core::events::hub().publish(json!({
                    "type": "node_renamed", "actor": actor,
                    "old_path": from, "node": store.node_payload(&to),
                }));
                json!({"ok": true, "from": from, "to": to})
            }
            "rename_memory" => {
                let from = s("path");
                let to = store.rename_impl(&from, &s("new_name"))?;
                memora_core::events::hub().publish(json!({
                    "type": "node_renamed", "actor": actor,
                    "old_path": from, "node": store.node_payload(&to),
                }));
                json!({"ok": true, "path": to})
            }
            "search_memory" => {
                // `q` per the schema; `query` is accepted too.
                let q = {
                    let a = s("query");
                    if a.is_empty() {
                        s("q")
                    } else {
                        a
                    }
                };
                let limit = i("limit", 12);
                serde_json::to_value(store.search(&q, limit))?
            }
            "get_graph" => {
                let g = store.graph();
                let mt = store.mtimes();
                let nodes: Vec<Value> = g
                    .nodes
                    .iter()
                    .map(|n| {
                        json!({
                            "id": n.id, "path": n.path, "folder": n.folder,
                            "color": n.color, "degree": n.degree, "tags": n.tags,
                            "mtime": mt.get(&n.path).copied().unwrap_or(0.0),
                        })
                    })
                    .collect();
                let links: Vec<Value> = g
                    .links
                    .iter()
                    .map(|l| json!({"source": l.source, "target": l.target}))
                    .collect();
                json!({"nodes": nodes, "links": links})
            }
            "broken_links" => serde_json::to_value(store.broken_links(None))?,
            "get_neighbors" => json!(store.get_neighbors_impl(&s("path"), i("depth", 1))?),
            "get_tags" => {
                // With a path: tags of that note. Without: every tag in the vault.
                let p = s("path");
                if p.is_empty() {
                    json!(store.list_tags_impl())
                } else {
                    store.get_note_tags_impl(&p)?
                }
            }
            "search_by_tag" => json!(store.search_by_tag_impl(&s("tag"), i("limit", 50))?),
            "list_folders" => {
                let tree = store.tree();
                let folders: Vec<Value> = tree
                    .iter()
                    .map(|(f, notes)| {
                        json!({"name": f, "count": notes.len(), "color": memora_core::color_of(&format!("{f}/x"))})
                    })
                    .collect();
                json!({"count": folders.len(), "folders": folders})
            }
            "create_folder" => json!({
                "ok": true,
                "folder": store.create_folder_impl(&s("name"))?
            }),
            other => match crate::tools::call_extra(&store, other, args, actor) {
                Some(Ok(v)) => v,
                Some(Err(e)) => return Err(e),
                None => anyhow::bail!("unknown tool: {other}"),
            },
        })
    }
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// First non-empty string field among `keys` (used for activity labels).
fn pick<'a>(args: &'a Value, keys: &[&str]) -> &'a str {
    for k in keys {
        if let Some(v) = args.get(*k).and_then(|v| v.as_str()) {
            if !v.is_empty() {
                return v;
            }
        }
    }
    ""
}

/// Short label for the `ai_activity` event, taken from the most relevant
/// tool argument (title for create, query for search, folder for folder
/// operations, and so on).
fn activity_label<'a>(name: &str, args: &'a Value) -> &'a str {
    match name {
        "search_memory" | "query_memory" | "search_by_tag" | "search_logs" | "find_similar"
        | "suggest_links" => pick(args, &["query", "q", "tag", "path"]),
        "create_memory" | "template_create" | "batch_create" => pick(args, &["title", "name"]),
        "set_folder_meta" | "get_folder_meta" | "folder_stats" | "create_folder" => {
            pick(args, &["folder", "name"])
        }
        "set_my_name" => pick(args, &["name"]),
        "mention_agent" => pick(args, &["agent", "message"]),
        "get_events" | "get_logs" | "digest" => pick(args, &["range", "q", "folder"]),
        _ => pick(
            args,
            &[
                "path", "title", "name", "query", "tag", "q", "folder", "into", "template",
            ],
        ),
    }
}

/// Publish a node event (`node_created` / `node_updated`) to the realtime hub.
///
/// Called after a successful mutation, carrying the node payload clients
/// expect, so a UI can insert the node without reloading the whole graph.
pub(crate) fn publish_node(ty: &str, actor: &str, store: &MemoryStore, path: &str) {
    if path.is_empty() {
        return;
    }
    memora_core::events::hub().publish(json!({
        "type": ty,
        "actor": actor,
        "node": store.node_payload(path),
    }));
}

pub const GUIDE: &str = r#"# Memora: agent guide

You are connected to a markdown vault you can both read and write.

## Start here
1. `get_stats`: see how large the vault is.
2. `search_memory`: find relevant notes (supports `tag:x`).
3. `read_memory`: read their content.
4. `create_memory` / `patch_memory`: save your results.

## Identity
Every MCP connection registers an alias. All actions are tracked per alias,
so keep your alias consistent to make your activity trace easy to read.

## Rules
- Do not overwrite someone else's note without a reason.
- Wikilinks `[[Note Name]]` resolve by note name, not path, so they survive moves.
- After creating a note, mention its path in your answer.

## Useful tools
`get_graph`, `get_neighbors`, `broken_links` for understanding how notes relate.
`get_tags`, `search_by_tag` for navigating the taxonomy.
"#;

/// Render the tool catalog as markdown for the `/tools` page; `disabled` tools are marked.
pub fn catalog_markdown(disabled: &BTreeSet<String>) -> String {
    let mut out = String::from("# MCP tool catalog\n\n");
    let mut by_cat: std::collections::BTreeMap<&str, Vec<&ToolSpec>> =
        std::collections::BTreeMap::new();
    let cat = catalog();
    for t in &cat {
        by_cat.entry(t.category).or_default().push(t);
    }
    for (c, tools) in by_cat {
        out.push_str(&format!("## {c}\n\n"));
        for t in tools {
            let off = if disabled.contains(t.name) {
                " (disabled on this server)"
            } else {
                ""
            };
            out.push_str(&format!(
                "### `{}`{}\n\n{}\n\n_{}_\n\n",
                t.name, off, t.description, t.when
            ));
        }
    }
    out
}
