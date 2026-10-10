/** Spatial hash over units (rebuilt each tick). OWNER: nav. */
import type { SpatialHash, Unit, World } from '../types';

export function createSpatialHash(w: number, h: number, cellSize?: number): SpatialHash {
  throw new Error('not implemented');
}

export function rebuildSpatial(world: World): void {
  throw new Error('not implemented');
}

/** Alive units whose centers are within r tiles of (x, y), optionally filtered. */
export function queryUnits(world: World, x: number, y: number, r: number, pred?: (u: Unit) => boolean): Unit[] {
  throw new Error('not implemented');
}

/** Nearest alive unit within r matching pred (by center distance), or null. */
export function nearestUnit(world: World, x: number, y: number, r: number, pred?: (u: Unit) => boolean): Unit | null {
  throw new Error('not implemented');
}
