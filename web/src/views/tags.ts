// Tags view: a weighted tag index (built from the graph's per-note tags once per
// session), multi-tag filtering (AND), related tags and the matching notes.

import { apiGet } from '../api';
import { $, attr, esc, useStyles } from '../dom';
import { folderOf, hashColor, relTs } from '../format';
import { hooks } from '../hooks';
import { openPeek } from '../peek';
import { state, allNotes } from '../state';
import { clearTagIndex, readTagIndex, writeTagIndex } from '../storage';
import type { NoteRef } from '../types';

/** Folder, name and path for one note carrying a tag. */
interface TagEntry {
  path: string;
  name: string;
  folder: string;
  mtime: number;
}

const view = {
  q: '',
  sort: 'count' as 'count' | 'name',
  sel: [] as string[],
};

async function buildTagIndex(force: boolean, onProgress: (done: number, total: number) => void): Promise<Map<string, TagEntry[]>> {
  if (state.tags.built && !force && state.tags.index) {
    return state.tags.index as unknown as Map<string, TagEntry[]>;
  }
  const notes = allNotes();
  const map = new Map<string, TagEntry[]>();
  const sig = notes.map((n) => n.path + ':' + n.mtime).join('|');
  const cached = readTagIndex();
  if (!force && cached && cached.sig === sig) {
    const restored = new Map<string, TagEntry[]>();
    for (const [tag, list] of cached.tags) restored.set(tag, list as unknown as TagEntry[]);
    state.tags.index = restored as unknown as Map<string, NoteRef[]>;
    state.tags.built = true;
    return restored;
  }
  // One request: the graph carries every note's tags exactly as the note view
  // reports them (inline #tags and frontmatter), so no note is fetched on its own.
  let g: { nodes?: { path?: string; tags?: string[] }[] };
  try {
    g = await apiGet<typeof g>('/api/graph');
  } catch {
    // Nothing to show yet; the next visit (or Rebuild) tries again.
    onProgress(notes.length, notes.length);
    return map;
  }
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
  writeTagIndex(sig, Array.from(map.entries()));
  return map;
}

export async function renderTags(): Promise<void> {
  useStyles('tg-styles', TAGS_CSS);
  const host = $('#view-tags');
  if (state.tags.active) {
    view.sel = [state.tags.active];
    state.tags.active = null;
  }
  host.innerHTML = `<div class="tg">
    <header class="tg-head">
      <div><h1 class="page-title">Tags</h1><p class="page-sub" id="tgSub">Reading nodes…</p></div>
      <span style="flex:1"></span>
      <label class="tg-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="tgQ" type="search" placeholder="Find a tag" aria-label="Find a tag" value="${attr(view.q)}" spellcheck="false"></label>
      <div class="tg-seg" role="group" aria-label="Sort tags">
        <button data-s="count" aria-pressed="${view.sort === 'count'}" class="${view.sort === 'count' ? 'on' : ''}">Popular</button>
        <button data-s="name" aria-pressed="${view.sort === 'name'}" class="${view.sort === 'name' ? 'on' : ''}">A–Z</button>
      </div>
      <button class="btn sm" id="tgRebuild" title="Read every node again">Rebuild</button>
    </header>
    <div class="tg-prog" id="tgProg"><i style="width:${state.tags.built ? 100 : 0}%"></i></div>
    <div class="tg-body">
      <section class="tg-cloud-wrap" aria-label="All tags"><div id="tgCloud" class="tg-cloud"><div class="empty">Building the tag index…</div></div></section>
      <section class="tg-results" id="tgRes" aria-live="polite"></section>
    </div></div>`;

  host.querySelector<HTMLButtonElement>('#tgRebuild')!.onclick = () => {
    clearTagIndex();
    state.tags.built = false;
    state.tags.index = null;
    void renderTags();
  };
  // Null until the index is built; the sort buttons are live before that.
  let map: Map<string, TagEntry[]> | null = null;
  host.querySelectorAll<HTMLButtonElement>('.tg-seg button').forEach((b) => {
    b.onclick = () => {
      view.sort = b.dataset.s === 'name' ? 'name' : 'count';
      host.querySelectorAll<HTMLButtonElement>('.tg-seg button').forEach((x) => {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      if (map) drawCloud(map);
    };
  });

  const bar = host.querySelector<HTMLElement>('#tgProg i')!;
  const sub = host.querySelector<HTMLElement>('#tgSub')!;
  const built = await buildTagIndex(false, (done, total) => {
    bar.style.width = Math.round((done / Math.max(1, total)) * 100) + '%';
    sub.textContent = `Reading nodes… ${done}/${total}`;
  });
  if (!host.contains(bar)) return;
  map = built;
  bar.style.width = '100%';
  setTimeout(() => host.querySelector('#tgProg')?.classList.add('done'), 300);
  const tagged = new Set<string>();
  built.forEach((l) => l.forEach((e) => tagged.add(e.path)));
  sub.textContent = `${built.size} tags across ${tagged.size} nodes`;

  const q = host.querySelector<HTMLInputElement>('#tgQ')!;
  q.oninput = () => {
    view.q = q.value;
    drawCloud(built);
  };
  // Drop selections that no longer exist.
  view.sel = view.sel.filter((t) => built.has(t));
  drawCloud(built);
  drawResults(built);
}

function drawCloud(map: Map<string, TagEntry[]>): void {
  const cloud = $('#tgCloud');
  const needle = view.q.trim().toLowerCase().replace(/^#/, '');
  const rows = Array.from(map.entries())
    .filter(([t, l]) => l.length && (!needle || t.toLowerCase().includes(needle)))
    .sort((a, b) =>
      view.sort === 'name' ? a[0].localeCompare(b[0]) : b[1].length - a[1].length || a[0].localeCompare(b[0]),
    );
  if (!map.size) {
    cloud.innerHTML = '<div class="empty">This vault has no tags yet. Add <code>#tags</code> or a <code>tags:</code> line to a node.</div>';
    return;
  }
  if (!rows.length) {
    cloud.innerHTML = `<div class="empty">No tag matches "${esc(view.q)}".</div>`;
    return;
  }
  const max = Math.max(...rows.map(([, l]) => l.length));
  cloud.innerHTML = rows
    .map(([t, l]) => {
      const w = max > 1 ? Math.log(l.length) / Math.log(max) : 0;
      const on = view.sel.includes(t);
      return `<button class="tg-tag${on ? ' on' : ''}" data-tag="${attr(t)}" aria-pressed="${on}" style="--tc:${hashColor(
        t,
      )};--w:${w.toFixed(2)}"><span>#${esc(t)}</span><em>${l.length}</em></button>`;
    })
    .join('');
  cloud.querySelectorAll<HTMLElement>('.tg-tag').forEach((b) => {
    b.onclick = (e) => {
      const t = b.dataset.tag || '';
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        view.sel = view.sel.includes(t) ? view.sel.filter((x) => x !== t) : [...view.sel, t];
      } else {
        view.sel = view.sel.length === 1 && view.sel[0] === t ? [] : [t];
      }
      drawCloud(map);
      drawResults(map);
    };
  });
}

function drawResults(map: Map<string, TagEntry[]>): void {
  const res = $('#tgRes');
  if (!view.sel.length) {
    const top = Array.from(map.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6);
    res.innerHTML = `<div class="tg-hint"><h2>Pick a tag</h2><p>Click a tag to see its nodes. <kbd>Shift</kbd>+click adds more tags: nodes must carry all of them.</p>${
      top.length
        ? `<div class="tg-top">${top
            .map(
              ([t, l]) =>
                `<button class="tg-card" data-tag="${attr(t)}" style="--tc:${hashColor(t)}"><b>#${esc(t)}</b><span>${l.length} nodes</span><small>${esc(
                  l
                    .slice(0, 3)
                    .map((e) => e.name)
                    .join(', '),
                )}</small></button>`,
            )
            .join('')}</div>`
        : ''
    }</div>`;
    res.querySelectorAll<HTMLElement>('.tg-card').forEach((b) => {
      b.onclick = () => {
        view.sel = [b.dataset.tag || ''];
        drawCloud(map);
        drawResults(map);
      };
    });
    return;
  }
  // Intersection of the selected tags.
  const lists = view.sel.map((t) => map.get(t) || []);
  let notes = lists[0].slice();
  for (const l of lists.slice(1)) {
    const keep = new Set(l.map((e) => e.path));
    notes = notes.filter((e) => keep.has(e.path));
  }
  notes.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  // Note -> tags, for co-occurring tags.
  const tagsOf = new Map<string, string[]>();
  map.forEach((l, t) => l.forEach((e) => tagsOf.set(e.path, [...(tagsOf.get(e.path) || []), t])));
  const related = new Map<string, number>();
  for (const n of notes) for (const t of tagsOf.get(n.path) || []) if (!view.sel.includes(t)) related.set(t, (related.get(t) || 0) + 1);
  const rel = Array.from(related.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  res.innerHTML = `<div class="tg-res-head">
      <div class="tg-sel">${view.sel
        .map(
          (t) =>
            `<span class="tg-pill" style="--tc:${hashColor(t)}">#${esc(t)}<button data-rm="${attr(t)}" aria-label="Remove ${attr(t)}">✕</button></span>`,
        )
        .join('<span class="tg-and">and</span>')}</div>
      <span class="tg-count">${notes.length} node${notes.length === 1 ? '' : 's'}</span>
    </div>
    ${
      rel.length
        ? `<div class="tg-related"><span>Related</span>${rel
            .map(
              ([t, n]) =>
                `<button class="tg-mini" data-add="${attr(t)}" style="--tc:${hashColor(t)}" title="Narrow to notes also tagged #${attr(
                  t,
                )}">+ #${esc(t)} <em>${n}</em></button>`,
            )
            .join('')}</div>`
        : ''
    }
    <div class="tg-notes" role="list">${
      notes
        .map(
          (n) => `<div class="tg-note" role="listitem" tabindex="0" data-path="${attr(n.path)}">
        <div class="tg-note-main"><b>${esc(n.name)}</b><small>${esc(n.folder || folderOf(n.path))} · ${esc(relTs(n.mtime))}</small>
        <div class="tg-note-tags">${(tagsOf.get(n.path) || [])
          .filter((t) => !view.sel.includes(t))
          .slice(0, 6)
          .map((t) => `<span style="--tc:${hashColor(t)}">#${esc(t)}</span>`)
          .join('')}</div></div>
        <button class="btn sm ghost" data-peek="${attr(n.path)}" title="Preview without leaving Tags">Preview</button>
      </div>`,
        )
        .join('') || '<div class="empty">No node carries all of these tags.</div>'
    }</div>`;

  res.querySelectorAll<HTMLElement>('[data-rm]').forEach((b) => {
    b.onclick = () => {
      view.sel = view.sel.filter((t) => t !== b.dataset.rm);
      drawCloud(map);
      drawResults(map);
    };
  });
  res.querySelectorAll<HTMLElement>('[data-add]').forEach((b) => {
    b.onclick = () => {
      view.sel = [...view.sel, b.dataset.add || ''];
      drawCloud(map);
      drawResults(map);
    };
  });
  res.querySelectorAll<HTMLElement>('.tg-note').forEach((row) => {
    const open = (): void => hooks.openNote(row.dataset.path || '');
    row.onclick = (e) => {
      if ((e.target as HTMLElement).closest('[data-peek]')) return;
      open();
    };
    row.onkeydown = (e) => {
      // Keys on the Preview button inside the row are the button's own.
      if (e.target !== row) return;
      if (e.key === 'Enter') open();
      if (e.key === ' ') {
        e.preventDefault();
        void openPeek(row.dataset.path || '');
      }
    };
  });
  res.querySelectorAll<HTMLElement>('[data-peek]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      void openPeek(b.dataset.peek || '');
    };
  });
}

const TAGS_CSS = `
.tg{max-width:1280px;margin:0 auto}
.tg-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.tg-search{display:flex;align-items:center;gap:7px;height:34px;padding:0 10px;border:1px solid var(--line);border-radius:10px;
  background:var(--panel);color:var(--muted);min-width:200px}
.tg-search svg{width:15px;height:15px}
.tg-search input{border:0;background:none;outline:none;color:var(--fg);font:inherit;font-size:13px;flex:1;min-width:0}
.tg-search:focus-within{border-color:color-mix(in srgb,var(--accent) 60%,var(--line))}
.tg-seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;padding:2px;background:var(--panel)}
.tg-seg button{border:0;background:none;color:var(--muted);font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;cursor:pointer}
.tg-seg button.on{background:var(--panel-2);color:var(--fg)}
.tg-prog{height:2px;background:var(--line);border-radius:2px;overflow:hidden;margin-bottom:16px;transition:opacity .4s}
.tg-prog.done{opacity:0}
.tg-prog i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-2));transition:width .2s}
.tg-body{display:grid;grid-template-columns:minmax(260px,1fr) minmax(0,1.35fr);gap:18px;align-items:start}
.tg-cloud-wrap{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;position:sticky;top:0;max-height:calc(100vh - 170px);overflow:auto}
.tg-cloud{display:flex;flex-wrap:wrap;gap:7px;align-items:center}
.tg-tag{display:inline-flex;align-items:baseline;gap:6px;border:1px solid transparent;cursor:pointer;font:inherit;
  font-size:calc(12px + var(--w) * 7px);font-weight:calc(500 + var(--w) * 200);padding:4px 11px;border-radius:20px;
  color:var(--tc);background:color-mix(in srgb,var(--tc) calc(8% + var(--w) * 8%),transparent);transition:all .15s}
.tg-tag em{font-style:normal;font-size:10.5px;color:var(--muted);font-weight:500}
.tg-tag:hover{background:color-mix(in srgb,var(--tc) 22%,transparent)}
.tg-tag.on{border-color:var(--tc);background:color-mix(in srgb,var(--tc) 26%,transparent)}
.tg-tag:focus-visible,.tg-note:focus-visible,.tg-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tg-results{min-width:0}
.tg-hint{background:var(--panel);border:1px dashed var(--line);border-radius:16px;padding:22px}
.tg-hint h2{margin:0 0 4px;font-size:17px}
.tg-hint p{margin:0 0 16px;color:var(--muted);font-size:13px}
.tg-top{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.tg-card{display:flex;flex-direction:column;gap:3px;text-align:left;border:1px solid var(--line);background:var(--bg);color:var(--fg);
  font:inherit;padding:12px;border-radius:12px;cursor:pointer;border-top:3px solid var(--tc)}
.tg-card b{color:var(--tc);font-size:14px}
.tg-card span{font-size:12px;color:var(--muted)}
.tg-card small{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-card:hover{border-color:var(--tc)}
.tg-res-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.tg-sel{display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1}
.tg-pill{display:inline-flex;align-items:center;gap:6px;font-size:16px;font-weight:650;color:var(--tc);padding:4px 6px 4px 12px;border-radius:20px;
  background:color-mix(in srgb,var(--tc) 15%,transparent)}
.tg-pill button{border:0;background:none;color:inherit;cursor:pointer;font-size:11px;width:20px;height:20px;border-radius:50%}
.tg-pill button:hover{background:color-mix(in srgb,var(--tc) 25%,transparent)}
.tg-and{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.tg-count{font-size:12.5px;color:var(--muted)}
.tg-related{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px;font-size:11.5px;color:var(--muted)}
.tg-related>span{text-transform:uppercase;letter-spacing:.06em;font-size:10.5px;margin-right:4px}
.tg-mini{border:1px dashed color-mix(in srgb,var(--tc) 50%,transparent);background:none;color:var(--tc);font:inherit;font-size:11.5px;
  padding:2px 9px;border-radius:20px;cursor:pointer}
.tg-mini em{font-style:normal;color:var(--muted)}
.tg-mini:hover{background:color-mix(in srgb,var(--tc) 12%,transparent)}
.tg-notes{background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.tg-note{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--line);cursor:pointer;transition:background .12s}
.tg-note:first-child{border-top:0}
.tg-note:hover{background:var(--panel-2)}
.tg-note-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.tg-note-main b{font-weight:580;font-size:14px}
.tg-note-main small{font-size:11.5px;color:var(--muted)}
.tg-note-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:3px}
.tg-note-tags span{font-size:11px;color:var(--tc)}
:root[data-theme=light] .tg-tag,:root[data-theme=light] .tg-pill,:root[data-theme=light] .tg-mini,:root[data-theme=light] .tg-card b,
:root[data-theme=light] .tg-note-tags span{color:color-mix(in srgb,var(--tc) 55%,#111)}
@media (max-width:860px){
  .tg-body{grid-template-columns:1fr}
  .tg-cloud-wrap{position:static;max-height:none}
  .tg-search{flex:1 1 100%;order:3}
}
`;
