// Service worker. Compiled by scripts/build-pages.mjs into
// crates/http/assets/sw.js and registered from src/pwa.ts.
//
// It runs outside the page, so the DOM types do not describe it. Vault data
// always comes from the network and is never cached.

const VERSION = 'memora-v1.1.0';
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

// Enough of the shell to open the UI while offline.
const APP_SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/offline.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

// Paths that must never be cached: memory data, auth, OAuth, MCP and realtime.
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
        APP_SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => null)),
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

sw.addEventListener('fetch', ((event: SWEvent) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  if (isNever(url.pathname)) return; // straight to the network

  // Navigation: network first, cached shell as fallback, then the offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // Only a real app page may become the offline shell: never an error
          // or a redirect (for example to /login when the session expired).
          if (res.ok && res.type === 'basic' && !res.redirected) {
            const cache = await caches.open(SHELL);
            cache.put('/index.html', res.clone()).catch(() => null);
          }
          return res;
        } catch {
          const cache = await caches.open(SHELL);
          return (
            (await cache.match(req)) ||
            (await cache.match('/index.html')) ||
            (await cache.match('/offline.html')) ||
            new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
          );
        }
      })(),
    );
    return;
  }

  // Static assets: network first so a deploy shows at once (an unchanged
  // file is a cheap 304); the cache only when offline.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => null);
        return res;
      } catch {
        return (await cache.match(req)) || new Response('', { status: 504 });
      }
    })(),
  );
}) as never);
