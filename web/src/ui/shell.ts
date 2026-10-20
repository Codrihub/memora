// Shell layout styles: sidebar (expanded / slim rail / mobile drawer), top
// bar, realtime indicator, mobile tab bar, command palette, peek and splash.

export const SHELL_CSS = `
/* ── frame ───────────────────────────────────────────────────────────── */
#app{display:grid;grid-template-columns:var(--sb) minmax(0,1fr);height:100vh;height:100dvh;position:relative;
  background:var(--bg-grad),var(--bg);transition:grid-template-columns var(--dur-3) var(--ease-out)}
#sideScrim{display:none}
#main{grid-column:2;grid-row:1;display:flex;flex-direction:column;min-width:0;min-height:0;position:relative}
#views{flex:1 1 auto;min-height:0;position:relative;outline:none}
.view{position:absolute;inset:0;overflow:auto;padding:24px 28px 64px;scroll-padding-top:16px}
.view:not(.hidden){animation:view-in var(--dur-3) var(--ease-out)}
@keyframes view-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
#view-graph,#view-brain,#view-canvas{padding:0;overflow:hidden}
.skip-link{position:fixed;left:12px;top:-60px;z-index:200;padding:8px 14px;border-radius:10px;background:var(--surface-1);
  border:1px solid var(--line-strong);color:var(--fg);font-weight:600;transition:top var(--dur-2)}
.skip-link:focus{top:12px}

/* ── brand ───────────────────────────────────────────────────────────── */
.brand-tile{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;flex:none;
  box-shadow:0 6px 18px -8px rgba(34,211,238,.45)}
.brand-tile.sm{width:32px;height:32px;border-radius:10px}
/* the mark carries its own slate tile (brand.ts), so it fills the box */
.brand-mark{width:100%;height:100%;display:block}

/* ── sidebar ─────────────────────────────────────────────────────────── */
#app.side-collapsed #sidebar{cursor:pointer}
#app.side-collapsed #sidebar:hover{background:var(--surface-2)}
#app.side-collapsed #sidebar :is(button,a,input){cursor:pointer}
#sidebar{grid-column:1;grid-row:1;display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden;z-index:30;position:relative;
  background:var(--surface-1);border-right:1px solid var(--line)}
.side-head{display:flex;align-items:center;gap:8px;height:var(--topbar);padding:0 12px 0 16px;flex:none}
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
.side-collapse{display:flex;align-items:center;gap:10px;width:100%;height:36px;padding:0 10px;margin-bottom:6px;border-radius:10px;
  color:var(--muted);font-size:12.5px;font-weight:600;transition:background var(--dur-1),color var(--dur-1)}
/* Its own button surface, so it never reads as one more folder row. */
.side-collapse{background:var(--surface-2);border:1px solid var(--line-strong);color:var(--text-2)}
.side-collapse:hover{background:var(--surface-3);border-color:var(--text-3);color:var(--fg)}
.side-collapse:active{background:var(--surface-3);transform:scale(.98)}
.side-collapse .sc-chev{flex:none;transition:transform var(--dur-3) var(--ease-out)}
.side-close{display:none}

.side-actions{display:flex;flex-direction:column;gap:6px;padding:4px 12px 12px;flex:none}
.side-new{display:flex;align-items:center;gap:10px;height:38px;padding:0 8px 0 11px;border-radius:11px;font-size:13.5px;
  transition:border-color var(--dur-1),background var(--dur-1),color var(--dur-1),transform var(--dur-1)}
.side-new{font-weight:650;color:var(--fg);background:var(--surface-2);border:1px solid var(--line-strong)}
.side-new .i{width:18px;height:18px;color:var(--accent);stroke-width:2.2}
.side-new:hover{border-color:var(--accent-line);background:var(--accent-soft)}
.side-new:active{transform:scale(.98)}
.side-new-label{flex:1;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.side-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;padding-bottom:12px}
.nav{display:flex;flex-direction:column;gap:2px;padding:0 12px}
.nav-item{position:relative;display:flex;align-items:center;gap:10px;height:38px;padding:0 8px 0 11px;border-radius:11px;
  color:var(--text-2);font-size:13.5px;font-weight:560;text-align:left;width:100%;white-space:nowrap;flex:none;
  transition:background var(--dur-1),color var(--dur-1)}
.nav-item:hover{background:var(--hover);color:var(--fg)}
.nav-item .i{width:18px;height:18px;transition:color var(--dur-1),transform var(--dur-2) var(--ease-spring)}
.nav-item:active .i{transform:scale(.9)}
.nav-item .ni-label{flex:1;overflow:hidden;text-overflow:ellipsis}
.nav-item.active{color:var(--fg);background:var(--accent-soft)}
.nav-item.active .i{color:var(--accent)}
.nav-item.active::before{content:"";position:absolute;left:-12px;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--primary)}
.nav-item .ni-kbd{font-size:10.5px;color:var(--text-3);font-weight:600;opacity:0;transition:opacity var(--dur-1)}
.nav-item:hover .ni-kbd{opacity:1}

/* Sidebar structure: a divider under the main nav; Library is the parent
   title, Pinned and Folders its titled parts (flush left, stronger text),
   each part's contents indented on a thin guide line, a divider between them. */
#sidebar .nav{margin:0 12px;padding:0 0 12px;border-bottom:1px solid var(--line)}
#sidebar .side-vault{margin-top:12px}
#sidebar .side-vault .sec-row{padding-bottom:6px;margin-bottom:6px;border-bottom:1px solid var(--line)}
#sidebar .sec-head{color:var(--text-2)}
#sidebar .sec-title{font-size:11.5px;font-weight:800}
#sidebar .vx-sec-head{color:var(--text-2);font-weight:750}
#sidebar .vx-fold{margin:0;padding-left:11px}
#sidebar .vx-fold:hover{color:var(--fg)}
#sidebar .vx-pins{padding-bottom:8px;margin-bottom:8px;border-bottom:1px solid var(--line)}
/* Branch lines: a line runs down each group of children, every child gets
   a short arm to the right, and the line stops at the last child (an elbow),
   level after level, like a file tree. */
#sidebar .vx-kids-inner{position:relative}
#sidebar{--branch:color-mix(in srgb,var(--text-3) 65%,transparent)}
#sidebar .vx-kids-inner::before{content:"";position:absolute;left:var(--gx);top:0;bottom:0;width:1px;background:var(--branch)}
#sidebar .vx-kids-inner>.vx-branch>.vx-row,#sidebar .vx-kids-inner>.vx-row{position:relative}
/* each arm curves off the line (a rounded elbow), not a hard corner */
#sidebar .vx-kids-inner>.vx-branch>.vx-row::after,#sidebar .vx-kids-inner>.vx-row::after{content:"";position:absolute;left:var(--gx);top:calc(50% - 8px);
  width:6px;height:8px;border-left:1px solid var(--branch);border-bottom:1px solid var(--branch);border-bottom-left-radius:7px;box-sizing:border-box}
/* below the last child's arm the line is hidden (sidebar colour over it) */
#sidebar .vx-kids-inner>:last-child{position:relative}
#sidebar .vx-kids-inner>:last-child::before{content:"";position:absolute;left:var(--gx);top:7px;bottom:0;width:1px;background:var(--surface-1)}
/* Pinned: the same branch from the drop slot down its list */
#sidebar .vx-pins .vx-pin-empty{margin-left:12px}
#sidebar .vx-pin-list{position:relative;margin-left:12px;padding-left:10px}
#sidebar .vx-pin-list::before{content:"";position:absolute;left:0;top:0;bottom:0;width:1px;background:var(--branch)}
#sidebar .vx-pin-list>.vx-pin{position:relative}
#sidebar .vx-pin-list>.vx-pin::after{content:"";position:absolute;left:-10px;top:calc(50% - 8px);width:9px;height:8px;box-sizing:border-box;
  border-left:1px solid var(--branch);border-bottom:1px solid var(--branch);border-bottom-left-radius:8px}
#sidebar .vx-pin-list>.vx-pin:last-child::before{content:"";position:absolute;left:-10px;top:calc(50% - 8px);bottom:0;width:1px;background:var(--surface-1)}
/* the reorder markers (drag a pin) win over the branch drawing */
#sidebar .vx-pin-list>.vx-pin.vx-drop-before::before,#sidebar .vx-pin-list>.vx-pin.vx-drop-after::after{left:6px;right:6px;width:auto;height:2px;border-radius:2px;
  background:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 25%,transparent);z-index:2}
#sidebar .vx-pin-list>.vx-pin.vx-drop-before::before{top:-1px;bottom:auto}
#sidebar .vx-pin-list>.vx-pin.vx-drop-after::after{top:auto;bottom:-1px}
@media (max-width:760px){#sidebar .vx-kids-inner>:last-child::before{top:12px}}
/* accordion sections (Recent nodes, Library) */
.side-sec{display:flex;flex-direction:column;margin-top:18px;padding:0 12px}
.sec-row{display:flex;align-items:center;gap:4px}
.sec-row .sec-head{flex:1}
.sec-head{display:flex;align-items:center;gap:6px;height:30px;padding:0 8px 0 11px;color:var(--text-3);width:100%;text-align:left;border-radius:9px;
  transition:color var(--dur-1),background var(--dur-1)}
.sec-head:hover{background:var(--hover);color:var(--text-2)}
.sec-title{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;flex:1}
.sec-caret{width:14px;height:14px;transition:transform var(--dur-3) var(--ease-out);opacity:.8}
.side-sec.collapsed .sec-caret,#libFold.folded .sec-caret{transform:rotate(-90deg)}
/* Library row: like the section rows under it, the add button shows on hover
   and the chevron stays at the far right. */
.sec-row .lib-act{opacity:0;pointer-events:none;transition:opacity .15s}
.sec-row:hover .lib-act,.sec-row:focus-within .lib-act{opacity:1;pointer-events:auto}
@media (hover:none){.sec-row .lib-act{opacity:1;pointer-events:auto}}
.sec-caret{transition:transform .25s cubic-bezier(.2,.8,.2,1)}
.sec-body{display:grid;grid-template-rows:1fr;transition:grid-template-rows var(--dur-3) var(--ease-out),opacity var(--dur-2)}
.side-sec.collapsed .sec-body{grid-template-rows:0fr;opacity:0}
.sec-inner{min-height:0;overflow:hidden;display:flex;flex-direction:column;padding-top:2px}
.icon-btn.sm{width:30px;height:30px;border-radius:9px}
.icon-btn.sm .i{width:16px;height:16px}
.sec-count{font-size:11px;font-weight:600;color:var(--muted);background:var(--surface-2);border:1px solid var(--line);border-radius:99px;padding:0 7px;line-height:17px}
.pin-head{display:flex;align-items:center;justify-content:space-between;padding:6px 8px 4px 13px;font-size:11.5px;font-weight:650;color:var(--text-3)}
.pinned{display:flex;flex-direction:column;gap:1px;max-height:190px;overflow:auto;padding-bottom:6px}
.side-vault.vx .side-search,.side-vault.vx .sec-pins{display:none}
.side-search{display:flex;align-items:center;gap:7px;margin:4px 0 8px;padding:0 6px 0 10px;height:34px;
  background:var(--surface-0);border:1px solid var(--line);border-radius:10px;transition:border-color var(--dur-1),box-shadow var(--dur-1)}
.side-search:focus-within{border-color:var(--accent-line);box-shadow:0 0 0 3px var(--accent-soft)}
.side-search .i{width:14px;height:14px;color:var(--muted)}
.side-search input{flex:1;min-width:0;background:none;border:0;outline:none;padding:0;font-size:12.5px;box-shadow:none}
.side-search input::-webkit-search-cancel-button{display:none}
.ss-clear{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;color:var(--muted)}
.ss-clear .i{width:13px;height:13px}
.ss-clear:hover{color:var(--fg);background:var(--hover)}
.tree{flex:none;padding:0 0 6px}
.tree-empty{padding:8px 13px;color:var(--muted);font-size:12px}
.dot-sep{opacity:.5}

/* profile button + menu */
.side-foot{flex:none;padding:10px 12px calc(10px + var(--safe-b));border-top:1px solid var(--line)}
.profile-btn{display:flex;align-items:center;gap:10px;width:100%;height:48px;padding:0 8px 0 6px;border-radius:12px;text-align:left;
  transition:background var(--dur-1)}
.profile-btn:hover,.profile-btn[aria-expanded=true]{background:var(--hover)}
.pb-main{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}
.pb-name{font-size:13.5px;line-height:1.4;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pb-sub{font-size:11.5px;line-height:1.45;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Collapsed rail: the vault size sits behind a small button. */
.side-stats{display:none}
.side-stats-pop{position:fixed;z-index:60;min-width:168px;padding:10px 12px;border-radius:var(--r);background:var(--glass-strong);border:1px solid var(--line-strong);
  box-shadow:var(--shadow);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);animation:ssp-in .18s var(--ease-out)}
.side-stats-pop[hidden]{display:none}
.side-stats-pop h4{margin:0 0 6px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-3)}
.side-stats-pop dl{margin:0;display:grid;grid-template-columns:1fr auto;gap:4px 18px;font-size:13px}
.side-stats-pop dt{color:var(--text-2)}
.side-stats-pop dd{margin:0;font-weight:700;font-variant-numeric:tabular-nums;text-align:right}
@keyframes ssp-in{from{opacity:0;transform:translateX(-6px)}}
.side-meta{position:relative;height:18px;line-height:18px;margin:5px 8px 0;font-size:11.5px;color:var(--text-3);overflow:hidden;white-space:nowrap;font-variant-numeric:tabular-nums}
.pb-stats,.pb-live{position:absolute;inset:0;overflow:hidden;text-overflow:ellipsis;transition:opacity .35s,transform .35s cubic-bezier(.2,.8,.2,1)}
.pb-stats{display:flex;justify-content:space-between}
.pb-stats i{font-style:normal;opacity:.5}
/* The two lines swap like a ticker: each moves a full line height in step with the other,
   so they are always exactly one line apart and never overlap mid-switch. */
.pb-live{color:var(--accent);opacity:0;transform:translateY(100%);text-align:center}
.side-meta.flip .pb-stats{opacity:0;transform:translateY(-100%)}
.side-meta.flip .pb-live{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){.pb-stats,.pb-live{transition:none}}
.pb-chev{width:16px;height:16px;color:var(--text-3);transition:transform var(--dur-2) var(--ease-out)}
.profile-btn[aria-expanded=true] .pb-chev{transform:rotate(180deg)}
/* Profile menu (account.ts): a panel as wide as the sidebar's content rising
   from the chip, a sidebar-wide popover beside the rail, or a bottom sheet on
   the phone layout. Solid surface, one level above the sidebar. */
.pm-scrim{position:fixed;inset:0;z-index:74}
.pm-scrim.dim{background:rgba(3,5,9,.55);opacity:0;transition:opacity var(--dur-3) var(--ease-out)}
:root[data-theme=light] .pm-scrim.dim{background:rgba(15,23,42,.34)}
.pm-scrim.dim.on{opacity:1}
.pmenu{--pm-bg:var(--surface-2);--pm-track:var(--surface-0);--pm-thumb:var(--surface-3);
  position:fixed;z-index:75;width:var(--sb);overflow:auto;overscroll-behavior:contain;padding:6px 6px 6px;
  background:var(--pm-bg);border:1px solid var(--line-strong);border-radius:14px;
  box-shadow:0 26px 60px -18px rgba(0,0,0,.75),0 2px 8px rgba(0,0,0,.3);
  opacity:0;transform:translateY(12px);transition:opacity .18s var(--ease-out),transform .18s var(--ease-out)}
:root[data-theme=light] .pmenu{--pm-bg:var(--surface-1);--pm-track:var(--surface-2);--pm-thumb:var(--surface-1);
  box-shadow:0 24px 54px -18px rgba(15,23,42,.3),0 2px 8px rgba(15,23,42,.07)}
.pmenu[data-mode=rail]{transform:translateX(-8px)}
.pmenu.pm-open,.pmenu[data-mode=rail].pm-open{opacity:1;transform:none}
.pmenu.pm-closing{transition-duration:.14s;transition-timing-function:cubic-bezier(.4,0,1,1)}
.pm-grab{display:none}
/* The sidebar-wide panel is narrow: drop the Alt keys and the theme icons. */
.pmenu{container-type:inline-size}
@container (max-width:250px){.pm-keys.alt,.pm-theme .seg .i{display:none}}
.pm-head{display:flex;align-items:center;gap:11px;padding:8px 6px 12px 8px;margin:0 2px 2px;border-bottom:1px solid var(--line)}
.pm-who{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;line-height:1.45}
.pm-who b{font-size:14px;font-weight:680;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pm-who>span{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden}
.pm-who em{font-style:normal;opacity:.6}
.pm-dot{width:7px;height:7px;flex:none;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px var(--ok-soft)}
.pmenu .pm-close{display:none}
.pm-glabel{padding:10px 10px 5px;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)}
.pm-theme{padding:0 2px 4px}
.pm-theme .seg{display:flex;width:100%;padding:3px;background:var(--pm-track);border-color:var(--line)}
.pm-theme .seg button{flex:1;height:30px;padding:0 6px;gap:6px;justify-content:center;font-size:12.5px;color:var(--muted)}
.pm-theme .seg .i{width:14px;height:14px}
.pm-theme .seg button[aria-pressed=true]{background:var(--pm-thumb);color:var(--fg)}
.pm-theme .seg button[aria-pressed=true] .i{color:var(--accent)}
.pm-theme .seg button:focus-visible{outline:2px solid var(--accent-line);outline-offset:-1px}
.pm-item{position:relative;display:flex;align-items:center;gap:11px;width:100%;height:36px;padding:0 8px 0 10px;border-radius:9px;text-align:left;
  font-size:13.5px;font-weight:550;color:var(--text-2);transition:background var(--dur-1),color var(--dur-1)}
.pm-item .i{width:17px;height:17px;flex:none;color:var(--muted);transition:color var(--dur-1)}
.pm-item:hover,.pm-item:focus-visible{background:var(--hover);color:var(--fg);box-shadow:none}
.pm-item:hover .i,.pm-item:focus-visible .i{color:var(--fg)}
.pm-item:focus-visible{outline:2px solid var(--accent-line);outline-offset:-2px}
/* Current page: tinted row, accent icon, a short bar at the left edge. */
.pm-item.active{background:var(--accent-soft);color:var(--fg)}
.pm-item.active .i{color:var(--accent)}
.pm-item.active::before{content:"";position:absolute;left:0;top:9px;bottom:9px;width:3px;border-radius:0 3px 3px 0;background:var(--accent)}
.pm-label{flex:1;min-width:0;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pm-keys{display:flex;gap:3px;flex:none;opacity:.8}
.pm-keys kbd{height:18px;min-width:18px;padding:0 4px;font-size:10px}
.pm-live{display:inline-flex;align-items:center;gap:5px;flex:none;font-size:11px;font-weight:700;color:var(--accent);background:var(--accent-soft);
  border:1px solid var(--accent-line);border-radius:99px;padding:0 7px 0 6px;line-height:18px}
.pm-live i{width:6px;height:6px;border-radius:50%;background:currentColor;animation:pm-live 1.6s ease-in-out infinite}
@keyframes pm-live{50%{opacity:.35}}
.pm-sep{height:1px;background:var(--line);margin:6px 4px}
.pm-item.danger{color:var(--danger)}
.pm-item.danger .i{color:var(--danger)}
.pm-item.danger:hover,.pm-item.danger:focus-visible{color:var(--danger);background:var(--danger-soft)}
.pm-item.danger:focus-visible{outline-color:color-mix(in srgb,var(--danger) 45%,transparent)}
/* Bottom sheet: pinned to the bottom edge, handle on top, Close in reach. */
.pmenu.sheet{left:0;right:0;bottom:0;margin:0 auto;width:min(560px,100%);max-height:calc(100dvh - var(--safe-t) - 28px);
  padding:0 12px max(14px,var(--safe-b));border-bottom:0;border-radius:22px 22px 0 0;opacity:1;transform:translateY(100%);
  box-shadow:0 -24px 60px -24px rgba(0,0,0,.7);transition:transform .3s var(--ease-out)}
:root[data-theme=light] .pmenu.sheet{box-shadow:0 -20px 50px -24px rgba(15,23,42,.3)}
.pmenu.sheet.pm-open{transform:none}
.pmenu.sheet.pm-closing{transition:transform .22s cubic-bezier(.4,0,1,1)}
.pmenu.sheet .pm-grab{display:block;position:sticky;top:0;z-index:1;height:22px;margin:0 -12px;background:var(--pm-bg);cursor:grab}
.pmenu.sheet .pm-grab::before{content:"";position:absolute;left:50%;top:9px;width:38px;height:5px;translate:-50% 0;border-radius:99px;background:var(--line-strong)}
.pmenu.sheet .pm-head{padding:4px 0 14px 4px;margin:0 0 2px}
.pmenu.sheet .user-avatar.lg{width:46px;height:46px;font-size:18px;border-radius:15px}
.pmenu.sheet .pm-who b{font-size:16px}
.pmenu.sheet .pm-who>span{font-size:12.5px}
.pmenu.sheet .pm-close{display:grid;width:40px;height:40px;border-radius:12px;background:var(--pm-track);border:1px solid var(--line)}
.pmenu.sheet .pm-glabel{padding:12px 10px 6px}
.pmenu.sheet .pm-theme{padding:0 0 4px}
.pmenu.sheet .pm-theme .seg{padding:4px;border-radius:13px}
.pmenu.sheet .pm-theme .seg button{height:40px;font-size:14px;border-radius:10px}
.pmenu.sheet .pm-theme .seg .i{width:16px;height:16px}
.pmenu.sheet .pm-item{height:46px;gap:14px;font-size:15px;border-radius:12px;padding:0 12px}
.pmenu.sheet .pm-item .i{width:20px;height:20px}
.pmenu.sheet .pm-item.active::before{top:12px;bottom:12px}
.pmenu.sheet .pm-keys{display:none}
.pmenu.sheet .pm-sep{margin:8px 4px}
@media (prefers-reduced-motion:reduce){.pmenu,.pmenu.sheet,.pm-scrim.dim{transition:none}.pm-live i{animation:none}}

/* rail tooltip */
.nav-tip{position:fixed;z-index:120;left:0;top:0;pointer-events:none;padding:6px 10px;border-radius:9px;font-size:12.5px;font-weight:600;
  background:var(--glass-strong);color:var(--fg);border:1px solid var(--line-strong);box-shadow:var(--shadow);
  opacity:0;transform:translateX(-4px);transition:opacity var(--dur-1),transform var(--dur-2) var(--ease-out);white-space:nowrap}
.nav-tip.on{opacity:1;transform:none}
.nav-tip kbd{margin-left:8px;height:18px;min-width:18px;font-size:10px}

/* ── slim icon rail (desktop and tablet) ─────────────────────────────── */
@media (min-width:761px){
  #app.side-collapsed{grid-template-columns:var(--rail) minmax(0,1fr)}
  #app.side-collapsed .side-head{flex-direction:column;height:auto;padding:12px 0 8px;gap:8px}
  #app.side-collapsed .brand{flex:none;margin:0;padding:4px}
  #app.side-collapsed .brand-text,#app.side-collapsed .brand-ver{display:none}
  #app.side-collapsed .side-collapse .sc-chev{transform:rotate(180deg)}
  #app.side-collapsed .side-actions{padding:4px 12px 10px;align-items:center}
  #app.side-collapsed .side-new{width:44px;height:42px;padding:0;justify-content:center}
  #app.side-collapsed .side-new-label{display:none}
  #app.side-collapsed .nav{padding:0 12px;align-items:center}
  #app.side-collapsed .nav-item{width:44px;height:42px;padding:0;justify-content:center;gap:0}
  #app.side-collapsed .nav-item .ni-label,#app.side-collapsed .nav-item .ni-kbd{display:none}
  #app.side-collapsed .side-sec{display:none}
  #app.side-collapsed .side-foot{padding:10px 0 14px;display:flex;flex-direction:column;align-items:center}
  #app.side-collapsed .side-collapse{width:44px;justify-content:center;padding:0}
  #app.side-collapsed .sc-label{display:none}
  #app.side-collapsed .side-meta{display:none}
  #app.side-collapsed .side-stats{display:grid;place-items:center;width:44px;height:38px;border-radius:var(--r-sm);color:var(--text-2);margin-bottom:4px}
  #app.side-collapsed .side-stats:hover,#app.side-collapsed .side-stats[aria-expanded=true]{background:var(--hover);color:var(--fg)}
  #app.side-collapsed .profile-btn{width:44px;height:44px;padding:0;justify-content:center}
  #app.side-collapsed .pb-main,#app.side-collapsed .pb-chev{display:none}
}

/* ── top bar ─────────────────────────────────────────────────────────── */
#topbar{display:flex;align-items:center;gap:6px;height:var(--topbar);padding:0 14px 0 22px;flex:none;position:relative;z-index:20;
  border-bottom:1px solid var(--line);background:var(--glass);backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px)}
#sideToggle{display:none;width:40px;height:40px;margin-left:-6px}
.tb-title{min-width:0;display:flex;align-items:center;gap:10px}
.crumb{font-weight:680;font-size:15px;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:36vw}
.tb-search{display:flex;align-items:center;gap:9px;height:36px;width:170px;padding:0 6px 0 12px;margin-right:6px;
  border-radius:11px;background:var(--surface-2);border:1px solid var(--line);color:var(--muted);font-size:13px;
  transition:width .32s cubic-bezier(.2,.8,.2,1),border-color var(--dur-1),background var(--dur-1),box-shadow var(--dur-2),color var(--dur-1)}
.tb-search:hover,.tb-search:focus-visible,.tb-search.hint{width:clamp(300px,32vw,460px);border-color:color-mix(in srgb,var(--accent) 45%,var(--line));
  color:var(--text-2);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 14%,transparent),0 6px 24px -10px color-mix(in srgb,var(--accent) 45%,transparent)}
.tb-search .i{width:16px;height:16px;transition:color var(--dur-1)}
.tb-search:hover .i,.tb-search.hint .i{color:var(--accent)}
.tb-search-label{flex:1;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:opacity .25s}
.tb-search-label.swap{opacity:0}
.tb-search.hint{animation:tbHint 1.6s cubic-bezier(.2,.8,.2,1)}
@keyframes tbHint{0%,100%{box-shadow:0 0 0 0 transparent}35%{box-shadow:0 0 0 5px color-mix(in srgb,var(--accent) 22%,transparent),0 6px 26px -8px color-mix(in srgb,var(--accent) 55%,transparent)}}
@media (prefers-reduced-motion:reduce){.tb-search,.tb-search-label{transition:none}.tb-search.hint{animation:none}}
/* ── realtime indicator ──────────────────────────────────────────────── */
.rt{--rt:var(--warn);display:inline-flex;align-items:center;gap:8px;height:34px;width:auto;min-width:118px;padding:0 10px 0 11px;border-radius:99px;flex:none;
  border:1px solid color-mix(in srgb,var(--rt) 32%,var(--line));background:color-mix(in srgb,var(--rt) 8%,var(--surface-2));
  color:var(--text-2);font-size:12.5px;font-weight:620;white-space:nowrap;
  transition:border-color var(--dur-3),background var(--dur-3),color var(--dur-3)}
.rt:hover{border-color:color-mix(in srgb,var(--rt) 55%,var(--line))}
.rt[data-state=connecting]{--rt:var(--muted)}
.rt[data-state=on]{--rt:var(--ok)}
.rt[data-state=off]{--rt:var(--danger)}
.rt-dot{position:relative;width:9px;height:9px;flex:none}
.rt-dot i{position:absolute;inset:0;border-radius:50%;background:var(--rt);box-shadow:0 0 10px color-mix(in srgb,var(--rt) 70%,transparent)}
.rt-dot::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--rt);opacity:0}
.rt[data-state=on] .rt-dot::after{animation:rt-ripple 2.2s var(--ease-out) infinite}
.rt[data-state=connecting] .rt-dot i{animation:rt-blink 1s ease-in-out infinite}
@keyframes rt-ripple{0%{opacity:.55;transform:scale(1)}100%{opacity:0;transform:scale(3)}}
@keyframes rt-blink{0%,100%{opacity:1}50%{opacity:.3}}
.rt-label{color:var(--fg);flex:1;min-width:0}
/* Fixed-size skeleton while connecting, so the header never shifts. */
.rt[data-state=connecting] .rt-label,.rt[data-state=connecting] .rt-agents b,.rt[data-state=connecting] .rt-idle b{color:transparent;border-radius:6px;
  background:linear-gradient(90deg,var(--surface-3,rgba(255,255,255,.06)) 25%,rgba(255,255,255,.14) 50%,var(--surface-3,rgba(255,255,255,.06)) 75%);
  background-size:200% 100%;animation:rt-skel 1.2s linear infinite}
.rt[data-state=connecting] .rt-label{height:10px}
.rt[data-state=connecting] .rt-agents{color:var(--muted)}
@keyframes rt-skel{from{background-position:200% 0}to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.rt[data-state=connecting] .rt-label,.rt[data-state=connecting] .rt-agents b,.rt[data-state=connecting] .rt-idle b{animation:none}}
.rt-agents{display:inline-flex;align-items:center;gap:4px;padding-left:8px;margin-left:1px;border-left:1px solid var(--line-strong);
  color:var(--muted);font-variant-numeric:tabular-nums}
.rt-agents .i{width:15px;height:15px}
.rt-agents b{font-weight:700}
.rt-agents.on{color:var(--accent)}
.rt-agents b,.rt-idle b{display:inline-block;min-width:1.4ch;text-align:center}
.rt-agents{position:relative}
.rt-agents .i{transform-origin:50% 70%}
/* Waking: a spark leaves the moon, the robot powers up with a ring burst and
   the count rolls up. Sleeping: the robot droops, a spark drifts back to the
   moon and "z"s float off it while the count rolls down. */
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
  background:var(--accent);box-shadow:0 0 8px var(--accent);pointer-events:none;animation:rt-fly-in .5s cubic-bezier(.5,0,.5,1) forwards}
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
  background:var(--glass-strong);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid var(--line-strong);
  border-radius:16px;box-shadow:var(--shadow-lg);overflow:hidden;animation:ds-pop var(--dur-2) var(--ease-out);transform-origin:top right}

/* ── mobile tab bar ──────────────────────────────────────────────────── */
.tabbar{display:none}

/* ── command palette ─────────────────────────────────────────────────── */
.palette{position:fixed;inset:0;z-index:85;display:flex;justify-content:center;align-items:flex-start;padding:12vh 16px 16px;
  background:rgba(3,5,9,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:ds-fade var(--dur-2) var(--ease)}
:root[data-theme=light] .palette{background:rgba(15,23,42,.24)}
.pal{width:min(680px,100%);max-height:min(620px,76vh);display:flex;flex-direction:column;overflow:hidden;
  background:var(--glass-strong);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
  border:1px solid var(--line-strong);border-radius:20px;box-shadow:var(--shadow-lg);animation:ds-pop var(--dur-3) var(--ease-out)}
.pal-in{display:flex;align-items:center;gap:12px;padding:0 14px 0 18px;height:60px;border-bottom:1px solid var(--line);flex:none}
.pal-in .i{width:20px;height:20px;color:var(--accent)}
.pal-in input{flex:1;min-width:0;height:100%;background:none;border:0;outline:none;font-size:16.5px;color:var(--fg);box-shadow:none}
.pal-in input::placeholder{color:var(--text-3)}
.pal-in input::-webkit-search-cancel-button{display:none}
.pal-list{flex:1 1 auto;overflow:auto;padding:6px 8px 10px;overscroll-behavior:contain}
.pal-sec{padding:12px 10px 6px;font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--text-3);
  display:flex;align-items:center;gap:8px}
.pal-sec .pal-spin{width:12px;height:12px;border-radius:50%;border:2px solid var(--line-strong);border-top-color:var(--accent);animation:pal-spin .7s linear infinite}
@keyframes pal-spin{to{transform:rotate(360deg)}}
.pal-opt{display:flex;align-items:center;gap:12px;width:100%;min-height:44px;padding:8px 10px;border-radius:12px;text-align:left;cursor:pointer;
  color:var(--text-2);scroll-margin:8px}
.pal-opt .po-ico{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;flex:none;
  background:var(--surface-2);border:1px solid var(--line);color:var(--text-2)}
.pal-opt .po-ico .i{width:16px;height:16px}
.pal-opt .po-main{flex:1;min-width:0}
.pal-opt .po-title{font-size:13.5px;font-weight:600;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pal-opt .po-sub{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pal-opt .po-snip{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pal-opt .po-snip b,.pal-opt mark{color:var(--accent);background:none;font-weight:700}
.pal-opt .po-hint{font-size:11.5px;color:var(--text-3);flex:none;display:flex;gap:4px;align-items:center}
.pal-opt[aria-selected=true]{background:var(--accent-soft);color:var(--fg)}
.pal-opt[aria-selected=true] .po-ico{background:var(--accent);border-color:transparent;color:var(--on-accent)}
.pal-opt[aria-selected=true] .po-hint .ret{opacity:1}
.pal-opt .po-hint .ret{opacity:0}
.pal-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:34px 20px;text-align:center;color:var(--muted);font-size:13px;line-height:1.5}
.pal-empty b{color:var(--fg);font-size:14px;font-weight:650}
.pal-empty span:last-child{max-width:340px}
.pal-empty .pe-ico{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:var(--surface-2);border:1px solid var(--line);color:var(--text-3);margin-bottom:4px}
.pal-empty .pe-ico .i{width:20px;height:20px}
/* a plain sentence over "maybe you meant" suggestions */
.pal-note{padding:12px 10px 6px;font-size:12.5px;color:var(--text-2)}
.pal-opt .po-why{font-size:11.5px;color:var(--accent);margin-top:2px}
.pal-closebar{display:none}
.pal-foot{display:flex;align-items:center;gap:14px;padding:9px 16px;border-top:1px solid var(--line);font-size:11.5px;color:var(--muted);flex:none}
.pal-foot span{display:inline-flex;align-items:center;gap:5px}
.pal-foot kbd{height:18px;min-width:18px;font-size:10px}

/* ── peek ────────────────────────────────────────────────────────────── */
.peek{position:absolute;right:16px;top:calc(var(--topbar) + 14px);bottom:16px;width:min(var(--peek),44vw);z-index:15;
  display:flex;flex-direction:column;background:var(--glass-strong);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
  border:1px solid var(--line-strong);border-radius:var(--r-lg);box-shadow:var(--shadow-lg);overflow:hidden;
  transition:opacity var(--dur-2) var(--ease),transform var(--dur-3) var(--ease-out)}
.peek.hidden{display:flex !important;opacity:0;transform:translateX(16px);pointer-events:none;visibility:hidden}
.peek-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}
.peek-folder{font-size:12.5px;font-weight:650;color:var(--accent-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.peek-acts{margin-left:auto;display:flex;align-items:center;gap:4px}
.peek-body{flex:1;overflow:auto;padding:16px 18px}

/* ── account and guide ───────────────────────────────────────────────── */
.acct-head{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.acct-name{font-size:15px;font-weight:680}
.acct-sub{font-size:12px;color:var(--muted)}
.acct-theme{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:14px 0 4px;padding-top:14px;border-top:1px solid var(--line)}
.acct-theme > span{font-size:13px;font-weight:600}
.guide{display:flex;flex-direction:column;gap:10px}
.guide p{margin:0;font-size:13px;line-height:1.6;color:var(--muted)}
.guide-about{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;align-items:center;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
.guide-about .guide-mark{width:40px;height:40px;grid-row:span 1}
.guide-about>div b{display:block;font-size:14px;color:var(--fg)}
.guide-about .guide-motto{font-size:12px;font-weight:600;color:var(--accent)}
.guide-about p{grid-column:1/-1}
.guide-about .guide-name{font-size:12px;font-style:italic}
.guide-about .guide-btns{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px}
.guide b{color:var(--fg);font-weight:650}
.guide code{font-family:var(--mono);font-size:12px;padding:1px 5px;border-radius:5px;background:var(--surface-2);color:var(--accent-3)}
.guide-keys{display:grid;grid-template-columns:auto 1fr;gap:8px 14px;align-items:center;font-size:13px;color:var(--text-2);
  padding:12px 14px;border-radius:12px;background:var(--surface-2);border:1px solid var(--line)}
.guide-keys > span:nth-child(odd){display:flex;gap:4px}

/* ── tablet ──────────────────────────────────────────────────────────── */
@media (max-width:1180px){
  /* Narrower desktops keep the compact box and still widen on hover. */
  .tb-search{width:140px}
  .tb-search:hover,.tb-search:focus-visible,.tb-search.hint{width:clamp(220px,38vw,380px)}
  .tb-search kbd{display:none}
}
@media (max-width:1000px){
  .rt-label{display:none}
  /* Label hidden: a tight capsule of dot | robot count | moon count. */
  .rt{width:auto;min-width:0;gap:7px}
  .rt-agents{padding-left:7px;gap:3px}
  .rt-agents b,.rt-idle b{min-width:1.3ch;font-variant-numeric:tabular-nums}
  .peek{width:min(420px,88vw)}
}

/* ── phones: drawer + bottom tab bar ─────────────────────────────────── */
@media (max-width:760px){
  #app{grid-template-columns:minmax(0,1fr)}
  #main{grid-column:1}
  #sideScrim{display:block}
  /* The bar is just as tall as its content plus even space above and below;
     the home-indicator zone (safe area) is added underneath, not inside. */
  :root{--tabbar:60px;--tb-pad:var(--safe-b)}
  #main{padding-bottom:calc(var(--tabbar) + var(--tb-pad))}
  /* While a node is being edited, Save and Cancel own the bottom of the screen. */
  #app:has(.vx-page.editing) .tabbar{display:none}
  #main:has(.vx-page.editing){padding-bottom:0}
  #sidebar{position:fixed;top:0;bottom:0;left:0;width:min(320px,88vw);z-index:60;transform:translateX(-104%);
    border-radius:0 22px 22px 0;border-right:1px solid var(--line-strong);box-shadow:var(--shadow-lg);
    transition:transform var(--dur-3) var(--ease-out),visibility 0s linear var(--dur-3);visibility:hidden;
    padding-top:var(--safe-t);background:var(--surface-1)}
  #app.side-open #sidebar{transform:none;visibility:visible;transition:transform var(--dur-3) var(--ease-out)}
  #sideScrim{position:fixed;inset:0;z-index:55;background:rgba(3,5,9,.55);opacity:0;pointer-events:none;
    transition:opacity var(--dur-3);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
  :root[data-theme=light] #sideScrim{background:rgba(15,23,42,.3)}
  #app.side-open #sideScrim{opacity:1;pointer-events:auto}
  .side-collapse{display:none}
  /* The tab bar covers navigation, so the drawer is just the library. */
  #nav,#recentSec,.side-foot{display:none}
  .side-close{display:grid}
  .nav-item,.side-new{height:44px;font-size:14.5px}
  .nav-item .ni-kbd{display:none}

  #topbar{height:calc(54px + var(--safe-t));padding:var(--safe-t) 8px 0 12px;gap:4px}
  #sideToggle{display:grid}
  .crumb{font-size:16.5px;max-width:none}
  .tb-title{flex:1 1 auto}
  #topbar > .grow{display:none}
  .tb-opt{display:none !important}
  /* Search collapses to a round icon beside the realtime capsule. */
  .tb-search,.tb-search:hover,.tb-search:focus-visible,.tb-search.hint{width:34px;height:34px;padding:0;margin-right:2px;flex:none;
    justify-content:center;border-radius:50%}
  .tb-search-label,.tb-search kbd{display:none}
  .rt{height:32px;padding:0 9px}
  .view{padding:16px 14px 32px}
  .peek{right:8px;left:8px;top:calc(62px + var(--safe-t));bottom:8px;width:auto}

  /* Tab bar: docked, solid, with Brain as a raised circle sitting in a notch
     cut out of the bar's top edge. Active tabs turn accent and get a short
     line along the top edge, well away from the bottom of the screen. */
  .tabbar{display:grid;grid-template-columns:repeat(5,1fr);position:fixed;left:0;right:0;bottom:0;z-index:50;
    height:calc(var(--tabbar) + var(--tb-pad));padding:0 4px var(--tb-pad);
    background:var(--surface-1);border-top:1px solid var(--line-strong);box-shadow:0 -10px 30px -18px rgba(0,0,0,.6)}
  .tab-item{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
    color:var(--muted);font-size:10.5px;font-weight:650;letter-spacing:.01em;-webkit-tap-highlight-color:transparent;transition:color var(--dur-2)}
  .tab-item .ti-ico{position:relative;display:grid;place-items:center;width:44px;height:28px}
  .tab-item .i{width:22px;height:22px;transition:transform var(--dur-2) var(--ease-spring)}
  .tab-item:active .i{transform:scale(.88)}
  .tab-item::after{content:"";position:absolute;top:-1px;left:50%;width:0;height:3px;translate:-50% 0;border-radius:0 0 4px 4px;
    background:var(--accent);transition:width var(--dur-2) var(--ease-out)}
  .tab-item.active{color:var(--accent)}
  .tab-item.active::after{width:24px}
  .tab-item.active .user-avatar{box-shadow:0 0 0 2px var(--surface-1),0 0 0 3.5px var(--accent)}
  .tab-item .ti-badge{position:absolute;top:-2px;right:4px;min-width:16px;height:16px;padding:0 4px;border-radius:99px;
    background:var(--accent);color:var(--on-accent);font-size:9.5px;font-weight:800;display:none;place-items:center;
    border:2px solid var(--surface-1)}
  .tab-item .ti-badge.on{display:grid}
  /* Brain: icon only, a raised circle; the ring in the page colour cuts the
     notch into the bar, the thin outer ring continues the bar's border. */
  .tab-item.prime>span:last-child{display:none}
  .tab-item.prime::after{display:none}
  .tab-item.prime .ti-ico{width:58px;height:58px;border-radius:50%;translate:0 -24px;color:#fff;background:var(--primary);
    box-shadow:0 0 0 6px var(--bg),0 0 0 7px var(--line-strong),0 12px 24px -8px color-mix(in srgb,var(--primary) 80%,transparent);
    transition:box-shadow var(--dur-2),transform var(--dur-2) var(--ease-spring)}
  .tab-item.prime .i{width:27px;height:27px;color:#fff}
  .tab-item.prime:active .ti-ico{transform:scale(.94)}
  .tab-item.prime.active .ti-ico{box-shadow:0 0 0 6px var(--bg),0 0 0 7px var(--line-strong),0 0 0 10px color-mix(in srgb,var(--primary) 22%,transparent),
    0 12px 26px -6px color-mix(in srgb,var(--primary) 90%,transparent)}

  /* Phones: search takes the whole screen (the part above the keyboard) with a
     big Close bar at the bottom, in reach of the thumb. */
  .palette{padding:0;align-items:stretch;background:var(--surface-1)}
  .pal{width:100%;max-height:none;height:var(--pal-h,100dvh);margin-top:var(--pal-top,0px);border:0;border-radius:0;box-shadow:none;
    padding-top:var(--safe-t);animation:pal-up .3s cubic-bezier(.2,.8,.2,1)}
  @keyframes pal-up{from{transform:translateY(28px);opacity:0}}
  /* closing: slide down and fade (see closePalette) */
  .palette{transition:opacity .22s ease}
  .palette.closing{opacity:0}
  .palette.closing .pal{transform:translateY(28px);transition:transform .22s cubic-bezier(.4,0,1,1)}
  .pal-in{height:58px}
  .pal-closebar{display:block;flex:none;padding:10px 14px calc(10px + var(--safe-b));border-top:1px solid var(--line);background:var(--surface-1)}
  /* Close: tinted so it is easy to spot, with a small nudge as the search opens. */
  .pal-closebtn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:50px;border-radius:16px;
    background:var(--accent-soft);border:1px solid var(--accent-line);color:var(--accent);font-size:15px;font-weight:700;
    animation:pal-nudge .7s .35s cubic-bezier(.2,.8,.2,1) both}
  .pal-closebtn .i{width:20px;height:20px}
  .pal-closebtn:active{transform:scale(.98);background:color-mix(in srgb,var(--accent) 20%,transparent)}
  @keyframes pal-nudge{0%{transform:translateY(10px);opacity:0}60%{transform:translateY(-3px);opacity:1}100%{transform:none}}
  @media (prefers-reduced-motion:reduce){.pal,.pal-closebtn{animation:none}}
  .pal-foot,.pal-opt .po-hint kbd{display:none}
  .rt-pop{top:calc(62px + var(--safe-t));right:8px}
}
@media (max-width:380px){
  .crumb{font-size:15.5px}
  .rt-agents .i,.rt-idle .i{width:13px;height:13px}
}
`;
