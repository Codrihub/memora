//! Mnemo, the built-in notes agent: its providers, models, preferences, sessions and
//! messages, in a database file of its own (`assistant.sqlite3` beside the state
//! database), so the state schema never changes for it and an older binary simply
//! ignores the file.
//!
//! Messages are kept in one provider-neutral shape: `user` and `assistant` text, the
//! assistant's tool calls (`[{id, name, arguments}]`) and `tool` results answering them by
//! `tool_call_id`. Each provider adapter turns that history into its own wire format.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::sync::Mutex;

/// The file beside the state database.
pub const FILE: &str = "assistant.sqlite3";

const DDL: &str = "
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('openai','anthropic','custom')),
  label TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_style TEXT NOT NULL CHECK (api_style IN ('chat','responses','messages')),
  api_key TEXT NOT NULL DEFAULT '',
  key_hint TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS models (
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  context_window INTEGER,
  max_output INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  fetched INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider_id, model_id)
);
CREATE TABLE IF NOT EXISTS prefs (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  model TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  content TEXT NOT NULL DEFAULT '',
  tool_calls TEXT,
  tool_call_id TEXT,
  tool_name TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_by_session ON messages(session_id, id);
";

#[derive(Debug, Clone, Serialize)]
pub struct Provider {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub base_url: String,
    pub api_style: String,
    #[serde(skip)]
    pub api_key: String,
    /// The last four characters of the key, for the settings page; the key itself never
    /// leaves the server.
    pub key_hint: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Model {
    pub provider_id: String,
    pub model_id: String,
    pub label: String,
    pub context_window: Option<i64>,
    pub max_output: Option<i64>,
    pub pinned: bool,
    pub hidden: bool,
    /// From the provider's model list (true) or added by hand (false).
    pub fetched: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Session {
    pub id: String,
    pub title: String,
    /// `global`, `note:<path>` or `folder:<path>`.
    pub scope: String,
    /// `<provider id>/<model id>`, or empty for the default model.
    pub model: String,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Message {
    pub id: i64,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub tool_calls: Option<Value>,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub meta: Option<Value>,
    pub created_at: i64,
    /// Set on a message that starts one of several versions (an edited prompt, a regenerated
    /// answer): which version is shown and the first message of every version, in order.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<Branch>,
}

/// The versions at one point of a chat (see [`Message::branch`]).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Branch {
    /// 0-based position of the shown version in `ids`.
    pub index: usize,
    /// The first message of each version, oldest first.
    pub ids: Vec<i64>,
}

/// One result of [`Store::search`].
#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub session_id: String,
    pub title: String,
    pub scope: String,
    pub message_id: Option<i64>,
    pub role: String,
    pub text: String,
    pub at: i64,
}

/// A message to append (the store sets id and time).
#[derive(Debug, Clone, Default)]
pub struct NewMessage {
    pub role: String,
    pub content: String,
    pub tool_calls: Option<Value>,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub meta: Option<Value>,
}

pub type Result<T> = std::result::Result<T, String>;

fn db_err(e: rusqlite::Error) -> String {
    e.to_string()
}

fn hint(key: &str) -> String {
    let k: Vec<char> = key.trim().chars().collect();
    if k.len() < 8 {
        String::new()
    } else {
        k[k.len() - 4..].iter().collect()
    }
}

/// A model as a provider's model list reports it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ListedModel {
    pub id: String,
    pub label: String,
    pub context_window: Option<i64>,
    pub max_output: Option<i64>,
}

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    /// Open (and create) the file in `state_dir`, readable by the server's user only.
    pub fn open(state_dir: &Path) -> Result<Self> {
        let path = state_dir.join(FILE);
        let conn = Connection::open(&path).map_err(db_err)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).ok();
        }
        Self::init(conn)
    }

    /// An in-memory store, for tests.
    pub fn open_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory().map_err(db_err)?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
        )
        .map_err(db_err)?;
        conn.execute_batch(DDL).map_err(db_err)?;
        Self::migrate_branches(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Additive migration for chat branches: nullable columns only, so a chat from before is
    /// one linear branch. `messages.branch_root` = the first message of the original version
    /// a later version stands beside; `messages.parked` = NULL on the chat's active path, else
    /// the first message of the version the row was put away with; `sessions.fork_from` = the
    /// version start that was put away by a pending fork (the next owner or reply message
    /// becomes a sibling of it; see `fork_at` and `unfork`).
    fn migrate_branches(conn: &Connection) -> Result<()> {
        let has = |table: &str, col: &str| -> Result<bool> {
            let mut st = conn
                .prepare(&format!("PRAGMA table_info({table})"))
                .map_err(db_err)?;
            let names = st
                .query_map([], |r| r.get::<_, String>(1))
                .map_err(db_err)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(db_err)?;
            Ok(names.iter().any(|n| n == col))
        };
        for (table, col) in [
            ("messages", "branch_root"),
            ("messages", "parked"),
            ("sessions", "fork_from"),
        ] {
            if !has(table, col)? {
                conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {col} INTEGER"))
                    .map_err(db_err)?;
            }
        }
        Ok(())
    }

    fn c(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ---- providers ----

    pub fn providers(&self) -> Result<Vec<Provider>> {
        let c = self.c();
        let mut st = c
            .prepare("SELECT id,kind,label,base_url,api_style,api_key,enabled,created_at,updated_at,key_hint FROM providers ORDER BY created_at")
            .map_err(db_err)?;
        let rows = st
            .query_map([], |r| {
                let key: String = r.get(5)?;
                Ok(Provider {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    label: r.get(2)?,
                    base_url: r.get(3)?,
                    api_style: r.get(4)?,
                    key_hint: r.get(9)?,
                    api_key: key,
                    enabled: r.get::<_, i64>(6)? != 0,
                    created_at: r.get(7)?,
                    updated_at: r.get(8)?,
                })
            })
            .map_err(db_err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(db_err)
    }

    pub fn provider(&self, id: &str) -> Result<Option<Provider>> {
        Ok(self.providers()?.into_iter().find(|p| p.id == id))
    }

    /// Create or update a provider. `api_key` is `(stored form, plain key)`: the stored form
    /// is kept (sealed by the caller) and only the plain key's last four characters are
    /// remembered as a hint. `None` keeps the stored key.
    #[allow(clippy::too_many_arguments)]
    pub fn save_provider(
        &self,
        id: &str,
        kind: &str,
        label: &str,
        base_url: &str,
        api_style: &str,
        api_key: Option<(&str, &str)>,
        enabled: bool,
        now: i64,
    ) -> Result<()> {
        let c = self.c();
        let (key, key_hint) = match api_key {
            Some((stored, plain)) => (stored.trim().to_string(), hint(plain)),
            None => c
                .query_row(
                    "SELECT api_key,key_hint FROM providers WHERE id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(db_err)?
                .unwrap_or_default(),
        };
        c.execute(
            "INSERT INTO providers (id,kind,label,base_url,api_style,api_key,enabled,created_at,updated_at,key_hint)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8,?9)
             ON CONFLICT(id) DO UPDATE SET kind=?2,label=?3,base_url=?4,api_style=?5,api_key=?6,enabled=?7,updated_at=?8,key_hint=?9",
            params![id, kind, label, base_url, api_style, key, enabled as i64, now, key_hint],
        )
        .map_err(db_err)?;
        Ok(())
    }

    pub fn delete_provider(&self, id: &str) -> Result<bool> {
        Ok(self
            .c()
            .execute("DELETE FROM providers WHERE id=?1", [id])
            .map_err(db_err)?
            > 0)
    }

    // ---- models ----

    pub fn models(&self) -> Result<Vec<Model>> {
        let c = self.c();
        let mut st = c
            .prepare(
                "SELECT provider_id,model_id,label,context_window,max_output,pinned,hidden,fetched FROM models
                 ORDER BY pinned DESC, provider_id, model_id",
            )
            .map_err(db_err)?;
        let rows = st
            .query_map([], |r| {
                Ok(Model {
                    provider_id: r.get(0)?,
                    model_id: r.get(1)?,
                    label: r.get(2)?,
                    context_window: r.get(3)?,
                    max_output: r.get(4)?,
                    pinned: r.get::<_, i64>(5)? != 0,
                    hidden: r.get::<_, i64>(6)? != 0,
                    fetched: r.get::<_, i64>(7)? != 0,
                })
            })
            .map_err(db_err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(db_err)
    }

    /// Replace a provider's fetched models with `ids` (labels and context windows when the
    /// provider told them), keeping pins, hides and every model added by hand.
    pub fn replace_fetched(&self, provider: &str, list: &[ListedModel]) -> Result<usize> {
        let mut c = self.c();
        let tx = c.transaction().map_err(db_err)?;
        let keep: Vec<String> = list.iter().map(|m| m.id.clone()).collect();
        {
            let mut st = tx
                .prepare(
                    "SELECT model_id FROM models WHERE provider_id=?1 AND fetched=1 AND pinned=0",
                )
                .map_err(db_err)?;
            let old: Vec<String> = st
                .query_map([provider], |r| r.get(0))
                .map_err(db_err)?
                .filter_map(|r| r.ok())
                .collect();
            for id in old.iter().filter(|id| !keep.contains(id)) {
                tx.execute(
                    "DELETE FROM models WHERE provider_id=?1 AND model_id=?2",
                    params![provider, id],
                )
                .map_err(db_err)?;
            }
        }
        // What the provider reports wins: limits follow the provider, not a guess.
        for m in list {
            tx.execute(
                "INSERT INTO models (provider_id,model_id,label,context_window,max_output,fetched) VALUES (?1,?2,?3,?4,?5,1)
                 ON CONFLICT(provider_id,model_id) DO UPDATE SET label=CASE WHEN ?3='' THEN label ELSE ?3 END,
                   context_window=COALESCE(?4,context_window), max_output=COALESCE(?5,max_output), fetched=1",
                params![provider, m.id, m.label, m.context_window, m.max_output],
            )
            .map_err(db_err)?;
        }
        tx.commit().map_err(db_err)?;
        Ok(list.len())
    }

    /// Add a model by hand, or change its flags and limits (`None` leaves a field as it is).
    #[allow(clippy::too_many_arguments)]
    pub fn set_model(
        &self,
        provider: &str,
        model: &str,
        label: Option<&str>,
        context_window: Option<Option<i64>>,
        max_output: Option<Option<i64>>,
        pinned: Option<bool>,
        hidden: Option<bool>,
    ) -> Result<()> {
        let c = self.c();
        c.execute(
            "INSERT INTO models (provider_id,model_id,label) VALUES (?1,?2,'') ON CONFLICT(provider_id,model_id) DO NOTHING",
            params![provider, model],
        )
        .map_err(db_err)?;
        if let Some(l) = label {
            c.execute(
                "UPDATE models SET label=?3 WHERE provider_id=?1 AND model_id=?2",
                params![provider, model, l],
            )
            .map_err(db_err)?;
        }
        if let Some(v) = context_window {
            c.execute(
                "UPDATE models SET context_window=?3 WHERE provider_id=?1 AND model_id=?2",
                params![provider, model, v],
            )
            .map_err(db_err)?;
        }
        if let Some(v) = max_output {
            c.execute(
                "UPDATE models SET max_output=?3 WHERE provider_id=?1 AND model_id=?2",
                params![provider, model, v],
            )
            .map_err(db_err)?;
        }
        if let Some(v) = pinned {
            c.execute(
                "UPDATE models SET pinned=?3 WHERE provider_id=?1 AND model_id=?2",
                params![provider, model, v as i64],
            )
            .map_err(db_err)?;
        }
        if let Some(v) = hidden {
            c.execute(
                "UPDATE models SET hidden=?3 WHERE provider_id=?1 AND model_id=?2",
                params![provider, model, v as i64],
            )
            .map_err(db_err)?;
        }
        Ok(())
    }

    pub fn delete_model(&self, provider: &str, model: &str) -> Result<bool> {
        Ok(self
            .c()
            .execute(
                "DELETE FROM models WHERE provider_id=?1 AND model_id=?2",
                params![provider, model],
            )
            .map_err(db_err)?
            > 0)
    }

    // ---- preferences (JSON values by key) ----

    pub fn prefs(&self) -> Result<serde_json::Map<String, Value>> {
        let c = self.c();
        let mut st = c.prepare("SELECT key,value FROM prefs").map_err(db_err)?;
        let rows = st
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(db_err)?;
        let mut out = serde_json::Map::new();
        for (k, v) in rows.flatten() {
            out.insert(k, serde_json::from_str(&v).unwrap_or(Value::Null));
        }
        Ok(out)
    }

    pub fn set_pref(&self, key: &str, value: &Value) -> Result<()> {
        let c = self.c();
        if value.is_null() {
            c.execute("DELETE FROM prefs WHERE key=?1", [key])
                .map_err(db_err)?;
        } else {
            c.execute(
                "INSERT INTO prefs (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2",
                params![key, value.to_string()],
            )
            .map_err(db_err)?;
        }
        Ok(())
    }

    // ---- sessions and messages ----

    pub fn sessions(&self) -> Result<Vec<Session>> {
        let c = self.c();
        let mut st = c
            .prepare(
                "SELECT s.id,s.title,s.scope,s.model,s.pinned,s.created_at,s.updated_at,
                   (SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id AND m.role!='tool' AND m.parked IS NULL)
                 FROM sessions s ORDER BY s.pinned DESC, s.updated_at DESC",
            )
            .map_err(db_err)?;
        let rows = st
            .query_map([], |r| {
                Ok(Session {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    scope: r.get(2)?,
                    model: r.get(3)?,
                    pinned: r.get::<_, i64>(4)? != 0,
                    created_at: r.get(5)?,
                    updated_at: r.get(6)?,
                    messages: r.get(7)?,
                })
            })
            .map_err(db_err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(db_err)
    }

    /// The last message with text in each chat (`chat id -> (role, text)`), for a preview in
    /// the chat list; compaction summaries and failed turns are skipped.
    pub fn previews(&self) -> Result<std::collections::HashMap<String, (String, String)>> {
        let c = self.c();
        let mut st = c
            .prepare(
                "SELECT m.session_id, m.role, substr(m.content, 1, 240) FROM messages m
                 JOIN (SELECT session_id, MAX(id) AS id FROM messages
                       WHERE role IN ('user','assistant') AND content != '' AND parked IS NULL
                         AND (meta IS NULL OR meta NOT LIKE '%\"compact\":true%')
                       GROUP BY session_id) last ON last.id = m.id",
            )
            .map_err(db_err)?;
        let rows = st
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    (r.get::<_, String>(1)?, r.get::<_, String>(2)?),
                ))
            })
            .map_err(db_err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(db_err)
    }

    pub fn session(&self, id: &str) -> Result<Option<Session>> {
        Ok(self.sessions()?.into_iter().find(|s| s.id == id))
    }

    pub fn create_session(
        &self,
        id: &str,
        title: &str,
        scope: &str,
        model: &str,
        now: i64,
    ) -> Result<()> {
        self.c()
            .execute(
                "INSERT INTO sessions (id,title,scope,model,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5)",
                params![id, title, scope, model, now],
            )
            .map_err(db_err)?;
        Ok(())
    }

    pub fn update_session(
        &self,
        id: &str,
        title: Option<&str>,
        model: Option<&str>,
        pinned: Option<bool>,
        now: Option<i64>,
    ) -> Result<bool> {
        let c = self.c();
        let mut n = 0;
        if let Some(t) = title {
            n += c
                .execute("UPDATE sessions SET title=?2 WHERE id=?1", params![id, t])
                .map_err(db_err)?;
        }
        if let Some(m) = model {
            n += c
                .execute("UPDATE sessions SET model=?2 WHERE id=?1", params![id, m])
                .map_err(db_err)?;
        }
        if let Some(p) = pinned {
            n += c
                .execute(
                    "UPDATE sessions SET pinned=?2 WHERE id=?1",
                    params![id, p as i64],
                )
                .map_err(db_err)?;
        }
        if let Some(t) = now {
            n += c
                .execute(
                    "UPDATE sessions SET updated_at=?2 WHERE id=?1",
                    params![id, t],
                )
                .map_err(db_err)?;
        }
        Ok(n > 0)
    }

    /// Chats about a note or folder: kept for it (scope), or with it attached to a message or
    /// named in one of Mnemo's tool calls. Ids, most recently active first.
    pub fn sessions_about(&self, path: &str) -> Result<Vec<String>> {
        let esc = |x: &str| {
            x.replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        };
        let attached = format!(
            "%\"path\":{}%",
            esc(&serde_json::to_string(path).unwrap_or_default())
        );
        let named = format!("%{}%", esc(path));
        let c = self.c();
        let mut st = c
            .prepare(
                "SELECT s.id FROM sessions s WHERE s.scope='note:'||?1 OR s.scope='folder:'||?1
                   OR EXISTS (SELECT 1 FROM messages m WHERE m.session_id=s.id AND
                     (m.meta LIKE ?2 ESCAPE '\\' OR (m.role='assistant' AND m.tool_calls LIKE ?3 ESCAPE '\\')))
                 ORDER BY s.updated_at DESC",
            )
            .map_err(db_err)?;
        let rows = st
            .query_map(params![path, attached, named], |r| r.get::<_, String>(0))
            .map_err(db_err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(db_err)
    }

    /// Chats follow their note or folder: `from` (a note or a folder with everything in it) is
    /// now at `to`. Returns the chats whose scope changed, with their new scope.
    pub fn move_scopes(&self, from: &str, to: &str) -> Result<Vec<(String, String)>> {
        let mut moved = Vec::new();
        for s in self.sessions()? {
            let Some((kind, path)) = s.scope.split_once(':') else {
                continue;
            };
            if kind != "note" && kind != "folder" {
                continue;
            }
            let new = if path == from {
                to.to_string()
            } else if let Some(rest) = path.strip_prefix(&format!("{from}/")) {
                format!("{to}/{rest}")
            } else {
                continue;
            };
            let scope = format!("{kind}:{new}");
            self.c()
                .execute(
                    "UPDATE sessions SET scope=?2 WHERE id=?1",
                    params![s.id, scope],
                )
                .map_err(db_err)?;
            moved.push((s.id, scope));
        }
        Ok(moved)
    }

    pub fn delete_session(&self, id: &str) -> Result<bool> {
        Ok(self
            .c()
            .execute("DELETE FROM sessions WHERE id=?1", [id])
            .map_err(db_err)?
            > 0)
    }

    /// The chat's active path, oldest first (versions put away on other branches are left
    /// out, so everything built on it — model context, compaction, live sync — follows the
    /// branch on screen).
    pub fn messages(&self, session: &str) -> Result<Vec<Message>> {
        let c = self.c();
        let mut st = c
            .prepare(
                "SELECT id,session_id,role,content,tool_calls,tool_call_id,tool_name,meta,created_at FROM messages
                 WHERE session_id=?1 AND parked IS NULL ORDER BY id",
            )
            .map_err(db_err)?;
        let rows = st
            .query_map([session], |r| {
                let calls: Option<String> = r.get(4)?;
                let meta: Option<String> = r.get(7)?;
                Ok(Message {
                    id: r.get(0)?,
                    session_id: r.get(1)?,
                    role: r.get(2)?,
                    content: r.get(3)?,
                    tool_calls: calls.and_then(|s| serde_json::from_str(&s).ok()),
                    tool_call_id: r.get(5)?,
                    tool_name: r.get(6)?,
                    meta: meta.and_then(|s| serde_json::from_str(&s).ok()),
                    created_at: r.get(8)?,
                    branch: None,
                })
            })
            .map_err(db_err)?;
        let mut out: Vec<Message> = rows
            .collect::<std::result::Result<_, _>>()
            .map_err(db_err)?;
        drop(st);
        // Every version group of the chat: root -> its version starts, oldest first.
        let mut st = c
            .prepare(
                "SELECT branch_root, id FROM messages WHERE session_id=?1 AND branch_root IS NOT NULL ORDER BY id",
            )
            .map_err(db_err)?;
        let mut groups: std::collections::HashMap<i64, Vec<i64>> = Default::default();
        for row in st
            .query_map([session], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(db_err)?
        {
            let (root, id) = row.map_err(db_err)?;
            groups.entry(root).or_insert_with(|| vec![root]).push(id);
        }
        if groups.is_empty() {
            return Ok(out);
        }
        let root_of: std::collections::HashMap<i64, i64> = groups
            .iter()
            .flat_map(|(root, ids)| ids.iter().map(move |id| (*id, *root)))
            .collect();
        for m in &mut out {
            if let Some(ids) = root_of.get(&m.id).and_then(|r| groups.get(r)) {
                m.branch = Some(Branch {
                    index: ids.iter().position(|x| *x == m.id).unwrap_or(0),
                    ids: ids.clone(),
                });
            }
        }
        Ok(out)
    }

    /// Start a new version at message `head` (on the active path): the path from `head` on is
    /// put away, and the next owner or reply message appended to the chat (not a tool result
    /// or a compaction summary) starts the new version beside it. A turn that ends with no
    /// such message calls [`Store::unfork`]. Returns how many messages were put away.
    pub fn fork_at(&self, session: &str, head: i64) -> Result<usize> {
        let c = self.c();
        let on = c
            .query_row(
                "SELECT 1 FROM messages WHERE session_id=?1 AND id=?2 AND parked IS NULL",
                params![session, head],
                |_| Ok(()),
            )
            .optional()
            .map_err(db_err)?;
        if on.is_none() {
            return Err("that message is not on the chat's shown branch".into());
        }
        let n = c
            .execute(
                "UPDATE messages SET parked=?2 WHERE session_id=?1 AND parked IS NULL AND id>=?2",
                params![session, head],
            )
            .map_err(db_err)?;
        c.execute(
            "UPDATE sessions SET fork_from=?2 WHERE id=?1",
            params![session, head],
        )
        .map_err(db_err)?;
        Ok(n)
    }

    /// Take back a pending fork that no message used (a regenerate stopped before its first
    /// word, an edit that could not be stored): what was put away comes back as it was.
    /// False when no fork was pending.
    pub fn unfork(&self, session: &str) -> Result<bool> {
        let c = self.c();
        let head: Option<i64> = c
            .query_row(
                "SELECT fork_from FROM sessions WHERE id=?1",
                [session],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?
            .flatten();
        let Some(head) = head else {
            return Ok(false);
        };
        c.execute(
            "UPDATE messages SET parked=NULL WHERE session_id=?1 AND parked=?2",
            params![session, head],
        )
        .map_err(db_err)?;
        c.execute("UPDATE sessions SET fork_from=NULL WHERE id=?1", [session])
            .map_err(db_err)?;
        Ok(true)
    }

    /// Show another version: `target` is the first message of one of the versions at a
    /// point of the chat's active path. The shown version (with all that followed it) is
    /// put away and the target's comes back. False when the target is already shown.
    pub fn switch_branch(&self, session: &str, target: i64) -> Result<bool> {
        let c = self.c();
        let row: Option<(Option<i64>, Option<i64>)> = c
            .query_row(
                "SELECT branch_root, parked FROM messages WHERE session_id=?1 AND id=?2",
                params![session, target],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(db_err)?;
        let Some((root, parked)) = row else {
            return Err("message not found in this chat".into());
        };
        if parked.is_none() {
            return Ok(false);
        }
        if parked != Some(target) {
            return Err("that version is not reachable from the shown branch".into());
        }
        let root = root.unwrap_or(target);
        // The version of this group shown now.
        let shown: Option<i64> = c
            .query_row(
                "SELECT id FROM messages WHERE session_id=?1 AND parked IS NULL AND (id=?2 OR branch_root=?2)",
                params![session, root],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?;
        let Some(shown) = shown else {
            return Err("that version is not reachable from the shown branch".into());
        };
        c.execute(
            "UPDATE messages SET parked=?2 WHERE session_id=?1 AND parked IS NULL AND id>=?2",
            params![session, shown],
        )
        .map_err(db_err)?;
        c.execute(
            "UPDATE messages SET parked=NULL WHERE session_id=?1 AND parked=?2",
            params![session, target],
        )
        .map_err(db_err)?;
        c.execute("UPDATE sessions SET fork_from=NULL WHERE id=?1", [session])
            .map_err(db_err)?;
        Ok(true)
    }

    /// Search every chat: messages from the owner and Mnemo whose text, or whose chat's
    /// title, holds every word of `q` (any case), newest first. One hit per message;
    /// `message_id` is `None` for a chat matched by its title alone.
    pub fn search(&self, q: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let words: Vec<String> = q
            .split_whitespace()
            .take(6)
            .map(|w| {
                let e = w
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_");
                format!("%{e}%")
            })
            .collect();
        if words.is_empty() {
            return Ok(Vec::new());
        }
        let limit = limit.clamp(1, 200);
        let c = self.c();
        let cond = |col: &str| {
            (1..=words.len())
                .map(|i| format!("{col} LIKE ?{i} ESCAPE '\\'"))
                .collect::<Vec<_>>()
                .join(" AND ")
        };
        let both = (1..=words.len())
            .map(|i| format!("(m.content LIKE ?{i} ESCAPE '\\' OR s.title LIKE ?{i} ESCAPE '\\')"))
            .collect::<Vec<_>>()
            .join(" AND ");
        let sql = format!(
            "SELECT m.id, s.id, s.title, s.scope, m.role, m.content, m.created_at FROM messages m
             JOIN sessions s ON s.id = m.session_id
             WHERE m.role IN ('user','assistant') AND m.content <> '' AND m.parked IS NULL AND ({both})
             ORDER BY m.id DESC LIMIT {limit}"
        );
        let args: Vec<&dyn rusqlite::ToSql> =
            words.iter().map(|w| w as &dyn rusqlite::ToSql).collect();
        let mut st = c.prepare(&sql).map_err(db_err)?;
        let mut out: Vec<SearchHit> = st
            .query_map(args.as_slice(), |r| {
                Ok(SearchHit {
                    message_id: Some(r.get(0)?),
                    session_id: r.get(1)?,
                    title: r.get(2)?,
                    scope: r.get(3)?,
                    role: r.get(4)?,
                    text: r.get(5)?,
                    at: r.get(6)?,
                })
            })
            .map_err(db_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(db_err)?;
        // Chats whose title matches but no message does (yet) still show.
        let sql = format!(
            "SELECT id, title, scope, updated_at FROM sessions WHERE {} ORDER BY updated_at DESC LIMIT {limit}",
            cond("title")
        );
        let mut st = c.prepare(&sql).map_err(db_err)?;
        let titles = st
            .query_map(args.as_slice(), |r| {
                Ok(SearchHit {
                    message_id: None,
                    session_id: r.get(0)?,
                    title: r.get(1)?,
                    scope: r.get(2)?,
                    role: String::new(),
                    text: String::new(),
                    at: r.get(3)?,
                })
            })
            .map_err(db_err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_err)?;
        for t in titles {
            if !out.iter().any(|h| h.session_id == t.session_id) {
                out.push(t);
            }
        }
        out.truncate(limit);
        Ok(out)
    }

    /// Drop every message of the chat's shown branch after message `id` (to run a turn
    /// again); versions put away on other branches stay.
    pub fn delete_after(&self, session: &str, id: i64) -> Result<usize> {
        self.c()
            .execute(
                "DELETE FROM messages WHERE session_id=?1 AND id>?2 AND parked IS NULL",
                params![session, id],
            )
            .map_err(db_err)
    }

    pub fn append(&self, session: &str, m: &NewMessage, now: i64) -> Result<i64> {
        let c = self.c();
        // A pending fork (see `fork_at`): an owner or reply message starts the new version;
        // tool results and compaction summaries leave the fork for the message that does.
        let starts = matches!(m.role.as_str(), "user" | "assistant")
            && !m
                .meta
                .as_ref()
                .is_some_and(|x| x.get("compact") == Some(&Value::Bool(true)));
        let head: Option<i64> = if starts {
            c.query_row(
                "SELECT fork_from FROM sessions WHERE id=?1",
                [session],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?
            .flatten()
        } else {
            None
        };
        // The new version joins the group of the version it replaces.
        let fork: Option<i64> = match head {
            Some(h) => c
                .query_row(
                    "SELECT COALESCE(branch_root, id) FROM messages WHERE session_id=?1 AND id=?2",
                    params![session, h],
                    |r| r.get(0),
                )
                .optional()
                .map_err(db_err)?,
            None => None,
        };
        c.execute(
            "INSERT INTO messages (session_id,role,content,tool_calls,tool_call_id,tool_name,meta,created_at,branch_root)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                session,
                m.role,
                m.content,
                m.tool_calls.as_ref().map(Value::to_string),
                m.tool_call_id,
                m.tool_name,
                m.meta.as_ref().map(Value::to_string),
                now,
                fork
            ],
        )
        .map_err(db_err)?;
        let id = c.last_insert_rowid();
        c.execute(
            "UPDATE sessions SET updated_at=?2, fork_from=CASE WHEN ?3 THEN NULL ELSE fork_from END WHERE id=?1",
            params![session, now, head.is_some()],
        )
        .map_err(db_err)?;
        Ok(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn edits_and_regenerations_branch_and_switch_on_the_active_path() {
        let s = Store::open_memory().unwrap();
        s.create_session("c", "Chat", "global", "", 1).unwrap();
        let m = |role: &str, text: &str| NewMessage {
            role: role.into(),
            content: text.into(),
            ..Default::default()
        };
        let texts = |s: &Store| -> Vec<String> {
            s.messages("c")
                .unwrap()
                .into_iter()
                .map(|x| x.content)
                .collect()
        };
        let u1 = s.append("c", &m("user", "q1"), 1).unwrap();
        let a1 = s.append("c", &m("assistant", "a1"), 2).unwrap();
        let u2 = s.append("c", &m("user", "q2"), 3).unwrap();
        s.append("c", &m("assistant", "a2"), 4).unwrap();
        // A linear chat has no versions.
        assert!(s.messages("c").unwrap().iter().all(|x| x.branch.is_none()));
        // Edit q2: the tail is put away, the new prompt is a sibling.
        assert_eq!(s.fork_at("c", u2).unwrap(), 2);
        assert_eq!(texts(&s), ["q1", "a1"]);
        let u2b = s.append("c", &m("user", "q2 edited"), 5).unwrap();
        s.append("c", &m("assistant", "a2b"), 6).unwrap();
        assert_eq!(texts(&s), ["q1", "a1", "q2 edited", "a2b"]);
        let msgs = s.messages("c").unwrap();
        assert_eq!(
            msgs[2].branch,
            Some(Branch {
                index: 1,
                ids: vec![u2, u2b]
            })
        );
        // Regenerate a1 (nested point before the edit): everything after it goes away.
        s.fork_at("c", a1).unwrap();
        let a1b = s.append("c", &m("assistant", "a1b"), 7).unwrap();
        assert_eq!(texts(&s), ["q1", "a1b"]);
        assert_eq!(
            s.messages("c").unwrap()[1].branch.as_ref().unwrap().ids,
            vec![a1, a1b]
        );
        // Back to a1: its own continuation (with the edited q2 shown) comes back.
        assert!(s.switch_branch("c", a1).unwrap());
        assert_eq!(texts(&s), ["q1", "a1", "q2 edited", "a2b"]);
        // Flip the inner switcher back to the original q2.
        assert!(s.switch_branch("c", u2).unwrap());
        assert_eq!(texts(&s), ["q1", "a1", "q2", "a2"]);
        assert!(!s.switch_branch("c", u2).unwrap());
        // A version not reachable from the shown path is refused.
        assert!(s.switch_branch("c", a1b + 100).is_err());
        // New turns continue the shown branch.
        s.append("c", &m("user", "q3"), 8).unwrap();
        assert_eq!(texts(&s), ["q1", "a1", "q2", "a2", "q3"]);
        assert_eq!(s.messages("c").unwrap()[0].id, u1);
        // Previews and counts follow the shown branch.
        assert_eq!(s.previews().unwrap()["c"].1, "q3");
        assert_eq!(s.sessions().unwrap()[0].messages, 5);
    }

    #[test]
    fn a_fork_waits_for_a_reply_and_can_be_taken_back() {
        let s = Store::open_memory().unwrap();
        s.create_session("c", "Chat", "global", "", 1).unwrap();
        let m = |role: &str, text: &str, meta: Option<Value>| NewMessage {
            role: role.into(),
            content: text.into(),
            meta,
            ..Default::default()
        };
        let texts = |s: &Store| -> Vec<String> {
            s.messages("c")
                .unwrap()
                .into_iter()
                .map(|x| x.content)
                .collect()
        };
        s.append("c", &m("user", "q1", None), 1).unwrap();
        let a1 = s.append("c", &m("assistant", "a1", None), 2).unwrap();
        s.append("c", &m("tool", "t1", None), 3).unwrap();
        // Regenerate, then Stop before the first word: nothing was appended, the fork is
        // taken back and the old answer is shown again.
        s.fork_at("c", a1).unwrap();
        assert_eq!(texts(&s), ["q1"]);
        assert!(s.unfork("c").unwrap());
        assert!(!s.unfork("c").unwrap());
        assert_eq!(texts(&s), ["q1", "a1", "t1"]);
        // The next message is a plain new turn, not a version of a1.
        s.append("c", &m("user", "q2", None), 4).unwrap();
        assert!(s.messages("c").unwrap().iter().all(|x| x.branch.is_none()));
        // A regenerate that compacts first: the summary and tool results leave the fork to
        // the first reply message.
        let a2 = s.append("c", &m("assistant", "a2", None), 5).unwrap();
        s.fork_at("c", a2).unwrap();
        s.append(
            "c",
            &m("assistant", "summary", Some(json!({"compact": true}))),
            6,
        )
        .unwrap();
        s.append("c", &m("tool", "t2", None), 7).unwrap();
        let a2b = s.append("c", &m("assistant", "a2b", None), 8).unwrap();
        let msgs = s.messages("c").unwrap();
        let shown = msgs.iter().find(|x| x.id == a2b).unwrap();
        assert_eq!(
            shown.branch,
            Some(Branch {
                index: 1,
                ids: vec![a2, a2b]
            })
        );
        assert!(msgs
            .iter()
            .filter(|x| x.id != a2b)
            .all(|x| x.branch.is_none()));
        // The fork was used: nothing to take back.
        assert!(!s.unfork("c").unwrap());
        // Regenerating the new version again joins the same group.
        s.fork_at("c", a2b).unwrap();
        let a2c = s.append("c", &m("assistant", "a2c", None), 9).unwrap();
        let ids = s
            .messages("c")
            .unwrap()
            .last()
            .unwrap()
            .branch
            .clone()
            .unwrap()
            .ids;
        assert_eq!(ids, vec![a2, a2b, a2c]);
    }

    #[test]
    fn branch_columns_are_added_to_an_old_database() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(DDL).unwrap();
        conn.execute_batch(
            "INSERT INTO sessions (id,title,created_at,updated_at) VALUES ('o','Old',1,1);
             INSERT INTO messages (session_id,role,content,created_at) VALUES ('o','user','hi',1);",
        )
        .unwrap();
        let s = Store::init(conn).unwrap();
        assert_eq!(s.messages("o").unwrap().len(), 1);
        // Running the migration again is harmless.
        Store::migrate_branches(&s.c()).unwrap();
    }

    #[test]
    fn chats_follow_their_note_and_are_found_by_it() {
        let s = Store::open_memory().unwrap();
        s.create_session("n", "@mnemo · Plan", "note:Work/Plan.md", "", 1)
            .unwrap();
        s.create_session("f", "Folder", "folder:Work", "", 2)
            .unwrap();
        s.create_session("g", "Global", "global", "", 3).unwrap();
        s.create_session("o", "Other", "note:Workshop.md", "", 4)
            .unwrap();
        let user = |meta: serde_json::Value| NewMessage {
            role: "user".into(),
            content: "hi".into(),
            meta: Some(meta),
            ..Default::default()
        };
        s.append(
            "g",
            &user(json!({"attach": [{"kind": "note", "path": "Work/Plan.md"}]})),
            5,
        )
        .unwrap();
        let mut about = s.sessions_about("Work/Plan.md").unwrap();
        about.sort();
        assert_eq!(about, vec!["g".to_string(), "n".to_string()]);
        // A folder moved: the note inside it and the folder's chat follow; a look-alike does not.
        let mut moved = s.move_scopes("Work", "Archive/Work").unwrap();
        moved.sort();
        assert_eq!(
            moved,
            vec![
                ("f".to_string(), "folder:Archive/Work".to_string()),
                ("n".to_string(), "note:Archive/Work/Plan.md".to_string())
            ]
        );
        assert_eq!(s.session("o").unwrap().unwrap().scope, "note:Workshop.md");
        assert_eq!(
            s.move_scopes("Archive/Work/Plan.md", "Archive/Work/Roadmap.md")
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            s.session("n").unwrap().unwrap().scope,
            "note:Archive/Work/Roadmap.md"
        );
    }

    #[test]
    fn a_turn_can_be_run_again_from_its_message() {
        let s = Store::open_memory().unwrap();
        s.create_session("a", "t", "global", "", 1).unwrap();
        let msg = |role: &str| NewMessage {
            role: role.into(),
            content: "x".into(),
            ..Default::default()
        };
        let u = s.append("a", &msg("user"), 2).unwrap();
        s.append("a", &msg("assistant"), 3).unwrap();
        s.append("a", &msg("user"), 4).unwrap();
        assert_eq!(s.delete_after("a", u).unwrap(), 2);
        assert_eq!(s.messages("a").unwrap().len(), 1);
    }

    #[test]
    fn search_finds_every_word_in_messages_and_titles() {
        let s = Store::open_memory().unwrap();
        s.create_session("a", "Roadmap talk", "global", "", 1)
            .unwrap();
        s.create_session("b", "Groceries", "global", "", 2).unwrap();
        let msg = |role: &str, text: &str| NewMessage {
            role: role.into(),
            content: text.into(),
            ..Default::default()
        };
        s.append("a", &msg("user", "When is the Q3 launch?"), 3)
            .unwrap();
        s.append("a", &msg("assistant", "The launch is on 12 September."), 4)
            .unwrap();
        s.append("b", &msg("user", "milk and 100% juice_box"), 5)
            .unwrap();
        let hits = s.search("launch", 10).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].role, "assistant", "newest first");
        assert_eq!(
            s.search("LAUNCH september", 10).unwrap().len(),
            1,
            "every word, any case"
        );
        assert_eq!(
            s.search("roadmap q3", 10).unwrap().len(),
            1,
            "title and text together"
        );
        assert_eq!(s.search("100%", 10).unwrap().len(), 1, "% is literal");
        assert_eq!(s.search("e_b", 10).unwrap().len(), 1, "_ is literal");
        let t = s.search("groceries", 10).unwrap();
        assert_eq!(t[0].session_id, "b");
        assert!(s.search("   ", 10).unwrap().is_empty());
    }

    #[test]
    fn keys_stay_on_the_server_and_are_kept_when_not_resent() {
        let s = Store::open_memory().unwrap();
        s.save_provider(
            "openai",
            "openai",
            "OpenAI",
            "https://api.openai.com/v1",
            "chat",
            Some(("sk-test-123456", "sk-test-123456")),
            true,
            1,
        )
        .unwrap();
        s.save_provider(
            "openai",
            "openai",
            "OpenAI (work)",
            "https://api.openai.com/v1",
            "responses",
            None,
            true,
            2,
        )
        .unwrap();
        let p = s.provider("openai").unwrap().unwrap();
        assert_eq!(p.api_key, "sk-test-123456");
        assert_eq!(p.key_hint, "3456");
        assert_eq!(p.api_style, "responses");
        assert!(!serde_json::to_string(&p).unwrap().contains("sk-test"));
    }

    #[test]
    fn a_new_model_list_keeps_pins_hides_and_hand_added_models() {
        let s = Store::open_memory().unwrap();
        s.save_provider(
            "p",
            "custom",
            "P",
            "http://x",
            "chat",
            Some(("k", "k")),
            true,
            1,
        )
        .unwrap();
        s.replace_fetched(
            "p",
            &[
                ListedModel {
                    id: "a".into(),
                    ..Default::default()
                },
                ListedModel {
                    id: "b".into(),
                    context_window: Some(8000),
                    max_output: Some(1000),
                    ..Default::default()
                },
            ],
        )
        .unwrap();
        s.set_model("p", "a", None, None, None, Some(true), None)
            .unwrap();
        s.set_model(
            "p",
            "mine",
            Some("Mine"),
            Some(Some(4000)),
            None,
            None,
            None,
        )
        .unwrap();
        s.set_model("p", "b", None, None, None, None, Some(true))
            .unwrap();
        let b = s
            .models()
            .unwrap()
            .into_iter()
            .find(|m| m.model_id == "b")
            .unwrap();
        assert_eq!(
            (b.context_window, b.max_output),
            (Some(8000), Some(1000)),
            "limits come from the provider"
        );
        s.replace_fetched(
            "p",
            &[ListedModel {
                id: "c".into(),
                ..Default::default()
            }],
        )
        .unwrap();
        let ids: Vec<String> = s
            .models()
            .unwrap()
            .into_iter()
            .map(|m| m.model_id)
            .collect();
        assert!(
            ids.contains(&"a".into()) && ids.contains(&"mine".into()) && ids.contains(&"c".into())
        );
        assert!(
            !ids.contains(&"b".into()),
            "an unpinned model the provider no longer lists goes"
        );
    }

    #[test]
    fn sessions_keep_their_messages_in_order_and_delete_with_them() {
        let s = Store::open_memory().unwrap();
        s.create_session("s1", "First", "global", "", 1).unwrap();
        s.append(
            "s1",
            &NewMessage {
                role: "user".into(),
                content: "hi".into(),
                ..Default::default()
            },
            2,
        )
        .unwrap();
        s.append(
            "s1",
            &NewMessage {
                role: "assistant".into(),
                tool_calls: Some(
                    json!([{"id": "c1", "name": "search_memory", "arguments": {"q": "x"}}]),
                ),
                ..Default::default()
            },
            3,
        )
        .unwrap();
        let m = s.messages("s1").unwrap();
        assert_eq!(m.len(), 2);
        assert_eq!(
            m[1].tool_calls.as_ref().unwrap()[0]["name"],
            "search_memory"
        );
        assert_eq!(s.sessions().unwrap()[0].messages, 2);
        assert!(s.delete_session("s1").unwrap());
        assert!(s.messages("s1").unwrap().is_empty());
    }
}
