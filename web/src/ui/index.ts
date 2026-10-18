// Design system entry: installs the token, component and shell styles once,
// in cascade order: tokens, then components, then the shell.

import { useStyles } from '../dom';
import { COMPONENTS_CSS } from './components';
import { SHELL_CSS } from './shell';
import { TOKENS_CSS } from './tokens';

export function installStyles(): void {
  useStyles('ui-tokens', TOKENS_CSS);
  useStyles('ui-components', COMPONENTS_CSS);
  useStyles('ui-shell', SHELL_CSS);
}
