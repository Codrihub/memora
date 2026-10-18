// Canvas styles, injected once with useStyles. Theme aware through
// `html[data-theme]`; dark is the default.

export const CANVAS_CSS = `
#view-canvas{padding:0;overflow:hidden}
.cv{
  --cv-bg:var(--surface-0,#0b0e14); --cv-dot:rgba(148,163,184,.30); --cv-frame:rgba(148,163,184,.035);
  --cv-frame-line:rgba(148,163,184,.16); --cv-card:#141923; --cv-card-2:#1a2030; --cv-line:#252d3c;
  --cv-fg:#e6e9ef; --cv-muted:#8b98ad; --cv-faint:#5d6879; --cv-acc:#5eead4; --cv-acc-ink:#04221d;
  --cv-sel:#5eead4; --cv-ui:#11151e; --cv-ui-line:rgba(148,163,184,.16);
  --cv-ui-hover:rgba(148,163,184,.12); --cv-shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.28);
  --cv-shadow-lg:0 2px 6px rgba(0,0,0,.4),0 24px 60px rgba(0,0,0,.5);
  --cv-tag:rgba(148,163,184,.12); --z:1; --lz:1;
  position:absolute;inset:0;overflow:hidden;background:var(--cv-bg);color:var(--cv-fg);
  touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;
  font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif;outline:none;
}
html[data-theme=light] .cv{
  --cv-bg:var(--surface-0,#f4f5f8); --cv-dot:rgba(15,23,42,.26); --cv-frame:rgba(255,255,255,.5);
  --cv-frame-line:rgba(15,23,42,.12); --cv-card:#ffffff; --cv-card-2:#f7f8fb; --cv-line:#e2e6ee;
  --cv-fg:#111827; --cv-muted:#5b6678; --cv-faint:#98a2b3; --cv-acc:#0d9488; --cv-acc-ink:#ffffff;
  --cv-sel:#0d9488; --cv-ui:#ffffff; --cv-ui-line:rgba(15,23,42,.1);
  --cv-ui-hover:rgba(15,23,42,.06); --cv-shadow:0 1px 2px rgba(15,23,42,.06),0 6px 18px rgba(15,23,42,.07);
  --cv-shadow-lg:0 2px 6px rgba(15,23,42,.08),0 24px 60px rgba(15,23,42,.16); --cv-tag:rgba(15,23,42,.06);
}
.cv.panning,.cv.panning *{cursor:grabbing !important}
.cv.hand{cursor:grab}
.cv-layer{position:absolute;left:0;top:0;transform-origin:0 0;width:0;height:0}
.cv.moving .cv-layer{will-change:transform}
.cv-links{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}

/* frames */
.cv-frame{position:absolute;left:0;top:0;border-radius:18px;background:var(--cv-frame);
  border:1px solid var(--cv-frame-line);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fc) 6%,transparent);
  transition:box-shadow .15s,background .15s}
.cv-frame::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:linear-gradient(180deg,color-mix(in srgb,var(--fc) 9%,transparent),transparent 140px)}
.cv-frame.sel{box-shadow:0 0 0 calc(2px / var(--z)) var(--cv-sel)}
.cv-frame.drop{background:color-mix(in srgb,var(--fc) 12%,transparent);
  box-shadow:0 0 0 calc(2px / var(--z)) var(--fc),0 0 0 calc(8px / var(--z)) color-mix(in srgb,var(--fc) 22%,transparent)}
.cv-flabel{position:absolute;left:2px;bottom:100%;display:flex;align-items:center;gap:6px;white-space:nowrap;
  font-size:calc(13px * var(--lz));line-height:1;padding-bottom:calc(8px * var(--lz));cursor:grab;color:var(--cv-muted);
  font-weight:600;max-width:none}
.cv-flabel:hover,.cv-frame.sel .cv-flabel{color:var(--cv-fg)}
.cv-fdot{width:.7em;height:.7em;border-radius:.22em;background:var(--fc);flex:none;
  box-shadow:0 0 0 .2em color-mix(in srgb,var(--fc) 22%,transparent)}
.cv-ftitle{letter-spacing:.01em;outline:none}
.cv-fcount{font-weight:500;color:var(--cv-faint);font-variant-numeric:tabular-nums}
.cv-fbtn{opacity:0;font-size:.95em;line-height:1;padding:.18em .35em;border-radius:.35em;color:var(--cv-muted);transition:opacity .15s}
.cv-flabel:hover .cv-fbtn,.cv-frame.sel .cv-fbtn{opacity:1}
.cv-fbtn:hover{background:var(--cv-ui-hover);color:var(--cv-fg)}
.cv-fresize{position:absolute;right:-6px;bottom:-6px;width:22px;height:22px;cursor:nwse-resize;border-radius:6px}
.cv-fresize::after{content:"";position:absolute;right:9px;bottom:9px;width:9px;height:9px;
  border-right:2px solid var(--cv-faint);border-bottom:2px solid var(--cv-faint);border-radius:0 0 3px 0;opacity:0;transition:opacity .15s}
.cv-frame:hover .cv-fresize::after,.cv-frame.sel .cv-fresize::after{opacity:1}

/* cards */
.cv-card{position:absolute;left:0;top:0;width:240px;height:136px;border-radius:12px;background:var(--cv-card);
  border:1px solid var(--cv-line);box-shadow:var(--cv-shadow);padding:11px 13px 9px 15px;display:flex;flex-direction:column;
  gap:5px;cursor:default;overflow:hidden;transition:box-shadow .16s,border-color .16s,opacity .16s}
.cv-card::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--fc)}
.cv-card:hover{border-color:color-mix(in srgb,var(--fc) 45%,var(--cv-line))}
.cv-card.sel{border-color:var(--cv-sel);box-shadow:0 0 0 calc(1.5px / var(--z)) var(--cv-sel),var(--cv-shadow)}
.cv-card.drag{box-shadow:var(--cv-shadow-lg);opacity:.96;transition:none;z-index:5}
.cv-card.dim{opacity:.35}
.cv-card.flash{animation:cvflash 1.4s var(--ease,ease)}
@keyframes cvflash{0%{box-shadow:0 0 0 6px color-mix(in srgb,var(--cv-acc) 55%,transparent),var(--cv-shadow)}100%{box-shadow:0 0 0 0 transparent,var(--cv-shadow)}}
.cv-ctitle{font-weight:650;font-size:14px;line-height:1.3;color:var(--cv-fg);display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden;padding-right:22px;letter-spacing:-.005em;flex:none}
.cv-ctitle input,.cv-ftitle input{font:inherit;color:inherit;background:var(--cv-card-2);border:1px solid var(--cv-sel);
  border-radius:6px;padding:1px 5px;outline:none;width:100%;user-select:text;-webkit-user-select:text}
.cv-ftitle input{width:auto;min-width:8em;background:var(--cv-card)}
.cv-cex{color:var(--cv-muted);font-size:12px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;flex:none;min-height:2.9em}
.cv-cex.loading{background:linear-gradient(90deg,var(--cv-tag),transparent);border-radius:4px;min-height:2.6em;opacity:.6}
.cv-ctags{display:flex;gap:4px;flex-wrap:nowrap;overflow:hidden;flex:none;min-height:18px}
.cv-ctags span{font-size:10.5px;padding:1px 7px;border-radius:999px;background:var(--cv-tag);color:var(--cv-muted);white-space:nowrap}
.cv-cfoot{margin-top:auto;display:flex;align-items:center;gap:8px;font-size:11px;color:var(--cv-faint);flex:none}
.cv-cfoot .grow{flex:1}
.cv-copen{position:absolute;right:8px;top:8px;width:24px;height:24px;border-radius:7px;display:grid;place-items:center;
  color:var(--cv-muted);opacity:0;transition:opacity .15s,background .15s}
.cv-card:hover .cv-copen,.cv-card.sel .cv-copen{opacity:1}
.cv-copen:hover{background:var(--cv-ui-hover);color:var(--cv-fg)}
.cv-copen svg{width:14px;height:14px}
.cv-agent{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:999px;font-size:9.5px;font-weight:700;
  letter-spacing:.02em;color:#0b0e14;background:var(--ac);position:relative}
.cv-agent.live::after{content:"";position:absolute;inset:-3px;border-radius:inherit;border:2px solid var(--ac);animation:cvpulse 1.2s infinite}
@keyframes cvpulse{0%{opacity:.9;transform:scale(.9)}100%{opacity:0;transform:scale(1.5)}}
.cv-card.touched{border-color:color-mix(in srgb,var(--ac) 55%,var(--cv-line))}
.cv-card.touched.live{box-shadow:0 0 0 calc(2px / var(--z)) var(--ac),var(--cv-shadow)}

/* level of detail */
.cv.lod1 .cv-cex,.cv.lod1 .cv-ctags,.cv.lod1 .cv-cfoot,.cv.lod1 .cv-copen{display:none}
.cv.lod1 .cv-ctitle{font-size:24px;-webkit-line-clamp:4;padding-right:0}
.cv.lod1 .cv-card{justify-content:center;box-shadow:none}

/* agent cursors */
.cv-cursor{position:absolute;left:0;top:0;pointer-events:none;transition:transform .7s cubic-bezier(.22,.61,.36,1),opacity .4s;z-index:20}
.cv-cursor-in{transform:scale(var(--iz));transform-origin:0 0;display:flex;align-items:flex-start}
.cv-cursor svg{width:18px;height:18px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}
.cv-cursor b{margin:14px 0 0 -2px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:650;color:#0b0e14;
  background:var(--ac);white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25)}
.cv-cursor small{display:block;font-weight:500;opacity:.75;font-size:10px;max-width:220px;overflow:hidden;text-overflow:ellipsis}

/* chrome */
.cv-ui{position:absolute;z-index:30;background:var(--cv-ui);border:1px solid var(--cv-ui-line);border-radius:12px;
  box-shadow:var(--cv-shadow);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);
  touch-action:auto}
.cv-btn{height:32px;min-width:32px;padding:0 9px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  color:var(--cv-muted);font-size:12.5px;font-weight:550;white-space:nowrap;transition:background .12s,color .12s}
.cv-btn:hover{background:var(--cv-ui-hover);color:var(--cv-fg)}
.cv-btn.on{background:color-mix(in srgb,var(--cv-acc) 16%,transparent);color:var(--cv-acc)}
.cv-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.cv-sep{width:1px;align-self:stretch;margin:6px 3px;background:var(--cv-ui-line)}
.cv-tools{left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;padding:4px;gap:2px}
.cv-zoom{min-width:52px;font-variant-numeric:tabular-nums}
.cv-selbar{left:50%;bottom:68px;transform:translateX(-50%);display:flex;align-items:center;padding:4px;gap:2px}
.cv-selbar .cnt{padding:0 8px;font-size:12px;color:var(--cv-muted)}
.cv-fchips{display:inline-flex;align-items:center;gap:2px}
.cv-fchip{max-width:150px;font-size:12px;font-weight:600;color:var(--cv-fg);border:1px solid var(--cv-ui-line)}
.cv-fchip .cv-fdot{flex:none}
.cv-fchip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cv-fmore{padding:0 6px;font-size:11.5px;color:var(--cv-muted)}
.cv-marquee{position:absolute;z-index:25;border:1px solid var(--cv-sel);background:color-mix(in srgb,var(--cv-sel) 10%,transparent);
  pointer-events:none;border-radius:2px}
.cv-toast{left:50%;bottom:72px;transform:translateX(-50%) translateY(10px);opacity:0;display:flex;align-items:center;gap:10px;
  padding:6px 6px 6px 14px;font-size:13px;transition:opacity .2s,transform .2s;pointer-events:none;max-width:calc(100% - 28px)}
.cv-toast.show{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}
.cv-toast .msg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cv-toast .cv-btn{color:var(--cv-acc)}
.cv-toast.err .msg{color:#f87171}
.cv.has-sel .cv-toast{bottom:120px}
.cv-empty{position:absolute;inset:0;display:grid;place-items:center;color:var(--cv-muted);font-size:14px;pointer-events:none}

/* side panel */
.cv.no-node-text .cv-cex,.cv.no-node-text .cv-ctags,.cv.no-node-text .cv-cfoot{visibility:hidden}
.cv.no-folder-titles .cv-ftitle,.cv.no-folder-titles .cv-fcount{visibility:hidden}
.cv.searching .cv-card:not(.hit){opacity:.28}
.cv.searching .cv-card.hit{box-shadow:0 0 0 2px var(--accent,#5eead4),0 8px 30px -8px color-mix(in srgb,var(--accent,#5eead4) 60%,transparent)}
.cv-frame.flash{animation:cv-flash 1.6s ease-out}
@keyframes cv-flash{0%,40%{box-shadow:0 0 0 3px var(--fc),0 0 40px 6px color-mix(in srgb,var(--fc) 55%,transparent)}100%{box-shadow:0 0 0 0 transparent}}
.cv.panel-open .vc-tab-r{opacity:0;pointer-events:none}
/* Preview open (desktop, tablet): the bottom bars centre in the space left of
   it, and the zoom dock steps aside rather than sit under it. */
@media (min-width:761px){
  .cv.panel-open .cv-tools,.cv.panel-open .cv-selbar{left:calc((100% - min(380px,100% - 28px) - 14px) / 2)}
  .cv.panel-open .vc-dock,.cv.panel-open .vc>.vc-mini{opacity:0;pointer-events:none}
}
.cv-tools,.cv-selbar{transition:opacity .2s,transform .25s}
.cv.vc-sheet-open .cv-tools,.cv.vc-sheet-open .cv-selbar{opacity:0;pointer-events:none}
/* A drawer open (Regions, Activity): the editing bars step aside so nothing overlaps. */
.cv[data-vc-open=regions] .cv-tools,.cv[data-vc-open=regions] .cv-selbar,.cv[data-vc-open=activity] .cv-tools,.cv[data-vc-open=activity] .cv-selbar{opacity:0;pointer-events:none}

/* help */
.cv-help{left:50%;top:50%;transform:translate(-50%,-50%);width:min(640px,calc(100% - 28px));max-height:calc(100% - 40px);overflow:auto;padding:18px 22px 20px;z-index:40}
.cv-help h3{margin:0 0 4px;font-size:15px}
.cv-help p{margin:0 0 14px;color:var(--cv-muted);font-size:12.5px}
.cv-help .cols{display:grid;grid-template-columns:1fr 1fr;gap:4px 28px}
.cv-help .row{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:4px 0;border-bottom:1px dashed var(--cv-ui-line)}
.cv-help kbd{font:600 11px/1 var(--mono,monospace);padding:3px 6px;border-radius:5px;background:var(--cv-tag);border:1px solid var(--cv-ui-line);margin-left:3px}
.cv-scrim{position:absolute;inset:0;z-index:39;background:rgba(0,0,0,.25)}

@media (max-width:760px){
  /* Phones: the tab bar's raised Brain circle owns the bottom centre, so the
     editing tools stand as a column at the bottom left, level with the zoom
     column at the bottom right. The column stays below the Regions tab
     (mid height) and scrolls on short screens. */
  .cv-tools{left:10px;bottom:10px;transform:none;flex-direction:column;max-height:calc(50% - 80px);overflow-y:auto;overflow-x:hidden;scrollbar-width:none}
  .cv-tools .cv-sep{width:auto;height:1px;align-self:stretch;margin:3px 6px;flex:none}
  .cv-tools .cv-btn{flex:none}
  .cv-tools .cv-zoom{min-width:0;width:32px;padding:0;font-size:10px}
  .cv-tools .wide{display:none}
  .cv .vc-dock{bottom:10px}
  .cv-selbar{bottom:calc(40px + env(safe-area-inset-bottom));max-width:calc(100% - 20px);overflow-x:auto}
  .cv-help .cols{grid-template-columns:1fr}
}
`;
