/** Small geometry helpers for map generation (tile coordinates). */

export interface Pt {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;
export const SQRT2 = Math.SQRT2;

/** Signed smallest difference a − b in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** Footprint center of a w×h rect with top-left (tx, ty). */
export function rectCenter(tx: number, ty: number, w: number, h: number): Pt {
  return { x: tx + w / 2, y: ty + h / 2 };
}

/** Octile distance (8-connected grid, diagonal √2). */
export function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ax > ay ? ax + (SQRT2 - 1) * ay : ay + (SQRT2 - 1) * ax;
}

/** Distance from point p to segment ab. */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from point p to an open polyline. */
export function distToPolyline(px: number, py: number, pts: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = distToSegment(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    if (d < best) best = d;
  }
  return best;
}

/** Total length of a polyline. */
export function polylineLength(pts: readonly Pt[]): number {
  let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  return len;
}

/** Point at arc length s along a polyline (clamped). */
export function pointAlong(pts: readonly Pt[], s: number): Pt {
  let rest = Math.max(0, s);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (rest <= seg || i + 2 === pts.length) {
      const t = seg > 0 ? Math.min(1, rest / seg) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    rest -= seg;
  }
  return { ...pts[pts.length - 1] };
}

/** Unit tangent of a polyline at arc length s. */
export function tangentAlong(pts: readonly Pt[], s: number): Pt {
  let rest = Math.max(0, s);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (rest <= seg || i + 2 === pts.length) {
      return seg > 0 ? { x: (b.x - a.x) / seg, y: (b.y - a.y) / seg } : { x: 1, y: 0 };
    }
    rest -= seg;
  }
  return { x: 1, y: 0 };
}
