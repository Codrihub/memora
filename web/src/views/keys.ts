// Agents & API keys: every API key is an agent. Cards show who it is (name and
// avatar, the same identity as in the brain and in Activity), whether it is
// active, what it may do (scopes + tool access) and how it is used (calls,
// last IP). Permissions, connect guides, the new key and renames open in a
// sheet (side sheet on desktop, bottom sheet on phones). Create, permissions,
// roll, rename, disable and delete keep the server contract of
// docs/contracts/tools-permissions.md.

import { apiGet, apiPost, fetchTools, updateKeyPermissions } from '../api';
import { $, $$, esc, attr, useStyles } from '../dom';
import { fmtTs } from '../format';
import { Modal } from '../modal';
import { state } from '../state';
import { toast } from '../toast';
import { categoryDesc, categoryLabel, groupTools, riskChip, TOOL_ROW_CSS, toolMatches, toolRisk, toolTitle } from './tools';
import { agentColor, agentInitials, agentKey, avatarHTML, setAgentColors } from '../control/agents';
import { loadKeys } from '../realtime';
import { colorPickHTML, wireColorPick } from '../ui/color-pick';
import { cardsSkeleton, skBlock } from '../ui/skeleton';
import { mcpUrl, mountConnect, snippets } from '../control/connect';
import { loadFeed } from '../control/feed';
import { ago, codeHTML, copyText, ICO, openMenu, openSheet, sparkSVG, systemHeader, useControlStyles, wireCopy, type Sheet } from '../control/ui';
import type { KeyCreated, KeyRow, KeyScope, KeysResult, ToolAccess, ToolInfo } from '../types';
import { icon } from '../ui/icons';

const KEY_PATHS = {
  create: '/api/keys',
  roll: '/api/keys/roll',
  rename: '/api/keys/update',
  toggle: '/api/keys/update',
  del: '/api/keys/delete',
  restore: '/api/keys/restore',
  reveal: '/api/keys/reveal',
};

/** Everything except admin: the default for new keys and keys without scopes. */
const DEFAULT_SCOPES: KeyScope[] = ['mcp', 'read', 'write'];

const SCOPES: { id: KeyScope; label: string; short: string; hint: string }[] = [
  { id: 'mcp', label: 'Use MCP tools', short: 'MCP', hint: 'Connect over MCP and call the tools allowed below.' },
  { id: 'read', label: 'Read notes over the HTTP API', short: 'Read', hint: 'Plain HTTP requests that read notes, outside MCP.' },
  { id: 'write', label: 'Change notes over the HTTP API', short: 'Write', hint: 'Create, edit, move and delete notes with HTTP requests.' },
  {
    id: 'admin',
    label: 'Manage this server',
    short: 'Admin',
    hint: "Switch tools on or off for everyone and change any agent's key and permissions, its own included.",
  },
];

/** An agent counts as active when it made a call this recently (seconds). */
const ACTIVE_SECS = 300;

interface Permissions {
  scopes: KeyScope[];
  tools: ToolAccess;
}

interface KeyRowFull extends KeyRow {
  prefix?: string;
  created?: number;
  used_tools?: string[];
}

interface Usage {
  last: number;
  day: number;
  /** Calls per hour over the last 24 hours, oldest first. */
  spark: number[];
}

const ICO_EDIT = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>';
const ICO_TRASH =
  '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
const ICO_POWER = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/></svg>';
const ICO_EYE =
  '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>';
const ICO_CHEV = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

const KEYS_CSS = `
/* summary */
.ky2-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 18px}
.ky2-stat{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:var(--r-lg);background:var(--panel);border:1px solid var(--line);min-width:0}
.ky2-stat .tx{min-width:0;flex:1}
.ky2-stat .k{font-size:12.5px;font-weight:600;color:var(--muted)}
.ky2-stat .v{font-size:26px;font-weight:720;letter-spacing:-.5px;line-height:1.15;margin-top:2px;font-variant-numeric:tabular-nums}
.ky2-stat .h{font-size:12px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ky2-stat .sp{width:96px;flex:none}
.ky2-stat .sp .cc-spark{height:34px}
.ky2-stat .v .cc-dot{display:inline-block;vertical-align:middle;margin:-4px 0 0 8px}

/* tabs (tablet and phone) */
.ky2-tabs{display:none;gap:4px;padding:4px;margin:0 0 14px;border-radius:12px;background:var(--panel-2);border:1px solid var(--line)}
.ky2-tabs button{flex:1;min-height:40px;padding:0 12px;border-radius:9px;font-size:13.5px;font-weight:620;color:var(--muted);white-space:nowrap}
.ky2-tabs button[aria-selected=true]{background:var(--surface-1);color:var(--fg);box-shadow:0 1px 3px rgba(0,0,0,.18),inset 0 0 0 1px var(--line-strong)}
.ky2-tabs button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ky2-tabs .n{font-weight:600;color:var(--muted);margin-left:4px;font-variant-numeric:tabular-nums}

/* layout */
.ky2-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:18px;align-items:start}
.ky2-h{display:flex;align-items:baseline;gap:10px;margin:0 0 10px}
.ky2-h h2{margin:0;font-size:15px;font-weight:680}
.ky2-h span{font-size:12.5px;color:var(--muted)}
.ky2-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;align-items:stretch}

/* agent card */
.ky2{display:flex;flex-direction:column;gap:14px;padding:16px;border-radius:var(--r-lg);background:var(--panel);border:1px solid var(--line);
  min-width:0;transition:border-color .16s}
.ky2:hover{border-color:color-mix(in srgb,var(--ag,var(--accent)) 35%,var(--line))}
.ky2.off{background:color-mix(in srgb,var(--panel) 65%,var(--bg))}
.ky2.off .ag-av{filter:grayscale(1);opacity:.6}
.ky2-top{display:flex;align-items:center;gap:12px;min-width:0}
.ky2-id{flex:1;min-width:0}
.ky2-id h3{margin:0;font-size:15.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ky2-st{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden}
.ky2-st b{font-weight:620;color:var(--fg)}
.ky2-st .cc-dot.off{background:var(--danger)}
.ky2-st span{overflow:hidden;text-overflow:ellipsis}
.ky2-more{width:44px;height:44px;margin:-6px -8px -6px 0;border-radius:11px}
.ky2-chips{display:flex;flex-wrap:wrap;gap:6px}
.kp{display:inline-flex;align-items:center;gap:6px;height:24px;font-size:12px;font-weight:620;padding:0 9px;border-radius:99px;
  border:1px solid var(--line);background:var(--panel-2);color:var(--fg);white-space:nowrap}
.kp.admin{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent);background:var(--warn-soft)}
.kp.tools{color:var(--accent);border-color:var(--accent-line);background:var(--accent-soft)}
.kp.none{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 35%,transparent);background:var(--danger-soft)}
.kp.oauth{color:var(--muted)}
.ky2-use{display:grid;grid-template-columns:minmax(0,1.2fr) repeat(2,minmax(0,1fr));gap:12px;padding-top:13px;border-top:1px solid var(--line);margin-top:auto}
.ky2-use>div{min-width:0}
.ky2-use .k{display:block;font-size:11.5px;color:var(--muted);font-weight:600}
.ky2-use .v{display:block;font-size:13.5px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;margin-top:2px}
.ky2-sp{display:block;height:18px;margin-top:4px}
.ky2-sp .cc-spark{height:18px}
.ky2-acts{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ky2-acts .btn{height:38px;border-radius:10px}

/* connect panel */
.ky2-side{position:sticky;top:12px}
.ky2-conn .cc-card-h h2{font-size:14.5px;letter-spacing:0}
.ky2-url{padding:14px 16px;border-bottom:1px solid var(--line)}
.ky2-url .k{display:block;font-size:12.5px;font-weight:600;color:var(--muted);margin-bottom:6px}
.ky2-url .row{display:flex;align-items:center;gap:8px;min-width:0}
.ky2-url code{flex:1;min-width:0;font-family:var(--mono);font-size:12.5px;padding:9px 11px;border-radius:10px;background:var(--surface-0);
  border:1px solid var(--line);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ky2-url .cc-ibtn{width:40px;height:40px;border:1px solid var(--line)}
.ky2-url p{margin:8px 0 0;font-size:12px;color:var(--muted);line-height:1.5}
.ky2-clients{padding:6px}
.ky2-cl{display:flex;align-items:center;gap:12px;width:100%;min-height:52px;padding:8px 10px;border-radius:10px;text-align:left}
.ky2-cl:hover,.ky2-cl:focus-visible{background:var(--panel-2);outline:none}
.ky2-cl .tx{flex:1;min-width:0}
.ky2-cl b{display:block;font-size:13.5px;font-weight:620}
.ky2-cl small{display:block;font-size:12px;color:var(--muted);margin-top:1px}
.ky2-cl .cc-i{color:var(--muted)}
.ky2-cl .ini{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;flex:none;font-size:12px;font-weight:750;
  background:var(--panel-2);border:1px solid var(--line);color:var(--fg)}
.ky2-steps{margin:0;padding:12px 16px 14px;list-style:none;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:6px;
  font-size:12.5px;color:var(--muted)}
.ky2-steps li{display:flex;gap:9px;align-items:center}
.ky2-steps .n{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;flex:none;font-size:11px;font-weight:700;
  color:var(--accent);background:var(--accent-soft)}

/* deleted */
.ky2-del{margin-top:22px}
.ky2-del-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-top:1px solid var(--line);min-height:56px}
.ky2-del-row:first-child{border-top:0}
.ky2-del-row .tx{flex:1;min-width:0}
.ky2-del-row b{display:block;font-size:13.5px}
.ky2-del-row small{font-family:var(--mono);font-size:11.5px;color:var(--muted)}

/* sheets */
.ky2-prev{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;background:var(--panel-2);border:1px solid var(--line);margin:0 0 18px}
.ky2-prev b{display:block;font-size:14.5px}
.ky2-prev small{display:block;font-size:12px;color:var(--muted)}
.ky2-secret{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:12px;margin:0 0 10px;font-size:12.5px;line-height:1.5;
  border:1px solid color-mix(in srgb,var(--warn) 45%,transparent);background:var(--warn-soft)}
.ky2-secret .cc-i{color:var(--warn);margin-top:1px}
.ky2-secret+.cc-code-wrap .cc-code{white-space:pre-wrap;word-break:break-all}
.ky2-pick{display:flex;flex-direction:column;gap:6px;margin:0 0 16px}
.ky2-pick>span{font-size:12.5px;font-weight:600;color:var(--muted)}
.ky2-pick select{height:42px;border-radius:10px;border:1px solid var(--line-strong);background:var(--surface-0);color:var(--fg);padding:0 12px;font-size:14px}
.ky2-urlrow{display:flex;align-items:center;gap:8px;margin:0 0 16px;min-width:0}
.ky2-urlrow code{flex:1;min-width:0;font-family:var(--mono);font-size:12.5px;padding:9px 11px;border-radius:10px;background:var(--surface-0);
  border:1px solid var(--line);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ky2-urlrow .cc-ibtn{width:40px;height:40px;border:1px solid var(--line)}

/* permissions editor */
.pe2-row{display:flex;align-items:center;gap:14px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;min-width:0}
.pe2-row .tx{flex:1;min-width:0}
.pe2-row b{display:block;font-size:13.5px;font-weight:620}
.pe2-row small{display:block;font-size:12px;color:var(--muted);line-height:1.45;margin-top:2px}
.pe2-row.admin{border-color:color-mix(in srgb,var(--warn) 30%,var(--line))}
.pe2-warn{font-size:12.5px;line-height:1.5;padding:10px 12px;border-radius:10px;margin:0 0 8px;
  border:1px solid color-mix(in srgb,var(--warn) 45%,transparent);background:var(--warn-soft)}
.pe2-warn[hidden],.pe2-pick[hidden],.pe2-note[hidden],.pe2-box[hidden]{display:none}
.pe2-seg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 12px}
.pe2-opt{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border:1px solid var(--line);border-radius:12px;cursor:pointer;min-width:0}
.pe2-opt:has(input:checked){border-color:var(--accent-line);background:var(--accent-soft)}
.pe2-opt:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.pe2-opt:has(input:disabled){opacity:.5;cursor:not-allowed}
.pe2-opt input{flex:none;width:17px;height:17px;margin:1px 0 0;accent-color:var(--accent)}
.pe2-opt b{display:block;font-size:13.5px;font-weight:620}
.pe2-opt small{display:block;font-size:12px;color:var(--muted);line-height:1.4;margin-top:2px}
.pe2-note{font-size:12.5px;color:var(--muted);line-height:1.5;margin:0 0 10px}
.pe2-dim{opacity:.55}
.pe2-pick{border:1px solid var(--line);border-radius:12px;overflow:hidden;min-width:0}
.pe2-ph{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px;border-bottom:1px solid var(--line);background:var(--panel-2)}
.pe2-ph .cc-search{flex:1 1 180px;max-width:none;height:40px;background:var(--surface-1)}
.pe2-ph .btn{height:36px}
.pe2-cnt{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums;flex:1 1 100%}
.pe2-cnt b{color:var(--fg)}
.pe2-cat-h{display:flex;align-items:center;gap:12px;padding:10px 12px;background:color-mix(in srgb,var(--panel-2) 60%,transparent);border-top:1px solid var(--line)}
.pe2-cat:first-child .pe2-cat-h{border-top:0}
.pe2-cat-h .tx{flex:1;min-width:0}
.pe2-cat-h b{display:block;font-size:13px;font-weight:680}
.pe2-cat-h small{display:block;font-size:11.5px;color:var(--muted)}
.pe2-tool{display:flex;align-items:center;gap:12px;padding:10px 12px;border-top:1px solid var(--line);min-width:0}
.pe2-tool .tx{flex:1;min-width:0}
.pe2-tool .nm{font-size:13px;font-weight:600}
.pe2-tool .ds{font-size:12px;color:var(--muted);line-height:1.4;margin-top:1px}
.pe2-tool .mt{display:flex;align-items:center;gap:6px;margin-top:5px;min-width:0;flex-wrap:wrap}
.pe2-tool .offall{font-size:11px;font-weight:650;color:var(--danger)}
.pe2-empty{padding:18px 12px;text-align:center;color:var(--muted);font-size:12.5px}
.pe2-sum{font-size:12.5px;color:var(--muted);padding:10px 12px;border-radius:10px;background:var(--panel-2);border:1px solid var(--line);line-height:1.5}
.pe2-sum b{color:var(--fg)}
.pe2-box{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel-2)}
.pe2-box .tx{flex:1 1 200px;min-width:0;font-size:12.5px;color:var(--muted);line-height:1.5}
.pe2-box .tx b{color:var(--fg);display:block;font-size:13.5px;margin-bottom:4px}
.pe2-box .btn{height:38px}

@media (max-width:1100px){
  .ky2-stat{flex-direction:column;align-items:stretch;gap:6px}
  .ky2-stat .sp{width:100%}
  .ky2-stat .sp .cc-spark{height:22px}
  .ky2-tabs{display:flex}
  .ky2-layout{grid-template-columns:1fr}
  .ky2-layout>[data-pane]:not(.on){display:none}
  .ky2-side{position:static}
  .ky2-h{display:none}
}
@media (max-width:760px){
  .ky2-stats{gap:8px;margin-bottom:14px}
  .ky2-stat{padding:11px 12px;flex-direction:column;align-items:stretch;gap:4px}
  .ky2-stat .v{font-size:21px}
  .ky2-stat .h{display:none}
  .ky2-stat .sp{display:none}
  .ky2-grid{grid-template-columns:1fr;gap:10px}
  .ky2{padding:14px}
  .ky2-acts .btn{height:44px}
  .pe2-seg{grid-template-columns:1fr}
  .pe2-ph .btn{flex:1;height:40px}
  .pe2-ph .cc-search{flex-basis:100%;height:44px}
}
`;

let catalog: ToolInfo[] | null = null;

/** The tool catalog, cached for the session; null when the server has none. */
async function loadCatalog(force = false): Promise<ToolInfo[] | null> {
  if (catalog && !force) return catalog;
  try {
    catalog = await fetchTools();
  } catch {
    catalog = null;
  }
  return catalog;
}

function scopesOf(k: { scopes?: string[] }): KeyScope[] {
  if (!k.scopes) return [...DEFAULT_SCOPES];
  return SCOPES.map((s) => s.id).filter((id) => k.scopes!.includes(id));
}

function toolsOf(k: { tools?: ToolAccess }): ToolAccess {
  return Array.isArray(k.tools) ? k.tools : '*';
}

function toolSummary(tools: ToolAccess, scopes: KeyScope[], total: number | null): { text: string; cls: string } {
  if (!scopes.includes('mcp')) return { text: 'No MCP access', cls: 'none' };
  if (tools === '*') return { text: total ? `All ${total} tools` : 'All tools', cls: 'tools' };
  if (!tools.length) return { text: 'No tools', cls: 'none' };
  return {
    text: total ? `${tools.length} of ${total} tools` : `${tools.length} tool${tools.length === 1 ? '' : 's'}`,
    cls: 'tools',
  };
}

function permPills(p: Permissions, total: number | null): string {
  const sum = toolSummary(p.tools, p.scopes, total);
  const scopes = p.scopes.length
    ? p.scopes
        .map((s) => {
          const def = SCOPES.find((x) => x.id === s)!;
          return `<span class="kp${s === 'admin' ? ' admin' : ''}" title="${attr(def.label)}">${esc(def.short)}</span>`;
        })
        .join('')
    : '<span class="kp none">Nothing allowed</span>';
  return `${scopes}<span class="kp ${sum.cls}">${esc(sum.text)}</span>`;
}

function scopeText(scopes: KeyScope[]): string {
  return scopes.length ? scopes.map((x) => SCOPES.find((d) => d.id === x)!.short).join(', ') : 'nothing';
}

let keys: KeyRowFull[] = [];
let oauthKeys = new Set<string>();
let usage = new Map<string, Usage>();
let pane: 'agents' | 'connect' = 'agents';
/** Bumped on every render so a slower, older load cannot paint over a newer one. */
let renderSeq = 0;

function usageOf(k: KeyRow): Usage | undefined {
  return usage.get(agentKey(k.name || k.id));
}

export async function renderKeys(): Promise<void> {
  useControlStyles();
  useStyles('keys-css-2', KEYS_CSS + TOOL_ROW_CSS);
  const host = $('#view-keys');
  const seq = ++renderSeq;
  const tile = (k: string): string =>
    `<div class="ky2-stat"><div class="tx"><div class="k">${k}</div><div class="v">${skBlock('42px', 24)}</div><div class="h">${skBlock('70%', 9)}</div></div></div>`;
  host.innerHTML = `<div class="cc">
    ${systemHeader(
      'keys',
      'Agents & API keys',
      'Each agent connects over MCP with its own key; its name is how it shows up everywhere.',
      `<button type="button" class="btn primary" id="kNew">${ICO.plus}New agent</button>
       <button type="button" class="cc-ibtn" id="kReload" aria-label="Reload" title="Reload">${ICO.refresh}</button>`,
    )}
    <div class="ky2-stats" id="kStats" aria-live="polite">${tile('Agents')}${tile('Active now')}${tile('Calls in 24h')}</div>
    <div class="ky2-tabs" role="tablist" aria-label="Section">
      <button type="button" role="tab" id="kTabA" aria-controls="kPaneA" data-pane-t="agents" aria-selected="${pane === 'agents'}">Agents<span class="n" id="kTabN"></span></button>
      <button type="button" role="tab" id="kTabC" aria-controls="kPaneC" data-pane-t="connect" aria-selected="${pane === 'connect'}">Connect an app</button>
    </div>
    <div class="ky2-layout">
      <section class="ky2-main${pane === 'agents' ? ' on' : ''}" data-pane="agents" id="kPaneA" role="tabpanel" aria-labelledby="kTabA">
        <div class="ky2-h"><h2>Agents</h2><span id="kCount"></span></div>
        <div class="ky2-grid" id="kList" aria-busy="true">${cardsSkeleton(4, 'ky2')}</div>
        <div id="kDel"></div>
      </section>
      <aside class="ky2-side${pane === 'connect' ? ' on' : ''}" data-pane="connect" id="kPaneC" role="tabpanel" aria-labelledby="kTabC">
        ${connectPanel()}
      </aside>
    </div></div>`;
  $('#kNew').onclick = () => void openNewKey();
  $('#kReload').onclick = () => void renderKeys();
  $$<HTMLButtonElement>('[data-pane-t]', host).forEach((b, i, all) => {
    b.onclick = () => {
      pane = b.dataset.paneT as typeof pane;
      all.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      $$<HTMLElement>('[data-pane]', host).forEach((p) => p.classList.toggle('on', p.dataset.pane === pane));
    };
    b.onkeydown = (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const n = all[(i + 1) % all.length];
      n.click();
      n.focus();
    };
  });
  $$<HTMLElement>('[data-client]', host).forEach((b) => (b.onclick = () => openConnect({ tab: b.dataset.client })));
  wireCopy(host);

  const cat = loadCatalog(true);
  const feedP = loadFeed('7d', 1500).catch(() => []);
  try {
    const d = await apiGet<KeysResult | KeyRow[]>('/api/keys');
    keys = (Array.isArray(d) ? d : d.keys || []) as KeyRowFull[];
    setAgentColors(keys);
    // Keys an AI app got by signing in over OAuth.
    oauthKeys = new Set(
      ((await apiGet<{ connections?: { key_id: string }[] }>('/api/oauth/clients').catch(() => null))?.connections || []).map(
        (c) => c.key_id,
      ),
    );
  } catch (e) {
    if (seq !== renderSeq) return;
    $('#kStats').innerHTML = '';
    $('#kList').removeAttribute('aria-busy');
    $('#kList').innerHTML = `<div class="cc-card cc-empty" style="grid-column:1/-1"><b>Could not load the agents</b>${esc((e as Error).message)}
      <div style="margin-top:12px"><button type="button" class="btn" id="kRetry">${ICO.refresh}Try again</button></div></div>`;
    $('#kRetry').onclick = () => void renderKeys();
    return;
  }
  const total = (await cat)?.length || null;
  const feed = await feedP;
  if (seq !== renderSeq || !document.body.contains(host) || !host.querySelector('#kList')) return;

  // Usage per agent name: last call, calls in 24h and an hourly sparkline.
  const now = Date.now() / 1000;
  usage = new Map();
  const all24 = new Array(24).fill(0);
  for (const it of feed) {
    if (it.source !== 'agent') continue;
    const k = agentKey(it.actor);
    let u = usage.get(k);
    if (!u) usage.set(k, (u = { last: it.ts, day: 0, spark: new Array(24).fill(0) }));
    if (it.ts > u.last) u.last = it.ts;
    const h = Math.floor((now - it.ts) / 3600);
    if (h >= 0 && h < 24) {
      u.day++;
      u.spark[23 - h]++;
      all24[23 - h]++;
    }
  }
  const on = keys.filter((k) => k.enabled !== false);
  const active = on.filter((k) => {
    const u = usageOf(k);
    return u && now - u.last < ACTIVE_SECS;
  }).length;
  const day = all24.reduce((a, b) => a + b, 0);
  const off = keys.length - on.length;
  $('#kStats').innerHTML = `
    <div class="ky2-stat"><div class="tx"><div class="k">Agents</div><div class="v">${keys.length}</div><div class="h">${
      off ? `${off} turned off` : keys.length ? 'All turned on' : 'None yet'
    }</div></div></div>
    <div class="ky2-stat"><div class="tx"><div class="k">Active now</div><div class="v">${active}${active ? '<span class="cc-dot ok"></span>' : ''}</div><div class="h">Called in the last 5 minutes</div></div></div>
    <div class="ky2-stat"><div class="tx"><div class="k">Calls in 24h</div><div class="v">${day}</div><div class="h">Across all agents</div></div>${
      day ? `<div class="sp">${sparkSVG(all24, 96, 34)}</div>` : ''
    }</div>`;
  $('#kTabN').textContent = String(keys.length);
  $('#kCount').textContent = keys.length ? `${on.length} on, ${off} off` : '';

  const list = $('#kList');
  list.removeAttribute('aria-busy');
  list.innerHTML = keys.length
    ? keys.map((k) => keyCard(k, total, now)).join('')
    : `<div class="cc-card cc-empty" style="grid-column:1/-1;padding:34px 20px"><b>No agents yet</b>Make one agent per app (Claude Code, Cursor, Codex...) so each shows up under its own name.
        <div style="margin-top:14px"><button type="button" class="btn primary" data-a="new">${ICO.plus}New agent</button></div></div>`;

  $$<HTMLElement>('[data-a]', list).forEach(
    (b) =>
      (b.onclick = () => {
        const a = b.dataset.a!;
        if (a === 'new') return void openNewKey();
        const k = keys.find((x) => x.id === b.dataset.id);
        if (!k) return;
        if (a === 'perms') return void openKeyPermissions(k);
        if (a === 'connect') return openConnect({ agent: k });
        if (a === 'more') agentMenu(b, k);
      }),
  );
  paintDeleted();
}

function connectPanel(): string {
  const url = mcpUrl();
  return `<section class="cc-card ky2-conn" aria-labelledby="kConnT">
    <div class="cc-card-h"><h2 id="kConnT">Connect an app</h2></div>
    <div class="ky2-url"><span class="k">MCP endpoint</span>
      <div class="row"><code title="${attr(url)}">${esc(url)}</code>
      <button type="button" class="cc-ibtn" data-copy="${attr(url)}" aria-label="Copy the MCP endpoint" title="Copy">${ICO.copy}</button></div>
      <p>Every app connects to this address. Apps that sign in need nothing else; the rest also need an agent's key.</p></div>
    <ol class="ky2-steps"><li><span class="n">1</span>Make an agent for the app</li><li><span class="n">2</span>Pick the app below</li><li><span class="n">3</span>Follow the steps, paste and check</li></ol>
    <div class="ky2-clients">${snippets()
      .map(
        (s) => `<button type="button" class="ky2-cl" data-client="${attr(s.id)}"><span class="ini" aria-hidden="true">${esc(
          agentInitials(s.label),
        )}</span><span class="tx"><b>${esc(s.label)}</b><small>${esc(s.oauth ? 'Signs in, no key to paste' : s.id === 'http' ? 'Any MCP client, with a test' : 'Paste a config with a key')}</small></span>${ICO_CHEV}</button>`,
      )
      .join('')}</div></section>`;
}

function statusOf(k: KeyRowFull, now: number): { dot: string; text: string } {
  if (k.enabled === false) return { dot: 'off', text: '<b>Turned off</b><span>· cannot connect</span>' };
  const u = usageOf(k);
  if (u && now - u.last < ACTIVE_SECS) return { dot: 'ok', text: `<b>Active</b><span>· ${ago(u.last) === 'now' ? 'just now' : ago(u.last) + ' ago'}</span>` };
  if (u) return { dot: 'idle', text: `<b>Idle</b><span>· last seen ${ago(u.last)} ago</span>` };
  if (k.uses) return { dot: 'idle', text: '<b>Idle</b><span>· last seen over a week ago</span>' };
  return { dot: 'idle', text: '<b>Never used</b><span>· no calls yet</span>' };
}

function keyCard(k: KeyRowFull, total: number | null, now: number): string {
  const name = k.name || k.id;
  const off = k.enabled === false;
  const u = usageOf(k);
  const st = statusOf(k, now);
  return `<article class="ky2${off ? ' off' : ''}" style="--ag:${agentColor(name, k.id)}" aria-label="${attr(name)}">
    <div class="ky2-top">${avatarHTML(name, 44, '', k.id)}<div class="ky2-id"><h3 title="${attr(name + (k.created ? ' · created ' + fmtTs(k.created) : ''))}">${esc(name)}</h3>
      <div class="ky2-st"><span class="cc-dot ${st.dot}" aria-hidden="true"></span>${st.text}</div></div>
      <button type="button" class="cc-ibtn ky2-more" data-a="more" data-id="${attr(k.id)}" aria-haspopup="menu" aria-label="More for ${attr(name)}" title="More">${ICO.more}</button></div>
    <div class="ky2-chips" aria-label="Permissions">${permPills({ scopes: scopesOf(k), tools: toolsOf(k) }, total)}${
      oauthKeys.has(k.id) ? '<span class="kp oauth" title="Connected by signing in over OAuth">Signed in</span>' : ''
    }</div>
    <div class="ky2-use">
      <div><span class="k">Calls in 24h</span><span class="v">${u ? u.day : 0}</span><span class="ky2-sp">${u && u.day ? sparkSVG(u.spark, 100, 18) : ''}</span></div>
      <div><span class="k">All time</span><span class="v">${k.uses || 0}</span></div>
      <div><span class="k">Last IP</span><span class="v cc-mono" title="${attr(k.last_ip || '')}">${esc(k.last_ip || 'none yet')}</span></div>
    </div>
    <div class="ky2-acts">
      <button type="button" class="btn" data-a="perms" data-id="${attr(k.id)}" aria-label="Permissions for ${attr(name)}">${ICO.shield}Permissions</button>
      <button type="button" class="btn" data-a="connect" data-id="${attr(k.id)}" aria-label="Connect ${attr(name)}">${ICO.plug}Connect</button>
    </div>
  </article>`;
}

function agentMenu(anchor: HTMLElement, k: KeyRowFull): void {
  const name = k.name || k.id;
  const off = k.enabled === false;
  openMenu(
    anchor,
    [
      { label: 'Edit permissions', desc: 'What it may do and which tools it may call.', icon: ICO.shield, run: () => void openKeyPermissions(k) },
      { label: 'Connect an app', desc: 'Setup steps and config for each app.', icon: ICO.plug, run: () => openConnect({ agent: k }) },
      {
        label: 'Activity',
        desc: 'Everything this agent did, at /activity/' + k.id + '.',
        icon: icon('activity'),
        run: () => {
          // Its own address; the router reads it and the Activity page opens its card.
          history.pushState(null, '', '/activity/' + encodeURIComponent(k.id));
          window.dispatchEvent(new PopStateEvent('popstate'));
        },
      },
      { label: 'Rename', desc: 'Change its name and colour everywhere.', icon: ICO_EDIT, run: () => openRename(k) },
      ...(k.revealable
        ? [{ label: 'Show key', desc: 'See and copy its key again; asks for your password.', icon: ICO_EYE, run: () => openReveal(k) }]
        : []),
      { label: 'Make a new key', desc: 'The current key stops working at once.', icon: ICO.key, run: () => rollKey(k) },
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

function paintDeleted(): void {
  const box = $('#kDel');
  if (!state.keysDeleted.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<div class="ky2-del"><div class="ky2-h" style="display:flex"><h2>Deleted</h2><span>can be restored until you reload the app</span></div>
    <div class="cc-card">${state.keysDeleted
      .map(
        (k) => `<div class="ky2-del-row">${avatarHTML(k.name || k.id, 32)}<span class="tx"><b>${esc(k.name || k.id)}</b><small>${esc(k.id)}</small></span>
        <button type="button" class="btn" data-restore="${attr(k.id)}">Restore</button></div>`,
      )
      .join('')}</div></div>`;
  $$<HTMLElement>('[data-restore]', box).forEach(
    (b) =>
      (b.onclick = async () => {
        const id = b.dataset.restore!;
        try {
          await apiPost<KeyCreated>(KEY_PATHS.restore, { id });
          state.keysDeleted = state.keysDeleted.filter((k) => k.id !== id);
          toast('Agent restored', 'ok');
          void renderKeys();
        } catch (e) {
          toast('Could not restore: ' + (e as Error).message, 'err');
        }
      }),
  );
}

// ── connect ─────────────────────────────────────────────────────────────

/** Connect guides: for one agent, or for any app with an agent picker. */
function openConnect(o: { agent?: KeyRowFull; tab?: string }): void {
  const fixed = o.agent;
  const url = mcpUrl();
  const label = o.tab ? snippets().find((s) => s.id === o.tab)?.label : '';
  const choices = keys.filter((k) => k.enabled !== false);
  const body = `${
    fixed
      ? ''
      : `<label class="ky2-pick"><span>Which agent is this for?</span><select id="kcPick">
          <option value="">Choose later (shows a placeholder)</option>${choices
            .map((k) => `<option value="${attr(k.id)}">${esc(k.name || k.id)}</option>`)
            .join('')}</select></label>`
  }
    <div class="ky2-urlrow"><code title="${attr(url)}">${esc(url)}</code>
      <button type="button" class="cc-ibtn" data-copy="${attr(url)}" aria-label="Copy the MCP endpoint" title="Copy endpoint">${ICO.copy}</button></div>
    <div id="kcBody"></div>`;
  openSheet({
    title: fixed ? 'Connect ' + (fixed.name || fixed.id) : label ? 'Connect ' + label : 'Connect an app',
    sub: 'MCP over HTTP',
    lead: fixed ? avatarHTML(fixed.name || fixed.id, 36, '', fixed.id) : '',
    body,
    width: 620,
    actions: [{ label: 'Done', cls: 'primary', run: (s) => s.close() }],
    onOpen: (s) => {
      const mount = (k?: KeyRowFull): void =>
        mountConnect($('#kcBody', s.body), {
          tab: o.tab,
          key: k ? { id: k.id, name: k.name || k.id, revealable: k.revealable, oauth: oauthKeys.has(k.id) } : undefined,
          onSecret: () => void renderKeys(),
        });
      mount(fixed);
      const pick = s.body.querySelector<HTMLSelectElement>('#kcPick');
      if (pick) pick.onchange = () => mount(keys.find((k) => k.id === pick.value));
    },
  });
}

/** The one-time secret, with connect steps that already contain it. */
function showSecret(title: string, name: string, secret: string, id?: string, extra = ''): void {
  const has = !!secret && secret !== '-';
  openSheet({
    title,
    sub: name,
    lead: avatarHTML(name, 36, '', id),
    width: 620,
    body: `${extra}<section class="cc-sh-sec"><h3>Its key</h3>
      <div class="ky2-secret" role="note">${ICO.key}<span><b>Copy it now and keep it private.</b> Anyone with this key can read and write your notes as ${esc(name)}.</span></div>
      ${codeHTML(has ? secret : 'The server did not return a key.', 'Copy key')}</section>
      ${has ? `<section class="cc-sh-sec"><h3>Connect it</h3><p>Pick the app; the key is already filled in.</p><div class="ky2-urlrow"><code>${esc(mcpUrl())}</code>
        <button type="button" class="cc-ibtn" data-copy="${attr(mcpUrl())}" aria-label="Copy the MCP endpoint" title="Copy endpoint">${ICO.copy}</button></div><div id="ksConnect"></div></section>` : ''}`,
    actions: [
      { label: 'Copy key', icon: ICO.copy, left: true, run: () => void copyText(has ? secret : '', 'Key copied') },
      { label: 'Done', cls: 'primary', run: (s) => s.close() },
    ],
    onOpen: (s) => {
      if (has) mountConnect($('#ksConnect', s.body), { secret, tab: 'claude-code', hideKey: true });
    },
  });
}

function openReveal(k: KeyRowFull): void {
  const name = k.name || k.id;
  openSheet({
    title: 'Show key',
    sub: name,
    lead: avatarHTML(name, 36, '', k.id),
    width: 480,
    body: `<form id="krForm" class="field" style="margin:0"><label for="krPw">Your Memora password</label>
        <input id="krPw" type="password" autocomplete="current-password" style="height:44px">
        <span class="hint">The key is stored sealed on the server; your password unlocks it.</span></form>
      <div id="krOut" style="margin-top:16px"></div>`,
    actions: [
      { label: 'Close', cls: 'ghost', left: true, run: (s) => s.close() },
      { label: 'Show key', cls: 'primary', run: (s) => reveal(s) },
    ],
    onOpen: (s) => {
      ($('#krForm', s.body) as HTMLFormElement).onsubmit = (e) => {
        e.preventDefault();
        void reveal(s);
      };
    },
  });
  async function reveal(s: Sheet): Promise<void> {
    const pw = ($('#krPw', s.body) as HTMLInputElement).value;
    if (!pw) {
      toast('Enter your password', 'warn');
      return;
    }
    try {
      const r = await apiPost<{ key?: string }>(KEY_PATHS.reveal, { id: k.id, current: pw });
      if (!r || !r.key) throw new Error('the server returned no key');
      ($('#krPw', s.body) as HTMLInputElement).value = '';
      const out = $('#krOut', s.body);
      out.innerHTML = codeHTML(r.key, 'Copy key');
      wireCopy(out);
    } catch (e) {
      toast((e as Error).message || 'Could not show the key', 'err');
    }
  }
}

// ── permissions editor ──────────────────────────────────────────────────

interface PermEditor {
  read: () => Permissions;
  /** A reason the choice cannot be saved, or ''. */
  problem: () => string;
}

function permsHTML(initial: Permissions, tools: ToolInfo[] | null): string {
  const all = initial.tools === '*' || !tools;
  const selected = new Set<string>(Array.isArray(initial.tools) ? initial.tools : (tools || []).map((t) => t.name));
  const scopeRows = SCOPES.map(
    (s) => `<div class="pe2-row${s.id === 'admin' ? ' admin' : ''}"><span class="tx"><b id="pes-${s.id}">${esc(s.label)}</b><small id="pesd-${s.id}">${esc(
      s.hint,
    )}</small></span>
      <button type="button" class="cc-sw${s.id === 'admin' ? ' warn' : ''}" role="switch" data-scope="${s.id}" aria-checked="${initial.scopes.includes(
        s.id,
      )}" aria-labelledby="pes-${s.id}" aria-describedby="pesd-${s.id}"><i></i></button></div>${
      s.id === 'admin'
        ? '<div class="pe2-warn" id="peAdminWarn" role="alert" hidden><b>Careful:</b> with this on, the agent can turn tools back on, widen its own permissions and make or delete other agents. Only for automation you fully trust.</div>'
        : ''
    }`,
  ).join('');
  const pick = tools
    ? groupTools([...tools])
        .map(
          ([cat, items]) => `<div class="pe2-cat" data-cat="${attr(cat)}"><div class="pe2-cat-h"><span class="tx"><b>${esc(categoryLabel(cat))}</b><small data-cnt></small></span>
          <button type="button" class="cc-sw" role="switch" data-catall="${attr(cat)}" aria-label="All ${attr(categoryLabel(cat))} tools" title="${attr(
            categoryDesc(cat),
          )}"><i></i></button></div>
          ${items
            .map(
              (t) => `<div class="pe2-tool" data-tool="${attr(t.name)}"><span class="tx"><div class="nm" id="pet-${attr(t.name)}">${esc(toolTitle(t.name))}</div>${
                t.description ? `<div class="ds">${esc(t.description)}</div>` : ''
              }<div class="mt">${riskChip(toolRisk(t))}<code class="tl-code">${esc(t.name)}</code>${
                t.enabled ? '' : '<span class="offall" title="Switched off for every agent on the server">Off for every agent</span>'
              }</div></span>
              <button type="button" class="cc-sw" role="switch" data-t="${attr(t.name)}" aria-checked="${selected.has(t.name)}" aria-labelledby="pet-${attr(
                t.name,
              )}"><i></i></button></div>`,
            )
            .join('')}</div>`,
        )
        .join('')
    : '';
  return `<section class="cc-sh-sec"><h3>What it may do</h3><p>Turn on only what the app needs. You can change this any time.</p>${scopeRows}</section>
    <section class="cc-sh-sec" id="peTools"><h3>Which tools it may call</h3>
      <p class="pe2-note" id="peMcpNote"></p>
      <div class="pe2-seg" role="radiogroup" aria-label="Tool access">
        <label class="pe2-opt"><input type="radio" name="pe-mode" value="all"${all ? ' checked' : ''}><span><b>All tools</b><small>Every tool that is on for the server, including new ones.</small></span></label>
        <label class="pe2-opt"><input type="radio" name="pe-mode" value="some"${all ? '' : ' checked'}${tools ? '' : ' disabled'}><span><b>Only the ones I pick</b><small>${
          tools ? 'Tools added later stay blocked for this agent.' : 'The tool list could not be loaded right now.'
        }</small></span></label></div>
      <div class="pe2-pick" id="pePick"${all ? ' hidden' : ''}>
        <div class="pe2-ph"><label class="cc-search">${ICO.search}<span class="sr-only">Search tools</span>
          <input type="search" id="peQ" placeholder="Search tools" autocomplete="off"></label>
          <button type="button" class="btn" id="peAll">Pick all shown</button><button type="button" class="btn" id="peNone">Clear shown</button>
          <span class="pe2-cnt" id="peCount" aria-live="polite"></span></div>
        <div id="peList" role="group" aria-label="Tools">${pick}<div class="pe2-empty" id="peEmpty" hidden>No tool matches.</div></div>
      </div></section>
    <div class="pe2-sum" id="peSum" aria-live="polite"></div>`;
}

function wirePerms(b: HTMLElement, initial: Permissions, tools: ToolInfo[] | null): PermEditor {
  const selected = new Set<string>(Array.isArray(initial.tools) ? initial.tools : (tools || []).map((t) => t.name));
  const scopes = new Set<KeyScope>(initial.scopes);
  const read = (): Permissions => {
    const mode = ($('input[name=pe-mode]:checked', b) as HTMLInputElement).value;
    return {
      scopes: SCOPES.map((s) => s.id).filter((s) => scopes.has(s)),
      tools: mode === 'some' ? [...selected].filter((n) => !tools || tools.some((t) => t.name === n)).sort() : '*',
    };
  };
  const refresh = (): void => {
    const p = read();
    const mcp = p.scopes.includes('mcp');
    $$<HTMLElement>('[data-scope]', b).forEach((sw) => sw.setAttribute('aria-checked', String(scopes.has(sw.dataset.scope as KeyScope))));
    ($('#peAdminWarn', b) as HTMLElement).hidden = !scopes.has('admin');
    $('#peMcpNote', b).textContent = mcp
      ? 'A tool switched off for the whole server stays blocked, whatever you pick here.'
      : 'MCP is off above, so this only matters once you turn it on.';
    $('#peTools', b).classList.toggle('pe2-dim', !mcp);
    ($('#pePick', b) as HTMLElement).hidden = p.tools === '*';
    const total = tools ? tools.length : 0;
    $('#peCount', b).innerHTML = `<b>${selected.size}</b> of ${total} picked`;
    $$<HTMLElement>('[data-t]', b).forEach((sw) => sw.setAttribute('aria-checked', String(selected.has(sw.dataset.t!))));
    $$<HTMLElement>('[data-catall]', b).forEach((c) => {
      const names = (tools || []).filter((t) => (t.category || 'other') === c.dataset.catall).map((t) => t.name);
      const n = names.filter((x) => selected.has(x)).length;
      c.setAttribute('aria-checked', n === names.length && n > 0 ? 'true' : n ? 'mixed' : 'false');
      const cnt = c.parentElement!.querySelector('[data-cnt]');
      if (cnt) cnt.textContent = `${n} of ${names.length} picked`;
    });
    const s = toolSummary(p.tools, p.scopes, total || null);
    $('#peSum', b).innerHTML = p.scopes.length
      ? `This agent will be allowed <b>${esc(scopeText(p.scopes))}</b> with <b>${esc(s.text.toLowerCase())}</b>.`
      : '<b>Nothing is allowed.</b> Turn something on, or turn the agent off instead.';
  };
  $$<HTMLElement>('[data-scope]', b).forEach(
    (sw) =>
      (sw.onclick = () => {
        const id = sw.dataset.scope as KeyScope;
        if (scopes.has(id)) scopes.delete(id);
        else scopes.add(id);
        refresh();
      }),
  );
  $$<HTMLInputElement>('input[name=pe-mode]', b).forEach((i) => (i.onchange = () => refresh()));
  $$<HTMLElement>('[data-t]', b).forEach(
    (sw) =>
      (sw.onclick = () => {
        const n = sw.dataset.t!;
        if (selected.has(n)) selected.delete(n);
        else selected.add(n);
        refresh();
      }),
  );
  $$<HTMLElement>('[data-catall]', b).forEach(
    (c) =>
      (c.onclick = () => {
        const names = (tools || []).filter((t) => (t.category || 'other') === c.dataset.catall).map((t) => t.name);
        const on = c.getAttribute('aria-checked') !== 'true';
        names.forEach((n) => (on ? selected.add(n) : selected.delete(n)));
        refresh();
      }),
  );
  const bulk = (on: boolean): void => {
    $$<HTMLElement>('.pe2-tool', b)
      .filter((r) => !r.hidden && !(r.parentElement as HTMLElement).hidden)
      .forEach((r) => (on ? selected.add(r.dataset.tool!) : selected.delete(r.dataset.tool!)));
    refresh();
  };
  const all = b.querySelector<HTMLElement>('#peAll');
  if (all) all.onclick = () => bulk(true);
  const none = b.querySelector<HTMLElement>('#peNone');
  if (none) none.onclick = () => bulk(false);
  const q = b.querySelector<HTMLInputElement>('#peQ');
  if (q) {
    q.oninput = () => {
      const s = q.value.trim().toLowerCase();
      let any = false;
      $$<HTMLElement>('.pe2-cat', b).forEach((cat) => {
        let shown = 0;
        $$<HTMLElement>('.pe2-tool', cat).forEach((row) => {
          const t = (tools || []).find((x) => x.name === row.dataset.tool);
          const ok = !!t && toolMatches(t, s);
          row.hidden = !ok;
          if (ok) shown++;
        });
        cat.hidden = !shown;
        if (shown) any = true;
      });
      ($('#peEmpty', b) as HTMLElement).hidden = any;
    };
    q.onkeydown = (e) => {
      if (e.key === 'Enter') e.preventDefault();
    };
  }
  refresh();
  return {
    read,
    problem: () => {
      const p = read();
      if (!p.scopes.length) return 'Turn on at least one thing it may do, or turn the agent off instead.';
      if (Array.isArray(p.tools) && !p.tools.length && p.scopes.includes('mcp')) return 'Pick at least one tool, or choose All tools.';
      return '';
    },
  };
}

async function openKeyPermissions(k: KeyRowFull): Promise<void> {
  const tools = await loadCatalog();
  const name = k.name || k.id;
  let ed: PermEditor | null = null;
  openSheet({
    title: 'Permissions',
    sub: name,
    lead: avatarHTML(name, 36, '', k.id),
    width: 600,
    body: permsHTML({ scopes: scopesOf(k), tools: toolsOf(k) }, tools),
    actions: [
      { label: 'Cancel', cls: 'ghost', left: true, run: (s) => s.close() },
      {
        label: 'Save permissions',
        cls: 'primary',
        run: async (s) => {
          const why = ed!.problem();
          if (why) {
            toast(why, 'warn');
            return;
          }
          const p = ed!.read();
          try {
            await updateKeyPermissions({ id: k.id, scopes: p.scopes, tools: p.tools });
            s.close();
            toast('Permissions saved for ' + name, 'ok');
            void renderKeys();
          } catch (e) {
            toast('Could not save permissions: ' + (e as Error).message, 'err', 5200);
          }
        },
      },
    ],
    onOpen: (s) => {
      ed = wirePerms(s.body, { scopes: scopesOf(k), tools: toolsOf(k) }, tools);
    },
  });
}

// ── create, rename, roll, toggle, delete ────────────────────────────────

async function createKey(name: string, p: Permissions, color = ''): Promise<boolean> {
  try {
    const r = await apiPost<KeyCreated>(KEY_PATHS.create, { name, scopes: p.scopes, tools: p.tools, ...(color ? { color } : {}) });
    if (color) void loadKeys();
    if (r && r.id && Array.isArray(p.tools)) {
      try {
        await updateKeyPermissions({ id: r.id, scopes: p.scopes, tools: p.tools });
      } catch (e) {
        toast('Agent created, but its tool list was not saved: ' + (e as Error).message, 'err', 6000);
      }
    }
    void renderKeys();
    if (r && r.key) {
      showSecret(
        'Agent created',
        r.name || name,
        r.key,
        r.id,
        `<div class="ky2-chips" style="margin:-4px 0 18px">${permPills(p, catalog?.length || null)}</div>`,
      );
    } else {
      toast('Agent created', 'ok');
    }
    return true;
  } catch (e) {
    toast('Could not create the agent: ' + (e as Error).message, 'err');
    return false;
  }
}

function previewHTML(name: string, color: string, sub: string): string {
  return `<span class="ag-av" style="--ag:${color};width:44px;height:44px;font-size:16px">${esc(agentInitials(name || '?'))}</span><span><b>${esc(
    name || 'New agent',
  )}</b><small>${esc(sub)}</small></span>`;
}

async function openNewKey(): Promise<void> {
  const tools = await loadCatalog();
  const defaults: Permissions = { scopes: [...DEFAULT_SCOPES], tools: '*' };
  let ed: PermEditor | null = null;
  openSheet({
    title: 'New agent',
    sub: 'One agent per app, each with its own key',
    width: 600,
    body: `<div class="ky2-prev" id="kPrev"></div>
      <div class="field"><label for="kN">Name</label><input id="kN" type="text" autocomplete="off" spellcheck="false" placeholder="e.g. claude-code, cursor, codex" style="height:44px">
        <span class="hint">It shows up under this name in the brain, the graph and Activity.</span></div>
      <div class="field"><label>Colour</label>${colorPickHTML('kColor', '', { auto: true })}</div>
      <div class="field" style="margin-bottom:0"><label>Permissions</label>
        <div class="pe2-box" id="kPermBox"><span class="tx"><b>Everything except managing the server</b>MCP tools and reading and writing notes, with every tool.
          <span class="ky2-chips" style="margin-top:8px">${permPills(defaults, tools?.length || null)}</span></span>
          <button type="button" class="btn" id="kCustom">Customize</button></div>
        <div id="kPerms" hidden style="margin-top:16px"></div></div>`,
    actions: [
      { label: 'Cancel', cls: 'ghost', left: true, run: (s) => s.close() },
      {
        label: 'Create agent',
        cls: 'primary',
        run: async (s) => {
          const input = $('#kN', s.body) as HTMLInputElement;
          const name = input.value.trim();
          if (!name) {
            toast('Give the agent a name', 'warn');
            input.focus();
            return;
          }
          const p = ed ? ed.read() : defaults;
          const why = ed?.problem();
          if (why) {
            toast(why, 'warn');
            return;
          }
          if (await createKey(name, p, ($('#kColor', s.body) as HTMLElement).dataset.value || '')) s.close();
        },
      },
    ],
    onOpen: (s) => {
      const b = s.body;
      const input = $('#kN', b) as HTMLInputElement;
      const prev = (): void => {
        const n = input.value.trim();
        const c = ($('#kColor', b) as HTMLElement).dataset.value || agentColor(n);
        $('#kPrev', b).innerHTML = previewHTML(n, c, n ? 'Its colour follows it everywhere' : 'Type a name to see its avatar');
      };
      wireColorPick(b, 'kColor', prev);
      prev();
      input.oninput = prev;
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (s.foot?.querySelector('.btn.primary') as HTMLButtonElement | null)?.click();
        }
      };
      $('#kCustom', b).onclick = () => {
        const box = $('#kPerms', b);
        box.hidden = false;
        box.innerHTML = permsHTML(defaults, tools);
        ($('#kPermBox', b) as HTMLElement).hidden = true;
        ed = wirePerms(box, defaults, tools);
      };
    },
  });
}

function openRename(k: KeyRowFull): void {
  const old = k.name || k.id;
  openSheet({
    title: 'Rename',
    sub: old,
    width: 520,
    body: `<div class="ky2-prev" id="kPrev"></div>
      <div class="field"><label for="kN">Name</label><input id="kN" type="text" autocomplete="off" spellcheck="false" value="${attr(k.name || '')}" style="height:44px">
        <span class="hint">Past activity keeps the old name; new activity uses this one.</span></div>
      <div class="field" style="margin-bottom:0"><label>Colour</label>${colorPickHTML('kColor', k.color || '', { auto: true })}
        <span class="hint">On its avatar, its sparks in the brain and every activity row.</span></div>`,
    actions: [
      { label: 'Cancel', cls: 'ghost', left: true, run: (s) => s.close() },
      {
        label: 'Save',
        cls: 'primary',
        run: async (s) => {
          const name = ($('#kN', s.body) as HTMLInputElement).value.trim();
          const color = ($('#kColor', s.body) as HTMLElement).dataset.value || '';
          if (!name) {
            toast('The name cannot be empty', 'warn');
            return;
          }
          try {
            if (name !== (k.name || '')) await apiPost(KEY_PATHS.rename, { id: k.id, name });
            if (color !== (k.color || '')) await apiPost(KEY_PATHS.rename, { id: k.id, color });
            s.close();
            toast('Saved', 'ok');
            await loadKeys();
            void renderKeys();
          } catch (e) {
            toast('Could not save: ' + (e as Error).message, 'err');
          }
        },
      },
    ],
    onOpen: (s) => {
      const b = s.body;
      const input = $('#kN', b) as HTMLInputElement;
      const prev = (): void => {
        const n = input.value.trim() || old;
        const c = ($('#kColor', b) as HTMLElement).dataset.value || agentColor(n, null);
        $('#kPrev', b).innerHTML = previewHTML(n, c, ($('#kColor', b) as HTMLElement).dataset.value ? 'Chosen colour' : 'Automatic colour from the name');
      };
      wireColorPick(b, 'kColor', prev);
      input.oninput = prev;
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (s.foot?.querySelector('.btn.primary') as HTMLButtonElement | null)?.click();
        }
      };
      prev();
    },
  });
}

function rollKey(k: KeyRowFull): void {
  const name = k.name || k.id;
  Modal.confirm(
    'Make a new key',
    `${name}'s current key stops working at once. The new key is shown next; update the app that uses ${name}.`,
    'Make a new key',
    async () => {
      try {
        const r = await apiPost<KeyCreated>(KEY_PATHS.roll, { id: k.id });
        Modal.close();
        showSecret('New key made', name, (r && (r.key || r.secret)) || '-', k.id);
        void renderKeys();
      } catch (e) {
        toast('Could not make a new key: ' + (e as Error).message, 'err');
      }
    },
    false,
  );
}

async function toggleKey(k: KeyRowFull): Promise<void> {
  const on = k.enabled !== false;
  try {
    await apiPost(KEY_PATHS.toggle, { id: k.id, enabled: !on });
    toast(on ? `${k.name || k.id} is turned off` : `${k.name || k.id} is turned on`, 'ok');
    void renderKeys();
  } catch (e) {
    toast('Failed: ' + (e as Error).message, 'err');
  }
}

function delKey(k: KeyRowFull): void {
  const name = k.name || k.id;
  Modal.confirm(
    'Delete agent',
    `${name} will be deleted and its key stops working at once. You can restore it until you reload the app.`,
    'Delete agent',
    async () => {
      try {
        await apiPost(KEY_PATHS.del, { id: k.id });
        state.keysDeleted.push({ id: k.id, name: k.name });
        Modal.close();
        toast(name + ' deleted', 'ok');
        void renderKeys();
      } catch (e) {
        toast('Failed: ' + (e as Error).message, 'err');
      }
    },
  );
}
