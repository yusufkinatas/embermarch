/**
 * UI overlays drawn in the world: selection/hover rings (green own, red enemy, yellow neutral),
 * HP bars, construction bars, placement ghost, rally lines/flags, targeting rings; plus the screen-space
 * box-select rectangle.
 */
import { BUILDING_MARGIN } from './buildingArt';
import type { Ctx2D } from './canvas';
import { hpBarColor, rgba, selectionColor } from './colors';
import { T, TAU } from './shapes';
import type { SpriteCache } from './sprites';
import { unitBodyRadius } from './unitArt';
import { BUILDINGS } from '../data/buildings';
import { PALETTE } from '../data/palette';
import type { BattleUIState } from '../game/types';
import { canPlaceBuilding } from '../sim/queries';
import type { Building, Entity, ResourceNode, Unit, World } from '../sim/types';

export interface UnitPos {
  u: Unit;
  x: number;
  y: number;
}

/** Should an HP bar be shown for this entity? (damaged, selected or hovered; never for invulnerable objects). */
export function showHpBar(e: { hp: number; maxHp: number; invulnerable: boolean; untargetable: boolean }, selected: boolean, hovered: boolean): boolean {
  if (e.maxHp <= 1 || (e.invulnerable && e.untargetable)) return false;
  return selected || hovered || e.hp < e.maxHp - 0.01;
}

/** Placement validity per footprint tile, falling back to the ghost's overall ok flag. */
export function placementTiles(world: World, p: NonNullable<BattleUIState['placement']>): boolean[] {
  const def = BUILDINGS[p.building];
  const n = def.w * def.h;
  try {
    const res = canPlaceBuilding(world, p.building, p.tx, p.ty);
    if (res && Array.isArray(res.tiles) && res.tiles.length === n) return res.tiles;
  } catch {
    // sim-core query unavailable: use the controller's overall verdict.
  }
  return new Array<boolean>(n).fill(p.ok);
}

function unitRing(ctx: Ctx2D, x: number, y: number, r: number, color: string, alpha: number, big: boolean): void {
  const rx = (big ? Math.max(r * 1.3, 14) : r * 1.25) + 2;
  const ry = rx * 0.58;
  const cy = y + r * 0.45 + 1;
  ctx.beginPath();
  ctx.ellipse(x, cy, rx, ry, 0, 0, TAU);
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = `rgba(0,0,0,${(0.45 * alpha).toFixed(3)})`;
  ctx.stroke();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = rgba(color, alpha);
  ctx.stroke();
}

function footprintRing(ctx: Ctx2D, x0: number, y0: number, W: number, H: number, color: string, alpha: number): void {
  const pad = 3;
  const x = x0 - pad;
  const y = y0 - pad;
  const w = W + pad * 2;
  const h = H + pad * 2;
  const c = Math.min(12, w * 0.3, h * 0.3);
  ctx.lineCap = 'round';
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(x, y + c);
    ctx.lineTo(x, y);
    ctx.lineTo(x + c, y);
    ctx.moveTo(x + w - c, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + c);
    ctx.moveTo(x + w, y + h - c);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - c, y + h);
    ctx.moveTo(x + c, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + h - c);
  };
  path();
  ctx.lineWidth = 4;
  ctx.strokeStyle = `rgba(0,0,0,${(0.45 * alpha).toFixed(3)})`;
  ctx.stroke();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = rgba(color, alpha);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(color, alpha * 0.35);
  ctx.stroke();
}

function entityRect(e: Building | ResourceNode): [number, number, number, number] {
  return [e.tx * T, e.ty * T, e.w * T, e.h * T];
}

export class Overlays {
  private selSet = new Set<number>();

  constructor(private readonly sprites: SpriteCache) {}

  /** Ground-level selection and hover rings (before entities). */
  drawRings(ctx: Ctx2D, world: World, ui: BattleUIState, units: readonly UnitPos[], visibleBuildings: readonly Building[], now: number): void {
    const sel = this.selSet;
    sel.clear();
    for (const id of ui.selection) sel.add(id);
    const hover = ui.hoverId;
    for (const d of units) {
      const isSel = sel.has(d.u.id);
      if (!isSel && d.u.id !== hover) continue;
      const big = d.u.cls === 'cavalry' || d.u.cls === 'siege' || d.u.cls === 'boss';
      unitRing(ctx, d.x, d.y, unitBodyRadius(d.u.type), selectionColor(d.u.owner), isSel ? 1 : 0.55, big);
    }
    const ringBuilding = (b: Building | ResourceNode, alpha: number): void => {
      const [x, y, w, h] = entityRect(b);
      footprintRing(ctx, x, y, w, h, selectionColor(b.owner), alpha);
    };
    for (const b of visibleBuildings) {
      if (sel.has(b.id)) ringBuilding(b, 1);
      else if (b.id === hover) ringBuilding(b, 0.55);
    }
    if (hover) {
      const e = world.entities.get(hover);
      if (e && e.kind === 'resource') ringBuilding(e, 0.6);
    }
    for (const id of ui.selection) {
      const e = world.entities.get(id);
      if (e && e.kind === 'resource') ringBuilding(e, 1);
    }
    // Rally lines and flags for selected own buildings.
    for (const id of ui.selection) {
      const b = world.entities.get(id);
      if (!b || b.kind !== 'building' || b.owner !== 0 || !b.rally) continue;
      let rx = b.rally.x;
      let ry = b.rally.y;
      if (b.rally.targetId) {
        const t = world.entities.get(b.rally.targetId);
        if (t) {
          rx = t.x;
          ry = t.y;
        }
      }
      this.drawRally(ctx, b.x * T, b.y * T, rx * T, ry * T, now);
    }
  }

  private drawRally(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, now: number): void {
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = -now * 18;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20,12,6,0.45)';
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(244,230,193,0.85)';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.beginPath();
    ctx.ellipse(x1, y1, 6, 3.5, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1, y1 - 20);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = PALETTE.player.outline;
    ctx.stroke();
    const wave = Math.sin(now * 4) * 1.5;
    ctx.beginPath();
    ctx.moveTo(x1 + 1, y1 - 20);
    ctx.lineTo(x1 + 13, y1 - 17 + wave);
    ctx.lineTo(x1 + 1, y1 - 12);
    ctx.closePath();
    ctx.fillStyle = PALETTE.player.body;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  /** HP bars (and construction progress) above visible entities. */
  drawBars(ctx: Ctx2D, world: World, ui: BattleUIState, units: readonly UnitPos[], visibleBuildings: readonly Building[]): void {
    const sel = this.selSet;
    const hover = ui.hoverId;
    for (const d of units) {
      const u = d.u;
      const isSel = sel.has(u.id);
      if (!showHpBar(u, isSel, u.id === hover)) continue;
      const r = unitBodyRadius(u.type);
      const w = Math.max(18, Math.min(64, r * 2.4));
      this.bar(ctx, d.x - w / 2, d.y - r - (u.type === 'gloamwitch' ? 18 : u.type === 'warden' ? 16 : 10), w, u.cls === 'boss' ? 5 : 3.5, u.hp / u.maxHp, hpBarColor(u.owner));
    }
    for (const b of visibleBuildings) {
      const isSel = sel.has(b.id);
      const W = b.w * T;
      const m = BUILDING_MARGIN[b.type];
      const top = b.ty * T - Math.min(m.top, 20) - 4;
      const w = Math.max(24, W * 0.72);
      const x = b.tx * T + (W - w) / 2;
      if (!b.built && b.owner === 0) {
        this.bar(ctx, x, b.ty * T + b.h * T * 0.5 - 2, w, 4, b.buildProgress, PALETTE.ui.accent);
        continue;
      }
      if (!showHpBar(b, isSel, b.id === hover)) continue;
      this.bar(ctx, x, top, w, 4.5, b.hp / b.maxHp, hpBarColor(b.owner));
    }
  }

  private bar(ctx: Ctx2D, x: number, y: number, w: number, h: number, frac: number, color: string): void {
    const f = Math.max(0, Math.min(1, frac));
    ctx.fillStyle = 'rgba(12,8,6,0.82)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = 'rgba(60,40,30,0.9)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * f, h);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x, y, w * f, Math.max(1, h * 0.35));
  }

  /** Placement ghost: per-tile green/red footprint plus a translucent building. */
  drawPlacement(ctx: Ctx2D, world: World, ui: BattleUIState, now: number): void {
    const p = ui.placement;
    if (!p) return;
    const def = BUILDINGS[p.building];
    const tiles = placementTiles(world, p);
    const x0 = p.tx * T;
    const y0 = p.ty * T;
    for (let j = 0; j < def.h; j++) {
      for (let i = 0; i < def.w; i++) {
        const ok = tiles[j * def.w + i];
        ctx.fillStyle = ok ? 'rgba(111,208,111,0.30)' : 'rgba(217,68,59,0.42)';
        ctx.fillRect(x0 + i * T + 1, y0 + j * T + 1, T - 2, T - 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = ok ? 'rgba(160,240,160,0.75)' : 'rgba(255,120,110,0.85)';
        ctx.strokeRect(x0 + i * T + 1.5, y0 + j * T + 1.5, T - 3, T - 3);
      }
    }
    const s = this.sprites.building(p.building, 0, def.w, def.h);
    ctx.globalAlpha = p.ok ? 0.62 : 0.38;
    ctx.drawImage(s.canvas, x0 - s.ox, y0 - s.oy, s.w, s.h);
    ctx.globalAlpha = 1;
    // Defensive range preview.
    if (def.attack) {
      const cx = x0 + (def.w * T) / 2;
      const cy = y0 + (def.h * T) / 2;
      const R = (def.attack.range + Math.max(def.w, def.h) / 2) * T;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -now * 12;
      ctx.beginPath();
      ctx.ellipse(cx, cy, R, R, 0, 0, TAU);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,179,71,0.65)';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
  }

  /** Attack-move cursor ring or ability radius preview at the mouse. */
  drawTargeting(ctx: Ctx2D, world: World, ui: BattleUIState, now: number): void {
    const t = ui.targeting;
    if (!t) return;
    const mx = ui.mouseWorld.x;
    const my = ui.mouseWorld.y;
    if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
    const x = mx * T;
    const y = my * T;
    if (t.kind === 'attackMove') {
      const r = 11 + Math.sin(now * 8) * 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.62, 0, 0, TAU);
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = 'rgba(30,6,4,0.5)';
      ctx.stroke();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#FF5A4A';
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        ctx.moveTo(x + Math.cos(a) * (r + 2), y + Math.sin(a) * (r + 2) * 0.62);
        ctx.lineTo(x + Math.cos(a) * (r + 7), y + Math.sin(a) * (r + 7) * 0.62);
      }
      ctx.stroke();
      return;
    }
    // Ability: radius preview + range from the Warden.
    const w = world.wardenId ? (world.entities.get(world.wardenId) as Entity | undefined) : undefined;
    let inRange = true;
    if (w && t.range > 0 && Number.isFinite(t.range)) {
      const d = Math.hypot(mx - w.x, my - w.y);
      inRange = d <= t.range + 0.01;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.ellipse(w.x * T, w.y * T, t.range * T, t.range * T, 0, 0, TAU);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,210,122,0.55)';
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const R = Math.max(0.5, t.radius) * T;
    const color = inRange ? '#FFD27A' : '#D9443B';
    ctx.beginPath();
    ctx.ellipse(x, y, R, R * 0.8, 0, 0, TAU);
    ctx.fillStyle = rgba(color, 0.14 + 0.05 * Math.sin(now * 6));
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y, 3, 2, 0, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /** Box-select rectangle (screen space, CSS px). */
  drawBox(ctx: Ctx2D, ui: BattleUIState): void {
    const b = ui.box;
    if (!b) return;
    const x = Math.min(b.x0, b.x1);
    const y = Math.min(b.y0, b.y1);
    const w = Math.abs(b.x1 - b.x0);
    const h = Math.abs(b.y1 - b.y0);
    if (w < 2 && h < 2) return;
    ctx.fillStyle = 'rgba(123,224,127,0.10)';
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(123,224,127,0.9)';
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }
}
