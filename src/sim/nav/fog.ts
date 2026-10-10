/** Player fog of war (3 states, updated at 5 Hz). OWNER: nav. */
import type { FogState, World } from '../types';

export function createFog(w: number, h: number): FogState {
  throw new Error('not implemented');
}

/** Recompute visible tiles from player units/buildings sight + world.vision; keep explored. */
export function updateFog(world: World): void {
  throw new Error('not implemented');
}

/** Mark a circle explored (start area, Cold Watch-Fire full reveal uses r = Infinity). */
export function exploreCircle(world: World, x: number, y: number, r: number): void {
  throw new Error('not implemented');
}
