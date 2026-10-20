// Vault write operations on the existing endpoints, with undo where it is
// possible. A folder "move" or "rename" moves every note below it (the server
// has no folder move), so the old directory is left empty on disk and drops
// out of the tree.

import { apiPost } from '../api';
import { noteName } from '../format';
import { hooks } from '../hooks';
import { state } from '../state';
import type { OkResult } from '../types';
import {
  apiFolder,
  baseName,
  dirOf,
  folderPathChanged,
  isInside,
  notePathChanged,
  notesUnder,
  openFolders,
  saveOpen,
} from './store';
import { undoToast } from './ui';
import { replaceHistory } from '../router';

type Refresher = () => void;
const refreshers = new Set<Refresher>();
/** Vault UI parts register here to redraw after a write. */
export function onRefresh(fn: Refresher): () => void {
  refreshers.add(fn);
  return () => refreshers.delete(fn);
}

// Nodes being renamed or moved right now. The reader keeps showing the node
// (with a "Renaming…" state) and never reports it as missing meanwhile.
const moving = new Map<string, string>();
const relocListeners = new Set<(path: string, verb: string | null) => void>();

export function relocating(path?: string): boolean {
  return path ? moving.has(path) : moving.size > 0;
}
export function onRelocate(fn: (path: string, verb: string | null) => void): () => void {
  relocListeners.add(fn);
  return () => relocListeners.delete(fn);
}
function markMoving(path: string, verb: string | null): void {
  if (verb) moving.set(path, verb);
  else moving.delete(path);
  relocListeners.forEach((fn) => fn(path, verb));
}
/** A node changed path: the open node's URL is replaced, not pushed. */
function pathChanged(from: string, to: string): void {
  if (state.note === from) replaceHistory();
  notePathChanged(from, to);
}

export async function reload(): Promise<void> {
  try {
    await hooks.loadCore();
  } catch {
    /* loadCore swallows its own errors */
  }
  refreshers.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  });
}

/** Strip characters that cannot be part of one path segment. */
export function cleanSegment(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();
}

interface Moved {
  from: string;
  to: string;
}

async function moveOne(path: string, folder: string): Promise<Moved> {
  markMoving(path, 'Moving');
  try {
    const r = await apiPost<OkResult>('/api/move', { path, folder: apiFolder(folder) });
    const to = (r && r.path) || (folder ? folder + '/' : '') + baseName(path);
    markMoving(to, 'Moving');
    pathChanged(path, to);
    return { from: path, to };
  } finally {
    // Cleared once the tree is reloaded (moveNotes), or right away on errors.
    setTimeout(() => markMoving(path, null), 0);
  }
}

/** Move notes into a folder. Returns the moves that succeeded. */
export async function moveNotes(paths: string[], folder: string, withUndo = true): Promise<Moved[]> {
  const done: Moved[] = [];
  const errors: string[] = [];
  for (const p of paths) {
    if (dirOf(p) === folder) continue;
    try {
      done.push(await moveOne(p, folder));
    } catch (e) {
      errors.push(noteName(p) + ': ' + (e as Error).message);
    }
  }
  await reload();
  done.forEach((m) => markMoving(m.to, null));
  if (errors.length) undoToast(`${errors.length} could not be moved. ${errors[0]}`, null, 'err');
  if (done.length && withUndo) {
    const label = done.length === 1 ? `"${noteName(done[0].from)}"` : `${done.length} nodes`;
    undoToast(`Moved ${label} to ${folder || 'Vault'}`, async () => {
      for (const m of done.slice().reverse()) {
        try {
          await moveOne(m.to, dirOf(m.from));
        } catch {
          /* keep going */
        }
      }
      await reload();
      done.forEach((m) => markMoving(m.from, null));
    });
  }
  return done;
}

/**
 * Move and/or rename the folder `src` to the path `dest` on the server (one
 * directory move: sub folders, empty ones and the folder look come along).
 * Used for both "move folder into" and "rename folder".
 */
export async function relocateFolder(src: string, dest: string, verb: string, withUndo = true): Promise<boolean> {
  if (!src || src === dest || isInside(dest, src)) return false;
  const go = async (from: string, to: string): Promise<void> => {
    let cur = from;
    if (dirOf(to) !== dirOf(from)) {
      const r = await apiPost<{ to?: string }>('/api/folder/move', { folder: cur, into: dirOf(to) });
      cur = (r && r.to) || (dirOf(to) ? dirOf(to) + '/' : '') + baseName(from);
    }
    if (baseName(to) !== baseName(cur)) await apiPost('/api/folder/rename', { folder: cur, name: baseName(to) });
  };
  try {
    await go(src, dest);
  } catch (e) {
    undoToast(`Could not ${verb.toLowerCase()} "${baseName(src)}": ${(e as Error).message}`, null, 'err');
    return false;
  }
  folderPathChanged(src, dest);
  openFolders.add(dest);
  let p = dirOf(dest);
  while (p) {
    openFolders.add(p);
    p = dirOf(p);
  }
  saveOpen();
  await reload();
  if (withUndo) {
    undoToast(`${verb} "${baseName(src)}" → ${dest}`, async () => {
      try {
        await go(dest, src);
        folderPathChanged(dest, src);
      } catch (e) {
        undoToast('Undo failed: ' + (e as Error).message, null, 'err');
      }
      await reload();
    });
  }
  return true;
}

/** Move everything inside `src` into `into` ("" = top level) and drop `src`. */
export async function moveFolderContents(src: string, into: string): Promise<boolean> {
  try {
    const r = await apiPost<{ moved?: string[] }>('/api/folder/move-contents', { folder: src, into });
    folderPathChanged(src, into);
    if (into) openFolders.add(into);
    saveOpen();
    await reload();
    const n = (r && r.moved && r.moved.length) || 0;
    undoToast(`Moved ${n} item${n === 1 ? '' : 's'} from "${baseName(src)}" to ${into || 'the top level'}`, null, 'info');
    return true;
  } catch (e) {
    undoToast('Could not move the contents: ' + (e as Error).message, null, 'err');
    return false;
  }
}

export async function renameNote(path: string, name: string): Promise<string | null> {
  const clean = cleanSegment(name);
  if (!clean || clean === noteName(path)) return null;
  markMoving(path, 'Renaming');
  try {
    const r = await apiPost<OkResult>('/api/rename', { path, name: clean });
    const to = (r && r.path) || path;
    markMoving(to, 'Renaming');
    pathChanged(path, to);
    await reload();
    markMoving(to, null);
    undoToast(`Renamed to "${clean}"`, async () => {
      markMoving(to, 'Renaming');
      try {
        const back = await apiPost<OkResult>('/api/rename', { path: to, name: noteName(path) });
        pathChanged(to, (back && back.path) || path);
      } catch (e) {
        undoToast('Undo failed: ' + (e as Error).message, null, 'err');
      }
      await reload();
      markMoving(to, null);
    });
    return to;
  } catch (e) {
    undoToast('Rename failed: ' + (e as Error).message, null, 'err');
    return null;
  } finally {
    markMoving(path, null);
  }
}

export async function renameFolder(path: string, name: string): Promise<boolean> {
  const clean = cleanSegment(name);
  if (!clean || clean === baseName(path)) return false;
  const parent = dirOf(path);
  const dest = parent ? parent + '/' + clean : clean;
  return relocateFolder(path, dest, 'Renamed');
}

export async function createNote(folder: string, title: string): Promise<string | null> {
  const clean = cleanSegment(title);
  if (!clean) return null;
  try {
    const r = await apiPost<OkResult>('/api/create', { title: clean, folder: apiFolder(folder) });
    await reload();
    return (r && r.path) || null;
  } catch (e) {
    undoToast('Could not create the node: ' + (e as Error).message, null, 'err');
    return null;
  }
}

/** Create a folder (POST /api/folder takes nested paths). */
export async function createFolder(parent: string, name: string): Promise<string | null> {
  const clean = cleanSegment(name);
  if (!clean) return null;
  try {
    const want = parent ? parent + '/' + clean : clean;
    const r = await apiPost<OkResult>('/api/folder', { name: want });
    const path = (r && r.path) || want;
    if (parent) openFolders.add(parent);
    openFolders.add(path);
    saveOpen();
    await reload();
    return path;
  } catch (e) {
    undoToast('Could not create the folder: ' + (e as Error).message, null, 'err');
    return null;
  }
}

/** Delete notes for real. No undo: the server keeps a git history only. */
export async function deleteNotes(paths: string[]): Promise<number> {
  let ok = 0;
  for (const p of paths) {
    try {
      await apiPost<OkResult>('/api/delete', { path: p });
      notePathChanged(p, null);
      ok++;
    } catch (e) {
      undoToast(noteName(p) + ': ' + (e as Error).message, null, 'err');
    }
  }
  await reload();
  return ok;
}

/** Where a folder's nodes go when it is deleted: a folder to move them into, or the trash. */
export type FolderDeleteChoice = { mode: 'move'; into: string } | { mode: 'trash' };

/**
 * Delete a folder in one server call (POST /api/delete-folder). Moving keeps the
 * sub folder structure below the deleted folder inside `into` ('' = the vault
 * root) and rewrites links; trash moves every node to the vault's .Trash.
 * Returns how many nodes were moved or trashed, or null when it failed.
 */
export async function deleteFolder(path: string, choice: FolderDeleteChoice): Promise<number | null> {
  const notes = notesUnder(path).map((n) => n.path);
  const body: Record<string, string> = { folder: path };
  if (choice.mode === 'trash') body.mode = 'trash';
  else body.into = choice.into || 'Root';
  try {
    const r = await apiPost<{ moved?: string[]; count?: number }>('/api/delete-folder', body);
    const moved = new Set(r.moved || []);
    for (const n of notes) {
      // Moved nodes land at into/<path below the folder> (a clash adds -N).
      const guess = choice.mode === 'move' ? joinPath(choice.into, n.slice(path.length + 1)) : '';
      notePathChanged(n, moved.has(guess) ? guess : null);
    }
    folderPathChanged(path, null);
    await reload();
    return choice.mode === 'trash' ? (r.count ?? notes.length) : moved.size;
  } catch (e) {
    undoToast('Could not delete the folder: ' + (e as Error).message, null, 'err');
    await reload();
    return null;
  }
}

function joinPath(dir: string, rest: string): string {
  return dir ? dir + '/' + rest : rest;
}

export async function setFolderMeta(folder: string, patch: { color?: string; icon?: string }): Promise<void> {
  try {
    // "" clears a field on the server.
    await apiPost<OkResult>('/api/folder-meta', { folder, ...patch });
    const next: Record<string, string | undefined> = { ...(state.folderMeta[folder] || {}), ...patch };
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    state.folderMeta[folder] = next;
    refreshers.forEach((fn) => fn());
    hooks.renderTree();
  } catch (e) {
    undoToast('Failed: ' + (e as Error).message, null, 'err');
  }
}

export async function saveNote(path: string, content: string): Promise<void> {
  await apiPost<OkResult>('/api/save', { path, content });
}
