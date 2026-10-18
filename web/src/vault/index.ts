// Public entry of the vault package.
//
// Shell integration (main.ts / sidebar.ts belong to the Shell package):
//   - `mountTree(container)` draws the pinned section and the folder tree into
//     any element (the sidebar), returning the live TreeView.
//   - `initVault()` points the shared hooks at the vault implementations. Call
//     it AFTER main.ts has assigned its own hooks (it overrides renderTree,
//     refreshTree, openNote, refreshVault and the write dialogs).

import { useStyles } from '../dom';
import { hooks } from '../hooks';
import { state } from '../state';
import { askMoveFolder, askMoveNotes, confirmDeleteFolder, folderLook } from './menus';
import { nav } from './nav';
import { wireBus } from './store';
import { VAULT_CSS } from './styles';
import { mountTree as mount, refreshTrees, type TreeOptions, type TreeView } from './tree';
import { openNote, renderVault } from './view';

export { openNote, renderVault };

export function mountTree(container: HTMLElement, opts: Partial<TreeOptions> = {}): TreeView {
  useStyles('vx-styles', VAULT_CSS);
  wireBus();
  return mount(container, opts);
}

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
  // Global "New node" / "New folder" start at the vault root; actions on a
  // folder (its menu, its view) pass that folder themselves.
  hooks.openNewNote = () => nav.newNote('');
  hooks.openNewFolder = () => nav.newFolder('');
  hooks.openMoveNote = (p: string) => askMoveNotes([p]);
  hooks.openMoveFolder = (f: string) => askMoveFolder(f);
  hooks.openFolderColor = (f: string) => folderLook(f);
  hooks.confirmDeleteFolder = (f: string) => confirmDeleteFolder(f);
}
