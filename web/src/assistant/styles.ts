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
.mn-log{--lp:28px;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:var(--lp) 24px 12px;display:flex;flex-direction:column;gap:18px;scroll-padding-bottom:24px}
.mn-log>*{width:100%;max-width:780px;margin-inline:auto}
.mn-chat.compact .mn-log{--lp:16px;padding:var(--lp) 14px 8px;gap:14px}

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
.mn-tool-t{flex:1;min-width:0;display:flex;align-items:baseline;gap:8px}
.mn-tool-t b{flex:none;font-size:calc(var(--mn-fs,14.5px) - 1.5px);font-weight:600}
.mn-tool-t small{min-width:0;font-size:calc(var(--mn-fs,14.5px) - 2px);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-tool-s{display:inline-flex;align-items:center;gap:5px;flex:0 1 auto;min-width:0;max-width:46%;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.mn-tool-s>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-tool-s>.i{flex:none}
.mn-tool-t b{white-space:nowrap}
.mn-tool-s .i{width:14px;height:14px;stroke-width:2.2}
.mn-tool.ok .mn-tool-s .i{color:var(--ok,#10b981)}.mn-tool.err .mn-tool-s{color:var(--danger)}
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
.mn-slash{position:absolute;left:24px;right:24px;bottom:calc(100% - 4px);z-index:8;max-width:780px;margin:0 auto;padding:6px;border:1px solid var(--line-strong);border-radius:14px;
  background:var(--surface-1,var(--panel));box-shadow:0 18px 40px -18px rgba(15,23,42,.4);animation:mnIn .14s var(--ease-out,ease-out) both;max-height:320px;overflow:auto}
.mn-chat.compact .mn-slash{left:12px;right:12px}
.mn-slash-h{display:flex;align-items:center;gap:6px;padding:4px 8px 6px;font-size:12px;font-weight:650;color:var(--muted)}
.mn-slash-h .i{width:13px;height:13px;color:var(--accent)}
.mn-slash-h small{font-weight:450;margin-left:auto}
.mn-slash-i{display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;padding:8px 10px;border:0;border-radius:9px;background:none;color:var(--fg);font:inherit;text-align:left;cursor:pointer}
.mn-slash-i b{font:600 13px/1.3 var(--font-mono,ui-monospace,monospace)}
.mn-slash-i small{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.mn-slash-i.on,.mn-slash-i:hover{background:var(--accent-soft,var(--hover))}
.mn-slash-none{margin:0;padding:8px 10px 10px;font-size:12.5px;color:var(--muted);line-height:1.5}
.mn-fleet{display:flex;align-items:flex-start;gap:10px;width:100%;margin-bottom:18px;padding:12px 14px;border-radius:14px;text-align:left;
  border:1px dashed color-mix(in srgb,#8b5cf6 55%,transparent);background:color-mix(in srgb,#8b5cf6 8%,transparent)}
.mn-fleet>.i{width:18px;height:18px;flex:none;margin-top:2px;color:#8b5cf6}
.mn-fleet span{display:flex;flex-direction:column;gap:2px;line-height:1.45}
.mn-fleet b{font-size:14px;color:#8b5cf6}
.mn-fleet small{font-size:12.5px;color:var(--text-2,var(--fg))}
.mn-chat.fleeting .mn-comp-box{border-style:dashed;border-color:color-mix(in srgb,#8b5cf6 55%,var(--line-strong))}
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

.mn-comp{flex:none;padding:10px 24px 14px;position:relative}
.mn-down{position:absolute;left:50%;bottom:calc(100% + 6px);z-index:6;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;
  border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--surface-1,var(--panel)) 92%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  color:var(--fg);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 6px 18px -8px rgba(15,23,42,.35);
  opacity:0;pointer-events:none;transform:translate(-50%,8px) scale(.96);transition:opacity .2s,transform .25s var(--ease-out,ease-out),background .15s}
.mn-down .i{width:16px;height:16px}
.mn-down.on{opacity:1;pointer-events:auto;transform:translate(-50%,0)}
.mn-down:hover{background:var(--hover)}
.mn-down:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mn-chat.compact .mn-comp{padding:8px 12px 12px}
.mn-comp-box{max-width:780px;margin:0 auto;border:1px solid var(--line-strong);border-radius:20px;background:var(--surface-0,var(--bg));
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
.mn-fine{margin:8px auto 0;max-width:780px;text-align:center;font-size:11.5px;color:var(--text-3,var(--muted))}
.mn-chat.compact .mn-fine{display:none}
@media (max-width:640px){.mn-log{--lp:18px;padding:var(--lp) 14px 8px}.mn-comp{padding:8px 10px 10px}.mn-sugs{grid-template-columns:1fr}.mn-fine{display:none}}
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
.mn-log{--fa:0px;--fb:0px;-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 var(--fa),#000 calc(100% - var(--fb)),transparent 100%);
  mask-image:linear-gradient(to bottom,transparent 0,#000 var(--fa),#000 calc(100% - var(--fb)),transparent 100%)}
.mn-chat.fade-top .mn-log{--fa:0px}
.mn-chat.fade-bot .mn-log{--fb:28px}

/* Timeline rail, top right: one bar per question; the one in view is longer and darker. */
.mn-rail{position:absolute;top:50%;right:2px;z-index:3;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;padding:6px 0;width:40px;
  max-height:60%;transform:translateY(-50%);touch-action:none;user-select:none;-webkit-user-select:none;cursor:pointer}
.mn-rail[hidden]{display:none}
.mn-rb{position:relative;display:flex;align-items:center;justify-content:flex-end;width:40px;height:var(--rh,10px);padding:0 6px;border:0;background:none;cursor:pointer;flex:none;pointer-events:none}
.mn-rb i{display:block;width:calc(var(--w,12px) * var(--m,1));height:2px;border-radius:2px;background:var(--line-strong);
  transition:width .14s cubic-bezier(.2,.9,.3,1.3),background .12s,height .12s}
.mn-rb.on i{background:var(--fg);width:calc((var(--w,12px) + 8px) * var(--m,1));height:3px}
.mn-rb.hot i{background:var(--accent);height:3px}
.mn-rail.scrub .mn-rb i{background:color-mix(in srgb,var(--fg) 45%,transparent)}
.mn-rail.scrub .mn-rb.hot i{background:var(--accent)}
.mn-rlab{position:absolute;right:calc(100% + 2px);top:50%;transform:translate(8px,-50%);display:flex;gap:7px;align-items:baseline;max-width:min(260px,70vw);padding:6px 10px;border-radius:10px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px;color:var(--fg);background:var(--panel,var(--surface-1));border:1px solid var(--line-strong);
  box-shadow:0 10px 28px -12px rgba(15,23,42,.35);opacity:0;pointer-events:none;transition:opacity .12s,transform .16s var(--ease-out,ease-out),top .08s linear}
.mn-rlab b{flex:none;font-size:11px;font-weight:650;color:var(--accent);font-variant-numeric:tabular-nums}
.mn-rlab.in{opacity:1;transform:translate(0,-50%)}
.mn-chat.has-rail .mn-log{padding-right:44px}
/* Phones: no avatar beside Mnemo's replies, so they and the questions use the full width between equal margins;
   the timeline narrows into the right margin instead of taking a column of its own. */
@media (max-width:640px){
  .mn-log,.mn-chat.has-rail .mn-log{padding-left:12px;padding-right:12px}
  .mn-turn{grid-template-columns:minmax(0,1fr);gap:0}
  .mn-turn>.mn-av{display:none}
  .mn-ub{max-width:88%}
  .mn-rail{right:0;width:12px}
  .mn-rb{width:12px;padding:0 1px}
  .mn-rb i{width:calc(var(--w,12px) * .45 * var(--m,1))}
  .mn-rb.on i{width:10px}
}

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
.mn-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;margin:8px 0 2px;animation:mnIn .2s var(--ease-out,ease-out) both}
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
.mn-ask{margin:10px 0 4px;padding:12px;border:1px solid var(--accent-line,var(--line-strong));border-radius:14px;background:color-mix(in srgb,var(--accent) 5%,var(--panel,var(--surface-1)))}
.mn-ask-q{display:flex;gap:8px;align-items:flex-start;font-size:calc(var(--mn-fs,14.5px) - .5px);font-weight:600;line-height:1.45;margin-bottom:10px}
.mn-ask-q .i{width:17px;height:17px;flex:none;margin-top:2px;color:var(--accent)}
.mn-ask-o{display:flex;flex-direction:column;gap:6px}
.mn-ask-b{display:flex;align-items:flex-start;gap:10px;width:100%;padding:9px 11px;border:1px solid var(--line-strong);border-radius:11px;background:var(--panel,var(--surface-1));
  color:var(--fg);font:inherit;text-align:left;cursor:pointer;transition:border-color .15s,background .15s,transform .12s}
.mn-ask-b:hover:not(:disabled){border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,var(--panel,var(--surface-1)))}
.mn-ask-b:active:not(:disabled){transform:scale(.99)}
.mn-ask-n{display:grid;place-items:center;flex:none;width:22px;height:22px;margin-top:1px;border-radius:7px;background:var(--surface-2,color-mix(in srgb,var(--fg) 7%,transparent));
  color:var(--muted);font-size:12px;font-weight:600}
.mn-ask-n .i{width:13px;height:13px}
.mn-ask-c{display:flex;flex-direction:column;gap:2px;min-width:0}
.mn-ask-b b{font-size:calc(var(--mn-fs,14.5px) - 1px);font-weight:600}
.mn-ask-b small{font-size:calc(var(--mn-fs,14.5px) - 2.5px);color:var(--muted);line-height:1.4}
.mn-ask-b.ok b::before{content:"✓ ";color:var(--accent)}
.mn-ask-b.other{border-style:dashed}
.mn-ask-b.on .mn-ask-n{background:var(--accent);color:var(--on-accent,#fff)}
.mn-ask-f{display:flex;gap:6px;align-items:center;padding:4px 4px 4px 12px;border:1px solid var(--accent);border-radius:11px;background:var(--panel,var(--surface-1))}
.mn-ask-f[hidden]{display:none}
.mn-ask-f input{flex:1;min-width:0;height:32px;border:0;outline:0;background:none;color:var(--fg);font:inherit;font-size:14px}
.mn-ask-f .mn-ibtn{background:var(--accent);color:var(--on-accent,#fff);border-radius:8px}
.mn-ask-skip{margin-left:auto;flex:none;padding:1px 8px;border-radius:999px;background:var(--surface-2,color-mix(in srgb,var(--fg) 7%,transparent));color:var(--muted);font-size:11.5px;font-style:normal;font-weight:500}
.mn-ask.done .mn-ask-b{cursor:default;opacity:.55}
.mn-ask.done .mn-ask-b.on{opacity:1;border-color:var(--accent);background:var(--accent-soft)}
.mn-ask.skipped{background:none;border-color:var(--line)}
.mn-ask.skipped .mn-ask-q{color:var(--muted)}
/* Permission chip in the composer. */
.mn-perm{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px 0 8px;border:1px solid var(--line);border-radius:999px;background:none;color:var(--text-2,var(--fg));
  font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,color .15s}
.mn-perm[hidden]{display:none}
.mn-perm:hover{background:var(--hover)}
.mn-perm .i{width:14px;height:14px}
.mn-perm.auto{color:#b45309;border-color:color-mix(in srgb,#f59e0b 45%,transparent);background:color-mix(in srgb,#f59e0b 9%,transparent)}
@media (max-width:640px){.mn-perm span{display:none}.mn-perm{padding:0 7px}}

/* Mnemo's replies sit on a frosted card, readable over any background. */
.mn-turn .mn-tb{min-width:0;padding:12px 14px;border-radius:16px;border:1px solid color-mix(in srgb,var(--line) 75%,transparent);
  background:color-mix(in srgb,var(--panel,var(--surface-1)) 70%,transparent);-webkit-backdrop-filter:blur(12px) saturate(1.2);backdrop-filter:blur(12px) saturate(1.2)}
@media (max-width:640px){.mn-turn .mn-tb{padding:10px 12px}}
/* The chat scrolls without a bar: the timeline and the edge fades show where you are. */
.mn-log{scrollbar-width:none}
.mn-log::-webkit-scrollbar{display:none!important}
/* The queue above the prompt, and messages that steered a running reply. */
.mn-queue{display:flex;flex-direction:column;gap:4px;padding:10px 10px 2px}
.mn-queue[hidden]{display:none}
.mn-queue-h{display:flex;align-items:center;gap:6px;padding:0 4px 2px;font-size:11.5px;font-weight:600;color:var(--muted)}
.mn-queue-h .i{width:13px;height:13px}
.mn-q-i{display:flex;align-items:center;gap:8px;min-height:34px;padding:2px 4px 2px 8px;border:1px solid var(--line);border-radius:10px;background:color-mix(in srgb,var(--fg) 3%,transparent);cursor:grab}
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
.mn-q-list{display:flex;flex-direction:column;gap:4px;max-height:118px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
.mn-q-list.all{max-height:min(46vh,420px)}
.mn-q-list.fb{-webkit-mask-image:linear-gradient(#000 calc(100% - 26px),transparent);mask-image:linear-gradient(#000 calc(100% - 26px),transparent)}
.mn-q-list.ft{-webkit-mask-image:linear-gradient(transparent,#000 22px);mask-image:linear-gradient(transparent,#000 22px)}
.mn-q-list.ft.fb{-webkit-mask-image:linear-gradient(transparent,#000 22px,#000 calc(100% - 26px),transparent);mask-image:linear-gradient(transparent,#000 22px,#000 calc(100% - 26px),transparent)}
.mn-notice.cut{align-self:flex-start;padding:3px 10px 3px 8px;border:1px dashed var(--line-strong);border-radius:99px;font-size:12px}
.mn-notice.fb{color:var(--warn,#d97706)}
.mn-notice b{font-weight:600;color:var(--fg)}
.mn-md.mn-cut{opacity:.5;text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--fg) 35%,transparent)}
.mn-compact-live-b{align-self:stretch;max-height:220px;overflow:auto;margin:2px 0 4px;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--fg) 2.5%,transparent);font-size:13px;color:var(--fg);-webkit-mask-image:linear-gradient(transparent,#000 18px);mask-image:linear-gradient(transparent,#000 18px)}
.mn-think-slot{display:inline-flex;min-width:0}
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
`;
