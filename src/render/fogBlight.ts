/**
 * Blight and fog overlays (GDD §A palette, §P juice 6, §Q caching): both are 1-px-per-tile canvases
 * scaled up with smoothing, redrawn only when their version changes. Blight adds animated tendrils
 * on edge tiles only. Fog tracks last-seen enemy/neutral structures and draws them as ghosts.
 */
import { makeCanvas, type Ctx2D } from './canvas';
import { parseHex, rgba } from './colors';
import { T } from './shapes';
import { PALETTE } from '../data/palette';
import type { Building, BuildingId, Owner, World } from '../sim/types';

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Blighted tiles with at least one non-blighted 4-neighbour (or the map edge excluded). */
export function blightEdgeTiles(tiles: Uint8Array, w: number, h: number): Int32Array {
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (tiles[i] !== 1) continue;
      if ((x > 0 && tiles[i - 1] !== 1) || (x < w - 1 && tiles[i + 1] !== 1) || (y > 0 && tiles[i - w] !== 1) || (y < h - 1 && tiles[i + w] !== 1)) out.push(i);
    }
  }
  return Int32Array.from(out);
}

/**
 * Ward edge segments: for each warded, unblighted tile that touches a blighted 4-neighbour, the shared edge
 * as [x0, y0, x1, y1] in tile units (Kindled Earth / Kiln Masons ward ring).
 */
export function wardEdgeSegments(tiles: Uint8Array, ward: Uint16Array, w: number, h: number): Float32Array {
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (tiles[i] === 1 || ward[i] === 0) continue;
      if (x > 0 && tiles[i - 1] === 1) out.push(x, y, x, y + 1);
      if (x < w - 1 && tiles[i + 1] === 1) out.push(x + 1, y, x + 1, y + 1);
      if (y > 0 && tiles[i - w] === 1) out.push(x, y, x + 1, y);
      if (y < h - 1 && tiles[i + w] === 1) out.push(x, y + 1, x + 1, y + 1);
    }
  }
  return Float32Array.from(out);
}

/** Fog alpha byte per fog state (0 unexplored 100%, 1 explored 55%, 2 visible 0). */
export function fogAlpha(state: number): number {
  return state === 0 ? Math.round(PALETTE.fog.unexploredAlpha * 255) : state === 1 ? Math.round(PALETTE.fog.exploredAlpha * 255) : 0;
}

/** Fill an RGBA buffer with fog pixels for every tile. */
export function writeFogPixels(state: Uint8Array, out: Uint8ClampedArray): void {
  const [r, g, b] = parseHex(PALETTE.fog.color);
  const a0 = fogAlpha(0);
  const a1 = fogAlpha(1);
  for (let i = 0; i < state.length; i++) {
    const o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    const s = state[i];
    out[o + 3] = s === 0 ? a0 : s === 1 ? a1 : 0;
  }
}

/** Fill an RGBA buffer with the Blight fill (45%) for blighted tiles. */
export function writeBlightPixels(tiles: Uint8Array, out: Uint8ClampedArray): void {
  const [r, g, b] = parseHex(PALETTE.blight.fill);
  const a = Math.round(PALETTE.blight.fillAlpha * 255);
  for (let i = 0; i < tiles.length; i++) {
    const o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = tiles[i] === 1 ? a : 0;
  }
}

/** Is any tile of the footprint currently visible to the player? */
export function footprintVisible(fog: Uint8Array, mapW: number, mapH: number, tx: number, ty: number, w: number, h: number): boolean {
  const x0 = Math.max(0, Math.floor(tx));
  const y0 = Math.max(0, Math.floor(ty));
  const x1 = Math.min(mapW, Math.ceil(tx + w));
  const y1 = Math.min(mapH, Math.ceil(ty + h));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (fog[y * mapW + x] === 2) return true;
  return false;
}

export function footprintExplored(fog: Uint8Array, mapW: number, mapH: number, tx: number, ty: number, w: number, h: number): boolean {
  const x0 = Math.max(0, Math.floor(tx));
  const y0 = Math.max(0, Math.floor(ty));
  const x1 = Math.min(mapW, Math.ceil(tx + w));
  const y1 = Math.min(mapH, Math.ceil(ty + h));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (fog[y * mapW + x] !== 0) return true;
  return false;
}

/** Snapshot of a structure as last seen by the player. */
export interface GhostSnapshot {
  id: number;
  type: BuildingId;
  owner: Owner;
  tx: number;
  ty: number;
  w: number;
  h: number;
  hpFrac: number;
  built: boolean;
  spent: boolean;
  looted: boolean;
  lit: boolean;
}

export function snapshotOf(b: Building): GhostSnapshot {
  return {
    id: b.id,
    type: b.type,
    owner: b.owner,
    tx: b.tx,
    ty: b.ty,
    w: b.w,
    h: b.h,
    hpFrac: b.maxHp > 0 ? b.hp / b.maxHp : 1,
    built: b.built,
    spent: !!b.nest?.spent,
    looted: !!b.object?.done && b.object.kind === 'cache',
    lit: !!b.object?.lit,
  };
}

/**
 * Remembers non-player structures the player has seen. Call `update` once per frame: visible structures
 * refresh their snapshot; snapshots whose footprint is visible but whose building is gone are dropped.
 */
export class GhostTracker {
  readonly ghosts = new Map<number, GhostSnapshot>();

  update(world: World, visible: (b: { tx: number; ty: number; w: number; h: number }) => boolean): void {
    for (const b of world.buildings) {
      if (b.owner === 0 || !b.alive) continue;
      if (visible(b)) this.ghosts.set(b.id, snapshotOf(b));
      // Structures the encounter marks as seen (e.g. Cold Watch-Fire) are ghosted before first sight.
      else if (!this.ghosts.has(b.id) && (b.nest?.seen === true || b.object?.['seen'] === true)) this.ghosts.set(b.id, snapshotOf(b));
    }
    for (const [id, g] of this.ghosts) {
      const live = world.entities.get(id);
      if ((!live || !live.alive) && visible(g)) this.ghosts.delete(id);
    }
  }

  /** Forget a structure that died while visible. */
  remove(id: number): void {
    this.ghosts.delete(id);
  }

  clear(): void {
    this.ghosts.clear();
  }
}

// ---------------------------------------------------------------------------
// Layers (browser)
// ---------------------------------------------------------------------------

/** Soft-layer upsampling: SOFT px per tile, MARGIN tiles of clamped edge around the map. */
const SOFT = 4;
const MARGIN = 1;

/**
 * Upsample a 1-px-per-tile image into a blurred canvas (done only when the source version changes).
 * With `clamp`, the edge rows/columns are stretched into the margin so the blur does not fade at the map border.
 */
function soften(ctx: Ctx2D, raw: HTMLCanvasElement, w: number, h: number, blurPx: number, clamp: boolean): void {
  const W = (w + MARGIN * 2) * SOFT;
  const H = (h + MARGIN * 2) * SOFT;
  const o = MARGIN * SOFT;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.filter = `blur(${blurPx}px)`;
  if (clamp) {
    ctx.drawImage(raw, 0, 0, w, 1, o, 0, w * SOFT, o);
    ctx.drawImage(raw, 0, h - 1, w, 1, o, o + h * SOFT, w * SOFT, o);
    ctx.drawImage(raw, 0, 0, 1, h, 0, o, o, h * SOFT);
    ctx.drawImage(raw, w - 1, 0, 1, h, o + w * SOFT, o, o, h * SOFT);
  }
  ctx.drawImage(raw, o, o, w * SOFT, h * SOFT);
  ctx.filter = 'none';
}

export class BlightLayer {
  /** 1 px per tile (minimap). */
  readonly canvas: HTMLCanvasElement;
  /** Blurred, upsampled version drawn in the world. */
  readonly soft: HTMLCanvasElement;
  private readonly softCtx: Ctx2D;
  private readonly ctx: Ctx2D;
  private readonly img: ImageData;
  private version = -1;
  edges: Int32Array = new Int32Array(0);
  wardEdges: Float32Array = new Float32Array(0);
  any = false;
  private readonly w: number;
  private readonly h: number;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    const c = makeCanvas(w, h);
    this.canvas = c.canvas;
    this.ctx = c.ctx;
    this.img = this.ctx.createImageData(w, h);
    const sc = makeCanvas((w + MARGIN * 2) * SOFT, (h + MARGIN * 2) * SOFT);
    this.soft = sc.canvas;
    this.softCtx = sc.ctx;
  }

  sync(world: World): void {
    const bl = world.blight;
    if (!bl || bl.version === this.version) return;
    this.version = bl.version;
    writeBlightPixels(bl.tiles, this.img.data);
    this.ctx.putImageData(this.img, 0, 0);
    soften(this.softCtx, this.canvas, this.w, this.h, SOFT * 0.55, false);
    this.edges = blightEdgeTiles(bl.tiles, this.w, this.h);
    this.wardEdges = bl.ward ? wardEdgeSegments(bl.tiles, bl.ward, this.w, this.h) : new Float32Array(0);
    let any = false;
    for (let i = 0; i < bl.tiles.length; i++) if (bl.tiles[i] === 1) {
      any = true;
      break;
    }
    this.any = any;
  }

  draw(ctx: Ctx2D, tiles: Uint8Array, view: { x0: number; y0: number; x1: number; y1: number }, now: number): void {
    if (!this.any) return;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.soft, -MARGIN * T, -MARGIN * T, (this.w + MARGIN * 2) * T, (this.h + MARGIN * 2) * T);
    // Animated noise tendrils on visible edge tiles only: thin curling strands creeping outward from
    // the tile edge toward each clear neighbour (2 strands per open side, hash-varied).
    const w = this.w;
    ctx.beginPath();
    let n = 0;
    for (let k = 0; k < this.edges.length; k++) {
      const i = this.edges[k];
      const tx = i % w;
      const ty = (i - tx) / w;
      if (tx < view.x0 - 1 || tx > view.x1 + 1 || ty < view.y0 - 1 || ty > view.y1 + 1) continue;
      const cx = (tx + 0.5) * T;
      const cy = (ty + 0.5) * T;
      for (let d = 0; d < 4; d++) {
        const nx = d === 0 ? tx - 1 : d === 1 ? tx + 1 : tx;
        const ny = d === 2 ? ty - 1 : d === 3 ? ty + 1 : ty;
        if (nx < 0 || ny < 0 || nx >= w || ny >= this.h) continue;
        if (tiles[ny * w + nx] === 1) continue;
        const dx = nx - tx;
        const dy = ny - ty;
        for (let s = 0; s < 2; s++) {
          const h = ((i * 7919 + d * 104729 + s * 15485863) >>> 0) % 1000 / 1000;
          if (h < 0.25) continue;
          const ph = h * Math.PI * 2;
          // Start on the shared edge, offset along it.
          const along = (h - 0.5) * T * 0.8;
          const sx = cx + dx * T * 0.35 - dy * along;
          const sy = cy + dy * T * 0.35 + dx * along;
          const grow = 0.45 + 0.3 * h + 0.18 * Math.sin(now * (0.9 + h) + ph);
          const len = T * grow;
          const wob = Math.sin(now * (1.6 + h) + ph) * 7 * (0.5 + h);
          const curl = (h - 0.5) * 10;
          const mx = sx + dx * len * 0.5 - dy * wob;
          const my = sy + dy * len * 0.5 + dx * wob;
          const ex = sx + dx * len - dy * (curl - wob * 0.4);
          const ey = sy + dy * len + dx * (curl - wob * 0.4);
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(mx, my, ex, ey);
          n++;
        }
      }
    }
    // Ward ring edge (#FFB347 at 20%, plus a faint core line for readability).
    const we = this.wardEdges;
    if (we.length > 0) {
      ctx.beginPath();
      for (let k = 0; k < we.length; k += 4) {
        if (we[k] < view.x0 - 1 || we[k] > view.x1 + 1 || we[k + 1] < view.y0 - 1 || we[k + 1] > view.y1 + 1) continue;
        ctx.moveTo(we[k] * T, we[k + 1] * T);
        ctx.lineTo(we[k + 2] * T, we[k + 3] * T);
      }
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(PALETTE.blight.wardEdge, PALETTE.blight.wardAlpha);
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = rgba(PALETTE.blight.wardEdge, 0.45);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    if (n > 0) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(90,31,94,0.35)';
      ctx.lineWidth = 3.2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(160,79,184,0.8)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

export class FogLayer {
  /** 1 px per tile. */
  readonly canvas: HTMLCanvasElement;
  /** Blurred, upsampled version (world + minimap). */
  readonly soft: HTMLCanvasElement;
  private readonly softCtx: Ctx2D;
  private readonly ctx: Ctx2D;
  private readonly img: ImageData;
  private version = -1;
  private readonly w: number;
  private readonly h: number;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    const c = makeCanvas(w, h);
    this.canvas = c.canvas;
    this.ctx = c.ctx;
    this.img = this.ctx.createImageData(w, h);
    const sc = makeCanvas((w + MARGIN * 2) * SOFT, (h + MARGIN * 2) * SOFT);
    this.soft = sc.canvas;
    this.softCtx = sc.ctx;
  }

  /** Returns true when the fog image was redrawn. */
  sync(world: World): boolean {
    if (world.fog.version === this.version) return false;
    this.version = world.fog.version;
    writeFogPixels(world.fog.state, this.img.data);
    this.ctx.putImageData(this.img, 0, 0);
    soften(this.softCtx, this.canvas, this.w, this.h, SOFT * 0.6, true);
    return true;
  }

  draw(ctx: Ctx2D): void {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.soft, -MARGIN * T, -MARGIN * T, (this.w + MARGIN * 2) * T, (this.h + MARGIN * 2) * T);
  }

  /** Draw the soft fog fitted to a target rect (minimap). */
  drawFit(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
    const kx = w / this.w;
    const ky = h / this.h;
    ctx.drawImage(this.soft, x - MARGIN * kx, y - MARGIN * ky, w + MARGIN * 2 * kx, h + MARGIN * 2 * ky);
  }
}
