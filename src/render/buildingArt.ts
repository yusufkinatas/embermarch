/**
 * Procedural building art (GDD §A "Silhouettes" + "Render style": darker front face on the bottom 25% of
 * the footprint, body color darkened 30%, under a lighter roof). Static parts only; animated parts
 * (flames, cores, furrows, glints) are drawn live by entityDraw.ts.
 *
 * Origin = top-left corner of the footprint in world px. Art may overhang by BUILDING_MARGIN.
 */
import type { Ctx2D } from './canvas';
import type { TeamColors } from './colors';
import { darken, lighten, mix, teamColors } from './colors';
import { drawGlyph } from './glyphs';
import { circlePath, fillStroke, hash01, litGradient, polyPath, roundRectPath, T } from './shapes';
import type { BuildingId, Owner } from '../sim/types';

export interface Margin {
  top: number;
  side: number;
  bottom: number;
}

const M_DEFAULT: Margin = { top: 14, side: 8, bottom: 8 };

export const BUILDING_MARGIN: Record<BuildingId, Margin> = {
  hearth: { top: 12, side: 8, bottom: 8 },
  cottage: M_DEFAULT,
  storehouse: M_DEFAULT,
  grainplot: { top: 6, side: 6, bottom: 6 },
  muster_hall: { top: 34, side: 8, bottom: 8 },
  bowyard: { top: 16, side: 8, bottom: 8 },
  paddock: { top: 14, side: 8, bottom: 8 },
  forgehall: { top: 28, side: 8, bottom: 8 },
  brazier_tower: { top: 30, side: 8, bottom: 8 },
  siegeyard: { top: 30, side: 10, bottom: 8 },
  thorn_nest: { top: 22, side: 12, bottom: 8 },
  thornspire: { top: 38, side: 10, bottom: 8 },
  root_heart: { top: 22, side: 16, bottom: 10 },
  briar_throne: { top: 40, side: 12, bottom: 10 },
  ruined_cache: { top: 8, side: 8, bottom: 6 },
  ancient_cache: { top: 10, side: 8, bottom: 6 },
  beacon_stone: { top: 12, side: 6, bottom: 6 },
};

export interface BuildingVariant {
  /** Nest / Root Heart Spent: grey tint (applied by the sprite cache) and droop. */
  spent?: boolean;
  /** Cache looted (open, empty chest). */
  looted?: boolean;
}

const STONE = '#8C8577';
const STONE_DARK = '#5E584F';
const TIMBER = '#7A5230';
const PLASTER = '#E2CFA2';
const SOIL = '#5C4128';

function shadow(ctx: Ctx2D, x: number, y: number, w: number, h: number, r = 6): void {
  ctx.beginPath();
  roundRectPath(ctx, x + 4, y + 5, w, h, r);
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.fill();
}

/** Front face: bottom 25% band of the footprint rect, `wall` darkened 30%. */
function frontFace(ctx: Ctx2D, x: number, y: number, w: number, h: number, wall: string, outline: string): void {
  const fy = y + h * 0.75;
  ctx.beginPath();
  ctx.rect(x, fy, w, h * 0.25);
  fillStroke(ctx, darken(wall, 0.3), outline, 1.5);
}

function door(ctx: Ctx2D, cx: number, bottom: number, w: number, h: number, outline: string): void {
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, bottom);
  ctx.lineTo(cx - w / 2, bottom - h + w / 2);
  ctx.arc(cx, bottom - h + w / 2, w / 2, Math.PI, 0);
  ctx.lineTo(cx + w / 2, bottom);
  ctx.closePath();
  fillStroke(ctx, '#2E1F14', outline, 1.2);
}

function windowGlow(ctx: Ctx2D, x: number, y: number, w: number, h: number, outline: string): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  fillStroke(ctx, '#F2B652', outline, 1);
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + h);
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

/** Gable roof covering [x, y, w, h] with the ridge horizontal at the middle. */
function gableRoof(ctx: Ctx2D, x: number, y: number, w: number, h: number, color: string, outline: string, texture: 'thatch' | 'shingle' | 'slate'): void {
  const ridge = y + h * 0.48;
  // Back plane (lit).
  ctx.beginPath();
  polyPath(ctx, [x + 3, y, x + w - 3, y, x + w, ridge, x, ridge]);
  fillStroke(ctx, lighten(color, 0.12), outline, 1.5);
  // Front plane (shade).
  ctx.beginPath();
  polyPath(ctx, [x, ridge, x + w, ridge, x + w - 2, y + h, x + 2, y + h]);
  fillStroke(ctx, darken(color, 0.1), outline, 1.5);
  // Texture.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.lineWidth = texture === 'thatch' ? 1 : 1.1;
  ctx.strokeStyle = darken(color, texture === 'thatch' ? 0.22 : 0.3);
  if (texture === 'thatch') {
    for (let i = 0; i < 26; i++) {
      const px = x + 4 + hash01(i, 3) * (w - 8);
      const py = y + 3 + hash01(i, 7) * (h - 6);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + 1, py + 4.5);
      ctx.stroke();
    }
  } else {
    const step = texture === 'slate' ? 6 : 5;
    for (let py = y + step; py < y + h - 1; py += step) {
      if (Math.abs(py - ridge) < 2) continue;
      ctx.beginPath();
      ctx.moveTo(x + 2, py);
      ctx.lineTo(x + w - 2, py);
      ctx.stroke();
      const off = ((py - y) / step) % 2 === 0 ? 0 : step;
      for (let px = x + 4 + off; px < x + w - 2; px += step * 2) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px, py - step);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
  // Ridge beam.
  ctx.beginPath();
  ctx.moveTo(x + 1, ridge);
  ctx.lineTo(x + w - 1, ridge);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = darken(color, 0.4);
  ctx.stroke();
}

function crate(ctx: Ctx2D, x: number, y: number, s: number, outline: string): void {
  ctx.beginPath();
  ctx.rect(x, y, s, s);
  fillStroke(ctx, '#B07A44', outline, 1.2);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + s, y + s);
  ctx.moveTo(x + s, y);
  ctx.lineTo(x, y + s);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#6A4524';
  ctx.stroke();
  ctx.fillStyle = '#C99560';
  ctx.fillRect(x + 1, y + 1, s - 2, 1.4);
}

function fence(ctx: Ctx2D, x: number, y: number, w: number, h: number, outline: string, posts = 4, gap?: { side: 'bottom'; at: number; w: number }): void {
  const rail = (x0: number, y0: number, x1: number, y1: number): void => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = outline;
    ctx.stroke();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#A27448';
    ctx.stroke();
  };
  rail(x, y, x + w, y);
  rail(x, y, x, y + h);
  rail(x + w, y, x + w, y + h);
  if (gap) {
    rail(x, y + h, gap.at - gap.w / 2, y + h);
    rail(gap.at + gap.w / 2, y + h, x + w, y + h);
  } else rail(x, y + h, x + w, y + h);
  ctx.fillStyle = '#6E4A2A';
  for (let i = 0; i <= posts; i++) {
    const px = x + (w * i) / posts;
    for (const py of [y, y + h]) {
      if (gap && py === y + h && Math.abs(px - gap.at) < gap.w / 2) continue;
      ctx.beginPath();
      ctx.rect(px - 2, py - 3, 4, 5);
      fillStroke(ctx, '#7E5632', outline, 1);
    }
  }
  for (let i = 1; i < posts; i++) {
    const py = y + (h * i) / posts;
    for (const px of [x, x + w]) {
      ctx.beginPath();
      ctx.rect(px - 2, py - 3, 4, 5);
      fillStroke(ctx, '#7E5632', outline, 1);
    }
  }
}

/** Banner on a pole rising from (px, py) (3/4 upright), with an emblem glyph. */
function banner(ctx: Ctx2D, pal: TeamColors, px: number, py: number, height: number, glyph: Parameters<typeof drawGlyph>[1]): void {
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px, py - height);
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = pal.outline;
  ctx.stroke();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = pal.wood;
  ctx.stroke();
  const top = py - height + 1;
  ctx.beginPath();
  polyPath(ctx, [px + 1, top, px + 15, top, px + 15, top + 17, px + 8, top + 13.5, px + 1, top + 17]);
  fillStroke(ctx, pal.body, pal.outline, 1.2);
  ctx.fillStyle = lighten(pal.body, 0.25);
  ctx.fillRect(px + 1.5, top + 0.8, 13, 2);
  drawGlyph(ctx, glyph, px + 8, top + 8, 11, pal.trim, pal.outline);
}

// ---------------------------------------------------------------------------
// Player buildings
// ---------------------------------------------------------------------------

function roofColor(pal: TeamColors): string {
  return pal.owner === 0 ? '#C98A3A' : pal.owner === 1 ? mix(pal.body, '#3A2A44', 0.25) : pal.body;
}

function wallColor(pal: TeamColors): string {
  return pal.owner === 0 ? PLASTER : pal.owner === 1 ? mix(pal.trim, '#5A4A5A', 0.6) : pal.trim;
}

function hearth(ctx: Ctx2D, pal: TeamColors, W: number, H: number): void {
  const cx = W / 2;
  const cy = H / 2;
  const R = W * 0.46;
  ctx.beginPath();
  ctx.ellipse(cx + 4, cy + 7, R, R * 0.96, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();
  // Raised stone disk: front lip (darker) + top.
  ctx.beginPath();
  ctx.ellipse(cx, cy + 5, R, R * 0.95, 0, 0, Math.PI * 2);
  fillStroke(ctx, darken(STONE, 0.3), pal.outline, 1.6);
  ctx.beginPath();
  ctx.ellipse(cx, cy, R, R * 0.93, 0, 0, Math.PI * 2);
  fillStroke(ctx, litGradient(ctx, cx, cy, R, STONE, 0.18, 0.15), pal.outline, 1.6);
  // Flagstone joints.
  ctx.strokeStyle = darken(STONE, 0.25);
  ctx.lineWidth = 1;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.47);
    ctx.lineTo(cx + Math.cos(a) * R * 0.97, cy + Math.sin(a) * R * 0.9);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(cx, cy, R * 0.74, R * 0.69, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Amber inlay ring (team).
  ctx.beginPath();
  ctx.ellipse(cx, cy, R * 0.5, R * 0.47, 0, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = pal.outline;
  ctx.stroke();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = pal.body;
  ctx.stroke();
  // Fire pit.
  ctx.beginPath();
  ctx.ellipse(cx, cy + 1, R * 0.4, R * 0.37, 0, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(cx, cy + 2, 2, cx, cy + 1, R * 0.4);
  g.addColorStop(0, '#FFB347');
  g.addColorStop(0.35, '#C2461C');
  g.addColorStop(1, '#2E1A12');
  fillStroke(ctx, g, pal.outline, 1.4);
  // Logs.
  ctx.lineCap = 'round';
  for (const [a, l] of [
    [0.5, 15],
    [2.6, 15],
    [4.4, 14],
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * l * 0.5, cy + 4 - Math.sin(a) * l * 0.35);
    ctx.lineTo(cx + Math.cos(a) * l * 0.5, cy + 4 + Math.sin(a) * l * 0.35);
    ctx.lineWidth = 5;
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = '#6E4526';
    ctx.stroke();
  }
  // Four short pillars at the diagonals.
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const px = cx + dx * R * 0.66;
    const py = cy + dy * R * 0.62;
    ctx.beginPath();
    roundRectPath(ctx, px - 7, py - 10, 14, 16, 3);
    fillStroke(ctx, darken(STONE, 0.28), pal.outline, 1.4);
    ctx.beginPath();
    ctx.ellipse(px, py - 10, 7, 4.5, 0, 0, Math.PI * 2);
    fillStroke(ctx, lighten(STONE, 0.12), pal.outline, 1.4);
    ctx.beginPath();
    ctx.ellipse(px, py - 10.5, 4.2, 2.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = pal.body;
    ctx.fill();
  }
}

function cottage(ctx: Ctx2D, pal: TeamColors, W: number, H: number): void {
  shadow(ctx, 4, 6, W - 8, H - 8);
  const wall = wallColor(pal);
  frontFace(ctx, 6, 4, W - 12, H - 8, wall, pal.outline);
  // Timber posts on the face.
  ctx.fillStyle = darken(TIMBER, 0.15);
  const fy = 4 + (H - 8) * 0.75;
  for (const px of [6, W / 2 - 1.5, W - 9]) ctx.fillRect(px, fy, 3, (H - 8) * 0.25);
  door(ctx, W / 2 + 9, H - 4, 8, 12, pal.outline);
  windowGlow(ctx, 13, fy + 4, 7, 6, pal.outline);
  gableRoof(ctx, 2, 3, W - 4, (H - 8) * 0.75 + 4, roofColor(pal), pal.outline, 'thatch');
  // Chimney stub.
  ctx.beginPath();
  ctx.rect(W - 20, 6, 7, 9);
  fillStroke(ctx, STONE_DARK, pal.outline, 1.2);
}

function storehouse(ctx: Ctx2D, pal: TeamColors, W: number, H: number): void {
  shadow(ctx, 3, 6, W - 6, H - 8);
  const wood = pal.owner === 0 ? '#9A6A3C' : mix(pal.body, TIMBER, 0.5);
  frontFace(ctx, 4, 4, W - 8, H - 8, wood, pal.outline);
  const fy = 4 + (H - 8) * 0.75;
  // Double door.
  ctx.beginPath();
  ctx.rect(W / 2 - 9, fy + 2, 18, (H - 8) * 0.25 - 2);
  fillStroke(ctx, '#3A2616', pal.outline, 1.2);
  ctx.beginPath();
  ctx.moveTo(W / 2, fy + 2);
  ctx.lineTo(W / 2, H - 4);
  ctx.lineWidth = 1;
  ctx.stroke();
  // Flat plank roof with trim.
  const rh = (H - 8) * 0.75 + 2;
  ctx.beginPath();
  ctx.rect(2, 3, W - 4, rh);
  const roof = pal.owner === 0 ? '#B98446' : roofColor(pal);
  fillStroke(ctx, litGradient(ctx, W / 2, rh / 2, W * 0.6, roof, 0.12, 0.1), pal.outline, 1.5);
  ctx.strokeStyle = darken(roof, 0.28);
  ctx.lineWidth = 1;
  for (let py = 9; py < rh; py += 6) {
    ctx.beginPath();
    ctx.moveTo(4, py);
    ctx.lineTo(W - 4, py);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.rect(4.5, 5.5, W - 9, rh - 5);
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.body;
  ctx.stroke();
  // Two crates and a grain sack.
  crate(ctx, 6, H - 18, 11, pal.outline);
  crate(ctx, W - 18, H - 16, 12, pal.outline);
  ctx.beginPath();
  ctx.ellipse(W - 23, H - 7, 5, 4, 0, 0, Math.PI * 2);
  fillStroke(ctx, '#D9C27A', pal.outline, 1);
}

function grainplot(ctx: Ctx2D, pal: TeamColors, W: number, H: number): void {
  ctx.beginPath();
  roundRectPath(ctx, 3, 4, W - 6, H - 6, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fill();
  ctx.beginPath();
  ctx.rect(4, 4, W - 8, H - 8);
  ctx.fillStyle = SOIL;
  ctx.fill();
  fence(ctx, 3, 3, W - 6, H - 7, pal.outline, 3);
  // Team-colored scarecrow ribbon on a corner post.
  ctx.beginPath();
  polyPath(ctx, [W - 4, 1, W + 3, 3, W - 4, 6]);
  fillStroke(ctx, pal.body, pal.outline, 0.8);
}

/** Interior rect of the Grainplot (where live furrows are drawn). */
export const GRAINPLOT_FIELD = { x: 6, y: 6, w: 52, h: 48 };

function hall(ctx: Ctx2D, pal: TeamColors, W: number, H: number, glyph: 'spears'): void {
  shadow(ctx, 3, 6, W - 6, H - 8);
  const wall = pal.owner === 0 ? '#B98A58' : wallColor(pal);
  frontFace(ctx, 4, 6, W - 8, H - 10, wall, pal.outline);
  const fy = 6 + (H - 10) * 0.75;
  ctx.fillStyle = darken(TIMBER, 0.2);
  for (let px = 4; px < W - 6; px += 14) ctx.fillRect(px, fy, 2.5, (H - 10) * 0.25);
  door(ctx, W / 2, H - 4, 14, 18, pal.outline);
  // Shields on the face.
  for (const sx of [W / 2 - 24, W / 2 + 24]) {
    ctx.beginPath();
    ctx.moveTo(sx - 5, fy + 5);
    ctx.lineTo(sx + 5, fy + 5);
    ctx.lineTo(sx + 5, fy + 10);
    ctx.lineTo(sx, fy + 15);
    ctx.lineTo(sx - 5, fy + 10);
    ctx.closePath();
    fillStroke(ctx, pal.body, pal.outline, 1.1);
    ctx.fillStyle = pal.trim;
    ctx.fillRect(sx - 1, fy + 6, 2, 7);
  }
  gableRoof(ctx, 1, 4, W - 2, (H - 10) * 0.75 + 3, pal.owner === 0 ? '#B5652E' : roofColor(pal), pal.outline, 'shingle');
  banner(ctx, pal, W - 18, 22, 46, glyph);
}

function bowyard(ctx: Ctx2D, pal: TeamColors, W: number, H: number): void {
  ctx.beginPath();
  roundRectPath(ctx, 3, 5, W - 6, H - 6, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fill();
  // Packed-earth yard.
  ctx.beginPath();
  ctx.rect(4, 4, W - 8, H - 8);
  ctx.fillStyle = litGradient(ctx, W / 2, H / 2, W * 0.6, '#9C8456', 0.08, 0.12);
  ctx.fill();
  ctx.fillStyle = 'rgba(70,50,30,0.25)';
  for (let i = 0; i < 18; i++) ctx.fillRect(8 + hash01(i, 11) * (W - 16), 8 + hash01(i, 12) * (H - 16), 2, 1.5);
  // Shooting lane marks.
  ctx.strokeStyle = 'rgba(244,230,193,0.35)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(22, H - 22);
  ctx.lineTo(W - 26, 30);
  ctx.stroke();
  ctx.setLineDash([]);
  fence(ctx, 3, 3, W - 6, H - 7, pal.outline, 4, { side: 'bottom', at: W / 2, w: 18 });
  // Shed (top-left) with team roof.
  const sw = 40;
  const sh = 32;
  frontFace(ctx, 6, 6, sw, sh, pal.owner === 0 ? '#A57A4C' : wallColor(pal), pal.outline);
  gableRoof(ctx, 4, 4, sw + 4, sh * 0.75 + 3, pal.owner === 0 ? '#B5652E' : roofColor(pal), pal.outline, 'shingle');
  // Target on a stand (right).
  const tx = W - 24;
  const ty = 34;
  ctx.beginPath();
  ctx.moveTo(tx - 9, ty + 16);
  ctx.lineTo(tx, ty + 4);
  ctx.lineTo(tx + 9, ty + 16);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = pal.outline;
  ctx.stroke();
  for (const [r, c] of [
    [13, '#E8D9A0'],
    [10.5, '#C8402E'],
    [7.5, '#F4E6C1'],
    [4.5, '#C8402E'],
    [2, '#FFD27A'],
  ] as const) {
    ctx.beginPath();
    circlePath(ctx, tx, ty, r);
    ctx.fillStyle = c;
    ctx.fill();
  }
  ctx.beginPath();
  circlePath(ctx, tx, ty, 13);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = pal.outline;
  ctx.stroke();
  // Arrows stuck in the target.
  ctx.strokeStyle = '#F4E6C1';
  ctx.lineWidth = 1.2;
  for (const [ax, ay] of [
    [-4, -3],
    [3, 2],
  ]) {
    ctx.beginPath();
    ctx.moveTo(tx + ax, ty + ay);
    ctx.lineTo(tx + ax - 6, ty + ay + 6);
    ctx.stroke();
  }
  // Bow rack (bottom-left).
  ctx.beginPath();
  ctx.moveTo(12, H - 20);
  ctx.lineTo(38, H - 20);
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = pal.outline;
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(17 + i * 8, H - 20, 7, Math.PI * 0.15, Math.PI * 0.85);
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
    ctx.lineWidth = 1.7;
    ctx.strokeStyle = '#B07A44';
    ctx.stroke();
  }
  // Pennant.
  ctx.beginPath();
  ctx.moveTo(W - 8, 6);
  ctx.lineTo(W - 8, -10);
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.outline;
  ctx.stroke();
  ctx.beginPath();
  polyPath(ctx, [W - 8, -10, W + 4, -6, W - 8, -2]);
  fillStroke(ctx, pal.body, pal.outline, 1);
}

function paddock(ctx: Ctx2D, pal: TeamColors, W: number, H: number): void {
  ctx.beginPath();
  roundRectPath(ctx, 3, 5, W - 6, H - 6, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fill();
  ctx.beginPath();
  ctx.rect(4, 4, W - 8, H - 8);
  ctx.fillStyle = litGradient(ctx, W / 2, H / 2, W * 0.6, '#8A7A48', 0.1, 0.12);
  ctx.fill();
  // Hoof-trodden ring.
  ctx.beginPath();
  ctx.ellipse(W / 2, H / 2 + 10, W * 0.3, H * 0.2, 0, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(80,60,35,0.35)';
  ctx.stroke();
  // Stable along the top.
  const sh = 34;
  frontFace(ctx, 6, 5, W - 12, sh, pal.owner === 0 ? '#9E7046' : wallColor(pal), pal.outline);
  // Stall doors on the face.
  const fy = 5 + sh * 0.75;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.rect(14 + i * 26, fy + 1.5, 14, sh * 0.25 - 2);
    fillStroke(ctx, '#3A2616', pal.outline, 1);
  }
  gableRoof(ctx, 4, 3, W - 8, sh * 0.75 + 3, pal.owner === 0 ? '#B5652E' : roofColor(pal), pal.outline, 'shingle');
  fence(ctx, 3, 3, W - 6, H - 7, pal.outline, 4, { side: 'bottom', at: W / 2, w: 20 });
  // Hay bale and trough.
  ctx.beginPath();
  roundRectPath(ctx, 10, H - 28, 16, 11, 3);
  fillStroke(ctx, '#D9B95A', pal.outline, 1.1);
  ctx.strokeStyle = '#A88A3A';
  ctx.beginPath();
  ctx.moveTo(14, H - 28);
  ctx.lineTo(14, H - 17);
  ctx.moveTo(22, H - 28);
  ctx.lineTo(22, H - 17);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(W - 32, H - 24, 20, 7);
  fillStroke(ctx, '#7E5632', pal.outline, 1.1);
  ctx.fillStyle = '#4F93A8';
  ctx.fillRect(W - 30, H - 22.5, 16, 3);
  // Horseshoe emblem on a sign board.
  ctx.beginPath();
  roundRectPath(ctx, W / 2 - 13, H / 2 - 4, 26, 24, 4);
  fillStroke(ctx, pal.body, pal.outline, 1.4);
  drawGlyph(ctx, 'horseshoe', W / 2, H / 2 + 8.5, 20, pal.trim, pal.outline);
}

function forgehall(ctx: Ctx2D, pal: TeamColors, W: number, H: number): void {
  shadow(ctx, 3, 6, W - 6, H - 8);
  const wall = '#6E655C';
  frontFace(ctx, 4, 6, W - 8, H - 10, wall, pal.outline);
  const fy = 6 + (H - 10) * 0.75;
  // Forge mouth glow.
  ctx.beginPath();
  ctx.moveTo(W / 2 - 11, H - 4);
  ctx.lineTo(W / 2 - 11, fy + 8);
  ctx.arc(W / 2, fy + 8, 11, Math.PI, 0);
  ctx.lineTo(W / 2 + 11, H - 4);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, fy, 0, H - 4);
  g.addColorStop(0, '#FFB347');
  g.addColorStop(1, '#C2461C');
  fillStroke(ctx, g, pal.outline, 1.3);
  // Dark slate roof with team ridge trim.
  gableRoof(ctx, 1, 4, W - 2, (H - 10) * 0.75 + 3, '#4A4440', pal.outline, 'slate');
  ctx.beginPath();
  ctx.moveTo(4, 4 + ((H - 10) * 0.75 + 3) * 0.48);
  ctx.lineTo(W - 4, 4 + ((H - 10) * 0.75 + 3) * 0.48);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = pal.body;
  ctx.stroke();
  // Chimney (top right), rising above the roof.
  const cx = W - 24;
  ctx.beginPath();
  ctx.rect(cx - 8, -14, 16, 34);
  fillStroke(ctx, litGradient(ctx, cx, 0, 18, STONE_DARK, 0.2, 0.2), pal.outline, 1.4);
  ctx.strokeStyle = darken(STONE_DARK, 0.35);
  ctx.lineWidth = 1;
  for (let py = -8; py < 20; py += 6) {
    ctx.beginPath();
    ctx.moveTo(cx - 8, py);
    ctx.lineTo(cx + 8, py);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(cx, -14, 8, 3.5, 0, 0, Math.PI * 2);
  fillStroke(ctx, '#2A1A12', pal.outline, 1.2);
  // Anvil in front-left.
  ctx.beginPath();
  polyPath(ctx, [10, H - 13, 26, H - 13, 23, H - 9, 20, H - 9, 20, H - 5, 14, H - 5, 14, H - 9, 11, H - 9]);
  fillStroke(ctx, '#3E3E44', pal.outline, 1);
}

/** Chimney mouth position (live ember glow / smoke). */
export function forgeChimney(W: number): [number, number] {
  return [W - 24, -14];
}

function brazierTower(ctx: Ctx2D, pal: TeamColors, W: number, H: number): void {
  shadow(ctx, 8, 14, W - 16, H - 18, 4);
  // Square stone base with darker front face.
  const bx = 9;
  const by = 18;
  const bw = W - 18;
  const bh = H - 22;
  ctx.beginPath();
  ctx.rect(bx, by, bw, bh * 0.75);
  fillStroke(ctx, litGradient(ctx, W / 2, by + 8, bw, STONE, 0.15, 0.1), pal.outline, 1.5);
  frontFace(ctx, bx, by, bw, bh, STONE, pal.outline);
  ctx.strokeStyle = darken(STONE, 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx, by + bh * 0.4);
  ctx.lineTo(bx + bw, by + bh * 0.4);
  ctx.moveTo(W / 2, by);
  ctx.lineTo(W / 2, by + bh * 0.4);
  ctx.stroke();
  // Tall post.
  const px = W / 2;
  ctx.beginPath();
  ctx.rect(px - 5, -6, 10, by + bh * 0.5 + 6);
  fillStroke(ctx, litGradient(ctx, px, 10, 14, '#7A5A3A', 0.25, 0.25), pal.outline, 1.4);
  // Team band.
  ctx.fillStyle = pal.body;
  ctx.fillRect(px - 5, 8, 10, 4);
  ctx.strokeStyle = pal.outline;
  ctx.strokeRect(px - 5, 8, 10, 4);
  // Fire bowl (elevated).
  ctx.beginPath();
  ctx.moveTo(px - 13, -8);
  ctx.quadraticCurveTo(px, 6, px + 13, -8);
  ctx.closePath();
  fillStroke(ctx, '#3E3A38', pal.outline, 1.4);
  ctx.beginPath();
  ctx.ellipse(px, -8, 13, 4, 0, 0, Math.PI * 2);
  fillStroke(ctx, '#5A2A16', pal.outline, 1.2);
}

/** Fire bowl center for live flames. */
export function brazierBowl(W: number): [number, number] {
  return [W / 2, -9];
}

function siegeyard(ctx: Ctx2D, pal: TeamColors, W: number, H: number): void {
  ctx.beginPath();
  roundRectPath(ctx, 3, 5, W - 6, H - 6, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fill();
  ctx.beginPath();
  ctx.rect(4, 4, W - 8, H - 8);
  ctx.fillStyle = litGradient(ctx, W / 2, H / 2, W * 0.6, '#8E7A5A', 0.08, 0.12);
  ctx.fill();
  // Sawdust and chips.
  ctx.fillStyle = 'rgba(220,190,130,0.45)';
  for (let i = 0; i < 20; i++) ctx.fillRect(8 + hash01(i, 21) * (W - 16), 30 + hash01(i, 22) * (H - 40), 2, 1.4);
  // Timber frame (open shed along the right with team canvas).
  const fx = W - 44;
  frontFace(ctx, fx, 8, 38, 40, '#8A6038', pal.outline);
  ctx.beginPath();
  ctx.rect(fx, 8, 38, 30);
  fillStroke(ctx, litGradient(ctx, fx + 19, 20, 30, pal.owner === 0 ? '#D9A441' : roofColor(pal), 0.15, 0.15), pal.outline, 1.4);
  ctx.strokeStyle = darken(pal.owner === 0 ? '#D9A441' : roofColor(pal), 0.3);
  ctx.lineWidth = 1;
  for (const sx of [fx + 9, fx + 19, fx + 29]) {
    ctx.beginPath();
    ctx.moveTo(sx, 8);
    ctx.lineTo(sx, 38);
    ctx.stroke();
  }
  // Beams.
  const beam = (x0: number, y0: number, x1: number, y1: number): void => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineWidth = 4.4;
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
    ctx.lineWidth = 2.8;
    ctx.strokeStyle = '#9A6A3C';
    ctx.stroke();
  };
  // Crane: mast + boom + rope + hanging log.
  const mx = 20;
  const my = 30;
  beam(mx, H - 14, mx, my - 24);
  beam(mx, my - 20, mx + 44, my - 30);
  beam(mx, my - 6, mx + 20, my - 24);
  ctx.beginPath();
  ctx.moveTo(mx + 42, my - 29);
  ctx.lineTo(mx + 42, my + 6);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#E6D7B0';
  ctx.stroke();
  ctx.beginPath();
  roundRectPath(ctx, mx + 30, my + 6, 24, 7, 3.5);
  fillStroke(ctx, '#8B5A2B', pal.outline, 1.1);
  // Log pile (bottom-left) and ram head.
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    roundRectPath(ctx, 30 + i * 3, H - 20 - i * 5, 26, 6, 3);
    fillStroke(ctx, i % 2 ? '#7E5230' : '#946238', pal.outline, 1);
    ctx.beginPath();
    ctx.ellipse(30 + i * 3 + 26, H - 17 - i * 5, 2.4, 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#C99560';
    ctx.fill();
  }
  ctx.beginPath();
  polyPath(ctx, [W - 30, H - 16, W - 16, H - 16, W - 9, H - 12, W - 16, H - 8, W - 30, H - 8]);
  fillStroke(ctx, '#7E8288', pal.outline, 1.1);
  fence(ctx, 3, 3, W - 6, H - 7, pal.outline, 4, { side: 'bottom', at: W / 2 - 6, w: 22 });
}

// ---------------------------------------------------------------------------
// Thornwake structures
// ---------------------------------------------------------------------------

function thornMound(ctx: Ctx2D, pal: TeamColors, W: number, H: number, scale: number, seed: number, rooty: boolean): void {
  const cx = W / 2;
  const cy = H / 2 + 4;
  const R = W * 0.44 * scale;
  ctx.beginPath();
  ctx.ellipse(cx + 4, cy + 6, R * 1.02, R * 0.85, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();
  if (rooty) {
    // Roots spreading over the ground.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + hash01(i, seed) * 0.4;
      const len = R * (1.05 + hash01(i, seed + 1) * 0.3);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.6, cy + Math.sin(a) * R * 0.5);
      ctx.quadraticCurveTo(cx + Math.cos(a + 0.3) * len * 0.9, cy + Math.sin(a + 0.3) * len * 0.75, cx + Math.cos(a + 0.15) * len, cy + Math.sin(a + 0.15) * len * 0.85);
      ctx.lineWidth = 5;
      ctx.strokeStyle = pal.outline;
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = mix(pal.body, '#3A2230', 0.55);
      ctx.stroke();
    }
  }
  // Spikes behind the mound (radiating up/out).
  const spike = (a: number, len: number, w: number, k: number): void => {
    const bx = cx + Math.cos(a) * R * 0.72;
    const by = cy + Math.sin(a) * R * 0.6;
    const tx = cx + Math.cos(a) * (R + len);
    const ty = cy + Math.sin(a) * (R * 0.8 + len) - len * 0.35;
    const nx = -Math.sin(a) * w;
    const ny = Math.cos(a) * w;
    ctx.beginPath();
    ctx.moveTo(bx + nx, by + ny);
    ctx.quadraticCurveTo((bx + tx) / 2 + nx * 0.2 + k, (by + ty) / 2 + ny * 0.2, tx, ty);
    ctx.quadraticCurveTo((bx + tx) / 2 - nx * 0.4, (by + ty) / 2 - ny * 0.4, bx - nx, by - ny);
    ctx.closePath();
    fillStroke(ctx, darken(pal.body, 0.25), pal.outline, 1.2);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + (bx - tx) * 0.3 + nx * 0.3, ty + (by - ty) * 0.3 + ny * 0.3);
    ctx.lineTo(tx + (bx - tx) * 0.3 - nx * 0.3, ty + (by - ty) * 0.3 - ny * 0.3);
    ctx.closePath();
    ctx.fillStyle = pal.trim;
    ctx.fill();
  };
  for (let i = 0; i < 11; i++) {
    const a = Math.PI + (i / 10) * Math.PI + (hash01(i, seed + 5) - 0.5) * 0.25;
    spike(a, 9 + hash01(i, seed + 9) * 10 * scale, 3.4, (hash01(i, seed) - 0.5) * 6);
  }
  // Mound body: irregular blob with front shade.
  const pts: number[] = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = R * (0.88 + hash01(i, seed + 3) * 0.16);
    pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.82);
  }
  ctx.beginPath();
  ctx.moveTo((pts[0] + pts[2]) / 2, (pts[1] + pts[3]) / 2);
  for (let i = 1; i <= n; i++) {
    const k = (i % n) * 2;
    const k2 = ((i + 1) % n) * 2;
    ctx.quadraticCurveTo(pts[k], pts[k + 1], (pts[k] + pts[k2]) / 2, (pts[k + 1] + pts[k2 + 1]) / 2);
  }
  ctx.closePath();
  fillStroke(ctx, litGradient(ctx, cx, cy - R * 0.1, R, pal.body, 0.22, 0.45), pal.outline, 1.8);
  // Twisting vines across the mound.
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2 + seed;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * R * 0.9, cy + Math.sin(a0) * R * 0.72);
    ctx.bezierCurveTo(cx + Math.cos(a0 + 0.9) * R * 0.5, cy + Math.sin(a0 + 0.9) * R * 0.45, cx + Math.cos(a0 + 1.6) * R * 0.6, cy + Math.sin(a0 + 1.6) * R * 0.5, cx + Math.cos(a0 + 2.1) * R * 0.25, cy + Math.sin(a0 + 2.1) * R * 0.2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = darken(pal.body, 0.45);
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = lighten(pal.body, 0.12);
    ctx.stroke();
  }
  // Front spikes (over the mound).
  for (let i = 0; i < 7; i++) {
    const a = (i / 6) * Math.PI * 0.9 + Math.PI * 0.05 + (hash01(i, seed + 13) - 0.5) * 0.2;
    spike(a, 6 + hash01(i, seed + 17) * 6 * scale, 2.6, 0);
  }
  // Central hollow where the live core glows.
  ctx.beginPath();
  ctx.ellipse(cx, cy - R * 0.12, R * 0.34, R * 0.25, 0, 0, Math.PI * 2);
  fillStroke(ctx, '#1A0C1E', pal.outline, 1.4);
}

/** Center of the Nest core hollow relative to the footprint origin. */
export function nestCore(W: number, H: number, scale = 1): [number, number, number] {
  const R = W * 0.44 * scale;
  return [W / 2, H / 2 + 4 - R * 0.12, R * 0.34];
}

function thornNest(ctx: Ctx2D, pal: TeamColors, W: number, H: number): void {
  thornMound(ctx, pal, W, H, 1, 3, false);
}

function rootHeart(ctx: Ctx2D, pal: TeamColors, W: number, H: number): void {
  thornMound(ctx, pal, W, H, 1.12, 7, true);
}

function thornspire(ctx: Ctx2D, pal: TeamColors, W: number, H: number): void {
  const cx = W / 2;
  ctx.beginPath();
  ctx.ellipse(cx + 3, H - 5, 12, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();
  // Root base.
  ctx.beginPath();
  ctx.ellipse(cx, H - 7, 12, 6, 0, 0, Math.PI * 2);
  fillStroke(ctx, darken(pal.body, 0.35), pal.outline, 1.3);
  // Tall jagged spike rising above the tile.
  const top = -30;
  const pts = [cx - 9, H - 8, cx - 7, H - 20, cx - 11, H - 24, cx - 5, H - 28, cx - 6, 2, cx - 9, -4, cx - 3, -10, cx - 2, top + 6, cx, top, cx + 2, top + 8, cx + 4, -8, cx + 9, -12, cx + 5, 0, cx + 6, H - 26, cx + 11, H - 30, cx + 7, H - 20, cx + 9, H - 8];
  ctx.beginPath();
  polyPath(ctx, pts);
  const g = ctx.createLinearGradient(cx - 10, 0, cx + 10, 0);
  g.addColorStop(0, lighten(pal.body, 0.2));
  g.addColorStop(0.55, pal.body);
  g.addColorStop(1, darken(pal.body, 0.4));
  fillStroke(ctx, g, pal.outline, 1.5);
  // Green thorn ticks.
  ctx.fillStyle = pal.trim;
  for (const [x, y, s] of [
    [cx - 11, H - 24, -1],
    [cx - 9, -4, -1],
    [cx + 9, -12, 1],
    [cx + 11, H - 30, 1],
  ]) {
    ctx.beginPath();
    polyPath(ctx, [x, y, x - s * 3, y + 4, x + s * 2, y + 5]);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx - 1, top + 10);
  ctx.lineTo(cx - 3, H - 14);
  ctx.lineWidth = 1;
  ctx.strokeStyle = darken(pal.body, 0.45);
  ctx.stroke();
}

/** Thornspire tip for the live glow. */
export const SPIRE_TIP: [number, number] = [16, -28];

function briarThrone(ctx: Ctx2D, pal: TeamColors, W: number, H: number): void {
  const cx = W / 2;
  const cy = H / 2;
  const stone = mix(pal.body, '#2E1E2E', 0.55);
  ctx.beginPath();
  ctx.ellipse(cx + 5, cy + 10, W * 0.47, H * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fill();
  // Octagonal dais: front face (steps) then top.
  const oct = (r: number, dy: number): number[] => {
    const pts: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      pts.push(cx + Math.cos(a) * r, cy + dy + Math.sin(a) * r * 0.86);
    }
    return pts;
  };
  ctx.beginPath();
  polyPath(ctx, oct(W * 0.46, 9));
  fillStroke(ctx, darken(stone, 0.35), pal.outline, 1.8);
  ctx.beginPath();
  polyPath(ctx, oct(W * 0.46, 0));
  fillStroke(ctx, litGradient(ctx, cx, cy, W * 0.46, stone, 0.18, 0.2), pal.outline, 1.8);
  ctx.beginPath();
  polyPath(ctx, oct(W * 0.33, -4));
  fillStroke(ctx, litGradient(ctx, cx, cy - 4, W * 0.33, lighten(stone, 0.08), 0.2, 0.2), pal.outline, 1.5);
  // Step lines.
  ctx.strokeStyle = darken(stone, 0.4);
  ctx.lineWidth = 1;
  for (const k of [0.38, 0.42]) {
    ctx.beginPath();
    polyPath(ctx, oct(W * k, -1));
    ctx.stroke();
  }
  // Thorn ring around the edge.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const bx = cx + Math.cos(a) * W * 0.44;
    const by = cy + Math.sin(a) * W * 0.38;
    const tx = cx + Math.cos(a) * W * 0.53;
    const ty = cy + Math.sin(a) * W * 0.46 - 6;
    ctx.beginPath();
    polyPath(ctx, [bx - Math.sin(a) * 3.5, by + Math.cos(a) * 3.5, tx, ty, bx + Math.sin(a) * 3.5, by - Math.cos(a) * 3.5]);
    fillStroke(ctx, darken(pal.body, 0.2), pal.outline, 1);
    ctx.beginPath();
    circlePath(ctx, tx, ty, 1.6);
    ctx.fillStyle = pal.trim;
    ctx.fill();
  }
  // Throne: high thorn back + seat.
  const sx = cx;
  const sy = cy - 6;
  ctx.beginPath();
  polyPath(ctx, [sx - 22, sy + 6, sx - 24, sy - 22, sx - 16, sy - 14, sx - 12, sy - 40, sx - 5, sy - 22, sx, sy - 52, sx + 5, sy - 22, sx + 12, sy - 40, sx + 16, sy - 14, sx + 24, sy - 22, sx + 22, sy + 6]);
  fillStroke(ctx, litGradient(ctx, sx, sy - 20, 30, darken(pal.body, 0.1), 0.25, 0.35), pal.outline, 1.8);
  ctx.beginPath();
  roundRectPath(ctx, sx - 17, sy, 34, 18, 4);
  fillStroke(ctx, darken(pal.body, 0.35), pal.outline, 1.5);
  ctx.beginPath();
  roundRectPath(ctx, sx - 15, sy - 2, 30, 10, 3);
  fillStroke(ctx, '#7A2A52', pal.outline, 1.2);
  // Green veins.
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(sx, sy - 46);
  ctx.lineTo(sx, sy - 6);
  ctx.moveTo(sx - 12, sy - 34);
  ctx.lineTo(sx - 9, sy - 8);
  ctx.moveTo(sx + 12, sy - 34);
  ctx.lineTo(sx + 9, sy - 8);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Neutral objects
// ---------------------------------------------------------------------------

function cache(ctx: Ctx2D, pal: TeamColors, W: number, H: number, looted: boolean, ancient: boolean): void {
  const cx = W / 2;
  ctx.beginPath();
  ctx.ellipse(cx + 2, H - 6, 13, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();
  if (ancient) {
    // Stone plinth.
    ctx.beginPath();
    roundRectPath(ctx, 1, H - 13, W - 2, 10, 2);
    fillStroke(ctx, darken(pal.body, 0.35), pal.outline, 1.3);
    ctx.beginPath();
    roundRectPath(ctx, 1, H - 16, W - 2, 6, 2);
    fillStroke(ctx, pal.body, pal.outline, 1.3);
  }
  const by = ancient ? H - 26 : H - 20;
  const bw = ancient ? 22 : 20;
  const bh = 12;
  const bx = cx - bw / 2;
  const wood = ancient ? mix(pal.body, '#4A5A66', 0.4) : '#7A5636';
  // Chest box: front face.
  ctx.beginPath();
  ctx.rect(bx, by + 3, bw, bh);
  fillStroke(ctx, darken(wood, 0.25), pal.outline, 1.3);
  ctx.fillStyle = pal.trim;
  ctx.fillRect(bx + 3, by + 3, 2.5, bh);
  ctx.fillRect(bx + bw - 5.5, by + 3, 2.5, bh);
  if (looted) {
    // Open, empty.
    ctx.beginPath();
    ctx.rect(bx + 1, by, bw - 2, 4);
    ctx.fillStyle = '#1E140C';
    ctx.fill();
    ctx.beginPath();
    polyPath(ctx, [bx - 1, by - 1, bx + bw + 1, by - 1, bx + bw - 1, by - 9, bx + 1, by - 9]);
    fillStroke(ctx, wood, pal.outline, 1.2);
    return;
  }
  // Lid (askew for the ruined cache).
  ctx.save();
  if (!ancient) {
    ctx.translate(bx + bw / 2, by + 2);
    ctx.rotate(-0.22);
    ctx.translate(-(bx + bw / 2), -(by + 2));
  }
  ctx.beginPath();
  roundRectPath(ctx, bx - 1, by - 3, bw + 2, 7, 3);
  fillStroke(ctx, litGradient(ctx, cx, by, bw, wood, 0.2, 0.2), pal.outline, 1.2);
  ctx.fillStyle = pal.trim;
  ctx.fillRect(bx + 3, by - 3, 2.5, 7);
  ctx.fillRect(bx + bw - 5.5, by - 3, 2.5, 7);
  ctx.restore();
  // Gold spilling out.
  ctx.fillStyle = '#F2C14E';
  for (const [x, y] of [
    [bx + 3, by + 2],
    [bx + 7, by + 1],
    [bx + 12, by + 1.5],
    [bx + 16, by + 2.5],
  ]) {
    ctx.beginPath();
    circlePath(ctx, x, y, 1.9);
    ctx.fill();
  }
  if (!ancient) {
    ctx.beginPath();
    circlePath(ctx, bx + bw + 3, by + bh + 1, 1.8);
    circlePath(ctx, bx - 3, by + bh + 2, 1.5);
    ctx.fill();
  } else {
    // Rune.
    ctx.beginPath();
    ctx.moveTo(cx - 3, by + 6);
    ctx.lineTo(cx, by + 12);
    ctx.lineTo(cx + 3, by + 6);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#9FE0F0';
    ctx.stroke();
  }
}

function beaconStone(ctx: Ctx2D, pal: TeamColors, W: number, H: number): void {
  const cx = W / 2;
  const cy = H / 2 + 3;
  ctx.beginPath();
  ctx.ellipse(cx + 2, cy + 3, 26, 20, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fill();
  // Worn ground circle.
  ctx.beginPath();
  ctx.ellipse(cx, cy, 24, 19, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(120,110,90,0.35)';
  ctx.fill();
  // Central firepit.
  ctx.beginPath();
  ctx.ellipse(cx, cy, 8, 6, 0, 0, Math.PI * 2);
  fillStroke(ctx, '#2A2622', pal.outline, 1.2);
  // Five standing stones (back ones first).
  const stones: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    stones.push([cx + Math.cos(a) * 21, cy + Math.sin(a) * 15]);
  }
  stones.sort((a, b) => a[1] - b[1]);
  for (const [sx, sy] of stones) {
    ctx.beginPath();
    roundRectPath(ctx, sx - 5, sy - 15, 10, 17, 3);
    fillStroke(ctx, darken(pal.body, 0.3), pal.outline, 1.3);
    ctx.beginPath();
    roundRectPath(ctx, sx - 5, sy - 15, 10, 8, 3);
    ctx.fillStyle = litGradient(ctx, sx, sy - 12, 8, pal.body, 0.3, 0.1);
    ctx.fill();
    ctx.fillStyle = pal.trim;
    ctx.fillRect(sx - 1, sy - 6, 2, 5);
  }
}

/** Beacon firepit center. */
export function beaconPit(W: number, H: number): [number, number] {
  return [W / 2, H / 2 + 3];
}

const ART: Record<BuildingId, (ctx: Ctx2D, pal: TeamColors, W: number, H: number, v: BuildingVariant) => void> = {
  hearth,
  cottage,
  storehouse,
  grainplot,
  muster_hall: (ctx, pal, W, H) => hall(ctx, pal, W, H, 'spears'),
  bowyard,
  paddock,
  forgehall,
  brazier_tower: brazierTower,
  siegeyard,
  thorn_nest: thornNest,
  thornspire,
  root_heart: rootHeart,
  briar_throne: briarThrone,
  ruined_cache: (ctx, pal, W, H, v) => cache(ctx, pal, W, H, !!v.looted, false),
  ancient_cache: (ctx, pal, W, H, v) => cache(ctx, pal, W, H, !!v.looted, true),
  beacon_stone: beaconStone,
};

/** Draw the static art of a building with its footprint's top-left at the current origin. */
export function drawBuildingArt(ctx: Ctx2D, type: BuildingId, owner: Owner, w: number, h: number, variant: BuildingVariant = {}): void {
  const pal = teamColors(owner);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ART[type](ctx, pal, w * T, h * T, variant);
}
