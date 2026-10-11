/**
 * Small vector glyphs: doctrine banner icons (§I), Temper emblems (§H), banner emblems.
 * Each draws centered at (x, y) within a box of size s.
 */
import type { Ctx2D } from './canvas';
import { circlePath, polyPath } from './shapes';
import type { DoctrineId, ResearchId } from '../sim/types';

export type GlyphId = 'swarm' | 'quill' | 'antler' | 'ram' | 'crown' | 'sword' | 'arrowhead' | 'mail' | 'spears' | 'horseshoe' | 'target' | 'flame';

export function doctrineGlyph(d: DoctrineId): GlyphId {
  switch (d) {
    case 'swarm':
      return 'swarm';
    case 'spines':
      return 'quill';
    case 'hunt':
      return 'antler';
    case 'siegebreak':
      return 'ram';
    case 'court':
      return 'crown';
  }
}

export function temperGlyph(r: ResearchId | null): GlyphId | null {
  if (r === 'ember_edge') return 'sword';
  if (r === 'barbed_heads') return 'arrowhead';
  if (r === 'hauberks') return 'mail';
  return null;
}

/** Draw a glyph filled with `color`, outlined with `outline`. */
export function drawGlyph(ctx: Ctx2D, g: GlyphId, x: number, y: number, s: number, color: string, outline: string): void {
  const k = s / 16;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = color;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  switch (g) {
    case 'swarm':
      for (const [cx, cy, r] of [
        [-3.5, 2.5, 3],
        [3.5, 2.5, 3],
        [0, -3.5, 3],
      ]) {
        polyPath(ctx, starPts(cx, cy, 5, r + 1.5, r * 0.5));
      }
      ctx.fill();
      ctx.stroke();
      break;
    case 'quill':
      ctx.moveTo(-6, 7);
      ctx.quadraticCurveTo(-4, -2, 6, -7);
      ctx.quadraticCurveTo(3, 2, -6, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-6, 7);
      ctx.lineTo(4, -5);
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    case 'antler':
      ctx.lineWidth = 3.2;
      ctx.moveTo(0, 7);
      ctx.lineTo(0, 0);
      ctx.lineTo(-5, -6);
      ctx.moveTo(0, 0);
      ctx.lineTo(5, -6);
      ctx.moveTo(-2.5, -3);
      ctx.lineTo(-6.5, -1);
      ctx.moveTo(2.5, -3);
      ctx.lineTo(6.5, -1);
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = color;
      ctx.stroke();
      break;
    case 'ram':
      ctx.moveTo(-7, -3.5);
      ctx.lineTo(3, -3.5);
      ctx.lineTo(7.5, 0);
      ctx.lineTo(3, 3.5);
      ctx.lineTo(-7, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-3, -3.5);
      ctx.lineTo(-3, 3.5);
      ctx.moveTo(0.5, -3.5);
      ctx.lineTo(0.5, 3.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    case 'crown':
      polyPath(ctx, [-7, 5, -7, -4, -3.5, 0, 0, -6, 3.5, 0, 7, -4, 7, 5]);
      ctx.fill();
      ctx.stroke();
      break;
    case 'sword':
      polyPath(ctx, [-1.4, 3, -1.4, -6, 0, -8.5, 1.4, -6, 1.4, 3]);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-5, 3.5);
      ctx.lineTo(5, 3.5);
      ctx.lineWidth = 2.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.lineTo(0, 8);
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.beginPath();
      circlePath(ctx, 0, -2, 1.4);
      ctx.fillStyle = '#FF6A2B';
      ctx.fill();
      break;
    case 'arrowhead':
      polyPath(ctx, [0, -8, 5.5, 1, 2.5, 0, 4.5, 4.5, 0, 2, -4.5, 4.5, -2.5, 0, -5.5, 1]);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.lineTo(0, 8);
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    case 'mail':
      polyPath(ctx, [-6, -6, -2.5, -7, 0, -5, 2.5, -7, 6, -6, 7, -1, 4.5, -1, 4.5, 7, -4.5, 7, -4.5, -1, -7, -1]);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      for (let yy = -3; yy <= 5; yy += 2.6) {
        for (let xx = -3; xx <= 3; xx += 2.6) circlePath(ctx, xx, yy, 0.7);
      }
      ctx.fillStyle = outline;
      ctx.fill();
      break;
    case 'spears':
      ctx.lineWidth = 3;
      ctx.moveTo(-6, 7);
      ctx.lineTo(6, -6);
      ctx.moveTo(6, 7);
      ctx.lineTo(-6, -6);
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      polyPath(ctx, [7.5, -7.5, 3, -6, 6, -3]);
      polyPath(ctx, [-7.5, -7.5, -3, -6, -6, -3]);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = outline;
      ctx.stroke();
      break;
    case 'horseshoe':
      ctx.arc(0, -0.5, 5.6, Math.PI * 0.8, Math.PI * 2.2);
      ctx.lineWidth = 5;
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      for (const a of [1.0, 1.4, 1.75, 2.05]) {
        circlePath(ctx, Math.cos(Math.PI * a) * 5.6, -0.5 + Math.sin(Math.PI * a) * 5.6, 0.55);
      }
      ctx.fillStyle = outline;
      ctx.fill();
      break;
    case 'target':
      for (const [r, c] of [
        [7, color],
        [5, outline],
        [3, color],
        [1.4, outline],
      ] as const) {
        ctx.beginPath();
        circlePath(ctx, 0, 0, r);
        ctx.fillStyle = c;
        ctx.fill();
      }
      break;
    case 'flame':
      ctx.moveTo(0, 8);
      ctx.bezierCurveTo(-7, 6, -5, -1, 0, -8);
      ctx.bezierCurveTo(1, -3, 6, -1, 5, 4);
      ctx.quadraticCurveTo(4, 7.5, 0, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
  }
  ctx.restore();
}

function starPts(x: number, y: number, n: number, ro: number, ri: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  return pts;
}
