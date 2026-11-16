// Keeps the sign-in alive while the owner is using the app. Every API call already renews the
// session (and its cookie); reading or scrolling a note makes none, so while there was input
// in the last few minutes and the tab is visible, a light ping renews it too. An idle or
// hidden tab sends nothing, so the idle timeout (Settings, Server) still applies.

import { apiGet } from './api';

const EVERY = 4 * 60_000;
const ACTIVE_FOR = 10 * 60_000;

let lastInput = Date.now();
let lastPing = Date.now();

function ping(): void {
  lastPing = Date.now();
  void apiGet('/api/auth/me').catch(() => undefined);
}

export function initKeepAlive(): void {
  const mark = (): void => {
    lastInput = Date.now();
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const) {
    window.addEventListener(ev, mark, { passive: true, capture: true });
  }
  window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastInput > ACTIVE_FOR || Date.now() - lastPing < EVERY) return;
    ping();
  }, 60_000);
  // Back to the tab after a while: renew straight away (or find out the session ended).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastPing > EVERY) {
      mark();
      ping();
    }
  });
}
