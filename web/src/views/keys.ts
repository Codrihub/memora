// Agents & API keys: routes /agents, /agents/new and /agents/<id>, and draws the list (an agent is one key used by
// one app). The data and the actions live in views/agents-data.ts.

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
.ky{container:ky/inline-size;--r14:14px;--tile:color-mix(in srgb,var(--fg) 5%,transparent);--tile-h:color-mix(in srgb,var(--fg) 8%,transparent)}
@media (min-width:1101px){.ky{padding:8px 8px 0}}
.ky a.btn{text-decoration:none}
.ky .ag-av{border-radius:30%}
.ky .sys-head{align-items:flex-end;margin:0 0 24px}
.ky .sys-head h1{font-size:26px;font-weight:650;letter-spacing:-.02em}
.ky .sys-head p{margin-top:6px;font-size:14px}
.ky .sys-acts .btn{height:40px;padding:0 16px;border-radius:10px;font-size:13.5px}

.ky-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) minmax(0,1.7fr);margin:0 0 32px;min-width:0;background:var(--surface-1);
  border:1px solid var(--line);border-radius:var(--r14);overflow:hidden}
.ky-st{display:flex;flex-direction:column;justify-content:flex-start;gap:8px;padding:20px 22px;min-width:0}
.ky-st+.ky-st{border-left:1px solid var(--line)}
.ky-st .k{font-size:12.5px;font-weight:500;color:var(--muted);white-space:nowrap}
.ky-st .v{display:flex;align-items:center;gap:12px;font-size:30px;font-weight:400;letter-spacing:-.03em;line-height:1.15;font-variant-numeric:tabular-nums}
.ky-st .v small{font-size:12.5px;font-weight:500;letter-spacing:0;color:var(--muted)}
.ky-st .sp{width:88px;height:26px;flex:none}
.ky-st .sp .cc-spark{height:26px}
.ky-ep{background:color-mix(in srgb,var(--fg) 2%,transparent)}
.ky-ep .row{display:flex;align-items:center;gap:8px;min-width:0;height:36px;padding:0 4px 0 12px;border-radius:10px;background:var(--surface-1);border:1px solid var(--line)}
.ky-ep code{flex:1;min-width:0;font:500 13px/1.3 var(--mono);color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ky-ep .cc-ibtn{width:30px;height:30px}
.ky-ep .hint{font-size:12.5px;color:var(--muted)}
.ky-live{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 4px var(--ok-soft)}

.ky-h{display:flex;align-items:center;gap:10px;margin:0 0 14px;min-width:0}
.ky-h::before{content:"";width:3px;height:14px;border-radius:2px;background:var(--gt,var(--brand-mark,var(--accent)));flex:none}
.ky-h h2{margin:0;font-size:15px;font-weight:600}
.ky-h span{font-size:13px;color:var(--muted)}

.kl{min-width:0}
.kl ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:16px}
.kc{position:relative;display:flex;flex-direction:column;min-width:0;padding:20px 20px 10px;background:var(--surface-1);border:1px solid var(--line);
  border-radius:var(--r14);transition:border-color .16s}
.kc:hover{border-color:var(--line-strong)}
.kr-hit{position:absolute;inset:0;z-index:0;display:block;border-radius:var(--r14);cursor:pointer}
.kr-hit:focus-visible{box-shadow:inset 0 0 0 2px var(--accent);border-radius:var(--r14)}
.kc>:not(.kr-hit){position:relative;min-width:0;pointer-events:none}
.kc .kr-act{pointer-events:auto;z-index:1}
.kc-h{display:flex;align-items:center;gap:12px}
.kc-h .t{flex:1;display:flex;flex-direction:column;gap:3px;min-width:0}
.kc-h b{font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kc-h .st{font-size:12.5px;gap:7px;color:var(--text-2)}
.kc-h .st::before{width:6px;height:6px}
.kc-h .st.ok::before{box-shadow:0 0 0 3px var(--ok-soft)}
.kc-h .st.never::before{background:transparent;box-shadow:inset 0 0 0 1.5px var(--text-3)}
.kc-d{margin:14px 0 0;font-size:13.5px;line-height:1.5;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kc-d.none{color:var(--text-3)}
.kc-props{margin:14px 0 0;padding:6px 0 0;border-top:1px solid var(--line);display:flex;flex-direction:column}
.kc-props>div{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:36px;font-size:13.5px}
.kc-props dt{color:var(--muted);flex:none}
.kc-props dd{margin:0;display:flex;align-items:center;gap:8px;min-width:0;justify-content:flex-end;font-weight:500;color:var(--fg)}
.kc-props dd>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kc-props dd.warn{color:var(--warn)}
.kc-props dd.none{color:var(--danger)}
.kc-props dd .z{color:var(--text-3);font-weight:400}
.kc-props dd .muted{color:var(--text-3);font-weight:400}
.kc-props .sp{width:60px;height:20px;flex:none}
.kc-props .sp .cc-spark{height:20px}
.kr-act .cc-ibtn{width:34px;height:34px;opacity:0;transition:opacity .16s,background .16s}
.kc:hover .kr-act .cc-ibtn,.kr-act .cc-ibtn:focus-visible,.kr-act .cc-ibtn[aria-expanded=true]{opacity:1}
@media (hover:none),(pointer:coarse){.kr-act .cc-ibtn{opacity:1}}
.kc.off .ag-av{filter:grayscale(1);opacity:.55}
.kc.off .kc-h b{color:var(--muted)}
.kc-add{display:flex}
.ky-add{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;width:100%;min-height:200px;padding:24px;border-radius:var(--r14);
  background:var(--tile);border:1px dashed var(--line-strong);color:var(--text-2);font-size:14px;font-weight:550;text-decoration:none;text-align:center;
  transition:background .16s,color .16s,border-color .16s}
.ky-add .ic{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--surface-1);border:1px solid var(--line);color:var(--fg)}
.ky-add .ic .cc-i{width:18px;height:18px}
.ky-add small{display:block;margin-top:-4px;font-size:12.5px;font-weight:400;color:var(--muted)}
.ky-add:hover{background:var(--tile-h);color:var(--fg);border-color:var(--text-3);text-decoration:none}
.ky-add:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.ky-del{margin-top:36px}
.ky-del .kl{background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r14);overflow:hidden}
.kd{display:flex;align-items:center;gap:12px;padding:10px 16px 10px 20px;border-top:1px solid var(--line);min-height:60px}
.kd:first-child{border-top:0}
.kd .ag-av{filter:grayscale(1);opacity:.6}
.kd .tx{flex:1;min-width:0}
.kd b{display:block;font-size:14px;font-weight:500;color:var(--text-2)}
.kd small{display:block;font:500 12px/1.3 var(--mono);color:var(--text-3)}
.kd .btn{height:34px;border-radius:8px}

.ky-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:56px 24px 48px;background:var(--surface-1);
  border:1px solid var(--line);border-radius:var(--r14)}
.ky-empty .ic{display:grid;place-items:center;width:44px;height:44px;margin-bottom:14px;border-radius:12px;color:#5eead4;background:linear-gradient(180deg,#17202e,#0b0f17)}
.ky-empty .ic .cc-i{width:20px;height:20px}
.ky-empty h3{margin:0 0 6px;font-size:15px;font-weight:600}
.ky-empty p{margin:0 0 20px;max-width:52ch;font-size:14px;line-height:1.6;color:var(--muted)}
.ky-empty .btn.primary{height:40px;padding:0 18px;border-radius:10px}
.ky-pop{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:22px}
.ky-pop a{text-decoration:none;display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px 0 6px;border-radius:99px;font-size:13px;font-weight:550;
  border:1px solid var(--line-strong);color:var(--text-2)}
.ky-pop a:hover{text-decoration:none;background:var(--hover);color:var(--fg)}
.ky-err{padding:36px 20px;text-align:center;color:var(--muted);font-size:13.5px;background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r14)}
.ky-err b{display:block;color:var(--fg);margin-bottom:4px}
.ky-sk{display:flex;flex-direction:column;gap:14px;padding:20px;min-height:200px;background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r14)}
.kl[aria-busy] ul,.kl .ky-sks{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:16px}

@container ky (max-width:899px){
  .ky-sum{grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:28px}
  .ky-st:nth-child(3){border-left:0}
  .ky-st:nth-child(n+3){border-top:1px solid var(--line)}
}
@container ky (max-width:599px){
  .ky-sum{margin-bottom:24px;grid-template-columns:repeat(3,minmax(0,1fr))}
  .ky-st:nth-child(3){border-left:1px solid var(--line)}
  .ky-st:nth-child(-n+3){border-top:0}
  .ky-ep{grid-column:1/-1;border-left:0!important}
  .ky-st{padding:16px}
  .ky-st .k{font-size:12px}
  .ky-st .v{font-size:26px}
  .ky-st .sp,.ky-st .v small,.ky-ep .hint{display:none}
  .kl ul{gap:12px}
  .kc{padding:16px 16px 8px}
  .kr-act .cc-ibtn{width:44px;height:44px;margin:-6px -8px -6px 0}
  .ky-add{min-height:120px}
  .kd{padding:10px 12px 10px 16px}
  .ky-empty{padding:40px 18px 34px}
}
@media (prefers-reduced-motion:reduce){.kr-act .cc-ibtn{transition:none}}
`;

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

async function renderList(host: HTMLElement): Promise<void> {
  useStyles('keys-css-4', KEYS_CSS);
  host.innerHTML = `<div class="cc ky">
    ${systemHeader(
      'keys',
      'Agents & API keys',
      'Each AI app you connect is an agent with its own key, so you see what each one does and can turn one off on its own.',
      `<a class="btn primary" id="kNew" href="/agents/new" data-nav="new">${ICO.plus}New agent</a>`,
    )}
    <div class="ky-sum" id="kStats" aria-live="polite">${statsHTML(data.loaded ? data.keys : null)}</div>
    <div class="ky-h"><h2>Agents</h2><span id="kCount"></span></div>
    <div class="kl" id="kList" aria-busy="true">${skeletonRows()}</div>
    <div id="kDel"></div></div>`;
  wireAgentLinks(host);
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
  return `<div class="ky-sks">${Array.from(
    { length: 3 },
    () => `<div class="ky-sk">${skBlock('36px', 36)}${skBlock('45%', 12)}${skBlock('100%', 10)}${skBlock('80%', 10)}${skBlock('60%', 10)}</div>`,
  ).join('')}</div>`;
}

function paint(): void {
  const list = document.getElementById('kList');
  if (!list || !document.querySelector('#view-keys .ky')) return;
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
  const ep = `<div class="ky-st ky-ep"><span class="k">Address for AI apps</span><span class="row"><code title="${attr(url)}">${esc(url)}</code>
    <button type="button" class="cc-ibtn" data-copy="${attr(url)}" aria-label="Copy the address (MCP endpoint)" title="Copy">${ICO.copy}</button></span>
    <span class="hint">The MCP endpoint every agent connects to</span></div>`;
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

/** Most recent activity first (live calls, the loaded history or the key's last use); never used last, newest first. */
function sorted(): KeyRowFull[] {
  const last = (k: KeyRowFull): number => Math.max(usageOf(k)?.last || 0, k.last_used || 0);
  return [...data.keys].sort((a, b) => last(b) - last(a) || (b.created || 0) - (a.created || 0) || nameOf(a).localeCompare(nameOf(b)));
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
  list.innerHTML = `<ul aria-label="Agents">${sorted()
    .map((k) => rowHTML(k, now))
    .join('')}<li class="kc-add"><a class="ky-add" href="/agents/new" data-nav="new"><span class="ic">${ICO.plus}</span>Connect another AI<small>Claude, ChatGPT, Cursor and more</small></a></li></ul>`;
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
  const signed = data.oauth.has(k.id);
  const kind = app.id ? appById(app.id)?.kind || '' : '';
  const desc = kind ? kind + (signed ? ' · signed in' : '') : signed ? 'Signed in' : 'No app picked yet';
  const day = u ? u.day : 0;
  const dot = s.st === 'active' ? 'ok' : s.st === 'off' ? 'danger' : s.st;
  return `<li class="kc${s.st === 'off' ? ' off' : ''}" style="--ag:${agentColor(name, k.id)}">
    <a class="kr-hit" href="${attr(agentsHref(k.id))}" data-nav="${attr(k.id)}" aria-label="${attr(`${name}: ${s.label}, ${app.label || 'app not set'}, ${p.level}`)}"></a>
    <div class="kc-h">${avatarHTML(name, 40, '', k.id)}<span class="t"><b title="${attr(k.id)}">${esc(name)}</b>
      <span class="st ${dot}">${s.label}${s.st === 'active' || s.st === 'off' ? '' : s.st === 'never' ? ' · no calls yet' : ''}</span></span>
      <span class="kr-act"><button type="button" class="cc-ibtn" data-more="${attr(k.id)}" aria-haspopup="menu" aria-label="Actions for ${attr(name)}" title="Actions">${ICO.more}</button></span></div>
    <p class="kc-d${kind || signed ? '' : ' none'}">${esc(desc)}</p>
    <dl class="kc-props">
      <div><dt>Access</dt><dd class="${p.tone || ''}" title="${attr(p.tools)}"><span>${esc(p.level)}</span></dd></div>
      <div><dt>Last active</dt><dd><span class="${s.st === 'never' ? 'muted' : ''}">${esc(s.seen)}</span></dd></div>
      <div><dt>Calls in 24h</dt><dd>${day ? `<span class="sp">${sparkSVG(u!.spark, 56, 20)}</span>` : ''}<span class="${day ? '' : 'z'}">${day}</span></dd></div>
      <div><dt>App</dt><dd>${appIconHTML(app.label, 20)}<span class="${app.label ? '' : 'muted'}">${esc(app.label || 'Not set')}</span></dd></div>
    </dl>
  </li>`;
}

function paintDeleted(): void {
  const box = $('#kDel');
  if (!state.keysDeleted.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<section class="ky-del"><div class="ky-h" style="--gt:var(--warn)"><h2>Recently deleted</h2><span>Restore until you reload the app</span></div>
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
