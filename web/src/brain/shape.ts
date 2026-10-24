// Implicit brain volume and deterministic samplers. Axes: x = left/right, y = up, z = front.

type Rng = () => number;
export type Vec3 = [number, number, number];

/** FNV-1a 32-bit string hash. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded PRNG. */
export function rng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: Rng): number {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

function h3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), l(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v),
    l(
      l(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u),
      l(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u),
      v,
    ),
    w,
  );
}

/** Sulcus strength 0..1 from ridged noise. */
function sulcus(x: number, y: number, z: number): number {
  const f = 5.2;
  const n1 = 1 - Math.abs(2 * vnoise(x * f + 11.3, y * f * 1.15, z * f) - 1);
  const n2 = 1 - Math.abs(2 * vnoise(x * f * 2.1, y * f * 2.1 + 5.1, z * f * 2.1 - 3.7) - 1);
  const r = Math.max(Math.pow(n1, 5), Math.pow(n2, 7) * 0.6);
  return Math.min(1, r * 1.25);
}

interface Ellipsoid {
  c: Vec3;
  a: Vec3;
}

const CEREBRUM: Ellipsoid = { c: [0.4, 0.06, 0], a: [0.52, 0.62, 1.0] };
const TEMPORAL: Ellipsoid = { c: [0.52, -0.27, 0.14], a: [0.3, 0.25, 0.56] };
const CEREBELLUM: Ellipsoid = { c: [0.25, -0.44, -0.66], a: [0.3, 0.2, 0.3] };

/** 1 = on the surface. */
function q(e: Ellipsoid, x: number, y: number, z: number): number {
  // Frontal taper and a flatter base give the cerebrum its outline.
  const taper = 1 - 0.1 * Math.max(0, z);
  const dx = (x - e.c[0]) / (e.a[0] * taper);
  let dy = (y - e.c[1]) / (e.a[1] * taper);
  if (dy < 0 && e === CEREBRUM) dy *= 1.35;
  const dz = (z - e.c[2]) / e.a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Mirrored in x. */
function cerebralQ(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  if (ax < 0.035) return 9; // longitudinal fissure
  return Math.min(q(CEREBRUM, ax, y, z), q(TEMPORAL, ax, y, z));
}

function cerebellumQ(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  if (ax < 0.02) return 9;
  return q(CEREBELLUM, ax, y, z);
}

function inside(x: number, y: number, z: number, depth = 0.9): boolean {
  return cerebralQ(x, y, z) < depth || cerebellumQ(x, y, z) < depth * 0.9;
}

interface ShellSample {
  pos: Float32Array;
  /** Approximate outward normals. */
  nrm: Float32Array;
  /** 0..1, dark in sulci. */
  shade: Float32Array;
  count: number;
}

export function sampleShell(n: number, seed = 7): ShellSample {
  const r = rng(seed);
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const shade = new Float32Array(n);
  let k = 0;
  let guard = n * 60;
  while (k < n && guard-- > 0) {
    const pick = r();
    // Rough share of surface: cerebrum 78%, temporal 12%, cerebellum 7%, stem 3%.
    let e: Ellipsoid = CEREBRUM;
    let kind = 0;
    if (pick < 0.78) e = CEREBRUM;
    else if (pick < 0.9) e = TEMPORAL;
    else if (pick < 0.97) {
      e = CEREBELLUM;
      kind = 1;
    } else kind = 2;

    let x: number;
    let y: number;
    let z: number;
    let nx: number;
    let ny: number;
    let nz: number;
    if (kind === 2) {
      // Brainstem: a short tilted cylinder.
      const t = r();
      const a = r() * Math.PI * 2;
      const rad = 0.1 - t * 0.025;
      nx = Math.cos(a);
      nz = Math.sin(a);
      ny = 0;
      x = nx * rad;
      y = -0.28 - t * 0.55;
      z = -0.28 - t * 0.12 + nz * rad;
      if (cerebralQ(x, y, z) < 1 || cerebellumQ(x, y, z) < 1) continue;
      pos.set([x, y, z], k * 3);
      nrm.set([nx, ny, nz], k * 3);
      shade[k] = 0.45 + 0.2 * r();
      k++;
      continue;
    }
    const u = r() * 2 - 1;
    const th = r() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const sign = r() < 0.5 ? -1 : 1;
    let dx = s * Math.cos(th);
    let dy = s * Math.sin(th);
    let dz = u;
    x = e.c[0] + dx * e.a[0];
    y = e.c[1] + dy * e.a[1];
    z = e.c[2] + dz * e.a[2];
    const qq = q(e, x, y, z);
    x = e.c[0] + (x - e.c[0]) / qq;
    y = e.c[1] + (y - e.c[1]) / qq;
    z = e.c[2] + (z - e.c[2]) / qq;
    if (x < 0.035) continue;
    if (kind === 0) {
      const other = e === CEREBRUM ? q(TEMPORAL, x, y, z) : q(CEREBRUM, x, y, z);
      if (other < 0.985) continue;
    } else if (cerebralQ(x, y, z) < 1.0) continue;
    nx = (x - e.c[0]) / (e.a[0] * e.a[0]);
    ny = (y - e.c[1]) / (e.a[1] * e.a[1]);
    nz = (z - e.c[2]) / (e.a[2] * e.a[2]);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    let sh: number;
    let depth: number;
    if (kind === 1) {
      const f = Math.abs(Math.sin(y * 70 + z * 12));
      sh = 0.35 + 0.65 * f;
      depth = (1 - f) * 0.018;
    } else {
      const sc = sulcus(x, y, z);
      if (sc > 0.55 && r() < 0.55) continue;
      sh = 1 - 0.9 * sc;
      depth = sc * 0.05;
    }
    x -= nx * depth;
    y -= ny * depth;
    z -= nz * depth;
    dx = x * sign;
    pos.set([dx, y, z], k * 3);
    nrm.set([nx * sign, ny, nz], k * 3);
    shade[k] = sh;
    k++;
  }
  return { pos, nrm, shade, count: k };
}

/** Farthest-point region anchors over both hemispheres. */
export function regionAnchors(count: number, seed = 3): Vec3[] {
  const r = rng(seed);
  const cand: Vec3[] = [];
  while (cand.length < 1800) {
    const x = (r() * 2 - 1) * 0.95;
    const y = (r() * 2 - 1) * 0.75;
    const z = (r() * 2 - 1) * 1.05;
    const qc = cerebralQ(x, y, z);
    if (qc > 0.42 && qc < 0.72) cand.push([x, y, z]);
  }
  const out: Vec3[] = [];
  if (count <= 0) return out;
  // Start at the left frontal lobe so small vaults read well from the front.
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < cand.length; i++) {
    const s = cand[i][2] + cand[i][1] * 0.5 - Math.abs(cand[i][0]) * 0.2;
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  out.push(cand[best]);
  const dist = cand.map((c) => d2(c, cand[best]));
  while (out.length < count) {
    let bi = 0;
    let bd = -1;
    for (let i = 0; i < cand.length; i++) {
      if (dist[i] > bd) {
        bd = dist[i];
        bi = i;
      }
    }
    if (bd <= 0) {
      out.push(cand[(out.length * 37) % cand.length]);
      continue;
    }
    out.push(cand[bi]);
    for (let i = 0; i < cand.length; i++) dist[i] = Math.min(dist[i], d2(cand[i], cand[bi]));
  }
  return out;
}

function d2(a: Vec3, b: Vec3): number {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return x * x + y * y + z * z;
}

export function notePoint(path: string, anchor: Vec3, spread: number): Vec3 {
  const r = rng(hashStr(path));
  for (let tries = 0; tries < 40; tries++) {
    const s = spread * (1 + tries * 0.03);
    const x = anchor[0] + gauss(r) * s * 0.8;
    const y = anchor[1] + gauss(r) * s * 0.8;
    const z = anchor[2] + gauss(r) * s * 1.15;
    // Notes stay on the anchor's side of the fissure.
    if (Math.sign(x) !== Math.sign(anchor[0]) && Math.abs(anchor[0]) > 0.06) continue;
    if (inside(x, y, z, 0.9)) return [x, y, z];
  }
  return [anchor[0], anchor[1], anchor[2]];
}

export function regionSpread(n: number, regions: number): number {
  const base = 0.62 / Math.cbrt(Math.max(1, regions));
  return Math.min(0.3, Math.max(0.045, base * (0.22 + 0.12 * Math.cbrt(n))));
}
