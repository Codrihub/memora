// Write actions used through hooks (sidebar buttons, home view, shortcuts).
// They open the vault package's dialogs: new note/folder at the vault root, folder picker moves, folder look and delete flows.

import { askMoveFolder, askMoveNotes, confirmDeleteFolder as confirmFolderDelete, folderLook } from './vault/menus';
import { nav } from './vault/nav';
import './vault/view';

export function openNewNote(): void {
  nav.newNote('');
}

export function openNewFolder(): void {
  nav.newFolder('');
}

export function openMoveNote(path: string): void {
  askMoveNotes([path]);
}

/** Move a whole folder (with sub folders) into another folder. */
export function openMoveFolder(folder: string): void {
  askMoveFolder(folder);
}

export function confirmDeleteFolder(folder: string): void {
  confirmFolderDelete(folder);
}

export function openFolderColor(folder: string): void {
  folderLook(folder);
}
