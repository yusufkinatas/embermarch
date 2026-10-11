/**
 * Steps 3-5 for the noise-based objectives (raze, elite, holdfast, beacons):
 * Hearth / Nest / Beacon anchors, clearings, corridors, muster points and Nest spires.
 */
import { BEACONS, MAPGEN, THORNSPIRE, nestsFor } from '../data/balance';
import { BUILDINGS } from '../data/buildings';
import { type GenCtx, RES_PROTECT, RES_MUSTER } from './ctx';
import { TOWER_QUIET } from './kit-sites';
import { type Pt, rectCenter } from './geom';
import { astar } from './paths';
import { canPlace, carveCost, carvePath, centerTile, clearDisc, paveFootprint, place, rankSpots, reserveDisc, ringSpots } from './place';

const HEARTH = BUILDINGS.hearth;
const NEST = BUILDINGS.thorn_nest;
const BEACON = BUILDINGS.beacon_stone;
const SPIRE = BUILDINGS.thornspire;

/** Edge the Hearth sits on for the Beacons objective (0 top, 1 right, 2 bottom, 3 left). */
function farEdgeDistance(edge: number, S: number, c: Pt): number {
  switch (edge) {
    case 0:
      return S - c.y;
    case 1:
      return c.x;
    case 2:
      return c.y;
    default:
      return S - c.x;
  }
}

/** Step 3a: the Hearth (4×4) per the objective table. Returns the chosen beacons edge (or -1). */
export function placeHearth(ctx: GenCtx): number {
  const S = ctx.w;
  const r = ctx.rule;
  const rng = ctx.rng;
  let cx: number;
  let cy: number;
  let edge = -1;
  if (r.hearth === 'corner') {
    const corner = rng.int(0, 3);
    const ix = rng.int(r.hearthInsetMin, r.hearthInsetMax);
    const iy = rng.int(r.hearthInsetMin, r.hearthInsetMax);
    cx = corner & 1 ? S - ix : ix;
    cy = corner & 2 ? S - iy : iy;
  } else if (r.hearth === 'edge_mid') {
    edge = rng.int(0, 3);
    const inset = r.hearthInsetMin;
    const mid = Math.floor(S / 2);
    cx = edge === 1 ? S - inset : edge === 3 ? inset : mid;
    cy = edge === 0 ? inset : edge === 2 ? S - inset : mid;
  } else {
    cx = Math.floor(S / 2);
    cy = Math.floor(S / 2);
  }
  ctx.hc = { x: cx, y: cy };
  ctx.hearth = place(ctx, 'hearth', cx - HEARTH.w / 2, cy - HEARTH.h / 2, HEARTH.w, HEARTH.h);
  paveFootprint(ctx, ctx.hearth);
  return edge;
}

/**
 * Step 3b: Nests (3×3) at the objective's distance band, >= minApart, >= border from the edge.
 * `minNearest` (fallback template only, where walked paths are near-straight) rejects sets whose
 * nearest Nest is closer than the validation path minimum.
 */
export function placeNests(ctx: GenCtx, edge: number, minNearest = 0): boolean {
  const S = ctx.w;
  const r = ctx.rule;
  const count = nestsFor(ctx.params.objective, ctx.params.depth);
  const cands: { tx: number; ty: number; c: Pt }[] = [];
  for (let ty = r.nestBorder; ty + NEST.h <= S - r.nestBorder; ty++) {
    for (let tx = r.nestBorder; tx + NEST.w <= S - r.nestBorder; tx++) {
      const c = rectCenter(tx, ty, NEST.w, NEST.h);
      const d = Math.hypot(c.x - ctx.hc.x, c.y - ctx.hc.y);
      if (d < r.nestDistMin || d > r.nestDistMax) continue;
      if (r.nestFarEdge !== undefined && edge >= 0 && farEdgeDistance(edge, S, c) > r.nestFarEdge) continue;
      cands.push({ tx, ty, c });
    }
  }
  if (cands.length === 0) return false;
  for (let tries = 0; tries < 30; tries++) {
    const order = ctx.rng.shuffle(cands.slice());
    const chosen: typeof cands = [];
    for (const cand of order) {
      if (chosen.every((o) => Math.hypot(o.c.x - cand.c.x, o.c.y - cand.c.y) >= r.nestMinApart)) {
        chosen.push(cand);
        if (chosen.length === count) break;
      }
    }
    if (chosen.length < count) continue;
    const dist = (p: Pt): number => Math.hypot(p.x - ctx.hc.x, p.y - ctx.hc.y);
    if (Math.min(...chosen.map((c) => dist(c.c))) < minNearest) continue;
    chosen.sort((a, b) => dist(a.c) - dist(b.c));
    for (const c of chosen) {
      const f = place(ctx, 'nest', c.tx, c.ty, NEST.w, NEST.h);
      paveFootprint(ctx, f);
      ctx.nests.push(f);
    }
    return true;
  }
  return false;
}

/** Step 3c (Beacons objective): 3 Beacon Stones 15-24 from the Hearth, >= 12 apart. */
export function placeBeacons(ctx: GenCtx): boolean {
  const clear = MAPGEN.clearSmall;
  const spots = ringSpots(ctx, ctx.hc, BEACONS.minDist, BEACONS.maxDist, BEACON.w, BEACON.h).filter((s) => {
    const b = Math.ceil(clear);
    if (s.tx < b || s.ty < b || s.tx + BEACON.w > ctx.w - b || s.ty + BEACON.h > ctx.h - b) return false;
    // Keep Beacons out of the Nests' clearings and initial Blight.
    return ctx.nests.every((n) => Math.hypot(n.tx + n.w / 2 - s.cx, n.ty + n.h / 2 - s.cy) >= 8);
  });
  // Old Watchtowers stand 7-9 tiles toward the nearest Nest: keep the guarded Beacons out of their
  // reach when possible so nothing fights at 0:00 (falls back to any layout after 20 tries).
  const towerSites: Pt[] = [];
  if (ctx.params.modifiers.includes('old_watchtowers')) {
    const dir = ctx.nearestNestAngle();
    for (const off of [-35, 35]) {
      const a = dir + (off * Math.PI) / 180;
      towerSites.push({ x: ctx.hc.x + Math.cos(a) * 8, y: ctx.hc.y + Math.sin(a) * 8 });
    }
  }
  const quiet = (s: { cx: number; cy: number }): boolean => towerSites.every((p) => Math.hypot(p.x - s.cx, p.y - s.cy) >= TOWER_QUIET + 1);
  for (let tries = 0; tries < 30; tries++) {
    const order = ctx.rng.shuffle(spots.slice());
    const chosen: typeof spots = [];
    for (const s of order) {
      if (tries < 20 && !quiet(s)) continue;
      if (!canPlace(ctx, s.tx, s.ty, BEACON.w, BEACON.h, { gap: 1, clear: true, block: 0 })) continue;
      if (chosen.every((o) => Math.hypot(o.cx - s.cx, o.cy - s.cy) >= BEACONS.minApart)) {
        chosen.push(s);
        if (chosen.length === BEACONS.count) break;
      }
    }
    if (chosen.length < BEACONS.count) continue;
    for (const s of chosen) ctx.beacons.push(place(ctx, 'beacon', s.tx, s.ty, BEACON.w, BEACON.h, true));
    return true;
  }
  return false;
}

/** Step 4: grass around the Hearth (7), Nests (4) and Beacons (3). */
export function clearAnchors(ctx: GenCtx): void {
  const disc = (c: Pt, r: number): void => {
    clearDisc(ctx, c.x, c.y, r);
    reserveDisc(ctx, c.x, c.y, r, RES_PROTECT);
    ctx.protectedDiscs.push({ x: c.x, y: c.y, r });
  };
  disc(ctx.hc, MAPGEN.clearHearth);
  for (const n of ctx.nests) disc(rectCenter(n.tx, n.ty, n.w, n.h), MAPGEN.clearNest);
  for (const b of ctx.beacons) disc(rectCenter(b.tx, b.ty, b.w, b.h), MAPGEN.clearSmall);
}

/** Step 5: 3-wide corridor from the Hearth to every Nest along a terrain-cost A* path. */
export function carveCorridors(ctx: GenCtx): boolean {
  const hearth = ctx.hearth;
  if (!hearth) return false;
  const start = centerTile(ctx, hearth);
  for (const nest of ctx.nests) {
    const goal = centerTile(ctx, nest);
    const res = astar({
      w: ctx.w,
      h: ctx.h,
      start,
      isGoal: (i) => i === goal,
      hx: goal % ctx.w,
      hy: Math.floor(goal / ctx.w),
      cost: (i) => {
        const f = ctx.footAt(i);
        if (f) return f === hearth || f === nest ? 1 : Infinity;
        return carveCost(ctx.terrain[i]);
      },
    });
    if (!res) return false;
    carvePath(ctx, res.path, Math.floor(MAPGEN.corridorWidth / 2));
    ctx.corridors.push(res.path);
  }
  return true;
}

/**
 * Muster point per Nest (3 tiles in front of it toward the Hearth, following its corridor)
 * and one Thornspire within 4 tiles of each Nest, plus one spare spire site per Nest.
 */
export function placeMusterAndSpires(ctx: GenCtx): boolean {
  const front = NEST.w / 2 + 3;
  for (let k = 0; k < ctx.nests.length; k++) {
    const nest = ctx.nests[k];
    const nc = rectCenter(nest.tx, nest.ty, nest.w, nest.h);
    const path = ctx.corridors[k];
    let mp: Pt | null = null;
    for (let j = path.length - 1; j >= 0; j--) {
      const x = path[j] % ctx.w;
      const y = Math.floor(path[j] / ctx.w);
      if (Math.hypot(x + 0.5 - nc.x, y + 0.5 - nc.y) >= front && ctx.walkable(path[j])) {
        mp = { x: x + 0.5, y: y + 0.5 };
        break;
      }
    }
    if (!mp) return false;
    ctx.musterPoints.push(mp);
    reserveDisc(ctx, mp.x, mp.y, 1.5, RES_MUSTER);
  }
  for (let k = 0; k < ctx.nests.length; k++) {
    if (!placeSpiresFor(ctx, k)) return false;
  }
  return true;
}

/** One spire + one spare site within THORNSPIRE.placeRadius of Nest k, facing the Hearth when possible. */
export function placeSpiresFor(ctx: GenCtx, k: number): boolean {
  const nest = ctx.nests[k];
  const nc = rectCenter(nest.tx, nest.ty, nest.w, nest.h);
  const toH = Math.atan2(ctx.hc.y - nc.y, ctx.hc.x - nc.x);
  const spots = ringSpots(ctx, nc, 2.5, THORNSPIRE.placeRadius, SPIRE.w, SPIRE.h);
  const ranked = rankSpots(ctx, spots, (s) => -Math.cos(s.ang - toH), 0.8);
  let first: { tx: number; ty: number } | null = null;
  for (const s of ranked) {
    if (!canPlace(ctx, s.tx, s.ty, SPIRE.w, SPIRE.h, { gap: 1, clear: true })) continue;
    if (!first) {
      first = s;
      place(ctx, 'spire', s.tx, s.ty, SPIRE.w, SPIRE.h, true);
      ctx.spires.push({ tx: s.tx, ty: s.ty, nestIndex: k });
      continue;
    }
    place(ctx, 'spare_spire', s.tx, s.ty, SPIRE.w, SPIRE.h, true);
    ctx.spareSpires.push({ tx: s.tx, ty: s.ty, nestIndex: k });
    return true;
  }
  return false;
}
