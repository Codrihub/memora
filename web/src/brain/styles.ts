export const BRAIN_CSS = `
#view-brain{padding:0;overflow:hidden}
.brain{position:absolute;inset:0;overflow:hidden;isolation:isolate;color:var(--fg,#e6e9ef);
  --glass:var(--panel,#12161f);
  --glass-line:color-mix(in srgb,var(--line,#232a38) 80%,transparent);
  background:
    radial-gradient(60% 55% at 52% 48%,color-mix(in srgb,var(--accent,#5eead4) 9%,transparent),transparent 70%),
    radial-gradient(40% 40% at 80% 10%,color-mix(in srgb,var(--accent-2,#7dd3fc) 7%,transparent),transparent 70%),
    var(--bg,#0b0e14)}
:root[data-theme="light"] .brain{
  background:
    radial-gradient(60% 55% at 52% 48%,rgba(13,148,136,.10),transparent 70%),
    radial-gradient(40% 40% at 80% 10%,rgba(3,105,161,.08),transparent 70%),
    var(--bg,#f3f5f9)}
.brain::before{content:"";position:absolute;inset:0;pointer-events:none;
  background-image:radial-gradient(circle,rgba(148,163,184,.28) 1.15px,transparent 1.7px);background-size:24px 24px;background-position:12px 12px}
:root[data-theme="light"] .brain::before{background-image:radial-gradient(circle,rgba(15,23,42,.24) 1.15px,transparent 1.7px)}
:root.no-dots .brain::before{display:none}
.brain-stage{position:absolute;inset:0}
.brain-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;outline:none}
.brain-canvas:active{cursor:grabbing}
.brain.hovering .brain-canvas{cursor:pointer}
.brain-labels{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2}
.brain-labels > div{position:absolute;left:0;top:0;will-change:transform,opacity;white-space:nowrap}
.brain-labels.no-labels .bl-region,.brain-labels.no-labels .bl-note{display:none}
.brain-labels.no-notes .bl-note{display:none}
.brain-labels.no-regions .bl-region{display:none}
.bl-region{font:600 12.5px/1 var(--font);letter-spacing:0;color:var(--c);
  margin:-6px 0 0 0;translate:-50% -50%;text-shadow:0 0 12px color-mix(in srgb,var(--c) 60%,transparent),0 1px 2px rgba(0,0,0,.6);
  transition:opacity .25s}
/* Light theme: hue darkened to at least 4.5:1 contrast. */
:root[data-theme="light"] .bl-region{color:color-mix(in srgb,var(--c) 42%,#0b1220);font-weight:700;
  text-shadow:0 0 2px #fff,0 0 6px rgba(255,255,255,.95),0 1px 0 #fff}
.bl-note{font:500 11px/1.2 var(--font);color:var(--fg,#e6e9ef);opacity:.85;translate:10px -50%;
  text-shadow:0 1px 3px rgba(0,0,0,.85)}
:root[data-theme="light"] .bl-note{opacity:1;color:#1e293b;text-shadow:0 0 2px #fff,0 1px 0 #fff,0 0 6px #fff}
.bl-reticle{width:22px;height:22px;margin:-11px 0 0 -11px}
.bl-reticle::before,.bl-reticle::after{content:"";position:absolute;inset:0;border-radius:50%;border:1.5px solid var(--c,#fff)}
.bl-reticle::before{box-shadow:0 0 12px var(--c,#fff),inset 0 0 6px var(--c,#fff);animation:bl-twitch 1.6s ease-in-out infinite}
.bl-reticle::after{opacity:0;animation:bl-ripple 1.6s cubic-bezier(.2,.6,.3,1) infinite}
.bl-reticle.hidden{display:none}
@keyframes bl-twitch{0%,40%,100%{transform:scale(1)}8%{transform:scale(1.22)}16%{transform:scale(.92)}26%{transform:scale(1.1)}}
@keyframes bl-ripple{0%{transform:scale(.8);opacity:.85;border-width:2px}100%{transform:scale(2.8);opacity:0;border-width:.5px}}
.bl-agent{display:flex;align-items:center;gap:6px;translate:14px -130%;font:600 11px/1 var(--font);
  color:var(--fg,#e6e9ef);padding:3px 8px 3px 3px;border-radius:999px;background:color-mix(in srgb,var(--c) 18%,var(--glass));
  border:1px solid color-mix(in srgb,var(--c) 55%,transparent);box-shadow:0 0 18px color-mix(in srgb,var(--c) 35%,transparent);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.bl-agent.flip{translate:calc(-100% - 14px) -130%}
.bl-agent b{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--c);color:#0b0e14;font-size:9.5px;letter-spacing:.02em}
.bl-agent.busy b{animation:bl-ping 1.1s ease-out infinite}
@keyframes bl-ping{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--c) 70%,transparent)}100%{box-shadow:0 0 0 9px transparent}}

.bh-btn:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:2px}
.bh-btn{all:unset;box-sizing:border-box;cursor:pointer;height:36px;min-width:36px;padding:0 12px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  border:1px solid var(--glass-line);color:var(--muted,#8b98ad);font-size:12px;font-weight:600;background:color-mix(in srgb,var(--bg,#0b0e14) 40%,transparent)}
.bh-btn:hover{color:var(--fg,#e6e9ef)}

.brain-tip{position:absolute;z-index:6;pointer-events:none;max-width:260px;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.4;
  background:var(--ovl-bg);border:1px solid var(--line-strong,var(--glass-line));
  backdrop-filter:var(--ovl-filter);-webkit-backdrop-filter:var(--ovl-filter);color:var(--fg,#e6e9ef);
  box-shadow:none;transform:translate(14px,14px)}
.brain-tip.hidden{display:none}
.brain-tip b{display:block;font-size:13px;margin-bottom:2px;word-break:break-word}
.brain-tip .bt-f{display:flex;align-items:center;gap:6px;color:var(--muted,#8b98ad)}
.brain-tip .bt-f i{width:8px;height:8px;border-radius:50%;background:var(--c);box-shadow:0 0 6px var(--c)}
.brain-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.brain-tags span{font-size:10.5px;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,var(--accent,#5eead4) 14%,transparent);color:var(--accent,#5eead4)}

.brain-foot{position:absolute;left:50%;bottom:18px;translate:-50% 0;z-index:3;font-size:11px;color:var(--muted,#8b98ad);pointer-events:none;white-space:nowrap}
.brain-hint{transition:opacity 1s}
.brain-hint.gone{opacity:0}
.brain-msg{position:absolute;inset:0;display:grid;place-items:center;text-align:center;color:var(--muted,#8b98ad);font-size:13.5px;z-index:3;padding:24px}
.brain-msg .bh-btn{margin-top:12px}

@media (max-width:760px){
  .brain-foot{display:none}
}
@media (prefers-reduced-motion:reduce){
  .bl-reticle::before,.bl-reticle::after,.bl-agent.busy b{animation:none}
}
`;
