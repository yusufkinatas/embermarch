/**
 * Entity lifecycle. OWNER: sim-core.
 * Spawning registers the entity in world.entities + the typed live list, and (for static
 * entities) marks the nav grid footprint via nav/grid.setFootprint.
 */
import type {
  Building,
  BuildingId,
  Entity,
  Owner,
  ResourceNode,
  ResourceNodeId,
  Unit,
  UnitId,
  World,
} from './types';

export interface SpawnUnitOpts {
  rank?: 0 | 1 | 2 | 3;
  kills?: number;
  /** Came from Retinue/Sellswords. */
  carried?: boolean;
  /** Override max HP multiplier (e.g. Warden 50% after the duel) - applies to current hp only. */
  hpPct?: number;
  /** Do not count toward pop (pre-placed units still count toward pop but ignore the cap). */
  silent?: boolean;
}

export function spawnUnit(world: World, type: UnitId, owner: Owner, x: number, y: number, opts?: SpawnUnitOpts): Unit {
  throw new Error('not implemented');
}

export interface SpawnBuildingOpts {
  /** Pre-built (true) or a foundation (false). Default true. */
  built?: boolean;
}

export function spawnBuilding(world: World, type: BuildingId, owner: Owner, tx: number, ty: number, opts?: SpawnBuildingOpts): Building {
  throw new Error('not implemented');
}

export function spawnResource(world: World, type: ResourceNodeId, tx: number, ty: number, amount: number, contested?: boolean): ResourceNode {
  throw new Error('not implemented');
}

export function getEntity(world: World, id: number): Entity | undefined {
  return id ? world.entities.get(id) : undefined;
}

export function getUnit(world: World, id: number): Unit | undefined {
  const e = getEntity(world, id);
  return e && e.kind === 'unit' && e.alive ? e : undefined;
}

export function getBuilding(world: World, id: number): Building | undefined {
  const e = getEntity(world, id);
  return e && e.kind === 'building' && e.alive ? e : undefined;
}

/**
 * Kill an entity now: marks !alive, emits a death event, frees footprint/pop, calls
 * encounter.onEntityDeath and boon hooks. Physical removal from lists happens at end of tick.
 */
export function killEntity(world: World, e: Entity, killerId: number): void {
  throw new Error('not implemented');
}
