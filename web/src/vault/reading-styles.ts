// Reading settings: the panel's own look, the extra reading colours and the note display options
// (all keyed on data attributes and custom properties that applyReading() puts on `.vx-note-scroll`).

const SERIF = '"Iowan Old Style","Charter","Source Serif 4","Source Serif Pro","Georgia",ui-serif,serif';

/** One reading colour: the tokens it redefines inside the reading area. */
const tone = (sel: string, v: string[], scheme = ''): string =>
  `${sel}{--bg:${v[0]};--fg:${v[1]};--text-2:${v[2]};--muted:${v[3]};--text-3:${v[4]};--line:${v[5]};--line-strong:${v[6]};--panel:${v[7]};` +
  `--panel-2:${v[8]};--hover:${v[9]};--accent:${v[10]};--accent-2:${v[11]};--accent-line:${v[12]};--accent-soft:${v[13]}${scheme ? ';color-scheme:' + scheme : ''}}`;
const ns = (k: string): string => `.vx-note-scroll[data-rtone=${k}]`;
const lightNs = (k: string): string => `:root[data-theme=light] ${ns(k)}`;
/** Fixed tints (the same in both app themes). */
const fixed = (k: string): string => `${ns(k)},${lightNs(k)}`;

const TONES_CSS = [
  // follow the app theme
  tone(ns('warm'), ['#1e1813', '#f1e2cf', '#dccab2', '#ad9a80', '#827159', 'rgba(241,226,207,.12)', 'rgba(241,226,207,.21)', '#251e17', '#2d251c', 'rgba(241,226,207,.06)', '#eba66b', '#e0965a', 'rgba(235,166,107,.45)', 'rgba(235,166,107,.13)']),
  tone(lightNs('warm'), ['#fdf4e8', '#35261a', '#56412d', '#7d6550', '#a58d77', 'rgba(53,38,26,.12)', 'rgba(53,38,26,.21)', '#f6eadb', '#efdfcb', 'rgba(53,38,26,.05)', '#b5541a', '#a34a15', 'rgba(181,84,26,.4)', 'rgba(181,84,26,.1)']),
  tone(ns('lavender'), ['#17141f', '#e5dff2', '#cbc3dc', '#9c93b0', '#726a85', 'rgba(229,223,242,.11)', 'rgba(229,223,242,.2)', '#1d1927', '#241f30', 'rgba(229,223,242,.06)', '#b9a2f2', '#a890e8', 'rgba(185,162,242,.45)', 'rgba(185,162,242,.12)']),
  tone(lightNs('lavender'), ['#f4f1fb', '#241e33', '#3f3654', '#645b7a', '#8d85a1', 'rgba(36,30,51,.11)', 'rgba(36,30,51,.2)', '#ebe6f6', '#e2dbf1', 'rgba(36,30,51,.05)', '#6846c4', '#5b3bb0', 'rgba(104,70,196,.4)', 'rgba(104,70,196,.1)']),
  // always light
  tone(fixed('cream'), ['#fffaf0', '#2b2620', '#4a4239', '#736a5e', '#9b9284', 'rgba(43,38,32,.11)', 'rgba(43,38,32,.2)', '#f7f0e2', '#efe6d4', 'rgba(43,38,32,.05)', '#9a5b12', '#8a4f12', 'rgba(154,91,18,.4)', 'rgba(154,91,18,.1)'], 'light'),
  tone(fixed('white'), ['#ffffff', '#1d2127', '#3a414c', '#5e6673', '#8b929d', 'rgba(29,33,39,.1)', 'rgba(29,33,39,.18)', '#f6f7f9', '#eef0f3', 'rgba(29,33,39,.045)', '#0b62d6', '#0a56bd', 'rgba(11,98,214,.38)', 'rgba(11,98,214,.09)'], 'light'),
  // always dark
  tone(fixed('forest'), ['#0f1a14', '#d4e6d9', '#b9cfbf', '#87a08e', '#617a68', 'rgba(212,230,217,.11)', 'rgba(212,230,217,.2)', '#142119', '#1a291f', 'rgba(212,230,217,.06)', '#6fcf97', '#5dbd85', 'rgba(111,207,151,.45)', 'rgba(111,207,151,.12)'], 'dark'),
  tone(fixed('dusk'), ['#1a1626', '#e3dcf0', '#c8bfda', '#988fae', '#6f6787', 'rgba(227,220,240,.11)', 'rgba(227,220,240,.2)', '#201b2e', '#272137', 'rgba(227,220,240,.06)', '#c6a8ff', '#b393f5', 'rgba(198,168,255,.45)', 'rgba(198,168,255,.12)'], 'dark'),
  tone(fixed('ocean'), ['#0c1d22', '#d2e6e8', '#b6cfd2', '#85a2a6', '#5f7c80', 'rgba(210,230,232,.11)', 'rgba(210,230,232,.2)', '#10252b', '#152d34', 'rgba(210,230,232,.06)', '#4fd1c5', '#3fbfb3', 'rgba(79,209,197,.45)', 'rgba(79,209,197,.12)'], 'dark'),
].join('\n');

/** Display options of a note (prefix: the reading area). None of them reach a board embedded in
 *  the note (`.kbe`, views/board-card.ts): `:not(.kbe *)` on every rule that could. */
const NB = ':not(.kbe *)';
/** A web or note link the options restyle (not a chip, not a missing note). */
const A = `a:not(.ch):not(.broken)${NB}`;
const NOTE_CSS = `
.vx-note-scroll[data-rlead=loose] .vx-prose{line-height:2.05}
/* paragraph spacing */
.vx-note-scroll[data-rpara=tight] .vx-prose p${NB}{margin-bottom:.55em}
.vx-note-scroll[data-rpara=tight] .vx-prose :is(ul,ol)${NB}{margin-bottom:.7em}
.vx-note-scroll[data-rpara=tight] .vx-prose li${NB}{margin:.2em 0}
.vx-note-scroll[data-rpara=loose] .vx-prose p${NB}{margin-bottom:1.65em}
.vx-note-scroll[data-rpara=loose] .vx-prose :is(ul,ol)${NB}{margin-bottom:1.7em}
.vx-note-scroll[data-rpara=loose] .vx-prose li${NB}{margin:.6em 0}
/* alignment and hyphenation */
.vx-note-scroll[data-ralign=justify] .vx-prose :is(p,li,blockquote)${NB}{text-align:justify}
.vx-note-scroll[data-rhyph=on] .vx-prose{-webkit-hyphens:auto;hyphens:auto}
.vx-note-scroll[data-rhyph=on] .vx-prose :is(pre,code,a,h1,h2,h3,h4,.kbe){-webkit-hyphens:manual;hyphens:manual}
/* headings (the note title follows) */
.vx-note-scroll[data-rhead=serif] :is(.vx-prose :is(h1,h2,h3),.vx-doc-title)${NB}{font-family:${SERIF};font-weight:600;letter-spacing:-.005em}
.vx-note-scroll[data-rhead=caps] :is(.vx-prose :is(h1,h2,h3),.vx-doc-title)${NB}{font-variant-caps:all-small-caps;letter-spacing:.045em;font-weight:650}
.vx-note-scroll[data-rhead=caps] .vx-prose :is(h1,h2,h3)${NB}{font-size:1.2em}
.vx-note-scroll[data-rhead=caps] .vx-prose h1${NB}{font-size:1.55em}
.vx-note-scroll[data-rhead=rule] .vx-prose :is(h1,h2)${NB}{padding-bottom:.3em;border-bottom:1px solid var(--line-strong)}
.vx-note-scroll[data-rhead=accent] :is(.vx-prose :is(h1,h2,h3),.vx-doc-title)${NB}{color:var(--accent)}
/* links: colour */
.vx-note-scroll[data-rlinkc=accent] .vx-prose ${A},
.vx-note-scroll[data-rlinkc=accent] .vx-prose ${A}:hover{color:var(--accent-2)}
.vx-note-scroll[data-rlinkc=text] .vx-prose ${A},
.vx-note-scroll[data-rlinkc=text] .vx-prose ${A}:hover{color:var(--fg)}
.vx-note-scroll[data-rlinkc=text] .vx-prose ${A}:not(.wl){text-decoration-color:color-mix(in srgb,var(--fg) 40%,transparent)}
/* links: underline (the [data-rlinkc] pair outranks the link colour rule above) */
.vx-note-scroll[data-runder=hover] .vx-prose ${A},
.vx-note-scroll[data-runder=hover][data-rlinkc] .vx-prose ${A}:not(.wl){text-decoration-color:transparent}
.vx-note-scroll[data-runder=hover] .vx-prose ${A}:is(:hover,:focus-visible),
.vx-note-scroll[data-runder=hover][data-rlinkc] .vx-prose ${A}:not(.wl):is(:hover,:focus-visible){text-decoration-color:currentColor}
.vx-note-scroll[data-runder=none] .vx-prose ${A},
.vx-note-scroll[data-runder=none] .vx-prose ${A}:hover{text-decoration:none}
/* code blocks */
.vx-note-scroll[data-rcode=light] .vx-prose pre${NB}{background:#f6f8fa;color:#1f2328;border-color:rgba(31,35,40,.13);color-scheme:light}
.vx-note-scroll[data-rcode=dark] .vx-prose pre${NB}{background:#0d1117;color:#e6edf3;border-color:rgba(230,237,243,.13);color-scheme:dark}
.vx-note-scroll[data-rcode=sepia] .vx-prose pre${NB}{background:#f4ecd8;color:#5b4636;border-color:rgba(91,70,54,.16);color-scheme:light}
.vx-note-scroll[data-rcode] .vx-prose pre${NB} code{color:inherit}
/* images: a picture block of the note (the renderer's <figure class="md-img">, a direct child of
   the text) can reach into the page margins; pictures inside a line of text never do */
.vx-note-scroll[data-rimg=wide] .vx-prose>figure.md-img{margin-inline:calc(var(--vx-px) * -.5);max-width:none;align-items:center}
.vx-note-scroll[data-rimg=bleed] .vx-prose>figure.md-img{margin-inline:calc(var(--vx-px) * -1);max-width:none;align-items:center}
.vx-note-scroll:is([data-rimg=wide],[data-rimg=bleed]) .vx-prose>figure.md-img img{max-height:min(720px,80vh)}
.vx-note-scroll[data-rimg=bleed] .vx-prose>figure.md-img img{border-radius:0;border-inline:0}
/* custom accent colour: --accent as picked (checkboxes, quotes, fills); link text (--accent-2) is
   mixed toward the text colour so it keeps its contrast on light and dark paper alike */
.vx-note-scroll[data-raccent] :is(.vx-prose,.vx-doc-head){--accent:var(--raccent);--accent-2:color-mix(in oklab,var(--raccent) 70%,var(--fg));
  --accent-line:color-mix(in srgb,var(--raccent) 45%,transparent);--accent-soft:color-mix(in srgb,var(--raccent) 12%,transparent)}
`;

/** The panel. */
const PANEL_CSS = `
.vx-pop.vx-pop-rs:not(.vx-side) .vx-pop-card{width:392px}
.vx-side.vx-pop-rs .rs-prev.vx-note-scroll{height:128px}
.vx-side.vx-pop-rs .rs-kb-wrap{height:140px}
.vx-sheet.vx-pop-rs .vx-pop-card{max-height:86dvh}
/* phones: the head scrolls with the rest (a sticky preview would leave too little room) */
.vx-sheet.vx-pop-rs .rs-top{position:static}
.vx-pop-rs .vx-pop-body{padding:0}
.rs{display:flex;flex-direction:column;font-size:13px;color:var(--fg)}
.rs-top{position:sticky;top:0;z-index:3;display:flex;flex-direction:column;gap:10px;padding:2px 16px 12px;background:var(--panel);
  border-bottom:1px solid var(--line)}
/* The sticky head: the scroll fade never covers it (bottom fade only), and focus scrolled into
   view lands below it (--rs-top-h: its height, kept by reading.ts). Short screens: it scrolls away. */
.vx-pop-rs .rs.fade-scroll{scroll-padding-top:calc(var(--rs-top-h,0px) + 8px)}
.vx-pop-rs .rs.fade-scroll.can-up{-webkit-mask-image:none;mask-image:none}
.vx-pop-rs .rs.fade-scroll.can-up.can-down{-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - var(--fade)),transparent);
  mask-image:linear-gradient(to bottom,#000 calc(100% - var(--fade)),transparent)}
@media (max-height:720px){
  .vx-pop-rs .rs-top{position:static}
  .vx-pop-rs .rs.fade-scroll{scroll-padding-top:var(--fade)}
}
.rs button{font:inherit;color:inherit}
.rs [hidden]{display:none!important}
.rs :is(button,input,[tabindex]):focus-visible{outline:2px solid var(--accent);outline-offset:1px}
/* tiles and choices: the focus ring sits on the border, never a second ring around it */
.rs :is(.rs-tile,.rs-seg>button):focus-visible{outline:2px solid var(--accent);outline-offset:-2px}

/* segmented controls: tabs, scope and every one-of choice */
.rs-seg{display:flex;gap:2px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--fg) 6%,transparent);min-width:0}
.rs-seg>button{flex:1 1 0;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:auto;min-height:32px;padding:4px 6px;
  border:0;border-radius:8px;background:none;color:var(--muted);font-size:12.5px;font-weight:550;cursor:pointer;white-space:normal;line-height:1.2;
  text-align:center;overflow-wrap:normal;word-break:normal;hyphens:none;transition:background .15s,color .15s,box-shadow .15s}
/* a choice with a little picture: picture above, name below, so names never break mid-word */
.rs-seg>button:has(.rs-pic){flex-direction:column;gap:4px;padding:6px 4px;font-size:11.5px}
.rs-seg>button>span{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-seg>button:hover{color:var(--fg)}
.rs-seg>button:is([aria-checked=true],[aria-selected=true]){background:var(--panel);color:var(--fg);box-shadow:0 0 0 1px var(--line-strong),0 1px 2px rgba(0,0,0,.08)}
.rs-seg>button .vx-i{width:15px;height:15px}
.rs-seg.wrap{flex-wrap:wrap}
.rs-seg.wrap>button{flex:1 1 calc(33% - 4px)}

/* preview */
.rs-prev-wrap{position:relative;border-radius:12px;border:1px solid var(--line-strong);overflow:hidden}
.rs .rs-prev.vx-note-scroll{flex:none;display:block;height:150px;overflow:hidden;background:var(--paper);pointer-events:none;transition:none}
.rs-prev .rs-prev-in{padding:12px 16px}
.rs-prev .vx-prose{margin:0}
.rs-prev .vx-prose h2{margin:0 0 .35em;font-size:1.25em}
.rs-prev .vx-prose pre{margin:.6em 0 0;padding:8px 12px}
.rs-prev::after{content:"";position:absolute;inset:auto 0 0;height:28px;background:linear-gradient(transparent,var(--paper));pointer-events:none}
.rs-prev-tag{position:absolute;inset-block-start:6px;inset-inline-end:6px;z-index:1;font-size:10.5px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;
  padding:2px 7px;border-radius:99px;background:var(--panel);color:var(--muted);border:1px solid var(--line)}
.rs .rs-kb{zoom:.72;padding:10px 10px 0;pointer-events:none;background:var(--bg);--kb-lane-w:calc(264px * var(--kbl-lane-k,1))}
.rs .rs-kb .kb-lanes{padding-bottom:10px;overflow:hidden}
.rs .rs-kb .kb-lane{max-height:none}
.rs-kb-wrap{height:160px;overflow:hidden;background:var(--bg)}

/* scope */
.rs-scope{display:flex;flex-direction:column;gap:6px}
.rs-own{display:flex;align-items:center;gap:8px;padding:7px 8px 7px 10px;border-radius:9px;background:var(--accent-soft);color:var(--fg);font-size:12px;line-height:1.35}
.rs-own[hidden]{display:none}
.rs-own span{flex:1;min-width:0}
.rs-own i{flex:none;width:7px;height:7px;border-radius:50%;background:var(--accent)}

/* sections */
.rs-body{display:flex;flex-direction:column}
.rs-sec{border-bottom:1px solid var(--line)}
.rs-sec:last-child{border-bottom:0}
.rs-sec-b{display:flex;flex-direction:column;gap:12px;padding:2px 16px 16px}
.rs-sec-b{overflow:hidden}
.rs-sec.closing .rs-chev{transform:rotate(45deg) translateY(-2px)}
.rs-sec-h{display:flex;align-items:center;gap:8px;min-height:48px;padding:0 12px 0 16px;cursor:pointer;list-style:none;user-select:none}
.rs-sec-h::-webkit-details-marker{display:none}
.rs-sec-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;padding-block:9px}
.rs-sec-t h3{margin:0}
.rs-sum{display:block;font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-sum.set{color:var(--accent)}
.rs-sec[open] .rs-sum:not(.set){color:var(--text-3)}
.rs-sec-h:hover{background:var(--hover)}
.rs-sec-h:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.rs-chev{flex:none;width:7px;height:7px;margin-inline:6px 4px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(45deg) translateY(-2px);transition:transform .15s}
.rs-sec[open] .rs-chev{transform:rotate(-135deg) translate(-1px,-1px)}
.rs-sec:not([open]) .rs-reset:disabled{visibility:hidden}
.rs-sec-h h3{margin:0;font-size:13px;font-weight:650;letter-spacing:.005em}
.rs-sec-h h3 i{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-inline-start:6px;vertical-align:2px}
.rs-sec-h h3 i[hidden]{display:none}
.rs-reset{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 8px;border:0;border-radius:7px;background:none;color:var(--muted);
  font-size:12px;cursor:pointer}
.rs-reset .vx-i{width:13px;height:13px}
.rs-reset:hover:not(:disabled){background:var(--hover);color:var(--fg)}
.rs-reset:disabled{opacity:.45;cursor:default}
.rs-row{display:flex;flex-direction:column;gap:6px;min-width:0}
.rs-lab{font-size:12px;font-weight:550;color:var(--text-2)}
.rs-sub{font-size:11px;color:var(--muted);margin:2px 0 -2px}

/* grids of tiles: fonts and colours */
.rs-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.rs-tile{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-height:62px;padding:7px 4px;border-radius:10px;
  border:1px solid var(--line);background:none;color:var(--muted);font-size:11.5px;cursor:pointer;min-width:0;transition:border-color .15s,background .15s,color .15s}
.rs-tile:hover{border-color:var(--line-strong);color:var(--fg)}
.rs-tile[aria-checked=true]{border-color:var(--accent);background:var(--accent-soft);color:var(--fg)}
.rs-tile>span:last-child{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-tile b{font-size:19px;line-height:1;font-weight:600;color:var(--fg)}
.rs .rs-sw.vx-note-scroll{flex:none;display:flex;align-items:center;justify-content:center;gap:4px;width:100%;max-width:58px;height:30px;overflow:hidden;
  border-radius:7px;border:1px solid var(--line-strong);background:var(--paper);color:var(--fg);transition:none}
.rs-sw b{font-size:13px;font-weight:650;color:var(--fg)}
.rs-sw i{width:6px;height:6px;border-radius:50%;background:var(--accent)}
.rs-ff-sans{font-family:var(--font)}
.rs-ff-system{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.rs-ff-serif{font-family:${SERIF}}
.rs-ff-book{font-family:"Memora Literata",Georgia,serif}
.rs-ff-humanist{font-family:"Memora Plex","Segoe UI",sans-serif}
.rs-ff-legible{font-family:"Memora Atkinson",sans-serif}
.rs-ff-rounded{font-family:"Memora Nunito",sans-serif}
.rs-ff-dyslexic{font-family:"Memora OpenDyslexic",sans-serif}
.rs-tile b.rs-ff-dyslexic{font-size:16px}
.rs-ff-mono{font-family:var(--mono)}
.rs-tile b.rs-ff-mono{font-size:17px}

/* text size */
.rs-size{display:flex;align-items:center;gap:8px}
.rs-size button{flex:none;width:36px;height:34px;display:grid;place-items:center;border:1px solid var(--line);border-radius:9px;background:none;cursor:pointer;font-weight:600}
.rs-size button:hover:not(:disabled){border-color:var(--line-strong);background:var(--hover)}
.rs-size button:disabled{opacity:.4;cursor:default}
.rs-size input{flex:1;min-width:0;accent-color:var(--accent);height:24px;margin:0}
.rs-size output{flex:none;min-width:42px;text-align:end;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}

/* switches */
.rs-switch{display:flex;align-items:center;gap:10px;width:100%;min-height:36px;padding:0;border:0;background:none;cursor:pointer;text-align:start}
.rs-switch>span{flex:1;min-width:0;font-size:12.5px;color:var(--text-2)}
.rs-switch>i{flex:none;position:relative;width:34px;height:20px;border-radius:99px;background:color-mix(in srgb,var(--fg) 28%,transparent);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fg) 30%,transparent);transition:background .15s}
.rs-switch>i::after{content:"";position:absolute;inset-block-start:2px;inset-inline-start:2px;width:16px;height:16px;border-radius:50%;background:#fff;
  box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s var(--ease,ease)}
.rs-switch[aria-checked=true]>i{background:var(--accent)}
.rs-switch[aria-checked=true]>i::after{transform:translateX(14px)}
.rs-switch:dir(rtl)[aria-checked=true]>i::after{transform:translateX(-14px)}

/* little pictures in segmented choices */
.rs-pic{display:inline-flex;flex-direction:column;justify-content:center;width:16px;height:14px;flex:none}
.rs-pic b{display:block;height:2px;border-radius:1px;background:currentColor}
.rs-pic.lh-compact{gap:1px}.rs-pic.lh-normal{gap:2.5px}.rs-pic.lh-relaxed{gap:3.5px}.rs-pic.lh-loose{gap:4.5px}
.rs-pic.wd{align-items:center;border-inline:2px solid currentColor;padding:0 2px;box-sizing:border-box;width:18px}
.rs-pic.wd b{height:8px;opacity:.55}
.rs-pic.wd-narrow b{width:4px}.rs-pic.wd-normal b{width:7px}.rs-pic.wd-wide b{width:10px}.rs-pic.wd-full b{width:100%}
.rs-pic.al b:nth-child(2){width:70%}.rs-pic.al-justify b:nth-child(2){width:100%}

.rs-accent .cpk{gap:6px}
.rs-accent .cpk-sw,.rs-accent .cpk-box{width:24px;height:24px}
.rs-accent .cpk-hex{width:84px;height:28px}

.rs-foot{position:sticky;bottom:0;z-index:2;display:flex;align-items:center;gap:8px;padding:12px 16px 14px;border-top:1px solid var(--line);background:var(--panel)}
.rs-foot span{flex:1;font-size:11.5px;color:var(--muted)}
.rs-foot .rs-reset{border:1px solid var(--line);height:30px;padding:0 10px}

/* Spacing: one rhythm for the whole panel (20px edges, 18px between rows, 8px inside a row). */
.vx-side.vx-pop-rs .vx-pop-card{width:404px}
.vx-pop.vx-pop-rs:not(.vx-side) .vx-pop-card{width:404px}
.vx-pop-rs .vx-pop-head{padding:10px 10px 6px 20px}
.rs-top{gap:12px;padding:4px 20px 16px}
.rs-sec-h{min-height:58px;padding:0 14px 0 20px}
.rs-sec-t{padding-block:11px;gap:3px}
.rs-sec-b{gap:18px;padding:6px 20px 22px}
.rs-row{gap:9px}
.rs-lab{font-size:12.5px;font-weight:600}
.rs-sub{margin:6px 0 0;font-size:11.5px}
.rs-row>.rs-sub:first-of-type{margin-top:0}
.rs-grid{gap:8px}
.rs-grid+.rs-sub{margin-top:12px}
.rs-tile{min-height:74px;padding:10px 6px;gap:7px;border-radius:12px;font-size:12px}
.rs .rs-sw.vx-note-scroll{height:32px;max-width:64px;border-radius:8px}
.rs-seg{gap:4px;padding:4px;border-radius:12px}
.rs-seg>button{min-height:38px;padding:6px 8px;border-radius:9px}
.rs-seg>button:has(.rs-pic){min-height:52px;padding:8px 4px}
.rs-seg.wrap{row-gap:4px}
.rs-size{gap:10px}
.rs-size button{width:40px;height:38px;border-radius:10px}
.rs-switch{min-height:42px}
.rs-switch+.rs-switch{border-top:1px solid var(--line)}
.rs-own{padding:9px 12px;border-radius:10px}
.rs-accent .cpk{gap:8px}
.rs-foot{padding:14px 20px 16px}
.vx-sheet.vx-pop-rs .rs-top,.vx-sheet.vx-pop-rs .rs-sec-b{padding-inline:18px}
.vx-sheet.vx-pop-rs .rs-sec-h{padding-inline:18px 12px;min-height:60px}
.vx-sheet .rs-seg>button{min-height:42px}
.vx-sheet .rs-tile{min-height:78px}
.vx-sheet .rs-switch{min-height:48px}

@media (prefers-reduced-motion:reduce){.rs *{transition:none!important}}
/* phones: bigger targets */
.vx-sheet .rs-seg>button{min-height:38px;font-size:13px}
.vx-sheet .rs-tile{min-height:68px}
.vx-sheet .rs-reset{height:32px}
.vx-sheet .rs-switch{min-height:44px}
.vx-sheet .rs-sec-h{min-height:52px}
.vx-sheet .rs-size button{width:44px;height:40px}
`;

export const READING_CSS = TONES_CSS + NOTE_CSS + PANEL_CSS;
