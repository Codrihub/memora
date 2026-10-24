import { attr, esc, useStyles } from '../dom';
import { fadeScroll } from './scroll-fade';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  /** Trusted HTML. */
  lead?: string;
  group?: string;
  disabled?: boolean;
}

interface SelectConfig {
  options: SelectOption[];
  value?: string;
  /** Accessible name; also the phone sheet heading. */
  label: string;
  labelledBy?: string;
  placeholder?: string;
  searchable?: boolean;
  className?: string;
  /** Trusted HTML for the button content. */
  render?: (o: SelectOption | undefined) => string;
  align?: 'start' | 'end';
  minWidth?: number;
  id?: string;
  disabled?: boolean;
  onChange?: (value: string, option: SelectOption) => void;
}

export interface Select {
  el: HTMLButtonElement;
  readonly value: string;
  set: (value: string, emit?: boolean) => void;
  setOptions: (options: SelectOption[], value?: string) => void;
  open: () => void;
  close: () => void;
}

const CHEV = '<svg class="ui-sel-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
const CHECK = '<svg class="ui-sel-ck" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17l9-10"/></svg>';
const SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';

const CSS = `
.ui-sel{display:inline-flex;align-items:center;gap:8px;height:40px;min-width:0;max-width:100%;padding:0 10px 0 12px;border-radius:var(--r-sm);
  border:1px solid var(--line-strong);background:var(--field-bg,var(--surface-0));color:var(--fg);font-size:14px;text-align:left;cursor:pointer;
  transition:border-color .15s,box-shadow .15s,background .15s}
.ui-sel:hover:not(:disabled){border-color:color-mix(in srgb,var(--fg) 26%,transparent)}
.ui-sel:focus-visible,.ui-sel[aria-expanded=true]{outline:none;border-color:var(--accent-line);box-shadow:0 0 0 3px var(--accent-soft)}
.ui-sel:disabled{opacity:.5;cursor:not-allowed}
.ui-sel-v{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ui-sel-v.ph{color:var(--muted)}
.ui-sel-chev{width:16px;height:16px;flex:none;fill:none;stroke:var(--muted);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;
  transition:transform .18s var(--ease)}
.ui-sel[aria-expanded=true] .ui-sel-chev{transform:rotate(180deg)}
.ui-sel .ui-sel-ld{display:grid;place-items:center;flex:none}

.ui-sel-scrim{position:fixed;inset:0;z-index:86}
.ui-sel-scrim.dim{background:var(--scrim);-webkit-backdrop-filter:var(--scrim-filter);backdrop-filter:var(--scrim-filter);opacity:0;transition:opacity .2s var(--ease)}
.ui-sel-scrim.dim.in{opacity:1}
.ui-sel-pop{position:fixed;z-index:87;display:flex;flex-direction:column;min-width:180px;max-width:min(420px,calc(100vw - 16px));
  background:var(--ovl-bg);-webkit-backdrop-filter:var(--ovl-filter);backdrop-filter:var(--ovl-filter);
  border:1px solid var(--line-strong);border-top-color:var(--ovl-edge);border-radius:var(--r);box-shadow:none;overflow:hidden;
  animation:uiSelIn .14s var(--ease)}
@keyframes uiSelIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.ui-sel-pop.up{animation-name:uiSelUp}
@keyframes uiSelUp{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.ui-sel-q{display:flex;align-items:center;gap:8px;margin:4px 4px 2px;padding:0 10px;height:36px;border-radius:var(--r-sm);flex:none;
  background:color-mix(in srgb,var(--fg) 4%,transparent);border:1px solid var(--line)}
.ui-sel-q:focus-within{border-color:var(--accent-line)}
.ui-sel-q svg{width:15px;height:15px;flex:none;fill:none;stroke:var(--muted);stroke-width:2;stroke-linecap:round}
.ui-sel-q input{flex:1;min-width:0;height:100%;border:0;outline:none;background:none;padding:0;font-size:13.5px;color:var(--fg);box-shadow:none}
.ui-sel-lb{list-style:none;margin:0;padding:4px;overflow-y:auto;overscroll-behavior:contain;flex:1;min-height:0}
.ui-sel-g{padding:8px 10px 4px;font-size:12px;font-weight:550;color:var(--muted)}
.ui-sel-g:first-child{padding-top:4px}
.ui-sel-g:not(:first-child){margin-top:4px;border-top:1px solid var(--line);padding-top:10px}
.ui-sel-o{display:flex;align-items:center;gap:10px;min-height:34px;padding:6px 10px;border-radius:var(--r-xs);cursor:pointer;font-size:13.5px;
  color:var(--fg);user-select:none}
.ui-sel-o.on{background:var(--hover)}
.ui-sel-o[aria-disabled=true]{opacity:.45;cursor:not-allowed}
.ui-sel-o .ld{display:grid;place-items:center;flex:none}
.ui-sel-o .tx{flex:1;min-width:0}
.ui-sel-o .tx b{display:block;font-weight:560;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ui-sel-o .tx small{display:block;font-size:12px;color:var(--muted);line-height:1.35;margin-top:1px}
.ui-sel-ck{width:16px;height:16px;flex:none;fill:none;stroke:var(--accent);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;visibility:hidden}
.ui-sel-o[aria-selected=true] .ui-sel-ck{visibility:visible}
.ui-sel-o[aria-selected=true] .tx b{font-weight:650}
.ui-sel-empty{margin:0;padding:14px 12px 16px;text-align:center;font-size:12.5px;color:var(--muted)}
.ui-sel-h{display:none}
.ui-sel-pop.sheet{left:0;right:0;bottom:0;top:auto;max-width:none;width:auto;max-height:88dvh;border-radius:var(--r) var(--r) 0 0;border-bottom:0;
  padding-bottom:env(safe-area-inset-bottom);animation:none;transform:translateY(100%);transition:transform .22s var(--ease)}
.ui-sel-pop.sheet.in{transform:none}
.ui-sel-pop.sheet .ui-sel-h{display:grid;grid-template-columns:1fr auto;align-items:center;flex:none;padding:0 8px 8px 16px;border-bottom:1px solid var(--line)}
.ui-sel-pop.sheet .ui-sel-h i{grid-column:1/-1;display:block;width:36px;height:4px;border-radius:99px;background:var(--line-strong);margin:8px auto 4px}
.ui-sel-pop.sheet .ui-sel-h b{font-size:16px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ui-sel-x{all:unset;cursor:pointer;display:grid;place-items:center;width:44px;height:44px;border-radius:var(--r-sm);color:var(--muted)}
.ui-sel-x:hover{background:var(--hover);color:var(--fg)}
.ui-sel-x svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.ui-sel-pop.sheet .ui-sel-q{margin:8px 12px 4px;height:44px}
.ui-sel-pop.sheet .ui-sel-lb{padding:4px 8px 10px}
.ui-sel-pop.sheet .ui-sel-o{min-height:48px;padding:10px 12px;border-radius:var(--r-sm);font-size:15px}
.ui-sel-pop.sheet .ui-sel-o.on{background:transparent}
.ui-sel-pop.sheet .ui-sel-o:active{background:var(--hover)}
.ui-sel-pop.sheet .ui-sel-o[aria-selected=true]{background:var(--accent-soft)}
.ui-sel-pop.sheet .ui-sel-ck{width:18px;height:18px}
@media (max-width:760px){.ui-sel{height:44px;font-size:15px}}
@media (prefers-reduced-motion:reduce){.ui-sel-pop,.ui-sel-pop.sheet,.ui-sel-scrim.dim{animation:none;transition:none}}
`;

const MOBILE = '(max-width: 760px)';
let seq = 0;
let current: { close: (focus: boolean) => void } | null = null;

export function createSelect(cfg: SelectConfig): Select {
  useStyles('ui-select-css', CSS);
  const uid = cfg.id || 'uisel' + (++seq).toString(36);
  let options = cfg.options.slice();
  let value = cfg.value ?? '';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = uid;
  btn.className = 'ui-sel' + (cfg.className ? ' ' + cfg.className : '');
  btn.setAttribute('role', 'combobox');
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', uid + '-lb');
  if (cfg.labelledBy) btn.setAttribute('aria-labelledby', cfg.labelledBy + ' ' + uid);
  else btn.setAttribute('aria-label', cfg.label);
  btn.disabled = !!cfg.disabled;

  const selected = (): SelectOption | undefined => options.find((o) => o.value === value);
  const paintButton = (): void => {
    const o = selected();
    btn.innerHTML = cfg.render
      ? cfg.render(o)
      : `${o?.lead ? `<span class="ui-sel-ld">${o.lead}</span>` : ''}<span class="ui-sel-v${o ? '' : ' ph'}">${esc(
          o?.label || cfg.placeholder || 'Choose',
        )}</span>${CHEV}`;
  };
  paintButton();

  let pop: HTMLElement | null = null;
  let scrim: HTMLElement | null = null;
  let list: HTMLElement | null = null;
  let input: HTMLInputElement | null = null;
  let shown: number[] = [];
  let active = -1;
  let buf = '';
  let bufAt = 0;

  const focusEl = (): HTMLElement => input || btn;

  const setActive = (pos: number, scroll = true): void => {
    if (!list) return;
    active = pos;
    list.querySelectorAll('.ui-sel-o.on').forEach((n) => n.classList.remove('on'));
    const li = pos >= 0 ? list.querySelector<HTMLElement>(`[data-i="${shown[pos]}"]`) : null;
    if (li) {
      li.classList.add('on');
      focusEl().setAttribute('aria-activedescendant', li.id);
      if (scroll) li.scrollIntoView({ block: 'nearest' });
    } else focusEl().removeAttribute('aria-activedescendant');
  };

  const move = (delta: number): void => {
    if (!shown.length) return;
    let p = active;
    for (let n = 0; n < shown.length; n++) {
      p = p < 0 ? (delta > 0 ? 0 : shown.length - 1) : Math.max(0, Math.min(shown.length - 1, p + delta));
      if (!options[shown[p]].disabled) break;
      if ((delta > 0 && p === shown.length - 1) || (delta < 0 && p === 0)) break;
    }
    if (!options[shown[p]]?.disabled) setActive(p);
  };

  const paintList = (): void => {
    if (!list || !pop) return;
    const q = (input?.value || '').trim().toLowerCase();
    shown = [];
    let html = '';
    let group: string | undefined;
    options.forEach((o, i) => {
      if (q && !(o.label + ' ' + (o.hint || '') + ' ' + (o.group || '')).toLowerCase().includes(q)) return;
      if (o.group && o.group !== group) html += `<li class="ui-sel-g" role="presentation">${esc(o.group)}</li>`;
      group = o.group;
      shown.push(i);
      html += `<li class="ui-sel-o" role="option" id="${attr(uid)}-o${i}" data-i="${i}" aria-selected="${o.value === value}"${
        o.disabled ? ' aria-disabled="true"' : ''
      }>${o.lead ? `<span class="ld">${o.lead}</span>` : ''}<span class="tx"><b>${esc(o.label)}</b>${
        o.hint ? `<small>${esc(o.hint)}</small>` : ''
      }</span>${CHECK}</li>`;
    });
    list.innerHTML = html;
    (pop.querySelector('.ui-sel-empty') as HTMLElement).hidden = shown.length > 0;
    const cur = shown.findIndex((i) => options[i].value === value);
    setActive(cur >= 0 ? cur : shown.findIndex((i) => !options[i].disabled));
  };

  const place = (): void => {
    if (!pop || pop.classList.contains('sheet')) return;
    if (!btn.isConnected) return close(false);
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    pop.style.minWidth = Math.max(r.width, cfg.minWidth || 0) + 'px';
    pop.style.maxHeight = '';
    const natural = Math.min(pop.scrollHeight, 360);
    const below = vh - r.bottom - 10;
    const above = r.top - 10;
    const up = natural > below && above > below;
    const room = Math.max(120, Math.min(360, up ? above : below));
    pop.style.maxHeight = room + 'px';
    pop.classList.toggle('up', up);
    const h = Math.min(natural, room);
    const w = pop.offsetWidth;
    let left = cfg.align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(vw - w - 8, left));
    pop.style.left = left + 'px';
    pop.style.top = (up ? r.top - 6 - h : r.bottom + 6) + 'px';
  };

  const choose = (i: number): void => {
    const o = options[i];
    if (!o || o.disabled) return;
    const changed = o.value !== value;
    value = o.value;
    paintButton();
    close(true);
    if (changed) cfg.onChange?.(value, o);
  };

  const typeAhead = (ch: string, pick: boolean): void => {
    const now = Date.now();
    buf = now - bufAt > 600 ? ch : buf + ch;
    bufAt = now;
    const pool = pick ? options.map((_, i) => i) : shown;
    const from = pick ? options.findIndex((o) => o.value === value) : active;
    // Repeating one letter cycles its matches; a longer word refines.
    const same = buf.split('').every((c) => c === buf[0]);
    const needle = same ? buf[0] : buf;
    const start = same ? from + 1 : Math.max(from, 0);
    for (let n = 0; n < pool.length; n++) {
      const p = (start + n) % pool.length;
      const o = options[pool[p]];
      if (!o.disabled && o.label.toLowerCase().startsWith(needle)) {
        if (pick) {
          if (o.value !== value) {
            value = o.value;
            paintButton();
            cfg.onChange?.(value, o);
          }
        } else setActive(p);
        return;
      }
    }
  };

  const onKey = (e: KeyboardEvent): void => {
    if (!pop) return;
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (e.altKey && k === 'ArrowUp') {
        if (active >= 0) choose(shown[active]);
        return;
      }
      move(k === 'ArrowDown' ? 1 : -1);
    } else if (k === 'PageDown' || k === 'PageUp') {
      e.preventDefault();
      move(k === 'PageDown' ? 8 : -8);
    } else if ((k === 'Home' || k === 'End') && !input) {
      e.preventDefault();
      setActive(-1, false);
      move(k === 'Home' ? 1 : -1);
    } else if (k === 'Enter' || (k === ' ' && !input)) {
      e.preventDefault();
      e.stopPropagation();
      if (active >= 0) choose(shown[active]);
    } else if (k === 'Tab') {
      close(false);
    } else if (!input && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      typeAhead(k.toLowerCase(), false);
    }
  };

  const onScroll = (e: Event): void => {
    if (pop && e.target instanceof Node && pop.contains(e.target)) return;
    place();
  };

  function open(): void {
    if (pop || btn.disabled) return;
    current?.close(false);
    const sheet = window.matchMedia(MOBILE).matches;
    scrim = document.createElement('div');
    scrim.className = 'ui-sel-scrim' + (sheet ? ' dim' : '');
    pop = document.createElement('div');
    pop.className = 'ui-sel-pop' + (sheet ? ' sheet' : '');
    pop.innerHTML = `<div class="ui-sel-h"><i aria-hidden="true"></i><b aria-hidden="true">${esc(cfg.label)}</b><button type="button" class="ui-sel-x" aria-label="Close" title="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>${
      cfg.searchable
        ? `<label class="ui-sel-q">${SEARCH}<span class="sr-only">Filter</span><input type="text" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="${attr(
            uid,
          )}-lb" placeholder="Search" autocomplete="off" spellcheck="false"></label>`
        : ''
    }<ul class="ui-sel-lb" role="listbox" id="${attr(uid)}-lb" aria-label="${attr(cfg.label)}" tabindex="-1"></ul><p class="ui-sel-empty" hidden>Nothing matches</p>`;
    list = pop.querySelector('.ui-sel-lb');
    input = pop.querySelector('input');
    fadeScroll(list);
    pop.querySelector<HTMLElement>('.ui-sel-x')!.onclick = () => close(true);
    document.body.append(scrim, pop);
    btn.setAttribute('aria-expanded', 'true');
    paintList();
    place();
    if (sheet)
      requestAnimationFrame(() => {
        scrim?.classList.add('in');
        pop?.classList.add('in');
      });
    if (input) {
      input.oninput = () => paintList();
      if (!sheet) input.focus();
    }
    scrim.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      close(!sheet);
    });
    list!.addEventListener('mousedown', (e) => e.preventDefault());
    list!.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('.ui-sel-o');
      if (li) choose(Number(li.dataset.i));
    });
    list!.addEventListener('mousemove', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('.ui-sel-o');
      if (!li || li.getAttribute('aria-disabled') === 'true') return;
      const p = shown.indexOf(Number(li.dataset.i));
      if (p !== active) setActive(p, false);
    });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    current = { close };
  }

  function close(focus = true): void {
    if (!pop) return;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', place);
    const p = pop;
    const s = scrim;
    pop = scrim = list = null;
    input = null;
    if (p.classList.contains('sheet')) {
      p.classList.remove('in');
      s?.classList.remove('in');
      setTimeout(() => {
        p.remove();
        s?.remove();
      }, 200);
    } else {
      p.remove();
      s?.remove();
    }
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-activedescendant');
    if (current?.close === close) current = null;
    if (focus) btn.focus();
  }

  btn.addEventListener('click', () => (pop ? close(true) : open()));
  btn.addEventListener('keydown', (e) => {
    if (pop) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') {
      e.preventDefault();
      open();
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      typeAhead(k.toLowerCase(), true);
    }
  });

  return {
    el: btn,
    get value() {
      return value;
    },
    set(v: string, emit = false) {
      value = v;
      paintButton();
      if (pop) paintList();
      const o = selected();
      if (emit && o) cfg.onChange?.(value, o);
    },
    setOptions(next: SelectOption[], v?: string) {
      options = next.slice();
      if (v !== undefined) value = v;
      paintButton();
      if (pop) paintList();
    },
    open,
    close: () => close(false),
  };
}

export function mountSelect(slot: Element | null, cfg: SelectConfig): Select {
  const s = createSelect(cfg);
  slot?.replaceWith(s.el);
  return s;
}
