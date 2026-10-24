// Vault UI state: folder hierarchy, selection, list preferences, pins and agent activity.
// /api/tree groups notes by top level folder only, so the hierarchy is rebuilt from note paths.

import { on, type PinsChange } from '../bus';
import { hashColor } from '../format';
import { api, apiGet, apiPost } from '../api';
import { activityToastAllowed, clearLegacyPins, legacyPins } from '../storage';
import { toast } from '../toast';
import { allNotes, noteTitle, state } from '../state';
import { activeAgents } from '../realtime';
import type { NoteRef, WsEvent } from '../types';

export interface FolderNode {
  /** Vault-relative folder path ('' = vault root). */
  path: string;
  name: string;
  depth: number;
  children: FolderNode[];
  /** Notes directly inside this folder. */
  notes: NoteRef[];
  /** Notes in this folder and every descendant. */
  total: number;
}

export type SortKey = 'mtime' | 'name' | 'folder';
export type ListFilter = 'all' | 'agents' | 'pinned' | 'recent';

interface Prefs {
  folder: string | null;
  sort: SortKey;
  dir: 1 | -1;
  filter: ListFilter;
  treeW: number;
  showNotesInTree: boolean;
  view: 'list' | 'cards';
}

const LS_PREFS = 'memora.vault.v1';
const LS_OPEN = 'memora.vault.open.v1';

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full or blocked */
  }
}

export const prefs: Prefs = readLS<Prefs>(LS_PREFS, {
  folder: null,
  sort: 'mtime',
  dir: -1,
  filter: 'all',
  treeW: 264,
  showNotesInTree: false,
  view: 'list',
});
// A saved 'agents' filter falls back to All.
if (prefs.filter === 'agents') prefs.filter = 'all';
export function savePrefs(): void {
  writeLS(LS_PREFS, prefs);
}

/** Expanded folder paths (full paths); every load starts with all folders closed. */
export const openFolders = new Set<string>();
export function saveOpen(): void {
  writeLS(LS_OPEN, Array.from(openFolders));
}

/** Selected note paths in the list (multi-select). */
export const selection = new Set<string>();

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}
export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}
/** What the vault root is called on screen (breadcrumbs, trees, pickers). */
export const ROOT_LABEL = 'All notes';

/** The API names the vault root "Root". */
export function apiFolder(path: string): string {
  return path === '' ? 'Root' : path;
}
export function isInside(child: string, parent: string): boolean {
  return parent === '' ? true : child === parent || child.startsWith(parent + '/');
}

let cachedSig = '';
let cachedTree: unknown = null;
let cachedRoot: FolderNode | null = null;
const byPath = new Map<string, FolderNode>();

export function folderTree(): FolderNode {
  const notes = allNotes();
  const sig = Object.keys(state.tree).join('|') + '#' + state.folders.join('|') + '#' + notes.map((n) => n.path).join('|');
  // Identity catches a reloaded payload with the same paths; the signature catches in-place edits.
  if (cachedRoot && cachedTree === state.tree && sig === cachedSig) return cachedRoot;
  byPath.clear();
  const root: FolderNode = { path: '', name: ROOT_LABEL, depth: 0, children: [], notes: [], total: 0 };
  byPath.set('', root);
  const ensure = (path: string): FolderNode => {
    const hit = byPath.get(path);
    if (hit) return hit;
    const parent = ensure(dirOf(path));
    const node: FolderNode = {
      path,
      name: baseName(path),
      depth: parent.depth + 1,
      children: [],
      notes: [],
      total: 0,
    };
    parent.children.push(node);
    byPath.set(path, node);
    return node;
  };
  for (const f of Object.keys(state.tree)) if (f !== 'Root') ensure(f);
  // Empty and nested folders the server knows, so a new folder shows at once.
  for (const f of state.folders) ensure(f);
  for (const n of notes) ensure(dirOf(n.path)).notes.push(n);
  const count = (f: FolderNode): number => {
    f.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    f.total = f.notes.length + f.children.reduce((s, c) => s + count(c), 0);
    return f.total;
  };
  count(root);
  cachedRoot = root;
  cachedTree = state.tree;
  cachedSig = sig;
  return root;
}

export function folderAt(path: string): FolderNode | null {
  folderTree();
  return byPath.get(path) || null;
}

function allFolderPaths(): string[] {
  folderTree();
  return Array.from(byPath.keys()).sort((a, b) => a.localeCompare(b));
}

/** Every folder to offer in a folder picker, sorted, without ''. */
export function pickerFolders(): string[] {
  const out = new Set(allFolderPaths());
  for (const f of state.folders) out.add(f);
  out.delete('');
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

/** Every note below a folder (recursive). */
export function notesUnder(path: string): NoteRef[] {
  return allNotes().filter((n) => isInside(dirOf(n.path), path));
}

export function folderColor(path: string): string {
  if (path === '') return 'var(--accent)';
  const meta = state.folderMeta[path];
  if (meta && meta.color) return meta.color;
  // Sub folders inherit the color of the closest colored ancestor.
  let p = dirOf(path);
  while (p) {
    const m = state.folderMeta[p];
    if (m && m.color) return m.color;
    p = dirOf(p);
  }
  return hashColor(path.split('/')[0]);
}

export function folderIcon(path: string): string {
  const meta = state.folderMeta[path];
  return (meta && meta.icon) || '';
}

// Pins live on the server (/api/pins), which rewrites them on renames and moves and says
// `pins_changed`. Local changes show at once, are sent in order, and the server's answer
// replaces the list once nothing else is in flight.

export interface PinItem {
  kind: 'note' | 'folder';
  key: string;
  /** The path no longer exists (renamed or deleted outside Memora). */
  missing?: boolean;
}

interface PinsReply {
  pins: { kind: 'note' | 'folder'; path: string; missing: boolean }[];
}

let pinList: PinItem[] = [];
/** Requests queued or running; replies only land when this drops to zero. */
let pinBusy = 0;
let pinQueue: Promise<unknown> = Promise.resolve();
const pinSubs = new Set<() => void>();

/** Called whenever the pinned list changes (local edit or server reload). */
export function onPinsSynced(fn: () => void): () => void {
  pinSubs.add(fn);
  return () => pinSubs.delete(fn);
}
function pinsSynced(): void {
  pinSubs.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  });
}

const samePin = (a: PinItem, b: PinItem): boolean => a.kind === b.kind && a.key === b.key;

/** A pin's id, as the tree keys its row (`pin:<id>`). */
const pinId = (p: { kind: string; key: string }): string => p.kind + ':' + p.key;

/** How long a new pin row shows its arrival (slide in, accent highlight). */
export const PIN_FX_MS = 1400;
/** Pins that just arrived: id -> when (performance.now()). */
const pinFresh = new Map<string, number>();

function markFresh(it: PinItem): void {
  const now = performance.now();
  for (const [k, at] of pinFresh) if (now - at > PIN_FX_MS) pinFresh.delete(k);
  pinFresh.set(pinId(it), now);
}

/** Milliseconds since the pin arrived while its arrival still shows, else -1. */
export function pinFreshAge(it: PinItem): number {
  const at = pinFresh.get(pinId(it));
  if (at == null) return -1;
  const age = performance.now() - at;
  return age < PIN_FX_MS ? age : -1;
}

/** Who changed the pins over MCP (from `pins_changed`), until the reload lands. */
let pinsBy: (PinsChange & { at: number }) | null = null;
/** The first server list fills the sidebar without any arrival effect. */
let pinsLoaded = false;

const pinLabel = (p: PinItem): string => (p.kind === 'note' ? noteTitle(p.key) : baseName(p.key));

/** "agent1 pinned Plan" / "agent1 unpinned Plan", under the activity toast settings. */
function toastAgentPins(by: PinsChange, added: PinItem[], removed: PinItem[]): void {
  if (by.kind !== 'agent' || state.editing || state.page === 'brain') return;
  if (!activityToastAllowed(by.actorId)) return;
  const say = (verb: string, list: PinItem[]): void => {
    if (!list.length) return;
    const what = list.length === 1 ? pinLabel(list[0]) : `${list.length} items`;
    toast(`${by.actor} ${verb} ${what}`, 'ok', 3200);
  };
  say('pinned', added);
  say('unpinned', removed);
}

function applyPins(r: PinsReply | null): void {
  if (!r || !Array.isArray(r.pins)) return;
  const before = pinList;
  pinList = r.pins.map((p) => ({ kind: p.kind, key: p.path, missing: !!p.missing }));
  const by = pinsBy && performance.now() - pinsBy.at < 10_000 ? pinsBy : null;
  pinsBy = null;
  if (pinsLoaded) {
    // Pins from elsewhere show their arrival; a bulk change (vault switch, Settings) just appears.
    const added = pinList.filter((p) => !before.some((b) => samePin(b, p)));
    const removed = before.filter((b) => !pinList.some((p) => samePin(b, p)));
    if (added.length <= 6) added.forEach(markFresh);
    if (by) toastAgentPins(by, added, removed);
  }
  pinsLoaded = true;
  pinsSynced();
}

/** Run a pin request after the ones before it; `quiet` failures only reload. */
function pinRequest(run: () => Promise<PinsReply>, quiet = false): Promise<void> {
  pinBusy++;
  const job = pinQueue.then(run).then(
    (r) => {
      pinBusy--;
      if (!pinBusy) applyPins(r);
    },
    (e: Error) => {
      pinBusy--;
      if (!quiet) {
        toast('Could not save pins: ' + e.message, 'err');
        void loadPins();
      }
    },
  );
  pinQueue = job;
  return job;
}

/** Re-read the pins from the server (keeps the last list when offline). */
export function loadPins(): Promise<void> {
  return pinRequest(() => apiGet<PinsReply>('/api/pins'), true);
}

/** This browser's old pins that the server will take (it checks them again). */
function legacyUpload(): { kind: 'note' | 'folder'; path: string }[] {
  const ok = (p: { kind: string; path: string }): boolean =>
    !!p.path &&
    !p.path.split('/').some((seg) => !seg || seg.startsWith('.')) &&
    (p.kind === 'folder' || p.path.endsWith('.md'));
  return legacyPins().filter(ok).slice(0, 200);
}

/** First load: the server's list, after a one-time upload of this browser's old pins when it has none. */
function firstPinLoad(): void {
  void pinRequest(async () => {
    const r = await apiGet<PinsReply>('/api/pins');
    const local = legacyUpload();
    if (!r.pins.length && local.length) {
      const up = await api<PinsReply>('/api/pins', { method: 'PUT', body: { pins: local } });
      clearLegacyPins();
      return up;
    }
    if (legacyPins().length) clearLegacyPins();
    return r;
  }, true);
}

export function pinnedItems(): PinItem[] {
  return pinList.slice();
}

export function isPinned(kind: 'note' | 'folder', key: string): boolean {
  return pinList.some((p) => p.kind === kind && p.key === key);
}

/** Pin (at `index`, default end) or move an existing pin to `index`. */
export function pinAt(item: PinItem, index?: number): void {
  const had = pinList.find((p) => samePin(p, item));
  const order = pinList.filter((p) => !samePin(p, item));
  const at = index == null ? order.length : Math.max(0, Math.min(order.length, index));
  order.splice(at, 0, { kind: item.kind, key: item.key, missing: had ? had.missing : false });
  pinList = order;
  if (!had) markFresh(item);
  pinsSynced();
  if (had) {
    // A reorder: send the whole list.
    const body = { pins: order.map((p) => ({ kind: p.kind, path: p.key })) };
    void pinRequest(() => api<PinsReply>('/api/pins', { method: 'PUT', body }));
  } else {
    const body = { kind: item.kind, path: item.key, position: at };
    void pinRequest(() => apiPost<PinsReply>('/api/pins/pin', body));
  }
}

export function unpin(item: PinItem): void {
  pinList = pinList.filter((p) => !samePin(p, item));
  pinsSynced();
  const body = { kind: item.kind, path: item.key };
  void pinRequest(() => apiPost<PinsReply>('/api/pins/unpin', body));
}

export function togglePin(item: PinItem): boolean {
  if (isPinned(item.kind, item.key)) {
    unpin(item);
    return false;
  }
  pinAt(item);
  return true;
}

/** Remove every pin (Settings). */
export function clearPins(): Promise<void> {
  pinList = [];
  pinsSynced();
  return pinRequest(() => api<PinsReply>('/api/pins', { method: 'PUT', body: { pins: [] } }));
}

/** Rewrite selection and activity after a note moved or was renamed (the server rewrites pins). */
export function notePathChanged(from: string, to: string | null): void {
  if (selection.delete(from) && to) selection.add(to);
  if (state.note === from) state.note = to;
  const t = touched.get(from);
  if (t && to) {
    touched.delete(from);
    touched.set(to, t);
  }
}

/** Rewrite expansion and preferences after a folder moved (the server rewrites pins). */
export function folderPathChanged(from: string, to: string | null): void {
  const remap = (p: string): string | null =>
    p === from || p.startsWith(from + '/') ? (to == null ? null : to + p.slice(from.length)) : p;
  for (const p of Array.from(openFolders)) {
    const r = remap(p);
    openFolders.delete(p);
    if (r != null) openFolders.add(r);
  }
  saveOpen();
  if (prefs.folder != null) {
    const r = remap(prefs.folder);
    prefs.folder = r;
    savePrefs();
  }
}

// Agent activity: which notes agents touched recently this session.

export interface Touch {
  actor: string;
  action: string;
  at: number;
}

export const touched = new Map<string, Touch>();
const me = (): string => (state.me && (state.me.user || state.me.username)) || '';

type Listener = () => void;
const listeners = new Set<Listener>();
/** Called on every activity or mutation the vault UI cares about. */
export function onVaultChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  });
}

export function initials(name: string): string {
  const parts = String(name || '?')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** An agent working on a note right now (coin in the tree). */
export interface Presence {
  actor: string;
  id?: string;
  at: number;
}

/** How long a call keeps an agent "on" a note. */
const PRESENCE_MS = 90_000;
const presence = new Map<string, Map<string, Presence>>();

function present(path: string, actor: string, id?: string): void {
  if (!path || !actor || actor === me()) return;
  const p = path.endsWith('.md') ? path : path + '.md';
  const m = presence.get(p) || new Map<string, Presence>();
  m.set(id || actor, { actor, id, at: Date.now() });
  presence.set(p, m);
}

/** An agent is wherever its latest call was: clear it from every other note first. */
function moveAgent(key: string, keep: Set<string>): void {
  for (const [p, m] of presence) {
    if (keep.has(p)) continue;
    if (m.delete(key) && !m.size) presence.delete(p);
  }
}

/** Agents working right now, by key id or name (the same "active" as the header's Live pill). */
function activeKeys(): Set<string> {
  const out = new Set<string>();
  for (const a of activeAgents()) {
    if (a.id) out.add(a.id);
    out.add(a.actor);
  }
  return out;
}

/** Agents active on a note, or (`folder`) anywhere below a folder: one per agent, most recent first. */
export function agentsAt(path: string, folder = false): Presence[] {
  const now = Date.now();
  const busy = activeKeys();
  const out = new Map<string, Presence>();
  for (const [p, m] of presence) {
    if (folder ? !isInside(dirOf(p), path) : p !== path) continue;
    for (const [k, v] of m) {
      // Only agents working right now carry a coin.
      if (now - v.at > PRESENCE_MS || !busy.has(k)) continue;
      const cur = out.get(k);
      if (!cur || cur.at < v.at) out.set(k, v);
    }
  }
  return [...out.values()].sort((a, b) => b.at - a.at);
}

// Drop stale presence, and repaint when an agent starts or stops working, so coins come and go live.
let lastBusy = '';
setInterval(() => {
  const now = Date.now();
  let gone = false;
  for (const [p, m] of presence) {
    for (const [k, v] of m) if (now - v.at > PRESENCE_MS) (m.delete(k), (gone = true));
    if (!m.size) presence.delete(p);
  }
  const busy = [...activeKeys()].sort().join('|');
  if (busy !== lastBusy) (lastBusy = busy), (gone = true);
  if (gone) notify();
}, 1_000);

function touch(path: string, actor: string, action: string): void {
  if (!path || !actor || actor === me()) return;
  const p = path.endsWith('.md') ? path : path + '.md';
  touched.set(p, { actor, action, at: Date.now() });
}

interface MutationInfo {
  type: string;
  actor: string;
  path: string;
  oldPath: string;
}

export function mutationInfo(ev: WsEvent): MutationInfo {
  const node = (ev.node || {}) as { path?: string };
  return {
    type: String(ev.type || ''),
    actor: String(ev.actor || ''),
    path: String(node.path || ev.path || ''),
    oldPath: String(ev.old_path || ''),
  };
}

let pinReload = 0;
function schedulePinReload(): void {
  clearTimeout(pinReload);
  pinReload = window.setTimeout(() => void loadPins(), 400);
}

let wired = false;
/** Subscribe once to the bus; the sidebar tree is always on screen. */
export function wireBus(): void {
  if (wired) return;
  wired = true;
  firstPinLoad();
  on('pins', (by) => {
    if (by) pinsBy = { ...by, at: performance.now() };
    void loadPins();
  });
  // Back online or a returning tab: events may have been missed.
  on('connection', (c) => {
    if (c === 'on') void loadPins();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void loadPins();
  });
  on('activity', (a) => {
    if (!a || !a.paths || !a.paths.length) return;
    if (a.kind !== 'user') moveAgent(a.actorId || a.actor, new Set(a.paths.map((p) => (p.endsWith('.md') ? p : p + '.md'))));
    for (const p of a.paths) {
      touch(p, a.actor, a.action);
      if (a.kind !== 'user') present(p, a.actor, a.actorId);
    }
    notify();
  });
  on('mutation', (ev) => {
    const m = mutationInfo(ev);
    if (m.type === 'node_renamed' && m.oldPath && m.path) notePathChanged(m.oldPath, m.path);
    if (m.type === 'node_deleted' && m.path) notePathChanged(m.path, null);
    if (m.path && m.type !== 'node_deleted') touch(m.path, m.actor, m.type.replace('node_', ''));
    // A note came back or went away: its pin's "Not found" mark may change.
    if (m.type === 'node_created' || m.type === 'node_deleted') schedulePinReload();
    notify();
  });
}
