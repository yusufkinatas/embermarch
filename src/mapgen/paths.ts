/** Grid search used by map generation: weighted A* (corridor carving, validation paths) and BFS. */
import { MinHeap } from './heap';
import { SQRT2, octile } from './geom';

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

export interface AStarOpts {
  w: number;
  h: number;
  /** Cost to enter tile i (Infinity = impassable). Must be >= 1 for passable tiles. */
  cost: (i: number) => number;
  start: number;
  isGoal: (i: number) => boolean;
  /** Heuristic target (tile coords). */
  hx: number;
  hy: number;
  /** Disallow diagonal moves past a blocked orthogonal neighbour (unit movement rules). */
  noCornerCut?: boolean;
}

export interface AStarResult {
  /** Tile indices from start to goal (inclusive). */
  path: number[];
  /** Geometric octile length in tiles. */
  length: number;
  /** Accumulated weighted cost. */
  cost: number;
}

export function astar(o: AStarOpts): AStarResult | null {
  const { w, h, cost, start, isGoal, hx, hy } = o;
  const n = w * h;
  const g = new Float64Array(n).fill(Infinity);
  const glen = new Float64Array(n);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  g[start] = 0;
  heap.push(start, octile(hx - (start % w), hy - Math.floor(start / w)));
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (isGoal(cur)) {
      const path: number[] = [];
      for (let c = cur; c !== -1; c = came[c]) path.push(c);
      path.reverse();
      return { path, length: glen[cur], cost: g[cur] };
    }
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k];
      const ny = cy + DY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const c = cost(ni);
      if (c === Infinity) continue;
      const diag = k >= 4;
      if (diag && o.noCornerCut) {
        if (cost(cy * w + nx) === Infinity || cost(ny * w + cx) === Infinity) continue;
      }
      const step = diag ? SQRT2 : 1;
      const ng = g[cur] + c * step;
      if (ng < g[ni]) {
        g[ni] = ng;
        glen[ni] = glen[cur] + step;
        came[ni] = cur;
        heap.push(ni, ng + octile(hx - nx, hy - ny));
      }
    }
  }
  return null;
}

/** 4-connected flood fill over `passable` from the start tiles. Returns 1 for reached tiles. */
export function floodFill(w: number, h: number, passable: (i: number) => boolean, starts: readonly number[]): Uint8Array {
  const n = w * h;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (const s of starts) {
    if (s >= 0 && s < n && !seen[s] && passable(s)) {
      seen[s] = 1;
      queue[tail++] = s;
    }
  }
  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DX[k];
      const ny = cy + DY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni] || !passable(ni)) continue;
      seen[ni] = 1;
      queue[tail++] = ni;
    }
  }
  return seen;
}

/** Tiles sharing an edge with the w×h rect at (tx, ty), clipped to the map. */
export function edgeRing(mapW: number, mapH: number, tx: number, ty: number, w: number, h: number): number[] {
  const out: number[] = [];
  for (let x = tx; x < tx + w; x++) {
    if (ty - 1 >= 0) out.push((ty - 1) * mapW + x);
    if (ty + h < mapH) out.push((ty + h) * mapW + x);
  }
  for (let y = ty; y < ty + h; y++) {
    if (tx - 1 >= 0) out.push(y * mapW + tx - 1);
    if (tx + w < mapW) out.push(y * mapW + tx + w);
  }
  return out;
}

/** Multi-source 8-connected BFS distance (Chebyshev steps) from the source tiles; 65535 = unreached. */
export function chebyshevField(w: number, h: number, sources: readonly number[]): Uint16Array {
  const n = w * h;
  const dist = new Uint16Array(n).fill(65535);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (const s of sources) {
    if (dist[s] !== 0) {
      dist[s] = 0;
      queue[tail++] = s;
    }
  }
  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k];
      const ny = cy + DY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] !== 65535) continue;
      dist[ni] = dist[cur] + 1;
      queue[tail++] = ni;
    }
  }
  return dist;
}

/**
 * Is the straight segment (ax, ay) → (bx, by) clear for a unit of radius ~0.3?
 * Samples the segment and checks the tiles under a small square around each sample.
 */
export function segmentClear(w: number, h: number, ax: number, ay: number, bx: number, by: number, passable: (i: number) => boolean): boolean {
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(len / 0.2));
  const r = 0.3;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]] as const) {
      const tx = Math.floor(x + ox);
      const ty = Math.floor(y + oy);
      if (tx < 0 || ty < 0 || tx >= w || ty >= h || !passable(ty * w + tx)) return false;
    }
  }
  return true;
}

/**
 * Euclidean length of a tile path after greedy line-of-sight string pulling (how units actually
 * walk). `from` / `to` override the first / last waypoint (e.g. exact footprint centers).
 */
export function smoothedLength(
  w: number,
  h: number,
  path: readonly number[],
  passable: (i: number) => boolean,
  from?: { x: number; y: number },
  to?: { x: number; y: number },
): number {
  if (path.length < 2) return 0;
  const pts = path.map((p) => ({ x: (p % w) + 0.5, y: Math.floor(p / w) + 0.5 }));
  if (from) pts[0] = { x: from.x, y: from.y };
  if (to) pts[pts.length - 1] = { x: to.x, y: to.y };
  let len = 0;
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !segmentClear(w, h, pts[i].x, pts[i].y, pts[j].x, pts[j].y, passable)) j--;
    len += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
    i = j;
  }
  return len;
}
