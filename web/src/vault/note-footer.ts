// The foot of a note: what links here and where it links, as one component on every screen. Each
// section has the same header with a count, the same chips (a note, a board, a link not created
// yet), folds away, and shows a long list in part until asked for the rest.

import { el, esc, useStyles } from '../dom';
import { t } from '../i18n';
import { mentionNoteChip, missingChip, noteChip, useChips } from '../ui/chips';

const CSS = `
.nf{margin-top:56px;display:flex;flex-direction:column;gap:0;border-top:1px solid var(--line)}
.nf-sec{border-bottom:1px solid var(--line);padding:4px 0 14px}
.nf-t{margin:0;font-size:13px;font-weight:650;letter-spacing:.02em;color:var(--text-2)}
.nf-h{display:flex;align-items:center;gap:8px;width:100%;min-height:48px;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;text-align:start}
.nf-n{min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--surface-2,var(--hover));color:var(--muted);font-size:11.5px;font-weight:600;
  line-height:20px;text-align:center;font-variant-numeric:tabular-nums;box-sizing:border-box}
.nf-chev{margin-inline-start:auto;width:16px;height:16px;color:var(--muted);transition:transform .2s}
.nf-sec.shut .nf-chev{transform:rotate(-90deg)}
[dir=rtl] .nf-sec.shut .nf-chev{transform:rotate(90deg)}
.nf-h:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
.nf-list{display:flex;flex-wrap:wrap;gap:8px}
.nf-sec.shut .nf-list,.nf-sec.shut .nf-more,.nf-sec.shut .nf-none{display:none}
.nf-list .ch{max-width:min(100%,320px)}
.nf-none{margin:0;font-size:13px;line-height:1.5;color:var(--muted)}
.nf-more{display:inline-flex;align-items:center;min-height:32px;margin-top:8px;padding:0 4px;margin-inline-start:-4px;border:0;border-radius:6px;background:none;
  color:color-mix(in srgb,var(--accent) 70%,var(--fg));font:inherit;font-size:13px;font-weight:550;cursor:pointer}
.nf-more:hover{text-decoration:underline;text-underline-offset:3px}
.nf-more:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (hover:none){.nf-more{min-height:40px}}
@container vxnote (max-width:760px){.nf{margin-top:40px}}
@media (prefers-reduced-motion:reduce){.nf-chev{transition:none}}
`;

const CHEV =
  '<svg class="nf-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

/** Chips shown before "Show all". */
const FIRST = 12;
const LS = 'memora.reader.foot';

function shutSet(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(LS) || '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function remember(id: string, shut: boolean): void {
  const s = shutSet();
  if (shut) s.add(id);
  else s.delete(id);
  try {
    localStorage.setItem(LS, JSON.stringify([...s]));
  } catch {
    /* private mode: for this visit only */
  }
}

export interface FooterData {
  /** Notes that link here. */
  backlinks: string[];
  /** Where this note links: a path, or null for a note not created yet. */
  outs: { name: string; path: string | null }[];
  /** A board: the notes that put it in with `![[...]]` (the rest of `backlinks` only link to it).
   *  Its foot then reads Embedded in / Linked from, and Links to only when its cards link out. */
  embedded?: string[];
}

export interface FooterActions {
  open(path: string): void;
  create(name: string, at: HTMLElement): void;
}

export function noteFooter(d: FooterData, act: FooterActions): HTMLElement {
  useStyles('nf-css', CSS);
  useChips();
  const shut = shutSet();
  const foot = el('footer', 'nf');
  const section = (id: string, title: string, chips: string[], none: string): string => {
    const more = chips.length > FIRST;
    return `<section class="nf-sec${shut.has(id) ? ' shut' : ''}" data-sec="${id}" aria-labelledby="nf-${id}-h">
      <h2 class="nf-t" id="nf-${id}-h"><button type="button" class="nf-h" aria-expanded="${!shut.has(id)}" aria-controls="nf-${id}-l">${esc(title)}<span class="nf-n">${chips.length}</span>${CHEV}</button></h2>
      ${
        chips.length
          ? `<div class="nf-list" id="nf-${id}-l">${chips.slice(0, more ? FIRST : chips.length).join('')}</div>${
              more ? `<button type="button" class="nf-more" data-all aria-expanded="false">${esc(t('Show all {n}', { n: chips.length }))}</button>` : ''
            }`
          : `<p class="nf-none" id="nf-${id}-l">${esc(none)}</p>`
      }
    </section>`;
  };
  const outs = d.outs.map((o) => (o.path ? noteChip(o.path) : missingChip(o.name)));
  let back: string[];
  if (d.embedded) {
    // A board: every note that mentions it in one list, those that show it first, each with a
    // small marker (shows this board / links here).
    const inside = new Set(d.embedded);
    back = [
      ...d.embedded.map((p) => mentionNoteChip(p, true)),
      ...d.backlinks.filter((p) => !inside.has(p)).map((p) => mentionNoteChip(p, false)),
    ];
    foot.innerHTML =
      section('back', t('Mentioned in'), back, t('No other note links here yet.')) + (outs.length ? section('out', t('Links to'), outs, '') : '');
  } else {
    back = d.backlinks.map((p) => noteChip(p));
    foot.innerHTML =
      section('back', t('Mentioned in'), back, t('No other note links here yet.')) +
      section('out', t('Links to'), outs, t('This note does not link to other notes yet. Type [[ while editing to add a link.'));
  }
  const all: Record<string, string[]> = { back, out: outs };
  foot.querySelectorAll<HTMLElement>('.nf-sec').forEach((sec) => {
    const id = sec.dataset.sec || '';
    const h = sec.querySelector<HTMLElement>('.nf-h')!;
    h.onclick = () => {
      const now = !sec.classList.contains('shut');
      sec.classList.toggle('shut', now);
      h.setAttribute('aria-expanded', String(!now));
      remember(id, now);
    };
    const more = sec.querySelector<HTMLElement>('[data-all]');
    if (more)
      more.onclick = () => {
        const list = sec.querySelector<HTMLElement>('.nf-list')!;
        const open = more.dataset.open === '1';
        list.innerHTML = (open ? all[id].slice(0, FIRST) : all[id]).join('');
        more.dataset.open = open ? '' : '1';
        more.setAttribute('aria-expanded', String(!open));
        more.textContent = open ? t('Show all {n}', { n: all[id].length }) : t('Show fewer');
      };
  });
  foot.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-open],[data-create]');
    if (!b || !foot.contains(b)) return;
    if (b.dataset.open) act.open(b.dataset.open);
    else act.create(b.dataset.create || '', b);
  });
  return foot;
}
