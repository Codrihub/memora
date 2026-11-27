// Boards: every Kanban board in the vault (notes in the Obsidian Kanban format), as cards with their
// lanes, progress, what is overdue and last change. A click opens the board in the Notes page; its ⋯
// menu (or a right-click, or a long press on touch) renames, moves, duplicates, restyles or trashes it.

import { apiGet } from '../api';
import { on } from '../bus';
import { attr, el, esc, useStyles } from '../dom';
import { fmtTs, relTs } from '../format';
import { hooks } from '../hooks';
import { t, tn } from '../i18n';
import { colorOfFolder, noteTitle, state } from '../state';
import { I } from '../vault/icons';
import { askMoveNotes, deleteNotesToTrash, duplicateBoard } from '../vault/menus';
import { nav } from '../vault/nav';
import { onRefresh, renameNote } from '../vault/ops';
import { ROOT_LABEL } from '../vault/store';
import { openMenu, promptName } from '../vault/ui';
import { createSelect, type Select } from '../ui/select';
import { dateColorFor, dayOf, dueCounts } from './due';
import { boardIcon, editBoardStyle, IC } from './kanban';

interface BoardInfo {
  path: string;
  title: string;
  lanes: { title: string; cards: number }[];
  cards: number;
  done: number;
  archived: number;
  version: string;
  mtime: number;
  style?: { color?: string | null; icon?: string | null } | null;
  /** Due dates of open cards (`YYYY-MM-DD`), and the board's own date colours when set. */
  due?: string[];
  date_colors?: unknown;
}

const CSS = `
.bd{max-width:1180px;margin:0 auto;padding:8px 8px 96px;container:bd/inline-size}
.bd-head{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.bd-tile{display:grid;place-items:center;flex:none;width:48px;height:48px;border-radius:13px;color:var(--accent);
  background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent-line)}
.bd-tile .vx-i{width:22px;height:22px;stroke-width:1.7}
.bd-title{flex:1 1 220px;min-width:0}
.bd-title h1{margin:0;font-size:26px;font-weight:650;letter-spacing:-.02em;line-height:1.25}
.bd-title p{margin:3px 0 0;font-size:14px;color:var(--muted);font-variant-numeric:tabular-nums}
.bd-new{display:inline-flex;align-items:center;gap:8px;height:40px;padding-inline:14px 16px;border-radius:11px}
.bd-new .vx-i{width:16px;height:16px}
.bd-tbar{display:flex;align-items:center;gap:10px;margin:22px 0 16px;flex-wrap:wrap}
.bd-sels{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-inline-start:auto}
.bd-sel{height:40px;max-width:220px}
.bd-sel .tx{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bd-sel .vx-i,.bd-sel>svg:first-child{width:15px;height:15px;flex:none;color:var(--muted)}
.bd-reset{margin-inline-start:8px}
.bd-search{display:flex;align-items:center;gap:9px;flex:0 1 320px;min-width:0;height:40px;padding-inline:13px 6px;border-radius:10px;cursor:text;
  border:1px solid transparent;background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--muted)}
.bd-search:focus-within{border-color:var(--line-strong);background:var(--surface-1);color:var(--fg)}
.bd-search .vx-i{width:16px;height:16px;flex:none}
.bd-search input{flex:1;min-width:0;height:100%;border:0;background:none;color:var(--fg);font:inherit;font-size:14px;outline:none;padding:0}
.bd-search input:focus-visible{outline:none;box-shadow:none}
.bd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:16px;align-items:stretch}
.bd-card{position:relative;display:flex;flex-direction:column;gap:14px;text-align:start;padding:16px 16px 14px;border-radius:14px;border:1px solid var(--line);
  background:var(--surface-1);color:var(--fg);font:inherit;cursor:pointer;min-width:0;container:bdc/inline-size;transition:border-color .15s;
  -webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
.bd-card:hover{border-color:var(--line-strong)}
.bd-card:has(.bd-open:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.bd-open{all:unset;display:block;min-width:0;max-width:100%;cursor:pointer}
.bd-open::after{content:"";position:absolute;inset:0;border-radius:inherit}
.bd-open:focus-visible{outline:none}
/* Title, folder and ⋯ sit in their own grid columns: a long name wraps (two lines at most) and never runs under the button. */
.bd-top{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:start;gap:12px;min-width:0}
.bd-more{position:relative;z-index:1;flex:none;margin:-6px -8px 0 0;width:34px;height:34px;color:var(--muted)}
[dir=rtl] .bd-more{margin:-6px 0 0 -8px}
.bd-more:hover,.bd-more[aria-expanded=true]{color:var(--fg)}
@media (hover:none){.bd-more{width:40px;height:40px;margin-top:-9px}}
.bd-ico{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:10px;color:var(--fc,var(--accent));
  background:color-mix(in srgb,var(--fc,var(--accent)) 13%,transparent)}
.bd-ico .vx-i,.bd-ico svg{width:18px;height:18px}
.bd-ico .kb-emo{font-size:17px;line-height:1}
.bd-name{min-width:0;padding-top:1px}
.bd-name b{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;font-size:15px;font-weight:650;line-height:1.3;
  overflow-wrap:break-word;word-break:normal;hyphens:manual}
.bd-name small{display:block;margin-top:3px;font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Lanes: flat bars on one baseline. Counts show while they fit; lane names only where each bar has room for a word
   (else they live in the bar's tooltip), so a name is never cut to a stub. */
.bd-lanes{display:flex;align-items:stretch;gap:6px;min-width:0;padding:0 1px}
.bd-lane{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:stretch;gap:5px}
.bd-bar{position:relative;height:36px;border-bottom:1px solid var(--line-strong,var(--line))}
.bd-bar::after{content:"";position:absolute;inset:auto 0 0 0;height:max(2px,var(--h,0%));border-radius:3px 3px 0 0;
  background:color-mix(in srgb,var(--fc,var(--accent)) 58%,var(--surface-1))}
.bd-bar.zero::after{background:var(--line)}
.bd-ln{display:flex;flex-direction:column;align-items:center;gap:1px;min-width:0;text-align:center;line-height:1.25}
.bd-ln em{font-style:normal;font-size:11px;font-weight:600;color:var(--text-2);font-variant-numeric:tabular-nums;white-space:nowrap}
.bd-lt{display:none;max-width:100%;font-size:10.5px;color:var(--muted);overflow:hidden;
  -webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow-wrap:break-word;word-break:normal}
.bd-lanes[data-n="1"] .bd-lt,.bd-lanes[data-n="2"] .bd-lt,.bd-lanes[data-n="3"] .bd-lt{display:-webkit-box}
@container bdc (min-width:250px){.bd-lanes[data-n="4"] .bd-lt{display:-webkit-box}}
@container bdc (min-width:320px){.bd-lanes[data-n="5"] .bd-lt{display:-webkit-box}}
@container bdc (min-width:390px){.bd-lanes[data-n="6"] .bd-lt{display:-webkit-box}}
@container bdc (min-width:470px){.bd-lanes:is([data-n="7"],[data-n="8"]) .bd-lt{display:-webkit-box}}
.bd-lanes.many .bd-ln em{display:none}
@container bdc (min-width:380px){.bd-lanes.many .bd-ln em{display:inline}}
.bd-lanes.many{gap:4px}
.bd-prog{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--text-2);font-variant-numeric:tabular-nums;min-width:0}
.bd-prog>span:last-child{flex:none;white-space:nowrap}
.bd-meter{flex:1;min-width:40px;height:4px;border-bottom:1px solid var(--line);box-sizing:content-box;display:flex;align-items:stretch}
.bd-meter i{display:block;height:100%;border-radius:2px 2px 0 0;background:color-mix(in srgb,var(--fc,var(--accent)) 62%,var(--surface-1))}
/* Footer: whole phrases that wrap to a new line as a unit, never cut mid-word. */
.bd-foot{display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px;margin-top:auto;font-size:12px;color:var(--muted);min-width:0;font-variant-numeric:tabular-nums}
.bd-foot>span{white-space:nowrap;max-width:100%}
.bd-foot>.bd-when{white-space:normal}
.bd-late{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;font-size:11.5px;font-weight:600;
  background:color-mix(in srgb,var(--warn) 15%,transparent);color:var(--warn);font-variant-numeric:tabular-nums}
.bd-late svg{width:12px;height:12px}
@container bdc (max-width:300px){.bd-bar{height:30px}}
.bd-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:56px 20px;border:1.5px dashed var(--line-strong);border-radius:18px;margin-top:22px}
.bd-empty .bd-tile{width:56px;height:56px}
.bd-empty h2{margin:6px 0 0;font-size:18px;font-weight:650}
.bd-empty p{margin:0;max-width:52ch;color:var(--text-2);font-size:14px;line-height:1.55}
.bd-empty .bd-new{margin-top:8px}
.bd-none{color:var(--muted);font-size:14px;padding:24px 4px}
.bd-sk{height:178px;border-radius:14px}
@container bd (max-width:560px){
  .bd-title h1{font-size:22px}
  .bd-head .bd-new{flex:1 1 100%;justify-content:center;height:44px}
  .bd-search{flex:1 1 100%;height:44px}
  .bd-sels{flex:1 1 100%;margin:0}
  .bd-sel{flex:1 1 0;min-width:0;max-width:none;height:44px}
  .bd-search input{font-size:16px}
  .bd-grid{gap:12px}
}
@media (prefers-reduced-motion:reduce){.bd-card{transition:none}}
`;

type SortKey = 'updated' | 'name' | 'progress' | 'due';
type StatusKey = 'all' | 'overdue' | 'open' | 'done';
interface ViewPrefs {
  sort: SortKey;
  /** '' for every folder, '/' for the top level only, else a folder (with its subfolders). */
  folder: string;
  status: StatusKey;
}
const LS_VIEW = 'memora.boards.view.v1';
const SORT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/></svg>';
const SORTS: SortKey[] = ['updated', 'name', 'progress', 'due'];
const STATUSES: StatusKey[] = ['all', 'overdue', 'open', 'done'];

function readView(): ViewPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(LS_VIEW) || '{}') as Partial<ViewPrefs>;
    return {
      sort: SORTS.includes(v.sort as SortKey) ? (v.sort as SortKey) : 'updated',
      folder: typeof v.folder === 'string' ? v.folder : '',
      status: STATUSES.includes(v.status as StatusKey) ? (v.status as StatusKey) : 'all',
    };
  } catch {
    return { sort: 'updated', folder: '', status: 'all' };
  }
}
const view: ViewPrefs = readView();
function saveView(): void {
  try {
    localStorage.setItem(LS_VIEW, JSON.stringify(view));
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
}

const folderOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const pctOf = (b: BoardInfo): number => (b.cards ? b.done / b.cards : 0);
const nextDue = (b: BoardInfo): string => (b.due || []).map(dayOf).filter((d): d is string => !!d).sort()[0] || '';

/** The boards to show: the search, the folder and status filters, then the sort. */
function arrange(list: BoardInfo[], q: string): BoardInfo[] {
  const f = view.folder;
  const out = list.filter((b) => {
    if (q && !(b.title + ' ' + b.path + ' ' + b.lanes.map((l) => l.title).join(' ')).toLowerCase().includes(q)) return false;
    const dir = folderOf(b.path);
    if (f === '/' ? dir !== '' : f && dir !== f && !dir.startsWith(f + '/')) return false;
    if (view.status === 'overdue' && !dueCounts(b.due).late) return false;
    if (view.status === 'done' && !(b.cards > 0 && b.done === b.cards)) return false;
    if (view.status === 'open' && b.cards > 0 && b.done === b.cards) return false;
    return true;
  });
  const byName = (a: BoardInfo, b: BoardInfo): number => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
  if (view.sort === 'name') out.sort(byName);
  else if (view.sort === 'progress') out.sort((a, b) => pctOf(b) - pctOf(a) || b.cards - a.cards || byName(a, b));
  else if (view.sort === 'due')
    out.sort((a, b) => {
      const x = nextDue(a);
      const y = nextDue(b);
      if (x !== y) return !x ? 1 : !y ? -1 : x < y ? -1 : 1;
      return b.mtime - a.mtime;
    });
  else out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function sortSelect(): Select {
  const label: Record<SortKey, string> = { updated: t('Last updated'), name: t('Name'), progress: t('Progress'), due: t('Next due date') };
  return createSelect({
    options: SORTS.map((k) => ({ value: k, label: label[k] })),
    value: view.sort,
    label: t('Sort boards'),
    className: 'bd-sel',
    render: (o) => `${SORT_ICON}<span class="tx">${esc(o?.label || '')}</span><svg class="ui-sel-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>`,
    onChange: (v) => {
      view.sort = v as SortKey;
      saveView();
      paint();
    },
  });
}

function folderSelect(list: BoardInfo[]): Select {
  const dirs = [...new Set(list.map((b) => folderOf(b.path)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const hasRoot = list.some((b) => !folderOf(b.path));
  const options = [
    { value: '', label: t('All folders') },
    ...(hasRoot ? [{ value: '/', label: ROOT_LABEL }] : []),
    ...dirs.map((d) => ({ value: d, label: d.split('/').join(' / ') })),
  ];
  if (view.folder && !options.some((o) => o.value === view.folder)) view.folder = '';
  return createSelect({
    options,
    value: view.folder,
    label: t('Folder'),
    className: 'bd-sel',
    searchable: options.length > 8,
    render: (o) => `${I.folder}<span class="tx">${esc(o?.label || '')}</span><svg class="ui-sel-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>`,
    onChange: (v) => {
      view.folder = v;
      saveView();
      paint();
    },
  });
}

function statusSelect(): Select {
  const label: Record<StatusKey, string> = { all: t('All boards'), overdue: t('Has overdue cards'), open: t('Not done'), done: t('Done') };
  return createSelect({
    options: STATUSES.map((k) => ({ value: k, label: label[k] })),
    value: view.status,
    label: t('Show'),
    className: 'bd-sel',
    render: (o) => `<span class="tx">${esc(o?.label || '')}</span><svg class="ui-sel-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>`,
    onChange: (v) => {
      view.status = v as StatusKey;
      saveView();
      paint();
    },
  });
}

let boards: BoardInfo[] | null = null;
let failed: string | null = null;
let query = '';
let seq = 0;
let wired = false;

const host = (): HTMLElement | null => document.getElementById('view-boards');

/** Router entry: draw the page, then fetch the boards (a redraw keeps the last list until then). */
export async function renderBoards(): Promise<void> {
  useStyles('bd-css', CSS);
  wire();
  paint();
  const my = ++seq;
  try {
    const r = await apiGet<{ boards?: BoardInfo[] }>('/api/kanban/boards');
    if (my !== seq) return;
    boards = r.boards || [];
    failed = null;
  } catch (e) {
    if (my !== seq) return;
    failed = (e as Error).message;
  }
  if (state.page === 'boards') paint();
}

/** Notes change under the page (an agent, another tab): fetch again while it is shown. */
function wire(): void {
  if (wired) return;
  wired = true;
  let timer = 0;
  const again = (): void => {
    if (state.page !== 'boards') return;
    clearTimeout(timer);
    timer = window.setTimeout(() => void renderBoards(), 400);
  };
  on('mutation', again);
  // Our own writes (rename, move, Trash and its Undo) redraw the vault parts once they land.
  onRefresh(() => {
    if (state.page === 'boards') void renderBoards();
  });
}

function paint(): void {
  const h = host();
  if (!h) return;
  const searching = document.activeElement?.classList.contains('bd-q');
  const list = boards || [];
  const q = query.trim().toLowerCase();
  const shown = arrange(list, q);
  const filtered = !!view.folder || view.status !== 'all';
  const cards = list.reduce((n, b) => n + b.cards, 0);
  const sub = boards
    ? list.length
      ? `${tn(list.length, '{n} board', '{n} boards')} · ${tn(cards, '{n} card', '{n} cards')}`
      : t('No boards yet')
    : failed
      ? t('Not loaded')
      : t('Loading…');
  const newBtn = `<button type="button" class="btn primary bd-new" data-new>${I.plus}<span>${t('New board')}</span></button>`;
  let body: string;
  if (!boards && !failed) body = `<div class="bd-grid" aria-busy="true">${'<div class="sk bd-sk"></div>'.repeat(6)}</div>`;
  else if (!boards) body = `<p class="bd-none">${t('The boards could not be loaded.')} ${esc(failed || '')}</p>`;
  else if (!list.length)
    body = `<section class="bd-empty"><span class="bd-tile" aria-hidden="true">${I.board}</span><h2>${t('Plan your work on a board')}</h2>
      <p>${t('A board is a note with lanes of cards: drag cards from To do to Done, and let agents and Mnemo move them too. Boards made in Obsidian Kanban show up here as well.')}</p>${newBtn}</section>`;
  else if (!shown.length)
    body = `<p class="bd-none">${
      q && !filtered ? t('No board matches {q}.', { q: `<b>${esc(query.trim())}</b>` }) : esc(t('No board matches these filters.'))
    }${filtered ? ` <button type="button" class="btn sm bd-reset" data-reset>${esc(t('Show all boards'))}</button>` : ''}</p>`;
  else body = `<div class="bd-grid" role="list">${shown.map(cardHTML).join('')}</div>`;

  h.innerHTML = '';
  const page = el('div', 'bd');
  page.innerHTML = `<header class="bd-head"><span class="bd-tile" aria-hidden="true">${I.board}</span>
      <div class="bd-title"><h1>${t('Boards')}</h1><p>${sub}</p></div>${list.length ? newBtn : ''}</header>
    ${
      list.length > 1
        ? `<div class="bd-tbar"><label class="bd-search">${I.search}<input class="bd-q" type="search" value="${attr(query)}" placeholder="${attr(
            t('Find a board'),
          )}" aria-label="${attr(t('Find a board'))}" spellcheck="false" autocomplete="off"></label><span class="bd-sels" role="group" aria-label="${attr(
            t('Sort and filter'),
          )}"></span></div>`
        : '<div style="height:18px"></div>'
    }
    ${body}`;
  h.appendChild(page);
  page.querySelectorAll<HTMLElement>('[data-new]').forEach((b) => (b.onclick = () => nav.newBoard('')));
  const sels = page.querySelector<HTMLElement>('.bd-sels');
  if (sels) sels.append(sortSelect().el, folderSelect(list).el, statusSelect().el);
  page.querySelectorAll<HTMLElement>('[data-reset]').forEach(
    (b) =>
      (b.onclick = () => {
        view.folder = '';
        view.status = 'all';
        saveView();
        paint();
      }),
  );
  page.querySelectorAll<HTMLElement>('.bd-card[data-path]').forEach(wireCard);
  const input = page.querySelector<HTMLInputElement>('.bd-q');
  if (input) {
    input.oninput = () => {
      query = input.value;
      paint();
    };
    if (searching) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

/** A lane name as a label: a leading order number ("0 · ", "1. ", "2 - ") is dropped; the full name stays in the tooltip. */
const laneLabel = (title: string): string => title.replace(/^\s*\d+\s*[·.:)\-–—|]\s*/, '').trim() || title;

/** Up to 12 lane bars; more lanes than that fold into one last "+N lanes" bar so bars keep a usable width. */
function laneBarsHTML(b: BoardInfo): string {
  if (!b.lanes.length) return '';
  const CAP = 12;
  let lanes = b.lanes.map((l) => ({ title: l.title, label: laneLabel(l.title), cards: l.cards }));
  if (lanes.length > CAP) {
    const rest = lanes.slice(CAP - 1);
    lanes = [
      ...lanes.slice(0, CAP - 1),
      { title: rest.map((l) => l.title).join(', '), label: tn(rest.length, '+{n} lane', '+{n} lanes'), cards: rest.reduce((n, l) => n + l.cards, 0) },
    ];
  }
  const max = Math.max(1, ...lanes.map((l) => l.cards));
  const n = lanes.length;
  return `<div class="bd-lanes${n > 8 ? ' many' : ''}" data-n="${n}" aria-hidden="true">${lanes
    .map(
      (l) =>
        `<div class="bd-lane" title="${attr(`${l.title}: ${tn(l.cards, '{n} card', '{n} cards')}`)}"><div class="bd-bar${l.cards ? '' : ' zero'}" style="--h:${Math.round(
          (l.cards / max) * 100,
        )}%"></div><span class="bd-ln"><em>${l.cards}</em><span class="bd-lt" dir="auto">${esc(l.label)}</span></span></div>`,
    )
    .join('')}</div>`;
}

function cardHTML(b: BoardInfo): string {
  const folder = b.path.includes('/') ? b.path.slice(0, b.path.lastIndexOf('/')) : '';
  const folderLabel = folder ? folder.split('/').join(' / ') : ROOT_LABEL;
  const pct = b.cards ? Math.round((b.done / b.cards) * 100) : 0;
  const laneBars = laneBarsHTML(b);
  const color = b.style?.color || colorOfFolder(folder);
  const late = dueCounts(b.due).late;
  // The board's own date colour for its oldest overdue date, when it sets one.
  const oldest = (b.due || []).map(dayOf).filter((d): d is string => !!d).sort()[0];
  const rule = late && oldest ? dateColorFor(oldest, b.date_colors) : null;
  const lateStyle = rule ? [rule.color ? `color:${rule.color}` : '', rule.background ? `background:${rule.background}` : ''].filter(Boolean).join(';') : '';
  const lateChip = late
    ? `<span class="bd-late"${lateStyle ? ` style="${attr(lateStyle)}"` : ''}>${IC.cal}${esc(tn(late, '{n} overdue', '{n} overdue'))}</span>`
    : '';
  const label = [b.title, tn(b.lanes.length, '{n} lane', '{n} lanes'), t('{done} of {total} done', { done: b.done, total: b.cards }), late ? tn(late, '{n} overdue', '{n} overdue') : '']
    .filter(Boolean)
    .join(', ');
  return `<article class="bd-card" role="listitem" data-path="${attr(b.path)}" style="--fc:${attr(color)}">
    <span class="bd-top"><span class="bd-ico" aria-hidden="true">${b.style?.icon ? boardIcon(b.style.icon) : I.board}</span><span class="bd-name"><button type="button" class="bd-open" data-open="${attr(
      b.path,
    )}" aria-label="${attr(label)}" title="${attr(b.title)}"><b dir="auto">${esc(b.title)}</b></button><small title="${attr(folderLabel)}">${esc(folderLabel)}</small></span>
      <button type="button" class="vx-icon-btn bd-more" data-more aria-haspopup="menu" aria-expanded="false" aria-label="${attr(t('Board actions'))}" title="${attr(
        t('Board actions'),
      )}">${I.more}</button></span>
    ${laneBars}
    <span class="bd-prog"><span class="bd-meter"><i style="width:${pct}%"></i></span><span>${t('{done} of {total} done', { done: b.done, total: b.cards })}</span></span>
    <span class="bd-foot">${lateChip}<span>${tn(b.lanes.length, '{n} lane', '{n} lanes')}</span><span>${tn(b.cards, '{n} card', '{n} cards')}</span><span class="bd-when" title="${attr(
      fmtTs(b.mtime),
    )}">${t('Changed {when}', { when: relTs(b.mtime) })}</span></span>
  </article>`;
}

/** What can be done to a board from its card. */
function boardMenu(path: string, at: { x: number; y: number } | HTMLElement): void {
  openMenu(
    [
      { label: t('Open'), icon: I.eye, hint: 'Enter', run: () => hooks.openNote(path) },
      {
        label: t('Rename'),
        icon: I.rename,
        hint: 'F2',
        run: () => promptName(t('Rename board'), t('Board name'), noteTitle(path), (v) => void renameNote(path, v)),
      },
      { label: t('Move to…'), icon: I.move, run: () => askMoveNotes([path]) },
      { label: t('Duplicate'), icon: I.copy, run: () => void duplicateBoard(path, false).then((p) => p && void renderBoards()) },
      { label: t('Color and icon…'), icon: I.palette, run: () => void editBoardStyle(path) },
      { sep: true, label: '' },
      { label: t('Move to Trash'), icon: I.trash, hint: 'Del', danger: true, run: () => void deleteNotesToTrash([path], () => void renderBoards()) },
    ],
    at,
  );
}

/** A card opens its board on a click; ⋯, a right-click or a long press (touch) opens its menu;
 *  F2 renames and Delete trashes from the keyboard. */
function wireCard(card: HTMLElement): void {
  const path = card.dataset.path || '';
  const open = card.querySelector<HTMLElement>('.bd-open');
  const more = card.querySelector<HTMLElement>('[data-more]');
  const menu = (at: { x: number; y: number } | HTMLElement): void => {
    more?.setAttribute('aria-expanded', 'true');
    boardMenu(path, at);
    // The menu takes focus; once it is gone the button reads as closed again.
    const done = (): void => {
      if (document.querySelector('.vx-menu')) return void setTimeout(done, 250);
      more?.setAttribute('aria-expanded', 'false');
    };
    setTimeout(done, 250);
  };
  card.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-more]')) return;
    hooks.openNote(path);
  });
  more?.addEventListener('click', (e) => {
    e.stopPropagation();
    menu(more);
  });
  open?.addEventListener('keydown', (e) => {
    if (e.key === 'F2') {
      e.preventDefault();
      promptName(t('Rename board'), t('Board name'), noteTitle(path), (v) => void renameNote(path, v));
    } else if (e.key === 'Delete') {
      e.preventDefault();
      void deleteNotesToTrash([path], () => void renderBoards());
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      menu(more || card);
    }
  });
  // Long press on touch; Android also sends contextmenu for it, which then wins.
  let timer = 0;
  let sx = 0;
  let sy = 0;
  let touch = false;
  let held = false;
  const cancel = (): void => clearTimeout(timer);
  card.addEventListener('pointerdown', (e) => {
    touch = e.pointerType !== 'mouse';
    held = false;
    if (!touch || (e.target as HTMLElement).closest('[data-more]')) return;
    sx = e.clientX;
    sy = e.clientY;
    timer = window.setTimeout(() => {
      held = true;
      navigator.vibrate?.(8);
      menu({ x: sx, y: sy });
    }, 480);
  });
  card.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) card.addEventListener(ev, cancel);
  card.addEventListener(
    'click',
    (e) => {
      if (!held) return;
      held = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cancel();
    if (held) return;
    if (touch) held = true;
    menu({ x: e.clientX, y: e.clientY });
  });
}
