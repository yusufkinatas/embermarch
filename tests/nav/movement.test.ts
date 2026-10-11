import { describe, expect, it } from 'vitest';
import { groupArrivalRadius } from '../../src/data/balance';
import { edgeDistance } from '../../src/sim/nav/geometry';
import { onTerrainChanged, setFootprint } from '../../src/sim/nav/grid';
import { displaceUnit, findFreeSpot, formationSlots, setMove, stepMovement } from '../../src/sim/nav/movement';
import { rebuildSpatial } from '../../src/sim/nav/spatial';
import type { Unit } from '../../src/sim/types';
import {
  addBuilding,
  addResource,
  addUnit,
  intent,
  makeWorld,
  moveTo,
  openMap,
  overlapsBlocked,
  randomObstacleMap,
  run,
  runUntil,
} from './helpers';

const open = (w: number, h: number): string[] => Array.from({ length: h }, () => '.'.repeat(w));
const setFootprintClear = (world: ReturnType<typeof makeWorld>, b: { tx: number; ty: number; w: number; h: number }): void =>
  setFootprint(world, b.tx, b.ty, b.w, b.h, 0);

describe('movement: basics', () => {
  it('walks to a point, reports moving then arrived, updates velocity and facing', () => {
    const world = makeWorld(open(20, 10));
    const u = addUnit(world, 'ashpike', 0, 2.5, 5.5);
    moveTo(world, u, 10.5, 5.5);
    expect(u.moveStatus).toBe('moving');
    run(world, 1);
    expect(u.moveStatus).toBe('moving');
    expect(u.vx).toBeCloseTo(2.0, 5);
    expect(u.vy).toBeCloseTo(0, 5);
    expect(u.facing).toBeCloseTo(0);
    const ticks = runUntil(world, 200, () => u.moveStatus === 'arrived');
    // 8 tiles at 2 tiles/s = 4 s = 80 ticks.
    expect(ticks).toBeGreaterThan(70);
    expect(ticks).toBeLessThan(90);
    expect(Math.hypot(u.x - 10.5, u.y - 5.5)).toBeLessThan(0.11);
    run(world, 5);
    expect(u.moveStatus).toBe('arrived');
    expect(Math.hypot(u.vx, u.vy)).toBeLessThan(1e-6);
  });

  it('paths around walls and never overlaps blocked tiles', () => {
    const rows = [
      '..............',
      '..............',
      '......#.......',
      '......#.......',
      '......#.......',
      '......#.......',
      '......#.......',
      '......#.......',
      '..............',
    ];
    const world = makeWorld(rows);
    const u = addUnit(world, 'courser', 0, 2.5, 5.5);
    moveTo(world, u, 11.5, 5.5);
    const ticks = runUntil(world, 400, () => {
      expect(overlapsBlocked(world, u)).toBe(false);
      return u.moveStatus === 'arrived';
    });
    expect(ticks).toBeGreaterThan(0);
  });

  it('applies terrain, Blight (player only, Kindled Earth immune) and speed caps', () => {
    const rows = ['....................', ',,,,,,,,,,,,,,,,,,,,', '....................', '....................'];
    const world = makeWorld(rows);
    const a = addUnit(world, 'ashpike', 0, 1.5, 0.5);
    const s = addUnit(world, 'ashpike', 0, 1.5, 1.5);
    const b = addUnit(world, 'ashpike', 0, 1.5, 2.5);
    const e = addUnit(world, 'briarguard', 1, 1.5, 3.5, { speed: 2 });
    for (let x = 0; x < 20; x++) {
      world.blight.tiles[2 * 20 + x] = 1;
      world.blight.tiles[3 * 20 + x] = 1;
    }
    moveTo(world, a, 18.5, 0.5, { speedCap: 1.5 });
    moveTo(world, s, 18.5, 1.5);
    moveTo(world, b, 18.5, 2.5);
    moveTo(world, e, 18.5, 3.5, { mode: 'enemy' });
    run(world, 1);
    expect(a.vx).toBeCloseTo(1.5);
    expect(s.vx).toBeCloseTo(2 * 0.6);
    expect(b.vx).toBeCloseTo(2 * 0.8);
    expect(e.vx).toBeCloseTo(2);
    world.players[0].flags.kindled_earth = 1;
    run(world, 1);
    expect(b.vx).toBeCloseTo(2);
    // Rooted (speed 0): no movement, never stuck.
    b.speed = 0;
    run(world, 60);
    expect(b.vx).toBe(0);
    expect(b.moveStatus).toBe('moving');
  });

  it('setMove keeps the path for small goal changes and resets it for real ones', () => {
    const world = makeWorld(['............', '.....#......', '.....#......', '............']);
    const u = addUnit(world, 'tiller', 0, 1.5, 2.5);
    moveTo(world, u, 10.5, 2.5);
    run(world, 1);
    const p = u.path;
    expect(p).not.toBeNull();
    setMove(world, u, intent(10.7, 2.6));
    expect(u.path).toBe(p);
    setMove(world, u, intent(10.5, 0.5));
    expect(u.path).toBeNull();
    expect(u.moveStatus).toBe('moving');
    u.stuck.repaths = 2;
    setMove(world, u, intent(3.5, 0.5));
    expect(u.stuck.repaths).toBe(0);
    setMove(world, u, null);
    expect(u.move).toBeNull();
    expect(u.moveStatus).toBe('none');
  });

  it('copies the intent and refreshes x/y from a live target', () => {
    const world = makeWorld(open(12, 6));
    const u = addUnit(world, 'courser', 0, 1.5, 1.5);
    const t = addUnit(world, 'thornling', 1, 9.5, 4.5);
    const mv = intent(0, 0, { targetId: t.id, range: 0.5 });
    setMove(world, u, mv);
    expect(u.move).not.toBe(mv);
    run(world, 1);
    expect(u.move!.x).toBe(t.x);
    expect(u.move!.y).toBe(t.y);
  });
});

describe('movement: targets and arrival', () => {
  it('approaches a building to range (edge-to-edge) and stops', () => {
    const world = makeWorld(open(20, 12));
    const hall = addBuilding(world, 'muster_hall', 1, 14, 4);
    const m = addUnit(world, 'ashpike', 0, 1.5, 5.5);
    const r = addUnit(world, 'bowman', 0, 1.5, 7.5);
    setMove(world, m, intent(0, 0, { targetId: hall.id, range: 0.7 }));
    setMove(world, r, intent(0, 0, { targetId: hall.id, range: 6 }));
    runUntil(world, 300, () => m.moveStatus === 'arrived' && r.moveStatus === 'arrived');
    expect(edgeDistance(m, hall)).toBeLessThanOrEqual(0.7);
    expect(edgeDistance(m, hall)).toBeGreaterThan(0.5);
    expect(edgeDistance(r, hall)).toBeLessThanOrEqual(6);
    expect(edgeDistance(r, hall)).toBeGreaterThan(5.5);
    expect(overlapsBlocked(world, m)).toBe(false);
  });

  it('chases a moving unit target and arrives in range', () => {
    const world = makeWorld(open(30, 10));
    const hunter = addUnit(world, 'courser', 0, 1.5, 5.5);
    const prey = addUnit(world, 'thornling', 1, 10.5, 5.5, { speed: 1.5 });
    setMove(world, hunter, intent(0, 0, { targetId: prey.id, range: 0.5 }));
    moveTo(world, prey, 28.5, 5.5);
    const ticks = runUntil(world, 400, () => hunter.moveStatus === 'arrived');
    expect(ticks).toBeGreaterThan(0);
    expect(edgeDistance(hunter, prey)).toBeLessThanOrEqual(0.5 + 0.2);
  });

  it('a point goal on a tree tile arrives next to the tree', () => {
    const world = makeWorld(['..........', '..........', '.......T..', '..........']);
    const u = addUnit(world, 'tiller', 0, 1.5, 2.5);
    moveTo(world, u, 7.5, 2.5, { range: 0.5 });
    const ticks = runUntil(world, 200, () => u.moveStatus === 'arrived');
    expect(ticks).toBeGreaterThan(0);
    expect(u.x).toBeLessThan(7);
    expect(Math.hypot(u.x - 7.5, u.y - 2.5)).toBeLessThan(1.3);
  });

  it('gathers at a resource node footprint', () => {
    const world = makeWorld(open(14, 8));
    const seam = addResource(world, 'ember_seam', 9, 3);
    const u = addUnit(world, 'tiller', 0, 1.5, 4.5);
    setMove(world, u, intent(0, 0, { targetId: seam.id, range: 0.5 }));
    runUntil(world, 200, () => u.moveStatus === 'arrived');
    expect(u.moveStatus).toBe('arrived');
    expect(edgeDistance(u, seam)).toBeLessThanOrEqual(0.5);
  });

  it('unreachable goals end at the nearest reachable tile with status unreachable', () => {
    const rows = ['..........', '...#####..', '...#...#..', '...#...#..', '...#####..', '..........'];
    const world = makeWorld(rows);
    const u = addUnit(world, 'tiller', 0, 0.5, 5.5);
    moveTo(world, u, 5.5, 2.5);
    const ticks = runUntil(world, 300, () => u.moveStatus === 'unreachable');
    expect(ticks).toBeGreaterThan(0);
    expect(Math.floor(u.x)).toBe(5);
    expect(Math.floor(u.y)).toBe(0);
    // Opening the wall (grid change) lets it finish the trip.
    world.map.terrain[1 * 10 + 5] = 0;
    world.grid.blocked[1 * 10 + 5] = 0;
    world.grid.version++;
    const t2 = runUntil(world, 200, () => u.moveStatus === 'arrived');
    expect(t2).toBeGreaterThan(0);
  });

  it('a felled tree opens a shortcut that waiting units take', () => {
    const rows = ['#####', '..T..', '#####'];
    const world = makeWorld(rows);
    const u = addUnit(world, 'tiller', 0, 0.5, 1.5);
    moveTo(world, u, 4.5, 1.5);
    runUntil(world, 100, () => u.moveStatus === 'unreachable');
    expect(u.moveStatus).toBe('unreachable');
    world.map.treeAmount[1 * 5 + 2] = 0;
    onTerrainChanged(world, 1 * 5 + 2);
    expect(runUntil(world, 100, () => u.moveStatus === 'arrived')).toBeGreaterThan(0);
  });

  it('repaths when a building is placed across its path', () => {
    const world = makeWorld(open(20, 12));
    const u = addUnit(world, 'tiller', 0, 1.5, 5.5);
    moveTo(world, u, 18.5, 5.5);
    run(world, 10);
    addBuilding(world, 'muster_hall', 0, 8, 4); // blocks rows 4-6 at x 8-10
    const ticks = runUntil(world, 300, () => {
      expect(overlapsBlocked(world, u)).toBe(false);
      return u.moveStatus === 'arrived';
    });
    expect(ticks).toBeGreaterThan(0);
  });
});

describe('movement: groups and flow fields', () => {
  it('group orders sharing a flowKey arrive within 0.5 + 0.35 sqrt(n)', () => {
    const world = makeWorld(open(40, 30));
    const units: Unit[] = [];
    for (let i = 0; i < 12; i++) units.push(addUnit(world, 'ashpike', 0, 2.5 + (i % 4), 10.5 + Math.floor(i / 4)));
    for (const u of units) moveTo(world, u, 32.5, 20.5, { flowKey: 'g1' });
    const ticks = runUntil(world, 600, () => units.every((u) => u.moveStatus === 'arrived'));
    expect(ticks).toBeGreaterThan(0);
    const radius = groupArrivalRadius(12);
    const dists = units.map((u) => Math.hypot(u.x - 32.5, u.y - 20.5));
    // Arrival happens inside the radius; separation may nudge settled units out by < 0.35 (hysteresis).
    for (const d of dists) expect(d).toBeLessThanOrEqual(radius + 0.35);
    // The blob grows from the goal itself (not piled up short of it), leaning toward the approach side.
    expect(Math.min(...dists)).toBeLessThan(0.5);
    const cx = units.reduce((a, u) => a + u.x, 0) / units.length;
    const cy = units.reduce((a, u) => a + u.y, 0) / units.length;
    expect(Math.hypot(cx - 32.5, cy - 20.5)).toBeLessThan(1.5);
    // Nobody churns afterwards.
    run(world, 100);
    expect(units.every((u) => u.moveStatus === 'arrived')).toBe(true);
    // A follower used the field.
    expect(units.some((u) => u.path === null || u.path.flowKey === 'g1')).toBe(true);
  });

  it('flow-field groups route around obstacles', () => {
    const rows = open(30, 20);
    const g = rows.map((r) => r.split(''));
    for (let y = 2; y < 18; y++) g[y][15] = '#';
    const world = makeWorld(g.map((r) => r.join('')));
    const units: Unit[] = [];
    for (let i = 0; i < 8; i++) units.push(addUnit(world, 'bowman', 0, 3.5 + (i % 2), 8.5 + Math.floor(i / 2)));
    for (const u of units) moveTo(world, u, 26.5, 10.5, { flowKey: 'g2' });
    const ticks = runUntil(world, 800, () => {
      for (const u of units) expect(overlapsBlocked(world, u)).toBe(false);
      return units.every((u) => u.moveStatus === 'arrived');
    });
    expect(ticks).toBeGreaterThan(0);
  });

  it('respects the A* budget of 8 searches per tick (queues the rest)', () => {
    const rows = open(30, 30).map((r, y) => (y >= 5 && y <= 25 ? r.slice(0, 15) + '#' + r.slice(16) : r));
    const world = makeWorld(rows);
    const units: Unit[] = [];
    for (let i = 0; i < 20; i++) units.push(addUnit(world, 'tiller', 0, 3.5 + (i % 5), 10.5 + Math.floor(i / 5)));
    for (const u of units) moveTo(world, u, 25.5, 15.5); // no LOS: needs A*
    run(world, 1);
    expect(units.filter((u) => u.path !== null).length).toBe(8);
    run(world, 1);
    expect(units.filter((u) => u.path !== null).length).toBe(16);
    run(world, 1);
    expect(units.filter((u) => u.path !== null).length).toBe(20);
    const ticks = runUntil(world, 900, () => units.every((u) => u.moveStatus === 'arrived'));
    expect(ticks).toBeGreaterThan(0);
  });
});

describe('movement: enemy mode', () => {
  it('stops at a player building in the way and reports blockedBy', () => {
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
    const wall = addBuilding(world, 'muster_hall', 0, 9, 2);
    const e = addUnit(world, 'thornling', 1, 1.5, 3.5);
    moveTo(world, e, 18.5, 3.5, { mode: 'enemy' });
    const ticks = runUntil(world, 200, () => e.moveStatus === 'blocked');
    expect(ticks).toBeGreaterThan(0);
    expect(e.blockedBy).toBe(wall.id);
    expect(edgeDistance(e, wall)).toBeLessThan(0.9);
    // Ordering the attack on the blocker: arrives in melee range.
    setMove(world, e, intent(0, 0, { targetId: wall.id, range: 0.5, mode: 'enemy' }));
    expect(runUntil(world, 40, () => e.moveStatus === 'arrived')).toBeGreaterThan(0);
    expect(e.blockedBy).toBe(0);
  });

  it('far enemy goals use a flow field and also report blockers', () => {
    const rows = ['#'.repeat(40), ...Array.from({ length: 5 }, () => '.'.repeat(40)), '#'.repeat(40)];
    const world = makeWorld(rows);
    // Wall of buildings across the corridor at x 30-31.
    const blockers = [addBuilding(world, 'cottage', 0, 30, 1), addBuilding(world, 'cottage', 0, 30, 3), addBuilding(world, 'storehouse', 0, 30, 4)];
    const ids = new Set(blockers.map((b) => b.id));
    const wave: Unit[] = [];
    for (let i = 0; i < 6; i++) wave.push(addUnit(world, 'thornling', 1, 1.5, 1.5 + (i % 5)));
    for (const u of wave) moveTo(world, u, 38.5, 3.5, { mode: 'enemy' });
    run(world, 2);
    expect(wave.every((u) => u.path?.flowKey?.startsWith('~'))).toBe(true);
    const ticks = runUntil(world, 600, () => wave.every((u) => u.moveStatus === 'blocked'));
    expect(ticks).toBeGreaterThan(0);
    for (const u of wave) expect(ids.has(u.blockedBy)).toBe(true);
  });

  it('enemy units walk around buildings when a short detour exists', () => {
    const world = makeWorld(open(20, 9));
    addBuilding(world, 'muster_hall', 0, 9, 3);
    const e = addUnit(world, 'thornling', 1, 2.5, 4.5);
    moveTo(world, e, 17.5, 4.5, { mode: 'enemy' });
    const ticks = runUntil(world, 300, () => e.moveStatus === 'arrived' || e.moveStatus === 'blocked');
    expect(ticks).toBeGreaterThan(0);
    expect(e.moveStatus).toBe('arrived');
  });
});

describe('movement: contract edge cases', () => {
  it('handles behaviors that assign or mutate unit.move directly (no setMove)', () => {
    const world = makeWorld(['............', '.....#......', '.....#......', '............']);
    const u = addUnit(world, 'thornling', 1, 1.5, 2.5);
    u.move = intent(10.5, 2.5, { mode: 'enemy' });
    run(world, 2);
    expect(u.moveStatus).toBe('moving');
    const p = u.path;
    // Encounter tweaks mode / speedCap in place: path kept.
    u.move.speedCap = 1;
    u.move.mode = 'enemy';
    run(world, 1);
    expect(u.path).toBe(p);
    // A new goal assigned in place resets the path and arrives there.
    u.move.x = 1.5;
    u.move.y = 0.5;
    run(world, 1);
    expect(u.path).not.toBe(p);
    expect(runUntil(world, 200, () => u.moveStatus === 'arrived')).toBeGreaterThan(0);
    expect(Math.hypot(u.x - 1.5, u.y - 0.5)).toBeLessThan(0.2);
    // Clearing it directly normalizes the status.
    u.move = null;
    run(world, 1);
    expect(u.moveStatus).toBe('none');
  });

  it('a blocked enemy resumes once the blocking building is gone', () => {
    const rows = ['#######', '.......', '.......', '#######'];
    const world = makeWorld(rows);
    const b = addBuilding(world, 'cottage', 0, 3, 1);
    const e = addUnit(world, 'thornling', 1, 0.5, 2);
    moveTo(world, e, 6.5, 1.5, { mode: 'enemy' });
    expect(runUntil(world, 100, () => e.moveStatus === 'blocked')).toBeGreaterThan(0);
    expect(e.blockedBy).toBe(b.id);
    b.alive = false;
    world.entities.delete(b.id);
    setFootprintClear(world, b);
    expect(runUntil(world, 100, () => e.moveStatus === 'arrived')).toBeGreaterThan(0);
    expect(e.blockedBy).toBe(0);
  });

  it('units inside blocked tiles stay put while idle and walk out once ordered', () => {
    const world = makeWorld(open(10, 10));
    const u = addUnit(world, 'briar_regent', 1, 4.5, 4.5);
    addBuilding(world, 'muster_hall', 1, 3, 3); // a dais under it (like the Briar Throne)
    run(world, 40);
    expect(u.x).toBe(4.5);
    expect(u.y).toBe(4.5);
    moveTo(world, u, 8.5, 8.5, { mode: 'enemy' });
    const ticks = runUntil(world, 200, () => u.moveStatus === 'arrived');
    expect(ticks).toBeGreaterThan(0);
    expect(overlapsBlocked(world, u)).toBe(false);
  });

  it('enemy units on Blight keep full speed; Shallows still slow them', () => {
    const world = makeWorld(['..........', ',,,,,,,,,,']);
    const a = addUnit(world, 'thornling', 1, 0.5, 0.5, { speed: 2 });
    const b = addUnit(world, 'thornling', 1, 0.5, 1.5, { speed: 2 });
    world.blight.tiles.fill(1);
    moveTo(world, a, 9.5, 0.5, { mode: 'enemy' });
    moveTo(world, b, 9.5, 1.5, { mode: 'enemy' });
    run(world, 1);
    expect(a.vx).toBeCloseTo(2);
    expect(b.vx).toBeCloseTo(1.2);
  });
});

describe('movement: narrow gaps', () => {
  it('units arriving side by side slip through a 1-tile gap (no jam, no stuck)', () => {
    // Wall at x = 10 with a single 1-tile gap at y = 5.
    const rows = Array.from({ length: 11 }, (_, y) => '..........' + (y === 5 ? '.' : '#') + '..........');
    const world = makeWorld(rows);
    const units: Unit[] = [];
    for (let i = 0; i < 10; i++) units.push(addUnit(world, i % 2 ? 'thornling' : 'briarguard', 1, 2.5 + Math.floor(i / 2), 4.6 + (i % 2) * 0.8));
    for (const u of units) moveTo(world, u, 18.5, 5.5, { mode: 'enemy' });
    const ticks = runUntil(world, 800, () => {
      for (const u of units) expect(overlapsBlocked(world, u)).toBe(false);
      return units.every((u) => u.x > 11);
    });
    expect(ticks).toBeGreaterThan(0);
    expect(units.some((u) => u.moveStatus === 'stuck')).toBe(false);
  });

  it('corner sliding lines a unit up with a gap it barely misses', () => {
    const rows = ['.....#....', '..........', '.....#....'];
    const world = makeWorld(rows);
    // Center 0.1 below the gap row's band: the box clips the wall tile below.
    const u = addUnit(world, 'ashpike', 0, 4.3, 1.75);
    moveTo(world, u, 8.5, 1.75);
    const ticks = runUntil(world, 100, () => u.moveStatus === 'arrived');
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(60);
  });
});

describe('movement: separation, stuck, displacement', () => {
  it('soft separation spreads stacked units and never pushes into walls', () => {
    const rows = ['#########', '#.......#', '#.......#', '#.......#', '#########'];
    const world = makeWorld(rows);
    const units: Unit[] = [];
    for (let i = 0; i < 8; i++) units.push(addUnit(world, 'ashpike', 0, 1.4, 2.5));
    run(world, 1);
    // Max push 0.5 tiles/s.
    for (const u of units) expect(Math.hypot(u.x - 1.4, u.y - 2.5)).toBeLessThanOrEqual(0.5 * 0.05 + 1e-9);
    run(world, 300, () => {
      for (const u of units) expect(overlapsBlocked(world, u)).toBe(false);
    });
    let minD = Infinity;
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) minD = Math.min(minD, Math.hypot(units[i].x - units[j].x, units[i].y - units[j].y));
    }
    expect(minD).toBeGreaterThan(0.5);
  });

  it('moving units shove idle ones out of the way', () => {
    const world = makeWorld(['..........', '..........', '..........']);
    const idle = addUnit(world, 'tiller', 0, 5.5, 1.5);
    const mover = addUnit(world, 'destrier', 0, 1.5, 1.5);
    moveTo(world, mover, 9.5, 1.5);
    const ticks = runUntil(world, 200, () => mover.moveStatus === 'arrived');
    expect(ticks).toBeGreaterThan(0);
    expect(Math.hypot(mover.x - 9.5, mover.y - 1.5)).toBeLessThan(0.15);
    expect(Math.abs(idle.y - 1.5) + Math.abs(idle.x - 5.5)).toBeGreaterThan(0.05);
  });

  it('stuck detection repaths, then gives up after 3 repaths (moveStatus stuck)', () => {
    const world = makeWorld(open(20, 6));
    const u = addUnit(world, 'tiller', 0, 2.5, 2.5);
    moveTo(world, u, 15.5, 2.5);
    // Something keeps shoving it back every tick.
    let firstRepath = -1;
    const ticks = runUntil(world, 200, () => {
      u.x = 2.5;
      u.y = 2.5;
      if (firstRepath < 0 && u.stuck.repaths === 1) firstRepath = world.tick;
      return u.moveStatus === 'stuck';
    });
    expect(firstRepath).toBe(20); // 1.0 s
    expect(ticks).toBe(80); // three repaths (1 s, 2 s, 3 s), then gives up at 4 s
    expect(u.move).toBeNull();
    expect(u.path).toBeNull();
    // Re-issuing the same goal keeps the counters: gives up again after 1 s.
    moveTo(world, u, 15.5, 2.5);
    const again = runUntil(world, 100, () => {
      u.x = 2.5;
      u.y = 2.5;
      return u.moveStatus === 'stuck';
    });
    expect(again).toBe(20);
  });

  it('stuck counters expire after a 6 s window', () => {
    const world = makeWorld(open(40, 6));
    const u = addUnit(world, 'tiller', 0, 2.5, 2.5);
    moveTo(world, u, 38.5, 2.5);
    // Pin it for ~1 s every 3.5 s: each pin costs one repath, but never 3 within a 6 s window.
    let t = 0;
    run(world, 400, () => {
      t++;
      if (t % 70 < 21) {
        u.x = Math.max(2.5, u.x - 0.11);
      }
    });
    expect(u.moveStatus).not.toBe('stuck');
  });

  it('displaceUnit moves in 0.25 steps and stops at the last walkable spot', () => {
    const world = makeWorld(['..........', '.....#....', '..........']);
    const u = addUnit(world, 'ashpike', 0, 2.5, 1.5);
    displaceUnit(world, u, 6, 0);
    expect(u.x).toBeLessThanOrEqual(5 - 0.3 + 1e-9);
    expect(u.x).toBeGreaterThan(4.3);
    expect(overlapsBlocked(world, u)).toBe(false);
    const before = u.x;
    displaceUnit(world, u, -2, 0);
    expect(u.x).toBeCloseTo(before - 2, 9);
    // Map edge.
    displaceUnit(world, u, -10, 0);
    expect(u.x).toBeGreaterThanOrEqual(0.3);
  });
});

describe('placement helpers', () => {
  it('findFreeSpot returns the nearest walkable tile without static occupant or units', () => {
    const world = makeWorld(open(12, 12));
    const hall = addBuilding(world, 'muster_hall', 0, 4, 4);
    rebuildSpatial(world);
    const s = findFreeSpot(world, hall.x, hall.y, 6)!;
    expect(world.grid.blocked[Math.floor(s.y) * 12 + Math.floor(s.x)]).toBe(0);
    expect(Math.hypot(s.x - hall.x, s.y - hall.y)).toBeCloseTo(2);
    addUnit(world, 'tiller', 0, 5.5, 3.5);
    const s2 = findFreeSpot(world, 5.5, 3.6, 6)!;
    expect(s2).not.toEqual({ x: 5.5, y: 3.5 });
    expect(Math.hypot(s2.x - 5.5, s2.y - 3.6)).toBeLessThan(1.2);
    // Same tick, several spawns: each lands on a different tile.
    const spots = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const p = findFreeSpot(world, 1.5, 1.5, 5)!;
      spots.add(`${p.x},${p.y}`);
      addUnit(world, 'thornling', 1, p.x, p.y);
    }
    expect(spots.size).toBe(6);
  });

  it('findFreeSpot returns null when nothing is free within maxR, and never hops across water', () => {
    const world = makeWorld(['.~~~.', '~~~~~', '~~~~~']);
    addUnit(world, 'tiller', 0, 0.5, 0.5);
    expect(findFreeSpot(world, 0.5, 0.5, 6)).toBeNull();
  });

  it('formationSlots: melee in front, ranged behind, one slot per unit', () => {
    const world = makeWorld(open(30, 30));
    const units: Unit[] = [];
    for (let i = 0; i < 4; i++) units.push(addUnit(world, 'bowman', 0, 3 + i * 0.7, 10));
    for (let i = 0; i < 4; i++) units.push(addUnit(world, 'ashpike', 0, 3 + i * 0.7, 11));
    units.push(addUnit(world, 'tiller', 0, 2, 12));
    const slots = formationSlots(units, 4, 11, 20, 11, world);
    expect(slots.length).toBe(units.length);
    const melee = slots.filter((_, i) => units[i].type === 'ashpike');
    const ranged = slots.filter((_, i) => units[i].type === 'bowman');
    const worker = slots[8];
    expect(Math.min(...melee.map((s) => s.x))).toBeGreaterThan(Math.max(...ranged.map((s) => s.x)));
    expect(Math.min(...ranged.map((s) => s.x))).toBeGreaterThan(worker.x);
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) expect(Math.hypot(slots[i].x - slots[j].x, slots[i].y - slots[j].y)).toBeGreaterThan(0.79);
    }
    // Centered on the goal.
    const cx = slots.reduce((a, s) => a + s.x, 0) / slots.length;
    const cy = slots.reduce((a, s) => a + s.y, 0) / slots.length;
    expect(Math.abs(cy - 11)).toBeLessThan(0.5);
    expect(Math.abs(cx - 20)).toBeLessThan(1);
    // Facing +y puts melee at larger y.
    const down = formationSlots(units, 10, 2, 10, 20, world);
    expect(Math.min(...down.filter((_, i) => units[i].type === 'ashpike').map((s) => s.y))).toBeGreaterThan(
      Math.max(...down.filter((_, i) => units[i].type === 'bowman').map((s) => s.y)),
    );
  });

  it('formationSlots moves slots off blocked tiles (and keeps them unique)', () => {
    const rows = open(20, 20).map((r, y) => (y >= 8 && y <= 12 ? r.slice(0, 9) + '###' + r.slice(12) : r));
    const world = makeWorld(rows);
    const units: Unit[] = [];
    for (let i = 0; i < 9; i++) units.push(addUnit(world, 'ashpike', 0, 2 + (i % 3), 9 + Math.floor(i / 3)));
    const slots = formationSlots(units, 3, 10, 10.5, 10.5, world);
    const seen = new Set<string>();
    for (const s of slots) {
      expect(world.grid.blocked[Math.floor(s.y) * 20 + Math.floor(s.x)]).toBe(0);
      seen.add(`${s.x.toFixed(2)},${s.y.toFixed(2)}`);
    }
    expect(seen.size).toBe(slots.length);
    // Without an explicit world, the units' world is used once the movement system saw it.
    stepMovement(world);
    const implicit = formationSlots(units, 3, 10, 10.5, 10.5);
    expect(implicit).toEqual(slots);
  });
});

describe('movement: performance', () => {
  it('140 units pathing on a 64x64 map stay well under the tick budget', () => {
    const world = makeWorld(randomObstacleMap(64, 64, 77, 0.18));
    const g = world.grid;
    const units: Unit[] = [];
    let k = 0;
    for (let y = 2; y < 62 && units.length < 140; y += 3) {
      for (let x = 2; x < 62 && units.length < 140; x += 3) {
        if (g.blocked[y * 64 + x] !== 0) continue;
        const owner = (k++ % 2) as 0 | 1;
        units.push(addUnit(world, owner === 0 ? 'ashpike' : 'thornling', owner, x + 0.5, y + 0.5));
      }
    }
    expect(units.length).toBe(140);
    units.forEach((u, i) => {
      const tx = (i * 37) % 60 + 2;
      const ty = (i * 53) % 60 + 2;
      moveTo(world, u, tx + 0.5, ty + 0.5, { mode: u.owner === 1 ? 'enemy' : 'player', flowKey: i % 3 === 0 ? 'grp' + (i % 4) : undefined });
    });
    run(world, 20); // warm-up
    const t0 = performance.now();
    run(world, 200);
    const perTick = (performance.now() - t0) / 200;
    console.log(`stepMovement 140 units: ${perTick.toFixed(3)} ms/tick`);
    expect(perTick).toBeLessThan(4);
    for (const u of units) expect(overlapsBlocked(world, u)).toBe(false);
  });
});

describe('movement: map with open terrain helper', () => {
  it('openMap fixture is all grass', () => {
    const m = openMap(3, 2);
    expect(Array.from(m.terrain)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
