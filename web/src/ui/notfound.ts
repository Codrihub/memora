// "Page not found": a page address or a node link that leads nowhere. Says
// what was asked for and stays until the user picks a way out: Back (when
// there is an earlier page in the app to go back to) or Go to Overview. It
// never moves on by itself: at boot it sits under the splash animation, so a
// countdown would run out unseen and look like a silent redirect. Any other
// navigation closes it.

import { esc, useStyles } from '../dom';
import type { RouteMissing } from '../router';

const CSS = `
.nf{position:fixed;inset:0;z-index:70;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);
  overflow:auto;animation:nf-in .25s ease}
@keyframes nf-in{from{opacity:0}}
.nf-card{width:min(440px,100%);text-align:center}
.nf-code{font-size:64px;font-weight:800;letter-spacing:-.04em;line-height:1;color:var(--accent)}
.nf h1{margin:14px 0 8px;font-size:22px;letter-spacing:-.01em;outline:none}
.nf p{margin:0 auto;max-width:36ch;font-size:14px;line-height:1.6;color:var(--muted)}
.nf code{display:inline-block;max-width:100%;margin-top:12px;padding:4px 10px;border-radius:8px;border:1px solid var(--line);background:var(--surface-2);
  font:12.5px var(--mono,monospace);color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}
.nf-acts{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:24px}
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

/**
 * Show the not-found page for a missing page or node. `home` takes the user
 * to Overview; `back`, when given, goes back to the previous page in the app.
 */
export function showNotFound(miss: RouteMissing, home: () => void, back?: () => void): void {
  closeNotFound();
  useStyles('notfound-css', CSS);
  const node = miss.what === 'node';
  const el = document.createElement('div');
  el.className = 'nf';
  el.setAttribute('role', 'main');
  el.setAttribute('aria-labelledby', 'nf-title');
  el.innerHTML = `<div class="nf-card">
    <div class="nf-code" aria-hidden="true">404</div>
    <h1 id="nf-title" tabindex="-1">${node ? 'Node not found' : 'Page not found'}</h1>
    <p>${
      node
        ? 'There is no node at this path. It may have been renamed, moved or deleted.'
        : 'There is no page at this address.'
    }</p>
    <code title="${esc(miss.label)}">${esc(miss.label)}</code>
    <div class="nf-acts">
      ${back ? '<button type="button" class="btn" data-back>Back</button>' : ''}
      <button type="button" class="btn primary" data-home>Go to Overview</button>
    </div></div>`;
  document.body.appendChild(el);
  open = el;
  document.title = (node ? 'Node not found' : 'Page not found') + ' · Memora';
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
