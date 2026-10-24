// Cross-module service registry that breaks import cycles; main.ts assigns the implementations at boot.

import type { Page } from './state';

interface Hooks {
  openNote: (path: string) => void;
  /** Redraw the sidebar tree and the pinned list. */
  renderTree: () => void;
  /** Re-read tree, stats, folder metadata and health. */
  loadCore: () => Promise<void>;
  go: (page: Page) => void;
  /** Redraw whichever view is currently visible. */
  refreshPage: () => void;
  refreshTree: () => void;
  refreshVault: () => void;
  refreshLogs: () => void;
  /** Write dialogs (implemented in actions.ts). */
  openMoveNote: (path: string) => void;
  openMoveFolder: (folder: string) => void;
  openFolderColor: (folder: string) => void;
  confirmDeleteFolder: (folder: string) => void;
  openNewNote: () => void;
  openNewFolder: () => void;
  /** Show the Trash on the Notes page. */
  openTrash: () => void;
  /** The server switched to another vault folder. */
  vaultChanged: (vault: string) => void;
}

export const hooks: Hooks = {
  openNote: () => {},
  renderTree: () => {},
  loadCore: async () => {},
  go: () => {},
  refreshPage: () => {},
  refreshTree: () => {},
  refreshVault: () => {},
  refreshLogs: () => {},
  openMoveNote: () => {},
  openMoveFolder: () => {},
  openFolderColor: () => {},
  confirmDeleteFolder: () => {},
  openNewNote: () => {},
  openNewFolder: () => {},
  openTrash: () => {},
  vaultChanged: () => {},
};
