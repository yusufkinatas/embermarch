import { describe, expect, it } from 'vitest';
import { flowFieldBuildCount, flowNextTile, flowStep, getFlowField } from '../../src/sim/nav/flowfield';
import { setFootprint } from '../../src/sim/nav/grid';
import type { World } from '../../src/sim/types';
import type { FlowField } from '../../src/sim/nav/flowfield';
import { addBuilding, makeWorld, randomObstacleMap } from './helpers';

/** Every reachable non-goal tile has a usable neighbour with strictly lower cost; following it reaches a goal. */
function assertMonotonic(world: World, field: FlowField): void {
  const g = world.grid;
  const n = g.w * g.h;
  let checked = 0;
  for (let t = 0; t < n; t++) {
    const c = field.cost[t];
    if (c === 0 || c === Infinity) continue;
    const next = flowNextTile(world, field, t);
    expect(next).toBeGreaterThanOrEqual(0);
    expect(field.cost[next]).toBeLessThan(c);
    // No corner cutting on diagonal steps (player mode: both orthogonals walkable).
    const ax = t % g.w;
    const ay = Math.floor(t / g.w);
    const bx = next % g.w;
    const by = Math.floor(next / g.w);
    if (field.mode === 'player' && ax !== bx && ay !== by) {
      expect(g.blocked[ay * g.w + bx]).toBe(0);
      expect(g.blocked[by * g.w + ax]).toBe(0);
    }
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
  // Walk from a far tile to the goal.
  let t = -1;
  let worst = 0;
  for (let i = 0; i < n; i++) if (field.cost[i] < Infinity && field.cost[i] > worst) worst = field.cost[(t = i)];
  let steps = 0;
  while (field.cost[t] > 0 && steps < n) {
    t = flowNextTile(world, field, t);
    steps++;
  }
  expect(field.cost[t]).toBe(0);
}

describe('flow fields', () => {
  it('integrates a monotonic Dijkstra field toward the goal', () => {
    const world = makeWorld(randomObstacleMap(40, 40, 5));
    const goal = 20 * 40 + 20;
    world.grid.blocked[goal] = 0;
    const f = getFlowField(world, 'g', [goal], 'player');
    expect(f.cost[goal]).toBe(0);
    expect(f.version).toBe(world.grid.version);
    assertMonotonic(world, f);
    // Open neighbours: orthogonal 1, diagonal sqrt2.
    const open = makeWorld(Array.from({ length: 5 }, () => '.....'));
    const f2 = getFlowField(open, 'c', [12], 'player');
    expect(f2.cost[13]).toBeCloseTo(1);
    expect(f2.cost[18]).toBeCloseTo(Math.SQRT2);
    expect(f2.cost[0]).toBeCloseTo(2 * Math.SQRT2);
  });

  it('flowStep returns the next tile center, null at the goal', () => {
    const world = makeWorld(Array.from({ length: 5 }, () => '.....'));
    const f = getFlowField(world, 'k', [2 * 5 + 4], 'player');
    const s = flowStep(world, f, 0.5, 2.5)!;
    expect(s).toEqual({ x: 1.5, y: 2.5, tile: 2 * 5 + 1 });
    expect(flowStep(world, f, 4.5, 2.5)).toBeNull();
  });

  it('caches by key, rebuilds after grid changes with a 0.5 s debounce', () => {
    const rows = ['..........', '..........', '..........', '..........', '..........'];
    const world = makeWorld(rows);
    const goal = 2 * 10 + 9;
    const before = flowFieldBuildCount();
    const f = getFlowField(world, 'wave', [goal], 'player');
    expect(getFlowField(world, 'wave', [goal], 'player')).toBe(f);
    expect(flowFieldBuildCount()).toBe(before + 1);
    const oldCost = f.cost[2 * 10 + 0];

    // Wall across the middle with a gap at the top row.
    world.tick = 3;
    for (let y = 1; y < 5; y++) setFootprint(world, 5, y, 1, 1, 100 + y);
    const stale = getFlowField(world, 'wave', [goal], 'player');
    expect(stale.version).not.toBe(world.grid.version); // debounced
    expect(flowFieldBuildCount()).toBe(before + 1);

    world.tick = 3 + 10;
    const fresh = getFlowField(world, 'wave', [goal], 'player');
    expect(fresh.version).toBe(world.grid.version);
    expect(fresh.cost[2 * 10 + 5]).toBe(Infinity);
    expect(fresh.cost[2 * 10 + 0]).toBeGreaterThan(oldCost);
    assertMonotonic(world, fresh);
    // The route now detours through the gap at y = 0.
    let t = 2 * 10 + 0;
    const visited: number[] = [];
    while (fresh.cost[t] > 0) {
      t = flowNextTile(world, fresh, t);
      visited.push(t);
    }
    expect(visited.some((v) => Math.floor(v / 10) === 0 && v % 10 === 5)).toBe(true);
  });

  it('rebuilds immediately when new goal tiles are requested, reuses for subsets', () => {
    const world = makeWorld(Array.from({ length: 6 }, () => '......'));
    const f = getFlowField(world, 'grp', [7, 8], 'player');
    const n0 = flowFieldBuildCount();
    getFlowField(world, 'grp', [8], 'player');
    expect(flowFieldBuildCount()).toBe(n0);
    const f2 = getFlowField(world, 'grp', [30], 'player');
    expect(flowFieldBuildCount()).toBe(n0 + 1);
    expect(f2.cost[30]).toBe(0);
    expect(f2.goalTiles).toEqual([30]);
    expect(f2).toBe(f);
  });

  it('enemy mode crosses player buildings at cost 12 per tile', () => {
    const rows = ['#######', '.......', '#######'];
    const world = makeWorld(rows);
    const cot = addBuilding(world, 'thornspire', 0, 3, 1); // 1x1 footprint, owner PLAYER for the test
    const goal = 1 * 7 + 6;
    const pf = getFlowField(world, 'p', [goal], 'player');
    expect(pf.cost[1 * 7 + 0]).toBe(Infinity);
    const ef = getFlowField(world, 'p', [goal], 'enemy');
    expect(ef.mode).toBe('enemy');
    // Tiles 6..4 cost 0,1,2; entering the building tile costs 12; tile 2 costs 2 + 12.
    expect(ef.cost[1 * 7 + 4]).toBeCloseTo(2);
    expect(ef.cost[1 * 7 + 3]).toBeCloseTo(3);
    expect(ef.cost[1 * 7 + 2]).toBeCloseTo(15);
    const step = flowStep(world, ef, 2.5, 1.5)!;
    expect(world.grid.occupant[step.tile]).toBe(cot.id);
    assertMonotonic(world, ef);
  });

  it('goal tiles inside a footprint lead units to its edge (player mode)', () => {
    const world = makeWorld(Array.from({ length: 9 }, () => '.........'));
    const b = addBuilding(world, 'muster_hall', 0, 3, 3);
    const tiles: number[] = [];
    for (let y = b.ty; y < b.ty + b.h; y++) for (let x = b.tx; x < b.tx + b.w; x++) tiles.push(y * 9 + x);
    const f = getFlowField(world, 'hall', tiles, 'player');
    expect(f.cost[2 * 9 + 4]).toBeCloseTo(1);
    expect(f.cost[0]).toBeLessThan(Infinity);
    assertMonotonic(world, f);
  });
});
