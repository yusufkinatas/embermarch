/** Dijkstra flow fields shared by group orders and enemy waves. OWNER: nav. */
import { NAV } from '../../data/balance';
import { TICK_RATE } from '../types';
import type { NavGrid, World } from '../types';
import { navAux, passableIn, weightsFor } from './layers';
import type { NavAux } from './layers';
import { MinHeap } from './heap';

export interface FlowField {
  key: string;
  mode: 'player' | 'enemy';
  /** Integrated cost to goal per tile (Infinity = unreachable). */
  cost: Float32Array;
  /** Grid version it was built for. */
  version: number;
  goalTiles: number[];
}

interface FlowEntry {
  field: FlowField;
  goalSet: Set<number>;
  builtTick: number;
  lastUsedTick: number;
}

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
/** Rebuild at most once per this many ticks per key after grid changes (0.5 s). */
const DEBOUNCE_TICKS = Math.round(NAV.flowDebounce * TICK_RATE);
/** Cached fields kept per world (least recently used evicted). */
const MAX_FIELDS = 48;
/** Entries unused for this long are dropped (30 s). */
const IDLE_EVICT_TICKS = 30 * TICK_RATE;

const caches = new WeakMap<World, Map<string, FlowEntry>>();
const heap = new MinHeap(4096);
let scratch = new Float64Array(0);
let goalMark = new Uint8Array(0);
let builds = 0;

function cacheOf(world: World): Map<string, FlowEntry> {
  let c = caches.get(world);
  if (!c) {
    c = new Map();
    caches.set(world, c);
  }
  return c;
}

function cacheKey(key: string, mode: 'player' | 'enemy'): string {
  return mode + ':' + key;
}

function isSubset(goals: number[], set: Set<number>): boolean {
  for (const g of goals) if (!set.has(g)) return false;
  return true;
}

/**
 * Get (cached by key, rebuilt when grid.version changed, debounced 0.5 s) a flow field toward goal tiles.
 * Enemy mode: player building tiles cost 12 (passable for planning; movement reports blockedBy).
 * Requesting goals that are a subset of the cached field's goals reuses it; new goals rebuild at once.
 */
export function getFlowField(world: World, key: string, goalTiles: number[], mode: 'player' | 'enemy'): FlowField {
  const cache = cacheOf(world);
  const ck = cacheKey(key, mode);
  const entry = cache.get(ck);
  const goals = sanitizeGoals(world.grid, goalTiles);
  if (entry) {
    entry.lastUsedTick = world.tick;
    if (isSubset(goals, entry.goalSet)) {
      if (entry.field.version === world.grid.version) return entry.field;
      if (world.tick - entry.builtTick < DEBOUNCE_TICKS) return entry.field;
    }
    build(world, entry.field, goals);
    entry.goalSet = new Set(goals);
    entry.builtTick = world.tick;
    return entry.field;
  }
  evict(world, cache);
  const n = world.grid.w * world.grid.h;
  const field: FlowField = { key, mode, cost: new Float32Array(n), version: -1, goalTiles: [] };
  build(world, field, goals);
  cache.set(ck, { field, goalSet: new Set(goals), builtTick: world.tick, lastUsedTick: world.tick });
  return field;
}

/** Would getFlowField(...) run a Dijkstra build right now? (Lets movement budget builds per tick.) */
export function flowFieldNeedsBuild(world: World, key: string, goalTiles: number[], mode: 'player' | 'enemy'): boolean {
  const entry = cacheOf(world).get(cacheKey(key, mode));
  if (!entry) return true;
  if (!isSubset(sanitizeGoals(world.grid, goalTiles), entry.goalSet)) return true;
  return entry.field.version !== world.grid.version && world.tick - entry.builtTick >= DEBOUNCE_TICKS;
}

/** The cached field for a key without rebuilding (null if none). */
export function peekFlowField(world: World, key: string, mode: 'player' | 'enemy'): FlowField | null {
  const entry = cacheOf(world).get(cacheKey(key, mode));
  if (!entry) return null;
  entry.lastUsedTick = world.tick;
  return entry.field;
}

/** Drop a cached field (e.g. a finished group order). */
export function releaseFlowField(world: World, key: string, mode: 'player' | 'enemy'): void {
  cacheOf(world).delete(cacheKey(key, mode));
}

/** Total Dijkstra builds performed (diagnostics / tests). */
export function flowFieldBuildCount(): number {
  return builds;
}

function sanitizeGoals(grid: NavGrid, goalTiles: number[]): number[] {
  const n = grid.w * grid.h;
  const out: number[] = [];
  for (const t of goalTiles) if (Number.isInteger(t) && t >= 0 && t < n && !out.includes(t)) out.push(t);
  out.sort((a, b) => a - b);
  return out;
}

function evict(world: World, cache: Map<string, FlowEntry>): void {
  for (const [k, e] of cache) if (world.tick - e.lastUsedTick > IDLE_EVICT_TICKS) cache.delete(k);
  while (cache.size >= MAX_FIELDS) {
    let oldestKey = '';
    let oldest = Infinity;
    for (const [k, e] of cache) {
      if (e.lastUsedTick < oldest) {
        oldest = e.lastUsedTick;
        oldestKey = k;
      }
    }
    cache.delete(oldestKey);
  }
}

/** Is tile i usable by this field (mode passability, or a goal tile)? */
function fieldPassable(grid: NavGrid, aux: NavAux, field: FlowField, i: number): boolean {
  return passableIn(grid, aux, field.mode, i) || field.cost[i] === 0;
}

/** Multi-source Dijkstra (8-dir, no corner cutting) from the goal tiles outward. */
function build(world: World, field: FlowField, goals: number[]): void {
  builds++;
  const grid = world.grid;
  const aux = navAux(world);
  const w = grid.w;
  const h = grid.h;
  const n = w * h;
  if (field.cost.length !== n) field.cost = new Float32Array(n);
  if (scratch.length < n) scratch = new Float64Array(n);
  if (goalMark.length < n) goalMark = new Uint8Array(n);
  const cost = scratch;
  cost.fill(Infinity, 0, n);
  const isGoal = goalMark;
  isGoal.fill(0, 0, n);
  heap.clear();
  for (const g of goals) {
    cost[g] = 0;
    isGoal[g] = 1;
    heap.push(g, 0);
  }
  const W = weightsFor(aux, field.mode);
  const relax = (ni: number, nc: number): void => {
    if (nc < cost[ni]) {
      cost[ni] = nc;
      heap.push(ni, nc);
    }
  };
  while (heap.size > 0) {
    const c = heap.pop();
    const cc = heap.lastKey;
    if (cc > cost[c]) continue;
    const cx = c % w;
    const cy = (c - cx) / w;
    // Moving from a neighbour INTO c costs c's weight (goal tiles weigh 1).
    const wc = isGoal[c] === 1 ? 1 : W[c];
    const oc = cc + wc;
    const dc = cc + SQRT2 * wc;
    const okL = cx > 0 && (W[c - 1] !== Infinity || isGoal[c - 1] === 1);
    const okR = cx < w - 1 && (W[c + 1] !== Infinity || isGoal[c + 1] === 1);
    const okU = cy > 0 && (W[c - w] !== Infinity || isGoal[c - w] === 1);
    const okD = cy < h - 1 && (W[c + w] !== Infinity || isGoal[c + w] === 1);
    if (okL) relax(c - 1, oc);
    if (okR) relax(c + 1, oc);
    if (okU) relax(c - w, oc);
    if (okD) relax(c + w, oc);
    if (okL && okU && (W[c - w - 1] !== Infinity || isGoal[c - w - 1] === 1)) relax(c - w - 1, dc);
    if (okR && okU && (W[c - w + 1] !== Infinity || isGoal[c - w + 1] === 1)) relax(c - w + 1, dc);
    if (okL && okD && (W[c + w - 1] !== Infinity || isGoal[c + w - 1] === 1)) relax(c + w - 1, dc);
    if (okR && okD && (W[c + w + 1] !== Infinity || isGoal[c + w + 1] === 1)) relax(c + w + 1, dc);
  }
  for (let i = 0; i < n; i++) field.cost[i] = cost[i];
  field.version = grid.version;
  field.goalTiles = goals.slice();
}

/**
 * Next tile along the field from tile t: the neighbour n minimising cost[n] + step x weight(n)
 * (the Dijkstra predecessor; with non-uniform weights the cheapest neighbour alone could be a
 * building tile that is cheap to leave but expensive to enter). Must improve on cost[t]. -1 if none.
 */
export function flowNextTile(world: World, field: FlowField, t: number): number {
  const grid = world.grid;
  const aux = navAux(world);
  const W = weightsFor(aux, field.mode);
  const w = grid.w;
  const h = grid.h;
  const cost = field.cost;
  if (t < 0 || t >= w * h) return -1;
  const cur = cost[t];
  if (cur === 0) return -1;
  const cx = t % w;
  const cy = (t - cx) / w;
  let best = -1;
  let bestVal = Infinity;
  for (let d = 0; d < 8; d++) {
    const nx = cx + DX[d];
    const ny = cy + DY[d];
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const ni = ny * w + nx;
    const c = cost[ni];
    if (!(c < cur)) continue;
    if (!fieldPassable(grid, aux, field, ni)) continue;
    if (d >= 4 && (!fieldPassable(grid, aux, field, cy * w + nx) || !fieldPassable(grid, aux, field, ny * w + cx))) continue;
    const weight = c === 0 ? 1 : W[ni];
    const val = c + (d >= 4 ? SQRT2 : 1) * (weight === Infinity ? 1 : weight);
    if (val < bestVal) {
      best = ni;
      bestVal = val;
    }
  }
  return best;
}

/** Best next tile-center to move toward from (x, y), or null if at goal/unreachable. */
export function flowStep(world: World, field: FlowField, x: number, y: number): { x: number; y: number; tile: number } | null {
  const grid = world.grid;
  const tx = Math.min(grid.w - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(grid.h - 1, Math.max(0, Math.floor(y)));
  const next = flowNextTile(world, field, ty * grid.w + tx);
  if (next < 0) return null;
  return { x: (next % grid.w) + 0.5, y: Math.floor(next / grid.w) + 0.5, tile: next };
}
