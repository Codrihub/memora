// "Page not found": a page address or a node link that leads nowhere. Says
// what was asked for, then goes to Overview by itself after 3 seconds (or at
// once with the button). Any other navigation cancels the countdown.

import { esc, useStyles } from '../dom';

const CSS = `
.nf{position:fixed;inset:0;z-index:70;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--fg);
  animation:nf-in .25s ease}
@keyframes nf-in{from{opacity:0}}
.nf-card{width:min(440px,100%);text-align:center}
.nf-code{font-size:64px;font-weight:800;letter-spacing:-.04em;line-height:1;color:var(--accent)}
.nf h1{margin:14px 0 8px;font-size:22px;letter-spacing:-.01em}
.nf p{margin:0 auto;max-width:36ch;font-size:14px;line-height:1.6;color:var(--muted)}
.nf code{display:inline-block;max-width:100%;margin-top:12px;padding:4px 10px;border-radius:8px;border:1px solid var(--line);background:var(--surface-2);
  font:12.5px var(--mono,monospace);color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}
.nf-acts{display:flex;flex-direction:column;align-items:center;gap:12px;margin-top:24px}
.nf-bar{width:180px;height:4px;border-radius:99px;background:var(--surface-2);overflow:hidden}
.nf-bar i{display:block;height:100%;width:100%;background:var(--accent);transform-origin:left;animation:nf-count 3s linear forwards}
@keyframes nf-count{to{transform:scaleX(0)}}
.nf small{font-size:12.5px;color:var(--muted)}
@media (prefers-reduced-motion:reduce){.nf,.nf-bar i{animation:none}}
`;

let open: { el: HTMLElement; timer: number } | null = null;

export function closeNotFound(): void {
  if (!open) return;
  clearInterval(open.timer);
  open.el.remove();
  open = null;
}

/**
 * Show the not-found page for `what` (the address or node path that was
 * asked for); `home` takes the user to Overview.
 */
export function showNotFound(kind: 'page' | 'node', what: string, home: () => void): void {
  closeNotFound();
  useStyles('notfound-css', CSS);
  const el = document.createElement('div');
  el.className = 'nf';
  el.setAttribute('role', 'alert');
  el.innerHTML = `<div class="nf-card">
    <div class="nf-code">404</div>
    <h1>${kind === 'node' ? 'Node not found' : 'Page not found'}</h1>
    <p>${
      kind === 'node'
        ? 'This node does not exist (any more). It may have been renamed, moved or deleted.'
        : 'There is no page at this address.'
    }</p>
    <code title="${esc(what)}">${esc(what)}</code>
    <div class="nf-acts">
      <button type="button" class="btn primary" data-home>Back to Overview</button>
      <div class="nf-bar" aria-hidden="true"><i></i></div>
      <small aria-live="polite">Taking you to Overview in <b>3</b>…</small>
    </div></div>`;
  document.body.appendChild(el);
  let left = 3;
  const go = (): void => {
    closeNotFound();
    home();
  };
  const timer = window.setInterval(() => {
    left--;
    const b = el.querySelector('small b');
    if (b) b.textContent = String(Math.max(0, left));
    if (left <= 0) go();
  }, 1000);
  open = { el, timer };
  el.querySelector<HTMLElement>('[data-home]')!.onclick = go;
  el.querySelector<HTMLElement>('[data-home]')!.focus({ preventScroll: true });
}
