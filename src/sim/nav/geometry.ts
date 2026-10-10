/** Entity geometry helpers. OWNER: nav. */
import type { Entity } from '../types';

/** Distance from a point to an entity's edge (circle for units, footprint rect for buildings/resources). */
export function distToEntity(x: number, y: number, e: Entity): number {
  throw new Error('not implemented');
}

/** Edge-to-edge distance between two entities (used for attack range checks). */
export function edgeDistance(a: Entity, b: Entity): number {
  throw new Error('not implemented');
}

/** Closest point on/near an entity to (x, y) (for approach goals). */
export function closestPointOn(e: Entity, x: number, y: number): { x: number; y: number } {
  throw new Error('not implemented');
}
