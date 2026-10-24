// Notes page: an optional folder tree beside one main area, either the folder browser or the note reader.
// Both layers stay mounted so going back to a folder keeps its scroll position.

import { $, el, esc, useStyles } from '../dom';
import { hooks } from '../hooks';
import { allNotes, noteTitle, state } from '../state';
import { I } from './icons';
import { renderList, resetListQuery, resetListView } from './list';
import { nav } from './nav';
import { flushEditor, noteShown, renderNote } from './note';
import { createFolder, createNote, onRefresh, relocating } from './ops';
import {
  dirOf,
  folderAt,
  isInside,
  onPinsSynced,
  onVaultChange,
  openFolders,
  pickerFolders,
  prefs,
  saveOpen,
  savePrefs,
  selection,
  wireBus,
} from './store';
import { TreeView, refreshTrees } from './tree';
import { emptyState, promptName } from './ui';
import { fadeScroll } from '../ui/scroll-fade';
import { createFolderPicker, type FolderPicker } from './folder-picker';
import { Modal } from '../modal';
import { setToTopScroller } from '../ui/totop';
import { VAULT_CSS } from './styles';

type Pane = 'list' | 'note';

let shell: HTMLElement | null = null;
let tree: TreeView | null = null;
/** Path of a deep-linked note that is not in the vault ("note not found"). */
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

/** The shared "back to top" button follows the layer on screen. */
function syncTop(): void {
  setToTopScroller(activeScroller());
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
      <div class="vx-pane vx-pane-note" aria-label="Note"></div>
    </div>`;
  host.appendChild(shell);
  tree = new TreeView(shell.querySelector<HTMLElement>('.vx-pane-tree')!, {
    showNotes: prefs.showNotesInTree,
    showPins: true,
  });
  fadeScroll(shell.querySelector<HTMLElement>('.vx-pane-tree')!);
  wireResizers(shell);
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
  if (!h) return;
  renderList(h, isMobile());
}

async function drawNote(quiet = false): Promise<void> {
  const h = noteHost();
  if (!h) return;
  if (!state.note && missing) {
    setPane('note');
    h.innerHTML = emptyState(
      I.note,
      'Note not found',
      `“${esc(noteTitle(missing))}” may have been moved, renamed or deleted. Deleted notes wait in the Trash.`,
      '<span><button class="btn sm primary" data-home>Show all notes</button> <button class="btn sm ghost" data-trash>Open Trash</button></span>',
    ).replace('vx-empty', 'vx-empty vx-missing');
    h.querySelector<HTMLElement>('[data-trash]')!.onclick = () => nav.openTrash();
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
    ? noteTitle(state.note)
    : prefs.folder
      ? 'Notes / ' + prefs.folder
      : 'Notes';
}

/** Hide the page's own tree on phones, or when the shell sidebar already shows one. */
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

/** Open a node in the reader; a path not in the loaded tree shows "not found" and is never sent to the server. */
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

/** Stamp in-app node opens with `vxDepth` so the reader's back button never leaves the app on a deep link. */
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
  // Keep the browser behind the reader on a folder that holds the node.
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

/** "Notes" in the menu or the tab bar: All notes, with nothing left over from before. */
function showAllNotes(): void {
  prefs.filter = 'all';
  resetListView();
  selectFolder('');
}

nav.selectFolder = selectFolder;
nav.allNotes = showAllNotes;
nav.openNote = (p) => void openNote(p);
nav.newNote = (folder) => {
  const folders = pickerFolders();
  const start = folder && folder !== 'Root' && folders.includes(folder) ? folder : '';
  let picker: FolderPicker | null = null;
  const create = async (body: HTMLElement): Promise<void> => {
    const input = body.querySelector<HTMLInputElement>('#vxName');
    const title = input?.value.trim() || '';
    if (!title) {
      input?.focus();
      return;
    }
    const where = picker?.value ?? '';
    Modal.close();
    const p = await createNote(where, title);
    if (!p) return;
    await openInPane(p, true);
  };
  Modal.open({
    title: 'New note',
    body:
      Modal.field('Title', 'vxName', { value: '' }) +
      `<div class="field"><label id="vxWhereL">Location</label><div id="vxWhere"></div></div>`,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      { label: 'Create', cls: 'primary', run: create },
    ],
    onOpen: (body) => {
      picker = createFolderPicker({
        folders,
        value: start,
        label: 'Location',
        onPick: () => void create(body),
      });
      body.querySelector('#vxWhere')?.appendChild(picker.el);
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
// The trees redraw themselves on pin changes; the list does not.
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
