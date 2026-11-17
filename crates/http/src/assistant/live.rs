//! Replies that keep going without a viewer.
//!
//! A reply runs on the server whether or not anyone watches: its events are kept for the
//! run and broadcast, so the browser can leave the chat (open another one, leave the page,
//! lose the network) and come back to the same reply still streaming, or find it stored.
//! Only an explicit stop (`POST …/stop`) ends a reply early.
//!
//! * [`start`] makes the event sink a run writes to (the sender `run_agent` takes).
//! * [`sse`] attaches a viewer: every event so far, then the new ones, until the run ends.
//! * [`cancel`] stops a run.
//! * The queue: messages sent while a reply runs wait here and go out one by one as each
//!   reply ends (done, stopped or cut; a failed reply pauses it), whichever device sent them.
//! * [`watch`] / [`notify`]: every device with the chat open hears new messages, replies
//!   starting and ending, and queue changes, so they all stay in step.

use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::{broadcast, mpsc, Notify};

/// Sent to viewers once a run ends (never shown: the stream closes on it).
const END: &str = "\u{0}end";

struct Live {
    /// Every event of the run so far, for viewers that attach late.
    events: Mutex<Vec<Arc<str>>>,
    tx: broadcast::Sender<Arc<str>>,
    stop: Notify,
}

fn runs() -> &'static Mutex<HashMap<String, Arc<Live>>> {
    static RUNS: OnceLock<Mutex<HashMap<String, Arc<Live>>>> = OnceLock::new();
    RUNS.get_or_init(Default::default)
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// One message waiting in a chat's queue: it goes out when the reply before it ends.
#[derive(Clone)]
pub struct Queued {
    pub id: u64,
    pub text: String,
    /// The request it came with (attachments, time zone, model…), sent as `/chat` would.
    pub body: serde_json::Value,
    pub at: i64,
}

#[derive(Default)]
struct Queue {
    items: Vec<Queued>,
    /// Paused after a reply failed: nothing goes out until the owner sends or resumes.
    held: bool,
    /// The owner asked for the first message now: the reply running is cut for it.
    forced: bool,
}

fn queues() -> &'static Mutex<HashMap<String, Queue>> {
    static Q: OnceLock<Mutex<HashMap<String, Queue>>> = OnceLock::new();
    Q.get_or_init(Default::default)
}

fn next_qid() -> u64 {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// Chat `id`'s queue as the web app shows it: `{items: [{id, text, attach, at}], held}`.
pub fn queue_json(id: &str) -> serde_json::Value {
    let q = lock(queues());
    let (items, held) = q
        .get(id)
        .map(|x| (x.items.clone(), x.held))
        .unwrap_or_default();
    serde_json::json!({
        "items": items.iter().map(|i| serde_json::json!({
            "id": i.id,
            "text": i.text,
            "attach": i.body.get("attach").cloned().unwrap_or(serde_json::json!([])),
            "at": i.at,
        })).collect::<Vec<_>>(),
        "held": held && !items.is_empty(),
    })
}

/// Tell everyone watching chat `id` that its queue changed.
pub fn queue_changed(id: &str) {
    let mut v = queue_json(id);
    v["type"] = serde_json::json!("queue");
    notify(id, &v);
}

/// Add a message to chat `id`'s queue (`front`: it goes next). Returns its id.
pub fn enqueue(id: &str, text: &str, body: serde_json::Value, front: bool) -> u64 {
    let item = Queued {
        id: next_qid(),
        text: text.to_string(),
        body,
        at: memora_state::now(),
    };
    let qid = item.id;
    {
        let mut q = lock(queues());
        let e = q.entry(id.to_string()).or_default();
        if front {
            e.items.insert(0, item);
        } else {
            e.items.push(item);
        }
    }
    queue_changed(id);
    qid
}

/// Change chat `id`'s queue: `del`, `up`, `down`, `move` (to place `to`) or `send` (goes
/// next and cuts the reply running). `false` when that message is not queued.
pub fn queue_op(id: &str, qid: u64, op: &str, to: usize) -> bool {
    {
        let mut q = lock(queues());
        let Some(e) = q.get_mut(id) else {
            return false;
        };
        let Some(i) = e.items.iter().position(|x| x.id == qid) else {
            return false;
        };
        match op {
            "del" => {
                e.items.remove(i);
            }
            "up" if i > 0 => e.items.swap(i, i - 1),
            "down" if i + 1 < e.items.len() => e.items.swap(i, i + 1),
            "move" => {
                let it = e.items.remove(i);
                let to = to.min(e.items.len());
                e.items.insert(to, it);
            }
            "send" => {
                let it = e.items.remove(i);
                e.items.insert(0, it);
                e.forced = true;
                e.held = false;
            }
            _ => {}
        }
    }
    queue_changed(id);
    true
}

/// Drop every queued message of chat `id`.
pub fn queue_clear(id: &str) {
    lock(queues()).remove(id);
    queue_changed(id);
}

/// Let a paused queue go on.
pub fn queue_resume(id: &str) {
    if let Some(e) = lock(queues()).get_mut(id) {
        e.held = false;
    }
    queue_changed(id);
}

/// Mark the next message as wanted now (the reply running is cut for it).
pub fn force_next(id: &str) {
    if let Some(e) = lock(queues()).get_mut(id) {
        e.forced = true;
        e.held = false;
    }
}

/// The next message to send, if the queue may go on. `after_run`: a reply just ended. A failed
/// reply pauses the queue (Try again comes first); a paused queue waits while the chat is idle
/// and goes on after the next reply that ends well. A message the owner asked for now goes
/// regardless.
pub fn queue_next(id: &str, failed: bool, after_run: bool) -> Option<Queued> {
    let out = {
        let mut q = lock(queues());
        let e = q.get_mut(id)?;
        let forced = std::mem::take(&mut e.forced);
        if !forced && (failed || (e.held && !after_run)) {
            if !e.items.is_empty() {
                e.held = true;
            }
            None
        } else {
            e.held = false;
            let it = (!e.items.is_empty()).then(|| e.items.remove(0));
            if e.items.is_empty() {
                q.remove(id);
            }
            it
        }
    };
    queue_changed(id);
    out
}

/// Put a message back at the front (it could not go out after all).
pub fn requeue(id: &str, item: Queued, hold: bool) {
    {
        let mut q = lock(queues());
        let e = q.entry(id.to_string()).or_default();
        e.items.insert(0, item);
        e.held = hold;
    }
    queue_changed(id);
}

/// Whether chat `id` has messages waiting.
pub fn queued(id: &str) -> bool {
    lock(queues()).get(id).is_some_and(|e| !e.items.is_empty())
}

// ---- watchers: every device that has the chat open ----

fn watchers() -> &'static Mutex<HashMap<String, broadcast::Sender<Arc<str>>>> {
    static W: OnceLock<Mutex<HashMap<String, broadcast::Sender<Arc<str>>>>> = OnceLock::new();
    W.get_or_init(Default::default)
}

/// Tell every device watching chat `id` what happened (`{type: user|running|idle|queue|reload…}`).
pub fn notify(id: &str, v: &serde_json::Value) {
    let mut w = lock(watchers());
    if let Some(tx) = w.get(id) {
        if tx.send(v.to_string().into()).is_err() {
            w.remove(id);
        }
    }
}

/// `GET …/watch`: what happens in chat `id`, from now on, as server-sent events.
pub fn watch(id: &str) -> Response {
    let rx = {
        let mut w = lock(watchers());
        let tx = w
            .entry(id.to_string())
            .or_insert_with(|| broadcast::channel(256).0);
        tx.subscribe()
    };
    let hello: Arc<str> = serde_json::json!({"type": "hello", "running": running(id)})
        .to_string()
        .into();
    let stream =
        futures_util::stream::unfold((Some(hello), rx), |(mut first, mut rx)| async move {
            let line = match first.take() {
                Some(l) => l,
                None => match rx.recv().await {
                    Ok(l) => l,
                    // Missed some: the device reloads the chat to catch up.
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        serde_json::json!({"type": "reload"}).to_string().into()
                    }
                    Err(broadcast::error::RecvError::Closed) => return None,
                },
            };
            Some((
                Ok::<_, std::convert::Infallible>(Event::default().data(&*line)),
                (None, rx),
            ))
        });
    Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response()
}

/// Whether chat `id` has a reply running now.
pub fn running(id: &str) -> bool {
    lock(runs()).contains_key(id)
}

/// Begin a run for chat `id`: the returned sender takes its events (JSON lines). Sends
/// keep working with no viewer; they fail only after [`cancel`], which ends the run.
pub fn start(id: &str) -> mpsc::UnboundedSender<String> {
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let (btx, _) = broadcast::channel(4096);
    let live = Arc::new(Live {
        events: Mutex::new(Vec::new()),
        tx: btx,
        stop: Notify::new(),
    });
    lock(runs()).insert(id.to_string(), live.clone());
    let id = id.to_string();
    let id2 = id.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                v = rx.recv() => match v {
                    Some(line) => {
                        let line: Arc<str> = line.into();
                        let mut ev = lock(&live.events);
                        ev.push(line.clone());
                        let _ = live.tx.send(line);
                    }
                    None => break,
                },
                // Stopped: dropping the receiver makes the run's next send fail, so it ends.
                _ = live.stop.notified() => break,
            }
        }
        drop(rx);
        {
            let mut ev = lock(&live.events);
            ev.push(END.into());
            let _ = live.tx.send(END.into());
        }
        let mut r = lock(runs());
        if r.get(&id).is_some_and(|x| Arc::ptr_eq(x, &live)) {
            r.remove(&id);
        }
    });
    notify(&id2, &serde_json::json!({"type": "running"}));
    tx
}

/// Stop the reply running in chat `id`. `false` when none is.
pub fn cancel(id: &str) -> bool {
    match lock(runs()).get(id) {
        Some(l) => {
            l.stop.notify_one();
            true
        }
        None => false,
    }
}

/// A viewer of chat `id`'s running reply: server-sent events from its start, then live.
/// `None` when no reply is running.
pub fn sse(id: &str) -> Option<Response> {
    let live = lock(runs()).get(id).cloned()?;
    // Take the backlog and subscribe under one lock, so no event is missed or repeated.
    let (backlog, rx) = {
        let ev = lock(&live.events);
        (ev.clone(), live.tx.subscribe())
    };
    drop(live);
    let state = (backlog.into_iter(), rx, false);
    let stream = futures_util::stream::unfold(state, |(mut back, mut rx, ended)| async move {
        if ended {
            return None;
        }
        let line = match back.next() {
            Some(l) => l,
            None => match rx.recv().await {
                Ok(l) => l,
                // Missed some: the device reloads the chat to catch up.
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    serde_json::json!({"type": "reload"}).to_string().into()
                }
                Err(broadcast::error::RecvError::Closed) => return None,
            },
        };
        if &*line == END {
            return None;
        }
        Some((
            Ok::<_, std::convert::Infallible>(Event::default().data(&*line)),
            (back, rx, false),
        ))
    });
    Some(
        Sse::new(stream)
            .keep_alive(KeepAlive::default())
            .into_response(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_run_goes_on_without_viewers_and_late_viewers_see_it_all() {
        let tx = start("t1");
        assert!(running("t1"));
        assert!(tx.send("{\"type\":\"start\"}".into()).is_ok());
        assert!(
            tx.send("{\"type\":\"text\"}".into()).is_ok(),
            "no viewer needed"
        );
        tokio::task::yield_now().await;
        assert!(sse("t1").is_some(), "a late viewer can attach");
        drop(tx);
        for _ in 0..50 {
            if !running("t1") {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert!(!running("t1"), "the run ends with its sender");
        assert!(sse("t1").is_none());
    }

    #[tokio::test]
    async fn stopping_makes_the_runs_sends_fail() {
        let tx = start("t2");
        assert!(cancel("t2"));
        for _ in 0..50 {
            if tx.send("{}".into()).is_err() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert!(tx.send("{}".into()).is_err());
        assert!(!cancel("nope"));
    }
}

#[cfg(test)]
mod queue_tests {
    use super::*;

    #[test]
    fn the_queue_goes_on_after_a_stop_and_pauses_after_an_error() {
        let a = enqueue("q1", "one", serde_json::json!({}), false);
        let b = enqueue("q1", "two", serde_json::json!({}), false);
        let c = enqueue("q1", "three", serde_json::json!({}), false);
        assert!(queue_op("q1", c, "up", 0));
        assert_eq!(queue_json("q1")["items"][1]["text"], "three");
        // A failed reply pauses it…
        assert!(queue_next("q1", true, true).is_none());
        assert_eq!(queue_json("q1")["held"], true);
        assert!(
            queue_next("q1", false, false).is_none(),
            "paused while idle"
        );
        // …until one is sent now: it goes first, even after a failure.
        assert!(queue_op("q1", b, "send", 0));
        let next = queue_next("q1", true, true).map(|x| x.text);
        assert_eq!(next.as_deref(), Some("two"));
        assert_eq!(queue_next("q1", false, true).map(|x| x.id), Some(a));
        // Paused again; a reply that ends well lets it go on.
        assert!(queue_next("q1", true, true).is_none());
        let next = queue_next("q1", false, true).map(|x| x.text);
        assert_eq!(next.as_deref(), Some("three"));
        assert!(queue_next("q1", false, true).is_none());
        assert!(!queued("q1"));
    }
}
