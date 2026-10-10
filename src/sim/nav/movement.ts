/**
 * Movement system (GDD §F movement spec a-g). OWNER: nav.
 * Behaviors set unit.move (MoveIntent); stepMovement moves every unit with an intent:
 * path requests (A* budget 8/tick, flow fields for flowKey/enemy mode), steering along waypoints,
 * speed modifiers (terrain speedMul, Blight x0.8 for player unless kindled_earth, buffs/rooted, speedCap),
 * soft separation via spatial hash (max push 0.5 tiles/s, movers shove idlers), static collision,
 * stuck detection (repath; 3 repaths in 6 s -> moveStatus 'stuck'), arrival (moveStatus 'arrived').
 */
import type { MoveIntent, Unit, World } from '../types';

export function stepMovement(world: World): void {
  throw new Error('not implemented');
}

/** Set or clear a unit's movement intent (resets path/stuck state when the goal changes materially). */
export function setMove(world: World, unit: Unit, intent: MoveIntent | null): void {
  throw new Error('not implemented');
}

/** Knockback/dash: move by (dx, dy) in 0.25-tile steps, stopping at the last walkable position. */
export function displaceUnit(world: World, unit: Unit, dx: number, dy: number): void {
  throw new Error('not implemented');
}

/** Nearest free walkable tile center to (x, y) within maxR tiles via BFS spiral (no static entity, few units). */
export function findFreeSpot(world: World, x: number, y: number, maxR: number): { x: number; y: number } | null {
  throw new Error('not implemented');
}

/** Formation slots for a group order: role-sorted offsets (melee front, ranged behind) facing from->to. */
export function formationSlots(units: Unit[], fromX: number, fromY: number, toX: number, toY: number): { x: number; y: number }[] {
  throw new Error('not implemented');
}
