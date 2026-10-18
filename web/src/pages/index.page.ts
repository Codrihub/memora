// The application shell. Rendered by scripts/build-pages.mjs into
// crates/http/assets/index.html, with src/app.css injected.
//
// Do not edit the generated file: change this module and rebuild.
//
// The shell look lives in web/src/ui/* (CSS strings injected at boot). Only
// the splash and the pre-boot gate are styled here, because they paint before
// the script runs. This module is loaded without bundling, so sibling modules
// are loaded with createRequire (see below).

import type * as BrandFontModule from '../brand-font';
import type * as BrandModule from '../brand';

declare const process: {
  argv: string[];
  getBuiltinModule(id: 'node:module'): { createRequire(path: string): (id: string) => unknown };
};

// build-pages.mjs imports this module from a data: URL, where relative imports
// cannot resolve: load siblings relative to the build script instead.
const load = process.getBuiltinModule('node:module').createRequire(process.argv[1] ?? '');
const { BRAND_FONT, BRAND_FONT_CSS } = load('../src/brand-font.ts') as typeof BrandFontModule;
const { markSvg } = load('../src/brand.ts') as typeof BrandModule;

// Theme choice, per device: localStorage `memora.theme` = dark | light | system
// (missing or invalid means dark). Runs first in <head> so the page never
// paints in the wrong theme; web/src/theme.ts keeps it live afterwards and the
// login page reads the same key.
const THEME_BOOT = `(function(){var p='dark';try{var v=localStorage.getItem('memora.theme');if(v==='light'||v==='dark'||v==='system')p=v}catch(e){}if(p==='system'){try{p=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}catch(e){p='dark'}}document.documentElement.dataset.theme=p})();`;

// Paints before app.js: the splash, and the shell kept hidden until boot.
const CRITICAL_CSS = `
html,body{margin:0;height:100%;background:#07090e;color:#e8ecf3;overflow:hidden;
  font:14px/1.55 "Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
:root[data-theme=light] body{background:#f4f6fa;color:#0f172a}
.hidden{display:none !important}
#appShell{display:contents}
/* The static splash matches the particle splash's first frame (same size and
   place, see brain/splash.ts: mark 0.3/19 x 24 of min(w,h), centred 2% above
   the middle), so the boot crossfades into the grains instead of cutting. */
.splash{position:fixed;inset:0;z-index:100;
  background:#07090e;transition:opacity .4s ease}
:root[data-theme=light] .splash{background:#f4f6fa}
.splash.gone{opacity:0;pointer-events:none}
.splash-mark{position:absolute;left:50%;top:calc(50% - 2vmin);width:37.9vmin;height:37.9vmin;translate:-50% -50%}
.splash-name{position:absolute;left:0;right:0;top:calc(50% + 18vmin);text-align:center;font:700 36px/1 ${BRAND_FONT};color:#e6e9ef}
:root[data-theme=light] .splash-name{color:#0f172a}
.splash-by{position:absolute;left:0;right:0;top:calc(50% + 18vmin + 46px);text-align:center;font:700 11px/1 system-ui,-apple-system,'Segoe UI',sans-serif;
  letter-spacing:.22em;text-indent:.22em;text-transform:uppercase;color:#8b98ad}
.splash-msg{position:absolute;left:0;right:0;bottom:max(40px,9vh);text-align:center;font:500 13px/1 system-ui,-apple-system,'Segoe UI',sans-serif;color:#8592a8}
/* Boot progress: creeps on its own while the bundle downloads (there is no
   script yet to report it), then main.ts fills it the moment the app runs. */
.splash-bar{position:absolute;left:50%;bottom:calc(max(40px,9vh) - 18px);width:min(180px,40vw);height:3px;translate:-50% 0;border-radius:99px;
  overflow:hidden;background:rgba(133,146,168,.18)}
:root[data-theme=light] .splash-bar{background:rgba(15,23,42,.08)}
.splash-bar i{display:block;height:100%;width:0;border-radius:inherit;background:#08c6d4;animation:splash-creep 8s cubic-bezier(.1,.7,.2,1) forwards}
.splash-bar.done i{width:100% !important;animation:none;transition:width .25s ease-out}
@keyframes splash-creep{0%{width:0}6%{width:28%}25%{width:62%}60%{width:82%}100%{width:92%}}
@media (prefers-reduced-motion:reduce){.splash-bar i{animation-duration:.01s}}
`;

// The Memora mark, from web/src/brand.ts (self-coloured).
const MARK = (cls: string): string => markSvg(cls);

export function indexPage(css: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
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
  <div id="splash" class="splash" role="status" aria-live="polite">
    ${MARK('splash-mark')}
    <div class="splash-name">Memora</div>
    <div class="splash-by">by Codrihub Tech</div>
    <div class="splash-msg" id="splashMsg">Checking your session...</div>
    <div class="splash-bar" id="splashBar" role="progressbar" aria-label="Loading Memora"><i></i></div>
  </div>

  <div id="appShell" class="app-shell">

  <a class="skip-link" href="#views">Skip to content</a>

  <!-- ░░ SIDEBAR (desktop rail / mobile drawer) ░░ -->
  <aside id="sidebar" aria-label="Sidebar">
    <div class="side-head">
      <div class="brand-wrap">
        <button id="brandHome" class="brand" type="button" aria-label="Memora, open Overview" data-tip="Overview">
          <span class="brand-tile">${MARK('brand-mark')}</span>
          <span class="brand-text">Memora</span>
        </button>
        <button id="brandVersion" class="brand-ver" type="button" title="Memora by Codrihub Tech" aria-label="Version, open Settings">
          <span id="brandVault">second brain</span><span class="brand-upd" id="brandUpd" hidden>Update</span>
        </button>
      </div>
      <button id="sideClose" class="icon-btn side-close" type="button" title="Close menu" aria-label="Close menu">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </div>

    <div class="side-actions">
      <button id="sideNewNode" class="side-new" type="button" aria-label="New node" data-tip="New node">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>
        <span class="side-new-label">New node</span>
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
            <input id="sideSearch" type="search" placeholder="Filter folders and nodes" aria-label="Filter folders and nodes" autocomplete="off" spellcheck="false">
            <button id="sideSearchClear" class="ss-clear hidden" type="button" aria-label="Clear filter">
              <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
          </div>
          <div id="tree" class="tree"></div>
        </div></div>
      </div>
    </div>

    <div class="side-foot">
      <button id="sideStats" class="side-stats" type="button" aria-label="Vault size" aria-expanded="false" aria-controls="sideStatsPop" data-tip="Vault size">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"/><path d="M5 12v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-6"/></svg>
      </button>
      <div id="sideStatsPop" class="side-stats-pop" role="dialog" aria-label="Vault size" hidden></div>
      <button id="sideCollapse" class="side-collapse" type="button" title="Collapse sidebar" aria-label="Collapse sidebar" aria-controls="sidebar" aria-expanded="true">
        <svg class="i sc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m11.5 7-5 5 5 5"/><path d="m17.5 7-5 5 5 5"/></svg>
        <span class="sc-label">Collapse</span>
      </button>
      <button id="profileBtn" class="profile-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="profileMenu" data-tip="Account and settings">
        <span class="user-avatar" data-avatar>?</span>
        <span class="pb-main"><span class="pb-name" data-username>account</span><span class="pb-sub">Settings, Agents, Theme</span></span>
        <svg class="i pb-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m7 15 5-5 5 5"/></svg>
      </button>
      <div class="side-meta" id="profileSub"><span class="pb-stats" aria-label="Vault size"><span id="statNotes">0 nodes</span><i>·</i><span id="statLinks">0 links</span><i>·</i><span id="statFolders">0 folders</span></span><span class="pb-live" id="profileLive" aria-live="polite"></span></div>
    </div>
  </aside>
  <div id="sideScrim" aria-hidden="true"></div>

  <!-- ░░ MAIN ░░ -->
  <main id="main">
    <header id="topbar">
      <button id="sideToggle" class="icon-btn" type="button" title="Open menu" aria-label="Open menu" aria-controls="sidebar">
        <span class="brand-tile sm">${MARK('brand-mark')}</span>
      </button>
      <div class="tb-title">
        <div id="crumb" class="crumb">Brain</div>
      </div>
      <div class="grow"></div>
      <button id="searchBtn" class="tb-search" type="button" aria-label="Search notes, pages and actions" aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K /">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.3-4.3"/></svg>
        <span class="tb-search-label">Search nodes, pages, actions</span>
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
      <section id="view-vault" class="view hidden" data-page="vault" aria-label="Vault"></section>
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

  <div id="rtPop" class="rt-pop hidden" role="dialog" aria-label="Realtime status"></div>
  <div id="pmScrim" class="pm-scrim hidden" aria-hidden="true"></div>
  <div id="profileMenu" class="pmenu hidden" role="menu" aria-label="Account and settings"></div>
  <div id="palette" class="palette hidden"></div>
  <div id="navTip" class="nav-tip" role="tooltip" aria-hidden="true"></div>
  <div id="modalHost" class="modal-host hidden"></div>
  <div id="toasts" class="toasts" role="status" aria-live="polite"></div>
  </div>
</div>
<script src="/app.js"></script>
</body>
</html>
`;
}
