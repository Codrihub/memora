// Activity feed: one item shape for the vault log, the auth audit trail and live bus events.

import { apiGet } from '../api';
import { on, type AgentActivity } from '../bus';
import type { LogEvent, LogsResult } from '../types';
import { reconcile } from './sentence';

export type Source = 'agent' | 'vault' | 'auth';

export interface ActivityItem {
  id: string;
  ts: number;
  actor: string;
  action: string;
  label: string;
  paths: string[];
  source: Source;
  /** undefined while the call is running or when the server did not say. */
  ok?: boolean;
  ms?: number;
  /** A `start` with no `end` yet. */
  running?: boolean;
  ip?: string;
  live?: boolean;
  /** A note event that only repeats an agent's own call (see `reconcile`). */
  echo?: boolean;
  raw: Record<string, unknown>;
}

let seq = 0;
const nextId = (): string => 'a' + (++seq).toString(36);

const FAIL_RE = /(fail|denied|invalid|blocked|reject|error|locked)/i;

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function pathsOf(e: LogEvent): string[] {
  const out = new Set<string>();
  const arr = (e as { paths?: unknown }).paths;
  if (Array.isArray(arr)) arr.forEach((p) => typeof p === 'string' && p && out.add(p));
  if (e.path) out.add(e.path);
  if (e.node && e.node.path) out.add(e.node.path);
  const lbl = str(e.label);
  if (/\.md$/i.test(lbl) && !/\s/.test(lbl)) out.add(lbl);
  return [...out];
}

/** A row from /api/logs (vault CRUD and agent activity). */
export function fromLog(e: LogEvent): ActivityItem {
  const isAgent = e.type === 'ai_activity';
  const okRaw = (e as { ok?: unknown }).ok;
  const msRaw = (e as { ms?: unknown }).ms;
  return {
    id: nextId(),
    ts: Number(e._ts || e.ts || (e as { at?: number }).at || 0),
    actor: str(e.actor || e.by || e.user) || 'system',
    action: str(e.action || e.event || e.type) || 'activity',
    label: str(e.label || (e.node && (e.node.path || e.node.id)) || e.path || e.folder || e.detail || ''),
    paths: pathsOf(e),
    source: isAgent ? 'agent' : 'vault',
    ok: typeof okRaw === 'boolean' ? okRaw : undefined,
    ms: typeof msRaw === 'number' ? msRaw : undefined,
    // A start that already carries its outcome (read-only tools log it after the call) is done.
    running: isAgent && e.phase === 'start' && typeof okRaw !== 'boolean' ? true : undefined,
    raw: e as Record<string, unknown>,
  };
}

/** A row from /api/auth/events (sign-in, keys, access rules). */
export function fromAuth(e: LogEvent): ActivityItem {
  const ev = str(e.event || e.type) || 'auth';
  return {
    id: nextId(),
    ts: Number((e as { at?: number }).at || e.ts || 0),
    actor: str(e.user || e.actor) || 'gateway',
    action: ev,
    label: str(e.detail || ''),
    paths: [],
    source: 'auth',
    ok: !FAIL_RE.test(ev),
    ip: str((e as { ip?: string }).ip) || undefined,
    raw: e as Record<string, unknown>,
  };
}

/** A live bus event. */
function fromBus(a: AgentActivity): ActivityItem {
  return {
    id: nextId(),
    ts: (a.at || Date.now()) / 1000,
    actor: a.actor || 'agent',
    action: a.action || 'activity',
    label: a.label || '',
    paths: Array.isArray(a.paths) ? a.paths.filter(Boolean) : [],
    source: 'agent',
    ok: a.ok,
    ms: a.ms,
    running: a.phase === 'start' ? true : undefined,
    live: true,
    // Same field names as stored rows, so readers can tell same-named keys apart.
    raw: {
      ...a,
      ...(a.actorId ? { actor_id: a.actorId } : {}),
      ...(a.callId ? { call_id: a.callId } : {}),
    } as unknown as Record<string, unknown>,
  };
}

/** Calls whose `end` arrived live, by call id (the log stores only starts). */
const ended = new Map<string, { ok?: boolean; ms?: number }>();
const ENDED_MAX = 1000;

/** Record a call's live `end`, so a start loaded from the log later is not shown as running. */
export function noteCallEnd(callId: string, ok?: boolean, ms?: number): void {
  ended.delete(callId);
  ended.set(callId, { ok, ms });
  if (ended.size > ENDED_MAX) ended.delete(ended.keys().next().value as string);
}

/** Close a running item whose end was seen live. Returns whether it did. */
function closeEnded(it: ActivityItem): boolean {
  if (!it.running) return false;
  const e = ended.get(str((it.raw as { call_id?: unknown }).call_id));
  if (!e) return false;
  it.running = false;
  it.ok = e.ok ?? true;
  if (e.ms != null) it.ms = e.ms;
  return true;
}

/** Whether an item still counts as running; ends are never stored, so old starts time out (30 s logged, 2 min live). */
export function settleRunning(it: ActivityItem, now = Date.now() / 1000): boolean {
  if (!it.running) return false;
  if (closeEnded(it)) return false;
  if (now - it.ts > (it.live ? 120 : 30)) it.running = false;
  return !!it.running;
}

/** Merge `end` phases into their `start`. Input oldest first; returns newest first. */
export function mergePhases(items: ActivityItem[]): ActivityItem[] {
  const out: ActivityItem[] = [];
  const open = new Map<string, ActivityItem[]>();
  for (const it of items.sort((a, b) => a.ts - b.ts)) {
    const phase = str((it.raw as { phase?: unknown }).phase);
    const k = it.actor + '\u0000' + it.action;
    if (phase === 'end') {
      const q = open.get(k);
      const start = q && q.shift();
      if (start && it.ts - start.ts < 600) {
        start.running = false;
        start.ok = it.ok ?? true;
        start.ms = it.ms ?? Math.round((it.ts - start.ts) * 1000);
        if (it.paths.length) start.paths = [...new Set([...start.paths, ...it.paths])];
        if (it.label && !start.label) start.label = it.label;
        continue;
      }
      it.running = false;
      out.push(it);
      continue;
    }
    if (phase === 'start') {
      if (!open.has(k)) open.set(k, []);
      open.get(k)!.push(it);
    }
    out.push(it);
  }
  // `end` phases are never persisted, so a stored start is only "running" while fresh.
  const stale = Date.now() / 1000 - 30;
  for (const it of out) if (!closeEnded(it) && it.running && it.ts < stale) it.running = false;
  reconcile(out);
  return out.reverse();
}

export interface FeedRange {
  /** `1h` is served from the 1d log; `day:YYYY-MM-DD` is one local day. */
  range: '1h' | '1d' | '7d' | '30d' | 'today' | 'all' | `day:${string}`;
}

const RANGE_SECS: Record<string, number> = { '1h': 3600, '1d': 86400, '7d': 604800, '30d': 2592000 };

/** Local midnight of a `YYYY-MM-DD` day (or today), in unix seconds. */
function midnight(day?: string): number {
  const d = day ? new Date(day + 'T00:00:00') : new Date();
  if (!day) d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}

/** `[since, until)` of a range in unix seconds (`until` = Infinity when open). */
export function rangeWindow(r: FeedRange['range']): { since: number; until: number } {
  if (r === 'all') return { since: 0, until: Infinity };
  if (r === 'today') return { since: midnight(), until: Infinity };
  if (r.startsWith('day:')) {
    const since = midnight(r.slice(4));
    // Next local midnight (DST-safe: build the date, not +86400).
    const next = new Date(since * 1000);
    next.setDate(next.getDate() + 1);
    return { since, until: next.getTime() / 1000 };
  }
  return { since: Date.now() / 1000 - (RANGE_SECS[r] || 86400), until: Infinity };
}

/** The server answers at most this many log events per request. */
const LOG_PAGE = 2000;

const evTs = (e: LogEvent): number => Number(e._ts || e.ts || (e as { at?: number }).at || 0);

/** The vault log for a window, newest first; asks above LOG_PAGE walk back page by page. */
async function loadLog(q: string, w: { since: number; until: number }, limit: number, onPage?: (sofar: LogEvent[]) => void): Promise<LogEvent[]> {
  if (limit <= LOG_PAGE) return (await apiGet<LogsResult>(`/api/logs?${q}&limit=${limit}`)).events || [];
  const out: LogEvent[] = [];
  const seen = new Set<string>();
  let until = w.until;
  while (out.length < limit) {
    const since = w.since > 0 ? `&since=${Math.floor(w.since)}` : '';
    const upto = Number.isFinite(until) ? `&until=${until}` : '';
    const page = (await apiGet<LogsResult>(`/api/logs?range=all${since}${upto}&limit=${LOG_PAGE}`)).events || [];
    let added = 0;
    let oldest = Infinity;
    for (const e of page) {
      oldest = Math.min(oldest, evTs(e));
      // Pages overlap on the boundary second; keep each event once.
      const k = JSON.stringify(e);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
      added++;
    }
    if (page.length < LOG_PAGE || !added || !Number.isFinite(oldest)) break;
    onPage?.(out);
    until = oldest + 0.001;
  }
  return out.slice(0, limit);
}

/** Both server feeds for a range, merged, newest first; `onPage` gets partial results of a paged ask. */
export async function loadFeed(range: FeedRange['range'], limit = 800, onPage?: (sofar: ActivityItem[]) => void): Promise<ActivityItem[]> {
  const w = rangeWindow(range);
  const q =
    range === '1h'
      ? 'range=1d'
      : range === 'all' || /^\d+d$/.test(range)
        ? `range=${range}`
        : `range=1d&since=${Math.floor(w.since)}${Number.isFinite(w.until) ? `&until=${Math.ceil(w.until)}` : ''}`;
  const auth = await apiGet<LogsResult>('/api/auth/events?limit=300').catch(() => ({ events: [] }) as LogsResult);
  const authItems = (auth.events || []).map(fromAuth);
  const shape = (logs: LogEvent[]): ActivityItem[] =>
    mergePhases([...logs.map(fromLog), ...authItems.map((x) => ({ ...x }))].filter((i) => i.ts >= w.since && i.ts < w.until));
  const logs = await loadLog(q, w, limit, onPage && ((sofar) => onPage(shape(sofar)))).catch(() => [] as LogEvent[]);
  return shape(logs);
}

/** Add one live item to a newest-first list (merging an `end` into its start). */
export function pushLive(list: ActivityItem[], it: ActivityItem, max = 2000): ActivityItem[] {
  const phase = str((it.raw as { phase?: unknown }).phase);
  if (phase === 'end') {
    // Pair by call id so parallel calls of one tool don't close each other's rows.
    const cid = str((it.raw as { call_id?: unknown }).call_id);
    const start =
      (cid && list.find((x) => x.running && str((x.raw as { call_id?: unknown }).call_id) === cid)) ||
      list.find((x) => x.running && x.actor === it.actor && x.action === it.action);
    if (start) {
      start.running = false;
      start.ok = it.ok ?? true;
      start.ms = it.ms ?? Math.round((it.ts - start.ts) * 1000);
      if (it.paths.length) start.paths = [...new Set([...start.paths, ...it.paths])];
      return list;
    }
    it.running = false;
  }
  list.unshift(it);
  if (list.length > max) list.length = max;
  return list;
}

/** Live items held while paused: keeps the newest `max`, while `length` counts every arrival. */
export class PausedQueue {
  private items: ActivityItem[] = [];
  private count = 0;

  constructor(private readonly max = 2000) {}

  get length(): number {
    return this.count;
  }

  push(it: ActivityItem): void {
    this.items.push(it);
    this.count++;
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }

  /** Every kept item, oldest first, and empty the queue. */
  take(): ActivityItem[] {
    const out = this.items;
    this.items = [];
    this.count = 0;
    return out;
  }
}

/** Subscribe to live agent activity; returns the unsubscribe function. */
export function onLive(fn: (it: ActivityItem) => void): () => void {
  return on('activity', (a) => fn(fromBus(a)));
}

/** Human verb: `save_memory` -> "save memory". */
export function verb(action: string): string {
  return action.replace(/[_.]+/g, ' ').trim();
}
