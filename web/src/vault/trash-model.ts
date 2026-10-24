// What a Trash entry shows, kept free of the DOM so it can be tested.

import { stemTitle } from '../format.ts';

export interface TrashItem {
  name: string;
  original?: string | null;
  deleted?: string | null;
  by?: { id: string; name: string; kind: string } | null;
  title?: string;
}

const leaf = (p: string): string => (p.split('/').pop() || p).replace(/\.md$/i, '');

/** The title an entry shows: the server's, else its file name with `_` as spaces. */
export function itemTitle(it: TrashItem): string {
  return (it.title || '').trim() || stemTitle(leaf(it.original || it.name));
}

/** Folder an entry was deleted from ('' = the top level). */
export function placeOf(it: TrashItem): string {
  const o = it.original || '';
  return o.includes('/') ? o.slice(0, o.lastIndexOf('/')) : '';
}

/** When it was deleted, in epoch seconds (0 = unknown). */
export function deletedTs(it: TrashItem): number {
  const t = it.deleted ? Date.parse(it.deleted) : NaN;
  return Number.isFinite(t) ? t / 1000 : 0;
}

/** Who deleted it: "you" for the signed-in owner, an agent's name, or '' when unknown. */
export function whoLabel(it: TrashItem): string {
  if (!it.by) return '';
  return it.by.kind === 'user' ? 'you' : it.by.name || 'an agent';
}

/** Where a restore sends notes: their original folders, one chosen folder, or the top level. */
export type RestoreChoice = { to: 'origin' } | { to: 'folder'; folder: string } | { to: 'top' };

/** The `into` of POST /api/trash/restore: undefined for the original place, `Root` for the top level. */
export function restoreInto(c: RestoreChoice): string | undefined {
  if (c.to === 'origin') return undefined;
  if (c.to === 'top') return 'Root';
  return c.folder.replace(/^\/+|\/+$/g, '') || 'Root';
}

/** A new folder `name` inside `parent` ('' = top level); null when the name is blank or has a slash. */
export function newFolderPath(parent: string, name: string): string | null {
  const n = name.trim();
  if (!n || /[\\/]/.test(n) || n === '.' || n === '..') return null;
  return parent ? `${parent}/${n}` : n;
}

/** The original places of `items`, distinct and in order ('' = top level). */
export function originPlaces(items: TrashItem[]): string[] {
  return Array.from(new Set(items.map(placeOf)));
}

/** Search the Trash by title or old folder (case and accents ignored). */
export function matchesTrash(it: TrashItem, q: string): boolean {
  const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(q.trim());
  return !n || norm(itemTitle(it)).includes(n) || norm(placeOf(it)).includes(n);
}
