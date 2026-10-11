/**
 * Pure screen logic (no DOM): run-map layout, traveled path, node states, region labels,
 * Retinue pick helpers and formatting.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStorage, chooseReward, currentReward, defaultMeta, enterNode, finishBattle, generateRunMap, newRun, reachableNodes, setStorageBackend, startBattle } from '../../src/run';
import type { MetaSave, RunState } from '../../src/run/types';
import type { BattleResult, CarriedUnit } from '../../src/sim/types';
import {
  MAP_VB,
  columnRegions,
  currentColumn,
  edgeKey,
  edgePath,
  inkEdgePath,
  nodePos,
  nodeState,
  regionSpans,
  traveledEdges,
  visitedPath,
} from '../../src/app/logic/runmap';
import { bestPicks, canAdd, popOf } from '../../src/app/logic/retinue';
import { fmtTime, roman, signed } from '../../src/app/dom';

function win(objective: BattleResult['objective'], depth: number): BattleResult {
  return {
    outcome: 'victory',
    time: 300,
    objective,
    depth,
    plunderCrowns: 10,
    underPar: true,
    unbroken: false,
    uprooted: false,
    nestsDestroyed: 2,
    picketsDestroyed: 0,
    cachesLooted: 0,
    ancientCacheLooted: false,
    lordSlain: objective === 'elite',
    regentSlain: false,
    lastStandsUsed: 0,
    survivors: [{ type: 'ashpike', rank: 1, kills: 3 }],
    unspent: { grain: 0, timber: 0, ember: 0 },
    stats: { gathered: { grain: 0, timber: 0, ember: 0 }, unitsTrained: 0, unitsLost: 0, kills: 5, buildingsBuilt: 0, buildingsLost: 0 },
  };
}

function clearRewards(run: RunState, meta: MetaSave): void {
  for (let i = 0; i < 8; i++) {
    const s = currentReward(run);
    if (!s) return;
    chooseReward(run, meta, 0, s.kind === 'retinue' ? [] : undefined);
  }
}

describe('run map layout', () => {
  it('places every node inside the viewBox, columns left to right', () => {
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const { map } = generateRunMap(seed);
      const cols = map.columns.length;
      let lastX = -Infinity;
      for (let c = 0; c < cols; c++) {
        const xs = map.columns[c].map((id) => nodePos(map.nodes[id], cols).x);
        const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
        expect(avg).toBeGreaterThan(lastX);
        lastX = avg;
        for (const id of map.columns[c]) {
          const p = nodePos(map.nodes[id], cols);
          expect(p.x).toBeGreaterThan(60);
          expect(p.x).toBeLessThan(MAP_VB.w - 60);
          expect(p.y).toBeGreaterThan(90);
          expect(p.y).toBeLessThan(MAP_VB.h - 90);
        }
      }
      // start and boss sit on the centre line without jitter
      const start = nodePos(map.nodes[map.startId], cols);
      const boss = nodePos(map.nodes[map.bossId], cols);
      expect(start.y).toBeCloseTo(boss.y, 5);
    }
  });

  it('is deterministic per node id', () => {
    const { map } = generateRunMap(5);
    const n = map.nodes[map.columns[3][0]];
    expect(nodePos(n, 8)).toEqual(nodePos(n, 8));
  });

  it('labels columns by their dominant biome with contiguous spans', () => {
    const { map } = generateRunMap(77);
    const regions = columnRegions(map);
    expect(regions).toHaveLength(map.columns.length);
    expect(regions[0]).toBe('greenmarch');
    expect(regions[regions.length - 1]).toBe('heartwood');
    const spans = regionSpans(regions);
    let col = 1;
    for (const s of spans) {
      expect(s.from).toBe(col);
      expect(s.to).toBeGreaterThanOrEqual(s.from);
      col = s.to + 1;
    }
    expect(col - 1).toBe(regions.length);
  });

  it('draws edges as cubic paths between centres', () => {
    expect(edgePath({ x: 0, y: 0 }, { x: 100, y: 50 })).toBe('M0.0 0.0 C50.0 0.0 50.0 50.0 100.0 50.0');
  });

  it('inks edges as a deterministic wobbly polyline that meets both centres', () => {
    const a = { x: 110, y: 380 };
    const b = { x: 310, y: 150 };
    const d = inkEdgePath(a, b, 'c1l1>c2l0');
    expect(d).toBe(inkEdgePath(a, b, 'c1l1>c2l0'));
    expect(d).not.toBe(inkEdgePath(a, b, 'c1l1>c2l3'));
    const pts = d
      .slice(1)
      .split(' L')
      .map((p) => p.split(' ').map(Number));
    expect(pts).toHaveLength(27);
    expect(pts[0]).toEqual([a.x, a.y]);
    expect(pts[pts.length - 1]).toEqual([b.x, b.y]);
    // wobble stays small: every point lies within a few units of the true curve's bounding box
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThan(Math.min(a.x, b.x) - 4);
      expect(x).toBeLessThan(Math.max(a.x, b.x) + 4);
      expect(y).toBeGreaterThan(Math.min(a.y, b.y) - 4);
      expect(y).toBeLessThan(Math.max(a.y, b.y) + 4);
    }
  });
});

describe('run map progress', () => {
  let meta: MetaSave;
  beforeEach(() => {
    setStorageBackend(new MemoryStorage());
    meta = defaultMeta();
  });

  it('tracks the traveled path and node states while walking the road', () => {
    const run = newRun(meta, { house: 'ardent', tier: 0, seed: 31337 });
    clearRewards(run, meta);
    expect(visitedPath(run)).toEqual([]);
    expect(currentColumn(run)).toBe(0);
    let reach = new Set(reachableNodes(run).map((n) => n.id));
    expect([...reach]).toEqual([run.map.startId]);
    expect(nodeState(run, run.map.nodes[run.map.startId], reach)).toBe('reachable');

    // Enter the start battle: it is current (and still reachable until done).
    const entry = enterNode(run, meta, run.map.startId);
    expect(entry.screen).toBe('briefing');
    reach = new Set(reachableNodes(run).map((n) => n.id));
    expect(nodeState(run, run.map.nodes[run.map.startId], reach)).toBe('current');
    expect(reach.has(run.map.startId)).toBe(true);

    startBattle(run, meta, 'muster_hall');
    finishBattle(run, meta, win('raze', 1));
    clearRewards(run, meta);
    expect(traveledEdges(run)).toEqual([]);
    reach = new Set(reachableNodes(run).map((n) => n.id));
    expect(reach.size).toBeGreaterThan(1);

    // Step into column 2: one traveled edge from the start node.
    const next = [...reach][0];
    const e2 = enterNode(run, meta, next);
    expect(traveledEdges(run)).toEqual([edgeKey(run.map.startId, next)]);
    expect(currentColumn(run)).toBe(2);
    expect(visitedPath(run)).toEqual([run.map.startId, next]);
    reach = new Set(reachableNodes(run).map((n) => n.id));
    expect(nodeState(run, run.map.nodes[run.map.startId], reach)).toBe('done');
    // A column-2 sibling that was not taken is now behind the march.
    const sibling = run.map.columns[1].find((id) => id !== next);
    if (sibling) expect(nodeState(run, run.map.nodes[sibling], reach)).toBe('passed');
    // Something in column 5 is still ahead.
    expect(nodeState(run, run.map.nodes[run.map.columns[4][0]], reach)).toBe('future');
    expect(['briefing', 'event', 'camp', 'peddler']).toContain(e2.screen);
  });
});

describe('retinue picks', () => {
  const cands: CarriedUnit[] = [
    { type: 'bowman', rank: 0, kills: 0 },
    { type: 'destrier', rank: 2, kills: 7 },
    { type: 'ashpike', rank: 3, kills: 12 },
    { type: 'ashpike', rank: 1, kills: 4 },
    { type: 'courser', rank: 1, kills: 5 },
    { type: 'gatebreaker', rank: 0, kills: 0 },
  ];

  it('sums pop (Destrier and Gatebreaker are 2 pop)', () => {
    expect(popOf(cands, [1, 5])).toBe(4);
    expect(popOf(cands, [0, 2, 3])).toBe(3);
  });

  it('greedily takes the best veterans within the cap', () => {
    const picks = bestPicks(cands, 6);
    expect(popOf(cands, picks)).toBeLessThanOrEqual(6);
    expect(picks).toContain(2); // Rank III first
    expect(picks).toContain(1); // then Rank II
    expect(picks).toEqual([...picks].sort((a, b) => a - b));
    expect(bestPicks(cands, 0)).toEqual([]);
    expect(popOf(cands, bestPicks(cands, 100))).toBe(popOf(cands, cands.map((_, i) => i)));
  });

  it('refuses additions that break the cap but always allows removal', () => {
    const picks = new Set([1, 2, 3, 4]); // 2 + 1 + 1 + 1 = 5
    expect(canAdd(cands, picks, 0, 6)).toBe(true);
    expect(canAdd(cands, picks, 5, 6)).toBe(false);
    expect(canAdd(cands, picks, 1, 6)).toBe(true);
  });
});

describe('formatting', () => {
  it('formats clocks, numerals and signs', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(65.9)).toBe('1:05');
    expect(fmtTime(360)).toBe('6:00');
    expect(roman(8)).toBe('VIII');
    expect(signed(3)).toBe('+3');
    expect(signed(-2)).toBe('−2');
    expect(signed(0)).toBe('0');
  });
});
