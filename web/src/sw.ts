// Service worker, compiled by scripts/build-pages.mjs into crates/http/assets/sw.js. Vault data is never cached.

// pwa.ts reads the build back from this file's text by the memora-build: tag.
const BUILD = 'memora-build:__MEMORA_BUILD__'.slice('memora-build:'.length);
const APP_JS = '__MEMORA_APP_JS__';
const VERSION = BUILD;
const SHELL = 'memora-' + BUILD;

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

// index.html always comes from the network: it carries the sign-in check and a per-response script nonce.
const BUILD_FILES = [
  APP_JS,
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
];
const CACHED = new Set(BUILD_FILES);

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
        BUILD_FILES.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => null)),
      );
      await sw.skipWaiting();
    })(),
  );
}) as never);

sw.addEventListener('activate', ((event: SWEvent) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const older = names.filter((n) => n !== SHELL && (n.startsWith('memora-') || n.startsWith('shell-')));
      await Promise.all(older.map((n) => caches.delete(n)));
      if (sw.registration.navigationPreload) {
        await sw.registration.navigationPreload.disable().catch(() => null);
      }
      await sw.clients.claim();
      // Pages that know NEW_VERSION answer and reload when safe; older pages are reloaded.
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

async function fromBuild(req: Request): Promise<Response> {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone()).catch(() => null);
  return res;
}

// Navigations show the offline page only after the network fails twice.
sw.addEventListener('fetch', ((event: SWEvent) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  if (req.mode !== 'navigate') {
    if (CACHED.has(url.pathname + url.search)) event.respondWith(fromBuild(req));
    return;
  }
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
