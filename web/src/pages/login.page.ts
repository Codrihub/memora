// The sign-in page, rendered by scripts/build-pages.mjs into crates/http/assets/login.html.
// Every view starts `hidden`; only the splash shows until login.ts picks one, so nothing flashes on load.

import type * as BrandFontModule from '../brand-font';
import type * as UiFontModule from '../ui-font';
import type * as BrandModule from '../brand';
import type * as ThemeModule from '../login-theme';

declare const process: {
  argv: string[];
  getBuiltinModule(id: 'node:module'): { createRequire(path: string): (id: string) => unknown };
};

// Imported from a data: URL by build-pages.mjs, so siblings load relative to the build script.
const load = process.getBuiltinModule('node:module').createRequire(process.argv[1] ?? '');
const { markSvg, faviconDataUri, BRAND_TAG, BRAND_MOTTO } = load('../src/brand.ts') as typeof BrandModule;
const { BRAND_FONT, BRAND_FONT_CSS } = load('../src/brand-font.ts') as typeof BrandFontModule;
const { UI_FONT_CSS } = load('../src/ui-font.ts') as typeof UiFontModule;
const { THEME_BOOT, LOGIN_CSS } = load('../src/login-theme.ts') as typeof ThemeModule;

const I = {
  user: '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  signin: '<svg class="btn-ico" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/></svg>',
  check: '<svg class="btn-ico" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  arrow: '<svg class="btn-ico" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
  padlock: '<svg viewBox="0 0 24 24"><rect x="4" y="10.5" width="16" height="10" rx="2.4"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><path d="M12 14.6v2.2"/></svg>',
  hourglass: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.8l2.4 1.6M9.5 3h5M12 3v3"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 11v3M12 17h.01"/></svg>',
  brain: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="7" r="2.2"/><circle cx="12" cy="18" r="2.2"/><circle cx="12" cy="11" r="1.6"/><path d="M7.8 7.2 10.6 10M16.2 8.2 13.4 10.2M12 12.6v3.2"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M17 6l2.5 2.5M14.5 8.5l2 2"/></svg>',
  ok: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
};

/** The brand side's constellation: notes as points, nearby ones linked (seeded, so every build draws the same). */
function constellation(): string {
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pts = Array.from({ length: 34 }, () => [Math.round(rnd() * 600), Math.round(rnd() * 800)] as const);
  const lines: string[] = [];
  pts.forEach(([x, y], i) => {
    for (let j = i + 1; j < pts.length; j++) {
      const [u, v] = pts[j];
      if (Math.hypot(x - u, y - v) < 150) lines.push(`<line x1="${x}" y1="${y}" x2="${u}" y2="${v}"/>`);
    }
  });
  const dots = pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 5 === 0 ? 3.2 : 1.8}"/>`).join('');
  return `<svg class="lx-net" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g class="l">${lines.join('')}</g><g class="d">${dots}</g></svg>`;
}

/** Words of a command; lines break only between them (login.ts setCmd does the same). */
const words = (cmd: string): string => cmd.split(' ').map((w) => `<span class="w">${w}</span>`).join(' ');

/** A command block: label, command, copy button beside it (never on top). */
function cli(id: string, label: string, cmd: string): string {
  return `<div class="clicmd">
      <div class="clilabel" id="${id}Label">${label}</div>
      <div class="clirow"><code id="${id}">${words(cmd)}</code><button type="button" class="clibtn" data-copy="${id}" aria-label="Copy command">${I.copy}<span>Copy</span></button></div>
    </div>`;
}

function win(id: string): string {
  return `<div class="win" data-win id="${id}">${I.clock}<span class="wtxt">Window open</span><i class="wbar"></i></div>`;
}

const waiting = (txt: string): string => `<div class="waiting"><span class="spin"></span><span>${txt}</span></div>`;

/** Shown under a password field only while Caps Lock is on. */
const caps = (id: string): string => `<p class="caps" id="${id}" hidden>${I.alert}<span>Caps Lock is on</span></p>`;

const checkRow = (id: string, label: string): string =>
  `<li id="${id}"><span class="ci">${I.ok}</span><span>${label}</span><span class="cv"></span></li>`;

/** `css` is the compiled src/login.css, `js` the compiled src/login.ts. */
export function loginPage(css: string, js: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<script>${THEME_BOOT}</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0b0e14">
<title>Sign in - Memora</title>
<link rel="icon" type="image/svg+xml" href="${faviconDataUri()}">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<style>
${UI_FONT_CSS}
${BRAND_FONT_CSS}
.card .brand .brand-txt b{font-family:${BRAND_FONT};font-weight:700;font-size:28px;line-height:1.05;letter-spacing:0}
.lx-top b{font-family:${BRAND_FONT};font-weight:700;font-size:34px;line-height:1;letter-spacing:0}
${css}
${LOGIN_CSS}
</style>
</head>
<body>
<div class="lx">
<aside class="lx-side" aria-hidden="true">
  ${constellation()}
  <div class="lx-top">${markSvg()}<b>Memora</b></div>
  <div class="lx-copy"><h2>${BRAND_MOTTO}</h2><p>One private memory that you and your AI apps share, so nothing has to be explained twice.</p></div>
  <div class="lx-foot">${BRAND_TAG}</div>
</aside>
<div class="lx-main">
<main class="card splashing" id="card">
  <div class="brand">
    ${markSvg()}
    <div class="brand-txt"><b>Memora</b><small>${BRAND_MOTTO}</small></div>
  </div>

  <div id="alert" class="alert" role="alert">${I.alert}<span id="alertMsg"></span><button type="button" class="alert-x" id="alertX" aria-label="Dismiss message">${I.x}</button></div>

  <!-- SPLASH: shown until routing completes -->
  <section class="view splash" id="vSplash">
    ${markSvg('brand-mark')}
    <h1 id="splashTitle">Checking this instance&hellip;</h1>
    <ul class="checks">
      ${checkRow('ckServer', 'Server reachable')}
      ${checkRow('ckReady', 'Vault and state ready')}
      ${checkRow('ckAccount', 'Account status')}
    </ul>
    <button type="button" class="btn ghost" id="retryBtn" hidden>Try again</button>
  </section>

  <!-- SIGN IN -->
  <section class="view" id="vSignin" hidden>
    <p class="eyebrow">Welcome back</p>
    <h1>Sign in</h1>
    <p class="sub">This vault is private. Sign in to see your notes, the brain and agent activity.</p>
    <form id="loginForm" autocomplete="on">
      <div class="field"><label for="u">Username</label>
        <div class="inp">${I.user}<input id="u" name="username" type="text" placeholder="username" autocomplete="username" required spellcheck="false" autocapitalize="off"></div>
      </div>
      <div class="field"><label for="p">Password</label>
        <div class="inp">${I.lock}<input id="p" name="password" type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" autocomplete="current-password" aria-describedby="pCaps" required><button type="button" class="eye" id="eye" aria-label="Show password">${I.eye}</button></div>
        ${caps('pCaps')}
      </div>
      <button class="btn" id="submitBtn" type="submit"><span class="spinner"></span>${I.signin}<span id="btnTxt">Sign in</span></button>
    </form>
    <p class="links"><a href="#help" id="helpLink">Forgot password or need help?</a></p>
  </section>

  <!-- OAUTH CONSENT (an AI app connecting over MCP) -->
  <section class="view" id="vOauth" hidden>
    <div class="ico">${I.key}</div>
    <p class="eyebrow">Connect an AI app</p>
    <h1 id="oaTitle">Allow access?</h1>
    <p class="sub" id="oaSub">Checking the request&hellip;</p>
    <ul class="checklist" id="oaList">
      <li>${I.key}<span>Gets its own agent key: read and write nodes over MCP</span><em></em></li>
      <li>${I.folder}<span>Every call shows up live in the brain and Activity</span><em></em></li>
      <li>${I.lock}<span>Revoke it anytime in Agents &amp; API keys</span><em></em></li>
    </ul>
    <p class="note" id="oaWho"></p>
    <div id="oaActs">
      <button class="btn" id="oaAllow" type="button"><span class="spinner"></span>${I.check}<span>Allow</span></button>
      <button class="btn ghost" id="oaDeny" type="button" style="margin-top:8px">Cancel</button>
    </div>
  </section>

  <!-- NOT SET UP: a wider card on wide screens, intro beside the steps -->
  <section class="view setup" id="vSetup" hidden>
    <div class="su-grid">
      <div class="su-intro">
        <h1>Welcome to Memora</h1>
        <p class="sub">One private memory that you and your AI apps share, so nothing has to be explained twice.</p>
        <ul class="checklist about">
          <li>${I.folder}<span><b>Your notes, your files</b> Plain Markdown in a folder you choose</span><em></em></li>
          <li>${I.brain}<span><b>Brain, Graph, Canvas</b> See how your notes connect</span><em></em></li>
          <li>${I.key}<span><b>One memory for every AI</b> Claude, ChatGPT, Cursor and more, each with its own key</span><em></em></li>
          <li>${I.globe}<span><b>From anywhere</b> This computer, your network or the internet</span><em></em></li>
        </ul>
      </div>
      <div class="su-steps">
        <p class="steps-h">Set it up in two steps</p>
        <ol class="su-list">
          <li><span class="su-n" aria-hidden="true">1</span><div class="su-b"><b>Get a one-time code on the server</b>
            ${cli('setupCmd', 'Run this command', 'memora-cli setup')}</div></li>
          <li><span class="su-n" aria-hidden="true">2</span><div class="su-b"><b>Enter the code here</b>
            <p class="note">This page moves on by itself.</p></div></li>
        </ol>
        ${waiting('Waiting for setup&hellip;')}
      </div>
    </div>
  </section>

  <!-- WINDOW OPEN: CODE STEP -->
  <section class="view" id="vCode" hidden>
    ${win('winCode')}
    <h1 id="codeTitle">Enter the setup code</h1>
    <p class="sub" id="codeSub">Type the code printed on the server.</p>
    <form id="codeForm">
      <div class="field"><label for="code" id="codeLabel">Setup code</label>
        <div class="inp code" id="codeInp"><input id="code" name="one-time-code" type="text" inputmode="text" autocomplete="one-time-code" enterkeyhint="go" placeholder="XXXX-XXXX" maxlength="9" spellcheck="false" autocapitalize="characters" required></div>
      </div>
      <button class="btn" id="codeBtn" type="submit" disabled><span class="spinner"></span>${I.arrow}<span id="codeBtnTxt">Continue</span></button>
    </form>
    <p class="note center">Lost the code? Run <code id="codeAgain">memora-cli setup</code> on the server for a new one.</p>
  </section>

  <!-- WINDOW OPEN: ACCOUNT FORM (setup or reset) -->
  <section class="view" id="vForm" hidden>
    ${win('winForm')}
    <h1 id="formTitle">Create the owner account</h1>
    <p class="sub" id="formSub">You will use these to sign in.</p>
    <form id="setForm" autocomplete="on">
      <div class="field"><label for="su">Username</label>
        <div class="inp" id="inp1">${I.user}<input id="su" name="username" type="text" placeholder="username" autocomplete="username" required spellcheck="false" autocapitalize="off"></div>
      </div>
      <div class="field"><label for="sp">Password</label>
        <div class="inp" id="inp3">${I.lock}<input id="sp" name="new-password" type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" autocomplete="new-password" aria-describedby="rules spCaps" required><button type="button" class="eye" id="eye2" aria-label="Show password">${I.eye}</button></div>
        ${caps('spCaps')}
        <div class="strength show" id="strength"><i></i></div>
        <div class="rules" id="rules"></div>
      </div>
      <div class="field"><label for="sp2">Confirm password</label>
        <div class="inp" id="inp2">${I.lock}<input id="sp2" name="confirm-password" type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" autocomplete="new-password" aria-describedby="match sp2Caps" required><button type="button" class="eye" id="eye3" aria-label="Show confirm password">${I.eye}</button></div>
        ${caps('sp2Caps')}
        <div class="rules" id="match"></div>
      </div>
      <button class="btn" id="setBtn" type="submit" disabled><span class="spinner"></span>${I.check}<span id="setBtnTxt">Create account</span></button>
    </form>
    <p class="links"><a href="#" id="backToCode">&larr; Use a different code</a></p>
  </section>

  <!-- NOT READY -->
  <section class="view" id="vNotReady" hidden>
    <div class="ico warn">${I.folder}</div>
    <h1>Instance not ready</h1>
    <p class="sub">Setup stays locked until the server can write to its folders.</p>
    <ul class="checklist">
      <li id="nrVault">${I.folder}<span>Vault folder writable</span><em></em></li>
      <li id="nrState">${I.key}<span>State folder writable</span><em></em></li>
    </ul>
    ${cli('nrCmd', 'Check and fix on the server', 'memora-cli')}
    ${waiting('Re-checking every few seconds&hellip;')}
  </section>

  <!-- LOCKED (window expired unused) -->
  <section class="view" id="vLocked" hidden>
    <div class="ico">${I.padlock}</div>
    <h1>Access held</h1>
    <p class="sub" id="lockWhy">The setup or reset window expired before it was completed. Access stays on hold until that finishes.</p>
    ${cli('lockCmd', 'Open the console on the server', 'memora-cli')}
    <p class="note">Then type <code>/guide</code> to recover with a fresh one-time code.</p>
    ${waiting('Waiting for a new window&hellip; this page continues on its own.')}
  </section>

  <!-- COOLDOWN -->
  <section class="view center" id="vCooldown" hidden>
    <div class="ico calm" style="margin-left:auto;margin-right:auto">${I.hourglass}</div>
    <h1>Too many attempts</h1>
    <p class="sub" style="margin-bottom:8px">Attempts from this device are paused for safety. Try again in</p>
    <div class="timer" id="cdTime">0:00</div>
    <div class="tbar"><i id="cdBar"></i></div>
    <p class="note" style="margin-top:0">This page continues on its own when the pause ends.</p>
    <p class="note" style="margin-top:14px">Was it you? You can end the pause on the server now.</p>
    ${cli('cdCmd', 'End the pause on the server', 'memora-cli clear-cooldowns')}
  </section>

  <!-- HELP -->
  <section class="view" id="vHelp" hidden>
    <h1>Need help signing in?</h1>
    <p class="sub">Passwords are reset on the server that runs Memora.</p>
    ${cli('resetCmd', 'Run this on the server', 'memora-cli reset-password')}
    <p class="note">It prints a one-time code. This page moves on by itself.</p>
    <p class="links"><a href="#" id="backLink">&larr; Back to sign in</a></p>
  </section>

  <footer class="foot"><span><i class="dot" id="dot"></i><span id="footState">checking</span></span><span class="tag">${BRAND_TAG}</span></footer>
</main>
</div>
</div>

<script>
${js}
</script></body>
</html>
`;
}
