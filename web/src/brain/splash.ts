// Boot splash: the Memora "M" mark dissolves into glowing grains that
// re-form as the particle brain, which keeps turning until the app is ready;
// then the overlay fades into the real brain view. One continuous loading
// animation. 2D canvas only (no WebGL). A click, tap or key skips the morph.
// Reduced motion: the static mark until ready, then a quick fade.

import { markSvg } from '../brand';
import { useStyles } from '../dom';
import { HOME_DIR, HOME_FOV_DEG, HOME_TARGET, homeDistance, type BrainView, type V3 } from './home-view';
import { sampleShell } from './shape';

const CSS = `
.msplash{position:absolute;inset:0;z-index:9999;display:grid;place-items:center;background:var(--bg,#0b0e14);
  transition:opacity .45s ease;cursor:pointer;overflow:hidden}
.msplash.fixed{position:fixed}
.msplash.out{opacity:0;pointer-events:none}
.msplash canvas{position:absolute;inset:0;width:100%;height:100%}
.msplash .ms-by{position:absolute;left:0;right:0;text-align:center;font:700 11px/1 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.22em;text-indent:.22em;text-transform:uppercase;color:var(--muted,#8b98ad)}
.msplash .ms-word{position:absolute;left:0;right:0;text-align:center;font:700 36px/1 'Memora Script','Segoe Script',cursive;letter-spacing:0;
  color:var(--fg,#e6e9ef)}
.msplash .ms-mark{width:min(30vmin,180px);height:auto}
.msplash .ms-msg{position:absolute;left:0;right:0;bottom:max(40px,9vh);text-align:center;font:500 13px/1 system-ui,-apple-system,'Segoe UI',sans-serif;
  color:var(--muted,#8b98ad);opacity:0;transition:opacity .45s ease .25s}
.msplash .ms-msg.on{opacity:1}
`;

const DARK = ['#5eead4', '#7dd3fc', '#a78bfa', '#f472b6', '#93c5fd', '#67e8f9'];
const LIGHT = ['#0d9488', '#0369a1', '#6d28d9', '#be185d', '#1d4ed8', '#0e7490'];

/** Points on the 24x24 brand mark: frame outline, M edges, note dots. */
function markPoints(n: number, r: () => number): [number, number][] {
  const out: [number, number][] = [];
  const poly: [number, number][] = [
    [7.2, 16.8],
    [7.2, 7.4],
    [12, 12.5],
    [16.8, 7.4],
    [16.8, 16.8],
  ];
  const segLen = poly.slice(1).map((p, i) => Math.hypot(p[0] - poly[i][0], p[1] - poly[i][1]));
  const total = segLen.reduce((a, b) => a + b, 0);
  const dots: [number, number, number][] = [
    [7.2, 16.8, 1.7],
    [7.2, 7.4, 1.7],
    [16.8, 7.4, 1.7],
    [16.8, 16.8, 1.7],
    [12, 12.5, 2],
  ];
  for (let k = 0; k < n; k++) {
    const pick = r();
    if (pick < 0.38) {
      // Rounded frame outline.
      const t = r() * 4;
      const side = Math.floor(t);
      const u = t - side;
      const lo = 1.5;
      const hi = 22.5;
      const rx = 6.2;
      let x: number;
      let y: number;
      if (u < 0.2 || u > 0.8) {
        // Corner arc.
        const corner = u < 0.2 ? side : (side + 1) % 4;
        const a0 = [Math.PI, 1.5 * Math.PI, 0, 0.5 * Math.PI][corner];
        const a = a0 + r() * (Math.PI / 2);
        const cx = corner === 0 || corner === 3 ? lo + rx : hi - rx;
        const cy = corner === 0 || corner === 1 ? lo + rx : hi - rx;
        x = cx + Math.cos(a) * rx;
        y = cy + Math.sin(a) * rx;
      } else {
        const v = lo + rx + (u - 0.2) / 0.6 * (hi - lo - 2 * rx);
        x = side === 0 ? lo : side === 2 ? hi : v;
        y = side === 1 ? lo : side === 3 ? hi : v;
      }
      out.push([x + (r() - 0.5) * 0.35, y + (r() - 0.5) * 0.35]);
    } else if (pick < 0.72) {
      let d = r() * total;
      let s = 0;
      while (s < segLen.length - 1 && d > segLen[s]) d -= segLen[s++];
      const f = d / segLen[s];
      const a = poly[s];
      const b = poly[s + 1];
      out.push([a[0] + (b[0] - a[0]) * f + (r() - 0.5) * 0.5, a[1] + (b[1] - a[1]) * f + (r() - 0.5) * 0.5]);
    } else {
      const d = dots[Math.floor(r() * dots.length)];
      const a = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * d[2];
      out.push([d[0] + Math.cos(a) * rr, d[1] + Math.sin(a) * rr]);
    }
  }
  return out;
}

function sprite(color: string, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.18, color);
  grd.addColorStop(0.45, color + '55');
  grd.addColorStop(1, color + '00');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/** A ready-to-use pinhole camera: basis vectors and the pixel focal length. */
interface Cam {
  e: V3;
  f: V3;
  r: V3;
  u: V3;
  k: number;
  cx: number;
  cy: number;
  dist: number;
}

/** The same projection three.js does for a PerspectiveCamera looking at the
 * target with +Y up, in page pixels. */
function camOf(v: BrainView): Cam {
  const [ex, ey, ez] = v.eye;
  let fx = v.target[0] - ex;
  let fy = v.target[1] - ey;
  let fz = v.target[2] - ez;
  const dist = Math.hypot(fx, fy, fz) || 1;
  fx /= dist;
  fy /= dist;
  fz /= dist;
  // right = forward x up(0,1,0); up = right x forward
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const u: V3 = [-rz * fy, rz * fx - rx * fz, rx * fy];
  return { e: v.eye, f: [fx, fy, fz], r: [rx, 0, rz], u, k: v.rect.h / 2 / Math.tan(v.fov / 2), cx: v.rect.x + v.rect.w / 2, cy: v.rect.y + v.rect.h / 2, dist };
}

/** Orbit form of a view around its target, so two views blend by turning the
 * camera (true 3D) instead of sliding pixels. */
function orbitOf(v: BrainView): { th: number; ph: number; d: number } {
  const x = v.eye[0] - v.target[0];
  const y = v.eye[1] - v.target[1];
  const z = v.eye[2] - v.target[2];
  const d = Math.hypot(x, y, z) || 1;
  return { th: Math.atan2(x, z), ph: Math.acos(Math.max(-1, Math.min(1, y / d))), d };
}

function viewAt(target: V3, th: number, ph: number, d: number, fov: number, rect: BrainView['rect']): BrainView {
  const s = Math.sin(ph) * d;
  return { eye: [target[0] + s * Math.sin(th), target[1] + Math.cos(ph) * d, target[2] + s * Math.cos(th)], target, fov, rect };
}

function mixView(a: BrainView, b: BrainView, k: number): BrainView {
  const oa = orbitOf(a);
  const ob = orbitOf(b);
  let dth = ob.th - oa.th;
  dth -= Math.round(dth / (Math.PI * 2)) * Math.PI * 2; // the short way round
  const l = (p: number, q: number): number => p + (q - p) * k;
  const t: V3 = [l(a.target[0], b.target[0]), l(a.target[1], b.target[1]), l(a.target[2], b.target[2])];
  const rect = { x: l(a.rect.x, b.rect.x), y: l(a.rect.y, b.rect.y), w: l(a.rect.w, b.rect.w), h: l(a.rect.h, b.rect.h) };
  return viewAt(t, oa.th + dth * k, l(oa.ph, ob.ph), l(oa.d, ob.d), l(a.fov, b.fov), rect);
}

/** Autorotate speed of the live view (OrbitControls 0.55 = 0.0576 rad/s), so
 * the splash brain turns exactly like the brain it hands over to. */
const DRIFT = ((Math.PI * 2) / 60) * 0.55;

/** Show a line (e.g. "Welcome, owner") under the particle splash. */
export function greetSplash(text: string): void {
  const msg = document.querySelector<HTMLElement>('.msplash .ms-msg');
  if (!msg) return;
  msg.textContent = text;
  msg.classList.add('on');
}

export function playSplash(
  el: HTMLElement,
  ready: Promise<unknown> = Promise.resolve(),
  target?: () => BrainView | null,
  onLand?: () => void,
  /** false: the M bursts apart and the app shows (any page but the 3D brain). */
  brain = true,
): Promise<void> {
  return new Promise<void>((resolve) => {
    useStyles('msplash-css', CSS);
    const light = document.documentElement.dataset.theme === 'light';
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const wrap = document.createElement('div');
    wrap.className = 'msplash';
    wrap.setAttribute('role', 'presentation');
    if (el === document.body || el === document.documentElement || getComputedStyle(el).position === 'static') {
      wrap.classList.add('fixed');
    }
    el.appendChild(wrap);
    // Filled by greetSplash() once the session is known.
    const msg = document.createElement('div');
    msg.className = 'ms-msg';
    msg.setAttribute('role', 'status');
    wrap.appendChild(msg);
    // See-through at first so the host's static mark can crossfade into the
    // grains; the backdrop returns once that is done.
    wrap.style.background = 'transparent';
    window.setTimeout(() => {
      if (!wrap.style.transition) wrap.style.background = ''; // unless the hand-off already began
    }, 500);

    const T_MORPH0 = 0.45;
    const T_MORPH = 1.25;
    const T_END = 2.25;
    let start = performance.now();
    let done = false;
    let raf = 0;
    let isReady = false;
    let wantFinish = false;
    void ready.finally(() => {
      isReady = true;
      if (reduced || (wantFinish && !target)) finish();
    });
    const finish = (): void => {
      if (done) return;
      done = true;
      onLand?.();
      cancelAnimationFrame(raf);
      wrap.classList.add('out');
      window.removeEventListener('keydown', skip);
      window.setTimeout(() => {
        wrap.remove();
        resolve();
      }, reduced ? 220 : 460);
    };
    // Skipping jumps straight to the brain; the overlay still waits for the app.
    const skip = (): void => {
      start = Math.min(start, performance.now() - T_END * 1000);
    };
    wrap.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    const cleanup = (): void => window.removeEventListener('keydown', skip);
    void ready.finally(cleanup);

    if (reduced) {
      wrap.insertAdjacentHTML('afterbegin', markSvg('ms-mark'));
      return;
    }

    const cv = document.createElement('canvas');
    const word = document.createElement('div');
    word.className = 'ms-word';
    word.textContent = 'Memora';
    const by = document.createElement('div');
    by.className = 'ms-by';
    by.textContent = 'by Codrihub Tech';
    wrap.prepend(cv, word, by);
    const ctx = cv.getContext('2d');
    if (!ctx) {
      finish();
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    const size = (): void => {
      w = wrap.clientWidth || window.innerWidth;
      h = wrap.clientHeight || window.innerHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    };
    size();

    const N = w * h < 500_000 ? 1500 : 2600;
    let seed = 42;
    const r = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const palette = light ? LIGHT : DARK;
    const sprites = palette.map((c) => sprite(c, 32));
    const shell = sampleShell(N, 11);
    const count = Math.min(N, shell.count);
    const mark = markPoints(count, r);
    // Pair grains so the morph sweeps rather than scrambles: sort both by angle.
    const ang = (x: number, y: number): number => Math.atan2(y, x);
    const markIdx = mark.map((_, i) => i).sort((a, b) => ang(mark[a][0] - 12, mark[a][1] - 12) - ang(mark[b][0] - 12, mark[b][1] - 12));
    const brainIdx = Array.from({ length: count }, (_, i) => i).sort(
      (a, b) => ang(shell.pos[a * 3 + 2], -shell.pos[a * 3 + 1]) - ang(shell.pos[b * 3 + 2], -shell.pos[b * 3 + 1]),
    );
    const grains = markIdx.map((mi, k) => {
      const bi = brainIdx[k];
      const y = shell.pos[bi * 3 + 1];
      return {
        mx: mark[mi][0],
        my: mark[mi][1],
        bx: shell.pos[bi * 3],
        by: y,
        bz: shell.pos[bi * 3 + 2],
        nx: shell.nrm[bi * 3],
        ny: shell.nrm[bi * 3 + 1],
        nz: shell.nrm[bi * 3 + 2],
        shade: shell.shade[bi],
        spr: r() < 0.7 ? (y > 0.1 ? 0 : 1) : Math.floor(r() * sprites.length),
        delay: r() * 0.35,
        jit: r() * Math.PI * 2,
      };
    });

    // Hand-off: every grain flies to where the same brain point sits in the
    // live 3D view, while the backdrop fades and the app appears around it.
    const FLY = 1.1;
    let fly: { t0: number; from: BrainView } | null = null;
    let waitSince = 0;
    // The splash camera: the live view's home angle, turned a little further
    // round while the brain forms and easing into it, then drifting on like
    // the autorotate. The rect is the whole splash until the hand-off.
    const homeOrbit = orbitOf({ eye: HOME_DIR, target: HOME_TARGET, fov: 0, rect: { x: 0, y: 0, w: 1, h: 1 } });
    const SPIN = 0.9;
    const splashView = (t: number): BrainView => {
      const box = wrap.getBoundingClientRect();
      const rect = { x: box.left, y: box.top, w: w, h: h };
      const formed = clamp01((t - T_MORPH0) / (T_END - T_MORPH0));
      const spin = SPIN * Math.pow(1 - formed, 3) - Math.max(0, t - T_END) * DRIFT;
      return viewAt(HOME_TARGET, homeOrbit.th + spin, homeOrbit.ph, homeDistance(w / h), (HOME_FOV_DEG * Math.PI) / 180, rect);
    };
    const startFly = (now: number, t: number): void => {
      fly = { t0: now, from: splashView(t) };
      // The greeting leaves with the hand-off to the live brain.
      msg.style.transition = `opacity ${FLY * 0.8}s ease`;
      msg.classList.remove('on');
      wrap.style.transition = 'background-color .8s ease';
      wrap.style.backgroundColor = 'transparent';
    };
    // One brain grain through a camera: page x, y, perspective, how near it is
    // (0..1) and its rim (1 where the surface turns away, as the live shader).
    type G = { bx: number; by: number; bz: number; nx: number; ny: number; nz: number };
    const put = (c: Cam, g: G): [number, number, number, number, number] => {
      const dx = g.bx - c.e[0];
      const dy = g.by - c.e[1];
      const dz = g.bz - c.e[2];
      const zc = dx * c.f[0] + dy * c.f[1] + dz * c.f[2] || 1e-3;
      const xc = dx * c.r[0] + dz * c.r[2];
      const yc = dx * c.u[0] + dy * c.u[1] + dz * c.u[2];
      const persp = c.dist / zc;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const rim = 1 - Math.abs((g.nx * dx + g.ny * dy + g.nz * dz) / dl);
      return [c.cx + (xc / zc) * c.k, c.cy - (yc / zc) * c.k, persp, 0.55 + 0.45 * clamp01(0.5 - (zc - c.dist) * 0.6), rim];
    };
    const drawFly = (now: number): void => {
      const f = fly!;
      const e = (now - f.t0) / 1000;
      const live = target?.();
      const k = ease(clamp01(e / FLY));
      const v = live ? mixView(f.from, live, k) : f.from;
      const c = camOf(v);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = light ? 'source-over' : 'lighter';
      // Same brain, same angle: the live view fades in under the grains as the
      // camera arrives, and only once it is fully there do the grains dissolve
      // into it (both fading at once would dip through a dim frame).
      const fade = 1 - clamp01((e - FLY - 0.15) / 0.45);
      if (e >= FLY * 0.7 && onLand) {
        onLand();
        onLand = undefined;
      }
      const box = wrap.getBoundingClientRect();
      const scale = c.k / camOf(f.from).k;
      for (let i = 0; i < grains.length; i++) {
        const g = grains[i];
        const [x, y, persp, depth, rim] = put(c, g);
        // Grains take on the live shell's look as they arrive: small points,
        // bright where the cortex turns away (its rim light), dim face-on.
        const from = depth * (0.35 + 0.65 * g.shade) * (0.7 + 0.5 * rim);
        // (brighter than the shader: a tenth as many grains carry the shape)
        const to = Math.min(1, (0.3 + Math.pow(rim, 2.6) * 0.9) * g.shade * g.shade * 1.6);
        const sz = ((4 + 3 * depth) * (1 - k) + 2.2 * k) * persp * (1 + (scale - 1) * 0.6);
        ctx.globalAlpha = Math.min(1, (from + (to - from) * k) * fade);
        ctx.drawImage(sprites[g.spr], x - box.left - sz / 2, y - box.top - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
      if (fade <= 0) {
        finish();
        return;
      }
      raf = requestAnimationFrame(draw);
    };
    start = performance.now();
    const draw = (now: number): void => {
      if (done) return;
      if (fly) {
        drawFly(now);
        return;
      }
      if (wrap.clientWidth !== w || wrap.clientHeight !== h) size();
      const t = (now - start) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = light ? 'source-over' : 'lighter';
      const m = Math.min(w, h);
      const logoS = (m * 0.3) / 19;
      const cx = w / 2;
      const cy = h / 2 - m * 0.02;
      // The brain through the same camera the live view opens with.
      const cam = camOf(splashView(t));
      const box = wrap.getBoundingClientRect();
      const appear = clamp01(t / 0.4);
      word.style.opacity = String(clamp01(1 - (t - T_MORPH0) / 0.5) * appear);
      word.style.top = cy + m * 0.2 + 'px';
      by.style.top = cy + m * 0.2 + 46 + 'px';
      by.style.opacity = word.style.opacity;
      if (!brain) {
        // Not opening on the brain: the M bursts apart and fades, and the page
        // shows as soon as it is ready. The name and the greeting leave with
        // the burst instead of lingering until the end.
        const away = clamp01((t - T_MORPH0 + 0.1) / 0.25);
        word.style.opacity = String(appear * (1 - away));
        by.style.opacity = word.style.opacity;
        if (away > 0 && msg.classList.contains('on')) {
          msg.style.transition = 'opacity .25s ease';
          msg.classList.remove('on');
        }
        for (let gi = 0; gi < grains.length; gi++) {
          const g = grains[gi];
          const kb = clamp01((t - T_MORPH0 - g.delay * 0.6) / 0.7);
          const e = 1 - Math.pow(1 - kb, 3);
          const ox = g.mx - 12;
          const oy = g.my - 12;
          const ol = Math.hypot(ox, oy) || 1;
          const a = Math.atan2(oy, ox) + (Math.sin(g.jit) * 0.5) * e;
          const d = e * m * (0.25 + 0.3 * Math.abs(Math.cos(g.jit)));
          const x = cx + ox * logoS + Math.cos(a) * d * (ol > 0.5 ? 1 : 0.6);
          const y = cy + oy * logoS + Math.sin(a) * d * (ol > 0.5 ? 1 : 0.6);
          const sz = 7 * (1 - 0.45 * kb);
          ctx.globalAlpha = Math.min(1, appear * (1 - kb));
          ctx.drawImage(sprites[g.spr], x - sz / 2, y - sz / 2, sz, sz);
        }
        ctx.globalAlpha = 1;
        if (t >= T_MORPH0 + 0.7) {
          wantFinish = true;
          if (isReady) {
            finish();
            return;
          }
        }
        raf = requestAnimationFrame(draw);
        return;
      }
      for (let gi = 0; gi < grains.length; gi++) {
        const g = grains[gi];
        const k = ease(clamp01((t - T_MORPH0 - g.delay) / T_MORPH));
        const [px, py, persp, depth, rim] = put(cam, g);
        const bx = px - box.left;
        const by = py - box.top;
        const wob = (1 - k) * 0.6;
        const mx = cx + (g.mx - 12) * logoS + Math.sin(t * 3 + g.jit) * wob;
        const my = cy + (g.my - 12) * logoS + Math.cos(t * 2.6 + g.jit) * wob;
        // Mid-flight the grains bulge outward, like a breath.
        const bulge = Math.sin(k * Math.PI) * m * 0.05;
        const dx = bx - cx;
        const dy = by - cy;
        const dl = Math.hypot(dx, dy) || 1;
        const x = mx + (bx - mx) * k + (dx / dl) * bulge;
        const y = my + (by - my) * k + (dy / dl) * bulge;
        const alpha = appear * (1 - k + k * depth * (0.35 + 0.65 * g.shade) * (0.7 + 0.5 * rim));
        const sz = (1 - k) * 7 + k * (4 + 3 * depth) * persp;
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.drawImage(sprites[g.spr], x - sz / 2, y - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
      if (t >= T_END) {
        wantFinish = true;
        if (isReady) {
          // Fly into the live brain view when it is on screen; otherwise
          // (another page, no WebGL) just fade out after a short wait.
          if (target?.()) {
            startFly(now, t);
            raf = requestAnimationFrame(draw);
            return;
          }
          if (!waitSince) waitSince = now;
          if (!target || now - waitSince > 800) {
            finish();
            return;
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
  });
}
