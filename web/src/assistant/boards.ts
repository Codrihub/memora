// Boards in Mnemo's chat: a preview, not the board. A board a turn names (a mention in the question,
// a link in the reply, a card Mnemo hands over, a kanban tool it used) shows as a card with its name,
// folder, how much is done (one calm progress line) and a glimpse of the first cards in each lane. A tap
// (or Open board) opens the board itself. The preview follows changes as they happen.

import { apiGet } from '../api';
import { on } from '../bus';
import { attr, esc, useStyles } from '../dom';
import { hooks } from '../hooks';
import { t, tn } from '../i18n';
import { colorOfFolder, isBoard, noteTitle } from '../state';
import { icon } from '../ui/icons';
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

// Layout of the preview (on top of the shared chat styles): the header holds an Open board action and a
// fold for the whole preview; lanes below are an accordion, each folding its own first cards. Flat rows,
// no box in a box. The "In N notes" fold sits under the title column and wraps on a narrow chat.
const KB_CSS = `
.mn-kb.mn-kbx{container:mnkb/inline-size}
.mn-kbx .mn-kb-h{align-items:flex-start;gap:10px}
.mn-kbx .mn-kb-n b{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;white-space:normal;overflow-wrap:break-word;line-height:1.3}
.mn-kbx .mn-kb-sub{white-space:normal}
.mn-kbx .mn-kb-acts{flex:none;display:flex;align-items:center;gap:2px;margin-top:2px}
.mn-kbx .mn-kb-go,.mn-kbx .mn-kb-fold{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;min-width:32px;padding:0 8px;border:0;border-radius:8px;
  background:none;color:var(--muted);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.mn-kbx .mn-kb-go{color:var(--text-2)}
@media (hover:hover){.mn-kbx .mn-kb-go:hover,.mn-kbx .mn-kb-fold:hover{background:var(--hover);color:var(--fg)}}
.mn-kbx .mn-kb-go:focus-visible,.mn-kbx .mn-kb-fold:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.mn-kbx .mn-kb-go .i{width:14px;height:14px}
.mn-kbx .mn-kb-fold{padding:0}
.mn-kbx .mn-kb-fold .i{width:14px;height:14px;transform:rotate(90deg);transition:transform .15s}
.mn-kbx.fold .mn-kb-fold .i{transform:none}
[dir=rtl] .mn-kbx.fold .mn-kb-fold .i{transform:rotate(180deg)}
.mn-kbx.fold .mn-kb-body{display:none}
.mn-kbx .mn-kb-body{min-width:0}
.mn-kb.mn-kbx .mn-kb-peek{display:flex;flex-direction:column;gap:0;margin:0 12px 8px 54px;overflow:visible}
[dir=rtl] .mn-kb.mn-kbx .mn-kb-peek{margin:0 54px 8px 12px}
.mn-kb.mn-kbx .mn-kb-peek[hidden]{display:none}
.mn-kb.mn-kbx .mn-kb-peek>.mn-kb-pl{flex:none;width:auto;padding:0;border-radius:0;background:none;gap:0;border-top:1px solid var(--line)}
.mn-kbx .mn-kb-pl>summary{display:flex;align-items:center;gap:8px;min-height:34px;padding:0 4px;list-style:none;cursor:pointer;user-select:none;
  font-size:12px;font-weight:650;color:var(--text-2);border-radius:6px;white-space:normal;overflow:visible}
.mn-kbx .mn-kb-pl>summary::-webkit-details-marker{display:none}
.mn-kbx .mn-kb-pl>summary::before{content:"";flex:none;width:5px;height:5px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;
  transform:rotate(-45deg);transition:transform .15s;margin-inline:1px 3px}
[dir=rtl] .mn-kbx .mn-kb-pl>summary::before{transform:rotate(135deg)}
.mn-kbx .mn-kb-pl[open]>summary::before{transform:rotate(45deg)}
@media (hover:hover){.mn-kbx .mn-kb-pl>summary:hover{color:var(--fg)}}
.mn-kbx .mn-kb-pl>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.mn-kbx .mn-kb-pln{flex:1;min-width:0;overflow-wrap:break-word}
.mn-kbx .mn-kb-pl>summary em{flex:none;font-style:normal;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}
.mn-kbx .mn-kb-pcs{display:flex;flex-direction:column;gap:1px;padding:0 4px 8px 16px;min-width:0}
[dir=rtl] .mn-kbx .mn-kb-pcs{padding:0 16px 8px 4px}
.mn-kb.mn-kbx .mn-kb-pc{position:relative;padding:3px 0 3px 12px;border:0;border-radius:0;background:none;white-space:normal;overflow-wrap:break-word;
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}
[dir=rtl] .mn-kb.mn-kbx .mn-kb-pc{padding:3px 12px 3px 0}
.mn-kbx .mn-kb-pc::before{content:"";position:absolute;inset-inline-start:2px;top:calc(3px + .65em);width:4px;height:4px;border-radius:50%;background:var(--fc,var(--mn-kb));opacity:.7}
.mn-kbx .mn-kb-pc.done::before{background:var(--muted)}
.mn-kbx .mn-kb-pm{padding:3px 0 0 12px}
.mn-kbx .mn-kb-pmore{display:block;padding:8px 4px 2px;border-top:1px solid var(--line);font-size:11.5px;color:var(--muted)}
.mn-kb.mn-kbx .mn-kb-refs{padding:0 12px 8px 54px}
[dir=rtl] .mn-kb.mn-kbx .mn-kb-refs{padding:0 54px 8px 12px}
.mn-kbx .mn-kb-refs .kbr>summary{max-width:100%;white-space:normal;padding-inline:0}
.mn-kbx .mn-kb-refs .kbr-g{padding-inline-start:0}
.mn-kbx .mn-kb-refs .kbr-l .ch{max-width:100%}
@container mnkb (max-width:440px){
  .mn-kb.mn-kbx .mn-kb-peek,[dir=rtl] .mn-kb.mn-kbx .mn-kb-peek{margin-inline:10px}
  .mn-kb.mn-kbx .mn-kb-refs,[dir=rtl] .mn-kb.mn-kbx .mn-kb-refs{padding-inline:10px}
  .mn-kbx .mn-kb-go span{display:none}
  .mn-kbx .mn-kb-go{padding:0}
}
@media (prefers-reduced-motion:reduce){.mn-kbx .mn-kb-fold .i,.mn-kbx .mn-kb-pl>summary::before{transition:none}}
`;

let kbSeq = 0;

/** One board preview card. */
export function boardCardHTML(path: string): string {
  useStyles('mn-kbx-css', KB_CSS);
  const folder = dirOf(path);
  const name = noteTitle(path);
  const id = `mn-kb-b${++kbSeq}`;
  return `<div class="mn-kb mn-kbx" data-kb="${attr(path)}" style="--fc:${attr(colorOfFolder(folder))}">
    <div class="mn-kb-h">
      <span class="mn-kb-ic" aria-hidden="true">${icon('kanban')}</span>
      <button type="button" class="mn-kb-t" data-kb-go title="${attr(t('Open the board in Notes'))}" aria-label="${attr(t('Open the board {name}', { name }))}">
        <span class="mn-kb-n"><b dir="auto">${esc(name)}</b></span>
        <small class="mn-kb-sub">${esc(t('Board'))}${folder ? ` · ${esc(folder.split('/').join(' / '))}` : ''}</small>
        <span class="mn-kb-bars" aria-hidden="true"></span>
      </button>
      <span class="mn-kb-acts">
        <button type="button" class="mn-kb-go" data-kb-go title="${attr(t('Open the board in Notes'))}" aria-label="${attr(t('Open the board {name}', { name }))}">${icon(
          'arrow',
        )}<span>${esc(t('Open board'))}</span></button>
        <button type="button" class="mn-kb-fold" data-kb-fold aria-expanded="true" aria-controls="${id}" aria-label="${attr(t('Collapse preview'))}" title="${attr(
          t('Collapse preview'),
        )}">${icon('chev')}</button>
      </span>
    </div>
    <div class="mn-kb-body" id="${id}"><div class="mn-kb-peek" hidden></div></div>
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
    // The whole preview folds to its header (and back).
    const fold = card.querySelector<HTMLElement>('[data-kb-fold]');
    fold?.addEventListener('click', (e) => {
      e.stopPropagation();
      const closed = card.classList.toggle('fold');
      fold.setAttribute('aria-expanded', String(!closed));
      const label = closed ? t('Expand preview') : t('Collapse preview');
      fold.setAttribute('aria-label', label);
      fold.title = label;
    });
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

/** The lanes as an accordion: each lane folds its first card titles (still text, nothing to drag or tick).
 *  Lanes the reader opened or closed stay that way when the preview redraws. */
function peekOf(card: HTMLElement, b: KbBoard): void {
  const box = card.querySelector<HTMLElement>('.mn-kb-peek');
  if (!box) return;
  const full = b.lanes.filter((l) => l.cards.length);
  const lanes = full.slice(0, 8);
  const was = new Map<string, boolean>();
  box.querySelectorAll<HTMLDetailsElement>('details[data-lane]').forEach((d) => was.set(d.dataset.lane || '', d.open));
  const drawn = box.dataset.drawn === '1';
  box.innerHTML =
    lanes
      .map((l, i) => {
        const open = drawn && was.has(l.title) ? was.get(l.title) : lanes.length <= 3 || i < 2;
        return `<details class="mn-kb-pl" data-lane="${attr(l.title)}"${open ? ' open' : ''}><summary><span class="mn-kb-pln" dir="auto">${esc(l.title)}</span><em>${
          l.cards.length
        }</em></summary><div class="mn-kb-pcs">${l.cards
          .slice(0, 3)
          .map((c) => `<span class="mn-kb-pc${c.checked ? ' done' : ''}" dir="auto">${esc(peekTitle(c.text) || c.title || '')}</span>`)
          .join('')}${l.cards.length > 3 ? `<span class="mn-kb-pm">${esc(t('+{n} more', { n: l.cards.length - 3 }))}</span>` : ''}</div></details>`;
      })
      .join('') + (full.length > lanes.length ? `<span class="mn-kb-pmore">${esc(tn(full.length - lanes.length, '+{n} lane', '+{n} lanes'))}</span>` : '');
  box.dataset.drawn = '1';
  box.hidden = !lanes.length;
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
