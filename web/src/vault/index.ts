// Public entry of the vault package.

import { useStyles } from '../dom';
import { hooks } from '../hooks';
import { state } from '../state';
import { askMoveFolder, askMoveNotes, confirmDeleteFolder, folderLook } from './menus';
import { nav } from './nav';
import { wireBus } from './store';
import { VAULT_CSS } from './styles';
import { mountTree as mount, refreshTrees, type TreeOptions, type TreeView } from './tree';
import { renderTrash } from './trash';
import { openNote, renderVault } from './view';

export { openNote, renderTrash, renderVault };

export function mountTree(container: HTMLElement, opts: Partial<TreeOptions> = {}): TreeView {
  useStyles('vx-styles', VAULT_CSS);
  wireBus();
  return mount(container, opts);
}

/** Points the shared hooks at the vault; call after main.ts has assigned its own hooks. */
export function initVault(): void {
  useStyles('vx-styles', VAULT_CSS);
  wireBus();
  const redraw = (): void => {
    refreshTrees();
    if (state.page === 'vault') void renderVault();
  };
  hooks.renderTree = refreshTrees;
  hooks.refreshTree = refreshTrees;
  hooks.refreshVault = redraw;
  hooks.openNote = (p: string) => void openNote(p);
  // Global "New note" / "New folder" start at the vault root.
  hooks.openNewNote = () => nav.newNote('');
  hooks.openNewFolder = () => nav.newFolder('');
  hooks.openTrash = () => nav.openTrash();
  nav.openTrash = () => hooks.go('trash');
  hooks.openMoveNote = (p: string) => askMoveNotes([p]);
  hooks.openMoveFolder = (f: string) => askMoveFolder(f);
  hooks.openFolderColor = (f: string) => folderLook(f);
  hooks.confirmDeleteFolder = (f: string) => confirmDeleteFolder(f);
}
