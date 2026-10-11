/**
 * Small Canvas2D path/shading helpers shared by unit, building and icon art.
 * All art is drawn in "world px" (1 tile = 32 px at zoom 1).
 */
import type { Ctx2D } from './canvas';
import { darken, lighten } from './colors';

export const T = 32;
export const TAU = Math.PI * 2;

export function circlePath(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TAU);
}

export function polyPath(ctx: Ctx2D, pts: readonly number[], close = true): void {
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (close) ctx.closePath();
}

export function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** n-point star path centered at (x, y). */
export function starPath(ctx: Ctx2D, x: number, y: number, n: number, rOuter: number, rInner: number, rot: number): void {
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = rot + (i * Math.PI) / n;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * Radial "3/4 lit" gradient: light from the upper left. Built in the CURRENT transform, so callers that
 * rotate geometry build the path rotated and then fill after restoring the unrotated transform.
 */
export function litGradient(ctx: Ctx2D, x: number, y: number, r: number, color: string, hi = 0.32, lo = 0.22): CanvasGradient {
  const g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.45, r * 0.08, x, y, r * 1.08);
  g.addColorStop(0, lighten(color, hi));
  g.addColorStop(0.55, color);
  g.addColorStop(1, darken(color, lo));
  return g;
}

/** Shaded, outlined circle (the basic unit token). */
export function shadedCircle(ctx: Ctx2D, x: number, y: number, r: number, color: string, outline: string, lw = 1.5): void {
  ctx.beginPath();
  circlePath(ctx, x, y, r);
  ctx.fillStyle = litGradient(ctx, x, y, r, color);
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = outline;
  ctx.stroke();
}

/** Point at distance `d` along angle `a`, offset `side` perpendicular (positive = clockwise/right side). */
export function along(a: number, d: number, side: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * d - s * side, s * d + c * side];
}

/** Stroke a straight line. */
export function line(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, color: string, lw: number, cap: CanvasLineCap = 'round'): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineCap = cap;
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** Line with a dark outline underneath (readable weapon shafts). */
export function outlinedLine(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, color: string, outline: string, lw: number): void {
  line(ctx, x0, y0, x1, y1, outline, lw + 1.6);
  line(ctx, x0, y0, x1, y1, color, lw);
}

/** Fill the current path with color + outline. */
export function fillStroke(ctx: Ctx2D, fill: string | CanvasGradient, outline: string, lw: number): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = outline;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** Deterministic hash 0..1 for cosmetic per-tile / per-id variation. */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A small flame shape (teardrop pointing up) at (x, y) base with height h. */
export function flamePath(ctx: Ctx2D, x: number, y: number, w: number, h: number, lean = 0): void {
  ctx.moveTo(x - w / 2, y);
  ctx.bezierCurveTo(x - w / 2, y - h * 0.45, x - w * 0.15 + lean * 0.5, y - h * 0.6, x + lean, y - h);
  ctx.bezierCurveTo(x + w * 0.15 + lean * 0.5, y - h * 0.6, x + w / 2, y - h * 0.45, x + w / 2, y);
  ctx.quadraticCurveTo(x, y + w * 0.35, x - w / 2, y);
  ctx.closePath();
}

/** Three-layer flame (outer orange, mid amber, core pale) with flicker phase t (seconds). */
export function drawFlame(ctx: Ctx2D, x: number, y: number, size: number, t: number, seed = 0): void {
  const f1 = Math.sin(t * 13 + seed * 7.1) * 0.5 + Math.sin(t * 21 + seed * 3.3) * 0.5;
  const f2 = Math.sin(t * 17 + seed * 5.7);
  const h = size * (1 + 0.12 * f1);
  const lean = size * 0.12 * f2;
  ctx.beginPath();
  flamePath(ctx, x, y, size * 0.62, h, lean);
  ctx.fillStyle = '#E2551F';
  ctx.fill();
  ctx.beginPath();
  flamePath(ctx, x, y - size * 0.02, size * 0.42, h * 0.72, lean * 0.8);
  ctx.fillStyle = '#FF9A2E';
  ctx.fill();
  ctx.beginPath();
  flamePath(ctx, x, y - size * 0.03, size * 0.22, h * 0.42, lean * 0.5);
  ctx.fillStyle = '#FFE08A';
  ctx.fill();
}
