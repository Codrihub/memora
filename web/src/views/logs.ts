// Activity page: the summary at /activity and the timeline at /activity/timeline.
// Old /activity/<id> addresses open the agent's page, or this page filtered to that actor.

import { $, esc, useStyles } from '../dom';
import { debounce } from '../format';
import { apiGet } from '../api';
import { avatarHTML, setAgentColors } from '../control/agents';
import { openAgentPage, runUndo, useActivityStyles, wireActRows } from '../control/activity';
import { actionLabel, groupBursts, isSystem } from '../control/sentence';
import { fromAuth, fromLog, loadFeed, onLive, PausedQueue, pushLive, type ActivityItem, type Source } from '../control/feed';
import { ICO, openMenu, plural, systemHeader, useControlStyles, whileVisible } from '../control/ui';
import type { KeyRow, KeysResult, LogsResult } from '../types';
import { toast } from '../toast';
import { logsTimeline, onNavigate, replaceHistory, setKeysRoute, setLogsTimeline, syncUrl, takeRouteAgent } from '../router';
import { hooks } from '../hooks';
import { skBlock } from '../ui/skeleton';
import type { Select } from '../ui/select';
import {
  CATS,
  F,
  SRCS,
  STATUSES,
  activeCount,
  classifyAgents,
  clearFilters,
  feedRange,
  inWindow,
  matches,
  quickOf,
  setQuick,
  stOf,
  systemShown,
  timeLabel,
  timeWindow,
  type AgentInfo,
  type Cat,
  type Quick,
  type St,
  type TimeKey,
} from './activity-model';
import {
  CAT_COLOR,
  kpiSkeleton,
  agentRowsHTML,
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
  useTimelineStyles,
  watchSentinel,
  wireTimeline,
} from './activity-views';
import { openFilters, refreshFilters } from './activity-filters';

const CSS = `
.ax{container:ax/inline-size;--r14:14px;--tile:color-mix(in srgb,var(--fg) 5%,transparent)}
@media (min-width:1101px){.ax{padding:8px 8px 0}}
.ax .ag-av{border-radius:30%}
.ax .ag-av.live::after{border-radius:34%}
.ax .sys-head{align-items:flex-end;margin:0 0 24px}
.ax .sys-head h1{font-size:26px;font-weight:650;letter-spacing:-.02em}
.ax .sys-head p{margin-top:6px;font-size:14px}
.ax .sys-acts .cc-ibtn{width:40px;height:40px;border-radius:10px;border-color:var(--line);background:var(--surface-1)}
.ax .sys-acts .cc-ibtn:hover{border-color:var(--line-strong)}
.lg-live{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--line);flex:none;
  background:var(--surface-1);font-size:13px;font-weight:550;color:var(--muted);transition:border-color .16s,color .16s;white-space:nowrap}
.lg-live:hover{border-color:var(--line-strong);color:var(--fg)}
.lg-live .cc-dot{width:6px;height:6px}
.lg-live[aria-pressed=true]{color:var(--fg)}
.lg-live[aria-pressed=true] .cc-dot{box-shadow:0 0 0 3px var(--ok-soft)}
.lg-live:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.ax-sm{display:flex;flex-direction:column;gap:20px;margin:0 0 44px}
.ax-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:20px;align-items:start}
.ax-chart{grid-column:span 8;align-self:stretch}
.ax-chart .sm-card-b{flex:1;display:flex;flex-direction:column;justify-content:flex-end}
.ax-chart .ax-cols{flex:1;height:auto;min-height:150px}
.ax-top{grid-column:span 4;align-self:stretch}
.ax-agents{grid-column:span 8;container:agl/inline-size}
.ax-probs,.ax-notes{grid-column:span 4}
.sm-card-h .sub .ax-key{margin-left:2px}

.sm-ags{display:flex;flex-direction:column;padding:0 12px 10px}
.sm-ag{position:relative;display:grid;grid-template-columns:36px minmax(110px,1fr) minmax(0,1.5fr) 56px 64px 84px 16px;align-items:center;gap:12px;
  min-height:60px;padding:10px;border-radius:10px;text-align:left;color:inherit;text-decoration:none;width:100%;transition:background .12s}
.sm-ag,.sm-ag:hover,.sm-ag:focus{text-decoration:none}
.sm-ag+.sm-ag::before{content:"";position:absolute;top:0;left:58px;right:10px;border-top:1px solid var(--line)}
a.sm-ag:hover,button.sm-ag:hover{background:var(--hover)}
a.sm-ag:hover::before,button.sm-ag:hover::before,a.sm-ag:hover+.sm-ag::before,button.sm-ag:hover+.sm-ag::before{border-color:transparent}
.sm-ag:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.sm-ag-h{min-height:30px;padding-top:0;padding-bottom:6px;font-size:12px;font-weight:500;color:var(--muted)}
.sm-ag.sm-ag-h .r{font-size:12px;font-weight:500;color:var(--muted)}
.sm-ag-g{font-size:12.5px;font-weight:500;color:var(--muted);padding:16px 10px 4px}
.sm-ag-av{display:grid}
.sm-ag-id{display:flex;flex-direction:column;gap:2px;min-width:0}
.sm-ag-id b{font-size:14px;font-weight:600;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-st{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);white-space:nowrap;min-width:0}
.sm-st::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--text-3);flex:none}
.sm-st.active{color:var(--fg)}
.sm-st.active::before{background:var(--ok);box-shadow:0 0 0 3px var(--ok-soft)}
.sm-st.recent::before{background:var(--accent)}
.sm-st.off::before,.sm-st.removed::before{background:var(--warn)}
.sm-st em{display:none;font-style:normal;color:var(--fg)}
.sm-st em::before{content:"·";margin:0 6px 0 0;color:var(--muted)}
.sm-ag-last{display:flex;flex-direction:column;gap:2px;min-width:0}
.sm-ag-last .t{font-size:13.5px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-ag-last small{font-size:12px;color:var(--muted);white-space:nowrap}
.sm-ag-last small:empty{display:none}
.sm-ag .r{justify-self:end;font-size:14px;font-weight:500;color:var(--fg);font-variant-numeric:tabular-nums}
.sm-ag .r.z{color:var(--text-3);font-weight:400}
.sm-ag-f.bad{display:inline-flex;align-items:center;gap:6px}
.sm-ag-f.bad::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--danger)}
.sm-spark{display:flex;align-items:flex-end;gap:2px;height:24px;width:100%}
.sm-spark i{flex:1;background:var(--ag);border-radius:2px;opacity:.85;min-height:2px}
.sm-spark i.z{opacity:.16}
.sm-ag-go{display:grid;place-items:center;color:var(--text-3)}
.sm-ag-go .cc-i{width:16px;height:16px}
.sm-ag:hover .sm-ag-go{color:var(--fg)}
.sm-ag.dim .sm-ag-id b,.sm-ag.dim .sm-ag-av{opacity:.72}
.sm-more{display:flex;align-items:center;justify-content:center;gap:8px;width:calc(100% - 24px);height:40px;margin:0 12px 12px;border-radius:10px;
  background:var(--tile);font-size:13px;font-weight:550;color:var(--text-2)}
.sm-more:hover{background:color-mix(in srgb,var(--fg) 8%,transparent);color:var(--fg)}
.sm-more:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.ax[data-view=summary] .ax-tl,.ax[data-view=timeline] .ax-sm{display:none}
.ax-tl{scroll-margin-top:0}
.ax-tl>.tl-h{display:none}
.ax-tabs{margin:-4px 0 20px}
.ax-wait{display:flex;align-items:center;gap:10px;margin:-8px 0 16px;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.45;color:var(--text-2);
  background:color-mix(in srgb,var(--accent) 7%,transparent);border:1px solid color-mix(in srgb,var(--accent) 22%,transparent)}
.ax-wait[hidden]{display:none}
.ax-wait i{flex:none;width:14px;height:14px;border-radius:50%;border:2px solid color-mix(in srgb,var(--accent) 30%,transparent);border-top-color:var(--accent);animation:ax-spin .8s linear infinite}
@keyframes ax-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.ax-wait i{animation:none}}
.ax-tabs-in{display:inline-flex;gap:2px;padding:3px;border-radius:12px;background:var(--seg-track);max-width:100%}
.ax-tab{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:38px;padding:0 20px;border-radius:9px;border:1px solid transparent;
  font-size:14px;font-weight:550;color:var(--muted);text-decoration:none;white-space:nowrap;transition:background .15s,color .15s}
.ax-tab:hover{color:var(--fg)}
.ax-tab .cc-i{width:16px;height:16px}
.ax-tab b{font-size:12px;font-weight:600;color:var(--text-3);font-variant-numeric:tabular-nums}
.ax-tab b:empty{display:none}
.ax-tab[aria-current=page]{color:var(--fg);background:var(--seg-thumb);border-color:var(--line-strong)}
.ax-tab[aria-current=page] b{color:var(--text-2)}
.ax-tab:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.ax-side{grid-column:span 4;display:flex;flex-direction:column;gap:20px;min-width:0}


@container agl (max-width:640px){
  .sm-ags{padding:0 6px 8px}
  .sm-ag{grid-template-columns:36px minmax(0,1fr) auto 16px;grid-template-areas:"av id n go" "av last n go";row-gap:2px;column-gap:12px;min-height:62px}
  .sm-ag+.sm-ag::before{left:58px}
  .sm-ag-av{grid-area:av}
  .sm-ag-id{grid-area:id;flex-direction:row;align-items:center;gap:10px}
  .sm-ag-last{grid-area:last;flex-direction:row;align-items:baseline;gap:6px}
  .sm-ag-last small::before{content:"· "}
  .sm-ag-n{grid-area:n}
  .sm-ag-go{grid-area:go}
  .sm-ags .sm-ag-f,.sm-ags .sm-ag-sp,.sm-ags .sm-ag-h{display:none}
  .sm-st em{display:inline}
  .sm-more{width:calc(100% - 12px);margin:0 6px 10px}
}
@container agl (max-width:400px){
  .sm-ag-id{flex-direction:column;align-items:flex-start;gap:1px}
  .sm-ag{grid-template-areas:"av id n go" "av last last last"}
}
@container ax (max-width:1000px){
  .ax-side{display:contents}
  .ax-chart,.ax-agents,.ax-notes{grid-column:1/-1;grid-row:auto}
  .ax-top,.ax-probs{grid-column:span 6;align-self:stretch}
  .ax-chart{order:1}.ax-top{order:2}.ax-probs{order:3}.ax-agents{order:4}.ax-notes{order:5}
}
@container ax (max-width:720px){
  .ax-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ax-kpi:nth-child(3){border-left:0}
  .ax-kpi:nth-child(n+3){border-top:1px solid var(--line)}
}
@container ax (max-width:640px){
  .ax-sm{gap:16px;margin-bottom:36px}
  .ax-grid{gap:16px}
  .ax-grid>*,.ax-side>*{grid-column:1/-1!important}
  .ax-tabs{margin:0 0 16px}
  .ax-tabs-in{display:flex}
  .ax-tab{flex:1;padding:0 12px}
  .ax-chart{order:1}.ax-agents{order:2}.ax-probs{order:3}.ax-top{order:4}.ax-notes{order:5}
  .ax-chart .ax-cols{min-height:120px}
}
@container ax (max-width:360px){
  .ax .ax-kpi .h{white-space:normal}
}
@media (max-width:760px){
  .ax .sys-acts{grid-column:1/-1;width:100%}
  .ax .sys-acts .tl-time{flex:1 1 auto}
  .ax .sys-acts .cc-ibtn{width:44px;height:44px}
  .lg-live{height:44px}
}
`;

const PAGE = 120;
// Enough to cover a range in full (the summary counts every event in it), loaded in pages of 2000.
const FETCH = 20000;
const AG_CAP = 8;

let items: ActivityItem[] = [];
let keys: KeyRow[] = [];
const pending = new PausedQueue();
/** Held items that the current filters would show (what "N new" counts). */
let pendingShown = 0;
const fresh = new Set<string>();
/** Bursts shown expanded, by the id of their newest call. */
const open = new Set<string>();
let limit = PAGE;
let fetchLimit = FETCH;
/** The range the loaded events were asked for. */
let loadedRange = '';
let older = false;
let compact = true;
let live = true;
let loading = true;
let loadingMore = false;
/** Older pages of the range are still coming in (the newest is on screen). */
let filling = false;
/** The timeline missed redraws while the summary was shown. */
let timelineStale = false;
/** More filtered groups than the list shows (set by each paint). */
let localLeft = false;
/** What the summary was last drawn from; it is redrawn only when that changes. */
let sumKey = '';
let allAgents = false;
let loadSeq = 0;
let paintQueued = false;
let timeSel: Select | null = null;
let onBarScroll: (() => void) | null = null;

function host(): HTMLElement {
  return $('#view-logs');
}

function scoped(): ActivityItem[] {
  return inWindow(items);
}

function narrowed(): boolean {
  return !!(F.q || F.cats.size || F.actions.size || F.srcs.size || F.agents.size || F.status.size || F.system);
}

/** Every filter but the hiding of system lines. */
function matchesBut(it: ActivityItem): boolean {
  F.system = true;
  try {
    return matches(it);
  } finally {
    F.system = false;
  }
}

function slugFromUrl(): string | null {
  const m = /^\/activity\/([A-Za-z0-9_-]{1,64})\/?$/.exec(location.pathname);
  return m && m[1] !== 'timeline' ? m[1] : null;
}

async function fetchKeys(): Promise<KeyRow[]> {
  return apiGet<KeysResult | KeyRow[]>('/api/keys')
    .then((d) => (Array.isArray(d) ? d : d.keys || []))
    .catch(() => [] as KeyRow[]);
}

export async function renderLogs(): Promise<void> {
  useControlStyles();
  useActivityStyles();
  useTimelineStyles();
  useStyles('cc-logs-css', CSS);
  const h = host();
  if (!h.classList) return;
  takeRouteAgent();
  const slug = slugFromUrl();
  if (slug && (await redirect(slug))) return;

  let toTimeline = false;
  try {
    const a = sessionStorage.getItem('memora.activity.agent');
    if (a) {
      sessionStorage.removeItem('memora.activity.agent');
      F.agents = new Set([a]);
      toTimeline = true;
    }
  } catch {
    /* optional */
  }

  // Sent here filtered to one actor: that is the timeline's job.
  if ((toTimeline || (slug && F.agents.size)) && !logsTimeline) {
    setLogsTimeline(true);
    replaceHistory();
    syncUrl();
  }
  const first = !h.querySelector('#axRoot');
  if (first) build(h);
  applyView();
  startLive(h);
  if (first || slug) await reload();
  else {
    paint(false);
    if (live) softReload();
  }
}

// Leaving Activity: the next visit starts on the summary.
onNavigate((p) => {
  if (p !== 'logs') setLogsTimeline(false);
});

/** Summary or timeline, from the address. */
function applyView(): void {
  const root = document.getElementById('axRoot');
  if (!root) return;
  const tl = logsTimeline;
  const was = root.dataset.view;
  root.dataset.view = tl ? 'timeline' : 'summary';
  root.querySelector('.sys-t p')!.textContent = tl
    ? 'Every action, newest first, with search and filters.'
    : 'What your AIs read, write and search in your notes.';
  root.querySelectorAll<HTMLElement>('.ax-tab').forEach((t) => {
    if (t.dataset.v === root.dataset.view) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (was && was !== root.dataset.view) host().scrollTop = 0;
  if (tl && timelineStale) paint(false);
}

/** Open the timeline (from the summary, or from anywhere in the app). */
export function openTimeline(): void {
  limit = PAGE;
  setLogsTimeline(true);
  hooks.go('logs');
}

/** An old /activity/<id> address: a connected key opens its agent's page, anything else filters this page. */
async function redirect(slug: string): Promise<boolean> {
  if (!keys.length) keys = await fetchKeys();
  if (keys.some((k) => k.id === slug)) {
    replaceHistory();
    setKeysRoute('/agents/' + encodeURIComponent(slug) + '/activity');
    hooks.go('keys');
    return true;
  }
  const find = (list: ActivityItem[]): ActivityItem | undefined => list.find((x) => x.raw.actor_id === slug) || list.find((x) => x.actor === slug);
  let hit = find(items);
  if (!hit) {
    const [ev, au] = await Promise.all([
      apiGet<LogsResult>('/api/logs?range=all&limit=2000')
        .then((d) => (d.events || []).map(fromLog))
        .catch(() => [] as ActivityItem[]),
      apiGet<LogsResult>('/api/auth/events?limit=300')
        .then((d) => (d.events || []).map(fromAuth))
        .catch(() => [] as ActivityItem[]),
    ]);
    hit = find(ev) || find(au);
  }
  try {
    history.replaceState({ page: 'logs' }, '', '/activity');
  } catch {
    /* sandboxed frames */
  }
  if (hit) {
    clearFilters(true);
    F.q = '';
    F.agents = new Set([hit.actor]);
    // Its last event is older than the range shown: widen it.
    if (hit.ts < timeWindow().since) {
      F.time = 'all';
      F.from = F.to = '';
    }
    const q = document.getElementById('axQ') as HTMLInputElement | null;
    if (q) q.value = '';
  } else toast(`Nothing in the log goes by “${slug}”. Showing all activity.`, 'info');
  return false;
}

function build(h: HTMLElement): void {
  h.innerHTML = `<div id="axRoot" class="cc ax">
    ${systemHeader(
      'logs',
      'Activity',
      'What your AIs read, write and search in your notes.',
      `<span id="axTime"></span><button type="button" class="lg-live" id="lgLive" aria-pressed="${live}"></button>
        <button type="button" class="cc-ibtn" id="axMore" aria-haspopup="menu" aria-label="More: reload, export" title="More">${ICO.more}</button>`,
    )}
    <nav class="ax-tabs" aria-label="Activity views"><div class="ax-tabs-in">
      <a class="ax-tab" href="/activity" data-v="summary">${ICO.summary}Summary</a>
      <a class="ax-tab" href="/activity/timeline" data-v="timeline">${ICO.activity}Timeline<b id="axTabN"></b></a>
    </div></nav>
    <p class="ax-wait" id="axWait" role="status" hidden></p>
    <section class="ax-sm" id="axSm" aria-label="Summary">
      <div class="ax-kpis" id="axKpis"></div>
      <div class="ax-grid">
        <section class="sm-card ax-chart" aria-labelledby="axChartH"><div class="sm-card-h"><h2 id="axChartH">Actions over time</h2><span class="sub" id="axChartS"></span></div>
          <div class="sm-card-b" id="axChart"></div></section>
        <section class="sm-card ax-top" aria-labelledby="axTopH"><div class="sm-card-h"><h2 id="axTopH">What agents do most</h2></div><div class="sm-card-b" id="axTop"></div></section>
        <section class="sm-card ax-agents" aria-labelledby="axAgH"><div class="sm-card-h"><h2 id="axAgH">Agents</h2><span class="sub" id="axAgS"></span>
          <a class="sm-lnk" href="/agents" id="axAgLnk">Manage ${ICO.arrow}</a></div><div id="axAgs"></div></section>
        <div class="ax-side">
          <section class="sm-card ax-probs" aria-labelledby="axPrH"><div class="sm-card-h"><h2 id="axPrH">Problems</h2><span id="axPrA"></span></div><div id="axProbs"></div></section>
          <section class="sm-card ax-notes" aria-labelledby="axNtH"><div class="sm-card-h"><h2 id="axNtH">Most touched notes</h2></div><div id="axNotes"></div></section>
        </div>
      </div>

    </section>
    <section class="tl ax-tl" id="axTl" aria-labelledby="axTlH">
      <div class="tl-h"><h2 id="axTlH">Timeline</h2><span class="sub">Every action, newest first</span></div>
      ${timelineHTML('ax', F.q, 'Search AIs, notes, words')}
    </section>
  </div>`;
  const root = $('#axRoot');
  timeSel = timeSelect(
    () => F,
    (v) => {
      if (v === 'custom') {
        refreshTime(timeSel);
        openSheet();
      } else setTime(v);
    },
  );
  $('#axTime').replaceWith(timeSel.el);
  wire(h, root);
  paintLive();
}

function setTime(t: TimeKey): void {
  F.time = t;
  F.from = F.to = '';
  timeChanged();
}

// The last load of each server range, so going back to a range shows at once.
const rangeCache = new Map<string, { items: ActivityItem[]; older: boolean; whole: boolean }>();
/** The next full load keeps what is on screen instead of showing skeletons. */
let keepShown = false;

function remember(range: string, whole: boolean): void {
  rangeCache.delete(range);
  rangeCache.set(range, { items, older, whole });
  while (rangeCache.size > 4) rangeCache.delete(rangeCache.keys().next().value!);
}

/** The time changed (select or sheet): load again only when the server range changes. */
function timeChanged(): void {
  limit = PAGE;
  refreshTime(timeSel);
  const range = feedRange();
  if (range === loadedRange) return paint(false);
  fetchLimit = FETCH;
  const hit = rangeCache.get(range);
  if (!hit) return void reload();
  loadSeq++;
  items = hit.items;
  older = hit.older;
  loadedRange = range;
  loading = false;
  filling = !hit.whole;
  paint(false);
  if (hit.whole) void reload(true, true);
  else {
    // Left before it finished: load it in full again, without skeletons.
    keepShown = true;
    void reload();
  }
}

function openSheet(): void {
  openFilters({
    scoped,
    agents: () => agentsOf(scoped(), true),
    changed: (kind) => {
      limit = PAGE;
      if (kind === 'time') timeChanged();
      else paint(false);
    },
  });
}

/** A pick on the summary filtered the rows: show them on the timeline. */
function scrollToTimeline(): void {
  if (logsTimeline) return;
  openTimeline();
}

/** Apply a filter picked from the summary (`<facet>:<value>`) and show the timeline. */
function pick(spec: string): void {
  const [k, ...rest] = spec.split(':');
  const v = rest.join(':');
  limit = PAGE;
  if (k === 'time') return setTime(v as TimeKey);
  if (k === 'clear') {
    clearFilters(true);
    F.q = '';
    const q = document.getElementById('axQ') as HTMLInputElement | null;
    if (q) q.value = '';
    q?.dispatchEvent(new Event('input'));
    return paint(false);
  }
  if (k === 'cats') setQuickCats([v as Cat]);
  else if (k === 'actions') {
    F.cats.clear();
    F.status.clear();
    F.actions = new Set([v]);
  } else if (k === 'agents') F.agents = new Set([v]);
  else if (k === 'srcs') F.srcs = new Set([v as Source]);
  else if (k === 'status') setQuick(v === 'fail' ? 'fail' : 'all');
  paint(false);
  scrollToTimeline();
}

function setQuickCats(c: Cat[]): void {
  F.cats = new Set(c);
  F.actions.clear();
}

function filterActor(actor: string): void {
  F.agents = new Set([actor]);
  limit = PAGE;
  paint(false);
  scrollToTimeline();
}

function wire(h: HTMLElement, root: HTMLElement): void {
  wireTimeline(root, 'ax', {
    query: (q) => {
      F.q = q;
      limit = PAGE;
      paint(false);
    },
    quick: (id: Quick) => {
      setQuick(id);
      limit = PAGE;
      paint(false);
    },
    filters: openSheet,
    remove: removeFilter,
    clear: () => {
      clearFilters(true);
      F.q = '';
      limit = PAGE;
      paint(false);
    },
    compact: () => {
      compact = !compact;
      paint(false);
    },
    system: () => {
      F.system = true;
      paint(false);
    },
  });

  const plain = (e: MouseEvent): boolean => !(e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0);
  // Summary: bars, problems, agents and notes filter the timeline or open what they name.
  $('#axSm').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    let el: HTMLElement | null;
    if ((el = t.closest<HTMLElement>('a[data-kid]'))) {
      if (!plain(e)) return;
      e.preventDefault();
      openAgentPage(el.dataset.kid!, 'activity');
    } else if ((el = t.closest<HTMLElement>('[data-only]'))) filterActor(el.dataset.only!);
    else if ((el = t.closest<HTMLElement>('[data-prob]'))) {
      F.agents = new Set([el.dataset.prob!]);
      setQuick('fail');
      limit = PAGE;
      paint(false);
      scrollToTimeline();
    } else if ((el = t.closest<HTMLElement>('[data-f]'))) pick(el.dataset.f!);
    else if ((el = t.closest<HTMLElement>('[data-note]'))) hooks.openNote(el.dataset.note!);
    else if (t.closest('[data-allag]')) {
      allAgents = !allAgents;
      paintSummary(true);
    }
  });
  root.querySelectorAll<HTMLElement>('.ax-tab').forEach((t) => {
    t.onclick = (e) => {
      if (!plain(e)) return;
      e.preventDefault();
      if (t.dataset.v === root.dataset.view) return;
      if (t.dataset.v === 'timeline') openTimeline();
      else {
        setLogsTimeline(false);
        hooks.go('logs');
      }
    };
  });
  const lnk = $('#axAgLnk');
  lnk.onclick = (e) => {
    if (!plain(e)) return;
    e.preventDefault();
    setKeysRoute(null);
    hooks.go('keys');
  };

  const body = $('#axBody');
  wireActRows(body, (id) => items.find((x) => x.id === id), filterActor, {
    onBurst: (id) => {
      if (!open.delete(id)) open.add(id);
      paint(true);
    },
    onUndo: (it) => void runUndo(it).then(() => paint(true)),
  });
  body.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
    if (el) pick(el.dataset.pick!);
  });

  $('#lgLive').onclick = () => {
    live = !live;
    if (live) {
      flushPending();
      softReload();
    }
    paintLive();
  };
  // Rarely used: reload (the page is live) and export.
  $('#axMore').onclick = (e) =>
    openMenu(
      e.currentTarget as HTMLElement,
      [
        {
          label: 'Reload',
          desc: 'Fetch the activity again from the server.',
          icon: ICO.refresh,
          run: () => {
            keys = [];
            void reload();
          },
        },
        { sep: true, label: '' },
        { label: 'Export timeline as JSON', desc: 'The actions the timeline shows, for scripts.', icon: ICO.download, run: () => exportRows(scoped().filter((x) => matches(x)), 'json') },
        { label: 'Export timeline as CSV', desc: 'The actions the timeline shows, for a spreadsheet.', icon: ICO.download, run: () => exportRows(scoped().filter((x) => matches(x)), 'csv') },
      ],
      { title: 'Activity' },
    );

  // "/" jumps to the timeline search.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || h.classList.contains('hidden')) return;
    const t = e.target as HTMLElement;
    if (t.closest('input,textarea,select,[contenteditable=true],.cc-drawer,.modal')) return;
    e.preventDefault();
    const q = document.getElementById('axQ') as HTMLInputElement | null;
    q?.focus();
    q?.select();
  });

  onBarScroll = stickTimeline(root, 'ax', h, () => 0);
  h.addEventListener(
    'scroll',
    () => {
      if (h.classList.contains('hidden')) return;
      onBarScroll?.();
      // Back at the top of the timeline with the stream on: what arrived meanwhile flows in.
      if (live && (pending.length || reloadWanted) && flowing()) {
        flushPending();
        paintLive();
      }
    },
    { passive: true },
  );
}

function removeFilter(spec: string): void {
  const [k, ...rest] = spec.split(':');
  const v = rest.join(':');
  limit = PAGE;
  if (k === 'cats') F.cats.delete(v as Cat);
  else if (k === 'actions') F.actions.delete(v);
  else if (k === 'srcs') F.srcs.delete(v as Source);
  else if (k === 'agents') F.agents.delete(v);
  else if (k === 'status') F.status.delete(v as St);
  else if (k === 'system') F.system = false;
  paint(false);
}

/** Whether new rows may appear right away: the stream is on and the reader is not down in the timeline. */
function flowing(): boolean {
  if (!live || document.querySelector('.cc-drawer.in')) return false;
  const body = document.getElementById('axBody');
  if (!body) return true;
  return body.getBoundingClientRect().top >= host().getBoundingClientRect().top + 40;
}

function startLive(h: HTMLElement): void {
  whileVisible(h, () =>
    onLive((it) => {
      // An end only settles a row already on screen: apply it quietly.
      const cid = (it.raw as { call_id?: unknown }).call_id;
      const ends = (it.raw as { phase?: unknown }).phase === 'end' && items.some((x) => x.running && x.raw.call_id === cid);
      if (!ends && !flowing()) {
        pending.push(it);
        if ((it.raw as { phase?: unknown }).phase !== 'end' && matches(it)) pendingShown++;
        paintLive();
        return;
      }
      ingest(it);
    }),
  );
}

function ingest(it: ActivityItem): void {
  fresh.add(it.id);
  pushLive(items, it);
  if (paintQueued) return;
  paintQueued = true;
  // Batched, so a busy agent repaints the page about once a second, not per call.
  setTimeout(() => {
    paintQueued = false;
    paint(true);
  }, 900);
}

function flushPending(): void {
  const p = pending.take();
  pendingShown = 0;
  p.forEach(ingest);
  if (reloadWanted) softReload();
}

function paintLive(): void {
  const b = document.getElementById('lgLive');
  if (!b) return;
  b.setAttribute('aria-pressed', String(live));
  b.innerHTML = live ? '<span class="cc-dot ok"></span>Live' : '<span class="cc-dot idle"></span>Paused';
  b.title = live ? 'Pause: new activity waits until you show it' : 'Resume: show new activity as it happens';
  const nb = $('#axNew') as HTMLButtonElement;
  nb.hidden = !pendingShown;
  nb.textContent = `${pendingShown} new · Show`;
  nb.setAttribute('aria-label', `Show ${plural(pendingShown, 'new action')}`);
  nb.onclick = () => {
    live = true;
    flushPending();
    softReload();
    paintLive();
    scrollToTimeline();
  };
}

const softReload = debounce(() => void reload(true), 900);
/** A background refresh came while new rows were held: it runs when they are shown. */
let reloadWanted = false;

/** Load from the server. `soft` keeps the page on screen and waits while new rows are held, unless `now`. */
async function reload(soft = false, now = false): Promise<void> {
  if (soft && !now && items.length && !flowing()) {
    reloadWanted = true;
    return;
  }
  reloadWanted = false;
  if (!soft) {
    pending.take();
    pendingShown = 0;
    paintLive();
  }
  const seq = ++loadSeq;
  const keep = keepShown && items.length > 0;
  keepShown = false;
  if (!soft && !keep) {
    loading = true;
    paint(false);
  }
  const range = feedRange();
  // Live rows are matched to stored ones through an index: a range can hold 20000 events.
  const before = items;
  const absorb = (fetched: ActivityItem[]): ActivityItem[] => {
    const lives = before.filter((x) => x.live);
    if (!lives.length) return fetched;
    const near = new Map<string, number[]>();
    for (const f of fetched) {
      const k = f.actor + '\u0000' + f.action;
      (near.get(k) || near.set(k, []).get(k)!).push(f.ts);
    }
    const close = (x: ActivityItem, gap: number): boolean => (near.get(x.actor + '\u0000' + x.action) || []).some((t) => Math.abs(t - x.ts) < gap);
    // Keep live items newer than the server snapshot (the log can lag a bit).
    const newest = fetched.length ? fetched[0].ts : 0;
    const keep = lives.filter((x) => x.ts > newest - 15 && !close(x, 15));
    // Stored starts carry no outcome (`end` phases are realtime only): take it from the live copy.
    const byKey = new Map<string, ActivityItem[]>();
    for (const x of lives) {
      if (x.running) continue;
      const k = x.actor + '\u0000' + x.action;
      (byKey.get(k) || byKey.set(k, []).get(k)!).push(x);
    }
    if (byKey.size)
      for (const f of fetched) {
        if (f.ok !== undefined && !f.running) continue;
        const m = byKey.get(f.actor + '\u0000' + f.action)?.find((x) => Math.abs(x.ts - f.ts) < 5);
        if (m) {
          f.running = false;
          f.ok = m.ok;
          f.ms = m.ms;
        }
      }
    return [...keep, ...fetched];
  };
  try {
    // The newest page shows at once; older pages fill the range in behind it.
    const onPage = (sofar: ActivityItem[]): void => {
      if (seq !== loadSeq || soft) return;
      items = absorb(sofar);
      loading = false;
      filling = true;
      older = true;
      loadedRange = range;
      remember(range, false);
      paint(true);
    };
    // A background refresh of the same range only needs the newest page.
    const top = soft && !now && before.length && loadedRange === range;
    const [got, ks] = await Promise.all([loadFeed(range, top ? 2000 : fetchLimit, top ? undefined : onPage), keys.length ? Promise.resolve(keys) : fetchKeys()]);
    if (seq !== loadSeq) return;
    let fetched = got;
    if (top) {
      const edge = got.length ? got[got.length - 1].ts : Infinity;
      fetched = [...got, ...before.filter((x) => !x.live && x.ts < edge)];
    }
    keys = ks;
    setAgentColors(keys);
    if (soft && items.length && !now) {
      const known = new Set(items.map((x) => x.actor + x.action + Math.round(x.ts)));
      fetched.forEach((x) => {
        if (!known.has(x.actor + x.action + Math.round(x.ts))) fresh.add(x.id);
      });
    }
    const logged = fetched.filter((x) => x.source !== 'auth');
    if (!top) older = logged.length >= fetchLimit * 0.9;
    loadedRange = range;
    items = absorb(fetched);
    // A full load covers the range; a background refresh keeps what it was.
    remember(range, soft ? (rangeCache.get(range)?.whole ?? false) : true);
  } catch (e) {
    if (seq !== loadSeq) return;
    toast('Could not load activity: ' + (e as Error).message, 'err');
    // Do not ask again and again from the end of the list.
    if (now) older = false;
  }
  loading = false;
  loadingMore = false;
  if (seq === loadSeq) filling = false;
  paint(soft);
}

/** Every actor (agents, people, the server) with its counts in the range. */
function agentsOf(sc: ActivityItem[], filtered = false): AgentInfo[] {
  return classifyAgents(items, filtered ? sc.filter((x) => matches(x, 'agents')) : sc.filter((x) => !x.echo), keys);
}

function oldestLoaded(): number {
  return items.length ? items[items.length - 1].ts : Date.now() / 1000;
}

function kpisHTML(rows: ActivityItem[], agents: AgentInfo[]): string {
  const now = Date.now() / 1000;
  const mid = new Date();
  mid.setHours(0, 0, 0, 0);
  const midTs = mid.getTime() / 1000;
  const mine = items.filter((x) => !isSystem(x));
  const oldest = oldestLoaded();
  const today = atLeast(mine.filter((x) => x.ts >= midTs).length, midTs, oldest, older);
  const week = atLeast(mine.filter((x) => x.ts >= now - 7 * 86400).length, now - 7 * 86400, oldest, older);
  const ais = new Set(rows.filter((x) => x.source === 'agent').map((x) => x.actor));
  const working = agents.filter((a) => a.cls === 'active').length;
  const fails = rows.filter((x) => stOf(x) === 'fail').length;
  const t = touchedCount(rows);
  // The first number follows the chosen range; today's count goes under it.
  const short = F.time === 'today' || F.time === '1h';
  return `${short ? statTile(timeLabel(), rows.length, `${week} in the last 7 days`) : statTile(timeLabel(), rows.length, `${today} today`)}
    ${statTile('Agents used', ais.size, working ? `${working} active right now` : 'None active right now')}
    ${statTile('Problems', fails, rows.length ? `${Math.round((fails / rows.length) * 100)}% failed or refused` : 'Nothing in this range', fails > 0, fails ? 'status:fail' : '')}
    ${statTile('Notes touched', t.n, t.top ? `Most: ${t.top}` : 'None in this range')}`;
}

function summarySkeleton(): void {
  $('#axKpis').innerHTML = kpiSkeleton().repeat(4);
  $('#axChart').innerHTML = skBlock('100%', 168);
  $('#axChartS').textContent = '';
  $('#axTop').innerHTML = skLines(5);
  $('#axAgs').innerHTML = `<div class="sm-card-b">${skLines(6)}</div>`;
  $('#axAgS').textContent = '';
  $('#axProbs').innerHTML = `<div class="sm-card-b">${skLines(3)}</div>`;
  $('#axPrA').innerHTML = '';
  $('#axNotes').innerHTML = `<div class="sm-card-b">${skLines(4)}</div>`;
}

/** While a range loads: say so plainly, so nobody reads half the numbers as the answer. */
function paintWait(): void {
  const w = document.getElementById('axWait');
  if (!w) return;
  const on = loading || filling;
  w.hidden = !on;
  if (on)
    w.innerHTML = `<i aria-hidden="true"></i>${
      loading
        ? `Gathering the real activity for ${esc(timeLabel().toLowerCase())}. This can take a moment on a big log, please wait.`
        : `Showing the newest first. Still bringing in older activity for ${esc(timeLabel().toLowerCase())}: the numbers fill in as it arrives.`
    }`;
}

function paintSummary(force = false): void {
  paintWait();
  if (!document.getElementById('axKpis')) return;
  const key = [loading, filling, items.length, items[0]?.id, items[0]?.running, F.time, F.from, F.to, allAgents, keys.length, Math.floor(Date.now() / 30000)].join('|');
  if (key === sumKey && !force) return;
  sumKey = key;
  if (loading) return summarySkeleton();
  const sc = scoped();
  // The summary leaves out system lines (server, sign-in, note saves that echo an AI's call).
  const rows = sc.filter((x) => !isSystem(x));
  const agents = agentsOf(sc);
  const w = timeWindow();
  $('#axKpis').innerHTML = kpisHTML(rows, agents);
  $('#axChartH').textContent = rows.length ? chartTitle(rows, w) : 'Actions over time';
  $('#axChartS').innerHTML = rows.length ? `${plural(rows.length, 'action')} · ${timeLabel()}${rows.some((x) => stOf(x) === 'fail') ? ' · <i class="ax-key"></i>problems' : ''}` : timeLabel();
  $('#axChart').innerHTML = timeChart(rows, w);
  $('#axTop').innerHTML = topActionsHTML(rows.filter((x) => x.source === 'agent'));
  if (!rows.some((x) => x.source === 'agent')) $('#axTop').innerHTML = '<div class="ax-bempty">No agent actions in this range</div>';

  // One row per agent: connected keys always, others when they did something in the range.
  const byActor = new Map<string, ActivityItem[]>();
  sc.forEach((x) => {
    if (x.echo) return;
    (byActor.get(x.actor) || byActor.set(x.actor, []).get(x.actor)!).push(x);
  });
  const shown = agents.filter((a) => byActor.has(a.name) || (a.id && a.cls !== 'removed' && a.cls !== 'people'));
  const connected = agents.filter((a) => a.id && a.cls !== 'removed' && a.cls !== 'people');
  const active = connected.filter((a) => a.cls === 'active').length;
  $('#axAgS').textContent = connected.length ? `${connected.length} connected${active ? ` · ${active} active` : ''}` : '';
  const cap = allAgents ? shown.length : AG_CAP;
  $('#axAgs').innerHTML =
    agentRowsHTML(shown, (a) => byActor.get(a.name) || [], w, cap) +
    (shown.length > AG_CAP
      ? `<button type="button" class="sm-more" data-allag aria-expanded="${allAgents}">${allAgents ? 'Show fewer' : `Show all ${shown.length}`}</button>`
      : '');

  const fails = rows.filter((x) => stOf(x) === 'fail').length;
  $('#axPrA').innerHTML = fails ? `<button type="button" class="sm-lnk" data-f="status:fail">Show all ${fails} ${ICO.arrow}</button>` : '';
  $('#axProbs').innerHTML = problemsHTML(rows);
  $('#axNotes').innerHTML = notesHTML(rows);
  const n = rows.length;
  $('#axTabN').textContent = n ? n.toLocaleString('en-US') : '';
}

function chipsOf(): string[] {
  const c: string[] = [];
  // A pill already shows its action types and status; chips only for another mix.
  if (!quickOf()) {
    F.status.forEach((s) => c.push(chip('status:' + s, STATUSES.find((x) => x.id === s)!.label, '', 'Result ')));
    F.cats.forEach((k) => c.push(chip('cats:' + k, CATS.find((x) => x.id === k)!.label, `<i class="sw" style="--c:${CAT_COLOR[k]}"></i>`)));
  }
  F.actions.forEach((a) => c.push(chip('actions:' + a, actionLabel(a), '', '')));
  F.agents.forEach((a) => c.push(chip('agents:' + a, a, avatarHTML(a, 22))));
  F.srcs.forEach((s) => c.push(chip('srcs:' + s, SRCS.find((x) => x.id === s)!.label, '', 'From ')));
  if (F.system) c.push(chip('system:1', 'System lines shown', '', ''));
  return c;
}

function paintSum(rows: ActivityItem[], sc: ActivityItem[]): void {
  const el = $('#axSum');
  if (loading) {
    el.innerHTML = '<span>Loading…</span>';
    return;
  }
  // System lines the other filters would show, were they not hidden.
  const hidden = F.system ? 0 : sc.filter((x) => isSystem(x) && !systemShown(x) && matchesBut(x)).length;
  const actors = new Set(rows.map((x) => x.actor)).size;
  el.innerHTML = sumHTML({
    n: rows.length.toLocaleString('en-US'),
    unit: ['action', 'actions'],
    note: timeLabel(),
    extra: `<span class="ppl"><b>${actors}</b> ${actors === 1 ? 'AI or person' : 'AIs and people'}</span>`,
    fails: rows.filter((x) => stOf(x) === 'fail').length,
    hidden,
    compact,
  });
}

/** Keep the first visible row where it is while the list above it changes. */
function anchor(): () => void {
  const h = host();
  const stick = h.querySelector<HTMLElement>('#axBar')?.offsetHeight || 0;
  const top = h.getBoundingClientRect().top + stick;
  const rows = h.querySelectorAll<HTMLElement>('#axBody [data-act]');
  let el: HTMLElement | null = null;
  for (const r of rows) {
    if (r.getBoundingClientRect().bottom > top + 40) {
      el = r;
      break;
    }
  }
  if (!el || h.scrollTop < 40) return () => {};
  const key = `[data-act="${window.CSS.escape(el.dataset.act!)}"]`;
  const before = el.getBoundingClientRect().top;
  return () => {
    const again = h.querySelector<HTMLElement>(`#axBody ${key}`);
    if (again) h.scrollTop += again.getBoundingClientRect().top - before;
  };
}

function paint(keepPlace = true): void {
  const body = document.getElementById('axBody');
  if (!body) return;
  const root = $('#axRoot');
  paintSummary();
  // The timeline is drawn when it is on screen; on the summary it waits.
  if (root.dataset.view === 'summary') {
    timelineStale = true;
    return;
  }
  timelineStale = false;
  const restore = keepPlace ? anchor() : () => {};
  paintPills(root, 'ax', quickOf());
  paintChips(root, 'ax', chipsOf(), activeCount());
  const sc = scoped();
  const rows = sc.filter((x) => matches(x));
  paintSum(rows, sc);
  refreshFilters();
  if (loading) {
    body.setAttribute('aria-busy', 'true');
    body.innerHTML = daySkeleton();
    restore();
    return;
  }
  body.removeAttribute('aria-busy');
  localLeft = groupBursts(rows, compact).length > limit;
  body.innerHTML = dayViewHTML({
    rows,
    fresh,
    limit,
    compact,
    open,
    older: older && oldestLoaded() > timeWindow().since,
    narrowed: narrowed(),
    none: !sc.length,
  });
  restore();
  fresh.clear();
  watchSentinel(body, host(), more);
}

/** The end of the timeline came near: show more of what is loaded, or load older activity. */
function more(): void {
  if (loadingMore) return;
  if (localLeft) {
    limit += PAGE;
    paint(true);
    return;
  }
  // Everything loaded is on screen: ask the server for older activity.
  if (older) {
    loadingMore = true;
    fetchLimit += FETCH;
    void reload(true, true);
  }
}
