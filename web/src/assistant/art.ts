// Mnemo's HTML and SVG answers. In the chat each one is a file card; opening it shows the
// page in a panel: beside the chat on a wide Mnemo page (the chat makes room), full
// screen on tablets and phones. The page runs in a sandboxed frame that loads
// /preview-frame (scripts allowed, no same origin, no network), so whatever it does stays
// inside it and costs the server nothing.

import { esc } from '../dom';
import { icon } from '../ui/icons';

const FRAME = '/preview-frame';
/** Beside the chat from this width (and only on the Mnemo page); full screen below it. */
const SPLIT_MIN = 1024;

const SVG_PAGE =
  '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}body{display:grid;place-items:center;padding:16px;box-sizing:border-box}' +
  'svg{max-width:100%;max-height:100%;height:auto}</style>';

let panel: HTMLElement | null = null;
let current: HTMLElement | null = null;
let wired = false;

function source(card: HTMLElement): string {
  return card.querySelector('.mn-file-src')?.textContent ?? '';
}

function kindOf(card: HTMLElement): 'svg' | 'html' {
  return card.dataset.art === 'svg' ? 'svg' : 'html';
}

function page(card: HTMLElement): string {
  const src = source(card);
  return kindOf(card) === 'svg' ? SVG_PAGE + src : src;
}

/** The Mnemo page's own layout, when it is the page on screen. */
function mnemoPage(): HTMLElement | null {
  if (document.documentElement.dataset.page !== 'assistant') return null;
  const p = document.querySelector<HTMLElement>('.mnp');
  return p && p.getClientRects().length ? p : null;
}

function splitMode(): boolean {
  return window.innerWidth >= SPLIT_MIN && !!mnemoPage();
}

/** Place the panel: beside the chat (matching the Mnemo page's top and bottom) or full screen. */
function layout(): void {
  if (!panel) return;
  const split = splitMode();
  const root = document.documentElement;
  root.classList.toggle('mn-pv-split', split);
  root.classList.toggle('mn-pv-lock', !split);
  panel.classList.toggle('split', split);
  if (split) {
    const r = mnemoPage()!.getBoundingClientRect();
    panel.style.top = `${Math.max(0, r.top)}px`;
    panel.style.bottom = `${Math.max(0, window.innerHeight - r.bottom)}px`;
  } else {
    panel.style.top = '';
    panel.style.bottom = '';
  }
}

function wire(): void {
  if (wired) return;
  wired = true;
  window.addEventListener('message', (e) => {
    const f = panel?.querySelector<HTMLIFrameElement>('iframe');
    if (!f || !current || e.source !== f.contentWindow) return;
    const d = e.data as { mnFrameReady?: unknown } | null;
    // Ready (again after a reload): send the page each time; the frame writes it once.
    if (d && d.mnFrameReady) f.contentWindow?.postMessage({ mnHtml: page(current) }, '*');
  });
  document.addEventListener('click', onClick);
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && panel?.classList.contains('on')) {
        e.stopPropagation();
        closePreview();
        return;
      }
      const card = (e.target as HTMLElement | null)?.closest<HTMLElement>('.mn-file');
      if (card && (e.key === 'Enter' || e.key === ' ') && e.target === card) {
        e.preventDefault();
        openPreview(card);
      }
    },
    true,
  );
  window.addEventListener('resize', () => {
    if (panel?.classList.contains('on')) layout();
  });
  // Leaving the Mnemo page closes the panel.
  new MutationObserver(() => {
    if (panel?.classList.contains('on') && document.documentElement.dataset.page !== 'assistant') closePreview();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-page'] });
}

function build(): HTMLElement {
  const p = document.createElement('aside');
  p.className = 'mn-pv';
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', 'Preview');
  p.innerHTML =
    `<header class="mn-pv-h">` +
    `<span class="mn-pv-ic">${icon('code')}</span><div class="mn-pv-t"><b></b><small></small></div>` +
    `<div class="mn-pv-tabs" role="tablist" aria-label="Show">` +
    `<button type="button" role="tab" data-pv-view="preview" aria-selected="true">${icon('eye')}<span>Preview</span></button>` +
    `<button type="button" role="tab" data-pv-view="code" aria-selected="false">${icon('code')}<span>Code</span></button></div>` +
    `<div class="mn-pv-acts">` +
    `<button type="button" class="mn-pv-b" data-pv-copy title="Copy the code" aria-label="Copy the code">${icon('copy')}<span>Copy</span></button>` +
    `<button type="button" class="mn-pv-b" data-pv-dl title="Download the file" aria-label="Download the file">${icon('download')}<span>Download</span></button>` +
    `<button type="button" class="mn-pv-b mn-pv-x" data-pv-close title="Close (Esc)" aria-label="Close">${icon('close')}</button>` +
    `</div></header><div class="mn-pv-body"><div class="mn-pv-frame"></div><pre class="mn-pv-code"><code></code></pre></div>`;
  document.body.append(p);
  return p;
}

function setView(view: 'preview' | 'code'): void {
  if (!panel) return;
  panel.dataset.view = view;
  panel.querySelectorAll<HTMLElement>('[data-pv-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.pvView === view)));
}

/** Open a file card's page in the panel. */
export function openPreview(card: HTMLElement): void {
  wire();
  panel ??= build();
  current = card;
  document.querySelectorAll('.mn-file.on').forEach((c) => c.classList.remove('on'));
  card.classList.add('on');
  const kind = kindOf(card);
  panel.querySelector('.mn-pv-t b')!.textContent = card.dataset.title || 'Page';
  panel.querySelector('.mn-pv-t small')!.textContent = kind === 'svg' ? 'SVG' : 'HTML';
  panel.querySelector('.mn-pv-code code')!.innerHTML = esc(source(card));
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('title', `${card.dataset.title || 'Page'} preview`);
  panel.querySelector<HTMLElement>('.mn-pv-frame')!.replaceChildren(f);
  f.src = FRAME;
  setView('preview');
  layout();
  requestAnimationFrame(() => panel?.classList.add('on'));
}

export function closePreview(): void {
  if (!panel) return;
  panel.classList.remove('on');
  panel.querySelector('.mn-pv-frame')?.replaceChildren();
  document.documentElement.classList.remove('mn-pv-split', 'mn-pv-lock');
  current?.classList.remove('on');
  current = null;
}

/** Wire the file cards inside `root`; `auto` opens the last one beside the chat when there is room. */
export function mountArt(root: ParentNode, auto = false): void {
  const cards = root.querySelectorAll<HTMLElement>('.mn-file');
  if (!cards.length) return;
  wire();
  if (auto && splitMode()) openPreview(cards[cards.length - 1]);
}

function fileName(card: HTMLElement): string {
  const base =
    (card.dataset.title || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'mnemo-page';
  return `${base}.${kindOf(card)}`;
}

function download(card: HTMLElement): void {
  const type = kindOf(card) === 'svg' ? 'image/svg+xml' : 'text/html';
  const url = URL.createObjectURL(new Blob([source(card)], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(card);
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function flash(b: HTMLElement, text: string): void {
  const s = b.querySelector('span');
  if (!s) return;
  const was = s.textContent;
  s.textContent = text;
  window.setTimeout(() => (s.textContent = was), 1400);
}

function onClick(e: MouseEvent): void {
  const t = e.target as HTMLElement | null;
  if (!t) return;
  const card = t.closest<HTMLElement>('.mn-file');
  if (card) {
    if (t.closest('[data-file-dl]')) download(card);
    else openPreview(card);
    return;
  }
  if (!panel || !t.closest('.mn-pv')) return;
  const view = t.closest<HTMLElement>('[data-pv-view]');
  if (view) setView(view.dataset.pvView === 'code' ? 'code' : 'preview');
  else if (t.closest('[data-pv-close]')) closePreview();
  else if (t.closest('[data-pv-dl]') && current) download(current);
  else {
    const copy = t.closest<HTMLElement>('[data-pv-copy]');
    if (copy && current)
      void navigator.clipboard?.writeText(source(current)).then(
        () => flash(copy, 'Copied'),
        () => flash(copy, 'Could not copy'),
      );
  }
}

export const ART_CSS = `
.mn-file{display:flex;align-items:center;gap:12px;margin:.6em 0;padding:10px 10px 10px 12px;border:1px solid var(--line);border-radius:14px;
  background:var(--surface-1,var(--panel));cursor:pointer;transition:border-color .15s,box-shadow .15s,background .15s;max-width:520px}
.mn-file:hover{border-color:var(--line-strong);box-shadow:0 4px 14px -8px rgba(15,23,42,.25)}
.mn-file:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mn-file.on{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.mn-file-ic{display:grid;place-items:center;flex:none;width:38px;height:38px;border-radius:10px;background:var(--accent-soft);color:var(--accent)}
.mn-file-ic .i{width:18px;height:18px}
.mn-file-t{display:flex;flex-direction:column;min-width:0;flex:1;line-height:1.3}
.mn-file-t b{font-weight:650;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-file-t small{font-size:12px;color:var(--muted)}
.mn-file-a{display:flex;align-items:center;gap:4px;flex:none}
.mn-file-open{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:9px;background:var(--fg);color:var(--bg);font-size:13px;font-weight:600}
.mn-file-open .i{width:14px;height:14px}
.mn-file-dl{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:9px;background:none;color:var(--muted);cursor:pointer}
.mn-file-dl:hover{background:var(--hover);color:var(--fg)}
.mn-file-dl .i{width:16px;height:16px}

.mn-pv{position:fixed;z-index:300;display:flex;flex-direction:column;background:var(--surface-1,var(--panel));color:var(--fg);
  inset:0;opacity:0;pointer-events:none;transform:translateY(12px);transition:opacity .2s,transform .25s var(--ease-out,ease-out)}
.mn-pv.on{opacity:1;pointer-events:auto;transform:none}
.mn-pv.split{left:auto;right:0;width:clamp(380px,46vw,920px);border-left:1px solid var(--line);box-shadow:-12px 0 30px -18px rgba(15,23,42,.35);transform:translateX(24px)}
.mn-pv.split.on{transform:none}
:root.mn-pv-split .mnp{padding-right:clamp(380px,46vw,920px)}
.mnp{transition:padding-right .25s var(--ease-out,ease-out)}
:root.mn-pv-lock,:root.mn-pv-lock body{overflow:hidden}
.mn-pv-h{display:flex;align-items:center;gap:10px;padding:10px 12px;padding-top:max(10px,env(safe-area-inset-top));border-bottom:1px solid var(--line);flex:none}
.mn-pv-ic{display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:9px;background:var(--accent-soft);color:var(--accent)}
.mn-pv-ic .i{width:16px;height:16px}
.mn-pv-t{display:flex;flex-direction:column;min-width:0;flex:1;line-height:1.25}
.mn-pv-t b{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-pv-t small{font-size:11.5px;color:var(--muted);letter-spacing:.04em}
.mn-pv-tabs{display:inline-flex;gap:2px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--fg) 6%,transparent);flex:none}
.mn-pv-tabs button{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border:0;border-radius:8px;background:none;color:var(--muted);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.mn-pv-tabs button .i{width:14px;height:14px}
.mn-pv-tabs button[aria-selected=true]{background:var(--surface-1,var(--panel));color:var(--fg);box-shadow:0 1px 2px rgba(15,23,42,.12)}
.mn-pv-acts{display:flex;align-items:center;gap:2px;flex:none}
.mn-pv-b{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:0;border-radius:9px;background:none;color:var(--muted);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.mn-pv-b .i{width:15px;height:15px}
.mn-pv-b:hover{background:var(--hover);color:var(--fg)}
.mn-pv-x{width:34px;padding:0;justify-content:center;margin-left:4px}
.mn-pv-x .i{width:18px;height:18px}
.mn-pv-body{flex:1;min-height:0;position:relative}
.mn-pv-frame,.mn-pv-code{position:absolute;inset:0}
.mn-pv-frame iframe{display:block;width:100%;height:100%;border:0;background:#fff;color-scheme:light}
.mn-pv-code{margin:0;padding:14px 16px;overflow:auto;font:12.5px/1.6 var(--mono);background:color-mix(in srgb,var(--fg) 3%,var(--surface-1,var(--panel)));white-space:pre;tab-size:2}
.mn-pv[data-view=preview] .mn-pv-code,.mn-pv[data-view=code] .mn-pv-frame{display:none}
@media (max-width:760px){
  .mn-pv-h{flex-wrap:wrap;gap:8px}
  .mn-pv-t{flex-basis:calc(100% - 140px)}
  .mn-pv-tabs{order:3;flex:1 1 100%}
  .mn-pv-tabs button{flex:1;justify-content:center}
  .mn-pv-acts .mn-pv-b:not(.mn-pv-x) span{display:none}
  .mn-file-open span{display:none}
  .mn-file-open{padding:0 10px}
}
`;
