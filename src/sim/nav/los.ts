/**
 * Walkable line-of-sight over the nav grid (grid traversal a la Amanatides-Woo). A line passing
 * exactly through a tile corner needs both side tiles passable (no squeezing through diagonal
 * gaps, matching the no-corner-cutting rule). OWNER: nav.
 */
import type { NavGrid } from '../types';

export type TilePass = (i: number) => boolean;

const EPS = 1e-9;

/** True if every tile the segment (x0,y0)-(x1,y1) touches satisfies pass (out of bounds = blocked). */
export function segmentPasses(grid: NavGrid, x0: number, y0: number, x1: number, y1: number, pass: TilePass): boolean {
  const w = grid.w;
  const h = grid.h;
  let tx = Math.floor(x0);
  let ty = Math.floor(y0);
  const ok = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && pass(y * w + x);
  if (!ok(tx, ty)) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = stepX > 0 ? (tx + 1 - x0) / dx : stepX < 0 ? (x0 - tx) / -dx : Infinity;
  let tMaxY = stepY > 0 ? (ty + 1 - y0) / dy : stepY < 0 ? (y0 - ty) / -dy : Infinity;
  // Bounded loop: a segment crosses at most |dx| + |dy| + 2 boundaries.
  let guard = Math.ceil(Math.abs(dx) + Math.abs(dy)) + 4;
  while (guard-- > 0) {
    const tNext = tMaxX < tMaxY ? tMaxX : tMaxY;
    if (tNext >= 1) return true;
    if (Math.abs(tMaxX - tMaxY) <= EPS) {
      // Exactly through a corner: both side tiles must be passable.
      if (!ok(tx + stepX, ty) || !ok(tx, ty + stepY)) return false;
      tx += stepX;
      ty += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      tx += stepX;
      tMaxX += tDeltaX;
    } else {
      ty += stepY;
      tMaxY += tDeltaY;
    }
    if (!ok(tx, ty)) return false;
  }
  return true;
}

/** Thin walkable line (strict: static entities and blocked terrain stop it). */
export function lineWalkable(grid: NavGrid, x0: number, y0: number, x1: number, y1: number): boolean {
  const blocked = grid.blocked;
  return segmentPasses(grid, x0, y0, x1, y1, (i) => blocked[i] === 0);
}

/**
 * Thick walkable line: the center line plus two parallel lines offset by `clearance`
 * (approximates the swept body of a unit). clearance should stay below 0.5.
 */
export function clearLine(
  grid: NavGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  clearance: number,
  pass?: TilePass,
): boolean {
  const blocked = grid.blocked;
  const p: TilePass = pass ?? ((i) => blocked[i] === 0);
  if (!segmentPasses(grid, x0, y0, x1, y1, p)) return false;
  if (clearance <= 0) return true;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return true;
  const ox = (-dy / len) * clearance;
  const oy = (dx / len) * clearance;
  return (
    segmentPasses(grid, x0 + ox, y0 + oy, x1 + ox, y1 + oy, p) &&
    segmentPasses(grid, x0 - ox, y0 - oy, x1 - ox, y1 - oy, p)
  );
}
