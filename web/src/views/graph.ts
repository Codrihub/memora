// Graph view: mounts ../graph/* and wires the router's stop.

import { GraphApp } from '../graph/app';
import { state } from '../state';
import { setFlightTarget } from '../ui/agent-flight';

let app: GraphApp | null = null;

/** Entering Graph (ui/map-enter.ts): zoom to fit the whole graph. */
export function enterGraph(): void {
  app?.fitAll(500);
}

export async function renderGraph(): Promise<void> {
  const host = document.getElementById('view-graph');
  if (!host) return;
  if (!app || !host.contains(app.root)) {
    app?.suspend();
    app = new GraphApp(host);
    const a = app;
    setFlightTarget('graph', (_actor, _id, paths) => {
      for (const p of paths) {
        const pt = a.clientPoint(p);
        if (pt) return pt;
      }
      return null;
    });
  }
  const current = app;
  state.graph.stop = () => current.suspend();
  current.show();
}
