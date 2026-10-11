/**
 * Boss map: the hand-authored Heartwood template (GDD §K "Boss template").
 * Hearth plaza (10, 54) r8, Throne plaza (50, 14) r6, 3 Root Hearts 16-22 from the Throne at
 * −40°/0°/+40° around the Throne→Hearth axis, three 7-wide lanes (Hearth → [bend] → Heart → Throne)
 * flanked by 3-thick briar walls, off-lane forest/rock only, Pickets at the side-lane midpoints.
 */
import type { Rng } from '../core/rng';
import { BOSS_MAP, MAPGEN, OBJECTIVE_ANCHORS } from '../data/balance';
import { BIOMES } from '../data/biomes';
import { BUILDINGS } from '../data/buildings';
import { RESOURCE_NODES, SEAM_AMOUNTS } from '../data/resources';
import { Terrain } from '../sim/types';
import type { MapGenParams } from '../sim/types';
import { GenCtx, RES_PROTECT } from './ctx';
import { type Pt, distToPolyline, pointAlong, polylineLength, rectCenter, tangentAlong } from './geom';
import { placeMusterAndSpires } from './anchors';
import { type MapGenResult, finalize } from './finalize';
import { connectAndSettle, placeFairnessKit, placePicket } from './kit';
import { astar } from './paths';
import { canPlace, centerTile, clearDisc, markCorridor, paveFootprint, place, rankSpots, reserveDisc } from './place';
import { noiseField, sortedIndices } from './terrain';

const DEG = Math.PI / 180;
const HEART = BUILDINGS.root_heart;
const THRONE = BUILDINGS.briar_throne;
const HEARTH = BUILDINGS.hearth;
const SEAM = RESOURCE_NODES.ember_seam;

interface BossLayout {
  hearts: { tx: number; ty: number; c: Pt; deg: number }[];
  lanes: Pt[][];
}

/** Root Heart sites and lane polylines. `fixed` gives the known-good fallback layout. */
export function bossLayout(rng: Rng, fixed: boolean): BossLayout | null {
  const H = BOSS_MAP.hearthCenter;
  const T = BOSS_MAP.throneCenter;
  const axis = Math.atan2(H.y - T.y, H.x - T.x);
  const hearts: BossLayout['hearts'] = [];
  for (const deg of BOSS_MAP.heartAngles) {
    const side = deg !== 0;
    let placed = false;
    for (let tries = 0; tries < 12 && !placed; tries++) {
      const d = fixed ? (side ? 21 : 19) : side ? rng.range(20, 22) : rng.range(17, 21.5);
      const ang = axis + deg * DEG;
      const cx = T.x + Math.cos(ang) * d;
      const cy = T.y + Math.sin(ang) * d;
      const tx = Math.round(cx - HEART.w / 2);
      const ty = Math.round(cy - HEART.h / 2);
      const c = rectCenter(tx, ty, HEART.w, HEART.h);
      const real = Math.hypot(c.x - T.x, c.y - T.y);
      if (real < BOSS_MAP.heartDistMin || real > BOSS_MAP.heartDistMax) continue;
      hearts.push({ tx, ty, c, deg });
      placed = true;
    }
    if (!placed) return null;
  }
  // Side lanes leave the Hearth plaza fanned out (±spread from the Hearth→Throne direction) and
  // bend toward their Heart after r1 tiles. A bend near the end of a segment costs little length,
  // so the side Hearts stay inside their 40-46 path band while the lanes separate early.
  const toThrone = Math.atan2(T.y - H.y, T.x - H.x);
  const lanes = hearts.map((ht) => {
    if (ht.deg === 0) return [H, ht.c, T];
    const heartAng = Math.atan2(ht.c.y - H.y, ht.c.x - H.x);
    const sign = Math.sign(heartAng - toThrone) || 1;
    const spread = (fixed ? 40 : rng.range(36, 44)) * DEG;
    const r1 = fixed ? 11.5 : rng.range(10, 13);
    const bend = { x: H.x + Math.cos(toThrone + sign * spread) * r1, y: H.y + Math.sin(toThrone + sign * spread) * r1 };
    return [H, bend, ht.c, T];
  });
  return { hearts, lanes };
}

/** Lane cores (7 wide) and plazas are grass, a 3-thick briar band flanks every lane, the rest is forest/rock. */
function paintTemplate(ctx: GenCtx, lanes: Pt[][], rng: Rng): void {
  const H = BOSS_MAP.hearthCenter;
  const T = BOSS_MAP.throneCenter;
  const core = BOSS_MAP.laneWidth / 2;
  const wall = core + BOSS_MAP.wallThickness;
  const off: number[] = [];
  for (let y = 0; y < ctx.h; y++) {
    for (let x = 0; x < ctx.w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const i = ctx.idx(x, y);
      const plaza = Math.hypot(px - H.x, py - H.y) <= BOSS_MAP.hearthPlaza || Math.hypot(px - T.x, py - T.y) <= BOSS_MAP.thronePlaza;
      let dl = Infinity;
      for (const l of lanes) dl = Math.min(dl, distToPolyline(px, py, l));
      if (plaza || dl <= core) ctx.terrain[i] = Terrain.Grass;
      else if (dl <= wall) ctx.terrain[i] = Terrain.BriarWall;
      else off.push(i);
    }
  }
  // Off-lane: forest, with rock outcrops on the top rock-share of a noise field (never water).
  const rN = noiseField(rng.fork('noise:rock'), ctx.w, ctx.h);
  const nRock = Math.round(BIOMES[ctx.params.biome].rock * ctx.n);
  const offSet = new Uint8Array(ctx.n);
  for (const i of off) {
    offSet[i] = 1;
    ctx.terrain[i] = Terrain.Forest;
  }
  const order = sortedIndices(rN);
  let left = nRock;
  for (let k = order.length - 1; k >= 0 && left > 0; k--) {
    if (!offSet[order[k]]) continue;
    ctx.terrain[order[k]] = Terrain.Rock;
    left--;
  }
}

/** Contested Seams at the midpoints of the two side lanes (Hearth → Heart part), each with a Picket. */
function placeLaneSeams(ctx: GenCtx, layout: BossLayout): number[] | null {
  const out: number[] = [];
  const famine = ctx.params.modifiers.includes('ember_famine');
  layout.hearts.forEach((ht, k) => {
    if (ht.deg === 0) return;
    const pts = layout.lanes[k].slice(0, 3);
    const half = polylineLength(pts) / 2;
    const midPt = pointAlong(pts, half);
    const cands: { tx: number; ty: number }[] = [];
    for (let s = -3; s <= 3; s += 1) {
      const m = pointAlong(pts, half + s);
      const t = tangentAlong(pts, half + s);
      for (const offset of [2, 2.5]) {
        for (const side of [1, -1]) {
          const cx = m.x - t.y * offset * side;
          const cy = m.y + t.x * offset * side;
          cands.push({ tx: Math.round(cx - SEAM.w / 2), ty: Math.round(cy - SEAM.h / 2) });
        }
      }
    }
    const pick = rankSpots(ctx, cands, (c) => Math.hypot(c.tx + SEAM.w / 2 - midPt.x, c.ty + SEAM.h / 2 - midPt.y), 0.8).find(
      (c) => canPlace(ctx, c.tx, c.ty, SEAM.w, SEAM.h),
    );
    if (!pick) return;
    place(ctx, 'seam', pick.tx, pick.ty, SEAM.w, SEAM.h);
    ctx.resources.push({
      type: 'ember_seam',
      tx: pick.tx,
      ty: pick.ty,
      amount: famine ? SEAM_AMOUNTS.contestedFamine : SEAM_AMOUNTS.contested,
      contested: true,
    });
    const idx = ctx.resources.length - 1;
    if (placePicket(ctx, idx)) out.push(idx);
  });
  return out.length === 2 ? out : null;
}

function bossMidAnchor(lanes: Pt[][], hearts: Pt[]): (ctx: GenCtx, x: number, y: number) => boolean {
  return (ctx, x, y) => {
    const d = Math.hypot(x - ctx.hc.x, y - ctx.hc.y);
    if (d < 16 || d > 30) return false;
    if (hearts.some((h) => Math.hypot(h.x - x, h.y - y) < 8)) return false;
    let dl = Infinity;
    for (const l of lanes) dl = Math.min(dl, distToPolyline(x, y, l));
    return dl >= 1 && dl <= 3;
  };
}

export function bossAttempt(params: MapGenParams, rng: Rng, fixed: boolean, onFail: (ctx: GenCtx) => void): MapGenResult | null {
  const ctx = new GenCtx(params, OBJECTIVE_ANCHORS.boss, BOSS_MAP.size, rng);
  const res = runBoss(ctx, fixed);
  if (!res) onFail(ctx);
  return res;
}

function runBoss(ctx: GenCtx, fixed: boolean): MapGenResult | null {
  const { rule, rng } = ctx;
  const layout = bossLayout(rng, fixed);
  if (!layout) return ctx.fail('boss layout');
  paintTemplate(ctx, layout.lanes, rng);

  const H = BOSS_MAP.hearthCenter;
  const T = BOSS_MAP.throneCenter;
  ctx.hc = { x: H.x, y: H.y };
  ctx.hearth = place(ctx, 'hearth', H.x - HEARTH.w / 2, H.y - HEARTH.h / 2, HEARTH.w, HEARTH.h);
  paveFootprint(ctx, ctx.hearth);
  ctx.throne = place(ctx, 'throne', Math.round(T.x - THRONE.w / 2), Math.round(T.y - THRONE.h / 2), THRONE.w, THRONE.h);
  paveFootprint(ctx, ctx.throne);
  for (const ht of layout.hearts) {
    const f = place(ctx, 'nest', ht.tx, ht.ty, HEART.w, HEART.h);
    paveFootprint(ctx, f);
    ctx.nests.push(f);
  }
  // Clearings (never through briar walls) and protected plazas.
  for (const ht of layout.hearts) clearDisc(ctx, ht.c.x, ht.c.y, MAPGEN.clearNest);
  const protect = [
    { x: H.x, y: H.y, r: BOSS_MAP.hearthPlaza },
    { x: T.x, y: T.y, r: BOSS_MAP.thronePlaza },
    ...layout.hearts.map((ht) => ({ x: ht.c.x, y: ht.c.y, r: MAPGEN.clearNest })),
  ];
  for (const p of protect) {
    reserveDisc(ctx, p.x, p.y, p.r, RES_PROTECT);
    ctx.protectedDiscs.push(p);
  }

  // "Corridors" are the lanes themselves: walkable-only paths, nothing is carved.
  const start = centerTile(ctx, ctx.hearth);
  const hearth = ctx.hearth;
  for (const nest of ctx.nests) {
    const goal = centerTile(ctx, nest);
    const res = astar({
      w: ctx.w,
      h: ctx.h,
      start,
      isGoal: (i) => i === goal,
      hx: goal % ctx.w,
      hy: Math.floor(goal / ctx.w),
      noCornerCut: true,
      cost: (i) => {
        const f = ctx.footAt(i);
        if (f) return f === hearth || f === nest ? 1 : Infinity;
        return ctx.walkable(i) ? 1 : Infinity;
      },
    });
    if (!res) return ctx.fail('boss lane path');
    markCorridor(ctx, res.path);
    ctx.corridors.push(res.path);
  }
  if (!placeMusterAndSpires(ctx)) return ctx.fail('muster points / spires');

  const kit = placeFairnessKit(ctx, {
    contested: (c) => placeLaneSeams(c, layout),
    midAnchor: bossMidAnchor(
      layout.lanes,
      layout.hearts.map((h) => h.c),
    ),
    midCenterlineGap: 2,
    caches: rule.caches,
  });
  if (!kit) return null;
  const carves = connectAndSettle(ctx);
  if (carves === null) return null;
  kit.connectCarves = carves;
  return finalize(ctx, kit, layout.lanes) ?? ctx.fail('finalize');
}
