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
        Ok(Self {
            conn: Mutex::new(conn),
        })
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
                   (SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id AND m.role!='tool')
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

    pub fn delete_session(&self, id: &str) -> Result<bool> {
        Ok(self
            .c()
            .execute("DELETE FROM sessions WHERE id=?1", [id])
            .map_err(db_err)?
            > 0)
    }

    pub fn messages(&self, session: &str) -> Result<Vec<Message>> {
        let c = self.c();
        let mut st = c
            .prepare(
                "SELECT id,session_id,role,content,tool_calls,tool_call_id,tool_name,meta,created_at FROM messages
                 WHERE session_id=?1 ORDER BY id",
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
                })
            })
            .map_err(db_err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(db_err)
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
             WHERE m.role IN ('user','assistant') AND m.content <> '' AND ({both})
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

    /// Drop every message of a chat after message `id` (to run a turn again).
    pub fn delete_after(&self, session: &str, id: i64) -> Result<usize> {
        self.c()
            .execute(
                "DELETE FROM messages WHERE session_id=?1 AND id>?2",
                params![session, id],
            )
            .map_err(db_err)
    }

    pub fn append(&self, session: &str, m: &NewMessage, now: i64) -> Result<i64> {
        let c = self.c();
        c.execute(
            "INSERT INTO messages (session_id,role,content,tool_calls,tool_call_id,tool_name,meta,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                session,
                m.role,
                m.content,
                m.tool_calls.as_ref().map(Value::to_string),
                m.tool_call_id,
                m.tool_name,
                m.meta.as_ref().map(Value::to_string),
                now
            ],
        )
        .map_err(db_err)?;
        c.execute(
            "UPDATE sessions SET updated_at=?2 WHERE id=?1",
            params![session, now],
        )
        .map_err(db_err)?;
        Ok(c.last_insert_rowid())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
