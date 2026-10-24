// Overview: greeting, KPIs, "Your AIs today", "Needs you", notes, agents, live activity, recent changes and technical details.

import { openTimeline } from './logs';
import { apiGet } from '../api';
import { on } from '../bus';
import { $, attr, esc, useStyles } from '../dom';
import { fmtTs, noteName, relTs } from '../format';
import { hooks } from '../hooks';
import { state, allNotes, colorOfFolder } from '../state';
import { agentColor, avatarHTML, setAgentColors } from '../control/agents';
import { connectOnLoad } from './keys';
import { actRowHTML, myName, openAgentPage, useActivityStyles, wireActRows } from '../control/activity';
import { loadFeed, onLive, pushLive, settleRunning, type ActivityItem } from '../control/feed';
import { groupBursts, isSystem, plainText, predicate, problemOf, whoOf } from '../control/sentence';
import { folderCount } from '../core-data';
import { requestSettingsSection, updateInfo, type UpdateInfo } from '../version';
import { ago, copyText, ICO, plural, sparkSVG, useControlStyles, whileVisible } from '../control/ui';
import { RT } from '../realtime';
import type { KeyRow, KeysResult } from '../types';
import type { Page } from '../state';
import { nav } from '../vault/nav';
import { openWelcome } from './welcome';
import { rowsSkeleton } from '../ui/skeleton';
import { firstSetupHTML, vaultEmpty, wireFirstSetup } from '../ui/first-setup';

// One 12-column grid driven by container queries, so the layout follows the space the view really gets.
const CSS = `
.ov{container:ov/inline-size;--r14:14px;--tile:color-mix(in srgb,var(--fg) 5%,transparent);--tile-h:color-mix(in srgb,var(--fg) 8%,transparent)}
@media (min-width:1101px){.ov{padding:8px 8px 0}}
.ov .ag-av{border-radius:30%}
.ov .ag-av.live::after{border-radius:34%}
.ov-head{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;margin:0 0 24px}
.ov-head .t{flex:1 1 320px;min-width:0}
.ov-date{margin:0 0 6px;font-size:13px;font-weight:500;color:var(--muted);font-variant-numeric:tabular-nums}
.ov-head h1{margin:0;font-size:26px;font-weight:650;letter-spacing:-.02em;line-height:1.2}
.ov-head p#ovSub{margin:6px 0 0;font-size:14px;line-height:1.5;color:var(--muted)}
.ov-acts{display:flex;align-items:center;gap:8px}
.ov-acts .btn{height:40px;min-width:156px;padding:0 16px;border-radius:10px;font-size:13.5px;justify-content:center;box-sizing:border-box}
.ov-acts .btn.primary{border:1px solid transparent}
.ov-acts .btn:not(.primary){background:var(--surface-1);border-color:var(--line-strong)}
.ov-acts .btn:not(.primary):hover{background:var(--hover)}
.ov-card{display:flex;flex-direction:column;min-width:0;background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r14);overflow:hidden}
.ov-card[hidden]{display:none}
.ov-card-h{display:flex;align-items:center;gap:8px;min-height:64px;padding:16px 16px 8px 22px;flex:none}
.ov-card-h h2{margin:0;font-size:15px;font-weight:600;letter-spacing:-.01em;color:var(--fg)}
.ov-card-h .n{display:inline-grid;place-items:center;min-width:22px;height:20px;padding:0 6px;border-radius:99px;background:var(--tile);
  font-size:12px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}
.ov-card-h .n:empty{display:none}
.ov-card-h .grow{flex:1}
.ov-card-b{padding:6px 22px 22px;flex:1;min-width:0}
.ov-card .icon-btn.round{border-color:var(--line);color:var(--muted)}
.ov-card .icon-btn.round:hover{border-color:var(--line-strong);color:var(--fg);background:var(--hover)}
.ov-lnk{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:600;color:var(--text-2);border-radius:6px}
.ov-lnk .cc-i{width:14px;height:14px}
.ov-lnk:hover{color:var(--fg);text-decoration:underline;text-underline-offset:3px}
.ov-lnk:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ov-cap{margin:0 0 10px;font-size:12.5px;font-weight:500;color:var(--muted)}
.ov-grid,.ov-top{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:16px;align-items:stretch}
.ov-grid>*,.ov-top>*{grid-column:span 12}
.ov-top{margin-bottom:16px}
.ov-grid>.ov-card{height:100%}
@container ov (min-width:640px){
  .ov-grid>.ov-vault,.ov-grid>.ov-agents,.ov-grid>.ov-activity,.ov-grid>.ov-recent{grid-column:span 6}
}
@container ov (min-width:1000px){
  .ov-grid,.ov-top{gap:20px}
  .ov-top{margin-bottom:20px}
  .ov-top.two>.ov-today{grid-column:span 7}
  .ov-top.two>.ov-needs{grid-column:span 5;order:2}
  .ov-grid>.ov-recent,.ov-grid>.ov-activity{grid-column:span 7}
  .ov-grid>.ov-agents,.ov-grid>.ov-vault{grid-column:span 5}
}
.ov-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:16px;background:var(--surface-1);border:1px solid var(--line);
  border-radius:var(--r14);overflow:hidden}
.ov-kpi{position:relative;display:flex;flex-direction:column;align-items:stretch;min-width:0;padding:20px 22px;text-align:left;transition:background .16s}
.ov-kpi:nth-child(even){border-left:1px solid var(--line)}
.ov-kpi:nth-child(n+3){border-top:1px solid var(--line)}
@container ov (min-width:900px){
  .ov-kpis{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:20px}
  .ov-kpi{padding:22px 24px}
  .ov-kpi:nth-child(n+2){border-left:1px solid var(--line)}
  .ov-kpi:nth-child(n+3){border-top:0}
}
.ov-kpi:hover{background:var(--hover)}
.ov-kpi:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:var(--r14)}
.ov-kpi-l{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:500;color:var(--muted)}
.ov-kpi-l .cc-i{width:16px;height:16px;stroke-width:1.7;color:var(--text-3)}
.ov-kpi-go{margin-left:auto;opacity:0;transition:opacity .16s}
.ov-kpi:hover .ov-kpi-go,.ov-kpi:focus-visible .ov-kpi-go{opacity:1}
.ov-kpi-v{margin-top:10px;font-size:32px;font-weight:400;letter-spacing:-.03em;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--fg)}
.ov-kpi-viz{display:flex;align-items:center;height:6px;margin:14px 0 10px}
.ov-seg{display:flex;gap:3px;width:100%;height:6px}
.ov-seg i{flex:1;border-radius:2px;background:var(--tile-h)}
.ov-seg i.on{background:var(--accent)}
.ov-kpi-bar{display:flex;gap:2px;width:100%;height:6px;border-radius:3px;overflow:hidden}
.ov-kpi-bar i{display:block;height:100%;min-width:3px}
.ov-kpi-h{display:flex;align-items:center;gap:6px;min-height:18px;font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ov-kpi-h b{color:var(--fg);font-weight:600}
.ov-kpi-h .cc-dot{width:6px;height:6px}
@container ov (max-width:420px){.ov-kpi{padding:16px}.ov-kpi-v{font-size:28px}.ov-kpi-viz{margin:12px 0 8px}}
.ov-facts{display:flex;flex-direction:column;gap:22px}
.ov-row{display:flex;align-items:center;gap:12px;min-width:0}
.ov-tile{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:var(--tile);color:var(--muted);flex:none}
.ov-tile .cc-i{width:17px;height:17px;stroke-width:1.7}
.ov-tile.fc{position:relative;color:var(--fc);background:color-mix(in srgb,var(--fc) 14%,transparent)}
.ov-tile.fc::after{display:none}
.ov-today-side{display:flex;flex-direction:column;min-width:0}
.ov-today-side>.ov-card-h{min-height:0;padding-top:20px;padding-bottom:4px}
.ov-day{position:sticky;top:0;z-index:1;padding:12px 22px 6px;font-size:12px;font-weight:500;color:var(--muted);background:var(--surface-1)}
.ov-day:first-child{padding-top:2px}
.ov-row .t{flex:1;min-width:0}
.ov-path{display:flex;min-width:0;font:500 12.5px/1.4 var(--mono);color:var(--fg)}
.ov-path .h{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ov-path .e{flex:none;white-space:nowrap}
.ov-sub{display:block;margin-top:2px;font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ov-name{max-width:100%;font-size:14px;font-weight:500;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;border-radius:4px}
button.ov-name:hover{text-decoration:underline;text-underline-offset:3px}
button.ov-name:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ov-bars{display:flex;flex-direction:column;gap:2px}
.ov-bar{display:grid;grid-template-columns:minmax(0,8.5rem) minmax(0,1fr) 2.5rem;align-items:center;gap:14px;height:36px;padding:0 10px;
  margin:0 -10px;border-radius:8px;text-align:left;font-size:13.5px;color:var(--fg)}
.ov-bar:hover{background:var(--hover)}
.ov-bar:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ov-bar .l{display:flex;align-items:center;gap:9px;min-width:0;font-weight:500}
.ov-bar .l span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ov-bar .d{width:7px;height:7px;border-radius:50%;flex:none}
.ov-bar .tr{height:5px;border-radius:99px;background:var(--tile);overflow:hidden}
.ov-bar .tr i{display:block;height:100%;border-radius:99px}
.ov-bar .c{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
.ov-more{margin-top:8px;font-size:12.5px;color:var(--muted)}
.ov-list{display:flex;flex-direction:column}
.ov-li{position:relative;display:flex;align-items:center;gap:14px;height:58px;padding:0 22px;min-width:0;width:100%;
  text-align:left;cursor:pointer;color:var(--fg);transition:background .14s;flex:none}
.ov-li+.ov-li::before{content:"";position:absolute;top:0;left:70px;right:22px;border-top:1px solid var(--line)}
.ov-li:hover{background:var(--hover)}
.ov-li:hover::before,.ov-li:hover+.ov-li::before{border-color:transparent}
.ov-li:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ov-li .t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.ov-li .n{display:flex;align-items:center;gap:6px;min-width:0;font-size:14px;font-weight:500;line-height:1.35;white-space:nowrap;overflow:hidden}
.ov-li .n>span{overflow:hidden;text-overflow:ellipsis}
.ov-li .s{display:flex;align-items:center;gap:6px;min-width:0;font-size:12.5px;line-height:1.35;color:var(--muted);white-space:nowrap;overflow:hidden}
.ov-li .s>span{overflow:hidden;text-overflow:ellipsis}
.ov-li .s .sep{flex:none;color:var(--text-3)}
/* the status never truncates; the last action after it gives way first */
.ov-li .s>.ov-st{flex:none}
.ov-li .s>.ov-st~span:last-child{flex:1 1 0;min-width:0}
.ov-li .m{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex:none;font-size:12.5px;color:var(--muted);
  font-variant-numeric:tabular-nums;white-space:nowrap}
.ov-li .m b{font-size:14px;font-weight:500;color:var(--fg)}
.ov-li .ag-who{color:var(--fg);font-weight:600;flex:none}
.ov-li .who{display:inline-flex;align-items:center;gap:6px;min-width:0;flex:0 1 auto;color:var(--text-2)}
.ov-li .who>span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis}
.ov-li .who .ag-av{flex:none;border-radius:6px}
.ov-li .s>span:first-child{flex:0 1 auto;min-width:0}
.ov-li .sp{width:56px;flex:none}
.ov-li.gone{color:var(--muted)}
.ov-li.gone .ag-av{filter:grayscale(1)}
.ov-li.new{animation:ovIn .8s var(--ease)}
@keyframes ovIn{from{background:color-mix(in srgb,var(--ag,var(--accent)) 12%,transparent)}to{background:transparent}}
.ov-st{display:inline-flex;align-items:center;gap:6px;flex:none}
.ov-st .cc-dot{width:6px;height:6px}
.ov-st.on{color:var(--fg)}
.ov-st.off{color:var(--danger)}
.ov-st.off::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--danger)}
.ov-scroll{flex:none;height:calc(58px * 8);overflow:hidden}
.ov-scroll>.ov-li{flex:none}
/* Recent changes has day headings: it takes the height its rows need */
#ovRecent.ov-scroll{height:auto}
.ov-rest{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:16px;margin:0 22px;border-top:1px dashed var(--line);
  font-size:12.5px;color:var(--text-3);text-align:center}
.ov-foot{display:flex;align-items:center;justify-content:center;height:48px;margin:0 22px;border-top:1px solid var(--line);flex:none}
.ov-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;min-height:220px;padding:28px 22px;
  text-align:center;font-size:13.5px;line-height:1.5;color:var(--muted)}
.ov-empty .ov-tile{width:44px;height:44px;border-radius:12px;margin-bottom:8px;color:var(--text-2)}
.ov-empty .ov-tile .cc-i{width:20px;height:20px}
.ov-empty b{font-size:15px;font-weight:600;color:var(--fg)}
.ov-empty p{margin:0;max-width:34ch}
.ov-empty .btn{margin-top:12px}
.ov-grow{flex:1}
.ov-agents{container:agl/inline-size}
@container agl (max-width:620px){.ov-li .sp{display:none}}
.ov-connect{padding:0 22px 6px;flex:none}
.ov-connect:empty{display:none}
.ov-add{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:44px;border-radius:10px;background:var(--tile);
  color:var(--text-2);font-size:13.5px;font-weight:500;transition:background .16s,color .16s}
.ov-add .cc-i{width:16px;height:16px}
.ov-add:hover{background:var(--tile-h);color:var(--fg)}
.ov-add:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ov-sys{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin:0 22px;border-top:1px solid var(--line)}
.ov-sys>div{display:flex;align-items:center;gap:10px;min-width:0;height:64px;padding:0 16px 0 0}
.ov-sys>div:nth-child(n+3){border-top:1px solid var(--line)}
@container ov (min-width:640px){
  .ov-sys{grid-template-columns:repeat(4,minmax(0,1fr))}
  .ov-sys>div:nth-child(n+3){border-top:0}
}
.ov-sys .t{flex:1;min-width:0}
.ov-sys small{display:block;font-size:12.5px;font-weight:500;color:var(--muted)}
.ov-sys b{display:block;margin-top:1px;font-size:13.5px;font-weight:500;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ov-sys .cc-dot{width:6px;height:6px}
.ov-pill{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:500;color:var(--text-2)}
.ov-pill.warn{color:var(--warn)}
.ov-pill.err{color:var(--danger)}
.ov-pill .cc-dot{width:6px;height:6px}
.ov-copy{width:30px;height:30px;border-radius:8px}
.ov-copy .cc-i{width:15px;height:15px}
.ov-top{container:top/inline-size}
.ov-hero{--hf:#f1f5f9;--hm:rgba(226,232,240,.62);position:relative;padding:22px 22px 18px;color:var(--hf);isolation:isolate;
  background:radial-gradient(520px 220px at 100% 0%,rgba(94,234,212,.16),transparent 70%),linear-gradient(180deg,#17202e,#0b0f17)}
.ov-hero-top{display:flex;align-items:flex-start;gap:12px}
.ov-hero-top .t{flex:1;min-width:0}
.ov-hero h2{display:flex;align-items:center;gap:8px;margin:0;font-size:15px;font-weight:600;color:var(--hf)}
.ov-hero h2::before{content:"";width:6px;height:6px;border-radius:50%;background:#5eead4;box-shadow:0 0 0 4px rgba(94,234,212,.16)}
.ov-hero-n{display:flex;align-items:baseline;gap:10px;margin-top:14px}
.ov-hero-n b{font-size:44px;font-weight:300;letter-spacing:-.04em;line-height:1;font-variant-numeric:tabular-nums}
.ov-hero-n span{font-size:13.5px;color:var(--hm)}
.ov-hero .icon-btn.round{border-color:rgba(255,255,255,.18);color:var(--hf);background:rgba(255,255,255,.04)}
.ov-hero .icon-btn.round:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.32);color:#fff}
.ov-hero .icon-btn.round:focus-visible{box-shadow:0 0 0 2px #5eead4}
.ov-legend{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:12px;font-size:12.5px;color:var(--hm)}
.ov-legend span{display:inline-flex;align-items:center;gap:6px}
.ov-legend i{width:8px;height:8px;border-radius:50%;background:var(--c);box-shadow:0 0 8px var(--c)}
.ov-legend b{color:var(--hf);font-weight:600;font-variant-numeric:tabular-nums}
.ov-chart{position:relative;display:block;height:84px;margin-top:20px}
.ov-chart svg{display:block;width:100%;height:100%;overflow:visible}
.ov-chart .g{stroke:rgba(255,255,255,.07);stroke-width:1;vector-effect:non-scaling-stroke}
.ov-chart .b{stroke:rgba(255,255,255,.16);stroke-width:1;vector-effect:non-scaling-stroke}
.ov-chart .later{stroke:rgba(255,255,255,.22);stroke-width:1;stroke-dasharray:3 4;vector-effect:non-scaling-stroke}
.ov-chart .now{stroke:rgba(255,255,255,.18);stroke-width:1;stroke-dasharray:2 3;vector-effect:non-scaling-stroke}
.ov-now{position:absolute;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;background:#fff;box-shadow:0 0 0 4px rgba(94,234,212,.28),0 0 12px rgba(94,234,212,.6)}
.ov-chart svg path{animation:ov-fade .6s ease-out both}
.ov-ticks{display:flex;justify-content:space-between;margin-top:8px;font-size:11.5px;color:var(--hm);font-variant-numeric:tabular-nums}
.ov-today .ov-list{flex:1}
.ov-today .act{min-height:58px;align-items:center;padding:10px 22px;border-top:1px solid var(--line)}
.ov-today .act:first-child{border-top:0}
.ov-today .act:hover{background:var(--hover)}
.ov-today .act .act-meta{justify-content:center}
:root .ov .ov-today .act-who,:root .ov .ov-today .act-who.go{color:var(--fg);font-weight:600}
.ov-today .act-l1{font-size:13.5px}
/* full width (nothing needs you): hero and list side by side */
@container top (min-width:900px){
  .ov-top:not(.two)>.ov-today{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr)}
  .ov-top:not(.two)>.ov-today .ov-hero{display:flex;flex-direction:column}
  .ov-top:not(.two)>.ov-today .ov-chart{margin-top:auto;padding-top:20px;height:104px;box-sizing:content-box}
  .ov-top:not(.two)>.ov-today .ov-list{flex:1}
}
.ov-needs .ov-card-h h2{display:flex;align-items:center;gap:9px}
.ov-needs .ov-card-h h2 .cc-dot{width:7px;height:7px;background:var(--warn);box-shadow:0 0 0 4px var(--warn-soft)}
.ov-needs-sub{margin-left:6px;font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ov-needs .ov-card-h{padding-bottom:12px}
#ovNeeds{display:flex;flex-direction:column;gap:10px;padding:0 16px 16px}
.ov-need{--tone:var(--warn);position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;padding:14px 40px 14px 14px;border-radius:12px;
  background:color-mix(in srgb,var(--tone) 6%,var(--surface-1));border:1px solid color-mix(in srgb,var(--tone) 22%,var(--line))}
.ov-need[data-kind=refused]{--tone:var(--danger)}
.ov-need[data-kind=update]{--tone:var(--accent)}
.ov-need-ic{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;color:var(--tone);background:color-mix(in srgb,var(--tone) 14%,transparent)}
.ov-need-ic .cc-i{width:18px;height:18px}
.ov-need-b{min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:4px}
.ov-need-k{font-size:12px;font-weight:600;color:var(--tone)}
.ov-need .tx{margin:0;font-size:13.5px;line-height:1.5;color:var(--text-2);overflow-wrap:anywhere}
.ov-need .tx b{font-weight:600;color:var(--fg)}
.ov-need .tx small{display:block;margin-top:2px;font-size:12.5px;color:var(--muted)}
.ov-need-go{margin-top:6px;height:32px;gap:6px;border-radius:9px}
.ov-need-go .cc-i{width:14px;height:14px}
.ov-need .ov-x{position:absolute;top:10px;right:10px;display:grid;place-items:center;width:26px;height:26px;padding:0;border-radius:8px;color:var(--muted)}
.ov-need .ov-x .cc-i{width:14px;height:14px}
.ov-need .ov-x:hover{color:var(--fg);background:var(--hover)}
.ov-need .ov-x:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ov-needs-f{margin:0;font-size:12.5px;color:var(--muted);white-space:nowrap}
.ov-needs-f:empty{display:none}
.ov-needs-f .ov-lnk{font-size:12px;font-weight:600}
.ov-needs-none{animation:ov-fade .4s ease-out both;margin:0;padding:14px;border-radius:12px;font-size:13.5px;color:var(--muted);background:color-mix(in srgb,var(--fg) 3%,transparent)}
@keyframes ov-breathe{0%,100%{opacity:1}50%{opacity:.45}}
@keyframes ov-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes ov-fade{from{opacity:0}to{opacity:1}}
.ov>*:not(.ov-head){animation:ov-rise .5s var(--ease-out) both}
.ov>.ov-kpis{animation-delay:.04s}.ov>.ov-top{animation-delay:.1s}.ov>.ov-grid{animation-delay:.16s}
.ov-grid>.ov-card{animation:ov-rise .5s var(--ease-out) both}
.ov-grid>.ov-card:nth-child(2){animation-delay:.2s}.ov-grid>.ov-card:nth-child(3){animation-delay:.24s}
.ov-grid>.ov-card:nth-child(4){animation-delay:.28s}.ov-grid>.ov-card:nth-child(5){animation-delay:.32s}
.ov-in>*{animation:ov-fade .35s var(--ease-out) both}
.ov-loading .ov-kpi :is([data-v],[data-viz],[data-h]){color:transparent!important;position:relative}
.ov-loading :is(.ov-kpi [data-viz],.ov-kpi [data-h],#ovTodayLg,#ovTodayChart)>*{visibility:hidden}
.ov-loading .ov-kpi :is([data-v],[data-viz],[data-h])::after,.ov-loading :is(#ovTodayN,#ovTodayLg,#ovTodayChart)::after,.ov-sk-block{
  content:"";display:block;position:absolute;left:0;top:50%;translate:0 -50%;border-radius:6px;background:var(--line-strong);animation:ov-breathe 1.5s ease-in-out infinite}
.ov-loading .ov-kpi [data-v]::after{width:72px;height:26px}
.ov-loading .ov-kpi [data-viz]::after{width:100%;height:6px}
.ov-loading .ov-kpi [data-h]::after{width:110px;height:10px}
.ov-loading :is(#ovTodayN,#ovTodayLg,#ovTodayChart){position:relative;color:transparent}
.ov-loading #ovTodayN::after{width:60px;height:36px;background:rgba(255,255,255,.1)}
.ov-loading #ovTodayLg{min-height:18px}
.ov-loading #ovTodayLg::after{width:170px;height:10px;background:rgba(255,255,255,.1)}
.ov-loading #ovTodayChart::after{inset:0;translate:none;width:auto;height:auto;background:rgba(255,255,255,.06)}
.ov-sk-block{position:static;translate:none;height:120px;margin:4px 0}
@media (prefers-reduced-motion:reduce){.ov>*,.ov-grid>.ov-card,.ov-in>*{animation:none}
  .ov-loading .ov-kpi :is([data-v],[data-viz],[data-h])::after,.ov-loading :is(#ovTodayN,#ovTodayLg,#ovTodayChart)::after,.ov-sk-block{animation:none}}
.ov-tech>summary{list-style:none;cursor:pointer;padding-bottom:16px}
.ov-tech>summary::-webkit-details-marker{display:none}
.ov-tech>summary:hover{background:var(--hover)}
.ov-tech>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ov-tech .chev{width:16px;height:16px;color:var(--muted);transition:transform .18s var(--ease);flex:none}
.ov-tech[open] .chev{transform:rotate(180deg)}
.ov-tech-more{display:grid;grid-template-columns:minmax(0,1fr);margin:0 22px 10px;border-top:1px solid var(--line)}
@container ov (min-width:720px){
  .ov-tech-more .t{display:grid;grid-template-columns:160px minmax(0,1fr);align-items:center;column-gap:20px}
  .ov-tech-more .t>:not(small){margin-top:0}
}
.ov-tech-more>div{display:flex;align-items:center;gap:12px;min-width:0;min-height:64px;padding:10px 0;border-top:1px solid var(--line)}
.ov-tech-more>div:first-child{border-top:0}
.ov-tech-more .t{flex:1;min-width:0}
.ov-tech-more small{display:block;font-size:12.5px;font-weight:500;color:var(--muted)}
.ov-tech-more .v{display:block;margin-top:2px;font-size:13.5px;line-height:1.45;color:var(--fg);overflow-wrap:anywhere}
.ov-tech>summary h2,.ov-tech .ov-pill{white-space:nowrap}
.ov.is-empty>:not(.ov-head):not(.ov-welcome){display:none}
@container ov (max-width:600px){
  .ov-head{gap:14px;margin-bottom:18px;align-items:stretch}
  .ov-head h1{font-size:23px}
  .ov-acts{width:100%}
  .ov-acts .btn{flex:1;height:44px}
  .ov-li{padding:0 16px;gap:12px}
  .ov-li+.ov-li::before{left:62px;right:16px}
  .ov-card-h{padding:12px 12px 4px 16px;min-height:56px}
  .ov-card-b{padding:6px 16px 16px}
  .ov-hero{padding:18px 16px 14px}
  .ov-hero-n b{font-size:38px}
  .ov-chart{height:72px}
  .ov-today .act{padding:10px 16px}
  .ov-sys,.ov-tech-more,.ov-foot,.ov-rest{margin-left:16px;margin-right:16px}
  #ovNeeds{padding:0 12px 12px}
  .ov-needs-sub{display:none}
  .ov-connect{padding:0 16px 6px}
  .ov-li .sp{display:none}
}
@container ov (max-width:420px){.ov-acts .btn{min-width:0;padding:0 12px}}
@media (prefers-reduced-motion:reduce){.ov-li.new{animation:none}.ov-tech .chev,.ov-kpi-go{transition:none}}
.ov-li .sn{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;font-size:13.5px;line-height:1.4;color:var(--text-2)}
.ov-li .sn .ag-who{font-weight:600;color:var(--fg)}
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
/** Agent rows shown: grows to fill the card beside Live activity, so "+N more" only appears when they don't fit. */
let agentCap = AGENT_ROWS;
let fitWired = false;
const FOLDER_ROWS = 5;
/** Folder rows shown: grows to fill Your notes beside Recent changes, so "+N more" only appears when they don't fit. */
let folderCap = FOLDER_ROWS;

let keys: KeyRow[] = [];
let oauth = new Set<string>();
let update: UpdateInfo | null = null;
const TECH_KEY = 'memora.overview.tech';
const DISMISS_KEY = 'memora.overview.dismissed';
const TODAY_ROWS = 3;
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
      `<button type="button" class="ov-kpi" id="${id}" data-go="${page}"><span class="ov-kpi-l">${icon}${label}<span class="ov-kpi-go">${ICO.open}</span></span>
        <span class="ov-kpi-v" data-v>0</span><span class="ov-kpi-viz" data-viz></span><span class="ov-kpi-h" data-h>&nbsp;</span></button>`;
    const open = (id: string, what: string): string =>
      `<button type="button" class="icon-btn round" id="${id}" aria-label="${attr(what)}" title="${attr(what)}">${ICO.open}</button>`;
    host.innerHTML = `<div class="cc ov ov-loading">
      <header class="ov-head"><div class="t"><p class="ov-date">${esc(today())}</p><h1>${esc(greeting())}${user ? ', ' + esc(user) : ''}</h1><p id="ovSub">&nbsp;</p></div>
        <div class="ov-acts"><button type="button" class="btn" id="ovNew" aria-label="New note">${ICO.plus}<span class="lbl">New note</span></button>
          <button type="button" class="btn primary" id="ovBrain">Open the brain ${ICO.arrow}</button></div></header>
      <section class="ov-welcome" id="ovWelcome" aria-labelledby="ovWelcomeT" hidden></section>
      <section class="ov-kpis" aria-label="Your notes in numbers">
        ${kpi('ovKNodes', 'vault', ICO.note, 'Notes')}${kpi('ovKLinks', 'graph', I.link, 'Links')}${kpi('ovKFolders', 'vault', I.folder, 'Folders')}${kpi(
          'ovKAgents',
          'keys',
          I.agent,
          'Agents',
        )}
      </section>
      <div class="ov-top" id="ovTop">
        <section class="ov-card ov-needs" id="ovNeedsCard" aria-labelledby="ovNeedsT" hidden><div class="ov-card-h"><h2 id="ovNeedsT"><span class="cc-dot"></span>Needs you</h2>
          <span class="n" id="ovNeedsN"></span><span class="ov-needs-sub">Things only you can decide</span><span class="grow"></span><p class="ov-needs-f" id="ovNeedsF"></p></div>
          <div class="ov-list" id="ovNeeds"></div></section>
        <section class="ov-card ov-today" aria-labelledby="ovTodayT"><div class="ov-hero"><div class="ov-hero-top"><div class="t"><h2 id="ovTodayT">Your AIs today</h2></div>
          ${open('ovTodayAll', 'See all activity')}</div><div class="ov-hero-n"><b id="ovTodayN">–</b><span id="ovTodayU">actions</span></div><div class="ov-legend" id="ovTodayLg"></div>
          <div class="ov-chart" id="ovTodayChart" aria-hidden="true"></div>
          <div class="ov-ticks" aria-hidden="true"><span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span><span>12 am</span></div></div>
          <div class="ov-today-side"><div class="ov-card-h"><h2>Latest</h2><span class="grow"></span></div><div class="ov-list" id="ovToday">${rowsSkeleton(3)}</div></div></section>
      </div>
      <div class="ov-grid">
        <section class="ov-card ov-vault" aria-labelledby="ovVaultT"><div class="ov-card-h"><h2 id="ovVaultT">Your notes</h2><span class="grow"></span>
          ${open('ovNodes', 'Open Notes')}</div><div class="ov-card-b" id="ovVault"><div class="ov-sk-block"></div></div></section>
        <section class="ov-card ov-recent" aria-labelledby="ovRecentT"><div class="ov-card-h"><h2 id="ovRecentT">Recent changes</h2><span class="grow"></span>
          ${open('ovRecentAll', 'Open Notes')}</div><div class="ov-list ov-scroll" id="ovRecent">${rowsSkeleton(5, false)}</div></section>
        <section class="ov-card ov-agents" aria-labelledby="ovAgentsT"><div class="ov-card-h"><h2 id="ovAgentsT">Agents</h2><span class="n" id="ovAgN"></span>
          <span class="grow"></span>${open('ovKeys', 'Manage agents')}</div><div class="ov-connect" id="ovConnect"></div>
          <div class="ov-list ov-grow" id="ovAgents">${rowsSkeleton(4)}</div></section>
        <section class="ov-card ov-activity" aria-labelledby="ovActT"><div class="ov-card-h"><h2 id="ovActT">Live activity</h2><span class="grow"></span>
          ${open('ovAll', 'Open Activity')}</div>
          <div class="ov-list ov-scroll" id="ovAct">${rowsSkeleton(8)}</div></section>
        <details class="ov-card ov-health ov-tech" id="ovTech"><summary class="ov-card-h"><h2 id="ovHealthT">Technical details</h2><span class="grow"></span>
          <span id="ovHealthPill"></span><svg class="cc-i chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
          <div class="ov-sys" id="ovHealth"></div><div class="ov-tech-more" id="ovTechMore"></div></details>
      </div>
    </div>`;
    $('#ovBrain').onclick = () => hooks.go('brain');
    $('#ovNew').onclick = () => hooks.openNewNote();
    $('#ovNodes').onclick = () => hooks.go('vault');
    $('#ovRecentAll').onclick = () => hooks.go('vault');
    $('#ovKeys').onclick = () => hooks.go('keys');
    $('#ovAll').onclick = () => hooks.go('logs');
    $('#ovTodayAll').onclick = () => openTimeline();
    const tech = $('#ovTech') as HTMLDetailsElement;
    try {
      tech.open = localStorage.getItem(TECH_KEY) === '1';
    } catch {
      /* storage blocked */
    }
    accordion(tech);
    tech.ontoggle = () => {
      try {
        localStorage.setItem(TECH_KEY, tech.open ? '1' : '0');
      } catch {
        /* storage blocked */
      }
    };
    const byId = (id: string): ActivityItem | undefined => feed.find((x) => x.id === id);
    wireActRows($('#ovToday'), byId);
    host.querySelectorAll<HTMLElement>('.ov-kpi[data-go]').forEach((b) => (b.onclick = () => hooks.go(b.dataset.go as Page)));
    wireActRows($('#ovAct'), byId);
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
      paintToday();
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

/** "Friday, October 23": the date line above the greeting. */
function today(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
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
    paintToday();
    paintNeeds();
  }, 150);
}

/** Fetch keys, feed and OAuth links, one run at a time; each call resolves once a run started after it has landed. */
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
  const [k, f, o, u] = await Promise.all([
    apiGet<KeysResult | KeyRow[]>('/api/keys').catch(() => null),
    loadFeed('1d', 500).catch(() => [] as ActivityItem[]),
    apiGet<{ connections?: { key_id: string }[] }>('/api/oauth/clients').catch(() => null),
    update ? Promise.resolve(update) : updateInfo(state.health.version || '').catch(() => null),
  ]);
  update = u;
  if (k) {
    keys = Array.isArray(k) ? k : k.keys || [];
    keysLoaded = true;
  }
  setAgentColors(keys);
  oauth = new Set((o?.connections || []).map((c) => c.key_id));
  feed = f;
  loaded = true;
  document.querySelector('.ov.ov-loading')?.classList.remove('ov-loading');
  paintWelcome();
  paintVault();
  paintAgents();
  paintRecent();
  paintActivity();
  paintHealth();
  paintToday();
  paintNeeds();
}

/** A <details> card that opens and closes with a height and fade animation instead of a jump. */
function accordion(d: HTMLDetailsElement): void {
  const sum = d.querySelector('summary');
  if (!sum) return;
  let anim: Animation | null = null;
  sum.addEventListener('click', (e) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    e.preventDefault();
    const from = d.offsetHeight;
    anim?.cancel();
    const opening = !d.open || d.classList.contains('closing');
    d.classList.remove('closing');
    if (opening) d.open = true;
    const to = opening ? d.offsetHeight : sum.offsetHeight + (d.offsetHeight - d.clientHeight);
    if (!opening) d.classList.add('closing');
    anim = d.animate([{ height: from + 'px' }, { height: to + 'px' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
    if (opening) for (const c of Array.from(d.children)) if (c !== sum) c.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'ease-out' });
    anim.onfinish = () => {
      anim = null;
      if (!opening) {
        d.classList.remove('closing');
        d.open = false;
      }
    };
  });
}

const TIME_TEXT = /(<time data-ts="[^"]*">)[^<]*(<\/time>)/g;

/** Replace content only when it changed, so focus, hover and touch scrolling survive the 2s tick; `<time data-ts>` text updates in place. */
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
  // The first real content after a skeleton fades in; later updates swap in place.
  const fromSkeleton = !!el.querySelector('.sk,.ov-sk-block');
  el.innerHTML = html;
  if (fromSkeleton) {
    el.classList.remove('ov-in');
    void el.offsetWidth;
    el.classList.add('ov-in');
  }
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

/** The key id an activity item was made with, if any. */
function kidOf(x: ActivityItem): string | null {
  return typeof x.raw.actor_id === 'string' ? x.raw.actor_id : null;
}

function regionColor(f: string): string {
  return colorOfFolder(f === 'Root' ? '' : f);
}

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

/** A segmented bar: `on` of `total` segments filled (at least one when on > 0). */
function segBar(on: number, total: number, title: string): string {
  if (!total) return '';
  return `<span class="ov-seg" title="${attr(title)}">${Array.from({ length: total }, (_, i) => `<i${i < on ? ' class="on"' : ''}></i>`).join('')}</span>`;
}

/** `part` of `whole` as filled segments out of SEGS. */
function segShare(part: number, whole: number, title: string): string {
  const SEGS = 12;
  return whole ? segBar(part ? Math.max(1, Math.round((part / whole) * SEGS)) : 0, SEGS, title) : '';
}

function paintSub(): void {
  const sub = document.getElementById('ovSub');
  if (!sub) return;
  // What this page is, not a recount of the numbers right below it.
  sub.textContent =
    !state.health.vault && state.health.vault_configured === false
      ? 'No notes folder is set up yet. See Technical details below.'
      : 'Your notes, your AIs and what they are doing, at a glance.';
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
    segShare(today, nodes, `${today} of ${nodes} notes changed today`),
    today ? `<b>${today}</b> changed today` : last ? `Last change ${esc(relTs(last))}` : 'No notes yet',
  );
  setKpi('ovKLinks', s.links || 0, '', s.links ? 'Between notes' : 'No links yet');
  const reg = regions();
  const total = reg.reduce((a, r) => a + r[1], 0) || 1;
  const biggest = reg.find(([f]) => f !== 'Root');
  setKpi(
    'ovKFolders',
    folderCount(),
    reg.length
      ? `<span class="ov-kpi-bar" title="${attr(reg.map(([f, n]) => `${f} ${n}`).join(', '))}">${reg
          .slice(0, 8)
          .map(([f, n]) => `<i style="flex:${n / total};background:${attr(regionColor(f))}"></i>`)
          .join('')}</span>`
      : '',
    biggest ? `Largest: <b>${esc(biggest[0])}</b>` : 'No folders yet',
  );
  paintAgentKpi();
}

function paintAgentKpi(): void {
  const rows = agentRows();
  const enabled = keys.filter((k) => k.enabled !== false).length;
  const active = rows.filter((r) => r.active).length;
  const busy = rows.filter((r) => r.items.length).length;
  const agentTimes = feed.filter((x) => x.source === 'agent').map((x) => x.ts);
  const calls = agentTimes.length;
  // Until the key list arrives the count is unknown: a placeholder, not 0.
  setKpi(
    'ovKAgents',
    keysLoaded ? enabled : loaded ? NaN : null,
    keysLoaded && rows.length <= 24 ? segBar(busy, rows.length, `${busy} of ${rows.length} agents did something in the last 24 hours`) : '',
    !loaded
      ? '&nbsp;'
      : !keysLoaded
        ? 'Could not load agents'
        : active
        ? `<span class="cc-dot ok"></span><b>${active}</b> active now`
        : calls
          ? `<b>${calls.toLocaleString()}</b> ${calls === 1 ? 'action' : 'actions'} in 24h`
          : enabled
            ? 'Nothing in 24h'
            : 'None connected yet',
  );
}

/** First run: the setup guide (connect, first prompt, watch it fill), until the first note exists; the rest of the dashboard waits. */
function paintWelcome(): void {
  const box = document.getElementById('ovWelcome');
  if (!box) return;
  const empty = vaultEmpty();
  box.hidden = !empty;
  box.closest('.ov')?.classList.toggle('is-empty', empty);
  // With AI keys already there, an empty vault is an empty notes folder, not a new Memora.
  const agents = keysLoaded ? keys.length : 0;
  const mode = agents ? 'known' : 'new';
  if (!empty || (box.childElementCount && box.dataset.mode === mode)) return;
  box.dataset.mode = mode;
  box.innerHTML = firstSetupHTML(agents);
  wireFirstSetup(box, newAgent, openWelcome);
}

/** Add folder rows while Your notes has room below them (the card is stretched to its row). */
function fitFolders(total: number): void {
  const card = document.querySelector<HTMLElement>('.ov-vault');
  const bars = card?.querySelectorAll<HTMLElement>('.ov-bar');
  if (!card || !bars?.length || bars.length >= total) return;
  const facts = card.querySelector<HTMLElement>('.ov-facts');
  if (!facts) return;
  const bottom = card.getBoundingClientRect().bottom - 22;
  const free = bottom - facts.getBoundingClientRect().bottom;
  const rowH = bars[0].offsetHeight + 2;
  const more = card.querySelector<HTMLElement>('.ov-more')?.offsetHeight || 0;
  const fit = Math.floor((free + (bars.length + Math.floor(free / rowH) >= total ? more : 0)) / rowH);
  if (fit > 0) {
    folderCap = Math.min(total, bars.length + fit);
    paintVault();
  }
}

function paintVault(): void {
  paintWelcome();
  paintSub();
  paintKpis();
  const box = document.getElementById('ovVault');
  if (!box) return;
  const notes = allNotes();
  const reg = regions();
  const max = reg[0]?.[1] || 1;
  const lastNote = notes.reduce<(typeof notes)[number] | null>((m, n) => ((n.mtime || 0) > (m?.mtime || 0) ? n : m), null);
  const by = lastNote ? writerOf(lastNote.path) : undefined;
  // The author's avatar when an agent or person is known to have made it, else a clock.
  const kid = by ? kidOf(by) : null;
  const lead = by
    ? `<span title="${attr('by ' + by.actor)}" style="display:flex">${avatarHTML(by.actor, 32, '', kid)}</span>`
    : `<span class="ov-tile">${I.clock}</span>`;
  const lastChange = `<div><div class="ov-cap">Last change</div><div class="ov-row">${lead}<span class="t">${
    lastNote
      ? `<button type="button" class="ov-name" data-path="${attr(lastNote.path)}" title="${attr(lastNote.path)}">${esc(
          lastNote.name || noteName(lastNote.path),
        )}</button><span class="ov-sub" title="${attr(fmtTs(lastNote.mtime))}">${esc(relTs(lastNote.mtime))} · ${esc(lastNote.folder || 'Top level')}${
          by ? ` · by ${esc(whoOf(by, myName()))}` : ''
        }</span>`
      : '<span class="ov-name">Nothing yet</span><span class="ov-sub">Changes to notes show up here</span>'
  }</span></div></div>`;
  const folders = `<div><div class="ov-cap">Largest folders</div>${
    reg.length
      ? `<div class="ov-bars">${reg
          .slice(0, folderCap)
          .map(([f, n]) => {
            const c = attr(regionColor(f));
            const name = f === 'Root' ? 'Top level' : f;
            return `<button type="button" class="ov-bar" data-folder="${attr(f)}" aria-label="${attr(`${name}: ${plural(n, 'note')}`)}">
              <span class="l"><span class="d" style="background:${c}"></span><span>${esc(name)}</span></span>
              <span class="tr"><i style="width:${Math.max(4, Math.round((n / max) * 100))}%;background:${c}"></i></span><span class="c">${n}</span></button>`;
          })
          .join('')}</div>${reg.length > folderCap ? `<div class="ov-more">+${plural(reg.length - folderCap, 'more folder')}</div>` : ''}`
      : '<div class="ov-sub">No notes yet.</div>'
  }</div>`;
  box.innerHTML = `<div class="ov-facts">${lastChange}${folders}</div>`;
  requestAnimationFrame(() => fitFolders(reg.length));
  box.querySelectorAll<HTMLElement>('[data-path]').forEach((b) => (b.onclick = () => hooks.openNote(b.dataset.path!)));
  box.querySelectorAll<HTMLElement>('[data-folder]').forEach((b) => {
    b.onclick = () => nav.selectFolder(b.dataset.folder === 'Root' ? '' : b.dataset.folder!);
  });
}

/** Activity of one live key: by key id when the event has one, else by name. */
function itemsOf(k: KeyRow): ActivityItem[] {
  const name = k.name || k.id;
  return feed.filter((x) => {
    if (x.source !== 'agent') return false;
    const kid = kidOf(x) ?? '';
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

/** Show more agent rows while the card has room below them (it is stretched to its row beside Live activity). */
function fitAgents(): void {
  if (!fitWired) {
    fitWired = true;
    window.addEventListener('resize', () => {
      agentCap = AGENT_ROWS;
      folderCap = FOLDER_ROWS;
      paintAgents();
      paintVault();
    });
  }
  const list = document.getElementById('ovAgents');
  const rows = list?.querySelectorAll<HTMLElement>(':scope > .ov-li');
  if (!list || !rows?.length) return;
  const total = agentRows().length;
  if (rows.length >= total) return;
  const cs = getComputedStyle(list);
  const used = Array.from(list.children).reduce((a, c) => a + (c as HTMLElement).offsetHeight, 0);
  const free = list.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - used;
  const rowH = rows[0].offsetHeight;
  const foot = list.querySelector<HTMLElement>('.ov-foot')?.offsetHeight || 0;
  const cap = rows.length + Math.floor((free + foot) / rowH) >= total ? total : rows.length + Math.floor(free / rowH);
  if (cap > rows.length) {
    agentCap = cap;
    paintAgents();
  }
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
      'Connect Claude, ChatGPT, Cursor or another AI app so it can remember things here.',
      `<button type="button" class="btn primary sm" id="ovNewKey">${ICO.plus}New agent</button>`,
    );
  else
    html =
      rows
        .slice(0, agentCap)
        .map((r) => {
          const name = r.k.name || r.k.id;
          const off = r.k.enabled === false;
          const status = off
            ? '<span class="ov-st off">Turned off</span>'
            : r.active
              ? '<span class="ov-st on"><span class="cc-dot ok" style="box-shadow:none;width:7px;height:7px"></span>Active now</span>'
              : r.last
                ? `<span class="ov-st">Seen ${whenTag(r.last.ts)}</span>`
                : `<span class="ov-st">${oauth.has(r.k.id) ? 'Signed in, nothing in 24h' : r.k.last_used ? 'Nothing in 24h' : 'Not connected yet'}</span>`;
          const what = r.last ? `<span class="sep">·</span><span>${esc(plainText(predicate(r.last)))}</span>` : '';
          const v = buckets(
            r.items.map((x) => x.ts),
            30,
            60,
          );
          const n30 = v.reduce((a, b) => a + b, 0);
          const sp = n30 ? `<span class="sp" title="${plural(n30, 'action')} in the last 30 minutes">${sparkSVG(v, 56, 24)}</span>` : '';
          return `<button type="button" class="ov-li" data-agent="${attr(name)}" data-kid="${attr(r.k.id)}" style="--ag:${attr(agentColor(name, r.k.id))}">${avatarHTML(
            name,
            32,
            r.active ? 'live' : '',
            r.k.id,
          )}<span class="t"><span class="n"><span>${esc(name)}</span></span><span class="s">${status}${what}</span></span>${sp}
            <span class="m"><b>${r.items.length.toLocaleString()}</b>${r.items.length === 1 ? 'action' : 'actions'}</span></button>`;
        })
        .join('') +
      (rows.length > agentCap
        ? `<div class="ov-foot"><button type="button" class="ov-lnk" data-more>+${plural(rows.length - agentCap, 'more agent')}</button></div>`
        : '');
  if (!setHTML(box, html)) return;
  requestAnimationFrame(fitAgents);
  box.querySelector<HTMLElement>('#ovNewKey')?.addEventListener('click', newAgent);
  box.querySelector<HTMLElement>('[data-more]')?.addEventListener('click', () => hooks.go('keys'));
  box.querySelectorAll<HTMLElement>('[data-agent]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.kid) {
        openAgentPage(b.dataset.kid, 'activity');
        return;
      }
      try {
        sessionStorage.setItem('memora.activity.agent', b.dataset.agent!);
      } catch {
        /* optional */
      }
      hooks.go('logs');
    };
  });
}

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
  // Grouped by day, newest first: Today, Yesterday, then the weekday or the date.
  const dayOf = (ts: number): string => {
    const d = new Date(ts * 1000);
    const t = new Date();
    const days = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  let lastDay = '';
  const html = notes.length
    ? notes
        .map((n) => {
          const day = dayOf(n.mtime || 0);
          const head = day !== lastDay ? `<div class="ov-day">${esc(day)}</div>` : '';
          lastDay = day;
          const it = writerOf(n.path);
          const kid = it ? kidOf(it) : null;
          const by = it ? `<span class="sep">·</span><span class="who">${avatarHTML(it.actor, 18, '', kid)}<span>${esc(whoOf(it, myName()))}</span></span>` : '';
          return `${head}<button type="button" class="ov-li" data-path="${attr(n.path)}" title="${attr(n.path)}"><span class="ov-tile fc" style="--fc:${attr(
            colorOfFolder(n.folder || ''),
          )}">${ICO.note}</span><span class="t"><span class="n"><span>${esc(n.name || noteName(n.path))}</span></span><span class="s"><span>${esc(
            n.folder || 'Top level',
          )}</span>${by}</span></span><span class="m" title="${attr(fmtTs(n.mtime))}">${whenTag(n.mtime || 0)}</span></button>`;
        })
        .join('') + restHTML(notes.length, 'That is every note.')
    : emptyHTML(ICO.note, 'No changes yet', 'Notes you or your AIs write show up here, newest first.');
  if (!setHTML(rec, html)) return;
  rec.querySelectorAll<HTMLElement>('[data-path]').forEach((b) => (b.onclick = () => hooks.openNote(b.dataset.path!)));
}

function paintActivity(): void {
  const host = document.getElementById('ovAct');
  if (!host) return;
  const live = new Set(keys.map((k) => k.id));
  const names = new Set(keys.map((k) => k.name || k.id));
  const now = Date.now() / 1000;
  const me = myName();
  // The newest calls and changes of the last 24 hours; older ones and system lines are in Activity.
  const list = feed.filter((x) => !isSystem(x) && now - x.ts < ACTIVITY_WINDOW).slice(0, LIST_ROWS);
  const html = !loaded
    ? rowsSkeleton(8)
    : list.length
      ? list
          .map((x) => {
            const kid = kidOf(x) ?? '';
            // History from keys that no longer exist stays, greyed out.
            const gone = x.source === 'agent' && (kid ? !live.has(kid) : !names.has(x.actor));
            const fresh = !!x.live && now - x.ts < 2;
            const who = whoOf(x, me);
            const pred = plainText(predicate(x));
            const problem = problemOf(x);
            const st = settleRunning(x)
              ? '<span class="ov-st"><span class="cc-dot run"></span>Working…</span>'
              : problem
                ? `<span class="ov-st off">${problem === 'refused' ? 'Refused' : 'Did not work'}</span>`
                : '';
            return `<div class="ov-li${gone ? ' gone' : ''}${fresh ? ' new' : ''}" role="button" tabindex="0" data-act="${attr(x.id)}" style="--ag:${attr(
              agentColor(x.actor, kid || null),
            )}" aria-label="${attr(`${who} ${pred}`)}"${gone ? ' title="No longer connected"' : ''}>${avatarHTML(x.actor, 32, x.running ? 'live' : '', kid || null)}
              <span class="t"><span class="sn"><span class="ag-who">${esc(who)}</span> ${esc(pred)}</span></span>
              <span class="m"><span title="${attr(fmtTs(x.ts))}">${whenTag(x.ts)}</span>${st}</span></div>`;
          })
          .join('') + restHTML(list.length, 'Nothing else in the last 24 hours.')
      : emptyHTML(I.pulse, 'Quiet for now', 'Nothing in the last 24 hours. What your AIs do shows up here as it happens.');
  setHTML(host, html);
}

/** Today's AI actions (since local midnight), newest first; refused ones are in Needs you. */
function todays(): ActivityItem[] {
  const mid = new Date();
  mid.setHours(0, 0, 0, 0);
  const since = mid.getTime() / 1000;
  return feed.filter((x) => x.ts >= since && x.source === 'agent' && !isSystem(x) && whoOf(x) !== 'You');
}

function paintToday(): void {
  const box = document.getElementById('ovToday');
  if (!box) return;
  const all = todays();
  const done = all.filter((x) => problemOf(x) !== 'refused');
  // Wider groups than Activity: one sentence per stretch of similar work.
  const groups = groupBursts(done, true, 15 * 60, 60 * 60);
  paintTodayChart(all, done.length);
  let html: string;
  if (!loaded) html = rowsSkeleton(3);
  else if (!groups.length)
    html = keys.length
      ? emptyHTML(I.pulse, 'Nothing yet today', 'When your AIs read or write notes, you see it here in plain sentences.')
      : emptyHTML(
          I.agent,
          'No AI connected yet',
          'Connect an AI app, and everything it remembers for you shows up here.',
          `<button type="button" class="btn primary sm" data-new-agent>${ICO.plus}Connect an AI</button>`,
        );
  else
    html =
      groups
        .slice(0, TODAY_ROWS)
        .map((b) => actRowHTML(b.it, { burst: b, compact: true }))
        .join('') +
      (groups.length > TODAY_ROWS
        ? `<div class="ov-foot"><button type="button" class="ov-lnk" data-all>${plural(groups.length - TODAY_ROWS, 'more thing')} today</button></div>`
        : '');
  if (!setHTML(box, html.replace(/<span title="[^"]*">(\d\d:\d\d) · [^<]*<\/span>/g, '<span>$1</span>'))) return;
  box.querySelector<HTMLElement>('[data-new-agent]')?.addEventListener('click', newAgent);
  box.querySelector<HTMLElement>('[data-all]')?.addEventListener('click', () => hooks.go('logs'));
}

/** Hero colours on the slate card: reads sky, changes teal, refused rose. */
const HERO_C = { read: '#7dd3fc', write: '#5eead4', refused: '#fda4af' };

/** The hero's count, legend and chart of today. */
function paintTodayChart(all: ActivityItem[], done: number): void {
  const n = document.getElementById('ovTodayN');
  const u = document.getElementById('ovTodayU');
  const lg = document.getElementById('ovTodayLg');
  const chart = document.getElementById('ovTodayChart');
  if (!n || !u || !lg || !chart) return;
  n.textContent = loaded ? done.toLocaleString() : '–';
  u.textContent = done === 1 ? 'action so far' : 'actions so far';
  const hours = Array.from({ length: 24 }, () => ({ read: 0, write: 0, refused: 0 }));
  let reads = 0;
  let writes = 0;
  let refused = 0;
  for (const x of all) {
    const h = hours[new Date(x.ts * 1000).getHours()];
    if (problemOf(x) === 'refused') {
      h.refused++;
      refused++;
    } else if (WRITES.test(x.action)) {
      h.write++;
      writes++;
    } else {
      h.read++;
      reads++;
    }
  }
  const dot = (c: string, v: number, l: string): string => `<span><i style="--c:${c}"></i><b>${v.toLocaleString()}</b>${l}</span>`;
  setHTML(
    lg,
    loaded
      ? dot(HERO_C.read, reads, reads === 1 ? 'read' : 'reads') +
          dot(HERO_C.write, writes, writes === 1 ? 'change' : 'changes') +
          (refused ? dot(HERO_C.refused, refused, 'refused') : '')
      : '&nbsp;',
  );
  setHTML(chart, todayArea(hours));
}

/** Today as stacked cumulative areas (reads, changes, refused) from midnight to now, with a dot at now. */
type Pt = { t: number; r: number; w: number; x: number };

function todayArea(hours: { read: number; write: number; refused: number }[]): string {
  const W = 240;
  const H = 84;
  const d = new Date();
  const now = d.getHours() + d.getMinutes() / 60;
  let r = 0;
  let w = 0;
  let x = 0;
  const pts: Pt[] = [{ t: 0, r: 0, w: 0, x: 0 }];
  for (let i = 0; i < 24 && i < now; i++) {
    r += hours[i].read;
    w += hours[i].write;
    x += hours[i].refused;
    pts.push({ t: Math.min(i + 1, now), r, w, x });
  }
  const max = Math.max(1, r + w + x);
  const X = (t: number): number => (t / 24) * W;
  const Y = (v: number): number => H - 2 - (v / max) * (H - 8);
  const line = (f: (p: Pt) => number): string => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(f(p)).toFixed(1)}`).join('');
  const area = (top: (p: Pt) => number, low: (p: Pt) => number): string =>
    line(top) +
    pts
      .slice()
      .reverse()
      .map((p) => `L${X(p.t).toFixed(1)},${Y(low(p)).toFixed(1)}`)
      .join('') +
    'Z';
  const layers = [
    { c: HERO_C.read, top: (p: Pt) => p.r, low: () => 0, id: 'r' },
    { c: HERO_C.write, top: (p: Pt) => p.r + p.w, low: (p: Pt) => p.r, id: 'w' },
    { c: HERO_C.refused, top: (p: Pt) => p.r + p.w + p.x, low: (p: Pt) => p.r + p.w, id: 'x' },
  ];
  const grads = layers
    .map((l) => `<linearGradient id="ovg-${l.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${l.c}" stop-opacity=".42"/><stop offset="1" stop-color="${l.c}" stop-opacity=".06"/></linearGradient>`)
    .join('');
  const shapes = layers
    .map(
      (l) =>
        `<path d="${area(l.top, l.low)}" fill="url(#ovg-${l.id})"/><path d="${line(l.top)}" fill="none" stroke="${l.c}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`,
    )
    .join('');
  const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="${W * f}" y1="0" x2="${W * f}" y2="${H}" class="g"/>`).join('');
  const last = pts[pts.length - 1];
  const nx = X(last.t);
  const ny = Y(last.r + last.w + last.x);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs>${grads}</defs>${grid}
    <line x1="0" y1="${H - 2}" x2="${W}" y2="${H - 2}" class="b"/><line x1="${nx}" y1="${H - 2}" x2="${W}" y2="${H - 2}" class="later"/>${shapes}
    <line x1="${nx}" y1="0" x2="${nx}" y2="${H}" class="now"/></svg><span class="ov-now" style="left:${((nx / W) * 100).toFixed(2)}%;top:${((ny / H) * 100).toFixed(2)}%"></span>`;
}

interface Need {
  /** Dismissed under this key (a refusal comes back when a newer one happens). */
  id: string;
  /** What kind of thing needs you: sets the label and the colour. */
  kind: 'refused' | 'waiting' | 'update';
  icon: string;
  html: string;
  action: string;
  run: () => void;
}

function dismissed(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function dismiss(id: string): void {
  const d = dismissed();
  d.add(id);
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...d].slice(-100)));
  } catch {
    /* storage blocked: hidden for this visit only */
  }
  hiddenNow.add(id);
  paintNeeds();
}

/** Dismissed in this visit even when storage is blocked. */
const hiddenNow = new Set<string>();

/** Bring back every dismissed item that still applies. */
function undismissAll(): void {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* storage blocked: nothing was kept */
  }
  hiddenNow.clear();
  paintNeeds();
}

/** What needs you now, and how many of those were dismissed. */
function needs(): { shown: Need[]; hidden: number } {
  const out: Need[] = [];
  const me = myName();
  // Refused today, one line per AI.
  const refused = new Map<string, ActivityItem[]>();
  for (const x of todays()) {
    if (problemOf(x) !== 'refused') continue;
    const k = kidOf(x) || x.actor;
    if (!refused.has(k)) refused.set(k, []);
    refused.get(k)!.push(x);
  }
  for (const [k, list] of refused) {
    const last = list[0];
    const who = esc(whoOf(last, me));
    const kid = kidOf(last) ?? '';
    out.push({
      id: `refused:${k}@${Math.round(last.ts)}`,
      kind: 'refused',
      icon: ICO.shield,
      html:
        list.length === 1
          ? `<b>${who}</b> ${predicate(last)}.`
          : `<b>${who}</b> was refused ${list.length} times today.<small>Latest: ${esc(plainText(predicate(last)))}.</small>`,
      action: kid ? 'Change what it may do' : 'See what happened',
      run: () => (kid ? openAgentPage(kid, 'access') : hooks.go('logs')),
    });
  }
  // Set up but never connected.
  const seen = new Set(feed.map((x) => kidOf(x) ?? ''));
  const waiting = keys.filter((k) => k.enabled !== false && !k.last_used && !k.uses && !seen.has(k.id) && !oauth.has(k.id));
  if (waiting.length === 1) {
    const k = waiting[0];
    out.push({
      id: `nc:${k.id}`,
      kind: 'waiting',
      icon: ICO.plug,
      html: `<b>${esc(k.name || k.id)}</b> is set up but has not connected yet.`,
      action: 'Finish connecting',
      run: () => openAgentPage(k.id, 'setup'),
    });
  } else if (waiting.length > 1) {
    const names = waiting.map((k) => k.name || k.id);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    out.push({
      id: 'nc:' + waiting.map((k) => k.id).sort().join(','),
      kind: 'waiting',
      icon: ICO.plug,
      html: `${waiting.length} AIs are set up but have not connected yet: <b>${esc(list)}</b>.`,
      action: 'See your agents',
      run: () => hooks.go('keys'),
    });
  }
  if (update?.available && update.latest)
    out.push({
      id: `update:${update.latest}`,
      kind: 'update',
      icon: ICO.download,
      html: `A new version of Memora is available: <b>v${esc(update.latest)}</b>.`,
      action: 'See what is new',
      run: () => {
        requestSettingsSection('stVersion');
        hooks.go('settings');
      },
    });
  const gone = dismissed();
  const shown = out.filter((n) => !gone.has(n.id) && !hiddenNow.has(n.id));
  return { shown, hidden: out.length - shown.length };
}

const NEED_LABEL: Record<Need['kind'], string> = { refused: 'Access refused today', waiting: 'Not connected yet', update: 'Update available' };

/** The Needs you items on screen, so the next paint knows which ones are new; null before the first paint. */
let needsShown: Set<string> | null = null;

/** Open or fold away one Needs you item in two steps (space and fade), so the items below glide. */
function slide(el: HTMLElement, open: boolean): Promise<void> {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const cs = getComputedStyle(el);
  const box = { height: el.offsetHeight + 'px', paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginBottom: '0px', borderWidth: '1px' };
  const gone = { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: '-10px', borderWidth: '0px' };
  el.style.overflow = 'hidden';
  const frames: Keyframe[] = open
    ? [
        { ...gone, opacity: 0, transform: 'translateY(-6px)' },
        { ...box, opacity: 0, transform: 'translateY(-6px)', offset: 0.5 },
        { ...box, opacity: 1, transform: 'none' },
      ]
    : [
        { ...box, opacity: 1, transform: 'none' },
        { ...box, opacity: 0, transform: 'translateX(10px)', offset: 0.42 },
        { ...gone, opacity: 0, transform: 'translateX(10px)' },
      ];
  const a = el.animate(frames, { duration: open ? 520 : 480, easing: 'cubic-bezier(.45,0,.2,1)', fill: open ? 'none' : 'forwards' });
  return a.finished.then(() => {
    el.style.overflow = '';
  });
}

function paintNeeds(): void {
  const card = document.getElementById('ovNeedsCard');
  const box = document.getElementById('ovNeeds');
  if (!card || !box) return;
  const { shown: list, hidden } = loaded ? needs() : { shown: [], hidden: 0 };
  // Shown when something needs attention, or when dismissed items can be brought back.
  card.hidden = !list.length && !hidden;
  const foot = document.getElementById('ovNeedsF');
  if (foot) {
    foot.innerHTML = hidden
      ? `${hidden} dismissed · <button type="button" class="ov-lnk" id="ovNeedsBack">Show again</button>`
      : '';
    document.getElementById('ovNeedsBack')?.addEventListener('click', undismissAll);
  }
  document.getElementById('ovTop')?.classList.toggle('two', !card.hidden);
  const n = document.getElementById('ovNeedsN');
  if (n) n.textContent = list.length > 1 ? String(list.length) : '';
  const html = list.length
    ? list
    .map(
      (x, i) => `<div class="ov-need" data-kind="${x.kind}" data-id="${attr(x.id)}"><span class="ov-need-ic">${x.icon}</span>
        <div class="ov-need-b"><span class="ov-need-k">${NEED_LABEL[x.kind]}</span><p class="tx">${x.html}</p>
          <button type="button" class="btn sm ov-need-go" data-need="${i}">${esc(x.action)}${ICO.arrow}</button></div>
        <button type="button" class="ov-x" data-dismiss="${attr(x.id)}" title="Dismiss" aria-label="${attr('Dismiss: ' + plainText(x.html))}">${ICO.x}</button></div>`,
    )
    .join('')
    : '<p class="ov-needs-none">Nothing needs you right now.</p>';
  const before = needsShown;
  needsShown = new Set(list.map((x) => x.id));
  if (!setHTML(box, html)) return;
  // Items that come back (Show again) or newly appear slide open; the first paint does not.
  if (before)
    box.querySelectorAll<HTMLElement>('.ov-need').forEach((el) => {
      if (!before.has(el.dataset.id || '')) slide(el, true);
    });
  box.querySelectorAll<HTMLElement>('[data-need]').forEach((b) => (b.onclick = () => list[Number(b.dataset.need)]?.run()));
  box.querySelectorAll<HTMLButtonElement>('[data-dismiss]').forEach((b) => {
    b.onclick = () => {
      const el = b.closest<HTMLElement>('.ov-need');
      if (!el) return dismiss(b.dataset.dismiss!);
      b.disabled = true;
      slide(el, false).then(() => dismiss(b.dataset.dismiss!));
    };
  });
}

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
  paintTech();
  paintConnect();
  const bad = !ok || rt === 'off' || !vaultOk || h.locked;
  const pill = document.getElementById('ovHealthPill');
  if (pill)
    pill.innerHTML = bad
      ? '<span class="ov-pill err"><span class="cc-dot err"></span>Needs attention</span>'
      : rt !== 'on' || h.armed
        ? `<span class="ov-pill warn"><span class="cc-dot run"></span>${h.armed ? 'Sign-in window open' : 'Connecting'}</span>`
        : '<span class="ov-pill"><span class="cc-dot ok"></span>All good</span>';
  // Something wrong is never folded away.
  const tech = document.getElementById('ovTech') as HTMLDetailsElement | null;
  if (tech && bad) tech.open = true;
}

/** The address AIs connect to, the notes folder on the server and the raw counts. */
function paintTech(): void {
  const box = document.getElementById('ovTechMore');
  if (!box) return;
  const base = state.health.base_url;
  const mcp = base ? base.replace(/\/+$/, '') + '/mcp' : '';
  const v = state.health.vault || '';
  const s = state.stats;
  const nodes = s.notes || allNotes().length;
  const top = allNotes().some((n) => !n.folder || n.folder === 'Root') ? ' (plus notes at the top level)' : '';
  const row = (icon: string, k: string, val: string, copy = ''): string =>
    `<div><span class="ov-tile">${icon}</span><span class="t"><small>${esc(k)}</small>${val}</span>${copy}</div>`;
  const html =
    row(
      ICO.plug,
      'MCP endpoint',
      mcp ? `<span class="ov-path" title="${attr(mcp)}"><span class="h">${esc(mcp)}</span></span>` : '<span class="v">Not known yet</span>',
      mcp ? `<button type="button" class="cc-ibtn ov-copy" data-copy="${attr(mcp)}" data-what="MCP endpoint" aria-label="Copy the MCP endpoint" title="Copy">${ICO.copy}</button>` : '',
    ) +
    row(
      I.folder,
      'Vault folder',
      v ? pathHTML(v) : '<span class="v">Not configured: set MEMORA_VAULT to a folder of Markdown files</span>',
      v ? `<button type="button" class="cc-ibtn ov-copy" data-copy="${attr(v)}" data-what="Vault path" aria-label="Copy the vault path" title="Copy">${ICO.copy}</button>` : '',
    ) +
    row(
      ICO.note,
      'Counts',
      `<span class="v" title="${attr(`${nodes} Markdown files, ${s.links || 0} links, ${folderCount()} top-level folders${top}`)}">${nodes.toLocaleString()} notes · ${(
        s.links || 0
      ).toLocaleString()} links${nodes ? ` (${((s.links || 0) / nodes).toFixed(1)} per note)` : ''} · ${plural(folderCount(), 'folder')}${esc(top)}</span>`,
    );
  if (!setHTML(box, html)) return;
  box.querySelectorAll<HTMLElement>('[data-copy]').forEach((b) => (b.onclick = () => void copyText(b.dataset.copy!, `${b.dataset.what} copied`)));
}

/** New agent: the Agents page with the connect flow open. */
function newAgent(): void {
  connectOnLoad();
  hooks.go('keys');
}

/** "Connect another AI" under the Agents title; the empty list has its own button. */
function paintConnect(): void {
  const box = document.getElementById('ovConnect');
  if (!box) return;
  const html =
    loaded && keys.length
      ? `<button type="button" class="ov-add" data-new-agent title="Claude, ChatGPT, Cursor and more">${ICO.plus}Connect another AI</button>`
      : '';
  if (!setHTML(box, html)) return;
  box.querySelector<HTMLElement>('[data-new-agent]')?.addEventListener('click', newAgent);
}
