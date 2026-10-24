// Vault UI styles (theme tokens only; light theme overrides at the end).

export const VAULT_CSS = `
#view-vault.vx-view{padding:0;overflow:hidden}
.vx-i{width:16px;height:16px;flex:none;display:inline-block;vertical-align:-3px}
.vx-grow{flex:1 1 auto}
.vx-muted{color:var(--muted);font-size:13px;margin:8px 0}
.vx-emoji{font-size:14px;line-height:1;width:16px;text-align:center;display:inline-block}

/* ── shell: optional tree | main (browser or reader) ───────────── */
.vx-shell{position:absolute;inset:0;display:grid;grid-template-columns:var(--tree-w,264px) 1px minmax(0,1fr);min-height:0}
.vx-shell.no-tree{grid-template-columns:minmax(0,1fr)}
.vx-shell.no-tree>.vx-pane-tree,.vx-shell.no-tree>.vx-resizer{display:none}
.vx-shell.resizing{cursor:col-resize;user-select:none}
.vx-pane{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;position:relative}
.vx-pane-tree{background:var(--panel);overflow:auto;padding:8px 6px 40px}
.vx-resizer{cursor:col-resize;background:var(--line);width:1px;position:relative;outline:none}
.vx-resizer::after{content:"";position:absolute;inset:0 -3px;transition:background .15s}
.vx-resizer:hover::after,.vx-resizer:focus-visible::after{background:color-mix(in srgb,var(--accent) 45%,transparent)}
.vx-main{position:relative;min-width:0;min-height:0;background:var(--bg)}
.vx-main>.vx-pane{position:absolute;inset:0;background:var(--bg);transition:opacity .16s var(--ease)}
/* One layer at a time; the hidden one keeps its scroll position. */
.vx-shell[data-pane=note] .vx-pane-list,.vx-shell:not([data-pane=note]) .vx-pane-note{visibility:hidden;opacity:0;pointer-events:none}
.vx-pane-list{container-type:inline-size;container-name:vxlist}
.vx-pane-note{container-type:inline-size;container-name:vxnote}

/* ── icon buttons, crumbs ──────────────────────────────────────── */
.vx-icon-btn{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:8px;border:0;
  background:none;color:var(--muted);cursor:pointer;flex:none;transition:background .15s,color .15s}
.vx-icon-btn:hover{background:var(--hover);color:var(--fg)}
.vx-icon-btn.on{color:var(--warn)}
.vx-icon-btn.vx-round{border-radius:50%}
.vx-icon-btn:focus-visible,.vx-row:focus-visible,.vx-note:focus-visible,.vx-pin:focus-visible,.vx-tile:focus-visible,
.vx-crumb:focus-visible,.vx-link:focus-visible,.vx-tag:focus-visible,.vx-meta-folder:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.vx-crumbs{display:flex;align-items:center;gap:2px;min-width:0;overflow:hidden;flex:0 1 auto}
.vx-crumb{display:inline-flex;align-items:center;border:0;background:none;color:var(--muted);font:inherit;font-size:13px;
  height:28px;padding:0 6px;border-radius:var(--r-xs);cursor:pointer;white-space:nowrap;min-width:0;flex:0 1 auto}
.vx-crumb span{overflow:hidden;text-overflow:ellipsis}
.vx-crumb:hover{background:var(--hover);color:var(--fg)}
.vx-crumb.vx-drop-into{background:var(--accent-soft);color:var(--fg)}
.vx-crumb-sep{color:var(--text-3);font-size:12px;flex:none}

/* ── tree ──────────────────────────────────────────────────────── */
.vx-treehost{font-size:13px;user-select:none}
.vx-sec{margin-bottom:10px;border-radius:10px;transition:background .15s,box-shadow .15s}
.vx-sec-head{display:flex;align-items:center;gap:6px;padding:6px 8px 4px;color:var(--muted);font-size:11.5px;
  font-weight:650;letter-spacing:.08em;text-transform:uppercase}
.vx-sec-title{display:flex;align-items:center;gap:6px;flex:1}
.vx-sec-title .vx-i{width:13px;height:13px}
.vx-fold{cursor:pointer;height:32px;padding:0 4px 0 10px;margin:0 2px;border-radius:9px;transition:background .15s,color .15s}
.vx-fold:hover{background:var(--hover);color:var(--fg)}
.vx-fold:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.vx-fold .vx-sec-title{gap:7px}
.vx-fold-caret{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:7px;transition:transform .25s cubic-bezier(.2,.8,.2,1);transform:rotate(90deg)}
.vx-fold-caret .vx-i,.vx-fold-caret svg{width:12px;height:12px}
.folded .vx-fold-caret{transform:none}
.vx-fold .vx-sec-acts{opacity:0;pointer-events:none;transition:opacity .15s}
.vx-fold:hover .vx-sec-acts,.vx-fold:focus-within .vx-sec-acts{opacity:1;pointer-events:auto}
.folded .vx-fold .vx-sec-acts{display:none}
@media (hover:none){.vx-fold .vx-sec-acts{opacity:1;pointer-events:auto}}
.vx-sec-body{display:grid;grid-template-rows:1fr;transition:grid-template-rows .3s cubic-bezier(.2,.8,.2,1),opacity .22s}
.vx-sec.folded .vx-sec-body{grid-template-rows:0fr;opacity:0}
.vx-sec-inner{min-height:0;overflow:hidden}
@media (prefers-reduced-motion:reduce){.vx-sec-body,.vx-fold-caret{transition:none}}
.vx-sec-count{font-size:11px;font-weight:600;background:var(--surface-2);border-radius:6px;padding:0 6px;letter-spacing:0;line-height:18px}
.vx-sec-acts{display:flex;gap:2px}
.vx-sec-acts .vx-icon-btn{width:24px;height:24px}

.vx-pin-list{display:flex;flex-direction:column;gap:1px;padding:0 2px}
.vx-pin-empty{display:flex;align-items:center;justify-content:center;gap:6px;font-size:11.5px;color:var(--muted);padding:9px 10px;
  border:1.5px dashed var(--line-strong);border-radius:9px;margin:4px 4px 2px;text-align:center;transition:border-color .15s,background .15s,color .15s}
.vx-pin-empty.slim{padding:6px 10px;font-size:11px;display:none}
body.vx-dragging .vx-pin-empty.slim,body.vx-pdrag .vx-pin-empty.slim{display:flex}
.vx-pin-empty svg{width:13px;height:13px;flex:none}
/* Dragging over Pinned lights only the slot; a drop anywhere on the section still pins. */
.vx-drop-zone .vx-pin-empty,body.vx-dragging .vx-pins .vx-pin-empty{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.vx-pin{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;cursor:pointer;position:relative;min-height:34px}
.vx-pin:hover{background:var(--hover)}
.vx-pin.active{background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line);font-weight:600}
.vx-pin.missing{cursor:default}
.vx-pin.missing .vx-pin-ico,.vx-pin.missing .vx-pin-name{opacity:.5}
.vx-pin.missing .vx-pin-x{opacity:1}
.vx-pin-sub.vx-pin-miss{color:var(--warn);font-weight:600;max-width:none;flex:none}
.vx-pin-ico{display:inline-flex}
.vx-pin-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-pin-sub{font-size:11.5px;color:var(--muted);max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-pin-x{opacity:0;border:0;background:none;color:var(--muted);cursor:pointer;padding:2px;border-radius:5px;display:inline-flex}
.vx-pin-x .vx-i{width:13px;height:13px}
.vx-pin:hover .vx-pin-x,.vx-pin:focus-within .vx-pin-x{opacity:1}
.vx-pin-x:hover{color:var(--danger);background:var(--panel)}
.vx-drop-before::before,.vx-drop-after::after{content:"";position:absolute;left:6px;right:6px;height:2px;border-radius:2px;
  background:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 25%,transparent)}
.vx-drop-before::before{top:-1px}
.vx-drop-after::after{bottom:-1px}

.vx-tree{display:flex;flex-direction:column;outline:none}
.vx-row{display:flex;align-items:center;gap:7px;height:34px;padding:0 6px 0 calc(6px + var(--depth,0) * 14px);
  border-radius:8px;cursor:pointer;position:relative;color:var(--text-2);transition:background .12s,color .12s}
.vx-row:hover{background:var(--hover);color:var(--fg)}
.vx-row.sel,.vx-row.active{background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line);color:var(--fg)}
.vx-row.sel .vx-fname,.vx-row.active .vx-fname{font-weight:600}
.vx-row.root{margin-bottom:2px}
.vx-twist{width:16px;height:16px;display:grid;place-items:center;color:var(--muted);flex:none;border-radius:4px}
.vx-twist.none{visibility:hidden}
.vx-twist .vx-caret{width:12px;height:12px;transition:transform .2s var(--ease)}
.vx-row[aria-expanded=true] .vx-caret{transform:rotate(90deg)}
.vx-twist:hover{background:var(--panel)}
.vx-fico{display:inline-flex;color:var(--fc)}
.vx-nico{display:inline-flex;color:var(--muted)}
.vx-nico .vx-i{width:14px;height:14px}
.vx-fname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-count{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums;min-width:18px;text-align:right}
.vx-row-more{opacity:0;border:0;background:none;color:var(--muted);cursor:pointer;padding:2px;border-radius:5px;display:inline-flex}
.vx-row:hover .vx-row-more,.vx-row:focus-visible .vx-row-more,.vx-note:hover .vx-row-more,.vx-note:focus-visible .vx-row-more{opacity:1}
/* The count and the "more" button share one stacked slot, so hovering never shifts the row. */
.vx-end{flex:none;margin-left:auto;display:grid;align-items:center;justify-items:end;min-width:24px;height:22px}
.vx-end>*{grid-area:1/1}
.vx-row .vx-count{min-width:22px;padding-right:4px;box-sizing:border-box}
.vx-row .vx-row-more{width:22px;height:22px;padding:0;align-items:center;justify-content:center;opacity:0;pointer-events:none}
.vx-row:hover .vx-count,.vx-row:focus-visible .vx-count,.vx-row:focus-within .vx-count{visibility:hidden}
.vx-row:hover .vx-row-more,.vx-row:focus-visible .vx-row-more,.vx-row:focus-within .vx-row-more{opacity:1;pointer-events:auto}
.vx-row-more:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
/* Touch screens have no hover: the button is always there, next to the count. */
@media (hover:none){
  .vx-end{display:flex;gap:2px;height:auto}
  .vx-row .vx-count{visibility:visible!important}
  .vx-row .vx-row-more{opacity:1;pointer-events:auto;width:32px;height:32px}
}
.vx-row-more:hover{background:var(--panel);color:var(--fg)}
@keyframes vxPulse{50%{box-shadow:0 0 0 5px transparent}}
.vx-kids{overflow:hidden;height:0;transition:height .28s cubic-bezier(.32,.72,0,1)}
.vx-zoop{animation:vxZoop .42s cubic-bezier(.34,1.56,.64,1)}
@keyframes vxZoop{0%{transform:translateX(0) scaleY(1)}30%{transform:translateX(-5px) scaleY(.88)}65%{transform:translateX(2px) scaleY(1.04)}100%{transform:none}}
@media (prefers-reduced-motion:reduce){.vx-zoop{animation:none}}
.vx-kids.open{height:auto}
.vx-row.vx-drop-into{background:color-mix(in srgb,var(--accent) 18%,transparent);box-shadow:inset 0 0 0 1.5px var(--accent)}
.vx-dragsrc{opacity:.45}
/* pointer drag (drag.ts) */
.vx-treehost{-webkit-touch-callout:none}
body.vx-pdrag,body.vx-pdrag *{cursor:grabbing!important;user-select:none;-webkit-user-select:none}
body.vx-pdrag-no,body.vx-pdrag-no *{cursor:not-allowed!important}
body.vx-pdrag .vx-row:hover:not(.vx-drop-into):not(.vx-drop-near):not(.vx-drop-no){background:none}
.vx-row.vx-drop-near{background:color-mix(in srgb,var(--accent) 9%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 45%,transparent)}
.vx-row.vx-drop-no{background:color-mix(in srgb,var(--danger) 8%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--danger) 45%,transparent)}
.vx-pghost{position:fixed;left:0;top:0;z-index:10000;pointer-events:none;display:flex;flex-direction:column;gap:3px;max-width:min(280px,calc(100vw - 24px));
  padding:7px 11px 7px 9px;border-radius:11px;background:var(--panel);color:var(--fg);border:1px solid var(--line-strong);
  box-shadow:none;font:600 12.5px/1.35 system-ui,sans-serif;
  animation:vxLift .16s cubic-bezier(.2,.8,.2,1);will-change:transform}
@keyframes vxLift{from{opacity:0;scale:.92}to{opacity:1;scale:1}}
.vx-pghost.touch{font-size:13.5px;padding:9px 13px 9px 11px}
.vx-pghost-main{display:flex;align-items:center;gap:7px;min-width:0}
.vx-pghost-main .vx-i{width:15px;height:15px;flex:none;color:var(--accent)}
.vx-pghost-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-pghost-hint{font-size:11px;font-weight:550;color:var(--muted);padding-left:22px}
.vx-pghost.ok{border-color:color-mix(in srgb,var(--accent) 55%,var(--line-strong))}
.vx-pghost.ok .vx-pghost-hint{color:var(--accent)}
.vx-pghost.no .vx-pghost-hint{color:var(--danger)}
.vx-pghost.no .vx-pghost-hint::before{content:"⊘ "}
.vx-opening .vx-fico{animation:vxLid .6s cubic-bezier(.3,.7,.4,1) forwards}
@keyframes vxLid{0%{transform:none}35%{transform:translateY(-1px) rotate(-9deg) scale(1.12)}70%{transform:translateY(-1px) rotate(4deg) scale(1.16)}100%{transform:scale(1.18)}}
@media (prefers-reduced-motion:reduce){.vx-pghost{animation:none}.vx-opening .vx-fico{animation:none;transform:scale(1.15)}}
/* Rows past the indent cap show a level badge in place of one indent step. */
.vx-row.deep{padding-left:calc(var(--depth,0) * 14px - 14px)}
.vx-lvl{flex:none;display:inline-grid;place-items:center;min-width:17px;height:15px;padding:0 4px;box-sizing:border-box;border-radius:5px;
  font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--muted);background:var(--panel-2);border:1px solid var(--line);margin-right:-2px}
.vx-mv{display:grid;gap:6px}
.vx-mv-row{display:grid;grid-template-columns:44px minmax(0,1fr);align-items:baseline;gap:8px}
.vx-mv-k{font-size:11px;font-weight:650;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.vx-mv-p{font-size:12.5px;padding:5px 8px;border-radius:7px;background:var(--panel-2);overflow-wrap:anywhere}
.vx-mv-p.to{background:var(--accent-soft);color:var(--fg)}
.vx-ghost{position:fixed;top:-100px;left:-100px;padding:5px 11px;border-radius:8px;background:var(--accent);color:#04201c;
  font:600 12px/1.4 system-ui,sans-serif;box-shadow:none;pointer-events:none}
.vx-rename{width:100%;font:inherit;font-size:13px;padding:3px 6px;border-radius:6px;border:1px solid var(--accent);
  background:var(--bg);color:var(--fg);outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}

/* ── folder browser ────────────────────────────────────────────── */
.vx-bscroll{position:absolute;inset:0;overflow:auto;outline:none;background:var(--surface-0)}
.vx-browse{max-width:1200px;margin:0 auto;padding:32px 32px 88px}
.vx-phead{display:flex;flex-direction:column;gap:14px}
.vx-phead .vx-crumbs{margin-left:-6px}
.vx-phead .vx-crumb.cur{color:var(--text-2);font-weight:500;cursor:default}
.vx-phead .vx-crumb.cur:hover{background:none}
.vx-up{width:28px;height:28px;margin-right:2px}
.vx-up .vx-i{width:15px;height:15px}
.vx-btitle{display:flex;align-items:center;gap:16px;min-width:0}
.vx-bico{display:grid;place-items:center;flex:none;width:48px;height:48px;border-radius:13px;color:var(--fc);
  background:color-mix(in srgb,var(--fc) 12%,var(--surface-1));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fc) 24%,transparent)}
.vx-bico .vx-i{width:22px;height:22px;stroke-width:1.7}
.vx-bico .vx-emoji{font-size:22px;width:24px}
.vx-bico.brand{background:linear-gradient(180deg,#17202e,#0b0f17);color:#5eead4;box-shadow:inset 0 0 0 1px rgba(94,234,212,.16)}
.vx-btext{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.vx-btext h1{margin:0;font-size:26px;font-weight:650;letter-spacing:-.02em;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-bmeta{margin:0;color:var(--muted);font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.vx-dot-sep{margin:0 8px;color:var(--text-3)}
.vx-bacts{display:flex;align-items:center;gap:8px;flex:none}
.vx-bacts .btn{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 16px;border-radius:10px;font-size:13.5px;font-weight:600}
.vx-bacts .btn.ghost{padding:0 12px}
.vx-bacts .vx-i{width:16px;height:16px}
.vx-bacts .vx-round{width:38px;height:38px;border:1px solid var(--line);background:var(--surface-1)}
.vx-bacts .vx-round:hover{border-color:var(--line-strong)}
@media (max-width:360px){.vx-bacts .btn.primary span{display:none}.vx-bacts .btn.primary{padding-left:11px;padding-right:11px}}
.vx-tempty{pointer-events:none;color:var(--muted);font-size:12.5px;font-style:italic}

.vx-tbar{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-top:28px}
.vx-search{display:flex;align-items:center;gap:9px;flex:1 1 100%;min-width:0;height:40px;padding:0 4px 0 13px;border-radius:10px;cursor:text;
  border:1px solid transparent;background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--muted);transition:border-color .15s,background .15s,box-shadow .15s}
.vx-search:hover{border-color:var(--line)}
.vx-search .vx-i{width:16px;height:16px;flex:none}
.vx-search:focus-within{border-color:var(--line-strong);background:var(--surface-1);box-shadow:0 0 0 3px color-mix(in srgb,var(--fg) 6%,transparent);color:var(--fg)}
.vx-search input{flex:1;min-width:0;border:0;background:none;color:var(--fg);font:inherit;font-size:14px;outline:none;height:100%;padding:0}
.vx-search input::placeholder{color:var(--muted)}
.vx-search input:focus,.vx-search input:focus-visible{box-shadow:none;outline:none;border-radius:0}
.vx-search input::-webkit-search-cancel-button{display:none}
.vx-search-x{display:none;flex:none;place-items:center;width:32px;height:32px;border:0;background:none;border-radius:8px;color:var(--muted);cursor:pointer}
.vx-search-x .vx-i{width:14px;height:14px}
.vx-search.has .vx-search-x{display:grid}
.vx-search-x:hover{background:var(--hover);color:var(--fg)}
.vx-tabs{position:relative;display:inline-grid;grid-template-columns:1fr 1fr;flex:none;height:36px;padding:3px;border-radius:10px;
  background:var(--seg-track,var(--surface-2));box-sizing:border-box;--i:1}
.vx-tabs-pill{position:absolute;top:3px;bottom:3px;left:3px;width:calc(50% - 3px);border-radius:7px;background:var(--seg-thumb,var(--surface-1));
  box-shadow:0 1px 2px rgba(15,23,42,.08),0 0 0 1px var(--line);transform:translateX(calc(var(--i) * 100%));transition:transform .24s var(--ease-out)}
.vx-tabs button{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:7px;height:30px;padding:0 14px;border:0;background:none;
  border-radius:7px;font:inherit;font-size:13.5px;font-weight:550;color:var(--muted);cursor:pointer;transition:color .2s}
.vx-tabs button b{font-size:12px;font-weight:500;color:var(--text-3);font-variant-numeric:tabular-nums}
.vx-tabs button:hover{color:var(--fg)}
.vx-tabs button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.vx-tabs button[aria-selected=true]{color:var(--fg)}
.vx-tabs button[aria-selected=true] b{color:var(--muted)}
.vx-tabbody{transition:opacity .14s var(--ease),transform .14s var(--ease)}
.vx-tabbody.out-left{opacity:0;transform:translateX(-16px)}
.vx-tabbody.out-right{opacity:0;transform:translateX(16px)}
.vx-tabbody.in-right{animation:vxTabR .24s var(--ease-out)}
.vx-tabbody.in-left{animation:vxTabL .24s var(--ease-out)}
@keyframes vxTabR{from{opacity:0;transform:translateX(18px)}}
@keyframes vxTabL{from{opacity:0;transform:translateX(-18px)}}
@media (prefers-reduced-motion:reduce){.vx-tabs-pill,.vx-tabbody{transition:none;animation:none}.vx-tabbody.out-left,.vx-tabbody.out-right{opacity:1;transform:none}}
.vx-pills{display:flex;gap:6px;min-width:0;overflow-x:auto;scrollbar-width:none;padding:2px 0}
.vx-pills::-webkit-scrollbar{display:none}
.vx-pill{flex:none;height:32px;padding:0 14px;border-radius:99px;border:1px solid var(--line-strong);background:none;color:var(--text-2);
  font:inherit;font-size:13px;font-weight:550;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s,border-color .15s}
.vx-pill:hover{background:var(--hover);color:var(--fg)}
.vx-pill[aria-pressed=true]{background:var(--fg);border-color:var(--fg);color:var(--surface-0)}
.vx-pill:focus-visible,.vx-seg button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.vx-seg{display:inline-flex;flex:none;gap:2px;height:36px;padding:3px;border-radius:10px;background:var(--seg-track,var(--surface-2));box-sizing:border-box}
.vx-seg button{display:grid;place-items:center;width:34px;height:30px;border:0;border-radius:7px;background:none;color:var(--muted);cursor:pointer;transition:color .15s,background .15s}
.vx-seg button .vx-i{width:16px;height:16px}
.vx-seg button:hover{color:var(--fg)}
.vx-seg button[aria-pressed=true]{background:var(--seg-thumb,var(--surface-1));color:var(--fg);box-shadow:0 1px 2px rgba(15,23,42,.08),0 0 0 1px var(--line)}

.vx-bsec{margin-top:20px}
.vx-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.vx-tile{display:flex;align-items:center;gap:14px;height:72px;padding:0 16px 0 14px;border-radius:14px;border:1px solid var(--line);
  background:var(--surface-1);color:var(--fg);font:inherit;text-align:left;cursor:pointer;min-width:0;transition:border-color .15s,transform .2s var(--ease-out)}
.vx-tile:hover{border-color:var(--line-strong)}
.vx-tile-ico{display:grid;place-items:center;flex:none;width:40px;height:40px;border-radius:11px;color:var(--fc);
  background:color-mix(in srgb,var(--fc) 12%,transparent)}
.vx-tile-ico .vx-i{width:19px;height:19px;stroke-width:1.7}
.vx-tile-txt{display:flex;flex-direction:column;gap:3px;min-width:0}
.vx-tile-txt b{font-size:14px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-tile-txt small{font-size:12.5px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.vx-tile.vx-drop-into{border-color:var(--accent);background:var(--accent-soft)}
.vx-go{display:grid;place-items:center;flex:none;width:28px;height:28px;border-radius:50%;color:var(--muted);opacity:0;transform:translateX(-4px);margin-left:auto;
  transition:opacity .16s var(--ease),transform .2s var(--ease-out),color .15s}
.vx-go .vx-i{width:15px;height:15px}
.vx-tile:hover .vx-go,.vx-tile:focus-visible .vx-go{opacity:1;transform:none;color:var(--fg)}
@media (hover:none) and (pointer:coarse){.vx-go{display:none}}
@media (prefers-reduced-motion:reduce){.vx-go{transition:opacity .1s;transform:none}}
/* "Did you mean" under an empty filter */
.vx-near{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;margin-top:4px;font-size:12.5px;color:var(--muted)}
.vx-near-b{height:28px;padding:0 10px;border-radius:99px;border:1px solid var(--line-strong);background:var(--surface-1);color:var(--fg);font-size:12.5px;font-weight:550}
.vx-near-b:hover{border-color:var(--fg)}

.vx-lcard{--cols:minmax(0,1fr) minmax(150px,260px) 132px 36px;border:1px solid var(--line);border-radius:14px;background:var(--surface-1);overflow:hidden}
.vx-lcard:has(>.vx-rows.empty)>.vx-ltools{display:none}
.vx-ltools{display:flex;align-items:center;gap:4px;min-height:54px;padding:0 10px 0 20px}
.vx-label{display:flex;align-items:baseline;gap:8px;margin:0;font-size:15px;font-weight:600;color:var(--fg);white-space:nowrap;min-width:0}
.vx-label span{font-size:13px;font-weight:500;color:var(--muted);font-variant-numeric:tabular-nums}
.vx-label em{font-style:normal;font-weight:400;font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis}
.ui-sel.vx-select{position:relative;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:8px;color:var(--text-2);
  font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s;border:0;background:transparent;max-width:none}
.ui-sel.vx-select:hover{background:var(--hover);color:var(--fg)}
.ui-sel.vx-select:focus-visible,.ui-sel.vx-select[aria-expanded=true]{box-shadow:0 0 0 2px var(--line-strong);background:var(--hover);color:var(--fg)}
.vx-select .vx-i{width:14px;height:14px}
.vx-dir .vx-i{width:15px;height:15px;transform:rotate(180deg);transition:transform .2s}
.vx-dir.desc .vx-i{transform:none}
.vx-thead{display:grid;grid-template-columns:var(--cols);align-items:center;gap:16px;height:38px;padding:0 10px 0 20px;
  border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--fg) 2.5%,transparent);
  font-size:12px;font-weight:500;color:var(--muted)}
.vx-thead button{display:inline-flex;align-items:center;gap:4px;justify-self:start;height:26px;margin-left:-8px;padding:0 8px;border:0;border-radius:6px;
  background:none;color:inherit;font:inherit;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s}
.vx-thead button:first-child{margin-left:40px}
.vx-thead button:hover{background:var(--hover);color:var(--fg)}
.vx-thead button.on{color:var(--fg)}
.vx-thead button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
/* The column labels sort the table, so the Sort menu waits for grid and phones. */
.vx-lcard:not(.is-cards):has(.vx-thead)>.vx-ltools :is(.vx-select,.vx-dir){display:none}
.vx-th-dir{display:inline-grid}
.vx-th-dir .vx-i{width:13px;height:13px;transform:rotate(180deg)}
.vx-th-dir.desc .vx-i{transform:none}
.vx-active{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:14px;min-width:0}
.vx-active-k{font-size:13px;color:var(--muted);margin-right:2px}
.vx-chip{display:inline-flex;align-items:center;gap:7px;max-width:min(100%,420px);height:30px;padding:0 3px 0 11px;border-radius:99px;
  background:color-mix(in srgb,var(--fg) 6%,transparent);color:var(--fg);font-size:13px;font-weight:500;min-width:0}
.vx-chip>i{width:7px;height:7px;border-radius:50%;background:var(--fc);flex:none}
.vx-chip>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-chip button{display:grid;place-items:center;flex:none;width:24px;height:24px;border:0;border-radius:50%;background:none;color:var(--muted);cursor:pointer}
.vx-chip button .vx-i{width:13px;height:13px}
.vx-chip button:hover{background:color-mix(in srgb,var(--fg) 10%,transparent);color:var(--fg)}
.vx-active-all{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:0;border-radius:8px;background:none;color:var(--text-2);
  font:inherit;font-size:13px;font-weight:550;cursor:pointer}
.vx-active-all .vx-i{width:14px;height:14px}
.vx-active-all:hover{background:var(--hover);color:var(--fg)}
.vx-active :is(button):focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.vx-bulk{display:flex;align-items:center;gap:8px;padding:8px 10px 8px 20px;font-size:13px;flex-wrap:wrap;
  background:color-mix(in srgb,var(--fg) 5%,transparent);border-top:1px solid var(--line)}
.vx-bulk .vx-i{width:14px;height:14px}
.vx-addrow{display:flex;align-items:center;justify-content:center;gap:8px;width:calc(100% - 24px);height:44px;margin:4px 12px 12px;border:0;border-radius:10px;
  background:color-mix(in srgb,var(--fg) 4%,transparent);color:var(--text-2);font:inherit;font-size:13.5px;font-weight:550;cursor:pointer;transition:background .15s,color .15s}
.vx-addrow .vx-i{width:15px;height:15px}
.vx-addrow:hover{background:color-mix(in srgb,var(--fg) 7%,transparent);color:var(--fg)}
.vx-addrow:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}

.vx-rows{outline:none}
.vx-note{display:grid;grid-template-columns:var(--cols);align-items:center;gap:16px;min-height:56px;padding:8px 10px 8px 20px;cursor:pointer;position:relative;
  border-top:1px solid var(--line);transition:background .12s}
.vx-note:first-child,.vx-group+.vx-note{border-top:0}
.vx-note:hover{background:color-mix(in srgb,var(--fg) 3%,transparent)}
.vx-note.sel{background:color-mix(in srgb,var(--fg) 6%,transparent)}
.vx-note.sel::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--brand-mark,var(--accent))}
.vx-note-lead{position:relative;display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:9px;overflow:hidden;
  background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--muted)}
.vx-note-lead .vx-i{width:17px;height:17px;stroke-width:1.7}
.vx-note-thumb{position:absolute;inset:0;display:none}
.vx-note.has-thumb .vx-note-thumb{display:block}
.vx-note-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.vx-note:not(.card)>.vx-note-lead{position:absolute;left:20px;top:50%;margin-top:-16px}
.vx-note:not(.card)>.vx-note-main{padding-left:48px}
.vx-note-main{min-width:0;display:flex;flex-direction:column;gap:2px}
.vx-note-l1{display:flex;align-items:center;gap:7px;min-width:0}
.vx-note-name{font-size:14px;font-weight:550;line-height:20px;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:0 1 auto}
.vx-note-name .vx-rename{font-size:14px}
.vx-note-pin{display:inline-flex;color:var(--muted);flex:none}
.vx-note-pin .vx-i{width:13px;height:13px}
.vx-note-folder,.vx-note-mf{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--text-2);white-space:nowrap;min-width:0;overflow:hidden;max-width:100%}
.vx-note-folder i,.vx-note-mf i{width:6px;height:6px;border-radius:50%;background:var(--fc);flex:none}
.vx-note-folder>span,.vx-note-mf>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* A long path gives way at its start; the folder's own name stays whole. */
.vx-note-folder{gap:0}
.vx-note-folder i{margin-right:8px}
.vx-note-folder .vx-fp-pre{flex:0 1000 auto;min-width:2.6em;color:var(--muted)}
.vx-note-folder .vx-fp-sep{flex:none;margin:0 4px;color:var(--text-3)}
.vx-note-folder .vx-fp-leaf{flex:0 1 auto}
.vx-note-fcol{min-width:0;display:flex}
.vx-note-meta{display:none}
.vx-note-ex{font-size:12.5px;line-height:18px;height:18px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-note-ex.none{font-style:italic;color:var(--text-3)}
.vx-note-ex .vx-skel{display:block;width:min(60%,320px);height:8px;margin-top:5px;border-radius:4px}
.vx-note-top{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums;min-width:0}
.vx-note-top time,.vx-note-meta time{cursor:default}
.vx-note-tags{display:flex;gap:12px;height:20px;align-items:center;min-width:0;overflow:hidden}
.vx-none{color:var(--text-3)}
.vx-chip-tag{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;line-height:18px;color:var(--text-2);white-space:nowrap;
  max-width:120px;overflow:hidden;text-overflow:ellipsis;flex:none}
.vx-chip-tag i{width:6px;height:6px;border-radius:50%;background:var(--tc);flex:none}
.vx-note .vx-row-more{width:32px;height:32px;display:grid;place-items:center;flex:none;opacity:0;border-radius:8px;justify-self:end}
.vx-note:hover .vx-row-more,.vx-note:focus-visible .vx-row-more,.vx-note:focus-within .vx-row-more{opacity:1}
@media (hover:none){.vx-note .vx-row-more{opacity:1}}
.vx-lcard.is-cards{border:0;background:none;border-radius:0;overflow:visible}
.vx-lcard.is-cards>.vx-ltools{padding:0 2px 0 2px;min-height:44px;margin-bottom:8px}
.vx-lcard.is-cards>.vx-bulk{border:1px solid var(--line);border-radius:12px;margin-bottom:12px}
.vx-rows.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.vx-note.card{display:flex;flex-direction:column;align-items:stretch;gap:8px;min-height:0;padding:18px 18px 16px 20px;border:1px solid var(--line);
  border-radius:14px;background:var(--surface-1)}
.vx-note.card:hover{border-color:var(--line-strong);background:var(--surface-1)}
.vx-note.card.sel{border-color:var(--fg);background:var(--surface-1)}
.vx-note.card.sel::before{display:none}
.vx-card-top{display:flex;align-items:center;gap:10px;min-width:0;margin:-4px -6px 0 0}
.vx-card-top .vx-note-lead{width:32px;height:32px}
.vx-card-top .vx-note-name{flex:1;font-size:15px;font-weight:600}
.vx-note.card .vx-note-ex{white-space:normal;height:auto;min-height:40px;font-size:13.5px;line-height:20px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;padding-right:4px;margin-top:2px}
.vx-props{display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 12px;margin:6px 0 0;padding-top:8px;border-top:1px solid var(--line);font-size:13px}
.vx-props dt{color:var(--muted);line-height:34px}
.vx-props dd{margin:0;display:flex;align-items:center;justify-content:flex-end;gap:7px;min-width:0;color:var(--text-2);text-align:right;line-height:34px;height:34px}
.vx-props dd.vx-note-tags{gap:10px}
.vx-props .vx-note-mf,.vx-props .vx-note-folder{font-size:13px}
.vx-rows.cards>.vx-addrow{width:auto;height:auto;min-height:140px;margin:0;border-radius:14px;flex-direction:row}
.vx-group{display:flex;align-items:center;gap:8px;padding:18px 20px 8px;font-size:12.5px;font-weight:600;color:var(--text-2);border-top:1px solid var(--line)}
.vx-group:first-child{border-top:0}
.vx-group i{width:7px;height:7px;border-radius:50%;background:var(--fc)}
.vx-agent{display:inline-grid;place-items:center;min-width:24px;height:24px;padding:0 4px;border-radius:12px;font-size:10px;font-weight:700;line-height:1;
  letter-spacing:.02em;color:var(--ac);background:color-mix(in srgb,var(--ac) 18%,transparent);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ac) 45%,transparent);flex:none}
.vx-agent.sm{min-width:18px;height:18px;font-size:8.5px;border-radius:9px;padding:0 3px}
.vx-empty{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;color:var(--muted);font-size:14px;padding:56px 24px}
.vx-empty>.vx-i{box-sizing:border-box;width:44px;height:44px;padding:12px;margin-bottom:10px;border-radius:12px;color:var(--muted);stroke-width:1.7;
  background:color-mix(in srgb,var(--fg) 5%,transparent)}
.vx-empty>b{font-size:15px;font-weight:600;color:var(--fg)}
.vx-empty p{margin:0 0 12px;line-height:1.55;max-width:44ch}
.vx-empty .btn{display:inline-flex;align-items:center;gap:6px}
.vx-missing{margin:auto}
.vx-keys{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:0;font-size:13px;align-items:center}
.vx-keys dt{display:flex;gap:4px}.vx-keys dd{margin:0;color:var(--muted)}

/* ── node reader ───────────────────────────────────────────────── */
.vx-rbar{display:flex;align-items:center;gap:6px;height:56px;padding:0 16px 0 12px;border-bottom:1px solid var(--line);flex:none;background:var(--surface-0)}
.vx-rbar .vx-back .vx-i{width:18px;height:18px}
.vx-rbar .vx-crumbs{flex:0 1 auto}
.vx-crumb .vx-i{width:14px;height:14px;margin-right:6px;flex:none}
.vx-crumb.cur{color:var(--fg);font-weight:550;cursor:default}
.vx-crumb.cur:hover{background:none}
.vx-aa-btn{font-size:14px;font-weight:650;letter-spacing:-.2px;font-family:var(--font)}
.vx-ct-btn{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px 0 10px;border:0;border-radius:9px;background:none;color:var(--text-2);
  font:inherit;font-size:13px;font-weight:550;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s}
.vx-ct-btn .vx-i{width:16px;height:16px}
.vx-ct-btn:hover{background:var(--hover);color:var(--fg)}
.vx-ct-btn:is([aria-pressed=true],[aria-expanded=true]){background:color-mix(in srgb,var(--fg) 8%,transparent);color:var(--fg)}
.vx-ct-btn:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.vx-rbar .vx-icon-btn{width:34px;height:34px;border-radius:9px}
.vx-rbar .vx-icon-btn[aria-expanded=true]{background:var(--press);color:var(--fg)}
.vx-rgroup{display:flex;align-items:center;gap:2px;flex:none}
.vx-vsep{width:1px;height:20px;background:var(--line);margin:0 8px;flex:none}
.vx-rbar .btn.sm{height:34px;padding:0 14px;border-radius:9px;font-size:13px;font-weight:600}
.vx-rbar .vx-mode{background:var(--surface-1);border-color:var(--line)}
.vx-rbar .vx-mode:hover{border-color:var(--line-strong)}
/* Reading focus: the bars fold away, a handle stays at the top. */
.vx-rbar,.vx-pcrumbs{transition:height .28s cubic-bezier(.2,.8,.2,1),opacity .2s,border-color .2s}
.vx-focus :is(.vx-rbar,.vx-pcrumbs){height:0 !important;opacity:0;overflow:hidden;border-bottom-color:transparent;visibility:hidden;
  transition:height .28s cubic-bezier(.2,.8,.2,1),opacity .15s,border-color .2s,visibility 0s .28s}
#main:has(.view:not(.hidden) .vx-focus) #topbar{height:0;min-height:0;padding-top:0;padding-bottom:0;opacity:0;overflow:hidden;visibility:hidden;border-color:transparent;
  transition:height .28s cubic-bezier(.2,.8,.2,1),opacity .15s,visibility 0s .28s}
#topbar{transition:height .28s cubic-bezier(.2,.8,.2,1),opacity .2s}
.vx-unfocus{position:absolute;z-index:5;top:10px;left:50%;translate:-50% -10px;display:flex;align-items:center;gap:6px;height:30px;padding:0 12px 0 9px;
  border-radius:999px;border:1px solid var(--line);background:var(--surface-1);color:var(--muted);font:inherit;font-size:12px;font-weight:550;cursor:pointer;
  opacity:0;visibility:hidden;transition:opacity .2s,translate .3s cubic-bezier(.2,.8,.2,1),visibility 0s .3s,color .15s}
.vx-unfocus .vx-i{width:15px;height:15px}
.vx-focus .vx-unfocus{opacity:.55;visibility:visible;translate:-50% 0;transition:opacity .25s .1s,translate .3s cubic-bezier(.2,.8,.2,1) .1s,visibility 0s,color .15s}
.vx-focus .vx-unfocus:is(:hover,:focus-visible){opacity:1;color:var(--fg)}
.vx-unfocus:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:760px){.vx-focus .vx-note-scroll{padding-top:34px}}
@media (prefers-reduced-motion:reduce){.vx-rbar,.vx-pcrumbs,#topbar,.vx-unfocus{transition:none !important}}
/* Phones: the breadcrumb on its own scrollable row under the bar. */
.vx-pcrumbs{display:none;align-items:center;gap:2px;overflow-x:auto;scrollbar-width:none;padding:0 12px;height:40px;flex:none;
  border-bottom:1px solid var(--line);background:var(--surface-0);white-space:nowrap}
.vx-pcrumbs::-webkit-scrollbar{display:none}
.vx-pcrumbs .vx-crumb{flex:none;height:32px}
.vx-pcrumbs .vx-crumb.cur span{max-width:60vw}
.vx-busy .vx-col{opacity:.55;transition:opacity .2s;pointer-events:none}
.vx-mode{display:inline-flex;align-items:center;gap:6px}
.vx-mode .vx-i{width:15px;height:15px}
.vx-sk{display:flex;flex-direction:column;height:100%}
.vx-sk .vx-icard{display:flex;flex-direction:column}
.vx-note-scroll{--paper:var(--surface-1);flex:1;overflow:auto;outline:none;background:var(--bg);color:var(--fg);transition:background .2s,color .2s}
.vx-note-scroll[data-rtone]{--paper:var(--bg);background:color-mix(in srgb,var(--bg) 96%,var(--fg))}
.vx-save{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);margin-right:6px;white-space:nowrap}
.vx-save i{width:6px;height:6px;border-radius:50%;background:var(--ok)}
.vx-save[data-state=dirty] i{background:var(--warn)}
.vx-save[data-state=saving] i{background:var(--accent-2);animation:vxPulse 1s infinite}
.vx-save[data-state=error] i,.vx-save[data-state=conflict] i{background:var(--danger)}
.vx-save[data-state=error],.vx-save[data-state=conflict]{color:var(--danger);font-weight:600}
.vx-page{display:grid;grid-template-columns:minmax(0,1fr);justify-items:center;gap:20px;padding:32px 32px 120px}
.vx-paper{box-sizing:border-box;width:100%;max-width:calc(var(--rw,760px) + 128px);background:var(--paper);border:1px solid var(--line);
  border-radius:16px;padding:56px 64px 48px;min-width:0}
.vx-col{min-width:0}
.vx-doc-title{font-size:34px;line-height:1.18;font-weight:650;letter-spacing:-.025em;margin:0 0 12px;cursor:text;word-break:break-word}
.vx-doc-title .vx-rename{font-size:30px;font-weight:650}
.vx-doc-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 16px;font-size:13px;color:var(--muted);line-height:22px}
.vx-doc-meta>*{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;min-width:0;max-width:100%}
.vx-doc-meta .vx-meta-folder span{overflow:hidden;text-overflow:ellipsis}
.vx-meta-folder{border:0;background:none;color:var(--text-2);font:inherit;padding:0;cursor:pointer;border-radius:4px;min-width:0;white-space:nowrap;display:inline-flex;align-items:center;gap:7px}
.vx-meta-folder:hover{color:var(--fg);text-decoration:underline;text-underline-offset:3px}
.vx-meta-folder i{width:7px;height:7px;border-radius:50%;background:var(--fc);flex:none}
.vx-meta-pin .vx-i{width:13px;height:13px}
.vx-touch{color:var(--text-2);display:inline-flex;align-items:center;gap:6px}
.vx-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
.vx-tag{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:none;font:inherit;font-size:12.5px;height:26px;padding:0 10px;
  border-radius:99px;cursor:pointer;color:var(--text-2);transition:background .15s,color .15s,border-color .15s}
.vx-tag i{width:6px;height:6px;border-radius:50%;background:var(--tc)}
.vx-tag:hover{background:var(--hover);color:var(--fg);border-color:var(--line-strong)}

.vx-prose{margin-top:36px;font-family:var(--font);font-size:var(--rsize,16px);line-height:1.7;color:var(--fg);letter-spacing:-.003em;
  font-feature-settings:"kern","liga","calt";-webkit-font-smoothing:antialiased;overflow-wrap:break-word}
[data-rfont=serif] .vx-prose{font-family:"Iowan Old Style","Charter","Source Serif 4","Source Serif Pro","Georgia",ui-serif,serif;
  font-size:calc(var(--rsize,16px) * 1.06);letter-spacing:0}
[data-rfont=mono] .vx-prose{font-family:var(--mono);font-size:calc(var(--rsize,16px) * .9);letter-spacing:0}
[data-rlead=compact] .vx-prose{line-height:1.55}
[data-rlead=relaxed] .vx-prose{line-height:1.88}
.vx-prose>:first-child{margin-top:0}
.vx-prose p{margin:0 0 1.05em;text-wrap:pretty}
.vx-prose ul,.vx-prose ol{margin:0 0 1.15em;padding-left:1.35em}
.vx-prose li{margin:.4em 0;padding-left:.2em;text-wrap:pretty}
.vx-prose li>:is(ul,ol){margin:.35em 0 .5em}
.vx-prose li::marker{color:var(--text-3)}
.vx-prose ol>li::marker{font-variant-numeric:tabular-nums;font-size:.92em}
.vx-prose :is(h1,h2,h3,h4){color:var(--fg);font-family:var(--font);font-weight:650;letter-spacing:-.015em;line-height:1.28;text-wrap:balance}
.vx-prose h1{font-size:1.6em;margin:1.9em 0 .55em}
.vx-prose h2{font-size:1.32em;margin:2em 0 .6em}
.vx-prose h3{font-size:1.1em;margin:1.7em 0 .45em}
.vx-prose h4{font-size:.8em;margin:1.6em 0 .5em;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-2)}
.vx-prose :is(h1,h2,h3,h4)+:is(h2,h3,h4){margin-top:.4em}
.vx-prose :is(h1,h2,h3,h4){scroll-margin-top:24px}
.vx-prose a{color:var(--accent-2);text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--accent-2) 40%,transparent);text-underline-offset:3px}
/* Wikilinks. The position…opacity reset keeps the welcome tour's own ".wl" class off links. */
.vx-prose a.wl{position:static;inset:auto;z-index:auto;display:inline;opacity:1;background:none;
  color:var(--fg);font-weight:500;cursor:pointer;text-decoration:underline;text-decoration-thickness:1.5px;text-underline-offset:.24em;
  text-decoration-color:color-mix(in srgb,var(--accent) 55%,transparent);border-radius:4px;-webkit-box-decoration-break:clone;box-decoration-break:clone;
  transition:background .15s,text-decoration-color .15s,color .15s;overflow-wrap:break-word}
.vx-prose a.wl:hover{color:var(--fg);text-decoration-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
.vx-prose a.wl.broken{color:var(--text-2);font-weight:500;text-decoration-style:dashed;text-decoration-thickness:1px;
  text-decoration-color:color-mix(in srgb,var(--muted) 80%,transparent)}
.vx-prose a.wl.broken:hover{color:var(--fg);text-decoration-color:var(--fg);background:var(--hover)}
.vx-prose a.wl:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.vx-prose :is(h1,h2,h3,h4) a.wl{font-weight:inherit}
.vx-hit{animation:vxHit 1.6s var(--ease)}
@keyframes vxHit{0%,30%{background:color-mix(in srgb,var(--accent) 22%,transparent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 22%,transparent)}100%{background:transparent;box-shadow:none}}
@media (prefers-reduced-motion:reduce){.vx-hit{animation:none;outline:2px solid var(--accent)}}
.vx-prose strong{font-weight:650;color:var(--fg)}
.vx-prose em{font-style:italic}
.vx-prose blockquote{margin:1.3em 0;padding:.15em 0 .15em 1.05em;border-left:2px solid var(--accent-line,var(--line-strong));border-radius:0;background:none;color:var(--text-2)}
.vx-prose blockquote p:last-child{margin-bottom:0}
.vx-prose code{font-family:var(--mono);font-size:.84em;padding:.14em .38em;border-radius:5px;background:color-mix(in srgb,var(--fg) 6%,transparent);
  color:var(--fg);border:0;overflow-wrap:anywhere}
.vx-prose pre{font-size:13px;line-height:1.65;padding:14px 16px;margin:1.2em 0;border-radius:10px;border:1px solid var(--line);overflow:auto;
  background:color-mix(in srgb,var(--fg) 3.5%,transparent)}
.vx-prose pre code{font-size:13px;padding:0;background:none;border-radius:0;line-height:inherit;overflow-wrap:normal}
.vx-prose table{display:block;max-width:100%;overflow-x:auto;margin:1.2em 0;font-size:.9em;border-collapse:collapse;border-spacing:0}
.vx-prose th,.vx-prose td{min-width:0;border:0;border-bottom:1px solid var(--line);padding:9px 20px 9px 0;text-align:left;vertical-align:top}
.vx-prose th{font-size:.86em;font-weight:600;color:var(--muted);background:none;border-bottom-color:var(--line-strong);white-space:nowrap}
.vx-prose tr:last-child td{border-bottom:0}
.vx-prose hr{border:0;height:1px;background:var(--line);margin:2.2em 0}
.vx-prose img{max-width:100%;border-radius:10px}
.vx-prose .task,.vx-prose li:has(>input[type=checkbox]){list-style:none;position:relative;margin-left:-1.35em;padding-left:1.75em}
.vx-prose input[type=checkbox]{appearance:none;-webkit-appearance:none;position:absolute;left:0;top:calc(.5lh - 8px);width:16px;height:16px;margin:0;
  border:1.5px solid var(--line-strong);border-radius:5px;background:transparent;opacity:1;cursor:default}
.vx-prose input[type=checkbox]:checked{border-color:var(--accent);background:var(--accent) no-repeat center/11px
  url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2.5 6.2 5 8.6l4.5-5'/%3E%3C/svg%3E")}
.vx-prose li.task.done{color:var(--muted)}
.vx-prose li.task.done :is(strong,a.wl,code){color:inherit}
.vx-empty-doc{font-size:15px}
.vx-linkbtn{border:0;background:none;padding:0;font:inherit;color:var(--accent);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.vx-flash{animation:vxFlash 1.4s var(--ease)}
@keyframes vxFlash{0%{background:color-mix(in srgb,var(--accent-2) 14%,transparent)}100%{background:transparent}}

.vx-insp{display:flex;flex-direction:column;gap:16px;min-width:0;width:100%;max-width:calc(var(--rw,760px) + 128px)}
.vx-icard{background:var(--paper,var(--surface-1));border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.vx-icard h3{display:flex;align-items:baseline;gap:8px;margin:0 0 6px;font-size:15px;font-weight:600;color:var(--fg)}
.vx-info{margin:0;font-size:13px}
.vx-igroup{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:16px;padding:4px 0;border-top:1px solid var(--line)}
.vx-igroup:first-child{border-top:0;padding-top:0}
.vx-igroup:last-child{padding-bottom:0}
.vx-info dt{color:var(--muted);line-height:36px;white-space:nowrap}
.vx-info dd{margin:0;display:flex;align-items:center;justify-content:flex-end;gap:6px;min-width:0;min-height:36px;color:var(--text-2);text-align:right;font-variant-numeric:tabular-nums}
.vx-info dd>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-info .vx-meta-folder{max-width:100%}
.vx-info .vx-meta-folder span{overflow:hidden;text-overflow:ellipsis}
.vx-itags{display:flex!important;flex-wrap:wrap;justify-content:flex-end;gap:4px;padding:5px 0;white-space:normal!important}
.vx-itags .vx-tag{height:24px;padding:0 8px;font-size:12px}
.vx-icard .vx-muted{font-size:12.5px;margin:0}
.vx-toc{padding:12px 10px 10px 16px}
.vx-toc-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin:0 0 6px}
.vx-toc-head .vx-icon-btn{width:28px;height:28px;border-radius:7px}
.vx-toc-head .vx-icon-btn .vx-i{width:14px;height:14px}
.vx-toc .vx-ct-list{max-height:min(54vh,480px);margin:10px -6px 0 0;padding:0 6px 0 0}
.vx-link{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:0 10px;width:calc(100% + 16px);text-align:left;border:0;
  background:none;color:var(--fg);font:inherit;padding:8px;margin:0 -8px;border-radius:9px;cursor:pointer}
.vx-link i{width:7px;height:7px;border-radius:50%;background:var(--fc,var(--muted))}
.vx-link b{font-size:13.5px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-link small{grid-column:2;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-link:hover{background:var(--hover)}
.vx-link.missing b{color:var(--muted);font-weight:500}
.vx-link.missing i{background:none;box-shadow:inset 0 0 0 1px var(--muted)}
.vx-rfoot{margin-top:56px;border-top:1px solid var(--line)}
.vx-rfoot details{border-bottom:1px solid var(--line)}
.vx-rfoot summary{display:flex;align-items:center;gap:8px;height:52px;cursor:pointer;font-size:14px;font-weight:600;list-style:none;border-radius:var(--r-xs)}
.vx-rfoot summary::-webkit-details-marker{display:none}
.vx-rfoot summary span{color:var(--muted);font-weight:500}
.vx-rfoot summary::after{content:"";margin:0 6px 4px auto;width:7px;height:7px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);
  transform:rotate(45deg);transition:transform .2s}
.vx-rfoot details[open] summary::after{transform:rotate(-135deg);margin-bottom:-2px}
.vx-rfoot details>div{padding:0 8px 16px}
.vx-rfoot .vx-link{padding:10px 8px}
/* Wide: Contents as a sticky column on the left, the paper centred in the rest. */
@container vxnote (min-width:820px){
  .vx-page.toc-open:not(.editing){grid-template-columns:300px minmax(0,1fr);align-items:start;justify-items:stretch;gap:24px;padding:32px 32px 120px}
  .vx-page:not(.toc-open) .vx-insp,.vx-page.editing .vx-insp{display:none}
  .vx-paper{justify-self:center}
  .vx-insp{position:sticky;top:24px;max-height:calc(100vh - 140px);overflow:auto;scrollbar-width:none}
  .vx-insp::-webkit-scrollbar{display:none}
  .vx-toc .vx-ct-list{max-height:calc(100vh - 290px)}
  .vx-rfoot{display:grid;grid-template-columns:1fr 1fr;gap:0 40px;border-top:0}
  .vx-rfoot details{border-bottom:0;border-top:1px solid var(--line)}
  .vx-rfoot summary{pointer-events:none;height:48px;font-size:13px;font-weight:600;color:var(--text-2)}
  .vx-rfoot summary::after{display:none}
  .vx-rfoot details>div{padding:0 0 8px}
  .vx-rfoot .vx-link{padding:8px}
}
/* Narrow: the outline is in Contents. */
@container vxnote (max-width:819px){
  .vx-insp{display:none}
}
/* Medium panes: a slimmer column, so the page keeps a comfortable width. */
@container vxnote (min-width:820px) and (max-width:1079px){
  .vx-page.toc-open:not(.editing){grid-template-columns:256px minmax(0,1fr);gap:20px;padding:24px 24px 120px}
  .vx-toc{padding:10px 8px 8px 12px}
  .vx-toc .vx-ct-seg button{padding:0 4px;font-size:12px}
}
.vx-ct-info{padding:2px 8px 4px 2px}
.vx-ct-info .vx-info dt{line-height:34px}
.vx-ct-info .vx-info dd{min-height:34px}
.vx-ct-info .vx-itags{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px}

/* reading colours: only inside the reading area, for both app themes */
.vx-note-scroll[data-rtone=sepia]{--bg:#1d1913;--fg:#eadcc4;--text-2:#d6c6aa;--muted:#a8977b;--text-3:#7f705a;--line:rgba(234,220,196,.13);
  --line-strong:rgba(234,220,196,.22);--panel:#241f17;--panel-2:#2c261c;--hover:rgba(234,220,196,.07);--accent:#e3b46c;--accent-2:#d7a15d;
  --accent-line:rgba(227,180,108,.45);--accent-soft:rgba(227,180,108,.13)}
:root[data-theme=light] .vx-note-scroll[data-rtone=sepia]{--bg:#f8f2e5;--fg:#362b1f;--text-2:#55452f;--muted:#7a6a52;--text-3:#a2927a;
  --line:rgba(59,47,33,.13);--line-strong:rgba(59,47,33,.22);--panel:#efe6d1;--panel-2:#e8dcc2;--hover:rgba(59,47,33,.06);--accent:#9a5b12;
  --accent-2:#8a4f12;--accent-line:rgba(154,91,18,.4);--accent-soft:rgba(154,91,18,.1)}
.vx-note-scroll[data-rtone=contrast]{--bg:#000;--fg:#fff;--text-2:#f1f3f6;--muted:#d4d9e2;--text-3:#aab2bf;--line:rgba(255,255,255,.32);
  --line-strong:rgba(255,255,255,.5);--panel:#0b0b0b;--panel-2:#1a1a1a;--hover:rgba(255,255,255,.1);--accent:#8af5e6;--accent-2:#b4bcff;
  --accent-line:rgba(138,245,230,.7);--accent-soft:rgba(138,245,230,.16)}
:root[data-theme=light] .vx-note-scroll[data-rtone=contrast]{--bg:#fff;--fg:#000;--text-2:#111;--muted:#2c3038;--text-3:#4b515c;
  --line:rgba(0,0,0,.38);--line-strong:rgba(0,0,0,.6);--panel:#fff;--panel-2:#eceef2;--hover:rgba(0,0,0,.07);--accent:#00594f;
  --accent-2:#2b1fb8;--accent-line:rgba(0,89,79,.7);--accent-soft:rgba(0,89,79,.1)}
.vx-note-scroll[data-rtone=contrast] .vx-prose a{text-decoration-thickness:2px}
.vx-note-scroll[data-rtone=contrast] .vx-prose a.wl{text-decoration-thickness:2px}

/* floating panels: popover (wide) and bottom sheet (phones) */
.vx-pop{position:fixed;inset:0;z-index:190;pointer-events:none}
.vx-pop .vx-pop-card{position:fixed;pointer-events:auto;display:flex;flex-direction:column;width:340px;max-width:calc(100vw - 16px);
  background:var(--panel);border:1px solid var(--line-strong);border-radius:var(--r);box-shadow:none;overflow:hidden;
  animation:vxPop .14s var(--ease)}
.vx-pop.vx-pop-ct .vx-pop-card{width:440px;max-height:min(520px,calc(100vh - 120px))}
.vx-pop-head{display:flex;align-items:center;gap:8px;padding:8px 8px 4px 16px;flex:none}
.vx-pop-head b{flex:1;font-size:13px;font-weight:650}
.vx-pop-body{overflow:auto;min-height:0;flex:1}
.vx-sheet{position:fixed;inset:0;z-index:190}
.vx-sheet-back{position:absolute;inset:0;background:rgba(0,0,0,.45);opacity:0;transition:opacity .22s var(--ease)}
.vx-sheet .vx-pop-card{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;max-height:88dvh;background:var(--panel);
  border-radius:12px 12px 0 0;border-top:1px solid var(--line-strong);box-shadow:none;padding-bottom:var(--safe-b,0px);
  transform:translateY(100%);transition:transform .26s var(--ease-out)}
.vx-sheet.vx-pop-ct .vx-pop-card{max-height:80dvh}
.vx-sheet.in .vx-sheet-back{opacity:1}
.vx-sheet.in .vx-pop-card{transform:none}
.vx-sheet-grab{display:block;width:40px;height:5px;border-radius:3px;background:var(--line-strong);margin:8px auto 0;flex:none;touch-action:none}
.vx-sheet .vx-pop-head{padding:4px 8px 4px 20px;min-height:48px;touch-action:none}
.vx-sheet .vx-pop-head b{font-size:16px}
.vx-sheet .vx-pop-head .vx-icon-btn{width:44px;height:44px}
@media (prefers-reduced-motion:reduce){.vx-sheet .vx-pop-card,.vx-sheet-back,.vx-pop .vx-pop-card{transition:none;animation:none}}

/* reading settings */
.vx-aa{display:flex;flex-direction:column;gap:16px;padding:8px 16px 16px}
.vx-aa-row{display:flex;flex-direction:column;gap:8px}
.vx-aa-size{display:flex;align-items:center;gap:8px;padding:4px;border-radius:var(--r);background:var(--panel-2)}
.vx-aa-size button{width:48px;height:40px;display:grid;place-items:center;border:0;border-radius:var(--r-sm);background:none;color:var(--fg);
  font-family:var(--font);font-weight:600;cursor:pointer}
.vx-aa-size button:hover:not(:disabled){background:var(--hover)}
.vx-aa-size button:disabled{opacity:.35;cursor:default}
.vx-aa-dots{flex:1;display:flex;justify-content:center;gap:8px}
.vx-aa-dots i{width:7px;height:7px;border-radius:50%;background:var(--line-strong)}
.vx-aa-dots i.on{background:var(--accent);transform:scale(1.3)}
.vx-seg3{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.vx-seg3 button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:60px;padding:8px 4px;border-radius:var(--r-sm);
  border:1px solid var(--line);background:none;color:var(--muted);font:inherit;font-size:12px;cursor:pointer;transition:border-color .15s,background .15s,color .15s}
.vx-seg3 button:hover{color:var(--fg);border-color:var(--line-strong)}
.vx-seg3 button[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft);color:var(--fg)}
.vx-seg3 b{font-size:18px;font-weight:600;color:var(--fg)}
.vx-seg3 .ff-serif b{font-family:"Iowan Old Style","Charter","Georgia",ui-serif,serif}
.vx-seg3 .ff-mono b{font-family:var(--mono);font-size:16px}
.vx-seg3 .sw{width:22px;height:22px;border-radius:50%;border:1px solid var(--line-strong)}
.sw-default{background:var(--bg)}
.sw-sepia{background:#f3e7cf;box-shadow:none}
.sw-contrast{background:#fff;box-shadow:none}
/* little pictures for line spacing and width */
.vx-seg3 :is(.lh,.wd){display:flex;flex-direction:column;justify-content:center;width:26px;height:22px}
.vx-seg3 :is(.lh,.wd) b{display:block;height:2px;border-radius:1px;background:currentColor;font-size:0}
.vx-seg3 .lh-compact{gap:2px}.vx-seg3 .lh-normal{gap:4px}.vx-seg3 .lh-relaxed{gap:6px}
.vx-seg3 .wd{align-items:center;border-left:2px solid currentColor;border-right:2px solid currentColor;padding:0 2px}
.vx-seg3 .wd b{height:10px;opacity:.5}
.vx-seg3 .wd-narrow b{width:8px}.vx-seg3 .wd-wide b{width:14px}.vx-seg3 .wd-full b{width:100%}
.vx-aa-reset{align-self:flex-start;border:0;background:none;color:var(--accent);font:inherit;font-size:12.5px;padding:4px 0;cursor:pointer}
.vx-aa-reset:disabled{color:var(--text-3);cursor:default}
.vx-aa button:focus-visible,.vx-ct button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}

/* contents: tabs, then the outline / links / mentions */
.vx-ct{display:flex;flex-direction:column;min-height:0}
.vx-ct-main{display:grid;grid-template-columns:1fr 1fr;gap:2px;flex:1;min-width:0;height:34px;padding:3px;border-radius:10px;box-sizing:border-box;
  background:var(--seg-track,var(--surface-2))}
.vx-ct-main button{border:0;border-radius:7px;background:none;color:var(--muted);font:inherit;font-size:13px;font-weight:600;cursor:pointer;
  white-space:nowrap;transition:color .15s,background .15s}
.vx-ct-main button:hover{color:var(--fg)}
.vx-ct-main button[aria-selected=true]{background:var(--seg-thumb,var(--surface-1));color:var(--fg);box-shadow:0 1px 2px rgba(0,0,0,.08),0 0 0 1px var(--line)}
.vx-ct-main button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.vx-ct>.vx-ct-main{flex:none;margin-bottom:12px}
.vx-ct-inner{display:flex;flex-direction:column;min-height:0}
.vx-ct-seg{display:flex;gap:2px;height:36px;margin:0 -2px;border-bottom:1px solid var(--line);box-sizing:border-box;flex:none;overflow-x:auto;scrollbar-width:none}
.vx-ct-seg::-webkit-scrollbar{display:none}
.vx-ct-seg button{position:relative;flex:1 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:0 6px;border:0;border-radius:7px 7px 0 0;
  background:none;color:var(--muted);font:inherit;font-size:12.5px;font-weight:550;white-space:nowrap;cursor:pointer;transition:color .15s}
.vx-ct-seg button b{font-size:11px;font-weight:500;color:var(--text-3);font-variant-numeric:tabular-nums}
.vx-ct-seg button::after{content:"";position:absolute;left:6px;right:6px;bottom:-1px;height:2px;border-radius:2px;background:transparent;transition:background .15s}
.vx-ct-seg button:hover{color:var(--fg)}
.vx-ct-seg button[aria-selected=true]{color:var(--fg)}
.vx-ct-seg button[aria-selected=true]::after{background:var(--accent)}
.vx-ct-seg button[aria-selected=true] b{color:var(--muted)}
.vx-ct-list{overflow:auto;min-height:0;scrollbar-width:none;overscroll-behavior:contain}
.vx-ct-list::-webkit-scrollbar{display:none}
.vx-ct-none{margin:0;padding:10px 2px;font-size:12.5px;color:var(--muted);line-height:1.5}
.vx-ct-toc{display:flex;flex-direction:column;padding:2px 0}
.vx-ct-h{display:block;width:100%;box-sizing:border-box;text-align:left;border:0;border-left:2px solid var(--line);border-radius:0 7px 7px 0;background:none;
  color:var(--muted);font:inherit;font-size:13px;line-height:1.45;padding:5px 8px 5px calc(12px + var(--lv,0) * 14px);cursor:pointer;
  white-space:normal;overflow-wrap:anywhere;text-wrap:pretty;transition:color .15s,background .15s}
.vx-ct-h.l0{color:var(--text-2);font-weight:550}
.vx-ct-h:hover{color:var(--fg);background:var(--hover)}
.vx-ct-h.on{color:var(--fg);border-left-color:transparent;border-image:var(--brand-mark,linear-gradient(var(--accent),var(--accent))) 1;
  background:color-mix(in srgb,var(--fg) 4%,transparent)}
.vx-ct-list>.vx-ct-i,.vx-ct-row{margin-top:2px}
.vx-ct-row{display:flex;align-items:center;gap:2px}
.vx-ct-i{display:flex;align-items:center;gap:10px;width:100%;min-width:0;min-height:44px;padding:5px 8px;border:0;border-radius:8px;background:none;
  color:var(--fg);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.vx-ct-row>.vx-ct-i{flex:1 1 auto;width:auto}
.vx-ct-i:hover{background:var(--hover)}
.vx-ct-i>span{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.vx-ct-i b,.vx-ct-i small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-ct-i b{font-weight:550}
.vx-ct-i small{font-size:12px;color:var(--muted)}
.vx-ct-i>i{width:7px;height:7px;border-radius:50%;background:var(--fc,var(--muted));flex:none}
.vx-ct-i.missing>i{background:none;box-shadow:inset 0 0 0 1.2px var(--muted)}
.vx-ct-i.missing b{color:var(--text-2);font-weight:500}
.vx-ct-jump{display:inline-flex;align-items:center;justify-content:center;gap:3px;flex:none;min-width:34px;height:34px;padding:0 6px;border:0;border-radius:8px;
  background:none;color:var(--muted);font:inherit;cursor:pointer}
.vx-ct-jump .vx-i{width:15px;height:15px}
.vx-ct-jump b{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.vx-ct-jump:hover{background:var(--hover);color:var(--fg)}
.vx-sheet.vx-pop-ct .vx-pop-card{max-width:640px;margin-inline:auto;max-height:84dvh;border-radius:18px 18px 0 0;border:1px solid var(--line-strong);border-bottom:0}
/* Version history on wider screens: a centred dialog rather than a bottom sheet. */
@media (min-width:761px){
  .vx-sheet.vx-pop-hist .vx-pop-card{top:50%;bottom:auto;left:50%;right:auto;width:min(520px,calc(100vw - 48px));max-height:min(78dvh,720px);
    transform:translate(-50%,-46%);opacity:0;border-radius:18px;border:1px solid var(--line-strong);transition:transform .22s var(--ease),opacity .18s var(--ease)}
  .vx-sheet.vx-pop-hist.in .vx-pop-card{transform:translate(-50%,-50%);opacity:1}
  .vx-sheet.vx-pop-hist .vx-sheet-grab{display:none}
}
.vx-sheet.vx-pop-ct .vx-pop-body{display:flex;flex-direction:column;overflow:hidden;padding:4px 16px 0}
.vx-sheet .vx-ct-seg{height:42px}
.vx-sheet .vx-ct-main{height:42px;border-radius:12px}
.vx-sheet .vx-ct-main button{font-size:14.5px;border-radius:9px}
.vx-sheet .vx-ct-seg button{font-size:14px}
.vx-sheet .vx-ct-seg button b{font-size:12px}
.vx-sheet .vx-ct-list{flex:1 1 auto;margin:10px -16px 0;padding:0 16px calc(16px + var(--safe-b,0px))}
.vx-sheet .vx-ct-h{font-size:15px;line-height:1.4;padding:10px 10px 10px calc(14px + var(--lv,0) * 16px);min-height:44px}
.vx-sheet .vx-ct-i{font-size:15px;min-height:52px}
.vx-sheet .vx-ct-i small{font-size:13px}
.vx-sheet .vx-ct-jump{min-width:44px;height:44px}
.vx-skel{height:14px;border-radius:7px;background:var(--panel-2);animation:vxSk 1.4s ease-in-out infinite}
@keyframes vxSk{50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.vx-skel{animation:none}}

/* editor */
.vx-edit{margin-top:28px;position:relative}
.vx-toolbar{display:flex;gap:2px;align-items:center;padding:5px 6px;border:1px solid var(--line);position:sticky;top:12px;
  background:var(--paper,var(--panel));z-index:2;border-radius:12px;flex-wrap:wrap;row-gap:4px;box-shadow:0 6px 18px -12px rgba(15,23,42,.25)}
.vx-toolbar button{width:32px;height:32px;display:grid;place-items:center;border:0;background:none;color:var(--text-2);border-radius:8px;cursor:pointer}
.vx-tsep{width:1px;height:18px;background:var(--line);margin:0 6px;flex:none}
.vx-toolbar button:hover{background:var(--hover);color:var(--fg)}
.vx-toolbar button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.vx-edit-hint{font-size:12px;color:var(--muted);padding-right:8px}
.vx-edit-hint kbd{font-size:10px}
.vx-editor.note-editor{display:block;width:100%;min-height:360px;border:0;border-radius:0;resize:none;background:transparent;color:var(--fg);
  font-family:var(--mono);font-size:14px;line-height:1.75;padding:24px 0;outline:none;tab-size:2;overflow:hidden;box-sizing:border-box}
.vx-editor.note-editor:focus,.vx-editor.note-editor:focus-visible{box-shadow:none;outline:none}
.vx-edit-foot{display:flex;align-items:center;gap:10px;padding:12px 0 0;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.vx-edit-btns{display:inline-flex;gap:6px;align-items:center}
.vx-edit-btns .vx-i,.vx-edit-acts .vx-i{width:15px;height:15px}
.vx-edit-btns .btn.primary,.vx-edit-acts .btn.primary{display:inline-flex;align-items:center;gap:6px}
.vx-edit-acts{display:none;gap:8px}
.vx-suggest{position:absolute;left:24px;z-index:5;min-width:220px;max-width:340px;background:var(--panel);border:1px solid var(--line-strong);
  border-radius:var(--r);box-shadow:none;padding:4px;display:flex;flex-direction:column}
.vx-suggest button{display:flex;align-items:center;gap:8px;border:0;background:none;color:var(--fg);font:inherit;font-size:13px;
  padding:6px 8px;border-radius:var(--r-xs);cursor:pointer;text-align:left}
.vx-suggest button.on,.vx-suggest button:hover{background:var(--accent-soft)}
.vx-conflict{margin-top:24px;border:1px solid color-mix(in srgb,var(--danger) 45%,transparent);border-radius:var(--r);
  background:var(--danger-soft);padding:12px 16px}
.vx-conflict-head{display:flex;gap:12px;font-size:13.5px}
.vx-conflict-head .vx-i{color:var(--danger);width:20px;height:20px;margin-top:1px}
.vx-conflict-head p{margin:4px 0 0;color:var(--muted);font-size:13px}
.vx-conflict-acts{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px}
.vx-draft{border-color:var(--accent-line);background:var(--accent-soft)}
.vx-draft .vx-conflict-head .vx-i{color:var(--accent)}
.vx-theirs{max-height:320px;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-sm);padding:12px;margin:12px 0 0;
  font-size:12px;line-height:1.55;white-space:pre-wrap}
.vx-theirs.hidden{display:none}
.vx-theirs span,.vx-theirs em{display:block;min-height:1.55em}
.vx-theirs .add{color:var(--ok);display:block;background:var(--ok-soft)}
.vx-theirs .del{color:var(--danger);display:block;background:var(--danger-soft)}
.vx-theirs em{color:var(--muted)}

/* ── menu, picker ──────────────────────────────────────────────── */
.vx-menu{position:fixed;z-index:200;min-width:220px;background:var(--panel);border:1px solid var(--line-strong);border-radius:12px;
  box-shadow:none;padding:4px;animation:vxPop .12s var(--ease)}
@keyframes vxPop{from{opacity:0;transform:scale(.97) translateY(-3px)}}
.vx-menu-item{display:flex;align-items:center;gap:10px;width:100%;min-height:34px;border:0;background:none;color:var(--fg);font:inherit;font-size:13.5px;
  padding:0 10px;border-radius:6px;cursor:pointer;text-align:left}
.vx-menu-item .vx-i{color:var(--muted);width:15px;height:15px}
.vx-menu-item:hover,.vx-menu-item:focus-visible{background:var(--hover);outline:none}
.vx-menu-item:disabled{opacity:.4;cursor:default;background:none}
.vx-menu-item.danger,.vx-menu-item.danger .vx-i{color:var(--danger)}
.vx-menu-label{flex:1}
.vx-menu-item kbd{font-size:10px;color:var(--muted)}
.vx-menu-sep{height:1px;background:var(--line);margin:4px 6px}
@media (max-width:760px){.vx-menu-item{min-height:44px;font-size:15px}}
.vx-look-label{font-size:11.5px;color:var(--muted);margin:4px 0 8px}
.vx-look-prev{display:flex;align-items:center;gap:10px;padding:12px 14px;margin-bottom:14px;border-radius:12px;background:var(--panel-2);border:1px solid var(--line)}
.vx-look-prev b{font-size:14px}
.vx-look-prev small{margin-left:auto;font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:50%}
.vx-look-ico{display:grid;place-items:center;width:22px;height:22px}
.vx-look-ico .vx-i{width:20px;height:20px}
.vx-look-emoji{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--muted)}
.vx-look-emoji input{width:64px;height:32px;box-sizing:border-box;text-align:center;font-size:16px;border-radius:8px;border:1px solid var(--line);background:var(--panel-2);color:var(--fg);outline:none}
.vx-look-emoji input:focus{border-color:var(--accent)}
.vx-icons{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.vx-iconpick{width:36px;height:36px;border-radius:8px;border:1px solid var(--line);background:var(--panel-2);cursor:pointer;display:grid;place-items:center}
.vx-iconpick.on,.vx-iconpick:hover{border-color:var(--accent)}
.vx-iconpick .vx-i{width:18px;height:18px}

/* ── responsive ────────────────────────────────────────────────── */
/* The filter pills wrap to their own line before anything can squeeze or overlap. */
@container vxlist (max-width:1060px){
  .vx-browse{padding:24px 24px 88px}
  .vx-lcard{--cols:minmax(0,1fr) minmax(130px,220px) 116px 36px}
  .vx-tbar{row-gap:12px}
  .vx-pills{min-width:0;overflow-x:auto;scrollbar-width:none}
}
@container vxlist (max-width:600px){
  .vx-tbar{margin-top:20px;gap:10px 8px}
  .vx-tabs{flex:1 1 100%}
  .vx-tbar>.vx-grow{display:none}
  .vx-pills{flex:1 1 0;-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 24px),transparent);padding-right:24px}
  .vx-bmeta{white-space:normal}
  .vx-thead{display:none}
  .vx-lcard:not(.is-cards):has(.vx-thead)>.vx-ltools :is(.vx-select,.vx-dir){display:inline-flex}
  .vx-note:not(.card){grid-template-columns:minmax(0,1fr) 40px;gap:8px;min-height:64px;padding:10px 6px 10px 16px}
  .vx-note:not(.card)>.vx-note-lead{left:16px;width:36px;height:36px;margin-top:-18px}
  .vx-note:not(.card)>.vx-note-main{padding-left:50px}
  .vx-note:not(.card)>.vx-note-fcol,.vx-note:not(.card)>.vx-note-top{display:none}
  .vx-note-main{gap:3px}
  .vx-note-meta{display:flex;align-items:center;gap:6px;min-width:0;font-size:12.5px;line-height:18px;color:var(--muted);white-space:nowrap;overflow:hidden}
  .vx-note-meta>time{flex:none}
  .vx-note-meta>time::before{content:"·";margin-right:6px;color:var(--text-3)}
  .vx-note-meta .vx-note-mf{font-size:12.5px;color:var(--text-2);gap:6px;min-width:2.5em;flex:0 1 auto}
  .vx-note-meta .vx-agent{margin-left:2px}
  .vx-note .vx-row-more{opacity:1;width:40px;height:40px}
  .vx-ltools{padding-left:16px}
  .vx-ltools .vx-label em{display:none}
  .vx-group{padding:16px 16px 6px}
  .vx-active{gap:6px}
  .vx-active-k{display:none}
  .vx-chip{height:32px;max-width:100%}
  .vx-active-all{height:32px}
}
@container vxlist (max-width:640px){
  .vx-browse{padding:16px 16px 96px}
  .vx-phead{gap:12px}
  .vx-btitle{gap:12px}
  .vx-bico{width:42px;height:42px;border-radius:12px}
  .vx-bico .vx-i{width:20px;height:20px}
  .vx-btext h1{font-size:22px}
  .vx-bmeta{font-size:13px}
  .vx-bacts{gap:6px}
  .vx-btitle{flex-wrap:wrap;row-gap:12px}
  .vx-btext{order:3;flex-basis:100%}
  .vx-btext h1{white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .vx-bacts{margin-left:auto}
  .vx-bmeta{white-space:normal}
  .vx-bacts .btn,.vx-bacts .vx-round{height:40px}
  .vx-bacts .vx-round{width:40px}
  /* New folder lives in the more menu here; New note keeps only its plus. */
  .vx-bacts [data-new-folder]{display:none}
  .vx-bacts .btn.primary{width:40px;padding:0;border-radius:50%}
  .vx-bacts .btn.primary span{display:none}
  .vx-bacts .btn.primary .vx-i{width:18px;height:18px}
  .vx-ltools{min-height:50px}
  .vx-ltools .ui-sel.vx-select,.vx-ltools .vx-icon-btn{height:40px}
  .vx-ltools .vx-icon-btn{width:40px}
  .vx-search{height:44px}
  .vx-search input{font-size:16px}
  .vx-tabs{height:40px}
  .vx-tabs button{height:34px}
  .vx-pill{height:34px}
  .vx-seg{height:44px}
  .vx-seg button{width:38px;height:38px}
  .vx-rows.cards{grid-template-columns:1fr;gap:10px}
  .vx-rows.cards>.vx-addrow{min-height:52px}
  .vx-tiles{grid-template-columns:1fr;gap:8px}
  .vx-tile{height:64px;padding:0 12px;gap:12px}
  .vx-tile-ico{width:36px;height:36px}
}
@container vxnote (max-width:900px){
  .vx-page{padding:24px 24px 120px;gap:16px}
  .vx-paper{padding:40px 40px 36px}
}
@container vxnote (max-width:640px){
  .vx-rbar .vx-crumbs{display:none}
  .vx-pcrumbs{display:flex}
  .vx-ct-btn{width:40px;padding:0;justify-content:center}
  .vx-ct-btn span{display:none}
  .vx-mode span{display:none}
  .vx-note-scroll{background:var(--paper)}
  .vx-page,.vx-page.editing{padding:0 0 120px;gap:12px}
  .vx-paper{border:0;border-radius:0;padding:24px 16px 28px}
  .vx-insp{padding:0 16px;box-sizing:border-box;grid-template-columns:1fr}
  .vx-icard{padding:16px}
  /* One row of tools that scrolls sideways rather than a stray second line. */
  .vx-toolbar{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding:6px 4px}
  .vx-toolbar::-webkit-scrollbar{display:none}
  .vx-toolbar button{flex:none;width:36px;height:36px}
  .vx-tsep{margin:0 2px}
  .vx-doc-title{font-size:28px;letter-spacing:-.5px}
  .vx-edit-hint{display:none}
  .vx-editor.note-editor{padding:16px 0}
  .vx-toolbar{top:8px}
  /* Phones: Save and Cancel move to a bar pinned to the bottom of the screen. */
  .vx-edit-btns{display:none}
  .vx-edit-foot{position:sticky;bottom:0;z-index:4;background:var(--paper);margin:0 -16px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));
    border-top:1px solid var(--line2, var(--line));box-shadow:none}
  .vx-edit-foot .vx-wc{display:none}
  .vx-edit-foot .vx-grow{display:none}
  .vx-edit-acts{display:flex;flex:1}
  .vx-edit-acts .btn{flex:1;height:46px;justify-content:center;font-size:15px;font-weight:650;border-radius:12px}
  .vx-edit-acts .btn.primary{flex:1.6}
}
@media (max-width:760px){
  .vx-row,.vx-pin{height:40px;min-height:40px}
  .vx-row-more,.vx-pin-x{opacity:1}
  .vx-end{display:flex;gap:2px;height:auto}
  .vx-row .vx-count{visibility:visible!important}
  .vx-row .vx-row-more{opacity:1;pointer-events:auto;width:32px;height:32px}
  .vx-rbar{height:56px;padding:0 8px 0 4px;gap:4px;position:sticky;top:0;z-index:3}
  .vx-rbar .vx-icon-btn{width:40px;height:40px}
  .vx-mode{height:36px}
}

/* light theme */
:root[data-theme=light] .vx-fico,:root[data-theme=light] .vx-pin-ico{filter:saturate(1.5) brightness(.8)}
:root[data-theme=light] :is(.vx-tile-ico,.vx-bico:not(.brand)){color:color-mix(in srgb,var(--fc) 72%,#0f172a)}
:root[data-theme=light] .vx-agent{color:color-mix(in srgb,var(--ac) 55%,#111)}
:root[data-theme=light] .vx-ghost{color:#fff}
:root[data-theme=light] .vx-rows,:root[data-theme=light] .vx-tile{box-shadow:none}

/* Overlays: frosted where blur is supported, solid when less transparency is asked for. */
@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
  .vx-menu,.vx-pop .vx-pop-card,.vx-sheet .vx-pop-card,.vx-suggest{background:color-mix(in srgb,var(--panel) 86%,transparent);
    -webkit-backdrop-filter:blur(16px) saturate(1.2);backdrop-filter:blur(16px) saturate(1.2)}
  .vx-sheet-back{-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px)}
}
@media (prefers-reduced-transparency:reduce){
  .vx-menu,.vx-pop .vx-pop-card,.vx-sheet .vx-pop-card,.vx-suggest{background:var(--panel);-webkit-backdrop-filter:none;backdrop-filter:none}
  .vx-sheet-back{-webkit-backdrop-filter:none;backdrop-filter:none}
}
:root:not([data-theme=light]) :is(.vx-menu,.vx-pop .vx-pop-card,.vx-sheet .vx-pop-card){border-top-color:rgba(148,163,184,.3)}
`;
