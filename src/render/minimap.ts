/**
 * Minimap (GDD §O): cached terrain colors, Blight, fog, resources, buildings in team colors, unit dots,
 * revealed final-wave enemies, Spent Nest pulses, alert pings and the camera frame.
 */
import { makeCanvas, type Ctx2D } from './canvas';
import { darken, lighten, mix, parseHex } from './colors';
import { footprintVisible, type GhostSnapshot } from './fogBlight';
import type { Ping } from './fx';
import { BIOMES } from '../data/biomes';
import { PALETTE } from '../data/palette';
import type { Camera } from './camera';
import { Terrain, type GameMap, type World } from '../sim/types';

/** Minimap color for one terrain tile (exported for tests). */
export function terrainMinimapColor(map: GameMap, t: number, variant: number): string {
  const pal = (BIOMES[map.biome] ?? BIOMES.greenmarch).palette;
  switch (t) {
    case Terrain.Forest:
      return variant & 1 ? pal.forest : mix(pal.forest, pal.forestHi, 0.35);
    case Terrain.Stump:
      return darken(mix(pal.grassA, pal.forest, 0.35), 0.05);
    case Terrain.Water:
      return pal.water;
    case Terrain.Shallows:
      return pal.shallows;
    case Terrain.Rock:
      return pal.rock;
    case Terrain.BriarWall:
      return map.biome === 'heartwood' ? pal.extra : '#5B2E4A';
    default:
      return variant & 2 ? pal.grassA : pal.grassB;
  }
}

const UNIT_PLAYER = '#FFD27A';
const UNIT_ENEMY = '#D46AF5';

export class Minimap {
  private base: HTMLCanvasElement | null = null;
  private baseCtx: Ctx2D | null = null;
  private img: ImageData | null = null;
  private map: GameMap | null = null;
  private dirty = true;

  /** Mark terrain as changed (tree felled). */
  invalidate(): void {
    this.dirty = true;
  }

  private syncBase(map: GameMap): void {
    if (this.map !== map || !this.base) {
      this.map = map;
      const c = makeCanvas(map.w, map.h);
      this.base = c.canvas;
      this.baseCtx = c.ctx;
      this.img = c.ctx.createImageData(map.w, map.h);
      this.dirty = true;
    }
    if (!this.dirty || !this.img || !this.baseCtx) return;
    this.dirty = false;
    const d = this.img.data;
    const cache = new Map<string, [number, number, number]>();
    for (let i = 0; i < map.w * map.h; i++) {
      const key = terrainMinimapColor(map, map.terrain[i], map.variant[i]);
      let rgb = cache.get(key);
      if (!rgb) {
        rgb = parseHex(key);
        cache.set(key, rgb);
      }
      const o = i * 4;
      d[o] = rgb[0];
      d[o + 1] = rgb[1];
      d[o + 2] = rgb[2];
      d[o + 3] = 255;
    }
    this.baseCtx.putImageData(this.img, 0, 0);
  }

  render(
    canvas: HTMLCanvasElement,
    world: World,
    cam: Camera,
    layers: { drawFog: ((ctx: Ctx2D, x: number, y: number, w: number, h: number) => void) | null; blight: HTMLCanvasElement | null; blightAny: boolean },
    ghosts: Iterable<GhostSnapshot>,
    revealed: ReadonlySet<number>,
    pings: readonly Ping[],
    now: number,
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const map = world.map;
    this.syncBase(map);
    const cw = canvas.width;
    const ch = canvas.height;
    const px = canvas.clientWidth > 0 ? cw / canvas.clientWidth : 1;
    const s = Math.min(cw / map.w, ch / map.h);
    const ox = (cw - map.w * s) / 2;
    const oy = (ch - map.h * s) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.fog.color;
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    if (this.base) ctx.drawImage(this.base, ox, oy, map.w * s, map.h * s);
    const reveal = world.debug?.revealAll ?? false;
    const fog = world.fog.state;
    const mw = map.w;
    if (layers.blight && layers.blightAny) {
      // Twice: the 45% fill is too faint at minimap scale.
      ctx.drawImage(layers.blight, ox, oy, map.w * s, map.h * s);
      ctx.drawImage(layers.blight, ox, oy, map.w * s, map.h * s);
    }
    // Resources (explored).
    for (const r of world.resources) {
      if (!r.alive) continue;
      if (!reveal && fog[Math.floor(r.ty) * mw + Math.floor(r.tx)] === 0) continue;
      ctx.fillStyle = r.type === 'thicket' ? PALETTE.resource.grain : PALETTE.resource.ember;
      const sz = Math.max(1.5 * px, r.w * s * (r.type === 'thicket' ? 0.9 : 0.8));
      ctx.fillRect(ox + (r.tx + r.w / 2) * s - sz / 2, oy + (r.ty + r.h / 2) * s - sz / 2, sz, sz);
    }
    // Buildings (own always; others when visible, else remembered ghosts).
    const pulse = 0.5 + 0.5 * Math.sin(now * 5);
    const drawB = (owner: number, type: string, tx: number, ty: number, w: number, h: number, spent: boolean): void => {
      const x = ox + tx * s;
      const y = oy + ty * s;
      const W = Math.max(2 * px, w * s);
      const H = Math.max(2 * px, h * s);
      const fill = owner === 0 ? PALETTE.player.body : owner === 1 ? (spent ? PALETTE.enemy.spentTint : '#9A4AC8') : PALETTE.neutral.accent;
      const edge = owner === 0 ? PALETTE.player.trim : owner === 1 ? PALETTE.enemy.thorn : PALETTE.neutral.outline;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, W, H);
      ctx.lineWidth = Math.max(1, px * 0.8);
      ctx.strokeStyle = edge;
      ctx.strokeRect(x + 0.5, y + 0.5, W - 1, H - 1);
      if (spent && (type === 'thorn_nest' || type === 'root_heart')) {
        const R = (Math.max(w, h) * s) / 2 + px * (3 + pulse * 5);
        ctx.beginPath();
        ctx.arc(x + W / 2, y + H / 2, R, 0, Math.PI * 2);
        ctx.lineWidth = 1.5 * px;
        ctx.strokeStyle = `rgba(232,163,61,${(0.35 + 0.5 * (1 - pulse)).toFixed(3)})`;
        ctx.stroke();
      }
    };
    const shown = new Set<number>();
    for (const b of world.buildings) {
      if (!b.alive) continue;
      const vis = b.owner === 0 || reveal || footprintVisible(fog, mw, map.h, b.tx, b.ty, b.w, b.h);
      if (!vis) continue;
      shown.add(b.id);
      drawB(b.owner, b.type, b.tx, b.ty, b.w, b.h, !!b.nest?.spent);
    }
    if (!reveal) for (const g of ghosts) if (!shown.has(g.id)) drawB(g.owner, g.type, g.tx, g.ty, g.w, g.h, g.spent);
    // Fog.
    if (!reveal && layers.drawFog) {
      ctx.imageSmoothingEnabled = true;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, map.w * s, map.h * s);
      ctx.clip();
      layers.drawFog(ctx, ox, oy, map.w * s, map.h * s);
      ctx.restore();
    }
    // Units.
    const dot = Math.max(1.6 * px, s * 0.7);
    for (const u of world.units) {
      if (!u.alive) continue;
      if (u.owner !== 0 && !reveal && !revealed.has(u.id)) {
        const tx = Math.floor(u.x);
        const ty = Math.floor(u.y);
        if (fog[ty * mw + tx] !== 2) continue;
      }
      const x = ox + u.x * s;
      const y = oy + u.y * s;
      const big = u.cls === 'hero' || u.cls === 'boss' || u.type === 'antlered_lord';
      const sz = big ? dot * 1.7 : dot;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - sz / 2 - px * 0.5, y - sz / 2 - px * 0.5, sz + px, sz + px);
      ctx.fillStyle = u.owner === 0 ? (u.cls === 'worker' ? lighten(UNIT_PLAYER, 0.35) : UNIT_PLAYER) : UNIT_ENEMY;
      ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
    // Pings.
    for (const p of pings) {
      const t = (now - p.born) / 3;
      if (t < 0 || t > 1) continue;
      const x = ox + p.x * s;
      const y = oy + p.y * s;
      for (const k of [0, 0.33]) {
        const tt = ((t * 3 + k * 3) % 1);
        ctx.beginPath();
        ctx.arc(x, y, px * (3 + tt * 12), 0, Math.PI * 2);
        ctx.lineWidth = 1.6 * px;
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = (1 - tt) * (1 - t * 0.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // Camera frame (play area above the bottom HUD).
    const vr = cam.visibleRect();
    const playBottom = vr.y0 + (cam.viewH - cam.bottomInset) / cam.scale;
    const fx0 = ox + Math.max(0, vr.x0) * s;
    const fy0 = oy + Math.max(0, vr.y0 + cam.topInset / cam.scale) * s;
    const fx1 = ox + Math.min(map.w, vr.x1) * s;
    const fy1 = oy + Math.min(map.h, playBottom) * s;
    ctx.lineWidth = Math.max(1, px);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeRect(fx0 + 0.5, fy0 + 0.5, fx1 - fx0 + 1, fy1 - fy0 + 1);
    ctx.strokeStyle = 'rgba(244,230,193,0.95)';
    ctx.strokeRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
  }
}
