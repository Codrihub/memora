// Kanban board styles: one board in three densities (its own page, embedded in a note, in Mnemo's
// chat), theme tokens only (light and dark follow), logical properties (RTL). Lanes sit side by side
// and scroll sideways, with an edge fade on a side only while there is more that way; a narrow board
// (a phone, a narrow chat) snaps one lane at a time and shows a row of lane dots.

export const KANBAN_CSS = `
/* A board's own page sits in the same frame as a note: the same gutters, paper padding and title
   place, so moving between a note and a board never shifts the page. The paper is see-through and
   the board runs the full width of the pane, its first lane lined up with the title and its scroll
   area (with the fades) reaching the edge of the pane. */
.vx-page.kb-mode{overflow-x:clip}
.vx-page.kb-mode .vx-paper{background:none;border-color:transparent;box-shadow:none}
.kb-host{min-width:0;margin-top:28px}
.vx-page.kb-mode .kb-host{width:100cqi;margin-inline:calc(50% - 50cqi)}
.vx-page.kb-mode .kb{--kb-start:max(calc(var(--vx-gut) + var(--vx-px)),calc((100cqi - var(--rw)) / 2))}
.vx-page.kb-mode :is(.kb-bar,.kb-dots,.kb-archive,.kb-empty){margin-inline:var(--kb-start)}
.vx-page.kb-mode .kb-lanes{padding-inline:var(--kb-start);scroll-padding-inline:var(--kb-start)}

:where(.kb) svg{width:16px;height:16px}
.kb{--kb-lane-w:280px;--kb-gap:12px;--kb-lane-max:max(420px,calc(100dvh - 220px));
  position:relative;min-width:0;container:kb/inline-size}
.kb-embed{--kb-gap:10px;--kb-lane-max:min(520px,70dvh)}
.kb-chat{--kb-gap:8px;--kb-lane-max:min(380px,60dvh)}
.kb-bar[hidden]{display:none}
.kb-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 12px;min-height:34px}
.kb-embed .kb-bar,.kb-chat .kb-bar{margin-bottom:8px;min-height:30px}
.kb-chat .kb-bar .vx-ct-btn,.kb-embed .kb-bar .vx-ct-btn{height:30px}
.kb-stats{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums;padding-inline:4px}
.kb-pill{font-size:11px;font-weight:650;line-height:18px;padding:0 6px;border-radius:9px;background:var(--surface-2);color:var(--text-2)}

/* Lanes: one row that scrolls sideways on its own (the page never does). */
.kb-scroll{position:relative;min-width:0}
.kb-lanes{display:flex;align-items:flex-start;gap:var(--kb-gap);overflow-x:auto;overscroll-behavior-x:contain;padding:4px 2px 12px;
  scroll-padding-inline:36px}
.kb-lanes,.kb-cards{--fade:28px}
/* A drag never has a faded edge over it. */
.kb-dragging :is(.kb-lanes,.kb-cards){-webkit-mask-image:none!important;mask-image:none!important}

.kb-lane{flex:0 0 var(--kb-lane-w);width:var(--kb-lane-w);max-width:calc(100cqi - 24px);display:flex;flex-direction:column;
  background:var(--surface-2);border:1px solid var(--line);border-radius:14px;min-height:96px;max-height:var(--kb-lane-max);
  transition:box-shadow .15s,border-color .15s,background .15s}
.kb-chat .kb-lane,.kb-embed .kb-lane{border-radius:12px;min-height:84px}
.kb-lane.kb-over{border-color:var(--accent-line);box-shadow:0 0 0 3px var(--accent-soft)}
.kb-lane.complete .kb-lane-title{color:var(--text-2)}
/* The lane header stays on top: only the cards under it scroll. */
.kb-lane-head{display:flex;align-items:center;gap:6px;padding:8px 6px 6px 12px;padding-inline:12px 6px;cursor:grab;
  user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;border-radius:14px 14px 0 0;background:var(--surface-2)}
.kb-chat .kb-lane-head,.kb-embed .kb-lane-head{padding-block:6px 4px}
.kb-lane-title{flex:1 1 auto;min-width:0;margin:0;font-size:13.5px;font-weight:650;color:var(--fg);letter-spacing:.01em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:28px}
.kb-done-mark{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--accent-soft);color:var(--accent);flex:none}
.kb-done-mark svg{width:11px;height:11px}
.kb-count{font-size:11.5px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums;background:var(--panel);
  border:1px solid var(--line);border-radius:9px;padding:0 7px;line-height:18px;flex:none}
.kb-count.over{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 45%,transparent)}
.kb-lane-more{width:28px;height:28px}

.kb-cards{display:flex;flex-direction:column;gap:7px;padding:4px 8px 4px;overflow-y:auto;min-height:12px;flex:1 1 auto}
/* An empty lane says what it is for. */
.kb-none{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:72px;margin:2px 0 4px;padding:10px;
  font-size:12px;line-height:1.4;color:var(--text-3,var(--muted));text-align:center;border:1.5px dashed var(--line-strong);border-radius:10px}
.kb-none .vx-i{width:18px;height:18px;opacity:.7}
.kb-lane-foot{padding:4px 8px 8px}
.kb-add{display:flex;align-items:center;gap:7px;width:100%;height:34px;padding-inline:8px;border:0;border-radius:9px;background:none;
  color:var(--muted);font:inherit;font-size:13px;cursor:pointer;text-align:start;transition:background .15s,color .15s}
.kb-add:hover{background:var(--hover);color:var(--fg)}
.kb-add:focus-visible,.kb-add-lane:focus-visible,.kb-card:focus-visible,.kb-check:focus-visible,.kb-dot:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.kb-add-lane{flex:0 0 auto;display:inline-flex;align-items:center;gap:8px;height:44px;padding-inline:14px 16px;border:1.5px dashed var(--line-strong);
  border-radius:14px;background:none;color:var(--muted);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s,border-color .15s}
.kb-chat .kb-add-lane,.kb-embed .kb-add-lane{height:38px;border-radius:12px}
.kb-add-lane:hover{background:var(--hover);color:var(--fg);border-color:var(--accent-line)}

.kb-mark{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;flex:none;color:var(--board-c,var(--accent));
  background:color-mix(in srgb,var(--board-c,var(--accent)) 15%,transparent)}
.kb-mark .i{width:15px;height:15px}
.kb-emo{font-size:14px;line-height:1}
.kb-style{display:flex;flex-direction:column;gap:10px}
.kb-style .cf-k{font-size:12.5px;font-weight:650;color:var(--text-2)}
.kb-ico-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(40px,1fr));gap:6px}
.kb-ico-o{display:grid;place-items:center;height:40px;border:1px solid var(--line);border-radius:10px;background:var(--surface-1);color:var(--text-2);cursor:pointer}
.kb-ico-o .i{width:18px;height:18px}
.kb-ico-o:hover{background:var(--hover)}
.kb-ico-o[aria-checked=true]{border-color:var(--accent);background:var(--accent-soft);color:var(--fg)}
.kb-ico-o:focus-visible{outline:2px solid var(--accent);outline-offset:1px}

/* Colours of cards and lanes come from the board look (web/src/views/board-look.ts). */
/* A card's checklist: done of all, with a thin bar. */
.kb-steps{position:absolute;inset-inline-end:34px;top:9px;display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;pointer-events:none}
.kb-steps i{display:block;width:28px;height:4px;border-radius:2px;overflow:hidden;background:var(--surface-2)}
.kb-steps u{display:block;height:100%;border-radius:2px;background:var(--accent)}
.kb-steps b{font-weight:600}
.kb-card:has(.kb-steps) .kb-body>:first-child{padding-inline-end:58px}

/* Lane dots: shown while the lanes do not all fit; the lane in view is the long one. */
.kb-dots{display:none;justify-content:center;flex-wrap:wrap;gap:0;margin:-2px 0 4px}
.kb.kb-over .kb-dots{display:flex}
.kb-dot{display:grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:none;cursor:pointer}
.kb-dot i{display:block;width:6px;height:6px;border-radius:3px;background:var(--line-strong);transition:width .2s,background .2s}
.kb-dot[aria-current=true] i{width:16px;background:var(--accent)}
.kb-dot:hover i{background:var(--muted)}
.kb-dot[aria-current=true]:hover i{background:var(--accent)}

.kb-card{position:relative;display:flex;align-items:flex-start;gap:8px;padding:9px 6px 9px 10px;padding-inline:10px 6px;background:var(--surface-1);
  color:var(--fg);border:1px solid var(--line);border-radius:10px;cursor:grab;user-select:none;-webkit-user-select:none;
  -webkit-touch-callout:none;transition:border-color .15s,box-shadow .15s,opacity .15s,transform .15s;outline:none;min-width:0}
.kb-chat .kb-card,.kb-embed .kb-card{padding-block:7px}
.kb-card:hover{border-color:var(--line-strong)}
.kb-card.done .kb-body{color:var(--muted)}
.kb-card.done .kb-body>p:first-child{text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--muted) 60%,transparent)}
.kb-card.late:not(.done){border-inline-start:3px solid var(--warn)}
.kb-card.kb-armed{transform:scale(1.02);box-shadow:0 6px 20px rgba(0,0,0,.18)}
.kb-card.kb-flash{animation:kb-flash 1.6s ease-out}
.kb-lane:focus{outline:none}
.kb-lane:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
@keyframes kb-flash{0%{box-shadow:0 0 0 3px var(--accent-line);border-color:var(--accent)}100%{box-shadow:0 0 0 0 transparent}}
.kb-check{flex:none;display:inline-grid;place-items:center;width:18px;height:18px;margin-top:1px;border-radius:5px;padding:0;
  border:1.5px solid var(--line-strong);background:var(--panel);color:transparent;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
.kb-check svg{width:12px;height:12px}
.kb-check:hover{border-color:var(--accent)}
.kb-check[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.kb-body{flex:1 1 auto;min-width:0;font-size:13.5px;line-height:1.55;overflow-wrap:anywhere}
.kb-chat .kb-body{font-size:13px}
.kb-body>*{margin:0}
.kb-body>*+*{margin-top:6px}
.kb-body ul,.kb-body ol{padding-inline-start:18px}
.kb-body li.kb-sub{list-style:none;margin-inline-start:-18px;display:flex;align-items:baseline;gap:6px}
.kb-body li.kb-sub input{flex:none;margin:0;accent-color:var(--accent);transform:translateY(1px)}
.kb-body li.kb-sub.done{color:var(--muted);text-decoration:line-through}
.kb-body code{font-family:var(--mono);font-size:12px;background:var(--surface-2);border-radius:4px;padding:0 4px}
.kb-body img{max-width:100%;border-radius:6px}
.kb-body a:not(.ch){color:var(--accent);text-decoration:none;cursor:pointer}
.kb-body a:not(.ch):hover{text-decoration:underline}
.kb-chip{display:inline-flex;align-items:center;gap:4px;height:22px;box-sizing:border-box;font-size:11.5px;font-weight:600;line-height:1;padding:0 7px;
  border:1px solid transparent;border-radius:7px;background:var(--surface-2);color:var(--text-2);vertical-align:-5px;margin-block:1px;white-space:nowrap}
@media (hover:none){.kb-chip{height:24px}}
.kb-chip svg{width:12px;height:12px}
.kb-chip.late{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
.kb-chip.today{background:color-mix(in srgb,var(--warn) 8%,transparent);color:color-mix(in srgb,var(--warn) 70%,var(--fg))}
.kb-more{width:26px;height:26px;margin-top:-3px;opacity:0;transition:opacity .15s}
.kb-card:hover .kb-more,.kb-card:focus-within .kb-more,.kb-card:focus-visible .kb-more{opacity:1}
@media (hover:none){.kb-more{opacity:.7}}
.kb-card-acts{display:flex;gap:2px;flex:none;margin-top:-3px}
.kb-card-acts .vx-icon-btn{width:28px;height:28px}


.kb-empty{display:flex;align-items:center;gap:14px;padding:22px;border:1.5px dashed var(--line-strong);border-radius:14px;color:var(--text-2);margin-bottom:12px}
.kb-empty .vx-i{width:28px;height:28px;color:var(--accent)}
.kb-empty p{margin:0;font-size:13.5px;line-height:1.55}

.kb-archive{margin-top:14px;border:1px solid var(--line);border-radius:14px;background:var(--surface-2);padding:12px}
.kb-archive>header{display:flex;flex-direction:column;gap:2px;margin:0 4px 10px}
.kb-archive>header small{color:var(--muted);font-size:12px}
.kb-archive-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.kb-archive .kb-card{cursor:default;opacity:.85}
.kb-quote{margin:12px 0 0;padding:8px 12px;border-inline-start:3px solid var(--line-strong);color:var(--text-2);font-size:13.5px}

/* Dragging: the card or lane stays as a dashed slot where it would land; a lifted copy follows the pointer. */
.kb-dragging{cursor:grabbing}
.kb-dragging .kb-card,.kb-dragging .kb-lane-head{cursor:grabbing}
.kb-src{opacity:.35;border-style:dashed !important;box-shadow:none !important}
.kb-src>*{visibility:hidden}
.kb-lane.kb-src{opacity:.5}
.kb-ghost{position:fixed;z-index:9000;pointer-events:none;margin:0;opacity:.96;transform-origin:30% 30%;
  box-shadow:0 18px 40px rgba(0,0,0,.28),0 3px 10px rgba(0,0,0,.16);overflow:hidden;will-change:transform}
.kb-ghost.kb-lane{overflow:hidden}
body.kb-nosel{user-select:none;-webkit-user-select:none;cursor:grabbing}

.kb-sk .kb-lane-head{cursor:default}
.kb-sk-card{flex-direction:column;gap:8px;cursor:default;margin:0 8px 7px}

@media (prefers-reduced-motion:reduce){.kb-card,.kb-lane,.kb-check,.kb-dot i{transition:none}.kb-card.kb-flash{animation:none}}

/* A narrow board (a phone, a narrow chat or note): one lane per screen, snapping, bigger touch targets. */
@container kb (max-width:560px){
  .kb-lanes{scroll-snap-type:x mandatory;scroll-padding-inline:2px}
  .kb-lane{flex-basis:min(var(--kb-lane-w),calc(100cqi - 40px));width:min(var(--kb-lane-w),calc(100cqi - 40px));scroll-snap-align:start}
  .kb-dragging .kb-lanes{scroll-snap-type:none}
  .kb-add-lane{scroll-snap-align:start}
  .kb-card{padding-block:10px}
  .kb-check{width:22px;height:22px}
  .kb-more{width:32px;height:32px}
  .kb-dot{width:26px;height:28px}
  .kb-steps{inset-inline-end:42px;top:11px}
}

/* Phones: the board page's lanes are a little shorter, under the reader bar. */
@container vxnote (max-width:760px){
  .kb-lanes{scroll-snap-type:x mandatory}
  .kb-lane,.kb-add-lane{scroll-snap-align:start}
  .kb-dragging .kb-lanes{scroll-snap-type:none}
  .vx-page.kb-mode .kb-lane{max-height:calc(100dvh - 210px)}
}

`;
