/**
 * Read-only queries for the HUD / input. OWNER: sim-core.
 */
import type {
  Building,
  BuildingId,
  Cost,
  Entity,
  PlayerBuildingId,
  PlayerUnitId,
  ResearchId,
  Unit,
  World,
} from './types';

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

/** Topmost entity at a world point, fog-aware (hidden enemy units are not pickable; seen enemy buildings are). */
export function pickEntityAt(world: World, x: number, y: number): Entity | null {
  throw new Error('not implemented');
}

/** Own (owner 0) units whose centers lie in the rect (any corner order). */
export function unitsInRect(world: World, x0: number, y0: number, x1: number, y1: number): Unit[] {
  throw new Error('not implemented');
}

export function trainOptions(world: World, building: Building): CommandOption[] {
  throw new Error('not implemented');
}

export function researchOptions(world: World, building: Building): CommandOption[] {
  throw new Error('not implemented');
}

/** Tiller build menu (one option per unlocked building with hotkey). */
export function buildOptions(world: World): CommandOption[] {
  throw new Error('not implemented');
}

/** Command card for a selection (units and/or one building type). */
export function commandCard(world: World, selection: number[]): CommandOption[] {
  throw new Error('not implemented');
}

export function canPlaceBuilding(world: World, type: PlayerBuildingId, tx: number, ty: number): PlacementCheck {
  throw new Error('not implemented');
}

export function canAfford(world: World, cost: Cost): boolean {
  throw new Error('not implemented');
}

export function isTileVisible(world: World, tx: number, ty: number): boolean {
  throw new Error('not implemented');
}

export function isTileExplored(world: World, tx: number, ty: number): boolean {
  throw new Error('not implemented');
}

/** Is a (non-player) entity currently visible to the player (fog)? Player entities are always visible. */
export function isEntityVisible(world: World, e: Entity): boolean {
  throw new Error('not implemented');
}

export function idleTillers(world: World): Unit[] {
  throw new Error('not implemented');
}

export function playerMilitary(world: World): Unit[] {
  throw new Error('not implemented');
}

export function buildingName(type: BuildingId): string {
  throw new Error('not implemented');
}
