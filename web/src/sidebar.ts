// Sidebar shell: New node and Search, the content pages, the Library tree and
// the profile button at the bottom (system pages live in its menu). Collapses
// to a slim icon rail on desktop; on phones it is a drawer next to a bottom
// tab bar.
//
// The folder tree belongs to the Vault package: main.ts mounts it into
// `#tree` through `mountSidebarTree`, and `renderTree()` delegates to the
// renderer it installs in `hooks.renderTree`. The simple tree below is only a
// fallback for when that mount fails.

import { requestSettingsSection } from './version';
import { $, $$, el, esc, attr } from './dom';
import { noteName } from './format';
import { hooks } from './hooks';
import { CARET, ICO_GEO, ICO_MOVE, ICO_PIN, ICO_PIN_OFF, ICO_TRASH } from './icons';
import { CONTENT_PAGES, PAGE_META, PAGES, onNavigate } from './router';
import { saveOpenFolders, saveUI, ui } from './storage';
import { isPinned, pinnedItems, togglePin, unpin } from './vault/store';
import { colorOfFolder, folderNames, state, type Page } from './state';
import { DEFAULT_RENDER_TREE } from './ui/hook-snapshot';
import { icon } from './ui/icons';
import type { NoteRef } from './types';

const MOBILE = '(max-width: 760px)';

export function isMobile(): boolean {
  return window.matchMedia(MOBILE).matches;
}

/** `Alt+n` shortcut index for a page (1-based), in navigation order. */
export function shortcutOf(page: Page): number {
  return PAGES.indexOf(page) + 1;
}

/* ───────────────────────── navigation ───────────────────────── */

// Pages still routable (links, search) but left out of the sidebar.
const NAV_HIDDEN = new Set<Page>(['graph', 'canvas', 'tags']);

function buildNav(): void {
  const nav = $('#nav');
  nav.innerHTML = '';
  // Overview leads the list (the logo goes there too); Activity follows the
  // content pages, the same five places as the phone tab bar.
  for (const p of ['home', ...CONTENT_PAGES, 'logs'] as Page[]) {
    if (NAV_HIDDEN.has(p)) continue;
    const m = PAGE_META[p];
    const n = shortcutOf(p);
    const b = el(
      'button',
      'nav-item',
      `${icon(m.icon)}<span class="ni-label">${esc(m.label)}</span>${
        n <= 9 ? `<span class="ni-kbd" aria-hidden="true">Alt ${n}</span>` : ''
      }`,
    );
    b.type = 'button';
    b.dataset.page = p;
    b.dataset.tip = m.label;
    if (n <= 9) b.dataset.kbd = 'Alt ' + n;
    b.setAttribute('aria-label', m.label);
    b.onclick = () => {
      // "Nodes" in the nav means the list, not the last node read.
      if (p === 'vault') state.note = null;
      hooks.go(p);
    };
    nav.appendChild(b);
  }
}

/* ───────────────────────── library section ───────────────────────── */

/** Library is always shown; its button folds or unfolds Pinned and Folders together. */
function wireLibrary(): void {
  const head = document.getElementById('libHead');
  const box = head?.closest('.side-sec') as HTMLElement | null;
  if (!head || !box) return;
  box.classList.remove('collapsed');
  box.querySelector<HTMLElement>('.sec-inner')?.removeAttribute('inert');
  const fold = document.getElementById('libFold');
  const toggle = (): void => {
    window.dispatchEvent(new Event('memora:sections-toggle'));
  };
  head.title = 'Fold or unfold Pinned and Folders';
  head.onclick = toggle;
  if (fold) fold.onclick = toggle;
  window.addEventListener('memora:sections', (e) => {
    const open = !!(e as CustomEvent<{ anyOpen: boolean }>).detail?.anyOpen;
    head.setAttribute('aria-expanded', String(open));
    fold?.setAttribute('aria-expanded', String(open));
    fold?.classList.toggle('folded', !open);
  });
  window.dispatchEvent(new Event('memora:sections-ask'));
}

/* ───────────────────────── live agent badges ───────────────────────── */

let flipTimer = 0;

/** Show how many agents are active right now (tab bar, profile button). */
export function setLiveAgents(n: number): void {
  const txt = n > 99 ? '99+' : String(n);
  $$<HTMLElement>('[data-live-badge]').forEach((b) => {
    b.textContent = txt;
    b.classList.toggle('on', n > 0);
    b.setAttribute('aria-label', n + ' active agents');
  });
  // The footer shows vault size; while agents run it alternates with their count.
  const sub = $('#profileSub');
  if (n > 0) $('#profileLive').textContent = `${txt} agent${n === 1 ? '' : 's'} running`;
  sub.classList.toggle('live', n > 0);
  if (n > 0 && !flipTimer) {
    sub.classList.add('flip');
    flipTimer = window.setInterval(() => sub.classList.toggle('flip'), 3200);
  } else if (n === 0 && flipTimer) {
    clearInterval(flipTimer);
    flipTimer = 0;
    sub.classList.remove('flip');
  }
}

/* ───────────────────────── rail, drawer ───────────────────────── */

function railMode(): boolean {
  return $('#app').classList.contains('side-collapsed') && !isMobile();
}

function paintCollapse(): void {
  const collapsed = $('#app').classList.contains('side-collapsed');
  const b = $('#sideCollapse');
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  b.setAttribute('aria-label', label);
  const text = b.querySelector('.sc-label');
  if (text) text.textContent = collapsed ? 'Expand' : 'Collapse';
  b.setAttribute('aria-expanded', String(!collapsed));
  b.dataset.tip = label;
  b.dataset.kbd = '[';
  b.title = label + ' ([)';
}

/** Collapsed rail: the vault size (nodes, links, folders) on demand. */
function wireStatsPop(): void {
  const btn = $('#sideStats');
  const pop = $('#sideStatsPop');
  const close = (): void => {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (e: Event): void => {
    if (!pop.contains(e.target as Node) && !btn.contains(e.target as Node)) close();
  };
  btn.onclick = () => {
    if (!pop.hidden) return close();
    hideTip();
    const n = (v: number | undefined): string => (v || 0).toLocaleString();
    pop.innerHTML = `<h4>Vault</h4><dl><dt>Nodes</dt><dd>${n(state.stats.notes)}</dd><dt>Links</dt><dd>${n(state.stats.links)}</dd><dt>Folders</dt><dd>${n(state.stats.folders)}</dd></dl>`;
    const r = btn.getBoundingClientRect();
    pop.style.left = $('#sidebar').getBoundingClientRect().right + 8 + 'px';
    pop.style.top = '0px';
    pop.hidden = false;
    pop.style.top = Math.max(8, r.bottom - pop.offsetHeight) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
  };
  onNavigate(() => close());
}

export function toggleCollapsed(force?: boolean): void {
  const app = $('#app');
  const next = force ?? !app.classList.contains('side-collapsed');
  app.classList.toggle('side-collapsed', next);
  // Expanding the rail shows the tree with every folder closed.
  if (!next) window.dispatchEvent(new Event('memora:collapse-folders'));
  ui.collapsed = next;
  saveUI();
  hideTip();
  paintCollapse();
  // Canvas-based views (brain, graph, canvas) follow the sidebar every frame
  // of its width transition instead of jumping once it ends.
  const until = performance.now() + 380;
  const tick = (): void => {
    window.dispatchEvent(new Event('resize'));
    if (performance.now() < until) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let drawerReturn: HTMLElement | null = null;

export function openDrawer(): void {
  const app = $('#app');
  if (app.classList.contains('side-open')) return;
  drawerReturn = document.activeElement as HTMLElement | null;
  window.dispatchEvent(new Event('memora:collapse-folders'));
  app.classList.add('side-open');
  $('#sidebar').setAttribute('aria-modal', 'true');
  $('#sidebar').setAttribute('role', 'dialog');
  window.setTimeout(() => {
    const active = document.querySelector<HTMLElement>('#nav .nav-item.active');
    (active || document.getElementById('sideClose'))?.focus();
  }, 60);
}

export function closeDrawer(): void {
  const app = $('#app');
  if (!app.classList.contains('side-open')) return;
  app.classList.remove('side-open');
  $('#sidebar').removeAttribute('aria-modal');
  $('#sidebar').removeAttribute('role');
  if (drawerReturn && document.contains(drawerReturn)) drawerReturn.focus();
  drawerReturn = null;
}

function wireDrawerGestures(): void {
  const side = document.getElementById('sidebar');
  if (!side) return;
  let x0 = 0;
  let y0 = 0;
  let dx = 0;
  let tracking = false;
  side.addEventListener(
    'touchstart',
    (e) => {
      if (!isMobile() || e.touches.length !== 1) return;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      dx = 0;
      tracking = true;
    },
    { passive: true },
  );
  side.addEventListener(
    'touchmove',
    (e) => {
      if (!tracking) return;
      dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0;
      if (Math.abs(dy) > Math.abs(dx)) {
        tracking = false;
        side.style.transform = '';
        return;
      }
      if (dx < 0) side.style.transform = `translateX(${dx}px)`;
    },
    { passive: true },
  );
  side.addEventListener('touchend', () => {
    if (!tracking) return;
    tracking = false;
    side.style.transform = '';
    if (dx < -70) closeDrawer();
  });
}

/* ───────────────────────── rail tooltip ───────────────────────── */

function showTip(target: HTMLElement): void {
  if (!railMode()) return;
  const label = target.dataset.tip || target.getAttribute('aria-label') || '';
  if (!label) return;
  const tip = $('#navTip');
  tip.innerHTML = esc(label) + (target.dataset.kbd ? `<kbd>${esc(target.dataset.kbd)}</kbd>` : '');
  const r = target.getBoundingClientRect();
  // Clear of the rail's border line, not just of the button.
  const edge = document.getElementById('sidebar')?.getBoundingClientRect().right ?? r.right;
  tip.style.left = Math.max(edge, r.right) + 10 + 'px';
  tip.style.top = r.top + (r.height - (tip.offsetHeight || 30)) / 2 + 'px';
  tip.classList.add('on');
}

function hideTip(): void {
  $('#navTip').classList.remove('on');
}

function wireTips(): void {
  const side = document.getElementById('sidebar');
  if (!side) return;
  const pick = (e: Event): HTMLElement | null =>
    (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
  side.addEventListener('mouseover', (e) => {
    const t = pick(e);
    if (t) showTip(t);
    else hideTip();
  });
  side.addEventListener('mouseleave', hideTip);
  side.addEventListener('focusin', (e) => {
    const t = pick(e);
    if (t && t.matches(':focus-visible')) showTip(t);
  });
  side.addEventListener('focusout', hideTip);
  side.addEventListener('click', hideTip);
  $('.side-scroll').addEventListener?.('scroll', hideTip, { passive: true });
}

/* ───────────────────────── mobile tab bar ───────────────────────── */

interface TabDef {
  id: string;
  label: string;
  icon: string;
  page?: Page;
  run?: () => void;
}

function buildTabbar(openProfile: (anchor: HTMLElement) => void): void {
  const bar = $('#tabbar');
  // Five slots with Brain, the raised primary button, in the middle. Search
  // is the header's (always on top), so the bar starts with Overview.
  const tabs: TabDef[] = [
    { id: 'home', label: 'Overview', icon: 'overview', page: 'home' },
    { id: 'nodes', label: 'Nodes', icon: 'note', page: 'vault' },
    { id: 'brain', label: 'Brain', icon: 'brain', page: 'brain' },
    { id: 'logs', label: 'Activity', icon: 'activity', page: 'logs' },
    { id: 'profile', label: 'Profile', icon: 'user' },
  ];
  bar.innerHTML = '';
  for (const t of tabs) {
    const b = el(
      'button',
      t.id === 'brain' ? 'tab-item prime' : 'tab-item',
      `<span class="ti-ico">${t.id === 'profile' ? '<span class="user-avatar sm" data-avatar>?</span>' : icon(t.icon)}${
        t.page === 'logs' ? '<span class="ti-badge" data-live-badge></span>' : ''
      }</span><span>${esc(t.label)}</span>`,
    );
    b.type = 'button';
    b.setAttribute('aria-label', t.label);
    if (t.page) {
      b.dataset.page = t.page;
      b.onclick = () => {
        if (t.page === 'vault' && state.page === 'vault') state.note = null;
        hooks.go(t.page as Page);
      };
    } else {
      b.dataset.tab = t.id;
      if (t.id === 'profile') {
        b.setAttribute('aria-haspopup', 'menu');
        b.setAttribute('aria-expanded', 'false');
        b.onclick = () => openProfile(b);
      } else b.onclick = () => t.run?.();
    }
    bar.appendChild(b);
  }
  // "Profile" lights up for the system pages that live in its menu.
  onNavigate((page) => {
    $('[data-tab="profile"]', bar).classList.toggle('active', PAGE_META[page].group === 'system' && page !== 'logs' && page !== 'home');
  });
}

/* ───────────────────────── wiring ───────────────────────── */

export interface SidebarDeps {
  openSearch: () => void;
  openProfile: (anchor: HTMLElement) => void;
}

export function initSidebar(deps: SidebarDeps): void {
  buildNav();
  buildTabbar(deps.openProfile);
  wireLibrary();

  // Desktop: remembered rail state; tablets start as a rail.
  const w = window.innerWidth;
  const startCollapsed = ui.collapsed || (w > 760 && w < 1100);
  $('#app').classList.toggle('side-collapsed', startCollapsed);
  paintCollapse();

  $('#sideCollapse').onclick = () => toggleCollapsed();
  wireStatsPop();
  $('#sideToggle').onclick = () => openDrawer();
  $('#sideClose').onclick = () => closeDrawer();
  $('#sideScrim').onclick = () => closeDrawer();
  $('#sideNewNode').onclick = () => hooks.openNewNote();
  // Collapsed rail: a click on any empty spot expands it; the icons keep
  // doing what they do.
  $('#sidebar').addEventListener('click', (e) => {
    if (!railMode()) return;
    if ((e.target as HTMLElement).closest('button,a,input,select,textarea,[role="button"],[role="treeitem"]')) return;
    toggleCollapsed(false);
  });
  $('#brandHome').onclick = () => hooks.go('home');
  $('#brandVersion').onclick = () => {
    requestSettingsSection('stVersion');
    hooks.go('settings');
  };
  $('#newFolderBtn').onclick = () => hooks.openNewFolder();
  $('#profileBtn').onclick = () => {
    hideTip();
    deps.openProfile($('#profileBtn'));
  };

  // Folder filter (fallback tree only; the Vault tree has its own tools).
  const filter = document.getElementById('sideSearch') as HTMLInputElement | null;
  if (filter) {
    filter.value = state.filter;
    filter.oninput = () => {
      state.filter = filter.value;
      $('#sideSearchClear').classList.toggle('hidden', !filter.value);
      hooks.refreshTree();
    };
    $('#sideSearchClear').onclick = () => {
      filter.value = '';
      filter.dispatchEvent(new Event('input'));
      filter.focus();
    };
  }

  onNavigate(() => hideTip());

  window.matchMedia(MOBILE).addEventListener?.('change', () => closeDrawer());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#app').classList.contains('side-open')) {
      e.preventDefault();
      closeDrawer();
    }
  });
  wireTips();
  wireDrawerGestures();
}

/* ───────────────────────── vault tree host ───────────────────────── */

/**
 * Mount the Vault package's tree (pins + folders) into the sidebar. It then
 * owns `#tree`; the shell's own pinned list and filter are hidden.
 */
export function mountSidebarTree(mount: (host: HTMLElement) => unknown): boolean {
  const host = document.getElementById('tree');
  if (!host) return false;
  try {
    mount(host);
  } catch (e) {
    console.error('vault tree failed to mount; using the shell tree', e);
    return false;
  }
  $('#sideVault').classList.add('vx');
  return true;
}

let delegating = false;

/**
 * Redraw the folder tree and the pinned list. Delegates to the Vault package's
 * renderer when it installed one through `hooks.renderTree`.
 */
export function renderTree(): void {
  const ext = hooks.renderTree;
  if (!delegating && ext !== renderTree && ext !== DEFAULT_RENDER_TREE) {
    delegating = true;
    try {
      ext();
    } finally {
      delegating = false;
    }
    return;
  }
  fallbackTree();
}

function fallbackTree(): void {
  const host = $('#tree');
  host.innerHTML = '';
  const q = state.filter.trim().toLowerCase();
  const names = folderNames().filter((f) => {
    if (!q) return true;
    if (f.toLowerCase().includes(q)) return true;
    return (state.tree[f] || []).some(
      (n) => n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q),
    );
  });
  if (!names.length) {
    host.appendChild(el('div', 'tree-empty', q ? 'No folder or note matches.' : 'No folders yet.'));
    renderPinned();
    return;
  }
  for (const f of names) host.appendChild(folderNode(f, q));
  renderPinned();
}

function folderNode(folder: string, q: string): HTMLElement {
  const notes = (state.tree[folder] || []).filter(
    (n) =>
      !q ||
      folder.toLowerCase().includes(q) ||
      n.name.toLowerCase().includes(q) ||
      n.path.toLowerCase().includes(q),
  );
  const box = el('div', 'folder');
  box.dataset.folder = folder;
  box.style.setProperty('--fc', colorOfFolder(folder));

  const row = el('div', 'folder-row');
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.appendChild(el('span', '', CARET));
  row.appendChild(el('span', 'f-ico'));
  row.appendChild(el('span', 'f-name', esc(folder)));
  row.appendChild(el('span', 'f-count', String((state.tree[folder] || []).length)));

  const acts = el('span', 'f-acts');
  acts.appendChild(pinBtn('folder', folder));
  acts.appendChild(smallBtn(ICO_MOVE, 'Move notes in folder', () => hooks.openMoveFolder(folder)));
  acts.appendChild(smallBtn(ICO_GEO, 'Set folder color', () => hooks.openFolderColor(folder)));
  acts.appendChild(smallBtn(ICO_TRASH, 'Delete folder', () => hooks.confirmDeleteFolder(folder)));
  row.appendChild(acts);
  box.appendChild(row);

  const body = el('div', 'f-body');
  const inner = el('div', 'f-body-inner');
  if (!notes.length) inner.appendChild(el('div', 'tree-empty', 'Empty'));
  for (const n of notes) inner.appendChild(noteNode(n));
  body.appendChild(inner);
  box.appendChild(body);

  const toggle = (): void => toggleFolder(box, folder);
  row.onclick = (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    toggle();
  };
  row.onkeydown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === row) {
      e.preventDefault();
      toggle();
    }
  };
  const open = state.open.has(folder) || !!q;
  row.setAttribute('aria-expanded', String(open));
  if (open) {
    box.classList.add('open');
    body.style.height = 'auto';
  }
  return box;
}

function toggleFolder(box: HTMLElement, folder: string): void {
  const body = $('.f-body', box);
  const row = $('.folder-row', box);
  const isOpen = box.classList.contains('open');
  row.setAttribute('aria-expanded', String(!isOpen));
  if (isOpen) {
    body.style.height = body.scrollHeight + 'px';
    requestAnimationFrame(() => {
      body.style.height = '0px';
    });
    box.classList.remove('open');
    state.open.delete(folder);
    saveOpenFolders(state.open);
    return;
  }
  state.open.add(folder);
  saveOpenFolders(state.open);
  box.classList.add('open');
  body.style.height = body.scrollHeight + 'px';
  body.addEventListener('transitionend', function done(ev) {
    if (ev.propertyName !== 'height') return;
    body.style.height = 'auto';
    body.removeEventListener('transitionend', done);
  });
}

function noteNode(note: NoteRef): HTMLElement {
  const row = el('div', 'note-row');
  row.dataset.path = note.path;
  row.tabIndex = 0;
  row.setAttribute('role', 'link');
  row.classList.toggle('active', state.note === note.path);
  row.appendChild(el('span', 'n-dot'));
  row.appendChild(el('span', 'n-name', esc(note.name)));

  const acts = el('span', 'n-acts');
  acts.appendChild(pinBtn('note', note.path));
  acts.appendChild(smallBtn(ICO_MOVE, 'Move note', () => hooks.openMoveNote(note.path)));
  row.appendChild(acts);

  row.onclick = (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    closeDrawer();
    hooks.openNote(note.path);
  };
  row.onkeydown = (e) => {
    if (e.key === 'Enter' && e.target === row) {
      closeDrawer();
      hooks.openNote(note.path);
    }
  };
  return row;
}

function smallBtn(ico: string, title: string, fn: () => void): HTMLElement {
  const b = el('button', '', ico);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.onclick = (e) => {
    e.stopPropagation();
    fn();
  };
  return b;
}

function pinBtn(kind: 'note' | 'folder', key: string): HTMLElement {
  const pinned = isPinned(kind, key);
  const b = smallBtn(pinned ? ICO_PIN_OFF : ICO_PIN, pinned ? 'Unpin' : 'Pin', () => {
    togglePin({ kind, key });
    renderTree();
  });
  if (pinned) b.style.color = 'var(--warn)';
  return b;
}

function renderPinned(): void {
  const host = $('#pinnedList');
  host.innerHTML = '';
  const items = pinnedItems().map((p) => ({ ...p, label: p.kind === 'note' ? noteName(p.key) : p.key }));
  $('#pinCount').textContent = String(items.length);
  if (!items.length) {
    host.appendChild(el('div', 'tree-empty', 'Pin notes or folders for quick access.'));
    return;
  }
  for (const it of items) {
    const row = el('div', 'pin-row');
    const open = el('button', 'pin-open');
    open.type = 'button';
    open.innerHTML = `<span class="p-tag">${it.kind}</span><span class="p-name" title="${attr(
      it.key,
    )}">${esc(it.label)}</span>`;
    open.onclick = () => {
      closeDrawer();
      if (it.kind === 'note') {
        hooks.openNote(it.key);
      } else {
        state.open.add(it.key);
        saveOpenFolders(state.open);
        hooks.go('vault');
        renderTree();
      }
    };
    const x = el('button', 'p-x', '&#10005;');
    x.type = 'button';
    x.title = 'Unpin';
    x.setAttribute('aria-label', 'Unpin ' + it.label);
    x.onclick = () => {
      unpin(it);
      renderTree();
    };
    row.appendChild(open);
    row.appendChild(x);
    host.appendChild(row);
  }
}
