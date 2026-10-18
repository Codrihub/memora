// Agents & API keys. An agent is one API key used by one app. The list
// answers what is connected, whether it is working and what it may do: a
// compact summary, then one row per agent (its app, status, access, calls and
// last call). A row opens the agent's own page at /agents/<id>; a new agent
// is made on /agents/new. This module routes between the three and draws the
// list; the data and the actions live in views/agents-data.ts.

import { $, $$, esc, attr, useStyles } from '../dom';
import { setKeysRoute } from '../router';
import { state } from '../state';
import { agentColor, avatarHTML } from '../control/agents';
import { onAgents } from '../realtime';
import { skBlock } from '../ui/skeleton';
import { appById, appIconHTML, mcpUrl } from '../control/connect';
import { summarize } from '../control/perms';
import { ICO, openMenu, sparkSVG, systemHeader, useControlStyles, whileVisible, wireCopy } from '../control/ui';
import { useFormStyles } from '../ui/forms';
import {
  agentsHref,
  appFor,
  bumpSeen,
  data,
  delKey,
  ICO_ACTIVITY,
  ICO_CHEV,
  ICO_POWER,
  ICO_RESTORE,
  ICO_TRASH,
  loadAgents,
  nameOf,
  navAgents,
  onAgentsData,
  permsOf,
  restoreKey,
  SHEET_CSS,
  statusOf,
  toggleKey,
  usageOf,
  wireAgentLinks,
  type KeyRowFull,
} from './agents-data';
import { renderAgentPage } from './agent-page';
import { renderNewAgent } from './agent-new';

const KEYS_CSS = `
.ky{container:ky/inline-size}
.ky a.btn{text-decoration:none}

/* summary strip */
.ky-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) minmax(0,1.9fr);margin:0 0 24px;background:var(--panel);
  border:1px solid var(--line);border-radius:var(--r-lg);min-width:0}
.ky-st{display:flex;flex-direction:column;justify-content:center;gap:3px;padding:14px 18px;min-width:0;border-left:1px solid var(--line)}
.ky-st:first-child{border-left:0}
.ky-st .k{font-size:12px;font-weight:600;color:var(--muted);white-space:nowrap}
.ky-st .v{display:flex;align-items:center;gap:9px;font-size:22px;font-weight:700;letter-spacing:-.02em;line-height:1.2;font-variant-numeric:tabular-nums}
.ky-st .v small{font-size:12.5px;font-weight:500;letter-spacing:0;color:var(--muted)}
.ky-st .sp{width:72px;height:22px;flex:none}
.ky-st .sp .cc-spark{height:22px}
.ky-ep .row{display:flex;align-items:center;gap:6px;min-width:0}
.ky-ep code{flex:1;min-width:0;font:500 12.5px/1.3 var(--mono);color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ky-ep .cc-ibtn{width:30px;height:30px;margin:-4px -6px -4px 0}
#kReload.spin svg{animation:kySpin .8s linear infinite}
@keyframes kySpin{to{transform:rotate(360deg)}}
.ky-live{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 22%,transparent)}

/* section heading */
.ky-h{display:flex;align-items:baseline;gap:10px;margin:0 0 10px;min-width:0}
.ky-h h2{margin:0;font-size:15px;font-weight:680}
.ky-h span{font-size:12.5px;color:var(--muted)}

/* agents list */
.kl{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;min-width:0}
.kl ul{list-style:none;margin:0;padding:0}
.kl-head,.kr{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(0,1.2fr) minmax(0,.9fr) minmax(0,1.35fr) minmax(0,.95fr) minmax(0,.8fr) 36px;
  align-items:center;gap:16px;padding:0 12px 0 18px}
.kl-head{height:40px;font-size:12px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--line);
  background:color-mix(in srgb,var(--surface-2) 55%,transparent)}
.kr{position:relative;min-height:66px;border-top:1px solid var(--line);transition:background .12s}
.kr:first-child{border-top:0}
.kr:hover{background:var(--hover)}
.kr-hit{position:absolute;inset:0;z-index:0;display:block;width:100%;border-radius:0;cursor:pointer}
.kr-hit:focus-visible{border-radius:0;box-shadow:inset 0 0 0 2px var(--accent)}
.kr>:not(.kr-hit){position:relative;min-width:0;pointer-events:none}
.kr>.kr-act{pointer-events:auto;z-index:1}
.kr-agent{display:flex;align-items:center;gap:12px}
.kr-agent .t{display:flex;flex-direction:column;min-width:0}
.kr-agent b{font-size:14px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kr-agent .kid{font:500 11.5px/1.3 var(--mono);color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
.kr-agent .sub2{display:none;font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
.kr-app{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--text-2)}
.kr-app span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kr-app .none{color:var(--text-3)}
.kr-st{display:flex;align-items:center;gap:9px;font-size:13px}
.kr-st .t{display:flex;flex-direction:column;min-width:0}
.kr-st b{font-weight:600;white-space:nowrap}
.kr-st small{display:none;font-size:12px;color:var(--muted);white-space:nowrap}
.kr-perm{display:flex;flex-direction:column;font-size:13px;min-width:0}
.kr-perm b{font-weight:560;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kr-perm small{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kr-perm.warn b{color:var(--warn)}
.kr-perm.none b{color:var(--danger)}
.kr-calls{display:flex;align-items:center;gap:10px}
.kr-calls b{font-size:13.5px;font-weight:620;font-variant-numeric:tabular-nums;min-width:1.6em}
.kr-calls b.z{color:var(--text-3);font-weight:500}
.kr-calls .sp{width:56px;height:20px;flex:none}
.kr-calls .sp .cc-spark{height:20px}
.kr-seen{font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kr-act .cc-ibtn{width:34px;height:34px}
.kr.off .ag-av{filter:grayscale(1);opacity:.55}
.kr.off .kr-agent b{color:var(--muted)}
.kr .tag{display:inline-flex;align-items:center;height:18px;padding:0 6px;margin-left:6px;border-radius:99px;font-size:10.5px;font-weight:650;
  color:var(--muted);border:1px solid var(--line);vertical-align:1px}

/* deleted */
.ky-del{margin-top:28px}
.ky-del .kl{background:transparent}
.kd{display:flex;align-items:center;gap:12px;padding:10px 12px 10px 18px;border-top:1px solid var(--line);min-height:58px}
.kd:first-child{border-top:0}
.kd .ag-av{filter:grayscale(1);opacity:.6}
.kd .tx{flex:1;min-width:0}
.kd b{display:block;font-size:13.5px;font-weight:600;color:var(--text-2)}
.kd small{display:block;font:500 11.5px/1.3 var(--mono);color:var(--text-3)}
.kd .btn{height:34px}

/* empty */
.ky-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:44px 22px 40px}
.ky-empty .ic{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;margin-bottom:16px;background:var(--accent-soft);color:var(--accent);
  border:1px solid var(--accent-line)}
.ky-empty .ic .cc-i{width:24px;height:24px}
.ky-empty h3{margin:0 0 6px;font-size:17px;font-weight:700}
.ky-empty p{margin:0 0 18px;max-width:52ch;font-size:13.5px;line-height:1.6;color:var(--muted)}
.ky-empty .btn.primary{height:40px;padding:0 18px;border-radius:11px}
.ky-pop{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:20px}
.ky-pop a{text-decoration:none;display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px 0 6px;border-radius:99px;font-size:13px;font-weight:600;
  border:1px solid var(--line);background:var(--surface-0);color:var(--text-2)}
.ky-pop a:hover{text-decoration:none;border-color:var(--line-strong);color:var(--fg)}
.ky-err{padding:28px 20px;text-align:center;color:var(--muted);font-size:13px}
.ky-err b{display:block;color:var(--fg);margin-bottom:4px}
.ky-sk{display:flex;align-items:center;gap:14px;padding:0 18px;min-height:66px;border-top:1px solid var(--line)}
.ky-sk:first-child{border-top:0}

/* tablet: condensed rows */
@container ky (max-width:899px){
  .ky-sum{grid-template-columns:repeat(3,minmax(0,1fr))}
  .ky-ep{grid-column:1/-1;border-left:0;border-top:1px solid var(--line);flex-direction:row;align-items:center;gap:12px;padding:11px 18px}
  .ky-ep .row{flex:1}
  .kl-head{display:none}
  .kr{grid-template-columns:minmax(0,1fr) minmax(0,150px) 128px 104px 36px;gap:14px;min-height:70px}
  .kr-perm,.kr-seen{display:none}
  .kr-agent .kid{display:none}
  .kr-agent .sub2{display:block}
  .kr-agent .sub2 .app{display:none}
  .kr-st{align-items:flex-start}
  .kr-st .sd{margin-top:6px}
  .kr-st small{display:block}
}
/* phone: stacked cards */
@container ky (max-width:599px){
  .kr-agent .sub2 .app{display:inline}
  .kr-app{display:none}
  .ky-sum{margin-bottom:20px}
  .ky-st{padding:12px 14px}
  .ky-st .v{font-size:20px}
  .ky-st .sp,.ky-st .v small{display:none}
  .ky-ep{padding:10px 14px}
  .ky-ep .k{display:none}
  .kl{background:transparent;border:0;border-radius:0;overflow:visible}
  .kl ul{display:flex;flex-direction:column;gap:8px}
  .kr{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"agent act" "st calls";gap:12px 10px;padding:14px 10px 13px 14px;
    border:1px solid var(--line);border-radius:14px;background:var(--panel)}
  .kr:first-child{border-top:1px solid var(--line)}
  .kr-hit{border-radius:14px}
  .kr-hit:focus-visible{border-radius:14px}
  .kr-agent{grid-area:agent}
  .kr-act{grid-area:act;align-self:start;justify-self:end;margin:-6px -2px 0 0}
  .kr-st{grid-area:st;flex-direction:row;align-items:center;padding-left:52px}
  .kr-st .sd{margin-top:0}
  .kr-st .t{flex-direction:row;align-items:baseline;gap:6px}
  .kr-calls{grid-area:calls;justify-self:end;padding-right:6px}
  .kr-act .cc-ibtn{width:40px;height:40px}
  .ky-del .kl{border:1px solid var(--line);border-radius:14px;overflow:hidden}
  .kd{padding:10px 12px 10px 14px}
  .ky-empty{padding:34px 18px 30px}
}
`;

// ── routing ─────────────────────────────────────────────────────────────

type KeysView = { kind: 'list' } | { kind: 'new'; client: string } | { kind: 'agent'; id: string; tab: string };

/** What an /agents address shows (the router has validated its shape). */
function viewOf(path: string): KeysView {
  const segs = path.replace(/\/+$/, '').split('/').slice(2).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return '';
    }
  });
  if (!segs.length || !segs[0]) return { kind: 'list' };
  if (segs[0] === 'new') return { kind: 'new', client: segs[1] && appById(segs[1]) ? segs[1] : '' };
  return { kind: 'agent', id: segs[0], tab: segs[1] || 'overview' };
}

/** Open the new-agent page on the next visit to Agents (links from other pages). */
export function connectOnLoad(client = ''): void {
  setKeysRoute('/agents/new' + (client ? '/' + client : ''));
}

export async function renderKeys(): Promise<void> {
  useControlStyles();
  useFormStyles();
  useStyles('agents-sheet-css', SHEET_CSS);
  const host = $('#view-keys');
  const v = viewOf(location.pathname);
  const mode = v.kind === 'agent' ? 'agent:' + v.id : v.kind;
  if (host.dataset.mode !== mode) {
    // A different screen of the Agents page: start it at the top.
    host.dataset.mode = mode;
    host.scrollTop = 0;
  }
  if (v.kind === 'new') return renderNewAgent(host, v.client);
  if (v.kind === 'agent') return renderAgentPage(host, v.id, v.tab);
  return renderList(host);
}

// ── list ────────────────────────────────────────────────────────────────

async function renderList(host: HTMLElement): Promise<void> {
  useStyles('keys-css-4', KEYS_CSS);
  host.innerHTML = `<div class="cc ky">
    ${systemHeader(
      'keys',
      'Agents & API keys',
      'Each agent is one API key used by one app. Give every app or device its own agent, so Activity shows exactly who did what.',
      `<button type="button" class="cc-ibtn" id="kReload" aria-label="Reload" title="Reload">${ICO.refresh}</button>
       <a class="btn primary" id="kNew" href="/agents/new" data-nav="new">${ICO.plus}New agent</a>`,
    )}
    <div class="ky-sum" id="kStats" aria-live="polite">${statsHTML(data.loaded ? data.keys : null)}</div>
    <div class="ky-h"><h2>Agents</h2><span id="kCount"></span></div>
    <div class="kl" id="kList" aria-busy="true">${skeletonRows()}</div>
    <div id="kDel"></div></div>`;
  wireAgentLinks(host);
  $('#kReload').onclick = () => {
    $('#kReload').classList.add('spin');
    void loadAgents(true);
  };
  wireCopy($('#kStats'));
  whileVisible(host, () => {
    let t = 0;
    const unsub = onAgents((_n, seen) => {
      // A call shows up at once: bump the agent's last call and repaint soon.
      if (bumpSeen(seen) && !t) t = window.setTimeout(() => ((t = 0), paint()), 800);
    });
    const off = onAgentsData(() => paint());
    // Active turns Idle after five quiet minutes; keep the times honest.
    const tick = window.setInterval(() => paint(), 30000);
    return () => {
      unsub();
      off();
      clearTimeout(t);
      clearInterval(tick);
    };
  });
  if (data.loaded) paint();
  await loadAgents(true);
}

function skeletonRows(): string {
  return Array.from(
    { length: 4 },
    () => `<div class="ky-sk">${skBlock('32px', 32)}<span style="flex:1">${skBlock('28%', 11)}</span><span style="flex:1">${skBlock('40%', 10)}</span></div>`,
  ).join('');
}

function paint(): void {
  const list = document.getElementById('kList');
  if (!list || !document.querySelector('#view-keys .ky')) return;
  document.getElementById('kReload')?.classList.remove('spin');
  if (!data.loaded && data.error) {
    $('#kStats').innerHTML = statsHTML(null);
    list.removeAttribute('aria-busy');
    list.innerHTML = `<div class="ky-err"><b>Could not load the agents</b>${esc(data.error)}
      <div style="margin-top:14px"><button type="button" class="btn" id="kRetry">${ICO.refresh}Try again</button></div></div>`;
    $('#kRetry').onclick = () => void loadAgents(true);
    return;
  }
  if (!data.loaded) return;
  $('#kStats').innerHTML = statsHTML(data.keys);
  wireCopy($('#kStats'));
  paintList(list);
  paintDeleted();
}

function statsHTML(rows: KeyRowFull[] | null): string {
  const url = mcpUrl();
  const ep = `<div class="ky-st ky-ep"><span class="k">MCP endpoint</span><span class="row"><code title="${attr(url)}">${esc(url)}</code>
    <button type="button" class="cc-ibtn" data-copy="${attr(url)}" aria-label="Copy the MCP endpoint" title="Copy">${ICO.copy}</button></span></div>`;
  if (!rows) {
    const sk = (k: string): string => `<div class="ky-st"><span class="k">${k}</span><span class="v">${skBlock('38px', 22)}</span></div>`;
    return sk('Agents') + sk('Active now') + sk('Calls in 24h') + ep;
  }
  const now = Date.now() / 1000;
  const on = rows.filter((k) => k.enabled !== false);
  const active = on.filter((k) => statusOf(k, now).st === 'active').length;
  const all24 = new Array(24).fill(0);
  for (const k of rows) usageOf(k)?.spark.forEach((v, i) => (all24[i] += v));
  const day = all24.reduce((a, b) => a + b, 0);
  const off = rows.length - on.length;
  return `<div class="ky-st"><span class="k">Agents</span><span class="v">${rows.length}${
    rows.length ? `<small>${off ? `${on.length} on · ${off} off` : 'all on'}</small>` : ''
  }</span></div>
    <div class="ky-st"><span class="k">Active now</span><span class="v">${active}${active ? '<span class="ky-live" aria-hidden="true"></span>' : ''}</span></div>
    <div class="ky-st"><span class="k">Calls in 24h</span><span class="v">${day}${day ? `<span class="sp">${sparkSVG(all24, 72, 22)}</span>` : ''}</span></div>${ep}`;
}

/** Live agents first, most recent call first; never used next; turned off last. */
function sorted(): KeyRowFull[] {
  const rank = (k: KeyRowFull): number => (k.enabled === false ? 2 : usageOf(k) || k.uses ? 0 : 1);
  return [...data.keys].sort((a, b) => rank(a) - rank(b) || (usageOf(b)?.last || 0) - (usageOf(a)?.last || 0) || nameOf(a).localeCompare(nameOf(b)));
}

function paintList(list: HTMLElement): void {
  const keys = data.keys;
  list.removeAttribute('aria-busy');
  const on = keys.filter((k) => k.enabled !== false).length;
  $('#kCount').textContent = keys.length ? `${keys.length} · ${on === keys.length ? 'all turned on' : `${keys.length - on} turned off`}` : '';
  if (!keys.length) {
    const pop = ['claude-code', 'cursor', 'claude-ai', 'chatgpt', 'codex']
      .map((id) => appById(id))
      .filter(Boolean)
      .map((s) => `<a href="${attr(agentsHref('new/' + s!.id))}" data-nav="new/${attr(s!.id)}">${appIconHTML(s!.label, 26)}${esc(s!.label)}</a>`)
      .join('');
    list.innerHTML = `<div class="ky-empty"><span class="ic">${ICO.plug}</span><h3>No agents yet</h3>
      <p>Make an agent for each app or device you use. Each one gets its own key, so you can see what it does and turn it off on its own.</p>
      <a class="btn primary" href="/agents/new" data-nav="new">${ICO.plus}New agent</a><div class="ky-pop" aria-label="Popular apps">${pop}</div></div>`;
    wireAgentLinks(list);
    return;
  }
  const now = Date.now() / 1000;
  list.innerHTML = `<div class="kl-head" aria-hidden="true"><span>Agent</span><span>App</span><span>Status</span><span>Access</span><span>Calls 24h</span><span>Last call</span><span></span></div>
    <ul aria-label="Agents">${sorted()
      .map((k) => rowHTML(k, now))
      .join('')}</ul>`;
  wireAgentLinks(list);
  $$<HTMLElement>('[data-more]', list).forEach(
    (b) =>
      (b.onclick = (e) => {
        e.stopPropagation();
        const k = data.keys.find((x) => x.id === b.dataset.more);
        if (k) agentMenu(b, k);
      }),
  );
}

function rowHTML(k: KeyRowFull, now: number): string {
  const name = nameOf(k);
  const s = statusOf(k, now);
  const u = usageOf(k);
  const app = appFor(k);
  const p = summarize(permsOf(k));
  const signed = data.oauth.has(k.id) ? '<span class="tag">Signed in</span>' : '';
  const day = u ? u.day : 0;
  return `<li class="kr${s.st === 'off' ? ' off' : ''}" style="--ag:${agentColor(name, k.id)}">
    <a class="kr-hit" href="${attr(agentsHref(k.id))}" data-nav="${attr(k.id)}" aria-label="${attr(`${name}: ${s.label}, ${app.label || 'app not set'}, ${p.level}`)}"></a>
    <div class="kr-agent">${avatarHTML(name, 34, '', k.id)}<span class="t"><b>${esc(name)}${signed}</b><span class="kid">${esc(k.id)}</span>
      <span class="sub2"><span class="app">${esc(app.label || 'App not set')} · </span>${esc(p.level)}</span></span></div>
    <div class="kr-app">${appIconHTML(app.label, 24)}<span class="${app.label ? '' : 'none'}">${esc(app.label || 'Not set')}</span></div>
    <div class="kr-st"><span class="sd ${s.st}" aria-hidden="true"></span><span class="t"><b>${s.label}</b><small>${esc(s.st === 'never' ? 'No calls yet' : s.seen)}</small></span></div>
    <div class="kr-perm${p.tone ? ' ' + p.tone : ''}"><b>${esc(p.level)}</b><small>${esc(p.tools)}</small></div>
    <div class="kr-calls"><b class="${day ? '' : 'z'}">${day}</b><span class="sp">${day ? sparkSVG(u!.spark, 56, 20) : ''}</span></div>
    <div class="kr-seen">${esc(s.seen)}</div>
    <div class="kr-act"><button type="button" class="cc-ibtn" data-more="${attr(k.id)}" aria-haspopup="menu" aria-label="Actions for ${attr(name)}" title="Actions">${ICO.more}</button></div>
  </li>`;
}

function paintDeleted(): void {
  const box = $('#kDel');
  if (!state.keysDeleted.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<section class="ky-del"><div class="ky-h"><h2>Recently deleted</h2><span>Restore until you reload the app</span></div>
    <div class="kl">${state.keysDeleted
      .map(
        (k) => `<div class="kd">${avatarHTML(nameOf(k), 32, '', k.id)}<span class="tx"><b>${esc(nameOf(k))}</b><small>${esc(k.id)}</small></span>
        <button type="button" class="btn" data-restore="${attr(k.id)}">${ICO_RESTORE}Restore</button></div>`,
      )
      .join('')}</div></section>`;
  $$<HTMLElement>('[data-restore]', box).forEach((b) => (b.onclick = () => void restoreKey(b.dataset.restore!)));
}

function agentMenu(anchor: HTMLElement, k: KeyRowFull): void {
  const name = nameOf(k);
  const off = k.enabled === false;
  const never = statusOf(k).st === 'never';
  openMenu(
    anchor,
    [
      { label: 'Open', desc: 'Its page: status, recent calls, access and settings.', icon: ICO_CHEV, run: () => navAgents(k.id) },
      {
        label: never ? 'Connect' : 'Setup guide',
        desc: 'The setup steps for its app, with its key filled in.',
        icon: ICO.plug,
        run: () => navAgents(k.id + '/setup'),
      },
      { label: 'Activity', desc: 'Everything this agent did.', icon: ICO_ACTIVITY, run: () => navAgents(k.id + '/activity') },
      { sep: true, label: '' },
      {
        label: off ? 'Turn on' : 'Turn off',
        desc: off ? 'Let it connect again with the same key.' : 'Block it without deleting; turn back on any time.',
        icon: off ? ICO.check : ICO_POWER,
        run: () => void toggleKey(k),
      },
      { label: 'Delete', desc: 'Remove the agent; its key stops working at once.', icon: ICO_TRASH, danger: true, run: () => delKey(k) },
    ],
    { title: name, lead: avatarHTML(name, 30, '', k.id) },
  );
}
