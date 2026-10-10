/** A* (octile, binary heap, no corner cutting, nearest-reachable fallback). OWNER: nav. */
import type { World } from '../types';

export interface PathOpts {
  /** 'enemy' lets paths pass player buildings at cost 12. Default 'player'. */
  mode?: 'player' | 'enemy';
  /** Goal is a footprint: any walkable tile adjacent to this rect is a goal. */
  goalRect?: { tx: number; ty: number; w: number; h: number };
  /** Max expanded nodes (default 4096). */
  maxNodes?: number;
}

/** Returns tile-center waypoints from start to goal (string-pulled), or null if start is invalid. */
export function findPath(world: World, sx: number, sy: number, gx: number, gy: number, opts?: PathOpts): { x: number; y: number }[] | null {
  throw new Error('not implemented');
}
