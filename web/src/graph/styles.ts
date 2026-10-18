// Graph view styles (kept in TypeScript per the UI contract). Colours come
// from the theme tokens with dark fallbacks.

import { useStyles } from '../dom';

const CSS = `
#view-graph{padding:0 !important;overflow:hidden !important}
.gx{position:absolute;inset:0;overflow:hidden;background:var(--bg,#0b0e14);color:var(--fg,#e6e9ef);
  --gx-glass:var(--panel,#12161f);
  --gx-line:var(--line,#232a38);--gx-mut:var(--muted,#8b98ad);
  -webkit-user-select:none;user-select:none;font-size:13px}
.gx-cv{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;outline:none}
.gx-cv.grabbing{cursor:grabbing}.gx-cv.pointing{cursor:pointer}
.gx-glass{background:var(--gx-glass);border:1px solid var(--gx-line);border-radius:12px;
  backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);
  box-shadow:0 10px 30px rgba(0,0,0,.18)}
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
