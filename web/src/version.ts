// The running version and whether a newer release exists, from the server's
// cached release check (`/api/config`). The sidebar shows the version (with an
// update badge when one is out), Settings has a Version section, and a one-time
// toast announces each new release.

import { apiGet } from './api';
import type { Config, UpdateCheck } from './types';

export const RELEASES_URL = 'https://github.com/Codrihub/memora/releases';

/** `ok`: latest is known; `none`: nothing published yet; `error`: the check failed; `off`: disabled. */
export type UpdateState = 'ok' | 'none' | 'error' | 'off' | 'pending';

export interface UpdateInfo {
  current: string;
  /** Newest published release, or null when unknown. */
  latest: string | null;
  available: boolean;
  /** Where to read about and download the release. */
  url: string;
  state: UpdateState;
}

/** True when `a` is a newer semantic version than `b` (pre-releases sort lower). */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string): number[] | null => {
    const [core, pre] = v.trim().replace(/^v/, '').split('-', 2);
    const n = core.split('.').map(Number);
    if (n.length !== 3 || n.some((x) => !Number.isInteger(x) || x < 0)) return null;
    return [...n, pre === undefined ? 1 : 0];
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function fromCheck(current: string, u: UpdateCheck | undefined): UpdateInfo {
  const latest = typeof u?.latest === 'string' && u.latest ? u.latest : null;
  const state: UpdateState =
    u?.state === 'disabled' ? 'off' : u?.state === 'ok' || u?.state === 'none' || u?.state === 'pending' ? u.state : 'error';
  // Compared here too, so a stale answer never claims an older release is new.
  const available = state === 'ok' && !!latest && isNewer(latest, current);
  return {
    current,
    latest: state === 'ok' ? latest : null,
    available,
    url: available && latest ? `${RELEASES_URL}/tag/v${latest}` : RELEASES_URL,
    state,
  };
}

/**
 * Update status for `current`. Pass the `/api/config` answer when already
 * fetched; otherwise it is requested here. A failed request reads as `error`.
 */
export async function updateInfo(current: string, cfg?: Config | null): Promise<UpdateInfo> {
  const c = cfg?.update ? cfg : await apiGet<Config>('/api/config').catch(() => null);
  return fromCheck(current, c?.update);
}

// Settings section to scroll to after navigating there (e.g. from the sidebar).
let pendingSection: string | null = null;

export function requestSettingsSection(id: string): void {
  pendingSection = id;
}

export function takeSettingsSection(): string | null {
  const id = pendingSection;
  pendingSection = null;
  return id;
}
