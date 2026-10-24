import { apiGet } from './api';
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
}

/** Top-level folders as the Notes tree lists them (the server's stat also counts "Root"). */
export function folderCount(): number {
  if (state.folders.length) return new Set(state.folders.map((f) => f.split('/')[0]).filter((f) => f && !/^root$/i.test(f) && !f.startsWith('.'))).size;
  return state.stats.folders || 0;
}
