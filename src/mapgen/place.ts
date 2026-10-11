/** Footprint placement helpers: validity checks, candidate rings, clearing, corridor carving. */
import { Terrain } from '../sim/types';
import { type Foot, type FootKind, type GenCtx, RES_CENTERLINE, RES_CORRIDOR, RES_MUSTER } from './ctx';
import type { Pt } from './geom';
import { chebyshevField } from './paths';

export interface PlaceOpts {
  /** Minimum free gap (tiles) to other footprints. Default 1. */
  gap?: number;
  /** Footprint kinds allowed inside the gap (never overlapping). */
  gapExempt?: readonly FootKind[];
  /** Allow forest/rock under the footprint (converted to grass on placement). */
  clear?: boolean;
  /** Also allow water/shallows under the footprint (requires `clear`). */
  clearWater?: boolean;
  /** Reserve bits that forbid placement. Default: centerline + muster discs. */
  block?: number;
  /** Minimum distance of the footprint from the map edge. Default 1. */
  border?: number;
}

export const DEFAULT_BLOCK = RES_CENTERLINE | RES_MUSTER;

export function canPlace(ctx: GenCtx, tx: number, ty: number, w: number, h: number, o: PlaceOpts = {}): boolean {
  const border = o.border ?? 1;
  if (tx < border || ty < border || tx + w > ctx.w - border || ty + h > ctx.h - border) return false;
  const block = o.block ?? DEFAULT_BLOCK;
  for (let y = ty; y < ty + h; y++) {
    for (let x = tx; x < tx + w; x++) {
      const i = y * ctx.w + x;
      if (ctx.occ[i] !== 0 || (ctx.reserve[i] & block) !== 0) return false;
      const t = ctx.terrain[i];
      if (t === Terrain.Grass) continue;
      if (o.clear && (t === Terrain.Forest || t === Terrain.Rock)) continue;
      if (o.clear && o.clearWater && (t === Terrain.Water || t === Terrain.Shallows)) continue;
      return false;
    }
  }
  const gap = o.gap ?? 1;
  if (gap > 0) {
    for (let y = ty - gap; y < ty + h + gap; y++) {
      for (let x = tx - gap; x < tx + w + gap; x++) {
        if (x < 0 || y < 0 || x >= ctx.w || y >= ctx.h) continue;
        if (x >= tx && x < tx + w && y >= ty && y < ty + h) continue;
        const f = ctx.footAt(y * ctx.w + x);
        if (f && !(o.gapExempt && o.gapExempt.includes(f.kind))) return false;
      }
    }
  }
  return true;
}

/**
 * Commit a footprint. With `clear`, forest/rock under it and in a 1-tile ring become grass
 * (and water/shallows too with `clearWater`).
 */
export function place(ctx: GenCtx, kind: FootKind, tx: number, ty: number, w: number, h: number, clear = false, clearWater = false): Foot {
  const f: Foot = { kind, tx, ty, w, h };
  ctx.feet.push(f);
  const id = ctx.feet.length;
  const x0 = clear ? tx - 1 : tx;
  const y0 = clear ? ty - 1 : ty;
  const x1 = clear ? tx + w : tx + w - 1;
  const y1 = clear ? ty + h : ty + h - 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!ctx.inBounds(x, y)) continue;
      const i = y * ctx.w + x;
      const inside = x >= tx && x < tx + w && y >= ty && y < ty + h;
      if (inside) ctx.occ[i] = id;
      const t = ctx.terrain[i];
      const clearable = t === Terrain.Forest || t === Terrain.Rock || (clearWater && (t === Terrain.Water || t === Terrain.Shallows));
      if (clear && clearable && (inside || ctx.occ[i] === 0)) ctx.terrain[i] = Terrain.Grass;
    }
  }
  return f;
}

export interface Spot {
  tx: number;
  ty: number;
  /** Footprint center. */
  cx: number;
  cy: number;
  /** Distance and angle of the footprint center from the ring center. */
  d: number;
  ang: number;
}

/** All w×h top-left positions whose footprint center lies within [rMin, rMax] of c (row-major order). */
export function ringSpots(ctx: GenCtx, c: Pt, rMin: number, rMax: number, w: number, h: number): Spot[] {
  const out: Spot[] = [];
  const x0 = Math.max(0, Math.floor(c.x - rMax - w));
  const y0 = Math.max(0, Math.floor(c.y - rMax - h));
  const x1 = Math.min(ctx.w - w, Math.ceil(c.x + rMax));
  const y1 = Math.min(ctx.h - h, Math.ceil(c.y + rMax));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const cx = tx + w / 2;
      const cy = ty + h / 2;
      const d = Math.hypot(cx - c.x, cy - c.y);
      if (d < rMin - 1e-9 || d > rMax + 1e-9) continue;
      out.push({ tx, ty, cx, cy, d, ang: Math.atan2(cy - c.y, cx - c.x) });
    }
  }
  return out;
}

/** Sort spots by score + random jitter (deterministic for the rng state). */
export function rankSpots<T>(ctx: GenCtx, spots: T[], score: (s: T) => number, jitter = 1): T[] {
  const keyed = spots.map((s) => ({ s, k: score(s) + ctx.rng.next() * jitter }));
  keyed.sort((a, b) => a.k - b.k);
  return keyed.map((e) => e.s);
}

/** Set grass within radius r of (cx, cy). Footprints and briar walls are never touched. */
export function clearDisc(ctx: GenCtx, cx: number, cy: number, r: number): void {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r); x++) {
      if (!ctx.inBounds(x, y)) continue;
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
      const i = y * ctx.w + x;
      if (ctx.occ[i] !== 0 || ctx.terrain[i] === Terrain.BriarWall) continue;
      ctx.terrain[i] = Terrain.Grass;
    }
  }
}

/** Mark every tile within radius r of (cx, cy) with reserve bits. */
export function reserveDisc(ctx: GenCtx, cx: number, cy: number, r: number, bits: number): void {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r); x++) {
      if (!ctx.inBounds(x, y)) continue;
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
      ctx.reserve[y * ctx.w + x] |= bits;
    }
  }
}

/** Corridor carving cost per terrain (GDD §K step 5). BriarWall is never carved. */
export function carveCost(t: number): number {
  switch (t) {
    case Terrain.Grass:
    case Terrain.Stump:
      return 1;
    case Terrain.Shallows:
      return 2;
    case Terrain.Forest:
      return 4;
    case Terrain.Rock:
    case Terrain.Water:
      return 8;
    default:
      return Infinity;
  }
}

/**
 * Carve a corridor along `path` with a (2·half+1)-wide square brush: forest and rock become
 * grass, water becomes shallows. Footprints and briar walls are left alone.
 */
export function carvePath(ctx: GenCtx, path: readonly number[], half = 1, markCenterline = true): void {
  for (const p of path) {
    const px = p % ctx.w;
    const py = (p - px) / ctx.w;
    if (markCenterline) ctx.reserve[p] |= RES_CENTERLINE;
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (!ctx.inBounds(x, y)) continue;
        const i = y * ctx.w + x;
        ctx.reserve[i] |= RES_CORRIDOR;
        if (ctx.occ[i] !== 0) continue;
        const t = ctx.terrain[i];
        if (t === Terrain.Forest || t === Terrain.Rock) ctx.terrain[i] = Terrain.Grass;
        else if (t === Terrain.Water) ctx.terrain[i] = Terrain.Shallows;
      }
    }
  }
}

/** Reserve a corridor (centerline + 3-wide band) without changing terrain (boss lanes). */
export function markCorridor(ctx: GenCtx, path: readonly number[], half = 1): void {
  for (const p of path) {
    const px = p % ctx.w;
    const py = (p - px) / ctx.w;
    ctx.reserve[p] |= RES_CENTERLINE;
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        if (ctx.inBounds(px + dx, py + dy)) ctx.reserve[(py + dy) * ctx.w + px + dx] |= RES_CORRIDOR;
      }
    }
  }
}

/** Set every tile of a footprint to grass (anchors placed before clearing). */
export function paveFootprint(ctx: GenCtx, f: Foot): void {
  for (let y = f.ty; y < f.ty + f.h; y++) {
    for (let x = f.tx; x < f.tx + f.w; x++) ctx.terrain[y * ctx.w + x] = Terrain.Grass;
  }
}

/** Count Forest tiles whose centers lie within [rMin, rMax] of c. */
export function countForestRing(terrain: Uint8Array, w: number, h: number, c: Pt, rMin: number, rMax: number): number {
  let n = 0;
  for (let y = Math.max(0, Math.floor(c.y - rMax - 1)); y <= Math.min(h - 1, Math.ceil(c.y + rMax)); y++) {
    for (let x = Math.max(0, Math.floor(c.x - rMax - 1)); x <= Math.min(w - 1, Math.ceil(c.x + rMax)); x++) {
      if (terrain[y * w + x] !== Terrain.Forest) continue;
      const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
      if (d >= rMin && d <= rMax) n++;
    }
  }
  return n;
}

/** Tile containing the footprint's center (top-left of the central 2×2 for even sizes). */
export function centerTile(ctx: GenCtx, f: Foot): number {
  return ctx.idx(f.tx + Math.floor(f.w / 2), f.ty + Math.floor(f.h / 2));
}

/** Register a resource spawn; returns its index into ctx.resources. */
export function addResource(
  ctx: GenCtx,
  s: { tx: number; ty: number },
  type: 'thicket' | 'ember_seam',
  amount: number,
  extra?: { contested?: boolean; home?: boolean },
): number {
  ctx.resources.push({ type, tx: s.tx, ty: s.ty, amount, ...extra });
  return ctx.resources.length - 1;
}

/** Chebyshev distance field from every corridor centerline tile. */
export function centerlineField(ctx: GenCtx): Uint16Array {
  const src: number[] = [];
  for (const p of ctx.corridors) for (const i of p) src.push(i);
  return chebyshevField(ctx.w, ctx.h, src);
}

/** Is (x, y) at least `min` tiles from every Nest center? */
export function nestsFar(ctx: GenCtx, x: number, y: number, min: number): boolean {
  return ctx.nests.every((n) => Math.hypot(n.tx + n.w / 2 - x, n.ty + n.h / 2 - y) >= min);
}
