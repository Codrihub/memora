// Snapshot of the hooks.ts defaults, taken before any other module runs (it is
// the first import of main.ts). The shell uses it to tell whether another
// package (the Vault tree) already installed its own tree renderer, so the
// shell's fallback never overwrites it.

import { hooks } from '../hooks';

export const DEFAULT_RENDER_TREE = hooks.renderTree;
export const DEFAULT_REFRESH_TREE = hooks.refreshTree;
