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
            None => loop {
                match rx.recv().await {
                    Ok(l) => break l,
                    // A slow viewer skips ahead; the stored chat has the full reply.
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
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
