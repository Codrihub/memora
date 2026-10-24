// First import of main.ts: lets the shell tell whether the Vault tree already replaced the default renderer.

import { hooks } from '../hooks';

export const DEFAULT_RENDER_TREE = hooks.renderTree;
export const DEFAULT_REFRESH_TREE = hooks.refreshTree;
