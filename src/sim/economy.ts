/**
 * Tiller economy behaviors (GDD §D, §E): gather loop, deposit, build / repair, flee, construction
 * progress and passive income. OWNER: sim-core.
 *
 * Gather loop: claim a slot -> walk to the source -> gather (whole units move from the source to the
 * load) -> when full, re-pick the nearest drop-off and walk there -> deposit -> back to the source.
 * Full source: same resource within 8 tiles, else wait 3 s (taking a slot as soon as one frees) and
 * retry once, then idle + alert. Depleted source: same resource within 8 tiles, else idle + alert.
 */
import { BUILD, FLEE, GATHER } from '../data/balance';
import { BUILDINGS } from '../data/buildings';
import { ALERT_THROTTLE, alert, emit, throttle } from './alerts';
import { claim, holdsClaim, releaseClaim, resolveTarget, slotFree } from './claims';
import type { GatherSource, ResolvedTarget } from './claims';
import { buffSum, core, hasBuff, hostile, pointRectDist, ticks, ucore } from './core';
import * as encounter from './encounter';
import { getBuilding, killEntity } from './entities';
import { completeOrder, startOrder } from './orders';
import { moveDone, moveFailed, movePoint, moveToEntity, stopMoving } from './movement';
import { edgeDistance } from './nav/geometry';
import { onTerrainChanged } from './nav/grid';
import { queryUnits } from './nav/spatial';
import { recomputePopCap } from './players';
import { buildingStats, carryCap, flagValue, gatherRate } from './stats';
import type { Building, GatherTarget, Order, Unit, World } from './types';
import { PLAYER, TICK_DT, Terrain } from './types';

/** Reach (edge distance) at which a Tiller can gather / deposit / build. */
const REACH = 0.45;
/** Approach range for a tree tile (nav treats a point inside a blocked tile as an edge-distance goal). */
const TREE_APPROACH = 0.2;

// ---------------------------------------------------------------------------
// Drop-offs
// ---------------------------------------------------------------------------

export function isDropoff(b: Building): boolean {
  return b.alive && b.built && b.owner === PLAYER && !!BUILDINGS[b.type].dropoff;
}

/** Nearest player drop-off to a point (edge distance), optionally filtered. */
export function nearestDropoff(world: World, x: number, y: number, ok?: (b: Building) => boolean): Building | null {
  let best: Building | null = null;
  let bd = Infinity;
  for (const b of world.buildings) {
    if (!isDropoff(b) || (ok && !ok(b))) continue;
    const d = pointRectDist(x, y, b.tx, b.ty, b.w, b.h);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

export function deposit(world: World, u: Unit, b: Building): void {
  if (!u.carry || u.carry.amount <= 0) {
    u.carry = null;
    return;
  }
  const p = world.players[u.owner];
  const { type, amount } = u.carry;
  p.res[type] += amount;
  p.stats.gathered[type] += amount;
  emit(world, { t: 'dropoff', unitId: u.id, res: type, amount, x: b.x, y: b.y });
  u.carry = null;
}

function inReachOf(u: Unit, t: ResolvedTarget): boolean {
  if (t.node) return edgeDistance(u, t.node) <= REACH;
  if (t.plot) return edgeDistance(u, t.plot) <= REACH;
  return pointRectDist(u.x, u.y, t.tx, t.ty, 1, 1) - u.radius <= REACH;
}

function approach(world: World, u: Unit, t: ResolvedTarget): void {
  if (t.node) moveToEntity(world, u, t.node, 0.2);
  else if (t.plot) moveToEntity(world, u, t.plot, 0.2);
  else movePoint(world, u, t.x, t.y, TREE_APPROACH, false);
}

// ---------------------------------------------------------------------------
// Finding sources
// ---------------------------------------------------------------------------

/** A tree tile with at least one walkable neighbour (a Tiller can stand next to it). */
export function treeReachable(world: World, tile: number): boolean {
  const w = world.map.w;
  const h = world.map.h;
  const tx = tile % w;
  const ty = (tile - tx) / w;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (world.grid.blocked[y * w + x] === 0) return true;
    }
  }
  return false;
}

function isLiveTree(world: World, tile: number): boolean {
  return world.map.terrain[tile] === Terrain.Forest && world.map.treeAmount[tile] > 0;
}

/**
 * Nearest free source of the same resource within `radius` of (fx, fy), closest to the Tiller.
 * Trees look for trees; Grain looks at Thickets and Grainplots; Ember at Seams.
 */
export function findAlternative(
  world: World,
  u: Unit,
  source: GatherSource,
  fx: number,
  fy: number,
  radius: number,
  exclude: GatherTarget | null,
): GatherTarget | null {
  if (source === 'tree') {
    const w = world.map.w;
    const h = world.map.h;
    const trees = core(world).treeGatherers;
    let best = -1;
    let bd = Infinity;
    const x0 = Math.max(0, Math.floor(fx - radius));
    const x1 = Math.min(w - 1, Math.floor(fx + radius));
    const y0 = Math.max(0, Math.floor(fy - radius));
    const y1 = Math.min(h - 1, Math.floor(fy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tile = y * w + x;
        if (!isLiveTree(world, tile) || trees[tile] >= GATHER.maxGatherers.tree) continue;
        if (exclude && exclude.kind === 'tree' && exclude.tile === tile) continue;
        const cx = x + 0.5;
        const cy = y + 0.5;
        if (Math.hypot(cx - fx, cy - fy) > radius) continue;
        if (!treeReachable(world, tile)) continue;
        const d = Math.hypot(cx - u.x, cy - u.y);
        if (d < bd - 1e-9) {
          bd = d;
          best = tile;
        }
      }
    }
    return best >= 0 ? { kind: 'tree', tile: best } : null;
  }
  const res = source === 'ember_seam' ? 'ember' : 'grain';
  let best: GatherTarget | null = null;
  let bd = Infinity;
  for (const r of world.resources) {
    if (!r.alive || r.amount <= 0 || r.resType !== res || r.gatherers >= r.maxGatherers) continue;
    if (exclude && exclude.kind === 'node' && exclude.id === r.id) continue;
    if (pointRectDist(fx, fy, r.tx, r.ty, r.w, r.h) > radius) continue;
    const d = pointRectDist(u.x, u.y, r.tx, r.ty, r.w, r.h);
    if (d < bd) {
      bd = d;
      best = { kind: 'node', id: r.id };
    }
  }
  if (res === 'grain') {
    for (const b of world.buildings) {
      if (b.type !== 'grainplot' || !b.alive || !b.built || b.owner !== u.owner) continue;
      if (b.gatherers >= (BUILDINGS.grainplot.gather?.maxGatherers ?? 2)) continue;
      if (exclude && exclude.kind === 'plot' && exclude.id === b.id) continue;
      if (pointRectDist(fx, fy, b.tx, b.ty, b.w, b.h) > radius) continue;
      const d = pointRectDist(u.x, u.y, b.tx, b.ty, b.w, b.h);
      if (d < bd) {
        bd = d;
        best = { kind: 'plot', id: b.id };
      }
    }
  }
  return best;
}

/** Normalise a requested tree tile: an unreachable / dead tree becomes the nearest gatherable tree nearby. */
export function normaliseTreeTarget(world: World, u: Unit, tile: number): GatherTarget | null {
  if (isLiveTree(world, tile) && treeReachable(world, tile)) return { kind: 'tree', tile };
  const w = world.map.w;
  const tx = tile % w;
  const ty = (tile - tx) / w;
  return findAlternative(world, u, 'tree', tx + 0.5, ty + 0.5, 6, null);
}

// ---------------------------------------------------------------------------
// Gather loop
// ---------------------------------------------------------------------------

function idleWithAlert(world: World, u: Unit): void {
  u.job = null;
  if (u.carry && u.carry.amount > 0) {
    const d = nearestDropoff(world, u.x, u.y);
    if (d) {
      startOrder(world, u, { type: 'deposit', buildingId: d.id });
      raiseIdleAlert(world, u);
      return;
    }
  }
  completeOrder(world, u);
  raiseIdleAlert(world, u);
}

export function raiseIdleAlert(world: World, u: Unit): void {
  if (u.owner !== PLAYER) return;
  if (throttle(world, 'idle_tillers', ALERT_THROTTLE.idleTillers)) alert(world, 'idle_tillers', { x: u.x, y: u.y, priority: 'low' });
}

function onBlight(world: World, u: Unit): boolean {
  const tx = Math.floor(u.x);
  const ty = Math.floor(u.y);
  if (tx < 0 || ty < 0 || tx >= world.map.w || ty >= world.map.h) return false;
  return world.blight.tiles[ty * world.map.w + tx] === 1;
}

/** Take one unit of resource from a source; returns false if it was empty. */
function takeOne(world: World, t: ResolvedTarget): boolean {
  if (t.node) {
    if (t.node.amount <= 0) return false;
    t.node.amount -= 1;
    if (t.node.amount <= 0) killEntity(world, t.node, 0);
    return true;
  }
  if (t.plot) {
    t.plot.ripeness = (t.plot.ripeness + 1 / 30) % 1;
    return true;
  }
  const tile = t.tile as number;
  const amt = world.map.treeAmount[tile];
  if (amt <= 0) return false;
  world.map.treeAmount[tile] = amt - 1;
  if (amt - 1 <= 0) fellTree(world, tile);
  return true;
}

export function fellTree(world: World, tile: number): void {
  world.map.treeAmount[tile] = 0;
  world.map.terrain[tile] = Terrain.Stump;
  core(world).treeGatherers[tile] = 0;
  onTerrainChanged(world, tile);
  emit(world, { t: 'treeFelled', tile });
}

function beginReturnTrip(o: Extract<Order, { type: 'gather' }>): void {
  o.phase = 'toDropoff';
  o.dropoffId = undefined;
}

export function gatherBehavior(world: World, u: Unit): void {
  const o = u.order as Extract<Order, { type: 'gather' }>;
  const uc = ucore(world, u);

  if (o.phase === 'toDropoff') {
    returnTrip(world, u, o);
    return;
  }

  let t = resolveTarget(world, o.target);
  if (!t) {
    // Depleted / destroyed: same resource within 8 tiles of the old source, else idle.
    const old = uc.lastSource ?? { ...oldPosition(world, o.target), source: sourceOf(world, o.target) ?? 'thicket' };
    releaseClaim(world, u);
    const alt = findAlternative(world, u, old.source, old.x, old.y, GATHER.depletedSearchRadius, o.target);
    if (!alt) {
      idleWithAlert(world, u);
      return;
    }
    o.target = alt;
    u.job = alt;
    o.waitTimer = undefined;
    t = resolveTarget(world, alt);
    if (!t) return;
  }

  uc.lastSource = { x: t.x, y: t.y, source: t.source };
  const cap = carryCap(world, u.owner, t.res);
  if (u.carry && u.carry.amount > 0 && (u.carry.type !== t.res || u.carry.amount >= cap)) {
    beginReturnTrip(o);
    returnTrip(world, u, o);
    return;
  }

  if (!holdsClaim(world, u, o.target)) {
    if (!claim(world, u, o.target)) {
      const alt = findAlternative(world, u, t.source, t.x, t.y, GATHER.fullNodeSearchRadius, o.target);
      if (alt && claim(world, u, alt)) {
        o.target = alt;
        u.job = alt;
        o.waitTimer = undefined;
        return;
      }
      // Wait 3 s for a slot (taking one as soon as it frees), then give up.
      if (o.waitTimer === undefined) {
        o.waitTimer = GATHER.fullNodeWait;
        if (!inReachOf(u, t)) approach(world, u, t);
        return;
      }
      o.waitTimer -= TICK_DT;
      if (inReachOf(u, t)) stopMoving(world, u);
      if (o.waitTimer > 0) return;
      idleWithAlert(world, u);
      return;
    }
    o.waitTimer = undefined;
  }

  if (!inReachOf(u, t)) {
    o.phase = 'toNode';
    approach(world, u, t);
    if (moveFailed(world, u)) {
      // Cannot get there: try another source of the same kind nearby.
      const alt = findAlternative(world, u, t.source, t.x, t.y, GATHER.fullNodeSearchRadius, o.target);
      releaseClaim(world, u);
      if (alt) {
        o.target = alt;
        u.job = alt;
      } else {
        idleWithAlert(world, u);
      }
    }
    return;
  }

  // Gathering.
  o.phase = 'gathering';
  stopMoving(world, u);
  u.facing = Math.atan2(t.y - u.y, t.x - u.x);
  const rate = gatherRate(world, u.owner, t.source, onBlight(world, u), buffSum(world, u, 'gatherPct'));
  uc.gatherAcc += rate * TICK_DT;
  if (!u.carry || u.carry.type !== t.res) u.carry = { type: t.res, amount: 0 };
  while (uc.gatherAcc >= 1 && u.carry.amount < cap) {
    if (!takeOne(world, t)) break;
    uc.gatherAcc -= 1;
    u.carry.amount += 1;
    u.lastAttackTick = world.tick;
    emit(world, { t: 'gather', unitId: u.id, res: t.res, source: t.source, x: t.x, y: t.y });
    if (t.node && !t.node.alive) break;
    if (t.tile !== undefined && !isLiveTree(world, t.tile)) break;
  }
  if (u.carry.amount >= cap) beginReturnTrip(o);
}

function oldPosition(world: World, t: GatherTarget): { x: number; y: number } {
  if (t.kind === 'tree') {
    const w = world.map.w;
    const tx = t.tile % w;
    return { x: tx + 0.5, y: (t.tile - tx) / w + 0.5 };
  }
  const e = world.entities.get(t.id);
  return e ? { x: e.x, y: e.y } : { x: 0, y: 0 };
}

function sourceOf(world: World, t: GatherTarget): GatherSource | null {
  if (t.kind === 'tree') return 'tree';
  if (t.kind === 'plot') return 'grainplot';
  const e = world.entities.get(t.id);
  return e && e.kind === 'resource' ? e.type : null;
}

function returnTrip(world: World, u: Unit, o: Extract<Order, { type: 'gather' }>): void {
  if (!u.carry || u.carry.amount <= 0) {
    u.carry = null;
    o.phase = 'toNode';
    return;
  }
  let d = o.dropoffId ? getBuilding(world, o.dropoffId) : undefined;
  if (!d || !isDropoff(d)) {
    d = nearestDropoff(world, u.x, u.y) ?? undefined;
    o.dropoffId = d?.id;
    if (!d) {
      stopMoving(world, u);
      return;
    }
  }
  if (edgeDistance(u, d) <= REACH) {
    deposit(world, u, d);
    o.phase = 'toNode';
    o.dropoffId = undefined;
    stopMoving(world, u);
    return;
  }
  moveToEntity(world, u, d, 0.2);
  if (moveFailed(world, u)) o.dropoffId = undefined;
}

// ---------------------------------------------------------------------------
// Deposit order
// ---------------------------------------------------------------------------

/** After deposit / build / repair: next queued order, else the remembered gather job, else idle. */
export function resumeAfterWork(world: World, u: Unit, built?: Building): void {
  if (u.queue.length > 0) {
    completeOrder(world, u);
    return;
  }
  if (built && built.type === 'grainplot' && built.built && slotFree(world, { kind: 'plot', id: built.id })) {
    startOrder(world, u, { type: 'gather', target: { kind: 'plot', id: built.id } });
    return;
  }
  if (u.job && resolveTarget(world, u.job)) {
    startOrder(world, u, { type: 'gather', target: u.job });
    return;
  }
  completeOrder(world, u);
  if (u.type === 'tiller' && u.order.type === 'idle') raiseIdleAlert(world, u);
}

export function depositBehavior(world: World, u: Unit): void {
  const o = u.order as Extract<Order, { type: 'deposit' }>;
  if (!u.carry || u.carry.amount <= 0) {
    u.carry = null;
    resumeAfterWork(world, u);
    return;
  }
  let b = getBuilding(world, o.buildingId);
  if (!b || !isDropoff(b)) {
    b = nearestDropoff(world, u.x, u.y) ?? undefined;
    if (!b) {
      completeOrder(world, u);
      return;
    }
    o.buildingId = b.id;
  }
  if (edgeDistance(u, b) <= REACH) {
    deposit(world, u, b);
    stopMoving(world, u);
    resumeAfterWork(world, u);
    return;
  }
  moveToEntity(world, u, b, 0.2);
  if (moveFailed(world, u)) completeOrder(world, u);
}

// ---------------------------------------------------------------------------
// Build / repair
// ---------------------------------------------------------------------------

export function buildBehavior(world: World, u: Unit): void {
  const o = u.order as Extract<Order, { type: 'build' }>;
  const b = getBuilding(world, o.buildingId);
  if (!b || b.owner !== u.owner) {
    resumeAfterWork(world, u);
    return;
  }
  if (b.built && b.hp >= b.maxHp) {
    resumeAfterWork(world, u, b);
    return;
  }
  if (edgeDistance(u, b) > REACH) {
    moveToEntity(world, u, b, 0.2);
    if (moveFailed(world, u)) resumeAfterWork(world, u);
    return;
  }
  stopMoving(world, u);
  u.facing = Math.atan2(b.y - u.y, b.x - u.x);
  const c = core(world);
  const map = b.built ? c.repairers : c.builders;
  map.set(b.id, (map.get(b.id) ?? 0) + 1);
  if ((world.tick + u.id) % 20 === 0) u.lastAttackTick = world.tick;
}

export function completeBuilding(world: World, b: Building): void {
  if (b.built) return;
  b.built = true;
  b.buildProgress = 1;
  const c = core(world);
  c.foundationPaid.delete(b.id);
  if (b.owner === PLAYER) {
    const p = world.players[PLAYER];
    p.stats.buildingsBuilt++;
    recomputePopCap(world);
    alert(world, 'building_complete', { text: `${BUILDINGS[b.type].name} complete.`, x: b.x, y: b.y, priority: 'low' });
  }
  emit(world, { t: 'built', id: b.id, type: b.type, owner: b.owner, x: b.x, y: b.y });
  if (b.owner === PLAYER && c.encounterOn) encounter.onPlayerBuildingChanged(world);
}

/** Apply this tick's construction and repair work (after all behaviors registered their builders). */
export function applyConstruction(world: World): void {
  const c = core(world);
  for (const [id, n] of c.builders) {
    const b = getBuilding(world, id);
    if (!b || b.built) continue;
    const bt = buildingStats(world, b.owner, b.type).buildTime;
    const nEff = Math.min(BUILD.maxBuilders, n);
    const dp = bt > 0 ? (TICK_DT * (nEff + 2)) / (3 * bt) : 1;
    const before = b.buildProgress;
    b.buildProgress = Math.min(1, before + dp);
    b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * (b.buildProgress - before));
    if (b.buildProgress >= 1 - 1e-9) completeBuilding(world, b);
  }
  for (const [id, n] of c.repairers) {
    const b = getBuilding(world, id);
    if (!b || !b.built) continue;
    b.hp = Math.min(b.maxHp, b.hp + Math.min(BUILD.maxRepairers, n) * BUILD.repairHpPerSec * TICK_DT);
  }
  c.builders.clear();
  c.repairers.clear();
}

// ---------------------------------------------------------------------------
// Flee (GDD §D)
// ---------------------------------------------------------------------------

function enemyNear(world: World, x: number, y: number, r: number, owner: number): boolean {
  return queryUnits(world, x, y, r, (o) => o.alive && hostile(o.owner, owner as 0 | 1 | 2)).length > 0;
}

/** Nearest drop-off with no enemy within 6 tiles, else the Hearth; returns a standing point beside it. */
function fleeDestination(world: World, u: Unit): { x: number; y: number } | null {
  const safe = nearestDropoff(world, u.x, u.y, (b) => !enemyNear(world, b.x, b.y, FLEE.dropoffClearRadius + Math.max(b.w, b.h) / 2, u.owner));
  const b = safe ?? (world.hearthId ? getBuilding(world, world.hearthId) : undefined);
  if (!b) return null;
  // Closest point on the footprint, pushed out by 0.7 toward the Tiller.
  const qx = Math.min(Math.max(u.x, b.tx), b.tx + b.w);
  const qy = Math.min(Math.max(u.y, b.ty), b.ty + b.h);
  let nx = u.x - qx;
  let ny = u.y - qy;
  const len = Math.hypot(nx, ny);
  if (len < 1e-6) {
    nx = 0;
    ny = 1;
  } else {
    nx /= len;
    ny /= len;
  }
  return { x: qx + nx * 0.7, y: qy + ny * 0.7 };
}

export function onTillerDamaged(world: World, u: Unit, attackerId: number): void {
  if (u.type !== 'tiller' || u.owner !== PLAYER || !u.alive) return;
  const a = attackerId ? world.entities.get(attackerId) : undefined;
  if (a && !hostile(a.owner, u.owner)) return;
  if (hasBuff(world, u, 'rally_hearth')) return;
  if (u.order.type === 'attack') return;
  if (u.order.type === 'flee') {
    u.order.resumeAt = world.tick + ticks(FLEE.resumeDelay);
    return;
  }
  const dest = fleeDestination(world, u);
  if (!dest) return;
  const uc = ucore(world, u);
  uc.savedOrder = u.order.type === 'idle' || u.order.type === 'hold' ? null : u.order;
  uc.savedQueue = u.queue.length ? [...u.queue] : null;
  u.queue.length = 0;
  releaseClaim(world, u);
  startOrder(world, u, { type: 'flee', x: dest.x, y: dest.y, resumeAt: world.tick + ticks(FLEE.resumeDelay) });
}

/** Restore a saved order (flee / rally), or the gather job, else stay idle. */
export function restoreSaved(world: World, u: Unit): void {
  const uc = ucore(world, u);
  const saved = uc.savedOrder;
  const queue = uc.savedQueue;
  uc.savedOrder = null;
  uc.savedQueue = null;
  if (saved && saved.type === 'gather') {
    saved.phase = 'toNode';
    saved.dropoffId = undefined;
    saved.waitTimer = undefined;
  }
  if (saved) startOrder(world, u, saved);
  else if (u.job && resolveTarget(world, u.job)) startOrder(world, u, { type: 'gather', target: u.job });
  else startOrder(world, u, { type: 'idle' });
  if (queue) u.queue.push(...queue);
}

export function fleeBehavior(world: World, u: Unit): void {
  const o = u.order as Extract<Order, { type: 'flee' }>;
  if ((world.tick + u.id) % 5 === 0 && enemyNear(world, u.x, u.y, FLEE.resumeClearRadius, u.owner)) {
    o.resumeAt = world.tick + ticks(FLEE.resumeDelay);
  }
  const close = Math.hypot(u.x - o.x, u.y - o.y) <= 0.8;
  if (!close && !moveDone(world, u)) movePoint(world, u, o.x, o.y, 0.5, false);
  else stopMoving(world, u);
  if (close && u.carry && u.carry.amount > 0) {
    const d = nearestDropoff(world, u.x, u.y);
    if (d && edgeDistance(u, d) <= REACH + 0.5) deposit(world, u, d);
  }
  if (world.tick >= (o.resumeAt ?? 0)) restoreSaved(world, u);
}

// ---------------------------------------------------------------------------
// Passive income
// ---------------------------------------------------------------------------

export function passiveIncome(world: World): void {
  const tithe = flagValue(world, PLAYER, 'ember_tithe');
  if (tithe > 0) world.players[PLAYER].res.ember += tithe * TICK_DT;
}
