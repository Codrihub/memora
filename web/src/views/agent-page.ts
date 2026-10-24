// One agent's own page, at /agents/<key id>[/<tab>]: a header and five tabs, each with its own address.
// An agent's app is picked once (a guess from its name holds until the first call) and then never changes.

import { apiPost, updateKeyPermissions } from '../api';
import { attr, esc, useStyles } from '../dom';
import { fmtTs, noteName } from '../format';
import { AGENT_TABS } from '../router';
import { state } from '../state';
import { toast } from '../toast';
import { agentColor, avatarHTML } from '../control/agents';
import { useActivityStyles, wireActRows } from '../control/activity';
import { plainText, predicate, problemOf } from '../control/sentence';
import { setAgentApp } from '../control/agent-apps';
import { appById, appIconHTML, mountConnectWizard, snippets, type ClientSnippet, type Wizard } from '../control/connect';
import { onLive, pushLive, type ActivityItem } from '../control/feed';
import { loadCatalog, permsHTML, SCOPES, summarize, wirePerms, type PermEditor } from '../control/perms';
import { ago, clock, ICO, openMenu, sparkSVG, whileVisible, wireCopy } from '../control/ui';
import { colorPickHTML, wireColorPick } from '../ui/color-pick';
import { skBlock } from '../ui/skeleton';
import { onAgents, loadKeys } from '../realtime';
import { agentActivityLive, fetchAgentEvents, leaveAgentActivity, mountAgentActivity } from './activity-agent';
import { hooks } from '../hooks';
import { setRouteAgent } from '../router';
import { icon } from '../ui/icons';
import { catOf, type Cat } from './activity-model';
import { CAT_COLOR } from './activity-views';
import {
  agentsHref,
  appFor,
  bumpSeen,
  connectKey,
  createAgent,
  data,
  delKey,
  freshSecrets,
  ICO_ACTIVITY,
  ICO_BACK,
  ICO_CHEV,
  ICO_EDIT,
  ICO_EYE,
  ICO_LOCK,
  ICO_POWER,
  ICO_RESTORE,
  ICO_TRASH,
  keyById,
  KEY_PATHS,
  loadAgents,
  nameOf,
  navAgents,
  onAgentsData,
  openReveal,
  permsOf,
  restoreKey,
  rollKey,
  statusOf,
  toggleKey,
  usageOf,
  wireAgentLinks,
  type KeyRowFull,
} from './agents-data';

type Tab = (typeof AGENT_TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', setup: 'Setup', activity: 'Activity', access: 'Access', settings: 'Settings' };
const TAB_ICON: Record<Tab, string> = { overview: 'overview', setup: 'tools', activity: 'activity', access: 'shield', settings: 'settings' };

/** The wizard's steps as a vertical rail (Setup tab, new-agent page), for wide containers. */
export const railCSS = (sc: string): string => `
${sc} .cn-prog-m{display:none!important}
${sc} .cn-prog ol{flex-direction:column;align-items:stretch;gap:0}
${sc} .cn-prog li,${sc} .cn-prog li:last-child,${sc} .cn-prog li.on,${sc} .cn-prog li:not(.on){flex:none;flex-direction:column;align-items:stretch}
${sc} .cn-prog li:not(:last-child)::after{flex:none;width:1.5px;height:16px;min-width:0;margin:2px 0 2px 19px;border-radius:1px}
${sc} .cn-prog li:not(.on) .l{display:inline}
${sc} .cn-prog button{width:100%;margin:0;padding:7px 10px 7px 7px;border-radius:10px;font-size:13.5px;font-weight:550}
${sc} .cn-prog button:not(:disabled):hover{background:var(--hover)}
${sc} .cn-prog .on button{background:var(--surface-1);box-shadow:inset 0 0 0 1px var(--line-strong)}
${sc} .cn-prog .n{width:26px;height:26px;border-radius:8px;font-size:12px}
${sc} .cn-prog .on .n{background:var(--fg);border-color:var(--fg);color:var(--surface-0)}
${sc} .cn-prog .done .n{background:var(--tile);border-color:transparent;color:var(--fg)}
`;

const CSS = `
.ap{container:ap/inline-size;--ap-pt:24px;--ap-pb:64px;--r14:14px;--tile:color-mix(in srgb,var(--fg) 5%,transparent);
  --tile-h:color-mix(in srgb,var(--fg) 8%,transparent)}
@media (min-width:1101px){.ap{padding:8px 8px 0}}
.ap a.btn{text-decoration:none}
.ap .ag-av,.an .ag-av{border-radius:30%}
.ap .ag-av.live::after{border-radius:34%}
.ap-crumb{display:flex;align-items:center;min-width:0;margin:0 0 12px}
.ap-back{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px 0 6px;margin-left:-6px;border-radius:8px;font-size:13.5px;font-weight:500;
  color:var(--muted);text-decoration:none}
.ap-back:hover{color:var(--fg);background:var(--hover);text-decoration:none}
.ap-back:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ap-back .cc-i{width:15px;height:15px}
.ap-head{display:flex;align-items:center;gap:18px;min-width:0;margin:0 0 22px}
.ap-head .ag-av{flex:none;font-weight:700;box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--ag) 55%,transparent)}
.ap-id{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.ap-id h1{margin:0;font-size:26px;font-weight:650;letter-spacing:-.02em;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;outline:none}
.ap-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px;font-size:13.5px;color:var(--muted);min-width:0}
.ap-app{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 10px 0 4px;border-radius:8px;border:1px solid var(--line);
  background:var(--surface-1);color:var(--fg);font-size:13px;font-weight:550;white-space:nowrap;max-width:100%}
.ap-app>span:not(.cn-app){overflow:hidden;text-overflow:ellipsis}
.ap-app .cc-i{width:13px;height:13px;color:var(--muted);margin-left:1px}
.ap-app.none{padding-left:10px;border:1px dashed var(--line-strong);background:none;color:var(--muted)}
.ap-st{display:inline-flex;align-items:center;gap:8px;white-space:nowrap;min-width:0}
.ap-st b{color:var(--fg);font-weight:550}
.ap-st.off b{color:var(--danger)}
.ap-acts{display:flex;align-items:center;gap:8px;flex:none}
.ap-acts .btn{height:40px;padding:0 16px;border-radius:10px;font-size:13.5px}
.ap-acts .btn:not(.primary){background:var(--surface-1);border-color:var(--line-strong)}
.ap-acts .btn:not(.primary):hover{background:var(--hover)}
.ap-acts .cc-ibtn{width:40px;height:40px;border:1px solid var(--line-strong);border-radius:10px;background:var(--surface-1)}

.ap-tabs{position:sticky;top:calc(-1 * var(--ap-pt));z-index:7;margin:0 0 20px;padding:calc(var(--ap-pt) - 4px) 0 10px;transition:background .15s}
.ap-tabs.stuck{background:var(--surface-0);border-bottom:1px solid var(--line)}
.ap-tabs-in{display:inline-flex;gap:2px;padding:3px;border-radius:12px;background:var(--seg-track);max-width:100%;overflow-x:auto;scrollbar-width:none}
.ap-tabs-in::-webkit-scrollbar{display:none}
.ap-tab{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:36px;padding:0 18px;font-size:14px;font-weight:550;
  color:var(--muted);white-space:nowrap;border-radius:9px;border:1px solid transparent;flex:none;transition:background .15s,color .15s}
.ap-tab:hover{color:var(--fg)}
.ap-tab .cc-i{width:16px;height:16px}
.ap-tab[aria-selected=true]{color:var(--fg);background:var(--seg-thumb);border-color:var(--line-strong)}
.ap-tab:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.ap-panel{outline:none;min-width:0}
.ap [hidden]{display:none!important}

.ap-ban{display:flex;align-items:center;gap:14px;padding:16px 18px;margin:0 0 20px;border-radius:var(--r14);font-size:13.5px;line-height:1.5;
  border:1px solid var(--line);background:var(--surface-1)}
.ap-ban .tx{flex:1;min-width:0}
.ap-ban b{display:block;font-size:14px;font-weight:600;color:var(--fg)}
.ap-ban small{display:block;color:var(--muted);font-size:13px}
.ap-ban .ic{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;flex:none;color:#5eead4;background:linear-gradient(180deg,#17202e,#0b0f17)}
.ap-ban .ic .cc-i{width:17px;height:17px}
.ap-ban.off .ic{color:var(--danger);background:var(--danger-soft)}
.ap-ban .btn{flex:none;height:38px;border-radius:10px}

.ap-stats{display:grid;grid-template-columns:minmax(0,1.4fr) repeat(2,minmax(0,1fr));margin:0 0 20px;background:var(--surface-1);border:1px solid var(--line);
  border-radius:var(--r14);overflow:hidden}
.ap-stat{display:flex;flex-direction:column;gap:6px;padding:20px 22px;min-width:0}
.ap-stat+.ap-stat{border-left:1px solid var(--line)}
.ap-stat .k{font-size:12.5px;font-weight:500;color:var(--muted);white-space:nowrap}
.ap-stat .v{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:400;letter-spacing:-.03em;line-height:1.2;font-variant-numeric:tabular-nums;
  min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-stat .v.sm{font-size:24px;letter-spacing:-.02em}
.ap-stat .v.mono{font:500 13.5px/1.75 var(--mono)}
.ap-stat .h{font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ap-stat .sp{flex:1;min-width:40px;max-width:140px;height:26px}
.ap-stat .sp .cc-spark{height:26px}
.ap-cols{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(290px,1fr);gap:20px;align-items:start}
.ap-side{display:flex;flex-direction:column;min-width:0;background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r14);overflow:hidden}
.ap-side>.ap-card{border:0;border-radius:0;background:none}
.ap-side>.ap-card+.ap-card{border-top:1px solid var(--line)}
.ap-card{background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r14);min-width:0}
.ap-card-h{display:flex;align-items:center;gap:10px;padding:18px 22px 6px;min-height:56px}
.ap-card-h h2{margin:0;font-size:15px;font-weight:600;flex:1;min-width:0}
.ap-card-h .sub{font-size:12.5px;color:var(--muted)}
.ap-card-b{padding:8px 22px 22px}
.ap-link{display:inline-flex;align-items:center;gap:5px;padding:0;font-size:13px;font-weight:550;color:var(--text-2);background:none;
  white-space:nowrap;text-decoration:none}
.ap-link:hover{color:var(--fg);text-decoration:underline;text-underline-offset:3px}
.ap-link .cc-i{width:14px;height:14px}
.ap-appc{display:flex;align-items:center;gap:12px}
.ap-appc .tx{flex:1;min-width:0}
.ap-appc b{display:block;font-size:14px;font-weight:550}
.ap-appc small{display:block;font-size:12.5px;color:var(--muted)}
.ap-hint{margin:12px 0 0;font-size:12.5px;color:var(--muted);line-height:1.5}
.ap-acc b{display:block;font-size:14px;font-weight:550}
.ap-acc.warn b{color:var(--warn)}
.ap-acc.none b{color:var(--danger)}
.ap-chips{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px}
.ap-chip{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:500;color:var(--text-2)}
.ap-chip::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ag)}
.ap-chip.admin{color:var(--warn)}
.ap-chip.admin::before{background:var(--warn)}
.ap-kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 16px;margin:0;font-size:13px}
.ap-kv dt,.ap-kv dd{display:flex;align-items:center;min-height:36px;border-top:1px solid var(--line)}
.ap-kv dt:first-of-type,.ap-kv dt:first-of-type+dd{border-top:0}
.ap-kv dt{color:var(--muted)}
.ap-kv dd{margin:0;min-width:0;gap:6px;color:var(--fg);justify-content:flex-end;text-align:right}
.ap-kv code{font:500 12px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-kv .cc-ibtn{width:26px;height:26px;margin:-4px 0}
.ap-kv .cc-ibtn svg{width:14px;height:14px}
.ap-tech>summary{display:flex;align-items:center;gap:8px;padding:16px 22px;font-size:14px;font-weight:550;cursor:pointer;list-style:none}
.ap-tech>summary::-webkit-details-marker{display:none}
.ap-tech>summary:hover{background:var(--hover)}
.ap-tech>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ap-tech>summary .cc-i{width:15px;height:15px;color:var(--muted);transition:transform .18s var(--ease)}
.ap-tech[open]>summary .cc-i{transform:rotate(90deg)}
.ap-tech>summary small{margin-left:auto;font-size:12.5px;font-weight:500;color:var(--muted)}
.ap-tech .ap-card-b{padding-top:0}
.ap-guessed{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;margin:0 0 14px;font-size:13px;color:var(--muted);line-height:1.5}
.ap-guessed b{color:var(--fg);font-weight:600}
@media (prefers-reduced-motion:reduce){.ap-tech>summary .cc-i{transition:none}}

.ap-evs{list-style:none;margin:0;padding:0 0 8px}
.ap-ev{position:relative;display:grid;grid-template-columns:34px minmax(0,1fr) auto minmax(64px,auto);grid-template-areas:"ic main st t";align-items:center;gap:14px;
  padding:10px 22px;min-height:58px;cursor:pointer;transition:background .12s}
.ap-ev+.ap-ev::before{content:"";position:absolute;top:0;left:70px;right:22px;border-top:1px solid var(--line)}
.ap-ev:hover{background:var(--hover)}
.ap-ev:hover::before,.ap-ev:hover+.ap-ev::before{border-color:transparent}
.ap-ev:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ap-ev-ic{grid-area:ic;display:grid;place-items:center;width:34px;height:34px;border-radius:9px;color:var(--c);background:var(--tile)}
.ap-ev-ic .cc-i{width:16px;height:16px;stroke-width:1.7}
.ap-ev-m{grid-area:main;display:flex;align-items:baseline;gap:4px 10px;min-width:0;flex-wrap:wrap}
.ap-ev-s{font-size:14px;line-height:1.45;min-width:0;overflow-wrap:anywhere;color:var(--fg)}
.ap-ev-p{display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:100%;height:24px;padding:0 8px 0 6px;border-radius:7px;font-size:12px;font-weight:550;
  color:var(--text-2);background:var(--tile)}
.ap-ev-p:hover{color:var(--fg);background:var(--tile-h)}
.ap-ev-p .cc-i{width:12px;height:12px;color:var(--muted);flex:none}
.ap-ev-p span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-ev-more{font-size:11.5px;color:var(--muted)}
.ap-ev-st{grid-area:st;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:550;color:var(--muted);white-space:nowrap;
  font-variant-numeric:tabular-nums}
.ap-ev-st i{width:6px;height:6px;border-radius:50%;background:var(--ok)}
.ap-ev-st.fail{color:var(--fg)}
.ap-ev-st.fail i{background:var(--danger)}
.ap-ev-st.run i{background:var(--accent);animation:ccBlink 1s ease-in-out infinite}
.ap-ev-t{grid-area:t;font-size:12.5px;color:var(--muted);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}

.ap-ev.new{animation:apIn .8s var(--ease)}
@keyframes apIn{from{background:color-mix(in srgb,var(--ag,var(--accent)) 12%,transparent)}to{background:transparent}}
.ap-empty{display:flex;flex-direction:column;align-items:center;gap:4px;padding:40px 22px;text-align:center;color:var(--muted);font-size:13.5px;line-height:1.6}
.ap-empty b{display:block;color:var(--fg);font-size:15px;font-weight:600}
.ap-empty .btn{margin-top:12px}
.ap-sk{display:flex;align-items:center;gap:12px;padding:14px 22px}

.ap-lock{display:flex;align-items:center;gap:14px;padding:16px 22px;margin:0 0 20px}
.ap-lock .tx{flex:1;min-width:0}
.ap-lock b{display:flex;align-items:center;gap:7px;font-size:15px;font-weight:600}
.ap-lock b .cc-i{width:14px;height:14px;color:var(--muted)}
.ap-lock small{display:block;margin-top:2px;font-size:13px;color:var(--muted);line-height:1.5}
.ap-lock .btn{flex:none;height:38px;border-radius:10px}
.ap-wz{padding:24px 26px 0}
.ap-wz-f{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin:22px -26px 0;padding:14px 26px;border-top:1px solid var(--line);
  background:color-mix(in srgb,var(--fg) 2%,transparent);border-radius:0 0 var(--r14) var(--r14)}
.ap-wz-f .grow{flex:1}
.ap-wz-f .btn{height:40px;padding:0 18px;border-radius:10px}
@container ap (min-width:860px){
  ${railCSS('.ap-wz')}
  .ap-wz{display:grid;grid-template-columns:210px minmax(0,1fr);column-gap:32px;padding:0 26px 0 0}
  .ap-wz>#apWz,.ap-wz .cn-wz{display:contents}
  .ap-wz .cn-prog{grid-column:1;grid-row:1/span 2;margin:0;padding:24px 20px;border-right:1px solid var(--line);
    background:color-mix(in srgb,var(--fg) 2%,transparent);border-radius:var(--r14) 0 0 var(--r14)}
  .ap-wz .cn-step{grid-column:2;grid-row:1;padding-top:26px;min-width:0;container:cnwz/inline-size}
  .ap-wz .ap-wz-f{grid-column:2;grid-row:2;margin:22px -26px 0 -32px;padding:14px 26px 14px 32px;border-radius:0 0 var(--r14) 0}
}
.ap-ask{padding:26px}
.ap-ask h2{margin:0;font-size:18px;font-weight:600;letter-spacing:-.015em;outline:none}
.ap-ask>p{margin:6px 0 18px;font-size:13.5px;color:var(--muted);line-height:1.55;max-width:70ch}
.ap-pq{position:relative;display:block;margin:0 0 16px;max-width:420px}
.ap-pq svg{position:absolute;left:12px;top:50%;width:16px;height:16px;margin-top:-8px;color:var(--muted);pointer-events:none}
.ap-pq .ui-input{padding-left:38px;border-color:transparent;background:color-mix(in srgb,var(--fg) 5%,transparent)}
.ap-pq .ui-input:focus{border-color:var(--line-strong);background:var(--surface-1)}
.ap-pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
.ap-ptile{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;min-width:0;text-align:left;
  border:1px solid var(--line);background:var(--surface-1);color:var(--fg);transition:border-color .15s,background .15s}
.ap-ptile:hover{border-color:var(--line-strong);background:var(--hover)}
.ap-ptile:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-soft);border-color:var(--accent-line)}
.ap-ptile .tx{min-width:0}
.ap-ptile b{display:block;font-size:14px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-ptile small{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-pnone{margin:6px 0 0;font-size:13px;color:var(--muted)}

.ap-acc-ed{padding:20px 22px 6px}
.ap-save{position:sticky;bottom:calc(-1 * var(--ap-pb));z-index:5;display:flex;align-items:center;gap:8px;margin:16px 0 0;padding:12px 0}
.ap-save-in{display:flex;align-items:center;justify-content:flex-end;gap:10px;width:100%;padding:10px 10px 10px 18px;border-radius:var(--r14);border:1px solid var(--line-strong);
  background:var(--ovl-bg);-webkit-backdrop-filter:var(--ovl-filter);backdrop-filter:var(--ovl-filter);box-shadow:none}
.ap-save .msg{flex:1;min-width:0;font-size:13px;color:var(--muted)}
.ap-save.dirty .msg{color:var(--fg);font-weight:600}
.ap-save .btn{height:40px;border-radius:10px}

.ap-set{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start}
.ap-set .full{grid-column:1/-1}
.ap-row{position:relative;display:flex;align-items:center;gap:14px;padding:14px 22px;min-height:68px}
.ap-row+.ap-row::before{content:"";position:absolute;top:0;left:22px;right:22px;border-top:1px solid var(--line)}
.ap-row .tx{flex:1;min-width:0}
.ap-row .tx b{display:block;font-size:14px;font-weight:550}
.ap-row .tx small{display:block;margin-top:2px;font-size:12.5px;color:var(--muted);line-height:1.45}
.ap-row code{font:500 12.5px var(--mono);color:var(--fg);word-break:break-all}
.ap-row .btn{flex:none;height:38px;border-radius:10px}
.ap-row .cc-ibtn{border:1px solid var(--line-strong);width:38px;height:38px}
.ap-prev{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;background:var(--tile);margin:0 0 18px}
.ap-prev b{display:block;font-size:14.5px;font-weight:600}
.ap-prev small{display:block;font-size:12px;color:var(--muted)}
.ap-namef{padding:8px 22px 22px}
.ap-namef .acts{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.ap-namef .btn{height:40px;padding:0 18px;border-radius:10px}
.ap-danger{border-color:color-mix(in srgb,var(--danger) 30%,var(--line))}
.ap-danger .ap-card-h h2{color:var(--danger)}
.ap-nf{max-width:560px;margin:40px auto;text-align:center;padding:40px 24px}
.ap-nf h1{margin:0 0 6px;font-size:20px;font-weight:650}
.ap-nf p{margin:0 0 18px;color:var(--muted);font-size:13.5px;line-height:1.6}
.ap-nf code{font:600 12.5px var(--mono);color:var(--fg)}
.ap-nf .acts{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}

@container ap (max-width:979px){
  .ap-cols{grid-template-columns:minmax(0,1fr)}
}
@container ap (max-width:760px){
  .ap-tab{padding:0 12px}
}
@container ap (max-width:719px){
  .ap-set{grid-template-columns:minmax(0,1fr)}
}
@container ap (max-width:639px){
  .ap-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ap-stat:nth-child(3){grid-column:1/-1;border-left:0;border-top:1px solid var(--line)}
}
@container ap (max-width:599px){
  .ap-head{flex-wrap:wrap;align-items:center;gap:12px 14px;margin-bottom:16px}
  .ap-head .ag-av{width:48px!important;height:48px!important;font-size:18px!important}
  .ap-acts{order:3;width:100%;gap:8px}
  .ap-acts .btn{flex:1 1 0;min-width:0;padding:0 10px;height:44px}
  .ap-acts .cc-ibtn{width:44px;height:44px}
  .ap-id{gap:6px;flex:1 1 calc(100% - 64px)}
  .ap-id h1{font-size:22px;white-space:normal;overflow-wrap:anywhere}
  .ap-meta{gap:6px 12px;font-size:13px}
  .ap-tabs{margin:0 0 16px}
  .ap-tabs-in{display:flex}
  .ap-tab{flex:1 1 auto;padding:0 6px;height:40px;font-size:13px}
  .ap-tab .cc-i{display:none}
  .ap-stat{padding:16px}
  .ap-stat .v{font-size:26px}
  .ap-stat .sp{display:none}
  .ap-card-h{padding:14px 16px 4px}
  .ap-card-b{padding:8px 16px 16px}
  .ap-tech>summary{padding:14px 16px}
  .ap-ev{grid-template-columns:34px minmax(0,1fr) auto;grid-template-areas:"ic main t" "ic sub st";gap:3px 12px;padding:10px 16px}
  .ap-ev+.ap-ev::before{left:62px;right:16px}
  .ap-ev-m{display:contents}
  .ap-ev-m .ap-ev-s{grid-area:main}
  .ap-ev-m .ap-ev-p{grid-area:sub;justify-self:start}
  .ap-ev-m .ap-ev-more,.ap-ev-m .ap-ev-p~.ap-ev-p{display:none}
  .ap-ev-ic{align-self:start;margin-top:2px}
  .ap-ev-t{align-self:baseline}
  .ap-lock{flex-wrap:wrap;align-items:flex-start;padding:14px 16px}
  .ap-lock .tx{flex:1 1 calc(100% - 60px)}
  .ap-lock .btn{margin-left:54px;height:40px}
  .ap-wz{padding:16px 16px 0}
  .ap-wz-f{margin:16px -16px 0;padding:10px 16px}
  .ap-wz-f .btn{flex:1;height:44px}
  .ap-ask{padding:16px}
  .ap-pgrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .ap-ptile{padding:10px;gap:9px}
  .ap-acc-ed{padding:14px 12px 2px}
  .ap-save-in{column-gap:84px;padding:8px}
  .ap-save .btn{flex:1;height:44px}
  .ap-save .msg{display:none}
  .ap-row{flex-wrap:wrap;padding:14px 16px}
  .ap-row+.ap-row::before{left:16px;right:16px}
  .ap-row .btn{flex:1 1 auto;height:44px}
  .ap-namef{padding:8px 16px 16px}
  .ap-ban{flex-wrap:wrap}
  .ap-ban .btn{width:100%;height:44px}
}
@container ap (max-width:380px){
  .ap-tab{padding:0 4px;font-size:12px}
}
@media (max-width:760px){.ap{--ap-pt:16px;--ap-pb:32px}.ap.on-act .ap-tabs{position:static}}
@media (prefers-reduced-motion:reduce){.ap-ev.new{animation:none}.ap-ev-st.run i{animation:none}}
`;

const ICO_CAT: Record<Cat, string> = {
  read: ICO_EYE,
  search: ICO.search,
  write: ICO_EDIT,
  delete: ICO_TRASH,
  auth: ICO.key,
  other: ICO_ACTIVITY,
};

/** What the page shows right now. */
interface Page {
  id: string;
  tab: Tab;
  root: HTMLElement;
  /** The agent's events (newest first) for `range`, once loaded. */
  events: ActivityItem[] | null;
  range: string;
  evSeq: number;
  fresh: Set<string>;
  wizard: Wizard | null;
  perms: PermEditor | null;
  /** The Setup tab shows the app picker even though there is a guess. */
  picking: boolean;
}

let P: Page | null = null;

/** The page's styles; the new-agent page shares its header, cards and back link. */
export function useAgentPageStyles(): void {
  useStyles('agent-page-css', CSS);
}

export async function renderAgentPage(host: HTMLElement, id: string, tab: string): Promise<void> {
  useAgentPageStyles();
  useActivityStyles();
  const t: Tab = (AGENT_TABS as readonly string[]).includes(tab) ? (tab as Tab) : 'overview';
  if (P && P.id === id && P.root.isConnected && host.contains(P.root)) {
    if (P.tab !== t) showTab(t, true);
    return;
  }
  P?.wizard?.destroy();
  host.innerHTML = `<div class="cc ap" data-id="${attr(id)}"></div>`;
  const root = host.firstElementChild as HTMLElement;
  P = { id, tab: t, root, events: null, range: '', evSeq: 0, fresh: new Set(), wizard: null, perms: null, picking: false };
  const page = P;
  whileVisible(host, () => {
    let t1 = 0;
    const unsubSeen = onAgents((_n, seen) => {
      if (bumpSeen(seen) && !t1) t1 = window.setTimeout(() => ((t1 = 0), P === page && paintHead()), 600);
    });
    const unsubLive = onLive((it) => P === page && live(it));
    const off = onAgentsData(() => P === page && refresh());
    const tick = window.setInterval(() => P === page && paintHead(), 30000);
    // The tabs get a backdrop once they stick to the top.
    const onScroll = (): void => {
      const tabs = page.root.querySelector<HTMLElement>('.ap-tabs');
      if (tabs) tabs.classList.toggle('stuck', host.scrollTop > 0 && tabs.getBoundingClientRect().top <= host.getBoundingClientRect().top + 1);
    };
    host.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      host.removeEventListener('scroll', onScroll);
      unsubSeen();
      unsubLive();
      off();
      clearTimeout(t1);
      clearInterval(tick);
      page.wizard?.destroy();
      page.wizard = null;
      if (P === page) P = null;
    };
  });
  if (data.loaded && keyById(id)) {
    mount(true);
    void loadAgents(true);
  } else {
    root.innerHTML = skeletonHTML();
    await loadAgents(true);
    if (P !== page) return;
    mount(true);
  }
}

const key = (): KeyRowFull | undefined => (P ? keyById(P.id) : undefined);

function skeletonHTML(): string {
  return `<div class="ap-crumb">${skBlock('80px', 20)}</div><div class="ap-head" aria-busy="true">${skBlock('64px', 64)}
    <div class="ap-id">${skBlock('min(260px,60%)', 24)}${skBlock('min(340px,80%)', 14)}</div></div>
    <div class="ap-card" style="margin-top:20px">${'<div class="ap-sk">' + skBlock('28px', 28) + skBlock('40%', 12) + '</div>'}${'<div class="ap-sk">' + skBlock('28px', 28) + skBlock('55%', 12) + '</div>'}</div>`;
}

/** Draw the page around the current tab (first paint, or the agent is back after a reload). */
function mount(focus: boolean): void {
  if (!P) return;
  const k = key();
  const crumb = `<nav class="ap-crumb" aria-label="Breadcrumb"><a class="ap-back" href="/agents" data-nav="">${ICO_BACK}All agents</a></nav>`;
  if (!k) {
    const gone = state.keysDeleted.find((x) => x.id === P!.id);
    P.root.innerHTML = `${crumb}<div class="ap-card ap-nf"><h1 tabindex="-1">${gone ? `${esc(nameOf(gone))} was deleted` : 'No agent at this address'}</h1>
      <p>${
        gone
          ? 'Its key stopped working. You can restore it until you reload the app.'
          : `There is no agent with the key id <code>${esc(P.id)}</code>. It may have been deleted; its past calls stay in Activity.`
      }</p><div class="acts">${gone ? `<button type="button" class="btn primary" data-restore>${ICO_RESTORE}Restore</button>` : ''}
      <a class="btn" href="/activity/${attr(encodeURIComponent(P.id))}" data-act-page>What it did</a><a class="btn" href="/agents" data-nav="">All agents</a></div></div>`;
    wireAgentLinks(P.root);
    const rb = P.root.querySelector<HTMLElement>('[data-restore]');
    if (rb) rb.onclick = () => void restoreKey(P!.id);
    const ap = P.root.querySelector<HTMLAnchorElement>('[data-act-page]');
    if (ap)
      ap.onclick = (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        // Its past calls stay in the log: the Activity page, filtered to it.
        if (gone?.name) {
          try {
            sessionStorage.setItem('memora.activity.agent', gone.name);
          } catch {
            /* optional */
          }
        } else setRouteAgent(P!.id);
        hooks.go('logs');
      };
    document.title = 'Agent not found · Memora';
    if (focus) P.root.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    return;
  }
  const tabs = AGENT_TABS.map(
    (t) =>
      `<button type="button" role="tab" class="ap-tab" id="apTab-${t}" data-tab="${t}" aria-controls="apPanel" aria-selected="${t === P!.tab}" tabindex="${
        t === P!.tab ? 0 : -1
      }">${icon(TAB_ICON[t], 'cc-i')}${TAB_LABEL[t]}</button>`,
  ).join('');
  P.root.style.setProperty('--ag', agentColor(nameOf(k), k.id));
  P.root.innerHTML = `${crumb}<header class="ap-head" id="apHead"></header>
    <div class="ap-tabs"><div class="ap-tabs-in" role="tablist" aria-label="${attr(nameOf(k))}">${tabs}</div></div>
    <section class="ap-panel" id="apPanel" role="tabpanel" aria-labelledby="apTab-${P.tab}" tabindex="-1"></section>`;
  P.root.classList.toggle('on-act', P.tab === 'activity');
  wireAgentLinks(P.root);
  wireTabs();
  paintHead();
  paintTab();
  if (focus) P.root.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
}

/** Data changed (a load finished): repaint what shows it, but never under the owner's typing. */
function refresh(): void {
  if (!P) return;
  const k = key();
  const head = P.root.querySelector('#apHead');
  if (!k || !head) return mount(false);
  paintHead();
  if (P.tab === 'overview') paintTab();
  else if (P.tab === 'settings') paintSettingsLive();
}

function statusLine(k: KeyRowFull): string {
  const s = statusOf(k);
  if (s.st === 'off') return `<span class="ap-st off"><span class="sd off" aria-hidden="true"></span><b>Turned off</b></span>`;
  if (s.st === 'never') return `<span class="ap-st"><span class="sd never" aria-hidden="true"></span><b>Never used</b> · no calls yet</span>`;
  return `<span class="ap-st"><span class="sd ${s.st}" aria-hidden="true"></span><b>${s.label}</b> · last call ${esc(s.seen.toLowerCase())}</span>`;
}

function appChip(k: KeyRowFull): string {
  const app = appFor(k);
  if (!app.id) return `<span class="ap-app none" title="Pick its app in Setup">App not set</span>`;
  const locked = !app.guessed;
  return `<span class="ap-app" title="${attr(locked ? `${app.label}: each agent belongs to one app` : `${app.label}, guessed from its name`)}">${appIconHTML(
    app.label,
    20,
  )}<span>${esc(app.label)}</span>${locked ? ICO_LOCK : ''}</span>`;
}

function paintHead(): void {
  const head = P?.root.querySelector<HTMLElement>('#apHead');
  const k = key();
  if (!head || !k) return;
  const name = nameOf(k);
  const s = statusOf(k);
  const off = s.st === 'off';
  const needsSetup = s.st === 'never' || !appFor(k).id;
  const focusedH1 = !!document.activeElement?.matches?.('#apHead h1');
  head.innerHTML = `${avatarHTML(name, 64, s.st === 'active' ? 'live' : '', k.id)}
    <div class="ap-id"><h1 tabindex="-1">${esc(name)}</h1><div class="ap-meta">${appChip(k)}${statusLine(k)}</div></div>
    <div class="ap-acts">${
      needsSetup && P!.tab !== 'setup' ? `<button type="button" class="btn primary" data-h="setup" aria-label="Set up">${ICO.plug}<span class="l">Set up</span></button>` : ''
    }<button type="button" class="btn" data-h="toggle" aria-label="${off ? 'Turn on' : 'Turn off'}">${off ? ICO.check : ICO_POWER}<span class="l">${off ? 'Turn on' : 'Turn off'}</span></button>
      <button type="button" class="cc-ibtn" data-h="more" aria-haspopup="menu" aria-label="More actions for ${attr(name)}" title="More">${ICO.more}</button></div>`;
  if (focusedH1) head.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  head.querySelectorAll<HTMLElement>('[data-h]').forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.h;
      if (a === 'setup') return go('setup');
      if (a === 'toggle') return void toggleKey(k);
      if (a === 'more') moreMenu(b, k);
    };
  });
  document.title = `${name} · Agents · Memora`;
}

function moreMenu(anchor: HTMLElement, k: KeyRowFull): void {
  const name = nameOf(k);
  openMenu(
    anchor,
    [
      { label: 'Rename & colour', desc: 'Change how it shows up everywhere.', icon: ICO_EDIT, run: () => go('settings') },
      ...(k.revealable ? [{ label: 'Show key', desc: 'See its key again; asks for your password.', icon: ICO_EYE, run: () => openReveal(k) }] : []),
      { label: 'Make a new key', desc: 'The current key stops working at once.', icon: ICO.key, run: () => rollKey(k, () => go('setup')) },
      { label: 'Activity', desc: 'Its numbers, timeline and export.', icon: ICO_ACTIVITY, run: () => go('activity') },
      { sep: true, label: '' },
      { label: 'Delete', desc: 'Remove the agent; its key stops working at once.', icon: ICO_TRASH, danger: true, run: () => delKey(k, () => navAgents('')) },
    ],
    { title: name, lead: avatarHTML(name, 30, '', k.id) },
  );
}

/** Go to a tab through its address, so back and forward follow it. */
function go(t: Tab): void {
  if (!P) return;
  navAgents(P.id + (t === 'overview' ? '' : '/' + t));
}

function wireTabs(): void {
  const list = P!.root.querySelector<HTMLElement>('[role=tablist]')!;
  const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role=tab]'));
  tabs.forEach((b, i) => {
    b.onclick = () => go(b.dataset.tab as Tab);
    b.onkeydown = (e) => {
      let j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j < 0) return;
      e.preventDefault();
      tabs[j].focus();
      go(tabs[j].dataset.tab as Tab);
    };
  });
}

/** Switch the visible tab (the address already says which). */
function showTab(t: Tab, fromRoute: boolean): void {
  if (!P) return;
  if (P.tab === 'setup' && t !== 'setup') {
    P.wizard?.destroy();
    P.wizard = null;
    P.picking = false;
  }
  P.tab = t;
  P.perms = null;
  P.root.classList.toggle('on-act', t === 'activity');
  const tabs = P.root.querySelectorAll<HTMLButtonElement>('[role=tab]');
  if (!tabs.length) return mount(false);
  tabs.forEach((b) => {
    const on = b.dataset.tab === t;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  const sel = P.root.querySelector<HTMLElement>(`#apTab-${t}`);
  sel?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  P.root.querySelector('#apPanel')?.setAttribute('aria-labelledby', `apTab-${t}`);
  // Keep the tabs in view: a tab switched from far down the page starts at its top.
  const tabsBox = P.root.querySelector<HTMLElement>('.ap-tabs');
  const view = P.root.closest<HTMLElement>('.view');
  if (tabsBox && view && tabsBox.getBoundingClientRect().top <= view.getBoundingClientRect().top + 1) {
    view.scrollTop = Math.max(0, tabsBox.offsetTop);
  }
  paintHead();
  paintTab();
  // Back or forward to another tab: focus follows, unless it is already on the tabs.
  if (fromRoute && !P.root.querySelector('[role=tablist]')?.contains(document.activeElement)) sel?.focus({ preventScroll: true });
}

function paintTab(): void {
  const panel = P?.root.querySelector<HTMLElement>('#apPanel');
  const k = key();
  if (!panel || !k) return;
  if (P!.tab !== 'activity') leaveAgentActivity();
  if (P!.tab === 'overview') paintOverview(panel, k);
  else if (P!.tab === 'setup') paintSetup(panel, k);
  else if (P!.tab === 'activity') paintActivity(panel, k);
  else if (P!.tab === 'access') void paintAccess(panel, k);
  else paintSettings(panel, k);
  wireAgentLinks(panel);
}

/** Load the agent's events for a range (once per range; `force` reloads). */
async function loadEvents(range: string, force = false): Promise<void> {
  if (!P) return;
  const k = key();
  if (!k || (!force && P.range === range && P.events)) return;
  const page = P;
  const my = ++page.evSeq;
  page.range = range;
  const got = await fetchAgentEvents({ id: k.id, name: nameOf(k) }, range, range === 'all' ? 3000 : 1500).catch(() => ({ items: [], logged: 0 }));
  if (P !== page || my !== page.evSeq) return;
  page.events = got.items.filter((x) => x.source !== 'auth' || x.raw.actor_id === k.id);
  if (page.tab === 'overview') paintRecent();
}

function isMine(it: ActivityItem): boolean {
  const k = key();
  if (!k) return false;
  const kid = typeof it.raw.actor_id === 'string' ? it.raw.actor_id : null;
  return kid ? kid === k.id : it.actor === nameOf(k);
}

let livePaint = 0;
function live(it: ActivityItem): void {
  if (P?.tab === 'activity') agentActivityLive(it);
  if (!P || !P.events || !isMine(it)) return;
  P.fresh.add(it.id);
  pushLive(P.events, it);
  if (livePaint) return;
  livePaint = window.setTimeout(() => {
    livePaint = 0;
    if (!P) return;
    if (P.tab === 'overview') paintRecent();
    P.fresh.clear();
  }, 300);
}

/** One call as a plain sentence about this agent ("Read Roadmap"); a search also shows the first notes it found. */
function evRowHTML(it: ActivityItem, withClock = false): string {
  const cat = catOf(it);
  const problem = problemOf(it);
  const pred = predicate(it);
  const found = cat === 'search' ? it.paths.slice(0, 2) : [];
  const st = it.running
    ? '<span class="ap-ev-st run"><i></i>Working…</span>'
    : problem
      ? `<span class="ap-ev-st fail"><i></i>${problem === 'refused' ? 'Refused' : 'Did not work'}</span>`
      : '<span class="ap-ev-st"></span>';
  const rel = ago(it.ts);
  return `<li class="ap-ev${problem ? ' fail' : ''}${P?.fresh.has(it.id) ? ' new' : ''}" role="button" tabindex="0" data-act="${attr(it.id)}"
    aria-label="${attr(`${plainText(pred)}, ${fmtTs(it.ts)}`)}">
    <span class="ap-ev-ic" style="--c:${CAT_COLOR[cat]}">${ICO_CAT[cat]}</span>
    <span class="ap-ev-m"><span class="ap-ev-s act-p cap">${pred}</span>${found
      .map((p) => `<button type="button" class="ap-ev-p" data-note="${attr(p)}" title="${attr(p)}">${ICO.note}<span>${esc(noteName(p))}</span></button>`)
      .join('')}${it.paths.length > found.length && found.length ? `<span class="ap-ev-more">+${it.paths.length - found.length}</span>` : ''}</span>${st}
    <span class="ap-ev-t" title="${attr(fmtTs(it.ts))}">${withClock ? `<span class="clk">${clock(it.ts)}</span>` : ''}${rel === 'now' ? 'now' : rel + ' ago'}</span></li>`;
}

function evSkeleton(n: number): string {
  return Array.from({ length: n }, (_, i) => `<div class="ap-sk">${skBlock('28px', 28)}${skBlock(30 + ((i * 17) % 40) + '%', 12)}</div>`).join('');
}

function paintOverview(panel: HTMLElement, k: KeyRowFull): void {
  const name = nameOf(k);
  const s = statusOf(k);
  const u = usageOf(k);
  const app = appFor(k);
  const c = app.id ? appById(app.id) : undefined;
  const perms = permsOf(k);
  const p = summarize(perms);
  const signed = data.oauth.has(k.id);
  const last = u?.last || 0;
  const chips = perms.scopes
    .map((sc) => {
      const d = SCOPES.find((x) => x.id === sc)!;
      return `<span class="ap-chip${sc === 'admin' ? ' admin' : ''}" title="${attr(d.label)}">${esc(d.short)}</span>`;
    })
    .join('');
  const banner =
    s.st === 'off'
      ? `<div class="ap-ban off"><span class="ic">${ICO_POWER}</span><span class="tx"><b>${esc(name)} is turned off</b><small>Its key is refused until you turn it back on. Nothing is deleted.</small></span>
        <button type="button" class="btn" data-o="toggle">${ICO.check}Turn on</button></div>`
      : s.st === 'never'
        ? `<div class="ap-ban"><span class="ic">${ICO.plug}</span><span class="tx"><b>No calls yet</b><small>${
            c ? `Follow the ${esc(c.label)} setup guide to connect it.` : 'Pick its app, then follow the setup guide to connect it.'
          }</small></span><button type="button" class="btn primary" data-o="setup">${ICO.plug}Open the setup guide</button></div>`
        : '';
  panel.innerHTML = `${banner}
    <div class="ap-stats">
      <div class="ap-stat"><span class="k">Calls in 24h</span><span class="v">${u ? u.day : 0}${
        u && u.day ? `<span class="sp">${sparkSVG(u.spark, 120, 24)}</span>` : ''
      }</span><span class="h">${u && u.day ? 'Per hour, last 24 hours' : 'None in the last 24 hours'}</span></div>
      <div class="ap-stat"><span class="k">All time</span><span class="v">${(k.uses || 0).toLocaleString('en-US')}</span><span class="h">Calls with this key</span></div>
      <div class="ap-stat"><span class="k">Last call</span><span class="v sm">${last ? esc(s.seen) : k.uses ? 'Over a week ago' : 'Never'}</span><span class="h">${
        last ? esc(fmtTs(last)) : 'No call in the last 7 days'
      }</span></div>
    </div>
    <div class="ap-cols">
      <section class="ap-card"><div class="ap-card-h"><h2>Recent activity</h2><a class="ap-link" href="${attr(agentsHref(k.id + '/activity'))}" data-nav="${attr(
        k.id + '/activity',
      )}">See all activity ${ICO.arrow}</a></div><div id="apRecent">${evSkeleton(4)}</div></section>
      <div class="ap-side">
        <section class="ap-card"><div class="ap-card-h"><h2>App</h2>${
          c ? `<a class="ap-link" href="${attr(agentsHref(k.id + '/setup'))}" data-nav="${attr(k.id + '/setup')}">Setup guide ${ICO.arrow}</a>` : ''
        }</div>
          <div class="ap-card-b">${
            c
              ? `<div class="ap-appc">${appIconHTML(c.label, 38)}<span class="tx"><b>${esc(c.label)}</b><small>${esc(c.kind)}</small></span></div><p class="ap-hint">${
                  app.guessed
                    ? 'Guessed from its name. Wrong app? Pick another in Setup.'
                    : 'Each agent belongs to one app. For another app or device, make a new agent.'
                }</p>`
              : `<div class="ap-appc">${appIconHTML('', 38)}<span class="tx"><b>Not set</b><small>Pick it once in Setup</small></span></div>
                <p class="ap-hint"><a class="ap-link" href="${attr(agentsHref(k.id + '/setup'))}" data-nav="${attr(k.id + '/setup')}">Pick its app ${ICO.arrow}</a></p>`
          }</div></section>
        <section class="ap-card"><div class="ap-card-h"><h2>Access</h2><a class="ap-link" href="${attr(agentsHref(k.id + '/access'))}" data-nav="${attr(
          k.id + '/access',
        )}">Edit ${ICO.arrow}</a></div>
          <div class="ap-card-b ap-acc${p.tone ? ' ' + p.tone : ''}"><b>${esc(p.tools ? p.level + ' · ' + p.tools : p.level)}</b>${
            chips || signed ? `<div class="ap-chips">${chips}${signed ? '<span class="ap-chip">Signed in</span>' : ''}</div>` : ''
          }</div></section>
        <details class="ap-card ap-tech"><summary>${ICO_CHEV}Technical details<small>Key ID, last IP</small></summary><div class="ap-card-b"><dl class="ap-kv">
          ${techRows(k)}
        </dl></div></details>
      </div>
    </div>`;
  wireCopy(panel);
  panel.querySelectorAll<HTMLElement>('[data-o]').forEach((b) => {
    b.onclick = () => (b.dataset.o === 'toggle' ? void toggleKey(k) : go('setup'));
  });
  const box = panel.querySelector<HTMLElement>('#apRecent')!;
  wireActRows(box, (id) => P?.events?.find((x) => x.id === id));
  if (P!.events) paintRecent();
  void loadEvents(P!.range || '7d');
}

/** Key ID, how the key is kept, when it was made and where its last call came from. */
function techRows(k: KeyRowFull): string {
  const signed = data.oauth.has(k.id);
  return `<dt>Key ID</dt><dd><code title="${attr(k.id)}">${esc(k.id)}</code><button type="button" class="cc-ibtn" data-copy="${attr(
    k.id,
  )}" aria-label="Copy the key ID" title="Copy">${ICO.copy}</button></dd>
    <dt>Key</dt><dd>${k.revealable ? 'Can be shown again with your password' : signed ? 'Held by the app (it signed in)' : 'Was shown once, when it was made'}</dd>
    ${k.created ? `<dt>Created</dt><dd>${esc(fmtTs(k.created))}</dd>` : ''}
    <dt>Last IP</dt><dd><code title="${attr(k.last_ip || '')}">${esc(k.last_ip || 'None yet')}</code></dd>`;
}

function paintRecent(): void {
  const box = P?.root.querySelector<HTMLElement>('#apRecent');
  if (!box || !P!.events) return;
  const rows = P!.events.filter((x) => x.source === 'agent').slice(0, 8);
  const k = key()!;
  if (!rows.length) {
    box.innerHTML = `<div class="ap-empty"><b>No calls in the last ${P!.range === '7d' ? '7 days' : 'while'}</b>${
      statusOf(k).st === 'never' ? 'Once its app is set up, every call shows up here as it happens.' : 'New calls show up here as they happen.'
    }</div>`;
    return;
  }
  box.innerHTML = `<ul class="ap-evs" aria-label="Recent calls">${rows.map((x) => evRowHTML(x)).join('')}</ul>`;
}

function paintSetup(panel: HTMLElement, k: KeyRowFull): void {
  P!.wizard?.destroy();
  P!.wizard = null;
  const app = appFor(k);
  if (!app.id || P!.picking) return paintPicker(panel, k);
  const c = appById(app.id)!;
  // A guessed app can still be changed until the first call keeps it.
  const top = app.guessed
    ? `<p class="ap-guessed">${appIconHTML(c.label, 20)}<span>Showing the setup for <b>${esc(c.label)}</b>, guessed from ${
        data.oauth.has(k.id) ? 'how it signed in' : 'its name'
      }.</span><button type="button" class="ap-link" data-other>Wrong app? Pick another</button></p>`
    : `<div class="ap-card ap-lock">${appIconHTML(c.label, 40)}<span class="tx"><b>${esc(c.label)}${ICO_LOCK}</b>
      <small>Each agent belongs to one app. To use Memora in another app, create a separate agent for it.</small></span>
      <a class="btn" href="/agents/new" data-nav="new">${ICO.plus}New agent</a></div>`;
  panel.innerHTML = `${top}
    <div class="ap-card ap-wz"><div id="apWz"></div><div class="ap-wz-f"><button type="button" class="btn ghost" id="apWzBack">Back</button><span class="grow"></span>
      <button type="button" class="btn primary" id="apWzNext">Continue</button></div></div>`;
  const back = panel.querySelector<HTMLButtonElement>('#apWzBack')!;
  const next = panel.querySelector<HTMLButtonElement>('#apWzNext')!;
  const secret = freshSecrets.get(k.id);
  const wz = mountConnectWizard(panel.querySelector<HTMLElement>('#apWz')!, {
    agent: connectKey(k),
    client: app.id,
    secret,
    fresh: !!secret,
    createAgent,
    // The first call keeps a guessed app: the guess note goes and the header shows it locked.
    onAppChosen: (id, cl) =>
      void setAgentApp(id, cl).then(() => {
        if (appFor(k).guessed) return;
        panel.querySelector('.ap-guessed')?.remove();
        paintHead();
      }),
    onChange: () => void loadAgents(true),
    setNav: (n) => {
      back.style.visibility = n.back ? '' : 'hidden';
      // The last step needs no button: everything is on the page already.
      next.hidden = n.next === 'Done';
      next.textContent = n.next === 'Continue' ? 'Next: first prompt' : n.next;
    },
  });
  P!.wizard = wz;
  back.onclick = () => wz.back();
  next.onclick = () => void wz.next();
  const other = panel.querySelector<HTMLElement>('[data-other]');
  if (other)
    other.onclick = () => {
      P!.picking = true;
      paintSetup(panel, k);
      panel.querySelector<HTMLElement>('#apPq')?.focus();
    };
}

/** Remember the agent's app for good, then show its setup guide. */
async function lockApp(k: KeyRowFull, clientId: string): Promise<void> {
  await setAgentApp(k.id, clientId);
  if (!P) return;
  P.picking = false;
  toast(`${nameOf(k)} belongs to ${appById(clientId)?.label || 'that app'}`, 'ok', 2200);
  paintHead();
  const panel = P.root.querySelector<HTMLElement>('#apPanel');
  if (panel && P.tab === 'setup') {
    paintSetup(panel, k);
    wireAgentLinks(panel);
    panel.querySelector<HTMLElement>('.cn-h')?.focus({ preventScroll: true });
  }
}

function paintPicker(panel: HTMLElement, k: KeyRowFull): void {
  const name = nameOf(k);
  const tile = (s: ClientSnippet): string =>
    `<button type="button" class="ap-ptile" data-pick="${attr(s.id)}" data-q="${attr((s.label + ' ' + s.kind + ' ' + s.how).toLowerCase())}">${appIconHTML(
      s.label,
      32,
    )}<span class="tx"><b>${esc(s.label)}</b><small>${esc(s.kind)}</small></span></button>`;
  panel.innerHTML = `<div class="ap-card ap-ask"><h2 tabindex="-1">Which app is ${esc(name)} used with?</h2>
    <p>Pick it and the setup steps for that app follow, with ${esc(name)}'s key filled in. For another app or device, make a new agent.</p>
    <label class="ap-pq">${ICO.search}<span class="sr-only">Search apps</span><input class="ui-input" type="search" id="apPq" placeholder="Search apps" autocomplete="off"></label>
    <div class="ap-pgrid" role="group" aria-label="Apps">${snippets().map(tile).join('')}</div>
    <p class="ap-pnone" id="apPnone" hidden>No app matches. <b>Any client</b> works with every MCP client.</p>
    ${appFor(k).id ? `<p style="margin:14px 0 0"><button type="button" class="ap-link" data-cancel>Back to the ${esc(appFor(k).label)} setup</button></p>` : ''}</div>`;
  panel.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => (b.onclick = () => void lockApp(k, b.dataset.pick!)));
  const cancel = panel.querySelector<HTMLElement>('[data-cancel]');
  if (cancel)
    cancel.onclick = () => {
      P!.picking = false;
      paintSetup(panel, k);
    };
  const q = panel.querySelector<HTMLInputElement>('#apPq')!;
  q.oninput = () => {
    const s = q.value.trim().toLowerCase();
    let n = 0;
    panel.querySelectorAll<HTMLElement>('[data-pick]').forEach((t) => {
      t.hidden = !!s && !t.dataset.q!.includes(s);
      if (!t.hidden) n++;
    });
    panel.querySelector<HTMLElement>('#apPnone')!.hidden = n > 0;
  };
  q.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const vis = Array.from(panel.querySelectorAll<HTMLElement>('[data-pick]')).filter((t) => !t.hidden);
    if (vis.length === 1) void lockApp(k, vis[0].dataset.pick!);
  };
}

/** The Activity tab: this agent's numbers, charts, problems, notes and timeline (views/activity-agent.ts). */
function paintActivity(panel: HTMLElement, k: KeyRowFull): void {
  const view = P?.root.closest<HTMLElement>('.view');
  if (!view) return;
  const tabs = P!.root.querySelector<HTMLElement>('.ap-tabs');
  mountAgentActivity(
    panel,
    view,
    { id: k.id, name: nameOf(k), used: (k.uses || 0) > 0 },
    {
      // The timeline's toolbar sticks right under the tabs (phones: the tabs scroll away on this tab).
      top: () => (tabs && getComputedStyle(tabs).position === 'sticky' ? tabs.offsetHeight : 0),
      setup: () => go('setup'),
    },
  );
}

async function paintAccess(panel: HTMLElement, k: KeyRowFull): Promise<void> {
  const page = P!;
  panel.innerHTML = `<div class="ap-card ap-acc-ed">${evSkeleton(3)}</div>`;
  const tools = await loadCatalog();
  if (P !== page || page.tab !== 'access') return;
  const start = permsOf(k);
  panel.innerHTML = `<div class="ap-card ap-acc-ed" id="apPerms">${permsHTML(start, tools, { levels: true })}</div>
    <div class="ap-save" id="apSave"><div class="ap-save-in"><span class="msg" aria-live="polite">No changes</span>
      <button type="button" class="btn ghost" data-cancel disabled>Cancel</button>
      <button type="button" class="btn primary" data-save disabled>Save access</button></div></div>`;
  const box = panel.querySelector<HTMLElement>('#apPerms')!;
  const ed = wirePerms(box, start, tools);
  page.perms = ed;
  const bar = panel.querySelector<HTMLElement>('#apSave')!;
  const save = bar.querySelector<HTMLButtonElement>('[data-save]')!;
  const cancel = bar.querySelector<HTMLButtonElement>('[data-cancel]')!;
  const same = (): boolean => JSON.stringify(ed.read()) === JSON.stringify({ scopes: start.scopes, tools: Array.isArray(start.tools) ? [...start.tools].sort() : start.tools });
  const sync = (): void => {
    const dirty = !same();
    bar.classList.toggle('dirty', dirty);
    bar.querySelector('.msg')!.textContent = dirty ? 'Unsaved changes' : 'No changes';
    save.disabled = !dirty;
    cancel.disabled = !dirty;
  };
  // The editor repaints itself on clicks; read the result just after.
  box.addEventListener('click', () => setTimeout(sync, 0));
  box.addEventListener('keydown', () => setTimeout(sync, 0));
  cancel.onclick = () => void paintAccess(panel, key() || k);
  save.onclick = async () => {
    const why = ed.problem();
    if (why) {
      toast(why, 'warn');
      return;
    }
    const p = ed.read();
    save.disabled = true;
    try {
      await updateKeyPermissions({ id: k.id, scopes: p.scopes, tools: p.tools });
      toast('Access saved for ' + nameOf(k), 'ok');
      await loadAgents(true);
      if (P === page && page.tab === 'access') void paintAccess(panel, key() || k);
    } catch (e) {
      save.disabled = false;
      toast('Could not save access: ' + (e as Error).message, 'err', 5200);
    }
  };
}

function previewHTML(name: string, color: string, sub: string): string {
  return `${avatarHTML(name || '?', 44).replace(/--ag:[^;]+;/, `--ag:${color};`)}<span><b>${esc(name || 'Agent')}</b><small>${esc(sub)}</small></span>`;
}

function paintSettings(panel: HTMLElement, k: KeyRowFull): void {
  panel.innerHTML = `<div class="ap-set">
    <section class="ap-card"><div class="ap-card-h"><h2>Name &amp; colour</h2></div>
      <form class="ap-namef" id="apName"><div class="ap-prev" id="apPrev"></div>
        <div class="ui-fld"><label for="apN">Name</label><input id="apN" class="ui-input" type="text" autocomplete="off" spellcheck="false" maxlength="64" value="${attr(
          k.name || '',
        )}"><span class="ui-help">Past activity keeps the old name; new activity uses this one.</span></div>
        <div class="ui-fld"><span class="ui-lbl">Colour</span>${colorPickHTML('apColor', k.color || '', { auto: true })}
          <span class="ui-help">On its avatar, its sparks in the brain and every activity row.</span></div>
        <div class="acts"><button type="submit" class="btn primary">Save</button></div></form></section>
    <div id="apLive" style="display:flex;flex-direction:column;gap:16px;min-width:0"></div>
    <section class="ap-card ap-danger full"><div class="ap-card-h"><h2>Danger zone</h2></div>
      <div class="ap-row"><span class="tx"><b>Delete this agent</b><small>Its key stops working at once. Past activity stays; you can restore it until you reload the app.</small></span>
        <button type="button" class="btn danger" data-s="delete">${ICO_TRASH}Delete agent</button></div></section></div>`;
  const form = panel.querySelector<HTMLFormElement>('#apName')!;
  const input = form.querySelector<HTMLInputElement>('#apN')!;
  const prev = (): void => {
    const n = input.value.trim() || nameOf(k);
    const picked = form.querySelector<HTMLElement>('#apColor')!.dataset.value;
    form.querySelector<HTMLElement>('#apPrev')!.innerHTML = previewHTML(n, picked || agentColor(n, null), picked ? 'Chosen colour' : 'Automatic colour from the name');
  };
  wireColorPick(form, 'apColor', prev);
  input.oninput = prev;
  prev();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const cur = key() || k;
    const name = input.value.trim();
    const color = form.querySelector<HTMLElement>('#apColor')!.dataset.value || '';
    if (!name) {
      toast('The name cannot be empty', 'warn');
      input.focus();
      return;
    }
    if (name === (cur.name || '') && color === (cur.color || '')) {
      toast('Nothing to save', 'info', 1600);
      return;
    }
    try {
      if (name !== (cur.name || '')) await apiPost(KEY_PATHS.update, { id: cur.id, name });
      if (color !== (cur.color || '')) await apiPost(KEY_PATHS.update, { id: cur.id, color });
      toast('Saved', 'ok');
      await loadKeys();
      await loadAgents(true);
    } catch (err) {
      toast('Could not save: ' + (err as Error).message, 'err');
    }
  };
  panel.querySelector<HTMLElement>('[data-s=delete]')!.onclick = () => delKey(key() || k, () => navAgents(''));
  paintSettingsLive();
}

/** The key and on/off cards, which follow the data (the name form keeps what is typed). */
function paintSettingsLive(): void {
  const box = P?.root.querySelector<HTMLElement>('#apLive');
  const k = key();
  if (!box || !k) return;
  const off = k.enabled === false;
  const signed = data.oauth.has(k.id);
  box.innerHTML = `<section class="ap-card"><div class="ap-card-h"><h2>Key</h2></div>
      <div class="ap-row"><span class="tx"><b>${k.revealable ? 'Can be shown again' : signed ? 'Held by the app' : 'Shown once'}</b><small>${
        k.revealable ? 'Your password shows it again.' : signed ? 'The app signed in and holds its own token.' : 'It was shown when it was made. Make a new key to see one again.'
      }</small></span>${k.revealable ? `<button type="button" class="btn" data-s="reveal">${ICO_EYE}Show key</button>` : ''}</div>
      <div class="ap-row"><span class="tx"><b>Make a new key</b><small>The current key stops working at once; the setup guide gets the new one.</small></span>
        <button type="button" class="btn" data-s="roll">${ICO.key}Make a new key</button></div>
      <details class="ap-tech" style="border-top:1px solid var(--line)"><summary>${ICO_CHEV}Technical details<small>Key ID, last IP</small></summary>
        <div class="ap-card-b"><dl class="ap-kv">${techRows(k)}</dl></div></details></section>
    <section class="ap-card"><div class="ap-card-h"><h2>Status</h2></div>
      <div class="ap-row"><span class="tx"><b>${off ? 'Turned off' : 'Turned on'}</b><small>${
        off ? 'Its key is refused. Turn it on to let it connect again with the same key.' : 'Turn it off to block it without deleting anything.'
      }</small></span><button type="button" class="btn" data-s="toggle">${off ? ICO.check + 'Turn on' : ICO_POWER + 'Turn off'}</button></div></section>`;
  wireCopy(box);
  box.querySelectorAll<HTMLElement>('[data-s]').forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.s;
      if (a === 'reveal') return openReveal(k);
      if (a === 'roll') return rollKey(k, () => go('setup'));
      if (a === 'toggle') return void toggleKey(k);
    };
  });
}
