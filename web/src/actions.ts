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

export function openMoveFolder(folder: string): void {
  askMoveFolder(folder);
}

export function confirmDeleteFolder(folder: string): void {
  confirmFolderDelete(folder);
}

export function openFolderColor(folder: string): void {
  folderLook(folder);
}
