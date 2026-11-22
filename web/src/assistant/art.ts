// Mnemo's HTML and SVG answers. In the chat each one is a file card; opening it shows the
// page in a panel: beside the chat on a wide Mnemo page (the chat makes room), full
// screen on tablets and phones. The page runs in a sandboxed frame that loads
// /preview-frame (scripts allowed, no same origin, no network), so whatever it does stays
// inside it and costs the server nothing.

import { esc } from '../dom';
import { icon } from '../ui/icons';
import { t } from '../i18n';

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
  const p = mnemoPage();
  // Beside the chat only when both fit (the chat list folds away meanwhile); else full screen.
  return window.innerWidth >= SPLIT_MIN && !!p && p.getBoundingClientRect().width >= CHAT_MIN + PANE_MIN;
}

// The split's width: dragged with the divider, kept per device, and always leaving room on
// both sides (the panel at least PANE_MIN, the chat at least CHAT_MIN, the panel at most 75%).
const LS_W = 'memora.mnemo.preview.w';
const PANE_MIN = 360;
const CHAT_MIN = 420;
/** The Mnemo chat list's width (it folds away while a page is open beside the chat). */
const LIST_W = 288;

function savedWidth(): number {
  try {
    return Number(localStorage.getItem(LS_W)) || 0;
  } catch {
    return 0;
  }
}

function fitWidth(w: number): number {
  const page = mnemoPage()?.getBoundingClientRect().width || window.innerWidth;
  const max = Math.max(PANE_MIN, Math.min(page - CHAT_MIN, page * 0.75));
  const want = w || Math.min(920, Math.max(380, window.innerWidth * 0.46));
  return Math.round(Math.min(max, Math.max(PANE_MIN, want)));
}

function setWidth(w: number, save = false): void {
  const fit = fitWidth(w);
  const root = document.documentElement;
  root.style.setProperty('--pvw', fit + 'px');
  // The chat list comes back only when the chat keeps its room beside it.
  const page = mnemoPage()?.getBoundingClientRect().width || window.innerWidth;
  root.classList.toggle('mn-pv-roomy', page - fit - LIST_W >= CHAT_MIN);
  panel?.querySelector('.mn-pv-grip')?.setAttribute('aria-valuenow', String(fit));
  if (save) {
    try {
      if (w) localStorage.setItem(LS_W, String(fit));
      else localStorage.removeItem(LS_W);
    } catch {
      /* lasts until reload */
    }
  }
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
    setWidth(savedWidth());
  } else {
    panel.style.top = '';
    panel.style.bottom = '';
  }
}

/** The divider between the chat and the panel: drag it, use the arrow keys, double-click to reset. */
function wireGrip(p: HTMLElement): void {
  const grip = p.querySelector<HTMLElement>('.mn-pv-grip')!;
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !p.classList.contains('split')) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    document.documentElement.classList.add('mn-pv-drag');
    const right = mnemoPage()?.getBoundingClientRect().right ?? window.innerWidth;
    const move = (ev: PointerEvent): void => setWidth(right - ev.clientX);
    const up = (ev: PointerEvent): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      document.documentElement.classList.remove('mn-pv-drag');
      setWidth(right - ev.clientX, true);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => setWidth(0, true));
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const now = p.getBoundingClientRect().width;
    setWidth(now + (e.key === 'ArrowLeft' ? 32 : -32), true);
  });
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
  p.setAttribute('aria-label', t('Preview'));
  p.innerHTML =
    `<header class="mn-pv-h">` +
    `<span class="mn-pv-ic">${icon('code')}</span><div class="mn-pv-t"><b></b><small></small></div>` +
    `<div class="mn-pv-vers" hidden></div>` +
    `<div class="mn-pv-tabs" role="tablist" aria-label="${t('Show')}">` +
    `<button type="button" role="tab" data-pv-view="preview" aria-selected="true">${icon('eye')}<span>${t('Preview')}</span></button>` +
    `<button type="button" role="tab" data-pv-view="code" aria-selected="false">${icon('code')}<span>${t('Code')}</span></button></div>` +
    `<div class="mn-pv-acts">` +
    `<button type="button" class="mn-pv-b" data-pv-copy title="${t('Copy the code')}" aria-label="${t('Copy the code')}">${icon('copy')}<span>${t('Copy')}</span></button>` +
    `<button type="button" class="mn-pv-b" data-pv-dl title="${t('Download the file')}" aria-label="${t('Download the file')}">${icon('download')}<span>${t('Download')}</span></button>` +
    `<button type="button" class="mn-pv-b mn-pv-x" data-pv-close title="${t('Close (Esc)')}" aria-label="${t('Close')}">${icon('close')}</button>` +
    `</div></header><div class="mn-pv-body"><div class="mn-pv-frame"></div><pre class="mn-pv-code"><code></code></pre></div>` +
    `<div class="mn-pv-grip" role="separator" aria-orientation="vertical" aria-label="${t('Resize the preview')}" aria-valuemin="${PANE_MIN}" tabindex="0" title="${t('Drag to resize · double-click to reset')}"></div>`;
  document.body.append(p);
  wireGrip(p);
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
  panel.querySelector('.mn-pv-t b')!.textContent = card.dataset.title || t('Page');
  panel.querySelector('.mn-pv-t small')!.textContent = kind === 'svg' ? 'SVG' : 'HTML';
  panel.querySelector('.mn-pv-code code')!.innerHTML = esc(source(card));
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('title', t('{name} preview', { name: card.dataset.title || t('Page') }));
  panel.querySelector<HTMLElement>('.mn-pv-frame')!.replaceChildren(f);
  f.src = FRAME;
  setView('preview');
  paintVersions(card);
  layout();
  requestAnimationFrame(() => panel?.classList.add('on'));
}

export function closePreview(): void {
  if (!panel) return;
  panel.classList.remove('on');
  panel.querySelector('.mn-pv-frame')?.replaceChildren();
  document.documentElement.classList.remove('mn-pv-split', 'mn-pv-lock', 'mn-pv-roomy');
  current?.classList.remove('on');
  current = null;
}

/** Wire the file cards inside `root`; `auto` opens the last one beside the chat when there is room. */
export function mountArt(root: ParentNode, auto = false): void {
  const cards = root.querySelectorAll<HTMLElement>('.mn-file');
  if (!cards.length) return;
  wire();
  const log = (root instanceof Element && root.closest('.mn-log')) || root;
  numberVersions(log);
  // A page Mnemo has just written (or rewritten) opens by itself where there is room, and
  // replaces what the panel shows when it is open anyway.
  if (auto && (splitMode() || panel?.classList.contains('on'))) openPreview(cards[cards.length - 1]);
}

// ---- versions: a page rewritten under the same title is a new version of the same file ----

function versionsOf(card: HTMLElement): HTMLElement[] {
  const log = card.closest('.mn-log') || document;
  return Array.from(log.querySelectorAll<HTMLElement>('.mn-file')).filter((c) => c.dataset.title === card.dataset.title && c.dataset.art === card.dataset.art);
}

function numberVersions(scope: ParentNode): void {
  const groups = new Map<string, HTMLElement[]>();
  scope.querySelectorAll<HTMLElement>('.mn-file').forEach((c) => {
    const k = `${c.dataset.art}\u0000${c.dataset.title}`;
    groups.set(k, [...(groups.get(k) || []), c]);
  });
  for (const list of groups.values()) {
    list.forEach((c, i) => {
      const last = i === list.length - 1;
      c.classList.toggle('old', list.length > 1 && !last);
      c.querySelector('.mn-file-v')?.remove();
      if (list.length < 2) return;
      const v = document.createElement('span');
      v.className = 'mn-file-v';
      v.textContent = last ? t('v{n} · latest', { n: i + 1 }) : `v${i + 1}`;
      c.querySelector('.mn-file-t b')?.after(v);
    });
  }
}

function paintVersions(card: HTMLElement): void {
  const box = panel?.querySelector<HTMLElement>('.mn-pv-vers');
  if (!box) return;
  const all = versionsOf(card);
  const i = all.indexOf(card);
  box.hidden = all.length < 2;
  if (all.length < 2) return;
  box.innerHTML =
    `<button type="button" data-pv-ver="-1" aria-label="${t('Earlier version')}" title="${t('Earlier version')}"${i <= 0 ? ' disabled' : ''}>${icon('chev')}</button>` +
    `<span>${t('v{n} of {total}', { n: i + 1, total: all.length })}</span>` +
    `<button type="button" data-pv-ver="1" aria-label="${t('Later version')}" title="${t('Later version')}"${i >= all.length - 1 ? ' disabled' : ''}>${icon('chev')}</button>`;
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
  const tg = e.target as HTMLElement | null;
  if (!tg) return;
  const card = tg.closest<HTMLElement>('.mn-file');
  if (card) {
    if (tg.closest('[data-file-dl]')) download(card);
    else openPreview(card);
    return;
  }
  if (!panel || !tg.closest('.mn-pv')) return;
  const ver = tg.closest<HTMLButtonElement>('[data-pv-ver]');
  if (ver && current) {
    const all = versionsOf(current);
    const next = all[all.indexOf(current) + Number(ver.dataset.pvVer)];
    if (next) {
      const view = panel.dataset.view === 'code' ? 'code' : 'preview';
      openPreview(next);
      setView(view);
    }
    return;
  }
  const view = tg.closest<HTMLElement>('[data-pv-view]');
  if (view) setView(view.dataset.pvView === 'code' ? 'code' : 'preview');
  else if (tg.closest('[data-pv-close]')) closePreview();
  else if (tg.closest('[data-pv-dl]') && current) download(current);
  else {
    const copy = tg.closest<HTMLElement>('[data-pv-copy]');
    if (copy && current)
      void navigator.clipboard?.writeText(source(current)).then(
        () => flash(copy, t('Copied')),
        () => flash(copy, t('Could not copy')),
      );
  }
}

export const ART_CSS = `
/* A page Mnemo wrote: a file card as wide as the reply, tinted so it stands out from text and
   tool cards; the title shortens with an ellipsis when it is long. */
.mn-file{position:relative;display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;margin:.7em 0;padding:12px 12px 12px 14px;
  border:1px solid color-mix(in srgb,var(--accent) 34%,var(--line));border-radius:16px;overflow:hidden;isolation:isolate;
  background:linear-gradient(115deg,color-mix(in srgb,var(--accent) 11%,var(--surface-1,var(--panel))),var(--surface-1,var(--panel)) 62%);
  cursor:pointer;transition:border-color .15s,box-shadow .2s,transform .2s}
.mn-file::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:linear-gradient(180deg,#14b8a6,#4f46e5);z-index:-1}
.mn-file:hover{border-color:color-mix(in srgb,var(--accent) 60%,var(--line));box-shadow:0 8px 22px -12px color-mix(in srgb,var(--accent) 60%,transparent);transform:translateY(-1px)}
.mn-file:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mn-file.on{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.mn-file-ic{display:grid;place-items:center;flex:none;width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#14b8a6,#4f46e5);color:#fff;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 4px 10px -4px rgba(79,70,229,.5)}
.mn-file-ic .i{width:19px;height:19px;stroke-width:2}
.mn-file-t{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;line-height:1.3}
.mn-file-t b{display:block;font-weight:650;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-file-t small{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-file-a{display:flex;align-items:center;gap:4px;flex:none}
.mn-file-open{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border-radius:10px;background:var(--accent);color:var(--accent-fg,#fff);
  font-size:13px;font-weight:650;box-shadow:0 4px 12px -6px color-mix(in srgb,var(--accent) 80%,transparent);transition:filter .15s}
.mn-file:hover .mn-file-open{filter:brightness(1.06)}
.mn-file-open .i{width:15px;height:15px}
@media (prefers-reduced-motion:reduce){.mn-file,.mn-file:hover{transition:none;transform:none}}
.mn-file-v{align-self:flex-start;margin:1px 0 1px;padding:1px 7px;border-radius:99px;font-size:10.5px;font-weight:700;letter-spacing:.02em;
  background:var(--accent);color:var(--accent-fg,#fff)}
.mn-file.old{background:var(--surface-1,var(--panel));border-color:var(--line);opacity:.78}
.mn-file.old::before{background:var(--line-strong)}
.mn-file.old .mn-file-ic{background:var(--accent-soft);color:var(--accent);box-shadow:none}
.mn-file.old .mn-file-v{background:color-mix(in srgb,var(--fg) 10%,transparent);color:var(--muted)}
.mn-file.old .mn-file-open{background:none;color:var(--fg);border:1px solid var(--line-strong);box-shadow:none}
.mn-file.old:hover{opacity:1}
.mn-pv-vers{display:inline-flex;align-items:center;gap:2px;flex:none;padding:2px;border-radius:10px;border:1px solid var(--line)}
.mn-pv-vers[hidden]{display:none}
.mn-pv-vers span{padding:0 6px;font-size:12px;font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap}
.mn-pv-vers button{display:grid;place-items:center;width:26px;height:26px;border:0;border-radius:8px;background:none;color:var(--fg);cursor:pointer}
.mn-pv-vers button:first-child .i{transform:rotate(180deg)}
.mn-pv-vers button:hover:not(:disabled){background:var(--hover)}
.mn-pv-vers button:disabled{opacity:.35;cursor:default}
.mn-pv-vers .i{width:14px;height:14px}
.mn-file-dl{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:9px;background:none;color:var(--muted);cursor:pointer}
.mn-file-dl:hover{background:var(--hover);color:var(--fg)}
.mn-file-dl .i{width:16px;height:16px}

.mn-pv{position:fixed;z-index:300;display:flex;flex-direction:column;background:var(--surface-1,var(--panel));color:var(--fg);
  inset:0;opacity:0;pointer-events:none;transform:translateY(12px);transition:opacity .2s,transform .25s var(--ease-out,ease-out)}
.mn-pv.on{opacity:1;pointer-events:auto;transform:none}
.mn-pv.split{left:auto;right:0;width:var(--pvw,clamp(380px,46vw,920px));border-left:1px solid var(--line);box-shadow:-12px 0 30px -18px rgba(15,23,42,.35);transform:translateX(24px)}
.mn-pv.split.on{transform:none}
:root.mn-pv-split .mnp{padding-right:var(--pvw,clamp(380px,46vw,920px))}
.mn-pv-grip{display:none}
.mn-pv.split .mn-pv-grip{display:block;position:absolute;left:-6px;top:0;bottom:0;width:12px;z-index:5;cursor:col-resize;touch-action:none;outline:none}
.mn-pv.split .mn-pv-grip::after{content:"";position:absolute;left:50%;top:50%;width:4px;height:44px;translate:-50% -50%;border-radius:99px;background:var(--line-strong);opacity:0;transition:opacity .15s,background .15s,height .15s}
.mn-pv.split:hover .mn-pv-grip::after{opacity:1}
.mn-pv.split .mn-pv-grip:hover::after,.mn-pv.split .mn-pv-grip:focus-visible::after,:root.mn-pv-drag .mn-pv-grip::after{opacity:1;height:64px;background:var(--accent)}
:root.mn-pv-drag,:root.mn-pv-drag *{cursor:col-resize!important;user-select:none}
:root.mn-pv-drag .mn-pv iframe{pointer-events:none}
:root.mn-pv-drag .mnp,:root.mn-pv-drag .mn-pv{transition:none!important}
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
  .mn-file-open{width:36px;padding:0;justify-content:center}
  .mn-file{gap:10px;padding:10px 8px 10px 12px}
  .mn-file-ic{width:38px;height:38px}
}
`;
