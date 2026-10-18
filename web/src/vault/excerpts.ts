// Lazy one-line excerpts and tags for the node list: fetched only for rows
// on screen, a few at a time, cached per path and mtime (memory and
// sessionStorage, so going back to a folder paints at once).

import { apiGet } from '../api';
import { parseTags } from '../format';
import type { NoteDoc } from '../types';

export interface Excerpt {
  m: number;
  text: string;
  tags: string[];
  /** First image of the node, as a same-origin URL ('' = none). */
  img?: string;
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;

const SS_KEY = 'memora.vault.excerpts.v2';
const MAX = 3;

const cache = new Map<string, Excerpt>();
const queue: { path: string; mtime: number }[] = [];
const inflight = new Set<string>();
const listeners = new Set<(path: string) => void>();
let saveTimer = 0;

try {
  const raw = sessionStorage.getItem(SS_KEY);
  if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, Excerpt>)) cache.set(k, v);
} catch {
  /* no cache */
}

function persist(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      const obj: Record<string, Excerpt> = {};
      let n = 0;
      for (const [k, v] of cache) {
        if (n++ > 3000) break;
        obj[k] = v;
      }
      sessionStorage.setItem(SS_KEY, JSON.stringify(obj));
    } catch {
      /* quota */
    }
  }, 800);
}

/** Plain text preview of a markdown node (front matter, title, images, code and marks dropped). */
export function toExcerpt(md: string): string {
  return String(md || '')
    .replace(/^---[\s\S]*?\n---\s*/, '')
    .replace(/^#\s+.*$/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\bhttps?:\/\/\S+\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?\S*)?/gi, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\bhttps?:\/\/\S+/g, ' ')
    .replace(/(^|\s)#[\w/-]+/g, ' ')
    .replace(/^\s*([-*+]|\d+\.)\s+\[[ xX]\]/gm, ' ')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, ' ')
    .replace(/[#>*_`~|=]+|(^|\s)-+(?=\s)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Vault path of a reference made from inside `notePath` (relative to its folder). */
function vaultPath(notePath: string, ref: string): string | null {
  let r = ref.trim().split(/[|#?]/)[0];
  try {
    r = decodeURIComponent(r);
  } catch {
    /* keep as written */
  }
  if (!r || /^[a-z]+:/i.test(r) || !IMG_EXT.test(r)) return null;
  const parts = (r.startsWith('/') ? r.slice(1) : (notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/') + 1) : '') + r).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.length ? out.join('/') : null;
}

/** First image of a node: the server rendered URL when there is one, else its markdown reference. */
function firstImage(notePath: string, md: string, html: string): string {
  const src = /<img[^>]+src="([^"]+)"/i.exec(html || '')?.[1]?.replace(/&amp;/g, '&');
  if (src && src.startsWith('/api/')) return src;
  const m = /!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(\s*<?([^)\s>]+)/.exec(md || '');
  const p = m ? vaultPath(notePath, m[1] || m[2] || '') : null;
  return p ? '/api/vault/file?path=' + encodeURIComponent(p) : '';
}

/** Cached excerpt, when it is still current for `mtime`. */
export function excerptOf(path: string, mtime: number): Excerpt | undefined {
  const e = cache.get(path);
  return e && e.m >= Math.floor(mtime || 0) ? e : undefined;
}

export function onExcerpt(fn: (path: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Ask for an excerpt; listeners hear about it when it lands. */
export function wantExcerpt(path: string, mtime: number): void {
  if (excerptOf(path, mtime)) return;
  if (inflight.has(path) || queue.some((q) => q.path === path)) return;
  queue.push({ path, mtime: Math.floor(mtime || 0) });
  pump();
}

/** Drop queued requests for rows that scrolled away or were redrawn. */
export function keepExcerpts(paths: Set<string>): void {
  for (let i = queue.length - 1; i >= 0; i--) if (!paths.has(queue[i].path)) queue.splice(i, 1);
}

function pump(): void {
  while (inflight.size < MAX && queue.length) {
    const job = queue.shift()!;
    inflight.add(job.path);
    apiGet<NoteDoc>('/api/note?path=' + encodeURIComponent(job.path))
      .then((d) => {
        const tags = (d.tags && d.tags.length ? d.tags : parseTags(d.content)).slice(0, 6);
        cache.set(job.path, {
          m: Math.max(job.mtime, Math.floor(Number(d.mtime) || 0)),
          text: toExcerpt(d.content),
          tags,
          img: firstImage(job.path, d.content, d.html || ''),
        });
        persist();
      })
      .catch(() => {
        cache.set(job.path, { m: job.mtime, text: '', tags: [] });
      })
      .finally(() => {
        inflight.delete(job.path);
        listeners.forEach((fn) => fn(job.path));
        pump();
      });
  }
}
