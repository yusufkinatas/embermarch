/**
 * Integration scenarios: §Q (d) siege, Spent multiplier, Gatebreakers, determinism, tick budget.
 */
import { describe, expect, it } from 'vitest';
import { nestHp } from '../../src/data/balance';
import { spawnBuilding, spawnUnit } from '../../src/sim/entities';
import { orderUnit } from '../../src/sim/orders';
import { issueCommand, stepWorld } from '../../src/sim/world';
import type { Building, Command, Unit, UnitId, World } from '../../src/sim/types';
import { ENEMY, PLAYER } from '../../src/sim/types';
import { clearUnits, makeWorld, spawnGroup, stateHash, stepUntil, units } from './helpers';

function nestArena(d: number): { w: World; nest: Building } {
  const w = makeWorld();
  clearUnits(w);
  w.debug.revealAll = true;
  const nest = spawnBuilding(w, 'thorn_nest', ENEMY, 34, 32);
  nest.maxHp = nest.hp = nestHp(d);
  return { w, nest };
}

function army(w: World, comp: [UnitId, number][], x: number, y: number): Unit[] {
  const out: Unit[] = [];
  let i = 0;
  for (const [type, n] of comp) {
    for (let k = 0; k < n; k++, i++) out.push(spawnUnit(w, type, PLAYER, x + (i % 4) * 0.9, y + Math.floor(i / 4) * 0.9));
  }
  return out;
}

describe('siege (§Q d)', () => {
  it('15 mixed units (7 Ashpike, 5 Bowman, 2 Courser, Warden) take a d4 Nest in 35-50 s', () => {
    const { w, nest } = nestArena(4);
    const us = army(w, [['ashpike', 7], ['bowman', 5], ['courser', 2], ['warden', 1]], 26, 30);
    expect(issueCommand(w, { type: 'attack', unitIds: us.map((u) => u.id), targetId: nest.id }).ok).toBe(true);
    const t = stepUntil(w, () => !nest.alive, 80);
    console.log('siege d4 seconds', t);
    expect(t).toBeGreaterThanOrEqual(35);
    expect(t).toBeLessThanOrEqual(50);
  });

  it('a Spent Nest falls about 1.5× faster', () => {
    const run = (spent: boolean): number => {
      const { w, nest } = nestArena(4);
      if (spent) nest.nest = { index: 0, spent: true, spentUntil: 1e9, blightRadius: 0, seen: true, musterProgress: 0 };
      const us = army(w, [['ashpike', 7], ['bowman', 5], ['courser', 2], ['warden', 1]], 26, 30);
      issueCommand(w, { type: 'attack', unitIds: us.map((u) => u.id), targetId: nest.id });
      return stepUntil(w, () => !nest.alive, 80);
    };
    const normal = run(false);
    const spent = run(true);
    expect(normal / spent).toBeGreaterThan(1.3);
  });

  it('2 Gatebreakers (30.7 DPS each) take a d4 Nest in about 18 s', () => {
    const { w, nest } = nestArena(4);
    const gs = army(w, [['gatebreaker', 2]], 31, 32);
    issueCommand(w, { type: 'attack', unitIds: gs.map((u) => u.id), targetId: nest.id });
    const t = stepUntil(w, () => !nest.alive, 40);
    expect(t).toBeGreaterThan(16);
    expect(t).toBeLessThan(22);
  });
});

describe('determinism', () => {
  function scripted(seed: number): string[] {
    const w = makeWorld({ seed });
    w.debug.revealAll = true;
    const hashes: string[] = [];
    const tillers = units(w, PLAYER, 'tiller');
    const th = w.resources.filter((r) => r.type === 'thicket');
    const hearth = w.buildings.find((b) => b.type === 'hearth')!;
    const mh = w.buildings.find((b) => b.type === 'muster_hall')!;
    const script: [number, Command][] = [
      [0, { type: 'smart', unitIds: tillers.slice(0, 4).map((t) => t.id), x: th[0].x, y: th[0].y, targetId: th[0].id }],
      [0, { type: 'smart', unitIds: tillers.slice(4).map((t) => t.id), x: 23, y: 7 }],
      [20, { type: 'train', buildingIds: [hearth.id], unit: 'tiller', count: 3 }],
      [40, { type: 'train', buildingIds: [mh.id], unit: 'ashpike', count: 3 }],
      [100, { type: 'build', unitIds: [tillers[0].id], building: 'cottage', tx: 12, ty: 22 }],
    ];
    const foes = spawnGroup(w, 'thornling', ENEMY, 6, 36, 36);
    for (let tick = 0; tick < 1200; tick++) {
      for (const [t, cmd] of script) if (t === tick) issueCommand(w, cmd);
      if (tick === 300) for (const f of foes) orderUnit(w, f, { type: 'attackMove', x: 10, y: 10 });
      stepWorld(w);
      if (tick % 100 === 0) hashes.push(stateHash(w));
    }
    hashes.push(stateHash(w));
    return hashes;
  }

  it('same seed + commands -> identical state hashes', () => {
    const a = scripted(7);
    const b = scripted(7);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(5);
  });
});

describe('performance', () => {
  it('sim tick stays within budget with ~140 units marching and fighting', () => {
    const w = makeWorld({}, { w: 64, h: 64, forest: { x0: 28, y0: 2, x1: 36, y1: 14 } });
    clearUnits(w);
    w.debug.revealAll = true;
    const mine: Unit[] = [];
    const theirs: Unit[] = [];
    mine.push(...spawnGroup(w, 'ashpike', PLAYER, 25, 14, 40));
    mine.push(...spawnGroup(w, 'bowman', PLAYER, 20, 9, 40));
    mine.push(...spawnGroup(w, 'courser', PLAYER, 15, 14, 50));
    theirs.push(...spawnGroup(w, 'thornling', ENEMY, 35, 52, 40));
    theirs.push(...spawnGroup(w, 'spinecaster', ENEMY, 20, 57, 40));
    theirs.push(...spawnGroup(w, 'briarguard', ENEMY, 25, 52, 50));
    issueCommand(w, { type: 'attackMove', unitIds: mine.map((u) => u.id), x: 52, y: 44 });
    for (const u of theirs) orderUnit(w, u, { type: 'attackMove', x: 12, y: 44 });
    expect(w.units.length).toBe(140);
    // Warm up (JIT), then measure the march and the first clash.
    for (let i = 0; i < 20; i++) stepWorld(w);
    const n = 300;
    let worst = 0;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const a = performance.now();
      stepWorld(w);
      worst = Math.max(worst, performance.now() - a);
    }
    const ms = (performance.now() - t0) / n;
    console.log('ms/tick with 140 units', ms.toFixed(3), 'worst', worst.toFixed(2), 'alive', w.units.length);
    expect(w.units.length).toBeGreaterThan(60);
    // GDD budget is 4 ms per tick; generous bound for CI noise.
    expect(ms).toBeLessThan(6);
  });
});
