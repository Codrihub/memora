//! Memora core: markdown vault model, search index, and vault store.
//!
//! Semantics:
//!   * `folder_of`    -> first path segment, else "Root"
//!   * `walk`         -> skip dot-entries (`.git`, `.Trash`, ...), only `*.md`
//!   * `link_targets` -> strip `{{placeholder}}` and code spans, then take `[[...]]`
//!   * `search`       -> word-based, rank (phrase, -hits, -name_hits, len(name)), over the
//!     in-memory note cache (no on-disk index; always matches the files on disk)

pub mod events;
pub mod privacy;
pub mod vault;

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use walkdir::WalkDir;

pub const DEFAULT_COLOR: &str = "#8a9098";

// ---------------------------------------------------------------------------
// Regexes, compiled once via `OnceLock`
// ---------------------------------------------------------------------------

fn cached<F: FnOnce() -> Regex>(cell: &'static OnceLock<Regex>, f: F) -> &'static Regex {
    cell.get_or_init(f)
}

/// `[[target]]`, `[[target|alias]]`, and the table-safe `[[target\|alias]]`
/// (Obsidian's escape): the backslash is never part of the target.
pub fn re_wikilink() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    cached(&RE, || {
        Regex::new(r"\[\[([^\]|]+?)\\?(?:\|([^\]]+))?\]\]").unwrap()
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
/// Words for similarity: 4+ lowercase letters or digits.
fn re_word() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    cached(&RE, || Regex::new(r"[a-z0-9]{4,}").unwrap())
}
/// A checklist item: `- [ ] text` / `* [x] text`.
fn re_todo() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    cached(&RE, || {
        Regex::new(r"^\s*[-*]\s+\[( |x|X)\]\s+(.+)").unwrap()
    })
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
    /// Parsed facts per note ([`NoteMeta`]), validated by (mtime, size). Rebuilt
    /// from the current walk on every use, so deleted notes drop out and the
    /// map never outgrows the vault. This is the search index too.
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
    meta: Arc<NoteMeta>,
}

impl MemoryStore {
    pub fn new<P: AsRef<Path>>(root: P) -> Self {
        let root = root.as_ref().to_path_buf();
        Self {
            root,
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

    /// Parsed facts for every walked note (same order as `files`).
    ///
    /// Only notes whose mtime or size changed since the last call are read and
    /// parsed again; the rest costs one `stat`. Every read-only tool (graph,
    /// search, query, similarity, todos) goes through here, so notes changed
    /// outside Memora (Obsidian, git pull, a copied file) show up on the next
    /// call and nothing re-reads the whole vault per request.
    pub(crate) fn scan(&self, files: &[(String, String, PathBuf)]) -> Vec<Arc<NoteMeta>> {
        let mut cache = self.link_cache.lock().unwrap_or_else(|e| e.into_inner());
        let mut fresh: HashMap<PathBuf, LinkCacheEntry> = HashMap::with_capacity(files.len());
        let mut out = Vec::with_capacity(files.len());
        for (_, _, fp) in files {
            let md = fs::metadata(fp).ok();
            let mtime = md.as_ref().and_then(|m| m.modified().ok());
            let len = md.as_ref().map(|m| m.len()).unwrap_or(0);
            let entry = match cache.remove(fp) {
                Some(e) if md.is_some() && e.mtime == mtime && e.len == len => e,
                _ => LinkCacheEntry {
                    mtime,
                    len,
                    meta: Arc::new(self.note_meta(&self.read(fp).unwrap_or_default())),
                },
            };
            out.push(entry.meta.clone());
            fresh.insert(fp.clone(), entry);
        }
        if self.restricted() {
            // A restricted walk skips hidden notes: keep their entries.
            cache.extend(fresh);
        } else {
            // The full walk: notes deleted on disk drop out.
            *cache = fresh;
        }
        out
    }

    /// Parse one note's content into a [`NoteMeta`].
    fn note_meta(&self, content: &str) -> NoteMeta {
        let (fm_text, _) = crate::vault::split_frontmatter(content);
        let mut fm = serde_json::Map::new();
        for (k, v) in crate::vault::parse_frontmatter(&fm_text) {
            fm.insert(k, v);
        }
        let mut body = content.to_string();
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
        let lower = content.to_lowercase();
        let words = re_word()
            .find_iter(&lower)
            .map(|m| m.as_str().to_string())
            .collect();
        let todos = content
            .split('\n')
            .enumerate()
            .filter_map(|(i, line)| {
                let c = re_todo().captures(line)?;
                let text = c[2].trim();
                // `- [ ]` with nothing after it is not a task.
                (!text.is_empty())
                    .then(|| (i + 1, c[1].eq_ignore_ascii_case("x"), text.to_string()))
            })
            .collect();
        let tags = crate::vault::note_tags(content);
        NoteMeta {
            targets: self.link_targets(content),
            search_tags: tags.iter().map(|t| t.to_lowercase()).collect(),
            tags,
            fm: serde_json::Value::Object(fm),
            body_l: body.to_lowercase(),
            body,
            words,
            todos,
        }
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

    /// Resolved wikilinks between the notes the caller can see. See [`LinkIndex`]
    /// for what counts as a link.
    pub fn link_index(&self) -> LinkIndex {
        let files = self.walk();
        let metas = self.scan(&files);
        self.link_index_of(&files, &metas)
    }

    pub(crate) fn link_index_of(
        &self,
        files: &[(String, String, PathBuf)],
        metas: &[Arc<NoteMeta>],
    ) -> LinkIndex {
        let mut idx = LinkIndex::default();
        let mut lower: HashMap<String, String> = HashMap::new();
        for (rel, name, _) in files {
            idx.names.insert(name.clone(), rel.clone());
            lower
                .entry(name.to_lowercase())
                .or_insert_with(|| name.clone());
        }
        for ((_, name, _), meta) in files.iter().zip(metas) {
            idx.out.entry(name.clone()).or_default();
            for raw in &meta.targets {
                let tgt = Self::norm_target(raw);
                if tgt.is_empty() {
                    continue;
                }
                let hit = if idx.names.contains_key(&tgt) {
                    Some(tgt.clone())
                } else {
                    lower.get(&tgt.to_lowercase()).cloned()
                };
                match hit {
                    Some(t) if t == *name => {}
                    Some(t) => {
                        for k in [name, &t] {
                            if !idx.first_seen.contains_key(k) {
                                idx.first_seen.insert(k.clone(), idx.first_seen.len());
                            }
                        }
                        idx.incoming
                            .entry(t.clone())
                            .or_default()
                            .insert(name.clone());
                        idx.out.entry(name.clone()).or_default().insert(t);
                    }
                    None => {
                        idx.broken.entry(name.clone()).or_default().insert(tgt);
                    }
                }
            }
        }
        idx
    }

    /// `links` counts unique resolved links between two different notes (A->B once,
    /// see [`LinkIndex`]).
    pub fn stats(&self) -> Stats {
        let files = self.walk();
        let idx = self.link_index();
        let folders: BTreeSet<String> = files.iter().map(|(rel, _, _)| folder_of(rel)).collect();
        Stats {
            notes: files.len(),
            links: idx.link_count(),
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

    /// One node per note; one edge per resolved link (see [`LinkIndex`]). A node's
    /// `degree` is its number of distinct linked notes, in either direction.
    pub fn graph(&self) -> Graph {
        let files = self.walk();
        let metas = self.scan(&files);
        let idx = self.link_index_of(&files, &metas);
        let nodes = files
            .iter()
            .zip(&metas)
            .map(|((rel, name, _), meta)| GraphNode {
                id: name.clone(),
                path: rel.clone(),
                folder: folder_of(rel),
                color: DEFAULT_COLOR.to_string(),
                degree: idx.degree(name),
                tags: meta.tags.clone(),
            })
            .collect();
        let links = idx
            .out
            .iter()
            .flat_map(|(s, ts)| {
                ts.iter().map(move |t| GraphLink {
                    source: s.clone(),
                    target: t.clone(),
                })
            })
            .collect();
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
    ///
    /// Each distinct query word counts once. A query with no word characters at all
    /// (`.*[(`, an emoji) is matched literally. Snippets are HTML-escaped text with the
    /// first match wrapped in `<b>...</b>`, the only markup they contain.
    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        let q = query.trim().to_lowercase();
        if q.is_empty() || limit == 0 {
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
        let mut words: Vec<String> = Vec::new();
        for w in word_re.split(&q_stripped).filter(|w| !w.is_empty()) {
            if !words.iter().any(|x| x == w) {
                words.push(w.to_string());
            }
        }
        if words.is_empty() && !q_stripped.is_empty() {
            // Only symbols: look for the text itself.
            words.push(q_stripped.clone());
        }

        if words.is_empty() && tag_filters.is_empty() {
            return Vec::new();
        }

        let files = self.walk();
        let metas = self.scan(&files);
        let mut scored: Vec<((u8, i64, i64, usize), SearchHit)> = Vec::new();

        for ((rel, name, _), d) in files.iter().zip(&metas) {
            if !tag_filters.is_empty() {
                if !tag_filters.iter().all(|t| d.search_tags.contains(t)) {
                    continue;
                }
                if words.is_empty() {
                    scored.push((
                        (1, 0, 0, name.len()),
                        SearchHit {
                            path: rel.clone(),
                            name: name.clone(),
                            folder: folder_of(rel),
                            score: 1,
                            snippet: html_escape(&format!("#{}", tag_filters.join(" #"))),
                        },
                    ));
                    continue;
                }
            }

            let name_l = name.to_lowercase();
            let body_l = &d.body_l;
            let mut hits = 0usize;
            let mut name_hits = 0usize;
            let mut first: Option<&str> = None;
            for w in &words {
                let in_n = name_l.contains(w.as_str());
                let in_b = body_l.contains(w.as_str());
                if in_n || in_b {
                    hits += 1;
                    if in_n {
                        name_hits += 1;
                    }
                    if first.is_none() && in_b {
                        first = Some(w);
                    }
                }
            }
            if hits == 0 {
                continue;
            }
            let phrase = name_l.contains(&q_stripped) || body_l.contains(&q_stripped);
            let snippet = first
                .and_then(|f| snippet_of(&d.body, body_l, f))
                .unwrap_or_default();
            let rank = (
                if phrase { 0u8 } else { 1u8 },
                -(hits as i64),
                -(name_hits as i64),
                name.len(),
            );
            scored.push((
                rank,
                SearchHit {
                    path: rel.clone(),
                    name: name.clone(),
                    folder: folder_of(rel),
                    score: hits,
                    snippet,
                },
            ));
        }

        scored.sort_by_key(|x| x.0);
        scored.into_iter().take(limit).map(|(_, h)| h).collect()
    }

    /// Refresh the in-memory index of every note (also those hidden from the current
    /// caller) and return how many notes it holds. Search and the graph tools refresh
    /// it themselves on every call (one `stat` per unchanged note), so this is only
    /// a warm-up; it never needs to run for results to be correct.
    pub fn reindex(&self) -> anyhow::Result<usize> {
        let files = self.walk_all();
        let metas = self.scan(&files);
        // Older versions kept a copy of every note in `.fts.db`; it is no longer read.
        for f in [".fts.db", ".fts.db-wal", ".fts.db-shm"] {
            let p = self.root.join(f);
            if p.is_file() {
                let _ = fs::remove_file(p);
            }
        }
        Ok(metas.len())
    }
}

/// Everything the read-only tools need from one note, parsed once per (mtime, size).
pub(crate) struct NoteMeta {
    /// Raw wikilink targets, in order (see [`MemoryStore::link_targets`]).
    pub targets: Vec<String>,
    /// Inline `#tags` + frontmatter `tags`, as the note view reports them.
    pub tags: Vec<String>,
    /// `tags`, lowercased (search and query filters ignore case).
    pub search_tags: BTreeSet<String>,
    /// Frontmatter as a JSON object.
    pub fm: serde_json::Value,
    /// Body without frontmatter (first 50000 bytes), and its lowercase form.
    pub body: String,
    pub body_l: String,
    /// Lowercase words of 4+ letters or digits (similarity).
    pub words: BTreeSet<String>,
    /// Checklist items: `(line, done, text)`.
    pub todos: Vec<(usize, bool, String)>,
}

/// Wikilinks between notes, the one definition every graph tool uses: a link is a
/// `[[target]]` that resolves (by note name, exact case first, then ignoring case)
/// to a note other than the one it is written in, counted once per pair of notes
/// and direction. Self-links do not count; targets that resolve to no note are
/// `broken`. A note's degree is the number of distinct notes it links to or is
/// linked from.
#[derive(Debug, Default)]
pub struct LinkIndex {
    /// Note name -> relative path (the last one walked when names repeat).
    pub names: BTreeMap<String, String>,
    /// Note name -> names of the notes it links to.
    pub out: BTreeMap<String, BTreeSet<String>>,
    /// Note name -> names of the notes linking to it.
    pub incoming: BTreeMap<String, BTreeSet<String>>,
    /// Note name -> link targets that resolve to no note.
    pub broken: BTreeMap<String, BTreeSet<String>>,
    /// Order in which notes first took part in a link while walking (tie-breaks).
    pub first_seen: BTreeMap<String, usize>,
}

impl LinkIndex {
    /// Distinct notes linked to or from `name`.
    pub fn neighbors(&self, name: &str) -> BTreeSet<String> {
        let mut s = self.out.get(name).cloned().unwrap_or_default();
        if let Some(i) = self.incoming.get(name) {
            s.extend(i.iter().cloned());
        }
        s
    }

    pub fn degree(&self, name: &str) -> usize {
        self.neighbors(name).len()
    }

    /// Total number of links.
    pub fn link_count(&self) -> usize {
        self.out.values().map(|s| s.len()).sum()
    }
}

/// `body` around the first occurrence of `word` (lowercase) in `body_l`, escaped,
/// with the match in `<b>`.
fn snippet_of(body: &str, body_l: &str, word: &str) -> Option<String> {
    let pos = body_l.find(word)?;
    // Lowercasing can change byte lengths, so a position in `body_l` is only
    // approximately one in `body`: clamp and move to character boundaries.
    let mut start = pos.saturating_sub(40).min(body.len());
    while start > 0 && !body.is_char_boundary(start) {
        start -= 1;
    }
    let mut end = (pos + word.len() + 40).min(body.len());
    while end < body.len() && !body.is_char_boundary(end) {
        end += 1;
    }
    let frag = &body[start..end];
    let i = frag.to_lowercase().find(word).unwrap_or(0);
    let mut hi = i.min(frag.len());
    while hi < frag.len() && !frag.is_char_boundary(hi) {
        hi += 1;
    }
    let mut he = (i + word.len()).min(frag.len());
    while he < frag.len() && !frag.is_char_boundary(he) {
        he += 1;
    }
    Some(format!(
        "{}{}<b>{}</b>{}{}",
        if start > 0 { "…" } else { "" },
        html_escape(&frag[..hi]),
        html_escape(&frag[hi..he]),
        html_escape(&frag[he..]),
        if end < body.len() { "…" } else { "" }
    ))
}

/// Escape text for HTML (`& < > " '`).
pub fn html_escape(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&#39;"),
            c => o.push(c),
        }
    }
    o
}

/// Minimal MD5 (RFC 1321), a content fingerprint.
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
            "memora-core-{tag}-{}-{}",
            std::process::id(),
            std::time::UNIX_EPOCH.elapsed().unwrap().as_nanos()
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
                                      // The broken link to c does not count (see `LinkIndex`).
        assert_eq!(s.stats().links, 2);
        assert_eq!(s.link_cache.lock().unwrap().len(), 2);

        // Edit (size changes) is picked up.
        fs::write(d.join("a.md"), "no links here any more, nothing else").unwrap();
        assert_eq!(s.stats().links, 1);
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
        // `$1` is not a valid tag (it used to be a regex replacement trap).
        assert!(s.rename_tag_impl("old", "n$1").is_err());
        s.rename_tag_impl("#old", "n1").unwrap();
        assert_eq!(
            fs::read_to_string(d.join("a.md")).unwrap(),
            "---\ntags: [n1, other]\n---\n#n1 #old-thing #n1/sub #older $x\n"
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn tag_writes_refuse_yaml_unsafe_tags() {
        let d = tmp_vault("tag-unsafe");
        let src = "---\ntitle: T\ntags: [a]\n---\nbody\n";
        fs::write(d.join("n.md"), src).unwrap();
        let s = MemoryStore::new(&d);
        for bad in [
            "ok\nstatus: hacked",
            "ok\n---\nbody",
            "[brack]",
            "b]",
            "tag:colon",
            "quo\"te",
            "x#hash",
            "has space",
            "a---b",
            "tab\tx",
        ] {
            assert!(s.add_tags_impl("n.md", bad).is_err(), "add {bad:?}");
            assert!(s.set_tags_impl("n.md", bad).is_err(), "set {bad:?}");
            let op = serde_json::json!({"op": "add_tag", "tag": bad});
            assert!(s.patch_memory_impl("n.md", &[op]).is_err(), "patch {bad:?}");
            s.rename_tag_impl("a", "z").ok();
            assert!(s.rename_tag_impl("z", bad).is_err(), "rename {bad:?}");
            s.rename_tag_impl("z", "a").unwrap();
        }
        for empty in ["", "  ", "#"] {
            let op = serde_json::json!({"op": "add_tag", "tag": empty});
            assert!(s.patch_memory_impl("n.md", &[op]).is_err(), "{empty:?}");
            let op = serde_json::json!({"op": "remove_tag", "tag": empty});
            assert!(s.patch_memory_impl("n.md", &[op]).is_err(), "{empty:?}");
        }
        assert_eq!(fs::read_to_string(d.join("n.md")).unwrap(), src);
        // A leading # is dropped; unicode letters, digits and - _ / . are fine.
        s.add_tags_impl("n.md", "#hash, kafé, v1.2, a_b/c-d")
            .unwrap();
        assert_eq!(
            fs::read_to_string(d.join("n.md")).unwrap(),
            "---\ntitle: T\ntags: [a, hash, kafé, v1.2, a_b/c-d]\n---\nbody\n"
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn set_field_refuses_frontmatter_injection() {
        let d = tmp_vault("set-field");
        let src = "---\ntitle: T\n---\nbody\n";
        fs::write(d.join("n.md"), src).unwrap();
        let s = MemoryStore::new(&d);
        let bad = [
            serde_json::json!({"op": "set_field", "field": "status", "value": "x\nhacked: yes"}),
            serde_json::json!({"op": "set_field", "field": "status", "value": "x\r\n---\nbody"}),
            serde_json::json!({"op": "set_field", "field": "status", "value": "a --- b"}),
            serde_json::json!({"op": "set_field", "field": "a\nhacked", "value": "v"}),
            serde_json::json!({"op": "set_field", "field": "a: b", "value": "v"}),
            serde_json::json!({"op": "set_field", "field": "two words", "value": "v"}),
        ];
        for op in bad {
            assert!(
                s.patch_memory_impl("n.md", std::slice::from_ref(&op))
                    .is_err(),
                "{op}"
            );
        }
        assert_eq!(fs::read_to_string(d.join("n.md")).unwrap(), src);
        let ok = [
            serde_json::json!({"op": "set_field", "field": "due-date_2.x", "value": "2026-01-01: noon"}),
            serde_json::json!({"op": "set_field", "field": "n", "value": 3}),
        ];
        s.patch_memory_impl("n.md", &ok).unwrap();
        assert_eq!(
            fs::read_to_string(d.join("n.md")).unwrap(),
            "---\ntitle: T\ndue-date_2.x: 2026-01-01: noon\nn: 3\n---\nbody\n"
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn patch_refuses_unknown_and_missing_op_keys() {
        let d = tmp_vault("patch-keys");
        fs::write(d.join("n.md"), "body\n").unwrap();
        let s = MemoryStore::new(&d);
        let e = s
            .patch_memory_impl(
                "n.md",
                &[serde_json::json!({"op": "append", "text": "x", "extra": 1})],
            )
            .unwrap_err()
            .to_string();
        assert!(
            e.contains("op 1") && e.contains("`extra`") && e.contains("op, text"),
            "{e}"
        );
        for bad in [
            serde_json::json!({}),
            serde_json::json!("str"),
            serde_json::json!({"op": 3}),
        ] {
            let e = s.patch_memory_impl("n.md", &[bad]).unwrap_err().to_string();
            assert!(
                e.contains("op 1 has no `op`")
                    && e.contains("append, prepend, replace, set_field, add_tag, remove_tag"),
                "{e}"
            );
        }
        let ops = [
            serde_json::json!({"op": "append", "text": "x"}),
            serde_json::json!({"op": "bogus"}),
        ];
        let e = s.patch_memory_impl("n.md", &ops).unwrap_err().to_string();
        assert!(e.contains("op 2") && e.contains("`bogus`"), "{e}");
        assert_eq!(fs::read_to_string(d.join("n.md")).unwrap(), "body\n");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn set_tags_replaces_exactly() {
        let d = tmp_vault("set-tags");
        fs::write(
            d.join("n.md"),
            "---\ntags: [[brack], old]\n---\nbody #inline\n",
        )
        .unwrap();
        let s = MemoryStore::new(&d);
        let v = s.set_tags_impl("n.md", "new, NEW, other").unwrap();
        assert_eq!(v["frontmatter_tags"], serde_json::json!(["new", "other"]));
        let v = s.set_tags_impl("n.md", "new").unwrap();
        assert_eq!(v["frontmatter_tags"], serde_json::json!(["new"]));
        assert_eq!(v["tags"], serde_json::json!(["inline", "new"]));
        let v = s.set_tags_impl("n.md", "").unwrap();
        assert_eq!(v["frontmatter_tags"], serde_json::json!([]));
        // No tags before and none asked: the note is not touched.
        fs::write(d.join("m.md"), "plain\n").unwrap();
        s.set_tags_impl("m.md", "").unwrap();
        assert_eq!(fs::read_to_string(d.join("m.md")).unwrap(), "plain\n");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn tag_writes_ignore_case() {
        let d = tmp_vault("tag-case");
        fs::write(d.join("n.md"), "---\ntags: [alpha, Gamma]\n---\nbody\n").unwrap();
        fs::write(d.join("m.md"), "---\ntags: [Atlas, b]\n---\n#ATLAS here\n").unwrap();
        let s = MemoryStore::new(&d);
        let v = s.add_tags_impl("n.md", "ALPHA").unwrap();
        assert_eq!(v["frontmatter_tags"], serde_json::json!(["alpha", "Gamma"]));
        let v = s.remove_tags_impl("n.md", "gamma").unwrap();
        assert_eq!(v["frontmatter_tags"], serde_json::json!(["alpha"]));
        assert!(v.get("note").is_none(), "{v}");
        let r = s.rename_tag_impl("atlas", "b").unwrap();
        assert_eq!(r["notes"], serde_json::json!(["m.md"]));
        assert_eq!(
            fs::read_to_string(d.join("m.md")).unwrap(),
            "---\ntags: [b]\n---\n#b here\n"
        );
        // Changing only the case is a rename too.
        s.rename_tag_impl("ALPHA", "Alpha").unwrap();
        assert_eq!(
            fs::read_to_string(d.join("n.md")).unwrap(),
            "---\ntags: [Alpha]\n---\nbody\n"
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn missing_tags_are_reported() {
        let d = tmp_vault("tag-missing");
        let src = "---\ntags: [a]\n---\nbody #inl\n";
        fs::write(d.join("n.md"), src).unwrap();
        let s = MemoryStore::new(&d);
        let v = s.remove_tags_impl("n.md", "nope, inl").unwrap();
        let note = v["note"].as_str().unwrap();
        assert!(note.contains("'nope' is not on this note"), "{note}");
        assert!(note.contains("'inl' is only an inline #tag"), "{note}");
        assert_eq!(fs::read_to_string(d.join("n.md")).unwrap(), src);
        let e = s.rename_tag_impl("nope", "x").unwrap_err().to_string();
        assert!(e.contains("tag 'nope' is not on any note"), "{e}");
        assert!(s.rename_tag_impl("a", "#a").is_err());
        // A note whose tags line lacks the tag is not rewritten.
        fs::write(d.join("m.md"), "---\ntags: [x,y]\n---\n").unwrap();
        s.rename_tag_impl("a", "b").unwrap();
        assert_eq!(
            fs::read_to_string(d.join("m.md")).unwrap(),
            "---\ntags: [x,y]\n---\n"
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn string_form_tags_are_separate_tags() {
        let d = tmp_vault("tag-string");
        fs::write(d.join("n.md"), "---\ntags: \"solo, c#, Solo\"\n---\nbody\n").unwrap();
        fs::write(d.join("m.md"), "---\ntags: one\n---\nbody\n").unwrap();
        let s = MemoryStore::new(&d);
        let v = s.get_note_tags_impl("n.md").unwrap();
        assert_eq!(
            v["frontmatter_tags"],
            serde_json::json!(["solo", "c#", "Solo"])
        );
        assert_eq!(
            s.get_note_tags_impl("m.md").unwrap()["tags"],
            serde_json::json!(["one"])
        );
        s.add_tags_impl("n.md", "solo, new").unwrap();
        assert_eq!(
            fs::read_to_string(d.join("n.md")).unwrap(),
            "---\ntags: [solo, c#, new]\n---\nbody\n"
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn ordinary_tags_round_trip_unchanged() {
        let d = tmp_vault("tag-roundtrip");
        let src = "---\ncreated: 2026-01-01\ntags: [tech, project/memora, v1.2]\nstatus: open\n---\n\n# T\n\nbody #inline\n";
        fs::write(d.join("n.md"), src).unwrap();
        let s = MemoryStore::new(&d);
        let v = s.get_note_tags_impl("n.md").unwrap();
        assert_eq!(
            v["frontmatter_tags"],
            serde_json::json!(["tech", "project/memora", "v1.2"])
        );
        s.add_tags_impl("n.md", "extra").unwrap();
        s.remove_tags_impl("n.md", "extra").unwrap();
        assert_eq!(fs::read_to_string(d.join("n.md")).unwrap(), src);
        s.set_tags_impl("n.md", "tech, project/memora, v1.2")
            .unwrap();
        assert_eq!(fs::read_to_string(d.join("n.md")).unwrap(), src);
        s.rename_tag_impl("tech", "tek").unwrap();
        s.rename_tag_impl("tek", "tech").unwrap();
        assert_eq!(fs::read_to_string(d.join("n.md")).unwrap(), src);
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
    fn patch_rejects_ops_missing_their_fields() {
        let d = tmp_vault("patch-guard");
        fs::write(d.join("n.md"), "keep this line\nand this\n").unwrap();
        let s = MemoryStore::new(&d);
        let bad = [
            serde_json::json!({"op": "replace", "find": "keep this line"}),
            serde_json::json!({"op": "replace", "find": "", "with": "x"}),
            serde_json::json!({"op": "replace", "find": "absent", "with": "x"}),
            serde_json::json!({"op": "append"}),
            serde_json::json!({"op": "add_tag"}),
            serde_json::json!({"op": "set_field", "value": "v"}),
        ];
        for op in bad {
            assert!(
                s.patch_memory_impl("n.md", std::slice::from_ref(&op))
                    .is_err(),
                "{op}"
            );
        }
        // A later bad op leaves the note untouched: ops apply all or none.
        let mixed = [
            serde_json::json!({"op": "append", "text": "added"}),
            serde_json::json!({"op": "replace", "find": "keep this line"}),
        ];
        assert!(s.patch_memory_impl("n.md", &mixed).is_err());
        assert_eq!(
            fs::read_to_string(d.join("n.md")).unwrap(),
            "keep this line\nand this\n"
        );
        // `with` and its alias `replace` both work; "" deletes on purpose.
        s.patch_memory_impl(
            "n.md",
            &[serde_json::json!({"op": "replace", "find": "keep", "with": "kept"})],
        )
        .unwrap();
        s.patch_memory_impl(
            "n.md",
            &[serde_json::json!({"op": "replace", "find": "and this", "replace": ""})],
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(d.join("n.md")).unwrap(),
            "kept this line\n\n"
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn escaped_alias_pipe_is_not_part_of_the_link_target() {
        let d = tmp_vault("escaped-pipe");
        let s = MemoryStore::new(&d);
        assert_eq!(
            s.link_targets("| [[A/B\\|name]] | x |\n[[C|d]] [[E]]"),
            vec!["A/B".to_string(), "C".to_string(), "E".to_string()]
        );
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

    #[test]
    fn search_counts_terms_once_matches_symbols_and_escapes() {
        let d = tmp_vault("srch");
        fs::write(d.join("a.md"), "zebra and a regex .*[( here").unwrap();
        fs::write(d.join("b.md"), "launch 🚀 <script>alert(1)</script> zebra").unwrap();
        let s = MemoryStore::new(&d);
        let q = vec!["zebra"; 200].join(" ");
        let hits = s.search(&q, 10);
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|h| h.score == 1), "{hits:?}");
        assert_eq!(s.search(".*[(", 10)[0].path, "a.md");
        assert_eq!(s.search("🚀", 10)[0].path, "b.md");
        assert!(s.search("zebra", 0).is_empty());
        let snip = &s.search("alert", 10)[0].snippet;
        assert!(
            snip.contains("&lt;script&gt;<b>alert</b>(1)&lt;/script&gt;"),
            "{snip}"
        );
        assert!(!snip.contains("<script"), "{snip}");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn subgraph_keeps_direction_both_ways_and_max_nodes() {
        let d = tmp_vault("sub");
        fs::write(d.join("A.md"), "[[B]]").unwrap();
        fs::write(d.join("B.md"), "[[A]]").unwrap();
        fs::write(d.join("F.md"), "[[A]]").unwrap();
        let s = MemoryStore::new(&d);
        let g = s.get_subgraph_impl("A", 1, 60).unwrap();
        let mut links: Vec<String> = g["links"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| {
                format!(
                    "{}->{}",
                    l["source"].as_str().unwrap(),
                    l["target"].as_str().unwrap()
                )
            })
            .collect();
        links.sort();
        assert_eq!(links, ["A->B", "B->A", "F->A"]);
        let g = s.get_subgraph_impl("A.md", 1, 2).unwrap();
        assert_eq!(g["nodes"].as_array().unwrap().len(), 2);
        assert_eq!(g["truncated"], true);
        let g = s.get_subgraph_impl("A", 1, 0).unwrap();
        assert!(g["nodes"].as_array().unwrap().is_empty());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn link_stats_resolves_like_the_other_graph_tools() {
        let d = tmp_vault("ls");
        fs::write(d.join("Projects/A.md"), "[[B]] [[b]] [[A]] [[Gone]]").unwrap();
        fs::write(d.join("Projects/B.md"), "[[A]]").unwrap();
        let s = MemoryStore::new(&d);
        for p in ["Projects/A.md", "Projects/A", "A"] {
            let v = s.link_stats_impl(p).unwrap();
            assert_eq!(v["outgoing"], 1, "{p}: {v}");
            assert_eq!(v["incoming"], 1, "{p}: {v}");
            assert_eq!(v["unresolved"], serde_json::json!(["Gone"]));
        }
        assert!(s
            .link_stats_impl("Nope.md")
            .unwrap_err()
            .0
            .starts_with("not found"));
        assert!(s.link_stats_impl("").unwrap_err().0.contains("empty"));
        assert!(s.link_stats_impl("/etc/passwd").is_err());
        assert!(s
            .link_stats_impl("Projects")
            .unwrap_err()
            .0
            .contains("folder"));
        assert!(s
            .link_stats_impl("Projects/")
            .unwrap_err()
            .0
            .contains("folder"));
        assert!(s.link_stats_impl("../x").unwrap_err().0.contains("escapes"));
        let e = s.find_path_impl("Nope", "A").unwrap_err().0;
        assert_eq!(e, "source not found: Nope");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn folder_filters_match_nested_folders() {
        let d = tmp_vault("qf");
        fs::create_dir_all(d.join("Projects/Atlas/Deep")).unwrap();
        fs::write(
            d.join("Projects/Atlas/Deep/x.md"),
            "---\ntags: [Big]\n---\n",
        )
        .unwrap();
        fs::write(d.join("Projects/y.md"), "y").unwrap();
        fs::write(d.join("top.md"), "t").unwrap();
        let s = MemoryStore::new(&d);
        let q = |f: &str| {
            s.query_memory_impl(Some(f), None, None, None, None, 50)
                .len()
        };
        assert_eq!(q("Projects/Atlas"), 1);
        assert_eq!(q("Projects/"), 2);
        assert_eq!(q("Projects/At"), 0, "prefix of a name is not a folder");
        assert_eq!(q("Root"), 1);
        assert_eq!(
            s.query_memory_impl(None, Some("#big"), None, None, None, 50)
                .len(),
            1
        );
        fs::write(
            d.join(".events.jsonl"),
            "{\"type\":\"node_updated\",\"actor\":\"a\",\"_ts\":1,\"node\":{\"id\":\"x\",\"path\":\"Projects/Atlas/Deep/x.md\"}}\n\
             {\"type\":\"node_updated\",\"actor\":\"a\",\"_ts\":2,\"node\":{\"id\":\"y\",\"path\":\"Projects/y.md\"}}\n",
        )
        .unwrap();
        let dg = s.digest_impl(Some("Projects/Atlas"), None, 50);
        assert_eq!(dg["events"], 1, "{dg}");
        let dg = s.digest_impl(Some("Projects"), None, 1);
        assert_eq!(dg["events"], 2, "{dg}");
        assert_eq!(dg["truncated"], true);
        fs::remove_dir_all(&d).ok();
    }
}
