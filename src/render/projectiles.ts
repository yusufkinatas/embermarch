/**
 * Projectiles drawn from world.projectiles (GDD §P juice 7): arrows arc with a ground shadow and a short
 * trail, bolts glow, spines are green darts, the Firepot arcs high. A tracker reports projectiles that
 * vanished so impact fx (and the Firepot fire decal) can spawn.
 */
import type { Ctx2D } from './canvas';
import { T } from './shapes';
import type { SpriteCache } from './sprites';
import { PALETTE } from '../data/palette';
import type { ProjectileKind, World } from '../sim/types';

/** Arc height in world px for a projectile kind over a flight of `dist` tiles. */
export function arcHeight(kind: ProjectileKind, dist: number): number {
  switch (kind) {
    case 'arrow':
    case 'fire_arrow':
      return Math.min(1.5, dist * 0.14) * T;
    case 'spine':
      return Math.min(0.8, dist * 0.08) * T;
    case 'firepot':
      return Math.min(2.6, 0.6 + dist * 0.28) * T;
    default:
      return 0;
  }
}

/** Flight progress 0..1 from start to (moving) target. */
export function flightProgress(sx: number, sy: number, x: number, y: number, tx: number, ty: number): number {
  const total = Math.hypot(tx - sx, ty - sy);
  if (total < 1e-6) return 1;
  const left = Math.hypot(tx - x, ty - y);
  return Math.max(0, Math.min(1, 1 - left / total));
}

interface Tracked {
  kind: ProjectileKind;
  x: number;
  y: number;
  tx: number;
  ty: number;
  frame: number;
}

export class ProjectileTracker {
  private last = new Map<number, Tracked>();
  private frame = 0;

  reset(): void {
    this.last.clear();
  }

  sync(world: World, onImpact: (kind: ProjectileKind, x: number, y: number) => void): void {
    const f = ++this.frame;
    for (const p of world.projectiles) {
      if (!p.alive) continue;
      const t = this.last.get(p.id);
      if (t) {
        t.x = p.x;
        t.y = p.y;
        t.tx = p.tx;
        t.ty = p.ty;
        t.frame = f;
      } else this.last.set(p.id, { kind: p.kind, x: p.x, y: p.y, tx: p.tx, ty: p.ty, frame: f });
    }
    for (const [id, t] of this.last) {
      if (t.frame === f) continue;
      this.last.delete(id);
      if (t.kind === 'firepot') onImpact(t.kind, t.tx, t.ty);
      else onImpact(t.kind, t.x, t.y);
    }
  }
}

export function drawProjectiles(ctx: Ctx2D, world: World, alpha: number, sprites: SpriteCache, now: number): void {
  const list = world.projectiles;
  if (list.length === 0) return;
  for (const p of list) {
    if (!p.alive) continue;
    const xt = p.prevX + (p.x - p.prevX) * alpha;
    const yt = p.prevY + (p.y - p.prevY) * alpha;
    const total = Math.hypot(p.tx - p.startX, p.ty - p.startY);
    const prog = flightProgress(p.startX, p.startY, xt, yt, p.tx, p.ty);
    const H = arcHeight(p.kind, total);
    const h = Math.sin(prog * Math.PI) * H;
    let dx = p.x - p.prevX;
    let dy = p.y - p.prevY;
    if (Math.abs(dx) + Math.abs(dy) < 1e-6) {
      dx = p.tx - xt;
      dy = p.ty - yt;
    }
    const step = Math.hypot(dx, dy);
    const dh = total > 0 ? Math.cos(prog * Math.PI) * Math.PI * H * (step / total) : 0;
    const ang = Math.atan2(dy * T - dh, dx * T);
    const x = xt * T;
    const y = yt * T;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    if (h > 2) {
      ctx.beginPath();
      ctx.ellipse(x, y + 2, p.kind === 'firepot' ? 5 : 4, p.kind === 'firepot' ? 2.5 : 1.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fill();
    }
    const yy = y - h;
    switch (p.kind) {
      case 'arrow':
      case 'fire_arrow': {
        // Trail.
        ctx.beginPath();
        ctx.moveTo(x - c * 8, yy - s * 8);
        ctx.lineTo(x - c * 20, yy - s * 20);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = p.kind === 'fire_arrow' ? 'rgba(255,140,60,0.35)' : 'rgba(244,230,193,0.28)';
        ctx.stroke();
        // Shaft.
        ctx.beginPath();
        ctx.moveTo(x - c * 9, yy - s * 9);
        ctx.lineTo(x + c * 4, yy + s * 4);
        ctx.lineWidth = 2.8;
        ctx.strokeStyle = 'rgba(30,20,10,0.75)';
        ctx.stroke();
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = PALETTE.projectile.arrow;
        ctx.stroke();
        // Head + fletching.
        ctx.beginPath();
        ctx.moveTo(x + c * 7, yy + s * 7);
        ctx.lineTo(x + c * 3 - s * 2.2, yy + s * 3 + c * 2.2);
        ctx.lineTo(x + c * 3 + s * 2.2, yy + s * 3 - c * 2.2);
        ctx.closePath();
        ctx.fillStyle = p.kind === 'fire_arrow' ? PALETTE.projectile.fire_arrow : '#D9D4C7';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - c * 9, yy - s * 9);
        ctx.lineTo(x - c * 12 - s * 2, yy - s * 12 + c * 2);
        ctx.moveTo(x - c * 9, yy - s * 9);
        ctx.lineTo(x - c * 12 + s * 2, yy - s * 12 - c * 2);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#B5482E';
        ctx.stroke();
        if (p.kind === 'fire_arrow') {
          const g = sprites.glow('#FF6A2B');
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.7;
          ctx.drawImage(g.canvas, x + c * 5 - 7, yy + s * 5 - 7, 14, 14);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
        break;
      }
      case 'bolt': {
        const g = sprites.glow(PALETTE.projectile.bolt);
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x - c * 18, yy - s * 18);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,170,70,0.35)';
        ctx.stroke();
        ctx.globalAlpha = 0.85;
        ctx.drawImage(g.canvas, x - 10, yy - 10, 20, 20);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath();
        ctx.arc(x, yy, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = '#FFF0C0';
        ctx.fill();
        break;
      }
      case 'spine': {
        ctx.beginPath();
        ctx.moveTo(x - c * 7, yy - s * 7);
        ctx.lineTo(x + c * 5, yy + s * 5);
        ctx.lineCap = 'round';
        ctx.lineWidth = 3.6;
        ctx.strokeStyle = PALETTE.enemy.outline;
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = PALETTE.projectile.spine;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - c * 7, yy - s * 7);
        ctx.lineTo(x - c * 13, yy - s * 13);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(143,209,79,0.35)';
        ctx.stroke();
        break;
      }
      case 'firepot': {
        const g = sprites.glow('#FF6A2B');
        const fl = 0.7 + 0.3 * Math.sin(now * 30);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.6 * fl;
        ctx.drawImage(g.canvas, x - 4 - 8, yy - 6 - 8, 16, 16);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath();
        ctx.arc(x, yy, 4.8, 0, Math.PI * 2);
        ctx.fillStyle = PALETTE.projectile.firepot;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#140A04';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x - 1.5, yy - 1.5, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = '#6A5A4A';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 2, yy - 5, 1.8 * fl, 0, Math.PI * 2);
        ctx.fillStyle = '#FFD27A';
        ctx.fill();
        break;
      }
    }
  }
}
