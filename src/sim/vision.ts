/**
 * Read-only fog helpers used by sim-core (targeting) and re-exported by queries. OWNER: sim-core.
 * Fog state itself is computed by nav/fog.
 */
import type { Entity, World } from './types';
import { Fog, PLAYER } from './types';

export function isTileVisible(world: World, tx: number, ty: number): boolean {
  if (world.debug.revealAll) return true;
  tx = Math.floor(tx);
  ty = Math.floor(ty);
  if (tx < 0 || ty < 0 || tx >= world.map.w || ty >= world.map.h) return false;
  return world.fog.state[ty * world.map.w + tx] === Fog.Visible;
}

export function isTileExplored(world: World, tx: number, ty: number): boolean {
  if (world.debug.revealAll) return true;
  tx = Math.floor(tx);
  ty = Math.floor(ty);
  if (tx < 0 || ty < 0 || tx >= world.map.w || ty >= world.map.h) return false;
  return world.fog.state[ty * world.map.w + tx] !== Fog.Unexplored;
}

function anyFootprintTile(world: World, e: { tx: number; ty: number; w: number; h: number }, explored: boolean): boolean {
  for (let y = e.ty; y < e.ty + e.h; y++) {
    for (let x = e.tx; x < e.tx + e.w; x++) {
      if (explored ? isTileExplored(world, x, y) : isTileVisible(world, x, y)) return true;
    }
  }
  return false;
}

/** Is a (non-player) entity currently visible to the player (fog)? Player entities are always visible. */
export function isEntityVisible(world: World, e: Entity): boolean {
  if (e.owner === PLAYER || world.debug.revealAll) return true;
  if (e.kind === 'unit') return isTileVisible(world, e.x, e.y);
  return anyFootprintTile(world, e, false);
}

/** Has the player ever seen this static entity (ghosts of enemy buildings stay pickable / attackable)? */
export function isEntitySeen(world: World, e: Entity): boolean {
  if (e.owner === PLAYER || world.debug.revealAll) return true;
  if (e.kind === 'unit') return isTileVisible(world, e.x, e.y);
  return anyFootprintTile(world, e, true);
}
