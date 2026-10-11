/**
 * Production (GDD §D, §E, §H): training, queues, refunds, pop cap hold, spawning, rally,
 * research one at a time, Temper lock, requirements.
 */
import { describe, expect, it } from 'vitest';
import { killEntity, spawnBuilding, spawnUnit } from '../../src/sim/entities';
import { carryCap } from '../../src/sim/stats';
import { drainEvents, issueCommand } from '../../src/sim/world';
import type { Building, World } from '../../src/sim/types';
import { PLAYER } from '../../src/sim/types';
import { makeWorld, step, stepUntil, units } from './helpers';

function hearthOf(w: World): Building {
  return w.buildings.find((b) => b.type === 'hearth')!;
}

describe('training', () => {
  it('a Tiller is paid on queue and appears after 10 s next to the Hearth', () => {
    const w = makeWorld();
    const p = w.players[PLAYER];
    const h = hearthOf(w);
    const n0 = units(w, PLAYER, 'tiller').length;
    const pop0 = p.pop;
    expect(issueCommand(w, { type: 'train', buildingIds: [h.id], unit: 'tiller' }).ok).toBe(true);
    expect(p.res.grain).toBe(200);
    step(w, 9.9);
    expect(units(w, PLAYER, 'tiller').length).toBe(n0);
    step(w, 0.2);
    const ts = units(w, PLAYER, 'tiller');
    expect(ts.length).toBe(n0 + 1);
    expect(p.pop).toBe(pop0 + 1);
    expect(p.stats.unitsTrained).toBe(1);
    const nu = ts[ts.length - 1];
    const dx = Math.max(h.tx - nu.x, 0, nu.x - (h.tx + h.w));
    const dy = Math.max(h.ty - nu.y, 0, nu.y - (h.ty + h.h));
    expect(Math.hypot(dx, dy)).toBeLessThan(2);
    expect(drainEvents(w).some((e) => e.t === 'trained' && e.type === 'tiller')).toBe(true);
  });

  it('5-slot queue, 100% refund on cancel, shortest queue across selected buildings', () => {
    const w = makeWorld({ bonusRes: { grain: 2000, timber: 2000 } });
    const p = w.players[PLAYER];
    const mh = w.buildings.find((b) => b.type === 'muster_hall')!;
    expect(issueCommand(w, { type: 'train', buildingIds: [mh.id], unit: 'ashpike', count: 5 }).ok).toBe(true);
    expect(mh.queue).toHaveLength(5);
    const r = issueCommand(w, { type: 'train', buildingIds: [mh.id], unit: 'ashpike' });
    expect(r).toEqual({ ok: false, reason: 'Queue full' });
    const g = p.res.grain;
    expect(issueCommand(w, { type: 'cancelTrain', buildingId: mh.id, index: 2 }).ok).toBe(true);
    expect(p.res.grain).toBe(g + 35);
    expect(mh.queue).toHaveLength(4);
    const mh2 = spawnBuilding(w, 'muster_hall', PLAYER, 24, 24);
    issueCommand(w, { type: 'train', buildingIds: [mh.id, mh2.id], unit: 'ashpike', count: 3 });
    expect(mh.queue.length).toBe(4);
    expect(mh2.queue.length).toBe(3);
  });

  it('not enough resources / not drafted / missing Forgehall give reasons', () => {
    const w = makeWorld({ unlockedUnits: ['tiller', 'warden', 'ashpike', 'bowman', 'courser', 'brandbow'] });
    const p = w.players[PLAYER];
    p.res.grain = 10;
    const h = hearthOf(w);
    expect(issueCommand(w, { type: 'train', buildingIds: [h.id], unit: 'tiller' }).reason).toBe('Not enough Grain');
    p.res.grain = 500;
    const mh = w.buildings.find((b) => b.type === 'muster_hall')!;
    expect(issueCommand(w, { type: 'train', buildingIds: [mh.id], unit: 'oathshield' }).reason).toBe('Not drafted');
    const by = spawnBuilding(w, 'bowyard', PLAYER, 24, 24);
    expect(issueCommand(w, { type: 'train', buildingIds: [by.id], unit: 'brandbow' }).reason).toBe('Requires a Forgehall');
    spawnBuilding(w, 'forgehall', PLAYER, 30, 24);
    expect(issueCommand(w, { type: 'train', buildingIds: [by.id], unit: 'brandbow' }).ok).toBe(true);
  });

  it('pop cap: the head holds at the cap, the alert fires at most every 15 s, training resumes when pop frees', () => {
    const w = makeWorld({ bonusRes: { grain: 5000 } });
    const p = w.players[PLAYER];
    const h = hearthOf(w);
    const free = p.popCap - p.pop;
    for (let i = 0; i < free; i++) spawnUnit(w, 'tiller', PLAYER, 30 + (i % 5), 30 + Math.floor(i / 5));
    expect(p.pop).toBe(p.popCap);
    issueCommand(w, { type: 'train', buildingIds: [h.id], unit: 'tiller', count: 2 });
    drainEvents(w);
    step(w, 20);
    expect(h.queue[0].progress).toBe(0);
    let alerts = drainEvents(w).filter((e) => e.t === 'alert' && e.kind === 'pop_capped').length;
    expect(alerts).toBe(2);
    step(w, 11);
    alerts = drainEvents(w).filter((e) => e.t === 'alert' && e.kind === 'pop_capped').length;
    expect(alerts).toBe(1);
    killEntity(w, units(w, PLAYER, 'tiller')[0], 0);
    step(w, 10.1);
    expect(h.queue).toHaveLength(1);
    expect(p.pop).toBe(p.popCap);
  });

  it('rally on a resource sends new Tillers to gather it', () => {
    const w = makeWorld();
    const h = hearthOf(w);
    const th = w.resources.find((r) => r.type === 'thicket')!;
    expect(issueCommand(w, { type: 'rally', buildingIds: [h.id], x: th.x, y: th.y, targetId: th.id }).ok).toBe(true);
    issueCommand(w, { type: 'train', buildingIds: [h.id], unit: 'tiller' });
    step(w, 10.2);
    const nu = units(w, PLAYER, 'tiller').pop()!;
    expect(nu.order.type).toBe('gather');
    const mh = w.buildings.find((b) => b.type === 'muster_hall')!;
    issueCommand(w, { type: 'rally', buildingIds: [mh.id], x: 30, y: 30 });
    issueCommand(w, { type: 'train', buildingIds: [mh.id], unit: 'ashpike' });
    step(w, 12.2);
    const a = units(w, PLAYER, 'ashpike')[0];
    expect(a.order.type).toBe('move');
    step(w, 10);
    expect(Math.hypot(a.x - 30, a.y - 30)).toBeLessThan(1);
  });
});

describe('research', () => {
  it('one at a time per building; completion composes effects', () => {
    const w = makeWorld({ bonusRes: { grain: 1000, timber: 1000, ember: 1000 } });
    const st = spawnBuilding(w, 'storehouse', PLAYER, 24, 24);
    expect(issueCommand(w, { type: 'research', buildingId: st.id, research: 'log_sledges' }).ok).toBe(true);
    expect(issueCommand(w, { type: 'research', buildingId: st.id, research: 'deep_picks' }).reason).toBe('Researching Log Sledges');
    const st2 = spawnBuilding(w, 'storehouse', PLAYER, 28, 24);
    expect(issueCommand(w, { type: 'research', buildingId: st2.id, research: 'log_sledges' }).reason).toBe('In progress elsewhere');
    drainEvents(w);
    step(w, 25.1);
    expect(w.players[PLAYER].researched).toContain('log_sledges');
    expect(carryCap(w, PLAYER, 'timber')).toBe(15);
    expect(drainEvents(w).some((e) => e.t === 'alert' && e.kind === 'research_complete')).toBe(true);
    expect(issueCommand(w, { type: 'research', buildingId: st2.id, research: 'log_sledges' }).reason).toBe('Already researched');
  });

  it('research HP bonuses apply to living units', () => {
    const w = makeWorld({ bonusRes: { grain: 1000, ember: 1000 } });
    const a = spawnUnit(w, 'ashpike', PLAYER, 30, 30);
    a.hp = 50;
    const mh = w.buildings.find((b) => b.type === 'muster_hall')!;
    issueCommand(w, { type: 'research', buildingId: mh.id, research: 'ash_hafts' });
    step(w, 25.1);
    expect(a.maxHp).toBe(80);
    expect(a.hp).toBe(70);
  });

  it('Temper lock: one per battle, cancel unlocks, refunds 100%', () => {
    const w = makeWorld({ bonusRes: { grain: 1000, timber: 1000, ember: 1000 } });
    const p = w.players[PLAYER];
    const fh = spawnBuilding(w, 'forgehall', PLAYER, 24, 24);
    const e0 = p.res.ember;
    expect(issueCommand(w, { type: 'research', buildingId: fh.id, research: 'ember_edge' }).ok).toBe(true);
    expect(p.temper).toBe('ember_edge');
    const fh2 = spawnBuilding(w, 'forgehall', PLAYER, 30, 24);
    expect(issueCommand(w, { type: 'research', buildingId: fh2.id, research: 'hauberks' }).reason).toBe('Temper chosen: Ember Edge');
    expect(issueCommand(w, { type: 'cancelResearch', buildingId: fh.id }).ok).toBe(true);
    expect(p.temper).toBeNull();
    expect(p.res.ember).toBe(e0);
    expect(issueCommand(w, { type: 'research', buildingId: fh2.id, research: 'hauberks' }).ok).toBe(true);
    step(w, 45.1);
    expect(p.researched).toContain('hauberks');
    expect(issueCommand(w, { type: 'research', buildingId: fh.id, research: 'ember_edge' }).reason).toBe('Temper chosen: Hardened Hauberks');
  });

  it('Forgehall needs a Muster Hall or Bowyard; Siegeyard needs a Forgehall', () => {
    const w = makeWorld({ vanguard: 'storehouse' });
    w.debug.revealAll = true;
    const t = units(w, PLAYER, 'tiller')[0];
    w.players[PLAYER].res.ember = 500;
    w.players[PLAYER].res.timber = 1000;
    expect(issueCommand(w, { type: 'build', unitIds: [t.id], building: 'forgehall', tx: 30, ty: 30 }).reason).toBe(
      'Requires a Muster Hall or Bowyard',
    );
    expect(issueCommand(w, { type: 'build', unitIds: [t.id], building: 'siegeyard', tx: 30, ty: 30 }).reason).toBe('Requires a Forgehall');
    spawnBuilding(w, 'bowyard', PLAYER, 24, 30);
    expect(issueCommand(w, { type: 'build', unitIds: [t.id], building: 'forgehall', tx: 30, ty: 30 }).ok).toBe(true);
  });
});

describe('stepUntil helper sanity', () => {
  it('returns Infinity when the condition never holds', () => {
    const w = makeWorld();
    expect(stepUntil(w, () => false, 0.5)).toBe(Infinity);
  });
});
