//! Memora core: markdown vault model, search index, and vault store.
//!
//! Semantics:
//!   * `folder_of`    -> first path segment, else "Root"
//!   * `walk`         -> skip dot-entries (`.git`, `.Trash`, ...), only `*.md`
//!   * `link_targets` -> strip `{{placeholder}}` and code spans, then take `[[...]]`
//!   * `search`       -> word-based, rank (phrase, -hits, -name_hits, len(name))

pub mod events;
pub mod privacy;
pub mod vault;

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use walkdir::WalkDir;

pub const DEFAULT_COLOR: &str = "#8a9098";

// ---------------------------------------------------------------------------
// Regexes, compiled once via `OnceLock`
// ---------------------------------------------------------------------------

fn cached<F: FnOnce() -> Regex>(cell: &'static OnceLock<Regex>, f: F) -> &'static Regex {
    cell.get_or_init(f)
}

pub fn re_wikilink() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    cached(&RE, || {
        Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").unwrap()
    })
}
pub fn re_placeholder() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    cached(&RE, || Regex::new(r"\{\{[^}]*\}\}").unwrap())
}
pub fn re_code_span() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    cached(&RE, || Regex::new(r"`[^`]*`").unwrap())
}
pub fn re_tag() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    cached(&RE, || Regex::new(r"#(\w[\w/-]*)").unwrap())
}
/// `tags: [a, b]` in frontmatter.
pub fn re_fm_tags() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    cached(&RE, || Regex::new(r"(?m)^tags:\s*\[(.*?)\]").unwrap())
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NoteRef {
    pub path: String,
    pub name: String,
    pub folder: String,
    pub mtime: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphNode {
    pub id: String,
    pub path: String,
    pub folder: String,
    pub color: String,
    pub degree: usize,
    /// Inline `#tags` + frontmatter `tags` (as the note view reports them).
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct GraphLink {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub links: Vec<GraphLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    pub folder: String,
    pub score: usize,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Stats {
    pub notes: usize,
    pub links: usize,
    pub folders: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BrokenLink {
    pub source: String,
    pub source_path: String,
    pub target: String,
}

/// First path segment of a relative path, or "Root" when there is none.
pub fn folder_of(rel_path: &str) -> String {
    match rel_path.split('/').next() {
        Some(first) if rel_path.contains('/') => first.to_string(),
        _ => "Root".to_string(),
    }
}

/// Folder palette used by the web UI.
pub const FOLDER_COLORS: &[(&str, &str)] = &[
    ("Memory", "#b57e7e"),
    ("Sessions", "#c2a15a"),
    ("Projects", "#6d92b3"),
    ("Daily", "#7fa07f"),
    ("Skills", "#7d9ba0"),
    ("Knowledge", "#6f9ea3"),
    ("References", "#7a8aa8"),
    ("Templates", "#9b9b93"),
    ("Tech", "#b3826c"),
    ("Guide", "#6f9e86"),
    ("Requests", "#b39a5c"),
    ("Root", "#a8adb4"),
];

/// Color for a note's folder, falling back to `DEFAULT_COLOR`.
pub fn color_of(rel_path: &str) -> String {
    let f = folder_of(rel_path);
    FOLDER_COLORS
        .iter()
        .find(|(k, _)| *k == f)
        .map(|(_, v)| v.to_string())
        .unwrap_or_else(|| DEFAULT_COLOR.to_string())
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

pub struct MemoryStore {
    root: PathBuf,
    fts_db: PathBuf,
    /// Parsed wikilink targets per note, validated by (mtime, size). Rebuilt
    /// from the current walk on every use, so deleted notes drop out and the
    /// map never outgrows the vault.
    link_cache: std::sync::Mutex<HashMap<PathBuf, LinkCacheEntry>>,
    /// Paths the current caller may see (`None` = the owner, everything). Set only for
    /// the length of one locked call by [`privacy::lock_as`].
    pub(crate) view: Option<std::sync::Arc<dyn privacy::PathView>>,
    /// Told about every rename / move / delete (keeps privacy rules on their paths).
    pub(crate) hook: Option<privacy::PathHook>,
}

struct LinkCacheEntry {
    mtime: Option<std::time::SystemTime>,
    len: u64,
    targets: std::sync::Arc<Vec<String>>,
    tags: std::sync::Arc<Vec<String>>,
}

impl MemoryStore {
    pub fn new<P: AsRef<Path>>(root: P) -> Self {
        let root = root.as_ref().to_path_buf();
        let fts_db = root.join(".fts.db");
        Self {
            root,
            fts_db,
            link_cache: std::sync::Mutex::new(HashMap::new()),
            view: None,
            hook: None,
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Walk every note the current caller may see (see [`privacy`]), returning
    /// `(relative path, name without .md, full path)`.
    pub fn walk(&self) -> Vec<(String, String, PathBuf)> {
        let mut all = self.walk_all();
        if self.view.is_some() {
            all.retain(|(rel, _, _)| self.visible(rel));
        }
        all
    }

    /// Walk every note, hidden or not (index maintenance only; never shown to a caller).
    ///
    /// Entries are returned in filesystem walk order (top-down, unsorted) so
    /// consumers that depend on first-found order (e.g. `get_hubs` tie-breaking
    /// equal degrees, `search_by_tag`) stay stable.
    fn walk_all(&self) -> Vec<(String, String, PathBuf)> {
        let mut out = Vec::new();
        for entry in WalkDir::new(&self.root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                if e.depth() == 0 {
                    return true;
                }
                let n = e.file_name().to_string_lossy();
                !n.starts_with('.')
            })
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let fname = entry.file_name().to_string_lossy().to_string();
            if !fname.ends_with(".md") {
                continue;
            }
            let full = entry.path().to_path_buf();
            let rel = full
                .strip_prefix(&self.root)
                .unwrap_or(&full)
                .to_string_lossy()
                .replace('\\', "/");
            let name = fname.trim_end_matches(".md").to_string();
            out.push((rel, name, full));
        }
        out
    }

    /// (relative path -> mtime in epoch seconds) for every note.
    pub fn mtimes(&self) -> BTreeMap<String, f64> {
        let mut m = BTreeMap::new();
        for (rel, _n, fp) in self.walk() {
            if let Ok(md) = fs::metadata(&fp) {
                if let Ok(t) = md.modified() {
                    if let Ok(d) = t.duration_since(std::time::UNIX_EPOCH) {
                        m.insert(rel, d.as_secs_f64());
                    }
                }
            }
        }
        m
    }

    fn read(&self, p: &Path) -> Option<String> {
        fs::read_to_string(p).ok()
    }

    /// Wikilink targets for every walked note (same order as `walk`).
    ///
    /// Only notes whose mtime or size changed since the last call are read and
    /// parsed again; the rest costs one `stat`. This keeps `/api/graph` and
    /// `/api/stats` from re-reading and regex-scanning the whole vault on every
    /// request.
    pub(crate) fn link_targets_all(
        &self,
        files: &[(String, String, PathBuf)],
    ) -> Vec<std::sync::Arc<Vec<String>>> {
        self.scan_all(files).into_iter().map(|(l, _)| l).collect()
    }

    /// `(wikilink targets, tags)` for every walked note (same order as `walk`),
    /// cached per file on mtime + size like [`MemoryStore::link_targets_all`].
    #[allow(clippy::type_complexity)]
    pub(crate) fn scan_all(
        &self,
        files: &[(String, String, PathBuf)],
    ) -> Vec<(std::sync::Arc<Vec<String>>, std::sync::Arc<Vec<String>>)> {
        let mut cache = self.link_cache.lock().unwrap_or_else(|e| e.into_inner());
        let mut fresh: HashMap<PathBuf, LinkCacheEntry> = HashMap::with_capacity(files.len());
        let mut out = Vec::with_capacity(files.len());
        for (_, _, fp) in files {
            let md = fs::metadata(fp).ok();
            let mtime = md.as_ref().and_then(|m| m.modified().ok());
            let len = md.as_ref().map(|m| m.len()).unwrap_or(0);
            let entry = match cache.remove(fp) {
                Some(e) if md.is_some() && e.mtime == mtime && e.len == len => e,
                _ => {
                    let content = self.read(fp).unwrap_or_default();
                    LinkCacheEntry {
                        mtime,
                        len,
                        targets: std::sync::Arc::new(self.link_targets(&content)),
                        tags: std::sync::Arc::new(crate::vault::note_tags(&content)),
                    }
                }
            };
            out.push((entry.targets.clone(), entry.tags.clone()));
            fresh.insert(fp.clone(), entry);
        }
        *cache = fresh;
        out
    }

    /// Strip `{{...}}` and code spans, then collect wikilink targets.
    pub fn link_targets(&self, content: &str) -> Vec<String> {
        let c = re_placeholder().replace_all(content, "");
        let c = re_code_span().replace_all(&c, "");
        re_wikilink()
            .captures_iter(&c)
            .map(|cap| {
                cap.get(1)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default()
            })
            // `![[photo.png]]` embeds an image; it is not a link to a note.
            .filter(|t| crate::vault::image_mime(t.trim()).is_none())
            .collect()
    }

    /// Normalize a link target: drop `.md` and keep only the basename.
    fn norm_target(raw: &str) -> String {
        let t = raw.rsplit('/').next().unwrap_or(raw).replace(".md", "");
        t.trim().to_string()
    }

    pub fn stats(&self) -> Stats {
        let mut notes = 0usize;
        let mut links = 0usize;
        let mut folders: BTreeSet<String> = BTreeSet::new();
        let files = self.walk();
        let all = self.link_targets_all(&files);
        for ((rel, _name, _fp), targets) in files.iter().zip(&all) {
            notes += 1;
            folders.insert(folder_of(rel));
            links += targets.len();
        }
        Stats {
            notes,
            links,
            folders: folders.len(),
        }
    }

    /// Notes grouped by folder; each folder is sorted by mtime descending.
    pub fn tree(&self) -> BTreeMap<String, Vec<NoteRef>> {
        let mut t: BTreeMap<String, Vec<NoteRef>> = BTreeMap::new();
        for (rel, name, fp) in self.walk() {
            let mtime = fs::metadata(&fp)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            let fld = folder_of(&rel);
            t.entry(fld.clone()).or_default().push(NoteRef {
                path: rel,
                name,
                folder: fld,
                mtime,
            });
        }
        for v in t.values_mut() {
            v.sort_by_key(|b| std::cmp::Reverse(b.mtime));
        }
        t
    }

    /// One node per note; an edge is emitted only when the target note exists.
    pub fn graph(&self) -> Graph {
        let files = self.walk();
        let names: BTreeSet<String> = files.iter().map(|(_, n, _)| n.clone()).collect();
        let mut links: Vec<GraphLink> = Vec::new();
        let mut nodes: Vec<GraphNode> = Vec::new();
        let all = self.scan_all(&files);

        for ((rel, name, _fp), (raws, tags)) in files.iter().zip(&all) {
            let mut degree = 0usize;
            for raw in raws.iter() {
                let tgt = Self::norm_target(raw);
                if !tgt.is_empty() && tgt != *name {
                    degree += 1;
                    if names.contains(&tgt) {
                        links.push(GraphLink {
                            source: name.clone(),
                            target: tgt,
                        });
                    }
                }
            }
            nodes.push(GraphNode {
                id: name.clone(),
                path: rel.clone(),
                folder: folder_of(rel),
                color: DEFAULT_COLOR.to_string(),
                degree,
                tags: tags.as_ref().clone(),
            });
        }
        links.sort();
        Graph { nodes, links }
    }

    /// Wikilinks that point at a note that does not exist.
    pub fn broken_links(&self, only: Option<&str>) -> Vec<BrokenLink> {
        let files = self.walk();
        let names: BTreeSet<String> = files.iter().map(|(_, n, _)| n.to_lowercase()).collect();
        let mut out = Vec::new();
        for (rel, name, fp) in &files {
            if let Some(o) = only {
                if rel != o {
                    continue;
                }
            }
            let c = self.read(fp).unwrap_or_default();
            let mut seen: BTreeSet<String> = BTreeSet::new();
            for raw in self.link_targets(&c) {
                let tgt = Self::norm_target(&raw);
                let key = tgt.to_lowercase();
                if tgt.is_empty() || seen.contains(&key) {
                    continue;
                }
                seen.insert(key.clone());
                if !names.contains(&key) {
                    out.push(BrokenLink {
                        source: name.clone(),
                        source_path: rel.clone(),
                        target: tgt,
                    });
                }
            }
        }
        out
    }

    // -----------------------------------------------------------------------
    // Search - word-based matching (phrase, -hits, -name_hits, len(name))
    // -----------------------------------------------------------------------

    /// Case-insensitive infix matching, ranked by (phrase, -hits, -name_hits, len(name)).
    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return Vec::new();
        }
        // tag:foo / #foo -> tag filter
        let tag_re = Regex::new(r"(?:tag:|#)([\w/-]+)").unwrap();
        let tag_filters: Vec<String> = tag_re
            .captures_iter(&q)
            .map(|c| c.get(1).unwrap().as_str().to_string())
            .collect();
        let q_stripped = tag_re.replace_all(&q, " ").trim().to_string();

        let word_re = Regex::new(r"[^\w/-]+").unwrap();
        let words: Vec<String> = word_re
            .split(&q_stripped)
            .filter(|w| !w.is_empty())
            .map(|w| w.to_string())
            .collect();

        if words.is_empty() && tag_filters.is_empty() {
            return Vec::new();
        }

        let docs = self.load_docs();
        let mut scored: Vec<((u8, i64, i64, usize), SearchHit)> = Vec::new();

        for d in &docs {
            if !self.visible(&d.path) {
                continue;
            }
            if !tag_filters.is_empty() {
                let dt: BTreeSet<&str> = d.tags.split_whitespace().collect();
                if !tag_filters.iter().all(|t| dt.contains(t.as_str())) {
                    continue;
                }
                if words.is_empty() {
                    scored.push((
                        (1, 0, 0, d.name.len()),
                        SearchHit {
                            path: d.path.clone(),
                            name: d.name.clone(),
                            folder: d.folder.clone(),
                            score: 1,
                            snippet: format!("#{}", tag_filters.join(" #")),
                        },
                    ));
                    continue;
                }
            }

            let name_l = d.name.to_lowercase();
            let body_l = d.body.to_lowercase();
            let mut hits = 0usize;
            let mut name_hits = 0usize;
            let mut first: Option<String> = None;
            for w in &words {
                let in_n = name_l.contains(w.as_str());
                let in_b = body_l.contains(w.as_str());
                if in_n || in_b {
                    hits += 1;
                    if in_n {
                        name_hits += 1;
                    }
                    if first.is_none() {
                        first = Some(w.clone());
                    }
                }
            }
            if hits == 0 {
                continue;
            }
            let phrase = name_l.contains(&q_stripped) || body_l.contains(&q_stripped);
            let snippet = match &first {
                Some(f) => match body_l.find(f.as_str()) {
                    Some(pos) => {
                        // The byte index returned by `find` can land inside a
                        // multi-byte UTF-8 character (e.g. an em dash). Move it
                        // back to the nearest character boundary.
                        let mut start = pos.saturating_sub(40);
                        while start > 0 && !d.body.is_char_boundary(start) {
                            start -= 1;
                        }
                        let mut end = (pos + f.len() + 40).min(d.body.len());
                        while end < d.body.len() && !d.body.is_char_boundary(end) {
                            end += 1;
                        }
                        let frag = &d.body[start..end];
                        let i = frag.to_lowercase().find(f.as_str()).unwrap_or(0);
                        // Lowercasing can change byte lengths, so `i` may even
                        // point past the end of `frag`.
                        let mut hi = i.min(frag.len());
                        while hi < frag.len() && !frag.is_char_boundary(hi) {
                            hi += 1;
                        }
                        let mut he = (i + f.len()).min(frag.len());
                        while he < frag.len() && !frag.is_char_boundary(he) {
                            he += 1;
                        }
                        format!(
                            "{}{}<b>{}</b>{}{}",
                            if start > 0 { "…" } else { "" },
                            &frag[..hi],
                            &frag[hi..he],
                            &frag[he..],
                            if end < d.body.len() { "…" } else { "" }
                        )
                    }
                    None => String::new(),
                },
                None => String::new(),
            };
            let rank = (
                if phrase { 0u8 } else { 1u8 },
                -(hits as i64),
                -(name_hits as i64),
                d.name.len(),
            );
            scored.push((
                rank,
                SearchHit {
                    path: d.path.clone(),
                    name: d.name.clone(),
                    folder: d.folder.clone(),
                    score: hits,
                    snippet,
                },
            ));
        }

        scored.sort_by_key(|x| x.0);
        scored.into_iter().take(limit).map(|(_, h)| h).collect()
    }

    /// Load the `docs` rows from the SQLite search index.
    fn load_docs(&self) -> Vec<DocRow> {
        let Ok(conn) = rusqlite::Connection::open_with_flags(
            &self.fts_db,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) else {
            return Vec::new();
        };
        let stmt = conn.prepare("SELECT path,name,folder,body,tags FROM docs");
        let Ok(mut stmt) = stmt else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |r| {
            Ok(DocRow {
                path: r.get(0)?,
                name: r.get(1)?,
                folder: r.get(2)?,
                body: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                tags: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
            })
        });
        match rows {
            Ok(it) => it.filter_map(Result::ok).collect(),
            Err(_) => Vec::new(),
        }
    }

    /// Build the full-text search index.
    pub fn reindex(&self) -> anyhow::Result<usize> {
        let conn = self.open_db_write()?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, name TEXT, folder TEXT, \
             name_l TEXT, body TEXT, body_l TEXT, md5 TEXT, tags TEXT)",
            [],
        )?;
        let mut n = 0usize;
        let mut seen: BTreeSet<String> = BTreeSet::new();
        // Every note, also those hidden from the caller that triggered the reindex.
        for (rel, name, fp) in self.walk_all() {
            let Some(c) = self.read(&fp) else { continue };
            seen.insert(rel.clone());
            let mut body = c.clone();
            if body.starts_with("---") {
                let parts: Vec<&str> = body.splitn(3, "---").collect();
                if parts.len() >= 3 {
                    body = parts[2].to_string();
                }
            }
            if body.len() > 50000 {
                let mut cut = 50000;
                while !body.is_char_boundary(cut) {
                    cut -= 1;
                }
                body.truncate(cut);
            }
            let mut tags: BTreeSet<String> = BTreeSet::new();
            for cap in re_tag().captures_iter(&body) {
                tags.insert(cap.get(1).unwrap().as_str().to_lowercase());
            }
            // tags from frontmatter (read from the raw content)
            if let Some(cap) = re_fm_tags().captures(&c) {
                for t in cap.get(1).unwrap().as_str().split(',') {
                    let t = t
                        .trim()
                        .trim_matches(|ch| ch == '\'' || ch == '"')
                        .trim_start_matches('#');
                    if !t.is_empty() {
                        tags.insert(t.to_lowercase());
                    }
                }
            }
            let md5 = format!("{:x}", md5_hex(c.as_bytes()));
            conn.execute(
                "INSERT OR REPLACE INTO docs (path,name,folder,name_l,body,body_l,md5,tags) \
                 VALUES (?,?,?,?,?,?,?,?)",
                rusqlite::params![
                    rel,
                    name,
                    folder_of(&rel),
                    name.to_lowercase(),
                    body,
                    body.to_lowercase(),
                    md5,
                    tags.into_iter().collect::<Vec<_>>().join(" ")
                ],
            )?;
            n += 1;
        }
        // Notes deleted, moved or renamed on disk leave no ghost rows behind
        // (search would still find them while read says "not found").
        let indexed: Vec<String> = {
            let mut st = conn.prepare("SELECT path FROM docs")?;
            let rows = st.query_map([], |r| r.get::<_, String>(0))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        let mut del = conn.prepare("DELETE FROM docs WHERE path = ?1")?;
        for p in indexed.iter().filter(|p| !seen.contains(*p)) {
            del.execute([p])?;
        }
        Ok(n)
    }

    /// Open the search index for writing, with hardening pragmas.
    fn open_db_write(&self) -> anyhow::Result<rusqlite::Connection> {
        let conn = rusqlite::Connection::open(&self.fts_db)?;
        let _ = conn.pragma_update(None, "trusted_schema", "OFF");
        let _ = conn.pragma_update(None, "foreign_keys", "ON");
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        let _ = conn.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true);
        Ok(conn)
    }
}

#[derive(Debug, Clone)]
struct DocRow {
    path: String,
    name: String,
    folder: String,
    body: String,
    tags: String,
}

/// Minimal MD5 (RFC 1321), stored in the search index as a content fingerprint.
pub fn md5_hex(data: &[u8]) -> u128 {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let mut msg = data.to_vec();
    let bitlen = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bitlen.to_le_bytes());

    let (mut a0, mut b0, mut c0, mut d0) =
        (0x67452301u32, 0xefcdab89u32, 0x98badcfeu32, 0x10325476u32);

    for chunk in msg.chunks(64) {
        let mut m = [0u32; 16];
        for (i, w) in chunk.chunks(4).enumerate() {
            m[i] = u32::from_le_bytes([w[0], w[1], w[2], w[3]]);
        }
        let (mut a, mut b, mut c, mut d) = (a0, b0, c0, d0);
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let f2 = f
                .wrapping_add(a)
                .wrapping_add(
                    [
                        0xd76aa478u32,
                        0xe8c7b756,
                        0x242070db,
                        0xc1bdceee,
                        0xf57c0faf,
                        0x4787c62a,
                        0xa8304613,
                        0xfd469501,
                        0x698098d8,
                        0x8b44f7af,
                        0xffff5bb1,
                        0x895cd7be,
                        0x6b901122,
                        0xfd987193,
                        0xa679438e,
                        0x49b40821,
                        0xf61e2562,
                        0xc040b340,
                        0x265e5a51,
                        0xe9b6c7aa,
                        0xd62f105d,
                        0x02441453,
                        0xd8a1e681,
                        0xe7d3fbc8,
                        0x21e1cde6,
                        0xc33707d6,
                        0xf4d50d87,
                        0x455a14ed,
                        0xa9e3e905,
                        0xfcefa3f8,
                        0x676f02d9,
                        0x8d2a4c8a,
                        0xfffa3942,
                        0x8771f681,
                        0x6d9d6122,
                        0xfde5380c,
                        0xa4beea44,
                        0x4bdecfa9,
                        0xf6bb4b60,
                        0xbebfbc70,
                        0x289b7ec6,
                        0xeaa127fa,
                        0xd4ef3085,
                        0x04881d05,
                        0xd9d4d039,
                        0xe6db99e5,
                        0x1fa27cf8,
                        0xc4ac5665,
                        0xf4292244,
                        0x432aff97,
                        0xab9423a7,
                        0xfc93a039,
                        0x655b59c3,
                        0x8f0ccc92,
                        0xffeff47d,
                        0x85845dd1,
                        0x6fa87e4f,
                        0xfe2ce6e0,
                        0xa3014314,
                        0x4e0811a1,
                        0xf7537e82,
                        0xbd3af235,
                        0x2ad7d2bb,
                        0xeb86d391,
                    ][i],
                )
                .wrapping_add(m[g]);
            let tmp = d;
            d = c;
            c = b;
            b = b.wrapping_add(f2.rotate_left(S[i]));
            a = tmp;
        }
        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }
    let mut out = [0u8; 16];
    out[..4].copy_from_slice(&a0.to_le_bytes());
    out[4..8].copy_from_slice(&b0.to_le_bytes());
    out[8..12].copy_from_slice(&c0.to_le_bytes());
    out[12..].copy_from_slice(&d0.to_le_bytes());
    u128::from_le_bytes(out)
}

#[cfg(test)]
mod resource_tests {
    use super::*;

    fn tmp_vault(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "memora-core-{tag}-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
        ));
        fs::create_dir_all(d.join("Projects")).unwrap();
        d
    }

    #[test]
    fn same_names_resolve_deterministically() {
        let d = tmp_vault("dupes");
        fs::create_dir_all(d.join("Ideas")).unwrap();
        fs::write(d.join("Projects/Plan.md"), "p").unwrap();
        fs::write(d.join("Ideas/Plan.md"), "i").unwrap();
        let s = MemoryStore::new(&d);
        assert_eq!(
            s.resolve_wikilink_from("Plan", "Ideas").as_deref(),
            Some("Ideas/Plan.md")
        );
        assert_eq!(
            s.resolve_wikilink_from("Plan", "Projects").as_deref(),
            Some("Projects/Plan.md")
        );
        assert_eq!(
            s.resolve_wikilink_from("Ideas/Plan", "Projects").as_deref(),
            Some("Ideas/Plan.md")
        );
        assert_eq!(s.resolve_wikilink_from("Nowhere/Plan", "").as_deref(), None);
        // From elsewhere: the same answer every time (alphabetical at equal depth).
        assert_eq!(s.resolve_wikilink("Plan").as_deref(), Some("Ideas/Plan.md"));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn note_paths_stay_in_the_vault() {
        let d = tmp_vault("paths");
        let s = MemoryStore::new(&d);
        assert!(s.resolve("Projects/a.md").is_ok());
        assert!(
            s.resolve(".Trash/a.md").is_ok(),
            "the trash stays addressable"
        );
        for bad in [
            "../x.md",
            "Projects/../../x.md",
            ".locks.json",
            "Projects/.git/config",
            ".events.jsonl",
            "a\u{0}b.md",
        ] {
            assert!(s.resolve(bad).is_err(), "{bad} must be refused");
        }
        #[cfg(unix)]
        {
            let out = std::env::temp_dir().join(format!("memora-core-out-{}", std::process::id()));
            fs::create_dir_all(&out).unwrap();
            std::os::unix::fs::symlink(&out, d.join("Projects/link")).unwrap();
            assert!(
                s.resolve("Projects/link/x.md").is_err(),
                "a symlink out of the vault is refused"
            );
            let _ = fs::remove_dir_all(&out);
        }
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn deleted_notes_leave_the_search_index() {
        let d = tmp_vault("ghost");
        fs::write(d.join("Projects/keep.md"), "zebra keep").unwrap();
        fs::write(d.join("Projects/gone.md"), "zebra gone").unwrap();
        let s = MemoryStore::new(&d);
        s.reindex().unwrap();
        assert_eq!(s.search("zebra", 10).len(), 2);
        s.delete_impl("Projects/gone.md").unwrap();
        let hits = s.search("zebra", 10);
        assert_eq!(hits.len(), 1, "deleted note still found");
        // A whole folder going away clears its rows too.
        s.delete_folder_impl("Projects").unwrap();
        fs::remove_file(d.join("keep.md")).unwrap();
        s.reindex().unwrap();
        assert!(s.search("zebra", 10).is_empty());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn folder_rename_move_and_meta() {
        let d = tmp_vault("fold");
        fs::create_dir_all(d.join("A/B/C")).unwrap();
        fs::write(d.join("A/B/C/n.md"), "deep").unwrap();
        fs::write(d.join("A/x.md"), "x").unwrap();
        let s = MemoryStore::new(&d);
        // Metadata needs an existing folder.
        assert!(s
            .set_folder_meta_impl("Nope", Some("#ff0000"), None, None)
            .is_err());
        s.set_folder_meta_impl("A/B", Some("#12AB34"), Some("flask"), None)
            .unwrap();
        assert!(s
            .set_folder_meta_impl("A/B", Some("red"), None, None)
            .is_err());
        // Sub folders inherit the nearest parent's color.
        assert_eq!(
            s.get_folder_meta_impl(Some("A/B/C"))["inherited"]["color"],
            "#12ab34"
        );
        let r = s.rename_folder_impl("A/B", "Bee").unwrap();
        assert_eq!(r["to"], "A/Bee");
        assert_eq!(s.get_folder_meta_impl(Some("A/Bee"))["icon"], "flask");
        assert!(d.join("A/Bee/C/n.md").is_file());
        s.move_folder_impl("A/Bee", "").unwrap();
        assert!(d.join("Bee/C/n.md").is_file());
        assert_eq!(s.get_folder_meta_impl(Some("Bee"))["color"], "#12ab34");
        assert!(s.move_folder_impl("Bee", "Bee/C").is_err(), "into itself");
        s.move_folder_contents_impl("Bee", "A").unwrap();
        assert!(d.join("A/C/n.md").is_file() && !d.join("Bee").exists());
        // Clearing every field drops the entry.
        s.set_folder_meta_impl("A", Some("#000000"), None, None)
            .unwrap();
        s.set_folder_meta_impl("A", Some(""), None, None).unwrap();
        assert!(s.get_folder_meta_impl(None).get("A").is_none());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn graph_nodes_carry_tags_and_follow_edits() {
        let d = tmp_vault("tags");
        fs::write(
            d.join("a.md"),
            "---\ntags: [alpha, \"#beta\"]\n---\nbody #gamma #alpha\n",
        )
        .unwrap();
        fs::write(d.join("Projects/b.md"), "no tags [[a]]").unwrap();
        let s = MemoryStore::new(&d);
        let tags_of = |s: &MemoryStore, id: &str| {
            s.graph()
                .nodes
                .into_iter()
                .find(|n| n.id == id)
                .unwrap()
                .tags
        };
        let a = tags_of(&s, "a");
        // Same tags as the note view (render_markdown).
        let (_, view_tags, _) =
            crate::vault::render_markdown(&fs::read_to_string(d.join("a.md")).unwrap(), &|_| None);
        assert_eq!(a, view_tags);
        assert!(a.contains(&"gamma".to_string()) && a.contains(&"beta".to_string()));
        assert!(tags_of(&s, "b").is_empty());
        fs::write(d.join("Projects/b.md"), "now #tagged, still [[a]]").unwrap();
        assert_eq!(tags_of(&s, "b"), ["tagged"]);
        assert_eq!(
            s.node_payload("Projects/b.md")["tags"],
            serde_json::json!(["tagged"])
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn link_cache_tracks_edits_and_deletions() {
        let d = tmp_vault("cache");
        fs::write(d.join("a.md"), "see [[b]] and [[c]]").unwrap();
        fs::write(d.join("Projects/b.md"), "back to [[a]]").unwrap();
        let s = MemoryStore::new(&d);
        let g = s.graph();
        assert_eq!(g.nodes.len(), 2);
        assert_eq!(g.links.len(), 2); // a->b, b->a (c does not exist)
        assert_eq!(s.stats().links, 3);
        assert_eq!(s.link_cache.lock().unwrap().len(), 2);

        // Edit (size changes) is picked up.
        fs::write(d.join("a.md"), "now only [[b]] here, nothing else").unwrap();
        assert_eq!(s.stats().links, 2);
        // Deleted notes leave the cache.
        fs::remove_file(d.join("Projects/b.md")).unwrap();
        let g = s.graph();
        assert_eq!(g.nodes.len(), 1);
        assert!(g.links.is_empty());
        assert_eq!(s.link_cache.lock().unwrap().len(), 1);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn dangling_symlinks_cannot_be_written_through() {
        let d = tmp_vault("dangle");
        #[cfg(unix)]
        {
            let target = d.with_extension("outside.md");
            std::os::unix::fs::symlink(&target, d.join("Projects/evil.md")).unwrap();
            let s = MemoryStore::new(&d);
            assert!(s.resolve("Projects/evil.md").is_err());
            assert!(s.create_impl("evil", "Projects", Some("x")).is_err());
            assert!(!target.exists());
        }
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn deleting_a_nested_folder_keeps_its_notes() {
        let d = tmp_vault("nested");
        fs::create_dir_all(d.join("A/B/C")).unwrap();
        fs::write(d.join("A/B/one.md"), "1").unwrap();
        fs::write(d.join("A/B/C/two.md"), "2").unwrap();
        fs::write(d.join("A/keep.md"), "k").unwrap();
        let s = MemoryStore::new(&d);
        s.set_folder_meta_impl("A/B/C", Some("#123456"), None, None)
            .unwrap();
        let r = s.delete_folder_impl("A/B/").unwrap();
        assert_eq!(r["moved_to_root"].as_array().unwrap().len(), 2, "{r}");
        assert!(d.join("one.md").is_file() && d.join("two.md").is_file());
        assert!(d.join("A/keep.md").is_file() && !d.join("A/B").exists());
        assert!(s.get_folder_meta_impl(None).get("A/B/C").is_none());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn restoring_from_trash_never_overwrites() {
        let d = tmp_vault("restore");
        fs::write(d.join("Projects/n.md"), "old").unwrap();
        let s = MemoryStore::new(&d);
        s.soft_delete_impl("Projects/n.md").unwrap();
        fs::write(d.join("Projects/n.md"), "new").unwrap();
        assert!(s.restore_trash_impl("n.md", "Projects").is_err());
        assert_eq!(fs::read_to_string(d.join("Projects/n.md")).unwrap(), "new");
        assert!(d.join(".Trash/n.md").is_file());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn backlinks_match_whole_names() {
        let d = tmp_vault("back");
        fs::write(d.join("Projects/Plan.md"), "plan").unwrap();
        fs::write(d.join("a.md"), "see [[Planning]]").unwrap();
        fs::write(d.join("b.md"), "see [[Projects/plan#Goals|the plan]]").unwrap();
        fs::write(d.join("c.md"), "code `[[Plan]]` only").unwrap();
        let s = MemoryStore::new(&d);
        let v = s.read_note_impl("Projects/Plan.md").unwrap();
        let back: Vec<&str> = v["backlinks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["path"].as_str().unwrap())
            .collect();
        assert_eq!(back, ["b.md"]);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn rename_tag_is_exact_and_refuses_empty_names() {
        let d = tmp_vault("retag");
        let src = "---\ntags: [old, other]\n---\n#old #old-thing #old/sub #older $x\n";
        fs::write(d.join("a.md"), src).unwrap();
        let s = MemoryStore::new(&d);
        assert!(s.rename_tag_impl("", "x").is_err());
        assert!(s.rename_tag_impl("old", " ").is_err());
        assert_eq!(fs::read_to_string(d.join("a.md")).unwrap(), src);
        s.rename_tag_impl("#old", "n$1").unwrap();
        assert_eq!(
            fs::read_to_string(d.join("a.md")).unwrap(),
            "---\ntags: [n$1, other]\n---\n#n$1 #old-thing #n$1/sub #older $x\n"
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn export_skips_hidden_folders() {
        let d = tmp_vault("export");
        fs::write(d.join("Projects/n.md"), "n").unwrap();
        fs::write(d.join("gone.md"), "g").unwrap();
        let s = MemoryStore::new(&d);
        s.soft_delete_impl("gone.md").unwrap();
        let zip = s.export_zip_impl(&[serde_json::json!("")]).unwrap();
        let names: Vec<String> = zip::ZipArchive::new(std::io::Cursor::new(zip))
            .unwrap()
            .file_names()
            .map(String::from)
            .collect();
        assert_eq!(names, ["Projects/n.md"]);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn wikilink_paths_are_not_reformatted() {
        let (h, _, _) = crate::vault::render_markdown("[[x]] and **b**", &|_| {
            Some("a**b**~~c~~.md".to_string())
        });
        assert!(h.contains(r#"data-path="a**b**~~c~~.md""#), "{h}");
        assert!(h.contains("<strong>b</strong>"), "{h}");
    }

    #[test]
    fn deleting_a_folder_spares_similarly_named_siblings() {
        let d = tmp_vault("sibling");
        fs::create_dir_all(d.join("Work/Plan/Sub")).unwrap();
        fs::create_dir_all(d.join("Work/Planning")).unwrap();
        fs::write(d.join("Work/Plan/a.md"), "a").unwrap();
        fs::write(d.join("Work/Plan/Sub/b.md"), "b").unwrap();
        fs::write(d.join("Work/Planning/c.md"), "c").unwrap();
        fs::write(d.join("Work/top.md"), "t").unwrap();
        let s = MemoryStore::new(&d);
        s.delete_folder_impl("Work/Plan").unwrap();
        assert!(d.join("a.md").is_file() && d.join("b.md").is_file());
        assert!(d.join("Work/Planning/c.md").is_file() && d.join("Work/top.md").is_file());
        // A top-level folder: every note at any depth survives in Root.
        s.delete_folder_impl("Work").unwrap();
        for n in ["a.md", "b.md", "c.md", "top.md"] {
            assert!(d.join(n).is_file(), "{n} lost");
        }
        assert!(!d.join("Work").exists());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn patch_keeps_multiline_frontmatter() {
        let d = tmp_vault("patch");
        let src = "---\ntitle: T\ndescription: |\n  line one: still one\n  line two\naliases:\n  - x\n  - y\ntags:\n  - a\n  - b\n# note\n---\nbody\n";
        fs::write(d.join("n.md"), src).unwrap();
        let s = MemoryStore::new(&d);
        let ops = [
            serde_json::json!({"op": "set_field", "field": "status", "value": "open"}),
            serde_json::json!({"op": "add_tag", "tag": "c"}),
        ];
        s.patch_memory_impl("n.md", &ops).unwrap();
        assert_eq!(
            fs::read_to_string(d.join("n.md")).unwrap(),
            "---\ntitle: T\ndescription: |\n  line one: still one\n  line two\naliases:\n  - x\n  - y\ntags: [a, b, c]\n# note\nstatus: open\n---\nbody\n"
        );
        // Patching again does not grow blank lines.
        s.patch_memory_impl("n.md", &ops).unwrap();
        let after = fs::read_to_string(d.join("n.md")).unwrap();
        assert!(after.ends_with("status: open\n---\nbody\n"), "{after}");
        assert_eq!(
            s.get_note_tags_impl("n.md").unwrap()["frontmatter_tags"],
            serde_json::json!(["a", "b", "c"])
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn folder_colors_are_six_digit_hex() {
        let d = tmp_vault("color");
        let s = MemoryStore::new(&d);
        for bad in ["#abc", "red", "#12345g", "123456", "#1234567", "url(x)"] {
            assert!(
                s.set_folder_meta_impl("Projects", Some(bad), None, None)
                    .is_err(),
                "{bad}"
            );
        }
        assert!(s
            .set_folder_meta_impl("Projects", Some("#A1b2C3"), None, None)
            .is_ok());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn search_and_index_survive_multibyte_text() {
        let d = tmp_vault("utf8");
        // Lowercasing U+0130 grows it from 2 to 3 bytes.
        fs::write(d.join("a.md"), format!("{}zebra", "\u{130}".repeat(20))).unwrap();
        // A long note whose 50000th byte falls inside a character.
        fs::write(d.join("b.md"), format!("x{}", "\u{e9}".repeat(30000))).unwrap();
        let s = MemoryStore::new(&d);
        assert_eq!(s.reindex().unwrap(), 2);
        let hits = s.search("zebra", 10);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.contains("zebra"), "{:?}", hits[0].snippet);
        fs::remove_dir_all(&d).ok();
    }
}
