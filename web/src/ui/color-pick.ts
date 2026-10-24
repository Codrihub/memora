import { attr, esc, useStyles } from '../dom';
import { AGENT_PALETTE } from '../control/agents';

const CSS = `
.cpk{display:flex;flex-wrap:wrap;align-items:center;gap:7px}
.cpk-sw{all:unset;box-sizing:border-box;cursor:pointer;width:26px;height:26px;border-radius:50%;background:var(--c);position:relative;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);transition:transform .15s cubic-bezier(.34,1.56,.64,1)}
.cpk-sw:hover{transform:scale(1.12)}
.cpk-sw:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cpk-sw[aria-checked=true]{box-shadow:0 0 0 2px var(--surface-1,#0b0e14),0 0 0 4px var(--c)}
.cpk-sw.auto{background:conic-gradient(#2dd4bf,#60a5fa,#a78bfa,#f472b6,#fb923c,#facc15,#4ade80,#2dd4bf)}
.cpk-sw.auto::after{content:"A";position:absolute;inset:0;display:grid;place-items:center;font:800 10px/1 system-ui;color:#0b0e14}
.cpk-box{position:relative;width:26px;height:26px;border-radius:8px;overflow:hidden;cursor:pointer;
  background:conic-gradient(red,#ff0,lime,cyan,blue,#f0f,red);box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}
.cpk-box input{position:absolute;inset:-6px;width:40px;height:40px;opacity:0;cursor:pointer;border:0;padding:0}
.cpk-box.on{box-shadow:0 0 0 2px var(--surface-1,#0b0e14),0 0 0 4px var(--c)}
.cpk-hex{width:92px;height:30px;box-sizing:border-box;padding:0 9px;border-radius:8px;border:1px solid var(--line);background:var(--surface-2);
  color:var(--fg);font:500 12.5px/1 var(--mono,monospace);outline:none}
.cpk-hex:focus{border-color:var(--accent)}
.cpk-hex.bad{border-color:var(--danger)}
`;

function normHex(v: string): string | null {
  const h = v.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) return '#' + [...h].map((c) => c + c).join('').toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(h)) return '#' + h.toLowerCase();
  return null;
}

export function colorPickHTML(id: string, value: string, opts: { auto?: boolean; presets?: readonly string[] } = {}): string {
  useStyles('cpk-css', CSS);
  const presets = opts.presets || AGENT_PALETTE;
  const v = normHex(value) || '';
  const custom = v && !presets.includes(v);
  return `<div class="cpk" id="${attr(id)}" role="radiogroup" data-value="${attr(v)}">
    ${opts.auto ? `<button type="button" class="cpk-sw auto" role="radio" data-v="" aria-checked="${!v}" title="Automatic (from the name)" aria-label="Automatic color"></button>` : ''}
    ${presets
      .map(
        (c) =>
          `<button type="button" class="cpk-sw" role="radio" data-v="${attr(c)}" style="--c:${attr(c)}" aria-checked="${c === v}" aria-label="${attr(c)}" title="${attr(c)}"></button>`,
      )
      .join('')}
    <label class="cpk-box${custom ? ' on' : ''}" style="--c:${esc(v || '#888888')}" title="Any color"><input type="color" value="${esc(v || '#2dd4bf')}" aria-label="Pick any color"></label>
    <input class="cpk-hex" type="text" value="${esc(v)}" placeholder="${opts.auto ? 'auto' : '#rrggbb'}" maxlength="7" aria-label="Hex color" spellcheck="false">
  </div>`;
}

/** `onChange` gets a lowercase "#rrggbb", or "" for automatic. */
export function wireColorPick(root: ParentNode, id: string, onChange?: (v: string) => void): () => string {
  const box = root.querySelector<HTMLElement>('#' + id)!;
  const hex = box.querySelector<HTMLInputElement>('.cpk-hex')!;
  const native = box.querySelector<HTMLInputElement>('input[type=color]')!;
  const free = box.querySelector<HTMLElement>('.cpk-box')!;
  const set = (v: string, fromHex = false): void => {
    box.dataset.value = v;
    let preset = false;
    box.querySelectorAll<HTMLElement>('.cpk-sw').forEach((s) => {
      const on = s.dataset.v === v;
      preset ||= on;
      s.setAttribute('aria-checked', String(on));
    });
    free.classList.toggle('on', !!v && !preset);
    free.style.setProperty('--c', v || '#888888');
    if (v) native.value = v;
    if (!fromHex) hex.value = v;
    hex.classList.remove('bad');
    onChange?.(v);
  };
  box.querySelectorAll<HTMLElement>('.cpk-sw').forEach((s) => (s.onclick = () => set(s.dataset.v || '')));
  native.oninput = () => set(native.value.toLowerCase());
  hex.oninput = () => {
    if (!hex.value.trim() && box.querySelector('.cpk-sw.auto')) return set('', true);
    const v = normHex(hex.value);
    if (v) set(v, true);
    else hex.classList.add('bad');
  };
  return () => box.dataset.value || '';
}
