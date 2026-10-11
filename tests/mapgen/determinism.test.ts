/** Determinism, variation, fallback, terrain coverage and debug helpers of the map generator. */
import { describe, expect, it } from 'vitest';
import { MAPGEN, OBJECTIVE_ANCHORS } from '../../src/data/balance';
import { BIOMES } from '../../src/data/biomes';
import { ASCII_LEGEND, checkMap, generateAttempt, generateMap, generateMapDetailed, mapToAscii } from '../../src/mapgen';
import { Rng } from '../../src/core/rng';
import { classifyTerrain, fallbackTerrain, noiseTerrain, sortedIndices, noiseField } from '../../src/mapgen/terrain';
import { Terrain } from '../../src/sim/types';
import type { MapGenParams, ObjectiveId } from '../../src/sim/types';
import { auditMap } from './helpers';

const OBJECTIVES: ObjectiveId[] = ['raze', 'elite', 'holdfast', 'beacons', 'boss'];
const base = (objective: ObjectiveId, seed: number): MapGenParams => ({
  seed,
  objective,
  biome: objective === 'boss' ? 'heartwood' : 'fenreach',
  depth: 5,
  modifiers: objective === 'boss' ? [] : ['ancient_cache', 'old_watchtowers', 'bountiful_wilds'],
});

describe('determinism', () => {
  for (const objective of OBJECTIVES) {
    it(`${objective}: same seed gives identical arrays and anchors`, () => {
      const a = generateMap(base(objective, 1234));
      const b = generateMap(base(objective, 1234));
      expect(Array.from(a.map.terrain)).toEqual(Array.from(b.map.terrain));
      expect(Array.from(a.map.treeAmount)).toEqual(Array.from(b.map.treeAmount));
      expect(Array.from(a.map.variant)).toEqual(Array.from(b.map.variant));
      expect(a.anchors).toEqual(b.anchors);
      expect(a.attempts).toBe(b.attempts);
      expect(a.seed).toBe(1234);
    });

    it(`${objective}: different seeds give different maps`, () => {
      const seen = new Set<string>();
      for (let s = 1; s <= 6; s++) {
        const g = generateMap(base(objective, s * 101));
        seen.add(`${JSON.stringify(g.anchors)}|${Array.from(g.map.terrain).join('')}`);
      }
      expect(seen.size).toBe(6);
    });
  }

  it('does not depend on Math.random', () => {
    const orig = Math.random;
    try {
      Math.random = () => 0.5;
      const a = generateMap(base('raze', 77));
      Math.random = () => 0.123;
      const b = generateMap(base('raze', 77));
      expect(Array.from(a.map.terrain)).toEqual(Array.from(b.map.terrain));
      expect(a.anchors).toEqual(b.anchors);
    } finally {
      Math.random = orig;
    }
  });

  it('variant bytes cover the cosmetic range', () => {
    const g = generateMap(base('raze', 5));
    const v = Array.from(g.map.variant);
    expect(Math.min(...v)).toBeLessThan(10);
    expect(Math.max(...v)).toBeGreaterThan(245);
  });
});

describe('terrain layers', () => {
  it('quantile thresholds give exact water / shallows / rock coverage before smoothing', () => {
    const w = 56;
    const n = w * w;
    const rng = new Rng(9);
    const orders = {
      water: sortedIndices(noiseField(rng.fork('w'), w, w)),
      forest: sortedIndices(noiseField(rng.fork('f'), w, w)),
      rock: sortedIndices(noiseField(rng.fork('r'), w, w)),
    };
    const biome = BIOMES.greenmarch;
    const t = classifyTerrain(n, orders, biome);
    const count = (k: number): number => t.filter((x) => x === k).length;
    expect(count(Terrain.Water)).toBe(Math.round(biome.water * n));
    expect(count(Terrain.Shallows)).toBe(Math.round(MAPGEN.shallowsBand * n));
    expect(count(Terrain.Forest)).toBe(Math.round(biome.forest * n));
    expect(count(Terrain.Rock)).toBe(Math.round(biome.rock * n));
  });

  it('smoothed forest coverage is calibrated to the biome share; no lone water tiles', () => {
    for (const id of ['greenmarch', 'fenreach', 'ashwood'] as const) {
      const w = 56;
      const t = noiseTerrain(new Rng(`cov:${id}`), w, w, BIOMES[id]);
      const forest = t.filter((x) => x === Terrain.Forest).length / (w * w);
      expect(Math.abs(forest - BIOMES[id].forest), id).toBeLessThan(0.02);
      for (let y = 0; y < w; y++) {
        for (let x = 0; x < w; x++) {
          if (t[y * w + x] !== Terrain.Water) continue;
          const nb = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ].filter(([a, b]) => a >= 0 && b >= 0 && a < w && b < w && t[b * w + a] === Terrain.Water);
          expect(nb.length, `lone water at ${x},${y}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('fallback template: forest border band and three discs', () => {
    const t = fallbackTerrain(56, 56);
    expect(t[0]).toBe(Terrain.Forest);
    expect(t[2 * 56 + 30]).toBe(Terrain.Forest);
    expect(t[3 * 56 + 30]).toBe(Terrain.Grass);
    expect(t[28 * 56 + 28]).toBe(Terrain.Forest);
    expect(t[Math.floor(0.7 * 56) * 56 + Math.floor(0.3 * 56)]).toBe(Terrain.Forest);
    expect(t[10 * 56 + 40]).toBe(Terrain.Grass);
  });
});

describe('fallback and retries', () => {
  for (const objective of ['raze', 'holdfast', 'beacons', 'elite'] as ObjectiveId[]) {
    it(`${objective}: the fallback template produces valid maps`, () => {
      let ok = 0;
      for (let sub = 0; sub < 12; sub++) {
        const params = base(objective, 4242 + sub);
        const { result } = generateAttempt(params, sub, true);
        if (result && result.report.validation.ok) {
          ok++;
          auditMap(result, params);
        }
      }
      expect(ok).toBeGreaterThanOrEqual(9);
    });
  }

  it('reports attempts and never needs the fallback on ordinary seeds', () => {
    for (let s = 0; s < 20; s++) {
      const g = generateMap({ seed: s, objective: 'holdfast', biome: 'greenmarch', depth: 2, modifiers: [] });
      expect(g.attempts).toBeGreaterThanOrEqual(1);
      expect(g.attempts).toBeLessThanOrEqual(MAPGEN.maxAttempts);
      expect(g.usedFallback).toBe(false);
    }
  });

  it('checkMap flags a broken map', () => {
    const res = generateMapDetailed(base('raze', 31));
    const broken = structuredClone(res.gen);
    broken.anchors.resources[0].tx = broken.anchors.hearth.tx;
    broken.anchors.resources[0].ty = broken.anchors.hearth.ty;
    expect(checkMap(broken, base('raze', 31)).ok).toBe(false);
  });

  it('map sizes follow the objective table', () => {
    for (const objective of OBJECTIVES) {
      expect(generateMap(base(objective, 3)).map.w).toBe(OBJECTIVE_ANCHORS[objective].size);
    }
  });
});

describe('ascii debug helper', () => {
  it('renders one char per tile with anchors overlaid', () => {
    const g = generateMap(base('raze', 8));
    const s = mapToAscii(g);
    const rows = s.split('\n');
    expect(rows.length).toBe(g.map.h);
    expect(rows.every((r) => r.length === g.map.w)).toBe(true);
    expect((s.match(/H/g) ?? []).length).toBe(16);
    expect((s.match(/N/g) ?? []).length).toBe(9 * g.anchors.nests.length);
    expect(s).toContain('*');
    expect(mapToAscii(g, { legend: true })).toContain(ASCII_LEGEND.H);
    const boss = mapToAscii(generateMap(base('boss', 8)));
    expect(boss).toContain('#');
    expect((boss.match(/R/g) ?? []).length).toBe(25);
  });
});
