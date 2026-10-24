export const SHELL_CSS = `
#app{display:grid;grid-template-columns:var(--sb) minmax(0,1fr);height:100vh;height:100dvh;position:relative;
  background:var(--bg-grad),var(--bg);transition:grid-template-columns var(--dur-3) var(--ease-out)}
#sideScrim{display:none}
#main{grid-column:2;grid-row:1;display:flex;flex-direction:column;min-width:0;min-height:0;position:relative}
#views{flex:1 1 auto;min-height:0;position:relative;outline:none}
.view{position:absolute;inset:0;overflow:auto;padding:24px 24px 64px;scroll-padding-top:16px}
.view:not(.hidden){animation:view-in var(--dur-3) var(--ease-out)}
@keyframes view-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
#view-graph,#view-brain,#view-canvas{padding:0;overflow:hidden}
.skip-link{position:fixed;left:12px;top:-60px;z-index:200;padding:8px 14px;border-radius:10px;background:var(--surface-1);
  border:1px solid var(--line-strong);color:var(--fg);font-weight:600;transition:top var(--dur-2)}
.skip-link:focus{top:12px}

.brand-tile{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;flex:none;
  box-shadow:none}
.brand-tile.sm{width:32px;height:32px;border-radius:10px}
.brand-mark{width:100%;height:100%;display:block}

#app.side-collapsed #sidebar{cursor:pointer}
/* Shares add up to 100% so the rail stays opaque. */
@media (min-width:761px) and (hover:hover){#app.side-collapsed #sidebar:hover{background:color-mix(in srgb,var(--side-bg) 97%,var(--fg) 3%)}}
#app.side-collapsed #sidebar :is(button,a,input){cursor:pointer}
#sidebar{grid-column:1;grid-row:1;display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden;z-index:30;position:relative;
  background:var(--side-bg);border-right:1px solid var(--line)}
.side-head{display:flex;align-items:center;gap:2px;height:64px;padding:0 10px 0 16px;flex:none}

.brand{display:flex;align-items:center;gap:11px;padding:4px;margin-left:-4px;border-radius:12px;min-width:0;flex:1 1 auto;text-align:left}
.brand:hover .brand-tile{border-color:rgba(94,234,212,.45)}
.brand-text{display:flex;flex-direction:column;line-height:1.15;font-weight:720;font-size:15px;letter-spacing:-.015em;min-width:0;white-space:nowrap}
.brand-wrap{position:relative;flex:1 1 auto;min-width:0;display:flex;align-items:center}
.brand-wrap .brand{flex:1 1 auto}
.brand-wrap .brand-text{padding-bottom:19px}
.brand-ver{position:absolute;left:45px;top:calc(50% + 4px);display:inline-flex;align-items:center;gap:6px;height:18px;padding:0 4px;
  margin-left:-4px;border-radius:6px;font-size:11.5px;font-weight:500;color:var(--muted);white-space:nowrap;transition:color var(--dur-1),background var(--dur-1)}
.brand-ver:hover{color:var(--fg);background:var(--hover)}
.brand-upd{display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.02em;
  color:#0b0e14;background:var(--accent)}
.brand-upd[hidden]{display:none}
.brand-text small{font-weight:500;font-size:11.5px;color:var(--muted);letter-spacing:0;overflow:hidden;text-overflow:ellipsis;max-width:150px}
.side-collapse .sc-chev{flex:none;transition:transform var(--dur-3) var(--ease-out)}
.side-close{display:none}

.side-tool{display:grid;place-items:center;flex:none;width:32px;height:32px;padding:0;border-radius:8px;color:var(--muted);
  transition:background var(--dur-1),color var(--dur-1)}
.side-tool:hover{background:var(--hover);color:var(--fg)}
.side-tool:active{background:var(--press)}
.side-tool .i{width:19px;height:19px;stroke-width:1.8}
.side-tool .side-new-label{display:none}
#app:not(.side-collapsed) #sideCollapse,#app.side-collapsed #sideCollapseTop{display:none}

.side-actions{display:flex;padding:2px 12px 16px;flex:none}
.side-new-label{flex:1;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.side-find{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:10px;height:40px;padding:0 8px 0 12px;border-radius:10px;font-size:14px;font-weight:450;
  color:var(--muted);background:color-mix(in srgb,var(--fg) 5%,transparent);border:1px solid transparent;transition:border-color var(--dur-1),background var(--dur-1),color var(--dur-1)}
.side-find .i{width:18px;height:18px;stroke-width:1.8}
.side-find:hover{color:var(--text-2);border-color:var(--line-strong)}
.side-find kbd{height:auto;min-width:0;padding:0;border:0;background:none;box-shadow:none;font:500 11.5px/1 var(--font);color:var(--text-3)}
.nav-item .ni-badge{display:none;align-items:center;gap:6px;margin-left:auto;font-size:11.5px;font-weight:600;line-height:1;color:var(--text-3);font-variant-numeric:tabular-nums}
.nav-item .ni-badge::before{content:"";width:6px;height:6px;border-radius:50%;background:#5eead4;box-shadow:0 0 0 3px rgba(94,234,212,.16);animation:ni-live 2s ease-in-out infinite}
@keyframes ni-live{50%{box-shadow:0 0 0 5px rgba(94,234,212,0)}}
.nav-item .ni-badge.on{display:inline-flex}
.nav-item.active .ni-badge{color:#cbd5e1}
@media (prefers-reduced-motion:reduce){.nav-item .ni-badge::before{animation:none}}
.nav-item .ni-badge.on~.ni-kbd{display:none}

.side-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;padding-bottom:12px}
.nav{display:flex;flex-direction:column;gap:2px;padding:0 12px}
.nav-item{position:relative;display:flex;align-items:center;gap:12px;height:40px;padding:0 10px;border-radius:10px;
  color:var(--text-2);font-size:14.5px;font-weight:500;letter-spacing:-.005em;text-align:left;width:100%;white-space:nowrap;flex:none;border:1px solid transparent;
  transition:background var(--dur-1),color var(--dur-1),border-color var(--dur-1)}
.nav-item:hover{background:var(--hover);color:var(--fg)}
.ni-tile{flex:none;display:grid;place-items:center;width:20px;height:20px;color:var(--muted);transition:color var(--dur-1)}
.ni-tile .i{width:20px;height:20px;stroke-width:1.7}
.nav-item:hover .ni-tile{color:var(--text-2)}
.nav-item .ni-label{flex:1;overflow:hidden;text-overflow:ellipsis}
.nav-item.active{color:#f1f5f9;background:linear-gradient(180deg,#1b2433,#0d121b);border-color:transparent;font-weight:600;
  box-shadow:inset 0 0 0 1px rgba(94,234,212,.22)}
.nav-item.active .ni-tile{color:#5eead4}
#app{--brand-mark:linear-gradient(180deg,#5eead4,#22d3ee)}
:root[data-theme=light] #app{--brand-mark:linear-gradient(180deg,#14b8a6,#0891b2)}
.nav-item .ni-kbd{font-size:10.5px;color:var(--text-3);font-weight:500;opacity:0;transition:opacity var(--dur-1)}
.nav-item:hover .ni-kbd{opacity:1}

#sidebar .nav{margin:0 12px;padding:0 0 16px;border-bottom:1px solid var(--line)}
#sidebar .side-vault{margin-top:16px}
#sidebar .side-vault .sec-row{padding-bottom:2px}
#sidebar .sec-head{color:var(--muted)}
#sidebar .sec-title{font-size:12.5px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--text-2)}
#sidebar .vx-sec-head{font-size:12px;font-weight:500;letter-spacing:0;text-transform:none}
#sidebar .vx-sec-title>.vx-i{display:none}
#sidebar .vx-sec-count{background:none;padding:0;font-weight:500;color:var(--text-3)}
#sidebar .vx-fold-caret{opacity:0;transition:opacity .15s,transform .25s cubic-bezier(.2,.8,.2,1)}
#sidebar .vx-fold:hover .vx-fold-caret,#sidebar .vx-fold:focus-visible .vx-fold-caret,#sidebar .folded .vx-fold-caret{opacity:1}
@media (hover:none){#sidebar .vx-fold-caret{opacity:1}}
#sidebar .vx-sec-head{color:var(--muted);font-weight:600}
#sidebar .vx-fold{margin:0;padding-left:10px}
#sidebar .vx-fold:hover{color:var(--fg)}
#sidebar .vx-pins{padding-bottom:4px;margin-bottom:12px}
#sidebar .vx-kids-inner{position:relative}
#sidebar{--branch:var(--line-strong)}
#sidebar .vx-kids-inner::before{content:"";position:absolute;left:var(--gx);top:0;bottom:0;width:1px;background:var(--branch)}
#sidebar .vx-kids-inner>.vx-branch>.vx-row,#sidebar .vx-kids-inner>.vx-row{position:relative}
#sidebar .vx-kids-inner>.vx-branch>.vx-row::after,#sidebar .vx-kids-inner>.vx-row::after{content:"";position:absolute;left:var(--gx);top:calc(50% - 8px);
  width:6px;height:8px;border-left:1px solid var(--branch);border-bottom:1px solid var(--branch);border-bottom-left-radius:7px;box-sizing:border-box}
/* Hide the guide line below the last child's arm. */
#sidebar .vx-kids-inner>:last-child{position:relative}
#sidebar .vx-kids-inner>:last-child::before{content:"";position:absolute;left:var(--gx);top:7px;bottom:0;width:1px;background:var(--side-bg)}
#sidebar .vx-pins .vx-pin-empty{margin-left:12px}
#sidebar .vx-pin-empty{margin-top:4px;border:1px dashed var(--line-strong);border-radius:8px;background:none;color:var(--muted);font-size:12px}
#sidebar .vx-pin-empty.slim{display:flex;padding:7px 10px;font-size:11.5px}
#sidebar .vx-pin-list{position:relative;margin-left:12px;padding-left:10px}
#sidebar .vx-pin-list::before{content:"";position:absolute;left:0;top:0;bottom:0;width:1px;background:var(--branch)}
#sidebar .vx-pin-list>.vx-pin{position:relative}
#sidebar .vx-pin-list>.vx-pin::after{content:"";position:absolute;left:-10px;top:calc(50% - 8px);width:9px;height:8px;box-sizing:border-box;
  border-left:1px solid var(--branch);border-bottom:1px solid var(--branch);border-bottom-left-radius:8px}
#sidebar .vx-pin-list>.vx-pin:last-child::before{content:"";position:absolute;left:-10px;top:calc(50% - 8px);bottom:0;width:1px;background:var(--side-bg)}
#sidebar .vx-row,#sidebar .vx-pin{min-height:32px}
#sidebar .vx-row{height:32px}
/* Reorder markers win over the branch drawing. */
#sidebar .vx-pin-list>.vx-pin.vx-drop-before::before,#sidebar .vx-pin-list>.vx-pin.vx-drop-after::after{left:6px;right:6px;width:auto;height:2px;border-radius:2px;
  background:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 25%,transparent);z-index:2}
#sidebar .vx-pin-list>.vx-pin.vx-drop-before::before{top:-1px;bottom:auto}
#sidebar .vx-pin-list>.vx-pin.vx-drop-after::after{top:auto;bottom:-1px}
@media (max-width:760px){#sidebar .vx-kids-inner>:last-child::before{top:12px}}
.side-sec{display:flex;flex-direction:column;margin-top:18px;padding:0 12px}
.sec-row{display:flex;align-items:center;gap:4px}
.sec-row .sec-head{flex:1}
.sec-head{display:flex;align-items:center;gap:6px;height:30px;padding:0 8px 0 10px;color:var(--text-3);width:100%;text-align:left;border-radius:var(--r-xs);
  transition:color var(--dur-1),background var(--dur-1)}
.sec-head:hover{background:var(--hover);color:var(--text-2)}
.sec-title{font-size:11.5px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;flex:1}
.sec-caret{width:14px;height:14px;transition:transform var(--dur-3) var(--ease-out);opacity:.8}
.side-sec.collapsed .sec-caret,#libFold.folded .sec-caret{transform:rotate(-90deg)}
.sec-row .lib-act{opacity:0;pointer-events:none;transition:opacity .15s}
.sec-row:hover .lib-act,.sec-row:focus-within .lib-act{opacity:1;pointer-events:auto}
@media (hover:none){.sec-row .lib-act{opacity:1;pointer-events:auto}}
.sec-caret{transition:transform .25s cubic-bezier(.2,.8,.2,1)}
.sec-body{display:grid;grid-template-rows:1fr;transition:grid-template-rows var(--dur-3) var(--ease-out),opacity var(--dur-2)}
.side-sec.collapsed .sec-body{grid-template-rows:0fr;opacity:0}
.sec-inner{min-height:0;overflow:hidden;display:flex;flex-direction:column;padding-top:2px}
.icon-btn.sm{width:30px;height:30px;border-radius:var(--r-xs)}
.icon-btn.sm .i{width:16px;height:16px}
.sec-count{font-size:11px;font-weight:600;color:var(--muted);background:color-mix(in srgb,var(--fg) 6%,transparent);border-radius:var(--r-xs);padding:0 6px;line-height:18px}
.pin-head{display:flex;align-items:center;justify-content:space-between;padding:6px 8px 4px 13px;font-size:11.5px;font-weight:650;color:var(--text-3)}
.pinned{display:flex;flex-direction:column;gap:1px;max-height:190px;overflow:auto;padding-bottom:6px}
.side-vault.vx .side-search,.side-vault.vx .sec-pins{display:none}
.side-search{display:flex;align-items:center;gap:7px;margin:4px 0 8px;padding:0 6px 0 10px;height:34px;
  background:color-mix(in srgb,var(--fg) 4%,transparent);border:1px solid transparent;border-radius:var(--r-sm);transition:border-color var(--dur-1),box-shadow var(--dur-1)}
.side-search:focus-within{border-color:var(--accent-line);box-shadow:0 0 0 3px var(--accent-soft)}
.side-search .i{width:14px;height:14px;color:var(--muted)}
.side-search input{flex:1;min-width:0;background:none;border:0;outline:none;padding:0;font-size:12.5px;box-shadow:none}
.side-search input::-webkit-search-cancel-button{display:none}
.ss-clear{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;color:var(--muted)}
.ss-clear .i{width:13px;height:13px}
.ss-clear:hover{color:var(--fg);background:var(--hover)}
.tree{flex:none;padding:0 0 6px}
.tree-empty{padding:8px 13px;color:var(--muted);font-size:12px}

.side-foot{flex:none;display:flex;flex-direction:column;gap:8px;padding:8px 12px calc(12px + var(--safe-b));border-top:1px solid var(--line)}
.side-links{display:flex;flex-direction:column;gap:2px}
.side-foot .user-avatar,.pm-head .user-avatar{background:linear-gradient(180deg,#3b82f6,#2563eb);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.22)}
.side-foot .user-avatar{width:36px;height:36px;border-radius:10px;font-size:14px;font-weight:650}
.profile-btn{display:flex;align-items:center;gap:11px;width:100%;min-width:0;height:58px;padding:0 10px 0 10px;border:1px solid var(--line);background:var(--side-active);border-radius:12px;text-align:left;
  transition:background var(--dur-1)}
.profile-btn:hover,.profile-btn[aria-expanded=true]{border-color:var(--line-strong)}
.pb-main{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}
.pb-name{font-size:14px;line-height:1.35;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.side-stats{display:none}
.side-stats-pop{position:fixed;z-index:60;min-width:168px;padding:10px 12px;border-radius:var(--r);
  background:var(--ovl-bg);-webkit-backdrop-filter:var(--ovl-filter);backdrop-filter:var(--ovl-filter);border:1px solid var(--line-strong);
  box-shadow:none;animation:ssp-in .18s var(--ease-out)}
.side-stats-pop[hidden]{display:none}
.side-stats-pop h4{margin:0 0 6px;font-size:12px;font-weight:600;color:var(--muted)}
.side-stats-pop dl{margin:0;display:grid;grid-template-columns:1fr auto;gap:4px 18px;font-size:13px}
.side-stats-pop dt{color:var(--text-2)}
.side-stats-pop dd{margin:0;font-weight:700;font-variant-numeric:tabular-nums;text-align:right}
@keyframes ssp-in{from{opacity:0;transform:translateX(-6px)}}
.side-meta{position:relative;display:block;height:17px;font-size:12px;line-height:17px;color:var(--muted);overflow:hidden;white-space:nowrap;font-variant-numeric:tabular-nums}
.pb-stats,.pb-live{position:absolute;inset:0;overflow:hidden;text-overflow:ellipsis;transition:opacity .35s,transform .35s cubic-bezier(.2,.8,.2,1)}
.pb-stats{display:block}
/* Both lines move one full line height together, so they never overlap mid-switch. */
.pb-live{display:flex;align-items:center;gap:6px;font-weight:500;color:var(--text-2);opacity:0;transform:translateY(100%)}
.pb-live::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--ok)}
.side-meta.flip .pb-stats{opacity:0;transform:translateY(-100%)}
.side-meta.flip .pb-live{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){.pb-stats,.pb-live{transition:none}}
.pb-chev{width:16px;height:16px;flex:none;color:var(--muted);stroke-width:1.8}
.pm-scrim{position:fixed;inset:0;z-index:74}
.pm-scrim.dim{background:var(--scrim);-webkit-backdrop-filter:var(--scrim-filter);backdrop-filter:var(--scrim-filter);opacity:0;transition:opacity var(--dur-3) var(--ease-out)}
.pm-scrim.dim.on{opacity:1}
.pmenu{position:fixed;z-index:75;width:var(--sb);overflow:auto;overscroll-behavior:contain;padding:6px;
  background:var(--ovl-bg);-webkit-backdrop-filter:var(--ovl-filter);backdrop-filter:var(--ovl-filter);
  border:1px solid var(--line-strong);border-top-color:var(--ovl-edge);border-radius:14px;box-shadow:none;
  opacity:0;transform:translateY(8px);transition:opacity .18s var(--ease-out),transform .18s var(--ease-out)}
.pmenu[data-mode=rail]{transform:translateX(-8px)}
.pmenu.pm-open,.pmenu[data-mode=rail].pm-open{opacity:1;transform:none}
.pmenu.pm-closing{transition-duration:.14s;transition-timing-function:cubic-bezier(.4,0,1,1)}
.pm-grab{display:none}
:root .pmenu:not(.sheet){border-radius:12px;background:var(--surface-1);-webkit-backdrop-filter:none;backdrop-filter:none}
.pmenu{container-type:inline-size}
@container (max-width:250px){.pm-keys.alt,.pm-theme .seg .i{display:none}}
.pm-head{display:flex;align-items:center;gap:11px;padding:8px 8px 12px;margin:0 0 6px;border-bottom:1px solid var(--line)}
.pm-head .user-avatar{width:40px;height:40px;border-radius:10px;font-size:15px;font-weight:650}
.pm-who{flex:1;display:flex;flex-direction:column;gap:1px;min-width:0;line-height:1.4}
.pm-who b{font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pm-who>span{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden}
.pm-who em{font-style:normal;opacity:.6}
.pm-dot{width:7px;height:7px;flex:none;border-radius:50%;background:var(--ok)}
.pmenu .pm-close{display:none}
.pm-glabel{padding:8px 10px 6px;font-size:12px;font-weight:500;color:var(--muted)}
.pm-group+.pm-group{margin-top:4px;padding-top:4px;border-top:1px solid var(--line)}
.pm-group+.pm-group .pm-glabel{padding-top:6px}
.pm-theme{padding:0 4px 8px;margin-bottom:4px;border-bottom:1px solid var(--line)}
.pm-theme .seg{display:flex;width:100%}
.pm-theme .seg button{flex:1 1 0;min-width:0;padding:0 4px;gap:5px;font-size:13px}
.pm-theme .seg button[aria-pressed=true] .i{color:var(--fg)}
.pm-theme .seg button:focus-visible{outline:2px solid var(--accent-line);outline-offset:-1px}
.pm-item{position:relative;display:flex;align-items:center;gap:11px;width:100%;height:36px;padding:0 10px;border-radius:8px;text-align:left;
  font-size:13.5px;font-weight:500;color:var(--text-2);transition:background var(--dur-1),color var(--dur-1)}
.pm-item .i{width:18px;height:18px;flex:none;stroke-width:1.7;color:var(--muted);transition:color var(--dur-1)}
.pm-item:hover,.pm-item:focus-visible{background:var(--hover);color:var(--fg);box-shadow:none}
.pm-item:hover .i,.pm-item:focus-visible .i{color:var(--fg)}
.pm-item:focus-visible{outline:2px solid var(--accent-line);outline-offset:-2px}
.pm-item.active{background:transparent;color:var(--fg);font-weight:600}
.pm-item.active .i{color:var(--accent)}
.pm-item.active::after{content:"";width:6px;height:6px;border-radius:50%;margin-left:auto;background:var(--accent);flex:none}
@media (hover:none){.pm-item:focus-visible{outline:0;background:transparent}.pm-item:active{background:var(--hover)}}
.pm-label{flex:1;min-width:0;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pm-keys{display:flex;gap:3px;flex:none;opacity:.8}
.pm-keys kbd{height:18px;min-width:18px;padding:0 4px;font-size:10px}
.pm-live{display:inline-flex;align-items:center;gap:5px;flex:none;font-size:12px;font-weight:600;color:var(--accent)}
.pm-live i{width:6px;height:6px;border-radius:50%;background:currentColor;animation:pm-live 1.6s ease-in-out infinite}
@keyframes pm-live{50%{opacity:.35}}
.pm-sep{height:1px;background:var(--line);margin:6px 0}
.pm-item.danger{color:var(--danger)}
.pm-item.danger .i{color:var(--danger)}
.pm-item.danger:hover,.pm-item.danger:focus-visible{color:var(--danger);background:var(--danger-soft)}
.pm-item.danger:focus-visible{outline-color:color-mix(in srgb,var(--danger) 45%,transparent)}
.pmenu.sheet{left:0;right:0;bottom:0;margin:0 auto;width:min(560px,100%);max-height:88dvh;
  padding:0 12px max(12px,var(--safe-b));border-bottom:0;border-radius:var(--r) var(--r) 0 0;opacity:1;transform:translateY(100%);
  box-shadow:none;transition:transform .3s var(--ease-out)}
.pmenu.sheet.pm-open{transform:none}
.pmenu.sheet.pm-closing{transition:transform .22s cubic-bezier(.4,0,1,1)}
.pmenu.sheet{background:var(--surface-1);-webkit-backdrop-filter:none;backdrop-filter:none}
.pmenu.sheet .pm-top{position:sticky;top:0;z-index:2;margin:0 -12px;padding:0 12px;background:var(--surface-1)}
.pmenu.sheet .pm-grab{display:block;height:22px;margin:0 -12px 2px;cursor:grab}
.pmenu.sheet .pm-grab::before{content:"";position:absolute;left:50%;top:9px;width:36px;height:4px;translate:-50% 0;border-radius:99px;background:var(--line-strong)}
.pmenu.sheet .pm-head{padding:4px 0 12px 4px;margin:0 0 4px}
.pmenu.sheet .user-avatar.lg{width:44px;height:44px;font-size:17px;border-radius:12px}
.pmenu.sheet .pm-who b{font-size:16px}
.pmenu.sheet .pm-who>span{font-size:12.5px}
.pmenu.sheet .pm-close{display:grid;width:44px;height:44px;border-radius:var(--r-sm)}
.pmenu.sheet .pm-glabel{padding:10px 12px 4px;font-size:12.5px}
.pmenu.sheet .pm-theme{padding:4px 0 10px}
.pmenu.sheet .pm-theme .seg button{height:40px}
.pmenu.sheet .pm-item{height:44px;gap:14px;font-size:15px;border-radius:var(--r-sm);padding:0 12px}
.pmenu.sheet .pm-item .i{width:20px;height:20px}
.pmenu.sheet .pm-keys{display:none}
@media (prefers-reduced-motion:reduce){.pmenu,.pmenu.sheet,.pm-scrim.dim{transition:none}.pm-live i{animation:none}}

.nav-tip{position:fixed;z-index:120;left:0;top:0;pointer-events:none;padding:6px 10px;border-radius:var(--r-sm);font-size:12.5px;font-weight:600;
  background:var(--surface-1);color:var(--fg);border:1px solid var(--line-strong);box-shadow:none;
  opacity:0;transform:translateX(-4px);transition:opacity var(--dur-1),transform var(--dur-2) var(--ease-out);white-space:nowrap}
.nav-tip.on{opacity:1;transform:none}
.nav-tip kbd{margin-left:8px;height:18px;min-width:18px;font-size:10px}
.nav-tip small{display:block;margin-top:2px;font-size:11.5px;font-weight:500;color:var(--muted)}

@media (min-width:761px){
  #app.side-collapsed{grid-template-columns:var(--rail) minmax(0,1fr)}
  #app.side-collapsed .side-head{flex-direction:column;height:auto;padding:16px 0 8px;gap:8px}
  #app.side-collapsed .brand{flex:none;margin:0;padding:0}
  #app.side-collapsed .brand-text,#app.side-collapsed .brand-ver{display:none}
  #app.side-collapsed .side-collapse .sc-chev{transform:rotate(180deg)}
  #app.side-collapsed .side-actions{flex-direction:column;padding:0 0 12px;align-items:center;gap:4px}
  #app.side-collapsed :is(.side-new,.side-find,.side-tool){flex:none;width:44px;height:44px;padding:0;justify-content:center;border-radius:12px}
  #app.side-collapsed .side-find{background:transparent;color:var(--muted)}
  #app.side-collapsed .side-find:hover{background:var(--hover);border-color:transparent;color:var(--fg)}
  #app.side-collapsed .side-new-label,#app.side-collapsed .side-find kbd{display:none}
  #app.side-collapsed :is(.side-head,.side-actions){display:contents}
  #app.side-collapsed .brand-wrap{order:1;flex:none;align-self:center;margin:16px 0 10px}
  #app.side-collapsed .side-find{order:2;align-self:center;margin-bottom:4px}
  #app.side-collapsed .side-new{order:3;align-self:center;margin-bottom:12px}
  #app.side-collapsed .side-scroll{order:4}
  #app.side-collapsed .side-foot{order:5}
  #app.side-collapsed #sidebar .nav{display:flex;flex-direction:column;align-items:center;gap:4px;margin:0 7px;padding:12px 0 0;border-bottom:0;border-top:1px solid var(--line)}
  #app.side-collapsed #sidebar .nav-item{flex-direction:column;justify-content:center;gap:5px;width:62px;height:58px;padding:0;white-space:nowrap;border-radius:14px;
    color:var(--muted);box-shadow:none}
  #app.side-collapsed #sidebar .nav-item:hover{background:var(--hover);color:var(--fg)}
  #app.side-collapsed #sidebar .nav-item .ni-label{flex:none;max-width:58px;overflow:hidden;text-overflow:ellipsis;font-size:11px;font-weight:500;line-height:1.35;text-align:center}
  #app.side-collapsed #sidebar .nav-item .ni-tile{width:22px;height:22px;color:inherit}
  #app.side-collapsed #sidebar .nav-item .ni-tile .i{width:20px;height:20px}
  #app.side-collapsed #sidebar .nav-item.active{color:#f1f5f9;font-weight:600;background:linear-gradient(180deg,#1b2433,#0d121b);box-shadow:inset 0 0 0 1px rgba(94,234,212,.22)}
  #app.side-collapsed #sidebar .nav-item.active .ni-tile{color:#5eead4}
  #app.side-collapsed .nav-item .ni-kbd{display:none}
  #app.side-collapsed #sidebar .nav-item .ni-badge{position:absolute;top:9px;right:15px;margin:0;gap:0;font-size:0}
  #app.side-collapsed #sidebar .nav-item .ni-badge::before{width:8px;height:8px;box-shadow:0 0 0 2px var(--side-bg)}
  #app.side-collapsed .side-sec{display:none}
  #app.side-collapsed .side-foot{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 0 14px;margin:0 7px;border-top:1px solid var(--line)}
  #app.side-collapsed .side-links{align-items:center;gap:4px}
  #app.side-collapsed #sidebar .side-links .nav-item{width:44px;height:44px;border-radius:12px}
  #app.side-collapsed .side-links .ni-label,#app.side-collapsed .side-stats,#app.side-collapsed .sc-label,#app.side-collapsed .side-meta{display:none !important}
  #app.side-collapsed .profile-btn{width:44px;height:44px;margin-top:4px;padding:0;justify-content:center;background:transparent;border-color:transparent}
  #app.side-collapsed .side-foot .user-avatar{width:44px;height:44px;border-radius:12px;font-size:15px}
  #app.side-collapsed .pb-main,#app.side-collapsed .pb-chev{display:none}
}

#topbar{display:flex;align-items:center;gap:8px;height:var(--topbar);padding:0 12px 0 24px;flex:none;position:relative;z-index:20;
  border-bottom:1px solid var(--line);background:var(--surface-0)}
#sideToggle{display:none;place-items:center;width:40px;height:40px;margin-left:-8px;flex:none;border-radius:10px;
  border:0;background:none;color:var(--text-2);transition:background var(--dur-1),color var(--dur-1)}
#sideToggle:active{background:var(--hover);color:var(--fg)}
#sideToggle .i{width:19px;height:19px;stroke-width:1.8}
.tb-title{min-width:0;display:flex;align-items:center;gap:10px}
.crumb{font-weight:650;font-size:15px;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:36vw}
.tb-search{display:flex;align-items:center;gap:8px;height:34px;width:240px;padding:0 5px 0 10px;
  border-radius:var(--r-sm);background:color-mix(in srgb,var(--fg) 4%,transparent);border:1px solid transparent;color:var(--muted);font-size:13px;
  transition:width .32s cubic-bezier(.2,.8,.2,1),border-color var(--dur-1),background var(--dur-1),color var(--dur-1)}
.tb-search:hover,.tb-search:focus-visible,.tb-search.hint{width:clamp(260px,30vw,400px);border-color:var(--line-strong);color:var(--text-2)}
.tb-search kbd{background:transparent;border-color:var(--line)}
.tb-search{height:36px;padding:0 10px 0 12px;gap:9px;border-radius:10px;background:color-mix(in srgb,var(--fg) 5%,transparent);font-size:13.5px;font-weight:450}
.tb-search .i{width:17px;height:17px}
.tb-search kbd{height:auto;min-width:0;padding:0;border:0;background:none;box-shadow:none;font:500 11.5px/1 var(--font);color:var(--text-3)}
.tb-search .i{width:16px;height:16px;transition:color var(--dur-1)}
.tb-search:hover .i,.tb-search.hint .i{color:var(--accent)}
.tb-search-label{flex:1;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:opacity .25s}
.tb-search-label.swap{opacity:0}
.tb-search.hint{animation:tbHint 1.6s cubic-bezier(.2,.8,.2,1)}
@keyframes tbHint{0%,100%{border-color:var(--line-strong)}35%{border-color:var(--accent-line)}}
@media (prefers-reduced-motion:reduce){.tb-search,.tb-search-label{transition:none}.tb-search.hint{animation:none}}
.rt{--rt:var(--warn);display:inline-flex;align-items:center;gap:8px;height:34px;width:auto;min-width:0;padding:0 11px;border-radius:99px;flex:none;
  border:1px solid var(--line-strong);background:transparent;
  color:var(--text-2);font-size:12.5px;font-weight:600;white-space:nowrap;
  transition:border-color var(--dur-3),background var(--dur-3),color var(--dur-3)}
.rt:hover,.rt[aria-expanded=true]{background:var(--hover)}
.rt[data-state=connecting]{--rt:var(--muted)}
.rt[data-state=on]{--rt:var(--ok)}
.rt[data-state=off]{--rt:var(--danger)}
.rt-dot{position:relative;width:9px;height:9px;flex:none}
.rt-dot i{position:absolute;inset:0;border-radius:50%;background:var(--rt);box-shadow:none}
.rt-dot::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--rt);opacity:0}
.rt[data-state=on] .rt-dot::after{animation:rt-ripple 2.2s var(--ease-out) infinite}
.rt[data-state=connecting] .rt-dot i{animation:rt-blink 1s ease-in-out infinite}
@keyframes rt-ripple{0%{opacity:.55;transform:scale(1)}100%{opacity:0;transform:scale(3)}}
@keyframes rt-blink{0%,100%{opacity:1}50%{opacity:.3}}
.rt-label{color:var(--fg);flex:1;min-width:0}
.rt[data-state=off]{border-color:color-mix(in srgb,var(--danger) 40%,var(--line));background:var(--danger-soft)}
/* Fixed-size skeleton while connecting, so the header never shifts. */
.rt[data-state=connecting] .rt-label,.rt[data-state=connecting] .rt-agents b,.rt[data-state=connecting] .rt-idle b{color:transparent;border-radius:6px;
  background:linear-gradient(90deg,var(--surface-3,rgba(255,255,255,.06)) 25%,rgba(255,255,255,.14) 50%,var(--surface-3,rgba(255,255,255,.06)) 75%);
  background-size:200% 100%;animation:rt-skel 1.2s linear infinite}
.rt[data-state=connecting] .rt-label{height:10px}
.rt[data-state=connecting] .rt-agents{color:var(--muted)}
@keyframes rt-skel{from{background-position:200% 0}to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.rt[data-state=connecting] .rt-label,.rt[data-state=connecting] .rt-agents b,.rt[data-state=connecting] .rt-idle b{animation:none}}
.rt-agents{display:inline-flex;align-items:center;gap:4px;padding-left:8px;margin-left:1px;border-left:1px solid var(--line);
  color:var(--muted);font-variant-numeric:tabular-nums}
.rt-agents .i{width:15px;height:15px}
.rt-agents b{font-weight:700}
.rt-agents.on{color:var(--accent)}
.rt-agents b,.rt-idle b{display:inline-block;min-width:1.4ch;text-align:center}
.rt-agents{position:relative}
.rt-agents .i{transform-origin:50% 70%}
.rt-agents.bump .i{animation:rt-boot .7s cubic-bezier(.34,1.56,.64,1)}
@keyframes rt-boot{0%{transform:scale(.6);filter:none}35%{transform:scale(1.35) rotate(-14deg);filter:drop-shadow(0 0 6px var(--accent))}
  60%{transform:scale(.95) rotate(8deg)}100%{transform:none;filter:none}}
.rt-agents.bump::after{content:"";position:absolute;left:3px;top:50%;width:20px;height:20px;margin-top:-10px;border-radius:50%;
  border:2px solid var(--accent);pointer-events:none;animation:rt-ring .7s ease-out forwards}
@keyframes rt-ring{0%{opacity:.9;transform:scale(.4)}100%{opacity:0;transform:scale(1.9)}}
.rt-agents.bump b{animation:rt-roll-up .45s cubic-bezier(.2,.8,.2,1)}
@keyframes rt-roll-up{0%{transform:translateY(80%);opacity:0}60%{transform:translateY(-12%);opacity:1}100%{transform:none}}
.rt-agents.drop .i{animation:rt-droop .8s ease-in-out}
@keyframes rt-droop{40%{transform:rotate(16deg) translateY(1.5px);opacity:.45}100%{transform:none;opacity:1}}
.rt-agents.drop b{animation:rt-roll-down .45s cubic-bezier(.2,.8,.2,1)}
@keyframes rt-roll-down{0%{transform:translateY(-80%);opacity:0}100%{transform:none;opacity:1}}
.rt-agents.drop::before{content:"";position:absolute;left:8px;top:50%;width:5px;height:5px;margin-top:-2.5px;border-radius:50%;
  background:var(--muted);pointer-events:none;animation:rt-fly-out .6s ease-in forwards}
@keyframes rt-fly-out{0%{opacity:1;transform:none}50%{transform:translate(18px,-7px)}100%{opacity:0;transform:translate(36px,0) scale(.4)}}
.rt-idle{position:relative;display:inline-flex;align-items:center;gap:3px;color:var(--muted);font-variant-numeric:tabular-nums;transition:opacity .3s}
.rt-idle .i{width:13px;height:13px;transform-origin:50% 60%}
.rt-idle b{font-weight:650}
.rt-idle.none{opacity:.55}
.rt-idle.wake .i{animation:rt-wake .6s var(--ease-spring)}
@keyframes rt-wake{0%{transform:none}30%{transform:rotate(-25deg) scale(1.25);color:var(--accent)}60%{transform:rotate(12deg)}100%{transform:none}}
.rt-idle.wake b{animation:rt-roll-down .45s cubic-bezier(.2,.8,.2,1)}
.rt-idle.wake::before{content:"";position:absolute;left:4px;top:50%;width:6px;height:6px;margin-top:-3px;border-radius:50%;
  background:var(--accent);box-shadow:none;pointer-events:none;animation:rt-fly-in .5s cubic-bezier(.5,0,.5,1) forwards}
@keyframes rt-fly-in{0%{opacity:0;transform:scale(.4)}20%{opacity:1}55%{transform:translate(-16px,-8px)}100%{opacity:0;transform:translate(-34px,0) scale(1.3)}}
.rt-idle.sleep b{animation:rt-roll-up .45s cubic-bezier(.2,.8,.2,1)}
.rt-idle.sleep::after,.rt-idle.sleep::before{content:"z";position:absolute;left:9px;top:-2px;font-size:10px;font-weight:800;color:var(--muted);
  pointer-events:none;opacity:0;animation:rt-z 1.3s ease-out .35s forwards}
.rt-idle.sleep::before{font-size:8px;animation-delay:.75s}
@keyframes rt-z{0%{opacity:0;transform:translate(0,4px) scale(.6)}30%{opacity:1}100%{opacity:0;transform:translate(8px,-13px) scale(1.15)}}
.rt-idle.sleep .i{animation:rt-nod .9s ease-in-out .3s}
@keyframes rt-nod{40%{transform:rotate(18deg) translateY(1px)}}
@media (prefers-reduced-motion:reduce){.rt-idle .i,.rt-idle b,.rt-idle::before,.rt-idle::after,.rt-agents .i,.rt-agents b,.rt-agents::before,.rt-agents::after{animation:none !important}}
.rt-pop{position:fixed;z-index:70;top:calc(var(--topbar) + 8px);right:14px;width:min(340px,calc(100vw - 24px));
  background:var(--ovl-bg);-webkit-backdrop-filter:var(--ovl-filter);backdrop-filter:var(--ovl-filter);
  border:1px solid var(--line-strong);border-top-color:var(--ovl-edge);
  border-radius:var(--r);box-shadow:none;overflow:hidden;animation:ds-pop var(--dur-2) var(--ease-out);transform-origin:top right}
.rt-scrim{display:none}

.tabbar{display:none}

.palette{position:fixed;inset:0;z-index:85;display:flex;justify-content:center;align-items:flex-start;padding:12vh 16px 16px;
  background:var(--scrim);-webkit-backdrop-filter:var(--scrim-filter);backdrop-filter:var(--scrim-filter);animation:ds-fade var(--dur-2) var(--ease)}
.pal{width:min(640px,100%);max-height:min(600px,76vh);display:flex;flex-direction:column;overflow:hidden;
  background:var(--ovl-bg);-webkit-backdrop-filter:var(--ovl-filter);backdrop-filter:var(--ovl-filter);
  border:1px solid var(--line-strong);border-top-color:var(--ovl-edge);border-radius:var(--r);box-shadow:none;animation:ds-pop var(--dur-3) var(--ease-out)}
.pal-in{display:flex;align-items:center;gap:12px;padding:0 10px 0 18px;height:56px;border-bottom:1px solid var(--line);flex:none}
.pal-in .i{width:19px;height:19px;color:var(--muted)}
.pal-in input{flex:1;min-width:0;height:100%;background:none;border:0;outline:none;font-size:16px;color:var(--fg);box-shadow:none}
.pal-in input::placeholder{color:var(--text-3)}
.pal-in input::-webkit-search-cancel-button{display:none}
.pal-list{flex:1 1 auto;overflow:auto;padding:4px 8px 8px;overscroll-behavior:contain}
.pal-sec{padding:12px 10px 4px;font-size:12px;font-weight:550;color:var(--muted);display:flex;align-items:center;gap:8px}
.pal-sec .pal-spin{width:12px;height:12px;border-radius:50%;border:2px solid var(--line-strong);border-top-color:var(--accent);animation:pal-spin .7s linear infinite}
@keyframes pal-spin{to{transform:rotate(360deg)}}
.pal-opt{display:flex;align-items:center;gap:12px;width:100%;min-height:44px;padding:6px 10px;border-radius:var(--r-sm);text-align:left;cursor:pointer;
  color:var(--text-2);scroll-margin:8px}
.pal-opt .po-ico{display:grid;place-items:center;width:28px;height:28px;border-radius:var(--r-xs);flex:none;
  background:transparent;border:1px solid var(--line);color:var(--muted)}
.pal-opt .po-ico .i{width:16px;height:16px}
.pal-opt .po-main{flex:1;min-width:0}
.pal-opt .po-title{font-size:14px;font-weight:550;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pal-opt .po-sub{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pal-opt .po-snip{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pal-opt .po-snip b,.pal-opt mark{color:var(--accent);background:none;font-weight:700}
.pal-opt .po-hint{font-size:11.5px;color:var(--text-3);flex:none;display:flex;gap:4px;align-items:center}
.pal-opt[aria-selected=true]{background:var(--accent-soft);color:var(--fg)}
.pal-opt[aria-selected=true] .po-ico{border-color:var(--accent-line);color:var(--accent)}
.pal-opt[aria-selected=true] .po-hint .ret{opacity:1}
.pal-opt .po-hint .ret{opacity:0}
.pal-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:34px 20px;text-align:center;color:var(--muted);font-size:13px;line-height:1.5}
.pal-empty b{color:var(--fg);font-size:14px;font-weight:650}
.pal-empty span:last-child{max-width:340px}
.pal-empty .pe-ico{display:grid;place-items:center;width:40px;height:40px;border-radius:var(--r);border:1px solid var(--line);color:var(--muted);margin-bottom:4px}
.pal-empty .pe-ico .i{width:20px;height:20px}
.pal-note{padding:12px 10px 6px;font-size:12.5px;color:var(--text-2)}
.pal-opt .po-why{font-size:11.5px;color:var(--accent);margin-top:2px}
.pal-closebar{display:none}
.pal-foot{display:flex;align-items:center;gap:16px;padding:8px 16px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);flex:none}
.pal-foot span{display:inline-flex;align-items:center;gap:5px}
.pal-foot kbd{height:18px;min-width:18px;font-size:10px}
:root .pal{width:min(600px,100%);background:var(--surface-1);-webkit-backdrop-filter:none;backdrop-filter:none;border-radius:16px;
  border:1px solid var(--line-strong);box-shadow:0 24px 64px -24px rgba(0,0,0,.45),0 2px 6px rgba(0,0,0,.08)}
.palette{-webkit-backdrop-filter:none;backdrop-filter:none}
.pal-in{height:52px;padding:0 14px 0 18px;gap:10px}
.pal-in .i{width:17px;height:17px}
.pal-in input{font-size:15px}
.pal-list{padding:4px 6px 8px}
.pal-sec{padding:12px 12px 6px;font-size:11.5px;font-weight:500;color:var(--text-3)}
.pal-opt{min-height:38px;padding:5px 12px;gap:11px;border-radius:9px}
.pal-opt .po-ico{width:18px;height:18px;border:0;border-radius:0;background:none;color:var(--muted)}
.pal-opt .po-ico .i{width:16px;height:16px}
.pal-opt .po-main{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:10px;min-width:0}
.pal-opt .po-title{flex:0 1 auto;min-width:0;font-size:14px;font-weight:500}
.pal-opt .po-sub{flex:1 1 0;min-width:60px;font-size:12.5px;color:var(--text-3)}
.pal-opt :is(.po-snip,.po-why){flex-basis:100%}
.pal-opt[aria-selected=true]{background:color-mix(in srgb,var(--fg) 6%,transparent)}
.pal-opt[aria-selected=true] .po-ico{color:var(--fg)}
.pal :is(.po-hint,.pal-foot) kbd{height:auto;min-width:0;padding:0;border:0;background:none;box-shadow:none;font:500 11.5px/1 var(--font);color:var(--text-3)}
.pal-opt .po-hint{gap:8px}
.pal-opt .po-hint .ret .i{width:14px;height:14px;color:var(--text-3)}
.pal-foot{gap:14px;padding:9px 18px;font-size:11.5px;color:var(--text-3)}
.pal-foot span{gap:4px}

.peek{position:absolute;right:16px;top:calc(var(--topbar) + 14px);bottom:16px;width:min(var(--peek),44vw);z-index:15;
  display:flex;flex-direction:column;background:var(--glass-strong);
  border:1px solid var(--line-strong);border-radius:var(--r-lg);box-shadow:none;overflow:hidden;
  transition:opacity var(--dur-2) var(--ease),transform var(--dur-3) var(--ease-out)}
.peek.hidden{display:flex !important;opacity:0;transform:translateX(16px);pointer-events:none;visibility:hidden}
.peek-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}
.peek-folder{font-size:12.5px;font-weight:650;color:var(--accent-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.peek-acts{margin-left:auto;display:flex;align-items:center;gap:4px}
.peek-body{flex:1;overflow:auto;padding:16px 18px}

.acct-head{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.acct-name{font-size:15px;font-weight:680}
.acct-sub{font-size:12px;color:var(--muted)}
.acct-theme{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:16px 0 4px;padding-top:16px;border-top:1px solid var(--line)}
.acct-theme > span{font-size:13px;font-weight:600}
.guide{display:flex;flex-direction:column;gap:10px}
.guide p{margin:0;font-size:13px;line-height:1.6;color:var(--muted)}
.guide{gap:12px}
.guide-about{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;align-items:center;padding:0 0 16px;border-bottom:1px solid var(--line)}
.guide-about .guide-mark{width:40px;height:40px;grid-row:span 1}
.guide-about>div b{display:block;font-size:14px;color:var(--fg)}
.guide-about .guide-motto{font-size:12px;font-weight:600;color:var(--accent)}
.guide-about p{grid-column:1/-1}
.guide-about .guide-name{font-size:12px;font-style:italic}
.guide-about .guide-btns{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px}
.guide b{color:var(--fg);font-weight:650}
.guide code{font-family:var(--mono);font-size:12px;padding:1px 5px;border-radius:5px;background:var(--surface-2);color:var(--accent-3)}
.guide-keys{display:grid;grid-template-columns:auto 1fr;gap:10px 16px;align-items:center;font-size:13px;color:var(--text-2);
  padding:16px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.guide-keys > span:nth-child(odd){display:flex;gap:4px}

@media (max-width:1180px){
  .tb-search{width:140px}
  .tb-search:hover,.tb-search:focus-visible,.tb-search.hint{width:clamp(220px,38vw,380px)}
  .tb-search kbd{display:none}
}
@media (max-width:1000px){
  .rt-label{display:none}
  .rt{width:auto;min-width:0;gap:7px}
  .rt-agents{padding-left:7px;gap:3px}
  .rt-agents b,.rt-idle b{min-width:1.3ch;font-variant-numeric:tabular-nums}
  .peek{width:min(420px,88vw)}
}

@media (max-width:760px){
  #app{grid-template-columns:minmax(0,1fr)}
  #main{grid-column:1}
  #sideScrim{display:block}
  /* The safe area is added under the bar, not inside it. */
  :root{--tabbar:60px;--tb-pad:var(--safe-b);--tb-gap:10px}
  #main{padding-bottom:calc(var(--tabbar) + var(--tb-pad) + var(--tb-gap))}
  #app:has(.vx-page.editing) .tabbar{display:none}
  #main:has(.vx-page.editing){padding-bottom:0}
  #sidebar{position:fixed;top:0;bottom:0;left:0;width:min(320px,88vw);z-index:60;transform:translateX(-104%);
    border-radius:0 var(--r) var(--r) 0;border-right:1px solid var(--line-strong);box-shadow:none;
    transition:transform var(--dur-3) var(--ease-out),visibility 0s linear var(--dur-3);visibility:hidden;
    padding-top:var(--safe-t);background:var(--side-bg)}
  #app.side-open #sidebar{transform:none;visibility:visible;transition:transform var(--dur-3) var(--ease-out)}
  #sideScrim{position:fixed;inset:0;z-index:55;background:var(--scrim);-webkit-backdrop-filter:var(--scrim-filter);backdrop-filter:var(--scrim-filter);
    opacity:0;pointer-events:none;transition:opacity var(--dur-3)}
  #app.side-open #sideScrim{opacity:1;pointer-events:auto}
  .side-collapse{display:none}
  #recentSec{display:none}
  .side-foot .profile-btn{height:60px}
  .side-close{display:grid}
  .side-find{height:44px;font-size:15px}
  .side-tool{width:40px;height:40px}
  .nav-item{height:46px;font-size:15.5px}
  #sidebar .vx-row,#sidebar .vx-pin{min-height:40px}
  .side-find kbd{display:none}
  .nav-item .ni-kbd{display:none}

  #topbar{height:calc(54px + var(--safe-t));padding:var(--safe-t) 8px 0 12px;gap:4px}
  #sideToggle{display:grid}
  .crumb{font-size:16.5px;max-width:none}
  .tb-title{flex:1 1 auto}
  #topbar > .grow{display:none}
  .tb-opt{display:none !important}
  .tb-search,.tb-search:hover,.tb-search:focus-visible,.tb-search.hint{width:40px;height:40px;padding:0;flex:none;
    justify-content:center;border-radius:50%;background:transparent;border-color:transparent}
  .tb-search .i{width:19px;height:19px}
  .tb-search-label,.tb-search kbd{display:none}
  .rt{height:34px;padding:0 10px}
  .view{padding:16px 16px 32px}
  .peek{right:8px;left:8px;top:calc(62px + var(--safe-t));bottom:8px;width:auto}

  .tabbar{display:flex;justify-content:center;position:fixed;left:12px;right:12px;bottom:calc(var(--tb-gap) + var(--tb-pad));z-index:50;
    height:var(--tabbar);pointer-events:none}
  .tb-dock{display:flex;align-items:center;gap:2px;width:100%;max-width:420px;height:100%;padding:6px;pointer-events:auto;border-radius:999px;
    background:color-mix(in srgb,var(--side-bg) 90%,transparent);-webkit-backdrop-filter:var(--ovl-filter);backdrop-filter:var(--ovl-filter);
    border:1px solid var(--line-strong)}
  .tab-item{position:relative;flex:1 1 0;min-width:0;height:100%;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:999px;
    color:var(--text-2);font-size:13px;font-weight:600;white-space:nowrap;-webkit-tap-highlight-color:transparent;
    transition:flex-grow .32s var(--ease-out),background .25s,color .2s}
  .tab-item>span:last-child{max-width:0;overflow:hidden;opacity:0;transition:max-width .32s var(--ease-out),opacity .2s}
  .tab-item .ti-ico{position:relative;display:grid;place-items:center;flex:none;transition:transform .15s}
  .tab-item .i{width:22px;height:22px;stroke-width:1.7}
  .tab-item:active .ti-ico{transform:scale(.9)}
  .tab-item.active{flex-grow:2.4;color:#f1f5f9;background:linear-gradient(180deg,#1b2433,#0d121b);box-shadow:inset 0 0 0 1px rgba(94,234,212,.22)}
  .tab-item.active .ti-ico{color:#5eead4}
  .tab-item.active .i{stroke-width:2}
  .tab-item.active>span:last-child{max-width:96px;opacity:1}
  .tab-item .ti-badge{position:absolute;top:-6px;right:-9px;min-width:16px;height:16px;padding:0 4px;border-radius:99px;
    background:#5eead4;color:#04221e;font-size:9.5px;font-weight:700;display:none;place-items:center;border:2px solid var(--side-bg)}
  .tab-item .ti-badge.on{display:grid}
  @media (max-width:340px){.tab-item.active>span:last-child{display:none}.tab-item.active{flex-grow:1.4}}
  @media (prefers-reduced-motion:reduce){.tab-item,.tab-item>span:last-child,.tab-item .ti-ico{transition:none}}
  @media (prefers-reduced-motion:reduce){.tabbar{transition:none}}

  .palette{padding:0;align-items:stretch;background:var(--surface-1);-webkit-backdrop-filter:none;backdrop-filter:none}
  .pal{background:var(--surface-1);-webkit-backdrop-filter:none;backdrop-filter:none}
  .pal{width:100%;max-height:none;height:var(--pal-h,100dvh);margin-top:var(--pal-top,0px);border:0;border-radius:0;box-shadow:none;
    padding-top:var(--safe-t);animation:pal-up .3s cubic-bezier(.2,.8,.2,1)}
  @keyframes pal-up{from{transform:translateY(28px);opacity:0}}
  .palette{transition:opacity .22s ease}
  .palette.closing{opacity:0}
  .palette.closing .pal{transform:translateY(28px);transition:transform .22s cubic-bezier(.4,0,1,1)}
  .pal-in{height:58px}
  .pal-closebar{display:block;flex:none;padding:10px 16px calc(10px + var(--safe-b));border-top:1px solid var(--line)}
  .pal-closebtn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:48px;border-radius:var(--r-sm);
    background:var(--surface-2);border:1px solid var(--line-strong);color:var(--fg);font-size:15px;font-weight:600;
    animation:pal-nudge .7s .35s cubic-bezier(.2,.8,.2,1) both}
  .pal-closebtn .i{width:20px;height:20px}
  .pal-closebtn:active{background:var(--surface-3)}
  @keyframes pal-nudge{0%{transform:translateY(10px);opacity:0}60%{transform:translateY(-3px);opacity:1}100%{transform:none}}
  @media (prefers-reduced-motion:reduce){.pal,.pal-closebtn{animation:none}}
  .pal-foot,.pal-opt .po-hint kbd{display:none}
  /* Content runs under the floating tab bar; scroll areas and map controls keep room for it. */
  :root{--dock-space:calc(var(--tabbar) + var(--tb-pad) + var(--tb-gap) + 12px)}
  #main{padding-bottom:0}
  .view{padding-bottom:calc(var(--dock-space) + 16px)}
  #app :is(.vx-bscroll,.dc-main){padding-bottom:var(--dock-space)}
  #app :is(.vc-dock,.vc-mini){bottom:calc(var(--vc-gap,10px) + var(--dock-space))}
  #app .vc-sheet :is(.vc-dock,.vc-mini,.vc-globe){bottom:auto}
  #app .cv .vc-dock,#app .cv-tools{bottom:calc(10px + var(--dock-space))}
  #app .cv-selbar{bottom:calc(40px + var(--dock-space))}
  #app .brain-foot{bottom:calc(18px + var(--dock-space))}
  #app .vc-drawer{bottom:calc(var(--vc-gap,10px) + var(--dock-space))}
  #app:has(.vc-sheet-open,.nc.open) .tabbar{display:none}
  .tb-dock{position:relative;isolation:isolate;background:rgba(18,23,33,.66);
    -webkit-backdrop-filter:blur(18px) saturate(2) brightness(1.1);backdrop-filter:blur(18px) saturate(2) brightness(1.1);border:1px solid rgba(255,255,255,.14);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.22),inset 0 -1px 0 rgba(255,255,255,.05),0 14px 34px -12px rgba(0,0,0,.6)}
  .tb-dock::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;
    background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,0) 45%),radial-gradient(120% 140% at 50% 120%,rgba(94,234,212,.10),transparent 60%)}
  :root[data-theme=light] .tb-dock{background:rgba(255,255,255,.74);border-color:rgba(255,255,255,.85);
    -webkit-backdrop-filter:blur(18px) saturate(1.8);backdrop-filter:blur(18px) saturate(1.8);
    box-shadow:0 0 0 1px rgba(15,23,42,.07),inset 0 1px 0 rgba(255,255,255,.95),inset 0 -1px 0 rgba(255,255,255,.4),0 14px 32px -12px rgba(15,23,42,.30)}
  :root[data-theme=light] .tb-dock::before{background:linear-gradient(180deg,rgba(255,255,255,.6),rgba(255,255,255,0) 50%),radial-gradient(120% 140% at 50% 120%,rgba(13,148,136,.08),transparent 60%)}
  @media (prefers-reduced-transparency:reduce){.tb-dock,:root[data-theme=light] .tb-dock{background:var(--surface-1);-webkit-backdrop-filter:none;backdrop-filter:none}}
}
@media (max-width:380px){
  .crumb{font-size:15.5px}
  .rt-agents .i,.rt-idle .i{width:13px;height:13px}
}

@media (min-width:761px){
  #app{padding:8px;gap:8px;background:radial-gradient(1100px 700px at -8% -18%,rgba(94,234,212,.09),transparent 62%),
    radial-gradient(900px 620px at 108% 118%,rgba(129,140,248,.08),transparent 60%),var(--canvas)}
  :root[data-theme=light] #app{background:radial-gradient(1100px 700px at -8% -18%,rgba(13,148,136,.09),transparent 62%),
    radial-gradient(900px 620px at 108% 118%,rgba(79,70,229,.07),transparent 60%),var(--canvas)}
  #sidebar,#main{box-shadow:inset 0 1px 0 rgba(255,255,255,.035)}
  :root[data-theme=light] :is(#sidebar,#main){box-shadow:0 1px 2px rgba(15,23,42,.04)}
  #sidebar{border:1px solid var(--line);border-radius:12px}
  #main{border:1px solid var(--line);border-radius:12px;background:var(--surface-0);overflow:hidden}
  #topbar{background:transparent}
}
`;
