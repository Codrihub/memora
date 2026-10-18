// Vault writes the canvas performs, through the same endpoints actions.ts
// uses: POST /api/move {path,folder}, POST /api/rename {path,name},
// POST /api/folder-meta {folder,color}. Every call returns the new path.

import { apiPost } from '../api';
import type { OkResult } from '../types';
import { movedPath } from './model';

export async function moveNote(path: string, folder: string): Promise<string> {
  const r = await apiPost<OkResult & { to?: string }>('/api/move', { path, folder: folder || 'Root' });
  return (r && (r.path || r.to)) || movedPath(path, folder);
}

export async function renameNote(path: string, name: string): Promise<string> {
  const r = await apiPost<OkResult>('/api/rename', { path, name });
  return (r && r.path) || path;
}

export async function setFolderColor(folder: string, color: string): Promise<void> {
  await apiPost<OkResult>('/api/folder-meta', { folder, color });
}

export interface BatchResult {
  moved: { from: string; to: string }[];
  failed: { path: string; error: string }[];
}

/** Move many notes, a few at a time; reports each outcome. */
export async function moveMany(paths: string[], folder: string): Promise<BatchResult> {
  const out: BatchResult = { moved: [], failed: [] };
  const queue = paths.slice();
  const worker = async (): Promise<void> => {
    while (queue.length) {
      const p = queue.shift()!;
      try {
        out.moved.push({ from: p, to: await moveNote(p, folder) });
      } catch (e) {
        out.failed.push({ path: p, error: (e as Error).message });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}
