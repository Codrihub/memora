// What is due across every board, for this reader: one list (GET /api/kanban/due, with the reader's
// own today) that feeds the Due section on Overview, the count on the Boards nav item and, when the
// reader turns them on in Settings, browser reminders: once when a card falls due and once a day for
// what is overdue. Reminders follow the pop-up switch and never repeat for the same card and day.

import { apiGet, apiPost } from '../api';
import { on } from '../bus';
import { hooks } from '../hooks';
import { t, tn } from '../i18n';
import { nodeUrl } from '../router';
import { toastPrefs } from '../storage';
import { undoToast } from '../vault/ui';
import { plainTitle, todayISO } from './due';
import { revealCard } from './kanban';

export interface DueCard {
  board: string;
  board_title: string;
  lane: string;
  lane_index: number;
  card: string;
  title: string;
  date: string;
  block?: string | null;
}

export interface DueList {
  today: string;
  days: number;
  counts: { overdue: number; today: number; upcoming: number };
  overdue: DueCard[];
  due_today: DueCard[];
  upcoming: DueCard[];
}

let last: DueList | null = null;
let started = false;
let seq = 0;
const subs = new Set<(d: DueList) => void>();

/** The last list fetched (null before the first one). */
export function dueNow(): DueList | null {
  return last;
}

/** Called with every new list (right away when one is there); returns the unsubscribe. */
export function onDue(fn: (d: DueList) => void): () => void {
  subs.add(fn);
  if (last) fn(last);
  return () => subs.delete(fn);
}

/** Fetch what is due now and tell everyone who listens. */
export async function refreshDue(): Promise<DueList | null> {
  const my = ++seq;
  try {
    const d = await apiGet<DueList>(`/api/kanban/due?today=${todayISO()}&days=7`);
    if (my !== seq) return last;
    last = d;
    paintBadge(d);
    subs.forEach((fn) => {
      try {
        fn(d);
      } catch (e) {
        console.error(e);
      }
    });
    remind(d);
    return d;
  } catch {
    return last;
  }
}

/** Start once after sign-in: a first fetch, then again when a board changes, every five minutes
 *  (which also catches midnight) and when the app comes back to the foreground. */
export function startDueWatch(): void {
  if (started) return;
  started = true;
  void refreshDue();
  let timer = 0;
  const soon = (ms = 1200): void => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void refreshDue(), ms);
  };
  // Any change may add, date or tick a card (a note can become a board, too): one fetch after
  // the burst settles.
  on('mutation', () => soon(2000));
  let at = Date.now();
  window.setInterval(() => {
    at = Date.now();
    void refreshDue();
  }, 5 * 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - at > 60_000) {
      at = Date.now();
      soon(200);
    }
  });
  // A tap on a reminder from the service worker opens its board here.
  navigator.serviceWorker?.addEventListener('message', (e) => {
    const d = e.data as { type?: string; path?: string } | null;
    if (d?.type === 'OPEN_NOTE' && d.path) hooks.openNote(d.path);
  });
}

/** Open a board at one card. */
export function openDueCard(c: DueCard): void {
  revealCard(c.board, c.card, c.block);
  hooks.openNote(c.board);
}

/** Tick a card off where it is listed, with Undo. */
export async function tickDue(c: DueCard): Promise<boolean> {
  try {
    await apiPost('/api/kanban', { path: c.board, op: { type: 'update_card', card: c.card, checked: true } });
  } catch (e) {
    undoToast(t('Could not save the board: {error}', { error: (e as Error).message }), null, 'err');
    return false;
  }
  undoToast(t('Done: {title}', { title: plainTitle(c.title) }), async () => {
    await apiPost('/api/kanban', { path: c.board, op: { type: 'update_card', card: c.card, checked: false } }).catch(() => undefined);
    void refreshDue();
  });
  void refreshDue();
  return true;
}

// ── the Boards nav item ─────────────────────────────────────────────────────────────────────────

function paintBadge(d: DueList): void {
  const n = d.counts.overdue;
  document.querySelectorAll<HTMLElement>('[data-due-badge]').forEach((b) => {
    b.textContent = n > 99 ? '99+' : String(n);
    b.hidden = n === 0;
    b.title = tn(n, '{n} card is overdue', '{n} cards are overdue');
  });
  // The label is what screen readers announce for the nav item.
  document.querySelectorAll<HTMLElement>('.nav-item[data-page="boards"]').forEach((item) => {
    const label = item.querySelector('.ni-label')?.textContent || t('Boards');
    item.setAttribute('aria-label', n ? `${label}, ${tn(n, '{n} card is overdue', '{n} cards are overdue')}` : label);
  });
}

/** Repaint the badge on a freshly drawn sidebar. */
export function repaintDueBadge(): void {
  if (last) paintBadge(last);
}

// ── reminders ───────────────────────────────────────────────────────────────────────────────────

const LS_ON = 'memora.due.notify.v1';
const LS_SEEN = 'memora.due.seen.v1';

interface Seen {
  /** Cards already announced as due, by key, with the day they fell due. */
  cards: Record<string, string>;
  /** The day the overdue summary was last shown. */
  digest: string;
}

export function remindersOn(): boolean {
  try {
    return localStorage.getItem(LS_ON) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

/** Turn reminders on (asking the browser for permission now) or off. Returns whether they are on. */
export async function setReminders(want: boolean): Promise<boolean> {
  const save = (v: boolean): void => {
    try {
      if (v) localStorage.setItem(LS_ON, '1');
      else localStorage.removeItem(LS_ON);
    } catch {
      /* storage blocked */
    }
  };
  if (!want) {
    save(false);
    return false;
  }
  if (typeof Notification === 'undefined') {
    undoToast(t('This browser cannot show notifications.'), null, 'err');
    return false;
  }
  const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (p !== 'granted') {
    undoToast(t('Notifications are blocked for this site. Allow them in the browser settings, then try again.'), null, 'err', 6000);
    save(false);
    return false;
  }
  // What is already due counts as announced: turning reminders on is not a burst of them.
  const seen = readSeen();
  const d = last || (await refreshDue());
  if (d) for (const c of d.due_today) seen.cards[keyOf(c)] = c.date;
  if (d) seen.digest = d.today;
  writeSeen(seen);
  save(true);
  return true;
}

const keyOf = (c: DueCard): string => `${c.board}\n${c.block || c.title}\n${c.date}`;

function readSeen(): Seen {
  try {
    const v = JSON.parse(localStorage.getItem(LS_SEEN) || '{}') as Partial<Seen>;
    return { cards: v.cards && typeof v.cards === 'object' ? v.cards : {}, digest: typeof v.digest === 'string' ? v.digest : '' };
  } catch {
    return { cards: {}, digest: '' };
  }
}

function writeSeen(s: Seen): void {
  try {
    localStorage.setItem(LS_SEEN, JSON.stringify(s));
  } catch {
    /* storage blocked */
  }
}

function remind(d: DueList): void {
  if (!remindersOn() || toastPrefs.off) return;
  const seen = readSeen();
  // Forget what fell due more than a month ago.
  const old = new Date();
  old.setDate(old.getDate() - 31);
  const cut = todayISO(old);
  for (const [k, day] of Object.entries(seen.cards)) if (day < cut) delete seen.cards[k];
  const fresh = d.due_today.filter((c) => !seen.cards[keyOf(c)]);
  for (const c of fresh) seen.cards[keyOf(c)] = c.date;
  const digest = d.counts.overdue > 0 && seen.digest !== d.today;
  if (digest) seen.digest = d.today;
  // Written before showing: another open tab reads it and stays quiet.
  writeSeen(seen);
  if (fresh.length === 1) show(t('Due today: {title}', { title: plainTitle(fresh[0].title) }), `${fresh[0].board_title} · ${fresh[0].lane}`, `due-${keyOf(fresh[0])}`, fresh[0].board);
  else if (fresh.length > 1)
    show(
      tn(fresh.length, '{n} card is due today', '{n} cards are due today'),
      fresh
        .slice(0, 3)
        .map((c) => plainTitle(c.title))
        .join(' · '),
      `due-today-${d.today}`,
      fresh.every((c) => c.board === fresh[0].board) ? fresh[0].board : '',
    );
  if (digest)
    show(
      tn(d.counts.overdue, '{n} card is overdue', '{n} cards are overdue'),
      d.overdue
        .slice(0, 3)
        .map((c) => plainTitle(c.title))
        .join(' · '),
      `due-overdue-${d.today}`,
      d.overdue.every((c) => c.board === d.overdue[0].board) ? d.overdue[0].board : '',
    );
}

function show(title: string, body: string, tag: string, path: string): void {
  const opts: NotificationOptions = { body, tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { path, url: path ? nodeUrl(path) : '/' } };
  // The service worker's notifications work on phones too; a page notification is the fallback.
  void (navigator.serviceWorker?.getRegistration() ?? Promise.resolve(undefined))
    .then((reg) => {
      if (reg) return reg.showNotification(title, opts);
      const n = new Notification(title, opts);
      n.onclick = () => {
        window.focus();
        if (path) hooks.openNote(path);
        n.close();
      };
    })
    .catch(() => {
      /* the browser refused: nothing more to do */
    });
}
