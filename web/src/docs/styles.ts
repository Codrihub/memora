// Documentation page styles. Widths follow container queries on #view-docs, so a collapsed sidebar widens the article.

export const DOCS_CSS = `
#view-docs{padding:0;overflow:hidden;container:docs/inline-size;background:var(--surface-0)}
.dc{height:100%;display:grid;grid-template-columns:236px minmax(0,1fr);grid-template-rows:minmax(0,1fr);position:relative}
.dc-mbar{display:none}

.dc-side{grid-column:1;grid-row:1;min-height:0;overflow:auto;padding:24px 12px 40px 20px;display:flex;flex-direction:column;gap:18px;background:var(--surface-0)}
.dc-search{position:relative}
.dc-search .i{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--muted);pointer-events:none}
.dc-search input{width:100%;height:40px;padding:0 12px 0 36px;border-radius:10px;background:color-mix(in srgb,var(--fg) 5%,transparent);border:1px solid transparent;
  font-size:14px;outline:none;transition:border-color var(--dur-1),background var(--dur-1)}
.dc-search input:hover{border-color:var(--line)}
.dc-search input::placeholder{color:var(--text-3)}
.dc-search input:focus{border-color:var(--line-strong);background:var(--surface-1)}
.dc-search input::-webkit-search-cancel-button{display:none}
.dc-nav{display:flex;flex-direction:column;gap:18px}
.dc-group-t{margin:0 0 6px;padding:0 12px;font-size:12px;font-weight:500;color:var(--text-3)}
.dc-nav ul{list-style:none;margin:0;padding:0}
.dc-link{position:relative;display:flex;align-items:center;min-height:36px;padding:6px 12px;border-radius:10px;font-size:14px;font-weight:500;color:var(--text-2);line-height:1.35;
  border:1px solid transparent;transition:background var(--dur-1),color var(--dur-1)}
.dc-link:hover{background:var(--hover);color:var(--fg);text-decoration:none}
.dc-link.active{background:var(--surface-1);border-color:var(--line-strong);color:var(--fg)}
.dc-link.active::before{content:"";position:absolute;left:-1px;top:50%;width:3px;height:16px;margin-top:-8px;border-radius:0 3px 3px 0;background:var(--brand-mark,var(--accent))}
.dc-sub{margin:4px 0 8px 20px !important;border-left:1px solid var(--line)}
.dc-sub a{display:block;padding:5px 12px;margin-left:-1px;border-left:1px solid transparent;font-size:13px;color:var(--muted);line-height:1.4}
.dc-sub a:hover{color:var(--fg);text-decoration:none}
.dc-sub a.on{color:var(--fg);border-left-color:var(--fg)}
.dc-hit{display:block;padding:8px 12px;border-radius:10px;color:var(--text-2);font-size:14px}
.dc-hit:hover,.dc-hit.kb{background:var(--hover);color:var(--fg);text-decoration:none}
.dc-hit small{display:block;color:var(--text-3);font-size:12px;margin-top:1px}
.dc-hit-sub{display:block;padding:4px 12px 4px 24px;font-size:13px;color:var(--muted)}
.dc-hit-sub:hover{color:var(--fg);text-decoration:none}
.dc-nav mark{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--fg);border-radius:3px;padding:0 1px}
.dc-empty{padding:8px 12px;color:var(--muted);font-size:13px}

.dc-main{grid-column:2;grid-row:1;min-width:0;min-height:0;overflow:auto;padding:16px 16px 64px;scroll-behavior:auto}
.dc-article{max-width:1040px;margin:0 auto;padding:44px 52px 40px;background:var(--surface-1);border:1px solid var(--line);border-radius:16px;min-height:calc(100% - 8px)}
.dc-eyebrow{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--muted);margin:0 0 14px}
.dc-eyebrow .i{width:14px;height:14px;color:var(--text-3)}
.dc-eyebrow span:last-child{color:var(--fg)}
.dc-article>h1{font-size:34px;line-height:1.15;font-weight:650;letter-spacing:-.025em;margin:0;color:var(--text-1)}
.dc-lead{font-size:17px;line-height:1.6;color:var(--muted);margin:14px 0 0;max-width:60ch}
.dc-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:20px 0 0;padding:0 0 28px;border-bottom:1px solid var(--line);font-size:12.5px;color:var(--muted)}
.dc-meta>*{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:99px;border:1px solid var(--line-strong);color:var(--text-2)}
.dc-meta code{font-family:var(--mono);font-size:12px;color:var(--fg)}
.dc-meta a:hover{color:var(--fg);background:var(--hover);text-decoration:none}
.dc-meta .i{width:14px;height:14px;transform:rotate(-45deg)}
.dc-meta:empty{display:block;height:0;border:0;padding:0 0 8px;border-bottom:1px solid var(--line)}

.dc-body{font-size:16px;line-height:1.75;color:var(--text-2);padding-top:4px}
.dc-body>:first-child{margin-top:24px}
.dc-body p{margin:16px 0}
.dc-body strong,.dc-body b{color:var(--text-1);font-weight:600}
.dc-body a{color:var(--text-1);text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--accent) 60%,transparent);text-decoration-thickness:1.5px;text-underline-offset:3px}
.dc-body a:hover{text-decoration-color:currentColor}
.dc-body a.dc-ext::after{content:"↗";font-size:.8em;margin-left:2px;color:var(--text-3);text-decoration:none;display:inline-block}
.dc-h{position:relative;color:var(--text-1);scroll-margin-top:24px}
.dc-body h2{font-size:23px;line-height:1.3;font-weight:650;letter-spacing:-.018em;margin:56px 0 14px}
.dc-body h3{font-size:18px;line-height:1.35;font-weight:600;letter-spacing:-.01em;margin:36px 0 8px}
.dc-body h4,.dc-body h5,.dc-body h6{font-size:16px;font-weight:600;margin:26px 0 6px;color:var(--text-1)}
.dc-anchor{margin-left:8px;color:var(--text-3);opacity:0;text-decoration:none !important;font-weight:500;transition:opacity var(--dur-1)}
.dc-h:hover .dc-anchor,.dc-anchor:focus-visible{opacity:1}
.dc-body .dc-anchor{color:var(--text-3)}
.dc-body .dc-anchor:hover{color:var(--fg)}
.dc-body ul,.dc-body ol{margin:14px 0;padding-left:1.4em}
.dc-body li{margin:6px 0;padding-left:.2em}
.dc-body li>ul,.dc-body li>ol{margin:4px 0}
.dc-body li::marker{color:var(--text-3)}
.dc-task{list-style:none;margin-left:-1.3em !important}
.dc-box{display:inline-block;width:14px;height:14px;border:1.5px solid var(--line-strong);border-radius:4px;margin-right:8px;vertical-align:-2px}
.dc-box.on{background:var(--fg);border-color:var(--fg)}
.dc-body hr{border:0;border-top:1px solid var(--line);margin:40px 0}
.dc-body code{font-family:var(--mono);font-size:.84em;padding:.14em .42em;border-radius:6px;background:color-mix(in srgb,var(--fg) 6%,transparent);
  border:0;color:var(--text-1);overflow-wrap:anywhere}
.dc-body blockquote{margin:20px 0;padding:2px 0 2px 18px;border-left:2px solid var(--line-strong);color:var(--muted);font-style:normal}
.dc-muted{color:var(--muted)}

.dc-code{margin:20px 0;border:1px solid var(--line);border-radius:12px;background:var(--surface-0);overflow:hidden}
.dc-code-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;height:38px;padding:0 6px 0 14px;border-bottom:1px solid var(--line);
  background:color-mix(in srgb,var(--fg) 2.5%,transparent)}
.dc-code-bar span{display:inline-flex;align-items:center;gap:8px;font:500 12px/1 var(--mono);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dc-code-bar span::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--brand-mark,var(--accent));flex:none}
.dc-copy{height:28px;padding:0 10px;border-radius:8px;font-size:12.5px;font-weight:550;color:var(--text-2);border:1px solid transparent;
  transition:background var(--dur-1),color var(--dur-1),border-color var(--dur-1)}
.dc-copy:hover{background:var(--hover);color:var(--fg);border-color:var(--line)}
.dc-copy.done{color:var(--ok)}
.dc-code pre{margin:0;padding:16px 18px;overflow:auto;font:13px/1.7 var(--mono);color:var(--text-1);tab-size:2}
.dc-code pre code{all:unset;font:inherit;white-space:pre}
.dc-prompt pre{white-space:pre-wrap;max-height:none}
.dc-prompt pre code{white-space:pre-wrap}

.dc-pstyle{display:flex;flex-wrap:wrap;width:fit-content;max-width:100%;margin:6px 0 0}
.dc-pstyle button{height:auto;min-height:32px;padding:4px 12px;text-align:left}
.dc-pstyle .rec{font-size:11px;font-weight:600;color:var(--accent)}
.dc-pstyle-desc{margin:10px 0 0;font-size:14px;color:var(--muted)}

.dc-table{margin:20px 0;overflow-x:auto;border:1px solid var(--line);border-radius:12px}
.dc-table table{width:100%;border-collapse:collapse;font-size:14px;line-height:1.55}
.dc-table th{text-align:left;font-size:12px;font-weight:500;color:var(--muted);background:color-mix(in srgb,var(--fg) 2.5%,transparent);white-space:nowrap}
.dc-table th,.dc-table td{padding:11px 16px;border-bottom:1px solid var(--line);vertical-align:top}
.dc-table tr:last-child td{border-bottom:0}
.dc-table td code{white-space:nowrap}
.dc-table td:first-child code{white-space:nowrap}

.dc-callout{margin:22px 0;padding:14px 18px;border-radius:12px;border:1px solid var(--line);background:color-mix(in srgb,var(--fg) 3%,transparent);font-size:15px}
.dc-callout-t{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;color:var(--text-1);margin-bottom:2px}
.dc-callout-t::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--info);flex:none}
.dc-callout.warning .dc-callout-t::before{background:var(--warn)}
.dc-callout.tip .dc-callout-t::before{background:var(--ok)}
.dc-callout p{margin:4px 0}

.dc-steps{list-style:none;padding:0 !important;margin:24px 0;counter-reset:dcs}
.dc-steps>li{position:relative;padding:0 0 22px 48px;margin:0;counter-increment:dcs}
.dc-steps>li::before{content:counter(dcs);position:absolute;left:0;top:0;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;
  font:600 13px/1 var(--font);color:var(--fg);background:color-mix(in srgb,var(--fg) 6%,transparent);font-variant-numeric:tabular-nums}
.dc-steps>li::after{content:"";position:absolute;left:15px;top:38px;bottom:6px;width:1px;background:var(--line)}
.dc-steps>li:last-child::after{display:none}
.dc-steps>li>b{display:block;color:var(--text-1);font-size:16px;font-weight:600;line-height:30px}
.dc-steps>li p{margin:4px 0 8px}
.dc-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:20px 0}
.dc-body a.dc-card{position:relative;display:flex;flex-direction:column;gap:4px;padding:16px 44px 16px 18px;border:1px solid var(--line);border-radius:12px;
  background:var(--surface-1);text-decoration:none;transition:border-color var(--dur-1),background var(--dur-1)}
.dc-body a.dc-card::after{content:"↗";position:absolute;top:14px;right:16px;font-size:14px;color:var(--text-3);transition:color var(--dur-1),transform var(--dur-1)}
.dc-body a.dc-card:hover{border-color:var(--line-strong);background:color-mix(in srgb,var(--fg) 2%,var(--surface-1))}
.dc-body a.dc-card:hover::after{color:var(--fg);transform:translate(1px,-1px)}
.dc-card b{color:var(--text-1);font-size:14.5px;font-weight:600}
.dc-card span{color:var(--muted);font-size:13.5px;line-height:1.5}
.dc-body a.dc-btn{text-decoration:none;color:var(--on-primary)}

.dc-legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin:16px 0}
.dc-toolrows{border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:12px 0 8px}
.dc-tool{padding:14px 18px;border-top:1px solid var(--line);background:var(--surface-1)}
.dc-tool:first-child{border-top:0}
.dc-tool.off{opacity:.65}
.dc-tool-h{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.dc-tool-h code{font-size:13px !important;font-weight:550}
.dc-tool-t{color:var(--muted);font-size:13.5px;flex:1 1 auto}
.dc-tool-d{font-size:14px;line-height:1.6;margin-top:4px}
.dc-keys{display:inline-flex;gap:4px;margin-right:6px}

.dc-pager{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:64px 0 0}
.dc-pager a{display:flex;flex-direction:column;gap:4px;padding:16px 18px;border:1px solid var(--line);border-radius:12px;
  color:var(--text-1);font-weight:600;font-size:15px;transition:border-color var(--dur-1),background var(--dur-1)}
.dc-pager a:hover{border-color:var(--line-strong);background:color-mix(in srgb,var(--fg) 2%,transparent);text-decoration:none}
.dc-pager a small{font-size:12.5px;font-weight:500;color:var(--muted)}
.dc-pager a.prev small::before{content:"← "}
.dc-pager a.next small::after{content:" →"}
.dc-pager a.next{text-align:right;grid-column:2}

/* "On this page" stays hidden: the section list already shows the headings. */
.dc-toc{display:none}
.dc-toc-t{font-size:12px;font-weight:500;color:var(--text-3);margin:0 0 12px}
.dc-toc ul{list-style:none;margin:0;padding:0;border-left:1px solid var(--line)}
.dc-toc a{position:relative;display:block;padding:5px 0 5px 14px;font-size:13px;line-height:1.4;color:var(--muted)}
.dc-toc a.l3{padding-left:26px;font-size:12.5px}
.dc-toc a:hover{color:var(--fg);text-decoration:none}
.dc-toc a.on{color:var(--fg);font-weight:500}
.dc-toc a.on::before{content:"";position:absolute;left:-1.5px;top:6px;bottom:6px;width:2px;border-radius:2px;background:var(--brand-mark,var(--accent))}
.dc-top{margin-top:16px;font-size:12.5px;color:var(--muted);display:inline-flex;align-items:center;gap:6px}
.dc-top:hover{color:var(--fg);text-decoration:none}
.dc-top .i{width:14px;height:14px;transform:rotate(-90deg)}

@container docs (max-width:1180px){.dc-article{padding:40px 40px 36px}}
@container docs (max-width:860px){
  .dc{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
  .dc-mbar{display:flex;grid-row:1;align-items:center;gap:8px;padding:10px 16px;background:var(--surface-0);z-index:3}
  .dc-mtoggle{flex:1;min-width:0;display:flex;align-items:center;gap:10px;height:44px;padding:0 14px;border-radius:12px;
    border:1px solid var(--line-strong);background:var(--surface-1);font-size:14px;font-weight:550;color:var(--fg);text-align:left}
  .dc-mtoggle>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dc-mtoggle small{color:var(--muted);font-weight:500}
  .dc-mtoggle .i{width:18px;height:18px;color:var(--muted);transition:transform var(--dur-2)}
  .dc.nav-open .dc-mtoggle .chev{transform:rotate(180deg)}
  .dc-side{display:none;position:absolute;left:0;right:0;top:64px;bottom:0;z-index:4;padding:12px 16px 32px;
    box-shadow:none;animation:dcDrop var(--dur-2) var(--ease-out)}
  .dc.nav-open .dc-side{display:flex}
  /* the drawer fades at its edges */
  .dc.nav-open .dc-main{visibility:hidden}
  .dc-search input{height:44px;font-size:15px}
  .dc-link{min-height:44px;padding:10px 12px;font-size:15px}
  .dc-main{grid-column:1;grid-row:2;padding:0 12px 48px}
  .dc-article{padding:28px 24px 32px;border-radius:14px}
  .dc-article>h1{font-size:28px}
  .dc-lead{font-size:16px}
  .dc-body h2{font-size:21px;margin-top:44px}
  .dc-cards{grid-template-columns:1fr}
  .dc-pager{grid-template-columns:1fr}
  .dc-pager a.next{grid-column:1}
  .dc-anchor{opacity:.4}
}
@container docs (max-width:520px){
  .dc-mbar{padding:8px 12px}
  .dc-main{padding:0 0 40px}
  .dc-article{padding:24px 16px 28px;border-radius:0;border-left:0;border-right:0}
  .dc-article>h1{font-size:26px}
  .dc-body{font-size:15.5px}
  .dc-code pre{font-size:12.5px}
}
@keyframes dcDrop{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.dc-side{animation:none}}
`;
