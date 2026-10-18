// Note pane: reader with breadcrumbs, tags, backlinks and outgoing links, and
// a markdown editor with toolbar, shortcuts, [[wikilink]] completion,
// autosave and agent-conflict detection.

import { apiGet } from '../api';
import { on } from '../bus';
import { attr, el, esc } from '../dom';
import { fmtTs, hashColor, noteName, relTs, wikilinks } from '../format';
import { hooks } from '../hooks';
import { allNotes, state } from '../state';
import type { NoteDoc } from '../types';
import { I } from './icons';
import { askMoveNotes, confirmDeleteNotes, pinToggle } from './menus';
import { nav } from './nav';
import { createNote, onRelocate, relocating, renameNote, saveNote } from './ops';
import { openContents } from './contents';
import { closePanel } from './panel';
import { applyReading, openReadingPanel } from './reading';
import { baseName, dirOf, folderColor, initials, isPinned, mutationInfo, touched } from './store';
import { inlineEdit, openMenu, undoToast } from './ui';
import { nodeUrl, replaceHistory } from '../router';
import { readerSkeleton } from '../ui/skeleton';
import { LOCK_ICON, openPrivacy } from '../ui/privacy';

interface FullNote extends NoteDoc {
  backlinks?: { path: string; name: string }[];
  frontmatter?: Record<string, unknown> | null;
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

const ed = {
  path: null as string | null,
  /** Content as last read from or written to the server. */
  base: '',
  doc: null as FullNote | null,
  timer: 0,
  status: 'saved' as SaveState,
  lastSavedAt: 0,
  theirs: null as string | null,
  theirsBy: '',
};

let host: HTMLElement | null = null;
let unsub: (() => void) | null = null;
let mobileBack = false;
/** Bumped on every load so a slower, older response never overwrites a newer one. */
let loadSeq = 0;

export function editorDirty(): boolean {
  const ta = host?.querySelector<HTMLTextAreaElement>('.vx-editor');
  return !!(state.editing && ta && ta.value !== ed.base);
}

/** Save pending edits before navigating away. */
export async function flushEditor(): Promise<void> {
  if (editorDirty() && ed.status !== 'conflict') await saveNow();
}

export function noteShown(): string | null {
  return ed.path;
}

export async function renderNote(container: HTMLElement, path: string, back: boolean, quiet = false): Promise<void> {
  host = container;
  mobileBack = back;
  wireBus();
  if (!quiet) container.innerHTML = readerSkeleton();
  const seq = ++loadSeq;
  let d: FullNote;
  try {
    d = await apiGet<FullNote>('/api/note?path=' + encodeURIComponent(path));
  } catch (e) {
    // A rename or move in flight (or the user moved on): keep what is shown.
    if (seq !== loadSeq || state.note !== path || relocating(path) || relocating()) return;
    container.innerHTML = `<div class="vx-empty">${I.warn}<p>Could not open <b>${esc(path)}</b><br>${esc(
      (e as Error).message,
    )}</p></div>`;
    ed.path = null;
    return;
  }
  if (seq !== loadSeq || state.note !== path) return; // the user moved on meanwhile
  if (ed.path !== (d.path || path)) ed.lastSavedAt = 0;
  ed.path = d.path || path;
  ed.base = d.content || '';
  ed.doc = d;
  ed.status = 'saved';
  ed.theirs = null;
  draw();
  if (!relocating()) container.classList.remove('vx-busy');
}

function draw(): void {
  const c = host;
  const d = ed.doc;
  if (!c || !d) return;
  closePanel();
  closeSuggest();
  const path = ed.path || d.path;
  const folder = dirOf(path);
  const crumbs = folder ? folder.split('/').map((_, i, a) => a.slice(0, i + 1).join('/')) : [];
  const tags = d.tags && d.tags.length ? d.tags : [];
  const backlinks = d.backlinks || [];
  const outs = Array.from(new Set(wikilinks(d.content)));
  const words = (d.content || '').replace(/^---[\s\S]*?---/, '').split(/\s+/).filter(Boolean).length;
  const t = touched.get(path);
  const pinned = isPinned('note', path);
  const prevScroll = c.querySelector<HTMLElement>('.vx-note-scroll')?.scrollTop || 0;

  c.style.setProperty('--fc', folderColor(folder));
  c.innerHTML = '';

  // The full way up: Vault / folder / sub / node. Every folder is a link.
  const crumbHTML = `<button class="vx-crumb" data-f="">${I.vault}<span>Vault</span></button>${crumbs
    .map(
      (p) =>
        `<span class="vx-crumb-sep" aria-hidden="true">/</span><button class="vx-crumb" data-f="${attr(p)}"><span>${esc(baseName(p))}</span></button>`,
    )
    .join('')}<span class="vx-crumb-sep" aria-hidden="true">/</span><span class="vx-crumb cur" aria-current="page"><span>${esc(
    noteName(path),
  )}</span></span>`;

  // Slim bar: back, breadcrumb, save state, Contents, Aa, Edit, more.
  const bar = el('header', 'vx-rbar');
  bar.innerHTML = `<button class="vx-icon-btn vx-back" data-back aria-label="Back" title="Back">${I.back}</button>
    <nav class="vx-crumbs" aria-label="Breadcrumb">${crumbHTML}</nav>
    <span class="vx-grow"></span>
    <span class="vx-save" data-state="${ed.status}" aria-live="polite"></span>
    ${
      state.editing
        ? ''
        : `<button class="vx-icon-btn" data-contents aria-haspopup="dialog" aria-expanded="false" aria-label="Contents" title="Contents: outline and links">${I.toc}</button>
    <button class="vx-icon-btn vx-aa-btn" data-aa aria-haspopup="dialog" aria-expanded="false" aria-label="Reading settings" title="Reading settings">Aa</button>`
    }
    <button class="btn sm vx-mode${state.editing ? ' primary' : ''}" data-mode="${state.editing ? 'read' : 'edit'}" aria-pressed="${state.editing}" title="${
      state.editing ? 'Done editing (Esc)' : 'Edit (E)'
    }">${state.editing ? I.check + '<span>Done</span>' : I.edit + '<span>Edit</span>'}</button>
    <button class="vx-icon-btn" data-more aria-label="More actions" title="More">${I.more}</button>`;
  c.appendChild(bar);
  // Phones: the breadcrumb gets its own scrollable row under the bar.
  const pcrumbs = el('nav', 'vx-pcrumbs');
  pcrumbs.setAttribute('aria-label', 'Breadcrumb');
  pcrumbs.innerHTML = crumbHTML;
  c.appendChild(pcrumbs);
  requestAnimationFrame(() => (pcrumbs.scrollLeft = pcrumbs.scrollWidth));

  const scroller = el('div', 'vx-note-scroll');
  applyReading(scroller, state.editing);
  const page = el('div', 'vx-page' + (state.editing ? ' editing' : ''));
  const col = el('div', 'vx-col');
  const head = el('div', 'vx-doc-head');
  // One meta line: folder, updated, length, agent, tags.
  const meta: string[] = [
    `<button class="vx-meta-folder" data-f="${attr(folder)}"><i></i>${esc(folder || 'Vault root')}</button>`,
    `<span title="${attr(fmtTs(d.mtime))}">Updated ${esc(relTs(d.mtime))}</span>`,
    `<span>${Math.max(1, Math.round(words / 220))} min read</span>`,
  ];
  if (pinned) meta.push(`<span class="vx-meta-pin">${I.pin}Pinned</span>`);
  if (t)
    meta.push(
      `<span class="vx-touch" title="${attr(`${t.actor} · ${t.action.replace(/_/g, ' ')} · ${relTs(t.at / 1000)}`)}"><span class="vx-agent sm" style="--ac:${hashColor(
        t.actor,
      )}">${esc(initials(t.actor))}</span>${esc(t.actor)}</span>`,
    );
  head.innerHTML = `<h1 class="vx-doc-title" title="Double click to rename">${esc(noteName(path))}</h1>
    <div class="vx-doc-meta">${meta.join('')}${
      tags.length
        ? `<span class="vx-tags">${tags
            .map((x) => `<button class="vx-tag" data-tag="${attr(x)}" style="--tc:${hashColor(x)}">#${esc(x)}</button>`)
            .join('')}</span>`
        : ''
    }</div>`;
  col.appendChild(head);

  if (ed.theirs != null) col.appendChild(conflictBanner());

  let art: HTMLElement | null = null;
  if (state.editing) col.appendChild(editorEl());
  else {
    art = el('article', 'vx-prose note-body');
    art.innerHTML = d.html || `<pre>${esc(d.content || '')}</pre>`;
    if (!(d.content || '').trim())
      art.innerHTML = `<p class="vx-muted vx-empty-doc">This node is empty. <button class="vx-linkbtn" data-start>Start writing</button> or press <kbd>E</kbd>.</p>`;
    col.appendChild(art);
    wireProse(art);
  }

  // The outline sits in a left rail on wide screens; backlinks and links out
  // follow the text (open on wide screens, folded on phones). The Contents
  // panel has all of it on every screen.
  const outRefs = outs.map((o) => ({ name: o, path: findNote(o)?.path || null }));
  const backHTML = backlinks.length
    ? backlinks
        .map(
          (b) =>
            `<button class="vx-link" data-open="${attr(b.path)}" style="--fc:${attr(folderColor(dirOf(b.path)))}"><i></i><b>${esc(
              b.name,
            )}</b><small>${esc(dirOf(b.path) || 'Vault')}</small></button>`,
        )
        .join('')
    : '<p class="vx-muted">No node links here yet.</p>';
  const outHTML = outRefs.length
    ? outRefs
        .map((o) =>
          o.path
            ? `<button class="vx-link" data-open="${attr(o.path)}" style="--fc:${attr(folderColor(dirOf(o.path)))}"><i></i><b>${esc(
                o.name,
              )}</b><small>${esc(dirOf(o.path) || 'Vault')}</small></button>`
            : `<button class="vx-link missing" data-create="${attr(o.name)}" title="Create this node"><i></i><b>${esc(
                o.name,
              )}</b><small>Not created yet · create</small></button>`,
        )
        .join('')
    : '<p class="vx-muted">No [[wikilinks]] in this node.</p>';
  const heads = art ? Array.from(art.querySelectorAll<HTMLElement>('h1,h2,h3')) : [];
  const links = art ? Array.from(art.querySelectorAll<HTMLElement>('a.wl')) : [];
  const side = el('aside', 'vx-rail');
  side.setAttribute('aria-label', 'On this page');
  if (!state.editing) {
    if (heads.length) {
      side.innerHTML = `<section class="vx-rsec vx-toc"><h3>On this page</h3><div class="vx-toc-list">${heads
        .map(
          (h, i) =>
            `<button class="vx-toc-i${h.tagName === 'H3' ? ' sub' : ''}" data-h="${i}">${esc(h.textContent || '')}</button>`,
        )
        .join('')}</div></section>`;
      page.appendChild(side);
    } else page.classList.add('no-rail');
    const open = mobileBack ? '' : ' open';
    const foot = el('div', 'vx-rfoot');
    foot.innerHTML = `<details${open}><summary>Backlinks<span>${backlinks.length}</span></summary><div>${backHTML}</div></details>
      <details${open}><summary>Links out<span>${outRefs.length}</span></summary><div>${outHTML}</div></details>`;
    col.appendChild(foot);
  }
  page.appendChild(col);
  scroller.appendChild(page);
  c.appendChild(scroller);
  if (prevScroll) scroller.scrollTop = prevScroll;

  bar.querySelector<HTMLElement>('[data-back]')!.onclick = () => {
    void flushEditor().then(() => document.dispatchEvent(new CustomEvent('vx-back')));
  };
  c.querySelectorAll<HTMLElement>('.vx-crumb[data-f],.vx-meta-folder').forEach((b) => {
    b.onclick = () => nav.selectFolder(b.dataset.f || '');
  });
  bar.querySelector<HTMLElement>('[data-mode]')!.onclick = (e) => setMode((e.currentTarget as HTMLElement).dataset.mode === 'edit');
  bar.querySelector<HTMLElement>('[data-more]')!.onclick = (e) => moreMenu(path, e.currentTarget as HTMLElement);
  bar.querySelector<HTMLElement>('[data-aa]')?.addEventListener('click', (e) =>
    openReadingPanel(e.currentTarget as HTMLElement, () => applyReading(scroller, state.editing)),
  );
  const jump = (target: HTMLElement): void => {
    target.scrollIntoView({ behavior: smooth(), block: target.tagName.startsWith('H') ? 'start' : 'center' });
    target.classList.remove('vx-hit');
    void target.offsetWidth;
    target.classList.add('vx-hit');
    if (target.tagName === 'A') target.focus({ preventScroll: true });
  };
  bar.querySelector<HTMLElement>('[data-contents]')?.addEventListener('click', (e) =>
    openContents(e.currentTarget as HTMLElement, { heads, backlinks, outs: outRefs, links }, {
      open: (p) => nav.openNote(p),
      create: (name, at) => offerCreate(name, at),
      jump,
    }),
  );
  head.querySelector<HTMLElement>('.vx-doc-title')!.ondblclick = () => renameTitle();
  head.querySelectorAll<HTMLElement>('.vx-tag').forEach((b) => {
    b.onclick = () => {
      state.tags.active = b.dataset.tag || null;
      void flushEditor().then(() => hooks.go('tags'));
    };
  });
  col.querySelector<HTMLElement>('[data-start]')?.addEventListener('click', () => setMode(true));
  c.querySelectorAll<HTMLElement>('.vx-rail [data-open],.vx-rfoot [data-open]').forEach(
    (b) => (b.onclick = () => nav.openNote(b.dataset.open || '')),
  );
  c.querySelectorAll<HTMLElement>('.vx-rail [data-create],.vx-rfoot [data-create]').forEach(
    (b) => (b.onclick = () => offerCreate(b.dataset.create || '', b)),
  );
  side.querySelectorAll<HTMLElement>('[data-h]').forEach((b) => {
    b.onclick = () => jump(heads[Number(b.dataset.h)]);
  });
  if (heads.length) watchToc(scroller, heads, side);
  paintSave();
  c.onkeydown = onPaneKey;
}

const smooth = (): ScrollBehavior =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/** A link to a node that does not exist yet: offer to create it in this folder. */
function offerCreate(name: string, at: HTMLElement): void {
  const folder = dirOf(ed.path || '');
  openMenu(
    [
      {
        label: `Create “${name}”`,
        icon: I.newNote,
        hint: folder ? baseName(folder) : 'Vault',
        run: () => void createLinked(name),
      },
    ],
    at,
  );
}

/** Highlight the outline entry of the section being read. */
function watchToc(scroller: HTMLElement, heads: HTMLElement[], side: HTMLElement): void {
  const items = Array.from(side.querySelectorAll<HTMLElement>('[data-h]'));
  const mark = (): void => {
    const top = scroller.getBoundingClientRect().top + 90;
    let cur = 0;
    heads.forEach((h, i) => {
      if (h.getBoundingClientRect().top <= top) cur = i;
    });
    items.forEach((b, i) => b.classList.toggle('on', i === cur));
  };
  let raf = 0;
  scroller.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(mark);
  });
  mark();
}

/** The reader's more menu. */
function moreMenu(path: string, at: HTMLElement): void {
  const pinned = isPinned('note', path);
  openMenu(
    [
      { label: 'Rename', icon: I.rename, hint: 'F2', run: () => renameTitle() },
      { label: 'Move to…', icon: I.move, hint: 'M', run: () => askMoveNotes([path]) },
      {
        label: pinned ? 'Unpin' : 'Pin',
        icon: pinned ? I.pinOff : I.pin,
        hint: 'P',
        run: () => {
          pinToggle('note', path);
          draw();
        },
      },
      { label: 'Privacy…', icon: LOCK_ICON, run: () => void openPrivacy('node', path) },
      { sep: true, label: '' },
      {
        label: 'Copy link',
        icon: I.link,
        run: () => copy(location.origin + nodeUrl(path), 'Link copied'),
      },
      {
        label: 'Copy wikilink',
        icon: I.wiki,
        run: () => {
          const t = linkTextFor(path, '');
          copy(`[[${t}]]`, 'Copied [[' + t + ']]');
        },
      },
      { label: 'New node in this folder', icon: I.newNote, run: () => nav.newNote(dirOf(path)) },
      { sep: true, label: '' },
      {
        label: 'Delete…',
        icon: I.trash,
        hint: 'Del',
        danger: true,
        run: () => confirmDeleteNotes([path], () => nav.selectFolder(dirOf(path))),
      },
    ],
    at,
  );
}

function copy(text: string, done: string): void {
  void navigator.clipboard?.writeText(text).then(
    () => undoToast(done, null, 'info', 2500),
    () => undoToast('Clipboard is not available', null, 'err', 2500),
  );
}

function findNote(name: string): { path: string } | undefined {
  const n = name.toLowerCase();
  return allNotes().find((x) => x.name.toLowerCase() === n || x.path.toLowerCase() === n + '.md' || x.path.toLowerCase() === n);
}

async function createLinked(name: string): Promise<void> {
  const p = await createNote(dirOf(ed.path || ''), name);
  if (p) nav.openNote(p);
}

function wireProse(art: HTMLElement): void {
  // The page already shows the title: drop a leading H1 that repeats it.
  const first = art.firstElementChild;
  if (first && first.tagName === 'H1' && first.textContent?.trim().toLowerCase() === noteName(ed.path || '').toLowerCase()) first.remove();
  art.querySelectorAll<HTMLElement>('a.wl').forEach((a) => {
    a.setAttribute('role', 'link');
    a.tabIndex = 0;
    const open = (): void => {
      const p = a.dataset.path;
      if (p && !a.classList.contains('broken')) nav.openNote(p);
      else offerCreate(a.textContent || '', a);
    };
    a.onclick = (e) => {
      e.preventDefault();
      open();
    };
    a.onkeydown = (e) => {
      if (e.key === 'Enter') open();
    };
    if (a.classList.contains('broken')) {
      a.title = 'Not created yet. Click to create it.';
      a.setAttribute('aria-label', `${a.textContent || ''} (not created yet, create it)`);
    }
  });
  // "- [ ] item" arrives as plain text: show it as a (read-only) task box.
  art.querySelectorAll<HTMLElement>('li').forEach((li) => {
    const t = li.firstChild;
    const m = t && t.nodeType === Node.TEXT_NODE ? /^\s*\[([ xX])\]\s/.exec(t.textContent || '') : null;
    if (!t || !m) return;
    t.textContent = (t.textContent || '').slice(m[0].length);
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = m[1] !== ' ';
    li.prepend(box);
    li.classList.add('task');
    if (box.checked) li.classList.add('done');
  });
  // Task list checkboxes are read-only in the reader.
  art.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((x) => (x.disabled = true));
}

function renameTitle(): void {
  const h = host?.querySelector<HTMLElement>('.vx-doc-title');
  if (!h || !ed.path) return;
  const from = ed.path;
  void inlineEdit(h, noteName(from)).then(async (v) => {
    if (!v) return;
    await flushEditor();
    // ops keeps the reader on screen ("Renaming…"), swaps the URL in place
    // and reloads the tree; only draw the new path if that did not happen.
    const to = await renameNote(from, v);
    if (to && host && (state.note !== to || ed.path !== to)) {
      state.note = to;
      await renderNote(host, to, mobileBack, true);
    }
  });
}

function setMode(edit: boolean): void {
  if (state.editing === edit) return;
  if (!edit) {
    void flushEditor().then(async () => {
      state.editing = false;
      if (ed.path) await renderNote(host!, ed.path, mobileBack, true);
    });
    return;
  }
  state.editing = true;
  draw();
  host?.querySelector<HTMLTextAreaElement>('.vx-editor')?.focus();
}

function onPaneKey(e: KeyboardEvent): void {
  const tag = (e.target as HTMLElement).tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    setMode(!state.editing);
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    setMode(true);
  } else if ((e.key === 'p' || e.key === 'P') && ed.path) {
    pinToggle('note', ed.path);
    draw();
  } else if (e.key === 'F2') {
    e.preventDefault();
    renameTitle();
  } else if ((e.key === 'm' || e.key === 'M') && ed.path) {
    e.preventDefault();
    askMoveNotes([ed.path]);
  } else if (e.key === 'Delete' && ed.path) {
    confirmDeleteNotes([ed.path], () => nav.selectFolder(dirOf(ed.path || '')));
  }
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const TOOLS: { k: string; icon: string; label: string; key?: string }[] = [
  { k: 'h', icon: I.heading, label: 'Heading', key: 'Ctrl+Alt+H' },
  { k: 'b', icon: I.bold, label: 'Bold', key: 'Ctrl+B' },
  { k: 'i', icon: I.italic, label: 'Italic', key: 'Ctrl+I' },
  { k: 'ul', icon: I.list, label: 'Bulleted list', key: 'Ctrl+Shift+8' },
  { k: 'task', icon: I.task, label: 'Task', key: 'Ctrl+Shift+9' },
  { k: 'quote', icon: I.quote, label: 'Quote' },
  { k: 'code', icon: I.code, label: 'Code', key: 'Ctrl+`' },
  { k: 'link', icon: I.link, label: 'Link', key: 'Ctrl+K' },
  { k: 'wiki', icon: I.wiki, label: 'Wikilink', key: '[[' },
];

function editorEl(): HTMLElement {
  const wrap = el('div', 'vx-edit');
  wrap.innerHTML = `<div class="vx-toolbar" role="toolbar" aria-label="Formatting">${TOOLS.map(
    (x) =>
      `<button data-t="${x.k}" title="${attr(x.label + (x.key ? ' (' + x.key + ')' : ''))}" aria-label="${attr(x.label)}">${x.icon}</button>`,
  ).join('')}<span class="vx-grow"></span><span class="vx-edit-hint">Saves as you type · <kbd>Esc</kbd> done</span></div>
  <textarea class="vx-editor note-editor" spellcheck="true" aria-label="Node markdown"></textarea>
  <div class="vx-edit-foot"><span class="vx-wc"></span></div>`;
  const ta = wrap.querySelector<HTMLTextAreaElement>('.vx-editor')!;
  ta.value = ed.base;
  const autosize = (): void => {
    ta.style.height = 'auto';
    ta.style.height = Math.max(320, ta.scrollHeight + 4) + 'px';
  };
  const count = (): void => {
    const w = ta.value.split(/\s+/).filter(Boolean).length;
    wrap.querySelector('.vx-wc')!.textContent = `${w} words · ${ta.value.length} characters`;
  };
  requestAnimationFrame(autosize);
  count();
  ta.oninput = () => {
    autosize();
    count();
    markDirty();
    suggest(ta);
  };
  ta.onkeydown = (e) => editorKey(e, ta);
  ta.onblur = () => setTimeout(() => closeSuggest(), 150);
  wrap.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => {
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => {
      format(ta, b.dataset.t || '');
      ta.focus();
    };
  });
  return wrap;
}

function markDirty(): void {
  if (ed.status === 'conflict') return;
  ed.status = 'dirty';
  paintSave();
  clearTimeout(ed.timer);
  ed.timer = window.setTimeout(() => void saveNow(), 1200);
}

function paintSave(): void {
  const s = host?.querySelector<HTMLElement>('.vx-save');
  if (!s) return;
  s.dataset.state = ed.status;
  const label: Record<SaveState, string> = {
    saved: state.editing && ed.lastSavedAt ? 'Saved' : '',
    dirty: 'Unsaved',
    saving: 'Saving…',
    error: 'Save failed, retrying',
    conflict: 'Conflict',
  };
  s.innerHTML = label[ed.status] ? `<i></i>${label[ed.status]}` : '';
  s.title = ed.lastSavedAt ? 'Last saved ' + new Date(ed.lastSavedAt).toLocaleTimeString() : '';
}

async function saveNow(): Promise<void> {
  clearTimeout(ed.timer);
  const ta = host?.querySelector<HTMLTextAreaElement>('.vx-editor');
  const path = ed.path;
  if (!ta || !path) return;
  const mine = ta.value;
  if (mine === ed.base) {
    ed.status = 'saved';
    paintSave();
    return;
  }
  ed.status = 'saving';
  paintSave();
  try {
    // Never write blind: if the note changed on the server since we loaded
    // it (an agent wrote to it), stop and ask.
    const cur = await apiGet<FullNote>('/api/note?path=' + encodeURIComponent(path));
    if ((cur.content || '') !== ed.base && (cur.content || '') !== mine) {
      raiseConflict(cur.content || '', touched.get(path)?.actor || 'someone else');
      return;
    }
    await saveNote(path, mine);
    ed.base = mine;
    ed.lastSavedAt = Date.now();
    const now = host?.querySelector<HTMLTextAreaElement>('.vx-editor');
    ed.status = now && now.value !== mine ? 'dirty' : 'saved';
    if (ed.status === 'dirty') ed.timer = window.setTimeout(() => void saveNow(), 1200);
    paintSave();
  } catch (e) {
    ed.status = 'error';
    paintSave();
    console.warn('save failed', e);
    ed.timer = window.setTimeout(() => void saveNow(), 5000);
  }
}

function raiseConflict(theirs: string, by: string): void {
  ed.theirs = theirs;
  ed.theirsBy = by;
  ed.status = 'conflict';
  const ta = host?.querySelector<HTMLTextAreaElement>('.vx-editor');
  const mine = ta ? ta.value : ed.base;
  draw();
  const nta = host?.querySelector<HTMLTextAreaElement>('.vx-editor');
  if (nta) nta.value = mine;
}

function conflictBanner(): HTMLElement {
  const b = el('div', 'vx-conflict');
  b.setAttribute('role', 'alert');
  b.innerHTML = `<div class="vx-conflict-head">${I.warn}<div><b>${esc(ed.theirsBy)} changed this node while you were editing.</b>
    <p>Your edits are kept in the editor and are not saved yet. Choose which version wins.</p></div></div>
    <div class="vx-conflict-acts">
      <button class="btn sm" data-c="diff">Compare</button>
      <button class="btn sm" data-c="theirs">Use their version</button>
      <button class="btn sm primary" data-c="mine">Keep mine and overwrite</button>
    </div><pre class="vx-theirs hidden"></pre>`;
  b.querySelector<HTMLElement>('[data-c=diff]')!.onclick = () => {
    const pre = b.querySelector<HTMLElement>('.vx-theirs')!;
    pre.classList.toggle('hidden');
    const ta = host?.querySelector<HTMLTextAreaElement>('.vx-editor');
    pre.innerHTML = lineDiff(ta ? ta.value : '', ed.theirs || '');
  };
  b.querySelector<HTMLElement>('[data-c=theirs]')!.onclick = () => {
    const ta = host?.querySelector<HTMLTextAreaElement>('.vx-editor');
    const mine = ta ? ta.value : '';
    void navigator.clipboard?.writeText(mine).catch(() => {});
    ed.base = ed.theirs || '';
    ed.theirs = null;
    ed.status = 'saved';
    if (ed.doc) ed.doc.content = ed.base;
    draw();
    undoToast('Loaded their version. Your text was copied to the clipboard.', null, 'info');
  };
  b.querySelector<HTMLElement>('[data-c=mine]')!.onclick = async () => {
    const ta = host?.querySelector<HTMLTextAreaElement>('.vx-editor');
    if (!ta || !ed.path) return;
    ed.base = ed.theirs || ed.base; // accept theirs as the base, then write mine
    ed.theirs = null;
    ed.status = 'dirty';
    const mine = ta.value;
    draw();
    const nta = host?.querySelector<HTMLTextAreaElement>('.vx-editor');
    if (nta) nta.value = mine;
    await saveNow();
  };
  return b;
}

/** Tiny line diff (LCS) for the conflict panel. */
function lineDiff(mine: string, theirs: string): string {
  const a = mine.split('\n');
  const b = theirs.split('\n');
  if (a.length * b.length > 400000) return esc(theirs);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push(`<span>  ${esc(a[i])}</span>`);
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) {
      out.push(`<span class="add">+ ${esc(b[j])}</span>`);
      j++;
    } else {
      out.push(`<span class="del">- ${esc(a[i])}</span>`);
      i++;
    }
  }
  return `<em>Lines marked + are only in their version, - only in yours.</em>` + out.join('');
}

function wrapSel(ta: HTMLTextAreaElement, before: string, after = before, placeholder = 'text'): void {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const sel = v.slice(s, e) || placeholder;
  ta.setRangeText(before + sel + after, s, e, 'end');
  ta.setSelectionRange(s + before.length, s + before.length + sel.length);
  ta.dispatchEvent(new Event('input'));
}

function prefixLines(ta: HTMLTextAreaElement, prefix: string): void {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  const le = v.indexOf('\n', e);
  const end = le < 0 ? v.length : le;
  const block = v.slice(ls, end);
  const lines = block.split('\n');
  const all = lines.every((l) => l.startsWith(prefix));
  const next = lines.map((l) => (all ? l.slice(prefix.length) : prefix + l)).join('\n');
  ta.setRangeText(next, ls, end, 'select');
  ta.dispatchEvent(new Event('input'));
}

function format(ta: HTMLTextAreaElement, k: string): void {
  if (k === 'b') wrapSel(ta, '**');
  else if (k === 'i') wrapSel(ta, '*');
  else if (k === 'code') {
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (sel.includes('\n')) wrapSel(ta, '```\n', '\n```', 'code');
    else wrapSel(ta, '`');
  } else if (k === 'h') prefixLines(ta, '## ');
  else if (k === 'ul') prefixLines(ta, '- ');
  else if (k === 'task') prefixLines(ta, '- [ ] ');
  else if (k === 'quote') prefixLines(ta, '> ');
  else if (k === 'link') {
    const s = ta.selectionStart;
    const sel = ta.value.slice(s, ta.selectionEnd) || 'link text';
    ta.setRangeText(`[${sel}](https://)`, s, ta.selectionEnd, 'end');
    const urlAt = s + sel.length + 3;
    ta.setSelectionRange(urlAt, urlAt + 8);
    ta.dispatchEvent(new Event('input'));
  } else if (k === 'wiki') {
    wrapSel(ta, '[[', ']]', '');
  }
}

function editorKey(e: KeyboardEvent, ta: HTMLTextAreaElement): void {
  if (suggestKey(e, ta)) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 's') {
    e.preventDefault();
    void saveNow();
  } else if (mod && k === 'b') {
    e.preventDefault();
    format(ta, 'b');
  } else if (mod && k === 'i') {
    e.preventDefault();
    format(ta, 'i');
  } else if (mod && k === 'k') {
    e.preventDefault();
    format(ta, 'link');
  } else if (mod && e.key === '`') {
    e.preventDefault();
    format(ta, 'code');
  } else if (mod && e.altKey && k === 'h') {
    e.preventDefault();
    format(ta, 'h');
  } else if (mod && e.shiftKey && (e.key === '*' || e.code === 'Digit8')) {
    e.preventDefault();
    format(ta, 'ul');
  } else if (mod && e.shiftKey && (e.key === '(' || e.code === 'Digit9')) {
    e.preventDefault();
    format(ta, 'task');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    setMode(false);
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const { selectionStart: s, value: v } = ta;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    if (e.shiftKey) {
      if (v.slice(ls, ls + 2) === '  ') {
        ta.setRangeText('', ls, ls + 2, 'preserve');
        ta.setSelectionRange(Math.max(ls, s - 2), Math.max(ls, s - 2));
      }
    } else if (ta.selectionStart !== ta.selectionEnd) {
      prefixLines(ta, '  ');
      return;
    } else {
      ta.setRangeText('  ', s, s, 'end');
    }
    ta.dispatchEvent(new Event('input'));
  } else if (e.key === 'Enter' && !e.shiftKey && !mod) {
    // Continue lists, tasks, quotes and numbered lists.
    const { selectionStart: s, value: v } = ta;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const line = v.slice(ls, s);
    const m = /^(\s*)([-*+] \[[ xX]\] |[-*+] |> |(\d+)\. )/.exec(line);
    if (!m) return;
    e.preventDefault();
    if (line.trim() === m[2].trim()) {
      ta.setRangeText('', ls, s, 'end'); // empty item ends the list
    } else {
      let marker = m[2];
      if (m[3]) marker = Number(m[3]) + 1 + '. ';
      marker = marker.replace(/\[[xX]\]/, '[ ]');
      ta.setRangeText('\n' + m[1] + marker, s, ta.selectionEnd, 'end');
    }
    ta.dispatchEvent(new Event('input'));
  }
}

// [[wikilink]] completion -----------------------------------------------------

interface Sug {
  name: string;
  folder: string;
  /** What goes between the brackets. */
  text: string;
}

let sug: { box: HTMLElement; items: Sug[]; i: number; from: number } | null = null;

/**
 * The link text for a node, as written from a note in `fromDir`: its name,
 * or Folder/Name when that name exists in more than one folder and the node
 * is not in the writer's own folder (the server resolves the same way).
 */
export function linkTextFor(path: string, fromDir: string): string {
  const name = noteName(path);
  const same = allNotes().filter((n) => n.name.toLowerCase() === name.toLowerCase());
  if (same.length < 2 || dirOf(path) === fromDir) return name;
  return path.replace(/\.md$/i, '');
}

function closeSuggest(): void {
  sug?.box.remove();
  sug = null;
}

function suggest(ta: HTMLTextAreaElement): void {
  const s = ta.selectionStart;
  const before = ta.value.slice(Math.max(0, s - 80), s);
  const m = /\[\[([^\]\n|]*)$/.exec(before);
  if (!m) {
    closeSuggest();
    return;
  }
  const q = m[1].toLowerCase();
  const from = dirOf(ed.path || '');
  // Every node, not every name: two "Plan"s in different folders both show,
  // each with its folder, and the one picked gets a link that reaches it.
  const items: Sug[] = allNotes()
    .filter((n) => n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        (a.name.toLowerCase().startsWith(q) ? 0 : 1) - (b.name.toLowerCase().startsWith(q) ? 0 : 1) ||
        a.name.localeCompare(b.name) ||
        a.path.localeCompare(b.path),
    )
    .slice(0, 8)
    .map((n) => ({ name: n.name, folder: dirOf(n.path), text: linkTextFor(n.path, from) }));
  if (!items.length) {
    closeSuggest();
    return;
  }
  if (!sug) {
    const box = el('div', 'vx-suggest');
    box.setAttribute('role', 'listbox');
    ta.parentElement?.appendChild(box);
    sug = { box, items, i: 0, from: s - m[1].length };
  }
  sug.items = items;
  sug.from = s - m[1].length;
  sug.i = Math.min(sug.i, items.length - 1);
  // Position near the caret line (approximation: line index).
  const line = ta.value.slice(0, s).split('\n').length;
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 22;
  sug.box.style.top = Math.min(ta.offsetTop + line * lh + 8 - ta.scrollTop, ta.offsetTop + ta.offsetHeight - 40) + 'px';
  drawSuggest(ta);
}

function drawSuggest(ta: HTMLTextAreaElement): void {
  if (!sug) return;
  const cur = sug;
  cur.box.innerHTML = cur.items
    .map(
      (n, i) =>
        `<button role="option" aria-selected="${i === cur.i}" class="${i === cur.i ? 'on' : ''}" data-i="${i}">${I.note}<span>${esc(n.name)}</span><small style="margin-left:auto;padding-left:10px;color:var(--muted);font-size:11.5px">${esc(n.folder || 'Vault root')}</small></button>`,
    )
    .join('');
  cur.box.querySelectorAll<HTMLElement>('button').forEach((b) => {
    b.onmousedown = (e) => {
      e.preventDefault();
      pickSuggest(ta, Number(b.dataset.i));
    };
  });
}

function pickSuggest(ta: HTMLTextAreaElement, i: number): void {
  if (!sug) return;
  const name = sug.items[i].text;
  const s = ta.selectionStart;
  const closing = ta.value.slice(s, s + 2) === ']]' ? '' : ']]';
  ta.setRangeText(name + closing, sug.from, s, 'end');
  if (!closing) ta.setSelectionRange(sug.from + name.length + 2, sug.from + name.length + 2);
  closeSuggest();
  ta.dispatchEvent(new Event('input'));
}

function suggestKey(e: KeyboardEvent, ta: HTMLTextAreaElement): boolean {
  if (!sug) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    sug.i = (sug.i + (e.key === 'ArrowDown' ? 1 : -1) + sug.items.length) % sug.items.length;
    drawSuggest(ta);
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    pickSuggest(ta, sug.i);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeSuggest();
    return true;
  }
  return false;
}

// While the open node is renamed or moved: keep it on screen, dimmed, with
// "Renaming…" / "Moving…" where the save state sits.
onRelocate((p, verb) => {
  if (!host || (p !== ed.path && p !== state.note)) return;
  // Done, but the new path is still loading: renderNote clears it after drawing.
  if (!verb && ed.path !== state.note) return;
  host.classList.toggle('vx-busy', !!verb);
  const s = host.querySelector<HTMLElement>('.vx-save');
  if (s && verb) {
    s.dataset.state = 'saving';
    s.innerHTML = `<i></i>${esc(verb)}…`;
  } else paintSave();
});

// Realtime --------------------------------------------------------------------

function wireBus(): void {
  if (unsub) return;
  unsub = on('mutation', (ev) => {
    if (state.page !== 'vault' || !host || !host.isConnected) {
      // Hidden: drop the subscription until the pane renders again.
      unsub?.();
      unsub = null;
      return;
    }
    const m = mutationInfo(ev);
    const cur = ed.path;
    if (!cur) return;
    if (m.type === 'node_renamed' && m.oldPath === cur && m.path) {
      ed.path = m.path;
      if (state.note !== m.path) replaceHistory();
      state.note = m.path;
      // Our own rename or move says so itself.
      if (!relocating(cur) && !relocating(m.path)) undoToast(`${m.actor || 'An agent'} moved this node to ${m.path}`, null, 'info');
      if (!state.editing) void renderNote(host, m.path, mobileBack, true);
      else draw();
      return;
    }
    if (m.type === 'node_deleted' && m.path === cur && !relocating(cur)) {
      undoToast(`${m.actor || 'An agent'} deleted this node`, null, 'err', 9000);
      return;
    }
    if (m.path !== cur || (m.type !== 'node_updated' && m.type !== 'node_created')) return;
    if (state.editing) {
      void apiGet<FullNote>('/api/note?path=' + encodeURIComponent(cur))
        .then((d) => {
          if (ed.path !== cur || !state.editing) return;
          const theirs = d.content || '';
          const ta = host?.querySelector<HTMLTextAreaElement>('.vx-editor');
          const mine = ta ? ta.value : ed.base;
          if (theirs === ed.base || theirs === mine) return;
          if (mine === ed.base) {
            // No local edits: just take theirs.
            ed.base = theirs;
            if (ta) ta.value = theirs;
            if (ed.doc) ed.doc.content = theirs;
            undoToast(`${m.actor || 'An agent'} updated this node`, null, 'info', 3000);
            return;
          }
          raiseConflict(theirs, m.actor || 'An agent');
        })
        .catch(() => {
          /* the next save re-checks for conflicts */
        });
    } else {
      void renderNote(host, cur, mobileBack, true).then(() => {
        host?.querySelector('.vx-prose')?.classList.add('vx-flash');
      });
    }
  });
}
