// Activity page state: filters, event classification and agent classes.

import { rangeWindow, settleRunning, verb, type ActivityItem, type FeedRange, type Source } from '../control/feed';
import { isSystem, problemOf, sentenceText } from '../control/sentence';
import type { KeyRow } from '../types';

export type Cat = 'read' | 'search' | 'write' | 'delete' | 'auth' | 'other';
export type St = 'ok' | 'fail' | 'running';
export type TimeKey = '1h' | 'today' | '1d' | '7d' | '30d' | 'all' | 'custom';
type AgentClass = 'active' | 'recent' | 'idle' | 'removed' | 'people';

export const CATS: { id: Cat; label: string; hint: string }[] = [
  { id: 'read', label: 'Reads', hint: 'Opened or looked through notes' },
  { id: 'search', label: 'Searches', hint: 'Searched or looked for similar notes' },
  { id: 'write', label: 'Changes', hint: 'Created, edited, moved, tagged' },
  { id: 'delete', label: 'Deletes', hint: 'Deleted or moved to Trash' },
  { id: 'auth', label: 'Sign-in & keys', hint: 'Sign-ins, AI keys, access rules' },
  { id: 'other', label: 'Other', hint: 'Everything else' },
];

export const SRCS: { id: Source; label: string; hint: string }[] = [
  { id: 'agent', label: 'AI apps', hint: 'What your connected AIs did' },
  { id: 'vault', label: 'Note changes', hint: 'Notes changed in the app or in the folder' },
  { id: 'auth', label: 'Sign-in & keys', hint: 'Sign-ins, AI keys and access' },
];

export const STATUSES: { id: St; label: string }[] = [
  { id: 'ok', label: 'Done' },
  { id: 'fail', label: 'Failed or refused' },
  { id: 'running', label: 'Working' },
];

export const TIMES: { id: TimeKey; label: string; short: string }[] = [
  { id: '1h', label: 'Last hour', short: '1h' },
  { id: 'today', label: 'Today', short: 'Today' },
  { id: '1d', label: 'Last 24 hours', short: '24h' },
  { id: '7d', label: 'Last 7 days', short: '7d' },
  { id: '30d', label: 'Last 30 days', short: '30d' },
  { id: 'all', label: 'All time', short: 'All' },
];

export const CLASSES: { id: AgentClass; label: string }[] = [
  { id: 'active', label: 'Active now' },
  { id: 'recent', label: 'Seen recently' },
  { id: 'idle', label: 'Idle' },
  { id: 'removed', label: 'No longer connected' },
  { id: 'people', label: 'People & server' },
];

export interface Filters {
  time: TimeKey;
  /** Custom range, local `YYYY-MM-DD` days (inclusive). */
  from: string;
  to: string;
  cats: Set<Cat>;
  actions: Set<string>;
  srcs: Set<Source>;
  agents: Set<string>;
  status: Set<St>;
  /** Show server, sign-in and other system lines too. */
  system: boolean;
  q: string;
}

export const F: Filters = {
  time: '7d',
  from: '',
  to: '',
  cats: new Set(),
  actions: new Set(),
  srcs: new Set(),
  agents: new Set(),
  status: new Set(),
  system: false,
  q: '',
};

export type Facet = 'cats' | 'srcs' | 'agents' | 'status' | 'q';

const DELETE_RE = /(^|_)(delete|soft_delete|bulk_delete|purge|trash)|_deleted$|^deleted?$/;
const SEARCH_RE = /search|query|find_|similar|suggest/;
const READ_RE =
  /^(get_|list_|read_|link_stats|folder_stats|broken_links|diff|digest|healthcheck|stale_detection|validate_|presence|follow_ups|export_)/;
const WRITE_RE =
  /create|save|patch|move|rename|merge|^set_|add_|remove_tags|import|batch|duplicate|lock|release|restore|template|mention|_updated$|_created$|_moved$|_renamed$|replace/;
const AUTH_RE = /login|logout|key_|session|oauth|access|password|passkey|totp|token|signin|signout/;

/** Action type of one event. */
export function catOf(it: ActivityItem): Cat {
  const a = it.action.toLowerCase();
  if (it.source === 'auth' || AUTH_RE.test(a)) return 'auth';
  if (DELETE_RE.test(a)) return 'delete';
  if (SEARCH_RE.test(a)) return 'search';
  if (READ_RE.test(a)) return 'read';
  if (WRITE_RE.test(a)) return 'write';
  return 'other';
}

export function stOf(it: ActivityItem): St {
  if (settleRunning(it)) return 'running';
  return problemOf(it) ? 'fail' : 'ok';
}

/** Local `YYYY-MM-DD` of a unix-seconds time. */
export function isoDay(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function midnight(day: string, plusDays = 0): number {
  const d = new Date(day + 'T00:00:00');
  d.setDate(d.getDate() + plusDays);
  return d.getTime() / 1000;
}

/** Range the server is asked for; short ranges load 7 days and the window is cut client side. */
export function feedRange(t: Pick<Filters, 'time'> = F): FeedRange['range'] {
  if (t.time === '30d' || t.time === 'all') return t.time;
  return t.time === 'custom' ? 'all' : '7d';
}

/** `[since, until)` of the selected time, unix seconds. */
export function timeWindow(): { since: number; until: number } {
  return windowOf(F);
}

/** `[since, until)` of any time selection (the page filters or an agent page's own). */
export function windowOf(t: Pick<Filters, 'time' | 'from' | 'to'>): { since: number; until: number } {
  if (t.time !== 'custom') return rangeWindow(t.time);
  return {
    since: t.from ? midnight(t.from) : 0,
    until: t.to ? midnight(t.to, 1) : Infinity,
  };
}

export function timeLabel(): string {
  return labelOf(F);
}

export function labelOf(t: Pick<Filters, 'time' | 'from' | 'to'>): string {
  if (t.time !== 'custom') return TIMES.find((x) => x.id === t.time)!.label;
  const fmt = (d: string): string => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (t.from && t.to) return t.from === t.to ? fmt(t.from) : `${fmt(t.from)} – ${fmt(t.to)}`;
  if (t.from) return `Since ${fmt(t.from)}`;
  if (t.to) return `Until ${fmt(t.to)}`;
  return 'All time';
}

export function searchText(it: ActivityItem): string {
  const r = it.raw as Record<string, unknown>;
  const extra = [r.detail, r.error, r.event, r.call_id].filter((v) => typeof v === 'string').join(' ');
  return `${sentenceText(it)} ${it.actor} ${it.action} ${verb(it.action)} ${it.label} ${it.paths.join(' ')} ${it.ip || ''} ${extra}`.toLowerCase();
}

/** Whether an event passes every filter (time excluded), optionally skipping one facet. */
export function matches(it: ActivityItem, skip?: Facet): boolean {
  if (isSystem(it) && !systemShown(it, skip)) return false;
  if (skip !== 'cats' && (F.cats.size || F.actions.size)) {
    if (!F.cats.has(catOf(it)) && !F.actions.has(it.action)) return false;
  }
  if (skip !== 'srcs' && F.srcs.size && !F.srcs.has(it.source)) return false;
  if (skip !== 'agents' && F.agents.size && !F.agents.has(it.actor)) return false;
  if (skip !== 'status' && F.status.size && !F.status.has(stOf(it))) return false;
  if (skip !== 'q' && F.q) {
    const hay = searchText(it);
    if (!F.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
  }
  return true;
}

export function inWindow(items: ActivityItem[]): ActivityItem[] {
  const w = timeWindow();
  return items.filter((x) => x.ts >= w.since && x.ts < w.until);
}

/** System lines show when asked for, or when a filter (or the facet being counted) points at them. */
export function systemShown(it: ActivityItem, skip?: Facet): boolean {
  if (F.system) return true;
  if (it.source === 'auth' && (F.srcs.has('auth') || F.cats.has('auth') || skip === 'srcs' || skip === 'cats')) return true;
  // A note event repeating an AI's own call only shows with everything else.
  return !it.echo && (F.agents.has(it.actor) || skip === 'agents');
}

/** Filters set besides time and search (time has its own control). */
export function activeCount(): number {
  return F.cats.size + F.actions.size + F.srcs.size + F.agents.size + F.status.size + (F.system ? 1 : 0);
}

/** The quick filter pills above the list: each sets the action types and status at once. */
export type Quick = 'all' | 'write' | 'read' | 'search' | 'fail';
export const QUICK: { id: Quick; label: string; cats: Cat[]; status: St[] }[] = [
  { id: 'all', label: 'All', cats: [], status: [] },
  { id: 'write', label: 'Changes', cats: ['write', 'delete'], status: [] },
  { id: 'read', label: 'Reads', cats: ['read'], status: [] },
  { id: 'search', label: 'Searches', cats: ['search'], status: [] },
  { id: 'fail', label: 'Problems', cats: [], status: ['fail'] },
];

type QuickState = { cats: Set<Cat>; status: Set<St>; actions: Set<string> };

/** The pill the current action types and status match exactly, or null for another mix. */
export function quickOf(f: QuickState = F): Quick | null {
  if (f.actions.size) return null;
  const same = <T>(a: Set<T>, b: T[]): boolean => a.size === b.length && b.every((x) => a.has(x));
  return QUICK.find((q) => same(f.cats, q.cats) && same(f.status, q.status))?.id ?? null;
}

export function setQuick(id: Quick, f: QuickState = F): void {
  const q = QUICK.find((x) => x.id === id)!;
  f.cats = new Set(q.cats);
  f.status = new Set(q.status);
  f.actions = new Set();
}

export function clearFilters(keepTime = false): void {
  F.cats.clear();
  F.actions.clear();
  F.srcs.clear();
  F.agents.clear();
  F.status.clear();
  F.system = false;
  if (!keepTime) {
    F.time = '7d';
    F.from = F.to = '';
  }
}

export interface AgentInfo {
  name: string;
  id: string | null;
  cls: AgentClass;
  /** Events in the selected range (other filters applied, the agent filter not). */
  n: number;
  fails: number;
  nodes: number;
  last: ActivityItem | null;
  /** Last activity seen at all (any range we loaded). */
  lastTs: number;
  disabled?: boolean;
}

const ACTIVE_SECS = 300;
const RECENT_SECS = 86400;

/** Every actor in the loaded events (`all`) plus every key, classified; counts come from `scoped`. */
export function classifyAgents(all: ActivityItem[], scoped: ActivityItem[], keys: KeyRow[]): AgentInfo[] {
  const now = Date.now() / 1000;
  const byName = new Map<string, AgentInfo>();
  const keyById = new Map(keys.map((k) => [k.id, k]));
  const keyByName = new Map(keys.map((k) => [(k.name || k.id).toLowerCase(), k]));
  const get = (name: string): AgentInfo => {
    let a = byName.get(name);
    if (!a) {
      a = { name, id: null, cls: 'people', n: 0, fails: 0, nodes: 0, last: null, lastTs: 0 };
      byName.set(name, a);
    }
    return a;
  };
  const isAgent = new Set<string>();
  const running = new Set<string>();
  for (const it of all) {
    const a = get(it.actor);
    if (it.ts > a.lastTs) a.lastTs = it.ts;
    const kid = typeof it.raw.actor_id === 'string' ? it.raw.actor_id : null;
    if (kid && !a.id && kid.startsWith('k_')) a.id = kid;
    if (it.source === 'agent' || it.raw.actor_kind === 'agent') isAgent.add(it.actor);
    if (it.running) running.add(it.actor);
  }
  for (const k of keys) {
    const a = get(k.name || k.id);
    a.id = k.id;
    a.disabled = k.enabled === false;
    isAgent.add(a.name);
  }
  const nodes = new Map<string, Set<string>>();
  for (const it of scoped) {
    const a = get(it.actor);
    a.n++;
    if (it.ok === false) a.fails++;
    if (!a.last) a.last = it;
    if (!nodes.has(it.actor)) nodes.set(it.actor, new Set());
    it.paths.forEach((p) => nodes.get(it.actor)!.add(p));
  }
  for (const a of byName.values()) {
    a.nodes = nodes.get(a.name)?.size || 0;
    const key = (a.id && keyById.get(a.id)) || keyByName.get(a.name.toLowerCase());
    if (!isAgent.has(a.name)) a.cls = 'people';
    else if (!key) a.cls = 'removed';
    else if (running.has(a.name) || now - a.lastTs < ACTIVE_SECS) a.cls = 'active';
    else if (now - a.lastTs < RECENT_SECS) a.cls = 'recent';
    else a.cls = 'idle';
  }
  const order: AgentClass[] = CLASSES.map((c) => c.id);
  return [...byName.values()].sort(
    (x, y) => order.indexOf(x.cls) - order.indexOf(y.cls) || y.n - x.n || y.lastTs - x.lastTs || x.name.localeCompare(y.name),
  );
}
