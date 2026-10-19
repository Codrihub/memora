// Login page theme: the pre-paint theme script and the page stylesheet.
//
// The theme is a per-device preference chosen in the app (Settings) and kept
// in localStorage under `memora.theme`: "dark" | "light" | "system".
// Missing or invalid means "dark". The login page only applies it; it has no
// switch of its own. `?theme=light|dark` overrides it for one load (testing).

import { PRIMARY_DARK, PRIMARY_LIGHT } from './ui/primary.ts';

const THEME_KEY = 'memora.theme';

/**
 * Inline script for the top of <head>: sets <html data-theme> before the first
 * paint so the page never flashes the wrong palette. Kept tiny and ES5-safe.
 */
export const THEME_BOOT = `(function(){var d=document.documentElement,p='dark',q=null;
try{q=new URLSearchParams(location.search).get('theme')}catch(e){}
try{var v=localStorage.getItem('${THEME_KEY}');if(v==='dark'||v==='light'||v==='system')p=v}catch(e){}
if(q==='dark'||q==='light'||q==='system')p=q;
var m=window.matchMedia?matchMedia('(prefers-color-scheme: light)'):null;
function a(){var t=p==='system'?(m&&m.matches?'light':'dark'):p;d.setAttribute('data-theme',t);d.style.colorScheme=t;
var c=document.querySelector('meta[name=theme-color]');if(c)c.setAttribute('content',t==='light'?'#f3f5f9':'#0b0e14')}
a();document.addEventListener('DOMContentLoaded',a);if(p==='system'&&m){try{m.addEventListener('change',a)}catch(e){m.addListener&&m.addListener(a)}}})();`;

const DARK = `
  --bg:#0b0e14; --bg-glow:rgba(94,234,212,.08);
  --panel:#12161f; --panel-2:#171c27; --line:#232a38; --line-2:#2c3546;
  --fg:#e6e9ef; --muted:#8b98ad; --faint:#5d6a80;
  --accent:#5eead4; --accent-2:#7dd3fc; --accent-hover:#7dd3fc; --on-accent:#0b0e14;
  --accent-soft:rgba(94,234,212,.10); --accent-line:rgba(94,234,212,.32);
  ${PRIMARY_DARK}
  --warn:#fbbf24; --warn-soft:rgba(251,191,36,.10); --warn-line:rgba(251,191,36,.32); --warn-fg:#fcd34d;
  --danger:#f87171; --danger-soft:rgba(248,113,113,.12); --danger-line:rgba(248,113,113,.32); --danger-fg:#fca5a5;
  --ok:#4ade80; --ok-soft:rgba(74,222,128,.10); --ok-line:rgba(74,222,128,.30); --ok-fg:#86efac;
  --code-bg:#0d1118; --code-fg:#e6e9ef; --chip:rgba(255,255,255,.05); --chip-hover:rgba(255,255,255,.10);
  --input-bg:#171c27; --input-focus:#12161f;
  --shadow:0 24px 60px rgba(0,0,0,.55), 0 1px 0 rgba(255,255,255,.03) inset;
  --sweep:rgba(94,234,212,.95); --sweep-2:rgba(125,211,252,.9); --track:rgba(94,234,212,.16);
`;

const LIGHT = `
  --bg:#f3f5f9; --bg-glow:rgba(13,148,136,.07);
  --panel:#ffffff; --panel-2:#f6f8fb; --line:#e1e6ee; --line-2:#cfd6e2;
  --fg:#111827; --muted:#5b6678; --faint:#8a94a6;
  --accent:#0d9488; --accent-2:#0369a1; --accent-hover:#0f766e; --on-accent:#ffffff;
  --accent-soft:rgba(13,148,136,.08); --accent-line:rgba(13,148,136,.30);
  ${PRIMARY_LIGHT}
  --warn:#b45309; --warn-soft:#fffbeb; --warn-line:#fcd9a0; --warn-fg:#92400e;
  --danger:#dc2626; --danger-soft:#fef2f2; --danger-line:#fecaca; --danger-fg:#b91c1c;
  --ok:#16a34a; --ok-soft:#f0fdf4; --ok-line:#bbf7d0; --ok-fg:#166534;
  --code-bg:#f1f4f8; --code-fg:#0f172a; --chip:#ffffff; --chip-hover:#eef2f7;
  --input-bg:#f8fafc; --input-focus:#ffffff;
  --shadow:0 1px 2px rgba(16,24,40,.05), 0 18px 48px rgba(16,24,40,.10);
  --sweep:rgba(13,148,136,.85); --sweep-2:rgba(3,105,161,.75); --track:rgba(13,148,136,.14);
`;

const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace";

export const LOGIN_CSS = `
:root{${DARK}}
:root[data-theme="light"]{${LIGHT}}
*{margin:0;padding:0;box-sizing:border-box}
html,body{min-height:100%}
body{
  font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background-color:var(--bg); color:var(--fg);
  background-image:
    radial-gradient(circle at 12% 14%, var(--bg-glow) 0%, transparent 42%),
    radial-gradient(circle at 88% 86%, var(--bg-glow) 0%, transparent 40%);
  background-attachment:fixed;
  display:grid; place-items:center; min-height:100vh; min-height:100dvh; padding:24px 16px;
  -webkit-font-smoothing:antialiased;
}
svg{fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
a{color:var(--accent-2);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:${MONO}}
[hidden]{display:none!important}

/* ---------- card ---------- */
.card{
  width:100%; max-width:408px; position:relative; overflow:hidden;
  background:var(--panel); border:1px solid var(--line); border-radius:16px;
  box-shadow:var(--shadow); padding:30px 30px 22px;
}
.card::before,.card::after{content:'';position:absolute;top:0;height:2px;pointer-events:none}
.card::before{left:0;right:0;background:linear-gradient(90deg,transparent,var(--track) 20%,var(--track) 80%,transparent)}
.card::after{
  left:0; width:45%;
  background:linear-gradient(90deg,transparent,var(--sweep) 45%,var(--sweep-2) 60%,transparent);
  transform:translateX(-110%); opacity:.85;
  animation:sweep 3.6s cubic-bezier(.65,0,.35,1) infinite;
}
@keyframes sweep{0%{transform:translateX(-110%)}62%{transform:translateX(245%)}100%{transform:translateX(245%)}}

/* ---------- brand ---------- */
.brand{display:flex;align-items:center;gap:11px;margin-bottom:22px;animation:vin .22s ease-out both}
.card.splashing .brand{display:none}
.brand-mark{width:32px;height:32px;flex:none}
.brand-txt{display:flex;flex-direction:column;line-height:1.12;min-width:0}
.brand-txt b{font-size:16.5px;font-weight:800;letter-spacing:-.2px}
.brand-txt small{font-size:9.5px;font-weight:700;letter-spacing:.17em;text-transform:uppercase;color:var(--muted);margin-top:3px}

/* ---------- views ---------- */
.view{animation:vin .22s ease-out both}
.view.leaving{animation:vout .15s ease-in both}
@keyframes vin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes vout{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-4px)}}
h1{font-size:19px;font-weight:700;letter-spacing:-.3px;margin-bottom:6px;line-height:1.25}
.eyebrow{font-size:12px;font-weight:600;color:var(--accent);margin-bottom:6px;letter-spacing:.01em}
.sub{font-size:13px;color:var(--muted);line-height:1.55;margin-bottom:20px}
.sub b{color:var(--fg);font-weight:600}
.note{font-size:12px;color:var(--muted);line-height:1.6;margin-top:12px}
.note code,.sub code{font-size:11.5px;color:var(--accent-2);background:var(--code-bg);border:1px solid var(--line);border-radius:5px;padding:1px 5px;white-space:nowrap}
.center{text-align:center}
.links{margin-top:16px;text-align:center;font-size:12.5px}
.links a{color:var(--muted)}
.links a:hover{color:var(--fg)}

/* ---------- splash ---------- */
.splash{display:flex;flex-direction:column;align-items:center;text-align:center;padding:6px 0 4px}
.splash .brand-mark{width:52px;height:52px;margin-bottom:14px;animation:breathe 2.4s ease-in-out infinite}
@keyframes breathe{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.04);opacity:.86}}
.splash h1{font-size:17px;margin-bottom:16px}
.checks{list-style:none;width:100%;max-width:260px;display:flex;flex-direction:column;gap:9px;text-align:left}
.checks li{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--muted);opacity:.55;transition:opacity .2s,color .2s}
.checks li.run,.checks li.ok,.checks li.bad{opacity:1}
.checks li.ok{color:var(--fg)}
.checks li.bad{color:var(--danger-fg)}
.checks .ci{width:16px;height:16px;flex:none;display:grid;place-items:center;border-radius:50%;border:1.6px solid var(--line-2)}
.checks .ci svg{width:10px;height:10px;stroke-width:3;opacity:0;transform:scale(.6);transition:opacity .18s,transform .18s}
.checks li.run .ci{border-color:var(--line);border-top-color:var(--accent);animation:sp .8s linear infinite}
.checks li.ok .ci{border-color:var(--ok);background:var(--ok);color:var(--panel)}
.checks li.bad .ci{border-color:var(--danger);background:var(--danger);color:var(--panel)}
.checks li.ok .ci svg,.checks li.bad .ci svg{opacity:1;transform:none}
.checks .cv{margin-left:auto;font-size:11.5px;color:var(--muted)}
.splash .btn{max-width:260px;margin-top:18px}

/* ---------- fields ---------- */
.field{margin-bottom:16px}
.field label{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:7px}
.inp{position:relative;display:flex;align-items:center}
.inp>svg{position:absolute;left:13px;width:15px;height:15px;color:var(--muted);pointer-events:none}
.inp input{
  width:100%; height:46px; padding:0 44px 0 39px;
  background:var(--input-bg); border:1px solid var(--line); border-radius:10px;
  color:var(--fg); font-size:14px; font-family:inherit; outline:none;
  transition:border-color .15s, background-color .15s, box-shadow .15s;
}
.inp input:focus{border-color:var(--accent);background:var(--input-focus);box-shadow:0 0 0 3px var(--accent-soft)}
.inp.ok input,.inp.ok input:focus{border-color:var(--ok)}
.inp.bad input,.inp.bad input:focus{border-color:var(--danger)}
.inp input::placeholder{color:var(--faint)}
.inp input:disabled{opacity:.5;cursor:not-allowed}
.inp .eye{position:absolute;right:8px;width:30px;height:30px;display:grid;place-items:center;border:none;background:none;color:var(--muted);border-radius:7px;cursor:pointer}
.inp .eye:hover{color:var(--fg);background:var(--chip-hover)}
.inp .eye svg{position:static;width:16px;height:16px}
.inp.code input{
  padding:0 14px; height:54px; text-align:center; font-family:${MONO};
  font-size:22px; font-weight:600; letter-spacing:.22em; text-transform:uppercase;
}
.inp.code input::placeholder{letter-spacing:.22em;font-weight:500}
.shake{animation:shake .32s ease}
@keyframes shake{20%,60%{transform:translateX(-5px)}40%,80%{transform:translateX(5px)}}

/* ---------- button ---------- */
.btn{
  width:100%; height:44px; margin-top:6px; border:none; border-radius:10px;
  background:var(--primary); color:var(--on-primary); font-size:14px; font-weight:700; font-family:inherit;
  display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer;
  transition:background-color .15s, transform .06s, opacity .15s;
}
.btn:hover:not(:disabled){background:var(--primary-hover)}
.btn:active:not(:disabled){transform:translateY(1px)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn:focus-visible,.clibtn:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.btn svg{width:16px;height:16px;stroke-width:2.2}
.btn.ghost{background:var(--chip);color:var(--fg);border:1px solid var(--line);font-weight:600}
.btn.ghost:hover:not(:disabled){background:var(--chip-hover)}
.spinner{width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:sp .7s linear infinite;display:none;opacity:.7}
@keyframes sp{to{transform:rotate(360deg)}}
.loading .spinner{display:block}
.loading .btn-ico{display:none}

/* ---------- alert ---------- */
.alert{
  display:none; align-items:flex-start; gap:9px; margin-bottom:16px;
  padding:10px 12px; border-radius:9px; font-size:12.5px; line-height:1.5;
  background:var(--danger-soft); border:1px solid var(--danger-line); color:var(--danger-fg);
}
.alert.show{display:flex;animation:vin .18s ease-out both}
.alert.ok{background:var(--ok-soft);border-color:var(--ok-line);color:var(--ok-fg)}
.alert.warn{background:var(--warn-soft);border-color:var(--warn-line);color:var(--warn-fg)}
.alert svg{width:15px;height:15px;flex:none;margin-top:1px}

/* ---------- strength + rules ---------- */
.strength{height:3px;border-radius:3px;background:var(--line);margin-top:8px;overflow:hidden;display:none}
.strength.show{display:block}
.strength i{display:block;height:100%;width:0;background:var(--danger);transition:width .2s,background-color .2s}
.rules{font-size:11.5px;color:var(--muted);margin-top:7px;line-height:1.55}
.rules:empty{display:none}
.rules.ok{color:var(--ok)}
.rules.bad{color:var(--danger)}

/* ---------- window countdown banner ---------- */
.win{
  display:flex; align-items:center; gap:10px; margin-bottom:18px; padding:10px 12px;
  border-radius:10px; background:var(--ok-soft); border:1px solid var(--ok-line);
  font-size:12px; color:var(--ok-fg); position:relative; overflow:hidden;
}
.win svg{width:15px;height:15px;flex:none}
.win .wtxt{flex:1;min-width:0}
.win b{font-variant-numeric:tabular-nums;font-weight:700}
.win .wbar{position:absolute;left:0;bottom:0;height:2px;width:100%;background:currentColor;opacity:.6;transition:width 1s linear}
.win.warn{background:var(--warn-soft);border-color:var(--warn-line);color:var(--warn-fg)}
.win.expired{background:var(--panel-2);border-color:var(--line);color:var(--muted)}

/* ---------- CLI command block ---------- */
.clicmd{margin:2px 0 4px;padding:12px;border-radius:12px;background:var(--panel-2);border:1px solid var(--line)}
.clilabel{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.clirow{display:flex;align-items:stretch;gap:8px;min-width:0}
.clirow code{
  flex:1; min-width:0; display:block; font-size:13px; color:var(--code-fg); background:var(--code-bg);
  border:1px solid var(--line); border-radius:8px; padding:9px 11px; line-height:1.4;
  overflow-x:auto; white-space:nowrap; user-select:all; scrollbar-width:thin;
}
.clirow code::before{content:'$ ';color:var(--faint);user-select:none}
.clibtn{
  flex:none; font-size:12px; font-weight:600; padding:0 12px; font-family:inherit; border-radius:8px;
  border:1px solid var(--line); background:var(--chip); color:var(--fg); cursor:pointer;
  display:flex; align-items:center; gap:6px; transition:background-color .15s, color .15s;
}
.clibtn svg{width:13px;height:13px}
.clibtn:hover{background:var(--chip-hover)}
.clibtn.done{color:var(--ok)}

/* ---------- status icon panels ---------- */
.ico{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;margin-bottom:14px;
  background:var(--danger-soft);border:1px solid var(--danger-line);color:var(--danger-fg)}
.ico svg{width:22px;height:22px}
.ico.warn{background:var(--warn-soft);border-color:var(--warn-line);color:var(--warn-fg)}
.ico.calm{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
.waiting{display:flex;align-items:center;gap:9px;margin-top:14px;padding:10px 12px;border-radius:10px;
  background:var(--panel-2);border:1px solid var(--line);font-size:12px;color:var(--muted);line-height:1.45}
.waiting .spin{width:13px;height:13px;border:2px solid var(--line-2);border-top-color:var(--accent);border-radius:50%;animation:sp .8s linear infinite;flex:none}
.checklist{list-style:none;margin:0 0 16px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.checklist li{display:flex;align-items:center;gap:10px;padding:10px 12px;font-size:12.5px;background:var(--panel-2)}
.checklist li+li{border-top:1px solid var(--line)}
.checklist li svg{width:15px;height:15px;flex:none;color:var(--muted)}
.checklist li span{flex:1}
.checklist li em{font-style:normal;font-size:11.5px;font-weight:600}
.checklist li.ok em{color:var(--ok)}
.checklist li.bad em{color:var(--danger)}
.checklist.about li{align-items:flex-start;line-height:1.45;color:var(--muted)}
.checklist.about li svg{margin-top:2px;color:var(--accent)}
.checklist.about li b{display:block;color:var(--fg);font-weight:650}
.steps-h{font-size:12px;font-weight:650;color:var(--fg);margin:0 0 8px}
.about-name{font-size:11.5px;color:var(--muted);line-height:1.5;margin:16px 0 0;padding-top:12px;border-top:1px solid var(--line);font-style:italic}

/* ---------- welcome (no owner yet): two columns on wide screens ---------- */
.su-list{list-style:none;display:flex;flex-direction:column;gap:14px;margin:0}
.su-list>li{display:flex;gap:11px;align-items:flex-start;min-width:0}
.su-n{flex:none;display:grid;place-items:center;width:22px;height:22px;margin-top:1px;border-radius:50%;font-size:11.5px;font-weight:700;
  background:var(--accent-soft);border:1px solid var(--accent-line);color:var(--accent)}
.su-b{flex:1;min-width:0}
.su-b>b{display:block;font-size:13px;font-weight:650;color:var(--fg);margin-bottom:8px;line-height:1.45}
.su-b .note{margin-top:8px}
.su-b>b+.note{margin-top:-4px}
.su-steps .steps-h{margin-bottom:12px}
.su-intro .checklist{margin-bottom:0}
.su-steps{margin-top:18px}
.su-b .clirow code{white-space:normal;overflow-wrap:anywhere;overflow-x:visible}
@media (min-width:640px) and (max-width:879px){.card.wide{max-width:600px}}
@media (min-width:880px){
  .card.wide{max-width:880px;padding:34px 36px 24px}
  .card.wide .su-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:36px;align-items:start}
  .card.wide .su-steps{margin-top:0;padding-left:36px;border-left:1px solid var(--line);align-self:stretch}
  .card.wide .su-intro .sub{margin-bottom:16px}
}

/* ---------- cooldown ---------- */
.timer{font-family:${MONO};font-size:34px;font-weight:700;letter-spacing:.04em;font-variant-numeric:tabular-nums;margin:2px 0 12px;color:var(--fg)}
.tbar{height:4px;border-radius:4px;background:var(--line);overflow:hidden;margin-bottom:14px}
.tbar i{display:block;height:100%;width:100%;background:var(--accent);transition:width 1s linear}

/* ---------- footer ---------- */
.foot{margin-top:20px;padding-top:14px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:10.5px;color:var(--muted)}
.foot span{display:flex;align-items:center;gap:6px;min-width:0}
.dot{width:6px;height:6px;border-radius:50%;background:var(--faint);flex:none;transition:background-color .2s,box-shadow .2s}
.dot.on{background:var(--ok);box-shadow:0 0 6px var(--ok)}
.dot.off{background:var(--danger);box-shadow:0 0 6px var(--danger)}
.foot .tag{letter-spacing:.02em;opacity:.85;white-space:nowrap}

@media (max-width:420px){
  body{padding:14px 12px;place-items:start center}
  .card{padding:24px 20px 18px;border-radius:14px;margin-top:max(0px,calc(50vh - 330px))}
  .brand{margin-bottom:18px}
  h1{font-size:18px}
  .sub{margin-bottom:16px}
  .timer{font-size:30px}
}
@media (max-width:380px){
  .clibtn{padding:0 11px}
  .clibtn span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}
  .card::after{display:none}
  .checks li.run .ci,.waiting .spin,.spinner{animation:sp 1.6s linear infinite!important}
}
`;
