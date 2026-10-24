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
  degree?: number;
}

interface CardExtra {
  id: string;
  label: string;
  icon: string;
  on?: boolean;
  run: () => void;
}

interface CardHost {
  root: HTMLElement;
  /** Without it the card has no Focus button. */
  focusNode?(path: string): void;
  focusFolder(folder: string): void;
  onlyFolder?(folder: string): void;
  pick(path: string): void;
  links(path: string): { out: CardLink[]; in: CardLink[] };
  /** Most connected first. */
  folderItems(folder: string): CardLink[];
  tag(tag: string): void;
  extras?(path: string): CardExtra[];
  closed(): void;
  home?(): void;
  /** Media query for the bottom-sheet layout (default: phones). */
  sheetQuery?: string;
  tagLabel?(tag: string): string;
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
/* Brings the map chrome tokens itself, for pages without a map. */
.nc{--vc-ctl-line:var(--line-strong);--vc-tint:var(--hover);--vc-track:var(--seg-track);--vc-thumb:var(--seg-thumb);--vc-line:var(--line)}
.nc{position:absolute;z-index:35;right:12px;top:12px;bottom:12px;width:min(380px,calc(100% - 24px));display:flex;flex-direction:column;
  background:var(--ovl-bg);-webkit-backdrop-filter:var(--ovl-filter);backdrop-filter:var(--ovl-filter);
  color:var(--fg,#e6e9ef);border:1px solid var(--vc-ctl-line,var(--line-strong,#232a38));border-radius:12px;box-shadow:none;overflow:hidden;
  transform:translateX(calc(100% + 40px));visibility:hidden;transition:transform .26s cubic-bezier(.2,.8,.2,1),visibility 0s .26s}
.nc.open{transform:none;visibility:visible;transition:transform .26s cubic-bezier(.2,.8,.2,1)}
.nc svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
.nc-grab{display:none}
.nc-ib.nc-fold-b{display:none}
.nc-fold{display:grid;grid-template-rows:1fr;flex:1;min-height:0;transition:grid-template-rows .3s cubic-bezier(.2,.8,.2,1)}
.nc-fold-in{min-height:0;overflow:hidden;display:flex;flex-direction:column}
.nc-fold-in>.nc-body{flex:1;min-height:0}
.nc-more{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:36px;margin-top:12px;
  border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;color:var(--accent,#5eead4);background:var(--vc-tint,rgba(148,163,184,.08))}
.nc-more:hover,.nc-more:focus-visible{background:var(--accent-soft,rgba(94,234,212,.11))}
.nc-head{display:flex;align-items:center;gap:2px;padding:10px 8px 0 16px}
.nc-crumb{display:flex;align-items:center;gap:8px;min-width:0;flex:1;font-size:12.5px;color:var(--muted,#8b98ad);margin-right:6px}
.nc-crumb i{width:8px;height:8px;border-radius:50%;background:var(--c);flex:none}
.nc-crumb i.sq{border-radius:2px}
.nc-crumb span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nc-ib{all:unset;box-sizing:border-box;display:grid;place-items:center;width:32px;height:32px;border-radius:8px;cursor:pointer;color:var(--text-2,#a3afc2);flex:none}
.nc-ib:hover,.nc-ib:focus-visible{background:var(--vc-tint,rgba(148,163,184,.08));color:var(--fg,#e6e9ef)}
.nc-ib:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:-2px}
.nc-ib.on{color:var(--accent,#5eead4)}
.nc-title{margin:4px 16px 0;font-size:18px;line-height:1.3;font-weight:650;letter-spacing:-.01em;overflow-wrap:anywhere}
.nc-props{display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 16px;margin:10px 16px 0;padding-bottom:12px;border-bottom:1px solid var(--vc-line,var(--line,#232a38));font-size:13px}
.nc-props dt{color:var(--muted,#8b98ad);min-height:28px;display:flex;align-items:center}
.nc-props dd{margin:0;min-width:0;min-height:28px;display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:4px;text-align:right;color:var(--fg,#e6e9ef)}
.nc-props dd:empty::before{content:"–";color:var(--muted,#8b98ad)}
.nc-props .nc-tagrow{padding:4px 0}
.nc-tag{all:unset;cursor:pointer;height:24px;padding:0 8px;border-radius:6px;font-size:12px;font-weight:600;color:var(--accent,#5eead4);background:var(--accent-soft,rgba(94,234,212,.11))}
.nc-tag:hover{text-decoration:underline}
.nc-tag:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:1px}
.nc-acts{display:flex;align-items:center;gap:4px;margin:12px 16px 0}
.nc-act{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 10px;border-radius:8px;cursor:pointer;
  font-size:13px;font-weight:600;white-space:nowrap;color:var(--text-2,#a3afc2);transition:background .15s,color .15s}
.nc-act:hover,.nc-act:focus-visible{background:var(--vc-tint,rgba(148,163,184,.08));color:var(--fg,#e6e9ef)}
.nc-act:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:1px}
.nc-act.pri{flex:1;padding:0 14px;background:var(--primary,#08c6d4);color:var(--on-primary,#03252a);margin-right:4px}
.nc-act.pri:hover{background:var(--primary-hover,var(--primary,#08c6d4));color:var(--on-primary,#03252a)}
.nc-tabs{display:flex;gap:2px;margin:14px 16px 0;padding:3px;border-radius:10px;background:var(--vc-track,var(--surface-2,#151a24))}
.nc-tabs button{all:unset;box-sizing:border-box;flex:1;text-align:center;height:30px;line-height:28px;border-radius:7px;cursor:pointer;font-size:12.5px;font-weight:550;
  color:var(--muted,#8b98ad);white-space:nowrap;border:1px solid transparent}
.nc-tabs button:hover{color:var(--fg,#e6e9ef)}
.nc-tabs button[aria-selected=true]{background:var(--vc-thumb,var(--panel,#12161f));color:var(--fg,#e6e9ef);border-color:var(--vc-ctl-line,var(--line,#232a38))}
.nc-tabs button:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:1px}
.nc-tabs button span{color:var(--muted,#8b98ad);margin-left:5px;font-variant-numeric:tabular-nums}
.nc-body{flex:1;min-height:0;overflow:auto;padding:12px 16px 16px;margin-top:2px;overscroll-behavior:contain;scrollbar-width:thin}
.nc-prev{font-size:13.5px;line-height:1.6;color:var(--text-2,#c6cfdb);overflow-wrap:anywhere}
.nc-prev h1,.nc-prev h2,.nc-prev h3{font-size:14.5px;margin:12px 0 6px;color:var(--fg,#e6e9ef)}
.nc-prev p{margin:0 0 8px}
.nc-prev img{max-width:100%}
.nc-list{display:flex;flex-direction:column;gap:2px}
.nc-row{all:unset;box-sizing:border-box;display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:36px;padding:0 10px;border-radius:8px;cursor:pointer;font-size:13px}
.nc-row:hover,.nc-row:focus-visible{background:var(--vc-tint,rgba(148,163,184,.08))}
.nc-row:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:-2px}
.nc-row i{width:8px;height:8px;border-radius:50%;background:var(--c)}
.nc-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nc-row em{font-style:normal;font-size:12px;color:var(--muted,#8b98ad);font-variant-numeric:tabular-nums}
.nc-empty{padding:12px 2px;font-size:13px;color:var(--muted,#8b98ad)}
@media (pointer:coarse){.nc-ib{width:40px;height:40px}.nc-act{height:40px}.nc-row{min-height:44px}.nc-tabs button{height:36px;line-height:34px}}
.nc.sheet{left:0;right:0;top:auto;bottom:0;width:auto;max-height:88%;height:auto;border-radius:12px 12px 0 0;border-bottom:0;
  transform:translateY(105%);padding-bottom:env(safe-area-inset-bottom)}
.nc.sheet.open{transform:translateY(var(--nc-drag,0px))}
.nc.sheet.dragging{transition:none}
.nc.sheet .nc-grab{display:block;flex:none;width:36px;height:4px;border-radius:99px;margin:8px auto 0;background:var(--line-strong,#2b3446);touch-action:none}
.nc.sheet .nc-head{padding-top:6px;touch-action:none}
.nc.sheet .nc-body{min-height:120px;max-height:calc(88vh - 340px)}
.nc.sheet .nc-fold{flex:none}
.nc.sheet.peek .nc-fold{grid-template-rows:0fr}
.nc.sheet .nc-ib.nc-fold-b{display:grid}
.nc.sheet .nc-fold-b svg{transform:rotate(180deg);transition:transform .3s cubic-bezier(.2,.8,.2,1)}
.nc.sheet.peek .nc-fold-b svg{transform:none}
.nc.sheet.peek .nc-title{margin-bottom:14px;font-size:16px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nc.sheet.peek .nc-head{cursor:pointer}
@media (prefers-reduced-motion:reduce){.nc,.nc.open,.nc-fold,.nc.sheet .nc-fold-b svg{transition:none}}
`;

type Tab = 'preview' | 'out' | 'in' | 'items';

export class NodeCard {
  readonly el: HTMLElement;
  /** Note path, or folder name with a trailing slash. */
  path: string | null = null;
  private seq = 0;
  private tab: Tab = 'preview';
  private mapTap = -1e9;
  private off = new AbortController();
  private doc: { path: string; preview: string; meta: string; tags: string[] } | null = null;
  private stale = false;
  private drawn = '';
  private loading: string | null = null;
  private sheetMq: MediaQueryList;

  constructor(private host: CardHost) {
    useStyles('node-card-css', CSS);
    this.el = document.createElement('section');
    this.el.className = 'nc';
    this.sheetMq = window.matchMedia(host.sheetQuery || PHONE);
    const sheet = (): void => {
      this.el.classList.toggle('sheet', this.sheetMq.matches);
    };
    sheet();
    this.sheetMq.addEventListener('change', sheet, { signal: this.off.signal });
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Note details');
    host.root.appendChild(this.el);
    for (const ev of ['pointerdown', 'wheel', 'dblclick', 'contextmenu'] as const)
      this.el.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev === 'wheel' });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close(true);
      }
    });
    this.wireSwipe();
    const unsub = on('mutation', (m) => this.mutated(m));
    this.off.signal.addEventListener('abort', unsub);
    host.root.addEventListener(
      'pointerdown',
      (e) => {
        const t = e.target as HTMLElement;
        if (this.isOpen && !t.closest('.nc,.vc,.mf,.cv-ui')) {
          this.mapTap = performance.now();
          if (this.sheet) this.collapse();
        }
      },
      { capture: true, signal: this.off.signal },
    );
    this.el.addEventListener('click', (e) => {
      if (!this.el.classList.contains('peek')) return;
      const t = e.target as HTMLElement;
      // The Focus click that folded it bubbles here too.
      if (!t.closest('.nc-grab,.nc-head,.nc-title') || t.closest('[data-a=close],[data-a=menu],[data-a=fold],[data-x]')) return;
      this.expand();
    });
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  get sheet(): boolean {
    return this.sheetMq.matches;
  }

  /** On phones a map tap only folds the card to its name. */
  close(byUser = false): void {
    if (!this.isOpen) return;
    if (!byUser && this.sheet && performance.now() - this.mapTap < 600) {
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

  collapse(): void {
    if (this.isOpen && this.sheet) this.el.classList.add('peek');
  }

  expand(): void {
    this.el.classList.remove('peek');
  }

  destroy(): void {
    this.seq++;
    this.off.abort();
    this.el.remove();
  }

  showNote(path: string, name: string, folder: string, color: string, tags: string[] = []): void {
    const reopen = this.path === path && this.isOpen;
    const { out, in: inc } = this.host.links(path);
    const extras = this.host.extras?.(path) || [];
    const row = (l: CardLink): unknown[] => [l.path, l.name, l.color, l.degree];
    const drawn = JSON.stringify([path, name, folder, color, tags, out.map(row), inc.map(row), extras.map((x) => [x.id, x.label, !!x.on])]);
    // A map refresh redraws the same node: reuse the loaded preview unless the note changed.
    const cached = reopen && this.doc?.path === path ? this.doc : null;
    if (reopen && !this.stale && drawn === this.drawn && (cached || this.loading === path)) return;
    this.drawn = drawn;
    const seq = ++this.seq;
    this.path = path;
    if (!reopen) this.tab = 'preview';
    if (!reopen) this.expand();
    this.el.setAttribute('aria-label', `Note ${name}`);
    this.el.innerHTML = `<div class="nc-grab" aria-hidden="true"></div>
      <div class="nc-head"><div class="nc-crumb"><i style="--c:${attr(color)}"></i><span title="${attr(path)}">${esc(this.crumb(folder))}</span></div>
        ${extras.map((x) => `<button type="button" class="nc-ib${x.on ? ' on' : ''}" data-x="${attr(x.id)}" title="${attr(x.label)}" aria-label="${attr(x.label)}">${x.icon}</button>`).join('')}
        <button type="button" class="nc-ib" data-a="menu" title="More: rename, move, pin, delete" aria-label="More actions">${ICON.more}</button>
        <button type="button" class="nc-ib nc-fold-b" data-a="fold" title="Fold or open the details" aria-label="Fold or open the details">${ICON.up}</button>
        <button type="button" class="nc-ib" data-a="close" title="Close (Esc)" aria-label="Close">${ICON.close}</button></div>
      <h2 class="nc-title">${esc(name)}</h2>
      <div class="nc-fold"><div class="nc-fold-in">
      <dl class="nc-props">
        <dt>Links</dt><dd>${out.length} out · ${inc.length} in</dd>
        <dt>Edited</dt><dd data-meta></dd>
        <dt>Tags</dt><dd class="nc-tags nc-tagrow">${this.tagChips(cached?.tags.length ? cached.tags : tags)}</dd>
      </dl>
      <div class="nc-acts">
        <button type="button" class="nc-act pri" data-a="open">${ICON.open}Open note</button>
        ${this.host.focusNode ? `<button type="button" class="nc-act" data-a="node" title="Center the map on this note">${ICON.target}Focus</button>` : ''}
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
          : this.rows(this.tab === 'out' ? out : inc, this.tab === 'out' ? 'This note links to nothing yet.' : 'Nothing links here yet.');
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
      this.host.focusNode?.(path);
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
        const metaText = [d.mtime ? relTs(d.mtime) : '', d.size ? `${Math.max(1, Math.round(d.size / 1024))} KB` : ''].filter(Boolean).join(' · ');
        const meta = this.el.querySelector<HTMLElement>('[data-meta]');
        if (meta) meta.textContent = metaText;
        if (d.tags && d.tags.length) {
          const host = this.el.querySelector<HTMLElement>('.nc-tags')!;
          host.innerHTML = this.tagChips(d.tags);
          this.wireTags(host);
        }
        const text = d.html || (d.content ? `<pre>${esc(d.content)}</pre>` : '');
        const fresh = text ? clipPreview(text) : '<div class="nc-empty">This note is empty.</div>';
        this.doc = { path, preview: fresh, meta: metaText, tags: d.tags || [] };
        if (fresh === preview) return;
        preview = fresh;
        if (this.tab === 'preview') paint();
      })
      .catch((e: Error) => {
        if (seq !== this.seq) return;
        this.loading = null;
        if (cached) return;
        preview = `<div class="nc-empty">Could not load the preview: ${esc(e.message)}</div>`;
        if (this.tab === 'preview') paint();
      });
  }

  private mutated(m: WsEvent): void {
    const mine = this.doc?.path ?? this.loading;
    if (!mine) return;
    const node = m.node as { path?: unknown } | undefined;
    const paths = [m.path, m.to, m.new_path, m.old_path, m.from, node?.path].filter((v): v is string => typeof v === 'string');
    if (!paths.length || paths.includes(mine)) this.stale = true;
  }

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
      <div class="nc-fold"><div class="nc-fold-in">
      <dl class="nc-props"><dt>Kind</dt><dd>Folder</dd><dt>Notes</dt><dd>${n}</dd></dl>
      <div class="nc-acts">
        <button type="button" class="nc-act pri" data-a="open">${ICON.open}Open folder</button>
        <button type="button" class="nc-act" data-a="folder" title="Show the whole folder">${ICON.target}Focus</button>
        ${
          this.host.onlyFolder
            ? `<button type="button" class="nc-act" data-a="only" title="Hide every other folder">${ICON.only}Only this</button>`
            : `<button type="button" class="nc-act" data-a="new" title="New note in this folder">${ICON.plus}New note</button>`
        }
      </div>
      <div class="nc-tabs" role="tablist"><button type="button" role="tab" aria-selected="true">Notes<span>${n}</span></button></div>
      <div class="nc-body" role="tabpanel">${this.rows(items, 'No notes directly in this folder.')}</div>
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

  private crumb(folder: string): string {
    return !folder || folder === 'Root' ? 'Vault root' : folder.split('/').join(' / ');
  }

  private tagChips(tags: string[]): string {
    return tags.map((t) => `<button type="button" class="nc-tag" data-tag="${attr(t)}" title="${attr(this.host.tagLabel ? this.host.tagLabel(t) : `Find #${t} on the map`)}">#${esc(t)}</button>`).join('');
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

  private wireSwipe(): void {
    let y0 = -1;
    let dy = 0;
    this.el.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (!this.sheet) return;
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
      if (dy > 60) {
        if (peek) this.close(true);
        else this.collapse();
      } else if (dy < -30 && peek) this.expand();
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }
}

const PHONE = '(max-width:760px)';

const PREVIEW_CHARS = 700;

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
