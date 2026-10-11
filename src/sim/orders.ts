/**
 * Unit orders. OWNER: sim-core.
 * orderUnit is the ONLY way other modules (encounter AI, commands) change what a unit does.
 *
 * Execution state for an order lives in the order object (gather phase / drop-off / wait timer)
 * and in sim-core's private UnitCore. Starting a new order releases the old order's gather slot,
 * clears the movement intent and resets engagement bookkeeping.
 */
import { ACQUIRE } from '../data/balance';
import { releaseClaim, sameTarget } from './claims';
import { ucore } from './core';
import { stopMoving } from './movement';
import type { Order, Unit, World } from './types';

function cloneOrder(o: Order): Order {
  switch (o.type) {
    case 'gather':
      return {
        type: 'gather',
        target: o.target.kind === 'tree' ? { kind: 'tree', tile: o.target.tile } : { kind: o.target.kind, id: o.target.id },
        phase: o.phase,
        dropoffId: o.dropoffId,
      };
    default:
      return { ...o };
  }
}

/** Start an order now (no queue handling). */
export function startOrder(world: World, u: Unit, order: Order): void {
  const uc = ucore(world, u);
  const o = cloneOrder(order);
  // Keep the gather slot only when continuing on the same source.
  const sameSource = o.type === 'gather' && sameTarget(uc.claim, o.target);
  if (!sameSource) releaseClaim(world, u);
  if (o.type === 'gather' && !sameSource && !sameTarget(u.job, o.target)) uc.lastSource = null;
  uc.returning = false;
  uc.noReachTime = 0;
  uc.lastTargetDist = Infinity;
  uc.waitRetried = false;
  uc.kitingUntil = 0;
  if (o.type !== 'move' && o.type !== 'attackMove') uc.flowKey = undefined;
  u.order = o;
  u.targetId = o.type === 'attack' ? o.targetId : 0;
  if (o.type === 'gather') {
    u.job = o.target.kind === 'tree' ? { kind: 'tree', tile: o.target.tile } : { kind: o.target.kind, id: o.target.id };
    if (!o.phase) o.phase = 'toNode';
    o.waitTimer = undefined;
  }
  if (o.type === 'idle' || o.type === 'hold') {
    u.homeX = u.x;
    u.homeY = u.y;
  }
  if (o.type === 'attack') {
    uc.engageX = u.x;
    uc.engageY = u.y;
  }
  stopMoving(world, u);
}

/** Replace the unit's current order (or append to its queue when queue=true, max 8). */
export function orderUnit(world: World, unit: Unit, order: Order, queue?: boolean): void {
  if (!unit.alive) return;
  if (queue) {
    const busy = unit.order.type !== 'idle' || ucore(world, unit).returning;
    if (busy) {
      if (unit.queue.length < ACQUIRE.maxQueuedOrders) unit.queue.push(cloneOrder(order));
      return;
    }
  } else {
    unit.queue.length = 0;
  }
  startOrder(world, unit, order);
}

/** Clear order, queue, movement and target. */
export function stopUnit(world: World, unit: Unit): void {
  unit.queue.length = 0;
  startOrder(world, unit, { type: 'idle' });
}

/** The current order finished: start the next queued order, or go idle. */
export function completeOrder(world: World, u: Unit): void {
  const next = u.queue.shift();
  startOrder(world, u, next ?? { type: 'idle' });
}
