/**
 * Static collision: units are treated as axis-aligned boxes (half-size = collision radius, capped
 * so every unit fits a 1-tile corridor) against blocked tiles. Axis-separated sweeps slide along
 * walls; units never enter blocked tiles. OWNER: nav.
 */
import type { NavGrid, Unit } from '../types';

const EPS = 1e-6;
/** Terrain collision half-size cap (big units overlap scenery a little rather than jam). */
export const MAX_TERRAIN_RADIUS = 0.45;

export function terrainRadius(u: Unit): number {
  const r = u.radius > 0 ? u.radius : 0.3;
  return r < MAX_TERRAIN_RADIUS ? r : MAX_TERRAIN_RADIUS;
}

function solid(grid: NavGrid, tx: number, ty: number): boolean {
  return tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h || grid.blocked[ty * grid.w + tx] !== 0;
}

export interface Pos {
  x: number;
  y: number;
}

/** Corner sliding: max sideways overlap (tiles) with a blocking tile that still gets nudged around. */
const NUDGE_MAX = 0.35;

/**
 * Sweep along x by dx; returns the reachable x. On a block, *nudge (out) gets the sideways
 * correction (+/- y) that would let the box slip past the blocking corner next time.
 */
function sweepX(grid: NavGrid, x: number, y: number, r: number, dx: number, nudge: Pos): number {
  const rowA = Math.floor(y - r + EPS);
  const rowB = Math.floor(y + r - EPS);
  const forward = dx > 0;
  const cOld = forward ? Math.floor(x + r - EPS) : Math.floor(x - r + EPS);
  const cNew = forward ? Math.floor(x + dx + r - EPS) : Math.floor(x + dx - r + EPS);
  const step = forward ? 1 : -1;
  for (let c = cOld + step; forward ? c <= cNew : c >= cNew; c += step) {
    let hitA = false;
    let hitB = false;
    let hitMid = false;
    for (let row = rowA; row <= rowB; row++) {
      if (!solid(grid, c, row)) continue;
      if (row === rowA) hitA = true;
      else if (row === rowB) hitB = true;
      else hitMid = true;
    }
    if (!hitA && !hitB && !hitMid) continue;
    if (rowA !== rowB && !hitMid && hitA !== hitB) {
      // Only an edge row blocks: slide toward the free row when the overlap is small.
      const over = hitA ? rowA + 1 - (y - r) : y + r - rowB;
      if (over <= NUDGE_MAX) nudge.y = (hitA ? 1 : -1) * Math.min(over + 1e-4, Math.abs(dx));
    }
    return forward ? Math.max(x, c - r) : Math.min(x, c + 1 + r);
  }
  return x + dx;
}

function sweepY(grid: NavGrid, x: number, y: number, r: number, dy: number, nudge: Pos): number {
  const colA = Math.floor(x - r + EPS);
  const colB = Math.floor(x + r - EPS);
  const forward = dy > 0;
  const rOld = forward ? Math.floor(y + r - EPS) : Math.floor(y - r + EPS);
  const rNew = forward ? Math.floor(y + dy + r - EPS) : Math.floor(y + dy - r + EPS);
  const step = forward ? 1 : -1;
  for (let row = rOld + step; forward ? row <= rNew : row >= rNew; row += step) {
    let hitA = false;
    let hitB = false;
    let hitMid = false;
    for (let c = colA; c <= colB; c++) {
      if (!solid(grid, c, row)) continue;
      if (c === colA) hitA = true;
      else if (c === colB) hitB = true;
      else hitMid = true;
    }
    if (!hitA && !hitB && !hitMid) continue;
    if (colA !== colB && !hitMid && hitA !== hitB) {
      const over = hitA ? colA + 1 - (x - r) : x + r - colB;
      if (over <= NUDGE_MAX) nudge.x = (hitA ? 1 : -1) * Math.min(over + 1e-4, Math.abs(dy));
    }
    return forward ? Math.max(y, row - r) : Math.min(y, row + 1 + r);
  }
  return y + dy;
}

const nudgeX: Pos = { x: 0, y: 0 };
const nudgeY: Pos = { x: 0, y: 0 };

/**
 * Move a box of half-size r centered at (x, y) by (dx, dy) with axis-separated sliding.
 * Only tiles newly entered by the leading edge are tested, so a box already touching a wall
 * can always move away from it. A move blocked only by a corner the box barely overlaps
 * slides the box sideways around it (units line up with 1-tile gaps instead of jamming).
 */
export function slideMove(grid: NavGrid, x: number, y: number, r: number, dx: number, dy: number, out: Pos): Pos {
  nudgeX.y = 0;
  nudgeY.x = 0;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  let nx = dx !== 0 ? sweepX(grid, x, y, r, dx, nudgeX) : x;
  // A blocked dominant x-move slides sideways around the corner it clips (overrides dy).
  const ddy = nudgeX.y !== 0 && ax >= ay ? nudgeX.y : dy;
  const ny = ddy !== 0 ? sweepY(grid, nx, y, r, ddy, nudgeY) : y;
  // A blocked dominant y-move slides sideways around the corner it clips (overrides dx).
  if (nudgeY.x !== 0 && ay > ax) nx = sweepX(grid, x, ny, r, nudgeY.x, nudgeX);
  out.x = nx;
  out.y = ny;
  return out;
}

/**
 * Push a box out of blocked tiles it overlaps (after knockback, placement next to a unit, ...),
 * along the axis of least penetration. Units whose center tile is blocked are left to the
 * escape logic in movement.
 */
export function depenetrate(grid: NavGrid, pos: Pos, r: number): void {
  for (let iter = 0; iter < 3; iter++) {
    const c0 = Math.floor(pos.x - r + EPS);
    const c1 = Math.floor(pos.x + r - EPS);
    const r0 = Math.floor(pos.y - r + EPS);
    const r1 = Math.floor(pos.y + r - EPS);
    let fixed = false;
    for (let row = r0; row <= r1 && !fixed; row++) {
      for (let c = c0; c <= c1; c++) {
        if (!solid(grid, c, row)) continue;
        const pushL = pos.x + r - c; // move left so the right edge sits at c
        const pushR = c + 1 - (pos.x - r);
        const pushU = pos.y + r - row;
        const pushD = row + 1 - (pos.y - r);
        const m = Math.min(pushL, pushR, pushU, pushD);
        if (m === pushL) pos.x -= pushL;
        else if (m === pushR) pos.x += pushR;
        else if (m === pushU) pos.y -= pushU;
        else pos.y += pushD;
        fixed = true;
        break;
      }
    }
    if (!fixed) return;
  }
}

/** Keep a center inside the map (box fully inside). */
export function clampToMap(grid: NavGrid, pos: Pos, r: number): void {
  if (pos.x < r) pos.x = r;
  else if (pos.x > grid.w - r) pos.x = grid.w - r;
  if (pos.y < r) pos.y = r;
  else if (pos.y > grid.h - r) pos.y = grid.h - r;
}
