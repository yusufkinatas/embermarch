/** Navigation grid. OWNER: nav. */
import type { GameMap, NavGrid, World } from '../types';

/** Build from terrain: Water/Rock/Forest/BriarWall blocked; Shallows speedMul 0.6. */
export function createNavGrid(map: GameMap): NavGrid {
  throw new Error('not implemented');
}

/** Mark (entityId > 0) or clear (entityId = 0) a static footprint; bumps grid.version. */
export function setFootprint(world: World, tx: number, ty: number, w: number, h: number, entityId: number): void {
  throw new Error('not implemented');
}

/** Terrain changed at a tile (tree felled -> Stump): update blocked + version, push world.dirtyTiles. */
export function onTerrainChanged(world: World, tile: number): void {
  throw new Error('not implemented');
}

export function inBounds(grid: NavGrid, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h;
}

export function isWalkable(grid: NavGrid, tx: number, ty: number): boolean {
  return inBounds(grid, tx, ty) && grid.blocked[ty * grid.w + tx] === 0;
}
