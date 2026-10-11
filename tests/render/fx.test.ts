import { describe, expect, it } from 'vitest';
import { FxSystem } from '../../src/render/fx';
import { SpriteCache } from '../../src/render/sprites';
import { buildBattleScene } from '../../src/render/devFixture';
import type { GameEvent } from '../../src/sim/types';

function makeFx(visible = true): FxSystem {
  return new FxSystem(new SpriteCache(), () => null, () => undefined, () => visible);
}

describe('fx event mapping (§P juice)', () => {
  const { world } = buildBattleScene({ units: 40 });
  const unit = world.units.find((u) => u.owner === 1)!;
  const attacker = world.units.find((u) => u.owner === 0 && u.cls !== 'worker')!;

  it('hit: flash 60 ms, recoil, impact particles and a throttled counter popup', () => {
    const fx = makeFx();
    const hit: GameEvent = { t: 'hit', targetId: unit.id, attackerId: attacker.id, x: unit.x, y: unit.y, damage: 12, mult: 3, popup: 'counter', targetOwner: 1, isStructure: false };
    fx.handle([hit], world);
    expect(fx.flashOf(unit.id)).toBeGreaterThan(0.9);
    expect(fx.particles.count).toBeGreaterThan(0);
    expect(fx.popups.countCombat()).toBe(1);
    fx.handle([hit, hit], world);
    expect(fx.popups.countCombat()).toBe(1);
    fx.step(0.05);
    const [rx, ry] = fx.recoilOf(unit.id);
    expect(Math.hypot(rx, ry)).toBeGreaterThan(0);
    expect(Math.hypot(rx, ry)).toBeLessThanOrEqual(2.0001);
    fx.step(0.1);
    expect(fx.flashOf(unit.id)).toBe(0);
  });

  it('hidden hits make no popup (fog)', () => {
    const fx = makeFx(false);
    fx.handle([{ t: 'hit', targetId: unit.id, attackerId: attacker.id, x: unit.x, y: unit.y, damage: 5, mult: 3, popup: 'counter', targetOwner: 1, isStructure: false }], world);
    expect(fx.popups.countCombat()).toBe(0);
  });

  it('drop-off floats "+10" and commands leave markers', () => {
    const fx = makeFx();
    fx.handle(
      [
        { t: 'dropoff', unitId: 1, res: 'timber', amount: 10, x: 5, y: 5 },
        { t: 'command', kind: 'move', x: 10, y: 10 },
        { t: 'command', kind: 'attack', x: 10, y: 10 },
        { t: 'command', kind: 'build', x: 10, y: 10 },
        { t: 'command', kind: 'rally', x: 10, y: 10 },
      ],
      world,
    );
    expect(fx.popups.items.find((p) => p.kind === 'float')?.text).toBe('+10');
    expect(fx.markers.map((m) => m.kind)).toEqual(['move', 'attack', 'build', 'rally']);
    fx.step(1.5);
    expect(fx.markers).toHaveLength(0);
  });

  it('deaths: player topple, Thornwake dissolve with violet motes; building collapse shakes', () => {
    const fx = makeFx();
    fx.handle(
      [
        { t: 'death', id: 9001, kind: 'unit', type: 'ashpike', owner: 0, x: 4, y: 4 },
        { t: 'death', id: 9002, kind: 'unit', type: 'thornling', owner: 1, x: 6, y: 4 },
        { t: 'death', id: 9003, kind: 'building', type: 'cottage', owner: 0, x: 8, y: 8, w: 2, h: 2 },
      ],
      world,
    );
    expect(fx.corpses.map((c) => c.dissolve)).toEqual([false, true]);
    expect(fx.collapses).toHaveLength(1);
    expect(fx.shakes[0].mag).toBe(4);
    expect(fx.shakes[0].dur).toBeCloseTo(0.25);
    expect(fx.particles.items.some((p) => p.kind === 'mote')).toBe(true);
  });

  it('Nest death: shockwave ring + 6 px shake', () => {
    const fx = makeFx();
    fx.handle([{ t: 'death', id: 77, kind: 'building', type: 'thorn_nest', owner: 1, x: 20, y: 20, w: 3, h: 3 }], world);
    expect(fx.rings.some((r) => r.air)).toBe(true);
    expect(Math.max(...fx.shakes.map((s) => s.mag))).toBe(6);
    expect(fx.diedStructures).toContain(77);
  });

  it('telegraphs, Blight recede rings, pings, flashes and shake events', () => {
    const fx = makeFx();
    fx.handle(
      [
        { t: 'telegraph', shape: 'ring', x: 5, y: 5, radius: 4, duration: 1.5 },
        { t: 'telegraph', shape: 'line', x: 5, y: 5, x2: 10, y2: 5, width: 1.5, duration: 1.2 },
        { t: 'blightRecede', x: 30, y: 30, radius: 8 },
        { t: 'alert', kind: 'under_attack', text: 'x', x: 3, y: 3 },
        { t: 'alert', kind: 'info', text: 'no position' },
        { t: 'lastStand', x: 5, y: 5 },
        { t: 'shake', magnitude: 3, duration: 0.3 },
      ],
      world,
    );
    expect(fx.telegraphs).toHaveLength(2);
    expect(fx.rings.some((r) => r.r1 === 0 && r.life === 4)).toBe(true);
    expect(fx.pings).toHaveLength(1);
    expect(fx.flashes).toHaveLength(1);
    const [sx, sy] = fx.shakeOffset();
    expect(Math.hypot(sx, sy)).toBeGreaterThan(0);
    fx.step(5);
    expect(fx.telegraphs).toHaveLength(0);
    expect(fx.shakeOffset()).toEqual([0, 0]);
  });

  it('keeps particles capped under an event storm', () => {
    const fx = makeFx();
    const storm: GameEvent[] = [];
    for (let i = 0; i < 400; i++) storm.push({ t: 'death', id: 10000 + i, kind: 'unit', type: 'thornling', owner: 1, x: 5, y: 5 });
    fx.handle(storm, world);
    expect(fx.particles.count).toBeLessThanOrEqual(400);
  });

  it('ignores malformed events without throwing', () => {
    const fx = makeFx();
    expect(() => fx.handle([{ t: 'hit' } as unknown as GameEvent, { t: 'unknown' } as unknown as GameEvent], world)).not.toThrow();
  });
});
