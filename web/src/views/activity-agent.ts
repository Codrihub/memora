// The Activity tab of an agent's page (/agents/<key id>/activity), with its own filters.

import { apiGet } from '../api';
import { attr, esc, useStyles } from '../dom';
import { hooks } from '../hooks';
import { runUndo, wireActRows } from '../control/activity';
import { groupBursts } from '../control/sentence';
import { fromAuth, fromLog, mergePhases, PausedQueue, pushLive, verb, type ActivityItem } from '../control/feed';
import { ICO, openDrawer, openMenu, plural } from '../control/ui';
import { skBlock } from '../ui/skeleton';
import type { Select } from '../ui/select';
import { toast } from '../toast';
import type { LogEvent, LogsResult } from '../types';
import {
  CATS,
  STATUSES,
  TIMES,
  catOf,
  feedRange,
  isoDay,
  labelOf,
  quickOf,
  searchText,
  setQuick,
  stOf,
  windowOf,
  type Cat,
  type St,
  type TimeKey,
} from './activity-model';
import {
  CAT_COLOR,
  kpiSkeleton,
  atLeast,
  chartTitle,
  chip,
  dayViewHTML,
  daySkeleton,
  exportRows,
  notesHTML,
  paintChips,
  paintPills,
  problemsHTML,
  refreshTime,
  skLines,
  statTile,
  stickTimeline,
  sumHTML,
  timeChart,
  timelineHTML,
  timeSelect,
  topActionsHTML,
  touchedCount,
  unwatchSentinel,
  useTimelineStyles,
  watchSentinel,
  wireTimeline,
} from './activity-views';
import { count, opt, toggle } from './activity-filters';

const CSS = `
.at{display:flex;flex-direction:column;gap:20px;min-width:0;container:at/inline-size}
.at-ctl{display:flex;align-items:center;gap:8px;min-width:0}
.at-ctl .grow{flex:1}
.at-ctl .lg-live{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--line);flex:none;
  background:var(--surface-1);font-size:13px;font-weight:550;color:var(--muted);white-space:nowrap}
.at-ctl .lg-live:hover{border-color:var(--line-strong);color:var(--fg)}
.at-ctl .lg-live[aria-pressed=true]{color:var(--fg)}
.at-ctl .lg-live .cc-dot{width:6px;height:6px}
.at-ctl .lg-live[aria-pressed=true] .cc-dot{box-shadow:0 0 0 3px var(--ok-soft)}
.at-ctl .lg-live:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.at-ctl .cc-ibtn{width:40px;height:40px;border:1px solid var(--line);border-radius:10px;background:var(--surface-1)}
.at-ctl .cc-ibtn:hover{border-color:var(--line-strong)}
.at-ctl .at-span{font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.at-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:20px;align-items:start}
.at-chart{grid-column:span 8;align-self:stretch}
.at-chart .sm-card-b{flex:1;display:flex;flex-direction:column;justify-content:flex-end}
.at-chart .ax-col i{--bar:var(--ag)}
.at-chart .ax-cols{flex:1;height:auto;min-height:150px}
.at-top{grid-column:span 4;align-self:stretch}
.at-probs,.at-notes{grid-column:span 6}
.at-tl{margin-top:20px}
.at[hidden],.at-none[hidden]{display:none}
.at-none{align-items:center;gap:6px;padding:56px 24px;text-align:center;font-size:13.5px;color:var(--muted);line-height:1.55}
.at-none b{font-size:15px;font-weight:600;color:var(--fg)}
.at-none span{max-width:46ch}
.at-none .btn{margin-top:14px;height:40px;border-radius:10px}
.at-none-i{display:grid;place-items:center;width:44px;height:44px;margin-bottom:10px;border-radius:12px;color:#5eead4;background:linear-gradient(180deg,#17202e,#0b0f17)}
.at-none-i .cc-i{width:20px;height:20px}
.at-tl>.tl-h{margin-bottom:2px}
@container at (max-width:900px){
  .at-chart{grid-column:1/-1}
  .at-top,.at-probs{grid-column:span 6}
  .at-notes{grid-column:1/-1}
}
@container at (max-width:720px){
  .at .ax-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .at .ax-kpi:nth-child(3){border-left:0}
  .at .ax-kpi:nth-child(n+3){border-top:1px solid var(--line)}
}
@container at (max-width:620px){
  .at,.at-grid{gap:16px}
  .at-grid>*{grid-column:1/-1!important}
  .at-chart .ax-cols{min-height:120px}
  .at-ctl .at-span{display:none}
  .at-ctl .tl-time{flex:1 1 auto}
}
@container at (max-width:360px){
  .at .ax-kpi .h{white-space:normal}
}
@media (max-width:760px){
  .at-ctl .lg-live{height:44px}
  .at-ctl .cc-ibtn{width:44px;height:44px}
}
`;

const PAGE = 120;
const FETCH = 2000;

/** This tab's own filters (the Activity page keeps its own). */
const D = {
  time: '7d' as TimeKey,
  from: '',
  to: '',
  cats: new Set<Cat>(),
  actions: new Set<string>(),
  status: new Set<St>(),
  q: '',
};

interface Who {
  id: string;
  name: string;
  /** The key was ever used (its total call count). */
  used?: boolean;
}

interface TabOpts {
  /** How far from the scroller's top the timeline's toolbar sticks (under the tabs). */
  top(): number;
  /** Open the setup guide (the empty state's button). */
  setup(): void;
}

let root: HTMLElement | null = null;
let scroller: HTMLElement | null = null;
let who: Who | null = null;
let all: ActivityItem[] = [];
let loading = true;
let loadingMore = false;
let seq = 0;
let limit = PAGE;
let fetchLimit = FETCH;
let loadedRange = '';
let older = false;
let localLeft = false;
let compact = true;
const open = new Set<string>();
let live = true;
const pending = new PausedQueue();
const fresh = new Set<string>();
let paintQueued = false;
let timeSel: Select | null = null;
let offScroll: (() => void) | null = null;
let sheet: HTMLElement | null = null;
let keyWired = false;
let tabOpts: TabOpts | null = null;

/** Show agent `k`'s activity inside `el`; `view` is the element that scrolls. */
export function mountAgentActivity(el: HTMLElement, view: HTMLElement, k: Who, o: TabOpts): void {
  useTimelineStyles();
  useStyles('at-css', CSS);
  leaveAgentActivity();
  const same = who?.id === k.id;
  root = el;
  scroller = view;
  tabOpts = o;
  who = { id: k.id, name: k.name, used: k.used };
  if (!same) {
    all = [];
    D.time = '7d';
    D.from = D.to = '';
    D.cats.clear();
    D.actions.clear();
    D.status.clear();
    D.q = '';
    live = true;
    compact = true;
    open.clear();
    loadedRange = '';
  }
  limit = PAGE;
  fetchLimit = FETCH;
  pending.take();
  fresh.clear();
  loading = !all.length;
  shell();
  void load(!!all.length);
}

/** The tab is left: stop observing, close its sheet. */
export function leaveAgentActivity(): void {
  seq++;
  unwatchSentinel(root?.querySelector<HTMLElement>('#adBody') || null);
  offScroll?.();
  offScroll = null;
  if (sheet && document.body.contains(sheet)) sheet.querySelector<HTMLElement>('[data-x]')?.click();
  sheet = null;
  root = null;
}

function shown(): boolean {
  return !!root && root.isConnected && !root.closest('.hidden');
}

/** One agent's log and audit events, newest first; `logged` is how many log rows came back (to detect a cut-off). */
export async function fetchAgentEvents(w: { id: string | null; name: string }, range: string, max: number): Promise<{ items: ActivityItem[]; logged: number }> {
  const actor = encodeURIComponent(w.name);
  const [logs, auth] = await Promise.all([
    apiGet<LogsResult>(`/api/logs?range=${encodeURIComponent(range)}&actor=${actor}&limit=${max}`).catch(() => ({ events: [] }) as LogsResult),
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

async function load(soft: boolean, now = false): Promise<void> {
  if (!who) return;
  const w = who;
  const my = ++seq;
  const range = feedRange(D);
  if (!soft) {
    loading = true;
    paint(false);
  }
  try {
    const got = await fetchAgentEvents(w, range, fetchLimit);
    if (my !== seq || who !== w) return;
    const fetched = got.items;
    // Keep live items newer than the snapshot (the log can lag a little).
    const top = fetched.length ? fetched[0].ts : 0;
    const keep = all.filter((x) => x.live && x.ts > top - 15 && !fetched.some((f) => f.action === x.action && Math.abs(f.ts - x.ts) < 15));
    if (soft && all.length && !now) {
      const known = new Set(all.map((x) => x.action + Math.round(x.ts)));
      fetched.forEach((x) => known.has(x.action + Math.round(x.ts)) || fresh.add(x.id));
    }
    all = [...keep, ...fetched];
    older = got.logged >= fetchLimit * 0.95;
    loadedRange = range;
  } catch (e) {
    if (my !== seq) return;
    toast('Could not load activity: ' + (e as Error).message, 'err');
    if (now) older = false;
  }
  loading = false;
  loadingMore = false;
  paint(soft);
}

function isMine(x: ActivityItem): boolean {
  if (!who) return false;
  const kid = typeof x.raw.actor_id === 'string' ? x.raw.actor_id : null;
  return kid ? kid === who.id : x.actor === who.name;
}

/** A live event; taken when it is this agent's and the tab is open. */
export function agentActivityLive(it: ActivityItem): void {
  if (!shown() || loading || !isMine(it)) return;
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
  if (paintQueued) return;
  paintQueued = true;
  setTimeout(() => {
    paintQueued = false;
    paint(true);
  }, 400);
}

function paintLive(): void {
  const b = root?.querySelector<HTMLElement>('#adLive');
  if (!b) return;
  b.setAttribute('aria-pressed', String(live));
  b.innerHTML = live ? '<span class="cc-dot ok"></span>Live' : `<span class="cc-dot idle"></span>Paused`;
  b.title = live ? 'Pause: new activity waits until you show it' : 'Resume: show new activity as it happens';
  const nb = root!.querySelector<HTMLButtonElement>('#adNew');
  if (nb) {
    nb.hidden = live || !pending.length;
    nb.textContent = `${pending.length} new · Show`;
    nb.setAttribute('aria-label', `Show ${plural(pending.length, 'new action')}`);
  }
}

function resume(): void {
  live = true;
  pending.take().forEach(ingest);
  paintLive();
}

type Facet = 'cats' | 'status' | 'q';

function match(x: ActivityItem, skip?: Facet): boolean {
  // Note events repeating this agent's own calls would show every change twice.
  if (x.echo) return false;
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

function rows(): ActivityItem[] {
  return scoped().filter((x) => match(x));
}

function oldestLoaded(): number {
  return all.length ? all[all.length - 1].ts : Date.now() / 1000;
}

function narrowed(): boolean {
  return !!(D.q || D.cats.size || D.actions.size || D.status.size);
}

function filterCount(): number {
  return D.cats.size + D.actions.size + D.status.size;
}

function setQ(v: string): void {
  D.q = v;
  const q = root?.querySelector<HTMLInputElement>('#adQ');
  if (q && q.value !== v) {
    q.value = v;
    q.dispatchEvent(new Event('input'));
  }
}

function clearAll(withTime = false): void {
  D.cats.clear();
  D.actions.clear();
  D.status.clear();
  setQ('');
  limit = PAGE;
  if (withTime && D.time !== '7d') return setTime('7d');
  paint(false);
}

function setTime(t: TimeKey, from = '', to = ''): void {
  D.time = t;
  D.from = from;
  D.to = to;
  limit = PAGE;
  refreshTime(timeSel);
  if (feedRange(D) !== loadedRange) {
    fetchLimit = FETCH;
    void load(false);
  } else paint(false);
}

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
    <section class="ax-fg"><h3>Result</h3><div class="ax-opts">${STATUSES.map((s) =>
      opt('status', s.id, s.label, D.status.has(s.id), st.get(s.id) || 0, `<span class="cc-dot ${s.id === 'fail' ? 'err' : s.id === 'running' ? 'run' : 'ok'}"></span>`),
    ).join('')}</div></section>
    <section class="ax-fg"><h3>What</h3><div class="ax-opts">${CATS.filter((c) => cats.get(c.id) || D.cats.has(c.id) || c.id !== 'other')
      .map((c) => opt('cats', c.id, c.label, D.cats.has(c.id), cats.get(c.id) || 0, `<i class="sw" style="--c:${CAT_COLOR[c.id]}"></i>`, c.hint))
      .join('')}</div>
      ${
        acts.length
          ? `<details class="ax-acts"${D.actions.size ? ' open' : ''}><summary>Specific actions<span class="n">${acts.length}</span></summary>
        <div class="ax-opts">${acts.map(([a, n]) => opt('actions', a, verb(a), D.actions.has(a), n, '', a)).join('')}</div></details>`
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
  const wasOpen = b.querySelector<HTMLDetailsElement>('.ax-acts')?.open;
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
  const n = rows().length;
  const done = sheet.querySelector<HTMLElement>('[data-done]');
  if (done) done.textContent = `Show ${plural(n, 'action')}`;
  const sub = sheet.querySelector<HTMLElement>('.cc-drawer-h .s');
  if (sub) sub.textContent = `${who?.name || ''} · ${n} of ${plural(scoped().length, 'action')} match`;
}

function openSheet(): void {
  const d = openDrawer({
    title: 'Filters',
    sub: ' ',
    body: '',
    foot: `<button type="button" class="btn ghost" data-reset>Reset</button><span style="flex:1"></span><button type="button" class="btn primary" data-done>Show actions</button>`,
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
      clearAll(true);
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

function shell(): void {
  if (!root || !who) return;
  root.innerHTML = `<div class="at-none sm-card" id="adNone" hidden><span class="at-none-i">${ICO.plug}</span><b>No activity yet</b>
      <span>Once ${esc(who.name)} is connected, everything it reads, writes and searches shows up here, live.</span>
      <button type="button" class="btn" data-setup>Open the setup guide</button></div>
    <div class="at" id="adMain">
    <div class="at-ctl"><span id="adTime"></span><span class="at-span" id="adSpan"></span><span class="grow"></span>
      <button type="button" class="lg-live" id="adLive" aria-pressed="${live}"></button>
      <button type="button" class="cc-ibtn" id="adMore" aria-haspopup="menu" aria-label="More: export, all activity" title="More">${ICO.more}</button></div>
    <div class="ax-kpis" id="adKpis"></div>
    <div class="at-grid">
      <section class="sm-card at-chart" aria-labelledby="adChartH"><div class="sm-card-h"><h2 id="adChartH">Actions over time</h2><span class="sub" id="adChartS"></span></div>
        <div class="sm-card-b" id="adChart"></div></section>
      <section class="sm-card at-top" aria-labelledby="adTopH"><div class="sm-card-h"><h2 id="adTopH">What it does most</h2></div><div class="sm-card-b" id="adTop"></div></section>
      <section class="sm-card at-probs" aria-labelledby="adPrH"><div class="sm-card-h"><h2 id="adPrH">Problems</h2><span id="adPrA"></span></div><div id="adProbs"></div></section>
      <section class="sm-card at-notes" aria-labelledby="adNtH"><div class="sm-card-h"><h2 id="adNtH">Most touched notes</h2></div><div id="adNotes"></div></section>
    </div>
    <section class="tl at-tl" id="adTl" aria-labelledby="adTlH">
      <div class="tl-h"><h2 id="adTlH">Timeline</h2><span class="sub">Everything ${esc(who.name)} did, newest first</span></div>
      ${timelineHTML('ad', D.q, 'Search notes and actions')}
    </section>
  </div>`;
  timeSel = timeSelect(
    () => D,
    (v) => {
      if (v === 'custom') {
        refreshTime(timeSel);
        openSheet();
      } else setTime(v);
    },
  );
  root.querySelector('#adTime')!.replaceWith(timeSel.el);
  root.querySelector<HTMLElement>('[data-setup]')!.onclick = () => tabOpts?.setup();
  wire(() => tabOpts?.top() || 0);
  paintLive();
  paint(false);
}

function scrollToTimeline(): void {
  const tl = root?.querySelector<HTMLElement>('#adTl');
  const h = scroller;
  if (!tl || !h) return;
  requestAnimationFrame(() => {
    const y = tl.getBoundingClientRect().top - h.getBoundingClientRect().top + h.scrollTop - 60;
    h.scrollTo({ top: Math.max(0, y), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}

function wire(top: () => number): void {
  const r = root!;
  wireTimeline(r, 'ad', {
    query: (q) => {
      D.q = q;
      limit = PAGE;
      paint(false);
    },
    quick: (id) => {
      setQuick(id, D);
      limit = PAGE;
      paint(false);
    },
    filters: openSheet,
    remove: (spec) => {
      const [k, ...rest] = spec.split(':');
      const v = rest.join(':');
      if (k === 'cats') D.cats.delete(v as Cat);
      else if (k === 'actions') D.actions.delete(v);
      else if (k === 'status') D.status.delete(v as St);
      limit = PAGE;
      paint(false);
    },
    clear: () => clearAll(),
    compact: () => {
      compact = !compact;
      paint(false);
    },
  });
  r.querySelector<HTMLElement>('#adLive')!.onclick = () => {
    if (live) live = false;
    else {
      resume();
      void load(true);
    }
    paintLive();
  };
  r.querySelector<HTMLElement>('#adNew')!.onclick = () => {
    resume();
    scrollToTimeline();
  };
  const more = r.querySelector<HTMLElement>('#adMore')!;
  more.onclick = () =>
    openMenu(
      more,
      [
        {
          label: 'Reload',
          desc: 'Fetch its activity again from the server.',
          icon: ICO.refresh,
          run: () => void load(false),
        },
        {
          label: 'See it among all activity',
          desc: 'The Activity page, showing only this agent.',
          icon: ICO.filter,
          run: () => {
            try {
              sessionStorage.setItem('memora.activity.agent', who?.name || '');
            } catch {
              /* optional */
            }
            hooks.go('logs');
          },
        },
        { sep: true, label: '' },
        { label: 'Export timeline as JSON', desc: 'The actions the timeline shows, for scripts.', icon: ICO.download, run: () => exportRows(rows(), 'json', who?.name) },
        { label: 'Export timeline as CSV', desc: 'The actions the timeline shows, for a spreadsheet.', icon: ICO.download, run: () => exportRows(rows(), 'csv', who?.name) },
      ],
      { title: who?.name || 'Activity' },
    );
  // The summary filters the timeline or opens a note.
  r.querySelector<HTMLElement>('.at')!.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('#adBody')) {
      const el = t.closest<HTMLElement>('[data-pick]');
      if (!el) return;
      if (el.dataset.pick === 'time:all') setTime('all');
      else clearAll();
      return;
    }
    let el: HTMLElement | null;
    if ((el = t.closest<HTMLElement>('[data-f]'))) {
      const [k, ...rest] = el.dataset.f!.split(':');
      const v = rest.join(':');
      if (k === 'actions') {
        D.cats.clear();
        D.status.clear();
        D.actions = new Set([v]);
      } else if (k === 'status') setQuick('fail', D);
      limit = PAGE;
      paint(false);
      scrollToTimeline();
    } else if (t.closest('[data-prob]')) {
      setQuick('fail', D);
      limit = PAGE;
      paint(false);
      scrollToTimeline();
    } else if ((el = t.closest<HTMLElement>('[data-note]')) && !t.closest('.act')) hooks.openNote(el.dataset.note!);
  });
  const body = r.querySelector<HTMLElement>('#adBody')!;
  wireActRows(body, (id) => all.find((x) => x.id === id), undefined, {
    onBurst: (id) => {
      if (!open.delete(id)) open.add(id);
      paint(true);
    },
    onUndo: (it) => void runUndo(it).then(() => paint(true)),
    agentPage: who?.id,
  });
  if (scroller) {
    const h = scroller;
    const onBar = stickTimeline(r, 'ad', h, top);
    h.addEventListener('scroll', onBar, { passive: true });
    offScroll = () => h.removeEventListener('scroll', onBar);
  }
  if (!keyWired) {
    keyWired = true;
    // "/" jumps to this tab's search.
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || !shown()) return;
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select,[contenteditable=true],.cc-drawer,.modal')) return;
      const q = root?.querySelector<HTMLInputElement>('#adQ');
      if (!q) return;
      e.preventDefault();
      q.focus();
      q.select();
    });
  }
}

function chipsOf(): string[] {
  const c: string[] = [];
  if (!quickOf(D)) {
    D.status.forEach((s) => c.push(chip('status:' + s, STATUSES.find((x) => x.id === s)!.label, '', 'Result ')));
    D.cats.forEach((k) => c.push(chip('cats:' + k, CATS.find((x) => x.id === k)!.label, `<i class="sw" style="--c:${CAT_COLOR[k]}"></i>`)));
  }
  D.actions.forEach((a) => c.push(chip('actions:' + a, verb(a), '', '')));
  return c;
}

function kpisHTML(sc: ActivityItem[]): string {
  const now = Date.now() / 1000;
  const mid = new Date();
  mid.setHours(0, 0, 0, 0);
  const midTs = mid.getTime() / 1000;
  const oldest = oldestLoaded();
  const mine = all.filter((x) => !x.echo);
  const today = atLeast(mine.filter((x) => x.ts >= midTs).length, midTs, oldest, older);
  const week = atLeast(mine.filter((x) => x.ts >= now - 7 * 86400).length, now - 7 * 86400, oldest, older);
  const fails = sc.filter((x) => stOf(x) === 'fail').length;
  const t = touchedCount(sc);
  const w = win();
  const first = sc.length ? sc[sc.length - 1].ts : now;
  const since = w.since > 0 ? w.since : first;
  const until = Number.isFinite(w.until) ? Math.min(w.until, now) : now;
  // Two days or less read better per hour.
  const hourly = until - since <= 2 * 86400;
  const days = hourly ? Math.max(1, Math.ceil((until - since) / 3600 - 0.01)) : Math.max(1, Math.ceil((until - since) / 86400 - 0.01));
  const avg = sc.length / days;
  // The first number follows the chosen range; today's count goes under it.
  const short = D.time === 'today' || D.time === '1h';
  return `${short ? statTile(labelOf(D), sc.length, `${week} in the last 7 days`) : statTile(labelOf(D), sc.length, `${today} today`)}
    ${statTile('Problems', fails, sc.length ? `${Math.round((fails / sc.length) * 100)}% of ${plural(sc.length, 'action')}` : 'Nothing in this range', fails > 0, fails ? 'status:fail' : '')}
    ${statTile('Notes touched', t.n, t.top ? `Most: ${t.top}` : 'None in this range')}
    ${statTile(hourly ? 'Per hour' : 'Per day', (avg >= 10 ? String(Math.round(avg)) : avg.toFixed(1).replace(/\.0$/, '')) + (older && oldest > since ? '+' : ''), `Average over ${plural(days, hourly ? 'hour' : 'day')}`)}`;
}

function summary(): void {
  const r = root!;
  const q = <T extends HTMLElement = HTMLElement>(id: string): T => r.querySelector<T>('#' + id)!;
  if (loading && !all.length) {
    q('adKpis').innerHTML = kpiSkeleton().repeat(4);
    q('adChart').innerHTML = skBlock('100%', 168);
    q('adTop').innerHTML = skLines(5);
    q('adProbs').innerHTML = `<div class="sm-card-b">${skLines(2)}</div>`;
    q('adNotes').innerHTML = `<div class="sm-card-b">${skLines(3)}</div>`;
    return;
  }
  const sc = scoped().filter((x) => !x.echo);
  const w = win();
  q('adSpan').textContent = plural(sc.length, 'action');
  q('adKpis').innerHTML = kpisHTML(sc);
  q('adChartH').textContent = sc.length ? chartTitle(sc, w) : 'Actions over time';
  q('adChartS').innerHTML = sc.some((x) => stOf(x) === 'fail') ? '<i class="ax-key"></i>problems' : '';
  q('adChart').innerHTML = timeChart(sc, w);
  q('adTop').innerHTML = topActionsHTML(sc, 6);
  const fails = sc.filter((x) => stOf(x) === 'fail').length;
  q('adPrA').innerHTML = fails ? `<button type="button" class="sm-lnk" data-f="status:fail">Show all ${fails} ${ICO.arrow}</button>` : '';
  q('adProbs').innerHTML = problemsHTML(sc, 4, false);
  q('adNotes').innerHTML = notesHTML(sc, 6);
}

/** Keep the first visible row in place while the list above it changes. */
function anchor(): () => void {
  const h = scroller;
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
  // Never used and nothing in the log: one calm empty state instead of zeros.
  const none = !loading && !all.length && !who.used;
  root!.querySelector<HTMLElement>('#adNone')!.hidden = !none;
  root!.querySelector<HTMLElement>('#adMain')!.hidden = none;
  if (none) return;
  const restore = keepPlace ? anchor() : () => {};
  summary();
  paintPills(root!, 'ad', quickOf(D));
  paintChips(root!, 'ad', chipsOf(), filterCount());
  const sum = root!.querySelector<HTMLElement>('#adSum')!;
  if (loading && !all.length) {
    sum.innerHTML = '<span>Loading…</span>';
    body.setAttribute('aria-busy', 'true');
    body.innerHTML = daySkeleton();
    return;
  }
  body.removeAttribute('aria-busy');
  const sc = scoped();
  const rs = sc.filter((x) => match(x));
  const trimmed = older && oldestLoaded() > win().since;
  sum.innerHTML = sumHTML({
    n: atLeast(rs.length, win().since, oldestLoaded(), older),
    unit: ['action', 'actions'],
    note: labelOf(D),
    fails: rs.filter((x) => stOf(x) === 'fail').length,
    compact,
  });
  localLeft = groupBursts(rs, compact).length > limit;
  body.innerHTML = dayViewHTML({
    rows: rs,
    fresh,
    limit,
    compact,
    open,
    older: trimmed,
    narrowed: narrowed(),
    none: !sc.length,
    what: `What ${who.name} reads, writes and searches shows up here as it happens.`,
  });
  restore();
  fresh.clear();
  paintSheet();
  if (scroller) watchSentinel(body, scroller, more);
}

/** The end of the timeline came near: show more of what is loaded, or load older activity. */
function more(): void {
  if (loadingMore) return;
  if (localLeft) {
    limit += PAGE;
    paint(true);
    return;
  }
  if (older) {
    loadingMore = true;
    fetchLimit += FETCH;
    void load(true, true);
  }
}
