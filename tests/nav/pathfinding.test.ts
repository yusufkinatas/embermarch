import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { lineWalkable } from '../../src/sim/nav/los';
import { findPath, findPathEx, isReachable } from '../../src/sim/nav/pathfinding';
import type { World } from '../../src/sim/types';
import { addBuilding, makeWorld, randomObstacleMap } from './helpers';

/** No diagonal step in a raw tile path may cut a blocked orthogonal corner. */
function assertNoCornerCutting(world: World, tiles: number[], allowBuildings = false): void {
  const g = world.grid;
  const ok = (i: number): boolean => g.blocked[i] === 0 || (allowBuildings && g.occupant[i] > 0);
  for (let k = 1; k < tiles.length; k++) {
    const ax = tiles[k - 1] % g.w;
    const ay = Math.floor(tiles[k - 1] / g.w);
    const bx = tiles[k] % g.w;
    const by = Math.floor(tiles[k] / g.w);
    expect(Math.max(Math.abs(ax - bx), Math.abs(ay - by))).toBe(1);
    expect(ok(tiles[k])).toBe(true);
    if (ax !== bx && ay !== by) {
      expect(ok(ay * g.w + bx)).toBe(true);
      expect(ok(by * g.w + ax)).toBe(true);
    }
  }
}

/** Every leg of the smoothed path (from the start) is a walkable straight line. */
function assertLegsWalkable(world: World, sx: number, sy: number, wps: { x: number; y: number }[]): void {
  let x = sx;
  let y = sy;
  for (const p of wps) {
    expect(lineWalkable(world.grid, x, y, p.x, p.y)).toBe(true);
    x = p.x;
    y = p.y;
  }
}

function pathLength(sx: number, sy: number, wps: { x: number; y: number }[]): number {
  let len = 0;
  let x = sx;
  let y = sy;
  for (const p of wps) {
    len += Math.hypot(p.x - x, p.y - y);
    x = p.x;
    y = p.y;
  }
  return len;
}

describe('A* pathfinding', () => {
  it('never cuts corners diagonally (GDD §F c)', () => {
    const world = makeWorld(['.#..', '....', '....']);
    const r = findPathEx(world, 0.5, 0.5, 1.5, 1.5)!;
    expect(r.reached).toBe(true);
    // (0,0) -> (1,1) diagonal is illegal because (1,0) is rock: must go through (0,1).
    expect(r.tiles).toEqual([0, 4, 5]);
    assertLegsWalkable(world, 0.5, 0.5, r.waypoints);
    expect(r.waypoints).toEqual([
      { x: 0.5, y: 1.5 },
      { x: 1.5, y: 1.5 },
    ]);
  });

  it('does not squeeze through a diagonal gap between two blocked tiles', () => {
    const world = makeWorld(['.#.', '#..', '...']);
    // (0,0) is sealed: its only exits are diagonal through a gap -> unreachable.
    const r = findPathEx(world, 0.5, 0.5, 2.5, 2.5)!;
    expect(r.reached).toBe(false);
    expect(r.waypoints).toEqual([]);
  });

  it('paths around walls with walkable legs', () => {
    const rows = [
      '............',
      '............',
      '.....#......',
      '.....#......',
      '.....#......',
      '.....#......',
      '.....#......',
      '............',
    ];
    const world = makeWorld(rows);
    const r = findPathEx(world, 2.5, 4.5, 8.5, 4.5)!;
    expect(r.reached).toBe(true);
    assertNoCornerCutting(world, r.tiles);
    assertLegsWalkable(world, 2.5, 4.5, r.waypoints);
    const last = r.waypoints[r.waypoints.length - 1];
    expect(last).toEqual({ x: 8.5, y: 4.5 });
    // String pulling keeps it short: a couple of corner waypoints, not one per tile.
    expect(r.waypoints.length).toBeLessThanOrEqual(4);
    const len = pathLength(2.5, 4.5, r.waypoints);
    expect(len).toBeGreaterThan(6);
    expect(len).toBeLessThan(10);
  });

  it('ends exactly at the goal point inside the goal tile', () => {
    const world = makeWorld(['......', '......']);
    const wps = findPath(world, 0.2, 0.3, 4.9, 1.7)!;
    expect(wps[wps.length - 1]).toEqual({ x: 4.9, y: 1.7 });
    expect(wps.length).toBe(1);
  });

  it('falls back to the reachable tile with the lowest heuristic (GDD §F b)', () => {
    const rows = [
      '..........',
      '...#####..',
      '...#...#..',
      '...#...#..',
      '...#####..',
      '..........',
    ];
    const world = makeWorld(rows);
    const r = findPathEx(world, 0.5, 5.5, 5.5, 2.5)!;
    expect(r.reached).toBe(false);
    // The outside tile closest (octile) to the goal tile (5,2) is (5,0) at distance 2.
    expect(r.tiles[r.tiles.length - 1]).toBe(0 * 10 + 5);
    assertNoCornerCutting(world, r.tiles);
    assertLegsWalkable(world, 0.5, 5.5, r.waypoints);
    expect(isReachable(world, 0.5, 5.5, 5.5, 2.5)).toBe(false);
    expect(isReachable(world, 0.5, 5.5, 9.5, 0.5)).toBe(true);
  });

  it('uses the node budget as a guard and still returns the best partial path', () => {
    const world = makeWorld(randomObstacleMap(64, 64, 7));
    const r = findPathEx(world, 1.5, 1.5, 62.5, 62.5, { maxNodes: 50 })!;
    expect(r.reached).toBe(false);
    expect(r.tiles.length).toBeGreaterThan(1);
    assertNoCornerCutting(world, r.tiles);
  });

  it('returns null for an invalid start and steps out of a blocked start tile', () => {
    const world = makeWorld(['....', '.##.', '....']);
    expect(findPath(world, -3, 0.5, 2.5, 0.5)).toBeNull();
    const r = findPathEx(world, 1.5, 1.5, 3.5, 2.5)!;
    expect(r).not.toBeNull();
    expect(r.reached).toBe(true);
    const first = r.waypoints[0];
    expect(world.grid.blocked[Math.floor(first.y) * 4 + Math.floor(first.x)]).toBe(0);
  });

  it('goalRect: the path ends on a walkable tile adjacent to the footprint', () => {
    const world = makeWorld(Array.from({ length: 12 }, () => '............'));
    const hall = addBuilding(world, 'muster_hall', 0, 6, 6);
    const r = findPathEx(world, 0.5, 0.5, hall.x, hall.y, { goalRect: { tx: hall.tx, ty: hall.ty, w: hall.w, h: hall.h } })!;
    expect(r.reached).toBe(true);
    const end = r.tiles[r.tiles.length - 1];
    const ex = end % 12;
    const ey = Math.floor(end / 12);
    expect(world.grid.blocked[end]).toBe(0);
    const inRing = ex >= 5 && ex <= 9 && ey >= 5 && ey <= 9 && !(ex >= 6 && ex <= 8 && ey >= 6 && ey <= 8);
    expect(inRing).toBe(true);
    expect(ex === 5 || ey === 5).toBe(true); // approached from the start's side
    // Already adjacent: nothing to walk.
    const r2 = findPathEx(world, 5.5, 7.5, hall.x, hall.y, { goalRect: { tx: 6, ty: 6, w: 3, h: 3 } })!;
    expect(r2.reached).toBe(true);
    expect(r2.waypoints).toEqual([]);
  });

  it("enemy mode passes player buildings at cost 12; player mode can't", () => {
    // A 3-tall corridor sealed by a 3x3 player building at x 9-11.
    const rows = [
      '####################',
      '.........###........',
      '....................',
      '....................',
      '....................',
      '.........###........',
      '####################',
    ];
    const world = makeWorld(rows);
    addBuilding(world, 'muster_hall', 0, 9, 2);
    const p = findPathEx(world, 1.5, 3.5, 18.5, 3.5, { mode: 'player' })!;
    expect(p.reached).toBe(false);
    const e = findPathEx(world, 1.5, 3.5, 18.5, 3.5, { mode: 'enemy' })!;
    expect(e.reached).toBe(true);
    assertNoCornerCutting(world, e.tiles, true);
    const throughBuilding = e.tiles.filter((t) => world.grid.occupant[t] > 0).length;
    expect(throughBuilding).toBe(3);
    // The waypoints keep the building tiles (no smoothing across walls).
    expect(e.waypoints.some((w) => world.grid.occupant[Math.floor(w.y) * 20 + Math.floor(w.x)] > 0)).toBe(true);
  });

  it('enemy mode weighs a building at 12 per tile against the walking detour', () => {
    // A 3-tall corridor sealed by a 3x3 player building; a channel of height H loops around it.
    // Through the building: 3 tiles x 12 ~ 37. Detour: ~ 2H + 6.
    const detourWorld = (H: number): World => {
      const rows = ['#'.repeat(20), '#######.......######'];
      for (let k = 1; k < H; k++) rows.push('#######.#####.######');
      rows.push('.'.repeat(20), '.'.repeat(20), '.'.repeat(20), '#'.repeat(20));
      const world = makeWorld(rows);
      addBuilding(world, 'muster_hall', 0, 9, H + 1);
      return world;
    };
    const near = detourWorld(2);
    const e = findPathEx(near, 1.5, 4.5, 18.5, 4.5, { mode: 'enemy' })!;
    expect(e.reached).toBe(true);
    expect(e.tiles.some((t) => near.grid.occupant[t] > 0)).toBe(false);
    const far = detourWorld(20);
    const e2 = findPathEx(far, 1.5, 22.5, 18.5, 22.5, { mode: 'enemy' })!;
    expect(e2.reached).toBe(true);
    expect(e2.tiles.some((t) => far.grid.occupant[t] > 0)).toBe(true);
    // Player mode always takes the detour.
    const p2 = findPathEx(far, 1.5, 22.5, 18.5, 22.5, { mode: 'player' })!;
    expect(p2.reached).toBe(true);
    expect(p2.tiles.some((t) => far.grid.occupant[t] > 0)).toBe(false);
  });

  it('enemy mode still treats enemy structures and resources as walls', () => {
    const rows = ['#######', '.......', '#######'];
    const world = makeWorld(rows);
    addBuilding(world, 'thornspire', 1, 3, 1);
    const e = findPathEx(world, 0.5, 1.5, 6.5, 1.5, { mode: 'enemy' })!;
    expect(e.reached).toBe(false);
  });

  it('prefers dry ground over slow shallows when the detour is short', () => {
    const rows = ['..........', '...,,,,...', '..........'];
    const world = makeWorld(rows);
    const r = findPathEx(world, 0.5, 1.5, 9.5, 1.5)!;
    expect(r.reached).toBe(true);
    expect(r.tiles.some((t) => world.map.terrain[t] === 1)).toBe(false);
  });

  it('is fast: 200 random searches on a 64x64 obstacle map', () => {
    const world = makeWorld(randomObstacleMap(64, 64, 1234, 0.25));
    const g = world.grid;
    const rng = new Rng(99);
    const pick = (): [number, number] => {
      for (;;) {
        const x = rng.int(0, 63);
        const y = rng.int(0, 63);
        if (g.blocked[y * 64 + x] === 0) return [x + 0.5, y + 0.5];
      }
    };
    const pairs: [number, number, number, number][] = [];
    for (let i = 0; i < 200; i++) pairs.push([...pick(), ...pick()]);
    // Warm-up (JIT), then measure.
    for (let i = 0; i < 20; i++) findPathEx(world, ...pairs[i]);
    const t0 = performance.now();
    let reached = 0;
    for (const p of pairs) {
      const r = findPathEx(world, ...p)!;
      if (r.reached) reached++;
    }
    const ms = performance.now() - t0;
    expect(reached).toBeGreaterThan(150);
    // Typical < 1 ms per search; generous bound for slow CI machines.
    expect(ms / pairs.length).toBeLessThan(3);
    // Raw tile paths are always legal.
    for (const p of pairs.slice(0, 40)) assertNoCornerCutting(world, findPathEx(world, ...p)!.tiles);
  });
});
