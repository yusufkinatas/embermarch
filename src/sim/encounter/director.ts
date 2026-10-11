/**
 * Wave director (§I "Wave director", §C Holdfast / Ascendant): the timeline (muster at launch − 30 s,
 * Holdfast fixed schedule and Great Wave split, Ascendant), the per-tick pass over waves (intel,
 * horn, launch, raids, broken, Holdfast cleanup), Spent sync, garrison regen and debug waves.
 * Wave lifecycle lives in waves.ts, Nest bookkeeping in nests.ts.
 */
import { ASCENDANT, DEPTH, HOLDFAST } from '../../data/balance';
import { TEXT } from '../../data/text';
import type { DoctrineId, Unit, World } from '../types';
import { cappedBank, fmtClock, holdfastLaunch, isAscendantObjective, nextLaunchAfter, splitValue, waveValueFor } from './formulas';
import { emit, liveUnit } from './geom';
import { currentM, currentN, heartsAlive, livingNests, peekNest, regenGarrisons, syncNestSpent, takeNest } from './nests';
import { aiOf, type EncRuntime } from './state';
import { announceWave, breakWave, checkIntel, launchRaid, launchWave, musterWave } from './waves';

function scheduleMusters(world: World, st: EncRuntime): void {
  const now = world.time + 1e-6;
  const lead = DEPTH.musterLead;
  for (let guard = 0; guard < 8; guard++) {
    let launchAt: number;
    if (st.objective === 'holdfast') {
      if (st.nextN > HOLDFAST.waves) return;
      launchAt = holdfastLaunch(st.nextN);
    } else {
      if (!st.schedule) return;
      launchAt = st.nextLaunch;
    }
    if (now < launchAt - lead) return;
    const n = st.nextN;
    st.nextN++;
    if (st.schedule) st.nextLaunch = nextLaunchAfter(st.schedule, launchAt);
    if (st.coldWatchfire && n === 1) {
      st.wavesLaunched = Math.max(st.wavesLaunched, 1);
      continue;
    }
    musterScheduled(world, st, n, launchAt);
  }
}

function musterScheduled(world: World, st: EncRuntime, n: number, launchAt: number): void {
  const N = currentN(st);
  const M = currentM(world, st, launchAt);
  if (st.objective === 'holdfast' && n === HOLDFAST.greatWave) {
    const nests = livingNests(st);
    if (nests.length === 0) return;
    const V = waveValueFor('holdfast', n, st.depth, N, M);
    const bank = cappedBank(st.waveBank, V);
    st.waveBank = 0;
    const parts = splitValue(V + Math.floor(bank), nests.length);
    nests.forEach((nest, i) => musterWave(world, st, nest, n, parts[i], launchAt, { great: true }));
    return;
  }
  const nest = takeNest(st);
  if (!nest && st.objective !== 'boss') return;
  const V = waveValueFor(st.objective, n, st.depth, N, M, heartsAlive(st));
  musterWave(world, st, nest, n, V, launchAt);
}

export function tickDirector(world: World, st: EncRuntime): void {
  const now = world.time + 1e-6;
  // Ascendant soft clock (Raze, Beacons, Elite).
  if (isAscendantObjective(st.objective)) {
    if (!st.ascendantWarned && now >= ASCENDANT.time - ASCENDANT.warnLead) {
      st.ascendantWarned = true;
      emit(world, { t: 'alert', kind: 'ascendant', text: `The Thornwake stirs. ${TEXT.ascendantSoon(fmtClock(ASCENDANT.time - world.time))}`, priority: 'high' });
    }
    if (!st.ascendant && now >= ASCENDANT.time) {
      st.ascendant = true;
      emit(world, { t: 'alert', kind: 'ascendant', text: 'The Thornwake ascends. Waves come faster and stronger.', priority: 'high' });
    }
  }
  scheduleMusters(world, st);

  for (const w of st.waves) {
    if (w.phase !== 'muster') continue;
    checkIntel(world, st, w);
    if (!w.announced && now >= w.hornAt) announceWave(world, st, w);
    if (now >= w.launchAt) launchWave(world, st, w);
  }

  // Raids.
  if (st.raids.length > 0) {
    const due = st.raids.filter((t) => now >= t);
    if (due.length > 0) {
      st.raids = st.raids.filter((t) => now < t);
      for (let i = 0; i < due.length; i++) launchRaid(world, st);
    }
  }

  // Broken detection.
  for (const w of st.waves) {
    if (w.phase !== 'advancing') continue;
    w.members = w.members.filter((id) => !!liveUnit(world, id));
    if (w.members.length === 0) breakWave(world, st, w);
  }
  st.waves = st.waves.filter((w) => w.phase !== 'broken');

  // Holdfast cleanup: reveal remaining wave units; at 6 or fewer they charge the Hearth.
  if (st.cleanup) {
    const rest: Unit[] = [];
    for (const u of world.units) if (u.alive && u.ai && (u.ai.role === 'wave' || u.ai.role === 'raid')) rest.push(u);
    st.revealed = rest.map((u) => u.id);
    if (rest.length <= HOLDFAST.cleanupChargeCount) {
      for (const u of rest) {
        const ai = aiOf(u);
        if (ai && !ai.noKite) {
          ai.noKite = true;
          ai.state = 'advance';
          ai.nextThink = world.tick;
        }
      }
    }
  }

  for (const nest of st.nests) syncNestSpent(world, nest);
  regenGarrisons(world, st);
  updateMusterProgress(world, st);
}

function updateMusterProgress(world: World, st: EncRuntime): void {
  if (world.tick % 5 !== 0) return;
  const next = peekNest(st);
  const interval = st.schedule ? st.schedule.interval : HOLDFAST.launchTimes[1] - HOLDFAST.launchTimes[0];
  const nextMuster = (st.objective === 'holdfast' ? holdfastLaunch(st.nextN) : st.nextLaunch) - DEPTH.musterLead;
  for (const nest of st.nests) {
    const ns = nest.b.nest;
    if (!ns) continue;
    if (!nest.alive) {
      ns.musterProgress = 0;
      continue;
    }
    if (st.waves.some((w) => w.phase === 'muster' && w.nestId === nest.id)) ns.musterProgress = 1;
    else if (nest === next) ns.musterProgress = Math.max(0, Math.min(1, 1 - (nextMuster - world.time) / interval));
    else ns.musterProgress = 0;
  }
}

/** Debug: muster and launch wave n now at the next Nest (optionally with a doctrine). */
export function forceWave(world: World, st: EncRuntime, n: number, doctrine?: DoctrineId): void {
  const N = currentN(st);
  const M = currentM(world, st, world.time);
  const nest = takeNest(st);
  const V = waveValueFor(st.objective, Math.max(1, n), st.depth, N, M, heartsAlive(st));
  const wave = musterWave(world, st, nest, Math.max(1, n), V, world.time, { doctrine, forced: true });
  wave.revealed = true;
  launchWave(world, st, wave, 0, true);
}

/** Launch every wave mustering at a Nest that just died, aimed at the killer. */
export function launchMusteringAt(world: World, st: EncRuntime, nestId: number, killerId: number): void {
  for (const w of st.waves) if (w.phase === 'muster' && w.nestId === nestId) launchWave(world, st, w, killerId);
}
