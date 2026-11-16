// Mnemo's HTML and SVG answers: a live preview in a sandboxed frame, with Code, Download
// and Full screen. The frame loads /preview-frame (scripts allowed, no same origin, no
// network), so whatever the page does stays inside it and costs the server nothing.

const FRAME = '/preview-frame';
const MIN_H = 160;
const MAX_H = 720;

/** Reports the page's height to the chat so the frame fits it (added after the page). */
const SIZER =
  '<script>(function(){var l=0;function p(){var d=document.documentElement,b=document.body;' +
  'var h=Math.ceil(Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0));if(Math.abs(h-l)>2){l=h;parent.postMessage({mnFrameH:h},"*")}}' +
  'addEventListener("load",p);if(window.ResizeObserver&&document.body)new ResizeObserver(p).observe(document.body);' +
  'setTimeout(p,60);setTimeout(p,700);setTimeout(p,2000)})()</script>';

const SVG_PAGE =
  '<!doctype html><meta charset="utf-8"><style>html,body{margin:0}body{display:grid;place-items:center;padding:12px}' +
  'svg{max-width:100%;height:auto}</style>';

/** The preview frame a message came from (frames may be made before they are on the page). */
function frameOf(w: MessageEventSource | null): HTMLIFrameElement | undefined {
  if (!w) return undefined;
  for (const f of document.querySelectorAll<HTMLIFrameElement>('.mn-art-v iframe')) if (f.contentWindow === w) return f;
  return undefined;
}

function source(box: HTMLElement): string {
  return box.querySelector('pre')?.textContent ?? '';
}

function page(box: HTMLElement): string {
  const src = source(box);
  return (box.dataset.art === 'svg' ? SVG_PAGE + src : src) + SIZER;
}

let wired = false;

function wire(): void {
  if (wired) return;
  wired = true;
  window.addEventListener('message', (e) => {
    const f = frameOf(e.source);
    if (!f) return;
    const d = e.data as { mnFrameH?: unknown; mnFrameReady?: unknown } | null;
    // Ready again after a reload (moving the frame reloads it): send the page each time.
    if (d && d.mnFrameReady) {
      const box = f.closest<HTMLElement>('.mn-art');
      if (box) f.contentWindow?.postMessage({ mnHtml: page(box) }, '*');
      return;
    }
    if (d && typeof d.mnFrameH === 'number' && Number.isFinite(d.mnFrameH)) {
      f.style.height = `${Math.round(Math.min(MAX_H, Math.max(MIN_H, d.mnFrameH)))}px`;
    }
  });
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const full = document.querySelector<HTMLElement>('.mn-art.full');
    if (full) {
      e.stopPropagation();
      setFull(full, false);
    }
  }, true);
}

/** Give every finished HTML block inside `root` its preview frame. */
export function mountArt(root: ParentNode): void {
  const boxes = root.querySelectorAll<HTMLElement>('.mn-art:not([data-on])');
  if (!boxes.length) return;
  wire();
  boxes.forEach((box) => {
    box.dataset.on = '1';
    const v = box.querySelector<HTMLElement>('.mn-art-v');
    if (!v) return;
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('title', box.dataset.art === 'svg' ? 'SVG preview' : 'HTML preview');
    f.loading = 'lazy';
    f.style.height = `${MIN_H + 80}px`;
    v.append(f);
    f.src = FRAME;
  });
}

function setView(box: HTMLElement, view: 'preview' | 'code'): void {
  box.dataset.view = view;
  box.querySelectorAll<HTMLElement>('[data-art-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.artView === view)));
}

const homes = new WeakMap<HTMLElement, Comment>();

/** Full screen lifts the block to <body> (the chat's masks and frosted cards would clip it) and back. */
function setFull(box: HTMLElement, on: boolean): void {
  if (on && !homes.has(box)) {
    const mark = document.createComment('mn-art');
    box.before(mark);
    homes.set(box, mark);
    const wrap = document.createElement('div');
    wrap.className = 'mn-md mn-art-host';
    document.body.append(wrap);
    wrap.append(box);
  } else if (!on) {
    const mark = homes.get(box);
    const host = box.parentElement;
    if (mark?.isConnected) mark.replaceWith(box);
    homes.delete(box);
    if (host?.classList.contains('mn-art-host')) host.remove();
  }
  box.classList.toggle('full', on);
  document.documentElement.classList.toggle('mn-art-lock', on);
  const b = box.querySelector<HTMLElement>('[data-art-full]');
  if (b) {
    const label = on ? 'Exit full screen' : 'Full screen';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.classList.toggle('on', on);
  }
}

function fileName(box: HTMLElement): string {
  const kind = box.dataset.art === 'svg' ? 'svg' : 'html';
  const t = /<title>([^<]{1,80})<\/title>/i.exec(source(box))?.[1] ?? '';
  const base = t.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mnemo-visual';
  return `${base}.${kind}`;
}

function download(box: HTMLElement): void {
  const kind = box.dataset.art === 'svg' ? 'image/svg+xml' : 'text/html';
  const url = URL.createObjectURL(new Blob([source(box)], { type: `${kind};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(box);
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function onClick(e: MouseEvent): void {
  const t = e.target as HTMLElement | null;
  const box = t?.closest<HTMLElement>('.mn-art');
  if (!t || !box) return;
  const view = t.closest<HTMLElement>('[data-art-view]');
  if (view) {
    setView(box, view.dataset.artView === 'code' ? 'code' : 'preview');
    return;
  }
  if (t.closest('[data-art-dl]')) {
    download(box);
    return;
  }
  if (t.closest('[data-art-full]')) setFull(box, !box.classList.contains('full'));
}

export const ART_CSS = `
.mn-md .mn-art{position:relative}
.mn-md .mn-art .dc-code-bar{gap:6px;padding:4px 6px}
.mn-art-tabs{display:inline-flex;gap:2px;padding:2px;border-radius:9px;background:color-mix(in srgb,var(--fg) 6%,transparent)}
.mn-art-tabs button{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border:0;border-radius:7px;background:none;color:var(--muted);font:inherit;font-weight:600;cursor:pointer}
.mn-art-tabs button .i{width:13px;height:13px}
.mn-art-tabs button:hover{color:var(--fg)}
.mn-art-tabs button[aria-selected=true]{background:var(--surface-1,var(--panel));color:var(--fg);box-shadow:0 1px 2px rgba(15,23,42,.12)}
.mn-art-k{font-size:11px;letter-spacing:.04em;color:var(--muted)}
.mn-art-sp{flex:1}
.mn-art-b{display:grid;place-items:center;width:26px;height:26px;border:0;border-radius:7px;background:none;color:var(--muted);cursor:pointer}
.mn-art-b .i{width:14px;height:14px}
.mn-art-b:hover,.mn-art-b.on{background:var(--hover);color:var(--fg)}
.mn-art-v iframe{display:block;width:100%;border:0;background:#fff;color-scheme:light;transition:height .2s ease}
.mn-art[data-view=preview] pre{display:none}
.mn-art[data-view=code] .mn-art-v{display:none}
.mn-md .mn-art[data-view=code] pre{max-height:460px;overflow:auto}
.mn-art.full{position:fixed;inset:max(12px,env(safe-area-inset-top)) 12px 12px;z-index:400;margin:0!important;display:flex;flex-direction:column;
  box-shadow:0 0 0 100vmax rgba(10,14,22,.55),0 24px 60px rgba(0,0,0,.35)}
.mn-art.full .mn-art-v{flex:1;min-height:0}
.mn-art.full .mn-art-v iframe{height:100%!important}
.mn-md .mn-art.full pre{flex:1;max-height:none}
html.mn-art-lock,html.mn-art-lock body{overflow:hidden}
@media (max-width:640px){.mn-art-tabs button span{display:none}.mn-art-tabs button{padding:0 8px}.mn-art.full{inset:8px}}
`;
