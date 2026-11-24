//! Kanban boards in the format of the Obsidian Kanban plugin.
//!
//! A note whose frontmatter has a `kanban-plugin` key is a board: every `## Heading` is a
//! lane, every list item under it (`- [ ] text`, `- [x] text`) a card, a `## Archive`
//! heading after a thematic break (`***`) holds the archived cards, and the
//! `%% kanban:settings` block at the end keeps the plugin's settings.
//!
//! The parser keeps every byte: lanes and cards hold their raw lines and anything it does
//! not understand stays where it was, so rendering a parsed board gives back the exact
//! input. An edit rewrites only the lines it touches, so a board saved by Memora still
//! opens the same way in Obsidian.

use super::*;
use crate::md5_hex;

#[path = "kanban_card.rs"]
pub mod card;
use card::{add_block_id, block_id, clean_color, strip_block_id, CardCodec};
pub use card::{CardEdit, CheckItem};

/// The frontmatter key that makes a note a board.
pub const BOARD_KEY: &str = "kanban-plugin";

/// Targets of `![[...]]` embeds in `text` (outside code is not checked: a board in a code span is
/// rare and harmless here).
fn embed_targets(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("![[") {
        let after = &rest[i + 3..];
        let Some(j) = after.find("]]") else { break };
        let inner = &after[..j];
        if !inner.contains('\n') {
            out.push(inner.to_string());
        }
        rest = &after[j + 2..];
    }
    out
}
/// Longest card text accepted from a caller (characters).
pub const MAX_CARD: usize = 10_000;
/// Longest lane title accepted from a caller (characters).
pub const MAX_LANE: usize = 200;

/// One piece of a lane: a card (its raw lines) or a line the board keeps as written.
#[derive(Debug, Clone, PartialEq)]
enum Seg {
    Card(String),
    Line(String),
}

impl Seg {
    fn raw(&self) -> &str {
        match self {
            Seg::Card(s) | Seg::Line(s) => s,
        }
    }
}

/// A `## Heading` and what follows it up to the next lane, the archive, or the settings.
#[derive(Debug, Clone, PartialEq)]
struct Lane {
    /// The heading line; for the archive, the thematic break and blank lines before it too.
    head: String,
    /// Whether this is the archive (`## Archive` right after a thematic break).
    archive: bool,
    segs: Vec<Seg>,
}

/// A parsed board. `render()` of a board parsed from `s` is `s`, byte for byte.
#[derive(Debug, Clone, PartialEq)]
pub struct Board {
    /// Frontmatter and anything before the first lane.
    head: String,
    lanes: Vec<Lane>,
    /// The settings block and everything after it.
    tail: String,
    /// Line ending used for lines the board adds (`\r\n` when the note uses it).
    nl: &'static str,
}

/// A lane named by a caller: its 0-based position among the lanes (the archive not
/// counted), or its title.
#[derive(Debug, Clone, PartialEq)]
pub enum LaneRef {
    Index(usize),
    Title(String),
}

impl LaneRef {
    /// A JSON lane argument: a whole number is a position, a string a title (or, when no
    /// lane has that title, a position written as digits).
    pub fn from_json(v: &Value) -> Option<LaneRef> {
        match v {
            Value::Number(n) => n.as_u64().map(|n| LaneRef::Index(n as usize)),
            Value::String(s) if !s.trim().is_empty() => Some(LaneRef::Title(s.trim().to_string())),
            _ => None,
        }
    }
}

/// One change to a board.
#[derive(Debug, Clone, PartialEq)]
pub enum Op {
    /// Add a card to a lane at `position` (0 = top; `None` = bottom).
    AddCard {
        lane: LaneRef,
        text: String,
        position: Option<usize>,
        checked: bool,
        /// Structured fields on top of `text` (links, tags, date, time, checklist, color).
        edit: Option<Box<CardEdit>>,
    },
    /// Move a card to a lane (the same one to reorder) at `position` (`None` = bottom).
    MoveCard {
        card: String,
        lane: LaneRef,
        position: Option<usize>,
    },
    /// Change a card's text and / or whether it is done.
    UpdateCard {
        card: String,
        text: Option<String>,
        checked: Option<bool>,
    },
    /// Move a card to the archive.
    ArchiveCard { card: String },
    /// Bring an archived card back into a lane (`None` = the first lane), at the bottom.
    RestoreCard { card: String, lane: Option<LaneRef> },
    /// Remove a card from the board for good.
    DeleteCard { card: String },
    /// Add an empty lane at `position` (`None` = after the last lane).
    AddLane {
        title: String,
        position: Option<usize>,
    },
    /// Rename a lane (a WIP limit written as ` (3)` after the title is kept).
    RenameLane { lane: LaneRef, title: String },
    /// Move a lane to `position` among the lanes.
    MoveLane { lane: LaneRef, position: usize },
    /// Remove a lane that holds no cards and no other text.
    DeleteLane { lane: LaneRef },
    /// Change a card through its fields: free text, links, tags, date, time, checklist,
    /// color, checked (see [`CardEdit`]).
    EditCard { card: String, edit: Box<CardEdit> },
    /// Copy a card just below itself.
    DuplicateCard { card: String },
    /// Set (or with `None` clear) a card's color; the card gets a block id when it has none.
    SetCardColor { card: String, color: Option<String> },
    /// Copy a lane with its cards right after it, named `title` (default: the same name).
    DuplicateLane {
        lane: LaneRef,
        title: Option<String>,
    },
    /// Archive every card of a lane, in order.
    ArchiveLaneCards { lane: LaneRef },
    /// Delete every card of a lane.
    ClearLane { lane: LaneRef },
    /// Set (or with `None` clear) a lane's color.
    SetLaneColor {
        lane: LaneRef,
        color: Option<String>,
    },
    /// Set a lane's WIP limit (the ` (N)` after its title); 0 removes it.
    SetLaneLimit { lane: LaneRef, max: u64 },
    /// The board's color and icon: `None` leaves one as it is, `Some(None)` clears it.
    SetBoardStyle {
        color: Option<Option<String>>,
        icon: Option<Option<String>>,
    },
    /// A tag's color in Obsidian Kanban's `tag-colors` (`None` removes the tag's entry);
    /// `background`: `None` keeps the one it had, `Some(None)` clears it.
    SetTagColor {
        tag: String,
        color: Option<String>,
        background: Option<Option<String>>,
    },
    /// Set (or with `None` remove) Obsidian Kanban settings, from [`SETTING_KEYS`].
    SetSettings {
        settings: Vec<(String, Option<Value>)>,
    },
}

/// The Obsidian Kanban settings `set_settings` may change, with the JSON type each takes.
pub const SETTING_KEYS: &[(&str, &str)] = &[
    ("date-colors", "array"),
    ("tag-colors", "array"),
    ("lane-width", "number"),
    ("date-format", "string"),
    ("time-format", "string"),
    ("date-trigger", "string"),
    ("time-trigger", "string"),
    ("date-display-format", "string"),
    ("date-time-display-format", "string"),
    ("show-checkboxes", "boolean"),
    ("hide-tags-in-title", "boolean"),
    ("hide-tags-display", "boolean"),
    ("hide-date-in-title", "boolean"),
    ("hide-date-display", "boolean"),
    ("hide-card-count", "boolean"),
    ("show-relative-date", "boolean"),
    ("link-date-to-daily-note", "boolean"),
    ("new-card-insertion-method", "string"),
    ("new-line-trigger", "string"),
    ("archive-with-date", "boolean"),
    ("append-archive-date", "boolean"),
    ("archive-date-format", "string"),
    ("archive-date-separator", "string"),
    ("max-archive-size", "number"),
    ("show-archive-all", "boolean"),
    ("show-view-as-markdown", "boolean"),
    ("show-board-settings", "boolean"),
    ("show-search", "boolean"),
    ("show-set-view", "boolean"),
    ("full-list-lane-width", "boolean"),
    ("list-collapse", "array"),
    ("move-dates", "boolean"),
    ("move-tags", "boolean"),
    ("move-task-metadata", "boolean"),
    ("inline-metadata-position", "string"),
    ("tag-sort", "array"),
    ("tag-action", "string"),
    ("metadata-keys", "array"),
];

impl Op {
    /// An edit as the web board sends it: `{type, ...}` with `type` one of `add_card`
    /// (optionally with the fields of `edit_card`), `move_card`, `update_card`,
    /// `archive_card`, `restore_card`, `delete_card`, `add_lane`, `rename_lane`,
    /// `move_lane`, `delete_lane`, `edit_card` `{card, text?, links?, tags?, date?, time?,
    /// checklist?, color?, checked?}`, `duplicate_card {card}`, `set_card_color {card,
    /// color}`, `duplicate_lane {lane, title?}`, `archive_lane_cards {lane}`, `clear_lane
    /// {lane}`, `set_lane_color {lane, color}`, `set_lane_limit {lane, max}`,
    /// `set_board_style {color?, icon?}`, `set_tag_color {tag, color, background?}`,
    /// `set_settings {settings}`.
    pub fn from_json(v: &Value) -> MResult<Op> {
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
        let color = |k: &str| match v.get(k) {
            None => err(format!("{k} is required: a color, or null to clear it")),
            Some(c) => clean_color(c),
        };
        let maybe = |k: &str, f: &dyn Fn(&Value) -> MResult<Option<String>>| match v.get(k) {
            None => Ok(None),
            Some(x) => f(x).map(Some),
        };
        let pos = |k: &str| v.get(k).and_then(|x| x.as_u64()).map(|n| n as usize);
        let lane = |k: &str| {
            v.get(k)
                .and_then(LaneRef::from_json)
                .ok_or_else(|| MemoryErr(format!("{k} is required: a lane title or position")))
        };
        let card = || {
            let c = s("card");
            if c.trim().is_empty() {
                err("card is required")
            } else {
                Ok(c)
            }
        };
        Ok(match v.get("type").and_then(|x| x.as_str()).unwrap_or("") {
            "add_card" => Op::AddCard {
                lane: lane("lane")?,
                text: s("text"),
                position: pos("position"),
                checked: v.get("checked").and_then(|x| x.as_bool()).unwrap_or(false),
                edit: Some(CardEdit::from_json(v, false)?)
                    .filter(|e| !e.is_empty())
                    .map(Box::new),
            },
            "move_card" => Op::MoveCard {
                card: card()?,
                lane: lane("lane")?,
                position: pos("position"),
            },
            "update_card" => Op::UpdateCard {
                card: card()?,
                text: v.get("text").and_then(|x| x.as_str()).map(str::to_string),
                checked: v.get("checked").and_then(|x| x.as_bool()),
            },
            "archive_card" => Op::ArchiveCard { card: card()? },
            "restore_card" => Op::RestoreCard {
                card: card()?,
                lane: v.get("lane").and_then(LaneRef::from_json),
            },
            "delete_card" => Op::DeleteCard { card: card()? },
            "add_lane" => Op::AddLane {
                title: s("title"),
                position: pos("position"),
            },
            "rename_lane" => Op::RenameLane {
                lane: lane("lane")?,
                title: s("title"),
            },
            "move_lane" => Op::MoveLane {
                lane: lane("lane")?,
                position: pos("position")
                    .ok_or_else(|| MemoryErr("position is required".into()))?,
            },
            "delete_lane" => Op::DeleteLane {
                lane: lane("lane")?,
            },
            "edit_card" => Op::EditCard {
                card: card()?,
                edit: Box::new(CardEdit::from_json(v, true)?),
            },
            "duplicate_card" => Op::DuplicateCard { card: card()? },
            "set_card_color" => Op::SetCardColor {
                card: card()?,
                color: color("color")?,
            },
            "duplicate_lane" => Op::DuplicateLane {
                lane: lane("lane")?,
                title: v
                    .get("title")
                    .and_then(|x| x.as_str())
                    .filter(|t| !t.trim().is_empty())
                    .map(str::to_string),
            },
            "archive_lane_cards" => Op::ArchiveLaneCards {
                lane: lane("lane")?,
            },
            "clear_lane" => Op::ClearLane {
                lane: lane("lane")?,
            },
            "set_lane_color" => Op::SetLaneColor {
                lane: lane("lane")?,
                color: color("color")?,
            },
            "set_lane_limit" => Op::SetLaneLimit {
                lane: lane("lane")?,
                max: v.get("max").and_then(|x| x.as_u64()).ok_or_else(|| {
                    MemoryErr("max is required: a whole number, 0 for no limit".into())
                })?,
            },
            "set_board_style" => {
                let op = Op::SetBoardStyle {
                    color: maybe("color", &clean_color)?,
                    icon: maybe("icon", &clean_icon)?,
                };
                if op
                    == (Op::SetBoardStyle {
                        color: None,
                        icon: None,
                    })
                {
                    return err("nothing to change: give color and / or icon");
                }
                op
            }
            "set_tag_color" => Op::SetTagColor {
                tag: s("tag"),
                color: color("color")?,
                background: maybe("background", &clean_color)?,
            },
            "set_settings" => {
                let Some(m) = v.get("settings").and_then(|x| x.as_object()) else {
                    return err("settings is required: an object of setting keys and values (null removes one)");
                };
                Op::SetSettings {
                    settings: m
                        .iter()
                        .map(|(k, x)| (k.clone(), (!x.is_null()).then(|| x.clone())))
                        .collect(),
                }
            }
            other => return err(format!("unknown board edit: {other:?}")),
        })
    }
}

/// What an edit did: the card it made or changed (its id after the edit), if any.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Applied {
    pub card: Option<String>,
    /// A short English summary, used as the commit message.
    pub summary: String,
}

/// Whether `content` is a Kanban board: its frontmatter has a `kanban-plugin` key.
pub fn is_board(content: &str) -> bool {
    let mut lines = content.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return false;
    }
    for line in lines {
        let t = line.trim_end();
        if t == "---" {
            return false;
        }
        if let Some((k, _)) = line.split_once(':') {
            if !line.starts_with([' ', '\t']) && k.trim() == BOARD_KEY {
                return true;
            }
        }
    }
    false
}

/// A short fingerprint of a note's content: `version` of a board.
pub fn version_of(content: &str) -> String {
    format!("{:032x}", md5_hex(content.as_bytes()))[..12].to_string()
}

fn is_blank(line: &str) -> bool {
    line.trim().is_empty()
}

/// `## Title` (exactly level 2), with the title.
fn lane_heading(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("##")?;
    if !(rest.starts_with(' ') || rest.starts_with('\t') || rest.trim().is_empty()) {
        return None;
    }
    let t = rest.trim();
    // A closing sequence of #s is not part of the title.
    let t = t.trim_end_matches('#').trim_end();
    Some(t)
}

/// A thematic break: three or more of the same `*`, `-` or `_`, spaces allowed.
fn thematic_break(line: &str) -> bool {
    let t = line.trim();
    if line.starts_with("    ") || line.starts_with('\t') {
        return false;
    }
    let Some(c) = t.chars().next() else {
        return false;
    };
    matches!(c, '*' | '-' | '_')
        && t.chars().all(|x| x == c || x == ' ' || x == '\t')
        && t.chars().filter(|x| *x == c).count() >= 3
}

/// A fence line (```` ``` ```` or `~~~`), as the marker that closes it.
fn fence(line: &str) -> Option<&'static str> {
    let t = line.trim_start();
    if line.len() - t.len() > 3 {
        return None;
    }
    if t.starts_with("```") {
        Some("```")
    } else if t.starts_with("~~~") {
        Some("~~~")
    } else {
        None
    }
}

/// A list item at the left margin (`- `, `* `, `+ `, or the bare marker).
fn list_item(line: &str) -> bool {
    let t = line.trim_end_matches(['\r', '\n']);
    if thematic_break(t) {
        return false;
    }
    matches!(
        t.as_bytes(),
        [b'-' | b'*' | b'+'] | [b'-' | b'*' | b'+', b' ' | b'\t', ..]
    )
}

fn indented(line: &str) -> bool {
    line.starts_with([' ', '\t'])
}

fn settings_start(line: &str) -> bool {
    line.trim_start().starts_with("%% kanban:settings")
}

/// The bold-only line (`**Complete**`, translated by the plugin) that marks a lane whose
/// cards are done once they land in it.
fn complete_marker(line: &str) -> bool {
    let t = line.trim();
    t.len() > 4
        && t.starts_with("**")
        && t.ends_with("**")
        && !t[2..t.len() - 2].contains('*')
        && !t[2..t.len() - 2].trim().is_empty()
}

/// Whether a line after a card, not indented, still belongs to it (a lazy continuation).
fn lazy_continuation(line: &str) -> bool {
    !is_blank(line)
        && !list_item(line)
        && !line.starts_with('#')
        && !thematic_break(line)
        && fence(line).is_none()
        && !settings_start(line)
        && !line.trim_start().starts_with("%%")
}

fn ends_nl(s: &str) -> bool {
    s.ends_with('\n')
}

impl Board {
    /// Parse a board. Never fails: text that is not a lane or a card is kept as it is.
    pub fn parse(content: &str) -> Board {
        let nl = if content.contains("\r\n") {
            "\r\n"
        } else {
            "\n"
        };
        let lines: Vec<&str> = content.split_inclusive('\n').collect();
        let mut i = 0;
        let mut head = String::new();
        // Frontmatter: everything up to and including the closing `---`.
        if lines.first().map(|l| l.trim_end()) == Some("---") {
            if let Some(end) = lines.iter().skip(1).position(|l| l.trim_end() == "---") {
                for l in &lines[..end + 2] {
                    head.push_str(l);
                }
                i = end + 2;
            }
        }
        let mut pre: Vec<String> = Vec::new();
        let mut lanes: Vec<Lane> = Vec::new();
        let mut tail = String::new();
        let mut in_fence: Option<&'static str> = None;
        while i < lines.len() {
            let line = lines[i];
            if let Some(close) = in_fence {
                if fence(line) == Some(close) && line.trim() == close {
                    in_fence = None;
                }
                push_line(&mut lanes, &mut pre, line);
                i += 1;
                continue;
            }
            if settings_start(line) {
                for l in &lines[i..] {
                    tail.push_str(l);
                }
                break;
            }
            if let Some(f) = fence(line) {
                in_fence = Some(f);
                push_line(&mut lanes, &mut pre, line);
                i += 1;
                continue;
            }
            if let Some(title) = lane_heading(line) {
                // `## Archive` (any title: the plugin translates it) right after a
                // thematic break is the archive; the break and the blank lines after it
                // move into the archive's head.
                let segs_before: Vec<String> = match lanes.last() {
                    Some(l) => l.segs.iter().map(|s| s.raw().to_string()).collect(),
                    None => pre.clone(),
                };
                let mut k = segs_before.len();
                while k > 0 && is_blank(&segs_before[k - 1]) {
                    k -= 1;
                }
                let archive = !title.is_empty()
                    && k > 0
                    && thematic_break(&segs_before[k - 1])
                    && match lanes.last() {
                        Some(l) => matches!(l.segs[k - 1], Seg::Line(_)),
                        None => true,
                    };
                let mut lane_head = String::new();
                if archive {
                    let take = segs_before.len() - (k - 1);
                    let moved: Vec<String> = match lanes.last_mut() {
                        Some(l) => l
                            .segs
                            .split_off(l.segs.len() - take)
                            .into_iter()
                            .map(|s| s.raw().to_string())
                            .collect(),
                        None => pre.split_off(pre.len() - take),
                    };
                    for m in moved {
                        lane_head.push_str(&m);
                    }
                }
                lane_head.push_str(line);
                lanes.push(Lane {
                    head: lane_head,
                    archive,
                    segs: Vec::new(),
                });
                i += 1;
                continue;
            }
            let Some(lane) = lanes.last_mut() else {
                pre.push(line.to_string());
                i += 1;
                continue;
            };
            if list_item(line) {
                let mut raw = line.to_string();
                let mut j = i + 1;
                while j < lines.len() {
                    let next = lines[j];
                    if indented(next) && !is_blank(next) {
                        raw.push_str(next);
                        j += 1;
                    } else if is_blank(next) {
                        // Blank lines belong to the card only when indented text follows.
                        let mut k = j;
                        while k < lines.len() && is_blank(lines[k]) {
                            k += 1;
                        }
                        if k < lines.len() && indented(lines[k]) && !is_blank(lines[k]) {
                            for l in &lines[j..k] {
                                raw.push_str(l);
                            }
                            j = k;
                        } else {
                            break;
                        }
                    } else if lazy_continuation(next) && fence(next).is_none() {
                        raw.push_str(next);
                        j += 1;
                    } else {
                        break;
                    }
                }
                lane.segs.push(Seg::Card(raw));
                i = j;
                continue;
            }
            lane.segs.push(Seg::Line(line.to_string()));
            i += 1;
        }
        let mut head_all = head;
        for p in pre {
            head_all.push_str(&p);
        }
        Board {
            head: head_all,
            lanes,
            tail,
            nl,
        }
    }

    /// The board as markdown.
    pub fn render(&self) -> String {
        let mut out = self.head.clone();
        for l in &self.lanes {
            out.push_str(&l.head);
            for s in &l.segs {
                out.push_str(s.raw());
            }
        }
        out.push_str(&self.tail);
        out
    }

    /// Positions in `lanes` of the lanes people see (the archive not counted).
    fn regular(&self) -> Vec<usize> {
        (0..self.lanes.len())
            .filter(|i| !self.lanes[*i].archive)
            .collect()
    }

    fn archive_index(&self) -> Option<usize> {
        self.lanes.iter().position(|l| l.archive)
    }

    fn lane_at(&self, r: &LaneRef) -> MResult<usize> {
        let reg = self.regular();
        let titles: Vec<String> = reg.iter().map(|i| self.lanes[*i].title()).collect();
        let found = match r {
            LaneRef::Index(n) => reg.get(*n).copied(),
            LaneRef::Title(t) => titles
                .iter()
                .position(|x| x == t)
                .or_else(|| {
                    let tl = t.to_lowercase();
                    titles.iter().position(|x| x.to_lowercase() == tl)
                })
                .or_else(|| t.parse::<usize>().ok().filter(|n| *n < reg.len()))
                .map(|p| reg[p]),
        };
        found.ok_or_else(|| {
            let list = if titles.is_empty() {
                "the board has no lanes yet".to_string()
            } else {
                format!(
                    "lanes: {}",
                    titles
                        .iter()
                        .map(|t| format!("{t:?}"))
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            };
            match r {
                LaneRef::Index(n) => MemoryErr(format!("no lane at position {n} ({list})")),
                LaneRef::Title(t) => MemoryErr(format!("no lane named {t:?} ({list})")),
            }
        })
    }

    /// Every card as `(lane, seg, id)`, in board order (lanes, then the archive where it is).
    fn card_ids(&self) -> Vec<(usize, usize, String)> {
        let mut seen: HashMap<String, usize> = HashMap::new();
        let mut out = Vec::new();
        for (li, lane) in self.lanes.iter().enumerate() {
            for (si, s) in lane.segs.iter().enumerate() {
                if let Seg::Card(raw) = s {
                    let text = card_text(raw);
                    let n = seen.entry(text.clone()).or_insert(0);
                    let key = if *n == 0 {
                        text
                    } else {
                        format!("{text}\u{0}{n}")
                    };
                    *n += 1;
                    out.push((li, si, card_id(&key)));
                }
            }
        }
        out
    }

    fn find_card(&self, id: &str) -> MResult<(usize, usize)> {
        let id = id.trim().trim_start_matches('#');
        if id.is_empty() {
            return err("card is required: a card id from kanban_get_board");
        }
        self.card_ids()
            .into_iter()
            .find(|(_, _, c)| c == id)
            .map(|(l, s, _)| (l, s))
            .ok_or_else(|| {
                MemoryErr(format!(
                    "no card with id {id:?} on this board (ids change when a card's text changes; read the board again)"
                ))
            })
    }

    fn id_at(&self, lane: usize, seg: usize) -> Option<String> {
        self.card_ids()
            .into_iter()
            .find(|(l, s, _)| *l == lane && *s == seg)
            .map(|(_, _, id)| id)
    }

    /// Where a card goes in `lane` at card `position` (`None` = after the last card).
    fn slot(&self, lane: usize, position: Option<usize>) -> usize {
        let l = &self.lanes[lane];
        let cards: Vec<usize> = (0..l.segs.len())
            .filter(|i| matches!(l.segs[*i], Seg::Card(_)))
            .collect();
        if let Some(&at) = position.and_then(|p| cards.get(p)) {
            return at;
        }
        if let Some(&last) = cards.last() {
            return last + 1;
        }
        // An empty lane: after its "Complete" marker, else after the blank line under
        // the heading.
        if let Some(j) = l.segs.iter().position(|s| !is_blank(s.raw())) {
            if complete_marker(l.segs[j].raw()) {
                return j + 1;
            }
        }
        usize::from(l.segs.first().is_some_and(|s| is_blank(s.raw())))
    }

    fn insert_card(&mut self, lane: usize, position: Option<usize>, raw: String) -> usize {
        let at = self.slot(lane, position);
        let nl = self.nl;
        let l = &mut self.lanes[lane];
        if at == 0 {
            if !ends_nl(&l.head) {
                l.head.push_str(nl);
            }
        } else if let Some(prev) = l.segs.get_mut(at - 1) {
            match prev {
                Seg::Card(s) | Seg::Line(s) => {
                    if !ends_nl(s) {
                        s.push_str(nl);
                    }
                }
            }
        }
        // Text right under the card would read as part of it: keep a blank line between.
        if let Some(Seg::Line(next)) = l.segs.get(at) {
            if !is_blank(next) && lazy_continuation(next) {
                l.segs.insert(at, Seg::Line(nl.to_string()));
            }
        }
        l.segs.insert(at, Seg::Card(raw));
        at
    }

    /// Whether a lane marks the cards that land in it as done (its "Complete" marker).
    fn completes(&self, lane: usize) -> bool {
        let l = &self.lanes[lane];
        for s in &l.segs {
            match s {
                Seg::Card(_) => return false,
                Seg::Line(x) if is_blank(x) => continue,
                Seg::Line(x) => return complete_marker(x),
            }
        }
        false
    }

    /// Make sure the text before lane position `at` ends a line and a blank line follows
    /// it, so a lane inserted there starts on its own.
    fn open_gap_before(&mut self, at: usize) {
        let nl = self.nl;
        let prev: &mut String = if at == 0 {
            &mut self.head
        } else {
            let l = &mut self.lanes[at - 1];
            match l.segs.last_mut() {
                Some(Seg::Card(s) | Seg::Line(s)) => s,
                None => &mut l.head,
            }
        };
        if prev.is_empty() {
            return;
        }
        let blank_end = prev.trim_end_matches(['\r', '\n']).is_empty();
        if !ends_nl(prev) {
            prev.push_str(nl);
        }
        if at > 0 && !blank_end {
            self.lanes[at - 1].segs.push(Seg::Line(nl.to_string()));
        }
    }

    fn ensure_lane_ends(&mut self, lane: usize) {
        let nl = self.nl;
        let l = &mut self.lanes[lane];
        match l.segs.last_mut() {
            Some(Seg::Card(s) | Seg::Line(s)) => {
                if !ends_nl(s) {
                    s.push_str(nl);
                }
            }
            None => {
                if !ends_nl(&l.head) {
                    l.head.push_str(nl);
                }
            }
        }
        if !l.segs.last().is_some_and(|s| is_blank(s.raw())) {
            l.segs.push(Seg::Line(nl.to_string()));
        }
    }

    fn new_card_raw(&self, text: &str, checked: bool) -> String {
        format!(
            "- [{}] {}{}",
            if checked { 'x' } else { ' ' },
            indent_lines(text, "\t", self.nl),
            self.nl
        )
    }

    /// Move the card at `(li, si)` to the bottom of the archive (made when the board has
    /// none); returns where it landed.
    fn archive_at(&mut self, li: usize, si: usize) -> MResult<(usize, usize)> {
        let nl = self.nl;
        let Seg::Card(mut raw) = self.lanes[li].segs.remove(si) else {
            return err("not a card");
        };
        if !ends_nl(&raw) {
            raw.push_str(nl);
        }
        let ai = match self.archive_index() {
            Some(a) => a,
            None => {
                let at = self
                    .regular()
                    .last()
                    .map(|i| i + 1)
                    .unwrap_or(self.lanes.len());
                self.open_gap_before(at);
                self.lanes.insert(
                    at,
                    Lane {
                        head: format!("***{nl}{nl}## Archive{nl}"),
                        archive: true,
                        segs: vec![Seg::Line(nl.to_string())],
                    },
                );
                // Keep the settings block apart from the archived cards.
                if !self.tail.is_empty() || at + 1 < self.lanes.len() {
                    self.lanes[at].segs.push(Seg::Line(nl.to_string()));
                    self.lanes[at].segs.push(Seg::Line(nl.to_string()));
                }
                at
            }
        };
        let at = self.insert_card(ai, None, raw);
        Ok((ai, at))
    }

    /// Apply a structured edit to the card at `(li, si)`.
    fn edit_card_at(&mut self, li: usize, si: usize, e: &CardEdit) -> MResult<()> {
        let codec = CardCodec::new(&self.settings());
        let Seg::Card(raw) = &self.lanes[li].segs[si] else {
            return err("not a card");
        };
        let mut new = card::edit_raw(raw, e, &codec, self.nl)?;
        if let Some(c) = e.checked {
            new = set_checked(&new, c);
        }
        if card_text(&new).trim().is_empty() {
            return err("text is empty: a card needs some text");
        }
        if card_text(&new).chars().count() > MAX_CARD {
            return err(format!("text is too long: at most {MAX_CARD} characters"));
        }
        self.lanes[li].segs[si] = Seg::Card(new);
        if let Some(color) = &e.color {
            self.set_card_color_at(li, si, color.clone())?;
        }
        Ok(())
    }

    /// Our own settings (`memora` in the settings JSON): board style, lane and card colors.
    fn memora(&self) -> Map<String, Value> {
        self.settings()
            .get("memora")
            .and_then(|m| m.as_object())
            .cloned()
            .unwrap_or_default()
    }

    fn card_color(&self, block: &str) -> Option<String> {
        self.memora()
            .get("cards")?
            .get(block)?
            .as_str()
            .map(str::to_string)
    }

    fn lane_color(&self, title: &str) -> Option<String> {
        self.memora()
            .get("lanes")?
            .get(title)?
            .as_str()
            .map(str::to_string)
    }

    /// Forget the colors of cards that left the board (when no other card has their block id).
    fn drop_card_colors(&mut self, gone: &[Seg]) -> MResult<()> {
        let blocks: Vec<String> = gone
            .iter()
            .filter_map(|s| match s {
                Seg::Card(raw) => block_id(raw),
                Seg::Line(_) => None,
            })
            .filter(|b| self.card_color(b).is_some())
            .collect();
        if blocks.is_empty() {
            return Ok(());
        }
        let still: HashSet<String> = self.block_ids();
        self.memora_edit(|m| {
            for b in &blocks {
                if !still.contains(b) {
                    set_in(m, "cards", b, None);
                }
            }
        })
    }

    fn block_ids(&self) -> HashSet<String> {
        self.lanes
            .iter()
            .flat_map(|l| l.segs.iter())
            .filter_map(|s| match s {
                Seg::Card(raw) => block_id(raw),
                Seg::Line(_) => None,
            })
            .collect()
    }

    /// A new block id: 6 lowercase base-36 characters from `seed` (a card id), not yet used
    /// on the board.
    fn new_block_id(&self, seed: &str) -> String {
        let used = self.block_ids();
        for n in 0u32.. {
            let key = if n == 0 {
                seed.to_string()
            } else {
                format!("{seed}\u{0}{n}")
            };
            let mut x = md5_hex(key.as_bytes()) % 36u128.pow(6);
            let mut id = [b'0'; 6];
            for c in id.iter_mut().rev() {
                *c = b"0123456789abcdefghijklmnopqrstuvwxyz"[(x % 36) as usize];
                x /= 36;
            }
            let id = String::from_utf8_lossy(&id).to_string();
            if !used.contains(&id) {
                return id;
            }
        }
        unreachable!("block ids run out")
    }

    /// Set or clear the color of the card at `(li, si)`.
    fn set_card_color_at(&mut self, li: usize, si: usize, color: Option<String>) -> MResult<()> {
        let Seg::Card(raw) = &self.lanes[li].segs[si] else {
            return err("not a card");
        };
        let raw = raw.clone();
        match color {
            Some(c) => {
                let id = match block_id(&raw) {
                    Some(b) => b,
                    None => {
                        let seed = self.id_at(li, si).unwrap_or_default();
                        let b = self.new_block_id(&seed);
                        self.lanes[li].segs[si] = Seg::Card(add_block_id(&raw, &b));
                        b
                    }
                };
                self.memora_edit(|m| set_in(m, "cards", &id, Some(json!(c))))
            }
            None => match block_id(&raw) {
                Some(b) => self.memora_edit(|m| set_in(m, "cards", &b, None)),
                None => Ok(()),
            },
        }
    }

    /// Rewrite a lane's heading as `## title`, with the WIP limit `max` (0 = none; `None`
    /// keeps the one it has).
    fn set_heading(&mut self, li: usize, title: &str, max: Option<u64>) {
        let l = &mut self.lanes[li];
        let old = l.head.trim_end_matches(['\r', '\n']);
        let ending = l.head[old.len()..].to_string();
        let limit = match max {
            Some(0) => String::new(),
            Some(n) => format!(" ({n})"),
            None => lane_limit_suffix(old.trim_start_matches('#').trim())
                .map(str::to_string)
                .unwrap_or_default(),
        };
        // The title as written (`<br>` kept) when it is the same one.
        let written = lane_heading(old)
            .map(|t| match lane_limit_suffix(t) {
                Some(sfx) => t[..t.len() - sfx.len()].trim_end().to_string(),
                None => t.to_string(),
            })
            .filter(|t| t.replace("<br>", " ") == title)
            .unwrap_or_else(|| title.to_string());
        l.head = format!("## {written}{limit}{ending}");
    }

    /// Change the settings JSON with `f` (on its text, so keys, their order and values
    /// nobody changed stay as written). A board without a settings block gets one at the
    /// end, as Obsidian Kanban writes it, when `f` changed anything.
    fn settings_edit(&mut self, f: impl FnOnce(&mut String) -> MResult<()>) -> MResult<()> {
        let nl = self.nl;
        if self.tail.is_empty() {
            let start = format!("{{\"{BOARD_KEY}\":{}}}", json!(self.plugin_value()));
            let mut obj = start.clone();
            f(&mut obj)?;
            if obj == start {
                return Ok(());
            }
            let body = self.render();
            let gap = if body.is_empty() || body.ends_with("\n\n") || body.ends_with("\r\n\r\n") {
                String::new()
            } else if body.ends_with('\n') {
                nl.to_string()
            } else {
                format!("{nl}{nl}")
            };
            self.tail = format!("{gap}%% kanban:settings{nl}```{nl}{obj}{nl}```{nl}%%");
            return Ok(());
        }
        let Some(start) = self.tail.find('{') else {
            return err("the board's settings block holds no settings: fix it in the note first");
        };
        let end = json_text::value_end(&self.tail, start)
            .filter(|end| {
                serde_json::from_str::<Map<String, Value>>(&self.tail[start..*end]).is_ok()
            })
            .ok_or_else(|| {
                MemoryErr(
                    "the board's settings are not valid JSON: fix them in the note first".into(),
                )
            })?;
        let mut obj = self.tail[start..end].to_string();
        f(&mut obj)?;
        if serde_json::from_str::<Map<String, Value>>(&obj).is_err() {
            return err("the settings could not be changed");
        }
        self.tail.replace_range(start..end, &obj);
        Ok(())
    }

    /// Change our `memora` settings with `f`; nothing is written when nothing changed.
    fn memora_edit(&mut self, f: impl FnOnce(&mut Map<String, Value>)) -> MResult<()> {
        let before = self.memora();
        let mut m = before.clone();
        f(&mut m);
        if m == before {
            return Ok(());
        }
        let raw = (!m.is_empty()).then(|| Value::Object(m).to_string());
        self.settings_edit(|obj| obj_set(obj, "memora", raw.as_deref()))
    }

    /// The frontmatter's `kanban-plugin` value (`basic` when unreadable).
    fn plugin_value(&self) -> String {
        for line in self.head.lines().skip(1) {
            if line.trim_end() == "---" {
                break;
            }
            if let Some((k, v)) = line.split_once(':') {
                if k.trim() == BOARD_KEY && !v.trim().is_empty() {
                    return v.trim().trim_matches(['"', '\'']).to_string();
                }
            }
        }
        "basic".into()
    }

    /// Apply one change. Errors leave the board as it was.
    pub fn apply(&mut self, op: &Op) -> MResult<Applied> {
        let before = self.clone();
        let r = self.apply_inner(op);
        if r.is_err() {
            *self = before;
        }
        r
    }

    fn apply_inner(&mut self, op: &Op) -> MResult<Applied> {
        let nl = self.nl;
        match op {
            Op::AddCard {
                lane,
                text,
                position,
                checked,
                edit,
            } => {
                let text = clean_card(text)?;
                let li = self.lane_at(lane)?;
                let checked = *checked || self.completes(li);
                let raw = self.new_card_raw(&text, checked);
                let at = self.insert_card(li, *position, raw);
                if let Some(e) = edit {
                    self.edit_card_at(li, at, e)?;
                }
                Ok(Applied {
                    card: self.id_at(li, at),
                    summary: format!("add card to {}", self.lanes[li].title()),
                })
            }
            Op::MoveCard {
                card,
                lane,
                position,
            } => {
                let (from, si) = self.find_card(card)?;
                let to = self.lane_at(lane)?;
                let Seg::Card(mut raw) = self.lanes[from].segs.remove(si) else {
                    return err("not a card");
                };
                if !ends_nl(&raw) {
                    raw.push_str(nl);
                }
                if from != to {
                    if self.completes(to) {
                        raw = set_checked(&raw, true);
                    } else if self.completes(from) {
                        raw = set_checked(&raw, false);
                    }
                }
                let at = self.insert_card(to, *position, raw);
                Ok(Applied {
                    card: self.id_at(to, at),
                    summary: format!("move card to {}", self.lanes[to].title()),
                })
            }
            Op::UpdateCard {
                card,
                text,
                checked,
            } => {
                if text.is_none() && checked.is_none() {
                    return err("nothing to change: give text and / or checked");
                }
                let (li, si) = self.find_card(card)?;
                let Seg::Card(raw) = &self.lanes[li].segs[si] else {
                    return err("not a card");
                };
                let mut new = raw.clone();
                if let Some(t) = text {
                    let t = clean_card(t)?;
                    new = rewrite_card(&new, &t, nl);
                }
                if let Some(c) = checked {
                    new = set_checked(&new, *c);
                }
                self.lanes[li].segs[si] = Seg::Card(new);
                Ok(Applied {
                    card: self.id_at(li, si),
                    summary: format!("update card in {}", self.lanes[li].title()),
                })
            }
            Op::ArchiveCard { card } => {
                let (li, si) = self.find_card(card)?;
                if self.lanes[li].archive {
                    return err("the card is already archived");
                }
                let (ai, at) = self.archive_at(li, si)?;
                Ok(Applied {
                    card: self.id_at(ai, at),
                    summary: "archive card".into(),
                })
            }
            Op::RestoreCard { card, lane } => {
                let (li, si) = self.find_card(card)?;
                if !self.lanes[li].archive {
                    return err("the card is not archived");
                }
                let to = match lane {
                    Some(r) => self.lane_at(r)?,
                    None => self.lane_at(&LaneRef::Index(0))?,
                };
                let Seg::Card(mut raw) = self.lanes[li].segs.remove(si) else {
                    return err("not a card");
                };
                if !ends_nl(&raw) {
                    raw.push_str(nl);
                }
                let at = self.insert_card(to, None, raw);
                Ok(Applied {
                    card: self.id_at(to, at),
                    summary: format!("restore card to {}", self.lanes[to].title()),
                })
            }
            Op::DeleteCard { card } => {
                let (li, si) = self.find_card(card)?;
                let gone = self.lanes[li].segs.remove(si);
                self.drop_card_colors(&[gone])?;
                Ok(Applied {
                    card: None,
                    summary: format!("delete card from {}", self.lanes[li].title()),
                })
            }
            Op::AddLane { title, position } => {
                let title = clean_lane(title)?;
                let reg = self.regular();
                let at = match position.and_then(|p| reg.get(p).copied()) {
                    Some(i) => i,
                    None => reg
                        .last()
                        .map(|i| i + 1)
                        .or_else(|| self.archive_index())
                        .unwrap_or(self.lanes.len()),
                };
                self.open_gap_before(at);
                let blank = || Seg::Line(nl.to_string());
                self.lanes.insert(
                    at,
                    Lane {
                        head: format!("## {title}{nl}"),
                        archive: false,
                        segs: vec![blank(), blank(), blank()],
                    },
                );
                Ok(Applied {
                    card: None,
                    summary: format!("add lane {title}"),
                })
            }
            Op::RenameLane { lane, title } => {
                let title = clean_lane(title)?;
                let li = self.lane_at(lane)?;
                let l = &mut self.lanes[li];
                let old = l.head.trim_end_matches(['\r', '\n']);
                let ending = &l.head[old.len()..];
                let limit = lane_limit_suffix(old.trim_start_matches('#').trim())
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                let ending = if ending.is_empty() { "" } else { ending }.to_string();
                let old_title = l.title();
                l.head = format!("## {title}{limit}{ending}");
                if old_title != title {
                    if let Some(c) = self.lane_color(&old_title) {
                        self.memora_edit(|m| {
                            set_in(m, "lanes", &old_title, None);
                            set_in(m, "lanes", &title, Some(json!(c)));
                        })?;
                    }
                }
                Ok(Applied {
                    card: None,
                    summary: format!("rename lane to {title}"),
                })
            }
            Op::MoveLane { lane, position } => {
                let li = self.lane_at(lane)?;
                let reg = self.regular();
                let from_pos = reg.iter().position(|i| *i == li).unwrap_or(0);
                if *position == from_pos {
                    return Ok(Applied {
                        card: None,
                        summary: "move lane".into(),
                    });
                }
                self.ensure_lane_ends(li);
                let moving = self.lanes.remove(li);
                let reg = self.regular();
                let at = match reg.get(*position) {
                    Some(&i) => i,
                    None => reg
                        .last()
                        .map(|i| i + 1)
                        .or_else(|| self.archive_index())
                        .unwrap_or(self.lanes.len()),
                };
                self.open_gap_before(at);
                let title = moving.title();
                self.lanes.insert(at, moving);
                Ok(Applied {
                    card: None,
                    summary: format!("move lane {title}"),
                })
            }
            Op::DeleteLane { lane } => {
                let li = self.lane_at(lane)?;
                let l = &self.lanes[li];
                if l.segs.iter().any(|s| match s {
                    Seg::Card(_) => true,
                    Seg::Line(x) => !is_blank(x) && !complete_marker(x),
                }) {
                    return err(
                        "the lane still holds cards or text: move or archive its cards first",
                    );
                }
                let title = l.title();
                self.lanes.remove(li);
                // Another lane with the same name keeps the color.
                if !self
                    .regular()
                    .iter()
                    .any(|i| self.lanes[*i].title() == title)
                {
                    self.memora_edit(|m| set_in(m, "lanes", &title, None))?;
                }
                Ok(Applied {
                    card: None,
                    summary: format!("delete lane {title}"),
                })
            }
            Op::EditCard { card, edit } => {
                if edit.is_empty() {
                    return err("nothing to change: give text, links, tags, date, time, checklist, color or checked");
                }
                let (li, si) = self.find_card(card)?;
                self.edit_card_at(li, si, edit)?;
                Ok(Applied {
                    card: self.id_at(li, si),
                    summary: format!("update card in {}", self.lanes[li].title()),
                })
            }
            Op::DuplicateCard { card } => {
                let (li, si) = self.find_card(card)?;
                let Seg::Card(raw) = &mut self.lanes[li].segs[si] else {
                    return err("not a card");
                };
                if !ends_nl(raw) {
                    raw.push_str(nl);
                }
                let raw = raw.clone();
                let color = block_id(&raw).and_then(|b| self.card_color(&b));
                self.lanes[li]
                    .segs
                    .insert(si + 1, Seg::Card(strip_block_id(&raw)));
                if color.is_some() {
                    self.set_card_color_at(li, si + 1, color)?;
                }
                Ok(Applied {
                    card: self.id_at(li, si + 1),
                    summary: format!("duplicate card in {}", self.lanes[li].title()),
                })
            }
            Op::SetCardColor { card, color } => {
                let (li, si) = self.find_card(card)?;
                self.set_card_color_at(li, si, color.clone())?;
                Ok(Applied {
                    card: self.id_at(li, si),
                    summary: format!("color card in {}", self.lanes[li].title()),
                })
            }
            Op::DuplicateLane { lane, title } => {
                let li = self.lane_at(lane)?;
                let old_title = self.lanes[li].title();
                let new_title = match title {
                    Some(t) => clean_lane(t)?,
                    None => old_title.clone(),
                };
                self.ensure_lane_ends(li);
                let mut copy = self.lanes[li].clone();
                let mut colored = Vec::new();
                for (si, s) in copy.segs.iter_mut().enumerate() {
                    if let Seg::Card(raw) = s {
                        if let Some(b) = block_id(raw) {
                            if let Some(c) = self.card_color(&b) {
                                colored.push((si, c));
                            }
                            *raw = strip_block_id(raw);
                        }
                    }
                }
                self.lanes.insert(li + 1, copy);
                if new_title != old_title {
                    self.set_heading(li + 1, &new_title, None);
                    if let Some(c) = self.lane_color(&old_title) {
                        self.memora_edit(|m| set_in(m, "lanes", &new_title, Some(json!(c))))?;
                    }
                }
                for (si, c) in colored {
                    self.set_card_color_at(li + 1, si, Some(c))?;
                }
                Ok(Applied {
                    card: None,
                    summary: format!("duplicate lane {old_title}"),
                })
            }
            Op::ArchiveLaneCards { lane } => {
                let li = self.lane_at(lane)?;
                let title = self.lanes[li].title();
                let mut n = 0;
                while let Some(si) = self.lanes[li]
                    .segs
                    .iter()
                    .position(|s| matches!(s, Seg::Card(_)))
                {
                    self.archive_at(li, si)?;
                    n += 1;
                }
                Ok(Applied {
                    card: None,
                    summary: format!("archive {n} cards of {title}"),
                })
            }
            Op::ClearLane { lane } => {
                let li = self.lane_at(lane)?;
                let (gone, keep): (Vec<Seg>, Vec<Seg>) = std::mem::take(&mut self.lanes[li].segs)
                    .into_iter()
                    .partition(|s| matches!(s, Seg::Card(_)));
                self.lanes[li].segs = keep;
                self.drop_card_colors(&gone)?;
                Ok(Applied {
                    card: None,
                    summary: format!("delete {} cards of {}", gone.len(), self.lanes[li].title()),
                })
            }
            Op::SetLaneColor { lane, color } => {
                let li = self.lane_at(lane)?;
                let title = self.lanes[li].title();
                self.memora_edit(|m| set_in(m, "lanes", &title, color.clone().map(Value::from)))?;
                Ok(Applied {
                    card: None,
                    summary: format!("color lane {title}"),
                })
            }
            Op::SetLaneLimit { lane, max } => {
                let li = self.lane_at(lane)?;
                let title = self.lanes[li].title();
                self.set_heading(li, &title, Some(*max));
                Ok(Applied {
                    card: None,
                    summary: format!("set the limit of lane {title}"),
                })
            }
            Op::SetBoardStyle { color, icon } => {
                self.memora_edit(|m| {
                    if let Some(c) = color {
                        set_in(m, "board", "color", c.clone().map(Value::from));
                    }
                    if let Some(i) = icon {
                        set_in(m, "board", "icon", i.clone().map(Value::from));
                    }
                })?;
                Ok(Applied {
                    card: None,
                    summary: "set the board style".into(),
                })
            }
            Op::SetTagColor {
                tag,
                color,
                background,
            } => {
                let t = tag.trim().trim_start_matches('#');
                if !static_re!(r"^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$").is_match(t) {
                    return err(format!("tag must be a tag such as #urgent (got {tag:?})"));
                }
                let key = format!("#{t}");
                self.settings_edit(|obj| set_tag_color(obj, &key, color.as_deref(), background))?;
                Ok(Applied {
                    card: None,
                    summary: format!("color tag {key}"),
                })
            }
            Op::SetSettings { settings } => {
                if settings.is_empty() {
                    return err("nothing to change: settings is empty");
                }
                for (k, v) in settings {
                    let Some((_, ty)) = SETTING_KEYS.iter().find(|(n, _)| n == k) else {
                        let known: Vec<&str> = SETTING_KEYS.iter().map(|(n, _)| *n).collect();
                        return err(format!(
                            "{k:?} is not a board setting this tool changes (the board's colors and icon have their own edits); settings: {}",
                            known.join(", ")
                        ));
                    };
                    let fits = match (v, *ty) {
                        (None, _) => true,
                        (Some(x), "array") => x.is_array(),
                        (Some(x), "number") => x.is_number(),
                        (Some(x), "string") => x.is_string(),
                        (Some(x), "boolean") => x.is_boolean(),
                        _ => false,
                    };
                    if !fits {
                        return err(format!("{k} must be a {ty}, or null to remove it"));
                    }
                }
                self.settings_edit(|obj| {
                    for (k, v) in settings {
                        let raw = v.as_ref().map(|x| x.to_string());
                        obj_set(obj, k, raw.as_deref())?;
                    }
                    Ok(())
                })?;
                Ok(Applied {
                    card: None,
                    summary: "change the board settings".into(),
                })
            }
        }
    }

    /// The board as JSON: lanes with their cards, the archive, counts and settings.
    /// `html` renders each card's markdown with `render`.
    pub fn to_json(&self, render: Option<&dyn Fn(&str) -> String>) -> Value {
        let ids = self.card_ids();
        let id_of = |li: usize, si: usize| {
            ids.iter()
                .find(|(l, s, _)| *l == li && *s == si)
                .map(|(_, _, id)| id.clone())
                .unwrap_or_default()
        };
        let settings = self.settings();
        let codec = CardCodec::new(&settings);
        let memora = self.memora();
        let color_in = |section: &str, key: &str| {
            memora
                .get(section)
                .and_then(|s| s.get(key))
                .and_then(|c| c.as_str())
                .map(str::to_string)
        };
        let card_json = |li: usize, si: usize, raw: &str| {
            let mut v = card_json(raw);
            v["id"] = json!(id_of(li, si));
            let block = block_id(raw);
            v["block"] = json!(block);
            v["color"] = json!(block.and_then(|b| color_in("cards", &b)));
            v["checklist"] = json!(card::checklist(raw)
                .into_iter()
                .map(|c| json!({"text": c.text, "done": c.done}))
                .collect::<Vec<_>>());
            v["fields"] = card::fields_json(&codec, raw);
            if let Some(r) = render {
                v["html"] = json!(r(&card_text(raw)));
            }
            v
        };
        let mut lanes = Vec::new();
        let mut archive = Vec::new();
        let (mut cards, mut done) = (0usize, 0usize);
        for (li, l) in self.lanes.iter().enumerate() {
            let list: Vec<Value> = l
                .segs
                .iter()
                .enumerate()
                .filter_map(|(si, s)| match s {
                    Seg::Card(raw) => Some(card_json(li, si, raw)),
                    Seg::Line(_) => None,
                })
                .collect();
            if l.archive {
                archive.extend(list);
                continue;
            }
            cards += list.len();
            done += list.iter().filter(|c| c["checked"] == json!(true)).count();
            let full = l.title_full();
            let (title, max) = split_limit(&full);
            let color = color_in("lanes", &title);
            lanes.push(json!({
                "index": lanes.len(),
                "title": title,
                "max_items": max,
                "color": color,
                "complete": self.completes(li),
                "cards": list,
            }));
        }
        json!({
            "lanes": lanes,
            "archive": archive,
            "counts": {"lanes": lanes.len(), "cards": cards, "done": done, "archived": archive.len()},
            "style": {"color": color_in("board", "color"), "icon": color_in("board", "icon")},
            "tag_colors": tag_colors(&settings),
            "settings": settings,
        })
    }

    /// The plugin's settings (the JSON inside `%% kanban:settings`), when readable.
    pub fn settings(&self) -> Value {
        let t = &self.tail;
        let Some(start) = t.find('{') else {
            return Value::Null;
        };
        let Some(end) = t.rfind('}') else {
            return Value::Null;
        };
        if end < start {
            return Value::Null;
        }
        serde_json::from_str(&t[start..=end]).unwrap_or(Value::Null)
    }

    /// Lane titles (the archive not counted), with the number of cards in each.
    pub fn lane_summary(&self) -> Vec<Value> {
        self.lanes
            .iter()
            .filter(|l| !l.archive)
            .map(|l| {
                let (title, _) = split_limit(&l.title_full());
                json!({"title": title, "cards": l.segs.iter().filter(|s| matches!(s, Seg::Card(_))).count()})
            })
            .collect()
    }
}

/// `m[section][key] = value` (`None` removes it; an empty section goes too).
fn set_in(m: &mut Map<String, Value>, section: &str, key: &str, value: Option<Value>) {
    let mut sec = m
        .get(section)
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    match value {
        Some(v) => {
            sec.insert(key.to_string(), v);
        }
        None => {
            sec.remove(key);
        }
    }
    if sec.is_empty() {
        m.remove(section);
    } else {
        m.insert(section.to_string(), Value::Object(sec));
    }
}

/// An icon from a caller: `null` or "" clears it; otherwise a short line (an emoji or a name).
fn clean_icon(v: &Value) -> MResult<Option<String>> {
    match v {
        Value::Null => Ok(None),
        Value::String(s) if s.trim().is_empty() => Ok(None),
        Value::String(s) => {
            let t = s.trim();
            if t.chars().count() > 32 || t.chars().any(char::is_control) {
                return err("icon must be an emoji or a short name (at most 32 characters)");
            }
            Ok(Some(t.to_string()))
        }
        _ => err("icon must be a string, or null to clear it"),
    }
}

/// Set member `key` of the JSON object text `obj` to the JSON text `value` (`None` removes
/// it). Other members, their order and their text stay as written; a new member goes last.
fn obj_set(obj: &mut String, key: &str, value: Option<&str>) -> MResult<()> {
    let bad = || MemoryErr("the board's settings are not valid JSON".into());
    let members = json_text::members(obj, 0).ok_or_else(bad)?;
    let spans: Vec<(usize, usize)> = members.iter().map(|m| (m.start, m.end)).collect();
    match (members.iter().position(|m| m.key == key), value) {
        (Some(i), Some(v)) => obj.replace_range(members[i].value..members[i].end, v),
        (Some(i), None) => json_text::remove(obj, &spans, i),
        (None, Some(v)) => json_text::append(obj, &spans, 0, &format!("{}:{v}", json!(key))),
        (None, None) => {}
    }
    Ok(())
}

/// The `tag-colors` entry for `key` (`#tag`): replaced, added, or (no color) removed.
fn set_tag_color(
    obj: &mut String,
    key: &str,
    color: Option<&str>,
    background: &Option<Option<String>>,
) -> MResult<()> {
    let bad = || MemoryErr("the board's settings are not valid JSON".into());
    let members = json_text::members(obj, 0).ok_or_else(bad)?;
    let member = members.iter().find(|m| m.key == "tag-colors");
    let (mut arr, at) = match member {
        Some(m) if obj[m.value..].starts_with('[') => (obj[m.value..m.end].to_string(), Some(m)),
        _ => ("[]".to_string(), None),
    };
    let elems = json_text::elements(&arr, 0).ok_or_else(bad)?;
    let found = elems.iter().position(|(a, b)| {
        serde_json::from_str::<Value>(&arr[*a..*b])
            .ok()
            .and_then(|v| {
                v.get("tagKey")
                    .and_then(|t| t.as_str())
                    .map(str::to_lowercase)
            })
            == Some(key.to_lowercase())
    });
    let old_bg = found
        .and_then(|i| serde_json::from_str::<Value>(&arr[elems[i].0..elems[i].1]).ok())
        .and_then(|v| {
            v.get("backgroundColor")
                .and_then(|b| b.as_str())
                .map(str::to_string)
        });
    let bg = match background {
        None => old_bg.unwrap_or_default(),
        Some(b) => b.clone().unwrap_or_default(),
    };
    let entry = color.map(|c| {
        format!(
            "{{\"tagKey\":{},\"color\":{},\"backgroundColor\":{}}}",
            json!(key),
            json!(c),
            json!(bg)
        )
    });
    match (found, entry) {
        (Some(i), Some(e)) => arr.replace_range(elems[i].0..elems[i].1, &e),
        (Some(i), None) => json_text::remove(&mut arr, &elems, i),
        (None, Some(e)) => json_text::append(&mut arr, &elems, 0, &e),
        (None, None) => return Ok(()),
    }
    let empty = json_text::elements(&arr, 0).is_some_and(|e| e.is_empty());
    match at {
        Some(m) if empty => {
            let spans: Vec<(usize, usize)> = members.iter().map(|m| (m.start, m.end)).collect();
            let i = members.iter().position(|x| x.key == m.key).unwrap_or(0);
            json_text::remove(obj, &spans, i);
        }
        Some(m) => obj.replace_range(m.value..m.end, &arr),
        None if empty => {}
        None => obj_set(obj, "tag-colors", Some(&arr))?,
    }
    Ok(())
}

/// Just enough of a JSON reader to edit settings in place: where values, members and
/// elements start and end in the text.
mod json_text {
    fn ws(b: &[u8], mut i: usize) -> usize {
        while i < b.len() && matches!(b[i], b' ' | b'\t' | b'\n' | b'\r') {
            i += 1;
        }
        i
    }

    fn string_end(b: &[u8], mut i: usize) -> Option<usize> {
        i += 1;
        while i < b.len() {
            match b[i] {
                b'\\' => i += 2,
                b'"' => return Some(i + 1),
                _ => i += 1,
            }
        }
        None
    }

    /// The end of the JSON value starting at `i`.
    pub fn value_end(s: &str, i: usize) -> Option<usize> {
        let b = s.as_bytes();
        match *b.get(i)? {
            b'"' => string_end(b, i),
            b'{' | b'[' => {
                let mut depth = 0usize;
                let mut j = i;
                while j < b.len() {
                    match b[j] {
                        b'"' => {
                            j = string_end(b, j)?;
                            continue;
                        }
                        b'{' | b'[' => depth += 1,
                        b'}' | b']' => {
                            depth -= 1;
                            if depth == 0 {
                                return Some(j + 1);
                            }
                        }
                        _ => {}
                    }
                    j += 1;
                }
                None
            }
            _ => {
                let mut j = i;
                while j < b.len()
                    && !matches!(b[j], b',' | b'}' | b']' | b' ' | b'\t' | b'\n' | b'\r')
                {
                    j += 1;
                }
                (j > i).then_some(j)
            }
        }
    }

    /// A member of an object: its key, where it starts, where its value starts and ends.
    pub struct Member {
        pub key: String,
        pub start: usize,
        pub value: usize,
        pub end: usize,
    }

    /// The members of the object starting at `open`.
    pub fn members(s: &str, open: usize) -> Option<Vec<Member>> {
        let b = s.as_bytes();
        if b.get(open) != Some(&b'{') {
            return None;
        }
        let mut out = Vec::new();
        let mut i = ws(b, open + 1);
        if b.get(i) == Some(&b'}') {
            return Some(out);
        }
        loop {
            if b.get(i) != Some(&b'"') {
                return None;
            }
            let ke = string_end(b, i)?;
            let key: String = serde_json::from_str(&s[i..ke]).ok()?;
            let c = ws(b, ke);
            if b.get(c) != Some(&b':') {
                return None;
            }
            let v = ws(b, c + 1);
            let end = value_end(s, v)?;
            out.push(Member {
                key,
                start: i,
                value: v,
                end,
            });
            let n = ws(b, end);
            match b.get(n) {
                Some(b',') => i = ws(b, n + 1),
                Some(b'}') => return Some(out),
                _ => return None,
            }
        }
    }

    /// The elements of the array starting at `open`, as `(start, end)`.
    pub fn elements(s: &str, open: usize) -> Option<Vec<(usize, usize)>> {
        let b = s.as_bytes();
        if b.get(open) != Some(&b'[') {
            return None;
        }
        let mut out = Vec::new();
        let mut i = ws(b, open + 1);
        if b.get(i) == Some(&b']') {
            return Some(out);
        }
        loop {
            let end = value_end(s, i)?;
            out.push((i, end));
            let n = ws(b, end);
            match b.get(n) {
                Some(b',') => i = ws(b, n + 1),
                Some(b']') => return Some(out),
                _ => return None,
            }
        }
    }

    /// Remove item `i` of `spans` (members or elements) with the comma that joined it.
    pub fn remove(s: &mut String, spans: &[(usize, usize)], i: usize) {
        if i > 0 {
            s.replace_range(spans[i - 1].1..spans[i].1, "");
        } else if spans.len() > 1 {
            s.replace_range(spans[0].0..spans[1].0, "");
        } else {
            s.replace_range(spans[0].0..spans[0].1, "");
        }
    }

    /// Add `item` after the last of `spans` (or first, in the container opening at `open`).
    pub fn append(s: &mut String, spans: &[(usize, usize)], open: usize, item: &str) {
        match spans.last() {
            Some(&(_, end)) => s.insert_str(end, &format!(",{item}")),
            None => s.insert_str(open + 1, item),
        }
    }
}

/// `tag-colors` of the settings as `{tag: {color, background}}` (tags without `#`).
fn tag_colors(settings: &Value) -> Value {
    let mut out = Map::new();
    for e in settings
        .get("tag-colors")
        .and_then(|t| t.as_array())
        .into_iter()
        .flatten()
    {
        let Some(k) = e.get("tagKey").and_then(|t| t.as_str()) else {
            continue;
        };
        let k = k.trim().trim_start_matches('#');
        if k.is_empty() {
            continue;
        }
        let s = |f: &str| {
            e.get(f)
                .and_then(|c| c.as_str())
                .filter(|c| !c.is_empty())
                .map(str::to_string)
        };
        out.insert(
            k.to_string(),
            json!({"color": s("color"), "background": s("backgroundColor")}),
        );
    }
    Value::Object(out)
}

fn push_line(lanes: &mut [Lane], pre: &mut Vec<String>, line: &str) {
    match lanes.last_mut() {
        Some(l) => l.segs.push(Seg::Line(line.to_string())),
        None => pre.push(line.to_string()),
    }
}

impl Lane {
    /// The heading text, a WIP limit included.
    fn title_full(&self) -> String {
        let line = self
            .head
            .lines()
            .rev()
            .find(|l| lane_heading(l).is_some())
            .unwrap_or("");
        lane_heading(line).unwrap_or("").replace("<br>", " ")
    }

    /// The title without its WIP limit.
    fn title(&self) -> String {
        split_limit(&self.title_full()).0
    }
}

/// `Title (3)` -> `("Title", 3)`; a title without a limit has 0.
fn split_limit(full: &str) -> (String, u64) {
    if let Some(suffix) = lane_limit_suffix(full) {
        let n: u64 = suffix
            .trim()
            .trim_start_matches('(')
            .trim_end_matches(')')
            .parse()
            .unwrap_or(0);
        return (full[..full.len() - suffix.len()].trim_end().to_string(), n);
    }
    (full.to_string(), 0)
}

/// The ` (3)` WIP limit at the end of a lane title, with its leading space.
fn lane_limit_suffix(title: &str) -> Option<&str> {
    let t = title.trim_end();
    if !t.ends_with(')') {
        return None;
    }
    let open = t.rfind('(')?;
    let digits = &t[open + 1..t.len() - 1];
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let before = t[..open].trim_end();
    if before.is_empty() {
        return None;
    }
    Some(&t[before.len()..])
}

/// The first line of a card without its list marker and checkbox: `(check, rest)`.
fn split_marker(first: &str) -> (Option<char>, &str) {
    let line = first.trim_end_matches(['\r', '\n']);
    let rest = line.get(1..).unwrap_or("");
    let rest = rest.strip_prefix([' ', '\t']).unwrap_or(rest);
    let mut chars = rest.chars();
    if chars.next() == Some('[') {
        if let Some(c) = chars.next() {
            if chars.next() == Some(']') {
                let after = &rest[2 + c.len_utf8()..];
                if after.is_empty() || after.starts_with([' ', '\t']) {
                    return (Some(c), after.strip_prefix([' ', '\t']).unwrap_or(after));
                }
            }
        }
    }
    (None, rest)
}

/// One level of indentation off a continuation line (a tab or up to four spaces).
fn dedent(line: &str) -> &str {
    if let Some(r) = line.strip_prefix('\t') {
        return r;
    }
    let n = line.len() - line.trim_start_matches(' ').len();
    &line[n.min(4)..]
}

/// A card's text: the first line after the checkbox and the continuation lines without
/// their indentation.
fn card_text(raw: &str) -> String {
    let mut lines = raw.lines();
    let first = lines.next().unwrap_or("");
    let (_, rest) = split_marker(first);
    let mut out = rest.trim_end().to_string();
    for l in lines {
        out.push('\n');
        out.push_str(dedent(l).trim_end());
    }
    out.trim_end().to_string()
}

fn card_id(text: &str) -> String {
    format!("{:032x}", md5_hex(text.as_bytes()))[..8].to_string()
}

fn card_json(raw: &str) -> Value {
    let text = card_text(raw);
    let (check, _) = split_marker(raw.lines().next().unwrap_or(""));
    let checked = check.is_some_and(|c| c != ' ');
    let mut tags: Vec<String> = Vec::new();
    let mut links: Vec<String> = Vec::new();
    let mut dates: Vec<String> = Vec::new();
    let mut times: Vec<String> = Vec::new();
    let no_code = crate::re_code_span().replace_all(&text, "");
    for c in crate::re_wikilink().captures_iter(&no_code) {
        let start = c.get(0).map(|m| m.start()).unwrap_or(0);
        let target = c[1].trim().to_string();
        if start > 0 && no_code[..start].ends_with('@') {
            dates.push(target);
        } else if !links.contains(&target) {
            links.push(target);
        }
    }
    for c in static_re!(r"(^|[^@])@\{([^}\n]+)\}").captures_iter(&no_code) {
        dates.push(c[2].trim().to_string());
    }
    for c in static_re!(r"@@\{([^}\n]+)\}").captures_iter(&no_code) {
        times.push(c[1].trim().to_string());
    }
    let no_links = crate::re_wikilink().replace_all(&no_code, " ");
    for c in static_re!(r"(?:^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)").captures_iter(&no_links) {
        let t = c[1].to_string();
        if !t.chars().all(|x| x.is_ascii_digit()) && !tags.contains(&t) {
            tags.push(t);
        }
    }
    let title = text.lines().next().unwrap_or("").to_string();
    json!({
        "text": text,
        "title": title,
        "checked": checked,
        "task": check.is_some(),
        "tags": tags,
        "links": links,
        "dates": dates,
        "times": times,
    })
}

/// `text` with its lines after the first indented by `indent` (multi-line cards).
fn indent_lines(text: &str, indent: &str, nl: &str) -> String {
    let mut out = String::new();
    for (i, l) in text.lines().enumerate() {
        if i > 0 {
            out.push_str(nl);
            if !l.trim().is_empty() {
                out.push_str(indent);
            }
        }
        out.push_str(l.trim_end());
    }
    out
}

/// A caller's card text, trimmed: not empty, not too long, no control characters.
fn clean_card(text: &str) -> MResult<String> {
    let t = text.replace("\r\n", "\n").replace('\r', "\n");
    let t = t.trim();
    if t.is_empty() {
        return err("text is empty: a card needs some text");
    }
    if t.chars().count() > MAX_CARD {
        return err(format!("text is too long: at most {MAX_CARD} characters"));
    }
    if t.chars().any(|c| c.is_control() && c != '\n' && c != '\t') {
        return err("text has control characters");
    }
    Ok(t.to_string())
}

/// A caller's lane title: one line, not empty, not too long.
fn clean_lane(title: &str) -> MResult<String> {
    let t = title.trim();
    if t.is_empty() {
        return err("title is empty: a lane needs a name");
    }
    if t.contains(['\n', '\r']) || t.chars().any(char::is_control) {
        return err("a lane title is one line of text");
    }
    if t.chars().count() > MAX_LANE {
        return err(format!("title is too long: at most {MAX_LANE} characters"));
    }
    Ok(t.to_string())
}

/// The card with its checkbox set to done (`x`) or open (` `); a plain list item gets one.
fn set_checked(raw: &str, checked: bool) -> String {
    let (first, rest) = match raw.find('\n') {
        Some(i) => (&raw[..=i], &raw[i + 1..]),
        None => (raw, ""),
    };
    let ending = &first[first.trim_end_matches(['\r', '\n']).len()..];
    let line = first.trim_end_matches(['\r', '\n']);
    let (check, text) = split_marker(line);
    if check.is_some_and(|c| (c != ' ') == checked) {
        return raw.to_string();
    }
    let bullet = &line[..1];
    let c = if checked { 'x' } else { ' ' };
    let text = if text.is_empty() {
        String::new()
    } else {
        format!(" {text}")
    };
    format!("{bullet} [{c}]{text}{ending}{rest}")
}

/// The card with new text: its list marker and checkbox stay, the continuation indent of
/// the old card is reused, and an Obsidian block id (`^abc123`) on the old card is kept.
fn rewrite_card(raw: &str, text: &str, nl: &str) -> String {
    let first = raw.lines().next().unwrap_or("- ");
    let (check, _) = split_marker(first);
    let bullet = &first[..1.min(first.len())];
    let prefix = match check {
        Some(c) => format!("{bullet} [{c}] "),
        None => format!("{bullet} "),
    };
    let indent = raw
        .lines()
        .skip(1)
        .find(|l| !l.trim().is_empty())
        .map(|l| {
            let n = l.len() - l.trim_start().len();
            l[..n.min(4)].to_string()
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "\t".to_string());
    let mut text = text.to_string();
    let old = card_text(raw);
    if let Some(c) = static_re!(r"\s\^([A-Za-z0-9-]+)$").captures(&old) {
        let id = format!("^{}", &c[1]);
        if !text.contains(&id) {
            text.push(' ');
            text.push_str(&id);
        }
    }
    let ending = if raw.ends_with('\n') { nl } else { "" };
    format!("{prefix}{}{ending}", indent_lines(&text, &indent, nl))
}

/// A new board's text: the frontmatter and settings Obsidian Kanban writes, and `lanes`.
pub fn new_board(lanes: &[&str]) -> String {
    let mut out = String::from("---\n\nkanban-plugin: basic\n\n---\n\n");
    for l in lanes {
        out.push_str(&format!("## {l}\n\n\n\n"));
    }
    out.push_str("\n\n%% kanban:settings\n```\n{\"kanban-plugin\":\"basic\"}\n```\n%%");
    out
}

/// The lanes of a new board when the caller names none (English: the board's text is the
/// person's own, so it does not follow the interface language).
pub const DEFAULT_LANES: [&str; 3] = ["To do", "Doing", "Done"];

const SETTINGS_BLOCK: &str = "%% kanban:settings\n```\n{\"kanban-plugin\":\"basic\"}\n```\n%%\n";
const BOARD_FM: &str = "---\n\nkanban-plugin: basic\n\n---\n\n";

fn one_line(s: &str) -> String {
    static_re!(r"[\r\n]+")
        .replace_all(s, " ")
        .trim()
        .to_string()
}

/// A new board with the three default lanes (`lanes` names them: to do, doing, done), the
/// last one marked Complete, as the web app writes it.
pub fn default_board(lanes: &[String; 3]) -> String {
    let [a, b, c] = lanes.clone().map(|l| one_line(&l));
    format!("{BOARD_FM}## {a}\n\n\n\n## {b}\n\n\n\n## {c}\n\n**Complete**\n\n\n\n{SETTINGS_BLOCK}")
}

/// What [`to_board`] made of a note.
#[derive(Debug, Clone, PartialEq)]
pub struct Conversion {
    /// The board's text.
    pub text: String,
    pub lanes: usize,
    pub cards: usize,
    /// Lines of other text (paragraphs, quotes, code) a board has no place for.
    pub dropped: usize,
}

/// Turn a plain note into a board (a port of `toBoard` in `web/src/vault/board-text.ts`):
/// frontmatter is kept (with `kanban-plugin: basic` added), headings become lanes, list items
/// cards, items before the first heading go to the first default lane; with no headings,
/// open items go to the first default lane and finished ones to the last (Complete).
/// `title` is the note's title (a heading with it is not counted as dropped text).
pub fn to_board(content: &str, title: &str, lanes: &[String; 3]) -> Conversion {
    struct L {
        title: String,
        cards: Vec<String>,
        complete: bool,
    }
    let mut body = content.replace("\r\n", "\n").replace('\r', "\n");
    let mut fm = String::new();
    if let Some(m) = static_re!(r"(?s)^---\n(.*?)\n---[ \t]*(?:\n|$)").captures(&body) {
        let mut lines: Vec<&str> = m[1]
            .split('\n')
            .filter(|l| !static_re!(r"^kanban-plugin\s*:").is_match(l))
            .collect();
        while lines.last().is_some_and(|l| l.trim().is_empty()) {
            lines.pop();
        }
        while lines.first().is_some_and(|l| l.trim().is_empty()) {
            lines.remove(0);
        }
        let inner = if lines.is_empty() {
            String::new()
        } else {
            format!("{}\n", lines.join("\n"))
        };
        fm = format!("---\n\n{inner}kanban-plugin: basic\n\n---\n\n");
        let all = m[0].len();
        body = body[all..].to_string();
    }
    let rows: Vec<&str> = body.split('\n').collect();
    // `#` is the note's title when the note has smaller headings too.
    let min_level = if rows.iter().any(|l| static_re!(r"^#{2,6}\s").is_match(l)) {
        2
    } else {
        1
    };
    let mut loose: Vec<String> = Vec::new();
    let mut ls: Vec<L> = Vec::new();
    let mut card: Option<Vec<String>> = None;
    let mut fence = false;
    let mut dropped = 0;
    fn flush(card: &mut Option<Vec<String>>, ls: &mut [L], loose: &mut Vec<String>) {
        if let Some(c) = card.take() {
            match ls.last_mut() {
                Some(l) => l.cards.push(c.join("\n")),
                None => loose.push(c.join("\n")),
            }
        }
    }
    let fence_re = static_re!(r"^\s*(```|~~~)");
    let head_re = static_re!(r"^(#{1,6})\s+(.*?)\s*#*\s*$");
    let item_re = static_re!(r"^(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$");
    for raw in rows {
        let line = raw.trim_end();
        if fence_re.is_match(line) {
            flush(&mut card, &mut ls, &mut loose);
            fence = !fence;
            continue;
        }
        if fence {
            if !line.trim().is_empty() {
                dropped += 1;
            }
            continue;
        }
        if line.trim().is_empty() {
            continue;
        }
        if let Some(h) = head_re.captures(line) {
            flush(&mut card, &mut ls, &mut loose);
            if h[1].len() < min_level || h[2].trim().is_empty() {
                // The note's own title is not text lost.
                if h[2].trim().to_lowercase() != title.trim().to_lowercase() {
                    dropped += 1;
                }
                continue;
            }
            ls.push(L {
                title: one_line(&h[2]),
                cards: Vec::new(),
                complete: false,
            });
            continue;
        }
        let item = if line.starts_with(|c: char| !c.is_whitespace()) {
            item_re.captures(line)
        } else {
            None
        };
        if let Some(it) = item.filter(|it| !it[2].trim().is_empty()) {
            flush(&mut card, &mut ls, &mut loose);
            let done = it.get(1).is_some_and(|m| m.as_str() != " ");
            card = Some(vec![format!(
                "- [{}] {}",
                if done { 'x' } else { ' ' },
                it[2].trim()
            )]);
            continue;
        }
        // Indented lines under an item (sub items, a second paragraph) stay with its card.
        if let Some(c) = card.as_mut() {
            if line.starts_with(char::is_whitespace) {
                c.push(format!("\t{}", line.trim()));
                continue;
            }
        }
        flush(&mut card, &mut ls, &mut loose);
        dropped += 1;
    }
    flush(&mut card, &mut ls, &mut loose);
    let [todo, doing, done] = lanes.clone().map(|l| one_line(&l));
    if ls.is_empty() {
        let (open, closed): (Vec<String>, Vec<String>) =
            loose.into_iter().partition(|c| c.starts_with("- [ ]"));
        ls.push(L {
            title: todo,
            cards: open,
            complete: false,
        });
        ls.push(L {
            title: doing,
            cards: Vec::new(),
            complete: false,
        });
        ls.push(L {
            title: done,
            cards: closed,
            complete: true,
        });
    } else if !loose.is_empty() {
        ls.insert(
            0,
            L {
                title: todo,
                cards: loose,
                complete: false,
            },
        );
    }
    let mut text = if fm.is_empty() {
        BOARD_FM.to_string()
    } else {
        fm
    };
    for l in &ls {
        text.push_str(&format!(
            "## {}\n\n{}{}\n\n",
            l.title,
            if l.complete { "**Complete**\n" } else { "" },
            if l.cards.is_empty() {
                String::new()
            } else {
                format!("{}\n", l.cards.join("\n"))
            }
        ));
    }
    text.push('\n');
    text.push_str(SETTINGS_BLOCK);
    Conversion {
        text,
        lanes: ls.len(),
        cards: ls.iter().map(|l| l.cards.len()).sum(),
        dropped,
    }
}

/// Lane names from a caller (at most three, for to do / doing / done; blanks keep the
/// default).
pub fn default_lanes(given: Option<&[String]>) -> MResult<[String; 3]> {
    let mut out = DEFAULT_LANES.map(String::from);
    for (i, l) in given.unwrap_or(&[]).iter().take(3).enumerate() {
        if !l.trim().is_empty() {
            out[i] = clean_lane(l)?;
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// The store side: boards as notes
// ---------------------------------------------------------------------------

impl MemoryStore {
    /// The board note `path` names (a path, `.md` optional, or a note name): its
    /// relative path and content. A note that is not a board is refused.
    fn board_note(&self, path: &str) -> MResult<(String, PathBuf, String)> {
        let (_, rel) = self.note_of(path)?;
        let ap = self.resolve(&rel)?;
        let content = self
            .read_raw(&ap)
            .ok_or_else(|| MemoryErr(format!("permission denied: {rel}")))?;
        if !is_board(&content) {
            return err(format!(
                "{rel} is not a Kanban board: its frontmatter needs `{BOARD_KEY}: basic`"
            ));
        }
        Ok((rel, ap, content))
    }

    /// Every board in the vault (or in `folder` and its subfolders): `{path, title,
    /// lanes:[{title, cards}], cards, done, archived, mtime}`, most recently changed first.
    pub fn kanban_list_impl(&self, folder: Option<&str>) -> MResult<Vec<Value>> {
        let folder = folder.map(str::trim).filter(|f| !f.is_empty());
        let files = self.walk();
        let metas = self.scan(&files);
        let mtimes = self.mtimes();
        let mut out = Vec::new();
        for ((rel, _name, fp), meta) in files.iter().zip(&metas) {
            if meta.fm.get(BOARD_KEY).is_none() {
                continue;
            }
            if let Some(f) = folder {
                if !in_folder(rel, f) {
                    continue;
                }
            }
            let Some(content) = self.read_raw(fp) else {
                continue;
            };
            if !is_board(&content) {
                continue;
            }
            let b = Board::parse(&content);
            let j = b.to_json(None);
            let (embedded_in, linked_from) = self.board_refs(rel, &files, &metas);
            out.push(json!({
                "path": rel,
                "embedded_in": embedded_in,
                "linked_from": linked_from,
                "title": meta.title.clone().unwrap_or_else(|| Self::base_name(rel)),
                "lanes": b.lane_summary(),
                "cards": j["counts"]["cards"],
                "done": j["counts"]["done"],
                "archived": j["counts"]["archived"],
                "version": version_of(&content),
                "mtime": mtimes.get(rel).copied().unwrap_or(0.0),
            }));
        }
        out.sort_by(|a, b| {
            let (x, y) = (a["mtime"].as_f64(), b["mtime"].as_f64());
            y.partial_cmp(&x).unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(out)
    }

    /// One board: `{path, version, lanes, archive, counts, settings}`; each card has
    /// `{id, text, title, checked, task, tags, links, dates, times}` (and `html`, the
    /// card rendered as the reader shows notes, when `html` is set).
    pub fn kanban_get_impl(&self, path: &str, html: bool) -> MResult<Value> {
        let (rel, _, content) = self.board_note(path)?;
        Ok(self.board_json(&rel, &content, html))
    }

    fn board_json(&self, rel: &str, content: &str, html: bool) -> Value {
        let b = Board::parse(content);
        let mut v = if html {
            let files = self.walk();
            let render = |text: &str| self.render_in(rel, text, &files).0;
            b.to_json(Some(&render))
        } else {
            b.to_json(None)
        };
        v["path"] = json!(rel);
        v["version"] = json!(version_of(content));
        let files = self.walk();
        let metas = self.scan(&files);
        let (embedded_in, linked_from) = self.board_refs(rel, &files, &metas);
        v["embedded_in"] = json!(embedded_in);
        v["linked_from"] = json!(linked_from);
        v
    }

    /// Where a board shows up: the notes that put it in (`![[Board]]`) and those that only
    /// link to it (`[[Board]]`). From the note cache (link targets and bodies): no file is read.
    pub(crate) fn board_refs(
        &self,
        rel: &str,
        files: &[(String, String, PathBuf)],
        metas: &[std::sync::Arc<crate::NoteMeta>],
    ) -> (Vec<String>, Vec<String>) {
        let name_l = Self::base_name(rel).to_lowercase();
        let names_me = |t: &str| {
            let t = Self::norm_target(t.split('|').next().unwrap_or(""));
            t.split('#').next().unwrap_or("").trim().to_lowercase() == name_l
        };
        let mut embeds = Vec::new();
        let mut links = Vec::new();
        for ((rel2, _, _), meta) in files.iter().zip(metas) {
            if rel2 == rel || !meta.targets.iter().any(|t| names_me(t)) {
                continue;
            }
            let embedded = embed_targets(&meta.body).iter().any(|t| names_me(t));
            if embedded {
                embeds.push(rel2.clone());
            } else {
                links.push(rel2.clone());
            }
        }
        (embeds, links)
    }

    /// The boards a note (`own`, the note itself, never counts) puts in with `![[...]]`, as paths.
    pub(crate) fn boards_in(
        &self,
        own: &str,
        content: &str,
        files: &[(String, String, PathBuf)],
        metas: &[std::sync::Arc<crate::NoteMeta>],
    ) -> Vec<String> {
        let wanted: Vec<String> = embed_targets(content)
            .iter()
            .map(|t| {
                Self::norm_target(t.split('|').next().unwrap_or(""))
                    .split('#')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_lowercase()
            })
            .collect();
        if wanted.is_empty() {
            return Vec::new();
        }
        let mut out = Vec::new();
        for ((rel, _, _), meta) in files.iter().zip(metas) {
            if rel != own
                && meta.fm.get(BOARD_KEY).is_some()
                && wanted.contains(&Self::base_name(rel).to_lowercase())
                && !out.contains(rel)
            {
                out.push(rel.clone());
            }
        }
        out
    }

    /// Apply `op` to the board `path` and save it as a normal note edit (history, cache).
    /// `version`, when given, must be the board's current version: a board changed since
    /// the caller read it is refused (`board changed`) and nothing is written. Returns
    /// the board after the edit, with `card` (the id of the card made or changed).
    pub fn kanban_apply_impl(
        &self,
        path: &str,
        version: Option<&str>,
        op: &Op,
        html: bool,
    ) -> MResult<Value> {
        let (rel, ap, content) = self.board_note(path)?;
        let now = version_of(&content);
        if let Some(v) = version.map(str::trim).filter(|v| !v.is_empty()) {
            if v != now {
                return err(format!(
                    "board changed: {rel} is at version {now}, not {v}; read it again with kanban_get_board and retry"
                ));
            }
        }
        let mut b = Board::parse(&content);
        let done = b.apply(op)?;
        let new = b.render();
        if new != content {
            fs::write(&ap, &new).map_err(|e| MemoryErr(e.to_string()))?;
            self.refresh_notes(&[&ap]);
            self.git_commit(&format!("kanban: {} in {rel}", done.summary));
        }
        let mut v = self.board_json(&rel, &new, html);
        v["ok"] = json!(true);
        v["changed"] = json!(new != content);
        v["card"] = json!(done.card);
        Ok(v)
    }
}

impl MemoryStore {
    /// The path of the board `path` names; a note that is not a board is refused.
    pub fn kanban_board_path(&self, path: &str) -> MResult<String> {
        self.board_note(path).map(|(rel, _, _)| rel)
    }

    /// Create a board note `title` in `folder`. `lanes` names its lanes; none gives
    /// To do / Doing / Done (Complete). Returns the new note's path.
    pub fn kanban_create_impl(
        &self,
        folder: &str,
        title: &str,
        lanes: Option<&[String]>,
    ) -> MResult<String> {
        let names: Vec<String> = lanes
            .unwrap_or(&[])
            .iter()
            .filter(|l| !l.trim().is_empty())
            .map(|l| clean_lane(l))
            .collect::<MResult<_>>()?;
        let text = if names.is_empty() {
            default_board(&default_lanes(None)?)
        } else {
            let refs: Vec<&str> = names.iter().map(String::as_str).collect();
            let mut t = new_board(&refs);
            t.push('\n');
            t
        };
        self.create_impl(title, folder, Some(&text))
    }

    /// Turn the plain note `path` into a board (a normal save: the old text stays in its
    /// history). `lanes` names the default lanes. Returns `{path, lanes, cards, dropped}`.
    pub fn kanban_convert_impl(&self, path: &str, lanes: Option<&[String]>) -> MResult<Value> {
        let (_, rel) = self.note_of(path)?;
        let ap = self.resolve(&rel)?;
        let content = self
            .read_raw(&ap)
            .ok_or_else(|| MemoryErr(format!("permission denied: {rel}")))?;
        if is_board(&content) {
            return err(format!("{rel} is already a Kanban board"));
        }
        let c = to_board(&content, &Self::base_name(&rel), &default_lanes(lanes)?);
        self.save_impl(&rel, &c.text)?;
        Ok(json!({"path": rel, "lanes": c.lanes, "cards": c.cards, "dropped": c.dropped}))
    }

    /// The wikilink text that names `rel` from a note in `from_dir`: the bare name when it
    /// finds that note, else the path without `.md` (as links rewritten on a move are).
    fn link_text_for(&self, rel: &str, from_dir: &str) -> String {
        let stem = rel.strip_suffix(".md").unwrap_or(rel);
        let base = stem.rsplit('/').next().unwrap_or(stem);
        let idx = LinkIndex::new(self.all_note_paths());
        if idx.resolve(base, from_dir).as_deref() == Some(rel) {
            base.to_string()
        } else {
            stem.to_string()
        }
    }

    /// Embed the board `board` in the note `note` (a line `![[Board]]` at its end, after a
    /// blank line), or with `remove` take out every line that is only an embed of or a link
    /// to it. A normal save of the note.
    pub fn kanban_embed_impl(&self, note: &str, board: &str, remove: bool) -> MResult<Value> {
        let (brel, _, _) = self.board_note(board)?;
        let (_, nrel) = self.note_of(note)?;
        if nrel == brel {
            return err("a board cannot embed itself: name another note");
        }
        let ap = self.resolve(&nrel)?;
        let content = self
            .read_raw(&ap)
            .ok_or_else(|| MemoryErr(format!("permission denied: {nrel}")))?;
        if is_board(&content) {
            return err(format!(
                "{nrel} is a board: embed boards in a plain note (one board per note)"
            ));
        }
        let dir = parent_folder(&nrel);
        let idx = LinkIndex::new(self.all_note_paths());
        let names_board = |line: &str| {
            let t = line.trim();
            let t = t.strip_prefix('!').unwrap_or(t);
            let Some(inner) = t.strip_prefix("[[").and_then(|x| x.strip_suffix("]]")) else {
                return false;
            };
            if inner.contains("]]") || inner.contains("[[") {
                return false;
            }
            let target = inner.split('|').next().unwrap_or("").trim();
            !target.is_empty()
                && !target.contains('#')
                && idx.resolve(target, dir).as_deref() == Some(brel.as_str())
        };
        let link = format!("![[{}]]", self.link_text_for(&brel, dir));
        let nl = if content.contains("\r\n") {
            "\r\n"
        } else {
            "\n"
        };
        let lines: Vec<&str> = content.split_inclusive('\n').collect();
        let (new, removed) = if remove {
            let mut out: Vec<&str> = Vec::new();
            let mut removed = 0;
            for (i, l) in lines.iter().enumerate() {
                if names_board(l) {
                    removed += 1;
                    // The blank line put before the embed goes with it.
                    let next_blank = lines.get(i + 1).is_none_or(|n| n.trim().is_empty());
                    if next_blank && out.last().is_some_and(|p| p.trim().is_empty()) {
                        out.pop();
                    }
                    continue;
                }
                out.push(l);
            }
            let mut s = out.concat();
            // The note no longer ends with the line it ended with: keep its last newline.
            if removed > 0 && content.ends_with('\n') && !s.is_empty() && !s.ends_with('\n') {
                s.push_str(nl);
            }
            (s, removed)
        } else {
            if lines.iter().any(|l| names_board(l)) {
                return Ok(
                    json!({"ok": true, "note": nrel, "board": brel, "link": link,
                    "changed": false, "already": true}),
                );
            }
            let mut s = content.clone();
            if !s.is_empty() {
                if !s.ends_with('\n') {
                    s.push_str(nl);
                }
                if !s.ends_with(&format!("{nl}{nl}")) && s.trim() != "" {
                    s.push_str(nl);
                }
            }
            s.push_str(&link);
            s.push_str(nl);
            (s, 0)
        };
        let changed = new != content;
        if changed {
            self.save_impl(&nrel, &new)?;
        }
        Ok(
            json!({"ok": true, "note": nrel, "board": brel, "link": link,
            "changed": changed, "removed": removed}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A board as Obsidian Kanban writes it, with the things people put in cards.
    const OBSIDIAN: &str = "---\n\nkanban-plugin: basic\n\n---\n\n## Backlog (5)\n\n- [ ] Research [[Atlas Project]] options #research @{2026-01-12}\n- [ ] Draft the outline\n\tSecond line of the card\n\t- nested point\n- [ ] Call the printer @{2026-02-01} @@{10:30} ^ab12cd\n\n\n## In progress\n\n- [ ] Write [[Chapter 1|the first chapter]] #writing\n\n\n## Empty lane\n\n\n\n## Done\n\n**Complete**\n- [x] Pick a title #writing\n\n\n\n***\n\n## Archive\n\n- [x] Old idea @{2025-12-01}\n\n%% kanban:settings\n```\n{\"kanban-plugin\":\"basic\",\"lane-width\":272,\"archive-with-date\":false,\"unknown-future-key\":[1,2]}\n```\n%%";

    fn board() -> Board {
        Board::parse(OBSIDIAN)
    }

    fn json_of(b: &Board) -> Value {
        b.to_json(None)
    }

    fn id_of(b: &Board, text_start: &str) -> String {
        let j = json_of(b);
        for l in j["lanes"].as_array().unwrap().iter() {
            for c in l["cards"].as_array().unwrap() {
                if c["text"].as_str().unwrap().starts_with(text_start) {
                    return c["id"].as_str().unwrap().to_string();
                }
            }
        }
        for c in j["archive"].as_array().unwrap() {
            if c["text"].as_str().unwrap().starts_with(text_start) {
                return c["id"].as_str().unwrap().to_string();
            }
        }
        panic!("no card {text_start}")
    }

    fn lane_texts(b: &Board, lane: usize) -> Vec<String> {
        json_of(b)["lanes"][lane]["cards"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["text"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn detects_boards_by_frontmatter() {
        assert!(is_board(OBSIDIAN));
        assert!(is_board("---\nkanban-plugin: board\n---\n## A\n"));
        assert!(is_board(
            "---\r\ntitle: x\r\nkanban-plugin: basic\r\n---\r\n"
        ));
        assert!(!is_board("## A\n- [ ] x\n"));
        assert!(!is_board("---\ntitle: x\n---\nkanban-plugin: basic\n"));
        assert!(!is_board("---\ntags:\n  kanban-plugin: basic\n---\n"));
    }

    #[test]
    fn round_trip_is_byte_for_byte() {
        for s in [
            OBSIDIAN,
            "---\nkanban-plugin: basic\n---\n",
            "---\nkanban-plugin: basic\n---\n## A\n- [ ] no newline at the end",
            "---\r\nkanban-plugin: basic\r\n---\r\n\r\n## A\r\n\r\n- [ ] one\r\n\r\n## B\r\n",
            "---\nkanban-plugin: basic\n---\nIntro text\n\n# Big title\n\n## A\n\n```\n## not a lane\n- [ ] not a card\n```\n- [ ] real\n\n### sub heading\n",
            "no frontmatter\n## A\n- [ ] x\n",
            "",
        ] {
            assert_eq!(Board::parse(s).render(), s);
        }
    }

    #[test]
    fn parses_lanes_cards_and_archive() {
        let b = board();
        let j = json_of(&b);
        let lanes = j["lanes"].as_array().unwrap();
        let titles: Vec<&str> = lanes.iter().map(|l| l["title"].as_str().unwrap()).collect();
        assert_eq!(titles, ["Backlog", "In progress", "Empty lane", "Done"]);
        assert_eq!(lanes[0]["max_items"], 5);
        assert_eq!(lanes[3]["complete"], true);
        assert_eq!(lanes[2]["cards"].as_array().unwrap().len(), 0);
        let c0 = &lanes[0]["cards"][0];
        assert_eq!(c0["tags"], json!(["research"]));
        assert_eq!(c0["links"], json!(["Atlas Project"]));
        assert_eq!(c0["dates"], json!(["2026-01-12"]));
        let c1 = &lanes[0]["cards"][1];
        assert_eq!(
            c1["text"],
            "Draft the outline\nSecond line of the card\n- nested point"
        );
        assert_eq!(c1["title"], "Draft the outline");
        let c2 = &lanes[0]["cards"][2];
        assert_eq!(c2["times"], json!(["10:30"]));
        assert_eq!(lanes[1]["cards"][0]["links"], json!(["Chapter 1"]));
        assert_eq!(lanes[3]["cards"][0]["checked"], true);
        let arch = j["archive"].as_array().unwrap();
        assert_eq!(arch.len(), 1);
        assert_eq!(arch[0]["text"], "Old idea @{2025-12-01}");
        assert_eq!(j["counts"]["cards"], 5);
        assert_eq!(j["counts"]["done"], 1);
        assert_eq!(j["settings"]["lane-width"], 272);
        assert_eq!(j["settings"]["unknown-future-key"], json!([1, 2]));
    }

    #[test]
    fn move_card_between_lanes_touches_only_those_lines() {
        let mut b = board();
        let id = id_of(&b, "Draft the outline");
        let r = b
            .apply(&Op::MoveCard {
                card: id.clone(),
                lane: LaneRef::Title("In progress".into()),
                position: Some(0),
            })
            .unwrap();
        assert_eq!(r.card.as_deref(), Some(id.as_str()), "moving keeps the id");
        let out = b.render();
        assert!(out.contains("## In progress\n\n- [ ] Draft the outline\n\tSecond line of the card\n\t- nested point\n- [ ] Write [[Chapter 1"));
        assert!(out.contains("- [ ] Research [[Atlas Project]] options #research @{2026-01-12}\n- [ ] Call the printer"));
        // The settings block and the archive are untouched.
        assert!(out.ends_with(&OBSIDIAN[OBSIDIAN.find("***").unwrap()..]));
        // Moving it back restores the original file exactly.
        b.apply(&Op::MoveCard {
            card: id,
            lane: LaneRef::Index(0),
            position: Some(1),
        })
        .unwrap();
        assert_eq!(b.render(), OBSIDIAN);
    }

    #[test]
    fn moving_into_a_complete_lane_checks_the_card() {
        let mut b = board();
        let id = id_of(&b, "Write [[Chapter 1");
        b.apply(&Op::MoveCard {
            card: id.clone(),
            lane: LaneRef::Title("done".into()),
            position: None,
        })
        .unwrap();
        assert!(b
            .render()
            .contains("**Complete**\n- [x] Pick a title #writing\n- [x] Write [[Chapter 1"));
        b.apply(&Op::MoveCard {
            card: id,
            lane: LaneRef::Index(1),
            position: None,
        })
        .unwrap();
        assert!(b
            .render()
            .contains("## In progress\n\n- [ ] Write [[Chapter 1|the first chapter]] #writing\n"));
    }

    #[test]
    fn add_card_to_an_empty_lane_and_at_positions() {
        let mut b = board();
        let r = b
            .apply(&Op::AddCard {
                lane: LaneRef::Title("Empty lane".into()),
                text: "First\nwith a second line".into(),
                position: None,
                checked: false,
                edit: None,
            })
            .unwrap();
        assert!(r.card.is_some());
        let out = b.render();
        assert!(out.contains("## Empty lane\n\n- [ ] First\n\twith a second line\n\n\n## Done"));
        assert_eq!(lane_texts(&b, 2), ["First\nwith a second line"]);
        b.apply(&Op::AddCard {
            lane: LaneRef::Index(0),
            text: "Top".into(),
            position: Some(0),
            checked: true,
            edit: None,
        })
        .unwrap();
        assert_eq!(lane_texts(&b, 0)[0], "Top");
        assert!(b
            .render()
            .contains("## Backlog (5)\n\n- [x] Top\n- [ ] Research"));
        // Cards added to a "Complete" lane are done.
        b.apply(&Op::AddCard {
            lane: LaneRef::Index(3),
            text: "Shipped".into(),
            position: None,
            checked: false,
            edit: None,
        })
        .unwrap();
        assert!(b.render().contains("- [x] Shipped\n"));
        assert!(b
            .apply(&Op::AddCard {
                lane: LaneRef::Index(9),
                text: "x".into(),
                position: None,
                checked: false,
                edit: None,
            })
            .is_err());
        assert!(b
            .apply(&Op::AddCard {
                lane: LaneRef::Index(0),
                text: "   ".into(),
                position: None,
                checked: false,
                edit: None,
            })
            .is_err());
    }

    #[test]
    fn update_card_keeps_marker_indent_and_block_id() {
        let mut b = board();
        let id = id_of(&b, "Call the printer");
        let r = b
            .apply(&Op::UpdateCard {
                card: id,
                text: Some("Call the printer again @{2026-02-03}".into()),
                checked: Some(true),
            })
            .unwrap();
        assert!(b
            .render()
            .contains("- [x] Call the printer again @{2026-02-03} ^ab12cd\n"));
        let id2 = r.card.unwrap();
        b.apply(&Op::UpdateCard {
            card: id2.clone(),
            text: None,
            checked: Some(false),
        })
        .unwrap();
        // Checking a card does not change its id.
        assert_eq!(id_of(&b, "Call the printer again"), id2);
        let id = id_of(&b, "Draft the outline");
        b.apply(&Op::UpdateCard {
            card: id,
            text: Some("Draft\nline two".into()),
            checked: None,
        })
        .unwrap();
        assert!(b.render().contains("- [ ] Draft\n\tline two\n- [ ] Call"));
    }

    #[test]
    fn archive_and_restore() {
        let mut b = board();
        let id = id_of(&b, "Pick a title");
        b.apply(&Op::ArchiveCard { card: id.clone() }).unwrap();
        let out = b.render();
        assert!(out.contains("## Archive\n\n- [x] Old idea @{2025-12-01}\n- [x] Pick a title #writing\n\n%% kanban:settings"));
        assert_eq!(json_of(&b)["counts"]["archived"], 2);
        b.apply(&Op::RestoreCard {
            card: id,
            lane: Some(LaneRef::Title("Done".into())),
        })
        .unwrap();
        assert_eq!(b.render(), OBSIDIAN);
        // A board without an archive gets one, before the settings.
        let src = "---\nkanban-plugin: basic\n---\n\n## A\n\n- [ ] one\n- [ ] two\n\n\n\n\n%% kanban:settings\n```\n{\"kanban-plugin\":\"basic\"}\n```\n%%";
        let mut b = Board::parse(src);
        let id = id_of(&b, "two");
        b.apply(&Op::ArchiveCard { card: id }).unwrap();
        let out = b.render();
        assert_eq!(
            out,
            "---\nkanban-plugin: basic\n---\n\n## A\n\n- [ ] one\n\n\n\n\n***\n\n## Archive\n\n- [ ] two\n\n\n%% kanban:settings\n```\n{\"kanban-plugin\":\"basic\"}\n```\n%%"
        );
        let again = Board::parse(&out);
        assert_eq!(json_of(&again)["archive"][0]["text"], "two");
        assert_eq!(again.render(), out);
    }

    #[test]
    fn lanes_add_rename_move_delete() {
        let mut b = board();
        b.apply(&Op::AddLane {
            title: "Review".into(),
            position: None,
        })
        .unwrap();
        let out = b.render();
        assert!(
            out.contains("- [x] Pick a title #writing\n\n\n\n## Review\n\n\n\n***\n\n## Archive")
        );
        b.apply(&Op::RenameLane {
            lane: LaneRef::Title("Backlog".into()),
            title: "Ideas".into(),
        })
        .unwrap();
        assert!(b.render().contains("## Ideas (5)\n"));
        b.apply(&Op::MoveLane {
            lane: LaneRef::Title("Review".into()),
            position: 0,
        })
        .unwrap();
        let titles: Vec<String> = json_of(&b)["lanes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| l["title"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            titles,
            ["Review", "Ideas", "In progress", "Empty lane", "Done"]
        );
        assert!(b.render().contains("---\n\n## Review\n\n\n\n## Ideas (5)"));
        assert!(b
            .apply(&Op::DeleteLane {
                lane: LaneRef::Title("Ideas".into())
            })
            .is_err());
        b.apply(&Op::DeleteLane {
            lane: LaneRef::Title("Review".into()),
        })
        .unwrap();
        b.apply(&Op::DeleteLane {
            lane: LaneRef::Title("Empty lane".into()),
        })
        .unwrap();
        let reparsed = Board::parse(&b.render());
        assert_eq!(reparsed, b);
        assert_eq!(json_of(&reparsed)["counts"]["lanes"], 3);
        assert!(b
            .apply(&Op::AddLane {
                title: "two\nlines".into(),
                position: None
            })
            .is_err());
    }

    #[test]
    fn move_last_lane_without_trailing_blank_lines() {
        let src = "---\nkanban-plugin: basic\n---\n## A\n- [ ] a\n## B\n- [ ] b";
        let mut b = Board::parse(src);
        b.apply(&Op::MoveLane {
            lane: LaneRef::Title("B".into()),
            position: 0,
        })
        .unwrap();
        let out = b.render();
        let again = Board::parse(&out);
        let j = json_of(&again);
        assert_eq!(j["lanes"][0]["title"], "B");
        assert_eq!(j["lanes"][0]["cards"][0]["text"], "b");
        assert_eq!(j["lanes"][1]["cards"][0]["text"], "a");
    }

    #[test]
    fn plain_list_items_and_lazy_lines_are_cards() {
        let src = "---\nkanban-plugin: basic\n---\n## A\n\n- plain item\n- [ ] task\nlazy line\n\nparagraph after\n";
        let b = Board::parse(src);
        let j = json_of(&b);
        let cards = j["lanes"][0]["cards"].as_array().unwrap();
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0]["task"], false);
        assert_eq!(cards[1]["text"], "task\nlazy line");
        let mut b2 = b.clone();
        let id = id_of(&b2, "plain item");
        b2.apply(&Op::UpdateCard {
            card: id,
            text: None,
            checked: Some(true),
        })
        .unwrap();
        assert!(b2.render().contains("- [x] plain item\n"));
        // A card added to a lane whose only content is a paragraph does not swallow it.
        let mut b3 = Board::parse("---\nkanban-plugin: basic\n---\n## A\n\nnotes here\n");
        b3.apply(&Op::AddCard {
            lane: LaneRef::Index(0),
            text: "new".into(),
            position: None,
            checked: false,
            edit: None,
        })
        .unwrap();
        let out = b3.render();
        let j = json_of(&Board::parse(&out));
        assert_eq!(j["lanes"][0]["cards"][0]["text"], "new", "{out}");
    }

    #[test]
    fn identical_cards_get_distinct_ids() {
        let b = Board::parse("---\nkanban-plugin: basic\n---\n## A\n- [ ] same\n- [ ] same\n");
        let j = json_of(&b);
        assert_ne!(
            j["lanes"][0]["cards"][0]["id"],
            j["lanes"][0]["cards"][1]["id"]
        );
    }

    #[test]
    fn failed_ops_leave_the_board_as_it_was() {
        let mut b = board();
        assert!(b
            .apply(&Op::MoveCard {
                card: "nope".into(),
                lane: LaneRef::Index(0),
                position: None
            })
            .is_err());
        let id = id_of(&b, "Research");
        assert!(b
            .apply(&Op::MoveCard {
                card: id,
                lane: LaneRef::Title("Nowhere".into()),
                position: None
            })
            .is_err());
        assert_eq!(b.render(), OBSIDIAN);
    }

    #[test]
    fn new_board_parses() {
        let s = new_board(&["To do", "Doing", "Done"]);
        assert!(is_board(&s));
        let b = Board::parse(&s);
        assert_eq!(b.render(), s);
        assert_eq!(json_of(&b)["counts"]["lanes"], 3);
        assert_eq!(json_of(&b)["settings"]["kanban-plugin"], "basic");
    }

    /// What the web app's "Turn into board" writes for a note with frontmatter, a loose item,
    /// two lanes, an indented sub item and a ticked item (web/src/vault/board-text.ts).
    #[test]
    fn a_note_turned_into_a_board_parses() {
        let s = "---\n\ntags: [plan]\nkanban-plugin: basic\n\n---\n\n## To do\n\n- [ ] loose item\n\n\n## Backlog\n\n- [ ] Write brief\n\t- sub point\n- [x] Old done\n- [ ] numbered\n\n\n## Ship it\n\n\n\n\n%% kanban:settings\n```\n{\"kanban-plugin\":\"basic\"}\n```\n%%\n";
        assert!(is_board(s));
        let b = Board::parse(s);
        assert_eq!(b.render(), s);
        let j = json_of(&b);
        let lanes = j["lanes"].as_array().unwrap();
        let titles: Vec<&str> = lanes.iter().map(|l| l["title"].as_str().unwrap()).collect();
        assert_eq!(titles, ["To do", "Backlog", "Ship it"]);
        assert_eq!(lanes[1]["cards"][0]["text"], "Write brief\n- sub point");
        assert_eq!(lanes[1]["cards"][1]["checked"], true);
        assert_eq!(lanes[2]["cards"].as_array().unwrap().len(), 0);
        assert_eq!(j["counts"]["cards"], 4);
        assert_eq!(j["counts"]["done"], 1);
        assert_eq!(j["settings"]["kanban-plugin"], "basic");
        // With no headings: To do, Doing, and Done (Complete) holding the ticked items.
        let s = "---\n\nkanban-plugin: basic\n\n---\n\n## To do\n\n- [ ] a\n\n\n## Doing\n\n\n\n## Done\n\n**Complete**\n- [x] b\n\n\n\n%% kanban:settings\n```\n{\"kanban-plugin\":\"basic\"}\n```\n%%\n";
        let j = json_of(&Board::parse(s));
        assert_eq!(j["lanes"][2]["complete"], true);
        assert_eq!(j["lanes"][2]["cards"][0]["text"], "b");
        assert_eq!(j["counts"]["lanes"], 3);
    }

    /// A note or board never counts itself: links, aliases, headings and embeds of itself are
    /// left out of backlinks, board references, the boards a note embeds and the link index. Two
    /// boards that embed each other each list the other once.
    #[test]
    fn nothing_refers_to_itself() {
        let d = std::env::temp_dir().join(format!("memora-kanban-self-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("Work")).unwrap();
        let me = format!("{OBSIDIAN}\n\n![[Self]] [[Self]] [[self#Doing]] [[Self|me]]\n");
        fs::write(d.join("Work/Self.md"), &me).unwrap();
        fs::write(d.join("Work/A.md"), format!("{OBSIDIAN}\n\n![[B]]\n")).unwrap();
        fs::write(d.join("Work/B.md"), format!("{OBSIDIAN}\n\n![[A]]\n")).unwrap();
        fs::write(
            d.join("Work/Note.md"),
            "# Note\n[[Note]] [[Note#x]] [[note|alias]] ![[Note]]\n",
        )
        .unwrap();
        let store = MemoryStore::new(&d);
        let g = store.kanban_get_impl("Work/Self.md", false).unwrap();
        assert_eq!(g["embedded_in"], json!([]));
        assert_eq!(g["linked_from"], json!([]));
        let n = store.read_note_impl("Work/Self.md").unwrap();
        assert_eq!(n["boards"], json!([]));
        assert_eq!(n["backlinks"], json!([]));
        let n = store.read_note_impl("Work/Note.md").unwrap();
        assert_eq!(n["backlinks"], json!([]));
        assert_eq!(n["boards"], json!([]));
        // A embeds B and B embeds A: each lists the other, once, and nothing loops.
        let a = store.kanban_get_impl("Work/A.md", false).unwrap();
        assert_eq!(a["embedded_in"], json!(["Work/B.md"]));
        assert_eq!(
            store.read_note_impl("Work/A.md").unwrap()["boards"],
            json!(["Work/B.md"])
        );
        let list = store.kanban_list_impl(None).unwrap();
        let me_row = list.iter().find(|b| b["path"] == "Work/Self.md").unwrap();
        assert_eq!(me_row["embedded_in"], json!([]));
        // The link index (graph, link tools) has no self edges.
        let idx = store.link_index();
        assert!(!idx.out.get("Self").is_some_and(|o| o.contains("Self")));
        assert!(!idx.out.get("Note").is_some_and(|o| o.contains("Note")));
        let _ = fs::remove_dir_all(&d);
    }

    /// Where a board shows up: notes that embed it, notes that only link to it, and the boards a
    /// note embeds, all from the note cache.
    #[test]
    fn boards_know_the_notes_they_are_in() {
        let d = std::env::temp_dir().join(format!("memora-kanban-refs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("Work")).unwrap();
        fs::write(d.join("Work/Board.md"), OBSIDIAN).unwrap();
        fs::write(
            d.join("Work/Plan.md"),
            "# Plan\n\n![[Board]]\n\nSee also [[Other]].\n",
        )
        .unwrap();
        fs::write(
            d.join("Work/Notes.md"),
            "# Notes\nThe [[Board|board]] says so.\n",
        )
        .unwrap();
        fs::write(d.join("Work/Other.md"), "# Other\n").unwrap();
        let store = MemoryStore::new(&d);
        let list = store.kanban_list_impl(None).unwrap();
        assert_eq!(list[0]["embedded_in"], json!(["Work/Plan.md"]));
        assert_eq!(list[0]["linked_from"], json!(["Work/Notes.md"]));
        let g = store.kanban_get_impl("Work/Board.md", false).unwrap();
        assert_eq!(g["embedded_in"], json!(["Work/Plan.md"]));
        assert_eq!(g["linked_from"], json!(["Work/Notes.md"]));
        let n = store.read_note_impl("Work/Plan.md").unwrap();
        assert_eq!(n["boards"], json!(["Work/Board.md"]));
        let n = store.read_note_impl("Work/Notes.md").unwrap();
        assert_eq!(n["boards"], json!([]));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn store_applies_ops_with_a_version_check() {
        let d = std::env::temp_dir().join(format!("memora-kanban-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("Work")).unwrap();
        fs::write(d.join("Work/Board.md"), OBSIDIAN).unwrap();
        fs::write(d.join("Work/Plain.md"), "# Plain\n- [ ] x\n").unwrap();
        let store = MemoryStore::new(&d);
        let list = store.kanban_list_impl(None).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["path"], "Work/Board.md");
        assert_eq!(list[0]["cards"], 5);
        assert!(store.kanban_list_impl(Some("Other")).unwrap().is_empty());
        // The tree marks boards, so lists can show them with their own icon.
        let tree = store.titled_tree();
        let work = &tree["Work"];
        let flag = |p: &str| work.iter().find(|n| n.path == p).unwrap().board;
        assert!(flag("Work/Board.md") && !flag("Work/Plain.md"));
        assert!(store.kanban_get_impl("Work/Plain.md", false).is_err());
        let g = store.kanban_get_impl("Work/Board", true).unwrap();
        let v = g["version"].as_str().unwrap().to_string();
        assert!(g["lanes"][1]["cards"][0]["html"]
            .as_str()
            .unwrap()
            .contains("the first chapter"));
        let id = g["lanes"][0]["cards"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let op = Op::MoveCard {
            card: id,
            lane: LaneRef::Title("In progress".into()),
            position: None,
        };
        assert!(store
            .kanban_apply_impl("Work/Board.md", Some("000000000000"), &op, false)
            .unwrap_err()
            .0
            .starts_with("board changed"));
        let r = store
            .kanban_apply_impl("Work/Board.md", Some(&v), &op, false)
            .unwrap();
        assert_eq!(r["changed"], true);
        assert_ne!(r["version"], json!(v));
        assert_eq!(r["lanes"][1]["cards"].as_array().unwrap().len(), 2);
        // The stale version is refused now.
        assert!(store
            .kanban_apply_impl("Work/Board.md", Some(&v), &op, false)
            .is_err());
        let on_disk = fs::read_to_string(d.join("Work/Board.md")).unwrap();
        assert!(on_disk.contains("%% kanban:settings"));
        assert!(on_disk.contains("\"unknown-future-key\":[1,2]"));
        let _ = fs::remove_dir_all(&d);
    }

    fn op(v: Value) -> Op {
        Op::from_json(&v).unwrap()
    }

    fn settings_text(b: &Board) -> String {
        let out = b.render();
        let i = out.find("%% kanban:settings").unwrap();
        out[i..].to_string()
    }

    #[test]
    fn settings_edits_keep_unknown_keys_and_their_order() {
        let mut b = board();
        b.apply(&op(
            json!({"type": "set_lane_color", "lane": "Backlog", "color": "#f59e0b"}),
        ))
        .unwrap();
        // Only the settings block changed; keys keep their order, ours goes last.
        let out = b.render();
        assert_eq!(
            out[..out.find("%% kanban").unwrap()],
            OBSIDIAN[..OBSIDIAN.find("%% kanban").unwrap()]
        );
        assert_eq!(
            settings_text(&b),
            "%% kanban:settings\n```\n{\"kanban-plugin\":\"basic\",\"lane-width\":272,\"archive-with-date\":false,\"unknown-future-key\":[1,2],\"memora\":{\"lanes\":{\"Backlog\":\"#f59e0b\"}}}\n```\n%%"
        );
        assert_eq!(json_of(&b)["lanes"][0]["color"], "#f59e0b");
        assert_eq!(json_of(&b)["lanes"][1]["color"], Value::Null);
        // Renaming moves the color; clearing it gives the original file back.
        b.apply(&op(
            json!({"type": "rename_lane", "lane": "Backlog", "title": "Ideas"}),
        ))
        .unwrap();
        assert_eq!(json_of(&b)["lanes"][0]["color"], "#f59e0b");
        assert!(b
            .render()
            .contains("\"memora\":{\"lanes\":{\"Ideas\":\"#f59e0b\"}}"));
        b.apply(&op(
            json!({"type": "set_lane_color", "lane": "Ideas", "color": null}),
        ))
        .unwrap();
        b.apply(&op(
            json!({"type": "rename_lane", "lane": "Ideas", "title": "Backlog"}),
        ))
        .unwrap();
        assert_eq!(b.render(), OBSIDIAN);
        // A pretty-printed block keeps its layout around the member that changed.
        let src = "---\nkanban-plugin: basic\n---\n## A\n\n%% kanban:settings\n```\n{\n  \"zeta\": 1,\n  \"kanban-plugin\": \"basic\"\n}\n```\n%%";
        let mut b = Board::parse(src);
        b.apply(&op(json!({"type": "set_board_style", "icon": "🚀"})))
            .unwrap();
        assert!(b.render().contains("{\n  \"zeta\": 1,\n  \"kanban-plugin\": \"basic\",\"memora\":{\"board\":{\"icon\":\"🚀\"}}\n}"));
        assert_eq!(json_of(&b)["style"], json!({"color": null, "icon": "🚀"}));
        b.apply(&op(json!({"type": "set_board_style", "icon": null})))
            .unwrap();
        assert_eq!(b.render(), src);
        // Broken settings JSON is refused, not overwritten.
        let mut b = Board::parse(
            "---\nkanban-plugin: basic\n---\n## A\n%% kanban:settings\n```\n{oops\n```\n%%",
        );
        assert!(b
            .apply(&op(json!({"type": "set_board_style", "color": "red"})))
            .is_err());
    }

    #[test]
    fn a_board_without_settings_gets_a_block() {
        let src = "---\nkanban-plugin: board\n---\n\n## A\n\n- [ ] one\n";
        let mut b = Board::parse(src);
        // Clearing what is not there changes nothing.
        b.apply(&op(json!({"type": "set_board_style", "color": null})))
            .unwrap();
        assert_eq!(b.render(), src);
        b.apply(&op(
            json!({"type": "set_board_style", "color": "#123456", "icon": "📋"}),
        ))
        .unwrap();
        let out = b.render();
        assert_eq!(
            out,
            "---\nkanban-plugin: board\n---\n\n## A\n\n- [ ] one\n\n%% kanban:settings\n```\n{\"kanban-plugin\":\"board\",\"memora\":{\"board\":{\"color\":\"#123456\",\"icon\":\"📋\"}}}\n```\n%%"
        );
        let again = Board::parse(&out);
        assert_eq!(again.render(), out);
        assert_eq!(json_of(&again)["style"]["color"], "#123456");
        assert_eq!(json_of(&again)["lanes"][0]["cards"][0]["text"], "one");
    }

    #[test]
    fn card_colors_use_block_ids() {
        let mut b = board();
        let id = id_of(&b, "Draft the outline");
        let r = b
            .apply(&op(
                json!({"type": "set_card_color", "card": id, "color": "#ef4444"}),
            ))
            .unwrap();
        let j = json_of(&b);
        let c = &j["lanes"][0]["cards"][1];
        let block = c["block"].as_str().unwrap().to_string();
        assert_eq!(block.len(), 6);
        assert!(block
            .bytes()
            .all(|x| x.is_ascii_digit() || x.is_ascii_lowercase()));
        assert_eq!(c["color"], "#ef4444");
        assert_eq!(c["id"], json!(r.card.unwrap()));
        assert!(b
            .render()
            .contains(&format!("- [ ] Draft the outline ^{block}\n\tSecond line")));
        assert!(b.render().contains(&format!(
            "\"memora\":{{\"cards\":{{\"{block}\":\"#ef4444\"}}}}"
        )));
        // The same card gets the same id again (deterministic).
        let mut b2 = board();
        b2.apply(&op(json!({"type": "set_card_color", "card": id_of(&b2, "Draft the outline"), "color": "red"})))
            .unwrap();
        assert_eq!(json_of(&b2)["lanes"][0]["cards"][1]["block"], json!(block));
        // A card that has a block id keeps it.
        let pid = id_of(&b, "Call the printer");
        b.apply(&op(
            json!({"type": "set_card_color", "card": pid, "color": "blue"}),
        ))
        .unwrap();
        assert_eq!(json_of(&b)["lanes"][0]["cards"][2]["block"], "ab12cd");
        assert_eq!(json_of(&b)["lanes"][0]["cards"][2]["color"], "blue");
        // Clearing removes the entry; deleting a card drops its color.
        let pid = id_of(&b, "Call the printer");
        b.apply(&op(
            json!({"type": "set_card_color", "card": pid, "color": null}),
        ))
        .unwrap();
        assert!(!b.render().contains("ab12cd\":"));
        let did = id_of(&b, "Draft the outline");
        b.apply(&op(json!({"type": "delete_card", "card": did})))
            .unwrap();
        assert!(!b.render().contains("\"memora\""));
        assert!(
            Op::from_json(&json!({"type": "set_card_color", "card": "x", "color": "url(x);"}))
                .is_err()
        );
    }

    #[test]
    fn duplicate_card_copies_below_without_the_block_id() {
        let mut b = board();
        let id = id_of(&b, "Call the printer");
        b.apply(&op(
            json!({"type": "set_card_color", "card": id, "color": "#00ff00"}),
        ))
        .unwrap();
        let id = id_of(&b, "Call the printer");
        let r = b
            .apply(&op(json!({"type": "duplicate_card", "card": id.clone()})))
            .unwrap();
        let j = json_of(&b);
        let cards = j["lanes"][0]["cards"].as_array().unwrap();
        assert_eq!(cards.len(), 4);
        assert_eq!(cards[2]["id"], json!(id), "the original keeps its id");
        assert_eq!(cards[3]["id"], json!(r.card.unwrap()));
        assert_eq!(cards[2]["block"], "ab12cd");
        assert_ne!(cards[3]["block"], "ab12cd");
        assert_eq!(cards[3]["color"], "#00ff00");
        assert!(cards[3]["text"]
            .as_str()
            .unwrap()
            .starts_with("Call the printer @{2026-02-01} @@{10:30} ^"));
        // A plain card is copied as it is, and both ids differ.
        let mut b = Board::parse("---\nkanban-plugin: basic\n---\n## A\n- [ ] same\n- [ ] next");
        let id = id_of(&b, "same");
        b.apply(&op(json!({"type": "duplicate_card", "card": id})))
            .unwrap();
        assert_eq!(
            b.render(),
            "---\nkanban-plugin: basic\n---\n## A\n- [ ] same\n- [ ] same\n- [ ] next"
        );
    }

    #[test]
    fn edit_card_fields_and_checklist() {
        let mut b = board();
        let id = id_of(&b, "Research");
        let c0 = json_of(&b)["lanes"][0]["cards"][0].clone();
        assert_eq!(
            c0["fields"],
            json!({"text": "Research options", "links": ["Atlas Project"], "tags": ["research"], "date": "2026-01-12", "time": ""})
        );
        assert_eq!(c0["checklist"], json!([]));
        assert_eq!(c0["block"], Value::Null);
        // Unchanged fields change nothing at all.
        let r = b
            .apply(&op(json!({"type": "edit_card", "card": id, "links": ["Atlas Project"], "date": "2026-01-12"})))
            .unwrap();
        assert_eq!(b.render(), OBSIDIAN);
        let id = r.card.unwrap();
        b.apply(&op(json!({"type": "edit_card", "card": id, "tags": [], "time": "09:00", "links": ["Atlas Project", "Rome"],
            "checklist": [{"text": "read", "done": false}, {"text": "compare", "done": true}], "checked": true})))
            .unwrap();
        assert!(b.render().contains(
            "- [x] Research [[Atlas Project]] options @{2026-01-12} [[Rome]] @@{09:00}\n\t- [ ] read\n\t- [x] compare\n- [ ] Draft the outline"
        ));
        let c = json_of(&b)["lanes"][0]["cards"][0].clone();
        assert_eq!(
            c["checklist"],
            json!([{"text": "read", "done": false}, {"text": "compare", "done": true}])
        );
        assert_eq!(c["fields"]["time"], "09:00");
        assert_eq!(c["fields"]["text"], "Research options");
        // The board's date format is used.
        let src = "---\nkanban-plugin: basic\n---\n## A\n- [ ] Pay\n%% kanban:settings\n```\n{\"kanban-plugin\":\"basic\",\"date-format\":\"DD/MM/YYYY\",\"date-trigger\":\"!\"}\n```\n%%";
        let mut b = Board::parse(src);
        let id = id_of(&b, "Pay");
        b.apply(&op(
            json!({"type": "edit_card", "card": id, "date": "2026-12-25", "color": "#abc"}),
        ))
        .unwrap();
        let j = json_of(&b);
        assert!(j["lanes"][0]["cards"][0]["text"]
            .as_str()
            .unwrap()
            .starts_with("Pay !{25/12/2026} ^"));
        assert_eq!(j["lanes"][0]["cards"][0]["fields"]["date"], "2026-12-25");
        assert_eq!(j["lanes"][0]["cards"][0]["color"], "#abc");
        // Adding a card with fields.
        let r = b
            .apply(&op(json!({"type": "add_card", "lane": 0, "text": "Call", "tags": ["phone"], "checklist": [{"text": "dial"}]})))
            .unwrap();
        assert!(r.card.is_some());
        assert!(b.render().contains("- [ ] Call #phone\n\t- [ ] dial\n"));
        // Fields on a card added to a Complete lane leave it checked.
        b.apply(&op(json!({"type": "add_lane", "title": "Done"})))
            .unwrap();
        let mut b = Board::parse(
            &b.render()
                .replace("## Done\n\n", "## Done\n\n**Complete**\n"),
        );
        b.apply(&op(json!({"type": "add_card", "lane": "Done", "text": "Shipped", "checked": false, "tags": ["v1"]})))
            .unwrap();
        assert!(b.render().contains("- [x] Shipped #v1\n"), "{}", b.render());
        assert!(b
            .apply(&op(json!({"type": "edit_card", "card": "x"})))
            .is_err());
    }

    #[test]
    fn lane_ops_duplicate_archive_clear_limit() {
        let mut b = board();
        b.apply(&op(
            json!({"type": "set_lane_color", "lane": "Backlog", "color": "green"}),
        ))
        .unwrap();
        let id = id_of(&b, "Call the printer");
        b.apply(&op(
            json!({"type": "set_card_color", "card": id, "color": "red"}),
        ))
        .unwrap();
        b.apply(&op(
            json!({"type": "duplicate_lane", "lane": "Backlog", "title": "Backlog copy"}),
        ))
        .unwrap();
        let j = json_of(&b);
        let titles: Vec<&str> = j["lanes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| l["title"].as_str().unwrap())
            .collect();
        assert_eq!(
            titles,
            [
                "Backlog",
                "Backlog copy",
                "In progress",
                "Empty lane",
                "Done"
            ]
        );
        assert_eq!(j["lanes"][1]["max_items"], 5);
        assert_eq!(j["lanes"][1]["color"], "green");
        assert_eq!(j["lanes"][1]["cards"].as_array().unwrap().len(), 3);
        assert_ne!(
            j["lanes"][1]["cards"][2]["block"],
            j["lanes"][0]["cards"][2]["block"]
        );
        assert_eq!(j["lanes"][1]["cards"][2]["color"], "red");
        let again = Board::parse(&b.render());
        assert_eq!(
            json_of(&again)["lanes"][1]["cards"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        // The same name when no title is given.
        b.apply(&op(
            json!({"type": "duplicate_lane", "lane": "In progress"}),
        ))
        .unwrap();
        assert_eq!(json_of(&b)["lanes"][3]["title"], "In progress");
        // Limits.
        b.apply(&op(
            json!({"type": "set_lane_limit", "lane": "Backlog copy", "max": 0}),
        ))
        .unwrap();
        assert!(b.render().contains("## Backlog copy\n"));
        b.apply(&op(
            json!({"type": "set_lane_limit", "lane": "In progress", "max": 2}),
        ))
        .unwrap();
        assert!(b.render().contains("## In progress (2)\n"));
        assert_eq!(json_of(&b)["lanes"][2]["max_items"], 2);
        // Archive a whole lane, in order; clear another.
        b.apply(&op(
            json!({"type": "archive_lane_cards", "lane": "Backlog copy"}),
        ))
        .unwrap();
        let j = json_of(&b);
        assert_eq!(j["lanes"][1]["cards"].as_array().unwrap().len(), 0);
        let arch: Vec<&str> = j["archive"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["title"].as_str().unwrap())
            .collect();
        assert_eq!(
            arch[1..3],
            [
                "Research [[Atlas Project]] options #research @{2026-01-12}",
                "Draft the outline"
            ][..]
        );
        assert_eq!(arch.len(), 4);
        b.apply(&op(json!({"type": "clear_lane", "lane": "Backlog"})))
            .unwrap();
        let j = json_of(&b);
        assert_eq!(j["lanes"][0]["cards"].as_array().unwrap().len(), 0);
        // The lane's red card is gone; the archived copy keeps its color.
        assert_eq!(j["archive"][3]["color"], "red");
        b.apply(&op(json!({"type": "delete_lane", "lane": "Backlog copy"})))
            .unwrap();
        assert_eq!(json_of(&b)["lanes"][0]["color"], "green");
        b.apply(&op(json!({"type": "delete_lane", "lane": "Backlog"})))
            .unwrap();
        assert!(!b.render().contains("\"lanes\""));
        let reparsed = Board::parse(&b.render());
        assert_eq!(reparsed.render(), b.render());
    }

    #[test]
    fn tag_colors_and_settings() {
        let mut b = board();
        b.apply(&op(json!({"type": "set_tag_color", "tag": "#research", "color": "#fff", "background": "#000"})))
            .unwrap();
        assert!(settings_text(&b).contains(",\"tag-colors\":[{\"tagKey\":\"#research\",\"color\":\"#fff\",\"backgroundColor\":\"#000\"}]}"));
        b.apply(&op(
            json!({"type": "set_tag_color", "tag": "writing", "color": "red"}),
        ))
        .unwrap();
        b.apply(&op(
            json!({"type": "set_tag_color", "tag": "research", "color": "#eee"}),
        ))
        .unwrap();
        let j = json_of(&b);
        assert_eq!(
            j["tag_colors"],
            json!({"research": {"color": "#eee", "background": "#000"}, "writing": {"color": "red", "background": null}})
        );
        b.apply(&op(
            json!({"type": "set_tag_color", "tag": "research", "color": null}),
        ))
        .unwrap();
        b.apply(&op(
            json!({"type": "set_tag_color", "tag": "writing", "color": null}),
        ))
        .unwrap();
        assert_eq!(b.render(), OBSIDIAN);
        // Whitelisted Obsidian settings: set, keep order, remove.
        b.apply(&op(json!({"type": "set_settings", "settings": {"lane-width": 300, "date-colors": [{"isToday": true, "color": "#f00"}], "unknown-future-key": null}})))
            .unwrap_err();
        b.apply(&op(json!({"type": "set_settings", "settings": {"lane-width": 300, "date-colors": [{"isToday": true, "color": "#f00"}]}})))
            .unwrap();
        assert!(settings_text(&b).contains("{\"kanban-plugin\":\"basic\",\"lane-width\":300,\"archive-with-date\":false,\"unknown-future-key\":[1,2],\"date-colors\":[{\"color\":\"#f00\",\"isToday\":true}]}"));
        assert!(b
            .apply(&op(
                json!({"type": "set_settings", "settings": {"lane-width": "wide"}})
            ))
            .is_err());
        assert!(b
            .apply(&op(
                json!({"type": "set_settings", "settings": {"memora": {}}})
            ))
            .is_err());
        b.apply(&op(
            json!({"type": "set_settings", "settings": {"lane-width": 272, "date-colors": null}}),
        ))
        .unwrap();
        assert_eq!(b.render(), OBSIDIAN);
    }

    #[test]
    fn notes_turn_into_boards_like_the_web() {
        let en = default_lanes(None).unwrap();
        let note = "---\ntags: [plan]\n---\n# Plan\n\n- [ ] loose item\n\n## Backlog\n\n- Write brief\n  - sub point\n- [x] Old done\n1. numbered\n\nA paragraph\n\n```\ncode\n```\n\n## Ship it\n";
        let c = to_board(note, "Plan", &en);
        assert_eq!(c.text, "---\n\ntags: [plan]\nkanban-plugin: basic\n\n---\n\n## To do\n\n- [ ] loose item\n\n\n## Backlog\n\n- [ ] Write brief\n\t- sub point\n- [x] Old done\n- [ ] numbered\n\n\n## Ship it\n\n\n\n\n%% kanban:settings\n```\n{\"kanban-plugin\":\"basic\"}\n```\n%%\n");
        assert_eq!((c.lanes, c.cards, c.dropped), (3, 4, 2));
        let c = to_board(
            "- [ ] a\n- [x] b\n",
            "",
            &default_lanes(Some(&["Offen".into(), "".into(), "Fertig".into()])).unwrap(),
        );
        assert_eq!(c.text, "---\n\nkanban-plugin: basic\n\n---\n\n## Offen\n\n- [ ] a\n\n\n## Doing\n\n\n\n## Fertig\n\n**Complete**\n- [x] b\n\n\n\n%% kanban:settings\n```\n{\"kanban-plugin\":\"basic\"}\n```\n%%\n");
        assert!(is_board(&c.text));
        assert_eq!(Board::parse(&c.text).render(), c.text);
        let d = default_board(&en);
        assert!(d.contains("## Done\n\n**Complete**\n"));
        assert_eq!(json_of(&Board::parse(&d))["counts"]["lanes"], 3);
    }
}
