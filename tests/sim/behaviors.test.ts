/**
 * Unit behaviors and boon hooks: auras, Field Surgeons, kite, rooted, Thunder Charge, melee retarget,
 * Hearth of the Last Flame regen, Raider's Bounty, Plunderers.
 */
import { describe, expect, it } from 'vitest';
import { BOONS } from '../../src/data/boons';
import { RESEARCH } from '../../src/data/research';
import { THORNSPIRE } from '../../src/data/balance';
import { BUILDINGS } from '../../src/data/buildings';
import { computeDamagePacket, dealAbilityDamage } from '../../src/sim/combat';
import { spawnBuilding, spawnUnit } from '../../src/sim/entities';
import { orderUnit } from '../../src/sim/orders';
import { generateMap } from '../../src/mapgen';
import { quickBattleSetup } from '../../src/run';
import { edgeDistance } from '../../src/sim/nav/geometry';
import { createWorld, issueCommand } from '../../src/sim/world';
import type { Unit, World } from '../../src/sim/types';
import { ENEMY, PLAYER } from '../../src/sim/types';
import { clearUnits, makeWorld, spawnGroup, step, stepUntil } from './helpers';

function arena(over = {}): World {
  const w = makeWorld(over);
  clearUnits(w);
  w.debug.revealAll = true;
  return w;
}

describe('auras and regeneration', () => {
  it('Lampbearers heal non-siege allies 2 HP/s, at most 2 stacks', () => {
    const w = arena();
    const a = spawnUnit(w, 'ashpike', PLAYER, 30, 30);
    const g = spawnUnit(w, 'gatebreaker', PLAYER, 31, 31);
    a.hp = 20;
    g.hp = 100;
    for (let i = 0; i < 3; i++) spawnUnit(w, 'lampbearer', PLAYER, 29 + i, 29);
    step(w, 2);
    expect(a.hp).toBeCloseTo(28, 0);
    expect(g.hp).toBe(100);
  });

  it('Gloamwitches regenerate Thornwake within 4 tiles', () => {
    const w = arena();
    const t = spawnUnit(w, 'briarguard', ENEMY, 30, 30);
    t.hp = 30;
    spawnUnit(w, 'gloamwitch', ENEMY, 32, 30).order = { type: 'hold' };
    t.order = { type: 'hold' };
    step(w, 3);
    expect(t.hp).toBeCloseTo(36, 0);
  });

  it('Field Surgeons: military (not siege) undamaged for 5 s regenerate 2 HP/s', () => {
    const w = arena({ playerEffects: BOONS.field_surgeons.effects });
    const a = spawnUnit(w, 'ashpike', PLAYER, 30, 30);
    const g = spawnUnit(w, 'gatebreaker', PLAYER, 34, 30);
    const t = spawnUnit(w, 'tiller', PLAYER, 36, 30);
    a.hp = 30;
    g.hp = 100;
    t.hp = 20;
    a.lastDamagedTick = w.tick;
    step(w, 4);
    expect(a.hp).toBe(30);
    step(w, 3);
    expect(a.hp).toBeGreaterThan(32);
    expect(g.hp).toBe(100);
    expect(t.hp).toBe(20);
  });

  it('Hearth of the Last Flame regenerates the Hearth 6 HP/s', () => {
    const w = arena({ playerEffects: BOONS.flame_hearth.effects });
    const h = w.buildings.find((b) => b.type === 'hearth')!;
    expect(h.maxHp).toBe(3600);
    h.hp = 1000;
    step(w, 5);
    expect(h.hp).toBeCloseTo(1030, 0);
  });
});

describe('movement-affecting behaviors', () => {
  it('Outriders step back from melee (not on Hold)', () => {
    const w = arena();
    const o = spawnUnit(w, 'outrider', PLAYER, 30, 30);
    const foe = spawnUnit(w, 'thornling', ENEMY, 31.5, 30);
    foe.order = { type: 'hold' };
    const x0 = o.x;
    step(w, 1);
    expect(o.x).toBeLessThan(x0 - 1);
    const o2 = spawnUnit(w, 'outrider', PLAYER, 20, 20);
    orderUnit(w, o2, { type: 'hold' });
    const f2 = spawnUnit(w, 'thornling', ENEMY, 21.2, 20);
    f2.order = { type: 'hold' };
    step(w, 1);
    expect(Math.hypot(o2.x - 20, o2.y - 20)).toBeLessThan(0.1);
  });

  it('idle units walk back to their idle spot after an auto-engagement', () => {
    const w = arena();
    const c = spawnUnit(w, 'courser', PLAYER, 20, 30);
    const foe = spawnUnit(w, 'thornling', ENEMY, 25.5, 30);
    foe.order = { type: 'hold' };
    step(w, 6);
    expect(foe.alive).toBe(false);
    step(w, 4);
    expect(Math.hypot(c.x - 20, c.y - 30)).toBeLessThan(1);
    expect(c.order.type).toBe('idle');
  });

  it('rooted units cannot move but still attack', () => {
    const w = arena();
    const a = spawnUnit(w, 'ashpike', PLAYER, 30, 30);
    a.buffs.push({ id: 'rooted', until: w.tick + 60 });
    orderUnit(w, a, { type: 'move', x: 40, y: 30 });
    step(w, 2);
    expect(a.speed).toBe(0);
    expect(a.x).toBeCloseTo(30, 1);
  });

  it('Thunder Charge gives Coursers a ×1.5 first hit after moving 3 tiles', () => {
    const w = arena({ playerEffects: RESEARCH.thunder_charge.effects });
    const c = spawnUnit(w, 'courser', PLAYER, 20, 30);
    const t = spawnUnit(w, 'bowman', ENEMY, 30, 30);
    t.order = { type: 'hold' };
    expect(computeDamagePacket(w, c, t).raw).toBe(12);
    c.movedSinceAttack = 3.5;
    expect(computeDamagePacket(w, c, t).raw).toBe(18);
    orderUnit(w, c, { type: 'attack', targetId: t.id });
    step(w, 3.5);
    expect(t.alive).toBe(true);
    expect(35 - t.hp).toBeGreaterThanOrEqual(18);
  });

  it('melee units that cannot reach their target retarget a nearer enemy within 3 tiles', () => {
    const w = arena();
    const a = spawnUnit(w, 'ashpike', PLAYER, 30, 30);
    // An unreachable target behind a full-height wall of Grainplots.
    for (let y = 0; y < w.map.h; y += 2) spawnBuilding(w, 'grainplot', PLAYER, 33, y);
    const far = spawnUnit(w, 'thornling', ENEMY, 37, 30);
    far.order = { type: 'hold' };
    const near = spawnUnit(w, 'thornling', ENEMY, 31.5, 32);
    near.order = { type: 'hold' };
    orderUnit(w, a, { type: 'attack', targetId: far.id });
    step(w, 8);
    expect(near.hp).toBeLessThan(24);
  });
});

describe('boon hooks', () => {
  it("Raider's Bounty: +3 Grain per Courser hit on a Nest", () => {
    const w = arena({ playerEffects: BOONS.raiders_bounty.effects });
    const nest = spawnBuilding(w, 'thorn_nest', ENEMY, 34, 30);
    const c = spawnUnit(w, 'courser', PLAYER, 33.4, 31);
    const g0 = w.players[PLAYER].res.grain;
    orderUnit(w, c, { type: 'attack', targetId: nest.id });
    step(w, 3.2);
    // Courser vs a Nest with Raider's Bounty: 6 × 0.8 vs armor 3 = 4 per hit.
    const hits = (800 - nest.hp) / 4;
    expect(hits).toBeGreaterThanOrEqual(2);
    expect(w.players[PLAYER].res.grain - g0).toBe(3 * hits);
  });

  it('Plunderers: +100 Grain/Timber/Ember when a Nest or Picket Thornspire falls', () => {
    const w = makeWorld(
      { playerEffects: BOONS.plunderers.effects },
      { anchors: { pickets: [{ tx: 40, ty: 40, seamIndex: 0 }] } },
    );
    const p = w.players[PLAYER];
    const r0 = { ...p.res };
    const nest = spawnBuilding(w, 'thorn_nest', ENEMY, 30, 30);
    dealAbilityDamage(w, nest, 99999, 0);
    expect(p.res.grain - r0.grain).toBe(100);
    expect(p.res.ember - r0.ember).toBe(100);
    const spire = spawnBuilding(w, 'thornspire', ENEMY, 40, 40);
    const lone = spawnBuilding(w, 'thornspire', ENEMY, 44, 40);
    dealAbilityDamage(w, lone, 99999, 0);
    expect(p.res.timber - r0.timber).toBe(100);
    dealAbilityDamage(w, spire, 99999, 0);
    expect(p.res.timber - r0.timber).toBe(200);
  });
});

describe('structure multiplier below 0.5: no structure auto-targeting (GDD §F)', () => {
  const SPIRE_RANGE = BUILDINGS.thornspire.attack!.range;
  const ids = (us: Unit[]): number[] => us.map((u) => u.id);

  it('Bowmen attack-moving past a Thornspire do not stop to shoot it and reach the destination', () => {
    const w = arena();
    const spire = spawnBuilding(w, 'thornspire', ENEMY, 30, 30);
    const bows = spawnGroup(w, 'bowman', PLAYER, 5, 20, 30.5);
    const dest = { x: spire.x + 4, y: spire.y };
    expect(issueCommand(w, { type: 'attackMove', unitIds: ids(bows), x: dest.x, y: dest.y }).ok).toBe(true);
    const arrivedAt = new Map<number, number>();
    for (let i = 0; i < 20 * 25 && arrivedAt.size < bows.length; i++) {
      step(w, 0.05);
      for (const b of bows) {
        if (!arrivedAt.has(b.id) && b.order.type !== 'attackMove') arrivedAt.set(b.id, Math.hypot(b.x - dest.x, b.y - dest.y));
      }
    }
    expect(arrivedAt.size).toBe(5);
    for (const d of arrivedAt.values()) expect(d).toBeLessThanOrEqual(1.5);
    expect(spire.hp).toBe(THORNSPIRE.hp);
  });

  it('idle Bowmen, Coursers and Firebrand Bowmen near an enemy Nest leave it alone', () => {
    for (const playerEffects of [[], BOONS.firebrand.effects]) {
      const w = arena({ playerEffects });
      const nest = spawnBuilding(w, 'thorn_nest', ENEMY, 30, 30);
      const bows = spawnGroup(w, 'bowman', PLAYER, 3, 25, 31.5);
      const c = spawnUnit(w, 'courser', PLAYER, 31.5, 26);
      for (const u of [...bows, c]) expect(edgeDistance(u, nest)).toBeLessThan(6);
      step(w, 20);
      expect(nest.hp).toBe(nest.maxHp);
    }
  });

  it('idle Bowmen shot by a Thornspire step out of its range within 5 s and stay out', () => {
    const w = arena();
    const spire = spawnBuilding(w, 'thornspire', ENEMY, 30, 30);
    const bows = spawnGroup(w, 'bowman', PLAYER, 3, 26, 30.5);
    for (const b of bows) expect(edgeDistance(b, spire)).toBeLessThan(SPIRE_RANGE);
    const t = stepUntil(w, () => bows.every((b) => edgeDistance(b, spire) > SPIRE_RANGE), 5);
    expect(t).toBeLessThanOrEqual(5);
    step(w, 1); // spines already in flight may still land
    const hp = bows.map((b) => b.hp);
    step(w, 10);
    expect(bows.map((b) => b.hp)).toEqual(hp);
    expect(bows.every((b) => b.alive && b.order.type === 'idle' && edgeDistance(b, spire) > SPIRE_RANGE)).toBe(true);
    expect(spire.hp).toBe(THORNSPIRE.hp);
  });

  it('a wall of trees behind them: they step out around it instead of stalling inside the range', () => {
    // Forest columns x 21-24 cover the straight-out spot west of the spire.
    const w = makeWorld({}, { forest: { x0: 21, y0: 22, x1: 24, y1: 39 } });
    clearUnits(w);
    w.debug.revealAll = true;
    const spire = spawnBuilding(w, 'thornspire', ENEMY, 30, 30);
    const bows = spawnGroup(w, 'bowman', PLAYER, 3, 26.5, 30.5);
    const t = stepUntil(w, () => bows.every((b) => edgeDistance(b, spire) > SPIRE_RANGE), 6);
    expect(t).toBeLessThanOrEqual(6);
    step(w, 1);
    const hp = bows.map((b) => b.hp);
    step(w, 10);
    expect(bows.map((b) => b.hp)).toEqual(hp);
    expect(bows.every((b) => b.alive && edgeDistance(b, spire) > SPIRE_RANGE)).toBe(true);
  });

  it('real map (Raze d1 seed 3207855854): trees behind them, they still get clear and stop taking spines', () => {
    // The straight-out spot is behind trees; the first version stalled at the range edge and died.
    const setup = quickBattleSetup({ objective: 'raze', depth: 1, seed: 3207855854 });
    const gen = generateMap({ seed: setup.seed, objective: setup.objective, biome: setup.biome, depth: setup.depth, modifiers: setup.modifiers });
    const w = createWorld(setup, gen, { skipEncounter: true });
    w.countdown = 0;
    const h = w.entities.get(w.hearthId)!;
    const sx = Math.floor(h.x) + 9;
    const sy = Math.floor(h.y) - 1;
    const spire = spawnBuilding(w, 'thornspire', ENEMY, sx, sy);
    const bows = [0, 1, 2, 3, 4].map((i) => spawnUnit(w, 'bowman', PLAYER, sx - 4 + (i % 3) * 0.8, sy + 0.1 + Math.floor(i / 3) * 0.8));
    const t = stepUntil(w, () => bows.every((b) => edgeDistance(b, spire) > SPIRE_RANGE), 6);
    expect(t).toBeLessThanOrEqual(6);
    step(w, 1);
    const hp = bows.map((b) => b.hp);
    step(w, 10);
    expect(bows.map((b) => b.hp)).toEqual(hp);
    expect(bows.every((b) => b.alive)).toBe(true);
  });

  it('an explicit attack order from Bowmen on a building still deals damage', () => {
    const w = arena();
    const nest = spawnBuilding(w, 'thorn_nest', ENEMY, 30, 30);
    const bows = spawnGroup(w, 'bowman', PLAYER, 3, 24, 31.5);
    expect(issueCommand(w, { type: 'attack', unitIds: ids(bows), targetId: nest.id }).ok).toBe(true);
    step(w, 5);
    expect(nest.hp).toBeLessThan(nest.maxHp);
    // A smart right-click on the building works the same way.
    const nest2 = spawnBuilding(w, 'thorn_nest', ENEMY, 30, 20);
    expect(issueCommand(w, { type: 'smart', unitIds: ids(bows), x: nest2.x, y: nest2.y, targetId: nest2.id }).ok).toBe(true);
    step(w, 8);
    expect(nest2.hp).toBeLessThan(nest2.maxHp);
  });

  it('idle Ashpikes and Brandbows still auto-acquire a nearby enemy building', () => {
    for (const type of ['ashpike', 'brandbow'] as const) {
      const w = arena();
      const nest = spawnBuilding(w, 'thorn_nest', ENEMY, 30, 30);
      spawnUnit(w, type, PLAYER, 26, 31.5);
      step(w, 6);
      expect(nest.hp, type).toBeLessThan(nest.maxHp);
    }
  });
});
