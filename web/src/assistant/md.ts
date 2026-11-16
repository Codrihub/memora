// Markdown for Mnemo's replies: the docs renderer, plus [[wikilinks]] and note paths that open notes.

import { attr, esc } from '../dom';
import { renderMarkdown } from '../docs/markdown';
import { allNotes, noteTitle } from '../state';

const TOKEN = 'MNWLTOKEN';

let index: { tree: unknown; byTitle: Map<string, string>; paths: Set<string> } | null = null;

function lookup(): { byTitle: Map<string, string>; paths: Set<string> } {
  const notes = allNotes();
  if (index && index.paths.size === notes.length) return index;
  const byTitle = new Map<string, string>();
  const paths = new Set<string>();
  for (const n of notes) {
    paths.add(n.path);
    const stem = n.path.split('/').pop()!.replace(/\.md$/i, '');
    for (const k of [n.title, noteTitle(n.path), stem, n.path.replace(/\.md$/i, '')]) {
      if (k && !byTitle.has(k.toLowerCase())) byTitle.set(k.toLowerCase(), n.path);
    }
  }
  index = { tree: null, byTitle, paths };
  return index;
}

/** The note a wikilink target or a path names, if it exists. */
export function resolveNote(target: string): string | null {
  const t = target.split('|')[0].split('#')[0].trim();
  if (!t) return null;
  const { byTitle, paths } = lookup();
  if (paths.has(t)) return t;
  if (paths.has(t + '.md')) return t + '.md';
  return byTitle.get(t.toLowerCase()) ?? null;
}

function linkFor(target: string): string {
  const shown = (target.split('|')[1] ?? target.split('|')[0]).trim();
  const path = resolveNote(target);
  return path
    ? `<a href="#" class="mn-wl" data-note="${attr(path)}" title="${attr(path)}">${esc(shown)}</a>`
    : `<span class="mn-wl missing" title="No note with this name">${esc(shown)}</span>`;
}

/** Render a reply. Links open in a new tab; wikilinks and note paths open the note. */
export function renderReply(src: string): string {
  const links: string[] = [];
  // Wikilinks outside code: swap for tokens the renderer leaves alone.
  const parts = src.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  const prepped = parts
    .map((p, i) =>
      i % 2 === 1
        ? p
        : p.replace(/\[\[([^[\]\n]{1,200})\]\]/g, (_m, t: string) => {
            links.push(t);
            return `${TOKEN}${links.length - 1}X`;
          }),
    )
    .join('');
  let html = renderMarkdown(prepped, {
    link: (href) => (/^https?:\/\//i.test(href) ? { kind: 'external', href } : null),
    slugs: new Map(),
  });
  html = html.replace(new RegExp(`${TOKEN}(\\d+)X`, 'g'), (_m, n: string) => linkFor(links[Number(n)] ?? ''));
  // `Folder/Note.md` in code opens the note when it exists.
  html = html.replace(/<code>([^<]{1,300}?)<\/code>/g, (m, inner: string) => {
    const raw = inner.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    if (!/\.md$/i.test(raw)) return m;
    const path = resolveNote(raw);
    return path ? `<a href="#" class="mn-wl code" data-note="${attr(path)}"><code>${inner}</code></a>` : m;
  });
  // Headings in a chat bubble carry no ids or anchors.
  return html.replace(/<h([1-6]) id="[^"]*"/g, '<h$1').replace(/<a class="dc-anchor"[^>]*>#<\/a>/g, '');
}
