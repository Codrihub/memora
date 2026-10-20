// Core vault data: tree, folder list, stats, folder metadata and health. These calls
// together feed the sidebar, the stat line and every view header.

import { apiGet } from './api';
import { $ } from './dom';
import { hooks } from './hooks';
import { state } from './state';
import type { FolderMetaMap, Health, Stats, Tree } from './types';

export async function loadCore(): Promise<void> {
  const [tree, folders, stats, meta, health] = await Promise.all([
    apiGet<Tree>('/api/tree').catch(() => ({} as Tree)),
    // null keeps the last list when the call fails (an older server has no /api/folders).
    apiGet<{ folders?: string[] }>('/api/folders').catch(() => null),
    apiGet<Stats>('/api/stats').catch(() => ({ notes: 0, links: 0, folders: 0 })),
    apiGet<FolderMetaMap>('/api/folder-meta').catch(() => ({} as FolderMetaMap)),
    apiGet<Health>('/healthz').catch(() => ({} as Health)),
  ]);
  state.tree = tree || {};
  if (folders) state.folders = Array.isArray(folders.folders) ? folders.folders : [];
  state.stats = stats || state.stats;
  state.folderMeta = meta || {};
  state.health = health || {};
  hooks.renderTree();
  renderStats();
}

function renderStats(): void {
  const n = (v: number | undefined, one: string): string => (v || 0).toLocaleString() + ' ' + one + (v === 1 ? '' : 's');
  $('#statNotes').textContent = n(state.stats.notes, 'node');
  $('#statLinks').textContent = n(state.stats.links, 'link');
  $('#statFolders').textContent = n(state.stats.folders, 'folder');
}
