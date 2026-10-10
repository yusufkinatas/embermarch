/** Dijkstra flow fields shared by group orders and enemy waves. OWNER: nav. */
import type { World } from '../types';

export interface FlowField {
  key: string;
  mode: 'player' | 'enemy';
  /** Integrated cost to goal per tile (Infinity = unreachable). */
  cost: Float32Array;
  /** Grid version it was built for. */
  version: number;
  goalTiles: number[];
}

/**
 * Get (cached by key, rebuilt when grid.version changed, debounced 0.5 s) a flow field toward goal tiles.
 * Enemy mode: player building tiles cost 12 (passable for planning; movement reports blockedBy).
 */
export function getFlowField(world: World, key: string, goalTiles: number[], mode: 'player' | 'enemy'): FlowField {
  throw new Error('not implemented');
}

/** Best next tile-center to move toward from (x, y), or null if at goal/unreachable. */
export function flowStep(world: World, field: FlowField, x: number, y: number): { x: number; y: number; tile: number } | null {
  throw new Error('not implemented');
}
