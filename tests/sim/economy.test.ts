/**
 * Economy (GDD §D, §E): gather loop rates, slots, full / depleted nodes, trees, drop-offs, Blight,
 * construction time, refunds, repair, placement, passive income, Tiller flee.
 */
import { describe, expect, it } from 'vitest';
import { netIncome } from '../../src/data/balance';
import { BOONS } from '../../src/data/boons';
import { spawnBuilding, spawnUnit } from '../../src/sim/entities';
import { orderUnit } from '../../src/sim/orders';
import { canPlaceBuilding } from '../../src/sim/queries';
import { drainEvents, issueCommand } from '../../src/sim/world';
import type { GameEvent, Unit, World } from '../../src/sim/types';
import { ENEMY, PLAYER, Terrain } from '../../src/sim/types';
import { clearUnits, makeWorld, step, stepUntil, units } from './helpers';

function tillerAt(w: World, x: number, y: number): Unit {
  return spawnUnit(w, 'tiller', PLAYER, x, y);
}

/** Grain income per second for `n` Tillers on one source over a steady-state window. */
function measure(w: World, res: 'grain' | 'timber' | 'ember', warm: number, window: number): number {
  step(w, warm);
  const g0 = w.players[PLAYER].stats.gathered[res];
  step(w, window);
  return (w.players[PLAYER].stats.gathered[res] - g0) / window;
}

describe('gather loop', () => {
  it('Thicket 5 tiles from the Hearth nets about 0.67/s per Tiller (§D table)', () => {
    const w = makeWorld({}, { resources: [{ type: 'thicket', tx: 15, ty: 7, amount: 5000 }], forest: null });
    clearUnits(w);
    const t = tillerAt(w, 12, 8);
    orderUnit(w, t, { type: 'gather', target: { kind: 'node', id: w.resources[0].id } });
    const rate = measure(w, 'grain', 20, 120);
    expect(rate).toBeGreaterThan(netIncome(10, 1, 5) * 0.8);
    expect(rate).toBeLessThan(netIncome(10, 1, 5) * 1.25);
  });

  it('Ember Seam 9 tiles away nets about 0.40/s; a nearby Storehouse raises it', () => {
    const map = { resources: [{ type: 'ember_seam' as const, tx: 19, ty: 7, amount: 5000 }], forest: null };
    const w = makeWorld({}, map);
    clearUnits(w);
    const seam = w.resources[0];
    const t = tillerAt(w, 15, 8);
    orderUnit(w, t, { type: 'gather', target: { kind: 'node', id: seam.id } });
    const far = measure(w, 'ember', 20, 150);
    expect(far).toBeGreaterThan(netIncome(10, 0.6, 9) * 0.8);
    expect(far).toBeLessThan(netIncome(10, 0.6, 9) * 1.25);

    const w2 = makeWorld({}, map);
    clearUnits(w2);
    spawnBuilding(w2, 'storehouse', PLAYER, 19, 10);
    const t2 = tillerAt(w2, 18, 9);
    orderUnit(w2, t2, { type: 'gather', target: { kind: 'node', id: w2.resources[0].id } });
    const near = measure(w2, 'ember', 20, 150);
    expect(near).toBeGreaterThan(far * 1.15);
    expect(near).toBeGreaterThan(netIncome(10, 0.6, 2.5) * 0.8);
  });

  it('a full node sends extra Tillers to the same resource within 8 tiles', () => {
    const w = makeWorld();
    clearUnits(w);
    const thickets = w.resources.filter((r) => r.type === 'thicket');
    const ts = [0, 1, 2, 3, 4].map((i) => tillerAt(w, 11 + i * 0.2, 11));
    for (const t of ts) orderUnit(w, t, { type: 'gather', target: { kind: 'node', id: thickets[0].id } });
    step(w, 1);
    expect(thickets[0].gatherers).toBe(2);
    const targets = new Set(ts.map((t) => (t.order.type === 'gather' && t.order.target.kind === 'node' ? t.order.target.id : 0)));
    expect(targets.size).toBe(3);
    for (const t of ts) expect(t.order.type).toBe('gather');
  });

  it('full node with no alternative: wait 3 s, retry, then idle with an alert', () => {
    const w = makeWorld({}, { resources: [{ type: 'thicket', tx: 15, ty: 7, amount: 500 }], forest: null });
    clearUnits(w);
    const node = w.resources[0];
    const ts = [0, 1, 2].map((i) => tillerAt(w, 13, 7 + i));
    for (const t of ts) orderUnit(w, t, { type: 'gather', target: { kind: 'node', id: node.id } });
    drainEvents(w);
    step(w, 2);
    const waiting = ts.filter((t) => t.order.type === 'gather' && t.order.waitTimer !== undefined);
    expect(waiting).toHaveLength(1);
    step(w, 2);
    expect(ts.filter((t) => t.order.type === 'idle')).toHaveLength(1);
    expect(drainEvents(w).some((e) => e.t === 'alert' && e.kind === 'idle_tillers')).toBe(true);
  });

  it('depleted Thicket: Tillers move to another within 8 tiles; the node is removed', () => {
    const w = makeWorld({}, {
      resources: [
        { type: 'thicket', tx: 13, ty: 8, amount: 12 },
        { type: 'thicket', tx: 13, ty: 12, amount: 500 },
      ],
      forest: null,
    });
    clearUnits(w);
    const [a, b] = w.resources;
    const t = tillerAt(w, 12, 8.5);
    orderUnit(w, t, { type: 'gather', target: { kind: 'node', id: a.id } });
    step(w, 25);
    expect(a.alive).toBe(false);
    expect(w.resources.includes(a)).toBe(false);
    expect(t.order.type).toBe('gather');
    expect(t.order.type === 'gather' && t.order.target.kind === 'node' && t.order.target.id).toBe(b.id);
    expect(w.grid.blocked[8 * w.map.w + 13]).toBe(0);
  });

  it('trees: max 2 gatherers per tile, felled tiles become passable stumps with an event', () => {
    const w = makeWorld({}, { forest: { x0: 14, y0: 4, x1: 16, y1: 12, amount: 12 }, resources: [] });
    clearUnits(w);
    const tile = 8 * w.map.w + 14;
    const ts = [0, 1, 2].map((i) => tillerAt(w, 12.5, 7.5 + i));
    for (const t of ts) orderUnit(w, t, { type: 'gather', target: { kind: 'tree', tile } });
    step(w, 1);
    const onTile = ts.filter((t) => t.order.type === 'gather' && t.order.target.kind === 'tree' && t.order.target.tile === tile);
    expect(onTile).toHaveLength(2);
    const felled: GameEvent[] = [];
    for (let i = 0; i < 60; i++) {
      step(w, 1);
      felled.push(...drainEvents(w).filter((e) => e.t === 'treeFelled'));
      if (felled.length >= 2) break;
    }
    expect(felled.length).toBeGreaterThanOrEqual(1);
    const ft = (felled[0] as Extract<GameEvent, { t: 'treeFelled' }>).tile;
    expect(w.map.terrain[ft]).toBe(Terrain.Stump);
    expect(w.grid.blocked[ft]).toBe(0);
    expect(w.players[PLAYER].stats.gathered.timber).toBeGreaterThan(0);
    for (const t of ts) expect(t.order.type).toBe('gather');
  });

  it('a loaded Tiller re-picks the nearest drop-off each trip', () => {
    const w = makeWorld({}, { resources: [{ type: 'thicket', tx: 25, ty: 25, amount: 500 }], forest: null });
    clearUnits(w);
    const t = tillerAt(w, 24, 25.5);
    orderUnit(w, t, { type: 'gather', target: { kind: 'node', id: w.resources[0].id } });
    const store = spawnBuilding(w, 'storehouse', PLAYER, 27, 27);
    const drops: Extract<GameEvent, { t: 'dropoff' }>[] = [];
    for (let i = 0; i < 40; i++) {
      step(w, 1);
      drops.push(...(drainEvents(w).filter((e) => e.t === 'dropoff') as Extract<GameEvent, { t: 'dropoff' }>[]));
    }
    expect(drops.length).toBeGreaterThanOrEqual(2);
    for (const d of drops) expect(d.x).toBe(store.x);
  });

  it('Blight: ×0.6 gather on blighted ground unless Kindled Earth', () => {
    const run = (kindled: boolean): number => {
      const w = makeWorld(kindled ? { playerEffects: BOONS.kindled_earth.effects } : {}, {
        resources: [{ type: 'thicket', tx: 15, ty: 8, amount: 5000 }],
        forest: null,
      });
      clearUnits(w);
      spawnBuilding(w, 'storehouse', PLAYER, 15, 10);
      for (let y = 5; y < 14; y++) for (let x = 12; x < 19; x++) w.blight.tiles[y * w.map.w + x] = 1;
      const t = tillerAt(w, 14, 9);
      orderUnit(w, t, { type: 'gather', target: { kind: 'node', id: w.resources[0].id } });
      return measure(w, 'grain', 15, 120);
    };
    const blighted = run(false);
    const kindled = run(true);
    expect(blighted / kindled).toBeGreaterThan(0.55);
    expect(blighted / kindled).toBeLessThan(0.8);
  });

  it('Ember Tithe pays +1.2 Ember/s', () => {
    const w = makeWorld({ playerEffects: BOONS.ember_tithe.effects });
    clearUnits(w);
    const e0 = w.players[PLAYER].res.ember;
    step(w, 10);
    expect(w.players[PLAYER].res.ember - e0).toBeCloseTo(12, 1);
  });
});

describe('construction', () => {
  function buildTime(builders: number, over = {}): number {
    const w = makeWorld(over);
    clearUnits(w);
    w.debug.revealAll = true;
    const ts = Array.from({ length: builders }, (_, i) => tillerAt(w, 20.5 + (i % 2), 20.5 + Math.floor(i / 2) * 3));
    const r = issueCommand(w, { type: 'build', unitIds: ts.map((t) => t.id), building: 'cottage', tx: 21, ty: 21 });
    expect(r.ok).toBe(true);
    const b = w.buildings.find((x) => x.type === 'cottage')!;
    let started = -1;
    for (let i = 0; i < 40 * 20; i++) {
      step(w, 0.05);
      if (started < 0 && b.buildProgress > 0) started = w.time - 0.05;
      if (b.built) return w.time - started;
    }
    return Infinity;
  }

  it('build time = base × 3/(n+2) with up to 4 builders', () => {
    expect(buildTime(1)).toBeCloseTo(12, 0);
    expect(buildTime(2)).toBeCloseTo(9, 0);
    expect(buildTime(4)).toBeCloseTo(6, 0);
    expect(buildTime(6)).toBeCloseTo(6, 0);
    expect(buildTime(1, { playerEffects: BOONS.master_joiners.effects })).toBeCloseTo(12 * 0.7692, 0);
  });

  it('completion: pop cap +6, building_complete alert, builders resume their job', () => {
    const w = makeWorld();
    w.debug.revealAll = true;
    const t = units(w, PLAYER, 'tiller')[0];
    const thicket = w.resources.find((r) => r.type === 'thicket')!;
    orderUnit(w, t, { type: 'gather', target: { kind: 'node', id: thicket.id } });
    step(w, 2);
    const cap0 = w.players[PLAYER].popCap;
    expect(issueCommand(w, { type: 'build', unitIds: [t.id], building: 'cottage', tx: 12, ty: 17 }).ok).toBe(true);
    drainEvents(w);
    expect(stepUntil(w, () => w.buildings.some((b) => b.type === 'cottage' && b.built), 40)).toBeLessThan(40);
    expect(w.players[PLAYER].popCap).toBe(cap0 + 6);
    const ev = drainEvents(w);
    expect(ev.some((e) => e.t === 'alert' && e.kind === 'building_complete')).toBe(true);
    expect(ev.some((e) => e.t === 'built')).toBe(true);
    step(w, 1);
    expect(t.order.type).toBe('gather');
  });

  it('cancel refunds 100% before work, 50% after; foundations displace units', () => {
    const w = makeWorld();
    w.debug.revealAll = true;
    const p = w.players[PLAYER];
    const t = units(w, PLAYER, 'tiller')[0];
    const bystander = spawnUnit(w, 'ashpike', PLAYER, 31.5, 31.5);
    const t0 = p.res.timber;
    expect(issueCommand(w, { type: 'build', unitIds: [t.id], building: 'muster_hall', tx: 30, ty: 30 }).ok).toBe(true);
    expect(p.res.timber).toBe(t0 - 150);
    const b = w.buildings.find((x) => x.type === 'muster_hall' && !x.built)!;
    expect(bystander.x < 30 || bystander.x > 33 || bystander.y < 30 || bystander.y > 33).toBe(true);
    expect(issueCommand(w, { type: 'demolish', buildingId: b.id }).ok).toBe(true);
    expect(p.res.timber).toBe(t0);
    expect(issueCommand(w, { type: 'build', unitIds: [t.id], building: 'cottage', tx: 11, ty: 21 }).ok).toBe(true);
    const c = w.buildings.find((x) => x.type === 'cottage' && !x.built)!;
    stepUntil(w, () => c.buildProgress > 0.1, 30);
    expect(issueCommand(w, { type: 'demolish', buildingId: c.id }).ok).toBe(true);
    expect(p.res.timber).toBe(t0 - 20);
  });

  it('repair: 8 HP/s per Tiller, max 4', () => {
    const w = makeWorld();
    clearUnits(w);
    w.debug.revealAll = true;
    const mh = w.buildings.find((b) => b.type === 'muster_hall')!;
    mh.hp = 200;
    const ts = Array.from({ length: 5 }, (_, i) => tillerAt(w, mh.tx - 0.6, mh.ty + 0.3 + i * 0.6));
    expect(issueCommand(w, { type: 'repair', unitIds: ts.map((t) => t.id), targetId: mh.id }).ok).toBe(true);
    step(w, 3);
    const h0 = mh.hp;
    step(w, 5);
    expect(mh.hp - h0).toBeCloseTo(4 * 8 * 5, -1);
  });

  it('placement rules: explored grass, no occupant, no Blight (Kiln Masons towers ok), 3 tiles from enemy structures', () => {
    const w = makeWorld();
    expect(canPlaceBuilding(w, 'cottage', 40, 40).reason).toBe('Unexplored ground');
    w.debug.revealAll = true;
    expect(canPlaceBuilding(w, 'cottage', 30, 30).ok).toBe(true);
    const th = w.resources[0];
    const r = canPlaceBuilding(w, 'cottage', th.tx, th.ty);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('Blocked');
    expect(r.tiles.filter((x) => !x).length).toBe(1);
    expect(canPlaceBuilding(w, 'cottage', 22, 3).ok).toBe(false);
    expect(canPlaceBuilding(w, 'cottage', 47, 30).ok).toBe(false);
    for (let y = 30; y < 34; y++) for (let x = 30; x < 34; x++) w.blight.tiles[y * w.map.w + x] = 1;
    expect(canPlaceBuilding(w, 'cottage', 30, 30).reason).toBe('Cannot build on Blight');
    expect(canPlaceBuilding(w, 'brazier_tower', 30, 30).ok).toBe(false);
    const wk = makeWorld({ playerEffects: BOONS.kiln_masons.effects });
    wk.debug.revealAll = true;
    for (let y = 30; y < 34; y++) for (let x = 30; x < 34; x++) wk.blight.tiles[y * wk.map.w + x] = 1;
    expect(canPlaceBuilding(wk, 'brazier_tower', 30, 30).ok).toBe(true);
    spawnBuilding(w, 'thorn_nest', ENEMY, 38, 38);
    expect(canPlaceBuilding(w, 'cottage', 34, 38).reason).toBe('Too close to an enemy structure');
    expect(canPlaceBuilding(w, 'cottage', 33, 38).ok).toBe(true);
  });
});

describe('Tiller flee (§D)', () => {
  it('a hit Tiller runs to a safe drop-off and resumes its job 8 s after the enemy is gone', () => {
    const w = makeWorld({}, { resources: [{ type: 'thicket', tx: 22, ty: 8, amount: 500 }], forest: null });
    clearUnits(w);
    w.debug.revealAll = true;
    const node = w.resources[0];
    const t = tillerAt(w, 21, 8.5);
    orderUnit(w, t, { type: 'gather', target: { kind: 'node', id: node.id } });
    step(w, 3);
    const foe = spawnUnit(w, 'thornling', ENEMY, 21, 10);
    orderUnit(w, foe, { type: 'attack', targetId: t.id });
    stepUntil(w, () => t.order.type === 'flee', 5);
    expect(t.order.type).toBe('flee');
    foe.hp = 0;
    foe.alive = false;
    step(w, 4);
    expect(t.order.type).toBe('flee');
    step(w, 6);
    expect(t.order.type).toBe('gather');
    expect(t.alive).toBe(true);
  });
});
