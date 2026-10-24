// Note pane: the reader and the markdown editor, with local drafts and agent-conflict detection.

import { apiGet } from '../api';
import { on } from '../bus';
import { attr, el, esc, useStyles } from '../dom';
import { fmtTs, hashColor, noteName, relTs, stemTitle, wikilinks } from '../format';
import { hooks } from '../hooks';
import { allNotes, noteTitle, state } from '../state';
import type { NoteDoc } from '../types';
import { I } from './icons';
import { askMoveNotes, copyPath, copyWikilink, deleteNotesToTrash, pinToggle } from './menus';
import { nav } from './nav';
import { createNote, onRelocate, relocating, renameNote, saveNote } from './ops';
import { contentsBody, contentsOpen, markHead, openContentsSheet, setContentsOpen, type ContentsData } from './contents';
import { closePanel } from './panel';
import { applyReading, openReadingPanel } from './reading';
import { baseName, dirOf, folderColor, initials, isPinned, mutationInfo, ROOT_LABEL, touched } from './store';
import { inlineEdit, openMenu, undoToast } from './ui';
import { nodeUrl, replaceHistory, setLeaveGuard } from '../router';
import { clearDraft, moveDraft, readDraft, saveDraft } from './drafts';
import { skBlock } from '../ui/skeleton';
import { Modal } from '../modal';
import { LOCK_ICON, openPrivacy } from '../ui/privacy';
import {
  askRestoreVersion,
  diffView,
  fetchDiff,
  fetchVersion,
  HIST_CSS,
  invalidateHistory,
  openHistorySheet,
  previewBanner,
  type HistoryHost,
  type Version,
} from './history';

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
  status: 'saved' as SaveState,
  lastSavedAt: 0,
  theirs: null as string | null,
  theirsBy: '',
};

let host: HTMLElement | null = null;

/** The version history preview in the reader. */
const hist = {
  /** The version shown instead of the current note (null: the current one). */
  v: null as Version | null,
  content: '',
  html: '',
  mode: 'read' as 'read' | 'changes',
  /** Changes from `v` to now; null until asked. */
  diff: null as string | null,
  /** Bumped per pick, so a slow answer never shows a version picked earlier. */
  seq: 0,
};
let unsub: (() => void) | null = null;
let mobileBack = false;
/** Bumped on every load so a slower, older response never overwrites a newer one. */
let loadSeq = 0;

function editorDirty(): boolean {
  const ta = host?.querySelector<HTMLTextAreaElement>('.vx-editor');
  return !!(state.editing && ta && ta.value !== ed.base);
}

// Edits are saved on demand, so closing the tab with unsaved changes asks first.
window.addEventListener('beforeunload', (e) => {
  if (!editorDirty()) return;
  e.preventDefault();
  e.returnValue = '';
});

/** Save pending edits before navigating away. A failed save keeps the text as a draft on this device. */
export async function flushEditor(): Promise<void> {
  if (!editorDirty()) return;
  if (ed.status !== 'conflict' && (await saveNow())) return;
  if (ed.path) saveDraft(ed.path, editorText(), ed.base);
  undoToast('Your changes could not be saved. They are kept on this device: open the note again to restore them.', null, 'err', 9000);
}

function editorText(): string {
  return host?.querySelector<HTMLTextAreaElement>('.vx-editor')?.value ?? ed.base;
}

// Leaving the Notes page while editing: save first; if that fails, ask.
setLeaveGuard((next, stay) => {
  if (!editorDirty()) return false;
  void (async () => {
    if (ed.status !== 'conflict' && (await saveNow())) {
      next();
      return;
    }
    if (ed.path) saveDraft(ed.path, editorText(), ed.base);
    Modal.open({
      title: 'Leave without saving?',
      body: `<p style="margin:0">${
        ed.status === 'conflict'
          ? 'Someone else changed this note while you were editing. Choose which version to keep before you leave.'
          : 'Your changes could not be saved right now.'
      } If you leave, they are kept on this device and offered again when you open the note.</p>`,
      actions: [
        {
          label: 'Leave',
          cls: 'ghost',
          run: () => {
            Modal.close();
            state.editing = false;
            next();
          },
        },
        {
          label: 'Stay and edit',
          cls: 'primary',
          run: () => {
            Modal.close();
            stay();
          },
        },
      ],
    });
  })();
  return true;
});

export function noteShown(): string | null {
  return ed.path;
}

/** The reader while a note loads: the same bar, page and inspector as the real one. */
function readerSkeleton(): string {
  const b = skBlock;
  const lines = (ws: number[]): string => ws.map((w) => `<span class="sk sk-line" style="width:${w}%"></span>`).join('');
  return `<div class="vx-sk" aria-busy="true" aria-label="Loading the note">
  <header class="vx-rbar">${b('28px', 28, 'r')}${b('64px')}${b('110px')}<span class="vx-grow"></span>${b('28px', 28, 'r')}${b('28px', 28, 'r')}${b('64px', 30)}${b('28px', 28, 'r')}</header>
  <div class="vx-note-scroll"><div class="vx-page">
    <div class="vx-paper"><div class="vx-col">
      ${b('min(420px,70%)', 34)}
      <div class="sk-row" style="margin:16px 0 34px">${b('120px', 12)}${b('70px', 12)}${b('64px', 22, 'pill')}${b('80px', 22, 'pill')}</div>
      ${lines([96, 92, 98, 60])}<div class="sk-gap"></div>${b('34%', 22)}
      <div class="sk-bullet">${b('6px', 6, 'r')}${b('62%')}</div><div class="sk-bullet">${b('6px', 6, 'r')}${b('48%')}</div>
      <div class="sk-bullet">${b('6px', 6, 'r')}${b('55%')}</div><div class="sk-gap"></div>${lines([94, 88, 72])}
    </div></div>
    <aside class="vx-insp"><section class="vx-icard">${b('70px', 12)}<div style="height:12px"></div>${[0, 1, 2, 3, 4, 5]
      .map((i) => `<div class="sk-row" style="justify-content:space-between;height:36px">${b(`${50 + ((i * 9) % 20)}px`, 10)}${b(`${60 + ((i * 17) % 40)}px`, 10)}</div>`)
      .join('')}</section></aside>
  </div></div></div>`;
}

export async function renderNote(container: HTMLElement, path: string, back: boolean, quiet = false): Promise<void> {
  host = container;
  mobileBack = back;
  useStyles('vx-hist-css', HIST_CSS);
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
  if (ed.path !== (d.path || path)) {
    ed.lastSavedAt = 0;
    clearPreview();
  }
  ed.path = d.path || path;
  // A fresh load (a save, an agent's change, a restore) may add a version.
  invalidateHistory(ed.path);
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

  const crumbHTML = `<button class="vx-crumb" data-f="">${I.vault}<span>${esc(ROOT_LABEL)}</span></button>${crumbs
    .map(
      (p) =>
        `<span class="vx-crumb-sep" aria-hidden="true">/</span><button class="vx-crumb" data-f="${attr(p)}"><span>${esc(baseName(p))}</span></button>`,
    )
    .join('')}<span class="vx-crumb-sep" aria-hidden="true">/</span><span class="vx-crumb cur" aria-current="page"><span>${esc(
    noteTitle(path),
  )}</span></span>`;

  const bar = el('header', 'vx-rbar');
  bar.innerHTML = `<button class="vx-icon-btn vx-back" data-back aria-label="Back" title="Back">${I.back}</button>
    <nav class="vx-crumbs" aria-label="Breadcrumb">${crumbHTML}</nav>
    <span class="vx-grow"></span>
    <span class="vx-save" data-state="${ed.status}" aria-live="polite"></span>
    ${
      state.editing
        ? ''
        : `<span class="vx-rgroup"><button class="vx-ct-btn" type="button" data-contents aria-label="Contents" title="Contents: outline and links">${I.toc}<span>Contents</span></button>
    <button class="vx-ct-btn vx-hist-btn" type="button" data-hist aria-label="Version history" title="Version history: see and restore earlier versions">${I.history}<span>History</span></button>
    <button class="vx-icon-btn vx-aa-btn" data-aa aria-haspopup="dialog" aria-expanded="false" aria-label="Reading settings" title="Reading settings">Aa</button></span><span class="vx-vsep" aria-hidden="true"></span>`
    }
    <span class="vx-rgroup">${
      state.editing
        ? `<span class="vx-edit-btns"><button class="btn sm ghost" type="button" data-cancel title="Close the editor (Esc). Asks first when there are unsaved changes.">Close</button>
    <button class="btn sm primary" type="button" data-save title="Save and close (Ctrl+S saves and keeps editing)">${I.check}<span>Save</span></button></span>`
        : `<button class="btn sm vx-mode" type="button" data-mode="edit" aria-pressed="false" title="Edit (E)">${I.edit}<span>Edit</span></button>`
    }
    ${state.editing ? '' : `<button class="vx-icon-btn" data-focus aria-label="Hide the toolbar" title="Hide the toolbar for reading (F)">${I.foldUp}</button>`}
    <button class="vx-icon-btn" data-more aria-label="More actions" title="More">${I.more}</button></span>`;
  c.appendChild(bar);
  bar.querySelector<HTMLElement>('[data-focus]')?.addEventListener('click', () => setFocus(true));
  const unfocus = el('button', 'vx-unfocus');
  unfocus.setAttribute('type', 'button');
  unfocus.title = 'Show the toolbar (F)';
  unfocus.innerHTML = `${I.foldDown}<span>Show toolbar</span>`;
  unfocus.onclick = () => setFocus(false);
  c.appendChild(unfocus);
  applyFocus();
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
  const folderBtn = `<button class="vx-meta-folder" data-f="${attr(folder)}"><i></i><span>${esc(folder || ROOT_LABEL)}</span></button>`;
  const updated = `<span title="${attr(fmtTs(d.mtime))}">${esc(relTs(d.mtime))}</span>`;
  const read = `${Math.max(1, Math.round(words / 220))} min read`;
  const agent = t
    ? `<span class="vx-touch" title="${attr(`${t.actor} · ${t.action.replace(/_/g, ' ')} · ${relTs(t.at / 1000)}`)}"><span class="vx-agent sm" style="--ac:${hashColor(
        t.actor,
      )}">${esc(initials(t.actor))}</span>${esc(t.actor)}</span>`
    : '';
  const meta: string[] = [folderBtn, `<span>Updated ${updated}</span>`, `<span>${read}</span>`];
  if (pinned) meta.push(`<span class="vx-meta-pin">${I.pin}Pinned</span>`);
  if (agent) meta.push(agent);
  const tagBtns = tags
    .map((x) => `<button class="vx-tag" data-tag="${attr(x)}" style="--tc:${hashColor(x)}" title="Notes tagged #${attr(x)}"><i></i>${esc(x)}</button>`)
    .join('');
  head.innerHTML = `<h1 class="vx-doc-title" title="Double click to rename">${esc(noteTitle(path))}</h1>
    <div class="vx-doc-meta">${meta.join('')}</div>${tags.length ? `<div class="vx-tags">${tagBtns}</div>` : ''}`;
  col.appendChild(head);

  if (ed.theirs != null) col.appendChild(conflictBanner());
  else {
    const banner = draftBanner(path, d.content || '');
    if (banner) col.appendChild(banner);
  }

  let art: HTMLElement | null = null;
  let pvBar: HTMLElement | null = null;
  const pv = state.editing ? null : hist.v;
  if (state.editing) col.appendChild(editorEl());
  else if (pv) {
    // The banner sits outside the page, under the reader's bar, so it stays in view.
    pvBar = previewBanner(pv, hist.mode, {
      restore: () => restoreShown(),
      latest: () => backToLatest(),
      mode: (m) => setPreviewMode(m),
      list: () => openHistory(),
    });
    if (hist.mode === 'changes') col.appendChild(diffView(pv, hist.diff));
    else {
      art = el('article', 'vx-prose note-body vh-old');
      art.innerHTML = hist.html || `<pre>${esc(hist.content)}</pre>`;
      if (!hist.content.trim()) art.innerHTML = `<p class="vx-muted vx-empty-doc">Version ${pv.version} of this note was empty.</p>`;
      col.appendChild(art);
      wireProse(art);
    }
  } else {
    art = el('article', 'vx-prose note-body');
    art.innerHTML = d.html || `<pre>${esc(d.content || '')}</pre>`;
    if (!(d.content || '').trim())
      art.innerHTML = `<p class="vx-muted vx-empty-doc">This note is empty. <button class="vx-linkbtn" data-start>Start writing</button> or press <kbd>E</kbd>.</p>`;
    col.appendChild(art);
    wireProse(art);
  }

  const outRefs = outs.map((o) => ({ name: o, path: findNote(o)?.path || null }));
  const backHTML = backlinks.length
    ? backlinks
        .map(
          (b) =>
            `<button class="vx-link" data-open="${attr(b.path)}" style="--fc:${attr(folderColor(dirOf(b.path)))}"><i></i><b>${esc(
              noteTitle(b.path),
            )}</b><small>${esc(dirOf(b.path) || ROOT_LABEL)}</small></button>`,
        )
        .join('')
    : '<p class="vx-muted">No other note links here yet.</p>';
  const outHTML = outRefs.length
    ? outRefs
        .map((o) =>
          o.path
            ? `<button class="vx-link" data-open="${attr(o.path)}" style="--fc:${attr(folderColor(dirOf(o.path)))}"><i></i><b>${esc(
                noteTitle(o.path),
              )}</b><small>${esc(dirOf(o.path) || ROOT_LABEL)}</small></button>`
            : `<button class="vx-link missing" data-create="${attr(o.name)}" title="Create this note"><i></i><b>${esc(
                o.name,
              )}</b><small>Not created yet · create</small></button>`,
        )
        .join('')
    : '<p class="vx-muted">This note does not link to other notes yet. Type [[ while editing to add a link.</p>';
  const heads = art ? Array.from(art.querySelectorAll<HTMLElement>('h1,h2,h3,h4')).filter((h) => (h.textContent || '').trim()) : [];
  const links = art ? Array.from(art.querySelectorAll<HTMLElement>('a.wl')) : [];
  if (!state.editing && !pv) {
    const open = mobileBack ? '' : ' open';
    const foot = el('div', 'vx-rfoot');
    foot.innerHTML = `<details${open}><summary>Mentioned in<span>${backlinks.length}</span></summary><div>${backHTML}</div></details>
      <details${open}><summary>Links to<span>${outRefs.length}</span></summary><div>${outHTML}</div></details>`;
    col.appendChild(foot);
  }
  const paper = el('div', 'vx-paper');
  paper.appendChild(col);
  page.appendChild(paper);

  // Details: property rows, shown as the last tab of Contents.
  const created = createdOf(d);
  const side = el('aside', 'vx-insp');
  side.setAttribute('aria-label', 'Contents');
  const row = (label: string, value: string): string => `<dt>${label}</dt><dd>${value}</dd>`;
  const detailsHTML = `<dl class="vx-info">
      <div class="vx-igroup">${row('Folder', folderBtn)}${row(
        'Tags',
        tags.length ? `<span class="vx-itags">${tagBtns}</span>` : '<span class="vx-none">None</span>',
      )}</div>
      <div class="vx-igroup">${row('Updated', updated)}${
        created ? row('Created', `<span title="${attr(created.full)}">${esc(created.short)}</span>`) : ''
      }</div>
      <div class="vx-igroup">${row('Words', `<span>${words.toLocaleString()} · ${read}</span>`)}${row(
        'Links',
        `<span>${outRefs.length}</span>`,
      )}${row('Backlinks', `<span>${backlinks.length}</span>`)}</div>
      <div class="vx-igroup">${row('Pinned', `<span>${pinned ? 'Yes' : 'No'}</span>`)}${agent ? row('Last agent', agent) : ''}</div>
    </dl>`;
  page.prepend(side);
  scroller.appendChild(page);
  if (pvBar) c.appendChild(pvBar);
  c.appendChild(scroller);
  if (prevScroll) scroller.scrollTop = prevScroll;

  bar.querySelector<HTMLElement>('[data-back]')!.onclick = () => {
    void flushEditor().then(() => document.dispatchEvent(new CustomEvent('vx-back')));
  };
  c.querySelectorAll<HTMLElement>('.vx-crumb[data-f],.vx-meta-folder:not(.vx-ct *)').forEach((b) => {
    b.onclick = () => nav.selectFolder(b.dataset.f || '');
  });
  const modeBtn = bar.querySelector<HTMLElement>('[data-mode]');
  if (modeBtn) modeBtn.onclick = () => setMode(true);
  bar.querySelector<HTMLElement>('[data-save]')?.addEventListener('click', () => void saveAndClose());
  bar.querySelector<HTMLElement>('[data-cancel]')?.addEventListener('click', () => cancelEdit());
  bar.querySelector<HTMLElement>('[data-more]')!.onclick = (e) => moreMenu(path, e.currentTarget as HTMLElement);
  bar.querySelector<HTMLElement>('[data-aa]')?.addEventListener('click', (e) =>
    openReadingPanel(e.currentTarget as HTMLElement, () => applyReading(scroller, state.editing)),
  );
  const toc = heads.length ? watchToc(scroller, heads, c) : null;
  const jump = (target: HTMLElement): void => {
    const hi = heads.indexOf(target);
    if (hi >= 0) toc?.pick(hi);
    target.scrollIntoView({ behavior: smooth(), block: hi >= 0 ? 'start' : 'center' });
    target.classList.remove('vx-hit');
    void target.offsetWidth;
    target.classList.add('vx-hit');
    if (target.tagName === 'A') target.focus({ preventScroll: true });
  };
  // Contents: a sticky card beside the page on wide readers, a bottom sheet elsewhere.
  const cdata: ContentsData = { heads, backlinks, outs: outRefs, links, details: detailsHTML };
  const cact = {
    open: (p: string) => nav.openNote(p),
    create: (name: string, at: HTMLElement) => offerCreate(name, at),
    jump,
    current: () => toc?.current() ?? -1,
    folder: (f: string) => nav.selectFolder(f),
    tag: (x: string) => {
      state.tags.active = x || null;
      void flushEditor().then(() => hooks.go('tags'));
    },
  };
  const ctBtn = bar.querySelector<HTMLElement>('[data-contents]');
  if (ctBtn && !state.editing) {
    const card = el('section', 'vx-icard vx-toc');
    card.setAttribute('aria-label', 'Contents');
    card.innerHTML = `<header class="vx-toc-head"><h3>Contents</h3><button type="button" class="vx-icon-btn" data-toc-x aria-label="Close contents" title="Close">${I.close}</button></header>`;
    card.appendChild(contentsBody(cdata, cact, false));
    side.prepend(card);
    const wide = (): boolean => c.clientWidth >= WIDE_READER;
    const sync = (): void => {
      const open = contentsOpen();
      page.classList.toggle('toc-open', open);
      if (wide()) {
        ctBtn.setAttribute('aria-pressed', String(open));
        ctBtn.removeAttribute('aria-haspopup');
      } else {
        ctBtn.removeAttribute('aria-pressed');
        ctBtn.setAttribute('aria-haspopup', 'dialog');
        ctBtn.setAttribute('aria-expanded', 'false');
      }
    };
    sync();
    ctBtn.onclick = () => {
      if (!wide()) {
        openContentsSheet(ctBtn, cdata, cact);
        return;
      }
      setContentsOpen(!contentsOpen());
      sync();
      if (contentsOpen()) markHead(card, toc?.current() ?? -1, true);
    };
    card.querySelector<HTMLElement>('[data-toc-x]')!.onclick = () => {
      setContentsOpen(false);
      sync();
      ctBtn.focus();
    };
  }
  // Version history opens as a dialog on every width (a bottom sheet on phones).
  const hBtn = bar.querySelector<HTMLElement>('[data-hist]');
  if (hBtn) {
    hBtn.setAttribute('aria-haspopup', 'dialog');
    hBtn.onclick = () => openHistory();
  }
  head.querySelector<HTMLElement>('.vx-doc-title')!.ondblclick = () => renameTitle();
  c.querySelectorAll<HTMLElement>('.vx-tag:not(.vx-ct *)').forEach((b) => {
    b.onclick = () => {
      state.tags.active = b.dataset.tag || null;
      void flushEditor().then(() => hooks.go('tags'));
    };
  });
  col.querySelector<HTMLElement>('[data-start]')?.addEventListener('click', () => setMode(true));
  c.querySelectorAll<HTMLElement>('.vx-rfoot [data-open]').forEach((b) => (b.onclick = () => nav.openNote(b.dataset.open || '')));
  c.querySelectorAll<HTMLElement>('.vx-rfoot [data-create]').forEach((b) => (b.onclick = () => offerCreate(b.dataset.create || '', b)));
  paintSave();
  c.onkeydown = onPaneKey;
}

/** Reading pane width from which Contents sits beside the page instead of in a sheet. */
const WIDE_READER = 820;

function historyHost(path: string): HistoryHost {
  return {
    path,
    viewing: () => hist.v?.rev || '',
    preview: (v) => void previewVersion(v),
    latest: () => backToLatest(),
  };
}

function openHistory(): void {
  const path = ed.path;
  const btn = host?.querySelector<HTMLElement>('[data-hist]');
  if (!path || !btn) return;
  openHistorySheet(btn, historyHost(path), () => closePanel());
}

/** From the ⋯ menu: save and close the editor first, then show the versions. */
async function showHistory(): Promise<void> {
  if (state.editing) {
    if (!(await saveNow())) return;
    state.editing = false;
    if (ed.path && host) await renderNote(host, ed.path, mobileBack, true);
  }
  openHistory();
}

function clearPreview(): void {
  hist.v = null;
  hist.content = hist.html = '';
  hist.diff = null;
  hist.mode = 'read';
  hist.seq++;
}

async function previewVersion(v: Version): Promise<void> {
  const path = ed.path;
  if (!path) return;
  const my = ++hist.seq;
  try {
    const r = await fetchVersion(path, v.rev);
    if (my !== hist.seq || ed.path !== path) return;
    const keep = hist.mode;
    hist.v = v;
    hist.content = r.content || '';
    hist.html = r.html || '';
    hist.diff = null;
    hist.mode = keep;
    draw();
    host?.querySelector<HTMLElement>('.vx-note-scroll')?.scrollTo({ top: 0 });
    if (hist.mode === 'changes') void loadDiff();
    host?.querySelector<HTMLElement>('.vh-banner [data-restore]')?.focus({ preventScroll: true });
  } catch (e) {
    if (my === hist.seq) undoToast(`Could not open version ${v.version}: ${(e as Error).message}`, null, 'err');
  }
}

function backToLatest(): void {
  if (!hist.v) return;
  clearPreview();
  draw();
  host?.querySelector<HTMLElement>('[data-hist]')?.focus({ preventScroll: true });
}

function setPreviewMode(m: 'read' | 'changes'): void {
  if (!hist.v || hist.mode === m) return;
  hist.mode = m;
  draw();
  host?.querySelector<HTMLElement>(`.vh-seg [data-m=${m}]`)?.focus({ preventScroll: true });
  if (m === 'changes' && hist.diff == null) void loadDiff();
}

async function loadDiff(): Promise<void> {
  const v = hist.v;
  const path = ed.path;
  if (!v || !path) return;
  const my = hist.seq;
  try {
    const d = await fetchDiff(path, v.rev);
    if (my !== hist.seq || hist.v !== v) return;
    hist.diff = d;
  } catch (e) {
    if (my !== hist.seq) return;
    hist.diff = '';
    undoToast(`Could not compare the versions: ${(e as Error).message}`, null, 'err');
  }
  if (hist.mode !== 'changes') return;
  const kept = document.activeElement?.closest('.vh-seg') ? '.vh-seg [data-m=changes]' : '';
  draw();
  if (kept) host?.querySelector<HTMLElement>(kept)?.focus({ preventScroll: true });
}

/** Restore the previewed version as a new latest one, then show the note as it is now. */
function restoreShown(): void {
  const v = hist.v;
  const path = ed.path;
  if (!v || !path) return;
  askRestoreVersion(path, v, async () => {
    clearPreview();
    if (host && ed.path === path) await renderNote(host, path, mobileBack, true);
    host?.querySelector('.vx-prose')?.classList.add('vx-flash');
  });
}

/** When the note says it was created (a `created` or `date` frontmatter line). */
function createdOf(d: FullNote): { short: string; full: string } | null {
  const fm = d.frontmatter || {};
  const v = fm.created ?? fm.date;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const day = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
  const t = new Date(typeof v === 'number' && v < 1e11 ? v * 1000 : day ? (v as string).trim() + 'T00:00' : v);
  if (Number.isNaN(t.getTime())) return null;
  return {
    short: t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    full: t.toLocaleString(),
  };
}

const smooth = (): ScrollBehavior =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/** A link to a note that does not exist yet: offer to create it in this folder. */
function offerCreate(name: string, at: HTMLElement): void {
  const folder = dirOf(ed.path || '');
  openMenu(
    [
      {
        label: `Create “${name}”`,
        icon: I.newNote,
        hint: folder ? baseName(folder) : ROOT_LABEL,
        run: () => void createLinked(name),
      },
    ],
    at,
  );
}

/**
 * Follow the section being read: the last heading above 30% of the view, or the last on screen at the bottom.
 * `pick` marks an entry at once and holds it until the jump's scrolling stops.
 */
function watchToc(scroller: HTMLElement, heads: HTMLElement[], pane: HTMLElement): { pick: (i: number) => void; current: () => number } {
  let held = -1;
  let release = 0;
  let cur = -1;
  const paint = (i: number, reveal: boolean): void => {
    cur = i;
    markHead(pane, i, reveal);
    const sheet = document.querySelector<HTMLElement>('.vx-sheet.vx-pop-ct');
    if (sheet) markHead(sheet, i, false);
  };
  const find = (): number => {
    const box = scroller.getBoundingClientRect();
    const line = box.top + box.height * 0.3;
    let at = 0;
    heads.forEach((h, i) => {
      if (h.getBoundingClientRect().top <= line) at = i;
    });
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
      heads.forEach((h, i) => {
        if (h.getBoundingClientRect().top < box.bottom) at = Math.max(at, i);
      });
    }
    return at;
  };
  const mark = (): void => {
    if (held >= 0 || !scroller.isConnected) return;
    const at = find();
    if (at !== cur) paint(at, true);
  };
  let raf = 0;
  scroller.addEventListener(
    'scroll',
    () => {
      if (held >= 0) {
        clearTimeout(release);
        release = window.setTimeout(() => {
          held = -1;
        }, 160);
        return;
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(mark);
    },
    { passive: true },
  );
  requestAnimationFrame(mark);
  return {
    pick: (i: number): void => {
      held = i;
      paint(i, false);
      clearTimeout(release);
      // Released by the end of the jump's scroll, or now if nothing scrolls.
      release = window.setTimeout(() => {
        held = -1;
      }, 900);
    },
    current: () => (cur >= 0 ? cur : find()),
  };
}

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
      { label: 'Version history', icon: I.history, run: () => void showHistory() },
      { sep: true, label: '' },
      {
        label: 'Copy link',
        icon: I.link,
        run: () => copy(location.origin + nodeUrl(path), 'Link copied'),
      },
      { label: 'Copy path', icon: I.copy, run: () => copyPath(path) },
      { label: 'Copy wikilink', icon: I.wiki, run: () => copyWikilink(path) },
      { label: 'New note in this folder', icon: I.newNote, run: () => nav.newNote(dirOf(path)) },
      { sep: true, label: '' },
      {
        label: 'Move to Trash',
        icon: I.trash,
        hint: 'Del',
        danger: true,
        run: () => void deleteNotesToTrash([path], () => nav.selectFolder(dirOf(path)), true),
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
  const shown = [noteName(ed.path || ''), noteTitle(ed.path || '')].map((x) => x.toLowerCase());
  if (first && first.tagName === 'H1' && shown.includes(first.textContent?.trim().toLowerCase() || '')) first.remove();
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
    } else if (a.dataset.path) {
      a.title = `${noteTitle(a.dataset.path)} · ${dirOf(a.dataset.path) || ROOT_LABEL}`;
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
  art.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((x) => (x.disabled = true));
}

function renameTitle(): void {
  const h = host?.querySelector<HTMLElement>('.vx-doc-title');
  if (!h || !ed.path) return;
  const from = ed.path;
  void inlineEdit(h, stemTitle(noteName(from))).then(async (v) => {
    if (!v) return;
    await flushEditor();
    // ops usually redraws the reader itself; only draw the new path if that did not happen.
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
    void saveAndClose();
    return;
  }
  clearPreview();
  state.editing = true;
  draw();
  host?.querySelector<HTMLTextAreaElement>('.vx-editor')?.focus();
}

/** Save, and go back to reading once the save went through. */
async function saveAndClose(): Promise<void> {
  if (!(await saveNow())) return;
  state.editing = false;
  if (ed.path && host) await renderNote(host, ed.path, mobileBack, true);
}

/** Close the editor; unsaved changes ask first (Save, Discard with Undo, or Keep editing). */
function cancelEdit(): void {
  const leave = async (): Promise<void> => {
    state.editing = false;
    ed.status = 'saved';
    ed.theirs = null;
    if (ed.path && host) await renderNote(host, ed.path, mobileBack, true);
  };
  if (!editorDirty()) {
    void leave();
    return;
  }
  const path = ed.path;
  const text = editorText();
  const base = ed.base;
  Modal.open({
    title: 'Save your changes?',
    body: '<p style="margin:0">This note has changes that are not saved yet.</p>',
    actions: [
      { label: 'Keep editing', cls: 'ghost', run: () => Modal.close() },
      {
        label: 'Discard',
        cls: 'danger',
        run: async () => {
          Modal.close();
          if (path) clearDraft(path);
          await leave();
          undoToast('Changes discarded', () => {
            if (!path) return;
            if (ed.path === path && state.note === path && host?.isConnected) editWith(text);
            else saveDraft(path, text, base);
          }, 'info', 9000);
        },
      },
      {
        label: 'Save',
        cls: 'primary',
        run: async () => {
          Modal.close();
          await saveAndClose();
        },
      },
    ],
  });
}

/** Open the editor with `text` in it (unsaved until Save). */
function editWith(text: string): void {
  state.editing = true;
  draw();
  const ta = host?.querySelector<HTMLTextAreaElement>('.vx-editor');
  if (!ta) return;
  ta.value = text;
  ta.dispatchEvent(new Event('input'));
  ta.focus();
}

/** Offer unsaved text left on this device (a closed tab, a failed save, a discard undone). */
function draftBanner(path: string, current: string): HTMLElement | null {
  const d = readDraft(path);
  if (!d) return null;
  if (d.text === current) {
    clearDraft(path);
    return null;
  }
  // Offered while reading; the editor shows what was restored.
  if (state.editing) return null;
  const b = el('div', 'vx-conflict vx-draft');
  b.setAttribute('role', 'status');
  b.innerHTML = `<div class="vx-conflict-head">${I.edit}<div><b>You have unsaved changes from ${esc(
    relTs(d.at / 1000),
  )} on this device.</b>
    <p>${
      d.base !== current
        ? 'The note has changed since then. Restoring puts your version in the editor; nothing is saved until you press Save.'
        : 'Restore them to keep editing, or discard them.'
    }</p></div></div>
    <div class="vx-conflict-acts"><button class="btn sm" data-dr="drop">Discard</button><button class="btn sm primary" data-dr="restore">Restore</button></div>`;
  b.querySelector<HTMLElement>('[data-dr=restore]')!.onclick = () => editWith(d.text);
  b.querySelector<HTMLElement>('[data-dr=drop]')!.onclick = () => {
    clearDraft(path);
    draw();
    undoToast('Unsaved changes discarded', () => {
      saveDraft(path, d.text, d.base);
      if (ed.path === path) draw();
    }, 'info', 9000);
  };
  return b;
}

// Reading focus: the bars fold away so only the note is left (the app bar follows by CSS :has).
const FOCUS_KEY = 'memora.reader.focus';
let focusOn = ((): boolean => {
  try {
    return localStorage.getItem(FOCUS_KEY) === '1';
  } catch {
    return false;
  }
})();

function applyFocus(): void {
  const c = host;
  if (!c) return;
  const on = focusOn && !state.editing;
  c.classList.toggle('vx-focus', on);
}

function setFocus(on: boolean): void {
  focusOn = on;
  try {
    localStorage.setItem(FOCUS_KEY, on ? '1' : '0');
  } catch {
    /* private mode: not remembered */
  }
  applyFocus();
  const target = host?.querySelector<HTMLElement>(on ? '.vx-unfocus' : '[data-focus]');
  window.setTimeout(() => target?.focus({ preventScroll: true }), 260);
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
  if (e.key === 'Escape' && hist.v && !state.editing && !document.querySelector('.vx-sheet,.vx-pop,#modalHost:not(.hidden)')) {
    e.preventDefault();
    backToLatest();
    return;
  }
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
  } else if ((e.key === 'f' || e.key === 'F') && !state.editing) {
    e.preventDefault();
    setFocus(!focusOn);
  } else if (e.key === 'Delete' && ed.path) {
    const p = ed.path;
    void deleteNotesToTrash([p], () => nav.selectFolder(dirOf(p)), true);
  }
}

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
      `${x.k === 'ul' || x.k === 'link' ? '<span class="vx-tsep" aria-hidden="true"></span>' : ''}<button data-t="${x.k}" title="${attr(
        x.label + (x.key ? ' (' + x.key + ')' : ''),
      )}" aria-label="${attr(x.label)}">${x.icon}</button>`,
  ).join('')}<span class="vx-grow"></span><span class="vx-edit-hint"><kbd>Ctrl</kbd><kbd>S</kbd> save · <kbd>Esc</kbd> close</span></div>
  <textarea class="vx-editor note-editor" spellcheck="true" aria-label="Note text"></textarea>
  <div class="vx-edit-foot"><span class="vx-wc"></span><span class="vx-grow"></span>
    <span class="vx-edit-acts"><button class="btn ghost" type="button" data-cancel>Close</button><button class="btn primary" type="button" data-save>${I.check}<span>Save</span></button></span></div>`;
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
    if (ed.path) saveDraft(ed.path, ta.value, ed.base);
    suggest(ta);
  };
  ta.onkeydown = (e) => editorKey(e, ta);
  wrap.querySelector<HTMLElement>('.vx-edit-acts [data-save]')!.onclick = () => void saveAndClose();
  wrap.querySelector<HTMLElement>('.vx-edit-acts [data-cancel]')!.onclick = () => cancelEdit();
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
}

function paintSave(): void {
  const s = host?.querySelector<HTMLElement>('.vx-save');
  if (!s) return;
  s.dataset.state = ed.status;
  const label: Record<SaveState, string> = {
    saved: state.editing && ed.lastSavedAt ? 'Saved' : '',
    dirty: 'Unsaved changes',
    saving: 'Saving…',
    error: 'Save failed',
    conflict: 'Conflict',
  };
  s.innerHTML = label[ed.status] ? `<i></i>${label[ed.status]}` : '';
  s.title = ed.lastSavedAt ? 'Last saved ' + new Date(ed.lastSavedAt).toLocaleTimeString() : '';
}

/** Write the editor to the server; true once the vault has this text. */
async function saveNow(): Promise<boolean> {
  const ta = host?.querySelector<HTMLTextAreaElement>('.vx-editor');
  const path = ed.path;
  if (!ta || !path) return false;
  if (ed.status === 'conflict') return false;
  const mine = ta.value;
  if (mine === ed.base) {
    ed.status = 'saved';
    paintSave();
    return true;
  }
  ed.status = 'saving';
  paintSave();
  try {
    // Never write blind: if the note changed on the server since we loaded it, stop and ask.
    const cur = await apiGet<FullNote>('/api/note?path=' + encodeURIComponent(path));
    if ((cur.content || '') !== ed.base && (cur.content || '') !== mine) {
      raiseConflict(cur.content || '', touched.get(path)?.actor || 'someone else');
      return false;
    }
    await saveNote(path, mine);
    ed.base = mine;
    clearDraft(path);
    ed.lastSavedAt = Date.now();
    const now = host?.querySelector<HTMLTextAreaElement>('.vx-editor');
    ed.status = now && now.value !== mine ? 'dirty' : 'saved';
    paintSave();
    return true;
  } catch (e) {
    ed.status = 'error';
    paintSave();
    console.warn('save failed', e);
    return false;
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
  b.innerHTML = `<div class="vx-conflict-head">${I.warn}<div><b>${esc(ed.theirsBy)} changed this note while you were editing.</b>
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
    cancelEdit();
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

interface Sug {
  name: string;
  folder: string;
  /** What goes between the brackets. */
  text: string;
}

let sug: { box: HTMLElement; items: Sug[]; i: number; from: number } | null = null;

/** Link text for a note written from `fromDir`: its name, or Folder/Name when the name is ambiguous elsewhere. */
function linkTextFor(path: string, fromDir: string): string {
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
  // Every note, not every name: same-named notes in different folders both show.
  const items: Sug[] = allNotes()
    .filter((n) => n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        (a.name.toLowerCase().startsWith(q) ? 0 : 1) - (b.name.toLowerCase().startsWith(q) ? 0 : 1) ||
        a.name.localeCompare(b.name) ||
        a.path.localeCompare(b.path),
    )
    .slice(0, 8)
    .map((n) => ({ name: noteTitle(n.path), folder: dirOf(n.path), text: linkTextFor(n.path, from) }));
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
        `<button role="option" aria-selected="${i === cur.i}" class="${i === cur.i ? 'on' : ''}" data-i="${i}">${I.note}<span>${esc(n.name)}</span><small style="margin-left:auto;padding-left:10px;color:var(--muted);font-size:11.5px">${esc(n.folder || ROOT_LABEL)}</small></button>`,
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

// While the open note is renamed or moved: keep it on screen, dimmed, with the verb in the save state.
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
      moveDraft(cur, m.path);
      ed.path = m.path;
      if (state.note !== m.path) replaceHistory();
      state.note = m.path;
      // Our own rename or move says so itself.
      if (!relocating(cur) && !relocating(m.path)) undoToast(`${m.actor || 'An agent'} moved this note to ${m.path}`, null, 'info');
      if (!state.editing) void renderNote(host, m.path, mobileBack, true);
      else draw();
      return;
    }
    if (m.type === 'node_deleted' && m.path === cur && !relocating(cur)) {
      if (state.editing) saveDraft(cur, editorText(), ed.base);
      const trashed = (ev as { trashed?: boolean }).trashed;
      undoToast(`${m.actor || 'An agent'} ${trashed ? 'moved this note to the Trash' : 'deleted this note'}`, null, 'err', 9000);
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
            ed.base = theirs;
            if (ta) ta.value = theirs;
            if (ed.doc) ed.doc.content = theirs;
            undoToast(`${m.actor || 'An agent'} updated this note`, null, 'info', 3000);
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
