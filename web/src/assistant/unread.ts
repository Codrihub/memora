// Which Mnemo chats have news you have not seen yet: a chat is seen up to the message count
// it had while it was open on screen, on any device (the server remembers the counts). The sidebar's Mnemo item shows how
// many chats have news; the Mnemo page marks each one with how many new messages it has.

import { useStyles } from '../dom';
import { tn } from '../i18n';
import * as A from './api';

/** How often the list is checked (only while the tab is visible). */
const EVERY = 45_000;

/** Seen counts per chat: from the server's list, raised at once by what is read here. */
const seen = new Map<string, number>();
let sessions: A.Session[] = [];
let timer = 0;
const listeners = new Set<() => void>();

// The count used to live in this browser only (2.1.4); the server keeps it now.
try {
  localStorage.removeItem('memora.mnemo.seen.v1');
} catch {
  /* nothing to tidy */
}

/** A chat shown on screen right now (in the Mnemo page, the floating chat or a note's panel). */
function onScreen(id: string): boolean {
  if (document.hidden) return false;
  for (const c of document.querySelectorAll<HTMLElement>('.mn-chat[data-sid]')) {
    if (c.dataset.sid === id && c.getClientRects().length) return true;
  }
  return false;
}

/** New messages in a chat since the owner last saw it (here or on another device). */
export function unreadOf(s: A.Session): number {
  const had = seen.get(s.id);
  // A chat the server has not listed yet (just started here) has no news.
  if (had === undefined || s.running || onScreen(s.id)) return 0;
  return Math.max(0, s.messages - had);
}

export function unreadChats(): number {
  return sessions.filter((s) => unreadOf(s) > 0).length;
}

/** Count a chat as seen up to `messages`, here and on the server. */
export function markSeen(id: string, messages: number): void {
  if ((seen.get(id) ?? -1) >= messages) return;
  seen.set(id, messages);
  paint();
  void A.markSessionSeen(id, messages)
    .then((r) => {
      if (r.seen > (seen.get(id) ?? -1)) seen.set(id, r.seen);
    })
    .catch(() => undefined);
}

/** The latest list of chats (from the Mnemo page or the check below). */
export function noteSessions(list: A.Session[]): void {
  // Archived chats do not count as unread anywhere.
  sessions = list.filter((s) => !s.archived);
  const ids = new Set<string>();
  for (const s of list) {
    ids.add(s.id);
    if (typeof s.seen === 'number' && s.seen > (seen.get(s.id) ?? -1)) seen.set(s.id, s.seen);
  }
  for (const k of [...seen.keys()]) if (!ids.has(k)) seen.delete(k);
  // A chat open on screen is read as it grows.
  for (const s of list) if (!s.running && seen.has(s.id) && onScreen(s.id)) markSeen(s.id, s.messages);
  paint();
}

export function onUnread(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** The count on the sidebar's Mnemo item and the menu's Mnemo entry. */
function paint(): void {
  const n = unreadChats();
  const label = n ? tn(n, '{n} chat with new messages', '{n} chats with new messages') : '';
  document.querySelectorAll<HTMLElement>('.side-mnemo, .pm-item[data-page="assistant"]').forEach((item) => {
    let b = item.querySelector<HTMLElement>('.mn-unread-n');
    if (!n) {
      b?.remove();
      item.classList.remove('has-unread');
      return;
    }
    if (!b) {
      b = document.createElement('span');
      b.className = 'mn-unread-n';
      item.append(b);
    }
    b.textContent = n > 99 ? '99+' : String(n);
    b.title = label;
    item.classList.add('has-unread');
  });
  listeners.forEach((f) => f());
}

async function check(): Promise<void> {
  if (document.hidden) return;
  try {
    noteSessions((await A.listSessions()).sessions);
  } catch {
    /* signed out or offline: try again later */
  }
}

/** Keep the sidebar count fresh: a light check now and then while the tab is visible. */
export function watchUnread(): void {
  if (timer) return;
  useStyles('mnemo-unread-css', UNREAD_CSS);
  void check();
  timer = window.setInterval(() => void check(), EVERY);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void check();
  });
}

/** Paint again (after the menu or sidebar was redrawn). */
export function repaintUnread(): void {
  paint();
}

export const UNREAD_CSS = `
.mn-unread-n{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;margin-left:auto;border-radius:999px;
  background:var(--accent);color:var(--accent-fg,#fff);font-size:10.5px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.side-mnemo.has-unread .ni-new{display:none}
.pm-item .mn-unread-n{margin-left:8px}
#app.side-collapsed .side-mnemo .mn-unread-n{position:absolute;top:4px;right:6px;min-width:16px;height:16px;padding:0 4px;font-size:9.5px;margin:0}
.side-mnemo{position:relative}
`;
