/**
 * Nest bookkeeping shared by the director: living Nests, N and M, round-robin rotation,
 * the public Spent mirror (Building.nest) and garrison regeneration (§I "Garrisons").
 */
import { ASCENDANT, GARRISON, nestFactor } from '../../data/balance';
import { TICK_DT, type EnemyUnitId, type World } from '../types';
import { composeStanding, isAscendantObjective, spentActive, standingWeights, unitValue, waveMultiplier } from './formulas';
import { liveUnit, spawnSpots } from './geom';
import { canSpawnStanding, countPools, makeAI, spawnEnemy } from './spawn';
import type { EncRuntime, NestRec } from './state';

export function livingNests(st: EncRuntime): NestRec[] {
  return st.nests.filter((n) => n.alive);
}

export function currentN(st: EncRuntime): number {
  return nestFactor(livingNests(st).length, st.nestsTotal);
}

/** M for a wave launching at `launchAt`. */
export function currentM(world: World, st: EncRuntime, launchAt: number): number {
  const asc = isAscendantObjective(st.objective) && launchAt + 1e-6 >= ASCENDANT.time;
  return waveMultiplier(world.setup.waveMult, st.mods.bloodMoon, asc);
}

export function heartsAlive(st: EncRuntime): number {
  return st.objective === 'boss' ? livingNests(st).length : 0;
}

/** Next living Nest in round-robin order (does not advance the cursor). */
export function peekNest(st: EncRuntime): NestRec | null {
  const n = st.nests.length;
  for (let k = 0; k < n; k++) {
    const nest = st.nests[(st.rotation + k) % n];
    if (nest.alive) return nest;
  }
  return null;
}

export function takeNest(st: EncRuntime): NestRec | null {
  const n = st.nests.length;
  for (let k = 0; k < n; k++) {
    const idx = (st.rotation + k) % n;
    const nest = st.nests[idx];
    if (nest.alive) {
      st.rotation = (idx + 1) % n;
      return nest;
    }
  }
  return null;
}

export function syncNestSpent(world: World, nest: NestRec): void {
  const ns = nest.b.nest;
  if (!ns) return;
  const on = nest.alive && spentActive(nest.spent, world.tick);
  ns.spent = on;
  ns.spentUntil = on ? nest.spent.until : -1;
}

export function regenGarrisons(world: World, st: EncRuntime): void {
  for (const nest of st.nests) {
    if (!nest.alive) continue;
    nest.garrison = nest.garrison.filter((id) => !!liveUnit(world, id));
    if (spentActive(nest.spent, world.tick)) continue; // no regeneration while Spent
    let value = 0;
    for (const id of nest.garrison) {
      const u = liveUnit(world, id);
      if (u) value += unitValue(u.type as EnemyUnitId);
    }
    if (value + nest.regenBank >= nest.garrisonCap) {
      nest.regenTimer = 0;
    } else {
      nest.regenTimer += TICK_DT;
      if (nest.regenTimer + 1e-9 >= nest.regenInterval) {
        nest.regenTimer -= nest.regenInterval;
        nest.regenBank += GARRISON.regenValue;
      }
    }
    const room = nest.garrisonCap - value;
    if (!nest.regenNext) {
      const pool = standingWeights(st.doctrine, Math.min(st.depth, 7)).filter(([t]) => unitValue(t) <= room + 1e-9);
      if (pool.length === 0) continue;
      nest.regenNext = st.rng.weighted(pool, (e) => e[1])[0];
    }
    const need = unitValue(nest.regenNext);
    if (need > room + 1e-9) {
      nest.regenNext = null;
      continue;
    }
    if (nest.regenBank + 1e-9 < need) continue;
    if (!canSpawnStanding(countPools(world))) continue;
    const a = st.rng.next() * Math.PI * 2;
    const r = 3 + st.rng.next();
    const [post] = spawnSpots(world, nest.cx + Math.cos(a) * r, nest.cy + Math.sin(a) * r, 1, 3, new Map(), 1);
    const [spot] = spawnSpots(world, nest.musterX, nest.musterY, 1, 3, new Map(), 2);
    const ai = makeAI(world, 'garrison', nest.regenNext, {
      state: 'post',
      postX: post.x,
      postY: post.y,
      anchorX: nest.cx,
      anchorY: nest.cy,
      leash: GARRISON.leashRadius,
      aggro: GARRISON.aggroRadius,
      nestId: nest.id,
    });
    const u = spawnEnemy(world, nest.regenNext, spot.x, spot.y, ai);
    nest.garrison.push(u.id);
    nest.regenBank -= need;
    nest.regenNext = null;
  }
}

/** Initial garrison for a Nest / Root Heart. */
export function composeGarrison(st: EncRuntime, value: number): EnemyUnitId[] {
  return composeStanding(st.rng, value, standingWeights(st.doctrine, Math.min(st.depth, 7))).types;
}
