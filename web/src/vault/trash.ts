// The Trash page (/trash): deleted notes wait in the vault's .Trash until restored or deleted forever.

import { apiGet, apiPost } from '../api';
import { $, attr, el, esc, useStyles } from '../dom';
import { fmtTs, relTs } from '../format';
import { Modal } from '../modal';
import { state } from '../state';
import { typedConfirm } from '../ui/components';

import { createFolderPicker, type FolderPicker } from './folder-picker';
import { I } from './icons';
import { nav } from './nav';
import { onRefresh, reload, restoreTrashed, trashNotes } from './ops';
import { dirOf, folderColor, pickerFolders, ROOT_LABEL } from './store';
import {
  deletedTs,
  itemTitle,
  matchesTrash,
  newFolderPath,
  originPlaces,
  placeOf,
  restoreInto,
  whoLabel,
  type RestoreChoice,
  type TrashItem,
} from './trash-model';
import { emptyState, undoToast } from './ui';
import { VAULT_CSS } from './styles';

const CSS = `
.tr{max-width:1040px;margin:0 auto;padding:8px 8px 0;container:tr/inline-size}
.tr-head{display:flex;align-items:center;gap:16px}
.tr-tile{display:grid;place-items:center;flex:none;width:48px;height:48px;border-radius:13px;color:var(--muted);
  background:color-mix(in srgb,var(--fg) 5%,transparent);box-shadow:inset 0 0 0 1px var(--line)}
.tr-tile .vx-i{width:22px;height:22px;stroke-width:1.7}
.tr-title{flex:1;min-width:0}
.tr-title h1{margin:0;font-size:26px;font-weight:650;letter-spacing:-.02em;line-height:1.25}
.tr-title p{margin:3px 0 0;font-size:14px;color:var(--muted);font-variant-numeric:tabular-nums}
:root .btn.ghost.tr-empty-all{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 14px;border-radius:10px;font-size:13.5px;font-weight:600;color:var(--danger)}
:root .btn.ghost.tr-empty-all:hover{background:var(--danger-soft);color:var(--danger)}
.tr-empty-all .vx-i{width:16px;height:16px}
.tr-explain{display:flex;align-items:flex-start;gap:10px;margin:20px 0 0;font-size:13.5px;line-height:1.55;color:var(--text-2);max-width:72ch}
.tr-explain .vx-i{width:17px;height:17px;color:var(--muted);flex:none;margin-top:2px;stroke-width:1.7}
.tr-tbar{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:24px 0 16px;min-height:40px}
.tr-search{display:flex;align-items:center;gap:9px;flex:0 1 320px;min-width:0;height:40px;padding:0 4px 0 13px;border-radius:10px;cursor:text;
  border:1px solid transparent;background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--muted);transition:border-color .15s,background .15s}
.tr-search:hover{border-color:var(--line)}
.tr-search:focus-within{border-color:var(--line-strong);background:var(--surface-1);color:var(--fg)}
.tr-search .vx-i{width:16px;height:16px;flex:none}
.tr-search input{flex:1;min-width:0;height:100%;border:0;background:none;color:var(--fg);font:inherit;font-size:14px;outline:none;padding:0}
.tr-search input:focus,.tr-search input:focus-visible{box-shadow:none;outline:none}
.tr-search input::-webkit-search-cancel-button{display:none}
.tr-sel{display:flex;align-items:center;gap:6px;margin-left:auto;padding:4px 4px 4px 14px;border-radius:12px;background:color-mix(in srgb,var(--fg) 5%,transparent);
  font-size:13px;color:var(--text-2);animation:trIn .16s var(--ease-out)}
.tr-sel b{color:var(--fg);font-variant-numeric:tabular-nums}
.tr-sel .btn{height:32px;padding:0 12px;border-radius:8px;font-size:13px;font-weight:550;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.tr-sel .btn .vx-i{width:15px;height:15px}
@keyframes trIn{from{opacity:0;transform:translateY(-3px)}}
@media (prefers-reduced-motion:reduce){.tr-sel{animation:none}}
.tr-explain+.tr-card{margin-top:24px}
.tr-card{background:var(--surface-1);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.tr-cols{--cols:28px minmax(0,1fr) minmax(140px,220px) minmax(130px,170px) 212px}
.tr-thead{display:grid;grid-template-columns:var(--cols);gap:14px;align-items:center;height:40px;padding:0 16px;
  border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--fg) 2.5%,transparent);font-size:12px;font-weight:500;color:var(--muted)}
.tr-row{position:relative;display:grid;grid-template-columns:var(--cols);gap:14px;align-items:center;min-height:62px;padding:10px 16px;border-top:1px solid var(--line);transition:background .12s}
.tr-row:first-child{border-top:0}
.tr-row:hover{background:color-mix(in srgb,var(--fg) 2.5%,transparent)}
.tr-row.sel{background:color-mix(in srgb,var(--fg) 5%,transparent)}
.tr-row.sel::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--brand-mark,var(--accent))}
.tr-check{display:grid;place-items:center;width:28px;height:28px;margin:-4px;cursor:pointer}
.tr-check input{width:16px;height:16px;margin:0;accent-color:var(--fg);cursor:pointer}
.tr-main{display:flex;align-items:center;gap:12px;min-width:0}
.tr-ico{display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:9px;color:var(--muted);background:color-mix(in srgb,var(--fg) 5%,transparent)}
.tr-ico .vx-i{width:16px;height:16px;stroke-width:1.7}
.tr-name{min-width:0;display:flex;flex-direction:column;gap:3px}
.tr-name b{font-size:14px;font-weight:550;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tr-meta{display:none;align-items:center;gap:6px;min-width:0;font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden}
.tr-meta>span:last-child{overflow:hidden;text-overflow:ellipsis}
.tr-from{display:inline-flex;align-items:center;gap:7px;min-width:0;font-size:13px;color:var(--text-2)}
.tr-from i{width:6px;height:6px;border-radius:50%;background:var(--fc);flex:none}
.tr-from span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tr-when{display:flex;flex-direction:column;gap:1px;font-size:13px;color:var(--text-2);min-width:0}
.tr-when small{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tr-acts{display:flex;gap:4px;justify-content:flex-end}
.tr-acts .btn{height:32px;padding:0 11px;border-radius:8px;font-size:13px;font-weight:550;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.tr-acts .btn .vx-i{width:15px;height:15px}
:root :is(.tr-acts,.tr-sel) .btn.ghost.tr-forever{color:var(--danger)}
:root :is(.tr-acts,.tr-sel) .btn.ghost.tr-forever:hover{background:var(--danger-soft);color:var(--danger)}
.tr-sel .btn.tr-clear{width:32px;padding:0;justify-content:center}
.tr-none{color:var(--text-3)}
.tr-skel{display:grid;grid-template-columns:var(--cols);gap:14px;align-items:center;height:62px;padding:0 16px;border-top:1px solid var(--line)}
.tr-skel:first-child{border-top:0}
.tr-skel .vx-skel{height:11px}
.tr-err{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:20px}
.tr-err p{margin:0;color:var(--fg)}
.tr-err small{color:var(--muted)}
.tr-card .vx-empty.brand>.vx-i{background:linear-gradient(180deg,#17202e,#0b0f17);color:#5eead4;box-shadow:inset 0 0 0 1px rgba(94,234,212,.16)}
.tr-dlg{display:flex;flex-direction:column;gap:8px;min-width:0}
.tr-dlg>p{margin:0 0 6px;font-size:13.5px;color:var(--text-2);line-height:1.5}
.tr-opt{display:grid;grid-template-columns:20px minmax(0,1fr);gap:2px 10px;align-items:start;padding:12px 14px;border:1px solid var(--line);border-radius:12px;
  cursor:pointer;transition:border-color .15s,background .15s}
.tr-opt:hover{border-color:var(--line-strong)}
.tr-opt:has(input:checked),.tr-opt.on{border-color:var(--fg);background:color-mix(in srgb,var(--fg) 4%,transparent)}
.tr-opt:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.tr-opt input{grid-row:1/3;width:16px;height:16px;margin:2px 0 0;accent-color:var(--fg)}
.tr-opt b{font-size:14px;font-weight:600;color:var(--fg)}
.tr-opt small{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;font-size:13px;color:var(--muted);min-width:0}
.tr-opt small span{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%}
.tr-opt small span em{font-style:normal;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-2)}
.tr-opt small i{width:6px;height:6px;border-radius:50%;background:var(--fc);flex:none}
.tr-opts{display:flex;flex-direction:column;gap:8px;min-width:0}
.tr-again{margin-left:2px;padding:0 6px;border-radius:6px;font-size:11.5px;line-height:18px;color:var(--text-2);background:color-mix(in srgb,var(--fg) 7%,transparent)}
.tr-pick{display:flex;flex-direction:column;gap:8px;margin:0 0 2px;padding:0 0 0 30px;min-width:0}
.tr-pick[hidden]{display:none}
.tr-pick .fp-tree{max-height:min(30vh,240px);min-height:96px}
.tr-new{display:flex;flex-direction:column;gap:6px;min-width:0}
.tr-new-btn{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 10px;border-radius:8px;font-size:13px;font-weight:550;color:var(--text-2)}
.tr-new-btn .vx-i{width:16px;height:16px}
.tr-new-btn[hidden],.tr-new-row[hidden],.tr-new-err[hidden]{display:none}
.tr-new-row{display:flex;flex-direction:column;gap:6px;min-width:0}
.tr-new-l{font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tr-new-f{display:flex;align-items:center;gap:6px}
.tr-new-in{flex:1;min-width:0;height:38px;padding:0 12px;border-radius:8px;border:1px solid var(--line-strong);background:var(--surface-0);color:var(--fg);font:inherit;font-size:14px;outline:none}
.tr-new-in:focus{border-color:var(--accent-line,var(--accent));box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}
.tr-new-x{width:34px;height:34px;flex:none;border-radius:8px}
.tr-new-x .vx-i{width:14px;height:14px}
.tr-new-err{font-size:12.5px;color:var(--danger)}
@media (max-width:760px){
  .tr-pick{padding-left:0}
  .tr-pick .fp-tree{max-height:26dvh}
  .tr-opt{padding:12px}
  .tr-new-in{height:44px;font-size:16px}
  .tr-new-btn{height:40px}
}
@container tr (max-width:900px){
  .tr-cols{--cols:28px minmax(0,1fr) auto}
  .tr-thead{display:none}
  .tr-row>.tr-from,.tr-row>.tr-when{display:none}
  .tr-meta{display:flex}
}
@media (max-width:760px){
  .tr{padding:0}
  .tr-head{gap:12px}
  .tr-tile{width:42px;height:42px;border-radius:12px}
  .tr-title h1{font-size:22px}
  .tr-title p{font-size:13px}
  .tr-explain{font-size:13px;margin-top:16px}
  .tr-tbar{margin:18px 0 12px}
}
@container tr (max-width:560px){
  .tr-search{flex:1 1 100%;height:44px}
  .tr-search input{font-size:16px}
  .tr-sel{margin-left:0;flex:1 1 100%;gap:2px;padding-left:12px}
  .tr-sel>span{flex:1 1 auto;white-space:nowrap}
  .tr-sel .btn{padding:0 9px}
  .tr-sel .btn.tr-clear{width:32px;padding:0}
  .tr-row{grid-template-columns:28px minmax(0,1fr);row-gap:10px;padding:12px 14px}
  .tr-acts{grid-column:2;justify-content:stretch}
  .tr-acts .btn{flex:1 1 0;justify-content:center;height:40px;border:1px solid var(--line)}
  .tr-empty-all span{display:none}
  :root .btn.ghost.tr-empty-all{width:40px;padding:0;justify-content:center}
}
`;

/** Bumped per draw, so a slow answer never paints over a newer one. */
let seq = 0;
let items: TrashItem[] | null = null;
let query = '';
/** Selected entries, by their name in the Trash. */
const picked = new Set<string>();

const host = (): HTMLElement => $('#view-trash');

/** Router entry: draw the Trash page (a redraw keeps what is shown until data arrives). */
export async function renderTrash(): Promise<void> {
  useStyles('vx-styles', VAULT_CSS);
  useStyles('vx-trash-css', CSS);
  const h = host();
  const my = ++seq;
  if (!h.querySelector('.tr')) paint(h, null);
  try {
    const r = await apiGet<{ items?: TrashItem[] }>('/api/trash');
    if (my !== seq || state.page !== 'trash') return;
    items = r.items || [];
    for (const n of Array.from(picked)) if (!items.some((it) => it.name === n)) picked.delete(n);
    paint(h, null);
  } catch (e) {
    if (my === seq && state.page === 'trash') {
      items = null;
      paint(h, e as Error);
    }
  }
}

/** Redraw when the page is on screen. */
function again(): void {
  if (state.page === 'trash') void renderTrash();
}

const INFO = `<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>`;

const notes = (n: number): string => `${n} note${n === 1 ? '' : 's'}`;
const placeName = (p: string): string => (p ? p.split('/').join(' / ') : ROOT_LABEL);

function paint(h: HTMLElement, error: Error | null): void {
  const all = items || [];
  const n = all.length;
  const shown = all.filter((it) => matchesTrash(it, query));
  const hadSearch = document.activeElement?.classList.contains('tr-q');
  h.innerHTML = '';
  const page = el('div', 'tr');
  page.innerHTML = `<header class="tr-head">
      <span class="tr-tile" aria-hidden="true">${I.trash}</span>
      <div class="tr-title"><h1>Trash</h1><p>${
        items ? (n ? `${notes(n)} waiting` : 'Nothing deleted') : error ? 'Not loaded' : 'Loading…'
      }</p></div>
      ${n ? `<button class="btn ghost tr-empty-all" data-empty aria-label="Empty trash" title="Delete every note in the Trash forever">${I.trash}<span>Empty trash</span></button>` : ''}
    </header>
    <p class="tr-explain">${INFO}<span>Deleted notes wait here until you restore them or delete them forever. When you restore, you choose where the note goes: its old folder, another folder or the top level.</span></p>`;
  if (n) {
    const tbar = el('div', 'tr-tbar');
    const sel = all.filter((it) => picked.has(it.name));
    tbar.innerHTML = `<label class="tr-search">${I.search}<input class="tr-q" type="search" placeholder="Search the Trash" aria-label="Search the Trash" value="${attr(
      query,
    )}" spellcheck="false" autocomplete="off"></label>${
      sel.length
        ? `<div class="tr-sel" role="group" aria-label="Selected notes"><span><b>${sel.length}</b> selected</span>
        <button class="btn ghost" data-bulk="restore">${I.undo}Restore</button>
        <button class="btn ghost tr-forever" data-bulk="forever">Delete forever</button>
        <button class="btn ghost tr-clear" data-bulk="clear" aria-label="Clear the selection" title="Clear the selection">${I.close}</button></div>`
        : ''
    }`;
    page.appendChild(tbar);
    const q = tbar.querySelector<HTMLInputElement>('.tr-q')!;
    q.oninput = () => {
      query = q.value;
      paint(h, null);
    };
    q.onkeydown = (e) => {
      if (e.key === 'Escape' && q.value) {
        e.stopPropagation();
        query = '';
        paint(h, null);
      }
    };
    tbar.querySelectorAll<HTMLElement>('[data-bulk]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.bulk;
        if (k === 'restore') askRestore(sel);
        else if (k === 'forever') deleteForever(sel);
        else {
          picked.clear();
          paint(h, null);
        }
      };
    });
  }
  const card = el('div', 'tr-card tr-cols');
  page.appendChild(card);
  h.appendChild(page);
  if (hadSearch) {
    const q = page.querySelector<HTMLInputElement>('.tr-q');
    q?.focus();
    q?.setSelectionRange(query.length, query.length);
  }
  if (error) {
    card.innerHTML = `<div class="tr-err" role="alert"><p><b>Could not load the Trash</b></p><small>${esc(
      error.message,
    )}. Check your connection, then try again.</small><button class="btn sm" data-retry>Try again</button></div>`;
    card.querySelector<HTMLElement>('[data-retry]')!.onclick = () => void renderTrash();
  } else if (!items) {
    // The same rhythm as the rows that will land here.
    card.innerHTML = `<div aria-busy="true" aria-label="Loading the Trash">${[46, 34, 40, 28]
      .map(
        (w) =>
          `<div class="tr-skel"><span class="vx-skel" style="width:16px;height:16px;border-radius:4px"></span><span style="display:flex;align-items:center;gap:12px"><span class="vx-skel" style="width:32px;height:32px;border-radius:9px;flex:none"></span><span class="vx-skel" style="width:${w}%"></span></span></div>`,
      )
      .join('')}</div>`;
  } else if (!n) {
    card.innerHTML = emptyState(
      I.trash,
      'The Trash is empty',
      'Notes you delete wait here, so you can bring them back.',
      `<button class="btn sm" data-home>Back to ${esc(ROOT_LABEL)}</button>`,
    ).replace('vx-empty', 'vx-empty brand');
  } else if (!shown.length) {
    card.innerHTML = emptyState(I.search, 'No matches', `No deleted note matches “${esc(query.trim())}”.`, '<button class="btn sm" data-clear>Clear the search</button>');
  } else {
    const allOn = shown.every((it) => picked.has(it.name));
    card.insertAdjacentHTML(
      'beforeend',
      `<div class="tr-thead"><label class="tr-check" title="Select all"><input type="checkbox" data-all aria-label="Select all"${allOn ? ' checked' : ''}></label><span>Note</span><span>Came from</span><span>Deleted</span><span></span></div>`,
    );
    const list = el('div', 'tr-list');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Deleted notes');
    for (const it of shown) list.appendChild(row(it, h));
    card.appendChild(list);
    const head = card.querySelector<HTMLInputElement>('[data-all]')!;
    head.indeterminate = !allOn && shown.some((it) => picked.has(it.name));
    head.onchange = () => {
      for (const it of shown) {
        if (head.checked) picked.add(it.name);
        else picked.delete(it.name);
      }
      paint(h, null);
    };
  }
  page.querySelectorAll<HTMLElement>('[data-home]').forEach((b) => (b.onclick = () => nav.allNotes()));
  page.querySelector<HTMLElement>('[data-clear]')?.addEventListener('click', () => {
    query = '';
    paint(h, null);
  });
  page.querySelector<HTMLElement>('[data-empty]')?.addEventListener('click', () => emptyAll(n));
}

function row(it: TrashItem, h: HTMLElement): HTMLElement {
  const r = el('div', 'tr-row' + (picked.has(it.name) ? ' sel' : ''));
  r.setAttribute('role', 'listitem');
  const title = itemTitle(it);
  const place = placeOf(it);
  const ts = deletedTs(it);
  const who = whoLabel(it);
  const known = it.original != null;
  const from = known
    ? `<span class="tr-from" style="--fc:${attr(folderColor(place))}" title="${attr(place || ROOT_LABEL)}"><i></i><span>${esc(placeName(place))}</span></span>`
    : '<span class="tr-none">Unknown</span>';
  const when = ts ? `<span title="${attr(fmtTs(ts))}">${esc(relTs(ts))}</span>` : '<span class="tr-none">Unknown</span>';
  // Narrow screens: one meta line under the title says the same.
  const bits: string[] = [];
  if (ts || who) bits.push(`Deleted${ts ? ' ' + esc(relTs(ts)) : ''}${who ? ' by ' + esc(who) : ''}`);
  const meta = `<span class="tr-meta">${known ? `<span class="tr-from" style="--fc:${attr(folderColor(place))}"><i></i><span>${esc(placeName(place))}</span></span>` : ''}${
    bits.length ? `${known ? '<span aria-hidden="true">·</span>' : ''}<span>${bits.join('')}</span>` : ''
  }</span>`;
  r.innerHTML = `<label class="tr-check"><input type="checkbox" aria-label="Select ${attr(title)}"${picked.has(it.name) ? ' checked' : ''}></label>
    <div class="tr-main"><span class="tr-ico" aria-hidden="true">${I.note}</span><span class="tr-name"><b title="${attr(title)}">${esc(title)}</b>${meta}</span></div>
    ${from}
    <span class="tr-when">${when}${who ? `<small>by ${esc(who)}</small>` : ''}</span>
    <div class="tr-acts"><button class="btn ghost" data-restore aria-label="Restore ${attr(title)}">${I.undo}<span>Restore</span></button>
    <button class="btn ghost tr-forever" data-forever aria-label="Delete ${attr(title)} forever">Delete forever</button></div>`;
  const box = r.querySelector<HTMLInputElement>('.tr-check input')!;
  box.dataset.name = it.name;
  box.onchange = () => {
    if (box.checked) picked.add(it.name);
    else picked.delete(it.name);
    paint(h, null);
    Array.from(host().querySelectorAll<HTMLInputElement>('.tr-row .tr-check input'))
      .find((x) => x.dataset.name === it.name)
      ?.focus();
  };
  r.querySelector<HTMLElement>('[data-restore]')!.onclick = () => askRestore([it]);
  r.querySelector<HTMLElement>('[data-forever]')!.onclick = () => deleteForever([it]);
  return r;
}

/** Ask where restored notes go: back to their folders, another (or new) folder, or the top level. */
function askRestore(list: TrashItem[]): void {
  if (!list.length) return;
  const one = list.length === 1;
  const places = originPlaces(list.filter((it) => it.original != null));
  const unknown = list.some((it) => it.original == null);
  const folders = pickerFolders();
  const gone = (p: string): boolean => !!p && !folders.includes(p);
  const placeTag = (p: string): string =>
    `<span style="--fc:${attr(folderColor(p))}"><i></i><em title="${attr(p || ROOT_LABEL)}">${esc(placeName(p))}</em>${
      gone(p) ? '<span class="tr-again">made again</span>' : ''
    }</span>`;
  const shownPlaces = places.slice(0, 3).map(placeTag).join('') + (places.length > 3 ? `<span>and ${places.length - 3} more</span>` : '');
  const originText = one
    ? list[0].original != null
      ? shownPlaces
      : `<span>Its old folder is not known, so it goes to the top level</span>`
    : `${shownPlaces}${unknown ? '<span>unknown ones go to the top level</span>' : ''}`;
  let picker: FolderPicker | null = null;
  let newName = '';
  const body = el('div', 'tr-dlg');
  body.innerHTML = `<p>${one ? `Where should “${esc(itemTitle(list[0]))}” go?` : `Where should these ${list.length} notes go?`}</p>
    <div class="tr-opts" role="radiogroup" aria-label="Restore to">
    <label class="tr-opt"><input type="radio" name="trTo" value="origin" checked><b>Back to ${one ? 'its folder' : 'their folders'}</b><small>${originText}</small></label>
    <label class="tr-opt"><input type="radio" name="trTo" value="folder"><b>Move to another folder…</b><small>Pick a folder${one ? '' : ' for all of them'}, or make a new one</small></label>
    <div class="tr-pick" hidden></div>
    <label class="tr-opt"><input type="radio" name="trTo" value="top"><b>Top level</b><small>${esc(ROOT_LABEL)}, outside any folder</small></label>
    </div>`;
  const pickBox = body.querySelector<HTMLElement>('.tr-pick')!;
  const mode = (): string => body.querySelector<HTMLInputElement>('input[name=trTo]:checked')?.value || 'origin';
  const choice = (): RestoreChoice | null => {
    const v = mode();
    if (v === 'origin') return { to: 'origin' };
    if (v === 'top') return { to: 'top' };
    const f = picker?.value;
    if (f == null) return null;
    if (!newName.trim()) return { to: 'folder', folder: f };
    const made = newFolderPath(f, newName);
    return made ? { to: 'folder', folder: made } : null;
  };
  let go: HTMLButtonElement | null = null;
  const sync = (): void => {
    if (go) go.disabled = !choice();
  };
  const submit = (): void => {
    const c = choice();
    if (!c) {
      (pickBox.querySelector<HTMLInputElement>('.tr-new-in:not([hidden])') || picker)?.focus();
      return;
    }
    Modal.close();
    void restore(list, c);
  };
  const buildPicker = (): void => {
    picker = createFolderPicker({
      folders,
      value: places.length === 1 && !gone(places[0]) ? places[0] : '',
      label: 'Restore into',
      onChange: () => {
        paintNew();
        sync();
      },
      onPick: () => submit(),
    });
    pickBox.appendChild(picker.el);
    // A new folder inside the selected one: the server makes it on restore.
    const nf = el('div', 'tr-new');
    nf.innerHTML = `<button type="button" class="btn ghost sm tr-new-btn">${I.newFolder}<span>New folder</span></button>
      <div class="tr-new-row" hidden><label class="tr-new-l" for="trNewIn"></label>
      <div class="tr-new-f"><input id="trNewIn" class="tr-new-in" type="text" placeholder="Folder name" autocomplete="off" spellcheck="false" maxlength="80">
      <button type="button" class="vx-icon-btn tr-new-x" aria-label="No new folder" title="No new folder">${I.close}</button></div>
      <small class="tr-new-err" hidden>A folder name cannot contain / or \\.</small></div>`;
    pickBox.appendChild(nf);
    const btn = nf.querySelector<HTMLElement>('.tr-new-btn')!;
    const row = nf.querySelector<HTMLElement>('.tr-new-row')!;
    const input = nf.querySelector<HTMLInputElement>('.tr-new-in')!;
    const bad = nf.querySelector<HTMLElement>('.tr-new-err')!;
    btn.onclick = () => {
      btn.hidden = true;
      row.hidden = false;
      paintNew();
      input.focus();
    };
    nf.querySelector<HTMLElement>('.tr-new-x')!.onclick = () => {
      newName = '';
      input.value = '';
      row.hidden = true;
      btn.hidden = false;
      bad.hidden = true;
      sync();
      btn.focus();
    };
    input.oninput = () => {
      newName = input.value;
      bad.hidden = !newName.trim() || !!newFolderPath('x', newName);
      sync();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    };
  };
  const paintNew = (): void => {
    const l = pickBox.querySelector<HTMLElement>('.tr-new-l');
    const f = picker?.value;
    if (l) l.textContent = `New folder inside ${f ? placeName(f) : ROOT_LABEL}`;
  };
  body.querySelectorAll<HTMLInputElement>('input[name=trTo]').forEach((r) => {
    r.onchange = () => {
      const other = mode() === 'folder';
      if (other && !picker) buildPicker();
      pickBox.hidden = !other;
      body.querySelectorAll('.tr-opt').forEach((o) => o.classList.toggle('on', !!o.querySelector('input:checked')));
      sync();
      if (other) setTimeout(() => picker?.focus(), 30);
    };
  });
  body.querySelector('.tr-opt')?.classList.add('on');
  Modal.open({
    title: one ? 'Restore note' : `Restore ${list.length} notes`,
    body,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      { label: 'Restore', cls: 'primary', run: submit },
    ],
    onOpen: (b) => {
      go = b.parentElement?.querySelector<HTMLButtonElement>('.modal-foot .btn.primary') || null;
      b.querySelector<HTMLInputElement>('input[name=trTo]:checked')?.focus();
    },
  });
}

async function restore(list: TrashItem[], c: RestoreChoice): Promise<void> {
  const into = restoreInto(c);
  const back: string[] = [];
  let failed = 0;
  for (const it of list) {
    try {
      back.push(await restoreTrashed(it.name, into));
      picked.delete(it.name);
    } catch (e) {
      failed++;
      undoToast(`Could not restore “${itemTitle(it)}”: ${(e as Error).message}`, null, 'err');
    }
  }
  await reload();
  if (back.length) {
    // Where the server put them (it may tidy a new folder's name).
    const where =
      c.to === 'top' ? 'the top level' : c.to === 'folder' || back.length === 1 ? placeName(dirOf(back[0])) : 'their folders';
    const what = back.length === 1 && list.length === 1 ? `“${itemTitle(list[0])}”` : notes(back.length);
    // Undo puts them back in the Trash.
    undoToast(`Restored ${what} to ${where}${failed ? ` (${failed} failed)` : ''}`, async () => {
      await trashNotes(back.filter(Boolean));
      again();
    }, 'ok');
  }
  again();
}

function deleteForever(list: TrashItem[]): void {
  if (!list.length) return;
  const one = list.length === 1;
  typedConfirm({
    title: one ? 'Delete this note forever?' : `Delete ${list.length} notes forever?`,
    body: `<p>${
      one ? 'This note is' : `These ${list.length} notes are`
    } removed from the vault for good, with ${one ? 'its' : 'their'} text, tags and links. Every earlier version is erased from the version history too, so no one, agents included, can read ${
      one ? 'it' : 'them'
    } again.</p>`,
    items: list.map(itemTitle),
    word: 'DELETE',
    confirmLabel: one ? 'Delete forever' : `Delete ${list.length} forever`,
    run: async () => {
      Modal.close();
      let done = 0;
      for (const it of list) {
        try {
          await apiPost('/api/trash/delete', { name: it.name });
          picked.delete(it.name);
          done++;
        } catch (e) {
          undoToast(`Could not delete “${itemTitle(it)}”: ${(e as Error).message}`, null, 'err');
        }
      }
      if (done) undoToast(one ? `“${itemTitle(list[0])}” was deleted forever` : `${notes(done)} deleted forever`, null, 'info');
      again();
    },
  });
}

function emptyAll(n: number): void {
  typedConfirm({
    title: 'Empty the Trash?',
    body: `<p>${
      n === 1 ? 'The note in the Trash is' : `All ${n} notes in the Trash are`
    } removed from the vault for good, with ${n === 1 ? 'its' : 'their'} text, tags and links. Every earlier version is erased from the version history too, so no one, agents included, can read ${
      n === 1 ? 'it' : 'them'
    } again.</p>`,
    items: (items || []).map(itemTitle),
    word: 'DELETE ALL',
    confirmLabel: n === 1 ? 'Empty trash' : `Delete all ${n}`,
    run: async () => {
      Modal.close();
      try {
        const r = await apiPost<{ count?: number }>('/api/trash/empty', {});
        const c = r.count ?? n;
        picked.clear();
        undoToast(`Trash emptied: ${notes(c)} deleted forever`, null, 'info');
      } catch (e) {
        undoToast('Could not empty the Trash: ' + (e as Error).message, null, 'err');
      }
      again();
    },
  });
}

// Notes deleted or restored elsewhere (Undo in a toast, an agent) show up here.
onRefresh(() => again());
