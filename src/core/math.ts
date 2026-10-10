export interface Vec2 {
  x: number;
  y: number;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
};

/** Distance from point to the closest point of an axis-aligned rectangle (0 if inside). */
export function distToRect(px: number, py: number, rx: number, ry: number, rw: number, rh: number): number {
  const cx = clamp(px, rx, rx + rw);
  const cy = clamp(py, ry, ry + rh);
  return Math.hypot(px - cx, py - cy);
}

export function angleTo(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax);
}
