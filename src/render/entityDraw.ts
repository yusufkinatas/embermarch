/**
 * Per-frame entity drawing: y-sorted units, buildings, resources and ghosts with live animation
 * (walk bob, lunge/recoil, hit flash, carried loads, rank chevrons, burning, rooted vines, buff glows,
 * Hearth/brazier flames, Nest pulses, Grainplot furrows, construction scaffolds, damage smoke/fire).
 */
import { beaconPit, brazierBowl, forgeChimney, GRAINPLOT_FIELD, nestCore, SPIRE_TIP } from './buildingArt';
import type { Ctx2D } from './canvas';
import { mix, teamColors } from './colors';
import { footprintVisible, type GhostSnapshot } from './fogBlight';
import type { FxSystem, UnitSnapshot } from './fx';
import { doctrineGlyph, drawGlyph, temperGlyph } from './glyphs';
import { circlePath, drawFlame, hash01, polyPath, T, TAU } from './shapes';
import { thicketDots, type SpriteCache } from './sprites';
import type { ViewRect } from './terrain';
import { brandbowFlameTip, gloamwitchOrb, unitBodyRadius } from './unitArt';
import { PALETTE } from '../data/palette';
import { UNITS } from '../data/units';
import { TICK_DT, type Building, type DoctrineId, type ResourceNode, type Unit, type World } from '../sim/types';

export interface PaintFrame {
  ctx: Ctx2D;
  world: World;
  /** Render clock (seconds, always advancing). */
  now: number;
  /** FX dt this frame (0 while paused). */
  dt: number;
  alpha: number;
  view: ViewRect;
  revealAll: boolean;
}

type Drawable =
  | { y: number; k: 0; u: Unit; px: number; py: number }
  | { y: number; k: 1; b: Building }
  | { y: number; k: 2; r: ResourceNode }
  | { y: number; k: 3; g: GhostSnapshot };

const BUFF_GLOW: Record<string, string> = {
  rallying_horn: '#FFD27A',
  harvest_hymn: '#F2D45C',
  rally_hearth: '#FFB347',
  last_stand: '#FFF1C8',
  enrage: '#FF4A3A',
};

export class EntityPainter {
  private list: Drawable[] = [];
  /** Accumulated pulse phase per Nest (frequency changes with muster progress). */
  private nestPhase = new Map<number, number>();
  /** Last seen render state per unit (death animation facing). */
  readonly snapshots = new Map<number, UnitSnapshot>();
  /** Units drawn this frame with their interpolated position (for overlays). */
  readonly drawnUnits: { u: Unit; x: number; y: number }[] = [];
  readonly drawnBuildings: Building[] = [];
  private snapshotSweep = 0;

  constructor(
    private readonly sprites: SpriteCache,
    private readonly fx: FxSystem,
  ) {}

  reset(): void {
    this.nestPhase.clear();
    this.snapshots.clear();
  }

  isUnitVisible(world: World, u: Unit, revealAll: boolean): boolean {
    if (u.owner === 0 || revealAll) return true;
    const tx = Math.floor(u.x);
    const ty = Math.floor(u.y);
    if (tx < 0 || ty < 0 || tx >= world.map.w || ty >= world.map.h) return false;
    return world.fog.state[ty * world.map.w + tx] === 2;
  }

  /** Shadows for every visible unit (one batched fill). */
  private drawShadows(f: PaintFrame): void {
    const { ctx } = f;
    ctx.beginPath();
    for (const d of this.drawnUnits) {
      const u = d.u;
      const big = u.cls === 'cavalry' || u.cls === 'siege';
      const r = unitBodyRadius(u.type);
      const rx = big ? Math.max(r * 1.25, 13) : r * 1.05;
      const ry = big ? Math.max(r * 0.6, 7) : r * 0.55;
      ctx.moveTo(d.x + rx, d.y + 3 + r * 0.45);
      ctx.ellipse(d.x, d.y + 3 + r * 0.45, rx, ry, 0, 0, TAU);
    }
    ctx.fillStyle = PALETTE.shadow;
    ctx.fill();
  }

  /** Collect and y-sort every visible entity in view (fills drawnUnits / drawnBuildings). */
  collect(f: PaintFrame, ghosts: Iterable<GhostSnapshot>): void {
    const { world, view } = f;
    const list = this.list;
    list.length = 0;
    this.drawnUnits.length = 0;
    this.drawnBuildings.length = 0;
    const vx0 = view.x0 - 3;
    const vy0 = view.y0 - 3;
    const vx1 = view.x1 + 3;
    const vy1 = view.y1 + 4;
    const fog = world.fog.state;
    const mw = world.map.w;
    for (const r of world.resources) {
      if (!r.alive || r.tx + r.w < vx0 || r.tx > vx1 || r.ty + r.h < vy0 || r.ty > vy1) continue;
      if (!f.revealAll && fog[Math.floor(r.ty + r.h / 2) * mw + Math.floor(r.tx + r.w / 2)] === 0) continue;
      list.push({ y: (r.ty + r.h) * T - 1, k: 2, r });
    }
    const seenGhost = new Set<number>();
    for (const b of world.buildings) {
      if (!b.alive || b.tx + b.w < vx0 || b.tx > vx1 || b.ty + b.h < vy0 || b.ty > vy1) continue;
      if (b.owner !== 0 && !f.revealAll && !footVisible(world, b)) continue;
      list.push({ y: buildingSortY(b), k: 1, b });
      seenGhost.add(b.id);
      this.drawnBuildings.push(b);
    }
    if (!f.revealAll) {
      for (const g of ghosts) {
        if (seenGhost.has(g.id) || g.tx + g.w < vx0 || g.tx > vx1 || g.ty + g.h < vy0 || g.ty > vy1) continue;
        list.push({ y: buildingSortY(g), k: 3, g });
      }
    }
    const a = f.alpha;
    for (const u of world.units) {
      if (!u.alive) continue;
      const x = u.prevX + (u.x - u.prevX) * a;
      const y = u.prevY + (u.y - u.prevY) * a;
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      if (!this.isUnitVisible(world, u, f.revealAll)) continue;
      list.push({ y: y * T, k: 0, u, px: x * T, py: y * T });
      this.drawnUnits.push({ u, x: x * T, y: y * T });
      let s = this.snapshots.get(u.id);
      if (!s) {
        s = { type: u.type, owner: u.owner, facing: u.facing, x, y };
        this.snapshots.set(u.id, s);
      } else {
        s.facing = u.facing;
        s.x = x;
        s.y = y;
      }
    }
    // Forget snapshots of long-gone units occasionally.
    if (++this.snapshotSweep > 300) {
      this.snapshotSweep = 0;
      for (const id of this.snapshots.keys()) if (!world.entities.has(id)) this.snapshots.delete(id);
    }
    list.sort((p, q) => p.y - q.y);
  }

  /** Draw what `collect` gathered: unit shadows, dying units, then the sorted entities. */
  draw(f: PaintFrame): void {
    this.drawShadows(f);
    this.fx.drawCorpses(f.ctx);
    for (const d of this.list) {
      if (d.k === 0) this.drawUnit(f, d.u, d.px, d.py);
      else if (d.k === 1) this.drawBuilding(f, d.b);
      else if (d.k === 2) this.drawResource(f, d.r);
      else this.drawGhost(f, d.g);
    }
  }

  // -------------------------------------------------------------------------
  // Units
  // -------------------------------------------------------------------------

  private drawUnit(f: PaintFrame, u: Unit, x: number, y: number): void {
    const { ctx, now } = f;
    const def = UNITS[u.type];
    const r = unitBodyRadius(u.type);
    const speed = Math.hypot(u.vx, u.vy);
    const moving = speed > 0.12;
    let ox = 0;
    let oy = 0;
    // Walk bob (a little hop; the shadow stays on the ground).
    const phase = now * (7 + speed * 2.2) + u.id * 1.37;
    const bob = moving ? -Math.abs(Math.sin(phase)) * (u.cls === 'cavalry' ? 2 : 1.6) : 0;
    // Attack lunge (melee) / recoil (ranged), 2 px along facing.
    const since = (f.world.tick + f.alpha - u.lastAttackTick) * TICK_DT;
    if (u.lastAttackTick > 0 && since >= 0 && since < 0.24) {
      const k = Math.sin((since / 0.24) * Math.PI) * 2.2;
      const dir = def.range >= 1.5 ? -1 : 1;
      ox += Math.cos(u.facing) * k * dir;
      oy += Math.sin(u.facing) * k * dir;
    }
    const [rx, ry] = this.fx.recoilOf(u.id);
    ox += rx;
    oy += ry;
    // Buff glow under the unit.
    let glow: string | null = null;
    for (const b of u.buffs) {
      if (b.until > f.world.tick && BUFF_GLOW[b.id]) {
        glow = BUFF_GLOW[b.id];
        break;
      }
    }
    if (glow) {
      const g = this.sprites.glow(glow);
      const R = r * 2.1 * (1 + 0.08 * Math.sin(now * 5 + u.id));
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      ctx.drawImage(g.canvas, x - R, y + 2 - R * 0.6, R * 2, R * 1.2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    const px = x + ox;
    const py = y + oy + bob;
    const s = this.sprites.unit(u.type, u.owner, u.facing);
    ctx.drawImage(s.canvas, px - s.ox, py - s.oy, s.w, s.h);
    // Type-specific live extras.
    if (u.type === 'tiller' && u.carry && u.carry.amount > 0) this.drawCarry(ctx, u, px, py);
    else if (u.type === 'brandbow') {
      const [tx, ty] = brandbowFlameTip(u.facing);
      const fl = 0.6 + 0.4 * Math.sin(now * 23 + u.id) * Math.sin(now * 13 + u.id * 2);
      ctx.beginPath();
      circlePath(ctx, px + tx, py + ty - 1, 1.6 + fl);
      ctx.fillStyle = `rgba(255,${180 + Math.round(fl * 60)},90,0.95)`;
      ctx.fill();
    } else if (u.type === 'gloamwitch') {
      const [gx, gy] = gloamwitchOrb(u.facing);
      const oyb = Math.sin(now * 2.6 + u.id) * 2.2;
      const g = this.sprites.glow(PALETTE.enemy.thorn);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.65;
      ctx.drawImage(g.canvas, px + gx - 10, py + gy + oyb - 10, 20, 20);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      circlePath(ctx, px + gx, py + gy + oyb, 3.2);
      ctx.fillStyle = '#C8F58A';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = PALETTE.enemy.outline;
      ctx.stroke();
    } else if (u.type === 'lampbearer') {
      const g = this.sprites.glow('#FFD27A');
      const R = 14 + Math.sin(now * 6 + u.id) * 1.5;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.3;
      ctx.drawImage(g.canvas, px - R, py - R, R * 2, R * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    } else if (u.type === 'briar_regent' && u.untargetable) {
      // Warded shield shimmer.
      const R = r * 1.55;
      ctx.beginPath();
      ctx.ellipse(px, py, R, R * 0.92, 0, 0, TAU);
      ctx.fillStyle = 'rgba(160,200,255,0.10)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(190,225,255,${(0.45 + 0.25 * Math.sin(now * 3)).toFixed(3)})`;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(px, py, R, R * 0.92, 0, now * 0.8, now * 0.8 + 1.2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(235,245,255,0.6)';
      ctx.stroke();
    }
    // Hit flash.
    const flash = this.fx.flashOf(u.id);
    if (flash > 0) {
      const w = this.sprites.unitFlash(u.type, u.owner, u.facing);
      ctx.globalAlpha = 0.85 * flash;
      ctx.drawImage(w.canvas, px - w.ox, py - w.oy, w.w, w.h);
      ctx.globalAlpha = 1;
    }
    // Rooted vines.
    if (u.buffs.some((b) => b.id === 'rooted' && b.until > f.world.tick)) this.drawVines(ctx, x, y, r, now);
    // Burning.
    if (u.burns.length > 0) {
      const n = Math.min(3, u.burns.length + 1);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + u.id;
        drawFlame(ctx, px + Math.cos(a) * r * 0.55, py + Math.sin(a) * r * 0.35 + 2, 6 + (i % 2) * 2, now, u.id + i);
      }
      if (f.dt > 0 && Math.random() < f.dt * 6) this.fx.spawn({ kind: 'smoke', x: px, y: py, z: 8, vz: 18, vx: (Math.random() - 0.5) * 6, g: -4, life: 0.9, size: 2.5, grow: 5, color: '#4A4440', alpha: 0.45 });
    }
    // Rank chevrons and the Rank III gold banner.
    if (u.rank > 0) this.drawRank(ctx, u.rank, px, py, r);
  }

  private drawCarry(ctx: Ctx2D, u: Unit, x: number, y: number): void {
    const c = u.carry;
    if (!c) return;
    const back = u.facing + Math.PI;
    const bx = x + Math.cos(back) * 6;
    const by = y + Math.sin(back) * 5 - 2;
    const outline = PALETTE.player.outline;
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = outline;
    if (c.type === 'grain') {
      ctx.beginPath();
      ctx.ellipse(bx, by, 4.6, 4, 0, 0, TAU);
      ctx.fillStyle = PALETTE.resource.grain;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx - 1.5, by - 3.6);
      ctx.lineTo(bx + 1.5, by - 3.6);
      ctx.stroke();
    } else if (c.type === 'timber') {
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(u.facing + Math.PI / 2);
      ctx.beginPath();
      ctx.rect(-7, -2.4, 14, 4.8);
      ctx.fillStyle = PALETTE.resource.timber;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(7, 0, 1.4, 2.4, 0, 0, TAU);
      ctx.fillStyle = '#C99560';
      ctx.fill();
      ctx.restore();
    } else {
      const g = this.sprites.glow(PALETTE.resource.emberGlow);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6;
      ctx.drawImage(g.canvas, bx - 8, by - 8, 16, 16);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      polyPath(ctx, [bx - 3.5, by + 1, bx - 1.5, by - 3.5, bx + 3, by - 2.5, bx + 3.8, by + 2, bx, by + 3.6]);
      ctx.fillStyle = PALETTE.resource.ember;
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawRank(ctx: Ctx2D, rank: number, x: number, y: number, r: number): void {
    const cx = x + r * 0.95;
    const cy = y - r * 0.95;
    if (rank >= 3) {
      // Gold banner on a short pole.
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = '#2B1D0E';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.9, y - r * 0.2);
      ctx.lineTo(x - r * 0.9, y - r - 12);
      ctx.stroke();
      ctx.beginPath();
      polyPath(ctx, [x - r * 0.9, y - r - 12, x - r * 0.9 + 9, y - r - 10, x - r * 0.9, y - r - 6]);
      ctx.fillStyle = '#F2C14E';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.lineJoin = 'miter';
    for (let i = 0; i < Math.min(3, rank); i++) {
      const yy = cy - i * 3.2;
      ctx.beginPath();
      ctx.moveTo(cx - 3.4, yy + 1.6);
      ctx.lineTo(cx, yy - 1.4);
      ctx.lineTo(cx + 3.4, yy + 1.6);
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = '#2B1D0E';
      ctx.stroke();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = rank >= 3 ? '#F2C14E' : '#F4E6C1';
      ctx.stroke();
    }
    ctx.lineJoin = 'round';
  }

  private drawVines(ctx: Ctx2D, x: number, y: number, r: number, now: number): void {
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      const sx = x + Math.cos(a) * (r + 4);
      const sy = y + r * 0.4 + Math.sin(a) * (r * 0.5 + 2);
      const sway = Math.sin(now * 3 + i) * 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(x + Math.cos(a + 0.8) * r * 0.9 + sway, y + Math.sin(a + 0.8) * r * 0.7 - 3, x + Math.cos(a + 1.5) * r * 0.5, y + Math.sin(a + 1.5) * r * 0.4 - 5);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#2A3A1A';
      ctx.stroke();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = '#6FA83E';
      ctx.stroke();
      ctx.beginPath();
      circlePath(ctx, sx, sy - 1, 1.6);
      ctx.fillStyle = PALETTE.enemy.thorn;
      ctx.fill();
    }
  }

  // -------------------------------------------------------------------------
  // Buildings
  // -------------------------------------------------------------------------

  private drawBuilding(f: PaintFrame, b: Building): void {
    const { ctx, now } = f;
    const x0 = b.tx * T;
    const y0 = b.ty * T;
    const W = b.w * T;
    const H = b.h * T;
    const spent = !!b.nest?.spent;
    const looted = !!(b.object && b.object.kind === 'cache' && b.object.done);
    if (!b.built) {
      this.drawConstruction(f, b);
      return;
    }
    const s = this.sprites.building(b.type, b.owner, b.w, b.h, { spent, looted });
    if (spent) {
      // Droop: squash toward the ground line.
      const k = 0.92;
      ctx.drawImage(s.canvas, x0 - s.ox, y0 - s.oy + (s.h * (1 - k)) - 0, s.w, s.h * k);
    } else {
      ctx.drawImage(s.canvas, x0 - s.ox, y0 - s.oy, s.w, s.h);
    }
    this.drawBuildingLive(f, b, x0, y0, W, H, spent);
    // Damage smoke (< 50%) and fire (< 25%).
    if (b.maxHp > 0 && !b.invulnerable && b.hp < b.maxHp * 0.5) {
      const frac = b.hp / b.maxHp;
      if (frac < 0.25) {
        const n = Math.min(4, 1 + Math.floor((b.w * b.h) / 3));
        for (let i = 0; i < n; i++) {
          const fx = x0 + W * (0.25 + 0.5 * hash01(b.id, i));
          const fy = y0 + H * (0.35 + 0.35 * hash01(i, b.id));
          drawFlame(ctx, fx, fy, 9 + 3 * hash01(b.id, i, 2), now, b.id + i);
        }
      }
      if (f.dt > 0 && Math.random() < f.dt * (frac < 0.25 ? 9 : 4) * Math.min(2, b.w * 0.6)) {
        const sx = x0 + W * (0.2 + 0.6 * Math.random());
        const sy = y0 + H * (0.3 + 0.3 * Math.random());
        this.fx.spawn({ kind: 'smoke', x: sx, y: sy, z: 6, vx: 4 + Math.random() * 4, vy: -2, vz: 22 + Math.random() * 10, g: -6, drag: 0.4, life: 1.6, size: 3.5, grow: 7, color: frac < 0.25 ? '#3A3634' : '#6A6460', alpha: 0.5 });
      }
    }
  }

  private drawConstruction(f: PaintFrame, b: Building): void {
    const { ctx } = f;
    const x0 = b.tx * T;
    const y0 = b.ty * T;
    const W = b.w * T;
    const H = b.h * T;
    const p = Math.max(0, Math.min(1, b.buildProgress));
    // Foundation plot.
    ctx.fillStyle = 'rgba(92,65,40,0.55)';
    ctx.fillRect(x0 + 2, y0 + 2, W - 4, H - 4);
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(244,230,193,0.7)';
    ctx.strokeRect(x0 + 2.5, y0 + 2.5, W - 5, H - 5);
    ctx.setLineDash([]);
    // Partial building rising from the ground.
    if (p > 0.02) {
      const s = this.sprites.building(b.type, b.owner, b.w, b.h);
      const top = y0 - s.oy;
      const bottom = top + s.h;
      const cut = bottom - (bottom - top) * p;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 - s.ox, cut, s.w, bottom - cut);
      ctx.clip();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(s.canvas, x0 - s.ox, top, s.w, s.h);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // Scaffold: corner poles and rungs filling with progress.
    const poleH = H * 0.9 + 10;
    const levels = Math.max(2, Math.round(b.h * 2.5));
    const filled = Math.ceil(levels * p);
    ctx.lineCap = 'round';
    const wood = '#9A6A3C';
    const pole = (x: number): void => {
      ctx.beginPath();
      ctx.moveTo(x, y0 + H - 2);
      ctx.lineTo(x, y0 + H - 2 - poleH);
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = '#2B1D0E';
      ctx.stroke();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = wood;
      ctx.stroke();
    };
    pole(x0 + 4);
    pole(x0 + W - 4);
    if (b.w >= 3) pole(x0 + W / 2);
    for (let i = 0; i < filled; i++) {
      const yy = y0 + H - 4 - (poleH - 6) * ((i + 0.5) / levels);
      ctx.beginPath();
      ctx.moveTo(x0 + 3, yy);
      ctx.lineTo(x0 + W - 3, yy);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#2B1D0E';
      ctx.stroke();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = i === filled - 1 ? '#D9B07A' : wood;
      ctx.stroke();
      if (i % 2 === 0) {
        ctx.beginPath();
        ctx.moveTo(x0 + 4, yy);
        ctx.lineTo(x0 + W / 2, yy - (poleH - 6) / levels);
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = wood;
        ctx.stroke();
      }
    }
  }

  private drawBuildingLive(f: PaintFrame, b: Building, x0: number, y0: number, W: number, H: number, spent: boolean): void {
    const { ctx, now } = f;
    switch (b.type) {
      case 'hearth': {
        const cx = x0 + W / 2;
        const cy = y0 + H / 2;
        const pulse = 1 + 0.1 * Math.sin(now * 2.4) + 0.04 * Math.sin(now * 7.1);
        const g = this.sprites.glow('#FFB347');
        const R = W * 0.75 * pulse;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.32;
        ctx.drawImage(g.canvas, cx - R, cy - R * 0.85, R * 2, R * 1.7);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        drawFlame(ctx, cx, cy + 8, 30 * (0.95 + 0.05 * pulse), now, 1);
        drawFlame(ctx, cx - 9, cy + 9, 16, now + 0.3, 2);
        drawFlame(ctx, cx + 9, cy + 10, 14, now + 0.7, 3);
        if (f.dt > 0 && Math.random() < f.dt * 5) this.fx.spawn({ kind: 'spark', x: cx + (Math.random() - 0.5) * 16, y: cy + 4, z: 20, vx: (Math.random() - 0.5) * 10, vz: 30 + Math.random() * 25, g: 6, life: 1.2, size: 1.5, color: '#FFC46A', add: true });
        break;
      }
      case 'brazier_tower': {
        const [bx, by] = brazierBowl(W);
        const g = this.sprites.glow('#FFB347');
        const R = 30 + Math.sin(now * 3 + b.id) * 2;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35;
        ctx.drawImage(g.canvas, x0 + bx - R, y0 + by - R, R * 2, R * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        drawFlame(ctx, x0 + bx, y0 + by + 1, 16, now, b.id);
        break;
      }
      case 'forgehall': {
        const [cx, cy] = forgeChimney(W);
        const g = this.sprites.glow('#FF6A2B');
        const k = 0.5 + 0.2 * Math.sin(now * 4 + b.id);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k;
        ctx.drawImage(g.canvas, x0 + cx - 12, y0 + cy - 9, 24, 18);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        if (f.dt > 0 && Math.random() < f.dt * 2.5) this.fx.spawn({ kind: 'smoke', x: x0 + cx, y: y0 + cy + 20, z: 22, vx: 5, vz: 16, g: -5, drag: 0.3, life: 1.8, size: 3, grow: 6, color: '#5A5654', alpha: 0.4 });
        const temper = temperGlyph(f.world.players[b.owner]?.temper ?? null);
        if (temper) {
          const px = x0 + W / 2 - 22;
          const py = y0 + H * 0.26;
          ctx.beginPath();
          ctx.ellipse(px, py, 11, 10, 0, 0, TAU);
          ctx.fillStyle = '#2A2420';
          ctx.fill();
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = PALETTE.player.body;
          ctx.stroke();
          drawGlyph(ctx, temper, px, py, 15, '#F4E6C1', '#2B1D0E');
        }
        break;
      }
      case 'grainplot': {
        const fx = x0 + GRAINPLOT_FIELD.x;
        const fy = y0 + GRAINPLOT_FIELD.y;
        const ripe = Math.max(0, Math.min(1, b.ripeness));
        const col = mix(PALETTE.resource.grainplotUnripe, PALETTE.resource.grainplotRipe, ripe);
        const rows = 6;
        const rh = GRAINPLOT_FIELD.h / rows;
        for (let i = 0; i < rows; i++) {
          const yy = fy + i * rh + rh * 0.5;
          ctx.fillStyle = 'rgba(40,26,14,0.5)';
          ctx.fillRect(fx, yy + rh * 0.18, GRAINPLOT_FIELD.w, rh * 0.22);
          ctx.fillStyle = col;
          ctx.fillRect(fx + 1, yy - rh * 0.28, GRAINPLOT_FIELD.w - 2, rh * 0.42);
          // Stalk tips sway when worked.
          const sway = b.gatherers > 0 ? Math.sin(now * 3 + i) * 1 : 0;
          ctx.fillStyle = mix(col, '#FFF4C0', 0.25 * ripe);
          for (let k = 0; k < 7; k++) ctx.fillRect(fx + 3 + k * 7.2 + sway, yy - rh * 0.4, 2, 2 + ripe * 1.5);
        }
        break;
      }
      case 'thorn_nest':
      case 'root_heart': {
        const nest = b.nest;
        const scale = b.type === 'root_heart' ? 1.12 : 1;
        const [cx, cy, cr] = nestCore(W, H, scale);
        const progress = nest?.musterProgress ?? 0;
        const freq = spent ? 0.5 : 1.1 + 3.4 * Math.max(0, Math.min(1, progress));
        const ph = (this.nestPhase.get(b.id) ?? hash01(b.id) * 6) + f.dt * freq * TAU;
        this.nestPhase.set(b.id, ph);
        let pulse: number;
        if (b.type === 'root_heart') {
          // Heartbeat: two quick beats per cycle.
          const t = (ph / TAU) % 1;
          pulse = Math.max(Math.exp(-((t - 0.1) ** 2) / 0.004), 0.7 * Math.exp(-((t - 0.28) ** 2) / 0.004));
        } else pulse = 0.5 + 0.5 * Math.sin(ph);
        const color = spent ? '#9A8E88' : b.type === 'root_heart' ? '#D0407A' : '#B06AD8';
        const g = this.sprites.glow(color);
        const R = cr * (2.2 + pulse * 0.9);
        const dy = spent ? H * 0.06 : 0;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = spent ? 0.18 : 0.35 + 0.4 * pulse;
        ctx.drawImage(g.canvas, x0 + cx - R, y0 + cy + dy - R * 0.75, R * 2, R * 1.5);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath();
        ctx.ellipse(x0 + cx, y0 + cy + dy, cr * (0.55 + 0.2 * pulse), cr * (0.4 + 0.15 * pulse), 0, 0, TAU);
        ctx.fillStyle = spent ? '#6A605C' : b.type === 'root_heart' ? '#F06A9A' : '#D49AF0';
        ctx.fill();
        // Doctrine banner above the Nest.
        const doctrine = (f.world.encounter?.doctrine ?? 'swarm') as DoctrineId;
        this.drawNestBanner(ctx, x0 + W * 0.78, y0 + H * 0.3 + dy, doctrine, spent, now, b.id);
        break;
      }
      case 'thornspire': {
        const g = this.sprites.glow(PALETTE.enemy.thorn);
        const k = 0.55 + 0.3 * Math.sin(now * 3.3 + b.id);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k;
        ctx.drawImage(g.canvas, x0 + SPIRE_TIP[0] - 12, y0 + SPIRE_TIP[1] - 12, 24, 24);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath();
        circlePath(ctx, x0 + SPIRE_TIP[0], y0 + SPIRE_TIP[1] + 2, 2.4);
        ctx.fillStyle = '#E2FFB0';
        ctx.fill();
        break;
      }
      case 'beacon_stone': {
        const o = b.object;
        const [px, py] = beaconPit(W, H);
        const cx = x0 + px;
        const cy = y0 + py;
        if (o?.lit) {
          const g = this.sprites.glow('#FFB347');
          const R = 36 + Math.sin(now * 3) * 3;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.45;
          ctx.drawImage(g.canvas, cx - R, cy - R, R * 2, R * 2);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          drawFlame(ctx, cx, cy + 3, 20, now, b.id);
          const snuff = typeof o.snuffProgress === 'number' ? o.snuffProgress : 0;
          if (snuff > 0) {
            ctx.beginPath();
            ctx.ellipse(cx, cy, 26, 21, 0, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, snuff));
            ctx.lineWidth = 3.5;
            ctx.strokeStyle = PALETTE.ui.danger;
            ctx.stroke();
          }
        } else {
          // Dormant flicker.
          const fl = Math.max(0, Math.sin(now * 9 + b.id) * Math.sin(now * 3.7)) * 0.6;
          const g = this.sprites.glow('#FF8A3D');
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.12 + fl * 0.4;
          ctx.drawImage(g.canvas, cx - 12, cy - 10, 24, 20);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          if (fl > 0.3) drawFlame(ctx, cx, cy + 2, 6 + fl * 4, now, b.id);
          const p = o?.progress ?? 0;
          if (p > 0) {
            ctx.beginPath();
            ctx.ellipse(cx, cy, 26, 21, 0, -Math.PI / 2, -Math.PI / 2 + TAU * p);
            ctx.lineWidth = 3.5;
            ctx.strokeStyle = PALETTE.ui.accent;
            ctx.stroke();
          }
        }
        break;
      }
      case 'ruined_cache':
      case 'ancient_cache': {
        if (b.object?.done) break;
        const t = (now * 0.6 + hash01(b.id) * 3) % 2.2;
        if (t < 0.5) {
          const k = Math.sin((t / 0.5) * Math.PI);
          const gx = x0 + W / 2 + 5;
          const gy = y0 + H - (b.type === 'ancient_cache' ? 26 : 20);
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = `rgba(255,236,160,${(0.9 * k).toFixed(3)})`;
          ctx.beginPath();
          polyPath(ctx, [gx, gy - 6 * k, gx + 1.2, gy - 1.2, gx + 6 * k, gy, gx + 1.2, gy + 1.2, gx, gy + 6 * k, gx - 1.2, gy + 1.2, gx - 6 * k, gy, gx - 1.2, gy - 1.2]);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
        if (b.type === 'ancient_cache') {
          const g = this.sprites.glow('#9FE0F0');
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.25 + 0.15 * Math.sin(now * 2);
          ctx.drawImage(g.canvas, x0 + W / 2 - 14, y0 + H - 30, 28, 28);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
        break;
      }
      case 'briar_throne': {
        const g = this.sprites.glow(PALETTE.enemy.thorn);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.2 + 0.12 * Math.sin(now * 1.6);
        ctx.drawImage(g.canvas, x0 + W / 2 - 40, y0 + H / 2 - 60, 80, 70);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      default:
        break;
    }
  }

  private drawNestBanner(ctx: Ctx2D, px: number, py: number, doctrine: DoctrineId, spent: boolean, now: number, id: number): void {
    const pal = teamColors(1);
    const tilt = spent ? 0.45 : Math.sin(now * 1.5 + id) * 0.05;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -36);
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4A2E3E';
    ctx.stroke();
    const wave = Math.sin(now * 3 + id) * 1.5;
    ctx.beginPath();
    polyPath(ctx, [1, -36, 17, -35 + wave, 17, -18 + wave, 9, -21 + wave * 0.5, 1, -17]);
    ctx.fillStyle = spent ? '#7A706A' : '#5A2A70';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
    drawGlyph(ctx, doctrineGlyph(doctrine), 9, -27 + wave * 0.5, 12, spent ? '#B8B0A8' : PALETTE.enemy.thorn, pal.outline);
    ctx.restore();
  }

  private drawGhost(f: PaintFrame, g: GhostSnapshot): void {
    const { ctx } = f;
    const s = this.sprites.building(g.type, g.owner, g.w, g.h, { spent: g.spent, looted: g.looted });
    ctx.globalAlpha = 0.9;
    ctx.drawImage(s.canvas, g.tx * T - s.ox, g.ty * T - s.oy, s.w, s.h);
    ctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------

  private drawResource(f: PaintFrame, r: ResourceNode): void {
    const { ctx, now } = f;
    const x0 = r.tx * T;
    const y0 = r.ty * T;
    if (r.type === 'thicket') {
      const s = this.sprites.thicket(thicketDots(r.amount, r.initial));
      ctx.drawImage(s.canvas, x0 - s.ox, y0 - s.oy, s.w, s.h);
    } else {
      const frac = r.initial > 0 ? r.amount / r.initial : 1;
      const s = this.sprites.seam(r.w, r.h, frac <= 0.05);
      ctx.drawImage(s.canvas, x0 - s.ox, y0 - s.oy, s.w, s.h);
      if (frac > 0.05) {
        const g = this.sprites.glow(PALETTE.resource.ember);
        const k = (0.25 + 0.15 * Math.sin(now * 2.2 + r.id)) * (0.4 + 0.6 * frac);
        const W = r.w * T;
        const H = r.h * T;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k;
        ctx.drawImage(g.canvas, x0 + W * 0.05, y0 + H * 0.1, W * 0.9, H * 0.85);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }
}

function footVisible(world: World, b: Building): boolean {
  return footprintVisible(world.fog.state, world.map.w, world.map.h, b.tx, b.ty, b.w, b.h);
}

/**
 * Y-sort key for a structure: its bottom edge, so units south of it draw on top. The Briar Throne is a dais
 * the Regent stands on, so it sorts by its top band instead.
 */
export function buildingSortY(b: { type?: string; ty: number; h: number }): number {
  if (b.type === 'briar_throne') return (b.ty + 1) * T;
  return (b.ty + b.h) * T - 2;
}
