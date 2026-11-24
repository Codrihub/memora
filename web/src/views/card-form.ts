// The card form: add or edit a card with fields instead of raw text. The text, the lane (a picker
// of the board's lanes), done, a due date and time (a calendar with quick picks and times), linked
// notes (a search over the vault) and tags (the vault's tags with their counts), written back into
// the card's own line in the Obsidian Kanban syntax (card-text.ts). A dialog on wide screens and a
// bottom sheet on phones (the app's Modal). Every list opens in the form's own flow, so nothing
// floats under the keyboard or out of the sheet. Enter saves, Shift+Enter starts a new line, Esc
// closes.

import { attr, esc, useStyles } from '../dom';
import { t, tn } from '../i18n';
import { Modal } from '../modal';
import { allNotes, isBoard, noteTitle } from '../state';
import { CHIP_ICONS, useChips } from '../ui/chips';
import { colorPickHTML, wireColorPick } from '../ui/color-pick';
import { parseCard, writeCard, type CardFields, type CardSettings } from './card-text';
import { vaultTagCounts } from './tags';

export interface CardFormOpts {
  /** The card's text and done state ('' and false for a new card). */
  text: string;
  checked: boolean;
  /** The card's own colour ('' for none). */
  color: string;
  lane: number;
  lanes: { index: number; title: string }[];
  settings: CardSettings;
  /** Tags already on the board, offered with the vault's. */
  boardTags: string[];
  isNew: boolean;
  /** The board the card is on: never offered as a linked note. */
  self?: string;
  save(r: { text: string; checked: boolean; lane: number; color: string }): void;
  archive?(): void;
  remove?(): void;
}

const CSS = `
.modal:has(.cf){overflow-x:hidden}
.modal-body:has(>.cf){min-width:0;overflow-x:hidden}
.cf{display:flex;flex-direction:column;gap:18px;min-width:0;max-width:100%}
.cf *{box-sizing:border-box}
/* No icon in the form can grow past its row, whatever its own class says. */
:where(.cf) svg{width:18px;height:18px;flex:none}
.cf-add .ch-ic{width:16px;height:16px;color:var(--muted)}
.cf-f{display:flex;flex-direction:column;gap:8px;min-width:0}
.cf-k{font-size:12.5px;font-weight:650;letter-spacing:.01em;color:var(--text-2)}
.cf-text{display:block;width:100%;min-height:84px;max-height:36dvh;resize:vertical;font:inherit;font-size:15px;line-height:1.5;padding:10px 12px;
  border:1px solid var(--line-strong);border-radius:12px;background:var(--surface-1);color:var(--fg)}
.cf-text:focus,.cf-in:focus-within,.cf-btn:focus-visible,.cf-opt:focus-visible,.cf-day:focus-visible,.cf-q:focus-visible,.cf-tm:focus-visible,.cf-sw:focus-visible{
  outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.cf-row{display:flex;gap:10px;align-items:stretch;min-width:0}
.cf-row>.cf-btn{flex:1 1 auto}
/* A field that opens a list below it. */
.cf-btn{display:flex;align-items:center;gap:10px;width:100%;min-width:0;min-height:44px;padding:0 12px;border:1px solid var(--line-strong);border-radius:12px;
  background:var(--surface-1);color:var(--fg);font:inherit;font-size:14.5px;text-align:start;cursor:pointer}
.cf-btn:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line-strong))}
.cf-btn[aria-expanded=true]{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.cf-btn>span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cf-btn>span.muted{color:var(--muted)}
.cf-btn .cf-ic{flex:none;width:17px;height:17px;color:var(--muted)}
.cf-chev{flex:none;width:16px;height:16px;color:var(--muted);transition:transform .18s}
.cf-btn[aria-expanded=true] .cf-chev{transform:rotate(180deg)}
.cf-x{display:grid;place-items:center;flex:none;width:26px;height:26px;padding:0;border:0;border-radius:7px;background:none;color:var(--muted);cursor:pointer}
.cf-x:hover{background:var(--hover);color:var(--fg)}
.cf-x svg{width:13px;height:13px}
/* Done: a switch beside the lane. */
.cf-sw{display:inline-flex;align-items:center;gap:9px;flex:none;min-height:44px;padding:0 14px 0 10px;border:1px solid var(--line-strong);border-radius:12px;
  background:var(--surface-1);color:var(--fg);font:inherit;font-size:14.5px;cursor:pointer}
.cf-sw i{position:relative;width:34px;height:20px;border-radius:10px;background:var(--line-strong);transition:background .18s;flex:none}
.cf-sw i::after{content:"";position:absolute;top:2px;inset-inline-start:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .18s}
.cf-sw[aria-checked=true] i{background:var(--accent)}
.cf-sw[aria-checked=true] i::after{transform:translateX(14px)}
[dir=rtl] .cf-sw[aria-checked=true] i::after{transform:translateX(-14px)}
/* Lists that open in the form's flow. */
.cf-pop{display:flex;flex-direction:column;gap:2px;padding:4px;border:1px solid var(--line);border-radius:12px;background:var(--panel);
  box-shadow:0 8px 24px rgba(0,0,0,.08);min-width:0;max-height:260px;overflow-y:auto;overscroll-behavior:contain}
.cf-pop[hidden]{display:none}
.cf-opt{display:flex;align-items:center;gap:10px;width:100%;min-width:0;min-height:44px;padding:6px 10px;border:1px solid transparent;border-radius:9px;
  background:none;color:var(--fg);font:inherit;font-size:14.5px;text-align:start;cursor:pointer}
.cf-opt:hover,.cf-opt[aria-selected=true]{background:var(--hover)}
.cf-opt .cf-ic,.cf-opt .ch-ic{flex:none;width:17px;height:17px;color:var(--muted)}
.cf-opt .ch-ic{color:#7c3aed}
:root:not([data-theme=light]) .cf-opt .ch-ic{color:#a78bfa}
.cf-opt>i{flex:none;width:8px;height:8px;margin-inline:4px 5px;border-radius:50%;background:var(--oc,var(--muted))}
.cf-ot{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.cf-ot b{font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cf-ot small{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cf-n{flex:none;min-width:24px;padding:0 7px;border-radius:10px;background:var(--surface-2,var(--hover));color:var(--muted);font-size:12px;line-height:20px;text-align:center;font-variant-numeric:tabular-nums}
.cf-tick{flex:none;width:17px;height:17px;color:var(--accent)}
.cf-opt.new b{font-weight:500;color:var(--text-2)}
/* Chips and a search box in one field. */
.cf-in{display:flex;flex-wrap:wrap;align-items:center;gap:6px;width:100%;min-width:0;min-height:44px;padding:6px 8px;border:1px solid var(--line-strong);
  border-radius:12px;background:var(--surface-1);cursor:text}
.cf-in input{flex:1 1 120px;min-width:0;height:30px;border:0;background:none;color:var(--fg);font:inherit;font-size:14.5px;outline:none;padding:0 4px}
.cf-in .ch{height:30px;max-width:100%;cursor:default;padding-inline-end:3px}
.cf-in .ch .cf-x{width:22px;height:22px}
/* The due date: quick picks, a month, times. */
.cf-cal{display:flex;flex-direction:column;gap:12px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);min-width:0}
.cf-cal[hidden]{display:none}
.cf-qs{display:flex;flex-wrap:wrap;gap:6px}
.cf-q{height:34px;padding:0 12px;border:1px solid var(--line-strong);border-radius:99px;background:var(--surface-1);color:var(--fg);font:inherit;font-size:13px;cursor:pointer}
.cf-q:hover{background:var(--hover)}
.cf-q.on{border-color:var(--accent);background:var(--accent-soft);color:var(--fg)}
.cf-mh{display:flex;align-items:center;gap:6px}
.cf-mh b{flex:1;text-align:center;font-size:14px;font-weight:650}
.cf-mh .cf-x{width:36px;height:36px}
.cf-mh .cf-x svg{width:16px;height:16px}
.cf-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;text-align:center}
.cf-wd{font-size:11px;font-weight:600;color:var(--muted);padding:2px 0 4px;text-transform:uppercase}
.cf-day{height:38px;min-width:0;border:1px solid transparent;border-radius:9px;background:none;color:var(--fg);font:inherit;font-size:13.5px;cursor:pointer;
  font-variant-numeric:tabular-nums}
.cf-day:hover{background:var(--hover)}
.cf-day.out{color:var(--text-3,var(--muted));opacity:.6}
.cf-day.today{font-weight:700;color:var(--accent)}
.cf-day.on{background:var(--accent);color:var(--on-accent);font-weight:650}
.cf-tl{display:flex;align-items:center;gap:8px;min-width:0}
.cf-tl>span{flex:none;font-size:12.5px;font-weight:650;color:var(--text-2)}
.cf-ts{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px;min-width:0;flex:1}
.cf-ts::-webkit-scrollbar{display:none}
.cf-tm{flex:none;height:34px;padding:0 11px;border:1px solid var(--line-strong);border-radius:9px;background:var(--surface-1);color:var(--fg);font:inherit;
  font-size:13px;font-variant-numeric:tabular-nums;cursor:pointer}
.cf-tm.on{border-color:var(--accent);background:var(--accent-soft)}
.cf-steps{display:flex;flex-direction:column;gap:4px;min-width:0}
.cf-step{display:flex;align-items:center;gap:8px;min-width:0;min-height:40px;padding:2px 4px 2px 8px;border:1px solid var(--line);border-radius:10px;background:var(--surface-1)}
.cf-step input[type=checkbox]{flex:none;width:18px;height:18px;margin:0;accent-color:var(--accent)}
.cf-step input[type=text]{flex:1 1 auto;min-width:0;height:32px;border:0;background:none;color:var(--fg);font:inherit;font-size:14.5px;outline:none;padding:0 2px}
.cf-step.done input[type=text]{color:var(--muted);text-decoration:line-through}
.cf-step:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.cf-step .cf-x{width:30px;height:30px}
.cf-add{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 12px;border:1.5px dashed var(--line-strong);border-radius:10px;color:var(--muted);cursor:text}
.cf-add input{flex:1;min-width:0;height:36px;border:0;background:none;color:var(--fg);font:inherit;font-size:14.5px;outline:none}
.cf-prog{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;margin-inline-start:6px;font-weight:500}
.cf-danger{display:flex;gap:8px;flex-wrap:wrap;padding-top:14px;border-top:1px solid var(--line)}
.cf-danger .btn{min-height:40px}
.cf-hint{font-size:12px;color:var(--muted)}
.cf-hint kbd{font-family:var(--mono);font-size:11px;border:1px solid var(--line-strong);border-radius:4px;padding:0 4px}
@media (hover:none){.cf-hint{display:none}}
@media (max-width:760px){
  .cf{gap:16px}
  .cf-text,.cf-btn,.cf-sw,.cf-in input,.cf-opt{font-size:16px}
  .cf-day{height:42px;font-size:15px}
  .cf-step input[type=text],.cf-add input,.cf .cpk-hex,.modal .cpk-hex{font-size:16px}
  .cf-q,.cf-tm{height:38px;font-size:14px}
}
@media (prefers-reduced-motion:reduce){.cf-chev,.cf-sw i,.cf-sw i::after{transition:none}}
`;

const svg = (d: string, cls = 'cf-ic'): string =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>', ''),
  chev: svg('<path d="M6 9l6 6 6-6"/>', 'cf-chev'),
  cal: svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  lane: svg('<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>'),
  tick: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'cf-tick'),
  prev: svg('<path d="M15 6l-6 6 6 6"/>', ''),
  next: svg('<path d="M9 6l6 6-6 6"/>', ''),
  hash: svg('<path d="M5 9h14M5 15h14M10 4l-2 16M16 4l-2 16"/>'),
};

const pad = (n: number): string => String(n).padStart(2, '0');
const iso = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const lang = (): string => document.documentElement.lang || undefined!;

/** "Tue, 24 Nov" (with the year when it is not this year), plus " · 10:30". */
function dueLabel(date: string, time: string): string {
  if (!date) return '';
  const d = fromIso(date);
  const same = d.getFullYear() === new Date().getFullYear();
  let s: string;
  try {
    s = d.toLocaleDateString(lang(), same ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    s = date;
  }
  return time ? `${s} · ${time}` : s;
}

/** What goes between the brackets for a note: its name, or Folder/Name when the name is not unique. */
function linkText(path: string): string {
  const name = path.split('/').pop()!.replace(/\.md$/i, '');
  const same = allNotes().filter((n) => n.path.split('/').pop()!.replace(/\.md$/i, '').toLowerCase() === name.toLowerCase());
  return same.length > 1 ? path.replace(/\.md$/i, '') : name;
}

function linkPath(target: string): string | null {
  const t0 = target.split('|')[0].split('#')[0].trim().toLowerCase();
  const n = allNotes().find((x) => x.path.toLowerCase() === t0 + '.md' || x.path.replace(/\.md$/i, '').toLowerCase() === t0 || x.path.replace(/\.md$/i, '').split('/').pop()!.toLowerCase() === t0);
  return n ? n.path : null;
}

/** Best matches first: the name starts with the query, then a word starts with it, then it is anywhere. */
function rank(text: string, q: string): number {
  const s = text.toLowerCase();
  if (s.startsWith(q)) return 0;
  if (new RegExp(`[\\s/_-]${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(s)) return 1;
  return s.includes(q) ? 2 : -1;
}

export function openCardForm(o: CardFormOpts): void {
  useStyles('cf-css', CSS);
  useChips();
  const parsed = parseCard(o.text, o.settings);
  const f: CardFields = { ...parsed.fields, links: [...parsed.fields.links], tags: [...parsed.fields.tags] };
  let lane = o.lane;
  let done = o.checked;
  let tagCounts = new Map<string, number>();
  for (const tg of o.boardTags) tagCounts.set(tg, 0);
  void vaultTagCounts()
    .then((m) => {
      for (const [k, n] of m) tagCounts.set(k, n);
    })
    .catch(() => {});

  const box = document.createElement('div');
  box.className = 'cf';
  box.innerHTML = `
    <div class="cf-f"><label class="cf-k" for="cfText">${t('Card')}</label>
      <textarea id="cfText" class="cf-text" rows="3" dir="auto" maxlength="10000" placeholder="${attr(t('What needs doing?'))}">${esc(f.text)}</textarea>
      <span class="cf-hint">${t('{enter} save · {shift} new line · {esc} close', { enter: '<kbd>Enter</kbd>', shift: '<kbd>Shift</kbd><kbd>Enter</kbd>', esc: '<kbd>Esc</kbd>' })}</span></div>
    <div class="cf-f"><span class="cf-k" id="cfLaneK">${t('Lane')}</span>
      <div class="cf-row">
        <button type="button" class="cf-btn" data-open="lanes" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="cfLaneK cfLaneV">${IC.lane}<span id="cfLaneV"></span>${IC.chev}</button>
        <button type="button" class="cf-sw" role="switch" aria-checked="${done}" data-done><i aria-hidden="true"></i>${t('Done')}</button>
      </div>
      <div class="cf-pop" role="listbox" aria-labelledby="cfLaneK" data-pop="lanes" hidden></div></div>
    <div class="cf-f"><span class="cf-k" id="cfStepsK">${t('Checklist')}<span class="cf-prog"></span></span>
      <div class="cf-steps" role="list" aria-labelledby="cfStepsK"></div>
      <label class="cf-add">${CHIP_ICONS.plus}<input type="text" id="cfStepNew" autocomplete="off" enterkeyhint="enter" placeholder="${attr(t('Add a step…'))}" aria-label="${attr(t('Add a step'))}"></label></div>
    <div class="cf-f"><span class="cf-k" id="cfDueK">${t('Due')}</span>
      <div class="cf-btn" role="button" tabindex="0" data-open="due" aria-haspopup="dialog" aria-expanded="false" aria-labelledby="cfDueK cfDueV">${IC.cal}<span id="cfDueV"></span>
        <button type="button" class="cf-x" data-clear aria-label="${attr(t('Clear the date'))}" title="${attr(t('Clear the date'))}">${IC.x}</button>${IC.chev}</div>
      <div class="cf-cal" data-pop="due" role="group" aria-labelledby="cfDueK" hidden></div></div>
    <div class="cf-f"><label class="cf-k" for="cfLinkQ">${t('Linked notes')}</label>
      <div class="cf-in" data-k="links"><input id="cfLinkQ" type="text" autocomplete="off" enterkeyhint="done" placeholder="${attr(t('Find a note…'))}" role="combobox" aria-expanded="false" aria-autocomplete="list"></div>
      <div class="cf-pop" role="listbox" hidden></div></div>
    <div class="cf-f"><label class="cf-k" for="cfTagQ">${t('Tags')}</label>
      <div class="cf-in" data-k="tags"><input id="cfTagQ" type="text" autocomplete="off" autocapitalize="off" enterkeyhint="done" placeholder="${attr(t('Add a tag…'))}" role="combobox" aria-expanded="false" aria-autocomplete="list"></div>
      <div class="cf-pop" role="listbox" hidden></div></div>
    <div class="cf-f"><span class="cf-k" id="cfColK">${t('Color')}</span><div role="group" aria-labelledby="cfColK">${colorPickHTML('cfColor', o.color, { none: true })}</div></div>
    ${
      o.isNew
        ? ''
        : `<div class="cf-danger"><button type="button" class="btn sm ghost" data-arch>${t('Archive')}</button><button type="button" class="btn sm ghost" data-del>${t('Delete')}</button></div>`
    }`;

  const ta = box.querySelector<HTMLTextAreaElement>('#cfText')!;
  const q = <T extends HTMLElement>(sel: string): T => box.querySelector<T>(sel)!;
  const reveal = (n: HTMLElement): void => {
    requestAnimationFrame(() => n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  // ── one list open at a time: the lanes or the calendar ──
  let openPop: 'lanes' | 'due' | null = null;
  const setPop = (which: 'lanes' | 'due' | null): void => {
    openPop = which;
    for (const k of ['lanes', 'due'] as const) {
      q<HTMLElement>(`[data-pop=${k}]`).hidden = which !== k;
      q<HTMLElement>(`[data-open=${k}]`).setAttribute('aria-expanded', String(which === k));
    }
    if (which === 'lanes') {
      paintLanes();
      const cur = q<HTMLElement>('[data-pop=lanes] [aria-selected=true]');
      cur?.focus();
      reveal(q('[data-pop=lanes]'));
    } else if (which === 'due') {
      paintCal();
      reveal(q('[data-pop=due]'));
    }
  };
  box.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => {
    const toggle = (): void => setPop(openPop === b.dataset.open ? null : (b.dataset.open as 'lanes' | 'due'));
    b.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-clear]')) return;
      toggle();
    });
    b.addEventListener('keydown', (e) => {
      if (e.target !== b) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    });
  });

  // ── lane ──
  const paintLaneValue = (): void => {
    q<HTMLElement>('#cfLaneV').textContent = o.lanes.find((l) => l.index === lane)?.title || '';
  };
  const paintLanes = (): void => {
    const pop = q<HTMLElement>('[data-pop=lanes]');
    pop.innerHTML = o.lanes
      .map(
        (l) =>
          `<button type="button" class="cf-opt" role="option" aria-selected="${l.index === lane}" data-lane="${l.index}">${IC.lane}<span class="cf-ot"><b dir="auto">${esc(
            l.title,
          )}</b></span>${l.index === lane ? IC.tick : ''}</button>`,
      )
      .join('');
  };
  q<HTMLElement>('[data-pop=lanes]').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-lane]');
    if (!b) return;
    lane = Number(b.dataset.lane);
    paintLaneValue();
    setPop(null);
    q<HTMLElement>('[data-open=lanes]').focus();
  });
  q<HTMLElement>('[data-pop=lanes]').addEventListener('keydown', (e) => {
    const opts = [...q<HTMLElement>('[data-pop=lanes]').querySelectorAll<HTMLElement>('.cf-opt')];
    const i = opts.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      opts[(i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setPop(null);
      q<HTMLElement>('[data-open=lanes]').focus();
    }
  });
  paintLaneValue();

  // ── done ──
  q<HTMLElement>('[data-done]').addEventListener('click', (e) => {
    done = !done;
    (e.currentTarget as HTMLElement).setAttribute('aria-checked', String(done));
  });

  // ── due date and time ──
  let month = fromIso(f.date || iso(new Date()));
  month.setDate(1);
  const paintDue = (): void => {
    const v = q<HTMLElement>('#cfDueV');
    v.textContent = f.date ? dueLabel(f.date, f.time) : t('No date');
    v.classList.toggle('muted', !f.date);
    q<HTMLElement>('[data-clear]').hidden = !f.date;
  };
  const setDue = (date: string, time = f.time): void => {
    f.date = date;
    f.time = date ? time : '';
    paintDue();
    if (openPop === 'due') paintCal();
  };
  const paintCal = (): void => {
    const cal = q<HTMLElement>('[data-pop=due]');
    const today = new Date();
    const add = (n: number): string => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
      return iso(d);
    };
    const quick = [
      { label: t('Today'), v: add(0) },
      { label: t('Tomorrow'), v: add(1) },
      { label: t('Next week'), v: add(7) },
      { label: t('No date'), v: '' },
    ];
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
    const days: string[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const v = iso(d);
      const cls = ['cf-day', d.getMonth() !== month.getMonth() ? 'out' : '', v === iso(today) ? 'today' : '', v === f.date ? 'on' : ''].filter(Boolean).join(' ');
      let label = v;
      try {
        label = d.toLocaleDateString(lang(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      } catch {
        /* the ISO date */
      }
      days.push(`<button type="button" class="${cls}" data-day="${v}" aria-label="${attr(label)}" aria-pressed="${v === f.date}" tabindex="${v === (f.date || iso(today)) ? 0 : -1}">${d.getDate()}</button>`);
    }
    let wds = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(2024, 0, 1 + i); // a Monday
      let w = 'MTWTFSS'[i];
      try {
        w = d.toLocaleDateString(lang(), { weekday: 'narrow' });
      } catch {
        /* first letters */
      }
      wds += `<span class="cf-wd" aria-hidden="true">${esc(w)}</span>`;
    }
    let title = `${month.getFullYear()}-${pad(month.getMonth() + 1)}`;
    try {
      title = month.toLocaleDateString(lang(), { month: 'long', year: 'numeric' });
    } catch {
      /* year-month */
    }
    const times: string[] = [];
    for (let h = 7; h <= 21; h++) for (const m of [0, 30]) times.push(`${pad(h)}:${pad(m)}`);
    if (f.time && !times.includes(f.time)) {
      times.push(f.time);
      times.sort();
    }
    cal.innerHTML = `<div class="cf-qs">${quick
      .map((x) => `<button type="button" class="cf-q${x.v === f.date ? ' on' : ''}" data-q="${x.v}">${esc(x.label)}</button>`)
      .join('')}</div>
      <div class="cf-mh"><button type="button" class="cf-x" data-m="-1" aria-label="${attr(t('Previous month'))}">${IC.prev}</button><b aria-live="polite">${esc(
        title,
      )}</b><button type="button" class="cf-x" data-m="1" aria-label="${attr(t('Next month'))}">${IC.next}</button></div>
      <div class="cf-grid">${wds}${days.join('')}</div>
      ${
        f.date
          ? `<div class="cf-tl"><span>${t('Time')}</span><div class="cf-ts" role="group" aria-label="${attr(t('Time'))}"><button type="button" class="cf-tm${f.time ? '' : ' on'}" data-tm="">${t(
              'No time',
            )}</button>${times.map((x) => `<button type="button" class="cf-tm${x === f.time ? ' on' : ''}" data-tm="${x}">${x}</button>`).join('')}</div></div>`
          : ''
      }`;
    const on = cal.querySelector<HTMLElement>('.cf-tm.on');
    if (on) requestAnimationFrame(() => on.scrollIntoView({ block: 'nearest', inline: 'center' }));
  };
  const cal = q<HTMLElement>('[data-pop=due]');
  cal.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.q != null) {
      setDue(b.dataset.q);
      if (!b.dataset.q) setPop(null);
    } else if (b.dataset.m) {
      month = new Date(month.getFullYear(), month.getMonth() + Number(b.dataset.m), 1);
      paintCal();
      cal.querySelector<HTMLElement>(`[data-m="${b.dataset.m}"]`)?.focus();
    } else if (b.dataset.day) {
      setDue(b.dataset.day);
      cal.querySelector<HTMLElement>(`[data-day="${b.dataset.day}"]`)?.focus();
    } else if (b.dataset.tm != null) {
      f.time = b.dataset.tm;
      paintDue();
      paintCal();
    }
  });
  cal.addEventListener('keydown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-day]');
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setPop(null);
      q<HTMLElement>('[data-open=due]').focus();
      return;
    }
    if (!b) return;
    const rtl = getComputedStyle(cal).direction === 'rtl';
    const step = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const d = fromIso(b.dataset.day!);
    const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + step);
    if (n.getMonth() !== month.getMonth()) {
      month = new Date(n.getFullYear(), n.getMonth(), 1);
      paintCal();
    }
    cal.querySelector<HTMLElement>(`[data-day="${iso(n)}"]`)?.focus();
  });
  q<HTMLElement>('[data-clear]').addEventListener('click', (e) => {
    e.stopPropagation();
    setDue('');
    q<HTMLElement>('[data-open=due]').focus();
  });
  paintDue();

  // ── linked notes and tags: chips and a search with suggestions under it ──
  const chipsOf = (k: 'links' | 'tags'): void => {
    const host = q<HTMLElement>(`.cf-in[data-k=${k}]`);
    host.querySelectorAll('.ch').forEach((c) => c.remove());
    const input = host.querySelector('input')!;
    for (const v of f[k]) {
      const c = document.createElement('span');
      if (k === 'links') {
        const p = linkPath(v);
        const shown = v.includes('|') ? v.split('|')[1] : p ? noteTitle(p) : v;
        const board = !!p && isBoard(p);
        c.className = `ch ${p ? (board ? 'ch-board' : 'ch-note') : 'ch-miss'}`;
        c.innerHTML = `${p ? (board ? CHIP_ICONS.board : '<i></i>') : CHIP_ICONS.plus}<b dir="auto">${esc(shown)}</b>`;
      } else {
        c.className = 'ch ch-tag';
        c.innerHTML = `<i></i><b>${esc(v)}</b>`;
      }
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'cf-x';
      x.innerHTML = IC.x;
      x.setAttribute('aria-label', t('Remove {name}', { name: v }));
      x.onclick = () => {
        f[k] = f[k].filter((y) => y !== v);
        chipsOf(k);
        input.focus();
      };
      c.appendChild(x);
      input.before(c);
    }
  };

  interface Item {
    value: string;
    html: string;
    isNew?: boolean;
  }
  const picker = (k: 'links' | 'tags', find: (q: string) => Item[]): void => {
    const host = q<HTMLElement>(`.cf-in[data-k=${k}]`);
    const input = host.querySelector('input')!;
    const pop = host.nextElementSibling as HTMLElement;
    let items: Item[] = [];
    let cur = 0;
    const paint = (): void => {
      const typed = input.value.trim().replace(k === 'tags' ? /^#/ : /^$/, '');
      items = typed ? find(typed) : [];
      cur = Math.min(cur, Math.max(0, items.length - 1));
      pop.hidden = !items.length;
      input.setAttribute('aria-expanded', String(!!items.length));
      pop.innerHTML = items
        .map((it, i) => `<button type="button" class="cf-opt${it.isNew ? ' new' : ''}" role="option" tabindex="-1" aria-selected="${i === cur}" data-i="${i}">${it.html}</button>`)
        .join('');
      if (items.length) reveal(pop);
    };
    const take = (v: string): void => {
      if (v && !f[k].includes(v)) f[k].push(v);
      input.value = '';
      cur = 0;
      paint();
      chipsOf(k);
      input.focus();
    };
    host.addEventListener('click', (e) => {
      if (e.target === host) input.focus();
    });
    input.addEventListener('input', () => {
      cur = 0;
      paint();
    });
    input.addEventListener('focus', () => setPop(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        cur = (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        paint();
      } else if ((e.key === 'Enter' || (k === 'tags' && (e.key === ',' || e.key === ' '))) && !e.isComposing) {
        const typed = input.value.trim().replace(/^#/, '');
        e.preventDefault();
        e.stopPropagation();
        if (!typed) {
          // An empty box: Enter saves the form.
          if (e.key === 'Enter') save();
          return;
        }
        if (items[cur]) take(items[cur].value);
        else if (k === 'tags' && /^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u.test(typed)) take(typed);
      } else if (e.key === 'Escape' && items.length) {
        e.preventDefault();
        e.stopPropagation();
        input.value = '';
        paint();
      } else if (e.key === 'Backspace' && !input.value && f[k].length) {
        f[k].pop();
        chipsOf(k);
      }
    });
    // A tap on a suggestion must not take the focus (and the keyboard) away first.
    pop.addEventListener('pointerdown', (e) => e.preventDefault());
    pop.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (b) take(items[Number(b.dataset.i)].value);
    });
  };

  picker('links', (qs) => {
    const s = qs.toLowerCase();
    return allNotes()
      .filter((n) => n.path !== o.self)
      .map((n) => ({ n, r: Math.min(...[noteTitle(n.path), n.name, n.path].map((x) => rank(x, s)).map((r) => (r < 0 ? 9 : r))) }))
      .filter((x) => x.r < 9 && !f.links.includes(linkText(x.n.path)))
      .sort((a, b) => a.r - b.r || noteTitle(a.n.path).localeCompare(noteTitle(b.n.path)))
      .slice(0, 8)
      .map(({ n }) => {
        const dir = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '';
        const board = isBoard(n.path);
        return {
          value: linkText(n.path),
          html: `${board ? CHIP_ICONS.board : svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>')}<span class="cf-ot"><b dir="auto">${esc(
            noteTitle(n.path),
          )}</b><small dir="auto">${esc(dir ? dir.split('/').join(' / ') : board ? t('Board') : t('Notes'))}</small></span>`,
        };
      });
  });
  picker('tags', (qs) => {
    const s = qs.toLowerCase();
    const list = [...tagCounts.entries()]
      .map(([tag, n]) => ({ tag, n, r: rank(tag, s) }))
      .filter((x) => x.r >= 0 && !f.tags.includes(x.tag))
      .sort((a, b) => a.r - b.r || b.n - a.n || a.tag.localeCompare(b.tag))
      .slice(0, 8);
    const out: Item[] = list.map((x) => ({
      value: x.tag,
      html: `${IC.hash}<span class="cf-ot"><b>${esc(x.tag)}</b></span>${x.n ? `<span class="cf-n" aria-label="${attr(tn(x.n, '{n} note', '{n} notes'))}">${x.n}</span>` : ''}`,
    }));
    const exact = [...tagCounts.keys()].some((x) => x.toLowerCase() === s) || f.tags.some((x) => x.toLowerCase() === s);
    if (!exact && /^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u.test(qs))
      out.push({ value: qs, isNew: true, html: `${CHIP_ICONS.plus}<span class="cf-ot"><b>${esc(t('New tag #{tag}', { tag: qs }))}</b></span>` });
    return out;
  });
  chipsOf('links');
  chipsOf('tags');

  // ── checklist: steps to tick, edit, move (Alt+arrows) and remove ──
  const steps = f.checklist.map((x) => ({ ...x }));
  const stepsBox = q<HTMLElement>('.cf-steps');
  const paintSteps = (focus = -1): void => {
    const done = steps.filter((x) => x.done).length;
    q<HTMLElement>('.cf-prog').textContent = steps.length ? `${done}/${steps.length}` : '';
    stepsBox.innerHTML = steps
      .map(
        (x, i) => `<div class="cf-step${x.done ? ' done' : ''}" role="listitem" data-s="${i}"><input type="checkbox"${x.done ? ' checked' : ''} aria-label="${attr(
          x.done ? t('Mark as not done') : t('Mark as done'),
        )}"><input type="text" value="${attr(x.text)}" dir="auto" aria-label="${attr(t('Step {n}', { n: i + 1 }))}"><button type="button" class="cf-x" aria-label="${attr(
          t('Remove {name}', { name: x.text }),
        )}">${IC.x}</button></div>`,
      )
      .join('');
    if (focus >= 0) stepsBox.querySelectorAll<HTMLInputElement>('input[type=text]')[focus]?.focus();
  };
  stepsBox.addEventListener('change', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
    if (!row || (e.target as HTMLInputElement).type !== 'checkbox') return;
    // Ticked in place, so the keyboard keeps its place.
    const box2 = e.target as HTMLInputElement;
    const i = Number(row.dataset.s);
    steps[i].done = box2.checked;
    row.classList.toggle('done', box2.checked);
    box2.setAttribute('aria-label', box2.checked ? t('Mark as not done') : t('Mark as done'));
    const d = steps.filter((x) => x.done).length;
    q<HTMLElement>('.cf-prog').textContent = `${d}/${steps.length}`;
  });
  stepsBox.addEventListener('input', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
    if (row && (e.target as HTMLInputElement).type === 'text') steps[Number(row.dataset.s)].text = (e.target as HTMLInputElement).value;
  });
  stepsBox.addEventListener('click', (e) => {
    const x = (e.target as HTMLElement).closest<HTMLElement>('.cf-x');
    const row = x?.closest<HTMLElement>('[data-s]');
    if (!row) return;
    const i = Number(row.dataset.s);
    steps.splice(i, 1);
    paintSteps(Math.min(i, steps.length - 1));
    if (!steps.length) q<HTMLInputElement>('#cfStepNew').focus();
  });
  stepsBox.addEventListener('keydown', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
    if (!row || (e.target as HTMLInputElement).type !== 'text') return;
    const i = Number(row.dataset.s);
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j < 0 || j >= steps.length) return;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      paintSteps(j);
    } else if (e.key === 'Enter' && !e.isComposing && !e.ctrlKey && !e.metaKey) {
      // Enter in a step goes to the next one (or the new-step box), never saves half a list.
      e.preventDefault();
      e.stopPropagation();
      const next = stepsBox.querySelectorAll<HTMLInputElement>('input[type=text]')[i + 1];
      (next || q<HTMLInputElement>('#cfStepNew')).focus();
    } else if (e.key === 'Backspace' && !(e.target as HTMLInputElement).value) {
      e.preventDefault();
      steps.splice(i, 1);
      paintSteps(Math.max(0, i - 1));
      if (!steps.length) q<HTMLInputElement>('#cfStepNew').focus();
    }
  });
  const newStep = q<HTMLInputElement>('#cfStepNew');
  newStep.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const v = newStep.value.trim();
    if (!v) {
      save();
      return;
    }
    steps.push({ text: v, done: false });
    newStep.value = '';
    paintSteps();
    newStep.focus();
  });
  paintSteps();
  const color = wireColorPick(box, 'cfColor');
  // A colour the picker cannot show (a name, rgb()) stays as it is unless another is picked.
  const color0 = color();

  const save = (): void => {
    // A note name typed in full but not picked still counts.
    const typedLink = q<HTMLInputElement>('#cfLinkQ').value.trim();
    if (typedLink) {
      const p = linkPath(typedLink);
      if (p && !f.links.includes(linkText(p))) f.links.push(linkText(p));
    }
    const typedTag = q<HTMLInputElement>('#cfTagQ').value.trim().replace(/^#/, '');
    if (typedTag && /^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u.test(typedTag) && !f.tags.includes(typedTag)) f.tags.push(typedTag);
    // A step typed but not added yet still counts.
    if (newStep.value.trim()) steps.push({ text: newStep.value.trim(), done: false });
    const edited: CardFields = {
      text: ta.value.replace(/\s+$/, ''),
      links: f.links,
      tags: f.tags,
      date: f.date,
      time: f.date ? f.time : '',
      checklist: steps.map((x) => ({ text: x.text.replace(/[\r\n]+/g, ' ').trim(), done: x.done })).filter((x) => x.text),
    };
    const out = writeCard(parsed, edited, o.settings).trim();
    // Steps need a card to belong to: the text comes first.
    if (!out || (!ta.value.trim() && edited.checklist.length)) {
      ta.focus();
      return;
    }
    Modal.close();
    o.save({ text: out, checked: done, lane, color: color() === color0 ? o.color : color() });
  };

  const del = box.querySelector<HTMLElement>('[data-del]');
  if (del)
    del.onclick = () => {
      // A second press deletes: the first one asks.
      if (del.dataset.sure !== '1') {
        del.dataset.sure = '1';
        del.classList.add('danger');
        del.textContent = t('Delete for good?');
        return;
      }
      Modal.close();
      o.remove?.();
    };
  const arch = box.querySelector<HTMLElement>('[data-arch]');
  if (arch)
    arch.onclick = () => {
      Modal.close();
      o.archive?.();
    };

  Modal.open({
    title: o.isNew ? t('New card') : t('Edit card'),
    body: box,
    actions: [
      { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
      { label: o.isNew ? t('Add card') : t('Save'), cls: 'primary', run: () => save() },
    ],
    onOpen: () => {
      // The text field first and fully in view: no scrolling the sheet to it.
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(ta.value.length, ta.value.length);
      const body = box.closest<HTMLElement>('.modal-body');
      if (body) {
        body.scrollTop = 0;
        requestAnimationFrame(() => (body.scrollTop = 0));
        window.setTimeout(() => (body.scrollTop = 0), 350);
      }
    },
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      save();
    }
  });
  ta.addEventListener('focus', () => setPop(null));
  // Esc closes an open list (the lanes, the calendar, suggestions) before the form itself: this runs
  // ahead of the dialog's own Esc, and lets go once the form is gone.
  const esc1 = (e: KeyboardEvent): void => {
    if (!box.isConnected) {
      window.removeEventListener('keydown', esc1, true);
      return;
    }
    if (e.key !== 'Escape') return;
    const sug = [...box.querySelectorAll<HTMLElement>('.cf-in + .cf-pop')].find((p) => !p.hidden);
    if (!openPop && !sug) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (openPop) {
      const was = openPop;
      setPop(null);
      q<HTMLElement>(`[data-open=${was}]`).focus();
    } else if (sug) {
      const input = sug.previousElementSibling?.querySelector('input');
      if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input'));
      }
    }
  };
  window.addEventListener('keydown', esc1, true);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  });
}
