// Mnemo's look: the mark, the chat (bubbles, tool cards, composer) and shared bits.

import { icon } from '../ui/icons';
import { TEXT_SIZE_CSS } from './textsize';
import { ART_CSS } from './art';

/** The Mnemo mark: a memory wave with a spark, on a teal-to-indigo tile. */
export function markHTML(cls = ''): string {
  return `<span class="mn-mark ${cls}" aria-hidden="true">${icon('mnemo', 'i mn-mark-g')}</span>`;
}

export const MNEMO_CSS = `${TEXT_SIZE_CSS}${ART_CSS}
.mn-mark{--s:28px;position:relative;display:inline-grid;place-items:center;flex:none;width:var(--s);height:var(--s);border-radius:calc(var(--s) * .32);
  color:#fff;background:linear-gradient(145deg,#5eead4 0%,#14b8a6 30%,#4f46e5 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.4),inset 0 -1px 0 rgba(15,23,42,.18),0 1px 2px rgba(15,23,42,.16)}
.mn-mark .mn-mark-g{width:62%;height:62%;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}
.mn-mark.sm{--s:26px}.mn-mark.md{--s:32px}.mn-mark.lg{--s:40px}.mn-mark.xl{--s:64px}
.mn-mark.xl .mn-mark-g{stroke-width:1.8}
.mn-mark.pulse{animation:mnPulse 1.6s var(--ease,ease) infinite}
@keyframes mnPulse{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 0 0 0 rgba(20,184,166,.35)}50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 0 0 8px rgba(20,184,166,0)}}

.mn-chat{display:flex;flex-direction:column;min-height:0;height:100%;position:relative}
/* One column for the conversation and the message box: the log and the composer share one max
   width (--mn-col) and one side gutter (--mn-gut), so questions, replies and the box line up on
   both edges in every width. The log shows no scrollbar, so no gutter tells them apart. */
.mn-chat{--mn-col:780px;--mn-gut:24px}
.mn-chat.compact{--mn-gut:14px}
.mn-log{--lp:28px;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:var(--lp) var(--mn-gut) 12px;display:flex;flex-direction:column;gap:18px;scroll-padding-bottom:24px}
.mn-log>*{width:100%;max-width:var(--mn-col);margin-inline:auto}
.mn-chat.compact .mn-log{--lp:16px;padding:var(--lp) var(--mn-gut) 8px;gap:14px}

.mn-u{display:flex;flex-direction:column;align-items:flex-end;gap:4px;animation:mnIn .25s var(--ease-out,ease-out) both}
.mn-ub{max-width:min(82%,620px);padding:10px 15px;border-radius:20px 20px 6px 20px;white-space:pre-wrap;overflow-wrap:anywhere;
  font-size:var(--mn-fs,14.5px);line-height:1.55;color:var(--fg);background:color-mix(in srgb,var(--accent) 13%,var(--surface-1,var(--panel)));
  border:1px solid color-mix(in srgb,var(--accent) 22%,transparent)}
.mn-u-act{display:flex;align-items:center;justify-content:flex-end;gap:2px;height:28px;margin:-2px -4px 0 0;opacity:0;transform:translateY(-3px);
  transition:opacity .15s,transform .18s var(--ease-out,ease-out);pointer-events:none}
.mn-u:hover .mn-u-act,.mn-u:focus-within .mn-u-act,.mn-u.show-act .mn-u-act{opacity:1;transform:none;pointer-events:auto}
.mn-u-act time{margin-right:4px;font-size:11.5px;color:var(--text-3,var(--muted));font-variant-numeric:tabular-nums;white-space:nowrap}
.mn-u-btns{display:inline-flex;gap:2px}
.mn-u-btns .mn-ibtn,.mn-foot-a .mn-ibtn{width:28px;height:28px;border-radius:8px}
.mn-u-btns .mn-ibtn .i,.mn-foot-a .mn-ibtn .i{width:15px;height:15px}
.mn-err-a{display:flex;gap:6px;margin-left:auto;flex:none}
.mn-err-a .btn .i{width:14px;height:14px}
@media (max-width:640px){.mn-err{flex-wrap:wrap}.mn-err-a{margin-left:0}}
.mn-turn{display:grid;grid-template-columns:30px minmax(0,1fr);gap:12px;align-items:start;animation:mnIn .3s var(--ease-out,ease-out) both}
.mn-av{padding-top:1px}
.mn-turn.live .mn-av .mn-mark{animation:mnPulse 1.6s var(--ease,ease) infinite}
.mn-tb{min-width:0;display:flex;flex-direction:column;gap:8px}
@keyframes mnIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

.mn-md{font-size:var(--mn-fs,14.5px);line-height:1.68;color:var(--fg);overflow-wrap:anywhere}
.mn-md>:first-child{margin-top:0}.mn-md>:last-child{margin-bottom:0}
.mn-md p{margin:.55em 0}
.mn-md h1,.mn-md h2,.mn-md h3,.mn-md h4{margin:1em 0 .4em;font-weight:650;line-height:1.3;letter-spacing:-.01em}
.mn-md h1{font-size:1.31em}.mn-md h2{font-size:1.17em}.mn-md h3,.mn-md h4{font-size:1.04em}
.mn-md ul,.mn-md ol{margin:.5em 0;padding-left:1.35em}.mn-md li{margin:.2em 0}.mn-md li::marker{color:var(--muted)}
.mn-md a{color:inherit;text-decoration:underline;text-decoration-color:var(--accent-line,var(--accent));text-underline-offset:3px}
.mn-md code{font-family:var(--mono);font-size:.86em;padding:.1em .38em;border-radius:6px;background:color-mix(in srgb,var(--fg) 7%,transparent)}
.mn-md blockquote{margin:.6em 0;padding:.1em 0 .1em 14px;border-left:3px solid var(--accent-line,var(--line-strong));color:var(--text-2,var(--muted))}
.mn-md hr{border:0;border-top:1px solid var(--line);margin:1em 0}
.mn-md table{border-collapse:collapse;margin:.6em 0;font-size:.93em;display:block;overflow-x:auto;max-width:100%}
.mn-md th,.mn-md td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.mn-md th{font-weight:600;color:var(--text-2,var(--muted));font-size:12.5px}
.mn-md .dc-code{margin:.6em 0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface-1,var(--panel))}
.mn-md .dc-code-bar{display:flex;align-items:center;justify-content:space-between;padding:5px 8px 5px 12px;font-size:11.5px;color:var(--muted);border-bottom:1px solid var(--line)}
.mn-md .dc-copy{border:0;background:none;color:var(--muted);font:inherit;cursor:pointer;padding:2px 6px;border-radius:6px}
.mn-md .dc-copy:hover{background:var(--hover);color:var(--fg)}
.mn-md pre{margin:0;padding:10px 12px;overflow-x:auto;font:12.5px/1.6 var(--mono)}
.mn-md pre code{padding:0;background:none;font-size:inherit}
.mn-md .dc-anchor{display:none}
.mn-wl{color:var(--fg)!important;text-decoration:none!important;border-bottom:1.5px solid var(--accent-line,var(--accent));font-weight:550;cursor:pointer}
.mn-wl:hover{background:var(--accent-soft)}
.mn-wl.code{border-bottom:0}.mn-wl.code code{box-shadow:inset 0 -1.5px 0 var(--accent-line,var(--accent))}
/* Boards read differently from notes (teal, the accent): a board icon and a violet accent, in
   links, chips and cards. */
:root{--mn-kb:#a78bfa}
:root[data-theme=light]{--mn-kb:#7c3aed}
:root[data-theme=light] .mn-chat.fleeting{--mn-kb:#a78bfa}
.mn-chat.fleeting .ch-board{--kb-ac:#a78bfa}
.mn-wl.is-kb{border-bottom-color:color-mix(in srgb,var(--mn-kb) 75%,transparent)}
.mn-wl.is-kb:hover{background:color-mix(in srgb,var(--mn-kb) 12%,transparent)}
.mn-wl-ic{width:.95em;height:.95em;vertical-align:-.12em;margin-inline-end:3px;color:var(--mn-kb);stroke-width:2}
.mn-wl.missing{border-bottom-style:dashed;border-bottom-color:var(--line-strong);color:var(--text-2,var(--muted))!important;font-weight:inherit;cursor:help}
.mn-caret{display:inline-block;width:7px;height:1.05em;margin-left:2px;vertical-align:-2px;border-radius:2px;background:var(--accent);animation:mnBlink 1s steps(2) infinite}
@keyframes mnBlink{50%{opacity:0}}

.mn-think{display:inline-flex;align-items:center;gap:4px;height:26px;font-size:calc(var(--mn-fs,14.5px) - 1.5px);color:var(--muted)}
.mn-think i{width:6px;height:6px;border-radius:50%;background:var(--accent);opacity:.35;animation:mnDot 1.2s ease-in-out infinite}
.mn-think i:nth-child(2){animation-delay:.15s}.mn-think i:nth-child(3){animation-delay:.3s}
.mn-think span{margin-left:6px;background:linear-gradient(90deg,var(--muted) 30%,var(--fg) 50%,var(--muted) 70%);background-size:200% 100%;
  -webkit-background-clip:text;background-clip:text;color:transparent;animation:mnShine 1.8s linear infinite}
@keyframes mnDot{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
@keyframes mnShine{from{background-position:100% 0}to{background-position:-100% 0}}

.mn-tools{display:flex;flex-direction:column;gap:6px}
.mn-tool{border:1px solid var(--line);border-radius:12px;background:var(--surface-1,var(--panel));overflow:clip;animation:mnIn .25s var(--ease-out,ease-out) both;transition:border-color .15s}
.mn-tool[open]{border-color:var(--line-strong)}
.mn-tool summary{display:flex;align-items:center;gap:10px;min-height:40px;padding:6px 10px 6px 7px;cursor:pointer;list-style:none;user-select:none}
.mn-tool summary::-webkit-details-marker{display:none}
.mn-tool summary:hover{background:var(--hover)}
.mn-tool summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:12px}
.mn-tool-ic{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:8px;color:var(--text-2,var(--muted));background:color-mix(in srgb,var(--fg) 6%,transparent)}
.mn-tool.w .mn-tool-ic{color:var(--accent);background:var(--accent-soft)}
.mn-tool-ic .i{width:14px;height:14px;stroke-width:2}
.mn-tool-t{flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;overflow:hidden}
.mn-tool-t b{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:calc(var(--mn-fs,14.5px) - 1.5px);font-weight:600}
.mn-tool-t small{min-width:0;font-size:calc(var(--mn-fs,14.5px) - 2px);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-tool-s{display:inline-flex;align-items:center;gap:5px;flex:0 1 auto;min-width:0;max-width:46%;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.mn-tool-s>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-tool-s>.i{flex:none}
.mn-tool-t b{white-space:nowrap}
.mn-tool-s .i{width:14px;height:14px;stroke-width:2.2}
.mn-tool.ok .mn-tool-s .i{color:var(--ok,#10b981)}.mn-tool.err .mn-tool-s{color:var(--danger)}
/* A narrow chat: each step takes two lines (what it did, then how it went), never overlapping. */
@container (max-width:620px){
  .mn-log .mn-tool summary{display:grid;grid-template-columns:26px minmax(0,1fr) 14px;grid-template-areas:"ic t ch" "ic s ch";column-gap:10px;row-gap:1px;align-items:center}
  .mn-log .mn-tool-ic{grid-area:ic}
  .mn-log .mn-tool-t{grid-area:t}
  .mn-log .mn-tool-s{grid-area:s;max-width:100%;justify-self:start;font-size:11.5px}
  .mn-log .mn-tool summary>.mn-tool-chev{grid-area:ch}
}
.mn-tool-chev{width:14px;height:14px;flex:none;color:var(--muted);transition:transform .18s var(--ease,ease)}
.mn-tool[open] .mn-tool-chev{transform:rotate(90deg)}
.mn-tool-b{padding:2px 12px 12px;display:flex;flex-direction:column;gap:6px}
.mn-tool-k{font-size:11.5px;font-weight:600;color:var(--muted);font-family:var(--mono)}
.mn-tool-b pre{margin:0;max-height:240px;overflow:auto;padding:8px 10px;border-radius:8px;background:var(--surface-0,var(--bg));border:1px solid var(--line);
  font:11.5px/1.55 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere}
.mn-spin{width:12px;height:12px;border-radius:50%;border:2px solid color-mix(in srgb,var(--accent) 25%,transparent);border-top-color:var(--accent);animation:mnSpin .7s linear infinite}
@keyframes mnSpin{to{transform:rotate(360deg)}}

.mn-foot{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;min-height:28px;font-size:11.5px;color:var(--text-3,var(--muted))}
.mn-foot-a{display:inline-flex;gap:2px;margin-left:-6px}
.mn-foot-m{display:inline-flex;align-items:center;gap:6px;min-width:0}
.mn-foot-m>span{white-space:nowrap}
.mn-foot i{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.6;flex:none}
.mn-ibtn{display:inline-grid;place-items:center;width:26px;height:26px;border:0;border-radius:8px;background:none;color:var(--muted);cursor:pointer}
.mn-ibtn:hover{background:var(--hover);color:var(--fg)}
.mn-ibtn .i{width:15px;height:15px;stroke-width:1.9}
.mn-notice{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted)}
.mn-notice .i{width:14px;height:14px;flex:none}
.mn-err{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;font-size:13px;line-height:1.45;color:var(--fg);
  background:var(--danger-soft,color-mix(in srgb,var(--danger) 10%,transparent));border:1px solid color-mix(in srgb,var(--danger) 30%,transparent)}
.mn-err>.i{width:16px;height:16px;flex:none;color:var(--danger)}
.mn-err{flex-wrap:wrap}
.mn-err>span.mn-err-t{flex:1;min-width:0;overflow-wrap:anywhere}
.mn-err-d{flex:1 0 100%;margin:0;font-size:12px;color:var(--muted)}
.mn-err-d summary{display:inline-flex;cursor:pointer;list-style:none;text-decoration:underline;text-underline-offset:2px}
.mn-err-d summary::-webkit-details-marker{display:none}
.mn-err-d summary:hover{color:var(--fg)}
.mn-err-d pre{margin:6px 0 0;max-height:180px;overflow:auto;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--fg) 6%,transparent);
  font:11.5px/1.5 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text-2,var(--fg))}
.mn-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;flex:1;color:var(--muted);font-size:13px}

.mn-hello{display:flex;flex-direction:column;align-items:center;text-align:center;margin:auto;padding:24px 4px 12px;max-width:620px!important}
.mn-hello-mark{position:relative;margin-bottom:18px}
.mn-hello-mark::before{content:"";position:absolute;inset:-18px;border-radius:50%;z-index:-1;filter:blur(18px);opacity:.55;
  background:conic-gradient(from 0deg,#5eead4,#818cf8,#14b8a6,#a5b4fc,#5eead4);animation:mnHalo 8s linear infinite}
@keyframes mnHalo{to{transform:rotate(360deg)}}
.mn-hello h2{margin:0;font-size:22px;font-weight:680;letter-spacing:-.02em;color:var(--fg)}
.mn-chat.compact .mn-hello h2{font-size:18px}
.mn-hello p{margin:8px 0 0;font-size:14px;line-height:1.55;color:var(--text-2,var(--muted));max-width:460px}
.mn-earlier{width:100%;margin-top:20px;padding:12px;border:1px solid color-mix(in srgb,var(--accent) 30%,var(--line));border-radius:16px;text-align:left;
  background:color-mix(in srgb,var(--accent) 6%,var(--surface-1,var(--panel)));animation:mnIn .25s var(--ease-out,ease-out) both}
.mn-earlier-h{display:flex;gap:10px;align-items:flex-start;padding:2px 4px 10px}
.mn-earlier-h>.i{width:18px;height:18px;flex:none;margin-top:2px;color:var(--accent)}
.mn-earlier-h span{display:flex;flex-direction:column;gap:2px;line-height:1.35}
.mn-earlier-h b{font-size:14px;font-weight:650}
.mn-earlier-h small{font-size:12.5px;color:var(--muted)}
.mn-earlier-l{display:flex;flex-direction:column;gap:6px}
.mn-earlier-i{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px 9px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-1,var(--panel));
  color:var(--fg);font:inherit;text-align:left;cursor:pointer;transition:border-color .15s,background .15s}
.mn-earlier-i:hover{border-color:var(--accent);background:var(--hover)}
.mn-earlier-t{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.mn-earlier-t b{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-earlier-t small{font-size:12px;color:var(--muted)}
.mn-earlier-go{display:inline-flex;align-items:center;gap:2px;flex:none;font-size:12.5px;font-weight:650;color:var(--accent)}
.mn-earlier-go .i{width:14px;height:14px}
.mn-sug em{display:inline-block;margin-left:8px;padding:0 6px;border-radius:99px;font-style:normal;font-size:10.5px;font-weight:650;vertical-align:1px;
  background:var(--accent-soft);color:var(--accent)}
.mn-sug.k-own em{background:color-mix(in srgb,#f59e0b 16%,transparent);color:#b45309}
:root:not([data-theme=light]) .mn-sug.k-own em{color:#fbbf24}
.mn-sug.k-ai>.i{color:var(--accent)}
.mn-sug-bar{display:flex;justify-content:center;flex-wrap:wrap;gap:6px;margin-top:12px}
.mn-sug-act{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--line);border-radius:99px;background:none;color:var(--text-2,var(--fg));
  font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;transition:border-color .15s,background .15s,color .15s}
.mn-sug-act:hover{border-color:var(--accent-line,var(--line-strong));color:var(--fg);background:var(--hover)}
.mn-sug-act .i{width:14px;height:14px}
.mn-sug-act[data-amaze] .i{color:var(--accent)}
/* Fresh ideas at work: a sheen runs across the button and the cards wait as soft placeholders. */
.mn-sug-act{position:relative;overflow:hidden;isolation:isolate}
.mn-sug-act.busy{border-color:var(--accent-line,var(--accent));color:var(--fg);cursor:progress}
.mn-sug-act.busy::after{content:"";position:absolute;inset:0;z-index:-1;
  background:linear-gradient(100deg,transparent 20%,color-mix(in srgb,var(--accent) 22%,transparent) 50%,transparent 80%);background-size:220% 100%;animation:mnSheen 1.3s ease-in-out infinite}
.mn-sug-act.busy span{background:linear-gradient(90deg,var(--muted) 30%,var(--fg) 50%,var(--muted) 70%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:mnShine 1.4s linear infinite}
.mn-sug-act.busy .i{animation:mnTwinkle 1.4s ease-in-out infinite}
@keyframes mnSheen{from{background-position:120% 0}to{background-position:-120% 0}}
@keyframes mnTwinkle{0%,100%{transform:scale(1) rotate(0);opacity:1}50%{transform:scale(1.18) rotate(18deg);opacity:.7}}
.mn-sugs.loading .mn-sug{position:relative;overflow:hidden;color:transparent;pointer-events:none;border-color:var(--line)}
.mn-sugs.loading .mn-sug>*{visibility:hidden}
.mn-sugs.loading .mn-sug::after{content:"";position:absolute;inset:0;
  background:linear-gradient(100deg,color-mix(in srgb,var(--fg) 4%,transparent) 30%,color-mix(in srgb,var(--accent) 14%,transparent) 50%,color-mix(in srgb,var(--fg) 4%,transparent) 70%);
  background-size:240% 100%;animation:mnSheen 1.4s ease-in-out infinite;animation-delay:calc(var(--i) * 90ms)}
@media (prefers-reduced-motion:reduce){.mn-sug-act.busy::after,.mn-sug-act.busy span,.mn-sug-act.busy .i,.mn-sugs.loading .mn-sug::after{animation:none}}
.mn-sk-row{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px;margin-top:14px;font-size:12px;color:var(--muted)}
.mn-sk-row[hidden]{display:none}
.mn-sk-row>span{margin-right:2px}
.mn-sk-chip{height:26px;padding:0 10px;border-radius:8px;border:1px dashed var(--line-strong);background:none;color:var(--fg);font:600 12px/1 var(--font-mono,ui-monospace,monospace);cursor:pointer}
.mn-sk-chip:hover{border-style:solid;border-color:var(--accent)}
.mn-own-sugs p{margin:0 0 10px;font-size:13px;color:var(--muted);line-height:1.5}
.mn-own-sugs textarea{width:100%;box-sizing:border-box;resize:vertical;padding:10px 12px;border:1px solid var(--line-strong);border-radius:10px;background:var(--surface-0,var(--bg));color:var(--fg);font:inherit;font-size:14px;line-height:1.5}
.mn-slash{position:absolute;inset-inline:var(--mn-gut);bottom:calc(100% - 4px);z-index:8;max-width:var(--mn-col);margin:0 auto;padding:6px;border:1px solid var(--line-strong);border-radius:14px;
  background:var(--surface-1,var(--panel));box-shadow:0 18px 40px -18px rgba(15,23,42,.4);animation:mnIn .14s var(--ease-out,ease-out) both;max-height:320px;overflow:auto}
.mn-slash-h{display:flex;align-items:center;gap:6px;padding:4px 8px 6px;font-size:12px;font-weight:650;color:var(--muted)}
.mn-slash-h .i{width:13px;height:13px;color:var(--accent)}
.mn-slash-h small{font-weight:450;margin-left:auto}
.mn-slash-i{display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;padding:8px 10px;border:0;border-radius:9px;background:none;color:var(--fg);font:inherit;text-align:left;cursor:pointer}
.mn-slash-i b{font:600 13px/1.3 var(--font-mono,ui-monospace,monospace)}
.mn-slash-i small{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.mn-slash-i.on,.mn-slash-i:hover{background:var(--accent-soft,var(--hover))}
.mn-slash-none{margin:0;padding:8px 10px 10px;font-size:12.5px;color:var(--muted);line-height:1.5}
.mn-chat:not(:has(.mn-hello)) .mn-fine{display:none}
/* Fleeting chat: anonymous, not loud. Neutral greys from the theme (light, dark, any backdrop the
   owner picked in Appearance); colour drains from the marks, bubbles go plain, the prompt is dashed. */
/* Fleeting chats wear their own look in every theme ("veil"): a deep ink room with a faint
   weave, silver instead of colour, and a quiet pill saying nothing is kept; the backdrop
   picked in Appearance does not apply here. */
.mn-chat.fleeting{color-scheme:dark;--bg:#0d0f13;--surface-0:#14171c;--surface-1:#191d23;--panel:#191d23;--fg:#e6e8ec;--text-2:#c4c8d0;--muted:#8d94a0;
  --line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.15);--hover:rgba(255,255,255,.06);--accent:#5eead4;--accent-soft:rgba(94,234,212,.14);--ok:#86efac;
  --surface-2:#20252d;--surface-3:#272d36;--text-3:#6b7380;--accent-line:rgba(94,234,212,.45);--on-accent:#04221e;--warn:#fbbf24;--mn-kb:#a78bfa;
  --fl-ink:#d9dde3;--fl-tint:rgba(45,212,191,.13);--fl-edge:rgba(94,234,212,.28);
  color:var(--fg);background-color:#0d0f13;
  background-image:radial-gradient(rgba(255,255,255,.035) 1px,transparent 1px),radial-gradient(120% 70% at 50% 0%,rgba(255,255,255,.05),transparent 60%);
  background-size:22px 22px,auto;border:1px solid rgba(255,255,255,.08);border-radius:18px;overflow:hidden;box-shadow:0 18px 50px -30px rgba(0,0,0,.6)}
.mn-chat.compact.fleeting{border-radius:14px}
.mn-chat.fleeting .mn-comp-box{background:#14171c}
.mn-chat.fleeting .mn-send{background:linear-gradient(135deg,#5eead4,#22d3ee);color:#06201d}
/* Phones: the fleeting room is the whole screen (a full-bleed sheet under the page's compact
   header), not a framed box inside it, so no width is spent on a frame twice. */
@media (max-width:760px){.mnp.fleeting .mnp-chat{padding:0}.mnp .mn-chat.fleeting{border:0;border-radius:0;box-shadow:none}}
.mnp .mn-chat.fleeting.cw-narrow{--mn-gut:14px}
.mn-incog{display:grid;place-items:center;margin-bottom:14px;color:var(--fl-ink)}
.mn-incog .i{width:44px;height:44px;stroke-width:1.4}
.mn-chat.fleeting .mn-hello h2{font-weight:600;letter-spacing:-.01em}
.mn-chat.fleeting .mn-hello>p{color:var(--muted)}
/* What is and is not kept: plain lines, like the small print of a private window. */
.mn-fleet{display:flex;flex-direction:column;width:100%;max-width:440px;margin:22px auto 0;padding:0;text-align:left;border-top:1px solid var(--line)}
.mn-fleet>div{display:grid;grid-template-columns:72px minmax(0,1fr);gap:12px;padding:10px 2px;border-bottom:1px solid var(--line)}
.mn-fleet dt{font:600 11px/1.6 var(--font-mono,ui-monospace,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--fg)}
.mn-fleet dd{margin:0;font-size:13px;line-height:1.5;color:var(--muted)}
.mn-chat.fleeting .mn-comp-box{border-style:dashed;border-color:var(--fl-edge)}
.mn-chat.fleeting .mn-ub{background:var(--fl-tint);border-color:var(--fl-edge);color:var(--fg)}
.mn-chat.fleeting .mn-hello-mark{filter:grayscale(1);opacity:.85}
/* In the veil: your messages in a soft Mnemo teal, Mnemo's replies on a slightly lifted surface. */
.mn-chat.fleeting .mn-tb{background:#171a21;border-color:rgba(255,255,255,.07)}
.mn-chat.fleeting .mn-tray-box{background:#171a21;border-color:rgba(255,255,255,.08);box-shadow:0 -10px 24px -18px rgba(0,0,0,.6)}
.mn-chat.fleeting .mn-fleet-n{max-width:440px;margin:6px auto 0;font-size:13px;line-height:1.55;color:#8d94a0}
.mn-sugs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:100%;margin-top:22px}
.mn-chat.compact .mn-sugs{grid-template-columns:1fr;margin-top:16px}
.mn-sug{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--surface-0,var(--bg));
  color:var(--fg);font:inherit;font-size:13.5px;line-height:1.4;text-align:left;cursor:pointer;
  transition:border-color .15s,transform .2s var(--ease-out,ease-out),background .15s;animation:mnIn .35s var(--ease-out,ease-out) both;animation-delay:calc(var(--i) * 50ms)}
.mn-sug:hover{border-color:var(--accent-line,var(--line-strong));background:var(--surface-1,var(--panel));transform:translateY(-1px)}
.mn-sug .i{width:15px;height:15px;flex:none;margin-top:2px;color:var(--accent)}
.mn-setup{display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:20px;padding:18px 20px;border:1px dashed var(--accent-line,var(--line-strong));border-radius:16px;font-size:13.5px}
.mn-setup>span{color:var(--muted);max-width:380px;line-height:1.5}
.mn-setup .btn{margin-top:8px}

.mn-comp{flex:none;padding:10px var(--mn-gut) 14px;position:relative}
.mn-down{position:absolute;left:50%;bottom:calc(100% + 6px);z-index:6;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 10px 0 14px;white-space:nowrap;
  border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--surface-1,var(--panel)) 92%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  color:var(--fg);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 6px 18px -8px rgba(15,23,42,.35);
  opacity:0;pointer-events:none;transform:translate(-50%,8px) scale(.96);transition:opacity .2s,transform .25s var(--ease-out,ease-out),background .15s}
.mn-down .i{width:16px;height:16px;flex:none}
/* Round and small, so it covers as little of the answer as it can. */
.mn-down span{display:none}.mn-down{width:36px;height:36px;padding:0}
.mn-down.on{opacity:1;pointer-events:auto;transform:translate(-50%,0)}
.mn-down:hover{background:var(--hover)}
.mn-down:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mn-chat.compact .mn-comp{padding:8px var(--mn-gut) 12px}
/* The one-time "tell Mnemo about you" card on a new chat. */
.mn-intro{display:flex;flex-direction:column;gap:8px;width:100%;max-width:560px;margin:4px auto 14px;padding:14px 16px;text-align:left;border:1px solid var(--line);border-radius:16px;background:var(--surface-1,var(--panel))}
.mn-intro>b{font-size:14px;font-weight:620}
.mn-intro>span{font-size:12.5px;line-height:1.5;color:var(--muted)}
.mn-intro textarea{width:100%;min-height:64px;resize:vertical;font:inherit;line-height:1.45;padding:9px 11px}
.mn-intro-a{display:flex;flex-wrap:wrap;gap:6px}
@media (max-width:640px){.mn-intro textarea{font-size:16px}}
/* The tray: one drawer on top of the message box for everything about the reply at work:
   the live line (what Mnemo does now), its plan, and the messages queued after it. Each part
   unfolds and folds smoothly (grid rows 0fr <-> 1fr), and the chat above shrinks with it, so
   nothing ever floats over the conversation. */
.mn-col{display:grid;grid-template-rows:0fr;opacity:0;visibility:hidden;
  transition:grid-template-rows .36s cubic-bezier(.22,.8,.24,1),opacity .24s ease,visibility 0s linear .36s}
.mn-col.on{grid-template-rows:1fr;opacity:1;visibility:visible;transition:grid-template-rows .36s cubic-bezier(.22,.8,.24,1),opacity .28s ease .04s,visibility 0s}
.mn-col-in{min-height:0;overflow:hidden}
.mn-comp{isolation:isolate}
.mn-tray{max-width:780px;margin:0 auto -1px;padding:0 18px;position:relative;z-index:-1}
.mn-tray-box{border:1px solid var(--line);border-bottom:0;border-radius:14px 14px 0 0;padding-bottom:2px;
  background:color-mix(in srgb,var(--surface-1,var(--panel)) 92%,var(--fg) 2%);box-shadow:0 -10px 24px -18px rgba(15,23,42,.28);
  transform:translateY(8px);transition:transform .36s cubic-bezier(.22,.8,.24,1)}
.mn-tray.on .mn-tray-box{transform:none}
.mn-tray-h{display:flex;align-items:center;gap:10px;min-height:38px;padding:5px 8px 5px 14px}
.mn-plan-ttl{flex:none;font-size:12.5px;font-weight:620;color:var(--fg)}
.mn-tray-h:has(.mn-live:not([hidden])) .mn-plan-ttl{display:none}
.mn-plan-h{display:inline-flex;align-items:center;gap:8px;flex:none;margin-inline-start:auto;height:28px;padding:0 6px 0 8px;border:0;border-radius:8px;background:none;
  font:inherit;color:var(--fg);cursor:pointer;transition:background .15s,opacity .2s}
.mn-plan-h:hover{background:var(--hover)}
.mn-plan-x{display:none;place-items:center;flex:none;width:28px;height:28px;margin-inline-start:-6px;border:0;border-radius:8px;background:none;color:var(--muted);cursor:pointer;transition:background .15s,color .15s}
.mn-plan-x .i{width:14px;height:14px}
.mn-plan-x:hover{background:var(--hover);color:var(--fg)}
.mn-plan-x:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.mn-tray.has-plan.own:not(.busy) .mn-plan-x{display:grid}
/* No reply at work (it was stopped): the plan stays as it was, its step at work paused. */
.mn-tray:not(.busy) .mn-ps.in_progress .mn-spin{animation:none;border-color:color-mix(in srgb,var(--accent) 55%,transparent)}
.mn-plan-h:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.mn-tray:not(.has-plan) :is(.mn-plan-ttl,.mn-plan-h){opacity:0;pointer-events:none}
.mn-plan-n{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.mn-plan-bar{flex:none;width:64px;height:3px;border-radius:3px;background:var(--line);overflow:hidden}
.mn-plan-bar>i{display:block;width:0;height:100%;background:var(--ok,#10b981);border-radius:3px;transition:width .4s cubic-bezier(.22,.8,.24,1)}
.mn-plan-chev{flex:none;width:14px;height:14px;color:var(--muted);transition:transform .2s}
.mn-tray.folded .mn-plan-chev{transform:rotate(-90deg)}
.mn-plan{display:flex;flex-direction:column;padding:0 14px 10px;max-height:min(30vh,220px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}
.mn-plan::-webkit-scrollbar{display:none}
.mn-tray.folded .mn-ps:not(.in_progress){display:none}
/* The queue under the plan, split from it by a hairline. */
.mn-tray-hc.on~.mn-queue-c .mn-queue{border-top:1px solid var(--line)}
@media (max-width:640px){.mn-tray{padding:0 10px}.mn-tray-h{padding-inline-start:12px}.mn-plan{padding-inline:12px}}
@media (prefers-reduced-motion:reduce){.mn-col,.mn-col.on,.mn-tray-box{transition:none}}
/* The row under the header: the model on the left (a plain name with a chevron, its pin before
   it) and Fleeting on the right. */
.mn-top{position:absolute;top:8px;inset-inline:16px;z-index:4;display:flex;align-items:center;justify-content:space-between;gap:8px;pointer-events:none}
.mn-top>*{pointer-events:auto;display:flex;align-items:center;gap:2px;min-width:0}
.mn-top-l{flex:1 1 auto}
.mn-top-r{flex:none}
/* The model sits in a capsule of its own over the conversation: an opaque surface with a
   hairline and a soft shadow, so messages scrolling under it never show through or blur
   into its name. The chevron turns when it is open. */
.mn-top .ui-sel.mn-model{height:34px;max-width:min(360px,62vw);gap:6px;padding-block:0;padding-inline:13px 9px;border:1px solid var(--line-strong);border-radius:999px;
  background:var(--surface-1,var(--panel)) !important;box-shadow:0 1px 2px rgba(15,23,42,.06),0 8px 20px -12px rgba(15,23,42,.35);
  font-size:14px;font-weight:620;letter-spacing:-.01em;color:var(--text-2,var(--fg));transition:border-color .15s,box-shadow .15s,color .15s}
.mn-top .ui-sel.mn-model:hover{color:var(--fg);border-color:color-mix(in srgb,var(--fg) 28%,transparent)}
.mn-top .ui-sel.mn-model[aria-expanded=true]{color:var(--fg);border-color:var(--accent-line,var(--accent));box-shadow:0 0 0 3px var(--accent-soft),0 8px 20px -12px rgba(15,23,42,.35)}
.mn-top .mn-chip{height:34px;border-color:var(--line-strong);background:var(--surface-1,var(--panel));box-shadow:0 8px 20px -12px rgba(15,23,42,.35)}
@media (pointer:coarse){.mn-top .ui-sel.mn-model,.mn-top .mn-chip{height:38px}}
.mn-top .ui-sel.mn-model:hover .mn-model-chev,.mn-top .ui-sel.mn-model[aria-expanded=true] .mn-model-chev{color:var(--fg)}
.mn-top .ui-sel.mn-model:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mn-top .mn-pin{display:none !important}
.mn-model-chev{width:15px;height:15px;flex:none;color:var(--muted);transition:transform .18s}
.ui-sel.mn-model-pick[aria-expanded=true] .mn-model-chev{transform:rotate(180deg)}
.mn-top .mn-model-v{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.mn-top .mn-pin{width:28px;height:28px;flex:none}
.mn-log{padding-top:calc(var(--lp) + 34px)}
/* Under the box on the right: Agents (when there are any), the context meter and Think, plain
   icons of one size, outside the message box. */
.mn-under .ui-sel.mn-think{position:relative;width:32px;height:32px;padding:0;justify-content:center;border:0;border-radius:50%;background:none;max-width:none;color:var(--muted)}
.mn-under .ui-sel.mn-think:hover{background:var(--hover);color:var(--fg)}
.mn-under .ui-sel.mn-think .ui-sel-chev{display:none}
.mn-under .ui-sel.mn-think>.i{width:17px;height:17px;color:inherit}
.mn-under .mn-meter{width:32px;height:32px;background:none}
.mn-under .mn-meter:hover{background:var(--hover)}
.mn-under .ui-sel.mn-think .mn-model-v{display:none}
.mn-under .ui-sel.mn-think.set::after{content:"";position:absolute;top:5px;inset-inline-end:5px;width:6px;height:6px;border-radius:50%;background:var(--accent)}
/* Under the message box: the quiet note centred (it wraps, and goes once the chat has begun),
   the icons on the right. */
.mn-under{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;min-height:34px}
.mn-under .mn-grow{display:none}
.mn-under .mn-fine{grid-column:1;min-width:0;margin:0;white-space:normal;text-align:center;font-size:11px;line-height:1.45;color:var(--muted);padding-inline-start:96px}
@media (max-width:640px){.mn-under .mn-fine{display:block;grid-column:1/-1;grid-row:2;padding:0 4px}}
.mn-under>:not(.mn-fine):not(.mn-grow){grid-row:1}
.mn-under-r{display:flex;align-items:center;gap:2px;grid-column:2;margin-inline-start:auto}
.mn-comp .mn-under{display:grid;grid-template-columns:minmax(0,1fr) auto}
.mn-chat:not(:has(.mn-hello)) .mn-fine{visibility:hidden}
.mn-under .mn-think-slot,.mn-under .mn-ag-slot{display:inline-flex}
@media (max-width:640px){
  .mn-comp-bar{gap:4px}
  .mn-comp-bar .mn-perm-slot .mn-model-v{display:none}
  .mn-top{inset-inline:12px}
}
/* The model list: wide, grouped, the chosen model marked with an accent bar, each row with its
   context size and a pin that makes it the default for new chats. */
.ui-sel-pop.mn-model-pop{padding:6px;border-radius:16px;box-shadow:0 24px 60px -24px rgba(15,23,42,.45),0 2px 6px rgba(15,23,42,.06)}
/* Its own solid surface (no see-through glass over the chat), a clear edge and shadow, above the
   log, the tray and the page's panels. Phones get the bottom sheet (fits the screen, scrolls). */
:root .ui-sel-pop.mn-model-pop{z-index:130;background:var(--surface-2);-webkit-backdrop-filter:none;backdrop-filter:none;border:1px solid var(--line-strong);
  box-shadow:0 28px 64px -24px rgba(0,0,0,.6),0 4px 14px -6px rgba(0,0,0,.35)}
:root[data-theme=light] .ui-sel-pop.mn-model-pop{background:#fff;box-shadow:0 28px 64px -24px rgba(15,23,42,.42),0 4px 14px -6px rgba(15,23,42,.14)}
:root .ui-sel-pop.mn-model-pop.sheet{padding-bottom:calc(6px + env(safe-area-inset-bottom,0px))}
.ui-sel-scrim:has(+.ui-sel-pop.mn-model-pop){z-index:129}
/* Over a fleeting chat the list wears the chat's dark room, whatever the theme. */
:root:has(.mn-chat.fleeting) .ui-sel-pop.mn-model-pop{color-scheme:dark;--fg:#e6e8ec;--text-2:#c4c8d0;--muted:#8d94a0;--line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.15);
  --hover:rgba(255,255,255,.06);--accent:#5eead4;--accent-soft:rgba(94,234,212,.14);--accent-line:rgba(94,234,212,.45);color:var(--fg);background:#191d23}
.ui-sel-pop.mn-model-pop .ui-sel-q,.ui-sel-pop.mn-model-pop input[type=search]{border-radius:10px}
.ui-sel-pop.mn-model-pop .ui-sel-g{padding:10px 10px 4px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.ui-sel-pop.mn-model-pop .ui-sel-o{position:relative;min-height:44px;padding:7px 8px 7px 12px;border-radius:10px;gap:10px}
.ui-sel-pop.mn-model-pop .ui-sel-o[aria-selected=true]{background:var(--accent-soft)}
.ui-sel-pop.mn-model-pop .ui-sel-o[aria-selected=true]::before{content:"";position:absolute;inset-inline-start:3px;top:10px;bottom:10px;width:3px;border-radius:3px;background:var(--accent)}
.ui-sel-pop.mn-model-pop .ui-sel-o .tx b{font-size:13.5px}
.ui-sel-pop.mn-model-pop .ui-sel-o .tx small{font-size:11.5px}
.ui-sel-pop.mn-model-pop .ui-sel-ck{display:none}
/* The pin per model: faint until the row is hovered; the default's is a filled pin with a
   Default badge. The trigger repeats the filled pin after the default's name. */
.ui-sel-pop.mn-model-pop .ui-sel-tr{opacity:0;transition:opacity .15s,background .15s,color .15s}
.ui-sel-pop.mn-model-pop .ui-sel-o:is(:hover,.on) .ui-sel-tr,.ui-sel-pop.mn-model-pop .ui-sel-tr:focus-visible{opacity:.7}
.ui-sel-pop.mn-model-pop .ui-sel-tr:hover{opacity:1}
@media (hover:none){.ui-sel-pop.mn-model-pop .ui-sel-tr{opacity:.45}}
.ui-sel-pop.mn-model-pop .ui-sel-tr svg{transform:rotate(35deg)}
.ui-sel-pop.mn-model-pop .ui-sel-tr.on{opacity:1;width:auto;gap:4px;padding:0 9px 0 7px;height:24px;display:inline-flex;align-items:center;border-radius:999px;
  background:var(--accent-soft);color:var(--accent);font:inherit;font-size:11px;font-weight:650;letter-spacing:.01em}
.ui-sel-pop.mn-model-pop .ui-sel-tr.on svg{fill:currentColor;width:12px;height:12px}
.ui-sel-pop.mn-model-pop .ui-sel-tr.on:hover{background:color-mix(in srgb,var(--accent) 20%,transparent)}
.mn-model-def{display:inline-grid;place-items:center;flex:none;width:18px;height:18px;margin-inline-start:-2px;color:var(--accent)}
.mn-model-def .i,.mn-model-def svg{width:12px;height:12px;fill:currentColor;transform:rotate(35deg)}
/* The plan's steps: not started (a dashed ring), in progress (a spinner) or done (a tick), live. */
.mn-ps{display:flex;align-items:flex-start;gap:10px;padding:3px 2px;font-size:calc(var(--mn-fs,14.5px) - 1.5px);line-height:1.4;color:var(--fg);min-width:0}
.mn-ps-i{flex:none;display:grid;place-items:center;width:18px;height:18px;margin-top:1px}
.mn-ps-i{width:16px;height:16px}
.mn-ps-i .i{width:11px;height:11px;stroke-width:3;color:var(--surface-0,#fff)}
.mn-ps.done .mn-ps-i{border-radius:50%;background:var(--ok,#10b981)}
.mn-ps-i .mn-spin{width:14px;height:14px}
.mn-ps-o{width:14px;height:14px;border-radius:50%;border:1.6px dashed var(--muted);opacity:.8}
.mn-ps-t{min-width:0;display:flex;flex-direction:column;overflow-wrap:anywhere}
.mn-ps-t small{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-ps.pending .mn-ps-t{color:var(--muted)}
.mn-ps.done .mn-ps-t{color:var(--text-2,var(--muted))}
.mn-ps.in_progress .mn-ps-t{font-weight:560}
.mn-ps.now .mn-ps-i{animation:mnPop .35s var(--ease-out,ease-out)}
@keyframes mnPop{0%{transform:scale(.6)}60%{transform:scale(1.15)}100%{transform:none}}
@media (prefers-reduced-motion:reduce){.mn-ps.now .mn-ps-i{animation:none}}
/* The live status: the tray's top row, only while Mnemo works (it fades out with the row). */
.mn-live{display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0;height:28px;margin:0;padding:0 6px;margin-inline-start:-6px;border:0;background:none;
  font:inherit;font-size:calc(var(--mn-fs,14.5px) - 1.5px);color:var(--muted);text-align:start;cursor:pointer;border-radius:8px}
.mn-live:hover{background:var(--hover)}
.mn-live[hidden]{display:none}
.mn-tray-hc:not(.on) .mn-live[hidden]{display:flex}
.mn-live>i{flex:none;width:7px;height:7px;border-radius:50%;background:var(--accent);animation:mnLive 1.4s ease-in-out infinite}
.mn-live-t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  background:linear-gradient(90deg,var(--muted) 30%,var(--fg) 50%,var(--muted) 70%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:mnShine 2.4s linear infinite}
.mn-live-s{flex:none;font-variant-numeric:tabular-nums;opacity:.75}
.mn-live>.i,.mn-live>svg{flex:none;width:14px;height:14px;opacity:.6;transition:transform .15s}
.mn-live:hover{color:var(--fg)}.mn-live:hover>.i,.mn-live:hover>svg{transform:translateX(2px);opacity:1}
.mn-live:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mn-live:focus:not(:focus-visible){outline:none}
.mn-live.still{cursor:default;pointer-events:none}.mn-live.still>.i,.mn-live.still>svg{display:none}
@keyframes mnLive{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
.mn-turn.live:has(.mn-tb:empty){display:none}
@media (prefers-reduced-motion:reduce){.mn-live>i,.mn-live-t{animation:none}.mn-live-t{color:var(--muted);background:none}}
.mn-comp-box{max-width:var(--mn-col);margin:0 auto;border:1px solid var(--line-strong);border-radius:20px;background:var(--surface-0,var(--bg));
  box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px -12px rgba(15,23,42,.12);transition:border-color .15s,box-shadow .15s}
.mn-comp-box:focus-within{border-color:var(--accent-line,var(--accent));box-shadow:0 0 0 3px var(--accent-soft),0 8px 24px -12px rgba(15,23,42,.14)}
.mn-comp textarea{display:block;width:100%;min-height:46px;max-height:240px;resize:none;border:0;outline:0;background:none;box-shadow:none;
  padding:13px 16px 4px;font:inherit;font-size:14.5px;line-height:1.5;color:var(--fg)}
.mn-comp textarea::placeholder{color:var(--text-3,var(--muted))}
.mn-comp-bar{display:flex;align-items:center;gap:6px;padding:6px 8px 8px 10px;min-width:0}
.mn-grow{flex:1}
.mn-chip{display:inline-flex;align-items:center;gap:6px;height:28px;min-width:0;max-width:220px;padding:0 10px;border:1px solid var(--line);border-radius:999px;
  background:none;color:var(--text-2,var(--fg));font:inherit;font-size:12.5px;cursor:pointer;transition:background .15s,border-color .15s}
.mn-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-chip .i{width:14px;height:14px;flex:none;stroke-width:1.9}
.mn-chip:hover:not(.fixed){background:var(--hover);border-color:var(--line-strong)}
.mn-chip.fixed{cursor:default}
.mn-chip em{font-style:normal;color:var(--muted)}
.mn-chip .mn-chip-chev{width:12px;height:12px;transform:rotate(90deg);color:var(--muted)}
.mn-ibtn[hidden],.mn-meter[hidden]{display:none}
.mn-pick{display:flex;flex-direction:column;gap:10px}
.mn-pick-q{display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;border:1px solid var(--line-strong);border-radius:10px}
.mn-pick-q:focus-within{border-color:var(--accent-line,var(--accent))}
.mn-pick-q .i{width:16px;height:16px;color:var(--muted);flex:none}
.mn-pick-q input{flex:1;min-width:0;border:0;outline:0;background:none;box-shadow:none;padding:0;height:100%;font:inherit;font-size:14px}
.mn-pick-l{display:flex;flex-direction:column;gap:2px;max-height:min(50vh,420px);overflow-y:auto}
.mn-pick-i{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:10px;background:none;color:var(--fg);font:inherit;text-align:left;cursor:pointer}
.mn-pick-i:hover,.mn-pick-i:focus-visible{background:var(--hover);outline:none}
.mn-pick-i .i{width:16px;height:16px;flex:none;color:var(--muted)}
.mn-pick-i span{display:flex;flex-direction:column;min-width:0}
.mn-pick-i b{font-size:13.5px;font-weight:560;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-pick-i small{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-pick-ck{display:grid;place-items:center;flex:none;width:20px;height:20px;margin-left:auto;border-radius:6px;border:1.5px solid var(--line-strong);color:transparent;transition:background .14s,border-color .14s,color .14s}
.mn-pick-ck .i{width:13px;height:13px;stroke-width:3;color:inherit}
.mn-pick-i.on{background:var(--accent-soft)}
.mn-pick-i.on .mn-pick-ck{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}
.mn-pick-none{margin:0;padding:12px;font-size:13px;color:var(--muted)}
.mn-chip.warn{color:var(--warn,#d97706);border-color:color-mix(in srgb,var(--warn,#d97706) 40%,transparent)}
.mn-model-slot{display:inline-flex;min-width:0}
.ui-sel.mn-model{height:28px;max-width:min(220px,40vw);padding:0 6px 0 10px;border-radius:999px;border-color:var(--line);background:none;font-size:12.5px;gap:4px}
.ui-sel.mn-model .ui-sel-chev{width:14px;height:14px}
.mn-model-v{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-star{display:grid;place-items:center;color:#f59e0b}.mn-star .i{width:14px;height:14px;fill:currentColor;stroke-width:1.5}
.mn-pdot{width:8px;height:8px;border-radius:50%;background:var(--muted)}
.mn-pdot[data-p=openai]{background:#10a37f}.mn-pdot[data-p=anthropic]{background:#d97757}.mn-pdot[data-p=custom]{background:#6366f1}
.mn-meter{display:inline-grid;place-items:center;width:28px;height:28px;flex:none;padding:0;border:0;border-radius:50%;background:none;cursor:pointer}
.mn-meter:hover{background:var(--hover)}
.mn-meter svg{width:20px;height:20px;transform:rotate(-90deg)}
.mn-meter circle{fill:none;stroke-width:2.6}
.mn-meter .t{stroke:var(--line-strong)}
.mn-meter .v{stroke:var(--accent);stroke-linecap:round;stroke-dasharray:100;stroke-dashoffset:calc(100 - var(--pct,0));transition:stroke-dashoffset .4s var(--ease,ease)}
.mn-meter.hot .v{stroke:var(--warn,#d97706)}
.mn-send{display:grid;place-items:center;width:34px;height:34px;flex:none;border:0;border-radius:50%;cursor:pointer;color:var(--bg);background:var(--fg);
  transition:transform .15s var(--ease,ease),opacity .15s}
.mn-send:hover{transform:scale(1.05)}.mn-send:active{transform:scale(.96)}
.mn-send .i{width:17px;height:17px;stroke-width:2.3}
.mn-chat.busy .mn-send:not(.queue) .i{fill:currentColor;stroke-width:0;width:14px;height:14px}
.mn-send.queue{background:var(--accent);color:var(--on-accent,#fff)}
/* Under the prompt: the fine print on the left, the chat's model and its memory ring on the
   right (the prompt itself keeps the thinking level and Send). */
.mn-under{display:flex;align-items:center;justify-content:flex-start;gap:4px;max-width:var(--mn-col);min-height:0;margin:6px auto 0;padding:0 4px 0 10px}
.mn-fine{flex:1 1 auto;min-width:0;margin:0;font-size:11.5px;color:var(--text-3,var(--muted));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.mn-chat.compact .mn-fine{display:none}
.mn-chat.compact .mn-under{margin-top:4px;padding-left:4px}
.mn-chat.cw-narrow .mn-log{--lp:18px;padding:var(--lp) var(--mn-gut) 8px}.mn-chat.cw-narrow .mn-comp{padding:8px var(--mn-gut) 10px}.mn-chat.cw-narrow .mn-sugs{grid-template-columns:1fr}.mn-chat.cw-narrow .mn-under{padding-left:4px;margin-top:4px}
@media (prefers-reduced-motion:reduce){.mn-u,.mn-turn,.mn-tool,.mn-sug{animation:none}.mn-hello-mark::before,.mn-mark.pulse,.mn-turn.live .mn-av .mn-mark{animation:none}.mn-think i,.mn-think span,.mn-caret{animation:none}}

/* Composer: + attach, chips that grow the box, the model pill once there is something to send. */
.mn-plus{display:grid;place-items:center;flex:none;width:34px;height:34px;padding:0;border:1px solid var(--line);border-radius:50%;background:none;color:var(--fg);cursor:pointer;
  transition:background .15s,transform .2s var(--ease-out,ease-out),border-color .15s}
.mn-plus:hover{background:var(--hover);border-color:var(--line-strong)}
.mn-plus:active{transform:scale(.94)}
.mn-plus .i{width:18px;height:18px;stroke-width:2}
.mn-att{display:grid;grid-template-rows:0fr;transition:grid-template-rows .28s var(--ease-out,ease-out)}
.mn-att.has{grid-template-rows:1fr}
.mn-att-in{overflow:hidden;padding:0 12px;min-height:0}
.mn-att.has .mn-att-in{padding:12px 12px 0}
.mn-att-c{display:inline-flex;align-items:center;gap:6px;height:30px;max-width:240px;padding:0 4px 0 10px;border-radius:10px;font-size:12.5px;color:var(--fg);
  background:color-mix(in srgb,var(--fg) 6%,transparent);border:1px solid var(--line);animation:mnChip .25s var(--ease-out,ease-out) both;animation-delay:calc(var(--i,0) * 30ms)}
.mn-att-c>.i{width:14px;height:14px;flex:none;color:var(--muted)}
.mn-att-c>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-att-c small{flex:none;font-size:11px;color:var(--muted)}
.mn-att-c button{display:grid;place-items:center;flex:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:none;color:var(--muted);cursor:pointer}
.mn-att-c button:hover{background:var(--hover);color:var(--danger)}
.mn-att-c button .i{width:12px;height:12px;stroke-width:2.4}
.mn-att-c.img{padding-left:3px;cursor:zoom-in}
.mn-att-c.img img{width:24px;height:24px;flex:none;border-radius:7px;object-fit:cover}
.mn-att-c.sm{height:26px;font-size:12px;padding:0 9px 0 7px;cursor:default}
.mn-att-c.sm[data-note]{cursor:pointer}.mn-att-c.sm[data-note]:hover{border-color:var(--accent-line,var(--line-strong))}
.mn-att-c.sm.img{padding-left:2px}.mn-att-c.sm.img img{width:22px;height:22px}
.mn-att-c.w>.i{color:var(--accent)}
@keyframes mnChip{from{opacity:0;transform:scale(.9) translateY(4px)}to{opacity:1;transform:none}}
/* At rest the composer is a one-line capsule; focus opens the bar (+, model, meter, send). */
.mn-comp-box{transition:border-color .15s,box-shadow .15s,border-radius .28s var(--ease-out,ease-out)}
.mn-comp-box:not(.open){border-radius:24px;cursor:text}
.mn-comp-box:not(.open) textarea{padding:12px 20px;max-height:46px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.mn-comp textarea{transition:padding .28s var(--ease-out,ease-out)}
.mn-comp-bar{max-height:60px;opacity:1;visibility:visible;transition:max-height .28s var(--ease-out,ease-out),padding .28s var(--ease-out,ease-out),opacity .2s .06s,visibility 0s}
.mn-comp-box:not(.open) .mn-comp-bar{max-height:0;padding-top:0;padding-bottom:0;opacity:0;visibility:hidden;overflow:hidden;
  transition:max-height .24s var(--ease-out,ease-out),padding .24s var(--ease-out,ease-out),opacity .12s,visibility 0s .24s}
.mn-comp-box.drop{border-color:var(--accent);box-shadow:0 0 0 4px var(--accent-soft)}
.mn-u-att{max-width:min(82%,620px);min-width:0}
/* One sliding row of chips (no scrollbar); arrows fade in where there is more. */
.mn-car{position:relative;min-width:0}
.mn-car-row{display:flex;gap:6px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x proximity;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:2px 0}
.mn-car-row::-webkit-scrollbar{display:none}
.mn-car-row>*{flex:none;scroll-snap-align:start}
.mn-u-att .mn-car-row{justify-content:flex-start}
.mn-u-att .mn-car:not(.more-l):not(.more-r) .mn-car-row{justify-content:flex-end}
.mn-car-a{position:absolute;top:50%;z-index:2;display:grid;place-items:center;width:26px;height:26px;padding:0;border:1px solid var(--line-strong);border-radius:50%;
  background:var(--panel,var(--surface-1));color:var(--fg);box-shadow:0 4px 12px -4px rgba(15,23,42,.25);cursor:pointer;opacity:0;pointer-events:none;
  transform:translateY(-50%) scale(.85);transition:opacity .15s,transform .15s}
.mn-car-a .i{width:14px;height:14px;stroke-width:2.2}
.mn-car-a.l{left:-4px}.mn-car-a.r{right:-4px}
.mn-car.more-l .mn-car-a.l,.mn-car.more-r .mn-car-a.r{opacity:1;pointer-events:auto;transform:translateY(-50%)}
.mn-car.more-l .mn-car-row{-webkit-mask-image:linear-gradient(90deg,transparent,#000 28px);mask-image:linear-gradient(90deg,transparent,#000 28px)}
.mn-car.more-r .mn-car-row{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent)}
.mn-car.more-l.more-r .mn-car-row{-webkit-mask-image:linear-gradient(90deg,transparent,#000 28px,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,transparent,#000 28px,#000 calc(100% - 28px),transparent)}
@media (hover:none){.mn-car-a{display:none}}
/* A picture that came with a message: a tile, tap for the full view. */
.mn-u-img{position:relative;display:block;width:76px;height:76px;padding:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:color-mix(in srgb,var(--fg) 6%,transparent);cursor:zoom-in}
.mn-u-img img{display:block;width:100%;height:100%;object-fit:cover}
.mn-u-img span{display:none}
.mn-u-img.gone{cursor:default}.mn-u-img.gone img{display:none}
.mn-u-img.gone span{display:flex;align-items:center;justify-content:center;height:100%;padding:6px;font-size:10.5px;color:var(--muted);text-align:center;word-break:break-all}

/* Activity: what Mnemo thinks and does, live, then a summary. */
.mn-act{border:1px solid var(--line);border-radius:14px;background:var(--surface-1,var(--panel));overflow:clip;animation:mnIn .25s var(--ease-out,ease-out) both}
.mn-act>summary{display:flex;align-items:center;gap:10px;min-height:44px;padding:7px 12px 7px 10px;cursor:pointer;list-style:none;user-select:none}
.mn-act>summary::-webkit-details-marker{display:none}
.mn-act>summary:hover{background:var(--hover)}
.mn-act-ic{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:8px;color:var(--accent);background:var(--accent-soft)}
.mn-act-ic .i{width:15px;height:15px;stroke-width:2.2}
.mn-act.bad .mn-act-ic{color:var(--warn,#d97706);background:color-mix(in srgb,var(--warn,#d97706) 12%,transparent)}
.mn-act-t{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.mn-act-t b{font-size:calc(var(--mn-fs,14.5px) - 1.5px);font-weight:620}
.mn-act-t small{font-size:calc(var(--mn-fs,14.5px) - 2.5px);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-act.live .mn-act-t b{background:linear-gradient(90deg,var(--fg) 30%,var(--accent) 50%,var(--fg) 70%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:mnShine 1.8s linear infinite}
.mn-act-chev{width:14px;height:14px;flex:none;color:var(--muted);transition:transform .18s var(--ease,ease)}
.mn-act[open]>summary .mn-act-chev{transform:rotate(90deg)}
.mn-act-b{display:flex;flex-direction:column;gap:8px;padding:2px 12px 12px}
.mn-act .mn-tools{display:flex;flex-direction:column;gap:6px;position:relative;padding-left:14px;border-left:2px solid var(--line)}
.mn-thought{font-size:calc(var(--mn-fs,14.5px) - 1.5px);line-height:1.6;color:var(--text-2,var(--muted))}
.mn-thought-t{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow-y:auto}
.mn-act:not(.live) .mn-thought-t{max-height:none}
.mn-seg-end{display:none}
.mn-act-notes{display:flex;flex-direction:column;gap:6px}
.mn-act-notes>div{display:flex;flex-wrap:wrap;align-items:center;gap:5px}
.mn-act-notes b{font-size:11.5px;font-weight:600;color:var(--muted);margin-right:4px}
.mn-act-notes small{font-size:11.5px;color:var(--muted)}
.mn-act-notes:empty{display:none}
@media (prefers-reduced-motion:reduce){.mn-att,.mn-comp-box,.mn-comp textarea,.mn-comp-bar{transition:none!important}.mn-att-c,.mn-act{animation:none}.mn-act.live .mn-act-t b{animation:none;color:var(--fg);background:none}}

/* Pin: the model new chats use (web and TUI). */
.mn-pin{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:50%;background:none;color:var(--muted);cursor:pointer;transition:background .15s,color .15s}
.mn-pin[hidden]{display:none}
.mn-pin:hover{background:var(--hover);color:var(--fg)}
.mn-pin .i{width:15px;height:15px;stroke-width:2;transform:rotate(35deg);transition:transform .2s var(--ease-out,ease-out)}
.mn-pin.on{color:var(--accent)}
.mn-pin.on .i{transform:none;fill:currentColor}

/* Scrolling: the log fades out under its edges, like a timeline. */
.mn-log{--fa0:0px;--fa:0px;--fb:0px;-webkit-mask-image:linear-gradient(to bottom,transparent 0,transparent var(--fa0),#000 var(--fa),#000 calc(100% - var(--fb)),transparent 100%);
  mask-image:linear-gradient(to bottom,transparent 0,transparent var(--fa0),#000 var(--fa),#000 calc(100% - var(--fb)),transparent 100%)}
/* Scrolled down: what passes under the model pill and the top buttons fades away before it
   reaches them, so the pill never sits on top of text. */
.mn-chat.fade-top .mn-log{--fa0:40px;--fa:84px}
@media (pointer:coarse){.mn-chat.fade-top .mn-log{--fa0:44px;--fa:88px}}
.mn-chat.fade-bot .mn-log{--fb:28px}

/* Timeline rail, right: one bar per question at a fixed spacing; the one in view is longer and darker.
   More bars than fit: a window of them glides with the chat, fading at the edge that hides more. */
.mn-rail{position:absolute;top:50%;right:2px;z-index:3;display:block;padding:6px 0;width:40px;
  transform:translateY(-50%);touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;cursor:pointer}
.mn-rail[hidden]{display:none}
.mn-rwin{position:relative;height:var(--rwin,120px);overflow:hidden;--mt:0px;--mb:0px;
  -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 var(--mt),#000 calc(100% - var(--mb)),transparent 100%);
  mask-image:linear-gradient(to bottom,transparent 0,#000 var(--mt),#000 calc(100% - var(--mb)),transparent 100%)}
.mn-rwin.more-top{--mt:28px}
.mn-rwin.more-bot{--mb:28px}
.mn-rtrack{display:flex;flex-direction:column;align-items:flex-end;will-change:transform;transition:transform .18s var(--ease-out,ease-out)}
.mn-rail.scrub .mn-rtrack{transition-duration:.07s}
.mn-rb{position:relative;display:flex;align-items:center;justify-content:flex-end;width:40px;height:var(--rh,8px);padding:0 8px 0 6px;border:0;background:none;cursor:pointer;flex:none;pointer-events:none}
.mn-rb i{display:block;width:calc(var(--w,12px) * var(--m,1));height:2px;border-radius:2px;background:var(--line-strong);
  transition:width .14s cubic-bezier(.2,.9,.3,1.3),background .12s,height .12s}
.mn-rb.on i{background:var(--fg);width:calc((var(--w,12px) + 8px) * var(--m,1));height:3px}
.mn-rb.hot i{background:var(--accent);height:3px}
.mn-rail.scrub .mn-rb i{background:color-mix(in srgb,var(--fg) 45%,transparent)}
.mn-rail.scrub .mn-rb.hot i{background:var(--accent)}
/* The knob: where the view is in the whole chat, like a scrollbar thumb. */
.mn-rknob{position:absolute;top:6px;right:1px;width:3px;height:18px;border-radius:3px;background:color-mix(in srgb,var(--fg) 30%,transparent);pointer-events:none;
  transition:transform .12s linear,background .15s}
.mn-rail:hover .mn-rknob,.mn-rail.scrub .mn-rknob{background:color-mix(in srgb,var(--fg) 50%,transparent)}
@media (prefers-reduced-motion:reduce){.mn-rtrack,.mn-rknob,.mn-rb i{transition:none}}
.mn-rlab{position:absolute;right:calc(100% + 2px);top:50%;transform:translate(8px,-50%);display:flex;gap:7px;align-items:baseline;max-width:min(260px,70vw);padding:6px 10px;border-radius:10px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px;color:var(--fg);background:var(--panel,var(--surface-1));border:1px solid var(--line-strong);
  box-shadow:0 10px 28px -12px rgba(15,23,42,.35);opacity:0;pointer-events:none;transition:opacity .12s,transform .16s var(--ease-out,ease-out),top .08s linear}
.mn-rlab b{flex:none;font-size:11px;font-weight:650;color:var(--accent);font-variant-numeric:tabular-nums}
.mn-rlab.in{opacity:1;transform:translate(0,-50%)}
/* The timeline needs room on the right: the gutter grows on both sides of the log AND the
   composer, so their edges still match. */
.mn-chat.has-rail{--mn-gut:44px}
/* Phones: no avatar beside Mnemo's replies, so they and the questions use the full width between equal margins;
   the timeline narrows into the right margin instead of taking a column of its own. */
/* A narrow chat (a phone, or a desktop chat squeezed by its side panes): the same, by the
   chat's own width. */
.mn-chat.cw-narrow:not(.compact),.mn-chat.cw-narrow.has-rail:not(.compact){--mn-gut:12px}
.mn-chat.cw-narrow .mn-ub{max-width:88%}
  /* The bars stay thin, but the finger gets a wider strip to land on. */
.mn-chat.cw-narrow .mn-rail{right:0;width:28px}
.mn-chat.cw-narrow .mn-rb{width:28px;padding:0 5px 0 1px}
.mn-chat.cw-narrow .mn-rknob{right:0;width:2.5px;height:14px}
.mn-chat.cw-narrow .mn-rb i{width:calc(var(--w,12px) * .45 * var(--m,1))}
.mn-chat.cw-narrow .mn-rb.on i{width:10px}

/* Chat memory popover (the ring in the composer). */
.mn-cx{position:fixed;z-index:120;display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:16px;background:var(--panel,var(--surface-1));-webkit-backdrop-filter:none;backdrop-filter:none;border:1px solid var(--line-strong);
  box-shadow:0 24px 60px -20px rgba(15,23,42,.35),0 8px 20px -10px rgba(15,23,42,.18);font-size:13px;animation:mnIn .18s var(--ease-out,ease-out) both}
.mn-cx-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.mn-cx-h b{font-size:14px;font-weight:650}
.mn-cx-h small{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-cx-bar{position:relative;height:8px;border-radius:99px;background:color-mix(in srgb,var(--fg) 8%,transparent);overflow:visible}
.mn-cx-bar i{position:absolute;inset:0 auto 0 0;width:var(--p);border-radius:inherit;background:var(--accent);transition:width .3s}
.mn-cx-bar u{position:absolute;top:-3px;bottom:-3px;left:var(--c);width:2px;border-radius:2px;background:var(--warn,#d97706)}
.mn-cx-n{color:var(--text-2,var(--fg))}.mn-cx-n b{font-weight:650;color:var(--fg)}
.mn-cx p{margin:0;color:var(--muted);line-height:1.5;font-size:12.5px}
.mn-cx-k{display:flex;align-items:center;gap:6px}.mn-cx-k .i{width:14px;height:14px;flex:none}
.mn-cx-a{display:flex;gap:8px;flex-wrap:wrap}
.mn-cx-a .btn{flex:1;justify-content:center}

/* Cards Mnemo hands over (show_items): notes, folders, images, the vault. */
/* Everything a reply hands over (notes, boards, images, pages) stacks in one column, each card as
   wide as the bubble: heights may differ, the edges line up. */
.mn-cards{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin:8px 0 2px;animation:mnIn .2s var(--ease-out,ease-out) both}
.mn-card{display:flex;align-items:center;gap:10px;min-width:0;padding:9px 10px 9px 9px;border:1px solid var(--line);border-radius:12px;background:var(--panel,var(--surface-1));
  color:var(--fg);font:inherit;text-align:left;cursor:pointer;transition:border-color .15s,background .15s,transform .15s}
.mn-card:hover{border-color:var(--accent-line,var(--line-strong));background:color-mix(in srgb,var(--accent) 5%,var(--panel,var(--surface-1)))}
.mn-card:active{transform:scale(.98)}
.mn-card-ic{display:grid;place-items:center;flex:none;width:34px;height:34px;border-radius:9px;color:var(--accent);background:var(--accent-soft)}
.mn-card-ic .i{width:17px;height:17px}
.mn-card.k-folder .mn-card-ic{color:#d97706;background:color-mix(in srgb,#d97706 12%,transparent)}
.mn-card.k-vault .mn-card-ic{color:#6366f1;background:color-mix(in srgb,#6366f1 12%,transparent)}
.mn-card-img{flex:none;width:44px;height:44px;border-radius:9px;overflow:hidden;background:color-mix(in srgb,var(--fg) 6%,transparent)}
.mn-card-img img{display:block;width:100%;height:100%;object-fit:cover}
.mn-card-img.broken img{display:none}
.mn-card-t{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.mn-card-t b{font-size:calc(var(--mn-fs,14.5px) - 1px);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-card-t small{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-card-go{width:14px;height:14px;flex:none;color:var(--muted)}

.mn-card-x{margin-top:2px;white-space:normal!important;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--text-2,var(--muted))!important;line-height:1.35}
.mn-card-x[hidden]{display:none}
.mn-att-c.is-kb{border-color:color-mix(in srgb,var(--mn-kb) 40%,var(--line))}
.mn-att-c.is-kb>.i,.mn-att-c.is-kb.w>.i{color:var(--mn-kb)}

/* A board in the chat: a card with its lanes as bars that opens into the live board. */
/* Board previews are cards like note cards: a grid of cards, never wider than the bubble. */
/* Cards keep the neutral border at rest; the board accent shows on hover, keyboard focus and
   (softly) while a board list is open. */
@media (hover:hover){.mn-kb:hover,.mn-cw:hover>.mn-card,.mn-cw:hover>.mn-nbd{border-color:color-mix(in srgb,var(--mn-kb) 45%,var(--line))}}
.mn-kb:has(:focus-visible),.mn-cw:has(:focus-visible)>:is(.mn-card,.mn-nbd){border-color:color-mix(in srgb,var(--mn-kb) 55%,var(--line))}
.mn-cw:has(>.mn-nbd[open])>:is(.mn-card,.mn-nbd){border-color:color-mix(in srgb,var(--mn-kb) 22%,var(--line))}
.mn-kbs{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin:8px 0 2px;min-width:0}
.mn-shown>.mn-cards+.mn-kbs{margin-top:8px}
.mn-shown>.mn-kbs{margin-top:8px}
.mn-kb{min-width:0;border:1px solid var(--line);border-radius:14px;background:var(--panel,var(--surface-1));
  overflow:hidden;animation:mnIn .2s var(--ease-out,ease-out) both}
.mn-kb-h{display:flex;align-items:center;gap:10px;padding:9px 10px 9px 9px;min-width:0}
.mn-kb-ic{display:grid;place-items:center;flex:none;width:34px;height:34px;border-radius:9px;color:var(--mn-kb);
  background:color-mix(in srgb,var(--mn-kb) 13%,transparent)}
.mn-kb-ic .i{width:18px;height:18px}
.mn-kb-t{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:2px 4px;border:0;border-radius:8px;
  background:none;color:var(--fg);font:inherit;text-align:start;cursor:pointer}
@media (hover:hover){.mn-kb-t:hover{background:var(--hover)}}
.mn-kb-t:active{background:var(--hover)}
.mn-kb-t:focus-visible{outline:2px solid var(--mn-kb);outline-offset:1px}
.mn-kb-n{display:flex;align-items:center;gap:5px;min-width:0;max-width:100%}
.mn-kb-n b{font-size:calc(var(--mn-fs,14.5px) - 1px);font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-kb-sub{font-size:11.5px;color:var(--muted);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
.mn-kb-bars{display:block;height:4px;width:min(220px,100%);border-radius:99px;background:color-mix(in srgb,var(--fg) 8%,transparent);overflow:hidden}
.mn-kb-bars:empty{display:none}
/* One track per lane: a neutral track, filled in proportion to the largest lane (an empty lane stays empty). */
.mn-kb-bars i{display:block;height:100%;border-radius:inherit;background:color-mix(in srgb,var(--mn-kb) 65%,transparent)}
/* The way in: a chevron like a note card's (the whole header opens the board too). */
.mn-kb-open{flex:none;display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:none;color:var(--muted);cursor:pointer}
@media (hover:hover){.mn-kb-open:hover{background:var(--hover);color:var(--fg)}}
.mn-kb-open:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.mn-kb-open .i{width:14px;height:14px}
/* A glimpse of the first cards per lane: still text, nothing to drag or tick. */
/* The glimpse: lanes side by side, sliding sideways inside the card (no scrollbar, edges fade). */
.mn-kb-peek{display:flex;gap:6px;margin:0 10px 10px 52px;min-width:0;overflow-x:auto;overscroll-behavior-x:contain}
.mn-kb-peek>.mn-kb-pl{flex:0 0 200px;width:200px}
[dir=rtl] .mn-kb-peek{margin:0 52px 10px 10px}
@media (max-width:640px){.mn-kb-peek{margin-inline-start:10px}.mn-kb-peek>.mn-kb-pl{flex-basis:min(200px,70vw);width:min(200px,70vw)}}
.mn-kb-pl>*{min-width:0;max-width:100%}
.mn-kb-pmore{grid-column:1/-1;font-size:11.5px;color:var(--muted)}
.mn-kb-peek[hidden]{display:none}
.mn-kb-pl{display:flex;flex-direction:column;gap:4px;min-width:0;padding:8px;border-radius:10px;background:color-mix(in srgb,var(--fg) 4%,transparent)}
.mn-kb-plh{display:flex;align-items:center;gap:6px;min-width:0;font-size:11.5px;font-weight:650;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-kb-plh em{font-style:normal;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}
.mn-kb-pc{font-size:12.5px;line-height:1.35;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 7px;border-radius:7px;
  background:var(--panel,var(--surface-1));border:1px solid var(--line)}
.mn-kb-pc.done{color:var(--muted);text-decoration:line-through}
.mn-kb-pm{font-size:11.5px;color:var(--muted);padding-inline:2px}
.mn-kb-refs:empty{display:none}
.mn-kb-refs{padding:0 10px 8px 56px;min-width:0}
[dir=rtl] .mn-kb-refs{padding:0 56px 8px 10px}
.mn-kb-refs .kbr{margin:0}
.mn-kb-refs .kbr>summary{padding-inline:0}
/* A note that puts boards in: a small board badge, and a folded list of its boards. */
.mn-nb{display:inline-flex;align-items:center;gap:3px;margin-inline-start:6px;padding:0 6px;height:18px;border-radius:9px;font-style:normal;font-size:11px;font-weight:650;
  color:var(--mn-kb);background:color-mix(in srgb,var(--mn-kb) 13%,transparent);flex:none;font-variant-numeric:tabular-nums}
.mn-nb .i{width:11px;height:11px}
.mn-card-t .mn-nb{margin:2px 0 0;align-self:flex-start}
/* A note card with boards: the list of its boards folds out right under it, at its width. */
.mn-cw{display:flex;flex-direction:column;min-width:0}
.mn-cw>.mn-card:has(+.mn-nbd){border-bottom-left-radius:0;border-bottom-right-radius:0}
.mn-nbd{border:1px solid var(--line);border-top:0;border-radius:0 0 12px 12px;background:var(--panel,var(--surface-1));overflow:hidden;min-width:0}
.mn-nbd>summary{display:flex;align-items:center;gap:8px;min-height:38px;padding:0 12px 0 52px;cursor:pointer;list-style:none;font-size:13px;color:var(--text-2);min-width:0;white-space:nowrap}
.mn-nbd>summary>span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
[dir=rtl] .mn-nbd>summary{padding:0 52px 0 12px}
.mn-nbd>summary::-webkit-details-marker{display:none}
.mn-nbd>summary em{font-style:normal;margin-inline-start:auto;color:var(--mn-kb);font-weight:650}
.mn-nbr{display:flex;align-items:center;gap:10px;width:100%;min-width:0;min-height:44px;padding:6px 12px;border:0;border-top:1px solid var(--line);background:none;color:var(--fg);font:inherit;text-align:start;cursor:pointer}
@media (hover:hover){.mn-nbr:hover{background:var(--hover)}}
.mn-nbr>.i{width:16px;height:16px;color:var(--mn-kb);flex:none}
.mn-nbr-t{flex:1;min-width:0;display:flex;flex-direction:column}
.mn-nbr-t b{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-nbr-t small{font-size:11.5px;color:var(--muted)}
.mn-nbr .mn-kb-bars{width:72px;flex:none}
.mn-nbr{padding-inline-start:52px}
@media (prefers-reduced-motion:reduce){.mn-kb{animation:none}}

/* Under a reply: what it changed, showed and read. */
.mn-rel{display:flex;align-items:center;gap:8px;margin-top:10px;min-width:0}
.mn-rel-h{flex:none;font-size:11.5px;font-weight:600;color:var(--muted)}
.mn-rel .mn-car{flex:1}
.mn-rel .mn-att-c{cursor:pointer}
.mn-rel .mn-att-c:hover{border-color:var(--accent-line,var(--line-strong))}
.mn-rel-more{align-self:center;padding:0 6px;font-size:11.5px;color:var(--muted)}

/* Scrollbars in Mnemo (chat, message box, chat list): a thin rounded thumb that shows only
   while scrolling (or under the pointer) and fades away after. The track always keeps its
   width, so nothing shifts when it appears. */
:is(.mn-log,.mnp-list,.mnp-art-b,.mnp-act,.mn-comp textarea){--sb:transparent}
:is(.mn-log,.mnp-list,.mnp-art-b,.mnp-act,.mn-comp textarea).sb-on{--sb:color-mix(in srgb,var(--fg) 24%,transparent)}
@supports not selector(::-webkit-scrollbar){
  :is(.mn-log,.mnp-list,.mnp-art-b,.mnp-act,.mn-comp textarea){scrollbar-width:thin;scrollbar-color:var(--sb) transparent;transition:scrollbar-color .3s}
}
:is(.mn-log,.mnp-list,.mnp-art-b,.mnp-act,.mn-comp textarea)::-webkit-scrollbar{width:8px;height:8px;background:transparent}
:is(.mn-log,.mnp-list,.mnp-art-b,.mnp-act,.mn-comp textarea)::-webkit-scrollbar-track{background:transparent}
:is(.mn-log,.mnp-list,.mnp-art-b,.mnp-act,.mn-comp textarea)::-webkit-scrollbar-thumb{border-radius:99px;border:2px solid transparent;background:var(--sb) padding-box;min-height:28px}
:is(.mn-log,.mnp-list,.mnp-art-b,.mnp-act,.mn-comp textarea)::-webkit-scrollbar-thumb:hover{background-color:color-mix(in srgb,var(--fg) 34%,transparent)}
:is(.mn-log,.mnp-list,.mnp-art-b,.mnp-act,.mn-comp textarea)::-webkit-scrollbar-thumb:active{background-color:color-mix(in srgb,var(--fg) 42%,transparent)}
:is(.mn-log,.mnp-list,.mnp-art-b,.mnp-act,.mn-comp textarea)::-webkit-scrollbar-button,:is(.mn-log,.mnp-list,.mnp-art-b,.mnp-act,.mn-comp textarea)::-webkit-scrollbar-corner{display:none;background:transparent}

/* The prompt box scrolls without a bar: its edges fade where there is more text. */
.mn-comp textarea{scrollbar-width:none;--ta-ft:0px;--ta-fb:0px;
  -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 var(--ta-ft),#000 calc(100% - var(--ta-fb)),transparent 100%);
  mask-image:linear-gradient(to bottom,transparent 0,#000 var(--ta-ft),#000 calc(100% - var(--ta-fb)),transparent 100%)}
.mn-comp textarea::-webkit-scrollbar{display:none}
.mn-comp textarea.ft{--ta-ft:18px}
.mn-comp textarea.fb{--ta-fb:18px}

/* A question from Mnemo: options to tap, and Other. */
/* A question from Mnemo: the question on a tinted band (who asks, then the question in
   larger type), the answers below on the plain card as separate rows to tap. */
.mn-ask{margin:10px 0 4px;padding:0;overflow:hidden;border:1px solid var(--line-strong);border-radius:16px;background:var(--surface-0,var(--bg));
  box-shadow:0 10px 28px -22px rgba(15,23,42,.45)}
.mn-ask-h{padding:13px 16px 14px;border-bottom:1px solid var(--accent-line,var(--line));background:color-mix(in srgb,var(--accent) 9%,var(--surface-0,var(--bg)))}
.mn-ask-ey{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11.5px;font-weight:650;letter-spacing:.02em;color:var(--accent)}
.mn-ask-ey .i{width:15px;height:15px;flex:none}
.mn-ask-q{margin:0;font-size:calc(var(--mn-fs,14.5px) + 1px);font-weight:600;line-height:1.5;color:var(--fg);overflow-wrap:anywhere;white-space:pre-wrap}
.mn-ask-o{display:flex;flex-direction:column;gap:6px;padding:10px}
.mn-ask-b{display:flex;align-items:flex-start;gap:11px;width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--panel,var(--surface-1));
  color:var(--fg);font:inherit;text-align:left;cursor:pointer;transition:border-color .15s,background .15s,transform .12s}
.mn-ask-b:hover:not(:disabled){border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,var(--panel,var(--surface-1)))}
.mn-ask-b:active:not(:disabled){transform:scale(.99)}
.mn-ask-n{display:grid;place-items:center;flex:none;width:22px;height:22px;margin-top:1px;border-radius:7px;background:var(--surface-2,color-mix(in srgb,var(--fg) 7%,transparent));
  color:var(--muted);font-size:12px;font-weight:600}
.mn-ask-n .i{width:13px;height:13px}
.mn-ask-c{display:flex;flex-direction:column;gap:2px;min-width:0}
.mn-ask-b b{font-size:calc(var(--mn-fs,14.5px) - 1px);font-weight:550;line-height:1.4;color:var(--text-2,var(--fg))}
.mn-ask-b:hover:not(:disabled) b{color:var(--fg)}
.mn-ask-b small{font-size:calc(var(--mn-fs,14.5px) - 2.5px);color:var(--muted);line-height:1.4}
.mn-ask-b.ok b::before{content:"✓ ";color:var(--accent)}
.mn-ask-b.other{border-style:dashed}
.mn-ask-b.on .mn-ask-n{background:var(--accent);color:var(--on-accent,#fff)}
.mn-ask-f{display:flex;gap:6px;align-items:center;padding:4px 4px 4px 12px;border:1px solid var(--accent);border-radius:11px;background:var(--panel,var(--surface-1))}
.mn-ask-f[hidden]{display:none}
.mn-ask-f input{flex:1;min-width:0;height:32px;border:0;outline:0;background:none;color:var(--fg);font:inherit;font-size:14px}
.mn-ask-f .mn-ibtn{background:var(--accent);color:var(--on-accent,#fff);border-radius:8px}
.mn-ask-skip{margin-inline-start:auto;letter-spacing:0;flex:none;padding:1px 8px;border-radius:999px;background:var(--surface-2,color-mix(in srgb,var(--fg) 7%,transparent));color:var(--muted);font-size:11.5px;font-style:normal;font-weight:500}
.mn-ask.done .mn-ask-b{cursor:default;opacity:.55}
.mn-ask.done .mn-ask-b.on{opacity:1;border-color:var(--accent);background:var(--accent-soft)}
.mn-ask.skipped{border-color:var(--line);box-shadow:none}
.mn-ask.skipped .mn-ask-h{background:none;border-bottom-color:var(--line)}
.mn-ask.skipped :is(.mn-ask-q,.mn-ask-ey){color:var(--muted)}
/* Permission picker in the composer: Ask first (accent), Auto (warm), Read only (neutral). */
.mn-perm-slot{display:inline-flex;min-width:0}
.mn-perm-slot[hidden]{display:none}
.ui-sel.mn-perm{padding:0 6px 0 8px;gap:5px;white-space:nowrap;transition:background .15s,border-color .15s,color .15s}
.ui-sel.mn-perm>.i{width:14px;height:14px;flex:none}
.ui-sel.mn-perm .ui-sel-chev{stroke:currentColor;opacity:.7}
.ui-sel.mn-perm.p-ask{color:var(--accent);border-color:var(--accent-line,color-mix(in srgb,var(--accent) 40%,transparent));background:var(--accent-soft)}
.ui-sel.mn-perm.p-auto{color:var(--warn,#d97706);border-color:color-mix(in srgb,var(--warn,#d97706) 45%,transparent);background:color-mix(in srgb,var(--warn,#d97706) 9%,transparent)}
.ui-sel.mn-perm.p-read{color:var(--text-2,var(--fg));border-color:var(--line-strong);background:color-mix(in srgb,var(--fg) 5%,transparent)}
.ui-sel.mn-perm:hover{filter:brightness(.98)}
.mn-perm-ld{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;color:var(--muted);background:color-mix(in srgb,var(--fg) 6%,transparent)}
.mn-perm-ld .i{width:15px;height:15px}
@media (max-width:640px){.ui-sel.mn-perm .mn-model-v{display:none}.ui-sel.mn-perm{padding:0 5px 0 7px}}

/* Mnemo's replies sit on a frosted card, readable over any background. */
.mn-turn .mn-tb{min-width:0;padding:12px 14px;border-radius:16px;border:1px solid color-mix(in srgb,var(--line) 75%,transparent);
  background:color-mix(in srgb,var(--panel,var(--surface-1)) 70%,transparent);-webkit-backdrop-filter:blur(12px) saturate(1.2);backdrop-filter:blur(12px) saturate(1.2)}
@media (max-width:640px){.mn-turn .mn-tb{padding:10px 12px}}
/* The chat scrolls without a bar: the timeline and the edge fades show where you are. */
.mn-log{scrollbar-width:none}
.mn-log::-webkit-scrollbar{display:none!important}
/* The queue above the prompt, and messages that steered a running reply. */
.mn-queue{display:flex;flex-direction:column;gap:2px;padding:8px 8px 8px}
.mn-queue-h{display:flex;align-items:center;gap:6px;min-height:28px;padding:0 0 2px 6px;font-size:12px;font-weight:600;color:var(--muted)}
.mn-queue-h .i{width:13px;height:13px}
.mn-q-i{display:flex;align-items:center;gap:10px;min-height:32px;padding:1px 2px 1px 6px;border-radius:9px;cursor:grab;transition:background .15s}
.mn-q-i:hover{background:var(--hover)}
.mn-q-n{flex:none;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:10.5px;font-weight:700;color:var(--accent);background:var(--accent-soft)}
.mn-q-t{flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-q-t small{color:var(--muted)}
.mn-q-a{display:inline-flex;gap:0;flex:none}
.mn-q-a .mn-ibtn{width:26px;height:26px}
.mn-q-a [data-qa=up] .i{transform:rotate(-90deg)}.mn-q-a [data-qa=down] .i{transform:rotate(90deg)}
.mn-q-a [data-qa=steer]{color:var(--accent)}
.mn-q-a .mn-ibtn:disabled{opacity:.3;cursor:default}
.mn-q-a [data-qa=send]{color:var(--accent)}
.mn-queue-ht{display:inline-flex;align-items:center;gap:6px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-queue-ht .i{width:13px;height:13px;flex:none}
.mn-queue-ht.warn{color:var(--warn,#d97706)}
.mn-qh-b{display:inline-flex;align-items:center;gap:4px;flex:none;height:22px;padding:0 8px;border:1px solid var(--line);border-radius:99px;background:none;color:var(--muted);font:inherit;font-size:11.5px;font-weight:550;cursor:pointer}
.mn-qh-b:hover{color:var(--fg);border-color:var(--line-strong)}
.mn-qh-b .i{width:12px;height:12px}
.mn-qh-b.acc{color:var(--accent);border-color:var(--accent-line,var(--accent))}
.mn-q-list{display:flex;flex-direction:column;gap:2px;max-height:106px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
.mn-q-list.all{max-height:min(46vh,420px)}
.mn-q-list.fb{-webkit-mask-image:linear-gradient(#000 calc(100% - 26px),transparent);mask-image:linear-gradient(#000 calc(100% - 26px),transparent)}
.mn-q-list.ft{-webkit-mask-image:linear-gradient(transparent,#000 22px);mask-image:linear-gradient(transparent,#000 22px)}
.mn-q-list.ft.fb{-webkit-mask-image:linear-gradient(transparent,#000 22px,#000 calc(100% - 26px),transparent);mask-image:linear-gradient(transparent,#000 22px,#000 calc(100% - 26px),transparent)}
.mn-notice.cut{align-self:flex-start;padding:3px 10px 3px 8px;border:1px dashed var(--line-strong);border-radius:99px;font-size:12px}
.mn-notice.fb{color:var(--warn,#d97706)}
.mn-notice b{font-weight:600;color:var(--fg)}
.mn-md.mn-cut{opacity:.5;text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--fg) 35%,transparent)}
.mn-compact-live-b{align-self:stretch;max-height:220px;overflow:auto;margin:2px 0 4px;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--fg) 2.5%,transparent);font-size:13px;color:var(--fg);-webkit-mask-image:linear-gradient(transparent,#000 18px);mask-image:linear-gradient(transparent,#000 18px)}
.mn-modelchg{display:flex;align-items:center;gap:10px;align-self:stretch;margin:6px auto;font-size:12px;color:var(--muted)}
.mn-modelchg::before,.mn-modelchg::after{content:"";flex:1 1 0;min-width:12px;height:1px;background:var(--line)}
.mn-modelchg span{flex:none;display:inline-flex;align-items:center;gap:6px;max-width:86%;padding:3px 12px;border-radius:99px;border:1px solid var(--line);background:var(--bg);white-space:nowrap;overflow:hidden}
.mn-modelchg b{font-weight:600;color:var(--fg)}
.mn-modelchg em{font-style:normal;overflow:hidden;text-overflow:ellipsis}
.mn-modelchg .i{width:13px;height:13px;flex:none}
.mn-modelchg.fb span{border-color:color-mix(in srgb,var(--warn,#d97706) 45%,var(--line));color:var(--warn,#d97706)}
.mn-tb .mn-modelchg{margin:10px 0}
.mn-think-slot{display:inline-flex;min-width:0}
.mn-sub-model{display:inline-flex;align-items:center;gap:3px;padding:0 4px 0 6px;height:20px;border:1px solid var(--line);border-radius:999px;background:none;color:var(--text-2,var(--fg));
  font:inherit;font-size:11.5px;cursor:pointer;transition:border-color .12s,background .12s}
.mn-sub-model:hover{border-color:var(--line-strong);background:var(--hover)}
.mn-sub-model .i{width:12px;height:12px}
.ui-sel.mn-sub-sel{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
/* A notice with something to do about it (set a model for a job, switch this chat's model). */
.mn-notice{flex-wrap:wrap}
.mn-notice-a{flex:none;height:26px;padding:0 11px;border:1px solid var(--accent-line,var(--line-strong));border-radius:999px;background:var(--accent-soft);color:var(--accent);
  font:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:background .15s}
.mn-notice-a:hover{background:color-mix(in srgb,var(--accent) 16%,transparent)}
.mn-notice-a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mn-think{flex-wrap:wrap;height:auto;min-height:26px}
.ui-sel.mn-think{max-width:120px}
.ui-sel.mn-think>.i{width:14px;height:14px;flex:none;color:var(--accent)}
.mn-send.stopping{opacity:.55;animation:mnPulse 1s ease-in-out infinite}
.mn-steer{display:flex;align-items:flex-start;gap:7px;align-self:flex-end;max-width:85%;margin:8px 0;padding:7px 11px;border-radius:12px 12px 4px 12px;
  font-size:calc(var(--mn-fs,14.5px) - 1.5px);color:var(--fg);background:var(--accent-soft);border:1px solid var(--accent-line,transparent)}
.mn-steer .i{width:13px;height:13px;flex:none;margin-top:3px;color:var(--accent)}

/* An open section keeps its header in view while you scroll through it, so it can be closed
   from anywhere (overflow: clip above, not hidden, lets the headers stick to the chat).
   Sticky offsets count from inside the chat's top padding (--lp), so they start at minus it:
   the header sits at the very top edge and nothing scrolls past above it. */
.mn-act>summary{box-sizing:border-box;height:52px;min-height:52px}
.mn-act[open]>summary{position:sticky;top:calc(0px - var(--lp,0px));z-index:4;background:var(--surface-1,var(--panel));border-bottom:1px solid var(--line);
  box-shadow:0 8px 14px -12px rgba(15,23,42,.35)}
/* A step's header sticks right under the Activity header (52px), with nothing showing between. */
.mn-tool[open]>summary{position:sticky;top:calc(52px - var(--lp,0px));z-index:3;background:var(--surface-1,var(--panel));border-bottom:1px solid var(--line);
  box-shadow:0 0 0 1px var(--surface-1,var(--panel)),0 8px 14px -12px rgba(15,23,42,.3)}
.mn-tools{padding-top:0}
.mn-compact[open]>summary{position:sticky;top:calc(0px - var(--lp,0px));z-index:2;padding:4px 0;background:var(--bg)}

/* A search hit opened in the chat. */
.mn-flash{animation:mnFlash 2.2s var(--ease-out,ease-out)}
@keyframes mnFlash{0%,30%{box-shadow:0 0 0 3px var(--accent);border-radius:12px;background:var(--accent-soft)}100%{box-shadow:0 0 0 0 transparent}}

/* Where older messages were compacted into a summary. */
.mn-compact{align-self:stretch;margin:2px auto;font-size:12.5px;color:var(--muted)}
.mn-compact summary{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;cursor:pointer;list-style:none;text-align:center}
.mn-compact summary::-webkit-details-marker{display:none}
.mn-compact summary::before,.mn-compact summary::after{content:"";flex:1 1 0;min-width:12px;height:1px;background:var(--line)}
.mn-compact summary span{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:3px 12px;border-radius:99px;border:1px solid var(--line);white-space:nowrap;line-height:1.4}
.mn-compact summary .i{width:13px;height:13px}
.mn-compact[open] summary span{color:var(--fg);border-color:var(--line-strong)}
.mn-compact-t{font-style:normal;font-variant-numeric:tabular-nums;color:var(--text-3,var(--muted));margin-left:2px}
.mn-compact.live{display:flex;flex-direction:column;align-items:center;gap:6px;animation:mnIn .2s var(--ease-out,ease-out) both}
.mn-compact-s{display:flex;align-items:center;gap:10px;width:100%}
.mn-compact-s::before,.mn-compact-s::after{content:"";flex:1 1 0;min-width:12px;height:1px;background:linear-gradient(90deg,transparent,var(--accent-line,var(--line)),transparent)}
.mn-compact-s span{flex:none;display:inline-flex;align-items:center;gap:8px;padding:4px 13px;border-radius:99px;border:1px solid var(--accent-line,var(--line-strong));background:var(--accent-soft,transparent);white-space:nowrap;line-height:1.4}
.mn-compact-s b{font-weight:600;background:linear-gradient(90deg,var(--muted) 30%,var(--fg) 50%,var(--muted) 70%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:mnShine 1.6s linear infinite}
.mn-compact-spin{width:12px;height:12px;border-radius:50%;border:2px solid color-mix(in srgb,var(--accent) 30%,transparent);border-top-color:var(--accent);animation:mnSpin .8s linear infinite}
.mn-compact-why{margin:0;max-width:46ch;text-align:center;font-size:12px;line-height:1.5;color:var(--muted)}
@media (prefers-reduced-motion:reduce){.mn-compact-s b,.mn-compact-spin{animation:none}}
.mn-compact-b{margin-top:10px;padding:12px 14px;border-radius:12px;background:color-mix(in srgb,var(--fg) 4%,transparent);font-size:13px;color:var(--text-2,var(--fg))}

/* Mic in the composer: a pulsing dot and the seconds while recording. */
.mn-mic{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:none;min-width:34px;height:34px;padding:0;border:1px solid var(--line);border-radius:999px;background:none;color:var(--fg);cursor:pointer;
  font:inherit;font-size:12.5px;font-variant-numeric:tabular-nums;transition:background .15s,border-color .15s,padding .15s}
.mn-mic[hidden]{display:none}
.mn-mic:hover{background:var(--hover);border-color:var(--line-strong)}
.mn-mic .i{width:17px;height:17px;stroke-width:2}
.mn-mic-dot{display:none;width:8px;height:8px;border-radius:50%;background:var(--danger)}
.mn-mic.rec{padding:0 12px 0 10px;border-color:color-mix(in srgb,var(--danger) 45%,transparent);background:color-mix(in srgb,var(--danger) 9%,transparent)}
.mn-mic.rec .i{display:none}
.mn-mic.rec .mn-mic-dot{display:block;animation:mnRec 1.1s ease-in-out infinite}
.mn-mic.wait{opacity:.6;cursor:progress}
@keyframes mnRec{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.8)}}
@media (prefers-reduced-motion:reduce){.mn-mic.rec .mn-mic-dot{animation:none}}
/* Listen under a reply: only when a speech model is set. */
.mn-chat:not(.can-tts) .mn-listen{display:none}
.mn-foot-a .mn-listen.on{color:var(--accent);background:var(--accent-soft)}
/* Results drawn in a tool card: a sub-agent's answer, what an image shows. */
.mn-tool-ans{max-height:320px;overflow:auto;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--surface-0,var(--bg));font-size:13px}
/* A picture Mnemo made: in the reply (and small in its card); tap for the full view. */
.mn-gen-row{display:flex;margin:6px 0}
.mn-gen{display:block;padding:0;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:color-mix(in srgb,var(--fg) 4%,transparent);cursor:zoom-in;max-width:min(100%,420px)}
.mn-gen img{display:block;width:100%;height:auto;max-height:420px;object-fit:contain}
.mn-gen.sm{max-width:160px;border-radius:10px}
.mn-gen.sm img{max-height:160px}
.mn-gen.gone{display:none}
/* Mnemo noted something about the owner: one quiet line. */
.mn-memline{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12.5px;color:var(--muted);min-width:0}
.mn-memline .i{width:14px;height:14px;flex:none}
.mn-memline span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-memline.err{color:var(--danger)}
.mn-memline-a{flex:none;padding:2px 4px;border:0;border-radius:6px;background:none;color:var(--accent);font:inherit;font-size:12.5px;cursor:pointer}
.mn-memline-a:hover{background:var(--accent-soft)}

/* Chat width (per device). Phones always use the full width. Only the shared column variables
   change, so the log and the composer can never drift apart. */
  .mn-chat.w-wide:not(.compact):not(.cw-narrow){--mn-col:1100px}
  .mn-chat.w-wide:not(.compact):not(.cw-narrow) .mn-ub,.mn-chat.w-wide:not(.compact):not(.cw-narrow) .mn-u-att{max-width:70%}
  .mn-chat.w-wide:not(.compact):not(.cw-narrow) .mn-tray{max-width:1100px}
  .mn-chat.w-full:not(.compact):not(.cw-narrow){--mn-col:none;--mn-gut:32px}
  .mn-chat.w-full.has-rail:not(.compact):not(.cw-narrow){--mn-gut:48px}
  .mn-chat.w-full:not(.compact):not(.cw-narrow) .mn-log>.mn-hello{max-width:620px}
  .mn-chat.w-full:not(.compact):not(.cw-narrow) .mn-ub,.mn-chat.w-full:not(.compact):not(.cw-narrow) .mn-u-att{max-width:70%}
  .mn-chat.w-full:not(.compact):not(.cw-narrow) .mn-md>:is(p,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,dl){max-width:90ch}
  .mn-chat.w-full:not(.compact):not(.cw-narrow) .mn-tray{max-width:none}


/* Sub-agents: a reply keeps one line per group; their work shows in the Agents panel. */
.mn-team-line{display:flex;align-items:center;gap:10px;width:100%;max-width:none;margin:8px 0;padding:8px 8px 8px 10px;border:1px solid var(--line);border-radius:12px;
  background:var(--surface-1,var(--panel));color:var(--text-2,var(--fg));font:inherit;font-size:calc(var(--mn-fs,14.5px) - 1.5px);text-align:left;cursor:pointer;
  transition:background .15s,border-color .15s;animation:mnIn .25s var(--ease-out,ease-out) both}
.mn-team-line:hover{background:var(--hover);border-color:var(--line-strong)}
.mn-team-line:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mn-team-line:focus:not(:focus-visible){outline:none}
.mn-team-ic{display:grid;place-items:center;flex:none;width:24px;height:24px;border-radius:7px;color:var(--accent);background:var(--accent-soft)}
.mn-team-ic .i{width:13px;height:13px;stroke-width:2.2}
.mn-team-line.err .mn-team-ic{color:var(--danger);background:color-mix(in srgb,var(--danger) 10%,transparent)}
.mn-team-line.stop .mn-team-ic{color:var(--muted);background:color-mix(in srgb,var(--fg) 6%,transparent)}
.mn-team-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:550}
.mn-team-go{display:inline-flex;align-items:center;gap:4px;flex:none;height:28px;padding:0 10px 0 12px;border-radius:999px;font-size:12.5px;font-weight:600;color:var(--accent);background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);transition:background .15s}
.mn-team-line:hover .mn-team-go{background:color-mix(in srgb,var(--accent) 18%,transparent)}
.mn-team-go .i{width:13px;height:13px}
/* The Agents panel: Running, Idle, and Done (folded under its count). */
.mn-agents{display:flex;flex-direction:column;gap:16px;min-width:0;padding:12px}
.modal-body .mn-agents{padding:0}
.mn-ag-none{margin:4px 2px;font-size:12.5px;line-height:1.5;color:var(--muted)}
.mn-ag-none[hidden],.mn-ag-sec[hidden]{display:none}
.mn-ag-sec{display:flex;flex-direction:column;gap:8px;min-width:0}
.mn-ag-sec h4{display:flex;align-items:center;gap:6px;margin:0 2px;font-size:11.5px;font-weight:650;color:var(--muted);text-transform:none;letter-spacing:0}
.mn-ag-sec h4>span{min-width:18px;height:18px;padding:0 5px;border-radius:99px;font-size:11px;line-height:18px;text-align:center;font-weight:600;
  color:var(--text-2,var(--fg));background:color-mix(in srgb,var(--fg) 7%,transparent)}
.mn-ag-sec[data-sec=run] h4>span{color:var(--accent);background:var(--accent-soft)}
.mn-ag-sec h4 small{margin-left:auto;font-size:11.5px;font-weight:500}
.mn-ag-l{display:flex;flex-direction:column;gap:8px;min-width:0}
details.mn-ag-done{display:block}
.mn-ag-done>summary{display:flex;align-items:center;gap:6px;min-height:32px;padding:0 4px 0 0;border-radius:8px;list-style:none;cursor:pointer;user-select:none}
.mn-ag-done>summary::-webkit-details-marker{display:none}
.mn-ag-done>summary:hover h4{color:var(--fg)}
.mn-ag-done>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mn-ag-chev{width:13px;height:13px;flex:none;color:var(--muted);transition:transform .15s}
.mn-ag-done[open] .mn-ag-chev{transform:rotate(90deg)}
.mn-ag-done>.mn-ag-l{margin-top:8px}
.mn-ag-done .mn-sub{background:none}
.mn-agents .mn-tool[open]>summary{position:static;box-shadow:none}
/* In the narrow Agents panel a step takes two lines: what it did (and on what), then how it went. */
.mn-agents .mn-tool summary{display:grid;grid-template-columns:26px minmax(0,1fr) 14px;grid-template-areas:"ic t ch" "ic s ch";column-gap:10px;row-gap:1px;align-items:center;padding:7px 10px 7px 7px}
.mn-agents .mn-tool-ic{grid-area:ic;align-self:center}
.mn-agents .mn-tool-t{grid-area:t;min-width:0;overflow:hidden}
.mn-agents .mn-tool-t b{flex:none}
.mn-agents .mn-tool-s{grid-area:s;max-width:100%;justify-self:start;font-size:11.5px}
.mn-agents .mn-tool summary>.mn-tool-chev{grid-area:ch}
.mn-sub{display:flex;flex-direction:column;gap:8px;min-width:0;padding:10px 12px;border:1px solid var(--line);border-radius:14px;background:var(--surface-0,var(--bg))}
.mn-sub:is([data-state=run],[data-state=ask]){border-color:var(--accent-line,var(--line-strong))}
.mn-sub-h{display:flex;align-items:center;gap:10px;min-width:0}
.mn-sub-av{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:8px;font-size:12.5px;font-weight:700;color:var(--accent);background:var(--accent-soft)}
.mn-sub-t{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.mn-sub-t b{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-sub-t small{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-sub-t small:empty{display:none}
.mn-sub-chip{display:inline-flex;align-items:center;gap:6px;flex:none;max-width:52%;height:24px;padding:0 9px;border-radius:999px;font-size:11.5px;font-weight:550;color:var(--muted);
  background:color-mix(in srgb,var(--fg) 6%,transparent);white-space:nowrap}
.mn-sub-chip span{overflow:hidden;text-overflow:ellipsis}
.mn-sub-chip .i{width:13px;height:13px;flex:none}
.mn-sub-chip .mn-spin{width:11px;height:11px}
.mn-sub[data-state=ask] .mn-sub-chip{color:var(--accent);background:var(--accent-soft)}
.mn-sub[data-state=done] .mn-sub-chip .i{color:var(--accent)}
.mn-sub[data-state=err] .mn-sub-chip{color:var(--danger);background:color-mix(in srgb,var(--danger) 10%,transparent)}
.mn-sub-m{display:flex;align-items:center;gap:10px;min-width:0}
/* Once it has stopped working, the window meter gives way to the token line alone. */
.mn-sub:not([data-state=run]):not([data-state=ask]) .mn-sub-bar{display:none}
.mn-sub:not([data-state=run]):not([data-state=ask]) .mn-sub-tok{margin-left:0;margin-inline-start:0}
.mn-sub-m[hidden]{display:none}
.mn-sub-bar{flex:1;min-width:40px;height:4px;border-radius:99px;overflow:hidden;background:color-mix(in srgb,var(--fg) 8%,transparent)}
.mn-sub-bar[hidden]{display:none}
.mn-sub-bar i{display:block;height:100%;width:0;border-radius:inherit;background:var(--accent);transition:width .3s var(--ease-out,ease-out)}
.mn-sub-bar.hi i{background:var(--danger)}
.mn-sub-tok{flex:none;margin-left:auto;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
/* A sub-agent card: Instruction, Activity and Answer, always there whatever it is doing; each
   opens and folds on its own (Activity opens while it runs, unless the owner folds it). */
/* The top of a long chat: the older part waits outside the page until it is scrolled to. */
.mn-more{display:flex;align-items:center;justify-content:center;gap:6px;align-self:center;width:auto!important;max-width:none!important;margin:0 auto 4px;padding:6px 14px;border:1px solid var(--line);border-radius:999px;
  background:var(--surface-1,var(--panel));color:var(--text-2,var(--fg));font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;transition:background .15s,border-color .15s}
.mn-more:hover{background:var(--hover);border-color:var(--line-strong)}
.mn-more:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mn-more .i{width:14px;height:14px}
.mn-sub-id{margin-inline-start:6px;padding:1px 6px;border-radius:6px;font:600 10.5px/1.5 var(--mono,ui-monospace,monospace);color:var(--muted);background:var(--hover);vertical-align:1px}
.mn-sub-acc{margin:0 -6px}
.mn-sub-acc+.mn-sub-acc{margin-top:-6px}
.mn-sub-acc>summary{display:flex;align-items:center;gap:6px;min-height:26px;padding:0 6px;list-style:none;cursor:pointer;font-size:12.5px;font-weight:600;color:var(--text-2,var(--fg));user-select:none;border-radius:7px;transition:background .15s}
.mn-sub-acc>summary:hover{background:var(--hover)}
.mn-sub-acc>summary::-webkit-details-marker{display:none}
.mn-sub-acc>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mn-sub-acc>summary em{font-style:normal;font-weight:500;color:var(--muted)}
.mn-sub-acc>summary em:not(:empty)::before{content:"· "}
.mn-sub-acc[open] .mn-sub-chev{transform:rotate(90deg)}
.mn-sub-body{padding:2px 6px 8px 25px}
.mn-sub-task{margin:0;font-size:12.5px;line-height:1.5;color:var(--text-2,var(--fg));white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto}
.mn-sub-rules{margin-top:8px;padding:7px 9px;border-radius:8px;background:var(--hover);font-size:12px;line-height:1.45}
.mn-sub-rules[hidden]{display:none}
.mn-sub-rules b{display:block;font-weight:600;color:var(--muted);margin-bottom:2px}
.mn-sub-rules p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text-2,var(--fg))}
.mn-sub-empty{margin:0;font-size:12px;color:var(--muted);font-style:italic}
.mn-sub-body:has(.mn-sub-log:not(:empty)) > .mn-sub-empty,.mn-sub-body:has(.mn-sub-pre:not([hidden])) > .mn-sub-empty{display:none}
.mn-sub-act .mn-sub-pre{margin-top:6px}
.mn-sub-log{display:flex;flex-direction:column;gap:6px;margin:0;padding:0 0 0 12px;border-left:2px solid var(--line);list-style:none}
.mn-sub-log:empty{display:none}
/* A sub-agent's activity: newest first in a short window, no scrollbar, fading at the bottom;
   Show all grows it down smoothly and folds it back up. */
.mn-agents .mn-sub-log{max-height:300px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;transition:max-height .32s var(--ease-out,ease-out)}
.mn-agents .mn-sub-log::-webkit-scrollbar{display:none}
.mn-agents .mn-sub-log.more{-webkit-mask-image:linear-gradient(#000 calc(100% - 56px),transparent);mask-image:linear-gradient(#000 calc(100% - 56px),transparent)}
.mn-agents .mn-sub-log.all{overflow:hidden}
.mn-sub-all{display:block;margin:6px 0 0 12px;margin-inline-start:12px;padding:3px 8px;border:0;border-radius:8px;background:none;font:inherit;font-size:12px;font-weight:600;color:var(--accent);cursor:pointer}
.mn-sub-all:hover{background:var(--accent-soft)}
.mn-sub-all[hidden]{display:none}
@media (prefers-reduced-motion:reduce){.mn-agents .mn-sub-log{transition:none}}
.mn-sub-li{display:flex;align-items:flex-start;gap:7px;min-width:0;font-size:12px;line-height:1.45;color:var(--muted)}
.mn-sub-li>.i,.mn-sub-li>.mn-spin{flex:none;width:12px;height:12px;margin-top:2px}
.mn-sub-li>span{min-width:0;overflow-wrap:anywhere}
.mn-sub-li b{font-weight:600;color:var(--text-2,var(--fg))}
.mn-sub-li em{font-style:normal;margin-left:6px;opacity:.85}
.mn-sub-li em::before{content:"· "}
.mn-sub-li.ok>.i{color:var(--accent)}
.mn-sub-li.err,.mn-sub-li.err>.i{color:var(--danger)}
.mn-sub-x{display:flex;flex-direction:column;gap:2px}
.mn-sub-x>span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mn-sub-pre{font-size:12px;line-height:1.45;color:var(--muted);opacity:.75;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-sub-pre[hidden]{display:none}
.mn-sub-chev{width:13px;height:13px;color:var(--muted);transition:transform .15s}
.mn-sub-ans .mn-md{max-height:360px;overflow:auto;font-size:13px}
@media (max-width:640px){.mn-sub{padding:9px 10px}.mn-sub-chip{max-width:46%}.mn-agents{padding:10px}}
@media (prefers-reduced-motion:reduce){.mn-sub-bar i,.mn-sub-chev,.mn-ag-chev{transition:none}.mn-team-line{animation:none}}

/* Mnemo's replies span the same width as the message box (same left and right edge). Its mark
   hangs just outside on the left when the gutter has room for it; without that room it is left
   out (as on phones) rather than pushing the reply in from the box's edge. */
.mn-log{container-type:inline-size}
.mn-turn{grid-template-columns:minmax(0,1fr);gap:0;position:relative}
.mn-turn>.mn-av{display:none}
@container (min-width: 868px){
  .mn-chat:not(.compact):not(.w-wide):not(.w-full) .mn-turn>.mn-av{display:block;position:absolute;inset-inline-start:-44px;top:0}
}
@container (min-width: 1188px){
  .mn-chat.w-wide:not(.compact) .mn-turn>.mn-av{display:block;position:absolute;inset-inline-start:-44px;top:0}
}
/* Full width: the chat and the message box share one gutter wide enough for the mark. */
.mn-chat.w-full.cw-big:not(.compact),.mn-chat.w-full.cw-big.has-rail:not(.compact){--mn-gut:76px}
.mn-chat.w-full.cw-big:not(.compact) .mn-turn>.mn-av{display:block;position:absolute;inset-inline-start:-44px;top:0}
`;
