import { describe, expect, it, vi } from 'vitest';
import { UNITS } from '../../src/data/units';
import { exploreCircle, updateFog } from '../../src/sim/nav/fog';
import { Fog } from '../../src/sim/types';
import type { UnitId } from '../../src/sim/types';
import { addBuilding, addUnit, makeWorld } from './helpers';

// sim-core's composeStats may not exist yet: sight comes straight from the unit table (+1 per rank to prove it is used).
vi.mock('../../src/sim/stats', () => ({
  unitStats: (_w: unknown, _o: number, type: UnitId, rank = 0) => ({ sight: UNITS[type].sight + rank }),
}));

const open = (w: number, h: number): string[] => Array.from({ length: h }, () => '.'.repeat(w));
const at = (world: ReturnType<typeof makeWorld>, x: number, y: number): number => world.fog.state[y * world.map.w + x];

describe('fog of war', () => {
  it('player units light their sight radius; leaving tiles turns them explored', () => {
    const world = makeWorld(open(40, 20));
    const u = addUnit(world, 'tiller', 0, 5.5, 10.5); // sight 6
    expect(at(world, 5, 10)).toBe(Fog.Unexplored);
    updateFog(world);
    expect(at(world, 5, 10)).toBe(Fog.Visible);
    expect(at(world, 11, 10)).toBe(Fog.Visible); // 6 tiles away (center to center)
    expect(at(world, 12, 10)).toBe(Fog.Unexplored);
    expect(at(world, 10, 14)).toBe(Fog.Unexplored); // 5,4 -> 6.4 > 6
    const v1 = world.fog.version;
    expect(v1).toBeGreaterThan(0);

    u.x = 30.5;
    updateFog(world);
    expect(world.fog.version).toBe(v1 + 1);
    expect(at(world, 5, 10)).toBe(Fog.Explored);
    expect(at(world, 30, 10)).toBe(Fog.Visible);
    expect(at(world, 18, 10)).toBe(Fog.Unexplored);
  });

  it('bumps the version only when something changed', () => {
    const world = makeWorld(open(20, 20));
    addUnit(world, 'ashpike', 0, 10, 10);
    updateFog(world);
    const v = world.fog.version;
    updateFog(world);
    updateFog(world);
    expect(world.fog.version).toBe(v);
  });

  it('ignores enemy units and dead units; uses rank-composed sight', () => {
    const world = makeWorld(open(30, 10));
    addUnit(world, 'thornling', 1, 5.5, 5.5);
    const dead = addUnit(world, 'tiller', 0, 15.5, 5.5);
    dead.alive = false;
    updateFog(world);
    expect(world.fog.version).toBe(0);
    addUnit(world, 'ashpike', 0, 25.5, 5.5, { rank: 2 }); // sight 6 + 2
    updateFog(world);
    expect(at(world, 17, 5)).toBe(Fog.Visible);
    expect(at(world, 16, 5)).toBe(Fog.Unexplored);
  });

  it('player buildings (including foundations) see from their center', () => {
    const world = makeWorld(open(40, 40));
    addBuilding(world, 'hearth', 0, 10, 10); // 4x4, sight 9, center (12, 12)
    addBuilding(world, 'cottage', 0, 30, 30, { built: false, buildProgress: 0 }); // sight 4, center (31, 31)
    addBuilding(world, 'thorn_nest', 1, 30, 2); // enemy: no vision
    updateFog(world);
    expect(at(world, 12, 3)).toBe(Fog.Visible); // dy = 8.5
    expect(at(world, 12, 2)).toBe(Fog.Unexplored); // dy = 9.5
    expect(at(world, 34, 31)).toBe(Fog.Visible);
    expect(at(world, 31, 3)).toBe(Fog.Unexplored);
  });

  it('vision sources light tiles until they expire', () => {
    const world = makeWorld(open(30, 30));
    world.vision.push({ x: 20, y: 20, r: 7, until: 10, tag: 'hawk' });
    world.vision.push({ x: 5, y: 5, r: 3, until: -1, tag: 'beacon' });
    updateFog(world);
    expect(at(world, 20, 20)).toBe(Fog.Visible);
    expect(at(world, 5, 5)).toBe(Fog.Visible);
    world.tick = 10;
    updateFog(world);
    expect(world.vision.map((v) => v.tag)).toEqual(['beacon']);
    expect(at(world, 20, 20)).toBe(Fog.Explored);
    expect(at(world, 5, 5)).toBe(Fog.Visible);
  });

  it('exploreCircle marks explored (never downgrades), Infinity explores everything', () => {
    const world = makeWorld(open(30, 30));
    addUnit(world, 'tiller', 0, 15.5, 15.5);
    updateFog(world);
    const v = world.fog.version;
    exploreCircle(world, 15.5, 15.5, 10);
    expect(at(world, 15, 15)).toBe(Fog.Visible);
    expect(at(world, 15, 25)).toBe(Fog.Explored);
    expect(at(world, 15, 26)).toBe(Fog.Unexplored);
    expect(world.fog.version).toBe(v + 1);
    exploreCircle(world, 15.5, 15.5, 10);
    expect(world.fog.version).toBe(v + 1);
    exploreCircle(world, 0, 0, Infinity);
    expect(Array.from(world.fog.state).every((s) => s >= Fog.Explored)).toBe(true);
  });

  it('debug revealAll shows everything', () => {
    const world = makeWorld(open(10, 10));
    world.debug.revealAll = true;
    updateFog(world);
    expect(Array.from(world.fog.state).every((s) => s === Fog.Visible)).toBe(true);
    const v = world.fog.version;
    updateFog(world);
    expect(world.fog.version).toBe(v);
    world.debug.revealAll = false;
    updateFog(world);
    expect(Array.from(world.fog.state).every((s) => s === Fog.Explored)).toBe(true);
  });
});
