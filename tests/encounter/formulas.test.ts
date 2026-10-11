import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { BLIGHT, ENEMY_UNLOCK_DEPTH, blightParams, nestFactor, rootbreakerCap } from '../../src/data/balance';
import { UNITS } from '../../src/data/units';
import {
  NOT_SPENT,
  adaptationFor,
  blightRadiusAt,
  bossSchedule,
  cappedBank,
  compassDir,
  composeRaid,
  composeStanding,
  composeWave,
  computeBlightTiles,
  computeWardGrid,
  doctrineWeights,
  doctrinesAvailable,
  fmtClock,
  holdfastLaunch,
  isStandingType,
  launchTimes,
  nextLaunchAfter,
  plunderCrowns,
  recedeRadius,
  resolvePrimaryDoctrine,
  sizeLabel,
  spentActive,
  spentOnBroken,
  spentOnLaunch,
  splitValue,
  standardSchedule,
  standingWeights,
  totalValue,
  unitValue,
  waveMultiplier,
  waveValueFor,
  wavePctDrop,
} from '../../src/sim/encounter/formulas';
import type { DoctrineId, EnemyUnitId } from '../../src/sim/types';

const clock = (s: number) => fmtClock(s);

// GDD §C "Wave values V(n,d) at launch time" (all Nests alive, M = 1).
const WAVE_TABLE: Record<number, string[]> = {
  1: ['10 @1:46', '16 @2:54', '22 @4:02', '30 @5:10', '38 @6:18', '48 @7:26', '58 @8:34'],
  2: ['11 @1:42', '17 @2:48', '25 @3:54', '33 @5:00', '43 @6:06', '53 @7:12', '65 @8:18'],
  3: ['13 @1:38', '19 @2:42', '27 @3:46', '37 @4:50', '47 @5:54', '59 @6:58', '72 @8:02'],
  4: ['14 @1:34', '21 @2:36', '30 @3:38', '40 @4:40', '52 @5:42', '65 @6:44', '79 @7:46'],
  5: ['15 @1:30', '23 @2:30', '33 @3:30', '44 @4:30', '56 @5:30', '71 @6:30', '86 @7:30'],
  6: ['16 @1:26', '25 @2:24', '36 @3:22', '48 @4:20', '61 @5:18', '76 @6:16', '93 @7:14'],
};

// GDD §C Holdfast table.
const HOLDFAST_TABLE: Record<number, number[]> = {
  1: [6, 10, 14, 19, 26, 40],
  2: [6, 11, 15, 21, 29, 44],
  3: [7, 12, 17, 23, 32, 49],
  4: [8, 13, 19, 25, 35, 54],
  5: [8, 14, 20, 28, 38, 59],
  6: [9, 16, 22, 30, 41, 64],
};

describe('wave values and schedule (GDD §C)', () => {
  for (let d = 1; d <= 6; d++) {
    it(`d${d} matches the wave table (values and launch times)`, () => {
      const times = launchTimes(standardSchedule(d), 7);
      const got = times.map((t, i) => `${waveValueFor('raze', i + 1, d, 1, 1)} @${clock(t)}`);
      expect(got).toEqual(WAVE_TABLE[d]);
    });
    it(`d${d} matches the Holdfast table`, () => {
      const got = [1, 2, 3, 4, 5, 6].map((n) => waveValueFor('holdfast', n, d, 1, 1));
      expect(got).toEqual(HOLDFAST_TABLE[d]);
    });
  }

  it('Holdfast launches at 60/105/150/195/240/285', () => {
    expect([1, 2, 3, 4, 5, 6].map(holdfastLaunch)).toEqual([60, 105, 150, 195, 240, 285]);
  });

  it('boss waves with 3 Hearts: 15, 24, 33, 45, 57, 72, 87 at 1:40, 2:40, ...', () => {
    const vals = [1, 2, 3, 4, 5, 6, 7].map((n) => waveValueFor('boss', n, 7, 1, 1, 3));
    expect(vals).toEqual([15, 24, 33, 45, 57, 72, 87]);
    const t = launchTimes(bossSchedule(), 5).map(clock);
    expect(t).toEqual(['1:40', '2:40', '3:40', '4:40', '5:40']);
  });

  it('boss interval drops to 45 s after 8:00 (Wrath)', () => {
    const t = launchTimes(bossSchedule(), 10);
    // 100..460 every 60, then the straddling gap is cut to 505, then +45.
    expect(t).toEqual([100, 160, 220, 280, 340, 400, 460, 505, 550, 595]);
  });

  it('Ascendant: interval 35 s from 9:00 and no gap is longer than I', () => {
    const s = standardSchedule(1);
    const t = launchTimes(s, 11);
    expect(t.slice(0, 7)).toEqual([106, 174, 242, 310, 378, 446, 514]);
    expect(t[7]).toBe(549);
    expect(t[8] - t[7]).toBe(35);
    expect(t[9] - t[8]).toBe(35);
    const d6 = launchTimes(standardSchedule(6), 12);
    for (let i = 1; i < d6.length; i++) expect(d6[i] - d6[i - 1]).toBeLessThanOrEqual(58);
    expect(nextLaunchAfter(s, 600)).toBe(635);
  });

  it('no Ascendant switch for Holdfast-style schedules', () => {
    const s = standardSchedule(1, { ascendant: false });
    expect(launchTimes(s, 10)[9]).toBe(106 + 9 * 68);
  });

  it('T1 modifiers: Bountiful Wilds −20 s, Thornbound III −15 s', () => {
    expect(standardSchedule(1, { bountiful: true }).t1).toBe(86);
    expect(standardSchedule(1, { t1Delta: -15 }).t1).toBe(91);
    expect(standardSchedule(4, { t1Delta: -15, bountiful: true }).t1).toBe(59);
  });

  it('N factor: 2 Nests 1 → 0.7 → 0.4, 3 Nests 1 → 0.8 → 0.6', () => {
    expect(nestFactor(2, 2)).toBeCloseTo(1);
    expect(nestFactor(1, 2)).toBeCloseTo(0.7);
    expect(nestFactor(0, 2)).toBeCloseTo(0.4);
    expect(nestFactor(2, 3)).toBeCloseTo(0.8);
    expect(nestFactor(1, 3)).toBeCloseTo(0.6);
    expect(wavePctDrop(nestFactor(2, 2), nestFactor(1, 2))).toBe(30);
    expect(wavePctDrop(nestFactor(3, 3), nestFactor(2, 3))).toBe(20);
  });

  it('N shrinks wave value (d4 wave 4 with one of two Nests dead)', () => {
    expect(waveValueFor('raze', 4, 4, nestFactor(1, 2), 1)).toBe(Math.floor(40.8 * 0.7 + 1e-6));
  });

  it('M multiplies Blood Moon ×1.3, run multipliers and Ascendant ×1.5', () => {
    expect(waveMultiplier(1, false, false)).toBe(1);
    expect(waveMultiplier(1, true, false)).toBeCloseTo(1.3);
    expect(waveMultiplier(1.1, false, true)).toBeCloseTo(1.65);
    expect(waveMultiplier(1.15 * 1.1, true, true)).toBeCloseTo(1.15 * 1.1 * 1.3 * 1.5);
    expect(waveValueFor('raze', 1, 1, 1, waveMultiplier(1, true, false))).toBe(13);
  });

  it('waveBank is capped at 50% of V', () => {
    expect(cappedBank(10, 16)).toBe(8);
    expect(cappedBank(5, 16)).toBe(5);
    expect(cappedBank(-3, 16)).toBe(0);
  });

  it('Great Wave splits evenly across living Nests', () => {
    expect(splitValue(64, 3)).toEqual([22, 21, 21]);
    expect(splitValue(40, 2)).toEqual([20, 20]);
    expect(splitValue(41, 1)).toEqual([41]);
  });
});

describe('doctrines and weights (GDD §I)', () => {
  it('availability by depth', () => {
    expect(doctrinesAvailable(1)).toEqual(['swarm', 'spines']);
    expect(doctrinesAvailable(2)).toEqual(['swarm', 'spines', 'hunt']);
    expect(doctrinesAvailable(3)).toEqual(['swarm', 'spines', 'hunt', 'siegebreak']);
    expect(doctrinesAvailable(4)).toEqual(['swarm', 'spines', 'hunt', 'siegebreak', 'court']);
    expect(doctrinesAvailable(7)).toHaveLength(5);
  });

  it('primary doctrine: Swift Hunt forces Hunt, unavailable rolls fall back', () => {
    expect(resolvePrimaryDoctrine('spines', 1, true)).toBe('hunt');
    expect(resolvePrimaryDoctrine('court', 2, false)).toBe('swarm');
    expect(resolvePrimaryDoctrine('court', 4, false)).toBe('court');
  });

  it('types below their unlock depth drop out of the weights', () => {
    for (const doc of ['swarm', 'spines', 'hunt', 'siegebreak', 'court'] as DoctrineId[]) {
      for (let d = 1; d <= 7; d++) {
        for (const [t, w] of doctrineWeights(doc, d)) {
          expect(ENEMY_UNLOCK_DEPTH[t]!).toBeLessThanOrEqual(d);
          expect(w).toBeGreaterThan(0);
        }
      }
    }
    const swarm1 = doctrineWeights('swarm', 1).map(([t]) => t);
    expect(swarm1).toEqual(['thornling', 'briarguard', 'spinecaster']);
    expect(doctrineWeights('swarm', 5).map(([t]) => t)).toContain('thornhusk');
  });

  it('standing weights only hold value >= 2 non-siege standing-eligible types', () => {
    for (const doc of ['swarm', 'spines', 'hunt', 'siegebreak', 'court'] as DoctrineId[]) {
      for (let d = 1; d <= 7; d++) {
        const w = standingWeights(doc, d);
        expect(w.length).toBeGreaterThan(0);
        for (const [t] of w) {
          expect(isStandingType(t)).toBe(true);
          expect(UNITS[t].cls).not.toBe('siege');
        }
      }
    }
  });
});

describe('composition (GDD §I "Composition")', () => {
  const docs: DoctrineId[] = ['swarm', 'spines', 'hunt', 'siegebreak', 'court'];

  it('respects budget, eligibility and the Rootbreaker cap', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = new Rng(seed);
      for (const doc of docs) {
        for (let d = 1; d <= 7; d++) {
          for (const budget of [1, 3, 7, 16, 40, 93]) {
            const weights = doctrineWeights(doc, d);
            const c = composeWave(rng, budget, weights, d);
            const allowed = new Set(weights.map(([t]) => t));
            expect(totalValue(c.types)).toBeLessThanOrEqual(budget);
            expect(c.leftover).toBeCloseTo(budget - totalValue(c.types));
            for (const t of c.types) {
              expect(allowed.has(t)).toBe(true);
              expect(ENEMY_UNLOCK_DEPTH[t]!).toBeLessThanOrEqual(d);
            }
            const roots = c.types.filter((t) => t === 'rootbreaker').length;
            expect(roots).toBeLessThanOrEqual(rootbreakerCap(d));
            // Nothing eligible remains: every type that fits is blocked by the cap.
            const fits = weights.filter(([t]) => unitValue(t) <= c.leftover && (t !== 'rootbreaker' || roots < rootbreakerCap(d)));
            expect(fits).toEqual([]);
          }
        }
      }
    }
  });

  it('Rootbreaker cap is 1 + floor(d/4)', () => {
    expect([1, 3, 4, 6, 7].map(rootbreakerCap)).toEqual([1, 1, 2, 2, 2]);
    const rng = new Rng(7);
    const heavy: readonly (readonly [EnemyUnitId, number])[] = [['rootbreaker', 1000], ['briarguard', 1]];
    const c = composeWave(rng, 60, heavy, 3);
    expect(c.types.filter((t) => t === 'rootbreaker')).toHaveLength(1);
  });

  it('standing forces: value >= 2 types, remainder under 2 discarded', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = new Rng(seed);
      for (let d = 1; d <= 7; d++) {
        for (const value of [3, 5, 8, 10, 16, 25]) {
          const c = composeStanding(rng, value, standingWeights('swarm', d));
          for (const t of c.types) expect(isStandingType(t)).toBe(true);
          expect(totalValue(c.types)).toBeLessThanOrEqual(value);
          expect(c.leftover).toBeLessThan(2);
        }
      }
    }
  });

  it('raids: Stagriders while at least 3 value remains, then Thornlings', () => {
    expect(composeRaid(5)).toEqual(['stagrider', 'thornling', 'thornling']);
    expect(composeRaid(8)).toEqual(['stagrider', 'stagrider', 'thornling', 'thornling']);
    expect(composeRaid(6)).toEqual(['stagrider', 'stagrider']);
  });

  it('is deterministic for a seed', () => {
    const a = composeWave(new Rng(99), 40, doctrineWeights('court', 5), 5).types;
    const b = composeWave(new Rng(99), 40, doctrineWeights('court', 5), 5).types;
    expect(a).toEqual(b);
  });
});

describe('light adaptation (SHOULD)', () => {
  it('needs 6+ military with a 40% class share', () => {
    expect(adaptationFor({ ranged: 5 }, 5, 3)).toBeNull();
    expect(adaptationFor({ ranged: 2, infantry: 2, cavalry: 2 }, 6, 3)).toBeNull();
    expect(adaptationFor({ ranged: 4, infantry: 3, cavalry: 3 }, 10, 3)?.counter).toBe('stagrider');
    expect(adaptationFor({ ranged: 6, infantry: 2 }, 8, 1)?.counter).toBe('thornling');
    expect(adaptationFor({ infantry: 6, ranged: 2 }, 8, 1)?.counter).toBe('spinecaster');
    expect(adaptationFor({ cavalry: 5, ranged: 1 }, 6, 2)?.counter).toBe('briarguard');
    expect(adaptationFor({ ranged: 6 }, 6, 2)?.word).toBe('bows');
  });
});

describe('Spent clock (GDD §I "Spent")', () => {
  const R = 20;
  it('starts at launch and lasts 90 s if the wave lives', () => {
    const c = spentOnLaunch(3, 1000, R);
    expect(c.until).toBe(1000 + 90 * R);
    expect(spentActive(c, 1000)).toBe(true);
    expect(spentActive(c, 1000 + 90 * R - 1)).toBe(true);
    expect(spentActive(c, 1000 + 90 * R)).toBe(false);
  });
  it('ends 30 s after the wave breaks', () => {
    const c = spentOnBroken(spentOnLaunch(3, 1000, R), 3, 1000 + 20 * R, R);
    expect(c.until).toBe(1000 + 50 * R);
    // A break late in the window still grants the full 30 s.
    const late = spentOnBroken(spentOnLaunch(3, 0, R), 3, 80 * R, R);
    expect(late.until).toBe(110 * R);
  });
  it('ignores breaks after the 90 s cap and breaks of other waves', () => {
    const c = spentOnLaunch(3, 0, R);
    expect(spentOnBroken(c, 3, 95 * R, R)).toEqual(c);
    expect(spentOnBroken(c, 1, 10 * R, R)).toEqual(c);
    expect(spentActive(NOT_SPENT, 0)).toBe(false);
  });
});

describe('Blight (GDD §K)', () => {
  it('grows +1 per interval from 4 to the cap (cap reached 2:20 / 3:20 / 4:00)', () => {
    for (const [d, at] of [
      [1, 140],
      [4, 200],
      [6, 240],
    ] as const) {
      const p = blightParams('raze', d, false);
      expect(blightRadiusAt(p.start, p.cap, p.interval, 0)).toBe(4);
      expect(blightRadiusAt(p.start, p.cap, p.interval, at - 0.1)).toBe(p.cap - 1);
      expect(blightRadiusAt(p.start, p.cap, p.interval, at)).toBe(p.cap);
      expect(blightRadiusAt(p.start, p.cap, p.interval, 9999)).toBe(10 + d);
    }
  });
  it('per-objective parameters', () => {
    expect(blightParams('holdfast', 3, false)).toEqual({ start: 4, cap: 8, interval: 25 });
    expect(blightParams('boss', 7, false)).toEqual({ start: 4, cap: 12, interval: 10 });
    expect(blightParams('raze', 2, true)).toEqual({ start: 4, cap: 15, interval: 12 });
  });
  it('recedes to 0 over 4 s', () => {
    expect(recedeRadius(10, 0)).toBe(10);
    expect(recedeRadius(10, 2)).toBeCloseTo(5);
    expect(recedeRadius(10, BLIGHT.recedeTime)).toBe(0);
  });
  it('tiles = within a living source radius AND ward == 0 AND blightable', () => {
    const w = 20;
    const h = 20;
    const tiles = new Uint8Array(w * h);
    const changed = computeBlightTiles(tiles, w, h, [{ x: 10, y: 10, r: 3 }], null, null);
    expect(changed).toBe(true);
    const count = tiles.reduce((a, b) => a + b, 0);
    expect(count).toBeGreaterThanOrEqual(28);
    expect(count).toBeLessThanOrEqual(32);
    expect(tiles[10 * w + 10]).toBe(1);
    expect(tiles[10 * w + 14]).toBe(0);
    expect(computeBlightTiles(tiles, w, h, [{ x: 10, y: 10, r: 3 }], null, null)).toBe(false);

    const ward = new Uint16Array(w * h);
    computeWardGrid(ward, w, h, [{ tx: 10, ty: 10, w: 1, h: 1, r: 1 }]);
    computeBlightTiles(tiles, w, h, [{ x: 10, y: 10, r: 3 }], ward, null);
    expect(tiles[10 * w + 10]).toBe(0);
    expect(tiles[10 * w + 8]).toBe(1);

    const can = new Uint8Array(w * h).fill(1);
    can[9 * w + 9] = 0;
    computeBlightTiles(tiles, w, h, [{ x: 10, y: 10, r: 3 }], null, can);
    expect(tiles[9 * w + 9]).toBe(0);
    computeBlightTiles(tiles, w, h, [], null, null);
    expect(tiles.reduce((a, b) => a + b, 0)).toBe(0);
  });
  it('ward counts tiles within r of a footprint and stacks', () => {
    const w = 16;
    const ward = new Uint16Array(w * w);
    computeWardGrid(ward, w, w, [{ tx: 5, ty: 5, w: 2, h: 2, r: 1 }]);
    expect(ward.reduce((a, b) => a + b, 0)).toBe(16);
    computeWardGrid(ward, w, w, [
      { tx: 5, ty: 5, w: 2, h: 2, r: 1 },
      { tx: 6, ty: 6, w: 2, h: 2, r: 1 },
    ]);
    expect(ward[6 * w + 6]).toBe(2);
    expect(ward[4 * w + 4]).toBe(1);
    computeWardGrid(ward, w, w, [{ tx: 5, ty: 5, w: 4, h: 4, r: 5 }]);
    expect(ward[7 * w + 0]).toBe(1);
    expect(ward[7 * w + 15]).toBe(0);
  });
});

describe('plunder (GDD §M) and UI helpers', () => {
  it('Crowns per source', () => {
    expect(plunderCrowns('nest', false, false)).toBe(10);
    expect(plunderCrowns('nest', true, false)).toBe(20);
    expect(plunderCrowns('nest', true, true)).toBe(30);
    expect(plunderCrowns('picket', false, false)).toBe(5);
    expect(plunderCrowns('picket', false, true)).toBe(15);
    expect(plunderCrowns('cache', true, true)).toBe(15);
    expect(plunderCrowns('ancient', false, false)).toBe(60);
  });
  it('compass, size labels and clock', () => {
    expect(compassDir(10, 54, 50, 14)).toBe('NE');
    expect(compassDir(0, 0, 5, 0)).toBe('E');
    expect(compassDir(0, 0, 0, 5)).toBe('S');
    expect(compassDir(0, 0, -5, -5)).toBe('NW');
    expect(compassDir(0, 0, -5, 0)).toBe('W');
    expect(sizeLabel(7)).toBe('Small');
    expect(sizeLabel(8)).toBe('Medium');
    expect(sizeLabel(19)).toBe('Medium');
    expect(sizeLabel(20)).toBe('Large');
    expect(fmtClock(272)).toBe('4:32');
    expect(fmtClock(0)).toBe('0:00');
    expect(fmtClock(29.2)).toBe('0:30');
    expect(fmtClock(-5)).toBe('0:00');
  });
});
