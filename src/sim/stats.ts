/**
 * composeStats(): the single place where base data + research + temper + boons + house + meta + rank
 * are combined (GDD §L stacking rules). OWNER: sim-core.
 *
 * Stacking: value = (base_or_set + Σadd) × (1 + Σpct/100). Cost: round(base × (1 + Σpct/100) + Σadd), min 0.
 * Train time reduction capped at -40%. Range bonus capped at +2 (units and structures).
 * Rank: ×(1 + 0.15·rank) to hp and atk; Rank III +1 armor.
 *
 * PlayerState.effects holds the composed effect list for an owner: setup.playerEffects (player) or
 * setup.enemyEffects (enemy) plus the effects of completed research. Results are cached per
 * (owner, type, rank) and invalidated by invalidateStats() (research completion).
 */
import { BUILDINGS } from '../data/buildings';
import { CLASS_STRUCT_MOD, GATHER, STACKING, VETERANCY } from '../data/balance';
import { EMBER_TITHE_COST_PCT } from '../data/boons';
import { RESEARCH } from '../data/research';
import { UNITS } from '../data/units';
import type { BuildingDef, UnitDef } from '../data/types';
import { core } from './core';
import type {
  BuildingId,
  Cost,
  Effect,
  EffectFlag,
  Owner,
  ResearchId,
  ResourceType,
  Selector,
  StatKey,
  UnitClass,
  UnitId,
  World,
} from './types';
import { RESOURCE_TYPES } from './types';

export interface UnitStats {
  hp: number;
  atk: number;
  /** Outgoing damage multiplier (1 + Σ damage pct). */
  damageMul: number;
  cooldown: number;
  range: number;
  armor: number;
  speed: number;
  sight: number;
  trainTime: number;
  cost: Cost;
  pop: number;
  structMod: number;
  bonus: Partial<Record<UnitClass, number>>;
  resist: { ranged: number; melee: number };
  /** (base_or_set + Σadd) before percentages and rank: the "ATK + flatAtk" term of §G. */
  atkFlat: number;
  /** Σ atk pct / 100 from effects (dynamic buffs add to this at hit time). */
  atkPct: number;
  /** (1 + 0.15 × rank). */
  rankMul: number;
}

export interface BuildingStats {
  hp: number;
  armor: number;
  buildTime: number;
  cost: Cost;
  sight: number;
  /** Defensive fire after effects (null if none). */
  attack: { dmg: number; cooldown: number; range: number; volley: number } | null;
}

// ---------------------------------------------------------------------------
// Selector matching
// ---------------------------------------------------------------------------

type Subject =
  | { kind: 'unit'; type: UnitId; def: UnitDef }
  | { kind: 'building'; type: BuildingId; def: BuildingDef };

function isMilitary(cls: UnitClass): boolean {
  return cls === 'infantry' || cls === 'ranged' || cls === 'cavalry' || cls === 'siege';
}

/** All present criteria must match (AND). An empty selector matches nothing. */
export function selectorMatches(sel: Selector, s: Subject): boolean {
  let any = false;
  if (sel.units !== undefined) {
    any = true;
    if (s.kind !== 'unit' || !sel.units.includes(s.type)) return false;
  }
  if (sel.buildings !== undefined) {
    any = true;
    if (s.kind !== 'building' || !sel.buildings.includes(s.type)) return false;
  }
  if (sel.classes !== undefined) {
    any = true;
    if (s.kind !== 'unit' || !sel.classes.includes(s.def.cls)) return false;
  }
  if (sel.military !== undefined) {
    any = true;
    if (s.kind !== 'unit' || isMilitary(s.def.cls) !== sel.military) return false;
  }
  if (sel.melee !== undefined) {
    any = true;
    if (s.kind !== 'unit' || s.def.range < 1.5 !== sel.melee) return false;
  }
  if (sel.rangedAttack !== undefined) {
    any = true;
    if (s.kind !== 'unit' || s.def.range >= 1.5 !== sel.rangedAttack) return false;
  }
  if (sel.allUnits === true) {
    any = true;
    if (s.kind !== 'unit') return false;
  }
  if (sel.allBuildings === true) {
    any = true;
    if (s.kind !== 'building') return false;
  }
  return any;
}

// ---------------------------------------------------------------------------
// Accumulation
// ---------------------------------------------------------------------------

interface Acc {
  set: number | undefined;
  add: number;
  addPos: number;
  addNeg: number;
  pct: number;
}

function emptyAcc(): Acc {
  return { set: undefined, add: 0, addPos: 0, addNeg: 0, pct: 0 };
}

type StatAccs = Partial<Record<StatKey, Acc>>;

function accumulateStats(effects: readonly Effect[], s: Subject): StatAccs {
  const out: StatAccs = {};
  for (const e of effects) {
    if (e.kind !== 'stat' || !selectorMatches(e.sel, s)) continue;
    let a = out[e.stat];
    if (!a) {
      a = emptyAcc();
      out[e.stat] = a;
    }
    if (e.set !== undefined) a.set = e.set;
    if (e.add !== undefined) {
      a.add += e.add;
      if (e.add >= 0) a.addPos += e.add;
      else a.addNeg += e.add;
    }
    if (e.pct !== undefined) a.pct += e.pct;
  }
  return out;
}

/** (base_or_set + Σadd) × (1 + Σpct/100). */
function compose(base: number, a: Acc | undefined): number {
  if (!a) return base;
  return ((a.set ?? base) + a.add) * (1 + a.pct / 100);
}

/** Range: positive flat bonuses capped at +2, percentages, then negative flats (Downpour, after caps). */
function composeRange(base: number, a: Acc | undefined, cap: number): number {
  if (!a) return base;
  const b = a.set ?? base;
  const r = (b + Math.min(cap, a.addPos)) * (1 + a.pct / 100) + a.addNeg;
  return Math.max(0, r);
}

/** Train time: Σpct floored at −40%. */
function composeTrainTime(base: number, a: Acc | undefined): number {
  if (!a) return base;
  const pct = Math.max(-STACKING.maxTrainTimeReduction * 100, a.pct);
  return Math.max(0, ((a.set ?? base) + a.add) * (1 + pct / 100));
}

function composeSight(base: number, a: Acc | undefined): number {
  const v = compose(base, a);
  return base > 0 ? Math.max(STACKING.minSight, v) : v;
}

/** Cost: round(base_or_set × (1 + Σpct/100) + Σadd), min 0. Zero entries are omitted. */
export function composeCost(base: Cost, effects: readonly Effect[], s: Subject): Cost {
  const out: Cost = {};
  for (const res of RESOURCE_TYPES) {
    let b = base[res] ?? 0;
    let add = 0;
    let pct = 0;
    let touched = false;
    for (const e of effects) {
      if (e.kind !== 'cost') continue;
      if (e.res !== undefined && e.res !== res) continue;
      if (!selectorMatches(e.sel, s)) continue;
      touched = true;
      if (e.set !== undefined) b = e.set;
      if (e.add !== undefined) add += e.add;
      if (e.pct !== undefined) pct += e.pct;
    }
    const v = touched ? Math.max(0, Math.round(b * (1 + pct / 100) + add)) : b;
    if (v > 0) out[res] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function effectsOf(world: World, owner: Owner): readonly Effect[] {
  return world.players[owner]?.effects ?? [];
}

/** Compose a unit's stats from an explicit effect list (pure; exported for tests and tooltips). */
export function composeUnitStats(effects: readonly Effect[], type: UnitId, rank = 0): UnitStats {
  const def = UNITS[type];
  const s: Subject = { kind: 'unit', type, def };
  const acc = accumulateStats(effects, s);
  const rankMul = 1 + (VETERANCY.atkPctPerRank / 100) * rank;
  const hpBase = compose(def.hp, acc.hp);
  const atkA = acc.atk;
  const atkFlat = atkA ? (atkA.set ?? def.atk) + atkA.add : def.atk;
  const atkPct = atkA ? atkA.pct / 100 : 0;
  const dmgA = acc.damage;
  const damageMul = dmgA ? 1 + dmgA.pct / 100 : 1;
  const structA = acc.structMod;
  const structMod = structA?.set ?? def.structMod ?? CLASS_STRUCT_MOD[def.cls];
  return {
    hp: Math.max(1, Math.round(hpBase * (1 + (VETERANCY.hpPctPerRank / 100) * rank))),
    atk: atkFlat * (1 + atkPct) * rankMul,
    damageMul,
    cooldown: def.cooldown > 0 ? Math.max(0.1, compose(def.cooldown, acc.cooldown)) : 0,
    range: composeRange(def.range, acc.range, STACKING.maxUnitRangeBonus),
    armor: compose(def.armor, acc.armor) + (rank >= 3 ? VETERANCY.rank3Armor : 0),
    speed: Math.max(0, compose(def.speed, acc.speed)),
    sight: composeSight(def.sight, acc.sight),
    trainTime: composeTrainTime(def.trainTime, acc.trainTime),
    cost: composeCost(def.cost, effects, s),
    pop: def.pop,
    structMod,
    bonus: def.bonus,
    resist: { ranged: def.resist?.ranged ?? 1, melee: def.resist?.melee ?? 1 },
    atkFlat,
    atkPct,
    rankMul,
  };
}

/** Compose a building's stats from an explicit effect list (pure). */
export function composeBuildingStats(effects: readonly Effect[], type: BuildingId, kilnMasons = false): BuildingStats {
  const def = BUILDINGS[type];
  const s: Subject = { kind: 'building', type, def };
  const acc = accumulateStats(effects, s);
  let buildTime = Math.max(0, compose(def.buildTime, acc.buildTime));
  if (kilnMasons && type === 'brazier_tower') buildTime /= 2;
  let attack: BuildingStats['attack'] = null;
  if (def.attack) {
    const baseVolley = type === 'hearth' ? STACKING.hearthVolley : STACKING.towerVolley;
    attack = {
      dmg: Math.max(0, compose(def.attack.dmg, acc.atk)),
      cooldown: Math.max(0.1, compose(def.attack.cooldown, acc.cooldown)),
      range: composeRange(def.attack.range, acc.range, STACKING.maxStructureRangeBonus),
      volley: Math.max(1, Math.round(compose(baseVolley, acc.volley))),
    };
  }
  return {
    hp: Math.max(1, Math.round(compose(def.hp, acc.hp))),
    armor: compose(def.armor, acc.armor),
    buildTime,
    cost: composeCost(def.cost, effects, s),
    sight: composeSight(def.sight, acc.sight),
    attack,
  };
}

export function unitStats(world: World, owner: Owner, type: UnitId, rank = 0): UnitStats {
  const cache = core(world).unitStats;
  const key = `${owner}|${type}|${rank}`;
  let st = cache.get(key);
  if (!st) {
    st = composeUnitStats(effectsOf(world, owner), type, rank);
    cache.set(key, st);
  }
  return st;
}

export function buildingStats(world: World, owner: Owner, type: BuildingId): BuildingStats {
  const cache = core(world).buildingStats;
  const key = `${owner}|${type}`;
  let st = cache.get(key);
  if (!st) {
    st = composeBuildingStats(effectsOf(world, owner), type, hasFlag(world, owner, 'kiln_masons'));
    cache.set(key, st);
  }
  return st;
}

/** Composed cost of a unit or building for the owner. */
export function costOf(world: World, owner: Owner, type: UnitId | BuildingId): Cost {
  if (type in UNITS) return unitStats(world, owner, type as UnitId).cost;
  return buildingStats(world, owner, type as BuildingId).cost;
}

/**
 * Research cost for the owner. Ember Tithe's Ember −15% applies to research too, rounded like unit
 * and building costs (round(base × (1 + pct/100))).
 */
export function researchCost(world: World, owner: Owner, id: ResearchId): Cost {
  const base = RESEARCH[id].cost;
  if (!base.ember || !hasFlag(world, owner, 'ember_tithe')) return { ...base };
  return { ...base, ember: Math.max(0, Math.round(base.ember * (1 + EMBER_TITHE_COST_PCT / 100))) };
}

const SOURCE_RES: Record<'thicket' | 'tree' | 'ember_seam' | 'grainplot', ResourceType> = {
  thicket: 'grain',
  tree: 'timber',
  ember_seam: 'ember',
  grainplot: 'grain',
};

/** Σ gather pct for an owner and source (pure helper). */
export function gatherPct(effects: readonly Effect[], source: 'thicket' | 'tree' | 'ember_seam' | 'grainplot'): number {
  const res = SOURCE_RES[source];
  let pct = 0;
  for (const e of effects) {
    if (e.kind !== 'gather') continue;
    if (e.res !== 'all' && e.res !== res) continue;
    if (e.source !== undefined && e.source !== source) continue;
    pct += e.pct;
  }
  return pct;
}

/**
 * Gather rate per second for one Tiller on a source (includes boons/research/house/blight).
 * `extraPct` adds per-unit bonuses (Harvest Hymn) into the same percentage sum (§L: pcts add).
 */
export function gatherRate(
  world: World,
  owner: Owner,
  source: 'thicket' | 'tree' | 'ember_seam' | 'grainplot',
  onBlight: boolean,
  extraPct = 0,
): number {
  const pct = gatherPct(effectsOf(world, owner), source) + extraPct;
  const blight = onBlight && !hasFlag(world, owner, 'kindled_earth') ? GATHER.blightMul : 1;
  return Math.max(0, GATHER.rates[source] * (1 + pct / 100) * blight);
}

export function carryCap(world: World, owner: Owner, res: ResourceType): number {
  let cap = GATHER.carry;
  for (const e of effectsOf(world, owner)) {
    if (e.kind === 'carry' && (e.res === 'all' || e.res === res)) cap += e.add;
  }
  return Math.max(1, cap);
}

export function hasFlag(world: World, owner: Owner, flag: EffectFlag): boolean {
  return (world.players[owner]?.flags[flag] ?? 0) > 0;
}

/** Sum of `value` for a flag (0 if absent). */
export function flagValue(world: World, owner: Owner, flag: EffectFlag): number {
  return world.players[owner]?.flags[flag] ?? 0;
}

/** Flags present in an effect list (value = sum of values, or 1 per valueless flag). */
export function computeFlags(effects: readonly Effect[]): Partial<Record<EffectFlag, number>> {
  const flags: Partial<Record<EffectFlag, number>> = {};
  for (const e of effects) {
    if (e.kind !== 'flag') continue;
    flags[e.flag] = (flags[e.flag] ?? 0) + (e.value ?? 1);
  }
  return flags;
}

/** Invalidate cached composed stats (call after research completes or effects change). */
export function invalidateStats(world: World): void {
  const c = core(world);
  c.unitStats.clear();
  c.buildingStats.clear();
}
