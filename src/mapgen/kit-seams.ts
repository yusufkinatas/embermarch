/** Fairness kit: home and contested Ember Seams, Bramble Pickets (§K step 6) and Caches (§J). */
import { CACHES, FAIRNESS_KIT, MAPGEN, cacheCount } from '../data/balance';
import { BUILDINGS } from '../data/buildings';
import { RESOURCE_NODES, SEAM_AMOUNTS } from '../data/resources';
import type { GenCtx } from './ctx';
import { type Pt, SQRT2, angleDiff, rectCenter } from './geom';
import { TOWER_QUIET } from './kit-sites';
import { type Spot, addResource, canPlace, centerlineField, clearDisc, nestsFar, place, rankSpots, ringSpots } from './place';

const SEAM = RESOURCE_NODES.ember_seam;
const SPIRE = BUILDINGS.thornspire;
const CACHE = BUILDINGS.ruined_cache;
const DEG = Math.PI / 180;

/** Keep the home Seam out of Nest garrison aggro and Blight (Holdfast caps Blight at 8). */
const HOME_SEAM_NEST_CLEAR = 12;

/**
 * Home Ember Seam (2×2) at 8-11 tiles, preferably not on the approach to the nearest Nest and
 * never within reach of any Nest's garrison or Blight when another spot exists (Holdfast Nests sit
 * only 17-23 tiles from the Hearth, so a careless pick can land 7 tiles from a Nest).
 */
export function placeHomeSeam(ctx: GenCtx): number | null {
  const H = FAIRNESS_KIT.homeSeam;
  const nestDir = ctx.nearestNestAngle();
  const spots = ringSpots(ctx, ctx.hc, H.min, H.max, SEAM.w, SEAM.h);
  const score = (s: (typeof spots)[number]): number =>
    (Math.abs(angleDiff(s.ang, nestDir)) < 60 * DEG ? 2 : 0) + (nestsFar(ctx, s.cx, s.cy, HOME_SEAM_NEST_CLEAR) ? 0 : 10);
  for (const clear of [false, true]) {
    const pick = rankSpots(ctx, spots, score, 1).find((s) =>
      canPlace(ctx, s.tx, s.ty, SEAM.w, SEAM.h, { clear }),
    );
    if (pick) {
      place(ctx, 'seam', pick.tx, pick.ty, SEAM.w, SEAM.h, clear);
      return addResource(ctx, pick, 'ember_seam', SEAM_AMOUNTS.home, { home: true });
    }
  }
  return null;
}

/** Guarded objects (Picket seams, Caches) avoid Old Watchtower range so nothing fights at 0:00. */
function towerPenalty(ctx: GenCtx, x: number, y: number): number {
  return ctx.watchtowers.some((t) => Math.hypot(t.tx + 1 - x, t.ty + 1 - y) < TOWER_QUIET) ? 10 : 0;
}

function contestedAmount(ctx: GenCtx): number {
  return ctx.params.modifiers.includes('ember_famine') ? SEAM_AMOUNTS.contestedFamine : SEAM_AMOUNTS.contested;
}

/** Octile length of a tile path. */
function stepLen(ctx: GenCtx, a: number, b: number): number {
  return a % ctx.w !== b % ctx.w && Math.floor(a / ctx.w) !== Math.floor(b / ctx.w) ? SQRT2 : 1;
}

/**
 * raze / elite / beacons: one contested Seam on the corridor to each of the two nearest Nests,
 * 11-15 corridor tiles from that Nest and offset 2-4 tiles sideways. Raze/Elite add a Picket.
 */
export function placeCorridorSeams(ctx: GenCtx): number[] | null {
  const C = FAIRNESS_KIT.contestedSeam;
  const lens = ctx.corridors.map((p) => {
    let l = 0;
    for (let j = 1; j < p.length; j++) l += stepLen(ctx, p[j - 1], p[j]);
    return l;
  });
  const order = ctx.nests.map((_, i) => i).sort((a, b) => lens[a] - lens[b]);
  const out: number[] = [];
  for (const k of order.slice(0, ctx.rule.contestedSeams)) {
    const path = ctx.corridors[k];
    const nest = ctx.nests[k];
    const nc = rectCenter(nest.tx, nest.ty, nest.w, nest.h);
    const last = path.length - 1;
    const cum = new Array<number>(path.length).fill(0);
    for (let j = last - 1; j >= 0; j--) cum[j] = cum[j + 1] + stepLen(ctx, path[j], path[j + 1]);
    const cands: { tx: number; ty: number }[] = [];
    const seen = new Set<number>();
    for (let j = 0; j <= last; j++) {
      if (cum[j] < C.fromNestMin || cum[j] > C.fromNestMax) continue;
      const px = (path[j] % ctx.w) + 0.5;
      const py = Math.floor(path[j] / ctx.w) + 0.5;
      const a = path[Math.max(0, j - 2)];
      const b = path[Math.min(last, j + 2)];
      let dx = (b % ctx.w) - (a % ctx.w);
      let dy = Math.floor(b / ctx.w) - Math.floor(a / ctx.w);
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      for (let off = C.offsetMin; off <= C.offsetMax + 0.5 + 1e-9; off += 0.5) {
        for (const side of [1, -1]) {
          const cx = px - dy * off * side;
          const cy = py + dx * off * side;
          const tx = Math.round(cx - SEAM.w / 2);
          const ty = Math.round(cy - SEAM.h / 2);
          const key = ty * ctx.w + tx;
          if (seen.has(key)) continue;
          seen.add(key);
          const sx = tx + SEAM.w / 2;
          const sy = ty + SEAM.h / 2;
          const dn = Math.hypot(sx - nc.x, sy - nc.y);
          if (dn < 10 || dn > 16 || !nestsFar(ctx, sx, sy, 10)) continue;
          cands.push({ tx, ty });
        }
      }
    }
    let shuffled = rankSpots(ctx, cands, (c) => towerPenalty(ctx, c.tx + SEAM.w / 2, c.ty + SEAM.h / 2), 1);
    if (!shuffled.some((c) => canPlace(ctx, c.tx, c.ty, SEAM.w, SEAM.h, { clear: true, clearWater: true }))) {
      // The corridor's 11-15 window runs past another Nest: use the same band around this Nest on
      // its Hearth-facing side instead.
      const toH = Math.atan2(ctx.hc.y - nc.y, ctx.hc.x - nc.x);
      shuffled = rankSpots(
        ctx,
        ringSpots(ctx, nc, C.fromNestMin, C.fromNestMax, SEAM.w, SEAM.h).filter(
          (sp) => Math.abs(angleDiff(sp.ang, toH)) <= 75 * DEG && nestsFar(ctx, sp.cx, sp.cy, 10),
        ),
        (sp) => Math.abs(angleDiff(sp.ang, toH)) + towerPenalty(ctx, sp.cx, sp.cy),
        0.6,
      ).map((sp) => ({ tx: sp.tx, ty: sp.ty }));
    }
    let placedIdx = -1;
    for (const pass of [0, 1, 2]) {
      const clear = pass > 0;
      const clearWater = pass > 1;
      const pick = shuffled.find((c) => canPlace(ctx, c.tx, c.ty, SEAM.w, SEAM.h, { clear, clearWater }));
      if (!pick) continue;
      place(ctx, 'seam', pick.tx, pick.ty, SEAM.w, SEAM.h, clear, clearWater);
      placedIdx = addResource(ctx, pick, 'ember_seam', contestedAmount(ctx), { contested: true });
      break;
    }
    if (placedIdx < 0) return ctx.fail(`kit: contested seam for nest ${k} (${cands.length} candidates)`);
    if (ctx.rule.pickets > 0 && !placePicket(ctx, placedIdx)) return ctx.fail('kit: picket');
    out.push(placedIdx);
  }
  return out;
}

/** Bramble Picket: a Thornspire 1.5-3 tiles from the Seam, on its Hearth side; grass radius 3 around it. */
export function placePicket(ctx: GenCtx, seamIndex: number): boolean {
  const r = ctx.resources[seamIndex];
  const sc = rectCenter(r.tx, r.ty, SEAM.w, SEAM.h);
  const toH = Math.atan2(ctx.hc.y - sc.y, ctx.hc.x - sc.x);
  const pick = rankSpots(ctx, ringSpots(ctx, sc, 1.5, 3.2, SPIRE.w, SPIRE.h), (s) => -Math.cos(s.ang - toH), 1.2).find((s) =>
    canPlace(ctx, s.tx, s.ty, SPIRE.w, SPIRE.h, { clear: true }),
  );
  if (!pick) return false;
  place(ctx, 'picket', pick.tx, pick.ty, SPIRE.w, SPIRE.h, true);
  ctx.pickets.push({ tx: pick.tx, ty: pick.ty, seamIndex });
  clearDisc(ctx, pick.cx, pick.cy, MAPGEN.clearSmall);
  return true;
}

/** Holdfast: 1 unguarded contested Seam 12-16 from the Hearth and >= 10 from every Nest. */
export function placeHoldfastSeam(ctx: GenCtx): number[] | null {
  const H = FAIRNESS_KIT.holdfastSeam;
  const spots = ringSpots(ctx, ctx.hc, H.min, H.max, SEAM.w, SEAM.h).filter((s) =>
    ctx.nests.every((n) => Math.hypot(n.tx + n.w / 2 - s.cx, n.ty + n.h / 2 - s.cy) >= H.minFromNest),
  );
  for (const clear of [false, true]) {
    const pick = rankSpots(ctx, spots, () => 0, 1).find((s) => canPlace(ctx, s.tx, s.ty, SEAM.w, SEAM.h, { clear }));
    if (pick) {
      place(ctx, 'seam', pick.tx, pick.ty, SEAM.w, SEAM.h, clear);
      return [addResource(ctx, pick, 'ember_seam', contestedAmount(ctx), { contested: true })];
    }
  }
  return null;
}

/** Ruined Caches (1, 2 at d>=4) in side pockets >= 20 from the Hearth and >= 10 from Nests; Ancient Cache at 14-20. */
export function placeCaches(ctx: GenCtx): boolean {
  const field = centerlineField(ctx);
  const clearR = MAPGEN.clearSmall;
  const want: ('ruined_cache' | 'ancient_cache')[] = [];
  for (let i = 0; i < cacheCount(ctx.params.depth); i++) want.push('ruined_cache');
  if (ctx.params.modifiers.includes('ancient_cache')) want.push('ancient_cache');
  const others = (): Pt[] => [
    ...ctx.caches.map((c) => ({ x: c.tx + 0.5, y: c.ty + 0.5 })),
    ...ctx.beacons.map((b) => rectCenter(b.tx, b.ty, b.w, b.h)),
  ];
  for (const type of want) {
    const minD = type === 'ancient_cache' ? CACHES.ancient.minFromHearth : CACHES.minFromHearth;
    const maxD = type === 'ancient_cache' ? CACHES.ancient.maxFromHearth : Infinity;
    const b = Math.ceil(clearR);
    const spots: Spot[] = [];
    for (let ty = b; ty < ctx.h - b; ty++) {
      for (let tx = b; tx < ctx.w - b; tx++) {
        const cx = tx + 0.5;
        const cy = ty + 0.5;
        const d = Math.hypot(cx - ctx.hc.x, cy - ctx.hc.y);
        if (d < minD || d > maxD) continue;
        if (!ctx.nests.every((n) => Math.hypot(n.tx + n.w / 2 - cx, n.ty + n.h / 2 - cy) >= CACHES.minFromNest)) continue;
        spots.push({ tx, ty, cx, cy, d, ang: 0 });
      }
    }
    const taken = others();
    const ranked = rankSpots(
      ctx,
      spots.filter((s) => taken.every((o) => Math.hypot(o.x - s.cx, o.y - s.cy) >= 8)),
      (s) => {
        const cd = field[ctx.idx(s.tx, s.ty)];
        // Side pocket: 5-9 tiles off the corridors, out of Old Watchtower range.
        return (cd < 4 ? 10 : 0) + Math.abs(cd - 7) * 0.4 + towerPenalty(ctx, s.cx, s.cy);
      },
      2,
    );
    const pick = ranked.find((s) => canPlace(ctx, s.tx, s.ty, CACHE.w, CACHE.h, { clear: true }));
    if (!pick) return false;
    place(ctx, 'cache', pick.tx, pick.ty, CACHE.w, CACHE.h, true);
    ctx.caches.push({ tx: pick.tx, ty: pick.ty, type });
    clearDisc(ctx, pick.cx, pick.cy, clearR);
  }
  return true;
}
