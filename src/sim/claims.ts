/**
 * Gather slots (GDD §D max gatherers): Thickets 2, trees 2 per tile, Ember Seams 6, Grainplots 2.
 * A Tiller holds its slot for the whole job (including drop-off trips) so assignments stay stable.
 * OWNER: sim-core.
 */
import { BUILDINGS } from '../data/buildings';
import { GATHER } from '../data/balance';
import { core, ucore } from './core';
import type { Building, GatherTarget, ResourceNode, Unit, World } from './types';
import { PLAYER, Terrain } from './types';

export type GatherSource = 'thicket' | 'tree' | 'ember_seam' | 'grainplot';

export interface ResolvedTarget {
  source: GatherSource;
  res: 'grain' | 'timber' | 'ember';
  /** Center of the source (tile coords). */
  x: number;
  y: number;
  /** Footprint (for reach checks). */
  tx: number;
  ty: number;
  w: number;
  h: number;
  node?: ResourceNode;
  plot?: Building;
  tile?: number;
}

/** Resolve a gather target to a live source, or null if gone / depleted / not usable. */
export function resolveTarget(world: World, t: GatherTarget): ResolvedTarget | null {
  if (t.kind === 'node') {
    const e = world.entities.get(t.id);
    if (!e || e.kind !== 'resource' || !e.alive || e.amount <= 0) return null;
    return { source: e.type, res: e.resType, x: e.x, y: e.y, tx: e.tx, ty: e.ty, w: e.w, h: e.h, node: e };
  }
  if (t.kind === 'plot') {
    const e = world.entities.get(t.id);
    if (!e || e.kind !== 'building' || !e.alive || !e.built || e.owner !== PLAYER || !BUILDINGS[e.type].gather) return null;
    return { source: 'grainplot', res: 'grain', x: e.x, y: e.y, tx: e.tx, ty: e.ty, w: e.w, h: e.h, plot: e };
  }
  const tile = t.tile;
  const w = world.map.w;
  if (tile < 0 || tile >= w * world.map.h) return null;
  if (world.map.terrain[tile] !== Terrain.Forest || world.map.treeAmount[tile] <= 0) return null;
  const tx = tile % w;
  const ty = (tile - tx) / w;
  return { source: 'tree', res: 'timber', x: tx + 0.5, y: ty + 0.5, tx, ty, w: 1, h: 1, tile };
}

export function sameTarget(a: GatherTarget | null, b: GatherTarget | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'tree') return a.tile === (b as { tile: number }).tile;
  return a.id === (b as { id: number }).id;
}

export function maxGatherersOf(world: World, t: GatherTarget): number {
  if (t.kind === 'node') {
    const e = world.entities.get(t.id);
    return e && e.kind === 'resource' ? e.maxGatherers : 0;
  }
  if (t.kind === 'plot') {
    const e = world.entities.get(t.id);
    return e && e.kind === 'building' ? (BUILDINGS[e.type].gather?.maxGatherers ?? 0) : 0;
  }
  return GATHER.maxGatherers.tree;
}

export function gatherersOf(world: World, t: GatherTarget): number {
  if (t.kind === 'tree') return core(world).treeGatherers[t.tile] ?? 0;
  const e = world.entities.get(t.id);
  if (!e) return 0;
  return e.kind === 'resource' || e.kind === 'building' ? e.gatherers : 0;
}

export function slotFree(world: World, t: GatherTarget): boolean {
  return gatherersOf(world, t) < maxGatherersOf(world, t);
}

function adjust(world: World, t: GatherTarget, delta: number): void {
  if (t.kind === 'tree') {
    const arr = core(world).treeGatherers;
    const v = arr[t.tile] + delta;
    arr[t.tile] = v < 0 ? 0 : v;
    return;
  }
  const e = world.entities.get(t.id);
  if (!e) return;
  if (e.kind === 'resource' || e.kind === 'building') e.gatherers = Math.max(0, e.gatherers + delta);
}

/** Does the unit already hold a slot on this target? */
export function holdsClaim(world: World, u: Unit, t: GatherTarget): boolean {
  return sameTarget(ucore(world, u).claim, t);
}

/** Take a slot on `t` (releasing any other). Returns false if the target is full. */
export function claim(world: World, u: Unit, t: GatherTarget): boolean {
  const uc = ucore(world, u);
  if (sameTarget(uc.claim, t)) return true;
  if (!slotFree(world, t)) return false;
  releaseClaim(world, u);
  adjust(world, t, 1);
  uc.claim = t.kind === 'tree' ? { kind: 'tree', tile: t.tile } : { kind: t.kind, id: t.id };
  return true;
}

export function releaseClaim(world: World, u: Unit): void {
  const uc = ucore(world, u);
  if (!uc.claim) return;
  adjust(world, uc.claim, -1);
  uc.claim = null;
}
