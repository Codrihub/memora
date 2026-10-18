// Design system primitives: buttons, icon buttons, chips, badges, cards,
// segmented controls, fields, tabs, empty states, modal, toasts. The views
// produce the markup (.btn, .chip.on, .panel, .field ...); this file styles it.

import { esc } from '../dom';
import { icon } from './icons';

export const COMPONENTS_CSS = `
/* ── avatars ─────────────────────────────────────────────────────────── */
/* People: solid primary. Agents (.ag-av, from avatarHTML): tinted with their own color. */
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
.ag-tag{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--fg);min-width:0}
.ag-tag>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

@media (prefers-reduced-motion:reduce){.ag-av.live::after{animation:none}}

/* ── buttons ─────────────────────────────────────────────────────────── */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:34px;padding:0 14px;
  border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--line-strong);color:var(--fg);
  font-size:13px;font-weight:600;white-space:nowrap;line-height:1;
  transition:background var(--dur-1),border-color var(--dur-1),color var(--dur-1),transform var(--dur-1),box-shadow var(--dur-2)}
.btn:hover{background:var(--surface-3);border-color:var(--line-strong)}
.btn:active{transform:scale(.97)}
.btn .i{width:16px;height:16px}
.btn.primary{background:var(--primary);border-color:transparent;color:var(--on-primary)}
.btn.primary:hover{background:var(--primary-hover);border-color:transparent}
.btn.danger{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 35%,transparent);background:var(--danger-soft)}
.btn.danger:hover{background:color-mix(in srgb,var(--danger) 18%,transparent)}
.btn.ghost{background:transparent;border-color:transparent;color:var(--text-2)}
.btn.ghost:hover{background:var(--hover);color:var(--fg)}
.btn.sm{height:28px;padding:0 10px;font-size:12px;border-radius:8px}
.btn.lg{height:42px;padding:0 18px;font-size:14px;border-radius:var(--r)}
.btn:disabled{opacity:.45;cursor:not-allowed;transform:none}

.icon-btn{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;color:var(--text-2);flex:none;
  position:relative;transition:background var(--dur-1),color var(--dur-1),transform var(--dur-1)}
.icon-btn:hover{background:var(--hover);color:var(--fg)}
.icon-btn:active{transform:scale(.92)}
.icon-btn.on{color:var(--accent);background:var(--accent-soft)}
.icon-btn .i{width:19px;height:19px}

/* ── chips, badges ───────────────────────────────────────────────────── */
.filters{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-bottom:12px}
.chip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:var(--r-pill);
  background:var(--surface-2);border:1px solid var(--line);font-size:12.5px;font-weight:600;color:var(--text-2);
  transition:background var(--dur-1),border-color var(--dur-1),color var(--dur-1)}
.chip:hover{color:var(--fg);border-color:var(--line-strong)}
.chip.on{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
.badge{display:inline-flex;align-items:center;gap:5px;height:20px;font-size:10.5px;font-weight:700;letter-spacing:.04em;
  text-transform:uppercase;padding:0 8px;border-radius:var(--r-pill);border:1px solid var(--line-strong);color:var(--muted)}
.badge.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,transparent);background:var(--ok-soft)}
.badge.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 35%,transparent);background:var(--warn-soft)}
.badge.danger{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 35%,transparent);background:var(--danger-soft)}
.badge.accent{color:var(--accent);border-color:var(--accent-line);background:var(--accent-soft)}

/* ── cards and panels ────────────────────────────────────────────────── */
.card,.panel{background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;
  box-shadow:var(--shadow-sm)}
.panel{margin-bottom:18px}
.card{padding:16px 18px}
.panel-sub{font-size:12px;color:var(--muted);font-weight:400}
.panel-body{padding:16px 18px}
.panel-body.flush{padding:0}
.page-title{font-size:22px;font-weight:700;margin:0;letter-spacing:-.02em}
.page-sub{margin:3px 0 0;color:var(--muted);font-size:13px}
.list-row{display:flex;align-items:center;gap:11px;padding:11px 18px;border-top:1px solid var(--line);
  width:100%;text-align:left;transition:background var(--dur-1)}
.list-row:first-child{border-top:0}
.list-row:hover{background:var(--hover)}
.lr-main{flex:1;min-width:0}
.lr-name{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lr-meta{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lr-acts{display:flex;gap:6px;align-items:center;flex:none}
.kv{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:13px}
.kv-k{color:var(--muted)}
.kv-v{font-family:var(--mono);font-size:12.5px;word-break:break-all}

/* ── segmented control ───────────────────────────────────────────────── */
.seg{display:inline-flex;padding:3px;gap:2px;border-radius:11px;background:var(--surface-2);border:1px solid var(--line)}
.seg button{height:28px;padding:0 11px;border-radius:8px;font-size:12.5px;font-weight:600;color:var(--text-2);
  display:inline-flex;align-items:center;gap:6px;transition:background var(--dur-2),color var(--dur-2),box-shadow var(--dur-2)}
.seg button:hover{color:var(--fg)}
.seg button[aria-pressed=true],.seg button.on{background:var(--surface-1);color:var(--fg);box-shadow:var(--shadow-sm),0 0 0 1px var(--line-strong)}
.seg .i{width:15px;height:15px}

/* ── tabs ────────────────────────────────────────────────────────────── */
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px;flex-wrap:wrap}
.tab{padding:9px 13px;font-size:13px;font-weight:600;color:var(--muted);border-bottom:2px solid transparent;
  margin-bottom:-1px;transition:color var(--dur-1),border-color var(--dur-1)}
.tab:hover{color:var(--fg)}
.tab.active{color:var(--fg);border-bottom-color:var(--accent)}

/* ── fields ──────────────────────────────────────────────────────────── */
.field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.field > label{font-size:12px;font-weight:600;color:var(--text-2)}
.field input[type=text],.field input[type=password],.field input[type=number],.field input[type=search],
.field select,.field textarea,.input{background:var(--surface-0);border:1px solid var(--line-strong);border-radius:10px;
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

/* ── empty states ────────────────────────────────────────────────────── */
.empty{padding:28px 16px;text-align:center;color:var(--muted);font-size:13px}

/* ── modal (bottom sheet on phones) ──────────────────────────────────── */
.modal-host{position:fixed;inset:0;z-index:80;display:grid;place-items:center;padding:22px;
  background:rgba(3,5,9,.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:ds-fade var(--dur-2) var(--ease)}
:root[data-theme=light] .modal-host{background:rgba(15,23,42,.28)}
@keyframes ds-fade{from{opacity:0}to{opacity:1}}
@keyframes ds-pop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
@keyframes ds-sheet{from{transform:translateY(100%)}to{transform:none}}
.modal{width:min(560px,96vw);max-height:88vh;display:flex;flex-direction:column;background:var(--surface-1);
  border:1px solid var(--line-strong);border-radius:var(--r-xl);box-shadow:var(--shadow-lg);animation:ds-pop var(--dur-3) var(--ease-out)}
.modal.wide{width:min(780px,96vw)}
.modal-head{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--line)}
.modal-title{font-size:15.5px;font-weight:680;margin:0;letter-spacing:-.01em}
.modal-sub{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.modal-x{margin-left:auto;width:32px;height:32px;border-radius:9px;color:var(--muted);display:grid;place-items:center;flex:none}
.modal-x:hover{background:var(--hover);color:var(--fg)}
.modal-body{padding:18px 20px;overflow:auto}
.modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:9px;padding:14px 20px;border-top:1px solid var(--line)}
.modal-foot .grow{flex:1}
@media (max-width:640px){
  .modal-host{place-items:end stretch;padding:0}
  .modal,.modal.wide{width:100%;max-width:100%;max-height:92vh;border-radius:22px 22px 0 0;border-bottom:0;
    animation:ds-sheet var(--dur-3) var(--ease-out);padding-bottom:var(--safe-b)}
  .modal-head::before{content:"";position:absolute;left:50%;top:7px;width:38px;height:4px;margin-left:-19px;
    border-radius:4px;background:var(--line-strong)}
  .modal-head{position:relative;padding-top:20px}
  .modal-foot{flex-wrap:wrap}
  .modal-foot .btn{flex:1 1 auto}
}

/* ── toasts ──────────────────────────────────────────────────────────── */
.toasts{position:fixed;right:16px;top:calc(var(--topbar) + 14px);z-index:90;display:flex;flex-direction:column;gap:8px;
  width:min(360px,calc(100vw - 24px));pointer-events:none}
.toast{position:relative;overflow:hidden;pointer-events:auto;display:flex;align-items:flex-start;gap:10px;background:var(--glass-strong);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--line-strong);touch-action:pan-y;user-select:none;
  border-radius:14px;padding:11px 8px 12px 12px;font-size:13px;line-height:1.45;box-shadow:var(--shadow-lg);
  animation:ds-toast .42s cubic-bezier(.34,1.4,.64,1);transition:opacity .26s,transform .32s cubic-bezier(.2,.8,.2,1)}
.toast .t-ico{display:grid;place-items:center;width:22px;height:22px;border-radius:7px;flex:none;
  background:var(--accent-soft);color:var(--accent)}
.toast .t-ico .i{width:14px;height:14px;stroke-width:2.2}
.toast.ok .t-ico{background:var(--ok-soft);color:var(--ok)}
.toast.err .t-ico{background:var(--danger-soft);color:var(--danger)}
.toast.warn .t-ico{background:var(--warn-soft);color:var(--warn)}
.toast .t-msg{flex:1;min-width:0;padding-top:1px;word-break:break-word}
.toast .t-act{all:unset;cursor:pointer;flex:none;display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:7px;
  font-size:12px;font-weight:650;color:var(--accent);border:1px solid var(--line);background:var(--surface-2)}
.toast .t-act:hover{border-color:var(--accent-line,var(--accent))}
.toast .t-act svg{width:13px;height:13px}
.toast .t-x{all:unset;cursor:pointer;flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:7px;color:var(--muted)}
.toast .t-x:hover{background:color-mix(in srgb,var(--fg) 8%,transparent);color:var(--fg)}
.toast .t-x .i{width:14px;height:14px}
.toast .t-bar{position:absolute;left:0;right:0;bottom:0;height:2px;transform-origin:left;background:var(--accent);opacity:.55}
.toast.ok .t-bar{background:var(--ok)}.toast.err .t-bar{background:var(--danger)}.toast.warn .t-bar{background:var(--warn)}
.toast.out{opacity:0;transform:translateX(24px) scale(.97)}
.toast.out-fast{opacity:0;transform:translateX(40px);transition-duration:.16s}
@keyframes ds-toast{from{opacity:0;transform:translateX(36px) scale(.94)}to{opacity:1;transform:none}}
@media (max-width:760px){
  .toasts{left:12px;right:12px;width:auto;top:calc(62px + var(--safe-t))}
}
@media (prefers-reduced-motion:reduce){.toast{animation:none}}

/* ── bridge for legacy view rules (app.css) that hard-code dark colors ── */
.f-acts button:hover,.n-acts button:hover{background:var(--hover)}
.gtip,.gcontrols button,.ghud,.glegend{background:var(--glass-strong);border-color:var(--line-strong)}
.note-body pre,.note-editor{background:var(--surface-0)}
.note-body .wikilink{border-bottom-color:var(--accent-line)}
.note-body .wikilink:hover{background:var(--accent-soft)}

/* ── long tables scroll sideways instead of squeezing (readers and card previews) ── */
.note-body table{display:block;width:max-content;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;border-collapse:collapse}
.note-body table th,.note-body table td{min-width:7em;max-width:28em;vertical-align:top}
.note-body img{max-width:100%;height:auto}
/* ── images in rendered notes (server renderer: figure.md-img, img.md-img-i) ── */
.note-body figure.md-img{margin:1.1em 0;display:flex;flex-direction:column;align-items:flex-start;gap:7px;max-width:100%}
.note-body figure.md-img img,.note-body img.md-img-i{max-width:100%;height:auto;border-radius:var(--r-sm,10px);
  border:1px solid var(--line);background:var(--surface-2);cursor:zoom-in;
  transition:border-color var(--dur-2) var(--ease),box-shadow var(--dur-2) var(--ease),transform var(--dur-2) var(--ease)}
.note-body figure.md-img img{display:block;min-height:48px;min-width:48px;box-shadow:var(--shadow-sm)}
.note-body figure.md-img img:hover{border-color:var(--accent-line,var(--line-strong));box-shadow:0 10px 30px -14px rgba(0,0,0,.45)}
.note-body figure.md-img figcaption{font-size:12px;line-height:1.45;color:var(--muted);padding:0 2px;max-width:100%}
.note-body img.md-img-i{display:inline-block;vertical-align:middle;max-height:12em;margin:2px 3px}
.note-body img.md-img-i:hover{border-color:var(--accent-line,var(--line-strong))}
.note-body img.md-img-link{max-height:2.4em;max-width:6em;object-fit:cover;margin-left:6px;border-radius:6px}
.note-body img.md-img-link:hover{transform:scale(1.04)}
/* Two or more images in a row: a gallery grid of even tiles (open one for the full image). */
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
`;

/** Segmented control. Returns the element; `onChange` gets the chosen value. */
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
