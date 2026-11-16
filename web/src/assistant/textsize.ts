// Mnemo's text size, chosen per device: Auto (small on phones, medium elsewhere), Small, Medium or Large.
// Kept in this browser only; set as `data-mnfs` on <html>, which the chat's styles read as --mn-fs.

export type TextSize = 'auto' | 's' | 'm' | 'l';

export const TEXT_SIZES: { id: TextSize; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Auto: small on phones, medium elsewhere' },
  { id: 's', label: 'Small', hint: 'Small text: more fits on the screen' },
  { id: 'm', label: 'Medium', hint: 'Medium text' },
  { id: 'l', label: 'Large', hint: 'Large text: easier to read' },
];

const LS = 'memora.mnemo.fs.v1';
const listeners = new Set<() => void>();

export function readTextSize(): TextSize {
  try {
    const v = localStorage.getItem(LS);
    return TEXT_SIZES.some((t) => t.id === v) ? (v as TextSize) : 'auto';
  } catch {
    return 'auto';
  }
}

/** Put the saved size on the page (call once at start; Auto leaves the attribute off). */
export function applyTextSize(v: TextSize = readTextSize()): void {
  const r = document.documentElement;
  if (v === 'auto') delete r.dataset.mnfs;
  else r.dataset.mnfs = v;
}

export function setTextSize(v: TextSize): void {
  try {
    if (v === 'auto') localStorage.removeItem(LS);
    else localStorage.setItem(LS, v);
  } catch {
    /* lasts until reload */
  }
  applyTextSize(v);
  listeners.forEach((f) => f());
}

/** Run `f` whenever the size changes (each control keeps itself in step). */
export function onTextSize(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** A segmented control: Auto, then A in three sizes. */
export function textSizeHTML(name: string): string {
  const cur = readTextSize();
  return `<div class="mn-fs" role="radiogroup" aria-label="Text size">${TEXT_SIZES.map(
    (t) =>
      `<button type="button" role="radio" class="mn-fs-${t.id}${t.id === cur ? ' on' : ''}" data-fs="${t.id}" data-fs-group="${name}" aria-checked="${t.id === cur}" title="${t.hint}" aria-label="${t.hint}">${
        t.id === 'auto' ? 'Auto' : 'A'
      }</button>`,
  ).join('')}</div>`;
}

/** Wire every text size control inside `root`. */
export function wireTextSize(root: HTMLElement): void {
  const paint = (): void => {
    const cur = readTextSize();
    root.querySelectorAll<HTMLElement>('[data-fs]').forEach((b) => {
      const on = b.dataset.fs === cur;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  };
  root.querySelectorAll<HTMLElement>('[data-fs]').forEach((b) => {
    b.onclick = () => setTextSize(b.dataset.fs as TextSize);
  });
  const off = onTextSize(() => {
    if (!root.isConnected) return off();
    paint();
  });
  paint();
}

export const TEXT_SIZE_CSS = `
:root{--mn-fs:14.5px}
@media (max-width:640px){:root{--mn-fs:13px}}
:root[data-mnfs=s]{--mn-fs:13px}
:root[data-mnfs=m]{--mn-fs:14.5px}
:root[data-mnfs=l]{--mn-fs:16.5px}
.mn-fs{display:inline-flex;flex:none;gap:2px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--fg) 7%,transparent)}
.mn-fs button{display:grid;place-items:center;min-width:30px;height:28px;padding:0 6px;border:0;border-radius:8px;background:none;color:var(--muted);
  font:inherit;font-weight:650;line-height:1;cursor:pointer;transition:background .15s,color .15s}
.mn-fs button:hover{color:var(--fg)}
.mn-fs button.on{background:var(--surface-1,var(--panel));color:var(--fg);box-shadow:0 1px 2px rgba(15,23,42,.12)}
.mn-fs button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.mn-fs .mn-fs-auto{font-size:11.5px;font-weight:600}
.mn-fs .mn-fs-s{font-size:11px}.mn-fs .mn-fs-m{font-size:13.5px}.mn-fs .mn-fs-l{font-size:16.5px}
`;
