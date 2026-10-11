/**
 * Per-unit goal resolution, arrival tests and steering-target selection for the movement system
 * (GDD §F a-c, f). Pure decision logic; movement.ts applies the resulting step. OWNER: nav.
 */
import { NAV, groupArrivalRadius } from '../../data/balance';
import { PLAYER } from '../types';
import type { Entity, MoveIntent, PathState, Unit, World } from '../types';
import { navAux } from './layers';
import { terrainRadius } from './collision';
import { flowNextTile } from './flowfield';
import type { FlowField } from './flowfield';
import { distToRectXY, edgeDistance } from './geometry';
import { clearLine, segmentPasses } from './los';
import { findPathEx } from './pathfinding';
import { forEachUnitNear } from './spatial';
import type { NavWorldState, UnitNav } from './state';

/** Final approach: steer straight at the goal when it is this close and in walkable line of sight. */
export const DIRECT_RANGE = 12;
/** Enemy-mode units use a flow field when the goal is farther than this (tiles). */
export const ENEMY_FLOW_DIST = 12;
/** Arrival tolerance for a single unit's point goal. */
const ARRIVE_EPS = 0.1;
/** Arrival tolerance (edge distance) for a point goal inside a blocked tile (trees, buildings). */
const BLOCKED_GOAL_TOL = 0.3;
/** Point goals: also arrive when touching a settled friendly unit that is closer to the goal. */
const CROWD_EXTRA = 1.0;
/** Point goals stay 'arrived' unless nudged this much beyond the arrival distance. */
const POINT_HYSTERESIS = 0.35;
const WAYPOINT_REACH = 0.25;
const FINAL_REACH = 0.12;
/** Moving-target repath throttle (ticks). */
export const REPATH_TICKS = 10;
/** 'unreachable' moving-target retry interval (ticks). */
export const UNREACH_RETRY_TICKS = 20;
/** Flow users that fell back to A* stay on A* for this long (ticks). */
export const ASTAR_STICKY_TICKS = 60;
/** Flow lookahead (tiles) for smoother steering. */
const FLOW_LOOKAHEAD = 4;

export interface GoalRect {
  tx: number;
  ty: number;
  w: number;
  h: number;
}

export interface Goal {
  /** Steering point for the final approach. */
  px: number;
  py: number;
  /** Arrival metric (edge distance to target/footprint, or center distance to a point) and its tolerance. */
  dist: number;
  tol: number;
  /** Footprint goal for A* / flow fields (buildings, resource nodes, point goals inside blocked tiles). */
  rect: GoalRect | null;
  /** Goal point handed to A* (and stored in PathState.goalX/Y). */
  gx: number;
  gy: number;
  /** Target unit (moving goal) or null. */
  unitTarget: Unit | null;
  /** Plain walkable point goal (group tolerance, crowd arrival and hysteresis apply). */
  isPoint: boolean;
  /** Group arrival radius 0.5 + 0.35 sqrt(n) for units sharing a flowKey and goal (0 if single). */
  groupRadius: number;
  /** Target entity id (never reported as a blocker), 0 if none. */
  targetId: number;
}

export type Steer =
  | { kind: 'move'; x: number; y: number; final: boolean }
  | { kind: 'wait' }
  | { kind: 'blocked'; id: number }
  | { kind: 'unreachable' };

export interface TickCtx {
  astarBudget: number;
  /** Flow field assigned to a unit this tick (prepass). */
  fieldFor: Map<number, FlowField>;
  /** Units sharing (flowKey, goal tile): count for group arrival. */
  groupN: Map<string, number>;
}

/** Live target entity of an intent (undefined when none or dead). */
export function targetOf(world: World, mv: MoveIntent): Entity | undefined {
  if (!mv.targetId) return undefined;
  const e = world.entities.get(mv.targetId);
  return e && e.alive ? e : undefined;
}

/** Footprint to path to for an intent (static target, or the static entity / tile under a blocked point). */
export function goalRectFor(world: World, mv: MoveIntent, target: Entity | undefined): GoalRect | null {
  if (target) return target.kind === 'unit' ? null : { tx: target.tx, ty: target.ty, w: target.w, h: target.h };
  const grid = world.grid;
  const tx = Math.floor(mv.x);
  const ty = Math.floor(mv.y);
  if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) return null;
  const i = ty * grid.w + tx;
  if (grid.blocked[i] === 0) return null;
  const occ = grid.occupant[i];
  if (occ > 0) {
    const e = world.entities.get(occ);
    if (e && e.kind !== 'unit') return { tx: e.tx, ty: e.ty, w: e.w, h: e.h };
  }
  return { tx, ty, w: 1, h: 1 };
}

/** Units count as one arrival group when they share a flowKey AND the same goal point (to 0.1 tiles). */
export function groupKey(flowKey: string, mv: MoveIntent): string {
  return flowKey + '|' + Math.round(mv.x * 10) + ',' + Math.round(mv.y * 10);
}

function approachPoint(u: Unit, r: GoalRect, out: Goal): void {
  const cx = u.x < r.tx ? r.tx : u.x > r.tx + r.w ? r.tx + r.w : u.x;
  const cy = u.y < r.ty ? r.ty : u.y > r.ty + r.h ? r.ty + r.h : u.y;
  const dx = u.x - cx;
  const dy = u.y - cy;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) {
    out.px = cx;
    out.py = cy;
    return;
  }
  const off = terrainRadius(u) + 0.02;
  out.px = cx + (dx / d) * off;
  out.py = cy + (dy / d) * off;
}

/** Resolve the effective goal for this tick (refreshes intent x/y from a live target). */
export function computeGoal(world: World, u: Unit, mv: MoveIntent, ctx: TickCtx | null): Goal {
  const target = targetOf(world, mv);
  if (target) {
    mv.x = target.x;
    mv.y = target.y;
  }
  const g: Goal = {
    px: mv.x,
    py: mv.y,
    dist: 0,
    tol: Math.max(0, mv.range),
    rect: null,
    gx: mv.x,
    gy: mv.y,
    unitTarget: null,
    isPoint: false,
    groupRadius: 0,
    targetId: target ? target.id : 0,
  };
  if (target && target.kind === 'unit') {
    g.unitTarget = target;
    g.dist = edgeDistance(u, target);
    return g;
  }
  const rect = goalRectFor(world, mv, target);
  if (rect) {
    g.rect = rect;
    g.dist = Math.max(0, distToRectXY(u.x, u.y, rect.tx, rect.ty, rect.w, rect.h) - u.radius);
    if (!target) g.tol = Math.max(g.tol, BLOCKED_GOAL_TOL);
    approachPoint(u, rect, g);
    return g;
  }
  g.isPoint = true;
  g.dist = Math.hypot(u.x - mv.x, u.y - mv.y);
  g.tol = Math.max(g.tol, ARRIVE_EPS);
  if (mv.flowKey && ctx) {
    const n = ctx.groupN.get(groupKey(mv.flowKey, mv)) ?? 1;
    if (n > 1) g.groupRadius = groupArrivalRadius(n);
  }
  return g;
}

/** Recompute only the arrival metric after a step (cheap). */
export function goalDistance(u: Unit, g: Goal): number {
  if (g.unitTarget) return edgeDistance(u, g.unitTarget);
  if (g.rect) return Math.max(0, distToRectXY(u.x, u.y, g.rect.tx, g.rect.ty, g.rect.w, g.rect.h) - u.radius);
  return Math.hypot(u.x - g.px, u.y - g.py);
}

/**
 * Has the unit arrived? Targets: edge distance <= range. Point goals: within max(range, 0.1), with
 * hysteresis once arrived, or by contact: touching a friendly that already settled (idle, or
 * arrived at the same goal) closer to the goal, so crowds form a blob centered on the goal instead
 * of churning. Groups sharing a flowKey and goal (GDD §F f) arrive by contact anywhere within
 * 0.5 + 0.35 sqrt(n); single units within 1 tile of the goal.
 */
export function hasArrived(world: World, u: Unit, g: Goal, nav: UnitNav): boolean {
  if (g.dist <= g.tol) return true;
  if (!g.isPoint) return false;
  if (u.moveStatus === 'arrived' && g.dist <= Math.max(g.tol, nav.arrivedDist) + POINT_HYSTERESIS) return true;
  const group = g.groupRadius > 0;
  const limit = group ? g.groupRadius : g.tol + CROWD_EXTRA;
  if (g.dist > limit) return false;
  let hit = false;
  const myD = g.dist;
  const ru = u.radius;
  forEachUnitNear(world, u.x, u.y, ru + 1.3, (b, d2) => {
    if (b === u || b.owner !== u.owner) return;
    const bm = b.move;
    if (bm !== null) {
      if (b.moveStatus !== 'arrived' || bm.targetId !== 0) return;
      if (Math.abs(bm.x - g.px) > 0.5 || Math.abs(bm.y - g.py) > 0.5) return;
    }
    const minD = ru + b.radius + 0.12;
    if (d2 > minD * minD) return;
    // Inside the group radius any settled member counts; otherwise it must be nearer the goal.
    if (group || Math.hypot(b.x - g.px, b.y - g.py) < myD) {
      hit = true;
      return true;
    }
  });
  return hit;
}

/** Effective max speed this tick: unit.speed (sim-core) capped by speedCap, × terrain × Blight. */
export function effectiveSpeed(world: World, u: Unit, mv: MoveIntent | null): number {
  let s = u.speed;
  if (!(s > 0)) return 0;
  if (mv && mv.speedCap && mv.speedCap > 0 && mv.speedCap < s) s = mv.speedCap;
  const grid = world.grid;
  const tx = Math.floor(u.x);
  const ty = Math.floor(u.y);
  if (tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h) {
    const i = ty * grid.w + tx;
    s *= grid.speedMul[i];
    if (u.owner === PLAYER && world.blight.tiles[i] === 1 && !world.players[PLAYER].flags.kindled_earth) {
      s *= NAV.blightPlayerSpeed;
    }
  }
  return s;
}

/** LOS clearance for a unit (a hair under its terrain radius so wall-huggers keep LOS). */
export function losClearance(u: Unit): number {
  return Math.max(0.05, terrainRadius(u) - 0.03);
}

function newPathState(goal: Goal, tick: number, waypoints: { x: number; y: number }[], flowKey?: string): PathState {
  const p: PathState = { waypoints, index: 0, goalX: goal.gx, goalY: goal.gy, tick };
  if (flowKey !== undefined) p.flowKey = flowKey;
  return p;
}

/** Run A* for a unit now (budget already charged) and install the path. */
export function computePath(world: World, u: Unit, mv: MoveIntent, goal: Goal, nav: UnitNav): PathState {
  nav.queued = false;
  const res = findPathEx(world, u.x, u.y, goal.gx, goal.gy, { mode: mv.mode, goalRect: goal.rect ?? undefined });
  nav.pathVersion = world.grid.version;
  if (!res) {
    nav.reached = false;
    u.path = newPathState(goal, world.tick, []);
    return u.path;
  }
  nav.reached = res.reached;
  u.path = newPathState(goal, world.tick, res.waypoints);
  return u.path;
}

/** Path now if the per-tick A* budget allows, else queue (FIFO). Returns the new path or null. */
function requestPath(world: World, st: NavWorldState, ctx: TickCtx, u: Unit, mv: MoveIntent, goal: Goal, nav: UnitNav): PathState | null {
  if (ctx.astarBudget > 0) {
    ctx.astarBudget--;
    return computePath(world, u, mv, goal, nav);
  }
  if (!nav.queued) {
    nav.queued = true;
    st.queue.push(u.id);
  }
  return null;
}

/** Are the remaining path legs still passable after a grid change? */
function pathStillValid(world: World, u: Unit, path: PathState, mode: 'player' | 'enemy'): boolean {
  const grid = world.grid;
  const aux = navAux(world);
  const pass =
    mode === 'enemy' ? (i: number) => grid.blocked[i] === 0 || aux.playerBldg[i] === 1 : (i: number) => grid.blocked[i] === 0;
  let x = u.x;
  let y = u.y;
  for (let k = path.index; k < path.waypoints.length; k++) {
    const wp = path.waypoints[k];
    if (!segmentPasses(grid, x, y, wp.x, wp.y, pass)) return false;
    x = wp.x;
    y = wp.y;
  }
  return true;
}

/** Enemy mode: the player building (not the target) the unit is about to walk into, or 0. */
function enemyBlocker(world: World, u: Unit, sx: number, sy: number, targetId: number): number {
  const grid = world.grid;
  const aux = navAux(world);
  const dx = sx - u.x;
  const dy = sy - u.y;
  const d = Math.hypot(dx, dy);
  const tr = terrainRadius(u);
  if (d > 1e-6) {
    const probe = Math.min(d + 0.05, tr + 0.35);
    const px = Math.floor(u.x + (dx / d) * probe);
    const py = Math.floor(u.y + (dy / d) * probe);
    if (px >= 0 && py >= 0 && px < grid.w && py < grid.h) {
      const i = py * grid.w + px;
      if (aux.playerBldg[i] === 1 && grid.occupant[i] !== targetId) return grid.occupant[i];
    }
  }
  // Steering at a building tile we already touch (diagonal approach stopped by collision).
  const tx = Math.floor(sx);
  const ty = Math.floor(sy);
  if (tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h) {
    const i = ty * grid.w + tx;
    if (aux.playerBldg[i] === 1 && grid.occupant[i] !== targetId && distToRectXY(u.x, u.y, tx, ty, 1, 1) <= tr + 0.1) {
      return grid.occupant[i];
    }
  }
  return 0;
}

/**
 * Choose where the unit steers this tick: direct final approach (LOS), flow field (group keys,
 * far enemy goals) or its A* path (requested within the per-tick budget).
 */
export function chooseSteer(world: World, st: NavWorldState, ctx: TickCtx, u: Unit, mv: MoveIntent, goal: Goal, nav: UnitNav): Steer {
  const grid = world.grid;
  const clr = losClearance(u);
  const dGoal = Math.hypot(goal.px - u.x, goal.py - u.y);

  // (1) Final approach in walkable line of sight.
  if (dGoal <= DIRECT_RANGE && clearLine(grid, u.x, u.y, goal.px, goal.py, clr)) {
    return { kind: 'move', x: goal.px, y: goal.py, final: true };
  }

  // (2) Flow field.
  const field = ctx.fieldFor.get(u.id);
  if (field && world.tick >= nav.astarUntil) {
    const tx = Math.min(grid.w - 1, Math.max(0, Math.floor(u.x)));
    const ty = Math.min(grid.h - 1, Math.max(0, Math.floor(u.y)));
    const t = ty * grid.w + tx;
    const c = field.cost[t];
    const next = c > 0 && c < Infinity ? flowNextTile(world, field, t) : -1;
    if (next >= 0) {
      if (mv.mode === 'enemy') {
        const aux = navAux(world);
        if (aux.playerBldg[next] === 1 && grid.occupant[next] !== goal.targetId) return { kind: 'blocked', id: grid.occupant[next] };
      }
      let sx = (next % grid.w) + 0.5;
      let sy = Math.floor(next / grid.w) + 0.5;
      let cur = next;
      for (let k = 0; k < FLOW_LOOKAHEAD; k++) {
        const nn = flowNextTile(world, field, cur);
        if (nn < 0 || grid.blocked[nn] !== 0) break;
        const cx = (nn % grid.w) + 0.5;
        const cy = Math.floor(nn / grid.w) + 0.5;
        if (!clearLine(grid, u.x, u.y, cx, cy, clr)) break;
        sx = cx;
        sy = cy;
        cur = nn;
      }
      if (!u.path || u.path.flowKey !== field.key) u.path = newPathState(goal, world.tick, [], field.key);
      return { kind: 'move', x: sx, y: sy, final: false };
    }
    // At a goal tile without LOS to the own goal, cut off, or a stale dead end: finish with A*.
    nav.astarUntil = world.tick + ASTAR_STICKY_TICKS;
  }

  // (3) A* path.
  let path: PathState | null = u.path && u.path.flowKey === undefined ? u.path : null;
  if (path) {
    const movedTarget =
      goal.unitTarget !== null &&
      world.tick - path.tick >= REPATH_TICKS &&
      Math.hypot(path.goalX - goal.gx, path.goalY - goal.gy) > Math.max(1, 0.25 * dGoal);
    let invalid = false;
    if (nav.pathVersion !== grid.version) {
      invalid = !pathStillValid(world, u, path, mv.mode);
      nav.pathVersion = grid.version;
    }
    if (movedTarget || invalid) {
      const fresh = requestPath(world, st, ctx, u, mv, goal, nav);
      if (fresh) path = fresh;
      else if (invalid) path = null;
    }
  } else {
    path = requestPath(world, st, ctx, u, mv, goal, nav);
  }
  if (!path) {
    // Waiting for a path: walk straight at the goal if it is in line of sight.
    if (dGoal > DIRECT_RANGE && clearLine(grid, u.x, u.y, goal.px, goal.py, clr)) {
      return { kind: 'move', x: goal.px, y: goal.py, final: true };
    }
    return { kind: 'wait' };
  }

  const wps = path.waypoints;
  while (path.index < wps.length) {
    const wp = wps[path.index];
    const reach = path.index === wps.length - 1 ? FINAL_REACH : WAYPOINT_REACH;
    if (Math.hypot(wp.x - u.x, wp.y - u.y) <= reach) path.index++;
    else break;
  }
  if (path.index + 1 < wps.length) {
    const nx = wps[path.index + 1];
    if (clearLine(grid, u.x, u.y, nx.x, nx.y, clr)) path.index++;
  }
  if (path.index >= wps.length) {
    if (!nav.reached) return { kind: 'unreachable' };
    // Path consumed but not arrived (moving target, crowding): refresh and press on.
    if (world.tick - path.tick >= REPATH_TICKS) requestPath(world, st, ctx, u, mv, goal, nav);
    return { kind: 'move', x: goal.px, y: goal.py, final: true };
  }
  const wp = wps[path.index];
  if (mv.mode === 'enemy') {
    const blocker = enemyBlocker(world, u, wp.x, wp.y, goal.targetId);
    if (blocker) return { kind: 'blocked', id: blocker };
  }
  return { kind: 'move', x: wp.x, y: wp.y, final: path.index === wps.length - 1 && nav.reached };
}
