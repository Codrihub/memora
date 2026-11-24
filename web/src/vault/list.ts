// Folder browser: header, toolbar, active filters, sub folder tiles, then the notes as a table or grid.

import { attr, el, esc } from '../dom';
import { fmtTs, hashColor, relTs, stemTitle } from '../format';
import { t, tn } from '../i18n';
import { Modal } from '../modal';
import { noteTitle, state } from '../state';
import type { NoteRef } from '../types';
import { excerptOf, keepExcerpts, onExcerpt, wantExcerpt } from './excerpts';
import { I, folderGlyph, noteIcon } from './icons';
import { lockMark } from '../ui/privacy';
import { askMoveNotes, confirmFolderMove, deleteNotesToTrash, folderMenu, noteMenu, pinToggle } from './menus';
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
  ROOT_LABEL,
  type FolderNode,
  type ListFilter,
  type SortKey,
} from './store';
import { emptyState, inlineEdit, openMenu } from './ui';
import { openNewMenu } from './new-menu';
import { normQuery, score, similar } from '../ui/match';
import { mountSelect, type SelectOption } from '../ui/select';
import { folderImages, galleryGrid } from './images';

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
  { k: 'all', label: t('All') },
  { k: 'recent', label: t('Last 24 hours') },
  { k: 'pinned', label: t('Pinned') },
];

const SORTS: { k: SortKey; label: string }[] = [
  { k: 'mtime', label: t('Last updated') },
  { k: 'name', label: t('Name') },
  { k: 'folder', label: t('Folder') },
];

/** The list searches sub folders too ("All", a quick filter, a list filter). */
function deep(folder: string): boolean {
  return !folder || !!query.trim() || prefs.filter !== 'all';
}

function visibleNotes(): NoteRef[] {
  const folder = prefs.folder || '';
  let notes = deep(folder) ? notesUnder(folder) : (folderAt(folder)?.notes || []).slice();
  const now = Date.now() / 1000;
  if (prefs.filter === 'recent') notes = notes.filter((n) => now - (n.mtime || 0) < 86400);
  else if (prefs.filter === 'pinned') notes = notes.filter((n) => isPinned('note', n.path));
  // The same matching as the global search: the query is one string.
  const q = normQuery(query);
  if (q) {
    const rank = new Map<string, number>();
    for (const n of notes) {
      const s = Math.max(score(noteTitle(n.path), q), score(n.name, q)) || (n.path.toLowerCase().includes(q) ? 10 : 0);
      if (s) rank.set(n.path, s);
    }
    return notes.filter((n) => rank.has(n.path)).sort((a, b) => rank.get(b.path)! - rank.get(a.path)! || a.name.localeCompare(b.name));
  }
  const d = prefs.dir;
  const by: Record<SortKey, (a: NoteRef, b: NoteRef) => number> = {
    mtime: (a, b) => ((a.mtime || 0) - (b.mtime || 0)) * d,
    name: (a, b) => noteTitle(a.path).localeCompare(noteTitle(b.path), undefined, { numeric: true }) * d,
    folder: (a, b) =>
      dirOf(a.path).localeCompare(dirOf(b.path)) * d ||
      noteTitle(a.path).localeCompare(noteTitle(b.path), undefined, { numeric: true }),
  };
  return notes.sort(by[prefs.sort]);
}

function latest(notes: NoteRef[]): number {
  return notes.reduce((m, n) => Math.max(m, n.mtime || 0), 0);
}

/** "Did you mean" for a filter nothing matches, as the global search offers it. */
function didYouMean(folder: string): string {
  const q = normQuery(query);
  const near = notesUnder(folder)
    .map((n) => ({ n, near: similar(n.name, q) }))
    .filter((x) => x.near)
    .sort((a, b) => b.near!.s - a.near!.s)
    .slice(0, 4);
  if (!near.length) return '';
  return `<div class="vx-near"><span>${t('Did you mean')}</span>${near
    .map(({ n, near: m }) => `<button type="button" class="vx-near-b" data-open="${attr(n.path)}" title="${attr(m!.why)}">${esc(noteTitle(n.path))}</button>`)
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

  const crumbs = folder ? folder.split('/').map((_, i, a) => a.slice(0, i + 1).join('/')) : [];
  const head = el('header', 'vx-phead');
  const meta: string[] = [tn(all.length, '{n} note', '{n} notes')];
  if (subs.length) meta.push(tn(subs.length, '{n} folder', '{n} folders'));
  if (!folder && state.stats.links) meta.push(tn(state.stats.links, '{n} link', '{n} links'));
  const upd = latest(all);
  if (upd) meta.push(`<span title="${attr(fmtTs(upd))}">${t('updated {when}', { when: esc(relTs(upd)) })}</span>`);
  const sep = '<span class="vx-crumb-sep" aria-hidden="true">/</span>';
  head.innerHTML = `${
    folder
      ? `<nav class="vx-crumbs" aria-label="${attr(t('Folder path'))}">
      <button class="vx-icon-btn vx-up" data-f="${attr(dirOf(folder))}" aria-label="${attr(
        t('Up to {name}', { name: dirOf(folder) ? baseName(dirOf(folder)) : ROOT_LABEL }),
      )}" title="${attr(t('Up one folder'))}">${I.back}</button>
      <button class="vx-crumb" data-f="">${ROOT_LABEL}</button>${crumbs
        .slice(0, -1)
        .map((c) => `${sep}<button class="vx-crumb" data-f="${attr(c)}"><span>${esc(baseName(c))}</span></button>`)
        .join('')}${sep}<span class="vx-crumb cur" aria-current="page"><span>${esc(baseName(folder))}</span></span></nav>`
      : ''
  }
    <div class="vx-btitle">
      <span class="vx-bico${folder ? '' : ' brand'}" style="--fc:${attr(folderColor(folder))}">${
        folder ? folderGlyph(folderIcon(folder), true) : I.vault
      }</span>
      <div class="vx-btext"><h1>${esc(folder ? baseName(folder) : ROOT_LABEL)}</h1>
      <p class="vx-bmeta">${meta.join('<span class="vx-dot-sep" aria-hidden="true">·</span>')}</p></div>
      <div class="vx-bacts">
        <button class="btn ghost" data-new-folder aria-label="${attr(t('New folder'))}" title="${attr(
          folder ? t('New folder in {parent}', { parent: baseName(folder) }) : t('New folder'),
        )}">${I.newFolder}<span>${t('New folder')}</span></button>
        <button class="btn primary vx-new" data-new-menu aria-haspopup="menu" aria-label="${attr(t('New note or board'))}" title="${attr(
          t('New note or board'),
        )}">${I.plus}<span>${t('New')}</span></button>
        <button class="vx-icon-btn vx-round" data-more aria-label="${attr(folder ? t('Folder actions') : t('More'))}" title="${attr(folder ? t('Folder actions') : t('More'))}">${I.more}</button>
      </div>
    </div>`;
  page.appendChild(head);

  const tbar = el('div', 'vx-tbar');
  tbar.innerHTML = `<label class="vx-search${query ? ' has' : ''}">${I.search}<input class="vx-list-q" type="search" placeholder="${attr(t('Search notes'))}" aria-label="${attr(
    folder ? t('Search notes in {folder}', { folder: baseName(folder) }) : t('Search notes'),
  )}" value="${attr(query)}" spellcheck="false" autocomplete="off"><button type="button" class="vx-search-x" aria-label="${attr(t('Clear the search'))}" title="${attr(t('Clear'))}">${I.close}</button></label>`;

  // A folder with sub folders: two tabs, so each list gets the whole page.
  const tabbed = subs.length > 0;
  const showTab = tabbed && !query ? tab : 'nodes';
  if (tabbed) {
    const tabs = el('div', 'vx-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', t('Show'));
    tabs.style.setProperty('--i', showTab === 'folders' ? '0' : '1');
    tabs.innerHTML = `<span class="vx-tabs-pill" aria-hidden="true"></span><button type="button" role="tab" data-tab="folders" aria-selected="${showTab === 'folders'}"><span>${t('Folders')}</span><b>${subs.length}</b></button>
      <button type="button" role="tab" data-tab="nodes" aria-selected="${showTab === 'nodes'}"><span>${t('Notes')}</span><b>${notes.length}</b></button>`;
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
    tbar.appendChild(tabs);
  }
  const cards = prefs.view === 'cards';
  const gallery = prefs.view === 'gallery';
  if (showTab === 'nodes') {
    tbar.insertAdjacentHTML(
      'beforeend',
      `<span class="vx-grow"></span><div class="vx-pills" role="group" aria-label="${attr(t('Filter'))}">${FILTERS.map(
        (x) =>
          `<button type="button" class="vx-pill" data-filter="${x.k}" aria-pressed="${prefs.filter === x.k}">${esc(x.label)}</button>`,
      ).join('')}</div>
    <div class="vx-seg" role="group" aria-label="${attr(t('Layout'))}">
      <button type="button" data-view="list" aria-pressed="${!cards}" aria-label="${attr(t('List'))}" title="${attr(t('List'))}">${LIST_ICON}</button>
      <button type="button" data-view="cards" aria-pressed="${cards}" aria-label="${attr(t('Grid'))}" title="${attr(t('Grid'))}">${CARDS_ICON}</button>
      <button type="button" data-view="gallery" aria-pressed="${gallery}" aria-label="${attr(t('Images in this folder'))}" title="${attr(t('Images in this folder'))}">${I.image}</button>
    </div>`,
    );
  }
  page.appendChild(tbar);

  const chips: string[] = [];
  if (folder)
    chips.push(
      `<span class="vx-chip" style="--fc:${attr(folderColor(folder))}" title="${attr(folder)}"><i></i><span>${esc(folder)}</span><button type="button" data-x="folder" aria-label="${attr(t('Show all notes, not only {folder}', { folder: baseName(folder) }))}" title="${attr(t('Back to All notes'))}">${I.close}</button></span>`,
    );
  if (prefs.filter !== 'all')
    chips.push(
      `<span class="vx-chip"><span>${esc(FILTERS.find((x) => x.k === prefs.filter)?.label || '')}</span><button type="button" data-x="filter" aria-label="${attr(t('Remove the filter'))}" title="${attr(t('Remove the filter'))}">${I.close}</button></span>`,
    );
  if (query.trim())
    chips.push(
      `<span class="vx-chip"><span>“${esc(query.trim())}”</span><button type="button" data-x="query" aria-label="${attr(t('Clear the search'))}" title="${attr(t('Clear the search'))}">${I.close}</button></span>`,
    );
  if (chips.length) {
    const act = el('div', 'vx-active');
    act.setAttribute('aria-label', t('Showing'));
    act.innerHTML = `<span class="vx-active-k">${t('Showing')}</span>${chips.join('')}<button type="button" class="vx-active-all" data-x="all">${I.vault}<span>${t('All notes')}</span></button>`;
    page.appendChild(act);
  }

  if (subs.length && showTab === 'folders') {
    const sec = el('section', 'vx-bsec vx-tabbody');
    if (tabAnim) sec.classList.add('in-' + tabAnim);
    sec.setAttribute('aria-label', t('Folders'));
    const tiles = el('div', 'vx-tiles');
    for (const c of subs) tiles.appendChild(folderTile(c));
    sec.appendChild(tiles);
    page.appendChild(sec);
  }

  const sec = el('section', 'vx-bsec vx-bsec-nodes vx-tabbody');
  if (showTab !== 'nodes') sec.hidden = true;
  else if (tabAnim) sec.classList.add('in-' + tabAnim);
  tabAnim = '';
  const card = el('div', 'vx-lcard' + (cards ? ' is-cards' : ''));
  const tools = el('div', 'vx-ltools');
  tools.innerHTML = `<h2 class="vx-label">${
    prefs.filter === 'all' ? t('Notes') : esc(FILTERS.find((x) => x.k === prefs.filter)?.label || t('Notes'))
  }<span>${notes.length}</span>${folder && isDeep ? `<em>${t('including sub folders')}</em>` : ''}</h2>
    <span class="vx-grow"></span>
    <span data-vx-sel="sort"></span>
    <button class="vx-icon-btn vx-dir${prefs.dir < 0 ? ' desc' : ''}" aria-label="${attr(
      prefs.dir < 0 ? t('Sort direction: descending') : t('Sort direction: ascending'),
    )}" title="${attr(prefs.dir < 0 ? t('Descending, click to reverse') : t('Ascending, click to reverse'))}">${ARROW}</button>`;
  card.appendChild(tools);

  if (selection.size > 1) {
    const bulk = el('div', 'vx-bulk');
    bulk.innerHTML = `<span>${t('{n} selected', { n: `<b>${selection.size}</b>` })}</span><span class="vx-grow"></span>
      <button class="btn sm" data-bulk="move">${I.move}${t('Move')}</button>
      <button class="btn sm" data-bulk="pin">${I.pin}${t('Pin')}</button>
      <button class="btn sm danger" data-bulk="del">${I.trash}${t('Move to Trash')}</button>
      <button class="btn sm ghost" data-bulk="clear">${t('Clear')}</button>`;
    bulk.querySelectorAll<HTMLElement>('[data-bulk]').forEach((b) => {
      b.onclick = () => {
        const paths = Array.from(selection);
        const k = b.dataset.bulk;
        if (k === 'move') askMoveNotes(paths);
        else if (k === 'pin') {
          paths.forEach((p) => pinAt({ kind: 'note', key: p }));
          nav.selectFolder(prefs.folder || '');
        } else if (k === 'del') void deleteNotesToTrash(paths, () => selection.clear());
        else {
          selection.clear();
          renderList(host, mobile);
        }
      };
    });
    card.appendChild(bulk);
  }
  if (!cards && notes.length) {
    const ranked = !!normQuery(query);
    const col = (k: SortKey, label: string): string => {
      const on = !ranked && prefs.sort === k;
      return `<button type="button" data-sort="${k}" class="${on ? 'on' : ''}" aria-pressed="${on}" title="${attr(t('Sort by {name}', { name: label.toLowerCase() }))}">${label}${
        on ? `<span class="vx-th-dir${prefs.dir < 0 ? ' desc' : ''}" aria-hidden="true">${ARROW}</span>` : ''
      }</button>`;
    };
    card.insertAdjacentHTML(
      'beforeend',
      `<div class="vx-thead" role="group" aria-label="${attr(t('Sort by column'))}">${col('name', t('Title'))}${col('folder', t('Folder'))}${col('mtime', t('Updated'))}<span></span></div>`,
    );
  }

  const rows = el('div', 'vx-rows' + (cards ? ' cards' : ''));
  rows.setAttribute('role', 'listbox');
  rows.setAttribute('aria-label', t('Notes'));
  rows.setAttribute('aria-multiselectable', 'true');
  if (!notes.length) {
    rows.classList.add('empty');
    rows.innerHTML = query
      ? emptyState(I.search, t('No matches'), t('No note matches “{query}”.', { query: esc(query) }), didYouMean(folder))
      : prefs.filter !== 'all'
        ? emptyState(I.note, t('Nothing here'), t('No note here matches this filter.'), `<button class="btn sm" data-filter-all>${t('Show all notes')}</button>`)
        : subs.length
          ? emptyState(
              I.folder,
              t('No notes in this folder'),
              t('Its notes are in its folders. You can also start one here.'),
              `<button class="btn sm primary" data-new>${I.plus}${t('New note')}</button><button class="btn sm" data-new-board>${I.board}${t('New board')}</button>`,
            )
          : folder
            ? emptyState(I.note, t('This folder is empty'), t('Start the first note in it.'), `<button class="btn sm primary" data-new>${I.plus}${t('New note')}</button><button class="btn sm" data-new-board>${I.board}${t('New board')}</button>`)
            : emptyState(
                I.note,
                t('No notes yet'),
                t('A note is a page of text you and your AI agents can read and add to.'),
                `<button class="btn sm primary" data-new>${I.plus}${t('New note')}</button><button class="btn sm" data-new-board>${I.board}${t('New board')}</button>`,
              );
  }
  const groups = isDeep && prefs.sort === 'folder' && !cards;
  const frag = document.createDocumentFragment();
  let lastGroup: string | null = null;
  for (const n of notes.slice(0, 1500)) {
    if (groups && dirOf(n.path) !== lastGroup) {
      lastGroup = dirOf(n.path);
      const g = el('div', 'vx-group');
      g.style.setProperty('--fc', folderColor(lastGroup));
      g.innerHTML = `<i></i>${esc(lastGroup || ROOT_LABEL)}`;
      frag.appendChild(g);
    }
    frag.appendChild(noteRow(n, folder, notes, host, mobile));
  }
  const add =
    notes.length && !query && prefs.filter === 'all'
      ? `<div class="vx-addrows"><button type="button" class="vx-addrow" data-new>${I.plus}<span>${folder ? t('New note in {folder}', { folder: esc(baseName(folder)) }) : t('New note')}</span></button><button type="button" class="vx-addrow" data-new-board>${I.board}<span>${
          folder ? t('New board in {folder}', { folder: esc(baseName(folder)) }) : t('New board')
        }</span></button></div>`
      : '';
  rows.appendChild(frag);
  if (add && cards) rows.insertAdjacentHTML('beforeend', add);
  card.appendChild(rows);
  if (add && !cards) card.insertAdjacentHTML('beforeend', add);
  sec.appendChild(card);
  if (gallery && showTab === 'nodes') {
    sec.hidden = true;
    page.appendChild(gallerySection(folder));
  }
  page.appendChild(sec);
  sc.scrollTop = scroll;
  // The table shows no excerpts: only grid cards ask the server for them.
  if (cards) watchExcerpts(rows, sc);
  else observer?.disconnect();

  head.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => {
    b.onclick = () => nav.selectFolder(b.dataset.f || '');
    wireFolderDrop(b, b.dataset.f || '');
  });
  head.querySelector<HTMLElement>('[data-more]')!.onclick = (e) => {
    const at = e.currentTarget as HTMLElement;
    const keys = mobile ? [] : [{ sep: true, label: '' }, { label: t('Keyboard shortcuts'), icon: KBD_ICON, run: showKeys }];
    if (folder) folderMenu(folder, at, undefined, keys);
    else
      openMenu(
        [
          { label: t('New folder'), icon: I.newFolder, run: () => nav.newFolder('') },
          { label: t('Trash'), icon: I.trash, run: () => nav.openTrash() },
          ...keys,
        ],
        at,
      );
  };
  host.querySelectorAll<HTMLElement>('[data-new]').forEach((b) => (b.onclick = () => nav.newNote(folder)));
  host.querySelectorAll<HTMLElement>('[data-new-board]').forEach((b) => (b.onclick = () => nav.newBoard(folder)));
  head.querySelector<HTMLElement>('[data-new-menu]')?.addEventListener('click', (e) => openNewMenu(e.currentTarget as HTMLElement, folder));
  head.querySelector<HTMLElement>('[data-new-folder]')!.onclick = () => nav.newFolder(folder);
  host.querySelector<HTMLElement>('[data-filter-all]')?.addEventListener('click', () => {
    prefs.filter = 'all';
    savePrefs();
    renderList(host, mobile);
  });
  tbar.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) => {
    b.onclick = () => {
      prefs.filter = b.dataset.filter as ListFilter;
      savePrefs();
      renderList(host, mobile);
    };
  });
  tbar.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => {
    b.onclick = () => {
      prefs.view = b.dataset.view === 'cards' ? 'cards' : b.dataset.view === 'gallery' ? 'gallery' : 'list';
      savePrefs();
      renderList(host, mobile);
    };
  });
  host.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => (b.onclick = () => nav.openNote(b.dataset.open || '')));
  page.querySelectorAll<HTMLElement>('.vx-active [data-x]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.x;
      if (k === 'query') {
        query = '';
        renderList(host, mobile);
        host.querySelector<HTMLInputElement>('.vx-list-q')?.focus();
        return;
      }
      if (k === 'filter' || k === 'all') {
        prefs.filter = 'all';
        savePrefs();
      }
      if (k === 'folder' || k === 'all') nav.selectFolder('');
      else renderList(host, mobile);
    };
  });
  card.querySelectorAll<HTMLElement>('.vx-thead [data-sort]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.sort as SortKey;
      if (normQuery(query)) query = '';
      if (prefs.sort === k) prefs.dir = prefs.dir < 0 ? 1 : -1;
      else {
        prefs.sort = k;
        prefs.dir = k === 'mtime' ? -1 : 1;
      }
      savePrefs();
      renderList(host, mobile);
      host.querySelector<HTMLElement>(`.vx-thead [data-sort=${k}]`)?.focus();
    };
  });
  const q = tbar.querySelector<HTMLInputElement>('.vx-list-q')!;
  tbar.querySelector<HTMLElement>('.vx-search-x')!.onclick = (e) => {
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
  const label = (o: SelectOption | undefined): string => `<span>${esc(o?.label || '')}</span>`;
  mountSelect(tools.querySelector('[data-vx-sel=sort]'), {
    label: t('Sort by'),
    className: 'vx-select',
    align: 'end',
    minWidth: 160,
    value: prefs.sort,
    options: SORTS.map((x) => ({ value: x.k, label: x.label })),
    render: label,
    onChange: (v) => {
      prefs.sort = v as SortKey;
      prefs.dir = prefs.sort === 'mtime' ? -1 : 1;
      savePrefs();
      renderList(host, mobile);
    },
  }).el.title = t('Sort by');
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
    } else if ((e.key === 'b' || e.key === 'B') && !t.closest('.vx-note')) {
      e.preventDefault();
      nav.newBoard(folder);
    }
  };

  rows.onkeydown = (e) => onRowsKey(e, rows, notes, host, mobile);
  const list = Array.from(rows.querySelectorAll<HTMLElement>('.vx-note'));
  const cur = list.find((r) => r.dataset.path === focusPath) || list.find((r) => r.classList.contains('active')) || list[0];
  if (cur) cur.tabIndex = 0;
  if (hadFocus && !searchFocused && cur && focusPath === cur.dataset.path) cur.focus({ preventScroll: true });
}

/** The "opens" arrow rows and tiles show on hover and keyboard focus. */
const GO = `<span class="vx-go" aria-hidden="true"><svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>`;

/** Folders | Notes: the old list fades out toward the side it leaves, then the new one renders. */
/** The images of the open folder only (never its sub folders or parents). */
function gallerySection(folder: string): HTMLElement {
  const sec = el('section', 'vx-bsec vx-galsec');
  sec.setAttribute('aria-label', t('Images'));
  sec.innerHTML = `<div class="vx-galhead"><h2 class="vx-label">${t('Images')}<span data-n></span></h2><em>${esc(
    folder ? t('In {folder} only, not its sub folders', { folder: baseName(folder) }) : t('At the top level only, not inside folders'),
  )}</em></div><div class="vx-galbody"><p class="vx-muted">${t('Loading the images…')}</p></div>`;
  const body = sec.querySelector<HTMLElement>('.vx-galbody')!;
  const load = (): void => {
    folderImages(folder).then(
      (r) => {
        sec.querySelector('[data-n]')!.textContent = String(r.images.length);
        body.replaceChildren(
          galleryGrid(r.images, t('No images here yet. Add one while editing a note: the Image button, paste or drop.'), load),
        );
      },
      (e: Error) => (body.innerHTML = `<p class="vx-muted">${t('Could not load the images: {error}', { error: esc(e.message) })}</p>`),
    );
  };
  load();
  return sec;
}

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

const LIST_ICON = `<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>`;
const CARDS_ICON = `<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>`;
const ARROW = `<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>`;
const KBD_ICON = `<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8"/></svg>`;

function showKeys(): void {
  const k = (keys: string[], what: string): string =>
    `<dt>${keys.map((x) => `<kbd>${esc(x)}</kbd>`).join('')}</dt><dd>${esc(what)}</dd>`;
  Modal.open({
    title: t('Keyboard shortcuts'),
    body: `<dl class="vx-keys">
      ${k(['↑', '↓'], t('Move in the tree or list'))}${k(['←', '→'], t('Collapse or expand a folder'))}
      ${k(['Enter'], t('Open'))}${k(['N'], t('New note here'))}${k(['B'], t('New board here'))}${k(['F2'], t('Rename'))}${k(['P'], t('Pin or unpin'))}
      ${k(['M'], t('Move selected notes'))}${k(['Del'], t('Move to Trash'))}${k(['Ctrl', 'A'], t('Select all notes'))}
      ${k(['Shift', 'F10'], t('Context menu'))}${k(['E'], t('Edit the open note'))}${k(['Ctrl', 'E'], t('Switch read and edit'))}
      ${k(['Esc'], t('Stop editing (asks before dropping changes)'))}${k(['Ctrl', 'S'], t('Save'))}${k(['F6'], t('Next pane'))}</dl>
      <p class="vx-muted">${t('Drag notes or folders onto a folder to move them, onto Pinned to pin them.')}</p>`,
    actions: [{ label: t('Close'), cls: 'primary', run: () => Modal.close() }],
  });
}

function folderTile(c: FolderNode): HTMLElement {
  const b = el('button', 'vx-tile');
  b.dataset.folder = c.path;
  b.style.setProperty('--fc', folderColor(c.path));
  const bits = [tn(c.total, '{n} note', '{n} notes')];
  if (c.children.length) bits.push(tn(c.children.length, '{n} folder', '{n} folders'));
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

/** A folder cell: colour dot, then the path; a long path is cut at its start, never at the name. */
function folderPath(sub: string, rel: string): string {
  const shown = rel || (sub ? baseName(sub) : ROOT_LABEL);
  const cut = shown.lastIndexOf('/');
  const pre = cut > 0 ? `<span class="vx-fp-pre">${esc(shown.slice(0, cut))}</span><span class="vx-fp-sep" aria-hidden="true">/</span>` : '';
  return `<span class="vx-note-folder" title="${attr(sub || ROOT_LABEL)}"><i></i>${pre}<span class="vx-fp-leaf">${esc(shown.slice(cut + 1))}</span></span>`;
}

type RenameRow = HTMLElement & { _rename?: () => void };

function noteRow(n: NoteRef, folder: string, list: NoteRef[], host: HTMLElement, mobile: boolean): HTMLElement {
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
  const tc = touched.get(n.path);
  row.style.setProperty('--fc', folderColor(sub));
  const lock = lockMark('node', n.path);
  const pin = isPinned('note', n.path) ? `<span class="vx-note-pin" title="${attr(t('Pinned'))}">${I.pin}</span>` : '';
  const when = `<time title="${attr(fmtTs(n.mtime))}">${esc(relTs(n.mtime))}</time>`;
  const by = tc
    ? `<span class="vx-agent sm" style="--ac:${hashColor(tc.actor)}" title="${attr(
        `${tc.actor} · ${tc.action.replace(/_/g, ' ')} · ${relTs(tc.at / 1000)}`,
      )}">${esc(initials(tc.actor))}</span>`
    : '';
  const more = `<button class="vx-row-more" tabindex="-1" aria-label="${attr(t('Note actions'))}" title="${attr(t('Actions'))}">${I.more}</button>`;
  const lead = `<span class="vx-note-lead" aria-hidden="true">${noteIcon(n.path)}<span class="vx-note-thumb"></span></span>`;
  const place = folderPath(sub, rel);
  if (prefs.view === 'cards') {
    row.classList.add('card');
    row.innerHTML = `<span class="vx-card-top">${lead}<span class="vx-note-name">${esc(noteTitle(n.path))}</span>${lock}${pin}${more}</span>
      <span class="vx-note-ex"></span>
      <dl class="vx-props">
        <dt>${t('Folder')}</dt><dd>${folderPath(sub, sub)}</dd>
        <dt>${t('Tags')}</dt><dd class="vx-note-tags"><span class="vx-none">${t('None')}</span></dd>
        <dt>${t('Updated')}</dt><dd>${when}</dd>
        ${tc ? `<dt>${t('By')}</dt><dd>${by}<span>${esc(tc.actor)}</span></dd>` : ''}
      </dl>`;
  } else {
    // A table row on wide screens, stacked on phones.
    const leaf = sub ? baseName(sub) : ROOT_LABEL;
    row.innerHTML = `${lead}<span class="vx-note-main">
      <span class="vx-note-l1"><span class="vx-note-name">${esc(noteTitle(n.path))}</span>${lock}${pin}</span>
      <span class="vx-note-meta"><span class="vx-note-mf" title="${attr(sub || ROOT_LABEL)}"><i></i><span>${esc(leaf)}</span></span><time title="${attr(fmtTs(n.mtime))}">${esc(relTs(n.mtime))}</time>${by}</span>
    </span><span class="vx-note-fcol">${place}</span>
    <span class="vx-note-top">${by}${when}</span>${more}`;
  }
  paintExcerpt(row);

  const rename = (): void => {
    const name = row.querySelector<HTMLElement>('.vx-note-name');
    if (!name) return;
    row.draggable = false;
    void inlineEdit(name, stemTitle(n.name)).then((v) => {
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
    startDrag(e, { kind: 'notes', paths }, paths.length > 1 ? tn(paths.length, '{n} note', '{n} notes') : noteTitle(n.path));
    row.classList.add('vx-dragsrc');
  };
  row.ondragend = () => {
    row.classList.remove('vx-dragsrc');
    endDrag();
  };
  (row as RenameRow)._rename = rename;
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
  ex.textContent = e.text || t('Empty note');
  // Only grid cards have an excerpt and tags, so a row that gets here is a card.
  const shown = e.tags.slice(0, 3);
  if (shown.length) tg.innerHTML = shown.map((x) => `<span class="vx-chip-tag" style="--tc:${hashColor(x)}"><i></i>${esc(x)}</span>`).join('');
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

/** Ask for excerpts of rows (nearly) on screen; rows that scroll away drop their queued request so on-screen rows never wait behind them. */
function watchExcerpts(rows: HTMLElement, scroller: HTMLElement): void {
  observer?.disconnect();
  const onScreen = new Set<string>();
  observer = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const r = en.target as HTMLElement;
        const p = r.dataset.path || '';
        if (!en.isIntersecting) {
          onScreen.delete(p);
          continue;
        }
        if (excerptOf(p, Number(r.dataset.m) || 0)) {
          observer?.unobserve(r);
          continue;
        }
        onScreen.add(p);
        wantExcerpt(p, Number(r.dataset.m) || 0);
      }
      keepExcerpts(onScreen);
    },
    // Measure against the list's own scroll box so the margin preloads the next rows.
    { root: scroller, rootMargin: '300px 0px' },
  );
  rows.querySelectorAll<HTMLElement>('.vx-note').forEach((r) => {
    if (!excerptOf(r.dataset.path || '', Number(r.dataset.m) || 0)) observer!.observe(r);
  });
}

onExcerpt((path) => {
  if (!listHost || !listHost.isConnected) return;
  listHost.querySelectorAll<HTMLElement>('.vx-note').forEach((r) => {
    if (r.dataset.path !== path) return;
    paintExcerpt(r);
    if (excerptOf(path, Number(r.dataset.m) || 0)) observer?.unobserve(r);
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
      (row as RenameRow)._rename?.();
      break;
    case 'Delete':
      e.preventDefault();
      void deleteNotesToTrash(selection.size > 1 && selection.has(path) ? Array.from(selection) : [path], () =>
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
        (row as RenameRow)._rename,
      );
      break;
    default:
      break;
  }
}

/** Folder tiles and crumbs accept dropped notes and folders too. */
function wireFolderDrop(b: HTMLElement, path: string): void {
  // Pointer drags from the tree find it by this (TreeView.targetAt).
  b.dataset.dropFolder = path;
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

/** Back to the plain list ("Notes" in the menu): the Notes tab, no search. */
export function resetListView(): void {
  resetListQuery();
  tab = 'nodes';
}
