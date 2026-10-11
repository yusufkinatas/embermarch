/**
 * Warden abilities (§N), Hawk, Second Wind, Warden respawn, Rally the Hearth (§E), Last Stand (§B).
 */
import { describe, expect, it } from 'vitest';
import { BOONS } from '../../src/data/boons';
import { HOUSES } from '../../src/data/houses';
import { RESEARCH } from '../../src/data/research';
import { dealAbilityDamage } from '../../src/sim/combat';
import { killEntity, spawnUnit } from '../../src/sim/entities';
import { orderUnit } from '../../src/sim/orders';
import { gatherRate } from '../../src/sim/stats';
import { drainEvents, issueCommand } from '../../src/sim/world';
import type { Building, Unit, World } from '../../src/sim/types';
import { ENEMY, PLAYER } from '../../src/sim/types';
import { clearUnits, makeWorld, step, stepUntil, units } from './helpers';

function hearthOf(w: World): Building {
  return w.buildings.find((b) => b.type === 'hearth')!;
}
function wardenOf(w: World): Unit {
  return w.entities.get(w.wardenId) as Unit;
}

describe('house abilities', () => {
  it('Rallying Horn (Ardent): allies within 6 get +25% attack speed and +15% speed for 8 s; cooldown 45 s', () => {
    const w = makeWorld({ house: 'ardent' });
    const wd = wardenOf(w);
    const near = spawnUnit(w, 'ashpike', PLAYER, wd.x + 2, wd.y);
    const far = spawnUnit(w, 'ashpike', PLAYER, wd.x + 12, wd.y + 12);
    expect(issueCommand(w, { type: 'ability', slot: 'Q' }).ok).toBe(true);
    step(w, 0.1);
    expect(near.buffs.some((b) => b.id === 'rallying_horn')).toBe(true);
    expect(far.buffs.length).toBe(0);
    expect(near.speed).toBeCloseTo(2 * 1.15, 6);
    const r = issueCommand(w, { type: 'ability', slot: 'Q' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Ready in 45 s/);
    step(w, 8.1);
    expect(near.speed).toBeCloseTo(2, 6);
  });

  it('Harvest Hymn (Tallow): Tillers within 8 gather +60% for 15 s', () => {
    const w = makeWorld({ house: 'tallow', playerEffects: HOUSES.tallow.effects });
    const t = units(w, PLAYER, 'tiller')[0];
    expect(issueCommand(w, { type: 'ability', slot: 'Q' }).ok).toBe(true);
    expect(t.buffs.find((b) => b.id === 'harvest_hymn')?.data?.gatherPct).toBe(60);
    expect(gatherRate(w, PLAYER, 'thicket', false, 60)).toBeCloseTo(1.6, 6);
  });

  it('Firepot (Grimbrand): ground target ≤ 7 tiles, lands after 1 s for 50 + burn 3/s', () => {
    const w = makeWorld({ house: 'grimbrand' });
    clearUnits(w);
    w.debug.revealAll = true;
    const wd = spawnUnit(w, 'warden', PLAYER, 30, 34);
    orderUnit(w, wd, { type: 'hold' });
    expect(issueCommand(w, { type: 'ability', slot: 'Q', x: wd.x + 9, y: wd.y }).reason).toBe('Out of range');
    const foe = spawnUnit(w, 'thornhusk', ENEMY, wd.x + 5, wd.y);
    orderUnit(w, foe, { type: 'hold' });
    foe.hp = foe.maxHp = 1000;
    expect(issueCommand(w, { type: 'ability', slot: 'Q', x: foe.x, y: foe.y }).ok).toBe(true);
    step(w, 0.9);
    expect(foe.hp).toBe(1000);
    step(w, 0.2);
    // 50 vs armor 3 = 38, then burn 3/s.
    expect(1000 - foe.hp).toBeGreaterThanOrEqual(38);
    expect(foe.burns.some((b) => b.dps === 3)).toBe(true);
  });

  it('Ember Volley (Lowmere): the Hearth fires 3 bolts per volley for 10 s', () => {
    const w = makeWorld({ house: 'lowmere' });
    w.debug.revealAll = true;
    const h = hearthOf(w);
    const foes = [0, 1, 2].map((i) => spawnUnit(w, 'thornhusk', ENEMY, h.x + 5, h.y - 1 + i));
    for (const f of foes) f.hp = f.maxHp = 2000;
    expect(issueCommand(w, { type: 'ability', slot: 'Q' }).ok).toBe(true);
    drainEvents(w);
    step(w, 0.05);
    expect(w.projectiles.filter((p) => p.kind === 'bolt' && p.sourceId === h.id)).toHaveLength(3);
  });

  it('Hawk needs the flag; reveals radius 7 for 6 s; Second Wind cuts cooldowns by 30%', () => {
    const w = makeWorld();
    expect(issueCommand(w, { type: 'ability', slot: 'W', x: 40, y: 40 }).reason).toBe('Hawk is not unlocked');
    const w2 = makeWorld({ playerEffects: [{ kind: 'flag', flag: 'hawk' }, ...BOONS.second_wind.effects] });
    expect(issueCommand(w2, { type: 'ability', slot: 'W', x: 40, y: 40 }).ok).toBe(true);
    step(w2, 0.25);
    expect(w2.fog.state[40 * w2.map.w + 40]).toBe(2);
    expect(w2.players[PLAYER].abilityReadyTick.W).toBe(Math.round(50 * 0.7 * 20));
    step(w2, 6);
    expect(w2.fog.state[40 * w2.map.w + 40]).toBe(1);
  });
});

describe('Warden respawn', () => {
  it('respawns at the Hearth after 45 s, then 60 s; Second Wind 25 s then 30 s', () => {
    const run = (secondWind: boolean): number[] => {
      const w = makeWorld(secondWind ? { playerEffects: BOONS.second_wind.effects } : {});
      const out: number[] = [];
      for (let i = 0; i < 2; i++) {
        drainEvents(w);
        killEntity(w, wardenOf(w), 0);
        expect(w.wardenId).toBe(0);
        expect(drainEvents(w).some((e) => e.t === 'alert' && e.kind === 'warden_fallen')).toBe(true);
        out.push(stepUntil(w, () => w.wardenId !== 0, 120));
      }
      return out;
    };
    const plain = run(false);
    expect(plain[0]).toBeCloseTo(45, 0);
    expect(plain[1]).toBeCloseTo(60, 0);
    const sw = run(true);
    expect(sw[0]).toBeCloseTo(25, 0);
    expect(sw[1]).toBeCloseTo(30, 0);
  });

  it('wardenHpPct applies at battle start only', () => {
    const w = makeWorld({ wardenHpPct: 0.5 });
    expect(wardenOf(w).hp).toBe(200);
    expect(wardenOf(w).maxHp).toBe(400);
  });
});

describe('Rally the Hearth', () => {
  it('Tillers within 8 drop loads, gain +2 ATK/+1 armor, fight within 5 and resume their jobs after 15 s', () => {
    const w = makeWorld();
    w.debug.revealAll = true;
    const h = hearthOf(w);
    const ts = units(w, PLAYER, 'tiller');
    const th = w.resources.find((r) => r.type === 'thicket')!;
    for (const t of ts) orderUnit(w, t, { type: 'gather', target: { kind: 'node', id: th.id } });
    step(w, 6);
    const loaded = ts.find((t) => t.carry && t.carry.amount > 0);
    expect(loaded).toBeDefined();
    const foe = spawnUnit(w, 'thornling', ENEMY, h.x + 4, h.y + 3.5);
    const rallyTick = w.tick;
    expect(issueCommand(w, { type: 'rallyHearth' }).ok).toBe(true);
    for (const t of ts) {
      expect(t.carry).toBeNull();
      expect(t.buffs.some((b) => b.id === 'rally_hearth')).toBe(true);
    }
    expect(issueCommand(w, { type: 'rallyHearth' }).ok).toBe(false);
    step(w, 6);
    expect(foe.alive).toBe(false);
    step(w, 10);
    for (const t of ts) expect(t.order.type).toBe('gather');
    expect(w.players[PLAYER].rallyReadyTick).toBe(rallyTick + 180 * 20);
  });

  it('Hearth Watch: cooldown 120 s, duration 25 s', () => {
    const w = makeWorld({ playerEffects: RESEARCH.hearth_watch.effects });
    expect(issueCommand(w, { type: 'rallyHearth' }).ok).toBe(true);
    expect(w.players[PLAYER].rallyReadyTick).toBe(120 * 20);
    expect(w.players[PLAYER].rallyUntilTick).toBe(25 * 20);
  });
});

describe('Last Stand (boss only)', () => {
  it('spends Resolve: Hearth back to 40%, invulnerable 5 s, 150 + knockback to enemies within 6, free Rally', () => {
    const w = makeWorld({ objective: 'boss', isBoss: true, resolve: 1 });
    const h = hearthOf(w);
    const foe = spawnUnit(w, 'thornhusk', ENEMY, h.tx + h.w + 1.5, h.y);
    const x0 = foe.x;
    drainEvents(w);
    dealAbilityDamage(w, h, 99999, foe.id);
    expect(h.alive).toBe(true);
    expect(h.hp).toBe(Math.round(h.maxHp * 0.4));
    expect(h.invulnerable).toBe(true);
    expect(w.lastStandsUsed).toBe(1);
    expect(foe.hp).toBe(200 - 115);
    expect(foe.x).toBeGreaterThan(x0 + 2);
    const ev = drainEvents(w);
    expect(ev.some((e) => e.t === 'lastStand')).toBe(true);
    expect(ev.some((e) => e.t === 'alert' && e.kind === 'last_stand')).toBe(true);
    expect(units(w, PLAYER, 'tiller').every((t) => t.buffs.some((b) => b.id === 'rally_hearth'))).toBe(true);
    expect(dealAbilityDamage(w, h, 99999, foe.id)).toBe(0);
    step(w, 5.1);
    expect(h.invulnerable).toBe(false);
    dealAbilityDamage(w, h, 99999, foe.id);
    expect(h.alive).toBe(false);
    step(w, 0.05);
    expect(w.outcome).toBe('defeat');
  });

  it('never outside the boss battle', () => {
    const w = makeWorld({ resolve: 3 });
    const h = hearthOf(w);
    dealAbilityDamage(w, h, 99999, 0);
    step(w, 0.05);
    expect(w.outcome).toBe('defeat');
    expect(w.lastStandsUsed).toBe(0);
  });
});
