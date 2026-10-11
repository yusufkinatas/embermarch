/**
 * Commands (GDD §O smart RMB, groups, queueing, feedback events) and HUD queries
 * (command card slots / hotkeys / reasons, picking, fog, idle Tillers).
 */
import { describe, expect, it } from 'vitest';
import { spawnBuilding, spawnUnit } from '../../src/sim/entities';
import {
  buildOptions,
  canPlaceBuilding,
  commandCard,
  idleTillers,
  isEntityVisible,
  pickEntityAt,
  playerMilitary,
  unitsInRect,
} from '../../src/sim/queries';
import { drainEvents, issueCommand } from '../../src/sim/world';
import type { Building, GameEvent, PlayerBuildingId, World } from '../../src/sim/types';
import { ENEMY, PLAYER } from '../../src/sim/types';
import { clearUnits, makeWorld, step, stepUntil, units } from './helpers';

function cmdEvents(w: World): Extract<GameEvent, { t: 'command' }>[] {
  return drainEvents(w).filter((e): e is Extract<GameEvent, { t: 'command' }> => e.t === 'command');
}

describe('smart command (RMB)', () => {
  it('ground -> move in formation; enemy -> attack; Gatebreaker on a unit -> move', () => {
    const w = makeWorld();
    clearUnits(w);
    w.debug.revealAll = true;
    const army = [0, 1, 2, 3, 4].map((i) => spawnUnit(w, 'ashpike', PLAYER, 20 + i * 0.8, 20));
    const gb = spawnUnit(w, 'gatebreaker', PLAYER, 20, 22);
    drainEvents(w);
    expect(issueCommand(w, { type: 'smart', unitIds: army.map((u) => u.id), x: 30, y: 30 }).ok).toBe(true);
    const slots = new Set(army.map((u) => (u.order.type === 'move' ? `${u.order.x.toFixed(1)},${u.order.y.toFixed(1)}` : 'x')));
    expect(slots.size).toBe(5);
    expect(cmdEvents(w).map((e) => e.kind)).toEqual(['move']);
    step(w, 8);
    for (const u of army) expect(Math.hypot(u.x - 30, u.y - 30)).toBeLessThan(2.5);
    const foe = spawnUnit(w, 'thornling', ENEMY, 34, 30);
    step(w, 0.25);
    issueCommand(w, { type: 'smart', unitIds: [...army.map((u) => u.id), gb.id], x: foe.x, y: foe.y, targetId: foe.id });
    for (const u of army) expect(u.order).toMatchObject({ type: 'attack', targetId: foe.id });
    expect(gb.order.type).toBe('move');
    expect(cmdEvents(w)[0]).toMatchObject({ kind: 'attack', targetId: foe.id });
  });

  it('Tillers: resource -> gather, tree tile -> gather, foundation -> build, drop-off while loaded -> deposit', () => {
    const w = makeWorld();
    w.debug.revealAll = true;
    const ts = units(w, PLAYER, 'tiller');
    const th = w.resources.find((r) => r.type === 'thicket')!;
    issueCommand(w, { type: 'smart', unitIds: [ts[0].id], x: th.x, y: th.y });
    expect(ts[0].order).toMatchObject({ type: 'gather', target: { kind: 'node', id: th.id } });
    issueCommand(w, { type: 'smart', unitIds: [ts[1].id], x: 20.5, y: 6.5 });
    expect(ts[1].order.type === 'gather' && ts[1].order.target.kind === 'tree').toBe(true);
    issueCommand(w, { type: 'build', unitIds: [ts[2].id], building: 'cottage', tx: 30, ty: 30 });
    const f = w.buildings.find((b) => b.type === 'cottage')!;
    issueCommand(w, { type: 'smart', unitIds: [ts[3].id], x: f.x, y: f.y });
    expect(ts[3].order).toMatchObject({ type: 'build', buildingId: f.id });
    ts[4].carry = { type: 'grain', amount: 6 };
    const h = w.buildings.find((b) => b.type === 'hearth')!;
    issueCommand(w, { type: 'smart', unitIds: [ts[4].id], x: h.x, y: h.y });
    expect(ts[4].order).toMatchObject({ type: 'deposit', buildingId: h.id });
    const g0 = w.players[PLAYER].res.grain;
    step(w, 4);
    expect(w.players[PLAYER].res.grain).toBe(g0 + 6 + (w.players[PLAYER].stats.gathered.grain - 6));
  });

  it('shift queues up to 8 orders and runs them in sequence', () => {
    const w = makeWorld();
    clearUnits(w);
    const u = spawnUnit(w, 'courser', PLAYER, 20, 20);
    issueCommand(w, { type: 'move', unitIds: [u.id], x: 24, y: 20 });
    for (let i = 0; i < 10; i++) issueCommand(w, { type: 'move', unitIds: [u.id], x: 24, y: 21 + i, queue: true });
    expect(u.queue).toHaveLength(8);
    step(w, 3);
    expect(u.queue.length).toBeLessThan(8);
    expect(u.order.type).toBe('move');
  });

  it('stop / hold: hold never moves but fights in range', () => {
    const w = makeWorld();
    clearUnits(w);
    w.debug.revealAll = true;
    const b = spawnUnit(w, 'bowman', PLAYER, 20, 20);
    issueCommand(w, { type: 'hold', unitIds: [b.id] });
    const near = spawnUnit(w, 'thornling', ENEMY, 25, 20);
    near.order = { type: 'hold' };
    step(w, 3);
    expect(near.hp).toBeLessThan(24);
    expect(Math.hypot(b.x - 20, b.y - 20)).toBeLessThan(0.05);
    const far = spawnUnit(w, 'thornling', ENEMY, 20, 28);
    far.order = { type: 'hold' };
    near.alive = false;
    step(w, 3);
    expect(far.hp).toBe(24);
    expect(Math.hypot(b.x - 20, b.y - 20)).toBeLessThan(0.05);
  });

  it('idle military auto-acquire within 6 tiles, chase at most 10 tiles, then walk back', () => {
    const w = makeWorld();
    clearUnits(w);
    w.debug.revealAll = true;
    const a = spawnUnit(w, 'courser', PLAYER, 20, 30);
    const foe = spawnUnit(w, 'stagrider', ENEMY, 25, 30);
    foe.hp = foe.maxHp = 5000;
    foe.order = { type: 'move', x: 46, y: 30 };
    step(w, 1);
    expect(a.targetId).toBe(foe.id);
    step(w, 10);
    expect(a.x).toBeLessThan(31.5);
    step(w, 8);
    expect(Math.hypot(a.x - 20, a.y - 30)).toBeLessThan(1.5);
  });

  it('player units ignore enemies hidden by fog', () => {
    const w = makeWorld();
    clearUnits(w);
    const a = spawnUnit(w, 'ashpike', PLAYER, 30, 30);
    const foe = spawnUnit(w, 'thornling', ENEMY, 34, 30);
    step(w, 1);
    expect(isEntityVisible(w, foe)).toBe(true);
    expect(a.targetId).toBe(foe.id);
    const hidden = spawnUnit(w, 'thornling', ENEMY, 44, 44);
    expect(isEntityVisible(w, hidden)).toBe(false);
    expect(pickEntityAt(w, 44, 44)).toBeNull();
    expect(pickEntityAt(w, foe.x, foe.y)).toBe(foe);
  });
});

describe('Shift-build queues per Tiller (GDD §O)', () => {
  /** A free site for `type` near (x, y), skipping `avoid` tiles. */
  function site(w: World, type: PlayerBuildingId, x: number, y: number, avoid: { tx: number; ty: number }[] = []): { tx: number; ty: number } {
    for (let r = 0; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          if (avoid.some((a) => Math.abs(a.tx - tx) < 4 && Math.abs(a.ty - ty) < 4)) continue;
          if (canPlaceBuilding(w, type, tx, ty).ok) return { tx, ty };
        }
      }
    }
    throw new Error('no site');
  }
  function gatheringTiller(w: World) {
    w.debug.revealAll = true;
    const t = units(w, PLAYER, 'tiller')[0];
    const th = w.resources.find((r) => r.type === 'thicket')!;
    expect(issueCommand(w, { type: 'gather', unitIds: [t.id], target: { kind: 'node', id: th.id } }).ok).toBe(true);
    step(w, 3);
    expect(t.order.type).toBe('gather');
    return { t, th };
  }
  const newest = (w: World, type: string): Building => w.buildings.filter((b) => b.type === type).at(-1)!;

  it('a gathering Tiller given a queued build starts it now, keeps its job and resumes gathering', () => {
    const w = makeWorld();
    const { t, th } = gatheringTiller(w);
    const s1 = site(w, 'cottage', 14, 3);
    expect(issueCommand(w, { type: 'build', unitIds: [t.id], building: 'cottage', tx: s1.tx, ty: s1.ty, queue: true }).ok).toBe(true);
    const c = newest(w, 'cottage');
    expect(t.order).toMatchObject({ type: 'build', buildingId: c.id });
    expect(t.queue).toHaveLength(0);
    expect(t.job).toEqual({ kind: 'node', id: th.id });
    expect(stepUntil(w, () => c.built, 90)).toBeLessThan(90);
    step(w, 0.5);
    expect(t.order).toMatchObject({ type: 'gather', target: { kind: 'node', id: th.id } });
  });

  it('a Tiller already building keeps building A, queues B and builds B after A', () => {
    const w = makeWorld();
    const { t, th } = gatheringTiller(w);
    const s1 = site(w, 'cottage', 14, 3);
    issueCommand(w, { type: 'build', unitIds: [t.id], building: 'cottage', tx: s1.tx, ty: s1.ty, queue: true });
    const a = newest(w, 'cottage');
    const s2 = site(w, 'cottage', 14, 3, [s1]);
    expect(issueCommand(w, { type: 'build', unitIds: [t.id], building: 'cottage', tx: s2.tx, ty: s2.ty, queue: true }).ok).toBe(true);
    const b = newest(w, 'cottage');
    expect(b.id).not.toBe(a.id);
    expect(t.order).toMatchObject({ type: 'build', buildingId: a.id });
    expect(t.queue).toEqual([{ type: 'build', buildingId: b.id }]);
    expect(stepUntil(w, () => a.built, 90)).toBeLessThan(90);
    step(w, 0.2);
    expect(t.order).toMatchObject({ type: 'build', buildingId: b.id });
    expect(b.built).toBe(false);
    expect(stepUntil(w, () => b.built, 90)).toBeLessThan(90);
    step(w, 0.5);
    expect(t.order).toMatchObject({ type: 'gather', target: { kind: 'node', id: th.id } });
  });

  it('a build without queue replaces the current order (and clears the queue)', () => {
    const w = makeWorld();
    const { t } = gatheringTiller(w);
    const s1 = site(w, 'cottage', 14, 3);
    issueCommand(w, { type: 'build', unitIds: [t.id], building: 'cottage', tx: s1.tx, ty: s1.ty });
    const a = newest(w, 'cottage');
    expect(t.order).toMatchObject({ type: 'build', buildingId: a.id });
    issueCommand(w, { type: 'move', unitIds: [t.id], x: 20, y: 20, queue: true });
    expect(t.queue).toHaveLength(1);
    const s2 = site(w, 'cottage', 14, 3, [s1]);
    issueCommand(w, { type: 'build', unitIds: [t.id], building: 'cottage', tx: s2.tx, ty: s2.ty });
    const b = newest(w, 'cottage');
    expect(t.order).toMatchObject({ type: 'build', buildingId: b.id });
    expect(t.queue).toHaveLength(0);
  });

  it('Shift-repair follows the same rule', () => {
    const w = makeWorld();
    const { t, th } = gatheringTiller(w);
    const h = w.buildings.find((b) => b.type === 'hearth')!;
    h.hp -= 50;
    expect(issueCommand(w, { type: 'repair', unitIds: [t.id], targetId: h.id, queue: true }).ok).toBe(true);
    expect(t.order).toMatchObject({ type: 'build', buildingId: h.id });
    expect(t.job).toEqual({ kind: 'node', id: th.id });
  });
});

describe('queries', () => {
  it('command card: Hearth Q train, Z/X research, V rally; Muster Hall Q/W + Z + Delete', () => {
    const w = makeWorld({ unlockedUnits: ['tiller', 'warden', 'ashpike', 'bowman', 'courser'] });
    const h = w.buildings.find((b) => b.type === 'hearth')!;
    w.players[PLAYER].res.ember = 10;
    const card = commandCard(w, [h.id]);
    expect(card.map((o) => [o.kind, o.hotkey, o.slot])).toEqual([
      ['train', 'Q', 0],
      ['research', 'Z', 5],
      ['research', 'X', 6],
      ['rally', 'V', 8],
    ]);
    expect(card[0].cost).toEqual({ grain: 50 });
    expect(card[0].tooltip).toMatch(/Strong vs/);
    expect(card[2].enabled).toBe(false);
    expect(card[2].reason).toBe('Not enough Ember');
    const mh = w.buildings.find((b) => b.type === 'muster_hall')!;
    const mc = commandCard(w, [mh.id]);
    expect(mc.map((o) => o.hotkey)).toEqual(['Q', 'Z', 'Del']);
  });

  it('command card: Tiller build menu C,E,F,B,R,P,N,T,Y with requirement reasons; Warden Q/W', () => {
    const w = makeWorld({ playerEffects: [{ kind: 'flag', flag: 'hawk' }] });
    const ts = units(w, PLAYER, 'tiller');
    const card = commandCard(w, ts.map((t) => t.id));
    expect(card.map((o) => o.hotkey).join('')).toBe('CEFBRPNTY');
    expect(card.map((o) => o.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const sy = card.find((o) => o.id === 'siegeyard')!;
    expect(sy.enabled).toBe(false);
    expect(sy.reason).toBe('Requires a Forgehall');
    expect(buildOptions(w).length).toBe(9);
    const wc = commandCard(w, [w.wardenId, ts[0].id]);
    expect(wc.map((o) => [o.id, o.hotkey])).toEqual([
      ['house_ability', 'Q'],
      ['hawk', 'W'],
    ]);
    issueCommand(w, { type: 'ability', slot: 'Q' });
    const after = commandCard(w, [w.wardenId]);
    expect(after[0].enabled).toBe(false);
    expect(after[0].cooldown).toBeCloseTo(45, 0);
  });

  it('research card shows Temper locks and progress', () => {
    const w = makeWorld({ bonusRes: { grain: 1000, timber: 1000, ember: 1000 } });
    const fh = spawnBuilding(w, 'forgehall', PLAYER, 24, 24);
    issueCommand(w, { type: 'research', buildingId: fh.id, research: 'barbed_heads' });
    step(w, 10);
    const card = commandCard(w, [fh.id]);
    const edge = card.find((o) => o.id === 'ember_edge')!;
    expect(edge.enabled).toBe(false);
    expect(edge.reason).toMatch(/Temper chosen: Barbed Heads|Researching/);
    const barbed = card.find((o) => o.id === 'barbed_heads')!;
    expect(barbed.progress).toBeCloseTo(0.25, 1);
  });

  it('unitsInRect, idleTillers, playerMilitary', () => {
    const w = makeWorld();
    const ts = units(w, PLAYER, 'tiller');
    expect(idleTillers(w).length).toBe(ts.length);
    expect(playerMilitary(w).map((u) => u.type)).toEqual(['courser']);
    const h = w.buildings.find((b) => b.type === 'hearth')!;
    expect(unitsInRect(w, h.tx + 8, h.ty + 8, h.tx - 4, h.ty - 4).length).toBe(w.units.length);
  });
});
