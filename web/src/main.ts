// Memora web UI entry point. Wires the shell, registers the view renderers and
// boots the app. The bundle is loaded as a plain script from index.html.

// Must stay the first import: snapshots the hooks.ts defaults before any other
// package can install its own (see ui/hook-snapshot.ts).
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
import { loadCore } from './core-data';
import { hooks } from './hooks';
import { PWA } from './pwa';
import { RT, onAgents } from './realtime';
import { PAGES, findNode, go, openDocs, paintTitle, parseLocation, refreshPage, registerView, replaceHistory, type Route } from './router';
import { closeDrawer, initSidebar, isMobile, mountSidebarTree, renderTree, setLiveAgents, toggleCollapsed } from './sidebar';
import { closePalette, openPalette, registerCommands, wireSearch } from './search';
import { state } from './state';
import { clearPeek, openPeek } from './peek';
import { initLightbox } from './ui/lightbox';
import { initVault, mountTree, openNote, renderVault } from './vault/index';
import { renderHome } from './views/home';
import { renderGraph } from './views/graph';
import { renderTags } from './views/tags';
import { renderLogs } from './views/logs';
import { renderKeys } from './views/keys';
import { renderTools } from './views/tools';
import { brainView, renderBrain } from './views/brain';
import { renderCanvas } from './views/canvas';
import { renderAccess } from './views/access';
import { renderSettings } from './views/settings';
import { renderDocs } from './views/docs';
import { applyTheme, cycleTheme, setThemePref } from './theme';
import { fetchSettings, reloadVaultData, vaultSwitch } from './vault';
import { showVaultOnboarding } from './views/onboarding';
import { maybeWelcome, openWelcome } from './views/welcome';
import { initPullRefresh } from './ui/pull-refresh';
import { closeNotFound, showNotFound } from './ui/notfound';
import { initToasts, notify, toast } from './toast';
import { markUpdateNoticeSeen, updateNoticeSeen } from './storage';
import { installStyles } from './ui';
import { greetSplash, playSplash } from './brain/splash';
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

  // Touch screens: pull down to reload the data of the page in view.
  initPullRefresh(reloadAll);
  $('#pwaBtn').onclick = () => void PWA.install();
  $('#pmScrim').onclick = () => closeProfileMenu(false);
  window.matchMedia('(max-width: 760px)').addEventListener('change', () => closeProfileMenu(false));

  // Note preview panel.
  $('#peekClose').onclick = () => clearPeek();
  $('#peekOpen').onclick = () => {
    const p = state.peekPath;
    clearPeek();
    if (p) hooks.openNote(p);
  };
  $('#peekRefresh').onclick = () => {
    if (state.peekPath) void openPeek(state.peekPath);
  };

  // Live agent count on the nav and the tab bar.
  onAgents((n) => setLiveAgents(n));

  registerCommands([
    { id: 'new-note', title: 'New node', hint: 'Write a new node', icon: 'plus', keywords: 'create add write note', run: () => hooks.openNewNote() },
    { id: 'open-brain', title: 'Open brain', hint: 'Your memory as a living brain', icon: 'brain', keywords: 'home 3d', kbd: 'Alt 2', run: () => go('brain') },
    { id: 'new-folder', title: 'New folder', hint: 'Create a folder', icon: 'folder-plus', keywords: 'create add directory', run: () => hooks.openNewFolder() },
    { id: 'activity', title: 'Show live activity', hint: 'What agents are doing now', icon: 'activity', keywords: 'logs agents feed', run: () => go('logs') },
    { id: 'new-key', title: 'Connect an agent', hint: 'Create an API key on Agents & API keys', icon: 'key', keywords: 'api key mcp token', run: () => go('keys') },
    { id: 'theme', title: 'Switch theme', hint: 'Dark, light or system', icon: 'sun', keywords: 'dark light mode appearance', run: () => cycleTheme() },
    { id: 'theme-dark', title: 'Use dark theme', icon: 'moon', keywords: 'appearance mode', run: () => setThemePref('dark') },
    { id: 'theme-light', title: 'Use light theme', icon: 'sun', keywords: 'appearance mode', run: () => setThemePref('light') },
    { id: 'sidebar', title: 'Toggle sidebar', hint: 'Slim icon rail or full sidebar', icon: 'sidebar', kbd: '[', keywords: 'collapse expand minimize', run: () => (isMobile() ? undefined : toggleCollapsed()) },
    { id: 'reload', title: 'Reload data', hint: 'Re-read the vault from the server', icon: 'refresh', keywords: 'refresh sync', run: () => void reloadAll() },
    { id: 'install', title: 'Install app', hint: 'Add Memora to your device', icon: 'download', keywords: 'pwa home screen', run: () => void PWA.install() },
    { id: 'guide', title: 'Keyboard shortcuts and guide', icon: 'help', keywords: 'help keys', run: () => openGuide() },
    { id: 'docs', title: 'Open documentation', hint: 'Guides, agent instructions and reference', icon: 'book', keywords: 'docs help manual guide reference api mcp install', run: () => openDocs() },
    { id: 'docs-prompt', title: 'Agent instructions', hint: 'The recommended prompt for your agents', icon: 'book', keywords: 'docs prompt system instructions claude chatgpt cursor rules agents.md', run: () => openDocs('agent-instructions') },
    { id: 'docs-tools', title: 'MCP tool reference', hint: 'Every tool agents can call', icon: 'book', keywords: 'docs tools catalog mcp reference', run: () => openDocs('tool-reference') },
    { id: 'welcome', title: 'Welcome to Memora', icon: 'sparkle', keywords: 'about intro tour what is memora', run: () => openWelcome() },
    { id: 'account', title: 'Account', hint: 'Session and appearance', icon: 'user', keywords: 'profile session', run: () => void openAccount() },
    { id: 'open-nodes', title: 'Open nodes', hint: 'Browse every node', icon: 'note', keywords: 'notes vault list', run: () => { state.note = null; go('vault'); } },
    { id: 'signout', title: 'Sign out', icon: 'logout', keywords: 'logout exit', run: () => void signOut() },
  ]);

  // Keyboard shortcuts: Alt+1..9 pages, "[" sidebar rail.
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

  // Back / forward.
  window.addEventListener('popstate', () => {
    // Before boot finishes, boot itself applies the current URL.
    if (!booted) return;
    // The Vault package's mobile node sheet pushes its own entries.
    if ((history.state as { vxSheet?: unknown } | null)?.vxSheet) return;
    closeProfileMenu(false);
    closePalette(false);
    applyRoute(parseLocation());
  });
}

/** Show what a URL names. Node paths only select nodes in the loaded tree. */
function applyRoute(r: Route): void {
  closeNotFound();
  if (r.unknown) {
    // An address that leads nowhere: say so, then Overview (3 s or the button).
    showNotFound('page', location.pathname, () => go('home'));
    return;
  }
  if (r.page === 'vault' && (r.badNode || r.node)) {
    const path = r.node ? findNode(r.node) : null;
    if (!path) {
      replaceHistory();
      state.note = null;
      replaceHistory();
      showNotFound('node', r.node || location.pathname, () => go('home'));
      return;
    }
    replaceHistory();
    state.note = path;
    if (state.page !== 'vault') {
      replaceHistory();
      go('vault', true);
    }
    hooks.openNote(path);
    return;
  }
  if (r.page === 'vault') {
    replaceHistory();
    state.note = null;
  }
  replaceHistory();
  go(r.page);
}

/** Open the note behind any [data-path] row in `scope` on click, Enter or Space. */
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

/**
 * The one loading animation: the M mark morphs into the brain, which keeps
 * turning until `ready` resolves, then fades into the app. Capped so a stuck
 * request can never hold the screen forever.
 */
async function runSplash(splash: HTMLElement | null, ready: Promise<unknown>, maxMs = 20000): Promise<void> {
  if (!splash) return;
  // The animation draws its own background. The static mark sits where the
  // grains form, so it fades out while they fade in, then the static backdrop
  // goes transparent so the final fade reveals the app, never the static mark.
  document.getElementById('splashBar')?.classList.add('done');
  const statics = Array.from(splash.children) as HTMLElement[];
  for (const c of statics) c.style.transition = 'opacity .45s ease';
  requestAnimationFrame(() => statics.forEach((c) => (c.style.opacity = '0')));
  window.setTimeout(() => {
    statics.forEach((c) => (c.style.visibility = 'hidden'));
    splash.style.background = 'transparent';
  }, 500);
  // The live brain stays hidden while the splash grains fly onto it, and
  // appears the moment they land, so the two read as one brain.
  useStyles(
    'brain-intro-css',
    '#view-brain .brain-stage,#view-brain .brain-labels{transition:opacity .45s ease}' +
      // Not 0: a fully transparent canvas is never composited, so its first real
      // frame (a long stall on some GPUs) would land in the middle of the hand-off.
      'html.brain-intro #view-brain .brain-stage,html.brain-intro #view-brain .brain-labels{opacity:.004}',
  );
  // Only a boot onto the 3D brain grows the M into a brain; any other page
  // (Graph, Canvas, Nodes, Overview...) gets the M bursting apart instead.
  const toBrain = parseLocation().page === 'brain';
  const root = document.documentElement;
  if (toBrain) root.classList.add('brain-intro');
  const reveal = (): void => root.classList.remove('brain-intro');
  const cap = new Promise<void>((r) => window.setTimeout(r, maxMs));
  await Promise.race([
    playSplash(splash, Promise.race([ready, cap]), toBrain ? brainView : undefined, reveal, toBrain).catch(() => undefined),
    cap,
  ]);
  reveal();
}

async function boot(): Promise<void> {
  applyTheme();
  // The wordmark font (sidebar, splash) before anything paints it.
  useStyles(
    'brand-font',
    BRAND_FONT_CSS +
      `.brand-text{font-family:${BRAND_FONT};font-weight:700;letter-spacing:0}` +
      '.brand-text{font-size:23px;line-height:1}',
  );

  const splash = document.getElementById('splash');
  const shell = document.getElementById('appShell');
  // Keep the shell hidden until the session is known, so an expired cookie can
  // never render the dashboard and then bounce to sign-in.
  if (shell) shell.classList.add('hidden');

  const dropSplash = (): void => {
    if (!splash || !splash.isConnected) return;
    splash.classList.add('gone');
    window.setTimeout(() => splash.remove(), 420);
  };

  // Register the view renderers. The router never imports a view module.
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

  // Cross-module wiring through hooks keeps the import graph acyclic. The tree
  // hooks are only filled when the Vault package has not installed its own.
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
  hooks.refreshHome = () => void renderHome();
  hooks.refreshGraph = () => void renderGraph();
  hooks.vaultChanged = (vault: string) => {
    // Another tab or browser switched the vault: drop everything from the old one.
    if (vaultSwitch.pending || (vault && vault === state.health.vault)) return;
    void reloadVaultData().then(() => {
      if (state.page !== 'settings') go('brain');
      toast('The vault was switched to ' + vault, 'warn', 5000);
    });
  };

  // The Vault package takes over the tree, note reader and write dialogs,
  // and draws its tree (pins + folders) in the sidebar.
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

  // Start the animation right away; everything below loads behind it.
  let markReady: () => void = () => {};
  const ready = new Promise<void>((r) => (markReady = r));
  const anim = runSplash(splash, ready);

  // The session check and the first page's data go out together; the data is
  // simply dropped when the session turns out to be gone.
  const quiet = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const pMe = quiet(apiGet<{ user?: string; username?: string }>('/api/auth/me'));
  const pSettings = quiet(fetchSettings());
  const pGraph = quiet(apiGet<{ nodes?: unknown[]; links?: unknown[] }>('/api/graph'));
  const pCore = quiet(loadCore());

  state.me = await pMe;
  if (state.me) {
    const name = state.me.user || state.me.username || '';
    greetSplash(name ? `Welcome, ${name}` : 'Welcome back');
  }

  if (!state.me) {
    // No valid session. Hand off to sign-in rather than rendering a shell whose
    // every request would fail with 401.
    markReady();
    window.location.replace('/login?r=' + encodeURIComponent(location.pathname + location.search));
    return;
  }

  // No vault folder yet: the vault chooser is the only thing on screen until
  // one is picked; the app below then loads with it.
  const info: SettingsInfo | null = await pSettings;
  if (info && info.vault_configured === false) {
    markReady();
    await anim;
    dropSplash();
    await showVaultOnboarding(info, state.me.user || state.me.username || '');
  }

  paintAccountChip(state.me);
  const onboarded = !!info && info.vault_configured === false;
  // A vault picked during onboarding: the early load saw no vault.
  const g = onboarded ? await quiet(apiGet<{ nodes?: unknown[]; links?: unknown[] }>('/api/graph')) : await pGraph;
  if (g) {
    state.graph.nodes = (g.nodes || []) as typeof state.graph.nodes;
    state.graph.links = (g.links || []) as typeof state.graph.links;
  }
  await pCore;
  if (onboarded) await loadCore();
  // Under the name, next to the collapse button: the running version.
  const brandSub = $('#brandVault');
  const pUpdate = state.health.version ? updateInfo(state.health.version) : null;
  if (state.health.version) brandSub.textContent = 'v' + state.health.version;
  void pUpdate?.then((u) => {
    const badge = document.getElementById('brandUpd');
    if (!badge || !u.available || !u.latest) return;
    badge.hidden = false;
    badge.title = 'v' + u.latest + ' is available';
  });

  // Render the first page behind the animation, then let it fade into it.
  if (shell) shell.classList.remove('hidden');
  applyRoute(parseLocation());
  booted = true;
  paintTitle();
  markReady();
  await anim;
  dropSplash();
  void maybeWelcome();
  void pUpdate?.then(announceUpdate);

  // Non blocking: realtime and PWA both degrade gracefully when absent.
  RT.start();
  PWA.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot());
} else {
  void boot();
}
