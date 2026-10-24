// Sign-in page controller, compiled unbundled into login.html: it must stay self-contained.
// A splash checks /api/auth/me and /api/auth/state, then exactly one view is shown.

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

const DUR = 200;
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const canAnimate = (el: HTMLElement): boolean =>
  typeof el.animate === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;

const SHUT: Keyframe = {
  height: '0px',
  paddingTop: '0px',
  paddingBottom: '0px',
  marginTop: '0px',
  marginBottom: '0px',
  borderTopWidth: '0px',
  borderBottomWidth: '0px',
  opacity: 0,
};

function boxOf(el: HTMLElement): Keyframe {
  const cs = getComputedStyle(el);
  return {
    height: el.offsetHeight + 'px',
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    marginTop: cs.marginTop,
    marginBottom: cs.marginBottom,
    borderTopWidth: cs.borderTopWidth,
    borderBottomWidth: cs.borderBottomWidth,
    opacity: Number(cs.opacity),
  };
}

const SLIDING = new WeakMap<HTMLElement, { anim: Animation; end: () => void }>();

/** Jumps a running slide on `el` to its end state. */
function settle(el: HTMLElement): void {
  const s = SLIDING.get(el);
  if (!s) return;
  SLIDING.delete(el);
  s.anim.cancel();
  el.style.overflow = '';
  s.end();
}

/** Opens or closes `el` with a height + fade; on close `apply` runs once the box has folded away. */
function slide(el: HTMLElement, open: boolean, apply: () => void): void {
  const prev = SLIDING.get(el);
  const visible = el.getClientRects().length > 0;
  const here = visible ? boxOf(el) : SHUT;
  if (prev) {
    SLIDING.delete(el);
    prev.anim.cancel();
  }
  if (!canAnimate(el) || (!open && !visible)) return apply();
  if (open) {
    apply();
    if ((visible && !prev) || !el.getClientRects().length) return;
    play(el, [here, { ...boxOf(el), opacity: 1 }], () => {});
  } else {
    play(el, [here, SHUT], apply);
  }
}

function play(el: HTMLElement, frames: Keyframe[], end: () => void): void {
  el.style.overflow = 'hidden';
  const anim = el.animate(frames, { duration: DUR, easing: EASE, fill: 'forwards' });
  SLIDING.set(el, { anim, end });
  anim.onfinish = () => {
    if (SLIDING.get(el)?.anim === anim) settle(el);
  };
}

const alertBox = $('#alert');
const alertMsg = $('#alertMsg');
let alertOpen = false;

function showAlert(msg: string, kind: '' | 'ok' | 'warn' = ''): void {
  alertMsg.textContent = msg;
  const cls = 'alert show' + (kind ? ' ' + kind : '');
  if (alertOpen) {
    alertBox.className = cls;
    return;
  }
  alertOpen = true;
  slide(alertBox, true, () => (alertBox.className = cls));
}

function hideAlert(): void {
  if (!alertOpen) return;
  alertOpen = false;
  slide(alertBox, false, () => (alertBox.className = 'alert'));
}

/** Focus without scrolling the page (older browsers ignore the option). */
function focusEl(el: HTMLElement | null, select = false): void {
  if (!el) return;
  if (el.tagName === 'H1') el.tabIndex = -1;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
  if (select && el instanceof HTMLInputElement) el.select();
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

/** A same-origin app path for `n`, or null; a `//host` path would be read by `location` as another host. */
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

/** The OAuth authorize query this page was opened with (`?oauth=1&...`) minus the marker, or null. */
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
/** How this install runs the console, e.g. `docker exec -it memora memora-cli`. */
const cliName = (): string => {
  const m = /^(.*?\bmemora-cli(?:\.exe)?)(?=\s|$)/.exec(HINT.trim());
  return m ? m[1]! : HINT.trim().split(/\s+/)[0] || 'memora-cli';
};
/** The one command that opens the setup window and prints the code. */
const SETUP_ARGS = 'setup';

/** Shows a command that wraps only between words, never inside `reset-password`. */
function setCmd(sel: string, cmd: string): void {
  const el = $(sel);
  el.textContent = '';
  cmd.split(' ').forEach((w, i) => {
    if (i) el.append(' ');
    const s = document.createElement('span');
    s.className = 'w';
    s.textContent = w;
    el.append(s);
  });
}

let current: View = 'splash';
let switching = 0;
const card = $('#card');

let cardAnim: Animation | null = null;

/** Where focus goes on a view: its first empty or wrong field, its first field, else its heading. */
function focusView(v: View): void {
  if (v === 'splash') return;
  const fields: Partial<Record<View, string[]>> = { signin: ['#u', '#p'], code: ['#code'], form: ['#su', '#sp'] };
  const open = (fields[v] || []).map(input).filter((el) => !el.disabled);
  const pick = open.find((el) => !el.value || el.getAttribute('aria-invalid') === 'true') || open[0];
  focusEl(pick || $(VIEWS[v]).querySelector<HTMLElement>('h1'));
}

/** Crossfade to `v`, easing the card from the old height to the new one. */
async function show(v: View): Promise<void> {
  // Already showing (or switching to) it: a second call must not cancel the first.
  if (v === current) return;
  const token = ++switching;
  const from = current;
  current = v;
  const out = $(VIEWS[from]);
  if (out && !out.hidden && canAnimate(out)) {
    out.classList.add('leaving');
    await sleep(120);
    if (token !== switching) return;
  }
  cardAnim?.cancel();
  const h0 = card.offsetHeight;
  const w0 = card.offsetWidth;
  settle(alertBox);
  Object.entries(VIEWS).forEach(([k, sel]) => {
    const el = $(sel);
    el.classList.remove('leaving');
    if (k !== v) el.hidden = true;
  });
  card.classList.toggle('splashing', v === 'splash');
  // Only the welcome view uses the wide two-column card.
  card.classList.toggle('wide', v === 'setup');
  $(VIEWS[v]).hidden = false;
  const h1 = card.offsetHeight;
  // A width change (the wide welcome card) reflows everything: no height ease then.
  if (canAnimate(card) && card.offsetWidth === w0 && Math.abs(h1 - h0) > 2) {
    cardAnim = card.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: DUR, easing: EASE });
    cardAnim.onfinish = () => (cardAnim = null);
  }
  focusView(v);
  syncPolling();
}

let LAST: AuthState = {};

async function fetchState(): Promise<StateResult> {
  try {
    const r = await api('/api/auth/state');
    const d = (await r.json().catch(() => null)) as unknown;
    const lim = limitedOf(r.status, d, r.headers.get('retry-after'));
    if (lim) return { ok: false, limited: lim };
    if (!r.ok || !d || typeof d !== 'object') return { ok: false };
    const s = d as AuthState;
    if (s.setup_hint) HINT = s.setup_hint;
    LAST = s;
    return { ok: true, s };
  } catch {
    return { ok: false };
  }
}

function setOnline(on: boolean): void {
  $('#dot').className = 'dot ' + (on ? 'on' : 'off');
  $('#footState').textContent = on ? 'Connected' : 'Cannot reach the server';
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
      }
      break;
    case 'help':
      setCmd('#resetCmd', cli + ' reset-password');
      break;
    case 'setup':
      setCmd('#setupCmd', cli + ' ' + SETUP_ARGS);
      break;
    case 'code':
      prepareCode(s);
      $('#codeAgain').textContent = cli + (isResetMode(s) ? ' reset-password' : ' setup');
      break;
    case 'notready': {
      const row = (id: string, ok: boolean | undefined): void => {
        const li = $(id);
        li.className = ok === false ? 'bad' : 'ok';
        (li.querySelector('em') as HTMLElement).textContent = ok === false ? 'Not writable' : 'OK';
      };
      row('#nrVault', s.checks?.vault);
      row('#nrState', s.checks?.state);
      setCmd('#nrCmd', cli);
      break;
    }
    case 'locked':
      setCmd('#lockCmd', cli);
      $('#lockWhy').textContent = 'Sign-in was paused on the server. Your notes are safe.';
      break;
    case 'cooldown':
      startCooldown(s.cooldown ?? 60);
      break;
    default:
      break;
  }
  void show(v);
}

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
  setCmd('#cdCmd', cliName() + ' clear-cooldowns');
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

/** The Caps Lock hint under a password field, shown only while it is on. */
function wireCaps(inpSel: string, hintSel: string): void {
  const i = input(inpSel);
  const hint = $(hintSel);
  let on = false;
  const set = (v: boolean): void => {
    if (v === on) return;
    on = v;
    slide(hint, v, () => (hint.hidden = !v));
  };
  const read = (e: KeyboardEvent | MouseEvent): void => {
    if (typeof e.getModifierState === 'function') set(e.getModifierState('CapsLock'));
  };
  i.addEventListener('keydown', read);
  i.addEventListener('keyup', read);
  i.addEventListener('mousedown', read);
  i.addEventListener('blur', () => set(false));
}

wireCaps('#p', '#pCaps');
wireCaps('#sp', '#spCaps');
wireCaps('#sp2', '#sp2Caps');

/** Marks a field wrong for screen readers until it is edited. */
function markBad(el: HTMLInputElement): void {
  el.setAttribute('aria-invalid', 'true');
  el.addEventListener('input', () => el.removeAttribute('aria-invalid'), { once: true });
}

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
        if (r.status === 401) markBad(input('#p'));
        focusEl(input('#p'), true);
        return;
      }
      showAlert('Signed in. Opening your vault...', 'ok');
      go(d.redirect);
    } catch (err) {
      showAlert('Could not reach the server: ' + (err as Error).message);
      busy(btn, false, 'Sign in', txt);
      focusEl(btn);
    }
  })();
});

window.addEventListener('hashchange', () => {
  if (family(current) !== 'signin') return;
  enter(location.hash === '#help' ? 'help' : 'signin', LAST);
});
$('#backLink').addEventListener('click', (e) => {
  e.preventDefault();
  history.pushState(null, '', location.pathname + location.search);
  enter('signin', LAST);
});

let WIN: number | null = null;
let WIN_END = 0;
let WIN_TOTAL = 300;
let WIN_DONE = false;

/** Start or resync the window countdown; the numbers come from the server so a reload agrees. */
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

/** A wrong code voids the window on the server: move to whatever the instance shows now. */
async function afterBurn(msg: string): Promise<void> {
  stopWindow();
  input('#code').value = '';
  const st = await fetchState();
  const s = st.ok ? st.s : {};
  enter(st.ok ? decide(s) : 'setup', s);
  showAlert(msg, 'warn');
}

interface Arm {
  mode: string;
  min: number;
  user: string | null;
  code: string;
}
let ARM: Arm = { mode: 'bootstrap', min: 10, user: null, code: '' };

const isResetMode = (s: { mode?: string }): boolean => s.mode === 'reset' || s.mode === 'reset-password';
const isReset = (): boolean => isResetMode(ARM);
const rawCode = (v: string): string => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

function prepareCode(s: AuthState): void {
  ARM = { mode: s.mode || (s.bootstrap ? 'bootstrap' : 'reset'), min: s.min_password_len || 10, user: null, code: '' };
  const reset = isReset();
  $('#codeTitle').textContent = reset ? 'Enter the reset code' : 'Enter the setup code';
  $('#codeSub').textContent = 'Type the code printed on the server.';
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
          showAlert(
            r.status === 403
              ? 'That ' + (isReset() ? 'reset' : 'setup') + ' code is not right. Check the code shown on the server and type it again.'
              : msg,
          );
          shake($('#codeInp'));
          $('#codeInp').classList.add('bad');
          markBad(input('#code'));
          focusEl(input('#code'), true);
          // Re-check quietly: the view (and this message) only change if the window did.
          window.setTimeout(() => void poll(), 1500);
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
      focusEl(btn);
    }
  })();
});

function prepareForm(): void {
  const reset = isReset();
  $('#formTitle').textContent = reset ? 'Reset password' : 'Create the owner account';
  $('#formSub').textContent = reset
    ? 'Choose a new password. You can also change the username here.'
    : 'You will use these to sign in.';
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

/** Characters as the server counts them (code points, not UTF-16 units). */
const chars = (s: string): number => [...s].length;

function checkForm(): void {
  const min = ARM.min;
  const pw = input('#sp').value;
  const pw2 = input('#sp2').value;
  const n = chars(pw);
  // Length is what makes a password hard to guess; the meter only counts it.
  const strong = Math.max(min + 6, 16);
  const fill = $('#strength').querySelector('i') as HTMLElement;
  const rules = $('#rules');
  const inp3 = $('#inp3');
  if (!pw) {
    fill.style.width = '0';
    rules.textContent = 'At least ' + min + ' characters. A short phrase works well.';
    rules.className = 'rules';
    inp3.classList.remove('ok', 'bad');
  } else {
    const okLen = n >= min;
    fill.style.width = (okLen ? 55 + 45 * Math.min(1, (n - min) / (strong - min)) : 8 + 40 * (n / min)) + '%';
    fill.style.background = okLen ? 'var(--ok)' : 'var(--danger)';
    rules.textContent = !okLen
      ? 'At least ' + min + ' characters (' + n + ' so far)'
      : n >= strong
        ? 'Strong: ' + n + ' characters'
        : 'Long enough. A few more characters make it stronger.';
    rules.className = 'rules ' + (okLen ? 'ok' : 'bad');
    inp3.classList.toggle('ok', okLen);
    inp3.classList.toggle('bad', !okLen);
  }
  const m = $('#match');
  const inp2 = $('#inp2');
  if (!pw2) {
    if (m.textContent) slide(m, false, () => (m.textContent = ''));
    inp2.classList.remove('ok', 'bad');
  } else {
    const same = pw2 === pw;
    const txt = same ? 'Passwords match' : 'Passwords do not match';
    const paint = (): void => {
      m.textContent = txt;
      m.className = 'rules ' + (same ? 'ok' : 'bad');
    };
    if (m.textContent && !SLIDING.has(m)) paint();
    else slide(m, true, paint);
    inp2.classList.toggle('ok', same);
    inp2.classList.toggle('bad', !same);
  }
  const ready = n >= min && pw2 === pw && input('#su').value.trim().length > 0;
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
    const fail = (msg: string, sel: string): void => {
      showAlert(msg);
      markBad(input(sel));
      focusEl(input(sel), true);
    };
    if (!username) return fail('Username required.', '#su');
    if (chars(password) < ARM.min) return fail('Password must be at least ' + ARM.min + ' characters.', '#sp');
    if (password !== input('#sp2').value) return fail('Passwords do not match.', '#sp2');
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
          fail(msg, /user/i.test(msg) ? '#su' : '#sp');
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
        window.setTimeout(() => focusEl(input('#p')), 260);
        return;
      }
      showAlert(isReset() ? 'Password saved. Opening your vault...' : 'Account created. Opening your vault...', 'ok');
      go(d.redirect);
    } catch (err) {
      busy(btn, false, label, txt);
      showAlert('Could not reach the server: ' + (err as Error).message);
      focusEl(btn);
    }
  })();
});

$('#alertX').addEventListener('click', () => {
  hideAlert();
  focusView(current);
});

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
