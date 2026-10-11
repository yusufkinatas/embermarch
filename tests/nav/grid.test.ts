import { describe, expect, it } from 'vitest';
import { closestPointOn, distToEntity, edgeDistance } from '../../src/sim/nav/geometry';
import { createNavGrid, isWalkable, onTerrainChanged, setFootprint } from '../../src/sim/nav/grid';
import { nearestUnit, queryUnits, rebuildSpatial } from '../../src/sim/nav/spatial';
import { Terrain } from '../../src/sim/types';
import { addBuilding, addUnit, makeWorld, mapFromAscii } from './helpers';

describe('nav grid', () => {
  it('builds passability and speed from terrain (GDD §K)', () => {
    const map = mapFromAscii(['.,~#TsB']);
    map.terrain[4] = Terrain.Forest;
    const g = createNavGrid(map);
    expect(Array.from(g.blocked)).toEqual([0, 0, 1, 1, 1, 0, 1]);
    expect(g.speedMul[1]).toBeCloseTo(0.6);
    expect(g.speedMul[0]).toBe(1);
    expect(g.speedMul[5]).toBe(1);
    expect(g.version).toBe(0);
  });

  it('treats a forest tile without timber as walkable', () => {
    const map = mapFromAscii(['T.']);
    map.treeAmount[0] = 0;
    expect(createNavGrid(map).blocked[0]).toBe(0);
  });

  it('setFootprint marks and clears occupancy and bumps the version', () => {
    const world = makeWorld(['......', '..~...', '......']);
    const v0 = world.grid.version;
    setFootprint(world, 1, 0, 3, 3, 42);
    expect(world.grid.version).toBe(v0 + 1);
    expect(world.grid.occupant[0 * 6 + 1]).toBe(42);
    expect(world.grid.blocked[2 * 6 + 3]).toBe(1);
    setFootprint(world, 1, 0, 3, 3, 0);
    expect(world.grid.version).toBe(v0 + 2);
    expect(world.grid.occupant[0 * 6 + 1]).toBe(0);
    expect(world.grid.blocked[0 * 6 + 1]).toBe(0);
    // Terrain underneath stays blocked after clearing.
    expect(world.grid.blocked[1 * 6 + 2]).toBe(1);
  });

  it('clips footprints at the map edge', () => {
    const world = makeWorld(['...', '...']);
    setFootprint(world, 2, 1, 3, 3, 7);
    expect(world.grid.occupant[1 * 3 + 2]).toBe(7);
    expect(Array.from(world.grid.occupant).filter((v) => v === 7).length).toBe(1);
  });

  it('onTerrainChanged turns a felled tree into a walkable stump', () => {
    const world = makeWorld(['.T.']);
    expect(isWalkable(world.grid, 1, 0)).toBe(false);
    world.map.treeAmount[1] = 0;
    const v = world.grid.version;
    onTerrainChanged(world, 1);
    expect(world.map.terrain[1]).toBe(Terrain.Stump);
    expect(isWalkable(world.grid, 1, 0)).toBe(true);
    expect(world.grid.version).toBe(v + 1);
    expect(world.dirtyTiles).toEqual([1]);
    onTerrainChanged(world, 1);
    expect(world.dirtyTiles).toEqual([1]);
  });

  it('onTerrainChanged keeps a static occupant blocked', () => {
    const world = makeWorld(['.T.']);
    setFootprint(world, 1, 0, 1, 1, 9);
    world.map.treeAmount[1] = 0;
    onTerrainChanged(world, 1);
    expect(world.grid.blocked[1]).toBe(1);
  });
});

describe('geometry', () => {
  it('measures edge distances for units and footprints', () => {
    const world = makeWorld(Array.from({ length: 10 }, () => '..........'));
    const a = addUnit(world, 'ashpike', 0, 1, 1);
    const b = addUnit(world, 'ashpike', 0, 3, 1);
    const hall = addBuilding(world, 'muster_hall', 0, 5, 5);
    expect(edgeDistance(a, b)).toBeCloseTo(2 - 0.6);
    expect(edgeDistance(b, a)).toBeCloseTo(2 - 0.6);
    const c = addUnit(world, 'bowman', 0, 4, 6.5);
    expect(edgeDistance(c, hall)).toBeCloseTo(1 - 0.3);
    expect(edgeDistance(hall, c)).toBeCloseTo(1 - 0.3);
    expect(distToEntity(4, 6.5, hall)).toBeCloseTo(1);
    expect(distToEntity(3, 1, a)).toBeCloseTo(2 - 0.3);
    const p = closestPointOn(hall, 0, 0);
    expect(p).toEqual({ x: 5, y: 5 });
    const q = closestPointOn(a, 3, 1);
    expect(q.x).toBeCloseTo(1.3);
    expect(q.y).toBeCloseTo(1);
    const other = addBuilding(world, 'cottage', 0, 0, 7);
    expect(edgeDistance(hall, other)).toBeCloseTo(3);
  });
});

describe('spatial hash', () => {
  it('queries units by radius and finds the nearest with a predicate', () => {
    const world = makeWorld(Array.from({ length: 20 }, () => '.'.repeat(20)));
    const a = addUnit(world, 'tiller', 0, 2, 2);
    const b = addUnit(world, 'ashpike', 0, 5, 2);
    const c = addUnit(world, 'thornling', 1, 9, 9);
    const dead = addUnit(world, 'thornling', 1, 2.5, 2);
    dead.alive = false;
    rebuildSpatial(world);
    expect(world.spatial.cells.flat()).not.toContain(dead.id);
    expect(queryUnits(world, 2, 2, 3.1).map((u) => u.id).sort()).toEqual([a.id, b.id]);
    expect(queryUnits(world, 2, 2, 3.1, (u) => u.owner === 1)).toEqual([]);
    expect(nearestUnit(world, 0, 0, 30)?.id).toBe(a.id);
    expect(nearestUnit(world, 0, 0, 30, (u) => u.owner === 1)?.id).toBe(c.id);
    expect(nearestUnit(world, 0, 0, 2)).toBeNull();
    expect(nearestUnit(world, 19, 19, Infinity)?.id).toBe(c.id);
  });
});
