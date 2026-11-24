// Boards inside a note. A link to a board on a line of its own reads as a compact card: the
// board's name, its lanes as small bars, how much is done, and an Open button. An embed of a board
// (`![[Board]]`) is the board itself, live: drag, tick off and add cards right in the note. A note
// holds as many boards as it embeds; each board stays its own Obsidian Kanban file.

import { apiGet } from '../api';
import { on } from '../bus';
import { attr, esc, useStyles } from '../dom';
import { t, tn } from '../i18n';
import { colorOfFolder, isBoard, noteTitle } from '../state';
import { ROOT_LABEL } from '../vault/store';
import { BOARD_ICON, KanbanView, type KanbanHost } from './kanban';
import { mentionNoteChip, useChips } from '../ui/chips';
import { mutationInfo } from '../vault/store';

export interface BoardInfo {
  path: string;
  title: string;
  lanes: { title: string; cards: number }[];
  cards: number;
  done: number;
  /** Notes that put this board in with `![[...]]`, and notes that only link to it. */
  embedded_in?: string[];
  linked_from?: string[];
}

const REFS_CSS = `
.kbr{margin:0 0 10px;font-size:13px;color:var(--muted);min-width:0}
.kbr>summary{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:0 8px;border-radius:8px;cursor:pointer;list-style:none;user-select:none}
.kbr>summary::-webkit-details-marker{display:none}
.kbr>summary::before{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s;margin-inline-end:2px}
[dir=rtl] .kbr>summary::before{transform:rotate(135deg)}
.kbr[open]>summary::before{transform:rotate(45deg)}
@media (hover:hover){.kbr>summary:hover{background:var(--hover);color:var(--fg)}}
.kbr>summary:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.kbr-g{display:flex;flex-direction:column;gap:6px;margin:6px 0 2px;padding-inline-start:8px}
.kbr-g>span{font-size:11.5px;font-weight:650;letter-spacing:.02em;color:var(--text-2)}
.kbr-l{display:flex;flex-wrap:wrap;gap:6px}
.kbr-l .ch{max-width:min(100%,280px)}
@media (prefers-reduced-motion:reduce){.kbr>summary::before{transition:none}}
`;

/** "In 3 notes", folded: every note that mentions this board, those that show it first, each a chip
 *  with a small marker (shows this board / links here), `data-open` and `data-act="open-note"`. */
export function boardRefsHTML(embedded: string[] = [], linked: string[] = []): string {
  const all = [...embedded, ...linked.filter((p) => !embedded.includes(p))];
  if (!all.length) return '';
  useStyles('kbr-css', REFS_CSS);
  useChips();
  const chips = all.map((p, i) => mentionNoteChip(p, i < embedded.length, ' data-act="open-note"'));
  return `<details class="kbr"><summary>${esc(tn(all.length, 'In {n} note', 'In {n} notes'))}</summary><div class="kbr-g"><div class="kbr-l">${chips.join('')}</div></div></details>`;
}

const CSS = `
.kbc{display:flex;align-items:center;gap:14px;margin:14px 0;padding:12px 12px 12px 14px;border:1px solid var(--line);border-radius:14px;
  background:var(--surface-1);color:var(--fg);max-width:560px;container:kbc/inline-size;text-align:start}
.kbc-ico{display:grid;place-items:center;flex:none;width:40px;height:40px;border-radius:11px;color:var(--fc,var(--accent));
  background:color-mix(in srgb,var(--fc,var(--accent)) 13%,transparent)}
.kbc-ico .vx-i{width:20px;height:20px}
.kbc-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px}
.kbc-name{display:flex;align-items:baseline;gap:8px;min-width:0}
.kbc-name b{font-size:15px;font-weight:650;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbc-name small{flex:none;font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.kbc-lanes{display:flex;align-items:flex-end;gap:4px;height:22px}
.kbc-lanes{align-items:stretch}
.kbc-lanes i{position:relative;flex:1 1 0;min-width:0;border-bottom:1px solid var(--line)}
.kbc-lanes i::after{content:"";position:absolute;inset:auto 0 0 0;height:max(3px,var(--h,0%));border-radius:3px 3px 1px 1px;
  background:color-mix(in srgb,var(--fc,var(--accent)) 52%,var(--surface-1))}
.kbc-meter{height:4px;background:linear-gradient(transparent 1.5px,var(--line) 1.5px,var(--line) 2.5px,transparent 2.5px)}
.kbc-meter i{display:block;height:100%;border-radius:99px;background:color-mix(in srgb,var(--fc,var(--accent)) 60%,var(--surface-1))}
.kbc-sub{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbc-open{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:36px}
.kbc.wait .kbc-lanes i,.kbc.wait .kbc-meter{opacity:.45}
@container kbc (max-width:340px){.kbc-lanes{display:none}}
@container vxnote (max-width:760px){.kbc{gap:11px;padding:10px}.kbc-ico{width:34px;height:34px}.kbc-open{min-height:40px}}
.kbc-self{margin:14px 0;padding:10px 14px;border:1px dashed var(--line-strong);border-radius:12px;color:var(--muted);font-size:13px}
.kbe{margin:18px 0;padding:10px 10px 2px;border:1px solid var(--line);border-radius:16px;background:var(--surface-1);min-width:0;text-align:start}
.kbe-h{display:flex;align-items:center;gap:10px;margin:0 0 10px;min-width:0}
.kbe-h .kbc-ico{width:32px;height:32px;border-radius:9px}
.kbe-h .kbc-ico .vx-i{width:17px;height:17px}
.kbe-h b{flex:1;min-width:0;font-size:15px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg)}
.kbe .kb-lanes,.kbe .kb-bar{padding-inline:2px}
/* The note's reading styles stop at an embedded board: it looks as on its own page. */
.vx-prose .kbe{font-family:var(--font);letter-spacing:normal;word-spacing:normal;line-height:1.5;font-feature-settings:normal}
.vx-prose .kbe .kb-lane-title{margin:0;font-family:inherit;font-size:13.5px;letter-spacing:.01em;line-height:28px}
.vx-prose .kbe :is(p,ul,ol,li){margin:0;padding-left:0}
.vx-prose .kbe .kb-body :is(ul,ol){padding-inline-start:18px}
.vx-prose .kbe .kb-body>*+*{margin-top:6px}
.vx-prose .kbe a:not(.ch){text-decoration:none;color:var(--accent)}
.vx-prose .kbe img{max-height:none}
.vx-prose .kbe .kb-body li.kb-sub{position:static;margin:0;margin-inline-start:-18px;padding:0;list-style:none}
.vx-prose .kbe .kb-body li.kb-sub input{position:static;appearance:auto;-webkit-appearance:auto;width:auto;height:auto;border:0;background:none;inset:auto}
@container vxnote (max-width:760px){.kbe{margin-inline:-6px;padding-inline:6px;border-radius:14px}}
`;

/** The live boards embedded in the note on screen. */
const embeds = new Set<KanbanView>();

/** Embedded boards whose note left the screen (another note, the editor, a version) let go. */
export function sweepEmbeds(): void {
  for (const v of embeds)
    if (!v.el.isConnected) {
      v.destroy();
      embeds.delete(v);
    }
}

on('mutation', (ev) => {
  sweepEmbeds();
  const p = mutationInfo(ev).path;
  if (p) for (const v of embeds) if (v.path === p) void v.refresh();
});

let cache: Promise<BoardInfo[]> | null = null;
on('mutation', () => {
  cache = null;
});

/** Every board's lanes and counts, one request for the whole page (dropped on any change). */
export function boardInfos(): Promise<BoardInfo[]> {
  if (!cache)
    cache = apiGet<{ boards?: BoardInfo[] }>('/api/kanban/boards')
      .then((r) => r.boards || [])
      .catch(() => {
        cache = null;
        return [];
      });
  return cache;
}

/** Whether `node` holds nothing but `link` (and a `!` left from an embed). */
function alone(node: Element, link: Element): boolean {
  for (const c of Array.from(node.childNodes)) {
    if (c === link) continue;
    if (c.nodeType === Node.TEXT_NODE && /^\s*!?\s*$/.test(c.textContent || '')) continue;
    if (c.nodeType === Node.ELEMENT_NODE && (c as Element).tagName === 'BR') continue;
    return false;
  }
  return true;
}

function cardHTML(path: string, b: BoardInfo | null): string {
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const name = b?.title || noteTitle(path);
  const lanes = (b?.lanes || []).slice(0, 8);
  const max = Math.max(1, ...lanes.map((l) => l.cards));
  const pct = b && b.cards ? Math.round((b.done / b.cards) * 100) : 0;
  const done = b ? t('{done} of {total} done', { done: b.done, total: b.cards }) : '';
  const sub = b ? `${tn(b.lanes.length, '{n} lane', '{n} lanes')} · ${folder ? folder.split('/').join(' / ') : ROOT_LABEL}` : t('Board');
  return `<span class="kbc-ico" aria-hidden="true">${BOARD_ICON}</span>
    <span class="kbc-main"><span class="kbc-name"><b dir="auto">${esc(name)}</b><small>${done}</small></span>
      ${
        lanes.length
          ? `<span class="kbc-lanes" aria-hidden="true">${lanes
              .map((l) => `<i title="${attr(`${l.title}: ${tn(l.cards, '{n} card', '{n} cards')}`)}" style="--h:${Math.round((l.cards / max) * 100)}%"></i>`)
              .join('')}</span>`
          : ''
      }
      <span class="kbc-meter" aria-hidden="true"><i style="width:${pct}%"></i></span>
      <span class="kbc-sub">${esc(sub)}</span></span>
    <button type="button" class="btn sm kbc-open" aria-label="${attr(t('Open the board {name}', { name }))}">${t('Open')}</button>`;
}

/** In `art`: board links on a line of their own become board cards; board embeds become the live
 *  board when `live` (a note as it is now), a card otherwise (an earlier version). */
export function boardCardsIn(art: HTMLElement, host: KanbanHost, live = true, self: string | null = null): void {
  const found: { box: HTMLElement; path: string }[] = [];
  let styled = false;
  art.querySelectorAll<HTMLElement>('a.wl[data-path]').forEach((a) => {
    const path = a.dataset.path || '';
    if (a.classList.contains('broken') || !isBoard(path)) return;
    const p = a.parentElement;
    if (!p || p.tagName !== 'P' || !alone(p, a)) return;
    if (!styled) {
      useStyles('kbc-css', CSS);
      styled = true;
    }
    const name = noteTitle(path);
    const embed = /!\s*$/.test(a.previousSibling?.textContent || '');
    // A board put inside itself is not drawn again inside itself.
    if (self && path === self) {
      const q = document.createElement('p');
      q.className = 'kbc-self';
      q.textContent = t("This board can't show inside itself.");
      p.replaceWith(q);
      return;
    }
    const box = document.createElement('div');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', t('Board: {name}', { name }));
    box.style.setProperty('--fc', colorOfFolder(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''));
    if (embed && live) {
      box.className = 'kbe';
      box.innerHTML = `<div class="kbe-h"><span class="kbc-ico" aria-hidden="true">${BOARD_ICON}</span><b dir="auto">${esc(name)}</b>
        <button type="button" class="btn sm kbc-open" aria-label="${attr(t('Open the board {name}', { name }))}">${t('Open')}</button></div>`;
      box.querySelector<HTMLElement>('.kbc-open')!.onclick = () => host.openNote(path);
      const v = new KanbanView(path, host, 'embed');
      box.appendChild(v.el);
      embeds.add(v);
      p.replaceWith(box);
      void v.load();
      return;
    }
    box.className = 'kbc wait';
    box.innerHTML = cardHTML(path, null);
    p.replaceWith(box);
    found.push({ box, path });
  });
  if (!found.length) return;
  const wire = (box: HTMLElement, path: string): void => {
    box.querySelector<HTMLElement>('.kbc-open')!.onclick = () => host.openNote(path);
  };
  found.forEach((f) => wire(f.box, f.path));
  void boardInfos().then((list) => {
    for (const f of found) {
      if (!f.box.isConnected) continue;
      const b = list.find((x) => x.path === f.path) || null;
      f.box.innerHTML = cardHTML(f.path, b);
      f.box.classList.remove('wait');
      wire(f.box, f.path);
    }
  });
}
