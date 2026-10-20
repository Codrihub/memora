// The node and folder card shared by Brain, Graph and Canvas. The three maps
// are only different pictures of the same vault, so what you get when you
// click a node or a folder is the same everywhere: same place, same layout,
// same actions, same menu.
//
// Desktop: a panel on the right, above the map chrome (Regions, Activity,
// Reset/Filter). Phones: a bottom sheet with a handle, swipe down to close.

import { apiGet } from '../api';
import { on } from '../bus';
import { attr, esc, useStyles } from '../dom';
import { relTs } from '../format';
import { hooks } from '../hooks';
import type { NoteDoc, WsEvent } from '../types';
import { folderMenu, noteMenu } from '../vault/menus';
import { nav } from '../vault/nav';
import { previewSkeleton } from './skeleton';

export interface CardLink {
  path: string;
  name: string;
  color: string;
  /** Shown at the right of the row (links of that node). */
  degree?: number;
}

export interface CardExtra {
  id: string;
  label: string;
  /** Inline SVG. */
  icon: string;
  on?: boolean;
  run: () => void;
}

/** What a map tells the card; everything else the card fetches itself. */
export interface CardHost {
  root: HTMLElement;
  /** Center the map on this node. */
  focusNode(path: string): void;
  /** Show the whole folder (region, hull, frame) on the map. */
  focusFolder(folder: string): void;
  /** Hide every other folder from the map. */
  onlyFolder?(folder: string): void;
  /** Select another node of this map (from the link lists). */
  pick(path: string): void;
  /** Links as this map knows them. */
  links(path: string): { out: CardLink[]; in: CardLink[] };
  /** Nodes directly in a folder (or region), most connected first. */
  folderItems(folder: string): CardLink[];
  /** Search the map for a tag (the finder's #tag). */
  tag(tag: string): void;
  /** Map-only buttons next to the menu (Graph: Pin). */
  extras?(path: string): CardExtra[];
  /** The card closed itself (close button, Esc, swipe). */
  closed(): void;
  /** Back to the map's centre view (Close means "done here"). */
  home?(): void;
}

const ICON = {
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-8 8"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/></svg>',
  target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  only: '<svg viewBox="0 0 24 24"><path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
};

const CSS = `
.nc{position:absolute;z-index:35;right:14px;top:12px;bottom:14px;width:min(380px,calc(100% - 28px));display:flex;flex-direction:column;
  background:var(--panel,#12161f);color:var(--fg,#e6e9ef);border:1px solid var(--vc-ctl-line,var(--line,#232a38));border-radius:16px;
  box-shadow:0 24px 60px -18px rgba(0,0,0,.7),0 0 0 1px rgba(0,0,0,.25);overflow:hidden;
  transform:translateX(calc(100% + 40px));visibility:hidden;transition:transform .26s cubic-bezier(.2,.8,.2,1),visibility 0s .26s}
:root[data-theme=light] .nc{box-shadow:0 20px 50px -18px rgba(15,23,42,.30),0 1px 2px rgba(15,23,42,.08)}
.nc.open{transform:none;visibility:visible;transition:transform .26s cubic-bezier(.2,.8,.2,1)}
.nc svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;flex:none}
.nc-grab{display:none}
.nc-ib.nc-fold-b{display:none}
/* The details fold like an accordion (phones): the rows shrink to nothing. */
.nc-fold{display:grid;grid-template-rows:1fr;flex:1;min-height:0;transition:grid-template-rows .3s cubic-bezier(.2,.8,.2,1)}
.nc-fold-in{min-height:0;overflow:hidden;display:flex;flex-direction:column}
.nc-fold-in>.nc-body{flex:1;min-height:0}
.nc-more{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:36px;margin-top:12px;
  border-radius:10px;cursor:pointer;font-size:12.5px;font-weight:650;color:var(--accent,#5eead4);border:1px dashed var(--line-strong,var(--line))}
.nc-more:hover,.nc-more:focus-visible{border-style:solid;border-color:var(--accent,#5eead4)}
.nc-head{display:flex;align-items:center;gap:8px;padding:12px 12px 0 16px}
.nc-crumb{display:flex;align-items:center;gap:7px;min-width:0;flex:1;font-size:12px;color:var(--muted,#8b98ad)}
.nc-crumb i{width:9px;height:9px;border-radius:50%;background:var(--c);flex:none}
.nc-crumb i.sq{border-radius:3px}
.nc-crumb span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nc-ib{all:unset;box-sizing:border-box;display:grid;place-items:center;width:32px;height:32px;border-radius:9px;cursor:pointer;color:var(--text-2,#a3afc2);flex:none}
.nc-ib:hover,.nc-ib:focus-visible{background:var(--surface-2,#151a24);color:var(--fg,#e6e9ef)}
.nc-ib.on{color:var(--accent,#5eead4)}
.nc-title{margin:6px 16px 0;font-size:19px;line-height:1.25;font-weight:700;letter-spacing:-.01em;overflow-wrap:anywhere}
.nc-kind{display:inline-block;margin:0 16px;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#8b98ad)}
.nc-stats{display:flex;flex-wrap:wrap;gap:4px 14px;margin:8px 16px 0;font-size:12px;color:var(--muted,#8b98ad)}
.nc-stats b{color:var(--fg,#e6e9ef);font-weight:650}
.nc-tags{display:flex;flex-wrap:wrap;gap:6px;margin:10px 16px 0}
.nc-tags:empty{display:none}
.nc-tag{all:unset;cursor:pointer;height:24px;padding:0 9px;border-radius:999px;font-size:12px;font-weight:600;color:var(--accent,#5eead4);
  background:color-mix(in srgb,var(--accent,#5eead4) 12%,var(--panel,#12161f));border:1px solid color-mix(in srgb,var(--accent,#5eead4) 28%,var(--panel,#12161f))}
.nc-tag:hover,.nc-tag:focus-visible{border-color:var(--accent,#5eead4)}
.nc-acts{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:6px;margin:14px 16px 0}
.nc-act{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 8px;border-radius:10px;cursor:pointer;
  font-size:12.5px;font-weight:600;white-space:nowrap;color:var(--fg,#e6e9ef);background:var(--surface-2,#151a24);border:1px solid var(--vc-ctl-line,var(--line,#232a38))}
.nc-act:hover,.nc-act:focus-visible{border-color:var(--accent,#5eead4)}
.nc-act.pri{background:var(--primary,#08c6d4);border-color:var(--primary,#08c6d4);color:var(--on-primary,#03252a)}
.nc-act.pri:hover{background:var(--primary-hover,var(--primary,#08c6d4));border-color:var(--primary-hover,var(--primary,#08c6d4))}
.nc-tabs{display:flex;gap:4px;margin:16px 16px 0;padding:3px;border-radius:10px;background:var(--surface-2,#151a24);border:1px solid var(--line,#232a38)}
.nc-tabs button{all:unset;flex:1;text-align:center;height:28px;line-height:28px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;color:var(--muted,#8b98ad);white-space:nowrap}
.nc-tabs button[aria-selected=true]{background:var(--panel,#12161f);color:var(--fg,#e6e9ef);box-shadow:0 1px 2px rgba(0,0,0,.25)}
.nc-tabs button span{opacity:.7;margin-left:4px}
.nc-body{flex:1;min-height:0;overflow:auto;padding:12px 16px 16px;margin-top:4px;overscroll-behavior:contain;scrollbar-width:thin}
.nc-prev{font-size:13px;line-height:1.6;color:var(--text-2,#c6cfdb);overflow-wrap:anywhere}
.nc-prev h1,.nc-prev h2,.nc-prev h3{font-size:14.5px;margin:12px 0 6px}
.nc-prev p{margin:0 0 8px}
.nc-prev img{max-width:100%}
.nc-list{display:flex;flex-direction:column;gap:2px}
.nc-row{all:unset;box-sizing:border-box;display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:10px;height:36px;padding:0 10px;border-radius:9px;cursor:pointer;font-size:13px}
.nc-row:hover,.nc-row:focus-visible{background:var(--surface-2,#151a24)}
.nc-row i{width:8px;height:8px;border-radius:50%;background:var(--c)}
.nc-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nc-row em{font-style:normal;font-size:11.5px;color:var(--muted,#8b98ad)}
.nc-empty{padding:12px 2px;font-size:12.5px;color:var(--muted,#8b98ad)}
@media (max-width:760px){
  .nc{left:0;right:0;top:auto;bottom:0;width:auto;max-height:78%;height:auto;border-radius:18px 18px 0 0;border-bottom:0;
    transform:translateY(105%);padding-bottom:env(safe-area-inset-bottom)}
  .nc.open{transform:translateY(var(--nc-drag,0px))}
  .nc.dragging{transition:none}
  .nc-grab{display:block;flex:none;width:40px;height:5px;border-radius:3px;margin:8px auto 0;background:var(--line-2,var(--line,#2b3446));touch-action:none}
  .nc-head{padding-top:6px;touch-action:none}
  .nc-body{min-height:120px;max-height:calc(78vh - 260px)}
  .nc-fold{flex:none}
  /* Peek: only the name stays up, the map is free; tap or drag up to open. */
  .nc.peek .nc-fold{grid-template-rows:0fr}
  .nc.peek .nc-kind{display:none}
  .nc-ib.nc-fold-b{display:grid}
  .nc-fold-b svg{transform:rotate(180deg);transition:transform .3s cubic-bezier(.2,.8,.2,1)}
  .nc.peek .nc-fold-b svg{transform:none}
  .nc.peek .nc-title{margin-bottom:14px;font-size:16px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .nc.peek .nc-head{cursor:pointer}
}
@media (prefers-reduced-motion:reduce){.nc,.nc.open,.nc-fold,.nc-fold-b svg{transition:none}}
`;

type Tab = 'preview' | 'out' | 'in' | 'items';

export class NodeCard {
  readonly el: HTMLElement;
  /** The open note's path, or the open folder's name with a trailing slash. */
  path: string | null = null;
  private seq = 0;
  private tab: Tab = 'preview';
  private mapTap = -1e9;
  /** Listeners on the map root, removed on destroy. */
  private off = new AbortController();
  /** What the server last said about a note (preview, size and date, tags). */
  private doc: { path: string; preview: string; meta: string; tags: string[] } | null = null;
  /** `doc`'s note changed on the server after it was fetched. */
  private stale = false;
  /** Everything the last `showNote` drew from, to skip redrawing the same card. */
  private drawn = '';
  /** The note whose preview is being fetched. */
  private loading: string | null = null;

  constructor(private host: CardHost) {
    useStyles('node-card-css', CSS);
    this.el = document.createElement('section');
    this.el.className = 'nc';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Node details');
    host.root.appendChild(this.el);
    // Clicks and drags on the card never reach the map underneath.
    for (const ev of ['pointerdown', 'wheel', 'dblclick', 'contextmenu'] as const)
      this.el.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev === 'wheel' });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close(true);
      }
    });
    this.wireSwipe();
    // Maps redraw the open card after every realtime update; only a change to
    // this note itself needs a new preview from the server.
    const unsub = on('mutation', (m) => this.mutated(m));
    this.off.signal.addEventListener('abort', unsub);
    // A tap on the map itself (not its controls) while the card is up.
    host.root.addEventListener(
      'pointerdown',
      (e) => {
        const t = e.target as HTMLElement;
        if (this.isOpen && !t.closest('.nc,.vc,.mf,.cv-ui')) {
          this.mapTap = performance.now();
          if (phone()) this.collapse();
        }
      },
      { capture: true, signal: this.off.signal },
    );
    this.el.addEventListener('click', (e) => {
      if (!this.el.classList.contains('peek')) return;
      const t = e.target as HTMLElement;
      // Only the folded bar itself opens it (the Focus click that folded it
      // bubbles here too).
      if (!t.closest('.nc-grab,.nc-head,.nc-title') || t.closest('[data-a=close],[data-a=menu],[data-a=fold],[data-x]')) return;
      this.expand();
    });
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  /**
   * Close. By the user (×, Esc, swiping a peeking card away) it also takes the
   * map back to its centre. On phones a tap on the map only folds the card
   * down to its name, like an accordion, instead of closing it.
   */
  close(byUser = false): void {
    if (!this.isOpen) return;
    if (!byUser && phone() && performance.now() - this.mapTap < 600) {
      this.collapse();
      return;
    }
    this.seq++;
    this.path = null;
    this.el.classList.remove('open', 'peek');
    this.el.style.removeProperty('--nc-drag');
    if (byUser) {
      this.host.closed();
      this.host.home?.();
    }
  }

  /** Phones: fold down to the name (after Focus, a map tap, a swipe down). */
  collapse(): void {
    if (this.isOpen && phone()) this.el.classList.add('peek');
  }

  expand(): void {
    this.el.classList.remove('peek');
  }

  destroy(): void {
    this.seq++;
    this.off.abort();
    this.el.remove();
  }

  /** A note: its links from the map, the rest from the server. */
  showNote(path: string, name: string, folder: string, color: string, tags: string[] = []): void {
    const reopen = this.path === path && this.isOpen;
    const { out, in: inc } = this.host.links(path);
    const extras = this.host.extras?.(path) || [];
    const row = (l: CardLink): unknown[] => [l.path, l.name, l.color, l.degree];
    const drawn = JSON.stringify([path, name, folder, color, tags, out.map(row), inc.map(row), extras.map((x) => [x.id, x.label, !!x.on])]);
    // The same node redrawn (a map refresh): reuse the preview already loaded
    // unless this note changed; with nothing new at all, leave the card alone.
    const cached = reopen && this.doc?.path === path ? this.doc : null;
    if (reopen && !this.stale && drawn === this.drawn && (cached || this.loading === path)) return;
    this.drawn = drawn;
    const seq = ++this.seq;
    this.path = path;
    if (!reopen) this.tab = 'preview';
    // Another node opens unfolded; the same one redrawn keeps its state.
    if (!reopen) this.expand();
    this.el.setAttribute('aria-label', `Node ${name}`);
    this.el.innerHTML = `<div class="nc-grab" aria-hidden="true"></div>
      <div class="nc-head"><div class="nc-crumb"><i style="--c:${attr(color)}"></i><span title="${attr(path)}">${esc(this.crumb(folder))}</span></div>
        ${extras.map((x) => `<button type="button" class="nc-ib${x.on ? ' on' : ''}" data-x="${attr(x.id)}" title="${attr(x.label)}" aria-label="${attr(x.label)}">${x.icon}</button>`).join('')}
        <button type="button" class="nc-ib" data-a="menu" title="More: rename, move, pin, delete" aria-label="More actions">${ICON.more}</button>
        <button type="button" class="nc-ib nc-fold-b" data-a="fold" title="Fold or open the details" aria-label="Fold or open the details">${ICON.up}</button>
        <button type="button" class="nc-ib" data-a="close" title="Close (Esc)" aria-label="Close">${ICON.close}</button></div>
      <h2 class="nc-title">${esc(name)}</h2>
      <div class="nc-fold"><div class="nc-fold-in">
      <div class="nc-stats"><span><b>${out.length}</b> link${out.length === 1 ? '' : 's'} out</span><span><b>${inc.length}</b> backlink${inc.length === 1 ? '' : 's'}</span><span data-meta></span></div>
      <div class="nc-tags">${this.tagChips(cached?.tags.length ? cached.tags : tags)}</div>
      <div class="nc-acts">
        <button type="button" class="nc-act pri" data-a="open">${ICON.open}Open node</button>
        <button type="button" class="nc-act" data-a="node" title="Center the map on this node">${ICON.target}Focus</button>
        <button type="button" class="nc-act" data-a="folder" title="Show its whole folder">${ICON.folder}Folder</button>
      </div>
      <div class="nc-tabs" role="tablist">
        <button type="button" role="tab" data-tab="preview">Preview</button>
        <button type="button" role="tab" data-tab="out">Links out<span>${out.length}</span></button>
        <button type="button" role="tab" data-tab="in">Backlinks<span>${inc.length}</span></button>
      </div>
      <div class="nc-body" role="tabpanel"></div>
      </div></div>`;
    const body = this.el.querySelector<HTMLElement>('.nc-body')!;
    let preview = cached ? cached.preview : previewSkeleton();
    if (cached) {
      const meta = this.el.querySelector<HTMLElement>('[data-meta]');
      if (meta) meta.textContent = cached.meta;
    }
    const paint = (): void => {
      this.el.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === this.tab)));
      body.innerHTML =
        this.tab === 'preview'
          ? `<div class="nc-prev note-body">${preview}</div>`
          : this.rows(this.tab === 'out' ? out : inc, this.tab === 'out' ? 'This node links to nothing yet.' : 'Nothing links here yet.');
      this.wireRows(body);
      body.querySelector<HTMLElement>('[data-a=more]')?.addEventListener('click', () => hooks.openNote(path));
    };
    this.el.querySelectorAll<HTMLElement>('[data-tab]').forEach(
      (b) =>
        (b.onclick = () => {
          this.tab = b.dataset.tab as Tab;
          paint();
        }),
    );
    paint();
    this.wireCommon(extras);
    this.on('open', () => hooks.openNote(path));
    this.on('node', () => {
      this.host.focusNode(path);
      this.collapse();
    });
    this.on('folder', () => {
      this.host.focusFolder(folder);
      this.collapse();
    });
    this.on('menu', (b) => noteMenu([path], b));
    this.el.classList.add('open');

    if (cached && !this.stale) return;
    this.stale = false;
    if (!cached) this.doc = null;
    this.loading = path;
    void apiGet<NoteDoc>('/api/note?path=' + encodeURIComponent(path))
      .then((d) => {
        if (seq !== this.seq) return;
        this.loading = null;
        const metaText = [d.mtime ? 'edited ' + relTs(d.mtime) : '', d.size ? `${Math.max(1, Math.round(d.size / 1024))} KB` : ''].filter(Boolean).join(' · ');
        const meta = this.el.querySelector<HTMLElement>('[data-meta]');
        if (meta) meta.textContent = metaText;
        if (d.tags && d.tags.length) {
          const host = this.el.querySelector<HTMLElement>('.nc-tags')!;
          host.innerHTML = this.tagChips(d.tags);
          this.wireTags(host);
        }
        const text = d.html || (d.content ? `<pre>${esc(d.content)}</pre>` : '');
        const fresh = text ? clipPreview(text) : '<div class="nc-empty">This node is empty.</div>';
        this.doc = { path, preview: fresh, meta: metaText, tags: d.tags || [] };
        if (fresh === preview) return;
        preview = fresh;
        if (this.tab === 'preview') paint();
      })
      .catch((e: Error) => {
        if (seq !== this.seq) return;
        this.loading = null;
        // Keep showing a preview that was already there; only a first load fails visibly.
        if (cached) return;
        preview = `<div class="nc-empty">Could not load the preview: ${esc(e.message)}</div>`;
        if (this.tab === 'preview') paint();
      });
  }

  /** A realtime vault change: the loaded (or loading) preview is out of date when it names that note. */
  private mutated(m: WsEvent): void {
    const mine = this.doc?.path ?? this.loading;
    if (!mine) return;
    // node_created / node_updated / node_renamed carry the note in `node`; deletes and
    // renames name paths at the top level.
    const node = m.node as { path?: unknown } | undefined;
    const paths = [m.path, m.to, m.new_path, m.old_path, m.from, node?.path].filter((v): v is string => typeof v === 'string');
    if (!paths.length || paths.includes(mine)) this.stale = true;
  }

  /** A folder (region, hull, frame): what is in it and what you can do. */
  showFolder(folder: string, color: string, count?: number): void {
    ++this.seq;
    const again = this.path === folder + '/';
    this.path = folder + '/';
    this.tab = 'items';
    const items = this.host.folderItems(folder);
    const n = count ?? items.length;
    const root = !folder || folder === 'Root';
    const name = root ? 'Vault root' : folder.split('/').pop() || folder;
    const parent = root ? '' : folder.split('/').slice(0, -1).join('/');
    if (!again) this.expand();
    this.el.setAttribute('aria-label', `Folder ${name}`);
    this.el.innerHTML = `<div class="nc-grab" aria-hidden="true"></div>
      <div class="nc-head"><div class="nc-crumb"><i class="sq" style="--c:${attr(color)}"></i><span>${esc(parent ? this.crumb(parent) : 'Vault')}</span></div>
        ${root ? '' : `<button type="button" class="nc-ib" data-a="menu" title="More: rename, move, colour, delete" aria-label="More actions">${ICON.more}</button>`}
        <button type="button" class="nc-ib nc-fold-b" data-a="fold" title="Fold or open the details" aria-label="Fold or open the details">${ICON.up}</button>
        <button type="button" class="nc-ib" data-a="close" title="Close (Esc)" aria-label="Close">${ICON.close}</button></div>
      <h2 class="nc-title">${esc(name)}</h2>
      <span class="nc-kind">Folder</span>
      <div class="nc-fold"><div class="nc-fold-in">
      <div class="nc-stats"><span><b>${n}</b> node${n === 1 ? '' : 's'}</span></div>
      <div class="nc-acts">
        <button type="button" class="nc-act pri" data-a="open">${ICON.open}Open folder</button>
        <button type="button" class="nc-act" data-a="folder" title="Show the whole folder">${ICON.target}Focus</button>
        ${
          this.host.onlyFolder
            ? `<button type="button" class="nc-act" data-a="only" title="Hide every other folder">${ICON.only}Only this</button>`
            : `<button type="button" class="nc-act" data-a="new" title="New node in this folder">${ICON.plus}New node</button>`
        }
      </div>
      <div class="nc-tabs" role="tablist"><button type="button" role="tab" aria-selected="true">Nodes<span>${n}</span></button></div>
      <div class="nc-body" role="tabpanel">${this.rows(items, 'No nodes directly in this folder.')}</div>
      </div></div>`;
    this.wireRows(this.el.querySelector('.nc-body')!);
    this.wireCommon([]);
    this.on('open', () => {
      hooks.go('vault');
      nav.selectFolder(root ? '' : folder);
    });
    this.on('folder', () => {
      this.host.focusFolder(folder);
      this.collapse();
    });
    this.on('only', () => {
      this.host.onlyFolder?.(folder);
      this.collapse();
    });
    this.on('new', () => nav.newNote(root ? '' : folder));
    this.on('menu', (b) => folderMenu(folder, b));
    this.el.classList.add('open');
  }

  // ─────────── internals ───────────

  private crumb(folder: string): string {
    return !folder || folder === 'Root' ? 'Vault root' : folder.split('/').join(' / ');
  }

  private tagChips(tags: string[]): string {
    return tags.map((t) => `<button type="button" class="nc-tag" data-tag="${attr(t)}" title="Find #${attr(t)} on the map">#${esc(t)}</button>`).join('');
  }

  private rows(list: CardLink[], empty: string): string {
    if (!list.length) return `<div class="nc-empty">${esc(empty)}</div>`;
    return `<div class="nc-list">${list
      .slice(0, 80)
      .map(
        (l) =>
          `<button type="button" class="nc-row" data-path="${attr(l.path)}" title="${attr(l.path)}" style="--c:${attr(l.color)}"><i></i><span>${esc(l.name)}</span>${
            l.degree !== undefined ? `<em>${l.degree}</em>` : ''
          }</button>`,
      )
      .join('')}</div>${list.length > 80 ? `<div class="nc-empty">and ${list.length - 80} more</div>` : ''}`;
  }

  private wireRows(host: HTMLElement): void {
    host.querySelectorAll<HTMLElement>('[data-path]').forEach((b) => (b.onclick = () => this.host.pick(b.dataset.path || '')));
  }

  private wireTags(host: ParentNode): void {
    host.querySelectorAll<HTMLElement>('[data-tag]').forEach((b) => (b.onclick = () => this.host.tag(b.dataset.tag || '')));
  }

  private wireCommon(extras: CardExtra[]): void {
    this.on('close', () => this.close(true));
    this.on('fold', () => (this.el.classList.contains('peek') ? this.expand() : this.collapse()));
    this.wireTags(this.el);
    for (const x of extras) {
      const b = Array.from(this.el.querySelectorAll<HTMLElement>('[data-x]')).find((e) => e.dataset.x === x.id);
      if (b) b.onclick = () => x.run();
    }
  }

  private on(act: string, run: (b: HTMLElement) => void): void {
    const b = this.el.querySelector<HTMLElement>(`[data-a="${act}"]`);
    if (b) b.onclick = () => run(b);
  }

  /** Phones: drag the handle or header down to fold, again to close; up to open. */
  private wireSwipe(): void {
    let y0 = -1;
    let dy = 0;
    this.el.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (!window.matchMedia('(max-width:760px)').matches) return;
      if (!t.closest('.nc-grab,.nc-head') || t.closest('button')) return;
      y0 = e.clientY;
      dy = 0;
      this.el.classList.add('dragging');
      this.el.setPointerCapture(e.pointerId);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (y0 < 0) return;
      dy = e.clientY - y0;
      this.el.style.setProperty('--nc-drag', Math.max(0, dy) + 'px');
    });
    const end = (): void => {
      if (y0 < 0) return;
      y0 = -1;
      this.el.classList.remove('dragging');
      this.el.style.removeProperty('--nc-drag');
      const peek = this.el.classList.contains('peek');
      // Down: open card folds to its name, a folded card goes away. Up: open.
      if (dy > 60) {
        if (peek) this.close(true);
        else this.collapse();
      } else if (dy < -30 && peek) this.expand();
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }
}

function phone(): boolean {
  return window.matchMedia('(max-width:760px)').matches;
}

/** Characters of text a preview shows before "Read more". */
const PREVIEW_CHARS = 700;

/**
 * The start of a rendered note for the card: whole blocks up to about
 * PREVIEW_CHARS of text (or 6 blocks), then a Read more button that opens
 * the node. Short notes stay whole.
 */
function clipPreview(html: string): string {
  const box = document.createElement('div');
  box.innerHTML = html;
  const blocks = Array.from(box.children);
  let chars = 0;
  let keep = 0;
  for (const b of blocks) {
    chars += (b.textContent || '').length;
    keep++;
    if (chars >= PREVIEW_CHARS || keep >= 6) break;
  }
  if (keep >= blocks.length) return html;
  blocks.slice(keep).forEach((b) => b.remove());
  return box.innerHTML + '<button type="button" class="nc-more" data-a="more">Read more</button>';
}
