// Overview's Due section: open cards across every board that are overdue, due today or due in the
// next seven days. A row names the card, its board and lane and its date; a click opens the board at
// that card and the round box ticks it off right here (with Undo). Hidden while nothing is due.

import { attr, esc, useStyles } from '../dom';
import { hooks } from '../hooks';
import { t, tn } from '../i18n';
import { icon } from '../ui/icons';
import { plainTitle as plain } from './due';
import { onDue, openDueCard, tickDue, type DueCard, type DueList } from './due-watch';

const CSS = `
.ov-due-wrap{margin-bottom:16px}
.ov-due-wrap[hidden]{display:none}
@media (min-width:1024px){.ov-due-wrap{margin-bottom:20px}}
.du-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:4px 18px;padding:0 14px 14px}
.du-col{min-width:0}
.du-h{display:flex;align-items:center;gap:8px;margin:4px 8px 6px;font-size:12.5px;font-weight:650;color:var(--text-2)}
.du-h em{font-style:normal;font-variant-numeric:tabular-nums;color:var(--muted);font-weight:600}
.du-h i{width:8px;height:8px;border-radius:50%;background:var(--muted)}
.du-col.late .du-h i{background:var(--warn)}
.du-col.now .du-h i{background:color-mix(in srgb,var(--warn) 55%,var(--muted))}
.du-col.next .du-h i{background:var(--accent)}
.du-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.du-row{display:flex;align-items:center;gap:6px;min-width:0;border-radius:10px;transition:background .15s}
.du-row:hover{background:var(--hover)}
.du-tick{flex:none;display:grid;place-items:center;width:40px;height:40px;border:0;background:none;padding:0;cursor:pointer;color:var(--muted);border-radius:10px}
.du-tick span{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;border:1.5px solid currentColor;transition:background .15s,color .15s}
.du-tick svg{width:11px;height:11px;opacity:0;stroke-width:3}
.du-tick:hover{color:var(--accent)}
.du-tick:hover svg,.du-tick:focus-visible svg{opacity:.7}
.du-tick[aria-pressed=true] span{background:var(--accent);border-color:var(--accent);color:#fff}
.du-tick[aria-pressed=true] svg{opacity:1}
.du-open{flex:1;min-width:0;display:flex;align-items:center;gap:10px;border:0;background:none;color:inherit;font:inherit;text-align:start;padding:7px 8px 7px 0;cursor:pointer;border-radius:8px}
.du-t{flex:1;min-width:0}
.du-t b{display:block;font-size:13.5px;font-weight:550;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.du-t small{display:block;margin-top:1px;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.du-d{flex:none;height:22px;display:inline-flex;align-items:center;padding:0 8px;border-radius:99px;font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums;
  background:color-mix(in srgb,var(--fg) 6%,transparent);color:var(--text-2)}
.du-col.late .du-d{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
.du-col.now .du-d{background:color-mix(in srgb,var(--warn) 8%,transparent);color:color-mix(in srgb,var(--warn) 70%,var(--fg))}
.du-more{display:block;margin:2px 0 0 46px;padding:6px 8px;border:0;background:none;color:var(--accent);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;border-radius:8px}
.du-more:hover{background:var(--hover)}
.du-none{margin:2px 8px 8px;font-size:12.5px;color:var(--muted)}
.du-row.gone{opacity:.45;pointer-events:none}
@media (hover:none){.du-tick{width:44px;height:44px}}
@media (prefers-reduced-motion:reduce){.du-row,.du-tick span{transition:none}}
`;

const SHOWN = 5;
const open = new Set<string>();

function dayLabel(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
  if (days === 0) return t('Today');
  if (days === -1) return t('Yesterday');
  if (days === 1) return t('Tomorrow');
  if (days < 0) return tn(-days, '{n} day late', '{n} days late');
  try {
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return date;
  }
}

function rowHTML(c: DueCard, i: number, today: string): string {
  return `<li class="du-row" data-i="${i}">
    <button type="button" class="du-tick" aria-pressed="false" aria-label="${attr(t('Mark as done: {title}', { title: plain(c.title) }))}" title="${attr(t('Mark as done'))}"><span>${icon('check')}</span></button>
    <button type="button" class="du-open" title="${attr(t('Open the card on its board'))}"><span class="du-t"><b dir="auto">${esc(plain(c.title) || '…')}</b><small dir="auto">${esc(c.board_title)} · ${esc(c.lane)}</small></span>
      <time class="du-d" datetime="${attr(c.date)}" title="${attr(c.date)}">${esc(dayLabel(c.date, today))}</time></button>
  </li>`;
}

/** Fill `host` (Overview's slot between the top cards and the grid) and keep it current. */
export function mountDueSection(host: HTMLElement): void {
  useStyles('du-css', CSS);
  host.classList.add('ov-due-wrap');
  host.hidden = true;
  let cards: DueCard[] = [];
  const paint = (d: DueList): void => {
    if (!host.isConnected) return;
    const total = d.counts.overdue + d.counts.today + d.counts.upcoming;
    host.hidden = total === 0;
    if (!total) return;
    cards = [];
    const col = (key: string, cls: string, label: string, list: DueCard[], none: string): string => {
      const all = open.has(key);
      const shown = all ? list : list.slice(0, SHOWN);
      const rows = shown
        .map((c) => {
          cards.push(c);
          return rowHTML(c, cards.length - 1, d.today);
        })
        .join('');
      return `<div class="du-col ${cls}"><div class="du-h"><i aria-hidden="true"></i>${esc(label)}<em>${list.length}</em></div>${
        list.length ? `<ul class="du-list">${rows}</ul>` : `<p class="du-none">${esc(none)}</p>`
      }${list.length > SHOWN ? `<button type="button" class="du-more" data-more="${key}" aria-expanded="${all}">${all ? esc(t('Show fewer')) : esc(t('+{n} more', { n: list.length - SHOWN }))}</button>` : ''}</div>`;
    };
    host.innerHTML = `<section class="ov-card ov-due" aria-labelledby="ovDueT"><div class="ov-card-h"><h2 id="ovDueT">${t('Due')}</h2>
        <span class="grow"></span><button type="button" class="icon-btn round" data-boards aria-label="${attr(t('Open Boards'))}" title="${attr(t('Open Boards'))}">${icon('kanban')}</button></div>
      <div class="du-cols">
        ${col('late', 'late', t('Overdue'), d.overdue, t('Nothing overdue'))}
        ${col('now', 'now', t('Today'), d.due_today, t('Nothing due today'))}
        ${col('next', 'next', t('Next 7 days'), d.upcoming, t('Nothing due this week'))}
      </div></section>`;
  };
  host.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el.closest('[data-boards]')) return hooks.go('boards');
    const more = el.closest<HTMLElement>('[data-more]');
    if (more) {
      const k = more.dataset.more || '';
      if (open.has(k)) open.delete(k);
      else open.add(k);
      const d = lastList;
      if (d) paint(d);
      return;
    }
    const row = el.closest<HTMLElement>('.du-row');
    const c = row ? cards[Number(row.dataset.i)] : undefined;
    if (!row || !c) return;
    const tick = el.closest<HTMLElement>('.du-tick');
    if (tick) {
      tick.setAttribute('aria-pressed', 'true');
      row.classList.add('gone');
      void tickDue(c).then((ok) => {
        if (!ok) {
          tick.setAttribute('aria-pressed', 'false');
          row.classList.remove('gone');
        }
      });
      return;
    }
    if (el.closest('.du-open')) openDueCard(c);
  });
  let lastList: DueList | null = null;
  onDue((d) => {
    lastList = d;
    paint(d);
  });
}
