// Shared timeline, summary cards, time select and export for the Activity page and an agent's Activity tab.

import { attr, esc, useStyles } from '../dom';
import { dayLabel, debounce, noteName } from '../format';
import { actRowHTML, canUndo } from '../control/activity';
import { actionLabel, groupBursts, plainText, predicate, problemOf } from '../control/sentence';
import { agentColor, avatarHTML } from '../control/agents';
import type { ActivityItem } from '../control/feed';
import { ago, download, ICO, plural } from '../control/ui';
import { rowsSkeleton, skBlock } from '../ui/skeleton';
import { createSelect, type Select, type SelectOption } from '../ui/select';
import { toast } from '../toast';
import { CLASSES, QUICK, TIMES, catOf, isoDay, labelOf, stOf, type AgentInfo, type Cat, type Quick, type TimeKey } from './activity-model';

export const CAT_COLOR: Record<Cat, string> = {
  read: 'var(--info)',
  search: 'var(--accent-2)',
  write: 'var(--ok)',
  delete: 'var(--danger)',
  auth: 'var(--warn)',
  other: 'var(--muted)',
};

const CLOCK = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>';
const X = '<span class="x" aria-hidden="true"><svg class="cc-i" viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg></span>';
const CAT_ICON: Partial<Record<Cat, string>> = {
  read: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  search: ICO.search,
  write: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  delete: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  auth: ICO.key,
};
const CHEV_R = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

const CSS = `
.tl{container:tl/inline-size;--page:var(--surface-0);--tile:color-mix(in srgb,var(--fg) 5%,transparent);
  --tile-h:color-mix(in srgb,var(--fg) 8%,transparent);--r14:14px}
@media (max-width:760px){.tl{--page:var(--bg-grad),var(--bg);--page-solid:var(--bg)}}

.tl-h{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 12px;margin:0 0 4px}
.tl-h h2{margin:0;font-size:17px;font-weight:600;letter-spacing:-.01em;color:var(--fg)}
.tl-h .sub{font-size:13px;color:var(--muted)}

.tl-bar{position:sticky;top:var(--tl-top,calc(-1 * var(--ax-pt,24px)));z-index:6;margin:0;padding:10px 0;border-bottom:1px solid transparent;
  transition:border-color .16s}
.tl-bar.stuck{border-bottom-color:var(--line);background:var(--page);background-attachment:fixed}
.tl-bar.stuck::before{content:"";position:absolute;left:0;right:0;bottom:100%;height:var(--tl-cover,0px);background:var(--page);background-attachment:fixed}
.tl-bar-in{display:flex;align-items:center;gap:10px;min-width:0}
.tl-pills{flex:1 1 auto;min-width:0;padding:2px 0}
.tl .chip{height:34px;border-color:var(--line-strong);font-weight:550}
.tl .chip[aria-pressed=true]{background:var(--fg);color:var(--surface-0);border-color:transparent}
.ax-q{display:flex;align-items:center;gap:10px;flex:0 1 340px;height:40px;padding:0 6px 0 12px;border-radius:10px;min-width:0;cursor:text;
  background:color-mix(in srgb,var(--fg) 5%,transparent);border:1px solid transparent;transition:border-color .16s,background .16s,box-shadow .16s}
.ax-q:hover{border-color:var(--line)}
.ax-q:focus-within{background:var(--surface-1);border-color:var(--line-strong);box-shadow:0 0 0 3px color-mix(in srgb,var(--fg) 6%,transparent)}
.ax-q>.cc-i{width:17px;height:17px;color:var(--muted)}
.ax-q input{flex:1;min-width:0;height:100%;border:0;outline:none;background:none;color:var(--fg);font-size:14px;padding:0}
.ax-q input::placeholder{color:var(--text-3)}
.ax-q input::-webkit-search-cancel-button{display:none}
.ax-q kbd{flex:none;padding:0 4px}
.ax-qx{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;color:var(--muted);flex:none}
.ax-qx:hover{background:var(--hover);color:var(--fg)}
.ax-qx[hidden],.ax-q.has kbd{display:none}
.ax-fbtn{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--line);flex:none;
  background:var(--surface-1);color:var(--fg);font-size:13.5px;font-weight:550;white-space:nowrap;transition:border-color .16s}
.ax-fbtn:hover{border-color:var(--line-strong)}
.ax-fbtn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--accent)}
.ax-q input:focus-visible{outline:none}
.ax-fbtn .cc-i{width:16px;height:16px;color:var(--muted)}
.ax-badge{display:grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:var(--fg);
  color:var(--surface-0);font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}
.ax-badge[hidden]{display:none}
.ax-newb{display:inline-flex;align-items:center;gap:7px;height:40px;padding:0 14px;border-radius:10px;background:var(--primary);
  color:var(--on-primary);font-size:13px;font-weight:650;white-space:nowrap;flex:none}
.ax-newb[hidden]{display:none}
.ax-newb:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.tl-fx{display:flex;align-items:flex-start;gap:8px 12px;margin:4px 0 6px;min-width:0}
.tl-fx[hidden]{display:none}
.tl-chips{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:1 1 auto;min-width:0}
.tl-fx-end{display:flex;align-items:center;gap:12px;flex:none;height:32px;margin-left:auto}
.tl-fn{font-size:12.5px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.ax-chip{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 6px 0 11px;border-radius:99px;border:1px solid var(--line);flex:none;
  background:var(--tile);font-size:12.5px;font-weight:550;color:var(--fg);white-space:nowrap;max-width:min(240px,100%);min-width:0}
.ax-chip .t{overflow:hidden;text-overflow:ellipsis;min-width:0}
.ax-chip .k{color:var(--muted);font-weight:500;flex:none}
.ax-chip .ag-av{margin-left:-6px;flex:none}
.ax-chip .sw,.ax-opt .sw,.ax-hb .sw{width:8px;height:8px;border-radius:3px;background:var(--c);flex:none}
.ax-chip .x{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;color:var(--muted);flex:none}
.ax-chip .x .cc-i{width:13px;height:13px}
.ax-chip:hover .x{background:var(--hover);color:var(--fg)}
.ax-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ax-clear{font-size:12.5px;font-weight:600;color:var(--fg);padding:6px 2px;white-space:nowrap}
.ax-clear:hover{text-decoration:underline;text-underline-offset:3px}
.ax-clear:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}

.tl-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px 16px;margin:6px 0 16px;min-height:28px;font-size:12.5px;color:var(--muted)}
.tl-meta b{color:var(--fg);font-weight:600;font-variant-numeric:tabular-nums}
.tl-meta .bad{display:inline-flex;align-items:center;gap:6px}
.tl-meta .bad::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--danger)}
.tl-meta .grow{flex:1}
.tl-meta small{font-size:12.5px;color:var(--muted)}
.ax-sys{font-size:12.5px;font-weight:550;color:var(--text-2);padding:4px 2px;border-radius:6px}
.ax-sys:hover{color:var(--fg);text-decoration:underline}
.ax-sys:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ax-tgl{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:550;color:var(--muted);padding:4px 2px;white-space:nowrap}
.ax-tgl i{position:relative;width:30px;height:18px;border-radius:99px;background:var(--line-strong);transition:background .16s;flex:none}
.ax-tgl i::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .16s}
.ax-tgl[aria-pressed=true]{color:var(--fg)}
.ax-tgl[aria-pressed=true] i{background:var(--fg)}
.ax-tgl[aria-pressed=true] i::after{transform:translateX(12px);background:var(--surface-1)}
.ax-tgl:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}

.tl-body{min-height:200px}
.ax-day{margin-bottom:24px}
.ax-dh{position:sticky;top:var(--ax-stick);z-index:4;display:flex;align-items:center;gap:8px;margin:0;padding:8px 0 12px;
  font-size:13px;font-weight:500;color:var(--fg);background:var(--page);background-attachment:fixed}
.ax-dh .grow{flex:1}
.ax-dh-c,.ax-dh-n{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 14px;border-radius:99px;white-space:nowrap;min-width:0;
  background:var(--surface-1);border:1px solid var(--line)}
.ax-dh-t{font-size:13.5px;font-weight:600}
.ax-dh-d{color:var(--muted);font-size:12.5px;overflow:hidden;text-overflow:ellipsis}
.ax-dh-n{color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums;gap:12px}
.ax-dh-f{display:inline-flex;align-items:center;gap:6px;color:var(--fg)}
.ax-dh-f::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--danger)}
.ax-day>.act-list{padding:8px 0;background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r14);overflow:clip}
.tl .ax-day .act{grid-template-columns:52px 32px minmax(0,1fr) auto;gap:4px 14px;align-items:start;padding:12px 20px;min-height:60px;border-top:0}
.tl .ax-day .act>*{grid-row:1}
.tl .ax-day .act::before{content:"";position:absolute;left:102px;top:0;bottom:0;border-left:1px solid var(--line)}
.tl .ax-day .act-list>.act:first-child::before{top:28px}
.tl .ax-day .act-list>.act:last-child::before{bottom:calc(100% - 28px)}
.tl .ax-day .act-list>.act:only-child::before{display:none}
.tl .ax-day .act:hover{background:var(--hover)}
.tl .ax-day .act .av{grid-column:2;position:relative;z-index:1;padding-top:0}
.tl .ax-day .act .ag-av{border-radius:30%;box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--ag) 50%,transparent),0 0 0 4px var(--surface-1)}
.tl .ax-day .act:hover .ag-av{box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--ag) 50%,transparent),0 0 0 4px color-mix(in srgb,var(--surface-1) 92%,var(--fg))}
.tl .ax-day .act>span:nth-child(3){grid-column:3;padding-top:5px}
.tl .ax-day .act-meta{grid-column:4;padding-top:6px}
.tl .act-t{grid-column:1;display:flex;flex-direction:column;gap:1px;padding-top:6px;font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.25}
.tl .act-t b{font-size:13px;font-weight:550;color:var(--fg)}
.tl .act-t small{font-size:11.5px;color:var(--text-3)}
.tl .ax-day .act-l1{font-size:14px;line-height:1.5;color:var(--text-2)}
:root .tl .ax-day .act-who,:root .tl .ax-day .act-who.go{color:var(--fg);font-weight:600}
.tl .ax-day .act-p{color:var(--text-2)}
.tl .ax-day .act-n{color:var(--fg);font-weight:550}
.tl .ax-day .act-l2{margin-top:8px;gap:6px}
.tl .ax-day .act-note{height:26px;padding:0 9px 0 7px;border-radius:7px;background:var(--tile);border:0;font-size:12px;font-weight:550;color:var(--text-2)}
.tl .ax-day .act-note:hover{background:var(--tile-h);color:var(--fg)}
.tl .ax-day .act-x{height:26px;padding:0 6px 0 9px;border-radius:7px;background:var(--tile);border:0;font-weight:550}
.tl .ax-day .act-x:hover{background:var(--tile-h)}
.tl .ax-day .act-st{font-size:12px}
.tl .ax-day .act-st.bad{color:var(--fg);font-weight:550}
.tl .ax-day .act-st .cc-dot{width:6px;height:6px}
.tl .ax-day .act-undo{height:28px;border-radius:8px;border-color:var(--line-strong);color:var(--fg);font-weight:550}
.tl .ax-day .act-undo:hover{background:var(--hover)}
.tl .ax-day .act-kids{position:relative;margin:0;border-top:0;background:color-mix(in srgb,var(--fg) 2.5%,transparent)}
.tl .ax-day .act-kids::before{content:"";position:absolute;left:102px;top:0;bottom:0;border-left:1px dashed var(--line-strong)}
.tl .ax-day .act.kid{min-height:0;padding:8px 20px;border-top:0}
.tl .ax-day .act.kid::before{display:none}
.tl .ax-day .act.kid .av{width:32px;height:20px;display:grid;place-items:center}
.tl .ax-day .act.kid .av::after{content:"";width:7px;height:7px;border-radius:50%;background:var(--surface-1);box-shadow:0 0 0 1.5px var(--line-strong)}
.tl .ax-day .act.kid .act-t{padding-top:2px}
.tl .ax-day .act.kid>span:nth-child(3){padding-top:0}
.tl .ax-day .act.kid .act-meta{padding-top:2px}
.tl-sent{margin:0 0 24px;padding:6px 0;background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r14);overflow:hidden}
.tl-sent .sk-li{padding-left:20px;padding-right:20px}
.tl-end{display:flex;align-items:center;justify-content:center;gap:12px;padding:6px 0 28px;color:var(--text-3);font-size:12.5px}
.tl-end::before,.tl-end::after{content:"";width:40px;border-top:1px solid var(--line)}
.tl-busy .ax-day{background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r14);padding:0 0 8px;overflow:hidden}
.tl-busy .ax-dh{position:static;padding:14px 20px 8px}
.tl-busy .sk-li{padding-left:20px;padding-right:20px}

.ax-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:56px 20px;text-align:center;color:var(--muted);font-size:13.5px;
  border-radius:var(--r14);background:var(--surface-1);border:1px solid var(--line)}
.ax-empty b{color:var(--fg);font-size:15px;font-weight:600}
.ax-empty .btn{margin-top:12px;height:38px;border-radius:10px}
.ax-empty-i{display:grid;place-items:center;width:44px;height:44px;margin-bottom:8px;border-radius:12px;background:var(--tile)}
.ax-empty-i .cc-i{width:20px;height:20px;color:var(--text-2)}

.sm-card{display:flex;flex-direction:column;min-width:0;background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r14)}
.sm-card-h{display:flex;align-items:center;flex-wrap:wrap;gap:2px 10px;padding:18px 22px 6px;min-height:56px}
.sm-card-h h2,.sm-card-h h3{margin:0;font-size:15px;font-weight:600;flex:1 1 auto;min-width:0;color:var(--fg)}
.sm-card-h .sub{font-size:12.5px;color:var(--muted);white-space:nowrap}
.sm-card-b{padding:8px 22px 20px;min-width:0}
.sm-lnk{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:550;color:var(--text-2);white-space:nowrap;text-decoration:none;padding:4px 0}
.sm-lnk:hover{color:var(--fg);text-decoration:underline;text-underline-offset:3px}
.sm-lnk .cc-i{width:14px;height:14px}
.sm-lnk:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
.ax-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r14);overflow:hidden}
.ax-kpi{padding:20px 22px;min-width:0;text-align:left;color:inherit}
.ax-kpi+.ax-kpi{border-left:1px solid var(--line)}
button.ax-kpi{cursor:pointer;transition:background .16s}
button.ax-kpi:hover{background:var(--hover)}
button.ax-kpi:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ax-kpi .k{font-size:12.5px;font-weight:500;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ax-kpi .v{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:30px;font-weight:400;letter-spacing:-.03em;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--fg)}
.ax-kpi .v.bad::after{content:"";width:7px;height:7px;border-radius:50%;background:var(--danger);box-shadow:0 0 0 4px var(--danger-soft)}
.ax-kpi .h{margin-top:6px;font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ax-hbs{display:flex;flex-direction:column;gap:2px}
.ax-hb{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px 12px;align-items:center;padding:9px 10px;margin:0 -10px;border-radius:8px;text-align:left}
.ax-hb:hover{background:var(--hover)}
.ax-hb:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ax-hb-l{display:flex;align-items:center;gap:9px;min-width:0;font-size:13.5px;font-weight:500}
.ax-hb-l .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ax-hb-n{font-size:13px;font-weight:550;font-variant-numeric:tabular-nums;white-space:nowrap}
.ax-hb-n em{font-style:normal;font-weight:500;color:var(--muted);margin-left:8px;display:inline-block;min-width:34px;text-align:right}
.ax-hb-track{grid-column:1/-1;height:5px;border-radius:99px;background:var(--tile);overflow:hidden}
.ax-hb-track span{display:block;height:100%;border-radius:99px;background:var(--c)}
.ax-bempty{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;padding:8px 0}
.ax-bempty.ok::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ok)}
.ax-cols{display:flex;align-items:flex-end;gap:3px;height:150px}
.ax-col{flex:1;height:100%;display:flex;align-items:flex-end;min-width:0;border-radius:3px;background:color-mix(in srgb,var(--fg) 3%,transparent)}
.ax-col i{display:flex;flex-direction:column;justify-content:flex-start;width:100%;background:var(--bar,var(--accent));border-radius:3px 3px 0 0;overflow:hidden;min-height:0}
.ax-col i b{display:block;width:100%;background:var(--danger)}
.ax-col:hover i{filter:brightness(1.12)}
.ax-ticks{display:flex;justify-content:space-between;margin-top:8px;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.ax-key{display:inline-block;width:8px;height:8px;border-radius:3px;background:var(--danger);margin-right:6px;vertical-align:0}
.sm-notes{display:flex;flex-direction:column;padding:0 22px 12px}
.ax-node{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line);text-align:left;min-width:0;width:100%}
.ax-node:first-child{border-top:0}
.ax-node>.cc-i{display:grid;flex:none;width:34px;height:34px;padding:8px;border-radius:9px;background:var(--tile);color:var(--muted)}
.ax-node:hover .t span{text-decoration:underline;text-underline-offset:3px}
.ax-node:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:8px}
.ax-node .t{flex:1;min-width:0;display:flex;flex-direction:column;font-size:14px;font-weight:500}
.ax-node .t span,.ax-node small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ax-node small{color:var(--muted);font-size:12px}
.ax-node .n{font-size:12.5px;font-weight:550;color:var(--muted);font-variant-numeric:tabular-nums}
.sm-probs{display:flex;flex-direction:column;padding:0 12px 10px}
.sm-prob{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:2px 12px;align-items:center;padding:9px 10px;border-radius:10px;text-align:left;width:100%}
.sm-prob:hover{background:var(--hover)}
.sm-prob:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.sm-prob .ag-av,.sm-prob-i{grid-row:1/span 2;border-radius:30%}
.sm-prob-i{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--danger-soft);color:var(--danger)}
.sm-prob-i .cc-i{width:15px;height:15px}
.sm-prob .s{font-size:13.5px;line-height:1.4;color:var(--fg);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-prob .s b{font-weight:600}
.sm-prob .m{grid-column:2;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px;min-width:0}
.sm-prob .m::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--danger);flex:none}
.sm-prob .n{grid-column:3;grid-row:1/span 2;font-size:12.5px;font-weight:600;color:var(--fg);font-variant-numeric:tabular-nums}

.tl-time.ui-sel{height:40px;border-radius:10px;border-color:var(--line);background:var(--surface-1);font-size:13.5px;font-weight:550;padding:0 10px 0 12px}
.tl-time.ui-sel:hover{border-color:var(--line-strong)}
.tl-time .cc-i{width:16px;height:16px;color:var(--muted)}
.tl-time .tx{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.ax-sheet .cc-drawer-b{padding:4px 20px 20px}
.ax-sysopt{margin-top:10px}
.ax-fg{padding:18px 0;border-top:1px solid var(--line)}
.ax-fg:first-child{border-top:0}
.ax-fg h3{display:flex;align-items:center;margin:0 0 12px;font-size:14px;font-weight:600;color:var(--fg)}
.ax-lnk{margin-left:auto;font-size:13px;font-weight:550;color:var(--text-2)}
.ax-lnk:hover{color:var(--fg);text-decoration:underline}
.ax-opts{display:flex;flex-wrap:wrap;gap:8px}
.ax-opt{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 13px;border-radius:99px;border:1px solid var(--line-strong);
  background:transparent;font-size:13px;font-weight:500;color:var(--fg);max-width:100%}
.ax-opt .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ax-opt .n{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.ax-opt .cc-dot{width:6px;height:6px;box-shadow:none}
.ax-opt:hover{background:var(--hover)}
.ax-opt[aria-pressed=true]{border-color:transparent;background:var(--fg);color:var(--surface-0)}
.ax-opt[aria-pressed=true] .n{color:color-mix(in srgb,var(--surface-0) 70%,transparent)}
.ax-opt:focus-visible,.ax-agopt:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ax-range{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.ax-range label{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:550;color:var(--muted)}
.ax-range input{height:40px;box-sizing:border-box;padding:0 10px;border-radius:10px;border:1px solid var(--line-strong);background:var(--surface-1);
  color:var(--fg);font:500 13px/1 inherit;color-scheme:light dark;width:100%;min-width:0}
.ax-range.on input{border-color:var(--fg)}
.ax-range input:focus{outline:none;border-color:var(--fg)}
.ax-acts{margin-top:12px}
.ax-acts summary{display:inline-flex;align-items:center;gap:7px;cursor:pointer;font-size:12.5px;font-weight:600;color:var(--muted);padding:4px 0;list-style:none}
.ax-acts summary::-webkit-details-marker{display:none}
.ax-acts summary::before{content:"";width:6px;height:6px;border-right:1.8px solid currentColor;border-bottom:1.8px solid currentColor;transform:rotate(-45deg);transition:transform .16s;margin-right:3px}
.ax-acts[open] summary::before{transform:rotate(45deg)}
.ax-acts summary .n{font-variant-numeric:tabular-nums}
.ax-acts .ax-opts{margin-top:10px}
.ax-acts .ax-opt{min-height:30px;font-size:12.5px}
.ax-agq{display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;margin-bottom:10px;border-radius:10px;border:1px solid transparent;
  background:color-mix(in srgb,var(--fg) 5%,transparent)}
.ax-agq:focus-within{border-color:var(--line-strong);background:var(--surface-1)}
.ax-agq input{flex:1;min-width:0;border:0;outline:none;background:none;color:var(--fg);font-size:13.5px}
.ax-agq .cc-i{color:var(--muted);width:15px;height:15px}
.ax-aglist{display:flex;flex-direction:column;gap:2px}
.ax-agc{font-size:12.5px;font-weight:500;color:var(--muted);padding:10px 2px 5px}
.ax-agc:first-child{padding-top:0}
.ax-agopt{display:flex;align-items:center;gap:11px;padding:7px 9px;border-radius:10px;text-align:left;min-height:48px;border:1px solid transparent}
.ax-agopt[hidden]{display:none}
.ax-agopt:hover{background:var(--hover)}
.ax-agopt .ag-av{border-radius:30%}
.ax-agopt[aria-pressed=true]{background:var(--tile);border-color:var(--line-strong)}
.ax-agopt .t{flex:1;min-width:0;display:flex;flex-direction:column}
.ax-agopt b{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ax-agopt small{font-size:11.5px;color:var(--muted)}
.ax-agopt .n{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.ax-box{display:grid;place-items:center;width:20px;height:20px;border-radius:6px;border:1.5px solid var(--line-strong);flex:none}
.ax-box .ax-ck{width:13px;height:13px;stroke-width:2.6;opacity:0;color:var(--surface-0)}
.ax-agopt[aria-pressed=true] .ax-box{background:var(--fg);border-color:var(--fg)}
.ax-agopt[aria-pressed=true] .ax-ck{opacity:1}

@container tl (max-width:820px){
  .tl-bar-in{flex-wrap:wrap;gap:8px}
  .ax-q{flex:1 1 0}
  .tl-pills{order:3;flex:1 1 100%}
  .ax-q kbd{display:none}
}
@container tl (max-width:600px){
  .tl-chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding:2px 0}
  .tl-chips::-webkit-scrollbar{display:none}
  .tl-meta .ppl,.tl-meta small{display:none}
  .tl-chips.ov{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent)}
  .tl-chips.ov.mid{-webkit-mask-image:linear-gradient(90deg,transparent,#000 20px,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,transparent,#000 20px,#000 calc(100% - 28px),transparent)}
  .tl-chips.ov.end{-webkit-mask-image:linear-gradient(90deg,transparent,#000 20px);mask-image:linear-gradient(90deg,transparent,#000 20px)}
  .tl-fx{align-items:center}
  .ax-chip{max-width:200px}
  .tl .ax-day .act{grid-template-columns:32px minmax(0,1fr) auto;gap:2px 12px;padding:12px 16px}
  .tl .ax-day .act::before,.tl .ax-day .act-kids::before{left:32px}
  .tl .ax-day .act .av{grid-column:1;grid-row:1/span 2}
  .tl .ax-day .act>span:nth-child(3){grid-column:2;grid-row:1;padding-top:4px}
  .tl .act-t{grid-column:3;grid-row:1;align-items:flex-end;padding-top:5px}
  .tl .act-t small{display:none}
  .tl .ax-day .act-meta{grid-column:2/-1;grid-row:2;flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px 12px;padding-top:2px}
  .tl .ax-day .act-meta:empty{display:none}
  .tl .ax-day .act.kid{padding:8px 16px}
  .tl .ax-day .act-l1{font-size:13.5px}
  .tl-sent .sk-li,.tl-busy .sk-li{padding-left:16px;padding-right:16px}
  .tl-busy .ax-dh{padding:12px 16px 6px}
}
@container tl (max-width:380px){
  .ax-dh-d{display:none}
  .tl-fn{display:none}
}
.tl-pills.ov{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 32px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 32px),transparent)}
.tl-pills.ov.mid{-webkit-mask-image:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 32px),transparent);mask-image:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 32px),transparent)}
.tl-pills.ov.end{-webkit-mask-image:linear-gradient(90deg,transparent,#000 24px);mask-image:linear-gradient(90deg,transparent,#000 24px)}
@media (max-width:760px){
  .tl-bar{padding:8px 0}
  .ax-q{height:44px}
  .ax-q input{font-size:16px}
  .ax-fbtn,.ax-newb{height:44px}
  .ax-newb{padding:0 12px}
  .tl .chip{height:36px}
  .ax-chip{height:34px}
  .tl-fx-end{height:34px}
  .sm-card-h{padding:14px 16px 4px}
  .sm-card-b{padding:8px 16px 16px}
  .sm-notes{padding:0 16px 8px}
  .sm-probs{padding:0 6px 8px}
  .ax-kpi{padding:16px}
  .ax-kpi .v{font-size:26px}
  .tl-time.ui-sel{height:44px}
  .ax-sheet .cc-drawer-b{padding:2px 16px 16px}
  .ax-opt{min-height:40px}
}
@media (prefers-reduced-motion:reduce){
  .ax-tgl i,.ax-tgl i::after,.tl-bar{transition:none}
}
`;

export function useTimelineStyles(): void {
  useStyles('tl-css', CSS);
}

/** A removable filter chip; `rm` is the `<facet>:<value>` it clears. */
export function chip(rm: string, label: string, lead = '', kind = ''): string {
  return `<button type="button" class="ax-chip" data-rm="${attr(rm)}" title="${attr(`${kind}${label}`)}" aria-label="${attr(
    `Remove filter: ${kind}${label}`,
  )}">${lead}${kind ? `<span class="k">${esc(kind)}</span>` : ''}<span class="t">${esc(label)}</span>${X}</button>`;
}

/** A number tile; `v` is a number or preformatted number text. `go` makes it a button (data-f filter). */
export function statTile(k: string, v: number | string, h: string, bad = false, go = ''): string {
  const inner = `<div class="k">${esc(k)}</div><div class="v${bad ? ' bad' : ''}">${v}</div><div class="h">${esc(h)}</div>`;
  return go
    ? `<button type="button" class="ax-kpi" data-f="${attr(go)}" title="${attr(`Show these in the timeline`)}">${inner}</button>`
    : `<div class="ax-kpi">${inner}</div>`;
}

function dayTitle(ts: number): { t: string; d: string } {
  const day = isoDay(ts);
  const today = isoDay(Date.now() / 1000);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yest = isoDay(y.getTime() / 1000);
  const full = dayLabel(ts);
  if (day === today) return { t: 'Today', d: full };
  if (day === yest) return { t: 'Yesterday', d: full };
  const d = new Date(ts * 1000);
  return { t: d.toLocaleDateString('en-US', { weekday: 'long' }), d: full };
}

/** "just now" / "5m ago". */
function agoText(ts: number): string {
  const a = ago(ts);
  return a === 'now' ? 'just now' : a + ' ago';
}

/** A count over events since `since`, with "+" when older events may be missing (`trimmed`). */
export function atLeast(n: number, since: number, oldest: number, trimmed: boolean): string {
  const s = n.toLocaleString('en-US');
  return trimmed && oldest > since ? s + '+' : s;
}

/** The timeline's toolbar, chips row, counts row and list, with ids prefixed by `p`. */
export function timelineHTML(p: string, q: string, placeholder: string): string {
  return `<div class="tl-bar" id="${p}Bar"><div class="tl-bar-in">
      <label class="ax-q" id="${p}QWrap">${ICO.search}<span class="sr-only">Search the timeline</span>
        <input id="${p}Q" type="search" enterkeyhint="search" placeholder="${attr(placeholder)}" autocomplete="off" spellcheck="false" value="${attr(q)}">
        <kbd aria-hidden="true">/</kbd><button type="button" class="ax-qx" id="${p}Qx" aria-label="Clear search" hidden>${ICO.x}</button></label>
      <div class="cc-pills tl-pills" id="${p}Pills" role="group" aria-label="Show">${QUICK.map(
        (x) => `<button type="button" class="chip" data-quick="${x.id}" aria-pressed="false">${x.label}</button>`,
      ).join('')}</div>
      <button type="button" class="ax-fbtn" id="${p}Filt" aria-haspopup="dialog">${ICO.filter}<span class="l">Filters</span><span class="ax-badge" id="${p}Badge" hidden></span></button>
      <button type="button" class="ax-newb" id="${p}New" hidden></button>
    </div></div>
    <div class="tl-fx" id="${p}Fx" hidden><div class="tl-chips" id="${p}Chips" role="group" aria-label="Filters in use"></div>
      <div class="tl-fx-end"><span class="tl-fn" id="${p}Fn"></span><button type="button" class="ax-clear" data-clear>Clear all</button></div></div>
    <div class="tl-meta" id="${p}Sum" aria-live="polite"></div>
    <div class="tl-body" id="${p}Body"></div>`;
}

interface TimelineHandlers {
  query(q: string): void;
  quick(id: Quick): void;
  filters(): void;
  remove(spec: string): void;
  clear(): void;
  compact(): void;
  system?(): void;
  /** A summary or empty-state control: `<facet>:<value>`, or `time:all` / `clear`. */
  pick?(spec: string): void;
}

/** Wire the search, pills, Filters, chips and counts of a timeline inside `root`. */
export function wireTimeline(root: HTMLElement, p: string, h: TimelineHandlers): void {
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => root.querySelector<T>('#' + p + id)!;
  const q = $<HTMLInputElement>('Q');
  const qx = $('Qx');
  const sync = (): void => {
    qx.hidden = !q.value;
    $('QWrap').classList.toggle('has', !!q.value);
  };
  sync();
  const apply = debounce(() => h.query(q.value.trim()), 140);
  q.oninput = () => {
    sync();
    apply();
  };
  q.onkeydown = (e) => {
    if (e.key === 'Escape' && q.value) {
      e.stopPropagation();
      q.value = '';
      sync();
      h.query('');
    }
  };
  qx.onclick = () => {
    q.value = '';
    sync();
    h.query('');
    q.focus();
  };
  $('Filt').onclick = () => h.filters();
  $('Pills').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-quick]');
    if (b) h.quick(b.dataset.quick as Quick);
  };
  $('Fx').onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-clear]')) {
      q.value = '';
      sync();
      return h.clear();
    }
    const rm = t.closest<HTMLElement>('[data-rm]');
    if (rm) h.remove(rm.dataset.rm!);
  };
  const chips = $('Chips');
  const pills = $('Pills');
  chips.addEventListener('scroll', () => fadeRow(chips), { passive: true });
  pills.addEventListener('scroll', () => fadeRow(pills), { passive: true });
  new ResizeObserver(() => {
    fadeRow(pills);
    fadeRow(chips);
  }).observe(pills);
  $('Sum').onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-sys]')) h.system?.();
    else if (t.closest('[data-compact]')) h.compact();
  };
}

/** The chips row: hidden when nothing is set; the count says how many filters are in use. */
export function paintChips(root: HTMLElement, p: string, chips: string[], n: number): void {
  const fx = root.querySelector<HTMLElement>('#' + p + 'Fx');
  const box = root.querySelector<HTMLElement>('#' + p + 'Chips');
  if (!fx || !box) return;
  fx.hidden = !chips.length;
  box.innerHTML = chips.join('');
  root.querySelector<HTMLElement>('#' + p + 'Fn')!.textContent = chips.length > 1 ? plural(chips.length, 'filter') : '';
  const badge = root.querySelector<HTMLElement>('#' + p + 'Badge')!;
  badge.hidden = !n;
  badge.textContent = String(n);
  root.querySelector<HTMLElement>('#' + p + 'Filt')!.setAttribute('aria-label', n ? `Filters, ${n} in use` : 'Filters');
  requestAnimationFrame(() => fadeRow(box));
}

/** Fade a sideways scrolling row at the edges it can scroll to. */
function fadeRow(el: HTMLElement): void {
  const ov = el.scrollWidth > el.clientWidth + 2;
  el.classList.toggle('ov', ov);
  el.classList.toggle('mid', ov && el.scrollLeft > 4 && el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  el.classList.toggle('end', ov && el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
}

export function paintPills(root: HTMLElement, p: string, quick: Quick | null): void {
  root.querySelectorAll<HTMLElement>(`#${p}Pills [data-quick]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.quick === quick)));
}

/** The counts row under the chips. */
export function sumHTML(o: { n: string; unit: [string, string]; fails: number; extra?: string; hidden?: number; compact: boolean; note?: string }): string {
  return `<span><b>${o.n}</b> ${o.n === '1' ? o.unit[0] : o.unit[1]}${o.note ? ` <small>· ${esc(o.note)}</small>` : ''}</span>${o.extra || ''}${
    o.fails ? `<span class="bad"><b>${o.fails}</b> ${o.fails === 1 ? 'problem' : 'problems'}</span>` : ''
  }<span class="grow"></span>${
    o.hidden ? `<button type="button" class="ax-sys" data-sys title="Server, sign-in and note-saving lines">${plural(o.hidden, 'system line')} hidden · Show</button>` : ''
  }<button type="button" class="ax-tgl" data-compact aria-pressed="${o.compact}" title="Show similar actions in a row as one line"><i></i>Group similar</button>`;
}

/** Sticks the toolbar `top` px from the scroller's top and the day labels under it; returns the on-scroll handler. */
export function stickTimeline(root: HTMLElement, p: string, scroller: HTMLElement, top: () => number): () => void {
  const bar = root.querySelector<HTMLElement>('#' + p + 'Bar')!;
  const tl = bar.closest<HTMLElement>('.tl')!;
  const set = (): void => {
    const pt = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    const t = top() - pt;
    tl.style.setProperty('--tl-top', t + 'px');
    tl.style.setProperty('--tl-cover', Math.max(0, -t) + 'px');
    tl.style.setProperty('--ax-stick', t + bar.offsetHeight + 'px');
  };
  set();
  const ro = new ResizeObserver(set);
  ro.observe(bar);
  ro.observe(scroller);
  return () => {
    if (!bar.isConnected) return ro.disconnect();
    const st = bar.getBoundingClientRect().top <= scroller.getBoundingClientRect().top + top() + 1 && scroller.scrollTop > 0;
    bar.classList.toggle('stuck', st);
  };
}

/** The time range select: the presets, and custom dates (picked in the Filters sheet). */
export function timeSelect(cur: () => { time: TimeKey; from: string; to: string }, pick: (v: TimeKey | 'custom') => void): Select {
  const opts = (): SelectOption[] => {
    const t = cur();
    return [
      ...TIMES.map((x) => ({ value: x.id, label: x.label })),
      { value: 'custom', label: t.time === 'custom' ? labelOf(t) : 'Custom dates…', hint: 'Pick a start and an end day' },
    ];
  };
  const s = createSelect({
    options: opts(),
    value: cur().time,
    label: 'Time range',
    className: 'tl-time',
    align: 'end',
    minWidth: 220,
    render: (o) => `${CLOCK}<span class="tx">${esc(o?.label || '')}</span><svg class="ui-sel-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>`,
    onChange: (v) => pick(v as TimeKey | 'custom'),
  });
  const refresh = (): void => s.setOptions(opts(), cur().time);
  (s as Select & { refresh: () => void }).refresh = refresh;
  return s;
}

/** Bring a time select in line with the current selection. */
export function refreshTime(s: Select | null): void {
  (s as (Select & { refresh?: () => void }) | null)?.refresh?.();
}

interface DayCtx {
  /** Filtered events, newest first. */
  rows: ActivityItem[];
  fresh: Set<string>;
  /** Groups rendered so far. */
  limit: number;
  /** Group similar calls by the same AI into one row. */
  compact: boolean;
  /** Bursts shown expanded, by the id of their newest call. */
  open: Set<string>;
  /** The server may hold older events than the ones loaded. */
  older: boolean;
  /** Any filter or search narrows the list. */
  narrowed: boolean;
  /** Nothing at all is loaded (any filter, this range). */
  none: boolean;
  /** Empty-state wording. */
  what?: string;
}

/** Skeleton of one number tile. */
export function kpiSkeleton(): string {
  return `<div class="ax-kpi">${skBlock('46%', 10)}<div style="height:12px"></div>${skBlock('38%', 26)}<div style="height:10px"></div>${skBlock('64%', 9)}</div>`;
}

/** Skeleton lines inside a summary card. */
export function skLines(n: number): string {
  return `<div style="display:flex;flex-direction:column;gap:14px">${Array.from({ length: n }, (_, i) => skBlock(70 - i * 9 + '%', 12)).join('')}</div>`;
}

/** The skeleton of the list while it loads. */
export function daySkeleton(): string {
  return `<div class="tl-busy">${[6, 4]
    .map(
      (n) =>
        `<section class="ax-day" aria-hidden="true"><div class="ax-dh">${skBlock('90px', 12)}<span class="grow"></span>${skBlock('60px', 10)}</div>${rowsSkeleton(n)}</section>`,
    )
    .join('')}</div>`;
}

/** Rows that stand where more will load (the list's end, while there is more). */
function sentinelHTML(): string {
  return `<div class="tl-sent" data-sentinel aria-busy="true" aria-label="Loading more activity">${rowsSkeleton(3)}</div>`;
}

function emptyHTML(c: DayCtx): string {
  if (c.none)
    return `<div class="ax-empty"><span class="ax-empty-i">${CLOCK}</span><b>No activity in this time range</b>
      <span>${esc(c.what || 'What your AIs read, write and search shows up here as it happens.')}</span>
      <button type="button" class="btn" data-pick="time:all">Show all time</button></div>`;
  return `<div class="ax-empty"><span class="ax-empty-i">${ICO.filter}</span><b>Nothing matches</b>
    <span>${c.narrowed ? 'Try other words or remove a filter.' : 'Try a wider time range.'}</span>
    ${c.narrowed ? '<button type="button" class="btn" data-pick="clear">Clear search and filters</button>' : ''}</div>`;
}

/** A timeline row: the clock moves out of the meta column into its own column before the avatar. */
function railRow(html: string): string {
  return html.replace(
    /(<div class="act[^"]*"[^>]*>)(\s*<span class="av">[\s\S]*?)<span class="act-meta"><span title="([^"]*)">([^<]*?)(?: · ([^<]*))?<\/span>/g,
    (_m, open: string, mid: string, title: string, clk: string, rel?: string) =>
      `${open}<span class="act-t" title="${title}"><b>${clk}</b>${rel ? `<small>${rel === 'now' ? 'just now' : rel === '-' ? '' : esc(rel) + ' ago'}</small>` : ''}</span>${mid}<span class="act-meta">`,
  );
}

export function dayViewHTML(c: DayCtx): string {
  // Nothing yet in a window the loaded events do not reach: keep loading.
  if (!c.rows.length) return c.older && !c.narrowed ? sentinelHTML() : emptyHTML(c);
  // Per day totals over every filtered row, so a header is exact even when only part of the day is rendered.
  const perDay = new Map<string, { n: number; f: number }>();
  for (const x of c.rows) {
    const k = isoDay(x.ts);
    const s = perDay.get(k) || { n: 0, f: 0 };
    s.n++;
    if (stOf(x) === 'fail') s.f++;
    perDay.set(k, s);
  }
  const groups = groupBursts(c.rows, c.compact);
  const cap = groups.slice(0, c.limit);
  let html = '';
  let cur = '';
  for (const b of cap) {
    const k = isoDay(b.it.ts);
    if (k !== cur) {
      if (cur) html += '</div></section>';
      cur = k;
      const t = dayTitle(b.it.ts);
      const s = perDay.get(k)!;
      html += `<section class="ax-day" data-day="${k}" aria-label="${attr(t.t)}"><h3 class="ax-dh"><span class="ax-dh-c"><span class="ax-dh-t">${esc(
        t.t,
      )}</span><span class="ax-dh-d">${esc(t.d)}</span></span><span class="grow"></span><span class="ax-dh-n">${plural(s.n, 'action')}${
        s.f ? `<span class="ax-dh-f">${plural(s.f, 'problem')}</span>` : ''
      }</span></h3><div class="act-list">`;
    }
    html += railRow(actRowHTML(b.it, { fresh: c.fresh.has(b.it.id), burst: b, open: c.open.has(b.it.id), undo: b.items.length === 1 && canUndo(b.it) }));
  }
  if (cur) html += '</div></section>';
  if (groups.length > cap.length || c.older) html += sentinelHTML();
  else html += `<div class="tl-end">That’s everything</div>`;
  return html;
}

const sentinels = new WeakMap<HTMLElement, IntersectionObserver>();

/** Call `more` when the list's end comes near; it is watched again after every paint. */
export function watchSentinel(body: HTMLElement, scroller: HTMLElement, more: () => void): void {
  sentinels.get(body)?.disconnect();
  const s = body.querySelector<HTMLElement>('[data-sentinel]');
  if (!s || typeof IntersectionObserver === 'undefined') return;
  const io = new IntersectionObserver(
    (en) => {
      if (!en.some((x) => x.isIntersecting)) return;
      io.disconnect();
      more();
    },
    { root: scroller, rootMargin: '0px 0px 600px 0px' },
  );
  sentinels.set(body, io);
  io.observe(s);
}

export function unwatchSentinel(body: HTMLElement | null): void {
  if (body) sentinels.get(body)?.disconnect();
}

export function bars(items: { label: string; n: number; color: string; lead?: string; f: string }[], total: number, empty = 'Nothing in this range'): string {
  if (!items.length) return `<div class="ax-bempty">${esc(empty)}</div>`;
  const max = Math.max(1, ...items.map((x) => x.n));
  return `<div class="ax-hbs">${items
    .map(
      (x) => `<button type="button" class="ax-hb" data-f="${attr(x.f)}" style="--c:${x.color}" title="${attr(`Show only: ${x.label}`)}">
        <span class="ax-hb-l">${x.lead || `<i class="sw"></i>`}<span class="t">${esc(x.label)}</span></span>
        <span class="ax-hb-n">${x.n}<em>${total ? Math.round((x.n / total) * 100) : 0}%</em></span>
        <span class="ax-hb-track"><span style="width:${Math.max(2, (x.n / max) * 100)}%"></span></span></button>`,
    )
    .join('')}</div>`;
}

/** The actions done most, as bars that filter the timeline. */
export function topActionsHTML(rows: ActivityItem[], n = 6): string {
  const acts = new Map<string, ActivityItem[]>();
  rows.forEach((x) => (acts.get(x.action) || acts.set(x.action, []).get(x.action)!).push(x));
  const top = [...acts.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, n);
  return bars(
    top.map(([a, xs]) => ({ label: actionLabel(a, xs[0].source), n: xs.length, color: CAT_COLOR[catOf(xs[0])], f: 'actions:' + a })),
    rows.length,
  );
}

/** Calls per hour (two days or less) or per day, problems stacked on top. */
export function timeChart(rows: ActivityItem[], w: { since: number; until: number }): string {
  if (!rows.length) return '<div class="ax-bempty">Nothing in this range</div>';
  const now = Date.now() / 1000;
  const until = Number.isFinite(w.until) ? Math.min(w.until, now) : now;
  const since = w.since > 0 ? w.since : Math.min(...rows.map((r) => r.ts));
  const span = until - since;
  const hourly = span <= 2 * 86400;
  const step = hourly ? 3600 : 86400;
  const start = new Date(since * 1000);
  if (hourly) start.setMinutes(0, 0, 0);
  else start.setHours(0, 0, 0, 0);
  const s0 = start.getTime() / 1000;
  const n = Math.min(hourly ? 48 : 62, Math.max(1, Math.ceil((until - s0) / step)));
  const first = until - n * step < s0 ? s0 : s0 + (Math.ceil((until - s0) / step) - n) * step;
  const b = new Array(n).fill(0);
  const fb = new Array(n).fill(0);
  rows.forEach((r) => {
    const i = Math.floor((r.ts - first) / step);
    if (i >= 0 && i < n) {
      b[i]++;
      if (stOf(r) === 'fail') fb[i]++;
    }
  });
  const max = Math.max(1, ...b);
  const lbl = (i: number): string => {
    const d = new Date((first + i * step) * 1000);
    return hourly ? d.toLocaleTimeString('en-US', { hour: 'numeric' }) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  return `<div class="ax-cols" role="img" aria-label="Actions per ${hourly ? 'hour' : 'day'}">${b
    .map(
      (v, i) =>
        `<span class="ax-col" title="${attr(`${lbl(i)}: ${plural(v, 'action')}${fb[i] ? `, ${plural(fb[i], 'problem')}` : ''}`)}"><i style="height:${
          v ? Math.max(4, (v / max) * 100) : 0
        }%"><b style="height:${v ? (fb[i] / v) * 100 : 0}%"></b></i></span>`,
    )
    .join('')}</div><div class="ax-ticks">${ticks.map((i) => `<span>${esc(lbl(i))}</span>`).join('')}</div>`;
}

/** "Actions per hour" or "per day", as the chart buckets them. */
export function chartTitle(rows: ActivityItem[], w: { since: number; until: number }): string {
  const now = Date.now() / 1000;
  const until = Number.isFinite(w.until) ? Math.min(w.until, now) : now;
  const since = w.since > 0 ? w.since : rows.length ? rows[rows.length - 1].ts : now;
  return until - since <= 2 * 86400 ? 'Actions per hour' : 'Actions per day';
}

/** The notes touched most, each opening the note. */
export function notesHTML(rows: ActivityItem[], n = 6, empty = 'No notes were touched in this range'): string {
  const m = new Map<string, number>();
  rows.forEach((x) => x.paths.forEach((p) => m.set(p, (m.get(p) || 0) + 1)));
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  if (!top.length) return `<div class="sm-card-b"><div class="ax-bempty">${esc(empty)}</div></div>`;
  return `<div class="sm-notes">${top
    .map(([p, k]) => {
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : 'Top level';
      return `<button type="button" class="ax-node" data-note="${attr(p)}" title="${attr(`Open ${p}`)}">${ICO.note}<span class="t"><span>${esc(
        noteName(p),
      )}</span><small>${esc(dir)}</small></span><span class="n">${k}×</span></button>`;
    })
    .join('')}</div>`;
}

export function touchedCount(rows: ActivityItem[]): { n: number; top: string } {
  const m = new Map<string, number>();
  rows.forEach((x) => x.paths.forEach((p) => m.set(p, (m.get(p) || 0) + 1)));
  const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  return { n: m.size, top: top ? noteName(top[0]) : '' };
}

/** Problems grouped by who and what; a row filters the timeline to that agent's problems. */
export function problemsHTML(rows: ActivityItem[], n = 4, withWho = true): string {
  const g = new Map<string, ActivityItem[]>();
  for (const x of rows) {
    const p = problemOf(x);
    if (!p) continue;
    const k = x.actor + '\u0000' + x.action + '\u0000' + p;
    (g.get(k) || g.set(k, []).get(k)!).push(x);
  }
  if (!g.size) return `<div class="sm-card-b"><div class="ax-bempty ok">No problems in this range</div></div>`;
  const top = [...g.values()].sort((a, b) => b.length - a.length || b[0].ts - a[0].ts).slice(0, n);
  return `<div class="sm-probs">${top
    .map((xs) => {
      const it = xs[0];
      const kid = typeof it.raw.actor_id === 'string' ? it.raw.actor_id : null;
      const said = plainText(predicate(it));
      const kind = problemOf(it) === 'refused' ? 'Refused' : 'Did not work';
      const lead = withWho ? avatarHTML(it.actor, 30, '', kid) : `<span class="sm-prob-i">${CAT_ICON[catOf(it)] || ICO.x}</span>`;
      return `<button type="button" class="sm-prob" data-prob="${attr(it.actor)}" title="${attr(withWho ? `Show ${it.actor}'s problems in the timeline` : 'Show its problems in the timeline')}">${lead}<span class="s">${withWho ? `<b>${esc(it.actor)}</b> ` : ''}${esc(withWho ? said : said.charAt(0).toUpperCase() + said.slice(1))}</span><span class="m">${kind} · ${esc(
        agoText(it.ts),
      )}</span><span class="n">${xs.length > 1 ? xs.length + '×' : ''}</span></button>`;
    })
    .join('')}</div>`;
}

/** Bars of an agent's activity over the selected window (the per-agent rows). */
function sparkBars(rows: ActivityItem[], w: { since: number; until: number }, n = 20): string {
  const now = Date.now() / 1000;
  const until = Number.isFinite(w.until) ? Math.min(w.until, now) : now;
  const since = w.since > 0 ? w.since : rows.length ? Math.min(...rows.map((r) => r.ts)) : until - 86400;
  const span = Math.max(60, until - since);
  const b = new Array(n).fill(0);
  rows.forEach((r) => {
    const i = Math.min(n - 1, Math.max(0, Math.floor(((r.ts - since) / span) * n)));
    b[i]++;
  });
  const max = Math.max(1, ...b);
  return `<span class="sm-spark" aria-hidden="true">${b
    .map((v) => `<i style="height:${v ? Math.max(14, Math.round((v / max) * 100)) : 8}%"${v ? '' : ' class="z"'}></i>`)
    .join('')}</span>`;
}

/** A status as a dot and one word. */
function statusWord(a: AgentInfo): { cls: string; word: string } {
  if (a.disabled) return { cls: 'off', word: 'Turned off' };
  if (a.cls === 'active') return { cls: 'active', word: 'Active' };
  if (a.cls === 'recent') return { cls: 'recent', word: 'Recent' };
  if (a.cls === 'removed') return { cls: 'removed', word: 'Removed' };
  if (a.cls === 'people') return { cls: 'people', word: /^(gateway|system|memora|memora-cli)$/i.test(a.name) ? 'Server' : 'Person' };
  return { cls: 'idle', word: 'Idle' };
}

/** The last thing an agent did, as a short sentence. */
function lastLine(a: AgentInfo): string {
  if (a.last) {
    const said = plainText(predicate(a.last));
    return said.charAt(0).toUpperCase() + said.slice(1);
  }
  return a.lastTs ? 'Nothing in this range' : 'No activity yet';
}

/** One row per agent; a connected agent opens its own page, the others filter the timeline. */
export function agentRowsHTML(agents: AgentInfo[], rowsOf: (a: AgentInfo) => ActivityItem[], w: { since: number; until: number }, cap: number): string {
  if (!agents.length) return `<div class="sm-card-b"><div class="ax-bempty">No agents yet</div></div>`;
  const head = `<div class="sm-ag sm-ag-h" aria-hidden="true"><span></span><span>Agent</span><span>Last action</span><span class="r">Actions</span><span class="r">Problems</span><span>Over time</span><span></span></div>`;
  let html = '';
  let group = '';
  agents.slice(0, cap).forEach((a) => {
    const g = a.cls === 'removed' ? 'removed' : a.cls === 'people' ? 'people' : '';
    if (g && g !== group) html += `<div class="sm-ag-g">${esc(CLASSES.find((c) => c.id === a.cls)!.label)}</div>`;
    group = g;
    const rows = rowsOf(a);
    const st = statusWord(a);
    const open = !!a.id && a.cls !== 'removed' && a.cls !== 'people';
    const when = a.last ? agoText(a.last.ts) : a.lastTs ? agoText(a.lastTs) : '';
    const tag = open
      ? `<a class="sm-ag${rows.length ? '' : ' dim'}" href="/agents/${attr(encodeURIComponent(a.id!))}/activity" data-kid="${attr(a.id!)}"`
      : `<button type="button" class="sm-ag${rows.length ? '' : ' dim'}" data-only="${attr(a.name)}"`;
    html += `${tag} style="--ag:${agentColor(a.name, a.id)}" aria-label="${attr(
      `${a.name}, ${st.word}: ${plural(rows.length, 'action')}. ${open ? 'Open its activity' : 'Show only its activity below'}`,
    )}">
      <span class="sm-ag-av">${avatarHTML(a.name, 36, a.cls === 'active' ? 'live' : '', a.id)}</span>
      <span class="sm-ag-id"><b>${esc(a.name)}</b><span class="sm-st ${st.cls}">${esc(st.word)}${a.fails ? `<em>${plural(a.fails, 'problem')}</em>` : ''}</span></span>
      <span class="sm-ag-last"><span class="t">${esc(lastLine(a))}</span><small>${esc(when)}</small></span>
      <span class="sm-ag-n r${rows.length ? '' : ' z'}">${rows.length}</span>
      <span class="sm-ag-f r${a.fails ? ' bad' : ' z'}">${a.fails}</span>
      <span class="sm-ag-sp">${rows.length ? sparkBars(rows, w) : ''}</span>
      <span class="sm-ag-go" title="${open ? 'Open its activity' : 'Show only its activity'}">${open ? CHEV_R : ICO.filter}</span>
    ${open ? '</a>' : '</button>'}`;
  });
  return `<div class="sm-ags" role="list">${head}${html}</div>`;
}

/** Download events as JSON or CSV (the Activity page and an agent's tab). */
export function exportRows(rs: ActivityItem[], kind: 'json' | 'csv', who?: string): void {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const stem = `memora-activity${who ? '-' + who.replace(/[^A-Za-z0-9_-]+/g, '_') : ''}-${stamp}`;
  if (kind === 'json') {
    download(
      `${stem}.json`,
      JSON.stringify(
        rs.map((x) => ({
          time: new Date(x.ts * 1000).toISOString(),
          actor: x.actor,
          action: x.action,
          label: x.label,
          paths: x.paths,
          ok: x.ok,
          ms: x.ms,
          source: x.source,
          ip: x.ip,
        })),
        null,
        2,
      ),
    );
  } else {
    const cell = (v: unknown): string => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = ['time,actor,action,label,paths,status,ms,source,ip'];
    rs.forEach((x) =>
      lines.push(
        [
          new Date(x.ts * 1000).toISOString(),
          x.actor,
          x.action,
          x.label,
          x.paths.join(' '),
          x.running ? 'running' : x.ok === false ? 'failed' : 'ok',
          x.ms ?? '',
          x.source,
          x.ip || '',
        ]
          .map(cell)
          .join(','),
      ),
    );
    download(`${stem}.csv`, lines.join('\n'), 'text/csv');
  }
  toast(`Exported ${plural(rs.length, 'event')}`, 'ok');
}
