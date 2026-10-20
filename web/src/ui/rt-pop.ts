// The panel behind the header's live pill: agent totals, every agent with its
// latest activity (live), and one agent's recent history on demand.

import { attr, esc, useStyles } from '../dom';
import { relTs, trunc } from '../format';
import { hooks } from '../hooks';
import { agentColor, avatarHTML } from '../control/agents';
import { actRowHTML, useActivityStyles, wireActRows } from '../control/activity';
import { loadFeed, verb, type ActivityItem } from '../control/feed';
import { icon } from './icons';
import { setKeysRoute } from '../router';

export interface PopAgent {
  name: string;
  /** API key id, when known. */
  id?: string;
  active: boolean;
  /** Has an API key (enabled); false for agents only seen in activity. */
  keyed: boolean;
  /** Latest call seen live (ms epoch, 0 = none since this page loaded). */
  lastAt: number;
  /** Latest call the server recorded for its key (ms epoch, 0 = never or unknown). */
  lastUsed?: number;
  lastAction: string;
  lastLabel: string;
}

export interface PopData {
  state: 'on' | 'connecting' | 'off';
  agents: PopAgent[];
  close: () => void;
  retry: () => void;
  rerender: () => void;
}

const CSS = `
.rt-pop{width:min(380px,calc(100vw - 16px)) !important;max-height:calc(100vh - var(--topbar) - 24px);display:flex;flex-direction:column}
.rp2-view{display:flex;flex-direction:column;min-height:0;flex:1}
.rp2-view.in{animation:rp2-in .22s cubic-bezier(.2,.8,.2,1)}
.rp2-view.in.back{animation-name:rp2-back}
@keyframes rp2-in{from{opacity:0;transform:translateX(12px)}}
@keyframes rp2-back{from{opacity:0;transform:translateX(-12px)}}
.rp2-top{display:flex;align-items:center;gap:8px;padding:12px 12px 10px 16px}
.rp2-top h3{margin:0;font-size:14px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp2-top h3 small{display:block;font-size:11.5px;font-weight:500;color:var(--danger);margin-top:2px}
.rp2-btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border-radius:9px;
  font-size:12px;font-weight:650;color:var(--text-2);border:1px solid var(--line);background:var(--surface-2);white-space:nowrap}
.rp2-btn:hover{color:var(--fg);border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.rp2-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rp2-btn .i{width:14px;height:14px}
.rp2-btn.icon{width:30px;padding:0;justify-content:center}
.rp2-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:0 12px 12px}
.rp2-tile{padding:9px 8px 8px;border-radius:12px;background:var(--surface-2);border:1px solid var(--line);text-align:center}
.rp2-tile b{display:block;font-size:19px;font-weight:750;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1}
.rp2-tile span{display:block;margin-top:3px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:650}
.rp2-tile.on b{color:var(--accent)}
.rp2-tile .sm{font-size:13px;line-height:23px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp2-sec{padding:8px 16px 6px;font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);border-top:1px solid var(--line)}
.rp2-list{overflow-y:auto;overscroll-behavior:contain;min-height:0;max-height:min(52vh,420px);padding:0 8px 8px;scrollbar-width:thin;
  display:flex;flex-direction:column;gap:6px}
.rp2-agent{all:unset;box-sizing:border-box;cursor:pointer;width:100%;position:relative;overflow:hidden;display:flex;align-items:center;gap:11px;
  padding:10px 11px 10px 13px;border-radius:13px;border:1px solid color-mix(in srgb,var(--ag) 18%,var(--line));
  background:linear-gradient(120deg,color-mix(in srgb,var(--ag) 11%,transparent),transparent 62%),var(--surface-2);
  transition:transform .18s cubic-bezier(.2,.8,.2,1),border-color .2s,box-shadow .2s}
.rp2-agent::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--ag);opacity:.55}
.rp2-agent:hover,.rp2-agent:focus-visible{transform:translateY(-1px);border-color:color-mix(in srgb,var(--ag) 45%,var(--line));
  box-shadow:0 8px 22px -14px color-mix(in srgb,var(--ag) 70%,transparent)}
.rp2-agent.on{border-color:color-mix(in srgb,var(--ag) 50%,var(--line));box-shadow:0 0 0 1px color-mix(in srgb,var(--ag) 25%,transparent),0 10px 26px -16px var(--ag)}
.rp2-agent.on::before{opacity:1;box-shadow:0 0 10px var(--ag)}
.rp2-agent.on::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(105deg,transparent 35%,color-mix(in srgb,var(--ag) 16%,transparent) 50%,transparent 65%);
  background-size:250% 100%;animation:rp2-sheen 2.8s ease-in-out infinite}
@keyframes rp2-sheen{from{background-position:120% 0}to{background-position:-120% 0}}
.rp2-agent:not(.on) .ag-av{filter:saturate(.75);opacity:.85}
.rp2-chip{flex:none;display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:99px;font-size:10.5px;font-weight:700;
  color:var(--muted);background:color-mix(in srgb,var(--fg) 5%,transparent);border:1px solid var(--line)}
.rp2-chip .i{width:11px;height:11px}
.rp2-chip.on{color:var(--ag);background:color-mix(in srgb,var(--ag) 14%,transparent);border-color:color-mix(in srgb,var(--ag) 40%,transparent)}
.rp2-agent:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.rp2-main{flex:1;min-width:0}
.rp2-l1{display:flex;align-items:center;gap:8px;min-width:0}
.rp2-l1 b{font-size:13px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.rp2-l1 time{margin-left:auto;flex:none;font-size:11px;color:var(--text-3);font-variant-numeric:tabular-nums}
.rp2-l2{display:flex;align-items:center;gap:6px;margin-top:2px;font-size:11.5px;color:var(--muted);min-width:0}
.rp2-l2 span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp2-l2 em{font-style:normal;color:var(--text-2);flex:none}
.rp2-empty{padding:18px 16px;font-size:12.5px;color:var(--muted);text-align:center;line-height:1.5}
.rp2-who{display:flex;align-items:center;gap:12px;padding:0 16px 12px}
.rp2-who b{display:block;font-size:15px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp2-who small{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);margin-top:3px}
.rp2-acts .act{border-radius:10px}
@media (prefers-reduced-motion:reduce){.rp2-view.in,.rp2-agent.on::after{animation:none}}
`;

// Which view is open survives the pill's periodic repaints.
let view: string | null = null;
let shownView: string | null | undefined;
let goingBack = false;
let lastHtml = '';
let feed: ActivityItem[] | null = null;
let feedAt = 0;
let loading = false;

/** "now" only while the agent counts as working, so a row never says "now" next to "Idle". */
export function when(ms: number, active: boolean, now = Date.now()): string {
  if (!ms) return '';
  if (active) return 'now';
  // Coarse on purpose: the panel repaints only when its text changes.
  return now - ms < 60_000 ? '< 1 min ago' : relTs(Math.floor(ms / 1000));
}

/** Forget the open agent: the panel starts on the overview next time. */
export function resetRtPop(): void {
  view = null;
  shownView = undefined;
  lastHtml = '';
}

/** Whether a history item belongs to this agent (by key id when both know it). */
function mine(it: ActivityItem, a: PopAgent): boolean {
  const kid = typeof it.raw.actor_id === 'string' ? it.raw.actor_id : '';
  return a.id && kid ? kid === a.id : it.actor === a.name;
}

/** Latest call per agent: live events win over the loaded history, which wins over the
 *  key's "last used" time (known before the history loads and beyond its window). */
function latest(a: PopAgent): { at: number; action: string; label: string } | null {
  const h = feed?.find((it) => mine(it, a));
  const hAt = h ? h.ts * 1000 : 0;
  if (a.lastAt && a.lastAt >= hAt) return { at: a.lastAt, action: a.lastAction, label: a.lastLabel };
  if (h) return { at: hAt, action: h.action, label: h.label || h.paths[0] || '' };
  return a.lastUsed ? { at: a.lastUsed, action: '', label: '' } : null;
}

export function renderRtPop(pop: HTMLElement, d: PopData): void {
  useStyles('rt-pop2-css', CSS);
  if (!feed || Date.now() - feedAt > 30_000) void refreshFeed(d);
  const agent = view ? d.agents.find((a) => (a.id || a.name) === view) : undefined;
  if (view && !agent) view = null;
  const html = agent ? detail(agent) : overview(d);
  // Repaints arrive every few seconds: touch the DOM only when something
  // visible changed, and slide only when the view itself changes.
  if (html === lastHtml && shownView === view) return;
  const changed = shownView !== view;
  const scroll = changed ? 0 : pop.querySelector('.rp2-list')?.scrollTop || 0;
  pop.innerHTML = html;
  lastHtml = html;
  const v = pop.querySelector('.rp2-view');
  if (changed && shownView !== undefined) v?.classList.add('in');
  if (changed && goingBack) v?.classList.add('back');
  shownView = view;
  goingBack = false;
  const list = pop.querySelector<HTMLElement>('.rp2-list');
  if (list) list.scrollTop = scroll;
  wire(pop, d);
}

function overview(d: PopData): string {
  const active = d.agents.filter((a) => a.active).length;
  const total = d.agents.length;
  const tile = (n: number, label: string, on = false): string =>
    `<div class="rp2-tile${on && n ? ' on' : ''}"><b>${n}</b><span>${label}</span></div>`;
  const rows = d.agents
    .map((a) => {
      const l = latest(a);
      return `<button type="button" class="rp2-agent${a.active ? ' on' : ''}" data-agent="${attr(a.id || a.name)}" style="--ag:${attr(
        agentColor(a.name, a.id),
      )}" title="${attr(a.name)}: recent activity">
      ${avatarHTML(a.name, 34, a.active ? 'live' : '', a.id)}
      <span class="rp2-main">
        <span class="rp2-l1"><b>${esc(a.name)}</b>${l ? `<time>${esc(when(l.at, a.active))}</time>` : ''}</span>
        <span class="rp2-l2">${
          l && l.action
            ? `<em>${esc(verb(l.action))}</em>${l.label && l.label !== l.action ? `<span>${esc(trunc(l.label, 60))}</span>` : ''}`
            : l
              ? `<span>${feed ? 'Last call' : 'Loading activity…'}</span>`
              : `<span>${!feed ? 'Loading activity…' : a.keyed ? 'No activity yet' : 'Key removed'}</span>`
        }</span>
      </span>
      ${a.active ? `<span class="rp2-chip on">${icon('bolt')}Working</span>` : `<span class="rp2-chip">${icon('moon')}Idle</span>`}
    </button>`;
    })
    .join('');
  const offline =
    d.state === 'off' ? '<small>Offline, retrying</small>' : d.state === 'connecting' ? '<small style="color:var(--muted)">Connecting…</small>' : '';
  return `<div class="rp2-view">
    <div class="rp2-top"><h3>Agents${offline}</h3>
      ${d.state === 'off' ? `<button type="button" class="rp2-btn icon" data-rp="retry" title="Reconnect" aria-label="Reconnect">${icon('refresh')}</button>` : ''}
      <button type="button" class="rp2-btn" data-rp="activity">${icon('activity')}All activity</button>
      <button type="button" class="rp2-btn icon" data-rp="keys" title="Agents &amp; API keys" aria-label="Agents and API keys">${icon('key')}</button>
    </div>
    <div class="rp2-tiles">${tile(total, 'Agents')}${tile(active, 'Active', true)}${tile(total - active, 'Idle')}</div>
    <div class="rp2-sec">Latest activity</div>
    <div class="rp2-list">${rows || '<div class="rp2-empty">No agents yet. Create an API key and connect an agent; it shows up here the moment it calls a tool.</div>'}</div>
  </div>`;
}

function detail(a: PopAgent): string {
  useActivityStyles();
  const own = (feed || []).filter((it) => mine(it, a));
  const day = Date.now() / 1000 - 86400;
  const today = own.filter((it) => it.ts >= day);
  const failed = today.filter((it) => it.ok === false).length;
  const items = own.slice(0, 15);
  const l = latest(a);
  return `<div class="rp2-view">
    <div class="rp2-top">
      <button type="button" class="rp2-btn icon" data-rp="back" aria-label="Back to all agents" title="All agents">${icon('chev-left')}</button>
      <h3></h3>
      <button type="button" class="rp2-btn" data-rp="agent-activity" title="This agent's activity">${icon('activity')}Activity</button>
      ${
        a.id
          ? `<button type="button" class="rp2-btn" data-rp="agent-page" title="This agent's page: setup, access and settings">${icon('agents')}Agent page</button>`
          : `<button type="button" class="rp2-btn icon" data-rp="keys" title="Agents &amp; API keys" aria-label="Agents and API keys">${icon('key')}</button>`
      }
    </div>
    <div class="rp2-who">${avatarHTML(a.name, 42, a.active ? 'live' : '', a.id)}<div style="min-width:0;flex:1"><b>${esc(a.name)}</b>
      <small>${a.active ? 'Working now' : l ? 'Idle · last call ' + esc(when(l.at, false)) : feed ? 'Idle · no calls yet' : 'Idle'}</small></div></div>
    <div class="rp2-tiles">
      <div class="rp2-tile"><b>${feed ? today.length : '…'}</b><span>Calls 24h</span></div>
      <div class="rp2-tile"><b>${feed ? failed : '…'}</b><span>Failed</span></div>
      <div class="rp2-tile"><b class="sm">${esc(l && l.action ? verb(l.action) : '-')}</b><span>Last action</span></div>
    </div>
    <div class="rp2-sec">Recent activity</div>
    <div class="rp2-list rp2-acts">${
      !feed
        ? '<div class="rp2-empty">Loading activity…</div>'
        : items.length
          ? items.map((it) => actRowHTML(it)).join('')
          : '<div class="rp2-empty">No activity from this agent in the last day.</div>'
    }</div>
  </div>`;
}

async function refreshFeed(d: PopData): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    feed = await loadFeed('1d', 500);
    feedAt = Date.now();
  } catch {
    feed = feed || [];
    feedAt = Date.now();
  } finally {
    loading = false;
  }
  d.rerender();
}

function wire(pop: HTMLElement, d: PopData): void {
  pop.querySelectorAll<HTMLElement>('[data-agent]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      view = b.dataset.agent!;
      // The history may be stale by now; the detail shows a fresh copy.
      if (Date.now() - feedAt > 10_000) feedAt = 0;
      d.rerender();
    };
  });
  const acts = pop.querySelector<HTMLElement>('.rp2-acts');
  if (acts && feed) wireActRows(acts, (id) => feed!.find((it) => it.id === id));
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
      if (what === 'retry') {
        d.retry();
        return;
      }
      const cur = d.agents.find((a) => (a.id || a.name) === view);
      const name = cur?.name;
      d.close();
      if (what === 'activity') hooks.go('logs');
      else if (what === 'agent-activity' && name) {
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
