// Tags view: the tag index, filtering by tags or a pattern, the matching notes and bulk tag edits.

import { apiGet, apiPost } from '../api';
import { $, attr, esc, useStyles } from '../dom';
import { folderOf, hashColor, relTs } from '../format';
import { hooks } from '../hooks';
import { Modal } from '../modal';
import { onNavigate } from '../router';
import { state, allNotes } from '../state';
import { clearTagIndex, readTagIndex, writeTagIndex } from '../storage';
import { notify } from '../toast';
import type { NoteRef } from '../types';
import { typedConfirm } from '../ui/components';
import { NodeCard, type CardLink } from '../ui/node-card';
import { folderColor } from '../vault/store';
import { nav } from '../vault/nav';
import {
  allState,
  matchNotes,
  mergeSources,
  notesForPattern,
  parsePattern,
  patternText,
  patternTokens,
  pickTags,
  removedTags,
  tokensText,
  untagPlan,
  validTag,
  type MatchMode,
  type Pattern,
  type PatternToken,
  type TagEntry,
} from './tags-model';

const view = {
  q: '',
  sort: 'count' as 'count' | 'name',
  /** The tags the notes are filtered by. */
  sel: [] as string[],
  mode: 'any' as MatchMode,
  /** A typed pattern (tags with and / or / not) instead of ticked tags. */
  pattern: null as null | { src: string; p: Pattern },
  /** Ticked tags, for the bulk actions. */
  picked: new Set<string>(),
  /** The last ticked box, the start of a shift-click range. */
  anchor: null as string | null,
};

/** The index the page last drew, and the order its rows are in. */
let map: Map<string, TagEntry[]> | null = null;
let order: string[] = [];
/** The notes' signature the in-memory index was built from. */
let builtSig = '';
/** A bulk edit is running: realtime redraws wait; it draws once when done. */
let busy = false;

interface LinkGraph {
  color: Map<string, string>;
  degree: Map<string, number>;
  out: Map<string, string[]>;
  inc: Map<string, string[]>;
}
type GraphReply = { nodes?: { id?: string; path?: string; color?: string; degree?: number; tags?: string[] }[]; links?: { source: string; target: string }[] };
let graph: LinkGraph | null = null;

function readGraph(g: GraphReply): LinkGraph {
  const lg: LinkGraph = { color: new Map(), degree: new Map(), out: new Map(), inc: new Map() };
  const byId = new Map<string, string>();
  for (const n of g.nodes || []) {
    if (!n.path) continue;
    byId.set(n.id || n.path, n.path);
    if (n.color) lg.color.set(n.path, n.color);
    lg.degree.set(n.path, n.degree || 0);
  }
  const push = (m: Map<string, string[]>, k: string, v: string): void => {
    const l = m.get(k);
    if (!l) m.set(k, [v]);
    else if (!l.includes(v)) l.push(v);
  };
  for (const l of g.links || []) {
    const s = byId.get(l.source);
    const t = byId.get(l.target);
    if (!s || !t || s === t) continue;
    push(lg.out, s, t);
    push(lg.inc, t, s);
  }
  return lg;
}

async function ensureGraph(): Promise<void> {
  if (graph) return;
  try {
    graph = readGraph(await apiGet<GraphReply>('/api/graph'));
  } catch {
    graph = readGraph({});
  }
}

async function buildTagIndex(force: boolean, onProgress: (done: number, total: number) => void): Promise<Map<string, TagEntry[]>> {
  const notes = allNotes();
  const sig = notes.map((n) => n.path + ':' + n.mtime).join('|');
  // The index in memory holds while no note changed since it was built.
  if (state.tags.built && !force && state.tags.index && sig === builtSig) {
    return state.tags.index as unknown as Map<string, TagEntry[]>;
  }
  const map = new Map<string, TagEntry[]>();
  const cached = readTagIndex();
  if (!force && cached && cached.sig === sig) {
    const restored = new Map<string, TagEntry[]>();
    for (const [tag, list] of cached.tags) restored.set(tag, list as unknown as TagEntry[]);
    state.tags.index = restored as unknown as Map<string, NoteRef[]>;
    state.tags.built = true;
    builtSig = sig;
    return restored;
  }
  // One request: the graph carries every note's tags (inline and frontmatter), so no note is fetched on its own.
  let g: GraphReply;
  try {
    g = await apiGet<GraphReply>('/api/graph');
  } catch {
    // Nothing to show yet; the next visit (or Rebuild) tries again.
    onProgress(notes.length, notes.length);
    return map;
  }
  graph = readGraph(g);
  const tagsOf = new Map<string, string[]>();
  for (const n of g.nodes || []) if (n.path) tagsOf.set(n.path, n.tags || []);
  for (const n of notes) {
    const tags = new Set((tagsOf.get(n.path) || []).map((t) => t.replace(/^#/, '')));
    for (const t of tags) {
      if (!t) continue;
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push({ path: n.path, name: n.name, folder: n.folder, mtime: n.mtime });
    }
  }
  state.tags.progress = 100;
  onProgress(notes.length, notes.length);
  state.tags.index = map as unknown as Map<string, NoteRef[]>;
  state.tags.built = true;
  builtSig = sig;
  writeTagIndex(sig, Array.from(map.entries()));
  return map;
}

/** Forget the index (and the links) so the next draw reads the vault again. */
function dropIndex(): void {
  clearTagIndex();
  state.tags.built = false;
  state.tags.index = null;
  builtSig = '';
  graph = null;
}

function tagsOfNote(path: string): string[] {
  const out: string[] = [];
  map?.forEach((l, t) => {
    if (l.some((e) => e.path === path)) out.push(t);
  });
  return out;
}

export async function renderTags(): Promise<void> {
  if (busy) return;
  useStyles('tg-styles', TAGS_CSS);
  wireOnce();
  const host = $('#view-tags');
  if (state.tags.active) {
    view.sel = [state.tags.active];
    view.mode = 'any';
    state.tags.active = null;
  }
  // A redraw (realtime change, Rebuild) keeps the list's scroll and the search focus.
  const keepScroll = host.querySelector<HTMLElement>('#tgCloud')?.scrollTop || 0;
  const typing = document.activeElement?.id === 'tgQ';
  host.innerHTML = `<div class="tg">
    <header class="tg-head">
      <div class="tg-title"><h1>Tags</h1><p id="tgSub">Reading notes…</p></div>
      <div class="tg-hacts"><button class="btn tg-patbtn" id="tgPat" title="Find notes by tags joined with and, or, not">${PATTERN_ICON}<span>Pattern…</span></button>
      <button class="btn ghost tg-rebuild" id="tgRebuild" title="Read every note again">${REFRESH}<span>Rebuild</span></button></div>
    </header>
    <div class="tg-prog" id="tgProg"><i style="width:${state.tags.built ? 100 : 0}%"></i></div>
    <div class="tg-bulk" id="tgBulk" role="toolbar" aria-label="Selected tags" hidden></div>
    <div class="tg-body">
      <section class="tg-side" aria-label="All tags">
        <div class="tg-tools">
          <label class="tg-search">${SEARCH}<input id="tgQ" type="search" placeholder="Find a tag" aria-label="Find a tag" value="${attr(view.q)}" spellcheck="false" autocomplete="off">
            <button type="button" class="tg-qx" id="tgQx" aria-label="Clear the search" title="Clear the search"${view.q ? '' : ' hidden'}>${X_ICON}</button></label>
          <div class="tg-seg" role="group" aria-label="Sort tags">
            <button data-s="count" aria-pressed="${view.sort === 'count'}" class="${view.sort === 'count' ? 'on' : ''}">Popular</button>
            <button data-s="name" aria-pressed="${view.sort === 'name'}" class="${view.sort === 'name' ? 'on' : ''}">A–Z</button>
          </div>
        </div>
        <div class="tg-lh" id="tgLh" hidden><label class="tg-all"><span class="tg-check"><input type="checkbox" id="tgAll"></span><span>Select all</span></label><span id="tgLn"></span></div>
        <div id="tgCloud" class="tg-cloud" role="list" aria-label="Tags"><div class="empty">Building the tag index…</div></div>
      </section>
      <section class="tg-results" aria-label="Notes">
        <div class="tg-fx" id="tgFx" role="group" aria-label="Filters in use" hidden></div>
        <div id="tgRes" aria-live="polite"></div>
      </section>
    </div></div>`;

  host.querySelector<HTMLButtonElement>('#tgPat')!.onclick = () => openPattern();
  host.querySelector<HTMLButtonElement>('#tgRebuild')!.onclick = () => {
    dropIndex();
    void renderTags();
  };
  host.querySelectorAll<HTMLButtonElement>('.tg-seg button').forEach((b) => {
    b.onclick = () => {
      view.sort = b.dataset.s === 'name' ? 'name' : 'count';
      host.querySelectorAll<HTMLButtonElement>('.tg-seg button').forEach((x) => {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      if (map) drawCloud();
    };
  });
  const q = host.querySelector<HTMLInputElement>('#tgQ')!;
  const qx = host.querySelector<HTMLButtonElement>('#tgQx')!;
  const setQuery = (v: string): void => {
    view.q = v;
    if (q.value !== v) q.value = v;
    qx.hidden = !v;
    if (map) {
      drawCloud();
      drawFx();
    }
  };
  q.oninput = () => setQuery(q.value);
  q.onkeydown = (e) => {
    if (e.key === 'Escape' && q.value) {
      e.preventDefault();
      e.stopPropagation();
      setQuery('');
    }
  };
  qx.onclick = () => {
    setQuery('');
    q.focus();
  };
  if (typing) {
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }

  const bar = host.querySelector<HTMLElement>('#tgProg i')!;
  const sub = host.querySelector<HTMLElement>('#tgSub')!;
  const built = await buildTagIndex(false, (done, total) => {
    bar.style.width = Math.round((done / Math.max(1, total)) * 100) + '%';
    sub.textContent = `Reading notes… ${done}/${total}`;
  });
  if (!host.contains(bar)) return;
  map = built;
  bar.style.width = '100%';
  setTimeout(() => host.querySelector('#tgProg')?.classList.add('done'), 300);
  const tagged = new Set<string>();
  built.forEach((l) => l.forEach((e) => tagged.add(e.path)));
  sub.textContent = `${built.size} tags across ${tagged.size} notes`;

  // Drop filters and ticks for tags that no longer exist.
  view.sel = view.sel.filter((t) => built.has(t));
  view.picked = new Set(Array.from(view.picked).filter((t) => built.has(t)));
  drawAll();
  const cloud = host.querySelector<HTMLElement>('#tgCloud');
  if (cloud) cloud.scrollTop = keepScroll;
  refreshCard();
}

function drawAll(): void {
  drawBulk();
  drawCloud();
  drawFx();
  drawResults();
}

/** The tags the list shows now (search and sort applied). */
function shownTags(): string[] {
  if (!map) return [];
  const needle = view.q.trim().toLowerCase().replace(/^#/, '');
  return Array.from(map.entries())
    .filter(([t, l]) => l.length && (!needle || t.toLowerCase().includes(needle)))
    .sort((a, b) => (view.sort === 'name' ? a[0].localeCompare(b[0]) : b[1].length - a[1].length || a[0].localeCompare(b[0])))
    .map(([t]) => t);
}

function drawCloud(): void {
  if (!map) return;
  const cloud = $('#tgCloud');
  const lh = $('#tgLh');
  const rows = shownTags();
  order = rows;
  lh.hidden = !rows.length;
  if (!map.size) {
    cloud.innerHTML = '<div class="empty">This vault has no tags yet. Add <code>#tags</code> or a <code>tags:</code> line to a note.</div>';
    return;
  }
  if (!rows.length) {
    cloud.innerHTML = `<div class="empty">No tag matches "${esc(view.q)}".</div>`;
    return;
  }
  const max = Math.max(...rows.map((t) => map!.get(t)!.length));
  cloud.innerHTML = rows
    .map((t) => {
      const n = map!.get(t)!.length;
      const on = view.sel.includes(t);
      const picked = view.picked.has(t);
      return `<div class="tg-tag${on ? ' on' : ''}${picked ? ' picked' : ''}" role="listitem" style="--tc:${hashColor(t)};--w:${(n / Math.max(1, max)).toFixed(3)}">
        <label class="tg-check" title="Select #${attr(t)} (Shift+click selects a range)"><input type="checkbox" data-pick="${attr(t)}" aria-label="Select #${attr(t)}"${picked ? ' checked' : ''}></label>
        <button type="button" class="tg-tag-b" data-tag="${attr(t)}" aria-pressed="${on}"><i></i><span>${esc(t)}</span><s aria-hidden="true"></s><em>${n}</em></button></div>`;
    })
    .join('');
  cloud.querySelectorAll<HTMLElement>('.tg-tag-b').forEach((b) => {
    b.onclick = (e) => {
      const t = b.dataset.tag || '';
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        view.sel = view.sel.includes(t) ? view.sel.filter((x) => x !== t) : [...view.sel, t];
      } else {
        view.sel = view.sel.length === 1 && view.sel[0] === t ? [] : [t];
      }
      redraw();
      focusIn(cloud, `.tg-tag-b[data-tag="${cssEsc(t)}"]`);
    };
  });
  cloud.querySelectorAll<HTMLInputElement>('[data-pick]').forEach((box) => {
    // `click` carries the Shift key; the box has already flipped by then.
    box.onclick = (e) => {
      const t = box.dataset.pick || '';
      const next = pickTags(order, view.picked, t, box.checked, view.anchor, e.shiftKey);
      view.sel = view.sel.filter((x) => next.has(x)).concat(order.filter((x) => next.has(x) && !view.sel.includes(x)));
      view.anchor = t;
      redraw();
      focusIn(cloud, `[data-pick="${cssEsc(t)}"]`);
    };
  });
  const all = $('#tgAll') as HTMLInputElement;
  const st = allState(rows, view.picked);
  all.checked = st === 'all';
  all.indeterminate = st === 'some';
  all.setAttribute('aria-label', view.q ? 'Select every tag found' : 'Select every tag');
  all.onchange = () => {
    const next = new Set(view.picked);
    for (const t of rows) {
      if (all.checked) next.add(t);
      else next.delete(t);
    }
    view.sel = view.sel.filter((x) => next.has(x)).concat(order.filter((x) => next.has(x) && !view.sel.includes(x)));
    view.anchor = null;
    redraw();
    ($('#tgAll') as HTMLInputElement).focus();
  };
  $('#tgLn').textContent = view.q ? `${rows.length} of ${map.size}` : `${rows.length} tag${rows.length === 1 ? '' : 's'}`;
}

/** The bar over both panes while tags are ticked: count, what to do with them, clear. */
function drawBulk(): void {
  const bar = $('#tgBulk');
  const picked = order.filter((t) => view.picked.has(t)).concat(Array.from(view.picked).filter((t) => !order.includes(t)));
  const n = picked.length;
  bar.hidden = !n;
  if (!n) {
    bar.innerHTML = '';
    return;
  }
  const notes = untagPlan(map || new Map(), picked).length;
  bar.innerHTML = `<span class="tg-bn"><b>${n}</b> selected<small> · ${notes} note${notes === 1 ? '' : 's'}</small></span>
    <div class="tg-bacts">
      <button type="button" class="btn ghost tg-bjump" data-b="jump">${matchCount()} note${matchCount() === 1 ? '' : 's'} ↓</button>
      <button type="button" class="btn ghost" data-b="merge">${MERGE_ICON}${n === 1 ? 'Rename…' : 'Merge…'}</button>
      <button type="button" class="btn ghost tg-danger" data-b="remove">${X_ICON}Remove from notes</button></div>
    <button type="button" class="btn ghost tg-bx" data-b="clear" aria-label="Clear the selection (Esc)" title="Clear the selection (Esc)">${X_ICON}</button>`;
  bar.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.b;
      if (k === 'jump') $('#tgFx').closest('.tg-results')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      else if (k === 'merge') {
        if (n === 1) askRename(picked[0]);
        else askMerge(picked);
      } else if (k === 'remove') askRemove(picked);
      else clearPicked();
    };
  });
}

function parsedTags(src: string): string[] {
  const r = parsePattern(src);
  return r.ok ? r.tags : [];
}

/** A pattern drawn as chips: tags in their colour, and / or / not as labels, groups boxed. */
function patternHTML(p: Pattern, top = true): string {
  if (p.k === 'tag') return `<span class="tg-pv tag" style="--tc:${hashColor(p.t)}"><i></i>${esc(p.t)}</span>`;
  if (p.k === 'not') return `<span class="tg-pv op not">not</span>${patternHTML(p.a, false)}`;
  const inner = p.l.map((x) => patternHTML(x, x.k === p.k)).join(`<span class="tg-pv op">${p.k}</span>`);
  return top ? inner : `<span class="tg-pv grp">${inner}</span>`;
}

/** The pattern dialog: tags and and / or / not / ( ) built as chips, with a live match count. */
function openPattern(): void {
  if (!map) return;
  const tags = Array.from(map.keys());
  const byLower = new Map(tags.map((t) => [t.toLowerCase(), t]));
  const popular = tags.slice().sort((a, b) => map!.get(b)!.length - map!.get(a)!.length);
  const seed = view.pattern?.src ?? (view.sel.length ? view.sel.join(view.mode === 'all' ? ' and ' : ' or ') : '');
  let toks: PatternToken[] = patternTokens(seed).map((t) => (t.k === 'tag' ? { k: 'tag', t: byLower.get(t.t.toLowerCase()) || t.t } : t));
  Modal.open({
    title: 'Find notes by a pattern',
    body: `<div class="tg-pat">
      <p class="tg-pat-l">Pick tags; between them choose <b>and</b> (both) or <b>or</b> (either). <b>not</b> leaves a tag out, <b class="tg-nw">( )</b> groups.</p>
      <div class="tg-pf" id="tgPf"><span class="tg-pf-toks" id="tgPfT"></span><input id="tgPatIn" class="tg-pf-in" type="text" autocomplete="off" spellcheck="false" aria-label="Add a tag"></div>
      <div class="tg-pat-ops" role="group" aria-label="Add">${[
        ['and', 'Both'],
        ['or', 'Either'],
        ['not', 'Without'],
        ['(', 'Group'],
        [')', 'End group'],
      ]
        .map(([o, h]) => `<button type="button" class="tg-pat-op" data-op="${o}" title="${h}">${o}</button>`)
        .join('')}<button type="button" class="tg-pat-op clr" data-op="clear" title="Start over">Clear</button></div>
      <div class="tg-pat-sug" id="tgPatSug" aria-label="Tags"></div>
      <div class="tg-pat-out" id="tgPatOut" aria-live="polite"></div></div>`,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      { label: 'Show notes', cls: 'primary', run: () => apply() },
    ],
    onOpen: (b) => {
      const input = b.querySelector<HTMLInputElement>('#tgPatIn')!;
      const tokEl = b.querySelector<HTMLElement>('#tgPfT')!;
      const out = b.querySelector<HTMLElement>('#tgPatOut')!;
      const sug = b.querySelector<HTMLElement>('#tgPatSug')!;
      b.querySelector<HTMLElement>('#tgPf')!.onclick = (e) => {
        if (e.target === e.currentTarget || e.target === tokEl) input.focus();
      };
      const last = (): PatternToken | undefined => toks[toks.length - 1];
      const afterTerm = (): boolean => {
        const l = last();
        return !!l && (l.k === 'tag' || l.k === ')');
      };
      const push = (t: PatternToken): void => {
        // Between two terms an operator is needed: tags and groups join with or, not with and.
        if (afterTerm() && (t.k === 'tag' || t.k === '(')) toks.push({ k: 'or' });
        if (afterTerm() && t.k === 'not') toks.push({ k: 'and' });
        toks.push(t);
      };
      const addWord = (w: string): void => {
        const v = w.trim().replace(/^#+/, '');
        if (!v) return;
        const lw = v.toLowerCase();
        if (lw === 'and' || lw === 'or') toks.push({ k: lw });
        else if (lw === 'not') push({ k: 'not' });
        else push({ k: 'tag', t: byLower.get(lw) || v });
      };
      const paint = (): void => {
        tokEl.innerHTML = toks
          .map((t, i) =>
            t.k === 'tag'
              ? `<span class="tg-pt tag" style="--tc:${hashColor(t.t)}"><i></i>${esc(t.t)}<button type="button" data-del="${i}" aria-label="Remove #${attr(t.t)}">${X_ICON}</button></span>`
              : t.k === 'and' || t.k === 'or'
                ? `<button type="button" class="tg-pt op" data-flip="${i}" title="Click to switch to ${t.k === 'and' ? 'or' : 'and'}">${t.k}</button>`
                : `<button type="button" class="tg-pt op ${t.k === 'not' ? 'not' : 'par'}" data-del="${i}" title="Remove">${t.k}</button>`,
          )
          .join('');
        input.placeholder = toks.length ? (afterTerm() ? 'Add another tag…' : 'Pick or type a tag…') : 'Pick or type a tag…';
        tokEl.querySelectorAll<HTMLElement>('[data-del]').forEach((x) => {
          x.onclick = (e) => {
            e.stopPropagation();
            toks.splice(Number(x.dataset.del), 1);
            sync();
            input.focus();
          };
        });
        tokEl.querySelectorAll<HTMLElement>('[data-flip]').forEach((x) => {
          x.onclick = () => {
            const i = Number(x.dataset.flip);
            toks[i] = { k: toks[i].k === 'and' ? 'or' : 'and' };
            sync();
          };
        });
      };
      const sync = (): void => {
        paint();
        // Tags to pick: what is typed, else the most used ones not in the pattern yet.
        const q = input.value.trim().replace(/^#+/, '').toLowerCase();
        const inUse = new Set(toks.filter((t) => t.k === 'tag').map((t) => (t as { t: string }).t.toLowerCase()));
        const hits = (q ? tags.filter((t) => t.toLowerCase().includes(q)) : popular.filter((t) => !inUse.has(t.toLowerCase()))).slice(0, q ? 10 : 12);
        sug.innerHTML = hits.length
          ? `<span class="tg-pat-sh">${q ? 'Matching tags' : 'Most used'}</span>${hits
              .map((t) => `<button type="button" class="tg-mini" data-sug="${attr(t)}" style="--tc:${hashColor(t)}"><i></i>${esc(t)} <em>${map!.get(t)!.length}</em></button>`)
              .join('')}`
          : q
            ? `<span class="tg-pat-sh">No tag contains “${esc(q)}”</span>`
            : '';
        sug.querySelectorAll<HTMLElement>('[data-sug]').forEach((x) => {
          x.onclick = () => {
            push({ k: 'tag', t: x.dataset.sug || '' });
            input.value = '';
            sync();
            input.focus();
          };
        });
        const l = last();
        if (!toks.length) {
          out.className = 'tg-pat-out';
          out.textContent = 'Pick a tag to start.';
          return;
        }
        if (l && l.k !== 'tag' && l.k !== ')') {
          out.className = 'tg-pat-out';
          out.textContent = l.k === '(' ? 'Add a tag inside the group.' : `Add a tag after “${l.k}”.`;
          return;
        }
        const r = parsePattern(tokensText(toks));
        if (!r.ok) {
          out.className = 'tg-pat-out bad';
          out.textContent = r.error;
          return;
        }
        const unknown = r.tags.filter((t) => !byLower.has(t));
        const n = notesForPattern(map!, r.p).length;
        out.className = 'tg-pat-out ok';
        out.innerHTML = `<span class="tg-pat-n"><b>${n.toLocaleString('en-US')}</b> note${n === 1 ? '' : 's'}</span><span class="tg-pat-rd">${patternHTML(r.p)}</span>${
          unknown.length ? `<small>No tag called ${unknown.map((t) => '#' + esc(t)).join(', ')}</small>` : ''
        }`;
      };
      b.querySelectorAll<HTMLElement>('[data-op]').forEach((x) => {
        x.onclick = () => {
          const o = x.dataset.op || '';
          if (o === 'clear') toks = [];
          else if (o === 'and' || o === 'or') {
            // Swap the operator just added, or add one after a term.
            const l = last();
            if (l && (l.k === 'and' || l.k === 'or')) toks[toks.length - 1] = { k: o };
            else toks.push({ k: o });
          } else push({ k: o as 'not' | '(' | ')' });
          sync();
          input.focus();
        };
      });
      input.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === 'Tab' || e.key === ',') && input.value.trim()) {
          e.preventDefault();
          const q = input.value.trim().replace(/^#+/, '').toLowerCase();
          const exact = byLower.get(q);
          const first = tags.find((t) => t.toLowerCase().includes(q));
          addWord(['and', 'or', 'not'].includes(q) ? q : exact || first || q);
          input.value = '';
          sync();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          apply();
        } else if (e.key === 'Backspace' && !input.value && toks.length) {
          toks.pop();
          sync();
        } else if (e.key === '(' || e.key === ')') {
          e.preventDefault();
          if (input.value.trim()) addWord(input.value);
          input.value = '';
          push({ k: e.key });
          sync();
        }
      });
      input.addEventListener('input', () => {
        // "and ", "or ", "not " typed as words become labels.
        const m = /^(and|or|not)\s$/i.exec(input.value);
        if (m) {
          addWord(m[1]);
          input.value = '';
        }
        sync();
      });
      sync();
      input.focus();
    },
  });
  function apply(): void {
    const l = toks[toks.length - 1];
    if (!toks.length || (l && l.k !== 'tag' && l.k !== ')')) return;
    const src = tokensText(toks);
    const r = parsePattern(src);
    if (!r.ok) return;
    Modal.close();
    view.sel = [];
    view.pattern = { src, p: r.p };
    redraw();
    // Stacked layout: go to the chip and the notes under the list.
    if (window.matchMedia('(max-width:860px)').matches) $('#tgFx').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

/** How many notes the chosen tags show right now. */
function matchCount(): number {
  return map && view.sel.length ? matchNotes(view.sel.map((t) => map!.get(t) || []), view.mode).length : 0;
}

function clearPicked(): void {
  view.sel = [];
  view.anchor = null;
  redraw();
}

/** The filters in use as chips, with "N filters · Clear all" at the end. */
function drawFx(): void {
  const fx = $('#tgFx');
  const chips = view.sel.map(
    (t) =>
      `<span class="tg-chip" style="--tc:${hashColor(t)}"><i></i><span class="t" title="#${attr(t)}">${esc(t)}</span><button type="button" class="x" data-rm="${attr(
        t,
      )}" aria-label="Stop filtering by #${attr(t)}" title="Remove">${X_ICON}</button></span>`,
  );
  // The joiner travels with the chip after it, so a wrapped line never ends on "and".
  const joined = chips.map((c, i) => (i ? `<span class="tg-cj"><span class="tg-and">${view.mode === 'any' ? 'or' : 'and'}</span>${c}</span>` : c)).join('');
  const q = view.q.trim();
  const qChip = q
    ? `<span class="tg-chip q">${SEARCH}<span class="t" title="Tags matching “${attr(q)}”">“${esc(q)}”</span><button type="button" class="x" data-rmq aria-label="Clear the tag search" title="Remove">${X_ICON}</button></span>`
    : '';
  const pat = view.pattern
    ? `<span class="tg-chip pat">${PATTERN_ICON}<button type="button" class="t tg-pat-edit" data-pedit title="Edit the pattern: ${attr(patternText(view.pattern.p))}">${patternHTML(view.pattern.p)}</button><button type="button" class="x" data-prm aria-label="Stop filtering by this pattern" title="Remove">${X_ICON}</button></span>`
    : '';
  const n = chips.length + (q ? 1 : 0) + (pat ? 1 : 0);
  fx.hidden = !n;
  if (!n) {
    fx.innerHTML = '';
    return;
  }
  fx.innerHTML = `<div class="tg-chips">${pat}${joined}${qChip}</div>
    <div class="tg-fx-end">${n > 1 ? `<span class="tg-fn">${n} filters</span>` : ''}<button type="button" class="tg-clear" data-clear>Clear all</button></div>`;
  fx.querySelectorAll<HTMLElement>('[data-rm]').forEach((b) => {
    b.onclick = () => {
      view.sel = view.sel.filter((t) => t !== b.dataset.rm);
      redraw();
      (fx.querySelector<HTMLElement>('.x') || $('#tgQ')).focus();
    };
  });
  fx.querySelector<HTMLElement>('[data-rmq]')?.addEventListener('click', () => clearQuery());
  fx.querySelector<HTMLElement>('[data-pedit]')?.addEventListener('click', () => openPattern());
  fx.querySelector<HTMLElement>('[data-prm]')?.addEventListener('click', () => {
    view.pattern = null;
    redraw();
    $('#tgPat').focus();
  });
  fx.querySelector<HTMLElement>('[data-clear]')!.onclick = () => {
    view.sel = [];
    view.pattern = null;
    view.mode = 'any';
    clearQuery();
    redraw();
    $('#tgQ').focus();
  };
}

function clearQuery(): void {
  const q = document.getElementById('tgQ') as HTMLInputElement | null;
  view.q = '';
  if (q) q.value = '';
  const qx = document.getElementById('tgQx');
  if (qx) qx.hidden = true;
  drawCloud();
  drawFx();
}

/** Ticked tags and shown tags are one thing: ticking a tag shows its notes. */
function redraw(): void {
  if (view.sel.length) view.pattern = null;
  view.picked = new Set(view.sel);
  drawBulk();
  drawCloud();
  drawFx();
  drawResults();
}

function drawResults(): void {
  if (!map) return;
  const res = $('#tgRes');
  if (!view.sel.length && !view.pattern) {
    const top = Array.from(map.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6);
    res.innerHTML = `<div class="tg-hint"><div class="tg-hint-head"><span class="tg-hint-ico">${TAG_ICON}</span><div><h2>Pick a tag</h2>
      <p>Click or tick tags to see their notes. Need more, like <i>session or (memora and plan) not docker</i>? Use <button type="button" class="tg-linkbtn" data-pat>Pattern…</button></p></div></div>${
        top.length
          ? `<h3 class="tg-sub">Most used</h3><div class="tg-top">${top
              .map(
                ([t, l]) =>
                  `<button class="tg-card" data-tag="${attr(t)}" style="--tc:${hashColor(t)}"><b><i></i>${esc(t)}</b><dl>
                  <dt>Notes</dt><dd>${l.length}</dd><dt>Updated</dt><dd>${esc(relTs(Math.max(...l.map((e) => e.mtime || 0))))}</dd></dl><small>${esc(
                    l
                      .slice(0, 3)
                      .map((e) => e.name)
                      .join(', '),
                  )}</small></button>`,
              )
              .join('')}</div>`
          : ''
      }</div>`;
    res.querySelector<HTMLElement>('[data-pat]')?.addEventListener('click', () => openPattern());
    res.querySelectorAll<HTMLElement>('.tg-card').forEach((b) => {
      b.onclick = () => {
        view.sel = [b.dataset.tag || ''];
        view.mode = 'any';
        redraw();
      };
    });
    return;
  }
  const pat = view.pattern;
  const notes = pat ? notesForPattern(map, pat.p) : matchNotes(view.sel.map((t) => map!.get(t) || []), view.mode);
  const used = pat ? new Set(parsedTags(pat.src)) : new Set(view.sel.map((t) => t.toLowerCase()));
  // Note -> tags, for co-occurring tags.
  const tagsOf = new Map<string, string[]>();
  map.forEach((l, t) => l.forEach((e) => tagsOf.set(e.path, [...(tagsOf.get(e.path) || []), t])));
  const related = new Map<string, number>();
  for (const n of notes) for (const t of tagsOf.get(n.path) || []) if (!used.has(t.toLowerCase())) related.set(t, (related.get(t) || 0) + 1);
  const rel = Array.from(related.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const k = view.sel.length;
  const what = pat
    ? `matching ${patternText(pat.p)}`
    : k === 1
      ? `tagged #${view.sel[0]}`
      : view.mode === 'any'
        ? `with any of ${k} tags`
        : `with all ${k} tags`;

  res.innerHTML = `<div class="tg-card-main"><div class="tg-res-head">
      <div class="tg-rt"><h2>${notes.length} note${notes.length === 1 ? '' : 's'}</h2>${
        pat ? `<span class="tg-pat-rd sm" title="${attr(what)}">matching ${patternHTML(pat.p)}</span>` : `<span title="${attr(what)}">${esc(what)}</span>`
      }</div>
      ${
        k > 1
          ? `<div class="tg-seg tg-mode" role="group" aria-label="Notes must carry">
        <button data-m="all" aria-pressed="${view.mode === 'all'}" class="${view.mode === 'all' ? 'on' : ''}" title="Notes that carry every tag">All tags</button>
        <button data-m="any" aria-pressed="${view.mode === 'any'}" class="${view.mode === 'any' ? 'on' : ''}" title="Notes that carry at least one tag">Any tag</button></div>`
          : ''
      }
    </div>
    ${
      rel.length && !pat
        ? `<div class="tg-related"><span>Related</span>${rel
            .map(
              ([t, n]) =>
                `<button class="tg-mini" data-add="${attr(t)}" style="--tc:${hashColor(t)}" title="${
                  view.mode === 'any' ? `Add #${attr(t)} to the filter` : `Narrow to notes also tagged #${attr(t)}`
                }"><i></i>${esc(t)} <em>${n}</em></button>`,
            )
            .join('')}</div>`
        : ''
    }
    <div class="tg-notes" role="list">${
      notes
        .map(
          (n) => `<div class="tg-note${card?.isOpen && card.path === n.path ? ' on' : ''}" role="listitem" tabindex="0" data-path="${attr(n.path)}" title="Preview (double-click opens the note)">
        <span class="tg-note-ico" aria-hidden="true">${NOTE_ICON}</span>
        <div class="tg-note-main"><b>${esc(n.name)}</b><small>${esc(n.folder || folderOf(n.path))} · ${esc(relTs(n.mtime))}</small></div>
        <div class="tg-note-tags">${(tagsOf.get(n.path) || [])
          .filter((t) => !used.has(t.toLowerCase()))
          .slice(0, 6)
          .map((t) => `<span style="--tc:${hashColor(t)}"><i></i>${esc(t)}</span>`)
          .join('')}</div>
        <button type="button" class="tg-open" data-open="${attr(n.path)}" aria-label="Open ${attr(n.name)}" title="Open the note">${OPEN_ICON}</button>
      </div>`,
        )
        .join('') ||
      `<div class="empty">${pat ? 'No note matches this pattern.' : view.mode === 'any' ? 'No note carries these tags.' : 'No note carries all of these tags.'}</div>`
    }</div></div>`;

  res.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => {
    b.onclick = () => {
      view.mode = b.dataset.m === 'any' ? 'any' : 'all';
      drawBulk();
      drawFx();
      drawResults();
      focusIn(res, `[data-m="${view.mode}"]`);
    };
  });
  res.querySelectorAll<HTMLElement>('[data-add]').forEach((b) => {
    b.onclick = () => {
      view.sel = [...view.sel, b.dataset.add || ''];
      redraw();
    };
  });
  res.querySelectorAll<HTMLElement>('.tg-note').forEach((row) => {
    const path = row.dataset.path || '';
    row.onclick = (e) => {
      if ((e.target as HTMLElement).closest('[data-open]')) return;
      void preview(path, false);
    };
    row.ondblclick = (e) => {
      if ((e.target as HTMLElement).closest('[data-open]')) return;
      hooks.openNote(path);
    };
    row.onkeydown = (e) => {
      // Keys on the Open button inside the row are the button's own.
      if (e.target !== row) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        void preview(path, true);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = (e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling) as HTMLElement | null;
        next?.focus();
      }
    };
  });
  res.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      hooks.openNote(b.dataset.open || '');
    };
  });
}

let card: NodeCard | null = null;
/** Sheet below this width or on touch screens; a side panel otherwise. */
const SHEET_Q = '(max-width:1100px), (hover:none) and (pointer:coarse)';

function ensureCard(): NodeCard {
  if (card && card.el.isConnected) return card;
  const page = $('#view-tags');
  // A sibling layer over the page, so it does not scroll with the list.
  const layer = document.createElement('div');
  layer.className = 'tg-ncl';
  page.after(layer);
  card = new NodeCard({
    root: layer,
    sheetQuery: SHEET_Q,
    focusFolder: (f) => {
      hooks.go('vault');
      nav.selectFolder(!f || f === 'Root' ? '' : f);
    },
    pick: (p) => void preview(p, false),
    links: (p) => linksOf(p),
    folderItems: () => [],
    tag: (t) => {
      view.sel = [t];
      view.mode = 'any';
      redraw();
    },
    tagLabel: (t) => `Show the notes tagged #${t}`,
    closed: () => cardClosed(),
  });
  window.matchMedia(SHEET_Q).addEventListener('change', dock);
  new ResizeObserver(dock).observe(page);
  return card;
}

function linksOf(path: string): { out: CardLink[]; in: CardLink[] } {
  if (!graph) return { out: [], in: [] };
  const names = new Map(allNotes().map((n) => [n.path, n.name]));
  const link = (p: string): CardLink => ({ path: p, name: names.get(p) || p.split('/').pop() || p, color: colorOf(p), degree: graph!.degree.get(p) || 0 });
  const rank = (a: CardLink, b: CardLink): number => (b.degree || 0) - (a.degree || 0);
  const out = (graph.out.get(path) || []).filter((p) => names.has(p)).map(link).sort(rank);
  const outs = new Set(out.map((l) => l.path));
  const inc = (graph.inc.get(path) || []).filter((p) => names.has(p) && !outs.has(p)).map(link).sort(rank);
  return { out, in: inc };
}

function colorOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return graph?.color.get(path) || folderColor(cut > 0 ? path.slice(0, cut) : '');
}

async function preview(path: string, byKey: boolean): Promise<void> {
  const n = allNotes().find((x) => x.path === path);
  if (!n) {
    hooks.openNote(path);
    return;
  }
  const c = ensureCard();
  await ensureGraph();
  if (state.page !== 'tags') return;
  c.showNote(path, n.name, n.folder || 'Root', colorOf(path), tagsOfNote(path));
  markRow();
  dock();
  if (byKey) c.el.querySelector<HTMLElement>('[data-a=open]')?.focus();
}

/** After a redraw: the open card follows its note, or closes when it is gone. */
function refreshCard(): void {
  if (!card?.isOpen || !card.path) return;
  const n = allNotes().find((x) => x.path === card!.path);
  if (!n) {
    card.close();
    cardClosed();
    return;
  }
  card.showNote(n.path, n.name, n.folder || 'Root', colorOf(n.path), tagsOfNote(n.path));
  markRow();
  dock();
}

function cardClosed(): void {
  const page = document.getElementById('view-tags');
  const last = page?.querySelector<HTMLElement>('.tg-note.on');
  const hadFocus = !!card && card.el.contains(document.activeElement);
  markRow();
  dock();
  if (hadFocus && last) last.focus();
}

function markRow(): void {
  const p = card?.isOpen ? card.path : null;
  document.querySelectorAll<HTMLElement>('#view-tags .tg-note').forEach((r) => r.classList.toggle('on', r.dataset.path === p));
}

/** Wide screens: the page makes room for the side panel; narrower ones let it float over. */
function dock(): void {
  const page = document.getElementById('view-tags');
  if (!page) return;
  const room = !!card?.isOpen && !card.sheet && page.clientWidth >= 1090;
  page.classList.toggle('tg-docked', room);
}

let rpc = 0;

/** One MCP tool call as the signed-in owner (POST /mcp, the same tools agents use). */
async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const r = await apiPost<{ result?: { content?: { text?: string }[]; isError?: boolean }; error?: { message?: string } }>('/mcp', {
    jsonrpc: '2.0',
    id: ++rpc,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  if (r.error) throw new Error(r.error.message || 'the server refused');
  const text = r.result?.content?.[0]?.text || '';
  if (r.result?.isError) throw new Error(text.replace(new RegExp('^' + name + ':\\s*'), '') || 'it failed');
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** Run a bulk edit with redraws held back, then read the vault again once. */
async function bulk(run: () => Promise<void>): Promise<void> {
  busy = true;
  try {
    await run();
  } finally {
    busy = false;
    dropIndex();
    try {
      await hooks.loadCore();
    } catch {
      /* loadCore reports its own errors */
    }
    if (state.page === 'tags') await renderTags();
  }
}

const count = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
const tagList = (tags: string[]): string => {
  const shown = tags.slice(0, 4).map((t) => `<b>#${esc(t)}</b>`);
  return (tags.length > 4 ? [...shown, `${tags.length - 4} more`] : shown).join(', ').replace(/, ([^,]*)$/, tags.length > 1 ? ' and $1' : ', $1');
};

function askMerge(tags: string[]): void {
  if (!map) return;
  const ranked = tags.slice().sort((a, b) => (map!.get(b)?.length || 0) - (map!.get(a)?.length || 0));
  const notes = untagPlan(map, tags).length;
  typedConfirm({
    title: `Merge ${tags.length} tags`,
    body: `<p>Every note tagged ${tagList(ranked)} gets one tag instead (${count(notes, 'note')}). Inline #tags in the text change too. There is no one-step undo; each note keeps its history.</p>
      <div class="tg-into" role="radiogroup" aria-label="Merge into">${ranked
        .map(
          (t, i) =>
            `<label class="tg-into-o"><input type="radio" name="tgInto" value="${attr(t)}"${i ? '' : ' checked'}><i style="--tc:${hashColor(t)}"></i><span>Keep <b>#${esc(t)}</b></span><em>${count(
              map!.get(t)?.length || 0,
              'note',
            )}</em></label>`,
        )
        .join('')}
        <label class="tg-into-o"><input type="radio" name="tgInto" value=""><i class="new"></i><span>A new name</span></label>
        <div class="field tg-into-new"><input type="text" placeholder="new-tag" aria-label="New tag name" autocomplete="off" spellcheck="false" autocapitalize="off"></div></div>`,
    word: 'MERGE',
    confirmLabel: 'Merge',
    run: async () => {
      const box = document.getElementById('modalHost');
      const v = box?.querySelector<HTMLInputElement>('input[name=tgInto]:checked')?.value ?? '';
      const into = (v || box?.querySelector<HTMLInputElement>('.tg-into-new input')?.value || '').trim().replace(/^#+/, '');
      if (!validTag(into)) {
        notify('Give the tag a name: letters, digits and - _ / . only.', 'warn');
        box?.querySelector<HTMLInputElement>('.tg-into-new input')?.focus();
        return;
      }
      Modal.close();
      await doMerge(tags, into);
    },
  });
  // Typing a new name picks that option.
  const box = document.getElementById('modalHost');
  const name = box?.querySelector<HTMLInputElement>('.tg-into-new input');
  const radio = box?.querySelector<HTMLInputElement>('input[name=tgInto][value=""]');
  if (name && radio) name.addEventListener('focus', () => (radio.checked = true));
}

async function doMerge(tags: string[], into: string): Promise<void> {
  const sources = mergeSources(tags, into);
  if (!sources.length) return;
  const changed = new Set<string>();
  let failed = '';
  await bulk(async () => {
    for (const [i, a] of sources.entries()) {
      notify(`Merging tags… ${i + 1} of ${sources.length}`, 'info', 60000, undefined, { group: 'tg-bulk' });
      try {
        const r = await callTool<{ notes?: string[] }>('merge_tag', { a, b: into });
        (r.notes || []).forEach((p) => changed.add(p));
      } catch (e) {
        failed = `Could not merge #${a}: ${(e as Error).message}`;
        break;
      }
    }
    view.sel = Array.from(new Set(view.sel.map((t) => (sources.includes(t) ? into : t))));
    view.picked = new Set([into]);
    view.anchor = null;
  });
  if (failed) notify(failed, 'err', 0, undefined, { group: 'tg-bulk' });
  else notify(`Merged ${count(sources.length, 'tag')} into #${into} · ${count(changed.size, 'note')} changed`, 'ok', 5000, undefined, { group: 'tg-bulk' });
}

function askRename(tag: string): void {
  if (!map) return;
  const n = map.get(tag)?.length || 0;
  const id = 'tgRenameIn';
  Modal.open({
    title: `Rename #${tag}`,
    body: `<p class="tg-dlg-p">Every note tagged #${esc(tag)} (${count(n, 'note')}) gets the new name, inline #tags in the text too.</p>
      ${Modal.field('New name', id, { value: tag, ph: 'new-tag' })}<p class="tg-dlg-hint" id="tgRenameHint" aria-live="polite"></p>`,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      {
        label: 'Rename',
        cls: 'primary',
        run: async (b) => {
          const v = (b.querySelector<HTMLInputElement>('#' + id)?.value || '').trim().replace(/^#+/, '');
          if (!validTag(v) || v === tag) {
            b.querySelector<HTMLInputElement>('#' + id)?.focus();
            return;
          }
          Modal.close();
          await doRename(tag, v);
        },
      },
    ],
    onOpen: (b) => {
      const input = b.querySelector<HTMLInputElement>('#' + id)!;
      const hint = b.querySelector<HTMLElement>('#tgRenameHint')!;
      const sync = (): void => {
        const v = input.value.trim().replace(/^#+/, '');
        const clash = v.toLowerCase() !== tag.toLowerCase() ? Array.from(map!.keys()).find((t) => t.toLowerCase() === v.toLowerCase()) : undefined;
        hint.classList.toggle('bad', !!v && !validTag(v));
        hint.textContent = !v
          ? ''
          : !validTag(v)
            ? 'Only letters, digits and - _ / . can be used.'
            : clash
              ? `#${clash} exists already: the two tags become one, which cannot be split again.`
              : '';
      };
      input.addEventListener('input', sync);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          b.parentElement?.querySelector<HTMLButtonElement>('.modal-foot .btn.primary')?.click();
        }
      });
      setTimeout(() => input.select(), 60);
    },
  });
}

async function doRename(tag: string, to: string): Promise<void> {
  let msg = '';
  let ok = false;
  await bulk(async () => {
    try {
      const r = await callTool<{ notes?: string[] }>('rename_tag', { old: tag, new: to });
      ok = true;
      msg = `Renamed #${tag} to #${to} · ${count((r.notes || []).length, 'note')} changed`;
      view.sel = view.sel.map((t) => (t === tag ? to : t));
      view.picked = new Set([to]);
      view.anchor = null;
    } catch (e) {
      msg = `Could not rename #${tag}: ${(e as Error).message}`;
    }
  });
  notify(msg, ok ? 'ok' : 'err', ok ? 5000 : 0);
}

function askRemove(tags: string[]): void {
  if (!map) return;
  const plan = untagPlan(map, tags);
  typedConfirm({
    title: tags.length === 1 ? `Remove #${tags[0]} from its notes` : `Remove ${tags.length} tags from their notes`,
    body: `<p>${tagList(tags)} ${tags.length === 1 ? 'comes' : 'come'} off ${count(plan.length, 'note')}. Tags written inline in a note's text (#like-this) stay; edit those notes to take them out. You can undo this right after.</p>`,
    items: plan.map((p) => allNotes().find((n) => n.path === p.path)?.name || p.path),
    word: 'REMOVE',
    confirmLabel: `Remove from ${count(plan.length, 'note')}`,
    run: async () => {
      Modal.close();
      await doRemove(tags, plan);
    },
  });
}

async function doRemove(tags: string[], plan: { path: string; tags: string[] }[]): Promise<void> {
  const undo: { path: string; tags: string[] }[] = [];
  let inline = 0;
  let failed = '';
  await bulk(async () => {
    for (const [i, p] of plan.entries()) {
      if (i % 3 === 0) notify(`Removing tags… ${i + 1} of ${plan.length}`, 'info', 60000, undefined, { group: 'tg-bulk' });
      try {
        const r = await callTool<{ tags?: string[] }>('remove_tags', { path: p.path, tags: p.tags.join(',') });
        const gone = removedTags(p.tags, r.tags || []);
        if (gone.length) undo.push({ path: p.path, tags: gone });
        if (gone.length < p.tags.length) inline++;
      } catch (e) {
        failed = `Stopped at ${p.path.split('/').pop()}: ${(e as Error).message}`;
        break;
      }
    }
    view.picked = new Set();
    view.anchor = null;
  });
  const again = undo.length
    ? {
        label: 'Undo',
        run: async () => {
          await bulk(async () => {
            for (const u of undo) await callTool('add_tags', { path: u.path, tags: u.tags.join(',') }).catch(() => undefined);
          });
          notify(`Put the tags back on ${count(undo.length, 'note')}`, 'ok', 4200, undefined, { group: 'tg-bulk' });
        },
      }
    : undefined;
  if (failed) notify(failed, 'err', 0, again, { group: 'tg-bulk' });
  else
    notify(
      `Removed ${tags.length === 1 ? '#' + tags[0] : count(tags.length, 'tag')} from ${count(undo.length, 'note')}${inline ? ` · ${count(inline, 'note')} still say it inline` : ''}`,
      'ok',
      8000,
      again,
      { group: 'tg-bulk' },
    );
}

let wired = false;
function wireOnce(): void {
  if (wired) return;
  wired = true;
  onNavigate((page) => {
    if (page === 'tags' || !card?.isOpen) return;
    card.close();
    cardClosed();
  });
  // Esc: close the card first, then clear the ticks. Dialogs and inputs keep their own Esc.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || state.page !== 'tags') return;
    if (!document.getElementById('modalHost')?.classList.contains('hidden')) return;
    const t = e.target;
    // The tag search clears itself first (and stops the key) while it has text.
    if (t instanceof Element && t.closest('input:not([type=checkbox]):not(#tgQ),textarea,[contenteditable=true]')) return;
    if (card?.isOpen) {
      card.close(true);
      cardClosed();
    } else if (view.picked.size) {
      clearPicked();
      ($('#tgAll') as HTMLInputElement | null)?.focus();
    } else return;
    e.preventDefault();
  });
  // A sheet folds to its name when the page behind it is tapped, as on the maps.
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!card?.isOpen || !card.sheet || state.page !== 'tags') return;
      const t = e.target;
      if (t instanceof Element && t.closest('#view-tags') && !t.closest('.tg-note')) card.collapse();
    },
    { capture: true },
  );
}

function focusIn(root: HTMLElement, sel: string): void {
  root.querySelector<HTMLElement>(sel)?.focus();
}

function cssEsc(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

const ico = (d: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SEARCH = ico('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>');
const REFRESH = ico('<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 5v6h-6"/>');
const TAG_ICON = ico('<path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>');
const NOTE_ICON = ico('<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>');
const X_ICON = ico('<path d="M6 6l12 12M18 6 6 18"/>');
const OPEN_ICON = ico('<path d="M14 4h6v6M20 4l-8 8"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>');
const PATTERN_ICON = ico('<path d="M4 6h6M14 6h6M4 18h6M14 18h6"/><path d="M7 6v12M17 6v12"/><path d="M10 12h4"/>');
const MERGE_ICON = ico('<path d="M6 4v5a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6"/><path d="M18 4v5a6 6 0 0 1-3 5.2"/><path d="m15 18 3 3 3-3"/>');

const TAGS_CSS = `
.tg{max-width:1200px;margin:0 auto;padding:8px 8px 0;container:tg/inline-size}
.tg-head{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.tg-title{flex:1;min-width:0}
.tg-title h1{margin:0;font-size:26px;font-weight:650;letter-spacing:-.02em;line-height:1.25}
.tg-title p{margin:3px 0 0;font-size:14px;color:var(--muted);font-variant-numeric:tabular-nums}
.tg-rebuild{height:38px;border-radius:10px;font-size:13.5px;font-weight:600;flex:none}
.tg-rebuild svg{width:16px;height:16px}
.tg-prog{height:2px;background:var(--line);border-radius:2px;overflow:hidden;margin:-14px 0 12px;transition:opacity .4s}
.tg-prog.done{opacity:0}
.tg-prog i{display:block;height:100%;background:var(--brand-mark,var(--accent));transition:width .2s}
.tg svg{flex:none}
.tg-bulk{position:sticky;top:-16px;z-index:4;box-shadow:0 -8px 0 8px var(--surface-0);display:flex;align-items:center;gap:6px;margin:0 0 16px;padding:4px 4px 4px 14px;border-radius:12px;
  background:color-mix(in srgb,var(--fg) 5%,var(--surface-0));font-size:13px;color:var(--text-2);animation:tgIn .16s var(--ease-out,ease-out)}
.tg-bulk[hidden]{display:none}
.tg-bn{white-space:nowrap;margin-right:6px}
.tg-hacts{display:flex;align-items:center;gap:8px}
.tg-patbtn svg{width:16px;height:16px}
.tg-chip.pat{--tc:var(--accent);max-width:100%}
.tg-chip.pat .t.tg-pat-edit{max-width:min(64ch,calc(100vw - 140px))}
.tg-chip.pat>svg{width:14px;height:14px;flex:none;color:var(--accent)}
.tg-pat-edit{border:0;background:none;padding:0;font:inherit;color:inherit;cursor:pointer;max-width:min(52ch,60vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-pat-edit:hover{text-decoration:underline;text-underline-offset:3px}
.tg-linkbtn{border:0;background:none;padding:0;font:inherit;color:var(--accent);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.tg-pat{display:flex;flex-direction:column;gap:10px}
.tg-pat-l{font-size:13px;color:var(--text-2)}
.tg-pat-ops{display:flex;flex-wrap:wrap;gap:6px}
.tg-pat-op{height:30px;min-width:44px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:none;color:var(--text-2);font:600 12.5px/1 var(--font);cursor:pointer}
.tg-pat-op:hover{color:var(--fg);border-color:var(--line-strong)}
.tg-pat-sug{display:flex;flex-wrap:wrap;gap:6px;min-height:0}
.tg-pat-sug:empty{display:none}
.tg-pat-out{font-size:13px;line-height:1.5;color:var(--muted);padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--fg) 4%,transparent)}
.tg-pat-out.ok b{color:var(--fg);font-weight:600}
.tg-pat-out.bad{color:var(--danger);background:var(--danger-soft)}
.tg-pat-out small{display:block;margin-top:4px;color:var(--warn,#f59e0b)}
.tg-pat-out.ok{display:flex;flex-direction:column;gap:8px;color:var(--text-2)}
.tg-pat-n b{font-size:15px}
.tg-nw{white-space:nowrap}
.tg-pat-sh{font-size:12px;color:var(--muted);margin-right:2px;align-self:center}
.tg-pf{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:48px;padding:7px 10px;border-radius:12px;border:1px solid var(--line-strong);background:var(--surface-1);cursor:text}
.tg-pf:focus-within{border-color:var(--accent-line,var(--accent))}
.tg-pf-toks{display:contents}
.tg-pf-in{flex:1 1 120px;min-width:120px;height:32px;border:0;background:none;outline:none;color:var(--fg);font:500 14.5px/1 var(--font)}
.tg-pt{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 6px 0 10px;border-radius:999px;font-size:13px;font-weight:600;white-space:nowrap}
.tg-pt.tag{color:var(--fg);background:color-mix(in srgb,var(--tc) 14%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--tc) 35%,transparent)}
.tg-pt.tag i{width:7px;height:7px;border-radius:50%;background:var(--tc)}
.tg-pt.tag button{display:grid;place-items:center;width:20px;height:20px;border:0;border-radius:50%;background:none;color:var(--muted);cursor:pointer;padding:0}
.tg-pt.tag button:hover{color:var(--fg);background:color-mix(in srgb,var(--fg) 10%,transparent)}
.tg-pt.tag button svg{width:12px;height:12px}
.tg-pt.op{padding:0 10px;border:0;cursor:pointer;font:700 11px/1 var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--accent);background:var(--accent-soft,rgba(94,234,212,.12))}
.tg-pt.op:hover{box-shadow:inset 0 0 0 1px var(--accent-line,var(--accent))}
.tg-pt.op.not{color:var(--danger);background:var(--danger-soft)}
.tg-pt.op.par{color:var(--text-2);background:color-mix(in srgb,var(--fg) 7%,transparent);font-size:14px;letter-spacing:0}
.tg-pt:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.tg-pat-op.clr{margin-left:auto;color:var(--muted)}
.tg-pat-rd{display:inline-flex;flex-wrap:wrap;align-items:center;gap:5px}
.tg-pv{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.tg-pv.tag{height:24px;padding:0 9px;border-radius:999px;font-size:12.5px;font-weight:600;color:var(--fg);background:color-mix(in srgb,var(--tc) 14%,transparent)}
.tg-pv.tag i{width:6px;height:6px;border-radius:50%;background:var(--tc)}
.tg-pv.op{font:700 10.5px/1 var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}
.tg-pv.op.not{color:var(--danger)}
.tg-pv.grp{flex-wrap:wrap;padding:2px 4px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--line-strong)}
.tg-pat-rd.sm .tg-pv.tag{height:22px;font-size:12px}
.tg-chip.pat .tg-pat-edit{display:inline-flex;flex-wrap:nowrap;align-items:center;gap:5px;overflow:hidden}
.tg-chip.pat .tg-pv.tag{height:20px;padding:0 7px;font-size:12px}
.tg-bulk .btn.tg-bjump{display:none}
.tg-bn b{color:var(--fg);font-variant-numeric:tabular-nums}
.tg-bn small{font-size:12.5px;color:var(--muted)}
.tg-bacts{display:flex;align-items:center;gap:2px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
.tg-bacts::-webkit-scrollbar{display:none}
.tg-bulk .btn{height:32px;padding:0 11px;border-radius:8px;font-size:13px;font-weight:550;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;flex:none}
.tg-bulk .btn svg{width:15px;height:15px}
:root .tg-bulk .btn.ghost.tg-danger{color:var(--danger)}
:root .tg-bulk .btn.ghost.tg-danger:hover{background:var(--danger-soft);color:var(--danger)}
.tg-bulk .btn.tg-bx{width:32px;padding:0;justify-content:center;margin-left:auto}
@keyframes tgIn{from{opacity:0;transform:translateY(-3px)}}
@media (prefers-reduced-motion:reduce){.tg-bulk{animation:none}}
.tg-body{display:grid;grid-template-columns:340px minmax(0,1fr);gap:20px;align-items:start}
.tg-side{background:var(--surface-1);border:1px solid var(--line);border-radius:14px;position:sticky;top:0;display:flex;flex-direction:column;
  max-height:calc(100vh - 190px);overflow:hidden;min-width:0}
.tg:has(.tg-bulk:not([hidden])) .tg-side{top:40px;max-height:calc(100vh - 230px)}
.tg-tools{display:flex;flex-direction:column;gap:10px;padding:16px 16px 12px;border-bottom:1px solid var(--line)}
.tg-search{display:flex;align-items:center;gap:9px;height:40px;padding:0 4px 0 12px;border:1px solid transparent;border-radius:10px;
  background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--muted);transition:border-color .15s,background .15s,box-shadow .15s}
.tg-search:hover{border-color:var(--line)}
.tg-search>svg{width:16px;height:16px}
.tg-search input{border:0;background:none;outline:none;color:var(--fg);font:inherit;font-size:14px;flex:1;min-width:0;height:100%;padding:0}
.tg-search input::-webkit-search-cancel-button{display:none}
.tg-search input:focus,.tg-search input:focus-visible{box-shadow:none;outline:none}
.tg-search:focus-within{border-color:var(--line-strong);background:var(--surface-1);box-shadow:0 0 0 3px color-mix(in srgb,var(--fg) 6%,transparent);color:var(--fg)}
.tg-qx{display:grid;place-items:center;width:30px;height:30px;border:0;border-radius:7px;background:none;color:var(--muted);cursor:pointer;flex:none}
.tg-qx[hidden]{display:none}
.tg-qx svg{width:14px;height:14px}
.tg-qx:hover{background:var(--hover);color:var(--fg)}
.tg-seg{display:grid;grid-template-columns:1fr 1fr;gap:2px;height:36px;border-radius:10px;padding:3px;background:var(--seg-track,var(--surface-2));box-sizing:border-box}
.tg-seg button{border:0;background:none;color:var(--muted);font:inherit;font-size:13px;font-weight:550;border-radius:7px;cursor:pointer;transition:color .15s,background .15s;white-space:nowrap;padding:0 10px}
.tg-seg button:hover{color:var(--fg)}
.tg-seg button.on{background:var(--seg-thumb,var(--surface-1));color:var(--fg);box-shadow:0 1px 2px rgba(15,23,42,.08),0 0 0 1px var(--line)}
.tg-seg button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.tg-lh{display:flex;align-items:center;justify-content:space-between;gap:10px;height:40px;padding:0 16px 0 12px;border-bottom:1px solid var(--line);font-size:12.5px;color:var(--muted)}
.tg-lh[hidden]{display:none}
.tg-lh>span{font-variant-numeric:tabular-nums;white-space:nowrap}
.tg-all{display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--text-2);font-weight:500}
.tg-check{display:grid;place-items:center;width:28px;height:28px;flex:none;cursor:pointer;border-radius:7px}
.tg-check input{width:16px;height:16px;margin:0;accent-color:var(--fg);cursor:pointer}
.tg-check:hover{background:var(--hover)}
.tg-cloud{display:flex;flex-direction:column;padding:6px;overflow:auto;min-height:0;scrollbar-width:thin}
.tg-tag{position:relative;display:grid;grid-template-columns:28px minmax(0,1fr);align-items:center;gap:2px;padding-left:4px;border-radius:9px;transition:background .12s}
.tg-tag-b{display:grid;grid-template-columns:auto minmax(0,1fr) 48px 30px;align-items:center;gap:10px;width:100%;min-height:42px;padding:0 10px 0 6px;min-width:0;
  border:0;border-radius:8px;background:none;cursor:pointer;font:inherit;font-size:14px;font-weight:500;color:var(--text-2);text-align:left;transition:color .12s}
.tg-tag i,.tg-card b i,.tg-chip i,.tg-note-tags i,.tg-mini i,.tg-into-o i{width:7px;height:7px;border-radius:50%;background:var(--tc);flex:none;display:inline-block}
.tg-tag span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-tag s{display:block;height:4px;border-radius:2px;background:color-mix(in srgb,var(--fg) 7%,transparent);overflow:hidden;text-decoration:none;position:relative}
.tg-tag s::after{content:"";position:absolute;inset:0 auto 0 0;width:calc(var(--w) * 100%);border-radius:2px;background:color-mix(in srgb,var(--tc) 70%,transparent)}
.tg-tag em{font-style:normal;font-size:12.5px;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}
.tg-tag:hover{background:color-mix(in srgb,var(--fg) 4%,transparent)}
.tg-tag:hover .tg-tag-b{color:var(--fg)}
.tg-tag.picked{background:color-mix(in srgb,var(--fg) 3.5%,transparent)}
.tg-tag.on{background:color-mix(in srgb,var(--fg) 6%,transparent)}
.tg-tag.on .tg-tag-b{color:var(--fg);font-weight:600}
.tg-tag.on::before{content:"";position:absolute;left:-6px;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--brand-mark,var(--accent))}
.tg-tag-b:focus-visible,.tg-note:focus-visible,.tg-card:focus-visible,.tg-check:focus-within,.tg-open:focus-visible,.tg-qx:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.tg-check input:focus-visible{outline:none}
.tg-results{min-width:0;display:flex;flex-direction:column;gap:12px}
.tg-fx{display:flex;align-items:flex-start;gap:8px 12px;min-width:0}
.tg-fx[hidden]{display:none}
.tg-chips{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:1 1 auto;min-width:0}
.tg-chip{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 4px 0 12px;border-radius:99px;border:1px solid var(--line-strong);flex:none;
  background:var(--surface-1);font-size:13px;font-weight:550;color:var(--fg);white-space:nowrap;max-width:min(240px,100%);min-width:0;box-sizing:border-box}
.tg-chip .t{overflow:hidden;text-overflow:ellipsis;min-width:0}
.tg-chip.q svg{width:14px;height:14px;color:var(--muted);margin-left:-2px}
.tg-chip .x{display:grid;place-items:center;width:24px;height:24px;border:0;border-radius:50%;background:none;color:var(--muted);cursor:pointer;flex:none;padding:0}
.tg-chip .x svg{width:13px;height:13px}
.tg-chip .x:hover{background:var(--hover);color:var(--fg)}
.tg-chip .x:focus-visible{outline:2px solid var(--accent);outline-offset:0}
.tg-and{font-size:12.5px;color:var(--muted)}
.tg-cj{display:inline-flex;align-items:center;gap:8px;min-width:0;max-width:100%}
.tg-fx-end{display:flex;align-items:center;gap:12px;flex:none;height:32px;margin-left:auto}
.tg-fn{font-size:12.5px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.tg-clear{border:0;background:none;font:inherit;font-size:12.5px;font-weight:600;color:var(--fg);padding:6px 2px;white-space:nowrap;cursor:pointer}
.tg-clear:hover{text-decoration:underline;text-underline-offset:3px}
.tg-clear:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
.tg-hint,.tg-card-main{background:var(--surface-1);border:1px solid var(--line);border-radius:14px}
.tg-hint{padding:24px}
.tg-hint-head{display:flex;gap:16px;align-items:flex-start}
.tg-hint-ico{display:grid;place-items:center;flex:none;width:44px;height:44px;border-radius:12px;background:linear-gradient(180deg,#17202e,#0b0f17);color:#5eead4}
.tg-hint-ico svg{width:20px;height:20px}
.tg-hint h2{margin:2px 0 4px;font-size:15px;font-weight:600}
.tg-hint p{margin:0;color:var(--muted);font-size:13.5px;line-height:1.55}
.tg-sub{margin:28px 0 12px;font-size:12.5px;font-weight:500;color:var(--muted)}
.tg-top{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.tg-card{display:flex;flex-direction:column;text-align:left;border:1px solid var(--line);background:var(--surface-1);color:var(--fg);min-width:0;
  font:inherit;padding:16px 18px 14px;border-radius:14px;cursor:pointer;transition:border-color .15s}
.tg-card b{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;margin-bottom:8px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-card dl{display:grid;grid-template-columns:auto 1fr;margin:0;padding-top:4px;border-top:1px solid var(--line);font-size:13px}
.tg-card dt{color:var(--muted);line-height:32px}
.tg-card dd{margin:0;text-align:right;line-height:32px;color:var(--text-2);font-variant-numeric:tabular-nums}
.tg-card small{font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-top:8px;border-top:1px solid var(--line)}
.tg-card:hover{border-color:var(--line-strong)}
.tg-res-head{display:flex;align-items:center;gap:10px 16px;flex-wrap:wrap;padding:16px 16px 14px 20px}
.tg-rt{display:flex;align-items:baseline;gap:10px;flex:1 1 220px;min-width:0}
.tg-rt h2{margin:0;font-size:17px;font-weight:650;letter-spacing:-.01em;white-space:nowrap;font-variant-numeric:tabular-nums}
.tg-rt span{font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.tg-mode{height:34px;flex:none}
.tg-related{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:0 16px 14px 20px;font-size:12.5px;color:var(--muted)}
.tg-related>span{margin-right:4px}
.tg-mini{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line-strong);background:none;color:var(--text-2);font:inherit;font-size:12.5px;height:28px;
  padding:0 10px;border-radius:99px;cursor:pointer;max-width:100%;min-width:0}
.tg-mini em{font-style:normal;color:var(--muted)}
.tg-mini:hover{background:var(--hover);color:var(--fg)}
.tg-notes{border-top:1px solid var(--line)}
.tg-note{position:relative;display:grid;grid-template-columns:36px minmax(0,1fr) minmax(0,auto) auto;align-items:center;gap:14px;min-height:60px;padding:10px 12px 10px 20px;
  border-top:1px solid var(--line);cursor:pointer;transition:background .12s}
.tg-note:first-child{border-top:0}
.tg-note:last-child{border-radius:0 0 13px 13px}
.tg-note:hover{background:color-mix(in srgb,var(--fg) 3%,transparent)}
.tg-note.on{background:color-mix(in srgb,var(--fg) 5.5%,transparent)}
.tg-note.on::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:0 3px 3px 0;background:var(--brand-mark,var(--accent))}
.tg-note-ico{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--muted)}
.tg-note-ico svg{width:17px;height:17px}
.tg-note-main{min-width:0;display:flex;flex-direction:column;gap:2px}
.tg-note-main b{font-weight:550;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-note-main small{font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-note-tags{display:flex;gap:4px 12px;flex-wrap:wrap;justify-content:flex-end;max-width:260px;min-width:0}
.tg-note-tags span{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-2);white-space:nowrap}
.tg-open{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:8px;background:none;color:var(--muted);cursor:pointer}
.tg-open svg{width:16px;height:16px}
.tg-open:hover{background:var(--hover);color:var(--fg)}
.tg .empty{color:var(--muted);font-size:13.5px;padding:24px;text-align:center}
.tg-ncl{position:absolute;inset:0;z-index:8;pointer-events:none}
.tg-ncl>.nc{pointer-events:auto}
#view-tags.hidden~.tg-ncl{display:none}
#view-tags.tg-docked{padding-right:408px}
.tg-into{display:flex;flex-direction:column;gap:2px;padding:4px;border:1px solid var(--line);border-radius:10px}
.tg-into-o{display:flex;align-items:center;gap:10px;min-height:38px;padding:0 10px;border-radius:8px;cursor:pointer;font-size:13.5px;color:var(--text-2);min-width:0}
.tg-into-o:hover{background:var(--hover)}
.tg-into-o input{margin:0;accent-color:var(--fg);flex:none}
.tg-into-o span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-into-o b{color:var(--fg);font-weight:600}
.tg-into-o em{font-style:normal;font-size:12.5px;color:var(--muted);white-space:nowrap}
.tg-into-o i.new{background:none;border:1px dashed var(--muted)}
.tg-into .field.tg-into-new{margin:2px 6px 6px 34px}
.tg-dlg-p{margin:0 0 12px;color:var(--text-2);line-height:1.55}
.tg-dlg-hint{margin:8px 0 0;font-size:12.5px;color:var(--muted);min-height:1em}
.tg-dlg-hint.bad{color:var(--danger)}
.tg-dlg-hint:empty{display:none}
@container tg (max-width:900px){.tg-body{grid-template-columns:300px minmax(0,1fr)}.tg-note-tags{display:none}.tg-note{grid-template-columns:36px minmax(0,1fr) auto}}
@container tg (max-width:760px){
  .tg-body{grid-template-columns:260px minmax(0,1fr);gap:16px}
  .tg-tag-b{grid-template-columns:auto minmax(0,1fr) 36px 28px;gap:8px}
  .tg-bulk{flex-wrap:wrap;row-gap:2px;padding:6px 4px 4px 12px}
  .tg-bn{flex:1 1 auto}
  .tg-bacts{order:3;flex:1 1 100%;margin:0 0 0 -8px}
  .tg-bulk .btn.tg-bx{order:2}
  .tg:has(.tg-bulk:not([hidden])) .tg-side{top:80px}
}
@container tg (max-width:600px){
  .tg-body{grid-template-columns:minmax(0,1fr);gap:16px}
  .tg-tag-b{grid-template-columns:auto minmax(0,1fr) 56px 32px;gap:10px}
  .tg-side{position:static;max-height:min(420px,52vh)}
  .tg-fx{flex-wrap:wrap}
  .tg-bacts{flex-wrap:wrap;overflow:visible}
  .tg-bulk .btn.tg-bjump{display:inline-flex;color:var(--accent);font-weight:600}
}
@media (max-width:760px){.tg-bulk{position:static;box-shadow:none}}
@media (max-width:860px){
  .tg{padding:0}
  .tg-head{margin-bottom:20px}
  .tg-search{height:44px}
  .tg-search input{font-size:16px}
  .tg-seg{height:40px}
  .tg-tag-b{min-height:46px}
  .tg-check{width:40px;height:40px}
  .tg-tag{grid-template-columns:40px minmax(0,1fr);padding-left:0}
  .tg-lh{height:46px;padding-left:4px}
  .tg-note{min-height:68px;padding-left:16px}
  .tg-res-head,.tg-related{padding-left:16px}
  .tg-open{width:40px;height:40px}
  .tg-bulk .btn{height:38px}
  .tg-bulk .btn.tg-bx{width:38px}
  .tg-chip{height:34px}
  .tg-chip .x{width:28px;height:28px}
}
@media (max-width:420px){
  .tg-title h1{font-size:22px}
  .tg-rebuild span{display:none}
  .tg-rebuild{width:40px;padding:0;justify-content:center}
  .tg-hint{padding:18px}
  .tg-top{grid-template-columns:1fr}
  .tg-note{grid-template-columns:34px minmax(0,1fr) auto;gap:12px}
  .tg-fn{display:none}
  .tg-bn small{display:none}
}
`;
