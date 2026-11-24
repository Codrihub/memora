// One navigation model for every menu: the desktop sidebar (and its rail), the profile menu and the
// phone's More sheet all draw the same groups, so a page is found in the same place everywhere.

import { t } from '../i18n';
import type { Page } from '../state';

export interface NavGroup {
  id: 'workspace' | 'agents' | 'system';
  label: string;
  pages: Page[];
}

/** The pages people move between, grouped as they think of them. */
export const NAV_GROUPS: NavGroup[] = [
  { id: 'workspace', label: t('Workspace'), pages: ['home', 'vault', 'boards', 'tags', 'brain'] },
  { id: 'agents', label: t('Agents'), pages: ['assistant', 'logs', 'keys'] },
  { id: 'system', label: t('System'), pages: ['tools', 'access', 'settings', 'trash'] },
];

/** Desktop and tablet sidebar: the workspace and agents groups; system pages sit in its footer
 *  (Trash, Settings) and the profile menu (Tools, Access rules). */
export const SIDEBAR_GROUPS: NavGroup['id'][] = ['workspace', 'agents'];
/** In the sidebar footer, always in reach. */
export const SIDEBAR_FOOT: Page[] = ['trash', 'settings'];
/** Phones: the bottom bar's destinations; every other page is in More. */
export const TAB_PAGES: Page[] = ['home', 'vault', 'brain', 'logs'];

/** The page a nav entry stands for while `page` is open (Graph and Canvas are modes of Brain). */
export function navPage(page: Page): Page {
  return page === 'graph' || page === 'canvas' ? 'brain' : page;
}

export function groupOf(id: NavGroup['id']): NavGroup {
  return NAV_GROUPS.find((g) => g.id === id)!;
}
