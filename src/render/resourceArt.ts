/**
 * Resource nodes and terrain props (trees, stumps, rocks, briar thorns, Thickets, Ember Seams).
 * Coordinates are world px.
 */
import type { Ctx2D } from './canvas';
import { darken, lighten, mix } from './colors';
import { circlePath, fillStroke, hash01, litGradient, polyPath, T } from './shapes';
import { PALETTE } from '../data/palette';

export interface TreeShape {
  cx: number;
  cy: number;
  r: number;
  /** Lobe offsets (dx, dy, r) relative to the center. */
  lobes: number[];
  hue: number;
}

/** Deterministic tree shape for a tile from its cosmetic variant byte. */
export function treeShape(tx: number, ty: number, variant: number): TreeShape {
  const h1 = hash01(tx, ty, variant);
  const h2 = hash01(ty, tx, variant + 17);
  const h3 = hash01(tx + 91, ty + 7, variant);
  const r = T * (0.5 + 0.16 * h1);
  const cx = (tx + 0.5) * T + (h2 - 0.5) * 7;
  const cy = (ty + 0.5) * T + (h3 - 0.5) * 6 - 3;
  const lobes: number[] = [];
  const n = 2 + Math.floor(h2 * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + h1 * 6.28;
    const d = r * (0.45 + 0.15 * hash01(i, variant));
    lobes.push(Math.cos(a) * d, Math.sin(a) * d * 0.85, r * (0.5 + 0.18 * hash01(i, variant + 3)));
  }
  return { cx, cy, r, lobes, hue: h3 };
}

/** Maximum canopy reach beyond the tile center (px) — bounds for per-tile redraws. */
export const TREE_REACH = T * 1.2;

export function drawTreeShadow(ctx: Ctx2D, s: TreeShape, scale = 1): void {
  ctx.beginPath();
  ctx.ellipse(s.cx + 5 * scale, s.cy + s.r * 0.55 * scale + 4, s.r * 1.05 * scale, s.r * 0.6 * scale, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();
}

export function drawTree(ctx: Ctx2D, s: TreeShape, canopy: string, hi: string, trunk: string, scale = 1, ox = 0, oy = 0): void {
  const cx = s.cx + ox;
  const cy = s.cy + oy;
  const r = s.r * scale;
  // Trunk peeking out below the canopy.
  ctx.beginPath();
  ctx.rect(cx - 2.6 * scale, cy + r * 0.35, 5.2 * scale, r * 0.55);
  ctx.fillStyle = trunk;
  ctx.fill();
  // Per-tree tint: some trees lighter (toward the highlight), some deeper.
  const base = s.hue > 0.5 ? mix(canopy, hi, (s.hue - 0.5) * 0.7) : darken(canopy, (0.5 - s.hue) * 0.22);
  const outline = darken(canopy, 0.45);
  // Canopy silhouette: center + lobes, outlined as one shape.
  ctx.beginPath();
  circlePath(ctx, cx, cy, r);
  for (let i = 0; i < s.lobes.length; i += 3) circlePath(ctx, cx + s.lobes[i] * scale, cy + s.lobes[i + 1] * scale, s.lobes[i + 2] * scale);
  ctx.lineWidth = 2.4 * scale;
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.fillStyle = litGradient(ctx, cx, cy, r * 1.25, base, 0.12, 0.3);
  ctx.fill();
  // Highlight blob (upper-left) and a darker under-shade.
  ctx.beginPath();
  circlePath(ctx, cx - r * 0.28, cy - r * 0.32, r * 0.48);
  ctx.fillStyle = hi;
  ctx.globalAlpha = 0.8;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  circlePath(ctx, cx - r * 0.38, cy - r * 0.42, r * 0.2);
  ctx.fillStyle = lighten(hi, 0.18);
  ctx.fill();
}

export function drawStump(ctx: Ctx2D, tx: number, ty: number, variant: number, trunk: string): void {
  const cx = (tx + 0.5) * T + (hash01(tx, ty, variant) - 0.5) * 6;
  const cy = (ty + 0.5) * T + (hash01(ty, tx, variant) - 0.5) * 5 + 2;
  ctx.beginPath();
  ctx.ellipse(cx + 2, cy + 3, 7, 4, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fill();
  // Roots.
  ctx.strokeStyle = darken(trunk, 0.2);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy + 2);
  ctx.lineTo(cx - 9, cy + 4);
  ctx.moveTo(cx + 5, cy + 2);
  ctx.lineTo(cx + 9, cy + 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy + 1.5, 6, 4, 0, 0, Math.PI * 2);
  fillStroke(ctx, darken(trunk, 0.15), darken(trunk, 0.5), 1.2);
  ctx.beginPath();
  ctx.ellipse(cx, cy - 0.5, 5.5, 3.4, 0, 0, Math.PI * 2);
  fillStroke(ctx, '#B98A58', darken(trunk, 0.5), 1);
  ctx.beginPath();
  ctx.ellipse(cx, cy - 0.5, 2.6, 1.6, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#8A5F38';
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

/** A cluster of 2-4 boulders filling a rock tile. */
export function drawRocks(ctx: Ctx2D, tx: number, ty: number, variant: number, rock: string): void {
  const n = 2 + Math.floor(hash01(tx, ty, variant + 5) * 3);
  const items: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const rx = (tx + 0.22 + hash01(i, tx, ty) * 0.56) * T;
    const ry = (ty + 0.25 + hash01(ty, i, tx) * 0.5) * T;
    const r = T * (0.2 + 0.16 * hash01(i + 7, tx, ty)) * (i === 0 ? 1.35 : 1);
    items.push([rx, ry, r, i]);
  }
  items.sort((a, b) => a[1] - b[1]);
  const outline = darken(rock, 0.55);
  for (const [rx, ry, r, i] of items) {
    ctx.beginPath();
    ctx.ellipse(rx + 3, ry + r * 0.55, r * 1.05, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();
    const pts: number[] = [];
    const k = 7;
    for (let j = 0; j < k; j++) {
      const a = (j / k) * Math.PI * 2 + i;
      const rr = r * (0.78 + 0.3 * hash01(j, i, tx * 31 + ty));
      pts.push(rx + Math.cos(a) * rr, ry + Math.sin(a) * rr * 0.82);
    }
    ctx.beginPath();
    polyPath(ctx, pts);
    fillStroke(ctx, litGradient(ctx, rx, ry, r, rock, 0.3, 0.35), outline, 1.4);
    // Facet line.
    ctx.beginPath();
    ctx.moveTo(rx - r * 0.5, ry - r * 0.1);
    ctx.lineTo(rx + r * 0.1, ry + r * 0.15);
    ctx.lineTo(rx + r * 0.55, ry - r * 0.2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = darken(rock, 0.25);
    ctx.stroke();
  }
}

/** Bramble strokes and green thorn ticks on a briar-wall tile (dense, dark, with sparse bright thorns). */
export function drawBriar(ctx: Ctx2D, tx: number, ty: number, variant: number, base: string, thorn: string): void {
  const x0 = tx * T;
  const y0 = ty * T;
  ctx.lineCap = 'round';
  const dark = darken(base, 0.55);
  for (let i = 0; i < 3; i++) {
    const sx = x0 + hash01(i, tx, ty) * T;
    const sy = y0 + hash01(tx, i, ty) * T;
    const ex = sx + (hash01(i, ty, variant) - 0.5) * T * 1.3;
    const ey = sy + (hash01(ty, variant, i) - 0.5) * T * 1.3;
    const qx = (sx + ex) / 2 + (hash01(i, tx + 5, ty) - 0.5) * 16;
    const qy = (sy + ey) / 2 + (hash01(tx, ty + 5, i) - 0.5) * 16;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(qx, qy, ex, ey);
    ctx.lineWidth = 5.5;
    ctx.strokeStyle = dark;
    ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = darken(base, 0.15);
    ctx.stroke();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = lighten(base, 0.18);
    ctx.stroke();
    // Sparse thorn ticks.
    if (hash01(i, tx, ty + 9) < 0.55) {
      const t = 0.3 + 0.4 * hash01(i, ty, tx);
      const px = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * qx + t * t * ex;
      const py = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * qy + t * t * ey;
      const a = hash01(i, i, tx + ty) * Math.PI * 2;
      ctx.beginPath();
      polyPath(ctx, [px + Math.cos(a + 1.5) * 1.4, py + Math.sin(a + 1.5) * 1.4, px + Math.cos(a) * 4.2, py + Math.sin(a) * 4.2, px + Math.cos(a - 1.5) * 1.4, py + Math.sin(a - 1.5) * 1.4]);
      ctx.fillStyle = thorn;
      ctx.fill();
    }
  }
}

/** Thicket (1×1): round bush with yellow grain dots (count shows what is left). */
export function drawThicket(ctx: Ctx2D, x: number, y: number, dots: number): void {
  const cx = x + T / 2;
  const cy = y + T / 2;
  const bush = PALETTE.resource.thicketBush;
  ctx.beginPath();
  ctx.ellipse(cx + 3, cy + 8, 13, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();
  ctx.beginPath();
  circlePath(ctx, cx, cy, 12);
  circlePath(ctx, cx - 8, cy + 3, 8);
  circlePath(ctx, cx + 8, cy + 3, 8);
  circlePath(ctx, cx, cy - 6, 8.5);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = darken(bush, 0.5);
  ctx.stroke();
  ctx.fillStyle = litGradient(ctx, cx, cy, 15, bush, 0.25, 0.3);
  ctx.fill();
  ctx.beginPath();
  circlePath(ctx, cx - 4, cy - 6, 5);
  ctx.fillStyle = lighten(bush, 0.22);
  ctx.fill();
  // Grain dots.
  const spots: [number, number][] = [
    [-7, -2],
    [5, -7],
    [8, 3],
    [-2, 4],
    [-9, 6],
    [2, -2],
    [-4, -8],
    [10, -2],
    [4, 8],
    [-6, 10],
  ];
  const n = Math.max(0, Math.min(spots.length, dots));
  for (let i = 0; i < n; i++) {
    const [dx, dy] = spots[i];
    ctx.beginPath();
    circlePath(ctx, cx + dx, cy + dy, 2.1);
    ctx.fillStyle = darken(PALETTE.resource.thicketDots, 0.35);
    ctx.fill();
    ctx.beginPath();
    circlePath(ctx, cx + dx - 0.4, cy + dy - 0.4, 1.6);
    ctx.fillStyle = PALETTE.resource.thicketDots;
    ctx.fill();
  }
}

/** Ember Seam rock cluster with crack lines (static; the glow pulses live). */
export function drawEmberSeam(ctx: Ctx2D, x: number, y: number, w: number, h: number, crackAlpha: number): void {
  const W = w * T;
  const H = h * T;
  const rock = PALETTE.resource.seamRock;
  const boulders: [number, number, number][] = [
    [W * 0.32, H * 0.4, W * 0.24],
    [W * 0.68, H * 0.36, W * 0.22],
    [W * 0.5, H * 0.62, W * 0.27],
    [W * 0.22, H * 0.72, W * 0.15],
    [W * 0.8, H * 0.7, W * 0.15],
  ];
  ctx.beginPath();
  ctx.ellipse(x + W / 2 + 4, y + H * 0.7, W * 0.48, H * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();
  const outline = '#15100E';
  boulders.forEach(([bx, by, r], i) => {
    const pts: number[] = [];
    for (let j = 0; j < 7; j++) {
      const a = (j / 7) * Math.PI * 2 + i * 0.7;
      const rr = r * (0.8 + 0.28 * hash01(j, i, 3));
      pts.push(x + bx + Math.cos(a) * rr, y + by + Math.sin(a) * rr * 0.8);
    }
    ctx.beginPath();
    polyPath(ctx, pts);
    fillStroke(ctx, litGradient(ctx, x + bx, y + by, r, rock, 0.22, 0.35), outline, 1.5);
  });
  // Glowing cracks.
  const cracks: number[][] = [
    [0.2, 0.36, 0.3, 0.44, 0.27, 0.52, 0.38, 0.6],
    [0.6, 0.28, 0.66, 0.36, 0.62, 0.44],
    [0.42, 0.58, 0.5, 0.66, 0.58, 0.62, 0.66, 0.72],
    [0.74, 0.66, 0.82, 0.72],
  ];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const c of cracks) {
    ctx.beginPath();
    ctx.moveTo(x + c[0] * W, y + c[1] * H);
    for (let k = 2; k < c.length; k += 2) ctx.lineTo(x + c[k] * W, y + c[k + 1] * H);
    ctx.globalAlpha = 0.5 * crackAlpha;
    ctx.lineWidth = 4;
    ctx.strokeStyle = PALETTE.resource.emberGlow;
    ctx.stroke();
    ctx.globalAlpha = crackAlpha;
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = PALETTE.resource.seamCracks;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Ember nuggets.
  ctx.fillStyle = mix(PALETTE.resource.ember, '#FFD27A', 0.3);
  ctx.globalAlpha = crackAlpha;
  for (const [nx, ny] of [
    [0.36, 0.5],
    [0.58, 0.66],
    [0.64, 0.38],
  ]) {
    ctx.beginPath();
    circlePath(ctx, x + nx * W, y + ny * H, 1.8);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
