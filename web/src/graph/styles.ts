import { useStyles } from '../dom';

const CSS = `
#view-graph{padding:0 !important;overflow:hidden !important}
.gx{position:absolute;inset:0;overflow:hidden;background:var(--bg,#0b0e14);color:var(--fg,#e6e9ef);
  --gx-line:var(--line,#232a38);--gx-mut:var(--muted,#8b98ad);
  -webkit-user-select:none;user-select:none;font-size:13px}
.gx-cv{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;outline:none}
.gx-cv.grabbing{cursor:grabbing}.gx-cv.pointing{cursor:pointer}
.gx-glass{background:var(--ovl-bg);border:1px solid var(--line-strong,var(--gx-line));border-radius:8px;
  backdrop-filter:var(--ovl-filter);-webkit-backdrop-filter:var(--ovl-filter);box-shadow:none}
.gx-tip{position:absolute;z-index:8;pointer-events:none;padding:6px 9px;font-size:12px;max-width:260px;transform:translate(14px,14px)}
.gx-tip b{display:block;font-weight:650}
.gx-tip span{color:var(--gx-mut);font-size:11.5px}
.gx-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;color:var(--gx-mut);z-index:3;pointer-events:none;text-align:center;padding:24px}
.gx-empty b{color:var(--fg,#e6e9ef);font-size:15px}
.gx-hide{display:none !important}
`;

export function graphStyles(): void {
  useStyles('gx-styles', CSS);
}
