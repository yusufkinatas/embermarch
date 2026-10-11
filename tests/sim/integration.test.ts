/**
 * Cross-module smoke: real generated maps + the encounter module, for every objective.
 * A scripted opening runs for 90 s; the sim must not throw, the economy must flow, the tick must
 * stay cheap, and buildBattleResult must report a coherent result.
 */
import { describe, expect, it } from 'vitest';
import { generateMap } from '../../src/mapgen';
import { quickBattleSetup } from '../../src/run';
import { buildBattleResult, createWorld, drainEvents, issueCommand, stepWorld } from '../../src/sim/world';
import type { ObjectiveId } from '../../src/sim/types';
import { PLAYER, TICK_RATE } from '../../src/sim/types';

const OBJECTIVES: ObjectiveId[] = ['raze', 'holdfast', 'elite', 'boss'];

describe('integration with mapgen + encounter', () => {
  for (const objective of OBJECTIVES) {
    it(`${objective}: 90 s scripted opening`, () => {
      const setup = quickBattleSetup({ objective, depth: 2, seed: 1234 });
      const gen = generateMap({ seed: setup.seed, objective, biome: setup.biome, depth: setup.depth, modifiers: setup.modifiers });
      const w = createWorld(setup, gen);
      expect(w.hearthId).toBeGreaterThan(0);
      expect(w.wardenId).toBeGreaterThan(0);
      expect(w.units.some((u) => u.owner !== PLAYER)).toBe(true);
      while (w.countdown > 0) stepWorld(w);
      const hearth = w.entities.get(w.hearthId)!;
      const tillers = w.units.filter((u) => u.owner === PLAYER && u.type === 'tiller');
      const thickets = w.resources
        .filter((r) => r.type === 'thicket')
        .sort((a, b) => Math.hypot(a.x - hearth.x, a.y - hearth.y) - Math.hypot(b.x - hearth.x, b.y - hearth.y));
      expect(issueCommand(w, { type: 'smart', unitIds: tillers.map((t) => t.id), x: thickets[0].x, y: thickets[0].y, targetId: thickets[0].id }).ok).toBe(true);
      expect(issueCommand(w, { type: 'train', buildingIds: [w.hearthId], unit: 'tiller', count: 3 }).ok).toBe(true);
      const t0 = performance.now();
      for (let i = 0; i < 90 * TICK_RATE; i++) {
        stepWorld(w);
        drainEvents(w);
      }
      const ms = (performance.now() - t0) / (90 * TICK_RATE);
      expect(ms).toBeLessThan(4);
      expect(w.players[PLAYER].stats.gathered.grain).toBeGreaterThan(100);
      expect(w.players[PLAYER].stats.unitsTrained).toBe(3);
      const r = buildBattleResult(w, 'retreat');
      expect(r.objective).toBe(objective);
      expect(r.time).toBeCloseTo(w.time, 6);
      expect(r.unspent.grain).toBe(Math.floor(w.players[PLAYER].res.grain));
    });
  }
});
