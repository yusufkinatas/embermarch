/**
 * Encounter: enemy structures, wave director, enemy unit AI, garrisons/pickets/lurkers,
 * Blight (growth, ward, effects), objectives & victory, Elite Noble, Boss. OWNER: encounter.
 *
 * Module map:
 *   init.ts        initEncounter (structures, standing forces, schedule, Blight)
 *   director.ts    wave timeline, muster/launch, intel, Spent, broken, raids, garrison regen
 *   ai.ts          enemy unit thinking (engage priority, leash, chase, dissolve, cohesion)
 *   blight.ts      Blight sources, ward grid, regen / wither
 *   objectives.ts  caches, beacons, victory, plunder, result
 *   noble.ts       Antlered Lord        boss.ts  Briar Regent
 *   view.ts        getEncounterView     formulas.ts  pure math (unit-tested)
 */
import { ENEMY_AI, GARRISON, THORNSPIRE, nestFactor } from '../../data/balance';
import { killEntity } from '../entities';
import { ENEMY, PLAYER, TICK_RATE, type DoctrineId, type Entity, type Unit, type World } from '../types';
import { beginAdvance, tickAI } from './ai';
import { recomputeWard, startRecede, tickBlight } from './blight';
import { forceWave, launchMusteringAt, tickDirector } from './director';
import { livingNests, syncNestSpent } from './nests';
import { wavePctDrop } from './formulas';
import { emit, isFootprintVisible, liveBuilding, liveUnit } from './geom';
import { initEncounter as init } from './init';
import { onLordDamaged, lordRise, tickNoble } from './noble';
import { onHeartDestroyed, tickBoss } from './boss';
import { addPlunder, checkVictory, encounterResult, isVictory, tickBeacons, tickCaches } from './objectives';
import { aiOf, getState, type EncRuntime, type NestRec } from './state';
import type { EncounterResult, EncounterView } from './types';
import { buildView } from './view';

export type { EncounterResult } from './types';

/**
 * Called once at the end of createWorld (after player entities & resources exist).
 * Sets world.encounter, spawns Nests/Root Hearts, Thornspires, Pickets, Caches, Beacons, Throne,
 * garrisons and guards, initial Blight. Uses world.setup (objective, depth, modifiers, doctrine, tier).
 */
export function initEncounter(world: World): void {
  init(world);
}

/** Called every tick before unit behaviors. */
export function tickEncounter(world: World): void {
  const st = getState(world);
  if (!st || world.outcome !== 'ongoing') return;
  processPendingDeaths(world, st);
  processWithering(world, st);
  if (world.tick % 4 === 0) updateSeen(world, st);
  tickBlight(world, st);
  tickDirector(world, st);
  tickAI(world, st);
  tickNoble(world, st);
  tickBoss(world, st);
  tickCaches(world, st);
  tickBeacons(world, st);
  checkVictory(world, st);
}

/**
 * Run the objective's victory check now (outside tickEncounter). sim-core calls it before declaring
 * a defeat, so the last Nest (or the Regent) and the Hearth falling in the same tick is a victory.
 * Returns true if the battle is won.
 */
export function checkVictoryNow(world: World): boolean {
  const st = getState(world);
  if (!st) return false;
  checkVictory(world, st);
  return world.outcome === 'victory';
}

/** Is the objective's victory condition met right now (e.g. the Regent was slain this tick)? Does not end the battle. */
export function victoryConditionMet(world: World): boolean {
  const st = getState(world);
  return !!st && world.outcome === 'ongoing' && isVictory(world, st);
}

/**
 * Called by sim-core killEntity for every entity death. `opts.demolished`: the player tore down
 * their own building (not a loss for Holdfast "Unbroken").
 */
export function onEntityDeath(world: World, e: Entity, killerId: number, opts?: { demolished?: boolean }): void {
  const st = getState(world);
  if (!st) return;
  if (e.kind === 'building') {
    if (e.owner === ENEMY) {
      const nest = st.nests.find((n) => n.id === e.id);
      if (nest && nest.alive) {
        const before = livingNests(st).length;
        nest.alive = false;
        nest.diedTick = world.tick;
        st.plunder.nestsDestroyed++;
        addPlunder(world, st, 'nest');
        st.pendingDeaths.push({ kind: 'nest', nestId: nest.id, killerId, wavePct: wavePct(st, before) });
        return;
      }
      const picket = st.pickets.find((p) => p.spireId === e.id);
      if (picket && !picket.cleared) {
        picket.cleared = true;
        st.plunder.picketsDestroyed++;
        addPlunder(world, st, 'picket');
      }
    } else if (e.owner === PLAYER && e.built && !opts?.demolished) {
      st.buildingLost = true;
    }
    return;
  }
  if (e.kind === 'unit' && e.owner === ENEMY) {
    if (st.lord && e.id === st.lord.id) {
      st.plunder.lordSlain = true;
      emit(world, { t: 'alert', kind: 'info', text: 'The Antlered Lord is slain!', x: e.x, y: e.y, priority: 'high' });
      emit(world, { t: 'shake', magnitude: 6, duration: 0.3 });
    }
    if (st.boss && e.id === st.boss.id) st.plunder.regentSlain = true;
  }
}

/** Called by sim-core whenever an entity takes damage (retaliation, engage memory, dissolve timers). */
export function onEntityDamaged(world: World, target: Entity, attackerId: number, amount: number): void {
  const st = getState(world);
  if (!st) return;
  const tick = world.tick;
  const attacker = attackerId ? world.entities.get(attackerId) : undefined;
  if (attacker && attacker.kind === 'unit' && attacker.ai) {
    const ai = aiOf(attacker);
    if (ai) ai.lastDealtTick = tick;
  }
  if (target.kind === 'unit' && target.owner === ENEMY && st.lord && target.id === st.lord.id) onLordDamaged(world, st);
  if (target.kind !== 'building' || target.owner !== ENEMY) return;
  const nest = st.nests.find((n) => n.id === target.id);
  if (!nest || !nest.alive || target.hp >= target.maxHp * GARRISON.retaliationHpPct) return;
  if (!attacker || !attacker.alive || attacker.owner !== PLAYER || tick < nest.retaliateTick) return;
  nest.retaliateTick = tick + Math.round(ENEMY_AI.retargetInterval * TICK_RATE);
  retaliate(world, st, nest, attacker);
}

/** A player building completed or died: recompute Blight wards. */
export function onPlayerBuildingChanged(world: World): void {
  const st = getState(world);
  if (!st) return;
  recomputeWard(world, st);
}

export function getEncounterView(world: World): EncounterView {
  const st = getState(world);
  if (!st) return emptyView(world);
  return buildView(world, st);
}

/** Is the tile currently blighted? */
export function isBlighted(world: World, tx: number, ty: number): boolean {
  return world.blight.tiles[ty * world.map.w + tx] === 1;
}

/** Debug: muster & launch wave n now (optionally with a doctrine). */
export function debugForceWave(world: World, n: number, doctrine?: string): void {
  const st = getState(world);
  if (!st) return;
  const d = isDoctrine(doctrine) ? doctrine : undefined;
  forceWave(world, st, n, d);
}

/** Enemy unit helper used by sim-core: should this enemy unit be driven by encounter AI this tick? */
export function isAIControlled(u: Unit): boolean {
  return u.ai !== null;
}

/** Plunder, par and Holdfast bonuses for sim-core's buildBattleResult. Null for skipEncounter worlds. */
export function getEncounterResult(world: World): EncounterResult | null {
  const st = getState(world);
  return st ? encounterResult(world, st) : null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const DOCTRINE_IDS: readonly string[] = ['swarm', 'spines', 'hunt', 'siegebreak', 'court'];
function isDoctrine(s: string | undefined): s is DoctrineId {
  return !!s && DOCTRINE_IDS.includes(s);
}

function wavePct(st: EncRuntime, aliveBefore: number): number {
  if (st.objective === 'boss') return wavePctDrop(0.4 + 0.2 * aliveBefore, 0.4 + 0.2 * (aliveBefore - 1));
  return wavePctDrop(nestFactor(aliveBefore, st.nestsTotal), nestFactor(aliveBefore - 1, st.nestsTotal));
}

function retaliate(world: World, st: EncRuntime, nest: NestRec, attacker: Entity): void {
  const until = world.tick + 5 * TICK_RATE;
  const ids = [...nest.garrison];
  for (const w of st.waves) if (w.phase === 'muster' && w.nestId === nest.id) ids.push(...w.members);
  for (const id of ids) {
    const u = liveUnit(world, id);
    const ai = u ? aiOf(u) : null;
    if (!u || !ai) continue;
    ai.forcedId = attacker.id;
    ai.forcedUntil = until;
    if (ai.state === 'return') ai.state = ai.role === 'wave' ? 'muster' : 'post';
    ai.nextThink = world.tick;
  }
}

function processPendingDeaths(world: World, st: EncRuntime): void {
  if (st.pendingDeaths.length === 0) return;
  const list = st.pendingDeaths;
  st.pendingDeaths = [];
  let hearts = 0;
  for (const [i, p] of list.entries()) {
    const nest = st.nests.find((n) => n.id === p.nestId);
    if (!nest) continue;
    if (nest.b.nest) {
      nest.b.nest.spent = false;
      nest.b.nest.spentUntil = -1;
      nest.b.nest.musterProgress = 0;
    }
    syncNestSpent(world, nest);
    emit(world, { t: 'nestDestroyed', id: nest.id, x: nest.cx, y: nest.cy, wavePct: p.wavePct });
    emit(world, {
      t: 'alert',
      kind: 'nest_destroyed',
      text: nest.kind === 'heart' ? `A Root Heart burns. The Regent weakens.` : `A Nest burns. Waves −${p.wavePct}%`,
      x: nest.cx,
      y: nest.cy,
      priority: 'high',
    });
    if (i === 0) {
      emit(world, { t: 'shake', magnitude: 6, duration: 0.25 });
      emit(world, { t: 'slowmo', factor: 0.5, duration: 0.4 });
    }
    startRecede(world, st, nest.id);
    const witherAt = world.tick + Math.round(THORNSPIRE.witherDelay * TICK_RATE);
    for (const id of nest.spires) st.withering.push([id, witherAt]);
    // The garrison marches out (still standing forces).
    for (const id of nest.garrison) {
      const u = liveUnit(world, id);
      const ai = u ? aiOf(u) : null;
      if (!u || !ai) continue;
      ai.goalId = 0;
      beginAdvance(world, u, ai);
    }
    launchMusteringAt(world, st, nest.id, p.killerId);
    if (nest.kind === 'heart') hearts++;
    if (st.lord && !st.lord.joined && livingNests(st).length === 0) lordRise(world, st, nest);
  }
  // Root Hearts: one Regent update after every Heart alert of this tick (phase change comes last).
  if (hearts > 0) onHeartDestroyed(world, st);
}

function processWithering(world: World, st: EncRuntime): void {
  if (st.withering.length === 0) return;
  const due = st.withering.filter(([, t]) => world.tick >= t);
  if (due.length === 0) return;
  st.withering = st.withering.filter(([, t]) => world.tick < t);
  for (const [id] of due) {
    const b = liveBuilding(world, id);
    if (b) killEntity(world, b, 0);
  }
}

function updateSeen(world: World, st: EncRuntime): void {
  for (const n of st.nests) {
    if (!n.alive || !n.b.nest || n.b.nest.seen) continue;
    if (isFootprintVisible(world, n.b)) {
      n.b.nest.seen = true;
      st.doctrineSeen = true;
    }
  }
  // Caches and Beacon Stones remember being seen (map ghosts).
  for (const o of [...st.caches, ...st.beacons]) {
    const obj = o.b.object;
    if (obj && !obj.seen && isFootprintVisible(world, o.b)) obj.seen = true;
  }
}

function emptyView(world: World): EncounterView {
  const enc = world.encounter;
  return {
    objective: enc?.objective ?? world.setup.objective,
    trackerText: '',
    parRemaining: null,
    horn: null,
    wavesLaunched: 0,
    boss: null,
    nests: [],
    ascendantIn: null,
    plunderCrowns: 0,
    doctrine: enc?.doctrine ?? world.setup.doctrine,
    doctrineSeen: false,
    kindling: null,
    dusk: 0,
    revealedEnemyIds: [],
  };
}

