// Which Mnemo chats have news you have not seen yet, per device: a chat is seen up to the
// message count it had while it was open on screen. The sidebar's Mnemo item shows how
// many chats have news; the Mnemo page marks each one with how many new messages it has.

import { useStyles } from '../dom';
import * as A from './api';

const LS = 'memora.mnemo.seen.v1';
/** How often the list is checked away from the Mnemo page (only while the tab is visible). */
const EVERY = 45_000;

interface Seen {
  seeded: boolean;
  m: Record<string, number>;
}

let seen: Seen | null = null;
let sessions: A.Session[] = [];
let timer = 0;
const listeners = new Set<() => void>();

function load(): Seen {
  if (seen) return seen;
  try {
    const v = JSON.parse(localStorage.getItem(LS) || 'null') as Seen | null;
    seen = v && typeof v === 'object' && v.m ? v : { seeded: false, m: {} };
  } catch {
    seen = { seeded: false, m: {} };
  }
  return seen;
}

function save(): void {
  try {
    localStorage.setItem(LS, JSON.stringify(load()));
  } catch {
    /* lasts until reload */
  }
}

/** A chat shown on screen right now (in the Mnemo page, the floating chat or a note's panel). */
function onScreen(id: string): boolean {
  if (document.hidden) return false;
  for (const c of document.querySelectorAll<HTMLElement>('.mn-chat[data-sid]')) {
    if (c.dataset.sid === id && c.getClientRects().length) return true;
  }
  return false;
}

/** New messages in a chat since it was last seen here. */
export function unreadOf(s: A.Session): number {
  const v = load();
  if (!v.seeded || onScreen(s.id)) return 0;
  const had = v.m[s.id];
  // A chat started elsewhere (another device, an @mnemo request in a note) is all news.
  return Math.max(0, s.messages - (had ?? 0));
}

export function unreadChats(): number {
  return sessions.filter((s) => !s.running && unreadOf(s) > 0).length;
}

/** Count a chat as seen up to `messages`. */
export function markSeen(id: string, messages: number): void {
  const v = load();
  if ((v.m[id] ?? -1) >= messages) return;
  v.m[id] = messages;
  save();
  paint();
}

/** The latest list of chats (from the Mnemo page or the check below). */
export function noteSessions(list: A.Session[]): void {
  sessions = list;
  const v = load();
  if (!v.seeded) {
    // First run on this device: what is there now counts as read.
    for (const s of list) v.m[s.id] = s.messages;
    v.seeded = true;
  }
  for (const s of list) if (onScreen(s.id)) v.m[s.id] = Math.max(v.m[s.id] ?? 0, s.messages);
  // Forget chats that are gone.
  const ids = new Set(list.map((s) => s.id));
  for (const k of Object.keys(v.m)) if (!ids.has(k)) delete v.m[k];
  save();
  paint();
}

export function onUnread(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** The count on the sidebar's Mnemo item and the menu's Mnemo entry. */
function paint(): void {
  const n = unreadChats();
  const label = n ? `${n} chat${n === 1 ? '' : 's'} with new messages` : '';
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
  timer = window.setInterval(() => {
    // The Mnemo page keeps its own list fresh.
    if (document.documentElement.dataset.page !== 'assistant') void check();
  }, EVERY);
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
