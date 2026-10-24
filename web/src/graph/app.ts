// One instance lives for the page session; suspend() drops frames and listeners, positions stay.

import { apiGet } from '../api';
import { on } from '../bus';
import { esc } from '../dom';
import { agentColor } from '../control/agents';
import { readTagIndex } from '../storage';
import type { GraphData } from '../types';
import { Camera, type Box } from './camera';
import { GraphModel, type Filters } from './data';
import { clusterTargets, radialTargets, seedPositions } from './layouts';
import type { GLink, GNode, LayoutMode, Pulse } from './model';
import { defaultPrefs, factoryPrefs, loadLayout, loadPrefs, saveLayout, savePrefs, type GraphLayout } from './persist';
import { DYING_MS, Renderer, drawMinimap, type Theme } from './render';
import { Simulation } from './sim';
import { graphStyles } from './styles';
import { helpHTML, sliderHTML, toggleHTML, ViewChrome } from '../ui/view-chrome';
import { NodeCard, type CardLink } from '../ui/node-card';

const ICON: Record<string, string> = {
  force: '<circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="6" r="1.6"/><circle cx="19" cy="7" r="1.6"/><circle cx="7" cy="19" r="1.6"/><path d="M10 10.5 6.3 7M14 11l3.6-3M10.4 14 8 17.6"/>',
  radial: '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="9"/>',
  clusters: '<circle cx="7.5" cy="8" r="3.5"/><circle cx="16.5" cy="9" r="3"/><circle cx="11" cy="17" r="3.5"/>',
  pin: '<path d="M9 4h6l-1 5 3 3H7l3-3zM12 15v5"/>',
};
const svg = (n: string) => `<svg viewBox="0 0 24 24">${ICON[n] || ''}</svg>`;

interface Gesture {
  id: number;
  sx: number;
  sy: number;
  lx: number;
  ly: number;
  lt: number;
  vx: number;
  vy: number;
  node: GNode | null;
  moved: boolean;
  touch: boolean;
}

export class GraphApp {
  readonly root: HTMLElement;
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mini: HTMLCanvasElement;
  private chrome: ViewChrome;
  private renderer: Renderer;
  private cam = new Camera();
  private sim = new Simulation();
  private model = new GraphModel();
  private prefs = loadPrefs();
  private layout: GraphLayout = { v: 1, pins: {} };
  private filters: Filters;
  private nodes: GNode[] = [];
  private links: GLink[] = [];
  private nbr = new Map<GNode, Set<GNode>>();
  private hover: GNode | null = null;
  private selected: GNode | null = null;
  private dragging: GNode | null = null;
  private hits: Set<GNode> | null = null;
  private focus: Set<GNode> | null = null;
  private pulses = new Map<string, Pulse[]>();
  private rings: number[] = [];
  private theme: Theme = { light: false, bg: '#0b0e14', ink: '#e6e9ef', muted: '#8b98ad', accent: '#5eead4', panel: '#12161f' };
  private dpr = 1;
  private raf = 0;
  private active = false;
  private dirty = true;
  private frame = 0;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private refreshTimer = 0;
  private userMoved = false;
  private unsubs: (() => void)[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private pinch: { d0: number; k0: number; mx: number; my: number } | null = null;
  private lastTap = { node: null as GNode | null, t: 0 };
  private miniMap = { x0: 0, y0: 0, s: 1 };
  private card!: NodeCard;
  private flashTimer = 0;

  constructor(host: HTMLElement) {
    graphStyles();
    this.filters = { hiddenGroups: new Set(), tags: new Set(), folders: this.prefs.folders, orphans: this.prefs.orphans };
    this.sim.spacing = this.prefs.spacingBy[this.prefs.mode];
    host.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'gx';
    root.innerHTML = this.template();
    host.appendChild(root);
    this.root = root;
    this.cv = root.querySelector('.gx-cv') as HTMLCanvasElement;
    this.ctx = this.cv.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    this.chrome = this.buildChrome();
    this.card = this.buildCard();
    this.mini = this.chrome.miniCanvas;
    this.renderer = new Renderer(this.ctx);
    this.wireCanvas();
  }

  clientPoint(path: string): { x: number; y: number } | null {
    const n = this.nodes.find((x) => x.path === path);
    if (!n || !this.root.isConnected) return null;
    const r = this.cv.getBoundingClientRect();
    const s = this.cam.toScreen(n.x, n.y);
    return { x: r.left + s.x, y: r.top + s.y };
  }

  /** Safe to call repeatedly. */
  show(): void {
    this.chrome.shown();
    const back = !this.active;
    if (!this.active) this.resume();
    if (!this.loaded) {
      void this.load(false);
    } else {
      this.refreshSoon(150);
      if (back) {
        this.userMoved = false;
        window.setTimeout(() => this.fitAll(500), 60);
      }
    }
    this.dirty = true;
    this.resize();
    this.kick();
  }

  private resume(): void {
    this.active = true;
    this.readTheme();
    this.model.recolor(this.theme.light);
    this.resize();
    const dots = () => {
      this.dirty = true;
      this.kick();
    };
    window.addEventListener('memora:dots', dots);
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.root);
    const mo = new MutationObserver(() => {
      this.readTheme();
      this.model.recolor(this.theme.light);
      this.renderer.hullsDirty = true;
      this.kick();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    const vis = () => {
      if (!document.hidden) {
        this.kick();
        return;
      }
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    };
    document.addEventListener('visibilitychange', vis);
    const key = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', key);
    this.unsubs.push(
      () => ro.disconnect(),
      () => mo.disconnect(),
      () => document.removeEventListener('visibilitychange', vis),
      () => window.removeEventListener('keydown', key),
      () => window.removeEventListener('memora:dots', dots),
      on('mutation', (ev) => this.onMutation(ev as Record<string, unknown>)),
      on('activity', (a) => this.onActivity(a.actor, a.phase, a.paths || [])),
    );
    this.kick();
  }

  suspend(): void {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.flashTimer);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.pointers.clear();
    this.gesture = null;
    this.pinch = null;
    if (this.dragging) this.endDrag();
    this.setHover(null);
  }

  private async load(animate: boolean): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      let g: GraphData;
      try {
        const [data, layout] = await Promise.all([
          apiGet<GraphData>('/api/graph'),
          this.loaded ? Promise.resolve(this.layout) : loadLayout(),
        ]);
        g = data;
        this.layout = layout;
      } catch (e) {
        this.showEmpty('Could not load the graph', (e as Error).message);
        return;
      }
      const first = !this.loaded;
      const now = performance.now();
      const { added, removed } = this.model.ingest(g, now, animate && !first);
      if (first) this.importCachedTags();
      this.model.recolor(this.theme.light);
      for (const n of added) {
        const p = this.layout.pins[n.id] || (n.kind === 'note' ? this.layout.pins[n.label] : undefined); // older layouts pinned by name
        if (p) {
          n.pinned = true;
          n.x = n.fx = p[0];
          n.y = n.fy = p[1];
        }
      }
      this.loaded = true;
      this.rebuild();
      if (first) {
        seedPositions(this.nodes);
        this.applyMode(false);
        // Warm start: settle the coarse shape, leave the last stretch of annealing visible.
        const warm = Math.min(220, Math.floor(400000 / Math.max(200, this.nodes.length)));
        for (let i = 0; i < warm && this.sim.alpha > 0.12; i++) this.sim.tick();
        this.fitAll(0);
        window.setTimeout(() => !this.userMoved && this.fitAll(900), 1600);
      } else if (added.length || removed.length) {
        this.sim.reheat(0.35);
      }
      this.renderPanel();
      this.updateHud();
      if (this.selected) this.paintCard(this.selected);
      this.showEmpty('', '');
      this.chrome.setEmpty(!Array.from(this.model.all.values()).some((n) => n.kind === 'note'));
      this.kick();
    })().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private refreshSoon(ms = 350): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => void this.load(true), ms);
  }

  private rebuild(): void {
    const { nodes, links } = this.model.visible(this.filters);
    this.nodes = nodes;
    this.links = links;
    for (const n of nodes) if (n.pinned && n.fx == null) (n.fx = n.x), (n.fy = n.y);
    seedPositions(nodes);
    this.sim.setData(nodes, links);
    this.nbr.clear();
    for (const n of nodes) this.nbr.set(n, new Set());
    for (const l of links) {
      this.nbr.get(l.s)!.add(l.t);
      this.nbr.get(l.t)!.add(l.s);
    }
    if (this.selected && !this.nbr.has(this.selected)) this.closeCard();
    if (this.hover && !this.nbr.has(this.hover)) this.hover = null;
    if (this.prefs.mode !== 'force') this.computeTargets();
    this.renderer.hullsDirty = true;
    if (this.hits) this.chrome?.finder?.update();
    this.updateFocus();
    this.dirty = true;
  }

  private computeTargets(): void {
    if (this.prefs.mode === 'radial') this.rings = radialTargets(this.nodes).rings;
    else if (this.prefs.mode === 'clusters') clusterTargets(this.nodes);
    else return;
    const k = this.prefs.spacingBy[this.prefs.mode];
    if (k === 1) return;
    for (const n of this.nodes) {
      n.tx *= k;
      n.ty *= k;
    }
    this.rings = this.rings.map((r) => r * k);
  }

  private applyMode(animate: boolean): void {
    const m = this.prefs.mode;
    this.sim.mode = m;
    this.sim.spacing = this.prefs.spacingBy[m];
    this.sim.targetPull = m === 'force' ? 0 : m === 'radial' ? 0.16 : 0.12;
    if (m !== 'force') this.computeTargets();
    this.sim.alpha = 1;
    this.renderer.hullsDirty = true;
    if (animate) {
      if (m !== 'force') {
        const b = this.bounds(true);
        if (b) this.cam.fit(b, 40, 1000, 1.6, this.topInset(), 10);
      } else window.setTimeout(() => this.fitAll(900), 900);
    }
    this.kick();
  }

  setMode(m: LayoutMode): void {
    if (m === this.prefs.mode) return;
    this.prefs.mode = m;
    savePrefs(this.prefs);
    this.applyMode(true);
  }

  /** Canvas pixels covered by the floating toolbar at the top. */
  private topInset(): number {
    const top = this.root.querySelector('.vc-search') as HTMLElement | null;
    return top ? top.getBoundingClientRect().bottom - this.root.getBoundingClientRect().top + 4 : 56;
  }

  private bounds(targets = false): Box | null {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const n of this.nodes) {
      if (n.dying) continue;
      const x = targets && n.fx == null ? n.tx : n.x;
      const y = targets && n.fy == null ? n.ty : n.y;
      x0 = Math.min(x0, x - n.r);
      y0 = Math.min(y0, y - n.r);
      x1 = Math.max(x1, x + n.r);
      y1 = Math.max(y1, y + n.r);
    }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  }

  fitAll(ms = 650): void {
    const b = this.bounds();
    if (!b) return;
    const narrow = this.cam.w < 760;
    this.cam.fit(b, narrow ? 20 : 48, ms, 1.6, this.topInset(), narrow ? 40 : 10);
    this.kick();
  }

  private kick(): void {
    if (!this.active || this.raf || document.hidden) return;
    this.raf = requestAnimationFrame((t) => this.frameStep(t));
  }

  private frameStep(now: number): void {
    this.raf = 0;
    if (!this.active) return;
    if (!this.root.isConnected || this.root.offsetParent === null) {
      // Hidden by the router without suspend(): sleep until shown again.
      return;
    }
    this.frame++;
    let moving = false;
    if (this.sim.running && this.nodes.length) {
      // When a tick costs more than ~half a frame, simulate every other frame.
      if (this.tickMs < 9 || this.frame % 2 === 0) {
        const t0 = performance.now();
        this.sim.tick();
        this.tickMs = this.tickMs * 0.8 + (performance.now() - t0) * 0.2;
      }
      moving = true;
      if (this.frame % 3 === 0) this.renderer.hullsDirty = true;
    }
    if (this.cam.step(now)) moving = true;
    if (this.model.reap(now, DYING_MS)) this.rebuild();
    let animating = false;
    for (const n of this.nodes) {
      if (n.born || n.dying) {
        animating = true;
        break;
      }
    }
    if (this.pulses.size) {
      animating = true;
      this.pulses.forEach((list, id) => {
        for (const p of list) if (!p.end && now - p.start > 30000) p.end = now;
        const keep = list.filter((p) => !p.end || now - p.end < 2600);
        if (keep.length) this.pulses.set(id, keep);
        else this.pulses.delete(id);
      });
    }
    const flows = !!(this.hover || this.selected);
    if (moving || animating || flows || this.dirty || this.fading) {
      try {
        this.fading = this.draw(now);
      } catch (e) {
        console.error('graph draw failed', e);
        this.fading = false;
      }
      if (this.chrome.prefs.minimap && (this.frame % 4 === 0 || this.dirty)) this.chrome.redrawMini();
      this.dirty = false;
    }
    if (moving || animating || flows || this.fading) this.kick();
  }

  private fading = false;
  private tickMs = 0;

  private draw(now: number): boolean {
    const before = this.nodes.reduce((s, n) => s + n.fade, 0);
    this.renderer.draw(
      this.cam,
      {
        nodes: this.nodes,
        links: this.links,
        hover: this.hover,
        selected: this.selected,
        focus: this.focus,
        pulses: this.pulses,
        mode: this.prefs.mode,
        rings: this.rings,
        labelDensity: this.prefs.labels,
        noteLabels: this.prefs.noteLabels,
        folderLabels: this.prefs.folderLabels,
        hulls: this.prefs.hulls,
        now,
        dragging: this.dragging,
        reserveTop: this.topInset(),
      },
      this.theme,
      this.dpr,
    );
    const after = this.nodes.reduce((s, n) => s + n.fade, 0);
    return Math.abs(after - before) > 0.01;
  }

  private resize(): void {
    const r = this.root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cv.width = Math.round(r.width * this.dpr);
    this.cv.height = Math.round(r.height * this.dpr);
    const unsized = this.cam.w <= 1 || this.cam.h <= 1;
    this.cam.w = r.width;
    this.cam.h = r.height;
    if (unsized && this.loaded && !this.userMoved) this.fitAll(0);
    this.dirty = true;
    this.kick();
  }

  private readTheme(): void {
    const cs = getComputedStyle(this.root);
    const light = document.documentElement.dataset.theme === 'light';
    const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
    this.theme = {
      light,
      bg: v('--bg', light ? '#f3f5f9' : '#0b0e14'),
      ink: v('--fg', light ? '#111827' : '#e6e9ef'),
      muted: v('--muted', light ? '#5b6678' : '#8b98ad'),
      accent: v('--accent', light ? '#0d9488' : '#5eead4'),
      panel: v('--panel', light ? '#ffffff' : '#12161f'),
    };
    // Canvas needs concrete colours.
    for (const k of ['bg', 'ink', 'muted', 'accent', 'panel'] as const) {
      const c = this.theme[k];
      if (!/^#|^rgb/.test(c)) {
        this.ctx.fillStyle = c;
        this.theme[k] = String(this.ctx.fillStyle);
      }
    }
    this.dirty = true;
  }

  private q(sel: string): HTMLElement {
    return (this.root.querySelector(sel) as HTMLElement) || document.createElement('div');
  }

  private template(): string {
    return `
<canvas class="gx-cv" tabindex="0" aria-label="Knowledge graph"></canvas>
<div class="gx-empty gx-hide"><b></b><span></span></div>
<div class="gx-tip gx-glass gx-hide"></div>
`;
  }

  private buildChrome(): ViewChrome {
    return new ViewChrome({
      page: 'graph',
      root: this.root,
      search: {
        placeholder: 'Find a note, #tag or in:folder',
        find: {
          items: () =>
            this.nodes
              .filter((n) => n.kind !== 'folder' && !n.dying)
              .map((n) => ({
                id: n.path,
                name: n.label,
                folder: n.dir || 'Root',
                region: n.group,
                color: n.color,
                tags: this.model.tagsByPath.get(n.path) || n.tags,
                degree: n.degree,
              })),
          highlight: (ids) => {
            this.hits = ids ? new Set(this.nodes.filter((n) => ids.has(n.path))) : null;
            this.updateFocus();
          },
          pick: (it) => {
            const n = this.nodes.find((x) => x.path === it.id && x.kind !== 'folder');
            if (n) this.select(n, true);
          },
          folder: (g) => {
            this.focusGroup(g);
            this.showFolderCard(this.groupDir(g));
          },
        },
      },
      changed: () =>
        JSON.stringify(this.prefs) !== JSON.stringify(factoryPrefs()) ||
        this.filters.hiddenGroups.size > 0 ||
        this.filters.tags.size > 0 ||
        !!this.hits ||
        !!this.selected ||
        !!this.card?.isOpen ||
        this.userMoved,
      labels: {
        get: () => ({ nodes: this.prefs.noteLabels, folders: this.prefs.folderLabels }),
        set: (kind, on) => {
          if (kind === 'nodes') this.prefs.noteLabels = on;
          else this.prefs.folderLabels = on;
          savePrefs(this.prefs);
          this.dirty = true;
          this.kick();
        },
        help: {
          nodes: 'Names next to the notes. The note under the pointer and its neighbours always show theirs.',
          folders: 'Folder names: the point of each folder and the title over the area its notes fill.',
        },
      },
      filter: (host) => this.renderPanel(host),
      reset: () => {
        this.prefs = defaultPrefs();
        savePrefs(this.prefs);
        this.filters.hiddenGroups = new Set();
        this.filters.tags = new Set();
        this.filters.folders = this.prefs.folders;
        this.filters.orphans = this.prefs.orphans;
        this.chrome.finder?.clear();
        this.closeCard();
        this.rebuild();
        this.applyMode(false);
        this.sim.reheat(0.6);
        this.userMoved = false;
        window.setTimeout(() => this.fitAll(700), 350);
        this.updateHud();
      },
      regions: {
        list: () => this.model.groups().map(([name, count, color]) => ({ name, count, color, hidden: this.filters.hiddenGroups.has(name) })),
        toggle: (g) => {
          if (this.filters.hiddenGroups.has(g)) this.filters.hiddenGroups.delete(g);
          else this.filters.hiddenGroups.add(g);
          this.applyFilters();
        },
        setAll: (hide) => {
          this.filters.hiddenGroups = hide ? new Set(this.model.groups().map((g) => g[0])) : new Set();
          this.applyFilters();
        },
        focus: (g) => {
          this.focusGroup(g);
          this.showFolderCard(this.groupDir(g));
        },
      },
      nav: {
        zoom: (f) => {
          this.userMoved = true;
          this.cam.animateTo(this.cam.x, this.cam.y, this.cam.k * f, 300);
          this.kick();
        },
        fit: () => {
          this.userMoved = true;
          this.fitAll();
        },
        nudge: (dx, dy) => {
          this.userMoved = true;
          this.cam.animateTo(this.cam.x + (dx * this.cam.w * 0.16) / this.cam.k, this.cam.y + (dy * this.cam.h * 0.16) / this.cam.k, this.cam.k, 200);
          this.kick();
        },
        home: () => {
          this.userMoved = false;
          this.fitAll();
        },
      },
      minimap: (cv, w, h, dpr) => {
        const ctx = cv.getContext('2d');
        if (ctx) this.miniMap = drawMinimap(ctx, w, h, dpr, this.nodes, this.cam, this.theme);
      },
      minimapNav: (fx, fy) => {
        const r = this.mini.getBoundingClientRect();
        this.userMoved = true;
        this.cam.stop();
        this.cam.x = (fx * r.width - this.miniMap.x0) / this.miniMap.s;
        this.cam.y = (fy * r.height - this.miniMap.y0) / this.miniMap.s;
        this.dirty = true;
        this.kick();
      },
      onPrefs: () => {
        this.dirty = true;
        this.kick();
      },
      onOverlay: () => this.closeCard(),
    });
  }

  private focusGroup(g: string): void {
    const ns = this.nodes.filter((n) => !n.dying && n.group === g);
    if (!ns.length) return;
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const n of ns) {
      b.x0 = Math.min(b.x0, n.x - n.r);
      b.y0 = Math.min(b.y0, n.y - n.r);
      b.x1 = Math.max(b.x1, n.x + n.r);
      b.y1 = Math.max(b.y1, n.y + n.r);
    }
    this.userMoved = true;
    this.cam.fit(b, 60, 700, 1.8, this.topInset(), 10);
    // Light the folder for a moment, then back to normal.
    this.focus = new Set(ns);
    this.dirty = true;
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.updateFocus(), 1800);
    this.kick();
  }

  private showEmpty(title: string, sub: string): void {
    const e = this.q('.gx-empty');
    e.classList.toggle('gx-hide', !title);
    (e.querySelector('b') as HTMLElement).textContent = title;
    (e.querySelector('span') as HTMLElement).textContent = sub;
  }

  private updateHud(): void {
    this.chrome.setBadge(this.filters.tags.size);
    this.chrome.refreshRegions();
  }

  private updateFocus(): void {
    const center = this.dragging || this.hover || this.selected;
    if (center) {
      const s = new Set<GNode>([center]);
      this.nbr.get(center)?.forEach((n) => s.add(n));
      this.focus = s;
    } else this.focus = this.hits;
    this.dirty = true;
    this.kick();
  }

  private setHover(n: GNode | null, sx = 0, sy = 0): void {
    const tip = this.q('.gx-tip');
    if (n && !this.dragging) {
      const nb = this.nbr.get(n)?.size || 0;
      const sub =
        n.kind === 'folder'
          ? `Folder · ${n.degree} item${n.degree === 1 ? '' : 's'}`
          : `${esc(n.dir || 'Vault root')} · ${nb} connection${nb === 1 ? '' : 's'}`;
      tip.innerHTML = `<b>${esc(n.label)}</b><span>${sub}${n.pinned ? ' · pinned' : ''}</span>`;
      tip.style.left = Math.min(sx, this.cam.w - 270) + 'px';
      tip.style.top = Math.min(sy, this.cam.h - 70) + 'px';
      tip.classList.remove('gx-hide');
    } else tip.classList.add('gx-hide');
    if (n === this.hover) return;
    this.hover = n;
    this.cv.classList.toggle('pointing', !!n);
    this.updateFocus();
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private pick(sx: number, sy: number, touch = false): GNode | null {
    const w = this.cam.toWorld(sx, sy);
    const slop = (touch ? 14 : 5) / this.cam.k;
    let best: GNode | null = null;
    let bd = Infinity;
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (n.dying || n.fade < 0.3) continue;
      const dx = n.x - w.x;
      const dy = n.y - w.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const reach = Math.max(n.r, 3 / this.cam.k) + slop;
      if (d < reach && d - n.r < bd) {
        bd = d - n.r;
        best = n;
      }
    }
    return best;
  }

  private wireCanvas(): void {
    const cv = this.cv;
    cv.addEventListener('pointerdown', (e) => {
      cv.focus({ preventScroll: true });
      const p = this.local(e);
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events */
      }
      this.pointers.set(e.pointerId, p);
      this.cam.stop();
      this.userMoved = true;
      if (this.pointers.size === 2) {
        if (this.dragging) this.endDrag();
        this.gesture = null;
        const [a, b] = Array.from(this.pointers.values());
        this.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: this.cam.k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        return;
      }
      if (this.pointers.size > 2) return;
      const touch = e.pointerType !== 'mouse';
      this.gesture = {
        id: e.pointerId,
        sx: p.x,
        sy: p.y,
        lx: p.x,
        ly: p.y,
        lt: performance.now(),
        vx: 0,
        vy: 0,
        node: this.pick(p.x, p.y, touch),
        moved: false,
        touch,
      };
    });
    cv.addEventListener('pointermove', (e) => {
      const p = this.local(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = Array.from(this.pointers.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        this.cam.panBy(mx - this.pinch.mx, my - this.pinch.my);
        this.cam.zoomAt(mx, my, (this.pinch.k0 * (d / this.pinch.d0)) / this.cam.k);
        this.pinch.mx = mx;
        this.pinch.my = my;
        this.dirty = true;
        this.kick();
        return;
      }
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) {
        if (e.pointerType === 'mouse' && !this.pointers.size) this.setHover(this.pick(p.x, p.y), p.x, p.y);
        return;
      }
      if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) > (g.touch ? 7 : 3)) {
        g.moved = true;
        if (g.node) this.startDrag(g.node);
        else this.cv.classList.add('grabbing');
      }
      if (!g.moved) return;
      const now = performance.now();
      if (this.dragging) {
        const w = this.cam.toWorld(p.x, p.y);
        this.dragging.fx = this.dragging.x = w.x;
        this.dragging.fy = this.dragging.y = w.y;
        this.sim.reheat(0.25);
        this.edgePan(p.x, p.y);
      } else {
        const dx = p.x - g.lx;
        const dy = p.y - g.ly;
        this.cam.panBy(dx, dy);
        const dt = Math.max(1, now - g.lt);
        const k = 16 / dt;
        g.vx = g.vx * 0.6 + dx * k * 0.4;
        g.vy = g.vy * 0.6 + dy * k * 0.4;
        this.dirty = true;
      }
      g.lx = p.x;
      g.ly = p.y;
      g.lt = now;
      this.kick();
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pinch) {
        if (this.pointers.size < 2) this.pinch = null;
        this.gesture = null;
        return;
      }
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      this.gesture = null;
      this.cv.classList.remove('grabbing');
      if (this.dragging) {
        this.endDrag();
        return;
      }
      if (g.moved) {
        if (e.type === 'pointerup' && performance.now() - g.lt < 70) {
          this.cam.vx = g.vx;
          this.cam.vy = g.vy;
          this.kick();
        }
        return;
      }
      if (e.type === 'pointerup') this.tap(g.node);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.pointers.size) this.setHover(null);
    });
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.userMoved = true;
        const p = this.local(e);
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        const dy = e.deltaY * unit;
        if (e.ctrlKey || Math.abs(e.deltaX) < 1 || e.deltaMode !== 0 || Math.abs(dy) >= 40) {
          this.cam.zoomAt(p.x, p.y, Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0018)));
        } else {
          // Two-finger trackpad scroll pans.
          this.cam.panBy(-e.deltaX * unit, -dy);
        }
        this.dirty = true;
        this.kick();
      },
      { passive: false },
    );
    cv.addEventListener('dblclick', (e) => e.preventDefault());
  }

  /** Near the edge while dragging, nudge the camera so the node can travel. */
  private edgePan(x: number, y: number): void {
    const m = 36;
    const dx = x < m ? m - x : x > this.cam.w - m ? this.cam.w - m - x : 0;
    const dy = y < m + 50 ? m + 50 - y : y > this.cam.h - m ? this.cam.h - m - y : 0;
    if (dx || dy) this.cam.panBy(dx * 0.15, dy * 0.15);
  }

  private startDrag(n: GNode): void {
    this.dragging = n;
    n.fx = n.x;
    n.fy = n.y;
    this.sim.alphaTarget = 0.28;
    this.sim.reheat(0.3);
    this.cv.classList.add('grabbing');
    this.q('.gx-tip').classList.add('gx-hide');
    this.updateFocus();
  }

  private endDrag(): void {
    const n = this.dragging;
    if (!n) return;
    this.dragging = null;
    this.sim.alphaTarget = 0;
    if (n.pinned) {
      n.fx = n.x;
      n.fy = n.y;
      this.layout.pins[n.id] = [Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10];
      saveLayout(this.layout);
    } else {
      n.fx = null;
      n.fy = null;
    }
    this.cv.classList.remove('grabbing');
    this.updateFocus();
    this.kick();
  }

  private tap(n: GNode | null): void {
    const now = performance.now();
    const dbl = n && this.lastTap.node === n && now - this.lastTap.t < 340;
    this.lastTap = { node: n, t: dbl ? 0 : now };
    if (dbl && n) {
      this.togglePin(n);
      return;
    }
    if (n) this.select(n, false);
    else {
      this.closeCard();
      this.chrome.closePanel();
    }
  }

  togglePin(n: GNode): void {
    n.pinned = !n.pinned;
    if (n.pinned) {
      n.fx = n.x;
      n.fy = n.y;
      this.layout.pins[n.id] = [Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10];
    } else {
      n.fx = null;
      n.fy = null;
      delete this.layout.pins[n.id];
      this.sim.reheat(0.2);
    }
    saveLayout(this.layout);
    if (this.selected === n) this.paintCard(n);
    this.dirty = true;
    this.kick();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.active || this.root.offsetParent === null) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      this.chrome.focusSearch();
    } else if (e.key === 'Escape') {
      this.closeCard();
      this.chrome.closePanel();
    } else if (e.key === 'f' || e.key === 'F') this.fitAll();
    else if (e.key === '1') this.setMode('force');
    else if (e.key === '2') this.setMode('radial');
    else if (e.key === '3') this.setMode('clusters');
    else if ((e.key === 'p' || e.key === 'P') && this.selected) this.togglePin(this.selected);
  }

  select(n: GNode, center: boolean): void {
    this.selected = n;
    this.chrome.close();
    this.paintCard(n);
    if (center) {
      this.userMoved = true;
      const k = Math.max(this.cam.k, 1.1);
      // On narrow screens the card covers the bottom; aim above it.
      const off = this.cam.w < 760 ? this.cam.h * 0.22 : -Math.min(160, this.cam.w * 0.12);
      this.cam.animateTo(n.x + (this.cam.w < 760 ? 0 : -off / k), n.y + (this.cam.w < 760 ? off / k : 0), k, 600);
    }
    this.updateFocus();
  }

  closeCard(): void {
    this.card.close();
    if (!this.selected) return;
    this.selected = null;
    this.updateFocus();
  }

  private groupDir(g: string): string {
    return this.nodes.find((n) => n.kind === 'folder' && n.group === g && !n.dir)?.path ?? g;
  }

  private groupOf(folder: string): string {
    return this.nodes.find((n) => n.dir === folder || n.path === folder)?.group ?? (folder.split('/')[0] || folder);
  }

  private nodeAt(path: string): GNode | undefined {
    return this.nodes.find((n) => n.path === path && !n.dying);
  }

  private asLink = (n: GNode): CardLink => ({ path: n.path, name: n.label, color: n.color, degree: n.degree });

  private showFolderCard(folder: string): void {
    const f = this.nodes.find((n) => n.kind === 'folder' && n.path === folder);
    const color = f?.color || this.nodes.find((n) => n.dir === folder)?.color || '#888';
    this.card.showFolder(folder, color);
  }

  private paintCard(n: GNode): void {
    if (n.kind === 'note') this.card.showNote(n.path, n.label, n.dir || 'Root', n.color, this.model.tagsByPath.get(n.path) || n.tags);
    else this.card.showFolder(n.path, n.color);
  }

  private buildCard(): NodeCard {
    const ids = (set: Iterable<string> | undefined): CardLink[] =>
      Array.from(set || [])
        .map((id) => this.model.all.get(id))
        .filter((m): m is GNode => !!m && !m.dying)
        .sort((a, b) => b.degree - a.degree)
        .map(this.asLink);
    return new NodeCard({
      root: this.root,
      focusNode: (p) => {
        const n = this.nodeAt(p);
        if (n) this.select(n, true);
      },
      focusFolder: (f) => this.focusGroup(this.groupOf(f)),
      onlyFolder: (f) => {
        const g = this.groupOf(f);
        this.filters.hiddenGroups = new Set(this.model.groups().map((x) => x[0]).filter((x) => x !== g));
        this.applyFilters();
      },
      pick: (p) => {
        const n = this.nodeAt(p);
        if (n && this.nbr.has(n)) this.select(n, true);
      },
      links: (p) => {
        const n = this.nodeAt(p);
        if (!n) return { out: [], in: [] };
        const out = ids(this.model.outgoing.get(n.id));
        const outs = new Set(out.map((l) => l.path));
        return { out, in: ids(this.model.incoming.get(n.id)).filter((l) => !outs.has(l.path)) };
      },
      folderItems: (f) =>
        this.nodes
          .filter((m) => m.kind === 'note' && !m.dying && (m.dir || 'Root') === (f || 'Root'))
          .sort((a, b) => b.degree - a.degree)
          .map(this.asLink),
      tag: (t) => this.chrome.setQuery('#' + t + ' '),
      extras: (p) => {
        const n = this.nodeAt(p);
        if (!n) return [];
        return [
          {
            id: 'pin',
            label: n.pinned ? 'Unpin (P): let it move again' : 'Pin (P): keep it where it is',
            icon: svg('pin'),
            on: !!n.pinned,
            run: () => this.togglePin(n),
          },
        ];
      },
      home: () => {
        this.userMoved = false;
        this.fitAll(700);
      },
      closed: () => {
        if (!this.selected) return;
        this.selected = null;
        this.updateFocus();
      },
    });
  }

  private applyFilters(): void {
    this.rebuild();
    this.sim.reheat(0.5);
    this.updateHud();
    this.renderPanel();
    if (this.selected) this.paintCard(this.selected);
    window.setTimeout(() => this.fitAll(800), 500);
    this.kick();
  }

  private renderPanel(host?: HTMLElement): void {
    if (!host) {
      this.chrome.renderPanel();
      return;
    }
    const lay = (m: LayoutMode, label: string): string =>
      `<button type="button" data-mode="${m}" class="${this.prefs.mode === m ? 'on' : ''}" title="${label} layout (${m === 'force' ? 1 : m === 'radial' ? 2 : 3})">${svg(m)}${label}</button>`;
    const mode = this.prefs.mode;
    const layHelp: Record<LayoutMode, string> = {
      force: 'Force: linked notes pull together and the rest push apart, so clusters form by themselves.',
      radial: 'Radial: folders sit on rings around the vault, their notes fanned out beneath them.',
      clusters: 'Clusters: each folder gathers into its own island.',
    };
    const spHelp: Record<LayoutMode, string> = {
      force: 'How hard notes push each other apart in the Force layout.',
      radial: 'How far apart the rings of the Radial layout are.',
      clusters: 'How far apart the folder islands of the Clusters layout are.',
    };
    host.innerHTML = `
<h4>Layout ${helpHTML(layHelp[mode])}</h4>
<div class="vc-seg" role="group" aria-label="Layout">${lay('force', 'Force')}${lay('radial', 'Radial')}${lay('clusters', 'Clusters')}</div>
${sliderHTML('spacing', 'Spacing', 0.4, 2.5, 0.05, this.prefs.spacingBy[mode], spHelp[mode])}
<h4>Graph</h4>
${toggleHTML('folders', 'Folder hubs', this.prefs.folders, 'A point for every folder, linked to the notes inside it.')}
${toggleHTML('hulls', 'Folder hulls', this.prefs.hulls, 'A soft shape around the notes of each folder (Force and Clusters).')}
${toggleHTML('orphans', 'Nodes without links', this.prefs.orphans, 'Notes that link nowhere and are linked from nowhere.')}
${this.filters.tags.size ? `<button type="button" class="vc-act" data-clear>Clear tag filter (${this.filters.tags.size})</button>` : ''}
<div class="vc-hint">Drag notes · double-click to pin · / search · #tag finds tags · F fit · 1 2 3 layouts</div>`;
    host.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => {
      b.onclick = () => {
        this.setMode(b.dataset.mode as LayoutMode);
        this.chrome.renderPanel();
      };
    });
    const clear = host.querySelector<HTMLElement>('[data-clear]');
    if (clear)
      clear.onclick = () => {
        this.filters.tags.clear();
        this.applyFilters();
      };
    host.querySelectorAll<HTMLInputElement>('input[data-s]').forEach((inp) => {
      inp.oninput = () => {
        const v = Number(inp.value);
        const m = this.prefs.mode;
        this.prefs.spacingBy[m] = v;
        if (m === 'force') this.prefs.spacing = v;
        this.sim.spacing = v;
        if (m !== 'force') this.computeTargets();
        this.sim.reheat(0.4);
        savePrefs(this.prefs);
        this.dirty = true;
        this.kick();
      };
    });
    host.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.t as 'folders' | 'hulls' | 'orphans';
        this.prefs[k] = !this.prefs[k];
        savePrefs(this.prefs);
        if (k === 'folders' || k === 'orphans') {
          this.filters.folders = this.prefs.folders;
          this.filters.orphans = this.prefs.orphans;
          this.applyFilters();
          return;
        }
        this.chrome.renderPanel();
        this.dirty = true;
        this.kick();
      };
    });
  }

  /** Reuse the Tags view's session cache. */
  private importCachedTags(): void {
    const c = readTagIndex();
    if (!c || !Array.isArray(c.tags)) return;
    const by = new Map<string, string[]>();
    for (const [tag, list] of c.tags) {
      for (const e of list as { path?: string }[]) {
        if (!e || !e.path) continue;
        const arr = by.get(e.path) || [];
        arr.push(tag);
        by.set(e.path, arr);
      }
    }
    by.forEach((t, p) => {
      if (!this.model.tagsByPath.has(p)) this.model.tagsByPath.set(p, t);
    });
  }

  private nodeForPath(p: string): GNode | undefined {
    const clean = p.replace(/^\/+/, '');
    return this.model.byPath.get(clean) || this.model.byPath.get(clean + '.md') || this.model.all.get(this.model.byName.get(clean.replace(/\.md$/, '').split('/').pop() || '') || '');
  }

  private onMutation(ev: Record<string, unknown>): void {
    this.refreshSoon(300);
    const actor = typeof ev.actor === 'string' ? ev.actor : '';
    const path = [ev.path, ev.to, ev.new_path].find((x) => typeof x === 'string') as string | undefined;
    if (actor && path && ev.type !== 'node_deleted') {
      // The node may only exist after the refresh.
      window.setTimeout(() => {
        const n = this.nodeForPath(path);
        if (n) this.addPulse(n.id, actor, true);
      }, 450);
    }
  }

  private onActivity(actor: string, phase: string, paths: string[]): void {
    const now = performance.now();
    const ids = paths.map((p) => this.nodeForPath(p)?.id).filter((x): x is string => !!x);
    if (phase === 'end') {
      const targets = ids.length ? ids : Array.from(this.pulses.keys());
      for (const id of targets) for (const p of this.pulses.get(id) || []) if (p.actor === actor && !p.end) p.end = now;
      if (!ids.length) return;
      for (const id of ids) if (!(this.pulses.get(id) || []).some((p) => p.actor === actor)) this.addPulse(id, actor, true);
      return;
    }
    for (const id of ids) this.addPulse(id, actor, false);
  }

  private addPulse(id: string, actor: string, ended: boolean): void {
    const now = performance.now();
    const list = (this.pulses.get(id) || []).filter((p) => p.actor !== actor);
    list.push({ id, actor, color: agentColor(actor || 'agent'), start: now, end: ended ? now + 1200 : 0 });
    this.pulses.set(id, list.slice(-3));
    this.kick();
  }
}
