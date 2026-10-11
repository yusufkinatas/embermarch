/**
 * Terrain layers (GDD §A render style, §Q "Rendering and caching"):
 * - ground: one cached canvas per world. Two-tone grass checker blended with noise and map.variant,
 *   soft tile-edge blending (sub-tile field interpolation upscaled with smoothing), organic coastlines,
 *   shallows rims, forest floor, briar bands. Never redrawn after build.
 * - props: trees, stumps, rocks, briar thorns, composited over the ground into one cached `surface` canvas
 *   (one full-screen blit per frame). The surface is redrawn per tile region (from the ground canvas + props)
 *   when a tree is felled or starts/stops being gathered (gathered trees are drawn live, shrinking and shaking).
 * - water shimmer: cheap animated strokes on a sparse set of interior water tiles.
 */
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { makeCanvas, type Ctx2D } from './canvas';
import { darken, lighten, mix, mixRgbInto, parseHex, type RGB } from './colors';
import { drawBriar, drawRocks, drawStump, drawTree, drawTreeShadow, TREE_REACH, treeShape } from './resourceArt';
import { hash01, T } from './shapes';
import { BIOMES, BRIAR_THORN_COLOR } from '../data/biomes';
import { Rng } from '../core/rng';
import type { BiomeDef } from '../data/types';
import { Terrain, type GameMap } from '../sim/types';

/** Ground sub-samples per tile before smooth upscaling. */
const SUB = 16;

const Cls = { Grass: 0, Forest: 1, Rock: 2, Shallows: 3, Water: 4, Briar: 5 } as const;

export function tileClass(t: number): number {
  switch (t) {
    case Terrain.Forest:
    case Terrain.Stump:
      return Cls.Forest;
    case Terrain.Rock:
      return Cls.Rock;
    case Terrain.Shallows:
      return Cls.Shallows;
    case Terrain.Water:
      return Cls.Water;
    case Terrain.BriarWall:
      return Cls.Briar;
    default:
      return Cls.Grass;
  }
}

/** Seed for cosmetic noise derived from the map itself (stable per map). */
export function mapNoiseSeed(map: GameMap): number {
  let h = 2166136261 ^ map.w ^ (map.h << 8);
  const n = Math.min(map.variant.length, 256);
  for (let i = 0; i < n; i++) {
    h ^= map.variant[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const smooth = (t: number): number => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k * k * (3 - 2 * k);
};
/** Sharpened interpolation weight: flat tile centers, blended edges. */
const edgeW = (t: number): number => smooth((t - 0.5) * 1.7 + 0.5);

export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class TerrainLayers {
  readonly map: GameMap;
  readonly biome: BiomeDef;
  /** Ground only, 1 px per world px (redraw source; decals are painted here). */
  readonly ground: HTMLCanvasElement;
  /** Ground + props at `propsRes` px per world px: the layer drawn every frame. */
  readonly surface: HTMLCanvasElement;
  readonly propsRes: number;
  private readonly surfaceCtx: Ctx2D;
  private readonly noise: NoiseFunction2D;
  private readonly noise2: NoiseFunction2D;
  /** Tiles currently drawn live (being gathered) and excluded from the props canvas. */
  readonly liveTrees = new Set<number>();
  /** Interior water tiles that carry a shimmer stroke: [tx, ty, phase, len] packed. */
  private shimmer: Float32Array;
  /** Tile at which a chop shake started (seconds of render clock). */
  readonly shakeAt = new Map<number, number>();
  /** Milliseconds spent building the cached layers. */
  readonly buildMs: number;

  constructor(map: GameMap, propsRes: number) {
    this.map = map;
    this.biome = BIOMES[map.biome] ?? BIOMES.greenmarch;
    const rng = new Rng(mapNoiseSeed(map));
    this.noise = createNoise2D(() => rng.next());
    this.noise2 = createNoise2D(() => rng.next());
    this.propsRes = propsRes;
    const W = map.w * T;
    const H = map.h * T;
    this.ground = makeCanvas(W, H).canvas;
    const p = makeCanvas(W * propsRes, H * propsRes);
    this.surface = p.canvas;
    this.surfaceCtx = p.ctx;
    this.shimmer = new Float32Array(0);
    const t0 = performance.now();
    this.buildGround();
    this.buildProps();
    this.buildShimmer();
    this.buildMs = performance.now() - t0;
  }

  // -------------------------------------------------------------------------
  // Ground
  // -------------------------------------------------------------------------

  private buildGround(): void {
    const { map } = this;
    const pal = this.biome.palette;
    const w = map.w;
    const h = map.h;
    const n = w * h;
    const cls = new Uint8Array(n);
    for (let i = 0; i < n; i++) cls[i] = tileClass(map.terrain[i]);
    const isWater = new Float32Array(n);
    const isWet = new Float32Array(n);
    const isForest = new Float32Array(n);
    const isRock = new Float32Array(n);
    const isBriar = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c = cls[i];
      isWater[i] = c === Cls.Water ? 1 : 0;
      isWet[i] = c === Cls.Water || c === Cls.Shallows ? 1 : 0;
      isForest[i] = c === Cls.Forest ? 1 : 0;
      isRock[i] = c === Cls.Rock ? 1 : 0;
      isBriar[i] = c === Cls.Briar ? 1 : 0;
    }
    // Per-tile grass colors: checker A/B blended with low-frequency noise and the variant byte.
    const gA = parseHex(pal.grassA);
    const gB = parseHex(pal.grassB);
    const grassR = new Float32Array(n);
    const grassG = new Float32Array(n);
    const grassB = new Float32Array(n);
    const tmp: RGB = [0, 0, 0];
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const i = ty * w + tx;
        const checker = (tx + ty) & 1;
        const nz = this.noise(tx / 9, ty / 9) * 0.5 + this.noise(tx / 3.5, ty / 3.5) * 0.25;
        let t = checker ? 0.78 : 0.22;
        t = Math.max(0, Math.min(1, t * 0.55 + (0.5 + nz) * 0.45));
        mixRgbInto(tmp, gA, gB, t);
        const v = 1 + ((map.variant[i] / 255) - 0.5) * 0.07;
        grassR[i] = tmp[0] * v;
        grassG[i] = tmp[1] * v;
        grassB[i] = tmp[2] * v;
      }
    }
    const forestFloor = parseHex(mix(mix(pal.grassA, pal.forest, 0.55), '#2A2418', 0.15));
    const rockFloor = parseHex(mix(pal.grassA, darken(pal.rock, 0.1), 0.55));
    const shallows = parseHex(pal.shallows);
    const water = parseHex(pal.water);
    const deep = parseHex(darken(pal.water, 0.28));
    const rim = parseHex(lighten(pal.shallows, 0.32));
    const bank = parseHex(mix(darken(pal.grassA, 0.25), '#6A5A3A', 0.35));
    const briar = parseHex(this.map.biome === 'heartwood' ? pal.extra : '#5B2E4A');
    const briarDeep = parseHex(darken(this.map.biome === 'heartwood' ? pal.extra : '#5B2E4A', 0.45));

    const SW = w * SUB;
    const SH = h * SUB;
    const { canvas: small, ctx: sctx } = makeCanvas(SW, SH);
    const img = sctx.createImageData(SW, SH);
    const data = img.data;
    const col: RGB = [0, 0, 0];
    const surf: RGB = [0, 0, 0];
    const noise = this.noise2;
    const bil = (arr: Float32Array, i00: number, i10: number, i01: number, i11: number, ax: number, ay: number): number => {
      const top = arr[i00] + (arr[i10] - arr[i00]) * ax;
      const bot = arr[i01] + (arr[i11] - arr[i01]) * ax;
      return top + (bot - top) * ay;
    };
    for (let sy = 0; sy < SH; sy++) {
      const v = (sy + 0.5) / SUB;
      const fy = v - 0.5;
      const iy = Math.floor(fy);
      const ay = fy - iy;
      const y0 = iy < 0 ? 0 : iy >= h ? h - 1 : iy;
      const y1 = iy + 1 < 0 ? 0 : iy + 1 >= h ? h - 1 : iy + 1;
      const ayS = edgeW(ay);
      for (let sx = 0; sx < SW; sx++) {
        const u = (sx + 0.5) / SUB;
        const fx = u - 0.5;
        const ix = Math.floor(fx);
        const ax = fx - ix;
        const x0 = ix < 0 ? 0 : ix >= w ? w - 1 : ix;
        const x1 = ix + 1 < 0 ? 0 : ix + 1 >= w ? w - 1 : ix + 1;
        const i00 = y0 * w + x0;
        const i10 = y0 * w + x1;
        const i01 = y1 * w + x0;
        const i11 = y1 * w + x1;
        const axS = edgeW(ax);
        // Grass base (always computed; other classes blend over it).
        col[0] = bil(grassR, i00, i10, i01, i11, axS, ayS);
        col[1] = bil(grassG, i00, i10, i01, i11, axS, ayS);
        col[2] = bil(grassB, i00, i10, i01, i11, axS, ayS);
        const c00 = cls[i00];
        const uniform = c00 === cls[i10] && c00 === cls[i01] && c00 === cls[i11];
        const fine = hash01(sx, sy, 7) - 0.5;
        if (uniform && c00 === Cls.Grass) {
          const k = 1 + fine * 0.06;
          col[0] *= k;
          col[1] *= k;
          col[2] *= k;
        } else {
          // Smooth noise only: per-subpixel hash noise at a threshold would make ragged edges.
          const jitter = noise(u * 0.9, v * 0.9) * 0.16 + noise(u * 3.1, v * 3.1) * 0.025;
          // Forest floor and rock floor.
          const fF = uniform ? (c00 === Cls.Forest ? 1 : 0) : bil(isForest, i00, i10, i01, i11, ax, ay);
          if (fF > 0) mixRgbInto(col, col, forestFloor, smooth((fF + jitter * 0.6 - 0.25) * 1.6));
          const fR = uniform ? (c00 === Cls.Rock ? 1 : 0) : bil(isRock, i00, i10, i01, i11, ax, ay);
          if (fR > 0) mixRgbInto(col, col, rockFloor, smooth((fR + jitter * 0.6 - 0.2) * 1.8));
          // Briar wall band.
          const fB = uniform ? (c00 === Cls.Briar ? 1 : 0) : bil(isBriar, i00, i10, i01, i11, ax, ay) + jitter * 0.8;
          if (fB > 0.42) {
            mixRgbInto(col, col, briar, smooth((fB - 0.42) * 6));
            // Darker core so walls read as raised, solid bands.
            if (fB > 0.6) mixRgbInto(col, col, briarDeep, smooth((fB - 0.6) * 2.5) * 0.45);
            const k = 1 + fine * 0.05 + noise(u * 2.2, v * 2.2) * 0.08;
            col[0] *= k;
            col[1] *= k;
            col[2] *= k;
          }
          // Wet: shallows band then water body.
          const fWet = uniform ? (c00 === Cls.Water || c00 === Cls.Shallows ? 1 : 0) : bil(isWet, i00, i10, i01, i11, ax, ay) + jitter;
          if (fWet > 0.34) {
            // Muddy bank just outside the waterline.
            mixRgbInto(col, col, bank, smooth((fWet - 0.34) / 0.14) * 0.7);
            // Anti-aliased waterline: blend over a narrow band instead of a hard threshold.
            const wetT = smooth((fWet - 0.42) / 0.16);
            if (wetT > 0) {
              const fW = uniform ? (c00 === Cls.Water ? 1 : 0) : bil(isWater, i00, i10, i01, i11, ax, ay) + jitter;
              const waterT = smooth((fW - 0.42) / 0.16);
              mixRgbInto(surf, shallows, water, waterT);
              mixRgbInto(surf, surf, deep, smooth((fW - 0.5) * 2.2) * 0.65);
              const k = 1 + noise(u * 0.6, v * 0.6) * 0.04 + fine * 0.03;
              surf[0] *= k;
              surf[1] *= k;
              surf[2] *= k;
              // Light rim where shallows meet open water.
              const rimK = Math.max(0, 1 - Math.abs(fW - 0.5) / 0.07) * 0.4;
              if (rimK > 0) mixRgbInto(surf, surf, rim, rimK);
              mixRgbInto(col, col, surf, wetT);
              // Foam on the shoreline.
              const foam = Math.max(0, 1 - Math.abs(fWet - 0.52) / 0.05) * 0.55;
              if (foam > 0) mixRgbInto(col, col, rim, foam);
            }
          }
        }
        const o = (sy * SW + sx) * 4;
        data[o] = col[0];
        data[o + 1] = col[1];
        data[o + 2] = col[2];
        data[o + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    const g = this.ground.getContext('2d') as Ctx2D;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(small, 0, 0, this.ground.width, this.ground.height);
    this.drawGroundDetails(g, cls);
  }

  private drawGroundDetails(g: Ctx2D, cls: Uint8Array): void {
    const { map } = this;
    const pal = this.biome.palette;
    const w = map.w;
    const h = map.h;
    const dark = darken(pal.grassA, 0.22);
    const light = lighten(pal.grassB, 0.14);
    const isWetAt = (tx: number, ty: number): boolean => {
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
      const c = cls[ty * w + tx];
      return c === Cls.Water || c === Cls.Shallows;
    };
    g.lineCap = 'round';
    // Grass tufts.
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const i = ty * w + tx;
        if (cls[i] !== Cls.Grass) continue;
        const r0 = hash01(tx, ty, 101);
        if (r0 < 0.42) {
          const n = 1 + Math.floor(hash01(tx, ty, 102) * 2);
          for (let k = 0; k < n; k++) {
            const bx = (tx + 0.15 + hash01(tx, ty, 110 + k) * 0.7) * T;
            const by = (ty + 0.2 + hash01(ty, tx, 120 + k) * 0.7) * T;
            g.strokeStyle = (k + tx) % 2 ? dark : light;
            g.lineWidth = 1.2;
            g.beginPath();
            g.moveTo(bx - 2.5, by);
            g.lineTo(bx - 3.5, by - 4);
            g.moveTo(bx, by);
            g.lineTo(bx, by - 5);
            g.moveTo(bx + 2.5, by);
            g.lineTo(bx + 3.5, by - 3.5);
            g.stroke();
          }
        }
        const r1 = hash01(tx, ty, 131);
        if (map.biome === 'greenmarch' && r1 < 0.05) {
          const fx = (tx + 0.2 + hash01(tx, ty, 132) * 0.6) * T;
          const fy = (ty + 0.2 + hash01(ty, tx, 133) * 0.6) * T;
          const c = ['#F4E6C1', '#F2D45C', '#E7A6C8'][Math.floor(hash01(tx, ty, 134) * 3)];
          g.fillStyle = c;
          for (let k = 0; k < 3; k++) g.fillRect(fx + (k - 1) * 3, fy + (k % 2) * 2, 2, 2);
        } else if (map.biome === 'ashwood' && r1 < 0.06) {
          const fx = (tx + 0.2 + hash01(tx, ty, 135) * 0.6) * T;
          const fy = (ty + 0.2 + hash01(ty, tx, 136) * 0.6) * T;
          g.fillStyle = r1 < 0.025 ? pal.extra : '#9A958A';
          g.fillRect(fx, fy, 2, 2);
          g.fillRect(fx + 4, fy + 3, 1.5, 1.5);
        } else if (map.biome === 'heartwood' && r1 < 0.07) {
          const fx = (tx + 0.2 + hash01(tx, ty, 137) * 0.6) * T;
          const fy = (ty + 0.2 + hash01(ty, tx, 138) * 0.6) * T;
          g.fillStyle = r1 < 0.03 ? '#7A4A8A' : '#3A2E40';
          g.fillRect(fx, fy, 2.5, 2);
          g.fillRect(fx + 3, fy - 2, 2, 2);
        } else if (r1 > 0.965) {
          // Pebbles.
          const fx = (tx + 0.3 + hash01(tx, ty, 139) * 0.4) * T;
          const fy = (ty + 0.3 + hash01(ty, tx, 140) * 0.4) * T;
          g.fillStyle = 'rgba(40,30,20,0.25)';
          g.beginPath();
          g.ellipse(fx + 1, fy + 1, 2.6, 1.8, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = lighten(pal.rock, 0.2);
          g.beginPath();
          g.ellipse(fx, fy, 2.4, 1.7, 0, 0, Math.PI * 2);
          g.fill();
        }
        // Reeds along the water's edge (Fenreach, and sparse elsewhere).
        const nearWet = isWetAt(tx - 1, ty) || isWetAt(tx + 1, ty) || isWetAt(tx, ty - 1) || isWetAt(tx, ty + 1);
        if (nearWet && hash01(tx, ty, 150) < (map.biome === 'fenreach' ? 0.75 : 0.25)) {
          const reed = map.biome === 'fenreach' ? pal.extra : mix(pal.grassB, '#8A9A4E', 0.5);
          const n = 3 + Math.floor(hash01(tx, ty, 151) * 3);
          for (let k = 0; k < n; k++) {
            const bx = (tx + 0.1 + hash01(tx, k, 152) * 0.8) * T;
            const by = (ty + 0.35 + hash01(k, ty, 153) * 0.6) * T;
            const lean = (hash01(k, tx, ty) - 0.5) * 4;
            g.strokeStyle = darken(reed, 0.3);
            g.lineWidth = 1.6;
            g.beginPath();
            g.moveTo(bx, by);
            g.lineTo(bx + lean, by - 9);
            g.stroke();
            g.strokeStyle = reed;
            g.lineWidth = 0.9;
            g.beginPath();
            g.moveTo(bx, by - 1);
            g.lineTo(bx + lean, by - 9);
            g.stroke();
            if (k % 2 === 0) {
              g.fillStyle = '#6A4A2A';
              g.fillRect(bx + lean - 1, by - 11, 2, 4);
            }
          }
        }
      }
    }
    // Ripple arcs on open water.
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 1;
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        if (cls[ty * w + tx] !== Cls.Water || hash01(tx, ty, 160) > 0.3) continue;
        const cx = (tx + 0.5) * T;
        const cy = (ty + 0.5) * T;
        g.beginPath();
        g.arc(cx, cy + 6, 8, Math.PI * 1.15, Math.PI * 1.85);
        g.stroke();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Props (trees, stumps, rocks, briar)
  // -------------------------------------------------------------------------

  private buildProps(): void {
    const ctx = this.surfaceCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.ground, 0, 0, this.surface.width, this.surface.height);
    ctx.setTransform(this.propsRes, 0, 0, this.propsRes, 0, 0);
    this.drawPropsIn(ctx, 0, 0, this.map.w - 1, this.map.h - 1);
  }

  /** Draw every prop whose tile lies in [tx0..tx1] × [ty0..ty1] (two passes: shadows, then bodies). */
  private drawPropsIn(ctx: Ctx2D, tx0: number, ty0: number, tx1: number, ty1: number): void {
    const { map } = this;
    const pal = this.biome.palette;
    const trunk = map.biome === 'greenmarch' ? pal.extra : '#4A3423';
    const briarBase = map.biome === 'heartwood' ? pal.extra : '#5B2E4A';
    const x0 = Math.max(0, tx0);
    const y0 = Math.max(0, ty0);
    const x1 = Math.min(map.w - 1, tx1);
    const y1 = Math.min(map.h - 1, ty1);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const i = ty * map.w + tx;
        if (map.terrain[i] === Terrain.Forest && !this.liveTrees.has(i)) drawTreeShadow(ctx, treeShape(tx, ty, map.variant[i]));
      }
    }
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const i = ty * map.w + tx;
        const t = map.terrain[i];
        if (t === Terrain.Stump) drawStump(ctx, tx, ty, map.variant[i], trunk);
        else if (t === Terrain.Rock) drawRocks(ctx, tx, ty, map.variant[i], pal.rock);
        else if (t === Terrain.BriarWall) drawBriar(ctx, tx, ty, map.variant[i], briarBase, BRIAR_THORN_COLOR);
      }
      for (let tx = x0; tx <= x1; tx++) {
        const i = ty * map.w + tx;
        if (map.terrain[i] === Terrain.Forest && !this.liveTrees.has(i)) {
          drawTree(ctx, treeShape(tx, ty, map.variant[i]), pal.forest, pal.forestHi, trunk);
        }
      }
    }
  }

  /** Redraw the surface around one tile (felled tree → stump, live tree enter/leave). */
  redrawTile(tile: number): void {
    const { map } = this;
    if (tile < 0 || tile >= map.w * map.h) return;
    const tx = tile % map.w;
    const ty = Math.floor(tile / map.w);
    const reach = TREE_REACH;
    this.redrawRegion(tx * T - reach, ty * T - reach, T + reach * 2, T + reach * 2);
  }

  /** Recomposite ground + props inside a world-px rect of the surface. */
  redrawRegion(rx: number, ry: number, rw: number, rh: number): void {
    const { map } = this;
    const x0 = Math.max(0, Math.floor(rx));
    const y0 = Math.max(0, Math.floor(ry));
    const x1 = Math.min(map.w * T, Math.ceil(rx + rw));
    const y1 = Math.min(map.h * T, Math.ceil(ry + rh));
    if (x1 <= x0 || y1 <= y0) return;
    const ctx = this.surfaceCtx;
    const k = this.propsRes;
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.ground, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    const span = Math.ceil(TREE_REACH / T) + 1;
    this.drawPropsIn(ctx, Math.floor(x0 / T) - span, Math.floor(y0 / T) - span, Math.ceil(x1 / T) + span, Math.ceil(y1 / T) + span);
    ctx.restore();
  }

  /** Update the set of live (being gathered) trees; redraws the props canvas only on changes. */
  setLiveTrees(next: Set<number>): void {
    for (const t of this.liveTrees) {
      if (!next.has(t)) {
        this.liveTrees.delete(t);
        this.redrawTile(t);
      }
    }
    for (const t of next) {
      if (!this.liveTrees.has(t) && this.map.terrain[t] === Terrain.Forest) {
        this.liveTrees.add(t);
        this.redrawTile(t);
      }
    }
  }

  /** Draw live trees (shrinking with depletion, shaking when chopped). */
  drawLiveTrees(ctx: Ctx2D, now: number, initialAmount: number, view: ViewRect): void {
    const { map } = this;
    const pal = this.biome.palette;
    const trunk = map.biome === 'greenmarch' ? pal.extra : '#4A3423';
    for (const i of this.liveTrees) {
      if (map.terrain[i] !== Terrain.Forest) continue;
      const tx = i % map.w;
      const ty = Math.floor(i / map.w);
      if (tx < view.x0 - 2 || tx > view.x1 + 2 || ty < view.y0 - 2 || ty > view.y1 + 2) continue;
      const s = treeShape(tx, ty, map.variant[i]);
      const frac = initialAmount > 0 ? Math.max(0, Math.min(1, map.treeAmount[i] / initialAmount)) : 1;
      const scale = 0.5 + 0.5 * frac;
      const since = now - (this.shakeAt.get(i) ?? -10);
      const shake = since < 0.25 ? Math.sin(since * 70) * 2.2 * (1 - since / 0.25) : 0;
      drawTreeShadow(ctx, s, scale);
      // Shrink toward the trunk base so the tree "settles" as it depletes.
      const oy = s.r * (1 - scale) * 0.6;
      drawTree(ctx, s, pal.forest, pal.forestHi, trunk, scale, shake, oy);
    }
  }

  // -------------------------------------------------------------------------
  // Water shimmer
  // -------------------------------------------------------------------------

  private buildShimmer(): void {
    const { map } = this;
    const out: number[] = [];
    const isW = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < map.w && y < map.h && map.terrain[y * map.w + x] === Terrain.Water;
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (!isW(tx, ty)) continue;
        if (!(isW(tx - 1, ty) && isW(tx + 1, ty) && isW(tx, ty - 1) && isW(tx, ty + 1))) continue;
        if (hash01(tx, ty, 77) > 0.45) continue;
        out.push(tx, ty, hash01(tx, ty, 78) * Math.PI * 2, 5 + hash01(tx, ty, 79) * 7);
      }
    }
    this.shimmer = new Float32Array(out);
  }

  /** Animated light glints on water (3 alpha buckets → 3 stroke calls). */
  drawShimmer(ctx: Ctx2D, now: number, view: ViewRect): void {
    const s = this.shimmer;
    if (s.length === 0) return;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.4;
    for (let bucket = 0; bucket < 3; bucket++) {
      ctx.beginPath();
      let any = false;
      for (let k = 0; k < s.length; k += 4) {
        const tx = s[k];
        const ty = s[k + 1];
        if (tx < view.x0 - 1 || tx > view.x1 || ty < view.y0 - 1 || ty > view.y1) continue;
        const ph = s[k + 2];
        const wave = Math.sin(now * 1.1 + ph);
        const b = wave > 0.75 ? 2 : wave > 0.35 ? 1 : wave > 0 ? 0 : -1;
        if (b !== bucket) continue;
        const len = s[k + 3];
        const cx = (tx + 0.5) * T + Math.sin(now * 0.5 + ph) * 4;
        const cy = (ty + 0.5) * T + Math.cos(ph) * 6;
        ctx.moveTo(cx - len / 2, cy);
        ctx.lineTo(cx + len / 2, cy);
        any = true;
      }
      if (!any) continue;
      ctx.strokeStyle = bucket === 2 ? 'rgba(255,255,255,0.30)' : bucket === 1 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)';
      ctx.stroke();
    }
  }

  /** Paint a permanent decal onto the ground (rubble, scorch) inside a world-px rect, then recomposite it. */
  paintGround(rx: number, ry: number, rw: number, rh: number, fn: (ctx: Ctx2D) => void): void {
    const g = this.ground.getContext('2d') as Ctx2D;
    g.save();
    g.beginPath();
    g.rect(rx, ry, rw, rh);
    g.clip();
    fn(g);
    g.restore();
    this.redrawRegion(rx, ry, rw, rh);
  }
}
