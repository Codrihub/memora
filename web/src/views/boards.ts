// Boards: every Kanban board in the vault (notes in the Obsidian Kanban format), as cards with their
// lanes, progress and last change. A click opens the board in the Notes page; New board starts one.

import { apiGet } from '../api';
import { on } from '../bus';
import { attr, el, esc, useStyles } from '../dom';
import { fmtTs, relTs } from '../format';
import { hooks } from '../hooks';
import { t, tn } from '../i18n';
import { colorOfFolder, state } from '../state';
import { I } from '../vault/icons';
import { nav } from '../vault/nav';
import { ROOT_LABEL } from '../vault/store';

interface BoardInfo {
  path: string;
  title: string;
  lanes: { title: string; cards: number }[];
  cards: number;
  done: number;
  archived: number;
  version: string;
  mtime: number;
}

const CSS = `
.bd{max-width:1180px;margin:0 auto;padding:8px 8px 96px;container:bd/inline-size}
.bd-head{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.bd-tile{display:grid;place-items:center;flex:none;width:48px;height:48px;border-radius:13px;color:var(--accent);
  background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent-line)}
.bd-tile .vx-i{width:22px;height:22px;stroke-width:1.7}
.bd-title{flex:1 1 220px;min-width:0}
.bd-title h1{margin:0;font-size:26px;font-weight:650;letter-spacing:-.02em;line-height:1.25}
.bd-title p{margin:3px 0 0;font-size:14px;color:var(--muted);font-variant-numeric:tabular-nums}
.bd-new{display:inline-flex;align-items:center;gap:8px;height:40px;padding-inline:14px 16px;border-radius:11px}
.bd-new .vx-i{width:16px;height:16px}
.bd-tbar{display:flex;align-items:center;gap:10px;margin:22px 0 16px;flex-wrap:wrap}
.bd-search{display:flex;align-items:center;gap:9px;flex:0 1 320px;min-width:0;height:40px;padding-inline:13px 6px;border-radius:10px;cursor:text;
  border:1px solid transparent;background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--muted)}
.bd-search:focus-within{border-color:var(--line-strong);background:var(--surface-1);color:var(--fg)}
.bd-search .vx-i{width:16px;height:16px;flex:none}
.bd-search input{flex:1;min-width:0;height:100%;border:0;background:none;color:var(--fg);font:inherit;font-size:14px;outline:none;padding:0}
.bd-search input:focus-visible{outline:none;box-shadow:none}
.bd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.bd-card{display:flex;flex-direction:column;gap:12px;text-align:start;padding:16px;border-radius:14px;border:1px solid var(--line);
  background:var(--surface-1);color:var(--fg);font:inherit;cursor:pointer;min-width:0;transition:border-color .15s,box-shadow .15s,transform .15s}
.bd-card:hover{border-color:var(--line-strong);box-shadow:0 6px 18px rgba(0,0,0,.07)}
.bd-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.bd-top{display:flex;align-items:flex-start;gap:10px;min-width:0}
.bd-ico{display:grid;place-items:center;flex:none;width:34px;height:34px;border-radius:10px;color:var(--fc,var(--accent));
  background:color-mix(in srgb,var(--fc,var(--accent)) 13%,transparent)}
.bd-ico .vx-i{width:18px;height:18px}
.bd-name{flex:1;min-width:0}
.bd-name b{display:block;font-size:15px;font-weight:650;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bd-name small{display:block;margin-top:2px;font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bd-lanes{display:flex;align-items:flex-end;gap:5px;height:46px;padding:0 2px}
.bd-lane{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:stretch;gap:4px}
.bd-bar{position:relative;height:30px;border-radius:5px;background:color-mix(in srgb,var(--fg) 7%,transparent);overflow:hidden}
.bd-bar::after{content:"";position:absolute;inset:auto 0 0 0;height:var(--h,0%);border-radius:5px;background:color-mix(in srgb,var(--fc,var(--accent)) 45%,transparent)}
.bd-lane span{font-size:10.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}
.bd-prog{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--text-2);font-variant-numeric:tabular-nums}
.bd-meter{flex:1;height:6px;border-radius:4px;background:var(--surface-2);overflow:hidden}
.bd-meter i{display:block;height:100%;border-radius:4px;background:var(--accent)}
.bd-foot{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);flex-wrap:wrap}
.bd-foot span+span::before{content:"·";margin-inline-end:8px}
.bd-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:56px 20px;border:1.5px dashed var(--line-strong);border-radius:18px;margin-top:22px}
.bd-empty .bd-tile{width:56px;height:56px}
.bd-empty h2{margin:6px 0 0;font-size:18px;font-weight:650}
.bd-empty p{margin:0;max-width:52ch;color:var(--text-2);font-size:14px;line-height:1.55}
.bd-empty .bd-new{margin-top:8px}
.bd-none{color:var(--muted);font-size:14px;padding:24px 4px}
.bd-sk{height:178px;border-radius:14px}
@container bd (max-width:560px){
  .bd-title h1{font-size:22px}
  .bd-head .bd-new{flex:1 1 100%;justify-content:center;height:44px}
  .bd-search{flex:1 1 100%;height:44px}
  .bd-search input{font-size:16px}
  .bd-grid{grid-template-columns:minmax(0,1fr);gap:10px}
}
@media (prefers-reduced-motion:reduce){.bd-card{transition:none}}
`;

let boards: BoardInfo[] | null = null;
let failed: string | null = null;
let query = '';
let seq = 0;
let wired = false;

const host = (): HTMLElement | null => document.getElementById('view-boards');

/** Router entry: draw the page, then fetch the boards (a redraw keeps the last list until then). */
export async function renderBoards(): Promise<void> {
  useStyles('bd-css', CSS);
  wire();
  paint();
  const my = ++seq;
  try {
    const r = await apiGet<{ boards?: BoardInfo[] }>('/api/kanban/boards');
    if (my !== seq) return;
    boards = r.boards || [];
    failed = null;
  } catch (e) {
    if (my !== seq) return;
    failed = (e as Error).message;
  }
  if (state.page === 'boards') paint();
}

/** Notes change under the page (an agent, another tab): fetch again while it is shown. */
function wire(): void {
  if (wired) return;
  wired = true;
  let timer = 0;
  on('mutation', () => {
    if (state.page !== 'boards') return;
    clearTimeout(timer);
    timer = window.setTimeout(() => void renderBoards(), 400);
  });
}

function paint(): void {
  const h = host();
  if (!h) return;
  const searching = document.activeElement?.classList.contains('bd-q');
  const list = boards || [];
  const q = query.trim().toLowerCase();
  const shown = q ? list.filter((b) => (b.title + ' ' + b.path + ' ' + b.lanes.map((l) => l.title).join(' ')).toLowerCase().includes(q)) : list;
  const cards = list.reduce((n, b) => n + b.cards, 0);
  const sub = boards
    ? list.length
      ? `${tn(list.length, '{n} board', '{n} boards')} · ${tn(cards, '{n} card', '{n} cards')}`
      : t('No boards yet')
    : failed
      ? t('Not loaded')
      : t('Loading…');
  const newBtn = `<button type="button" class="btn primary bd-new" data-new>${I.plus}<span>${t('New board')}</span></button>`;
  let body: string;
  if (!boards && !failed) body = `<div class="bd-grid" aria-busy="true">${'<div class="sk bd-sk"></div>'.repeat(6)}</div>`;
  else if (!boards) body = `<p class="bd-none">${t('The boards could not be loaded.')} ${esc(failed || '')}</p>`;
  else if (!list.length)
    body = `<section class="bd-empty"><span class="bd-tile" aria-hidden="true">${I.board}</span><h2>${t('Plan your work on a board')}</h2>
      <p>${t('A board is a note with lanes of cards: drag cards from To do to Done, and let agents and Mnemo move them too. Boards made in Obsidian Kanban show up here as well.')}</p>${newBtn}</section>`;
  else if (!shown.length) body = `<p class="bd-none">${t('No board matches {q}.', { q: `<b>${esc(query.trim())}</b>` })}</p>`;
  else body = `<div class="bd-grid" role="list">${shown.map(cardHTML).join('')}</div>`;

  h.innerHTML = '';
  const page = el('div', 'bd');
  page.innerHTML = `<header class="bd-head"><span class="bd-tile" aria-hidden="true">${I.board}</span>
      <div class="bd-title"><h1>${t('Boards')}</h1><p>${sub}</p></div>${list.length ? newBtn : ''}</header>
    ${
      list.length > 1
        ? `<div class="bd-tbar"><label class="bd-search">${I.search}<input class="bd-q" type="search" value="${attr(query)}" placeholder="${attr(
            t('Find a board'),
          )}" aria-label="${attr(t('Find a board'))}" spellcheck="false" autocomplete="off"></label></div>`
        : '<div style="height:18px"></div>'
    }
    ${body}`;
  h.appendChild(page);
  page.querySelectorAll<HTMLElement>('[data-new]').forEach((b) => (b.onclick = () => nav.newBoard('')));
  page.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => (b.onclick = () => hooks.openNote(b.dataset.open || '')));
  const input = page.querySelector<HTMLInputElement>('.bd-q');
  if (input) {
    input.oninput = () => {
      query = input.value;
      paint();
    };
    if (searching) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

function cardHTML(b: BoardInfo): string {
  const folder = b.path.includes('/') ? b.path.slice(0, b.path.lastIndexOf('/')) : '';
  const max = Math.max(1, ...b.lanes.map((l) => l.cards));
  const lanes = b.lanes.slice(0, 8);
  const pct = b.cards ? Math.round((b.done / b.cards) * 100) : 0;
  const laneBars = lanes.length
    ? `<div class="bd-lanes" aria-hidden="true">${lanes
        .map(
          (l) =>
            `<div class="bd-lane" title="${attr(`${l.title}: ${tn(l.cards, '{n} card', '{n} cards')}`)}"><div class="bd-bar" style="--h:${Math.round((l.cards / max) * 100)}%"></div><span>${esc(l.title)}</span></div>`,
        )
        .join('')}</div>`
    : '';
  return `<button type="button" class="bd-card" role="listitem" data-open="${attr(b.path)}" style="--fc:${attr(colorOfFolder(folder))}"
      aria-label="${attr(`${b.title}, ${tn(b.lanes.length, '{n} lane', '{n} lanes')}, ${t('{done} of {total} done', { done: b.done, total: b.cards })}`)}">
    <span class="bd-top"><span class="bd-ico" aria-hidden="true">${I.board}</span><span class="bd-name"><b dir="auto">${esc(b.title)}</b><small>${esc(
      folder ? folder.split('/').join(' / ') : ROOT_LABEL,
    )}</small></span></span>
    ${laneBars}
    <span class="bd-prog"><span class="bd-meter"><i style="width:${pct}%"></i></span><span>${t('{done} of {total} done', { done: b.done, total: b.cards })}</span></span>
    <span class="bd-foot"><span>${tn(b.lanes.length, '{n} lane', '{n} lanes')}</span><span>${tn(b.cards, '{n} card', '{n} cards')}</span><span title="${attr(
      fmtTs(b.mtime),
    )}">${t('Changed {when}', { when: relTs(b.mtime) })}</span></span>
  </button>`;
}
