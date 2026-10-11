/** GDD §K/§R generator sweep for the beacons objective (MAPGEN_SWEEP=full for 500 seeds). */
import { describe, expect, it } from 'vitest';
import { generateMapDetailed } from '../../src/mapgen';
import { NOISE_BIOMES, SWEEP_SEEDS, auditMap, sweepParams } from './helpers';

describe('beacons sweep', () => {
  for (const biome of NOISE_BIOMES) {
    it(`${biome}: ${SWEEP_SEEDS} seeds validate with every key point reachable`, () => {
      let fallbacks = 0;
      for (let i = 0; i < SWEEP_SEEDS; i++) {
        const params = sweepParams('beacons', biome, i);
        const res = generateMapDetailed(params);
        if (res.gen.usedFallback) fallbacks++;
        auditMap(res, params);
      }
      // GDD §R: anchors succeed without the fallback in >= 95% of seeds (asserted for every objective).
      expect(fallbacks / SWEEP_SEEDS).toBeLessThanOrEqual(0.05);
    }, 120_000);
  }
});
