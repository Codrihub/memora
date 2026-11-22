// The welcome tour (/welcome), shown once after the first sign-in. "Seen" is stored server-side so it does not return on another device.

import { api, apiPost } from '../api';
import { hooks } from '../hooks';
import { markSvg } from '../brand';
import { BRAND_FONT } from '../brand-font';
import { icon } from '../ui/icons';
import { langPref, setLangPref, t } from '../i18n';
import { langButtonHTML, openLangPicker } from '../ui/lang-picker';
import { useStyles } from '../dom';

const FLAG = '/api/ui/layout/welcome';
/** The address the app was loaded at, before routing rewrites /welcome to /overview. */
const START = location.pathname.replace(/\/+$/, '');

const CSS = `
.wl-tour{position:fixed;inset:0;z-index:75;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);
  --wl-win:var(--surface-2);--wl-bar:var(--surface-3);--wl-stage:var(--surface-1);
  --wl-sh:0 0 0 1px rgba(0,0,0,.18),0 2px 4px rgba(0,0,0,.22),0 12px 24px -8px rgba(0,0,0,.42),0 32px 64px -24px rgba(0,0,0,.6);
  --wl-sh-s:0 1px 2px rgba(0,0,0,.28),0 8px 20px -10px rgba(0,0,0,.5);
  --wl-hi:inset 0 1px 0 rgba(255,255,255,.05);
  opacity:0;transition:opacity .28s var(--ease)}
:root[data-theme=light] .wl-tour{--wl-win:var(--surface-1);--wl-bar:var(--surface-2);--wl-stage:var(--surface-2);
  --wl-sh:0 1px 2px rgba(15,23,42,.05),0 6px 14px -4px rgba(15,23,42,.08),0 24px 48px -16px rgba(15,23,42,.2);
  --wl-sh-s:0 1px 2px rgba(15,23,42,.05),0 6px 16px -8px rgba(15,23,42,.12);
  --wl-hi:inset 0 0 0 transparent}
.wl-tour.on{opacity:1}
.wl-tour :focus-visible{outline:2px solid var(--accent);outline-offset:2px;box-shadow:none}

/* Top bar and footer */
.wl-in{width:100%;max-width:1200px;margin-inline:auto;padding-inline:40px}
.wl-top{flex:none}
.wl-top .wl-in{display:flex;align-items:center;gap:12px;padding-block:20px}
.wl-brand{display:flex;align-items:center;gap:10px;min-width:0}
.wl-brand .wl-mk{width:26px;height:26px;flex:none}
.wl-brand b{font-family:${BRAND_FONT};font-weight:700;font-size:19px;line-height:1;color:var(--fg)}
.wl-top .grow{flex:1}
.wl-skip{height:34px;padding-inline:14px;border-radius:var(--r-pill);font:500 13px var(--font);color:var(--muted);background:none;border:0;cursor:pointer;
  transition:color .15s,background .15s}
.wl-skip:hover,.wl-skip:focus-visible{color:var(--fg);background:var(--hover)}
.wl-foot{flex:none}
.wl-foot .wl-in{display:flex;align-items:center;gap:12px;padding-block:14px max(22px,env(safe-area-inset-bottom))}
.wl-foot .grow{flex:1}
.wl-prog{display:flex;align-items:center;gap:16px;min-width:0}
.wl-segs{display:flex;align-items:center;gap:6px}
.wl-seg{display:flex;align-items:center;width:34px;height:28px;padding:0;border:0;background:none;border-radius:6px;cursor:pointer;transition:width .4s var(--ease-out)}
.wl-seg i{display:block;width:100%;height:4px;border-radius:4px;background:var(--line-strong);transition:background .25s}
.wl-seg:hover i{background:color-mix(in srgb,var(--fg) 32%,transparent)}
.wl-seg.done i{background:color-mix(in srgb,var(--accent) 45%,transparent)}
.wl-seg.on{width:56px}
.wl-seg.on i{background:var(--accent)}
.wl-count{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.wl-foot .btn{height:44px;border-radius:12px;padding-inline:20px;font-size:14px}
.wl-foot .wl-next{min-width:128px;gap:8px}
.wl-next .i{transition:transform .2s var(--ease-out)}
.wl-next:hover .i{transform:translateX(2px)}
[dir=rtl] .wl-next .i,[dir=rtl] .wl-opt .go .i{transform:scaleX(-1)}
[dir=rtl] .wl-next:hover .i{transform:scaleX(-1) translateX(2px)}
.wl-foot .wl-back[hidden]{display:inline-flex;visibility:hidden}

/* Step layout and copy */
.wl-body{flex:1;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;display:flex}
.wl-step{width:100%;max-width:1200px;margin:auto;padding:32px 40px 48px}
.wl-step[hidden]{display:none}
.wl-split{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);align-items:center;gap:clamp(40px,5vw,80px)}
.wl-copy{min-width:0;max-width:500px}
.wl-eye{margin:0 0 14px;font-size:12px;font-weight:600;line-height:1.4;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)}
.wl-tour h1,.wl-tour h2,.wl-tour h3{margin:0;color:var(--fg);text-transform:none;overflow-wrap:break-word;hyphens:auto}
.wl-tour h1,.wl-tour h2{font-size:clamp(30px,1.5vw + 20px,44px);font-weight:650;line-height:1.08;letter-spacing:-.028em}
.wl-tour h3{font-size:24px;font-weight:650;line-height:1.2;letter-spacing:-.02em}
.wl-lead{margin:18px 0 0;max-width:46ch;font-size:16.5px;line-height:1.6;color:var(--text-2)}
.wl-note{margin:22px 0 0;font-size:13.5px;line-height:1.55;color:var(--muted)}
.wl-label{margin:28px 0 0;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3)}
.wl-ben{list-style:none;margin:28px 0 0;padding:0;display:grid;gap:18px}
.wl-label+.wl-ben{margin-top:14px}
.wl-ben li{display:flex;align-items:flex-start;gap:14px;min-width:0}
.wl-ti{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--accent-soft);color:var(--accent);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 22%,transparent)}
.wl-ti .i{width:18px;height:18px}
.wl-ben li>div{min-width:0;padding-top:1px}
.wl-ben b{display:block;font-size:15px;font-weight:600;line-height:1.35;color:var(--fg)}
.wl-ben li>div>span{display:block;margin-top:3px;font-size:14px;line-height:1.55;color:var(--muted)}

/* Setup card on step one */
.wl-setup{margin:30px 0 0;padding:16px;border:1px solid var(--line-strong);border-radius:16px;background:var(--wl-win);box-shadow:var(--wl-sh-s),var(--wl-hi)}
.wl-setup-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.wl-f{display:flex;flex-direction:column;gap:7px;min-width:0;font-size:12.5px;font-weight:600;line-height:1.35;color:var(--text-2)}
.wl-f .lp-btn{width:100%;height:42px}
.wl-f input{height:42px;min-width:0;width:100%;padding-inline:12px;border:1px solid var(--line-strong);border-radius:10px;background:var(--surface-0);color:var(--fg);
  font:inherit;font-size:14px;font-weight:400;transition:border-color .15s,box-shadow .15s}
.wl-f input::placeholder{color:var(--text-3)}
.wl-f input:hover{border-color:color-mix(in srgb,var(--fg) 30%,transparent)}
.wl-tour .wl-f input:focus-visible{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.wl-setup-st{display:flex;align-items:flex-start;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line);font-size:12.5px;line-height:1.5;color:var(--muted)}
.wl-setup-st .i{flex:none;width:15px;height:15px;margin-top:1px}
.wl-setup-st small{min-width:0;font-size:inherit}

/* The stage: a calm tinted surface the product visual sits on */
.wl-stage{position:relative;min-width:0;width:100%;aspect-ratio:6/5;container-type:inline-size;border:1px solid var(--line);border-radius:24px;overflow:hidden;isolation:isolate;
  background:radial-gradient(110% 85% at 88% 0%,color-mix(in srgb,var(--accent) 9%,transparent),transparent 62%),var(--wl-stage)}
.wl-stage::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;
  background-image:radial-gradient(color-mix(in srgb,var(--fg) 13%,transparent) 1px,transparent 1.4px);background-size:18px 18px;
  -webkit-mask-image:radial-gradient(75% 70% at 50% 45%,#000 15%,transparent 78%);mask-image:radial-gradient(75% 70% at 50% 45%,#000 15%,transparent 78%)}
.wl-scene{position:absolute;inset:0;font-size:clamp(8px,2.2cqw,13px);line-height:1.45;color:var(--text-2);user-select:none;pointer-events:none}
.wl-scene .i{width:1.15em;height:1.15em}
.wl-ly{position:absolute}
.wl-win,.wl-card{display:flex;flex-direction:column;overflow:hidden;background:var(--wl-win);border:1px solid var(--line-strong);box-shadow:var(--wl-sh),var(--wl-hi)}
.wl-win{border-radius:1.2em}
.wl-card{border-radius:1.1em}
.wl-bar{flex:none;display:flex;align-items:center;gap:.8em;height:2.7em;padding-inline:1em;border-bottom:1px solid var(--line);background:var(--wl-bar);color:var(--muted);font-size:.92em}
.wl-dots{flex:none;display:flex;gap:.42em}
.wl-dots i{width:.72em;height:.72em;border-radius:50%;background:color-mix(in srgb,var(--fg) 17%,transparent)}
.wl-bar .tt{flex:1;min-width:0;display:flex;align-items:center;justify-content:center;gap:.45em;margin-inline-end:2.6em;font-weight:500;color:var(--text-2)}
.wl-ell,.wl-bar .tt span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-mono{font-family:var(--mono)}
.wl-av{flex:none;display:inline-grid;place-items:center;width:1.95em;height:1.95em;border-radius:.6em;background:color-mix(in srgb,var(--fg) 8%,transparent);color:var(--text-2)}
.wl-scene .wl-av .i{width:1.05em;height:1.05em}
.wl-av.ac{background:var(--accent-soft);color:var(--accent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 25%,transparent)}
.wl-ln{display:block;height:.55em;margin-top:.8em;border-radius:.3em;background:color-mix(in srgb,var(--fg) 8%,transparent)}
.wl-ln.m{width:84%}
.wl-ln.s{width:56%}
.wl-ln.il{display:inline-block;width:9em;margin:0;vertical-align:middle}
.wl-ln.il.s{width:6em}
.wl-wl{color:var(--accent);background:var(--accent-soft);border-radius:.3em;padding:.05em .3em;font-weight:500;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.wl-live{flex:none;width:.6em;height:.6em;border-radius:50%;background:var(--ok);animation:wl-pulse 2.4s var(--ease) infinite}
.wl-caret{display:inline-block;width:2px;height:1.15em;margin-inline-start:2px;vertical-align:-.2em;border-radius:1px;background:var(--accent);animation:wl-blink 1.1s steps(1) infinite}
.wl-wf{flex:none;padding:.7em 1em;border-top:1px solid var(--line);font-size:.86em;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-ch{flex:none;display:flex;align-items:center;gap:.6em;padding:.8em 1em;border-bottom:1px solid var(--line);font-weight:600;color:var(--fg)}
.wl-ch .i{color:var(--muted)}
.wl-list{list-style:none;margin:0;padding:.25em 0;flex:1;min-height:0;overflow:hidden}
.wl-list li{display:flex;align-items:center;gap:.75em;min-width:0;padding:.62em 1em;border-top:1px solid var(--line)}
.wl-list li:first-child{border-top:0}
.wl-list .nm{flex:1;min-width:0;font-weight:550;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-list .k{flex:none;font-size:.86em;color:var(--muted)}
.wl-list .pm{flex:none;padding:.18em .6em;border:1px solid var(--line-strong);border-radius:999px;font-size:.8em;color:var(--muted);white-space:nowrap}
.wl-list .pm.w{border-color:var(--accent-line);color:var(--accent)}
.wl-list li.on{background:color-mix(in srgb,var(--accent) 6%,transparent)}
.wl-list .ev{flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.wl-list .ev b,.wl-list .ev em{font-style:normal;font-weight:550;color:var(--fg)}
.wl-list .tm{flex:none;font-size:.82em;color:var(--text-3)}
.wl-list .undo{flex:none;font-size:.84em;font-weight:600;color:var(--accent)}

/* Step 1: the notes app */
.s1 .a{top:9%;inset-inline-start:5%;width:82%;height:70%}
.s1 .b{top:56%;inset-inline-start:47%;width:49%}
.s1 .c{top:74%;inset-inline-start:9%;max-width:46%}
.wl-app{flex:1;min-height:0;display:grid;grid-template-columns:31% minmax(0,1fr)}
.wl-tree{list-style:none;margin:0;padding:.8em .55em;min-width:0;overflow:hidden}
.wl-app .wl-tree{border-inline-end:1px solid var(--line);background:color-mix(in srgb,var(--fg) 2%,transparent)}
.wl-tree li{display:flex;align-items:center;gap:.5em;min-width:0;padding:.36em .6em;border-radius:.5em;white-space:nowrap}
.wl-tree li span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.wl-tree li .i{color:var(--muted)}
.wl-tree li.hd{padding-block:.1em .55em;font-size:.76em;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--text-3)}
.wl-tree li.l1{padding-inline-start:1.75em}
.wl-tree li.l2{padding-inline-start:2.9em}
.wl-tree li.on{background:var(--accent-soft);color:var(--fg)}
.wl-tree li.on .i{color:var(--accent)}
.wl-doc{min-width:0;padding:1.5em 1.7em;overflow:hidden}
.wl-doc .path{display:block;font-size:.8em;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-doc b{display:block;margin:.35em 0 .75em;font-size:1.6em;font-weight:650;line-height:1.2;letter-spacing:-.015em;color:var(--fg);overflow-wrap:anywhere}
.wl-doc p{margin:0 0 .4em;line-height:1.65}
.wl-peek{padding:1em 1.1em}
.wl-peek-h{display:flex;align-items:center;gap:.5em;min-width:0;color:var(--fg)}
.wl-peek-h .i{color:var(--accent)}
.wl-peek-h b{min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-peek .path{display:block;margin-top:.25em;font-size:.8em;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-peek-f{display:flex;align-items:center;gap:.45em;margin-top:.9em;padding-top:.7em;border-top:1px solid var(--line);font-size:.84em;color:var(--muted);min-width:0}
.wl-peek-f span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-chip{display:inline-flex;align-items:center;gap:.6em;padding-block:.42em;padding-inline:.42em 1em;border:1px solid var(--line-strong);border-radius:999px;
  background:var(--wl-win);box-shadow:var(--wl-sh),var(--wl-hi);font-size:.92em;color:var(--fg);white-space:nowrap}
.wl-chip>.wl-ell{flex:0 1 auto}

/* Step 2: keys */
.s2 .a{top:7%;inset-inline-start:4%;width:74%;height:62%}
.s2 .b{top:45%;inset-inline-end:4%;width:50%}
.wl-key{padding:1.1em 1.15em}
.wl-key-h{display:flex;align-items:center;gap:.7em;padding-bottom:.9em;border-bottom:1px solid var(--line)}
.wl-key-h>div{flex:1;min-width:0}
.wl-key-h b{display:block;font-weight:600;color:var(--fg)}
.wl-key-h .wl-mono{display:block;margin-top:.1em;font-size:.84em;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-key-h>.i{color:var(--muted)}
.wl-perm{display:flex;align-items:center;justify-content:space-between;gap:1em;padding:.72em 0;border-bottom:1px solid var(--line);color:var(--fg)}
.wl-perm span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-key-f{display:flex;align-items:center;gap:.5em;padding-top:.8em;font-size:.85em;color:var(--muted)}
.wl-tg{position:relative;flex:none;width:2.45em;height:1.4em;border-radius:1em;background:color-mix(in srgb,var(--fg) 18%,transparent)}
.wl-tg::after{content:"";position:absolute;top:.2em;inset-inline-start:.2em;width:1em;height:1em;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.28)}
.wl-tg.on{background:var(--accent)}
.wl-tg.on::after{inset-inline-start:1.25em}

/* Step 3: files on disk */
.s3 .a{top:6%;inset-inline-start:4%;width:52%;height:72%}
.s3 .b{top:21%;inset-inline-end:4%;width:60%;height:56%}
.s3 .c{top:76%;inset-inline-start:9%;max-width:58%}
.s3 .wl-tree{flex:1;font-size:.92em}
.wl-code{list-style:none;margin:0;padding:.9em 1em;flex:1;min-height:0;overflow:hidden;counter-reset:ln;font-size:.9em;line-height:1.75}
.wl-code li{counter-increment:ln;display:flex;gap:1em;min-height:1.75em}
.wl-code li::before{content:counter(ln);flex:none;width:1.4em;text-align:end;color:var(--text-3)}
.wl-code li>span{min-width:0}
.wl-code .h{font-weight:600;color:var(--fg)}
.wl-code .mk{color:var(--accent)}
.wl-srv{display:flex;flex-direction:row;align-items:center;gap:.75em;padding:.8em 1em}
.wl-srv>div{min-width:0}
.wl-srv b{display:block;font-weight:600;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-srv>div>span{display:block;font-size:.85em;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Step 4: Activity and History */
.s4 .a{top:7%;inset-inline-start:4%;width:76%;height:70%}
.s4 .b{top:53%;inset-inline-end:4%;width:46%}
.wl-act li{align-items:flex-start}
.wl-act .tm,.wl-act .undo{margin-top:.25em}
.wl-act li.new{background:color-mix(in srgb,var(--accent) 7%,transparent)}
.wl-hist{list-style:none;margin:0;padding:.35em 0 .5em}
.wl-hist li{display:flex;align-items:center;gap:.7em;min-width:0;padding:.5em 1em}
.wl-hist li .dt{flex:none;width:.55em;height:.55em;border-radius:50%;border:2px solid var(--line-strong)}
.wl-hist li.on{background:color-mix(in srgb,var(--fg) 4%,transparent)}
.wl-hist li.on .dt{border-color:var(--accent);background:var(--accent)}
.wl-hist .tm{flex:none;font-size:.86em;color:var(--muted)}
.wl-hist .nm{flex:1;min-width:0;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-hist .rs{flex:none;padding:.28em .75em;border-radius:.55em;background:var(--accent);color:var(--on-accent);font-size:.8em;font-weight:600;white-space:nowrap}

/* Step 5: agents use the notes, Mnemo looks after them */
.s5 .a{top:7%;inset-inline-start:4%;width:50%}
.s5 .b{top:23%;inset-inline-end:4%;width:62%;height:71%}
.wl-chat{flex:1;min-height:0;display:flex;flex-direction:column;gap:.8em;padding:1em;overflow:hidden}
.wl-me{align-self:flex-end;max-width:82%;padding:.6em .9em;border-radius:1em;border-end-end-radius:.3em;background:var(--accent);color:var(--on-accent);font-weight:500}
.wl-bot{align-self:flex-start;max-width:94%;min-width:0;padding:.85em .95em;border:1px solid var(--line);border-radius:1em;border-end-start-radius:.3em;background:color-mix(in srgb,var(--fg) 3%,transparent)}
.wl-bot-h{display:flex;align-items:center;gap:.55em;margin-bottom:.5em;font-weight:600;color:var(--fg)}
.wl-scene .wl-bot-h .wl-av{width:1.7em;height:1.7em}
.wl-check{list-style:none;margin:.55em 0 0;padding:0;display:grid;gap:.4em}
.wl-check li{display:flex;align-items:center;gap:.55em;min-width:0;color:var(--fg)}
.wl-check li>span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-check .ck{flex:none;display:grid;place-items:center;width:1.3em;height:1.3em;border-radius:50%;background:var(--accent-soft);color:var(--accent)}
.wl-scene .wl-check .ck .i{width:.85em;height:.85em;stroke-width:2.6}
.wl-chg{display:flex;align-items:center;justify-content:space-between;gap:1em;margin-top:.8em;padding-top:.65em;border-top:1px solid var(--line);font-size:.85em;color:var(--muted)}
.wl-chg span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-chg b{flex:none;font-weight:600;color:var(--accent)}

/* Start choices on the last step */
.wl-start{margin-top:64px}
.wl-start-h{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 16px}
.wl-opts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:20px}
.wl-opt{display:flex;align-items:center;gap:16px;min-width:0;padding:18px;border:1px solid var(--line-strong);border-radius:16px;background:var(--wl-win);
  box-shadow:var(--wl-sh-s),var(--wl-hi);color:inherit;font:inherit;text-align:start;cursor:pointer;
  transition:transform .22s var(--ease-out),box-shadow .22s var(--ease-out),border-color .2s}
.wl-opt:hover{transform:translateY(-2px);box-shadow:var(--wl-sh),var(--wl-hi);border-color:color-mix(in srgb,var(--accent) 35%,var(--line-strong))}
.wl-opt:active{transform:translateY(0)}
.wl-opt.sug{border-color:var(--accent-line);background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 7%,var(--wl-win)),var(--wl-win) 70%)}
.wl-opt .ti{flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:color-mix(in srgb,var(--fg) 6%,transparent);color:var(--fg);
  box-shadow:inset 0 0 0 1px var(--line)}
.wl-opt.sug .ti{background:var(--accent);color:var(--on-accent);box-shadow:none}
.wl-opt .ti .i{width:20px;height:20px}
.wl-opt .tx{flex:1;min-width:0}
.wl-opt .tt{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px}
.wl-opt b{font-size:15.5px;font-weight:600;line-height:1.35;color:var(--fg)}
.wl-opt em{padding:2px 8px;border-radius:999px;background:var(--accent-soft);font-style:normal;font-size:11.5px;font-weight:600;line-height:1.5;color:var(--accent)}
.wl-opt .ds{display:block;margin-top:3px;font-size:13.5px;line-height:1.5;color:var(--muted)}
.wl-opt .go{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;color:var(--muted);transition:background .2s,color .2s}
.wl-opt .go .i{width:16px;height:16px}
.wl-opt:hover .go,.wl-opt:focus-visible .go{background:var(--accent-soft);color:var(--accent)}

/* Motion: copy rises, the visual's layers settle with a short stagger */
@keyframes wl-up{from{opacity:0;transform:translateY(8px)}}
@keyframes wl-settle{from{opacity:0;transform:translateY(16px) scale(.975)}}
@keyframes wl-fade{from{opacity:0}}
@keyframes wl-blink{50%{opacity:0}}
@keyframes wl-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ok) 55%,transparent)}70%,100%{box-shadow:0 0 0 .5em transparent}}
@keyframes wl-row{from{opacity:0;transform:translateY(-.6em)}}
@keyframes wl-tg-bg{from{background:color-mix(in srgb,var(--fg) 18%,transparent)}}
@keyframes wl-tg-k{from{inset-inline-start:.2em}}
.wl-step.in .wl-copy>*{animation:wl-up .55s var(--ease-out) both}
.wl-step.in .wl-copy>:nth-child(2){animation-delay:.05s}
.wl-step.in .wl-copy>:nth-child(3){animation-delay:.1s}
.wl-step.in .wl-copy>:nth-child(4){animation-delay:.15s}
.wl-step.in .wl-copy>:nth-child(n+5){animation-delay:.2s}
.wl-step.in .wl-stage{animation:wl-fade .5s var(--ease) both}
.wl-step.in .wl-ly{animation:wl-settle .75s var(--ease-out) both}
.wl-step.in .wl-ly.a{animation-delay:.1s}
.wl-step.in .wl-ly.b{animation-delay:.24s}
.wl-step.in .wl-ly.c{animation-delay:.38s}
.wl-step.in .wl-act li.new{animation:wl-row .5s var(--ease-out) 1.1s both}
.wl-step.in .wl-tg.flip{animation:wl-tg-bg .3s var(--ease) 1.1s both}
.wl-step.in .wl-tg.flip::after{animation:wl-tg-k .3s var(--ease-out) 1.1s both}
.wl-step.in .wl-check li{animation:wl-up .4s var(--ease-out) both}
.wl-step.in .wl-check li:nth-child(1){animation-delay:.9s}
.wl-step.in .wl-check li:nth-child(2){animation-delay:1.1s}
.wl-step.in .wl-check li:nth-child(3){animation-delay:1.3s}
.wl-step.in .wl-check li:nth-child(4){animation-delay:1.5s}
.wl-step.in .wl-chg{animation:wl-fade .4s var(--ease) 1.75s both}
.wl-step.in .wl-start{animation:wl-up .55s var(--ease-out) .3s both}

/* Tablet: stack, visual on top */
@media (max-width:900px){
  .wl-in{padding-inline:32px}
  .wl-step{padding:24px 32px 40px}
  .wl-split{grid-template-columns:minmax(0,1fr);gap:32px}
  .wl-stage{order:-1;max-width:620px}
  .wl-copy{max-width:640px}
}
/* Phone: 16px gutter, simpler visual, footer pinned at the bottom */
@media (max-width:640px){
  .wl-in{padding-inline:16px}
  .wl-top .wl-in{padding-block:14px}
  .wl-step{padding:16px 16px 32px}
  .wl-split{gap:24px}
  .wl-stage{border-radius:18px}
  .wl-scene{font-size:clamp(8px,2.5cqw,11px)}
  .wl-scene .opt{display:none}
  .wl-app{grid-template-columns:minmax(0,1fr)}
  .wl-app .wl-tree{display:none}
  .s1 .a{width:90%;height:76%}
  .s1 .b{top:60%;inset-inline-start:38%;width:58%}
  .wl-tour h1,.wl-tour h2{font-size:28px;line-height:1.12}
  .wl-tour h3{font-size:21px}
  .wl-eye{margin-bottom:10px}
  .wl-lead{font-size:15.5px}
  .wl-ben{margin-top:22px;gap:14px}
  .wl-setup{margin-top:22px;padding:14px}
  .wl-setup-g{grid-template-columns:minmax(0,1fr)}
  .wl-f input{font-size:16px}
  .wl-start{margin-top:44px}
  .wl-opts{grid-template-columns:minmax(0,1fr);gap:10px}
  .wl-opt{padding:14px;gap:14px}
  .wl-opt .ti{width:40px;height:40px}
  .wl-foot{border-top:1px solid var(--line);background:var(--bg)}
  .wl-foot .wl-in{flex-wrap:wrap;gap:10px;padding-block:10px max(12px,env(safe-area-inset-bottom))}
  .wl-prog{flex:1 0 100%;justify-content:space-between;gap:12px}
  .wl-segs{flex:1;gap:5px}
  .wl-seg{flex:1;width:auto;height:20px}
  .wl-seg.on{flex:1.8;width:auto}
  .wl-foot .grow{display:none}
  .wl-foot .wl-back[hidden]{display:none}
  .wl-foot .btn{height:46px}
  .wl-foot .wl-next{flex:1;min-width:0}
}
@media (prefers-reduced-motion:reduce){
  .wl-tour,.wl-tour *,.wl-tour *::before,.wl-tour *::after{animation:none !important;transition:none !important}
  .wl-opt:hover{transform:none}
}
`;

/** The step names, in order; read when the tour opens so the chosen language applies. */
function trackNames(): string[] {
  return [t('Welcome'), t('Why Memora'), t('Your server'), t("What's inside"), t('Get started')];
}

/** Notes as points, nearby ones linked; seeded, so it draws the same every time. */
export function constellation(w: number, h: number, n: number, seed: number, cls: string): string {
  let x0 = seed;
  const rnd = (): number => ((x0 = (x0 * 16807) % 2147483647) - 1) / 2147483646;
  const pts = Array.from({ length: n }, () => [Math.round(rnd() * w), Math.round(rnd() * h)] as const);
  const reach = Math.max(w, h) / 6.5;
  const lines: string[] = [];
  pts.forEach(([x, y], i) => {
    for (let j = i + 1; j < pts.length; j++) {
      const [u, v] = pts[j];
      if (Math.hypot(x - u, y - v) < reach) lines.push(`<line x1="${x}" y1="${y}" x2="${u}" y2="${v}"/>`);
    }
  });
  const dots = pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 5 === 0 ? 3 : 1.7}"/>`).join('');
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g>${lines.join('')}</g><g>${dots}</g></svg>`;
}

/* ---------- Pieces of the product visuals ---------- */

/** A window title bar: three dots and a centred title. */
const bar = (title: string, ico = '', mono = false): string =>
  `<div class="wl-bar"><span class="wl-dots"><i></i><i></i><i></i></span><span class="tt${mono ? ' wl-mono' : ''}">${ico ? icon(ico) : ''}<span>${title}</span></span></div>`;
/** A small square avatar holding an icon (no initials). */
const av = (ico: string, accent = false): string => `<span class="wl-av${accent ? ' ac' : ''}">${icon(ico)}</span>`;
/** The tinted stage the layers sit on; decorative, so hidden from screen readers. */
const stage = (scene: string, layers: string): string =>
  `<div class="wl-stage" aria-hidden="true"><div class="wl-scene ${scene}">${layers}</div></div>`;
const wikilink = (name: string): string => `<span class="wl-wl">[[${name}]]</span>`;
const who = (name: string): string => `<b>${name}</b>`;
const note = (name: string): string => `<em>${name}</em>`;

/** Step 1: the notes app, an open note with a [[link]] and its preview card. */
function notesScene(): string {
  const f = (cls: string, ico: string, name: string): string => `<li class="${cls}">${icon(ico)}<span>${name}</span></li>`;
  return stage(
    's1',
    `<div class="wl-win wl-ly a">
      ${bar(t('Launch plan'))}
      <div class="wl-app">
        <ul class="wl-tree">
          <li class="hd"><span>${t('Notes')}</span></li>
          ${f('', 'folder', t('Inbox'))}
          ${f('', 'folder', t('Projects'))}
          ${f('l1 on', 'note', t('Launch plan'))}
          ${f('l1', 'note', t('Feedback log'))}
          ${f('', 'folder', t('Reading'))}
          ${f('l1', 'note', t('Book notes'))}
        </ul>
        <div class="wl-doc">
          <span class="path wl-mono">${t('Projects')} / ${t('Launch plan')}.md</span>
          <b>${t('Launch plan')}</b>
          <p>${t('Send the beta to ten testers and collect their replies in {link}.', { link: wikilink(t('Feedback log')) })}<i class="wl-caret"></i></p>
          <i class="wl-ln"></i><i class="wl-ln m"></i><i class="wl-ln s"></i>
        </div>
      </div>
    </div>
    <div class="wl-card wl-peek wl-ly b">
      <div class="wl-peek-h">${icon('note')}<b>${t('Feedback log')}</b></div>
      <span class="path wl-mono">${t('Projects')}/${t('Feedback log')}.md</span>
      <i class="wl-ln m"></i><i class="wl-ln s"></i>
      <div class="wl-peek-f">${icon('arrow-down')}<span>${t('Linked from {note}', { note: t('Launch plan') })}</span></div>
    </div>
    <div class="wl-chip wl-ly c opt">${av('agents', true)}<span class="wl-ell">${t('Edited by {who} at {time}', { who: 'Claude', time: '10:42' })}</span><i class="wl-live"></i></div>`,
  );
}

/** Step 2: the apps that hold a key, and one key opened with its permissions. */
function keysScene(): string {
  const app = (ico: string, name: string, tail: string, perm: string, write: boolean, on = false): string =>
    `<li${on ? ' class="on"' : ''}>${av(ico, on)}<span class="nm">${name}</span><span class="k wl-mono">••••${tail}</span><span class="pm${write ? ' w' : ''}">${perm}</span></li>`;
  return stage(
    's2',
    `<div class="wl-win wl-ly a">
      ${bar(t('Connected apps'), 'key')}
      <ul class="wl-list">
        ${app('agents', 'Claude', '3f2a', t('Read and write'), true, true)}
        ${app('code', 'Cursor', '9c1e', t('Read and write'), true)}
        ${app('chat', 'ChatGPT', '41d7', t('Read only'), false)}
        ${app('tools', t('Your own script'), 'b08c', t('Read only'), false)}
      </ul>
      <div class="wl-wf">${t('All four read the same notes.')}</div>
    </div>
    <div class="wl-card wl-key wl-ly b">
      <div class="wl-key-h">${av('key', true)}<div><b>Claude</b><span class="wl-mono">mem_••••••••3f2a</span></div>${icon('copy')}</div>
      <div class="wl-perm"><span>${t('Read notes')}</span><i class="wl-tg on"></i></div>
      <div class="wl-perm"><span>${t('Write notes')}</span><i class="wl-tg on flip"></i></div>
      <div class="wl-key-f"><i class="wl-live"></i><span class="wl-ell">${t('Used just now')}</span></div>
    </div>`,
  );
}

/** Step 3: the notes folder on disk, one file open as plain Markdown, and the server it runs on. */
function filesScene(): string {
  const f = (cls: string, ico: string, name: string): string => `<li class="${cls}">${icon(ico)}<span>${name}</span></li>`;
  return stage(
    's3',
    `<div class="wl-win wl-ly a">
      ${bar(t('Your notes folder'), 'folder')}
      <ul class="wl-tree wl-mono">
        ${f('', 'folder', `${t('My notes')}/`)}
        ${f('l1', 'note', `${t('Inbox')}.md`)}
        ${f('l1', 'folder', `${t('Projects')}/`)}
        ${f('l2 on', 'note', `${t('Launch plan')}.md`)}
        ${f('l2', 'note', `${t('Feedback log')}.md`)}
        ${f('l1', 'folder', `${t('Reading')}/`)}
        ${f('l2', 'note', `${t('Book notes')}.md`)}
      </ul>
      <div class="wl-wf">${t('Plain files. Open them in any editor.')}</div>
    </div>
    <div class="wl-win wl-ly b">
      ${bar(`${t('Launch plan')}.md`, '', true)}
      <ol class="wl-code wl-mono">
        <li><span class="h"># ${t('Launch plan')}</span></li>
        <li></li>
        <li><span>${t('Send the beta to ten testers and collect their replies in {link}.', { link: wikilink(t('Feedback log')) })}</span></li>
        <li></li>
        <li><span><span class="mk">- [x]</span> <i class="wl-ln il"></i></span></li>
        <li><span><span class="mk">- [ ]</span> <i class="wl-ln il s"></i></span></li>
      </ol>
    </div>
    <div class="wl-card wl-srv wl-ly c opt">${av('monitor', true)}<div><b>${t('Your server')}</b><span>${t('Running on this computer')}</span></div><i class="wl-live"></i></div>`,
  );
}

/** Step 4: Activity with an undo on every line, and History with an older version. */
function activityScene(): string {
  const ev = (ico: string, accent: boolean, time: string, text: string, cls = ''): string =>
    `<li${cls ? ` class="${cls}"` : ''}>${av(ico, accent)}<span class="ev">${text}</span><span class="tm wl-mono">${time}</span><span class="undo">${t('Undo')}</span></li>`;
  const ver = (time: string, name: string, on = false): string =>
    `<li${on ? ' class="on"' : ''}><i class="dt"></i><span class="tm wl-mono">${time}</span><span class="nm">${name}</span>${on ? `<span class="rs">${t('Restore')}</span>` : ''}</li>`;
  return stage(
    's4',
    `<div class="wl-win wl-ly a">
      ${bar(t('Activity'), 'activity')}
      <ul class="wl-list wl-act">
        ${ev('mnemo', true, '10:44', t('{who} linked {a} to {b}', { who: who('Mnemo'), a: note(t('Feedback log')), b: note(t('Launch plan')) }), 'new')}
        ${ev('agents', false, '10:42', t('{who} edited {note}', { who: who('Claude'), note: note(t('Launch plan')) }))}
        ${ev('code', false, '10:31', t('{who} created {note}', { who: who('Cursor'), note: note(t('Release checklist')) }))}
        ${ev('user', false, '09:58', t('{who} moved {note} to {folder}', { who: who(t('You')), note: note(t('Book notes')), folder: note(t('Reading')) }))}
      </ul>
      <div class="wl-wf">${t('Older changes stay in History.')}</div>
    </div>
    <div class="wl-card wl-ly b">
      <div class="wl-ch">${icon('refresh')}<span class="wl-ell">${t('History')}</span></div>
      <ul class="wl-hist">
        ${ver('10:42', 'Claude')}
        ${ver('10:31', 'Cursor', true)}
        ${ver('09:58', t('You'))}
      </ul>
    </div>`,
  );
}

/** Step 5: your agents use the notes on one side; Mnemo tidies them on the other. */
function mnemoScene(): string {
  const use = (ico: string, text: string): string => `<li>${av(ico)}<span class="ev">${text}</span></li>`;
  const done = (text: string): string => `<li><span class="ck">${icon('check')}</span><span>${text}</span></li>`;
  return stage(
    's5',
    `<div class="wl-card wl-ly a">
      <div class="wl-ch">${icon('agents')}<span class="wl-ell">${t('Your agents')}</span></div>
      <ul class="wl-list">
        ${use('agents', t('{who} read {note}', { who: who('Claude'), note: note(t('Launch plan')) }))}
        ${use('code', t('{who} created {note}', { who: who('Cursor'), note: note(t('Release checklist')) }))}
        ${use('chat', t('{who} searched your notes', { who: who('ChatGPT') }))}
      </ul>
    </div>
    <div class="wl-win wl-ly b">
      ${bar('Mnemo', 'mnemo')}
      <div class="wl-chat">
        <div class="wl-me">${t('Tidy up my notes from this week.')}</div>
        <div class="wl-bot">
          <div class="wl-bot-h">${av('mnemo', true)}<span>Mnemo</span></div>
          ${t('Done. Here is what I changed:')}
          <ul class="wl-check">
            ${done(t('Linked 4 notes'))}
            ${done(t('Fixed 2 broken links'))}
            ${done(t('Merged a duplicate'))}
            ${done(t('Flagged an outdated note'))}
          </ul>
          <div class="wl-chg"><span>${t('Shown in Activity')}</span><b>${t('Undo')}</b></div>
        </div>
      </div>
    </div>`,
  );
}

/* ---------- Copy ---------- */

/** One benefit row: an icon tile, a bold title and a sentence. */
const row = (ico: string, title: string, text: string): string =>
  `<li><span class="wl-ti">${icon(ico)}</span><div><b>${title}</b><span>${text}</span></div></li>`;

const option = (act: string, ico: string, title: string, text: string, suggested = false): string =>
  `<button type="button" class="wl-opt${suggested ? ' sug' : ''}" data-wl="${act}"><span class="ti">${icon(ico)}</span>
    <span class="tx"><span class="tt"><b>${title}</b>${suggested ? `<em>${t('Suggested')}</em>` : ''}</span><span class="ds">${text}</span></span>
    <span class="go">${icon('arrow')}</span></button>`;

function stepsHTML(names: string[]): string[] {
  const eye = (i: number): string => `<p class="wl-eye">${names[i]}</p>`;
  return [
    `<div class="wl-split"><div class="wl-copy">
      ${eye(0)}
      <h1>${t('Your notes, shared with your AI apps')}</h1>
      <p class="wl-lead">${t('Memora is a notes app your AI apps can use too. You write in it, they read and write the same notes, and you can always see what changed.')}</p>
      <div class="wl-setup" role="group" aria-label="${t('Set up')}">
        <div class="wl-setup-g">
          <div class="wl-f"><span id="wlLangL">${t('Select your language')}</span><button type="button" class="lp-btn" id="wlLang" aria-haspopup="dialog" aria-labelledby="wlLangL wlLang">${langButtonHTML()}</button></div>
          <label class="wl-f"><span>${t('Name your server')}</span><input id="wlName" type="text" maxlength="64" spellcheck="false" autocomplete="off" placeholder="${t('e.g. Home notes')}"></label>
        </div>
        <div class="wl-setup-st">${icon('info')}<small role="status" aria-live="polite">${t('Both can be changed later in Settings.')}</small></div>
      </div>
      <p class="wl-note">${t('Five short steps. You can skip at any time.')}</p>
    </div>${notesScene()}</div>`,
    `<div class="wl-split"><div class="wl-copy">
      ${eye(1)}
      <h2>${t('One set of notes for every AI app')}</h2>
      <p class="wl-lead">${t('Most AI apps start each chat from nothing, and each keeps its own memory. With Memora, Claude, Cursor and any other app that speaks MCP read and write the same notes, so what one app learns, the others can use.')}</p>
      <ul class="wl-ben">
        ${row('key', t('Each app gets its own key'), t('Turn one off without touching the others.'))}
        ${row('shield', t('You decide what it can do'), t('Give a key read-only access, or let it write too.'))}
      </ul>
    </div>${keysScene()}</div>`,
    `<div class="wl-split"><div class="wl-copy">
      ${eye(2)}
      <h2>${t('Your notes live in a folder you choose')}</h2>
      <p class="wl-lead">${t('Memora saves every note as a plain Markdown file on the machine it runs on. Nothing is locked in: open the files in any editor, back them up, or keep them in Git.')}</p>
      <p class="wl-label">${t('Reach it from')}</p>
      <ul class="wl-ben">
        ${row('monitor', t('This computer'), t('Your laptop or desktop, at localhost.'))}
        ${row('wifi', t('Local network'), t('A home server or a VPS on your local network.'))}
        ${row('shield', t('The internet'), t('Through a tunnel or a reverse proxy, from anywhere.'))}
      </ul>
    </div>${filesScene()}</div>`,
    `<div class="wl-split"><div class="wl-copy">
      ${eye(3)}
      <h2>${t('The parts you will use most')}</h2>
      <ul class="wl-ben">
        ${row('note', t('Notes'), t('Write in Markdown and link notes with [[wikilinks]]. Graph and Brain show how they connect.'))}
        ${row('key', t('Keys'), t('Each AI app connects over MCP with its own key and permissions.'))}
        ${row('activity', t('Activity and History'), t('Every change, by you or an app, shows in Activity and can be undone from History.'))}
        ${row('mnemo', 'Mnemo', t('The agent built into Memora that looks after your notes. You will meet it next.'))}
      </ul>
    </div>${activityScene()}</div>`,
    `<div class="wl-split"><div class="wl-copy">
      ${eye(4)}
      <h2>${t('Your agents use the notes. Mnemo looks after them.')}</h2>
      <p class="wl-lead">${t('Mnemo is the agent built into Memora. Connect your own AI key and ask in plain words: it keeps your notes in order while your other apps use them.')}</p>
      <ul class="wl-ben">
        ${row('agents', t('Your agents'), t('Claude, Cursor, ChatGPT and your own scripts read your notes and add to them.'))}
        ${row('mnemo', 'Mnemo', t('Links and tags notes, fixes broken links, flags outdated notes and merges duplicates.'))}
      </ul>
      <p class="wl-note">${t('Every change Mnemo makes shows in Activity and can be undone from History.')}</p>
    </div>${mnemoScene()}</div>
    <div class="wl-start">
      <div class="wl-start-h"><h3>${t('Where would you like to start?')}</h3></div>
      <div class="wl-opts">
        ${option('keys', 'key', t('Connect an AI app'), t('Create a key for Claude, Cursor or any other MCP app.'), true)}
        ${option('mnemo', 'mnemo', t('Try Mnemo'), t('Add your AI key and ask it to tidy your notes.'))}
        ${option('new', 'plus', t('Write your first note'), t('A note in Markdown. Link notes with [[wikilinks]].'))}
        ${option('brain', 'brain', t('Open the brain'), t('See your notes and the links between them.'))}
      </div>
      <p class="wl-note">${t('Open this again any time from the profile menu: Welcome to Memora.')}</p>
    </div>`,
  ];
}

function pageHTML(steps: string[], names: string[]): string {
  const total = steps.length;
  const segs = names
    .map(
      (n, i) =>
        `<button type="button" class="wl-seg${i === 0 ? ' on' : ''}" data-go="${i}" aria-label="${t('Step {n} of {total}: {name}', { n: i + 1, total, name: n })}"${i === 0 ? ' aria-current="step"' : ''}><i></i></button>`,
    )
    .join('');
  return `<div class="wl-top"><div class="wl-in"><div class="wl-brand">${markSvg('wl-mk')}<b>Memora</b></div><span class="grow"></span>
      <button type="button" class="wl-skip" data-wl="close">${t('Skip')}</button></div></div>
    <div class="wl-body">${steps.map((h, i) => `<section class="wl-step${i ? '' : ' in'}" data-step="${i}" aria-label="${names[i]}"${i ? ' hidden' : ''}>${h}</section>`).join('')}</div>
    <div class="wl-foot"><div class="wl-in">
      <div class="wl-prog"><div class="wl-segs" role="group" aria-label="${t('Steps')}">${segs}</div>
        <span class="wl-count" aria-hidden="true">${t('{n} of {total}', { n: 1, total })}</span></div>
      <span class="grow"></span>
      <button type="button" class="btn ghost wl-back" hidden>${t('Back')}</button>
      <button type="button" class="btn primary wl-next">${t('Next')} ${icon('arrow')}</button>
    </div></div>
    <p class="sr-only wl-sr" aria-live="polite"></p>`;
}

let open: HTMLElement | null = null;

/** Show the welcome page and remember that it was seen. */
export function openWelcome(): void {
  if (open) return;
  useStyles('welcome-css', CSS);
  const root = document.createElement('div');
  root.className = 'wl-tour';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', t('Welcome to Memora'));
  const names = trackNames();
  const steps = stepsHTML(names);
  root.innerHTML = pageHTML(steps, names);
  document.body.appendChild(root);
  open = root;
  // Closing returns to the page it was opened from, or to Overview when loaded at /welcome.
  const back = location.pathname === '/welcome' ? '/overview' : location.pathname + location.search;
  if (location.pathname !== '/welcome') history.pushState(history.state, '', '/welcome');
  requestAnimationFrame(() => root.classList.add('on'));
  void api(FLAG, { method: 'PUT', body: { data: { seen_at: Math.floor(Date.now() / 1000) } } }).catch(() => {});

  const close = (then?: () => void): void => {
    if (open !== root) return;
    open = null;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    if (location.pathname === '/welcome') history.replaceState(history.state, '', back);
    root.classList.remove('on');
    setTimeout(() => root.remove(), 300);
    then?.();
  };
  // In right-to-left languages the arrow keys follow the reading direction.
  const rtl = getComputedStyle(root).direction === 'rtl';
  const onKey = (e: KeyboardEvent): void => {
    // A dialog over the tour (the language picker) takes its own keys.
    if (document.querySelector('#modalHost:not(.hidden)')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') show(rtl ? at - 1 : at + 1);
    else if (e.key === 'ArrowLeft') show(rtl ? at + 1 : at - 1);
  };
  const onPop = (): void => {
    if (location.pathname !== '/welcome') close();
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('popstate', onPop);
  root.querySelectorAll<HTMLElement>('[data-wl]').forEach((b) => {
    b.onclick = () => {
      const act = b.dataset.wl;
      if (act === 'new') close(() => hooks.openNewNote());
      else if (act === 'keys') close(() => hooks.go('keys'));
      else if (act === 'mnemo') close(() => hooks.go('assistant'));
      else if (act === 'brain') close(() => hooks.go('brain'));
      else close();
    };
  });
  const pages = [...root.querySelectorAll<HTMLElement>('.wl-step')];
  const segs = [...root.querySelectorAll<HTMLButtonElement>('.wl-seg')];
  const count = root.querySelector<HTMLElement>('.wl-count')!;
  const sr = root.querySelector<HTMLElement>('.wl-sr')!;
  const body = root.querySelector<HTMLElement>('.wl-body')!;
  const backBtn = root.querySelector<HTMLButtonElement>('.wl-back')!;
  const nextBtn = root.querySelector<HTMLButtonElement>('.wl-next')!;
  let at = 0;
  const show = (i: number): void => {
    if (i < 0 || i >= pages.length || i === at) return;
    pages[at].hidden = true;
    at = i;
    const pg = pages[at];
    pg.hidden = false;
    pg.className = 'wl-step in';
    body.scrollTop = 0;
    const total = pages.length;
    segs.forEach((s, k) => {
      s.classList.toggle('on', k === at);
      s.classList.toggle('done', k < at);
      if (k === at) s.setAttribute('aria-current', 'step');
      else s.removeAttribute('aria-current');
    });
    count.textContent = t('{n} of {total}', { n: at + 1, total });
    sr.textContent = t('Step {n} of {total}: {name}', { n: at + 1, total, name: names[at] ?? '' });
    backBtn.hidden = at === 0;
    const last = at === total - 1;
    nextBtn.innerHTML = last ? t('Done') : `${t('Next')} ${icon('arrow')}`;
    nextBtn.setAttribute('aria-label', last ? t('Close the welcome') : t('Next, step {n} of {total}', { n: at + 2, total }));
  };
  segs.forEach((s) => {
    s.onclick = () => show(Number(s.dataset.go));
  });
  // Step one asks the language (this device and new ones) and the server's name.
  const langSel = root.querySelector<HTMLButtonElement>('#wlLang');
  const nameIn = root.querySelector<HTMLInputElement>('#wlName');
  const setupSt = root.querySelector<HTMLElement>('.wl-setup-st small');
  const said = (msg: string): void => {
    if (setupSt) setupSt.textContent = msg;
  };
  if (langSel)
    langSel.onclick = () =>
      openLangPicker(langPref(), (v) => {
        void apiPost('/api/settings/server', { language: v })
          .catch(() => undefined)
          .finally(() => setLangPref(v));
      });
  if (nameIn) {
    // Starts empty on purpose: the owner names the server here, nothing is prefilled.
    let saved = '';
    const save = (): void => {
      const v = nameIn.value.trim();
      if (!v || v === saved) return;
      apiPost<{ realm: string }>('/api/settings/server', { realm: v }).then(
        (r) => {
          saved = r.realm;
          said(t('Saved'));
        },
        (e) => said((e as Error).message),
      );
    };
    nameIn.onblur = save;
    nameIn.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
      e.stopPropagation();
    };
  }
  backBtn.onclick = () => show(at - 1);
  nextBtn.onclick = () => (at === pages.length - 1 ? close() : show(at + 1));
  nextBtn.focus({ preventScroll: true });
}

/** On boot: open at /welcome, or the first time this instance is signed in to. */
export async function maybeWelcome(): Promise<void> {
  if (START === '/welcome') {
    openWelcome();
    return;
  }
  try {
    const r = await api<{ data?: unknown }>(FLAG);
    if (r && r.data == null) openWelcome();
  } catch {
    /* better to skip it than to show it on every load */
  }
}
