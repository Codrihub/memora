// The welcome tour (/welcome), shown once after the first sign-in. "Seen" is stored server-side so it does not return on another device.

import { api } from '../api';
import { useStyles } from '../dom';
import { hooks } from '../hooks';
import { BRAND_DESC, BRAND_MOTTO, BRAND_NAME, BRAND_TAG, markSvg } from '../brand';
import { BRAND_FONT } from '../brand-font';
import { icon } from '../ui/icons';

const FLAG = '/api/ui/layout/welcome';
/** The address the app was loaded at, before routing rewrites /welcome to /overview. */
const START = location.pathname.replace(/\/+$/, '');

const CSS = `
.wl-tour{position:fixed;inset:0;z-index:75;display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,400px);background:var(--bg);
  opacity:0;transition:opacity .28s var(--ease)}
.wl-tour.on{opacity:1}
.wl-side{order:2;position:relative;overflow:hidden;isolation:isolate;margin:12px 12px 12px 0;border-radius:22px;padding:32px 32px 28px;display:flex;flex-direction:column;
  background:linear-gradient(165deg,#17202e 0%,#0b0f17 62%);color:#e6e9ef}
.wl-side::before{content:"";position:absolute;inset:-20%;z-index:-1;background:radial-gradient(closest-side at 70% 30%,rgba(94,234,212,.16),transparent 70%),
  radial-gradient(closest-side at 20% 85%,rgba(34,211,238,.10),transparent 70%)}
.wl-net{position:absolute;inset:0;width:100%;height:100%;z-index:-1;
  -webkit-mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.15) 32%,rgba(0,0,0,.15) 72%,#000 100%);mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.15) 32%,rgba(0,0,0,.15) 72%,#000 100%)}
.wl-net line{stroke:rgba(94,234,212,.13);stroke-width:1}
.wl-net circle{fill:#5eead4;opacity:.5}
.wl-net circle:nth-child(5n+1){fill:#22d3ee;opacity:.85}
.wl-brand{display:flex;align-items:center;gap:12px}
.wl-brand .wl-mk{width:36px;height:36px;flex:none}
.wl-brand b,.wl-top b{font-family:${BRAND_FONT};font-weight:700;letter-spacing:0;font-size:26px;line-height:1}
.wl-track{list-style:none;margin:auto 0;padding:0;display:flex;flex-direction:column;gap:4px;position:relative}
.wl-track li{position:relative;display:flex;align-items:center;gap:14px;padding:10px 0;font-size:14.5px;font-weight:500;color:#6b7a91;transition:color .25s}
.wl-track li i{position:relative;z-index:1;display:grid;place-items:center;width:26px;height:26px;border-radius:50%;flex:none;font:600 12px/1 var(--font);font-style:normal;
  border:1px solid rgba(148,163,184,.28);background:#0f151f;color:#8592a8;transition:background .25s,border-color .25s,color .25s}
.wl-track li:not(:last-child)::after{content:"";position:absolute;left:12.5px;top:38px;height:16px;width:1px;background:rgba(148,163,184,.22)}
.wl-track li.done{color:#a3afc2}
.wl-track li.done i{border-color:rgba(94,234,212,.45);color:#5eead4}
.wl-track li.on{color:#fff}
.wl-track li.on i{border-color:transparent;background:linear-gradient(180deg,#5eead4,#22d3ee);color:#04221e}
.wl-tag{font-size:12px;color:#6b7a91}
.wl-main{display:flex;flex-direction:column;min-width:0;min-height:0}
.wl-top{display:flex;align-items:center;gap:10px;padding:20px 28px 0;flex:none}
.wl-top .wl-mk{display:none;width:28px;height:28px}
.wl-top b{display:none;font-size:22px}
.wl-top .grow{flex:1}
.wl-skip{height:34px;padding:0 14px;border-radius:99px;font-size:13px;font-weight:500;color:var(--muted);border:1px solid var(--line-strong);background:none;cursor:pointer}
.wl-skip:hover,.wl-skip:focus-visible{color:var(--fg);background:var(--hover)}
.wl-bar{display:none}
.wl-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex}
.wl-step{margin:auto;width:100%;max-width:820px;padding:24px 40px 32px}
.wl-step[hidden]{display:none}
.wl-step.in.back{animation-name:wl-in-back}
@keyframes wl-in-back{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
.wl-hero{display:flex;flex-direction:column;align-items:flex-start;text-align:left}
.wl-eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--muted)}
.wl-eyebrow::before{content:"";width:6px;height:6px;border-radius:50%;background:linear-gradient(180deg,#5eead4,#22d3ee)}
.wl-tour h1{margin:12px 0 14px;font-size:44px;font-weight:650;line-height:1.08;letter-spacing:-.03em}
.wl-tour h2{margin:12px 0 12px;font-size:32px;font-weight:650;line-height:1.15;letter-spacing:-.025em;text-transform:none;color:var(--fg)}
.wl-lead{margin:0;max-width:58ch;font-size:16px;line-height:1.7;color:var(--muted)}
.wl-lead b{color:var(--fg);font-weight:600}
.wl-name{margin:20px 0 0;max-width:58ch;padding:14px 16px;border-radius:12px;background:color-mix(in srgb,var(--fg) 4%,transparent);font-size:13.5px;line-height:1.6;color:var(--text-2)}
.wl-dia{margin-top:28px;padding:20px;border:1px solid var(--line);border-radius:16px;background:var(--surface-1)}
.wl-dia>svg{display:block;width:100%;height:auto;stroke:none}
.wl-dia>.tall{display:none}
.wl-dia .chip rect{fill:color-mix(in srgb,var(--fg) 4%,var(--surface-1));stroke:var(--line-strong)}
.wl-dia .chip text{fill:var(--fg);font:500 12.5px var(--font)}
.wl-dia .grp{fill:var(--muted);font:500 11px var(--font)}
.wl-dia .wire{fill:none;stroke:#14b8a6;stroke-opacity:.6;stroke-width:1.5;stroke-dasharray:4 5;animation:wl-flow 1.4s linear infinite}
.wl-dia .wire.out{stroke:#22d3ee}
@keyframes wl-flow{to{stroke-dashoffset:-18}}
.wl-card{display:flex;flex-direction:column;align-items:flex-start;padding:18px;border:1px solid var(--line);border-radius:14px;background:var(--surface-1);min-width:0}
.wl-card .ti{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--muted)}
.wl-card .ti .i{width:18px;height:18px;stroke-width:1.7}
.wl-card b{display:block;margin:14px 0 4px;font-size:15px;font-weight:600;color:var(--fg)}
.wl-card span{font-size:13.5px;line-height:1.55;color:var(--muted)}
.wl-tip{font-style:normal;font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;color:#0b0f17;background:linear-gradient(135deg,#5eead4,#22d3ee)}
.wl-where{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}
.wl-where code{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;border-radius:99px;font-family:var(--mono);font-size:12.5px;
  border:1px solid var(--line-strong);background:var(--surface-1);color:var(--fg)}
.wl-where code::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ok)}
.wl-note{margin-top:16px;font-size:13px;color:var(--muted)}
.wl-foot{flex:none;display:flex;align-items:center;gap:12px;padding:16px 40px max(20px,env(safe-area-inset-bottom));margin:0 auto;width:100%;max-width:820px}
.wl-foot .grow{flex:1}
.wl-foot .btn{height:42px;border-radius:12px;padding:0 18px}
.wl-foot .wl-next{min-width:128px;justify-content:center}
.wl-foot .wl-back[hidden]{display:inline-flex;visibility:hidden}
.wl-count{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
@media (max-width:1000px){
  .wl-tour{grid-template-columns:minmax(0,1fr)}
  .wl-side{display:none}
  .wl-top{padding:16px 20px 0}
  .wl-top .wl-mk,.wl-top b{display:block}
  .wl-bar{display:flex;gap:4px;padding:14px 20px 0;flex:none}
  .wl-bar i{flex:1;height:3px;border-radius:3px;background:color-mix(in srgb,var(--fg) 10%,transparent);transition:background .25s}
  .wl-bar i.on{background:linear-gradient(90deg,#14b8a6,#22d3ee)}
}
@media (max-width:600px){
  .wl-step{padding:20px 20px 24px}
  .wl-tour h1{font-size:32px}
  .wl-tour h2{font-size:25px}
  .wl-lead{font-size:15px}
  .wl-dia{padding:12px}
  .wl-dia>.wide{display:none}
  .wl-dia>.tall{display:block}
  .wl-foot{padding:12px 16px max(14px,env(safe-area-inset-bottom));border-top:1px solid var(--line)}
  .wl-foot .btn{height:46px}
  .wl-foot .wl-next{flex:1;min-width:0}
  .wl-count{display:none}
}
@media (prefers-reduced-motion:reduce){.wl-tour{transition:none}.wl-dia .wire,.wl-step.in{animation:none}}
.wl-grad{background:linear-gradient(92deg,#5eead4 0%,#22d3ee 45%,#a78bfa 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
:root[data-theme=light] .wl-grad{background-image:linear-gradient(92deg,#0d9488 0%,#0891b2 45%,#7c3aed 100%)}
.wl-step.in{animation:wl-pop .55s cubic-bezier(.2,.9,.25,1.05)}
@keyframes wl-pop{from{opacity:0;transform:translateY(18px) scale(.985);filter:blur(4px)}to{opacity:1;transform:none;filter:none}}
.wl-step.in .wl-stagger>*{animation:wl-rise .6s cubic-bezier(.2,.9,.25,1) both}
.wl-step.in .wl-stagger>*:nth-child(2){animation-delay:.07s}.wl-step.in .wl-stagger>*:nth-child(3){animation-delay:.14s}
.wl-step.in .wl-stagger>*:nth-child(4){animation-delay:.21s}.wl-step.in .wl-stagger>*:nth-child(5){animation-delay:.28s}.wl-step.in .wl-stagger>*:nth-child(6){animation-delay:.35s}
@keyframes wl-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.wl-intro{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:center;gap:32px}
.wl-orbit{position:relative;width:min(300px,100%);aspect-ratio:1;justify-self:center}
.wl-orbit::before{content:"";position:absolute;inset:18%;border-radius:50%;background:radial-gradient(closest-side,rgba(94,234,212,.28),transparent 72%);filter:blur(6px);animation:wl-glow 4s ease-in-out infinite}
@keyframes wl-glow{50%{opacity:.55;transform:scale(1.08)}}
.wl-core{position:absolute;inset:34%;display:grid;place-items:center;animation:wl-bob 5s ease-in-out infinite}
.wl-core svg{width:100%;height:100%;filter:drop-shadow(0 10px 28px rgba(34,211,238,.35))}
@keyframes wl-bob{50%{transform:translateY(-6px)}}
.wl-ring{position:absolute;border-radius:50%;border:1px dashed color-mix(in srgb,var(--fg) 16%,transparent);animation:wl-spin 26s linear infinite}
.wl-ring.r1{inset:14%}.wl-ring.r2{inset:0;animation-duration:40s;animation-direction:reverse}
@keyframes wl-spin{to{transform:rotate(360deg)}}
.wl-sat{position:absolute;left:50%;top:0;translate:-50% -50%;display:grid;place-items:center;width:40px;height:40px;border-radius:12px;font:700 12px/1 var(--font);
  color:#0b0f17;background:var(--c);box-shadow:0 6px 18px -6px var(--c),inset 0 1px 0 rgba(255,255,255,.4);animation:wl-spin 26s linear infinite reverse}
.wl-ring.r2 .wl-sat{animation-duration:40s;animation-direction:normal}
.wl-pin{position:absolute;inset:0;transform:rotate(var(--a))}
.wl-pin>.wl-sat{rotate:calc(-1 * var(--a))}
.wl-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}
.wl-chips span{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;border-radius:99px;font-size:13px;font-weight:500;
  color:var(--text-2);background:color-mix(in srgb,var(--fg) 5%,transparent);border:1px solid var(--line)}
.wl-chips span i{width:7px;height:7px;border-radius:50%;background:var(--c)}
.wl-dia{position:relative;overflow:hidden;background:radial-gradient(120% 90% at 50% 50%,color-mix(in srgb,#22d3ee 8%,var(--surface-1)),var(--surface-1))}
.wl-dia .pulse{fill:#5eead4;filter:drop-shadow(0 0 4px #5eead4)}
.wl-dia .pulse.out{fill:#22d3ee;filter:drop-shadow(0 0 4px #22d3ee)}
.wl-before{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
.wl-before>div{padding:14px 16px;border-radius:14px;font-size:13.5px;line-height:1.5;border:1px solid var(--line)}
.wl-before b{display:block;margin-bottom:4px;font-size:12px;font-weight:600;letter-spacing:.02em}
.wl-before .no{background:color-mix(in srgb,var(--danger) 6%,var(--surface-1));color:var(--text-2)}
.wl-before .no b{color:var(--danger)}
.wl-before .yes{background:color-mix(in srgb,#14b8a6 8%,var(--surface-1));color:var(--text-2)}
.wl-before .yes b{color:#14b8a6}
.wl-places{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:26px}
.wl-place{position:relative;padding:18px;border-radius:16px;border:1px solid var(--line);background:var(--surface-1);overflow:hidden;transition:transform .2s,border-color .2s}
.wl-place:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--c) 50%,var(--line))}
.wl-place::after{content:"";position:absolute;right:-30px;top:-30px;width:110px;height:110px;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--c) 30%,transparent),transparent)}
.wl-place .ti{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent)}
.wl-place .ti svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.wl-place b{display:block;margin:14px 0 4px;font-size:15px;font-weight:600}
.wl-place span{font-size:13px;line-height:1.5;color:var(--muted)}
.wl-place .live{position:absolute;right:16px;top:18px;width:8px;height:8px;border-radius:50%;background:var(--c);box-shadow:0 0 0 0 var(--c);animation:wl-ping 2s ease-out infinite}
@keyframes wl-ping{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--c) 60%,transparent)}100%{box-shadow:0 0 0 10px transparent}}
.wl-bento{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-top:26px}
.wl-bento .wl-card{position:relative;overflow:hidden;transition:transform .2s,border-color .2s,box-shadow .2s}
.wl-bento .wl-card:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--c) 45%,var(--line));box-shadow:0 14px 30px -18px var(--c)}
.wl-bento .wl-card .ti{color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent)}
.wl-bento .b1{grid-column:span 4}.wl-bento .b2{grid-column:span 2}.wl-bento .b3{grid-column:span 2}.wl-bento .b4{grid-column:span 4}
.wl-art{position:absolute;right:16px;top:16px;opacity:.9;pointer-events:none}
.wl-art.lines{display:flex;flex-direction:column;gap:5px;width:110px;top:22px}
.wl-art.lines i{height:6px;border-radius:3px;background:color-mix(in srgb,var(--c) 30%,transparent);animation:wl-type 3s ease-in-out infinite}
.wl-art.lines i:nth-child(2){width:80%;animation-delay:.3s}.wl-art.lines i:nth-child(3){width:60%;animation-delay:.6s}
@keyframes wl-type{0%,100%{transform:scaleX(.6);transform-origin:left}50%{transform:scaleX(1)}}
.wl-art.dots{width:56px;height:56px}
.wl-art.dots circle{fill:var(--c);animation:wl-twinkle 2.4s ease-in-out infinite}
.wl-art.dots circle:nth-child(3n){animation-delay:.8s}.wl-art.dots circle:nth-child(3n+1){animation-delay:1.6s}
.wl-art.dots line{stroke:var(--c);stroke-opacity:.35}
@keyframes wl-twinkle{50%{opacity:.3}}
.wl-art.keys{display:flex;gap:6px}
.wl-art.keys i{width:26px;height:26px;border-radius:8px;background:color-mix(in srgb,var(--c) 22%,transparent);animation:wl-bob 3s ease-in-out infinite}
.wl-art.keys i:nth-child(2){animation-delay:.4s}.wl-art.keys i:nth-child(3){animation-delay:.8s}
.wl-art.bars{display:flex;align-items:flex-end;gap:4px;height:36px}
.wl-art.bars i{width:8px;border-radius:3px;background:var(--c);opacity:.75;animation:wl-eq 1.6s ease-in-out infinite}
.wl-art.bars i:nth-child(odd){animation-delay:.3s}.wl-art.bars i:nth-child(3n){animation-delay:.6s}
@keyframes wl-eq{0%,100%{height:20%}50%{height:100%}}
.wl-bento .wl-card span{max-width:30ch}
.wl-starts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:26px}
.wl-start{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:20px;border-radius:18px;border:1px solid var(--line);background:var(--surface-1);
  text-align:left;cursor:pointer;color:inherit;font:inherit;transition:transform .2s,border-color .2s,box-shadow .2s}
.wl-start:hover,.wl-start:focus-visible{transform:translateY(-4px);border-color:var(--line-strong);box-shadow:0 18px 34px -20px rgba(0,0,0,.45)}
.wl-start .ti{display:grid;place-items:center;width:46px;height:46px;border-radius:14px;margin-bottom:14px;color:var(--muted);background:color-mix(in srgb,var(--fg) 5%,transparent)}
.wl-start .ti .i{width:22px;height:22px}
.wl-start b{font-size:16px;font-weight:650}
.wl-start span{font-size:13.5px;line-height:1.5;color:var(--muted)}
.wl-start .go{margin-top:auto;padding-top:16px;display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--text-2)}
.wl-start .go .i{width:15px;height:15px;transition:transform .2s}
.wl-start:hover .go .i{transform:translateX(3px)}
@property --wl-a{syntax:'<angle>';inherits:false;initial-value:0deg}
.wl-start.hot{border-color:transparent;background:linear-gradient(var(--surface-1),var(--surface-1)) padding-box,
  conic-gradient(from var(--wl-a),#5eead4,#22d3ee,#a78bfa,#5eead4) border-box;border:1.5px solid transparent;animation:wl-turn 4s linear infinite}
@keyframes wl-turn{to{--wl-a:360deg}}
.wl-start.hot .ti{color:#5eead4;background:linear-gradient(180deg,#17202e,#0b0f17)}
.wl-start.hot .go{color:var(--fg)}
.wl-start .wl-tip{position:absolute;top:16px;right:16px}
@media (max-width:1000px){.wl-intro{grid-template-columns:1fr}.wl-orbit{width:220px;order:-1}}
@media (max-width:760px){.wl-places,.wl-starts{grid-template-columns:1fr}.wl-bento{grid-template-columns:1fr}.wl-bento .wl-card{grid-column:auto}.wl-before{grid-template-columns:1fr}
  .wl-art{display:none}.wl-orbit{width:180px}}
@media (prefers-reduced-motion:reduce){.wl-tour *,.wl-tour *::before{animation:none!important}}
`;

interface Chip {
  x: number;
  y: number;
  w: number;
  label: string;
}

const CH = 32;

function chip(c: Chip): string {
  return `<g class="chip"><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${CH}" rx="9"/>
    <text x="${c.x + c.w / 2}" y="${c.y + CH / 2 + 4.5}" text-anchor="middle">${c.label}</text></g>`;
}

const AGENTS = ['Claude', 'Cursor', 'ChatGPT', 'Your own agent'];

let pulses = 0;
/** A small light running along a wire, each one starting at its own moment. */
function pulse(d: string, cls: string): string {
  const begin = ((pulses++ * 0.37) % 2).toFixed(2);
  return `<circle class="pulse ${cls}" r="3.2"><animateMotion dur="2.2s" begin="${begin}s" repeatCount="indefinite" path="${d}"/></circle>`;
}
const PLACES = ['This computer', 'Local network', 'Internet (tunnel)'];

/** Agents on the left, Memora in the middle, the places it is reached from on the right. */
function wideDiagram(): string {
  const W = 680;
  const H = 250;
  const cx = W / 2;
  const cy = 132;
  const T = 92;
  const left = AGENTS.map((label, i) => ({ x: 14, y: 34 + i * 52, w: 150, label }));
  const right = PLACES.map((label, i) => ({ x: W - 164, y: 60 + i * 52, w: 150, label }));
  const wires =
    left
      .map((c) => {
        const x0 = c.x + c.w;
        const y0 = c.y + CH / 2;
        const x1 = cx - T / 2;
        const d = `M${x0} ${y0}C${x0 + 70} ${y0} ${x1 - 70} ${cy} ${x1} ${cy}`;
        return `<path class="wire" d="${d}"/>${pulse(d, '')}`;
      })
      .join('') +
    right
      .map((c) => {
        const x0 = cx + T / 2;
        const y1 = c.y + CH / 2;
        const d = `M${x0} ${cy}C${x0 + 70} ${cy} ${c.x - 70} ${y1} ${c.x} ${y1}`;
        return `<path class="wire out" d="${d}"/>${pulse(d, 'out')}`;
      })
      .join('');
  return `<svg class="wide" viewBox="0 0 ${W} ${H}" role="img" aria-label="Claude, Cursor, ChatGPT and your own agent share one Memora, reachable from this computer, the local network or the internet">
    <text class="grp" x="14" y="18">Your agents</text>
    <text class="grp" x="${W - 14}" y="44" text-anchor="end">Reach it from</text>
    ${wires}${left.map(chip).join('')}${right.map(chip).join('')}
    <svg x="${cx - T / 2}" y="${cy - T / 2}" width="${T}" height="${T}" viewBox="1 1 22 22">${markInner()}</svg>
  </svg>`;
}

/** The same picture stacked for phones: agents on top, places below. */
function tallDiagram(): string {
  const W = 340;
  const H = 400;
  const cx = W / 2;
  const cy = 196;
  const T = 76;
  const top = AGENTS.map((label, i) => ({ x: i % 2 ? 176 : 14, y: 26 + Math.floor(i / 2) * 42, w: 150, label }));
  const bottom = PLACES.map((label, i) =>
    i < 2 ? { x: i ? 176 : 14, y: 280, w: 150, label } : { x: (W - 170) / 2, y: 322, w: 170, label },
  );
  const wires =
    top
      .map((c) => {
        const x0 = c.x + c.w / 2;
        const y0 = c.y + CH;
        const y1 = cy - T / 2;
        return `<path class="wire" d="M${x0} ${y0}C${x0} ${y0 + 40} ${cx} ${y1 - 40} ${cx} ${y1}"/>`;
      })
      .join('') +
    bottom
      .map((c) => {
        const y0 = cy + T / 2;
        const x1 = c.x + c.w / 2;
        return `<path class="wire out" d="M${cx} ${y0}C${cx} ${y0 + 30} ${x1} ${c.y - 30} ${x1} ${c.y}"/>`;
      })
      .join('');
  return `<svg class="tall" viewBox="0 0 ${W} ${H}" role="img" aria-label="Your agents share one Memora, reachable from anywhere">
    <text class="grp" x="14" y="14">Your agents</text>
    <text class="grp" x="14" y="${H - 6}">Reach it from</text>
    ${wires}${top.map(chip).join('')}${bottom.map(chip).join('')}
    <svg x="${cx - T / 2}" y="${cy - T / 2}" width="${T}" height="${T}" viewBox="1 1 22 22">${markInner()}</svg>
  </svg>`;
}

/** The mark's drawing without its outer <svg>, to nest inside the diagram. */
function markInner(): string {
  return markSvg('').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

const TRACK = ['Welcome', 'Why Memora', 'Your server', "What's inside", 'Get started'];

/** Notes as points, nearby ones linked; seeded, so it draws the same every time. */
export function constellation(w: number, h: number, n: number, seed: number, cls: string): string {
  let x0 = seed;
  const rnd = (): number => ((x0 = (x0 * 16807) % 2147483647) - 1) / 2147483646;
  const pts = Array.from({ length: n }, () => [Math.round(rnd() * w), Math.round(rnd() * h)] as const);
  const reach = Math.max(w, h) / 6.5;
  const lines: string[] = [];
  pts.forEach(([x, y], i) => {
    for (let j = i + 1; j < pts.length; j++) {
      const [u, v] = pts[j];
      if (Math.hypot(x - u, y - v) < reach) lines.push(`<line x1="${x}" y1="${y}" x2="${u}" y2="${v}"/>`);
    }
  });
  const dots = pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 5 === 0 ? 3 : 1.7}"/>`).join('');
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g>${lines.join('')}</g><g>${dots}</g></svg>`;
}

function orbitHTML(): string {
  const sat = (label: string, c: string, a: number): string =>
    `<span class="wl-pin" style="--a:${a}deg"><span class="wl-sat" style="--c:${c}">${label}</span></span>`;
  return `<div class="wl-orbit" aria-hidden="true">
    <div class="wl-ring r2">${sat('GP', '#86efac', 20)}${sat('AI', '#fcd34d', 200)}</div>
    <div class="wl-ring r1">${sat('CL', '#fdba74', 0)}${sat('CU', '#a5b4fc', 120)}${sat('CX', '#f0abfc', 240)}</div>
    <div class="wl-core">${markSvg('')}</div></div>`;
}

const LAPTOP = '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19h20"/></svg>';
const HOME = '<svg viewBox="0 0 24 24"><path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/></svg>';
const GLOBE = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>';

const place = (ico: string, c: string, title: string, text: string): string =>
  `<div class="wl-place" style="--c:${c}"><i class="live"></i><span class="ti">${ico}</span><b>${title}</b><span>${text}</span></div>`;

const bento = (cls: string, c: string, ico: string, title: string, text: string, art: string): string =>
  `<div class="wl-card ${cls}" style="--c:${c}"><span class="ti">${icon(ico)}</span><b>${title}</b><span>${text}</span>${art}</div>`;

function dotsArt(): string {
  const pts = [
    [10, 14], [38, 8], [64, 20], [22, 40], [50, 36], [70, 52], [14, 64], [42, 66],
  ];
  const lines = [[0, 1], [1, 2], [0, 3], [3, 4], [4, 2], [4, 5], [3, 6], [6, 7], [7, 5], [1, 4]]
    .map(([a, b]) => `<line x1="${pts[a][0]}" y1="${pts[a][1]}" x2="${pts[b][0]}" y2="${pts[b][1]}"/>`)
    .join('');
  return `<svg class="wl-art dots" viewBox="0 0 76 76">${lines}${pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 2.6 : 4}"/>`).join('')}</svg>`;
}

const start = (act: string, ico: string, title: string, text: string, cta: string, hot = false): string =>
  `<button type="button" class="wl-start${hot ? ' hot' : ''}" data-wl="${act}">${hot ? '<em class="wl-tip">Suggested</em>' : ''}<span class="ti">${icon(
    ico,
  )}</span><b>${title}</b><span>${text}</span><span class="go">${cta}${icon('arrow', 'i')}</span></button>`;

function stepsHTML(): string[] {
  return [
    `<div class="wl-intro"><div class="wl-hero wl-stagger">
      <div class="wl-eyebrow">Welcome to Memora</div>
      <h1><span class="wl-grad">${BRAND_MOTTO}</span></h1>
      <p class="wl-lead">${BRAND_DESC}</p>
      <div class="wl-chips"><span style="--c:#fdba74"><i></i>Claude</span><span style="--c:#a5b4fc"><i></i>Cursor</span><span style="--c:#86efac"><i></i>ChatGPT</span><span style="--c:#f0abfc"><i></i>Codex</span><span style="--c:#fcd34d"><i></i>Your own agent</span></div>
      <p class="wl-name">${BRAND_NAME}</p></div>${orbitHTML()}</div>`,
    `<div class="wl-hero wl-stagger"><div class="wl-eyebrow">Why Memora</div>
      <h2>Set up once. <span class="wl-grad">Use it everywhere.</span></h2>
      <p class="wl-lead">Every agent usually starts from zero. <b>Memora keeps it in one place:</b> connect each agent once and
        they all read the same vault and write back to it, so what one learns, the others can use.</p>
      <div class="wl-before"><div class="no"><b>Without Memora</b>The same instructions pasted into Claude, set up again in Cursor, handed to ChatGPT and your scripts.</div>
        <div class="yes"><b>With Memora</b>One memory every agent reads and writes, and you can see, edit and connect all of it.</div></div></div>
      <div class="wl-dia">${wideDiagram()}${tallDiagram()}</div>`,
    `<div class="wl-hero wl-stagger"><div class="wl-eyebrow">Your server, your reach</div>
      <h2>Reachable from <span class="wl-grad">anywhere</span></h2>
      <p class="wl-lead">Run it where you like. Agents connect over <b>MCP</b> with their own key; you sign in from any browser, desktop or phone.</p></div>
      <div class="wl-places wl-stagger">
        ${place(LAPTOP, '#22d3ee', 'This computer', 'Your laptop or desktop, at localhost.')}
        ${place(HOME, '#a78bfa', 'Home or office', 'A home server or a VPS on your local network.')}
        ${place(GLOBE, '#5eead4', 'The internet', 'Through a tunnel or a reverse proxy, from anywhere.')}
      </div>
      <div class="wl-where"><code>localhost</code><code>LAN</code><code>Cloudflare Tunnel</code><code>Tailscale</code><code>ngrok</code><code>nginx / Caddy</code></div>`,
    `<div class="wl-hero wl-stagger"><div class="wl-eyebrow">What's inside</div>
      <h2>Everything in <span class="wl-grad">one vault</span></h2></div>
      <div class="wl-bento wl-stagger">
        ${bento('b1', '#22d3ee', 'note', 'Vault', 'Your notes stay plain Markdown files in a folder you choose. Nothing is locked in.', '<div class="wl-art lines"><i></i><i></i><i></i></div>')}
        ${bento('b2', '#a78bfa', 'brain', 'Brain, Graph, Canvas', 'Every note and link, in 3D, as a graph or on a board.', dotsArt())}
        ${bento('b3', '#fdba74', 'key', 'Agents & keys', 'One key per agent, its own permissions.', '<div class="wl-art keys"><i></i><i></i><i></i></div>')}
        ${bento('b4', '#5eead4', 'activity', 'Activity', 'Every read and write by an agent shows up live, so you always know who did what.', '<div class="wl-art bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>')}
      </div>`,
    `<div class="wl-hero wl-stagger"><div class="wl-eyebrow">You're all set</div>
      <h2>Where would you like <span class="wl-grad">to start?</span></h2></div>
      <div class="wl-starts wl-stagger">
        ${start('keys', 'key', 'Connect an agent', 'Give Claude, Cursor or any MCP app its own key, then let it save what it already knows about you.', 'Connect', true)}
        ${start('new', 'plus', 'Write your first note', 'A note in Markdown. Link notes with [[wikilinks]].', 'Write')}
        ${start('brain', 'brain', 'Open the brain', 'Watch your notes and agents light up live.', 'Explore')}
      </div>
      <p class="wl-note">Open this again any time from the profile menu: Welcome to Memora.</p>`,
  ];
}

function pageHTML(steps: string[]): string {
  return `<aside class="wl-side" aria-hidden="true">${constellation(400, 900, 30, 5, 'wl-net')}
      <div class="wl-brand">${markSvg('wl-mk')}<b>Memora</b></div>
      <ol class="wl-track">${TRACK.map((t, i) => `<li${i ? '' : ' class="on"'}><i>${i + 1}</i>${t}</li>`).join('')}</ol>
      <div class="wl-tag">${BRAND_TAG}</div></aside>
    <div class="wl-main">
    <div class="wl-top">${markSvg('wl-mk')}<b>Memora</b><span class="grow"></span>
      <button type="button" class="wl-skip" data-wl="close">Skip</button></div>
    <div class="wl-bar" aria-hidden="true">${steps.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</div>
    <div class="wl-body">${steps.map((h, i) => `<section class="wl-step" data-step="${i}"${i ? ' hidden' : ''}>${h}</section>`).join('')}</div>
    <div class="wl-foot">
      <button type="button" class="btn ghost wl-back" hidden>Back</button>
      <span class="grow"></span><span class="wl-count" aria-hidden="true">1 of ${steps.length}</span>
      <button type="button" class="btn primary wl-next">Next ${icon('arrow')}</button>
    </div></div>`;
}

let open: HTMLElement | null = null;

/** Show the welcome page and remember that it was seen. */
export function openWelcome(): void {
  if (open) return;
  useStyles('welcome-css', CSS);
  const root = document.createElement('div');
  root.className = 'wl-tour';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Welcome to Memora');
  const steps = stepsHTML();
  root.innerHTML = pageHTML(steps);
  document.body.appendChild(root);
  open = root;
  // Closing returns to the page it was opened from, or to Overview when loaded at /welcome.
  const back = location.pathname === '/welcome' ? '/overview' : location.pathname + location.search;
  if (location.pathname !== '/welcome') history.pushState(history.state, '', '/welcome');
  requestAnimationFrame(() => root.classList.add('on'));
  void api(FLAG, { method: 'PUT', body: { data: { seen_at: Math.floor(Date.now() / 1000) } } }).catch(() => {});

  const close = (then?: () => void): void => {
    if (open !== root) return;
    open = null;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    if (location.pathname === '/welcome') history.replaceState(history.state, '', back);
    root.classList.remove('on');
    setTimeout(() => root.remove(), 300);
    then?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') show(at + 1);
    else if (e.key === 'ArrowLeft') show(at - 1);
  };
  const onPop = (): void => {
    if (location.pathname !== '/welcome') close();
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('popstate', onPop);
  root.querySelectorAll<HTMLElement>('[data-wl]').forEach((b) => {
    b.onclick = () => {
      const act = b.dataset.wl;
      if (act === 'new') close(() => hooks.openNewNote());
      else if (act === 'keys') close(() => hooks.go('keys'));
      else if (act === 'brain') close(() => hooks.go('brain'));
      else close();
    };
  });
  const pages = [...root.querySelectorAll<HTMLElement>('.wl-step')];
  const bars = [...root.querySelectorAll<HTMLElement>('.wl-bar i')];
  const track = [...root.querySelectorAll<HTMLElement>('.wl-track li')];
  const count = root.querySelector<HTMLElement>('.wl-count')!;
  const backBtn = root.querySelector<HTMLButtonElement>('.wl-back')!;
  const nextBtn = root.querySelector<HTMLButtonElement>('.wl-next')!;
  let at = 0;
  const show = (i: number): void => {
    if (i < 0 || i >= pages.length || i === at) return;
    const dir = i > at ? '' : ' back';
    pages[at].hidden = true;
    at = i;
    const pg = pages[at];
    pg.hidden = false;
    pg.className = 'wl-step in' + dir;
    root.querySelector('.wl-body')!.scrollTop = 0;
    bars.forEach((d, k) => d.classList.toggle('on', k <= at));
    track.forEach((d, k) => {
      d.classList.toggle('on', k === at);
      d.classList.toggle('done', k < at);
    });
    count.textContent = `${at + 1} of ${pages.length}`;
    backBtn.hidden = at === 0;
    const last = at === pages.length - 1;
    nextBtn.innerHTML = last ? 'Done' : `Next ${icon('arrow')}`;
    nextBtn.setAttribute('aria-label', last ? 'Close the welcome' : `Next, step ${at + 2} of ${pages.length}`);
  };
  backBtn.onclick = () => show(at - 1);
  nextBtn.onclick = () => (at === pages.length - 1 ? close() : show(at + 1));
  nextBtn.focus({ preventScroll: true });
}

/** On boot: open at /welcome, or the first time this instance is signed in to. */
export async function maybeWelcome(): Promise<void> {
  if (START === '/welcome') {
    openWelcome();
    return;
  }
  try {
    const r = await api<{ data?: unknown }>(FLAG);
    if (r && r.data == null) openWelcome();
  } catch {
    /* better to skip it than to show it on every load */
  }
}
