// Sign-in page controller. Compiled into login.html by scripts/build-pages.mjs
// (esbuild transform, no bundling: this file must stay self-contained).
//
// Flow: a splash checks the instance (/api/auth/me + /api/auth/state), then
// exactly one view is shown:
//   signin   owner exists, nothing pending          (help is its sub-view)
//   setup    no owner yet, no window open            -> waits for a window
//   code     a setup/reset window is open            -> one-time code step
//   form     code accepted                           -> username + password
//   notready vault/state folder not writable
//   locked   a window expired unused                 -> waits for a new one
//   cooldown too many failed attempts               -> returns afterwards
// No view renders before routing completes.

type View = 'splash' | 'signin' | 'help' | 'setup' | 'code' | 'form' | 'notready' | 'locked' | 'cooldown' | 'oauth';

interface AuthState {
  bootstrap?: boolean;
  armed?: boolean;
  locked?: boolean;
  mode?: string;
  expires_in?: number;
  ttl?: number;
  vault_configured?: boolean;
  ready?: boolean;
  checks?: { vault?: boolean; state?: boolean };
  cooldown?: number;
  min_password_len?: number;
  setup_hint?: string;
  /** Why this browser's session was ended (its cookie is dead): a reason code. */
  signed_out?: string;
}

interface Limited {
  error?: string;
  limited?: boolean;
  cooldown?: boolean;
  retry_after?: number;
}

type StateResult = { ok: true; s: AuthState } | { ok: false; limited?: Limited };

const $ = <T extends HTMLElement = HTMLElement>(s: string): T => document.querySelector(s) as T;
const input = (s: string): HTMLInputElement => $<HTMLInputElement>(s);
const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
const now = (): number => (window.performance ? performance.now() : Date.now());

const VIEWS: Record<View, string> = {
  splash: '#vSplash',
  signin: '#vSignin',
  help: '#vHelp',
  setup: '#vSetup',
  code: '#vCode',
  form: '#vForm',
  notready: '#vNotReady',
  locked: '#vLocked',
  cooldown: '#vCooldown',
  oauth: '#vOauth',
};

/** Views that are the same situation; polling does not switch between them. */
function family(v: View): string {
  if (v === 'help') return 'signin';
  if (v === 'form') return 'code';
  return v;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const alertBox = $('#alert');
const alertMsg = $('#alertMsg');

function showAlert(msg: string, kind: '' | 'ok' | 'warn' = ''): void {
  alertMsg.textContent = msg;
  alertBox.className = 'alert show' + (kind ? ' ' + kind : '');
}

function hideAlert(): void {
  alertBox.className = 'alert';
}

function errText(d: unknown, fallback: string): string {
  const r = (d ?? {}) as { error?: unknown; message?: unknown };
  if (typeof r.error === 'string') return r.error;
  if (typeof r.message === 'string') return r.message;
  return fallback;
}

function busy(btn: HTMLButtonElement, on: boolean, txt?: string, txtEl?: HTMLElement | null): void {
  btn.disabled = on;
  btn.classList.toggle('loading', on);
  if (txt && txtEl) txtEl.textContent = txt;
}

/** Same-origin fetch: the browser sends Origin on POST, which the CSRF check needs. */
function api(path: string, opts: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers as Record<string, string>) };
  return fetch(path, { credentials: 'same-origin', cache: 'no-store', ...opts, headers });
}

function jsonPost(path: string, body: unknown): Promise<Response> {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/** App pages a sign-in may return to (never /api, /logout, files ...). */
const RETURN_TO =
  /^\/(?:$|node\/|(?:brain|nodes|graph|canvas|tags|activity|agents|tools|access|settings|overview|welcome|home|vault|logs|keys|docs)(?:\/|$))/;

/**
 * A same-origin path for `n`, or null (no open redirect). The result must start
 * with exactly one `/`: a path such as `//evil.example` (from
 * `?next=https://this-host//evil.example`) would be read by `location` as a
 * protocol-relative URL to another host.
 */
function samePath(n: string | null | undefined): string | null {
  if (!n || typeof n !== 'string' || n.length > 2048) return null;
  // Control characters (raw or encoded) never belong in a page address.
  if (/[\u0000-\u001f\u007f]/.test(n) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(n)) return null;
  try {
    const u = new URL(n, location.origin);
    if (u.origin !== location.origin) return null;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.pathname.startsWith('/') || u.pathname.startsWith('//') || u.pathname.includes('\\')) return null;
    if (u.pathname === '/login' || u.pathname === '/logout') return null;
    if (u.username || u.password || !RETURN_TO.test(u.pathname)) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

/** Where to go after signing in: `?r=` (or the older `?next=`), on this origin only. */
function safeNext(): string | null {
  const q = new URLSearchParams(location.search);
  return samePath(q.get('r') ?? q.get('next'));
}

/**
 * The OAuth authorize request this page was opened for (`/oauth/authorize`
 * sends the browser here with `?oauth=1&...`), without the marker; null otherwise.
 */
const OAUTH_Q: string | null = (() => {
  const p = new URLSearchParams(location.search);
  if (!p.has('oauth')) return null;
  p.delete('oauth');
  return p.toString();
})();

interface OAuthInfo {
  ok: boolean;
  client?: { id: string; name: string; kind: string };
  redirect_host?: string;
  user?: string | null;
  error?: string;
  error_description?: string;
  redirect?: string | null;
}

/** Leave for the client app (only URLs the server built from a registered redirect URI). */
function toClient(url: string): void {
  if (/^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/?]/.test(url)) location.href = url;
}

/** Signed in during an OAuth request: ask the owner whether the app may connect. */
async function showConsent(): Promise<void> {
  hideAlert();
  setOnline(true);
  let info: OAuthInfo;
  try {
    const r = await api('/api/oauth/request?' + OAUTH_Q);
    info = (await r.json()) as OAuthInfo;
  } catch {
    info = { ok: false, error_description: 'Could not reach the server.' };
  }
  const acts = $('#oaActs');
  if (!info.ok || !info.client) {
    $('#oaTitle').textContent = 'This connection request cannot be used';
    $('#oaSub').textContent = info.error_description || info.error || 'The request is invalid.';
    $('#oaList').hidden = true;
    acts.hidden = !info.redirect;
    if (info.redirect) {
      $('#oaAllow').hidden = true;
      $('#oaDeny').textContent = 'Back to the app';
      $('#oaDeny').onclick = () => toClient(info.redirect!);
    }
    void show('oauth');
    return;
  }
  const name = info.client.name || 'An MCP client';
  $('#oaTitle').textContent = `Allow ${name} to use Memora?`;
  $('#oaSub').textContent = `${name} will connect to this vault as an agent, then return to ${info.redirect_host || 'the app'}.`;
  $('#oaWho').textContent = info.user ? `Signed in as ${info.user}` : '';
  const decide = async (allow: boolean, btn: HTMLButtonElement): Promise<void> => {
    busy(btn, true);
    try {
      const r = await jsonPost('/api/oauth/approve', { query: OAUTH_Q, allow });
      const d = (await r.json().catch(() => ({}))) as { redirect?: string; error?: string; error_description?: string };
      if (d.redirect) return toClient(d.redirect);
      showAlert(errText(d, 'Could not finish the connection'), 'warn');
    } catch {
      showAlert('Could not reach the server', 'warn');
    }
    busy(btn, false);
  };
  ($('#oaAllow') as HTMLButtonElement).onclick = (e) => void decide(true, e.currentTarget as HTMLButtonElement);
  ($('#oaDeny') as HTMLButtonElement).onclick = (e) => void decide(false, e.currentTarget as HTMLButtonElement);
  void show('oauth');
}

function go(next?: string): void {
  // Signed in for an app that is connecting: ask first, then return to it.
  if (OAUTH_Q !== null) {
    void showConsent();
    return;
  }
  // The server's `redirect` goes through the same check as `?next=`.
  const target = safeNext() || samePath(next) || '/';
  if (target === '/login' || target === location.pathname + location.search) return;
  location.replace(target);
}

function mmss(secs: number): string {
  const s = Math.max(0, Math.ceil(secs));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/** A 429 body: cooldown (failed attempts) or plain rate limit. */
function limitedOf(status: number, d: unknown, retryHeader: string | null): Limited | null {
  if (status !== 429) return null;
  const l = (d ?? {}) as Limited;
  const ra = Number(l.retry_after ?? retryHeader ?? 0);
  return { ...l, retry_after: Number.isFinite(ra) ? ra : 0 };
}

let HINT = 'memora-cli setup';
/**
 * How this install runs the console, from the server's hint: everything up to
 * and including `memora-cli` (e.g. `docker exec -it memora memora-cli`).
 */
const cliName = (): string => {
  const m = /^(.*?\bmemora-cli(?:\.exe)?)(?=\s|$)/.exec(HINT.trim());
  return m ? m[1]! : HINT.trim().split(/\s+/)[0] || 'memora-cli';
};
/** The one command that opens the setup window and prints the code. */
const SETUP_ARGS = 'setup --minutes 15';

/* ------------------------------------------------------------------ */
/* View switching                                                      */
/* ------------------------------------------------------------------ */

let current: View = 'splash';
let switching = 0;
const card = $('#card');

/** Crossfade to `v`: fade the current view out, then the next one in. */
async function show(v: View): Promise<void> {
  // Already showing (or switching to) it: a second call must not cancel the first.
  if (v === current) return;
  const token = ++switching;
  const from = current;
  current = v;
  const out = $(VIEWS[from]);
  if (out && !out.hidden) {
    out.classList.add('leaving');
    await sleep(150);
    if (token !== switching) return;
    out.classList.remove('leaving');
    out.hidden = true;
  }
  Object.entries(VIEWS).forEach(([k, sel]) => {
    const el = $(sel);
    el.classList.remove('leaving');
    if (k !== v) el.hidden = true;
  });
  card.classList.toggle('splashing', v === 'splash');
  // Only the welcome view uses the wide two-column card.
  card.classList.toggle('wide', v === 'setup');
  $(VIEWS[v]).hidden = false;
  const focus: Partial<Record<View, string>> = { signin: '#u', code: '#code', form: '#su' };
  const f = focus[v];
  if (f) {
    const el = input(f);
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }
  syncPolling();
}

/* ------------------------------------------------------------------ */
/* Server state                                                        */
/* ------------------------------------------------------------------ */

let LAST: AuthState = {};

/** Plain words for the reasons a session is ended on purpose. */
const SIGNED_OUT_TEXT: Record<string, string> = {
  password_changed: 'You were signed out because the password was changed on another device. Sign in with the new password.',
  signed_out_remotely: 'You were signed out from another device. Sign in again to continue.',
  expired: 'Your session expired. Sign in again to continue.',
};

/** The reason from the server (dead cookie) or `?reason=` (set by the app on a 401). */
let SIGNED_OUT: string | null = new URLSearchParams(location.search).get('reason');

function signedOutText(): string {
  // Own keys only: `?reason=constructor` must not reach Object.prototype.
  return SIGNED_OUT && Object.prototype.hasOwnProperty.call(SIGNED_OUT_TEXT, SIGNED_OUT)
    ? SIGNED_OUT_TEXT[SIGNED_OUT]
    : '';
}

async function fetchState(): Promise<StateResult> {
  try {
    const r = await api('/api/auth/state');
    const d = (await r.json().catch(() => null)) as unknown;
    const lim = limitedOf(r.status, d, r.headers.get('retry-after'));
    if (lim) return { ok: false, limited: lim };
    if (!r.ok || !d || typeof d !== 'object') return { ok: false };
    const s = d as AuthState;
    if (s.setup_hint) HINT = s.setup_hint;
    if (s.signed_out) SIGNED_OUT = s.signed_out;
    LAST = s;
    return { ok: true, s };
  } catch {
    return { ok: false };
  }
}

function setOnline(on: boolean): void {
  $('#dot').className = 'dot ' + (on ? 'on' : 'off');
  $('#footState').textContent = on ? 'gateway online' : 'gateway unreachable';
}

/** The single view the server state calls for. */
function decide(s: AuthState): View {
  if ((s.cooldown ?? 0) > 0) return 'cooldown';
  const pending = !!(s.armed || s.locked || s.bootstrap);
  if (pending && s.ready === false) return 'notready';
  if (s.armed) return 'code';
  if (s.locked) return 'locked';
  if (s.bootstrap) return 'setup';
  return location.hash === '#help' ? 'help' : 'signin';
}

/** Fill a view from the state, then show it. */
function enter(v: View, s: AuthState): void {
  const cli = cliName();
  hideAlert();
  switch (v) {
    case 'signin':
      if (s.ready === false) {
        showAlert('The server cannot write to its vault or state folder. Run ' + cli + ' on the server to check it.', 'warn');
      } else if (signedOutText()) {
        showAlert(signedOutText(), 'warn');
      }
      break;
    case 'help':
      $('#resetCmd').textContent = cli;
      break;
    case 'setup':
      $('#setupCmd').textContent = cli + ' ' + SETUP_ARGS;
      break;
    case 'code':
      prepareCode(s);
      $('#codeAgain').textContent = cli + (s.mode === 'reset' || s.mode === 'reset-password' ? ' reset-password' : ' setup');
      break;
    case 'notready': {
      const row = (id: string, ok: boolean | undefined): void => {
        const li = $(id);
        li.className = ok === false ? 'bad' : 'ok';
        (li.querySelector('em') as HTMLElement).textContent = ok === false ? 'Not writable' : 'OK';
      };
      row('#nrVault', s.checks?.vault);
      row('#nrState', s.checks?.state);
      $('#nrCmd').textContent = cli;
      break;
    }
    case 'locked':
      $('#lockCmd').textContent = cli;
      $('#lockWhy').textContent = s.bootstrap
        ? 'The setup window expired before the owner account was created. Access stays on hold until setup finishes.'
        : 'The reset window expired before the new password was saved. Access stays on hold until the reset finishes.';
      break;
    case 'cooldown':
      startCooldown(s.cooldown ?? 60);
      break;
    default:
      break;
  }
  void show(v);
}

/* ------------------------------------------------------------------ */
/* Polling while waiting on the server terminal                        */
/* ------------------------------------------------------------------ */

let POLL: number | null = null;
const POLLED: View[] = ['setup', 'code', 'form', 'notready', 'locked', 'help'];

function syncPolling(): void {
  const want = POLLED.includes(current);
  if (want && POLL === null) POLL = window.setInterval(() => void poll(), 3000);
  if (!want && POLL !== null) {
    clearInterval(POLL);
    POLL = null;
  }
}

let polling = false;
async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const r = await fetchState();
    if (!r.ok) {
      if (r.limited?.cooldown) enterCooldown(r.limited.retry_after ?? 60);
      return;
    }
    setOnline(true);
    const s = r.s;
    // Keep the window countdown honest.
    if ((current === 'code' || current === 'form') && s.armed && typeof s.expires_in === 'number') {
      setWindow(s.expires_in, s.ttl);
    }
    const want = decide(s);
    if (family(want) !== family(current)) enter(want, s);
    else if (want === 'notready') enter(want, s);
  } finally {
    polling = false;
  }
}

/** Re-read the state now and move to whatever it calls for. */
async function refresh(): Promise<void> {
  const r = await fetchState();
  if (r.ok) {
    setOnline(true);
    enter(decide(r.s), r.s);
  } else if (r.limited?.cooldown) {
    enterCooldown(r.limited.retry_after ?? 60);
  }
}

/* ------------------------------------------------------------------ */
/* Cooldown                                                            */
/* ------------------------------------------------------------------ */

let CD: number | null = null;
let BEFORE_CD: View | null = null;

function enterCooldown(secs: number): void {
  hideAlert();
  startCooldown(secs);
  void show('cooldown');
}

function startCooldown(secs: number): void {
  if (current !== 'cooldown' && current !== 'splash') BEFORE_CD = current;
  if (CD !== null) clearInterval(CD);
  const total = Math.max(1, secs);
  const end = Date.now() + secs * 1000;
  const time = $('#cdTime');
  const bar = $('#cdBar');
  const tick = (): void => {
    const left = (end - Date.now()) / 1000;
    time.textContent = mmss(left);
    bar.style.width = Math.max(0, Math.min(100, (left / total) * 100)) + '%';
    if (left <= 0) {
      if (CD !== null) clearInterval(CD);
      CD = null;
      void leaveCooldown();
    }
  };
  tick();
  CD = window.setInterval(tick, 500);
}

async function leaveCooldown(): Promise<void> {
  const prev = BEFORE_CD;
  BEFORE_CD = null;
  const r = await fetchState();
  if (!r.ok) {
    if (r.limited?.cooldown) startCooldown(r.limited.retry_after ?? 30);
    else if (prev) void show(prev);
    return;
  }
  const want = decide(r.s);
  if (want === 'cooldown') {
    startCooldown(r.s.cooldown ?? 30);
    BEFORE_CD = prev;
    return;
  }
  // Back to where the user was, if that still applies (keeps typed values).
  if (prev && family(prev) === family(want)) void show(prev);
  else enter(want, r.s);
}

/** Handle a 429: cooldown view, or a short inline note for a plain rate limit. */
function handleLimited(lim: Limited): void {
  if (lim.cooldown) enterCooldown(lim.retry_after || 60);
  else showAlert('Too many requests. Wait a few seconds and try again.', 'warn');
}

/* ------------------------------------------------------------------ */
/* Password visibility                                                 */
/* ------------------------------------------------------------------ */

const EYE_ON = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF =
  '<path d="M9.9 5.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-3.2 4.1"/><path d="M6.1 6.4A18 18 0 0 0 2 12s3.6 7 10 7a10.5 10.5 0 0 0 4.3-.9"/><path d="M3 3l18 18"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';

function wireEye(btnSel: string, inpSel: string): () => void {
  const b = $<HTMLButtonElement>(btnSel);
  const i = input(inpSel);
  const svg = b.querySelector('svg');
  const paint = (): void => {
    const shown = i.type === 'text';
    if (svg) svg.innerHTML = shown ? EYE_OFF : EYE_ON;
    b.title = shown ? 'Hide password' : 'Show password';
    b.setAttribute('aria-label', b.title);
    b.style.color = shown ? 'var(--accent-2)' : '';
  };
  b.addEventListener('click', () => {
    i.type = i.type === 'password' ? 'text' : 'password';
    paint();
    try {
      i.focus({ preventScroll: true });
    } catch {
      /* focus options unsupported */
    }
  });
  paint();
  return () => {
    i.type = 'password';
    paint();
  };
}

wireEye('#eye', '#p');
const hideSp = wireEye('#eye2', '#sp');
const hideSp2 = wireEye('#eye3', '#sp2');

/* ------------------------------------------------------------------ */
/* Sign in                                                             */
/* ------------------------------------------------------------------ */

$('#loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  void (async () => {
    hideAlert();
    const btn = $<HTMLButtonElement>('#submitBtn');
    const txt = $('#btnTxt');
    busy(btn, true, 'Signing in...', txt);
    try {
      const r = await jsonPost('/api/auth/login', { username: input('#u').value.trim(), password: input('#p').value });
      const d = (await r.json().catch(() => ({}))) as { redirect?: string };
      const lim = limitedOf(r.status, d, r.headers.get('retry-after'));
      if (lim) {
        busy(btn, false, 'Sign in', txt);
        handleLimited(lim);
        return;
      }
      if (!r.ok) {
        const msg =
          r.status === 401
            ? 'Wrong username or password.'
            : r.status === 503
              ? 'The server is busy. Try again in a moment.'
              : errText(d, 'Sign-in failed (' + r.status + ').');
        showAlert(msg);
        busy(btn, false, 'Sign in', txt);
        input('#p').select();
        return;
      }
      showAlert('Signed in. Opening your vault...', 'ok');
      go(d.redirect);
    } catch (err) {
      showAlert('Could not reach the server: ' + (err as Error).message);
      busy(btn, false, 'Sign in', txt);
    }
  })();
});

/* Help (#help) is a sub-view of sign in. */
window.addEventListener('hashchange', () => {
  if (family(current) !== 'signin') return;
  enter(location.hash === '#help' ? 'help' : 'signin', LAST);
});
$('#backLink').addEventListener('click', (e) => {
  e.preventDefault();
  history.pushState(null, '', location.pathname + location.search);
  enter('signin', LAST);
});

/* ------------------------------------------------------------------ */
/* Setup / reset window: countdown                                     */
/* ------------------------------------------------------------------ */

let WIN: number | null = null;
let WIN_END = 0;
let WIN_TOTAL = 300;
let WIN_DONE = false;

/**
 * Start or resync the window countdown shown on the code and form steps.
 * Both numbers come from the server, so a reload shows the same time left.
 */
function setWindow(secs: number, total?: number): void {
  WIN_TOTAL = typeof total === 'number' && total > 0 ? total : Math.max(WIN_TOTAL, secs, 1);
  WIN_END = Date.now() + secs * 1000;
  WIN_DONE = false;
  if (WIN === null) WIN = window.setInterval(tickWindow, 1000);
  tickWindow();
}

function stopWindow(): void {
  if (WIN !== null) clearInterval(WIN);
  WIN = null;
}

function tickWindow(): void {
  const left = Math.max(0, Math.round((WIN_END - Date.now()) / 1000));
  document.querySelectorAll<HTMLElement>('[data-win]').forEach((el) => {
    const txt = el.querySelector('.wtxt') as HTMLElement;
    const bar = el.querySelector('.wbar') as HTMLElement;
    if (left <= 0) {
      el.className = 'win expired';
      txt.textContent = 'Window expired. Checking the server...';
      bar.style.width = '0%';
    } else {
      el.className = 'win' + (left <= 45 ? ' warn' : '');
      txt.innerHTML = 'Window open, <b>' + mmss(left) + '</b> left';
      bar.style.width = Math.round((left / WIN_TOTAL) * 100) + '%';
    }
  });
  if (left <= 0 && !WIN_DONE) {
    WIN_DONE = true;
    stopWindow();
    $<HTMLButtonElement>('#setBtn').disabled = true;
    $<HTMLButtonElement>('#codeBtn').disabled = true;
    window.setTimeout(() => void refresh(), 1200);
  }
}

/**
 * A wrong code voids the window on the server. Leave the code and form steps
 * for whatever the instance shows now, and say why.
 */
async function afterBurn(msg: string): Promise<void> {
  stopWindow();
  input('#code').value = '';
  const st = await fetchState();
  const s = st.ok ? st.s : {};
  enter(st.ok ? decide(s) : 'setup', s);
  showAlert(msg, 'warn');
}

/* ------------------------------------------------------------------ */
/* Code step                                                           */
/* ------------------------------------------------------------------ */

interface Arm {
  mode: string;
  min: number;
  user: string | null;
  code: string;
}
let ARM: Arm = { mode: 'bootstrap', min: 10, user: null, code: '' };

const isReset = (): boolean => ARM.mode === 'reset' || ARM.mode === 'reset-password';
const rawCode = (v: string): string => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

function prepareCode(s: AuthState): void {
  ARM = { mode: s.mode || (s.bootstrap ? 'bootstrap' : 'reset'), min: s.min_password_len || 10, user: null, code: '' };
  const reset = isReset();
  $('#codeTitle').textContent = reset ? 'Enter the reset code' : 'Enter the setup code';
  $('#codeSub').textContent =
    'Enter the ' + (reset ? 'reset' : 'setup') + ' code shown in the server terminal. A few wrong tries from one device pause it for a while.';
  $('#codeLabel').textContent = reset ? 'Reset code' : 'Setup code';
  const c = input('#code');
  c.value = '';
  c.disabled = false;
  $('#codeInp').classList.remove('bad');
  $<HTMLButtonElement>('#codeBtn').disabled = true;
  setWindow(typeof s.expires_in === 'number' ? s.expires_in : 300, s.ttl);
}

input('#code').addEventListener('input', () => {
  const c = input('#code');
  const raw = rawCode(c.value);
  c.value = raw.length > 4 ? raw.slice(0, 4) + '-' + raw.slice(4) : raw;
  $('#codeInp').classList.remove('bad');
  $<HTMLButtonElement>('#codeBtn').disabled = raw.length !== 8 || WIN_DONE;
});

function shake(el: HTMLElement): void {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

$('#codeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  void (async () => {
    const code = rawCode(input('#code').value);
    if (code.length !== 8) return;
    hideAlert();
    const btn = $<HTMLButtonElement>('#codeBtn');
    const txt = $('#codeBtnTxt');
    busy(btn, true, 'Checking...', txt);
    try {
      const r = await jsonPost('/api/auth/verify', { code });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        mode?: string;
        expires_in?: number;
        user?: string | null;
        error?: string;
        burned?: boolean;
      };
      busy(btn, false, 'Continue', txt);
      const lim = limitedOf(r.status, d, r.headers.get('retry-after'));
      if (lim) {
        handleLimited(lim);
        return;
      }
      if (!r.ok || !d.ok) {
        const msg = errText(d, 'Code check failed (' + r.status + ').');
        if (d.burned) {
          await afterBurn(msg);
        } else {
          showAlert(msg);
          window.setTimeout(() => void refresh(), 1500);
        }
        return;
      }
      ARM.code = code;
      if (d.mode) ARM.mode = d.mode;
      ARM.user = d.user ?? null;
      if (typeof d.expires_in === 'number') setWindow(d.expires_in);
      prepareForm();
      void show('form');
    } catch (err) {
      busy(btn, false, 'Continue', txt);
      showAlert('Could not reach the server: ' + (err as Error).message);
    }
  })();
});

/* ------------------------------------------------------------------ */
/* Account form (setup or reset)                                       */
/* ------------------------------------------------------------------ */

function prepareForm(): void {
  const reset = isReset();
  $('#formTitle').textContent = reset ? 'Reset password' : 'Create the owner account';
  $('#formSub').textContent = reset
    ? 'Set a new password for the owner. Change the username to rename the account.'
    : 'Choose a username and password for this vault.';
  $('#setBtnTxt').textContent = reset ? 'Save new password' : 'Create account';
  input('#su').value = reset && ARM.user ? ARM.user : '';
  input('#sp').value = '';
  input('#sp2').value = '';
  (['#su', '#sp', '#sp2'] as const).forEach((s) => (input(s).disabled = false));
  hideSp();
  hideSp2();
  ['#inp1', '#inp2', '#inp3'].forEach((s) => $(s).classList.remove('ok', 'bad'));
  $('#setBtn').classList.remove('loading');
  checkForm();
}

function strength(pw: string): number {
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 4);
}

function checkForm(): void {
  const min = ARM.min;
  const pw = input('#sp').value;
  const pw2 = input('#sp2').value;
  const bar = $('#strength');
  const fill = bar.querySelector('i') as HTMLElement;
  const rules = $('#rules');
  const inp3 = $('#inp3');
  if (!pw) {
    bar.classList.remove('show');
    rules.textContent = '';
    rules.className = 'rules';
    inp3.classList.remove('ok', 'bad');
  } else {
    bar.classList.add('show');
    const s = strength(pw);
    fill.style.width = [15, 35, 60, 82, 100][s] + '%';
    fill.style.background = ['var(--danger)', 'var(--danger)', 'var(--warn)', 'var(--ok)', 'var(--ok)'][s];
    const okLen = pw.length >= min;
    rules.textContent = okLen
      ? 'Length OK (' + pw.length + ' characters)'
      : 'At least ' + min + ' characters (' + pw.length + ' so far)';
    rules.className = 'rules ' + (okLen ? 'ok' : 'bad');
    inp3.classList.toggle('ok', okLen);
    inp3.classList.toggle('bad', !okLen);
  }
  const m = $('#match');
  const inp2 = $('#inp2');
  if (!pw2) {
    m.textContent = '';
    m.className = 'rules';
    inp2.classList.remove('ok', 'bad');
  } else {
    const same = pw2 === pw;
    m.textContent = same ? 'Passwords match' : 'Passwords do not match';
    m.className = 'rules ' + (same ? 'ok' : 'bad');
    inp2.classList.toggle('ok', same);
    inp2.classList.toggle('bad', !same);
  }
  const ready = pw.length >= min && pw2 === pw && input('#su').value.trim().length > 0;
  $<HTMLButtonElement>('#setBtn').disabled = !ready || WIN_DONE;
}

(['#sp', '#sp2', '#su'] as const).forEach((s) => input(s).addEventListener('input', checkForm));

$('#backToCode').addEventListener('click', (e) => {
  e.preventDefault();
  hideAlert();
  input('#code').value = '';
  $<HTMLButtonElement>('#codeBtn').disabled = true;
  void show('code');
});

$('#setForm').addEventListener('submit', (e) => {
  e.preventDefault();
  void (async () => {
    hideAlert();
    const btn = $<HTMLButtonElement>('#setBtn');
    const txt = $('#setBtnTxt');
    const label = isReset() ? 'Save new password' : 'Create account';
    const username = input('#su').value.trim();
    const password = input('#sp').value;
    if (!username) return showAlert('Username required.');
    if (password.length < ARM.min) return showAlert('Password must be at least ' + ARM.min + ' characters.');
    if (password !== input('#sp2').value) return showAlert('Passwords do not match.');
    busy(btn, true, 'Saving...', txt);
    try {
      const r = await jsonPost(isReset() ? '/api/auth/reset' : '/api/auth/bootstrap', {
        code: ARM.code,
        username,
        password,
      });
      const d = (await r.json().catch(() => ({}))) as { redirect?: string };
      const lim = limitedOf(r.status, d, r.headers.get('retry-after'));
      if (lim) {
        busy(btn, false, label, txt);
        handleLimited(lim);
        return;
      }
      if (!r.ok) {
        busy(btn, false, label, txt);
        checkForm();
        const msg = errText(d, 'Failed (' + r.status + ').');
        if ((d as { burned?: boolean }).burned) {
          await afterBurn(msg);
        } else {
          showAlert(msg);
        }
        return;
      }
      stopWindow();
      if (!d.redirect && isReset()) {
        // A reset does not sign in: continue on the sign-in view.
        const st = await fetchState();
        enter('signin', st.ok ? st.s : {});
        input('#u').value = username;
        input('#p').value = '';
        showAlert('Password saved. Sign in with the new password.', 'ok');
        window.setTimeout(() => input('#p').focus(), 260);
        return;
      }
      showAlert(isReset() ? 'Password saved. Opening your vault...' : 'Account created. Opening your vault...', 'ok');
      go(d.redirect);
    } catch (err) {
      busy(btn, false, label, txt);
      showAlert('Could not reach the server: ' + (err as Error).message);
    }
  })();
});

/* ------------------------------------------------------------------ */
/* Copy buttons                                                        */
/* ------------------------------------------------------------------ */

document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) => {
  const label = btn.querySelector('span') as HTMLElement;
  btn.addEventListener('click', () => {
    void (async () => {
      const code = document.getElementById(btn.dataset.copy || '');
      const text = (code?.textContent || '').trim();
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        // Plain-HTTP origins have no clipboard API: select the text instead.
        if (code) {
          const range = document.createRange();
          range.selectNodeContents(code);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          try {
            ok = document.execCommand('copy');
          } catch {
            ok = false;
          }
        }
      }
      label.textContent = ok ? 'Copied' : 'Select';
      btn.classList.toggle('done', ok);
      window.setTimeout(() => {
        label.textContent = 'Copy';
        btn.classList.remove('done');
      }, 1500);
    })();
  });
});

/* ------------------------------------------------------------------ */
/* Boot: splash, checks, then exactly one view                         */
/* ------------------------------------------------------------------ */

const MIN_SPLASH = 500;

function check(id: string, st: '' | 'run' | 'ok' | 'bad', value = ''): void {
  const li = $(id);
  li.className = st;
  (li.querySelector('.cv') as HTMLElement).textContent = value;
  const icon = li.querySelector('.ci svg');
  if (icon) {
    icon.innerHTML = st === 'bad' ? '<path d="M18 6 6 18M6 6l12 12"/>' : '<path d="M20 6 9 17l-5-5"/>';
  }
}

async function until(t: number): Promise<void> {
  const wait = t - now();
  if (wait > 0) await sleep(wait);
}

async function fetchMe(): Promise<{ authenticated: boolean; redirect?: string }> {
  try {
    const r = await api('/api/auth/me');
    if (!r.ok) return { authenticated: false };
    const d = (await r.json().catch(() => ({}))) as { authenticated?: boolean; redirect?: string };
    return { authenticated: d.authenticated !== false, redirect: d.redirect };
  } catch {
    return { authenticated: false };
  }
}

function accountLabel(s: AuthState): string {
  if (s.armed) return isResetMode(s) ? 'reset window open' : 'setup window open';
  if (s.locked) return 'on hold';
  if (s.bootstrap) return 'not set up';
  return 'ready';
}
const isResetMode = (s: AuthState): boolean => s.mode === 'reset' || s.mode === 'reset-password';

async function boot(): Promise<void> {
  const t0 = now();
  $('#retryBtn').hidden = true;
  $('#splashTitle').textContent = 'Checking this instance\u2026';
  check('#ckServer', 'run');
  check('#ckReady', '');
  check('#ckAccount', '');
  const [me, st] = await Promise.all([fetchMe(), fetchState()]);
  if (me.authenticated) {
    check('#ckServer', 'ok');
    check('#ckReady', 'ok');
    check('#ckAccount', 'ok', 'signed in');
    go(me.redirect);
    return;
  }
  if (!st.ok) {
    if (st.limited) {
      const secs = st.limited.retry_after || 5;
      if (st.limited.cooldown) {
        check('#ckServer', 'ok');
        await until(t0 + MIN_SPLASH);
        enterCooldown(secs);
        return;
      }
      check('#ckServer', 'run', 'busy, retrying');
      await sleep(Math.min(secs, 10) * 1000);
      return boot();
    }
    await until(t0 + 250);
    check('#ckServer', 'bad', 'no answer');
    $('#splashTitle').textContent = 'Cannot reach the server';
    setOnline(false);
    $('#retryBtn').hidden = false;
    return;
  }
  const s = st.s;
  setOnline(true);
  // Tick the list in order, spread over the minimum splash time.
  await until(t0 + 150);
  check('#ckServer', 'ok');
  check('#ckReady', 'run');
  await until(t0 + 280);
  // Vault and state count as ready only once setup is done and a vault is chosen.
  const bad = [s.checks?.vault === false ? 'vault' : '', s.checks?.state === false ? 'state' : ''].filter(Boolean);
  const readyNote = bad.length
    ? bad.join(' + ') + ' not writable'
    : s.bootstrap
      ? 'not set up'
      : s.vault_configured === false
        ? 'vault not chosen'
        : '';
  check('#ckReady', readyNote ? 'bad' : 'ok', readyNote);
  check('#ckAccount', 'run');
  await until(t0 + 400);
  check('#ckAccount', s.bootstrap || s.locked ? 'bad' : 'ok', accountLabel(s));
  await until(t0 + MIN_SPLASH + 60);
  enter(decide(s), s);
}

$('#retryBtn').addEventListener('click', () => void boot());
if (OAUTH_Q !== null) {
  $('#vSignin .eyebrow').textContent = 'Connect an AI app';
  $('#vSignin .sub').textContent = 'Sign in to let an AI app connect to this vault. You approve it on the next step.';
}

void boot();
