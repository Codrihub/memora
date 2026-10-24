// Folder picker: a sidebar-style folder tree with a search box that finds folders at any depth.

import { attr, el, esc, useStyles } from '../dom';
import { Modal } from '../modal';
import { INDENT_CAP } from './drag';
import { I, folderGlyph } from './icons';
import { folderColor, folderIcon, folderTree, ROOT_LABEL, type FolderNode } from './store';
import { fadeScroll } from '../ui/scroll-fade';
import {
  ancestorsOf,
  breadcrumbPieces,
  buildPickTree,
  searchFolders,
  visibleRows,
  type FolderMatch,
  type PickNode,
  type PickRow,
  type Piece,
} from './folder-tree';

interface FolderPickerOptions {
  /** Every folder path to offer (ancestors are filled in; '' is the root and always shown). */
  folders: string[];
  /** Selected at start ('' = root). Its ancestors are expanded. */
  value: string;
  /** Where the item lives now: marked "current". */
  current?: string | null;
  /** Folders left out together with everything below them. */
  exclude?: string[];
  /** Shown but not choosable; return the reason (tooltip) or false. */
  disabled?: (path: string) => string | false;
  /** Accessible name of the tree. */
  label?: string;
  rootLabel?: string;
  onChange?: (path: string) => void;
  /** Enter or a double click on a choosable folder. */
  onPick?: (path: string) => void;
}

export interface FolderPicker {
  el: HTMLElement;
  /** The selected folder, or null when the selection is not choosable. */
  readonly value: string | null;
  focus(): void;
}

let seq = 0;

/** "Projects › 2027 › Q1" as HTML, with highlighted pieces. */
function crumbHTML(segs: Piece[][]): string {
  return segs
    .map((pieces) => pieces.map((p) => (p.hl ? `<mark>${esc(p.text)}</mark>` : esc(p.text))).join(''))
    .join('<span class="fp-sep">›</span>');
}

/** A breadcrumb; with `keep`, only the last `keep` levels after "…". */
export function breadcrumb(path: string, rootLabel = ROOT_LABEL, keep = 0): string {
  if (!path) return esc(rootLabel);
  const segs = breadcrumbPieces(path, []);
  if (!keep || segs.length <= keep) return crumbHTML(segs);
  return '…<span class="fp-sep">›</span>' + crumbHTML(segs.slice(-keep));
}

export function createFolderPicker(opts: FolderPickerOptions): FolderPicker {
  useStyles('fp-css', FP_CSS);
  const id = 'fp' + ++seq;
  const rootLabel = opts.rootLabel || ROOT_LABEL;
  const tree = buildPickTree(opts.folders, opts.exclude || []);
  const total = tree.byPath.size - 1;
  const offReason = (p: string): string | false => (opts.disabled ? opts.disabled(p) : false);
  let value = tree.byPath.has(opts.value) ? opts.value : '';
  const expanded = new Set<string>();
  const reveal = (p: string): void => ancestorsOf(p).forEach((a) => expanded.add(a));
  // A small vault opens fully; a big one only down to the selection.
  if (total <= 24) tree.byPath.forEach((n) => n.children.length && expanded.add(n.path));
  reveal(value);
  if (opts.current && tree.byPath.has(opts.current)) reveal(opts.current);

  // Node counts once per picker (the store recomputes its tree signature per call).
  const counts = new Map<string, number>();
  const countAll = (f: FolderNode): void => {
    counts.set(f.path, f.total);
    f.children.forEach(countAll);
  };
  countAll(folderTree());

  let query = '';
  let matches: FolderMatch[] | null = null;
  const collapsed = new Set<string>();
  let rows: PickRow[] = [];
  let active = 0;

  const box = el('div', 'fp');
  box.innerHTML = `<div class="fp-search">${I.search}<input class="fp-q" type="search" placeholder="Search folders by name or path" aria-label="Search folders" autocomplete="off" spellcheck="false" aria-controls="${id}-tree"></div>
<div class="fp-tree" id="${id}-tree" role="tree" tabindex="0" aria-label="${attr(opts.label || 'Folders')}"></div>
<div class="fp-foot"><span class="fp-status" aria-live="polite"></span><span class="fp-chosen"></span></div>`;
  const q = box.querySelector<HTMLInputElement>('.fp-q')!;
  const list = box.querySelector<HTMLElement>('.fp-tree')!;
  fadeScroll(list);
  const status = box.querySelector<HTMLElement>('.fp-status')!;
  const chosen = box.querySelector<HTMLElement>('.fp-chosen')!;

  const choosable = (p: string): boolean => tree.byPath.has(p) && !offReason(p);

  const rowHTML = (r: PickRow, i: number): string => {
    const n = r.node;
    const root = n.depth === 0;
    const lv = Math.min(n.depth, INDENT_CAP);
    const off = offReason(n.path);
    const sel = n.path === value && !off;
    const color = root ? 'var(--accent)' : folderColor(n.path);
    const kids = r.kids;
    const ico = root ? I.vault : folderGlyph(folderIcon(n.path), r.open);
    let name = esc(root ? rootLabel : n.name);
    let sub = '';
    if (r.match) {
      const segs = breadcrumbPieces(n.path, r.match.ranges);
      name = crumbHTML([segs[segs.length - 1]]);
      // Deep paths keep the first level and the last two; the tooltip has the rest.
      const shown = segs.length > 4 ? [segs[0], [{ text: '…', hl: false }], ...segs.slice(-2)] : segs;
      if (segs.length > 1) sub = `<span class="fp-path">${crumbHTML(shown)}</span>`;
    }
    const count = root ? 0 : counts.get(n.path) || 0;
    const tags = [
      opts.current != null && n.path === opts.current ? '<em class="fp-tag">current</em>' : '',
      root ? '<em class="fp-tag soft">top level</em>' : '',
    ].join('');
    const tip = (root ? rootLabel + ' (the top level)' : n.path) + (off ? ' · ' + off : '');
    return `<div class="fp-row${root ? ' root' : ''}${sel ? ' sel' : ''}${i === active ? ' kb' : ''}${off ? ' off' : ''}${
      matches && !r.match && !root ? ' anc' : ''
    }${sub ? ' two' : ''}" role="treeitem" id="${id}-r${i}" data-i="${i}" aria-level="${n.depth + 1}"${
      kids && !root ? ` aria-expanded="${r.open}"` : ''
    } aria-selected="${sel}"${off ? ' aria-disabled="true"' : ''} title="${attr(tip)}" style="--lv:${lv};--fc:${attr(color)}">${
      lv ? '<span class="fp-guides" aria-hidden="true"></span>' : ''
    }${n.depth > INDENT_CAP ? `<span class="fp-deep" aria-hidden="true">${n.depth}</span>` : ''}${
      root ? '' : `<span class="fp-twist${kids ? '' : ' none'}" aria-hidden="true">${I.caret}</span>`
    }<span class="fp-ico" aria-hidden="true">${ico}</span><span class="fp-text"><span class="fp-name">${name}</span>${sub}</span>${tags}${
      count ? `<span class="fp-count">${count}</span>` : ''
    }</div>`;
  };

  const paintChosen = (): void => {
    const ok = choosable(value);
    chosen.innerHTML = ok
      ? `<span class="fp-chosen-l">Selected</span>${
          value.includes('/')
            ? `<span class="fp-chosen-p">${breadcrumb(value.slice(0, value.lastIndexOf('/')))}<span class="fp-sep">›</span></span>`
            : ''
        }<b>${esc(value ? value.slice(value.lastIndexOf('/') + 1) : rootLabel)}</b>`
      : '<span class="fp-chosen-l">Choose a folder</span>';
    chosen.title = ok ? value || rootLabel : '';
  };

  const draw = (keepScroll = true): void => {
    const top = list.scrollTop;
    // No match: no rows at all, so keys and Enter cannot reach a hidden one.
    rows = matches && !matches.length ? [] : visibleRows(tree, expanded, matches, collapsed);
    active = Math.max(0, Math.min(active, rows.length - 1));
    if (matches && !matches.length) {
      list.innerHTML = `<p class="fp-empty">No folder matches "${esc(query)}".</p>`;
      list.removeAttribute('aria-activedescendant');
    } else {
      list.innerHTML = rows.map(rowHTML).join('');
      list.setAttribute('aria-activedescendant', `${id}-r${active}`);
    }
    status.textContent = matches
      ? `${matches.length} folder${matches.length === 1 ? '' : 's'} match`
      : `${total} folder${total === 1 ? '' : 's'}`;
    if (keepScroll) list.scrollTop = top;
    paintChosen();
  };

  const scrollToActive = (): void => {
    list.querySelector<HTMLElement>(`#${id}-r${active}`)?.scrollIntoView({ block: 'nearest' });
  };
  const setActive = (i: number, select = true): void => {
    if (!rows.length) return;
    active = Math.max(0, Math.min(rows.length - 1, i));
    const p = rows[active].node.path;
    if (select && choosable(p) && p !== value) {
      value = p;
      opts.onChange?.(p);
    }
    draw();
    scrollToActive();
  };
  const toggle = (n: PickNode, open?: boolean): void => {
    if (n.depth === 0) return;
    if (matches) {
      const isOpen = !collapsed.has(n.path);
      if ((open ?? !isOpen) === isOpen) return;
      if (isOpen) collapsed.add(n.path);
      else collapsed.delete(n.path);
    } else {
      const isOpen = expanded.has(n.path);
      if ((open ?? !isOpen) === isOpen) return;
      if (isOpen) expanded.delete(n.path);
      else expanded.add(n.path);
    }
    draw();
  };
  const pick = (p: string): void => {
    if (choosable(p)) opts.onPick?.(p);
  };

  const search = (): void => {
    query = q.value.trim();
    collapsed.clear();
    matches = query ? searchFolders(tree.byPath.keys(), query) : null;
    if (matches) {
      // The best match becomes the active row (and the selection when choosable).
      const fresh = visibleRows(tree, expanded, matches, collapsed);
      const best = matches.find((m) => choosable(m.path)) || matches[0];
      active = best ? Math.max(0, fresh.findIndex((r) => r.node.path === best.path)) : 0;
      if (best && choosable(best.path) && best.path !== value) {
        value = best.path;
        opts.onChange?.(value);
      }
      list.scrollTop = 0;
    } else {
      // Back to the plain tree, opened down to the selection.
      reveal(value);
      active = Math.max(0, visibleRows(tree, expanded).findIndex((r) => r.node.path === value));
    }
    draw(false);
    scrollToActive();
  };
  q.addEventListener('input', search);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list.focus();
      // The tree takes over at the active row (the best match while searching).
      setActive(active);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (rows[active]) pick(rows[active].node.path);
    }
  });
  // Esc in a filled search box clears it instead of closing the dialog (window capture runs before the dialog's).
  const onEsc = (e: KeyboardEvent): void => {
    if (!box.isConnected) {
      window.removeEventListener('keydown', onEsc, true);
      return;
    }
    if (e.key !== 'Escape' || !q.value || (e.target !== q && e.target !== list)) return;
    e.preventDefault();
    e.stopPropagation();
    q.value = '';
    search();
    q.focus();
  };
  window.addEventListener('keydown', onEsc, true);

  list.addEventListener('keydown', (e) => {
    // Typing anywhere in the tree goes to the search box.
    if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      q.focus();
      q.value += e.key;
      search();
      return;
    }
    if (e.key === 'Backspace' && q.value) {
      e.preventDefault();
      q.focus();
      q.value = q.value.slice(0, -1);
      search();
      return;
    }
    const r = rows[active];
    if (!r) return;
    const n = r.node;
    switch (e.key) {
      case 'ArrowDown':
        setActive(active + 1);
        break;
      case 'ArrowUp':
        setActive(active - 1);
        break;
      case 'Home':
        setActive(0);
        break;
      case 'End':
        setActive(rows.length - 1);
        break;
      case 'PageDown':
        setActive(active + 8);
        break;
      case 'PageUp':
        setActive(active - 8);
        break;
      case 'ArrowRight':
        if (r.kids && !r.open) toggle(n, true);
        else if (r.open && rows[active + 1]?.node.parent === n) setActive(active + 1);
        else return;
        break;
      case 'ArrowLeft':
        if (r.open && n.depth > 0) toggle(n, false);
        else if (n.parent) setActive(rows.findIndex((x) => x.node === n.parent));
        else return;
        break;
      case 'Enter':
        e.stopPropagation();
        pick(n.path);
        break;
      case ' ':
        setActive(active);
        break;
      default:
        return;
    }
    e.preventDefault();
  });
  list.addEventListener('click', (e) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.fp-row');
    if (!rowEl) return;
    const i = Number(rowEl.dataset.i);
    const r = rows[i];
    if (!r) return;
    if ((e.target as HTMLElement).closest('.fp-twist')) {
      active = i;
      toggle(r.node);
      return;
    }
    // Choosing a closed folder also opens it, to go further down.
    if (!r.open && r.node.children.length && !matches) expanded.add(r.node.path);
    setActive(i);
    list.focus({ preventScroll: true });
  });
  list.addEventListener('dblclick', (e) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.fp-row');
    if (rowEl && !(e.target as HTMLElement).closest('.fp-twist')) {
      const r = rows[Number(rowEl.dataset.i)];
      if (r) pick(r.node.path);
    }
  });

  rows = visibleRows(tree, expanded);
  active = Math.max(0, rows.findIndex((r) => r.node.path === value));
  draw(false);
  requestAnimationFrame(() => scrollToActive());

  return {
    el: box,
    get value() {
      return choosable(value) ? value : null;
    },
    focus: () => q.focus(),
  };
}

interface PickFolderDialog {
  title: string;
  folders: string[];
  current?: string | null;
  /** Selected at start (defaults to `current`). */
  value?: string;
  exclude?: string[];
  disabled?: (path: string) => string | false;
  /** Primary button text. */
  verb?: string;
  run: (folder: string) => void;
}

/** A dialog with the folder picker and a "Move here" style button. */
export function pickFolderDialog(o: PickFolderDialog): void {
  let go: HTMLButtonElement | null = null;
  const verb = o.verb || 'Move here';
  const label = (p: string | null): void => {
    if (!go) return;
    go.disabled = p == null;
    go.textContent = verb;
  };
  const finish = (p: string): void => {
    Modal.close();
    o.run(p);
  };
  const picker = createFolderPicker({
    folders: o.folders,
    value: o.value ?? o.current ?? '',
    current: o.current,
    exclude: o.exclude,
    disabled: o.disabled,
    label: o.title,
    onChange: () => label(picker.value),
    onPick: finish,
  });
  Modal.open({
    title: o.title,
    body: picker.el,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      {
        label: verb,
        cls: 'primary',
        run: () => {
          const p = picker.value;
          if (p != null) finish(p);
        },
      },
    ],
    onOpen: (body) => {
      go = body.parentElement?.querySelector<HTMLButtonElement>('.modal-foot .btn.primary') || null;
      label(picker.value);
      setTimeout(() => picker.focus(), 50);
    },
  });
}

const FP_CSS = `
/* contain: long folder names never widen the dialog (the bottom sheet on phones). */
.fp{display:flex;flex-direction:column;gap:8px;min-width:0;contain:inline-size}
.fp-search{position:relative;display:flex;align-items:center}
.fp-search > svg{position:absolute;left:11px;width:15px;height:15px;color:var(--muted);pointer-events:none}
.fp .fp-search input.fp-q{width:100%;box-sizing:border-box;height:38px;padding:0 12px 0 34px;border-radius:8px;
  border:1px solid var(--line-strong,var(--line));background:var(--surface-0,var(--bg));color:var(--fg);font:inherit;font-size:13.5px;outline:none}
.fp .fp-search input.fp-q:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}
.fp-tree{--step:14px;--pad:6px;max-height:min(46vh,340px);min-height:120px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;
  scrollbar-width:none;border:1px solid var(--line);border-radius:8px;padding:4px;outline:none;font-size:13px;
  background:var(--surface-1,var(--panel))}
.fp-tree::-webkit-scrollbar{display:none}
.fp-tree:focus-visible{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}
.fp-row{position:relative;display:flex;align-items:center;gap:6px;min-height:32px;box-sizing:border-box;
  padding:0 8px 0 calc(var(--pad) + var(--lv,0) * var(--step));border-radius:8px;cursor:pointer;color:var(--fg);user-select:none}
.fp-row.two{padding-top:4px;padding-bottom:4px}
.fp-row:hover{background:var(--panel-2)}
.fp-tree:focus-visible .fp-row.kb,.fp-tree:focus .fp-row.kb{box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--accent) 70%,transparent)}
.fp-row.sel{background:color-mix(in srgb,var(--accent) 15%,transparent)}
.fp-row.sel .fp-name{font-weight:640}
.fp-row.off{cursor:not-allowed}
.fp-row.off .fp-text,.fp-row.off .fp-ico{opacity:.45}
.fp-row.anc .fp-name{color:var(--muted)}
.fp-row.root{margin-bottom:2px}
.fp-guides{position:absolute;top:0;bottom:0;left:var(--pad);width:calc(var(--lv) * var(--step));pointer-events:none;
  background-image:linear-gradient(90deg,color-mix(in srgb,var(--fg) 13%,transparent) 1px,transparent 1px);
  background-size:var(--step) 100%;background-position:7.5px 0;background-repeat:repeat-x}
.fp-deep{flex:none;min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:5px;font-size:10px;font-weight:600;
  display:grid;place-items:center;color:var(--muted);background:color-mix(in srgb,var(--fg) 8%,transparent);font-variant-numeric:tabular-nums;
  margin-left:-4px}
.fp-twist{width:16px;height:16px;flex:none;display:grid;place-items:center;color:var(--muted);border-radius:4px}
.fp-twist.none{visibility:hidden}
.fp-twist .vx-caret{width:12px;height:12px;transition:transform .18s}
.fp-row[aria-expanded=true] .fp-twist .vx-caret{transform:rotate(90deg)}
.fp-twist:hover{background:var(--panel)}
.fp-ico{display:inline-flex;flex:none;color:var(--fc)}
.fp-ico .vx-i{width:16px;height:16px}
.fp-text{flex:1;min-width:0;display:flex;flex-direction:column}
.fp-name,.fp-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fp-path{font-size:11.5px;color:var(--muted);margin-top:1px}
.fp-sep{margin:0 4px;opacity:.6}
.fp mark{background:color-mix(in srgb,var(--accent) 26%,transparent);color:inherit;border-radius:3px;padding:0 1px}
.fp-tag{flex:none;font-style:normal;font-size:10.5px;color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);
  border-radius:999px;padding:0 6px;line-height:16px}
.fp-tag.soft{color:var(--muted);border-color:var(--line)}
.fp-count{flex:none;font-size:10.5px;color:var(--muted);font-variant-numeric:tabular-nums;min-width:18px;text-align:right}
.fp-empty{margin:14px 10px;font-size:12.5px;color:var(--muted)}
.fp-foot{display:flex;align-items:baseline;gap:10px;font-size:12px;color:var(--muted);min-width:0}
.fp-status{flex:none}
.fp-chosen{flex:1;min-width:0;display:flex;justify-content:flex-end;gap:5px;white-space:nowrap;color:var(--fg)}
.fp-chosen-l{flex:none;color:var(--muted)}
.fp-chosen-p{min-width:0;overflow:hidden;text-overflow:ellipsis;direction:ltr}
.fp-chosen b{flex:none;max-width:60%;overflow:hidden;text-overflow:ellipsis;font-weight:600}
@media (max-width:640px){
  .fp-tree{--step:12px;max-height:44vh}
  .fp .fp-search input.fp-q{height:42px;font-size:16px}
}
@media (hover:none),(max-width:640px){
  .fp-row{min-height:44px}
  .fp-twist{width:28px;height:28px;margin:0 -6px}
  .fp-guides{background-position:7.5px 0}
}
@media (prefers-reduced-motion:reduce){.fp-twist .vx-caret{transition:none}}
`;
