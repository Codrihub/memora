// Styles for the documentation page. Layout widths follow the page's own
// width (container queries on #view-docs), so the collapsed sidebar rail
// gives the article more room.

export const DOCS_CSS = `
#view-docs{padding:0;overflow:hidden;container:docs/inline-size}
.dc{height:100%;display:grid;grid-template-columns:248px minmax(0,1fr);grid-template-rows:minmax(0,1fr);position:relative}
.dc-mbar{display:none}

/* sidebar */
.dc-side{grid-column:1;grid-row:1;min-height:0;overflow:auto;border-right:1px solid var(--line);padding:20px 14px 40px;
  display:flex;flex-direction:column;gap:14px;background:var(--surface-0)}
.dc-search{position:relative}
.dc-search .i{position:absolute;left:11px;top:50%;transform:translateY(-50%);width:15px;height:15px;color:var(--text-3);pointer-events:none}
.dc-search input{width:100%;height:36px;padding:0 12px 0 33px;border-radius:10px;background:var(--surface-1);border:1px solid var(--line-strong);
  font-size:13px;outline:none;transition:border-color var(--dur-1),box-shadow var(--dur-1)}
.dc-search input::placeholder{color:var(--text-3)}
.dc-search input:focus{border-color:var(--accent-line);box-shadow:0 0 0 3px var(--accent-soft)}
.dc-search input::-webkit-search-cancel-button{display:none}
.dc-nav{display:flex;flex-direction:column;gap:16px}
.dc-group-t{margin:0 0 4px;padding:0 10px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3)}
.dc-nav ul{list-style:none;margin:0;padding:0}
.dc-link{display:block;padding:6px 10px;border-radius:8px;font-size:13.5px;color:var(--text-2);line-height:1.35;
  transition:background var(--dur-1),color var(--dur-1)}
.dc-link:hover{background:var(--hover);color:var(--fg);text-decoration:none}
.dc-link.active{background:var(--accent-soft);color:var(--accent);font-weight:600}
.dc-sub{margin:4px 0 6px 14px !important;border-left:1px solid var(--line)}
.dc-sub a{display:block;padding:4px 10px;margin-left:-1px;border-left:2px solid transparent;font-size:12.5px;color:var(--muted);line-height:1.4}
.dc-sub a:hover{color:var(--fg);text-decoration:none}
.dc-sub a.on{color:var(--fg);border-left-color:var(--accent)}
.dc-hit{display:block;padding:7px 10px;border-radius:8px;color:var(--text-2);font-size:13.5px}
.dc-hit:hover,.dc-hit.kb{background:var(--hover);color:var(--fg);text-decoration:none}
.dc-hit small{display:block;color:var(--text-3);font-size:11.5px;margin-top:1px}
.dc-hit-sub{display:block;padding:4px 10px 4px 22px;font-size:12.5px;color:var(--muted)}
.dc-hit-sub:hover{color:var(--fg);text-decoration:none}
.dc-nav mark{background:var(--accent-soft);color:var(--accent);border-radius:3px;padding:0 1px}
.dc-empty{padding:8px 10px;color:var(--muted);font-size:13px}

/* content column */
.dc-main{grid-column:2;grid-row:1;min-width:0;min-height:0;overflow:auto;padding:40px 48px 96px;scroll-behavior:auto}
.dc-article{max-width:760px;margin:0 auto}
.dc-eyebrow{font-size:12.5px;font-weight:650;color:var(--accent);margin:0 0 8px}
.dc-article>h1{font-size:32px;line-height:1.2;font-weight:750;letter-spacing:-.025em;margin:0;color:var(--text-1)}
.dc-lead{font-size:16.5px;line-height:1.6;color:var(--text-2);margin:12px 0 0}
.dc-meta{display:flex;flex-wrap:wrap;gap:6px 16px;margin:16px 0 0;padding:0 0 22px;border-bottom:1px solid var(--line);font-size:12.5px;color:var(--text-3)}
.dc-meta a{color:var(--muted);display:inline-flex;align-items:center;gap:6px}
.dc-meta a:hover{color:var(--fg)}
.dc-meta .i{width:14px;height:14px}

.dc-body{font-size:15px;line-height:1.72;color:var(--text-2);padding-top:8px}
.dc-body>:first-child{margin-top:20px}
.dc-body p{margin:14px 0}
.dc-body strong,.dc-body b{color:var(--text-1);font-weight:650}
.dc-body a{color:var(--accent-3);text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--accent-3) 35%,transparent);text-underline-offset:3px}
.dc-body a:hover{text-decoration-color:currentColor}
.dc-body a.dc-ext::after{content:"↗";font-size:.8em;margin-left:2px;color:var(--text-3);text-decoration:none;display:inline-block}
.dc-h{position:relative;color:var(--text-1);scroll-margin-top:20px}
.dc-body h2{font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-.015em;margin:48px 0 12px;padding-top:4px}
.dc-body h3{font-size:17px;line-height:1.35;font-weight:650;margin:32px 0 8px}
.dc-body h4,.dc-body h5,.dc-body h6{font-size:15px;font-weight:650;margin:24px 0 6px;color:var(--text-1)}
.dc-anchor{margin-left:8px;color:var(--text-3);opacity:0;text-decoration:none !important;font-weight:500;transition:opacity var(--dur-1)}
.dc-h:hover .dc-anchor,.dc-anchor:focus-visible{opacity:1}
.dc-body .dc-anchor{color:var(--text-3)}
.dc-body .dc-anchor:hover{color:var(--accent)}
.dc-body ul,.dc-body ol{margin:12px 0;padding-left:1.5em}
.dc-body li{margin:5px 0}
.dc-body li>ul,.dc-body li>ol{margin:4px 0}
.dc-body li::marker{color:var(--text-3)}
.dc-task{list-style:none;margin-left:-1.3em !important}
.dc-box{display:inline-block;width:13px;height:13px;border:1.5px solid var(--line-strong);border-radius:4px;margin-right:8px;vertical-align:-1px}
.dc-box.on{background:var(--accent);border-color:var(--accent)}
.dc-body hr{border:0;border-top:1px solid var(--line);margin:32px 0}
.dc-body code{font-family:var(--mono);font-size:.84em;padding:.12em .4em;border-radius:6px;background:var(--surface-2);
  border:1px solid var(--line);color:var(--text-1);overflow-wrap:anywhere}
.dc-body blockquote{margin:16px 0;padding:2px 16px;border-left:3px solid var(--line-strong);color:var(--muted)}
.dc-muted{color:var(--muted)}

/* code blocks */
.dc-code{margin:16px 0;border:1px solid var(--line);border-radius:var(--r);background:var(--surface-1);overflow:hidden}
.dc-code-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;height:36px;padding:0 6px 0 14px;
  border-bottom:1px solid var(--line);background:var(--surface-2)}
.dc-code-bar span{font:600 11.5px/1 var(--mono);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dc-copy{height:26px;padding:0 10px;border-radius:7px;font-size:12px;font-weight:600;color:var(--text-2);border:1px solid transparent;
  transition:background var(--dur-1),color var(--dur-1),border-color var(--dur-1)}
.dc-copy:hover{background:var(--hover);color:var(--fg);border-color:var(--line)}
.dc-copy.done{color:var(--ok)}
.dc-code pre{margin:0;padding:14px 16px;overflow:auto;font:12.75px/1.65 var(--mono);color:var(--text-1);tab-size:2}
.dc-code pre code{all:unset;font:inherit;white-space:pre}
.dc-prompt pre{white-space:pre-wrap;max-height:none}
.dc-prompt pre code{white-space:pre-wrap}

/* tables */
.dc-table{margin:16px 0;overflow-x:auto;border:1px solid var(--line);border-radius:var(--r)}
.dc-table table{width:100%;border-collapse:collapse;font-size:13.5px;line-height:1.55}
.dc-table th{text-align:left;font-weight:650;color:var(--text-1);background:var(--surface-2);white-space:nowrap}
.dc-table th,.dc-table td{padding:9px 14px;border-bottom:1px solid var(--line);vertical-align:top}
.dc-table tr:last-child td{border-bottom:0}
.dc-table td code{white-space:nowrap}
.dc-table td:first-child code{white-space:nowrap}

/* callouts */
.dc-callout{margin:18px 0;padding:12px 16px;border-radius:var(--r);border:1px solid var(--line);border-left:3px solid var(--info);
  background:color-mix(in srgb,var(--info) 7%,transparent);font-size:14px}
.dc-callout.warning{border-left-color:var(--warn);background:var(--warn-soft)}
.dc-callout.tip{border-left-color:var(--ok);background:var(--ok-soft)}
.dc-callout-t{display:block;font-size:13px;font-weight:700;color:var(--info);margin-bottom:2px}
.dc-callout.warning .dc-callout-t{color:var(--warn)}
.dc-callout.tip .dc-callout-t{color:var(--ok)}
.dc-callout p{margin:4px 0}

/* steps and cards */
.dc-steps{list-style:none;padding:0 !important;margin:20px 0;counter-reset:dcs}
.dc-steps>li{position:relative;padding:0 0 18px 44px;margin:0;counter-increment:dcs}
.dc-steps>li::before{content:counter(dcs);position:absolute;left:0;top:0;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;
  font:700 13px/1 var(--font);color:var(--accent);background:var(--accent-soft);border:1px solid var(--accent-line)}
.dc-steps>li::after{content:"";position:absolute;left:14px;top:34px;bottom:4px;width:1px;background:var(--line)}
.dc-steps>li:last-child::after{display:none}
.dc-steps>li>b{display:block;color:var(--text-1);font-size:15.5px;line-height:28px}
.dc-steps>li p{margin:4px 0 8px}
.dc-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:18px 0}
.dc-body a.dc-card{display:flex;flex-direction:column;gap:3px;padding:14px 16px;border:1px solid var(--line);border-radius:var(--r);
  background:var(--surface-1);text-decoration:none;transition:border-color var(--dur-1),background var(--dur-1)}
.dc-body a.dc-card:hover{border-color:var(--accent-line);background:var(--surface-2)}
.dc-card b{color:var(--text-1);font-size:14px}
.dc-card span{color:var(--muted);font-size:13px;line-height:1.5}
.dc-body a.dc-btn{text-decoration:none;color:var(--on-primary)}

/* tool reference */
.dc-legend{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}
.dc-toolrows{border:1px solid var(--line);border-radius:var(--r);overflow:hidden;margin:12px 0 8px}
.dc-tool{padding:12px 16px;border-top:1px solid var(--line);background:var(--surface-1)}
.dc-tool:first-child{border-top:0}
.dc-tool.off{opacity:.65}
.dc-tool-h{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.dc-tool-h code{font-size:13px !important;font-weight:600}
.dc-tool-t{color:var(--muted);font-size:13px;flex:1 1 auto}
.dc-tool-d{font-size:13.5px;line-height:1.6;margin-top:4px}
.dc-keys{display:inline-flex;gap:4px;margin-right:6px}

/* pager */
.dc-pager{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:56px 0 0;padding-top:24px;border-top:1px solid var(--line)}
.dc-pager a{display:flex;flex-direction:column;gap:2px;padding:14px 16px;border:1px solid var(--line);border-radius:var(--r);
  color:var(--text-1);font-weight:650;font-size:14.5px;transition:border-color var(--dur-1)}
.dc-pager a:hover{border-color:var(--accent-line);text-decoration:none}
.dc-pager a small{font-size:12px;font-weight:500;color:var(--muted)}
.dc-pager a.next{text-align:right;grid-column:2}

/* on this page */
.dc-toc{display:none}
@container docs (min-width:1100px){
  .dc{grid-template-columns:248px minmax(0,1fr) 216px}
  .dc-toc{display:block;grid-column:3;grid-row:1;min-height:0;overflow:auto;padding:40px 20px 40px 4px}
}
.dc-toc-t{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);margin:0 0 10px}
.dc-toc ul{list-style:none;margin:0;padding:0;border-left:1px solid var(--line)}
.dc-toc a{display:block;padding:4px 0 4px 12px;margin-left:-1px;border-left:2px solid transparent;font-size:12.5px;line-height:1.4;color:var(--muted)}
.dc-toc a.l3{padding-left:24px;font-size:12px}
.dc-toc a:hover{color:var(--fg);text-decoration:none}
.dc-toc a.on{color:var(--accent);border-left-color:var(--accent)}
.dc-top{margin-top:14px;font-size:12px;color:var(--muted);display:inline-flex;align-items:center;gap:4px}
.dc-top:hover{color:var(--fg);text-decoration:none}
.dc-top .i{width:14px;height:14px;transform:rotate(-90deg)}

/* narrow: the sidebar becomes a drawer under a section bar */
@container docs (max-width:860px){
  .dc{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
  .dc-mbar{display:flex;grid-row:1;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--surface-0);z-index:3}
  .dc-mtoggle{flex:1;min-width:0;display:flex;align-items:center;gap:10px;height:42px;padding:0 12px;border-radius:11px;
    border:1px solid var(--line-strong);background:var(--surface-1);font-size:14px;font-weight:600;color:var(--fg);text-align:left}
  .dc-mtoggle>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dc-mtoggle small{color:var(--muted);font-weight:500}
  .dc-mtoggle .i{width:17px;height:17px;color:var(--muted);transition:transform var(--dur-2)}
  .dc.nav-open .dc-mtoggle .chev{transform:rotate(180deg)}
  .dc-side{display:none;position:absolute;left:0;right:0;top:63px;bottom:0;z-index:4;border-right:0;padding:16px 14px 32px;
    box-shadow:var(--shadow);animation:dcDrop var(--dur-2) var(--ease-out)}
  .dc.nav-open .dc-side{display:flex}
  .dc-search input{height:42px;font-size:15px}
  .dc-link{padding:9px 10px;font-size:15px}
  .dc-main{grid-column:1;grid-row:2;padding:22px 16px 64px}
  .dc-article>h1{font-size:26px}
  .dc-lead{font-size:15.5px}
  .dc-body{font-size:15px}
  .dc-body h2{font-size:20px;margin-top:40px}
  .dc-cards{grid-template-columns:1fr}
  .dc-pager{grid-template-columns:1fr}
  .dc-pager a.next{grid-column:1}
  .dc-code pre{font-size:12.5px}
  .dc-anchor{opacity:.4}
}
@keyframes dcDrop{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
`;
