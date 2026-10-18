// The page shown by the service worker when the network is unavailable.
// Rendered by scripts/build-pages.mjs into crates/http/assets/offline.html.

import type * as BrandModule from '../brand';

declare const process: {
  argv: string[];
  getBuiltinModule(id: 'node:module'): { createRequire(path: string): (id: string) => unknown };
};

// Loaded relative to scripts/build-pages.mjs: this module is imported from a
// data: URL, where relative imports cannot resolve (see login.page.ts).
const { markSvg, BRAND_TAG } = process.getBuiltinModule('node:module').createRequire(process.argv[1] ?? '')(
  '../src/brand.ts',
) as typeof BrandModule;

export function offlinePage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0b0e14">
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex">
<meta http-equiv="refresh" content="8">
<title>Offline · Memora</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
  :root{ --bg:#0b0e14; --panel:#12161f; --line:#232a38; --fg:#e6e9ef; --muted:#8b98ad; --accent:#5eead4; }
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);
       font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px}
  .card{max-width:420px;width:100%;background:var(--panel);border:1px solid var(--line);border-radius:16px;
        padding:28px 24px;text-align:center;box-shadow:0 18px 44px rgba(0,0,0,.5)}
  .mark{width:44px;height:44px;margin:0 auto 14px;display:block}
  h1{font-size:18px;margin:0 0 6px}
  p{margin:0 0 18px;color:var(--muted);font-size:14px}
  button{appearance:none;border:1px solid rgba(94,234,212,.45);background:rgba(94,234,212,.1);color:var(--accent);
         font:inherit;font-weight:600;padding:10px 16px;border-radius:10px;cursor:pointer}
  button:hover{background:rgba(94,234,212,.16)}
  .hint{margin-top:14px;font-size:12px;color:var(--muted)}
</style>
</head>
<body>
  <div class="card">
    ${markSvg('mark')}
    <h1>Connection lost</h1>
    <p>This page was served from cache. Memory vault content is always fetched directly from the server, so a network connection is required to display notes.</p>
    <button type="button" onclick="location.reload()">Try again</button>
    <div class="hint">${BRAND_TAG}</div>
  </div>
</body>
</html>
`;
}
