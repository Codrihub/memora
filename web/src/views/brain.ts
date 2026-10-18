// 3D brain view: every note is a particle inside a brain-shaped volume, and
// live agent activity pulses through it. Implementation lives in ../brain/.

import { BrainController } from '../brain/controller';
import type { BrainView } from '../brain/home-view';

let current: BrainController | null = null;

/** The live brain view's camera, for the splash hand-off; null when not shown. */
export function brainView(): BrainView | null {
  return current && current.alive() ? current.view() : null;
}

export async function renderBrain(): Promise<void> {
  const section = document.getElementById('view-brain');
  if (!section) return;
  // Re-render (router refresh after a mutation): keep the scene, refresh data.
  if (current && current.alive()) {
    current.scheduleRefresh();
    return;
  }
  current?.destroy();
  current = new BrainController(section);
}
