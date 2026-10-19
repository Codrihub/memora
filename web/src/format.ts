// Value formatting helpers. All user facing output is English (en-US).

import { SWATCH_COLORS as FOLDER_FALLBACK } from './icons';

export function fmtTs(ts?: number | null): string {
  if (!ts) return '-';
  return new Date(Number(ts) * 1000).toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relTs(ts?: number | null): string {
  if (!ts) return '-';
  const s = Date.now() / 1000 - Number(ts);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 2592000) return Math.floor(s / 86400) + ' d ago';
  return fmtTs(ts);
}

export function dayLabel(ts?: number | null): string {
  return new Date(Number(ts) * 1000).toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function trunc(value: unknown, n: number): string {
  const s = String(value == null ? '' : value);
  return s.length > n ? s.slice(0, n - 1) + '...' : s;
}

/** Top level folder of a note path, or Root for an unfiled note. */
export function folderOf(p?: string | null): string {
  const parts = String(p || '').split('/');
  return parts.length > 1 ? parts[0] : 'Root';
}

export function noteName(p?: string | null): string {
  return String(p || '')
    .split('/')
    .pop()!
    .replace(/\.md$/, '');
}

export function hashColor(s?: string | null): string {
  let h = 0;
  const v = String(s || '');
  for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) >>> 0;
  return FOLDER_FALLBACK[h % FOLDER_FALLBACK.length];
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: number | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** Frontmatter `tags:` plus inline #tags, de-duplicated. */
export function parseTags(content?: string | null): string[] {
  const out = new Set<string>();
  const src = content || '';
  const fm = /(?:^|\n)tags\s*:\s*(.*)/i.exec(src);
  if (fm) {
    fm[1]
      .replace(/[\[\]'"]/g, ' ')
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, '').trim())
      .filter(Boolean)
      .forEach((t) => out.add(t));
  }
  (src.match(/(^|\s)#([A-Za-z0-9_][\w/-]{1,48})/g) || []).forEach((m) =>
    out.add(m.trim().replace(/^#/, '')),
  );
  return Array.from(out);
}

/** Targets of [[wikilink]], [[target|label]] and table-safe [[target\|label]] references. */
export function wikilinks(content?: string | null): string[] {
  const raw = String(content || '').match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) || [];
  return Array.from(
    new Set(
      raw
        .map((m) =>
          m
            .replace(/^\[\[|\]\]$/g, '')
            .split('|')[0]
            .replace(/\\$/, '')
            .trim(),
        )
        .filter(Boolean),
    ),
  );
}
