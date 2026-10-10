/**
 * composeStats(): the single place where base data + research + temper + boons + house + meta + rank
 * are combined (GDD §L stacking rules). OWNER: sim-core.
 *
 * Stacking: value = (base_or_set + Σadd) × (1 + Σpct/100). Cost: round(base × (1 + Σpct/100) + Σadd), min 0.
 * Train time reduction capped at -40%. Range bonus capped at +2 (units and structures).
 * Rank: ×(1 + 0.15·rank) to hp and atk; Rank III +1 armor.
 */
import type { BuildingId, Cost, EffectFlag, Owner, ResourceType, UnitClass, UnitId, World } from './types';

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

export function unitStats(world: World, owner: Owner, type: UnitId, rank = 0): UnitStats {
  throw new Error('not implemented');
}

export function buildingStats(world: World, owner: Owner, type: BuildingId): BuildingStats {
  throw new Error('not implemented');
}

/** Composed cost of a unit or building for the owner. */
export function costOf(world: World, owner: Owner, type: UnitId | BuildingId): Cost {
  throw new Error('not implemented');
}

/** Gather rate per second for one Tiller on a source (includes boons/research/house/blight). */
export function gatherRate(
  world: World,
  owner: Owner,
  source: 'thicket' | 'tree' | 'ember_seam' | 'grainplot',
  onBlight: boolean,
): number {
  throw new Error('not implemented');
}

export function carryCap(world: World, owner: Owner, res: ResourceType): number {
  throw new Error('not implemented');
}

export function hasFlag(world: World, owner: Owner, flag: EffectFlag): boolean {
  throw new Error('not implemented');
}

/** Sum of `value` for a flag (0 if absent). */
export function flagValue(world: World, owner: Owner, flag: EffectFlag): number {
  throw new Error('not implemented');
}

/** Invalidate cached composed stats (call after research completes or effects change). */
export function invalidateStats(world: World): void {
  throw new Error('not implemented');
}
