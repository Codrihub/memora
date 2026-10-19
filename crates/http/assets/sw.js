(() => {
  const VERSION = "memora-v1.3.2";
  const SHELL = "shell-" + VERSION;
  const sw = self;
  const OFFLINE_FILES = ["/offline.html", "/icon-192.png", "/icon-512.png"];
  const NEVER_CACHE = [
    "/api/",
    "/mcp",
    "/_bus",
    "/ws",
    "/login",
    "/logout",
    "/oauth/",
    "/.well-known/",
    "/healthz"
  ];
  sw.addEventListener("install", ((event) => {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(SHELL);
        await Promise.all(
          OFFLINE_FILES.map((u) => cache.add(new Request(u, { cache: "reload" })).catch(() => null))
        );
        await sw.skipWaiting();
      })()
    );
  }));
  sw.addEventListener("activate", ((event) => {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        const older = names.filter((n) => n !== SHELL);
        await Promise.all(older.map((n) => caches.delete(n)));
        if (sw.registration.navigationPreload) {
          await sw.registration.navigationPreload.disable().catch(() => null);
        }
        await sw.clients.claim();
        if (older.length) {
          const wins = await sw.clients.matchAll({ type: "window" });
          await Promise.all(wins.map(nudge));
        }
      })()
    );
  }));
  sw.addEventListener("message", ((event) => {
    const d = event.data ?? {};
    if (d.type === "SKIP_WAITING") void sw.skipWaiting();
    if (d.type === "VERSION" && event.source) {
      event.source.postMessage({
        type: "VERSION",
        version: VERSION
      });
    }
  }));
  async function nudge(c) {
    const ch = new MessageChannel();
    const answered = new Promise((res) => {
      ch.port1.onmessage = () => res(true);
      setTimeout(() => res(false), 1500);
    });
    try {
      c.postMessage({ type: "NEW_VERSION", version: VERSION }, [ch.port2]);
    } catch {
    }
    if (!await answered) await c.navigate(c.url).catch(() => null);
  }
  function isNever(pathname) {
    return NEVER_CACHE.some((p) => pathname === p || pathname.startsWith(p));
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  sw.addEventListener("fetch", ((event) => {
    const req = event.request;
    if (req.method !== "GET" || req.mode !== "navigate") return;
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
            return await cache.match("/offline.html") || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
          }
        }
      })()
    );
  }));
})();