// Service worker. Compiled by scripts/build-pages.mjs into
// crates/http/assets/sw.js and registered from src/pwa.ts.
//
// It runs outside the page, so the DOM types do not describe it. Vault data
// always comes from the network and is never cached.

const VERSION = 'memora-v1.1.4';
const SHELL = 'shell-' + VERSION;

interface SWEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
  request: Request;
  respondWith(r: Response | Promise<Response>): void;
}

interface SWGlobal {
  addEventListener(type: string, fn: (e: never) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; matchAll(o: { type: string }): Promise<unknown[]> };
  registration: { navigationPreload?: { disable(): Promise<void> } };
  location: Location;
}

const sw = self as unknown as SWGlobal;

// Only the offline page and its icons are kept. Pages, scripts and styles
// always come from the network, so an update shows on the next load.
const OFFLINE_FILES = ['/offline.html', '/icon-192.png', '/icon-512.png'];

// Paths the worker never touches: memory data, auth, OAuth, MCP and realtime.
const NEVER_CACHE = [
  '/api/',
  '/mcp',
  '/_bus',
  '/ws',
  '/login',
  '/logout',
  '/oauth/',
  '/.well-known/',
  '/healthz',
];

sw.addEventListener('install', ((event: SWEvent) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // Individually, so one failed file cannot abort the whole install.
      await Promise.all(
        OFFLINE_FILES.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => null)),
      );
      await sw.skipWaiting();
    })(),
  );
}) as never);

sw.addEventListener('activate', ((event: SWEvent) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const older = names.filter((n) => n !== SHELL);
      await Promise.all(older.map((n) => caches.delete(n)));
      if (sw.registration.navigationPreload) {
        await sw.registration.navigationPreload.disable().catch(() => null);
      }
      await sw.clients.claim();
      // An update (an older cache existed): bring every open window onto the
      // new version. Pages that know this message answer and reload when it
      // is safe (not mid-edit); older pages do not answer and are reloaded.
      if (older.length) {
        const wins = (await sw.clients.matchAll({ type: 'window' })) as unknown as WinClient[];
        await Promise.all(wins.map(nudge));
      }
    })(),
  );
}) as never);

sw.addEventListener('message', ((event: MessageEvent) => {
  const d = (event.data ?? {}) as { type?: string };
  if (d.type === 'SKIP_WAITING') void sw.skipWaiting();
  if (d.type === 'VERSION' && event.source) {
    (event.source as unknown as { postMessage(m: unknown): void }).postMessage({
      type: 'VERSION',
      version: VERSION,
    });
  }
}) as never);

interface WinClient {
  url: string;
  postMessage(m: unknown, transfer: MessagePort[]): void;
  navigate(url: string): Promise<unknown>;
}

async function nudge(c: WinClient): Promise<void> {
  const ch = new MessageChannel();
  const answered = new Promise<boolean>((res) => {
    ch.port1.onmessage = () => res(true);
    setTimeout(() => res(false), 1500);
  });
  try {
    c.postMessage({ type: 'NEW_VERSION', version: VERSION }, [ch.port2]);
  } catch {
    /* gone */
  }
  if (!(await answered)) await c.navigate(c.url).catch(() => null);
}

function isNever(pathname: string): boolean {
  return NEVER_CACHE.some((p) => pathname === p || pathname.startsWith(p));
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Navigations go to the network. Only when it fails twice in a row (the
// server or the connection is down) does the offline page appear; it retries
// on its own. Everything else is left to the browser.
sw.addEventListener('fetch', ((event: SWEvent) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  if (isNever(url.pathname)) return;

  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch {
        await wait(1200);
        try {
          return await fetch(req);
        } catch {
          const cache = await caches.open(SHELL);
          return (
            (await cache.match('/offline.html')) ||
            new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
          );
        }
      }
    })(),
  );
}) as never);
