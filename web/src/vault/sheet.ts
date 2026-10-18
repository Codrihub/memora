// Mobile node sheet: a bottom sheet (~58% of the viewport) with a quick
// preview that scrolls inside; drag up (or the expand button) for a full
// screen reader. Wikilinks (out) and backlinks (in) are chips; tapping one
// opens that node in the same sheet with a back stack. Close with X, a swipe
// down, Esc or the browser back button; the page underneath is untouched, so
// its scroll position is kept.

import { apiGet } from '../api';
import { attr, el, esc, useStyles } from '../dom';
import { noteName, relTs, wikilinks } from '../format';
import { allNotes } from '../state';
import type { NoteDoc } from '../types';
import { I } from './icons';
import { dirOf, folderColor } from './store';

interface SheetNote extends NoteDoc {
  backlinks?: { path: string; name: string }[];
}

type Mode = 'peek' | 'full';

const s = {
  root: null as HTMLElement | null,
  sheet: null as HTMLElement | null,
  body: null as HTMLElement | null,
  stack: [] as { path: string; scroll: number }[],
  mode: 'peek' as Mode,
  /** History entries this sheet pushed and has not consumed yet. */
  pushed: 0,
  closing: false,
  prevOverflow: '',
  onEdit: null as ((path: string) => void) | null,
};

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Only paths present in the loaded tree are ever fetched. */
function exists(path: string): boolean {
  return allNotes().some((n) => n.path === path);
}

/** Called by the vault view so "Edit" can open the full editor. */
export function setSheetEditor(fn: (path: string) => void): void {
  s.onEdit = fn;
}

export function sheetOpen(): boolean {
  return !!s.root;
}

export function openNodeSheet(path: string): void {
  useStyles('vx-sheet-styles', SHEET_CSS);
  if (!s.root) build();
  if (s.stack.length && s.body) s.stack[s.stack.length - 1].scroll = s.body.scrollTop;
  if (s.stack.length && s.stack[s.stack.length - 1].path === path) return;
  s.stack.push({ path, scroll: 0 });
  try {
    history.pushState({ vxSheet: s.stack.length }, '');
    s.pushed++;
  } catch {
    /* sandboxed iframes */
  }
  void load(path, 0);
}

function build(): void {
  const root = el('div', 'vxs-root');
  root.innerHTML = `<div class="vxs-backdrop"></div>
    <div class="vxs-sheet" role="dialog" aria-modal="true" aria-label="Node preview">
      <div class="vxs-grab"><span class="vxs-handle" aria-hidden="true"></span>
        <div class="vxs-bar">
          <button class="vxs-btn" data-back aria-label="Back to the previous node" hidden>${I.back}</button>
          <div class="vxs-title"><b></b><small></small></div>
          <button class="vxs-btn" data-edit aria-label="Edit node">${I.edit}</button>
          <button class="vxs-btn" data-expand aria-label="Expand to full screen">${I.caret}</button>
          <button class="vxs-btn" data-close aria-label="Close">${I.close}</button>
        </div></div>
      <div class="vxs-body" tabindex="-1"></div>
    </div>`;
  document.body.appendChild(root);
  s.root = root;
  s.sheet = root.querySelector<HTMLElement>('.vxs-sheet');
  s.body = root.querySelector<HTMLElement>('.vxs-body');
  s.mode = 'peek';
  s.prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  setMode('peek', true);
  requestAnimationFrame(() => root.classList.add('in'));

  root.querySelector<HTMLElement>('.vxs-backdrop')!.onclick = () => close();
  root.querySelector<HTMLElement>('[data-close]')!.onclick = () => close();
  root.querySelector<HTMLElement>('[data-back]')!.onclick = () => back();
  root.querySelector<HTMLElement>('[data-expand]')!.onclick = () => setMode(s.mode === 'peek' ? 'full' : 'peek');
  root.querySelector<HTMLElement>('[data-edit]')!.onclick = () => {
    const cur = s.stack[s.stack.length - 1];
    if (!cur || !exists(cur.path)) return;
    const p = cur.path;
    close();
    s.onEdit?.(p);
  };
  wireGestures();
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('popstate', onPop);
  s.sheet?.focus();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && s.root) {
    e.preventDefault();
    e.stopPropagation();
    close();
  }
}

function onPop(): void {
  if (!s.root) return;
  if (s.closing) {
    teardown();
    return;
  }
  // Browser back: one node back, or close on the first one.
  s.pushed = Math.max(0, s.pushed - 1);
  if (s.stack.length > 1) {
    s.stack.pop();
    const cur = s.stack[s.stack.length - 1];
    void load(cur.path, cur.scroll);
  } else {
    s.stack = [];
    teardown();
  }
}

function back(): void {
  if (s.stack.length <= 1) {
    close();
    return;
  }
  // Consume our own history entry; onPop does the work.
  if (s.pushed > 0) history.back();
  else onPop();
}

export function close(): void {
  if (!s.root || s.closing) return;
  if (s.pushed > 0) {
    s.closing = true;
    const n = s.pushed;
    s.pushed = 0;
    history.go(-n);
    // Fallback when no popstate arrives (e.g. history was replaced meanwhile).
    setTimeout(() => s.root && s.closing && teardown(), 400);
  } else teardown();
}

function teardown(): void {
  const root = s.root;
  if (!root) return;
  s.root = null;
  s.closing = false;
  s.stack = [];
  s.pushed = 0;
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('popstate', onPop);
  document.body.style.overflow = s.prevOverflow;
  root.classList.remove('in');
  if (s.sheet) s.sheet.style.transform = '';
  setTimeout(() => root.remove(), reduced() ? 0 : 280);
}

function setMode(m: Mode, instant = false): void {
  s.mode = m;
  const sh = s.sheet;
  if (!sh || !s.root) return;
  s.root.dataset.mode = m;
  sh.style.transition = instant || reduced() ? 'none' : '';
  sh.style.transform = '';
  const exp = s.root.querySelector<HTMLElement>('[data-expand]');
  if (exp) exp.setAttribute('aria-label', m === 'peek' ? 'Expand to full screen' : 'Back to preview size');
}

/** Drag the handle/header (or the body when scrolled to the top). */
function wireGestures(): void {
  const sh = s.sheet!;
  const body = s.body!;
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let vy = 0;
  let dragging = false;
  let raf = 0;
  let dy = 0;
  const peekOffset = (): number => sh.offsetHeight * 0.42; // peek shows ~58%
  const base = (): number => (s.mode === 'peek' ? peekOffset() : 0);

  const start = (y: number): void => {
    startY = lastY = y;
    lastT = performance.now();
    vy = 0;
    dy = 0;
    dragging = true;
    sh.style.transition = 'none';
  };
  const move = (y: number): void => {
    const now = performance.now();
    vy = (y - lastY) / Math.max(1, now - lastT);
    lastY = y;
    lastT = now;
    dy = y - startY;
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        const t = Math.max(0, base() + dy);
        sh.style.transform = `translate3d(0,${t}px,0)`;
      });
    }
  };
  const end = (): void => {
    if (!dragging) return;
    dragging = false;
    cancelAnimationFrame(raf);
    raf = 0;
    sh.style.transition = '';
    const pos = base() + dy;
    const h = sh.offsetHeight;
    const peek = peekOffset();
    if (vy > 0.5) {
      if (s.mode === 'full' && base() === 0 && pos < peek * 1.3) setMode('peek');
      else close();
    } else if (vy < -0.5 || pos < peek * 0.5) setMode('full');
    else if (pos > peek + (h - peek) * 0.35) close();
    else setMode('peek');
  };

  const grab = s.root!.querySelector<HTMLElement>('.vxs-grab')!;
  grab.addEventListener(
    'touchstart',
    (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      start(e.touches[0].clientY);
    },
    { passive: true },
  );
  // The body drags the sheet only while scrolled to the very top and pulled down,
  // or in peek mode when pushed up (expands instead of scrolling).
  let bodyIntent: 'none' | 'sheet' | 'scroll' = 'none';
  let by0 = 0;
  body.addEventListener(
    'touchstart',
    (e) => {
      bodyIntent = 'none';
      by0 = e.touches[0].clientY;
    },
    { passive: true },
  );
  body.addEventListener(
    'touchmove',
    (e) => {
      const y = e.touches[0].clientY;
      if (bodyIntent === 'none') {
        const pull = y - by0;
        if (Math.abs(pull) < 6) return;
        bodyIntent =
          (pull > 0 && body.scrollTop <= 0) || (pull < 0 && s.mode === 'peek') ? 'sheet' : 'scroll';
        if (bodyIntent === 'sheet') start(by0);
      }
      if (bodyIntent === 'sheet') {
        e.preventDefault();
        move(y);
      }
    },
    { passive: false },
  );
  body.addEventListener('touchend', () => {
    if (bodyIntent === 'sheet') end();
    bodyIntent = 'none';
  });
  grab.addEventListener('touchmove', (e) => dragging && move(e.touches[0].clientY), { passive: true });
  grab.addEventListener('touchend', end);
  grab.addEventListener('touchcancel', end);
  // Mouse / pen on the handle (desktop testing, tablets with a pen).
  grab.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || (e.target as HTMLElement).closest('button')) return;
    start(e.clientY);
    grab.setPointerCapture(e.pointerId);
  });
  grab.addEventListener('pointermove', (e) => e.pointerType !== 'touch' && dragging && move(e.clientY));
  grab.addEventListener('pointerup', (e) => e.pointerType !== 'touch' && end());
  grab.addEventListener('pointercancel', (e) => e.pointerType !== 'touch' && end());
}

async function load(path: string, scroll: number): Promise<void> {
  const root = s.root;
  const body = s.body;
  if (!root || !body) return;
  root.querySelector<HTMLElement>('[data-back]')!.hidden = s.stack.length <= 1;
  const title = root.querySelector<HTMLElement>('.vxs-title')!;
  title.querySelector('b')!.textContent = noteName(path);
  title.querySelector('small')!.textContent = dirOf(path) || 'Vault';
  root.style.setProperty('--fc', folderColor(dirOf(path)));
  if (!exists(path)) {
    body.innerHTML = notFound(path);
    root.querySelector<HTMLElement>('[data-edit]')!.hidden = true;
    return;
  }
  root.querySelector<HTMLElement>('[data-edit]')!.hidden = false;
  body.innerHTML = `<div class="vxs-skel"><i></i><i></i><i></i></div>`;
  let d: SheetNote;
  try {
    d = await apiGet<SheetNote>('/api/note?path=' + encodeURIComponent(path));
  } catch (e) {
    if (s.root !== root || s.stack[s.stack.length - 1]?.path !== path) return;
    body.innerHTML = `<div class="vxs-empty">${I.warn}<p>Could not load this node.<br><small>${esc((e as Error).message)}</small></p></div>`;
    return;
  }
  if (s.root !== root || s.stack[s.stack.length - 1]?.path !== path) return;
  const outs = wikilinks(d.content)
    .map((name) => ({ name, hit: allNotes().find((n) => n.name.toLowerCase() === name.toLowerCase()) }))
    .filter((x, i, a) => a.findIndex((y) => y.name === x.name) === i);
  const ins = (d.backlinks || []).filter((b) => exists(b.path));
  const chip = (path: string | null, name: string, dirn: string): string =>
    path
      ? `<button class="vxs-chip" data-open="${attr(path)}" style="--fc:${attr(folderColor(dirOf(path)))}">${dirn}${esc(name)}</button>`
      : `<span class="vxs-chip off" title="Not created yet">${dirn}${esc(name)}</span>`;
  const links = `<div class="vxs-links">
      <h4>Links out <span>${outs.length}</span></h4>
      <div class="vxs-chips">${outs.map((o) => chip(o.hit ? o.hit.path : null, o.name, '→ ')).join('') || '<em>None</em>'}</div>
      <h4>Backlinks <span>${ins.length}</span></h4>
      <div class="vxs-chips">${ins.map((b) => chip(b.path, b.name, '← ')).join('') || '<em>None</em>'}</div>
    </div>`;
  body.innerHTML = `${links}<div class="vxs-meta">Edited ${esc(relTs(d.mtime))}${
    d.tags && d.tags.length ? ' · ' + d.tags.map((t) => '#' + esc(t)).join(' ') : ''
  }</div><article class="vx-prose note-body vxs-prose">${d.html || `<pre>${esc(d.content || '')}</pre>`}</article>`;
  const h1 = body.querySelector('.vxs-prose')?.firstElementChild;
  if (h1 && h1.tagName === 'H1' && h1.textContent?.trim().toLowerCase() === noteName(path).toLowerCase()) h1.remove();
  body.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => (b.onclick = () => openNodeSheet(b.dataset.open || '')));
  body.querySelectorAll<HTMLElement>('a.wl[data-path]').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      const p = a.dataset.path || '';
      if (exists(p)) openNodeSheet(p);
    };
  });
  body.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((x) => (x.disabled = true));
  body.scrollTop = scroll;
}

function notFound(path: string): string {
  return `<div class="vxs-empty">${I.note}<p><b>Node not found</b><br><small>“${esc(
    noteName(path),
  )}” is not in this vault. It may have been moved, renamed or deleted.</small></p></div>`;
}

const SHEET_CSS = `
.vxs-root{position:fixed;inset:0;z-index:150;pointer-events:none}
.vxs-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45);opacity:0;transition:opacity .28s;pointer-events:auto}
.vxs-root.in .vxs-backdrop{opacity:1}
.vxs-root[data-mode=full] .vxs-backdrop{opacity:1}
.vxs-sheet{position:absolute;left:0;right:0;bottom:0;height:100dvh;max-height:100dvh;display:flex;flex-direction:column;pointer-events:auto;
  background:var(--panel);border-radius:18px 18px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.35);outline:none;
  transform:translate3d(0,100%,0);transition:transform .3s cubic-bezier(.2,.8,.2,1),border-radius .3s;will-change:transform;
  padding-top:0;--peek:42%}
.vxs-root.in[data-mode=peek] .vxs-sheet{transform:translate3d(0,var(--peek),0)}
.vxs-root.in[data-mode=full] .vxs-sheet{transform:translate3d(0,0,0);border-radius:0;padding-top:env(safe-area-inset-top)}
.vxs-grab{flex:none;touch-action:none;cursor:grab;border-bottom:1px solid var(--line)}
.vxs-handle{display:block;width:40px;height:5px;border-radius:3px;background:var(--line);margin:8px auto 2px}
.vxs-bar{display:flex;align-items:center;gap:4px;padding:2px 8px 8px}
.vxs-title{flex:1;min-width:0;display:flex;flex-direction:column;padding:0 4px}
.vxs-title b{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vxs-title small{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vxs-title small::before{content:"";display:inline-block;width:7px;height:7px;border-radius:2px;background:var(--fc);margin-right:6px}
.vxs-btn{width:40px;height:40px;display:grid;place-items:center;border:0;background:none;color:var(--muted);border-radius:10px;flex:none}
.vxs-btn:active{background:var(--panel-2)}
.vxs-btn .vx-i{width:19px;height:19px}
.vxs-btn[data-expand] .vx-i{transform:rotate(-90deg);transition:transform .25s}
.vxs-root[data-mode=full] .vxs-btn[data-expand] .vx-i{transform:rotate(90deg)}
.vxs-body{flex:1;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:12px 18px calc(42dvh + 24px + env(safe-area-inset-bottom))}
.vxs-root[data-mode=full] .vxs-body{padding-bottom:calc(32px + env(safe-area-inset-bottom))}
.vxs-links h4{display:flex;align-items:center;gap:6px;margin:6px 0 6px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.vxs-links h4 span{background:var(--panel-2);border-radius:10px;padding:0 6px;letter-spacing:0}
.vxs-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:4px;scrollbar-width:none}
.vxs-chips em{font-size:12px;color:var(--muted)}
.vxs-chip{flex:none;border:1px solid var(--line);border-left:3px solid var(--fc,var(--line));background:var(--bg);color:var(--fg);
  font:inherit;font-size:13px;padding:7px 12px;border-radius:10px;min-height:36px;white-space:nowrap}
.vxs-chip.off{color:var(--muted);border-style:dashed}
.vxs-meta{font-size:12px;color:var(--muted);margin:10px 0 0;padding-top:10px;border-top:1px solid var(--line)}
.vxs-prose{margin-top:8px;font-size:16px}
.vxs-empty{text-align:center;color:var(--muted);padding:40px 10px}
.vxs-empty .vx-i{width:34px;height:34px;opacity:.6}
.vxs-empty b{color:var(--fg);font-size:16px}
.vxs-skel{display:flex;flex-direction:column;gap:12px;padding-top:10px}
.vxs-skel i{height:14px;border-radius:7px;background:var(--panel-2)}
.vxs-skel i:nth-child(1){width:70%}.vxs-skel i:nth-child(3){width:50%}
@media (prefers-reduced-motion: reduce){.vxs-sheet,.vxs-backdrop,.vxs-btn .vx-i{transition:none!important}}
`;
