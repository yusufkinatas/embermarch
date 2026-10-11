/**
 * Terrain base layers (GDD §K steps 1-2 and the fallback template).
 * Noise: three independent 2-octave simplex fields (water, forest, rock), each with its own
 * derived seed. Thresholds are quantiles so coverage is exact before smoothing.
 */
import { createNoise2D } from 'simplex-noise';
import type { Rng } from '../core/rng';
import { MAPGEN } from '../data/balance';
import type { BiomeDef } from '../data/types';
import { Terrain } from '../sim/types';

/** 0.65·N(x/14, y/14) + 0.35·N(x/6, y/6) with an independent noise function per field. */
export function noiseField(rng: Rng, w: number, h: number): Float32Array {
  const noise = createNoise2D(() => rng.next());
  const out = new Float32Array(w * h);
  const { noiseScaleA: sA, noiseScaleB: sB, noiseWeightA: wA, noiseWeightB: wB } = MAPGEN;
  // The second octave samples a far-away region of the same function so the octaves decorrelate.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = wA * noise(x / sA, y / sA) + wB * noise(x / sB + 71.3, y / sB - 39.7);
    }
  }
  return out;
}

/** Tile indices sorted by field value (ascending), ties by index (stable, deterministic). */
export function sortedIndices(vals: Float32Array): number[] {
  const idx = Array.from({ length: vals.length }, (_, i) => i);
  idx.sort((a, b) => vals[a] - vals[b] || a - b);
  return idx;
}

/** Pre-sorted orders of the three noise fields (computed once per attempt). */
export interface FieldOrders {
  /** Water field ascending. */
  water: number[];
  /** Forest / rock fields ascending (assigned from the top). */
  forest: number[];
  rock: number[];
}

/**
 * Quantile classification. Water takes the lowest `water` share of wN, Shallows the next 4
 * percentile points, Forest the highest `forest` share of fN among the rest, Rock the highest
 * `rock` share of rN among what remains. Everything else is grass.
 */
export function classifyTerrain(n: number, orders: FieldOrders, cover: { water: number; forest: number; rock: number }): Uint8Array {
  const t = new Uint8Array(n); // Grass = 0
  const nWater = Math.round(cover.water * n);
  const nShallow = cover.water > 0 ? Math.round(MAPGEN.shallowsBand * n) : 0;
  for (let k = 0; k < nWater + nShallow && k < n; k++) t[orders.water[k]] = k < nWater ? Terrain.Water : Terrain.Shallows;
  assignTop(t, orders.forest, Math.round(cover.forest * n), Terrain.Forest);
  assignTop(t, orders.rock, Math.round(cover.rock * n), Terrain.Rock);
  return t;
}

function assignTop(t: Uint8Array, order: number[], count: number, value: number): void {
  let left = count;
  for (let k = order.length - 1; k >= 0 && left > 0; k--) {
    const i = order[k];
    if (t[i] !== Terrain.Grass) continue;
    t[i] = value;
    left--;
  }
}

/** Cellular automaton on forest: a grass/forest tile is forest iff >= threshold of its 8 neighbours are. */
export function forestAutomaton(t: Uint8Array, w: number, h: number, passes: number, threshold: number): void {
  for (let p = 0; p < passes; p++) {
    const src = t.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const cur = src[i];
        if (cur !== Terrain.Grass && cur !== Terrain.Forest) continue;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            if (src[yy * w + xx] === Terrain.Forest) c++;
          }
        }
        t[i] = c >= threshold ? Terrain.Forest : Terrain.Grass;
      }
    }
  }
}

/** Water tiles with no orthogonal water neighbour become Shallows. */
export function removeSingleWater(t: Uint8Array, w: number, h: number): void {
  const src = t.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i] !== Terrain.Water) continue;
      const lone =
        (x === 0 || src[i - 1] !== Terrain.Water) &&
        (x === w - 1 || src[i + 1] !== Terrain.Water) &&
        (y === 0 || src[i - w] !== Terrain.Water) &&
        (y === h - 1 || src[i + w] !== Terrain.Water);
      if (lone) t[i] = Terrain.Shallows;
    }
  }
}

/**
 * Steps 1-2: noise fields, quantile thresholds, forest smoothing, single-water removal.
 * The automaton erodes thin forest, so the forest quantile is calibrated (bisection on the
 * pre-smoothing share) until the smoothed forest coverage matches the biome's forest share.
 */
export function noiseTerrain(rng: Rng, w: number, h: number, biome: BiomeDef): Uint8Array {
  const n = w * h;
  const orders: FieldOrders = {
    water: sortedIndices(noiseField(rng.fork('noise:water'), w, h)),
    forest: sortedIndices(noiseField(rng.fork('noise:forest'), w, h)),
    rock: sortedIndices(noiseField(rng.fork('noise:rock'), w, h)),
  };
  const target = biome.forest;
  let lo = target;
  let hi = Math.min(0.9, target * 2 + 0.1);
  let best: Uint8Array | null = null;
  let bestErr = Infinity;
  for (let it = 0; it < 8; it++) {
    const share = it === 0 ? target : (lo + hi) / 2;
    const t = classifyTerrain(n, orders, { water: biome.water, forest: share, rock: biome.rock });
    forestAutomaton(t, w, h, MAPGEN.forestCaPasses, MAPGEN.forestCaThreshold);
    let forest = 0;
    for (let i = 0; i < n; i++) if (t[i] === Terrain.Forest) forest++;
    const cov = forest / n;
    const e = Math.abs(cov - target);
    if (e < bestErr) {
      bestErr = e;
      best = t;
    }
    if (e < 0.004 || target <= 0) break;
    if (cov < target) lo = share;
    else hi = share;
  }
  const t = best as Uint8Array;
  removeSingleWater(t, w, h);
  return t;
}

/**
 * Fallback template: all grass, a forest band around the border, forest discs at fixed
 * fractions of the map. Anchor clearings later override any disc under the Hearth.
 */
export function fallbackTerrain(w: number, h: number): Uint8Array {
  const t = new Uint8Array(w * h);
  const { borderBand, discRadius, discs } = MAPGEN.fallback;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge < borderBand) t[y * w + x] = Terrain.Forest;
    }
  }
  for (const [fx, fy] of discs) {
    const cx = fx * w;
    const cy = fy * h;
    for (let y = Math.floor(cy - discRadius); y <= Math.ceil(cy + discRadius); y++) {
      for (let x = Math.floor(cx - discRadius); x <= Math.ceil(cx + discRadius); x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= discRadius) t[y * w + x] = Terrain.Forest;
      }
    }
  }
  return t;
}
