/** A* (octile, binary heap, no corner cutting, nearest-reachable fallback). OWNER: nav. */
import type { NavGrid, World } from '../types';
import { componentsFor, navAux, passableIn, weightsFor } from './layers';
import type { NavAux, NavMode } from './layers';
import { MinHeap } from './heap';
import { clearLine } from './los';

export interface PathOpts {
  /** 'enemy' lets paths pass player buildings at cost 12. Default 'player'. */
  mode?: 'player' | 'enemy';
  /** Goal is a footprint: any walkable tile adjacent to this rect is a goal. */
  goalRect?: { tx: number; ty: number; w: number; h: number };
  /** Max expanded nodes (default 4096). */
  maxNodes?: number;
}

export interface PathResult {
  /** String-pulled waypoints (tile centers; the exact goal point last when it was reached). Excludes the start. */
  waypoints: { x: number; y: number }[];
  /** False when the goal was unreachable or the node budget ran out: the path ends at the reachable tile closest to the goal. */
  reached: boolean;
  /** Raw tile path (tile indices) from the start tile to the end tile. */
  tiles: number[];
}

const SQRT2 = Math.SQRT2;
const DEFAULT_MAX_NODES = 4096;
/** Clearance used when string-pulling (slightly below the smallest unit radius). */
export const SMOOTH_CLEARANCE = 0.27;
/** Mild tie-break toward the goal (paths stay within 0.1% of optimal). */
const H_TIE = 1 + 1e-3;

// Scratch buffers shared by all searches (generation-stamped: no clearing between searches).
let capacity = 0;
let gScore = new Float64Array(0);
let parent = new Int32Array(0);
let seen = new Uint32Array(0);
let closed = new Uint32Array(0);
let gen = 0;
const heap = new MinHeap(4096);

function prepare(n: number): void {
  if (capacity < n) {
    capacity = n;
    gScore = new Float64Array(n);
    parent = new Int32Array(n);
    seen = new Uint32Array(n);
    closed = new Uint32Array(n);
    gen = 0;
  }
  gen++;
  if (gen >= 0xfffffff0) {
    seen.fill(0);
    closed.fill(0);
    gen = 1;
  }
  heap.clear();
}

function octile(dx: number, dy: number): number {
  return dx < dy ? SQRT2 * dx + (dy - dx) : SQRT2 * dy + (dx - dy);
}

interface GoalSpec {
  /** Ring box (inclusive tile coords) for rect goals, or the single goal tile (x0 = x1, y0 = y1). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  rect: boolean;
  /** Footprint (inclusive) excluded from the ring. */
  fx0: number;
  fy0: number;
  fx1: number;
  fy1: number;
  /** Rect goals: only strictly walkable ring tiles count (else any mode-passable ring tile). */
  strict: boolean;
}

function heuristic(spec: GoalSpec, x: number, y: number): number {
  const dx = x < spec.x0 ? spec.x0 - x : x > spec.x1 ? x - spec.x1 : 0;
  const dy = y < spec.y0 ? spec.y0 - y : y > spec.y1 ? y - spec.y1 : 0;
  return octile(dx, dy);
}

function isGoal(grid: NavGrid, aux: NavAux, mode: NavMode, spec: GoalSpec, i: number, x: number, y: number): boolean {
  if (!spec.rect) return x === spec.x0 && y === spec.y0;
  if (x < spec.x0 || x > spec.x1 || y < spec.y0 || y > spec.y1) return false;
  if (x >= spec.fx0 && x <= spec.fx1 && y >= spec.fy0 && y <= spec.fy1) return false;
  return spec.strict ? grid.blocked[i] === 0 : passableIn(grid, aux, mode, i);
}

function tileSpec(tx: number, ty: number): GoalSpec {
  return { x0: tx, y0: ty, x1: tx, y1: ty, rect: false, fx0: 1, fy0: 1, fx1: 0, fy1: 0, strict: true };
}

/** Nearest mode-passable tile to (x, y) within maxR rings, or -1. */
export function nearestPassableTile(world: World, x: number, y: number, maxR: number, mode: NavMode = 'player'): number {
  const grid = world.grid;
  const aux = navAux(world);
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let best = -1;
  let bestD = Infinity;
  for (let r = 0; r <= maxR; r++) {
    if (r - 1 > bestD) break;
    for (let ty = cy - r; ty <= cy + r; ty++) {
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (Math.max(Math.abs(tx - cx), Math.abs(ty - cy)) !== r) continue;
        if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) continue;
        const i = ty * grid.w + tx;
        if (!passableIn(grid, aux, mode, i)) continue;
        const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
  }
  return best;
}

/** Can a unit at (sx, sy) walk to the tile of (gx, gy) at all (connected components; O(1))? */
export function isReachable(world: World, sx: number, sy: number, gx: number, gy: number, mode: NavMode = 'player'): boolean {
  const grid = world.grid;
  const aux = navAux(world);
  const s = tileIndex(grid, sx, sy);
  const g = tileIndex(grid, gx, gy);
  if (s < 0 || g < 0) return false;
  const comp = componentsFor(aux, mode);
  return comp[s] >= 0 && comp[s] === comp[g];
}

function tileIndex(grid: NavGrid, x: number, y: number): number {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h ? ty * grid.w + tx : -1;
}

/** Returns tile-center waypoints from start to goal (string-pulled), or null if start is invalid. */
export function findPath(world: World, sx: number, sy: number, gx: number, gy: number, opts?: PathOpts): { x: number; y: number }[] | null {
  const r = findPathEx(world, sx, sy, gx, gy, opts);
  return r ? r.waypoints : null;
}

/** findPath with details: whether the goal was reached and the raw tile path. */
export function findPathEx(world: World, sx: number, sy: number, gx: number, gy: number, opts?: PathOpts): PathResult | null {
  const grid = world.grid;
  const w = grid.w;
  const mode: NavMode = opts?.mode ?? 'player';
  const maxNodes = opts?.maxNodes ?? DEFAULT_MAX_NODES;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(gx) || !Number.isFinite(gy)) return null;
  const aux = navAux(world);

  let start = tileIndex(grid, sx, sy);
  if (start < 0) return null;
  let startSubstituted = false;
  if (!passableIn(grid, aux, mode, start)) {
    start = nearestPassableTile(world, sx, sy, 2, mode);
    if (start < 0) return null;
    startSubstituted = true;
  }

  // Goal specification.
  let spec: GoalSpec;
  let pointGoal = false;
  const rect = opts?.goalRect;
  if (rect) {
    spec = {
      x0: rect.tx - 1,
      y0: rect.ty - 1,
      x1: rect.tx + rect.w,
      y1: rect.ty + rect.h,
      rect: true,
      fx0: rect.tx,
      fy0: rect.ty,
      fx1: rect.tx + rect.w - 1,
      fy1: rect.ty + rect.h - 1,
      strict: false,
    };
    spec.strict = ringHas(grid, aux, mode, spec, (i) => grid.blocked[i] === 0);
  } else {
    const gtx = Math.min(w - 1, Math.max(0, Math.floor(gx)));
    const gty = Math.min(grid.h - 1, Math.max(0, Math.floor(gy)));
    spec = tileSpec(gtx, gty);
    pointGoal = gtx === Math.floor(gx) && gty === Math.floor(gy);
  }

  // Unreachable goal: redirect to the reachable tile with the lowest heuristic (GDD §F b).
  const comp = componentsFor(aux, mode);
  const sc = comp[start];
  let reached = true;
  let reachable: boolean;
  if (spec.rect) {
    reachable = ringHas(grid, aux, mode, spec, (i) => comp[i] === sc && (spec.strict ? grid.blocked[i] === 0 : true));
  } else {
    const g = spec.y0 * w + spec.x0;
    reachable = passableIn(grid, aux, mode, g) && comp[g] === sc;
  }
  if (!reachable) {
    const t = nearestReachableTo(grid, comp, sc, spec, gx, gy, start);
    spec = tileSpec(t % w, Math.floor(t / w));
    reached = false;
    pointGoal = false;
  }

  const search = astar(grid, aux, mode, start, spec, maxNodes);
  if (!search.found) reached = false;
  const tiles: number[] = [];
  for (let c = search.end; c !== -1; c = parent[c]) tiles.push(c);
  tiles.reverse();

  // Polyline: actual start position, tile centers, exact goal point when reached.
  const px: number[] = [sx];
  const py: number[] = [sy];
  for (let k = startSubstituted ? 0 : 1; k < tiles.length; k++) {
    const t = tiles[k];
    px.push((t % w) + 0.5);
    py.push(Math.floor(t / w) + 0.5);
  }
  if (reached && pointGoal) {
    if (px.length === 1) {
      px.push(gx);
      py.push(gy);
    } else {
      px[px.length - 1] = gx;
      py[py.length - 1] = gy;
    }
  }
  return { waypoints: stringPull(grid, px, py), reached, tiles };
}

function ringHas(grid: NavGrid, aux: NavAux, mode: NavMode, spec: GoalSpec, pred: (i: number) => boolean): boolean {
  for (let y = spec.y0; y <= spec.y1; y++) {
    for (let x = spec.x0; x <= spec.x1; x++) {
      if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) continue;
      if (x >= spec.fx0 && x <= spec.fx1 && y >= spec.fy0 && y <= spec.fy1) continue;
      const i = y * grid.w + x;
      if (passableIn(grid, aux, mode, i) && pred(i)) return true;
    }
  }
  return false;
}

/** The tile of component sc with the lowest heuristic to the goal (ties: closer to the goal point, then to the start). */
function nearestReachableTo(grid: NavGrid, comp: Int32Array, sc: number, spec: GoalSpec, gx: number, gy: number, start: number): number {
  const w = grid.w;
  const n = w * grid.h;
  const sx = start % w;
  const sy = Math.floor(start / w);
  const cx = spec.rect ? (spec.fx0 + spec.fx1 + 1) / 2 : gx;
  const cy = spec.rect ? (spec.fy0 + spec.fy1 + 1) / 2 : gy;
  let best = start;
  let bestH = Infinity;
  let bestE = Infinity;
  let bestS = Infinity;
  for (let i = 0; i < n; i++) {
    if (comp[i] !== sc) continue;
    const x = i % w;
    const y = (i - x) / w;
    const h = heuristic(spec, x, y);
    if (h > bestH + 1e-9) continue;
    const e = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    const s = octile(Math.abs(x - sx), Math.abs(y - sy));
    if (h < bestH - 1e-9 || e < bestE - 1e-9 || (Math.abs(e - bestE) <= 1e-9 && s < bestS)) {
      best = i;
      bestH = h;
      bestE = e;
      bestS = s;
    }
  }
  return best;
}

function astar(
  grid: NavGrid,
  aux: NavAux,
  mode: NavMode,
  start: number,
  spec: GoalSpec,
  maxNodes: number,
): { found: boolean; end: number } {
  const w = grid.w;
  const h = grid.h;
  prepare(w * h);
  const stamp = gen;
  const W = weightsFor(aux, mode);
  const sx0 = start % w;
  const sy0 = (start - sx0) / w;
  gScore[start] = 0;
  parent[start] = -1;
  seen[start] = stamp;
  const h0 = heuristic(spec, sx0, sy0);
  heap.push(start, h0 * H_TIE);
  let best = start;
  let bestH = h0;
  let expanded = 0;

  const relax = (c: number, ni: number, nx: number, ny: number, cost: number): void => {
    if (closed[ni] === stamp) return;
    const ng = cost * W[ni] + gScore[c];
    if (seen[ni] !== stamp || ng < gScore[ni]) {
      seen[ni] = stamp;
      gScore[ni] = ng;
      parent[ni] = c;
      heap.push(ni, ng + heuristic(spec, nx, ny) * H_TIE);
    }
  };

  while (heap.size > 0) {
    const c = heap.pop();
    if (closed[c] === stamp) continue;
    closed[c] = stamp;
    const cx = c % w;
    const cy = (c - cx) / w;
    if (isGoal(grid, aux, mode, spec, c, cx, cy)) return { found: true, end: c };
    const hc = heuristic(spec, cx, cy);
    if (hc < bestH || (hc === bestH && gScore[c] < gScore[best])) {
      best = c;
      bestH = hc;
    }
    if (++expanded >= maxNodes) break;
    const okL = cx > 0 && W[c - 1] !== Infinity;
    const okR = cx < w - 1 && W[c + 1] !== Infinity;
    const okU = cy > 0 && W[c - w] !== Infinity;
    const okD = cy < h - 1 && W[c + w] !== Infinity;
    if (okL) relax(c, c - 1, cx - 1, cy, 1);
    if (okR) relax(c, c + 1, cx + 1, cy, 1);
    if (okU) relax(c, c - w, cx, cy - 1, 1);
    if (okD) relax(c, c + w, cx, cy + 1, 1);
    // Diagonals only when both orthogonal neighbours are passable (no corner cutting).
    if (okL && okU && W[c - w - 1] !== Infinity) relax(c, c - w - 1, cx - 1, cy - 1, SQRT2);
    if (okR && okU && W[c - w + 1] !== Infinity) relax(c, c - w + 1, cx + 1, cy - 1, SQRT2);
    if (okL && okD && W[c + w - 1] !== Infinity) relax(c, c + w - 1, cx - 1, cy + 1, SQRT2);
    if (okR && okD && W[c + w + 1] !== Infinity) relax(c, c + w + 1, cx + 1, cy + 1, SQRT2);
  }
  return { found: false, end: best };
}

/** Greedy string pulling over a polyline with a thick walkable line-of-sight check. */
function stringPull(grid: NavGrid, px: number[], py: number[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const last = px.length - 1;
  let a = 0;
  while (a < last) {
    let j = a + 1;
    while (j < last && clearLine(grid, px[a], py[a], px[j + 1], py[j + 1], SMOOTH_CLEARANCE)) j++;
    out.push({ x: px[j], y: py[j] });
    a = j;
  }
  return out;
}
