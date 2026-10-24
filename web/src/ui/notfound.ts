// Never redirects by itself: at boot it sits under the splash, so a countdown would run out unseen.

import { esc, useStyles } from '../dom';
import { icon } from './icons';
import { markSvg } from '../brand';
import { BRAND_FONT } from '../brand-font';
import { constellation } from '../views/welcome';
import type { RouteMissing } from '../router';

const CSS = `
.nf{position:fixed;inset:0;z-index:70;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);overflow:auto;animation:nf-in .25s ease}
@keyframes nf-in{from{opacity:0}}
.nf-bar{display:flex;align-items:center;gap:10px;padding:20px 28px;flex:none}
.nf-bar .nf-mk{width:30px;height:30px;flex:none}
.nf-bar b{font-family:${BRAND_FONT};font-weight:700;letter-spacing:0;font-size:24px;line-height:1}
.nf-wrap{flex:1;display:grid;place-items:center;padding:8px 16px 48px}
.nf-card{width:min(520px,100%);border:1px solid var(--line);border-radius:20px;background:var(--surface-1);overflow:hidden}
.nf-art{position:relative;height:200px;display:grid;place-items:center;overflow:hidden;isolation:isolate;margin:8px 8px 0;border-radius:14px;
  background:linear-gradient(165deg,#17202e 0%,#0b0f17 70%)}
.nf-art::before{content:"";position:absolute;inset:-30%;z-index:-1;background:radial-gradient(closest-side at 50% 55%,rgba(94,234,212,.2),transparent 70%)}
.nf-art .nf-net{position:absolute;inset:0;width:100%;height:100%;z-index:-1}
.nf-net line{stroke:rgba(94,234,212,.14);stroke-width:1}
.nf-net circle{fill:#5eead4;opacity:.5}
.nf-net circle:nth-child(4n+1){fill:#22d3ee;opacity:.85}
.nf-num{font-size:96px;font-weight:300;letter-spacing:-.05em;line-height:1;font-variant-numeric:tabular-nums;
  background:linear-gradient(180deg,#f2fdfb 10%,#5eead4 120%);-webkit-background-clip:text;background-clip:text;color:transparent}
.nf-ic{position:absolute;left:16px;top:16px;display:grid;place-items:center;width:36px;height:36px;border-radius:10px;
  background:rgba(255,255,255,.06);border:1px solid rgba(94,234,212,.22);color:#5eead4}
.nf-ic .i{width:18px;height:18px;stroke-width:1.7}
.nf-body{padding:26px 28px 28px}
.nf .nf-code{display:flex;align-items:center;gap:8px;margin:0;font-size:12.5px;font-weight:500;color:var(--muted)}
.nf .nf-code::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--warn)}
.nf h1{margin:8px 0 8px;font-size:26px;font-weight:650;letter-spacing:-.02em;outline:none}
.nf p.nf-t{margin:0;max-width:44ch;font-size:14.5px;line-height:1.6;color:var(--muted)}
.nf-path{display:flex;align-items:center;gap:10px;margin-top:18px;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--fg) 5%,transparent);min-width:0}
.nf-path span{font-size:12px;color:var(--text-3);flex:none}
.nf-path code{min-width:0;font:13px var(--mono,monospace);color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nf-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}
.nf-acts .btn{height:40px;border-radius:10px;padding:0 18px}
@media (max-width:760px){
  .nf-bar{padding:16px}
  .nf-wrap{place-items:start center;padding:4vh 12px 32px}
  .nf-art{height:168px}
  .nf-num{font-size:80px}
  .nf-body{padding:22px 20px 22px}
  .nf h1{font-size:22px}
  .nf-acts .btn{flex:1 1 140px;min-height:46px}
}
@media (prefers-reduced-motion:reduce){.nf{animation:none}}
`;

let open: HTMLElement | null = null;

export function closeNotFound(): void {
  if (!open) return;
  open.remove();
  open = null;
}

export function isNotFoundOpen(): boolean {
  return !!open;
}

export function showNotFound(miss: RouteMissing, home: () => void, back?: () => void): void {
  closeNotFound();
  useStyles('notfound-css', CSS);
  const node = miss.what === 'node';
  const el = document.createElement('div');
  el.className = 'nf';
  el.setAttribute('role', 'main');
  el.setAttribute('aria-labelledby', 'nf-title');
  el.innerHTML = `<div class="nf-bar">${markSvg('nf-mk')}<b>Memora</b></div>
    <div class="nf-wrap"><div class="nf-card">
    <div class="nf-art" aria-hidden="true">${constellation(520, 200, 26, 11, 'nf-net')}
      <span class="nf-ic">${icon(node ? 'note' : 'search')}</span><span class="nf-num">404</span></div>
    <div class="nf-body">
    <p class="nf-code">Error 404</p>
    <h1 id="nf-title" tabindex="-1">${node ? 'Note not found' : 'Page not found'}</h1>
    <p class="nf-t">${
      node
        ? 'It may have been renamed, moved or deleted. Deleted notes wait in the Trash.'
        : 'There is no page at this address.'
    }</p>
    <div class="nf-path"><span>${node ? 'Note' : 'Address'}</span><code title="${esc(miss.label)}">${esc(miss.label)}</code></div>
    <div class="nf-acts">
      <button type="button" class="btn primary" data-home>Go to Overview</button>
      ${back ? '<button type="button" class="btn" data-back>Back</button>' : ''}
    </div></div></div></div>`;
  document.body.appendChild(el);
  open = el;
  document.title = (node ? 'Note not found' : 'Page not found') + ' · Memora';
  el.querySelector<HTMLElement>('[data-home]')!.onclick = () => {
    closeNotFound();
    home();
  };
  const b = el.querySelector<HTMLElement>('[data-back]');
  if (b && back) {
    b.onclick = () => {
      closeNotFound();
      back();
    };
  }
  el.querySelector<HTMLElement>('[data-home]')!.focus({ preventScroll: true });
}
