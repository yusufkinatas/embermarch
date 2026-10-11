/**
 * Procedural unit silhouettes (GDD §A "Silhouettes"). Every function draws one unit centered at the
 * origin in world px (1 tile = 32 px), facing angle `f` (0 = +x). Lighting is fixed from the upper
 * left; weapons and bodies rotate with facing. Used by the sprite cache and by icons.
 */
import type { Ctx2D } from './canvas';
import type { TeamColors } from './colors';
import { darken, lighten, mix, teamColors } from './colors';
import { along, circlePath, fillStroke, litGradient, outlinedLine, polyPath, roundRectPath, shadedCircle, T } from './shapes';
import type { Owner, UnitId } from '../sim/types';

const OUT = 1.5;

/** Max reach of each sprite from its center in world px (sizes the sprite canvases). */
export const UNIT_REACH: Record<UnitId, number> = {
  tiller: 15,
  warden: 26,
  ashpike: 40,
  oathshield: 18,
  bowman: 18,
  brandbow: 21,
  courser: 21,
  destrier: 36,
  gatebreaker: 26,
  outrider: 21,
  lampbearer: 27,
  thornling: 14,
  briarguard: 36,
  spinecaster: 21,
  stagrider: 24,
  rootbreaker: 36,
  gloamwitch: 22,
  thornhusk: 24,
  antlered_lord: 38,
  briar_regent: 64,
};

/** Body radius in px (selection rings, flames, icons). */
export function unitBodyRadius(type: UnitId): number {
  switch (type) {
    case 'tiller':
      return 0.28 * T;
    case 'warden':
      return 0.35 * T;
    case 'courser':
    case 'outrider':
    case 'stagrider':
      return 0.36 * T;
    case 'destrier':
      return 0.45 * T;
    case 'gatebreaker':
    case 'rootbreaker':
    case 'thornhusk':
      return 0.45 * T;
    case 'antlered_lord':
      return 0.6 * T;
    case 'briar_regent':
      return 1.1 * T;
    default:
      return 0.3 * T;
  }
}

/** Facing up/away from the camera: weapons are drawn behind the body. */
const isBehind = (f: number): boolean => Math.sin(f) < -0.3;

function helmet(ctx: Ctx2D, pal: TeamColors, r: number): void {
  ctx.beginPath();
  ctx.arc(0, -r * 0.18, r * 0.5, Math.PI * 1.05, Math.PI * 1.95);
  ctx.closePath();
  ctx.fillStyle = mix(pal.metal, pal.body, 0.25);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = pal.outline;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Player units
// ---------------------------------------------------------------------------

function tiller(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const r = 0.28 * T;
  const [hx0, hy0] = along(f, 1, r * 0.85);
  const [hx1, hy1] = along(f, r + 3.5, r * 0.85);
  const tool = (): void => {
    outlinedLine(ctx, hx0, hy0, hx1, hy1, pal.wood, pal.outline, 1.8);
    const [bx, by] = along(f, r + 3.5, r * 0.85 - 2.6);
    outlinedLine(ctx, hx1, hy1, bx, by, pal.metal, pal.outline, 1.6);
  };
  if (isBehind(f)) tool();
  shadedCircle(ctx, 0, 0, r, pal.body, pal.outline, OUT);
  // Straw hat: brim + crown (the "cream hat dot").
  ctx.beginPath();
  circlePath(ctx, 0, -1, r * 0.52);
  fillStroke(ctx, darken(pal.trim, 0.18), pal.outline, 1);
  ctx.beginPath();
  circlePath(ctx, -0.3, -1.5, r * 0.3);
  ctx.fillStyle = litGradient(ctx, -0.3, -1.5, r * 0.3, pal.trim, 0.3, 0.05);
  ctx.fill();
  if (!isBehind(f)) tool();
}

function warden(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const r = 0.35 * T;
  // Cloak triangle behind.
  const [bx, by] = along(f, -r * 1.75, 0);
  const [lx, ly] = along(f, -r * 0.1, -r * 1.02);
  const [rx, ry] = along(f, -r * 0.1, r * 1.02);
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.quadraticCurveTo((lx + bx) / 2 + (along(f, 0, -3)[0]), (ly + by) / 2 + along(f, 0, -3)[1], bx, by);
  ctx.quadraticCurveTo((rx + bx) / 2 + along(f, 0, 3)[0], (ry + by) / 2 + along(f, 0, 3)[1], rx, ry);
  ctx.closePath();
  fillStroke(ctx, mix(pal.body, pal.deep, 0.45), pal.outline, OUT);
  // Banner pole (back right), drawn upright in 3/4.
  const [px, py] = along(f, -r * 0.8, r * 0.55);
  const pole = (): void => {
    outlinedLine(ctx, px, py + 2, px, py - 19, pal.wood, pal.outline, 1.6);
    ctx.beginPath();
    polyPath(ctx, [px + 0.5, py - 19, px + 10, py - 17, px + 7, py - 14.5, px + 10, py - 12, px + 0.5, py - 12]);
    fillStroke(ctx, pal.trim, pal.outline, 1);
    ctx.beginPath();
    circlePath(ctx, px + 4.2, py - 15.5, 1.6);
    ctx.fillStyle = pal.body;
    ctx.fill();
  };
  pole();
  shadedCircle(ctx, 0, 0, r, pal.body, pal.outline, OUT);
  // Pauldron trim ring.
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.72, Math.PI * 0.15, Math.PI * 0.85);
  ctx.strokeStyle = lighten(pal.trim, 0.1);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // Sword along facing.
  const [s0x, s0y] = along(f, r * 0.6, -r * 0.75);
  const [s1x, s1y] = along(f, r + 7, -r * 0.75);
  outlinedLine(ctx, s0x, s0y, s1x, s1y, pal.metal, pal.outline, 2);
  // 3-spike flame crown (always upright).
  const cy = -r * 0.25;
  ctx.beginPath();
  polyPath(ctx, [-5.5, cy + 2, -6, cy - 4.5, -3, cy - 1, 0, cy - 7, 3, cy - 1, 6, cy - 4.5, 5.5, cy + 2]);
  fillStroke(ctx, pal.accent, pal.outline, 1.1);
  ctx.beginPath();
  circlePath(ctx, 0, cy - 0.5, 1.4);
  ctx.fillStyle = '#FFF4D0';
  ctx.fill();
}

function spearUnit(ctx: Ctx2D, pal: TeamColors, f: number, len: number, side: number, thorn: boolean): void {
  const [x0, y0] = along(f, -8, side);
  const [x1, y1] = along(f, len, side);
  if (thorn) {
    // Jagged thorn spear: zigzag shaft with ticks.
    ctx.beginPath();
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const d = -8 + ((len + 8) * i) / n;
      const [x, y] = along(f, d, side + (i % 2 === 0 ? -1.1 : 1.1));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.6;
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = mix(pal.wood, pal.body, 0.35);
    ctx.stroke();
    for (let i = 1; i < 5; i++) {
      const d = -2 + (len * i) / 5;
      const s = i % 2 === 0 ? 1 : -1;
      const [ax, ay] = along(f, d, side);
      const [bx, by] = along(f, d - 2.5, side + s * 4);
      outlinedLine(ctx, ax, ay, bx, by, pal.trim, pal.outline, 1.2);
    }
    const [t0x, t0y] = along(f, len + 8, side);
    const [t1x, t1y] = along(f, len - 1, side - 3);
    const [t2x, t2y] = along(f, len - 1, side + 3);
    ctx.beginPath();
    polyPath(ctx, [t0x, t0y, t1x, t1y, t2x, t2y]);
    fillStroke(ctx, pal.trim, pal.outline, 1);
    return;
  }
  outlinedLine(ctx, x0, y0, x1, y1, pal.wood, pal.outline, 2);
  const [t0x, t0y] = along(f, len + 7, side);
  const [t1x, t1y] = along(f, len - 0.5, side - 2.8);
  const [t2x, t2y] = along(f, len - 0.5, side + 2.8);
  ctx.beginPath();
  polyPath(ctx, [t0x, t0y, t1x, t1y, t2x, t2y]);
  fillStroke(ctx, pal.metal, pal.outline, 1);
}

function ashpike(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const r = 0.3 * T;
  const back = isBehind(f);
  if (back) spearUnit(ctx, pal, f, 0.9 * T - 7, r * 0.55, false);
  shadedCircle(ctx, 0, 0, r, pal.body, pal.outline, OUT);
  helmet(ctx, pal, r);
  if (!back) spearUnit(ctx, pal, f, 0.9 * T - 7, r * 0.55, false);
}

function oathshield(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const r = 0.3 * T;
  const shield = (): void => {
    ctx.save();
    const [cx, cy] = along(f, r * 0.95, 0);
    ctx.translate(cx, cy);
    ctx.rotate(f);
    ctx.beginPath();
    roundRectPath(ctx, -3.4, -8.2, 6.8, 16.4, 2);
    ctx.restore();
    fillStroke(ctx, litGradient(ctx, cx, cy, 9, pal.trim, 0.2, 0.25), pal.outline, OUT);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(f);
    ctx.beginPath();
    ctx.rect(-1.2, -7, 2.4, 14);
    ctx.fillStyle = pal.body;
    ctx.fill();
    ctx.beginPath();
    circlePath(ctx, 0, 0, 2.1);
    ctx.fillStyle = pal.metal;
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
    ctx.restore();
  };
  const back = isBehind(f);
  if (back) shield();
  shadedCircle(ctx, 0, 0, r, pal.body, pal.outline, OUT);
  helmet(ctx, pal, r);
  // Crest plume.
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.55, 1.6, 3.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = pal.trim;
  ctx.fill();
  if (!back) shield();
}

function bowArc(ctx: Ctx2D, pal: TeamColors, f: number, r: number, color: string, flame: boolean): void {
  const c = f - 0.25;
  const R = r + 3.6;
  ctx.beginPath();
  ctx.arc(0, 0, R, c - 0.95, c + 0.95);
  ctx.lineCap = 'round';
  ctx.lineWidth = 4.2;
  ctx.strokeStyle = pal.outline;
  ctx.stroke();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = color;
  ctx.stroke();
  // String.
  const ax = Math.cos(c - 0.95) * R;
  const ay = Math.sin(c - 0.95) * R;
  const bx = Math.cos(c + 0.95) * R;
  const by = Math.sin(c + 0.95) * R;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = lighten(pal.trim, 0.3);
  ctx.stroke();
  if (flame) {
    // Nocked arrow with a flame dot at the tip (flicker is added live).
    const [n0x, n0y] = along(c, R * 0.55, 0);
    const [n1x, n1y] = along(c, R + 4, 0);
    outlinedLine(ctx, n0x, n0y, n1x, n1y, pal.trim, pal.outline, 1.1);
    const g = ctx.createRadialGradient(n1x, n1y, 0, n1x, n1y, 5);
    g.addColorStop(0, 'rgba(255,214,120,0.95)');
    g.addColorStop(0.45, 'rgba(255,106,43,0.7)');
    g.addColorStop(1, 'rgba(255,106,43,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    circlePath(ctx, n1x, n1y, 5);
    ctx.fill();
  }
}

/** Arrow-tip offset for the Brandbow flame flicker (live overlay). */
export function brandbowFlameTip(f: number): [number, number] {
  const c = f - 0.25;
  return along(c, 0.3 * T + 3.6 + 4, 0);
}

function hoodedArcher(ctx: Ctx2D, pal: TeamColors, f: number, bowColor: string, flame: boolean, hood: string): void {
  const r = 0.3 * T;
  // Hood triangle trailing behind.
  const [tx, ty] = along(f, -r * 1.65, 0);
  const [lx, ly] = along(f, -r * 0.2, -r * 0.92);
  const [rx, ry] = along(f, -r * 0.2, r * 0.92);
  ctx.beginPath();
  polyPath(ctx, [lx, ly, tx, ty, rx, ry]);
  fillStroke(ctx, hood, pal.outline, OUT);
  const back = isBehind(f);
  if (back) bowArc(ctx, pal, f, r, bowColor, flame);
  shadedCircle(ctx, 0, 0, r, pal.body, pal.outline, OUT);
  // Hood rim over the head.
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, f + Math.PI * 0.55, f + Math.PI * 1.45);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = hood;
  ctx.stroke();
  if (!back) bowArc(ctx, pal, f, r, bowColor, flame);
}

function bowman(ctx: Ctx2D, pal: TeamColors, f: number): void {
  hoodedArcher(ctx, pal, f, mix(pal.wood, '#C08A4A', 0.4), false, mix(pal.body, '#3E5A2A', 0.55));
}

function brandbow(ctx: Ctx2D, pal: TeamColors, f: number): void {
  hoodedArcher(ctx, pal, f, '#FF6A2B', true, mix(pal.deep, '#2A1A14', 0.4));
}

function horseBody(ctx: Ctx2D, pal: TeamColors, f: number, rx: number, ry: number, coat: string): void {
  // Tail.
  const [t0x, t0y] = along(f, -rx + 1, 0);
  const [t1x, t1y] = along(f, -rx - 5, 1.5);
  outlinedLine(ctx, t0x, t0y, t1x, t1y, darken(coat, 0.45), pal.outline, 2);
  // Body ellipse (path rotated, gradient unrotated).
  ctx.save();
  ctx.rotate(f);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.restore();
  fillStroke(ctx, litGradient(ctx, 0, 0, rx, coat, 0.25, 0.25), pal.outline, OUT);
  // Head + neck.
  ctx.save();
  ctx.rotate(f);
  ctx.beginPath();
  ctx.ellipse(rx + 2.2, 0, 4.6, 2.9, 0, 0, Math.PI * 2);
  ctx.restore();
  fillStroke(ctx, litGradient(ctx, ...along(f, rx + 2.2, 0), 4.6, coat, 0.2, 0.2), pal.outline, 1.2);
  // Mane line.
  const [m0x, m0y] = along(f, rx - 4, 0);
  const [m1x, m1y] = along(f, rx + 3, 0);
  outlinedLine(ctx, m0x, m0y, m1x, m1y, darken(coat, 0.5), darken(coat, 0.5), 1.2);
}

function rider(ctx: Ctx2D, pal: TeamColors, f: number, back: number, r: number): void {
  const [x, y] = along(f, back, 0);
  shadedCircle(ctx, x, y, r, pal.body, pal.outline, 1.3);
  ctx.beginPath();
  circlePath(ctx, x - 0.3, y - 0.8, r * 0.45);
  ctx.fillStyle = pal.trim;
  ctx.fill();
}

function saddleCloth(ctx: Ctx2D, pal: TeamColors, f: number, rx: number, ry: number, at: number, width: number): void {
  ctx.save();
  ctx.rotate(f);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx - 0.5, ry - 0.5, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = pal.trim;
  ctx.fillRect(at - width / 2, -ry, width, ry * 2);
  ctx.restore();
}

function courser(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const rx = 0.35 * T;
  const ry = 0.175 * T;
  horseBody(ctx, pal, f, rx, ry, pal.dark);
  saddleCloth(ctx, pal, f, rx, ry, -1.5, 5);
  rider(ctx, pal, f, -1.5, 4.8);
}

function destrier(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const rx = 0.45 * T;
  const ry = 0.225 * T;
  const back = isBehind(f);
  const lance = (): void => {
    const [l0x, l0y] = along(f, -9, 6);
    const [l1x, l1y] = along(f, 30, 6);
    outlinedLine(ctx, l0x, l0y, l1x, l1y, pal.wood, pal.outline, 2.2);
    const [t0x, t0y] = along(f, 35, 6);
    const [t1x, t1y] = along(f, 28, 3.6);
    const [t2x, t2y] = along(f, 28, 8.4);
    ctx.beginPath();
    polyPath(ctx, [t0x, t0y, t1x, t1y, t2x, t2y]);
    fillStroke(ctx, pal.metal, pal.outline, 1);
    // Pennant.
    const [p0x, p0y] = along(f, 22, 6);
    const [p1x, p1y] = along(f, 17, 11);
    const [p2x, p2y] = along(f, 15, 6);
    ctx.beginPath();
    polyPath(ctx, [p0x, p0y, p1x, p1y, p2x, p2y]);
    fillStroke(ctx, pal.trim, pal.outline, 0.8);
  };
  if (back) lance();
  horseBody(ctx, pal, f, rx, ry, pal.dark);
  // Barding stripes.
  ctx.save();
  ctx.rotate(f);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx - 0.6, ry - 0.6, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = pal.trim;
  for (const sx of [-8, -1, 6]) ctx.fillRect(sx - 1.6, -ry, 3.2, ry * 2);
  ctx.fillStyle = pal.body;
  ctx.fillRect(-rx, -1.4, rx * 2, 2.8);
  ctx.restore();
  rider(ctx, pal, f, -2, 5.4);
  helmetAt(ctx, pal, ...along(f, -2, 0), 5.4);
  if (!back) lance();
}

function helmetAt(ctx: Ctx2D, pal: TeamColors, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y - r * 0.15, r * 0.55, Math.PI * 1.05, Math.PI * 1.95);
  ctx.closePath();
  ctx.fillStyle = pal.metal;
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = pal.outline;
  ctx.stroke();
}

function outrider(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const rx = 0.35 * T;
  const ry = 0.175 * T;
  horseBody(ctx, pal, f, rx, ry, mix(pal.dark, '#6A5A3A', 0.25));
  saddleCloth(ctx, pal, f, rx, ry, -1.5, 3.5);
  // Quiver on the haunch.
  const [qx, qy] = along(f, -7, -4);
  const [q2x, q2y] = along(f, -12, -6);
  outlinedLine(ctx, qx, qy, q2x, q2y, pal.wood, pal.outline, 2.4);
  rider(ctx, pal, f, -1.5, 4.6);
  // Bow arc around the rider.
  const [cx, cy] = along(f, -1.5, 0);
  const c = f - 0.4;
  ctx.beginPath();
  ctx.arc(cx, cy, 8, c - 0.85, c + 0.85);
  ctx.lineCap = 'round';
  ctx.lineWidth = 3.6;
  ctx.strokeStyle = pal.outline;
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = mix(pal.wood, '#C08A4A', 0.4);
  ctx.stroke();
}

function gatebreaker(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const L = 0.9 * T;
  const W = 0.6 * T;
  // Wheels (under the frame).
  for (const [dx, dy] of [
    [-L * 0.32, -W / 2 - 1],
    [L * 0.28, -W / 2 - 1],
    [-L * 0.32, W / 2 + 1],
    [L * 0.28, W / 2 + 1],
  ]) {
    const [wx, wy] = along(f, dx, dy);
    ctx.beginPath();
    circlePath(ctx, wx, wy, 3.4);
    fillStroke(ctx, '#3A2A1E', pal.outline, 1);
    ctx.beginPath();
    circlePath(ctx, wx, wy, 1.1);
    ctx.fillStyle = '#8A7A68';
    ctx.fill();
  }
  // Iron head.
  ctx.save();
  ctx.rotate(f);
  ctx.beginPath();
  polyPath(ctx, [L / 2 - 2, -5.5, L / 2 + 5, -4, L / 2 + 10, 0, L / 2 + 5, 4, L / 2 - 2, 5.5]);
  ctx.restore();
  fillStroke(ctx, litGradient(ctx, ...along(f, L / 2 + 3, 0), 8, '#8E9298', 0.3, 0.3), pal.outline, 1.2);
  // Frame box.
  ctx.save();
  ctx.rotate(f);
  ctx.beginPath();
  roundRectPath(ctx, -L / 2, -W / 2, L, W, 3);
  ctx.restore();
  fillStroke(ctx, litGradient(ctx, 0, 0, L * 0.6, mix(pal.wood, '#8B5A2B', 0.5), 0.2, 0.25), pal.outline, OUT);
  // Hide roof in team color + plank seams.
  ctx.save();
  ctx.rotate(f);
  ctx.beginPath();
  roundRectPath(ctx, -L / 2 + 3.5, -W / 2 + 3, L - 7, W - 6, 2);
  ctx.fillStyle = pal.body;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = pal.dark;
  for (const sx of [-L * 0.18, 0, L * 0.18]) {
    ctx.beginPath();
    ctx.moveTo(sx, -W / 2 + 3.5);
    ctx.lineTo(sx, W / 2 - 3.5);
    ctx.stroke();
  }
  ctx.fillStyle = lighten(pal.body, 0.35);
  ctx.fillRect(-L / 2 + 4, -W / 2 + 3.5, L - 8, 1.6);
  ctx.restore();
}

function lampbearer(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const r = 0.3 * T;
  const [p0x, p0y] = along(f, -2, r * 0.7);
  const [lx, ly] = along(f, r + 4, r * 0.85);
  const lantern = (): void => {
    outlinedLine(ctx, p0x, p0y, lx, ly - 4, pal.wood, pal.outline, 1.6);
    const g = ctx.createRadialGradient(lx, ly - 2, 0, lx, ly - 2, 11);
    g.addColorStop(0, 'rgba(255,226,140,0.85)');
    g.addColorStop(0.4, 'rgba(255,190,90,0.35)');
    g.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    circlePath(ctx, lx, ly - 2, 11);
    ctx.fill();
    ctx.beginPath();
    roundRectPath(ctx, lx - 2.6, ly - 5, 5.2, 6.2, 1.2);
    fillStroke(ctx, '#FFE7A0', pal.outline, 1);
    ctx.beginPath();
    circlePath(ctx, lx, ly - 2, 1.4);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
  };
  if (isBehind(f)) lantern();
  shadedCircle(ctx, 0, 0, r, pal.body, pal.outline, OUT);
  // Pale hood (healer).
  ctx.beginPath();
  circlePath(ctx, 0, -1, r * 0.55);
  ctx.fillStyle = litGradient(ctx, 0, -1, r * 0.55, pal.trim, 0.2, 0.1);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = pal.outline;
  ctx.stroke();
  if (!isBehind(f)) lantern();
}

// ---------------------------------------------------------------------------
// Thornwake
// ---------------------------------------------------------------------------

function thornling(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const n = 5;
  const ro = 0.36 * T;
  const ri = 0.17 * T;
  const pts: number[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = f + (i * Math.PI) / n;
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.beginPath();
  polyPath(ctx, pts);
  fillStroke(ctx, litGradient(ctx, 0, 0, ro, pal.body, 0.3, 0.25), pal.outline, OUT);
  // Green tips: vertex 2i is a point; its neighbours 2i-1 and 2i+1 are inner vertices.
  ctx.fillStyle = pal.trim;
  const m = n * 2;
  for (let i = 0; i < n; i++) {
    const iTip = i * 4;
    const iPrev = ((i * 2 - 1 + m) % m) * 2;
    const iNext = ((i * 2 + 1) % m) * 2;
    const tipX = pts[iTip];
    const tipY = pts[iTip + 1];
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + (pts[iPrev] - tipX) * 0.45, tipY + (pts[iPrev + 1] - tipY) * 0.45);
    ctx.lineTo(tipX + (pts[iNext] - tipX) * 0.45, tipY + (pts[iNext + 1] - tipY) * 0.45);
    ctx.closePath();
    ctx.fill();
  }
  // Eye glints.
  const [ex, ey] = along(f, 2.5, -1.8);
  const [fx, fy] = along(f, 2.5, 1.8);
  ctx.fillStyle = lighten(pal.trim, 0.4);
  ctx.fillRect(ex - 0.8, ey - 0.8, 1.6, 1.6);
  ctx.fillRect(fx - 0.8, fy - 0.8, 1.6, 1.6);
}

function briarguard(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const r = 0.3 * T;
  const back = isBehind(f);
  if (back) spearUnit(ctx, pal, f, 0.85 * T - 6, r * 0.55, true);
  shadedCircle(ctx, 0, 0, r, pal.body, pal.outline, OUT);
  // Thorn crest.
  ctx.fillStyle = pal.trim;
  for (const a of [-2.3, -1.57, -0.84]) {
    ctx.beginPath();
    polyPath(ctx, [Math.cos(a - 0.25) * r * 0.45, Math.sin(a - 0.25) * r * 0.45, Math.cos(a) * r * 1.0, Math.sin(a) * r * 1.0 - 1, Math.cos(a + 0.25) * r * 0.45, Math.sin(a + 0.25) * r * 0.45]);
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
  }
  if (!back) spearUnit(ctx, pal, f, 0.85 * T - 6, r * 0.55, true);
}

function spinecaster(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const r = 0.3 * T;
  // Quills on the back (behind).
  for (const s of [-1, 0, 1]) {
    const [q0x, q0y] = along(f, -r * 0.3, s * r * 0.45);
    const [q1x, q1y] = along(f, -r * 1.75, s * r * 1.05);
    outlinedLine(ctx, q0x, q0y, q1x, q1y, pal.trim, pal.outline, 1.7);
  }
  // Hunched teardrop (round front, pointed back).
  ctx.save();
  ctx.rotate(f);
  ctx.beginPath();
  ctx.moveTo(-r * 1.45, 0);
  ctx.bezierCurveTo(-r * 0.8, -r * 1.05, r * 1.05, -r * 1.05, r * 1.05, 0);
  ctx.bezierCurveTo(r * 1.05, r * 1.05, -r * 0.8, r * 1.05, -r * 1.45, 0);
  ctx.closePath();
  ctx.restore();
  fillStroke(ctx, litGradient(ctx, 0, 0, r * 1.2, pal.body, 0.3, 0.25), pal.outline, OUT);
  // Hunch ridge.
  ctx.save();
  ctx.rotate(f);
  ctx.beginPath();
  ctx.moveTo(-r * 1.1, 0);
  ctx.quadraticCurveTo(-r * 0.2, -1.5, r * 0.4, 0);
  ctx.restore();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = darken(pal.body, 0.35);
  ctx.stroke();
  // Glowing maw.
  const [mx, my] = along(f, r * 0.75, 0);
  ctx.beginPath();
  circlePath(ctx, mx, my, 1.8);
  ctx.fillStyle = lighten(pal.trim, 0.25);
  ctx.fill();
}

function antlers(ctx: Ctx2D, pal: TeamColors, f: number, hx: number, scale: number): void {
  const bone = mix('#E6DCC2', pal.trim, 0.25);
  for (const s of [-1, 1]) {
    const [ax, ay] = along(f, hx, s * 1.5 * scale);
    const [bx, by] = along(f, hx + 4 * scale, s * 6 * scale);
    const [cx, cy] = along(f, hx + 1 * scale, s * 10 * scale);
    const [dx, dy] = along(f, hx + 8 * scale, s * 8.5 * scale);
    const [ex, ey] = along(f, hx + 6 * scale, s * 3.5 * scale);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.moveTo(bx, by);
    ctx.lineTo(dx, dy);
    ctx.moveTo((ax + bx) / 2, (ay + by) / 2);
    ctx.lineTo(ex, ey);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.2 * Math.min(1.4, scale);
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
    ctx.lineWidth = 1.6 * Math.min(1.4, scale);
    ctx.strokeStyle = bone;
    ctx.stroke();
  }
}

function stagrider(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const rx = 0.35 * T;
  const ry = 0.18 * T;
  horseBody(ctx, pal, f, rx, ry, mix(pal.dark, '#3A2A44', 0.3));
  // Mossy back stripe.
  ctx.save();
  ctx.rotate(f);
  ctx.beginPath();
  ctx.ellipse(-2, 0, rx * 0.65, 1.5, 0, 0, Math.PI * 2);
  ctx.restore();
  ctx.fillStyle = darken(pal.trim, 0.35);
  ctx.fill();
  antlers(ctx, pal, f, rx + 3.5, 1);
  rider(ctx, pal, f, -2, 4.6);
}

function rootbreaker(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const L = 0.95 * T;
  const W = 0.6 * T;
  const bark = mix(pal.body, '#4E3226', 0.5);
  // Root tendrils dragging behind.
  for (const s of [-1, -0.35, 0.35, 1]) {
    const [r0x, r0y] = along(f, -L / 2 + 2, s * W * 0.35);
    const [c1x, c1y] = along(f, -L / 2 - 6, s * W * 0.7 + s * 3);
    const [r1x, r1y] = along(f, -L / 2 - 13 + Math.abs(s) * 3, s * W * 0.45 - s * 2);
    ctx.beginPath();
    ctx.moveTo(r0x, r0y);
    ctx.quadraticCurveTo(c1x, c1y, r1x, r1y);
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = darken(bark, 0.15);
    ctx.stroke();
  }
  // Trunk.
  ctx.save();
  ctx.rotate(f);
  ctx.beginPath();
  roundRectPath(ctx, -L / 2, -W / 2, L, W, W * 0.42);
  ctx.restore();
  fillStroke(ctx, litGradient(ctx, 0, 0, L * 0.6, bark, 0.25, 0.3), pal.outline, OUT);
  // Bark grain + ring at the head.
  ctx.save();
  ctx.rotate(f);
  ctx.strokeStyle = darken(bark, 0.35);
  ctx.lineWidth = 1;
  for (const y of [-W * 0.22, 0, W * 0.22]) {
    ctx.beginPath();
    ctx.moveTo(-L * 0.38, y);
    ctx.lineTo(L * 0.25, y + (y === 0 ? 1 : 0));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(L / 2 - 3, 0, 2.6, W / 2 - 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = lighten(bark, 0.25);
  ctx.fill();
  ctx.stroke();
  // Violet hide band (team color) + glowing knots.
  ctx.fillStyle = pal.body;
  ctx.fillRect(-L * 0.12, -W / 2 + 1, 4, W - 2);
  ctx.fillStyle = pal.trim;
  ctx.beginPath();
  circlePath(ctx, L * 0.18, -W * 0.18, 1.5);
  circlePath(ctx, -L * 0.25, W * 0.16, 1.3);
  ctx.fill();
  ctx.restore();
}

function gloamwitch(ctx: Ctx2D, pal: TeamColors, f: number): void {
  // Tall robe triangle (upright in 3/4), orb drawn live.
  ctx.beginPath();
  ctx.moveTo(0, -15);
  ctx.quadraticCurveTo(3, -6, 9.5, 8);
  ctx.quadraticCurveTo(0, 11, -9.5, 8);
  ctx.quadraticCurveTo(-3, -6, 0, -15);
  ctx.closePath();
  fillStroke(ctx, litGradient(ctx, 0, -2, 14, pal.body, 0.3, 0.3), pal.outline, OUT);
  // Robe folds.
  ctx.beginPath();
  ctx.moveTo(-2.5, -4);
  ctx.lineTo(-4.5, 8);
  ctx.moveTo(2.5, -4);
  ctx.lineTo(4.5, 8);
  ctx.lineWidth = 1;
  ctx.strokeStyle = darken(pal.body, 0.35);
  ctx.stroke();
  // Hood + face glow.
  ctx.beginPath();
  circlePath(ctx, 0, -8.5, 4.4);
  fillStroke(ctx, darken(pal.body, 0.25), pal.outline, 1.1);
  const [ex, ey] = along(f, 1.5, 0);
  ctx.beginPath();
  circlePath(ctx, ex * 0.6, -8 + ey * 0.4, 1.6);
  ctx.fillStyle = pal.trim;
  ctx.fill();
  // Thorn collar.
  ctx.fillStyle = pal.trim;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    polyPath(ctx, [s * 3, -4.5, s * 8, -7.5, s * 4.5, -2.5]);
    ctx.fill();
  }
}

/** Gloamwitch floating orb offset (live overlay, bobbing). */
export function gloamwitchOrb(f: number): [number, number] {
  const c = Math.cos(f) >= 0 ? 1 : -1;
  return [c * 11, -10];
}

function thornhusk(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const r = 0.45 * T;
  // Spikes around the rim.
  ctx.fillStyle = pal.trim;
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    const a = f + (i / 9) * Math.PI * 2 + 0.2;
    const [b0x, b0y] = [Math.cos(a - 0.17) * r * 0.9, Math.sin(a - 0.17) * r * 0.9];
    const [b1x, b1y] = [Math.cos(a + 0.17) * r * 0.9, Math.sin(a + 0.17) * r * 0.9];
    const [tx, ty] = [Math.cos(a) * (r + 6), Math.sin(a) * (r + 6)];
    ctx.beginPath();
    polyPath(ctx, [b0x, b0y, tx, ty, b1x, b1y]);
    ctx.fill();
    ctx.stroke();
  }
  shadedCircle(ctx, 0, 0, r, darken(pal.body, 0.1), pal.outline, OUT + 0.3);
  // Bark plates.
  const plate = darken(mix(pal.body, '#4E3226', 0.45), 0.1);
  const plates: number[][] = [
    [-9, -8, -2, -11, 1, -5, -5, -2],
    [3, -10, 10, -6, 8, 0, 2, -3],
    [-11, 0, -5, 1, -4, 8, -10, 6],
    [-2, 2, 5, 3, 4, 10, -2, 11],
    [7, 3, 12, 2, 10, 8],
  ];
  ctx.save();
  ctx.rotate(f);
  for (const p of plates) {
    ctx.beginPath();
    polyPath(ctx, p);
    ctx.fillStyle = plate;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = darken(plate, 0.4);
    ctx.stroke();
  }
  ctx.restore();
  // Highlight sheen.
  ctx.beginPath();
  ctx.arc(-r * 0.25, -r * 0.3, r * 0.45, Math.PI * 1.1, Math.PI * 1.7);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.stroke();
  // Eyes.
  const [ex, ey] = along(f, r * 0.6, -3);
  const [fx, fy] = along(f, r * 0.6, 3);
  ctx.fillStyle = lighten(pal.trim, 0.3);
  ctx.beginPath();
  circlePath(ctx, ex, ey, 1.4);
  circlePath(ctx, fx, fy, 1.4);
  ctx.fill();
}

function antleredLord(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const s = 1.55;
  ctx.save();
  ctx.scale(s, s);
  // Cape trailing behind.
  const [c0x, c0y] = along(f, -2, -4.5);
  const [c1x, c1y] = along(f, -2, 4.5);
  const [c2x, c2y] = along(f, -15, 0);
  ctx.beginPath();
  polyPath(ctx, [c0x, c0y, c2x, c2y, c1x, c1y]);
  fillStroke(ctx, darken(pal.body, 0.4), pal.outline, 1.1);
  const rx = 0.35 * T;
  const ry = 0.18 * T;
  horseBody(ctx, pal, f, rx, ry, mix(pal.dark, '#2A1E34', 0.35));
  antlers(ctx, pal, f, rx + 3.5, 1.15);
  rider(ctx, pal, f, -2, 5);
  // Thorn crown on the rider.
  const [hx, hy] = along(f, -2, 0);
  ctx.fillStyle = pal.trim;
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    polyPath(ctx, [hx + Math.cos(a - 0.3) * 3.2, hy + Math.sin(a - 0.3) * 3.2, hx + Math.cos(a) * 7.2, hy + Math.sin(a) * 7.2, hx + Math.cos(a + 0.3) * 3.2, hy + Math.sin(a + 0.3) * 3.2]);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function briarRegent(ctx: Ctx2D, pal: TeamColors, f: number): void {
  const r = 1.1 * T;
  const vine = mix(pal.body, '#3A2230', 0.45);
  // Four sweeping thorn arms.
  const arms: [number, number][] = [
    [0.55, 1],
    [-0.55, -1],
    [2.3, 1],
    [-2.3, -1],
  ];
  for (const [a0, sweep] of arms) {
    const a = f + a0;
    const bx = Math.cos(a) * r * 0.75;
    const by = Math.sin(a) * r * 0.75;
    const ex = Math.cos(a + sweep * 0.55) * r * 1.62;
    const ey = Math.sin(a + sweep * 0.55) * r * 1.62;
    const cx = Math.cos(a + sweep * 0.05) * r * 1.45;
    const cy = Math.sin(a + sweep * 0.05) * r * 1.45;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.lineCap = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.strokeStyle = vine;
    ctx.stroke();
    // Thorns along the arm.
    for (let k = 1; k <= 4; k++) {
      const t = k / 5;
      const px = (1 - t) * (1 - t) * bx + 2 * (1 - t) * t * cx + t * t * ex;
      const py = (1 - t) * (1 - t) * by + 2 * (1 - t) * t * cy + t * t * ey;
      const na = Math.atan2(py, px) + (k % 2 === 0 ? 0.9 : -0.9) * sweep;
      ctx.beginPath();
      polyPath(ctx, [px + Math.cos(na + 1.4) * 2.2, py + Math.sin(na + 1.4) * 2.2, px + Math.cos(na) * 7, py + Math.sin(na) * 7, px + Math.cos(na - 1.4) * 2.2, py + Math.sin(na - 1.4) * 2.2]);
      ctx.fillStyle = pal.trim;
      ctx.fill();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = pal.outline;
      ctx.stroke();
    }
  }
  // Body.
  shadedCircle(ctx, 0, 0, r, darken(pal.body, 0.05), pal.outline, 2.2);
  // Bark plates and veins.
  ctx.save();
  ctx.rotate(f);
  ctx.strokeStyle = darken(pal.body, 0.45);
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25);
    ctx.quadraticCurveTo(Math.cos(a + 0.3) * r * 0.6, Math.sin(a + 0.3) * r * 0.6, Math.cos(a + 0.15) * r * 0.92, Math.sin(a + 0.15) * r * 0.92);
    ctx.stroke();
  }
  ctx.restore();
  // Core glow.
  const g = ctx.createRadialGradient(0, 2, 0, 0, 2, r * 0.45);
  g.addColorStop(0, 'rgba(200,255,140,0.85)');
  g.addColorStop(0.5, 'rgba(143,209,79,0.35)');
  g.addColorStop(1, 'rgba(143,209,79,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  circlePath(ctx, 0, 2, r * 0.45);
  ctx.fill();
  // 7-spike crown (upright).
  const cy = -r * 0.42;
  const pts: number[] = [];
  const cw = r * 0.62;
  for (let i = 0; i <= 14; i++) {
    const x = -cw + (2 * cw * i) / 14;
    const tip = i % 2 === 1;
    const k = Math.abs(i - 7) / 7;
    pts.push(x, tip ? cy - 15 + k * 6 : cy);
  }
  pts.push(cw, cy + 6, -cw, cy + 6);
  ctx.beginPath();
  polyPath(ctx, pts);
  fillStroke(ctx, litGradient(ctx, 0, cy - 5, cw, '#C9D86A', 0.35, 0.3), pal.outline, 1.4);
  ctx.beginPath();
  for (const x of [-cw * 0.55, 0, cw * 0.55]) circlePath(ctx, x, cy + 2, 2.2);
  ctx.fillStyle = '#B03A6A';
  ctx.fill();
}

const ART: Record<UnitId, (ctx: Ctx2D, pal: TeamColors, f: number) => void> = {
  tiller,
  warden,
  ashpike,
  bowman,
  courser,
  oathshield,
  brandbow,
  destrier,
  gatebreaker,
  outrider,
  lampbearer,
  thornling,
  briarguard,
  spinecaster,
  stagrider,
  rootbreaker,
  gloamwitch,
  thornhusk,
  antlered_lord: antleredLord,
  briar_regent: briarRegent,
};

/** Draw a unit silhouette centered at the current origin. */
export function drawUnitArt(ctx: Ctx2D, type: UnitId, owner: Owner, facing: number): void {
  const pal = teamColors(owner);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ART[type](ctx, pal, facing);
}
