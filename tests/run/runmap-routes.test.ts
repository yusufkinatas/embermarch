/**
 * Route choice on the run map: real decisions on every path, and Elites that can always be
 * sidestepped one step at a time. Metrics are computed independently of the generator's DP.
 */
import { describe, expect, it } from 'vitest';
import { generateRunMap } from '../../src/run';
import { elitesAvoidable } from '../../src/run/runmap';
import type { RunMap } from '../../src/run/types';

function allPaths(map: RunMap): string[][] {
  const out: string[][] = [];
  const walk = (id: string, path: string[]) => {
    const p = [...path, id];
    if (id === map.bossId) {
      out.push(p);
      return;
    }
    for (const nx of map.nodes[id].next) walk(nx, p);
  };
  walk(map.startId, []);
  return out;
}

/** Decisions on a path: nodes in cols 1-6 with 2+ next. */
function decisions(map: RunMap, path: string[]): number {
  return path.filter((id) => map.nodes[id].col <= 6 && map.nodes[id].next.length >= 2).length;
}

/** Longest run of single-exit nodes among cols 2-6 on a path. */
function longestSingleRun(map: RunMap, path: string[]): number {
  let run = 0;
  let best = 0;
  for (const id of path) {
    const n = map.nodes[id];
    if (n.col < 2 || n.col > 6) continue;
    run = n.next.length === 1 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** True if every route out of a node runs into an Elite. */
function forcesElite(map: RunMap, id: string, memo = new Map<string, boolean>()): boolean {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;
  const n = map.nodes[id];
  const v = n.type === 'elite' ? true : n.type === 'boss' ? false : n.next.every((nx) => forcesElite(map, nx, memo));
  memo.set(id, v);
  return v;
}

describe('run map route choice', () => {
  it('1000 maps: ≥ 3.6 decisions per path, few thin paths, Elites always avoidable, rare fallbacks', () => {
    const N = 1000;
    let paths = 0;
    let decisionSum = 0;
    let thin = 0;
    let layoutFallbacks = 0;
    let typeFallbacks = 0;
    const problems: string[] = [];
    for (let i = 1; i <= N; i++) {
      const seed = (i * 2654435761) >>> 0;
      const g = generateRunMap(seed);
      if (g.layoutFallback) layoutFallbacks++;
      if (g.typeFallback) typeFallbacks++;
      const map = g.map;
      const ps = allPaths(map);
      let mapDecisions = 0;
      for (const p of ps) {
        const d = decisions(map, p);
        mapDecisions += d;
        decisionSum += d;
        paths++;
        if (d <= 2) thin++;
        if (!g.layoutFallback && longestSingleRun(map, p) > 2) problems.push(`seed ${seed}: 3+ single-exit nodes in a row on ${p.join('→')}`);
      }
      if (g.layoutFallback || g.typeFallback) continue;
      if (mapDecisions / ps.length < 3.6) problems.push(`seed ${seed}: ${(mapDecisions / ps.length).toFixed(2)} decisions per path`);
      if (!elitesAvoidable(map)) problems.push(`seed ${seed}: a node leads only into Elites`);
      const memo = new Map<string, boolean>();
      for (const n of Object.values(map.nodes)) {
        if (n.col >= 1 && n.col <= 6 && n.type !== 'elite' && forcesElite(map, n.id, memo)) problems.push(`seed ${seed}: ${n.id} forces an Elite`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(decisionSum / paths).toBeGreaterThanOrEqual(3.6);
    expect(thin / paths).toBeLessThanOrEqual(0.12);
    expect(layoutFallbacks / N).toBeLessThanOrEqual(0.02);
    expect(typeFallbacks / N).toBeLessThanOrEqual(0.02);
  });

  it('the fixed fallback pattern places its Elite where it can be sidestepped', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(elitesAvoidable(generateRunMap(seed, { forceFallback: { layout: true, types: true } }).map)).toBe(true);
    }
  });

  it('elitesAvoidable flags a node whose only exits are Elites', () => {
    const { map } = generateRunMap(4004);
    expect(elitesAvoidable(map)).toBe(true);
    const node = Object.values(map.nodes).find((n) => n.col >= 2 && n.col <= 4 && n.next.length >= 1)!;
    for (const nx of node.next) map.nodes[nx].type = 'elite';
    expect(elitesAvoidable(map)).toBe(false);
  });
});
