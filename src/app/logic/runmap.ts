/**
 * Pure run-map presentation logic (no DOM): node layout, traveled path, node states, region labels.
 */
import type { BiomeId } from '../../sim/types';
import type { RunMap, RunNode, RunState } from '../../run/types';

export const MAP_VB = { w: 1600, h: 760 };
const MARGIN_X = 110;
const TOP_Y = 150;
const LANE_DY = 158;

/** Deterministic hash for small cosmetic jitter. */
function hash(str: string): number {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) {
    x ^= str.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

export function columnX(col: number, cols: number): number {
  const span = MAP_VB.w - MARGIN_X * 2;
  return MARGIN_X + ((col - 1) * span) / Math.max(1, cols - 1);
}

export function laneY(lane: number): number {
  return TOP_Y + lane * LANE_DY;
}

/** Node center in viewBox units (with a small deterministic jitter for an inked, hand-placed look). */
export function nodePos(node: RunNode, cols: number): { x: number; y: number } {
  const hv = hash(node.id);
  const isEnd = node.type === 'boss' || node.col === 1;
  const jx = isEnd ? 0 : ((hv & 0xff) / 255 - 0.5) * 34;
  const jy = isEnd ? 0 : (((hv >> 8) & 0xff) / 255 - 0.5) * 30;
  return { x: columnX(node.col, cols) + jx, y: laneY(node.lane) + jy };
}

/** Visited node ids in order (nodesDone, then the current node if not done yet). */
export function visitedPath(run: RunState): string[] {
  const out = [...run.nodesDone];
  if (run.currentNode && !out.includes(run.currentNode)) out.push(run.currentNode);
  return out;
}

export function edgeKey(a: string, b: string): string {
  return `${a}>${b}`;
}

/** Traveled edges, in order: consecutive visited nodes that are linked on the map. */
export function traveledEdges(run: RunState): string[] {
  const path = visitedPath(run);
  const out: string[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = run.map.nodes[path[i - 1]];
    if (a && a.next.includes(path[i])) out.push(edgeKey(path[i - 1], path[i]));
  }
  return out;
}

export type NodeState = 'current' | 'done' | 'reachable' | 'future' | 'passed';

export function nodeState(run: RunState, node: RunNode, reachable: ReadonlySet<string>): NodeState {
  if (run.currentNode === node.id) return 'current';
  if (run.nodesDone.includes(node.id)) return 'done';
  if (reachable.has(node.id)) return 'reachable';
  const cur = run.currentNode ? run.map.nodes[run.currentNode] : null;
  if (cur && node.col <= cur.col) return 'passed';
  return 'future';
}

const DEFAULT_REGION: Record<number, BiomeId | 'road'> = {
  1: 'greenmarch',
  2: 'greenmarch',
  3: 'fenreach',
  4: 'fenreach',
  5: 'ashwood',
  6: 'ashwood',
  7: 'road',
  8: 'heartwood',
};

/** Dominant biome per column (battle nodes), falling back to the GDD's column bands. */
export function columnRegions(map: RunMap): (BiomeId | 'road')[] {
  const out: (BiomeId | 'road')[] = [];
  for (let c = 0; c < map.columns.length; c++) {
    const counts = new Map<BiomeId, number>();
    for (const id of map.columns[c]) {
      const b = map.nodes[id]?.battle?.biome;
      if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    let best: BiomeId | 'road' = DEFAULT_REGION[c + 1] ?? 'road';
    let bestN = 0;
    for (const [b, n] of counts) {
      if (n > bestN) {
        best = b;
        bestN = n;
      }
    }
    out.push(best);
  }
  return out;
}

/** Contiguous runs of the same region: [region, firstCol, lastCol] (1-based columns). */
export function regionSpans(regions: (BiomeId | 'road')[]): { region: BiomeId | 'road'; from: number; to: number }[] {
  const spans: { region: BiomeId | 'road'; from: number; to: number }[] = [];
  regions.forEach((r, i) => {
    const last = spans[spans.length - 1];
    if (last && last.region === r) last.to = i + 1;
    else spans.push({ region: r, from: i + 1, to: i + 1 });
  });
  return spans;
}

/** Cubic edge path between two node centers (horizontal tangents). */
export function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = (b.x - a.x) * 0.5;
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${(a.x + dx).toFixed(1)} ${a.y.toFixed(1)} ${(b.x - dx).toFixed(1)} ${b.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

/**
 * Hand-inked edge: the same cubic as edgePath, sampled into a polyline with a small deterministic
 * wobble along the normal (tapering to zero at both ends so it meets the node centres exactly).
 * Replaces an SVG turbulence filter, which is far too expensive to re-rasterize under animation.
 */
export function inkEdgePath(a: { x: number; y: number }, b: { x: number; y: number }, seedKey: string, amp = 2.4, samples = 26): string {
  const hv = hash(seedKey);
  const p1 = ((hv & 0xff) / 255) * Math.PI * 2;
  const p2 = (((hv >> 8) & 0xff) / 255) * Math.PI * 2;
  const f1 = 1.5 + ((hv >> 16) & 0x7) * 0.25;
  const f2 = 3.2 + ((hv >> 19) & 0x7) * 0.3;
  const dx = (b.x - a.x) * 0.5;
  const c1 = { x: a.x + dx, y: a.y };
  const c2 = { x: b.x - dx, y: b.y };
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const mt = 1 - t;
    const x = mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x;
    const y = mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y;
    // derivative for the normal
    const tx = 3 * mt * mt * (c1.x - a.x) + 6 * mt * t * (c2.x - c1.x) + 3 * t * t * (b.x - c2.x);
    const ty = 3 * mt * mt * (c1.y - a.y) + 6 * mt * t * (c2.y - c1.y) + 3 * t * t * (b.y - c2.y);
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const w = amp * Math.sin(Math.PI * t) * (0.6 * Math.sin(t * f1 * Math.PI * 2 + p1) + 0.4 * Math.sin(t * f2 * Math.PI * 2 + p2));
    pts.push(`${(x + nx * w).toFixed(1)} ${(y + ny * w).toFixed(1)}`);
  }
  return `M${pts.join(' L')}`;
}

/** Highest column index reached (for display). */
export function currentColumn(run: RunState): number {
  const cur = run.currentNode ? run.map.nodes[run.currentNode] : null;
  return cur ? cur.col : 0;
}
