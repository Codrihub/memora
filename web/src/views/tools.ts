// Tools: the server-wide switch per MCP tool (docs/contracts/tools-permissions.md). Switches are optimistic and
// roll back with a toast when the server refuses.

import { fetchTools, setToolEnabled } from '../api';
import { $, $$, attr, esc, useStyles } from '../dom';
import { toast } from '../toast';
import { Modal } from '../modal';
import { ICO, openMenu, systemHeader, useControlStyles } from '../control/ui';
import { skBlock } from '../ui/skeleton';
import { icon } from '../ui/icons';
import type { ToolInfo } from '../types';

/** Category names and one plain line each, in the order people think of them. */
const CATEGORIES: Record<string, { label: string; desc: string }> = {
  note: { label: 'Notes', desc: 'Read, create, edit, move and delete single notes.' },
  search: { label: 'Search', desc: 'Find notes by words and count what is in your notes.' },
  tag: { label: 'Tags', desc: 'See every tag and add or remove tags on a note.' },
  folder: { label: 'Folders', desc: 'List folders and create new ones.' },
  graph: { label: 'Links and graph', desc: 'Follow links between notes: neighbours, paths, hubs and loose ends.' },
  query: { label: 'Queries and tag upkeep', desc: 'Filter notes by their properties, find similar notes, rename or merge tags.' },
  version: { label: 'History', desc: 'Older versions of a note: read, compare, restore, and the trash.' },
  write: { label: 'Bulk writing', desc: 'Create, copy, merge, replace or delete many notes in one call.' },
  collab: { label: 'Working together', desc: 'Locks, mentions and assignments so agents do not overwrite each other.' },
  ops: { label: 'Activity and upkeep', desc: 'Activity logs, health checks, stale notes, folder settings and folder moves.' },
  identity: { label: 'Identity', desc: 'How the agent itself shows up: its display name and colour.' },
  interop: { label: 'Import and export', desc: 'Bring notes in or take them out as a zip of text files.' },
  ux: { label: 'Tasks, checks and pins', desc: 'To-dos, follow-ups, checks that a note is well formed, and the pinned notes and folders.' },
};
const CAT_ORDER = Object.keys(CATEGORIES);

type ToolRisk = 'read' | 'write' | 'admin';

const RISKS: Record<ToolRisk, { label: string; desc: string }> = {
  read: { label: 'Reads', desc: 'Only looks at notes; changes nothing.' },
  write: { label: 'Changes', desc: 'Creates, edits, moves or renames notes, tags or folders.' },
  admin: { label: 'Can delete', desc: 'Can remove notes or folders, or overwrite text in many notes at once.' },
};

/** The "Can delete" tier: tools that remove notes or folders, or can overwrite text in many notes. */
const HIGH = new Set(['delete_memory', 'soft_delete', 'bulk_delete', 'bulk_replace', 'import_memory', 'delete_folder', 'move_folder_contents']);
const READ_RE =
  /^(get|list|read|search|find|query|export)_|^(link_stats|broken_links|diff|presence|healthcheck|folder_stats|stale_detection|validate_memory|follow_ups|suggest_links|digest)$/;

/** What a tool can do to the vault, from its name. */
export function toolRisk(t: { name: string }): ToolRisk {
  if (HIGH.has(t.name) || /(^|_)(delete|purge|drop|wipe)(_|$)|^bulk_/.test(t.name)) return 'admin';
  if (READ_RE.test(t.name)) return 'read';
  return 'write';
}

/** "read_memory" -> "Read note": a memory is a note everywhere people read it. */
export function toolTitle(name: string): string {
  const s = name
    .replace(/[_-]+/g, ' ')
    .replace(/\bmemory\b/g, 'note')
    .trim();
  return s ? s[0].toUpperCase() + s.slice(1) : name;
}

/** Tools grouped by category (known categories first, in reading order), tools by name. */
export function groupTools(tools: ToolInfo[]): [string, ToolInfo[]][] {
  const by = new Map<string, ToolInfo[]>();
  for (const t of tools) {
    const c = t.category || 'other';
    if (!by.has(c)) by.set(c, []);
    by.get(c)!.push(t);
  }
  const rank = (c: string): number => {
    const i = CAT_ORDER.indexOf(c);
    return i < 0 ? CAT_ORDER.length : i;
  };
  return [...by.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([c, list]) => [c, list.sort((a, b) => a.name.localeCompare(b.name))]);
}

/** Case insensitive match on name, title, description and category. */
export function toolMatches(t: ToolInfo, q: string): boolean {
  if (!q) return true;
  return (t.name + ' ' + toolTitle(t.name) + ' ' + t.description + ' ' + t.category + ' ' + categoryLabel(t.category))
    .toLowerCase()
    .includes(q);
}

/** "notes_admin" -> "Notes admin"; known categories get their plain name. */
export function categoryLabel(c: string): string {
  if (CATEGORIES[c]) return CATEGORIES[c].label;
  const s = c.replace(/[_-]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Other';
}

export function categoryDesc(c: string): string {
  return CATEGORIES[c]?.desc || '';
}

export function riskChip(r: ToolRisk): string {
  return `<span class="tl-risk ${r}" title="${attr(RISKS[r].desc)}">${esc(RISKS[r].label)}</span>`;
}

/** Shared by the Tools page and the permissions editor: risk as a small dot and a word. */
export const TOOL_ROW_CSS = `
.tl-risk{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:550;white-space:nowrap;color:var(--text-2)}
.tl-risk::before{content:"";width:7px;height:7px;border-radius:50%;flex:none;background:var(--text-3)}
.tl-risk.read::before{background:var(--ok)}
.tl-risk.write::before{background:var(--accent)}
.tl-risk.admin::before{background:var(--warn)}
.tl-code{font-family:var(--mono);font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
`;

let tools: ToolInfo[] = [];
let query = '';
let show: 'all' | 'on' | 'off' = 'all';
const collapsed = new Set<string>();
const pending = new Set<string>();
/** Bumped per renderTools(); a slower, older tool list is dropped. */
let loadSeq = 0;

/** A quiet outline icon per category, for the leading tile of each row. */
const CAT_ICON: Record<string, string> = {
  note: 'note',
  search: 'search',
  tag: 'tags',
  folder: 'folder',
  graph: 'graph',
  query: 'command',
  version: 'refresh',
  write: 'canvas',
  collab: 'agents',
  ops: 'activity',
  identity: 'user',
  interop: 'download',
  ux: 'check',
};
const catIcon = (c: string): string => icon(CAT_ICON[c] || 'tools');

/** Segments in the "switched on" meter. */
const TICKS = 28;

/** Shared look of the system pages (Tools, Access rules, Settings): roomy frame, calm header. */
export const SYS_PAGE_CSS = `
:is(#view-tools,#view-access,#view-settings){padding:32px 32px 72px}
:is(#view-tools,#view-access,#view-settings) .sys-head{margin:0 0 24px;align-items:flex-end}
:is(#view-tools,#view-access,#view-settings) .sys-head h1{font-size:26px;font-weight:650;letter-spacing:-.02em;line-height:1.2}
:is(#view-tools,#view-access,#view-settings) .sys-head p{margin-top:6px;font-size:14px;color:var(--muted)}
:is(#view-tools,#view-access,#view-settings) .sys-acts .btn{height:38px;border-radius:10px;padding:0 16px}
:is(#view-tools,#view-access,#view-settings) .sys-acts .cc-ibtn{width:38px;height:38px;border-radius:10px;border:1px solid var(--line-strong);color:var(--text-2)}
:is(#view-tools,#view-access,#view-settings) .sys-acts .cc-ibtn:hover{background:var(--hover);color:var(--fg)}
@media (max-width:1100px){:is(#view-tools,#view-access,#view-settings){padding:24px 24px 64px}}
@media (max-width:760px){
  :is(#view-tools,#view-access,#view-settings){padding:16px 16px 32px}
  :is(#view-tools,#view-access,#view-settings) .sys-head{margin-bottom:18px;align-items:start}
  :is(#view-tools,#view-access,#view-settings) .sys-head h1{font-size:22px}
  :is(#view-tools,#view-access,#view-settings) .sys-head p{font-size:13.5px}
  :is(#view-tools,#view-access,#view-settings) .sys-acts .btn{height:44px}
  :is(#view-tools,#view-access,#view-settings) .sys-acts .cc-ibtn{width:44px;height:44px}
}
:is(#view-tools,#view-access,#view-settings) .cc-sw{background:color-mix(in srgb,var(--fg) 10%,transparent);border-color:transparent}
:is(#view-tools,#view-access,#view-settings) .cc-sw i{background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.18)}
:is(#view-tools,#view-access,#view-settings) .cc-sw[aria-checked=true]{background:var(--brand-mark,var(--accent));border-color:transparent}
:is(#view-tools,#view-access,#view-settings) .cc-sw[aria-checked=true] i{background:#fff}
:is(#view-tools,#view-access,#view-settings) .cc-sw[aria-checked=mixed]{background:color-mix(in srgb,var(--accent) 45%,color-mix(in srgb,var(--fg) 10%,transparent));border-color:transparent}
:is(#view-tools,#view-access,#view-settings) .cc-sw[aria-checked=mixed] i{background:#fff}
`;

const TL_CSS = `
.tl3{max-width:1240px;container:tl/inline-size}
.tl3-sum{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;margin:0 0 24px;border:1px solid var(--line);border-radius:14px;background:var(--surface-1)}
.tl3-k{padding:20px 24px 18px;min-width:0}
.tl3-k+.tl3-k{border-left:1px solid var(--line)}
.tl3-k .lb{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted);white-space:nowrap}
.tl3-k .lb.tl-risk{font-weight:400;color:var(--muted)}
.tl3-k .v{margin-top:6px;font-size:30px;font-weight:450;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--fg)}
.tl3-k .v small{font-size:15px;font-weight:450;color:var(--muted);letter-spacing:0;margin-left:3px}
.tl3-k .h{margin-top:4px;font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tl3-meter{display:flex;gap:3px;margin-top:14px;height:12px}
.tl3-meter i{flex:1;border-radius:3px;background:color-mix(in srgb,var(--fg) 8%,transparent)}
.tl3-meter i.on{background:var(--brand-mark,var(--accent))}
.tl3-why{grid-column:1/-1;display:flex;gap:12px 32px;flex-wrap:wrap;padding:14px 24px;border-top:1px solid var(--line);
  background:color-mix(in srgb,var(--fg) 2%,transparent);border-radius:0 0 14px 14px}
.tl3-why>span{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);min-width:0}
.tl3-why>span>span{min-width:0}
.tl3-why b{font-weight:550;color:var(--fg)}
.tl3-why .cc-i{width:16px;height:16px;color:var(--text-3)}

.tl3-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 16px;position:sticky;top:-32px;z-index:3;padding:12px 0;background:var(--surface-0)}
.tl3-q{display:flex;align-items:center;gap:9px;flex:1 1 260px;max-width:400px;height:40px;padding:0 12px;border-radius:10px;
  background:color-mix(in srgb,var(--fg) 5%,transparent);border:1px solid transparent;transition:border-color .16s,background .16s}
.tl3-q:hover{border-color:var(--line)}
.tl3-q:focus-within{border-color:var(--line-strong);background:var(--surface-1)}
.tl3-q .cc-i{width:16px;height:16px;color:var(--muted)}
.tl3-q input{flex:1;min-width:0;height:100%;border:0;outline:none;background:none;font-size:14px;color:var(--fg)}
.tl3-q input::placeholder{color:var(--text-3)}
.tl3-pills{display:flex;gap:8px;flex:none}
.tl3-pill{height:32px;padding:0 14px;border-radius:99px;border:1px solid var(--line-strong);font-size:13px;font-weight:500;color:var(--text-2);
  white-space:nowrap;transition:background .16s,color .16s,border-color .16s}
.tl3-pill:hover{background:var(--hover);color:var(--fg)}
.tl3-pill[aria-pressed=true]{background:var(--fg);border-color:var(--fg);color:var(--surface-0)}
.tl3-pill:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tl3-count{margin-left:auto;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.tl3-count b{color:var(--fg);font-weight:600}

.tl3-cols,.tl3-row{display:grid;grid-template-columns:36px minmax(170px,250px) minmax(0,1fr) 118px 48px;gap:0 16px;align-items:center}
.tl3-cols{padding:0 20px 8px;font-size:12px;font-weight:500;color:var(--muted)}
.tl3-cols span:first-child{grid-column:1/3}
.tl3-cols span:last-child{text-align:right}
.tl3-grp{margin:0 0 20px}
.tl3-gh{display:flex;align-items:center;gap:12px;min-height:40px;padding:0 20px 0 6px;margin-bottom:6px}
.tl3-tg{display:flex;align-items:center;gap:10px;flex:1;min-width:0;text-align:left;padding:4px 6px;border-radius:8px}
.tl3-tg:hover{background:var(--hover)}
.tl3-tg:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.tl3-tg .chev{width:16px;height:16px;color:var(--text-3);transition:transform .2s var(--ease)}
.tl3-tg[aria-expanded=true] .chev{transform:rotate(90deg)}
.tl3-tg b{font-size:13.5px;font-weight:600;color:var(--fg);white-space:nowrap}
.tl3-tg .n{font-size:12.5px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.tl3-tg .n.none{color:var(--warn)}
.tl3-tg small{flex:1;min-width:0;font-size:12.5px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tl3-tg small::before{content:"·";margin-right:10px;color:var(--text-3)}
.tl3-card{border:1px solid var(--line);border-radius:14px;background:var(--surface-1);overflow:hidden}
.tl3-card[hidden]{display:none}
.tl3-row{padding:12px 20px;min-height:60px;border-top:1px solid var(--line);transition:background .15s}
.tl3-row:first-child{border-top:0}
.tl3-row:hover{background:color-mix(in srgb,var(--fg) 2%,transparent)}
.tl3-ic{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--muted)}
.tl3-ic .i{width:17px;height:17px;stroke-width:1.7}
.tl3-nm{min-width:0}
.tl3-nm b{display:block;font-size:14px;font-weight:500;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tl3-nm .tl-code{display:block;margin-top:2px}
.tl3-ds{min-width:0}
.tl3-ds .ds{font-size:13px;color:var(--muted);line-height:1.5;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.tl3-ds .ds.open{display:block}
.tl3-more{margin-top:2px;padding:1px 0;font-size:12.5px;font-weight:550;color:var(--fg);text-decoration:underline;text-decoration-color:var(--line-strong);text-underline-offset:3px;border-radius:4px}
.tl3-more:hover{text-decoration-color:currentColor}
.tl3-more:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tl3-rk{display:flex}
.tl3-row .cc-sw{justify-self:end}
.tl3-row.off .tl3-nm b{color:var(--muted)}
.tl3-row.off .tl3-ic{opacity:.6}
.tl3-mt{display:none}
.tl3-sk{padding:4px 20px}
.tl3-sk .r{display:flex;align-items:center;gap:16px;height:60px;border-top:1px solid var(--line)}
.tl3-sk .r:first-child{border-top:0}
.tl3-empty{padding:40px 20px;text-align:center}
.tl3-empty .ic{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:12px;margin-bottom:14px;
  background:linear-gradient(180deg,#17202e,#0b0f17);color:#5eead4}
.tl3-empty .ic .cc-i,.tl3-empty .ic .i{width:20px;height:20px}
.tl3-empty b{display:block;font-size:15px;font-weight:600;color:var(--fg)}
.tl3-empty p{margin:4px auto 16px;max-width:42ch;font-size:13.5px;color:var(--muted);line-height:1.55}

@container tl (max-width:1000px){
  .tl3-cols,.tl3-row{grid-template-columns:36px minmax(0,1fr) 48px}
  .tl3-row{grid-template-areas:"ic nm sw" "ic ds sw";gap:4px 16px;padding:14px 20px}
  .tl3-ic{grid-area:ic;align-self:start}
  .tl3-nm{grid-area:nm}
  .tl3-ds{grid-area:ds}
  .tl3-row .cc-sw{grid-area:sw}
  .tl3-cols span:nth-child(2),.tl3-cols span:nth-child(3),.tl3-rk{display:none}
  .tl3-nm .tl-code{display:none}
  .tl3-mt{display:flex;align-items:center;gap:10px;margin-top:6px;min-width:0}
  .tl3-tg small{display:none}
}
@container tl (max-width:720px){
  .tl3-sum{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tl3-k:nth-child(3){border-left:0}
  .tl3-k:nth-child(n+3){border-top:1px solid var(--line)}
  .tl3-why{flex-direction:column;gap:8px}
  .tl3-why>span{align-items:flex-start}
  .tl3-why .cc-i{margin-top:2px}
}
@container tl (max-width:600px){
  .tl3-sum{margin-bottom:16px}
  .tl3-k{padding:14px 16px}
  .tl3-k .v{font-size:24px}
  .tl3-meter{height:10px;gap:2px}
  .tl3-why{padding:12px 16px}
  .tl3-bar{gap:8px;padding:8px 0}
  .tl3-q{max-width:none;flex-basis:100%}
  .tl3-pills{flex:1;min-width:0}
  .tl3-cols{display:none}
  .tl3-gh{padding:0 8px 0 0}
  .tl3-row{grid-template-columns:34px minmax(0,1fr) 48px;grid-template-areas:"ic nm sw" "ds ds ds";gap:8px 12px;padding:14px 14px 14px 16px}
  .tl3-ic{grid-area:ic}
  .tl3-nm{grid-area:nm}
  .tl3-row .cc-sw{grid-area:sw}
  .tl3-ds{grid-area:ds}
}
@media (max-width:1100px){.tl3-bar{top:-24px}}
@media (max-width:760px){
  .tl3-bar{top:-16px}
  .tl3-q{height:44px}
  .tl3-pill{height:36px}
}
@media (pointer:coarse){.tl3-pill{height:40px}}
@media (prefers-reduced-motion:reduce){.tl3-tg .chev{transition:none}}
`;

function summaryHTML(): string {
  const on = tools.filter((t) => t.enabled).length;
  const total = tools.length;
  const lit = total ? Math.round((on / total) * TICKS) : 0;
  const tier = (r: ToolRisk): string => {
    const all = tools.filter((t) => toolRisk(t) === r);
    const n = all.filter((t) => t.enabled).length;
    return `<div class="tl3-k"><div class="lb tl-risk ${r}" title="${attr(RISKS[r].desc)}">${esc(RISKS[r].label)}</div>
      <div class="v">${all.length}</div><div class="h">${n === all.length ? 'All on' : `${n} on`}</div></div>`;
  };
  return `<div class="tl3-k"><div class="lb">Switched on</div><div class="v">${on}<small>/ ${total}</small></div>
      <div class="tl3-meter" aria-hidden="true">${Array.from({ length: TICKS }, (_, i) => `<i${i < lit ? ' class="on"' : ''}></i>`).join('')}</div></div>
    ${(Object.keys(RISKS) as ToolRisk[]).map(tier).join('')}
    <div class="tl3-why"><span>${ICO.x}<span><b>Off for every AI.</b> A switched off tool is hidden from all of them.</span></span>
      <span>${ICO.shield}<span><b>Less for one AI.</b> An agent's own page can allow it fewer tools.</span></span></div>`;
}

export async function renderTools(): Promise<void> {
  useControlStyles();
  useStyles('tools-css-4', SYS_PAGE_CSS + TL_CSS + TOOL_ROW_CSS);
  const host = $('#view-tools');
  host.innerHTML = `<div class="cc tl3">${systemHeader(
    'tools',
    'Tools',
    'What connected AIs can do in Memora. A tool switched off here is off for every AI.',
    `<button type="button" class="cc-ibtn" id="tlMore" aria-haspopup="menu" aria-label="More actions" title="More">${ICO.more}</button>`,
  )}
    <section class="tl3-sum" id="tlSum" aria-label="Summary"><div class="tl3-k">${skBlock('40%', 12)}<div style="height:12px"></div>${skBlock('55%', 28)}</div>${[0, 1, 2]
      .map(() => `<div class="tl3-k">${skBlock('50%', 12)}<div style="height:12px"></div>${skBlock('30%', 28)}</div>`)
      .join('')}</section>
    <div class="tl3-bar">
      <label class="tl3-q">${ICO.search}<span class="sr-only">Search tools</span>
        <input type="search" id="tlQ" placeholder="Search by name or what it does" autocomplete="off" value="${attr(query)}"></label>
      <div class="tl3-pills" role="group" aria-label="Show" id="tlShow">${(['all', 'on', 'off'] as const)
        .map((v) => `<button type="button" class="tl3-pill" data-v="${v}" aria-pressed="${show === v}">${v === 'all' ? 'All' : v === 'on' ? 'On' : 'Off'}</button>`)
        .join('')}</div>
      <span class="tl3-count" id="tlCount" aria-live="polite"></span>
    </div>
    <div class="tl3-cols" aria-hidden="true"><span>Tool</span><span>What it does</span><span>Access</span><span>On</span></div>
    <div id="tlList">${[0, 1]
      .map(
        () =>
          `<div class="tl3-grp" aria-hidden="true"><div class="tl3-gh">${skBlock('160px', 12)}</div><div class="tl3-card tl3-sk">${[0, 1, 2]
            .map(() => `<div class="r">${skBlock('34px', 34)}${skBlock('22%', 12)}${skBlock('40%', 10)}</div>`)
            .join('')}</div></div>`,
      )
      .join('')}</div></div>`;
  $('#tlMore').onclick = (e) => {
    const shown = visible();
    const offN = shown.filter((t) => !t.enabled).length;
    const onN = shown.filter((t) => t.enabled).length;
    const filtered = !!query || show !== 'all';
    openMenu(
      e.currentTarget as HTMLElement,
      [
        {
          label: filtered ? 'Turn on the tools shown' : 'Turn every tool on',
          desc: offN ? `Switches ${offN} tool${offN === 1 ? '' : 's'} back on for every AI.` : 'Everything shown is already on.',
          icon: ICO.check,
          disabled: !offN,
          run: () => void flip(shown.filter((t) => !t.enabled).map((t) => t.name), true),
        },
        {
          label: filtered ? 'Turn off the tools shown' : 'Turn every tool off',
          desc: onN ? `Every AI loses ${onN} tool${onN === 1 ? '' : 's'} at once. Asks first.` : 'Everything shown is already off.',
          icon: ICO.pause,
          danger: true,
          disabled: !onN,
          run: () => confirmOff(shown.filter((t) => t.enabled).map((t) => t.name), !filtered),
        },
        { sep: true, label: '' },
        { label: 'Reload the list', icon: ICO.refresh, run: () => void renderTools() },
      ],
      { title: 'Tools' },
    );
  };
  const q = $('#tlQ') as HTMLInputElement;
  q.oninput = () => {
    query = q.value.trim().toLowerCase();
    paint();
  };
  host.querySelectorAll<HTMLButtonElement>('#tlShow button').forEach((b) => {
    b.onclick = () => {
      show = b.dataset.v as typeof show;
      host.querySelectorAll('#tlShow button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      paint();
    };
  });

  const seq = ++loadSeq;
  let list: ToolInfo[];
  try {
    list = await fetchTools();
  } catch (e) {
    if (seq !== loadSeq) return;
    $('#tlCount').textContent = '';
    $('#tlSum').hidden = true;
    $('#tlList').innerHTML = `<div class="tl3-card tl3-empty"><span class="ic">${ICO.refresh}</span><b>Could not load the tool list</b><p>${esc(
      (e as Error).message,
    )}</p><button type="button" class="btn" id="tlRetry">${ICO.refresh}Try again</button></div>`;
    $('#tlRetry').onclick = () => void renderTools();
    return;
  }
  if (seq !== loadSeq) return;
  tools = list;
  paint();
}

/** Ask before switching tools off; `every` = the whole list, which leaves AIs unable to do anything. */
function confirmOff(names: string[], every = false): void {
  if (!names.length) return;
  const n = names.length;
  Modal.confirm(
    every ? 'Turn every tool off?' : n === 1 ? 'Turn this tool off?' : `Turn ${n} tools off?`,
    every
      ? `Every connected AI loses all ${n} tools at once and can no longer read or change your notes until you turn tools back on here.`
      : `Every connected AI loses ${n === 1 ? 'it' : 'them'} at once. You can turn ${n === 1 ? 'it' : 'them'} back on any time.`,
    every ? 'Turn every tool off' : 'Turn off',
    () => {
      Modal.close();
      void flip(names, false);
    },
  );
}

function visible(): ToolInfo[] {
  return tools.filter((t) => toolMatches(t, query) && (show === 'all' || (show === 'on') === t.enabled));
}

function paint(): void {
  const list = $('#tlList');
  const focused = document.activeElement as HTMLElement | null;
  const refocus = focused && list.contains(focused) ? focused.id : '';

  const on = tools.filter((t) => t.enabled).length;
  const shown = visible();
  $('#tlCount').innerHTML =
    `<b>${on}</b> of ${tools.length} on` + (query || show !== 'all' ? ` &middot; ${shown.length} shown` : '');
  const sum = $('#tlSum');
  sum.hidden = !tools.length;
  if (tools.length) sum.innerHTML = summaryHTML();

  if (!tools.length) {
    list.innerHTML = `<div class="tl3-card tl3-empty"><span class="ic">${icon('tools')}</span><b>No tools</b><p>The server lists no tools. Try reloading the page.</p></div>`;
    return;
  }
  if (!shown.length) {
    list.innerHTML = `<div class="tl3-card tl3-empty"><span class="ic">${ICO.search}</span><b>Nothing matches</b><p>Try another word, or show all tools.</p></div>`;
    return;
  }

  list.innerHTML = groupTools(shown)
    .map(([cat, items]) => {
      const all = tools.filter((t) => (t.category || 'other') === cat);
      const n = all.filter((t) => t.enabled).length;
      const hid = 'tlc-' + cat.replace(/[^a-z0-9]+/gi, '-');
      const open = !collapsed.has(cat) || !!query;
      const state = n === all.length ? 'true' : n ? 'mixed' : 'false';
      const busy = all.some((t) => pending.has(t.name));
      return `<section class="tl3-grp" aria-labelledby="${attr(hid)}">
        <div class="tl3-gh"><button type="button" class="tl3-tg" id="${attr(hid)}" data-tg="${attr(cat)}" aria-expanded="${open}" aria-controls="${attr(hid)}-b">
          <svg class="cc-i chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
          <b>${esc(categoryLabel(cat))}</b><span class="n${n ? '' : ' none'}">${n} of ${all.length} on</span>${
            categoryDesc(cat) ? `<small>${esc(categoryDesc(cat))}</small>` : ''
          }</button>
          <button type="button" class="cc-sw" role="switch" id="${attr(hid)}-sw" data-cat="${attr(cat)}" aria-checked="${state}"${busy ? ' disabled' : ''}
            aria-label="All ${attr(categoryLabel(cat))} tools" title="${n === all.length ? 'Turn all off' : 'Turn all on'}"><i></i></button></div>
        <div class="tl3-card" id="${attr(hid)}-b"${open ? '' : ' hidden'}>${items.map(row).join('')}</div></section>`;
    })
    .join('');

  $$<HTMLButtonElement>('.tl3-row .cc-sw', list).forEach(
    (b) => (b.onclick = () => void flip([b.dataset.name!], b.getAttribute('aria-checked') !== 'true')),
  );
  $$<HTMLButtonElement>('[data-more]', list).forEach(
    (b) =>
      (b.onclick = () => {
        const open = b.getAttribute('aria-expanded') !== 'true';
        b.setAttribute('aria-expanded', String(open));
        b.textContent = open ? 'Less' : 'More';
        b.previousElementSibling?.classList.toggle('open', open);
      }),
  );
  $$<HTMLButtonElement>('[data-tg]', list).forEach(
    (b) =>
      (b.onclick = () => {
        const c = b.dataset.tg!;
        if (collapsed.has(c)) collapsed.delete(c);
        else collapsed.add(c);
        paint();
        document.getElementById(b.id)?.focus();
      }),
  );
  $$<HTMLButtonElement>('.tl3-gh .cc-sw', list).forEach(
    (b) =>
      (b.onclick = () => {
        const cat = b.dataset.cat!;
        const inCat = tools.filter((t) => (t.category || 'other') === cat);
        if (b.getAttribute('aria-checked') === 'true') confirmOff(inCat.map((t) => t.name));
        else void flip(inCat.filter((t) => !t.enabled).map((t) => t.name), true);
      }),
  );
  if (refocus) document.getElementById(refocus)?.focus();
}

/** Descriptions longer than this are clamped to two lines with a "More" toggle. */
const LONG_DESC = 150;

function row(t: ToolInfo): string {
  const id = 'tls-' + t.name.replace(/[^a-z0-9_-]+/gi, '-');
  const code = `<code class="tl-code" title="The technical name an AI uses for it">${esc(t.name)}</code>`;
  return `<div class="tl3-row${t.enabled ? '' : ' off'}">
    <span class="tl3-ic" aria-hidden="true">${catIcon(t.category || 'other')}</span>
    <div class="tl3-nm"><b id="${attr(id)}-l">${esc(toolTitle(t.name))}</b>${code}</div>
    <div class="tl3-ds">${t.description ? `<div class="ds" id="${attr(id)}-d">${esc(t.description)}</div>` : ''}${
      t.description.length > LONG_DESC
        ? `<button type="button" class="tl3-more" data-more aria-expanded="false" aria-controls="${attr(id)}-d">More</button>`
        : ''
    }<div class="tl3-mt">${riskChip(toolRisk(t))}${code}</div></div>
    <span class="tl3-rk">${riskChip(toolRisk(t))}</span>
    <button type="button" class="cc-sw" role="switch" id="${attr(id)}" data-name="${attr(t.name)}" aria-checked="${t.enabled}"
      aria-labelledby="${attr(id)}-l"${t.description ? ` aria-describedby="${attr(id)}-d"` : ''}${pending.has(t.name) ? ' disabled' : ''}><i></i></button></div>`;
}

/** Optimistically switch tools, then confirm each with the server. */
async function flip(names: string[], enabled: boolean): Promise<void> {
  const targets = tools.filter((t) => names.includes(t.name) && !pending.has(t.name));
  if (!targets.length) return;
  for (const t of targets) {
    t.enabled = enabled;
    pending.add(t.name);
  }
  paint();

  const results = await Promise.allSettled(targets.map((t) => setToolEnabled(t.name, enabled)));
  const failed: string[] = [];
  let lastErr = '';
  results.forEach((r, i) => {
    const t = targets[i];
    pending.delete(t.name);
    if (r.status === 'rejected') {
      t.enabled = !enabled;
      failed.push(t.name);
      lastErr = (r.reason as Error)?.message || 'error';
    } else if (r.value && typeof r.value.enabled === 'boolean') {
      t.enabled = r.value.enabled;
    }
  });
  if (document.getElementById('tlList')) paint();

  const verb = enabled ? 'on' : 'off';
  if (failed.length) {
    toast(
      failed.length === 1 ? `Could not switch ${failed[0]}: ${lastErr}` : `${failed.length} tools could not be turned ${verb}: ${lastErr}`,
      'err',
      5200,
    );
  } else if (targets.length === 1) {
    toast(`${toolTitle(targets[0].name)} is ${verb}`, enabled ? 'ok' : 'warn');
  } else {
    toast(`${targets.length} tools turned ${verb}`, enabled ? 'ok' : 'warn');
  }
}
