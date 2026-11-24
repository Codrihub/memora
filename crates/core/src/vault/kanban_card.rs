//! A card's text as fields, and back, in the Obsidian Kanban syntax (a port of the web app's
//! `web/src/views/card-text.ts`): linked notes are `[[Note]]`, tags `#tag`, the due date
//! `@{2026-01-31}` and its time `@@{10:30}` (the triggers and formats follow the board's
//! settings `date-trigger`, `time-trigger`, `date-format`, `time-format`). Reading a card takes
//! those pieces out of the text and remembers where each was; writing puts every one that is
//! still there back in its place and adds new ones at the end of the first line, so text
//! nobody changed comes back byte for byte.
//!
//! On top of that, a card's checklist: the continuation lines that are `- [ ] step` /
//! `- [x] step` items. [`edit_raw`] changes a card's raw lines (its free text, fields and
//! checklist) and leaves every line it does not need to touch as it was.

use super::{dedent, split_marker};
use crate::vault::{err, MResult, MemoryErr};
use regex::Regex;
use serde_json::{json, Value};

/// The fields of a card's free text.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CardFields {
    /// The text without the pieces below.
    pub text: String,
    /// Link targets as written between the brackets (`Note`, `Folder/Note`, `Note|shown`).
    pub links: Vec<String>,
    /// Tags without `#`.
    pub tags: Vec<String>,
    /// `YYYY-MM-DD`, or ''.
    pub date: String,
    /// `HH:mm`, or ''.
    pub time: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    Link,
    Tag,
    Date,
    Time,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Sep {
    Before,
    After,
    None,
}

#[derive(Debug, Clone, PartialEq)]
struct Piece {
    kind: Kind,
    value: String,
    raw: String,
    /// Byte offset in the text without the pieces.
    at: usize,
    sep: Sep,
}

/// A card's text taken apart: the fields and where each piece was.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedCard {
    pub fields: CardFields,
    pieces: Vec<Piece>,
}

/// One checklist item of a card.
#[derive(Debug, Clone, PartialEq)]
pub struct CheckItem {
    pub text: String,
    pub done: bool,
}

/// A moment-style date format (YYYY, YY, MM, M, DD, D and separators).
struct DateCodec {
    parts: Vec<String>,
    re: Regex,
}

impl DateCodec {
    fn new(fmt: &str) -> DateCodec {
        let mut parts: Vec<String> = static_re!(r"YYYY|YY|MM|M|DD|D|[^YMD]+")
            .find_iter(fmt)
            .map(|m| m.as_str().to_string())
            .collect();
        if parts.is_empty() {
            parts = ["YYYY", "-", "MM", "-", "DD"].map(String::from).to_vec();
        }
        let re: String = parts
            .iter()
            .map(|p| match p.as_str() {
                "YYYY" => r"(\d{4})".to_string(),
                "YY" | "MM" | "DD" => r"(\d{2})".to_string(),
                "M" | "D" => r"(\d{1,2})".to_string(),
                other => regex::escape(other),
            })
            .collect();
        let re = Regex::new(&format!("^{re}$")).unwrap_or_else(|_| {
            Regex::new(r"^(\d{4})-(\d{2})-(\d{2})$").expect("the default date pattern")
        });
        DateCodec { parts, re }
    }

    fn read(&self, s: &str) -> Option<String> {
        let m = self.re.captures(s)?;
        let (mut y, mut mo, mut d) = (String::new(), String::new(), String::new());
        let order = self
            .parts
            .iter()
            .filter(|p| matches!(p.as_str(), "YYYY" | "YY" | "MM" | "M" | "DD" | "D"));
        for (i, p) in order.enumerate() {
            let v = m.get(i + 1)?.as_str();
            match p.as_str() {
                "YYYY" => y = v.to_string(),
                "YY" => y = format!("20{v}"),
                "MM" | "M" => mo = format!("{v:0>2}"),
                _ => d = format!("{v:0>2}"),
            }
        }
        if y.is_empty() || mo.is_empty() || d.is_empty() {
            return None;
        }
        if mo.parse::<u32>().ok()? > 12 || d.parse::<u32>().ok()? > 31 {
            return None;
        }
        Some(format!("{y}-{mo}-{d}"))
    }

    fn write(&self, iso: &str) -> String {
        let mut it = iso.split('-');
        let y = it.next().unwrap_or("");
        let mo = it.next().unwrap_or("");
        let d = it.next().unwrap_or("");
        let num = |s: &str| s.parse::<u32>().map(|n| n.to_string()).unwrap_or_default();
        self.parts
            .iter()
            .map(|p| match p.as_str() {
                "YYYY" => y.to_string(),
                "YY" => y.get(2..).unwrap_or("").to_string(),
                "MM" => mo.to_string(),
                "M" => num(mo),
                "DD" => d.to_string(),
                "D" => num(d),
                other => other.to_string(),
            })
            .collect()
    }
}

/// The board settings that shape a card's pieces, ready to read and write cards.
pub struct CardCodec {
    dt: String,
    tt: String,
    date: DateCodec,
    short_time: bool,
    re: Regex,
}

fn setting<'a>(s: &'a Value, k: &str, d: &'a str) -> &'a str {
    match s.get(k).and_then(|v| v.as_str()) {
        Some(v) if !v.is_empty() => v,
        _ => d,
    }
}

impl CardCodec {
    /// The codec for a board's settings (the JSON of `%% kanban:settings`, or null).
    pub fn new(settings: &Value) -> CardCodec {
        let dt = setting(settings, "date-trigger", "@").to_string();
        let tt = setting(settings, "time-trigger", "@@").to_string();
        let date = DateCodec::new(setting(settings, "date-format", "YYYY-MM-DD"));
        let short_time = setting(settings, "time-format", "HH:mm") == "H:mm";
        // The time trigger is often the date trigger doubled: try it first. The web's
        // look-behinds (`(?<!!)` before a link, `(?<=^|\s)` before a tag) are checked by hand.
        let re = Regex::new(&format!(
            r"{}\{{([^}}\n]+)\}}|{}\{{([^}}\n]+)\}}|\[\[([^\]\n]+)\]\]|#([\p{{L}}\p{{N}}_][\p{{L}}\p{{N}}_/-]*)",
            regex::escape(&tt),
            regex::escape(&dt)
        ))
        .expect("the card pattern");
        CardCodec {
            dt,
            tt,
            date,
            short_time,
            re,
        }
    }

    fn read_time(&self, s: &str) -> Option<String> {
        let m = static_re!(r"^(\d{1,2}):(\d{2})$").captures(s)?;
        let h: u32 = m[1].parse().ok()?;
        let mi: u32 = m[2].parse().ok()?;
        if h > 23 || mi > 59 {
            return None;
        }
        Some(format!("{:0>2}:{}", &m[1], &m[2]))
    }

    fn write_time(&self, hm: &str) -> String {
        if self.short_time {
            if let Some(rest) = hm.strip_prefix('0') {
                if rest.starts_with(|c: char| c.is_ascii_digit()) {
                    return rest.to_string();
                }
            }
        }
        hm.to_string()
    }

    fn date_raw(&self, iso: &str) -> String {
        format!("{}{{{}}}", self.dt, self.date.write(iso))
    }

    fn time_raw(&self, hm: &str) -> String {
        format!("{}{{{}}}", self.tt, self.write_time(hm))
    }

    /// Take a card's text apart into fields.
    pub fn parse(&self, text: &str) -> ParsedCard {
        struct Found {
            kind: Kind,
            value: String,
            s: usize,
            e: usize,
        }
        let mut found: Vec<Found> = Vec::new();
        let (mut date, mut time) = (String::new(), String::new());
        let mut pos = 0;
        while pos <= text.len() {
            let Some(m) = self.re.captures_at(text, pos) else {
                break;
            };
            let whole = m.get(0).expect("group 0");
            let (s, e) = (whole.start(), whole.end());
            let prev = text[..s].chars().next_back();
            let rejected = (m.get(3).is_some() && prev == Some('!'))
                || (m.get(4).is_some() && prev.is_some_and(|c| !c.is_whitespace()));
            if rejected {
                // As a look-behind would: try again from the next character.
                pos = s + text[s..].chars().next().map_or(1, char::len_utf8);
                continue;
            }
            if let Some(g) = m.get(1) {
                if let Some(v) = self.read_time(g.as_str().trim()) {
                    if time.is_empty() {
                        time = v.clone();
                        found.push(Found {
                            kind: Kind::Time,
                            value: v,
                            s,
                            e,
                        });
                    }
                }
            } else if let Some(g) = m.get(2) {
                if let Some(v) = self.date.read(g.as_str().trim()) {
                    if date.is_empty() {
                        date = v.clone();
                        found.push(Found {
                            kind: Kind::Date,
                            value: v,
                            s,
                            e,
                        });
                    }
                }
            } else if let Some(g) = m.get(3) {
                found.push(Found {
                    kind: Kind::Link,
                    value: g.as_str().to_string(),
                    s,
                    e,
                });
            } else if let Some(g) = m.get(4) {
                found.push(Found {
                    kind: Kind::Tag,
                    value: g.as_str().to_string(),
                    s,
                    e,
                });
            }
            pos = if e > s { e } else { e + 1 };
        }
        let b = text.as_bytes();
        let mut pieces = Vec::new();
        let mut out = String::new();
        let mut from = 0;
        for f in found {
            let (mut s, mut e) = (f.s, f.e);
            let mut sep = Sep::None;
            // Take one space with it, so the text does not keep a double space.
            if s > from && b[s - 1] == b' ' {
                s -= 1;
                sep = Sep::Before;
            } else if b.get(e) == Some(&b' ') {
                e += 1;
                sep = Sep::After;
            }
            out.push_str(&text[from..s]);
            pieces.push(Piece {
                kind: f.kind,
                value: f.value,
                raw: text[f.s..f.e].to_string(),
                at: out.len(),
                sep,
            });
            from = e;
        }
        out.push_str(&text[from..]);
        let uniq = |k: Kind| {
            let mut v: Vec<String> = Vec::new();
            for p in pieces.iter().filter(|p| p.kind == k) {
                if !v.contains(&p.value) {
                    v.push(p.value.clone());
                }
            }
            v
        };
        ParsedCard {
            fields: CardFields {
                text: out,
                links: uniq(Kind::Link),
                tags: uniq(Kind::Tag),
                date,
                time,
            },
            pieces,
        }
    }

    /// Put a card's text back together from edited fields.
    pub fn write(&self, parsed: &ParsedCard, edited: &CardFields) -> String {
        let before = &parsed.fields;
        let keep = |p: &Piece| match p.kind {
            Kind::Link => edited.links.contains(&p.value),
            Kind::Tag => edited.tags.contains(&p.value),
            Kind::Date => !edited.date.is_empty(),
            Kind::Time => !edited.time.is_empty(),
        };
        let raw_of = |p: &Piece| -> String {
            if p.kind == Kind::Date && edited.date != before.date {
                return self.date_raw(&edited.date);
            }
            if p.kind == Kind::Time && edited.time != before.time {
                return self.time_raw(&edited.time);
            }
            p.raw.clone()
        };
        let text = &edited.text;
        let mut kept: Vec<(usize, usize, &Piece)> = parsed
            .pieces
            .iter()
            .filter(|p| keep(p))
            .enumerate()
            .map(|(i, p)| (i, move_at(&before.text, text, p.at).min(text.len()), p))
            .collect();
        // From the end, so earlier offsets stay right; pieces at one spot go back in order.
        kept.sort_by(|x, y| y.1.cmp(&x.1).then(y.0.cmp(&x.0)));
        let mut out = text.clone();
        for (_, at, p) in kept {
            let raw = raw_of(p);
            let piece = match p.sep {
                Sep::Before => format!(" {raw}"),
                Sep::After => format!("{raw} "),
                Sep::None => raw,
            };
            out.insert_str(at, &piece);
        }
        // New pieces go at the end of the first line, the way Obsidian Kanban adds them.
        let had = |k: Kind, v: &str| parsed.pieces.iter().any(|p| p.kind == k && p.value == v);
        let mut add: Vec<String> = Vec::new();
        for l in &edited.links {
            if !had(Kind::Link, l) {
                add.push(format!("[[{l}]]"));
            }
        }
        for t in &edited.tags {
            if !had(Kind::Tag, t) {
                add.push(format!("#{t}"));
            }
        }
        if !edited.date.is_empty() && !parsed.pieces.iter().any(|p| p.kind == Kind::Date) {
            add.push(self.date_raw(&edited.date));
        }
        if !edited.time.is_empty() && !parsed.pieces.iter().any(|p| p.kind == Kind::Time) {
            add.push(self.time_raw(&edited.time));
        }
        if !add.is_empty() {
            let (head, rest) = match out.find('\n') {
                Some(i) => out.split_at(i),
                None => (out.as_str(), ""),
            };
            let sep = if !head.is_empty() && !head.ends_with(char::is_whitespace) {
                " "
            } else {
                ""
            };
            out = format!("{head}{sep}{}{rest}", add.join(" "));
        }
        out
    }
}

/// Where an offset in `a` lands after `a` was edited into `b` (one edited stretch).
fn move_at(a: &str, b: &str, at: usize) -> usize {
    if a == b {
        return at;
    }
    let (ab, bb) = (a.as_bytes(), b.as_bytes());
    let mut p = 0;
    while p < ab.len() && p < bb.len() && ab[p] == bb[p] {
        p += 1;
    }
    while !(a.is_char_boundary(p) && b.is_char_boundary(p)) {
        p -= 1;
    }
    let mut q = 0;
    while q < ab.len() - p && q < bb.len() - p && ab[ab.len() - 1 - q] == bb[bb.len() - 1 - q] {
        q += 1;
    }
    while !(a.is_char_boundary(a.len() - q) && b.is_char_boundary(b.len() - q)) {
        q -= 1;
    }
    if at <= p {
        return at;
    }
    if at >= a.len() - q {
        return at + b.len() - a.len();
    }
    b.len() - q
}

// ---------------------------------------------------------------------------
// Checklist and block ids on a card's raw lines
// ---------------------------------------------------------------------------

/// `- [ ] step` / `- [x] step` (any list marker): `(marker, done, text)`.
fn item_of(line: &str) -> Option<(char, bool, &str)> {
    let c = static_re!(r"^([-*+])[ \t]+\[([ xX])\](?:[ \t]+(.*))?$").captures(line)?;
    let marker = c[1].chars().next()?;
    let done = &c[2] != " ";
    let text = c.get(3).map_or("", |m| m.as_str());
    Some((marker, done, text))
}

/// ` ^abc123` at the end of a line: its length in bytes and the id.
fn block_suffix(line: &str) -> Option<(usize, &str)> {
    let c = static_re!(r"[ \t]+\^([A-Za-z0-9-]+)$").captures(line)?;
    let m = c.get(0)?;
    Some((line.len() - m.start(), c.get(1)?.as_str()))
}

fn body(line: &str) -> &str {
    line.trim_end_matches(['\r', '\n'])
}

/// One line of a card: its raw text and where it starts.
struct Line<'a> {
    raw: &'a str,
    /// The text after the marker (first line) or the indentation (other lines), trimmed at
    /// the end.
    text: &'a str,
    /// The checklist item it is, for continuation lines.
    item: Option<(char, bool, &'a str)>,
}

fn lines_of(raw: &str) -> Vec<Line<'_>> {
    raw.split_inclusive('\n')
        .enumerate()
        .map(|(i, l)| {
            let b = body(l);
            if i == 0 {
                let (_, rest) = split_marker(b);
                Line {
                    raw: l,
                    text: rest.trim_end(),
                    item: None,
                }
            } else {
                let t = dedent(b).trim_end();
                Line {
                    raw: l,
                    text: t,
                    item: item_of(t.trim_start()),
                }
            }
        })
        .collect()
}

/// The card's Obsidian block id (`^abc123` at the end of its first or last line), without `^`.
pub fn block_id(raw: &str) -> Option<String> {
    let lines = lines_of(raw);
    let first = lines.first()?;
    if let Some((_, id)) = block_suffix(first.text) {
        return Some(id.to_string());
    }
    let last = lines.iter().rev().find(|l| !l.text.trim().is_empty())?;
    block_suffix(last.text).map(|(_, id)| id.to_string())
}

/// The card with its block id removed (from the first or the last line).
pub fn strip_block_id(raw: &str) -> String {
    let lines = lines_of(raw);
    let Some(first) = lines.first() else {
        return raw.to_string();
    };
    let cut = |l: &Line, n: usize| {
        let b = body(l.raw);
        format!("{}{}", &b[..b.trim_end().len() - n], &l.raw[b.len()..])
    };
    if let Some((n, _)) = block_suffix(first.text) {
        let mut out = cut(first, n);
        for l in &lines[1..] {
            out.push_str(l.raw);
        }
        return out;
    }
    if let Some(at) = lines.iter().rposition(|l| !l.text.trim().is_empty()) {
        if let Some((n, _)) = block_suffix(lines[at].text) {
            let mut out = String::new();
            for (i, l) in lines.iter().enumerate() {
                if i == at {
                    out.push_str(&cut(l, n));
                } else {
                    out.push_str(l.raw);
                }
            }
            return out;
        }
    }
    raw.to_string()
}

/// The card with ` ^id` at the end of its first line.
pub fn add_block_id(raw: &str, id: &str) -> String {
    let first_end = raw.find('\n').map_or(raw.len(), |i| i + 1);
    let first = &raw[..first_end];
    let b = body(first).trim_end();
    format!(
        "{b} ^{id}{}{}",
        &first[body(first).len()..],
        &raw[first_end..]
    )
}

/// The checklist of a card: its continuation lines that are `- [ ]` / `- [x]` items.
pub fn checklist(raw: &str) -> Vec<CheckItem> {
    lines_of(raw)
        .iter()
        .filter_map(|l| l.item)
        .map(|(_, done, text)| CheckItem {
            text: text.trim().to_string(),
            done,
        })
        .collect()
}

/// The card's free text: its text without the checklist lines and without a block id at
/// the end of the first line.
pub fn free_text(raw: &str) -> String {
    let lines = lines_of(raw);
    let mut out: Vec<&str> = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        if i == 0 {
            out.push(match block_suffix(l.text) {
                Some((n, _)) => &l.text[..l.text.len() - n],
                None => l.text,
            });
        } else if l.item.is_none() {
            out.push(l.text);
        }
    }
    out.join("\n").trim_end().to_string()
}

/// `{text, links, tags, date, time}` of a card, read with the board's codec.
pub fn fields_json(codec: &CardCodec, raw: &str) -> Value {
    let f = codec.parse(&free_text(raw)).fields;
    json!({"text": f.text, "links": f.links, "tags": f.tags, "date": f.date, "time": f.time})
}

/// What a structured card edit changes; `None` leaves that part as it is.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CardEdit {
    /// The free text (the card's text without the pieces below and the checklist).
    pub text: Option<String>,
    pub links: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    /// `YYYY-MM-DD`, or "" to clear.
    pub date: Option<String>,
    /// `HH:mm`, or "" to clear.
    pub time: Option<String>,
    pub checklist: Option<Vec<CheckItem>>,
    /// A color, or `Some(None)` to clear it.
    pub color: Option<Option<String>>,
    pub checked: Option<bool>,
}

impl CardEdit {
    /// The fields of a JSON object (`text`, `links`, `tags`, `date`, `time`, `checklist`,
    /// `color`, `checked`), checked. `with_text` (an edit of an existing card) reads `text`
    /// and `checked` too.
    pub fn from_json(v: &Value, with_text: bool) -> MResult<CardEdit> {
        let list = |k: &str| -> MResult<Option<Vec<String>>> {
            match v.get(k) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::Array(a)) => a
                    .iter()
                    .map(|x| {
                        x.as_str()
                            .map(str::to_string)
                            .ok_or_else(|| MemoryErr(format!("{k} must be a list of strings")))
                    })
                    .collect::<MResult<Vec<_>>>()
                    .map(Some),
                Some(_) => err(format!("{k} must be a list of strings")),
            }
        };
        let s = |k: &str| -> MResult<Option<String>> {
            match v.get(k) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::String(x)) => Ok(Some(x.clone())),
                Some(_) => err(format!("{k} must be a string")),
            }
        };
        let links = list("links")?
            .map(|l| l.iter().map(|x| clean_link(x)).collect::<MResult<Vec<_>>>())
            .transpose()?;
        let tags = list("tags")?
            .map(|l| l.iter().map(|x| clean_tag(x)).collect::<MResult<Vec<_>>>())
            .transpose()?;
        let date = s("date")?
            .map(|d| {
                let d = d.trim().to_string();
                if d.is_empty() || valid_date(&d) {
                    Ok(d)
                } else {
                    err(format!(
                        "date must be YYYY-MM-DD, or \"\" to clear (got {d:?})"
                    ))
                }
            })
            .transpose()?;
        let time = s("time")?
            .map(|t| {
                let t = t.trim().to_string();
                if t.is_empty() {
                    return Ok(t);
                }
                CardCodec::new(&Value::Null).read_time(&t).ok_or_else(|| {
                    MemoryErr(format!("time must be HH:mm, or \"\" to clear (got {t:?})"))
                })
            })
            .transpose()?;
        let checklist = match v.get("checklist") {
            None | Some(Value::Null) => None,
            Some(Value::Array(a)) => Some(
                a.iter()
                    .map(|x| {
                        let text = x
                            .get("text")
                            .and_then(|t| t.as_str())
                            .or_else(|| x.as_str())
                            .ok_or_else(|| {
                                MemoryErr("checklist items are {text, done}".to_string())
                            })?;
                        Ok(CheckItem {
                            text: clean_item(text)?,
                            done: x.get("done").and_then(|d| d.as_bool()).unwrap_or(false),
                        })
                    })
                    .collect::<MResult<Vec<_>>>()?,
            ),
            Some(_) => return err("checklist must be a list of {text, done}"),
        };
        let color = match v.get("color") {
            None => None,
            Some(c) => Some(clean_color(c)?),
        };
        Ok(CardEdit {
            text: if with_text { s("text")? } else { None },
            links,
            tags,
            date,
            time,
            checklist,
            color,
            // A new card's `checked` is the add's own (a Complete lane checks it).
            checked: if with_text {
                v.get("checked").and_then(|c| c.as_bool())
            } else {
                None
            },
        })
    }

    /// Whether the edit changes the card's text (anything but color and checked).
    pub fn touches_text(&self) -> bool {
        self.text.is_some()
            || self.links.is_some()
            || self.tags.is_some()
            || self.date.is_some()
            || self.time.is_some()
            || self.checklist.is_some()
    }

    pub fn is_empty(&self) -> bool {
        !self.touches_text() && self.color.is_none() && self.checked.is_none()
    }
}

fn valid_date(d: &str) -> bool {
    let Some(c) = static_re!(r"^(\d{4})-(\d{2})-(\d{2})$").captures(d) else {
        return false;
    };
    let m: u32 = c[2].parse().unwrap_or(0);
    let day: u32 = c[3].parse().unwrap_or(0);
    (1..=12).contains(&m) && (1..=31).contains(&day)
}

fn clean_link(l: &str) -> MResult<String> {
    let t = l
        .trim()
        .trim_start_matches("[[")
        .trim_end_matches("]]")
        .trim();
    if t.is_empty() || t.contains(['\n', '\r', '[', ']']) {
        return err(format!("a link is a note name or path (got {l:?})"));
    }
    Ok(t.to_string())
}

fn clean_tag(t: &str) -> MResult<String> {
    let x = t.trim().trim_start_matches('#');
    if !static_re!(r"^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$").is_match(x) {
        return err(format!("a tag is letters, digits and _ / - (got {t:?})"));
    }
    Ok(x.to_string())
}

fn clean_item(t: &str) -> MResult<String> {
    let x = t.trim();
    if x.is_empty() {
        return err("a checklist item needs some text");
    }
    if x.chars().any(char::is_control) {
        return err("a checklist item is one line of text");
    }
    if x.chars().count() > super::MAX_LANE * 5 {
        return err("a checklist item is too long");
    }
    Ok(x.to_string())
}

/// A color from a caller: `null` or "" clears it; otherwise a CSS color (`#rgb`, `#rrggbb`,
/// a name, `rgb(...)`, `var(--x)`), at most 40 characters.
pub fn clean_color(v: &Value) -> MResult<Option<String>> {
    match v {
        Value::Null => Ok(None),
        Value::String(s) if s.trim().is_empty() => Ok(None),
        Value::String(s) => {
            let t = s.trim();
            if t.chars().count() > 40 || !static_re!(r"^[A-Za-z0-9#(),.%\- ]+$").is_match(t) {
                return err(format!(
                    "color must be a CSS color such as #f59e0b or a color name (got {s:?})"
                ));
            }
            Ok(Some(t.to_string()))
        }
        _ => err("color must be a string, or null to clear it"),
    }
}

/// The card with its free text, fields and checklist changed by `edit` (color and checked
/// are left to the caller). Lines the edit does not change stay byte for byte.
pub fn edit_raw(raw: &str, edit: &CardEdit, codec: &CardCodec, nl: &str) -> MResult<String> {
    if !edit.touches_text() {
        return Ok(raw.to_string());
    }
    let lines = lines_of(raw);
    if lines.is_empty() {
        return err("not a card");
    }
    // Indentation for new lines: the card's own, else a tab.
    let default_indent = lines
        .iter()
        .skip(1)
        .find(|l| !l.raw.trim().is_empty())
        .map(|l| {
            let b = body(l.raw);
            let n = b.len() - b.trim_start().len();
            b[..n.min(4)].to_string()
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "\t".to_string());
    let first = &lines[0];
    let first_body = body(first.raw);
    let prefix = &first_body[..first_body.len() - split_marker(first_body).1.len()];
    let first_trail = &split_marker(first_body).1[first.text.len()..];
    let (block, t0) = match block_suffix(first.text) {
        Some((n, _)) => (
            &first.text[first.text.len() - n..],
            &first.text[..first.text.len() - n],
        ),
        None => ("", first.text),
    };
    // Slots: the card's lines in order, free text or checklist item.
    let mut free_idx: Vec<usize> = Vec::new();
    let mut item_idx: Vec<usize> = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        if i > 0 && l.item.is_some() {
            item_idx.push(i);
        } else {
            free_idx.push(i);
        }
    }
    let old_free: Vec<&str> = free_idx
        .iter()
        .map(|&i| if i == 0 { t0 } else { lines[i].text })
        .collect();
    let free = old_free.join("\n");
    let new_free: String = {
        let fields_given = edit.links.is_some()
            || edit.tags.is_some()
            || edit.date.is_some()
            || edit.time.is_some();
        if edit.text.is_none() && !fields_given {
            free.clone()
        } else {
            let parsed = codec.parse(&free);
            let mut f = parsed.fields.clone();
            if let Some(t) = &edit.text {
                let t = t.replace("\r\n", "\n").replace('\r', "\n");
                if t.chars().any(|c| c.is_control() && c != '\n' && c != '\t') {
                    return err("text has control characters");
                }
                f.text = t.trim().to_string();
            }
            if let Some(l) = &edit.links {
                f.links = l.clone();
            }
            if let Some(t) = &edit.tags {
                f.tags = t.clone();
            }
            if let Some(d) = &edit.date {
                f.date = d.clone();
            }
            if let Some(t) = &edit.time {
                f.time = t.clone();
            }
            if f == parsed.fields {
                free.clone()
            } else {
                codec.write(&parsed, &f)
            }
        }
    };
    let new_lines: Vec<&str> = new_free.split('\n').collect();
    if new_lines[0].trim().is_empty() && block.is_empty() {
        return err("text is empty: a card needs a first line");
    }
    let items: Vec<CheckItem> = match &edit.checklist {
        Some(c) => c.clone(),
        None => item_idx
            .iter()
            .filter_map(|&i| lines[i].item)
            .map(|(_, done, text)| CheckItem {
                text: text.trim().to_string(),
                done,
            })
            .collect(),
    };
    // Lines out: (body, ending it had, if any).
    let mut out: Vec<(String, Option<&str>)> = Vec::new();
    fn ending_of<'a>(l: &Line<'a>) -> Option<&'a str> {
        let e = &l.raw[body(l.raw).len()..];
        (!e.is_empty()).then_some(e)
    }
    let extra_free = |out: &mut Vec<(String, Option<&str>)>| {
        for t in new_lines.iter().skip(free_idx.len()) {
            out.push((
                if t.is_empty() {
                    String::new()
                } else {
                    format!("{default_indent}{t}")
                },
                None,
            ));
        }
    };
    let item_indent = item_idx
        .last()
        .map(|&i| {
            let b = body(lines[i].raw);
            b[..b.len() - b.trim_start().len()].to_string()
        })
        .unwrap_or_else(|| default_indent.clone());
    let extra_items = |out: &mut Vec<(String, Option<&str>)>| {
        for it in items.iter().skip(item_idx.len()) {
            let c = if it.done { 'x' } else { ' ' };
            out.push((format!("{item_indent}- [{c}] {}", it.text), None));
        }
    };
    for (i, l) in lines.iter().enumerate() {
        if let Some(k) = free_idx.iter().position(|&x| x == i) {
            if let Some(t) = new_lines.get(k) {
                let line = if *t == old_free[k] {
                    body(l.raw).to_string()
                } else if k == 0 {
                    format!("{prefix}{t}{block}{first_trail}")
                } else if t.is_empty() {
                    String::new()
                } else {
                    let b = body(l.raw);
                    let ind = &b[..b.len() - b.trim_start().len()];
                    let ind = if ind.is_empty() {
                        default_indent.as_str()
                    } else {
                        ind
                    };
                    format!("{ind}{t}")
                };
                out.push((line, ending_of(l)));
            }
            if k + 1 == free_idx.len() {
                extra_free(&mut out);
            }
        } else if let Some(j) = item_idx.iter().position(|&x| x == i) {
            if let Some(it) = items.get(j) {
                let (marker, done, text) = l.item.expect("an item line");
                let b = body(l.raw);
                let line = if it.text == text.trim() && it.done == done {
                    b.to_string()
                } else {
                    let ind = &b[..b.len() - b.trim_start().len()];
                    let c = if it.done { 'x' } else { ' ' };
                    format!("{ind}{marker} [{c}] {}", it.text)
                };
                out.push((line, ending_of(l)));
            }
            if j + 1 == item_idx.len() {
                extra_items(&mut out);
            }
        }
    }
    if item_idx.is_empty() {
        extra_items(&mut out);
    }
    let last_ending = ending_of(lines.last().expect("a line")).unwrap_or("");
    let n = out.len();
    let mut s = String::new();
    for (i, (b, e)) in out.into_iter().enumerate() {
        s.push_str(&b);
        if i + 1 < n {
            s.push_str(e.filter(|e| !e.is_empty()).unwrap_or(nl));
        } else {
            s.push_str(last_ending);
        }
    }
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codec(s: Value) -> CardCodec {
        CardCodec::new(&s)
    }

    fn same(text: &str, settings: Value) {
        let c = codec(settings);
        let p = c.parse(text);
        assert_eq!(c.write(&p, &p.fields.clone()), text, "{text:?}");
    }

    fn f(text: &str, links: &[&str], tags: &[&str], date: &str, time: &str) -> CardFields {
        CardFields {
            text: text.into(),
            links: links.iter().map(|s| s.to_string()).collect(),
            tags: tags.iter().map(|s| s.to_string()).collect(),
            date: date.into(),
            time: time.into(),
        }
    }

    #[test]
    fn a_card_nobody_changed_comes_back_byte_for_byte() {
        for s in [
            "Research [[Atlas Project]] options #research @{2026-01-12}",
            "Call the printer @{2026-02-01} @@{10:30} ^ab12cd",
            "Write [[Chapter 1|the first chapter]] #writing",
            "Plain card",
            "#first tag then text",
            "Two #a #b tags  with double  spaces",
            "Draft the outline\nSecond line of the card\n- nested point #x",
            "An embed ![[Board]] stays text and so does a url http://x.example/#frag",
            "",
            "Odd date @{not a date} stays text",
            "Ünïcödé #tåg [[Nøte]] ✓ @{2026-03-04}",
        ] {
            same(s, Value::Null);
        }
    }

    #[test]
    fn fields_hold_the_pieces_the_text_the_rest() {
        let c = codec(Value::Null);
        let p = c.parse("Research [[Atlas Project]] options #research @{2026-01-12} @@{09:05}");
        assert_eq!(
            p.fields,
            f(
                "Research options",
                &["Atlas Project"],
                &["research"],
                "2026-01-12",
                "09:05"
            )
        );
        assert_eq!(c.parse("Odd date @{not a date}").fields.date, "");
        assert_eq!(
            c.parse("Odd date @{not a date}").fields.text,
            "Odd date @{not a date}"
        );
        // An embed is not a link, a fragment is not a tag.
        let p = c.parse("See ![[Board]] and http://x.example/#frag");
        assert!(p.fields.links.is_empty() && p.fields.tags.is_empty());
    }

    #[test]
    fn editing_the_text_keeps_the_pieces_in_their_place() {
        let c = codec(Value::Null);
        let p = c.parse("Research [[Atlas]] options #research");
        assert_eq!(p.fields.text, "Research options");
        let mut e = p.fields.clone();
        e.text = "Research the options".into();
        assert_eq!(c.write(&p, &e), "Research [[Atlas]] the options #research");
        e.text = "Look into options".into();
        assert_eq!(c.write(&p, &e), "Look into [[Atlas]] options #research");
    }

    #[test]
    fn removed_pieces_go_new_ones_join_the_first_line() {
        let c = codec(Value::Null);
        let p = c.parse("Plan [[A]] #x\nmore text");
        let mut e = p.fields.clone();
        e.links = vec![];
        e.tags = vec!["x".into(), "y".into()];
        e.date = "2026-03-04".into();
        assert_eq!(c.write(&p, &e), "Plan #x #y @{2026-03-04}\nmore text");
        let q = c.parse("Ship it @{2026-01-01}");
        let mut e = q.fields.clone();
        e.date = "2026-02-02".into();
        assert_eq!(c.write(&q, &e), "Ship it @{2026-02-02}");
        e.date = String::new();
        assert_eq!(c.write(&q, &e), "Ship it");
        let mut e = q.fields.clone();
        e.time = "14:30".into();
        assert_eq!(c.write(&q, &e), "Ship it @{2026-01-01} @@{14:30}");
        let r = c.parse("");
        assert_eq!(
            c.write(&r, &f("New card", &["Note"], &["t"], "", "")),
            "New card [[Note]] #t"
        );
    }

    #[test]
    fn the_board_settings_choose_the_triggers_and_formats() {
        let s = json!({"date-trigger": "!", "date-format": "DD/MM/YYYY", "time-trigger": "!!"});
        let c = codec(s.clone());
        let p = c.parse("Pay rent !{01/02/2026} !!{9:30}");
        assert_eq!(p.fields.date, "2026-02-01");
        assert_eq!(p.fields.time, "09:30");
        same("Pay rent !{01/02/2026} !!{9:30}", s);
        let mut e = p.fields.clone();
        e.date = "2026-12-25".into();
        assert_eq!(c.write(&p, &e), "Pay rent !{25/12/2026} !!{9:30}");
        let c = codec(json!({"time-format": "H:mm"}));
        let p = c.parse("x");
        let mut e = p.fields.clone();
        e.time = "09:05".into();
        assert_eq!(c.write(&p, &e), "x @@{9:05}");
    }

    #[test]
    fn move_at_stays_on_char_boundaries() {
        // "é" and "ɩ" share their last byte.
        assert_eq!(move_at("aéb", "aɩb", 4), 4);
        let c = codec(Value::Null);
        let p = c.parse("é #t x");
        let mut e = p.fields.clone();
        e.text = "ɩ x".into();
        assert_eq!(c.write(&p, &e), "ɩ #t x");
    }

    const CARD: &str = "- [ ] Plan the trip [[Rome]] #travel ^ab12cd\n\tBook early\n\t- [ ] flights\n\t- [x] hotel\n\tNotes after\n";

    #[test]
    fn checklist_and_free_text_are_read_from_the_lines() {
        assert_eq!(
            checklist(CARD),
            vec![
                CheckItem {
                    text: "flights".into(),
                    done: false
                },
                CheckItem {
                    text: "hotel".into(),
                    done: true
                }
            ]
        );
        assert_eq!(
            free_text(CARD),
            "Plan the trip [[Rome]] #travel\nBook early\nNotes after"
        );
        assert_eq!(block_id(CARD).as_deref(), Some("ab12cd"));
        assert_eq!(block_id("- [ ] a\n\tb ^zz9\n").as_deref(), Some("zz9"));
        assert_eq!(block_id("- [ ] a ^ not\n"), None);
        assert_eq!(strip_block_id(CARD), CARD.replace(" ^ab12cd", ""));
        assert_eq!(strip_block_id("- [ ] a\n\tb ^zz9\n"), "- [ ] a\n\tb\n");
        assert_eq!(add_block_id("- [ ] a  \n\tb\n", "q1"), "- [ ] a ^q1\n\tb\n");
        assert_eq!(add_block_id("- [ ] a", "q1"), "- [ ] a ^q1");
    }

    #[test]
    fn edit_raw_changes_only_what_it_must() {
        let c = codec(Value::Null);
        // No change: byte for byte.
        let same = CardEdit {
            text: Some(free_text(CARD).replace(" [[Rome]] #travel", "")),
            links: Some(vec!["Rome".into()]),
            tags: Some(vec!["travel".into()]),
            checklist: Some(checklist(CARD)),
            ..Default::default()
        };
        assert_eq!(edit_raw(CARD, &same, &c, "\n").unwrap(), CARD);
        // Tick an item, add one, add a date: the block id stays last on the first line.
        let e = CardEdit {
            checklist: Some(vec![
                CheckItem {
                    text: "flights".into(),
                    done: true,
                },
                CheckItem {
                    text: "hotel".into(),
                    done: true,
                },
                CheckItem {
                    text: "visa".into(),
                    done: false,
                },
            ]),
            date: Some("2026-05-01".into()),
            ..Default::default()
        };
        assert_eq!(
            edit_raw(CARD, &e, &c, "\n").unwrap(),
            "- [ ] Plan the trip [[Rome]] #travel @{2026-05-01} ^ab12cd\n\tBook early\n\t- [x] flights\n\t- [x] hotel\n\t- [ ] visa\n\tNotes after\n"
        );
        // Remove the checklist: the other lines keep their order.
        let e = CardEdit {
            checklist: Some(vec![]),
            ..Default::default()
        };
        assert_eq!(
            edit_raw(CARD, &e, &c, "\n").unwrap(),
            "- [ ] Plan the trip [[Rome]] #travel ^ab12cd\n\tBook early\n\tNotes after\n"
        );
        // New text replaces the free text; links, tags and checklist stay.
        let e = CardEdit {
            text: Some("Trip".into()),
            ..Default::default()
        };
        assert_eq!(
            edit_raw(CARD, &e, &c, "\n").unwrap(),
            "- [ ] Trip [[Rome]] #travel ^ab12cd\n\t- [ ] flights\n\t- [x] hotel\n"
        );
        // A card without a checklist gets one at the end; no newline at the end is kept.
        let e = CardEdit {
            checklist: Some(vec![CheckItem {
                text: "one".into(),
                done: false,
            }]),
            tags: Some(vec!["t".into()]),
            ..Default::default()
        };
        assert_eq!(
            edit_raw("- [ ] Solo", &e, &c, "\n").unwrap(),
            "- [ ] Solo #t\n\t- [ ] one"
        );
        // Round trip: the checklist read back is the one written.
        let out = edit_raw("- [ ] Solo\r\n", &e, &c, "\r\n").unwrap();
        assert_eq!(out, "- [ ] Solo #t\r\n\t- [ ] one\r\n");
        assert_eq!(checklist(&out)[0].text, "one");
        assert!(edit_raw(
            "- [ ] x",
            &CardEdit {
                text: Some(" ".into()),
                ..Default::default()
            },
            &c,
            "\n"
        )
        .is_err());
    }

    #[test]
    fn card_edits_from_json_are_checked() {
        let e = CardEdit::from_json(
            &json!({"text": "t", "links": ["[[A]]"], "tags": ["#x"], "date": "2026-01-02", "time": "9:05", "checklist": [{"text": "s", "done": true}], "color": null}),
            true,
        )
        .unwrap();
        assert_eq!(e.links, Some(vec!["A".to_string()]));
        assert_eq!(e.tags, Some(vec!["x".to_string()]));
        assert_eq!(e.time.as_deref(), Some("09:05"));
        assert_eq!(e.color, Some(None));
        assert!(CardEdit::from_json(&json!({"date": "02/01/2026"}), true).is_err());
        assert!(CardEdit::from_json(&json!({"tags": ["a b"]}), true).is_err());
        assert!(CardEdit::from_json(&json!({"color": "red; x"}), true).is_err());
        assert!(CardEdit::from_json(&json!({}), true).unwrap().is_empty());
    }
}
