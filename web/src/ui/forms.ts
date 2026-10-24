import { useStyles } from '../dom';

const CSS = `
:root{--field-bg:var(--surface-0)}
:root[data-theme=light]{--field-bg:var(--surface-1)}
.ui-fld{display:flex;flex-direction:column;gap:7px;margin:0 0 16px;min-width:0}
.ui-fld>label,.ui-fld>.ui-lbl{font-size:12.5px;font-weight:620;color:var(--text-2)}
.ui-fld .ui-help{font-size:12px;color:var(--muted);line-height:1.45}
.ui-input{width:100%;height:42px;min-width:0;padding:0 12px;border-radius:10px;border:1px solid var(--line-strong);background:var(--field-bg);
  color:var(--fg);font-size:14px;transition:border-color .15s,box-shadow .15s}
.ui-input::placeholder{color:var(--text-3)}
.ui-input:hover{border-color:color-mix(in srgb,var(--fg) 26%,transparent)}
.ui-input:focus{outline:none;border-color:var(--accent-line);box-shadow:0 0 0 3px var(--accent-soft)}
.ui-input.mono{font-family:var(--mono);font-size:13px}

.ui-rcs{display:grid;gap:8px;min-width:0}
.ui-rc{position:relative;display:flex;align-items:flex-start;gap:12px;width:100%;padding:13px 14px;border-radius:12px;text-align:left;min-width:0;
  border:1px solid var(--line);background:var(--surface-0);color:var(--fg);cursor:pointer;transition:border-color .15s,background .15s}
.ui-rc:hover:not(:disabled){border-color:var(--line-strong);background:var(--surface-2)}
.ui-rc[aria-checked=true]{border-color:var(--accent-line);background:var(--accent-soft)}
.ui-rc:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-soft);border-color:var(--accent-line)}
.ui-rc:disabled{opacity:.5;cursor:not-allowed}
.ui-rc .dot{position:relative;flex:none;width:18px;height:18px;margin-top:1px;border-radius:50%;border:1.5px solid var(--line-strong);
  background:var(--surface-1);transition:border-color .15s}
.ui-rc .dot::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--accent);transform:scale(0);transition:transform .16s var(--ease)}
.ui-rc[aria-checked=true] .dot{border-color:var(--accent)}
.ui-rc[aria-checked=true] .dot::after{transform:scale(1)}
.ui-rc .tx{flex:1;min-width:0}
.ui-rc .tx b{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13.5px;font-weight:640}
.ui-rc .tx small{display:block;margin-top:3px;font-size:12.5px;color:var(--muted);line-height:1.45}
.ui-rc .tag{display:inline-flex;align-items:center;height:19px;padding:0 7px;border-radius:99px;font-size:11px;font-weight:650;
  color:var(--accent);background:var(--accent-soft);border:1px solid var(--accent-line)}

.ui-cb{position:relative;flex:none;display:inline-grid;place-items:center;width:20px;height:20px;border-radius:6px;cursor:pointer;
  border:1.5px solid var(--line-strong);background:var(--field-bg);color:var(--on-accent);transition:background .14s,border-color .14s}
.ui-cb::before{content:"";position:absolute;inset:-12px}
.ui-cb svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;opacity:0;
  transform:scale(.6);transition:opacity .12s,transform .14s var(--ease)}
.ui-cb[aria-checked=true],.ui-cb[aria-checked=mixed]{background:var(--accent);border-color:var(--accent)}
.ui-cb[aria-checked=true] svg.ck,.ui-cb[aria-checked=mixed] svg.mx{opacity:1;transform:none}
.ui-cb svg.mx{position:absolute}
.ui-cb:hover{border-color:var(--accent-line)}
.ui-cb:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-soft);border-color:var(--accent)}
.ui-cb:disabled{opacity:.45;cursor:not-allowed}
@media (max-width:760px){.ui-input{height:46px;font-size:16px}}
`;

export function useFormStyles(): void {
  useStyles('ui-forms-css', CSS);
}

/** A checkbox button; `extra` is trusted attribute markup (data-*, aria-labelledby...). */
export function checkboxHTML(checked: boolean | 'mixed', extra = ''): string {
  return `<button type="button" class="ui-cb" role="checkbox" aria-checked="${checked}"${extra}><svg class="ck" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17l9-10"/></svg><svg class="mx" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg></button>`;
}

/** One radio card. `title`, `desc` and `tag` are trusted HTML. */
export function radioCardHTML(value: string, checked: boolean, title: string, desc = '', tag = '', disabled = false): string {
  return `<button type="button" class="ui-rc" role="radio" data-v="${value}" aria-checked="${checked}" tabindex="${checked ? 0 : -1}"${
    disabled ? ' disabled' : ''
  }><span class="dot" aria-hidden="true"></span><span class="tx"><b>${title}${tag ? `<span class="tag">${tag}</span>` : ''}</b>${
    desc ? `<small>${desc}</small>` : ''
  }</span></button>`;
}

export function wireRadios(group: HTMLElement, onChange: (value: string) => void): void {
  const items = (): HTMLButtonElement[] => Array.from(group.querySelectorAll<HTMLButtonElement>('.ui-rc:not(:disabled)'));
  const pick = (b: HTMLButtonElement, focus: boolean): void => {
    group.querySelectorAll<HTMLButtonElement>('.ui-rc').forEach((x) => {
      x.setAttribute('aria-checked', String(x === b));
      x.tabIndex = x === b ? 0 : -1;
    });
    if (focus) b.focus();
    onChange(b.dataset.v || '');
  };
  items().forEach((b) => {
    b.onclick = () => pick(b, false);
    b.onkeydown = (e) => {
      const list = items();
      const i = list.indexOf(b);
      let n = -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % list.length;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i - 1 + list.length) % list.length;
      if (n < 0) return;
      e.preventDefault();
      pick(list[n], true);
    };
  });
  if (!group.querySelector('.ui-rc[tabindex="0"]')) {
    const first = items()[0];
    if (first) first.tabIndex = 0;
  }
}
