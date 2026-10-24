import { useStyles } from '../dom';

const CSS = `
.sk{display:block;background:var(--line-strong,#2b3446);border-radius:6px;animation:sk-breathe 1.5s ease-in-out infinite}
.sk.r{border-radius:50%}
.sk.pill{border-radius:99px}
.sk-line{height:12px;margin:9px 0}
.sk-row{display:flex;align-items:center;gap:10px}
.sk-row>.sk{flex:none}
.sk-stack{display:flex;flex-direction:column;gap:0;flex:1;min-width:0}
.sk-gap{height:22px}
.sk-bullet{display:flex;align-items:center;gap:10px;margin:10px 0}
.sk-bullet .sk.r{width:6px;height:6px}
.sk-li{display:flex;align-items:center;gap:12px;height:56px;padding:0 16px;border-top:1px solid var(--line,#232a38)}
.sk-li:first-child{border-top:0}
@keyframes sk-breathe{0%,100%{opacity:1}50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.sk{animation:none}}
`;

const b = (w: string, h = 12, extra = ''): string => `<span class="sk${extra ? ' ' + extra : ''}" style="width:${w};height:${h}px"></span>`;
const lines = (widths: number[]): string => widths.map((w) => `<span class="sk sk-line" style="width:${w}%"></span>`).join('');

export function previewSkeleton(): string {
  useStyles('skeleton-css', CSS);
  return `<div aria-busy="true" aria-label="Loading the preview">${b('45%', 16)}${lines([96, 90, 64])}<div class="sk-gap" style="height:10px"></div>${b('35%', 14)}${lines([92, 70])}</div>`;
}

export function rowsSkeleton(n = 6, round = true): string {
  useStyles('skeleton-css', CSS);
  return Array.from(
    { length: n },
    (_, i) =>
      `<div class="sk-li" aria-hidden="true">${b('32px', 32, round ? 'r' : '')}<div class="sk-stack">${b(`${50 + ((i * 13) % 30)}%`, 11)}<span style="height:7px"></span>${b(`${30 + ((i * 17) % 35)}%`, 9)}</div>${b('44px', 10)}</div>`,
  ).join('');
}

export function skBlock(w: string, h = 12, extra = ''): string {
  useStyles('skeleton-css', CSS);
  return b(w, h, extra);
}
