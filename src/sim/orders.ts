/**
 * Unit orders. OWNER: sim-core.
 * orderUnit is the ONLY way other modules (encounter AI, commands) change what a unit does.
 */
import type { Order, Unit, World } from './types';

/** Replace the unit's current order (or append to its queue when queue=true, max 8). */
export function orderUnit(world: World, unit: Unit, order: Order, queue?: boolean): void {
  throw new Error('not implemented');
}

/** Clear order, queue, movement and target. */
export function stopUnit(world: World, unit: Unit): void {
  throw new Error('not implemented');
}
