/**
 * Thin command layer between encounter decisions and sim-core/nav. Every order the enemy AI
 * gives goes through here so re-issuing is idempotent (no path resets every think) and the
 * cohesion speed cap is applied consistently.
 */
import { orderUnit, stopUnit } from '../orders';
import type { Unit, World } from '../types';
import { aiOf } from './state';

const REISSUE_DIST = 1.0;

function applyCap(u: Unit, cap: number): void {
  const ai = aiOf(u);
  if (ai) ai.speedCap = cap > 0 ? cap : 0;
  if (u.move) {
    u.move.speedCap = cap > 0 ? cap : 0;
  }
}

/**
 * Advance (attack-move) toward a point, optionally capped to a cohesion band speed. A moving goal
 * is only re-issued once it drifts by more than 15% of the remaining distance (min 1 tile), so
 * pathing is not restarted every think.
 */
export function driveAdvance(world: World, u: Unit, x: number, y: number, cap = 0): void {
  const o = u.order;
  const tol = Math.max(REISSUE_DIST, 0.15 * Math.hypot(x - u.x, y - u.y));
  if (o.type !== 'attackMove' || Math.hypot(o.x - x, o.y - y) > tol) {
    orderUnit(world, u, { type: 'attackMove', x, y });
  }
  applyCap(u, cap);
}

/** Plain move (leash return, walking to a post). */
export function driveMove(world: World, u: Unit, x: number, y: number): void {
  const o = u.order;
  if (o.type !== 'move' || Math.hypot(o.x - x, o.y - y) > 0.5) {
    orderUnit(world, u, { type: 'move', x, y });
  }
  applyCap(u, 0);
}

/** Attack a specific entity (sim-core approaches to range and attacks). */
export function driveAttack(world: World, u: Unit, targetId: number): void {
  const o = u.order;
  if (o.type !== 'attack' || o.targetId !== targetId) {
    orderUnit(world, u, { type: 'attack', targetId });
  }
  applyCap(u, 0);
}

/** Stand still. */
export function driveHold(world: World, u: Unit): void {
  if (u.order.type !== 'idle' || u.move !== null || u.queue.length > 0) stopUnit(world, u);
}

/** The entity the unit is currently attacking via an attack order (0 = none). */
export function currentAttackTarget(u: Unit): number {
  return u.order.type === 'attack' ? u.order.targetId : 0;
}
