/**
 * Battle start (fix pass): the starting military spawns clear of the Tillers so "drag a box over your
 * Tillers" selects only Tillers (S4), and the free scout Courser is carried as Retinue only from
 * Rank I (S10).
 */
import { describe, expect, it } from 'vitest';
import { VETERANCY } from '../../src/data/balance';
import { generateMap } from '../../src/mapgen';
import { quickBattleSetup } from '../../src/run';
import { creditKill } from '../../src/sim/hooks';
import { spawnUnit } from '../../src/sim/entities';
import { pointRectDist } from '../../src/sim/core';
import type { BattleSetup, Building, ObjectiveId, World } from '../../src/sim/types';
import { PLAYER } from '../../src/sim/types';
import { buildBattleResult, createWorld } from '../../src/sim/world';
import { makeWorld } from './helpers';

function realStart(setup: BattleSetup): World {
  const gen = generateMap({ seed: setup.seed, objective: setup.objective, biome: setup.biome, depth: setup.depth, modifiers: setup.modifiers });
  return createWorld(setup, gen);
}

/** Problems with the start layout ('' when fine). */
function layoutProblems(w: World): string {
  const own = w.units.filter((u) => u.owner === PLAYER);
  const tillers = own.filter((u) => u.type === 'tiller');
  const others = own.filter((u) => u.type !== 'tiller');
  const pad = 0.5;
  const x0 = Math.min(...tillers.map((u) => u.x)) - pad;
  const x1 = Math.max(...tillers.map((u) => u.x)) + pad;
  const y0 = Math.min(...tillers.map((u) => u.y)) - pad;
  const y1 = Math.max(...tillers.map((u) => u.y)) + pad;
  const out: string[] = [];
  for (const u of others) {
    if (u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1) out.push(`${u.type} at (${u.x}, ${u.y}) inside the Tiller box`);
  }
  const h = w.entities.get(w.hearthId) as Building;
  for (const t of tillers) {
    const d = pointRectDist(t.x, t.y, h.tx, h.ty, h.w, h.h);
    if (d > 3) out.push(`Tiller ${d.toFixed(1)} tiles from the Hearth`);
  }
  return out.join('; ');
}

describe('starting military spawns clear of the Tillers (box-select the Tillers)', () => {
  const cases: { objective: ObjectiveId; seeds: number[] }[] = [
    { objective: 'raze', seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { objective: 'holdfast', seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { objective: 'beacons', seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { objective: 'elite', seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { objective: 'boss', seeds: [1] },
  ];
  for (const c of cases) {
    it(`${c.objective}: no non-Tiller inside the Tillers' box, every Tiller beside the Hearth`, () => {
      const bad: string[] = [];
      for (const seed of c.seeds) {
        const w = realStart(quickBattleSetup({ objective: c.objective, depth: c.objective === 'elite' ? 3 : 1, seed }));
        const p = layoutProblems(w);
        if (p) bad.push(`seed ${seed}: ${p}`);
      }
      expect(bad).toEqual([]);
    });
  }

  it('with 3 Retinue and 3 Sellswords (and an extra Tiller from the House)', () => {
    const setup = quickBattleSetup({ objective: 'raze', depth: 2, seed: 3, house: 'tallow' });
    setup.retinue = [
      { type: 'ashpike', rank: 1, kills: 3 },
      { type: 'bowman', rank: 2, kills: 7 },
      { type: 'courser', rank: 1, kills: 4 },
    ];
    setup.sellswords = [
      { type: 'ashpike', rank: 1, kills: 0 },
      { type: 'ashpike', rank: 1, kills: 0 },
      { type: 'bowman', rank: 1, kills: 0 },
    ];
    const w = realStart(setup);
    expect(w.units.filter((u) => u.owner === PLAYER && u.carried)).toHaveLength(6);
    expect(layoutProblems(w)).toBe('');
  });
});

describe('the free scout Courser and the Retinue', () => {
  it('is marked free at spawn', () => {
    const w = makeWorld();
    const free = w.units.filter((u) => u.free);
    expect(free).toHaveLength(1);
    expect(free[0].type).toBe('courser');
  });

  it('is left out of the survivors at Rank 0 and carried once it reaches Rank I; trained Coursers always count', () => {
    const w = makeWorld();
    const scout = w.units.find((u) => u.free)!;
    const trained = spawnUnit(w, 'courser', PLAYER, 20, 20);
    const coursers = () => buildBattleResult(w, 'victory').survivors.filter((s) => s.type === 'courser');
    expect(coursers()).toEqual([{ type: 'courser', rank: 0, kills: 0 }]);
    for (let i = 0; i < VETERANCY.thresholds[0]; i++) creditKill(w, scout);
    expect(scout.rank).toBe(1);
    expect(coursers()).toHaveLength(2);
    expect(coursers()).toContainEqual({ type: 'courser', rank: 1, kills: VETERANCY.thresholds[0] });
    expect(trained.free).toBeUndefined();
  });
});
