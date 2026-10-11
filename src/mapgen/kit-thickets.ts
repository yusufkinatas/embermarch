/** Fairness kit: Thicket clusters (near, outer, Bountiful Wilds, mid-map). */
import { FAIRNESS_KIT } from '../data/balance';
import { RESOURCE_NODES } from '../data/resources';
import { Terrain } from '../sim/types';
import { type GenCtx, isWalkableTerrain } from './ctx';
import { type Pt, angleDiff } from './geom';
import { type Spot, addResource, canPlace, centerlineField, nestsFar, place, rankSpots, ringSpots } from './place';

const THICKET = RESOURCE_NODES.thicket;

/**
 * Grow a cluster of `count` 1×1 Thickets inside `spots`, starting from the best-ranked seed.
 * Members may touch each other but keep a 1-tile gap to everything else, and each keeps at
 * least one free walkable edge neighbour so it can be gathered.
 */
function growCluster(ctx: GenCtx, spots: Spot[], seeds: Spot[], count: number, clear: boolean): Spot[] | null {
  for (let t = 0; t < Math.min(seeds.length, 24); t++) {
    const seed = seeds[t];
    if (!canPlace(ctx, seed.tx, seed.ty, 1, 1, { clear })) continue;
    const chosen: Spot[] = [seed];
    const chosenSet = new Set<number>([ctx.idx(seed.tx, seed.ty)]);
    const excluded = new Set<number>();
    while (chosen.length < count) {
      let best: Spot | null = null;
      let bestScore = Infinity;
      for (const s of spots) {
        const i = ctx.idx(s.tx, s.ty);
        if (chosenSet.has(i) || excluded.has(i)) continue;
        let near = false;
        let edgeAdj = 0;
        for (const c of chosen) {
          const dx = Math.abs(c.tx - s.tx);
          const dy = Math.abs(c.ty - s.ty);
          if (dx <= 1 && dy <= 1) near = true;
          if (dx + dy === 1) edgeAdj++;
        }
        if (!near || !canPlace(ctx, s.tx, s.ty, 1, 1, { clear })) continue;
        const score = Math.hypot(s.cx - seed.cx, s.cy - seed.cy) + 0.7 * edgeAdj + ctx.rng.next() * 0.6;
        if (score < bestScore) {
          bestScore = score;
          best = s;
        }
      }
      if (!best) break;
      const bi = ctx.idx(best.tx, best.ty);
      chosenSet.add(bi);
      chosen.push(best);
      if (!clusterAccessible(ctx, chosen, chosenSet)) {
        chosen.pop();
        chosenSet.delete(bi);
        excluded.add(bi);
      }
    }
    if (chosen.length === count) return chosen;
  }
  return null;
}

function clusterAccessible(ctx: GenCtx, chosen: Spot[], set: Set<number>): boolean {
  for (const c of chosen) {
    let free = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = c.tx + dx;
      const y = c.ty + dy;
      if (!ctx.inBounds(x, y)) continue;
      const i = ctx.idx(x, y);
      if (set.has(i) || ctx.occ[i] !== 0) continue;
      const t = ctx.terrain[i];
      if (isWalkableTerrain(t) || t === Terrain.Forest) free++;
    }
    if (free === 0) return false;
  }
  return true;
}

function commitThickets(ctx: GenCtx, spots: Spot[], clear: boolean): number[] {
  return spots.map((s) => {
    place(ctx, 'thicket', s.tx, s.ty, THICKET.w, THICKET.h, clear);
    return addResource(ctx, s, 'thicket', THICKET.amount);
  });
}

/** Cluster in a distance band around c, seeded preferably toward `prefAngle`. */
function bandCluster(ctx: GenCtx, c: Pt, rMin: number, rMax: number, count: number, prefAngle: number | null): number[] | null {
  const spots = ringSpots(ctx, c, rMin, rMax, THICKET.w, THICKET.h);
  for (const clear of [false, true]) {
    const seeds = rankSpots(
      ctx,
      spots.filter((s) => canPlace(ctx, s.tx, s.ty, 1, 1, { clear })),
      (s) => (prefAngle === null ? 0 : Math.abs(angleDiff(s.ang, prefAngle))),
      prefAngle === null ? 1 : 1.2,
    );
    const cl = growCluster(ctx, spots, seeds, count, clear);
    if (cl) return commitThickets(ctx, cl, clear);
  }
  return null;
}

/** 6 Thickets (Ashwood 4) in one cluster 4-7 tiles from the Hearth, preferably behind it. */
export function placeNearThickets(ctx: GenCtx): number[] | null {
  const N = FAIRNESS_KIT.nearThickets;
  const count = ctx.params.biome === 'ashwood' ? N.ashwoodCount : N.count;
  return bandCluster(ctx, ctx.hc, N.min, N.max, count, ctx.nearestNestAngle() + Math.PI);
}

/** Bountiful Wilds: a second cluster of 6 at 7-10 tiles, to the side of the approach. */
export function placeBountiful(ctx: GenCtx): number[] | null {
  const B = FAIRNESS_KIT.bountiful;
  const side = ctx.nearestNestAngle() + (ctx.rng.chance(0.5) ? 1 : -1) * (Math.PI / 2);
  return bandCluster(ctx, ctx.hc, B.min, B.max, B.count, side);
}

/** 3 outer Thickets (Greenmarch +2) at 9-13 tiles, spread around the Hearth. */
export function placeOuterThickets(ctx: GenCtx): number[] | null {
  const O = FAIRNESS_KIT.outerThickets;
  const count = O.count + (ctx.params.biome === 'greenmarch' ? O.greenmarchBonus : 0);
  const spots = ringSpots(ctx, ctx.hc, O.min, O.max, THICKET.w, THICKET.h);
  const chosen: Spot[] = [];
  const passes: { clear: boolean; minAng: number }[] = [
    { clear: false, minAng: Math.PI / count },
    { clear: false, minAng: 0 },
    { clear: true, minAng: 0 },
  ];
  for (const pass of passes) {
    for (const s of ctx.rng.shuffle(spots.slice())) {
      if (chosen.length === count) break;
      if (!chosen.every((c) => Math.hypot(c.cx - s.cx, c.cy - s.cy) >= 3 && Math.abs(angleDiff(c.ang, s.ang)) >= pass.minAng)) continue;
      if (!canPlace(ctx, s.tx, s.ty, 1, 1, { gap: 1, clear: pass.clear })) continue;
      place(ctx, 'thicket', s.tx, s.ty, 1, 1, pass.clear);
      chosen.push(s);
    }
  }
  if (chosen.length < count) return null;
  return chosen.map((s) => addResource(ctx, s, 'thicket', THICKET.amount));
}

/** 2 mid-map clusters of 3 Thickets, >= 10 apart, off the corridors. */
export function placeMidClusters(ctx: GenCtx, isAnchor: (ctx: GenCtx, x: number, y: number) => boolean, gap: number): number[][] | null {
  const M = FAIRNESS_KIT.midThicketClusters;
  const field = centerlineField(ctx);
  const anchors: Pt[] = [];
  for (let y = 2; y < ctx.h - 2; y++) {
    for (let x = 2; x < ctx.w - 2; x++) {
      if (field[ctx.idx(x, y)] < gap) continue;
      if (!isAnchor(ctx, x + 0.5, y + 0.5)) continue;
      anchors.push({ x: x + 0.5, y: y + 0.5 });
    }
  }
  const out: number[][] = [];
  const used: Pt[] = [];
  for (const clear of [false, true]) {
    let tries = 0;
    for (const a of ctx.rng.shuffle(anchors.slice())) {
      if (out.length === M.count || tries++ > 120) break;
      if (!used.every((u) => Math.hypot(u.x - a.x, u.y - a.y) >= 10)) continue;
      const spots = ringSpots(ctx, a, 0, 1.6, THICKET.w, THICKET.h);
      const seeds = rankSpots(ctx, spots, (s) => s.d, 0.3);
      const cl = growCluster(ctx, spots, seeds, M.size, clear);
      if (!cl) continue;
      out.push(commitThickets(ctx, cl, clear));
      used.push(a);
    }
    if (out.length === M.count) return out;
  }
  return null;
}

/** Mid-map anchor rule for the corner / edge objectives: near the map center, away from Hearth and Nests. */
export function midAnchorOpen(ctx: GenCtx, x: number, y: number): boolean {
  const S = ctx.w;
  if (Math.hypot(x - S / 2, y - S / 2) > S / 4) return false;
  if (Math.hypot(x - ctx.hc.x, y - ctx.hc.y) < 14) return false;
  return nestsFar(ctx, x, y, 8);
}

/** Holdfast mid-map: the band between the Hearth's economy ring and the Nests (11-16 tiles). */
export function midAnchorHoldfast(ctx: GenCtx, x: number, y: number): boolean {
  const d = Math.hypot(x - ctx.hc.x, y - ctx.hc.y);
  return d >= 11 && d <= 16 && nestsFar(ctx, x, y, 8);
}
