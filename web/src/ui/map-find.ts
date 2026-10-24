// Query syntax: plain text, `#tag` (tag prefix) and `in:folder` (path substring); tokens combine.

import { attr, esc, useStyles } from '../dom';
import { matchAt, score, similar } from './match';
import { noteTitle } from '../state';

interface FindItem {
  /** The vault path. */
  id: string;
  name: string;
  /** '' or 'Root' for the vault root. */
  folder: string;
  /** The map's own grouping (region, hull, frame). */
  region: string;
  color: string;
  tags: string[];
  degree: number;
}

export interface FindSource {
  noun?: string;
  items(): FindItem[];
  hidden?(region: string): boolean;
  /** null clears. */
  highlight(ids: Set<string> | null): void;
  pick(item: FindItem): void;
  folder?(region: string): void;
}

interface FindHost {
  input: HTMLInputElement;
  setCount(text: string): void;
  root: HTMLElement;
  anchor(): HTMLElement | null;
  compact(): boolean;
}

type Range = [number, number];

interface Why {
  score: number;
  badge: string;
  text: string;
  field: 'name' | 'tag' | 'folder' | 'none';
  ranges: Range[];
  tag?: string;
}

interface Query {
  raw: string;
  text: string;
  words: string[];
  tags: string[];
  folders: string[];
  partial: { kind: 'tag' | 'folder'; value: string } | null;
}

function parseQuery(raw: string): Query {
  const q: Query = { raw, text: '', words: [], tags: [], folders: [], partial: null };
  const toks = raw.trim().split(/\s+/).filter(Boolean);
  const words: string[] = [];
  const trailing = !/\s$/.test(raw);
  toks.forEach((t, i) => {
    const low = t.toLowerCase();
    const last = i === toks.length - 1 && trailing;
    if (low.startsWith('#')) {
      const v = low.slice(1);
      if (v) q.tags.push(v);
      if (last) q.partial = { kind: 'tag', value: v };
    } else if (/^(in|folder):/.test(low)) {
      const v = low.replace(/^(in|folder):/, '');
      if (v) q.folders.push(v);
      if (last) q.partial = { kind: 'folder', value: v };
    } else words.push(low);
  });
  q.words = words;
  q.text = words.join(' ');
  return q;
}

const WORD_START = /[\s\-_./()[\]]/;

const folderLabel = (f: string): string => (!f || f === 'Root' ? 'the vault root' : f);

function matchText(it: FindItem, q: Query): Why | null {
  const t = q.text;
  if (!t) return { score: 1, badge: '', text: '', field: 'none', ranges: [] };
  // The file name counts too when the title differs (Index.md titled Root Brain).
  const file = (it.id.split('/').pop() || '').replace(/\.md$/i, '');
  if (file && file.toLowerCase() !== it.name.toLowerCase() && !matchAt(it.name, t) && matchAt(file, t)) {
    const exact = file.toLowerCase() === t || file.toLowerCase().replace(/[_-]+/g, ' ') === t;
    return { score: exact ? 95 : 72 + score(file, t) / 100, badge: 'File name', text: `The file is named “${file}.md”`, field: 'none', ranges: [] };
  }
  const n = it.name.toLowerCase();
  const at = matchAt(it.name, t);
  if (at) {
    const sc = score(it.name, t);
    if (n === t) return { score: 100, badge: 'Exact', text: `The name is exactly “${q.text}”`, field: 'name', ranges: [at] };
    if (at[0] === 0) return { score: 90 + sc / 100, badge: 'Starts with', text: `The name starts with “${q.text}”`, field: 'name', ranges: [at] };
    if (WORD_START.test(n[at[0] - 1])) return { score: 80 + sc / 100, badge: 'Word', text: `A word in the name starts with “${q.text}”`, field: 'name', ranges: [at] };
    return { score: 70 + sc / 100, badge: 'Contains', text: `The name contains “${q.text}”`, field: 'name', ranges: [at] };
  }
  let best: Why | null = null;
  for (const tag of it.tags) {
    const r = matchAt(tag, t);
    if (!r) continue;
    const exact = tag.toLowerCase() === t;
    const w: Why = {
      score: exact ? 66 : r[0] === 0 ? 62 : 56,
      badge: 'Tag',
      text: exact ? `Tagged #${tag}` : `Has the tag #${tag}`,
      field: 'tag',
      ranges: [r],
      tag,
    };
    if (!best || w.score > best.score) best = w;
  }
  if (best) return best;
  const fr = matchAt(it.folder, t);
  if (fr) return { score: fr[0] === 0 || WORD_START.test(it.folder[fr[0] - 1]) ? 48 : 44, badge: 'Folder', text: `In the folder ${it.folder}`, field: 'folder', ranges: [fr] };
  return null;
}

interface Hit {
  item: FindItem;
  why: Why;
}

function runQuery(items: FindItem[], q: Query, hidden?: (r: string) => boolean): { hits: Hit[]; held: number } {
  const hits: Hit[] = [];
  let held = 0;
  for (const it of items) {
    if (q.tags.length && !q.tags.every((t) => it.tags.some((x) => x.toLowerCase().startsWith(t)))) continue;
    if (q.folders.length && !q.folders.every((f) => it.folder.toLowerCase().includes(f))) continue;
    const why = matchText(it, q);
    if (!why) continue;
    if (hidden?.(it.region)) {
      held++;
      continue;
    }
    hits.push({ item: it, why });
  }
  hits.sort((a, b) => b.why.score - a.why.score || b.item.degree - a.item.degree || a.item.name.length - b.item.name.length);
  return { hits, held };
}

function nearNames(items: FindItem[], text: string): Hit[] {
  const out: Hit[] = [];
  for (const it of items) {
    const near = similar(it.name, text);
    if (!near) continue;
    const i = it.name.indexOf(near.word);
    out.push({ item: it, why: { score: near.s, badge: 'Near', text: near.why, field: 'name', ranges: i >= 0 ? [[i, i + near.word.length]] : [] } });
  }
  return out.sort((a, b) => b.why.score - a.why.score || b.item.degree - a.item.degree).slice(0, 4);
}

const RECENT_KEY = 'memora.find.recent';
const MAX_NODES = 30;

function recent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recent().filter((x) => x !== id)].slice(0, 6)));
  } catch {
    /* private mode */
  }
}

function mark(text: string, ranges: Range[]): string {
  if (!ranges.length) return esc(text);
  let out = '';
  let at = 0;
  for (const [a, b] of ranges) {
    if (a < at) continue;
    out += esc(text.slice(at, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>';
    at = b;
  }
  return out + esc(text.slice(at));
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

const CSS = `
.mf{position:absolute;z-index:9;display:flex;flex-direction:column;max-height:min(520px,calc(100% - 80px));overflow:hidden;
  border-radius:12px;background:var(--ovl-bg);-webkit-backdrop-filter:var(--ovl-filter);backdrop-filter:var(--ovl-filter);
  border:1px solid var(--vc-ctl-line,var(--line));color:var(--fg,#e6e9ef);box-shadow:none;animation:mf-in .16s ease}
.mf[hidden]{display:none}
@keyframes mf-in{from{opacity:0;transform:translateY(-4px)}}
.mf-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--line,#232a38);font-size:12.5px;color:var(--muted,#8b98ad)}
.mf-head b{color:var(--fg,#e6e9ef);font-weight:650}
.mf-head .grow{flex:1}
.mf-chip{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 4px 0 8px;border-radius:6px;font-size:12px;font-weight:600;
  color:var(--accent,#5eead4);background:var(--accent-soft,rgba(94,234,212,.11))}
.mf-chip button{all:unset;display:grid;place-items:center;width:16px;height:16px;border-radius:50%;cursor:pointer;font-size:12px;line-height:1}
.mf-chip button:hover{background:color-mix(in srgb,var(--accent,#5eead4) 25%,transparent)}
.mf-try{all:unset;cursor:pointer;height:24px;padding:0 8px;border-radius:6px;font:600 12px var(--mono,monospace);color:var(--fg,#e6e9ef);
  background:var(--vc-tint,rgba(148,163,184,.08))}
.mf-try:hover,.mf-try:focus-visible{border-color:var(--accent,#5eead4);color:var(--accent,#5eead4)}
.mf-list{overflow:auto;padding:4px;scrollbar-width:thin;overscroll-behavior:contain}
.mf-sec{margin:10px 10px 4px;font-size:12px;font-weight:650;color:var(--text-2,#a3afc2);display:flex;gap:6px}
.mf-sec span{font-weight:500;color:var(--muted,#8b98ad)}
.mf-row{display:grid;grid-template-columns:12px minmax(0,1fr) auto;align-items:center;gap:4px 10px;padding:7px 10px;border-radius:8px;cursor:pointer}
.mf-row:hover{background:var(--vc-tint,rgba(148,163,184,.08))}
.mf-row[aria-selected=true]{background:var(--accent-soft,rgba(94,234,212,.11))}
.mf-row>i{width:9px;height:9px;border-radius:50%;background:var(--c,var(--accent));box-shadow:none}
.mf-row>i.sq{border-radius:3px;box-shadow:none}
.mf-row>i.tg{background:none;box-shadow:none;width:auto;height:auto;font-style:normal;font-weight:700;color:var(--accent,#5eead4);font-size:13px}
.mf-main{min-width:0}
.mf-name{display:block;font-size:13.5px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mf-sub{display:flex;gap:6px;align-items:center;margin-top:2px;font-size:11.5px;color:var(--muted,#8b98ad);min-width:0;overflow:hidden;white-space:nowrap}
.mf-sub>span{overflow:hidden;text-overflow:ellipsis}
.mf-sub .t{flex:none;padding:0 6px;border-radius:999px;background:var(--surface-2,#151a24);color:var(--text-2,#a3afc2)}
.mf mark{background:color-mix(in srgb,var(--accent,#5eead4) 26%,transparent);color:inherit;border-radius:3px;padding:0 1px}
.mf-why{font-size:11px;font-weight:600;padding:2px 7px;border-radius:6px;white-space:nowrap;color:var(--text-2,#a3afc2);border:1px solid var(--line,#232a38)}
.mf-why.top{color:var(--accent,#5eead4);border-color:color-mix(in srgb,var(--accent,#5eead4) 35%,transparent)}
.mf-n{font-size:11.5px;color:var(--muted,#8b98ad);white-space:nowrap}
.mf-more{margin:6px 10px 4px;font-size:11.5px;color:var(--muted,#8b98ad)}
.mf-empty{padding:14px 12px 6px;font-size:13px;color:var(--muted,#8b98ad);line-height:1.5}
.mf-empty b{color:var(--fg,#e6e9ef)}
.mf-tip{display:grid;grid-template-columns:96px 1fr;gap:10px;align-items:center;padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12.5px;color:var(--muted,#8b98ad)}
.mf-tip code{font:600 12px var(--mono,monospace);color:var(--fg,#e6e9ef)}
.mf-tip[aria-selected=true]{background:color-mix(in srgb,var(--accent,#5eead4) 10%,transparent)}
.mf-foot{display:flex;gap:14px;padding:8px 12px;border-top:1px solid var(--line,#232a38);font-size:11.5px;color:var(--muted,#8b98ad)}
.mf-foot kbd{height:auto;min-width:0;padding:0;border:0;background:none;box-shadow:none;font:600 11px/1 var(--font);color:var(--text-2,#a3afc2);margin-right:4px}
@media (max-width:760px){
  .mf{max-height:min(62vh,calc(100% - 70px))}
  .mf-foot{display:none}
  .mf-row{padding:9px 10px}}
@media (prefers-reduced-motion:reduce){.mf{animation:none}}
`;

type Act = { kind: 'node'; item: FindItem } | { kind: 'tag'; tag: string } | { kind: 'folder'; folder: string; region: string } | { kind: 'query'; q: string };

export class MapFind {
  private box: HTMLElement;
  private list: HTMLElement;
  private head: HTMLElement;
  private acts: Act[] = [];
  private active = 0;
  private query: Query = parseQuery('');
  private timer = 0;

  constructor(
    private host: FindHost,
    private src: FindSource,
  ) {
    useStyles('map-find-css', CSS);
    this.box = document.createElement('div');
    this.box.className = 'mf';
    this.box.hidden = true;
    this.box.innerHTML = `<div class="mf-head"></div><div class="mf-list" role="listbox" aria-label="Search results"></div>
      <div class="mf-foot"><span><kbd>↑</kbd><kbd>↓</kbd>move</span><span><kbd>Enter</kbd>open</span><span><kbd>Tab</kbd>use tag or folder</span><span><kbd>Esc</kbd>close</span></div>`;
    host.root.appendChild(this.box);
    this.head = this.box.querySelector('.mf-head')!;
    this.list = this.box.querySelector('.mf-list')!;
    this.box.addEventListener('pointerdown', (e) => {
      if (!(e.target as HTMLElement).closest('input')) e.preventDefault();
    });
    this.list.addEventListener('click', (e) => {
      const r = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
      if (r) this.run(Number(r.dataset.k), false);
    });
    this.list.addEventListener('pointermove', (e) => {
      const r = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
      if (r && Number(r.dataset.k) !== this.active) {
        this.active = Number(r.dataset.k);
        this.paintActive(false);
      }
    });
    this.head.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-drop]');
      if (b) this.dropToken(b.dataset.drop!);
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-try]');
      if (t) this.setInput(t.dataset.try || '');
    });
    host.input.setAttribute('role', 'combobox');
    host.input.setAttribute('aria-autocomplete', 'list');
    host.input.setAttribute('aria-expanded', 'false');
  }

  get el(): HTMLElement {
    return this.box;
  }

  get isOpen(): boolean {
    return !this.box.hidden;
  }

  input(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.refresh();
      this.show();
    }, 60);
  }

  show(): void {
    this.place();
    if (this.box.hidden) {
      this.box.hidden = false;
      this.host.input.setAttribute('aria-expanded', 'true');
      this.refresh();
    }
  }

  hide(): void {
    this.box.hidden = true;
    this.host.input.setAttribute('aria-expanded', 'false');
  }

  update(): void {
    if (this.query.raw) this.refresh();
  }

  clear(): void {
    this.host.input.value = '';
    this.refresh();
  }

  destroy(): void {
    clearTimeout(this.timer);
    this.box.remove();
  }

  /** True when handled. */
  key(e: KeyboardEvent): boolean {
    const n = this.acts.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!this.isOpen) this.show();
      else if (n) {
        this.active = (this.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        this.paintActive(true);
      }
      return true;
    }
    if (e.key === 'Enter') {
      if (n) this.run(this.active, false);
      return true;
    }
    if (e.key === 'Tab' && !e.shiftKey && this.isOpen) {
      const a = this.acts[this.active];
      if (a && (a.kind === 'tag' || a.kind === 'folder' || a.kind === 'query')) {
        this.run(this.active, true);
        return true;
      }
      return false;
    }
    if (e.key === 'Escape') {
      if (this.host.input.value) this.clear();
      else this.hide();
      return true;
    }
    return false;
  }

  private place(): void {
    const a = this.host.anchor();
    if (!a) return;
    const r = a.getBoundingClientRect();
    const h = this.host.root.getBoundingClientRect();
    if (this.host.compact()) {
      this.box.style.left = '12px';
      this.box.style.right = '12px';
      this.box.style.width = 'auto';
    } else {
      this.box.style.left = r.left - h.left + 'px';
      this.box.style.right = '';
      this.box.style.width = Math.max(r.width, Math.min(440, h.width - (r.left - h.left) - 16)) + 'px';
    }
    this.box.style.top = r.bottom - h.top + 8 + 'px';
  }

  private setInput(v: string): void {
    this.host.input.value = v;
    this.host.input.focus({ preventScroll: true });
    const end = v.length;
    this.host.input.setSelectionRange(end, end);
    this.refresh();
    this.show();
  }

  private complete(tok: string): void {
    const raw = this.host.input.value;
    const parts = raw.split(/(\s+)/);
    if (!/\s$/.test(raw) && parts.length) parts[parts.length - 1] = tok;
    else parts.push(tok);
    this.setInput(parts.join('').trimStart() + ' ');
  }

  private dropToken(tok: string): void {
    const rest = this.host.input.value
      .split(/\s+/)
      .filter((t) => t && t.toLowerCase() !== tok.toLowerCase())
      .join(' ');
    this.setInput(rest ? rest + ' ' : '');
  }

  private run(k: number, viaTab: boolean): void {
    const a = this.acts[k];
    if (!a) return;
    if (a.kind === 'node') {
      remember(a.item.id);
      this.hide();
      this.host.input.blur();
      this.src.pick(a.item);
    } else if (a.kind === 'tag') this.complete('#' + a.tag);
    else if (a.kind === 'folder') {
      this.complete('in:' + a.folder);
      if (!viaTab) this.src.folder?.(a.region);
    } else this.setInput(a.q);
  }

  private refresh(): void {
    const raw = this.host.input.value;
    this.query = parseQuery(raw);
    const q = this.query;
    const items = this.src.items().map((it) => {
      const title = noteTitle(it.id);
      return title && title !== it.name ? { ...it, name: title } : it;
    });
    const noun = this.src.noun || 'note';
    this.acts = [];
    this.active = 0;
    const rows: string[] = [];
    const push = (a: Act, html: string): void => {
      rows.push(html.replace('data-k', `data-k="${this.acts.length}"`));
      this.acts.push(a);
    };
    const nodeRow = (h: Hit | null, it: FindItem): string => {
      const why = h?.why;
      const name = why?.field === 'name' ? mark(it.name, why.ranges) : esc(it.name);
      const folder = why?.field === 'folder' ? mark(it.folder, why.ranges) : esc(folderLabel(it.folder));
      const tags = it.tags.slice(0, 3);
      if (why?.tag && !tags.includes(why.tag)) tags.unshift(why.tag);
      const tagHtml = tags
        .slice(0, 3)
        .map((t) => `<span class="t">#${why?.tag === t ? mark(t, why.ranges) : esc(t)}</span>`)
        .join('');
      const badge = why?.badge ? `<span class="mf-why${why.score >= 84 ? ' top' : ''}" title="${attr(why.text)}">${esc(why.badge)}</span>` : `<span class="mf-n">${plural(it.degree, 'link')}</span>`;
      return `<div class="mf-row" role="option" data-k style="--c:${attr(it.color)}"><i></i>
        <div class="mf-main"><span class="mf-name">${name}</span><div class="mf-sub"><span>${folder}</span>${tagHtml}</div></div>${badge}</div>`;
    };

    const tagCount = new Map<string, number>();
    const folderCount = new Map<string, { n: number; region: string; color: string }>();
    for (const it of items) {
      for (const t of it.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
      const f = it.folder || 'Root';
      const e = folderCount.get(f);
      if (e) e.n++;
      else folderCount.set(f, { n: 1, region: it.region, color: it.color });
    }

    if (!raw.trim()) {
      this.src.highlight(null);
      this.host.setCount('');
      const byId = new Map(items.map((it) => [it.id, it]));
      const rec = recent()
        .map((id) => byId.get(id))
        .filter((x): x is FindItem => !!x && !this.src.hidden?.(x.region));
      if (rec.length) {
        rows.push('<div class="mf-sec">Recent</div>');
        for (const it of rec.slice(0, 4)) push({ kind: 'node', item: it }, nodeRow(null, it));
      }
      const top = items
        .filter((it) => !this.src.hidden?.(it.region) && !rec.includes(it))
        .sort((a, b) => b.degree - a.degree)
        .slice(0, rec.length ? 4 : 5);
      if (top.length) {
        rows.push('<div class="mf-sec">Most connected</div>');
        for (const it of top) push({ kind: 'node', item: it }, nodeRow(null, it));
      }
      const topTag = [...tagCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const topFolder = [...folderCount.entries()].filter(([f]) => f !== 'Root').sort((a, b) => b[1].n - a[1].n)[0]?.[0];
      const leaf = topFolder ? topFolder.split('/').pop() : '';
      const tip = (label: string, q: string, title: string): string =>
        `<button type="button" class="mf-try" data-try="${attr(q)}" title="${attr(title)}">${esc(label)}</button>`;
      this.head.innerHTML =
        `<span>Try</span>` +
        tip('#' + (topTag || 'tag'), topTag ? `#${topTag} ` : '#', 'Notes with a tag; the start of the tag is enough') +
        tip('in:' + (leaf || 'folder'), leaf ? `in:${leaf} ` : 'in:', 'Notes inside a folder') +
        tip('name words', '', 'Plain words match names first, then tags and folders') +
        `<span class="grow"></span><span>Matches light up on the map</span>`;
      this.paint(rows);
      return;
    }

    const { hits, held } = runQuery(items, q, this.src.hidden?.bind(this.src));
    this.src.highlight(new Set(hits.map((h) => h.item.id)));
    this.host.setCount(hits.length ? String(hits.length) : 'none');

    const chips = [
      ...q.tags.map((t) => ['#' + t, `#${t}`]),
      ...q.folders.map((f) => ['in:' + f, `in: ${f}`]),
    ]
      .map(([tok, label]) => `<span class="mf-chip">${esc(label)}<button type="button" data-drop="${attr(tok)}" aria-label="Remove ${attr(label)}">×</button></span>`)
      .join('');
    const what = q.text ? ` for “<b>${esc(q.text)}</b>”` : '';
    this.head.innerHTML =
      chips +
      `<span>${hits.length ? `<b>${plural(hits.length, noun)}</b>${what} lit on the map` : `No ${noun}s${what}`}${
        held ? ` · ${held} more in hidden folders` : ''
      }</span>`;

    const p = q.partial;
    if (p?.kind === 'tag' || (!p && q.text && !q.tags.length)) {
      const v = p?.kind === 'tag' ? p.value : q.text;
      const tags = [...tagCount.entries()]
        .filter(([t]) => t.toLowerCase().includes(v))
        .sort((a, b) => Number(b[0].toLowerCase().startsWith(v)) - Number(a[0].toLowerCase().startsWith(v)) || b[1] - a[1])
        .slice(0, p ? 6 : 3);
      if (tags.length) {
        rows.push(`<div class="mf-sec">Tags <span>${p ? 'Tab or click to filter by it' : ''}</span></div>`);
        for (const [t, n] of tags) {
          const i = t.toLowerCase().indexOf(v);
          push({ kind: 'tag', tag: t }, `<div class="mf-row" role="option" data-k><i class="tg">#</i><div class="mf-main"><span class="mf-name">${mark(t, v && i >= 0 ? [[i, i + v.length]] : [])}</span></div><span class="mf-n">${plural(n, noun)}</span></div>`);
        }
      }
    }
    if (p?.kind === 'folder' || (!p && q.text && !q.folders.length)) {
      const v = p?.kind === 'folder' ? p.value : q.text;
      const fs = [...folderCount.entries()]
        .filter(([f]) => f !== 'Root' && f.toLowerCase().includes(v))
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, p ? 6 : 3);
      if (fs.length) {
        rows.push(`<div class="mf-sec">Folders <span>${p ? 'Tab to filter · click to go there' : ''}</span></div>`);
        for (const [f, e] of fs) {
          const i = f.toLowerCase().indexOf(v);
          push(
            { kind: 'folder', folder: f.split('/').pop() || f, region: e.region },
            `<div class="mf-row" role="option" data-k style="--c:${attr(e.color)}"><i class="sq"></i><div class="mf-main"><span class="mf-name">${mark(f, v && i >= 0 ? [[i, i + v.length]] : [])}</span></div><span class="mf-n">${plural(e.n, noun)}</span></div>`,
          );
        }
      }
    }

    if (hits.length) {
      rows.push(`<div class="mf-sec">${noun[0].toUpperCase() + noun.slice(1)}s <span>${hits.length > MAX_NODES ? `top ${MAX_NODES} of ${hits.length}` : ''}</span></div>`);
      for (const h of hits.slice(0, MAX_NODES)) push({ kind: 'node', item: h.item }, nodeRow(h, h.item));
      if (hits.length > MAX_NODES) rows.push(`<div class="mf-more">${hits.length - MAX_NODES} more are lit on the map. Add a word, a #tag or in:folder to narrow.</div>`);
    } else if (!rows.length || !this.acts.length) {
      const near = nearNames(items, q.text);
      rows.push(
        `<div class="mf-empty">Nothing matches${q.text ? ` “<b>${esc(q.text)}</b>”` : ''}${q.tags.length || q.folders.length ? ' with these filters' : ''}.` +
          `${held ? ` ${held} ${noun}s match in hidden folders: show them in Folders.` : ''}</div>`,
      );
      if (near.length) {
        rows.push('<div class="mf-sec">Did you mean</div>');
        for (const h of near) push({ kind: 'node', item: h.item }, nodeRow(h, h.item));
      }
      if (q.tags.length || q.folders.length) {
        rows.push('<div class="mf-sec">Try</div>');
        push({ kind: 'query', q: q.text }, `<div class="mf-tip" role="option" data-k><code>no filters</code><span>search “${esc(q.text || '…')}” without #tag and in:</span></div>`);
      }
    }
    const firstNode = this.acts.findIndex((a) => a.kind === 'node');
    if (firstNode > 0 && !p) this.active = firstNode;
    this.paint(rows);
  }

  private paint(rows: string[]): void {
    this.list.innerHTML = rows.join('');
    this.paintActive(false);
  }

  private paintActive(scroll: boolean): void {
    const rows = this.list.querySelectorAll<HTMLElement>('[data-k]');
    let cur: HTMLElement | null = null;
    rows.forEach((r) => {
      const on = Number(r.dataset.k) === this.active;
      r.setAttribute('aria-selected', String(on));
      if (on) cur = r;
      else r.removeAttribute('id');
    });
    if (cur) {
      (cur as HTMLElement).id = 'mfActive';
      this.host.input.setAttribute('aria-activedescendant', 'mfActive');
      if (scroll) (cur as HTMLElement).scrollIntoView({ block: 'nearest' });
    } else this.host.input.removeAttribute('aria-activedescendant');
  }
}
