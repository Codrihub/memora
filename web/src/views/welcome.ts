// The welcome page (/welcome): what Memora is and why it exists, shown once
// over the app after the first sign-in. "Seen" is kept in the state database
// (`/api/ui/layout/welcome`), so it does not come back on another device or
// browser; the profile menu, search and Help open it again.

import { api } from '../api';
import { useStyles } from '../dom';
import { hooks } from '../hooks';
import { BRAND_DESC, BRAND_MOTTO, BRAND_NAME, markSvg } from '../brand';
import { icon } from '../ui/icons';

const FLAG = '/api/ui/layout/welcome';
/** The address the app was loaded at, before routing rewrites /welcome to /overview. */
const START = location.pathname.replace(/\/+$/, '');

const CSS = `
.wl{position:fixed;inset:0;z-index:75;display:flex;flex-direction:column;background:var(--bg);
  opacity:0;transition:opacity .28s var(--ease)}
.wl.on{opacity:1}
.wl-bar{display:flex;align-items:center;gap:10px;padding:14px max(16px,calc((100% - 820px) / 2));flex:none}
.wl-bar .wl-mk{width:26px;height:26px}
.wl-bar b{font-size:15px}
.wl-bar .grow{flex:1}
.wl-skip{padding:6px 4px;font-size:12.5px;color:var(--muted);opacity:.75;background:none;border:0;cursor:pointer}
.wl-skip:hover,.wl-skip:focus-visible{opacity:1;color:var(--fg);text-decoration:underline;text-underline-offset:3px}
.wl-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex}
.wl-step{margin:auto;width:100%;max-width:820px;padding:20px 16px 28px}
.wl-step[hidden]{display:none}
.wl-step.in{animation:wl-in .32s var(--ease)}
.wl-step.in.back{animation-name:wl-in-back}
@keyframes wl-in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}
@keyframes wl-in-back{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}}
.wl-hero{display:flex;flex-direction:column;align-items:center;text-align:center}
.wl-hero .wl-big{width:104px;height:104px;margin-bottom:18px}
.wl-eyebrow{font-size:12.5px;font-weight:650;color:var(--accent)}
.wl h1{margin:6px 0 12px;font-size:34px;line-height:1.15;letter-spacing:-.02em}
.wl h2{margin:6px 0 10px;font-size:26px;line-height:1.2;letter-spacing:-.01em;text-transform:none;color:var(--fg)}
.wl-lead{margin:0 auto;max-width:60ch;font-size:15px;line-height:1.7;color:var(--muted)}
.wl-lead b{color:var(--fg);font-weight:600}
.wl-name{margin:14px auto 0;max-width:60ch;font-size:13px;font-style:italic;color:var(--muted)}
.wl-dia{margin-top:22px;padding:18px;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--panel)}
.wl-dia>svg{display:block;width:100%;height:auto;stroke:none}
.wl-dia>.tall{display:none}
.wl-dia .chip rect{fill:var(--surface-2);stroke:var(--line-2,var(--line))}
.wl-dia .chip text{fill:var(--fg);font:600 12.5px system-ui,-apple-system,'Segoe UI',sans-serif}
.wl-dia .grp{fill:var(--muted);font:700 10.5px system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.08em}
.wl-dia .wire{fill:none;stroke:var(--accent);stroke-opacity:.55;stroke-width:1.5;stroke-dasharray:4 5;animation:wl-flow 1.4s linear infinite}
.wl-dia .wire.out{stroke:var(--accent-2,var(--accent))}
@keyframes wl-flow{to{stroke-dashoffset:-18}}
.wl-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:22px}
.wl-card{padding:16px;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--panel)}
.wl-card .i{width:20px;height:20px;color:var(--accent)}
.wl-card b{display:block;margin:10px 0 4px;font-size:14px;color:var(--fg)}
.wl-card span{font-size:12.5px;line-height:1.55;color:var(--muted)}
button.wl-card{text-align:left;cursor:pointer;color:inherit;font:inherit;transition:border-color .15s,transform .15s}
button.wl-card:hover,button.wl-card:focus-visible{border-color:var(--accent);transform:translateY(-1px)}
.wl-go{grid-template-columns:repeat(3,minmax(0,1fr))}
.wl-where{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:20px}
.wl-where code{font-family:var(--mono);font-size:12px;padding:5px 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface-2);color:var(--fg)}
.wl-note{margin-top:18px;text-align:center;font-size:12px;color:var(--muted)}
.wl-foot{flex:none;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;
  padding:14px max(16px,calc((100% - 820px) / 2)) max(14px,env(safe-area-inset-bottom));border-top:1px solid var(--line);background:var(--bg)}
.wl-foot .wl-back{justify-self:start}
.wl-foot .wl-next{justify-self:end;min-width:120px;justify-content:center}
.wl-foot .wl-back[hidden]{display:inline-flex;visibility:hidden}
.wl-dots{display:flex;gap:7px}
.wl-dots i{width:7px;height:7px;border-radius:50%;background:var(--line-2,var(--line));transition:background .2s,width .2s}
.wl-dots i.on{width:20px;border-radius:4px;background:var(--accent)}
@media (max-width:600px){
  .wl-step{padding:10px 16px 22px}
  .wl-hero .wl-big{width:72px;height:72px;margin-bottom:12px}
  .wl h1{font-size:26px}
  .wl h2{font-size:21px}
  .wl-lead{font-size:14px}
  .wl-dia{padding:10px}
  .wl-dia>.wide{display:none}
  .wl-dia>.tall{display:block}
  .wl-grid,.wl-go{grid-template-columns:1fr}
  .wl-foot .wl-next{min-width:0}}
@media (prefers-reduced-motion:reduce){.wl{transition:none}.wl-dia .wire,.wl-step.in{animation:none}}
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
        return `<path class="wire" d="M${x0} ${y0}C${x0 + 70} ${y0} ${x1 - 70} ${cy} ${x1} ${cy}"/>`;
      })
      .join('') +
    right
      .map((c) => {
        const x0 = cx + T / 2;
        const y1 = c.y + CH / 2;
        return `<path class="wire out" d="M${x0} ${cy}C${x0 + 70} ${cy} ${c.x - 70} ${y1} ${c.x} ${y1}"/>`;
      })
      .join('');
  return `<svg class="wide" viewBox="0 0 ${W} ${H}" role="img" aria-label="Claude, Cursor, ChatGPT and your own agent share one Memora, reachable from this computer, the local network or the internet">
    <text class="grp" x="14" y="18">YOUR AGENTS</text>
    <text class="grp" x="${W - 14}" y="44" text-anchor="end">REACH IT FROM</text>
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
    <text class="grp" x="14" y="14">YOUR AGENTS</text>
    <text class="grp" x="14" y="${H - 6}">REACH IT FROM</text>
    ${wires}${top.map(chip).join('')}${bottom.map(chip).join('')}
    <svg x="${cx - T / 2}" y="${cy - T / 2}" width="${T}" height="${T}" viewBox="1 1 22 22">${markInner()}</svg>
  </svg>`;
}

/** The mark's drawing without its outer <svg>, to nest inside the diagram. */
function markInner(): string {
  return markSvg('').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

const card = (ico: string, title: string, text: string): string =>
  `<div class="wl-card">${icon(ico)}<b>${title}</b><span>${text}</span></div>`;

/** The steps, in order. The last one holds the ways to start. */
function stepsHTML(): string[] {
  return [
    `<div class="wl-hero">${markSvg('wl-big')}
      <div class="wl-eyebrow">Welcome to Memora</div>
      <h1>${BRAND_MOTTO}</h1>
      <p class="wl-lead">${BRAND_DESC}</p>
      <p class="wl-name">${BRAND_NAME}</p></div>`,
    `<div class="wl-hero"><div class="wl-eyebrow">Why Memora</div>
      <h2>Set up once. Use it everywhere.</h2>
      <p class="wl-lead">Every agent usually starts from zero: the same instructions pasted into Claude, the same skills set
        up again in Cursor, the same background handed to ChatGPT and to your own scripts. <b>Memora keeps it in one place.</b>
        Connect each agent once and they all read the same vault and write back to it, so what one learns, the others can use.</p></div>
      <div class="wl-dia">${wideDiagram()}${tallDiagram()}</div>`,
    `<div class="wl-hero"><div class="wl-eyebrow">Your server, your reach</div>
      <h2>Reachable from anywhere</h2>
      <p class="wl-lead">Run Memora on your laptop, a home server or a VPS. Use it on the local network, or forward it to the
        internet through a tunnel or a reverse proxy. Agents connect over <b>MCP</b> with their own key; you sign in from any
        browser, desktop or phone.</p>
      <div class="wl-where"><code>localhost</code><code>LAN</code><code>Cloudflare Tunnel</code><code>Tailscale</code><code>ngrok</code><code>nginx / Caddy</code></div></div>`,
    `<div class="wl-hero"><div class="wl-eyebrow">What's inside</div>
      <h2>Everything in one vault</h2></div>
      <div class="wl-grid">
        ${card('note', 'Vault', 'Your notes stay plain Markdown files in a folder you choose. Nothing is locked in.')}
        ${card('brain', 'Brain, Graph, Canvas', 'See how every note connects: in 3D, as a graph, or laid out on a board.')}
        ${card('key', 'Agents & keys', 'One key per agent, with its own permissions. Revoke any of them at any time.')}
        ${card('activity', 'Activity', 'Every read and write by an agent shows up live, so you always know who did what.')}
      </div>`,
    `<div class="wl-hero"><div class="wl-eyebrow">You're all set</div>
      <h2>Where would you like to start?</h2></div>
      <div class="wl-grid wl-go">
        <button type="button" class="wl-card" data-wl="new">${icon('plus')}<b>Write your first node</b><span>A note in Markdown. Link notes with [[wikilinks]].</span></button>
        <button type="button" class="wl-card" data-wl="keys">${icon('key')}<b>Connect an agent</b><span>Create a key for Claude, Cursor or any MCP app.</span></button>
        <button type="button" class="wl-card" data-wl="brain">${icon('brain')}<b>Open the brain</b><span>Watch your notes and agents light up live.</span></button>
      </div>
      <p class="wl-note">Open this again any time from the profile menu: Welcome to Memora.</p>`,
  ];
}

function pageHTML(steps: string[]): string {
  return `<div class="wl-bar">${markSvg('wl-mk')}<b>Memora</b><span class="grow"></span>
      <button type="button" class="wl-skip" data-wl="close">Skip</button></div>
    <div class="wl-body">${steps.map((h, i) => `<section class="wl-step" data-step="${i}"${i ? ' hidden' : ''}>${h}</section>`).join('')}</div>
    <div class="wl-foot">
      <button type="button" class="btn ghost wl-back" hidden>Back</button>
      <div class="wl-dots" aria-hidden="true">${steps.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</div>
      <button type="button" class="btn primary wl-next">Next ${icon('arrow')}</button>
    </div>`;
}

let open: HTMLElement | null = null;

/** Show the welcome page and remember that it was seen. */
export function openWelcome(): void {
  if (open) return;
  useStyles('welcome-css', CSS);
  const root = document.createElement('div');
  root.className = 'wl';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Welcome to Memora');
  const steps = stepsHTML();
  root.innerHTML = pageHTML(steps);
  document.body.appendChild(root);
  open = root;
  // Opened from somewhere in the app: /welcome gets its own history entry and
  // closing returns to that page. Opened at /welcome: closing lands on Overview.
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
  const dots = [...root.querySelectorAll<HTMLElement>('.wl-dots i')];
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
    dots.forEach((d, k) => d.classList.toggle('on', k === at));
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
    /* No answer: better to skip it than to show it on every load. */
  }
}
