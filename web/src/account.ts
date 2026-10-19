// Account chip and quick guide. The chip shows the signed-in username and
// opens a panel with the session details and a sign out action.

import { apiGet, apiPost } from './api';
import { $, $$, esc } from './dom';
import { hooks } from './hooks';
import { PWA } from './pwa';
import { activeAgents } from './realtime';
import { icon } from './ui/icons';
import { state, type Page } from './state';
import { Modal } from './modal';
import { BRAND_DESC, BRAND_MOTTO, BRAND_NAME, BRAND_ONCE, markSvg } from './brand';
import { openWelcome } from './views/welcome';
import { THEME_ICON, THEME_LABEL, setThemePref, themePref, type ThemePref } from './theme';
import { segmented } from './ui/components';
import { toast } from './toast';

interface SessionInfo {
  authenticated?: boolean;
  user?: string;
  username?: string;
  enabled?: boolean;
  expires_in?: number;
}

/** Username of the signed-in account, or an empty string. */
function currentUser(me: SessionInfo | null): string {
  if (!me) return '';
  return (me.user || me.username || '').trim();
}

function initialOf(name: string): string {
  return name ? name.slice(0, 1).toUpperCase() : '?';
}

/** Fill the top bar chip. Falls back to "account" when the name is unknown. */
export function paintAccountChip(me: SessionInfo | null): void {
  const name = currentUser(me);
  document.querySelectorAll<HTMLElement>('[data-username]').forEach((n) => (n.textContent = name || 'account'));
  document.querySelectorAll<HTMLElement>('[data-avatar]').forEach((n) => (n.textContent = initialOf(name)));
  $('#profileBtn').dataset.user = name;
  $('#profileBtn').setAttribute('aria-label', (name ? name + ': ' : '') + 'account and settings');
  myName = name;
}

let myName = '';

/**
 * The account was renamed: update state.me, the chip, an open profile menu
 * and the realtime "me" so every place shows the new name at once.
 */
export function setAccountName(name: string): void {
  const n = name.trim();
  if (!n) return;
  state.me = { ...(state.me || {}), user: n, username: n };
  paintAccountChip(state.me);
  document.querySelectorAll<HTMLElement>('.pm-who b').forEach((b) => (b.textContent = n));
  document.querySelectorAll<HTMLElement>('.pm-head .user-avatar').forEach((a) => (a.textContent = initialOf(n)));
}

export async function signOut(): Promise<void> {
  try {
    await apiPost('/api/auth/logout');
  } catch {
    // The cookie may already be gone; the redirect below still clears the page.
  }
  window.location.replace('/login');
}

/** Open the account panel. Re-reads the session so the data is never stale. */
export async function openAccount(): Promise<void> {
  let me: SessionInfo | null = null;
  try {
    me = await apiGet<SessionInfo>('/api/auth/me');
  } catch {
    me = null;
  }
  const name = currentUser(me);

  if (!name) {
    toast('Your session has ended. Signing you out.', 'warn');
    window.setTimeout(() => window.location.replace('/login'), 700);
    return;
  }

  const mins = me?.expires_in ? Math.round(me.expires_in / 60) : 0;
  const body = `
    <div class="acct">
      <div class="acct-head">
        <span class="acct-avatar">${esc(initialOf(name))}</span>
        <div>
          <div class="acct-name">${esc(name)}</div>
          <div class="acct-sub">${me?.enabled === false ? 'disabled' : 'signed in'}</div>
        </div>
      </div>
      <div class="kv">
        <span class="kv-k">Session expires</span>
        <span class="kv-v">${mins ? mins + ' minutes' : 'on activity'}</span>
      </div>
      <div class="acct-theme"><span>Appearance</span><span id="acctTheme"></span></div>
      <p class="panel-sub">The session renews while you keep using the app. Agents connect with an API key from Agents &amp; keys.</p>
    </div>`;

  Modal.open({
    title: 'Account',
    sub: name,
    body,
    onOpen: (root) => {
      const slot = root.querySelector('#acctTheme');
      if (slot) slot.replaceWith(themeControl());
    },
    actions: [
      { label: 'Close', cls: 'ghost', run: () => Modal.close() },
      {
        label: 'Sign out',
        cls: 'danger',
        run: () => {
          Modal.close();
          void signOut();
        },
      },
    ],
  });
}

/** Dark / Light / System segmented control. */
export function themeControl(): HTMLElement {
  const prefs: ThemePref[] = ['light', 'dark', 'system'];
  return segmented<ThemePref>(
    prefs.map((p) => ({ value: p, label: THEME_LABEL[p], icon: THEME_ICON[p] })),
    themePref(),
    (v) => setThemePref(v),
    'Theme',
  );
}

/** Open the quick guide behind the question mark button. */
export function openGuide(): void {
  const mod = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
  Modal.open({
    title: 'Help & shortcuts',
    sub: 'Memora',
    body: `
      <div class="guide">
        <section class="guide-about" aria-label="What is Memora">
          ${markSvg('guide-mark')}
          <div><b>What is Memora</b><span class="guide-motto">${BRAND_MOTTO}</span></div>
          <p>${BRAND_DESC}</p>
          <p>${BRAND_ONCE}</p>
          <p class="guide-name">${BRAND_NAME}</p>
          <span class="guide-btns"><button type="button" class="btn sm guide-wl" id="guideWelcome">Read the full welcome</button>
          <button type="button" class="btn sm guide-wl" id="guideDocs">${icon('book')}Open documentation</button></span>
        </section>
        <p><b>Brain</b> is home: every note is a point of light, and agent activity pulses through it live.</p>
        <div class="guide-keys">
          <span><kbd>${mod}</kbd><kbd>K</kbd></span><span>Search notes, jump to pages, run actions</span>
          <span><kbd>/</kbd></span><span>Open search from anywhere</span>
          <span><kbd>&gt;</kbd></span><span>In search: actions only (new note, theme ...)</span>
          <span><kbd>Alt</kbd><kbd>1-9</kbd></span><span>Overview, Brain, Nodes, Graph, Canvas, Tags, Activity, Agents, Tools</span>
          <span><kbd>[</kbd></span><span>Collapse or expand the sidebar</span>
        </div>
        <p><b>Live</b> in the top bar shows the realtime connection and how many agents are working right now. Click it for details.</p>
        <p><b>Agents</b> groups the activity feed, API keys and MCP tools; <b>System</b> holds access rules and settings.</p>
        <p>Search understands <code>tag:name</code> to narrow by tag.</p>
      </div>`,
    actions: [{ label: 'Got it', cls: 'primary', run: () => Modal.close() }],
  });
  document.getElementById('guideWelcome')?.addEventListener('click', () => {
    Modal.close();
    openWelcome();
  });
  document.getElementById('guideDocs')?.addEventListener('click', () => {
    Modal.close();
    hooks.go('docs');
  });
}

/* ───────────────────────── profile menu ───────────────────────── */

// Three shapes from one menu: a panel as wide as the sidebar rising from the
// account chip, a popover beside the collapsed rail, and a bottom sheet in
// the phone layout. Same items, same order, same keyboard.

/** Only the phone layout (drawer + bottom tab bar) gets the bottom sheet;
 *  wherever the sidebar or its rail is on screen, the menu hangs off it. */
export const SHEET_QUERY = '(max-width: 760px)';

type MenuMode = 'panel' | 'rail' | 'sheet';

let menuReturn: HTMLElement | null = null;
let menuAnchor: HTMLElement | null = null;
let menuMode: MenuMode = 'panel';
let closeTimer = 0;
let unwire: (() => void) | null = null;

export function profileMenuOpen(): boolean {
  const menu = $('#profileMenu');
  return !menu.classList.contains('hidden') && !menu.classList.contains('pm-closing');
}

function modeFor(anchor: HTMLElement): MenuMode {
  if (window.matchMedia(SHEET_QUERY).matches) return 'sheet';
  return anchor.getBoundingClientRect().width < 80 ? 'rail' : 'panel';
}

function placeMenu(menu: HTMLElement, anchor: HTMLElement): void {
  const st = menu.style;
  st.left = st.right = st.top = st.bottom = st.width = st.maxHeight = '';
  menuMode = modeFor(anchor);
  menu.dataset.mode = menuMode;
  menu.classList.toggle('sheet', menuMode === 'sheet');
  if (menuMode === 'sheet') return;
  const r = anchor.getBoundingClientRect();
  if (menuMode === 'rail') {
    // Beside the rail, a clear gap from its edge, bottom aligned to the chip.
    const side = document.getElementById('sidebar')?.getBoundingClientRect();
    st.left = (side ? side.right : r.right) + 12 + 'px';
    st.bottom = Math.max(10, window.innerHeight - r.bottom) + 'px';
    st.maxHeight = Math.max(240, r.bottom - 12) + 'px';
  } else {
    // As wide as the sidebar's content (its width minus the footer's side
    // padding, the same inset as the rows above), just above the chip.
    const foot = anchor.closest<HTMLElement>('.side-foot');
    const box = (foot || anchor).getBoundingClientRect();
    const cs = foot ? getComputedStyle(foot) : null;
    const padL = cs ? parseFloat(cs.paddingLeft) || 0 : 0;
    const padR = cs ? parseFloat(cs.paddingRight) || 0 : 0;
    st.left = box.left + padL + 'px';
    st.width = Math.max(200, box.width - padL - padR) + 'px';
    st.bottom = window.innerHeight - r.top + 8 + 'px';
    st.maxHeight = Math.max(240, r.top - 20) + 'px';
  }
}

/** True when installing is possible and the app is not already installed. */
function canInstall(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return false;
  return !!PWA.prompt || !$('#pwaBtn').classList.contains('hidden');
}

/** Tab stops and arrow targets, in visual order. */
function menuStops(menu: HTMLElement): HTMLElement[] {
  return $$<HTMLElement>('.pm-close,.pm-theme button,.pm-item', menu).filter((b) => b.offsetParent !== null);
}

/** The account menu: appearance, agents, system, help, sign out. */
export function openProfileMenu(anchor: HTMLElement): void {
  const menu = $('#profileMenu');
  if (profileMenuOpen()) {
    closeProfileMenu(true);
    return;
  }
  window.clearTimeout(closeTimer);
  unwire?.();
  menu.classList.remove('pm-closing', 'pm-open');
  menu.style.transform = menu.style.transition = '';
  menuReturn = anchor;
  menuAnchor = anchor;
  const live = activeAgents().length;
  const alt = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌥' : 'Alt';
  const ver = state.health.version ? 'v' + state.health.version : '';
  const item = (page: Page, label: string, ico: string, extra = ''): string =>
    `<button class="pm-item" role="menuitem" type="button" data-page="${page}">${icon(ico)}<span class="pm-label">${esc(
      label,
    )}</span>${extra}</button>`;
  const keys = (n: number): string => `<span class="pm-keys alt" aria-hidden="true"><kbd>${alt}</kbd><kbd>${n}</kbd></span>`;
  const group = (id: string, label: string, body: string): string =>
    `<div class="pm-group" role="group" aria-labelledby="pmg-${id}"><div class="pm-glabel" id="pmg-${id}">${label}</div>${body}</div>`;
  menu.innerHTML = `
    <div class="pm-grab" aria-hidden="true"></div>
    <div class="pm-head">
      <span class="user-avatar lg">${esc(initialOf(myName))}</span>
      <div class="pm-who"><b>${esc(myName || 'account')}</b><span><i class="pm-dot"></i>Signed in${ver ? ` <em>·</em> <span title="Memora version">${esc(ver)}</span>` : ''}</span></div>
      <button class="pm-close icon-btn" type="button" aria-label="Close menu">${icon('close')}</button>
    </div>
    <div class="pm-theme" role="group" aria-labelledby="pmg-theme"><div class="pm-glabel" id="pmg-theme">Appearance</div><span id="pmTheme"></span></div>
    ${group(
      'agents',
      'Agents',
      item('logs', 'Activity', 'activity', live ? `<span class="pm-live"><i></i>${live} live</span>` : keys(7)) +
        item('keys', 'Agents & API keys', 'key', keys(8)) +
        item('tools', 'Tools', 'tools', keys(9)),
    )}
    ${group('system', 'System', item('access', 'Access rules', 'shield') + item('settings', 'Settings', 'settings'))}
    ${group(
      'help',
      'Help',
      item('docs', 'Documentation', 'book') +
        `<button class="pm-item" role="menuitem" type="button" data-act="guide">${icon('help')}<span class="pm-label">Help & shortcuts</span><span class="pm-keys" aria-hidden="true"><kbd>?</kbd></span></button>
      <button class="pm-item" role="menuitem" type="button" data-act="welcome">${icon('sparkle')}<span class="pm-label">Welcome to Memora</span></button>` +
        (canInstall()
          ? `<button class="pm-item" role="menuitem" type="button" data-act="install">${icon('download')}<span class="pm-label">Install app</span></button>`
          : ''),
    )}
    <div class="pm-sep" role="separator"></div>
    <button class="pm-item danger" role="menuitem" type="button" data-act="signout">${icon('logout')}<span class="pm-label">Sign out</span></button>`;

  // Appearance: a menuitemradio group, kept in sync with the segmented control.
  const slot = menu.querySelector('#pmTheme');
  if (slot) {
    const seg = themeControl();
    const sync = (): void =>
      seg.querySelectorAll<HTMLElement>('button').forEach((b) => b.setAttribute('aria-checked', b.getAttribute('aria-pressed') || 'false'));
    seg.querySelectorAll<HTMLElement>('button').forEach((b) => {
      b.setAttribute('role', 'menuitemradio');
      b.addEventListener('click', sync);
    });
    sync();
    slot.replaceWith(seg);
  }
  $('.pm-close', menu).onclick = () => closeProfileMenu(true);
  $$('.pm-item', menu).forEach((b) => {
    const on = !!b.dataset.page && b.dataset.page === state.page;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    b.onclick = () => {
      const page = b.dataset.page as Page | undefined;
      const act = b.dataset.act;
      closeProfileMenu(false);
      if (page) hooks.go(page);
      else if (act === 'guide') openGuide();
      else if (act === 'welcome') openWelcome();
      else if (act === 'install') void PWA.install();
      else if (act === 'signout') void signOut();
    };
  });
  menu.onkeydown = (e) => onMenuKey(menu, e);

  placeMenu(menu, anchor);
  menu.classList.remove('hidden');
  $('#pmScrim').classList.toggle('dim', menuMode === 'sheet');
  $('#pmScrim').classList.remove('hidden', 'on');
  anchor.setAttribute('aria-expanded', 'true');
  // Start from the closed pose, then let the transition carry it in.
  void menu.offsetHeight;
  requestAnimationFrame(() => {
    menu.classList.add('pm-open');
    $('#pmScrim').classList.add('on');
    // Sheets focus Close (no stray ring on a touch list); menus the first item.
    $(menuMode === 'sheet' ? '.pm-close' : '.pm-item', menu).focus?.({ preventScroll: true });
  });
  unwire = wireMenu(menu, anchor);
}

function onMenuKey(menu: HTMLElement, e: KeyboardEvent): void {
  const stops = menuStops(menu);
  const cur = document.activeElement as HTMLElement;
  const i = stops.indexOf(cur);
  const inSeg = !!cur?.closest('.pm-theme');
  // Up and down move by row: the three theme buttons count as one row.
  const rows = stops.filter((b) => !b.closest('.pm-theme') || b.getAttribute('aria-pressed') === 'true' || b === cur);
  const r = rows.indexOf(cur);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = e.key === 'ArrowDown' ? (r + 1) % rows.length : (r - 1 + rows.length) % rows.length;
    rows[r < 0 ? 0 : n].focus();
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && inSeg) {
    e.preventDefault();
    const seg = $$<HTMLElement>('.pm-theme button', menu);
    const k = seg.indexOf(cur);
    seg[(k + (e.key === 'ArrowRight' ? 1 : seg.length - 1)) % seg.length].focus();
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    rows[e.key === 'Home' ? 0 : rows.length - 1].focus();
  } else if (e.key === 'Tab') {
    // Focus stays inside while the menu is open.
    e.preventDefault();
    const n = e.shiftKey ? (i - 1 + stops.length) % stops.length : (i + 1) % stops.length;
    stops[i < 0 ? 0 : n].focus();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeProfileMenu(true);
  } else if (e.key === '?') {
    e.preventDefault();
    closeProfileMenu(false);
    openGuide();
  } else if (e.key === '[') {
    // The rail toggle would leave the menu floating in the wrong place.
    e.preventDefault();
  }
}

/** Live wiring while open: follow resizes, and drag the sheet down to close. */
function wireMenu(menu: HTMLElement, anchor: HTMLElement): () => void {
  const onResize = (): void => {
    if (!profileMenuOpen()) return;
    if (modeFor(anchor) !== menuMode || !document.contains(anchor) || anchor.getClientRects().length === 0) closeProfileMenu(false);
    else placeMenu(menu, anchor);
  };
  window.addEventListener('resize', onResize);

  let y0 = 0;
  let t0 = 0;
  let dy = 0;
  let can = false;
  let dragging = false;
  const scrim = $('#pmScrim');
  const start = (e: TouchEvent): void => {
    if (menuMode !== 'sheet' || e.touches.length !== 1) return;
    y0 = e.touches[0].clientY;
    t0 = performance.now();
    dy = 0;
    dragging = false;
    // From the handle or header always; elsewhere only when scrolled to the top.
    can = !!(e.target as HTMLElement).closest('.pm-grab,.pm-head') || menu.scrollTop <= 0;
  };
  const move = (e: TouchEvent): void => {
    if (!can) return;
    dy = e.touches[0].clientY - y0;
    if (!dragging && dy > 6) {
      dragging = true;
      menu.style.transition = 'none';
    }
    if (!dragging) return;
    e.preventDefault();
    const d = Math.max(0, dy);
    menu.style.transform = `translateY(${d}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - d / (menu.offsetHeight || 1)));
  };
  const end = (): void => {
    if (!dragging) return;
    dragging = false;
    const v = dy / Math.max(1, performance.now() - t0);
    menu.style.transition = '';
    scrim.style.opacity = '';
    if (dy > Math.min(120, menu.offsetHeight / 3) || v > 0.6) closeProfileMenu(true);
    else menu.style.transform = '';
  };
  menu.addEventListener('touchstart', start, { passive: true });
  menu.addEventListener('touchmove', move, { passive: false });
  menu.addEventListener('touchend', end);
  menu.addEventListener('touchcancel', end);
  return () => {
    window.removeEventListener('resize', onResize);
    menu.removeEventListener('touchstart', start);
    menu.removeEventListener('touchmove', move);
    menu.removeEventListener('touchend', end);
    menu.removeEventListener('touchcancel', end);
  };
}

export function closeProfileMenu(refocus = true): void {
  const menu = $('#profileMenu');
  if (!profileMenuOpen()) return;
  unwire?.();
  unwire = null;
  const scrim = $('#pmScrim');
  menu.classList.add('pm-closing');
  menu.classList.remove('pm-open');
  // A dragged sheet carries on from where the finger let go.
  if (menu.style.transform) menu.style.transform = '';
  scrim.classList.remove('on');
  menuAnchor?.setAttribute('aria-expanded', 'false');
  if (refocus && menuReturn && document.contains(menuReturn)) menuReturn.focus({ preventScroll: true });
  menuReturn = null;
  menuAnchor = null;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(
    () => {
      menu.classList.add('hidden');
      menu.classList.remove('pm-closing', 'sheet');
      menu.innerHTML = '';
      menu.style.transform = menu.style.transition = '';
      scrim.classList.add('hidden');
      scrim.classList.remove('dim');
    },
    reduce ? 0 : menuMode === 'sheet' ? 240 : 150,
  );
}
