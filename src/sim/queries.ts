/**
 * Read-only queries for the HUD / input. OWNER: sim-core.
 *
 * Command card layout (5×2 grid, slots 0-4 top row, 5-9 bottom row):
 * - Buildings: Q/W/E train -> slots 0/1/2; Z/X/C research or Temper -> slots 5/6/7;
 *   V Rally the Hearth (Hearth) -> slot 8; Delete demolish / cancel foundation -> slot 9.
 * - Tillers: build menu C,E,F,B,R,P,N,T,Y -> slots 0-8 (BUILD_MENU order, stable even when locked).
 * - Warden in the selection: Q House ability -> slot 0, W Hawk (if unlocked) -> slot 1.
 * `progress` is the completed fraction (research progress, or cooldown recovery); `cooldown` is
 * the seconds remaining on an ability.
 */
import { RALLY_HEARTH } from '../data/balance';
import { BUILDINGS, BUILD_MENU } from '../data/buildings';
import { HOUSES } from '../data/houses';
import { RESEARCH } from '../data/research';
import { CLASS_NAMES } from '../data/text';
import { UNITS } from '../data/units';
import { abilityCooldown, rallyHearthTimes, warden } from './abilities';
import { ucore } from './core';
import { buildingRequirementReason, checkPlacement } from './placement';
import { canPay, missingReason } from './players';
import { researchBlockReason, trainBlockReason } from './production';
import { buildingStats, hasFlag, unitStats } from './stats';
import { isEntitySeen, isEntityVisible as entityVisible, isTileExplored as tileExplored, isTileVisible as tileVisible } from './vision';
import type {
  Building,
  BuildingId,
  Cost,
  Entity,
  PlayerBuildingId,
  PlayerUnitId,
  ResearchId,
  Unit,
  UnitClass,
  World,
} from './types';
import { PLAYER, TICK_RATE } from './types';

export interface CommandOption {
  kind: 'train' | 'research' | 'build' | 'ability' | 'rally' | 'demolish';
  /** Unit / research / building id, or ability id ('rally_hearth', 'house_ability', 'hawk'). */
  id: PlayerUnitId | ResearchId | PlayerBuildingId | string;
  label: string;
  /** Single key letter shown on the button, e.g. 'Q'. */
  hotkey: string;
  cost: Cost;
  enabled: boolean;
  /** Why disabled (e.g. "Requires a Forgehall", "Not enough Ember", "Temper chosen: Ember Edge"). */
  reason?: string;
  /** Tooltip body. */
  tooltip: string;
  /** 0..1 cooldown/progress overlay (abilities, research in progress). */
  progress?: number;
  /** Seconds remaining on cooldown (abilities). */
  cooldown?: number;
  /** Icon key for drawIcon(). */
  icon: string;
  /** Grid slot 0..9 on the 5×2 command card. */
  slot: number;
}

export interface PlacementCheck {
  ok: boolean;
  reason?: string;
  /** Per-tile validity for the ghost (row-major over the footprint). */
  tiles: boolean[];
}

const TRAIN_SLOTS: Record<string, number> = { Q: 0, W: 1, E: 2 };
const RESEARCH_SLOTS: Record<string, number> = { Z: 5, X: 6, C: 7 };
/** Hotkey shown on the demolish button. */
export const DEMOLISH_HOTKEY = 'Del';

// ---------------------------------------------------------------------------
// Picking / selection helpers
// ---------------------------------------------------------------------------

/** Topmost entity at a world point, fog-aware (hidden enemy units are not pickable; seen enemy buildings are). */
export function pickEntityAt(world: World, x: number, y: number): Entity | null {
  let best: Unit | null = null;
  let bd = Infinity;
  for (const u of world.units) {
    if (!u.alive) continue;
    const d = Math.hypot(u.x - x, u.y - y);
    if (d > u.radius + 0.15 || d >= bd) continue;
    if (u.owner !== PLAYER && !entityVisible(world, u)) continue;
    best = u;
    bd = d;
  }
  if (best) return best;
  for (const b of world.buildings) {
    if (!b.alive) continue;
    if (x < b.tx || y < b.ty || x >= b.tx + b.w || y >= b.ty + b.h) continue;
    if (b.owner !== PLAYER && !isEntitySeen(world, b)) continue;
    return b;
  }
  for (const r of world.resources) {
    if (!r.alive) continue;
    if (x < r.tx || y < r.ty || x >= r.tx + r.w || y >= r.ty + r.h) continue;
    if (!isEntitySeen(world, r)) continue;
    return r;
  }
  return null;
}

/** Own (owner 0) units whose centers lie in the rect (any corner order). */
export function unitsInRect(world: World, x0: number, y0: number, x1: number, y1: number): Unit[] {
  const ax = Math.min(x0, x1);
  const bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1);
  const by = Math.max(y0, y1);
  return world.units.filter((u) => u.alive && u.owner === PLAYER && u.x >= ax && u.x <= bx && u.y >= ay && u.y <= by);
}

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------

function classList(cls: UnitClass[]): string {
  return cls.length ? cls.map((c) => CLASS_NAMES[c]).join(', ') : 'none';
}

function fmt(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

export function unitTooltip(world: World, type: PlayerUnitId): string {
  const def = UNITS[type];
  const st = unitStats(world, PLAYER, type);
  const lines = [`${def.name}: ${def.role}`, def.desc];
  const atk = def.cooldown > 0 ? `ATK ${fmt(st.atk)} / ${fmt(st.cooldown)} s` : 'No attack';
  lines.push(`HP ${st.hp} · ${atk} · Range ${fmt(st.range)} · Armor ${fmt(st.armor)} · Speed ${fmt(st.speed)}`);
  lines.push(`Train ${fmt(Math.round(st.trainTime * 10) / 10)} s · Pop ${st.pop}`);
  lines.push(`Strong vs: ${classList(def.strongVs)} · Weak vs: ${classList(def.weakVs)}`);
  return lines.join('\n');
}

function buildingTooltip(world: World, type: PlayerBuildingId): string {
  const def = BUILDINGS[type];
  const st = buildingStats(world, PLAYER, type);
  const lines = [def.name, def.desc, `HP ${st.hp} · Armor ${fmt(st.armor)} · Build ${fmt(Math.round(st.buildTime))} s`];
  if (st.attack) lines.push(`Fires ${st.attack.volley}× ${fmt(st.attack.dmg)} dmg every ${fmt(st.attack.cooldown)} s, range ${fmt(st.attack.range)}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

function shortestQueue(world: World, bs: Building[], unit: PlayerUnitId): { b: Building; reason?: string } {
  let best: Building | null = null;
  let reason: string | undefined;
  for (const b of bs) {
    const r = trainBlockReason(world, b, unit);
    if (r) {
      reason ??= r;
      continue;
    }
    if (!best || b.queue.length < best.queue.length) best = b;
  }
  return best ? { b: best } : { b: bs[0], reason };
}

function trainOptionsFor(world: World, bs: Building[]): CommandOption[] {
  const b0 = bs[0];
  const p = world.players[PLAYER];
  const out: CommandOption[] = [];
  for (const unit of BUILDINGS[b0.type].trains ?? []) {
    if (!p.unlockedUnits.includes(unit)) continue;
    const def = UNITS[unit];
    const hotkey = def.hotkey ?? 'Q';
    const cost = unitStats(world, PLAYER, unit).cost;
    const { reason: blocked } = shortestQueue(world, bs, unit);
    const reason = blocked ?? missingReason(p, cost);
    out.push({
      kind: 'train',
      id: unit,
      label: def.name,
      hotkey,
      cost,
      enabled: !reason,
      reason,
      tooltip: unitTooltip(world, unit),
      icon: unit,
      slot: TRAIN_SLOTS[hotkey] ?? out.length,
    });
  }
  return out;
}

export function trainOptions(world: World, building: Building): CommandOption[] {
  return trainOptionsFor(world, [building]);
}

export function researchOptions(world: World, building: Building): CommandOption[] {
  const p = world.players[PLAYER];
  const out: CommandOption[] = [];
  for (const id of BUILDINGS[building.type].research ?? []) {
    const def = RESEARCH[id];
    const blocked = researchBlockReason(world, building, id);
    const busyHere = building.research?.id === id;
    const reason = busyHere ? 'In progress' : (blocked ?? missingReason(p, def.cost));
    const opt: CommandOption = {
      kind: 'research',
      id,
      label: def.name,
      hotkey: def.hotkey,
      cost: { ...def.cost },
      enabled: !reason,
      reason,
      tooltip: `${def.name}\n${def.desc}\nResearch ${def.time} s${def.temper ? '\nOne Temper per battle: starting it locks the other two.' : ''}`,
      icon: id,
      slot: RESEARCH_SLOTS[def.hotkey] ?? 5 + out.length,
    };
    if (busyHere && building.research) opt.progress = building.research.progress / Math.max(1e-6, building.research.total);
    if (p.researched.includes(id)) opt.progress = 1;
    out.push(opt);
  }
  return out;
}

/** Tiller build menu (one option per unlocked building with hotkey). */
export function buildOptions(world: World): CommandOption[] {
  const p = world.players[PLAYER];
  const out: CommandOption[] = [];
  BUILD_MENU.forEach((type, i) => {
    if (!p.unlockedBuildings.includes(type)) return;
    const def = BUILDINGS[type];
    const cost = buildingStats(world, PLAYER, type).cost;
    const reason = buildingRequirementReason(world, type) ?? missingReason(p, cost);
    out.push({
      kind: 'build',
      id: type,
      label: def.name,
      hotkey: def.hotkey ?? '',
      cost,
      enabled: !reason,
      reason,
      tooltip: buildingTooltip(world, type),
      icon: type,
      slot: i,
    });
  });
  return out;
}

function abilityOptions(world: World): CommandOption[] {
  const p = world.players[PLAYER];
  const out: CommandOption[] = [];
  const w = warden(world);
  const house = HOUSES[world.setup.house];
  const mk = (slot: 'Q' | 'W', id: string, label: string, tooltip: string, icon: string): CommandOption => {
    const remaining = Math.max(0, (p.abilityReadyTick[slot] - world.tick) / TICK_RATE);
    const total = abilityCooldown(world, slot);
    const reason = !w ? 'The Warden has fallen' : remaining > 0 ? `Ready in ${Math.ceil(remaining)} s` : undefined;
    const o: CommandOption = {
      kind: 'ability',
      id,
      label,
      hotkey: slot,
      cost: {},
      enabled: !reason,
      reason,
      tooltip: `${label}\n${tooltip}\nCooldown ${fmt(Math.round(total * 10) / 10)} s`,
      icon,
      slot: slot === 'Q' ? 0 : 1,
    };
    if (remaining > 0) {
      o.cooldown = remaining;
      o.progress = 1 - remaining / Math.max(1e-6, total);
    }
    return o;
  };
  out.push(mk('Q', 'house_ability', house.abilityName, house.abilityDesc, `ability_${house.id}`));
  if (hasFlag(world, PLAYER, 'hawk')) {
    out.push(mk('W', 'hawk', 'Hawk', 'Reveal a radius of 7 tiles anywhere for 6 s. Counts as eyes on a muster point.', 'hawk'));
  }
  return out;
}

function rallyHearthOption(world: World): CommandOption {
  const p = world.players[PLAYER];
  const { cooldown, duration } = rallyHearthTimes(world);
  const remaining = Math.max(0, (p.rallyReadyTick - world.tick) / TICK_RATE);
  const o: CommandOption = {
    kind: 'rally',
    id: 'rally_hearth',
    label: 'Rally the Hearth',
    hotkey: RALLY_HEARTH.hotkey,
    cost: {},
    enabled: remaining <= 0,
    reason: remaining > 0 ? `Ready in ${Math.ceil(remaining)} s` : undefined,
    tooltip: `Rally the Hearth\nTillers within ${RALLY_HEARTH.radius} tiles drop their loads and fight enemies within ${RALLY_HEARTH.fightRadius} tiles for ${duration} s (+${RALLY_HEARTH.atk} ATK, +${RALLY_HEARTH.armor} armor), then return to work.\nCooldown ${cooldown} s`,
    icon: 'rally_hearth',
    slot: 8,
  };
  if (remaining > 0) {
    o.cooldown = remaining;
    o.progress = 1 - remaining / cooldown;
  }
  return o;
}

function demolishOption(b: Building): CommandOption {
  const label = b.built ? 'Demolish' : 'Cancel';
  const tooltip = b.built
    ? `Demolish ${BUILDINGS[b.type].name}. No refund (queued units and research are refunded).`
    : `Cancel the foundation. Refunds 100% before work starts, 50% after.`;
  return { kind: 'demolish', id: 'demolish', label, hotkey: DEMOLISH_HOTKEY, cost: {}, enabled: true, tooltip, icon: 'demolish', slot: 9 };
}

/** Command card for a selection (units and/or one building type). */
export function commandCard(world: World, selection: number[]): CommandOption[] {
  const ents: Entity[] = [];
  for (const id of selection) {
    const e = world.entities.get(id);
    if (e && e.alive && e.owner === PLAYER && e.kind !== 'resource') ents.push(e);
  }
  if (ents.length === 0) return [];
  const first = ents[0];
  if (first.kind === 'building') {
    const bs = ents.filter((e): e is Building => e.kind === 'building' && e.type === first.type);
    const built = bs.filter((b) => b.built);
    const out: CommandOption[] = [];
    if (built.length) {
      out.push(...trainOptionsFor(world, built));
      const idle = built.find((b) => !b.research) ?? built[0];
      out.push(...researchOptions(world, idle));
      if (first.type === 'hearth') out.push(rallyHearthOption(world));
    }
    if (first.type !== 'hearth') out.push(demolishOption(first));
    return out;
  }
  const units = ents.filter((e): e is Unit => e.kind === 'unit');
  if (units.some((u) => u.type === 'warden')) return abilityOptions(world);
  if (units.some((u) => u.type === 'tiller') && !units.some((u) => u.cls !== 'worker')) return buildOptions(world);
  return [];
}

export function canPlaceBuilding(world: World, type: PlayerBuildingId, tx: number, ty: number): PlacementCheck {
  return checkPlacement(world, type, tx, ty);
}

export function canAfford(world: World, cost: Cost): boolean {
  return canPay(world.players[PLAYER], cost);
}

export function isTileVisible(world: World, tx: number, ty: number): boolean {
  return tileVisible(world, tx, ty);
}

export function isTileExplored(world: World, tx: number, ty: number): boolean {
  return tileExplored(world, tx, ty);
}

/** Is a (non-player) entity currently visible to the player (fog)? Player entities are always visible. */
export function isEntityVisible(world: World, e: Entity): boolean {
  return entityVisible(world, e);
}

export function idleTillers(world: World): Unit[] {
  return world.units.filter(
    (u) =>
      u.alive &&
      u.owner === PLAYER &&
      u.type === 'tiller' &&
      u.order.type === 'idle' &&
      u.queue.length === 0 &&
      !u.buffs.some((b) => b.id === 'rally_hearth' && b.until > world.tick) &&
      !ucore(world, u).returning,
  );
}

/** Player military units (infantry, ranged, cavalry, siege). The Warden is not included. */
export function playerMilitary(world: World): Unit[] {
  return world.units.filter(
    (u) => u.alive && u.owner === PLAYER && (u.cls === 'infantry' || u.cls === 'ranged' || u.cls === 'cavalry' || u.cls === 'siege'),
  );
}

export function buildingName(type: BuildingId): string {
  return BUILDINGS[type].name;
}
