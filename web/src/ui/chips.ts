// Chips for things in the vault: a note, a board, a link to a note not created yet, a tag and a
// mention. One look everywhere they appear (the note footer, cards on a board), so a board always
// reads as a board and a missing link always as missing. Long names are cut with an ellipsis.

import { attr, esc, useStyles } from '../dom';
import { hashColor } from '../format';
import { t } from '../i18n';
import { isBoard, noteTitle } from '../state';
import { folderColor, ROOT_LABEL } from '../vault/store';

const svg = (d: string): string =>
  `<svg class="ch-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const CHIP_ICONS = {
  board: svg('<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
};

/** A note that mentions a board, as a chip with a small marker: the board icon when the note shows
 *  the board (`![[...]]`), a link icon when it only links to it (`[[...]]`). */
export function mentionNoteChip(path: string, shows: boolean, extra = ''): string {
  const mark = `<span class="ch-mk${shows ? ' kb' : ''}" title="${attr(shows ? t('Shows this board') : t('Links here'))}" aria-label="${attr(
    shows ? t('Shows this board') : t('Links here'),
  )}">${shows ? CHIP_ICONS.board : CHIP_ICONS.link}</span>`;
  return noteChip(path).replace('<button type="button"', `<button type="button"${extra}`).replace(/<\/button>$/, `${mark}</button>`);
}

export const CHIP_CSS = `
.ch-ic{width:14px;height:14px;flex:none}
.ch{--ch-c:var(--fc,var(--muted));display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;height:28px;padding:0 10px 0 9px;
  border:1px solid var(--line);border-radius:9px;background:var(--surface-1,var(--panel));color:var(--fg);font:inherit;font-size:13px;line-height:1;
  text-align:start;text-decoration:none;cursor:pointer;vertical-align:middle;box-sizing:border-box;transition:border-color .15s,background .15s}
.ch:hover{border-color:var(--line-strong);background:var(--hover)}
.ch:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.ch>i{flex:none;width:7px;height:7px;border-radius:50%;background:var(--ch-c)}
.ch .ch-ic{flex:none;width:14px;height:14px}
.ch b{font-weight:550;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ch small{flex:0 1 auto;min-width:0;font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ch small::before{content:"·";margin-inline-end:6px}
.ch-board{--kb-ac:#7c3aed;border-color:color-mix(in srgb,var(--kb-ac) 32%,var(--line));background:color-mix(in srgb,var(--kb-ac) 6%,var(--surface-1,var(--panel)))}
:root:not([data-theme=light]) .ch-board{--kb-ac:#a78bfa}
.ch-board .ch-ic{color:var(--kb-ac)}
.ch-board:hover{border-color:color-mix(in srgb,var(--kb-ac) 55%,var(--line))}
.ch-miss{border-style:dashed;border-color:var(--line-strong);background:none;color:var(--text-2)}
.ch-miss .ch-ic{color:var(--muted)}
.ch-miss b{font-weight:500}
.ch-tag{--ch-c:var(--tc,var(--accent));border-radius:99px;color:var(--text-2);padding-inline:9px 10px}
.ch-tag>i{width:6px;height:6px}
/* The marker of a mention (shows this board / links here): its own box at the end, never cut;
   only the title and folder shrink. */
.ch-mk{display:inline-grid;place-items:center;flex:none;width:16px;height:16px;margin-inline-start:6px;color:var(--muted);overflow:visible}
.ch .ch-mk .ch-ic{width:13px;height:13px}
.ch:has(>.ch-mk){padding-inline-end:9px;overflow:visible}
.ch:has(>.ch-mk) b,.ch:has(>.ch-mk) small{overflow:hidden;text-overflow:ellipsis}
.ch-mk.kb{--kb-ac:#7c3aed;color:var(--kb-ac)}
:root:not([data-theme=light]) .ch-mk.kb{--kb-ac:#a78bfa}
.ch-at{border-radius:99px;color:color-mix(in srgb,var(--accent) 80%,var(--fg));background:var(--accent-soft);border-color:transparent;cursor:default;padding-inline:8px}
.ch-at:hover{background:var(--accent-soft);border-color:transparent}
/* Inside running text (a card on a board): smaller, on the line. */
.ch.sm{height:22px;padding:0 7px 0 6px;gap:4px;font-size:12px;border-radius:7px;max-width:min(100%,22ch);vertical-align:-5px;margin-block:1px}
.ch.sm .ch-ic{width:12px;height:12px}
.ch.sm>i{width:6px;height:6px}
.ch.sm small{display:none}
.ch.sm.ch-tag,.ch.sm.ch-at{border-radius:99px;padding-inline:7px}
@media (hover:none){.ch{height:32px}.ch.sm{height:24px}}
@media (prefers-reduced-motion:reduce){.ch{transition:none}}
`;

export function useChips(): void {
  useStyles('chips-css', CHIP_CSS);
}

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** A note or a board, opened with `data-open`; `folder` adds where it lives. */
export function noteChip(path: string, folder = true): string {
  const dir = dirOf(path);
  const title = noteTitle(path);
  const board = isBoard(path);
  const where = folder ? `<small>${esc(dir ? dir.split('/').pop()! : ROOT_LABEL)}</small>` : '';
  const label = board ? t('Board: {name}', { name: title }) : title;
  return `<button type="button" class="ch ${board ? 'ch-board' : 'ch-note'}" data-open="${attr(path)}" style="--fc:${attr(folderColor(dir))}"
    title="${attr(`${label} · ${dir || ROOT_LABEL}`)}" aria-label="${attr(`${label}, ${dir || ROOT_LABEL}`)}">${board ? CHIP_ICONS.board : '<i></i>'}<b dir="auto">${esc(title)}</b>${where}</button>`;
}

/** A link to a note that does not exist yet, created with `data-create`. */
export function missingChip(name: string): string {
  return `<button type="button" class="ch ch-miss" data-create="${attr(name)}" title="${attr(t('Not created yet. Click to create it.'))}"
    aria-label="${attr(t('{name} (not created yet, create it)', { name }))}">${CHIP_ICONS.plus}<b dir="auto">${esc(name)}</b></button>`;
}

/** Make a rendered wikilink (`a.wl`) inside running text a small chip of its kind. */
export function chipLink(a: HTMLElement): void {
  if (a.classList.contains('ch')) return;
  const path = a.dataset.path || '';
  const broken = a.classList.contains('broken') || !path;
  const board = !broken && isBoard(path);
  const text = a.textContent || '';
  a.classList.add('ch', 'sm', broken ? 'ch-miss' : board ? 'ch-board' : 'ch-note');
  if (!broken) a.style.setProperty('--fc', folderColor(dirOf(path)));
  a.innerHTML = `${broken ? CHIP_ICONS.plus : board ? CHIP_ICONS.board : '<i></i>'}<b dir="auto">${esc(text)}</b>`;
  if (!a.title) a.title = broken ? t('Not created yet. Click to create it.') : `${board ? t('Board: {name}', { name: noteTitle(path) }) : noteTitle(path)} · ${dirOf(path) || ROOT_LABEL}`;
}

/** A tag chip; `small` inside running text. */
export function tagChip(tag: string, small = false): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `ch ch-tag${small ? ' sm' : ''}`;
  b.style.setProperty('--tc', hashColor(tag));
  b.innerHTML = `<i></i><b>${esc(tag)}</b>`;
  b.title = t('Notes tagged #{tag}', { tag });
  return b;
}

/** A mention of an agent or a person (`@name`). */
export function mentionChip(name: string): HTMLElement {
  const s = document.createElement('span');
  s.className = 'ch sm ch-at';
  s.innerHTML = `<b>@${esc(name)}</b>`;
  return s;
}
