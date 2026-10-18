// Agents fly between the header pill and the open view: when one wakes up, a
// glowing orb in its color leaves the robot in the pill and arcs to what it
// touches (a note in the brain, a node in the graph, a card on the canvas, the
// middle of any other page); when it goes idle, the orb flies home to the moon.

import { esc, useStyles } from '../dom';
import { agentColor, agentInitials, avatarHTML } from '../control/agents';
import { state } from '../state';

/** Where an agent shows on the open view, in client pixels; null when unknown. */
export type FlightTarget = (actor: string, id: string | undefined, paths: string[]) => { x: number; y: number } | null;

export interface Flyer {
  actor: string;
  id?: string;
  paths: string[];
}

const CSS = `
.af-layer{position:fixed;inset:0;pointer-events:none;z-index:85;overflow:hidden}
.af-orb{position:absolute;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;display:grid;place-items:center;
  font:800 9px/1 system-ui,sans-serif;color:#0b0e14;will-change:transform,opacity;
  background:radial-gradient(circle at 32% 28%,rgba(255,255,255,.8),rgba(255,255,255,0) 45%),var(--c);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 30%,transparent),0 0 18px 4px color-mix(in srgb,var(--c) 70%,transparent)}
.af-dot{position:absolute;left:0;top:0;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:var(--c);
  box-shadow:0 0 8px var(--c);animation:af-fade .55s ease-out forwards}
@keyframes af-fade{to{opacity:0;transform:var(--t) scale(.2)}}
.rt.af-glow{animation:af-glow 1.3s ease-out}
@keyframes af-glow{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--afc) 70%,transparent)}35%{box-shadow:0 0 0 6px color-mix(in srgb,var(--afc) 35%,transparent),0 0 26px 4px color-mix(in srgb,var(--afc) 55%,transparent);border-color:var(--afc)}100%{box-shadow:0 0 0 14px transparent}}
.af-note{position:fixed;z-index:86;display:flex;align-items:center;gap:9px;padding:6px 12px 6px 6px;border-radius:99px;pointer-events:none;
  background:var(--glass-strong,var(--panel));border:1px solid color-mix(in srgb,var(--c) 45%,var(--line));color:var(--fg);font-size:12.5px;font-weight:600;
  box-shadow:0 10px 30px -10px color-mix(in srgb,var(--c) 55%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  transform-origin:top right;animation:af-note 2.6s cubic-bezier(.2,.8,.2,1) forwards}
.af-note.sleep .ag-av{filter:saturate(.6);opacity:.85}
.af-note small{color:var(--muted);font-weight:500}
@keyframes af-note{0%{opacity:0;transform:translateY(-10px) scale(.6)}12%{opacity:1;transform:translateY(0) scale(1.04)}18%{transform:scale(1)}82%{opacity:1;transform:none}100%{opacity:0;transform:translateY(-6px) scale(.9)}}
.af-ring{position:absolute;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:2px solid var(--c);
  box-shadow:0 0 14px var(--c);animation:af-ring .75s ease-out forwards}
@keyframes af-ring{from{opacity:.95;transform:var(--t) scale(.4)}to{opacity:0;transform:var(--t) scale(3.4)}}
`;

const targets = new Map<string, FlightTarget>();
/** Where each agent last landed, so it can fly home from there. */
const landed = new Map<string, { x: number; y: number }>();
let flying = 0;
const MAX_FLIGHTS = 6;

/** Register (or clear with null) how the given page locates an agent. */
export function setFlightTarget(page: string, fn: FlightTarget | null): void {
  if (fn) targets.set(page, fn);
  else targets.delete(page);
}

function layer(): HTMLElement {
  useStyles('af-css', CSS);
  let l = document.getElementById('afLayer');
  if (!l) {
    l = document.createElement('div');
    l.id = 'afLayer';
    l.className = 'af-layer';
    l.setAttribute('aria-hidden', 'true');
    document.body.appendChild(l);
  }
  return l;
}

function center(el: Element | null): { x: number; y: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** The open view's point for the agent, when it knows one on screen. */
function targetPoint(f: Flyer): { x: number; y: number } | null {
  const fn = targets.get(state.page);
  const p = fn?.(f.actor, f.id, f.paths) || null;
  return p && p.x >= 0 && p.y >= 0 && p.x <= innerWidth && p.y <= innerHeight ? p : null;
}

/** The middle of the main area. */
function mainPoint(): { x: number; y: number } {
  const main = document.getElementById('main')?.getBoundingClientRect();
  return main ? { x: main.left + main.width / 2, y: main.top + main.height * 0.45 } : { x: innerWidth / 2, y: innerHeight / 2 };
}

const reduced = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function fly(from: { x: number; y: number }, to: { x: number; y: number }, f: Flyer, ring: 'end' | 'start', done?: () => void): void {
  if (reduced() || document.hidden || flying >= MAX_FLIGHTS) return;
  flying++;
  const l = layer();
  const color = agentColor(f.actor, f.id);
  const orb = document.createElement('div');
  orb.className = 'af-orb';
  orb.style.setProperty('--c', color);
  orb.textContent = agentInitials(f.actor);
  l.appendChild(orb);
  // A curve that bows away from the straight line, toward the top of the screen.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(220, len * 0.35);
  const c = { x: (from.x + to.x) / 2 - (dy / len) * bow * Math.sign(dx || 1), y: Math.min(from.y, to.y) - bow * 0.4 };
  const dur = Math.min(1300, 650 + len * 0.6);
  const ripple = (p: { x: number; y: number }): void => {
    const r = document.createElement('div');
    r.className = 'af-ring';
    r.style.setProperty('--c', color);
    r.style.setProperty('--t', `translate(${p.x}px,${p.y}px)`);
    r.style.transform = `translate(${p.x}px,${p.y}px)`;
    l.appendChild(r);
    window.setTimeout(() => r.remove(), 800);
  };
  if (ring === 'start') ripple(from);
  const t0 = performance.now();
  let lastDot = 0;
  const step = (now: number): void => {
    const t = Math.min(1, (now - t0) / dur);
    const k = ease(t);
    const u = 1 - k;
    const x = u * u * from.x + 2 * u * k * c.x + k * k * to.x;
    const y = u * u * from.y + 2 * u * k * c.y + k * k * to.y;
    const s = 0.7 + Math.sin(Math.PI * t) * 0.55;
    orb.style.transform = `translate(${x}px,${y}px) scale(${s})`;
    orb.style.opacity = String(t > 0.9 ? (1 - t) * 10 : Math.min(1, t * 6));
    if (now - lastDot > 28) {
      lastDot = now;
      const d = document.createElement('div');
      d.className = 'af-dot';
      d.style.setProperty('--c', color);
      d.style.setProperty('--t', `translate(${x}px,${y}px)`);
      d.style.transform = `translate(${x}px,${y}px)`;
      l.appendChild(d);
      window.setTimeout(() => d.remove(), 600);
    }
    if (t < 1) {
      requestAnimationFrame(step);
      return;
    }
    orb.remove();
    flying--;
    if (ring === 'end') ripple(to);
    done?.();
  };
  requestAnimationFrame(step);
}

const slot = (f: Flyer): string => f.id || f.actor;

let noteStack = 0;

/** Outside the brain pages: the pill glows in the agent's color and a small
 * card drops out of it, "claude-code is working" or "claude-code went idle". */
function badgeNotice(f: Flyer, kind: 'wake' | 'sleep'): void {
  if (reduced() || document.hidden) return;
  const pill = document.getElementById('rtPill');
  const r = pill?.getBoundingClientRect();
  if (!pill || !r || !r.width) return;
  layer();
  const color = agentColor(f.actor, f.id);
  pill.style.setProperty('--afc', color);
  pill.classList.remove('af-glow');
  void pill.offsetWidth;
  pill.classList.add('af-glow');
  const n = document.createElement('div');
  n.className = 'af-note ' + kind;
  n.style.setProperty('--c', color);
  n.style.top = r.bottom + 8 + noteStack * 40 + 'px';
  n.style.right = Math.max(8, innerWidth - r.right) + 'px';
  const what = kind === 'wake' ? (f.paths[0] ? `working on ${f.paths[0].split('/').pop()!.replace(/\.md$/i, '')}` : 'is working') : 'went idle';
  n.innerHTML = `${avatarHTML(f.actor, 24, kind === 'wake' ? 'live' : '', f.id)}<span>${esc(f.actor)} <small>${esc(what)}</small></span>`;
  document.body.appendChild(n);
  noteStack++;
  window.setTimeout(() => {
    n.remove();
    noteStack = Math.max(0, noteStack - 1);
  }, 2700);
}

/** Pages with a map to fly onto (the brain draws its own agents coming in). */
const FLY_PAGES = new Set(['graph', 'canvas']);

/** An agent woke up: from the robot in the pill to what it is working on. */
export function flyIn(f: Flyer): void {
  if (state.page === 'brain') return;
  if (!FLY_PAGES.has(state.page)) {
    badgeNotice(f, 'wake');
    return;
  }
  const from = center(document.querySelector('#rtAgents .i')) || center(document.getElementById('rtPill'));
  if (!from) return;
  // Let the view take in the activity first (the brain places the agent).
  window.setTimeout(() => {
    const to = targetPoint(f) || mainPoint();
    landed.set(slot(f), to);
    fly(from, to, f, 'end');
  }, 120);
}

/** An agent went idle: from where it was back home to the moon in the pill. */
export function flyHome(f: Flyer): void {
  if (state.page === 'brain') return;
  if (!FLY_PAGES.has(state.page)) {
    landed.delete(slot(f));
    badgeNotice(f, 'sleep');
    return;
  }
  const to = center(document.querySelector('#rtIdle .i')) || center(document.getElementById('rtPill'));
  if (!to) return;
  const from = targetPoint(f) || landed.get(slot(f)) || mainPoint();
  landed.delete(slot(f));
  fly(from, to, f, 'start');
}
