// One agent's own Activity page, at /activity/<key id>: a hero (who it is,
// its key, whether it is active, what it may do), KPI tiles, calls over time,
// its top actions, the nodes it touched most and its own timeline by day.
// Search and filters (time, status, action type) apply to this agent only and
// are separate from the list's filters. Removed keys whose events are still
// in the log show with the name from those events; people and the system
// (no key) get the same page by their actor name.

import { apiGet } from '../api';
import { attr, esc, useStyles } from '../dom';
import { debounce, noteName } from '../format';
import { hooks } from '../hooks';
import { agentColor, avatarHTML, setAgentColors } from '../control/agents';
import { wireActRows } from '../control/activity';
import { fromAuth, fromLog, mergePhases, pushLive, settleRunning, verb, type ActivityItem } from '../control/feed';
import { icon } from '../ui/icons';
import { ago, copyText, download, ICO, openDrawer, openMenu, plural } from '../control/ui';
import { skBlock } from '../ui/skeleton';
import { toast } from '../toast';
import type { KeyRow, KeysResult, LogEvent, LogsResult } from '../types';
import type { Page } from '../state';
import {
  CATS,
  STATUSES,
  TIMES,
  catOf,
  isoDay,
  labelOf,
  searchText,
  stOf,
  windowOf,
  type Cat,
  type St,
  type TimeKey,
} from './activity-model';
import { CAT_COLOR, CLOCK, bars, chip, dayViewHTML, skeletonHTML, statTile, timeChart } from './activity-views';
import { count, opt, toggle } from './activity-filters';
import { setKeysRoute } from '../router';

const CSS = `
.ad{--ag:var(--accent)}
.ad-hero{display:block;position:relative;padding:14px 20px 22px;margin-bottom:4px;overflow:clip}
.ad-hero::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:var(--ag)}
.ad-top{display:flex;align-items:center;gap:8px;margin:4px 0 16px;flex-wrap:wrap}
.ad-top .grow{flex:1}
.ad-back{display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 14px 0 10px;border-radius:11px;border:1px solid var(--line);
  background:var(--panel-2);color:var(--fg);font-size:13px;font-weight:650;text-decoration:none}
.ad-back:hover,.ad-back:focus{text-decoration:none}
.ad-back:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.ad-back:focus-visible,.ad-kid button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ad-back .cc-i{width:17px;height:17px}
.ad-top .lg-live{height:38px;border-radius:11px}
.ad-top .btn{min-height:38px;gap:8px}
.ad-id{display:flex;align-items:center;gap:22px;min-width:0}
.ad-av{flex:none;display:grid}
.ad-trim{font-size:inherit;font-weight:500;color:var(--muted)}
.ad-av .ag-av{font-weight:760}
.ad-who{flex:1;min-width:0;display:flex;flex-direction:column;gap:9px}
.ad-nm{margin:0;font-size:30px;font-weight:760;letter-spacing:-.5px;line-height:1.12;overflow-wrap:anywhere;color:var(--fg);width:fit-content;max-width:100%}
.ad-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;font-size:13px;color:var(--muted)}
.ad-meta b{color:var(--fg);font-weight:650;font-variant-numeric:tabular-nums}
.ad-st{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 11px;border-radius:99px;border:1px solid var(--line);
  background:var(--panel-2);color:var(--fg);font-size:12.5px;font-weight:680;white-space:nowrap}
.ad-st .cc-dot{width:7px;height:7px}
.ad-st.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent);background:color-mix(in srgb,var(--ok) 9%,var(--panel))}
.ad-st.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent);background:color-mix(in srgb,var(--warn) 9%,var(--panel))}
.ad-kid{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 3px 0 10px;border-radius:9px;border:1px solid var(--line);
  background:var(--panel-2);font:500 12.5px var(--mono);color:var(--fg);max-width:100%}
.ad-kid span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ad-kid button{display:grid;place-items:center;width:24px;height:24px;border-radius:7px;color:var(--muted);flex:none}
.ad-kid button:hover{background:var(--panel);color:var(--fg)}
.ad-kid .cc-i{width:14px;height:14px}
.ad-scopes{display:flex;flex-wrap:wrap;gap:6px}
.ad-sc{display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:8px;font-size:12px;font-weight:650;color:var(--fg);
  background:color-mix(in srgb,var(--ag) 11%,var(--panel));border:1px solid color-mix(in srgb,var(--ag) 34%,var(--line))}
.ad-sc.mute{background:var(--panel-2);border-color:var(--line);color:var(--muted)}
.ad-mini{display:none;align-items:center;gap:9px;flex:none;max-width:220px;font-size:14px;font-weight:700;color:var(--fg);padding-right:4px}
.ad-mini span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ad-sbar.stuck .ad-mini{display:inline-flex}
.ad .ax-sbar{margin-top:6px}
.ad-kpis{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:14px}
.ad-kpis .cc-stat .v{font-size:28px}
.ad-board{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:24px}
.ad-chart{grid-column:span 2;display:flex;flex-direction:column}
.ad-chart>.cc-card-b{flex:1;display:flex;flex-direction:column}
.ad-chart .ax-col i{background:var(--ag)}
.ad-chart .ax-cols{gap:2px;flex:1;height:auto;min-height:170px}
.ad-nodes{grid-column:1/-1}
.ad-nodes .ax-nodes{grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
.ad-tl-h{display:flex;align-items:baseline;gap:10px;margin:0 0 12px;font-size:17px;font-weight:720;color:var(--fg)}
.ad-tl-h span{font-size:13px;font-weight:550;color:var(--muted)}
.ad-sk{display:flex;flex-direction:column;gap:10px}
.ad-nf{margin-top:8px;padding:56px 20px}
.ad-nf code{font:600 12.5px var(--mono);color:var(--fg)}
.ad-nf .btn{text-decoration:none}
@media (max-width:1100px){
  .ad-board{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ad-chart{grid-column:1/-1}
  .ad-nodes{grid-column:auto}
  .ad-nodes .ax-nodes{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:760px){
  .ad-hero{padding:10px 14px 18px}
  .ad-top{margin-bottom:14px}
  .ad-top .btn .l,.ad-top .lg-live .l{display:none}
  .ad-top .btn{padding:0 11px}
  .ad-back{height:40px}
  .ad-id{flex-direction:column;align-items:flex-start;gap:14px}
  .ad-nm{font-size:24px}
  .ad-who{gap:10px;width:100%}
  .ad-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ad-kpis .cc-stat .v{font-size:23px}
  .ad-board{grid-template-columns:minmax(0,1fr)}
  .ad-chart,.ad-nodes{grid-column:auto}
  .ad .ax-sbar-in{flex-wrap:nowrap}
  .ad-sbar.stuck .ad-mini{display:none}
}
`;

const BACK = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';

const PAGE = 120;
const FETCH = 2000;
const ACTIVE_SECS = 300;

type Kind = 'key' | 'removed' | 'person';
interface Who {
  slug: string;
  id: string | null;
  name: string;
  key: KeyRow | null;
  kind: Kind;
}

/** This page's own filters (the list keeps its own). */
const D = {
  time: '7d' as TimeKey,
  from: '',
  to: '',
  cats: new Set<Cat>(),
  actions: new Set<string>(),
  status: new Set<St>(),
  q: '',
};

export interface AgentOpts {
  /** Keys the list already loaded (may be empty). */
  keys: KeyRow[];
  /** Events the list already loaded, to name the agent before the fetch. */
  items: ActivityItem[];
  /** The list's time selection, carried over. */
  time?: { time: TimeKey; from: string; to: string };
  /** "All activity": back to the list. */
  back(): void;
}

let root: HTMLElement | null = null;
let host: HTMLElement | null = null;
let opts: AgentOpts | null = null;
let who: Who | null = null;
let slug = '';
let keys: KeyRow[] = [];
let all: ActivityItem[] = [];
let lastSeen = 0;
let state: 'resolving' | 'loading' | 'ready' | 'missing' = 'resolving';
let seq = 0;
let limit = PAGE;
let fetchLimit = FETCH;
let older = false;
let compact = true;
let live = true;
let pending: ActivityItem[] = [];
const fresh = new Set<string>();
let paintQueued = false;
let hostWired = false;
let io: IntersectionObserver | null = null;
let ro: ResizeObserver | null = null;

/** The hero, for the shared element animation. */
export function agentHero(): HTMLElement | null {
  return root?.querySelector<HTMLElement>('.ad-hero') || null;
}

export function agentSlugShown(): string {
  return slug;
}

/** Render (or refresh) the page for `s` inside `el`; `scroller` is the view that scrolls. */
export function showAgent(el: HTMLElement, scroller: HTMLElement, s: string, o: AgentOpts): void {
  useStyles('ad-css', CSS);
  host = scroller;
  opts = o;
  if (root === el && slug === s && root.querySelector('.ad')) {
    // Still resolving who this is: restart that instead of a reload that
    // would cancel it and leave the skeleton up.
    if (who) void load(true);
    else void start();
    return;
  }
  root = el;
  slug = s;
  keys = o.keys;
  if (keys.length) setAgentColors(keys);
  all = [];
  lastSeen = 0;
  limit = PAGE;
  fetchLimit = FETCH;
  older = false;
  pending = [];
  fresh.clear();
  live = true;
  D.time = o.time?.time || '7d';
  D.from = o.time?.from || '';
  D.to = o.time?.to || '';
  D.cats.clear();
  D.actions.clear();
  D.status.clear();
  D.q = '';
  who = resolve(s, keys, o.items);
  state = who ? 'loading' : 'resolving';
  if (who) seed(o.items);
  shell();
  void start();
}

/** Events the list already holds for this agent: an instant first paint. */
function seed(items: ActivityItem[]): void {
  if (!who) return;
  const mine = items.filter((x) => isMine(x));
  if (mine.length) {
    all = mine.slice();
    lastSeen = mine[0].ts;
  }
}

function isMine(x: ActivityItem): boolean {
  if (!who) return false;
  const kid = typeof x.raw.actor_id === 'string' ? x.raw.actor_id : null;
  if (who.id && kid) return kid === who.id;
  return x.actor === who.name;
}

function resolve(s: string, ks: KeyRow[], items: ActivityItem[]): Who | null {
  const k = ks.find((x) => x.id === s);
  if (k) return { slug: s, id: k.id, name: k.name || k.id, key: k, kind: 'key' };
  const byId = items.find((x) => x.raw.actor_id === s);
  if (byId) return { slug: s, id: s, name: byId.actor, key: null, kind: 'removed' };
  const byName = items.find((x) => x.actor === s);
  if (byName) {
    const kid = typeof byName.raw.actor_id === 'string' && byName.raw.actor_id ? byName.raw.actor_id : null;
    const key = (kid && ks.find((x) => x.id === kid)) || ks.find((x) => (x.name || x.id) === s) || null;
    return {
      slug: s,
      id: key?.id || kid,
      name: s,
      key,
      kind: key ? 'key' : byName.source === 'agent' || byName.raw.actor_kind === 'agent' ? 'removed' : 'person',
    };
  }
  const named = ks.find((x) => x.name === s);
  if (named) return { slug: s, id: named.id, name: s, key: named, kind: 'key' };
  return null;
}

async function start(): Promise<void> {
  const my = ++seq;
  if (!keys.length) {
    keys = await apiGet<KeysResult | KeyRow[]>('/api/keys')
      .then((d) => (Array.isArray(d) ? d : d.keys || []))
      .catch(() => [] as KeyRow[]);
    if (my !== seq) return;
    setAgentColors(keys);
    const again = resolve(slug, keys, opts?.items || []);
    if (again) who = again;
    else if (who?.id) who.key = keys.find((k) => k.id === who!.id) || null;
  }
  if (!who) {
    // A removed key or a person the list has not loaded: look through the log.
    const ev = await apiGet<LogsResult>('/api/logs?range=all&limit=2000')
      .then((d) => (d.events || []).map(fromLog))
      .catch(() => [] as ActivityItem[]);
    if (my !== seq) return;
    who = resolve(slug, keys, ev);
  }
  if (!who) {
    state = 'missing';
    shell();
    return;
  }
  state = 'loading';
  shell();
  await load(false, my);
}

function fetchRange(): string {
  if (D.time === '30d' || D.time === 'all') return D.time;
  if (D.time === 'custom') return 'all';
  return '7d';
}

async function load(soft: boolean, my = ++seq): Promise<void> {
  if (!who) return;
  const w = who;
  const actor = encodeURIComponent(w.name);
  if (!soft && state !== 'loading') {
    state = 'loading';
    paint(false);
  }
  try {
    const [got, newest] = await Promise.all([
      fetchAgentEvents(w, fetchRange(), fetchLimit),
      soft && lastSeen
        ? Promise.resolve({ events: [] } as LogsResult)
        : apiGet<LogsResult>(`/api/logs?range=all&actor=${actor}&limit=1`).catch(() => ({ events: [] }) as LogsResult),
    ]);
    if (my !== seq) return;
    const fetched = got.items;
    // Keep live items newer than the snapshot (the log can lag a little).
    const top = fetched.length ? fetched[0].ts : 0;
    const keep = all.filter((x) => x.live && x.ts > top - 15 && !fetched.some((f) => f.action === x.action && Math.abs(f.ts - x.ts) < 15));
    if (soft && all.length) {
      const known = new Set(all.map((x) => x.action + Math.round(x.ts)));
      fetched.forEach((x) => known.has(x.action + Math.round(x.ts)) || fresh.add(x.id));
    }
    all = [...keep, ...fetched];
    older = got.logged >= fetchLimit * 0.95;
    const n = (newest.events || [])[0] as Record<string, unknown> | undefined;
    const nts = n ? Number(n._ts || n.ts || 0) : 0;
    lastSeen = Math.max(lastSeen, nts, all[0]?.ts || 0);
  } catch (e) {
    if (my !== seq) return;
    toast('Could not load activity: ' + (e as Error).message, 'err');
  }
  state = 'ready';
  paint(soft);
}

/**
 * One agent's events, newest first: its rows in the vault log for `range`
 * plus its gateway audit events. `logged` is how many log rows came back (to
 * tell whether older ones were cut off). The Agents page loads its activity
 * tab through this too.
 */
export async function fetchAgentEvents(
  w: { id: string | null; name: string },
  range: string,
  limit: number,
): Promise<{ items: ActivityItem[]; logged: number }> {
  const actor = encodeURIComponent(w.name);
  const [logs, auth] = await Promise.all([
    apiGet<LogsResult>(`/api/logs?range=${encodeURIComponent(range)}&actor=${actor}&limit=${limit}`).catch(() => ({ events: [] }) as LogsResult),
    apiGet<LogsResult>('/api/auth/events?limit=300').catch(() => ({ events: [] }) as LogsResult),
  ]);
  const authMine = (auth.events || []).filter((e: LogEvent) => {
    const r = e as Record<string, unknown>;
    return (w.id && r.actor_id === w.id) || r.actor === w.name || r.user === w.name;
  });
  const ev = logs.events || [];
  const items = mergePhases([...ev.map(fromLog), ...authMine.map(fromAuth)]).filter((x) => x.actor === w.name || x.raw.actor_id === w.id);
  return { items, logged: ev.length };
}

// ── live ────────────────────────────────────────────────────────────────

/** A live event from the list's stream; taken when it belongs to the agent shown. */
export function agentLive(it: ActivityItem, visible: boolean): void {
  if (!visible || !who || state !== 'ready' || !isMine(it)) return;
  if (!live) {
    pending.push(it);
    paintLive();
    return;
  }
  ingest(it);
}

function ingest(it: ActivityItem): void {
  fresh.add(it.id);
  pushLive(all, it);
  lastSeen = Math.max(lastSeen, it.ts);
  if (paintQueued) return;
  paintQueued = true;
  setTimeout(() => {
    paintQueued = false;
    paint(true);
  }, 150);
}

function paintLive(): void {
  const b = root?.querySelector<HTMLElement>('#adLive');
  if (!b) return;
  b.setAttribute('aria-pressed', String(live));
  b.innerHTML = live
    ? '<span class="cc-dot ok"></span><span class="l">Live</span>'
    : `<span class="cc-dot idle"></span><span class="l">Paused${pending.length ? ` · ${pending.length} new` : ''}</span>`;
  b.title = live ? 'Pause the live stream' : 'Resume the live stream';
  const nb = root!.querySelector<HTMLButtonElement>('#adNew');
  if (nb) {
    nb.hidden = live || !pending.length;
    nb.textContent = `${pending.length} new`;
  }
}

function resume(): void {
  live = true;
  const p = pending;
  pending = [];
  p.forEach(ingest);
  paintLive();
}

// ── filters ─────────────────────────────────────────────────────────────

type Facet = 'cats' | 'status' | 'q';

function match(x: ActivityItem, skip?: Facet): boolean {
  if (skip !== 'cats' && (D.cats.size || D.actions.size) && !D.cats.has(catOf(x)) && !D.actions.has(x.action)) return false;
  if (skip !== 'status' && D.status.size && !D.status.has(stOf(x))) return false;
  if (skip !== 'q' && D.q) {
    const hay = searchText(x);
    if (!D.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function win(): { since: number; until: number } {
  return windowOf(D);
}

function scoped(): ActivityItem[] {
  const w = win();
  return all.filter((x) => x.ts >= w.since && x.ts < w.until);
}

/**
 * A count over events since `since`, as shown: with "+" when only the newest
 * events are loaded (`trimmed`) and the oldest loaded one is newer than `since`,
 * so older events in that window may exist. Exported for tests.
 */
export function atLeast(n: number, since: number, oldest: number, trimmed: boolean): string {
  const s = n.toLocaleString('en-US');
  return trimmed && oldest > since ? s + '+' : s;
}

/** The oldest event loaded (unix seconds), for the "+" on counts. */
function oldestLoaded(): number {
  return all.length ? all[all.length - 1].ts : Date.now() / 1000;
}

function narrowed(): boolean {
  return !!(D.q || D.cats.size || D.actions.size || D.status.size);
}

function filterCount(): number {
  return D.cats.size + D.actions.size + D.status.size + (D.time === '7d' ? 0 : 1);
}

function clearAll(): void {
  const tc = D.time !== '7d';
  D.cats.clear();
  D.actions.clear();
  D.status.clear();
  D.q = '';
  D.time = '7d';
  D.from = D.to = '';
  const q = root?.querySelector<HTMLInputElement>('#adQ');
  if (q) q.value = '';
  syncQ();
  limit = PAGE;
  if (tc) void load(false);
  else paint(false);
}

function setTime(t: TimeKey, from = '', to = ''): void {
  const before = fetchRange();
  D.time = t;
  D.from = from;
  D.to = to;
  limit = PAGE;
  if (fetchRange() !== before) void load(false);
  else paint(false);
}

let sheet: HTMLElement | null = null;

function sheetHTML(): string {
  const sc = scoped();
  const st = count(
    sc.filter((x) => match(x, 'status')),
    stOf,
  );
  const cr = sc.filter((x) => match(x, 'cats'));
  const cats = count(cr, catOf);
  const acts = [...count(cr, (x) => x.action).entries()].sort((a, b) => b[1] - a[1]);
  D.actions.forEach((a) => acts.some(([x]) => x === a) || acts.push([a, 0]));
  const today = isoDay(Date.now() / 1000);
  return `<section class="ax-fg"><h3>Time</h3>
      <div class="ax-opts">${TIMES.map((t) => opt('time', t.id, t.label, D.time === t.id)).join('')}</div>
      <div class="ax-range${D.time === 'custom' ? ' on' : ''}">
        <label><span>From</span><input type="date" data-date="from" value="${attr(D.from)}" max="${today}"></label>
        <label><span>To</span><input type="date" data-date="to" value="${attr(D.to)}" max="${today}"></label>
      </div></section>
    <section class="ax-fg"><h3>Status</h3><div class="ax-opts">${STATUSES.map((s) =>
      opt('status', s.id, s.label, D.status.has(s.id), st.get(s.id) || 0, `<span class="cc-dot ${s.id === 'fail' ? 'err' : s.id === 'running' ? 'run' : 'ok'}"></span>`),
    ).join('')}</div></section>
    <section class="ax-fg"><h3>Action type</h3><div class="ax-opts">${CATS.filter((c) => cats.get(c.id) || D.cats.has(c.id) || c.id !== 'other')
      .map((c) => opt('cats', c.id, c.label, D.cats.has(c.id), cats.get(c.id) || 0, `<i class="sw" style="--c:${CAT_COLOR[c.id]}"></i>`))
      .join('')}</div>
      ${
        acts.length
          ? `<details class="ax-acts"${D.actions.size ? ' open' : ''}><summary>Specific actions<span class="n">${acts.length}</span></summary>
        <div class="ax-opts">${acts.map(([a, n]) => opt('actions', a, verb(a), D.actions.has(a), n)).join('')}</div></details>`
          : ''
      }</section>`;
}

function paintSheet(): void {
  if (!sheet || !document.body.contains(sheet)) {
    sheet = null;
    return;
  }
  const b = sheet.querySelector<HTMLElement>('.cc-drawer-b')!;
  const top = b.scrollTop;
  const det = b.querySelector<HTMLDetailsElement>('.ax-acts');
  const wasOpen = det?.open;
  b.innerHTML = sheetHTML();
  b.scrollTop = top;
  const d2 = b.querySelector<HTMLDetailsElement>('.ax-acts');
  if (d2 && wasOpen) d2.open = true;
  b.querySelectorAll<HTMLInputElement>('[data-date]').forEach((inp) => {
    inp.onchange = () => {
      let from = D.time === 'custom' ? D.from : '';
      let to = D.time === 'custom' ? D.to : '';
      if (inp.dataset.date === 'from') from = inp.value;
      else to = inp.value;
      if (from && to && from > to) [from, to] = [to, from];
      setTime(from || to ? 'custom' : '7d', from, to);
      paintSheet();
    };
  });
  const n = scoped().filter((x) => match(x)).length;
  const done = sheet.querySelector<HTMLElement>('[data-done]');
  if (done) done.textContent = `Show ${plural(n, 'event')}`;
  const sub = sheet.querySelector<HTMLElement>('.cc-drawer-h .s');
  if (sub) sub.textContent = `${who?.name || ''} · ${n} of ${scoped().length} events match`;
}

function openSheet(): void {
  const d = openDrawer({
    title: 'Filters',
    sub: ' ',
    body: '',
    foot: `<button type="button" class="btn ghost" data-reset>Reset</button><span style="flex:1"></span><button type="button" class="btn primary" data-done>Show events</button>`,
  });
  d.classList.add('ax-sheet');
  sheet = d;
  paintSheet();
  d.onclick = (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-k],[data-reset],[data-done]');
    if (!t) return;
    if (t.hasAttribute('data-done')) {
      d.querySelector<HTMLElement>('[data-x]')?.click();
      return;
    }
    if (t.hasAttribute('data-reset')) {
      clearAll();
      paintSheet();
      return;
    }
    const k = t.dataset.k!;
    const v = t.dataset.v || '';
    if (k === 'time') setTime(v as TimeKey);
    else {
      if (k === 'status') toggle(D.status, v as St);
      else if (k === 'cats') toggle(D.cats, v as Cat);
      else if (k === 'actions') toggle(D.actions, v);
      limit = PAGE;
      paint(false);
    }
    paintSheet();
    d.querySelector<HTMLElement>(`[data-k="${k}"][data-v="${window.CSS.escape(v)}"]`)?.focus({ preventScroll: true });
  };
}

// ── rendering ───────────────────────────────────────────────────────────

function color(): string {
  return who ? agentColor(who.name, who.id) : 'var(--accent)';
}

function status(): { label: string; cls: string; dot: string } {
  const w = who!;
  const now = Date.now() / 1000;
  const runningNow = all.some((x) => settleRunning(x));
  if (w.kind === 'removed') return { label: 'Removed key', cls: 'warn', dot: '' };
  if (w.key && w.key.enabled === false) return { label: 'Turned off', cls: 'warn', dot: '' };
  if (runningNow || (lastSeen && now - lastSeen < ACTIVE_SECS)) return { label: 'Active now', cls: 'ok', dot: '<span class="cc-dot ok"></span>' };
  if (lastSeen) return { label: `Seen ${ago(lastSeen) === 'now' ? 'just now' : ago(lastSeen) + ' ago'}`, cls: '', dot: '<span class="cc-dot idle"></span>' };
  if (w.kind === 'person') return { label: /^(gateway|system)$/i.test(w.name) ? 'System' : 'Person', cls: '', dot: '' };
  if (state !== 'ready') return { label: 'Checking…', cls: '', dot: '' };
  return { label: w.key?.uses ? 'No activity in the log' : 'Never used', cls: '', dot: '' };
}

const SCOPE_LABEL: Record<string, string> = { mcp: 'MCP tools', read: 'Read nodes', write: 'Write nodes', admin: 'Manage server' };

function scopesHTML(): string {
  const w = who!;
  if (w.kind === 'removed') return '<span class="ad-sc mute">This key no longer exists; its past events stay in the log</span>';
  if (w.kind === 'person') return '<span class="ad-sc mute">Signed in on the web</span>';
  const k = w.key;
  if (!k) return '';
  const sc = (k.scopes || []).map((s) => `<span class="ad-sc">${esc(SCOPE_LABEL[s] || s)}</span>`);
  const tools = k.tools;
  if (Array.isArray(tools)) sc.push(`<span class="ad-sc">${plural(tools.length, 'tool')}</span>`);
  else if ((k.scopes || []).includes('mcp') || tools === '*') sc.push('<span class="ad-sc">All tools</span>');
  return sc.join('') || '<span class="ad-sc mute">No permissions</span>';
}

function metaHTML(): string {
  const w = who!;
  const st = status();
  const id = w.id
    ? `<span class="ad-kid" title="Key id"><span>${esc(w.id)}</span><button type="button" data-copy-id aria-label="Copy key id" title="Copy key id">${ICO.copy}</button></span>`
    : '';
  const extra: string[] = [];
  if (w.key?.uses) extra.push(`<span><b>${w.key.uses.toLocaleString('en-US')}</b> calls in total</span>`);
  if (w.key?.last_ip) extra.push(`<span>Last IP <b>${esc(w.key.last_ip)}</b></span>`);
  if (st.cls === 'warn' && lastSeen) extra.push(`<span>Last seen <b>${esc(ago(lastSeen))}</b>${ago(lastSeen) === 'now' ? '' : ' ago'}</span>`);
  return `<span class="ad-st ${st.cls}">${st.dot}${esc(st.label)}</span>${id}${extra.join('')}`;
}

function heroHTML(): string {
  const w = who;
  const top = `<div class="ad-top"><a class="ad-back" href="/activity" data-back>${BACK}All activity</a><span class="grow"></span>${
    w && state !== 'missing'
      ? `<button type="button" class="lg-live" id="adLive" aria-pressed="${live}"></button>
        <button type="button" class="btn" id="adExport" aria-haspopup="menu" aria-label="Export">${ICO.download}<span class="l">Export</span></button>
        ${w.key ? `<button type="button" class="btn ghost" id="adKey" aria-label="Agent page" title="This agent's page: setup, access and settings">${icon('agents')}<span class="l">Agent page</span></button>` : ''}`
      : ''
  }</div>`;
  if (!w) {
    if (state === 'missing') return '';
    return `<header class="cc-card ad-hero" aria-busy="true">${top}<div class="ad-id"><span class="ad-av">${skBlock('84px', 84, 'r')}</span>
      <div class="ad-who">${skBlock('min(280px,60%)', 28)}${skBlock('min(360px,80%)', 14)}${skBlock('min(220px,50%)', 14)}</div></div></header>`;
  }
  const big = avatarHTML(w.name, 84, status().cls === 'ok' ? 'live' : '', w.id);
  return `<header class="cc-card ad-hero" data-vt-card>${top}
    <div class="ad-id"><span class="ad-av" data-vt-av>${big}</span>
      <div class="ad-who"><h1 class="ad-nm" data-vt-nm>${esc(w.name)}</h1>
        <div class="ad-meta" id="adMeta">${metaHTML()}</div>
        <div class="ad-scopes">${scopesHTML()}</div></div></div></header>`;
}

function shell(): void {
  if (!root) return;
  if (state === 'missing') {
    root.innerHTML = `<div class="cc ax ad">${heroHTML() || `<div class="ad-top"><a class="ad-back" href="/activity" data-back>${BACK}All activity</a></div>`}
      <div class="cc-card ax-empty ad-nf"><span class="ax-empty-i">${ICO.key}</span><b>No agent at this address</b>
        <span>Nothing in this brain goes by <code>${esc(slug)}</code>. The key may have been deleted and its events have since left the log.</span>
        <a class="btn" href="/activity" data-back>Show all activity</a></div></div>`;
    document.title = 'Agent not found · Memora';
    wireRoot();
    return;
  }
  root.innerHTML = `<div class="cc ax ad" style="--ag:${color()}">
    ${heroHTML()}
    <div class="ax-sbar ad-sbar" id="adBar"><div class="ax-sbar-in">
      <span class="ad-mini" id="adMini"></span>
      <label class="ax-q" id="adQWrap">${ICO.search}<span class="sr-only">Search this agent's activity</span>
        <input id="adQ" type="search" enterkeyhint="search" placeholder="Search actions, nodes, details" autocomplete="off" spellcheck="false">
        <kbd aria-hidden="true">/</kbd><button type="button" class="ax-qx" id="adQx" aria-label="Clear search" hidden>${ICO.x}</button></label>
      <button type="button" class="ax-fbtn" id="adFilt" aria-haspopup="dialog">${ICO.filter}<span class="l">Filters</span><span class="ax-badge" id="adBadge" hidden></span></button>
      <button type="button" class="ax-newb" id="adNew" hidden></button>
    </div></div>
    <div class="ax-sub"><div class="ax-chips" id="adChips" aria-label="Active filters"></div><div class="ax-sum" id="adSum" aria-live="polite"></div></div>
    <div class="ax-body" id="adBody"></div>
  </div>`;
  if (who) document.title = `${who.name} · Activity · Memora`;
  wireRoot();
  paintLive();
  paint(false);
}

function syncQ(): void {
  const q = root?.querySelector<HTMLInputElement>('#adQ');
  if (!q) return;
  root!.querySelector<HTMLElement>('#adQx')!.hidden = !q.value;
  root!.querySelector<HTMLElement>('#adQWrap')!.classList.toggle('has', !!q.value);
}

function wireRoot(): void {
  const r = root!;
  r.querySelectorAll<HTMLElement>('[data-back]').forEach((a) => {
    a.onclick = (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || (e as MouseEvent).button === 1) return;
      e.preventDefault();
      opts?.back();
    };
  });
  r.querySelector<HTMLElement>('#adMeta')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-copy-id]')) void copyText(who?.id || '', 'Key id copied');
  });
  const lv = r.querySelector<HTMLElement>('#adLive');
  if (lv)
    lv.onclick = () => {
      if (live) live = false;
      else {
        resume();
        void load(true);
      }
      paintLive();
    };
  const nb = r.querySelector<HTMLElement>('#adNew');
  if (nb)
    nb.onclick = () => {
      resume();
      host?.scrollTo({ top: 0 });
    };
  const ex = r.querySelector<HTMLElement>('#adExport');
  if (ex)
    ex.onclick = () =>
      openMenu(ex, [
        { label: 'Export shown as JSON', icon: ICO.download, run: () => exportRows(rows(), 'json', who?.name) },
        { label: 'Export shown as CSV', icon: ICO.download, run: () => exportRows(rows(), 'csv', who?.name) },
      ]);
  const ky = r.querySelector<HTMLElement>('#adKey');
  if (ky)
    ky.onclick = () => {
      // Straight to the agent's own page on the Agents page.
      if (who?.key) setKeysRoute('/agents/' + encodeURIComponent(who.key.id));
      hooks.go('keys' as Page);
    };
  const q = r.querySelector<HTMLInputElement>('#adQ');
  if (q) {
    const apply = debounce(() => {
      D.q = q.value.trim();
      limit = PAGE;
      paint(false);
    }, 140);
    q.oninput = () => {
      syncQ();
      apply();
    };
    q.onkeydown = (e) => {
      if (e.key === 'Escape' && q.value) {
        e.stopPropagation();
        q.value = '';
        syncQ();
        D.q = '';
        paint(false);
      }
    };
    r.querySelector<HTMLElement>('#adQx')!.onclick = () => {
      q.value = '';
      syncQ();
      D.q = '';
      paint(false);
      q.focus();
    };
  }
  const fb = r.querySelector<HTMLElement>('#adFilt');
  if (fb) fb.onclick = openSheet;
  const chips = r.querySelector<HTMLElement>('#adChips');
  if (chips)
    chips.onclick = (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-open]')) return openSheet();
      if (t.closest('[data-clear]')) return clearAll();
      const rm = t.closest<HTMLElement>('[data-rm]');
      if (!rm) return;
      const [k, ...rest] = rm.dataset.rm!.split(':');
      const v = rest.join(':');
      if (k === 'cats') D.cats.delete(v as Cat);
      else if (k === 'actions') D.actions.delete(v);
      else if (k === 'status') D.status.delete(v as St);
      limit = PAGE;
      paint(false);
    };
  const sum = r.querySelector<HTMLElement>('#adSum');
  if (sum)
    sum.onclick = (e) => {
      if (!(e.target as HTMLElement).closest('#adCompact')) return;
      compact = !compact;
      paint(false);
    };
  const body = r.querySelector<HTMLElement>('#adBody');
  if (body) {
    wireActRows(body, (id) => all.find((x) => x.id === id));
    body.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      let el: HTMLElement | null;
      if (t.closest('[data-more]')) {
        limit += PAGE;
        paint(true);
      } else if (t.closest('[data-older]')) {
        fetchLimit += FETCH;
        void load(true);
      } else if ((el = t.closest<HTMLElement>('[data-f]'))) {
        const [k, ...rest] = el.dataset.f!.split(':');
        const v = rest.join(':');
        if (k === 'actions') D.actions = new Set([v]);
        else if (k === 'cats') D.cats = new Set([v as Cat]);
        limit = PAGE;
        paint(false);
        r.querySelector<HTMLElement>('.ad-tl-h')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else if (t.closest('[data-time]')) setTime('all');
      else if (t.closest('[data-clear]')) clearAll();
    });
  }
  const bar = r.querySelector<HTMLElement>('#adBar');
  const cc = r.querySelector<HTMLElement>('.ad');
  if (bar && cc && host) {
    const h = host;
    const setStick = (): void => {
      const pt = parseFloat(getComputedStyle(h).paddingTop) || 0;
      cc.style.setProperty('--ax-pt', pt + 'px');
      cc.style.setProperty('--ax-stick', bar.offsetHeight - pt + 'px');
    };
    setStick();
    ro?.disconnect();
    ro = new ResizeObserver(setStick);
    ro.observe(bar);
  }
  if (host && !hostWired) {
    hostWired = true;
    const h = host;
    h.addEventListener('scroll', () => onScroll(h), { passive: true });
  }
}

function onScroll(h: HTMLElement): void {
  if (!root || root.hidden) return;
  const bar = root.querySelector<HTMLElement>('#adBar');
  if (!bar) return;
  const y = h.scrollTop;
  bar.classList.toggle('stuck', y > 0 && bar.getBoundingClientRect().top <= h.getBoundingClientRect().top + 1);
}

function rows(): ActivityItem[] {
  return scoped().filter((x) => match(x));
}

function paintChips(): void {
  const el = root?.querySelector<HTMLElement>('#adChips');
  if (!el) return;
  const c = [
    `<button type="button" class="ax-chip time" data-open aria-label="${attr(`Time: ${labelOf(D)}. Change filters`)}">${CLOCK}<span class="t">${esc(
      labelOf(D),
    )}</span></button>`,
  ];
  D.status.forEach((s) => c.push(chip('status:' + s, STATUSES.find((x) => x.id === s)!.label, '', 'Status ')));
  D.cats.forEach((k) => c.push(chip('cats:' + k, CATS.find((x) => x.id === k)!.label, `<i class="sw" style="--c:${CAT_COLOR[k]}"></i>`)));
  D.actions.forEach((a) => c.push(chip('actions:' + a, verb(a), '', 'Action ')));
  if (narrowed() || D.time !== '7d') c.push('<button type="button" class="ax-clear" data-clear>Clear all</button>');
  el.innerHTML = c.join('');
  const n = filterCount();
  const badge = root!.querySelector<HTMLElement>('#adBadge')!;
  badge.hidden = !n;
  badge.textContent = String(n);
  root!.querySelector<HTMLElement>('#adFilt')!.setAttribute('aria-label', n ? `Filters, ${n} active` : 'Filters');
}

function kpis(rs: ActivityItem[]): string {
  const now = Date.now() / 1000;
  const mid = new Date();
  mid.setHours(0, 0, 0, 0);
  const midTs = mid.getTime() / 1000;
  const oldest = oldestLoaded();
  const today = atLeast(all.filter((x) => x.ts >= midTs).length, midTs, oldest, older);
  const week = atLeast(all.filter((x) => x.ts >= now - 7 * 86400).length, now - 7 * 86400, oldest, older);
  const fails = rs.filter((x) => x.ok === false).length;
  const nodes = new Set(rs.flatMap((x) => x.paths)).size;
  const w = win();
  const first = rs.length ? rs[rs.length - 1].ts : now;
  const since = w.since > 0 ? w.since : first;
  const until = Number.isFinite(w.until) ? Math.min(w.until, now) : now;
  const days = Math.max(1, Math.ceil((until - since) / 86400 - 0.01));
  const avg = rs.length / days;
  return `<div class="cc-stats ad-kpis">
    ${statTile('Calls today', today, `${week} in the last 7 days`)}
    ${statTile('Failed', fails, rs.length ? `${Math.round((fails / rs.length) * 100)}% of ${atLeast(rs.length, w.since, oldest, older)} ${rs.length === 1 ? 'event' : 'events'}` : 'Nothing in this range', fails > 0)}
    ${statTile('Nodes touched', nodes, labelOf(D))}
    ${statTile('Average per day', (avg >= 10 ? String(Math.round(avg)) : avg.toFixed(1).replace(/\.0$/, '')) + (older && oldest > since ? '+' : ''), `Over ${plural(days, 'day')}`)}
  </div>`;
}

function boardHTML(rs: ActivityItem[]): string {
  const w = win();
  const now = Date.now() / 1000;
  const span = (Number.isFinite(w.until) ? Math.min(w.until, now) : now) - (w.since > 0 ? w.since : rs.length ? rs[rs.length - 1].ts : now);
  const acts = new Map<string, number>();
  const nodes = new Map<string, number>();
  rs.forEach((x) => {
    acts.set(x.action, (acts.get(x.action) || 0) + 1);
    x.paths.forEach((p) => nodes.set(p, (nodes.get(p) || 0) + 1));
  });
  const topActs = [...acts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  const topNodes = [...nodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return `<div class="ad-board">
    <section class="cc-card ax-bc ad-chart"><div class="cc-card-h"><h2>Calls per ${span <= 2 * 86400 ? 'hour' : 'day'}</h2><span class="grow"></span><span class="sub"><i class="ax-key"></i>failed</span></div>
      <div class="cc-card-b">${timeChart(rs, w)}</div></section>
    <section class="cc-card ax-bc"><div class="cc-card-h"><h2>Top actions</h2></div><div class="cc-card-b">${bars(
      topActs.map(([a, n]) => ({ key: a, label: verb(a), n, color: CAT_COLOR[catOf(rs.find((x) => x.action === a)!)], f: 'actions:' + a })),
      rs.length,
    )}</div></section>
    <section class="cc-card ax-bc ad-nodes"><div class="cc-card-h"><h2>Most touched nodes</h2></div>${
      topNodes.length
        ? `<div class="ax-nodes">${topNodes
            .map(
              ([p, n]) =>
                `<button type="button" class="ax-node" data-note="${attr(p)}" title="${attr(`Open ${p}`)}">${ICO.note}<span class="t"><span>${esc(
                  noteName(p),
                )}</span><small>${esc(p)}</small></span><span class="n">${n}×</span></button>`,
            )
            .join('')}</div>`
        : '<div class="cc-card-b"><div class="ax-bempty">No nodes touched in this range</div></div>'
    }</section>
  </div>`;
}

function skeleton(): string {
  const tile = `<div class="cc-stat ad-sk">${skBlock('46%', 10)}${skBlock('38%', 26)}${skBlock('64%', 9)}</div>`;
  return `<div class="cc-stats ad-kpis" aria-hidden="true">${tile.repeat(4)}</div>
    <div class="ad-board" aria-hidden="true"><section class="cc-card ad-chart"><div class="cc-card-b">${skBlock('100%', 150)}</div></section>
      <section class="cc-card"><div class="cc-card-b ad-sk">${[70, 55, 40, 30].map((w) => skBlock(w + '%', 12)).join('')}</div></section></div>
    <h2 class="ad-tl-h">Timeline</h2>${skeletonHTML('day')}`;
}

/** Keep the first visible row in place while the list above it changes. */
function anchor(): () => void {
  const h = host;
  if (!h || !root || h.scrollTop < 40) return () => {};
  const stick = root.querySelector<HTMLElement>('#adBar')?.offsetHeight || 0;
  const top = h.getBoundingClientRect().top + stick;
  let el: HTMLElement | null = null;
  for (const r of root.querySelectorAll<HTMLElement>('#adBody [data-act]')) {
    if (r.getBoundingClientRect().bottom > top + 40) {
      el = r;
      break;
    }
  }
  if (!el) return () => {};
  const key = el.dataset.act!;
  const before = el.getBoundingClientRect().top;
  return () => {
    const again = root?.querySelector<HTMLElement>(`#adBody [data-act="${window.CSS.escape(key)}"]`);
    if (again) h.scrollTop += again.getBoundingClientRect().top - before;
  };
}

function paint(keepPlace = true): void {
  const body = root?.querySelector<HTMLElement>('#adBody');
  if (!body || !who) return;
  paintChips();
  const meta = root!.querySelector<HTMLElement>('#adMeta');
  if (meta) meta.innerHTML = metaHTML();
  const av = root!.querySelector<HTMLElement>('.ad-av .ag-av');
  if (av) av.classList.toggle('live', status().cls === 'ok' && status().label === 'Active now');
  const mini = root!.querySelector<HTMLElement>('#adMini');
  if (mini && !mini.innerHTML) mini.innerHTML = `${avatarHTML(who.name, 28, '', who.id)}<span>${esc(who.name)}</span>`;
  const sum = root!.querySelector<HTMLElement>('#adSum')!;
  if (state !== 'ready' && !all.length) {
    sum.innerHTML = '<span>Loading…</span>';
    body.setAttribute('aria-busy', 'true');
    body.innerHTML = skeleton();
    return;
  }
  body.removeAttribute('aria-busy');
  const sc = scoped();
  const rs = sc.filter((x) => match(x));
  const fails = rs.filter((x) => x.ok === false).length;
  // Only the newest log entries are loaded: say so rather than show a capped total as exact.
  const trimmed = older && oldestLoaded() > win().since;
  sum.innerHTML = `<span${
    trimmed
      ? ` title="${attr(`Only the newest ${fetchLimit.toLocaleString('en-US')} log entries are loaded; older events are trimmed from these counts. Load older events at the end of the timeline.`)}"`
      : ''
  }><b>${atLeast(rs.length, win().since, oldestLoaded(), older)}</b> ${rs.length === 1 ? 'event' : 'events'}${
    trimmed ? ' <small class="ad-trim">· older events not loaded</small>' : ''
  }</span>${fails ? `<span class="bad"><b>${fails}</b> failed</span>` : ''}<button type="button" class="ax-tgl" id="adCompact" aria-pressed="${compact}" title="Collapse repeated calls"><i></i>Group repeats</button>`;
  const restore = keepPlace ? anchor() : () => {};
  body.innerHTML = `${kpis(rs)}${boardHTML(rs)}<h2 class="ad-tl-h">Timeline<span>${esc(labelOf(D))}</span></h2>${dayViewHTML({
    rows: rs,
    agents: [],
    fresh,
    limit,
    compact,
    older,
    narrowed: narrowed(),
    none: !sc.length,
  })}`;
  restore();
  fresh.clear();
  paintSheet();
  watchMore(body);
}

function watchMore(body: HTMLElement): void {
  io?.disconnect();
  const more = body.querySelector<HTMLElement>('[data-more]');
  if (!more || typeof IntersectionObserver === 'undefined') return;
  io = new IntersectionObserver(
    (en) => {
      if (en.some((x) => x.isIntersecting)) {
        io?.disconnect();
        limit += PAGE;
        paint(true);
      }
    },
    { root: host, rootMargin: '0px 0px 300px 0px' },
  );
  io.observe(more);
}

/** Put the cursor in this page's search ("/"). */
export function focusAgentSearch(): boolean {
  const q = root && !root.hidden ? root.querySelector<HTMLInputElement>('#adQ') : null;
  if (!q) return false;
  q.focus();
  q.select();
  return true;
}

/** Stop observing (the list is shown again). */
export function leaveAgent(): void {
  seq++;
  io?.disconnect();
  if (sheet && document.body.contains(sheet)) sheet.querySelector<HTMLElement>('[data-x]')?.click();
  sheet = null;
}

// ── export ──────────────────────────────────────────────────────────────

/** Download events as JSON or CSV (the list and the agent page). */
export function exportRows(rs: ActivityItem[], kind: 'json' | 'csv', who?: string): void {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const stem = `memora-activity${who ? '-' + who.replace(/[^A-Za-z0-9_-]+/g, '_') : ''}-${stamp}`;
  if (kind === 'json') {
    download(
      `${stem}.json`,
      JSON.stringify(
        rs.map((x) => ({
          time: new Date(x.ts * 1000).toISOString(),
          actor: x.actor,
          action: x.action,
          label: x.label,
          paths: x.paths,
          ok: x.ok,
          ms: x.ms,
          source: x.source,
          ip: x.ip,
        })),
        null,
        2,
      ),
    );
  } else {
    const cell = (v: unknown): string => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = ['time,actor,action,label,paths,status,ms,source,ip'];
    rs.forEach((x) =>
      lines.push(
        [
          new Date(x.ts * 1000).toISOString(),
          x.actor,
          x.action,
          x.label,
          x.paths.join(' '),
          x.running ? 'running' : x.ok === false ? 'failed' : 'ok',
          x.ms ?? '',
          x.source,
          x.ip || '',
        ]
          .map(cell)
          .join(','),
      ),
    );
    download(`${stem}.csv`, lines.join('\n'), 'text/csv');
  }
  toast(`Exported ${plural(rs.length, 'event')}`, 'ok');
}
