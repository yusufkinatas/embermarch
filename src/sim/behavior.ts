/**
 * Unit behaviors (GDD §F "Behavior"): order execution for both sides, player-style auto-acquire,
 * leash, attack-move, hold, melee retarget, kite, Charge bookkeeping. Behaviors only SET unit.move
 * (via nav.setMove); nav.stepMovement moves the units. OWNER: sim-core.
 *
 * - Idle military (and rallied Tillers): acquire the nearest visible enemy within 6 tiles
 *   (ranged: max(range + 1, 6); rallied Tillers: 5), preferring units over buildings; chase up to
 *   10 tiles from the idle spot, then walk back ignoring enemies. Retaliate against recent attackers.
 * - Attack-move: same acquisition while moving (leash from where the engagement began).
 * - Hold: never moves; fights whatever is in range. Move: ignores enemies.
 * - Melee retarget: a melee unit failing to close on its target for 1.5 s retargets the nearest
 *   enemy within 3 tiles.
 * - Kite (UnitDef.kite, Spinecaster / Outrider): step back from an enemy melee unit, not on Hold.
 * - Units with u.ai !== null (encounter-driven) skip auto-acquire and keep encounter-set movement
 *   while idle; their orders execute normally. Enemy units with ai === null use the generic logic.
 */
import { ACQUIRE, COMBAT, RALLY_HEARTH, acquireRadius } from '../data/balance';
import { UNITS } from '../data/units';
import { emit } from './alerts';
import { applyPacket, canAttack, computeDamagePacket } from './combat';
import { buffSum, doomed, hasBuff, hostile, ticks, ucore } from './core';
import { buildBehavior, depositBehavior, fleeBehavior, gatherBehavior } from './economy';
import { getEntity } from './entities';
import { completeOrder, startOrder } from './orders';
import { moveDone, movePoint, moveToEntity, stopMoving } from './movement';
import { edgeDistance } from './nav/geometry';
import { queryUnits } from './nav/spatial';
import { spawnProjectile } from './projectiles';
import { unitStats } from './stats';
import type { UnitStats } from './stats';
import type { Entity, Order, Unit, World } from './types';
import { PLAYER, TICK_DT } from './types';

/** Range tolerance when deciding a unit can swing / shoot. */
const RANGE_EPS = 0.05;
/** Target scans happen every this many ticks (staggered by id). */
const SCAN_TICKS = 4;
/** Biggest unit radius (Regent) for spatial query padding. */
const MAX_RADIUS = 1.2;
/** Idle units farther than this from their idle spot after a fight walk back to it. */
const HOME_DRIFT = 1.5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rallied(world: World, u: Unit): boolean {
  return u.type === 'tiller' && hasBuff(world, u, 'rally_hearth');
}

/** May this unit pick its own targets (player-style auto-acquire)? */
function autoAcquires(world: World, u: Unit): boolean {
  if (u.ai !== null) return false;
  if (UNITS[u.type].cooldown <= 0) return false;
  return u.cls !== 'worker' || rallied(world, u);
}

function acquireRange(u: Unit, st: UnitStats): number {
  if (u.cls === 'worker') return RALLY_HEARTH.fightRadius;
  return acquireRadius(st.range);
}

/**
 * Nearest attackable enemy within `radius` (edge distance), units preferred over buildings.
 * Ranged attackers skip units already doomed by projectiles in flight when another target exists.
 */
export function acquireTarget(world: World, u: Unit, radius: number, exclude = 0): Entity | null {
  const def = UNITS[u.type];
  const ranged = def.range >= COMBAT.rangedThreshold;
  let best: Entity | null = null;
  let bd = Infinity;
  let fallback: Entity | null = null;
  let fd = Infinity;
  const near = queryUnits(world, u.x, u.y, radius + u.radius + MAX_RADIUS, (o) => o.alive && hostile(o.owner, u.owner) && !o.untargetable);
  for (const o of near) {
    if (o.id === exclude) continue;
    if (def.structuresOnly && o.cls !== 'boss') continue;
    const d = edgeDistance(u, o);
    if (d > radius) continue;
    const skip = ranged && doomed(world, o);
    const cur = skip ? fd : bd;
    const curE = skip ? fallback : best;
    if (d > cur || (d === cur && curE && o.id > curE.id)) continue;
    if (!canAttack(world, u, o)) continue;
    if (skip) {
      fallback = o;
      fd = d;
    } else {
      best = o;
      bd = d;
    }
  }
  if (best) return best;
  if (fallback) return fallback;
  for (const b of world.buildings) {
    if (!b.alive || b.untargetable || b.id === exclude || !hostile(b.owner, u.owner)) continue;
    const d = edgeDistance(u, b);
    if (d > radius || d >= bd) continue;
    if (!canAttack(world, u, b)) continue;
    best = b;
    bd = d;
  }
  return best;
}

/**
 * Units preferred over buildings (GDD §F): a unit fighting a structure on its own initiative
 * switches to an enemy unit that comes within acquire range, or to whoever just hit it.
 * Returns the unit to switch to, or null to keep the building.
 */
function preferUnit(world: World, u: Unit, t: Entity, radius: number): Unit | null {
  if (t.kind !== 'building' || !scanDue(world, u)) return null;
  const alt = acquireTarget(world, u, radius);
  if (alt && alt.kind === 'unit') return alt;
  if (u.lastAttackerId && u.lastDamagedTick >= 0 && world.tick - u.lastDamagedTick <= ticks(1)) {
    const a = getEntity(world, u.lastAttackerId);
    if (a && a.kind === 'unit' && canAttack(world, u, a) && edgeDistance(u, a) <= ACQUIRE.leash) return a;
  }
  return null;
}

function scanDue(world: World, u: Unit): boolean {
  const uc = ucore(world, u);
  if (world.tick < uc.nextScanTick) return false;
  uc.nextScanTick = world.tick + SCAN_TICKS;
  return true;
}

function effectiveCooldown(world: World, u: Unit, st: UnitStats): number {
  const atkSpeed = buffSum(world, u, 'attackSpeedPct');
  const cdPct = buffSum(world, u, 'cooldownPct');
  return Math.max(0.1, (st.cooldown / Math.max(0.1, 1 + atkSpeed / 100)) * Math.max(0.1, 1 + cdPct / 100));
}

function doAttack(world: World, u: Unit, t: Entity, st: UnitStats): void {
  const def = UNITS[u.type];
  const packet = computeDamagePacket(world, u, t);
  const ranged = def.range >= COMBAT.rangedThreshold;
  u.attackCooldown = effectiveCooldown(world, u, st);
  u.lastAttackTick = world.tick;
  u.facing = Math.atan2(t.y - u.y, t.x - u.x);
  const projectile = ranged ? (def.projectile ?? 'arrow') : undefined;
  emit(world, {
    t: 'attack',
    attackerId: u.id,
    targetId: t.id,
    x: u.x,
    y: u.y,
    tx: t.x,
    ty: t.y,
    ranged,
    projectile,
    unitType: u.type,
  });
  if (projectile) spawnProjectile(world, projectile, u, t, t.x, t.y, packet);
  else applyPacket(world, u.id, t, packet);
  u.movedSinceAttack = 0;
}

/**
 * Fight `t`: swing/shoot when in range, else approach (if allowed). Tracks the melee
 * unreachable timer and retargets after 1.5 s. Returns false if out of range and not allowed to move.
 */
function engage(world: World, u: Unit, target: Entity, canMove: boolean): boolean {
  let t = target;
  const uc = ucore(world, u);
  const st = unitStats(world, u.owner, u.type, u.rank);
  const d = edgeDistance(u, t);
  if (d <= st.range + RANGE_EPS) {
    stopMoving(world, u);
    uc.noReachTime = 0;
    uc.lastTargetDist = Infinity;
    if (u.attackCooldown <= 0) {
      // Ranged overkill avoidance: an auto-acquired target already doomed by arrows in flight is
      // swapped for another target in range.
      if (st.range >= COMBAT.rangedThreshold && u.order.type !== 'attack' && t.kind === 'unit' && doomed(world, t)) {
        const alt = acquireTarget(world, u, st.range + RANGE_EPS, t.id);
        if (alt && !(alt.kind === 'unit' && doomed(world, alt))) {
          u.targetId = alt.id;
          t = alt;
        }
      }
      doAttack(world, u, t, st);
    }
    u.facing = Math.atan2(t.y - u.y, t.x - u.x);
    return true;
  }
  if (!canMove) return false;
  moveToEntity(world, u, t, Math.max(0, st.range - 0.1));
  if (st.range < COMBAT.rangedThreshold) {
    if (d < uc.lastTargetDist - 0.02 && u.moveStatus !== 'stuck') uc.noReachTime = 0;
    else uc.noReachTime += TICK_DT;
    uc.lastTargetDist = d;
    if (uc.noReachTime >= ACQUIRE.meleeRetargetTime) {
      uc.noReachTime = 0;
      const alt = acquireTarget(world, u, ACQUIRE.meleeRetargetRadius, t.id);
      if (alt) {
        u.targetId = alt.id;
        if (u.order.type === 'attack') u.order.targetId = alt.id;
        uc.lastRetargetTick = world.tick;
        uc.lastTargetDist = Infinity;
      }
    }
  }
  return true;
}

function validTarget(world: World, u: Unit): Entity | null {
  if (!u.targetId) return null;
  const t = getEntity(world, u.targetId);
  if (!t || !canAttack(world, u, t)) {
    u.targetId = 0;
    return null;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Kite
// ---------------------------------------------------------------------------

function kite(world: World, u: Unit): boolean {
  const k = UNITS[u.type].kite;
  if (!k) return false;
  const ot = u.order.type;
  if (ot === 'hold' || ot === 'move' || ot === 'flee') return false;
  if (u.ai && u.ai['noKite'] === true) return false;
  const uc = ucore(world, u);
  if (world.tick < uc.kitingUntil) return true;
  if (world.tick < uc.kiteReadyTick) return false;
  let threat: Unit | null = null;
  let td = Infinity;
  const near = queryUnits(world, u.x, u.y, k.trigger + u.radius + MAX_RADIUS, (o) => o.alive && hostile(o.owner, u.owner));
  for (const o of near) {
    const od = UNITS[o.type];
    if (od.range >= COMBAT.rangedThreshold || od.cooldown <= 0 || od.structuresOnly) continue;
    const d = edgeDistance(u, o);
    if (d <= k.trigger && d < td) {
      td = d;
      threat = o;
    }
  }
  if (!threat) return false;
  let dx = u.x - threat.x;
  let dy = u.y - threat.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const x = Math.max(0.5, Math.min(world.map.w - 0.5, u.x + dx * k.dist));
  const y = Math.max(0.5, Math.min(world.map.h - 0.5, u.y + dy * k.dist));
  movePoint(world, u, x, y, 0.2, false);
  uc.kitingUntil = world.tick + ticks(k.dist / Math.max(0.5, u.speed) + 0.1);
  uc.kiteReadyTick = world.tick + ticks(k.cooldown);
  return true;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function idleBehavior(world: World, u: Unit): void {
  if (!autoAcquires(world, u)) {
    if (u.ai === null) stopMoving(world, u);
    return;
  }
  const uc = ucore(world, u);
  if (uc.returning) {
    if (Math.hypot(u.x - u.homeX, u.y - u.homeY) <= 0.6 || moveDone(world, u)) {
      uc.returning = false;
      stopMoving(world, u);
    } else {
      movePoint(world, u, u.homeX, u.homeY, 0.3, false);
      return;
    }
  }
  const st = unitStats(world, u.owner, u.type, u.rank);
  let t = validTarget(world, u);
  if (t && Math.hypot(u.x - u.homeX, u.y - u.homeY) > ACQUIRE.leash) {
    u.targetId = 0;
    uc.returning = true;
    uc.nextScanTick = world.tick + ticks(1);
    movePoint(world, u, u.homeX, u.homeY, 0.3, false);
    return;
  }
  if (t) {
    const alt = preferUnit(world, u, t, acquireRange(u, st));
    if (alt) {
      t = alt;
      u.targetId = alt.id;
    }
  }
  if (!t && scanDue(world, u)) {
    t = acquireTarget(world, u, acquireRange(u, st));
    if (!t && u.lastAttackerId && u.lastDamagedTick >= 0 && world.tick - u.lastDamagedTick <= ticks(1)) {
      const a = getEntity(world, u.lastAttackerId);
      if (a && canAttack(world, u, a) && edgeDistance(u, a) <= ACQUIRE.leash) t = a;
    }
    if (t) u.targetId = t.id;
  }
  const goingHome = !!u.move && u.move.targetId === 0 && Math.abs(u.move.x - u.homeX) < 0.01 && Math.abs(u.move.y - u.homeY) < 0.01;
  if (t) engage(world, u, t, true);
  else if (goingHome || Math.hypot(u.x - u.homeX, u.y - u.homeY) > HOME_DRIFT) {
    // The fight ended away from the idle spot: walk back (still scanning for targets).
    movePoint(world, u, u.homeX, u.homeY, 0.3, false);
    if (moveDone(world, u)) {
      // Arrived as close as possible (or the spot is now blocked): this is the new idle spot.
      u.homeX = u.x;
      u.homeY = u.y;
      stopMoving(world, u);
    }
  } else stopMoving(world, u);
}

function holdBehavior(world: World, u: Unit): void {
  stopMoving(world, u);
  if (UNITS[u.type].cooldown <= 0) return;
  const st = unitStats(world, u.owner, u.type, u.rank);
  let t = validTarget(world, u);
  if (t && edgeDistance(u, t) > st.range + RANGE_EPS) {
    u.targetId = 0;
    t = null;
  }
  if (!t && (u.ai === null || u.targetId === 0) && scanDue(world, u)) {
    t = acquireTarget(world, u, st.range + RANGE_EPS);
    if (t) u.targetId = t.id;
  }
  if (t) engage(world, u, t, false);
}

function arrived(world: World, u: Unit, x: number, y: number): boolean {
  return Math.hypot(u.x - x, u.y - y) <= 0.25 || moveDone(world, u);
}

function moveBehavior(world: World, u: Unit): void {
  const o = u.order as Extract<Order, { type: 'move' }>;
  movePoint(world, u, o.x, o.y, 0.15);
  if (arrived(world, u, o.x, o.y)) completeOrder(world, u);
}

function attackMoveBehavior(world: World, u: Unit): void {
  const o = u.order as Extract<Order, { type: 'attackMove' }>;
  const uc = ucore(world, u);
  let t: Entity | null = null;
  if (autoAcquires(world, u)) {
    t = validTarget(world, u);
    if (t && Math.hypot(u.x - uc.engageX, u.y - uc.engageY) > ACQUIRE.leash) {
      u.targetId = 0;
      t = null;
      uc.nextScanTick = world.tick + ticks(2);
    }
    if (t) {
      const alt = preferUnit(world, u, t, acquireRange(u, unitStats(world, u.owner, u.type, u.rank)));
      if (alt) {
        t = alt;
        u.targetId = alt.id;
      }
    }
    if (!t && scanDue(world, u)) {
      const st = unitStats(world, u.owner, u.type, u.rank);
      t = acquireTarget(world, u, acquireRange(u, st));
      if (t) {
        u.targetId = t.id;
        uc.engageX = u.x;
        uc.engageY = u.y;
      }
    }
  } else if (u.ai !== null) {
    // Encounter-driven units may have their target set directly; fight it if valid.
    t = validTarget(world, u);
  }
  if (t) {
    engage(world, u, t, true);
    return;
  }
  movePoint(world, u, o.x, o.y, 0.15);
  if (arrived(world, u, o.x, o.y)) completeOrder(world, u);
}

function attackBehavior(world: World, u: Unit): void {
  const o = u.order as Extract<Order, { type: 'attack' }>;
  const t = getEntity(world, o.targetId);
  if (!t || !canAttack(world, u, t)) {
    u.targetId = 0;
    completeOrder(world, u);
    return;
  }
  u.targetId = t.id;
  engage(world, u, t, true);
}

function runUnit(world: World, u: Unit): void {
  if (u.attackCooldown > 0) u.attackCooldown = Math.max(0, u.attackCooldown - TICK_DT);
  // Generic enemies (tests, ai === null) attack the player building blocking their path.
  if (u.owner !== PLAYER && u.ai === null && u.moveStatus === 'blocked' && u.blockedBy && u.order.type !== 'attack') {
    const b = getEntity(world, u.blockedBy);
    if (b && canAttack(world, u, b)) {
      u.queue.unshift({ ...u.order } as Order);
      startOrder(world, u, { type: 'attack', targetId: b.id });
    }
  }
  if (kite(world, u)) return;
  switch (u.order.type) {
    case 'idle':
      idleBehavior(world, u);
      break;
    case 'hold':
      holdBehavior(world, u);
      break;
    case 'move':
      moveBehavior(world, u);
      break;
    case 'attackMove':
      attackMoveBehavior(world, u);
      break;
    case 'attack':
      attackBehavior(world, u);
      break;
    case 'gather':
      gatherBehavior(world, u);
      break;
    case 'deposit':
      depositBehavior(world, u);
      break;
    case 'build':
      buildBehavior(world, u);
      break;
    case 'flee':
      fleeBehavior(world, u);
      break;
  }
}

export function stepBehaviors(world: World): void {
  const units = world.units;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.alive) runUnit(world, u);
  }
}

/** After movement: Charge distance bookkeeping (resets after 1 s standing still). */
export function afterMovement(world: World): void {
  for (const u of world.units) {
    if (!u.alive) continue;
    const moved = Math.hypot(u.x - u.prevX, u.y - u.prevY);
    const uc = ucore(world, u);
    if (moved > 0.002) {
      u.movedSinceAttack += moved;
      uc.stillTime = 0;
    } else {
      uc.stillTime += TICK_DT;
      if (uc.stillTime >= 1) u.movedSinceAttack = 0;
    }
  }
}
