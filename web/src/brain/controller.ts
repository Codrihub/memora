// Brain view controller: builds the overlay UI, loads /api/graph, lays the
// notes out into folder regions and wires the bus (activity, mutation).
// One instance lives while #view-brain is visible; `destroy()` releases all.

import { apiGet } from '../api';
import { on, type AgentActivity } from '../bus';
import { attr, esc, useStyles } from '../dom';
import { hooks } from '../hooks';
import { state } from '../state';
import type { GraphLink, GraphNode, WsEvent } from '../types';
import { regionColor } from './palette';
import { BrainScene, type ParticleSpec, type RegionLabel } from './scene';
import { notePoint, regionAnchors, regionSpread, type Vec3 } from './shape';
import { BRAIN_CSS } from './styles';
import type { BrainView } from './home-view';
import { toggleHTML, ViewChrome } from '../ui/view-chrome';
import { setFlightTarget } from '../ui/agent-flight';
import { NodeCard, type CardLink } from '../ui/node-card';

interface Note {
  path: string;
  name: string;
  folder: string;
  tags: string[];
  degree: number;
}

interface Region {
  name: string;
  color: string;
  anchor: Vec3;
  count: number;
}

type GraphNodeX = GraphNode & { tags?: unknown; title?: unknown; name?: unknown };

const PREFS_KEY = 'memora.brain';

interface Prefs {
  /** Note name labels. */
  labels: boolean;
  /** Region (folder) name labels. */
  regionLabels: boolean;
  rotate: boolean;
  /** Regions accordion expanded. */
  regions: boolean;
  /** Regions whose notes are hidden. */
  hidden: string[];
}

function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Partial<Prefs>;
    return {
      labels: v.labels !== false,
      // Older prefs had one switch for both kinds of label.
      regionLabels: v.regionLabels ?? v.labels !== false,
      rotate: v.rotate !== false,
      regions: v.regions === true,
      hidden: Array.isArray(v.hidden) ? v.hidden.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    return defaultPrefs();
  }
}

function defaultPrefs(): Prefs {
  return { labels: true, regionLabels: true, rotate: true, regions: false, hidden: [] };
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

/** Lookup key for a path or note name: lower case, no .md, no leading slash. */
function norm(p: string): string {
  return p.replace(/^\/+/, '').replace(/\.md$/i, '').toLowerCase();
}

function baseName(p: string): string {
  const s = p.split('/');
  return s[s.length - 1] || p;
}

export class BrainController {
  /** The live camera, for the boot splash hand-off; null until the scene is on screen. */
  view(): BrainView | null {
    return this.scene?.cameraView() ?? null;
  }

  readonly root: HTMLElement;
  private section: HTMLElement;
  private scene: BrainScene | null = null;
  private notes: Note[] = [];
  private regions = new Map<string, Region>();
  private index = new Map<string, number>();
  private out = new Map<number, number[]>();
  private inc = new Map<number, number[]>();
  private unsub: (() => void)[] = [];
  private observers: MutationObserver[] = [];
  private prefs = loadPrefs();
  private hidden = new Set<string>();
  private selected = -1;
  private reduced: boolean;
  private refreshTimer = 0;
  private loading: Promise<void> | null = null;
  private pendingFlare: string[] = [];
  private destroyed = false;
  private els: Record<string, HTMLElement> = {};

  constructor(section: HTMLElement) {
    this.section = section;
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.hidden = new Set(this.prefs.hidden);
    useStyles('brain-css', BRAIN_CSS);
    this.root = document.createElement('div');
    this.root.className = 'brain';
    this.root.innerHTML = this.template();
    section.replaceChildren(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-el]').forEach((n) => (this.els[n.dataset.el!] = n));
    this.wireUi();

    try {
      this.scene = new BrainScene(
        this.els.stage,
        this.els.labels,
        {
          onHover: (i, x, y) => this.hover(i, x, y),
          onPick: (i) => this.pick(i),
          labelOf: (i) => this.notes[i]?.name || '',
        },
        this.reduced,
      );
    } catch (e) {
      console.warn('brain: WebGL unavailable', e);
      clearInterval(this.chromeTimer);
      this.els.stage.innerHTML = `<div class="brain-msg"><div>3D needs WebGL, which this browser or device does not provide.<br><button class="bh-btn" data-go="graph">Open the 2D graph</button></div></div>`;
      this.els.stage.querySelector<HTMLElement>('[data-go]')!.onclick = () => hooks.go('graph');
      return;
    }
    // Agents come out of the header pill into the brain and fly back to it when idle.
    this.scene.setDock(() => {
      const el = document.querySelector('#rtAgents .i') || document.getElementById('rtPill');
      const r = el?.getBoundingClientRect();
      return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    });
    // Agents waking up fly to the note they touch, or to their head in the brain.
    setFlightTarget('brain', (actor, _id, paths) => {
      const scene = this.scene;
      if (!scene || !this.alive()) return null;
      for (const p of paths) {
        const i = this.index.get(norm(p)) ?? this.index.get(norm(baseName(p)));
        if (i === undefined) continue;
        const [x, y, z] = scene.positionOf(i);
        const c = scene.projectToClient(x, y, z);
        if (c) return { x: c[0], y: c[1] };
      }
      const h = scene.agentHead(actor);
      const c = h && scene.projectToClient(h[0], h[1], h[2]);
      return c ? { x: c[0], y: c[1] } : null;
    });
    this.scene.setTheme(document.documentElement.dataset.theme === 'light');
    this.scene.setLabels(this.prefs.labels, this.prefs.regionLabels);
    this.scene.setAutoRotate(this.prefs.rotate);

    // Theme changes, visibility of the tab and of the view.
    const themeObs = new MutationObserver(() =>
      this.scene?.setTheme(document.documentElement.dataset.theme === 'light'),
    );
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const viewObs = new MutationObserver(() => this.syncRunning());
    viewObs.observe(section, { attributes: true, attributeFilter: ['class'] });
    this.observers.push(themeObs, viewObs);
    document.addEventListener('visibilitychange', this.syncRunning);

    this.unsub.push(
      on('activity', (a) => this.onActivity(a)),
      on('mutation', (m) => this.onMutation(m)),
    );

    // Show what the shell already loaded at once, then fetch fresh data.
    if (state.graph.nodes.length) this.apply(state.graph.nodes, state.graph.links);
    this.syncRunning();
    void this.refresh();
  }

  /** True while this controller still owns a live view. */
  alive(): boolean {
    return !this.destroyed && this.section.contains(this.root);
  }

  private template(): string {
    return `
<div class="brain-stage" data-el="stage"></div>
<div class="brain-labels" data-el="labels"></div>
<div class="brain-tip hidden" data-el="tip"></div>
<div class="brain-foot"><span class="brain-hint" data-el="hint">Drag to orbit · scroll to zoom · click a node</span></div>`;
  }

  private chrome!: ViewChrome;
  private card!: NodeCard;
  private chromeTimer = 0;

  private wireUi(): void {
    const e = this.els;
    this.chrome = new ViewChrome({
      page: 'brain',
      root: this.root,
      search: {
        placeholder: 'Find a node, #tag or in:folder',
        find: {
          items: () =>
            this.notes.map((n) => ({
              id: n.path,
              name: n.name,
              folder: n.folder,
              region: n.folder,
              color: this.regions.get(n.folder)?.color || '#888',
              tags: n.tags,
              degree: n.degree,
            })),
          hidden: (r) => this.hidden.has(r),
          highlight: (ids) => {
            this.findHit = ids;
            this.applyFilter();
          },
          pick: (it) => {
            const i = this.notes.findIndex((n) => n.path === it.id);
            if (i >= 0) this.select(i, true);
          },
          folder: (r) => this.openFolder(r),
        },
      },
      labels: {
        get: () => ({ nodes: this.prefs.labels, folders: this.prefs.regionLabels }),
        set: (kind, on) => {
          if (kind === 'nodes') this.prefs.labels = on;
          else this.prefs.regionLabels = on;
          savePrefs(this.prefs);
          this.scene?.setLabels(this.prefs.labels, this.prefs.regionLabels);
        },
        help: {
          nodes: 'Names next to the nodes in the brain. The node under the pointer and the selected one always show theirs.',
          folders: 'Region names (one region per folder) floating over the brain.',
        },
      },
      filter: (host) => this.renderFilter(host),
      changed: () => {
        const d = defaultPrefs();
        const p = this.prefs;
        return (
          p.labels !== d.labels ||
          p.regionLabels !== d.regionLabels ||
          p.rotate !== d.rotate ||
          this.hidden.size > 0 ||
          !!this.findHit ||
          this.selected >= 0 ||
          this.card?.isOpen ||
          !!this.scene?.awayFromHome()
        );
      },
      reset: () => {
        // As in Graph and Canvas, the search and any open card are cleared too.
        this.chrome.finder?.clear();
        this.card.close(true);
        const keepOpen = this.prefs.regions;
        this.prefs = { ...defaultPrefs(), regions: keepOpen };
        savePrefs(this.prefs);
        this.scene?.setLabels(true, true);
        this.scene?.setAutoRotate(true);
        this.setHidden([]);
        this.select(-1);
        this.scene?.goHome();
      },
      regions: {
        list: () => Array.from(this.regions.values()).map((r) => ({ name: r.name, color: r.color, count: r.count, hidden: this.hidden.has(r.name) })),
        toggle: (name) => {
          const next = new Set(this.hidden);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          this.setHidden(Array.from(next));
        },
        setAll: (hide) => this.setHidden(hide ? Array.from(this.regions.keys()) : []),
        focus: (name) => this.openFolder(name),
      },
      nav: {
        zoom: (f) => this.scene?.zoomBy(f),
        fit: () => this.scene?.resetView(),
        // Left/right turn the brain that way; up/down tilt it.
        nudge: (dx, dy) => this.scene?.orbitBy(-dx * 0.26, -dy * 0.2),
        home: () => {
          this.select(-1);
          this.scene?.goHome();
        },
      },
      minimap: (cv, w, h, dpr) => this.drawMini(cv, w, h, dpr),
      minimapNav: (fx, fy) => this.miniNav(fx, fy),
      onOverlay: () => {
        this.select(-1);
        this.card.close(true);
      },
    });
    this.card = this.buildCard();
    // The globe and minimap follow the camera.
    this.chromeTimer = window.setInterval(() => {
      if (!this.scene || document.hidden) return;
      const o = this.scene.orientation();
      this.chrome.setOrientation(o.yaw, o.pitch);
      this.chrome.redrawMini();
    }, 120);

    // "/" or Ctrl/Cmd+F inside the brain jumps to the search field.
    this.root.addEventListener('keydown', (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest('input,textarea,select')) return;
      if (ev.key === '/' || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'f')) {
        ev.preventDefault();
        ev.stopPropagation();
        this.chrome.focusSearch();
      }
    });
    // The usage hint fades once the brain has been explored a little.
    window.setTimeout(() => e.hint.classList.add('gone'), 7000);
    this.root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.selected >= 0) this.select(-1);
    });
  }

  /** The brain's own section of the Filter panel. */
  private renderFilter(host: HTMLElement): void {
    host.innerHTML =
      '<h4>Brain</h4>' +
      (this.reduced
        ? ''
        : toggleHTML('rotate', 'Rotate when idle', this.prefs.rotate, 'The brain turns slowly by itself two seconds after you stop moving it. Only the 3D brain has this.')) +
      '<div class="vc-hint">Drag to orbit · scroll to zoom · click a node · / to search · #tag finds tags</div>';
    const b = host.querySelector<HTMLElement>('[data-t=rotate]');
    if (b)
      b.onclick = () => {
        this.prefs.rotate = !this.prefs.rotate;
        this.scene?.setAutoRotate(this.prefs.rotate);
        savePrefs(this.prefs);
        this.chrome.renderPanel();
      };
  }

  /** Top-down map of the brain: every note, and the camera looking in. */
  private drawMini(cv: HTMLCanvasElement, w: number, h: number, dpr: number): void {
    const g = cv.getContext('2d');
    const scene = this.scene;
    if (!g || !scene) return;
    const light = document.documentElement.dataset.theme === 'light';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const S = Math.min(w, h) / 3.4;
    const cx = w / 2;
    const cy = h / 2;
    const n = this.notes.length;
    const step = Math.max(1, Math.ceil(n / 2500));
    for (let i = 0; i < n; i += step) {
      const note = this.notes[i];
      if (this.hidden.has(note.folder)) continue;
      const [x, , z] = scene.positionOf(i);
      g.fillStyle = this.regions.get(note.folder)?.color || '#888';
      g.globalAlpha = 0.75;
      g.fillRect(cx + x * S - 1, cy + z * S - 1, 2, 2);
    }
    g.globalAlpha = 1;
    // Outline of the brain from above.
    g.strokeStyle = light ? 'rgba(15,23,42,.18)' : 'rgba(230,233,239,.16)';
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(cx, cy, 1.25 * S, 1.05 * S, 0, 0, Math.PI * 2);
    g.stroke();
    // The camera: a marker on a ring around the brain, on the side it looks
    // from, with the wedge it sees.
    const v = scene.cameraView();
    if (!v) return;
    const ang = Math.atan2(v.eye[2] - v.target[2], v.eye[0] - v.target[0]);
    const R = Math.min(w, h) / 2 - 7;
    const mx = cx + Math.cos(ang) * R;
    const my = cy + Math.sin(ang) * R;
    const look = ang + Math.PI;
    const half = v.fov * 0.5 * (v.rect.w / v.rect.h);
    const len = R * 1.25;
    const acc = light ? '13,148,136' : '94,234,212';
    g.strokeStyle = `rgba(${acc},.18)`;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = `rgba(${acc},.12)`;
    g.strokeStyle = `rgba(${acc},.6)`;
    g.beginPath();
    g.moveTo(mx, my);
    g.lineTo(mx + Math.cos(look - half) * len, my + Math.sin(look - half) * len);
    g.lineTo(mx + Math.cos(look + half) * len, my + Math.sin(look + half) * len);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    g.fillStyle = `rgb(${acc})`;
    g.beginPath();
    g.arc(mx, my, 4, 0, Math.PI * 2);
    g.fill();
  }

  /** A click on the minimap: look at the brain from that side. */
  private miniNav(fx: number, fy: number): void {
    const scene = this.scene;
    const v = scene?.cameraView();
    const cv = this.chrome.miniCanvas.getBoundingClientRect();
    if (!scene || !v || !cv.width) return;
    const S = Math.min(cv.width, cv.height) / 3.4;
    const x = (fx * cv.width - cv.width / 2) / S;
    const z = (fy * cv.height - cv.height / 2) / S;
    if (Math.hypot(x - v.target[0], z - v.target[2]) < 0.05) return;
    scene.orbitTo(Math.atan2(x - v.target[0], z - v.target[2]), undefined, 0.6);
  }

  // ------------------------------------------------------------ lifecycle

  private syncRunning = (): void => {
    if (!this.scene) return;
    const visible = !document.hidden && !this.section.classList.contains('hidden');
    if (this.section.classList.contains('hidden')) {
      // The view was left: release the GPU and every listener.
      this.destroy();
      return;
    }
    if (visible) this.scene.start();
    else this.scene.stop();
  };

  destroy(): void {
    setFlightTarget('brain', null);
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsub.forEach((u) => u());
    this.unsub = [];
    this.observers.forEach((o) => o.disconnect());
    document.removeEventListener('visibilitychange', this.syncRunning);
    clearTimeout(this.refreshTimer);
    clearInterval(this.chromeTimer);
    this.chrome?.destroy();
    this.scene?.dispose();
    this.scene = null;
    this.root.remove();
  }

  /** Fetch /api/graph and update the particles (coalesces concurrent calls). */
  refresh(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const g = await apiGet<{ nodes?: GraphNodeX[]; links?: GraphLink[] }>('/api/graph');
        if (this.destroyed) return;
        state.graph.nodes = g.nodes || [];
        state.graph.links = g.links || [];
        this.apply(g.nodes || [], g.links || []);
      } catch (err) {
        if (!this.notes.length) this.els.hint.textContent = 'Could not load the graph: ' + (err as Error).message;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  // ------------------------------------------------------------ data

  private apply(nodes: GraphNodeX[], links: GraphLink[]): void {
    if (!this.scene) return;
    const selKey = this.selected >= 0 ? this.notes[this.selected]?.path : '';
    const tagIndex = this.tagIndex();
    const notes: Note[] = nodes.map((n) => {
      const path = String(n.path || n.id);
      const name = typeof n.title === 'string' && n.title ? n.title : String(n.id || baseName(path).replace(/\.md$/i, ''));
      const tags = Array.isArray(n.tags) ? n.tags.map(String) : tagIndex.get(path) || [];
      return { path, name, folder: n.folder || 'Root', tags, degree: n.degree || 0 };
    });
    // Folders become regions: biggest folders get the first anchors.
    const counts = new Map<string, number>();
    notes.forEach((n) => counts.set(n.folder, (counts.get(n.folder) || 0) + 1));
    const folders = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const anchors = regionAnchors(folders.length);
    const alpha = [...folders].sort((a, b) => a[0].localeCompare(b[0])).map((f) => f[0]);
    this.regions = new Map();
    folders.forEach(([name, count], i) => {
      const meta = state.folderMeta[name];
      this.regions.set(name, {
        name,
        count,
        anchor: anchors[i],
        color: regionColor(alpha.indexOf(name), meta && meta.color),
      });
    });

    // Index by path and by note name (links and agents may use either).
    this.index = new Map();
    const byName = new Map<string, number>();
    notes.forEach((n, i) => {
      this.index.set(norm(n.path), i);
      const k = norm(baseName(n.path));
      if (!byName.has(k)) byName.set(k, i);
      const id = norm(n.name);
      if (!byName.has(id)) byName.set(id, i);
    });
    byName.forEach((i, k) => {
      if (!this.index.has(k)) this.index.set(k, i);
    });

    const pairs: [number, number][] = [];
    this.out = new Map();
    this.inc = new Map();
    const seen = new Set<string>();
    for (const l of links) {
      const a = this.index.get(norm(String(l.source)));
      const b = this.index.get(norm(String(l.target)));
      if (a === undefined || b === undefined || a === b) continue;
      const key = a < b ? a + ':' + b : b + ':' + a;
      if (!this.out.has(a)) this.out.set(a, []);
      if (!this.inc.has(b)) this.inc.set(b, []);
      if (!this.out.get(a)!.includes(b)) this.out.get(a)!.push(b);
      if (!this.inc.get(b)!.includes(a)) this.inc.get(b)!.push(a);
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([a, b]);
    }
    const deg = new Array<number>(notes.length).fill(0);
    pairs.forEach(([a, b]) => {
      deg[a]++;
      deg[b]++;
    });

    const big = notes.length > 6000 ? 0.7 : notes.length > 2000 ? 0.85 : 1;
    const specs: ParticleSpec[] = notes.map((n, i) => {
      const r = this.regions.get(n.folder)!;
      const spread = regionSpread(r.count, folders.length);
      return {
        key: n.path,
        target: notePoint(n.path, r.anchor, spread),
        origin: r.anchor,
        color: r.color,
        size: (0.034 + Math.min(0.065, Math.sqrt(deg[i] + n.degree * 0.3) * 0.011)) * big,
      };
    });
    this.notes = notes;
    const regionLabels: RegionLabel[] = Array.from(this.regions.values()).map((r) => ({
      name: r.name,
      anchor: r.anchor,
      color: r.color,
      count: r.count,
    }));
    this.scene.setDim(null);
    this.scene.setData(specs, pairs, regionLabels);
    if (this.selected >= 0) this.selected = -1;

    // Keep only hidden regions that still exist.
    if (this.prefs.hidden.length) this.hidden = new Set(this.prefs.hidden.filter((n) => this.regions.has(n)));
    this.renderRegions();
    // A search that is still typed follows the new data.
    this.chrome?.finder?.update();
    this.applyFilter(false);
    this.scene.refreshNoteLabels();
    if (selKey) {
      const i = this.index.get(norm(selKey));
      if (i !== undefined) this.select(i, false);
      else this.select(-1);
    }
    for (const p of this.pendingFlare.splice(0)) {
      const i = this.index.get(norm(p));
      if (i !== undefined) this.scene.flareNote(i, 1);
    }
  }

  /** Tags from the Tags view index, when it has been built. */
  private tagIndex(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const idx = state.tags.index;
    if (!idx) return out;
    idx.forEach((refs, tag) => {
      for (const r of refs) {
        const p = (r as { path?: string }).path;
        if (!p) continue;
        if (!out.has(p)) out.set(p, []);
        out.get(p)!.push(tag);
      }
    });
    return out;
  }

  // ------------------------------------------------------------ finder

  /** Paths the shared finder lit (ui/map-find.ts); null while nothing is typed. */
  private findHit: Set<string> | null = null;

  private renderRegions(): void {
    this.chrome.refreshRegions();
  }

  private setHidden(names: string[]): void {
    this.hidden = new Set(names.filter((n) => this.regions.has(n)));
    this.prefs.hidden = Array.from(this.hidden);
    savePrefs(this.prefs);
    this.renderRegions();
    this.applyFilter();
  }

  private focusRegion(name: string): void {
    const r = this.regions.get(name);
    // A hidden region has to be shown before the camera can fly to it.
    if (!r || !this.scene || this.hidden.has(name)) return;
    this.scene.focus(r.anchor, 1.9);
    // Light the region's notes so it is clear which one it is.
    let lit = 0;
    for (let i = 0; i < this.notes.length && lit < 80; i++) {
      if (this.notes[i].folder !== name) continue;
      this.scene.flareNote(i, 1);
      lit++;
    }
  }

  // ------------------------------------------------------------ filters

  private matches(i: number): boolean {
    const n = this.notes[i];
    if (!n) return false;
    if (this.hidden.has(n.folder)) return false;
    return !this.findHit || this.findHit.has(n.path);
  }

  private applyFilter(refreshLabels = true): void {
    if (!this.scene) return;
    const any = !!(this.hidden.size || this.findHit);
    this.scene.setHiddenRegions(this.hidden);
    this.scene.setDim(any ? (i) => (this.matches(i) ? 0 : 1) : null);
    if (refreshLabels) this.scene.refreshNoteLabels();
  }

  // ------------------------------------------------------------ hover / select

  private hover(i: number, x: number, y: number): void {
    if (i >= 0 && this.hidden.has(this.notes[i]?.folder)) i = -1; // hidden regions are inert
    const tip = this.els.tip;
    this.root.classList.toggle('hovering', i >= 0);
    if (i < 0 || !this.notes[i]) {
      tip.classList.add('hidden');
      return;
    }
    const n = this.notes[i];
    const r = this.regions.get(n.folder);
    const links = (this.out.get(i)?.length || 0) + (this.inc.get(i)?.length || 0);
    tip.innerHTML =
      `<b>${esc(n.name)}</b><div class="bt-f" style="--c:${attr(r?.color || '#888')}"><i></i>${esc(n.folder)} · ${links} link${links === 1 ? '' : 's'}</div>` +
      (n.tags.length ? `<div class="brain-tags">${n.tags.slice(0, 5).map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : '');
    tip.classList.remove('hidden');
    const w = this.root.clientWidth;
    const tx = x + 280 > w ? x - 290 : x;
    tip.style.left = tx + 'px';
    tip.style.top = Math.min(y, this.root.clientHeight - 90) + 'px';
  }

  private pick(i: number): void {
    if (i >= 0 && this.hidden.has(this.notes[i]?.folder)) i = -1;
    if (i < 0) {
      if (this.selected >= 0) this.select(-1);
      return;
    }
    this.select(i, true);
  }

  private select(i: number, focus = false): void {
    this.selected = i;
    this.scene?.select(i);
    if (i < 0 || !this.notes[i]) {
      if (this.card.path && !this.card.path.endsWith('/')) this.card.close();
      return;
    }
    this.els.tip.classList.add('hidden');
    this.chrome.close();
    const n = this.notes[i];
    this.card.showNote(n.path, n.name, n.folder, this.regions.get(n.folder)?.color || '#888', n.tags);
    if (focus && this.scene) this.scene.focus(this.scene.positionOf(i), 1.15);
  }

  /** A folder (region) from Regions or the finder: fly there and show its card. */
  private openFolder(name: string): void {
    this.focusRegion(name);
    if (!this.regions.has(name)) return;
    if (this.selected >= 0) {
      this.selected = -1;
      this.scene?.select(-1);
    }
    this.chrome.close();
    this.card.showFolder(name, this.regions.get(name)!.color, this.regions.get(name)!.count);
  }

  /** The shared node and folder card (ui/node-card.ts). */
  private buildCard(): NodeCard {
    const link = (j: number): CardLink => {
      const m = this.notes[j];
      return { path: m.path, name: m.name, color: this.regions.get(m.folder)?.color || '#888', degree: m.degree };
    };
    const at = (path: string): number => this.notes.findIndex((n) => n.path === path);
    return new NodeCard({
      root: this.root,
      focusNode: (p) => {
        const i = at(p);
        if (i >= 0 && this.scene) this.scene.focus(this.scene.positionOf(i), 1.15);
      },
      focusFolder: (f) => this.focusRegion(f),
      onlyFolder: (f) => this.setHidden(Array.from(this.regions.keys()).filter((r) => r !== f)),
      pick: (p) => {
        const i = at(p);
        if (i >= 0) this.select(i, true);
      },
      links: (p) => {
        const i = at(p);
        const outs = this.out.get(i) || [];
        const ins = (this.inc.get(i) || []).filter((j) => !outs.includes(j));
        return { out: outs.map(link), in: ins.map(link) };
      },
      folderItems: (f) =>
        this.notes
          .map((n, j) => [n, j] as const)
          .filter(([n]) => n.folder === f)
          .sort((a, b) => b[0].degree - a[0].degree)
          .map(([, j]) => link(j)),
      tag: (t) => this.chrome.setQuery('#' + t + ' '),
      home: () => this.scene?.goHome(),
      closed: () => {
        if (this.selected >= 0) {
          this.selected = -1;
          this.scene?.select(-1);
        }
      },
    });
  }

  // ------------------------------------------------------------ live events

  private onActivity(a: AgentActivity): void {
    if (!this.scene) return;
    const idx: number[] = [];
    for (const p of a.paths || []) {
      const i = this.index.get(norm(p)) ?? this.index.get(norm(baseName(p)));
      if (i !== undefined && !idx.includes(i)) idx.push(i);
    }
    this.scene.activity(a.actor || 'agent', a.phase || 'start', a.ok, idx);
  }

  private onMutation(m: WsEvent): void {
    const p = [m.path, m.to, m.new_path].find((v) => typeof v === 'string') as string | undefined;
    if (p) this.pendingFlare.push(p);
    this.scheduleRefresh();
  }

  /** Coalesce bursts of mutations (and shell refreshes) into one fetch. */
  scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => void this.refresh(), 450);
  }
}
