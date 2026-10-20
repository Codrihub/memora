// Overview: the vault at a glance. A compact header with one status sentence,
// four equal KPI tiles, the vault (location, last change, largest folders),
// the agents that exist right now (live API keys only; removed keys never
// count), the live activity stream, recent node changes with who made them and
// a system status card. One 12-column grid driven by container queries, so the
// layout follows the space the view really gets (sidebar open or not).

import { apiGet } from '../api';
import { on } from '../bus';
import { $, attr, esc, useStyles } from '../dom';
import { fmtTs, noteName, relTs } from '../format';
import { hooks } from '../hooks';
import { state, allNotes, colorOfFolder } from '../state';
import { agentColor, avatarHTML, setAgentColors } from '../control/agents';
import { connectOnLoad } from './keys';
import { useActivityStyles, wireActRows } from '../control/activity';
import { loadFeed, onLive, pushLive, settleRunning, verb, type ActivityItem } from '../control/feed';
import { ago, copyText, ICO, plural, sparkSVG, useControlStyles, whileVisible } from '../control/ui';
import { RT } from '../realtime';
import type { KeyRow, KeysResult } from '../types';
import type { Page } from '../state';
import { nav } from '../vault/nav';
import { BRAND_DESC, BRAND_MOTTO, BRAND_NAME, BRAND_ONCE, markSvg } from '../brand';
import { openWelcome } from './welcome';
import { rowsSkeleton } from '../ui/skeleton';

// Spacing scale: 8 / 12 / 16 / 24. Cards: 16px padding, 48px header, 56px rows.
// Surfaces are solid (panel, panel-2); tints are mixed into the panel, never
// into transparent.
const CSS = `
.ov{container:ov/inline-size}
.ov-head{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin:0 0 24px}
.ov-head .t{flex:1 1 320px;min-width:0}
.ov-head h1{margin:0;font-size:22px;font-weight:700;letter-spacing:-.3px;line-height:1.25}
.ov-head p{margin:4px 0 0;font-size:13px;line-height:1.5;color:var(--muted)}
.ov-head p b{color:var(--fg);font-weight:600}
.ov-acts{display:flex;align-items:center;gap:8px}
.ov-ibtn{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:var(--r-sm);flex:none;color:var(--muted);
  background:var(--panel);border:1px solid var(--line-strong);transition:color .16s,background .16s}
.ov-ibtn:hover{color:var(--fg);background:var(--panel-2)}
.ov-ibtn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ov-ibtn .cc-i{width:16px;height:16px}
.ov-ibtn.busy{color:var(--accent);cursor:progress}
.ov-ibtn.busy .cc-i{animation:ovSpin .8s linear infinite}
@keyframes ovSpin{to{transform:rotate(360deg)}}

/* cards */
.ov-card{display:flex;flex-direction:column;min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden}
.ov-card[hidden]{display:none}
.ov-card-h{display:flex;align-items:center;gap:8px;height:48px;padding:0 16px;border-bottom:1px solid var(--line);flex:none}
.ov-card-h h2{margin:0;font-size:13.5px;font-weight:650;letter-spacing:.01em;color:var(--fg)}
.ov-card-h .n{font-size:12px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}
.ov-card-h .grow{flex:1}
.ov-card-b{padding:16px;flex:1;min-width:0}
.ov-lnk{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:600;color:var(--accent);border-radius:6px}
.ov-lnk .cc-i{width:14px;height:14px}
.ov-lnk:hover{text-decoration:underline}
.ov-lnk:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ov-cap{margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}

/* grid */
.ov-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:16px}
.ov-grid>*{grid-column:span 12}
/* Cards side by side share one height and width, whatever they hold. */
.ov-grid{align-items:stretch}
.ov-grid>.ov-card{height:100%}
@container ov (min-width:900px){
  .ov-grid>.ov-vault,.ov-grid>.ov-agents,.ov-grid>.ov-activity,.ov-grid>.ov-recent{grid-column:span 6}
}

/* KPI tiles */
.ov-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:16px}
@container ov (min-width:600px){.ov-kpis{grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}}
.ov-kpi{display:flex;flex-direction:column;gap:8px;min-width:0;padding:16px;text-align:left;background:var(--panel);
  border:1px solid var(--line);border-radius:var(--r-lg);transition:border-color .16s,background .16s}
.ov-kpi:hover{border-color:var(--line-strong);background:var(--panel-2)}
.ov-kpi:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ov-kpi-k{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--muted)}
.ov-kpi-k .ic{display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--panel-2);color:var(--accent);flex:none}
.ov-kpi:hover .ov-kpi-k .ic{background:var(--panel)}
.ov-kpi-k .ic .cc-i{width:14px;height:14px}
.ov-kpi-m{display:flex;align-items:flex-end;gap:12px;height:32px}
.ov-kpi-v{font-size:28px;font-weight:720;letter-spacing:-.5px;line-height:1;font-variant-numeric:tabular-nums;color:var(--fg)}
.ov-kpi-viz{margin-left:auto;width:76px;height:28px;flex:none;display:flex;align-items:flex-end}
.ov-mini{display:flex;align-items:flex-end;gap:2px;width:100%;height:28px}
.ov-mini i{flex:1;min-height:2px;border-radius:2px 2px 0 0;background:var(--line-strong)}
.ov-mini i.on{background:var(--accent)}
.ov-kpi-bar{display:flex;gap:2px;width:100%;height:6px;margin-bottom:4px;border-radius:99px;overflow:hidden}
.ov-kpi-bar i{display:block;height:100%;min-width:3px}
.ov-kpi-h{display:flex;align-items:center;gap:6px;min-height:18px;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ov-kpi-h b{color:var(--fg);font-weight:600}
.ov-kpi-h .cc-dot{width:7px;height:7px}
@container ov (max-width:420px){.ov-kpi{padding:12px}.ov-kpi-v{font-size:24px}.ov-kpi-viz{width:56px}}

/* vault */
.ov-vault .ov-card-b{container:vb/inline-size}
.ov-facts{display:flex;flex-direction:column;gap:16px}
.ov-pair{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
@container vb (min-width:480px){.ov-pair{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}}
.ov-row{display:flex;align-items:center;gap:12px;min-width:0}
.ov-tile{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:var(--panel-2);color:var(--muted);flex:none}
.ov-tile .cc-i{width:16px;height:16px}
.ov-tile.fc{color:var(--fc)}
:root[data-theme=light] .ov-tile.fc{color:color-mix(in srgb,var(--fc) 72%,#0f172a)}
.ov-row .t{flex:1;min-width:0}
.ov-path{display:flex;min-width:0;font:500 12.5px/1.4 var(--mono);color:var(--fg)}
.ov-path .h{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ov-path .e{flex:none;white-space:nowrap}
.ov-sub{display:block;margin-top:2px;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ov-name{max-width:100%;font-size:13.5px;font-weight:600;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  text-align:left;border-radius:4px}
button.ov-name:hover{color:var(--accent)}
button.ov-name:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ov-bars{display:flex;flex-direction:column;gap:4px}
.ov-bar{display:grid;grid-template-columns:minmax(0,9rem) minmax(0,1fr) 2.5rem;align-items:center;gap:12px;height:28px;padding:0 8px;
  margin:0 -8px;border-radius:8px;text-align:left;font-size:12.5px;color:var(--fg)}
.ov-bar:hover{background:var(--panel-2)}
.ov-bar:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ov-bar .l{display:flex;align-items:center;gap:8px;min-width:0;font-weight:600}
.ov-bar .l span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ov-bar .d{width:8px;height:8px;border-radius:3px;flex:none}
.ov-bar .tr{height:6px;border-radius:99px;background:var(--panel-2);overflow:hidden}
.ov-bar:hover .tr{background:var(--panel)}
.ov-bar .tr i{display:block;height:100%;border-radius:99px}
.ov-bar .c{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
.ov-more{margin-top:4px;font-size:12px;color:var(--muted)}

/* list rows, shared by agents, activity and recent changes */
.ov-list{display:flex;flex-direction:column}
.ov-li{display:flex;align-items:center;gap:12px;height:56px;padding:0 16px;border-top:1px solid var(--line);min-width:0;width:100%;
  text-align:left;cursor:pointer;color:var(--fg);transition:background .14s;flex:none}
.ov-li:first-child{border-top:0}
.ov-li:hover{background:var(--panel-2)}
.ov-li:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ov-li .t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.ov-li .n{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;font-weight:600;line-height:1.35;white-space:nowrap;overflow:hidden}
.ov-li .n>span{overflow:hidden;text-overflow:ellipsis}
.ov-li .s{display:flex;align-items:center;gap:6px;min-width:0;font-size:12px;line-height:1.35;color:var(--muted);white-space:nowrap;overflow:hidden}
.ov-li .s>span{overflow:hidden;text-overflow:ellipsis}
.ov-li .s .sep{flex:none}
.ov-li .m{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex:none;font-size:12px;color:var(--muted);
  font-variant-numeric:tabular-nums;white-space:nowrap}
.ov-li .m b{font-size:13px;font-weight:650;color:var(--fg)}
.ov-li .ag-who{color:var(--ag);font-weight:650;flex:none}
:root[data-theme=light] .ov-li .ag-who{color:color-mix(in srgb,var(--ag) 62%,#0f172a)}
.ov-li .vb{font-weight:500;color:var(--fg)}
.ov-li .nt{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--muted);border-radius:4px}
.ov-li button.nt:hover{color:var(--accent);text-decoration:underline}
.ov-li .who{display:inline-flex;align-items:center;gap:4px;color:var(--fg);flex:none}
.ov-li .sp{width:56px;flex:none}
.ov-li.gone{color:var(--muted)}
.ov-li.gone .ag-av{filter:grayscale(1)}
.ov-li.new{animation:ovIn .8s var(--ease)}
@keyframes ovIn{from{background:color-mix(in srgb,var(--ag,var(--accent)) 14%,var(--panel))}to{background:var(--panel)}}
.ov-st{display:inline-flex;align-items:center;gap:5px}
.ov-st.on{color:var(--ok)}
.ov-st.off{color:var(--danger)}
.ov-tag{flex:none;font-size:11px;font-weight:600;padding:1px 6px;border-radius:6px;background:var(--panel-2);color:var(--muted)}
/* Live activity and Recent changes: the newest LIST_ROWS rows, no scrolling,
   always the same height; when there are fewer, a quiet line fills the rest. */
.ov-scroll{flex:none;height:calc(56px * 8);overflow:hidden}
.ov-scroll>.ov-li{flex:none}
.ov-rest{flex:1;display:flex;align-items:center;justify-content:center;padding:16px;border-top:1px solid var(--line);
  font-size:12px;color:var(--muted);text-align:center}

.ov-foot{display:flex;align-items:center;justify-content:center;height:40px;border-top:1px solid var(--line);flex:none}
.ov-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;height:100%;min-height:200px;padding:24px 16px;
  text-align:center;font-size:12.5px;line-height:1.5;color:var(--muted)}
.ov-empty .ov-tile{margin-bottom:8px;color:var(--accent)}
.ov-empty b{font-size:13.5px;font-weight:650;color:var(--fg)}
.ov-empty p{margin:0;max-width:34ch}
.ov-empty .btn{margin-top:12px}
.ov-grow{flex:1}
.ov-connect{display:flex;align-items:center;gap:12px;min-height:64px;padding:12px 16px;border-top:1px solid var(--line);background:var(--panel);flex:none}
.ov-connect .t{flex:1;min-width:0}
.ov-connect small{display:block;margin-bottom:2px;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.ov-connect .ov-tile{color:var(--accent)}

/* system status */
.ov-sys{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
.ov-sys>div{display:flex;align-items:center;gap:12px;min-width:0;height:64px;padding:0 16px;border-top:1px solid var(--line)}
.ov-sys>div:nth-child(-n+2){border-top:0}
.ov-sys>div:nth-child(even){border-left:1px solid var(--line)}
@container ov (min-width:600px){
  .ov-sys{grid-template-columns:repeat(4,minmax(0,1fr))}
  .ov-sys>div,.ov-sys>div:nth-child(even){border-top:0;border-left:1px solid var(--line)}
  .ov-sys>div:first-child{border-left:0}
}
.ov-sys .t{flex:1;min-width:0}
.ov-sys small{display:block;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.ov-sys b{display:block;margin-top:2px;font-size:13px;font-weight:600;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ov-pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:99px;font-size:12px;font-weight:600;
  color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,var(--panel))}
.ov-pill.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,var(--panel))}
.ov-pill.err{color:var(--danger);background:color-mix(in srgb,var(--danger) 12%,var(--panel))}
.ov-pill .cc-dot{width:7px;height:7px;box-shadow:none}
.ov-copy{width:28px;height:28px;border-radius:8px}
.ov-copy .cc-i{width:14px;height:14px}

/* first run */
.ov-welcome{margin-bottom:16px}
.ov-welcome .ov-card-b{padding:24px}
.ov-wl-top{display:flex;align-items:center;gap:16px}
.ov-wl-mark{width:44px;height:44px;flex:none}
.ov-wl-motto{font-size:12px;font-weight:600;color:var(--accent)}
.ov-welcome h2{margin:2px 0 0;font-size:19px;font-weight:700;letter-spacing:-.01em;color:var(--fg)}
.ov-wl-desc{margin:12px 0 16px;max-width:72ch;font-size:13.5px;line-height:1.6;color:var(--muted)}
.ov-wl-steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr;gap:12px}
@container ov (min-width:720px){.ov-wl-steps{grid-template-columns:repeat(3,minmax(0,1fr))}}
.ov-wl-steps li{display:grid;grid-template-columns:auto 1fr;grid-template-rows:1fr auto;gap:12px;padding:16px;border:1px solid var(--line);
  border-radius:var(--r);background:var(--panel-2)}
.ov-wl-steps li>div{display:flex;flex-direction:column;gap:4px}
.ov-wl-steps b{font-size:13.5px;color:var(--fg)}
.ov-wl-steps span{font-size:12.5px;line-height:1.5;color:var(--muted)}
.ov-wl-steps .btn{grid-column:2;justify-self:start}
.ov-wl-n{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--panel);border:1px solid var(--line-strong);
  color:var(--accent);font-size:12px;font-weight:700}
.ov-wl-name{margin:16px 0 0;font-size:12px;font-style:italic;color:var(--muted)}
@container ov (max-width:600px){.ov-welcome .ov-card-b{padding:16px}}

/* phones: full-width actions, tighter header */
@container ov (max-width:600px){
  .ov-head{gap:12px;margin-bottom:16px}
  .ov-head h1{font-size:20px}
  .ov-acts{width:100%}
  .ov-acts .btn{flex:1}
  .ov-li{padding:0 12px}
  .ov-card-h{padding:0 12px}
  .ov-card-b{padding:12px}
  .ov-sys>div{padding:0 12px}
  .ov-connect{padding:12px}
  .ov-connect .btn{width:34px;padding:0}
  .ov-connect .btn .lbl{display:none}
  .ov-li .sp{display:none}
}
@media (prefers-reduced-motion:reduce){.ov-ibtn.busy .cc-i,.ov-li.new{animation:none}}
`;

/** Icons local to the overview, drawn like the control center set. */
const I = {
  folder: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  link: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  agent: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9.5 13h0M14.5 13h0M3 13v2M21 13v2"/></svg>',
  pulse: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2.5-6 5 12 2.5-6h4"/></svg>',
  clock: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/></svg>',
};

/** An agent counts as active this long after its last call (as the header pill). */
const ACTIVE_SECS = 5;
/** Tool calls that change nodes (reads never count as a change). */
const WRITES = /^(create|save|patch|move|rename|delete|soft_delete|merge|duplicate|batch_create|bulk_|restore|add_tags|remove_tags|set_tags|template_create|import)/;
/** Rows in Live activity and Recent changes (the box is exactly this tall). */
const LIST_ROWS = 8;
/** Live activity looks back this far. */
const ACTIVITY_WINDOW = 24 * 3600;

/** What fills the box when a list has fewer than LIST_ROWS rows. */
function restHTML(n: number, text: string): string {
  return n < LIST_ROWS ? `<div class="ov-rest">${esc(text)}</div>` : '';
}
const AGENT_ROWS = 5;
const FOLDER_ROWS = 5;

let keys: KeyRow[] = [];
let oauth = new Set<string>();
let feed: ActivityItem[] = [];
let conn: 'on' | 'connecting' | 'off' | '' = '';
let presence = 0;
let queued = false;
let loaded = false;
/** The key list has arrived at least once (the Agents count is known). */
let keysLoaded = false;
/** A load is running; callers waiting for the next one to finish. */
let loading = false;
let waiting: (() => void)[] = [];

export async function renderHome(): Promise<void> {
  useControlStyles();
  useActivityStyles();
  useStyles('ov-home-css', CSS);
  const host = document.getElementById('view-home');
  if (!host) return;

  if (!host.querySelector('#ovVault')) {
    const user = (state.me && (state.me.user || state.me.username)) || '';
    const kpi = (id: string, page: Page, icon: string, label: string): string =>
      `<button type="button" class="ov-kpi" id="${id}" data-go="${page}"><span class="ov-kpi-k"><span class="ic">${icon}</span>${label}</span>
        <span class="ov-kpi-m"><span class="ov-kpi-v" data-v>0</span><span class="ov-kpi-viz" data-viz></span></span>
        <span class="ov-kpi-h" data-h>&nbsp;</span></button>`;
    host.innerHTML = `<div class="cc ov">
      <header class="ov-head"><div class="t"><h1>${esc(greeting())}${user ? ', ' + esc(user) : ''}</h1><p id="ovSub">&nbsp;</p></div>
        <div class="ov-acts"><button type="button" class="ov-ibtn" id="ovReload" aria-label="Refresh" title="Refresh">${ICO.refresh}</button>
          <button type="button" class="btn" id="ovNew">${ICO.plus}New node</button>
          <button type="button" class="btn primary" id="ovBrain">Open the brain ${ICO.arrow}</button></div></header>
      <section class="ov-card ov-welcome" id="ovWelcome" aria-labelledby="ovWelcomeT" hidden></section>
      <div class="ov-kpis" aria-label="Vault in numbers">
        ${kpi('ovKNodes', 'vault', ICO.note, 'Nodes')}${kpi('ovKLinks', 'graph', I.link, 'Links')}${kpi('ovKFolders', 'vault', I.folder, 'Folders')}${kpi(
          'ovKAgents',
          'keys',
          I.agent,
          'Agents',
        )}
      </div>
      <div class="ov-grid">
        <section class="ov-card ov-vault" aria-labelledby="ovVaultT"><div class="ov-card-h"><h2 id="ovVaultT">Vault</h2><span class="grow"></span>
          <button type="button" class="ov-lnk" id="ovNodes">All nodes</button></div><div class="ov-card-b" id="ovVault"></div></section>
        <section class="ov-card ov-agents" aria-labelledby="ovAgentsT"><div class="ov-card-h"><h2 id="ovAgentsT">Agents</h2><span class="n" id="ovAgN"></span>
          <span class="grow"></span><button type="button" class="ov-lnk" id="ovKeys">Manage</button></div><div class="ov-list ov-grow" id="ovAgents"></div>
          <div class="ov-connect" id="ovConnect"></div></section>
        <section class="ov-card ov-activity" aria-labelledby="ovActT"><div class="ov-card-h"><h2 id="ovActT">Live activity</h2><span class="grow"></span>
          <button type="button" class="ov-lnk" id="ovAll">All activity</button></div>
          <div class="ov-list ov-scroll" id="ovAct">${rowsSkeleton(8)}</div></section>
        <section class="ov-card ov-recent" aria-labelledby="ovRecentT"><div class="ov-card-h"><h2 id="ovRecentT">Recent changes</h2><span class="grow"></span>
          <button type="button" class="ov-lnk" id="ovRecentAll">All nodes</button></div><div class="ov-list ov-scroll" id="ovRecent"></div></section>
        <section class="ov-card ov-health" aria-labelledby="ovHealthT"><div class="ov-card-h"><h2 id="ovHealthT">System status</h2><span class="grow"></span>
          <span id="ovHealthPill"></span></div><div class="ov-sys" id="ovHealth"></div></section>
      </div>
    </div>`;
    $('#ovBrain').onclick = () => hooks.go('brain');
    $('#ovNew').onclick = () => hooks.openNewNote();
    $('#ovNodes').onclick = () => hooks.go('vault');
    $('#ovRecentAll').onclick = () => hooks.go('vault');
    $('#ovKeys').onclick = () => hooks.go('keys');
    $('#ovAll').onclick = () => hooks.go('logs');
    host.querySelectorAll<HTMLElement>('.ov-kpi[data-go]').forEach((b) => (b.onclick = () => hooks.go(b.dataset.go as Page)));
    const reload = $('#ovReload');
    reload.onclick = () => {
      if (reload.classList.contains('busy')) return;
      reload.classList.add('busy');
      reload.setAttribute('aria-busy', 'true');
      reload.title = 'Refreshing…';
      // Spin for at least half a second so a fast refresh still registers.
      const pause = new Promise((r) => setTimeout(r, 500));
      void Promise.all([hooks.loadCore().then(() => load()), pause]).finally(() => {
        reload.classList.remove('busy');
        reload.removeAttribute('aria-busy');
        reload.title = 'Refresh';
      });
    };
    wireActRows($('#ovAct'), (id) => feed.find((x) => x.id === id));
  }

  whileVisible(host, () => {
    // State the realtime link reached before this page subscribed.
    conn = RT.state;
    presence = RT.clients;
    const offs = [
      onLive((it) => {
        pushLive(feed, it, 500);
        queue();
      }),
      on('connection', (c) => {
        conn = c;
        paintHealth();
      }),
      on('presence', (n) => {
        presence = n;
        paintHealth();
      }),
    ];
    // Keep active/idle, "2m ago" and the sparklines moving.
    const tick = window.setInterval(() => {
      paintAgents();
      paintActivity();
    }, 2000);
    return () => {
      offs.forEach((f) => f());
      clearInterval(tick);
    };
  });

  paintVault();
  paintRecent();
  paintHealth();
  await load();
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function queue(): void {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    paintAgents();
    paintActivity();
    paintRecent();
  }, 150);
}

/**
 * Fetch keys, feed and OAuth links. One request set at a time: calls made
 * while one runs share the next run, and each resolves once a run that
 * started after it has landed. (Dropping the older response instead meant a
 * busy vault, whose every write repaints this page, kept restarting the load
 * on a slow link and the Agents count never arrived.)
 */
function load(): Promise<void> {
  return new Promise((done) => {
    waiting.push(done);
    if (!loading) void pump();
  });
}

async function pump(): Promise<void> {
  loading = true;
  while (waiting.length) {
    const batch = waiting;
    waiting = [];
    try {
      await loadOnce();
    } catch (e) {
      console.warn('overview: load failed', e);
    }
    batch.forEach((done) => done());
  }
  loading = false;
}

async function loadOnce(): Promise<void> {
  const [k, f, o] = await Promise.all([
    apiGet<KeysResult | KeyRow[]>('/api/keys').catch(() => null),
    loadFeed('1d', 500).catch(() => [] as ActivityItem[]),
    apiGet<{ connections?: { key_id: string }[] }>('/api/oauth/clients').catch(() => null),
  ]);
  if (k) {
    keys = Array.isArray(k) ? k : k.keys || [];
    keysLoaded = true;
  }
  setAgentColors(keys);
  oauth = new Set((o?.connections || []).map((c) => c.key_id));
  feed = f;
  loaded = true;
  paintVault();
  paintAgents();
  paintRecent();
  paintActivity();
  paintHealth();
}

// ---------------------------------------------------------------- helpers

const TIME_TEXT = /(<time data-ts="[^"]*">)[^<]*(<\/time>)/g;

/**
 * Replace `el`'s content only when it really changed, so focus and hover
 * survive the 2s tick. Relative times
 * (`<time data-ts>`) tick in place: rebuilding the rows under a finger
 * cancels the scroll gesture on phones.
 */
function setHTML(el: HTMLElement, html: string): boolean {
  const key = html.replace(TIME_TEXT, '$1$2');
  if (el.dataset.html === key) {
    const fresh = Array.from(html.matchAll(/<time data-ts="[^"]*">([^<]*)<\/time>/g), (m) => m[1]);
    el.querySelectorAll('time[data-ts]').forEach((t, i) => {
      const v = fresh[i];
      if (v !== undefined && t.innerHTML !== v) t.innerHTML = v;
    });
    return false;
  }
  el.dataset.html = key;
  el.innerHTML = html;
  return true;
}

/** "just now", "4m ago", "3d ago" as a <time> that setHTML updates in place. */
function whenTag(ts: number): string {
  return `<time data-ts="${ts}">${esc(when(ts))}</time>`;
}

/** "just now", "4m ago", "3d ago": the one time format of every list on this page. */
function when(ts: number): string {
  const a = ago(ts);
  return a === 'now' ? 'just now' : a === '-' ? a : a + ' ago';
}

/** "/very/long/path/vault" as head (shrinks with an ellipsis) + last segment (always shown). */
function pathHTML(p: string): string {
  const i = p.replace(/[\\/]+$/, '').search(/[^\\/]+$/);
  const head = i > 0 ? p.slice(0, i) : '';
  const tail = i > 0 ? p.slice(i) : p;
  return `<span class="ov-path" title="${attr(p)}"><span class="h">${esc(head)}</span><span class="e">${esc(tail)}</span></span>`;
}

function emptyHTML(icon: string, title: string, text: string, btn = ''): string {
  return `<div class="ov-empty"><span class="ov-tile">${icon}</span><b>${title}</b><p>${text}</p>${btn}</div>`;
}

/** Nodes per top-level folder (the brain's regions), biggest first. */
function regions(): [string, number][] {
  const per = new Map<string, number>();
  for (const n of allNotes()) {
    const top = (n.folder || 'Root').split('/')[0] || 'Root';
    per.set(top, (per.get(top) || 0) + 1);
  }
  return [...per.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function regionColor(f: string): string {
  return colorOfFolder(f === 'Root' ? '' : f);
}

/** Fill one KPI tile: value, optional visual and hint. */
/** A KPI tile; `value` null = still loading (a placeholder, never a misleading 0), NaN = could not load. */
function setKpi(id: string, value: number | null, viz: string, hint: string): void {
  const b = document.getElementById(id);
  if (!b) return;
  const v = b.querySelector('[data-v]') as HTMLElement;
  if (value == null) {
    b.setAttribute('aria-busy', 'true');
    setHTML(v, '<span class="sk" style="display:inline-block;width:1.4ch;height:.9em;vertical-align:-.05em"></span>');
  } else {
    b.removeAttribute('aria-busy');
    delete v.dataset.html;
    v.textContent = Number.isNaN(value) ? '–' : value.toLocaleString();
  }
  setHTML(b.querySelector('[data-viz]') as HTMLElement, viz);
  setHTML(b.querySelector('[data-h]') as HTMLElement, hint);
}

/** Calls (or changes) per bucket, oldest first. */
function buckets(times: number[], n: number, size: number): number[] {
  const now = Date.now() / 1000;
  const out = new Array(n).fill(0);
  for (const t of times) {
    const i = Math.floor((now - t) / size);
    if (i >= 0 && i < n) out[n - 1 - i]++;
  }
  return out;
}

/** Tiny bar chart for a KPI tile, or nothing while every bucket is empty. */
function miniBars(v: number[], title: string): string {
  const max = Math.max(...v);
  if (!max) return '';
  return `<span class="ov-mini" title="${attr(title)}">${v
    .map((n) => `<i${n ? ' class="on"' : ''} style="height:${n ? Math.max(12, Math.round((n / max) * 100)) : 0}%"></i>`)
    .join('')}</span>`;
}

// ---------------------------------------------------------------- header + KPIs

function paintSub(): void {
  const sub = document.getElementById('ovSub');
  if (!sub) return;
  // What this page is, not a recount of the numbers right below it.
  sub.textContent =
    !state.health.vault && state.health.vault_configured === false
      ? 'No vault folder is configured yet.'
      : 'Your vault, your agents and what they are doing, at a glance.';
}

function paintKpis(): void {
  const notes = allNotes();
  const s = state.stats;
  const nodes = s.notes || notes.length;
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const today = notes.filter((n) => (n.mtime || 0) >= day.getTime() / 1000).length;
  const last = notes.reduce((m, n) => Math.max(m, n.mtime || 0), 0);
  setKpi(
    'ovKNodes',
    nodes,
    miniBars(
      buckets(
        notes.map((n) => n.mtime || 0),
        14,
        86400,
      ),
      'Nodes changed per day, last 14 days',
    ),
    today ? `<b>${today}</b> changed today` : last ? `Last change ${esc(relTs(last))}` : 'Empty vault',
  );
  const per = nodes ? (s.links || 0) / nodes : 0;
  setKpi('ovKLinks', s.links || 0, '', nodes ? `<b>${per.toFixed(1)}</b> per node` : 'No links yet');
  const reg = regions();
  const total = reg.reduce((a, r) => a + r[1], 0) || 1;
  setKpi(
    'ovKFolders',
    s.folders || 0,
    reg.length
      ? `<span class="ov-kpi-bar" title="${attr(reg.map(([f, n]) => `${f} ${n}`).join(', '))}">${reg
          .slice(0, 8)
          .map(([f, n]) => `<i style="flex:${n / total};background:${attr(regionColor(f))}"></i>`)
          .join('')}</span>`
      : '',
    reg.length ? `<b>${reg.length}</b> top-level ${reg.length === 1 ? 'region' : 'regions'}` : 'No folders yet',
  );
  paintAgentKpi();
}

function paintAgentKpi(): void {
  const rows = agentRows();
  const enabled = keys.filter((k) => k.enabled !== false).length;
  const active = rows.filter((r) => r.active).length;
  const agentTimes = feed.filter((x) => x.source === 'agent').map((x) => x.ts);
  const calls = agentTimes.length;
  // Until the key list arrives the count is unknown: show a placeholder, not 0
  // (the header pill may already say agents are working).
  setKpi(
    'ovKAgents',
    keysLoaded ? enabled : loaded ? NaN : null,
    miniBars(buckets(agentTimes, 24, 3600), 'Agent calls per hour, last 24 hours'),
    !loaded
      ? '&nbsp;'
      : !keysLoaded
        ? 'Could not load agents'
        : active
        ? `<span class="cc-dot ok"></span><b>${active}</b> active now`
        : calls
          ? `<b>${calls.toLocaleString()}</b> ${calls === 1 ? 'call' : 'calls'} in 24h`
          : enabled
            ? 'No calls in 24h'
            : 'None connected yet',
  );
}

// ---------------------------------------------------------------- vault

/** First run: what Memora is and the three things to do, until the first node exists. */
function paintWelcome(): void {
  const box = document.getElementById('ovWelcome');
  if (!box) return;
  const empty = !state.stats.notes && !allNotes().length;
  box.hidden = !empty;
  if (!empty || box.childElementCount) return;
  const step = (n: number, title: string, text: string, btn: string, id: string, primary = false): string =>
    `<li><span class="ov-wl-n">${n}</span><div><b>${title}</b><span>${text}</span></div>
      <button type="button" class="btn${primary ? ' primary' : ''} sm" id="${id}">${btn}</button></li>`;
  box.innerHTML = `<div class="ov-card-b"><div class="ov-wl-top">${markSvg('ov-wl-mark')}
      <div><div class="ov-wl-motto">${BRAND_MOTTO}</div><h2 id="ovWelcomeT">Welcome to Memora</h2></div></div>
    <p class="ov-wl-desc">${BRAND_DESC} ${BRAND_ONCE} <button type="button" class="ov-lnk" id="ovWlTour">Read the full welcome</button></p>
    <ol class="ov-wl-steps">
      ${step(1, 'Write your first node', 'A node is one Markdown note. Link notes with [[wikilinks]].', `${ICO.plus}New node`, 'ovWlNew', true)}
      ${step(2, 'Connect an agent', 'Give Claude, Cursor or any MCP app its own key so it can read and write here.', 'Agents & keys', 'ovWlKeys')}
      ${step(3, 'Watch it grow', 'Every node becomes a point in the brain; agent calls pulse through it live.', 'Open the brain', 'ovWlBrain')}
    </ol>
    <p class="ov-wl-name">${BRAND_NAME}</p></div>`;
  $('#ovWlNew').onclick = () => hooks.openNewNote();
  $('#ovWlKeys').onclick = () => hooks.go('keys');
  $('#ovWlBrain').onclick = () => hooks.go('brain');
  $('#ovWlTour').onclick = () => openWelcome();
}

function paintVault(): void {
  paintWelcome();
  paintSub();
  paintKpis();
  const box = document.getElementById('ovVault');
  if (!box) return;
  const v = state.health.vault || '';
  const notes = allNotes();
  const reg = regions();
  const max = reg[0]?.[1] || 1;
  const lastNote = notes.reduce<(typeof notes)[number] | null>((m, n) => ((n.mtime || 0) > (m?.mtime || 0) ? n : m), null);
  const by = lastNote ? writerOf(lastNote.path) : undefined;
  const location = `<div><div class="ov-cap">Location</div><div class="ov-row"><span class="ov-tile">${I.folder}</span>
      <span class="t">${v ? pathHTML(v) : '<span class="ov-name">Not configured</span>'}<span class="ov-sub">${
        v ? esc(plural(notes.length, 'Markdown file')) : 'Set MEMORA_VAULT to a folder of Markdown files'
      }</span></span>${
        v ? `<button type="button" class="cc-ibtn ov-copy" id="ovCopyPath" aria-label="Copy the vault path" title="Copy path">${ICO.copy}</button>` : ''
      }</div></div>`;
  // The author's avatar when an agent or person is known to have made it, else a clock.
  const kid = by && typeof by.raw.actor_id === 'string' ? by.raw.actor_id : null;
  const lead = by
    ? `<span title="${attr('by ' + by.actor)}" style="display:flex">${avatarHTML(by.actor, 32, '', kid)}</span>`
    : `<span class="ov-tile">${I.clock}</span>`;
  const lastChange = `<div><div class="ov-cap">Last change</div><div class="ov-row">${lead}<span class="t">${
    lastNote
      ? `<button type="button" class="ov-name" data-path="${attr(lastNote.path)}" title="${attr(lastNote.path)}">${esc(
          lastNote.name || noteName(lastNote.path),
        )}</button><span class="ov-sub" title="${attr(fmtTs(lastNote.mtime))}">${esc(relTs(lastNote.mtime))} · ${esc(lastNote.folder || 'Root')}</span>`
      : '<span class="ov-name">Nothing yet</span><span class="ov-sub">Changes to nodes show up here</span>'
  }</span></div></div>`;
  const folders = `<div><div class="ov-cap">Largest folders</div>${
    reg.length
      ? `<div class="ov-bars">${reg
          .slice(0, FOLDER_ROWS)
          .map(([f, n]) => {
            const c = attr(regionColor(f));
            return `<button type="button" class="ov-bar" data-folder="${attr(f)}" aria-label="${attr(`${f}: ${plural(n, 'node')}`)}">
              <span class="l"><span class="d" style="background:${c}"></span><span>${esc(f)}</span></span>
              <span class="tr"><i style="width:${Math.max(4, Math.round((n / max) * 100))}%;background:${c}"></i></span><span class="c">${n}</span></button>`;
          })
          .join('')}</div>${reg.length > FOLDER_ROWS ? `<div class="ov-more">+${plural(reg.length - FOLDER_ROWS, 'more folder')}</div>` : ''}`
      : '<div class="ov-sub">The vault is empty.</div>'
  }</div>`;
  box.innerHTML = `<div class="ov-facts"><div class="ov-pair">${location}${lastChange}</div>${folders}</div>`;
  box.querySelector<HTMLElement>('#ovCopyPath')?.addEventListener('click', () => void copyText(v, 'Vault path copied'));
  box.querySelectorAll<HTMLElement>('[data-path]').forEach((b) => (b.onclick = () => hooks.openNote(b.dataset.path!)));
  box.querySelectorAll<HTMLElement>('[data-folder]').forEach((b) => {
    // Opens the Nodes page on that folder.
    b.onclick = () => nav.selectFolder(b.dataset.folder === 'Root' ? '' : b.dataset.folder!);
  });
}

// ---------------------------------------------------------------- agents

/** Activity of one live key: by key id when the event has one, else by name. */
function itemsOf(k: KeyRow): ActivityItem[] {
  const name = k.name || k.id;
  return feed.filter((x) => {
    if (x.source !== 'agent') return false;
    const kid = typeof x.raw.actor_id === 'string' ? x.raw.actor_id : '';
    return kid ? kid === k.id : x.actor === name;
  });
}

interface AgentRow {
  k: KeyRow;
  items: ActivityItem[];
  last?: ActivityItem;
  active: boolean;
  since: number;
}

/** Live keys with their calls, active ones first, then by last call. */
function agentRows(): AgentRow[] {
  const now = Date.now() / 1000;
  const rows = keys.map((k) => {
    const items = itemsOf(k);
    const last = items[0];
    const since = last ? now - last.ts : Infinity;
    return { k, items, last, active: k.enabled !== false && since < ACTIVE_SECS, since };
  });
  return rows.sort((a, b) => Number(b.active) - Number(a.active) || a.since - b.since || (a.k.name || '').localeCompare(b.k.name || ''));
}

function paintAgents(): void {
  const box = document.getElementById('ovAgents');
  if (!box) return;
  paintAgentKpi();
  paintSub();
  paintConnect();
  const rows = agentRows();
  $('#ovAgN').textContent = rows.length ? String(rows.length) : '';
  let html: string;
  if (!loaded) html = rowsSkeleton(3);
  else if (!rows.length)
    html = emptyHTML(
      I.agent,
      'No agents yet',
      'Give each AI app its own key, or connect Claude or ChatGPT over OAuth.',
      `<button type="button" class="btn primary sm" id="ovNewKey">${ICO.plus}New agent</button>`,
    );
  else
    html =
      rows
        .slice(0, AGENT_ROWS)
        .map((r) => {
          const name = r.k.name || r.k.id;
          const off = r.k.enabled === false;
          const status = off
            ? '<span class="ov-st off">Disabled</span>'
            : r.active
              ? '<span class="ov-st on"><span class="cc-dot ok" style="box-shadow:none;width:7px;height:7px"></span>Active now</span>'
              : r.last
                ? `<span class="ov-st">Seen ${whenTag(r.last.ts)}</span>`
                : `<span class="ov-st">${oauth.has(r.k.id) ? 'Connected over OAuth' : 'No calls in 24h'}</span>`;
          const what = r.last ? `<span class="sep">·</span><span>${esc(verb(r.last.action))}${r.last.paths.length ? ' ' + esc(noteName(r.last.paths[0])) : ''}</span>` : '';
          const v = buckets(
            r.items.map((x) => x.ts),
            30,
            60,
          );
          const n30 = v.reduce((a, b) => a + b, 0);
          const sp = n30 ? `<span class="sp" title="${plural(n30, 'call')} in the last 30 minutes">${sparkSVG(v, 56, 24)}</span>` : '';
          return `<button type="button" class="ov-li" data-agent="${attr(name)}" style="--ag:${attr(agentColor(name, r.k.id))}">${avatarHTML(
            name,
            32,
            r.active ? 'live' : '',
            r.k.id,
          )}<span class="t"><span class="n"><span>${esc(name)}</span></span><span class="s">${status}${what}</span></span>${sp}
            <span class="m"><b>${r.items.length.toLocaleString()}</b>${r.items.length === 1 ? 'call' : 'calls'}</span></button>`;
        })
        .join('') +
      (rows.length > AGENT_ROWS
        ? `<div class="ov-foot"><button type="button" class="ov-lnk" data-more>+${plural(rows.length - AGENT_ROWS, 'more agent')}</button></div>`
        : '');
  if (!setHTML(box, html)) return;
  box.querySelector<HTMLElement>('#ovNewKey')?.addEventListener('click', newAgent);
  box.querySelector<HTMLElement>('[data-more]')?.addEventListener('click', () => hooks.go('keys'));
  box.querySelectorAll<HTMLElement>('[data-agent]').forEach((b) => {
    b.onclick = () => {
      try {
        sessionStorage.setItem('memora.activity.agent', b.dataset.agent!);
      } catch {
        /* optional */
      }
      hooks.go('logs');
    };
  });
}

// ---------------------------------------------------------------- recent changes

/** Who changed a node last: node change events, or agent calls that write. */
function writerOf(path: string): ActivityItem | undefined {
  return feed.find((it) => (it.source === 'vault' || (it.source === 'agent' && WRITES.test(it.action))) && it.paths.includes(path));
}

function paintRecent(): void {
  const rec = document.getElementById('ovRecent');
  if (!rec) return;
  const notes = allNotes()
    .filter((n) => n.mtime)
    .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
    .slice(0, LIST_ROWS);
  const html = notes.length
    ? notes
        .map((n) => {
          const it = writerOf(n.path);
          const kid = it && typeof it.raw.actor_id === 'string' ? it.raw.actor_id : null;
          const by = it ? `<span class="sep">·</span><span class="who">${avatarHTML(it.actor, 14, '', kid)}${esc(it.actor)}</span>` : '';
          return `<button type="button" class="ov-li" data-path="${attr(n.path)}" title="${attr(n.path)}"><span class="ov-tile fc" style="--fc:${attr(
            colorOfFolder(n.folder || ''),
          )}">${ICO.note}</span><span class="t"><span class="n"><span>${esc(n.name || noteName(n.path))}</span></span><span class="s"><span>${esc(
            n.folder || 'Root',
          )}</span>${by}</span></span><span class="m" title="${attr(fmtTs(n.mtime))}">${whenTag(n.mtime || 0)}</span></button>`;
        })
        .join('') + restHTML(notes.length, 'That is every node in the vault.')
    : emptyHTML(ICO.note, 'No changes yet', 'Nodes you or your agents write show up here, newest first.');
  if (!setHTML(rec, html)) return;
  rec.querySelectorAll<HTMLElement>('[data-path]').forEach((b) => (b.onclick = () => hooks.openNote(b.dataset.path!)));
}

// ---------------------------------------------------------------- activity

function paintActivity(): void {
  const host = document.getElementById('ovAct');
  if (!host) return;
  const live = new Set(keys.map((k) => k.id));
  const names = new Set(keys.map((k) => k.name || k.id));
  const now = Date.now() / 1000;
  // The newest calls and changes of the last 24 hours; older ones are in Activity.
  const list = feed.filter((x) => x.source !== 'auth' && now - x.ts < ACTIVITY_WINDOW).slice(0, LIST_ROWS);
  const html = !loaded
    ? rowsSkeleton(8)
    : list.length
      ? list
          .map((x) => {
            const kid = typeof x.raw.actor_id === 'string' ? x.raw.actor_id : '';
            // History from keys that no longer exist stays, marked as removed.
            const gone = x.source === 'agent' && (kid ? !live.has(kid) : !names.has(x.actor));
            const fresh = !!x.live && now - x.ts < 2;
            const p = x.paths[0];
            const label = x.label && !x.paths.includes(x.label) ? x.label : '';
            const what = p
              ? `<button type="button" class="nt" data-note="${attr(p)}" title="${attr(p)}">${esc(noteName(p))}</button>${
                  x.paths.length > 1 ? `<span class="sep">+${x.paths.length - 1}</span>` : ''
                }`
              : `<span>${esc(label || (x.source === 'agent' ? 'over MCP' : 'vault'))}</span>`;
            const st = settleRunning(x)
              ? '<span class="ov-st"><span class="cc-dot run"></span>running</span>'
              : x.ok === false
                ? '<span class="ov-st off">failed</span>'
                : `<span>${x.source === 'agent' ? 'mcp' : x.source}</span>`;
            return `<div class="ov-li${gone ? ' gone' : ''}${fresh ? ' new' : ''}" role="button" tabindex="0" data-act="${attr(x.id)}" style="--ag:${attr(
              agentColor(x.actor, kid || null),
            )}" aria-label="${attr(`${x.actor} ${verb(x.action)} ${p ? noteName(p) : label}`)}">${avatarHTML(x.actor, 32, x.running ? 'live' : '', kid || null)}
              <span class="t"><span class="n"><span class="ag-who">${esc(x.actor)}</span><span class="vb">${esc(verb(x.action))}</span>${
                gone ? '<span class="ov-tag">removed key</span>' : ''
              }</span><span class="s">${what}</span></span>
              <span class="m"><span title="${attr(fmtTs(x.ts))}">${whenTag(x.ts)}</span>${st}</span></div>`;
          })
          .join('') + restHTML(list.length, 'Nothing else in the last 24 hours.')
      : emptyHTML(I.pulse, 'Quiet for now', 'Nothing in the last 24 hours. Agent calls and node changes stream in here live.');
  setHTML(host, html);
}

// ---------------------------------------------------------------- health

function paintHealth(): void {
  const box = document.getElementById('ovHealth');
  if (!box) return;
  const h = state.health;
  const ok = h.ok !== false && !!h.server;
  const rt = conn || 'connecting';
  const cell = (dot: string, k: string, v: string): string =>
    `<div><span class="cc-dot ${dot}"></span><span class="t"><small>${esc(k)}</small><b title="${attr(v.replace(/<[^>]+>/g, ''))}">${v}</b></span></div>`;
  const vaultOk = h.vault_configured !== false;
  box.innerHTML =
    cell(ok ? 'ok' : 'err', 'Server', ok ? esc(h.version ? 'Online · v' + h.version : 'Online') : 'Unreachable') +
    cell(
      rt === 'on' ? 'ok' : rt === 'off' ? 'err' : 'run',
      'Realtime',
      rt === 'on' ? 'Live' + (presence ? ` · ${plural(presence, 'browser')}` : '') : rt === 'off' ? 'Offline' : 'Connecting',
    ) +
    cell(vaultOk ? 'ok' : 'err', 'Vault', vaultOk ? 'Ready' : 'Not configured') +
    cell(h.locked ? 'err' : h.armed ? 'run' : 'ok', 'Gateway', h.locked ? 'Locked' : h.armed ? 'Sign-in window open' : 'Normal');
  paintConnect();
  const bad = !ok || rt === 'off' || !vaultOk || h.locked;
  const pill = document.getElementById('ovHealthPill');
  if (pill)
    pill.innerHTML = bad
      ? '<span class="ov-pill err"><span class="cc-dot err"></span>Needs attention</span>'
      : rt !== 'on' || h.armed
        ? `<span class="ov-pill warn"><span class="cc-dot run"></span>${h.armed ? 'Sign-in window open' : 'Connecting'}</span>`
        : '<span class="ov-pill"><span class="cc-dot ok"></span>All systems normal</span>';
}

/** New agent: the Agents page with the connect flow open. */
function newAgent(): void {
  connectOnLoad();
  hooks.go('keys');
}

/** Agents card footer: where agents connect, with copy and a New agent shortcut. */
function paintConnect(): void {
  const box = document.getElementById('ovConnect');
  if (!box) return;
  const base = state.health.base_url;
  const mcp = base ? base.replace(/\/+$/, '') + '/mcp' : '';
  const html = `<span class="ov-tile">${ICO.plug}</span><span class="t"><small>MCP endpoint</small>${
    mcp ? `<span class="ov-path" title="${attr(mcp)}"><span class="h">${esc(mcp.replace(/^https?:\/\//, ''))}</span></span>` : '<span class="ov-sub">Not known yet</span>'
  }</span>${
    mcp ? `<button type="button" class="cc-ibtn ov-copy" data-copy-mcp aria-label="Copy the MCP endpoint" title="Copy endpoint">${ICO.copy}</button>` : ''
  }${loaded && keys.length ? `<button type="button" class="btn sm" data-new-agent aria-label="New agent" title="New agent">${ICO.plus}<span class="lbl">New agent</span></button>` : ''}`;
  if (!setHTML(box, html)) return;
  box.querySelector<HTMLElement>('[data-copy-mcp]')?.addEventListener('click', () => void copyText(mcp, 'MCP endpoint copied'));
  box.querySelector<HTMLElement>('[data-new-agent]')?.addEventListener('click', newAgent);
}
