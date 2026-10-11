/**
 * Step 6: the fairness kit (GDD §K, §D placement, §C Vanguard sites, §J caches, modifiers).
 * Orchestrates kit-sites / kit-thickets / kit-seams. Every placement is validated (grass, inside the map, no overlap, 1-tile gap to other
 * footprints, never on a corridor centerline or a muster disc).
 */
import { FAIRNESS_KIT } from '../data/balance';
import { Terrain } from '../sim/types';
import { connectAll } from './connect';
import { type GenCtx, type KitReport, RES_CORRIDOR, RES_MUSTER, RES_PROTECT } from './ctx';
import { TAU } from './geom';
import { countForestRing } from './place';
import { placeCaches, placeHomeSeam } from './kit-seams';
import { placeVanguard, placeWatchtowers } from './kit-sites';
import { placeBountiful, placeMidClusters, placeNearThickets, placeOuterThickets } from './kit-thickets';

export { placeCorridorSeams, placeHoldfastSeam, placePicket } from './kit-seams';
export { midAnchorHoldfast, midAnchorOpen } from './kit-thickets';

export interface KitOptions {
  /** Place contested Seams (and Pickets). Returns their indices into ctx.resources, or null on failure. */
  contested: (ctx: GenCtx) => number[] | null;
  /** Is (x, y) (tile center) a valid mid-map Thicket cluster anchor? */
  midAnchor: (ctx: GenCtx, x: number, y: number) => boolean;
  /** Minimum Chebyshev distance of a mid-cluster anchor from any corridor centerline (default 3). */
  midCenterlineGap?: number;
  caches: boolean;
}

export function placeFairnessKit(ctx: GenCtx, opts: KitOptions): KitReport | null {
  const mods = new Set(ctx.params.modifiers);
  const stamps = ensureForestRing(ctx);
  if (!placeVanguard(ctx)) return ctx.fail('kit: vanguard sites');
  if (mods.has('old_watchtowers') && !placeWatchtowers(ctx)) return ctx.fail('kit: watchtowers');
  const near = placeNearThickets(ctx);
  if (!near) return ctx.fail('kit: near thickets');
  let home = -1;
  if (!mods.has('ember_famine')) {
    const h = placeHomeSeam(ctx);
    if (h === null) return ctx.fail('kit: home seam');
    home = h;
  }
  const outer = placeOuterThickets(ctx);
  if (!outer) return ctx.fail('kit: outer thickets');
  let bountiful: number[] = [];
  if (mods.has('bountiful_wilds')) {
    const b = placeBountiful(ctx);
    if (!b) return ctx.fail('kit: bountiful cluster');
    bountiful = b;
  }
  const contested = opts.contested(ctx);
  if (!contested) return ctx.fail(ctx.failReason || 'kit: contested seams');
  if (opts.caches && !placeCaches(ctx)) return ctx.fail('kit: caches');
  const mid = placeMidClusters(ctx, opts.midAnchor, opts.midCenterlineGap ?? 3);
  if (!mid) return ctx.fail('kit: mid clusters');
  return {
    nearThickets: near,
    outerThickets: outer,
    midClusters: mid,
    bountiful,
    homeSeam: home,
    contested,
    forestRing: 0,
    stamps,
    connectCarves: 0,
  };
}

// ---------------------------------------------------------------------------
// Forest ring
// ---------------------------------------------------------------------------

/**
 * At least 60 forest tiles 6-14 from the Hearth; stamp discs of radius 3-4 at 8-11 tiles if short.
 * `target` adds headroom for later carving. Stamps never touch corridors, anchor clearings,
 * muster discs or tiles next to a footprint.
 */
export function ensureForestRing(ctx: GenCtx, target: number = FAIRNESS_KIT.forest.minTiles + 10): number {
  const F = FAIRNESS_KIT.forest;
  const rng = ctx.rng;
  let stamps = 0;
  for (let tries = 0; tries < 24; tries++) {
    if (countForestRing(ctx.terrain, ctx.w, ctx.h, ctx.hc, F.ringMin, F.ringMax) >= target) break;
    const ang = rng.range(0, TAU);
    const d = rng.range(F.stampMin, F.stampMax);
    const r = rng.int(F.stampRadiusMin, F.stampRadiusMax);
    const cx = ctx.hc.x + Math.cos(ang) * d;
    const cy = ctx.hc.y + Math.sin(ang) * d;
    let changed = 0;
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r); x++) {
        if (!ctx.inBounds(x, y) || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
        const i = ctx.idx(x, y);
        if (ctx.terrain[i] !== Terrain.Grass || ctx.occ[i] !== 0) continue;
        if (ctx.reserve[i] & (RES_CORRIDOR | RES_PROTECT | RES_MUSTER)) continue;
        if (nextToFootprint(ctx, x, y)) continue;
        ctx.terrain[i] = Terrain.Forest;
        changed++;
      }
    }
    if (changed > 0) stamps++;
  }
  return stamps;
}

function nextToFootprint(ctx: GenCtx, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (ctx.inBounds(x + dx, y + dy) && ctx.occ[ctx.idx(x + dx, y + dy)] !== 0) return true;
    }
  }
  return false;
}

/**
 * Step 7 plus the ring rule: connect everything, and if carving ate into the 6-14 forest ring,
 * stamp more forest and reconnect. Returns the number of corridors carved, or null on failure.
 */
export function connectAndSettle(ctx: GenCtx): number | null {
  const F = FAIRNESS_KIT.forest;
  let carves = 0;
  for (let round = 0; round < 4; round++) {
    const c = connectAll(ctx);
    if (c === null) return ctx.fail('connectivity');
    carves += c;
    if (countForestRing(ctx.terrain, ctx.w, ctx.h, ctx.hc, F.ringMin, F.ringMax) >= F.minTiles) return carves;
    ensureForestRing(ctx, F.minTiles + 6);
  }
  return ctx.fail('forest ring');
}
