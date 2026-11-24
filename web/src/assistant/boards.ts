// Boards in Mnemo's chat: a preview, not the board. A board a turn names (a mention in the question,
// a link in the reply, a card Mnemo hands over, a kanban tool it used) shows as a card with its name,
// folder, how much is done (one calm progress line) and a glimpse of the first cards in each lane. A tap
// (or Open board) opens the board itself. The preview follows changes as they happen.

import { apiGet } from '../api';
import { on } from '../bus';
import { attr, esc } from '../dom';
import { hooks } from '../hooks';
import { t, tn } from '../i18n';
import { colorOfFolder, isBoard, noteTitle } from '../state';
import { icon } from '../ui/icons';
import { fadeScroll } from '../ui/scroll-fade';
import { boardInfos, boardRefsHTML, type BoardInfo } from '../views/board-card';
import type { KbBoard } from '../views/kanban';
import { mutationInfo } from '../vault/store';
import { parseCard } from '../views/card-text';

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** Boards a turn names, each once, in the order they came up; `skip` holds those already shown. */
export function boardPaths(candidates: string[], skip: Set<string> = new Set()): string[] {
  const out: string[] = [];
  for (const p of candidates) if (p && isBoard(p) && !skip.has(p) && !out.includes(p)) out.push(p);
  return out;
}

/** One board preview card. */
export function boardCardHTML(path: string): string {
  const folder = dirOf(path);
  const name = noteTitle(path);
  return `<div class="mn-kb" data-kb="${attr(path)}" style="--fc:${attr(colorOfFolder(folder))}">
    <div class="mn-kb-h">
      <span class="mn-kb-ic" aria-hidden="true">${icon('kanban')}</span>
      <button type="button" class="mn-kb-t" data-kb-go title="${attr(t('Open the board in Notes'))}" aria-label="${attr(t('Open the board {name}', { name }))}">
        <span class="mn-kb-n"><b dir="auto">${esc(name)}</b></span>
        <small class="mn-kb-sub">${esc(t('Board'))}${folder ? ` · ${esc(folder.split('/').join(' / '))}` : ''}</small>
        <span class="mn-kb-bars" aria-hidden="true"></span>
      </button>
      <button type="button" class="mn-kb-open" data-kb-go title="${attr(t('Open the board in Notes'))}" aria-label="${attr(t('Open the board {name}', { name }))}">${icon(
        'chev',
      )}</button>
    </div>
    <div class="mn-kb-peek" aria-hidden="true" hidden></div>
    <div class="mn-kb-refs"></div>
  </div>`;
}

/** Board previews in a column (several boards of one turn). */
export function boardsHTML(paths: string[]): string {
  if (!paths.length) return '';
  return `<div class="mn-kbs">${paths.map((p) => boardCardHTML(p)).join('')}</div>`;
}

/** Wire the previews under `root` (now in the page): a tap opens the board; counts, bars and the
 *  glimpse of cards are filled in. */
export function wireBoards(root: HTMLElement): void {
  const cards = root.matches('.mn-kb') ? [root] : Array.from(root.querySelectorAll<HTMLElement>('.mn-kb'));
  if (!cards.length) return;
  for (const card of cards) {
    if (card.dataset.wired) continue;
    card.dataset.wired = '1';
    card.querySelectorAll<HTMLElement>('[data-kb-go]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        hooks.openNote(card.dataset.kb || '');
      }),
    );
    // The notes this board is in (folded): each opens its note.
    card.querySelector<HTMLElement>('.mn-kb-refs')?.addEventListener('click', (e) => {
      const n = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
      if (!n) return;
      e.stopPropagation();
      hooks.openNote(n.dataset.open || '');
    });
  }
  fill(cards);
}

function summaryOf(card: HTMLElement, b: BoardInfo | undefined): void {
  const sub = card.querySelector<HTMLElement>('.mn-kb-sub');
  const bars = card.querySelector<HTMLElement>('.mn-kb-bars');
  if (!sub || !bars || !b) return;
  const folder = dirOf(b.path);
  sub.textContent = [t('{done} of {total} done', { done: b.done, total: b.cards }), tn(b.lanes.length, '{n} lane', '{n} lanes'), folder ? folder.split('/').join(' / ') : '']
    .filter(Boolean)
    .join(' · ');
  // One calm progress line (how much is done), not a bar per lane.
  bars.innerHTML = `<i style="width:${b.cards ? Math.round((b.done / b.cards) * 100) : 0}%"></i>`;
}

/** A card's first line as plain words: tags, dates and the brackets of links taken out. */
function peekTitle(text: string): string {
  const f = parseCard(text).fields;
  const words = f.text.split('\n')[0]!.replace(/\s+/g, ' ').trim();
  return words || (f.links[0] || '').split('|').pop()!.split('/').pop() || '';
}

/** The first lanes with their first card titles: a still glimpse, nothing to drag or tick. */
function peekOf(card: HTMLElement, b: KbBoard): void {
  const box = card.querySelector<HTMLElement>('.mn-kb-peek');
  if (!box) return;
  const full = b.lanes.filter((l) => l.cards.length);
  const lanes = full.slice(0, 8);
  box.innerHTML = lanes
    .map(
      (l) =>
        `<div class="mn-kb-pl"><span class="mn-kb-plh" dir="auto">${esc(l.title)}<em>${l.cards.length}</em></span>${l.cards
          .slice(0, 2)
          .map((c) => `<span class="mn-kb-pc${c.checked ? ' done' : ''}" dir="auto">${esc(peekTitle(c.text) || c.title || '')}</span>`)
          .join('')}${l.cards.length > 2 ? `<span class="mn-kb-pm">${esc(t('+{n} more', { n: l.cards.length - 2 }))}</span>` : ''}</div>`,
    )
    .join('');
  box.hidden = !lanes.length;
  fadeScroll(box, 'x');
  const refs = card.querySelector<HTMLElement>('.mn-kb-refs');
  if (refs) {
    const open = refs.querySelector('details')?.open;
    refs.innerHTML = boardRefsHTML(b.embedded_in, b.linked_from);
    const d = refs.querySelector('details');
    if (d && open) d.open = true;
  }
}

/** Notes in a reply that put boards in: a small board badge on their chips, and on their cards a
 *  folded list of those boards (name, done of all, lanes), each opening its board. From the boards
 *  list (one request), so no request per note. */
export function markNoteBoards(root: HTMLElement): void {
  void boardInfos().then((list) => {
    if (!root.isConnected) return;
    const of = new Map<string, BoardInfo[]>();
    for (const b of list) for (const n of b.embedded_in || []) of.set(n, [...(of.get(n) || []), b]);
    if (!of.size) return;
    root.querySelectorAll<HTMLElement>('.mn-att-c[data-note], .mn-att-c[data-card="note"]').forEach((c) => {
      const boards = of.get(c.dataset.note || c.dataset.path || '');
      if (!boards || c.querySelector('.mn-nb')) return;
      c.insertAdjacentHTML('beforeend', `<em class="mn-nb" title="${attr(tn(boards.length, '{n} board', '{n} boards'))}">${icon('kanban')}${boards.length}</em>`);
    });
    root.querySelectorAll<HTMLElement>('.mn-cards').forEach((grid) => {
      if (grid.dataset.nb) return;
      grid.dataset.nb = '1';
      const rows: string[] = [];
      grid.querySelectorAll<HTMLElement>('.mn-card.k-note[data-path]').forEach((c) => {
        const path = c.dataset.path || '';
        const boards = of.get(path);
        if (!boards) return;
        c.querySelector('.mn-card-t b')?.insertAdjacentHTML('afterend', `<em class="mn-nb">${icon('kanban')}${tn(boards.length, '{n} board', '{n} boards')}</em>`);
        rows.push(`<details class="mn-nbd"><summary><span>${esc(t('Boards in this note'))}</span><em>${boards.length}</em></summary>${boards
          .map((b) => {
            return `<button type="button" class="mn-nbr" data-board="${attr(b.path)}">${icon('kanban')}<span class="mn-nbr-t"><b dir="auto">${esc(b.title)}</b><small>${esc(
              t('{done} of {total} done', { done: b.done, total: b.cards }),
            )}</small></span><span class="mn-kb-bars" aria-hidden="true"><i style="width:${b.cards ? Math.round((b.done / b.cards) * 100) : 0}%"></i></span></button>`;
          })
          .join('')}</details>`);
        // The fold belongs to its note card: both in one grid cell, at the card's width.
        const w = document.createElement('div');
        w.className = 'mn-cw';
        c.before(w);
        w.appendChild(c);
        w.insertAdjacentHTML('beforeend', rows[rows.length - 1]);
      });
      if (!rows.length) return;
      grid.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('.mn-nbd [data-board]');
        if (!b) return;
        e.stopPropagation();
        hooks.openNote(b.dataset.board || '');
      });
    });
  });
}

/** Counts and bars from the boards list (one request for all), the glimpse from each board. */
function fill(cards: HTMLElement[]): void {
  void boardInfos().then((list) => {
    for (const c of cards) summaryOf(c, list.find((b) => b.path === c.dataset.kb));
  });
  for (const c of cards) {
    const path = c.dataset.kb || '';
    void apiGet<KbBoard>('/api/kanban?path=' + encodeURIComponent(path))
      .then((b) => {
        if (c.isConnected && c.dataset.kb === path) peekOf(c, b);
      })
      .catch(() => {
        /* the summary still shows */
      });
  }
}

// A board changed (an agent, another tab, the board page): its previews redraw. A renamed board
// follows its new name.
on('mutation', (ev) => {
  const m = mutationInfo(ev);
  if (m.type === 'node_renamed' && m.oldPath && m.path)
    document.querySelectorAll<HTMLElement>(`.mn-kb[data-kb="${CSS.escape(m.oldPath)}"]`).forEach((c) => (c.dataset.kb = m.path));
  if (!m.path || !isBoard(m.path)) return;
  const cards = Array.from(document.querySelectorAll<HTMLElement>(`.mn-kb[data-kb="${CSS.escape(m.path)}"]`));
  if (cards.length) fill(cards);
});
