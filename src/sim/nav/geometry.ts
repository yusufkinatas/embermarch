/** Entity geometry helpers. OWNER: nav. */
import type { Entity } from '../types';

/** Footprint rect of a static entity (buildings / resource nodes). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Distance from (px, py) to the closest point of a rect (0 inside). */
export function distToRectXY(px: number, py: number, rx: number, ry: number, rw: number, rh: number): number {
  const cx = px < rx ? rx : px > rx + rw ? rx + rw : px;
  const cy = py < ry ? ry : py > ry + rh ? ry + rh : py;
  return Math.hypot(px - cx, py - cy);
}

/** Distance from a point to an entity's edge (circle for units, footprint rect for buildings/resources). */
export function distToEntity(x: number, y: number, e: Entity): number {
  if (e.kind === 'unit') return Math.max(0, Math.hypot(x - e.x, y - e.y) - e.radius);
  return distToRectXY(x, y, e.tx, e.ty, e.w, e.h);
}

/** Edge-to-edge distance between two entities (used for attack range checks). */
export function edgeDistance(a: Entity, b: Entity): number {
  if (a.kind === 'unit') {
    if (b.kind === 'unit') return Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius);
    return Math.max(0, distToRectXY(a.x, a.y, b.tx, b.ty, b.w, b.h) - a.radius);
  }
  if (b.kind === 'unit') return Math.max(0, distToRectXY(b.x, b.y, a.tx, a.ty, a.w, a.h) - b.radius);
  const gx = Math.max(0, Math.max(a.tx, b.tx) - Math.min(a.tx + a.w, b.tx + b.w));
  const gy = Math.max(0, Math.max(a.ty, b.ty) - Math.min(a.ty + a.h, b.ty + b.h));
  return Math.hypot(gx, gy);
}

/** Closest point on/near an entity to (x, y) (for approach goals). Inside the entity: (x, y) itself. */
export function closestPointOn(e: Entity, x: number, y: number): { x: number; y: number } {
  if (e.kind === 'unit') {
    const dx = x - e.x;
    const dy = y - e.y;
    const d = Math.hypot(dx, dy);
    if (d <= e.radius) return { x, y };
    return { x: e.x + (dx / d) * e.radius, y: e.y + (dy / d) * e.radius };
  }
  return {
    x: x < e.tx ? e.tx : x > e.tx + e.w ? e.tx + e.w : x,
    y: y < e.ty ? e.ty : y > e.ty + e.h ? e.ty + e.h : y,
  };
}

/** Footprint of a building/resource, or null for units. */
export function footprintOf(e: Entity): Rect | null {
  return e.kind === 'unit' ? null : { x: e.tx, y: e.ty, w: e.w, h: e.h };
}
