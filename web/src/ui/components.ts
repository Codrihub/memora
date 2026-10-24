import { attr, esc } from '../dom';
import { Modal } from '../modal';
import { icon } from './icons';

export const COMPONENTS_CSS = `
.user-avatar,.acct-avatar{display:grid;place-items:center;flex:none;border-radius:99px;background:var(--avatar-bg);color:var(--avatar-fg);font-weight:800}
.user-avatar{width:32px;height:32px;font-size:13px}
.user-avatar.sm{width:24px;height:24px;font-size:11px}
.user-avatar.lg{width:40px;height:40px;font-size:16px;border-radius:13px}
.acct-avatar{width:44px;height:44px;border-radius:14px;font-size:17px}
.ag-av{display:inline-grid;place-items:center;flex:none;border-radius:50%;font-weight:750;letter-spacing:.02em;line-height:1;
  color:var(--ag);background:color-mix(in srgb,var(--ag) 17%,var(--panel));
  box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--ag) 55%,transparent)}
.ag-av.live{position:relative}
.ag-av.live::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid var(--ag);opacity:.0;
  animation:agPulse 1.6s var(--ease) infinite}
@keyframes agPulse{0%{opacity:.75;transform:scale(.86)}100%{opacity:0;transform:scale(1.18)}}

@media (prefers-reduced-motion:reduce){.ag-av.live::after{animation:none}}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 15px;
  border-radius:10px;background:var(--surface-2);border:1px solid var(--line-strong);color:var(--fg);
  font-size:13.5px;font-weight:550;letter-spacing:-.005em;white-space:nowrap;line-height:1;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05);
  transition:background var(--dur-1),border-color var(--dur-1),color var(--dur-1),box-shadow var(--dur-1),transform .1s}
:root[data-theme=light] .btn{background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.05)}
.btn:hover{background:var(--surface-3);border-color:var(--line-strong)}
.btn:active{background:var(--press);transform:translateY(.5px)}
.btn .i{width:16px;height:16px}
.btn.primary,:root[data-theme=light] .btn.primary{background:linear-gradient(180deg,color-mix(in srgb,var(--primary) 78%,#fff),var(--primary) 60%);
  border-color:transparent;color:var(--on-primary);font-weight:600;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 1px 2px rgba(3,37,42,.18),0 6px 16px -8px color-mix(in srgb,var(--primary) 70%,transparent)}
.btn.primary:hover,:root[data-theme=light] .btn.primary:hover{background:linear-gradient(180deg,color-mix(in srgb,var(--primary-hover) 72%,#fff),var(--primary-hover) 60%);border-color:transparent}
.btn.danger{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 35%,transparent);background:var(--danger-soft)}
.btn.danger:hover{background:color-mix(in srgb,var(--danger) 18%,transparent)}
.btn.ghost,:root[data-theme=light] .btn.ghost{background:transparent;border-color:transparent;color:var(--text-2);box-shadow:none}
.btn.ghost:hover{background:var(--hover);color:var(--fg)}
.btn.sm{height:28px;padding:0 10px;font-size:12px;border-radius:var(--r-xs)}
.btn.lg{height:42px;padding:0 18px;font-size:14px}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn.link{height:auto;padding:2px 0;border:0;background:none;color:var(--accent);font-weight:600}
.btn.link:hover{background:none;text-decoration:underline}

.icon-btn{display:grid;place-items:center;width:36px;height:36px;border-radius:var(--r-sm);color:var(--text-2);flex:none;
  position:relative;transition:background var(--dur-1),color var(--dur-1)}
.icon-btn:hover{background:var(--hover);color:var(--fg)}
.icon-btn:active{background:var(--press)}
.icon-btn.on{color:var(--accent);background:var(--accent-soft)}
.icon-btn .i{width:19px;height:19px}
.icon-btn.round{width:32px;height:32px;border-radius:50%;border:1px solid var(--line-strong);color:var(--text-2)}
.icon-btn.round .i{width:16px;height:16px}
.icon-btn.round:hover{border-color:var(--accent-line);color:var(--accent);background:var(--accent-soft)}
/* Touch targets at least 44px. */
@media (pointer:coarse){
  .btn{min-height:44px}
  .btn.sm{min-height:36px}
  .icon-btn:not(.sm):not(.round){width:44px;height:44px}
  .icon-btn.round{width:40px;height:40px}
}

.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:var(--r-pill);flex:none;white-space:nowrap;
  background:transparent;border:1px solid var(--line-strong);font-size:12.5px;font-weight:600;color:var(--text-2);
  transition:background var(--dur-1),border-color var(--dur-1),color var(--dur-1)}
.chip:hover{color:var(--fg);background:var(--hover)}
.chip.on,.chip[aria-pressed=true]{background:var(--primary);border-color:transparent;color:var(--on-primary)}
.chip.on:hover,.chip[aria-pressed=true]:hover{background:var(--primary-hover)}
@media (max-width:760px){
  .filters{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin-left:-16px;margin-right:-16px;padding:0 16px}
  .filters::-webkit-scrollbar{display:none}
}
.badge{display:inline-flex;align-items:center;gap:5px;height:20px;font-size:11.5px;font-weight:650;
  padding:0 8px;border-radius:var(--r-pill);border:1px solid var(--line-strong);color:var(--muted)}
.badge.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,transparent);background:var(--ok-soft)}
.badge.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 35%,transparent);background:var(--warn-soft)}
.badge.danger{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 35%,transparent);background:var(--danger-soft)}
.badge.accent{color:var(--accent);border-color:var(--accent-line);background:var(--accent-soft)}
.st{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-2);white-space:nowrap}
.st::before{content:"";width:7px;height:7px;border-radius:50%;flex:none;background:var(--text-3)}
.st.ok::before{background:var(--ok)}.st.warn::before{background:var(--warn)}.st.danger::before{background:var(--danger)}.st.accent::before{background:var(--accent)}

.card,.panel{background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;
  box-shadow:none}
.panel{margin-bottom:16px}
.card{padding:20px}
.panel-sub{font-size:12px;color:var(--muted);font-weight:400}
.panel-body{padding:16px 20px}
.panel-body.flush{padding:0}
.kv{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:13px}
.kv-k{color:var(--muted)}
.kv-v{font-family:var(--mono);font-size:12.5px;word-break:break-all}

.seg{display:inline-flex;padding:3px;gap:2px;border-radius:10px;background:var(--seg-track);border:0}
.seg button{height:32px;padding:0 14px;border-radius:var(--r-sm);font-size:14px;font-weight:550;color:var(--muted);border:1px solid transparent;
  display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background var(--dur-2),color var(--dur-2),border-color var(--dur-2)}
.seg button:hover{color:var(--fg)}
.seg button[aria-pressed=true],.seg button[aria-selected=true],.seg button.on{background:var(--seg-thumb);color:var(--fg);border-color:var(--line-strong)}
.seg .i{width:16px;height:16px}
.seg.sm button{height:28px;padding:0 10px;font-size:13px}
@media (pointer:coarse){.seg button{min-height:40px}}

.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px;flex-wrap:wrap}
.tab{padding:9px 13px;font-size:13px;font-weight:600;color:var(--muted);border-bottom:2px solid transparent;
  margin-bottom:-1px;transition:color var(--dur-1),border-color var(--dur-1)}
.tab:hover{color:var(--fg)}
.tab.active{color:var(--fg);border-bottom-color:var(--accent)}

.field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.field > label{font-size:12px;font-weight:600;color:var(--text-2)}
.field input[type=text],.field input[type=password],.field input[type=number],.field input[type=search],
.field select,.field textarea,.input{background:var(--surface-0);border:1px solid var(--line-strong);border-radius:var(--r-sm);
  padding:0 12px;height:38px;outline:none;transition:border-color var(--dur-1),box-shadow var(--dur-1);font-size:13.5px;width:100%}
.field textarea{height:auto;min-height:96px;padding:10px 12px;resize:vertical;font-family:var(--mono);font-size:12.5px;line-height:1.6}
.field input:focus,.field select:focus,.field textarea:focus,.input:focus{border-color:var(--accent-line);
  box-shadow:0 0 0 3px var(--accent-soft)}
.field .hint{font-size:12px;color:var(--muted)}
.switch{display:flex;align-items:center;gap:9px;font-size:13px;cursor:pointer}
.switch input{width:16px;height:16px;accent-color:var(--accent)}
.msg{font-size:12.5px;min-height:18px}
.msg.ok{color:var(--ok)}
.msg.err{color:var(--danger)}
.mono{font-family:var(--mono);font-size:12.5px}

.empty{padding:32px 16px;text-align:center;color:var(--muted);font-size:13px}

.modal-host{position:fixed;inset:0;z-index:80;display:grid;place-items:center;padding:24px;
  background:var(--scrim);animation:ds-fade var(--dur-2) var(--ease)}
@keyframes ds-fade{from{opacity:0}to{opacity:1}}
@keyframes ds-pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes ds-sheet{from{transform:translateY(100%)}to{transform:none}}
.modal{width:min(520px,100%);max-height:min(88vh,88dvh);display:flex;flex-direction:column;
  background:var(--surface-1);
  border:1px solid var(--line-strong);border-top-color:var(--ovl-edge);border-radius:var(--r);box-shadow:none;animation:ds-pop var(--dur-3) var(--ease-out)}
.modal.wide{width:min(760px,100%)}
.modal-grab{display:none}
.modal-head{display:flex;align-items:center;gap:8px;min-height:56px;padding:10px 12px 10px 20px;border-bottom:1px solid var(--line)}
.modal-title{font-size:16px;font-weight:650;margin:0;letter-spacing:-.01em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.modal-sub{font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.modal-x{margin-left:auto;width:32px;height:32px;border-radius:var(--r-sm);color:var(--muted);display:grid;place-items:center;flex:none}
.modal-x:hover{background:var(--hover);color:var(--fg)}
.modal-body{padding:20px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;font-size:14px;line-height:1.55}
.modal-body > p:only-child{margin:0;color:var(--text-2)}
.modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--line)}
.modal-foot .grow{flex:1}
@media (pointer:coarse){.modal-x{width:44px;height:44px;margin-right:-6px}}
@media (max-width:760px){
  .modal-host{place-items:end stretch;padding:0}
  .modal,.modal.wide{width:100%;max-width:100%;max-height:88dvh;border-radius:var(--r) var(--r) 0 0;border-bottom:0;
    animation:ds-sheet var(--dur-3) var(--ease-out);padding-bottom:var(--safe-b)}
  .modal-grab{display:block;flex:none;height:16px;touch-action:none;cursor:grab}
  .modal-grab::before{content:"";display:block;width:36px;height:4px;margin:8px auto 0;border-radius:99px;background:var(--line-strong)}
  .modal-head{min-height:48px;padding:2px 10px 10px 16px}
  .modal-body{padding:16px}
  .modal-foot{padding:12px 16px}
  .modal-foot .btn{flex:1 1 0;min-height:44px}
}

/* On map pages the stack keeps clear of the zoom column. */
.toasts{position:fixed;right:16px;bottom:16px;z-index:90;display:flex;flex-direction:column;align-items:stretch;gap:8px;
  width:min(360px,calc(100vw - 24px));max-height:calc(100dvh - var(--topbar) - 32px);pointer-events:none}
.toasts.expanded{overflow-y:auto;overscroll-behavior:contain;pointer-events:auto;scrollbar-width:thin}
:root:is([data-page=brain],[data-page=graph],[data-page=canvas]) .toasts{right:64px}
.toast{position:relative;flex:none;overflow:hidden;pointer-events:auto;display:flex;align-items:center;gap:10px;
  background:var(--ovl-bg);-webkit-backdrop-filter:var(--ovl-filter);backdrop-filter:var(--ovl-filter);
  border:1px solid var(--line-strong);border-top-color:var(--ovl-edge);touch-action:pan-y;user-select:none;
  border-radius:var(--r);min-height:48px;padding:8px 8px 8px 12px;font-size:13.5px;line-height:1.4;box-shadow:none;
  animation:ds-toast .36s var(--ease-out);transition:opacity .26s,transform .32s cubic-bezier(.2,.8,.2,1)}
.toast.stowed{display:none}
.toast.bump{animation:ds-toast-bump .32s var(--ease-out)}
.toast .t-ico{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;flex:none;color:var(--info)}
.toast .t-ico .i{width:18px;height:18px;stroke-width:2}
.toast.ok .t-ico{color:var(--ok)}
.toast.err .t-ico{color:var(--danger)}
.toast.warn .t-ico{color:var(--warn)}
.toast .t-msg{flex:1;min-width:0;word-break:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.toast .t-act{all:unset;cursor:pointer;flex:none;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;border-radius:var(--r-xs);
  font-size:12.5px;font-weight:650;color:var(--accent)}
.toast .t-act:hover{background:var(--accent-soft)}
.toast .t-act:focus-visible,.toast .t-x:focus-visible,.t-more:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.toast .t-act svg{width:13px;height:13px}
.toast .t-x{all:unset;cursor:pointer;flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:var(--r-xs);color:var(--muted)}
.toast .t-x:hover{background:var(--hover);color:var(--fg)}
.toast .t-x .i{width:14px;height:14px}
/* Only errors persist; the others auto-dismiss, so their close stays quiet. */
.toast:not(.err) .t-x{opacity:.55}
.toast:hover .t-x,.toast .t-x:focus-visible{opacity:1}
.toast.out{opacity:0;transform:translateX(24px) scale(.97)}
.toast.out-fast{opacity:0;transform:translateX(40px);transition-duration:.16s}
.t-more{all:unset;box-sizing:border-box;cursor:pointer;pointer-events:auto;flex:none;align-self:flex-end;display:inline-flex;align-items:center;height:28px;padding:0 12px;
  border-radius:99px;font-size:12px;font-weight:650;color:var(--text-2);background:var(--ovl-bg);-webkit-backdrop-filter:var(--ovl-filter);backdrop-filter:var(--ovl-filter);
  border:1px solid var(--line-strong);box-shadow:none;
  animation:ds-fade .2s var(--ease)}
.t-more:hover{color:var(--fg);border-color:var(--accent-line)}
@keyframes ds-toast{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes ds-toast-bump{40%{transform:translateX(-3px)}100%{transform:none}}
@media (max-width:760px){
  .toasts{left:12px;right:12px;width:auto;bottom:calc(var(--tabbar) + var(--tb-pad,0px) + var(--tb-gap,0px) + 10px);max-height:calc(100dvh - var(--tabbar) - 120px)}
  :root:is([data-page=brain],[data-page=graph],[data-page=canvas]) .toasts{right:56px}
  #app:has(.vx-page.editing) .toasts{bottom:calc(76px + var(--safe-b))}
}
@media (prefers-reduced-motion:reduce){.toast,.toast.bump,.t-more{animation:none}}

.f-acts button:hover,.n-acts button:hover{background:var(--hover)}
.gtip,.gcontrols button,.ghud,.glegend{background:var(--glass-strong);border-color:var(--line-strong)}
.note-body pre,.note-editor{background:var(--surface-0)}
.note-body .wikilink{border-bottom-color:var(--accent-line)}
.note-body .wikilink:hover{background:var(--accent-soft)}

.note-body table{display:block;width:max-content;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;border-collapse:collapse}
.note-body table th,.note-body table td{min-width:7em;max-width:clamp(28em,40vw,56em);vertical-align:top}
.note-body img{max-width:100%;height:auto}
.note-body figure.md-img{margin:1.1em 0;display:flex;flex-direction:column;align-items:flex-start;gap:7px;max-width:100%}
.note-body figure.md-img img,.note-body img.md-img-i{max-width:100%;height:auto;border-radius:var(--r-sm,10px);
  border:1px solid var(--line);background:var(--surface-2);cursor:zoom-in;
  transition:border-color var(--dur-2) var(--ease),box-shadow var(--dur-2) var(--ease),transform var(--dur-2) var(--ease)}
.note-body figure.md-img img{display:block;min-height:48px;min-width:48px;box-shadow:none}
.note-body figure.md-img img:hover{border-color:var(--accent-line,var(--line-strong));box-shadow:none}
.note-body figure.md-img figcaption{font-size:12px;line-height:1.45;color:var(--muted);padding:0 2px;max-width:100%}
.note-body img.md-img-i{display:inline-block;vertical-align:middle;max-height:12em;margin:2px 3px}
.note-body img.md-img-i:hover{border-color:var(--accent-line,var(--line-strong))}
.note-body img.md-img-link{max-height:2.4em;max-width:6em;object-fit:cover;margin-left:6px;border-radius:6px}
.note-body img.md-img-link:hover{transform:scale(1.04)}
.note-body .md-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:1.1em 0}
.note-body .md-gallery[data-n="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}
.note-body .md-gallery figure.md-img{margin:0;position:relative;aspect-ratio:4/3;overflow:hidden;border-radius:var(--r-sm,10px);gap:0}
.note-body .md-gallery figure.md-img img{width:100%;height:100%;max-width:none;object-fit:cover;border-radius:0;border:0;box-shadow:none;cursor:zoom-in;transition:transform .25s ease}
.note-body .md-gallery figure.md-img:hover img{transform:scale(1.03)}
.note-body .md-gallery figcaption{position:absolute;left:0;right:0;bottom:0;padding:6px 8px;font-size:11.5px;color:#fff;
  background:rgba(0,0,0,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.note-body .md-gallery figcaption:empty{display:none}
@media (prefers-reduced-motion:reduce){.note-body .md-gallery figure.md-img img{transition:none}}
.note-body .md-img-missing{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:7px;font-size:12px;
  color:var(--muted);background:var(--surface-2);border:1px dashed var(--line-strong);font-family:var(--mono)}
.note-body .md-img-missing::before{content:"";width:12px;height:10px;border:1.5px solid currentColor;border-radius:2px;opacity:.7;
  background:linear-gradient(135deg,transparent 55%,currentColor 56% 62%,transparent 63%)}
.nc-prev.note-body figure.md-img{margin:.5em 0}
.nc-prev.note-body figure.md-img img{max-height:180px;object-fit:cover}
@media (prefers-reduced-motion:reduce){.note-body img.md-img-link:hover{transform:none}}

:root{--ovl-r:14px;--sheet-r:18px}
:root .modal,:root .cc-menu,:root .vx-menu,:root .ui-sel-pop,:root .pmenu,:root .rt-pop,:root .pal,:root .vx-pop .vx-pop-card,:root .side-stats-pop,:root .toast{border-radius:var(--ovl-r);border:1px solid var(--line-strong)}
:root .vx-menu{background:var(--ovl-bg);-webkit-backdrop-filter:var(--ovl-filter);backdrop-filter:var(--ovl-filter)}
:root .cc-menu,:root .vx-menu,:root .ui-sel-lb{padding:6px}
:root .cc-menu button,:root .vx-menu-item,:root .ui-sel-o{min-height:36px;gap:11px;padding:0 10px;border-radius:8px;font-size:14px;color:var(--fg)}
:root .cc-menu button:hover:not(:disabled),:root .cc-menu button:focus-visible{background:var(--hover)}
:root .cc-menu .mi-ico,:root .vx-menu-item .vx-i{color:var(--muted)}
:root .cc-menu .mi-ico svg,:root .cc-menu .mi-ico .i,:root .vx-menu-item .vx-i{width:18px;height:18px}
:root .cc-menu .mi-t b,:root .ui-sel-o .tx b{font-weight:500}
:root .cc-menu button.danger,:root .cc-menu button.danger .mi-ico,:root .vx-menu-item.danger,:root .vx-menu-item.danger .vx-i{color:var(--danger)}
:root .cc-menu hr,:root .vx-menu-sep{margin:6px 4px}
:root .cc-menu-h{padding:8px 10px 10px;margin-bottom:6px;font-size:14px;font-weight:600}
:root .ui-sel-ck{stroke:var(--fg)}
:root .ui-sel-g,:root .pm-glabel{font-size:12px;font-weight:500;color:var(--muted)}
:root .modal-head{min-height:0;padding:18px 12px 4px 20px;border-bottom:0}
:root .modal-title{font-size:16px;font-weight:600}
:root .modal-body{padding:10px 20px 20px;color:var(--text-2)}
:root .modal-body > p:only-child{color:var(--text-2)}
:root .modal-foot,:root .cc-drawer-f{padding:12px 16px;gap:8px;border-top:1px solid var(--line);background:color-mix(in srgb,var(--fg) 2.5%,transparent)}
:root .modal-foot{border-radius:0 0 var(--ovl-r) var(--ovl-r)}
:root .modal-foot .btn,:root .cc-drawer-f .btn{height:36px;padding:0 16px;border-radius:9px;font-weight:600}
:root .modal-x,:root .ui-sel-x{border-radius:8px}
@media (min-width:761px){
  :root .cc-drawer{top:8px;right:8px;bottom:8px;width:min(460px,calc(100vw - 16px));border:1px solid var(--line-strong);border-radius:var(--ovl-r);overflow:hidden;
    transform:translateX(calc(100% + 16px))}
  :root .cc-drawer.in{transform:none}
}
:root .cc-drawer-h{padding:18px 14px 12px 20px;border-bottom:1px solid var(--line)}
:root .cc-drawer-h h3{font-size:16px;font-weight:600}
:root .modal-host,:root .cc-scrim,:root .cc-sh-scrim,:root .cc-menu-scrim.dim,:root .pm-scrim.dim,:root .vx-sheet-back{background:var(--scrim)}
@media (max-width:760px){
  :root .modal,:root .modal.wide,:root .cc-drawer,:root .cc-menu.sheet,:root .ui-sel-pop.sheet,:root .pmenu.sheet,:root .rt-pop,:root .vx-sheet .vx-pop-card{border-radius:var(--sheet-r) var(--sheet-r) 0 0}
  :root .modal-head{padding:4px 10px 4px 20px}
  :root .modal-body{padding:10px 20px 20px}
  :root .modal-foot{border-radius:0;padding:12px 16px calc(12px + var(--safe-b))}
  :root .modal-foot .btn,:root .cc-drawer-f .btn{height:46px;border-radius:12px}
  :root .cc-menu.sheet button,:root .vx-menu-item,:root .ui-sel-o{min-height:48px;font-size:15px}
  :root .cc-menu.sheet button{padding:8px 10px}
  :root .cc-menu.sheet .mi-ico{background:color-mix(in srgb,var(--fg) 6%,transparent);border-radius:10px}
}
.tc{display:flex;flex-direction:column;gap:12px;min-width:0}
.tc>p{margin:0;line-height:1.55;color:var(--text-2)}
.tc-list{margin:0;padding:8px 12px;list-style:none;border:1px solid var(--line);border-radius:10px;font-size:13px;color:var(--fg);
  background:color-mix(in srgb,var(--fg) 2.5%,transparent);display:flex;flex-direction:column;gap:4px;min-width:0}
.tc-list li{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-list li.more{color:var(--muted)}
.tc .field{margin:4px 0 0}
.tc .field>label{font-size:13px;font-weight:500}
.tc .field>label b{font-family:var(--mono);font-weight:600;color:var(--danger);padding:0 2px}
.tc .field input.tc-in{font-size:15px}
@media (max-width:760px){.tc .field input.tc-in{height:46px;font-size:16px}}
`;

function typedMatches(typed: string, word: string): boolean {
  return typed.trim().toLowerCase() === word.trim().toLowerCase();
}

interface TypedConfirmOptions {
  title: string;
  /** Trusted HTML. */
  body: string;
  items?: string[];
  /** Default `DELETE`. */
  word?: string;
  confirmLabel: string;
  run: () => void | Promise<void>;
}

let tcSeq = 0;

export function typedConfirm(o: TypedConfirmOptions): void {
  const word = (o.word || 'DELETE').toUpperCase();
  const id = 'tc-in-' + ++tcSeq;
  const items = o.items || [];
  const list = items.length
    ? `<ul class="tc-list">${items
        .slice(0, 4)
        .map((n) => `<li title="${attr(n)}">${esc(n)}</li>`)
        .join('')}${items.length > 4 ? `<li class="more">and ${items.length - 4} more</li>` : ''}</ul>`
    : '';
  let input: HTMLInputElement | null = null;
  let btn: HTMLButtonElement | null = null;
  const ok = (): boolean => !!input && typedMatches(input.value, word);
  const sync = (): void => {
    if (btn) btn.disabled = !ok();
  };
  Modal.open({
    title: o.title,
    body: `<div class="tc">${o.body}${list}<div class="field"><label for="${id}">Type <b>${esc(word)}</b> to confirm</label>
      <input id="${id}" class="tc-in" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="${attr(
        word,
      )}"></div></div>`,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      {
        label: o.confirmLabel,
        cls: 'danger',
        run: async () => {
          if (!ok()) return;
          await o.run();
          setTimeout(sync, 0);
        },
      },
    ],
    onOpen: (b) => {
      input = b.querySelector<HTMLInputElement>('.tc-in');
      btn = b.parentElement?.querySelector<HTMLButtonElement>('.modal-foot .btn.danger') || null;
      if (!input) return;
      input.oninput = sync;
      input.onkeydown = (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (ok() && btn && !btn.disabled) btn.click();
      };
      sync();
      setTimeout(() => input?.focus(), 50);
    },
  });
}

export function segmented<T extends string>(
  options: { value: T; label: string; icon?: string }[],
  value: T,
  onChange: (v: T) => void,
  ariaLabel = '',
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'seg';
  root.setAttribute('role', 'group');
  if (ariaLabel) root.setAttribute('aria-label', ariaLabel);
  const paint = (v: T): void => {
    root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.v === v));
    });
  };
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = o.value;
    b.innerHTML = (o.icon ? icon(o.icon) : '') + `<span>${esc(o.label)}</span>`;
    b.onclick = () => {
      paint(o.value);
      onChange(o.value);
    };
    root.appendChild(b);
  }
  paint(value);
  return root;
}
