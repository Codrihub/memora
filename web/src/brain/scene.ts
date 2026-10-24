// Owns every three.js object and disposes all of them in `dispose()`.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  LineSegments,
  Matrix4,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
  type Blending,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { agentColor, agentInitials } from '../control/agents';
import { agentSide, blockerBoxes, clearOf, labelBox, type Box, type LabelKind } from './label-avoid';
import { hexToRgb } from './palette';
import { hashStr, rng, sampleShell, type Vec3 } from './shape';
import { HOME_DIR, HOME_FOV_DEG, HOME_TARGET, homeDistance, type BrainView } from './home-view';

export interface ParticleSpec {
  key: string;
  target: Vec3;
  /** Where a new particle is born. */
  origin: Vec3;
  color: string;
  size: number;
}

export interface RegionLabel {
  name: string;
  anchor: Vec3;
  color: string;
  count: number;
}

interface SceneCallbacks {
  onHover: (index: number, x: number, y: number) => void;
  onPick: (index: number) => void;
  labelOf: (index: number) => string;
  /** Controls laid over the canvas that labels keep clear of. */
  obstacles?: () => Iterable<Element>;
}

const HIST = 110;
const SPARK_CAP = 6000;
const TRAIL_CAP = 12 * HIST * 2;
const AGENT_TTL = 5 * 60_000;
/** An agent with no call for this long heads back to the dock. */
const AGENT_IDLE_MS = 5_000;
const IDLE_SPIN_MS = 2_000;

const NOTE_VS = /* glsl */ `
attribute vec3 aColor; attribute float aSize; attribute float aFlare; attribute float aDim; attribute float aPhase;
uniform float uTime; uniform float uScale;
varying vec3 vColor; varying float vAlpha; varying float vFlare;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.86 + 0.14 * sin(uTime * 1.6 + aPhase);
  float s = aSize * (1.0 + aFlare * 2.6) * mix(1.0, 0.55, aDim) * tw;
  gl_PointSize = clamp(s * uScale / -mv.z, 0.0, 96.0);
  gl_Position = projectionMatrix * mv;
  vColor = mix(aColor, vec3(1.0), clamp(aFlare * 0.6, 0.0, 0.8));
  vAlpha = mix(1.0, 0.07, aDim);
  vFlare = aFlare;
}`;

const NOTE_FS = /* glsl */ `
uniform float uLight;
varying vec3 vColor; varying float vAlpha; varying float vFlare;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = smoothstep(0.38, 0.0, d);
  float halo = pow(1.0 - d, 2.4) * (0.42 + vFlare * 0.9);
  if (uLight > 0.5) {
    vec3 deep = mix(vColor, vColor * vColor, 0.65) * 0.78;
    gl_FragColor = vec4(mix(deep, deep * 0.55, core), (core * 0.95 + halo * 0.55) * vAlpha);
  } else {
    gl_FragColor = vec4(vColor * (core * 1.3 + halo), (core + halo) * vAlpha);
  }
}`;

const SHELL_VS = /* glsl */ `
attribute float aShade;
uniform float uTime; uniform float uScale; uniform float uSize; uniform float uLight; uniform float uFade;
uniform vec3 uColA; uniform vec3 uColB;
varying float vA; varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vec3 v = normalize(-mv.xyz);
  float rim = 1.0 - abs(dot(n, v));
  float wave = 0.5 + 0.5 * sin(position.z * 5.0 - uTime * 0.9 + position.y * 2.0);
  vA = (0.17 + pow(rim, 2.6) * 0.6) * aShade * aShade * aShade * (0.75 + 0.5 * wave * (1.0 - uLight)) * uFade;
  vC = mix(uColA, uColB, clamp(position.y * 0.8 + 0.5 + position.z * 0.2, 0.0, 1.0));
  gl_PointSize = clamp(uSize * uScale / -mv.z, 1.0, 7.0);
  gl_Position = projectionMatrix * mv;
}`;

const SHELL_FS = /* glsl */ `
uniform float uLight;
varying float vA; varying vec3 vC;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = vA * smoothstep(1.0, 0.1, d);
  gl_FragColor = uLight > 0.5 ? vec4(vC, min(1.0, a * 1.15)) : vec4(vC, a);
}`;

const LINE_VS = /* glsl */ `
attribute vec3 aColor; attribute float aAlpha;
varying vec3 vColor; varying float vAlpha;
void main() {
  vColor = aColor; vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const LINE_FS = /* glsl */ `
uniform float uOpacity; uniform float uLight;
varying vec3 vColor; varying float vAlpha;
void main() {
  vec3 c = uLight > 0.5 ? mix(vColor, vColor * vColor, 0.6) * 0.7 : vColor;
  gl_FragColor = vec4(c, vAlpha * uOpacity);
}`;

const SPARK_VS = /* glsl */ `
attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
uniform float uScale;
varying vec3 vColor; varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / -mv.z, 0.0, 128.0);
  gl_Position = projectionMatrix * mv;
  vColor = aColor; vAlpha = aAlpha;
}`;

const SPARK_FS = /* glsl */ `
uniform float uLight;
varying vec3 vColor; varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = smoothstep(0.3, 0.0, d);
  float halo = pow(1.0 - d, 2.0) * 0.6;
  if (uLight > 0.5) {
    vec3 c = mix(vColor, vColor * vColor, 0.5) * 0.85;
    gl_FragColor = vec4(c, (core + halo * 0.6) * vAlpha);
  } else {
    gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.7) * (core + halo), (core + halo) * vAlpha);
  }
}`;

/** Fewer segments on huge graphs to keep the buffer small. */
function nerveSegments(links: number): number {
  return Math.max(4, Math.min(12, Math.floor(80000 / Math.max(1, links))));
}

/** Stable value in [0, 1) for an unordered note pair. */
function pairRand(lo: number, hi: number, k: number): number {
  let h = (Math.imul(lo + 1, 0x9e3779b1) ^ Math.imul(hi + 7, 0x85ebca77) ^ Math.imul(k + 3, 0xc2b2ae3d)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** S-shaped cubic sagging toward the core, so links read as fibres; (b, a, 1 - t) is the same point. */
function nervePoint(pos: Float32Array, a: number, b: number, t: number, out: Float32Array, o: number): void {
  if (a > b) {
    [a, b] = [b, a];
    t = 1 - t;
  }
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
  const dx = pos[b * 3] - ax, dy = pos[b * 3 + 1] - ay, dz = pos[b * 3 + 2] - az;
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  let ux = -dz, uy = 0, uz = dx;
  if (Math.abs(dy) > 0.9 * len) {
    ux = 0;
    uy = dz;
    uz = -dy;
  }
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  let wx = (dy * uz - dz * uy) / len, wy = (dz * ux - dx * uz) / len, wz = (dx * uy - dy * ux) / len;
  const th = pairRand(a, b, 0) * Math.PI * 2;
  const bend = len * (0.12 + 0.16 * pairRand(a, b, 1));
  const ex = ux * Math.cos(th) + wx * Math.sin(th);
  const ey = uy * Math.cos(th) + wy * Math.sin(th);
  const ez = uz * Math.cos(th) + wz * Math.sin(th);
  const s2 = pairRand(a, b, 2) < 0.65 ? -0.8 : 0.9; // mostly S, sometimes a single arc
  const sag = 0.86; // pull toward the core
  const c1x = (ax + dx / 3) * sag + ex * bend, c1y = (ay + dy / 3) * sag + ey * bend, c1z = (az + dz / 3) * sag + ez * bend;
  const c2x = (ax + (dx * 2) / 3) * sag + ex * bend * s2, c2y = (ay + (dy * 2) / 3) * sag + ey * bend * s2, c2z = (az + (dz * 2) / 3) * sag + ez * bend * s2;
  const u = 1 - t;
  const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
  const wob = Math.sin(t * Math.PI * (3 + 2 * pairRand(a, b, 3)) + th) * Math.sin(Math.PI * t) * len * 0.035;
  wx *= wob;
  wy *= wob;
  wz *= wob;
  out[o] = b0 * ax + b1 * c1x + b2 * c2x + b3 * (ax + dx) + wx;
  out[o + 1] = b0 * ay + b1 * c1y + b2 * c2y + b3 * (ay + dy) + wy;
  out[o + 2] = b0 * az + b1 * c1z + b2 * c2z + b3 * (az + dz) + wz;
}

function attr(arr: Float32Array, size: number, dynamic = true): BufferAttribute {
  const a = new BufferAttribute(arr, size);
  if (dynamic) a.setUsage(DynamicDrawUsage);
  return a;
}

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Spark {
  a: Vec3;
  c: Vec3;
  b: Vec3;
  target: number;
  t: number;
  dur: number;
  delay: number;
  rgb: [number, number, number];
  size: number;
  alpha: number;
  strength: number;
  echo: boolean;
  /** Source note when the spark runs along a nerve. */
  from?: number;
}

interface Agent {
  rgb: [number, number, number];
  head: Vec3;
  vel: Vec3;
  target: Vec3;
  seed: number;
  hist: Float32Array;
  histN: number;
  histI: number;
  last: number;
  energy: number;
  fade: number;
  busy: number;
  el: HTMLElement;
}

export class BrainScene {
  readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private controls: OrbitControls;
  private host: HTMLElement;
  private labels: HTMLElement;
  private cb: SceneCallbacks;
  private reduced: boolean;
  private light = false;
  /** Cortex brightness, faint while there are no notes. */
  private shellLevel = 1;
  private shellTarget = 1;
  private readonly dprCap = 2;

  private n = 0;
  private keys: string[] = [];
  private pos = new Float32Array(0);
  private tgt = new Float32Array(0);
  private col = new Float32Array(0);
  private base = new Float32Array(0);
  private grow = new Float32Array(0);
  private growT = new Float32Array(0);
  private flare = new Float32Array(0);
  private dim = new Float32Array(0);
  private dimT = new Float32Array(0);
  private sizeA = new Float32Array(0);
  private phase = new Float32Array(0);
  private active = new Set<number>();
  private ghosts = 0;
  private ghostTimer = 0;

  private noteGeo = new BufferGeometry();
  private noteMat: ShaderMaterial;
  private notePts: Points;

  private linkPairs = new Int32Array(0);
  private linkSeg = 1;
  private tmp3 = new Float32Array(3);
  private adjOff = new Int32Array(1);
  private adj = new Int32Array(0);
  private linkGeo = new BufferGeometry();
  private linkMat: ShaderMaterial;
  private linkObj: LineSegments;
  private linksDirty = false;
  private hiGeo = new BufferGeometry();
  private hiMat: ShaderMaterial;
  private hiObj: LineSegments;
  private hiFor = -1;

  private shellGeo = new BufferGeometry();
  private shellMat: ShaderMaterial;

  private sparks: Spark[] = [];
  private sparkGeo = new BufferGeometry();
  private sparkMat: ShaderMaterial;
  private sparkPos = new Float32Array(SPARK_CAP * 3);
  private sparkCol = new Float32Array(SPARK_CAP * 3);
  private sparkSize = new Float32Array(SPARK_CAP);
  private sparkAlpha = new Float32Array(SPARK_CAP);
  private trailGeo = new BufferGeometry();
  private trailMat: ShaderMaterial;
  private trailPos = new Float32Array(TRAIL_CAP * 3);
  private trailCol = new Float32Array(TRAIL_CAP * 3);
  private trailAlpha = new Float32Array(TRAIL_CAP);
  private agents = new Map<string, Agent>();
  /** Client point agents come from and return to. */
  private dock: (() => { x: number; y: number } | null) | null = null;
  private ambientAcc = 0;
  private r = rng(1234);

  private regionLabels: { el: HTMLElement; anchor: Vec3; name: string }[] = [];
  private hiddenRegions = new Set<string>();
  private noteLabels: { el: HTMLElement; index: number }[] = [];
  private reticle: HTMLElement;
  private showLabels = true;
  /** In label-layer px, refreshed a few times a second. */
  private blockers: Box[] = [];
  private blockersAt = -1e9;
  /** Measured once each; label text does not change. */
  private labelSize = new WeakMap<HTMLElement, [number, number]>();

  private raf = 0;
  private running = false;
  private disposed = false;
  private time = 0;
  private last = 0;
  private lastInteract = performance.now();
  private autoRotate = true;
  private selected = -1;
  private hovered = -1;
  private pointer: { x: number; y: number; dirty: boolean; inside: boolean } = { x: 0, y: 0, dirty: false, inside: false };
  private down: { x: number; y: number; t: number } | null = null;
  private tween: { p0: Vector3; p1: Vector3; t0: Vector3; t1: Vector3; s: number; dur: number; arc?: boolean } | null = null;
  private zoomTween: { d0: number; d1: number; t0: Vector3; t1: Vector3; s: number; dur: number } | null = null;
  private ro: ResizeObserver;
  private width = 1;
  private height = 1;
  private sized = false;
  /** The fov eases to this after a layout change, so the size never jumps. */
  private fovTarget = 42;
  private tmp = new Vector3();
  private vp = new Matrix4();

  constructor(host: HTMLElement, labels: HTMLElement, cb: SceneCallbacks, reduced: boolean) {
    this.host = host;
    this.labels = labels;
    this.cb = cb;
    this.reduced = reduced;
    this.autoRotate = !reduced;

    this.renderer = new WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'brain-canvas';
    host.appendChild(this.canvas);

    this.camera = new PerspectiveCamera(HOME_FOV_DEG, 1, 0.05, 60);
    this.camera.position.set(...HOME_DIR);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 0.35;
    this.controls.maxDistance = 9;
    this.controls.autoRotateSpeed = 0.55;
    this.controls.target.set(...HOME_TARGET);
    this.controls.addEventListener('start', () => {
      this.lastInteract = performance.now();
      this.controls.autoRotate = false;
      this.tween = null;
      this.zoomTween = null;
    });

    this.noteMat = new ShaderMaterial({
      vertexShader: NOTE_VS,
      fragmentShader: NOTE_FS,
      uniforms: { uTime: { value: 0 }, uScale: { value: 400 }, uLight: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.notePts = new Points(this.noteGeo, this.noteMat);
    this.notePts.frustumCulled = false;
    this.notePts.renderOrder = 3;

    this.linkMat = new ShaderMaterial({
      vertexShader: LINE_VS,
      fragmentShader: LINE_FS,
      uniforms: { uOpacity: { value: 0.14 }, uLight: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.linkObj = new LineSegments(this.linkGeo, this.linkMat);
    this.linkObj.frustumCulled = false;
    this.linkObj.renderOrder = 1;
    this.hiMat = new ShaderMaterial({
      vertexShader: LINE_VS,
      fragmentShader: LINE_FS,
      uniforms: { uOpacity: { value: 0.85 }, uLight: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.hiObj = new LineSegments(this.hiGeo, this.hiMat);
    this.hiObj.frustumCulled = false;
    this.hiObj.renderOrder = 2;

    const shell = sampleShell(window.innerWidth < 700 ? 14000 : 26000);
    this.shellGeo.setAttribute('position', attr(shell.pos.subarray(0, shell.count * 3), 3, false));
    this.shellGeo.setAttribute('normal', attr(shell.nrm.subarray(0, shell.count * 3), 3, false));
    this.shellGeo.setAttribute('aShade', attr(shell.shade.subarray(0, shell.count), 1, false));
    this.shellMat = new ShaderMaterial({
      vertexShader: SHELL_VS,
      fragmentShader: SHELL_FS,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 400 },
        uSize: { value: 0.0105 },
        uLight: { value: 0 },
        uFade: { value: 1 },
        uColA: { value: new Vector3(0.36, 0.42, 0.98) },
        uColB: { value: new Vector3(0.37, 0.92, 0.83) },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const shellPts = new Points(this.shellGeo, this.shellMat);
    shellPts.frustumCulled = false;
    shellPts.renderOrder = 0;

    this.sparkGeo.setAttribute('position', attr(this.sparkPos, 3));
    this.sparkGeo.setAttribute('aColor', attr(this.sparkCol, 3));
    this.sparkGeo.setAttribute('aSize', attr(this.sparkSize, 1));
    this.sparkGeo.setAttribute('aAlpha', attr(this.sparkAlpha, 1));
    this.sparkGeo.setDrawRange(0, 0);
    this.sparkMat = new ShaderMaterial({
      vertexShader: SPARK_VS,
      fragmentShader: SPARK_FS,
      uniforms: { uScale: { value: 400 }, uLight: { value: 0 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    });
    const sparkPts = new Points(this.sparkGeo, this.sparkMat);
    sparkPts.frustumCulled = false;
    sparkPts.renderOrder = 5;

    this.trailGeo.setAttribute('position', attr(this.trailPos, 3));
    this.trailGeo.setAttribute('aColor', attr(this.trailCol, 3));
    this.trailGeo.setAttribute('aAlpha', attr(this.trailAlpha, 1));
    this.trailGeo.setDrawRange(0, 0);
    this.trailMat = new ShaderMaterial({
      vertexShader: LINE_VS,
      fragmentShader: LINE_FS,
      uniforms: { uOpacity: { value: 1 }, uLight: { value: 0 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    });
    const trail = new LineSegments(this.trailGeo, this.trailMat);
    trail.frustumCulled = false;
    trail.renderOrder = 4;

    this.scene.add(shellPts, this.linkObj, this.hiObj, this.notePts, trail, sparkPts);

    this.reticle = document.createElement('div');
    this.reticle.className = 'bl-reticle hidden';
    labels.appendChild(this.reticle);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    window.addEventListener('resize', this.onWindowResize);
    this.resize();
    this.camera.position.copy(this.homePos());

    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointerleave', this.onLeave);
  }

  private onWindowResize = (): void => {
    if (this.host.clientWidth !== this.width || this.host.clientHeight !== this.height) this.resize();
  };

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.glide();
    this.width = w;
    this.height = h;
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.fovTarget = w / h < 0.9 ? 58 : 42;
    if (!this.sized || this.reduced) this.camera.fov = this.fovTarget;
    this.sized = true;
    this.applyFraming();
    // A resize clears the WebGL canvas: draw again right away so it never blinks.
    this.renderOnce();
  }

  /** When the layout moves, the canvas and labels glide together from their old screen spot. */
  private glide(): void {
    const parent = this.host.parentElement;
    if (!this.sized || this.reduced || !parent) return;
    const was = this.canvas.getBoundingClientRect();
    const now = parent.getBoundingClientRect();
    const dx = was.left + was.width / 2 - (now.left + now.width / 2);
    const dy = was.top + was.height / 2 - (now.top + now.height / 2);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    for (const el of [this.host, this.labels]) {
      el.style.transition = 'none';
      el.style.transform = `translate3d(${dx.toFixed(1)}px,${dy.toFixed(1)}px,0)`;
    }
    void this.host.offsetWidth;
    for (const el of [this.host, this.labels]) {
      el.style.transition = 'transform .45s cubic-bezier(.2,.8,.2,1)';
      el.style.transform = '';
    }
  }

  private applyFraming(): void {
    this.camera.updateProjectionMatrix();
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const scale = (this.height * dpr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.noteMat.uniforms.uScale.value = scale;
    this.shellMat.uniforms.uScale.value = scale;
    this.sparkMat.uniforms.uScale.value = scale;
  }

  private easeFraming(dt: number): void {
    if (this.camera.fov === this.fovTarget) return;
    const k = 1 - Math.exp(-dt * 9);
    this.camera.fov += (this.fovTarget - this.camera.fov) * k;
    if (Math.abs(this.camera.fov - this.fovTarget) <= 0.01) this.camera.fov = this.fovTarget;
    this.applyFraming();
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.easeFraming(dt);
      this.frame(dt, now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.ro.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    clearTimeout(this.ghostTimer);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.controls.dispose();
    for (const g of [this.noteGeo, this.linkGeo, this.hiGeo, this.shellGeo, this.sparkGeo, this.trailGeo]) g.dispose();
    for (const m of [this.noteMat, this.linkMat, this.hiMat, this.shellMat, this.sparkMat, this.trailMat]) m.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.labels.innerHTML = '';
    this.agents.clear();
  }

  private renderOnce(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  setTheme(light: boolean): void {
    this.light = light;
    const blend: Blending = light ? NormalBlending : AdditiveBlending;
    for (const m of [this.noteMat, this.linkMat, this.hiMat, this.shellMat, this.sparkMat, this.trailMat]) {
      m.blending = blend;
      m.uniforms.uLight.value = light ? 1 : 0;
      m.needsUpdate = true;
    }
    const a = this.shellMat.uniforms.uColA.value as Vector3;
    const b = this.shellMat.uniforms.uColB.value as Vector3;
    if (light) {
      a.set(0.3, 0.36, 0.52);
      b.set(0.2, 0.45, 0.5);
    } else {
      a.set(0.36, 0.42, 0.98);
      b.set(0.37, 0.92, 0.83);
    }
    this.updateLinkOpacity();
    this.renderOnce();
  }

  /** No notes: the cortex fades so the brain does not look full. */
  setEmpty(on: boolean): void {
    this.shellTarget = on ? 0.14 : 1;
    if (this.reduced || !this.running) {
      this.shellLevel = this.shellTarget;
      this.shellMat.uniforms.uFade.value = this.shellLevel;
    }
    this.renderOnce();
  }

  setAutoRotate(on: boolean): void {
    this.autoRotate = on && !this.reduced;
    if (!this.autoRotate) this.controls.autoRotate = false;
    else this.lastInteract = 0;
  }

  setLabels(notes: boolean, regions = notes): void {
    this.showLabels = notes || regions;
    this.labels.classList.toggle('no-labels', !notes && !regions);
    this.labels.classList.toggle('no-notes', !notes);
    this.labels.classList.toggle('no-regions', !regions);
  }

  /** Existing keys glide to their new spot. */
  setData(specs: ParticleSpec[], links: [number, number][], regions: RegionLabel[]): void {
    const old = new Map<string, number>();
    for (let i = 0; i < this.n; i++) if (this.growT[i] > 0) old.set(this.keys[i], i);
    const keep = new Set(specs.map((s) => s.key));
    const ghosts: number[] = [];
    old.forEach((i, k) => {
      if (!keep.has(k)) ghosts.push(i);
    });
    const n = specs.length + ghosts.length;
    const P = new Float32Array(n * 3);
    const T = new Float32Array(n * 3);
    const C = new Float32Array(n * 3);
    const B = new Float32Array(n);
    const G = new Float32Array(n);
    const GT = new Float32Array(n);
    const F = new Float32Array(n);
    const D = new Float32Array(n);
    const DT = new Float32Array(n);
    const PH = new Float32Array(n);
    const K: string[] = [];
    const firstLoad = this.n === 0;
    const active = new Set<number>();
    specs.forEach((s, i) => {
      K.push(s.key);
      const o = old.get(s.key);
      T.set(s.target, i * 3);
      const rgb = hexToRgb(s.color);
      C.set(rgb, i * 3);
      B[i] = s.size;
      GT[i] = 1;
      PH[i] = (hashStr(s.key) % 6283) / 1000;
      if (o !== undefined) {
        P[i * 3] = this.pos[o * 3];
        P[i * 3 + 1] = this.pos[o * 3 + 1];
        P[i * 3 + 2] = this.pos[o * 3 + 2];
        G[i] = this.grow[o];
        F[i] = this.flare[o];
        D[i] = this.dim[o];
        DT[i] = this.dimT[o];
        if (P[i * 3] !== T[i * 3] || P[i * 3 + 1] !== T[i * 3 + 1] || P[i * 3 + 2] !== T[i * 3 + 2]) active.add(i);
        if (G[i] < 1 || F[i] > 0.001 || D[i] !== DT[i]) active.add(i);
      } else if (firstLoad && !this.reduced) {
        const r = 1.25 + this.r() * 0.2;
        const len = Math.hypot(s.target[0], s.target[1], s.target[2]) || 1;
        P.set([(s.target[0] / len) * r, (s.target[1] / len) * r, (s.target[2] / len) * r], i * 3);
        G[i] = 0;
        active.add(i);
      } else if (firstLoad) {
        P.set(s.target, i * 3);
        G[i] = 1;
      } else {
        P.set(s.origin, i * 3);
        G[i] = 0;
        F[i] = 1;
        active.add(i);
      }
    });
    ghosts.forEach((o, j) => {
      const i = specs.length + j;
      K.push(this.keys[o]);
      for (let a = 0; a < 3; a++) {
        P[i * 3 + a] = this.pos[o * 3 + a];
        T[i * 3 + a] = this.pos[o * 3 + a];
        C[i * 3 + a] = this.col[o * 3 + a];
      }
      B[i] = this.base[o];
      G[i] = this.grow[o];
      GT[i] = 0;
      F[i] = 0.8;
      active.add(i);
    });
    this.n = n;
    this.keys = K;
    this.pos = P;
    this.tgt = T;
    this.col = C;
    this.base = B;
    this.grow = G;
    this.growT = GT;
    this.flare = F;
    this.dim = D;
    this.dimT = DT;
    this.phase = PH;
    this.sizeA = new Float32Array(n);
    for (let i = 0; i < n; i++) this.sizeA[i] = B[i] * G[i];
    this.active = active;
    this.ghosts = ghosts.length;
    this.sparks = this.sparks.filter((s) => s.target < 0);
    if (this.selected >= 0) this.selected = -1;
    this.hovered = -1;
    this.hiFor = -2;

    this.noteGeo.dispose();
    this.noteGeo = new BufferGeometry();
    this.noteGeo.setAttribute('position', attr(this.pos, 3));
    this.noteGeo.setAttribute('aColor', attr(this.col, 3));
    this.noteGeo.setAttribute('aSize', attr(this.sizeA, 1));
    this.noteGeo.setAttribute('aFlare', attr(this.flare, 1));
    this.noteGeo.setAttribute('aDim', attr(this.dim, 1));
    this.noteGeo.setAttribute('aPhase', attr(this.phase, 1, false));
    this.notePts.geometry = this.noteGeo;

    const L = links.length;
    this.linkPairs = new Int32Array(L * 2);
    const deg = new Int32Array(n + 1);
    links.forEach(([a, b], i) => {
      this.linkPairs[i * 2] = a;
      this.linkPairs[i * 2 + 1] = b;
      deg[a]++;
      deg[b]++;
    });
    this.adjOff = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.adjOff[i + 1] = this.adjOff[i] + deg[i];
    this.adj = new Int32Array(this.adjOff[n]);
    const fill = this.adjOff.slice(0, n);
    links.forEach(([a, b]) => {
      this.adj[fill[a]++] = b;
      this.adj[fill[b]++] = a;
    });
    this.linkGeo.dispose();
    this.linkGeo = new BufferGeometry();
    this.linkSeg = nerveSegments(L);
    const V = L * this.linkSeg * 2;
    this.linkGeo.setAttribute('position', attr(new Float32Array(V * 3), 3));
    this.linkGeo.setAttribute('aColor', attr(new Float32Array(V * 3), 3));
    this.linkGeo.setAttribute('aAlpha', attr(new Float32Array(V), 1));
    this.linkObj.geometry = this.linkGeo;
    this.linksDirty = true;
    this.fillLinks(true);
    this.updateLinkOpacity();

    for (const l of this.regionLabels) l.el.remove();
    this.regionLabels = regions.map((rg) => {
      const el = document.createElement('div');
      el.className = 'bl-region';
      el.style.setProperty('--c', rg.color);
      el.textContent = /^root$/i.test(rg.name) ? 'Top level' : rg.name;
      this.labels.appendChild(el);
      return { el, anchor: rg.anchor, name: rg.name };
    });
    this.pickNoteLabels();

    clearTimeout(this.ghostTimer);
    if (ghosts.length) {
      this.ghostTimer = window.setTimeout(() => this.compact(), 1400);
    }
    if (!this.running) this.renderOnce();
  }

  private compact(): void {
    if (this.disposed || !this.ghosts) return;
    const live = this.n - this.ghosts;
    const specs: ParticleSpec[] = [];
    for (let i = 0; i < live; i++) {
      const t: Vec3 = [this.tgt[i * 3], this.tgt[i * 3 + 1], this.tgt[i * 3 + 2]];
      const c = this.col.subarray(i * 3, i * 3 + 3);
      const hex = '#' + Array.from(c, (v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
      specs.push({ key: this.keys[i], target: t, origin: t, color: hex, size: this.base[i] });
    }
    const links: [number, number][] = [];
    for (let i = 0; i < this.linkPairs.length; i += 2) {
      if (this.linkPairs[i] < live && this.linkPairs[i + 1] < live) links.push([this.linkPairs[i], this.linkPairs[i + 1]]);
    }
    const dims = this.dimT.slice(0, live);
    const regions = this.regionLabels;
    const sel = this.selected;
    this.n = live;
    this.ghosts = 0;
    const saved = regions.map((r) => ({ name: r.el.textContent || '', anchor: r.anchor, color: r.el.style.getPropertyValue('--c'), count: 0 }));
    this.setData(specs, links, saved);
    this.dimT.set(dims);
    this.dim.set(dims);
    if (sel >= 0 && sel < live) this.select(sel);
  }

  private updateLinkOpacity(): void {
    const L = this.linkPairs.length / 2;
    const dens = Math.min(1, Math.sqrt(2500 / Math.max(1, L)));
    this.linkMat.uniforms.uOpacity.value = (this.light ? 0.15 : 0.12) * Math.max(0.35, dens);
  }

  private fillLinks(colors = false): void {
    const geo = this.linkGeo;
    const P = geo.getAttribute('position') as BufferAttribute | undefined;
    const A = geo.getAttribute('aAlpha') as BufferAttribute | undefined;
    this.linksDirty = false;
    if (!P || !A) return;
    const pa = P.array as Float32Array;
    const aa = A.array as Float32Array;
    const ca = colors ? ((geo.getAttribute('aColor') as BufferAttribute).array as Float32Array) : null;
    const lp = this.linkPairs;
    const S = this.linkSeg;
    const pt = new Float32Array(3 * (S + 1));
    for (let i = 0, L = lp.length / 2; i < L; i++) {
      const a = lp[i * 2];
      const b = lp[i * 2 + 1];
      for (let k = 0; k <= S; k++) nervePoint(this.pos, a, b, k / S, pt, k * 3);
      const g = this.grow[a] * (1 - this.dim[a] * 0.92) * this.grow[b] * (1 - this.dim[b] * 0.92);
      for (let k = 0; k < S; k++) {
        const v = (i * S + k) * 2;
        pa.set(pt.subarray(k * 3, k * 3 + 6), v * 3);
        aa[v] = g * (0.5 + 0.5 * Math.sin((Math.PI * k) / S));
        aa[v + 1] = g * (0.5 + 0.5 * Math.sin((Math.PI * (k + 1)) / S));
        if (ca) {
          for (let e = 0; e < 2; e++) {
            const t = (k + e) / S;
            for (let q = 0; q < 3; q++) ca[(v + e) * 3 + q] = this.col[a * 3 + q] * (1 - t) + this.col[b * 3 + q] * t;
          }
        }
      }
    }
    P.needsUpdate = true;
    A.needsUpdate = true;
    if (ca) (geo.getAttribute('aColor') as BufferAttribute).needsUpdate = true;
  }

  private buildHighlight(i: number): void {
    if (this.hiFor === i) return;
    this.hiFor = i;
    this.hiGeo.dispose();
    this.hiGeo = new BufferGeometry();
    this.hiObj.geometry = this.hiGeo;
    if (i < 0 || i >= this.n) return;
    const nb = this.neighbors(i);
    const S = 16;
    const p = new Float32Array(nb.length * S * 6);
    const c = new Float32Array(nb.length * S * 6);
    const a = new Float32Array(nb.length * S * 2);
    const pt = new Float32Array(3 * (S + 1));
    nb.forEach((j, n) => {
      for (let k = 0; k <= S; k++) nervePoint(this.pos, i, j, k / S, pt, k * 3);
      for (let k = 0; k < S; k++) {
        const v = (n * S + k) * 2;
        p.set(pt.subarray(k * 3, k * 3 + 6), v * 3);
        for (let e = 0; e < 2; e++) {
          const t = (k + e) / S;
          a[v + e] = 1 - 0.45 * t;
          for (let q = 0; q < 3; q++) {
            c[(v + e) * 3 + q] = Math.min(1, this.col[i * 3 + q] * 0.6 + 0.4) * (1 - t) + this.col[j * 3 + q] * t;
          }
        }
      }
    });
    this.hiGeo.setAttribute('position', attr(p, 3));
    this.hiGeo.setAttribute('aColor', attr(c, 3, false));
    this.hiGeo.setAttribute('aAlpha', attr(a, 1, false));
  }

  private neighbors(i: number): number[] {
    if (i < 0 || i >= this.n) return [];
    return Array.from(this.adj.subarray(this.adjOff[i], this.adjOff[i + 1]));
  }

  /** 0 = lit, 1 = faded. */
  setDim(fn: ((i: number) => number) | null): void {
    for (let i = 0; i < this.n - this.ghosts; i++) {
      const v = fn ? fn(i) : 0;
      if (this.dimT[i] !== v) {
        this.dimT[i] = v;
        this.active.add(i);
      }
    }
    if (this.reduced) {
      this.dim.set(this.dimT);
      const a = this.noteGeo.getAttribute('aDim') as BufferAttribute | undefined;
      if (a) a.needsUpdate = true;
      this.linksDirty = true;
    }
    if (!this.running) this.renderOnce();
  }

  select(i: number): void {
    this.selected = i;
    this.buildHighlight(i);
    this.reticle.classList.toggle('hidden', i < 0);
    if (i >= 0) {
      this.flareNote(i, 0.7);
      const c = this.col.subarray(i * 3, i * 3 + 3);
      this.reticle.style.setProperty('--c', `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`);
    }
  }

  flareNote(i: number, s = 1): void {
    if (i < 0 || i >= this.n) return;
    this.flare[i] = Math.max(this.flare[i], s);
    this.active.add(i);
  }

  setDock(fn: (() => { x: number; y: number } | null) | null): void {
    this.dock = fn;
  }

  /** Between the camera and the brain. */
  private dockWorld(): Vec3 | null {
    const p = this.dock?.();
    const r = this.canvas.getBoundingClientRect();
    if (!p || !r.width || !r.height) return null;
    this.camera.updateMatrixWorld();
    const ndc = new Vector3(((p.x - r.left) / r.width) * 2 - 1, -(((p.y - r.top) / r.height) * 2 - 1), 0.5).unproject(this.camera);
    const cam = this.camera.position;
    const dir = ndc.sub(cam).normalize();
    const d = cam.distanceTo(this.controls.target) * 0.55;
    return [cam.x + dir.x * d, cam.y + dir.y * d, cam.z + dir.z * d];
  }

  agentHead(actor: string): Vec3 | null {
    const a = this.agents.get(actor);
    return a && a.fade > 0.05 ? [a.head[0], a.head[1], a.head[2]] : null;
  }

  positionOf(i: number): Vec3 {
    return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]];
  }

  focus(p: Vec3, dist: number): void {
    const target = new Vector3(p[0], p[1], p[2]);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const out = target.clone().setY(target.y * 0.5);
    if (out.length() > 0.15) dir.lerp(out.normalize(), 0.55).normalize();
    const pos = target.clone().add(dir.multiplyScalar(dist));
    this.zoomTween = null;
    this.controls.autoRotate = false;
    this.lastInteract = performance.now();
    if (this.reduced) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.tween = { p0: this.camera.position.clone(), p1: pos, t0: this.controls.target.clone(), t1: target, s: 0, dur: 1.1 };
  }

  cameraView(): BrainView | null {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const p = this.camera.position;
    const t = this.controls.target;
    return { eye: [p.x, p.y, p.z], target: [t.x, t.y, t.z], fov: (this.camera.fov * Math.PI) / 180, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
  }

  /** Client px plus depth. */
  projectToClient(x: number, y: number, z: number): [number, number, number] | null {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    this.camera.updateMatrixWorld();
    const v = new Vector3(x, y, z).project(this.camera);
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height, v.z];
  }

  /** Zoomed or moved off the home framing; orbiting does not count. */
  awayFromHome(): boolean {
    if (this.tween || this.zoomTween) return true;
    const hd = homeDistance(this.camera.aspect);
    const t = this.controls.target;
    const d = this.camera.position.distanceTo(t);
    return t.distanceTo(new Vector3(...HOME_TARGET)) > hd * 0.04 || Math.abs(d - hd) > hd * 0.06;
  }

  private homePos(): Vector3 {
    return new Vector3(...HOME_DIR).normalize().multiplyScalar(homeDistance(this.camera.aspect));
  }

  /** Home zoom and centre, keeping the current angle. */
  resetView(): void {
    const target = new Vector3(...HOME_TARGET);
    const d1 = this.homePos().length();
    this.tween = null;
    if (this.reduced) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.controls.target.copy(target);
      this.camera.position.copy(target).addScaledVector(dir, d1);
      this.controls.update();
      return;
    }
    this.zoomTween = { d0: this.camera.position.distanceTo(this.controls.target), d1, t0: this.controls.target.clone(), t1: target, s: 0, dur: 0.9 };
  }

  zoomBy(factor: number): void {
    const d0 = this.camera.position.distanceTo(this.controls.target);
    const d1 = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, d0 / factor));
    this.halt();
    if (this.reduced) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir, d1);
      this.controls.update();
      return;
    }
    this.zoomTween = { d0, d1, t0: this.controls.target.clone(), t1: this.controls.target.clone(), s: 0, dur: 0.35 };
  }

  /** Radians: `dAz` left/right, `dEl` up/down. */
  orbitBy(dAz: number, dEl: number): void {
    const t = this.controls.target;
    const off = this.camera.position.clone().sub(t);
    const r = off.length();
    const th = Math.atan2(off.x, off.z) + dAz;
    const ph = Math.max(0.12, Math.min(Math.PI - 0.12, Math.acos(Math.max(-1, Math.min(1, off.y / r))) - dEl));
    this.orbitTo(th, ph, 0.32);
  }

  /** `ph` defaults to the current polar angle. */
  orbitTo(th: number, ph?: number, dur = 0.8): void {
    const t = this.controls.target;
    const off = this.camera.position.clone().sub(t);
    const r = off.length();
    const p = ph ?? Math.acos(Math.max(-1, Math.min(1, off.y / r)));
    const pos = new Vector3(Math.sin(p) * Math.sin(th), Math.cos(p), Math.sin(p) * Math.cos(th)).multiplyScalar(r).add(t);
    this.halt();
    if (this.reduced) {
      this.camera.position.copy(pos);
      this.controls.update();
      return;
    }
    this.tween = { p0: this.camera.position.clone(), p1: pos, t0: t.clone(), t1: t.clone(), s: 0, dur, arc: true };
  }

  goHome(): void {
    this.halt();
    const pos = this.homePos().add(new Vector3(...HOME_TARGET));
    const target = new Vector3(...HOME_TARGET);
    if (this.reduced) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.tween = { p0: this.camera.position.clone(), p1: pos, t0: this.controls.target.clone(), t1: target, s: 0, dur: 0.9, arc: true };
  }

  orientation(): { yaw: number; pitch: number } {
    const off = this.camera.position.clone().sub(this.controls.target);
    const r = off.length() || 1;
    return { yaw: Math.atan2(off.x, off.z), pitch: Math.asin(Math.max(-1, Math.min(1, off.y / r))) };
  }

  private halt(): void {
    this.tween = null;
    this.zoomTween = null;
    this.controls.autoRotate = false;
    this.lastInteract = performance.now();
  }

  activity(actor: string, phase: string, ok: boolean | undefined, idx: number[]): void {
    const now = performance.now();
    let ag = this.agents.get(actor);
    if (!ag) {
      const hex = agentColor(actor);
      const seed = hashStr(actor);
      const rr = rng(seed);
      const home: Vec3 = [(rr() * 2 - 1) * 0.5, (rr() - 0.4) * 0.5, (rr() * 2 - 1) * 0.6];
      const el = document.createElement('div');
      el.className = 'bl-agent';
      el.style.setProperty('--c', hex);
      el.innerHTML = `<b></b><span></span>`;
      (el.firstChild as HTMLElement).textContent = agentInitials(actor);
      (el.lastChild as HTMLElement).textContent = actor;
      this.labels.appendChild(el);
      const dock = this.dockWorld();
      ag = {
        rgb: hexToRgb(hex),
        head: dock || [home[0], home[1] + 0.9, home[2]],
        vel: [0, 0, 0],
        target: home,
        seed: (seed % 1000) / 100,
        hist: new Float32Array(HIST * 3),
        histN: 0,
        histI: 0,
        last: now,
        energy: 1,
        fade: 0,
        busy: 0,
        el,
      };
      this.agents.set(actor, ag);
    }
    ag.last = now;
    ag.energy = 1;
    if (phase === 'start') ag.busy++;
    else ag.busy = Math.max(0, ag.busy - 1);
    const list = idx.filter((i) => i >= 0 && i < this.n).slice(0, 40);
    if (list.length) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const i of list) {
        cx += this.pos[i * 3];
        cy += this.pos[i * 3 + 1];
        cz += this.pos[i * 3 + 2];
      }
      const k = 1 / list.length;
      ag.target = [cx * k * 0.85, cy * k * 0.85, cz * k * 0.85];
      const failed = ok === false;
      const rgb: [number, number, number] = failed ? [1, 0.35, 0.35] : ag.rgb;
      list.forEach((i, j) => {
        if (this.reduced) {
          this.flareNote(i, 1);
          return;
        }
        this.spark(ag!.head, i, rgb, j * 0.07, phase === 'end' ? 0.7 : 1.05, 0.085, 1, true);
      });
    }
  }

  private spark(
    from: Vec3,
    target: number,
    rgb: [number, number, number],
    delay: number,
    dur: number,
    size: number,
    alpha: number,
    echo: boolean,
    to?: Vec3,
    fromNote?: number,
  ): void {
    if (this.sparks.length > 900) return;
    const b: Vec3 = to ? to : this.positionOf(target);
    const a: Vec3 = [from[0], from[1], from[2]];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const mz = (a[2] + b[2]) / 2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const j = len * 0.35;
    const c: Vec3 = [mx * 0.7 + (this.r() - 0.5) * j, my * 0.7 + (this.r() - 0.5) * j, mz * 0.7 + (this.r() - 0.5) * j];
    this.sparks.push({ a, b, c, target, t: 0, dur, delay, rgb, size, alpha, strength: echo ? 1 : 0.35, echo, from: fromNote });
  }

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return; // touch drags orbit; taps pick on release
    const r = this.canvas.getBoundingClientRect();
    this.pointer.x = e.clientX - r.left;
    this.pointer.y = e.clientY - r.top;
    this.pointer.dirty = true;
    this.pointer.inside = true;
    if (!this.running) this.pickHover();
  };

  private onLeave = (): void => {
    this.pointer.inside = false;
    this.pointer.dirty = true;
  };

  private onDown = (e: PointerEvent): void => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.down;
    this.down = null;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
    const r = this.canvas.getBoundingClientRect();
    const i = this.pick(e.clientX - r.left, e.clientY - r.top, e.pointerType === 'touch' ? 26 : 16);
    this.cb.onPick(i);
  };

  private pickHover(): void {
    this.pointer.dirty = false;
    const i = this.pointer.inside ? this.pick(this.pointer.x, this.pointer.y, 14) : -1;
    if (i !== this.hovered) {
      this.hovered = i;
      if (this.selected < 0) this.buildHighlight(i);
    }
    this.cb.onHover(i, this.pointer.x, this.pointer.y);
  }

  private pick(px: number, py: number, radius: number): number {
    this.camera.updateMatrixWorld();
    this.vp.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const e = this.vp.elements;
    const w = this.width;
    const h = this.height;
    let best = -1;
    let bestD = radius * radius;
    for (let i = 0, n = this.n - this.ghosts; i < n; i++) {
      if (this.dimT[i] > 0.6) continue;
      const x = this.pos[i * 3];
      const y = this.pos[i * 3 + 1];
      const z = this.pos[i * 3 + 2];
      const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (cw <= 0.01) continue;
      const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / cw * 0.5 + 0.5) * w;
      const sy = (0.5 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw * 0.5) * h;
      const dx = sx - px;
      const dy = sy - py;
      // Slight preference for particles closer to the camera.
      const d = dx * dx + dy * dy + cw * 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private project(p: Vec3): { x: number; y: number; depth: number } | null {
    this.tmp.set(p[0], p[1], p[2]).project(this.camera);
    if (this.tmp.z > 1) return null;
    return { x: (this.tmp.x * 0.5 + 0.5) * this.width, y: (0.5 - this.tmp.y * 0.5) * this.height, depth: this.tmp.z };
  }

  private pickNoteLabels(): void {
    for (const l of this.noteLabels) l.el.remove();
    const live = this.n - this.ghosts;
    const want = live > 4000 ? 5 : 8;
    const order = Array.from({ length: live }, (_, i) => i)
      .filter((i) => this.dimT[i] < 0.5)
      .sort((a, b) => this.base[b] - this.base[a])
      .slice(0, want);
    this.noteLabels = order.map((index) => {
      const el = document.createElement('div');
      el.className = 'bl-note';
      el.textContent = this.cb.labelOf(index);
      this.labels.appendChild(el);
      return { el, index };
    });
  }

  setHiddenRegions(names: Iterable<string>): void {
    this.hiddenRegions = new Set(names);
    this.renderOnce();
  }

  refreshNoteLabels(): void {
    this.pickNoteLabels();
  }

  /** null while not laid out. */
  private sizeOf(el: HTMLElement): [number, number] | null {
    let sz = this.labelSize.get(el);
    if (!sz) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!w || !h) return null;
      sz = [w, h];
      this.labelSize.set(el, sz);
    }
    return sz;
  }

  private refreshBlockers(): void {
    const now = performance.now();
    if (!this.cb.obstacles || now - this.blockersAt < 250) return;
    this.blockersAt = now;
    this.blockers = blockerBoxes(this.labels.getBoundingClientRect(), this.cb.obstacles());
  }

  private placeLabels(): void {
    // Reads first, then the style writes below.
    this.refreshBlockers();
    const sized = (el: HTMLElement): [number, number] | null => this.sizeOf(el);
    const camDist = this.camera.position.distanceTo(this.controls.target);
    const center = this.controls.target;
    const camPos = this.camera.position;
    const taken: Box[] = [];
    const LABEL_GAP = 4;
    const hits = (k: Box): boolean => !clearOf({ l: k.l - LABEL_GAP, t: k.t - LABEL_GAP, r: k.r + LABEL_GAP, b: k.b + LABEL_GAP }, taken);
    const place = (el: HTMLElement, p: Vec3, extra = 1, avoid = false, kind?: LabelKind, size?: [number, number] | null): void => {
      const s = this.project(p);
      if (!s || s.x < -50 || s.y < -20 || s.x > this.width + 50 || s.y > this.height + 20) {
        el.style.opacity = '0';
        return;
      }
      let dy = 0;
      if (kind && size) {
        if (kind === 'agent') {
          const side = agentSide(s.x, s.y, size[0], size[1], this.blockers);
          el.classList.toggle('flip', side === 'left');
          if (side === 'hidden') {
            el.style.opacity = '0';
            return;
          }
        } else {
          // A folder name may step a line up or down to avoid another label.
          const steps = avoid && kind === 'region' ? [0, -(size[1] + 3), size[1] + 3] : [0];
          let ok = false;
          for (const d of steps) {
            const box = labelBox(kind, s.x, s.y + d, size[0], size[1]);
            if (!clearOf(box, this.blockers) || (avoid && hits(box))) continue;
            if (avoid) taken.push(box);
            dy = d;
            ok = true;
            break;
          }
          if (!ok) {
            el.style.opacity = '0';
            return;
          }
        }
      } else if (kind === 'agent') el.classList.remove('flip');
      // Fade labels on the far side (less on light, where faint text is hard to read).
      const dp = Math.hypot(p[0] - camPos.x, p[1] - camPos.y, p[2] - camPos.z);
      const dc = Math.hypot(center.x - camPos.x, center.y - camPos.y, center.z - camPos.z);
      const back = Math.max(0, Math.min(1, (dp - dc + 0.4) / 0.8));
      el.style.opacity = String((1 - back * (this.light ? 0.45 : 0.7)) * extra);
      el.style.transform = `translate3d(${s.x.toFixed(1)}px,${(s.y + dy).toFixed(1)}px,0)`;
    };
    const agents = Array.from(this.agents.values());
    const agentSizes = agents.map((a) => sized(a.el));
    if (this.showLabels) {
      const regionSizes = this.regionLabels.map((l) => sized(l.el));
      const noteSizes = this.noteLabels.map((l) => sized(l.el));
      this.regionLabels.forEach((l, k) => {
        if (this.hiddenRegions.has(l.name)) l.el.style.opacity = '0';
        else place(l.el, l.anchor, camDist < 1.2 ? 0.35 : 1, true, 'region', regionSizes[k]);
      });
      this.noteLabels.forEach((l, k) => {
        if (l.index >= this.n) return;
        place(l.el, this.positionOf(l.index), (1 - this.dim[l.index]) * Math.min(1, this.grow[l.index]), true, 'note', noteSizes[k]);
      });
    }
    if (this.selected >= 0) place(this.reticle, this.positionOf(this.selected));
    agents.forEach((a, k) => place(a.el, a.head, a.fade, false, 'agent', agentSizes[k]));
  }

  private frame(dt: number, now: number): void {
    if (!this.reduced) this.time += dt;
    this.noteMat.uniforms.uTime.value = this.time;
    this.shellMat.uniforms.uTime.value = this.time;

    if (this.zoomTween) {
      // Along the view direction only, so auto-rotate keeps turning meanwhile.
      const z = this.zoomTween;
      z.s = Math.min(1, z.s + dt / z.dur);
      const k = easeInOut(z.s);
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.controls.target.lerpVectors(z.t0, z.t1, k);
      this.camera.position.copy(this.controls.target).addScaledVector(dir, z.d0 + (z.d1 - z.d0) * k);
      if (z.s >= 1) this.zoomTween = null;
    }
    if (this.tween) {
      const tw = this.tween;
      tw.s = Math.min(1, tw.s + dt / tw.dur);
      const k = easeInOut(tw.s);
      this.controls.target.lerpVectors(tw.t0, tw.t1, k);
      if (tw.arc) {
        // On a sphere around the target, so a big turn never cuts through the brain.
        const a = tw.p0.clone().sub(tw.t0);
        const b = tw.p1.clone().sub(tw.t1);
        const ra = a.length() || 1;
        const rb = b.length() || 1;
        const tha = Math.atan2(a.x, a.z);
        let dth = Math.atan2(b.x, b.z) - tha;
        dth -= Math.round(dth / (Math.PI * 2)) * Math.PI * 2;
        const pha = Math.acos(Math.max(-1, Math.min(1, a.y / ra)));
        const phb = Math.acos(Math.max(-1, Math.min(1, b.y / rb)));
        const th = tha + dth * k;
        const ph = pha + (phb - pha) * k;
        const r = ra + (rb - ra) * k;
        this.camera.position.set(Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th)).multiplyScalar(r).add(this.controls.target);
      } else this.camera.position.lerpVectors(tw.p0, tw.p1, k);
      if (tw.s >= 1) this.tween = null;
    } else if (this.autoRotate && !this.controls.autoRotate && now - this.lastInteract > IDLE_SPIN_MS && this.selected < 0) {
      this.controls.autoRotate = true;
    }
    this.controls.update(dt);
    // Fade the cortex when diving inside it.
    const cd = this.camera.position.length();
    if (this.shellLevel !== this.shellTarget) {
      this.shellLevel += (this.shellTarget - this.shellLevel) * (1 - Math.exp(-dt * 4));
      if (Math.abs(this.shellLevel - this.shellTarget) < 0.005) this.shellLevel = this.shellTarget;
    }
    this.shellMat.uniforms.uFade.value = this.shellLevel * Math.max(0.15, Math.min(1, (cd - 0.6) / 1.4));

    if (this.active.size) {
      const kp = 1 - Math.exp(-dt * 3.2);
      const kg = 1 - Math.exp(-dt * 3.5);
      const kd = 1 - Math.exp(-dt * 7);
      const fd = Math.exp(-dt * 1.9);
      let moved = false;
      let dimmed = false;
      let grew = false;
      for (const i of this.active) {
        let settled = true;
        for (let a = 0; a < 3; a++) {
          const d = this.tgt[i * 3 + a] - this.pos[i * 3 + a];
          if (Math.abs(d) > 1e-4) {
            this.pos[i * 3 + a] += d * kp;
            settled = false;
            moved = true;
          } else this.pos[i * 3 + a] = this.tgt[i * 3 + a];
        }
        const dg = this.growT[i] - this.grow[i];
        if (dg !== 0) {
          if (Math.abs(dg) > 0.002) {
            this.grow[i] += dg * kg;
            settled = false;
          } else this.grow[i] = this.growT[i];
          this.sizeA[i] = this.base[i] * this.grow[i];
          grew = true;
        }
        if (this.flare[i] > 0.002) {
          this.flare[i] *= fd;
          settled = false;
        } else this.flare[i] = 0;
        const dd = this.dimT[i] - this.dim[i];
        if (Math.abs(dd) > 0.004) {
          this.dim[i] += dd * kd;
          settled = false;
          dimmed = true;
        } else if (dd !== 0) {
          this.dim[i] = this.dimT[i];
          dimmed = true;
        }
        if (settled) this.active.delete(i);
      }
      const g = this.noteGeo;
      if (moved) (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
      if (grew) (g.getAttribute('aSize') as BufferAttribute).needsUpdate = true;
      if (dimmed) (g.getAttribute('aDim') as BufferAttribute).needsUpdate = true;
      (g.getAttribute('aFlare') as BufferAttribute).needsUpdate = true;
      if (moved || dimmed || grew) this.linksDirty = true;
      if (moved && this.hiFor >= 0) {
        const h = this.hiFor;
        this.hiFor = -2;
        this.buildHighlight(h);
      }
    }
    if (this.linksDirty) this.fillLinks();

    const live = this.n - this.ghosts;
    if (!this.reduced && live > 1 && !document.hidden) {
      this.ambientAcc += dt;
      const every = this.linkPairs.length ? Math.max(0.05, 0.35 - live / 20000) : 0.5;
      while (this.ambientAcc > every) {
        this.ambientAcc -= every;
        if (this.linkPairs.length) {
          const li = Math.floor(this.r() * (this.linkPairs.length / 2));
          let a = this.linkPairs[li * 2];
          let b = this.linkPairs[li * 2 + 1];
          if (this.r() < 0.5) [a, b] = [b, a];
          if (this.dimT[a] > 0.5 || this.dimT[b] > 0.5) continue;
          const c = this.col.subarray(a * 3, a * 3 + 3);
          this.spark(this.positionOf(a), b, [c[0], c[1], c[2]], 0, 0.9 + this.r() * 0.6, 0.032, 0.55, false, undefined, a);
        } else {
          this.flareNote(Math.floor(this.r() * live), 0.35);
        }
      }
    }

    this.stepAgents(dt, now);
    this.stepSparks(dt);

    if (this.pointer.dirty) this.pickHover();
    this.placeLabels();
    this.renderer.render(this.scene, this.camera);
  }

  private stepSparks(dt: number): void {
    let w = 0;
    const out = (x: number, y: number, z: number, rgb: ArrayLike<number>, size: number, alpha: number): void => {
      if (w >= SPARK_CAP) return;
      this.sparkPos[w * 3] = x;
      this.sparkPos[w * 3 + 1] = y;
      this.sparkPos[w * 3 + 2] = z;
      this.sparkCol[w * 3] = rgb[0];
      this.sparkCol[w * 3 + 1] = rgb[1];
      this.sparkCol[w * 3 + 2] = rgb[2];
      this.sparkSize[w] = size;
      this.sparkAlpha[w] = alpha;
      w++;
    };
    const keep: Spark[] = [];
    for (const s of this.sparks) {
      if (s.delay > 0) {
        s.delay -= dt;
        keep.push(s);
        continue;
      }
      s.t += dt / s.dur;
      if (s.target >= 0 && s.target < this.n) {
        s.b[0] = this.pos[s.target * 3];
        s.b[1] = this.pos[s.target * 3 + 1];
        s.b[2] = this.pos[s.target * 3 + 2];
      }
      if (s.t >= 1) {
        if (s.target >= 0) {
          this.flareNote(s.target, s.strength);
          if (s.echo) {
            const nb = this.neighbors(s.target);
            for (let k = 0; k < Math.min(4, nb.length); k++) {
              const j = nb[Math.floor(this.r() * nb.length)];
              this.spark(s.b, j, s.rgb, k * 0.05, 0.55, 0.04, 0.8, false);
            }
          }
        }
        continue;
      }
      keep.push(s);
      const trail = s.echo ? 9 : 5;
      for (let k = 0; k < trail; k++) {
        const t = s.t - k * (s.echo ? 0.022 : 0.03);
        if (t < 0) break;
        let x: number, y: number, z: number;
        if (s.from !== undefined && s.from < this.n && s.target < this.n) {
          nervePoint(this.pos, s.from, s.target, t, this.tmp3, 0);
          [x, y, z] = this.tmp3;
        } else {
          const u = 1 - t;
          x = u * u * s.a[0] + 2 * u * t * s.c[0] + t * t * s.b[0];
          y = u * u * s.a[1] + 2 * u * t * s.c[1] + t * t * s.b[1];
          z = u * u * s.a[2] + 2 * u * t * s.c[2] + t * t * s.b[2];
        }
        const f = 1 - k / trail;
        out(x, y, z, s.rgb, s.size * (0.35 + 0.65 * f), s.alpha * f * f);
      }
    }
    this.sparks = keep;

    this.agents.forEach((a) => {
      if (a.fade <= 0.01) return;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4 + a.seed);
      out(a.head[0], a.head[1], a.head[2], a.rgb, (0.32 + 0.12 * pulse + a.energy * 0.25) * (a.busy ? 1.15 : 0.85), 0.32 * a.fade);
      out(a.head[0], a.head[1], a.head[2], a.rgb, 0.1 + a.energy * 0.05, a.fade);
      for (let k = 2; k < a.histN; k += 3) {
        const idx = (a.histI - 1 - k + HIST * 2) % HIST;
        const f = 1 - k / a.histN;
        out(a.hist[idx * 3], a.hist[idx * 3 + 1], a.hist[idx * 3 + 2], a.rgb, 0.05 * f + 0.012, 0.5 * f * f * a.fade);
      }
    });

    this.sparkGeo.setDrawRange(0, w);
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) {
      const at = this.sparkGeo.getAttribute(name) as BufferAttribute;
      at.clearUpdateRanges();
      const sz = name === 'position' || name === 'aColor' ? 3 : 1;
      at.addUpdateRange(0, Math.max(1, w * sz));
      at.needsUpdate = true;
    }
  }

  private stepAgents(dt: number, now: number): void {
    let v = 0;
    this.agents.forEach((a, key) => {
      const idle = now - a.last;
      const dock = idle > AGENT_IDLE_MS && a.busy === 0 ? this.dockWorld() : null;
      if (dock) a.target = dock;
      const docked = !!dock && Math.hypot(a.head[0] - dock[0], a.head[1] - dock[1], a.head[2] - dock[2]) < 0.35;
      const alive = idle < AGENT_TTL && !docked;
      a.fade += ((alive ? 1 : 0) - a.fade) * Math.min(1, dt * 2.5);
      a.energy *= Math.exp(-dt * 0.8);
      if (!alive && a.fade < 0.02) {
        a.el.remove();
        this.agents.delete(key);
        return;
      }
      if (!this.reduced) {
        const t = this.time;
        const wob = 0.09 + 0.06 * a.energy;
        const tx = a.target[0] + Math.sin(t * 1.3 + a.seed) * wob;
        const ty = a.target[1] + Math.sin(t * 1.7 + a.seed * 2) * wob;
        const tz = a.target[2] + Math.sin(t * 1.1 + a.seed * 3) * wob;
        for (let k = 0; k < 3; k++) {
          const tt = k === 0 ? tx : k === 1 ? ty : tz;
          const acc = (tt - a.head[k]) * 7 - a.vel[k] * 3.6;
          a.vel[k] += acc * dt;
          a.head[k] += a.vel[k] * dt;
        }
      } else {
        a.head = [a.target[0], a.target[1], a.target[2]];
      }
      a.hist.set(a.head, a.histI * 3);
      a.histI = (a.histI + 1) % HIST;
      a.histN = Math.min(HIST, a.histN + 1);
      a.el.classList.toggle('busy', a.busy > 0);
      for (let k = 0; k < a.histN - 1 && v + 2 <= TRAIL_CAP; k++) {
        const i0 = (a.histI - 1 - k + HIST * 2) % HIST;
        const i1 = (a.histI - 2 - k + HIST * 2) % HIST;
        const f0 = Math.pow(1 - k / a.histN, 1.6) * a.fade;
        const f1 = Math.pow(1 - (k + 1) / a.histN, 1.6) * a.fade;
        this.trailPos.set(a.hist.subarray(i0 * 3, i0 * 3 + 3), v * 3);
        this.trailPos.set(a.hist.subarray(i1 * 3, i1 * 3 + 3), v * 3 + 3);
        this.trailCol.set(a.rgb, v * 3);
        this.trailCol.set(a.rgb, v * 3 + 3);
        this.trailAlpha[v] = f0;
        this.trailAlpha[v + 1] = f1;
        v += 2;
      }
    });
    this.trailGeo.setDrawRange(0, v);
    for (const name of ['position', 'aColor', 'aAlpha']) {
      (this.trailGeo.getAttribute(name) as BufferAttribute).needsUpdate = true;
    }
  }
}
