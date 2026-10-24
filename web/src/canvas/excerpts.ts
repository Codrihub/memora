// Fetched only for cards on screen, a few at a time, cached per path and mtime.

import { apiGet } from '../api';
import { parseTags } from '../format';
import type { NoteDoc } from '../types';

export interface Excerpt {
  m: number;
  text: string;
  tags: string[];
}

const SS_KEY = 'memora.canvas.excerpts';
const MAX = 3;

const cache = new Map<string, Excerpt>();
const queue: { path: string; mtime: number }[] = [];
const inflight = new Set<string>();
let listener: (path: string) => void = () => {};
let saveTimer = 0;
let holds = 0;

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

export function toExcerpt(md: string): string {
  return String(md || '')
    .replace(/^---[\s\S]*?\n---\s*/, '')
    .replace(/^#\s+.*$/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

export function onExcerpt(fn: (path: string) => void): void {
  listener = fn;
}

export function excerptOf(path: string): Excerpt | undefined {
  return cache.get(path);
}

export function invalidate(path: string): void {
  cache.delete(path);
}

export function moveExcerpt(from: string, to: string): void {
  const e = cache.get(from);
  if (e) {
    cache.delete(from);
    cache.set(to, e);
  }
}

/** Resolves through the listener when it lands. */
export function want(path: string, mtime: number): void {
  const e = cache.get(path);
  if (e && e.m >= mtime) return;
  if (inflight.has(path) || queue.some((q) => q.path === path)) return;
  queue.push({ path, mtime });
  pump();
}

export function keepOnly(paths: Set<string>): void {
  for (let i = queue.length - 1; i >= 0; i--) if (!paths.has(queue[i].path)) queue.splice(i, 1);
}

/** Hold fetches while a vault write runs (the server serializes both). */
export function holdExcerpts(on: boolean): void {
  holds = Math.max(0, holds + (on ? 1 : -1));
  if (!holds) pump();
}

function pump(): void {
  while (!holds && inflight.size < MAX && queue.length) {
    const job = queue.pop()!;
    inflight.add(job.path);
    apiGet<NoteDoc>('/api/note?path=' + encodeURIComponent(job.path))
      .then((d) => {
        const tags = (d.tags && d.tags.length ? d.tags : parseTags(d.content)).slice(0, 6);
        cache.set(job.path, { m: Math.max(job.mtime, Math.floor(Number(d.mtime) || 0)), text: toExcerpt(d.content), tags });
        persist();
        listener(job.path);
      })
      .catch(() => {
        cache.set(job.path, { m: job.mtime, text: '', tags: [] });
      })
      .finally(() => {
        inflight.delete(job.path);
        pump();
      });
  }
}
