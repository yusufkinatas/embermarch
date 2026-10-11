/**
 * Headless end-to-end battles: real mapgen + createWorld + stepWorld + encounter + nav, driven by a
 * scripted player (tests/integration/bot.ts) that only uses issueCommand.
 *
 * Checks per battle: no exceptions, no NaN or off-map positions, resources flow inside loose GDD §R
 * bands, waves muster and launch on schedule, enemy waves reach and fight the base, entity caps,
 * and the tick budget (§R: sim tick ≤ 4 ms). Raze d1 must be winnable by the bot inside 12 minutes.
 *
 * The simulation is deterministic, so every number below is reproducible for its seed.
 */
import { describe, expect, it } from 'vitest';
import { BOSS, HOLDFAST, firstWaveLaunch, waveInterval } from '../../src/data/balance';
import { getEncounterView } from '../../src/sim/encounter';
import { getState } from '../../src/sim/encounter/state';
import type { World } from '../../src/sim/types';
import { PLAYER } from '../../src/sim/types';
import { runBattle, summarize, type BattleRun } from './harness';

const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const VERBOSE = !!env.BATTLE_LOG;
/** Wall-clock p99 is only meaningful on an otherwise idle machine: `PERF=1 npx vitest run tests/integration`. */
const PERF = env.PERF === '1';

function common(r: BattleRun): void {
  const msg = summarize(r);
  if (VERBOSE) console.log(msg);
  expect(r.nanAt, msg).toBeNull();
  // §D engine caps.
  expect(r.maxWavePool, msg).toBeLessThanOrEqual(50);
  expect(r.maxEnemies, msg).toBeLessThanOrEqual(80);
  // §R: simulation tick ≤ 4 ms. The average sits far below; p99 guards against spikes, but it is
  // wall-clock and fails under full-suite parallel load, so it only runs with PERF=1.
  expect(r.tickMs.avg, msg).toBeLessThan(2);
  if (PERF) expect(r.tickMs.p99, msg).toBeLessThan(4);
  // Waves reached the base and fought there (the army stages 6 tiles out toward the Nests).
  expect(r.launches.length, msg).toBeGreaterThanOrEqual(3);
  expect(r.closestWave, msg).toBeLessThan(13);
  expect(r.baseHits, msg).toBeGreaterThan(0);
  expect(r.playerHits, msg).toBeGreaterThan(20);
  // The bot played: it trained units and issued orders that mostly succeeded.
  expect(r.firstTrained, msg).not.toBeNull();
  expect(r.world.players[PLAYER].stats.unitsTrained, msg).toBeGreaterThan(10);
  const failed = Object.values(r.bot.stats.failed).reduce((s, n) => s + n, 0);
  expect(failed, msg).toBeLessThan(r.bot.stats.commands * 0.1);
}

function snap(r: BattleRun, t: number) {
  const s = r.snapshots.find((x) => x.t === t);
  if (!s) throw new Error(`no snapshot at ${t}`);
  return s;
}

/** Every recorded launch before Ascendant matches T1 + (n−1)·I; musters precede it by 30 s. */
function expectRazeSchedule(r: BattleRun, d: number): void {
  const t1 = firstWaveLaunch(d);
  const iv = waveInterval(d);
  for (const l of r.launches) {
    if (l.wave > 7) continue;
    // §I: a Nest killed during its muster launches the wave at once (at the killer).
    if (r.nestDeaths.some((t) => Math.abs(t - l.t) < 0.2)) continue;
    expect(Math.abs(l.t - (t1 + (l.wave - 1) * iv)), `wave ${l.wave} launch at ${l.t}`).toBeLessThan(0.2);
  }
  for (const m of r.musters) {
    if (m.wave > 7) continue;
    expect(Math.abs(m.t - (t1 - 30 + (m.wave - 1) * iv)), `wave ${m.wave} muster at ${m.t}`).toBeLessThan(0.2);
  }
}

describe('Raze d1: the bot plays a full battle', () => {
  const SEEDS = [2, 4, 5];
  const runs = new Map<number, BattleRun>();
  const get = (seed: number): BattleRun => {
    let r = runs.get(seed);
    if (!r) {
      r = runBattle({ objective: 'raze', depth: 1, seed, maxTime: 720 });
      runs.set(seed, r);
    }
    return r;
  };

  for (const seed of SEEDS) {
    it(`seed ${seed}: stable, on schedule, economy inside §R bands, waves fight the base`, () => {
      const r = get(seed);
      common(r);
      expectRazeSchedule(r, 1);
      // §R: first Tiller out at 0:10 (the bot queues one at once).
      expect(r.firstTrained!).toBeGreaterThan(9.5);
      expect(r.firstTrained!).toBeLessThan(11);
      // §R: Tillers 12 at 1:00, 17-18 at 2:00, 20 by 2:40 (loose: the bot trains to 20).
      expect(snap(r, 60).tillers).toBeGreaterThanOrEqual(11);
      expect(snap(r, 60).tillers).toBeLessThanOrEqual(14);
      expect(snap(r, 120).tillers).toBeGreaterThanOrEqual(16);
      expect(snap(r, 180).tillers).toBeGreaterThanOrEqual(19);
      // §D: twenty Tillers yield about 650-700 resources/min. Measure 3:00 → 5:00.
      const a = snap(r, 180).gathered;
      const b = snap(r, 300).gathered;
      const perMin = (b.grain + b.timber + b.ember - a.grain - a.timber - a.ember) / 2;
      expect(perMin).toBeGreaterThan(450);
      expect(perMin).toBeLessThan(1000);
      // Every resource actually flows.
      expect(b.grain).toBeGreaterThan(900);
      expect(b.timber).toBeGreaterThan(900);
      expect(b.ember).toBeGreaterThan(150);
      // §R army: about 9 at 3:00 and 17 at 4:00 (the bot counts the Warden too).
      expect(snap(r, 180).army).toBeGreaterThanOrEqual(6);
      expect(snap(r, 240).army).toBeGreaterThanOrEqual(12);
      // Wave 1 launched, was broken, and the Spent loop ran.
      expect(r.broken.length).toBeGreaterThanOrEqual(2);
    });
  }

  it('the bot wins Raze d1 inside 12 minutes and the result is coherent', () => {
    const wins = SEEDS.map(get).filter((r) => r.world.outcome === 'victory');
    expect(wins.length, SEEDS.map((s) => summarize(get(s))).join('\n\n')).toBeGreaterThanOrEqual(2);
    for (const r of wins) {
      expect(r.world.time).toBeLessThan(720);
      expect(r.result.outcome).toBe('victory');
      expect(r.result.nestsDestroyed).toBe(2);
      expect(r.nestDeaths).toHaveLength(2);
      // Nest plunder 10 each, plus any Pickets.
      expect(r.result.plunderCrowns).toBeGreaterThanOrEqual(20);
      expect(r.result.survivors.length).toBeGreaterThan(0);
      expect(r.result.unspent.grain).toBe(Math.floor(r.world.players[PLAYER].res.grain));
      expect(getEncounterView(r.world).trackerText.startsWith('Nests 2/2')).toBe(true);
    }
  });
});

describe('Holdfast d3', () => {
  for (const seed of [1, 2]) {
    it(`seed ${seed}: fixed schedule incl. the split Great Wave; the bot survives all six waves`, () => {
      const r = runBattle({ objective: 'holdfast', depth: 3, seed, maxTime: 480 });
      common(r);
      // §C: launches at 60, 105, 150, 195, 240, 285 s; each musters 30 s earlier.
      for (const l of r.launches) {
        expect(Math.abs(l.t - HOLDFAST.launchTimes[l.wave - 1]), `wave ${l.wave}`).toBeLessThan(0.2);
      }
      for (const m of r.musters) {
        expect(Math.abs(m.t - (HOLDFAST.launchTimes[m.wave - 1] - 30)), `wave ${m.wave}`).toBeLessThan(0.2);
      }
      // The Great Wave launches once per living Nest.
      const nests = r.world.anchors.nests.length;
      expect(r.launches.filter((l) => l.wave === 6)).toHaveLength(nests);
      expect(r.world.outcome).toBe('victory');
      expect(r.result.outcome).toBe('victory');
      expect(getEncounterView(r.world).trackerText).toBe('Waves 6/6');
      expect(r.world.time).toBeGreaterThan(285);
      expect(r.world.time).toBeLessThan(420);
    });
  }
});

describe('Holdfast with no input', () => {
  // The Hearth and the respawning Warden alone must never hold all six waves (fix pass S2).
  it('d1-d3, seeds 1-4: never a victory', async () => {
    const { generateMap } = await import('../../src/mapgen');
    const { quickBattleSetup } = await import('../../src/run');
    const { createWorld, stepWorld } = await import('../../src/sim/world');
    const out: string[] = [];
    for (const depth of [1, 2, 3]) {
      for (const seed of [1, 2, 3, 4]) {
        const setup = quickBattleSetup({ objective: 'holdfast', depth, seed });
        const gen = generateMap({ seed: setup.seed, objective: setup.objective, biome: setup.biome, depth: setup.depth, modifiers: setup.modifiers });
        const w = createWorld(setup, gen);
        while (w.countdown > 0) stepWorld(w);
        while (w.outcome === 'ongoing' && w.time < 480) stepWorld(w);
        out.push(`d${depth} s${seed}: ${w.outcome} at ${w.time.toFixed(0)} s`);
      }
    }
    if (VERBOSE) console.log(out.join('\n'));
    expect(out.filter((l) => l.includes('victory')), out.join('\n')).toEqual([]);
  });
});

describe('Noble Hunt (elite) d3', () => {
  it('waves on schedule, the Antlered Lord rides out with wave 3 and fights', () => {
    let lordMoved = 0;
    let lordStart: { x: number; y: number } | null = null;
    const each = (w: World): void => {
      const st = getState(w);
      const lord = st?.lord ? w.entities.get(st.lord.id) : undefined;
      if (!lord) return;
      lordStart ??= { x: lord.x, y: lord.y };
      lordMoved = Math.max(lordMoved, Math.hypot(lord.x - lordStart.x, lord.y - lordStart.y));
    };
    const r = runBattle({ objective: 'elite', depth: 3, seed: 1, maxTime: 300, each });
    common(r);
    expectRazeSchedule(r, 3);
    const st = getState(r.world)!;
    expect(st.lord).not.toBeNull();
    expect(st.lord!.joined).toBe(true);
    expect(lordMoved).toBeGreaterThan(10);
    // The Lord's Wild Hunt / melee reached player units.
    expect(Object.keys(r.deathsBy).some((k) => k.endsWith('<-antlered_lord'))).toBe(true);
  });
});

describe('Beacons d2', () => {
  it('the bot clears the guards, lights the stones and wins on Kindling', () => {
    const r = runBattle({ objective: 'beacons', depth: 2, seed: 1, maxTime: 600 });
    common(r);
    expectRazeSchedule(r, 2);
    expect(r.world.outcome).toBe('victory');
    const view = getEncounterView(r.world);
    expect(view.kindling).toEqual({ value: 450, target: 450 });
    expect(view.trackerText.startsWith('Kindling 450/450')).toBe(true);
    // Stones wake at 1:30 and light after 10 s, so 450 Kindling needs at least 150 s more (3/s).
    expect(r.world.time).toBeGreaterThan(250);
    expect(r.events.beacon ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe('Briar Throne (boss)', () => {
  it('Hearts spawn waves on the boss timeline; Wrath brings phase 2 at 8:00', () => {
    // A quick battle has no Retinue or Boons, so the bot rarely holds to 8:00 on its own: keep the
    // Hearth standing from 7:00 so the Wrath timeline is always checked.
    const r = runBattle({
      objective: 'boss',
      seed: 1,
      maxTime: 490,
      each: (w) => {
        if (w.time >= 420) w.debug.invulnerablePlayer = true;
      },
    });
    common(r);
    for (const l of r.launches) {
      if (l.t > BOSS.wrathTime) continue; // after Wrath the interval drops to 45 s
      expect(Math.abs(l.t - (BOSS.t1 + (l.wave - 1) * BOSS.interval)), `wave ${l.wave}`).toBeLessThan(0.2);
    }
    const view = getEncounterView(r.world);
    expect(view.boss).not.toBeNull();
    expect(r.world.outcome, summarize(r)).toBe('ongoing');
    // No Heart fell, so Wrath at 8:00 uproots the Regent.
    expect(r.result.nestsDestroyed).toBe(0);
    expect(r.bossPhases.some((p) => p.phase === 2 && Math.abs(p.t - BOSS.wrathTime) < 1)).toBe(true);
    expect(view.boss!.phase).toBe(2);
    expect(view.boss!.warded).toBe(false);
  });
});

describe('cross-module hooks', () => {
  it('Holdfast "Unbroken" survives a demolition but not a building lost to the Thornwake', async () => {
    const { realWorld, runTo } = await import('../encounter/helpers');
    const { getEncounterResult } = await import('../../src/sim/encounter');
    const { issueCommand } = await import('../../src/sim/world');
    const { killEntity, spawnBuilding } = await import('../../src/sim/entities');
    const w = realWorld({ objective: 'holdfast', depth: 1, seed: 31 });
    runTo(w, 2);
    const own = (t: string) => w.buildings.find((b) => b.alive && b.owner === PLAYER && b.type === t)!;
    // Demolish the completed Vanguard Muster Hall: a choice, not a loss.
    expect(issueCommand(w, { type: 'demolish', buildingId: own('muster_hall').id }).ok).toBe(true);
    runTo(w, 3);
    expect(own('muster_hall')).toBeUndefined();
    expect(getEncounterResult(w)!.unbroken).toBe(true);
    expect(w.players[PLAYER].stats.buildingsLost).toBe(0);
    // A completed building destroyed by an enemy breaks it.
    const a = w.anchors.vanguard.muster_hall;
    const cottage = spawnBuilding(w, 'cottage', PLAYER, a.tx, a.ty);
    expect(cottage.built).toBe(true);
    const enemy = w.units.find((u) => u.alive && u.owner !== PLAYER)!;
    killEntity(w, cottage, enemy.id);
    expect(getEncounterResult(w)!.unbroken).toBe(false);
    expect(w.players[PLAYER].stats.buildingsLost).toBe(1);
  });
});
