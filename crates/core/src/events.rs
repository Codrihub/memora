//! Realtime event hub: persists notable events, keeps a ring buffer for replay,
//! and fans out to WebSocket subscribers without blocking the caller.
//!
//!   * events arrive through `publish()` / `try_publish()`
//!   * types worth storing are appended to `<vault>/.events.jsonl` with a `_ts` stamp
//!   * the last 40 events are kept in a ring buffer and replayed to new clients
//!   * fan-out to every subscriber (WebSocket) never blocks the publisher
//!
//! Resource bounds (everything here lives for the whole process):
//!   * an event larger than `MAX_EVENT_BYTES` once serialized is rejected, so
//!     neither the ring, the broadcast slots nor the log can be inflated by one
//!     oversized event
//!   * events are serialized once and broadcast as a shared `Arc<str>`; the
//!     channel holds at most `CHAN` of them, a lagging client skips ahead
//!   * `.events.jsonl` is compacted to its newest events once it passes the
//!     configured byte limit (default `LOG_DEFAULT_BYTES`) or `LOG_MAX_LINES`
//!     lines; events older than the configured day limit are pruned hourly
//!
//! The hub is a process-global (`OnceLock`) rather than part of an `AppState`:
//! `MemoryStore` lives behind an `Arc<Mutex<..>>` shared across crates, and the
//! hub must be identical from every entry point (MCP tool, HTTP handler, intake).

use serde_json::{json, Value};
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;

/// Event types persisted to `.events.jsonl`.
const PERSIST_TYPES: &[&str] = &[
    "ai_activity",
    "node_created",
    "node_updated",
    "node_deleted",
    "node_renamed",
    "folder_meta",
    "folder_changed",
    "actor_alias",
    "key_color",
];

/// Broadcast channel capacity. A lagged client skips old events rather than
/// stalling the server. Worst case retained: `CHAN * MAX_EVENT_BYTES`.
const CHAN: usize = 256;

/// Number of recent events replayed to a new client.
const RING: usize = 40;

/// Largest accepted event, serialized.
pub const MAX_EVENT_BYTES: usize = 64 * 1024;

/// Hard cap on `.events.jsonl` lines, whatever the byte limit says.
const LOG_MAX_LINES: usize = 200_000;
/// Default byte limit of `.events.jsonl` (settings can change it).
pub const LOG_DEFAULT_BYTES: u64 = 8 * 1024 * 1024;
/// Smallest byte limit accepted by [`EventHub::set_log_limits`].
pub const LOG_MIN_BYTES: u64 = 64 * 1024;

/// Current wall-clock time in seconds since the Unix epoch.
pub fn now_ts() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// Why an event was not published.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublishError {
    /// Only JSON objects are events.
    NotObject,
    /// Serialized size exceeds `MAX_EVENT_BYTES`.
    TooLarge(usize),
}

/// Book-keeping for `.events.jsonl`. Guarded by one mutex so appends and
/// compaction never interleave.
#[derive(Default)]
struct LogState {
    path: Option<PathBuf>,
    /// Line / byte counts of the file, learned lazily on the first append.
    counted: bool,
    lines: usize,
    bytes: u64,
    /// Compact once the file passes this many bytes.
    max_bytes: u64,
    /// Drop events older than this many days (0 = keep by size only).
    max_days: u64,
}

/// Publish/subscribe hub backed by a broadcast channel and a replay ring.
pub struct EventHub {
    tx: broadcast::Sender<Arc<str>>,
    ring: Mutex<VecDeque<Arc<str>>>,
    log: Mutex<LogState>,
}

impl EventHub {
    fn new() -> Self {
        let (tx, _rx) = broadcast::channel(CHAN);
        Self {
            tx,
            ring: Mutex::new(VecDeque::with_capacity(RING + 1)),
            log: Mutex::new(LogState::default()),
        }
    }

    /// Tell the hub where `.events.jsonl` is written (boot and vault switch).
    pub fn set_events_path(&self, p: PathBuf) {
        let mut st = self.log.lock().unwrap();
        let (max_bytes, max_days) = (st.max_bytes, st.max_days);
        *st = LogState {
            path: Some(p),
            max_bytes,
            max_days,
            ..LogState::default()
        };
    }

    /// Size and age limits of `.events.jsonl` (bytes >= `LOG_MIN_BYTES`; days 0 =
    /// no age limit). A smaller size compacts on the next append.
    pub fn set_log_limits(&self, max_bytes: u64, max_days: u64) {
        let mut st = self.log.lock().unwrap();
        st.max_bytes = max_bytes.max(LOG_MIN_BYTES);
        st.max_days = max_days;
        st.counted = false;
    }

    fn limit(st: &LogState) -> u64 {
        if st.max_bytes == 0 {
            LOG_DEFAULT_BYTES
        } else {
            st.max_bytes
        }
    }

    /// Drop events older than the day limit; returns how many were dropped.
    pub fn prune_log_age(&self) -> usize {
        let mut st = self.log.lock().unwrap();
        let Some(p) = st.path.clone() else { return 0 };
        if st.max_days == 0 {
            return 0;
        }
        let cutoff = now_ts() - st.max_days as f64 * 86_400.0;
        let Ok(raw) = fs::read_to_string(&p) else {
            return 0;
        };
        let mut kept = String::with_capacity(raw.len());
        let mut dropped = 0;
        for l in raw.lines().filter(|l| !l.is_empty()) {
            let ts = serde_json::from_str::<Value>(l)
                .ok()
                .and_then(|v| v.get("_ts").and_then(|t| t.as_f64()));
            if ts.is_some_and(|t| t < cutoff) {
                dropped += 1;
            } else {
                kept.push_str(l);
                kept.push('\n');
            }
        }
        if dropped > 0 {
            let tmp = p.with_extension("jsonl.compact");
            if fs::write(&tmp, &kept).is_ok() && fs::rename(&tmp, &p).is_ok() {
                st.lines = kept.lines().count();
                st.bytes = kept.len() as u64;
                st.counted = true;
            }
        }
        dropped
    }

    /// `{bytes, lines, oldest, newest, max_bytes, max_days}` of `.events.jsonl`.
    pub fn log_stats(&self) -> Value {
        let st = self.log.lock().unwrap();
        let (mut bytes, mut lines, mut oldest, mut newest) = (0u64, 0usize, None, None);
        if let Some(raw) = st.path.as_ref().and_then(|p| fs::read_to_string(p).ok()) {
            bytes = raw.len() as u64;
            let ts = |l: &str| {
                serde_json::from_str::<Value>(l)
                    .ok()
                    .and_then(|v| v.get("_ts").and_then(|t| t.as_f64()))
            };
            let all: Vec<&str> = raw.lines().filter(|l| !l.is_empty()).collect();
            lines = all.len();
            oldest = all.iter().find_map(|l| ts(l));
            newest = all.iter().rev().find_map(|l| ts(l));
        }
        json!({
            "bytes": bytes, "lines": lines, "oldest": oldest, "newest": newest,
            "max_bytes": Self::limit(&st), "max_days": st.max_days,
        })
    }

    /// Publish one event, ignoring rejection (see `try_publish`).
    pub fn publish(&self, event: Value) {
        let _ = self.try_publish(event);
    }

    /// Publish one event: stamp `_ts`, persist if the type is persisted, broadcast.
    pub fn try_publish(&self, mut event: Value) -> Result<(), PublishError> {
        let Some(obj) = event.as_object_mut() else {
            return Err(PublishError::NotObject);
        };
        if !obj.contains_key("_ts") {
            obj.insert("_ts".to_string(), json!(now_ts()));
        }
        // `ai_activity` `end` events are realtime only: the log and the replay ring
        // keep one row per call (its `start`).
        let persist = obj
            .get("type")
            .and_then(|v| v.as_str())
            .is_some_and(|t| PERSIST_TYPES.contains(&t))
            && obj.get("phase").and_then(|v| v.as_str()) != Some("end");
        let line = serde_json::to_string(&event).map_err(|_| PublishError::NotObject)?;
        if line.len() > MAX_EVENT_BYTES {
            return Err(PublishError::TooLarge(line.len()));
        }
        let line: Arc<str> = Arc::from(line);

        if persist {
            {
                let mut ring = self.ring.lock().unwrap();
                ring.push_back(line.clone());
                while ring.len() > RING {
                    ring.pop_front();
                }
            }
            self.persist(&line);
        }

        // An Err here only means there are no WebSocket clients yet; the event
        // is still held in the ring and the log.
        let _ = self.tx.send(line);
        Ok(())
    }

    fn persist(&self, line: &str) {
        let mut st = self.log.lock().unwrap();
        let Some(p) = st.path.clone() else { return };
        let limit = Self::limit(&st);
        if !st.counted {
            let (lines, bytes) = count_lines(&p, limit);
            st.lines = lines;
            st.bytes = bytes;
            st.counted = true;
        }
        let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&p) else {
            return;
        };
        if writeln!(f, "{line}").is_ok() {
            st.lines += 1;
            st.bytes += line.len() as u64 + 1;
        }
        drop(f);
        if st.lines > LOG_MAX_LINES || st.bytes > limit {
            // Keep the newest three quarters, so compaction is not run on every append.
            if let Some((lines, bytes)) = compact_log(&p, LOG_MAX_LINES * 3 / 4, limit / 4 * 3) {
                st.lines = lines;
                st.bytes = bytes;
            } else {
                // Could not compact (e.g. read-only dir): recount next time
                // rather than retrying on every append.
                st.counted = false;
            }
        }
    }

    /// Register a WebSocket subscriber (one channel per client). Items are
    /// serialized JSON objects.
    pub fn subscribe(&self) -> broadcast::Receiver<Arc<str>> {
        self.tx.subscribe()
    }

    /// Number of active WebSocket clients (reported by `hello` and `presence`).
    pub fn clients(&self) -> usize {
        self.tx.receiver_count()
    }

    /// The most recent persisted events, serialized, oldest first.
    pub fn replay(&self) -> Vec<Arc<str>> {
        self.ring.lock().unwrap().iter().cloned().collect()
    }

    /// Drop the replay buffer (the vault was switched, so its events belong
    /// to the previous vault).
    pub fn clear_replay(&self) {
        self.ring.lock().unwrap().clear();
    }
}

/// `(lines, bytes)` of a file; a missing file is empty. Files far beyond the
/// cap are not read: they are reported as over the limit so the next append
/// compacts them.
fn count_lines(p: &Path, limit: u64) -> (usize, u64) {
    let Ok(md) = fs::metadata(p) else {
        return (0, 0);
    };
    if md.len() > limit {
        return (LOG_MAX_LINES + 1, md.len());
    }
    let mut buf = Vec::new();
    if File::open(p)
        .and_then(|mut f| f.read_to_end(&mut buf))
        .is_err()
    {
        return (0, md.len());
    }
    (bytecount_newlines(&buf), md.len())
}

fn bytecount_newlines(b: &[u8]) -> usize {
    b.iter().filter(|&&c| c == b'\n').count()
}

/// Keep only the newest `keep_lines` complete lines (reading at most the last
/// `keep_bytes` of the file), replacing the file atomically. Returns the new
/// `(lines, bytes)`.
fn compact_log(p: &Path, keep_lines: usize, keep_bytes: u64) -> Option<(usize, u64)> {
    let mut f = File::open(p).ok()?;
    let len = f.metadata().ok()?.len();
    let start = len.saturating_sub(keep_bytes);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    f.read_to_end(&mut buf).ok()?;
    drop(f);
    let mut tail: &[u8] = &buf;
    if start > 0 {
        // Drop the partial first line.
        match tail.iter().position(|&c| c == b'\n') {
            Some(i) => tail = &tail[i + 1..],
            None => tail = &[],
        }
    }
    let lines: Vec<&[u8]> = tail
        .split(|&c| c == b'\n')
        .filter(|l| !l.is_empty())
        .collect();
    let from = lines.len().saturating_sub(keep_lines);
    let kept = &lines[from..];
    let mut out = Vec::with_capacity(tail.len());
    for l in kept {
        out.extend_from_slice(l);
        out.push(b'\n');
    }
    let tmp = p.with_extension("jsonl.compact");
    fs::write(&tmp, &out).ok()?;
    fs::rename(&tmp, p).ok()?;
    Some((kept.len(), out.len() as u64))
}

static HUB: OnceLock<EventHub> = OnceLock::new();

/// Process-global event hub.
pub fn hub() -> &'static EventHub {
    HUB.get_or_init(EventHub::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "memora-events-{tag}-{}-{}",
            std::process::id(),
            now_ts()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn ring_is_capped_and_oversized_events_rejected() {
        let h = EventHub::new();
        for i in 0..(RING * 3) {
            h.publish(json!({"type": "ai_activity", "i": i}));
        }
        assert_eq!(h.replay().len(), RING);
        assert!(h
            .replay()
            .last()
            .unwrap()
            .contains(&format!("\"i\":{}", RING * 3 - 1)));

        let big = "x".repeat(MAX_EVENT_BYTES + 1);
        assert!(matches!(
            h.try_publish(json!({"type": "ai_activity", "blob": big})),
            Err(PublishError::TooLarge(_))
        ));
        assert_eq!(h.try_publish(json!([1, 2])), Err(PublishError::NotObject));
        assert_eq!(h.replay().len(), RING);
    }

    #[test]
    fn activity_end_events_are_broadcast_but_not_persisted() {
        let dir = tmpdir("end");
        let hub = EventHub::new();
        hub.set_events_path(dir.join(".events.jsonl"));
        let mut rx = hub.subscribe();
        hub.publish(json!({"type": "ai_activity", "phase": "start", "call_id": "c1"}));
        hub.publish(json!({"type": "ai_activity", "phase": "end", "call_id": "c1", "ok": true}));
        assert!(rx.try_recv().unwrap().contains("\"start\""));
        assert!(rx.try_recv().unwrap().contains("\"end\""));
        assert_eq!(hub.replay().len(), 1);
        let log = std::fs::read_to_string(dir.join(".events.jsonl")).unwrap();
        assert_eq!(log.lines().count(), 1);
        assert!(log.contains("\"start\""));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn lagging_subscriber_skips_instead_of_growing() {
        let h = EventHub::new();
        let mut rx = h.subscribe();
        for i in 0..(CHAN * 4) {
            h.publish(json!({"type": "presence", "i": i}));
        }
        match rx.try_recv() {
            Err(broadcast::error::TryRecvError::Lagged(n)) => assert!(n as usize >= CHAN * 3),
            other => panic!("expected lag, got {other:?}"),
        }
        assert_eq!(h.clients(), 1);
        drop(rx);
        assert_eq!(h.clients(), 0);
    }

    #[test]
    fn events_log_is_compacted() {
        let d = tmpdir("log");
        let p = d.join(".events.jsonl");
        let h = EventHub::new();
        h.set_events_path(p.clone());
        h.set_log_limits(LOG_MIN_BYTES, 0);
        let pad = "x".repeat(200);
        let n = 2000;
        for i in 0..n {
            h.publish(json!({"type": "ai_activity", "i": i, "pad": pad}));
        }
        let raw = fs::read_to_string(&p).unwrap();
        assert!(raw.len() as u64 <= LOG_MIN_BYTES, "{} bytes", raw.len());
        let lines: Vec<&str> = raw.lines().collect();
        assert!(lines.len() > 50);
        // Newest event survives, and every kept line is valid JSON.
        assert!(lines.last().unwrap().contains(&format!("\"i\":{}", n - 1)));
        assert!(lines
            .iter()
            .all(|l| serde_json::from_str::<Value>(l).is_ok()));
        // Non-persisted types never touch the log.
        let before = fs::metadata(&p).unwrap().len();
        h.publish(json!({"type": "presence"}));
        assert_eq!(fs::metadata(&p).unwrap().len(), before);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn old_events_are_pruned_by_age() {
        let d = tmpdir("age");
        let p = d.join(".events.jsonl");
        let h = EventHub::new();
        h.set_events_path(p.clone());
        h.set_log_limits(LOG_DEFAULT_BYTES, 7);
        let old = now_ts() - 10.0 * 86_400.0;
        h.publish(json!({"type": "ai_activity", "i": 0, "_ts": old}));
        h.publish(json!({"type": "ai_activity", "i": 1}));
        assert_eq!(h.prune_log_age(), 1);
        let raw = fs::read_to_string(&p).unwrap();
        assert_eq!(raw.lines().count(), 1);
        assert!(raw.contains("\"i\":1"));
        assert_eq!(h.log_stats()["lines"], 1);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn oversized_legacy_log_is_compacted_on_first_append() {
        let d = tmpdir("legacy");
        let p = d.join(".events.jsonl");
        let line = format!(
            "{{\"type\":\"ai_activity\",\"pad\":\"{}\"}}\n",
            "y".repeat(1000)
        );
        let n = (LOG_DEFAULT_BYTES as usize / line.len()) + 50;
        fs::write(&p, line.repeat(n)).unwrap();
        let h = EventHub::new();
        h.set_events_path(p.clone());
        h.publish(json!({"type": "ai_activity", "last": true}));
        let len = fs::metadata(&p).unwrap().len();
        assert!(len <= LOG_DEFAULT_BYTES / 4 * 3 + 2048, "len {len}");
        let raw = fs::read_to_string(&p).unwrap();
        assert!(raw.lines().last().unwrap().contains("\"last\":true"));
        assert!(raw
            .lines()
            .all(|l| serde_json::from_str::<Value>(l).is_ok()));
        fs::remove_dir_all(&d).ok();
    }
}
