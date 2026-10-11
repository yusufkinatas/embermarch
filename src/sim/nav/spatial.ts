/** Spatial hash over units (rebuilt each tick). OWNER: nav. */
import type { SpatialHash, Unit, World } from '../types';

/** Default cell size in tiles. */
export const SPATIAL_CELL = 2;
/** Largest unit radius (Briar Regent); queries pad by this so edge-touching units are found. */
const MAX_RADIUS_PAD = 1.2;

/** Unit references per cell, parallel to SpatialHash.cells (ids). */
const unitCells = new WeakMap<SpatialHash, Unit[][]>();

export function createSpatialHash(w: number, h: number, cellSize: number = SPATIAL_CELL): SpatialHash {
  const cols = Math.max(1, Math.ceil(w / cellSize));
  const rows = Math.max(1, Math.ceil(h / cellSize));
  const cells: number[][] = [];
  const refs: Unit[][] = [];
  for (let i = 0; i < cols * rows; i++) {
    cells.push([]);
    refs.push([]);
  }
  const hash: SpatialHash = { cellSize, cols, rows, cells };
  unitCells.set(hash, refs);
  return hash;
}

function refsOf(hash: SpatialHash): Unit[][] {
  let refs = unitCells.get(hash);
  if (!refs || refs.length !== hash.cells.length) {
    refs = hash.cells.map(() => []);
    unitCells.set(hash, refs);
  }
  return refs;
}

const built = new WeakSet<SpatialHash>();

export function rebuildSpatial(world: World): void {
  const hash = world.spatial;
  const refs = refsOf(hash);
  const cells = hash.cells;
  for (let i = 0; i < cells.length; i++) {
    cells[i].length = 0;
    refs[i].length = 0;
  }
  const cs = hash.cellSize;
  const cols = hash.cols;
  const rows = hash.rows;
  for (const u of world.units) {
    if (!u.alive) continue;
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(u.x / cs)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor(u.y / cs)));
    const c = cy * cols + cx;
    cells[c].push(u.id);
    refs[c].push(u);
  }
  built.add(hash);
}

/**
 * Visit alive units whose CURRENT centers are within r of (x, y) (no allocation). Cells are
 * bucketed at the last rebuild; the search pads by one cell so same-tick movers are still found.
 * Return true from fn to stop early.
 */
export function forEachUnitNear(world: World, x: number, y: number, r: number, fn: (u: Unit, d2: number) => boolean | void): void {
  const hash = world.spatial;
  if (!built.has(hash)) rebuildSpatial(world);
  const refs = refsOf(hash);
  const cs = hash.cellSize;
  const pad = r + 0.5;
  const c0 = Math.max(0, Math.floor((x - pad) / cs));
  const c1 = Math.min(hash.cols - 1, Math.floor((x + pad) / cs));
  const r0 = Math.max(0, Math.floor((y - pad) / cs));
  const r1 = Math.min(hash.rows - 1, Math.floor((y + pad) / cs));
  const r2 = r * r;
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const list = refs[cy * hash.cols + cx];
      for (let k = 0; k < list.length; k++) {
        const u = list[k];
        if (!u.alive) continue;
        const dx = u.x - x;
        const dy = u.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2 && fn(u, d2) === true) return;
      }
    }
  }
}

/** Alive units whose centers are within r tiles of (x, y), optionally filtered. */
export function queryUnits(world: World, x: number, y: number, r: number, pred?: (u: Unit) => boolean): Unit[] {
  const out: Unit[] = [];
  forEachUnitNear(world, x, y, r, (u) => {
    if (!pred || pred(u)) out.push(u);
  });
  return out;
}

/** Nearest alive unit within r matching pred (by center distance), or null. */
export function nearestUnit(world: World, x: number, y: number, r: number, pred?: (u: Unit) => boolean): Unit | null {
  const hash = world.spatial;
  if (!built.has(hash)) rebuildSpatial(world);
  const refs = refsOf(hash);
  const cs = hash.cellSize;
  const ccx = Math.floor(x / cs);
  const ccy = Math.floor(y / cs);
  const maxRing = Math.min(Math.max(hash.cols, hash.rows), Math.ceil((r + 0.5) / cs) + 1);
  let best: Unit | null = null;
  let bestD2 = r * r;
  for (let ring = 0; ring <= maxRing; ring++) {
    // Units in ring k+1 are at least (k * cs - 0.5) away (0.5 = same-tick movement slack).
    const minDist = (ring - 1) * cs - 0.5;
    if (best && minDist > 0 && minDist * minDist > bestD2) break;
    for (let cy = ccy - ring; cy <= ccy + ring; cy++) {
      if (cy < 0 || cy >= hash.rows) continue;
      for (let cx = ccx - ring; cx <= ccx + ring; cx++) {
        if (cx < 0 || cx >= hash.cols) continue;
        if (Math.max(Math.abs(cx - ccx), Math.abs(cy - ccy)) !== ring) continue;
        const list = refs[cy * hash.cols + cx];
        for (let k = 0; k < list.length; k++) {
          const u = list[k];
          if (!u.alive) continue;
          const dx = u.x - x;
          const dy = u.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 > bestD2 || (best && d2 === bestD2 && u.id >= best.id)) continue;
          if (pred && !pred(u)) continue;
          best = u;
          bestD2 = d2;
        }
      }
    }
  }
  return best;
}

/** Largest unit radius used for neighbour padding. */
export const SPATIAL_RADIUS_PAD = MAX_RADIUS_PAD;
