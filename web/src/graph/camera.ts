export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Camera {
  x = 0;
  y = 0;
  k = 1;
  w = 1;
  h = 1;
  minK = 0.04;
  maxK = 6;
  /** Pan inertia in screen px per frame. */
  vx = 0;
  vy = 0;
  private anim: { x0: number; y0: number; k0: number; x1: number; y1: number; k1: number; t0: number; ms: number } | null = null;

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.w / 2) / this.k + this.x, y: (sy - this.h / 2) / this.k + this.y };
  }

  toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.k + this.w / 2, y: (wy - this.y) * this.k + this.h / 2 };
  }

  view(margin = 0): Box {
    const m = margin / this.k;
    return {
      x0: this.x - this.w / 2 / this.k - m,
      y0: this.y - this.h / 2 / this.k - m,
      x1: this.x + this.w / 2 / this.k + m,
      y1: this.y + this.h / 2 / this.k + m,
    };
  }

  /** Zoom by a factor while keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    this.anim = null;
    const before = this.toWorld(sx, sy);
    this.k = Math.max(this.minK, Math.min(this.maxK, this.k * factor));
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  panBy(dx: number, dy: number): void {
    this.anim = null;
    this.x -= dx / this.k;
    this.y -= dy / this.k;
  }

  stop(): void {
    this.anim = null;
    this.vx = this.vy = 0;
  }

  animateTo(x: number, y: number, k: number, ms = 650): void {
    this.vx = this.vy = 0;
    k = Math.max(this.minK, Math.min(this.maxK, k));
    this.anim = { x0: this.x, y0: this.y, k0: this.k, x1: x, y1: y, k1: k, t0: performance.now(), ms };
  }

  fit(b: Box, pad = 60, ms = 650, maxK = 1.6, top = 0, bottom = 0): void {
    const bw = Math.max(1, b.x1 - b.x0);
    const bh = Math.max(1, b.y1 - b.y0);
    const k = Math.min((this.w - pad * 2) / bw, (this.h - pad * 2 - top - bottom) / bh, maxK);
    const x = (b.x0 + b.x1) / 2;
    // Shift so the box centres in the area between the top and bottom insets.
    const y = (b.y0 + b.y1) / 2 - (top - bottom) / 2 / k;
    if (ms <= 0) {
      this.x = x;
      this.y = y;
      this.k = Math.max(this.minK, k);
      this.anim = null;
    } else this.animateTo(x, y, k, ms);
  }

  /** Advance animation and inertia; true while the camera is still moving. */
  step(now: number): boolean {
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (now - a.t0) / a.ms);
      const e = ease(t);
      // Geometric zoom interpolation so the move feels even.
      this.k = a.k0 * Math.pow(a.k1 / a.k0, e);
      this.x = a.x0 + (a.x1 - a.x0) * e;
      this.y = a.y0 + (a.y1 - a.y0) * e;
      if (t >= 1) this.anim = null;
      return true;
    }
    if (Math.abs(this.vx) > 0.05 || Math.abs(this.vy) > 0.05) {
      this.x -= this.vx / this.k;
      this.y -= this.vy / this.k;
      this.vx *= 0.93;
      this.vy *= 0.93;
      return true;
    }
    this.vx = this.vy = 0;
    return false;
  }
}
