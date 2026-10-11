/**
 * Wave lifecycle (§I "Wave director"): muster (doctrine roll, light adaptation, garrison overflow,
 * composition under the pool caps, waveBank), intel and the Horn, target precedence, launch
 * (Spent, Noble), raids (SHOULD) and wave broken.
 */
import { ADAPTATION, ASCENDANT, DEPTH, DIRECTOR, GARRISON, MODIFIER_NUMBERS, NOBLE, RAID, floorEps, raidValue, waveInterval } from '../../data/balance';
import { DOCTRINES } from '../../data/doctrines';
import { TEXT } from '../../data/text';
import { PLAYER, TICK_RATE, type DoctrineId, type EnemyUnitId, type Entity, type Unit, type UnitClass, type World } from '../types';
import { beginAdvance } from './ai';
import {
  adaptationFor,
  cappedBank,
  compassDir,
  composeRaid,
  composeWave,
  doctrineWeights,
  doctrinesAvailable,
  fmtClock,
  spentActive,
  spentOnBroken,
  spentOnLaunch,
  unitValue,
  waveMultiplier,
} from './formulas';
import { centerOf, dist, emit, hearth, isPlayerTarget, liveEntity, liveUnit, spawnSpots } from './geom';
import { livingNests, syncNestSpent } from './nests';
import { lordJoinWave } from './noble';
import { canSpawnWave, countPools, makeAI, spawnEnemy } from './spawn';
import { aiOf, type EncRuntime, type NestRec, type WaveRec } from './state';

const SEC = TICK_RATE;

function rollDoctrine(st: EncRuntime): DoctrineId {
  if (st.rng.chance(DIRECTOR.secondaryDoctrineChance)) {
    const others = doctrinesAvailable(Math.min(st.depth, 7)).filter((d) => d !== st.doctrine);
    if (others.length > 0) return st.rng.pick(others);
  }
  return st.doctrine;
}

const MILITARY: ReadonlySet<UnitClass> = new Set<UnitClass>(['infantry', 'ranged', 'cavalry', 'siege']);

function playerArmy(world: World): { counts: Partial<Record<UnitClass, number>>; total: number } {
  const counts: Partial<Record<UnitClass, number>> = {};
  let total = 0;
  for (const u of world.units) {
    if (!u.alive || u.owner !== PLAYER || !MILITARY.has(u.cls)) continue;
    counts[u.cls] = (counts[u.cls] ?? 0) + 1;
    total++;
  }
  return { counts, total };
}

/** Muster point when no Nest / Heart stands: the Throne edge facing the Hearth (boss), else the Hearth itself. */
function fallbackMuster(world: World, st: EncRuntime): { x: number; y: number } {
  const h = hearth(world);
  const hx = h ? centerOf(h).x : st.hearthX;
  const hy = h ? centerOf(h).y : st.hearthY;
  if (st.boss) {
    const dx = hx - st.boss.throneX;
    const dy = hy - st.boss.throneY;
    const len = Math.hypot(dx, dy) || 1;
    return { x: st.boss.throneX + (dx / len) * 4.5, y: st.boss.throneY + (dy / len) * 4.5 };
  }
  return { x: hx, y: hy };
}

export interface MusterOpts {
  great?: boolean;
  doctrine?: DoctrineId;
  /** Skip the horn delay (debug waves launch at once). */
  forced?: boolean;
}

/** Garrison units above 50% of the cap (by value) leave their posts; returns them. */
function garrisonOverflow(world: World, nest: NestRec): Unit[] {
  const alive = nest.garrison.map((id) => liveUnit(world, id)).filter((u): u is Unit => !!u);
  let value = 0;
  for (const u of alive) value += unitValue(u.type as EnemyUnitId);
  const keep = nest.garrisonCap * DIRECTOR.garrisonJoinFraction;
  const out: Unit[] = [];
  for (let i = alive.length - 1; i >= 0; i--) {
    const v = unitValue(alive[i].type as EnemyUnitId);
    if (value - v + 1e-9 < keep) continue;
    out.push(alive[i]);
    value -= v;
  }
  return out;
}

/** Create a mustering wave at a Nest (or the fallback point) with value V. */
export function musterWave(world: World, st: EncRuntime, nest: NestRec | null, n: number, V: number, launchAt: number, o: MusterOpts = {}): WaveRec {
  const mp = nest ? { x: nest.musterX, y: nest.musterY } : fallbackMuster(world, st);
  const doctrine = o.doctrine ?? rollDoctrine(st);
  const notes: string[] = [];
  const extra: Partial<Record<EnemyUnitId, number>> = {};
  const army = playerArmy(world);
  const adapt = adaptationFor(army.counts, army.total, Math.min(st.depth, 7));
  if (adapt) {
    extra[adapt.counter] = (extra[adapt.counter] ?? 0) + ADAPTATION.weightBonus;
    notes.push(TEXT.adaptation(adapt.word));
  }
  const weights = doctrineWeights(doctrine, Math.min(st.depth, 7), extra);

  let budget = V + cappedBank(st.waveBank, V);
  st.waveBank = 0;

  const wave: WaveRec = {
    uid: ++st.waveUid,
    n,
    kind: 'wave',
    nestId: nest ? nest.id : 0,
    dir: nest ? nest.dir : compassDir(st.hearthX, st.hearthY, mp.x, mp.y),
    musterX: mp.x,
    musterY: mp.y,
    members: [],
    initialCount: 0,
    doctrine,
    musterTick: world.tick,
    launchAt,
    launchTick: -1,
    hornAt: st.mods.thickFog && !o.forced ? launchAt - MODIFIER_NUMBERS.thickFogHornLead : world.time,
    announced: false,
    phase: 'muster',
    revealed: false,
    great: !!o.great,
    targetId: 0,
    targetRule: 'hearth',
    notes,
    brokenTick: -1,
    caps: { riders: 0, main: 0, siege: 0 },
    huntTargetId: 0,
  };

  const used = new Map<number, number>();
  // Garrison overflow joins first; its value comes off the budget. Joiners count toward the wave pool.
  const counts = countPools(world);
  if (nest) {
    const joiners = garrisonOverflow(world, nest);
    if (joiners.length > 0) {
      const spots = spawnSpots(world, mp.x, mp.y, joiners.length, DIRECTOR.spawnRadius, used);
      joiners.forEach((u, i) => {
        const ai = aiOf(u);
        if (!ai || !canSpawnWave(counts)) return;
        counts.wave++;
        counts.standing--;
        nest.garrison = nest.garrison.filter((id) => id !== u.id);
        ai.role = 'wave';
        ai.state = 'muster';
        ai.wave = n;
        ai.waveUid = wave.uid;
        ai.postX = spots[i].x;
        ai.postY = spots[i].y;
        ai.anchorX = mp.x;
        ai.anchorY = mp.y;
        ai.leash = GARRISON.leashRadius;
        ai.aggro = GARRISON.aggroRadius;
        ai.nextThink = world.tick;
        wave.members.push(u.id);
        budget -= unitValue(u.type as EnemyUnitId);
      });
    }
  }

  const comp = composeWave(st.rng, budget, weights, Math.min(st.depth, 7));
  const spots = spawnSpots(world, mp.x, mp.y, comp.types.length, DIRECTOR.spawnRadius, used);
  for (let i = 0; i < comp.types.length; i++) {
    const type = comp.types[i];
    if (!canSpawnWave(counts)) {
      // Pool full: the remainder goes to waveBank for the next wave.
      for (let j = i; j < comp.types.length; j++) st.waveBank += unitValue(comp.types[j]);
      break;
    }
    const ai = makeAI(world, 'wave', type, {
      state: 'muster',
      postX: spots[i].x,
      postY: spots[i].y,
      anchorX: mp.x,
      anchorY: mp.y,
      leash: GARRISON.leashRadius,
      aggro: GARRISON.aggroRadius,
      wave: n,
      nestId: nest ? nest.id : 0,
      waveUid: wave.uid,
    });
    const u = spawnEnemy(world, type, spots[i].x, spots[i].y, ai);
    wave.members.push(u.id);
    counts.wave++;
    counts.total++;
  }
  wave.initialCount = wave.members.length;
  st.waves.push(wave);
  checkIntel(world, st, wave);
  if (world.time + 1e-6 >= wave.hornAt) announceWave(world, st, wave);
  return wave;
}

/** Horn: waveMuster event + toast (the Great Wave is called out once). */
export function announceWave(world: World, st: EncRuntime, wave: WaveRec): void {
  if (wave.announced) return;
  wave.announced = true;
  emit(world, { t: 'waveMuster', wave: wave.n, nestId: wave.nestId, x: wave.musterX, y: wave.musterY });
  const sibling = wave.great && st.waves.some((w) => w !== wave && w.great && w.n === wave.n && w.announced && w.uid < wave.uid);
  if (sibling) return;
  emit(world, {
    t: 'alert',
    kind: 'wave_muster',
    text: wave.great ? TEXT.greatWave : TEXT.hornMuster(wave.n, wave.dir),
    x: wave.musterX,
    y: wave.musterY,
    priority: 'high',
  });
}

/** Intel: a player unit within 6 tiles of the muster point, a Hawk reveal or a lit Beacon's vision. */
export function checkIntel(world: World, st: EncRuntime, wave: WaveRec): void {
  if (wave.revealed || wave.phase !== 'muster' || st.mods.thickFog) return;
  const r = DIRECTOR.intelRadius;
  for (const u of world.units) {
    if (u.alive && u.owner === PLAYER && dist(u.x, u.y, wave.musterX, wave.musterY) <= r) {
      wave.revealed = true;
      return;
    }
  }
  for (const v of world.vision) {
    if (v.until !== -1 && v.until <= world.tick) continue;
    if (dist(v.x, v.y, wave.musterX, wave.musterY) <= v.r) {
      wave.revealed = true;
      return;
    }
  }
}

const MILITARY_TARGET: ReadonlySet<UnitClass> = MILITARY;

/** Wave target precedence: objective target, doctrine target, Hearth. */
function chooseWaveTarget(world: World, st: EncRuntime, wave: WaveRec): void {
  const ox = wave.musterX;
  const oy = wave.musterY;
  // 1. Objective target (Beacons: the lit Beacon nearest the Nest).
  if (st.objective === 'beacons') {
    let best = 0;
    let bestD = Infinity;
    for (const b of st.beacons) {
      if (!b.lit) continue;
      const d = dist(ox, oy, b.x, b.y);
      if (d < bestD) {
        bestD = d;
        best = b.id;
      }
    }
    if (best) {
      wave.targetId = best;
      wave.targetRule = 'objective';
      return;
    }
  }
  // 2. Doctrine target.
  const rule = DOCTRINES[wave.doctrine].target;
  let target: Entity | null = null;
  if (rule === 'nearest_military') {
    let bestD = Infinity;
    for (const u of world.units) {
      if (!u.alive || u.owner !== PLAYER || !MILITARY_TARGET.has(u.cls)) continue;
      const d = dist(ox, oy, u.x, u.y);
      if (d < bestD) {
        bestD = d;
        target = u;
      }
    }
  } else if (rule === 'storehouse_tillers') {
    let bestCount = 0;
    for (const b of world.buildings) {
      if (!b.alive || b.owner !== PLAYER || b.type !== 'storehouse') continue;
      const c = centerOf(b);
      let count = 0;
      for (const u of world.units) {
        if (u.alive && u.owner === PLAYER && u.type === 'tiller' && dist(u.x, u.y, c.x, c.y) <= DIRECTOR.huntStorehouseRadius) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        target = b;
      }
    }
    if (!target) target = farthestTiller(world, st);
  } else if (rule === 'nearest_tower') {
    let bestD = Infinity;
    for (const b of world.buildings) {
      if (!b.alive || b.owner !== PLAYER || b.type !== 'brazier_tower') continue;
      const c = centerOf(b);
      const d = dist(ox, oy, c.x, c.y);
      if (d < bestD) {
        bestD = d;
        target = b;
      }
    }
  }
  if (target) {
    wave.targetId = target.id;
    wave.targetRule = 'doctrine';
    return;
  }
  wave.targetId = world.hearthId;
  wave.targetRule = 'hearth';
}

export function farthestTiller(world: World, st: EncRuntime): Unit | null {
  const h = hearth(world);
  const hx = h ? centerOf(h).x : st.hearthX;
  const hy = h ? centerOf(h).y : st.hearthY;
  let best: Unit | null = null;
  let bestD = -1;
  for (const u of world.units) {
    if (!u.alive || u.owner !== PLAYER || u.type !== 'tiller') continue;
    const d = dist(hx, hy, u.x, u.y);
    if (d > bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

/** Launch a mustering wave now. `killerId` (Nest died during muster) overrides the target. */
export function launchWave(world: World, st: EncRuntime, wave: WaveRec, killerId = 0, forced = false): void {
  if (wave.phase !== 'muster') return;
  if (!wave.announced) announceWave(world, st, wave);
  wave.phase = 'advancing';
  wave.launchTick = world.tick;
  st.wavesLaunched = Math.max(st.wavesLaunched, wave.n);
  const killer = liveEntity(world, killerId);
  if (killer && isPlayerTarget(killer)) {
    wave.targetId = killer.id;
    wave.targetRule = 'killer';
  } else {
    chooseWaveTarget(world, st, wave);
  }
  for (const id of wave.members) {
    const u = liveUnit(world, id);
    const ai = u ? aiOf(u) : null;
    if (!u || !ai) continue;
    beginAdvance(world, u, ai);
    if (killer && isPlayerTarget(killer)) {
      ai.forcedId = killer.id;
      ai.forcedUntil = world.tick + 10 * SEC;
    }
  }
  const nest = st.nests.find((x) => x.id === wave.nestId);
  if (nest && nest.alive) {
    nest.spent = spentOnLaunch(wave.n, world.tick, SEC);
    syncNestSpent(world, nest);
  }
  emit(world, { t: 'waveLaunch', wave: wave.n, nestId: wave.nestId, x: wave.musterX, y: wave.musterY });
  emit(world, {
    t: 'alert',
    kind: 'wave_launch',
    text: `Wave ${wave.n} advances from the ${wave.dir}.`,
    x: wave.musterX,
    y: wave.musterY,
    priority: 'normal',
  });
  if (st.lord && wave.n >= NOBLE.joinsWave) lordJoinWave(world, st, wave);
  if (!forced && raidsEnabled(st)) {
    const I = st.ascendant ? ASCENDANT.interval : waveInterval(st.depth);
    st.raids.push(world.time + floorEps(I / 2));
  }
  if (st.objective === 'holdfast' && wave.great && !st.waves.some((w) => w.great && w.phase === 'muster')) {
    st.cleanup = true;
  }
}

function raidsEnabled(st: EncRuntime): boolean {
  return RAID.objectives.includes(st.objective) && st.depth >= RAID.fromDepth && st.depth <= DEPTH.maxDepth;
}

export function launchRaid(world: World, st: EncRuntime): void {
  const V = floorEps(raidValue(st.depth) * waveMultiplier(world.setup.waveMult, st.mods.bloodMoon, false));
  if (V <= 0) return;
  const target = farthestTiller(world, st);
  const tx = target ? target.x : st.hearthX;
  const ty = target ? target.y : st.hearthY;
  let nest: NestRec | null = null;
  let bestD = Infinity;
  for (const n of livingNests(st)) {
    const d = dist(n.musterX, n.musterY, tx, ty);
    if (d < bestD) {
      bestD = d;
      nest = n;
    }
  }
  if (!nest) return;
  const types = composeRaid(V);
  const wave: WaveRec = {
    uid: ++st.waveUid,
    n: st.wavesLaunched,
    kind: 'raid',
    nestId: nest.id,
    dir: nest.dir,
    musterX: nest.musterX,
    musterY: nest.musterY,
    members: [],
    initialCount: 0,
    doctrine: st.doctrine,
    musterTick: world.tick,
    launchAt: world.time,
    launchTick: world.tick,
    hornAt: world.time,
    announced: true,
    phase: 'advancing',
    revealed: true,
    great: false,
    targetId: target ? target.id : world.hearthId,
    targetRule: target ? 'tiller' : 'hearth',
    notes: [],
    brokenTick: -1,
    caps: { riders: 0, main: 0, siege: 0 },
    huntTargetId: target ? target.id : 0,
  };
  const counts = countPools(world);
  const spots = spawnSpots(world, nest.musterX, nest.musterY, types.length, DIRECTOR.spawnRadius, new Map());
  types.forEach((type, i) => {
    if (!canSpawnWave(counts)) return;
    const ai = makeAI(world, 'raid', type, {
      state: 'advance',
      postX: spots[i].x,
      postY: spots[i].y,
      wave: wave.n,
      nestId: nest!.id,
      waveUid: wave.uid,
    });
    const u = spawnEnemy(world, type, spots[i].x, spots[i].y, ai);
    beginAdvance(world, u, ai);
    wave.members.push(u.id);
    counts.wave++;
    counts.total++;
  });
  wave.initialCount = wave.members.length;
  if (wave.members.length === 0) return;
  st.waves.push(wave);
  emit(world, { t: 'raidLaunch', x: nest.musterX, y: nest.musterY });
  emit(world, { t: 'alert', kind: 'raid', text: `Raiders ride from the ${nest.dir}.`, x: tx, y: ty, priority: 'high' });
}

export function breakWave(world: World, st: EncRuntime, wave: WaveRec): void {
  wave.phase = 'broken';
  wave.brokenTick = world.tick;
  if (wave.kind === 'raid') return;
  const nest = st.nests.find((x) => x.id === wave.nestId);
  let text = `Wave ${wave.n} broken.`;
  if (nest && nest.alive) {
    nest.spent = spentOnBroken(nest.spent, wave.n, world.tick, SEC);
    syncNestSpent(world, nest);
    if (spentActive(nest.spent, world.tick) && nest.spent.wave === wave.n) {
      text = TEXT.waveBroken(wave.n, nest.dir, fmtClock((nest.spent.until - world.tick) / SEC));
    }
  }
  emit(world, { t: 'waveBroken', wave: wave.n, nestId: wave.nestId });
  emit(world, {
    t: 'alert',
    kind: 'wave_broken',
    text,
    x: nest ? nest.cx : wave.musterX,
    y: nest ? nest.cy : wave.musterY,
    priority: 'normal',
  });
}
