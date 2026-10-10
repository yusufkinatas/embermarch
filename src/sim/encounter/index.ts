/**
 * Encounter: enemy structures, wave director, enemy unit AI, garrisons/pickets/lurkers,
 * Blight (growth, ward, effects), objectives & victory, Elite Noble, Boss. OWNER: encounter.
 */
import type { Entity, Unit, World } from '../types';
import type { EncounterView } from './types';

/**
 * Called once at the end of createWorld (after player entities & resources exist).
 * Sets world.encounter, spawns Nests/Root Hearts, Thornspires, Pickets, Caches, Beacons, Throne,
 * garrisons and guards, initial Blight. Uses world.setup (objective, depth, modifiers, doctrine, tier).
 */
export function initEncounter(world: World): void {
  throw new Error('not implemented');
}

/** Called every tick before unit behaviors. */
export function tickEncounter(world: World): void {
  throw new Error('not implemented');
}

/** Called by sim-core killEntity for every entity death. */
export function onEntityDeath(world: World, e: Entity, killerId: number): void {
  throw new Error('not implemented');
}

/** Called by sim-core whenever an entity takes damage (retaliation, engage memory, dissolve timers). */
export function onEntityDamaged(world: World, target: Entity, attackerId: number, amount: number): void {
  throw new Error('not implemented');
}

/** A player building completed or died: recompute Blight wards. */
export function onPlayerBuildingChanged(world: World): void {
  throw new Error('not implemented');
}

export function getEncounterView(world: World): EncounterView {
  throw new Error('not implemented');
}

/** Is the tile currently blighted? */
export function isBlighted(world: World, tx: number, ty: number): boolean {
  return world.blight.tiles[ty * world.map.w + tx] === 1;
}

/** Debug: muster & launch wave n now (optionally with a doctrine). */
export function debugForceWave(world: World, n: number, doctrine?: string): void {
  throw new Error('not implemented');
}

/** Enemy unit helper used by sim-core: should this enemy unit be driven by encounter AI this tick? */
export function isAIControlled(u: Unit): boolean {
  return u.ai !== null;
}
