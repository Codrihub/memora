// Nodes page: an optional folder tree (when the shell sidebar does not show
// one already) next to one main area. The main area is either the folder
// browser (list.ts) or the node reader (note.ts), never both: browsing and
// reading each get the whole width. Both layers stay mounted so going back
// to a folder keeps its scroll position. Phones get the same two screens,
// full width, with back navigation through the browser history.

import { $, attr, el, esc, useStyles } from '../dom';
import { hooks } from '../hooks';
import { allNotes, state } from '../state';
import { I } from './icons';
import { renderList, resetListQuery } from './list';
import { nav } from './nav';
import { flushEditor, noteShown, renderNote } from './note';
import { createFolder, createNote, onRefresh, relocating } from './ops';
import {
  baseName,
  dirOf,
  folderAt,
  folderColor,
  isInside,
  onPinsSynced,
  onVaultChange,
  openFolders,
  prefs,
  saveOpen,
  savePrefs,
  selection,
  wireBus,
} from './store';
import { TreeView, refreshTrees } from './tree';
import { promptName } from './ui';
import { setSheetEditor } from './sheet';
import { Modal } from '../modal';
import { VAULT_CSS } from './styles';

type Pane = 'list' | 'note';

let shell: HTMLElement | null = null;
let tree: TreeView | null = null;
/** Path of a deep-linked node that is not in the vault ("node not found"). */
let missing: string | null = null;
const MOBILE = '(max-width: 760px)';
const isMobile = (): boolean => window.matchMedia(MOBILE).matches;

function setPane(p: Pane): void {
  if (shell) shell.dataset.pane = p;
  syncTop();
}

/** The scroller of the layer on screen (browser or reader). */
function activeScroller(): HTMLElement | null {
  const p = shell?.dataset.pane === 'note' ? noteHost() : listHost();
  return p?.querySelector<HTMLElement>('.vx-bscroll,.vx-note-scroll') || null;
}

/** "Back to top" shows once the visible layer is scrolled down a bit. */
function syncTop(): void {
  const b = shell?.querySelector<HTMLElement>('.vx-totop');
  if (!b) return;
  const on = (activeScroller()?.scrollTop || 0) > 480;
  b.classList.toggle('on', on);
  b.tabIndex = on ? 0 : -1;
}

function listHost(): HTMLElement | null {
  return shell?.querySelector<HTMLElement>('.vx-pane-list') || null;
}
function noteHost(): HTMLElement | null {
  return shell?.querySelector<HTMLElement>('.vx-pane-note') || null;
}

function build(host: HTMLElement): void {
  useStyles('vx-styles', VAULT_CSS);
  host.classList.add('vx-view');
  host.innerHTML = '';
  shell = el('div', 'vx-shell');
  shell.style.setProperty('--tree-w', prefs.treeW + 'px');
  shell.innerHTML = `<div class="vx-pane vx-pane-tree" aria-label="Folders"></div>
    <div class="vx-resizer" data-r="tree" role="separator" aria-orientation="vertical" aria-label="Resize folders" tabindex="0"></div>
    <div class="vx-main">
      <div class="vx-pane vx-pane-list" aria-label="Folder"></div>
      <div class="vx-pane vx-pane-note" aria-label="Node"></div>
      <button class="vx-totop" aria-label="Scroll to top" title="Scroll to top" tabindex="-1"><svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
    </div>`;
  host.appendChild(shell);
  tree = new TreeView(shell.querySelector<HTMLElement>('.vx-pane-tree')!, {
    showNotes: prefs.showNotesInTree,
    showPins: true,
  });
  wireResizers(shell);
  const main = shell.querySelector<HTMLElement>('.vx-main')!;
  let topRaf = 0;
  main.addEventListener(
    'scroll',
    () => {
      cancelAnimationFrame(topRaf);
      topRaf = requestAnimationFrame(syncTop);
    },
    true,
  );
  main.querySelector<HTMLElement>('.vx-totop')!.onclick = () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    activeScroller()?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  };
  shell.addEventListener('keydown', (e) => {
    if (e.key === 'F6') {
      // Move focus between the tree and the main area.
      e.preventDefault();
      const t = shell?.querySelector<HTMLElement>('.vx-pane-tree');
      const inTree = !!t?.contains(document.activeElement);
      const main = inTree || shell?.classList.contains('no-tree') ? (state.note ? noteHost() : listHost()) : t;
      (main?.querySelector<HTMLElement>('[tabindex="0"],button,input,textarea') || main)?.focus();
    }
  });
}

function wireResizers(s: HTMLElement): void {
  s.querySelectorAll<HTMLElement>('.vx-resizer').forEach((r) => {
    const apply = (w: number): void => {
      prefs.treeW = Math.round(Math.max(190, Math.min(460, w)));
      s.style.setProperty('--tree-w', prefs.treeW + 'px');
    };
    r.onpointerdown = (e) => {
      e.preventDefault();
      r.setPointerCapture(e.pointerId);
      const x0 = e.clientX;
      const w0 = prefs.treeW;
      s.classList.add('resizing');
      r.onpointermove = (m) => apply(w0 + m.clientX - x0);
      r.onpointerup = () => {
        r.onpointermove = null;
        s.classList.remove('resizing');
        savePrefs();
      };
    };
    r.onkeydown = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        apply(prefs.treeW + (e.key === 'ArrowLeft' ? -16 : 16));
        savePrefs();
      }
    };
  });
}

function drawList(): void {
  const h = listHost();
  if (h) renderList(h, isMobile());
}

async function drawNote(quiet = false): Promise<void> {
  const h = noteHost();
  if (!h) return;
  if (!state.note && missing) {
    setPane('note');
    h.innerHTML = `<div class="vx-empty vx-missing">${I.note}<p><b>Node not found</b><br>“${esc(
      baseName(missing).replace(/\.md$/, ''),
    )}” is not in this vault. It may have been moved, renamed or deleted.</p><button class="btn sm" data-home>Show all nodes</button></div>`;
    h.querySelector<HTMLElement>('[data-home]')!.onclick = () => {
      missing = null;
      selectFolder('');
    };
    return;
  }
  if (!state.note) {
    setPane('list');
    return;
  }
  setPane('note');
  await renderNote(h, state.note, isMobile(), quiet);
}

function setCrumb(): void {
  const crumb = $('.crumb');
  crumb.textContent = state.note
    ? state.note.split('/').pop()!.replace(/\.md$/i, '')
    : prefs.folder
      ? 'Nodes / ' + prefs.folder
      : 'Nodes';
}

/**
 * When the shell sidebar already shows a vault tree (mountTree), the page
 * drops its own tree pane on desktop to avoid two trees side by side.
 * Phones never show it: the browser's folder tiles and breadcrumb navigate.
 */
function syncTreePane(): void {
  if (!shell) return;
  const own = shell.querySelector('.vx-pane-tree');
  const other = Array.from(document.querySelectorAll<HTMLElement>('.vx-treehost')).some(
    (t) => t !== own && t.isConnected && !shell!.contains(t),
  );
  shell.classList.toggle('no-tree', other || isMobile());
}

/** Router entry: draw (or refresh) the whole vault page. */
export async function renderVault(): Promise<void> {
  wireBus();
  const host = $('#view-vault');
  if (!host.classList) return;
  if (!shell || !host.contains(shell)) {
    build(host);
    if (prefs.folder && !folderAt(prefs.folder)) prefs.folder = '';
    syncTreePane();
    setPane(state.note ? 'note' : 'list');
    tree?.render();
    drawList();
    await drawNote();
    setCrumb();
    return;
  }
  // Refresh after a mutation: keep the note pane unless the open note changed.
  if (prefs.folder && !folderAt(prefs.folder)) prefs.folder = '';
  syncTreePane();
  refreshTrees();
  drawList();
  if (state.note !== noteShown() || !state.note) await drawNote(true);
  setCrumb();
}

function nodeExists(path: string): boolean {
  return allNotes().some((n) => n.path === path);
}

/**
 * Open a node in the reader, on every screen size (phones included: the
 * reader is the full node page, the bottom sheet is not used here). Deep
 * links land here too; a path that is not in the loaded tree only ever
 * shows "node not found" (it is never sent to the server).
 */
export async function openNote(path: string): Promise<void> {
  if (!nodeExists(path) && !Object.keys(state.tree).length) {
    try {
      await hooks.loadCore();
    } catch {
      /* tree stays empty: reported as not found */
    }
  }
  await openInPane(path);
}

/**
 * History depth of in-app node opens: each history entry a node open pushed
 * is stamped with `vxDepth`, so the reader's back button can go back to where
 * the user came from (a folder, another node, the brain) and, on a deep link
 * with nothing of ours behind it, falls back to the node's folder instead of
 * leaving the app.
 */
function stampDepth(fromUrl: string, before: unknown): void {
  const now = location.pathname + location.search;
  if (now === fromUrl) return;
  const prev = (before as { vxDepth?: number } | null)?.vxDepth || 0;
  try {
    history.replaceState({ ...(history.state || {}), vxDepth: prev + 1 }, '');
  } catch {
    /* sandboxed frames */
  }
}

/** Reader back button: back in history when we pushed the entry, else up to the folder. */
function leaveNote(): void {
  const depth = (history.state as { vxDepth?: number } | null)?.vxDepth || 0;
  if (depth > 0) {
    history.back();
    return;
  }
  selectFolder(state.note ? dirOf(state.note) : prefs.folder || '');
}

/** Open a node in the vault reader pane (also the editor). */
async function openInPane(path: string, edit = false): Promise<void> {
  await flushEditor();
  const fromUrl = location.pathname + location.search;
  const before = history.state as unknown;
  if (!nodeExists(path)) {
    // Mid rename or move the tree lags the server: never flash "not found".
    if (relocating()) return;
    missing = path;
    state.note = null;
    state.editing = false;
    if (state.page !== 'vault') hooks.go('vault');
    else {
      void drawNote();
      setCrumb();
    }
    return;
  }
  missing = null;
  state.note = path;
  state.editing = false;
  selection.clear();
  // Keep the browser behind the reader on a folder that holds the node, so
  // going back lands where the user was (or where the node lives).
  if (!isInside(dirOf(path), prefs.folder || '')) {
    prefs.folder = dirOf(path);
    resetListQuery();
    savePrefs();
  }
  let p = dirOf(path);
  while (p) {
    openFolders.add(p);
    p = dirOf(p);
  }
  saveOpen();
  if (state.page !== 'vault') {
    hooks.go('vault');
    stampDepth(fromUrl, before);
    hooks.refreshTree();
    if (edit) setTimeout(() => noteHost()?.querySelector<HTMLElement>('[data-mode=edit]')?.click(), 400);
    return;
  }
  stampDepth(fromUrl, before);
  setPane('note');
  refreshTrees();
  drawList();
  await drawNote();
  if (edit) noteHost()?.querySelector<HTMLElement>('[data-mode=edit]')?.click();
  setCrumb();
  hooks.refreshTree();
  noteHost()?.querySelector<HTMLElement>('.vx-note-scroll')?.scrollTo(0, 0);
}

function selectFolder(path: string): void {
  missing = null;
  void flushEditor().then(() => {
    const changed = (prefs.folder || '') !== path;
    prefs.folder = path;
    savePrefs();
    resetListQuery();
    selection.clear();
    state.note = null;
    state.editing = false;
    setPane('list');
    if (state.page !== 'vault') {
      hooks.go('vault');
      return;
    }
    refreshTrees();
    drawList();
    if (changed) listHost()?.querySelector<HTMLElement>('.vx-bscroll')?.scrollTo(0, 0);
    void drawNote();
    setCrumb();
  });
}

nav.selectFolder = selectFolder;
nav.openNote = (p) => void openNote(p);
setSheetEditor((p) => void openInPane(p, true));
nav.newNote = (folder) => {
  // Ask where it goes: on its own at the vault root, or inside a folder.
  const folders = Object.keys(state.tree)
    .filter((f) => f && f !== 'Root')
    .sort((a, b) => a.localeCompare(b));
  const start = folder && folder !== 'Root' && folders.includes(folder) ? folder : '';
  const create = async (body: HTMLElement): Promise<void> => {
    const title = body.querySelector<HTMLInputElement>('#vxName')?.value.trim() || '';
    if (!title) return;
    const where = body.querySelector<HTMLElement>('#vxWhere')?.dataset.value || '';
    Modal.close();
    const p = await createNote(where, title);
    if (!p) return;
    // Start writing right away.
    await openInPane(p, true);
  };
  Modal.open({
    title: 'New node',
    body:
      Modal.field('Title', 'vxName', { value: '' }) +
      `<div class="field"><label id="vxWhereL">Location</label><div class="vx-pick" id="vxWhere" data-value="${attr(start)}">` +
      `<button type="button" class="vx-pick-btn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="vxWhereL"></button>` +
      `<div class="vx-pick-pop" hidden><input class="vx-pick-q" type="search" placeholder="Filter folders" aria-label="Filter folders" autocomplete="off">` +
      `<div class="vx-pick-list" role="listbox" aria-labelledby="vxWhereL"></div></div></div></div>`,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      { label: 'Create', cls: 'primary', run: create },
    ],
    onOpen: (body) => {
      wireFolderPick(body.querySelector<HTMLElement>('#vxWhere')!, folders);
      const input = body.querySelector<HTMLInputElement>('#vxName');
      input?.focus();
      if (input)
        input.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void create(body);
          }
        };
    },
  });
};
/** Custom location picker: vault root or one of `folders`, with a filter. */
function wireFolderPick(pick: HTMLElement, folders: string[]): void {
  const btn = pick.querySelector<HTMLButtonElement>('.vx-pick-btn')!;
  const pop = pick.querySelector<HTMLElement>('.vx-pick-pop')!;
  const q = pick.querySelector<HTMLInputElement>('.vx-pick-q')!;
  const list = pick.querySelector<HTMLElement>('.vx-pick-list')!;
  const label = (v: string): string =>
    v
      ? `<i style="--c:${attr(folderColor(v))}"></i><span>${esc(v)}</span><em>${(state.tree[v] || []).length}</em>`
      : `<i class="root"></i><span>On its own</span><em>vault root</em>`;
  const paint = (): void => {
    btn.innerHTML = label(pick.dataset.value || '') + I.caret;
  };
  let active = 0;
  const items = (): HTMLElement[] => Array.from(list.querySelectorAll<HTMLElement>('[role=option]'));
  const mark = (): void => items().forEach((o, i) => o.classList.toggle('kb', i === active));
  const fill = (): void => {
    const f = q.value.trim().toLowerCase();
    const opts = ['', ...folders].filter((v) => !f || (v || 'on its own vault root').toLowerCase().includes(f));
    list.innerHTML = opts.length
      ? opts
          .map(
            (v) =>
              `<div role="option" data-v="${attr(v)}" aria-selected="${v === (pick.dataset.value || '')}" style="--d:${v ? v.split('/').length - 1 : 0}">${label(v)}</div>`,
          )
          .join('')
      : '<p>No folder matches.</p>';
    active = Math.max(0, opts.indexOf(pick.dataset.value || ''));
    mark();
  };
  const open = (on: boolean): void => {
    pop.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    pick.classList.toggle('open', on);
    if (on) {
      q.value = '';
      fill();
      q.focus();
      items()[active]?.scrollIntoView({ block: 'nearest' });
    }
  };
  const choose = (v: string): void => {
    pick.dataset.value = v;
    paint();
    open(false);
    btn.focus();
  };
  paint();
  btn.onclick = () => open(pop.hidden);
  // Keep focus in the filter while pressing an option, or focusout closes the
  // list before the click lands and the choice is lost.
  list.onpointerdown = (e) => e.preventDefault();
  list.onmousedown = (e) => e.preventDefault();
  list.onclick = (e) => {
    const o = (e.target as HTMLElement).closest<HTMLElement>('[role=option]');
    if (o) choose(o.dataset.v || '');
  };
  q.oninput = fill;
  q.onkeydown = (e) => {
    const n = items().length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!n) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      mark();
      items()[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = items()[active];
      if (o) choose(o.dataset.v || '');
    } else if (e.key === 'Escape') {
      // Close the picker, not the modal.
      e.preventDefault();
      e.stopPropagation();
      open(false);
      btn.focus();
    }
  };
  pick.addEventListener('focusout', (e) => {
    if (!pick.contains(e.relatedTarget as Node | null)) open(false);
  });
}

nav.newFolder = (parent) => {
  promptName(parent ? `New folder in ${parent}` : 'New folder', 'Folder name', '', async (name) => {
    const p = await createFolder(parent, name);
    if (p) selectFolder(p);
  });
};

// Redraws triggered by writes, pins and agent activity.
onRefresh(() => {
  if (state.page === 'vault' && shell) void renderVault();
  else refreshTrees();
});
// Pins changed (here, on the server, in another browser): the list marks
// pinned nodes and has a Pinned filter. The trees redraw themselves.
onPinsSynced(() => {
  if (state.page === 'vault' && shell) drawList();
});
let activityTimer = 0;
onVaultChange(() => {
  // Agent activity arrives in bursts: coalesce redraws.
  clearTimeout(activityTimer);
  activityTimer = window.setTimeout(() => {
    refreshTrees();
    if (state.page === 'vault' && shell && !state.editing) {
      drawList();
    }
  }, 250);
});

document.addEventListener('vx-back', () => leaveNote());

window.matchMedia(MOBILE).addEventListener?.('change', () => {
  if (state.page === 'vault' && shell) {
    syncTreePane();
    drawList();
    void drawNote(true);
  }
});
