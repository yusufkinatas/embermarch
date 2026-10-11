/**
 * Procedural icons/portraits for the HUD command card, selection panel and run screens. OWNER: render.
 * Every icon is vector art drawn straight into the target context (crisp at 24-64 px), fitted to the
 * art's measured bounding box. `iconUrl` caches PNG data URLs for DOM <img> use.
 */
import { BUILDING_MARGIN, drawBuildingArt, nestCore, SPIRE_TIP, brazierBowl, beaconPit } from './buildingArt';
import { makeCanvas, type Ctx2D } from './canvas';
import { darken, lighten, teamColors } from './colors';
import { drawGlyph, type GlyphId } from './glyphs';
import { drawEmberSeam, drawThicket, drawTree, treeShape } from './resourceArt';
import { circlePath, drawFlame, fillStroke, litGradient, polyPath, roundRectPath, T } from './shapes';
import { drawUnitArt, UNIT_REACH } from './unitArt';
import { BIOMES } from '../data/biomes';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import type { IconKind } from '../game/types';
import type { BuildingId, Owner, UnitId } from '../sim/types';

/** Facing used for unit portraits (slightly toward the viewer, to the right). */
export const ICON_FACING = 0.5;
/** Elongated silhouettes face diagonally so their bounding box is squarer (bigger icon). */
const DIAGONAL_ICON: ReadonlySet<string> = new Set(['courser', 'destrier', 'outrider', 'stagrider', 'antlered_lord', 'gatebreaker', 'rootbreaker', 'ashpike', 'briarguard', 'spinecaster']);

type Box = [number, number, number, number];

interface Art {
  draw: (ctx: Ctx2D) => void;
  /** Art-space bounding box; measured from a raster when absent. */
  box?: Box;
  /** Fraction of the icon size the art fills. */
  fill: number;
  /** Raster bounds used for measuring [x, y, w, h] in art space. */
  measure?: Box;
}

const SYMBOL_BOX: Box = [-16, -16, 32, 32];

function isUnit(k: string): k is UnitId {
  return Object.prototype.hasOwnProperty.call(UNITS, k);
}
function isBuilding(k: string): k is BuildingId {
  return Object.prototype.hasOwnProperty.call(BUILDINGS, k);
}

// ---------------------------------------------------------------------------
// Symbols (drawn in a 32×32 box centered at the origin)
// ---------------------------------------------------------------------------

function grainSymbol(ctx: Ctx2D): void {
  const out = '#4A3410';
  ctx.lineCap = 'round';
  const stalks = [-0.42, -0.2, 0, 0.2, 0.42];
  for (const a of stalks) {
    const tx = Math.sin(a) * 15;
    const ty = -13 + Math.abs(a) * 4;
    ctx.beginPath();
    ctx.moveTo(0, 13);
    ctx.quadraticCurveTo(tx * 0.3, 0, tx, ty + 5);
    ctx.lineWidth = 3;
    ctx.strokeStyle = out;
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#C9A040';
    ctx.stroke();
  }
  for (const a of stalks) {
    const tx = Math.sin(a) * 15;
    const ty = -13 + Math.abs(a) * 4;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.ellipse(tx + (k % 2 ? 1.6 : -1.6) * 0.8, ty + 1 + k * 3, 2.2, 3, a, 0, Math.PI * 2);
      fillStroke(ctx, k === 0 ? '#F6DA6A' : '#E8C547', out, 1);
    }
  }
  ctx.beginPath();
  roundRectPath(ctx, -5.5, 4, 11, 4.5, 1.5);
  fillStroke(ctx, '#B5482E', out, 1.2);
}

function timberSymbol(ctx: Ctx2D): void {
  const out = '#2B1D0E';
  const log = (y: number, x0: number, x1: number): void => {
    ctx.beginPath();
    roundRectPath(ctx, x0, y - 5, x1 - x0, 10, 5);
    fillStroke(ctx, litGradient(ctx, (x0 + x1) / 2, y, 14, '#8B5A2B', 0.25, 0.25), out, 1.4);
    ctx.strokeStyle = darken('#8B5A2B', 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + 5, y - 1.5);
    ctx.lineTo(x1 - 8, y - 1.5);
    ctx.moveTo(x0 + 8, y + 2);
    ctx.lineTo(x1 - 12, y + 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x1 - 3, y, 3.6, 5, 0, 0, Math.PI * 2);
    fillStroke(ctx, '#D9A066', out, 1.2);
    ctx.beginPath();
    ctx.ellipse(x1 - 3, y, 1.6, 2.4, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#8A5F38';
    ctx.lineWidth = 0.9;
    ctx.stroke();
  };
  log(6, -14, 12);
  log(-4, -10, 15);
}

function emberSymbol(ctx: Ctx2D): void {
  const g = ctx.createRadialGradient(0, 1, 0, 0, 1, 16);
  g.addColorStop(0, 'rgba(255,200,110,0.75)');
  g.addColorStop(0.5, 'rgba(255,106,43,0.25)');
  g.addColorStop(1, 'rgba(255,106,43,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-16, -16, 32, 32);
  ctx.beginPath();
  polyPath(ctx, [-9, 4, -6, -6, 1, -11, 8, -5, 10, 4, 3, 11, -5, 10]);
  fillStroke(ctx, '#E2551F', '#3A140A', 1.5);
  ctx.beginPath();
  polyPath(ctx, [-6, -6, 1, -11, 2, -2, -4, 1]);
  ctx.fillStyle = '#FF9A2E';
  ctx.fill();
  ctx.beginPath();
  polyPath(ctx, [1, -11, 8, -5, 2, -2]);
  ctx.fillStyle = '#FFD27A';
  ctx.fill();
  ctx.beginPath();
  polyPath(ctx, [-4, 1, 2, -2, 10, 4, 3, 11]);
  ctx.fillStyle = '#FF6A2B';
  ctx.fill();
}

function crownsSymbol(ctx: Ctx2D): void {
  ctx.beginPath();
  circlePath(ctx, 0, 0, 13);
  fillStroke(ctx, litGradient(ctx, 0, 0, 13, '#F2C14E', 0.3, 0.3), '#5A3A08', 1.6);
  ctx.beginPath();
  circlePath(ctx, 0, 0, 10);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#B88A24';
  ctx.stroke();
  drawGlyph(ctx, 'crown', 0, 0.5, 15, '#FFE9A0', '#7A5210');
}

function resolveSymbol(ctx: Ctx2D): void {
  ctx.beginPath();
  ctx.moveTo(-11, -12);
  ctx.lineTo(11, -12);
  ctx.lineTo(11, -1);
  ctx.quadraticCurveTo(10, 9, 0, 14);
  ctx.quadraticCurveTo(-10, 9, -11, -1);
  ctx.closePath();
  fillStroke(ctx, litGradient(ctx, 0, -2, 14, '#E8A33D', 0.25, 0.3), '#2B1D0E', 1.6);
  ctx.beginPath();
  ctx.moveTo(-8, -9);
  ctx.lineTo(8, -9);
  ctx.lineTo(8, -1);
  ctx.quadraticCurveTo(7, 7, 0, 10.5);
  ctx.quadraticCurveTo(-7, 7, -8, -1);
  ctx.closePath();
  ctx.fillStyle = '#5A2A16';
  ctx.fill();
  drawFlame(ctx, 0, 7, 15, 0.35, 2);
}

function renownSymbol(ctx: Ctx2D): void {
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(0, 1, 12, s < 0 ? Math.PI * 0.55 : Math.PI * 0.05, s < 0 ? Math.PI * 0.95 + 0.6 : Math.PI * 0.45 - 0.6, s < 0 ? false : true);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3E5A1E';
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const a = s < 0 ? Math.PI * (0.62 + i * 0.14) : Math.PI * (0.38 - i * 0.14);
      const lx = Math.cos(a) * 12;
      const ly = 1 + Math.sin(a) * 12;
      ctx.beginPath();
      ctx.ellipse(lx, ly, 2, 4, a + (s < 0 ? 0.6 : -0.6), 0, Math.PI * 2);
      fillStroke(ctx, '#8FB84A', '#2E4214', 0.9);
    }
  }
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 8.5 : 3.6;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(Math.cos(a) * r, -1 + Math.sin(a) * r);
  }
  ctx.beginPath();
  polyPath(ctx, pts);
  fillStroke(ctx, litGradient(ctx, 0, -1, 9, '#F2C14E', 0.35, 0.2), '#5A3A08', 1.3);
}

function popSymbol(ctx: Ctx2D): void {
  const person = (x: number, y: number, s: number, c: string): void => {
    ctx.beginPath();
    ctx.moveTo(x - 7 * s, y + 9 * s);
    ctx.quadraticCurveTo(x - 7 * s, y + 1 * s, x, y + 1 * s);
    ctx.quadraticCurveTo(x + 7 * s, y + 1 * s, x + 7 * s, y + 9 * s);
    ctx.closePath();
    fillStroke(ctx, c, '#2B1D0E', 1.3);
    ctx.beginPath();
    circlePath(ctx, x, y - 3.5 * s, 4.2 * s);
    fillStroke(ctx, lighten(c, 0.2), '#2B1D0E', 1.3);
  };
  person(-5, -1, 0.9, '#C98A3A');
  person(5, 2, 1, '#E8A33D');
}

function treeSymbol(ctx: Ctx2D): void {
  const pal = BIOMES.greenmarch.palette;
  const s = treeShape(0, 0, 40);
  const shape = { ...s, cx: 0, cy: -2, r: 12 };
  ctx.beginPath();
  ctx.ellipse(3, 11, 11, 4, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();
  drawTree(ctx, shape, pal.forest, pal.forestHi, pal.extra, 1);
}

// ---------------------------------------------------------------------------
// Extra glyph icons: research, abilities, commands, unit classes
// ---------------------------------------------------------------------------

function badge(ctx: Ctx2D, color: string): void {
  ctx.beginPath();
  circlePath(ctx, 0, 0, 14.5);
  fillStroke(ctx, litGradient(ctx, 0, 0, 15, color, 0.18, 0.35), '#140E08', 1.4);
  ctx.beginPath();
  circlePath(ctx, 0, 0, 12.5);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(244,230,193,0.35)';
  ctx.stroke();
}

function glyphIcon(g: GlyphId, color: string, bg: string): (ctx: Ctx2D) => void {
  return (ctx) => {
    badge(ctx, bg);
    drawGlyph(ctx, g, 0, 0, 19, color, '#1A1008');
  };
}

function customIcon(bg: string, fn: (ctx: Ctx2D) => void): (ctx: Ctx2D) => void {
  return (ctx) => {
    badge(ctx, bg);
    fn(ctx);
  };
}

const CREAM = '#F4E6C1';
const OUT = '#1A1008';

function strokeOut(ctx: Ctx2D, color: string, w: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = w + 2;
  ctx.strokeStyle = OUT;
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.stroke();
}

const EXTRA: Record<string, (ctx: Ctx2D) => void> = {
  // Research.
  hearth_watch: customIcon('#5A3A1A', (ctx) => {
    drawFlame(ctx, 0, 6, 15, 0.2, 1);
    ctx.beginPath();
    ctx.ellipse(0, 7, 9, 3, 0, 0, Math.PI * 2);
    strokeOut(ctx, '#8C8577', 2);
  }),
  stoked_braziers: customIcon('#4A2A1A', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(-9, 1);
    ctx.quadraticCurveTo(0, 10, 9, 1);
    ctx.closePath();
    fillStroke(ctx, '#3E3A38', OUT, 1.3);
    drawFlame(ctx, 0, 1, 13, 0.6, 3);
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(0, 11);
    strokeOut(ctx, '#7A5A3A', 2.4);
  }),
  log_sledges: customIcon('#3A4A2A', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(-10, 6);
    ctx.lineTo(9, 6);
    ctx.quadraticCurveTo(12, 6, 11, 3);
    strokeOut(ctx, '#A27448', 2);
    ctx.beginPath();
    roundRectPath(ctx, -9, -3, 17, 6.5, 3);
    fillStroke(ctx, '#8B5A2B', OUT, 1.2);
    ctx.beginPath();
    ctx.ellipse(8, 0.2, 2, 3.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#D9A066';
    ctx.fill();
  }),
  furrow_rites: customIcon('#4A3A1A', (ctx) => {
    ctx.save();
    ctx.scale(0.62, 0.62);
    grainSymbol(ctx);
    ctx.restore();
  }),
  deep_picks: customIcon('#3A2E2A', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(-7, 9);
    ctx.lineTo(5, -5);
    strokeOut(ctx, '#A27448', 2.4);
    ctx.beginPath();
    ctx.moveTo(-3, -9);
    ctx.quadraticCurveTo(5, -9, 10, -1);
    strokeOut(ctx, '#C9C2B4', 2.6);
    ctx.beginPath();
    circlePath(ctx, -6, 4, 2.2);
    ctx.fillStyle = '#FF6A2B';
    ctx.fill();
  }),
  ash_hafts: customIcon('#4A3A2A', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(-8, 9);
    ctx.lineTo(7, -6);
    strokeOut(ctx, '#C08A4A', 2.2);
    ctx.beginPath();
    polyPath(ctx, [10, -10, 4, -7, 7, -4]);
    fillStroke(ctx, '#D9D4C7', OUT, 1);
  }),
  quick_draw: customIcon('#2E4A3A', (ctx) => {
    ctx.beginPath();
    ctx.arc(-2, 0, 10, -1.1, 1.1);
    strokeOut(ctx, '#C08A4A', 2.2);
    ctx.beginPath();
    ctx.moveTo(-2 + Math.cos(-1.1) * 10, Math.sin(-1.1) * 10);
    ctx.lineTo(-2 + Math.cos(1.1) * 10, Math.sin(1.1) * 10);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = CREAM;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(-5, -4);
    ctx.moveTo(-11, 0);
    ctx.lineTo(-4, 0);
    ctx.moveTo(-10, 4);
    ctx.lineTo(-5, 4);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#FFD27A';
    ctx.stroke();
  }),
  thunder_charge: customIcon('#2E3A5A', (ctx) => {
    drawGlyph(ctx, 'horseshoe', -2, 2, 16, '#C9C2B4', OUT);
    ctx.beginPath();
    polyPath(ctx, [5, -11, 0, -1, 4, -1, 1, 8, 9, -4, 5, -4, 8, -11]);
    fillStroke(ctx, '#FFD27A', OUT, 1);
  }),
  ember_edge: glyphIcon('sword', '#E8E2D6', '#5A2A16'),
  barbed_heads: glyphIcon('arrowhead', '#D9D4C7', '#2E3A2A'),
  hauberks: glyphIcon('mail', '#B9B4A8', '#2E2E3A'),
  // Abilities and commands.
  rally_hearth: customIcon('#5A3A1A', (ctx) => {
    drawFlame(ctx, 0, 8, 17, 0.4, 5);
    ctx.beginPath();
    ctx.arc(0, 2, 12, Math.PI * 1.15, Math.PI * 1.85);
    strokeOut(ctx, '#FFD27A', 1.6);
  }),
  house_ability: customIcon('#4A3A1A', (ctx) => drawGlyph(ctx, 'flame', 0, 0, 18, '#FFD27A', OUT)),
  ability_horn: customIcon('#5A3A1A', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(-10, -2);
    ctx.quadraticCurveTo(-2, -3, 6, -9);
    ctx.lineTo(9, 3);
    ctx.quadraticCurveTo(0, 2, -10, 3);
    ctx.closePath();
    fillStroke(ctx, litGradient(ctx, 0, -2, 10, '#E8D9B0', 0.2, 0.3), OUT, 1.3);
    ctx.beginPath();
    ctx.ellipse(7.5, -3, 2, 6, -0.3, 0, Math.PI * 2);
    fillStroke(ctx, '#C98A3A', OUT, 1);
    ctx.beginPath();
    ctx.moveTo(-4, -2.5);
    ctx.lineTo(-4, 2.5);
    ctx.moveTo(0, -3.5);
    ctx.lineTo(0, 2.5);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#E8A33D';
    ctx.stroke();
  }),
  ability_hymn: customIcon('#4A4A1A', (ctx) => {
    ctx.save();
    ctx.translate(-3, 2);
    ctx.scale(0.5, 0.5);
    grainSymbol(ctx);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(6, 4);
    ctx.lineTo(6, -9);
    ctx.lineTo(11, -7);
    strokeOut(ctx, CREAM, 1.4);
    ctx.beginPath();
    ctx.ellipse(4, 4.5, 2.6, 2, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = CREAM;
    ctx.fill();
  }),
  ability_firepot: customIcon('#5A2A16', (ctx) => {
    ctx.beginPath();
    circlePath(ctx, 0, 3, 8);
    fillStroke(ctx, litGradient(ctx, 0, 3, 8, '#5A4A3A', 0.25, 0.3), OUT, 1.3);
    ctx.beginPath();
    roundRectPath(ctx, -3.5, -6, 7, 4, 1);
    fillStroke(ctx, '#3A2A1A', OUT, 1);
    drawFlame(ctx, 2, -6, 9, 0.8, 4);
  }),
  ability_volley: customIcon('#3A2A1A', (ctx) => {
    for (const dy of [-6, 0, 6]) {
      ctx.beginPath();
      ctx.moveTo(-9, dy + 3);
      ctx.lineTo(8, dy - 2);
      strokeOut(ctx, '#FFB347', 1.8);
    }
  }),
  hawk: customIcon('#2E3A4A', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.quadraticCurveTo(-6, -9, -13, -4);
    ctx.quadraticCurveTo(-6, -3, -3, 3);
    ctx.lineTo(0, 9);
    ctx.lineTo(3, 3);
    ctx.quadraticCurveTo(6, -3, 13, -4);
    ctx.quadraticCurveTo(6, -9, 0, -2);
    ctx.closePath();
    fillStroke(ctx, '#B98A58', OUT, 1.2);
    ctx.beginPath();
    circlePath(ctx, 0, -2.5, 2.2);
    ctx.fillStyle = '#E8D9B0';
    ctx.fill();
  }),
  rally: customIcon('#3A3A2A', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(-5, 10);
    ctx.lineTo(-5, -10);
    strokeOut(ctx, '#A27448', 1.8);
    ctx.beginPath();
    polyPath(ctx, [-4, -10, 9, -6, -4, -1]);
    fillStroke(ctx, '#E8A33D', OUT, 1.1);
  }),
  demolish: customIcon('#4A1E1A', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(-8, -8);
    ctx.lineTo(8, 8);
    ctx.moveTo(8, -8);
    ctx.lineTo(-8, 8);
    strokeOut(ctx, '#E85A4A', 2.6);
  }),
  stop: customIcon('#3A2A2A', (ctx) => {
    ctx.beginPath();
    roundRectPath(ctx, -7, -7, 14, 14, 2);
    fillStroke(ctx, '#D9443B', OUT, 1.2);
  }),
  hold: customIcon('#2A3A3A', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(-8, -9);
    ctx.lineTo(8, -9);
    ctx.lineTo(8, 0);
    ctx.quadraticCurveTo(7, 7, 0, 10);
    ctx.quadraticCurveTo(-7, 7, -8, 0);
    ctx.closePath();
    fillStroke(ctx, '#C9C2B4', OUT, 1.3);
    ctx.fillStyle = '#E8A33D';
    ctx.fillRect(-1.5, -8, 3, 16);
  }),
  attack_move: customIcon('#4A1E1A', (ctx) => {
    drawGlyph(ctx, 'sword', -2, 1, 17, '#E8E2D6', OUT);
    ctx.beginPath();
    polyPath(ctx, [5, 4, 11, 7, 5, 10]);
    fillStroke(ctx, '#7BE07F', OUT, 1);
  }),
  cls_worker: customIcon('#4A3A1A', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(-7, 9);
    ctx.lineTo(6, -6);
    strokeOut(ctx, '#C08A4A', 2.2);
    ctx.beginPath();
    ctx.moveTo(2, -10);
    ctx.lineTo(10, -2);
    strokeOut(ctx, '#C9C2B4', 2.6);
  }),
  cls_infantry: glyphIcon('spears', '#D9D4C7', '#3A3A2A'),
  cls_ranged: customIcon('#2E4A3A', (ctx) => {
    ctx.beginPath();
    ctx.arc(-3, 0, 10, -1.1, 1.1);
    strokeOut(ctx, '#C08A4A', 2.2);
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.lineTo(9, 0);
    strokeOut(ctx, CREAM, 1.2);
    ctx.beginPath();
    polyPath(ctx, [11, 0, 7, -2.5, 7, 2.5]);
    fillStroke(ctx, '#D9D4C7', OUT, 0.8);
  }),
  cls_cavalry: glyphIcon('horseshoe', '#D9D4C7', '#2E3A5A'),
  cls_siege: glyphIcon('ram', '#C9A070', '#4A3A2A'),
  cls_hero: glyphIcon('flame', '#FFD27A', '#5A3A1A'),
  cls_boss: glyphIcon('crown', '#8FD14F', '#3A1E44'),
};
// House ability aliases (sim/queries commandCard emits `ability_${house}`).
EXTRA.ability_ardent = EXTRA.ability_horn;
EXTRA.ability_tallow = EXTRA.ability_hymn;
EXTRA.ability_grimbrand = EXTRA.ability_firepot;
EXTRA.ability_lowmere = EXTRA.ability_volley;

// ---------------------------------------------------------------------------
// Art lookup + bounding boxes
// ---------------------------------------------------------------------------

function buildingIconExtras(ctx: Ctx2D, type: BuildingId, w: number, h: number): void {
  const W = w * T;
  const H = h * T;
  const glow = (x: number, y: number, r: number, color: string, a: number): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('A', String(a)));
    g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g;
    ctx.beginPath();
    circlePath(ctx, x, y, r);
    ctx.fill();
  };
  switch (type) {
    case 'hearth':
      glow(W / 2, H / 2, W * 0.4, 'rgba(255,179,71,A)', 0.5);
      drawFlame(ctx, W / 2, H / 2 + 8, 32, 0.4, 1);
      break;
    case 'brazier_tower': {
      const [bx, by] = brazierBowl(W);
      drawFlame(ctx, bx, by + 1, 17, 0.4, 2);
      break;
    }
    case 'thorn_nest':
    case 'root_heart': {
      const [cx, cy, cr] = nestCore(W, H, type === 'root_heart' ? 1.12 : 1);
      glow(cx, cy, cr * 2.4, type === 'root_heart' ? 'rgba(208,64,122,A)' : 'rgba(176,106,216,A)', 0.8);
      ctx.beginPath();
      ctx.ellipse(cx, cy, cr * 0.65, cr * 0.48, 0, 0, Math.PI * 2);
      ctx.fillStyle = type === 'root_heart' ? '#F06A9A' : '#D49AF0';
      ctx.fill();
      break;
    }
    case 'thornspire':
      glow(SPIRE_TIP[0], SPIRE_TIP[1], 11, 'rgba(143,209,79,A)', 0.9);
      break;
    case 'beacon_stone': {
      const [px, py] = beaconPit(W, H);
      drawFlame(ctx, px, py + 3, 18, 0.4, 3);
      break;
    }
    default:
      break;
  }
}

function getArt(kind: string, owner: Owner): Art | null {
  if (isUnit(kind)) {
    const reach = UNIT_REACH[kind] + 3;
    const facing = DIAGONAL_ICON.has(kind) ? 0.8 : ICON_FACING;
    return { draw: (ctx) => drawUnitArt(ctx, kind, owner, facing), fill: 0.92, measure: [-reach, -reach, reach * 2, reach * 2] };
  }
  if (isBuilding(kind)) {
    const def = BUILDINGS[kind];
    const m = BUILDING_MARGIN[kind];
    const draw = (ctx: Ctx2D): void => {
      drawBuildingArt(ctx, kind, owner, def.w, def.h);
      buildingIconExtras(ctx, kind, def.w, def.h);
    };
    return { draw, fill: 0.94, measure: [-m.side, -m.top, def.w * T + m.side * 2, def.h * T + m.top + m.bottom] };
  }
  switch (kind) {
    case 'thicket':
      return { draw: (ctx) => drawThicket(ctx, -16, -16, 10), fill: 0.95, measure: [-24, -24, 48, 48] };
    case 'ember_seam':
      return { draw: (ctx) => drawEmberSeam(ctx, -32, -32, 2, 2, 1), fill: 0.95, measure: [-40, -40, 80, 80] };
    case 'tree':
      return { draw: treeSymbol, fill: 0.95, measure: [-20, -20, 40, 40] };
    case 'grain':
      return { draw: grainSymbol, fill: 1, box: SYMBOL_BOX };
    case 'timber':
      return { draw: timberSymbol, fill: 1, box: SYMBOL_BOX };
    case 'ember':
      return { draw: emberSymbol, fill: 1, box: SYMBOL_BOX };
    case 'crowns':
      return { draw: crownsSymbol, fill: 1, box: SYMBOL_BOX };
    case 'resolve':
      return { draw: resolveSymbol, fill: 1, box: SYMBOL_BOX };
    case 'renown':
      return { draw: renownSymbol, fill: 1, box: SYMBOL_BOX };
    case 'pop':
      return { draw: popSymbol, fill: 1, box: SYMBOL_BOX };
    default: {
      const extra = EXTRA[kind];
      if (extra) return { draw: extra, fill: 1, box: SYMBOL_BOX };
      return null;
    }
  }
}

const boxCache = new Map<string, Box>();

/** Measure the art's opaque bounds from a raster (once per kind/owner). */
function artBox(kind: string, owner: Owner, art: Art): Box {
  if (art.box) return art.box;
  const key = `${kind}|${owner}`;
  const hit = boxCache.get(key);
  if (hit) return hit;
  const m = art.measure ?? [-32, -32, 64, 64];
  const k = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(m[2] * k));
  canvas.height = Math.max(1, Math.ceil(m[3] * k));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return m;
  ctx.setTransform(k, 0, 0, k, -m[0] * k, -m[1] * k);
  art.draw(ctx);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let x0 = canvas.width;
  let y0 = canvas.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const box: Box = x1 < 0 ? m : [m[0] + x0 / k, m[1] + y0 / k, (x1 - x0 + 1) / k, (y1 - y0 + 1) / k];
  boxCache.set(key, box);
  return box;
}

function drawFallback(ctx: Ctx2D, kind: string, owner: Owner): void {
  const pal = teamColors(owner);
  badge(ctx, darken(pal.body, 0.45));
  ctx.fillStyle = pal.trim;
  ctx.font = '700 16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((kind[0] ?? '?').toUpperCase(), 0, 1);
}

/** Draw an icon centered at (x, y) with the given size (CSS px) into ctx. */
export function drawIcon(ctx: CanvasRenderingContext2D, kind: IconKind, owner: Owner, x: number, y: number, size: number): void {
  const k = String(kind);
  const art = getArt(k, owner);
  ctx.save();
  ctx.translate(x, y);
  if (!art) {
    const s = size / 32;
    ctx.scale(s, s);
    drawFallback(ctx, k, owner);
    ctx.restore();
    return;
  }
  const [bx, by, bw, bh] = artBox(k, owner, art);
  const s = (size * art.fill) / Math.max(bw, bh, 1);
  ctx.scale(s, s);
  ctx.translate(-(bx + bw / 2), -(by + bh / 2));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  art.draw(ctx);
  ctx.restore();
}

const urlCache = new Map<string, string>();

/** Cached PNG data URL of an icon (for <img> in DOM UI). Rendered at devicePixelRatio for crispness. */
export function iconUrl(kind: IconKind, owner: Owner, size: number): string {
  const dpr = typeof window !== 'undefined' ? Math.min(3, Math.max(1, window.devicePixelRatio || 1)) : 1;
  const key = `${kind}|${owner}|${size}|${dpr}`;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const px = Math.max(1, Math.round(size * dpr));
  const { canvas, ctx } = makeCanvas(px, px);
  ctx.scale(px / size, px / size);
  drawIcon(ctx, kind, owner, size / 2, size / 2, size);
  const url = canvas.toDataURL('image/png');
  urlCache.set(key, url);
  return url;
}

/** Icon keys the renderer knows how to draw beyond the core IconKind union (research, abilities, classes). */
export const EXTRA_ICON_KEYS: readonly string[] = Object.keys(EXTRA);

/** True when `kind` has dedicated art (not the lettered fallback badge). Pure; usable in tests. */
export function hasIconArt(kind: string): boolean {
  return getArt(kind, 0) !== null;
}
