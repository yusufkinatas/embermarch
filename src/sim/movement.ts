/**
 * Thin wrappers around nav.setMove so behaviors only push a new intent when it actually changes
 * (nav repaths when the goal changes materially; re-setting an identical intent every tick is wasted work).
 * OWNER: sim-core.
 */
import { setMove } from './nav/movement';
import { ucore } from './core';
import type { Entity, MoveIntent, Unit, World } from './types';
import { PLAYER } from './types';

function modeOf(u: Unit): 'player' | 'enemy' {
  return u.owner === PLAYER ? 'player' : 'enemy';
}

/**
 * Same goal? speedCap is ignored: the encounter module adjusts u.move.speedCap (cohesion bands)
 * directly every tick and new intents inherit it (see withCap).
 */
function sameIntent(a: MoveIntent, b: MoveIntent): boolean {
  if (a.targetId !== b.targetId || a.mode !== b.mode || a.flowKey !== b.flowKey) return false;
  if (Math.abs(a.range - b.range) > 1e-6) return false;
  // Entity goals are refreshed by nav from the target; only point goals compare coordinates.
  if (a.targetId) return true;
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

/** Encounter-driven units keep their cohesion speed cap across new intents. */
function withCap(u: Unit, intent: MoveIntent): MoveIntent {
  if (intent.speedCap !== undefined || u.ai === null) return intent;
  const cur = u.move?.speedCap;
  const aiCap = u.ai['speedCap'];
  const cap = typeof cur === 'number' && cur > 0 ? cur : typeof aiCap === 'number' && aiCap > 0 ? aiCap : 0;
  if (cap > 0) intent.speedCap = cap;
  return intent;
}

export function moveIntent(world: World, u: Unit, intent: MoveIntent | null): void {
  if (!intent) {
    if (u.move) {
      setMove(world, u, null);
      ucore(world, u).moveSetTick = world.tick;
    }
    return;
  }
  if (u.move && sameIntent(u.move, intent)) return;
  const uc = ucore(world, u);
  // Nav gave up on this very point goal (it clears unit.move and leaves 'stuck'). Re-issuing it would
  // only repeat the give-up every second, so the order would never end (GDD §F e: the unit goes idle).
  // Keep the status for moveDone / moveFailed. Player units only: encounter re-orders its own units.
  if (!u.move && u.moveStatus === 'stuck' && u.owner === PLAYER && intent.targetId === 0 && uc.lastPointGoal && sameIntent(uc.lastPointGoal, intent)) return;
  setMove(world, u, withCap(u, intent));
  uc.moveSetTick = world.tick;
  uc.lastPointGoal = intent.targetId === 0 ? { ...intent } : null;
}

/** Move to a point (arrive within `range` of it). Uses the unit's group flow key when set. */
export function movePoint(world: World, u: Unit, x: number, y: number, range = 0.15, useFlow = true): void {
  const flowKey = useFlow ? ucore(world, u).flowKey : undefined;
  const intent: MoveIntent = { x, y, targetId: 0, range, mode: modeOf(u) };
  if (flowKey) intent.flowKey = flowKey;
  moveIntent(world, u, intent);
}

/** Follow an entity until edge-to-edge distance <= range. */
export function moveToEntity(world: World, u: Unit, e: Entity, range: number): void {
  moveIntent(world, u, { x: e.x, y: e.y, targetId: e.id, range: Math.max(0, range), mode: modeOf(u) });
}

export function stopMoving(world: World, u: Unit): void {
  moveIntent(world, u, null);
}

/** Has nav processed the current intent at least once (so moveStatus refers to it)? */
export function moveFresh(world: World, u: Unit): boolean {
  return world.tick > ucore(world, u).moveSetTick;
}

/** Terminal nav statuses for a point move (only once nav has seen the current intent). */
export function moveDone(world: World, u: Unit): boolean {
  if (!moveFresh(world, u)) return false;
  return u.moveStatus === 'arrived' || u.moveStatus === 'stuck' || u.moveStatus === 'unreachable';
}

/** Nav gave up on the current intent (stuck, or unreachable and not moving). */
export function moveFailed(world: World, u: Unit): boolean {
  if (!moveFresh(world, u)) return false;
  return u.moveStatus === 'stuck' || (u.moveStatus === 'unreachable' && Math.abs(u.vx) + Math.abs(u.vy) < 0.05);
}
