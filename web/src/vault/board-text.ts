// Board text in the Obsidian Kanban format: a new board, and a plain note turned into one
// (headings become lanes, list items become cards).

import { t } from '../i18n';

const SETTINGS = '%% kanban:settings\n```\n{"kanban-plugin":"basic"}\n```\n%%\n';
const FM = '---\n\nkanban-plugin: basic\n\n---\n\n';

const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ').trim();

/** The default lane names, in the interface language (they become the person's own text). */
function defaultLanes(): [string, string, string] {
  return [oneLine(t('To do')), oneLine(t('Doing')), oneLine(t('Done'))];
}

/** A new, empty board: To do, Doing and Done, the last one marked Complete as Obsidian writes it. */
export function boardText(): string {
  const [a, b, c] = defaultLanes();
  return FM + `## ${a}\n\n\n\n## ${b}\n\n\n\n## ${c}\n\n**Complete**\n\n\n\n` + SETTINGS;
}

interface Lane {
  title: string;
  cards: string[];
  complete?: boolean;
}

export interface Conversion {
  /** The board's text. */
  text: string;
  lanes: number;
  cards: number;
  /** Lines of other text (paragraphs, quotes, code) that a board has no place for. */
  dropped: number;
}

const HEAD_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const ITEM_RE = /^(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;

/** Turn a plain note into a board. Frontmatter is kept (with `kanban-plugin: basic` added); with no
 *  headings, open items go to To do and finished ones to Done. */
export function toBoard(content: string, title = ''): Conversion {
  let body = content.replace(/\r\n?/g, '\n');
  let fm = '';
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(body);
  if (m) {
    const lines = m[1].split('\n').filter((l) => !/^kanban-plugin\s*:/.test(l));
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    while (lines.length && !lines[0].trim()) lines.shift();
    fm = `---\n\n${lines.length ? lines.join('\n') + '\n' : ''}kanban-plugin: basic\n\n---\n\n`;
    body = body.slice(m[0].length);
  }
  const rows = body.split('\n');
  // `#` is the note's title when the note has smaller headings too.
  const minLevel = rows.some((l) => /^#{2,6}\s/.test(l)) ? 2 : 1;
  const loose: string[] = [];
  const lanes: Lane[] = [];
  let lane: Lane | null = null;
  let card: string[] | null = null;
  let fence = false;
  let dropped = 0;
  const flush = (): void => {
    if (!card) return;
    (lane ? lane.cards : loose).push(card.join('\n'));
    card = null;
  };
  for (const raw of rows) {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      fence = !fence;
      continue;
    }
    if (fence) {
      if (line.trim()) dropped++;
      continue;
    }
    if (!line.trim()) continue;
    const h = HEAD_RE.exec(line);
    if (h) {
      flush();
      if (h[1].length < minLevel || !h[2].trim()) {
        // The note's own title is not text lost.
        if (h[2].trim().toLowerCase() !== title.trim().toLowerCase()) dropped++;
        continue;
      }
      lane = { title: oneLine(h[2]), cards: [] };
      lanes.push(lane);
      continue;
    }
    const it = /^\S/.test(line) ? ITEM_RE.exec(line) : null;
    if (it && it[2].trim()) {
      flush();
      card = [`- [${it[1] && it[1] !== ' ' ? 'x' : ' '}] ${it[2].trim()}`];
      continue;
    }
    // Indented lines under an item (sub items, a second paragraph) stay with its card.
    if (card && /^\s/.test(line)) {
      card.push('\t' + line.trim());
      continue;
    }
    flush();
    dropped++;
  }
  flush();
  const [todo, doing, done] = defaultLanes();
  if (!lanes.length) {
    lanes.push(
      { title: todo, cards: loose.filter((c) => c.startsWith('- [ ]')) },
      { title: doing, cards: [] },
      { title: done, cards: loose.filter((c) => !c.startsWith('- [ ]')), complete: true },
    );
  } else if (loose.length) lanes.unshift({ title: todo, cards: loose });
  const text =
    (fm || FM) +
    lanes
      .map((l) => `## ${l.title}\n\n${l.complete ? '**Complete**\n' : ''}${l.cards.length ? l.cards.join('\n') + '\n' : ''}\n\n`)
      .join('') +
    '\n' +
    SETTINGS;
  return { text, lanes: lanes.length, cards: lanes.reduce((n, l) => n + l.cards.length, 0), dropped };
}
