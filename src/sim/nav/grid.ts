/** Navigation grid. OWNER: nav. */
import { NAV } from '../../data/balance';
import { Terrain } from '../types';
import type { GameMap, NavGrid, World } from '../types';

/** Is this terrain tile impassable on its own (ignoring static entities)? */
export function terrainBlocked(map: GameMap, i: number): boolean {
  const t = map.terrain[i];
  if (t === Terrain.Water || t === Terrain.Rock || t === Terrain.BriarWall) return true;
  if (t === Terrain.Forest) return map.treeAmount[i] > 0;
  return false;
}

/** Terrain speed multiplier of a tile (Shallows 0.6, everything walkable else 1). */
export function terrainSpeed(map: GameMap, i: number): number {
  return map.terrain[i] === Terrain.Shallows ? NAV.shallowsSpeed : 1;
}

/** Build from terrain: Water/Rock/Forest/BriarWall blocked; Shallows speedMul 0.6. */
export function createNavGrid(map: GameMap): NavGrid {
  const n = map.w * map.h;
  const blocked = new Uint8Array(n);
  const speedMul = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    blocked[i] = terrainBlocked(map, i) ? 1 : 0;
    speedMul[i] = terrainSpeed(map, i);
  }
  return { w: map.w, h: map.h, blocked, occupant: new Int32Array(n), speedMul, version: 0 };
}

/** Mark (entityId > 0) or clear (entityId = 0) a static footprint; bumps grid.version. */
export function setFootprint(world: World, tx: number, ty: number, w: number, h: number, entityId: number): void {
  const grid = world.grid;
  const map = world.map;
  const x0 = Math.max(0, tx);
  const y0 = Math.max(0, ty);
  const x1 = Math.min(grid.w, tx + w);
  const y1 = Math.min(grid.h, ty + h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * grid.w + x;
      if (entityId > 0) {
        grid.occupant[i] = entityId;
        grid.blocked[i] = 1;
      } else {
        grid.occupant[i] = 0;
        grid.blocked[i] = terrainBlocked(map, i) ? 1 : 0;
      }
    }
  }
  grid.version++;
}

/**
 * Terrain changed at a tile (tree felled -> Stump): update blocked + version, push world.dirtyTiles.
 * A Forest tile whose treeAmount reached 0 is converted to a walkable Stump here, so callers may
 * either convert the terrain themselves or just zero the tree amount.
 */
export function onTerrainChanged(world: World, tile: number): void {
  const grid = world.grid;
  const map = world.map;
  if (tile < 0 || tile >= grid.w * grid.h) return;
  if (map.terrain[tile] === Terrain.Forest && map.treeAmount[tile] <= 0) map.terrain[tile] = Terrain.Stump;
  if (grid.occupant[tile] === 0) grid.blocked[tile] = terrainBlocked(map, tile) ? 1 : 0;
  grid.speedMul[tile] = terrainSpeed(map, tile);
  if (!world.dirtyTiles.includes(tile)) world.dirtyTiles.push(tile);
  grid.version++;
}

export function inBounds(grid: NavGrid, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h;
}

export function isWalkable(grid: NavGrid, tx: number, ty: number): boolean {
  return inBounds(grid, tx, ty) && grid.blocked[ty * grid.w + tx] === 0;
}

/** Tile index under a world point, or -1 when outside the grid. */
export function tileAt(grid: NavGrid, x: number, y: number): number {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return inBounds(grid, tx, ty) ? ty * grid.w + tx : -1;
}

/** Tile index under a world point, clamped into the grid. */
export function tileClamped(grid: NavGrid, x: number, y: number): number {
  const tx = Math.min(grid.w - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(grid.h - 1, Math.max(0, Math.floor(y)));
  return ty * grid.w + tx;
}
