// Vault UI styles (theme tokens only; light theme overrides at the end).

export const VAULT_CSS = `
#view-vault.vx-view{padding:0;overflow:hidden}
.vx-i{width:16px;height:16px;flex:none;display:inline-block;vertical-align:-3px}
.vx-grow{flex:1 1 auto}
.vx-muted{color:var(--muted);font-size:13px;margin:8px 0}
.vx-emoji{font-size:14px;line-height:1;width:16px;text-align:center;display:inline-block}
kbd{font-family:var(--mono);font-size:10.5px;padding:1px 5px;border-radius:5px;border:1px solid var(--line);
  border-bottom-width:2px;background:var(--panel-2);color:var(--fg)}

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
.vx-icon-btn{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:var(--r-sm);border:0;
  background:none;color:var(--muted);cursor:pointer;flex:none;transition:background .15s,color .15s}
.vx-icon-btn:hover{background:var(--hover);color:var(--fg)}
.vx-icon-btn.on{color:var(--warn)}
.vx-icon-btn:focus-visible,.vx-row:focus-visible,.vx-note:focus-visible,.vx-pin:focus-visible,.vx-tile:focus-visible,
.vx-crumb:focus-visible,.vx-link:focus-visible,.vx-tag:focus-visible,.vx-toc-i:focus-visible,.vx-meta-folder:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
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
.vx-sec-head{display:flex;align-items:center;gap:6px;padding:6px 8px 4px;color:var(--muted);font-size:10.5px;
  font-weight:650;letter-spacing:.08em;text-transform:uppercase}
.vx-sec-title{display:flex;align-items:center;gap:6px;flex:1}
.vx-sec-title .vx-i{width:13px;height:13px}
/* A section title is a menu row: icon, name and count on the left, the
   chevron always at the far right, actions revealed on hover or focus. */
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
.vx-sec-count{font-size:10.5px;background:var(--panel-2);border-radius:20px;padding:1px 7px;letter-spacing:0}
.vx-sec-acts{display:flex;gap:2px}
.vx-sec-acts .vx-icon-btn{width:24px;height:24px}

.vx-pin-list{display:flex;flex-direction:column;gap:1px;padding:0 2px}
.vx-pin-empty{display:flex;align-items:center;justify-content:center;gap:6px;font-size:11.5px;color:var(--muted);padding:9px 10px;
  border:1.5px dashed var(--line-strong);border-radius:9px;margin:4px 4px 2px;text-align:center;transition:border-color .15s,background .15s,color .15s}
.vx-pin-empty.slim{padding:6px 10px;font-size:11px}
.vx-pin-empty svg{width:13px;height:13px;flex:none}
/* while something is dragged over Pinned, only the slot lights up (the section
   itself stays as it is; a drop anywhere on it still pins) */
.vx-drop-zone .vx-pin-empty,body.vx-dragging .vx-pins .vx-pin-empty{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.vx-pin{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;cursor:pointer;position:relative;min-height:30px}
.vx-pin:hover{background:var(--panel-2)}
.vx-pin.active{background:color-mix(in srgb,var(--accent) 12%,transparent)}
.vx-pin.missing{cursor:default}
.vx-pin.missing .vx-pin-ico,.vx-pin.missing .vx-pin-name{opacity:.5}
.vx-pin.missing .vx-pin-x{opacity:1}
.vx-pin-sub.vx-pin-miss{color:var(--warn);font-weight:600;max-width:none;flex:none}
.vx-pin-ico{display:inline-flex}
.vx-pin-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-pin-sub{font-size:10.5px;color:var(--muted);max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-pin-x{opacity:0;border:0;background:none;color:var(--muted);cursor:pointer;padding:2px;border-radius:5px;display:inline-flex}
.vx-pin-x .vx-i{width:13px;height:13px}
.vx-pin:hover .vx-pin-x,.vx-pin:focus-within .vx-pin-x{opacity:1}
.vx-pin-x:hover{color:var(--danger);background:var(--panel)}
.vx-drop-before::before,.vx-drop-after::after{content:"";position:absolute;left:6px;right:6px;height:2px;border-radius:2px;
  background:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 25%,transparent)}
.vx-drop-before::before{top:-1px}
.vx-drop-after::after{bottom:-1px}

.vx-tree{display:flex;flex-direction:column;outline:none}
.vx-row{display:flex;align-items:center;gap:6px;height:30px;padding:0 6px 0 calc(6px + var(--depth,0) * 14px);
  border-radius:8px;cursor:pointer;position:relative;color:var(--fg);transition:background .12s}
.vx-row:hover{background:var(--panel-2)}
.vx-row.sel{background:color-mix(in srgb,var(--fc,var(--accent)) 16%,transparent)}
.vx-row.sel .vx-fname{font-weight:620}
.vx-row.active{background:color-mix(in srgb,var(--accent) 14%,transparent)}
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
.vx-count{font-size:10.5px;color:var(--muted);font-variant-numeric:tabular-nums;min-width:18px;text-align:right}
.vx-row-more{opacity:0;border:0;background:none;color:var(--muted);cursor:pointer;padding:2px;border-radius:5px;display:inline-flex}
.vx-row:hover .vx-row-more,.vx-row:focus-visible .vx-row-more,.vx-note:hover .vx-row-more,.vx-note:focus-visible .vx-row-more{opacity:1}
/* Tree rows end in one fixed slot: a folder's count and the "more" button share it (stacked),
   so showing the button on hover or focus never moves or covers anything else on the row. */
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
.vx-ghost{position:fixed;top:-100px;left:-100px;padding:5px 11px;border-radius:8px;background:var(--accent);color:#04201c;
  font:600 12px/1.4 system-ui,sans-serif;box-shadow:var(--shadow);pointer-events:none}
.vx-rename{width:100%;font:inherit;font-size:13px;padding:3px 6px;border-radius:6px;border:1px solid var(--accent);
  background:var(--bg);color:var(--fg);outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}

/* ── folder browser ────────────────────────────────────────────── */
.vx-bscroll{position:absolute;inset:0;overflow:auto;outline:none}
.vx-browse{max-width:1040px;margin:0 auto;padding:24px 32px 72px}
.vx-bhead .vx-crumbs{margin:0 0 8px -8px}
.vx-up{width:28px;height:28px}
.vx-up .vx-i{width:15px;height:15px}
.vx-btitle{display:flex;align-items:center;gap:12px;min-height:40px}
.vx-bico{display:inline-flex;flex:none}
.vx-bico .vx-i{width:24px;height:24px}
.vx-bico .vx-emoji{font-size:22px;width:24px}
.vx-btitle h1{margin:0;font-size:26px;font-weight:700;letter-spacing:-.4px;line-height:1.25;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-fmenu{width:28px;height:28px}
.vx-bacts{display:flex;gap:8px;flex:none}
.vx-bacts .btn{display:inline-flex;align-items:center;gap:8px}
.vx-bacts .vx-i{width:16px;height:16px}
.vx-bmeta{margin:6px 0 0 36px;color:var(--muted);font-size:13px}
.vx-dot-sep{margin:0 8px;color:var(--text-3)}
.vx-bsec{margin-top:32px}
.vx-label{display:flex;align-items:baseline;gap:8px;margin:0;font-size:11px;font-weight:650;letter-spacing:.08em;
  text-transform:uppercase;color:var(--muted);white-space:nowrap}
.vx-label span{letter-spacing:0;font-weight:600;color:var(--text-3)}
.vx-label em{font-style:normal;text-transform:none;letter-spacing:0;font-weight:500;color:var(--text-3)}
.vx-bsec>.vx-label{margin-bottom:12px}
.vx-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.vx-tile{display:flex;align-items:center;gap:12px;height:56px;padding:0 16px;border-radius:var(--r);border:1px solid var(--line);
  background:var(--panel);color:var(--fg);font:inherit;text-align:left;cursor:pointer;min-width:0;transition:border-color .15s,background .15s}
.vx-tile:hover{border-color:var(--line-strong);background:var(--panel-2)}
.vx-tile-ico{display:inline-flex;color:var(--fc);flex:none}
.vx-tile-ico .vx-i{width:20px;height:20px}
.vx-tile-txt{display:flex;flex-direction:column;gap:2px;min-width:0}
.vx-tile-txt b{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-tile-txt small{font-size:12px;color:var(--muted);white-space:nowrap}
.vx-tile.vx-drop-into{border-color:var(--accent);background:var(--accent-soft)}

.vx-ltools{display:flex;align-items:center;gap:4px;margin-bottom:12px;min-height:32px}
.vx-ltools .vx-label{margin-right:8px}
/* Search: a full-width row of its own */
.vx-searchrow{margin-top:24px}
.vx-tabs+.vx-searchrow{margin-top:16px}
.vx-search{display:flex;align-items:center;gap:10px;height:44px;padding:0 6px 0 14px;border-radius:var(--r);cursor:text;
  border:1px solid var(--line);background:var(--panel);color:var(--muted);transition:border-color .15s,box-shadow .15s,color .15s}
.vx-search:hover{border-color:var(--line-strong)}
.vx-search .vx-i{width:16px;height:16px;flex:none}
.vx-search:focus-within{border-color:var(--accent-line);box-shadow:0 0 0 3px var(--accent-soft);color:var(--accent)}
.vx-search input{flex:1;min-width:0;border:0;background:none;color:var(--fg);font:inherit;font-size:14.5px;outline:none;height:100%;padding:0}
.vx-search input::placeholder{color:var(--muted)}
/* The box shows the focus; the field inside gets no ring of its own. */
.vx-search input:focus,.vx-search input:focus-visible{box-shadow:none;outline:none;border-radius:0}
.vx-search input::-webkit-search-cancel-button{display:none}
.vx-search-x{display:none;flex:none;place-items:center;width:32px;height:32px;border:0;background:none;border-radius:var(--r-sm);color:var(--muted);cursor:pointer}
.vx-search-x .vx-i{width:14px;height:14px}
.vx-search.has .vx-search-x{display:grid}
.vx-search-x:hover{background:var(--hover);color:var(--fg)}
/* Folders | Nodes tabs: the selected pill slides between them */
.vx-tabs{position:relative;display:inline-grid;grid-template-columns:1fr 1fr;gap:0;margin-top:16px;padding:4px;border-radius:12px;
  background:var(--surface-2);border:1px solid var(--line);--i:1}
.vx-tabs-pill{position:absolute;top:4px;bottom:4px;left:4px;width:calc(50% - 4px);border-radius:9px;background:var(--panel);
  box-shadow:0 1px 2px rgba(0,0,0,.18),0 0 0 1px var(--line);transform:translateX(calc(var(--i) * 100%));transition:transform .26s var(--ease-out)}
.vx-tabs button{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 16px;border:0;background:none;
  border-radius:9px;font:inherit;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;transition:color .2s}
.vx-tabs button .vx-i{width:15px;height:15px;transition:color .2s}
.vx-tabs button b{font-size:11.5px;font-weight:650;padding:1px 7px;border-radius:99px;background:var(--panel);color:var(--text-3);transition:background .2s,color .2s}
.vx-tabs button:hover{color:var(--fg)}
.vx-tabs button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.vx-tabs button[aria-selected=true]{color:var(--fg)}
.vx-tabs button[aria-selected=true] .vx-i{color:var(--accent)}
.vx-tabs button[aria-selected=true] b{background:var(--accent-soft);color:var(--accent)}
.vx-tabs+.vx-bsec{margin-top:20px}
.vx-tabbody{transition:opacity .14s var(--ease),transform .14s var(--ease)}
.vx-tabbody.out-left{opacity:0;transform:translateX(-16px)}
.vx-tabbody.out-right{opacity:0;transform:translateX(16px)}
.vx-tabbody.in-right{animation:vxTabR .26s var(--ease-out)}
.vx-tabbody.in-left{animation:vxTabL .26s var(--ease-out)}
@keyframes vxTabR{from{opacity:0;transform:translateX(20px)}}
@keyframes vxTabL{from{opacity:0;transform:translateX(-20px)}}
@media (prefers-reduced-motion:reduce){.vx-tabs-pill,.vx-tabbody{transition:none;animation:none}.vx-tabbody.out-left,.vx-tabbody.out-right{opacity:1;transform:none}}
/* The "opens" arrow on rows and tiles: slides in on hover and keyboard focus */
.vx-go{display:grid;place-items:center;flex:none;width:18px;color:var(--muted);opacity:0;transform:translateX(-6px);
  transition:opacity .16s var(--ease),transform .2s var(--ease-out),color .15s}
.vx-go .vx-i{width:16px;height:16px}
.vx-note:hover .vx-go,.vx-note:focus-visible .vx-go,.vx-tile:hover .vx-go,.vx-tile:focus-visible .vx-go{opacity:1;transform:none;color:var(--accent)}
.vx-tile .vx-go{margin-left:auto}
@media (hover:none) and (pointer:coarse){.vx-go{display:none}}
@media (prefers-reduced-motion:reduce){.vx-go{transition:opacity .1s;transform:none}}
/* "Did you mean" under an empty filter */
.vx-near{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;margin-top:10px;font-size:12.5px;color:var(--muted)}
.vx-near-b{height:28px;padding:0 10px;border-radius:99px;border:1px solid var(--line);background:var(--panel);color:var(--fg);font-size:12.5px;font-weight:600}
.vx-near-b:hover{border-color:var(--accent-line);color:var(--accent)}
.ui-sel.vx-select{position:relative;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:var(--r-sm);color:var(--muted);
  font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s;border:0;background:transparent;max-width:none}
.ui-sel.vx-select:hover{background:var(--hover);color:var(--fg)}
.ui-sel.vx-select:focus-visible,.ui-sel.vx-select[aria-expanded=true]{box-shadow:0 0 0 2px var(--accent-line);background:var(--hover);color:var(--fg)}
.vx-select .vx-i{width:14px;height:14px}
.vx-dir .vx-i{width:15px;height:15px;transform:rotate(180deg);transition:transform .2s}
.vx-dir.desc .vx-i{transform:none}
.vx-bulk{display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:8px 8px 8px 16px;border-radius:var(--r);font-size:13px;
  background:var(--accent-soft);border:1px solid var(--accent-line);flex-wrap:wrap}
.vx-bulk .vx-i{width:14px;height:14px}

.vx-rows{border:1px solid var(--line);border-radius:var(--r);background:var(--panel);overflow:hidden;outline:none}
.vx-rows.empty{background:none;border-style:dashed}
.vx-note{display:flex;align-items:center;gap:16px;height:64px;padding:0 8px 0 16px;cursor:pointer;position:relative;
  border-top:1px solid var(--line);transition:background .12s}
.vx-note:first-child,.vx-group+.vx-note{border-top:0}
.vx-note:hover{background:var(--hover)}
.vx-note.sel{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}
.vx-note-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.vx-note-l1{display:flex;align-items:center;gap:8px;min-width:0}
.vx-note-name{font-size:14.5px;font-weight:600;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:0 1 auto}
.vx-note-name .vx-rename{font-size:14px}
.vx-note-pin{display:inline-flex;color:var(--muted);flex:none}
.vx-note-pin .vx-i{width:13px;height:13px}
.vx-note-folder{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap;min-width:0;flex:0 10 auto;overflow:hidden}
.vx-note-folder i{width:6px;height:6px;border-radius:50%;background:var(--fc);flex:none}
.vx-note-folder>span,.vx-note-mf>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-note-meta{display:none}
.vx-note-ex{font-size:13px;line-height:18px;height:18px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-note-ex.none{font-style:italic;color:var(--text-3)}
.vx-note-ex .vx-skel{display:block;width:min(60%,320px);height:8px;margin-top:5px;border-radius:4px}
.vx-note-side{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:none;max-width:38%}
.vx-note-top{display:flex;align-items:center;gap:8px;font-size:12px;line-height:20px;color:var(--muted);white-space:nowrap}
.vx-note-tags{display:flex;gap:4px;height:18px;max-width:100%;overflow:hidden}
.vx-chip-tag{font-size:11px;line-height:18px;padding:0 7px;border-radius:var(--r-pill);color:var(--tc);white-space:nowrap;
  background:color-mix(in srgb,var(--tc) 12%,transparent);max-width:120px;overflow:hidden;text-overflow:ellipsis}
.vx-note-thumb{display:none;flex:none;width:44px;height:44px;border-radius:var(--r-sm);overflow:hidden;background:var(--panel-2)}
.vx-note.has-thumb .vx-note-thumb{display:block}
.vx-note-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.vx-note .vx-row-more{width:28px;height:28px;display:grid;place-items:center;flex:none;opacity:0}
.vx-note:hover .vx-row-more,.vx-note:focus-visible .vx-row-more,.vx-note:focus-within .vx-row-more{opacity:1}
@media (hover:none){.vx-note .vx-row-more{opacity:1}}
.vx-group{display:flex;align-items:center;gap:8px;padding:16px 16px 8px;font-size:12px;font-weight:600;color:var(--muted);border-top:1px solid var(--line)}
.vx-group:first-child{border-top:0}
.vx-group i{width:7px;height:7px;border-radius:50%;background:var(--fc)}
.vx-agent{display:inline-grid;place-items:center;min-width:24px;height:24px;padding:0 4px;border-radius:12px;font-size:10px;font-weight:700;
  letter-spacing:.02em;color:var(--ac);background:color-mix(in srgb,var(--ac) 18%,transparent);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ac) 45%,transparent);flex:none}
.vx-agent.sm{min-width:18px;height:18px;font-size:8.5px;border-radius:9px;padding:0 3px}
.vx-empty{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;color:var(--muted);font-size:13.5px;padding:40px 24px}
.vx-empty .vx-i{width:28px;height:28px;opacity:.55}
.vx-empty p{margin:0 0 8px;line-height:1.55;max-width:44ch}
.vx-empty .btn{display:inline-flex;align-items:center;gap:6px}
.vx-missing{margin:auto}
.vx-keys{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:0;font-size:13px;align-items:center}
.vx-keys dt{display:flex;gap:4px}.vx-keys dd{margin:0;color:var(--muted)}

/* ── node reader ───────────────────────────────────────────────── */
.vx-rbar{display:flex;align-items:center;gap:8px;height:52px;padding:0 16px 0 12px;border-bottom:1px solid var(--line);flex:none;background:var(--bg)}
.vx-rbar .vx-back .vx-i{width:18px;height:18px}
.vx-rbar .vx-crumbs{flex:0 1 auto}
.vx-crumb .vx-i{width:14px;height:14px;margin-right:6px;flex:none}
.vx-crumb.cur{color:var(--fg);font-weight:600;cursor:default}
.vx-crumb.cur:hover{background:none}
.vx-aa-btn{font-size:14px;font-weight:650;letter-spacing:-.2px;font-family:var(--font)}
.vx-rbar .vx-icon-btn[aria-expanded=true]{background:var(--press);color:var(--fg)}
/* Phones: the breadcrumb on its own scrollable row under the bar. */
.vx-pcrumbs{display:none;align-items:center;gap:2px;overflow-x:auto;scrollbar-width:none;padding:0 12px;height:40px;flex:none;
  border-bottom:1px solid var(--line);background:var(--bg);white-space:nowrap}
.vx-pcrumbs::-webkit-scrollbar{display:none}
.vx-pcrumbs .vx-crumb{flex:none;height:32px}
.vx-pcrumbs .vx-crumb.cur span{max-width:60vw}
.vx-busy .vx-col{opacity:.55;transition:opacity .2s;pointer-events:none}
.vx-mode{display:inline-flex;align-items:center;gap:6px}
.vx-mode .vx-i{width:15px;height:15px}
.vx-note-scroll{flex:1;overflow:auto;outline:none;background:var(--bg);color:var(--fg);transition:background .2s,color .2s}
.vx-save{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);margin-right:4px;white-space:nowrap}
.vx-save i{width:7px;height:7px;border-radius:50%;background:var(--ok)}
.vx-save[data-state=dirty] i{background:var(--warn)}
.vx-save[data-state=saving] i{background:var(--accent-2);animation:vxPulse 1s infinite}
.vx-save[data-state=error] i,.vx-save[data-state=conflict] i{background:var(--danger)}
.vx-save[data-state=error],.vx-save[data-state=conflict]{color:var(--danger);font-weight:600}
.vx-page{display:grid;grid-template-columns:minmax(0,var(--rw,100%));justify-content:start;gap:56px;padding:40px 40px 120px}
.vx-page.editing{padding-top:32px}
.vx-col{min-width:0}
.vx-doc-title{font-size:34px;line-height:1.2;font-weight:720;letter-spacing:-.6px;margin:0 0 12px;cursor:text;word-break:break-word}
.vx-doc-title .vx-rename{font-size:28px;font-weight:700}
.vx-doc-meta{display:flex;flex-wrap:wrap;align-items:center;row-gap:8px;font-size:13px;color:var(--muted);line-height:22px}
.vx-doc-meta>*{display:inline-flex;align-items:center;gap:6px}
.vx-doc-meta>*+*::before{content:"·";margin:0 10px;color:var(--text-3)}
.vx-meta-folder{border:0;background:none;color:var(--text-2);font:inherit;padding:0;cursor:pointer;border-radius:4px}
.vx-meta-folder:hover{color:var(--fg);text-decoration:underline;text-underline-offset:3px}
.vx-meta-folder i{width:8px;height:8px;border-radius:50%;background:var(--fc)}
.vx-meta-pin .vx-i{width:13px;height:13px}
.vx-touch{color:var(--text-2)}
.vx-doc-meta>.vx-tags{flex-wrap:wrap;gap:6px;margin-left:12px}
.vx-doc-meta>.vx-tags::before{content:none}
.vx-tag{border:0;font:inherit;font-size:12px;line-height:22px;padding:0 9px;border-radius:var(--r-pill);cursor:pointer;color:var(--tc);
  background:color-mix(in srgb,var(--tc) 12%,transparent);transition:background .15s}
.vx-tag:hover{background:color-mix(in srgb,var(--tc) 22%,transparent)}

.vx-prose{margin-top:32px;font-family:var(--font);font-size:var(--rsize,16px);line-height:1.72;color:var(--fg)}
[data-rfont=serif] .vx-prose{font-family:ui-serif,"Iowan Old Style","Charter","Georgia","Cambria",serif;line-height:1.75}
[data-rfont=mono] .vx-prose{font-family:var(--mono);font-size:calc(var(--rsize,16px) * .92);line-height:1.75}
[data-rfont=serif] .vx-prose :is(h1,h2,h3,h4){font-family:ui-serif,"Iowan Old Style","Charter","Georgia",serif;letter-spacing:0}
[data-rfont=rounded] .vx-prose{font-family:ui-rounded,"SF Pro Rounded","Nunito","Varela Round","Quicksand",var(--font)}
[data-rfont=legible] .vx-prose{font-family:"Atkinson Hyperlegible","Verdana","Tahoma",var(--font);letter-spacing:.01em;word-spacing:.04em}
[data-rlead=compact] .vx-prose{line-height:1.5}
[data-rlead=relaxed] .vx-prose{line-height:2}
[data-ralign=justify] .vx-prose :is(p,li,blockquote){text-align:justify;hyphens:auto;-webkit-hyphens:auto}
.vx-prose>:first-child{margin-top:0}
.vx-prose p{margin:0 0 1em;text-wrap:pretty}
.vx-prose li{text-wrap:pretty;margin:.3em 0}
.vx-prose ul,.vx-prose ol{margin:0 0 1em;padding-left:1.5em}
.vx-prose li::marker{color:var(--muted)}
.vx-prose h1,.vx-prose h2,.vx-prose h3,.vx-prose h4{color:var(--fg);font-weight:680;letter-spacing:-.25px;line-height:1.3}
.vx-prose h1{font-size:1.55em;border-bottom:0;padding:0;margin:1.8em 0 .5em}
.vx-prose h2{font-size:1.3em;margin:1.9em 0 .5em}
.vx-prose h3{font-size:1.07em;margin:1.6em 0 .4em}
.vx-prose h4{font-size:.95em;margin:1.4em 0 .4em;color:var(--text-2)}
.vx-prose :is(h1,h2,h3,h4){scroll-margin-top:24px}
.vx-prose a{color:var(--accent-2);text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--accent-2) 40%,transparent);text-underline-offset:3px}
.vx-prose a.wl{color:var(--accent);text-decoration:none;cursor:pointer;border-bottom:1px solid var(--accent-line)}
.vx-prose a.wl:hover{background:var(--accent-soft)}
.vx-prose a.wl.broken{color:var(--muted);border-bottom:1px dashed currentColor;background:none}
.vx-prose a.wl.broken::after{content:"+";display:inline-grid;place-items:center;width:1.05em;height:1.05em;margin-left:.25em;border-radius:50%;
  border:1px dashed currentColor;font:600 .72em/1 var(--font);vertical-align:.12em;box-sizing:border-box}
.vx-prose a.wl.broken:hover{color:var(--fg);background:var(--hover)}
.vx-prose a.wl:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
.vx-hit{animation:vxHit 1.6s var(--ease)}
@keyframes vxHit{0%,30%{background:color-mix(in srgb,var(--accent) 22%,transparent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 22%,transparent)}100%{background:transparent;box-shadow:none}}
@media (prefers-reduced-motion:reduce){.vx-hit{animation:none;outline:2px solid var(--accent)}}
.vx-prose strong{font-weight:650}
.vx-prose blockquote{margin:1.2em 0;padding:2px 0 2px 16px;border-left:3px solid var(--line-strong);border-radius:0;background:none;color:var(--text-2);font-style:normal}
.vx-prose blockquote p:last-child{margin-bottom:0}
.vx-prose code{font-family:var(--mono);font-size:.86em;padding:.12em .4em;border-radius:var(--r-xs);border:0;background:var(--panel-2)}
.vx-prose pre{font-size:13px;line-height:1.65;padding:16px;margin:0 0 1.2em;border-radius:var(--r);overflow:auto}
.vx-prose pre code{font-size:13px;padding:0;background:none}
.vx-prose table{margin:0 0 1.2em;font-size:.875em;border-collapse:separate;border-spacing:0;border:1px solid var(--line);border-radius:var(--r)}
.vx-prose th,.vx-prose td{border:0;border-bottom:1px solid var(--line);padding:10px 14px;text-align:left;vertical-align:top}
.vx-prose tr:last-child td{border-bottom:0}
.vx-prose th{background:var(--panel-2);font-size:12.5px;font-weight:600;color:var(--text-2)}
.vx-prose hr{border:0;border-top:1px solid var(--line);margin:2em 0}
.vx-prose .task,.vx-prose li:has(>input[type=checkbox]){list-style:none;margin-left:-1.4em}
.vx-prose input[type=checkbox]{accent-color:var(--accent);margin:0 8px 0 0;vertical-align:-2px}
.vx-prose li.task.done{color:var(--muted)}
.vx-empty-doc{font-size:15px}
.vx-linkbtn{border:0;background:none;padding:0;font:inherit;color:var(--accent);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.vx-flash{animation:vxFlash 1.4s var(--ease)}
@keyframes vxFlash{0%{background:color-mix(in srgb,var(--accent-2) 14%,transparent)}100%{background:transparent}}

/* left rail (wide): the outline, then connections; folded sections (narrow) */
.vx-rail{display:none;flex-direction:column;gap:28px;position:sticky;top:24px;align-self:start;min-width:0;max-height:calc(100vh - 150px);
  overflow:auto;scrollbar-width:none;padding:0 4px 24px 0;margin-top:4px}
.vx-rail::-webkit-scrollbar{display:none}
.vx-toc-list{display:flex;flex-direction:column}
.vx-rsec h3{display:flex;align-items:baseline;gap:8px;margin:0 0 8px;font-size:11px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.vx-rsec h3 span{letter-spacing:0;color:var(--text-3)}
.vx-rsec .vx-muted{font-size:12.5px;margin:0}
.vx-toc-i{display:block;width:100%;text-align:left;border:0;background:none;color:var(--muted);font:inherit;font-size:13px;line-height:1.4;
  padding:4px 0 4px 12px;border-left:2px solid var(--line);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .15s,border-color .15s}
.vx-toc-i.sub{padding-left:24px}
.vx-toc-i:hover{color:var(--fg)}
.vx-toc-i.on{color:var(--fg);border-left-color:var(--accent)}
.vx-link{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:0 8px;width:calc(100% + 16px);text-align:left;border:0;
  background:none;color:var(--fg);font:inherit;padding:6px 8px;margin:0 -8px;border-radius:var(--r-sm);cursor:pointer}
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
@container vxnote (min-width:1000px){
  .vx-page:not(.editing):not(.no-rail){grid-template-columns:220px minmax(0,var(--rw,100%));gap:48px;padding-left:32px;padding-right:48px}
  .vx-page.editing,.vx-page.no-rail{padding-left:300px}
  .vx-rail{display:flex}
  /* Connections side by side under the text. */
  .vx-rfoot{display:grid;grid-template-columns:1fr 1fr;gap:0 40px;border-top:0}
  .vx-rfoot details{border-bottom:0;border-top:1px solid var(--line)}
  .vx-rfoot summary{pointer-events:none;height:48px;font-size:11px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  .vx-rfoot summary span{letter-spacing:0;color:var(--text-3)}
  .vx-rfoot summary::after{display:none}
  .vx-rfoot details>div{padding:0 0 8px}
  .vx-rfoot .vx-link{padding:8px}
}

/* reading colours: only inside the reading area, for both app themes */
.vx-note-scroll[data-rtone=sepia]{--bg:#1d1913;--fg:#eadcc4;--text-2:#d6c6aa;--muted:#a8977b;--text-3:#7f705a;--line:rgba(234,220,196,.13);
  --line-strong:rgba(234,220,196,.22);--panel:#241f17;--panel-2:#2c261c;--hover:rgba(234,220,196,.07);--accent:#e3b46c;--accent-2:#d7a15d;
  --accent-line:rgba(227,180,108,.45);--accent-soft:rgba(227,180,108,.13)}
:root[data-theme=light] .vx-note-scroll[data-rtone=sepia]{--bg:#f6efdf;--fg:#3b2f21;--text-2:#55452f;--muted:#7a6a52;--text-3:#a2927a;
  --line:rgba(59,47,33,.13);--line-strong:rgba(59,47,33,.22);--panel:#efe6d1;--panel-2:#e8dcc2;--hover:rgba(59,47,33,.06);--accent:#9a5b12;
  --accent-2:#8a4f12;--accent-line:rgba(154,91,18,.4);--accent-soft:rgba(154,91,18,.1)}
.vx-note-scroll[data-rtone=contrast]{--bg:#000;--fg:#fff;--text-2:#f1f3f6;--muted:#d4d9e2;--text-3:#aab2bf;--line:rgba(255,255,255,.32);
  --line-strong:rgba(255,255,255,.5);--panel:#0b0b0b;--panel-2:#1a1a1a;--hover:rgba(255,255,255,.1);--accent:#8af5e6;--accent-2:#b4bcff;
  --accent-line:rgba(138,245,230,.7);--accent-soft:rgba(138,245,230,.16)}
:root[data-theme=light] .vx-note-scroll[data-rtone=contrast]{--bg:#fff;--fg:#000;--text-2:#111;--muted:#2c3038;--text-3:#4b515c;
  --line:rgba(0,0,0,.38);--line-strong:rgba(0,0,0,.6);--panel:#fff;--panel-2:#eceef2;--hover:rgba(0,0,0,.07);--accent:#00594f;
  --accent-2:#2b1fb8;--accent-line:rgba(0,89,79,.7);--accent-soft:rgba(0,89,79,.1)}
.vx-note-scroll[data-rtone=night]{--bg:#111111;--fg:#cfcfcf;--text-2:#bdbdbd;--muted:#8a8a8a;--text-3:#666;--line:rgba(255,255,255,.08);
  --line-strong:rgba(255,255,255,.15);--panel:#181818;--panel-2:#202020;--hover:rgba(255,255,255,.05);--accent:#d8a657;--accent-2:#c79647;
  --accent-line:rgba(216,166,87,.4);--accent-soft:rgba(216,166,87,.1)}
:root[data-theme=light] .vx-note-scroll[data-rtone=night]{--bg:#e9e7e3;--fg:#2a2826;--text-2:#3d3a36;--muted:#6d6862;--text-3:#8e8881;
  --line:rgba(0,0,0,.1);--line-strong:rgba(0,0,0,.18);--panel:#e2dfda;--panel-2:#d8d4ce;--hover:rgba(0,0,0,.05);--accent:#8a5a12;
  --accent-2:#7a4f10;--accent-line:rgba(138,90,18,.4);--accent-soft:rgba(138,90,18,.1)}
.vx-note-scroll[data-rtone=paper]{--bg:#f5f1e8;--fg:#2b2620;--text-2:#433c33;--muted:#6f675c;--text-3:#978f83;--line:rgba(43,38,32,.12);
  --line-strong:rgba(43,38,32,.2);--panel:#efeadf;--panel-2:#e6e0d3;--hover:rgba(43,38,32,.05);--accent:#0f766e;--accent-2:#115e59;
  --accent-line:rgba(15,118,110,.4);--accent-soft:rgba(15,118,110,.1)}
.vx-note-scroll[data-rtone=mint]{--bg:#0c1916;--fg:#d6efe8;--text-2:#bfe2d8;--muted:#86ab9f;--text-3:#5f8278;--line:rgba(214,239,232,.1);
  --line-strong:rgba(214,239,232,.18);--panel:#10211d;--panel-2:#152a25;--hover:rgba(214,239,232,.06);--accent:#5eead4;--accent-2:#2dd4bf;
  --accent-line:rgba(94,234,212,.45);--accent-soft:rgba(94,234,212,.12)}
:root[data-theme=light] .vx-note-scroll[data-rtone=mint]{--bg:#eaf7f3;--fg:#123029;--text-2:#1f4239;--muted:#4b6f65;--text-3:#73958b;
  --line:rgba(18,48,41,.12);--line-strong:rgba(18,48,41,.2);--panel:#e0f2ec;--panel-2:#d3ebe3;--hover:rgba(18,48,41,.05);--accent:#0f766e;
  --accent-2:#115e59;--accent-line:rgba(15,118,110,.4);--accent-soft:rgba(15,118,110,.1)}
.vx-note-scroll[data-rtone=contrast] .vx-prose a{text-decoration-thickness:2px}
.vx-note-scroll[data-rtone=contrast] .vx-prose a.wl{border-bottom-width:2px}
/* Code in a reading colour takes its colours from that colour, never from the
   app theme (a light colour such as Paper in the dark app kept the dark
   block background). Inline code gets a hairline so it reads apart from text. */
:root .vx-note-scroll[data-rtone] .vx-prose code{color:var(--fg);background:var(--panel-2);box-shadow:inset 0 0 0 1px var(--line)}
:root .vx-note-scroll[data-rtone] .vx-prose pre{color:var(--fg);background:color-mix(in srgb,var(--panel-2) 70%,var(--bg));border-color:var(--line-strong)}
:root .vx-note-scroll[data-rtone] .vx-prose pre code{background:none;box-shadow:none}

/* floating panels: popover (wide) and bottom sheet (phones) */
.vx-pop{position:fixed;inset:0;z-index:190;pointer-events:none}
.vx-pop .vx-pop-card{position:fixed;pointer-events:auto;display:flex;flex-direction:column;width:340px;max-width:calc(100vw - 16px);
  background:var(--panel);border:1px solid var(--line-strong);border-radius:var(--r);box-shadow:var(--shadow);overflow:hidden;
  animation:vxPop .14s var(--ease)}
.vx-pop.vx-pop-ct .vx-pop-card{width:440px;height:min(520px,calc(100vh - 120px))}
.vx-pop-head{display:flex;align-items:center;gap:8px;padding:8px 8px 4px 16px;flex:none}
.vx-pop-head b{flex:1;font-size:13px;font-weight:650}
.vx-pop-body{overflow:auto;min-height:0;flex:1}
.vx-sheet{position:fixed;inset:0;z-index:190}
.vx-sheet-back{position:absolute;inset:0;background:rgba(0,0,0,.45);opacity:0;transition:opacity .22s var(--ease)}
.vx-sheet .vx-pop-card{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;max-height:82vh;background:var(--panel);
  border-radius:20px 20px 0 0;border-top:1px solid var(--line-strong);box-shadow:var(--shadow-lg);padding-bottom:var(--safe-b,0px);
  transform:translateY(100%);transition:transform .26s var(--ease-out)}
.vx-sheet.vx-pop-ct .vx-pop-card{height:72vh}
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
.vx-seg3 .ff-serif b{font-family:ui-serif,Georgia,serif}
.vx-seg3 .ff-mono b{font-family:var(--mono);font-size:16px}
.vx-seg3 .sw{width:22px;height:22px;border-radius:50%;border:1px solid var(--line-strong)}
.sw-default{background:var(--bg)}
.sw-sepia{background:#f3e9d2;box-shadow:inset -11px 0 0 #2a2219}
.sw-contrast{background:#fff;box-shadow:inset -11px 0 0 #000}
.sw-night{background:#cfcfcf;box-shadow:inset -11px 0 0 #111}
.sw-paper{background:#f5f1e8;box-shadow:inset -11px 0 0 #2b2620}
.sw-mint{background:#d6efe8;box-shadow:inset -11px 0 0 #0c1916}
.vx-seg3.two{grid-template-columns:repeat(2,1fr)}
.vx-seg3 .ff-rounded b{font-family:ui-rounded,"SF Pro Rounded","Nunito",var(--font)}
.vx-seg3 .ff-legible b{font-family:"Atkinson Hyperlegible","Verdana",var(--font)}
/* little pictures for line spacing, width and alignment */
.vx-seg3 :is(.lh,.wd,.al){display:flex;flex-direction:column;justify-content:center;width:26px;height:22px}
.vx-seg3 :is(.lh,.wd,.al) b{display:block;height:2px;border-radius:1px;background:currentColor;font-size:0}
.vx-seg3 .lh-compact{gap:2px}.vx-seg3 .lh-normal{gap:4px}.vx-seg3 .lh-relaxed{gap:6px}
.vx-seg3 .wd{align-items:center;border-left:2px solid currentColor;border-right:2px solid currentColor;padding:0 2px}
.vx-seg3 .wd b{height:10px;opacity:.5}
.vx-seg3 .wd-narrow b{width:8px}.vx-seg3 .wd-wide b{width:14px}.vx-seg3 .wd-full b{width:100%}
.vx-seg3 .al{gap:3px}
.vx-seg3 .al-left b:nth-child(2){width:70%}.vx-seg3 .al-left b:nth-child(3){width:85%}
.vx-aa-reset{align-self:flex-start;border:0;background:none;color:var(--accent);font:inherit;font-size:12.5px;padding:4px 0;cursor:pointer}
.vx-aa-reset:disabled{color:var(--text-3);cursor:default}
.vx-aa button:focus-visible,.vx-ct button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}

/* contents */
.vx-ct{display:flex;flex-direction:column;min-height:0;height:100%}
.vx-ct-tabs{display:flex;gap:2px;padding:4px 12px 0;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none;flex:none}
.vx-ct-tabs::-webkit-scrollbar{display:none}
.vx-ct-tabs button{flex:none;display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 10px;border:0;background:none;color:var(--muted);
  font:inherit;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.vx-ct-tabs button b{font-size:11px;font-weight:600;color:var(--text-3)}
.vx-ct-tabs button:hover{color:var(--fg)}
.vx-ct-tabs button[aria-selected=true]{color:var(--fg);border-bottom-color:var(--accent)}
.vx-ct-list{overflow:auto;padding:8px;flex:1;min-height:0}
.vx-ct-list .vx-muted{padding:8px}
.vx-ct-i{display:flex;align-items:center;gap:10px;width:100%;min-height:40px;padding:6px 10px;border:0;border-radius:var(--r-sm);background:none;
  color:var(--fg);font:inherit;font-size:13.5px;text-align:left;cursor:pointer}
.vx-ct-i:hover{background:var(--hover)}
.vx-ct-i.top{font-weight:650}
.vx-ct-i.sub{padding-left:26px;color:var(--text-2)}
.vx-ct-i>span{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.vx-ct-i>span,.vx-ct-i b,.vx-ct-i small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-ct-i b{font-weight:550}
.vx-ct-i small{font-size:12px;color:var(--muted)}
.vx-ct-i>i{width:8px;height:8px;border-radius:50%;background:var(--fc,var(--muted));flex:none}
.vx-ct-i>i.new{background:none;border:1px dashed var(--muted)}
.vx-ct-i.missing b{color:var(--muted)}
.vx-ct-i>.vx-i{width:14px;height:14px;color:var(--muted);flex:none}
@media (max-width:760px){.vx-ct-i{min-height:52px;font-size:15px}.vx-ct-tabs button{height:48px;font-size:14px}}
.vx-skel{height:14px;border-radius:7px;background:var(--panel-2);animation:vxSk 1.4s ease-in-out infinite}
@keyframes vxSk{50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.vx-skel{animation:none}}

/* editor */
.vx-edit{margin-top:24px;position:relative;border:1px solid var(--line);border-radius:var(--r);background:var(--panel)}
.vx-toolbar{display:flex;gap:2px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--line);position:sticky;top:0;
  background:var(--panel);z-index:2;border-radius:var(--r) var(--r) 0 0;flex-wrap:wrap}
.vx-toolbar button{width:32px;height:30px;display:grid;place-items:center;border:0;background:none;color:var(--muted);border-radius:var(--r-xs);cursor:pointer}
.vx-toolbar button:hover{background:var(--hover);color:var(--fg)}
.vx-toolbar button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.vx-edit-hint{font-size:12px;color:var(--muted);padding-right:8px}
.vx-edit-hint kbd{font-size:10px}
.vx-editor.note-editor{display:block;width:100%;min-height:360px;border:0;border-radius:0;resize:none;background:transparent;color:var(--fg);
  font-family:var(--mono);font-size:14px;line-height:1.75;padding:20px 24px;outline:none;tab-size:2;overflow:hidden;box-sizing:border-box}
.vx-edit:focus-within{border-color:var(--accent-line)}
.vx-edit-foot{display:flex;align-items:center;gap:10px;padding:8px 16px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
.vx-edit-btns{display:inline-flex;gap:6px;align-items:center}
.vx-edit-btns .vx-i,.vx-edit-acts .vx-i{width:15px;height:15px}
.vx-edit-btns .btn.primary,.vx-edit-acts .btn.primary{display:inline-flex;align-items:center;gap:6px}
.vx-edit-acts{display:none;gap:8px}
.vx-suggest{position:absolute;left:24px;z-index:5;min-width:220px;max-width:340px;background:var(--panel);border:1px solid var(--line);
  border-radius:var(--r);box-shadow:var(--shadow);padding:4px;display:flex;flex-direction:column}
.vx-suggest button{display:flex;align-items:center;gap:8px;border:0;background:none;color:var(--fg);font:inherit;font-size:13px;
  padding:6px 8px;border-radius:var(--r-xs);cursor:pointer;text-align:left}
.vx-suggest button.on,.vx-suggest button:hover{background:var(--accent-soft)}
.vx-conflict{margin-top:24px;border:1px solid color-mix(in srgb,var(--danger) 45%,transparent);border-radius:var(--r);
  background:var(--danger-soft);padding:12px 16px}
.vx-conflict-head{display:flex;gap:12px;font-size:13.5px}
.vx-conflict-head .vx-i{color:var(--danger);width:20px;height:20px;margin-top:1px}
.vx-conflict-head p{margin:4px 0 0;color:var(--muted);font-size:13px}
.vx-conflict-acts{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px}
.vx-theirs{max-height:320px;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-sm);padding:12px;margin:12px 0 0;
  font-size:12px;line-height:1.55;white-space:pre-wrap}
.vx-theirs.hidden{display:none}
.vx-theirs span,.vx-theirs em{display:block;min-height:1.55em}
.vx-theirs .add{color:var(--ok);display:block;background:var(--ok-soft)}
.vx-theirs .del{color:var(--danger);display:block;background:var(--danger-soft)}
.vx-theirs em{color:var(--muted)}

/* ── menu, picker ──────────────────────────────────────────────── */
.vx-menu{position:fixed;z-index:200;min-width:210px;background:var(--panel);border:1px solid var(--line);border-radius:12px;
  box-shadow:var(--shadow);padding:5px;animation:vxPop .12s var(--ease)}
@keyframes vxPop{from{opacity:0;transform:scale(.97) translateY(-3px)}}
.vx-menu-item{display:flex;align-items:center;gap:10px;width:100%;border:0;background:none;color:var(--fg);font:inherit;font-size:13px;
  padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left}
.vx-menu-item .vx-i{color:var(--muted);width:15px;height:15px}
.vx-menu-item:hover,.vx-menu-item:focus-visible{background:var(--panel-2);outline:none}
.vx-menu-item:disabled{opacity:.4;cursor:default;background:none}
.vx-menu-item.danger,.vx-menu-item.danger .vx-i{color:var(--danger)}
.vx-menu-label{flex:1}
.vx-menu-item kbd{font-size:10px;color:var(--muted)}
.vx-menu-sep{height:1px;background:var(--line);margin:4px 6px}
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
.vx-iconpick{width:36px;height:36px;border-radius:9px;border:1px solid var(--line);background:var(--panel-2);cursor:pointer;display:grid;place-items:center}
.vx-iconpick.on,.vx-iconpick:hover{border-color:var(--accent)}
.vx-iconpick .vx-i{width:18px;height:18px}

/* ── responsive ────────────────────────────────────────────────── */
@container vxlist (max-width:640px){
  .vx-browse{padding:16px 16px 96px}
  .vx-bacts .btn:not(.primary) span{display:none}
  .vx-bacts .btn:not(.primary){padding-left:10px;padding-right:10px}
  /* Controls under the search: one row that scrolls sideways if needed. */
  .vx-ltools{overflow-x:auto;scrollbar-width:none;margin-right:-16px;padding-right:16px}
  .vx-ltools::-webkit-scrollbar{display:none}
  .vx-ltools>*{flex:none}
  .vx-ltools .ui-sel.vx-select,.vx-ltools .vx-icon-btn{height:40px;font-size:13px}
  .vx-searchrow{margin-top:16px}
  .vx-search{height:48px}
  .vx-search input{font-size:16px}
  .vx-tabs{display:flex}
  .vx-tabs button{flex:1;justify-content:center}
  .vx-tiles{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
  .vx-note-tags{display:none}
  /* Phones: title, excerpt, then one small meta line; nothing overlaps. */
  .vx-note{height:auto;min-height:84px;padding:12px 4px 12px 16px;gap:8px;align-items:center}
  .vx-note-side{display:none}
  .vx-note-folder{display:none}
  .vx-note-meta{display:flex;align-items:center;gap:6px;min-width:0;font-size:12px;line-height:18px;color:var(--muted);white-space:nowrap;overflow:hidden}
  .vx-note-meta>*+*::before{content:"·";margin-right:6px;color:var(--text-3)}
  .vx-note-meta>:empty{display:none}
  /* Folder path and tags shrink with an ellipsis (on the inner text: a flex box clips without one); the time never shrinks. */
  .vx-note-meta>time{flex:none}
  .vx-note-mf{display:inline-flex;align-items:center;gap:5px;min-width:3em;flex:0 1 auto;overflow:hidden}
  .vx-note-mf i{width:6px;height:6px;border-radius:50%;background:var(--fc);flex:none}
  /* Tags: the first one shrinks with an ellipsis, a second one that does not fit wraps onto a hidden line. */
  .vx-note-mtags{display:inline-flex;flex-wrap:wrap;column-gap:6px;height:18px;min-width:4.5em;flex:0 1 auto;overflow:hidden}
  .vx-note-meta>.vx-note-mtags::before{content:none}
  .vx-note-mtags span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .vx-note-mtags span:first-child::before{content:"·";margin-right:6px;color:var(--text-3)}
  .vx-note-mtags span{color:var(--tc)}
  .vx-note .vx-row-more{opacity:1;width:40px;height:40px}
  .vx-note-thumb{width:48px;height:48px}
}
@container vxnote (max-width:640px){
  .vx-rbar .vx-crumbs{display:none}
  .vx-pcrumbs{display:flex}
  .vx-mode span{display:none}
  .vx-page,.vx-page.editing{padding:24px 20px 120px}
  .vx-doc-title{font-size:28px;letter-spacing:-.5px}
  .vx-prose{line-height:1.7}
  .vx-edit-hint{display:none}
  .vx-editor.note-editor{padding:16px}
  /* Phones: Save and Cancel move to a bar pinned to the bottom of the screen. */
  .vx-edit-btns{display:none}
  .vx-edit-foot{position:sticky;bottom:0;z-index:4;background:var(--bg);padding:10px 12px calc(10px + env(safe-area-inset-bottom));
    border-top:1px solid var(--line2, var(--line));box-shadow:0 -8px 24px rgba(0,0,0,.22)}
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
  .vx-btitle h1{font-size:23px}
  .vx-bico .vx-i{width:22px;height:22px}
  .vx-bmeta{margin-left:34px}
  .vx-tile{height:60px;padding:0 12px;gap:10px}
  .vx-note-name{font-size:15px}
  .vx-note-ex{font-size:13.5px}
  .vx-rbar{height:56px;padding:0 8px 0 4px;gap:4px;position:sticky;top:0;z-index:3}
  .vx-rbar .vx-icon-btn{width:40px;height:40px}
  .vx-mode{height:36px}
}

/* light theme */
:root[data-theme=light] .vx-fico,:root[data-theme=light] .vx-tile-ico,:root[data-theme=light] .vx-bico,:root[data-theme=light] .vx-pin-ico{filter:saturate(1.5) brightness(.8)}
:root[data-theme=light] .vx-tag,:root[data-theme=light] .vx-chip-tag,:root[data-theme=light] .vx-note-mtags span{color:color-mix(in srgb,var(--tc) 60%,#111)}
:root[data-theme=light] .vx-agent{color:color-mix(in srgb,var(--ac) 55%,#111)}
:root[data-theme=light] .vx-ghost{color:#fff}
:root[data-theme=light] .vx-prose a.wl.broken{border-bottom-color:#9aa5b5}
:root[data-theme=light] .vx-prose pre{background:var(--surface-2)}
:root[data-theme=light] .vx-rows,:root[data-theme=light] .vx-tile{box-shadow:var(--shadow-sm)}
`;
