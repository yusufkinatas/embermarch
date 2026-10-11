/**
 * Offscreen sprite caches: unit bodies per (type, owner, facing bucket), building statics per
 * (type, owner, variant), resource nodes and glow blobs. Sprites are rasterized at the current
 * device-pixel-per-world-pixel resolution bucket so they stay crisp at every zoom.
 */
import { BUILDING_MARGIN, drawBuildingArt, type BuildingVariant } from './buildingArt';
import { makeCanvas } from './canvas';
import { parseHex } from './colors';
import { drawEmberSeam, drawThicket } from './resourceArt';
import { T } from './shapes';
import { drawUnitArt, UNIT_REACH } from './unitArt';
import { PALETTE } from '../data/palette';
import type { BuildingId, Owner, UnitId } from '../sim/types';

export const FACING_BUCKETS = 16;

/** Quantize a facing angle (radians, any range) into one of n buckets; bucket 0 faces +x. */
export function facingBucket(angle: number, n = FACING_BUCKETS): number {
  if (!Number.isFinite(angle)) return 0;
  const step = (Math.PI * 2) / n;
  const b = Math.round(angle / step) % n;
  return b < 0 ? b + n : b + 0; // "+ 0" normalizes -0
}

export function bucketAngle(bucket: number, n = FACING_BUCKETS): number {
  return (bucket * Math.PI * 2) / n;
}

/** Device pixels per world pixel, quantized to 0.5 steps in [1, 4] (sprite raster resolution). */
export function resBucket(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(4, Math.max(1, Math.ceil(scale * 2 - 1e-6) / 2));
}

export function unitSpriteKey(type: UnitId, owner: Owner, bucket: number, flash = false): string {
  return `${type}|${owner}|${bucket}${flash ? '|f' : ''}`;
}

export function buildingSpriteKey(type: BuildingId, owner: Owner, w: number, h: number, v: BuildingVariant): string {
  return `${type}|${owner}|${w}x${h}|${v.spent ? 's' : ''}${v.looted ? 'l' : ''}`;
}

/** Number of grain dots shown on a Thicket for its remaining fraction (0..10). */
export function thicketDots(amount: number, initial: number): number {
  if (initial <= 0 || amount <= 0) return 0;
  return Math.max(1, Math.min(10, Math.ceil((amount / initial) * 10)));
}

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Anchor offset in world px: draw at (x - ox, y - oy) with size (w, h). */
  ox: number;
  oy: number;
  w: number;
  h: number;
}

export class SpriteCache {
  res = 1;
  private units = new Map<string, Sprite>();
  private buildings = new Map<string, Sprite>();
  private misc = new Map<string, Sprite>();

  /** Set the raster resolution; clears cached sprites when the bucket changes. */
  setScale(scale: number): void {
    const r = resBucket(scale);
    if (r !== this.res) {
      this.res = r;
      this.clear();
    }
  }

  clear(): void {
    this.units.clear();
    this.buildings.clear();
    this.misc.clear();
  }

  get size(): number {
    return this.units.size + this.buildings.size + this.misc.size;
  }

  unit(type: UnitId, owner: Owner, facing: number): Sprite {
    const b = facingBucket(facing);
    const key = unitSpriteKey(type, owner, b);
    let s = this.units.get(key);
    if (!s) {
      s = this.rasterUnit(type, owner, bucketAngle(b));
      this.units.set(key, s);
    }
    return s;
  }

  /** White silhouette of the unit sprite (hit flash). */
  unitFlash(type: UnitId, owner: Owner, facing: number): Sprite {
    const b = facingBucket(facing);
    const key = unitSpriteKey(type, owner, b, true);
    let s = this.units.get(key);
    if (!s) {
      const base = this.unit(type, owner, facing);
      const { canvas, ctx } = makeCanvas(base.canvas.width, base.canvas.height);
      ctx.drawImage(base.canvas, 0, 0);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      s = { canvas, ox: base.ox, oy: base.oy, w: base.w, h: base.h };
      this.units.set(key, s);
    }
    return s;
  }

  private rasterUnit(type: UnitId, owner: Owner, angle: number): Sprite {
    const reach = UNIT_REACH[type] + 3;
    const size = reach * 2;
    const { canvas, ctx } = makeCanvas(size * this.res, size * this.res);
    ctx.setTransform(this.res, 0, 0, this.res, reach * this.res, reach * this.res);
    drawUnitArt(ctx, type, owner, angle);
    return { canvas, ox: reach, oy: reach, w: canvas.width / this.res, h: canvas.height / this.res };
  }

  building(type: BuildingId, owner: Owner, w: number, h: number, v: BuildingVariant = {}): Sprite {
    const key = buildingSpriteKey(type, owner, w, h, v);
    let s = this.buildings.get(key);
    if (!s) {
      s = this.rasterBuilding(type, owner, w, h, v);
      this.buildings.set(key, s);
    }
    return s;
  }

  private rasterBuilding(type: BuildingId, owner: Owner, w: number, h: number, v: BuildingVariant): Sprite {
    const m = BUILDING_MARGIN[type];
    const W = w * T + m.side * 2;
    const H = h * T + m.top + m.bottom;
    const { canvas, ctx } = makeCanvas(W * this.res, H * this.res);
    ctx.setTransform(this.res, 0, 0, this.res, m.side * this.res, m.top * this.res);
    drawBuildingArt(ctx, type, owner, w, h, v);
    if (v.spent) {
      // Spent tint: #A8987A at 60% over the body (§A).
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = PALETTE.enemy.spentTintAlpha;
      ctx.fillStyle = PALETTE.enemy.spentTint;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    return { canvas, ox: m.side, oy: m.top, w: canvas.width / this.res, h: canvas.height / this.res };
  }

  thicket(dots: number): Sprite {
    const key = `thicket|${dots}`;
    let s = this.misc.get(key);
    if (!s) {
      const pad = 6;
      const { canvas, ctx } = makeCanvas((T + pad * 2) * this.res, (T + pad * 2) * this.res);
      ctx.setTransform(this.res, 0, 0, this.res, pad * this.res, pad * this.res);
      drawThicket(ctx, 0, 0, dots);
      s = { canvas, ox: pad, oy: pad, w: canvas.width / this.res, h: canvas.height / this.res };
      this.misc.set(key, s);
    }
    return s;
  }

  seam(w: number, h: number, depleted: boolean): Sprite {
    const key = `seam|${w}x${h}|${depleted ? 'd' : ''}`;
    let s = this.misc.get(key);
    if (!s) {
      const pad = 8;
      const { canvas, ctx } = makeCanvas((w * T + pad * 2) * this.res, (h * T + pad * 2) * this.res);
      ctx.setTransform(this.res, 0, 0, this.res, pad * this.res, pad * this.res);
      drawEmberSeam(ctx, 0, 0, w, h, depleted ? 0.15 : 1);
      s = { canvas, ox: pad, oy: pad, w: canvas.width / this.res, h: canvas.height / this.res };
      this.misc.set(key, s);
    }
    return s;
  }

  /** Soft, flat-centered puff of `color` for smoke and dust particles (radius 32 units). */
  puff(color: string): Sprite {
    const key = `puff|${color}`;
    let s = this.misc.get(key);
    if (!s) {
      const R = 32;
      const px = 48;
      const { canvas, ctx } = makeCanvas(px, px);
      const [r, g, b] = parseHex(color);
      const grad = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
      grad.addColorStop(0.45, `rgba(${r},${g},${b},0.65)`);
      grad.addColorStop(0.8, `rgba(${r},${g},${b},0.18)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, px, px);
      s = { canvas, ox: R, oy: R, w: R * 2, h: R * 2 };
      this.misc.set(key, s);
    }
    return s;
  }

  /** Soft radial glow blob of `color` (drawn scaled; 1 world px radius = 1 unit). */
  glow(color: string): Sprite {
    const key = `glow|${color}`;
    let s = this.misc.get(key);
    if (!s) {
      const R = 32;
      const px = Math.ceil(R * 2 * Math.min(this.res, 2));
      const { canvas, ctx } = makeCanvas(px, px);
      const [r, g, b] = parseHex(color);
      const grad = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
      grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
      grad.addColorStop(0.35, `rgba(${r},${g},${b},0.55)`);
      grad.addColorStop(0.7, `rgba(${r},${g},${b},0.16)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, px, px);
      s = { canvas, ox: R, oy: R, w: R * 2, h: R * 2 };
      this.misc.set(key, s);
    }
    return s;
  }
}
