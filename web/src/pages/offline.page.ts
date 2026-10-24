// The service worker's offline page, rendered by scripts/build-pages.mjs into crates/http/assets/offline.html.

import type * as BrandModule from '../brand';
import type * as ThemeModule from '../login-theme';

declare const process: {
  argv: string[];
  getBuiltinModule(id: 'node:module'): { createRequire(path: string): (id: string) => unknown };
};

// Imported from a data: URL by build-pages.mjs, so siblings load relative to the build script.
const load = process.getBuiltinModule('node:module').createRequire(process.argv[1] ?? '');
const { markSvg, BRAND_TAG } = load('../src/brand.ts') as typeof BrandModule;
const { THEME_BOOT } = load('../src/login-theme.ts') as typeof ThemeModule;

/** Countdown (5, 10, 20, 30 s) and retry. Plain ES2017: it is inlined as is, not compiled. */
const RETRY = `(function(){
var steps=[5,10,20,30],n=0,left=0,timer=null,busy=false;
var msg=document.getElementById('msg'),sr=document.getElementById('sr'),btn=document.getElementById('retry');
function show(t,a){msg.textContent=t;if(a)sr.textContent=a===true?t:a}
function wait(){
  left=steps[Math.min(n,steps.length-1)];n++;
  show('Trying again in '+left+' seconds','Still offline. Trying again in '+left+' seconds.');
  clearInterval(timer);timer=setInterval(tick,1000);
}
function tick(){
  left--;
  if(left<=0)return check();
  show('Trying again in '+left+(left===1?' second':' seconds'));
}
function check(){
  if(busy)return;busy=true;clearInterval(timer);btn.disabled=true;
  show('Checking the connection…',false);
  fetch('/healthz',{cache:'no-store'}).then(function(r){
    if(r.status>=500)throw 0;
    show('Back online. Opening…',true);location.reload();
  }).catch(function(){busy=false;btn.disabled=false;wait()});
}
btn.addEventListener('click',function(){n=0;check()});
window.addEventListener('online',function(){n=0;check()});
wait();
})();`;

export function offlinePage(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<script>${THEME_BOOT}</script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0b0e14">
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex">
<noscript><meta http-equiv="refresh" content="15"></noscript>
<title>Offline · Memora</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
  :root{ --bg:#07090e; --panel:#0d1118; --line:#1f2633; --fg:#e6e9ef; --muted:#8b98ad; --primary:#22d3ee; --on-primary:#04221e; --dotc:rgba(148,163,184,.10) }
  :root[data-theme="light"]{ --bg:#f4f6fa; --panel:#ffffff; --line:#e1e6ee; --fg:#111827; --muted:#5b6678; --primary:#0e7490; --on-primary:#ffffff; --dotc:rgba(15,23,42,.07) }
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;color:var(--fg);padding:24px 16px;
       font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       background:radial-gradient(var(--dotc) 1px,transparent 1.2px) 0 0/22px 22px,var(--bg)}
  .card{max-width:440px;width:100%;text-align:center}
  .beacon{position:relative;width:88px;height:88px;margin:0 auto 26px;display:grid;place-items:center}
  .beacon::before,.beacon::after{content:"";position:absolute;inset:0;border-radius:26px;border:1px solid rgba(94,234,212,.45);animation:ripple 2.4s ease-out infinite}
  .beacon::after{animation-delay:1.2s}
  .mark{position:relative;width:64px;height:64px;display:block}
  @keyframes ripple{from{transform:scale(1);opacity:.8}to{transform:scale(1.7);opacity:0}}
  h1{font-size:26px;font-weight:650;letter-spacing:-.02em;margin:0 0 10px}
  p{margin:0 auto 22px;max-width:380px;color:var(--muted);font-size:15px}
  .status{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 14px;margin:0 0 22px;border-radius:99px;font-size:13px;
          background:var(--panel);border:1px solid var(--line);color:var(--fg);font-variant-numeric:tabular-nums}
  .status i{width:7px;height:7px;border-radius:50%;background:#f59e0b;animation:pulse 1.6s ease-in-out infinite}
  @keyframes pulse{50%{opacity:.35}}
  .acts{display:flex;justify-content:center}
  button{appearance:none;border:0;background:var(--primary);color:var(--on-primary);font:inherit;font-weight:600;min-height:46px;min-width:180px;
         padding:10px 22px;border-radius:12px;cursor:pointer;transition:filter .15s,transform .1s}
  button:hover:not(:disabled){filter:brightness(1.07)}
  button:active:not(:disabled){transform:scale(.98)}
  button:disabled{opacity:.6;cursor:default}
  button:focus-visible{outline:2px solid var(--primary);outline-offset:3px}
  .hint{margin-top:28px;font-size:12px;color:var(--muted)}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  @media (prefers-reduced-motion:reduce){.status i,.beacon::before,.beacon::after{animation:none}}
</style>
</head>
<body>
  <main class="card">
    <div class="beacon">${markSvg('mark')}</div>
    <h1>Can't reach Memora</h1>
    <p>Your internet connection or the Memora server is down. Your notes are safe on the server; this page opens again by itself once it can reach it.</p>
    <div class="status" aria-hidden="true"><i></i><span id="msg">Trying again shortly&hellip;</span></div>
    <div class="sr" id="sr" role="status"></div>
    <div class="acts"><button type="button" id="retry">Try now</button></div>
    <div class="hint">${BRAND_TAG}</div>
  </main>
<script>${RETRY}</script>
</body>
</html>
`;
}
