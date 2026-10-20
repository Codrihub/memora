// The canvas board: camera, rendering, virtualization and every interaction.
// Cards and frames are DOM (crisp text, CSS transforms on two world layers);
// wikilink connectors are painted on a canvas sandwiched between them.

import { apiGet } from '../api';
import { on, type AgentActivity } from '../bus';
import { esc } from '../dom';
import { noteName, relTs } from '../format';
import { agentColor } from '../control/agents';
import { hooks } from '../hooks';
import { Modal } from '../modal';
import { colorOfFolder, folderNames, state } from '../state';
import type { GraphData, LogEvent, WsEvent } from '../types';
import { paintLinks, paintMinimap, type LinkPair } from './draw';
import { excerptOf, holdExcerpts, invalidate, keepOnly, moveExcerpt, onExcerpt, want } from './excerpts';
import {
  CARD_H,
  CARD_W,
  boundsOf,
  cardBox,
  cleanFolderName,
  contains,
  contentSize,
  frameBox,
  freeFramePos,
  freeSlot,
  initials,
  movedPath,
  normalizeFrame,
  overlaps,
  packFrames,
  separateFrames,
  renamedPath,
  tidyFrame,
  type Box,
  type Cam,
  type Card,
  type Frame,
  type SavedLayout,
} from './model';
import * as ops from './ops';
import { flushLayout, loadLayout, saveLayout } from './store';
import { buildChrome, CURSOR_SVG, ICON, Toast, type Chrome } from './ui';
import { NodeCard, type CardLink } from '../ui/node-card';
import { toggleHTML, ViewChrome } from '../ui/view-chrome';

/** Run a vault write with excerpt fetching paused, so the write is not queued behind reads. */
async function held<T>(p: () => Promise<T>): Promise<T> {
  holdExcerpts(true);
  try {
    return await p();
  } finally {
    holdExcerpts(false);
  }
}
const moveNote = (path: string, folder: string): Promise<string> => held(() => ops.moveNote(path, folder));
const renameNote = (path: string, name: string): Promise<string> => held(() => ops.renameNote(path, name));
const moveMany = (paths: string[], folder: string): Promise<ops.BatchResult> => held(() => ops.moveMany(paths, folder));
const setFolderColor = (folder: string, color: string): Promise<void> => held(() => ops.setFolderColor(folder, color));

const MIN_Z = 0.04;
const MAX_Z = 4;
const LOD1 = 0.45;
const LOD2 = 0.2;
const TOUCH_MS = 10 * 60 * 1000;
const LONG_PRESS = 380;

type Gesture =
  | { kind: 'pan'; lx: number; ly: number; samples: { x: number; y: number; t: number }[]; d?: number }
  | { kind: 'pinch'; d0: number; z0: number; cx: number; cy: number }
  | { kind: 'card-pending'; card: Card; sx: number; sy: number; shift: boolean; touch: boolean; timer: number }
  | {
      kind: 'card-drag';
      cards: { c: Card; wx: number; wy: number; from: string; fx: number; fy: number }[];
      sx: number;
      sy: number;
      px: number;
      py: number;
      lead: Card;
      drop: Frame | null;
    }
  | { kind: 'marquee-pending'; sx: number; sy: number; shift: boolean }
  | { kind: 'marquee'; sx: number; sy: number; px: number; py: number; base: Set<string> }
  | { kind: 'frame-pending'; frame: Frame; sx: number; sy: number }
  | { kind: 'frame-drag'; frames: { f: Frame; x: number; y: number }[]; sx: number; sy: number; px: number; py: number; drop: Frame | null }
  | { kind: 'resize'; frame: Frame; sx: number; sy: number; w: number; h: number };

interface Tween {
  t0: number;
  ms: number;
  items: { o: { x: number; y: number }; fx: number; fy: number; tx: number; ty: number }[];
}

export class Board {
  private root!: HTMLElement;
  private bg!: HTMLElement;
  private fg!: HTMLElement;
  private linkCv!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private ui!: Chrome;
  private marquee!: HTMLElement;
  private empty!: HTMLElement;
  private toast!: Toast;
  private panel!: NodeCard;

  private frames = new Map<string, Frame>();
  private cards = new Map<string, Card>();
  private links: LinkPair[] = [];
  private linkCount = new Map<string, number>();
  private layout: SavedLayout = { v: 1, frames: {}, cards: {} };

  private cam: Cam = { x: 0, y: 0, z: 1 };
  private W = 1;
  private H = 1;
  private dpr = 1;
  private lod = 0;

  private sel = new Set<string>();
  private selFrames = new Set<string>();
  private hover: string | null = null;
  private tool: 'select' | 'hand' = 'select';
  private space = false;
  private showLinks = true;
  private vc!: ViewChrome;
  /** Folders switched off in Regions: their frames, cards and links are not drawn. */
  private hiddenFrames = loadHiddenFrames();
  private labelPrefs = loadLabelPrefs();

  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private g: Gesture | null = null;
  private zoomAnim: { zt: number; ax: number; ay: number } | null = null;
  private fly: { t0: number; ms: number; c0: [number, number, number]; c1: [number, number, number] } | null = null;
  private inertia: { vx: number; vy: number; t: number } | null = null;
  private tween: Tween | null = null;
  private edge: { vx: number; vy: number } | null = null;

  private raf = 0;
  private geomDirty = true;
  private miniAt = 0;
  private miniMap = { s: 1, ox: 0, oy: 0 };
  private movingTimer = 0;
  private camSaveTimer = 0;
  private active = false;
  private ready = false;
  private unsubs: (() => void)[] = [];
  private cursors = new Map<string, { el: HTMLElement; timer: number }>();
  private undoStack: { label: string; run: () => Promise<void> }[] = [];
  private flashPending = new Set<string>();
  private linksTimer = 0;
  private syncTimer = 0;
  private decayTimer = 0;
  private busy = false;
  private needFit = false;
  private sizes = new WeakMap<Frame, string>();

  constructor(private host: HTMLElement) {}

  // ───────────────────────────── setup ─────────────────────────────

  async init(): Promise<void> {
    this.build();
    this.layout = await loadLayout();
    this.showLinks = this.layout.links !== false;
    this.syncButtons();
    this.sync();
    // Every visit opens on the whole board, centred (see activate()).
    if (this.layout.view && isFinite(this.layout.view.z)) this.cam = { ...this.layout.view };
    this.needFit = true;
    this.ready = true;
    this.fitIfNeeded();
    this.activate();
    void this.loadLinks();
    void this.seedTouches();
    observeVisibility(this.host, (vis) => (vis ? this.activate() : this.deactivate()));
  }

  /** Called by renderCanvas on every visit and by refreshPage after mutations. */
  refresh(): void {
    if (!this.ready) return;
    this.activate();
    this.sync();
    this.scheduleLinks();
  }

  private build(): void {
    this.host.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'cv';
    root.tabIndex = -1;
    this.root = root;
    this.bg = document.createElement('div');
    this.bg.className = 'cv-layer cv-bg';
    this.linkCv = document.createElement('canvas');
    this.linkCv.className = 'cv-links';
    this.fg = document.createElement('div');
    this.fg.className = 'cv-layer cv-fg';
    this.marquee = document.createElement('div');
    this.marquee.className = 'cv-marquee hidden';
    this.empty = document.createElement('div');
    this.empty.className = 'cv-empty hidden';
    this.empty.textContent = 'No nodes in this vault yet.';
    root.append(this.bg, this.linkCv, this.fg, this.marquee, this.empty);
    this.host.appendChild(root);
    this.ctx = this.linkCv.getContext('2d')!;
    this.ui = buildChrome(root);
    this.vc = this.buildViewChrome(root);
    this.applyLabelPrefs();
    this.toast = new Toast(this.ui.toast);
    this.panel = this.buildCard(root);

    root.addEventListener('pointerdown', (e) => this.onDown(e));
    root.addEventListener('pointermove', (e) => this.onMove(e));
    root.addEventListener('pointerup', (e) => this.onUp(e));
    root.addEventListener('pointercancel', (e) => this.onUp(e, true));
    root.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    root.addEventListener('dblclick', (e) => this.onDbl(e));
    root.addEventListener('contextmenu', (e) => {
      if (!(e.target as HTMLElement).closest('input')) e.preventDefault();
    });
    root.addEventListener('gesturestart', (e) => e.preventDefault());
    this.wireChrome();
    new ResizeObserver(() => this.resize()).observe(root);
    this.resize();
    onExcerpt((p) => {
      const c = this.cards.get(p);
      if (c && c.el) this.fillCard(c);
    });
  }

  private wireChrome(): void {
    const ui = this.ui;
    const act = (e: MouseEvent): void => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b) return;
      this.command(b.dataset.act || '');
    };
    ui.tools.addEventListener('click', act);
    ui.selbar.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-fchip]');
      if (chip) {
        this.focusFolder(chip.dataset.fchip || '');
        return;
      }
      act(e);
    });
    ui.scrim.onclick = () => this.toggleHelp(false);
  }

  private onKeyBound = (e: KeyboardEvent): void => this.onKey(e);
  private onKeyUpBound = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.space = false;
      this.root.classList.toggle('hand', this.tool === 'hand');
    }
  };
  private onBlurBound = (): void => {
    this.space = false;
  };

  private activate(): void {
    if (this.active || !this.ready || this.host.classList.contains('hidden')) return;
    this.active = true;
    this.vc.shown();
    this.needFit = true;
    window.addEventListener('keydown', this.onKeyBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    window.addEventListener('blur', this.onBlurBound);
    this.unsubs.push(on('activity', (a) => this.onActivity(a)));
    this.unsubs.push(on('mutation', (m) => this.onMutation(m)));
    this.decayTimer = window.setInterval(() => this.decayTouches(), 30000);
    this.resize();
    this.kick(true);
  }

  private deactivate(): void {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('keydown', this.onKeyBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    window.removeEventListener('blur', this.onBlurBound);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    clearInterval(this.decayTimer);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    // A gesture cut short by the view hiding: put dragged items back and
    // forget pointers whose pointerup will never arrive.
    this.cancelGesture();
    this.pointers.clear();
    this.edge = null;
    this.persist(true);
    flushLayout();
  }

  private resize(): void {
    const r = this.root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.W = r.width;
    this.H = r.height;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.linkCv.width = Math.round(this.W * this.dpr);
    this.linkCv.height = Math.round(this.H * this.dpr);
    this.fitIfNeeded();
    this.kick(true);
  }

  // ───────────────────────────── data ─────────────────────────────

  private frameOf = (c: Card): Frame | undefined => this.frames.get(c.folder);

  /** Reconcile the board with state.tree: add, move and drop cards and frames. */
  private sync(): void {
    const seen = new Set<string>();
    const fresh: Frame[] = [];
    const noLayout = !Object.keys(this.layout.frames).length && !this.frames.size;
    for (const folder of folderNames()) {
      const notes = state.tree[folder] || [];
      if (!notes.length) continue;
      let f = this.frames.get(folder);
      let isNew = false;
      if (!f) {
        const saved = this.layout.frames[folder];
        f = { name: folder, x: 0, y: 0, w: 0, h: 0, cards: [], el: null };
        if (saved) Object.assign(f, { x: saved.x, y: saved.y, w: saved.w, h: saved.h });
        else {
          isNew = true;
          fresh.push(f);
        }
        this.frames.set(folder, f);
      }
      for (const n of notes) {
        seen.add(n.path);
        let c = this.cards.get(n.path);
        if (c) {
          const changed = c.mtime !== n.mtime || c.name !== n.name;
          c.mtime = n.mtime;
          c.name = n.name || noteName(n.path);
          if (c.folder !== folder) {
            const old = this.frames.get(c.folder);
            if (old) old.cards = old.cards.filter((x) => x !== c);
            c.folder = folder;
            const slot = freeSlot(f);
            c.x = slot.x;
            c.y = slot.y;
            f.cards.push(c);
            this.flashPending.add(c.path);
          }
          if (changed && c.el) this.fillCard(c);
        } else {
          const saved = this.layout.cards[n.path];
          c = {
            path: n.path,
            name: n.name || noteName(n.path),
            folder,
            mtime: n.mtime,
            x: 0,
            y: 0,
            el: null,
            touch: null,
            drag: false,
          };
          if (saved && !isNew) {
            c.x = saved.x;
            c.y = saved.y;
          } else if (!isNew) {
            const slot = freeSlot(f);
            c.x = slot.x;
            c.y = slot.y;
          }
          f.cards.push(c);
          this.cards.set(n.path, c);
          if (this.ready) this.flashPending.add(n.path);
        }
      }
    }
    for (const [p, c] of this.cards) {
      if (seen.has(p)) continue;
      const f = this.frames.get(c.folder);
      if (f) f.cards = f.cards.filter((x) => x !== c);
      c.el?.remove();
      this.cards.delete(p);
      this.sel.delete(p);
    }
    for (const [name, f] of this.frames) {
      if (f.cards.length) continue;
      f.el?.remove();
      f.el = null;
      this.frames.delete(name);
      this.selFrames.delete(name);
    }
    for (const f of fresh) tidyFrame(f);
    if (noLayout) packFrames(Array.from(this.frames.values()));
    else if (fresh.length) {
      const others = Array.from(this.frames.values()).filter((f) => !fresh.includes(f));
      for (const f of fresh) {
        const p = freeFramePos(others);
        f.x = p.x;
        f.y = p.y;
        others.push(f);
      }
    }
    for (const f of this.frames.values()) {
      normalizeFrame(f);
      const b = frameBox(f);
      const key = Math.round(b.w) + 'x' + Math.round(b.h);
      if (this.sizes.get(f) !== key) {
        if (this.sizes.has(f) || !this.ready) this.separate(f);
        this.sizes.set(f, key);
      }
      if (f.el && f.el.style.getPropertyValue('--fc') !== colorOfFolder(f.name)) {
        this.fillFrame(f);
        for (const c of f.cards) if (c.el) c.el.style.setProperty('--fc', colorOfFolder(c.folder));
      }
    }
    for (const p of this.flashPending) {
      const c = this.cards.get(p);
      if (c && c.el) this.flash(c);
    }
    this.empty.classList.toggle('hidden', this.cards.size > 0);
    this.fitIfNeeded();
    this.paintInfo();
    this.geomDirty = true;
    this.persist();
    this.kick(true);
  }

  /** Keep frames from overlapping after `f` grew or moved. */
  private separate(f: Frame | undefined): void {
    if (f && this.frames.has(f.name)) separateFrames(Array.from(this.frames.values()), f);
  }

  /** First visit without a saved view: fit once there is a size and content. */
  private fitIfNeeded(): void {
    if (!this.needFit || !this.ready || this.W < 50 || !this.frames.size) return;
    this.needFit = false;
    this.fitTo(this.allBounds(), false);
  }

  private scheduleLinks(): void {
    clearTimeout(this.linksTimer);
    this.linksTimer = window.setTimeout(() => void this.loadLinks(), 500);
  }

  private async loadLinks(): Promise<void> {
    let g: GraphData;
    try {
      g = await apiGet<GraphData>('/api/graph');
    } catch {
      return;
    }
    const byName = new Map<string, string>();
    for (const n of g.nodes || []) if (n.path && !byName.has(n.id)) byName.set(n.id, n.path);
    const pairs: LinkPair[] = [];
    const count = new Map<string, number>();
    const seen = new Set<string>();
    for (const l of g.links || []) {
      const a = this.cards.get(byName.get(l.source) || '');
      const b = this.cards.get(byName.get(l.target) || '');
      if (!a || !b || a === b) continue;
      const k = a.path + '\n' + b.path;
      if (seen.has(k)) continue;
      seen.add(k);
      pairs.push({ a, b });
      count.set(a.path, (count.get(a.path) || 0) + 1);
      count.set(b.path, (count.get(b.path) || 0) + 1);
    }
    this.links = pairs;
    this.linkCount = count;
    for (const c of this.cards.values()) if (c.el) this.fillCard(c);
    this.paintInfo();
    this.kick();
  }

  /** Mark cards agents touched in the last hour, from the activity log. */
  private async seedTouches(): Promise<void> {
    try {
      const r = await apiGet<{ events?: LogEvent[] }>('/api/logs?range=1h&limit=300');
      const me = state.me?.user || state.me?.username || '';
      const now = Date.now();
      for (const ev of (r.events || []).slice().reverse()) {
        const actor = String(ev.actor || ev.by || ev.user || '');
        const path = String(ev.path || (ev.node && ev.node.path) || '');
        if (!actor || !path || actor === me || actor === 'web' || actor === 'browser') continue;
        const at = Number(ev.ts || 0) * 1000;
        if (!at || now - at > TOUCH_MS) continue;
        const c = this.findCard(path);
        if (c && (!c.touch || c.touch.at < at)) {
          c.touch = { actor, label: String(ev.action || ev.label || ev.event || 'edit'), at, live: false };
          if (c.el) this.fillCard(c);
        }
      }
    } catch {
      /* activity is decoration */
    }
  }

  private persist(now = false): void {
    if (!this.ready) return;
    const frames: SavedLayout['frames'] = {};
    const cards: SavedLayout['cards'] = {};
    for (const f of this.frames.values()) {
      frames[f.name] = { x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.w), h: Math.round(f.h) };
      for (const c of f.cards) cards[c.path] = { x: Math.round(c.x), y: Math.round(c.y) };
    }
    const view = { x: Math.round(this.cam.x), y: Math.round(this.cam.y), z: +this.cam.z.toFixed(4) };
    this.layout = { v: 1, view, frames, cards, links: this.showLinks, minimap: this.vc.prefs.minimap };
    saveLayout(this.layout, now);
  }

  private saveCamSoon(): void {
    clearTimeout(this.camSaveTimer);
    this.camSaveTimer = window.setTimeout(() => this.persist(), 900);
  }

  // ───────────────────────────── rendering ─────────────────────────────

  private kick(geom = false): void {
    if (geom) this.geomDirty = true;
    if (!this.raf && this.active) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private markMoving(): void {
    this.root.classList.add('moving');
    clearTimeout(this.movingTimer);
    this.movingTimer = window.setTimeout(() => this.root.classList.remove('moving'), 160);
  }

  private frame(now: number): void {
    this.raf = 0;
    let more = false;
    const cam = this.cam;
    const z0 = cam.z;
    const x0 = cam.x;
    const y0 = cam.y;

    if (this.fly) {
      const t = Math.min(1, (now - this.fly.t0) / this.fly.ms);
      const e = 1 - Math.pow(1 - t, 3);
      const [ax, ay, az] = this.fly.c0;
      const [bx, by, bz] = this.fly.c1;
      const z = Math.exp(Math.log(az) + (Math.log(bz) - Math.log(az)) * e);
      const cx = ax + (bx - ax) * e;
      const cy = ay + (by - ay) * e;
      cam.z = z;
      cam.x = this.W / 2 - cx * z;
      cam.y = this.H / 2 - cy * z;
      if (t >= 1) {
        this.fly = null;
        this.saveCamSoon();
      } else more = true;
    }
    if (this.zoomAnim) {
      const a = this.zoomAnim;
      let nz = cam.z + (a.zt - cam.z) * 0.28;
      if (Math.abs(a.zt - nz) < a.zt * 0.002) {
        nz = a.zt;
        this.zoomAnim = null;
        this.saveCamSoon();
      } else more = true;
      const wx = (a.ax - cam.x) / cam.z;
      const wy = (a.ay - cam.y) / cam.z;
      cam.z = nz;
      cam.x = a.ax - wx * nz;
      cam.y = a.ay - wy * nz;
    }
    if (this.inertia) {
      const i = this.inertia;
      const dt = Math.min(48, now - i.t || 16);
      i.t = now;
      cam.x += i.vx * dt;
      cam.y += i.vy * dt;
      const k = Math.pow(0.93, dt / 16);
      i.vx *= k;
      i.vy *= k;
      if (Math.hypot(i.vx, i.vy) < 0.015) {
        this.inertia = null;
        this.saveCamSoon();
      } else more = true;
    }
    if (this.edge && this.g && (this.g.kind === 'card-drag' || this.g.kind === 'frame-drag')) {
      cam.x -= this.edge.vx;
      cam.y -= this.edge.vy;
      this.dragMove(this.g.px, this.g.py);
      more = true;
    }
    if (this.tween) {
      const tw = this.tween;
      const t = Math.min(1, (now - tw.t0) / tw.ms);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      for (const it of tw.items) {
        it.o.x = it.fx + (it.tx - it.fx) * e;
        it.o.y = it.fy + (it.ty - it.fy) * e;
      }
      this.geomDirty = true;
      if (t >= 1) this.tween = null;
      else more = true;
    }

    const camMoved = cam.x !== x0 || cam.y !== y0 || cam.z !== z0;
    if (camMoved) this.markMoving();
    this.applyCam();
    if (camMoved || this.geomDirty) this.virtualize();
    if (this.geomDirty) this.placeAll();
    this.geomDirty = false;
    this.drawLinks();
    if (this.vc.prefs.minimap && (now - this.miniAt > 60 || !more)) {
      this.miniAt = now;
      this.drawMini();
    }
    if (more) this.kick();
  }

  private applyCam(): void {
    const { x, y, z } = this.cam;
    const t = `translate(${x}px,${y}px) scale(${z})`;
    this.bg.style.transform = t;
    this.fg.style.transform = t;
    const s = this.root.style;
    s.setProperty('--z', String(z));
    s.setProperty('--iz', String(1 / z));
    s.setProperty('--lz', String(Math.min(1 / z, 4.2) * (z < 0.6 ? 1.15 : 1)));
    let step = 24;
    while (step * z < 14) step *= 2;
    while (step * z > 56) step /= 2;
    const gs = step * z;
    s.backgroundImage = `radial-gradient(circle, var(--cv-dot) ${z > 0.6 ? 1.1 : 0.9}px, transparent ${z > 0.6 ? 1.5 : 1.3}px)`;
    s.backgroundSize = `${gs}px ${gs}px`;
    s.backgroundPosition = `${x % gs}px ${y % gs}px`;
    const lod = z < LOD2 ? 2 : z < LOD1 ? 1 : 0;
    if (lod !== this.lod) {
      this.lod = lod;
      this.root.classList.toggle('lod1', lod >= 1);
      this.root.classList.toggle('lod2', lod === 2);
      this.geomDirty = true;
    }
    this.ui.zoom.textContent = Math.round(z * 100) + '%';
  }

  private viewBox(margin = 0): Box {
    const z = this.cam.z;
    return {
      x: -this.cam.x / z - margin / z,
      y: -this.cam.y / z - margin / z,
      w: this.W / z + (2 * margin) / z,
      h: this.H / z + (2 * margin) / z,
    };
  }

  /** Mount the cards in view, unmount the rest (except ones being dragged or edited). */
  private virtualize(): void {
    const vb = this.viewBox(240);
    const visible = new Set<string>();
    for (const f of this.frames.values()) {
      if (!f.el) this.mountFrame(f);
      const off = this.hiddenFrames.has(f.name);
      f.el!.style.display = off ? 'none' : '';
      for (const c of f.cards) {
        const keep = !off && (c.drag || (c.el && c.el.querySelector('input')));
        const inView = !off && this.lod < 2 && overlaps(vb, cardBox(f, c));
        if (inView || keep) {
          visible.add(c.path);
          if (!c.el) {
            this.mountCard(c);
            this.placeCard(c, f);
          }
        } else if (c.el) {
          c.el.remove();
          c.el = null;
        }
      }
    }
    keepOnly(visible);
  }

  private placeAll(): void {
    for (const f of this.frames.values()) {
      this.placeFrame(f);
      for (const c of f.cards) if (c.el) this.placeCard(c, f);
    }
  }

  private mountFrame(f: Frame): void {
    const e = document.createElement('div');
    e.className = 'cv-frame';
    e.dataset.frame = f.name;
    e.innerHTML = `<div class="cv-flabel" title="Drag to move the folder frame; double-click to rename"><i class="cv-fdot"></i><span class="cv-ftitle"></span><span class="cv-fcount"></span><button class="cv-fbtn" data-fact="tidy" title="Tidy this frame">⊞</button><button class="cv-fbtn" data-fact="color" title="Folder color">◐</button></div><div class="cv-fresize" title="Resize frame"></div>`;
    f.el = e;
    this.bg.appendChild(e);
    this.fillFrame(f);
  }

  private fillFrame(f: Frame): void {
    if (!f.el) return;
    f.el.style.setProperty('--fc', colorOfFolder(f.name));
    const t = f.el.querySelector<HTMLElement>('.cv-ftitle')!;
    if (!t.querySelector('input')) t.textContent = f.name;
    f.el.querySelector<HTMLElement>('.cv-fcount')!.textContent = String(f.cards.length);
    f.el.classList.toggle('sel', this.selFrames.has(f.name));
  }

  private placeFrame(f: Frame): void {
    if (!f.el) return;
    const b = frameBox(f);
    f.el.style.transform = `translate(${b.x}px,${b.y}px)`;
    f.el.style.width = b.w + 'px';
    f.el.style.height = b.h + 'px';
    const cnt = f.el.querySelector<HTMLElement>('.cv-fcount');
    if (cnt && cnt.textContent !== String(f.cards.length)) cnt.textContent = String(f.cards.length);
  }

  private mountCard(c: Card): void {
    const e = document.createElement('div');
    e.className = 'cv-card';
    e.dataset.path = c.path;
    c.el = e;
    this.fillCard(c);
    this.fg.appendChild(e);
    if (this.flashPending.has(c.path)) this.flash(c);
  }

  private fillCard(c: Card): void {
    const e = c.el;
    if (!e) return;
    if (e.querySelector('input')) return;
    const ex = excerptOf(c.path);
    if (!ex || ex.m < c.mtime) want(c.path, c.mtime);
    const tags = ex ? ex.tags.slice(0, 3).map((t) => `<span>#${esc(t)}</span>`).join('') : '';
    const n = this.linkCount.get(c.path) || 0;
    const t = c.touch && Date.now() - c.touch.at < TOUCH_MS ? c.touch : null;
    const ac = t ? agentColor(t.actor) : '';
    e.style.setProperty('--fc', colorOfFolder(c.folder));
    if (ac) e.style.setProperty('--ac', ac);
    e.classList.toggle('touched', !!t);
    e.classList.toggle('live', !!(t && t.live));
    e.classList.toggle('sel', this.sel.has(c.path));
    this.markHit(c);
    e.innerHTML = `<div class="cv-ctitle"><span>${esc(c.name)}</span></div>
      <div class="cv-cex${ex ? '' : ' loading'}">${ex ? esc(ex.text) : ''}</div>
      <div class="cv-ctags">${tags}</div>
      <div class="cv-cfoot"><span title="Last edited">${esc(relTs(c.mtime))}</span>${
        n ? `<span title="${n} wikilinks">↔ ${n}</span>` : ''
      }<span class="grow"></span>${
        t
          ? `<span class="cv-agent${t.live ? ' live' : ''}" title="${esc(t.actor)}: ${esc(t.label)} (${esc(
              relTs(t.at / 1000),
            )})">${esc(initials(t.actor))}</span>`
          : ''
      }</div>
      <button class="cv-copen" title="Preview (Enter)" aria-label="Preview">${ICON.open}</button>`;
  }

  private placeCard(c: Card, f = this.frameOf(c)): void {
    if (!c.el || !f) return;
    c.el.style.transform = `translate(${f.x + c.x}px,${f.y + c.y}px)`;
  }

  private flash(c: Card): void {
    this.flashPending.delete(c.path);
    if (!c.el) return;
    c.el.classList.remove('flash');
    void c.el.offsetWidth;
    c.el.classList.add('flash');
  }

  private drawLinks(): void {
    const focus = this.hover || this.sel.size ? new Set<string>(this.sel) : null;
    if (focus && this.hover) focus.add(this.hover);
    const pending = paintLinks(this.ctx, {
      cam: this.cam,
      w: this.W,
      h: this.H,
      dpr: this.dpr,
      links: this.hiddenFrames.size ? this.links.filter((l) => !this.hiddenFrames.has(l.a.folder) && !this.hiddenFrames.has(l.b.folder)) : this.links,
      showLinks: this.showLinks,
      focus,
      paintCards: this.lod === 2,
      frames: this.shownFrames(),
      frameOf: this.frameOf,
      color: colorOfFolder,
      selected: this.sel,
      light: document.documentElement.dataset.theme === 'light',
    });
    // Wires are routed a batch per frame; keep drawing until all are in.
    if (pending) this.kick();
  }

  private drawMini(): void {
    this.vc.redrawMini();
  }

  private paintMini(cv: HTMLCanvasElement, w: number, h: number, dpr: number): void {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    this.miniMap = paintMinimap(ctx, {
      w,
      h,
      dpr,
      frames: this.shownFrames(),
      color: colorOfFolder,
      view: this.viewBox(),
      light: document.documentElement.dataset.theme === 'light',
    });
  }

  /** Regions follow the board as frames come and go. */
  private paintInfo(): void {
    this.vc?.refreshRegions();
  }

  // ───────────────────────────── shared chrome ─────────────────────────────

  private applyLabelPrefs(): void {
    this.root.classList.toggle('no-node-text', !this.labelPrefs.nodes);
    this.root.classList.toggle('no-folder-titles', !this.labelPrefs.folders);
  }

  /** Fly to a folder's frame and flash it. */
  private focusFolder(name: string): void {
    const f = this.frames.get(name);
    if (!f) return;
    if (this.hiddenFrames.has(name)) {
      const next = new Set(this.hiddenFrames);
      next.delete(name);
      this.setHiddenFrames(next);
      this.vc.refreshRegions();
    }
    this.fitTo(frameBox(f));
    this.flashFrame(f);
  }

  /** A short glow round a frame, so it is clear which folder the view went to. */
  private flashFrame(f: Frame): void {
    window.setTimeout(() => {
      const el = f.el;
      if (!el) return;
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
      window.setTimeout(() => el.classList.remove('flash'), 1700);
    }, 250);
  }

  private shownFrames(): Frame[] {
    const all = Array.from(this.frames.values());
    return this.hiddenFrames.size ? all.filter((f) => !this.hiddenFrames.has(f.name)) : all;
  }

  private setHiddenFrames(names: Iterable<string>): void {
    this.hiddenFrames = new Set(names);
    saveHiddenFrames(this.hiddenFrames);
    for (const p of Array.from(this.sel)) if (this.hiddenFrames.has(this.cards.get(p)?.folder || '')) this.sel.delete(p);
    this.paintSelection();
    this.geomDirty = true;
    this.kick(true);
    requestAnimationFrame(() => this.vc.redrawMini());
  }

  /** The chrome shared with Brain and Graph. */
  private buildViewChrome(root: HTMLElement): ViewChrome {
    const panTo = (dx: number, dy: number): void => {
      const z = this.cam.z;
      const c0: [number, number, number] = [(this.W / 2 - this.cam.x) / z, (this.H / 2 - this.cam.y) / z, z];
      this.zoomAnim = null;
      this.inertia = null;
      this.fly = { t0: performance.now(), ms: 200, c0, c1: [c0[0] + (dx * this.W * 0.16) / z, c0[1] + (dy * this.H * 0.16) / z, z] };
      this.kick();
      this.saveCamSoon();
    };
    return new ViewChrome({
      page: 'canvas',
      root,
      search: {
        placeholder: 'Find a node, #tag or in:folder',
        find: {
          items: () => {
            // Tags and links come with the graph data.
            const meta = new Map(state.graph.nodes.map((n) => [n.path || n.id, n as { tags?: unknown; degree?: number }]));
            return Array.from(this.cards.values()).map((c) => {
              const m = meta.get(c.path);
              return {
                id: c.path,
                name: c.name,
                folder: c.folder,
                region: c.folder,
                color: colorOfFolder(c.folder),
                tags: Array.isArray(m?.tags) ? m.tags.map(String) : [],
                degree: m?.degree || 0,
              };
            });
          },
          hidden: (f) => this.hiddenFrames.has(f),
          highlight: (ids) => this.lightCards(ids),
          pick: (it) => {
            const c = this.cards.get(it.id);
            if (!c) return;
            this.reveal(c, true);
            void this.openPanel(c);
          },
          folder: (f) => {
            this.focusFolder(f);
            this.openFolderCard(f);
          },
        },
      },
      changed: () =>
        !this.labelPrefs.nodes ||
        !this.labelPrefs.folders ||
        !this.showLinks ||
        this.hiddenFrames.size > 0 ||
        !!this.hits ||
        !!this.panel?.isOpen ||
        this.sel.size > 0 ||
        this.selFrames.size > 0,
      labels: {
        get: () => ({ nodes: this.labelPrefs.nodes, folders: this.labelPrefs.folders }),
        set: (kind, on) => {
          this.labelPrefs[kind] = on;
          saveLabelPrefs(this.labelPrefs);
          this.applyLabelPrefs();
        },
        help: {
          nodes: 'The preview text, tags and footer on each card. Titles always stay.',
          folders: 'The name and count over each folder frame.',
        },
      },
      filter: (host) => this.renderFilter(host),
      reset: () => {
        this.labelPrefs = { nodes: true, folders: true };
        saveLabelPrefs(this.labelPrefs);
        this.applyLabelPrefs();
        this.showLinks = true;
        this.syncButtons();
        this.persist();
        this.vc.finder?.clear();
        this.closePanel();
        this.setHiddenFrames([]);
        // The board itself back to its default layout: every frame tidied
        // into a grid and the frames packed from the origin, so aligning or
        // distributing never survives a reset. Then the whole board, centred.
        this.select([]);
        this.selFrames.clear();
        this.paintSelection();
        this.animate(() => {
          for (const f of this.frames.values()) tidyFrame(f);
          packFrames(Array.from(this.frames.values()), 0, 0);
        });
        window.setTimeout(() => this.fitTo(this.allBounds()), 420);
      },
      regions: {
        list: () =>
          Array.from(this.frames.values())
            .sort((a, b) => b.cards.length - a.cards.length || a.name.localeCompare(b.name))
            .map((f) => ({ name: f.name, color: colorOfFolder(f.name), count: f.cards.length, hidden: this.hiddenFrames.has(f.name) })),
        toggle: (name) => {
          const next = new Set(this.hiddenFrames);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          this.setHiddenFrames(next);
        },
        setAll: (hide) => this.setHiddenFrames(hide ? Array.from(this.frames.keys()) : []),
        focus: (name) => {
          const f = this.frames.get(name);
          if (!f) return;
          this.fitTo(frameBox(f));
          this.flashFrame(f);
          this.openFolderCard(name);
        },
      },
      nav: {
        zoom: (f) => this.zoomAt(f, this.W / 2, this.H / 2),
        fit: () => this.fitTo(this.allBounds()),
        nudge: panTo,
        home: () => this.fitTo(this.allBounds()),
      },
      minimap: (cv, w, h, dpr) => this.paintMini(cv, w, h, dpr),
      minimapNav: (fx, fy) => {
        const r = this.vc.miniCanvas.getBoundingClientRect();
        const m = this.miniMap;
        const wx = (fx * r.width - m.ox) / m.s;
        const wy = (fy * r.height - m.oy) / m.s;
        this.stopAnims();
        this.cam.x = this.W / 2 - wx * this.cam.z;
        this.cam.y = this.H / 2 - wy * this.cam.z;
        this.kick(true);
        this.saveCamSoon();
      },
      onPrefs: () => this.kick(),
      onOverlay: () => this.closePanel(),
    });
  }

  /** Cards matching the search (null: no search). Highlighted, not selected. */
  private hits: Set<string> | null = null;

  /** Light the cards the finder matched; null clears. */
  private lightCards(ids: Set<string> | null): void {
    this.hits = ids;
    this.root.classList.toggle('searching', !!this.hits);
    for (const c of this.cards.values()) if (c.el) this.markHit(c);
  }

  private markHit(c: Card): void {
    const on = !!this.hits && this.hits.has(c.path);
    c.el?.classList.toggle('hit', on);
  }

  /** The canvas's own section of the Filter panel. */
  private renderFilter(host: HTMLElement): void {
    host.innerHTML =
      '<h4>Canvas</h4>' +
      toggleHTML('links', 'Wikilink wires', this.showLinks, 'Lines between cards for every [[wikilink]], routed around cards and frames.') +
      '<button type="button" class="vc-act" data-tidy title="Lay every folder frame out in a neat grid">Tidy the whole board</button>' +
      '<div class="vc-hint">V select · H or Space pan · T tidy · L wires · M minimap · ? all shortcuts</div>';
    host.querySelector<HTMLElement>('[data-t=links]')!.onclick = () => {
      this.command('links');
      this.vc.renderPanel();
    };
    host.querySelector<HTMLElement>('[data-tidy]')!.onclick = () => this.tidy(null, true);
  }

  // ───────────────────────────── camera ─────────────────────────────

  private stopAnims(): void {
    this.fly = null;
    this.inertia = null;
    this.zoomAnim = null;
  }

  private zoomAt(factor: number, sx: number, sy: number): void {
    this.fly = null;
    this.inertia = null;
    const base = this.zoomAnim ? this.zoomAnim.zt : this.cam.z;
    const zt = Math.max(MIN_Z, Math.min(MAX_Z, base * factor));
    this.zoomAnim = { zt, ax: sx, ay: sy };
    this.kick();
  }

  private zoomTo(z: number): void {
    this.zoomAnim = null;
    this.zoomAt(z / this.cam.z, this.W / 2, this.H / 2);
  }

  private allBounds(): Box | null {
    return boundsOf(this.shownFrames().map((f) => frameBox(f)));
  }

  private selectionBounds(): Box | null {
    const boxes: Box[] = [];
    for (const p of this.sel) {
      const c = this.cards.get(p);
      const f = c && this.frameOf(c);
      if (c && f) boxes.push(cardBox(f, c));
    }
    for (const n of this.selFrames) {
      const f = this.frames.get(n);
      if (f) boxes.push(frameBox(f));
    }
    return boundsOf(boxes);
  }

  private fitTo(b: Box | null, animate = true, maxZ = 1.25): void {
    if (!b) return;
    const panelW = this.panel && this.panel.isOpen && this.W > 760 ? 400 : 0;
    const pad = this.W < 600 ? 28 : 80;
    const w = this.W - panelW;
    const z = Math.max(MIN_Z, Math.min(maxZ, (w - pad * 2) / b.w, (this.H - pad * 2 - 40) / (b.h + 40)));
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2 - 12 / z;
    const target: [number, number, number] = [cx + panelW / 2 / z, cy, z];
    if (!animate) {
      this.cam = { z, x: this.W / 2 - target[0] * z, y: this.H / 2 - target[1] * z };
      this.kick(true);
      return;
    }
    const c0: [number, number, number] = [(this.W / 2 - this.cam.x) / this.cam.z, (this.H / 2 - this.cam.y) / this.cam.z, this.cam.z];
    this.zoomAnim = null;
    this.inertia = null;
    this.fly = { t0: performance.now(), ms: 420, c0, c1: target };
    this.kick();
  }

  /** Bring a card into view (and zoom in if it is too small to read). */
  private reveal(c: Card, zoom: boolean): void {
    const f = this.frameOf(c);
    if (!f) return;
    const b = cardBox(f, c);
    const vb = this.viewBox(-60);
    if (!zoom && contains(vb, b.x, b.y) && contains(vb, b.x + b.w, b.y + b.h) && this.cam.z >= LOD1) return;
    this.fitTo({ x: b.x - 160, y: b.y - 120, w: b.w + 320, h: b.h + 240 }, true, Math.max(this.cam.z, 1));
  }

  // ───────────────────────────── selection ─────────────────────────────

  private select(paths: string[], add = false): void {
    if (!add) {
      this.sel.clear();
      this.selFrames.clear();
    }
    for (const p of paths) this.sel.add(p);
    this.paintSelection();
  }

  private paintSelection(): void {
    for (const c of this.cards.values()) if (c.el) c.el.classList.toggle('sel', this.sel.has(c.path));
    for (const f of this.frames.values()) f.el?.classList.toggle('sel', this.selFrames.has(f.name));
    const n = this.sel.size;
    const show = n >= 1 || this.selFrames.size > 0;
    this.ui.selbar.classList.toggle('hidden', !show);
    this.root.classList.toggle('has-sel', show);
    const cnt = this.ui.selbar.querySelector<HTMLElement>('.cnt')!;
    cnt.textContent = n
      ? `${n} node${n === 1 ? '' : 's'}`
      : `${this.selFrames.size} frame${this.selFrames.size === 1 ? '' : 's'}`;
    this.ui.selbar.querySelectorAll<HTMLElement>('[data-act^=al-],[data-act^=dis-]').forEach((b) => {
      b.classList.toggle('hidden', b.dataset.act!.startsWith('dis-') ? n < 3 : n < 2);
    });
    // Separators before the align and distribute groups only when those show.
    this.ui.selbar.querySelectorAll<HTMLElement>('.cv-sep').forEach((s, i) => s.classList.toggle('hidden', i < 2 && n < 2));
    this.ui.selbar.querySelector('[data-act=sel-open]')?.classList.toggle('hidden', n !== 1);
    // The folders the selection lives in: one chip each, tap to fly there.
    const folders = new Map<string, number>();
    for (const p of this.sel) {
      const c = this.cards.get(p);
      if (c) folders.set(c.folder, (folders.get(c.folder) || 0) + 1);
    }
    for (const f of this.selFrames) folders.set(f, folders.get(f) || 0);
    const list = Array.from(folders.keys());
    const chips = this.ui.selbar.querySelector<HTMLElement>('.cv-fchips')!;
    chips.innerHTML =
      list
        .slice(0, 3)
        .map(
          (f) =>
            `<button class="cv-btn cv-fchip" data-fchip="${esc(f)}" title="Focus folder ${esc(f)}"><i class="cv-fdot" style="--fc:${esc(colorOfFolder(f))}"></i><span>${esc(
              f === 'Root' ? 'Vault' : f.split('/').pop() || f,
            )}</span></button>`,
        )
        .join('') + (list.length > 3 ? `<span class="cv-fmore">+${list.length - 3}</span>` : '');
    if (this.panel.isOpen && n === 1) {
      const c = this.cards.get(Array.from(this.sel)[0]);
      if (c && this.panel.path !== c.path) void this.openPanel(c);
    }
    this.kick();
  }

  private selectedCards(): Card[] {
    return Array.from(this.sel)
      .map((p) => this.cards.get(p))
      .filter((c): c is Card => !!c);
  }

  // ───────────────────────────── pointer input ─────────────────────────────

  private pt(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.cam.x) / this.cam.z, y: (sy - this.cam.y) / this.cam.z };
  }

  private frameAt(wx: number, wy: number, skip?: Set<Frame>): Frame | null {
    let hit: Frame | null = null;
    for (const f of this.frames.values()) {
      if ((skip && skip.has(f)) || this.hiddenFrames.has(f.name)) continue;
      const b = frameBox(f);
      if (contains(b, wx, wy)) hit = f;
    }
    return hit;
  }

  private onDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest('.cv-ui') || target.closest('input')) return;
    if (target.closest('.cv-copen')) {
      const ce = target.closest<HTMLElement>('.cv-card');
      const c = ce && this.cards.get(ce.dataset.path || '');
      if (c) {
        e.stopPropagation();
        this.select([c.path]);
        void this.openPanel(c);
      }
      return;
    }
    const fbtn = target.closest<HTMLElement>('.cv-fbtn');
    if (fbtn) {
      const fe = fbtn.closest<HTMLElement>('.cv-frame');
      const f = fe && this.frames.get(fe.dataset.frame || '');
      if (f) {
        if (fbtn.dataset.fact === 'tidy') this.tidy([f], false);
        else {
          hooks.openFolderColor(f.name);
          this.recolorWhenModalCloses();
        }
      }
      return;
    }
    const p = this.pt(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, type: e.pointerType });
    // Touch pointers are captured at once (the browser would otherwise steal them);
    // mouse pointers only once a drag starts, so click and dblclick keep their targets.
    if (e.pointerType !== 'mouse') this.capture(e.pointerId);
    this.lastPointer = e.pointerId;
    this.inertia = null;
    this.fly = null;

    if (this.pointers.size === 2) {
      this.cancelGesture();
      const [a, b] = Array.from(this.pointers.values());
      this.g = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: this.cam.z, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;

    const cardEl = target.closest<HTMLElement>('.cv-card');
    const label = target.closest<HTMLElement>('.cv-flabel');
    const resize = target.closest<HTMLElement>('.cv-fresize');
    const frameEl = target.closest<HTMLElement>('.cv-frame');
    const touch = e.pointerType !== 'mouse';
    const panIntent =
      e.button === 1 || this.space || this.tool === 'hand' || (touch && !cardEl && !label && !resize);
    if (e.button === 2) return;
    if (panIntent) {
      e.preventDefault();
      this.g = { kind: 'pan', lx: p.x, ly: p.y, samples: [{ x: p.x, y: p.y, t: performance.now() }] };
      this.root.classList.add('panning');
      return;
    }
    if (resize && frameEl) {
      const f = this.frames.get(frameEl.dataset.frame || '');
      if (f) {
        const b = frameBox(f);
        this.g = { kind: 'resize', frame: f, sx: p.x, sy: p.y, w: b.w, h: b.h };
      }
      return;
    }
    if (label && frameEl) {
      const f = this.frames.get(frameEl.dataset.frame || '');
      if (!f) return;
      if (e.shiftKey) {
        if (this.selFrames.has(f.name)) this.selFrames.delete(f.name);
        else this.selFrames.add(f.name);
        this.paintSelection();
      } else if (!this.selFrames.has(f.name)) {
        this.sel.clear();
        this.selFrames.clear();
        this.selFrames.add(f.name);
        this.paintSelection();
      }
      this.g = { kind: 'frame-pending', frame: f, sx: p.x, sy: p.y };
      return;
    }
    if (cardEl) {
      const c = this.cards.get(cardEl.dataset.path || '');
      if (!c) return;
      const g: Gesture = { kind: 'card-pending', card: c, sx: p.x, sy: p.y, shift: e.shiftKey, touch, timer: 0 };
      if (touch) {
        g.timer = window.setTimeout(() => {
          if (this.g !== g) return;
          try {
            navigator.vibrate?.(12);
          } catch {
            /* optional */
          }
          this.beginCardDrag(g, g.sx, g.sy);
        }, LONG_PRESS);
      }
      this.g = g;
      return;
    }
    if (frameEl && !touch) {
      const f = this.frames.get(frameEl.dataset.frame || '');
      if (f && this.selFrames.has(f.name) && !e.shiftKey) {
        this.g = { kind: 'frame-pending', frame: f, sx: p.x, sy: p.y };
        return;
      }
    }
    this.g = { kind: 'marquee-pending', sx: p.x, sy: p.y, shift: e.shiftKey };
  }

  private onMove(e: PointerEvent): void {
    const p = this.pt(e);
    const prev = this.pointers.get(e.pointerId);
    if (prev) {
      prev.x = p.x;
      prev.y = p.y;
    }
    const g = this.g;
    if (g && prev && e.pointerType === 'mouse' && g.kind !== 'card-pending' && g.kind !== 'marquee-pending' && g.kind !== 'frame-pending')
      this.capture(e.pointerId);
    if (!g) {
      if (e.pointerType === 'mouse') {
        const ce = (e.target as HTMLElement).closest<HTMLElement>('.cv-card');
        const h = ce ? ce.dataset.path || null : null;
        if (h !== this.hover) {
          this.hover = h;
          this.kick();
        }
      }
      return;
    }
    if (!prev) return;
    switch (g.kind) {
      case 'pinch': {
        const pts = Array.from(this.pointers.values());
        if (pts.length < 2) return;
        const [a, b] = pts;
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const nz = Math.max(MIN_Z, Math.min(MAX_Z, (g.z0 * d) / g.d0));
        const wx = (g.cx - this.cam.x) / this.cam.z;
        const wy = (g.cy - this.cam.y) / this.cam.z;
        this.cam.z = nz;
        this.cam.x = cx - wx * nz;
        this.cam.y = cy - wy * nz;
        g.cx = cx;
        g.cy = cy;
        this.kick();
        return;
      }
      case 'pan': {
        g.d = (g.d || 0) + Math.abs(p.x - g.lx) + Math.abs(p.y - g.ly);
        this.cam.x += p.x - g.lx;
        this.cam.y += p.y - g.ly;
        g.lx = p.x;
        g.ly = p.y;
        const t = performance.now();
        g.samples.push({ x: p.x, y: p.y, t });
        while (g.samples.length > 2 && t - g.samples[0].t > 90) g.samples.shift();
        this.kick();
        return;
      }
      case 'card-pending': {
        const d = Math.hypot(p.x - g.sx, p.y - g.sy);
        if (g.touch) {
          if (d > 8) {
            clearTimeout(g.timer);
            this.g = { kind: 'pan', lx: p.x, ly: p.y, samples: [{ x: p.x, y: p.y, t: performance.now() }] };
            this.cam.x += p.x - g.sx;
            this.cam.y += p.y - g.sy;
            this.kick();
          }
          return;
        }
        if (d > 3) this.beginCardDrag(g, p.x, p.y);
        return;
      }
      case 'card-drag':
      case 'frame-drag':
        g.px = p.x;
        g.py = p.y;
        this.edgeScroll(p.x, p.y);
        this.dragMove(p.x, p.y);
        return;
      case 'marquee-pending':
        if (Math.hypot(p.x - g.sx, p.y - g.sy) > 3) {
          this.g = {
            kind: 'marquee',
            sx: g.sx,
            sy: g.sy,
            px: p.x,
            py: p.y,
            base: g.shift ? new Set(this.sel) : new Set(),
          };
          if (!g.shift) this.selFrames.clear();
          this.updateMarquee();
        }
        return;
      case 'marquee':
        g.px = p.x;
        g.py = p.y;
        this.updateMarquee();
        return;
      case 'frame-pending':
        if (Math.hypot(p.x - g.sx, p.y - g.sy) > 3) {
          const names = this.selFrames.has(g.frame.name) ? Array.from(this.selFrames) : [g.frame.name];
          const frames = names
            .map((n) => this.frames.get(n))
            .filter((f): f is Frame => !!f)
            .map((f) => ({ f, x: f.x, y: f.y }));
          this.g = { kind: 'frame-drag', frames, sx: g.sx, sy: g.sy, px: p.x, py: p.y, drop: null };
          for (const o of frames) {
            o.f.el?.classList.add('lift');
            if (o.f.el) this.bg.appendChild(o.f.el);
          }
          this.dragMove(p.x, p.y);
        }
        return;
      case 'resize': {
        const f = g.frame;
        const s = contentSize(f);
        f.w = Math.max(s.w, g.w + (p.x - g.sx) / this.cam.z);
        f.h = Math.max(s.h, g.h + (p.y - g.sy) / this.cam.z);
        this.placeFrame(f);
        this.kick();
        return;
      }
      default:
        return;
    }
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    const had = this.pointers.delete(e.pointerId);
    const g = this.g;
    this.root.classList.remove('panning');
    this.edge = null;
    if (!g || !had) return;
    if (g.kind === 'pinch') {
      if (this.pointers.size < 2) {
        this.g = null;
        const rest = Array.from(this.pointers.values())[0];
        if (rest) this.g = { kind: 'pan', lx: rest.x, ly: rest.y, samples: [] };
        this.saveCamSoon();
      }
      return;
    }
    this.g = null;
    if (cancelled) {
      if (g.kind === 'card-drag' || g.kind === 'frame-drag') this.revertDrag(g);
      this.marquee.classList.add('hidden');
      return;
    }
    switch (g.kind) {
      case 'pan': {
        if ((g.d || 0) < 6 && e.pointerType !== 'mouse' && !(e.target as HTMLElement).closest('.cv-card,.cv-flabel')) {
          if (this.sel.size || this.selFrames.size) this.select([]);
          else if (this.panel.isOpen) this.closePanel();
        }
        const s = g.samples;
        if (s.length >= 2) {
          const a = s[0];
          const b = s[s.length - 1];
          const dt = Math.max(1, b.t - a.t);
          if (performance.now() - b.t < 60 && dt > 4) {
            this.inertia = { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt, t: performance.now() };
            if (Math.hypot(this.inertia.vx, this.inertia.vy) < 0.08) this.inertia = null;
          }
        }
        this.kick();
        this.saveCamSoon();
        return;
      }
      case 'card-pending': {
        clearTimeout(g.timer);
        const c = g.card;
        if (g.touch) {
          this.select([c.path]);
          void this.openPanel(c);
          return;
        }
        if (g.shift) {
          if (this.sel.has(c.path)) this.sel.delete(c.path);
          else this.sel.add(c.path);
          this.paintSelection();
        } else this.select([c.path]);
        return;
      }
      case 'card-drag':
        void this.dropCards(g);
        return;
      case 'frame-drag':
        this.dropFrames(g);
        return;
      case 'frame-pending':
        // A click on a frame's title (no drag): its folder card, as in Brain and Graph.
        this.openFolderCard(g.frame.name);
        return;
      case 'marquee':
        this.marquee.classList.add('hidden');
        this.paintSelection();
        return;
      case 'marquee-pending':
        if (!g.shift) this.select([]);
        return;
      case 'resize':
        this.separate(g.frame);
        this.persist();
        return;
      default:
        return;
    }
  }

  private lastPointer = -1;

  private capture(id = this.lastPointer): void {
    try {
      if (!this.root.hasPointerCapture(id)) this.root.setPointerCapture(id);
    } catch {
      /* synthetic or finished pointers */
    }
  }

  private cancelGesture(): void {
    const g = this.g;
    if (!g) return;
    if (g.kind === 'card-pending') clearTimeout(g.timer);
    if (g.kind === 'card-drag' || g.kind === 'frame-drag') this.revertDrag(g);
    this.marquee.classList.add('hidden');
    this.root.classList.remove('panning');
    this.g = null;
  }

  private onWheel(e: WheelEvent): void {
    if ((e.target as HTMLElement).closest('.nc,.cv-help')) return;
    e.preventDefault();
    const p = this.pt(e);
    const lines = e.deltaMode === 1;
    const dy = lines ? e.deltaY * 16 : e.deltaY;
    const dx = lines ? e.deltaX * 16 : e.deltaX;
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(Math.exp(-Math.max(-50, Math.min(50, dy)) * 0.0085), p.x, p.y);
      return;
    }
    const mouseWheel = lines || (dx === 0 && Math.abs(dy) >= 40 && Number.isInteger(dy));
    if (mouseWheel && !e.shiftKey) {
      this.zoomAt(Math.exp(-Math.max(-120, Math.min(120, dy)) * 0.0021), p.x, p.y);
      return;
    }
    this.stopAnims();
    if (e.shiftKey && dx === 0) this.cam.x -= dy;
    else {
      this.cam.x -= dx;
      this.cam.y -= dy;
    }
    this.kick();
    this.saveCamSoon();
  }

  private onDbl(e: MouseEvent): void {
    // With pointer capture the event can target the board root; fall back to hit testing.
    let t = e.target as HTMLElement;
    if (t === this.root) t = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null) || t;
    if (t.closest('.cv-ui') || t.closest('input')) return;
    const ft = t.closest<HTMLElement>('.cv-flabel');
    if (ft) {
      const fe = ft.closest<HTMLElement>('.cv-frame');
      const f = fe && this.frames.get(fe.dataset.frame || '');
      if (f) this.startRenameFrame(f);
      return;
    }
    const ce = t.closest<HTMLElement>('.cv-card');
    if (ce) {
      const c = this.cards.get(ce.dataset.path || '');
      if (!c) return;
      if (t.closest('.cv-ctitle')) this.startRenameCard(c);
      else void this.openPanel(c);
      return;
    }
    if (!t.closest('.cv-frame')) {
      const p = this.pt(e);
      this.zoomAt(1.6, p.x, p.y);
    }
  }

  private edgeScroll(x: number, y: number): void {
    const m = 36;
    const sp = 9;
    const vx = x < m ? -sp : x > this.W - m ? sp : 0;
    const vy = y < m ? -sp : y > this.H - m ? sp : 0;
    this.edge = vx || vy ? { vx: -vx, vy: -vy } : null;
    if (this.edge) this.kick();
  }

  private updateMarquee(): void {
    const g = this.g;
    if (!g || g.kind !== 'marquee') return;
    const x = Math.min(g.sx, g.px);
    const y = Math.min(g.sy, g.py);
    const w = Math.abs(g.px - g.sx);
    const h = Math.abs(g.py - g.sy);
    Object.assign(this.marquee.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    this.marquee.classList.remove('hidden');
    const a = this.toWorld(x, y);
    const wb: Box = { x: a.x, y: a.y, w: w / this.cam.z, h: h / this.cam.z };
    this.sel = new Set(g.base);
    for (const f of this.frames.values()) for (const c of f.cards) if (overlaps(wb, cardBox(f, c))) this.sel.add(c.path);
    for (const c of this.cards.values()) if (c.el) c.el.classList.toggle('sel', this.sel.has(c.path));
    this.kick();
  }

  // ───────────────────────────── dragging ─────────────────────────────

  private beginCardDrag(g: Extract<Gesture, { kind: 'card-pending' }>, px: number, py: number): void {
    const lead = g.card;
    if (!this.sel.has(lead.path)) {
      if (g.shift) this.sel.add(lead.path);
      else {
        this.sel.clear();
        this.selFrames.clear();
        this.sel.add(lead.path);
      }
      this.paintSelection();
    }
    const cards = this.selectedCards().map((c) => {
      const f = this.frameOf(c)!;
      c.drag = true;
      return { c, wx: f.x + c.x, wy: f.y + c.y, from: c.folder, fx: c.x, fy: c.y };
    });
    for (const o of cards) {
      if (!o.c.el) {
        this.mountCard(o.c);
        this.placeCard(o.c);
      }
      o.c.el!.classList.add('drag');
      this.fg.appendChild(o.c.el!);
    }
    this.g = { kind: 'card-drag', cards, sx: g.sx, sy: g.sy, px, py, lead, drop: null };
    this.dragMove(px, py);
  }

  private dragMove(px: number, py: number): void {
    const g = this.g;
    if (!g) return;
    if (g.kind === 'card-drag') {
      const a = this.toWorld(g.sx, g.sy);
      const b = this.toWorld(px, py);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      for (const o of g.cards) {
        const f = this.frameOf(o.c)!;
        o.c.x = o.wx + dx - f.x;
        o.c.y = o.wy + dy - f.y;
        this.placeCard(o.c, f);
      }
      const drop = this.frameAt(b.x, b.y);
      const target = drop && drop.name !== g.lead.folder ? drop : null;
      if (target !== g.drop) {
        g.drop?.el?.classList.remove('drop');
        target?.el?.classList.add('drop');
        g.drop = target;
      }
      for (const f of this.frames.values()) this.placeFrame(f);
      this.kick();
    } else if (g.kind === 'frame-drag') {
      const a = this.toWorld(g.sx, g.sy);
      const b = this.toWorld(px, py);
      for (const o of g.frames) {
        o.f.x = o.x + b.x - a.x;
        o.f.y = o.y + b.y - a.y;
      }
      const skip = new Set(g.frames.map((o) => o.f));
      const target = g.frames.length === 1 && g.frames[0].f.name !== 'Root' ? this.frameAt(b.x, b.y, skip) : null;
      if (target !== g.drop) {
        g.drop?.el?.classList.remove('drop');
        target?.el?.classList.add('drop');
        g.drop = target;
      }
      this.geomDirty = true;
      this.kick();
    }
  }

  private revertDrag(g: Extract<Gesture, { kind: 'card-drag' | 'frame-drag' }>): void {
    g.drop?.el?.classList.remove('drop');
    if (g.kind === 'card-drag') {
      for (const o of g.cards) {
        o.c.drag = false;
        o.c.x = o.fx;
        o.c.y = o.fy;
        o.c.el?.classList.remove('drag');
      }
    } else {
      for (const o of g.frames) {
        o.f.x = o.x;
        o.f.y = o.y;
      }
    }
    this.kick(true);
  }

  private async dropCards(g: Extract<Gesture, { kind: 'card-drag' }>): Promise<void> {
    g.drop?.el?.classList.remove('drop');
    const w = this.toWorld(g.px, g.py);
    const target = this.frameAt(w.x, w.y);
    const moving: typeof g.cards = [];
    const touched = new Set<Frame>();
    for (const o of g.cards) {
      o.c.drag = false;
      o.c.el?.classList.remove('drag');
      if (target && target.name !== o.c.folder) moving.push(o);
      else touched.add(this.frameOf(o.c)!);
    }
    for (const f of touched) {
      normalizeFrame(f);
      this.separate(f);
    }
    if (!moving.length || !target) {
      this.kick(true);
      this.persist();
      return;
    }
    // Optimistic: move the cards into the target frame now, then ask the server.
    const plan = moving.map((o) => {
      const from = this.frameOf(o.c)!;
      const wx = from.x + o.c.x;
      const wy = from.y + o.c.y;
      return { o, from, wx, wy, oldPath: o.c.path };
    });
    for (const it of plan) {
      it.from.cards = it.from.cards.filter((c) => c !== it.o.c);
      it.o.c.folder = target.name;
      it.o.c.x = it.wx - target.x;
      it.o.c.y = it.wy - target.y;
      target.cards.push(it.o.c);
      this.rekey(it.o.c, movedPath(it.oldPath, target.name));
      if (it.o.c.el) this.fillCard(it.o.c);
    }
    normalizeFrame(target);
    this.separate(target);
    this.kick(true);
    const label = plan.length === 1 ? `"${plan[0].o.c.name}"` : `${plan.length} nodes`;
    this.toast.show(`Moving ${label} to ${target.name}...`, { ms: 20000 });
    const done: { c: Card; from: string; oldPath: string; fx: number; fy: number; frame: Frame }[] = [];
    let failed = 0;
    let lastErr = '';
    for (const it of plan) {
      try {
        const np = await moveNote(it.oldPath, target.name);
        this.rekey(it.o.c, np);
        done.push({ c: it.o.c, from: it.o.from, oldPath: it.oldPath, fx: it.o.fx, fy: it.o.fy, frame: it.from });
      } catch (err) {
        failed++;
        lastErr = (err as Error).message;
        // Put the card back where it came from.
        target.cards = target.cards.filter((c) => c !== it.o.c);
        it.o.c.folder = it.o.from;
        it.o.c.x = it.o.fx;
        it.o.c.y = it.o.fy;
        this.rekey(it.o.c, it.oldPath);
        if (!this.frames.has(it.o.from)) this.frames.set(it.o.from, it.from);
        it.from.cards.push(it.o.c);
        if (it.o.c.el) this.fillCard(it.o.c);
      }
    }
    this.kick(true);
    this.persist();
    if (done.length) {
      const undo = async (): Promise<void> => {
        for (const d of done) {
          try {
            const back = await moveNote(d.c.path, d.from);
            const t = this.frameOf(d.c);
            if (t) t.cards = t.cards.filter((c) => c !== d.c);
            d.c.folder = d.from;
            d.c.x = d.fx;
            d.c.y = d.fy;
            this.rekey(d.c, back);
            if (!this.frames.has(d.from)) {
              this.frames.set(d.from, d.frame);
              d.frame.el = null;
            }
            this.frames.get(d.from)!.cards.push(d.c);
            if (d.c.el) this.fillCard(d.c);
          } catch (err) {
            this.toast.show('Undo failed: ' + (err as Error).message, { err: true });
          }
        }
        this.kick(true);
        this.persist();
        await this.afterWrite();
      };
      this.pushUndo(`Move ${label}`, undo);
      this.toast.show(
        `Moved ${done.length === 1 ? `"${done[0].c.name}"` : done.length + ' nodes'} to ${target.name}${
          failed ? ` · ${failed} failed: ${lastErr}` : ''
        }`,
        { undo: () => void this.runUndo(), err: failed > 0 },
      );
    } else {
      this.toast.show(`Could not move: ${lastErr}`, { err: true });
    }
    await this.afterWrite();
  }

  private dropFrames(g: Extract<Gesture, { kind: 'frame-drag' }>): void {
    g.drop?.el?.classList.remove('drop');
    const target = g.drop;
    if (target && g.frames.length === 1) {
      const src = g.frames[0].f;
      // Snap back first; the folder move happens only after confirmation.
      src.x = g.frames[0].x;
      src.y = g.frames[0].y;
      this.kick(true);
      this.confirmFolderInto(src, target);
      return;
    }
    for (const o of g.frames) this.separate(o.f);
    this.kick(true);
    this.persist();
  }

  private confirmFolderInto(src: Frame, target: Frame): void {
    const n = src.cards.length;
    Modal.confirm(
      'Move folder',
      `Move the folder "${src.name}" with its ${n} node${n === 1 ? '' : 's'} into "${target.name}"? The nodes move on disk to ${target.name}/${src.name}/.`,
      'Move folder',
      async () => {
        Modal.close();
        await this.moveFolderInto(src, target);
      },
      false,
    );
  }

  private async moveFolderInto(src: Frame, target: Frame): Promise<void> {
    const dest = target.name === 'Root' ? src.name : target.name + '/' + src.name;
    const paths = src.cards.map((c) => c.path);
    const before = new Map(src.cards.map((c) => [c.path, { x: c.x, y: c.y }]));
    const srcBox = { x: src.x, y: src.y, w: src.w, h: src.h };
    this.toast.show(`Moving ${paths.length} nodes into ${target.name}...`, { ms: 30000 });
    this.busy = true;
    const r = await moveMany(paths, dest);
    this.busy = false;
    // Cards that made it join the target frame in free slots.
    for (const m of r.moved) {
      const c = this.cards.get(m.from);
      if (!c) continue;
      src.cards = src.cards.filter((x) => x !== c);
      c.folder = target.name;
      const slot = freeSlot(target);
      c.x = slot.x;
      c.y = slot.y;
      target.cards.push(c);
      this.rekey(c, m.to);
      this.flashPending.add(c.path);
      if (c.el) this.fillCard(c);
    }
    this.kick(true);
    this.persist();
    const undo = async (): Promise<void> => {
      const back = await moveMany(
        r.moved.map((m) => this.cards.get(m.to)?.path || m.to),
        src.name,
      );
      // Restore the old frame geometry and card spots before the board syncs.
      this.layout.frames[src.name] = srcBox;
      for (const m of back.moved) {
        const orig = r.moved.find((x) => x.to === m.from);
        const pos = orig && before.get(orig.from);
        if (pos) this.layout.cards[m.to] = pos;
        const c = this.cards.get(m.from);
        if (c) {
          const t = this.frameOf(c);
          if (t) t.cards = t.cards.filter((x) => x !== c);
          c.el?.remove();
          this.cards.delete(m.from);
        }
      }
      await this.afterWrite();
    };
    this.pushUndo(`Move folder ${src.name}`, undo);
    this.toast.show(
      `Moved ${r.moved.length} nodes into ${target.name}/${src.name}${r.failed.length ? ` · ${r.failed.length} failed` : ''}`,
      { undo: () => void this.runUndo(), err: r.failed.length > 0 },
    );
    await this.afterWrite();
  }

  /** Change a card's path everywhere it is keyed. */
  private rekey(c: Card, path: string): void {
    if (c.path === path) return;
    const old = c.path;
    this.cards.delete(old);
    c.path = path;
    this.cards.set(path, c);
    if (this.sel.delete(old)) this.sel.add(path);
    if (this.hover === old) this.hover = path;
    moveExcerpt(old, path);
    if (c.el) c.el.dataset.path = path;
    if (this.panel.path === old) this.panel.path = path;
  }

  /** Refresh shared data after a write, then reconcile. */
  private async afterWrite(): Promise<void> {
    try {
      await hooks.loadCore();
    } catch {
      /* the next mutation refreshes */
    }
    this.sync();
    this.scheduleLinks();
  }

  private pushUndo(label: string, run: () => Promise<void>): void {
    this.undoStack.push({ label, run });
    if (this.undoStack.length > 20) this.undoStack.shift();
  }

  private async runUndo(): Promise<void> {
    const u = this.undoStack.pop();
    if (!u) {
      this.toast.show('Nothing to undo');
      return;
    }
    this.toast.show(`Undoing: ${u.label}...`);
    try {
      await u.run();
      this.toast.show(`Undone: ${u.label}`);
    } catch (e) {
      this.toast.show('Undo failed: ' + (e as Error).message, { err: true });
    }
  }

  // ───────────────────────────── rename ─────────────────────────────

  private inlineEdit(host: HTMLElement, value: string, commit: (v: string) => void): void {
    const input = document.createElement('input');
    input.value = value;
    input.spellcheck = false;
    host.textContent = '';
    host.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      input.remove();
      commit(ok && v && v !== value ? v : '');
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  private startRenameCard(c: Card): void {
    if (!c.el) {
      this.mountCard(c);
      this.placeCard(c);
    }
    const t = c.el!.querySelector<HTMLElement>('.cv-ctitle');
    if (!t) return;
    this.inlineEdit(t, c.name, (v) => {
      if (!v) {
        this.fillCard(c);
        return;
      }
      void this.renameCard(c, v);
    });
  }

  private async renameCard(c: Card, name: string): Promise<void> {
    const oldPath = c.path;
    const oldName = c.name;
    c.name = name;
    this.rekey(c, renamedPath(oldPath, name));
    this.fillCard(c);
    try {
      const np = await renameNote(oldPath, name);
      this.rekey(c, np);
      this.pushUndo(`Rename "${oldName}"`, async () => {
        const back = await renameNote(c.path, oldName);
        c.name = oldName;
        this.rekey(c, back);
        this.fillCard(c);
        await this.afterWrite();
      });
      this.toast.show(`Renamed to "${name}"`, { undo: () => void this.runUndo() });
      if (this.panel.path === c.path) void this.openPanel(c);
    } catch (e) {
      c.name = oldName;
      this.rekey(c, oldPath);
      this.fillCard(c);
      this.toast.show('Rename failed: ' + (e as Error).message, { err: true });
    }
    this.persist();
    await this.afterWrite();
  }

  private startRenameFrame(f: Frame): void {
    if (f.name === 'Root') {
      this.toast.show('Root is the vault itself and cannot be renamed');
      return;
    }
    const t = f.el?.querySelector<HTMLElement>('.cv-ftitle');
    if (!t) return;
    this.inlineEdit(t, f.name, (v) => {
      if (!v) {
        this.fillFrame(f);
        return;
      }
      void this.renameFrame(f, v);
    });
  }

  private async renameFrame(f: Frame, raw: string, isUndo = false): Promise<void> {
    const name = cleanFolderName(raw);
    const old = f.name;
    if (!name || name === old) {
      this.fillFrame(f);
      return;
    }
    if (state.tree[name] || this.frames.has(name)) {
      this.fillFrame(f);
      this.toast.show(`A folder named "${name}" already exists`, { err: true });
      return;
    }
    const color = state.folderMeta[old]?.color;
    // Optimistic: rename the frame and rekey its cards.
    this.frames.delete(old);
    f.name = name;
    this.frames.set(name, f);
    if (f.el) f.el.dataset.frame = name;
    if (this.selFrames.delete(old)) this.selFrames.add(name);
    const paths = f.cards.map((c) => c.path);
    for (const c of f.cards) {
      c.folder = name;
      this.rekey(c, movedPath(c.path, name));
    }
    this.fillFrame(f);
    this.kick(true);
    this.toast.show(`Renaming folder to ${name} (${paths.length} nodes)...`, { ms: 30000 });
    this.busy = true;
    const r = await moveMany(paths, name);
    this.busy = false;
    for (const m of r.moved) {
      const c = f.cards.find((x) => x.path === movedPath(m.from, name));
      if (c) this.rekey(c, m.to);
    }
    if (color) {
      try {
        await setFolderColor(name, color);
        state.folderMeta[name] = { ...(state.folderMeta[name] || {}), color };
      } catch {
        /* color is cosmetic */
      }
    }
    if (r.failed.length) this.toast.show(`Renamed with ${r.failed.length} failures: ${r.failed[0].error}`, { err: true });
    else if (!isUndo) {
      this.pushUndo(`Rename folder ${old}`, async () => {
        const cur = this.frames.get(name);
        if (cur) await this.renameFrame(cur, old, true);
      });
      this.toast.show(`Folder renamed to ${name}`, { undo: () => void this.runUndo() });
    }
    this.persist();
    await this.afterWrite();
  }

  private recolorWhenModalCloses(): void {
    const host = document.getElementById('modalHost');
    if (!host) return;
    const mo = new MutationObserver(() => {
      if (!host.classList.contains('hidden') && host.childElementCount) return;
      mo.disconnect();
      this.recolor();
    });
    mo.observe(host, { attributes: true, childList: true });
    window.setTimeout(() => mo.disconnect(), 120000);
  }

  /** Repaint folder colors on frames and cards. */
  private recolor(): void {
    for (const f of this.frames.values()) {
      this.fillFrame(f);
      for (const c of f.cards) if (c.el) c.el.style.setProperty('--fc', colorOfFolder(c.folder));
    }
    this.kick();
  }

  // ───────────────────────────── layout commands ─────────────────────────────

  /** Animate model positions from their current values to what `mutate` sets. */
  private animate(mutate: () => void): void {
    const objs: { x: number; y: number }[] = [];
    for (const f of this.frames.values()) {
      objs.push(f);
      for (const c of f.cards) objs.push(c);
    }
    const before = objs.map((o) => [o.x, o.y]);
    mutate();
    const items: Tween['items'] = [];
    objs.forEach((o, i) => {
      const [fx, fy] = before[i];
      if (fx !== o.x || fy !== o.y) items.push({ o, fx, fy, tx: o.x, ty: o.y });
    });
    for (const it of items) {
      it.o.x = it.fx;
      it.o.y = it.fy;
    }
    // Sizes jump; positions glide.
    this.tween = { t0: performance.now(), ms: 380, items };
    this.kick(true);
    window.setTimeout(() => this.persist(), 420);
  }

  private tidy(frames: Frame[] | null, packAll: boolean): void {
    const list = frames && frames.length ? frames : Array.from(this.frames.values());
    this.animate(() => {
      for (const f of list) tidyFrame(f);
      if (packAll) {
        const b = this.allBounds();
        packFrames(Array.from(this.frames.values()), b ? b.x : 0, b ? b.y : 0);
      }
    });
    this.toast.show(packAll ? 'Board tidied' : `Tidied ${list.length} frame${list.length === 1 ? '' : 's'}`);
  }

  private align(kind: 'l' | 'c' | 'r' | 't' | 'm' | 'b'): void {
    const cards = this.selectedCards();
    if (cards.length < 2) return;
    const boxes = cards.map((c) => cardBox(this.frameOf(c)!, c));
    const b = boundsOf(boxes)!;
    this.animate(() => {
      cards.forEach((c) => {
        const f = this.frameOf(c)!;
        if (kind === 'l') c.x = b.x - f.x;
        if (kind === 'r') c.x = b.x + b.w - CARD_W - f.x;
        if (kind === 'c') c.x = b.x + b.w / 2 - CARD_W / 2 - f.x;
        if (kind === 't') c.y = b.y - f.y;
        if (kind === 'b') c.y = b.y + b.h - CARD_H - f.y;
        if (kind === 'm') c.y = b.y + b.h / 2 - CARD_H / 2 - f.y;
      });
      for (const f of new Set(cards.map((c) => this.frameOf(c)!))) normalizeFrame(f);
    });
  }

  private distribute(axis: 'h' | 'v'): void {
    const cards = this.selectedCards();
    if (cards.length < 3) return;
    const world = cards.map((c) => {
      const f = this.frameOf(c)!;
      return { c, f, x: f.x + c.x, y: f.y + c.y };
    });
    world.sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
    const first = world[0];
    const last = world[world.length - 1];
    const span = axis === 'h' ? last.x - first.x : last.y - first.y;
    const step = span / (world.length - 1);
    this.animate(() => {
      world.forEach((o, i) => {
        if (axis === 'h') o.c.x = first.x + step * i - o.f.x;
        else o.c.y = first.y + step * i - o.f.y;
      });
      for (const f of new Set(world.map((o) => o.f))) normalizeFrame(f);
    });
  }

  private nudge(dx: number, dy: number): void {
    const cards = this.selectedCards();
    if (cards.length) {
      for (const c of cards) {
        c.x += dx;
        c.y += dy;
      }
      for (const f of new Set(cards.map((c) => this.frameOf(c)!))) normalizeFrame(f);
    } else {
      for (const n of this.selFrames) {
        const f = this.frames.get(n);
        if (f) {
          f.x += dx;
          f.y += dy;
        }
      }
    }
    this.kick(true);
    this.persist();
  }

  private command(act: string): void {
    switch (act) {
      case 'tool-select':
      case 'tool-hand':
        this.tool = act === 'tool-hand' ? 'hand' : 'select';
        this.root.classList.toggle('hand', this.tool === 'hand');
        this.syncButtons();
        break;
      case 'zoom-in':
        this.zoomAt(1.25, this.W / 2, this.H / 2);
        break;
      case 'zoom-out':
        this.zoomAt(0.8, this.W / 2, this.H / 2);
        break;
      case 'zoom-100':
        this.zoomTo(1);
        break;
      case 'fit':
        this.fitTo(this.allBounds());
        break;
      case 'sel-open': {
        const c = this.selectedCards()[0];
        if (c) {
          this.reveal(c, false);
          void this.openPanel(c);
        }
        break;
      }
      case 'fit-sel':
        this.fitTo(this.selectionBounds() || this.allBounds());
        break;
      case 'tidy': {
        const frames = new Set<Frame>();
        for (const c of this.selectedCards()) frames.add(this.frameOf(c)!);
        for (const n of this.selFrames) {
          const f = this.frames.get(n);
          if (f) frames.add(f);
        }
        this.tidy(frames.size ? Array.from(frames) : null, !frames.size);
        break;
      }
      case 'links':
        this.showLinks = !this.showLinks;
        this.syncButtons();
        this.persist();
        this.kick();
        break;
      case 'minimap':
        this.vc.toggleMinimap();
        this.persist();
        break;
      case 'help':
        this.toggleHelp();
        break;
      case 'al-l':
      case 'al-c':
      case 'al-r':
      case 'al-t':
      case 'al-m':
      case 'al-b':
        this.align(act.slice(3) as 'l');
        break;
      case 'dis-h':
      case 'dis-v':
        this.distribute(act.slice(4) as 'h');
        break;
    }
  }

  private syncButtons(): void {
    const t = this.ui.tools;
    t.querySelector('[data-act=tool-select]')?.classList.toggle('on', this.tool === 'select');
    t.querySelector('[data-act=tool-hand]')?.classList.toggle('on', this.tool === 'hand');
    t.querySelector('[data-act=links]')?.classList.toggle('on', this.showLinks);
  }

  private toggleHelp(force?: boolean): void {
    const show = force ?? this.ui.help.classList.contains('hidden');
    this.ui.help.classList.toggle('hidden', !show);
    this.ui.scrim.classList.toggle('hidden', !show);
  }

  // ───────────────────────────── panel ─────────────────────────────

  private async openPanel(c: Card): Promise<void> {
    this.vc.close();
    this.root.classList.add('panel-open');
    const tags = state.graph.nodes.find((n) => n.path === c.path) as { tags?: unknown } | undefined;
    this.panel.showNote(c.path, c.name, c.folder, colorOfFolder(c.folder), Array.isArray(tags?.tags) ? tags.tags.map(String) : []);
  }

  /** A frame's folder card (frame title click, Regions, the finder). */
  private openFolderCard(name: string): void {
    this.vc.close();
    this.root.classList.add('panel-open');
    this.panel.showFolder(name, colorOfFolder(name), this.frames.get(name)?.cards.length);
  }

  private closePanel(): void {
    this.panel.close();
    this.root.classList.remove('panel-open');
  }

  /** The shared node and folder card (ui/node-card.ts). */
  private buildCard(root: HTMLElement): NodeCard {
    const link = (c: Card): CardLink => ({ path: c.path, name: c.name, color: colorOfFolder(c.folder), degree: this.linkCount.get(c.path) || 0 });
    return new NodeCard({
      root,
      focusNode: (p) => {
        const c = this.cards.get(p);
        if (c) this.reveal(c, true);
      },
      focusFolder: (f) => this.focusFolder(f),
      onlyFolder: (f) => this.setHiddenFrames(Array.from(this.frames.keys()).filter((x) => x !== f)),
      pick: (p) => {
        const c = this.cards.get(p);
        if (!c) return;
        this.select([c.path]);
        this.reveal(c, true);
        void this.openPanel(c);
      },
      links: (p) => {
        const out = this.links.filter((l) => l.a.path === p).map((l) => link(l.b));
        const outs = new Set(out.map((l) => l.path));
        return { out, in: this.links.filter((l) => l.b.path === p && !outs.has(l.a.path)).map((l) => link(l.a)) };
      },
      folderItems: (f) =>
        Array.from(this.cards.values())
          .filter((c) => c.folder === f)
          .map(link)
          .sort((a, b) => (b.degree || 0) - (a.degree || 0)),
      tag: (t) => this.vc.setQuery('#' + t + ' '),
      home: () => window.setTimeout(() => this.fitTo(this.allBounds()), 60),
      closed: () => this.root.classList.remove('panel-open'),
    });
  }

  // ───────────────────────────── keyboard ─────────────────────────────

  private onKey(e: KeyboardEvent): void {
    if (state.page !== 'canvas') return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
    if (document.querySelector('#modalHost:not(.hidden)')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const code = e.code;
    if (code === 'Space') {
      if (!this.space) {
        this.space = true;
        this.root.classList.add('hand');
      }
      e.preventDefault();
      return;
    }
    if (k === 'Escape') {
      if (!this.ui.help.classList.contains('hidden')) this.toggleHelp(false);
      else if (this.g) this.cancelGesture();
      else if (this.sel.size || this.selFrames.size) this.select([]);
      else if (this.panel.isOpen) this.closePanel();
      return;
    }
    if (mod && (k === 'z' || k === 'Z') && !e.shiftKey) {
      e.preventDefault();
      void this.runUndo();
      return;
    }
    if (mod && (k === 'a' || k === 'A')) {
      e.preventDefault();
      this.select(Array.from(this.cards.keys()));
      return;
    }
    if (mod) return;
    if (e.altKey) {
      const map: Record<string, string> = {
        KeyA: 'al-l',
        KeyD: 'al-r',
        KeyW: 'al-t',
        KeyS: 'al-b',
        KeyH: e.shiftKey ? 'dis-h' : 'al-c',
        KeyV: e.shiftKey ? 'dis-v' : 'al-m',
      };
      if (map[code]) {
        e.preventDefault();
        this.command(map[code]);
      }
      return;
    }
    if (e.shiftKey && (code === 'Digit1' || code === 'Digit2' || code === 'Digit0')) {
      e.preventDefault();
      this.command(code === 'Digit1' ? 'fit' : code === 'Digit2' ? 'fit-sel' : 'zoom-100');
      return;
    }
    if (k.startsWith('Arrow')) {
      if (!this.sel.size && !this.selFrames.size) return;
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      this.nudge(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0);
      return;
    }
    const one = this.sel.size === 1 ? this.cards.get(Array.from(this.sel)[0]) : undefined;
    switch (k) {
      case 'v':
      case 'V':
        this.command('tool-select');
        break;
      case 'h':
      case 'H':
        this.command('tool-hand');
        break;
      case '+':
      case '=':
        this.command('zoom-in');
        break;
      case '-':
      case '_':
        this.command('zoom-out');
        break;
      case 't':
        this.command('tidy');
        break;
      case 'T':
        this.tidy(null, true);
        break;
      case 'l':
      case 'L':
        this.command('links');
        break;
      case 'm':
      case 'M':
        this.command('minimap');
        break;
      case '?':
        this.toggleHelp();
        break;
      case '/':
        e.preventDefault();
        this.vc.focusSearch();
        break;
      case 'Enter':
        if (one) {
          e.preventDefault();
          void this.openPanel(one);
        }
        break;
      case 'o':
      case 'O':
        if (one) hooks.openNote(one.path);
        break;
      case 'F2':
        e.preventDefault();
        if (one) this.startRenameCard(one);
        else if (this.selFrames.size === 1) {
          const f = this.frames.get(Array.from(this.selFrames)[0]);
          if (f) this.startRenameFrame(f);
        }
        break;
      default:
        return;
    }
  }

  // ───────────────────────────── live ─────────────────────────────

  private findCard(path: string): Card | undefined {
    if (!path) return undefined;
    const p = path.replace(/^\/+/, '');
    const c = this.cards.get(p) || this.cards.get(p + '.md');
    if (c) return c;
    const name = noteName(p);
    for (const x of this.cards.values()) if (x.name === name) return x;
    return undefined;
  }

  private onActivity(a: AgentActivity): void {
    const paths = a.paths || [];
    const live = a.phase === 'start';
    let last: Card | undefined;
    for (const p of paths) {
      const c = this.findCard(p);
      if (!c) continue;
      c.touch = { actor: a.actor, label: a.label || a.action, at: Date.now(), live };
      if (c.el) this.fillCard(c);
      last = c;
    }
    if (last) this.moveCursor(a.actor, last, a.label || a.action);
  }

  private moveCursor(actor: string, c: Card, label: string): void {
    const f = this.frameOf(c);
    if (!f) return;
    let cur = this.cursors.get(actor);
    if (!cur) {
      const el = document.createElement('div');
      el.className = 'cv-cursor';
      el.style.setProperty('--ac', agentColor(actor));
      el.style.opacity = '0';
      this.fg.appendChild(el);
      cur = { el, timer: 0 };
      this.cursors.set(actor, cur);
      const b = cardBox(f, c);
      el.style.transform = `translate(${b.x + b.w + 40}px,${b.y - 40}px)`;
      void el.offsetWidth;
    }
    cur.el.innerHTML = `<div class="cv-cursor-in">${CURSOR_SVG}<b>${esc(actor)}<small>${esc(label)}</small></b></div>`;
    const b = cardBox(f, c);
    cur.el.style.opacity = '1';
    cur.el.style.transform = `translate(${b.x + b.w - 34}px,${b.y + b.h - 30}px)`;
    this.fg.appendChild(cur.el);
    clearTimeout(cur.timer);
    const ref = cur;
    cur.timer = window.setTimeout(() => {
      ref.el.style.opacity = '0';
      window.setTimeout(() => {
        if (ref.el.style.opacity === '0') {
          ref.el.remove();
          this.cursors.delete(actor);
        }
      }, 500);
    }, 9000);
  }

  private decayTouches(): void {
    const now = Date.now();
    for (const c of this.cards.values()) {
      if (!c.touch) continue;
      if (c.touch.live && now - c.touch.at > 60000) c.touch.live = false;
      if (now - c.touch.at > TOUCH_MS) c.touch = null;
      if (c.el) this.fillCard(c);
    }
  }

  private onMutation(m: WsEvent): void {
    const node = (m.node || {}) as { path?: string };
    const path = String(node.path || m.path || '');
    const old = String(m.old_path || '');
    if (m.type === 'node_renamed' && old && path) {
      const c = this.cards.get(old);
      if (c) this.rekey(c, path);
    }
    if (path) {
      invalidate(path);
      this.flashPending.add(path);
      const c = this.cards.get(path);
      if (c) {
        if (m.actor) c.touch = { actor: String(m.actor), label: String(m.type).replace('node_', ''), at: Date.now(), live: false };
        if (c.el) this.fillCard(c);
      }
    }
    // realtime.ts reloads the tree and calls refreshPage; this is the fallback.
    if (this.busy) return;
    const tree = state.tree;
    clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => {
      if (state.tree === tree) void this.afterWrite();
      else {
        this.sync();
        this.scheduleLinks();
      }
    }, 900);
  }
}

/** Call `fn` when the view section is shown or hidden by the router. */
function observeVisibility(node: HTMLElement, fn: (visible: boolean) => void): void {
  let vis = !node.classList.contains('hidden');
  new MutationObserver(() => {
    const now = !node.classList.contains('hidden');
    if (now !== vis) {
      vis = now;
      fn(now);
    }
  }).observe(node, { attributes: true, attributeFilter: ['class'] });
}

const HIDDEN_KEY = 'memora.canvas.hiddenFrames';

function loadHiddenFrames(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveHiddenFrames(s: Set<string>): void {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(s)));
  } catch {
    /* private mode */
  }
}

const LABELS_KEY = 'memora.canvas.labels';

function loadLabelPrefs(): { nodes: boolean; folders: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(LABELS_KEY) || '{}');
    return { nodes: v.nodes !== false, folders: v.folders !== false };
  } catch {
    return { nodes: true, folders: true };
  }
}

function saveLabelPrefs(p: { nodes: boolean; folders: boolean }): void {
  try {
    localStorage.setItem(LABELS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}
