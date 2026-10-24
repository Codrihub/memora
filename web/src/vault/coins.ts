// Agent "coins" on tree rows: which active agents are working on a note or inside a folder right now.

import { attr, esc, useStyles } from '../dom';
import { agentColor, agentInitials } from '../control/agents';
import type { Presence } from './store';

const CSS = `
.vx-coins{display:inline-flex;flex-direction:row-reverse;align-items:center;flex:none;margin-left:auto;padding-left:4px;--cs:18px;--step:11px}
.vx-coins.sm{--cs:16px;--step:10px}
.vx-coin{position:relative;display:grid;place-items:center;width:var(--cs);height:var(--cs);border-radius:50%;flex:none;
  font:800 calc(var(--cs) * .42)/1 var(--font);letter-spacing:-.02em;color:#0b0e14;
  background:radial-gradient(circle at 32% 28%,rgba(255,255,255,.75),rgba(255,255,255,0) 46%),
    radial-gradient(circle at 50% 120%,rgba(0,0,0,.28),rgba(0,0,0,0) 60%),var(--c);
  box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--c) 55%,#000),inset 0 0 0 3px color-mix(in srgb,var(--c) 80%,#fff);
  animation:vxCoinIn .45s cubic-bezier(.34,1.56,.64,1) both;z-index:calc(10 - var(--k))}
.vx-coin + .vx-coin{margin-right:calc(var(--step) - var(--cs))}
.vx-coins.many .vx-coin{animation:vxCoinIn .45s cubic-bezier(.34,1.56,.64,1) both,vxCoinPile 7s cubic-bezier(.6,0,.3,1) 1.2s infinite}
.vx-coin-more{display:inline-grid;place-items:center;height:16px;min-width:16px;padding:0 4px;margin-right:4px;border-radius:99px;flex:none;
  font:750 10px/1 var(--font);color:var(--fg);background:var(--panel-2);border:1px solid var(--line)}
@keyframes vxCoinIn{from{transform:scale(.3) translateY(4px);opacity:0}}
.vx-coin::after{content:"";position:absolute;inset:-3px;border-radius:50%;border:1.5px solid var(--c);opacity:0;animation:vxCoinPulse 1.8s ease-out infinite}
@keyframes vxCoinPulse{0%{transform:scale(.85);opacity:.7}100%{transform:scale(1.35);opacity:0}}
@keyframes vxCoinPile{
  0%,46%,100%{transform:none}
  56%,86%{transform:translateX(calc(var(--k) * var(--step))) translateY(calc(var(--k) * -2.6px)) scaleY(.62)}
}
@media (prefers-reduced-motion:reduce){.vx-coin,.vx-coins.many .vx-coin,.vx-coin::after{animation:none}}
`;

/** Up to three coins, newest rightmost, plus "+N" for the rest. */
export function coinsHTML(list: Presence[], small = false): string {
  if (!list.length) return '';
  useStyles('vx-coins-css', CSS);
  const shown = list.slice(0, 3);
  const more = list.length - shown.length;
  const who = list.map((p) => p.actor).join(', ');
  return `<span class="vx-coins${small ? ' sm' : ''}${list.length > 1 ? ' many' : ''}" title="${attr(
    `Working here now: ${who}`,
  )}" aria-label="${attr(`${list.length} agent${list.length === 1 ? '' : 's'} working here`)}">${shown
    .map(
      (p, k) =>
        `<span class="vx-coin" style="--c:${attr(agentColor(p.actor, p.id))};--k:${k}">${esc(agentInitials(p.actor))}</span>`,
    )
    .join('')}${more > 0 ? `<span class="vx-coin-more">+${more}</span>` : ''}</span>`;
}
