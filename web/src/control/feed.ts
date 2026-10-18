// Activity feed shared by Overview and Activity: one normalized item shape for
// the vault log (/api/logs), the gateway audit trail (/api/auth/events) and
// live bus `activity` events. `start` and `end` phases of the same call are
// merged into one item that carries `ok` and `ms`.

import { apiGet } from '../api';
import { on, type AgentActivity } from '../bus';
import type { LogEvent, LogsResult } from '../types';

export type Source = 'agent' | 'vault' | 'auth';

export interface ActivityItem {
  id: string;
  /** Unix seconds. */
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
    running: isAgent && e.phase === 'start' ? true : undefined,
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
export function fromBus(a: AgentActivity): ActivityItem {
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
    // Stored log rows carry the key id as `actor_id`; give live rows the same
    // field so every reader can tell same-named keys apart.
    raw: { ...a, ...(a.actorId ? { actor_id: a.actorId } : {}) } as unknown as Record<string, unknown>,
  };
}

/**
 * Merge `end` phases into their `start`. Input oldest first; returns newest
 * first. An end with no start becomes its own item.
 */
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
  // `end` phases are realtime only (never persisted), so a stored start is
  // only "running" while it is fresh.
  const stale = Date.now() / 1000 - 30;
  for (const it of out) if (it.running && it.ts < stale) it.running = false;
  return out.reverse();
}

export interface FeedRange {
  /**
   * Rolling windows (`1h` is served from the 1d log), `today` (since local
   * midnight), `all` (everything the log still keeps) or one local day `day:YYYY-MM-DD`.
   */
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

/** Load both server feeds for a range, merged and newest first. */
export async function loadFeed(range: FeedRange['range'], limit = 800): Promise<ActivityItem[]> {
  const w = rangeWindow(range);
  const q =
    range === '1h'
      ? 'range=1d'
      : range === 'all' || /^\d+d$/.test(range)
        ? `range=${range}`
        : `range=1d&since=${Math.floor(w.since)}${Number.isFinite(w.until) ? `&until=${Math.ceil(w.until)}` : ''}`;
  const [logs, auth] = await Promise.all([
    apiGet<LogsResult>(`/api/logs?${q}&limit=${limit}`).catch(() => ({ events: [] }) as LogsResult),
    apiGet<LogsResult>('/api/auth/events?limit=300').catch(() => ({ events: [] }) as LogsResult),
  ]);
  const items = [...(logs.events || []).map(fromLog), ...(auth.events || []).map(fromAuth)].filter(
    (i) => i.ts >= w.since && i.ts < w.until,
  );
  return mergePhases(items);
}

/** Add one live item to a newest-first list (merging an `end` into its start). */
export function pushLive(list: ActivityItem[], it: ActivityItem, max = 2000): ActivityItem[] {
  const phase = str((it.raw as { phase?: unknown }).phase);
  if (phase === 'end') {
    const start = list.find((x) => x.running && x.actor === it.actor && x.action === it.action);
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

/** Subscribe to live agent activity; returns the unsubscribe function. */
export function onLive(fn: (it: ActivityItem) => void): () => void {
  return on('activity', (a) => fn(fromBus(a)));
}

/** Human verb: `save_memory` -> "save memory". */
export function verb(action: string): string {
  return action.replace(/[_.]+/g, ' ').trim();
}
