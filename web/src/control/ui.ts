// Shared building blocks for the control center pages (overview, activity,
// agents & keys, tools, access, settings): one stylesheet, a sparkline, a
// side drawer that becomes a bottom sheet on phones, an action menu, copy to
// clipboard and a "while visible" lifecycle for live subscriptions.

import { esc, useStyles } from '../dom';
import { toast } from '../toast';

const CC_CSS = `
.cc{max-width:1240px;margin:0 auto}
.cc-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg);min-width:0}
.cc-card-h{display:flex;align-items:center;gap:10px;padding:13px 16px 11px;border-bottom:1px solid var(--line);min-height:48px}
.cc-card-h h2{margin:0;font-size:13.5px;font-weight:650;letter-spacing:.01em}
.cc-card-h .sub{color:var(--muted);font-size:12px}
.cc-card-h .grow{flex:1}
.cc-card-b{padding:14px 16px}
.cc-card-b.flush{padding:0}
.cc-empty{padding:26px 16px;text-align:center;color:var(--muted);font-size:13px;line-height:1.6}
.cc-empty b{color:var(--fg);font-weight:600;display:block;margin-bottom:2px}
.cc-muted{color:var(--muted)}
.cc-mono{font-family:var(--mono);font-size:12px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* pills, dots, segmented controls */
.cc-pill{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:99px;
  border:1px solid var(--line);background:var(--panel-2);color:var(--muted);white-space:nowrap}
.cc-pill.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,transparent);background:color-mix(in srgb,var(--ok) 9%,transparent)}
.cc-pill.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent);background:color-mix(in srgb,var(--warn) 9%,transparent)}
.cc-pill.err{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 40%,transparent);background:color-mix(in srgb,var(--danger) 9%,transparent)}
.cc-pill.acc{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 40%,transparent);background:color-mix(in srgb,var(--accent) 9%,transparent)}
.cc-dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex:none}
.cc-dot.ok{background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 22%,transparent)}
.cc-dot.run{background:var(--accent);animation:ccBlink 1s ease-in-out infinite}
.cc-dot.err{background:var(--danger)}
.cc-dot.idle{background:color-mix(in srgb,var(--muted) 60%,transparent)}
@keyframes ccBlink{50%{opacity:.35}}
.cc-seg{display:inline-flex;padding:3px;gap:2px;border-radius:11px;background:var(--panel-2);border:1px solid var(--line);
  max-width:100%;overflow-x:auto;scrollbar-width:none}
.cc-seg::-webkit-scrollbar{display:none}
.cc-seg button{padding:5px 11px;border-radius:8px;font-size:12.5px;font-weight:600;color:var(--muted);white-space:nowrap;
  transition:background .16s,color .16s;min-height:30px}
.cc-seg button:hover{color:var(--fg)}
.cc-seg button[aria-pressed=true],.cc-seg button[aria-checked=true],.cc-seg button[aria-selected=true]{background:var(--panel);color:var(--fg);
  box-shadow:0 1px 3px rgba(0,0,0,.18),inset 0 0 0 1px color-mix(in srgb,var(--accent) 35%,transparent)}
.cc-seg button:focus-visible,.cc-ibtn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cc-ibtn{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:9px;color:var(--muted);flex:none;
  transition:background .16s,color .16s}
.cc-ibtn:hover{background:var(--panel-2);color:var(--fg)}
.cc-ibtn svg,.cc-i{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;flex:none}
.btn .cc-i{margin-right:2px}
.cc-search{display:flex;align-items:center;gap:8px;flex:1 1 220px;min-width:0;max-width:380px;padding:0 11px;height:36px;
  background:var(--panel);border:1px solid var(--line);border-radius:99px;transition:border-color .16s}
.cc-search:focus-within{border-color:color-mix(in srgb,var(--accent) 55%,transparent)}
.cc-search svg{flex:none;width:15px;height:15px;color:var(--muted)}
.cc-search input{flex:1;min-width:0;background:none;border:0;outline:none;padding:0;font-size:13px;color:var(--fg);height:100%}

/* sparkline */
.cc-spark{display:block;width:100%;height:28px;overflow:visible}
.cc-spark path.l{fill:none;stroke:var(--ag,var(--accent));stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round}
.cc-spark path.a{fill:color-mix(in srgb,var(--ag,var(--accent)) 16%,transparent);stroke:none}

/* stat tiles */
.cc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}
.cc-stat{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg);padding:13px 15px 12px;min-width:0;
  text-align:left;transition:border-color .16s,transform .16s}
button.cc-stat:hover{border-color:color-mix(in srgb,var(--accent) 40%,var(--line))}
.cc-stat .k{font-size:11.5px;font-weight:650;color:var(--muted);letter-spacing:.03em;display:flex;align-items:center;gap:7px}
.cc-stat .v{font-size:26px;font-weight:720;letter-spacing:-.5px;line-height:1.15;margin-top:5px;font-variant-numeric:tabular-nums}
.cc-stat .h{font-size:11.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* drawer / bottom sheet */
.cc-scrim{position:fixed;inset:0;z-index:78;background:rgba(3,6,12,.48);opacity:0;transition:opacity .2s var(--ease)}
:root[data-theme=light] .cc-scrim{background:rgba(15,23,42,.28)}
.cc-scrim.in{opacity:1}
.cc-drawer{position:fixed;z-index:79;top:0;right:0;bottom:0;width:min(460px,100vw);background:var(--panel);
  border-left:1px solid var(--line);box-shadow:var(--shadow);display:flex;flex-direction:column;
  transform:translateX(100%);transition:transform .24s var(--ease)}
.cc-drawer.in{transform:none}
.cc-drawer-h{display:flex;align-items:center;gap:11px;padding:14px 16px;border-bottom:1px solid var(--line)}
.cc-drawer-h .t{flex:1;min-width:0}
.cc-drawer-h h3{margin:0;font-size:15px;font-weight:680;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-drawer-h .s{font-size:12px;color:var(--muted)}
.cc-drawer-b{flex:1;overflow:auto;padding:16px;overscroll-behavior:contain}
.cc-drawer-f{display:flex;gap:8px;flex-wrap:wrap;padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--line)}
.cc-grab{display:none}
@media (max-width:760px){
  .cc-drawer{top:auto;left:0;width:100%;max-height:88vh;border-left:0;border-top:1px solid var(--line);
    border-radius:18px 18px 0 0;transform:translateY(100%)}
  .cc-grab{display:block;width:38px;height:4px;border-radius:99px;background:var(--line);margin:8px auto 0}
}

/* menus: a popover on desktop, a bottom sheet with labels and descriptions on phones */
.cc-menu-scrim{position:fixed;inset:0;z-index:84}
.cc-menu-scrim.dim{background:rgba(3,6,12,.5);opacity:0;transition:opacity .2s var(--ease)}
:root[data-theme=light] .cc-menu-scrim.dim{background:rgba(15,23,42,.3)}
.cc-menu-scrim.dim.in{opacity:1}
.cc-menu{position:fixed;z-index:85;min-width:210px;max-width:min(320px,calc(100vw - 16px));padding:5px;background:var(--surface-1);
  border:1px solid var(--line-strong);border-radius:12px;box-shadow:var(--shadow);animation:pop .14s var(--ease)}
.cc-menu button{display:flex;width:100%;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;font-size:13px;
  text-align:left;color:var(--fg);min-height:38px}
.cc-menu button:hover:not(:disabled),.cc-menu button:focus-visible{background:var(--panel-2);outline:none}
.cc-menu button:disabled{opacity:.45;cursor:not-allowed}
.cc-menu .mi-ico{display:grid;place-items:center;width:18px;flex:none;color:var(--muted)}
.cc-menu .mi-ico:empty{display:none}
.cc-menu .mi-t{display:flex;flex-direction:column;min-width:0;flex:1}
.cc-menu .mi-t b{font-weight:560}
.cc-menu .mi-t small{display:none}
.cc-menu button.danger,.cc-menu button.danger .mi-ico{color:var(--danger)}
.cc-menu hr{border:0;border-top:1px solid var(--line);margin:4px 2px}
.cc-menu-h{display:flex;align-items:center;gap:10px;padding:6px 10px 10px;margin-bottom:4px;border-bottom:1px solid var(--line);
  font-size:14px;font-weight:680;min-width:0}
.cc-menu-h span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-menu.sheet{left:0;right:0;bottom:0;top:auto;max-width:none;min-width:0;max-height:86vh;overflow:auto;overscroll-behavior:contain;
  border-radius:20px 20px 0 0;border-bottom:0;padding:4px 10px calc(10px + env(safe-area-inset-bottom));animation:none;
  transform:translateY(100%);transition:transform .22s var(--ease)}
.cc-menu.sheet.in{transform:none}
.cc-menu.sheet button{min-height:56px;padding:9px 10px;gap:14px;border-radius:12px}
.cc-menu.sheet .mi-ico{width:36px;height:36px;border-radius:10px;background:var(--panel-2);border:1px solid var(--line)}
.cc-menu.sheet .mi-ico:empty{display:grid}
.cc-menu.sheet button.danger .mi-ico{background:var(--danger-soft);border-color:color-mix(in srgb,var(--danger) 30%,transparent)}
.cc-menu.sheet .mi-t b{font-size:14.5px;font-weight:620}
.cc-menu.sheet .mi-t small{display:block;font-size:12.5px;color:var(--muted);margin-top:1px;line-height:1.4}
.cc-menu.sheet .cc-grab{display:block;margin:6px auto 8px}

/* sheet: side sheet on desktop and tablet, bottom sheet on phones */
.cc-sh-scrim{position:fixed;inset:0;z-index:78;background:rgba(3,6,12,.55);opacity:0;transition:opacity .2s var(--ease)}
:root[data-theme=light] .cc-sh-scrim{background:rgba(15,23,42,.32)}
.cc-sh-scrim.in{opacity:1}
.cc-sh{position:fixed;z-index:79;top:0;right:0;bottom:0;width:min(var(--sh-w,520px),100vw);min-width:0;background:var(--surface-1);
  border-left:1px solid var(--line-strong);box-shadow:var(--shadow-lg,var(--shadow));display:flex;flex-direction:column;overflow:hidden;
  transform:translateX(100%);transition:transform .24s var(--ease);isolation:isolate}
.cc-sh.in{transform:none}
.cc-sh-h{display:flex;align-items:center;gap:12px;padding:16px 16px 14px 20px;border-bottom:1px solid var(--line);flex:none;min-width:0}
.cc-sh-h .t{flex:1;min-width:0}
.cc-sh-h h2{margin:0;font-size:16.5px;font-weight:700;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-sh-h p{margin:2px 0 0;font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-sh-x{width:40px;height:40px;border:1px solid var(--line)}
.cc-sh-b{flex:1;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden;padding:18px 20px 22px;overscroll-behavior:contain}
.cc-sh [hidden],.cc [hidden]{display:none!important}
.cc-sh-f{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:12px 20px calc(12px + env(safe-area-inset-bottom));
  border-top:1px solid var(--line);background:var(--surface-1);flex:none}
.cc-sh-f .grow{flex:1}
.cc-sh-f .btn{height:40px;padding:0 16px;border-radius:11px}
.cc-sh .cc-grab{display:none}
.cc-sh.swap{transition:none}
.cc-sh.swap .cc-sh-b,.cc-sh.swap .cc-sh-h .t{animation:ccShSwap .2s var(--ease)}
@keyframes ccShSwap{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:none}}
.cc-sh-back{width:36px;height:36px;margin-left:-8px;border-radius:10px}
.cc-sh-back svg{width:18px;height:18px}
/* Toasts never cover a sheet's header or buttons: beside it on wide screens, above its footer otherwise. */
@media (min-width:1101px){body:has(.cc-sh.in) .toasts{right:calc(var(--cc-sh-open,560px) + 16px)}}
@media (max-width:1100px){body:has(.cc-sh.in) .toasts{top:auto;bottom:calc(var(--cc-sh-foot,76px) + 10px)}}
@media (max-width:760px){
  .cc-sh{top:auto;left:0;width:100%;max-height:calc(100dvh - 24px);border-left:0;border-top:1px solid var(--line-strong);
    border-radius:20px 20px 0 0;transform:translateY(100%)}
  .cc-sh.full{height:calc(100dvh - 10px - env(safe-area-inset-top));max-height:none}
  .cc-sh .cc-grab{display:block;flex:none;margin:8px auto 0}
  .cc-sh-h{padding:8px 12px 12px 16px}
  .cc-sh-b{padding:16px}
  .cc-sh-f{padding:10px 16px calc(10px + env(safe-area-inset-bottom))}
  .cc-sh-f .btn{flex:1 1 0;height:46px}
  .cc-sh-f .grow{display:none}
}
.cc-sh-sec{margin:0 0 22px}
.cc-sh-sec:last-child{margin-bottom:0}
.cc-sh-sec>h3{margin:0 0 4px;font-size:14px;font-weight:680}
.cc-sh-sec>p{margin:0 0 12px;font-size:12.5px;color:var(--muted);line-height:1.5}

/* switch */
.cc-sw{position:relative;flex:none;width:44px;height:26px;border-radius:99px;border:1px solid var(--line-strong);background:var(--panel-2);
  cursor:pointer;transition:background .18s,border-color .18s}
.cc-sw i{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:99px;background:var(--muted);
  transition:transform .18s var(--ease),background .18s}
.cc-sw[aria-checked=true]{background:color-mix(in srgb,var(--accent) 26%,var(--panel-2));border-color:color-mix(in srgb,var(--accent) 60%,transparent)}
.cc-sw[aria-checked=true] i{transform:translateX(18px);background:var(--accent)}
.cc-sw[aria-checked=mixed] i{transform:translateX(9px);background:color-mix(in srgb,var(--accent) 70%,var(--muted))}
.cc-sw[aria-checked=mixed]{border-color:color-mix(in srgb,var(--accent) 40%,transparent)}
.cc-sw:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cc-sw:disabled{opacity:.5;cursor:progress}
.cc-sw.warn[aria-checked=true]{background:color-mix(in srgb,var(--warn) 24%,var(--panel-2));border-color:color-mix(in srgb,var(--warn) 60%,transparent)}
.cc-sw.warn[aria-checked=true] i{background:var(--warn)}
/* the hit area grows to 44px without changing the look */
.cc-sw::before{content:"";position:absolute;inset:-10px -4px}

/* fixes for Modal on phones: never wider than the screen */
.modal-host>.modal{min-width:0}
.modal-body{min-width:0;overflow-x:hidden}

/* key/value list */
.cc-kv{display:grid;grid-template-columns:minmax(110px,max-content) 1fr;gap:8px 16px;font-size:13px}
.cc-kv dt{color:var(--muted)}
.cc-kv dd{margin:0;min-width:0;word-break:break-word}

/* code snippet */
.cc-code{position:relative;margin:0;background:var(--bg);border:1px solid var(--line);border-radius:12px;
  padding:12px 44px 12px 14px;font-family:var(--mono);font-size:12px;line-height:1.6;overflow:auto;white-space:pre;color:var(--fg)}
:root[data-theme=light] .cc-code{background:#f8f9fb}
.cc-code-wrap{position:relative}
.cc-code-wrap .cc-copy{position:absolute;top:7px;right:7px;background:var(--panel)}

@media (max-width:760px){
  .cc-search{max-width:none;flex-basis:100%}
  .cc-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
  .cc-stat{padding:11px 12px}
  .cc-stat .v{font-size:22px}
  .cc-stat:last-child:nth-child(odd){grid-column:1/-1}
  .cc-card-h{padding:11px 13px 10px}
  .cc-card-b{padding:12px 13px}
}
@media (prefers-reduced-motion:reduce){
  .cc-dot.run{animation:none}
  .cc-drawer,.cc-scrim,.cc-sh,.cc-sh-scrim,.cc-menu.sheet,.cc-menu-scrim.dim{transition:none}
  .cc-sh.swap .cc-sh-b,.cc-sh.swap .cc-sh-h .t{animation:none}
}
`;

export function useControlStyles(): void {
  useStyles('cc-css', CC_CSS);
}

export const ICO = {
  search: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  copy: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  close: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  more: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
  refresh: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  plus: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  download: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  pause: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>',
  plug: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/></svg>',
  shield: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 6v6c0 4.5 3.2 7.6 7.5 9 4.3-1.4 7.5-4.5 7.5-9V6z"/></svg>',
  key: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/></svg>',
  note: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>',
  filter: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6 8v6l-4-2v-4z"/></svg>',
  arrow: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  up: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  check: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17l9-10"/></svg>',
  x: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>',
};

/** Smooth area sparkline of counts. */
export function sparkSVG(values: number[], w = 120, h = 28): string {
  const n = values.length;
  if (!n) return '';
  const max = Math.max(1, ...values);
  const step = n > 1 ? w / (n - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 2 - (v / max) * (h - 5)] as const);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  const area = `${d} L${w},${h} L0,${h} Z`;
  return `<svg class="cc-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="a" d="${area}"/><path class="l" d="${d}" vector-effect="non-scaling-stroke"/></svg>`;
}

/** "12s", "4m", "3h", "2d" ago, compact. */
export function ago(tsSec: number): string {
  if (!tsSec) return '-';
  const s = Math.max(0, Date.now() / 1000 - tsSec);
  if (s < 10) return 'now';
  if (s < 60) return Math.floor(s) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

export function clock(tsSec: number, seconds = false): string {
  const d = new Date(tsSec * 1000);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hour12: false,
  });
}

export async function copyText(text: string, what = 'Copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(what, 'ok', 1800);
  } catch {
    // Clipboard API needs a secure context; fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    toast(ok ? what : 'Copy failed, select the text instead', ok ? 'ok' : 'err', 2200);
  }
}

/** A code block with a copy button. */
export function codeHTML(code: string, label = 'Copy'): string {
  return `<div class="cc-code-wrap"><pre class="cc-code">${esc(code)}</pre><button type="button" class="cc-ibtn cc-copy" data-copy="${esc(
    code,
  )}" aria-label="${esc(label)}" title="${esc(label)}">${ICO.copy}</button></div>`;
}

/** Wire every [data-copy] button in a scope. */
export function wireCopy(scope: ParentNode): void {
  scope.querySelectorAll<HTMLElement>('[data-copy]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      void copyText(b.dataset.copy || '');
    };
  });
}

/**
 * Run `start` now and its cleanup as soon as `section` gets the `hidden` class
 * (the router hides views it leaves). Calling again replaces the previous run.
 */
const lifecycles = new WeakMap<HTMLElement, () => void>();
export function whileVisible(section: HTMLElement, start: () => () => void): void {
  lifecycles.get(section)?.();
  const stop = start();
  let done = false;
  const obs = new MutationObserver(() => {
    if (section.classList.contains('hidden')) cleanup();
  });
  const cleanup = (): void => {
    if (done) return;
    done = true;
    obs.disconnect();
    lifecycles.delete(section);
    stop();
  };
  obs.observe(section, { attributes: true, attributeFilter: ['class', 'hidden'] });
  lifecycles.set(section, cleanup);
}

// ── drawer / bottom sheet ───────────────────────────────────────────────

interface DrawerOptions {
  title: string;
  sub?: string;
  lead?: string;
  body: string;
  foot?: string;
  onOpen?: (root: HTMLElement) => void;
}

let closeDrawerFn: (() => void) | null = null;

export function closeDrawer(): void {
  closeDrawerFn?.();
}

/** Side drawer on desktop, bottom sheet on phones. Esc and the scrim close it. */
export function openDrawer(o: DrawerOptions): HTMLElement {
  closeDrawer();
  useControlStyles();
  const last = document.activeElement as HTMLElement | null;
  const scrim = document.createElement('div');
  scrim.className = 'cc-scrim';
  const d = document.createElement('aside');
  d.className = 'cc-drawer';
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-modal', 'true');
  const tid = 'ccDrawerT' + Math.random().toString(36).slice(2, 8);
  d.setAttribute('aria-labelledby', tid);
  d.innerHTML = `<div class="cc-grab" aria-hidden="true"></div><div class="cc-drawer-h">${o.lead || ''}<div class="t"><h3 id="${tid}">${esc(
    o.title,
  )}</h3>${o.sub ? `<div class="s">${esc(o.sub)}</div>` : ''}</div>
    <button type="button" class="cc-ibtn" data-x aria-label="Close">${ICO.close}</button></div>
    <div class="cc-drawer-b">${o.body}</div>${o.foot ? `<div class="cc-drawer-f">${o.foot}</div>` : ''}`;
  document.body.append(scrim, d);
  requestAnimationFrame(() => {
    scrim.classList.add('in');
    d.classList.add('in');
  });
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const close = (): void => {
    closeDrawerFn = null;
    document.removeEventListener('keydown', key, true);
    scrim.classList.remove('in');
    d.classList.remove('in');
    setTimeout(() => {
      scrim.remove();
      d.remove();
    }, 240);
    try {
      last?.focus();
    } catch {
      /* gone */
    }
  };
  closeDrawerFn = close;
  document.addEventListener('keydown', key, true);
  scrim.onclick = close;
  (d.querySelector('[data-x]') as HTMLElement).onclick = close;
  setTimeout(() => (d.querySelector('[data-x]') as HTMLElement | null)?.focus(), 30);
  wireCopy(d);
  o.onOpen?.(d);
  return d;
}

// ── action menu ─────────────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  /** One line saying what the item does; shown under the label on phones. */
  desc?: string;
  icon?: string;
  danger?: boolean;
  sep?: boolean;
  disabled?: boolean;
  run?: () => void;
}

export interface MenuOptions {
  /** Heading of the bottom sheet on phones (the thing the menu acts on). */
  title?: string;
  /** Leading HTML for that heading, e.g. an avatar. */
  lead?: string;
}

const MENU_MQ = '(max-width: 760px)';

let closeMenuFn: (() => void) | null = null;

/** Popover menu under `anchor`; on phones a bottom sheet with a scrim, labels and descriptions. */
export function openMenu(anchor: HTMLElement, items: MenuItem[], opts: MenuOptions = {}): void {
  useControlStyles();
  closeMenuFn?.();
  document.querySelectorAll('.cc-menu,.cc-menu-scrim').forEach((n) => n.remove());
  const sheet = window.matchMedia(MENU_MQ).matches;
  const scrim = document.createElement('div');
  scrim.className = 'cc-menu-scrim' + (sheet ? ' dim' : '');
  const m = document.createElement('div');
  m.className = 'cc-menu' + (sheet ? ' sheet' : '');
  m.setAttribute('role', 'menu');
  if (opts.title) m.setAttribute('aria-label', opts.title);
  const head =
    sheet && opts.title
      ? `<div class="cc-menu-h" aria-hidden="true">${opts.lead || ''}<span>${esc(opts.title)}</span></div>`
      : '';
  m.innerHTML =
    (sheet ? '<div class="cc-grab" aria-hidden="true"></div>' : '') +
    head +
    items
      .map((it, i) =>
        it.sep
          ? '<hr>'
          : `<button type="button" role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}"${it.disabled ? ' disabled' : ''}${
              it.desc && !sheet ? ` title="${esc(it.desc)}"` : ''
            }><span class="mi-ico">${it.icon || ''}</span><span class="mi-t"><b>${esc(it.label)}</b>${
              it.desc ? `<small>${esc(it.desc)}</small>` : ''
            }</span></button>`,
      )
      .join('');
  document.body.append(scrim, m);
  if (!sheet) {
    const r = anchor.getBoundingClientRect();
    const mw = m.offsetWidth;
    const mh = m.offsetHeight;
    let left = Math.min(window.innerWidth - mw - 8, r.right - mw);
    left = Math.max(8, left);
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.left = left + 'px';
    m.style.top = top + 'px';
  } else {
    requestAnimationFrame(() => {
      scrim.classList.add('in');
      m.classList.add('in');
    });
  }
  const close = (): void => {
    if (closeMenuFn === close) closeMenuFn = null;
    document.removeEventListener('keydown', key, true);
    scrim.remove();
    m.remove();
    anchor.focus();
  };
  const key = (e: KeyboardEvent): void => {
    const btns = Array.from(m.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      btns[(i + 1) % btns.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      btns[(i - 1 + btns.length) % btns.length]?.focus();
    } else if (e.key === 'Tab') close();
  };
  closeMenuFn = close;
  document.addEventListener('keydown', key, true);
  scrim.onclick = close;
  m.querySelectorAll<HTMLButtonElement>('button[data-i]').forEach((b) => {
    b.onclick = () => {
      const it = items[Number(b.dataset.i)];
      close();
      it.run?.();
    };
  });
  m.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}

// ── sheet ───────────────────────────────────────────────────────────────
// A side sheet on desktop and tablet, a bottom sheet on phones. Solid
// surface, a scrim, above the tab bar (z 78/79) and below Modal (80), so a
// confirm opened from a sheet lands on top of it.

export interface SheetAction {
  label: string;
  cls?: string;
  icon?: string;
  /** Pushes the following actions to the right. */
  left?: boolean;
  run: (sheet: Sheet) => void | Promise<void>;
}

export interface SheetOptions {
  title: string;
  sub?: string;
  /** Leading HTML in the header, e.g. an avatar. */
  lead?: string;
  body: string;
  actions?: SheetAction[];
  /** Desktop width in px (default 520). */
  width?: number;
  /** Full height on phones (long or multi-step content). */
  full?: boolean;
  /** Shows a back button in the header that runs this (e.g. reopen the sheet this one came from). */
  back?: () => void;
  onOpen?: (sheet: Sheet) => void;
  onClose?: () => void;
}

export interface Sheet {
  root: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement | null;
  close: () => void;
}

let closeSheetFn: ((instant?: boolean) => void) | null = null;
/** Where focus goes back to when the last sheet of a chain closes. */
let sheetOrigin: HTMLElement | null = null;

export function closeSheet(): void {
  closeSheetFn?.();
}

const BACK_ICO = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';

/**
 * Opens a sheet. When another sheet is open it is replaced in place, without
 * the slide, so moving between related sheets (an agent and its permissions)
 * feels like one panel.
 */
export function openSheet(o: SheetOptions): Sheet {
  const swap = !!closeSheetFn;
  if (swap) closeSheetFn!(true);
  else sheetOrigin = document.activeElement as HTMLElement | null;
  useControlStyles();
  const last = sheetOrigin;
  const scrim = document.createElement('div');
  scrim.className = 'cc-sh-scrim';
  const d = document.createElement('div');
  d.className = 'cc-sh' + (o.full ? ' full' : '') + (swap ? ' swap' : '');
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-modal', 'true');
  const tid = 'ccSh' + Math.random().toString(36).slice(2, 8);
  d.setAttribute('aria-labelledby', tid);
  const width = o.width || 520;
  d.style.setProperty('--sh-w', width + 'px');
  document.documentElement.style.setProperty('--cc-sh-open', Math.min(width, window.innerWidth) + 'px');
  d.innerHTML = `<div class="cc-grab" aria-hidden="true"></div><header class="cc-sh-h">${
    o.back ? `<button type="button" class="cc-ibtn cc-sh-back" data-back aria-label="Back" title="Back">${BACK_ICO}</button>` : ''
  }${o.lead || ''}<div class="t"><h2 id="${tid}">${esc(o.title)}</h2>${o.sub ? `<p>${esc(o.sub)}</p>` : ''}</div>
    <button type="button" class="cc-ibtn cc-sh-x" data-x aria-label="Close">${ICO.close}</button></header>
    <div class="cc-sh-b">${o.body}</div>${o.actions?.length ? '<footer class="cc-sh-f"></footer>' : ''}`;
  const body = d.querySelector('.cc-sh-b') as HTMLElement;
  const foot = d.querySelector('.cc-sh-f') as HTMLElement | null;
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.append(scrim, d);
  if (swap) {
    scrim.classList.add('in');
    d.classList.add('in');
    setTimeout(() => d.classList.remove('swap'), 260);
  } else
    requestAnimationFrame(() => {
      scrim.classList.add('in');
      d.classList.add('in');
    });
  const sheet: Sheet = { root: d, body, foot, close: () => close() };
  if (foot && o.actions) {
    for (const a of o.actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.cls || '');
      b.innerHTML = (a.icon || '') + esc(a.label);
      b.onclick = async () => {
        b.disabled = true;
        try {
          await a.run(sheet);
        } finally {
          b.disabled = false;
        }
      };
      foot.appendChild(b);
      if (a.left) {
        const g = document.createElement('span');
        g.className = 'grow';
        foot.appendChild(g);
      }
    }
  }
  document.documentElement.style.setProperty('--cc-sh-foot', (foot ? foot.offsetHeight || 64 : 0) + 'px');
  // Another layer (a confirm, a menu, a select, the palette) handles its own keys first.
  const covered = (): boolean =>
    !!document.querySelector('#modalHost:not(.hidden),.cc-menu,.ui-sel-pop') || !document.body.contains(d);
  const key = (e: KeyboardEvent): void => {
    if (covered()) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const f = Array.from(
      d.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex]:not([tabindex="-1"])'),
    ).filter((n) => n.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) {
      e.preventDefault();
      f[f.length - 1].focus();
    } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
      e.preventDefault();
      f[0].focus();
    }
  };
  let closed = false;
  const close = (instant = false): void => {
    if (closed) return;
    closed = true;
    if (closeSheetFn === close) closeSheetFn = null;
    document.removeEventListener('keydown', key, true);
    document.body.style.overflow = prevOverflow;
    if (instant) {
      scrim.remove();
      d.remove();
    } else {
      scrim.classList.remove('in');
      d.classList.remove('in');
      setTimeout(() => {
        scrim.remove();
        d.remove();
      }, 240);
    }
    o.onClose?.();
    if (instant) return;
    sheetOrigin = null;
    try {
      last?.focus();
    } catch {
      /* gone */
    }
  };
  closeSheetFn = close;
  document.addEventListener('keydown', key, true);
  scrim.onclick = () => close();
  (d.querySelector('[data-x]') as HTMLElement).onclick = () => close();
  const back = d.querySelector<HTMLElement>('[data-back]');
  if (back && o.back) back.onclick = o.back;
  wireCopy(d);
  o.onOpen?.(sheet);
  setTimeout(() => {
    if (d.contains(document.activeElement)) return;
    (d.querySelector('input:not([type=hidden]):not(:disabled),[data-autofocus]') as HTMLElement | null)?.focus() ??
      (d.querySelector('[data-x]') as HTMLElement | null)?.focus();
  }, 40);
  return sheet;
}

/** One switch row: a label, an explanation and a role=switch button. */
export function switchHTML(id: string, on: boolean, label: string, extra = ''): string {
  return `<button type="button" class="cc-sw" role="switch" id="${esc(id)}" aria-checked="${on}" aria-label="${esc(label)}"${extra}><i></i></button>`;
}

/** Download a text blob as a file. */
export function download(name: string, text: string, type = 'application/json'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 600);
}

export function plural(n: number, word: string, many?: string): string {
  return `${n} ${n === 1 ? word : many || word + 's'}`;
}

// ── system page header ──────────────────────────────────────────────────
// Activity, Agents & API keys, Tools, Access rules and Settings each stand
// alone: a title, one line on what the page is for, and the page's own actions.

export type SystemPage = 'settings' | 'keys' | 'tools' | 'access' | 'logs';

const SYS_CSS = `
.sys-head{display:flex;align-items:center;gap:12px 20px;flex-wrap:wrap;margin:4px 0 20px;min-width:0}
.sys-head .sys-t{flex:1 1 320px;min-width:0}
.sys-head h1{margin:0;font-size:24px;font-weight:720;letter-spacing:-.4px;line-height:1.2}
.sys-head p{margin:5px 0 0;color:var(--muted);font-size:13.5px;line-height:1.5;max-width:72ch}
.sys-acts{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:none}
.sys-acts .btn{height:38px;border-radius:11px}
.sys-acts .cc-ibtn{width:38px;height:38px;border:1px solid var(--line);border-radius:11px}
@media (max-width:760px){
  .sys-head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;margin:0 0 16px;gap:12px}
  .sys-head h1{font-size:21px}
  .sys-head p{font-size:13px}
  .sys-acts:has(.btn){grid-column:1/-1}
  .sys-acts .btn{height:44px;flex:1 1 auto}
  .sys-acts .cc-ibtn{width:44px;height:44px}
}
`;

/** Header shared by the system pages. `sub` and `acts` are trusted HTML from the caller. */
export function systemHeader(_page: SystemPage, title: string, sub: string, acts = ''): string {
  useStyles('cc-sys-css', SYS_CSS);
  return `<header class="sys-head"><div class="sys-t"><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${
    acts ? `<div class="sys-acts">${acts}</div>` : ''
  }</header>`;
}

