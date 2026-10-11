/**
 * Step 7: connectivity. BFS from the Hearth over walkable tiles; every footprint (via an
 * edge-adjacent tile) and every muster point must be reachable, otherwise a 3-wide corridor
 * is carved to it with the step-5 terrain costs. Briar walls are never carved.
 */
import { MAPGEN } from '../data/balance';
import { Terrain } from '../sim/types';
import type { GenCtx } from './ctx';
import { astar, edgeRing, floodFill } from './paths';
import { carveCost, carvePath, centerTile } from './place';

export function reachFromHearth(ctx: GenCtx): Uint8Array {
  const h = ctx.hearth;
  if (!h) return new Uint8Array(ctx.n);
  return floodFill(ctx.w, ctx.h, (i) => ctx.walkable(i), edgeRing(ctx.w, ctx.h, h.tx, h.ty, h.w, h.h));
}

interface Target {
  goals: number[];
  hx: number;
  hy: number;
}

function firstUnreachable(ctx: GenCtx, reach: Uint8Array): Target | null {
  for (const f of ctx.feet) {
    if (f.kind === 'hearth') continue;
    const ring = edgeRing(ctx.w, ctx.h, f.tx, f.ty, f.w, f.h);
    if (ring.some((i) => reach[i])) continue;
    const goals = ring.filter((i) => ctx.occ[i] === 0 && ctx.terrain[i] !== Terrain.BriarWall);
    return { goals, hx: f.tx + Math.floor(f.w / 2), hy: f.ty + Math.floor(f.h / 2) };
  }
  for (const m of ctx.musterPoints) {
    const i = ctx.idx(Math.floor(m.x), Math.floor(m.y));
    if (!reach[i]) return { goals: [i], hx: Math.floor(m.x), hy: Math.floor(m.y) };
  }
  return null;
}

/** Returns the number of corridors carved, or null if something could not be connected. */
export function connectAll(ctx: GenCtx): number | null {
  const hearth = ctx.hearth;
  if (!hearth) return null;
  const start = centerTile(ctx, hearth);
  let carves = 0;
  for (let round = 0; round < 24; round++) {
    const target = firstUnreachable(ctx, reachFromHearth(ctx));
    if (!target) return carves;
    if (target.goals.length === 0) return null;
    const goalSet = new Set(target.goals);
    const res = astar({
      w: ctx.w,
      h: ctx.h,
      start,
      isGoal: (i) => goalSet.has(i),
      hx: target.hx,
      hy: target.hy,
      noCornerCut: true,
      cost: (i) => {
        const f = ctx.footAt(i);
        if (f) return f === hearth ? 1 : Infinity;
        return carveCost(ctx.terrain[i]);
      },
    });
    if (!res) return null;
    carvePath(ctx, res.path, Math.floor(MAPGEN.corridorWidth / 2), false);
    carves++;
  }
  return null;
}
