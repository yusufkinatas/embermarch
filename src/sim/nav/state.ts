/**
 * Nav-private per-world and per-unit bookkeeping (kept out of the shared World contract).
 * Created lazily, so hand-built test worlds work without setup. OWNER: nav.
 */
import type { World } from '../types';

export interface UnitNav {
  /** Waiting in the A* request queue. */
  queued: boolean;
  /** The current A* path reaches the goal (false = nearest-reachable fallback). */
  reached: boolean;
  /** Grid version the current A* path was last validated against. */
  pathVersion: number;
  /** Flow-field users path with A* until this tick (after a stuck repath or a field dead end). */
  astarUntil: number;
  /** When moveStatus became 'unreachable': grid version and tick (retry triggers). */
  unreachVersion: number;
  unreachTick: number;
  /** Distance to the goal when 'arrived' was set (hysteresis against separation nudges). */
  arrivedDist: number;
  /** Snapshot of the intent goal/target, to detect behaviors mutating unit.move directly. */
  hasSnap: boolean;
  snapX: number;
  snapY: number;
  snapTarget: number;
  /** Goal that was last declared 'stuck' (re-issuing it keeps the stuck counters). */
  stuckTick: number;
  stuckX: number;
  stuckY: number;
  stuckTarget: number;
}

export interface NavWorldState {
  units: Map<number, UnitNav>;
  /** FIFO of unit ids waiting for an A* search. */
  queue: number[];
  lastPruneTick: number;
}

const states = new WeakMap<World, NavWorldState>();
let lastWorld: World | null = null;

export function navState(world: World): NavWorldState {
  lastWorld = world;
  let st = states.get(world);
  if (!st) {
    st = { units: new Map(), queue: [], lastPruneTick: 0 };
    states.set(world, st);
  }
  return st;
}

/** The world most recently seen by the movement system (fallback for world-less helpers). */
export function currentWorld(): World | null {
  return lastWorld;
}

export function unitNav(st: NavWorldState, id: number): UnitNav {
  let n = st.units.get(id);
  if (!n) {
    n = {
      queued: false,
      reached: true,
      pathVersion: -1,
      astarUntil: -1,
      unreachVersion: -1,
      unreachTick: -1,
      arrivedDist: 0,
      hasSnap: false,
      snapX: 0,
      snapY: 0,
      snapTarget: 0,
      stuckTick: -1000000,
      stuckX: 0,
      stuckY: 0,
      stuckTarget: 0,
    };
    st.units.set(id, n);
  }
  return n;
}

/** Drop bookkeeping of units that no longer exist (cheap; runs every few seconds). */
export function pruneNavState(world: World, st: NavWorldState): void {
  if (world.tick - st.lastPruneTick < 100) return;
  st.lastPruneTick = world.tick;
  for (const id of st.units.keys()) {
    const e = world.entities.get(id);
    if (!e || !e.alive) st.units.delete(id);
  }
}
