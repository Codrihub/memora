// Markdown for Mnemo's replies: the docs renderer, plus [[wikilinks]] and note paths that open notes.

import { attr, esc } from '../dom';
import { renderMarkdown } from '../docs/markdown';
import { allNotes, noteTitle } from '../state';
import { icon } from '../ui/icons';

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

/** Languages whose code blocks become a file card once the reply is done. */
const ART_LANGS = /^(html|htm|svg)$/i;

/** A finished HTML or SVG block as a file card: tap it to open the preview beside the chat
 *  (full screen on tablets and phones). The source stays inside, hidden. */
function fileCard(lang: string, code: string): string {
  const kind = lang.toLowerCase() === 'svg' ? 'svg' : 'html';
  const KIND = kind.toUpperCase();
  const t = /&lt;title&gt;([^&<]{1,80})&lt;\/title&gt;/i.exec(code)?.[1]?.trim();
  const title = t || (kind === 'svg' ? 'Image' : 'Page');
  const lines = code.split('\n').length;
  return (
    `<div class="mn-file" data-art="${kind}" data-title="${attr(title)}" role="button" tabindex="0" aria-label="Open ${attr(title)} (${KIND})">` +
    `<span class="mn-file-ic">${icon('code')}</span>` +
    `<span class="mn-file-t"><b>${esc(title)}</b><small>${kind === 'svg' ? 'SVG image' : 'HTML page'} · ${lines} line${lines === 1 ? '' : 's'}</small></span>` +
    `<span class="mn-file-a"><span class="mn-file-open">${icon('eye')}<span>Open</span></span>` +
    `<button type="button" class="mn-file-dl" data-file-dl title="Download the ${KIND} file" aria-label="Download the ${KIND} file">${icon('download')}</button></span>` +
    `<pre class="mn-file-src" hidden><code>${code}</code></pre></div>`
  );
}

/** Render a reply. Links open in a new tab; wikilinks and note paths open the note.
 *  `live` while it streams: HTML blocks stay code until the reply is done, then become file cards. */
export function renderReply(src: string, live = false): string {
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
  if (!live)
    html = html.replace(
      /<div class="dc-code"><div class="dc-code-bar"><span>([a-z]+)<\/span>[\s\S]*?<\/div><pre><code>([\s\S]*?)<\/code><\/pre><\/div>/gi,
      (m, lang: string, code: string) => (ART_LANGS.test(lang) ? fileCard(lang, code) : m),
    );
  // Headings in a chat bubble carry no ids or anchors.
  return html.replace(/<h([1-6]) id="[^"]*"/g, '<h$1').replace(/<a class="dc-anchor"[^>]*>#<\/a>/g, '');
}
