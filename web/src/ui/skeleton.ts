// Loading skeletons shaped like what is coming, so nothing jumps when the
// content lands: the node reader (bar, outline, title, meta, text, a
// heading, a list, a table), a node card's preview and list rows. Solid
// blocks that breathe (opacity), no shimmer gradient.

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
.sk-table{border:1px solid var(--line,#232a38);border-radius:10px;overflow:hidden;margin:16px 0}
.sk-table>div{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:12px 14px;border-top:1px solid var(--line,#232a38)}
.sk-table>div:first-child{border-top:0;background:var(--surface-2,#151a24)}
.sk-table>div:first-child .sk{background:var(--panel,#12161f)}
.sk-table .sk{height:10px}
.sk-reader .vx-rail{gap:12px}
.sk-reader .vx-rbar .sk{height:12px}
.sk-li{display:flex;align-items:center;gap:12px;height:56px;padding:0 16px;border-top:1px solid var(--line,#232a38)}
.sk-li:first-child{border-top:0}
@keyframes sk-breathe{0%,100%{opacity:1}50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.sk{animation:none}}
`;

const b = (w: string, h = 12, extra = ''): string => `<span class="sk${extra ? ' ' + extra : ''}" style="width:${w};height:${h}px"></span>`;
const lines = (widths: number[]): string => widths.map((w) => `<span class="sk sk-line" style="width:${w}%"></span>`).join('');

/** The node reader while a node loads: the same bar, page, rail and column as the real one. */
export function readerSkeleton(): string {
  useStyles('skeleton-css', CSS);
  return `<div class="sk-reader" aria-busy="true" aria-label="Loading the node" style="display:flex;flex-direction:column;height:100%">
  <header class="vx-rbar">${b('28px', 28, 'r')}${b('48px')}<span style="width:10px"></span>${b('64px')}<span style="width:10px"></span>${b('110px')}
    <span class="vx-grow"></span>${b('28px', 28)}${b('28px', 28)}${b('64px', 30)}${b('28px', 28)}</header>
  <div class="vx-note-scroll"><div class="vx-page">
    <aside class="vx-rail">${b('90px', 10)}${lines([70, 55, 62, 48, 58])}</aside>
    <div class="vx-col">
      ${b('min(420px,70%)', 34)}
      <div class="sk-row" style="margin:14px 0 30px">${b('84px', 20, 'pill')}${b('120px', 12)}${b('70px', 12)}${b('64px', 22, 'pill')}${b('80px', 22, 'pill')}</div>
      ${lines([96, 92, 98, 60])}
      <div class="sk-gap"></div>${b('34%', 22)}
      <div class="sk-bullet">${b('6px', 6, 'r')}${b('62%')}</div>
      <div class="sk-bullet">${b('6px', 6, 'r')}${b('48%')}</div>
      <div class="sk-bullet">${b('6px', 6, 'r')}${b('55%')}</div>
      <div class="sk-gap"></div>${b('28%', 22)}
      <div class="sk-table">${[0, 1, 2, 3].map(() => `<div>${b('70%')}${b('55%')}${b('62%')}${b('80%')}</div>`).join('')}</div>
      ${lines([94, 88, 72])}
    </div>
  </div></div></div>`;
}

/** A node card's preview while the note loads: a heading and two short paragraphs. */
export function previewSkeleton(): string {
  useStyles('skeleton-css', CSS);
  return `<div aria-busy="true" aria-label="Loading the preview">${b('45%', 16)}${lines([96, 90, 64])}<div class="sk-gap" style="height:10px"></div>${b('35%', 14)}${lines([92, 70])}</div>`;
}

/** List rows (avatar or icon, two lines, a time) while a list loads. */
export function rowsSkeleton(n = 6, round = true): string {
  useStyles('skeleton-css', CSS);
  return Array.from(
    { length: n },
    (_, i) =>
      `<div class="sk-li" aria-hidden="true">${b('32px', 32, round ? 'r' : '')}<div class="sk-stack">${b(`${50 + ((i * 13) % 30)}%`, 11)}<span style="height:7px"></span>${b(`${30 + ((i * 17) % 35)}%`, 9)}</div>${b('44px', 10)}</div>`,
  ).join('');
}

/** One skeleton block (width CSS, height px), for views that shape their own skeleton. */
export function skBlock(w: string, h = 12, extra = ''): string {
  useStyles('skeleton-css', CSS);
  return b(w, h, extra);
}

/**
 * Cards while a grid loads: an avatar and two lines, a row of chips, a
 * divider and three small figures, the same rhythm as an agent card.
 * `cls` is the card class so the skeleton sits in the real grid.
 */
export function cardsSkeleton(n = 4, cls = 'cc-card'): string {
  useStyles('skeleton-css', CSS);
  return Array.from(
    { length: n },
    (_, i) => `<div class="${cls} sk-card" aria-hidden="true">
      <div class="sk-row">${b('40px', 40, 'r')}<div class="sk-stack">${b(`${42 + ((i * 11) % 24)}%`, 13)}<span style="height:8px"></span>${b(`${28 + ((i * 7) % 20)}%`, 10)}</div></div>
      <div class="sk-row" style="margin:16px 0 14px">${b('46px', 22, 'pill')}${b('46px', 22, 'pill')}${b('52px', 22, 'pill')}${b('70px', 22, 'pill')}</div>
      <div class="sk-row" style="padding-top:14px;border-top:1px solid var(--line,#232a38);justify-content:space-between">${b('22%', 26)}${b('22%', 26)}${b('22%', 26)}</div>
    </div>`,
  ).join('');
}
