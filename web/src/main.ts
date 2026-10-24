// Must stay the first import: snapshots the hooks.ts defaults before any package installs its own.
import { DEFAULT_REFRESH_TREE, DEFAULT_RENDER_TREE } from './ui/hook-snapshot';
import './global.css';
import { updateInfo, type UpdateInfo } from './version';
import { apiGet } from './api';
import {
  confirmDeleteFolder,
  openFolderColor,
  openMoveFolder,
  openMoveNote,
  openNewFolder,
  openNewNote,
} from './actions';
import { closeProfileMenu, openAccount, openGuide, openProfileMenu, paintAccountChip, signOut } from './account';
import { $, useStyles } from './dom';
import { BRAND_FONT, BRAND_FONT_CSS } from './brand-font';
import { UI_FONT_CSS, UI_MONO_CSS } from './ui-font';
import { loadCore } from './core-data';
import { hooks } from './hooks';
import { PWA } from './pwa';
import { RT, onAgents } from './realtime';
import {
  PAGE_META,
  PAGES,
  findNode,
  go,
  onNavigate,
  openDocs,
  paintTitle,
  parseLocation,
  refreshPage,
  registerView,
  replaceHistory,
  resolveRoute,
  type Route,
} from './router';
import { closeDrawer, initSidebar, isMobile, mountSidebarTree, renderTree, setLiveAgents, toggleCollapsed } from './sidebar';
import { closePalette, openPalette, registerCommands, wireSearch } from './search';
import { state } from './state';
import { clearPeek, openPeek } from './peek';
import { initLightbox } from './ui/lightbox';
import { initVault, mountTree, openNote, renderTrash, renderVault } from './vault/index';
import { renderHome } from './views/home';
import { renderGraph } from './views/graph';
import { renderTags } from './views/tags';
import { renderLogs } from './views/logs';
import { connectOnLoad, renderKeys } from './views/keys';
import { renderTools } from './views/tools';
import { renderBrain } from './views/brain';
import { renderCanvas } from './views/canvas';
import { renderAccess } from './views/access';
import { renderSettings } from './views/settings';
import { renderDocs } from './views/docs';
import { applyTheme, cycleTheme, setThemePref } from './theme';
import { fetchSettings, reloadVaultData, vaultSwitch } from './vault';
import { showVaultOnboarding } from './views/onboarding';
import { maybeWelcome, openWelcome } from './views/welcome';
import { maybeWhatsNew } from './ui/whats-new';
import { initPullRefresh } from './ui/pull-refresh';
import { initToTop } from './ui/totop';
import { initMapEnter } from './ui/map-enter';
import { closeNotFound, isNotFoundOpen, showNotFound } from './ui/notfound';
import { initToasts, notify, toast } from './toast';
import { markUpdateNoticeSeen, updateNoticeSeen } from './storage';
import { installStyles } from './ui';
import type { BootSplash } from './boot-splash';
import type { Page } from './state';
import type { SettingsInfo } from './types';

// Styles first, so nothing paints unstyled once the splash fades.
installStyles();

function isTyping(t: EventTarget | null): boolean {
  const n = t as HTMLElement | null;
  if (!n) return false;
  return n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable;
}

async function reloadAll(): Promise<void> {
  await loadCore();
  refreshPage();
  toast('Data reloaded', 'ok', 1600);
}

/** One warning toast per new release and device; a later sign-in stays quiet. */
function announceUpdate(u: UpdateInfo): void {
  if (!u.available || !u.latest || updateNoticeSeen() === u.latest) return;
  markUpdateNoticeSeen(u.latest);
  const url = u.url;
  notify(`Memora v${u.latest} is available. This server runs v${u.current}.`, 'warn', 12000, {
    label: 'What changed',
    run: () => void window.open(url, '_blank', 'noopener,noreferrer'),
  });
}

let booted = false;

function wireShell(): void {
  initToasts();
  initLightbox();
  initSidebar({ openSearch: () => openPalette(), openProfile: (a) => openProfileMenu(a) });
  wireSearch();

  initPullRefresh(reloadAll);
  initToTop();
  $('#pwaBtn').onclick = () => void PWA.install();
  $('#pmScrim').onclick = () => closeProfileMenu(false);
  window.matchMedia('(max-width: 760px)').addEventListener('change', () => closeProfileMenu(false));

  $('#peekClose').onclick = () => clearPeek();
  $('#peekOpen').onclick = () => {
    const p = state.peekPath;
    clearPeek();
    if (p) hooks.openNote(p);
  };
  $('#peekRefresh').onclick = () => {
    if (state.peekPath) void openPeek(state.peekPath);
  };

  onAgents((n) => setLiveAgents(n));

  registerCommands([
    { id: 'new-note', title: 'New note', hint: 'Write a new note', icon: 'plus', keywords: 'create add write note', run: () => hooks.openNewNote() },
    { id: 'open-brain', title: 'Open brain', hint: 'Your memory as a living brain', icon: 'brain', keywords: 'home 3d', kbd: 'Alt 2', run: () => go('brain') },
    { id: 'new-folder', title: 'New folder', hint: 'Create a folder', icon: 'folder-plus', keywords: 'create add directory', run: () => hooks.openNewFolder() },
    { id: 'activity', title: 'Show live activity', hint: 'What agents are doing now', icon: 'activity', keywords: 'logs agents feed', run: () => go('logs') },
    { id: 'new-key', title: 'Connect an agent', hint: 'Set up an AI app so it can use your notes', icon: 'key', keywords: 'api key mcp token', run: () => (connectOnLoad(), go('keys')) },
    { id: 'theme', title: 'Switch theme', hint: 'Dark, light or system', icon: 'sun', keywords: 'dark light mode appearance', run: () => cycleTheme() },
    { id: 'theme-dark', title: 'Use dark theme', icon: 'moon', keywords: 'appearance mode', run: () => setThemePref('dark') },
    { id: 'theme-light', title: 'Use light theme', icon: 'sun', keywords: 'appearance mode', run: () => setThemePref('light') },
    { id: 'sidebar', title: 'Toggle sidebar', hint: 'Slim icon rail or full sidebar', icon: 'sidebar', kbd: '[', keywords: 'collapse expand minimize', run: () => (isMobile() ? undefined : toggleCollapsed()) },
    { id: 'reload', title: 'Reload data', hint: 'Load your notes again', icon: 'refresh', keywords: 'refresh sync', run: () => void reloadAll() },
    { id: 'install', title: 'Install app', hint: 'Add Memora to your device', icon: 'download', keywords: 'pwa home screen', run: () => void PWA.install() },
    { id: 'guide', title: 'Keyboard shortcuts and guide', icon: 'help', keywords: 'help keys', run: () => openGuide() },
    { id: 'docs', title: 'Open documentation', hint: 'Guides, agent instructions and reference', icon: 'book', keywords: 'docs help manual guide reference api mcp install', run: () => openDocs() },
    { id: 'docs-prompt', title: 'Agent instructions', hint: 'The recommended prompt for your agents', icon: 'book', keywords: 'docs prompt system instructions claude chatgpt cursor rules agents.md', run: () => openDocs('agent-instructions') },
    { id: 'docs-tools', title: 'MCP tool reference', hint: 'Every tool agents can call', icon: 'book', keywords: 'docs tools catalog mcp reference', run: () => openDocs('tool-reference') },
    { id: 'welcome', title: 'Welcome to Memora', icon: 'sparkle', keywords: 'about intro tour what is memora', run: () => openWelcome() },
    { id: 'account', title: 'Account', hint: 'Session and appearance', icon: 'user', keywords: 'profile session', run: () => void openAccount() },
    { id: 'open-nodes', title: 'Open notes', hint: 'Browse every note', icon: 'note', keywords: 'notes vault list', run: () => { state.note = null; go('vault'); } },
    { id: 'open-trash', title: 'Open Trash', hint: 'Deleted notes, ready to restore', icon: 'trash', keywords: 'trash deleted restore bin recycle undo', run: () => hooks.openTrash() },
    { id: 'signout', title: 'Sign out', icon: 'logout', keywords: 'logout exit', run: () => void signOut() },
  ]);

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || isTyping(e.target)) return;
    if (!$('#modalHost').classList.contains('hidden')) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const n = Number(e.code.startsWith('Digit') ? e.code.slice(5) : e.key);
      if (n >= 1 && n <= Math.min(9, PAGES.length)) {
        e.preventDefault();
        closePalette(false);
        go(PAGES[n - 1]);
      }
      return;
    }
    if (e.key === '[' && !e.ctrlKey && !e.metaKey && !isMobile()) {
      e.preventDefault();
      toggleCollapsed();
    }
    if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      openGuide();
    }
  });

  window.addEventListener('popstate', () => {
    if (!booted) return;
    closeProfileMenu(false);
    closePalette(false);
    applyRoute(parseLocation());
  });
  onNavigate(() => closeNotFound());
  initMapEnter();
}

function applyRoute(r: Route): void {
  closeNotFound();
  const to = resolveRoute(r, location.pathname, findNode);
  if (to.kind === 'missing') {
    if (r.page === 'vault') state.note = null;
    // Back only when there is an earlier page of this app to return to.
    const canBack = booted || (!!document.referrer && document.referrer.startsWith(location.origin + '/'));
    showNotFound(to.missing, () => go('home'), canBack && history.length > 1 ? () => history.back() : undefined);
    return;
  }
  if (to.kind === 'node') {
    replaceHistory();
    state.note = to.path;
    if (state.page !== 'vault') {
      replaceHistory();
      go('vault', true);
    }
    hooks.openNote(to.path);
    return;
  }
  if (to.page === 'vault') {
    replaceHistory();
    state.note = null;
  }
  replaceHistory();
  go(to.page);
}

function wireNoteRows(scope: ParentNode): void {
  const rows = Array.from(scope.querySelectorAll<HTMLElement>('[data-path]'));
  for (const row of rows) {
    row.onclick = (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('button,a')) return;
      const path = row.dataset.path;
      if (path) void openNote(path);
    };
    row.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const path = row.dataset.path;
        if (path) void openNote(path);
      }
    };
  }
}

// A shell without the splash controller (an old cached page) just gets the splash removed.
const splash: BootSplash = window.memoraBoot ?? {
  step: () => undefined,
  fail: () => undefined,
  done: () => document.getElementById('splash')?.remove(),
};

function painted(): Promise<void> {
  return new Promise((r) => {
    // A hidden tab runs no frames; the timer keeps boot going there.
    const t = window.setTimeout(r, 50);
    requestAnimationFrame(() => {
      window.clearTimeout(t);
      window.setTimeout(r, 0);
    });
  });
}

async function boot(): Promise<void> {
  applyTheme();
  useStyles('ui-font', UI_FONT_CSS + UI_MONO_CSS);
  useStyles(
    'brand-font',
    BRAND_FONT_CSS +
      `.brand-text{font-family:${BRAND_FONT};font-weight:700;letter-spacing:0}` +
      '.brand-text{font-size:23px;line-height:1}',
  );

  const shell = document.getElementById('appShell');
  // Hidden until the session is known, so an expired cookie never flashes the dashboard.
  if (shell) shell.classList.add('hidden');

  registerView('brain', renderBrain);
  registerView('home', renderHome);
  registerView('vault', renderVault);
  registerView('graph', renderGraph);
  registerView('canvas', renderCanvas);
  registerView('tags', renderTags);
  registerView('logs', renderLogs);
  registerView('keys', renderKeys);
  registerView('tools', renderTools);
  registerView('access', renderAccess);
  registerView('settings', renderSettings);
  registerView('docs', renderDocs);
  registerView('trash', renderTrash);

  // The tree hooks are only filled when the Vault package has not installed its own.
  hooks.openNote = (p: string) => void openNote(p);
  hooks.go = (page: Page) => go(page);
  hooks.loadCore = loadCore;
  if (hooks.renderTree === DEFAULT_RENDER_TREE) hooks.renderTree = renderTree;
  if (hooks.refreshTree === DEFAULT_REFRESH_TREE) hooks.refreshTree = () => renderTree();
  hooks.refreshPage = () => refreshPage();
  hooks.refreshLogs = () => void renderLogs();
  hooks.openNewNote = openNewNote;
  hooks.openNewFolder = openNewFolder;
  hooks.openMoveNote = openMoveNote;
  hooks.openMoveFolder = openMoveFolder;
  hooks.openFolderColor = openFolderColor;
  hooks.confirmDeleteFolder = confirmDeleteFolder;
  hooks.refreshVault = () => wireNoteRows($('#view-vault'));
  hooks.vaultChanged = (vault: string) => {
    if (vaultSwitch.pending || (vault && vault === state.health.vault)) return;
    void reloadVaultData().then(() => {
      if (state.page !== 'settings') go('brain');
      toast('The vault was switched to ' + vault, 'warn', 5000);
    });
  };

  initVault();
  mountSidebarTree((host) => mountTree(host, { showNotes: true, showPins: true }));
  for (const k of ['openNewNote', 'openNewFolder'] as const) {
    const inner = hooks[k];
    hooks[k] = () => {
      closePalette(false);
      closeDrawer();
      inner();
    };
  }

  wireShell();

  // The session check and the first page's data go out together.
  const quiet = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const pMe = quiet(apiGet<{ user?: string; username?: string }>('/api/auth/me'));
  const pSettings = quiet(fetchSettings());
  const pGraph = quiet(apiGet<{ nodes?: unknown[]; links?: unknown[] }>('/api/graph'));
  const pCore = quiet(loadCore());
  splash.step('Signing in…', 0.3);

  state.me = await pMe;

  if (!state.me) {
    splash.step('Opening sign-in…', 1);
    window.location.replace('/login?r=' + encodeURIComponent(location.pathname + location.search));
    return;
  }

  splash.step('Loading your notes…', 0.55);
  const info: SettingsInfo | null = await pSettings;
  if (info && info.vault_configured === false) {
    splash.done();
    await showVaultOnboarding(info, state.me.user || state.me.username || '');
  }

  paintAccountChip(state.me);
  const onboarded = !!info && info.vault_configured === false;
  // The early load saw no vault when one was picked during onboarding.
  const g = onboarded ? await quiet(apiGet<{ nodes?: unknown[]; links?: unknown[] }>('/api/graph')) : await pGraph;
  if (g) {
    state.graph.nodes = (g.nodes || []) as typeof state.graph.nodes;
    state.graph.links = (g.links || []) as typeof state.graph.links;
  }
  await pCore;
  if (onboarded) await loadCore();
  const brandSub = $('#brandVault');
  const pUpdate = state.health.version ? updateInfo(state.health.version) : null;
  if (state.health.version) brandSub.textContent = 'v' + state.health.version;
  void pUpdate?.then((u) => {
    const badge = document.getElementById('brandUpd');
    if (!badge || !u.available || !u.latest) return;
    badge.hidden = false;
    badge.title = 'v' + u.latest + ' is available';
  });

  const first = parseLocation();
  splash.step(first.page === 'brain' ? 'Starting the brain…' : `Opening ${PAGE_META[first.page].label}…`, 0.85);
  await painted();
  if (shell) shell.classList.remove('hidden');
  applyRoute(first);
  booted = true;
  if (!isNotFoundOpen()) paintTitle();
  splash.done();
  void maybeWelcome().then(() => maybeWhatsNew());
  void pUpdate?.then(announceUpdate);

  RT.start();
  PWA.init();
}

function start(): void {
  boot().catch((e: unknown) => {
    console.error('Memora could not start', e);
    splash.fail('Memora could not start.', 'Reload to try again.');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
