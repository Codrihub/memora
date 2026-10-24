// The application shell, rendered by scripts/build-pages.mjs into crates/http/assets/index.html.
// Only what paints before app.js (the splash) is styled here; the shell look lives in web/src/ui/*.

import type * as BrandFontModule from '../brand-font';
import type * as BrandModule from '../brand';

declare const process: {
  argv: string[];
  getBuiltinModule(id: 'node:module'): { createRequire(path: string): (id: string) => unknown };
};

// Imported from a data: URL by build-pages.mjs, so siblings load relative to the build script.
const load = process.getBuiltinModule('node:module').createRequire(process.argv[1] ?? '');
const { BRAND_FONT, BRAND_FONT_CSS } = load('../src/brand-font.ts') as typeof BrandFontModule;
const { markSvg } = load('../src/brand.ts') as typeof BrandModule;

// Runs first in <head> so the page never paints in the wrong theme (web/src/theme.ts owns the key).
const THEME_BOOT = `(function(){var p='system';try{var v=localStorage.getItem('memora.theme');if(v==='light'||v==='dark'||v==='system')p=v}catch(e){}if(p==='system'){try{p=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}catch(e){p='dark'}}document.documentElement.dataset.theme=p})();`;

// Splash colours copy the app tokens (ui/tokens.ts), which arrive with app.js; the system face avoids a font swap mid-boot.
const SYS = `system-ui,-apple-system,'Segoe UI',Roboto,sans-serif`;
const CRITICAL_CSS = `
html,body{margin:0;height:100%;background:#07090e;color:#e8ecf3;overflow:hidden;
  font:14px/1.55 "Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
:root[data-theme=light] body{background:#f4f6fa;color:#0f172a}
.hidden{display:none !important}
#appShell{display:contents}
.splash{--sp-bg:#07090e;--sp-fg:#e8ecf3;--sp-muted:#8592a8;--sp-track:rgba(148,163,184,.16);--sp-bar:#08c6d4;
  position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:24px 16px;
  background:var(--sp-bg);color:var(--sp-fg);transition:opacity .18s ease-out;will-change:opacity}
:root[data-theme=light] .splash{--sp-bg:#f4f6fa;--sp-fg:#0f172a;--sp-muted:#5b6880;--sp-track:rgba(15,23,42,.09)}
.splash.gone{opacity:0;pointer-events:none}
.splash-in{display:flex;flex-direction:column;align-items:center;width:min(300px,100%);margin-top:-4vh;text-align:center}
.splash-mark{width:56px;height:56px;display:block}
.splash-name{margin-top:10px;font:700 34px/1.15 ${BRAND_FONT};letter-spacing:0}
.splash-bar{margin-top:26px;width:140px;max-width:60vw;height:2px;border-radius:2px;background:var(--sp-track);overflow:hidden}
.splash-bar i{display:block;height:100%;background:var(--sp-bar);transform-origin:0 50%;transform:scaleX(var(--p,.08));
  transition:transform .4s cubic-bezier(.22,.61,.36,1)}
.splash-msg{margin:12px 0 0;min-height:20px;font:500 13px/20px ${SYS};color:var(--sp-muted)}
.splash-help{margin-top:14px;display:flex;flex-direction:column;align-items:center;gap:12px}
.splash-help[hidden]{display:none}
.splash-hint{margin:0;font:400 13px/1.45 ${SYS};color:var(--sp-fg)}
.splash[data-state=failed] .splash-bar{visibility:hidden}
.splash[data-state=failed] .splash-msg{color:var(--sp-fg);font-weight:600}
.splash[data-state=failed] .splash-hint{color:var(--sp-muted)}
.splash-reload{height:36px;min-width:96px;padding:0 16px;border:0;border-radius:8px;background:var(--sp-bar);color:#03252a;
  font:600 14px/36px ${SYS};cursor:pointer}
.splash-reload:hover{background:#2dd8e4}
.splash-reload:focus-visible{outline:2px solid var(--sp-bar);outline-offset:3px}
@media (prefers-reduced-motion:reduce){.splash,.splash-bar i{transition:none}}
`;

/** `splashJs` is web/src/boot-splash.ts compiled; it runs right after the splash markup, before app.js downloads. */
export function indexPage(css: string, splashJs: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="memora-build" content="__MEMORA_BUILD__">
<script>${THEME_BOOT}</script>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>Memora</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<!-- PWA: installable to home screen or desktop, and remains available offline -->
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#07090e">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Memora">
<meta name="application-name" content="Memora">
<meta name="description" content="Memora, second brain for your AI: a self-hosted memory vault of Markdown notes, wired into a living brain your agents read and write over MCP.">
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex">
<meta name="googlebot" content="noindex,nofollow,noarchive,nosnippet,noimageindex">
<meta name="referrer" content="no-referrer">
<style>
${css}
${BRAND_FONT_CSS}
${CRITICAL_CSS}
</style>
</head>
<body>
<div id="app">
  <div id="splash" class="splash">
    <div class="splash-in">
      ${markSvg('splash-mark')}
      <div class="splash-name" aria-hidden="true">Memora</div>
      <div class="splash-bar" id="splashBar" role="progressbar" aria-label="Loading Memora" aria-valuemin="0" aria-valuemax="100" aria-valuenow="8"><i></i></div>
      <p class="splash-msg" id="splashMsg" role="status" aria-live="polite">Loading Memora…</p>
      <div class="splash-help" id="splashHelp" hidden>
        <p class="splash-hint" id="splashHint"></p>
        <button class="splash-reload" id="splashReload" type="button">Reload</button>
      </div>
    </div>
  </div>
  <script>${splashJs}</script>

  <div id="appShell" class="app-shell">

  <a class="skip-link" href="#views">Skip to content</a>

  <!-- ░░ SIDEBAR (desktop rail / mobile drawer) ░░ -->
  <aside id="sidebar" aria-label="Sidebar">
    <div class="side-head">
      <div class="brand-wrap">
        <button id="brandHome" class="brand" type="button" aria-label="Memora, open Overview" data-tip="Overview">
          <span class="brand-tile">${markSvg('brand-mark')}</span>
          <span class="brand-text">Memora</span>
        </button>
        <button id="brandVersion" class="brand-ver" type="button" title="Memora by Codrihub Tech" aria-label="Version, open Settings">
          <span id="brandVault">second brain</span><span class="brand-upd" id="brandUpd" hidden>Update</span>
        </button>
      </div>
      <button id="sideNewNode" class="side-tool side-new" type="button" aria-label="New note" title="New note" data-tip="New note">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V12"/><path d="M18.4 3.6a2 2 0 0 1 2.9 2.9L13 14.8l-3.6.8.8-3.6z"/></svg><span class="side-new-label">New note</span>
      </button>
      <button id="sideCollapseTop" class="side-tool side-collapse" type="button" title="Collapse sidebar ([)" aria-label="Collapse sidebar" aria-controls="sidebar">
        <svg class="i sc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/></svg>
      </button>
      <button id="sideClose" class="icon-btn side-close" type="button" title="Close menu" aria-label="Close menu">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </div>

    <div class="side-actions">
      <button id="sideSearchBtn" class="side-find" type="button" aria-label="Search notes, pages and actions" aria-haspopup="dialog" data-tip="Search" data-kbd="Ctrl K">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.3-4.3"/></svg>
        <span class="side-new-label">Search notes</span><kbd data-kbd-mod aria-hidden="true">Ctrl K</kbd>
      </button>
    </div>

    <div class="side-scroll">
      <nav id="nav" class="nav" aria-label="Main navigation"></nav>

      <div class="side-sec side-vault" id="sideVault">
        <div class="sec-row">
          <button class="sec-head" type="button" id="libHead" aria-expanded="true" aria-controls="libBody">
            <span class="sec-title">Library</span>
          </button>
          <button id="newFolderBtn" class="icon-btn sm lib-act" type="button" title="New folder" aria-label="New folder">
            <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/></svg></button>
          <button id="libFold" class="icon-btn sm lib-fold" type="button" title="Fold or unfold Pinned and Folders" aria-label="Fold or unfold Pinned and Folders" aria-expanded="true">
            <svg class="i sec-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m6 9.5 6 6 6-6"/></svg></button>
        </div>
        <div class="sec-body"><div class="sec-inner" id="libBody">
          <div class="sec-pins">
            <div class="pin-head"><span>Pinned</span><span id="pinCount" class="sec-count">0</span></div>
            <div id="pinnedList" class="pinned"></div>
          </div>
          <div class="side-search">
            <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
            <input id="sideSearch" type="search" placeholder="Filter folders and notes" aria-label="Filter folders and notes" autocomplete="off" spellcheck="false">
            <button id="sideSearchClear" class="ss-clear hidden" type="button" aria-label="Clear filter">
              <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
          </div>
          <div id="tree" class="tree"></div>
        </div></div>
      </div>
    </div>

    <div class="side-foot">
      <button id="sideStats" class="side-stats" type="button" aria-label="How many notes" aria-expanded="false" aria-controls="sideStatsPop" data-tip="Your notes in numbers">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"/><path d="M5 12v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-6"/></svg>
      </button>
      <div id="sideStatsPop" class="side-stats-pop" role="dialog" aria-label="Your notes in numbers" hidden></div>
      <nav class="side-links" aria-label="Trash and settings">
        <button id="sideCollapse" class="nav-item side-collapse" type="button" title="Collapse sidebar" aria-label="Collapse sidebar" aria-controls="sidebar" aria-expanded="true"><span class="ni-tile"><svg class="i sc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/></svg></span><span class="ni-label sc-label">Collapse sidebar</span></button>
        <button class="nav-item" type="button" data-act="trash" data-page="trash" data-tip="Trash" aria-label="Trash"><span class="ni-tile"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7"/></svg></span><span class="ni-label">Trash</span></button>
        <button class="nav-item" type="button" data-page="settings" data-tip="Settings" aria-label="Settings"><span class="ni-tile"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></span><span class="ni-label">Settings</span></button>
      </nav>
      <button id="profileBtn" class="profile-btn" type="button" aria-label="Account, settings, help and theme" aria-haspopup="menu" aria-expanded="false" aria-controls="profileMenu" data-tip="Settings, help and theme">
        <span class="user-avatar" data-avatar>?</span>
        <span class="pb-main"><span class="pb-name" data-username>account</span><span class="side-meta" id="profileSub"><span class="pb-stats">Account and settings</span><span class="pb-live" id="profileLive" aria-live="polite"></span></span></span>
        <svg class="i pb-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4"/></svg>
      </button>

    </div>
  </aside>
  <div id="sideScrim" aria-hidden="true"></div>

  <!-- ░░ MAIN ░░ -->
  <main id="main">
    <header id="topbar">
      <button id="sideToggle" class="tb-menu" type="button" title="Open menu" aria-label="Open menu" aria-controls="sidebar">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/></svg>
      </button>
      <div class="tb-title">
        <div id="crumb" class="crumb">Brain</div>
      </div>
      <div class="grow"></div>
      <button id="searchBtn" class="tb-search" type="button" aria-label="Search notes, pages and actions" aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K /">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.3-4.3"/></svg>
        <span class="tb-search-label">Search notes, pages, actions</span>
        <kbd data-kbd-mod>Ctrl K</kbd>
      </button>
      <button id="rtPill" class="rt" type="button" data-state="connecting" aria-haspopup="dialog" aria-expanded="false" aria-label="Realtime: connecting">
        <span class="rt-dot" aria-hidden="true"><i></i></span>
        <span id="rtText" class="rt-label">Connecting</span>
        <span id="rtAgents" class="rt-agents" aria-hidden="true"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4.5" y="7.5" width="15" height="11" rx="3"/><path d="M12 3.5v4M9 12.5h.01M15 12.5h.01"/></svg><b id="rtAgentN">0</b></span>
        <span id="rtIdle" class="rt-idle" aria-hidden="true"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg><b id="rtIdleN">0</b></span>
      </button>
      <button id="pwaBtn" class="icon-btn tb-opt hidden" type="button" title="Install app" aria-label="Install app">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3.5v12"/><path d="m7 10.5 5 5 5-5"/><path d="M4.5 19.5h15"/></svg>
      </button>
    </header>

    <div id="views" tabindex="-1">
      <section id="view-brain" class="view hidden" data-page="brain" aria-label="Brain"></section>
      <section id="view-canvas" class="view hidden" data-page="canvas" aria-label="Canvas"></section>
      <section id="view-home" class="view hidden" data-page="home" aria-label="Overview"></section>
      <section id="view-vault" class="view hidden" data-page="vault" aria-label="Notes"></section>
      <section id="view-graph" class="view hidden" data-page="graph" aria-label="Graph">
        <canvas id="graph"></canvas>
        <div id="gTip" class="gtip hidden"></div>
        <div id="gLegend" class="glegend"></div>
        <div id="gHud" class="ghud"></div>
        <div class="gcontrols">
          <button id="gZoomIn" title="Zoom in">+</button>
          <button id="gZoomOut" title="Zoom out">-</button>
          <button id="gFit" title="Fit to screen">o</button>
          <button id="gMode" title="Layout mode: folder clusters or freeform">⇄</button>
          <button id="gGrid" class="on" title="Grid background"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg></button>
          <button id="gRelayout" title="Relayout">↻</button>
        </div>
      </section>
      <section id="view-tags" class="view hidden" data-page="tags" aria-label="Tags"></section>
      <section id="view-logs" class="view hidden" data-page="logs" aria-label="Activity"></section>
      <section id="view-keys" class="view hidden" data-page="keys" aria-label="Agents and keys"></section>
      <section id="view-tools" class="view hidden" data-page="tools" aria-label="Tools"></section>
      <section id="view-access" class="view hidden" data-page="access" aria-label="Access"></section>
      <section id="view-settings" class="view hidden" data-page="settings" aria-label="Settings"></section>
      <section id="view-docs" class="view hidden" data-page="docs" aria-label="Documentation"></section>
      <section id="view-trash" class="view hidden" data-page="trash" aria-label="Trash"></section>
    </div>
  </main>

  <!-- ░░ MOBILE TAB BAR ░░ -->
  <nav id="tabbar" class="tabbar" aria-label="Primary"></nav>

  <!-- note preview panel (used by Graph and Tags) -->
  <aside id="peek" class="peek hidden" aria-label="Note preview">
    <div class="peek-head">
      <span id="peekFolder" class="peek-folder"></span>
      <div class="peek-acts">
        <button id="peekRefresh" class="icon-btn" title="Reload" aria-label="Reload"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 5v6h-6"/></svg></button>
        <button id="peekOpen" class="btn ghost sm">Open</button>
        <button id="peekClose" class="icon-btn" title="Close" aria-label="Close preview"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
    </div>
    <div id="peekBody" class="peek-body note-body"></div>
  </aside>

  <div id="rtPop" class="rt-pop hidden" role="dialog" aria-label="Agents"></div>
  <div class="rt-scrim" aria-hidden="true"></div>
  <div id="pmScrim" class="pm-scrim hidden" aria-hidden="true"></div>
  <div id="profileMenu" class="pmenu hidden" role="menu" aria-label="Account and settings"></div>
  <div id="palette" class="palette hidden"></div>
  <div id="navTip" class="nav-tip" role="tooltip" aria-hidden="true"></div>
  <div id="modalHost" class="modal-host hidden"></div>
  <div id="toasts" class="toasts" role="region" aria-label="Notifications" aria-live="polite"></div>
  </div>
</div>
<script src="/app.js"></script>
</body>
</html>
`;
}
