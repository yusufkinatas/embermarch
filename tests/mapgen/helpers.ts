/**
 * Shared fixtures for the map generator tests: sweep parameters and an independent audit that
 * re-derives the key invariants with deliberately simple code (separate from src/mapgen/validate.ts).
 * Violations are collected and asserted once per map so 100s-of-seeds sweeps stay fast.
 */
import { expect } from 'vitest';
import { Rng } from '../../src/core/rng';
import { CACHES, FAIRNESS_KIT, OBJECTIVE_ANCHORS, THORNSPIRE, nestsFor } from '../../src/data/balance';
import { BIOMES } from '../../src/data/biomes';
import { BUILDINGS } from '../../src/data/buildings';
import { MODIFIER_IDS } from '../../src/data/ids';
import type { MapGenResult } from '../../src/mapgen';
import { anchorFootprints } from '../../src/mapgen';
import { Terrain } from '../../src/sim/types';
import type { BiomeId, MapGenParams, ModifierId, ObjectiveId } from '../../src/sim/types';

const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** Seeds per objective × biome. MAPGEN_SWEEP=full runs the GDD §R 500-seed sweep. */
export const SWEEP_SEEDS = env.MAPGEN_SWEEP === 'full' ? 500 : Number(env.MAPGEN_SEEDS ?? 100);

export const NOISE_BIOMES: BiomeId[] = ['greenmarch', 'fenreach', 'ashwood'];

/** Deterministic sweep parameters: depth cycles 1-6, modifiers are a random subset. */
export function sweepParams(objective: ObjectiveId, biome: BiomeId, i: number): MapGenParams {
  const seed = (Math.imul(i + 1, 2654435761) ^ (biome.length * 977)) >>> 0;
  const r = new Rng(`mods:${objective}:${biome}:${i}`);
  const modifiers: ModifierId[] = objective === 'boss' ? [] : MODIFIER_IDS.filter(() => r.chance(0.3));
  return { seed, objective, biome, depth: objective === 'boss' ? 7 : 1 + (i % 6), modifiers };
}

class Checker {
  readonly problems: string[] = [];
  that(ok: boolean, msg: string): void {
    if (!ok) this.problems.push(msg);
  }
  eq(a: unknown, b: unknown, msg: string): void {
    if (JSON.stringify(a) !== JSON.stringify(b)) this.problems.push(`${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
  between(v: number, lo: number, hi: number, msg: string): void {
    if (!(v >= lo - 1e-9 && v <= hi + 1e-9)) this.problems.push(`${msg}: ${v.toFixed(2)} not in [${lo}, ${hi}]`);
  }
}

/** Independent checks on a generated map. Fails the test (one expect) on any violation. */
export function auditMap(res: MapGenResult, params: MapGenParams): void {
  const c = new Checker();
  auditInto(c, res, params);
  expect(c.problems, `${params.objective}/${params.biome} seed ${params.seed} d${params.depth} [${params.modifiers.join(',')}]`).toEqual([]);
}

interface P {
  x: number;
  y: number;
}
const WALKABLE = new Set<number>([Terrain.Grass, Terrain.Shallows, Terrain.Stump]);

function auditInto(c: Checker, res: MapGenResult, params: MapGenParams): void {
  const { gen, report } = res;
  const { w, h, terrain, treeAmount } = gen.map;
  const rule = OBJECTIVE_ANCHORS[params.objective];
  const a = gen.anchors;
  c.eq(w, rule.size, 'map size');
  c.eq(report.validation.errors, [], 'validation errors');

  // Footprints: in bounds, on grass, no overlaps.
  const feet = anchorFootprints(gen);
  const owner = new Map<number, string>();
  for (const f of feet) {
    for (let y = f.ty; y < f.ty + f.h; y++) {
      for (let x = f.tx; x < f.tx + f.w; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) {
          c.that(false, `${f.label} out of bounds`);
          continue;
        }
        const i = y * w + x;
        c.that(!owner.has(i), `${f.label} overlaps ${owner.get(i)}`);
        owner.set(i, f.label);
        c.that(terrain[i] === Terrain.Grass, `${f.label} not on grass`);
      }
    }
  }

  // Independent BFS from the Hearth over walkable, unoccupied tiles.
  const open = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && !owner.has(y * w + x) && WALKABLE.has(terrain[y * w + x]);
  const ring = (f: { tx: number; ty: number; w: number; h: number }): [number, number][] => {
    const out: [number, number][] = [];
    for (let x = f.tx; x < f.tx + f.w; x++) out.push([x, f.ty - 1], [x, f.ty + f.h]);
    for (let y = f.ty; y < f.ty + f.h; y++) out.push([f.tx - 1, y], [f.tx + f.w, y]);
    return out;
  };
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const [x, y] of ring(feet[0])) {
    if (open(x, y) && !seen[y * w + x]) {
      seen[y * w + x] = 1;
      stack.push(y * w + x);
    }
  }
  while (stack.length) {
    const cur = stack.pop() as number;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (open(nx, ny) && !seen[ny * w + nx]) {
        seen[ny * w + nx] = 1;
        stack.push(ny * w + nx);
      }
    }
  }
  for (const f of feet.slice(1)) {
    c.that(
      ring(f).some(([x, y]) => x >= 0 && y >= 0 && x < w && y < h && seen[y * w + x] === 1),
      `${f.label} unreachable`,
    );
  }
  a.musterPoints.forEach((m, k) => c.that(seen[Math.floor(m.y) * w + Math.floor(m.x)] === 1, `muster${k} unreachable`));

  // Trees carry the biome amount; nothing else carries timber.
  const amount = BIOMES[params.biome].treeAmount;
  let badTrees = 0;
  for (let i = 0; i < w * h; i++) if (treeAmount[i] !== (terrain[i] === Terrain.Forest ? amount : 0)) badTrees++;
  c.eq(badTrees, 0, 'tiles with a wrong tree amount');

  // Nest-side anchors.
  const nests = params.objective === 'boss' ? 3 : nestsFor(params.objective, params.depth);
  c.eq(a.nests.length, nests, 'nests');
  c.eq(a.nestSpires.length, nests, 'nest spires');
  c.eq(a.spareSpires?.length, nests, 'spare spires');
  c.eq(a.musterPoints.length, nests, 'muster points');
  c.eq(a.pickets.length, rule.pickets, 'pickets');
  const nestW = BUILDINGS.thorn_nest.w;
  const nestCenters: P[] = a.nests.map((n) => ({ x: n.tx + nestW / 2, y: n.ty + nestW / 2 }));
  for (const s of [...a.nestSpires, ...(a.spareSpires ?? [])]) {
    const nc = nestCenters[s.nestIndex];
    c.that(Math.hypot(s.tx + 0.5 - nc.x, s.ty + 0.5 - nc.y) <= THORNSPIRE.placeRadius, 'spire too far from its Nest');
  }
  a.musterPoints.forEach((m, k) => c.between(Math.hypot(m.x - nestCenters[k].x, m.y - nestCenters[k].y), 3.5, 6.5, `muster${k} distance`));
  const hc: P = { x: a.hearth.tx + BUILDINGS.hearth.w / 2, y: a.hearth.ty + BUILDINGS.hearth.h / 2 };
  const d = (p: P): number => Math.hypot(p.x - hc.x, p.y - hc.y);

  // Fairness kit (group membership from the kit report, distances re-measured here).
  const K = FAIRNESS_KIT;
  const kit = report.kit;
  const thicket = (i: number): P => {
    const r = a.resources[i];
    c.that(!!r && r.type === 'thicket', `kit index ${i} is not a thicket`);
    return r ? { x: r.tx + 0.5, y: r.ty + 0.5 } : { x: NaN, y: NaN };
  };
  c.eq(kit.nearThickets.length, params.biome === 'ashwood' ? K.nearThickets.ashwoodCount : K.nearThickets.count, 'near thickets');
  for (const i of kit.nearThickets) c.between(d(thicket(i)), K.nearThickets.min, K.nearThickets.max, 'near thicket distance');
  c.eq(kit.outerThickets.length, K.outerThickets.count + (params.biome === 'greenmarch' ? K.outerThickets.greenmarchBonus : 0), 'outer thickets');
  for (const i of kit.outerThickets) c.between(d(thicket(i)), K.outerThickets.min, K.outerThickets.max, 'outer thicket distance');
  c.eq(
    kit.midClusters.map((cl) => cl.length),
    Array.from({ length: K.midThicketClusters.count }, () => K.midThicketClusters.size),
    'mid clusters',
  );
  for (const cl of kit.midClusters) {
    const pts = cl.map(thicket);
    for (const p of pts) for (const q of pts) c.that(Math.hypot(p.x - q.x, p.y - q.y) <= 4, 'mid cluster not compact');
  }
  c.eq(kit.bountiful.length, params.modifiers.includes('bountiful_wilds') ? K.bountiful.count : 0, 'bountiful thickets');
  for (const i of kit.bountiful) c.between(d(thicket(i)), K.bountiful.min, K.bountiful.max, 'bountiful thicket distance');
  const thickets = a.resources.filter((r) => r.type === 'thicket').length;
  c.eq(thickets, kit.nearThickets.length + kit.outerThickets.length + kit.bountiful.length + K.midThicketClusters.count * K.midThicketClusters.size, 'thicket total');
  c.that(kit.forestRing >= K.forest.minTiles, `forest ring ${kit.forestRing}`);

  const seamC = (r: { tx: number; ty: number }): P => ({ x: r.tx + 1, y: r.ty + 1 });
  const homes = a.resources.filter((r) => r.home);
  c.eq(homes.length, params.modifiers.includes('ember_famine') ? 0 : 1, 'home seams');
  for (const r of homes) c.between(d(seamC(r)), K.homeSeam.min, K.homeSeam.max, 'home seam distance');
  const contested = a.resources.filter((r) => r.contested);
  c.eq(contested.length, rule.contestedSeams, 'contested seams');
  for (const r of contested) {
    const nd = Math.min(...nestCenters.map((n) => Math.hypot(n.x - seamC(r).x, n.y - seamC(r).y)));
    if (params.objective === 'holdfast') {
      c.between(d(seamC(r)), K.holdfastSeam.min, K.holdfastSeam.max, 'holdfast seam distance');
      c.that(nd >= K.holdfastSeam.minFromNest, 'holdfast seam too close to a Nest');
    } else if (params.objective !== 'boss') {
      c.between(nd, 10, 16, 'contested seam distance from its Nest');
    }
  }
  for (const p of a.pickets) c.that(!!a.resources[p.seamIndex]?.contested, 'picket guards a non-contested resource');

  // Caches.
  if (rule.caches) {
    const ruined = a.caches.filter((x) => x.type === 'ruined_cache');
    c.eq(ruined.length, params.depth >= CACHES.extraFromDepth ? CACHES.countFromD4 : CACHES.count, 'ruined caches');
    c.eq(a.caches.filter((x) => x.type === 'ancient_cache').length, params.modifiers.includes('ancient_cache') ? 1 : 0, 'ancient caches');
    for (const cache of a.caches) {
      const cc = { x: cache.tx + 0.5, y: cache.ty + 0.5 };
      if (cache.type === 'ruined_cache') c.that(d(cc) >= CACHES.minFromHearth, 'ruined cache too close to the Hearth');
      else c.between(d(cc), CACHES.ancient.minFromHearth, CACHES.ancient.maxFromHearth, 'ancient cache distance');
      for (const nc of nestCenters) c.that(Math.hypot(nc.x - cc.x, nc.y - cc.y) >= CACHES.minFromNest, 'cache too close to a Nest');
    }
  } else {
    c.eq(a.caches.length, 0, 'caches on a cache-less objective');
  }

  // Vanguard sites and Old Watchtowers.
  const V = K.vanguard;
  const site = (p: { tx: number; ty: number }, s: number): number => d({ x: p.tx + s / 2, y: p.ty + s / 2 });
  c.eq(a.vanguard.bowyard, a.vanguard.muster_hall, 'bowyard shares the muster hall site');
  c.between(site(a.vanguard.muster_hall, 3), V.militaryMin, V.militaryMax, 'military site distance');
  c.between(site(a.vanguard.storehouse, 2), V.storehouseMin, V.storehouseMax, 'storehouse site distance');
  c.between(site(a.vanguard.grainplot, 2), V.grainplotMin, V.grainplotMax, 'grainplot site distance');
  const nearestNest = nestCenters.reduce((p, q) => (d(q) < d(p) ? q : p));
  const toNest = Math.atan2(nearestNest.y - hc.y, nearestNest.x - hc.x);
  const facing = (p: { tx: number; ty: number }, s: number): boolean => {
    const ang = Math.atan2(p.ty + s / 2 - hc.y, p.tx + s / 2 - hc.x);
    return Math.cos(ang - toNest) >= -1e-9;
  };
  c.that(facing(a.vanguard.muster_hall, 3), 'military site does not face the nearest Nest');
  c.eq(a.watchtowers.length, params.modifiers.includes('old_watchtowers') ? K.watchtowers.count : 0, 'watchtowers');
  for (const t of a.watchtowers) {
    c.between(site(t, 2), K.watchtowers.min, K.watchtowers.max, 'watchtower distance');
    c.that(facing(t, 2), 'watchtower not toward the nearest Nest');
  }

  // Validation numbers.
  const v = report.validation;
  c.eq(v.nestPaths.length, nests, 'nest path count');
  const nearest = Math.min(...v.nestPaths);
  for (const p of v.nestPaths) c.that(Number.isFinite(p), 'unreachable Nest');
  if (params.objective !== 'boss') {
    c.between(nearest, rule.pathMin, rule.pathMax, 'nearest Nest path');
    c.that(v.walkableFrac >= 0.5, `walkable ${v.walkableFrac.toFixed(2)}`);
    // A walked path is never shorter than the straight line.
    c.that(nearest + 1e-6 >= Math.min(...nestCenters.map(d)) - 0.75, 'path shorter than the straight line');
  }
  c.that(v.reachableTrees >= rule.minReachableTrees, `reachable trees ${v.reachableTrees}`);
}
