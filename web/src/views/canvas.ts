// Canvas view: an infinite, Figma-like board of note cards inside folder
// frames, with wikilink connectors. The board itself lives in canvas/*.

import { useStyles } from '../dom';
import { Board } from '../canvas/board';
import { CANVAS_CSS } from '../canvas/styles';
import { setFlightTarget } from '../ui/agent-flight';

let board: Board | null = null;
let booting: Promise<void> | null = null;

export async function renderCanvas(): Promise<void> {
  const host = document.getElementById('view-canvas');
  if (!host) return;
  useStyles('canvas-view-css', CANVAS_CSS);
  if (!board) {
    // Agents fly to the card of the note they touch.
    setFlightTarget('canvas', (_actor, _id, paths) => {
      for (const p of paths) {
        const el = host.querySelector<HTMLElement>(`.cv-card[data-path="${CSS.escape(p)}"]`);
        const r = el?.getBoundingClientRect();
        if (r && r.width) return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 40) };
      }
      return null;
    });
    board = new Board(host);
    booting = board.init();
    await booting;
    booting = null;
    return;
  }
  if (booting) await booting;
  board.refresh();
}
