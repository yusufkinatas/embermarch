/**
 * Enemy unit AI (§I "Unit AI", "Garrisons", §J Lurkers, raids). Decides WHAT each Thornwake unit
 * does; sim-core executes the orders. Thinks every 0.5 s per unit (staggered by id).
 *
 * States: muster (waiting at the muster point) → advance (attack-move toward the wave goal) →
 * engage (attack order) → advance. Standing forces: post → engage → post, with 'return' as the
 * leash walk home (regenerating 5 HP/s, ignoring enemies).
 */
import { DIRECTOR, ENEMY_AI, GARRISON, RAID } from '../../data/balance';
import { UNITS } from '../../data/units';
import { killEntity } from '../entities';
import { ENEMY, PLAYER, TICK_DT, TICK_RATE, type Building, type Entity, type Unit, type World } from '../types';
import { currentAttackTarget, driveAdvance, driveAttack, driveHold, driveMove } from './drive';
import { centerOf, dist, distToEntity, hearth, isPlayerTarget, liveBuilding, liveEntity, liveUnit, unitEdgeDist } from './geom';
import { THINK_TICKS } from './spawn';
import { aiOf, type EncRuntime, type EnemyAI, type WaveRec } from './state';

const SEC = TICK_RATE;
const RECENT_ATTACKER_TICKS = Math.round(ENEMY_AI.recentAttackerWindow * SEC);
const IGNORE_TICKS = Math.round(ENEMY_AI.ignoreTime * SEC);
const DISSOLVE_TICKS = Math.round(DIRECTOR.dissolveTime * SEC);
const AT_GOAL = 1.5;
/** Edge distance at which an advancing unit switches to attacking its goal building. */
const GOAL_ENGAGE = 4;

/** Engage priorities (lower = more urgent). */
const PRI_FORCED = 0;
const PRI_BONUS = 1;
const PRI_ATTACKER = 2;
const PRI_NEAREST = 3;
const PRI_BUILDING = 4;
const PRI_NONE = 99;

interface Pick {
  e: Entity;
  pri: number;
}

export function acquireRadius(st: EncRuntime): number {
  return st.mods.thickFog ? ENEMY_AI.acquireRadiusFog : ENEMY_AI.acquireRadius;
}

function ignored(ai: EnemyAI, id: number, tick: number): boolean {
  return ai.ignoreId === id && tick < ai.ignoreUntil;
}

function bonusVs(u: Unit, t: Unit): number {
  if (t.cls === 'hero' || t.cls === 'boss') return 1;
  return UNITS[u.type].bonus[t.cls] ?? 1;
}

function playerBuildings(world: World): Building[] {
  const out: Building[] = [];
  for (const b of world.buildings) if (b.alive && b.owner === PLAYER && !b.untargetable) out.push(b);
  return out;
}

export interface PickOpts {
  /** Aggro origin for priority 3 (post for standing forces, the unit itself for waves). */
  ox: number;
  oy: number;
  aggro: number;
  /** Standing forces only consider targets within this distance of the anchor. */
  anchor?: { x: number; y: number; r: number };
}

function withinAnchor(e: Entity, o: PickOpts): boolean {
  if (!o.anchor) return true;
  return distToEntity(o.anchor.x, o.anchor.y, e) <= o.anchor.r;
}

/** Classify an entity under the engage priority rules (PRI_NONE if it no longer qualifies). */
function classify(world: World, st: EncRuntime, u: Unit, ai: EnemyAI, e: Entity, o: PickOpts, slack: number): number {
  const tick = world.tick;
  if (!isPlayerTarget(e) || ignored(ai, e.id, tick) || !withinAnchor(e, o)) return PRI_NONE;
  if (ai.forcedId === e.id && tick < ai.forcedUntil) return PRI_FORCED;
  if (e.kind === 'unit') {
    const d = unitEdgeDist(u, e);
    if (bonusVs(u, e) > 1 && d <= ENEMY_AI.bonusTargetRadius + slack) return PRI_BONUS;
    if (u.lastAttackerId === e.id && tick - u.lastDamagedTick <= RECENT_ATTACKER_TICKS) return PRI_ATTACKER;
    if (distToEntity(o.ox, o.oy, e) <= o.aggro + slack) return PRI_NEAREST;
    return PRI_NONE;
  }
  if (u.lastAttackerId === e.id && tick - u.lastDamagedTick <= RECENT_ATTACKER_TICKS) return PRI_ATTACKER;
  if (u.blockedBy === e.id) return PRI_BUILDING;
  if (unitEdgeDist(u, e) <= ENEMY_AI.buildingRadius + slack) return PRI_BUILDING;
  return PRI_NONE;
}

/** Best engage target by §I priority: forced, bonus within 4, recent attacker, nearest within aggro, building. */
export function pickTarget(world: World, st: EncRuntime, u: Unit, ai: EnemyAI, o: PickOpts): Pick | null {
  const tick = world.tick;
  if (UNITS[u.type].structuresOnly) {
    // Rootbreakers: the nearest player building within 8 tiles.
    let best: Building | null = null;
    let bestD = ENEMY_AI.rootbreakerBuildingRadius;
    for (const b of playerBuildings(world)) {
      if (ignored(ai, b.id, tick) || !withinAnchor(b, o)) continue;
      const d = unitEdgeDist(u, b);
      if (d <= bestD) {
        bestD = d;
        best = b;
      }
    }
    return best ? { e: best, pri: PRI_BUILDING } : null;
  }
  // 0. Retaliation / killer.
  if (ai.forcedId && tick < ai.forcedUntil) {
    const f = liveEntity(world, ai.forcedId);
    if (isPlayerTarget(f) && withinAnchor(f, o)) return { e: f, pri: PRI_FORCED };
  }
  // 1. A target it has a bonus against within 4 tiles.
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const p of st.playerUnits) {
    if (!p.alive || p.untargetable || bonusVs(u, p) <= 1 || ignored(ai, p.id, tick) || !withinAnchor(p, o)) continue;
    const d = unitEdgeDist(u, p);
    if (d <= ENEMY_AI.bonusTargetRadius && d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) return { e: best, pri: PRI_BONUS };
  // 2. Whoever hit it in the last 3 s.
  if (u.lastAttackerId && tick - u.lastDamagedTick <= RECENT_ATTACKER_TICKS) {
    const a = liveEntity(world, u.lastAttackerId);
    if (isPlayerTarget(a) && !ignored(ai, a.id, tick) && withinAnchor(a, o)) return { e: a, pri: PRI_ATTACKER };
  }
  // 3. The nearest player unit within the acquire radius of the origin.
  for (const p of st.playerUnits) {
    if (!p.alive || p.untargetable || ignored(ai, p.id, tick) || !withinAnchor(p, o)) continue;
    const d = distToEntity(o.ox, o.oy, p);
    if (d <= o.aggro && d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) return { e: best, pri: PRI_NEAREST };
  // 4. A player building blocking its path or within 2 tiles.
  if (u.blockedBy) {
    const b = liveBuilding(world, u.blockedBy);
    if (b && b.owner === PLAYER && !ignored(ai, b.id, tick)) return { e: b, pri: PRI_BUILDING };
  }
  for (const b of playerBuildings(world)) {
    if (ignored(ai, b.id, tick) || !withinAnchor(b, o)) continue;
    const d = unitEdgeDist(u, b);
    if (d <= ENEMY_AI.buildingRadius && d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best ? { e: best, pri: PRI_BUILDING } : null;
}

/** Pick with hysteresis: keep the current target unless something strictly more urgent exists. */
function chooseTarget(world: World, st: EncRuntime, u: Unit, ai: EnemyAI, o: PickOpts): Entity | null {
  const best = pickTarget(world, st, u, ai, o);
  const curId = currentAttackTarget(u);
  if (curId) {
    const cur = liveEntity(world, curId);
    if (cur) {
      const pri = classify(world, st, u, ai, cur, o, 1);
      if (pri !== PRI_NONE && (!best || pri <= best.pri)) return cur;
    }
  }
  return best ? best.e : null;
}

// ---------------------------------------------------------------------------
// Standing forces (garrisons, Picket guards, Lurkers, Beacon guards) and mustering waves
// ---------------------------------------------------------------------------

/** Hold a post: aggro within `aggro` of the post, leash at `leash` from the anchor, walk home regenerating. */
export function thinkPost(world: World, st: EncRuntime, u: Unit, ai: EnemyAI): void {
  if (ai.state === 'return') {
    if (dist(u.x, u.y, ai.postX, ai.postY) <= 0.8) {
      ai.state = ai.wave >= 0 && ai.role === 'wave' ? 'muster' : 'post';
      driveHold(world, u);
    } else {
      driveMove(world, u, ai.postX, ai.postY);
    }
    return;
  }
  if (dist(u.x, u.y, ai.anchorX, ai.anchorY) > ai.leash) {
    ai.state = 'return';
    ai.forcedId = 0;
    driveMove(world, u, ai.postX, ai.postY);
    return;
  }
  const target = chooseTarget(world, st, u, ai, {
    ox: ai.postX,
    oy: ai.postY,
    aggro: ai.aggro,
    anchor: { x: ai.anchorX, y: ai.anchorY, r: ai.leash },
  });
  const restState = ai.role === 'wave' ? 'muster' : 'post';
  if (target) {
    ai.state = restState === 'muster' ? 'muster' : 'engage';
    driveAttack(world, u, target.id);
    return;
  }
  ai.state = restState;
  if (dist(u.x, u.y, ai.postX, ai.postY) > 1) driveMove(world, u, ai.postX, ai.postY);
  else driveHold(world, u);
}

// ---------------------------------------------------------------------------
// Advancing units (waves, raids, summons, homeless garrisons)
// ---------------------------------------------------------------------------

export interface Goal {
  x: number;
  y: number;
  id: number;
}

/** Wave goal: the wave target (objective / doctrine / killer), else the Hearth. */
export function waveGoal(world: World, st: EncRuntime, wave: WaveRec): Goal | null {
  let e = liveEntity(world, wave.targetId);
  if (e && wave.targetRule === 'objective') {
    const bc = st.beacons.find((b) => b.id === e!.id);
    if (bc && !bc.lit) e = undefined;
  }
  if (e && e.kind === 'unit' && e.owner === PLAYER) {
    // A unit target counts as reached once any member is within 6 tiles of it.
    for (const id of wave.members) {
      const m = liveUnit(world, id);
      if (m && m.ai?.state !== 'muster' && dist(m.x, m.y, e.x, e.y) <= ENEMY_AI.acquireRadius) {
        e = undefined;
        break;
      }
    }
  }
  if (!e || (e.owner !== PLAYER && e.owner !== 2)) {
    wave.targetId = world.hearthId;
    wave.targetRule = 'hearth';
    e = hearth(world);
  }
  if (!e) return null;
  const c = centerOf(e);
  return { x: c.x, y: c.y, id: e.id };
}

function hearthGoal(world: World): Goal | null {
  const h = hearth(world);
  if (!h) return null;
  const c = centerOf(h);
  return { x: c.x, y: c.y, id: h.id };
}

/** Nearest player unit or building to (x, y) within r. */
export function nearestPlayerEntity(world: World, st: EncRuntime, x: number, y: number, r: number): Entity | null {
  let best: Entity | null = null;
  let bestD = r;
  for (const p of st.playerUnits) {
    if (!p.alive || p.untargetable) continue;
    const d = distToEntity(x, y, p);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== PLAYER || b.untargetable) continue;
    const d = distToEntity(x, y, b);
    if (d <= bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function nearestTiller(st: EncRuntime, x: number, y: number, r: number): Unit | null {
  let best: Unit | null = null;
  let bestD = r;
  for (const p of st.playerUnits) {
    if (!p.alive || p.type !== 'tiller') continue;
    const d = dist(x, y, p.x, p.y);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function goalFromId(world: World, id: number): Goal | null {
  const e = liveEntity(world, id);
  if (!e) return null;
  const c = centerOf(e);
  return { x: c.x, y: c.y, id: e.id };
}

/** Dissolve rule: no damage dealt or taken and < 1 tile moved for 30 s. Returns true if dissolved. */
function checkDissolve(world: World, u: Unit, ai: EnemyAI): boolean {
  const tick = world.tick;
  if (dist(u.x, u.y, ai.idleX, ai.idleY) >= DIRECTOR.dissolveDist) {
    ai.idleX = u.x;
    ai.idleY = u.y;
    ai.idleSince = tick;
    return false;
  }
  const lastActive = Math.max(ai.idleSince, ai.lastDealtTick, u.lastDamagedTick);
  if (tick - lastActive >= DISSOLVE_TICKS) {
    killEntity(world, u, 0);
    return true;
  }
  return false;
}

/** Advancing unit think: engage by priority with a 6-tile chase leash, otherwise advance to the goal. */
export function thinkAdvance(world: World, st: EncRuntime, u: Unit, ai: EnemyAI, wave: WaveRec | null): void {
  const tick = world.tick;
  if ((ai.role === 'wave' || ai.role === 'raid') && checkDissolve(world, u, ai)) return;

  // Holdfast cleanup charge: straight at the Hearth, fighting back but never leashing.
  if (ai.noKite) {
    const h = hearth(world);
    if (u.blockedBy && liveBuilding(world, u.blockedBy)) return driveAttack(world, u, u.blockedBy);
    if (u.lastAttackerId && tick - u.lastDamagedTick <= RECENT_ATTACKER_TICKS && !UNITS[u.type].structuresOnly) {
      const a = liveEntity(world, u.lastAttackerId);
      if (isPlayerTarget(a)) return driveAttack(world, u, a.id);
    }
    if (h) return driveAttack(world, u, h.id);
  }

  const goal = advanceGoal(world, st, u, ai, wave);
  const target = chooseTarget(world, st, u, ai, { ox: u.x, oy: u.y, aggro: raidAggro(world, st, u, ai) });
  if (target) {
    if (ai.state !== 'engage' || Number.isNaN(ai.engageX)) {
      ai.engageX = u.x;
      ai.engageY = u.y;
    }
    ai.state = 'engage';
    const leashed = ai.role !== 'summon' && dist(u.x, u.y, ai.engageX, ai.engageY) > ENEMY_AI.chaseLeash;
    if (!leashed) {
      driveAttack(world, u, target.id);
      return;
    }
    ai.ignoreId = target.id;
    ai.ignoreUntil = tick + IGNORE_TICKS;
  }
  ai.state = 'advance';
  ai.engageX = NaN;
  ai.engageY = NaN;
  if (!goal) {
    driveHold(world, u);
    return;
  }
  const g = liveEntity(world, goal.id);
  // A goal building (Hearth, Storehouse, tower) is attacked directly once the unit is close.
  if (g && g.kind === 'building' && g.owner === PLAYER && unitEdgeDist(u, g) <= GOAL_ENGAGE) {
    ai.state = 'engage';
    ai.engageX = u.x;
    ai.engageY = u.y;
    driveAttack(world, u, g.id);
    return;
  }
  const atGoal = g ? distToEntity(u.x, u.y, g) <= AT_GOAL : dist(u.x, u.y, goal.x, goal.y) <= AT_GOAL;
  if (atGoal && (!g || g.owner !== PLAYER)) {
    driveHold(world, u);
    return;
  }
  const cap = wave ? wave.caps[ai.band] : 0;
  driveAdvance(world, u, goal.x, goal.y, cap);
}

/** Raiders hunting Tillers use the Tiller radius (8) instead of the normal acquire radius. */
function raidAggro(world: World, st: EncRuntime, u: Unit, ai: EnemyAI): number {
  if (ai.role === 'raid' && ai.huntUntil > world.tick) return RAID.tillerHuntRadius;
  return acquireRadius(st);
}

function advanceGoal(world: World, st: EncRuntime, u: Unit, ai: EnemyAI, wave: WaveRec | null): Goal | null {
  const tick = world.tick;
  if (ai.role === 'raid') {
    if (ai.huntUntil === -1) {
      const t = nearestTiller(st, u.x, u.y, RAID.tillerHuntRadius);
      if (t) ai.huntUntil = tick + Math.round(RAID.huntDuration * SEC);
    } else if (ai.huntUntil >= 0 && tick >= ai.huntUntil) {
      ai.huntUntil = -2;
    }
    if (ai.huntUntil >= 0) {
      const t = nearestTiller(st, u.x, u.y, RAID.tillerHuntRadius);
      if (t) {
        ai.forcedId = t.id;
        ai.forcedUntil = tick + THINK_TICKS + 1;
        return { x: t.x, y: t.y, id: t.id };
      }
    }
    if (ai.huntUntil !== -2 && wave) {
      const t = liveUnit(world, wave.huntTargetId);
      if (t) return { x: t.x, y: t.y, id: t.id };
      const near = nearestTiller(st, u.x, u.y, 1e9);
      if (near) {
        wave.huntTargetId = near.id;
        return { x: near.x, y: near.y, id: near.id };
      }
    }
    return hearthGoal(world);
  }
  if (ai.role === 'summon') {
    // Summons escort their leader (Lord / Regent), then push the Hearth.
    const leader = liveUnit(world, ai.leaderId);
    if (leader) return { x: leader.x, y: leader.y, id: 0 };
    return hearthGoal(world);
  }
  if (ai.role === 'garrison') {
    // Homeless garrison: the nearest player unit or building within 20 tiles, else the Hearth.
    if (ai.goalId && isPlayerTarget(liveEntity(world, ai.goalId))) return goalFromId(world, ai.goalId);
    const e = nearestPlayerEntity(world, st, u.x, u.y, GARRISON.nestDeathSearchRadius);
    ai.goalId = e ? e.id : 0;
    if (e) {
      const c = centerOf(e);
      return { x: c.x, y: c.y, id: e.id };
    }
    return hearthGoal(world);
  }
  if (ai.noKite || st.cleanup) return hearthGoal(world);
  if (wave) return waveGoal(world, st, wave);
  return hearthGoal(world);
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

/** Per-wave cohesion caps: each band moves at the speed of its slowest advancing member. */
export function updateCohesion(world: World, st: EncRuntime): void {
  for (const w of st.waves) {
    if (w.phase !== 'advancing') continue;
    const caps = { riders: Infinity, main: Infinity, siege: Infinity };
    for (const id of w.members) {
      const m = liveUnit(world, id);
      const ai = m ? aiOf(m) : null;
      if (!m || !ai || ai.state !== 'advance') continue;
      const s = m.speed > 0 ? m.speed : UNITS[m.type].speed;
      if (s < caps[ai.band]) caps[ai.band] = s;
    }
    w.caps.riders = Number.isFinite(caps.riders) ? caps.riders : 0;
    w.caps.main = Number.isFinite(caps.main) ? caps.main : 0;
    w.caps.siege = Number.isFinite(caps.siege) ? caps.siege : 0;
  }
}

/** Is the unit's home Nest still standing? */
function nestAlive(st: EncRuntime, nestId: number): boolean {
  const n = st.nests.find((x) => x.id === nestId);
  return !!n && n.alive;
}

/** Think for every AI unit except the Noble and the Regent (they have their own modules). */
export function tickAI(world: World, st: EncRuntime): void {
  const tick = world.tick;
  st.playerUnits = world.units.filter((p) => p.alive && p.owner === PLAYER);
  updateCohesion(world, st);
  const waveById = new Map<number, WaveRec>();
  for (const w of st.waves) waveById.set(w.uid, w);
  const regen = GARRISON.leashRegenHps * TICK_DT;
  // Iterate over a snapshot: dissolving units leave world.units untouched until end of tick anyway.
  const units = world.units.slice();
  for (const u of units) {
    if (!u.alive || u.owner !== ENEMY) continue;
    const ai = aiOf(u);
    if (!ai || ai.role === 'noble' || ai.role === 'boss') continue;
    if (ai.state === 'return' && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + regen);
    const wave = ai.role === 'wave' || ai.role === 'raid' ? (waveById.get(ai.waveUid) ?? null) : null;
    const lostTarget = ai.state === 'engage' && u.order.type === 'idle';
    if (tick < ai.nextThink && !lostTarget) {
      // Cohesion: keep the band cap on the live intent (sim-core inherits it into new intents).
      if (ai.state === 'advance' && wave) {
        const cap = wave.caps[ai.band];
        ai.speedCap = cap;
        if (u.move) u.move.speedCap = cap;
      }
      continue;
    }
    ai.nextThink = tick + THINK_TICKS;
    thinkUnit(world, st, u, ai, wave);
  }
}

export function thinkUnit(world: World, st: EncRuntime, u: Unit, ai: EnemyAI, wave: WaveRec | null): void {
  switch (ai.role) {
    case 'garrison':
      if (nestAlive(st, ai.nestId)) thinkPost(world, st, u, ai);
      else thinkAdvance(world, st, u, ai, null);
      return;
    case 'picket':
    case 'lurker':
    case 'beacon_guard':
      thinkPost(world, st, u, ai);
      return;
    case 'wave':
      if (ai.state === 'muster' || (ai.state === 'return' && wave?.phase === 'muster')) thinkPost(world, st, u, ai);
      else thinkAdvance(world, st, u, ai, wave);
      return;
    case 'raid':
    case 'summon':
      thinkAdvance(world, st, u, ai, wave);
      return;
    default:
      return;
  }
}

/** Reset dissolve / engagement bookkeeping when a unit starts advancing. */
export function beginAdvance(world: World, u: Unit, ai: EnemyAI): void {
  ai.state = 'advance';
  ai.engageX = NaN;
  ai.engageY = NaN;
  ai.idleX = u.x;
  ai.idleY = u.y;
  ai.idleSince = world.tick;
  ai.nextThink = world.tick;
}
