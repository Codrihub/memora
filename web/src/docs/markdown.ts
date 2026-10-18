// A small, safe Markdown renderer for the documentation page.
//
// Everything is escaped; raw HTML in the source shows up as text. Supported:
// ATX headings, paragraphs, nested lists, fenced code, inline code, links
// (inline, reference and bare http(s) URLs), tables, blockquotes (with
// note / warning callouts), horizontal rules, bold and italic. Images are
// dropped: the docs page never loads remote or repository files.

import { esc } from '../dom';

/** Where a link in a document points, decided by the caller. */
export type LinkTarget =
  | { kind: 'doc'; slug: string; hash: string }
  | { kind: 'external'; href: string }
  | null;

export interface MdOptions {
  /** Resolve a link href found in the document (already trimmed). */
  link: (href: string) => LinkTarget;
  /** Heading slug counts, shared by every part of one page so ids stay unique. */
  slugs: Map<string, number>;
  /** Drop the first level-1 heading (the page draws its own title). */
  dropH1?: boolean;
}

/** Element id prefix for headings, so a heading never collides with an app id. */
export const HEADING_PREFIX = 'd-';

/** GitHub-style heading anchor: lower case, punctuation dropped, spaces to dashes. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** A unique anchor for `text` on the page that owns `slugs`. */
export function uniqueSlug(text: string, slugs: Map<string, number>): string {
  const base = slugify(text) || 'section';
  const n = slugs.get(base);
  slugs.set(base, (n ?? -1) + 1);
  return n === undefined ? base : `${base}-${n + 1}`;
}

/** Heading markup shared by Markdown and the hand-written sections. */
export function headingHTML(level: number, anchor: string, inner: string): string {
  return `<h${level} id="${HEADING_PREFIX}${esc(anchor)}" class="dc-h"><span>${inner}</span><a class="dc-anchor" href="#${esc(
    anchor,
  )}" data-anchor="${esc(anchor)}" aria-label="Link to this section">#</a></h${level}>`;
}

/** A code block with a language label and a Copy button (the view wires it). */
export function codeBlockHTML(code: string, lang = '', label = ''): string {
  const tag = label || lang || 'text';
  return `<div class="dc-code"><div class="dc-code-bar"><span>${esc(tag)}</span><button type="button" class="dc-copy" data-copy-code aria-label="Copy code">Copy</button></div><pre><code>${esc(
    code,
  )}</code></pre></div>`;
}

/** A note or warning box. `body` is trusted HTML from the caller. */
export function calloutHTML(kind: 'note' | 'warning' | 'tip', title: string, body: string): string {
  return `<aside class="dc-callout ${kind}" role="note"><b class="dc-callout-t">${esc(title)}</b><div>${body}</div></aside>`;
}

/* ───────────────────────── inline ───────────────────────── */

type Refs = Map<string, string>;

const INLINE =
  /\\([\\`*_{}[\]()#+\-.!|<>~])|(`+)([\s\S]*?[^`]|[^`])\2(?!`)|!\[((?:[^[\]]|\[[^\]]*\])*)\](?:\(([^()\s]*)(?:\s+"[^"]*")?\)|\[([^\]]*)\])?|\[((?:[^[\]]|\[[^\]]*\])*)\](?:\(([^()\s]*(?:\([^()\s]*\))?[^()\s]*)(?:\s+"[^"]*")?\)|\[([^\]]*)\])?|<(https?:\/\/[^\s<>]+)>|\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__(?!\w)|(?<![\w*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?![\w*])|(?<![\w_])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\w_])/g;

const BARE_URL = /https?:\/\/[^\s<>()]*[^\s<>().,;:!?"'\]]/g;

function linkHTML(target: LinkTarget, inner: string): string {
  if (!target || !inner) return inner;
  if (target.kind === 'external') {
    return `<a href="${esc(target.href)}" target="_blank" rel="noopener noreferrer" class="dc-ext">${inner}</a>`;
  }
  const href = `/docs/${target.slug}${target.hash ? '#' + target.hash : ''}`;
  return `<a href="${esc(href)}" data-doc="${esc(target.slug)}" data-hash="${esc(target.hash)}">${inner}</a>`;
}

function textHTML(s: string, o: MdOptions): string {
  let out = '';
  let last = 0;
  for (const m of s.matchAll(BARE_URL)) {
    out += esc(s.slice(last, m.index));
    out += linkHTML(o.link(m[0]), esc(m[0]));
    last = (m.index ?? 0) + m[0].length;
  }
  return out + esc(s.slice(last));
}

/** Inline Markdown to HTML. */
export function inline(src: string, o: MdOptions, refs: Refs = new Map(), inLink = false): string {
  let out = '';
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0;
    out += inLink ? esc(src.slice(last, at)) : textHTML(src.slice(last, at), o);
    last = at + m[0].length;
    if (m[1] !== undefined) {
      out += esc(m[1]);
    } else if (m[2] !== undefined) {
      let code = m[3].replace(/\n/g, ' ');
      if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
      out += `<code>${esc(code)}</code>`;
    } else if (m[4] !== undefined) {
      // Image: dropped on purpose (see the module comment).
    } else if (m[7] !== undefined) {
      const text = m[7];
      const href = m[8] ?? (m[9] !== undefined ? refs.get((m[9] || text).toLowerCase()) : refs.get(text.toLowerCase()));
      const inner = inline(text, o, refs, true);
      if (href === undefined) {
        // Not a link after all: keep the brackets as text.
        out += '[' + inner + ']' + (m[9] !== undefined ? '[' + esc(m[9]) + ']' : '');
      } else if (inLink) {
        out += inner;
      } else {
        out += linkHTML(o.link(href.trim()), inner.trim());
      }
    } else if (m[10] !== undefined) {
      out += inLink ? esc(m[10]) : linkHTML(o.link(m[10]), esc(m[10]));
    } else if (m[11] !== undefined || m[12] !== undefined) {
      out += `<strong>${inline(m[11] ?? m[12], o, refs, inLink)}</strong>`;
    } else if (m[13] !== undefined || m[14] !== undefined) {
      out += `<em>${inline(m[13] ?? m[14], o, refs, inLink)}</em>`;
    }
  }
  out += inLink ? esc(src.slice(last)) : textHTML(src.slice(last), o);
  return out;
}

/** Heading text without Markdown marks, for anchors and the contents list. */
export function plainText(src: string): string {
  return src
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])?/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|\W)[*_](.*?)[*_](?=\W|$)/g, '$1$2')
    .replace(/\\(.)/g, '$1')
    .trim();
}

/* ───────────────────────── blocks ───────────────────────── */

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const QUOTE = /^ {0,3}>/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const REF_DEF = /^ {0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/;

function indentOf(line: string): number {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0].replace(/\t/g, '    ').length : 0;
}

function dedent(line: string, n: number): string {
  let i = 0;
  let w = 0;
  while (i < line.length && w < n && (line[i] === ' ' || line[i] === '\t')) {
    w += line[i] === '\t' ? 4 : 1;
    i++;
  }
  return line.slice(i);
}

function isTableStart(lines: string[], i: number): boolean {
  return lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-');
}

function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i];
  return FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || LIST.test(l) || isTableStart(lines, i);
}

/** Split a table row on pipes outside code spans; `\|` stays a literal pipe. */
function splitRow(row: string): string[] {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let tick = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      cur += '\\|';
      i++;
    } else if (c === '`') {
      let run = 1;
      while (s[i + run] === '`') run++;
      cur += '`'.repeat(run);
      i += run - 1;
      tick = tick === run ? 0 : tick || run;
    } else if (c === '|' && !tick) {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  // Inside code spans the escaped pipe is shown as a pipe.
  return cells.map((c) => c.replace(/`[^`]*`/g, (code) => code.replace(/\\\|/g, '|')));
}

function tableHTML(lines: string[], o: MdOptions, refs: Refs): string {
  const head = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''));
  const cell = (tag: string, text: string, i: number): string =>
    `<${tag}${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${inline(text, o, refs)}</${tag}>`;
  const thead = head.some((h) => h) ? `<thead><tr>${head.map((h, i) => cell('th', h, i)).join('')}</tr></thead>` : '';
  const rows = lines
    .slice(2)
    .map((l) => {
      const cells = splitRow(l);
      return `<tr>${head.map((_, i) => cell('td', cells[i] ?? '', i)).join('')}</tr>`;
    })
    .join('');
  return `<div class="dc-table"><table>${thead}<tbody>${rows}</tbody></table></div>`;
}

function quoteHTML(body: string[], o: MdOptions, refs: Refs): string {
  const first = (body.find((l) => l.trim()) || '').trim();
  const gh = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(first);
  const bold = /^\*\*(Note|Tip|Important|Warning|Caution)\*\*:?\s*/i.exec(first);
  if (gh || bold) {
    const word = (gh ? gh[1] : bold![1]).toLowerCase();
    const kind = word === 'warning' || word === 'caution' ? 'warning' : word === 'tip' ? 'tip' : 'note';
    const idx = body.findIndex((l) => l.trim());
    const rest = body.slice();
    if (gh) rest.splice(idx, 1);
    else rest[idx] = rest[idx].trim().slice(bold![0].length);
    return calloutHTML(kind, word[0].toUpperCase() + word.slice(1), blocks(rest, o, refs));
  }
  return `<blockquote>${blocks(body, o, refs)}</blockquote>`;
}

interface Item {
  lines: string[];
  loose: boolean;
}

function listHTML(lines: string[], start: number, o: MdOptions, refs: Refs): [string, number] {
  const first = LIST.exec(lines[start])!;
  const base = indentOf(lines[start]);
  const ordered = /\d/.test(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items: Item[] = [];
  let content = base + first[2].length + 1;
  let i = start;
  let blank = false;
  while (i < lines.length) {
    const line = lines[i];
    const m = LIST.exec(line);
    const ind = indentOf(line);
    if (m && ind === base && /\d/.test(m[2]) === ordered) {
      if (blank && items.length) items[items.length - 1].loose = true;
      content = ind + m[2].length + Math.max(1, Math.min(4, m[3].length));
      items.push({ lines: [m[4]], loose: false });
      blank = false;
    } else if (!line.trim()) {
      // A blank line ends the list unless more of it follows.
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length) break;
      const nm = LIST.exec(lines[j]);
      const nind = indentOf(lines[j]);
      if (nind > base || (nm && nind === base && /\d/.test(nm[2]) === ordered)) {
        items[items.length - 1].lines.push('');
        blank = true;
      } else break;
    } else if (ind > base) {
      items[items.length - 1].lines.push(dedent(line, Math.min(ind, content)));
      if (blank) items[items.length - 1].loose = true;
      blank = false;
    } else if (!blank && !startsBlock(lines, i)) {
      // Lazy continuation of the item's paragraph.
      items[items.length - 1].lines.push(line.trim());
    } else break;
    i++;
  }
  const lis = items
    .map((it) => {
      while (it.lines.length && !it.lines[it.lines.length - 1].trim()) it.lines.pop();
      let html = blocks(it.lines, o, refs);
      if (!it.loose) html = html.replace(/<p>([\s\S]*?)<\/p>/g, '$1');
      const task = /^\[( |x|X)\]\s+/.exec(it.lines[0] || '');
      if (task) {
        html = html.replace(/^\[( |x|X)\]\s+/, '');
        return `<li class="dc-task"><span class="dc-box${task[1] === ' ' ? '' : ' on'}" aria-hidden="true"></span>${html}</li>`;
      }
      return `<li>${html}</li>`;
    })
    .join('');
  const tag = ordered ? 'ol' : 'ul';
  return [`<${tag}${ordered && startNum !== 1 ? ` start="${startNum}"` : ''}>${lis}</${tag}>`, i];
}

function blocks(lines: string[], o: MdOptions, refs: Refs): string {
  let out = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const pad = fence[1].length;
      const mark = fence[2];
      const code: string[] = [];
      i++;
      while (i < lines.length && !new RegExp('^\\s*' + mark[0] + '{' + mark.length + ',}\\s*$').test(lines[i])) {
        code.push(dedent(lines[i], pad));
        i++;
      }
      i++;
      out += codeBlockHTML(code.join('\n'), fence[3]);
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      i++;
      const level = h[1].length;
      if (level === 1 && o.dropH1) {
        o.dropH1 = false;
        continue;
      }
      out += headingHTML(level, uniqueSlug(plainText(h[2]), o.slugs), inline(h[2], o, refs));
      continue;
    }
    if (HR.test(line)) {
      out += '<hr>';
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || !startsBlock(lines, i))) {
        body.push(lines[i].replace(/^ {0,3}> ?/, ''));
        i++;
      }
      out += quoteHTML(body, o, refs);
      continue;
    }
    if (isTableStart(lines, i)) {
      const rows = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(lines[i++]);
      out += tableHTML(rows, o, refs);
      continue;
    }
    if (LIST.test(line) && LIST.exec(line)![4].trim() !== '') {
      const [html, next] = listHTML(lines, i, o, refs);
      out += html;
      i = next;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(lines, i))) {
      para.push(lines[i].trim());
      i++;
    }
    const html = inline(para.join('\n'), o, refs).replace(/\n/g, ' ').trim();
    // A paragraph of only images (badges, screenshots) renders as nothing.
    if (html) out += `<p>${html}</p>`;
  }
  return out;
}

/** Render a Markdown document to safe HTML. */
export function renderMarkdown(src: string, o: MdOptions): string {
  const refs: Refs = new Map();
  const lines: string[] = [];
  let inFence = false;
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    if (FENCE.test(raw)) inFence = !inFence;
    const def = inFence ? null : REF_DEF.exec(raw);
    if (def) refs.set(def[1].toLowerCase(), def[2]);
    else lines.push(raw);
  }
  return blocks(lines, o, refs);
}

/** One `## Heading` part of a document (up to the next level-2 heading), or ''. */
export function mdPart(src: string, heading: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => l.trim() === '## ' + heading);
  if (start < 0) return '';
  let end = start + 1;
  let fence = false;
  for (; end < lines.length; end++) {
    if (FENCE.test(lines[end])) fence = !fence;
    if (!fence && /^##\s/.test(lines[end])) break;
  }
  return lines.slice(start, end).join('\n');
}
