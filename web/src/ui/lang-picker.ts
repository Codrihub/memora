// The language picker: a grid of every interface language (region code and the name in its
// own words), plus Auto. Settings and the welcome tour open it.

import { esc, useStyles } from '../dom';
import { LANGS, langPref, t } from '../i18n';
import { Modal } from '../modal';
import { icon } from './icons';

/** What a button shows for the current choice: "ID · Bahasa Indonesia", or Auto. */
export function langButtonHTML(code = langPref()): string {
  useStyles('lang-picker-css', CSS);
  const l = LANGS.find((x) => x.code === code);
  return l
    ? `<span class="lp-btn-f">${esc(l.flag)}</span><span class="lp-btn-l">${esc(l.label)}</span>${icon('chev-down', 'i lp-btn-c')}`
    : `<span class="lp-btn-f">${icon('monitor')}</span><span class="lp-btn-l">${esc(t('Auto (this device)'))}</span>${icon('chev-down', 'i lp-btn-c')}`;
}

/** Open the grid; `pick` gets the chosen code (`auto` for Auto). */
export function openLangPicker(current: string, pick: (code: string) => void): void {
  useStyles('lang-picker-css', CSS);
  const tile = (code: string, flag: string, label: string, rtl = false): string =>
    `<button type="button" class="lp-t${code === current ? ' on' : ''}" data-lang="${esc(code)}" aria-pressed="${code === current}"><b>${flag}</b><span${
      rtl ? ' dir="rtl"' : ''
    }>${esc(label)}</span>${code === current ? icon('check', 'i lp-ck') : ''}</button>`;
  const body = document.createElement('div');
  body.className = 'lp';
  body.innerHTML = `${tile('auto', icon('monitor'), t('Auto (this device)'))}${LANGS.map((l) => tile(l.code, esc(l.flag), l.label, !!l.rtl)).join('')}`;
  body.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-lang]');
    if (!b) return;
    Modal.close();
    if (b.dataset.lang !== current) pick(b.dataset.lang!);
  });
  Modal.open({
    title: t('Choose a language'),
    body,
    wide: true,
    onOpen: (el) => el.querySelector<HTMLElement>('.lp-t.on')?.focus({ preventScroll: false }),
  });
}

const CSS = `
.lp{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:8px;padding:2px}
.lp-t{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:92px;padding:12px 8px;border:1px solid transparent;
  border-radius:14px;background:none;color:var(--fg);font:inherit;cursor:pointer;text-align:center;transition:background .15s,border-color .15s}
.lp-t>b{font-size:18px;font-weight:650;letter-spacing:.02em;line-height:1}
.lp-t>b .i{width:20px;height:20px}
.lp-t>span{font-size:13px;font-weight:550;line-height:1.3;color:var(--text-2,var(--fg));overflow-wrap:anywhere}
.lp-t:hover{background:var(--hover)}
.lp-t:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.lp-t.on{border-color:var(--accent);background:var(--accent-soft)}
.lp-t.on>b,.lp-t.on>span{color:var(--accent)}
.lp-ck{position:absolute;bottom:8px;width:14px;height:14px;color:var(--accent)}
.lp-t.on{padding-bottom:26px}
@media (max-width:640px){.lp{grid-template-columns:repeat(auto-fill,minmax(104px,1fr))}.lp-t{min-height:80px}}
/* The button that opens it. */
.lp-btn{display:inline-flex;align-items:center;gap:10px;height:40px;max-width:100%;padding:0 12px;border:1px solid var(--line-strong);border-radius:10px;background:var(--surface-0,var(--bg));
  color:var(--fg);font:inherit;font-size:14px;cursor:pointer;min-width:0}
.lp-btn:hover{border-color:var(--fg)}
.lp-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.lp-btn-f{flex:none;display:inline-grid;place-items:center;min-width:26px;font-size:12px;font-weight:700;color:var(--muted)}
.lp-btn-f .i{width:15px;height:15px}
.lp-btn-l{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lp-btn-c{flex:none;width:14px;height:14px;color:var(--muted);margin-inline-start:auto}
`;
