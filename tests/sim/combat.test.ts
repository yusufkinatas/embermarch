/**
 * Damage pipeline (GDD §G): verified 1v1 numbers, counters, structures, resist, charge, Spent,
 * rank, dynamic buffs, popups, burn, splash, kill credit / rank-ups.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { INCOME, armorDamage } from '../../src/data/balance';
import { BOONS } from '../../src/data/boons';
import { MODIFIERS } from '../../src/data/modifiers';
import { RESEARCH } from '../../src/data/research';
import { applyBurn, applyPacket, canAttack, computeDamagePacket, dealAbilityDamage } from '../../src/sim/combat';
import { killEntity, spawnBuilding, spawnUnit } from '../../src/sim/entities';
import { orderUnit } from '../../src/sim/orders';
import { drainEvents } from '../../src/sim/world';
import type { Effect, Entity, GameEvent, Unit, UnitId, World } from '../../src/sim/types';
import { ENEMY, PLAYER } from '../../src/sim/types';
import { clearUnits, makeWorld, step } from './helpers';

/** Damage one hit of `a` on `t` deals (applied then reverted). */
function hit(w: World, a: Entity, t: Entity): number {
  const before = t.hp;
  const evBefore = w.events.length;
  applyPacket(w, a.id, t, computeDamagePacket(w, a, t));
  const dealt = before - t.hp;
  t.hp = before;
  t.alive = true;
  w.events.length = evBefore;
  return dealt;
}

function arena(playerEffects: Effect[] = []): World {
  const w = makeWorld({ playerEffects });
  clearUnits(w);
  w.debug.revealAll = true;
  return w;
}

function pu(w: World, type: UnitId, x = 30, y = 30): Unit {
  return spawnUnit(w, type, PLAYER, x, y);
}
function eu(w: World, type: UnitId, x = 31, y = 30): Unit {
  return spawnUnit(w, type, ENEMY, x, y);
}

describe('GDD §G verified 1v1 checks', () => {
  let w: World;
  beforeEach(() => {
    w = arena();
  });

  it('Ashpike vs Courser: 14 per hit (Courser dies to the 7th); Courser deals 5', () => {
    const a = pu(w, 'ashpike');
    const c = eu(w, 'courser');
    expect(hit(w, a, c)).toBe(14);
    expect(Math.ceil(85 / 14)).toBe(7);
    expect(hit(w, c, a)).toBe(5);
  });

  it('Courser vs Bowman: 12 per hit (3 hits); Bowman deals 5 (17 hits)', () => {
    const c = pu(w, 'courser');
    const b = eu(w, 'bowman');
    expect(hit(w, c, b)).toBe(12);
    expect(hit(w, b, c)).toBe(5);
  });

  it('Ashpike vs Destrier: 12 each way, Charge negated by spears', () => {
    const a = pu(w, 'ashpike');
    const d = eu(w, 'destrier');
    d.movedSinceAttack = 5;
    expect(hit(w, a, d)).toBe(12);
    expect(hit(w, d, a)).toBe(12);
    // ...but a Charge lands on a Bowman: 13 × 1.5 × 2 = 39.
    const b = pu(w, 'bowman', 32, 30);
    expect(computeDamagePacket(w, d, b).raw).toBe(39);
    d.movedSinceAttack = 2;
    expect(armorDamage(computeDamagePacket(w, d, b).raw, 0)).toBe(20);
  });

  it('Thornling breakpoints (24 HP): Bowman 3 hits (2 with Barbed Heads), Ashpike 5 (4 with Discipline / Ember Edge)', () => {
    const t = eu(w, 'thornling');
    expect(Math.ceil(24 / hit(w, pu(w, 'bowman'), t))).toBe(3);
    expect(Math.ceil(24 / hit(w, pu(w, 'ashpike'), t))).toBe(5);
    const w2 = arena([...RESEARCH.barbed_heads.effects, ...RESEARCH.ember_edge.effects]);
    const t2 = eu(w2, 'thornling');
    expect(Math.ceil(24 / hit(w2, pu(w2, 'bowman'), t2))).toBe(2);
    expect(Math.ceil(24 / hit(w2, pu(w2, 'ashpike'), t2))).toBe(4);
    const w3 = arena(BOONS.pike_discipline.effects);
    expect(Math.ceil(24 / hit(w3, pu(w3, 'ashpike'), eu(w3, 'thornling')))).toBe(4);
  });

  it('Gatebreaker: 92 vs a Nest (138 while Spent), 30 vs the Regent; cannot hit units', () => {
    const g = pu(w, 'gatebreaker', 20, 20);
    const nest = spawnBuilding(w, 'thorn_nest', ENEMY, 21, 19);
    expect(hit(w, g, nest)).toBe(92);
    nest.nest = { index: 0, spent: true, spentUntil: 9999, blightRadius: 0, seen: true, musterProgress: 0 };
    expect(hit(w, g, nest)).toBe(138);
    const regent = eu(w, 'briar_regent', 25, 25);
    expect(hit(w, g, regent)).toBe(30);
    expect(canAttack(w, g, regent)).toBe(true);
    expect(canAttack(w, g, eu(w, 'thornling', 20, 22))).toBe(false);
  });
});

describe('counters, resist and structures', () => {
  let w: World;
  beforeEach(() => {
    w = arena();
  });

  it('no counters against the Warden (hero)', () => {
    const c = eu(w, 'stagrider');
    const warden = pu(w, 'warden');
    // Stagrider 7 vs armor 3, no ×1.5-vs-worker style bonus applies to heroes.
    expect(hit(w, c, warden)).toBe(armorDamage(7, 3));
    expect(computeDamagePacket(w, c, warden).mult).toBe(1);
  });

  it('Oathshield takes ×0.5 from ranged (incl. Hearth bolts), not melee', () => {
    const o = pu(w, 'oathshield');
    const sc = eu(w, 'spinecaster');
    expect(computeDamagePacket(w, sc, o).mult).toBeCloseTo(1.5 * 0.5, 6);
    expect(hit(w, sc, o)).toBe(armorDamage(5 * 0.75, 3));
    const t = eu(w, 'thornling', 30, 31);
    expect(computeDamagePacket(w, t, o).mult).toBe(1);
    const thornhusk = eu(w, 'thornhusk', 35, 35);
    const hearth = w.buildings.find((b) => b.type === 'hearth')!;
    const p = computeDamagePacket(w, hearth, thornhusk);
    expect(p.raw).toBe(5);
    expect(p.unitsOnly).toBe(true);
  });

  it('structure multipliers per class and the minimum of 1 damage', () => {
    const nest = spawnBuilding(w, 'thorn_nest', ENEMY, 21, 19);
    expect(hit(w, pu(w, 'ashpike', 20, 20), nest)).toBe(armorDamage(5 * 0.7, 3));
    expect(hit(w, pu(w, 'bowman', 20, 21), nest)).toBe(1);
    expect(hit(w, pu(w, 'warden', 20, 22), nest)).toBe(armorDamage(14 * 0.8, 3));
    expect(hit(w, pu(w, 'tiller', 20, 23), nest)).toBe(1);
    const g = eu(w, 'rootbreaker', 30, 30);
    expect(hit(w, pu(w, 'bowman', 30, 33), g)).toBe(1);
  });

  it('rank multiplies damage; Rank III adds armor', () => {
    const a = spawnUnit(w, 'ashpike', PLAYER, 30, 30, { rank: 1 });
    const c = eu(w, 'courser');
    expect(hit(w, a, c)).toBe(armorDamage(5 * 1.15 * 3, 1));
    const vet = spawnUnit(w, 'ashpike', ENEMY, 33, 33, { rank: 3 });
    expect(hit(w, pu(w, 'courser', 34, 33), vet)).toBe(armorDamage(6, 2));
  });

  it('dynamic bonuses: Banner of the Last Flame, Rally buff, Warlord’s Gambit', () => {
    const wb = arena([...BOONS.flame_banner.effects, ...BOONS.warlords_gambit.effects]);
    pu(wb, 'warden', 30, 30);
    const near = pu(wb, 'ashpike', 32, 30);
    const far = pu(wb, 'ashpike', 40, 40);
    const c1 = eu(wb, 'courser', 33, 30);
    const c2 = eu(wb, 'courser', 41, 40);
    expect(computeDamagePacket(wb, near, c1).raw).toBeCloseTo(5 * 1.15 * 1.25 * 3, 6);
    expect(computeDamagePacket(wb, far, c2).raw).toBeCloseTo(5 * 1.25 * 3, 6);
    const t = pu(w, 'tiller');
    t.buffs.push({ id: 'rally_hearth', until: 1e9, data: { atkFlat: 2, armor: 1 } });
    expect(computeDamagePacket(w, t, eu(w, 'thornling')).raw).toBe(5);
    expect(hit(w, eu(w, 'thornling', 30, 31), t)).toBe(armorDamage(3, 1));
  });
});

describe('applyPacket side effects', () => {
  it('hit events with counter / resisted popups throttled per attacker (1.5 s)', () => {
    const w = arena();
    const a = pu(w, 'ashpike');
    const c = eu(w, 'courser');
    drainEvents(w);
    applyPacket(w, a.id, c, computeDamagePacket(w, a, c));
    applyPacket(w, a.id, c, computeDamagePacket(w, a, c));
    const hits = drainEvents(w).filter((e): e is Extract<GameEvent, { t: 'hit' }> => e.t === 'hit');
    expect(hits.map((h) => h.popup)).toEqual(['counter', null]);
    expect(hits[0].mult).toBe(3);
    step(w, 1.6);
    const b = pu(w, 'bowman', 20, 20);
    const nest = spawnBuilding(w, 'thorn_nest', ENEMY, 22, 20);
    drainEvents(w);
    applyPacket(w, b.id, nest, computeDamagePacket(w, b, nest));
    const h2 = drainEvents(w).find((e) => e.t === 'hit') as Extract<GameEvent, { t: 'hit' }>;
    expect(h2.popup).toBe('resisted');
    expect(h2.isStructure).toBe(true);
  });

  it('burn: units only, max 3 appliers, refresh, disabled by Downpour, kill credit to the burner', () => {
    const w = arena();
    const bb = pu(w, 'brandbow');
    const t = eu(w, 'thornling');
    applyPacket(w, bb.id, t, computeDamagePacket(w, bb, t));
    expect(t.burns).toHaveLength(1);
    const nest = spawnBuilding(w, 'thorn_nest', ENEMY, 40, 40);
    const p = computeDamagePacket(w, bb, nest);
    expect(p.burn).toBeDefined();
    applyPacket(w, bb.id, nest, p);
    for (let i = 0; i < 4; i++) applyBurn(w, t, 1000 + i, 2, 3);
    expect(t.burns).toHaveLength(3);
    // A burn tick that kills credits the applier (victim far out of bow range).
    t.alive = false;
    const victim = eu(w, 'thornling', 45, 45);
    victim.hp = 3;
    applyBurn(w, victim, bb.id, 2, 3);
    const k0 = bb.kills;
    step(w, 2);
    expect(victim.alive).toBe(false);
    expect(bb.kills).toBe(k0 + 1);
    const wd = arena(MODIFIERS.downpour.playerEffects ?? []);
    wd.players[ENEMY].flags = { burn_disabled: 1 };
    const bb2 = pu(wd, 'brandbow');
    const t2 = eu(wd, 'thornling');
    expect(computeDamagePacket(wd, bb2, t2).burn).toBeUndefined();
    applyBurn(wd, t2, bb2.id, 2, 3);
    expect(t2.burns).toHaveLength(0);
  });

  it('Firebrand Arrows: Bowman hits burn', () => {
    const w = arena(BOONS.firebrand.effects);
    expect(computeDamagePacket(w, pu(w, 'bowman'), eu(w, 'thornling')).burn).toEqual({ dps: 2, duration: 3 });
  });

  it('splash with falloff hits the target owner’s other units', () => {
    const w = arena();
    const regent = eu(w, 'briar_regent', 30, 30);
    const a = pu(w, 'ashpike', 31.6, 30);
    const b = pu(w, 'ashpike', 32.4, 30);
    const far = pu(w, 'ashpike', 36, 30);
    applyPacket(w, regent.id, a, computeDamagePacket(w, regent, a));
    expect(a.hp).toBe(60 - armorDamage(40, 1));
    expect(b.hp).toBeLessThan(60);
    expect(60 - b.hp).toBeLessThanOrEqual(60 - a.hp);
    expect(far.hp).toBe(60);
  });

  it('kills grant credit and rank-ups (3/7/12) that raise current HP proportionally', () => {
    const w = arena();
    const a = pu(w, 'ashpike');
    a.kills = 2;
    a.hp = 30;
    const t = eu(w, 'thornling');
    t.hp = 1;
    applyPacket(w, a.id, t, computeDamagePacket(w, a, t));
    expect(t.alive).toBe(false);
    expect(a.kills).toBe(3);
    expect(a.rank).toBe(1);
    expect(a.maxHp).toBe(69);
    expect(a.hp).toBeCloseTo(34.5, 6);
    expect(w.players[PLAYER].stats.kills).toBe(1);
    expect(drainEvents(w).some((e) => e.t === 'rankUp')).toBe(true);
  });

  it('Spoils of the Wake pays per enemy unit killed; invulnerable / untargetable rules', () => {
    const w = arena(BOONS.spoils_of_the_wake.effects);
    const a = pu(w, 'ashpike');
    const g0 = w.players[PLAYER].res.grain;
    const e0 = w.players[PLAYER].res.ember;
    const t = eu(w, 'thornling');
    dealAbilityDamage(w, t, 999, a.id);
    expect(w.players[PLAYER].res.grain).toBe(g0 + 3);
    expect(w.players[PLAYER].res.ember).toBe(e0 + 1);
    const t2 = eu(w, 'thornling', 33, 33);
    t2.invulnerable = true;
    expect(dealAbilityDamage(w, t2, 50, a.id)).toBe(0);
    t2.untargetable = true;
    expect(canAttack(w, a, t2)).toBe(false);
    expect(canAttack(w, pu(w, 'lampbearer', 33, 32), t2)).toBe(false);
  });
});

describe('kill credit when the attacker died before its hit landed', () => {
  it('an arrow from a dead Bowman still counts the kill and Spoils of the Wake', () => {
    const w = arena(BOONS.spoils_of_the_wake.effects);
    const p = w.players[PLAYER];
    const bow = pu(w, 'bowman', 20, 30);
    const foe = eu(w, 'thornling', 25, 30);
    foe.order = { type: 'hold' };
    foe.hp = 1;
    orderUnit(w, bow, { type: 'attack', targetId: foe.id });
    for (let i = 0; i < 60 && !w.projectiles.some((pr) => pr.alive && pr.sourceId === bow.id); i++) step(w, 0.05);
    expect(w.projectiles.some((pr) => pr.alive && pr.sourceId === bow.id)).toBe(true);
    expect(foe.alive).toBe(true);
    killEntity(w, bow, foe.id);
    step(w, 0.05);
    expect(w.entities.has(bow.id)).toBe(false);
    const kills0 = p.stats.kills;
    const grain0 = p.res.grain;
    step(w, 1.5);
    expect(foe.alive).toBe(false);
    expect(p.stats.kills).toBe(kills0 + 1);
    expect(p.res.grain - grain0).toBe(INCOME.spoilsPerKill.grain);
  });

  it('a burn tick from a dead Brandbow still counts the kill and Spoils of the Wake', () => {
    const w = arena(BOONS.spoils_of_the_wake.effects);
    const p = w.players[PLAYER];
    const bb = pu(w, 'brandbow', 20, 30);
    const foe = eu(w, 'briarguard', 25, 30);
    foe.order = { type: 'hold' };
    orderUnit(w, bb, { type: 'attack', targetId: foe.id });
    for (let i = 0; i < 100 && foe.burns.length === 0; i++) step(w, 0.05);
    expect(foe.burns.length).toBeGreaterThan(0);
    expect(foe.burns[0].applierOwner).toBe(PLAYER);
    killEntity(w, bb, foe.id);
    for (const pr of w.projectiles) pr.alive = false; // only the burn may finish it
    step(w, 0.05);
    expect(w.entities.has(bb.id)).toBe(false);
    expect(foe.alive).toBe(true);
    foe.hp = 0.3;
    const kills0 = p.stats.kills;
    const grain0 = p.res.grain;
    step(w, 1);
    expect(foe.alive).toBe(false);
    expect(p.stats.kills).toBe(kills0 + 1);
    expect(p.res.grain - grain0).toBe(INCOME.spoilsPerKill.grain);
  });

  it('rank-ups still need a live killer', () => {
    const w = arena();
    const bow = pu(w, 'bowman', 20, 30);
    bow.kills = 2;
    const foe = eu(w, 'thornling', 25, 30);
    foe.hp = 1;
    applyPacket(w, bow.id, foe, computeDamagePacket(w, bow, foe), PLAYER);
    expect(bow.kills).toBe(3);
    expect(bow.rank).toBe(1);
  });
});
