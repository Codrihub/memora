// Cross-module service registry. Modules that would otherwise import each other
// in a circle (sidebar, notes, actions, views) call through here. main.ts
// assigns the real implementations once at boot, so the import graph stays a
// directed acyclic graph and module init order never matters.

import type { Page } from './state';

interface Hooks {
  /** Open a note in the vault view. */
  openNote: (path: string) => void;
  /** Redraw the sidebar tree and the pinned list. */
  renderTree: () => void;
  /** Re-read tree, stats, folder metadata and health. */
  loadCore: () => Promise<void>;
  /** Switch the visible view. */
  go: (page: Page) => void;
  /** Redraw whichever view is currently visible. */
  refreshPage: () => void;
  /** Redraw the sidebar tree. */
  refreshTree: () => void;
  /** Redraw the vault note list. */
  refreshVault: () => void;
  /** Redraw the home view. */
  refreshHome: () => void;
  /** Redraw the graph view. */
  refreshGraph: () => void;
  /** Redraw the logs view. */
  refreshLogs: () => void;
  /** Write dialogs (implemented in actions.ts). */
  openMoveNote: (path: string) => void;
  openMoveFolder: (folder: string) => void;
  openFolderColor: (folder: string) => void;
  confirmDeleteFolder: (folder: string) => void;
  openNewNote: () => void;
  openNewFolder: () => void;
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
  refreshHome: () => {},
  refreshGraph: () => {},
  refreshLogs: () => {},
  openMoveNote: () => {},
  openMoveFolder: () => {},
  openFolderColor: () => {},
  confirmDeleteFolder: () => {},
  openNewNote: () => {},
  openNewFolder: () => {},
  vaultChanged: () => {},
};
