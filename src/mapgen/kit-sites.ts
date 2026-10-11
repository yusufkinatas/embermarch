/** Fairness kit: Vanguard building sites (§C) and Old Watchtowers (§K modifier). */
import { FAIRNESS_KIT } from '../data/balance';
import { BUILDINGS } from '../data/buildings';
import { Terrain } from '../sim/types';
import type { GenCtx } from './ctx';
import { angleDiff } from './geom';
import { type Spot, canPlace, nestsFar, place, rankSpots, ringSpots } from './place';

const MILITARY_W = Math.max(BUILDINGS.muster_hall.w, BUILDINGS.bowyard.w);
const MILITARY_H = Math.max(BUILDINGS.muster_hall.h, BUILDINGS.bowyard.h);
const DEG = Math.PI / 180;
/** Tower range 7 + guard ring + footprint slack: closer than this, a tower engages standing guards at 0:00. */
export const TOWER_QUIET = 12.5;

/**
 * Muster Hall / Bowyard site 6-8 tiles from the Hearth facing the nearest Nest, Storehouse at the
 * nearest forest edge 6-12 tiles out, Grainplot 4-6 tiles out. All three are reserved.
 */
export function placeVanguard(ctx: GenCtx): boolean {
  const V = FAIRNESS_KIT.vanguard;
  const nestDir = ctx.nearestNestAngle();
  const hc = ctx.hc;

  // Muster Hall / Bowyard: 6-8 tiles from the Hearth on the side facing the nearest Nest.
  const mil = rankSpots(
    ctx,
    ringSpots(ctx, hc, V.militaryMin, V.militaryMax, MILITARY_W, MILITARY_H).filter(
      (s) => Math.abs(angleDiff(s.ang, nestDir)) <= 75 * DEG,
    ),
    (s) => Math.abs(angleDiff(s.ang, nestDir)),
    0.35,
  );
  const milPick = firstPlaceable(ctx, mil, MILITARY_W, MILITARY_H);
  if (!milPick) return false;
  place(ctx, 'military', milPick.s.tx, milPick.s.ty, MILITARY_W, MILITARY_H, milPick.clear);

  // Storehouse: at the nearest forest edge 6-12 tiles from the Hearth.
  const sw = BUILDINGS.storehouse.w;
  const sh = BUILDINGS.storehouse.h;
  const sto = ringSpots(ctx, hc, V.storehouseMin, V.storehouseMax, sw, sh);
  let stoPick: { s: Spot; clear: boolean } | null = null;
  for (const clear of [false, true]) {
    let best = Infinity;
    for (const s of sto) {
      if (!canPlace(ctx, s.tx, s.ty, sw, sh, { clear })) continue;
      const adj = forestAround(ctx, s.tx - 1, s.ty - 1, sw + 2, sh + 2);
      if (adj === 0) continue;
      const mass = forestWithin(ctx, s.cx, s.cy, 4.5);
      if (mass < 8) continue;
      const score = s.d + ctx.rng.next() * 0.5;
      if (score < best) {
        best = score;
        stoPick = { s, clear };
      }
    }
    if (stoPick) break;
  }
  if (!stoPick) {
    // No real forest edge in range: take the spot with the most forest nearby.
    let bestMass = -1;
    for (const s of sto) {
      if (!canPlace(ctx, s.tx, s.ty, sw, sh, { clear: true })) continue;
      const mass = forestWithin(ctx, s.cx, s.cy, 5.5) + ctx.rng.next() * 0.5;
      if (mass > bestMass) {
        bestMass = mass;
        stoPick = { s, clear: true };
      }
    }
  }
  if (!stoPick) return false;
  place(ctx, 'storehouse', stoPick.s.tx, stoPick.s.ty, sw, sh, stoPick.clear);

  // Grainplot: 4-6 tiles from the Hearth, preferably away from the nearest Nest.
  const gw = BUILDINGS.grainplot.w;
  const gh = BUILDINGS.grainplot.h;
  const gp = firstPlaceable(
    ctx,
    rankSpots(
      ctx,
      ringSpots(ctx, hc, V.grainplotMin, V.grainplotMax, gw, gh),
      (s) => (Math.abs(angleDiff(s.ang, nestDir)) < Math.PI / 2 ? 1 : 0),
      0.9,
    ),
    gw,
    gh,
  );
  if (!gp) return false;
  place(ctx, 'grainplot', gp.s.tx, gp.s.ty, gw, gh, gp.clear);

  ctx.vanguard = {
    military: { tx: milPick.s.tx, ty: milPick.s.ty },
    storehouse: { tx: stoPick.s.tx, ty: stoPick.s.ty },
    grainplot: { tx: gp.s.tx, ty: gp.s.ty },
  };
  return true;
}

/** First ranked spot placeable on grass, else the first placeable after clearing forest/rock. */
export function firstPlaceable(ctx: GenCtx, ranked: Spot[], w: number, h: number): { s: Spot; clear: boolean } | null {
  for (const clear of [false, true]) {
    const s = ranked.find((r) => canPlace(ctx, r.tx, r.ty, w, h, { clear }));
    if (s) return { s, clear };
  }
  return null;
}

function forestAround(ctx: GenCtx, x0: number, y0: number, w: number, h: number): number {
  let n = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (ctx.inBounds(x, y) && ctx.terrain[ctx.idx(x, y)] === Terrain.Forest) n++;
    }
  }
  return n;
}

function forestWithin(ctx: GenCtx, cx: number, cy: number, r: number): number {
  let n = 0;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (!ctx.inBounds(x, y) || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
      if (ctx.terrain[ctx.idx(x, y)] === Terrain.Forest) n++;
    }
  }
  return n;
}

/** Old Watchtowers: 2 Brazier Tower sites 7-9 tiles from the Hearth toward the nearest Nest, flanking the approach. */
export function placeWatchtowers(ctx: GenCtx): boolean {
  const W = FAIRNESS_KIT.watchtowers;
  const tw = BUILDINGS.brazier_tower.w;
  const th = BUILDINGS.brazier_tower.h;
  const nestDir = ctx.nearestNestAngle();
  const spots = ringSpots(ctx, ctx.hc, W.min, W.max, tw, th).filter((s) => {
    const a = Math.abs(angleDiff(s.ang, nestDir));
    return a >= 5 * DEG && a <= 90 * DEG;
  });
  // Prefer sites out of reach of Nest garrisons and Beacon guards so the towers do not start a fight at 0:00.
  const garrisonPenalty = (s: Spot): number =>
    nestsFar(ctx, s.cx, s.cy, TOWER_QUIET) && ctx.beacons.every((b) => Math.hypot(b.tx + b.w / 2 - s.cx, b.ty + b.h / 2 - s.cy) >= TOWER_QUIET) ? 0 : 5;
  const chosen: Spot[] = [];
  for (const side of [1, -1]) {
    const ranked = rankSpots(
      ctx,
      spots.filter((s) => Math.sign(angleDiff(s.ang, nestDir)) === side),
      (s) => Math.abs(Math.abs(angleDiff(s.ang, nestDir)) - 35 * DEG) + garrisonPenalty(s),
      0.3,
    );
    const pick = firstPlaceable(ctx, ranked, tw, th);
    // A flank that can only offer a site next to enemy guards is left to the fill-up below.
    if (pick && garrisonPenalty(pick.s) === 0) {
      place(ctx, 'watchtower', pick.s.tx, pick.s.ty, tw, th, pick.clear);
      chosen.push(pick.s);
    }
  }
  while (chosen.length < W.count) {
    const pick = firstPlaceable(
      ctx,
      rankSpots(ctx, spots, (s) => Math.abs(angleDiff(s.ang, nestDir)) + garrisonPenalty(s), 0.3).filter((s) =>
        chosen.every((c) => Math.hypot(c.cx - s.cx, c.cy - s.cy) >= 4),
      ),
      tw,
      th,
    );
    if (!pick) return false;
    place(ctx, 'watchtower', pick.s.tx, pick.s.ty, tw, th, pick.clear);
    chosen.push(pick.s);
  }
  for (const c of chosen) ctx.watchtowers.push({ tx: c.tx, ty: c.ty });
  return true;
}
