// Design tokens for the signed-in app, dark (default) and light.
//
// The short names (--bg, --panel, --line, --fg, --muted, --accent ...) are
// aliases many views use; prefer the semantic names (--surface-*, --text-*,
// --brand*, --ring ...) in new code.

import { PRIMARY_DARK, PRIMARY_LIGHT } from './primary';

export const TOKENS_CSS = `
:root{
  color-scheme:dark;
  /* surfaces */
  --bg:#07090e; --bg-grad:radial-gradient(1200px 700px at 12% -10%,rgba(94,234,212,.07),transparent 60%),
    radial-gradient(900px 600px at 100% 0%,rgba(129,140,248,.07),transparent 55%);
  --surface-0:#07090e; --surface-1:#0d1118; --surface-2:#131823; --surface-3:#1a2030;
  /* Solid on purpose: see-through menus and panels were confusing. */
  --glass:#0d1118; --glass-strong:#11161f;
  --panel:var(--surface-1); --panel-2:var(--surface-2);
  /* lines */
  --line:rgba(148,163,184,.13); --line-strong:rgba(148,163,184,.22); --border:var(--line);
  /* text */
  --fg:#e8ecf3; --text-1:#e8ecf3; --text-2:#a3afc2; --muted:#8592a8; --text-3:#5f6b80;
  /* brand */
  --accent:#5eead4; --accent-2:#818cf8; --accent-3:#7dd3fc;
  --brand-grad:linear-gradient(135deg,#5eead4 0%,#7dd3fc 45%,#a78bfa 100%);
  /* primary action (buttons, avatars, switches): one solid cyan, no gradients */
  ${PRIMARY_DARK}
  --avatar-bg:var(--primary); --avatar-fg:var(--on-primary);
  --accent-soft:rgba(94,234,212,.11); --accent-line:rgba(94,234,212,.38); --on-accent:#04221e;
  /* status */
  --ok:#4ade80; --warn:#fbbf24; --danger:#f87171; --info:#7dd3fc;
  --ok-soft:rgba(74,222,128,.12); --warn-soft:rgba(251,191,36,.12); --danger-soft:rgba(248,113,113,.12);
  /* interaction */
  --hover:rgba(148,163,184,.08); --press:rgba(148,163,184,.14);
  --ring:0 0 0 2px var(--surface-0),0 0 0 4px rgba(94,234,212,.75);
  /* shape */
  --r-xs:6px; --r-sm:9px; --r:12px; --r-lg:16px; --r-xl:22px; --r-pill:999px;
  /* elevation */
  --shadow-sm:0 1px 2px rgba(0,0,0,.4);
  --shadow:0 18px 50px -12px rgba(0,0,0,.65),0 0 0 1px rgba(148,163,184,.06);
  --shadow-lg:0 30px 80px -20px rgba(0,0,0,.75),0 0 0 1px rgba(148,163,184,.08);
  /* type */
  --font:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,"Helvetica Neue",sans-serif;
  --mono:ui-monospace,SFMono-Regular,"JetBrains Mono",Menlo,Consolas,monospace;
  /* motion */
  --ease:cubic-bezier(.22,.61,.36,1); --ease-out:cubic-bezier(.16,1,.3,1); --ease-spring:cubic-bezier(.34,1.4,.64,1);
  --dur-1:.12s; --dur-2:.2s; --dur-3:.32s;
  /* layout */
  --sb:288px; --rail:68px; --topbar:58px; --tabbar:64px; --peek:420px;
  --safe-b:env(safe-area-inset-bottom,0px); --safe-t:env(safe-area-inset-top,0px);
}
:root[data-theme=light]{
  color-scheme:light;
  --bg:#f4f6fa; --bg-grad:radial-gradient(1200px 700px at 10% -10%,rgba(13,148,136,.07),transparent 60%),
    radial-gradient(900px 600px at 100% 0%,rgba(79,70,229,.06),transparent 55%);
  --surface-0:#f4f6fa; --surface-1:#ffffff; --surface-2:#f1f4f9; --surface-3:#e8edf4;
  --glass:#ffffff; --glass-strong:#ffffff;
  --line:rgba(15,23,42,.09); --line-strong:rgba(15,23,42,.16);
  --fg:#0f172a; --text-1:#0f172a; --text-2:#3b475c; --muted:#5b6880; --text-3:#8a95a8;
  --accent:#0d9488; --accent-2:#4f46e5; --accent-3:#0369a1;
  --brand-grad:linear-gradient(135deg,#0d9488 0%,#0284c7 50%,#6d28d9 100%);
  ${PRIMARY_LIGHT}
  --accent-soft:rgba(13,148,136,.09); --accent-line:rgba(13,148,136,.34); --on-accent:#ffffff;
  --ok:#15803d; --warn:#b45309; --danger:#dc2626; --info:#0369a1;
  --ok-soft:rgba(21,128,61,.09); --warn-soft:rgba(180,83,9,.09); --danger-soft:rgba(220,38,38,.08);
  --hover:rgba(15,23,42,.05); --press:rgba(15,23,42,.09);
  --ring:0 0 0 2px var(--surface-1),0 0 0 4px rgba(13,148,136,.6);
  --shadow-sm:0 1px 2px rgba(15,23,42,.06);
  --shadow:0 16px 40px -14px rgba(15,23,42,.2),0 0 0 1px rgba(15,23,42,.05);
  --shadow-lg:0 30px 70px -22px rgba(15,23,42,.28),0 0 0 1px rgba(15,23,42,.06);
}

/* base */
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 var(--font);
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;overflow:hidden;
  text-rendering:optimizeLegibility;font-feature-settings:"cv11","ss01"}
button,input,select,textarea{font:inherit;color:inherit;letter-spacing:inherit}
button{background:none;border:0;cursor:pointer;padding:0}
a{color:var(--accent-3);text-decoration:none}
a:hover{text-decoration:underline}
.hidden{display:none !important}
.grow{flex:1 1 auto}
.sr-only{position:absolute !important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.i{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
:focus{outline:none}
:focus-visible{outline:none;box-shadow:var(--ring);border-radius:var(--r-sm)}
/* Text fields show focus on their own box; the ring would draw a second border inside it. */
:where(input,textarea,select):focus-visible{box-shadow:none}
::selection{background:rgba(94,234,212,.24)}
:root[data-theme=light] ::selection{background:rgba(13,148,136,.18)}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:8px;border:3px solid transparent;background-clip:content-box}
::-webkit-scrollbar-thumb:hover{background:var(--text-3);background-clip:content-box;border:3px solid transparent}
*{scrollbar-width:thin;scrollbar-color:var(--line-strong) transparent}
kbd,.kbd{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:6px;
  font:600 11px/1 var(--font);color:var(--text-2);background:var(--surface-2);border:1px solid var(--line-strong);
  box-shadow:inset 0 -1px 0 var(--line)}
html.theme-anim *,html.theme-anim *::before,html.theme-anim *::after{transition:background-color .35s ease,border-color .35s ease,color .35s ease,fill .35s ease,stroke .35s ease !important}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001ms !important;animation-iteration-count:1 !important;
    transition-duration:.001ms !important;scroll-behavior:auto !important}
}
`;
