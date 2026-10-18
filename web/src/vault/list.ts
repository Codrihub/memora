// Folder browser: one calm column per folder. A compact header (breadcrumb,
// title, one meta line, New node / New folder), the sub folders as tiles,
// then the nodes as an even list (title, one-line excerpt, updated time, up
// to two tags). "All nodes" (the vault root) lists every node with its folder.
//
// A folder lists its own nodes; a quick filter or a list filter searches its
// sub folders too. Rows keep multi-select, drag and drop, context menus and
// keyboard navigation.

import { attr, el, esc } from '../dom';
import { fmtTs, hashColor, relTs } from '../format';
import { Modal } from '../modal';
import { state } from '../state';
import type { NoteRef } from '../types';
import { excerptOf, keepExcerpts, onExcerpt, wantExcerpt } from './excerpts';
import { I, folderGlyph } from './icons';
import { lockMark } from '../ui/privacy';
import { askMoveNotes, confirmDeleteNotes, confirmFolderMove, folderMenu, noteMenu, pinToggle } from './menus';
import { drag, endDrag, nav, startDrag } from './nav';
import { moveNotes, renameNote } from './ops';
import {
  baseName,
  dirOf,
  folderAt,
  folderColor,
  folderIcon,
  initials,
  isInside,
  isPinned,
  notesUnder,
  pinAt,
  prefs,
  savePrefs,
  selection,
  touched,
  type FolderNode,
  type ListFilter,
  type SortKey,
} from './store';
import { inlineEdit } from './ui';
import { normQuery, score, similar } from '../ui/match';

let query = '';
/** Folders or Nodes, when a folder has both (kept while browsing). */
let tab: 'nodes' | 'folders' = 'nodes';
/** Direction of the last tab switch, for the content's enter animation. */
let tabAnim: '' | 'left' | 'right' = '';
let anchor: string | null = null;
let focusPath: string | null = null;
let listHost: HTMLElement | null = null;
let observer: IntersectionObserver | null = null;

const FILTERS: { k: ListFilter; label: string }[] = [
  { k: 'all', label: 'All' },
  { k: 'agents', label: 'Agent activity' },
  { k: 'recent', label: 'Last 24 hours' },
  { k: 'pinned', label: 'Pinned' },
];

const SORTS: { k: SortKey; label: string }[] = [
  { k: 'mtime', label: 'Last updated' },
  { k: 'name', label: 'Name' },
  { k: 'folder', label: 'Folder' },
];

/** The list searches sub folders too ("All", a quick filter, a list filter). */
function deep(folder: string): boolean {
  return !folder || !!query.trim() || prefs.filter !== 'all';
}

function visibleNotes(): NoteRef[] {
  const folder = prefs.folder || '';
  let notes = deep(folder) ? notesUnder(folder) : (folderAt(folder)?.notes || []).slice();
  const now = Date.now() / 1000;
  if (prefs.filter === 'agents') notes = notes.filter((n) => touched.has(n.path));
  else if (prefs.filter === 'recent') notes = notes.filter((n) => now - (n.mtime || 0) < 86400);
  else if (prefs.filter === 'pinned') notes = notes.filter((n) => isPinned('note', n.path));
  // The same matching as the global search: the query is one string.
  const q = normQuery(query);
  if (q) {
    const rank = new Map<string, number>();
    for (const n of notes) {
      const s = score(n.name, q) || (n.path.toLowerCase().includes(q) ? 10 : 0);
      if (s) rank.set(n.path, s);
    }
    return notes.filter((n) => rank.has(n.path)).sort((a, b) => rank.get(b.path)! - rank.get(a.path)! || a.name.localeCompare(b.name));
  }
  const d = prefs.dir;
  const by: Record<SortKey, (a: NoteRef, b: NoteRef) => number> = {
    mtime: (a, b) => ((a.mtime || 0) - (b.mtime || 0)) * d,
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) * d,
    folder: (a, b) =>
      dirOf(a.path).localeCompare(dirOf(b.path)) * d || a.name.localeCompare(b.name, undefined, { numeric: true }),
  };
  if (prefs.filter === 'agents') {
    return notes.sort((a, b) => (touched.get(b.path)?.at || 0) - (touched.get(a.path)?.at || 0));
  }
  return notes.sort(by[prefs.sort]);
}

function latest(notes: NoteRef[]): number {
  return notes.reduce((m, n) => Math.max(m, n.mtime || 0), 0);
}

const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`;

/** "Did you mean" for a filter nothing matches, as the global search offers it. */
function didYouMean(folder: string): string {
  const q = normQuery(query);
  const near = notesUnder(folder)
    .map((n) => ({ n, near: similar(n.name, q) }))
    .filter((x) => x.near)
    .sort((a, b) => b.near!.s - a.near!.s)
    .slice(0, 4);
  if (!near.length) return '';
  return `<div class="vx-near"><span>Did you mean</span>${near
    .map(({ n, near: m }) => `<button type="button" class="vx-near-b" data-open="${attr(n.path)}" title="${attr(m!.why)}">${esc(n.name)}</button>`)
    .join('')}</div>`;
}

export function renderList(host: HTMLElement, mobile: boolean): void {
  listHost = host;
  const folder = prefs.folder || '';
  const f = folderAt(folder);
  const notes = visibleNotes();
  const scroller = host.querySelector<HTMLElement>('.vx-bscroll');
  const scroll = scroller?.scrollTop || 0;
  const hadFocus = host.contains(document.activeElement);
  const searchFocused = document.activeElement?.classList.contains('vx-list-q');
  const all = notesUnder(folder);
  const subs = f ? f.children : [];
  const isDeep = deep(folder);

  host.innerHTML = '';
  host.style.setProperty('--fc', folderColor(folder));
  const sc = el('div', 'vx-bscroll');
  const page = el('div', 'vx-browse' + (folder ? '' : ' is-all'));
  sc.appendChild(page);
  host.appendChild(sc);

  // Header: where am I, what is this, what can I do.
  const crumbs = folder ? folder.split('/').map((_, i, a) => a.slice(0, i + 1).join('/')) : [];
  const head = el('header', 'vx-bhead');
  const meta: string[] = [plural(all.length, 'node')];
  if (subs.length) meta.push(plural(subs.length, 'folder'));
  if (!folder && state.stats.links) meta.push(plural(state.stats.links, 'link'));
  const upd = latest(all);
  if (upd) meta.push(`<span title="${attr(fmtTs(upd))}">updated ${esc(relTs(upd))}</span>`);
  head.innerHTML = `${
    folder
      ? `<nav class="vx-crumbs" aria-label="Folder path">
      <button class="vx-icon-btn vx-up" data-f="${attr(dirOf(folder))}" aria-label="Up to ${attr(
        dirOf(folder) ? baseName(dirOf(folder)) : 'all nodes',
      )}" title="Up one folder">${I.back}</button>
      <button class="vx-crumb" data-f="">All nodes</button>${crumbs
        .slice(0, -1)
        .map(
          (c) =>
            `<span class="vx-crumb-sep" aria-hidden="true">/</span><button class="vx-crumb" data-f="${attr(c)}"><span>${esc(
              baseName(c),
            )}</span></button>`,
        )
        .join('')}</nav>`
      : ''
  }
    <div class="vx-btitle">
      <span class="vx-bico" style="color:${attr(folderColor(folder))}">${folder ? folderGlyph(folderIcon(folder), true) : I.vault}</span>
      <h1>${esc(folder ? baseName(folder) : 'All nodes')}</h1>
      ${folder ? `<button class="vx-icon-btn vx-fmenu" data-fmenu aria-label="Folder actions" title="Folder actions">${I.more}</button>` : ''}
      <span class="vx-grow"></span>
      <div class="vx-bacts">
        <button class="btn" data-new-folder title="New folder${folder ? ' in ' + attr(baseName(folder)) : ''}">${I.newFolder}<span>New folder</span></button>
        <button class="btn primary" data-new title="New node${folder ? ' in ' + attr(baseName(folder)) : ''} (N)">${I.plus}<span>New node</span></button>
      </div>
    </div>
    <p class="vx-bmeta">${meta.join('<span class="vx-dot-sep" aria-hidden="true">·</span>')}</p>`;
  page.appendChild(head);

  // Search: one full-width row of its own, always there (placed under the tabs).
  const search = el('div', 'vx-searchrow');
  search.innerHTML = `<label class="vx-search${query ? ' has' : ''}">${I.search}<input class="vx-list-q" type="search" placeholder="Search nodes…" aria-label="Search nodes${
    folder ? ' in ' + attr(baseName(folder)) : ''
  }" value="${attr(query)}" spellcheck="false" autocomplete="off"><button type="button" class="vx-search-x" aria-label="Clear the search" title="Clear">${I.close}</button></label>`;

  // A folder with sub folders: two tabs, so each list gets the whole page.
  const tabbed = subs.length > 0;
  const showTab = tabbed && !query ? tab : 'nodes';
  if (tabbed) {
    const tabs = el('div', 'vx-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.style.setProperty('--i', showTab === 'folders' ? '0' : '1');
    tabs.innerHTML = `<span class="vx-tabs-pill" aria-hidden="true"></span><button type="button" role="tab" data-tab="folders" aria-selected="${showTab === 'folders'}">${I.folder}<span>Folders</span><b>${subs.length}</b></button>
      <button type="button" role="tab" data-tab="nodes" aria-selected="${showTab === 'nodes'}">${I.note}<span>Nodes</span><b>${notes.length}</b></button>`;
    tabs.querySelectorAll<HTMLElement>('[data-tab]').forEach(
      (b) =>
        (b.onclick = () => {
          const next = b.dataset.tab as 'nodes' | 'folders';
          if (next === showTab) return;
          switchTab(host, mobile, tabs, next);
        }),
    );
    tabs.onkeydown = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = e.key === 'ArrowLeft' ? 'folders' : 'nodes';
      if (next !== showTab) switchTab(host, mobile, tabs, next);
    };
    page.appendChild(tabs);
  }
  // Tabs first (what am I looking at), then the search over it.
  page.appendChild(search);

  // Sub folders as tiles (drop targets, draggable, context menu).
  if (subs.length && showTab === 'folders') {
    const sec = el('section', 'vx-bsec vx-tabbody');
    if (tabAnim) sec.classList.add('in-' + tabAnim);
    sec.innerHTML = `<h2 class="vx-label">Folders<span>${subs.length}</span></h2>`;
    const tiles = el('div', 'vx-tiles');
    for (const c of subs) tiles.appendChild(folderTile(c));
    sec.appendChild(tiles);
    page.appendChild(sec);
  }

  // Nodes: label, quiet controls, then the list.
  const sec = el('section', 'vx-bsec vx-bsec-nodes vx-tabbody');
  if (showTab !== 'nodes') sec.hidden = true;
  else if (tabAnim) sec.classList.add('in-' + tabAnim);
  tabAnim = '';
  const tools = el('div', 'vx-ltools');
  const nAgents = countTouched(folder);
  tools.innerHTML = `<h2 class="vx-label">${
    prefs.filter === 'all' ? 'Nodes' : esc(FILTERS.find((x) => x.k === prefs.filter)?.label || 'Nodes')
  }<span>${notes.length}</span>${folder && isDeep ? '<em>including sub folders</em>' : ''}</h2>
    <span class="vx-grow"></span>
    <label class="vx-select" title="Show">${FUNNEL}<span>${esc(
      FILTERS.find((x) => x.k === prefs.filter)?.label || 'All',
    )}</span><select class="vx-filter" aria-label="Show">${FILTERS.map(
      (x) =>
        `<option value="${x.k}"${prefs.filter === x.k ? ' selected' : ''}>${x.label}${
          x.k === 'agents' && nAgents ? ` (${nAgents})` : ''
        }</option>`,
    ).join('')}</select></label>
    <label class="vx-select" title="Sort by"><span>${esc(SORTS.find((x) => x.k === prefs.sort)?.label || '')}</span><select class="vx-sort" aria-label="Sort by">${SORTS.map(
      (x) => `<option value="${x.k}"${prefs.sort === x.k ? ' selected' : ''}>${x.label}</option>`,
    ).join('')}</select></label>
    <button class="vx-icon-btn vx-dir${prefs.dir < 0 ? ' desc' : ''}" aria-label="Sort direction: ${
      prefs.dir < 0 ? 'descending' : 'ascending'
    }" title="${prefs.dir < 0 ? 'Descending' : 'Ascending'}, click to reverse">${ARROW}</button>
    ${mobile ? '' : `<button class="vx-icon-btn" data-keys aria-label="Keyboard shortcuts" title="Keyboard shortcuts">${KBD_ICON}</button>`}`;
  sec.appendChild(tools);

  if (selection.size > 1) {
    const bulk = el('div', 'vx-bulk');
    bulk.innerHTML = `<span><b>${selection.size}</b> selected</span><span class="vx-grow"></span>
      <button class="btn sm" data-bulk="move">${I.move}Move</button>
      <button class="btn sm" data-bulk="pin">${I.pin}Pin</button>
      <button class="btn sm danger" data-bulk="del">${I.trash}Delete</button>
      <button class="btn sm ghost" data-bulk="clear">Clear</button>`;
    bulk.querySelectorAll<HTMLElement>('[data-bulk]').forEach((b) => {
      b.onclick = () => {
        const paths = Array.from(selection);
        const k = b.dataset.bulk;
        if (k === 'move') askMoveNotes(paths);
        else if (k === 'pin') {
          paths.forEach((p) => pinAt({ kind: 'note', key: p }));
          nav.selectFolder(prefs.folder || '');
        } else if (k === 'del') confirmDeleteNotes(paths, () => selection.clear());
        else {
          selection.clear();
          renderList(host, mobile);
        }
      };
    });
    sec.appendChild(bulk);
  }

  const rows = el('div', 'vx-rows');
  rows.setAttribute('role', 'listbox');
  rows.setAttribute('aria-label', 'Nodes');
  rows.setAttribute('aria-multiselectable', 'true');
  if (!notes.length) {
    rows.classList.add('empty');
    rows.innerHTML = `<div class="vx-empty">${
      query
        ? `${I.search}<p>No node matches “${esc(query)}”.</p>${didYouMean(folder)}`
        : prefs.filter === 'agents'
          ? `${I.bot}<p>No agent touched a node here in this session yet.<br>Agent reads and writes show up live.</p>`
          : prefs.filter !== 'all'
            ? `${I.note}<p>Nothing here with this filter.</p><button class="btn sm" data-filter-all>Show all nodes</button>`
            : subs.length
              ? `<p>No nodes directly in this folder. Open a folder above, or start one here.</p><button class="btn sm" data-new>${I.plus}New node</button>`
              : `${I.note}<p>This folder is empty.</p><button class="btn sm primary" data-new>${I.plus}New node</button>`
    }</div>`;
  }
  const showFolder = isDeep;
  const groups = showFolder && prefs.sort === 'folder' && prefs.filter !== 'agents';
  const frag = document.createDocumentFragment();
  let lastGroup: string | null = null;
  for (const n of notes.slice(0, 1500)) {
    if (groups && dirOf(n.path) !== lastGroup) {
      lastGroup = dirOf(n.path);
      const g = el('div', 'vx-group');
      g.style.setProperty('--fc', folderColor(lastGroup));
      g.innerHTML = `<i></i>${esc(lastGroup || 'Vault root')}`;
      frag.appendChild(g);
    }
    frag.appendChild(noteRow(n, folder, notes, host, mobile, showFolder && !groups));
  }
  rows.appendChild(frag);
  sec.appendChild(rows);
  page.appendChild(sec);
  sc.scrollTop = scroll;
  watchExcerpts(rows);

  // Wiring
  head.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => {
    b.onclick = () => nav.selectFolder(b.dataset.f || '');
    wireFolderDrop(b, b.dataset.f || '');
  });
  head.querySelector<HTMLElement>('[data-fmenu]')?.addEventListener('click', (e) => {
    folderMenu(folder, e.currentTarget as HTMLElement);
  });
  host.querySelectorAll<HTMLElement>('[data-new]').forEach((b) => (b.onclick = () => nav.newNote(folder)));
  head.querySelector<HTMLElement>('[data-new-folder]')!.onclick = () => nav.newFolder(folder);
  host.querySelector<HTMLElement>('[data-filter-all]')?.addEventListener('click', () => {
    prefs.filter = 'all';
    savePrefs();
    renderList(host, mobile);
  });
  tools.querySelector<HTMLElement>('[data-keys]')?.addEventListener('click', showKeys);
  host.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => (b.onclick = () => nav.openNote(b.dataset.open || '')));
  const q = search.querySelector<HTMLInputElement>('.vx-list-q')!;
  search.querySelector<HTMLElement>('.vx-search-x')!.onclick = (e) => {
    e.preventDefault();
    query = '';
    renderList(host, mobile);
    host.querySelector<HTMLInputElement>('.vx-list-q')?.focus();
  };
  q.oninput = () => {
    query = q.value;
    renderList(host, mobile);
  };
  q.onkeydown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      rows.querySelector<HTMLElement>('.vx-note')?.focus();
    } else if (e.key === 'Escape' && q.value) {
      e.stopPropagation();
      query = '';
      renderList(host, mobile);
    }
  };
  if (searchFocused) {
    const nq = host.querySelector<HTMLInputElement>('.vx-list-q');
    nq?.focus();
    nq?.setSelectionRange(query.length, query.length);
  }
  tools.querySelector<HTMLSelectElement>('.vx-sort')!.onchange = (e) => {
    prefs.sort = (e.target as HTMLSelectElement).value as SortKey;
    prefs.dir = prefs.sort === 'mtime' ? -1 : 1;
    savePrefs();
    renderList(host, mobile);
  };
  tools.querySelector<HTMLSelectElement>('.vx-filter')!.onchange = (e) => {
    prefs.filter = (e.target as HTMLSelectElement).value as ListFilter;
    savePrefs();
    renderList(host, mobile);
  };
  tools.querySelector<HTMLElement>('.vx-dir')!.onclick = () => {
    prefs.dir = prefs.dir < 0 ? 1 : -1;
    savePrefs();
    renderList(host, mobile);
  };
  // N starts a node here (the tree has its own N).
  sc.onkeydown = (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key === 'n' || e.key === 'N') && !t.closest('.vx-note')) {
      e.preventDefault();
      nav.newNote(folder);
    }
  };

  rows.onkeydown = (e) => onRowsKey(e, rows, notes, host, mobile);
  // Roving tab stop.
  const list = Array.from(rows.querySelectorAll<HTMLElement>('.vx-note'));
  const cur = list.find((r) => r.dataset.path === focusPath) || list.find((r) => r.classList.contains('active')) || list[0];
  if (cur) cur.tabIndex = 0;
  if (hadFocus && !searchFocused && cur && focusPath === cur.dataset.path) cur.focus({ preventScroll: true });
}

/** The "opens" arrow rows and tiles show on hover and keyboard focus. */
const GO = `<span class="vx-go" aria-hidden="true"><svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>`;

/**
 * Folders | Nodes: the pill slides first, the old list fades out toward the
 * side it leaves to, then the new one slides in from the other side.
 */
function switchTab(host: HTMLElement, mobile: boolean, tabs: HTMLElement, next: 'nodes' | 'folders'): void {
  tab = next;
  if (next === 'folders') query = '';
  tabAnim = next === 'nodes' ? 'right' : 'left';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  tabs.style.setProperty('--i', next === 'folders' ? '0' : '1');
  tabs.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === next)));
  const sc = host.querySelector<HTMLElement>('.vx-bscroll');
  const body = host.querySelector<HTMLElement>('.vx-tabbody:not([hidden])');
  body?.classList.add('out-' + (next === 'nodes' ? 'left' : 'right'));
  window.setTimeout(
    () => {
      if (!host.isConnected) return;
      // Keep the tabs where they were on screen when the page was scrolled past them.
      const top = sc && tabs.offsetTop - 16 < sc.scrollTop ? tabs.offsetTop - 16 : -1;
      if (reduced) tabAnim = '';
      renderList(host, mobile);
      const nsc = host.querySelector<HTMLElement>('.vx-bscroll');
      if (nsc && top >= 0) nsc.scrollTop = top;
      host.querySelector<HTMLElement>(`.vx-tabs [data-tab=${next}]`)?.focus({ preventScroll: true });
    },
    reduced ? 0 : 140,
  );
}

const FUNNEL = `<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/></svg>`;
const ARROW = `<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>`;
const KBD_ICON = `<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8"/></svg>`;

function showKeys(): void {
  const k = (keys: string[], what: string): string =>
    `<dt>${keys.map((x) => `<kbd>${esc(x)}</kbd>`).join('')}</dt><dd>${esc(what)}</dd>`;
  Modal.open({
    title: 'Keyboard shortcuts',
    body: `<dl class="vx-keys">
      ${k(['↑', '↓'], 'Move in the tree or list')}${k(['←', '→'], 'Collapse or expand a folder')}
      ${k(['Enter'], 'Open')}${k(['N'], 'New node here')}${k(['F2'], 'Rename')}${k(['P'], 'Pin or unpin')}
      ${k(['M'], 'Move selected nodes')}${k(['Del'], 'Delete')}${k(['Ctrl', 'A'], 'Select all nodes')}
      ${k(['Shift', 'F10'], 'Context menu')}${k(['E'], 'Edit the open node')}${k(['Ctrl', 'E'], 'Switch read and edit')}
      ${k(['Esc'], 'Stop editing')}${k(['F6'], 'Next pane')}</dl>
      <p class="vx-muted">Drag nodes or folders onto a folder to move them, onto Pinned to pin them.</p>`,
    actions: [{ label: 'Close', cls: 'primary', run: () => Modal.close() }],
  });
}

function countTouched(folder: string): number {
  let n = 0;
  for (const p of touched.keys()) if (isInside(dirOf(p), folder)) n++;
  return n;
}

function folderTile(c: FolderNode): HTMLElement {
  const b = el('button', 'vx-tile');
  b.dataset.folder = c.path;
  b.style.setProperty('--fc', folderColor(c.path));
  const bits = [plural(c.total, 'node')];
  if (c.children.length) bits.push(plural(c.children.length, 'folder'));
  b.innerHTML = `<span class="vx-tile-ico">${folderGlyph(folderIcon(c.path), false)}</span>
    <span class="vx-tile-txt"><b>${esc(c.name)}${lockMark('folder', c.path)}</b><small>${bits.join(' · ')}</small></span>${GO}`;
  b.title = c.path;
  b.onclick = () => nav.selectFolder(c.path);
  b.oncontextmenu = (e) => {
    e.preventDefault();
    folderMenu(c.path, { x: e.clientX, y: e.clientY });
  };
  b.draggable = true;
  b.ondragstart = (e) => {
    startDrag(e, { kind: 'folder', path: c.path }, `${c.name} (${c.total})`);
    b.classList.add('vx-dragsrc');
  };
  b.ondragend = () => {
    b.classList.remove('vx-dragsrc');
    endDrag();
  };
  wireFolderDrop(b, c.path);
  return b;
}

function noteRow(n: NoteRef, folder: string, list: NoteRef[], host: HTMLElement, mobile: boolean, showFolder: boolean): HTMLElement {
  const row = el('div', 'vx-note');
  row.setAttribute('role', 'option');
  row.tabIndex = -1;
  row.dataset.path = n.path;
  row.dataset.m = String(Math.floor(n.mtime || 0));
  row.draggable = true;
  const active = state.note === n.path;
  const sel = selection.has(n.path);
  row.classList.toggle('active', active);
  row.classList.toggle('sel', sel);
  row.setAttribute('aria-selected', String(sel || active));
  const sub = dirOf(n.path);
  const rel = folder ? sub.slice(folder.length).replace(/^\//, '') : sub;
  const t = touched.get(n.path);
  row.style.setProperty('--fc', folderColor(sub));
  row.innerHTML = `<span class="vx-note-main">
      <span class="vx-note-l1"><span class="vx-note-name">${esc(n.name)}</span>${lockMark('node', n.path)}${
        isPinned('note', n.path) ? `<span class="vx-note-pin" title="Pinned">${I.pin}</span>` : ''
      }${
        showFolder && rel
          ? `<span class="vx-note-folder" title="${attr(sub)}"><i></i>${esc(rel)}</span>`
          : ''
      }</span>
      <span class="vx-note-ex"></span>
      <span class="vx-note-meta">${
        showFolder && rel ? `<span class="vx-note-mf"><i></i>${esc(rel)}</span>` : ''
      }<time>${esc(relTs(n.mtime))}</time><span class="vx-note-mtags"></span></span>
    </span>
    <span class="vx-note-side">
      <span class="vx-note-top">${
        t
          ? `<span class="vx-agent sm" style="--ac:${hashColor(t.actor)}" title="${attr(
              `${t.actor} · ${t.action.replace(/_/g, ' ')} · ${relTs(t.at / 1000)}`,
            )}">${esc(initials(t.actor))}</span>`
          : ''
      }<time title="${attr(fmtTs(n.mtime))}">${esc(relTs(n.mtime))}</time></span>
      <span class="vx-note-tags"></span>
    </span>
    <span class="vx-note-thumb" aria-hidden="true"></span>${GO}
    <button class="vx-row-more" tabindex="-1" aria-label="Node actions">${I.more}</button>`;
  paintExcerpt(row);

  const rename = (): void => {
    const name = row.querySelector<HTMLElement>('.vx-note-name');
    if (!name) return;
    row.draggable = false;
    void inlineEdit(name, n.name).then((v) => {
      row.draggable = true;
      if (v) void renameNote(n.path, v);
    });
  };

  row.onclick = (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.vx-row-more')) {
      e.stopPropagation();
      const paths = sel && selection.size > 1 ? Array.from(selection) : [n.path];
      noteMenu(paths, target.closest('.vx-row-more') as HTMLElement, rename);
      return;
    }
    if (target.tagName === 'INPUT') return;
    focusPath = n.path;
    if (e.shiftKey && anchor) {
      const a = list.findIndex((x) => x.path === anchor);
      const b = list.findIndex((x) => x.path === n.path);
      if (a >= 0 && b >= 0) {
        if (!(e.metaKey || e.ctrlKey)) selection.clear();
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selection.add(list[i].path);
        renderList(host, mobile);
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      if (selection.has(n.path)) selection.delete(n.path);
      else selection.add(n.path);
      anchor = n.path;
      renderList(host, mobile);
      return;
    }
    anchor = n.path;
    selection.clear();
    nav.openNote(n.path);
  };
  row.ondblclick = (e) => {
    if ((e.target as HTMLElement).closest('.vx-note-name')) {
      e.preventDefault();
      rename();
    }
  };
  row.oncontextmenu = (e) => {
    e.preventDefault();
    const paths = sel && selection.size > 1 ? Array.from(selection) : [n.path];
    noteMenu(paths, { x: e.clientX, y: e.clientY }, rename);
  };
  row.ondragstart = (e) => {
    const paths = sel && selection.size > 1 ? Array.from(selection) : [n.path];
    startDrag(e, { kind: 'notes', paths }, paths.length > 1 ? `${paths.length} nodes` : n.name);
    row.classList.add('vx-dragsrc');
  };
  row.ondragend = () => {
    row.classList.remove('vx-dragsrc');
    endDrag();
  };
  (row as HTMLElement & { _rename?: () => void })._rename = rename;
  return row;
}

/** Fill a row's excerpt and tags from the cache (a skeleton while loading). */
function paintExcerpt(row: HTMLElement): void {
  const ex = row.querySelector<HTMLElement>('.vx-note-ex');
  const tg = row.querySelector<HTMLElement>('.vx-note-tags');
  if (!ex || !tg) return;
  const e = excerptOf(row.dataset.path || '', Number(row.dataset.m) || 0);
  if (!e) {
    if (!ex.firstChild) ex.innerHTML = '<span class="vx-skel"></span>';
    return;
  }
  ex.classList.toggle('none', !e.text);
  ex.textContent = e.text || 'Empty node';
  tg.innerHTML = e.tags
    .slice(0, 2)
    .map((x) => `<span class="vx-chip-tag" style="--tc:${hashColor(x)}">#${esc(x)}</span>`)
    .join('');
  const mt = row.querySelector<HTMLElement>('.vx-note-mtags');
  if (mt) mt.innerHTML = e.tags.slice(0, 2).map((x) => `<span style="--tc:${hashColor(x)}">#${esc(x)}</span>`).join('');
  // A small thumbnail when the node has an image (hidden again if it fails to load).
  const th = row.querySelector<HTMLElement>('.vx-note-thumb');
  if (th && e.img && !th.firstChild) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    img.onerror = () => {
      img.remove();
      row.classList.remove('has-thumb');
    };
    img.src = e.img;
    th.appendChild(img);
    row.classList.add('has-thumb');
  }
}

/** Ask for excerpts of the rows that are (nearly) on screen. */
function watchExcerpts(rows: HTMLElement): void {
  observer?.disconnect();
  const want = new Set<string>();
  observer = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const r = en.target as HTMLElement;
        observer?.unobserve(r);
        const p = r.dataset.path || '';
        want.add(p);
        wantExcerpt(p, Number(r.dataset.m) || 0);
      }
      keepExcerpts(want);
    },
    { rootMargin: '300px 0px' },
  );
  rows.querySelectorAll<HTMLElement>('.vx-note').forEach((r) => {
    if (!excerptOf(r.dataset.path || '', Number(r.dataset.m) || 0)) observer!.observe(r);
  });
}

onExcerpt((path) => {
  if (!listHost || !listHost.isConnected) return;
  listHost.querySelectorAll<HTMLElement>('.vx-note').forEach((r) => {
    if (r.dataset.path === path) paintExcerpt(r);
  });
});

function onRowsKey(e: KeyboardEvent, rows: HTMLElement, list: NoteRef[], host: HTMLElement, mobile: boolean): void {
  const row = (e.target as HTMLElement).closest<HTMLElement>('.vx-note');
  if (!row || (e.target as HTMLElement).tagName === 'INPUT') return;
  const all = Array.from(rows.querySelectorAll<HTMLElement>('.vx-note'));
  const i = all.indexOf(row);
  const path = row.dataset.path || '';
  const go = (j: number): void => {
    const r = all[Math.max(0, Math.min(all.length - 1, j))];
    if (!r) return;
    all.forEach((x) => (x.tabIndex = -1));
    r.tabIndex = 0;
    r.focus();
    focusPath = r.dataset.path || null;
    if (e.shiftKey) {
      selection.add(path);
      selection.add(r.dataset.path || '');
      r.classList.add('sel');
      row.classList.add('sel');
    }
  };
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      go(i + 1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      go(i - 1);
      break;
    case 'Home':
      e.preventDefault();
      go(0);
      break;
    case 'End':
      e.preventDefault();
      go(all.length - 1);
      break;
    case 'Enter':
      e.preventDefault();
      nav.openNote(path);
      break;
    case ' ':
      e.preventDefault();
      if (selection.has(path)) selection.delete(path);
      else selection.add(path);
      focusPath = path;
      renderList(host, mobile);
      break;
    case 'a':
    case 'A':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        list.forEach((n) => selection.add(n.path));
        focusPath = path;
        renderList(host, mobile);
      }
      break;
    case 'Escape':
      if (selection.size) {
        e.preventDefault();
        selection.clear();
        renderList(host, mobile);
      }
      break;
    case 'F2':
      e.preventDefault();
      (row as HTMLElement & { _rename?: () => void })._rename?.();
      break;
    case 'Delete':
      e.preventDefault();
      confirmDeleteNotes(selection.size > 1 && selection.has(path) ? Array.from(selection) : [path], () =>
        selection.clear(),
      );
      break;
    case 'p':
    case 'P':
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        pinToggle('note', path);
      }
      break;
    case 'm':
    case 'M':
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        askMoveNotes(selection.size > 1 && selection.has(path) ? Array.from(selection) : [path]);
      }
      break;
    case 'ContextMenu':
      e.preventDefault();
      noteMenu(
        selection.size > 1 && selection.has(path) ? Array.from(selection) : [path],
        row,
        (row as HTMLElement & { _rename?: () => void })._rename,
      );
      break;
    default:
      break;
  }
}

/** Folder tiles and crumbs accept dropped notes and folders too. */
export function wireFolderDrop(b: HTMLElement, path: string): void {
  b.ondragover = (e) => {
    const d = drag.cur;
    if (!d) return;
    const ok =
      d.kind === 'notes'
        ? d.paths.some((p) => dirOf(p) !== path)
        : d.kind === 'folder'
          ? !isInside(path, d.path) && dirOf(d.path) !== path
          : false;
    if (!ok) return;
    e.preventDefault();
    b.classList.add('vx-drop-into');
  };
  b.ondragleave = () => b.classList.remove('vx-drop-into');
  b.ondrop = (e) => {
    const d = drag.cur;
    if (!d) return;
    e.preventDefault();
    endDrag();
    if (d.kind === 'notes') void moveNotes(d.paths, path);
    else if (d.kind === 'folder') confirmFolderMove(d.path, path);
  };
}

export function resetListQuery(): void {
  query = '';
  anchor = null;
}
