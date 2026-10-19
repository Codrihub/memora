// Folder tree with the pinned section. One component, mounted in the vault
// view (folders only) and, through mountTree(), in the shell sidebar (folders
// and notes).
//
// Features: animated expand/collapse, folder color/icon and recursive counts,
// drag and drop (notes and folders into folders, anything into Pinned, pin
// reordering) with drop indicators and hover auto-expand, inline rename (F2 or
// double click), context menus, full keyboard navigation (ARIA tree).

import { el, esc, attr } from '../dom';
import { noteName } from '../format';
import { state } from '../state';
import type { NoteRef } from '../types';
import { I, folderGlyph } from './icons';
import { lockMark } from '../ui/privacy';
import { confirmDeleteFolder, confirmDeleteNotes, confirmFolderMove, confirmUnpin, folderMenu, noteMenu, pinToggle } from './menus';
import { drag, endDrag, nav, startDrag } from './nav';
import { moveNotes, renameFolder, renameNote } from './ops';
import {
  baseName,
  dirOf,
  folderAt,
  folderColor,
  folderIcon,
  folderTree,
  isInside,
  onPinsSynced,
  openFolders,
  pinAt,
  pinnedItems,
  prefs,
  saveOpen,
  selection,
  agentsAt,
  unpin,
  type FolderNode,
  type PinItem,
} from './store';
import { coinsHTML } from './coins';
import { inlineEdit, undoToast } from './ui';

export interface TreeOptions {
  /** List notes under their folder (sidebar). */
  showNotes: boolean;
  /** Show the Pinned section. */
  showPins: boolean;
}

const instances = new Set<TreeView>();

/** Pinned and Folders fold like an accordion (remembered per device). */
const LS_SECS = 'memora.vault.sections.v1';
const secOpen: { pins: boolean; folders: boolean } = (() => {
  try {
    return { pins: true, folders: true, ...JSON.parse(localStorage.getItem(LS_SECS) || '{}') };
  } catch {
    return { pins: true, folders: true };
  }
})();

function setSections(next: Partial<typeof secOpen>): void {
  Object.assign(secOpen, next);
  try {
    localStorage.setItem(LS_SECS, JSON.stringify(secOpen));
  } catch {
    /* private mode */
  }
  paintSections();
  announceSections();
}

/** Fold or unfold the section bodies in place, so the change animates. */
function paintSections(): void {
  for (const [cls, open] of [
    ['.vx-pins', secOpen.pins],
    ['.vx-folders', secOpen.folders],
  ] as const) {
    document.querySelectorAll<HTMLElement>(cls).forEach((sec) => {
      sec.classList.toggle('folded', !open);
      sec.querySelector('.vx-fold')?.setAttribute('aria-expanded', String(open));
      const body = sec.querySelector<HTMLElement>('.vx-sec-body');
      if (body) body.inert = !open;
    });
  }
}

/** Tell the sidebar's Library button whether anything is open. */
function announceSections(): void {
  window.dispatchEvent(new CustomEvent('memora:sections', { detail: { anyOpen: secOpen.pins || secOpen.folders } }));
}

// The Library button: close both sections, or open both when both are closed.
window.addEventListener('memora:sections-toggle', () => {
  const anyOpen = secOpen.pins || secOpen.folders;
  setSections({ pins: !anyOpen, folders: !anyOpen });
});
window.addEventListener('memora:sections-ask', () => announceSections());

/** A group of rows one level down; `--gx` places its branch line under the
 * parent's chevron (rows indent 14px per level, see .vx-row). */
function branchGroup(depth: number): HTMLElement {
  const g = el('div', 'vx-kids-inner');
  g.style.setProperty('--gx', depth * 14 + 'px');
  return g;
}

/** Two chevrons meeting in the middle: close every open subfolder. */
const FOLD_ALL =
  '<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m7 4 5 5 5-5M7 20l5-5 5 5"/></svg>';

/** The foldable part of a section (animated open and closed). */
function foldBody(content: HTMLElement, open: boolean): HTMLElement {
  const body = el('div', 'vx-sec-body');
  const inner = el('div', 'vx-sec-inner');
  inner.appendChild(content);
  body.appendChild(inner);
  body.inert = !open;
  return body;
}

/** A section title that folds its body (Enter / Space too). */
function foldable(head: HTMLElement, open: boolean, toggle: () => void): void {
  head.setAttribute('role', 'button');
  head.tabIndex = 0;
  head.setAttribute('aria-expanded', String(open));
  head.onclick = (e) => {
    if ((e.target as HTMLElement).closest('.vx-sec-acts')) return;
    toggle();
  };
  head.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  };
}

// The sidebar opened (rail expanded, phone drawer): start from all folders closed.
window.addEventListener('memora:collapse-folders', () => {
  if (!openFolders.size) return;
  openFolders.clear();
  saveOpen();
  refreshTrees();
});

// Row motion between redraws -------------------------------------------------
//
// A redraw replaces the rows. Compared by data-key with the rows before it:
// new rows (a new node, or a renamed one under its new name) slide in with a
// short highlight, rows that shifted glide from where they were, and rows
// that went away fade and slide out where they stood. Only rows on screen
// (at the root or in an open folder) take part; bulk changes (opening a
// folder, a vault switch) and reduced motion skip it.

interface Was {
  top: number;
  height: number;
  el: HTMLElement;
}

function visibleRows(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('[data-key]')).filter((r) => r.offsetParent !== null && r.offsetHeight > 0);
}

function snapshot(host: HTMLElement): Map<string, Was> {
  const m = new Map<string, Was>();
  for (const r of visibleRows(host)) {
    const b = r.getBoundingClientRect();
    m.set(r.dataset.key!, { top: b.top, height: b.height, el: r });
  }
  return m;
}

const EASE = 'cubic-bezier(.2,.8,.2,1)';

function animateChanges(host: HTMLElement, before: Map<string, Was>): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !before.size) return;
  const rows = visibleRows(host);
  const now = new Set(rows.map((r) => r.dataset.key!));
  const added = rows.filter((r) => !before.has(r.dataset.key!));
  const gone = Array.from(before.entries()).filter(([k]) => !now.has(k));
  if (added.length > 12 || gone.length > 12) return;
  // Shifted rows glide from their old place.
  for (const r of rows) {
    const was = before.get(r.dataset.key!);
    if (!was) continue;
    const dy = was.top - r.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 280, easing: EASE });
  }
  // New rows come in: open up, slide from the left, a short accent glow.
  for (const r of added) {
    r.animate(
      [
        { opacity: 0, transform: 'translateX(-10px)', backgroundColor: 'var(--accent-soft)' },
        { opacity: 1, transform: 'none', backgroundColor: 'var(--accent-soft)', offset: 0.45 },
        { opacity: 1, transform: 'none', backgroundColor: 'transparent' },
      ],
      { duration: 900, easing: EASE },
    );
  }
  // Rows that went away: a ghost where they stood fades and slides out.
  if (!gone.length) return;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const hb = host.getBoundingClientRect();
  for (const [, was] of gone) {
    const ghost = was.el;
    ghost.removeAttribute('data-key');
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      top: was.top - hb.top + host.scrollTop + 'px',
      height: was.height + 'px',
      pointerEvents: 'none',
      zIndex: '1',
    });
    host.appendChild(ghost);
    const a = ghost.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateX(-24px)' },
      ],
      { duration: 320, easing: 'ease-in', fill: 'forwards' },
    );
    a.onfinish = () => ghost.remove();
  }
}

/** While a branch opens or closes, redraws wait so the animation plays out. */
let animatingUntil = 0;
let redrawLater = 0;

/** Redraw every mounted tree (and its pins). */
export function refreshTrees(): void {
  const wait = animatingUntil - performance.now();
  if (wait > 0) {
    clearTimeout(redrawLater);
    redrawLater = window.setTimeout(refreshTrees, wait + 20);
    return;
  }
  for (const t of Array.from(instances)) {
    if (!t.host.isConnected) instances.delete(t);
    else t.render();
  }
}

export class TreeView {
  host: HTMLElement;
  opts: TreeOptions;
  private hoverTimer = 0;
  private hoverPath: string | null = null;
  private focusKey: string | null = null;
  /** Drawn at least once (the first draw does not animate). */
  private drawn = false;

  constructor(host: HTMLElement, opts: TreeOptions) {
    this.host = host;
    this.opts = opts;
    host.classList.add('vx-treehost');
    instances.add(this);
    this.render();
  }

  destroy(): void {
    instances.delete(this);
    this.host.innerHTML = '';
  }

  render(): void {
    const scroll = this.host.scrollTop;
    const active = document.activeElement as HTMLElement | null;
    if (active && this.host.contains(active) && active.dataset.key) this.focusKey = active.dataset.key;
    const before = this.drawn ? snapshot(this.host) : null;
    this.host.innerHTML = '';
    if (this.opts.showPins) this.host.appendChild(this.pinSection());
    this.host.appendChild(this.folderSection());
    this.host.scrollTop = scroll;
    if (before) animateChanges(this.host, before);
    this.drawn = true;
    // Keep keyboard focus across redraws.
    const keyed = this.focusKey
      ? this.host.querySelector<HTMLElement>(`[data-key="${CSS.escape(this.focusKey)}"]`)
      : null;
    if (keyed && active && this.host.contains(active) === false && document.activeElement === document.body) keyed.focus();
    this.roving();
  }

  // ---------------------------------------------------------------- pins

  private pinSection(): HTMLElement {
    const items = pinnedItems();
    const sec = el('section', 'vx-sec vx-pins');
    sec.classList.toggle('folded', !secOpen.pins);
    sec.innerHTML = `<header class="vx-sec-head vx-fold"><span class="vx-sec-title">${I.pin}<span>Pinned</span><span class="vx-sec-count">${items.length}</span></span><span class="vx-fold-caret">${I.caret}</span></header>`;
    foldable(sec.querySelector('header')!, secOpen.pins, () => setSections({ pins: !secOpen.pins }));
    // The pins branch off the title; the drop slot always shows under them
    // (right under the title while the list is folded), so Pinned clearly
    // takes drags.
    const list = el('div', 'vx-pin-list');
    list.setAttribute('role', 'list');
    items.forEach((it, i) => list.appendChild(this.pinRow(it, i)));
    sec.appendChild(foldBody(list, secOpen.pins));
    sec.appendChild(
      el('div', 'vx-pin-empty' + (items.length ? ' slim' : ''), items.length ? `${I.pin}Drop here to pin` : 'Drag nodes or folders here to pin them'),
    );

    // Drop: pin a dragged note/folder, or reorder a pin.
    const indexAt = (y: number): number => {
      const rows = Array.from(list.querySelectorAll<HTMLElement>('.vx-pin'));
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) return i;
      }
      return rows.length;
    };
    const mark = (y: number): void => {
      const rows = Array.from(list.querySelectorAll<HTMLElement>('.vx-pin'));
      rows.forEach((r) => r.classList.remove('vx-drop-before', 'vx-drop-after'));
      const i = indexAt(y);
      if (rows.length) {
        if (i < rows.length) rows[i].classList.add('vx-drop-before');
        else rows[rows.length - 1].classList.add('vx-drop-after');
      }
    };
    sec.ondragover = (e) => {
      if (!drag.cur) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = drag.cur.kind === 'pin' ? 'move' : 'link';
      sec.classList.add('vx-drop-zone');
      mark(e.clientY);
    };
    sec.ondragleave = (e) => {
      if (!sec.contains(e.relatedTarget as Node)) {
        sec.classList.remove('vx-drop-zone');
        sec.querySelectorAll('.vx-drop-before,.vx-drop-after').forEach((n) =>
          n.classList.remove('vx-drop-before', 'vx-drop-after'),
        );
      }
    };
    sec.ondrop = (e) => {
      const d = drag.cur;
      if (!d) return;
      e.preventDefault();
      const at = indexAt(e.clientY);
      endDrag();
      if (d.kind === 'pin') {
        const cur = pinnedItems().findIndex((p) => p.kind === d.item.kind && p.key === d.item.key);
        pinAt(d.item, cur >= 0 && cur < at ? at - 1 : at);
      } else if (d.kind === 'notes') {
        d.paths.forEach((p, k) => pinAt({ kind: 'note', key: p }, at + k));
      } else {
        pinAt({ kind: 'folder', key: d.path }, at);
      }
    };
    return sec;
  }

  private pinRow(it: PinItem, i: number): HTMLElement {
    const isNote = it.kind === 'note';
    // The server says when a pinned path is gone (renamed or deleted outside
    // Memora): the pin stays, dimmed, until it is removed.
    const missing = !!it.missing;
    const row = el('div', 'vx-pin' + (missing ? ' missing' : ''));
    row.setAttribute('role', 'listitem');
    row.tabIndex = -1;
    row.dataset.key = 'pin:' + it.kind + ':' + it.key;
    row.dataset.nav = '1';
    row.draggable = true;
    const color = isNote ? folderColor(dirOf(it.key)) : folderColor(it.key);
    const active = isNote ? state.note === it.key : prefs.folder === it.key && state.page === 'vault' && !state.note;
    if (active) row.classList.add('active');
    const label = isNote ? noteName(it.key) : baseName(it.key);
    const sub = missing
      ? `<span class="vx-pin-sub vx-pin-miss">Not found</span>`
      : isNote
        ? ''
        : `<span class="vx-pin-sub">${esc(dirOf(it.key) || '')}</span>`;
    row.innerHTML = `<span class="vx-pin-ico" style="color:${attr(color)}">${
      isNote ? I.note : folderGlyph(folderIcon(it.key), false)
    }</span><span class="vx-pin-name" title="${attr(missing ? it.key + ' (not found)' : it.key)}">${esc(label)}</span>${sub}<button class="vx-pin-x" aria-label="${
      missing ? 'Remove pin' : 'Unpin'
    } ${attr(label)}" title="${missing ? 'Remove pin' : 'Unpin'}">${I.close}</button>`;
    const open = (): void => {
      if (missing) return;
      if (isNote) nav.openNote(it.key);
      else nav.selectFolder(it.key);
    };
    row.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.vx-pin-x')) return;
      open();
    };
    // A missing pin goes at once (with undo): there is nothing left to keep.
    const ask = (): void => {
      if (!missing) {
        confirmUnpin(it, () => {});
        return;
      }
      unpin(it);
      undoToast(`Removed the pin of "${label}"`, () => pinAt(it, i), 'info', 4000);
    };
    row.querySelector<HTMLButtonElement>('.vx-pin-x')!.onclick = (e) => {
      e.stopPropagation();
      ask();
    };
    row.onkeydown = (e) => {
      if (e.key === 'Enter') open();
      else if (e.key === 'Delete' || e.key === 'Backspace') ask();
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey) {
        // Alt+Up/Down reorders pins from the keyboard.
        e.preventDefault();
        e.stopPropagation();
        this.focusKey = row.dataset.key || null;
        pinAt(it, i + (e.key === 'ArrowUp' ? -1 : 1));
        this.host.querySelector<HTMLElement>(`[data-key="${CSS.escape(row.dataset.key || '')}"]`)?.focus();
      }
    };
    row.ondragstart = (e) => {
      startDrag(e, { kind: 'pin', id: row.dataset.key || '', item: it }, isNote ? noteName(it.key) : baseName(it.key));
      row.classList.add('vx-dragsrc');
    };
    row.ondragend = () => {
      row.classList.remove('vx-dragsrc');
      endDrag();
    };
    row.oncontextmenu = (e) => {
      e.preventDefault();
      if (isNote) noteMenu([it.key], { x: e.clientX, y: e.clientY });
      else folderMenu(it.key, { x: e.clientX, y: e.clientY });
    };
    return row;
  }

  // ------------------------------------------------------------- folders

  private folderSection(): HTMLElement {
    const sec = el('section', 'vx-sec vx-folders');
    sec.classList.toggle('folded', !secOpen.folders);
    sec.innerHTML = `<header class="vx-sec-head vx-fold"><span class="vx-sec-title">${I.folder}<span>Folders</span></span>
      <span class="vx-sec-acts">
        <button class="vx-icon-btn" data-act="note" title="New node" aria-label="New node">${I.newNote}</button>
        <button class="vx-icon-btn" data-act="folder" title="New folder" aria-label="New folder">${I.newFolder}</button>
        <button class="vx-icon-btn" data-act="collapse" title="Close all subfolders" aria-label="Close all subfolders">${FOLD_ALL}</button>
      </span><span class="vx-fold-caret">${I.caret}</span></header>`;
    // Section-wide buttons: start at the root, not at the last folder opened.
    sec.querySelector<HTMLElement>('[data-act=note]')!.onclick = () => nav.newNote('');
    sec.querySelector<HTMLElement>('[data-act=folder]')!.onclick = () => nav.newFolder('');
    sec.querySelector<HTMLElement>('[data-act=collapse]')!.onclick = () => this.collapseAll();
    foldable(sec.querySelector('header')!, secOpen.folders, () => setSections({ folders: !secOpen.folders }));
    const tree = el('div', 'vx-tree');
    tree.setAttribute('role', 'tree');
    tree.setAttribute('aria-label', 'Folders');
    tree.setAttribute('aria-multiselectable', 'true');
    const root = folderTree();
    tree.appendChild(this.folderRow(root));
    const kids = el('div', 'vx-kids open');
    kids.setAttribute('role', 'group');
    const top = branchGroup(1);
    for (const c of root.children) top.appendChild(this.folderBranch(c));
    if (this.opts.showNotes) for (const n of root.notes) top.appendChild(this.noteRow(n, 1));
    kids.appendChild(top);
    tree.appendChild(kids);
    tree.onkeydown = (e) => this.onKey(e);
    sec.appendChild(foldBody(tree, secOpen.folders));
    return sec;
  }

  private folderBranch(f: FolderNode): HTMLElement {
    const wrap = el('div', 'vx-branch');
    wrap.appendChild(this.folderRow(f));
    const open = openFolders.has(f.path);
    const hasKids = f.children.length > 0 || (this.opts.showNotes && f.notes.length > 0);
    if (hasKids) {
      const kids = el('div', 'vx-kids' + (open ? ' open' : ''));
      kids.setAttribute('role', 'group');
      // Children are built lazily on first open: large vaults stay fast.
      if (open) this.fillKids(kids, f);
      wrap.appendChild(kids);
    }
    return wrap;
  }

  private fillKids(kids: HTMLElement, f: FolderNode): void {
    const inner = branchGroup(f.depth + 1);
    for (const c of f.children) inner.appendChild(this.folderBranch(c));
    if (this.opts.showNotes) for (const n of f.notes) inner.appendChild(this.noteRow(n, f.depth + 1));
    kids.innerHTML = '';
    kids.appendChild(inner);
  }

  private folderRow(f: FolderNode): HTMLElement {
    const isRoot = f.path === '';
    const open = isRoot || openFolders.has(f.path);
    const hasKids = f.children.length > 0 || (this.opts.showNotes && f.notes.length > 0);
    const row = el('div', 'vx-row vx-frow' + (isRoot ? ' root' : ''));
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(f.depth + 1));
    if (hasKids && !isRoot) row.setAttribute('aria-expanded', String(open));
    row.tabIndex = -1;
    row.dataset.key = 'f:' + f.path;
    row.dataset.folder = f.path;
    row.dataset.nav = '1';
    row.draggable = !isRoot;
    row.style.setProperty('--depth', String(f.depth));
    const color = folderColor(f.path);
    row.style.setProperty('--fc', color);
    const selected = state.page === 'vault' && (prefs.folder || '') === f.path;
    row.classList.toggle('sel', selected);
    row.setAttribute('aria-selected', String(selected));
    const here = f.total ? agentsAt(f.path, true) : [];
    row.innerHTML = `<span class="vx-twist${hasKids && !isRoot ? '' : ' none'}" aria-hidden="true">${I.caret}</span>
      <span class="vx-fico">${isRoot ? I.vault : folderGlyph(folderIcon(f.path), open && hasKids)}</span>
      <span class="vx-fname">${esc(isRoot ? 'All nodes' : f.name)}</span>${isRoot ? '' : lockMark('folder', f.path)}
      ${coinsHTML(here)}
      <span class="vx-count">${f.total}</span>
      <button class="vx-row-more" tabindex="-1" aria-label="Folder actions" title="Actions">${I.more}</button>`;

    row.onclick = (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.vx-row-more')) {
        e.stopPropagation();
        folderMenu(f.path, t.closest('.vx-row-more') as HTMLElement, () => this.renameFolderInline(row, f.path));
        return;
      }
      if (t.closest('.vx-twist')) {
        this.toggle(f.path);
        return;
      }
      // Anywhere on a folder row opens or closes it (animated), and selects it.
      if (!isRoot && hasKids) this.toggle(f.path);
      nav.selectFolder(f.path);
    };
    row.ondblclick = (e) => {
      if (isRoot || (e.target as HTMLElement).closest('.vx-twist,.vx-row-more')) return;
      e.preventDefault();
      this.renameFolderInline(row, f.path);
    };
    row.oncontextmenu = (e) => {
      e.preventDefault();
      folderMenu(f.path, { x: e.clientX, y: e.clientY }, () => this.renameFolderInline(row, f.path));
    };

    if (!isRoot) {
      row.ondragstart = (e) => {
        startDrag(e, { kind: 'folder', path: f.path }, `${f.name} (${f.total})`);
        row.classList.add('vx-dragsrc');
      };
      row.ondragend = () => {
        row.classList.remove('vx-dragsrc');
        endDrag();
      };
    }
    this.wireDrop(row, f.path, hasKids && !isRoot);
    return row;
  }

  private wireDrop(row: HTMLElement, path: string, canExpand: boolean): void {
    const accepts = (): boolean => {
      const d = drag.cur;
      if (!d) return false;
      if (d.kind === 'notes') return d.paths.some((p) => dirOf(p) !== path);
      if (d.kind === 'folder') return !isInside(path, d.path) && dirOf(d.path) !== path;
      if (d.kind === 'pin') {
        return d.item.kind === 'note'
          ? dirOf(d.item.key) !== path
          : !isInside(path, d.item.key) && dirOf(d.item.key) !== path;
      }
      return false;
    };
    row.ondragover = (e) => {
      if (!accepts()) {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (!row.classList.contains('vx-drop-into')) {
        this.host.querySelectorAll('.vx-drop-into').forEach((n) => n.classList.remove('vx-drop-into'));
        row.classList.add('vx-drop-into');
      }
      // Hover a closed folder for a moment to open it.
      if (canExpand && !openFolders.has(path) && this.hoverPath !== path) {
        this.hoverPath = path;
        clearTimeout(this.hoverTimer);
        this.hoverTimer = window.setTimeout(() => {
          if (this.hoverPath === path && drag.cur) this.toggle(path, true);
        }, 650);
      }
    };
    row.ondragleave = (e) => {
      if (row.contains(e.relatedTarget as Node)) return;
      row.classList.remove('vx-drop-into');
      if (this.hoverPath === path) {
        this.hoverPath = null;
        clearTimeout(this.hoverTimer);
      }
    };
    row.ondrop = (e) => {
      const d = drag.cur;
      if (!d || !accepts()) return;
      e.preventDefault();
      e.stopPropagation();
      endDrag();
      this.hoverPath = null;
      clearTimeout(this.hoverTimer);
      if (d.kind === 'notes') void moveNotes(d.paths, path);
      else if (d.kind === 'folder') confirmFolderMove(d.path, path);
      else if (d.item.kind === 'note') void moveNotes([d.item.key], path);
      else confirmFolderMove(d.item.key, path);
    };
  }

  private noteRow(n: NoteRef, depth: number): HTMLElement {
    const row = el('div', 'vx-row vx-nrow');
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(depth + 1));
    row.tabIndex = -1;
    row.dataset.key = 'n:' + n.path;
    row.dataset.path = n.path;
    row.dataset.nav = '1';
    row.draggable = true;
    row.style.setProperty('--depth', String(depth));
    row.style.setProperty('--fc', folderColor(dirOf(n.path)));
    const isActive = state.note === n.path;
    row.classList.toggle('active', isActive);
    row.classList.toggle('sel', selection.has(n.path));
    row.setAttribute('aria-selected', String(isActive || selection.has(n.path)));
    row.innerHTML = `<span class="vx-twist none"></span><span class="vx-nico">${I.note}</span><span class="vx-fname">${esc(
      n.name,
    )}</span>${lockMark('node', n.path)}${coinsHTML(agentsAt(n.path), true)}`;
    row.onclick = (e) => {
      if (e.metaKey || e.ctrlKey) {
        if (selection.has(n.path)) selection.delete(n.path);
        else selection.add(n.path);
        row.classList.toggle('sel', selection.has(n.path));
        return;
      }
      selection.clear();
      nav.openNote(n.path);
    };
    row.ondblclick = (e) => {
      e.preventDefault();
      this.renameNoteInline(row, n.path);
    };
    row.oncontextmenu = (e) => {
      e.preventDefault();
      const paths = selection.has(n.path) && selection.size > 1 ? Array.from(selection) : [n.path];
      noteMenu(paths, { x: e.clientX, y: e.clientY }, () => this.renameNoteInline(row, n.path));
    };
    row.ondragstart = (e) => {
      const paths = selection.has(n.path) && selection.size > 1 ? Array.from(selection) : [n.path];
      startDrag(e, { kind: 'notes', paths }, paths.length > 1 ? `${paths.length} nodes` : n.name);
      row.classList.add('vx-dragsrc');
    };
    row.ondragend = () => {
      row.classList.remove('vx-dragsrc');
      endDrag();
    };
    return row;
  }

  // ----------------------------------------------------------- behavior

  /** Fold every open folder one after another, bottom-up, each with a little bounce. */
  collapseAll(): void {
    const rows = Array.from(this.host.querySelectorAll<HTMLElement>('.vx-frow[aria-expanded=true][data-folder]'))
      .filter((r) => r.dataset.folder && openFolders.has(r.dataset.folder) && r.offsetParent !== null)
      .reverse();
    const visible = new Set(rows.map((r) => r.dataset.folder!));
    // Open folders inside closed parents fold silently.
    for (const p of Array.from(openFolders)) if (!visible.has(p)) openFolders.delete(p);
    saveOpen();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    rows.forEach((row, k) => {
      const run = (): void => {
        this.toggle(row.dataset.folder!, false);
        row.classList.remove('vx-zoop');
        void row.offsetWidth;
        row.classList.add('vx-zoop');
        setTimeout(() => row.classList.remove('vx-zoop'), 420);
      };
      if (reduced) run();
      else setTimeout(run, k * 75);
    });
  }

  toggle(path: string, force?: boolean): void {
    const open = force ?? !openFolders.has(path);
    if (open) openFolders.add(path);
    else openFolders.delete(path);
    saveOpen();
    animatingUntil = performance.now() + 340;
    for (const t of Array.from(instances)) t.animate(path, open);
  }

  /** Expand/collapse one branch with a height transition, without a full redraw. */
  animate(path: string, open: boolean): void {
    const row = this.host.querySelector<HTMLElement>(`.vx-frow[data-folder="${CSS.escape(path)}"]`);
    if (!row) return;
    const kids = row.nextElementSibling as HTMLElement | null;
    if (!kids || !kids.classList.contains('vx-kids')) return;
    const f = folderAt(path);
    row.setAttribute('aria-expanded', String(open));
    const ico = row.querySelector('.vx-fico');
    if (ico && f) ico.innerHTML = folderGlyph(folderIcon(path), open);
    if (open) {
      if (!kids.firstElementChild && f) this.fillKids(kids, f);
      kids.style.height = '0px';
      kids.classList.add('open');
      const h = kids.scrollHeight;
      requestAnimationFrame(() => {
        kids.style.height = h + 'px';
      });
      const done = (): void => {
        kids.style.height = '';
        kids.removeEventListener('transitionend', done);
      };
      kids.addEventListener('transitionend', done);
      setTimeout(done, 320);
    } else {
      kids.style.height = kids.scrollHeight + 'px';
      requestAnimationFrame(() => {
        kids.style.height = '0px';
        kids.classList.remove('open');
      });
      const done = (): void => {
        kids.style.height = '';
        kids.removeEventListener('transitionend', done);
      };
      kids.addEventListener('transitionend', done);
      setTimeout(done, 320);
    }
    this.roving();
  }

  private async renameFolderInline(row: HTMLElement, path: string): Promise<void> {
    const name = row.querySelector<HTMLElement>('.vx-fname');
    if (!name) return;
    row.draggable = false;
    const v = await inlineEdit(name, baseName(path));
    row.draggable = true;
    if (v) await renameFolder(path, v);
  }

  private async renameNoteInline(row: HTMLElement, path: string): Promise<void> {
    const name = row.querySelector<HTMLElement>('.vx-fname');
    if (!name) return;
    row.draggable = false;
    const v = await inlineEdit(name, noteName(path));
    row.draggable = true;
    if (v) await renameNote(path, v);
  }

  /** Visible rows in order, for arrow-key navigation. */
  private visibleRows(): HTMLElement[] {
    return Array.from(this.host.querySelectorAll<HTMLElement>('[data-nav]')).filter(
      (r) => !r.closest('.vx-kids:not(.open)'),
    );
  }

  /** One tab stop for the whole tree (roving tabindex). */
  private roving(): void {
    const rows = this.visibleRows();
    if (!rows.length) return;
    const cur =
      rows.find((r) => r.dataset.key === this.focusKey) ||
      rows.find((r) => r.classList.contains('sel') || r.classList.contains('active')) ||
      rows.find((r) => r.classList.contains('vx-frow')) ||
      rows[0];
    rows.forEach((r) => (r.tabIndex = r === cur ? 0 : -1));
  }

  private onKey(e: KeyboardEvent): void {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]');
    if (!row || (e.target as HTMLElement).tagName === 'INPUT') return;
    const rows = this.visibleRows();
    const i = rows.indexOf(row);
    const folder = row.dataset.folder;
    const path = row.dataset.path;
    const focus = (r?: HTMLElement): void => {
      if (!r) return;
      rows.forEach((x) => (x.tabIndex = -1));
      r.tabIndex = 0;
      this.focusKey = r.dataset.key || null;
      r.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focus(rows[i + 1]);
        return;
      case 'ArrowUp':
        e.preventDefault();
        focus(rows[i - 1]);
        return;
      case 'Home':
        e.preventDefault();
        focus(rows[0]);
        return;
      case 'End':
        e.preventDefault();
        focus(rows[rows.length - 1]);
        return;
      case 'ArrowRight':
        if (folder != null && folder !== '') {
          e.preventDefault();
          if (row.getAttribute('aria-expanded') === 'false') this.toggle(folder, true);
          else focus(rows[i + 1]);
        }
        return;
      case 'ArrowLeft': {
        e.preventDefault();
        if (folder && row.getAttribute('aria-expanded') === 'true') {
          this.toggle(folder, false);
          return;
        }
        const parent = folder != null ? dirOf(folder) : dirOf(path || '');
        if (folder === '') return;
        focus(this.host.querySelector<HTMLElement>(`.vx-frow[data-folder="${CSS.escape(parent)}"]`) || undefined);
        return;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (folder != null) nav.selectFolder(folder);
        else if (path) nav.openNote(path);
        return;
      case 'F2':
        e.preventDefault();
        if (folder) void this.renameFolderInline(row, folder);
        else if (path) void this.renameNoteInline(row, path);
        return;
      case 'Delete':
        e.preventDefault();
        if (folder) confirmDeleteFolder(folder);
        else if (path) confirmDeleteNotes(selection.size > 1 && selection.has(path) ? Array.from(selection) : [path]);
        return;
      case 'p':
      case 'P':
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        if (folder) pinToggle('folder', folder);
        else if (path) pinToggle('note', path);
        return;
      case 'n':
      case 'N':
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        nav.newNote(folder ?? dirOf(path || ''));
        return;
      case 'ContextMenu':
        e.preventDefault();
        if (folder != null) folderMenu(folder, row, () => void this.renameFolderInline(row, folder));
        else if (path) noteMenu([path], row, () => void this.renameNoteInline(row, path));
        return;
      case 'F10':
        if (e.shiftKey) {
          e.preventDefault();
          if (folder != null) folderMenu(folder, row, () => void this.renameFolderInline(row, folder));
          else if (path) noteMenu([path], row, () => void this.renameNoteInline(row, path));
        }
        return;
      default:
        return;
    }
  }
}

// Pins changed (here, on the server, in another browser): redraw.
onPinsSynced(() => refreshTrees());

/** Mount a tree into any container (used by the shell sidebar). */
export function mountTree(container: HTMLElement, opts: Partial<TreeOptions> = {}): TreeView {
  return new TreeView(container, {
    showNotes: opts.showNotes ?? true,
    showPins: opts.showPins ?? true,
  });
}
