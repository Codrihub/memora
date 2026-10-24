import { useStyles } from '../dom';
import { onNavigate } from '../router';
import type { Page } from '../state';
import { enterCanvas } from '../views/canvas';
import { enterGraph } from '../views/graph';

const CSS = `
.map-veil{position:absolute;inset:0;z-index:30;display:grid;place-items:center;background:var(--surface-0);pointer-events:none;transition:opacity .28s ease-out}
.map-veil.out{opacity:0}
.map-veil i{width:28px;height:28px;border-radius:50%;border:2.5px solid color-mix(in srgb,var(--fg) 12%,transparent);border-top-color:var(--accent);animation:map-spin .8s linear infinite}
.map-veil span{margin-top:12px;font-size:12.5px;color:var(--muted)}
.map-veil div{display:flex;flex-direction:column;align-items:center}
@keyframes map-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.map-veil i{animation:none}.map-veil{transition:none}}
`;

const HOST: Partial<Record<Page, string>> = { brain: 'view-brain', graph: 'view-graph', canvas: 'view-canvas' };
const VEIL_MS = 520;

function veil(host: HTMLElement, label: string): () => void {
  useStyles('map-enter-css', CSS);
  host.querySelector(':scope > .map-veil')?.remove();
  const v = document.createElement('div');
  v.className = 'map-veil';
  v.innerHTML = `<div><i></i><span>${label}</span></div>`;
  host.appendChild(v);
  // A first visit builds the view into this section after us: put the veil back on top.
  window.setTimeout(() => {
    if (!v.classList.contains('out') && !v.isConnected) host.appendChild(v);
  }, 0);
  return () => {
    v.classList.add('out');
    window.setTimeout(() => v.remove(), 320);
  };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function initMapEnter(): void {
  let prev: Page | null = null;
  onNavigate((page) => {
    const was = prev;
    prev = page;
    const id = HOST[page];
    if (!id || page === was) return;
    const host = document.getElementById(id);
    if (!host) return;
    if (page === 'brain') {
      void wait(350).then(() => host.querySelector<HTMLElement>('[data-z=fit]')?.click());
      return;
    }
    const done = veil(host, page === 'canvas' ? 'Tidying the board…' : 'Laying out the graph…');
    void (async () => {
      await wait(VEIL_MS);
      if (page === 'canvas') {
        done();
        await enterCanvas();
      } else {
        enterGraph();
        done();
      }
    })();
  });
}
