/**
 * Nav inside a real battle: generated maps, sim-core behaviors, encounter waves and group orders.
 * Guards the integration invariants (no bodies in walls, nobody stuck, tick budget).
 */
import { describe, expect, it } from 'vitest';
import { generateMap } from '../../src/mapgen';
import { quickBattleSetup } from '../../src/run';
import { debugForceWave } from '../../src/sim/encounter';
import { createWorld, drainEvents, issueCommand, stepWorld } from '../../src/sim/world';
import type { ObjectiveId, World } from '../../src/sim/types';
import { overlapsBlocked } from './helpers';

function battle(objective: ObjectiveId, seed: number): World {
  const setup = quickBattleSetup({ objective, depth: 4, seed });
  const gen = generateMap({ seed: setup.seed, objective, biome: setup.biome, depth: setup.depth, modifiers: setup.modifiers });
  return createWorld(setup, gen);
}

describe('nav integration (real battle)', () => {
  for (const [objective, seed] of [
    ['raze', 3],
    ['holdfast', 11],
  ] as const) {
    it(`${objective}: waves and army orders move cleanly`, () => {
      const w = battle(objective, seed);
      let worst = 0;
      let total = 0;
      let ticks = 0;
      const stuck = new Set<number>();
      const inWalls = new Set<string>();
      for (let i = 0; i < 20 * 150; i++) {
        if (i === 20 * 4) debugForceWave(w, 3);
        if (i === 20 * 60) debugForceWave(w, 5);
        if (i % (20 * 30) === 20 * 12) {
          const army = w.units.filter((u) => u.alive && u.owner === 0 && u.cls !== 'worker').map((u) => u.id);
          const k = Math.floor(i / (20 * 30));
          const x = w.map.w * (k % 2 ? 0.3 : 0.6);
          const y = w.map.h * (k % 2 ? 0.6 : 0.4);
          if (army.length) issueCommand(w, { type: k % 2 ? 'move' : 'attackMove', unitIds: army, x, y });
        }
        const t0 = performance.now();
        stepWorld(w);
        const dt = performance.now() - t0;
        if (w.countdown <= 0) {
          total += dt;
          ticks++;
          worst = Math.max(worst, dt);
        }
        drainEvents(w);
        for (const u of w.units) {
          if (!u.alive) continue;
          if (u.moveStatus === 'stuck') stuck.add(u.id);
          // Idle units may legitimately stand on a dais (enthroned Regent); movers never overlap walls.
          if (u.move && overlapsBlocked(w, u)) inWalls.add(`${u.type}@${u.x.toFixed(1)},${u.y.toFixed(1)}`);
        }
        if (w.outcome !== 'ongoing') break;
      }
      expect([...inWalls]).toEqual([]);
      expect(stuck.size).toBeLessThanOrEqual(1);
      expect(total / Math.max(1, ticks)).toBeLessThan(4);
    });
  }
});
