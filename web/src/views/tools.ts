// MCP tools: the server wide switch per tool (docs/contracts/tools-permissions.md).
// A disabled tool is hidden from tools/list and refused by tools/call for every
// API key. Switches are optimistic: the UI flips at once and rolls back with a
// toast when the server refuses.

import { fetchTools, setToolEnabled } from '../api';
import { $, $$, attr, esc, useStyles } from '../dom';
import { toast } from '../toast';
import { Modal } from '../modal';
import { ICO, openMenu, systemHeader, useControlStyles } from '../control/ui';
import { skBlock } from '../ui/skeleton';
import type { ToolInfo } from '../types';

// ── catalogue knowledge shared with the permissions editor ─────────────

/** Category names and one plain line each, in the order people think of them. */
const CATEGORIES: Record<string, { label: string; desc: string }> = {
  note: { label: 'Notes', desc: 'Read, create, edit, move and delete single notes.' },
  search: { label: 'Search', desc: 'Find notes by words and get counts for the vault.' },
  tag: { label: 'Tags', desc: 'See every tag and add or remove tags on a note.' },
  folder: { label: 'Folders', desc: 'List folders and create new ones.' },
  graph: { label: 'Links and graph', desc: 'Follow links between notes: neighbours, paths, hubs and loose ends.' },
  query: { label: 'Queries and tag upkeep', desc: 'Filter notes by their properties, find similar notes, rename or merge tags.' },
  version: { label: 'History', desc: 'Older versions of a note: read, compare, restore, and the trash.' },
  write: { label: 'Bulk writing', desc: 'Create, copy, merge, replace or delete many notes in one call.' },
  collab: { label: 'Working together', desc: 'Locks, mentions and assignments so agents do not overwrite each other.' },
  ops: { label: 'Activity and upkeep', desc: 'Activity logs, health checks, stale notes, folder settings and folder moves.' },
  identity: { label: 'Identity', desc: 'How the agent itself shows up: its display name and colour.' },
  interop: { label: 'Import and export', desc: 'Bring notes in or take them out as a zip of markdown.' },
  ux: { label: 'Tasks, checks and pins', desc: 'To-dos, follow-ups, checks that a note is well formed, and the pinned notes and folders.' },
};
const CAT_ORDER = Object.keys(CATEGORIES);

export type ToolRisk = 'read' | 'write' | 'admin';

export const RISKS: Record<ToolRisk, { label: string; desc: string }> = {
  read: { label: 'Read only', desc: 'Only looks; changes nothing.' },
  write: { label: 'Can write', desc: 'Creates or edits notes, tags or folders.' },
  admin: { label: 'High impact', desc: 'Deletes, or changes many notes at once.' },
};

const HIGH = new Set([
  'delete_memory',
  'soft_delete',
  'bulk_delete',
  'bulk_replace',
  'merge_memory',
  'rename_tag',
  'merge_tag',
  'import_memory',
  'delete_folder',
  'rename_folder',
  'move_folder',
  'move_folder_contents',
]);
const READ_RE =
  /^(get|list|read|search|find|query|export)_|^(link_stats|broken_links|diff|presence|healthcheck|folder_stats|stale_detection|validate_memory|follow_ups|suggest_links|digest)$/;

/** What a tool can do to the vault, from its name. */
export function toolRisk(t: { name: string }): ToolRisk {
  if (HIGH.has(t.name) || /(^|_)(delete|purge|drop|wipe)(_|$)|^bulk_|^merge_|^import_/.test(t.name)) return 'admin';
  if (READ_RE.test(t.name)) return 'read';
  return 'write';
}

/** "read_memory" -> "Read memory". */
export function toolTitle(name: string): string {
  const s = name.replace(/[_-]+/g, ' ').trim();
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

/** Shared by the Tools page and the permissions editor. */
export const TOOL_ROW_CSS = `
.tl-risk{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px;border-radius:99px;font-size:11px;font-weight:650;
  white-space:nowrap;border:1px solid var(--line);color:var(--muted);background:var(--panel-2)}
.tl-risk::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.tl-risk.read{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 30%,transparent);background:var(--ok-soft)}
.tl-risk.write{color:var(--accent);border-color:var(--accent-line);background:var(--accent-soft)}
.tl-risk.admin{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent);background:var(--warn-soft)}
.tl-code{font-family:var(--mono);font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
`;

// ── page ────────────────────────────────────────────────────────────────

let tools: ToolInfo[] = [];
let query = '';
let show: 'all' | 'on' | 'off' = 'all';
const collapsed = new Set<string>();
const pending = new Set<string>();
/** Bumped per renderTools(); a slower, older tool list is dropped. */
let loadSeq = 0;

const TL_CSS = `
.tl2-explain{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 18px}
.tl2-pt{display:flex;gap:12px;align-items:flex-start;padding:14px 15px;border-radius:var(--r-lg);border:1px solid var(--line);background:var(--panel)}
.tl2-pt .ic{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;flex:none;background:var(--accent-soft);color:var(--accent)}
.tl2-pt .tx{flex:1;min-width:0}
.tl2-pt b{display:block;font-size:13.5px;font-weight:650;margin-bottom:3px}
.tl2-pt p{margin:0;font-size:12.5px;color:var(--muted);line-height:1.5}
.tl2-legend{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.tl2-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 14px;position:sticky;top:0;z-index:2;padding:8px 0;
  background:var(--bg)}
.tl2-bar .cc-search{max-width:420px;height:40px}
.tl2-bar .cc-seg button{min-height:32px;padding:5px 14px}
.tl2-count{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums;margin-left:auto}
.tl2-count b{color:var(--fg);font-weight:650}
.tl2-cat{margin-bottom:12px;overflow:hidden}
.tl2-cat-h{display:flex;align-items:center;gap:12px;padding:12px 16px;min-height:64px}
.tl2-tg{display:flex;align-items:center;gap:12px;flex:1;min-width:0;text-align:left;padding:4px 0;border-radius:8px}
.tl2-tg:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tl2-tg .chev{transition:transform .2s;color:var(--muted)}
.tl2-tg[aria-expanded=true] .chev{transform:rotate(90deg)}
.tl2-tg .t{min-width:0;flex:1}
.tl2-tg b{display:block;font-size:14.5px;font-weight:680}
.tl2-tg small{display:block;font-size:12.5px;color:var(--muted);line-height:1.45;margin-top:1px}
.tl2-n{font-size:12px;color:var(--muted);font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
.tl2-n.all{color:var(--ok)}
.tl2-n.none{color:var(--danger)}
.tl2-body{border-top:1px solid var(--line)}
.tl2-row{display:flex;align-items:center;gap:16px;padding:12px 16px;border-top:1px solid var(--line)}
.tl2-row:first-child{border-top:0}
.tl2-row .tx{flex:1;min-width:0}
.tl2-row .nm{font-size:13.5px;font-weight:620}
.tl2-row .ds{font-size:12.5px;color:var(--muted);line-height:1.45;margin-top:2px}
.tl2-row .nm{display:flex;align-items:baseline;gap:10px;min-width:0}
.tl2-row .nm .tl-code{font-weight:400}
.tl2-row .mt{display:none;align-items:center;gap:8px;margin-top:6px;min-width:0}
.tl2-row .rk{flex:none;width:110px;display:flex;justify-content:flex-start}
.tl2-row.off .nm{color:var(--muted)}
.tl2-row.off .tl-risk{opacity:.7}
.tl2-row .cc-sw,.tl2-cat-h .cc-sw{margin:0 2px}
.tl2-sk{padding:16px;display:flex;flex-direction:column;gap:14px}
@media (max-width:1000px){.tl2-explain{grid-template-columns:1fr;gap:8px}.tl2-pt{padding:12px 14px}}
@media (max-width:760px){
  .tl2-bar{gap:8px;top:0}
  .tl2-bar .cc-search{max-width:none;flex-basis:100%;height:44px}
  .tl2-bar .cc-seg{flex:1}
  .tl2-bar .cc-seg button{flex:1;min-height:38px}
  .tl2-count{margin-left:0}
  .tl2-cat-h{padding:10px 12px 10px 14px}
  .tl2-tg small{display:none}
  .tl2-row{padding:12px 12px 12px 14px;gap:12px}
  .tl2-row .nm .tl-code,.tl2-row .rk{display:none}
  .tl2-row .mt{display:flex}
  .tl2-explain{gap:0;border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;background:var(--panel)}
  .tl2-pt{border:0;border-radius:0;border-top:1px solid var(--line);padding:12px 14px}
  .tl2-pt:first-child{border-top:0}
  .tl2-pt .ic{width:28px;height:28px}
}
`;

export async function renderTools(): Promise<void> {
  useControlStyles();
  useStyles('tools-css-3', TL_CSS + TOOL_ROW_CSS);
  const host = $('#view-tools');
  host.innerHTML = `<div class="cc">${systemHeader(
    'tools',
    'Tools',
    'Choose which MCP tools exist on this server. A tool switched off here is gone for every agent.',
    `<button type="button" class="cc-ibtn" id="tlMore" aria-haspopup="menu" aria-label="More actions" title="More">${ICO.more}</button>
     <button type="button" class="cc-ibtn" id="tlReload" aria-label="Reload" title="Reload">${ICO.refresh}</button>`,
  )}
    <div class="tl2-explain">
      <div class="tl2-pt"><span class="ic">${ICO.x}</span><div class="tx"><b>Off means off for everyone</b>
        <p>The tool disappears from every agent's tool list and any call to it is refused.</p></div></div>
      <div class="tl2-pt"><span class="ic">${ICO.shield}</span><div class="tx"><b>Agents can be narrower</b>
        <p>Each agent's own permissions can limit it to fewer tools, never to more than are on here.</p></div></div>
      <div class="tl2-pt"><span class="ic">${ICO.note}</span><div class="tx"><b>Know what a tool does</b>
        <p>Every tool is marked by what it can do.</p>
        <div class="tl2-legend">${(Object.keys(RISKS) as ToolRisk[]).map((r) => riskChip(r)).join('')}</div></div></div>
    </div>
    <div class="tl2-bar">
      <label class="cc-search">${ICO.search}<span class="sr-only">Search tools</span>
        <input type="search" id="tlQ" placeholder="Search by name or what it does" autocomplete="off" value="${attr(query)}"></label>
      <div class="cc-seg" role="group" aria-label="Show" id="tlShow">${(['all', 'on', 'off'] as const)
        .map((v) => `<button type="button" data-v="${v}" aria-pressed="${show === v}">${v === 'all' ? 'All' : v === 'on' ? 'On' : 'Off'}</button>`)
        .join('')}</div>
      <span class="tl2-count" id="tlCount" aria-live="polite"></span>
    </div>
    <div id="tlList">${[0, 1, 2]
      .map(
        () =>
          `<div class="cc-card tl2-cat" aria-hidden="true"><div class="tl2-sk">${skBlock('30%', 14)}${skBlock('60%', 10)}${skBlock('100%', 1)}${skBlock(
            '45%',
            12,
          )}${skBlock('70%', 10)}${skBlock('38%', 12)}</div></div>`,
      )
      .join('')}</div></div>`;
  $('#tlReload').onclick = () => void renderTools();
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
          desc: offN ? `Switches ${offN} tool${offN === 1 ? '' : 's'} back on for every agent.` : 'Everything shown is already on.',
          icon: ICO.check,
          disabled: !offN,
          run: () => void flip(shown.filter((t) => !t.enabled).map((t) => t.name), true),
        },
        {
          label: filtered ? 'Turn off the tools shown' : 'Turn every tool off',
          desc: onN ? `Agents lose ${onN} tool${onN === 1 ? '' : 's'} at once. Asks first.` : 'Everything shown is already off.',
          icon: ICO.pause,
          danger: true,
          disabled: !onN,
          run: () => confirmOff(shown.filter((t) => t.enabled).map((t) => t.name)),
        },
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
    $('#tlList').innerHTML = `<div class="cc-card cc-empty"><b>Could not load the tool list</b>${esc((e as Error).message)}
      <div style="margin-top:12px"><button type="button" class="btn" id="tlRetry">${ICO.refresh}Try again</button></div></div>`;
    $('#tlRetry').onclick = () => void renderTools();
    return;
  }
  if (seq !== loadSeq) return;
  tools = list;
  paint();
}

function confirmOff(names: string[]): void {
  if (!names.length) return;
  Modal.confirm(
    'Turn tools off',
    `Turn off ${names.length} tool${names.length === 1 ? '' : 's'} for every agent? Agents lose ${names.length === 1 ? 'it' : 'them'} at once; you can turn ${
      names.length === 1 ? 'it' : 'them'
    } back on any time.`,
    'Turn off',
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

  if (!tools.length) {
    list.innerHTML = '<div class="cc-card cc-empty"><b>No tools</b>The server reports no MCP tools.</div>';
    return;
  }
  if (!shown.length) {
    list.innerHTML = `<div class="cc-card cc-empty"><b>Nothing matches</b>Try another word, or show all tools.</div>`;
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
      return `<section class="cc-card tl2-cat" aria-labelledby="${attr(hid)}">
        <div class="tl2-cat-h"><button type="button" class="tl2-tg" id="${attr(hid)}" data-tg="${attr(cat)}" aria-expanded="${open}" aria-controls="${attr(hid)}-b">
          <svg class="cc-i chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
          <span class="t"><b>${esc(categoryLabel(cat))}</b>${categoryDesc(cat) ? `<small>${esc(categoryDesc(cat))}</small>` : ''}</span>
          <span class="tl2-n ${n === all.length ? 'all' : n ? '' : 'none'}">${n} of ${all.length} on</span></button>
          <button type="button" class="cc-sw" role="switch" id="${attr(hid)}-sw" data-cat="${attr(cat)}" aria-checked="${state}"${busy ? ' disabled' : ''}
            aria-label="All ${attr(categoryLabel(cat))} tools" title="${n === all.length ? 'Turn all off' : 'Turn all on'}"><i></i></button></div>
        <div class="tl2-body" id="${attr(hid)}-b"${open ? '' : ' hidden'}>${items.map(row).join('')}</div></section>`;
    })
    .join('');

  $$<HTMLButtonElement>('.tl2-row .cc-sw', list).forEach(
    (b) => (b.onclick = () => void flip([b.dataset.name!], b.getAttribute('aria-checked') !== 'true')),
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
  $$<HTMLButtonElement>('.tl2-cat-h .cc-sw', list).forEach(
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

function row(t: ToolInfo): string {
  const id = 'tls-' + t.name.replace(/[^a-z0-9_-]+/gi, '-');
  return `<div class="tl2-row${t.enabled ? '' : ' off'}">
    <div class="tx"><div class="nm"><span id="${attr(id)}-l">${esc(toolTitle(t.name))}</span><code class="tl-code" title="The name agents call it by">${esc(t.name)}</code></div>
      ${t.description ? `<div class="ds" id="${attr(id)}-d">${esc(t.description)}</div>` : ''}
      <div class="mt">${riskChip(toolRisk(t))}<code class="tl-code" title="The name agents call it by">${esc(t.name)}</code></div></div>
    <span class="rk">${riskChip(toolRisk(t))}</span>
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
      t.enabled = !enabled; // roll back
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
