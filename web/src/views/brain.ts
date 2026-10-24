// 3D brain view; the implementation lives in ../brain/.

import { BrainController } from '../brain/controller';

let current: BrainController | null = null;

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
