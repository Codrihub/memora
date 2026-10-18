// One agent's own page, at /agents/<key id>. A header (who it is, the one app
// it belongs to, whether it is working) and five tabs, each with its own
// address (/agents/<id>/setup and so on):
// - Overview: calls, last call and IP, recent calls, access and key;
// - Setup: the setup guide of its app, with its key filled in. An agent's app
//   is picked once (or a guess from its name confirmed) and then never
//   changes: another app gets its own agent;
// - Activity: its calls by day, with status, time and search filters;
// - Access: the permissions editor, saved from a bar at the bottom;
// - Settings: rename & colour, show key, make a new key, turn off, delete.

import { apiPost, updateKeyPermissions } from '../api';
import { attr, esc, useStyles } from '../dom';
import { debounce, fmtTs, noteName } from '../format';
import { AGENT_TABS } from '../router';
import { state } from '../state';
import { toast } from '../toast';
import { agentColor, avatarHTML } from '../control/agents';
import { wireActRows, fmtMs } from '../control/activity';
import { setAgentApp } from '../control/agent-apps';
import { appById, appIconHTML, mountConnectWizard, snippets, type ClientSnippet, type Wizard } from '../control/connect';
import { onLive, pushLive, verb, type ActivityItem } from '../control/feed';
import { loadCatalog, permsHTML, SCOPES, summarize, wirePerms, type PermEditor } from '../control/perms';
import { ago, clock, ICO, openMenu, sparkSVG, whileVisible, wireCopy } from '../control/ui';
import { colorPickHTML, wireColorPick } from '../ui/color-pick';
import { skBlock } from '../ui/skeleton';
import { onAgents, loadKeys } from '../realtime';
import { fetchAgentEvents } from './activity-agent';
import { catOf, type Cat } from './activity-model';
import { CAT_COLOR, dayTitle } from './activity-views';
import { isoDay } from './activity-model';
import {
  agentsHref,
  appFor,
  bumpSeen,
  connectKey,
  createAgent,
  data,
  delKey,
  freshSecrets,
  goActivity,
  ICO_ACTIVITY,
  ICO_BACK,
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

const CSS = `
.ap{container:ap/inline-size;--ap-pt:24px;--ap-pb:64px}
.ap a.btn{text-decoration:none}
.ap-crumb{display:flex;align-items:center;gap:8px;margin:-6px 0 10px}
.ap-back{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px 0 9px;margin-left:-2px;border-radius:10px;font-size:13px;font-weight:620;
  color:var(--text-2);text-decoration:none;border:1px solid transparent}
.ap-back:hover{color:var(--fg);background:var(--hover);text-decoration:none}
.ap-back:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ap-back .cc-i{width:16px;height:16px}

/* header */
.ap-head{display:flex;align-items:center;gap:16px;min-width:0;margin:0}
.ap-head .ag-av{flex:none;font-weight:760}
.ap-id{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px}
.ap-id h1{margin:0;font-size:24px;font-weight:740;letter-spacing:-.4px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;outline:none}
.ap-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;font-size:13px;color:var(--muted);min-width:0}
.ap-app{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 10px 0 4px;border-radius:9px;border:1px solid var(--line);
  background:var(--surface-2);color:var(--fg);font-size:12.5px;font-weight:650;white-space:nowrap;max-width:100%}
.ap-app>span:not(.cn-app){overflow:hidden;text-overflow:ellipsis}
.ap-app .cc-i{width:13px;height:13px;color:var(--muted);margin-left:1px}
.ap-app.none{padding-left:10px;border-style:dashed;color:var(--muted)}
.ap-st{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.ap-st b{color:var(--fg);font-weight:650}
.ap-st.off b{color:var(--danger)}
.ap-acts{display:flex;align-items:center;gap:8px;flex:none}
.ap-acts .btn{height:38px;border-radius:11px}
.ap-acts .cc-ibtn{width:38px;height:38px;border:1px solid var(--line);border-radius:11px}

/* tabs */
.ap-tabs{position:sticky;top:calc(-1 * var(--ap-pt));z-index:6;margin:0 0 20px;padding:var(--ap-pt) 0 0;transition:background .15s}
.ap-tabs.stuck{background:color-mix(in srgb,var(--bg) 88%,transparent);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.ap-tabs-in{display:flex;gap:2px;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
.ap-tabs-in::-webkit-scrollbar{display:none}
.ap-tab{position:relative;display:inline-flex;align-items:center;gap:7px;height:42px;padding:0 14px;font-size:13.5px;font-weight:620;
  color:var(--muted);white-space:nowrap;border-radius:9px 9px 0 0;flex:none}
.ap-tab:hover{color:var(--fg);background:var(--hover)}
.ap-tab[aria-selected=true]{color:var(--fg)}
.ap-tab[aria-selected=true]::after{content:"";position:absolute;left:10px;right:10px;bottom:-1px;height:2px;border-radius:2px;background:var(--accent)}
.ap-tab:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ap-tab .n{display:inline-grid;place-items:center;min-width:19px;height:19px;padding:0 5px;border-radius:99px;font-size:11px;font-weight:700;
  color:var(--danger);background:var(--danger-soft)}
.ap-panel{outline:none;min-width:0}
.ap [hidden]{display:none!important}

/* banners */
.ap-ban{display:flex;align-items:center;gap:12px;padding:12px 14px;margin:0 0 16px;border-radius:12px;font-size:13px;line-height:1.5;
  border:1px solid var(--line);background:var(--surface-2)}
.ap-ban .tx{flex:1;min-width:0}
.ap-ban b{display:block;font-size:13.5px;color:var(--fg)}
.ap-ban small{display:block;color:var(--muted);font-size:12.5px}
.ap-ban .ic{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;flex:none;background:var(--accent-soft);color:var(--accent)}
.ap-ban.off{border-color:color-mix(in srgb,var(--danger) 35%,var(--line));background:color-mix(in srgb,var(--danger) 6%,var(--surface-1))}
.ap-ban.off .ic{background:var(--danger-soft);color:var(--danger)}
.ap-ban .btn{flex:none;height:36px;border-radius:10px}

/* overview */
.ap-stats{display:grid;grid-template-columns:minmax(0,1.35fr) repeat(3,minmax(0,1fr));margin:0 0 16px;background:var(--panel);
  border:1px solid var(--line);border-radius:var(--r-lg)}
.ap-stat{display:flex;flex-direction:column;gap:4px;padding:14px 18px;min-width:0;border-left:1px solid var(--line)}
.ap-stat:first-child{border-left:0}
.ap-stat .k{font-size:12px;font-weight:600;color:var(--muted);white-space:nowrap}
.ap-stat .v{display:flex;align-items:center;gap:10px;font-size:22px;font-weight:720;letter-spacing:-.02em;line-height:1.2;font-variant-numeric:tabular-nums;
  min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-stat .v.sm{font-size:15px;font-weight:650;letter-spacing:0}
.ap-stat .v.mono{font:600 13.5px/1.75 var(--mono)}
.ap-stat .h{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ap-stat .sp{flex:1;min-width:40px;max-width:120px;height:24px}
.ap-stat .sp .cc-spark{height:24px}
.ap-cols{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(280px,1fr);gap:16px;align-items:start}
.ap-side{display:flex;flex-direction:column;gap:16px;min-width:0}
.ap-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg);min-width:0}
.ap-card-h{display:flex;align-items:center;gap:10px;padding:13px 16px 11px;min-height:48px;border-bottom:1px solid var(--line)}
.ap-card-h h2{margin:0;font-size:13.5px;font-weight:680;flex:1;min-width:0}
.ap-card-h .sub{font-size:12px;color:var(--muted)}
.ap-card-b{padding:14px 16px}
.ap-link{display:inline-flex;align-items:center;gap:5px;padding:0;font-size:12.5px;font-weight:640;color:var(--accent);background:none;
  white-space:nowrap;text-decoration:none}
.ap-link:hover{text-decoration:underline;text-underline-offset:3px}
.ap-link .cc-i{width:14px;height:14px}
.ap-appc{display:flex;align-items:center;gap:12px}
.ap-appc .tx{flex:1;min-width:0}
.ap-appc b{display:block;font-size:14px;font-weight:660}
.ap-appc small{display:block;font-size:12px;color:var(--muted)}
.ap-hint{margin:10px 0 0;font-size:12px;color:var(--muted);line-height:1.5}
.ap-acc b{display:block;font-size:14px;font-weight:660}
.ap-acc.warn b{color:var(--warn)}
.ap-acc.none b{color:var(--danger)}
.ap-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.ap-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:99px;font-size:11.5px;font-weight:620;
  color:var(--text-2);background:var(--surface-2);border:1px solid var(--line)}
.ap-chip.admin{color:var(--warn);background:var(--warn-soft);border-color:color-mix(in srgb,var(--warn) 40%,transparent)}
.ap-kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 14px;margin:0;font-size:12.5px}
.ap-kv dt{color:var(--muted)}
.ap-kv dd{margin:0;min-width:0;display:flex;align-items:center;gap:6px;color:var(--fg)}
.ap-kv code{font:500 12px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-kv .cc-ibtn{width:26px;height:26px;margin:-4px 0}
.ap-kv .cc-ibtn svg{width:14px;height:14px}

/* events */
.ap-evs{list-style:none;margin:0;padding:0}
.ap-ev{display:grid;grid-template-columns:28px minmax(0,1fr) auto minmax(64px,auto);grid-template-areas:"ic main st t";align-items:center;gap:12px;
  padding:9px 16px;min-height:50px;border-top:1px solid var(--line);cursor:pointer;transition:background .12s}
.ap-ev:first-child{border-top:0}
.ap-ev:hover{background:var(--hover)}
.ap-ev:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ap-ev-ic{grid-area:ic;display:grid;place-items:center;width:28px;height:28px;border-radius:8px;color:var(--c);
  background:color-mix(in srgb,var(--c) 13%,transparent);border:1px solid color-mix(in srgb,var(--c) 28%,transparent)}
.ap-ev-ic .cc-i{width:14px;height:14px}
.ap-ev-m{grid-area:main;display:flex;align-items:baseline;gap:4px 10px;min-width:0;flex-wrap:wrap}
.ap-ev-m b{font-size:13.5px;font-weight:620;white-space:nowrap}
.ap-ev-p{display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:100%;padding:1px 7px 1px 5px;border-radius:7px;font-size:12px;font-weight:560;
  color:var(--text-2);background:var(--surface-2);border:1px solid var(--line)}
.ap-ev-p:hover{color:var(--accent);border-color:var(--accent-line)}
.ap-ev-p .cc-i{width:12px;height:12px;color:var(--muted);flex:none}
.ap-ev-p span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-ev-l{font-size:12.5px;color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.ap-ev-more{font-size:11.5px;color:var(--muted)}
.ap-ev-st{grid-area:st;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--muted);white-space:nowrap;
  font-variant-numeric:tabular-nums}
.ap-ev-st i{width:7px;height:7px;border-radius:50%;background:var(--ok)}
.ap-ev-st.fail{color:var(--danger)}
.ap-ev-st.fail i{background:var(--danger)}
.ap-ev-st.run i{background:var(--accent);animation:ccBlink 1s ease-in-out infinite}
.ap-ev-t{grid-area:t;font-size:12px;color:var(--muted);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.ap-ev.fail b{color:var(--danger)}
.ap-ev.new{animation:apIn .8s var(--ease)}
@keyframes apIn{from{background:color-mix(in srgb,var(--accent) 14%,transparent)}to{background:transparent}}
.ap-empty{padding:30px 18px;text-align:center;color:var(--muted);font-size:13px;line-height:1.6}
.ap-empty b{display:block;color:var(--fg);font-size:14px;margin-bottom:2px}
.ap-empty .btn{margin-top:12px}
.ap-sk{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--line)}
.ap-sk:first-child{border-top:0}

/* activity tab */
.ap-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px}
.ap-bar .cc-search{max-width:none;flex:1 1 300px;height:36px}
.ap-bar .cc-seg button{min-height:28px}
.ap-sum{display:flex;align-items:center;gap:6px 14px;flex-wrap:wrap;margin:0 0 12px;font-size:12.5px;color:var(--muted)}
.ap-sum b{color:var(--fg);font-variant-numeric:tabular-nums}
.ap-sum .bad b{color:var(--danger)}
.ap-sum .grow{flex:1}
.ap-day{display:flex;align-items:baseline;gap:10px;margin:0;padding:10px 16px;font-size:13px;font-weight:680;border-top:1px solid var(--line);
  background:color-mix(in srgb,var(--surface-2) 55%,transparent)}
.ap-day:first-child{border-top:0;border-radius:var(--r-lg) var(--r-lg) 0 0}
.ap-day small{font-size:12px;font-weight:500;color:var(--muted)}
.ap-day .n{margin-left:auto;font-size:12px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}
.ap-day+.ap-evs .ap-ev:first-child{border-top:1px solid var(--line)}
.ap-ev .clk{font-weight:600;color:var(--text-2)}
.ap-ev .clk::after{content:" · ";font-weight:400;color:var(--muted)}
.ap-moreb{display:flex;justify-content:center;padding:12px;border-top:1px solid var(--line)}

/* setup tab */
.ap-lock{display:flex;align-items:center;gap:14px;padding:14px 16px;margin:0 0 16px}
.ap-lock .tx{flex:1;min-width:0}
.ap-lock b{display:flex;align-items:center;gap:7px;font-size:14.5px;font-weight:680}
.ap-lock b .cc-i{width:14px;height:14px;color:var(--muted)}
.ap-lock small{display:block;margin-top:2px;font-size:12.5px;color:var(--muted);line-height:1.5}
.ap-lock .btn{flex:none;height:36px;border-radius:10px}
.ap-wz{padding:20px 22px 0}
.ap-wz-f{display:flex;align-items:center;gap:8px;margin:18px -22px 0;padding:12px 22px;border-top:1px solid var(--line)}
.ap-wz-f .grow{flex:1}
.ap-wz-f .btn{height:38px;border-radius:10px}
.ap-ask{padding:22px}
.ap-ask h2{margin:0;font-size:18px;font-weight:700;letter-spacing:-.015em;outline:none}
.ap-ask>p{margin:5px 0 16px;font-size:13px;color:var(--muted);line-height:1.55;max-width:70ch}
.ap-guess{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.ap-guess .tx{flex:1 1 260px;min-width:0}
.ap-guess .acts{display:flex;gap:8px;flex-wrap:wrap}
.ap-guess .btn{height:40px;border-radius:11px}
.ap-pq{position:relative;display:block;margin:0 0 14px;max-width:420px}
.ap-pq svg{position:absolute;left:12px;top:50%;width:16px;height:16px;margin-top:-8px;color:var(--muted);pointer-events:none}
.ap-pq .ui-input{padding-left:38px}
.ap-pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
.ap-ptile{display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:12px;min-width:0;text-align:left;
  border:1px solid var(--line);background:var(--surface-0);color:var(--fg);transition:border-color .15s,background .15s}
.ap-ptile:hover{border-color:var(--line-strong);background:var(--surface-2)}
.ap-ptile:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-soft);border-color:var(--accent-line)}
.ap-ptile .tx{min-width:0}
.ap-ptile b{display:block;font-size:13.5px;font-weight:640;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-ptile small{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-pnone{margin:6px 0 0;font-size:13px;color:var(--muted)}

/* access tab */
.ap-acc-ed{padding:18px 20px 4px}
.ap-save{position:sticky;bottom:calc(-1 * var(--ap-pb));z-index:5;display:flex;align-items:center;gap:8px;margin:16px 0 0;padding:12px 0}
.ap-save-in{display:flex;align-items:center;gap:10px;width:100%;padding:10px 10px 10px 16px;border-radius:14px;border:1px solid var(--line-strong);
  background:var(--surface-1);box-shadow:var(--shadow)}
.ap-save .msg{flex:1;min-width:0;font-size:13px;color:var(--muted)}
.ap-save.dirty .msg{color:var(--fg);font-weight:600}
.ap-save .btn{height:38px;border-radius:10px}

/* settings tab */
.ap-set{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
.ap-set .full{grid-column:1/-1}
.ap-row{display:flex;align-items:center;gap:14px;padding:13px 16px;border-top:1px solid var(--line);min-height:62px}
.ap-row:first-child{border-top:0}
.ap-row .tx{flex:1;min-width:0}
.ap-row .tx b{display:block;font-size:13.5px;font-weight:640}
.ap-row .tx small{display:block;margin-top:2px;font-size:12.5px;color:var(--muted);line-height:1.45}
.ap-row code{font:500 12.5px var(--mono);color:var(--fg);word-break:break-all}
.ap-row .btn{flex:none;height:36px;border-radius:10px}
.ap-row .cc-ibtn{border:1px solid var(--line);width:36px;height:36px}
.ap-prev{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;background:var(--surface-2);border:1px solid var(--line);margin:0 0 16px}
.ap-prev b{display:block;font-size:14.5px}
.ap-prev small{display:block;font-size:12px;color:var(--muted)}
.ap-namef{padding:16px}
.ap-namef .acts{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.ap-namef .btn{height:38px;border-radius:10px}
.ap-danger{border-color:color-mix(in srgb,var(--danger) 35%,var(--line))}
.ap-danger .ap-card-h h2{color:var(--danger)}
.ap-nf{max-width:560px;margin:40px auto;text-align:center;padding:36px 24px}
.ap-nf h1{margin:0 0 6px;font-size:20px}
.ap-nf p{margin:0 0 18px;color:var(--muted);font-size:13.5px;line-height:1.6}
.ap-nf code{font:600 12.5px var(--mono);color:var(--fg)}
.ap-nf .acts{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}

/* tablet */
@container ap (max-width:979px){
  .ap-cols{grid-template-columns:minmax(0,1fr)}
  .ap-side{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
  .ap-side>:last-child:nth-child(odd){grid-column:1/-1}
}
@container ap (max-width:719px){
  .ap-set{grid-template-columns:minmax(0,1fr)}
}
@container ap (max-width:639px){
  .ap-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ap-stat:nth-child(3){border-left:0}
  .ap-stat:nth-child(n+3){border-top:1px solid var(--line)}
}
/* phone */
@container ap (max-width:599px){
  .ap-head{align-items:flex-start;gap:12px}
  .ap-head .ag-av{width:44px!important;height:44px!important;font-size:17px!important}
  .ap-acts{gap:6px}
  .ap-acts .btn{width:40px;height:40px;padding:0}
  .ap-acts .btn .l{display:none}
  .ap-acts .btn .cc-i{margin:0}
  .ap-acts .cc-ibtn{width:40px;height:40px}
  .ap-id{gap:6px}
  .ap-id h1{font-size:20px;white-space:normal;overflow-wrap:anywhere}
  .ap-meta{gap:6px 10px}
  .ap-tabs{margin:0 -14px 16px;padding-left:14px;padding-right:14px}
  .ap-tabs-in{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 20px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 20px),transparent)}
  .ap-tab{padding:0 8px;height:44px;font-size:13px}
  .ap-tab:last-child{margin-right:16px}
  .ap-side{grid-template-columns:minmax(0,1fr)}
  .ap-stat{padding:12px 14px}
  .ap-stat .v{font-size:19px}
  .ap-stat .sp{display:none}
  .ap-ev{grid-template-columns:28px minmax(0,1fr) auto;grid-template-areas:"ic main t" "ic sub st";gap:3px 10px;padding:10px 12px}
  .ap-ev-m{display:contents}
  .ap-ev-m b{grid-area:main;overflow:hidden;text-overflow:ellipsis}
  .ap-ev-m .ap-ev-p,.ap-ev-m .ap-ev-l{grid-area:sub;justify-self:start}
  .ap-ev-m .ap-ev-more,.ap-ev-m .ap-ev-p~.ap-ev-p{display:none}
  .ap-ev-ic{align-self:start;margin-top:2px}
  .ap-ev-t{align-self:baseline}
  .ap-day{padding:10px 12px}
  .ap-bar .cc-search{flex-basis:100%;order:-1}
  .ap-bar .cc-seg{flex:1 1 auto}
  .ap-bar .cc-seg button{flex:1}
  .ap-lock{flex-wrap:wrap;align-items:flex-start;padding:14px}
  .ap-lock .tx{flex:1 1 calc(100% - 60px)}
  .ap-lock .btn{margin-left:54px;height:36px}
  .ap-wz{padding:16px 14px 0}
  .ap-wz-f{margin:16px -14px 0;padding:10px 14px}
  .ap-wz-f .btn{flex:1;height:44px}
  .ap-ask{padding:16px 14px}
  .ap-guess .acts{width:100%}
  .ap-guess .acts .btn{flex:1;height:44px}
  .ap-pgrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
  .ap-ptile{padding:10px;gap:9px}
  .ap-acc-ed{padding:14px 12px 2px}
  .ap-save-in{column-gap:84px;padding:8px}
  .ap-save .btn{flex:1;height:44px}
  .ap-save .msg{display:none}
  .ap-row{flex-wrap:wrap;padding:12px 14px}
  .ap-row .btn{flex:1 1 auto;height:42px}
  .ap-ban{flex-wrap:wrap}
  .ap-ban .btn{width:100%;height:42px}
}
@media (max-width:760px){.ap{--ap-pt:16px;--ap-pb:32px}}
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

/** Activity tab filters, kept while the page is open. */
const F = { status: 'all' as 'all' | 'ok' | 'fail', range: '7d', q: '', limit: 80 };

let P: Page | null = null;

/** The page's styles; the new-agent page shares its header, cards and back link. */
export function useAgentPageStyles(): void {
  useStyles('agent-page-css', CSS);
}

export async function renderAgentPage(host: HTMLElement, id: string, tab: string): Promise<void> {
  useAgentPageStyles();
  const t: Tab = (AGENT_TABS as readonly string[]).includes(tab) ? (tab as Tab) : 'overview';
  if (P && P.id === id && P.root.isConnected && host.contains(P.root)) {
    if (P.tab !== t) showTab(t, true);
    return;
  }
  P?.wizard?.destroy();
  F.status = 'all';
  F.range = '7d';
  F.q = '';
  F.limit = 80;
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
  return `<div class="ap-crumb">${skBlock('80px', 20)}</div><div class="ap-head" aria-busy="true">${skBlock('56px', 56, 'r')}
    <div class="ap-id">${skBlock('min(260px,60%)', 24)}${skBlock('min(340px,80%)', 14)}</div></div>
    <div class="ap-card" style="margin-top:20px">${'<div class="ap-sk">' + skBlock('28px', 28) + skBlock('40%', 12) + '</div>'}${'<div class="ap-sk">' + skBlock('28px', 28) + skBlock('55%', 12) + '</div>'}</div>`;
}

/** Draw the page around the current tab (first paint, or the agent is back after a reload). */
function mount(focus: boolean): void {
  if (!P) return;
  const k = key();
  const crumb = `<nav class="ap-crumb" aria-label="Breadcrumb"><a class="ap-back" href="/agents" data-nav="">${ICO_BACK}Agents</a></nav>`;
  if (!k) {
    const gone = state.keysDeleted.find((x) => x.id === P!.id);
    P.root.innerHTML = `${crumb}<div class="ap-card ap-nf"><h1 tabindex="-1">${gone ? `${esc(nameOf(gone))} was deleted` : 'No agent at this address'}</h1>
      <p>${
        gone
          ? 'Its key stopped working. You can restore it until you reload the app.'
          : `There is no agent with the key id <code>${esc(P.id)}</code>. It may have been deleted; its past calls stay in Activity.`
      }</p><div class="acts">${gone ? `<button type="button" class="btn primary" data-restore>${ICO_RESTORE}Restore</button>` : ''}
      <a class="btn" href="/activity/${attr(encodeURIComponent(P.id))}" data-act-page>Its activity</a><a class="btn" href="/agents" data-nav="">All agents</a></div></div>`;
    wireAgentLinks(P.root);
    const rb = P.root.querySelector<HTMLElement>('[data-restore]');
    if (rb) rb.onclick = () => void restoreKey(P!.id);
    const ap = P.root.querySelector<HTMLAnchorElement>('[data-act-page]');
    if (ap)
      ap.onclick = (e) => {
        e.preventDefault();
        goActivity({ id: P!.id });
      };
    document.title = 'Agent not found · Memora';
    if (focus) P.root.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    return;
  }
  const tabs = AGENT_TABS.map(
    (t) =>
      `<button type="button" role="tab" class="ap-tab" id="apTab-${t}" data-tab="${t}" aria-controls="apPanel" aria-selected="${t === P!.tab}" tabindex="${
        t === P!.tab ? 0 : -1
      }">${TAB_LABEL[t]}</button>`,
  ).join('');
  P.root.style.setProperty('--ag', agentColor(nameOf(k), k.id));
  P.root.innerHTML = `${crumb}<header class="ap-head" id="apHead"></header>
    <div class="ap-tabs"><div class="ap-tabs-in" role="tablist" aria-label="${attr(nameOf(k))}">${tabs}</div></div>
    <section class="ap-panel" id="apPanel" role="tabpanel" aria-labelledby="apTab-${P.tab}" tabindex="-1"></section>`;
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

// ── header ──────────────────────────────────────────────────────────────

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
  )}<span>${esc(app.label)}${locked ? '' : '?'}</span>${locked ? ICO_LOCK : ''}</span>`;
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
  head.innerHTML = `${avatarHTML(name, 56, s.st === 'active' ? 'live' : '', k.id)}
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
      { label: 'Charts & export', desc: 'Its full Activity page.', icon: ICO_ACTIVITY, run: () => goActivity(k) },
      { sep: true, label: '' },
      { label: 'Delete', desc: 'Remove the agent; its key stops working at once.', icon: ICO_TRASH, danger: true, run: () => delKey(k, () => navAgents('')) },
    ],
    { title: name, lead: avatarHTML(name, 30, '', k.id) },
  );
}

// ── tabs ────────────────────────────────────────────────────────────────

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
    view.scrollTop = Math.max(0, tabsBox.offsetTop - 0);
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
  if (P!.tab === 'overview') paintOverview(panel, k);
  else if (P!.tab === 'setup') paintSetup(panel, k);
  else if (P!.tab === 'activity') paintActivity(panel);
  else if (P!.tab === 'access') void paintAccess(panel, k);
  else paintSettings(panel, k);
  wireAgentLinks(panel);
}

// ── events ──────────────────────────────────────────────────────────────

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
  else if (page.tab === 'activity') paintActList();
}

function isMine(it: ActivityItem): boolean {
  const k = key();
  if (!k) return false;
  const kid = typeof it.raw.actor_id === 'string' ? it.raw.actor_id : null;
  return kid ? kid === k.id : it.actor === nameOf(k);
}

let livePaint = 0;
function live(it: ActivityItem): void {
  if (!P || !P.events || !isMine(it)) return;
  P.fresh.add(it.id);
  pushLive(P.events, it);
  if (livePaint) return;
  livePaint = window.setTimeout(() => {
    livePaint = 0;
    if (!P) return;
    if (P.tab === 'overview') paintRecent();
    else if (P.tab === 'activity') paintActList();
    P.fresh.clear();
  }, 300);
}

function evRowHTML(it: ActivityItem, withClock = false): string {
  const cat = catOf(it);
  const paths = it.paths.slice(0, 2);
  const label = it.label && !it.paths.includes(it.label) ? it.label : '';
  const st = it.running
    ? '<span class="ap-ev-st run"><i></i>Running</span>'
    : it.ok === false
      ? '<span class="ap-ev-st fail"><i></i>Failed</span>'
      : it.ok === true || it.ms != null
        ? `<span class="ap-ev-st"><i></i>${it.ms != null ? esc(fmtMs(it.ms)) : 'OK'}</span>`
        : '<span class="ap-ev-st"></span>';
  const rel = ago(it.ts);
  return `<li class="ap-ev${it.ok === false ? ' fail' : ''}${P?.fresh.has(it.id) ? ' new' : ''}" role="button" tabindex="0" data-act="${attr(it.id)}"
    aria-label="${attr(`${verb(it.action)}${paths.length ? ' ' + paths.join(', ') : label ? ' ' + label : ''}${it.ok === false ? ', failed' : ''}, ${fmtTs(it.ts)}`)}">
    <span class="ap-ev-ic" style="--c:${CAT_COLOR[cat]}">${ICO_CAT[cat]}</span>
    <span class="ap-ev-m"><b>${esc(verb(it.action))}</b>${paths
      .map((p) => `<button type="button" class="ap-ev-p" data-note="${attr(p)}" title="${attr(p)}">${ICO.note}<span>${esc(noteName(p))}</span></button>`)
      .join('')}${it.paths.length > 2 ? `<span class="ap-ev-more">+${it.paths.length - 2}</span>` : ''}${
      !paths.length && label ? `<span class="ap-ev-l" title="${attr(label)}">${esc(label)}</span>` : ''
    }</span>${st}
    <span class="ap-ev-t" title="${attr(fmtTs(it.ts))}">${withClock ? `<span class="clk">${clock(it.ts)}</span>` : ''}${rel === 'now' ? 'now' : rel + ' ago'}</span></li>`;
}

function evSkeleton(n: number): string {
  return Array.from({ length: n }, (_, i) => `<div class="ap-sk">${skBlock('28px', 28)}${skBlock(30 + ((i * 17) % 40) + '%', 12)}</div>`).join('');
}

// ── overview ────────────────────────────────────────────────────────────

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
      <div class="ap-stat"><span class="k">Last IP</span><span class="v mono" title="${attr(k.last_ip || '')}">${esc(k.last_ip || 'None yet')}</span><span class="h">${
        signed ? 'Signed in over OAuth' : 'Where its last call came from'
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
              ? `<div class="ap-appc">${appIconHTML(c.label, 38)}<span class="tx"><b>${esc(c.label)}${app.guessed ? ' <span class="cc-muted" style="font-weight:500">(guessed)</span>' : ''}</b><small>${esc(
                  c.kind,
                )} · ${esc(c.how)}</small></span></div><p class="ap-hint">${
                  app.guessed
                    ? 'Guessed from its name. Confirm it in Setup; after that it stays with this agent.'
                    : 'Each agent belongs to one app. For another app or device, make a new agent.'
                }</p>`
              : `<div class="ap-appc">${appIconHTML('', 38)}<span class="tx"><b>Not set</b><small>Pick it once in Setup</small></span></div>
                <p class="ap-hint"><a class="ap-link" href="${attr(agentsHref(k.id + '/setup'))}" data-nav="${attr(k.id + '/setup')}">Pick its app ${ICO.arrow}</a></p>`
          }</div></section>
        <section class="ap-card"><div class="ap-card-h"><h2>Access</h2><a class="ap-link" href="${attr(agentsHref(k.id + '/access'))}" data-nav="${attr(
          k.id + '/access',
        )}">Edit ${ICO.arrow}</a></div>
          <div class="ap-card-b ap-acc${p.tone ? ' ' + p.tone : ''}"><b>${esc(p.level)} · ${esc(p.tools)}</b>${
            chips || signed ? `<div class="ap-chips">${chips}${signed ? '<span class="ap-chip">Signed in</span>' : ''}</div>` : ''
          }</div></section>
        <section class="ap-card"><div class="ap-card-h"><h2>Key</h2></div><div class="ap-card-b"><dl class="ap-kv">
          <dt>Key ID</dt><dd><code title="${attr(k.id)}">${esc(k.id)}</code><button type="button" class="cc-ibtn" data-copy="${attr(k.id)}" aria-label="Copy the key ID" title="Copy">${
            ICO.copy
          }</button></dd>
          <dt>Stored</dt><dd>${k.revealable ? 'Sealed; your password shows it' : signed ? 'Held by the app (OAuth)' : 'Shown once when made'}</dd>
          ${k.created ? `<dt>Created</dt><dd>${esc(fmtTs(k.created))}</dd>` : ''}
        </dl></div></section>
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

// ── setup ───────────────────────────────────────────────────────────────

function paintSetup(panel: HTMLElement, k: KeyRowFull): void {
  P!.wizard?.destroy();
  P!.wizard = null;
  const name = nameOf(k);
  const app = appFor(k);
  if (!app.id || P!.picking) return paintPicker(panel, k);
  if (app.guessed) {
    const c = appById(app.id)!;
    panel.innerHTML = `<div class="ap-card ap-ask"><div class="ap-guess">${appIconHTML(c.label, 48)}<span class="tx">
        <h2 tabindex="-1">Is ${esc(name)} for ${esc(c.label)}?</h2><p style="margin:4px 0 0;font-size:13px;color:var(--muted);line-height:1.55">Guessed from its ${
          data.oauth.has(k.id) ? 'sign-in' : 'name'
        }. Confirm it to see the ${esc(c.label)} setup guide. Each agent belongs to one app, so this is asked only once.</p></span>
        <span class="acts"><button type="button" class="btn primary" data-yes>${ICO.check}Yes, it's ${esc(c.label)}</button>
        <button type="button" class="btn" data-other>Pick another</button></span></div></div>`;
    panel.querySelector<HTMLElement>('[data-yes]')!.onclick = () => void lockApp(k, app.id);
    panel.querySelector<HTMLElement>('[data-other]')!.onclick = () => {
      P!.picking = true;
      paintSetup(panel, k);
      panel.querySelector<HTMLElement>('#apPq')?.focus();
    };
    return;
  }
  const c = appById(app.id)!;
  panel.innerHTML = `<div class="ap-card ap-lock">${appIconHTML(c.label, 40)}<span class="tx"><b>${esc(c.label)}${ICO_LOCK}</b>
      <small>Each agent belongs to one app. To use Memora in another app, create a separate agent for it.</small></span>
      <a class="btn" href="/agents/new" data-nav="new">${ICO.plus}New agent</a></div>
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
    onAppChosen: (id, cl) => void setAgentApp(id, cl),
    onChange: () => void loadAgents(true),
    setNav: (n) => {
      back.style.visibility = n.back ? '' : 'hidden';
      // The last step needs no button: everything is on the page already.
      next.hidden = n.next === 'Done';
      next.textContent = n.next === 'Continue' ? 'Next: instructions' : n.next;
    },
  });
  P!.wizard = wz;
  back.onclick = () => wz.back();
  next.onclick = () => void wz.next();
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
    )}<span class="tx"><b>${esc(s.label)}</b><small>${esc(s.kind)} · ${esc(s.how)}</small></span></button>`;
  panel.innerHTML = `<div class="ap-card ap-ask"><h2 tabindex="-1">Which app is ${esc(name)} for?</h2>
    <p>Pick it once: the setup guide follows that app, with ${esc(name)}'s key filled in. It stays with this agent; for another app or device, make a new agent.</p>
    <label class="ap-pq">${ICO.search}<span class="sr-only">Search apps</span><input class="ui-input" type="search" id="apPq" placeholder="Search apps" autocomplete="off"></label>
    <div class="ap-pgrid" role="group" aria-label="Apps">${snippets().map(tile).join('')}</div>
    <p class="ap-pnone" id="apPnone" hidden>No app matches. <b>Any client</b> works with every MCP client.</p>
    ${appFor(k).id ? `<p style="margin:14px 0 0"><button type="button" class="ap-link" data-cancel>Keep the guess (${esc(appFor(k).label)})</button></p>` : ''}</div>`;
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

// ── activity ────────────────────────────────────────────────────────────

const RANGES: [string, string][] = [
  ['1d', '24 hours'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['all', 'All'],
];

function paintActivity(panel: HTMLElement): void {
  const seg = (group: string, items: [string, string][], on: string): string =>
    items.map(([v, l]) => `<button type="button" data-${group}="${v}" aria-pressed="${v === on}">${l}</button>`).join('');
  panel.innerHTML = `<div class="ap-bar">
      <label class="cc-search">${ICO.search}<span class="sr-only">Search this agent's calls</span><input id="apQ" type="search" placeholder="Search tools, nodes, details" autocomplete="off" spellcheck="false" value="${attr(
        F.q,
      )}"></label>
      <div class="cc-seg" role="group" aria-label="Status">${seg(
        'st',
        [
          ['all', 'All'],
          ['ok', 'OK'],
          ['fail', 'Failed'],
        ],
        F.status,
      )}</div>
      <div class="cc-seg" role="group" aria-label="Time">${seg('rg', RANGES, F.range)}</div></div>
    <div class="ap-sum" id="apSum" aria-live="polite"></div>
    <div class="ap-card" id="apDays">${evSkeleton(6)}</div>`;
  panel.querySelectorAll<HTMLButtonElement>('[data-st]').forEach(
    (b) =>
      (b.onclick = () => {
        F.status = b.dataset.st as typeof F.status;
        F.limit = 80;
        panel.querySelectorAll('[data-st]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        paintActList();
      }),
  );
  panel.querySelectorAll<HTMLButtonElement>('[data-rg]').forEach(
    (b) =>
      (b.onclick = () => {
        F.range = b.dataset.rg!;
        F.limit = 80;
        panel.querySelectorAll('[data-rg]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        const days = panel.querySelector<HTMLElement>('#apDays');
        if (days) days.innerHTML = evSkeleton(6);
        void loadEvents(F.range);
      }),
  );
  const q = panel.querySelector<HTMLInputElement>('#apQ')!;
  const apply = debounce(() => {
    F.q = q.value.trim().toLowerCase();
    F.limit = 80;
    paintActList();
  }, 140);
  q.oninput = apply;
  q.onkeydown = (e) => {
    if (e.key === 'Escape' && q.value) {
      e.stopPropagation();
      q.value = '';
      apply();
    }
  };
  const days = panel.querySelector<HTMLElement>('#apDays')!;
  wireActRows(days, (id) => P?.events?.find((x) => x.id === id));
  days.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-more]')) {
      F.limit += 120;
      paintActList();
    }
  });
  if (P!.events && P!.range === F.range) paintActList();
  void loadEvents(F.range);
}

function paintActList(): void {
  const box = P?.root.querySelector<HTMLElement>('#apDays');
  const sum = P?.root.querySelector<HTMLElement>('#apSum');
  const k = key();
  if (!box || !sum || !P!.events || !k) return;
  const since = F.range === '1d' ? Date.now() / 1000 - 86400 : 0;
  const scoped = P!.events.filter((x) => x.ts >= since);
  const rows = scoped.filter((x) => {
    if (F.status === 'ok' && x.ok === false) return false;
    if (F.status === 'fail' && x.ok !== false) return false;
    if (F.q) {
      const hay = (x.action + ' ' + verb(x.action) + ' ' + x.label + ' ' + x.paths.join(' ')).toLowerCase();
      if (!F.q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const fails = scoped.filter((x) => x.ok === false).length;
  sum.innerHTML = `<span><b>${rows.length.toLocaleString('en-US')}</b> ${rows.length === 1 ? 'call' : 'calls'}${
    rows.length !== scoped.length ? ` of ${scoped.length.toLocaleString('en-US')}` : ''
  }</span>${fails ? `<span class="bad"><b>${fails}</b> failed</span>` : ''}<span class="grow"></span>
    <a class="ap-link" href="/activity/${attr(encodeURIComponent(k.id))}" id="apFull">Charts &amp; export ${ICO.arrow}</a>`;
  const full = sum.querySelector<HTMLAnchorElement>('#apFull')!;
  full.onclick = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    goActivity(k);
  };
  if (!rows.length) {
    const any = scoped.length > 0;
    box.innerHTML = `<div class="ap-empty"><b>${any ? 'No call matches' : 'No calls in this range'}</b>${
      any ? 'Try another status or search.' : F.range !== 'all' ? 'Pick a longer range to see older calls.' : 'Calls show up here as they happen.'
    }</div>`;
    return;
  }
  const shown = rows.slice(0, F.limit);
  let html = '';
  let day = '';
  let open = false;
  const counts = new Map<string, number>();
  rows.forEach((x) => counts.set(isoDay(x.ts), (counts.get(isoDay(x.ts)) || 0) + 1));
  for (const x of shown) {
    const d = isoDay(x.ts);
    if (d !== day) {
      if (open) html += '</ul>';
      day = d;
      const t = dayTitle(x.ts);
      const n = counts.get(d) || 0;
      html += `<h3 class="ap-day">${esc(t.t)}<small>${esc(t.d)}</small><span class="n">${n} ${n === 1 ? 'call' : 'calls'}</span></h3><ul class="ap-evs">`;
      open = true;
    }
    html += evRowHTML(x, true);
  }
  if (open) html += '</ul>';
  if (rows.length > shown.length) html += `<div class="ap-moreb"><button type="button" class="btn" data-more>Show ${Math.min(120, rows.length - shown.length)} more</button></div>`;
  box.innerHTML = html;
}

// ── access ──────────────────────────────────────────────────────────────

async function paintAccess(panel: HTMLElement, k: KeyRowFull): Promise<void> {
  const page = P!;
  panel.innerHTML = `<div class="ap-card ap-acc-ed">${evSkeleton(3)}</div>`;
  const tools = await loadCatalog();
  if (P !== page || page.tab !== 'access') return;
  const start = permsOf(k);
  panel.innerHTML = `<div class="ap-card ap-acc-ed" id="apPerms">${permsHTML(start, tools)}</div>
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

// ── settings ────────────────────────────────────────────────────────────

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
      <div class="ap-row"><span class="tx"><b>Key ID</b><code>${esc(k.id)}</code></span><button type="button" class="cc-ibtn" data-copy="${attr(
        k.id,
      )}" aria-label="Copy the key ID" title="Copy">${ICO.copy}</button></div>
      <div class="ap-row"><span class="tx"><b>${k.revealable ? 'Stored sealed' : signed ? 'Held by the app' : 'Shown once'}</b><small>${
        k.revealable ? 'Your password shows it again.' : signed ? 'The app signed in and holds its own token.' : 'It was shown when it was made. Make a new key to see one again.'
      }</small></span>${k.revealable ? `<button type="button" class="btn" data-s="reveal">${ICO_EYE}Show key</button>` : ''}</div>
      <div class="ap-row"><span class="tx"><b>Make a new key</b><small>The current key stops working at once; the setup guide gets the new one.</small></span>
        <button type="button" class="btn" data-s="roll">${ICO.key}Make a new key</button></div></section>
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
