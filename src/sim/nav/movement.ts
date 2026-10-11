/**
 * Movement system (GDD §F movement spec a-g). OWNER: nav.
 * Behaviors set unit.move (MoveIntent); stepMovement moves every unit with an intent:
 * path requests (A* budget 8/tick, flow fields for flowKey/enemy mode), steering along waypoints,
 * speed modifiers (terrain speedMul, Blight x0.8 for player unless kindled_earth, buffs/rooted, speedCap),
 * soft separation via spatial hash (max push 0.5 tiles/s, movers shove idlers), static collision,
 * stuck detection (repath; 3 repaths in 6 s -> moveStatus 'stuck'), arrival (moveStatus 'arrived').
 *
 * Status semantics (read by sim-core / encounter on the next tick):
 * - 'moving'      intent active, walking or waiting for a path
 * - 'arrived'     within range of the target / goal (intent kept; re-evaluated every tick)
 * - 'blocked'     enemy mode: next tile is a player building; unit.blockedBy = its id
 * - 'unreachable' stands at the reachable tile closest to the goal (retries when the grid changes)
 * - 'stuck'       gave up after 3 repaths in 6 s; unit.move was cleared
 * - 'none'        no intent
 */
import { NAV } from '../../data/balance';
import { TICK_DT, TICK_RATE } from '../types';
import type { MoveIntent, Unit, World } from '../types';
import { clampToMap, depenetrate, slideMove, terrainRadius } from './collision';
import type { Pos } from './collision';
import { flowFieldNeedsBuild, getFlowField, peekFlowField } from './flowfield';
import type { FlowField } from './flowfield';
import { segmentPasses } from './los';
import { nearestPassableTile } from './pathfinding';
import { findFreeSpotImpl, formationSlotsImpl } from './placement';
import { applySeparation, avoidSettled } from './separation';
import { currentWorld, navState, pruneNavState, unitNav } from './state';
import type { NavWorldState, UnitNav } from './state';
import {
  ASTAR_STICKY_TICKS,
  ENEMY_FLOW_DIST,
  UNREACH_RETRY_TICKS,
  chooseSteer,
  computeGoal,
  computePath,
  effectiveSpeed,
  goalDistance,
  goalRectFor,
  groupKey,
  hasArrived,
  targetOf,
} from './steering';
import type { TickCtx } from './steering';

/** Dijkstra flow-field builds allowed per tick (others reuse the cached field until next tick). */
const FLOW_BUILDS_PER_TICK = 4;
/** Units slower than this (tiles/s) are not stuck-checked (rooted, heavy speed caps). */
const MIN_STUCK_SPEED = 0.3;
const STUCK_WINDOW_TICKS = Math.round(NAV.stuckWindow * TICK_RATE);
/** No lateral avoidance on the last stretch to a goal (crowd arrival handles it). */
const AVOID_MIN_GOAL_DIST = 1.5;

let startX = new Float64Array(0);
let startY = new Float64Array(0);
let speeds = new Float64Array(0);
let moving = new Uint8Array(0);
const tmp: Pos = { x: 0, y: 0 };
const dir: Pos = { x: 0, y: 0 };

function ensureScratch(n: number): void {
  if (startX.length >= n) return;
  const cap = Math.max(64, n * 2);
  startX = new Float64Array(cap);
  startY = new Float64Array(cap);
  speeds = new Float64Array(cap);
  moving = new Uint8Array(cap);
}

function resetStuck(u: Unit): void {
  if (!u.stuck) u.stuck = { checkX: u.x, checkY: u.y, timer: 0, repaths: 0, windowTimer: 0 };
  const s = u.stuck;
  s.checkX = u.x;
  s.checkY = u.y;
  s.timer = 0;
  s.repaths = 0;
  s.windowTimer = 0;
}

function snapshot(nav: UnitNav, mv: MoveIntent): void {
  nav.hasSnap = true;
  nav.snapX = mv.x;
  nav.snapY = mv.y;
  nav.snapTarget = mv.targetId;
}

function goalMoved(nav: UnitNav, mv: MoveIntent): boolean {
  if (mv.targetId !== nav.snapTarget) return true;
  return mv.targetId === 0 && Math.hypot(mv.x - nav.snapX, mv.y - nav.snapY) > 0.5;
}

export function stepMovement(world: World): void {
  const st = navState(world);
  pruneNavState(world, st);
  const units = world.units;
  const n = units.length;
  ensureScratch(n);
  const ctx = prepass(world);
  serveQueue(world, st, ctx);

  for (let i = 0; i < n; i++) {
    const u = units[i];
    startX[i] = u.x;
    startY[i] = u.y;
    speeds[i] = 0;
    moving[i] = 0;
    if (!u.alive) continue;
    moving[i] = updateUnit(world, st, ctx, u, i) ? 1 : 0;
  }

  applySeparation(world, moving);

  const grid = world.grid;
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (!u.alive) continue;
    const tx = Math.floor(u.x);
    const ty = Math.floor(u.y);
    if (tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h && grid.blocked[ty * grid.w + tx] === 0) {
      tmp.x = u.x;
      tmp.y = u.y;
      const tr = terrainRadius(u);
      depenetrate(grid, tmp, tr);
      clampToMap(grid, tmp, tr);
      u.x = tmp.x;
      u.y = tmp.y;
    }
    u.vx = (u.x - startX[i]) / TICK_DT;
    u.vy = (u.y - startY[i]) / TICK_DT;
    const pathing = u.move !== null && u.moveStatus === 'moving' && speeds[i] >= MIN_STUCK_SPEED;
    stuckStep(world, st, ctx, u, pathing);
  }
}

/** Group counts and flow fields for this tick (flowKey groups, far enemy-mode goals). */
function prepass(world: World): TickCtx {
  const ctx: TickCtx = { astarBudget: NAV.astarPerTick, fieldFor: new Map(), groupN: new Map() };
  const grid = world.grid;
  const reqs = new Map<string, { key: string; mode: 'player' | 'enemy'; tiles: Set<number>; ids: number[] }>();
  for (const u of world.units) {
    if (!u.alive || !u.move) continue;
    const mv = u.move;
    const target = targetOf(world, mv);
    if (target && target.kind === 'unit') continue; // moving goals use A* with repath throttling
    if (mv.flowKey && !target) {
      const gk = groupKey(mv.flowKey, mv);
      ctx.groupN.set(gk, (ctx.groupN.get(gk) ?? 0) + 1);
    }
    const gx = target ? target.x : mv.x;
    const gy = target ? target.y : mv.y;
    let key: string | null = null;
    if (mv.flowKey) key = mv.flowKey;
    else if (mv.mode === 'enemy') {
      const auto = '~' + (target ? 't' + target.id : 'p' + clampTile(world, gx, gy));
      if (Math.hypot(u.x - gx, u.y - gy) > ENEMY_FLOW_DIST || (u.path !== null && u.path.flowKey === auto)) key = auto;
    }
    if (key === null) continue;
    const rk = mv.mode + ':' + key;
    let r = reqs.get(rk);
    if (!r) {
      r = { key, mode: mv.mode, tiles: new Set(), ids: [] };
      reqs.set(rk, r);
    }
    r.ids.push(u.id);
    const rect = goalRectFor(world, mv, target);
    if (rect) {
      for (let y = Math.max(0, rect.ty); y < Math.min(grid.h, rect.ty + rect.h); y++) {
        for (let x = Math.max(0, rect.tx); x < Math.min(grid.w, rect.tx + rect.w); x++) r.tiles.add(y * grid.w + x);
      }
    } else {
      r.tiles.add(clampTile(world, mv.x, mv.y));
    }
  }
  let builds = FLOW_BUILDS_PER_TICK;
  for (const r of reqs.values()) {
    const tiles = [...r.tiles];
    let field: FlowField | null;
    if (!flowFieldNeedsBuild(world, r.key, tiles, r.mode)) field = getFlowField(world, r.key, tiles, r.mode);
    else if (builds > 0) {
      builds--;
      field = getFlowField(world, r.key, tiles, r.mode);
    } else field = peekFlowField(world, r.key, r.mode);
    if (field) for (const id of r.ids) ctx.fieldFor.set(id, field);
  }
  return ctx;
}

function clampTile(world: World, x: number, y: number): number {
  const grid = world.grid;
  const tx = Math.min(grid.w - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(grid.h - 1, Math.max(0, Math.floor(y)));
  return ty * grid.w + tx;
}

/** Serve queued A* requests first (FIFO) within the per-tick budget. */
function serveQueue(world: World, st: NavWorldState, ctx: TickCtx): void {
  const q = st.queue;
  let head = 0;
  while (ctx.astarBudget > 0 && head < q.length) {
    const id = q[head++];
    const nav = st.units.get(id);
    if (!nav || !nav.queued) continue;
    nav.queued = false;
    const e = world.entities.get(id);
    if (!e || e.kind !== 'unit' || !e.alive || !e.move) continue;
    const goal = computeGoal(world, e, e.move, ctx);
    ctx.astarBudget--;
    computePath(world, e, e.move, goal, nav);
  }
  if (head > 0) q.splice(0, head);
}

/** Walk a moving unit whose center is inside a blocked tile (dais, misplaced spawn) onto walkable ground. */
function escapeIfInside(world: World, u: Unit): boolean {
  const grid = world.grid;
  const tx = Math.floor(u.x);
  const ty = Math.floor(u.y);
  if (tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h && grid.blocked[ty * grid.w + tx] === 0) return false;
  const t = nearestPassableTile(world, u.x, u.y, 4, 'player');
  if (t < 0) {
    tmp.x = u.x;
    tmp.y = u.y;
    clampToMap(grid, tmp, terrainRadius(u));
    u.x = tmp.x;
    u.y = tmp.y;
    return false;
  }
  const cx = (t % grid.w) + 0.5;
  const cy = Math.floor(t / grid.w) + 0.5;
  const d = Math.hypot(cx - u.x, cy - u.y);
  const step = Math.max(u.speed > 0 ? u.speed : 0, 2) * TICK_DT;
  if (d <= step) {
    u.x = cx;
    u.y = cy;
  } else {
    u.x += ((cx - u.x) / d) * step;
    u.y += ((cy - u.y) / d) * step;
  }
  return true;
}

/** Advance one unit; returns true if it is actively moving this tick (for separation shoving). */
function updateUnit(world: World, st: NavWorldState, ctx: TickCtx, u: Unit, i: number): boolean {
  const nav = unitNav(st, u.id);
  const mv = u.move;
  if (!mv) {
    nav.hasSnap = false;
    if (u.moveStatus !== 'none' && u.moveStatus !== 'stuck') u.moveStatus = 'none';
    u.blockedBy = 0;
    u.path = null;
    // Idle units inside blocked tiles stay put (the enthroned Briar Regent stands on its dais).
    return false;
  }
  // Behaviors / encounter may replace or mutate unit.move without setMove.
  if (!nav.hasSnap) snapshot(nav, mv);
  else if (goalMoved(nav, mv)) {
    u.path = null;
    u.blockedBy = 0;
    u.moveStatus = 'moving';
    nav.astarUntil = -1;
    resetStuck(u);
    snapshot(nav, mv);
  }
  if (escapeIfInside(world, u)) {
    u.moveStatus = 'moving';
    return true;
  }

  const goal = computeGoal(world, u, mv, ctx);
  if (hasArrived(world, u, goal, nav)) {
    if (u.moveStatus !== 'arrived') nav.arrivedDist = goal.dist;
    u.moveStatus = 'arrived';
    u.blockedBy = 0;
    if (goal.targetId) u.facing = Math.atan2(mv.y - u.y, mv.x - u.x);
    return false;
  }
  if (u.moveStatus === 'unreachable') {
    const retry =
      world.grid.version !== nav.unreachVersion ||
      (goal.unitTarget !== null && world.tick - nav.unreachTick >= UNREACH_RETRY_TICKS);
    if (!retry) return false;
    u.path = null;
  }

  const spd = effectiveSpeed(world, u, mv);
  speeds[i] = spd;
  const steer = chooseSteer(world, st, ctx, u, mv, goal, nav);
  if (steer.kind === 'blocked') {
    u.moveStatus = 'blocked';
    u.blockedBy = steer.id;
    return false;
  }
  if (steer.kind === 'unreachable') {
    u.moveStatus = 'unreachable';
    u.blockedBy = 0;
    nav.unreachVersion = world.grid.version;
    nav.unreachTick = world.tick;
    return false;
  }
  u.moveStatus = 'moving';
  u.blockedBy = 0;
  if (steer.kind === 'wait') return true;

  const dx = steer.x - u.x;
  const dy = steer.y - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9 || spd <= 0) return spd > 0;
  let step = spd * TICK_DT;
  if (steer.final) {
    if (goal.isPoint) step = Math.min(step, d);
    else step = Math.min(step, d, Math.max(0, goal.dist - goal.tol) + 0.03);
  }
  let ux = dx / d;
  let uy = dy / d;
  if (!(steer.final && d < AVOID_MIN_GOAL_DIST)) {
    avoidSettled(world, u, ux, uy, goal.targetId, dir);
    ux = dir.x;
    uy = dir.y;
  }
  slideMove(world.grid, u.x, u.y, terrainRadius(u), ux * step, uy * step, tmp);
  u.x = tmp.x;
  u.y = tmp.y;
  u.facing = Math.atan2(uy, ux);
  goal.dist = goalDistance(u, goal);
  if (goal.dist <= goal.tol) {
    u.moveStatus = 'arrived';
    nav.arrivedDist = goal.dist;
  }
  return true;
}

/** GDD §F e: < 0.15 tiles in 1.0 s while pathing -> repath; after 3 repaths within 6 s -> 'stuck'. */
function stuckStep(world: World, st: NavWorldState, ctx: TickCtx, u: Unit, pathing: boolean): void {
  if (!u.stuck) resetStuck(u);
  const s = u.stuck;
  if (s.repaths > 0) {
    s.windowTimer += TICK_DT;
    if (s.windowTimer > NAV.stuckWindow) {
      s.repaths = 0;
      s.windowTimer = 0;
    }
  }
  if (!pathing) {
    s.timer = 0;
    s.checkX = u.x;
    s.checkY = u.y;
    return;
  }
  s.timer += TICK_DT;
  if (s.timer < NAV.stuckTime - 1e-9) return;
  const moved = Math.hypot(u.x - s.checkX, u.y - s.checkY);
  s.timer = 0;
  s.checkX = u.x;
  s.checkY = u.y;
  if (moved >= NAV.stuckDist) return;
  const nav = unitNav(st, u.id);
  const mv = u.move;
  if (s.repaths >= NAV.stuckMaxRepaths) {
    if (mv) {
      nav.stuckTick = world.tick;
      nav.stuckX = mv.x;
      nav.stuckY = mv.y;
      nav.stuckTarget = mv.targetId;
    }
    u.move = null;
    u.path = null;
    u.moveStatus = 'stuck';
    u.blockedBy = 0;
    nav.hasSnap = false;
    nav.queued = false;
    return;
  }
  if (s.repaths === 0) s.windowTimer = 0;
  s.repaths++;
  u.path = null;
  if (ctx.fieldFor.has(u.id)) nav.astarUntil = world.tick + ASTAR_STICKY_TICKS;
}

/** Set or clear a unit's movement intent (resets path/stuck state when the goal changes materially). */
export function setMove(world: World, unit: Unit, intent: MoveIntent | null): void {
  const st = navState(world);
  const nav = unitNav(st, unit.id);
  if (!intent) {
    unit.move = null;
    unit.path = null;
    unit.blockedBy = 0;
    unit.moveStatus = 'none';
    nav.hasSnap = false;
    nav.queued = false;
    return;
  }
  const prev = unit.move;
  const changed =
    prev === null ||
    prev.targetId !== intent.targetId ||
    (intent.targetId === 0 && Math.hypot(prev.x - intent.x, prev.y - intent.y) > 0.5);
  unit.move = { ...intent };
  if (changed) {
    unit.path = null;
    unit.blockedBy = 0;
    unit.moveStatus = 'moving';
    nav.astarUntil = -1;
    // Re-issuing the goal that just got stuck keeps the counters (gives up again after 1 s).
    const sameAsStuck =
      world.tick - nav.stuckTick <= STUCK_WINDOW_TICKS &&
      (intent.targetId !== 0
        ? intent.targetId === nav.stuckTarget
        : nav.stuckTarget === 0 && Math.hypot(intent.x - nav.stuckX, intent.y - nav.stuckY) <= 0.5);
    if (sameAsStuck && unit.stuck) {
      unit.stuck.timer = 0;
      unit.stuck.checkX = unit.x;
      unit.stuck.checkY = unit.y;
    } else {
      resetStuck(unit);
    }
  }
  snapshot(nav, unit.move);
}

/** Knockback/dash: move by (dx, dy) in 0.25-tile steps, stopping at the last walkable position. */
export function displaceUnit(world: World, unit: Unit, dx: number, dy: number): void {
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9)) return;
  const grid = world.grid;
  const steps = Math.ceil(len / NAV.displacementStep);
  const sx = dx / steps;
  const sy = dy / steps;
  const walk = (i: number): boolean => grid.blocked[i] === 0;
  for (let k = 0; k < steps; k++) {
    const nx = unit.x + sx;
    const ny = unit.y + sy;
    if (!segmentPasses(grid, unit.x, unit.y, nx, ny, walk)) break;
    unit.x = nx;
    unit.y = ny;
  }
  tmp.x = unit.x;
  tmp.y = unit.y;
  const tr = terrainRadius(unit);
  depenetrate(grid, tmp, tr);
  clampToMap(grid, tmp, tr);
  unit.x = tmp.x;
  unit.y = tmp.y;
  // Remaining path legs are re-validated from the new position.
  unitNav(navState(world), unit.id).pathVersion = -1;
}

/** Nearest free walkable tile center to (x, y) within maxR tiles via BFS spiral (no static entity, few units). */
export function findFreeSpot(world: World, x: number, y: number, maxR: number): { x: number; y: number } | null {
  const s = findFreeSpotImpl(world, x, y, maxR);
  return s ? { x: s.x, y: s.y } : null;
}

/**
 * Formation slots for a group order: role-sorted offsets (melee front, ranged behind) facing from->to.
 * slots[i] belongs to units[i]. Pass `world` (optional, additive) to move slots off blocked tiles;
 * without it the world the units live in is used when the movement system has seen it.
 */
export function formationSlots(
  units: Unit[],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  world?: World,
): { x: number; y: number }[] {
  let w: World | null = world ?? null;
  if (!w && units.length > 0) {
    const cw = currentWorld();
    if (cw && cw.entities.get(units[0].id) === units[0]) w = cw;
  }
  return formationSlotsImpl(units, fromX, fromY, toX, toY, w);
}
