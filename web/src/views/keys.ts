// Agents & API keys. An agent is one API key used by one app. The page answers
// what is connected, whether it is working and what it may do: a compact
// summary, then one row per agent (its app, status, access, calls and last
// call). A row opens the agent's sheet, which holds everything else: setup,
// permissions, rename, show key, new key, turn off and delete. Create,
// permissions, roll, rename, disable and delete keep the server contract of
// docs/contracts/tools-permissions.md.

import { apiGet, apiPost, updateKeyPermissions } from '../api';
import { $, $$, esc, attr, useStyles } from '../dom';
import { fmtTs } from '../format';
import { Modal } from '../modal';
import { state } from '../state';
import { toast } from '../toast';
import { agentColor, agentKey, avatarHTML, setAgentColors } from '../control/agents';
import { appOf, loadAgentApps, setAgentApp } from '../control/agent-apps';
import { loadKeys, onAgents } from '../realtime';
import { colorPickHTML, wireColorPick } from '../ui/color-pick';
import { skBlock } from '../ui/skeleton';
import { appById, appIconHTML, mcpUrl, mountConnectWizard, snippets, type ConnectKey, type Wizard } from '../control/connect';
import { loadFeed } from '../control/feed';
import {
  cachedCatalog,
  loadCatalog,
  permsHTML,
  SCOPES,
  scopesOf,
  summarize,
  toolsOf,
  wirePerms,
  type PermEditor,
  type Permissions,
} from '../control/perms';
import { ago, codeHTML, copyText, ICO, openMenu, openSheet, sparkSVG, systemHeader, useControlStyles, whileVisible, wireCopy, type Sheet } from '../control/ui';
import { createSelect } from '../ui/select';
import { useFormStyles } from '../ui/forms';
import type { KeyCreated, KeyRow, KeysResult } from '../types';
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

/** An agent counts as active when it made a call this recently (seconds). */
const ACTIVE_SECS = 300;

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

const svg = (d: string): string => `<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICO_EDIT = svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>');
const ICO_TRASH = svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>');
const ICO_POWER = svg('<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>');
const ICO_EYE = svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>');
const ICO_CHEV = svg('<path d="m9 6 6 6-6 6"/>');
const ICO_RESTORE = svg('<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>');

const KEYS_CSS = `
.ky{container:ky/inline-size}

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
.kr-hit{position:absolute;inset:0;z-index:0;width:100%;border-radius:0;cursor:pointer}
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
.sd{width:8px;height:8px;border-radius:50%;flex:none;background:var(--text-3)}
.sd.active{background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 22%,transparent)}
.sd.never{background:transparent;box-shadow:inset 0 0 0 1.5px var(--text-3)}
.sd.off{background:var(--danger)}
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
.ky-pop button{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px 0 6px;border-radius:99px;font-size:13px;font-weight:600;
  border:1px solid var(--line);background:var(--surface-0);color:var(--text-2)}
.ky-pop button:hover{border-color:var(--line-strong);color:var(--fg)}
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
  .kr{grid-template-columns:minmax(0,1fr) 130px 110px 36px;gap:14px}
  .kr-app,.kr-perm,.kr-seen{display:none}
  .kr-agent .kid{display:none}
  .kr-agent .sub2{display:block}
  .kr-st{align-items:flex-start}
  .kr-st .sd{margin-top:6px}
  .kr-st small{display:block}
}
/* phone: stacked cards */
@container ky (max-width:599px){
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

/* agent sheet */
.ad-hero{padding:16px;border-radius:14px;border:1px solid var(--line);background:var(--surface-2);margin:0 0 22px}
.ad-status{display:flex;align-items:center;gap:10px;min-width:0}
.ad-status .sd{width:10px;height:10px}
.ad-status b{font-size:15px;font-weight:680}
.ad-status span{font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ad-stats{display:grid;grid-template-columns:minmax(0,1.3fr) repeat(2,minmax(0,1fr));gap:14px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.ad-stats>div{min-width:0}
.ad-stats .k{display:block;font-size:11.5px;font-weight:600;color:var(--muted)}
.ad-stats .v{display:flex;align-items:center;gap:10px;margin-top:3px;font-size:17px;font-weight:700;font-variant-numeric:tabular-nums;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ad-stats .v.mono{font:600 13px/1.6 var(--mono)}
.ad-stats .sp{width:72px;height:22px;flex:none}
.ad-stats .sp .cc-spark{height:22px}
.ad-sec{margin:0 0 22px}
.ad-sec>h3{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px;font-size:12.5px;font-weight:650;color:var(--text-2)}
.ad-box{border:1px solid var(--line);border-radius:12px;background:var(--surface-0);min-width:0}
.ad-row{display:flex;align-items:center;gap:12px;padding:12px 14px;border-top:1px solid var(--line);min-width:0;min-height:56px}
.ad-row:first-child{border-top:0}
.ad-row .tx{flex:1;min-width:0}
.ad-row .tx b{display:block;font-size:13.5px;font-weight:620}
.ad-row .tx small{display:block;margin-top:1px;font-size:12px;color:var(--muted);line-height:1.45}
.ad-row code{font:500 12.5px var(--mono);color:var(--fg);word-break:break-all}
.ad-row .btn{height:34px;flex:none}
.ad-row .cc-ibtn{width:34px;height:34px;border:1px solid var(--line)}
.ad-app{display:flex;flex-direction:column;gap:8px}
.ad-app .ui-sel{height:48px;border-radius:12px}
.ad-app .ui-sel-v small{display:block;font-size:12px;color:var(--muted);line-height:1.3}
.ad-app .hint{font-size:12px;color:var(--muted);line-height:1.45}
.ad-perm{display:flex;align-items:flex-start;gap:12px;padding:14px}
.ad-perm .tx{flex:1;min-width:0}
.ad-perm b{display:block;font-size:14px;font-weight:650}
.ad-perm.warn b{color:var(--warn)}
.ad-perm.none b{color:var(--danger)}
.ad-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.ad-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:99px;font-size:11.5px;font-weight:620;
  color:var(--text-2);background:var(--surface-2);border:1px solid var(--line)}
.ad-chip.admin{color:var(--warn);background:var(--warn-soft);border-color:color-mix(in srgb,var(--warn) 40%,transparent)}
.ad-act{display:flex;align-items:center;gap:12px;width:100%;padding:11px 12px 11px 14px;border-top:1px solid var(--line);text-align:left;min-height:56px;
  color:var(--fg);transition:background .12s}
.ad-act:first-child{border-top:0;border-radius:12px 12px 0 0}
.ad-act:last-child{border-radius:0 0 12px 12px}
.ad-act:hover{background:var(--hover)}
.ad-act:focus-visible{border-radius:inherit;box-shadow:inset 0 0 0 2px var(--accent)}
.ad-act .ic{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;flex:none;color:var(--text-2);background:var(--surface-2);
  border:1px solid var(--line)}
.ad-act .tx{flex:1;min-width:0}
.ad-act b{display:block;font-size:13.5px;font-weight:620}
.ad-act small{display:block;margin-top:1px;font-size:12px;color:var(--muted);line-height:1.4}
.ad-act>.cc-i{color:var(--text-3)}
.ad-act.danger b,.ad-act.danger .ic{color:var(--danger)}
.ad-act.danger .ic{background:var(--danger-soft);border-color:color-mix(in srgb,var(--danger) 30%,transparent)}
.ad-link{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:620;color:var(--accent)}
.ad-link .cc-i{width:15px;height:15px}

/* small sheets */
.ky-prev{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;background:var(--surface-2);border:1px solid var(--line);margin:0 0 18px}
.ky-prev b{display:block;font-size:14.5px}
.ky-prev small{display:block;font-size:12px;color:var(--muted)}
.ky-secret{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:12px;margin:0 0 10px;font-size:12.5px;line-height:1.5;
  border:1px solid color-mix(in srgb,var(--warn) 45%,transparent);background:var(--warn-soft)}
.ky-secret .cc-i{color:var(--warn);margin-top:1px}
.ky-secret+.cc-code-wrap .cc-code,.ky-reveal .cc-code{white-space:pre-wrap;word-break:break-all}
@media (max-width:760px){
  .ad-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ad-stats>div:first-child{grid-column:1/-1}
}
`;

let keys: KeyRowFull[] = [];
/** Keys an AI app got by signing in over OAuth, with the app's client name. */
let oauthKeys = new Map<string, string>();
let usage = new Map<string, Usage>();
/** Bumped on every load so a slower, older load cannot paint over a newer one. */
let loadSeq = 0;
let loaded = false;

const nameOf = (k: { id: string; name?: string }): string => k.name || k.id;
const permsOf = (k: KeyRow): Permissions => ({ scopes: scopesOf(k), tools: toolsOf(k) });

function usageOf(k: KeyRow): Usage | undefined {
  return usage.get(agentKey(nameOf(k)));
}

function appFor(k: KeyRow): { id: string; label: string; guessed: boolean } {
  const a = appOf(k, oauthKeys.get(k.id));
  const s = a.id ? appById(a.id) : undefined;
  return { id: s ? a.id : '', label: s?.label || '', guessed: a.guessed };
}

type Status = 'active' | 'idle' | 'never' | 'off';

function statusOf(k: KeyRowFull, now = Date.now() / 1000): { st: Status; label: string; seen: string } {
  const u = usageOf(k);
  const seen = u ? (ago(u.last) === 'now' ? 'Just now' : ago(u.last) + ' ago') : k.uses ? 'Over a week ago' : 'Never';
  if (k.enabled === false) return { st: 'off', label: 'Off', seen };
  if (u && now - u.last < ACTIVE_SECS) return { st: 'active', label: 'Active', seen };
  if (u || k.uses) return { st: 'idle', label: 'Idle', seen };
  return { st: 'never', label: 'Never used', seen };
}

// ── page ────────────────────────────────────────────────────────────────

export async function renderKeys(): Promise<void> {
  useControlStyles();
  useFormStyles();
  useStyles('keys-css-3', KEYS_CSS);
  takeConnectHash();
  const host = $('#view-keys');
  loaded = false;
  host.innerHTML = `<div class="cc ky">
    ${systemHeader(
      'keys',
      'Agents & API keys',
      'Each agent is one API key used by one app. Its name is how it shows up in Activity, the brain and the graph.',
      `<button type="button" class="cc-ibtn" id="kReload" aria-label="Reload" title="Reload">${ICO.refresh}</button>
       <button type="button" class="btn primary" id="kNew">${ICO.plug}Connect an app</button>`,
    )}
    <div class="ky-sum" id="kStats" aria-live="polite">${statsHTML(null)}</div>
    <div class="ky-h"><h2>Agents</h2><span id="kCount"></span></div>
    <div class="kl" id="kList" aria-busy="true">${skeletonRows()}</div>
    <div id="kDel"></div></div>`;
  $('#kNew').onclick = () => void openConnect();
  $('#kReload').onclick = () => void load(true);
  wireCopy($('#kStats'));
  whileVisible(host, () => {
    let t = 0;
    const unsub = onAgents((_n, seen) => {
      // A call shows up at once: bump the agent's last call and repaint soon.
      let changed = false;
      for (const s of seen) {
        if (s.kind !== 'agent') continue;
        const k = keys.find((x) => (s.id ? x.id === s.id : agentKey(nameOf(x)) === agentKey(s.actor)));
        if (!k) continue;
        const key = agentKey(nameOf(k));
        const last = Math.floor(s.lastAt / 1000);
        const u = usage.get(key);
        if (!u) usage.set(key, { last, day: 0, spark: new Array(24).fill(0) });
        else if (last > u.last) u.last = last;
        else continue;
        changed = true;
      }
      if (changed && !t) t = window.setTimeout(() => ((t = 0), paint()), 800);
    });
    // Active turns Idle after five quiet minutes; keep the times honest.
    const tick = window.setInterval(() => paint(), 30000);
    return () => {
      unsub();
      clearTimeout(t);
      clearInterval(tick);
    };
  });
  await load();
}

function skeletonRows(): string {
  return Array.from(
    { length: 4 },
    () => `<div class="ky-sk">${skBlock('32px', 32)}<span style="flex:1">${skBlock('28%', 11)}</span><span style="flex:1">${skBlock('40%', 10)}</span></div>`,
  ).join('');
}

/** Fetch keys, OAuth connections, app choices, the catalog and the feed, then paint. */
async function load(reload = false): Promise<void> {
  const seq = ++loadSeq;
  const btn = document.getElementById('kReload');
  btn?.classList.add('spin');
  const cat = loadCatalog(reload || !cachedCatalog());
  const apps = loadAgentApps(reload);
  const feedP = loadFeed('7d', 1500).catch(() => []);
  try {
    const d = await apiGet<KeysResult | KeyRow[]>('/api/keys');
    keys = (Array.isArray(d) ? d : d.keys || []) as KeyRowFull[];
    setAgentColors(keys);
    const o = await apiGet<{ clients?: { client_id: string; name?: string; client_name?: string }[]; connections?: { key_id: string; client_id: string }[] }>(
      '/api/oauth/clients',
    ).catch(() => null);
    const names = new Map((o?.clients || []).map((c) => [c.client_id, c.name || c.client_name || '']));
    oauthKeys = new Map((o?.connections || []).map((c) => [c.key_id, names.get(c.client_id) || '']));
  } catch (e) {
    btn?.classList.remove('spin');
    if (seq !== loadSeq || !$('#kList')) return;
    $('#kStats').innerHTML = statsHTML(null);
    const list = $('#kList');
    list.removeAttribute('aria-busy');
    list.innerHTML = `<div class="ky-err"><b>Could not load the agents</b>${esc((e as Error).message)}
      <div style="margin-top:14px"><button type="button" class="btn" id="kRetry">${ICO.refresh}Try again</button></div></div>`;
    $('#kRetry').onclick = () => void load(true);
    openFromHash();
    return;
  }
  await Promise.all([cat, apps]);
  const feed = await feedP;
  btn?.classList.remove('spin');
  if (seq !== loadSeq || !document.getElementById('kList')) return;

  // Usage per agent name: last call, calls in 24h and an hourly sparkline.
  const now = Date.now() / 1000;
  usage = new Map();
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
    }
  }
  loaded = true;
  paint();
  openFromHash();
}

function paint(): void {
  if (!loaded || !document.getElementById('kList')) return;
  $('#kStats').innerHTML = statsHTML(keys);
  wireCopy($('#kStats'));
  paintList();
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
  return [...keys].sort((a, b) => rank(a) - rank(b) || (usageOf(b)?.last || 0) - (usageOf(a)?.last || 0) || nameOf(a).localeCompare(nameOf(b)));
}

function paintList(): void {
  const list = $('#kList');
  list.removeAttribute('aria-busy');
  const on = keys.filter((k) => k.enabled !== false).length;
  $('#kCount').textContent = keys.length ? `${keys.length} · ${on === keys.length ? 'all turned on' : `${keys.length - on} turned off`}` : '';
  if (!keys.length) {
    const pop = ['claude-code', 'cursor', 'claude-ai', 'chatgpt', 'codex']
      .map((id) => appById(id))
      .filter(Boolean)
      .map((s) => `<button type="button" data-pop="${attr(s!.id)}">${appIconHTML(s!.label, 26)}${esc(s!.label)}</button>`)
      .join('');
    list.innerHTML = `<div class="ky-empty"><span class="ic">${ICO.plug}</span><h3>No agents yet</h3>
      <p>Connect an app to give it a memory. Each app gets its own agent and key, so you can see what it does and turn it off on its own.</p>
      <button type="button" class="btn primary" data-a="new">${ICO.plug}Connect an app</button><div class="ky-pop" aria-label="Popular apps">${pop}</div></div>`;
    $('[data-a=new]', list).onclick = () => void openConnect();
    $$<HTMLElement>('[data-pop]', list).forEach((b) => (b.onclick = () => void openConnect({ client: b.dataset.pop })));
    return;
  }
  const now = Date.now() / 1000;
  list.innerHTML = `<div class="kl-head" aria-hidden="true"><span>Agent</span><span>App</span><span>Status</span><span>Access</span><span>Calls 24h</span><span>Last call</span><span></span></div>
    <ul aria-label="Agents">${sorted()
      .map((k) => rowHTML(k, now))
      .join('')}</ul>`;
  $$<HTMLElement>('[data-open]', list).forEach((b) => (b.onclick = () => openAgent(b.dataset.open!)));
  $$<HTMLElement>('[data-more]', list).forEach(
    (b) =>
      (b.onclick = (e) => {
        e.stopPropagation();
        const k = keys.find((x) => x.id === b.dataset.more);
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
  const signed = oauthKeys.has(k.id) ? '<span class="tag">Signed in</span>' : '';
  const day = u ? u.day : 0;
  return `<li class="kr${s.st === 'off' ? ' off' : ''}" style="--ag:${agentColor(name, k.id)}">
    <button type="button" class="kr-hit" data-open="${attr(k.id)}" aria-label="${attr(`${name}: ${s.label}, ${app.label || 'app not set'}, ${p.level}`)}"></button>
    <div class="kr-agent">${avatarHTML(name, 34, '', k.id)}<span class="t"><b>${esc(name)}${signed}</b><span class="kid">${esc(k.id)}</span>
      <span class="sub2">${esc(app.label || 'App not set')} · ${esc(p.level)}</span></span></div>
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
  $$<HTMLElement>('[data-restore]', box).forEach(
    (b) =>
      (b.onclick = async () => {
        const id = b.dataset.restore!;
        try {
          await apiPost<KeyCreated>(KEY_PATHS.restore, { id });
          state.keysDeleted = state.keysDeleted.filter((k) => k.id !== id);
          toast('Agent restored', 'ok');
          void load();
        } catch (e) {
          toast('Could not restore: ' + (e as Error).message, 'err');
        }
      }),
  );
}

function agentMenu(anchor: HTMLElement, k: KeyRowFull): void {
  const name = nameOf(k);
  const off = k.enabled === false;
  openMenu(
    anchor,
    [
      { label: 'Open', desc: 'Status, key, permissions and every action.', icon: ICO_CHEV, run: () => openAgent(k.id) },
      { label: setupLabel(k), desc: 'Setup steps for its app, with its key filled in.', icon: ICO.plug, run: () => void openSetup(k) },
      { label: 'Edit permissions', desc: 'What it may do and which tools it may call.', icon: ICO.shield, run: () => void openKeyPermissions(k) },
      { label: 'View activity', desc: 'Everything this agent did.', icon: icon('activity'), run: () => goActivity(k) },
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

function goActivity(k: KeyRow): void {
  // Its own address; the router reads it and the Activity page opens its card.
  history.pushState(null, '', '/activity/' + encodeURIComponent(k.id));
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const setupLabel = (k: KeyRowFull): string => (statusOf(k).st === 'never' ? 'Connect' : 'Set up again');

// ── agent sheet ─────────────────────────────────────────────────────────

function openAgent(id: string): void {
  const k = keys.find((x) => x.id === id);
  if (!k) return;
  const name = nameOf(k);
  const s = statusOf(k);
  const u = usageOf(k);
  const app = appFor(k);
  const perms = permsOf(k);
  const p = summarize(perms);
  const off = k.enabled === false;
  const signed = oauthKeys.has(k.id);
  const statusLine =
    s.st === 'off'
      ? 'Turned off: its key is refused until you turn it back on'
      : s.st === 'never'
        ? 'No calls yet: set up its app to connect it'
        : 'Last call ' + s.seen.toLowerCase();
  const chips = perms.scopes.length
    ? perms.scopes
        .map((sc) => {
          const d = SCOPES.find((x) => x.id === sc)!;
          return `<span class="ad-chip${sc === 'admin' ? ' admin' : ''}" title="${attr(d.label)}">${esc(d.short)}</span>`;
        })
        .join('')
    : '';
  const act = (a: string, ic: string, label: string, desc: string, danger = false): string =>
    `<button type="button" class="ad-act${danger ? ' danger' : ''}" data-act="${a}"><span class="ic">${ic}</span><span class="tx"><b>${esc(label)}</b><small>${esc(
      desc,
    )}</small></span>${ICO_CHEV}</button>`;
  const body = `<div class="ad-hero" style="--ag:${agentColor(name, k.id)}"><div class="ad-status"><span class="sd ${s.st}" aria-hidden="true"></span><b>${s.label}</b><span>${esc(statusLine)}</span></div>
      <div class="ad-stats"><div><span class="k">Calls in 24h</span><span class="v">${u ? u.day : 0}${u && u.day ? `<span class="sp">${sparkSVG(u.spark, 72, 22)}</span>` : ''}</span></div>
        <div><span class="k">All time</span><span class="v">${k.uses || 0}</span></div>
        <div><span class="k">Last IP</span><span class="v mono" title="${attr(k.last_ip || '')}">${esc(k.last_ip || 'None yet')}</span></div></div></div>
    <section class="ad-sec"><h3><span id="adAppL">Used with</span></h3><div class="ad-app"><span id="adApp"></span>
      <span class="hint">${
        app.id && app.guessed ? 'Guessed from its name. Pick the app to remember it.' : app.id ? 'The setup steps follow this app.' : 'Pick the app so its setup steps are ready.'
      }</span></div></section>
    <section class="ad-sec"><h3>Access <button type="button" class="ad-link" data-act="perms">Edit ${ICO_CHEV}</button></h3>
      <div class="ad-box"><div class="ad-perm${p.tone ? ' ' + p.tone : ''}"><span class="tx"><b>${esc(p.level)} · ${esc(p.tools)}</b>${
        chips ? `<div class="ad-chips">${chips}${signed ? '<span class="ad-chip">Signed in over OAuth</span>' : ''}</div>` : ''
      }</span></div></div></section>
    <section class="ad-sec"><h3>Key</h3><div class="ad-box">
      <div class="ad-row"><span class="tx"><b>Key ID</b><code>${esc(k.id)}</code></span><button type="button" class="cc-ibtn" data-copy="${attr(
        k.id,
      )}" aria-label="Copy the key ID" title="Copy">${ICO.copy}</button></div>
      <div class="ad-row"><span class="tx"><b>${k.revealable ? 'Stored sealed' : signed ? 'Held by the app' : 'Shown once'}</b><small>${
        k.revealable
          ? 'Your password shows it again.'
          : signed
            ? 'The app signed in and holds its own token.'
            : 'It was shown when it was made. Make a new key to see one again.'
      }</small></span>${
        k.revealable ? `<button type="button" class="btn" data-act="reveal">${ICO_EYE}Show key</button>` : ''
      }</div>
      ${k.created ? `<div class="ad-row"><span class="tx"><b>Created</b><small>${esc(fmtTs(k.created))}</small></span></div>` : ''}
    </div></section>
    <section class="ad-sec"><h3>Activity <a class="ad-link" href="/activity/${attr(encodeURIComponent(k.id))}" data-act="activity">View activity ${ICO_CHEV}</a></h3></section>
    <section class="ad-sec"><h3>Manage</h3><div class="ad-box">
      ${act('rename', ICO_EDIT, 'Rename & colour', 'Change how it shows up everywhere.')}
      ${k.revealable ? act('reveal', ICO_EYE, 'Show key', 'See and copy its key again; asks for your password.') : ''}
      ${act('roll', ICO.key, 'Make a new key', 'The current key stops working at once.')}
      ${act('toggle', off ? ICO.check : ICO_POWER, off ? 'Turn on' : 'Turn off', off ? 'Let it connect again with the same key.' : 'Block it without deleting; turn back on any time.')}
      ${act('delete', ICO_TRASH, 'Delete', 'Remove the agent; its key stops working at once.', true)}
    </div></section>`;
  openSheet({
    title: name,
    sub: `${app.label || 'App not set'} · ${s.label}`,
    lead: avatarHTML(name, 40, '', k.id),
    width: 600,
    full: true,
    body,
    actions: [
      { label: 'Edit permissions', icon: ICO.shield, left: true, run: () => void openKeyPermissions(k, true) },
      { label: setupLabel(k), cls: 'primary', icon: ICO.plug, run: () => void openSetup(k, { back: true }) },
    ],
    onOpen: (sh) => {
      const sel = createSelect({
        label: 'App',
        labelledBy: 'adAppL',
        className: 'block',
        value: app.id,
        searchable: true,
        placeholder: 'Choose the app',
        options: snippets().map((c) => ({ value: c.id, label: c.label, hint: `${c.kind} · ${c.how}`, lead: appIconHTML(c.label, 26) })),
        render: (o) =>
          `${appIconHTML(o?.label, 28)}<span class="ui-sel-v${o ? '' : ' ph'}">${esc(o?.label || 'Choose the app')}${
            o ? `<small>${esc(o.hint || '')}</small>` : ''
          }</span><svg class="ui-sel-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>`,
        onChange: async (v) => {
          await setAgentApp(k.id, v);
          paint();
          const hint = sh.body.querySelector('.ad-app .hint');
          if (hint) hint.textContent = 'The setup steps follow this app.';
          const sub = sh.root.querySelector('.cc-sh-h p');
          if (sub) sub.textContent = `${appById(v)?.label || 'App not set'} · ${s.label}`;
          toast(`${name} is used with ${appById(v)?.label || 'that app'}`, 'ok', 1800);
        },
      });
      $('#adApp', sh.body).replaceWith(sel.el);
      $$<HTMLElement>('[data-act]', sh.body).forEach(
        (b) =>
          (b.onclick = (e) => {
            const a = b.dataset.act;
            if (a === 'activity') {
              e.preventDefault();
              sh.close();
              return goActivity(k);
            }
            if (a === 'perms') return void openKeyPermissions(k, true);
            if (a === 'rename') return openRename(k, true);
            if (a === 'reveal') return openReveal(k, true);
            if (a === 'roll') return rollKey(k);
            if (a === 'toggle') return void toggleKey(k, true);
            if (a === 'delete') return delKey(k, sh);
          }),
      );
    },
  });
}

/** Back to the agent's sheet, with fresh data. */
const backTo = (id: string) => (): void => openAgent(id);

// ── connect ─────────────────────────────────────────────────────────────

function connectKey(k: KeyRowFull): ConnectKey {
  return { id: k.id, name: nameOf(k), revealable: k.revealable, oauth: oauthKeys.has(k.id), perms: permsOf(k) };
}

async function createAgent(name: string, p: Permissions): Promise<{ key: ConnectKey; secret: string } | null> {
  try {
    const r = await apiPost<KeyCreated>(KEY_PATHS.create, { name, scopes: p.scopes, tools: p.tools });
    if (!r || !r.id || !r.key) throw new Error('the server returned no key');
    if (Array.isArray(p.tools)) {
      try {
        await updateKeyPermissions({ id: r.id, scopes: p.scopes, tools: p.tools });
      } catch (e) {
        toast('Agent created, but its tool list was not saved: ' + (e as Error).message, 'err', 6000);
      }
    }
    void load();
    return { key: { id: r.id, name: r.name || name, perms: p }, secret: r.key };
  } catch (e) {
    toast('Could not create the agent: ' + (e as Error).message, 'err');
    return null;
  }
}

/** Mount the wizard in a sheet; the footer's Back and Continue drive it. */
function wizardSheet(o: {
  title: string;
  sub: string;
  lead?: string;
  back?: () => void;
  mount: (host: HTMLElement, nav: (n: { back: boolean; next: string }) => void, setSub: (t: string) => void) => Wizard;
}): void {
  let wz: Wizard | null = null;
  openSheet({
    title: o.title,
    sub: o.sub,
    lead: o.lead,
    body: '<div id="kcWizard"></div>',
    width: 640,
    full: true,
    back: o.back,
    actions: [
      { label: 'Back', cls: 'ghost', left: true, run: () => wz?.back() },
      { label: 'Continue', cls: 'primary', run: async (s) => void ((await wz?.next()) && s.close()) },
    ],
    onClose: () => wz?.destroy(),
    onOpen: (s) => {
      s.root.classList.add('cn-sheet');
      const [back, next] = Array.from(s.foot?.querySelectorAll<HTMLButtonElement>('.btn') || []);
      const sub = s.root.querySelector<HTMLElement>('.cc-sh-h p');
      wz = o.mount(
        $('#kcWizard', s.body),
        (n) => {
          if (back) back.style.visibility = n.back ? '' : 'hidden';
          if (next) next.textContent = n.next;
        },
        (t) => {
          if (sub) sub.textContent = t;
        },
      );
    },
  });
}

/** "Connect an app": pick the app, name the agent, make its key, set it up. */
async function openConnect(o: { client?: string } = {}): Promise<void> {
  await loadCatalog();
  wizardSheet({
    title: 'Connect an app',
    sub: 'Pick an app',
    mount: (host, setNav, setSub) =>
      mountConnectWizard(host, {
        client: o.client,
        names: keys.map(nameOf),
        createAgent,
        onAppChosen: (id, c) => void setAgentApp(id, c).then(paint),
        onChange: () => void load(),
        setNav,
        setSub,
      }),
  });
}

/** Set up one agent: straight to its app's setup with its key. */
async function openSetup(k: KeyRowFull, o: { secret?: string; fresh?: boolean; back?: boolean; pickApp?: boolean } = {}): Promise<void> {
  await loadAgentApps();
  const name = nameOf(k);
  const app = appFor(k);
  wizardSheet({
    title: (statusOf(k).st === 'never' ? 'Connect ' : 'Set up ') + name,
    sub: app.label || 'Pick its app',
    lead: avatarHTML(name, 36, '', k.id),
    back: o.back ? backTo(k.id) : undefined,
    mount: (host, setNav, setSub) =>
      mountConnectWizard(host, {
        agent: connectKey(k),
        client: app.id,
        secret: o.secret,
        fresh: o.fresh,
        pickApp: o.pickApp,
        createAgent,
        onAppChosen: (id, c) => void setAgentApp(id, c).then(paint),
        onChange: () => void load(),
        setNav,
        setSub,
      }),
  });
}

// `/agents#connect` opens the connect flow; `#connect=<client>` preselects an app.
// The router rewrites the address before the agents load, so the hash is read
// as early as possible: when this module loads and when the page starts to render.
const CONNECT_HASH = /^#connect(?:=([\w-]+))?$/;
const bootHash = /^\/(agents|keys)\/?$/.test(location.pathname) ? CONNECT_HASH.exec(location.hash) : null;
let pendingConnect: string | null = bootHash ? bootHash[1] || '' : null;

/** Open the connect flow once the Agents page has loaded (for links from other pages). */
export function connectOnLoad(client = ''): void {
  pendingConnect = client;
}

function takeConnectHash(): void {
  const m = CONNECT_HASH.exec(location.hash);
  if (!m) return;
  pendingConnect = m[1] || '';
  history.replaceState(history.state, '', location.pathname + location.search);
}

function openFromHash(): void {
  if (pendingConnect === null) return;
  const id = pendingConnect;
  pendingConnect = null;
  void openConnect({ client: id && appById(id) ? id : undefined });
}

// A hash set while the app runs also fires popstate, and the router rewrites the
// address in its own handler, so take the hash first and open once it settles.
const onConnectHash = (): void => {
  if (!CONNECT_HASH.test(location.hash) || !/^\/(agents|keys)\/?$/.test(location.pathname)) return;
  takeConnectHash();
  setTimeout(() => {
    if (document.querySelector('#view-keys:not(.hidden) #kList[aria-busy]')) return; // the load opens it
    if (document.querySelector('#view-keys:not(.hidden) #kList')) openFromHash();
  }, 0);
};
window.addEventListener('popstate', onConnectHash);
window.addEventListener('hashchange', onConnectHash);

/** The one-time secret, with a way into the setup that already holds it. */
function showSecret(title: string, k: KeyRowFull, secret: string): void {
  const name = nameOf(k);
  const has = !!secret && secret !== '-';
  openSheet({
    title,
    sub: name,
    lead: avatarHTML(name, 36, '', k.id),
    width: 600,
    body: `<section class="cc-sh-sec"><h3>Its new key</h3>
      <div class="ky-secret" role="note">${ICO.key}<span><b>This key is shown once. Copy it now and keep it private.</b> Anyone with this key can read and write your notes as ${esc(name)}.</span></div>
      ${codeHTML(has ? secret : 'The server did not return a key.', 'Copy key')}</section>
      ${
        has
          ? `<section class="cc-sh-sec"><h3>Update its app</h3><p>The old key stopped working. Open the setup with the new key already filled in.</p>
        <button type="button" class="btn primary" id="ksConnect">${ICO.plug}Set up with the new key</button></section>`
          : ''
      }`,
    actions: [
      { label: 'Copy key', icon: ICO.copy, left: true, run: () => void copyText(has ? secret : '', 'Key copied') },
      { label: 'Done', cls: 'primary', run: (s) => s.close() },
    ],
    onOpen: (s) => {
      const b = s.body.querySelector<HTMLButtonElement>('#ksConnect');
      if (b) b.onclick = () => void openSetup(k, { secret, fresh: true });
    },
  });
}

function openReveal(k: KeyRowFull, fromAgent = false): void {
  const name = nameOf(k);
  openSheet({
    title: 'Show key',
    sub: name,
    lead: avatarHTML(name, 36, '', k.id),
    width: 520,
    back: fromAgent ? backTo(k.id) : undefined,
    body: `<form id="krForm" class="ui-fld" style="margin:0"><label for="krPw">Your Memora password</label>
        <input id="krPw" class="ui-input" type="password" autocomplete="current-password">
        <span class="ui-help">The key is stored sealed on the server; your password unlocks it.</span></form>
      <div id="krOut" class="ky-reveal" style="margin-top:16px"></div>`,
    actions: [
      { label: fromAgent ? 'Back' : 'Close', cls: 'ghost', left: true, run: (s) => (fromAgent ? openAgent(k.id) : s.close()) },
      { label: 'Show key', cls: 'primary', icon: ICO_EYE, run: (s) => reveal(s) },
    ],
    onOpen: (s) => {
      ($('#krForm', s.body) as HTMLFormElement).onsubmit = (e) => {
        e.preventDefault();
        void reveal(s);
      };
    },
  });
  async function reveal(s: Sheet): Promise<void> {
    const pw = $('#krPw', s.body) as HTMLInputElement;
    if (!pw.value) {
      toast('Enter your password', 'warn');
      pw.focus();
      return;
    }
    try {
      const r = await apiPost<{ key?: string }>(KEY_PATHS.reveal, { id: k.id, current: pw.value });
      if (!r || !r.key) throw new Error('the server returned no key');
      pw.value = '';
      const out = $('#krOut', s.body);
      out.innerHTML = codeHTML(r.key, 'Copy key');
      wireCopy(out);
    } catch (e) {
      toast((e as Error).message || 'Could not show the key', 'err');
    }
  }
}

// ── permissions ─────────────────────────────────────────────────────────

async function openKeyPermissions(k: KeyRowFull, fromAgent = false): Promise<void> {
  const tools = await loadCatalog();
  const name = nameOf(k);
  let ed: PermEditor | null = null;
  openSheet({
    title: 'Permissions',
    sub: name,
    lead: avatarHTML(name, 36, '', k.id),
    width: 620,
    full: true,
    back: fromAgent ? backTo(k.id) : undefined,
    body: permsHTML(permsOf(k), tools),
    actions: [
      { label: 'Cancel', cls: 'ghost', left: true, run: (s) => (fromAgent ? openAgent(k.id) : s.close()) },
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
            toast('Permissions saved for ' + name, 'ok');
            await load();
            if (fromAgent) openAgent(k.id);
            else s.close();
          } catch (e) {
            toast('Could not save permissions: ' + (e as Error).message, 'err', 5200);
          }
        },
      },
    ],
    onOpen: (s) => {
      ed = wirePerms(s.body, permsOf(k), tools);
    },
  });
}

// ── rename, roll, toggle, delete ────────────────────────────────────────

function previewHTML(name: string, color: string, sub: string): string {
  return `${avatarHTML(name || '?', 44).replace(/--ag:[^;]+;/, `--ag:${color};`)}<span><b>${esc(name || 'Agent')}</b><small>${esc(sub)}</small></span>`;
}

function openRename(k: KeyRowFull, fromAgent = false): void {
  const old = nameOf(k);
  openSheet({
    title: 'Rename & colour',
    sub: old,
    width: 520,
    back: fromAgent ? backTo(k.id) : undefined,
    body: `<div class="ky-prev" id="kPrev"></div>
      <div class="ui-fld"><label for="kN">Name</label><input id="kN" class="ui-input" type="text" autocomplete="off" spellcheck="false" maxlength="64" value="${attr(k.name || '')}">
        <span class="ui-help">Past activity keeps the old name; new activity uses this one.</span></div>
      <div class="ui-fld" style="margin-bottom:0"><span class="ui-lbl">Colour</span>${colorPickHTML('kColor', k.color || '', { auto: true })}
        <span class="ui-help">On its avatar, its sparks in the brain and every activity row.</span></div>`,
    actions: [
      { label: 'Cancel', cls: 'ghost', left: true, run: (s) => (fromAgent ? openAgent(k.id) : s.close()) },
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
            toast('Saved', 'ok');
            await loadKeys();
            await load();
            if (fromAgent) openAgent(k.id);
            else s.close();
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
        const picked = ($('#kColor', b) as HTMLElement).dataset.value;
        $('#kPrev', b).innerHTML = previewHTML(n, picked || agentColor(n, null), picked ? 'Chosen colour' : 'Automatic colour from the name');
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
  const name = nameOf(k);
  Modal.confirm(
    'Make a new key',
    `${name}'s current key stops working at once. The new key is shown next; update the app that uses ${name}.`,
    'Make a new key',
    async () => {
      try {
        const r = await apiPost<KeyCreated>(KEY_PATHS.roll, { id: k.id });
        Modal.close();
        showSecret('New key made', k, (r && (r.key || r.secret)) || '-');
        void load();
      } catch (e) {
        toast('Could not make a new key: ' + (e as Error).message, 'err');
      }
    },
    false,
  );
}

async function toggleKey(k: KeyRowFull, reopen = false): Promise<void> {
  const on = k.enabled !== false;
  try {
    await apiPost(KEY_PATHS.toggle, { id: k.id, enabled: !on });
    toast(on ? `${nameOf(k)} is turned off` : `${nameOf(k)} is turned on`, 'ok');
    await load();
    if (reopen) openAgent(k.id);
  } catch (e) {
    toast('Failed: ' + (e as Error).message, 'err');
  }
}

function delKey(k: KeyRowFull, sheet?: Sheet): void {
  const name = nameOf(k);
  Modal.confirm(
    'Delete agent',
    `${name} will be deleted and its key stops working at once. You can restore it until you reload the app.`,
    'Delete agent',
    async () => {
      try {
        await apiPost(KEY_PATHS.del, { id: k.id });
        state.keysDeleted.push({ id: k.id, name: k.name });
        Modal.close();
        sheet?.close();
        toast(name + ' deleted', 'ok');
        void load();
      } catch (e) {
        toast('Failed: ' + (e as Error).message, 'err');
      }
    },
  );
}
