// Activity: everything agents and people do in the brain, live. Search
// first; every other filter (time, action type, source, agents, status)
// lives in one sheet behind the Filters button and shows as removable chips.
// Three views: By day (timeline with sticky day headers), By agent (one card
// per agent, sorted into agent classes) and Summary (counts). Rows come from
// the vault log, the gateway audit trail and the live bus `activity` stream.
// /activity/<key id> is the same page in its other mode: that agent's own
// page (views/activity-agent.ts). An agent card opens it with a shared
// element transition (views/activity-vt.ts); back returns to the list at the
// same scroll position.

import { $, attr, esc, useStyles } from '../dom';
import { debounce } from '../format';
import { apiGet } from '../api';
import { avatarHTML, setAgentColors } from '../control/agents';
import { useActivityStyles, wireActRows } from '../control/activity';
import { loadFeed, onLive, pushLive, verb, type ActivityItem, type Source } from '../control/feed';
import { ICO, openMenu, plural, systemHeader, useControlStyles, whileVisible } from '../control/ui';
import type { KeyRow, KeysResult } from '../types';
import { toast } from '../toast';
import { onNavigate, paintTitle, takeRouteAgent } from '../router';
import { agentHero, agentLive, agentSlugShown, exportRows, focusAgentSearch, leaveAgent, showAgent } from './activity-agent';
import { morph } from './activity-vt';
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
  loadView,
  matches,
  saveView,
  stOf,
  timeLabel,
  type AgentInfo,
  type Cat,
  type St,
  type ViewKind,
} from './activity-model';
import { agentViewHTML, boardViewHTML, chip, CLOCK, dayViewHTML, skeletonHTML, CAT_COLOR, type ViewCtx } from './activity-views';
import { openFilters, refreshFilters } from './activity-filters';

const CSS = `
.ax{--ax-stick:64px;--ax-gut:28px}
/* sticky search bar: solid page colour, full bleed over the view padding */
.ax-sbar{position:sticky;top:calc(-1 * var(--ax-pt,24px));z-index:6;margin:0;padding:10px 0;background:transparent;
  border-bottom:1px solid transparent;transition:border-color .16s}
/* Stuck: the same background as the page behind it (#app: the glow over the
   base colour, fixed to the screen), so it reads as the page, not a band. */
.ax-sbar.stuck{border-bottom-color:var(--line);background:var(--bg-grad),var(--bg);background-attachment:fixed}
/* the stuck bar covers the view's top padding too, so nothing shows above it */
.ax-sbar.stuck::before{content:"";position:absolute;left:0;right:0;bottom:100%;height:var(--ax-pt,24px);background:var(--bg-grad),var(--bg);background-attachment:fixed}
.ax-sbar-in{max-width:1240px;margin:0 auto;display:flex;gap:10px;align-items:center}
.ax-q{flex:1 1 260px}
.ax-q{display:flex;align-items:center;gap:10px;height:46px;padding:0 8px 0 15px;border-radius:13px;background:var(--panel);
  border:1px solid var(--line-strong);min-width:0;transition:border-color .16s,box-shadow .16s;cursor:text}
.ax-q:focus-within{border-color:color-mix(in srgb,var(--accent) 60%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}
.ax-q>.cc-i{width:18px;height:18px;color:var(--muted)}
.ax-q input{flex:1;min-width:0;height:100%;border:0;outline:none;background:none;color:var(--fg);font-size:15px;padding:0}
.ax-q input::-webkit-search-cancel-button{display:none}
.ax-q kbd{flex:none;display:grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:6px;border:1px solid var(--line-strong);
  color:var(--muted);font:600 11.5px/1 var(--mono);background:var(--panel-2)}
.ax-qx{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;color:var(--muted);flex:none}
.ax-qx:hover{background:var(--panel-2);color:var(--fg)}
.ax-qx[hidden],.ax-q.has kbd{display:none}
.ax-fbtn{display:inline-flex;align-items:center;gap:8px;height:46px;padding:0 15px;border-radius:13px;border:1px solid var(--line-strong);
  background:var(--panel);color:var(--fg);font-size:13.5px;font-weight:650;white-space:nowrap}
.ax-fbtn:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.ax-fbtn:focus-visible,.ax-q input:focus-visible{outline:none}
.ax-fbtn:focus-visible{box-shadow:0 0 0 2px var(--accent)}
.ax-fbtn .cc-i{width:17px;height:17px;color:var(--muted)}
.ax-badge{display:grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:var(--accent);
  color:var(--on-accent);font-size:11px;font-weight:800}
.ax-badge[hidden]{display:none}
.ax-views{height:46px;box-sizing:border-box;align-items:stretch;border-radius:13px;padding:4px}
.ax-views button{min-height:0;padding:0 14px;border-radius:9px;font-size:13px}

/* chips + summary */
.ax-sub{display:flex;align-items:center;gap:10px 16px;flex-wrap:wrap;margin:4px 0 14px;min-height:34px}
.ax-chips{display:flex;align-items:center;gap:7px;flex-wrap:wrap;flex:1 1 360px;min-width:0}
.ax-chip{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 6px 0 11px;border-radius:99px;border:1px solid var(--line);
  background:var(--panel);font-size:12.5px;font-weight:600;color:var(--fg);white-space:nowrap;max-width:240px}
.ax-chip .t{overflow:hidden;text-overflow:ellipsis}
.ax-chip .k{color:var(--muted);font-weight:600}
.ax-chip .ag-av{margin-left:-6px}
.ax-chip .sw,.ax-opt .sw,.ax-hb .sw{width:9px;height:9px;border-radius:3px;background:var(--c);flex:none}
.ax-chip .x{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;color:var(--muted)}
.ax-chip .x .cc-i{width:13px;height:13px}
.ax-chip:hover .x{background:var(--panel-2);color:var(--fg)}
.ax-chip.time{padding-right:11px;color:var(--fg);border-color:var(--line-strong)}
.ax-chip.time .cc-i{width:14px;height:14px;color:var(--muted)}
.ax-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ax-clear{font-size:12.5px;font-weight:650;color:var(--accent);padding:6px 4px}
.ax-clear:hover{text-decoration:underline}
.ax-sum{display:flex;align-items:center;gap:14px;font-size:12.5px;color:var(--muted);white-space:nowrap;flex-wrap:wrap}
.ax-sum b{color:var(--fg);font-weight:680;font-variant-numeric:tabular-nums}
.ax-sum .bad b,.ax-sum .bad{color:var(--danger)}
.ax-tgl{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--muted);padding:4px 2px}
.ax-tgl i{position:relative;width:30px;height:18px;border-radius:99px;background:var(--line-strong);transition:background .16s;flex:none}
.ax-tgl i::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--fg);transition:transform .16s}
.ax-tgl[aria-pressed=true]{color:var(--fg)}
.ax-tgl[aria-pressed=true] i{background:var(--accent)}
.ax-tgl[aria-pressed=true] i::after{transform:translateX(12px);background:var(--on-accent)}
.ax-tgl:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}

/* new events while paused: a button in the sticky bar, never over the list */
.ax-newb{display:inline-flex;align-items:center;gap:7px;height:46px;padding:0 15px;border-radius:13px;background:var(--primary);
  color:var(--on-primary);font-size:13px;font-weight:700;white-space:nowrap;flex:none}
.ax-newb[hidden]{display:none}
.ax-newb:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.lg-live{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 13px;border-radius:99px;border:1px solid var(--line);
  background:var(--panel);font-size:12.5px;font-weight:650;color:var(--muted)}
.lg-live[aria-pressed=true]{color:var(--fg);border-color:color-mix(in srgb,var(--ok) 40%,var(--line))}
.lg-live:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* by day: one card per day, its header sticks under the search bar on a solid surface */
.ax-body{min-height:240px}
.ax-day{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg);margin-bottom:16px;overflow:clip}
.ax-dh{position:sticky;top:var(--ax-stick);z-index:4;display:flex;align-items:baseline;gap:10px;margin:0;padding:12px 16px 11px;
  background:var(--panel-2);border-bottom:1px solid var(--line);font-size:13px;font-weight:700;letter-spacing:0;color:var(--fg);
  border-radius:0;min-height:44px;box-sizing:border-box}
.ax-dh .grow{flex:1}
.ax-dh-t{font-size:14px;font-weight:720}
.ax-dh-d{color:var(--muted);font-weight:550;font-size:12.5px}
.ax-dh-n{color:var(--muted);font-weight:600;font-size:12px;font-variant-numeric:tabular-nums;display:inline-flex;gap:10px}
.ax-dh-f{color:var(--danger)}
.ax-day .act{min-height:58px}
.ax-more{display:flex;justify-content:center;padding:4px 0 18px}
.ax-more .btn{gap:10px;min-height:40px}
.ax-end{text-align:center;color:var(--muted);font-size:12px;padding:6px 0 22px}
.ax-skc{padding:6px 0;overflow:hidden}
.ax-day[aria-busy] .ax-dh{align-items:center}

/* empty */
.ax-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:44px 20px;text-align:center;color:var(--muted);font-size:13px}
.ax-empty b{color:var(--fg);font-size:15px;font-weight:680}
.ax-empty .btn{margin-top:10px}
.ax-empty-i{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:var(--panel-2);border:1px solid var(--line);margin-bottom:4px}
.ax-empty-i .cc-i{width:20px;height:20px;color:var(--muted)}

/* by agent */
.ax-sec{margin-bottom:20px}
.ax-sec-t{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:11.5px;font-weight:750;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.ax-sec-t .n{font-variant-numeric:tabular-nums;letter-spacing:0;padding:1px 7px;border-radius:99px;background:var(--panel-2);border:1px solid var(--line)}
.ax-agrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,380px),1fr));gap:12px}
/* agent cards open the agent's own page */
.ax-ag{display:flex;flex-direction:column;text-align:left;color:inherit;text-decoration:none;cursor:pointer;width:100%;
  transition:border-color .16s,box-shadow .16s,transform .16s}
.ax-ag,.ax-ag:hover,.ax-ag:focus,.ax-ag *{text-decoration:none}
.ax-ag:hover{border-color:color-mix(in srgb,var(--ag) 55%,var(--line));box-shadow:0 10px 26px -20px rgba(0,0,0,.55);transform:translateY(-1px)}
.ax-ag:active{transform:translateY(0) scale(.995)}
.ax-ag:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ax-ag.dim .ax-ag-h{opacity:.78}
.ax-ag-h{display:flex;align-items:center;gap:13px;width:100%;padding:15px 14px 10px 16px;min-height:66px;box-sizing:border-box}
.ax-ag-av{display:grid;flex:none}
.ax-ag-id{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.ax-ag-n{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.ax-ag-nm{font-size:14.5px;font-weight:700;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;width:fit-content}
.ax-ag-last{font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ax-ag-last b{color:var(--fg);font-weight:600}
.ax-go{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;color:var(--muted);flex:none;transition:transform .16s,color .16s,background .16s}
.ax-go .cc-i{width:17px;height:17px}
.ax-ag:hover .ax-go{color:var(--fg);background:var(--panel-2);transform:translateX(2px)}
.ax-cls{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px;border-radius:99px;font-size:11px;font-weight:650;
  background:var(--panel-2);border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.ax-cls .cc-dot{width:6px;height:6px;box-shadow:none}
.ax-cls.active{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,transparent)}
.ax-cls.removed,.ax-cls.off{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 35%,transparent)}
.ax-ag-stats{display:flex;align-items:center;gap:16px;padding:0 16px 14px 71px;font-size:12.5px;color:var(--muted)}
.ax-ag-stats b{color:var(--fg);font-weight:700;font-variant-numeric:tabular-nums}
.ax-ag-stats .bad,.ax-ag-stats .bad b{color:var(--danger)}
.ax-spark{flex:1;display:flex;align-items:flex-end;gap:2px;height:24px;min-width:60px;margin-left:auto;max-width:200px}
.ax-spark i{flex:1;background:var(--ag);border-radius:2px;opacity:.75;min-height:2px}
.ax-spark i.z{opacity:.18}

/* summary board */
.ax-tiles{margin-bottom:14px}
.ax-board{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:18px}
.ax-wide{grid-column:1/-1}
.ax-hbs{display:flex;flex-direction:column;gap:4px}
.ax-hb{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 12px;align-items:center;padding:7px 8px;margin:0 -8px;border-radius:9px;text-align:left}
.ax-hb:hover{background:var(--panel-2)}
.ax-hb:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ax-hb-l{display:flex;align-items:center;gap:9px;min-width:0;font-size:13px;font-weight:600}
.ax-hb-l .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ax-hb-n{font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums}
.ax-hb-n em{font-style:normal;font-weight:550;color:var(--muted);margin-left:8px;display:inline-block;min-width:34px;text-align:right}
.ax-hb-track{grid-column:1/-1;height:6px;border-radius:99px;background:var(--panel-2);overflow:hidden}
.ax-hb-track span{display:block;height:100%;border-radius:99px;background:var(--c)}
.ax-bempty{color:var(--muted);font-size:13px;padding:8px 0}
.ax-cols{display:flex;align-items:flex-end;gap:3px;height:140px}
.ax-col{flex:1;height:100%;display:flex;align-items:flex-end;min-width:0}
.ax-col i{display:flex;flex-direction:column;justify-content:flex-start;width:100%;background:var(--accent);border-radius:3px 3px 0 0;overflow:hidden;min-height:0}
.ax-col i b{display:block;width:100%;background:var(--danger)}
.ax-col:hover i{filter:brightness(1.15)}
.ax-ticks{display:flex;justify-content:space-between;margin-top:8px;font-size:11.5px;color:var(--muted)}
.ax-key{display:inline-block;width:9px;height:9px;border-radius:3px;background:var(--danger);margin-right:6px;vertical-align:-1px}
.ax-nodes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:14px 16px}
.ax-node{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:11px;border:1px solid var(--line);background:var(--panel-2);text-align:left;min-width:0}
.ax-node:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.ax-node .t{flex:1;min-width:0;display:flex;flex-direction:column;font-size:13px;font-weight:600}
.ax-node .t span,.ax-node small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ax-node small{color:var(--muted);font:500 11.5px var(--mono)}
.ax-node .n{font-size:12px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}

/* filter sheet */
.ax-sheet .cc-drawer-b{padding:4px 18px 18px}
.ax-fg{padding:16px 0;border-top:1px solid var(--line)}
.ax-fg:first-child{border-top:0}
.ax-fg h3{display:flex;align-items:center;margin:0 0 11px;font-size:11.5px;font-weight:750;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.ax-lnk{margin-left:auto;text-transform:none;letter-spacing:0;font-size:12.5px;font-weight:650;color:var(--accent)}
.ax-opts{display:flex;flex-wrap:wrap;gap:7px}
.ax-opt{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--line);
  background:var(--panel-2);font-size:13px;font-weight:600;color:var(--fg)}
.ax-opt .n{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.ax-opt .cc-dot{width:7px;height:7px;box-shadow:none}
.ax-opt:hover{border-color:color-mix(in srgb,var(--accent) 40%,var(--line))}
.ax-opt[aria-pressed=true]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 13%,var(--panel));box-shadow:inset 0 0 0 1px var(--accent)}
.ax-opt:focus-visible,.ax-agopt:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ax-range{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.ax-range label{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:600;color:var(--muted)}
.ax-range input{height:40px;box-sizing:border-box;padding:0 10px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2);
  color:var(--fg);font:500 13px/1 inherit;color-scheme:light dark;width:100%;min-width:0}
.ax-range.on input{border-color:color-mix(in srgb,var(--accent) 50%,var(--line))}
.ax-range input:focus{outline:none;border-color:var(--accent)}
.ax-acts{margin-top:12px}
.ax-acts summary{display:inline-flex;align-items:center;gap:7px;cursor:pointer;font-size:12.5px;font-weight:650;color:var(--muted);padding:4px 0;list-style:none}
.ax-acts summary::-webkit-details-marker{display:none}
.ax-acts summary::before{content:"";width:6px;height:6px;border-right:1.8px solid currentColor;border-bottom:1.8px solid currentColor;transform:rotate(-45deg);transition:transform .16s;margin-right:3px}
.ax-acts[open] summary::before{transform:rotate(45deg)}
.ax-acts summary .n{font-variant-numeric:tabular-nums}
.ax-acts .ax-opts{margin-top:10px}
.ax-acts .ax-opt{min-height:32px;font-size:12.5px}
.ax-agq{display:flex;align-items:center;gap:8px;height:38px;padding:0 11px;margin-bottom:10px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2)}
.ax-agq input{flex:1;min-width:0;border:0;outline:none;background:none;color:var(--fg);font-size:13px}
.ax-agq .cc-i{color:var(--muted);width:15px;height:15px}
.ax-aglist{display:flex;flex-direction:column;gap:2px}
.ax-agc{font-size:11.5px;font-weight:650;color:var(--muted);padding:10px 2px 5px}
.ax-agc:first-child{padding-top:0}
.ax-agopt{display:flex;align-items:center;gap:11px;padding:7px 9px;border-radius:11px;text-align:left;min-height:48px;border:1px solid transparent}
.ax-agopt[hidden]{display:none}
.ax-agopt:hover{background:var(--panel-2)}
.ax-agopt[aria-pressed=true]{background:color-mix(in srgb,var(--ag) 10%,var(--panel));border-color:color-mix(in srgb,var(--ag) 45%,transparent)}
.ax-agopt .t{flex:1;min-width:0;display:flex;flex-direction:column}
.ax-agopt b{font-size:13.5px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ax-agopt small{font-size:11.5px;color:var(--muted)}
.ax-agopt .n{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.ax-box{display:grid;place-items:center;width:20px;height:20px;border-radius:6px;border:1.5px solid var(--line-strong);flex:none}
.ax-box .ax-ck{width:13px;height:13px;stroke-width:2.6;opacity:0;color:var(--on-accent)}
.ax-agopt[aria-pressed=true] .ax-box{background:var(--accent);border-color:var(--accent)}
.ax-agopt[aria-pressed=true] .ax-ck{opacity:1}

.sys-acts .lg-live{height:38px;border-radius:11px}
@media (max-width:1000px){
  .ax-views button{padding:0 11px}
  .ax-q kbd{display:none}
  .ax-fbtn{padding:0 13px}
  .ax-fbtn .l{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
}
@media (max-width:760px){
  .ax{--ax-gut:14px}
  .ax-sbar{padding:8px 0}
  .ax-sbar-in{flex-wrap:wrap;gap:8px}
  .ax-q{flex:1 1 0}
  .ax-q{height:44px;padding-left:13px}
  .ax-q input{font-size:16px}
  .ax-fbtn{height:44px;padding:0 12px}
  .sys-acts .lg-live{height:44px}
  .ax-newb{height:44px;padding:0 12px}
  .ax-views{order:3;flex:1 1 100%;height:40px;display:flex}
  .ax-views button{flex:1}
  .ax-sub{margin:2px 0 12px;flex-direction:column;align-items:stretch;gap:8px}
  .ax-chips{flex:none;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:0 calc(-1 * var(--ax-gut));padding:2px var(--ax-gut)}
  .ax-chips::-webkit-scrollbar{display:none}
  .ax-chip{flex:none;height:34px}
  .ax-sum{gap:12px}
  .ax-tgl{margin-left:auto}
  .ax-dh{padding:11px 13px 10px;flex-wrap:wrap;row-gap:2px}
  .ax-dh-d{font-size:12px}
  .ax-day{border-radius:14px;margin-bottom:12px}
  .ax-board{grid-template-columns:minmax(0,1fr)}
  .ax-nodes{grid-template-columns:minmax(0,1fr);padding:12px 13px}
  .ax-ag-h{padding:12px 10px 8px 13px}
  .ax-ag-stats{padding:0 13px 12px;gap:12px}
  .ax-sheet .cc-drawer-b{padding:2px 16px 16px}
  .ax-opt{min-height:40px}
}
@media (max-width:420px){
  .ax-dh-d{display:none}
}
@media (prefers-reduced-motion:reduce){
  .ax-ag,.ax-go,.ax-tgl i,.ax-tgl i::after{transition:none}
}
`;

const PAGE = 120;
const FETCH = 800;

let items: ActivityItem[] = [];
let keys: KeyRow[] = [];
/** The list, or one agent's page (/activity/<id>). */
let mode: 'list' | 'agent' = 'list';
/** Where the list was scrolled when an agent page opened. */
let listScroll = 0;
/** Another page was shown since the last render: no transition then. */
let away = true;
onNavigate((p) => {
  if (p !== 'logs') away = true;
});

function slugFromUrl(): string | null {
  const m = /^\/activity\/([A-Za-z0-9_-]{1,64})\/?$/.exec(location.pathname);
  return m ? m[1] : null;
}
let pending: ActivityItem[] = [];
const fresh = new Set<string>();
let view: ViewKind = loadView();
let limit = PAGE;
let fetchLimit = FETCH;
let older = false;
let compact = true;
let live = true;
let loading = true;
let loadSeq = 0;
let paintQueued = false;
let io: IntersectionObserver | null = null;

function host(): HTMLElement {
  return $('#view-logs');
}

function scoped(): ActivityItem[] {
  return inWindow(items);
}

function agentsOf(sc: ActivityItem[]): AgentInfo[] {
  return classifyAgents(
    items,
    sc.filter((x) => matches(x, 'agents')),
    keys,
  );
}

function narrowed(): boolean {
  return !!(F.q || F.cats.size || F.actions.size || F.srcs.size || F.agents.size || F.status.size);
}

export async function renderLogs(): Promise<void> {
  useControlStyles();
  useActivityStyles();
  useStyles('cc-logs-css', CSS);
  const h = host();
  if (!h.classList) return;
  // The address is the truth: /activity/<id> is an agent page, /activity the list.
  takeRouteAgent();
  const animate = !away;
  away = false;

  try {
    const a = sessionStorage.getItem('memora.activity.agent');
    if (a) {
      sessionStorage.removeItem('memora.activity.agent');
      F.agents = new Set([a]);
      view = 'day';
      syncViews();
    }
  } catch {
    /* optional */
  }

  if (!h.querySelector('#axRoot')) {
    h.innerHTML = '<div id="axRoot"></div><div id="adRoot" hidden></div>';
    mode = 'list';
    // "/" jumps to the search field of whichever mode is shown.
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || h.classList.contains('hidden')) return;
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select,[contenteditable=true],.cc-drawer,.modal')) return;
      e.preventDefault();
      if (mode === 'agent') {
        focusAgentSearch();
        return;
      }
      const q = document.getElementById('axQ') as HTMLInputElement | null;
      q?.focus();
      q?.select();
    });
  }
  startLive(h);
  const s = slugFromUrl();
  if (s) await enterAgent(s, animate);
  else await enterList(animate);
}

/** Open an agent's page from the list: its own address, then the animation. */
function openAgent(slug: string): void {
  try {
    history.pushState({ page: 'logs', adFrom: 'list' }, '', '/activity/' + encodeURIComponent(slug));
  } catch {
    /* sandboxed frames can refuse history writes */
  }
  void enterAgent(slug, true);
}

/** "All activity" on an agent page: back in history when we came from the list. */
function backToList(): void {
  if ((history.state as { adFrom?: string } | null)?.adFrom === 'list') {
    history.back();
    return;
  }
  try {
    history.pushState({ page: 'logs' }, '', '/activity');
  } catch {
    /* sandboxed frames */
  }
  void enterList(true);
}

async function enterAgent(slug: string, animate: boolean): Promise<void> {
  const h = host();
  const lr = $('#axRoot');
  const ar = $('#adRoot');
  const o = {
    keys,
    items,
    time: { time: F.time, from: F.from, to: F.to },
    back: backToList,
  };
  // Already showing this agent (a refresh): just reload its data.
  if (mode === 'agent' && !ar.hidden && agentSlugShown() === slug) {
    showAgent(ar, h, slug, o);
    return;
  }
  const fromList = mode === 'list' && !lr.hidden && !!lr.querySelector('#axBody');
  if (fromList) listScroll = h.scrollTop;
  mode = 'agent';
  const update = (): void => {
    lr.hidden = true;
    ar.hidden = false;
    showAgent(ar, h, slug, o);
    h.scrollTop = 0;
  };
  if (animate && fromList) {
    const card = lr.querySelector<HTMLElement>(`#axBody [data-go="${window.CSS.escape(slug)}"]`);
    await morph({ from: card, to: agentHero, update, reveal: () => ar });
  } else update();
}

async function enterList(animate: boolean): Promise<void> {
  const h = host();
  const lr = $('#axRoot');
  const ar = $('#adRoot');
  const fromAgent = mode === 'agent' && !ar.hidden;
  const hero = fromAgent ? agentHero() : null;
  const was = fromAgent ? agentSlugShown() : '';
  if (mode === 'agent') leaveAgent();
  mode = 'list';
  const first = !lr.querySelector('#axBody');
  if (first) buildList(lr);
  else paint(false);
  const update = (): void => {
    ar.hidden = true;
    lr.hidden = false;
    if (fromAgent) h.scrollTop = listScroll;
    paintTitle();
  };
  if (animate && fromAgent)
    await morph({
      from: hero,
      to: () => (was ? lr.querySelector<HTMLElement>(`#axBody [data-go="${window.CSS.escape(was)}"]`) : null),
      update,
      reveal: () => lr,
    });
  else update();
  if (first) await reload();
  else if (live) softReload();
}

function buildList(lr: HTMLElement): void {
  const h = host();
  lr.innerHTML = `<div class="cc ax">
    ${systemHeader(
      'logs',
      'Activity',
      'Every read, write, search and sign-in in this brain, newest first.',
      `<button type="button" class="lg-live" id="lgLive" aria-pressed="${live}"></button>
        <button type="button" class="btn" id="axExport" aria-haspopup="menu">${ICO.download}Export</button>
        <button type="button" class="cc-ibtn" id="axReload" aria-label="Reload" title="Reload">${ICO.refresh}</button>`,
    )}
    <div class="ax-sbar" id="axBar"><div class="ax-sbar-in">
      <label class="ax-q" id="axQWrap">${ICO.search}<span class="sr-only">Search activity</span>
        <input id="axQ" type="search" enterkeyhint="search" placeholder="Search agents, actions, nodes, details" autocomplete="off" spellcheck="false" value="${attr(
          F.q,
        )}">
        <kbd aria-hidden="true">/</kbd><button type="button" class="ax-qx" id="axQx" aria-label="Clear search" hidden>${ICO.x}</button></label>
      <button type="button" class="ax-fbtn" id="axFilt" aria-haspopup="dialog">${ICO.filter}<span class="l">Filters</span><span class="ax-badge" id="axBadge" hidden></span></button>
      <div class="cc-seg ax-views" id="axViews" role="group" aria-label="View">${(
        [
          ['day', 'By day'],
          ['agent', 'By agent'],
          ['board', 'Summary'],
        ] as [ViewKind, string][]
      )
        .map(([v, l]) => `<button type="button" data-view="${v}" aria-pressed="${v === view}">${l}</button>`)
        .join('')}</div>
      <button type="button" class="ax-newb" id="axNew" hidden></button>
    </div></div>
    <div class="ax-sub"><div class="ax-chips" id="axChips" aria-label="Active filters"></div><div class="ax-sum" id="axSum" aria-live="polite"></div></div>
    <div class="ax-body" id="axBody">${skeletonHTML(view)}</div>
  </div>`;
  wire(h);
  paintLive();
}

function wire(h: HTMLElement): void {
  const q = $('#axQ') as HTMLInputElement;
  const qx = $('#axQx');
  const syncQ = (): void => {
    qx.hidden = !q.value;
    $('#axQWrap').classList.toggle('has', !!q.value);
  };
  syncQ();
  const apply = debounce(() => {
    F.q = q.value.trim();
    limit = PAGE;
    paint(false);
  }, 140);
  q.oninput = () => {
    syncQ();
    apply();
  };
  q.onkeydown = (e) => {
    if (e.key === 'Escape' && q.value) {
      e.stopPropagation();
      q.value = '';
      syncQ();
      F.q = '';
      paint(false);
    }
  };
  qx.onclick = () => {
    q.value = '';
    syncQ();
    F.q = '';
    paint(false);
    q.focus();
  };
  $('#axFilt').onclick = () =>
    openFilters({
      scoped,
      agents: () => agentsOf(scoped()),
      changed: (kind) => {
        limit = PAGE;
        if (kind === 'time') {
          fetchLimit = FETCH;
          void reload();
        } else paint(false);
      },
    });

  $('#axViews').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-view]');
    if (!b) return;
    setView(b.dataset.view as ViewKind);
  };

  $('#axChips').onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-open]')) return $('#axFilt').click();
    if (t.closest('[data-clear]')) {
      const tc = F.time !== '7d';
      clearFilters();
      F.q = '';
      (q as HTMLInputElement).value = '';
      syncQ();
      limit = PAGE;
      if (tc) void reload();
      else paint(false);
      return;
    }
    const rm = t.closest<HTMLElement>('[data-rm]');
    if (rm) removeFilter(rm.dataset.rm!);
  };

  $('#axSum').onclick = (e) => {
    if (!(e.target as HTMLElement).closest('#axCompact')) return;
    compact = !compact;
    paint(false);
  };

  const body = $('#axBody');
  wireActRows(body, (id) => items.find((x) => x.id === id), filterActor);
  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const hit = (sel: string): HTMLElement | null => t.closest<HTMLElement>(sel);
    let el: HTMLElement | null;
    if (hit('[data-more]')) {
      limit += PAGE;
      paint(true);
    } else if (hit('[data-older]')) {
      fetchLimit += FETCH;
      void reload(true);
    } else if ((el = hit('a[data-go]'))) {
      const me = e as MouseEvent;
      // New tab / window keep the browser's own handling of the link.
      if (me.metaKey || me.ctrlKey || me.shiftKey || me.button !== 0) return;
      e.preventDefault();
      openAgent(el.dataset.go!);
    } else if ((el = hit('[data-only]'))) {
      filterActor(el.dataset.only!);
    } else if ((el = hit('[data-f]'))) {
      const [k, ...rest] = el.dataset.f!.split(':');
      const v = rest.join(':');
      if (k === 'cats') F.cats = new Set([v as Cat]);
      else if (k === 'actions') F.actions = new Set([v]);
      else if (k === 'agents') F.agents = new Set([v]);
      else if (k === 'srcs') F.srcs = new Set([v as Source]);
      setView('day');
    } else if ((el = hit('[data-time]'))) {
      F.time = 'all';
      F.from = F.to = '';
      void reload();
    } else if (hit('[data-clear]')) {
      clearFilters(true);
      F.q = '';
      q.value = '';
      syncQ();
      paint(false);
    }
  });

  $('#axReload').onclick = () => {
    keys = [];
    void reload();
  };
  $('#lgLive').onclick = () => {
    live = !live;
    if (live) {
      flushPending();
      softReload();
    }
    paintLive();
  };
  $('#axExport').onclick = (e) =>
    openMenu(e.currentTarget as HTMLElement, [
      { label: 'Export shown as JSON', icon: ICO.download, run: () => exportRows(scoped().filter((x) => matches(x)), 'json') },
      { label: 'Export shown as CSV', icon: ICO.download, run: () => exportRows(scoped().filter((x) => matches(x)), 'csv') },
    ]);

  // Sticky geometry: day headers stick right under the search bar.
  const bar = $('#axBar');
  const cc = h.querySelector<HTMLElement>('.ax')!;
  const setStick = (): void => {
    const pt = parseFloat(getComputedStyle(h).paddingTop) || 0;
    cc.style.setProperty('--ax-pt', pt + 'px');
    cc.style.setProperty('--ax-stick', bar.offsetHeight - pt + 'px');
  };
  setStick();
  new ResizeObserver(setStick).observe(bar);
  // "Back to top" is the shared floating button (ui/totop.ts).
  const onScroll = (): void => {
    if (mode !== 'list') return;
    const y = h.scrollTop;
    const stuck = y > 0 && bar.getBoundingClientRect().top <= h.getBoundingClientRect().top + 1;
    bar.classList.toggle('stuck', stuck);
  };
  h.addEventListener('scroll', onScroll, { passive: true });
}

function setView(v: ViewKind): void {
  view = v;
  saveView(v);
  limit = PAGE;
  syncViews();
  paint(false);
  const h = host();
  const bar = $('#axBar');
  // Keep the bar in place: jump back to where the list starts if scrolled past.
  const sub = h.querySelector<HTMLElement>('.ax-sub');
  if (sub && h.scrollTop > sub.offsetTop) h.scrollTop = Math.max(0, bar.offsetTop);
}

function syncViews(): void {
  document.querySelectorAll<HTMLElement>('#axViews [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
}

function removeFilter(spec: string): void {
  const [k, ...rest] = spec.split(':');
  const v = rest.join(':');
  limit = PAGE;
  if (k === 'time') {
    F.time = '7d';
    F.from = F.to = '';
    void reload();
    return;
  }
  if (k === 'cats') F.cats.delete(v as Cat);
  else if (k === 'actions') F.actions.delete(v);
  else if (k === 'srcs') F.srcs.delete(v as Source);
  else if (k === 'agents') F.agents.delete(v);
  else if (k === 'status') F.status.delete(v as St);
  paint(false);
}

function filterActor(actor: string): void {
  F.agents = new Set([actor]);
  setView('day');
}

function startLive(h: HTMLElement): void {
  whileVisible(h, () =>
    onLive((it) => {
      agentLive(it, mode === 'agent');
      if (!live) {
        pending.push(it);
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
  setTimeout(() => {
    paintQueued = false;
    paint(true);
  }, 150);
}

function flushPending(): void {
  const p = pending;
  pending = [];
  p.forEach(ingest);
}

function paintLive(): void {
  const b = document.getElementById('lgLive');
  if (!b) return;
  b.setAttribute('aria-pressed', String(live));
  b.innerHTML = live
    ? '<span class="cc-dot ok"></span>Live'
    : `<span class="cc-dot idle"></span>Paused${pending.length ? ` · ${pending.length} new` : ''}`;
  b.title = live ? 'Pause the live stream' : 'Resume the live stream';
  const nb = $('#axNew') as HTMLButtonElement;
  nb.hidden = live || !pending.length;
  nb.textContent = `${pending.length} new`;
  nb.setAttribute('aria-label', `Show ${plural(pending.length, 'new event')}`);
  nb.onclick = () => {
    live = true;
    flushPending();
    softReload();
    paintLive();
    host().scrollTo({ top: 0 });
  };
}

const softReload = debounce(() => void reload(true), 900);

async function reload(soft = false): Promise<void> {
  const seq = ++loadSeq;
  if (!soft) {
    loading = true;
    paint(false);
  }
  try {
    const keysP = keys.length
      ? Promise.resolve(keys)
      : apiGet<KeysResult | KeyRow[]>('/api/keys')
          .then((d) => (Array.isArray(d) ? d : d.keys || []))
          .catch(() => [] as KeyRow[]);
    const [fetched, ks] = await Promise.all([loadFeed(feedRange(), fetchLimit), keysP]);
    if (seq !== loadSeq) return;
    keys = ks;
    setAgentColors(keys);
    // Keep live items newer than the server snapshot (the log can lag a bit).
    const newest = fetched.length ? fetched[0].ts : 0;
    const keep = items.filter(
      (x) =>
        x.live &&
        x.ts > newest - 15 &&
        !fetched.some((f) => f.actor === x.actor && f.action === x.action && Math.abs(f.ts - x.ts) < 15),
    );
    // Stored starts carry no outcome (`end` phases are realtime only): take
    // it from the live copy of the same call when there is one.
    for (const f of fetched) {
      if (f.ok !== undefined && !f.running) continue;
      const m = items.find((x) => x.live && x.actor === f.actor && x.action === f.action && Math.abs(x.ts - f.ts) < 5);
      if (m && !m.running) {
        f.running = false;
        f.ok = m.ok;
        f.ms = m.ms;
      }
    }
    if (soft && items.length) {
      const known = new Set(items.map((x) => x.actor + x.action + Math.round(x.ts)));
      fetched.forEach((x) => {
        if (!known.has(x.actor + x.action + Math.round(x.ts))) fresh.add(x.id);
      });
    }
    older = F.time !== '1h' && F.time !== 'today' && fetched.filter((x) => x.source !== 'auth').length >= fetchLimit * 0.9;
    items = [...keep, ...fetched];
  } catch (e) {
    if (seq !== loadSeq) return;
    toast('Could not load activity: ' + (e as Error).message, 'err');
  }
  loading = false;
  paint(soft);
}

// ── painting ────────────────────────────────────────────────────────────

function paintChips(): void {
  const c: string[] = [
    `<button type="button" class="ax-chip time" data-open aria-label="${attr(`Time: ${timeLabel()}. Change filters`)}">${CLOCK}<span class="t">${esc(
      timeLabel(),
    )}</span></button>`,
  ];
  F.status.forEach((s) => c.push(chip('status:' + s, STATUSES.find((x) => x.id === s)!.label, '', 'Status ')));
  F.cats.forEach((k) => c.push(chip('cats:' + k, CATS.find((x) => x.id === k)!.label, `<i class="sw" style="--c:${CAT_COLOR[k]}"></i>`)));
  F.actions.forEach((a) => c.push(chip('actions:' + a, verb(a), '', 'Action ')));
  F.srcs.forEach((s) => c.push(chip('srcs:' + s, SRCS.find((x) => x.id === s)!.label, '', 'Source ')));
  F.agents.forEach((a) => c.push(chip('agents:' + a, a, avatarHTML(a, 22))));
  if (narrowed() || F.time !== '7d') c.push('<button type="button" class="ax-clear" data-clear>Clear all</button>');
  $('#axChips').innerHTML = c.join('');
  const n = activeCount();
  const badge = $('#axBadge');
  badge.hidden = !n;
  badge.textContent = String(n);
  $('#axFilt').setAttribute('aria-label', n ? `Filters, ${n} active` : 'Filters');
}

function paintSum(rows: ActivityItem[]): void {
  const fails = rows.filter((x) => stOf(x) === 'fail').length;
  const actors = new Set(rows.map((x) => x.actor)).size;
  $('#axSum').innerHTML = loading
    ? '<span>Loading…</span>'
    : `<span><b>${rows.length}</b> ${rows.length === 1 ? 'event' : 'events'}</span><span><b>${actors}</b> ${
        actors === 1 ? 'actor' : 'actors'
      }</span>${fails ? `<span class="bad"><b>${fails}</b> failed</span>` : ''}${
        view === 'day'
          ? `<button type="button" class="ax-tgl" id="axCompact" aria-pressed="${compact}" title="Collapse repeated calls by the same agent"><i></i>Group repeats</button>`
          : ''
      }`;
}

/** Keep the first visible row where it is while the list above it changes. */
function anchor(): () => void {
  const h = host();
  const stick = h.querySelector<HTMLElement>('#axBar')?.offsetHeight || 0;
  const top = h.getBoundingClientRect().top + stick;
  const rows = h.querySelectorAll<HTMLElement>('#axBody [data-act],#axBody .ax-ag');
  let el: HTMLElement | null = null;
  for (const r of rows) {
    if (r.getBoundingClientRect().bottom > top + 40) {
      el = r;
      break;
    }
  }
  if (!el || h.scrollTop < 40) return () => {};
  const key = el.dataset.act ? `[data-act="${window.CSS.escape(el.dataset.act)}"]` : null;
  const name = el.querySelector<HTMLElement>('[data-agent]')?.dataset.agent;
  const before = el.getBoundingClientRect().top;
  return () => {
    const again = key
      ? h.querySelector<HTMLElement>(`#axBody ${key}`)
      : name
        ? h.querySelector<HTMLElement>(`#axBody [data-agent="${window.CSS.escape(name)}"]`)?.closest<HTMLElement>('.ax-ag') || null
        : null;
    if (again) h.scrollTop += again.getBoundingClientRect().top - before;
  };
}

function paint(keepPlace = true): void {
  const body = document.getElementById('axBody');
  if (!body) return;
  paintChips();
  const sc = scoped();
  const rows = sc.filter((x) => matches(x));
  paintSum(rows);
  refreshFilters();
  if (loading) {
    body.setAttribute('aria-busy', 'true');
    body.innerHTML = skeletonHTML(view);
    return;
  }
  body.removeAttribute('aria-busy');
  const ctx: ViewCtx = {
    rows,
    agents: agentsOf(sc),
    fresh,
    limit,
    compact,
    older,
    narrowed: narrowed(),
    none: !sc.length,
  };
  const restore = keepPlace ? anchor() : () => {};
  body.innerHTML = view === 'agent' ? agentViewHTML(ctx) : view === 'board' ? boardViewHTML(ctx) : dayViewHTML(ctx);
  restore();
  fresh.clear();
  watchMore(body);
}

/** "Show more" loads itself when it scrolls into view. */
function watchMore(body: HTMLElement): void {
  io?.disconnect();
  const more = body.querySelector<HTMLElement>('[data-more]');
  if (!more || typeof IntersectionObserver === 'undefined') return;
  io = new IntersectionObserver(
    (en) => {
      if (en.some((x) => x.isIntersecting)) {
        io?.disconnect();
        limit += PAGE;
        paint(true);
      }
    },
    { root: host(), rootMargin: '0px 0px 300px 0px' },
  );
  io.observe(more);
}
