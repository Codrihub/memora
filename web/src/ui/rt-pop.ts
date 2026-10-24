import { attr, esc, useStyles } from '../dom';
import { relTs } from '../format';
import { hooks } from '../hooks';
import { agentColor, avatarHTML } from '../control/agents';
import { myName, useActivityStyles, wireActRows } from '../control/activity';
import { loadFeed, onLive, settleRunning, type ActivityItem } from '../control/feed';
import { isSystem, plainText, predicate, problemOf, whoOf } from '../control/sentence';
import { icon } from './icons';
import { setKeysRoute } from '../router';
import { fadeScroll } from './scroll-fade';

export interface PopAgent {
  name: string;
  id?: string;
  active: boolean;
  /** False for agents only seen in activity. */
  keyed: boolean;
  /** Ms epoch; 0 = none since page load. */
  lastAt: number;
  /** Server-recorded, ms epoch; 0 = never or unknown. */
  lastUsed?: number;
  lastAction: string;
  lastLabel: string;
  lastPaths?: string[];
  lastOk?: boolean;
  lastRefused?: boolean;
  lastError?: string;
}

interface PopData {
  state: 'on' | 'connecting' | 'off';
  agents: PopAgent[];
  close: () => void;
  retry: () => void;
  rerender: () => void;
}

const LATEST_N = 5;
const AGENT_N = 15;

const STYLES = `
.rt-pop{width:min(380px,calc(100vw - 16px)) !important;max-height:calc(100vh - var(--topbar) - 24px);display:flex;flex-direction:column;
  --rp-live:#5eead4;--rp-slate:linear-gradient(180deg,#1b2433,#0d121b)}
:root[data-theme=light] .rt-pop{--rp-live:#0d9488}
.rt-pop:focus{outline:none}
.rt-pop .ag-av{border-radius:30%}
.rt-pop .ag-av.live::after{border-radius:34%}
.rp2-view{display:flex;flex-direction:column;min-height:0;flex:1}
.rp2-view.in{animation:rp2-in .22s cubic-bezier(.2,.8,.2,1)}
.rp2-view.in.back{animation-name:rp2-back}
@keyframes rp2-in{from{opacity:0;transform:translateX(12px)}}
@keyframes rp2-back{from{opacity:0;transform:translateX(-12px)}}
.rp2-grab{display:none}
.rp3-ib{all:unset;box-sizing:border-box;cursor:pointer;flex:none;display:inline-grid;place-items:center;width:32px;height:32px;border-radius:8px;color:var(--muted)}
.rp3-ib:hover{background:var(--hover);color:var(--fg)}
.rp3-ib .i{width:17px;height:17px}
.rp3-ib.x{display:none}
.rt-pop :is(.rp3-ib,.rp3-ln,.rp3-ag,.rp3-more,.rp3-fb):focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.rp3-h{flex:none;display:flex;align-items:center;gap:10px;padding:14px 10px 10px 16px;min-height:0}
.rp3-h.ag{padding-left:8px}
.rp3-ht{flex:1;min-width:0}
.rp3-ht h3{margin:0;font-size:15px;font-weight:600;letter-spacing:-.01em;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp3-st{display:flex;align-items:center;gap:6px;margin-top:2px;font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp3-st b{font-weight:600;color:var(--fg)}
.rp3-st.off{color:var(--danger)}
.rp3-dot{flex:none;position:relative;width:7px;height:7px;border-radius:50%;background:var(--rp-live)}
.rp3-dot::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--rp-live);animation:rp3-pulse 1.8s ease-out infinite}
@keyframes rp3-pulse{from{opacity:.55;transform:scale(1)}to{opacity:0;transform:scale(2.6)}}
.rp2-list{flex:1;overflow-y:auto;overscroll-behavior:contain;min-height:0;padding:0 6px 8px}
.rp3-sec{display:flex;align-items:baseline;gap:6px;padding:10px 10px 4px;font-size:12px;font-weight:500;color:var(--muted)}
.rp3-sec:first-child{padding-top:2px}
.rp3-sec span{font-variant-numeric:tabular-nums;color:var(--text-3)}
.rp3-sep{height:1px;margin:8px 10px 2px;background:var(--line)}
.rp3-ln{position:relative;display:flex;align-items:center;gap:10px;min-height:36px;padding:6px 10px;border-radius:8px;cursor:pointer;text-align:left}
.rp3-ln:hover{background:var(--hover)}
.rp3-ln.now{background:color-mix(in srgb,var(--rp-live) 8%,transparent)}
.rp3-ln.now:hover{background:color-mix(in srgb,var(--rp-live) 13%,transparent)}
.rp3-tx{flex:1;min-width:0;font-size:13px;line-height:1.4;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp3-tx b{font-weight:600;color:var(--fg)}
.rp3-tx em{font-style:normal;font-weight:500;color:var(--fg)}
.rp3-ln.bad .rp3-tx{color:var(--danger)}
.rp3-ln.bad .rp3-tx em{color:inherit}
.rp3-t{flex:none;display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.rp3-n{flex:none;font-size:11.5px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}
.rp3-ln.now .rp3-t{color:var(--rp-live);font-weight:600}
.rp3-ln.solo{gap:12px}
.rp3-k{flex:none;width:6px;height:6px;margin:0 3px 0 4px;border-radius:50%;background:color-mix(in srgb,var(--ag) 75%,transparent)}
.rp3-ln.bad .rp3-k{background:var(--danger)}
.rp3-ln.now .rp3-k{background:var(--rp-live);box-shadow:0 0 0 3px color-mix(in srgb,var(--rp-live) 22%,transparent)}
.rp3-ln.solo .rp3-tx::first-letter{text-transform:uppercase}
.rp3-empty{padding:8px 10px 6px;font-size:13px;line-height:1.5;color:var(--muted)}
.rp3-ag{all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;align-items:center;gap:10px;min-height:40px;padding:6px 10px;border-radius:8px}
.rp3-ag:hover{background:var(--hover)}
.rp3-ag .n{flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;font-size:13.5px;font-weight:500;color:var(--fg)}
.rp3-ag .n span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp3-ag .n small{flex:none;font-size:12px;font-weight:400;color:var(--muted)}
.rp3-ag .t{flex:none;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.rp3-ag.dim .ag-av{opacity:.55;filter:saturate(.6)}
.rp3-ag.dim .n{color:var(--text-2)}
.rp3-chip{flex:none;display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:6px;background:var(--rp-slate);
  border:1px solid rgba(94,234,212,.28);color:#5eead4;font-size:11.5px;font-weight:600;--rp-live:#5eead4}
.rp3-more{all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;align-items:center;gap:8px;min-height:36px;padding:6px 10px;
  border-radius:8px;font-size:13px;color:var(--muted)}
.rp3-more:hover{background:var(--hover);color:var(--fg)}
.rp3-more .i{width:15px;height:15px;transition:transform var(--dur-1)}
.rp3-more[aria-expanded=true] .i{transform:rotate(180deg)}
.rp3-more b{font-weight:500;font-variant-numeric:tabular-nums}
.rp3-figs{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:0 16px 4px;padding:10px 0;border-top:1px solid var(--line);
  border-bottom:1px solid var(--line);font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.rp3-figs b{font-weight:600;color:var(--fg)}
.rp3-figs b.bad{color:var(--danger)}
.rp3-figs i{font-style:normal;color:var(--text-3)}
.rp3-f{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-top:1px solid var(--line);
  background:color-mix(in srgb,var(--fg) 2.5%,transparent)}
.rp3-fb{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 10px;border-radius:8px;
  font-size:13px;font-weight:500;color:var(--text-2);white-space:nowrap}
.rp3-fb:hover{background:var(--hover);color:var(--fg)}
.rp3-fb .i{width:15px;height:15px;color:var(--muted)}
.rp3-fb.go{color:var(--fg);font-weight:600}
.rp3-fb.go .i{color:var(--fg)}
@media (max-width:760px){
  .rt-pop{top:auto !important;left:0 !important;right:0 !important;bottom:0;width:100% !important;max-height:88dvh;
    border-radius:var(--r) var(--r) 0 0;border-bottom:0;animation:ds-sheet var(--dur-3) var(--ease-out)}
  .rt-pop:not(.hidden)+.rt-scrim{display:block;position:fixed;inset:0;z-index:69;background:var(--scrim);
    -webkit-backdrop-filter:var(--scrim-filter);backdrop-filter:var(--scrim-filter);animation:ds-fade var(--dur-2) var(--ease)}
  .rp2-grab{display:block;flex:none;width:36px;height:4px;margin:8px auto 0;border-radius:99px;background:var(--line-strong)}
  .rp3-h{padding-top:8px}
  .rp3-ib{width:44px;height:44px;border-radius:10px}
  .rp3-ib.x{display:inline-grid}
  .rp3-ln,.rp3-ag,.rp3-more{min-height:44px}
  .rp3-tx{font-size:13.5px}
  .rp3-f{padding:8px 12px calc(8px + var(--safe-b))}
  .rp3-fb{height:44px;font-size:14px}
}
@media (prefers-reduced-motion:reduce){.rp2-view.in,.rt-pop,.rp3-more .i{animation:none;transition:none}.rp3-dot::after{animation:none;display:none}}
`;

let view: string | null = null;
let shownView: string | null | undefined;
let goingBack = false;
let lastHtml = '';
let feed: ActivityItem[] | null = null;
let feedAt = 0;
/** Live calls after this history load start are not in it yet. */
let feedFrom = 0;
let loading = false;
/** Newest first, a short ring. */
let live: ActivityItem[] = [];
let liveOff: (() => void) | null = null;
let showIdleKeys = false;
let backTo = '';

function when(ms: number, active: boolean, now = Date.now()): string {
  if (!ms) return '';
  if (active) return 'now';
  // Coarse on purpose: the panel repaints only when its text changes.
  return now - ms < 60_000 ? 'just now' : relTs(Math.floor(ms / 1000));
}

function short(ms: number, running = false, now = Date.now()): string {
  if (running) return 'now';
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  return Math.floor(s / 86400) + ' d';
}

export function resetRtPop(): void {
  view = null;
  shownView = undefined;
  lastHtml = '';
  showIdleKeys = false;
  backTo = '';
}

const cid = (it: ActivityItem): string => (typeof it.raw.call_id === 'string' ? it.raw.call_id : '');

function isAgentCall(it: ActivityItem): boolean {
  return it.source === 'agent' && !it.echo && !isSystem(it) && whoOf(it, myName()) !== 'You';
}

function listen(): void {
  if (liveOff) return;
  liveOff = onLive((it) => {
    if (!isAgentCall(it)) return;
    if (it.raw.phase === 'end') {
      // An end only closes its start; it is never a line of its own.
      const id = cid(it);
      const start = [...live, ...(feed || [])].find(
        (x) => x.running && (id ? cid(x) === id : x.actor === it.actor && x.action === it.action),
      );
      if (start) {
        start.running = false;
        start.ok = it.ok ?? true;
        if (it.ms != null) start.ms = it.ms;
        if (it.paths.length) start.paths = [...new Set([...start.paths, ...it.paths])];
      }
      return;
    }
    live.unshift(it);
    if (live.length > 60) live.length = 60;
  });
}

function calls(): ActivityItem[] {
  const hist = (feed || []).filter(isAgentCall);
  const have = new Set(hist.map(cid).filter(Boolean));
  const fresh = live.filter((it) => (!feed || it.ts * 1000 >= feedFrom - 2000) && !(cid(it) && have.has(cid(it))));
  return [...fresh, ...hist].sort((a, b) => b.ts - a.ts);
}

function mine(it: ActivityItem, a: PopAgent): boolean {
  const kid = typeof it.raw.actor_id === 'string' ? it.raw.actor_id : '';
  return a.id && kid ? kid === a.id : it.actor === a.name;
}

function lastAt(a: PopAgent, all: ActivityItem[]): number {
  const h = all.find((it) => mine(it, a));
  return Math.max(a.lastAt || 0, h ? h.ts * 1000 : 0, a.lastUsed || 0);
}

function flat(it: ActivityItem): string {
  return predicate(it).replace(/<button\b[^>]*class="act-n"[^>]*>([\s\S]*?)<\/button>/g, '<em>$1</em>');
}

/** Repeats (same AI and sentence, minutes apart) fold into one line with a count. */
function runs(items: ActivityItem[], max: number): { it: ActivityItem; n: number }[] {
  const out: { it: ActivityItem; n: number; last: ActivityItem }[] = [];
  const open = new Map<string, { it: ActivityItem; n: number; last: ActivityItem }>();
  for (const it of items) {
    const key = (typeof it.raw.actor_id === 'string' ? it.raw.actor_id : it.actor) + '\u0000' + predicate(it) + (problemOf(it) || '');
    const g = open.get(key);
    if (g && g.last.ts - it.ts < 600) {
      g.n++;
      g.last = it;
      continue;
    }
    if (out.length === max) continue;
    const ng = { it, n: 1, last: it };
    out.push(ng);
    open.set(key, ng);
  }
  return out.map(({ it, n }) => ({ it, n }));
}

function line(it: ActivityItem, solo = false, n = 1, hot = false): string {
  const kid = typeof it.raw.actor_id === 'string' ? it.raw.actor_id : null;
  const now = settleRunning(it) || hot;
  const bad = !now && !!problemOf(it);
  const when = short(it.ts * 1000, now);
  const text = `${solo ? '' : it.actor + ' '}${plainText(predicate(it))}${n > 1 ? `, ${n} times` : ''}`;
  return `<div class="rp3-ln${solo ? ' solo' : ''}${now ? ' now' : ''}${bad ? ' bad' : ''}" role="button" tabindex="0" data-nav data-act="${attr(
    it.id,
  )}" style="--ag:${attr(agentColor(it.actor, kid))}" aria-label="${attr(`${text}, ${now ? 'working now' : when}`)}">
    ${solo ? '<i class="rp3-k" aria-hidden="true"></i>' : avatarHTML(it.actor, 22, now ? 'live' : '', kid)}
    <span class="rp3-tx">${solo ? '' : `<b>${esc(it.actor)}</b> `}${flat(it)}</span>
    ${n > 1 ? `<span class="rp3-n" aria-hidden="true">×${n}</span>` : ''}<span class="rp3-t">${esc(when)}</span></div>`;
}

export function renderRtPop(pop: HTMLElement, d: PopData): void {
  useStyles('rt-pop2-css', STYLES);
  useActivityStyles();
  listen();
  if (!feed || Date.now() - feedAt > 30_000) void refreshFeed(d);
  const agent = view ? d.agents.find((a) => (a.id || a.name) === view) : undefined;
  if (view && !agent) view = null;
  const all = calls();
  const html = agent ? detail(agent, all) : overview(d, all);
  // Repaints arrive every second; skip unchanged output.
  if (html === lastHtml && shownView === view) return;
  const opening = shownView === undefined;
  const changed = shownView !== view;
  const scroll = changed ? 0 : pop.querySelector('.rp2-list')?.scrollTop || 0;
  const had = pop.contains(document.activeElement) ? keyOf(document.activeElement as HTMLElement) : '';
  pop.innerHTML = html;
  lastHtml = html;
  const v = pop.querySelector('.rp2-view');
  if (changed && !opening) v?.classList.add('in');
  if (changed && goingBack) v?.classList.add('back');
  shownView = view;
  const list = pop.querySelector<HTMLElement>('.rp2-list');
  if (list) list.scrollTop = scroll;
  fadeScroll(list);
  wire(pop, d, all);
  if (!pop.hasAttribute('tabindex')) pop.tabIndex = -1;
  if (opening) {
    requestAnimationFrame(() => {
      if (!pop.classList.contains('hidden')) pop.focus({ preventScroll: true });
    });
  } else if (changed && (had || pop === document.activeElement)) {
    const to = goingBack && backTo ? pop.querySelector<HTMLElement>(`[data-agent="${CSS.escape(backTo)}"]`) : pop.querySelector<HTMLElement>('[data-rp="back"]');
    (to || pop).focus({ preventScroll: true });
  } else if (had) {
    pop.querySelector<HTMLElement>(had)?.focus({ preventScroll: true });
  }
  goingBack = false;
}

function keyOf(el: HTMLElement): string {
  for (const k of ['act', 'agent', 'rp']) {
    const v = el.dataset[k];
    if (v != null) return `[data-${k}="${CSS.escape(v)}"]`;
  }
  return '';
}

function statusLine(d: PopData, seen: number, working: number, last: number): string {
  const idle = seen - working;
  if (d.state === 'off') return '<div class="rp3-st off">Offline, retrying</div>';
  if (d.state === 'connecting') return '<div class="rp3-st">Connecting…</div>';
  if (!seen) return '<div class="rp3-st">No AI has connected yet</div>';
  if (working)
    return `<div class="rp3-st"><i class="rp3-dot" aria-hidden="true"></i><span><b>${working}</b> working${idle ? ` · ${idle} idle` : ''}</span></div>`;
  return `<div class="rp3-st"><span>All idle${last ? ` · last active ${esc(when(last, false))}` : ''}</span></div>`;
}

function overview(d: PopData, all: ActivityItem[]): string {
  const rows = d.agents.map((a) => ({ a, at: lastAt(a, all) }));
  const seen = rows.filter((r) => r.a.active || r.at || !r.a.keyed);
  const never = rows.filter((r) => !seen.includes(r));
  seen.sort((x, y) => Number(y.a.active) - Number(x.a.active) || y.at - x.at || x.a.name.localeCompare(y.a.name));
  const working = seen.filter((r) => r.a.active).length;
  const open = showIdleKeys || !seen.length;
  const last = seen.reduce((m, r) => Math.max(m, r.at), 0);
  const agentRow = ({ a, at }: { a: PopAgent; at: number }, dim = false): string => {
    const key = a.id || a.name;
    const right = a.active
      ? '<span class="rp3-chip"><i class="rp3-dot" aria-hidden="true"></i>Working</span>'
      : at
        ? `<span class="t">${esc(short(at))}</span>`
        : '';
    const state = a.active ? 'working now' : at ? 'last active ' + when(at, false) : dim ? 'not connected yet' : 'idle';
    return `<button type="button" class="rp3-ag${dim ? ' dim' : ''}" data-nav data-agent="${attr(key)}" style="--ag:${attr(
      agentColor(a.name, a.id),
    )}" aria-label="${attr(`${a.name}, ${state}${a.keyed ? '' : ', key removed'}`)}" title="${attr(`${a.name}: what it did recently`)}">
      ${avatarHTML(a.name, 26, a.active ? 'live' : '', a.id)}
      <span class="n"><span>${esc(a.name)}</span>${a.keyed ? '' : '<small>key removed</small>'}</span>${right}</button>`;
  };
  const latest = runs(all, LATEST_N);
  const busy = d.agents.filter((a) => a.active);
  const lit = new Set<PopAgent>();
  const hot = (it: ActivityItem): boolean => {
    const a = busy.find((x) => !lit.has(x) && mine(it, x));
    if (a) lit.add(a);
    return !!a;
  };
  const feedHTML = latest.length
    ? latest.map((r) => line(r.it, false, r.n, hot(r.it))).join('')
    : `<div class="rp3-empty">${feed ? 'No AI activity in the last 24 hours.' : 'Loading activity…'}</div>`;
  const agentsHTML = d.agents.length
    ? `<div class="rp3-sep" aria-hidden="true"></div>
      <div class="rp3-sec">${seen.length ? 'Agents' : 'Not connected yet'} <span>${d.agents.length}</span></div>
      ${seen.map((r) => agentRow(r)).join('')}
      ${
        never.length
          ? `${
              seen.length
                ? `<button type="button" class="rp3-more" data-nav data-rp="never" aria-expanded="${open}">${icon('chev-down')}<span>Not connected yet <b>(${never.length})</b></span></button>`
                : ''
            }${open ? never.map((r) => agentRow(r, true)).join('') : ''}`
          : ''
      }`
    : `<div class="rp3-sep" aria-hidden="true"></div><div class="rp3-empty">No AIs yet. Connect one, and it shows up here the moment it does something.</div>`;
  return `<div class="rp2-view"><i class="rp2-grab" aria-hidden="true"></i>
    <div class="rp3-h"><div class="rp3-ht"><h3>Your AIs</h3>${statusLine(d, seen.length, working, last)}</div>
      ${d.state === 'off' ? `<button type="button" class="rp3-ib" data-rp="retry" title="Reconnect" aria-label="Reconnect">${icon('refresh')}</button>` : ''}
      <button type="button" class="rp3-ib x" data-rp="close" title="Close" aria-label="Close">${icon('close')}</button>
    </div>
    <div class="rp2-list">
      <div class="rp3-sec">Latest</div>
      <div class="rp3-feed">${feedHTML}</div>
      ${agentsHTML}
    </div>
    <div class="rp3-f">
      <button type="button" class="rp3-fb" data-rp="keys">${icon('key')}Manage agents</button>
      <button type="button" class="rp3-fb go" data-rp="activity">All activity${icon('arrow')}</button>
    </div>
  </div>`;
}

function detail(a: PopAgent, all: ActivityItem[]): string {
  const own = all.filter((it) => mine(it, a));
  const day = Date.now() / 1000 - 86400;
  const today = own.filter((it) => it.ts >= day);
  const failed = today.filter((it) => !settleRunning(it) && !!problemOf(it)).length;
  const at = lastAt(a, all);
  const status = a.active
    ? '<div class="rp3-st"><i class="rp3-dot" aria-hidden="true"></i><span>Working now</span></div>'
    : `<div class="rp3-st"><span>${
        at ? 'Last active ' + esc(when(at, false)) : !a.keyed ? 'Key removed' : feed ? 'Not connected yet' : 'Loading…'
      }</span></div>`;
  const n = (v: number, one: string, many: string, bad = false): string =>
    `<span><b${bad && v ? ' class="bad"' : ''}>${feed ? v : '…'}</b> ${v === 1 ? one : many}</span>`;
  const figs = `<div class="rp3-figs">${n(today.length, 'action in 24h', 'actions in 24h')}<i aria-hidden="true">·</i>${n(
    failed,
    'problem',
    'problems',
    true,
  )}${at ? `<i aria-hidden="true">·</i><span>last action <b>${esc(when(at, false))}</b></span>` : ''}</div>`;
  const items = runs(own, AGENT_N);
  const never = !!feed && !at && !items.length && a.keyed;
  return `<div class="rp2-view"><i class="rp2-grab" aria-hidden="true"></i>
    <div class="rp3-h ag">
      <button type="button" class="rp3-ib" data-rp="back" aria-label="Back to all agents" title="All agents">${icon('chev-left')}</button>
      ${avatarHTML(a.name, 30, a.active ? 'live' : '', a.id)}
      <div class="rp3-ht"><h3>${esc(a.name)}</h3>${status}</div>
      <button type="button" class="rp3-ib x" data-rp="close" title="Close" aria-label="Close">${icon('close')}</button>
    </div>
    ${never ? '' : figs}
    <div class="rp2-list">
      ${never ? '' : '<div class="rp3-sec">Recent</div>'}
      <div class="rp3-feed">${
        !feed && !items.length
          ? '<div class="rp3-empty">Loading activity…</div>'
          : items.length
            ? items.map((r, i) => line(r.it, true, r.n, a.active && i === 0)).join('')
            : never
              ? `<div class="rp3-empty">Its page shows how to connect it.</div>`
              : `<div class="rp3-empty">Nothing from ${esc(a.name)} in the last 24 hours.</div>`
      }</div>
    </div>
    <div class="rp3-f">
      ${
        a.id
          ? `<button type="button" class="rp3-fb" data-rp="agent-page" title="Setup, what it may do and settings">${icon('agents')}Its page</button>`
          : `<button type="button" class="rp3-fb" data-rp="keys">${icon('key')}Manage agents</button>`
      }
      <button type="button" class="rp3-fb go" data-rp="agent-activity" title="Everything it did">Open activity${icon('arrow')}</button>
    </div>
  </div>`;
}

async function refreshFeed(d: PopData): Promise<void> {
  if (loading) return;
  loading = true;
  const from = Date.now();
  try {
    feed = await loadFeed('1d', 500);
    feedFrom = from;
    feedAt = Date.now();
  } catch {
    feed = feed || [];
    feedAt = Date.now();
  } finally {
    loading = false;
  }
  live = live.filter((it) => it.ts * 1000 >= feedFrom - 2000);
  d.rerender();
}

function wire(pop: HTMLElement, d: PopData, all: ActivityItem[]): void {
  pop.querySelectorAll<HTMLElement>('[data-agent]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      view = b.dataset.agent!;
      backTo = view;
      if (Date.now() - feedAt > 10_000) feedAt = 0;
      d.rerender();
    };
  });
  pop.querySelectorAll<HTMLElement>('.rp3-feed').forEach((f) => {
    wireActRows(f, (id) => {
      const it = all.find((x) => x.id === id);
      if (it) requestAnimationFrame(() => d.close());
      return it;
    });
  });
  pop.onkeydown = (e) => keys(e, pop, d);
  pop.querySelectorAll<HTMLElement>('[data-rp]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const what = b.dataset.rp;
      if (what === 'back') {
        view = null;
        goingBack = true;
        d.rerender();
        return;
      }
      if (what === 'never') {
        showIdleKeys = b.getAttribute('aria-expanded') !== 'true';
        d.rerender();
        return;
      }
      if (what === 'retry') {
        d.retry();
        return;
      }
      if (what === 'close') {
        d.close();
        return;
      }
      const cur = d.agents.find((a) => (a.id || a.name) === view);
      const name = cur?.name;
      d.close();
      if (what === 'activity') hooks.go('logs');
      else if (what === 'agent-activity' && cur?.id) {
        setKeysRoute('/agents/' + encodeURIComponent(cur.id) + '/activity');
        hooks.go('keys');
      } else if (what === 'agent-activity' && name) {
        try {
          sessionStorage.setItem('memora.activity.agent', name);
        } catch {
          /* optional */
        }
        hooks.go('logs');
      } else if (what === 'agent-page' && cur?.id) {
        setKeysRoute('/agents/' + encodeURIComponent(cur.id));
        hooks.go('keys');
      } else if (what === 'keys') hooks.go('keys');
    };
  });
}

function keys(e: KeyboardEvent, pop: HTMLElement, d: PopData): void {
  const focusables = [...pop.querySelectorAll<HTMLElement>('button,[tabindex="0"]')].filter((el) => el.offsetParent !== null);
  const cur = document.activeElement as HTMLElement | null;
  if (e.key === 'Tab') {
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && (cur === first || cur === pop)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && cur === last) {
      e.preventDefault();
      first.focus();
    }
    return;
  }
  if (e.key === 'ArrowLeft' && view) {
    e.preventDefault();
    view = null;
    goingBack = true;
    d.rerender();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const rows = [...pop.querySelectorAll<HTMLElement>('[data-nav]')];
  if (!rows.length) return;
  e.preventDefault();
  const i = cur ? rows.indexOf(cur) : -1;
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? rows.length - 1
        : e.key === 'ArrowDown'
          ? Math.min(rows.length - 1, i + 1)
          : i < 0
            ? rows.length - 1
            : Math.max(0, i - 1);
  rows[next].focus();
  rows[next].scrollIntoView({ block: 'nearest' });
}
