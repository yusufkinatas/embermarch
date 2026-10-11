/**
 * Encounter behaviour against a fake sim-core (tests/encounter/fakeSim.ts): no movement or combat,
 * so these tests pin down the director timeline, AI decisions, Spent, Blight and objectives.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/sim/entities', async () => (await import('./fakeSim')).entitiesMock);
vi.mock('../../src/sim/orders', async () => (await import('./fakeSim')).ordersMock);
vi.mock('../../src/sim/combat', async () => (await import('./fakeSim')).combatMock);
vi.mock('../../src/sim/world', async () => (await import('./fakeSim')).worldMock);
vi.mock('../../src/sim/nav/movement', async () => (await import('./fakeSim')).movementMock);

import { nestFactor, nestHp, nobleHp, regentHp, waveValue } from '../../src/data/balance';
import { UNITS } from '../../src/data/units';
import {
  debugForceWave,
  getEncounterResult,
  getEncounterView,
  initEncounter,
  onEntityDamaged,
  onEntityDeath,
  onPlayerBuildingChanged,
  tickEncounter,
} from '../../src/sim/encounter';
import { fmtClock } from '../../src/sim/encounter/formulas';
import { makeAI } from '../../src/sim/encounter/spawn';
import { getState, type EnemyAI } from '../../src/sim/encounter/state';
import { ENEMY, PLAYER, type EnemyUnitId, type GameEvent, type Unit, type World } from '../../src/sim/types';
import * as fake from './fakeSim';

beforeAll(() => {
  fake.hooks.onDeath = onEntityDeath;
  fake.hooks.onDamaged = onEntityDamaged;
  fake.hooks.tick = tickEncounter;
  fake.hooks.init = initEncounter;
});

const value = (units: Unit[]) => units.reduce((s, u) => s + (UNITS[u.type].value ?? 0), 0);
const events = (w: World, t: GameEvent['t']) => w.events.filter((e) => e.t === t);
const waveUnits = (w: World, n?: number) => fake.enemyUnits(w, 'wave').filter((u) => n === undefined || u.ai?.wave === n);
const st = (w: World) => getState(w)!;

function stepTo(w: World, t: number): void {
  fake.step(w, Math.max(0, t - w.time));
}

describe('initEncounter', () => {
  it('Raze d1: Nests, spires, garrisons, Blight and tracker', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1 });
    const nests = fake.nestBuildings(w);
    expect(nests).toHaveLength(2);
    for (const n of nests) {
      expect(n.maxHp).toBe(nestHp(1));
      expect(n.nest?.spent).toBe(false);
      expect(n.nest?.blightRadius).toBe(4);
    }
    expect(w.buildings.filter((b) => b.type === 'thornspire')).toHaveLength(2);
    const garrisons = fake.enemyUnits(w, 'garrison');
    for (const n of st(w).nests) {
      const g = garrisons.filter((u) => (u.ai as EnemyAI).nestId === n.id);
      expect(value(g)).toBeGreaterThanOrEqual(4);
      expect(value(g)).toBeLessThanOrEqual(5);
      for (const u of g) expect(UNITS[u.type].standingEligible).toBe(true);
    }
    const blighted = w.blight.tiles.reduce((a, b) => a + b, 0);
    expect(blighted).toBeGreaterThan(80);
    expect(w.blight.tiles[(8 + 1) * 48 + 36 + 1]).toBe(1);
    const v = getEncounterView(w);
    expect(v.trackerText).toBe('Nests 0/2 · Par 6:00');
    expect(v.horn).toBeNull();
    expect(v.nests).toHaveLength(2);
  });

  it('Fortified Nests + Thornbound II/III: HP, extra spires, bigger garrisons', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 4, modifiers: ['fortified_nests'], tier: 3 });
    for (const n of fake.nestBuildings(w)) expect(n.maxHp).toBe(Math.round(nestHp(4) * 1.5 * 1.25));
    expect(w.buildings.filter((b) => b.type === 'thornspire')).toHaveLength(4);
    for (const n of st(w).nests) expect(n.garrisonCap).toBe(4 + 4 + 2);
    // Thornbound III: T1 −15 s.
    expect(st(w).nextLaunch).toBe(94 - 15);
  });

  it('Pickets and Caches get guards; Swift Hunt forces Hunt', () => {
    const w = fake.makeWorld({
      objective: 'raze',
      depth: 3,
      pickets: true,
      modifiers: ['swift_hunt'],
      caches: [{ tx: 30, ty: 30, type: 'ruined_cache' }],
    });
    expect(st(w).doctrine).toBe('hunt');
    expect(value(fake.enemyUnits(w, 'picket'))).toBeGreaterThanOrEqual(2 * (2 + 3) - 2);
    expect(value(fake.enemyUnits(w, 'lurker'))).toBeGreaterThanOrEqual(4);
    expect(fake.enemyUnits(w).every((u) => u.ai !== null)).toBe(true);
    const standing = fake.enemyUnits(w).filter((u) => ['garrison', 'picket', 'lurker'].includes(u.ai!.role));
    expect(standing.length).toBeLessThanOrEqual(30);
  });
});

describe('wave director', () => {
  it('musters at launch − 30 s, launches at T1, spends the Nest, breaks and recovers', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1, doctrine: 'swarm' });
    stepTo(w, 75.9);
    expect(events(w, 'waveMuster')).toHaveLength(0);
    stepTo(w, 76.1);
    expect(events(w, 'waveMuster')).toHaveLength(1);
    const muster = waveUnits(w, 1);
    expect(value(muster)).toBe(waveValue(1, 1));
    for (const u of muster) expect(u.ai!.state).toBe('muster');
    const horn = getEncounterView(w).horn!;
    expect(horn.phase).toBe('muster');
    expect(horn.wave).toBe(1);
    expect(horn.secondsToLaunch).toBeCloseTo(30, 0);
    expect(horn.revealed).toBe(false);
    expect(['Small', 'Medium', 'Large']).toContain(horn.sizeLabel);

    stepTo(w, 106.05);
    expect(events(w, 'waveLaunch')).toHaveLength(1);
    const nestId = st(w).waves[0].nestId;
    const nest = w.entities.get(nestId);
    expect(nest && nest.kind === 'building' && nest.nest?.spent).toBe(true);
    for (const u of waveUnits(w, 1)) {
      expect(u.ai!.state === 'advance' || u.ai!.state === 'engage').toBe(true);
      expect(u.order.type).toBe('attackMove');
    }
    expect(getEncounterView(w).horn!.phase).toBe('advancing');

    // Break the wave 10 s after launch: Spent ends 45 s (plus the Nest's distance extra) later.
    const extra = st(w).nests.find((n) => n.id === nestId)!.spentExtra;
    expect(extra).toBeGreaterThanOrEqual(0);
    stepTo(w, 116);
    fake.killAll(w, waveUnits(w, 1));
    fake.step(w, 0.1);
    expect(events(w, 'waveBroken')).toHaveLength(1);
    const alert = w.events.find((e) => e.t === 'alert' && e.kind === 'wave_broken');
    expect(alert && alert.t === 'alert' && alert.text).toMatch(new RegExp(`^Wave 1 broken\\. [NESW]{1,2} Nest Spent ${fmtClock(45 + extra)}$`));
    const v = getEncounterView(w);
    const vn = v.nests.find((n) => n.id === nestId)!;
    expect(vn.spent).toBe(true);
    expect(vn.spentRemaining).toBeCloseTo(45 + extra, 0);
    stepTo(w, 160.9 + extra);
    expect(getEncounterView(w).nests.find((n) => n.id === nestId)!.spent).toBe(true);
    stepTo(w, 161.3 + extra);
    expect(getEncounterView(w).nests.find((n) => n.id === nestId)!.spent).toBe(false);
  });

  it('rotates round-robin among Nests and the second wave uses V(2,d)', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 2, doctrine: 'spines' });
    stepTo(w, 102 - 30 + 0.1);
    const first = st(w).waves[0].nestId;
    fake.killAll(w, waveUnits(w, 1));
    stepTo(w, 102 + 66 - 30 + 0.1);
    const second = st(w).waves.find((x) => x.n === 2)!;
    expect(second.nestId).not.toBe(first);
    expect(value(waveUnits(w, 2))).toBeGreaterThanOrEqual(waveValue(2, 2) - 1);
    expect(value(waveUnits(w, 2))).toBeLessThanOrEqual(waveValue(2, 2));
  });

  it('a Nest kill sets N: the next wave shrinks (Waves −30%)', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1 });
    const killer = fake.spawnUnit(w, 'courser', PLAYER, 20, 20);
    const nest = fake.nestBuildings(w)[1];
    fake.killEntity(w, nest, killer.id);
    fake.step(w, 0.1);
    const ev = events(w, 'nestDestroyed')[0];
    expect(ev && ev.t === 'nestDestroyed' && ev.wavePct).toBe(30);
    expect(events(w, 'blightRecede')).toHaveLength(1);
    expect(getEncounterResult(w)!.plunderCrowns).toBe(10);
    expect(getEncounterView(w).trackerText).toBe('Nests 1/2 · Par 6:00');
    stepTo(w, 76.1);
    const expected = waveValue(1, 1, nestFactor(1, 2));
    expect(value(waveUnits(w, 1))).toBe(expected);
    // The dead Nest's garrison marches out.
    for (const u of fake.enemyUnits(w, 'garrison')) {
      const n = st(w).nests.find((x) => x.id === (u.ai as EnemyAI).nestId)!;
      if (!n.alive) expect(u.ai!.state).not.toBe('post');
    }
  });

  it('a Nest dying during muster launches the wave at the killer', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1 });
    stepTo(w, 80);
    const wave = st(w).waves[0];
    const nest = w.entities.get(wave.nestId)!;
    const killer = fake.spawnUnit(w, 'ashpike', PLAYER, 30, 30);
    fake.killEntity(w, nest, killer.id);
    fake.step(w, 0.1);
    expect(wave.phase).toBe('advancing');
    expect(wave.targetId).toBe(killer.id);
    for (const u of waveUnits(w, 1)) expect((u.ai as EnemyAI).forcedId).toBe(killer.id);
  });

  it('Raze victory when every Nest falls (under par, plunder counted)', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1, flags: { plunderers: 1 } });
    for (const n of fake.nestBuildings(w)) fake.killEntity(w, n, 0);
    fake.step(w, 0.2);
    expect(w.outcome).toBe('victory');
    const r = getEncounterResult(w)!;
    expect(r.nestsDestroyed).toBe(2);
    expect(r.plunderCrowns).toBe(2 * (10 + 10));
    expect(r.underPar).toBe(true);
    expect(r.par).toBe(360);
  });

  it('Cold Watch-Fire: wave 1 never launches, objectives are known', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1, coldWatchfire: true });
    expect(getEncounterView(w).nests.every((n) => n.seen)).toBe(true);
    stepTo(w, 107);
    expect(events(w, 'waveMuster')).toHaveLength(0);
    stepTo(w, 106 + 68 - 30 + 0.1);
    expect(events(w, 'waveMuster')).toHaveLength(1);
    expect(st(w).waves[0].n).toBe(2);
  });

  it('intel: a player unit within 6 tiles of the muster point reveals the composition', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1 });
    stepTo(w, 77);
    expect(getEncounterView(w).horn!.composition).toEqual([]);
    const wave = st(w).waves[0];
    fake.spawnUnit(w, 'courser', PLAYER, wave.musterX + 4, wave.musterY);
    fake.step(w, 0.1);
    const horn = getEncounterView(w).horn!;
    expect(horn.revealed).toBe(true);
    const total = horn.composition.reduce((s, c) => s + c.count, 0);
    expect(total).toBe(waveUnits(w, 1).length);
  });

  it('Thick Fog: Horn only 10 s before launch, never with composition', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1, modifiers: ['thick_fog'] });
    stepTo(w, 80);
    expect(waveUnits(w, 1).length).toBeGreaterThan(0);
    expect(getEncounterView(w).horn).toBeNull();
    expect(events(w, 'waveMuster')).toHaveLength(0);
    const wave = st(w).waves[0];
    fake.spawnUnit(w, 'courser', PLAYER, wave.musterX + 1, wave.musterY);
    stepTo(w, 96.1);
    const horn = getEncounterView(w).horn!;
    expect(horn).not.toBeNull();
    expect(horn.revealed).toBe(false);
    expect(horn.composition).toEqual([]);
  });

  it('Blood Moon multiplies wave value ×1.3', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1, modifiers: ['blood_moon'] });
    stepTo(w, 76.1);
    expect(value(waveUnits(w, 1))).toBe(13);
  });

  it('pool caps: wave pool <= 50 alive, the remainder banks', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 6, doctrine: 'swarm' });
    for (let n = 6; n <= 9; n++) debugForceWave(w, n);
    const pool = fake.enemyUnits(w).filter((u) => ['wave', 'raid', 'summon', 'noble'].includes(u.ai!.role));
    expect(pool.length).toBeLessThanOrEqual(50);
    expect(fake.enemyUnits(w).length).toBeLessThanOrEqual(80);
    expect(st(w).waveBank).toBeGreaterThan(0);
  });

  it('debugForceWave launches at once with the requested doctrine', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 3 });
    debugForceWave(w, 4, 'siegebreak');
    const wave = st(w).waves[0];
    expect(wave.doctrine).toBe('siegebreak');
    expect(wave.phase).toBe('advancing');
    const allowed: EnemyUnitId[] = ['briarguard', 'spinecaster', 'rootbreaker', 'stagrider'];
    for (const u of waveUnits(w, 4)) {
      if (u.ai && (u.ai as EnemyAI).nestId && fake.enemyUnits(w, 'garrison').includes(u)) continue;
      expect(allowed).toContain(u.type);
    }
    expect(waveUnits(w, 4).filter((u) => u.type === 'rootbreaker').length).toBeLessThanOrEqual(1);
  });

  it('dissolve: an advancing unit that neither moves nor fights for 30 s dissolves', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1 });
    debugForceWave(w, 1);
    const n0 = waveUnits(w, 1).length;
    expect(n0).toBeGreaterThan(0);
    fake.step(w, 29);
    expect(waveUnits(w, 1).length).toBe(n0);
    fake.step(w, 1.6);
    expect(waveUnits(w, 1).length).toBe(0);
  });

  it('Ascendant at 9:00: alert and ×1.5 on later waves', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1 });
    stepTo(w, 541);
    const asc = w.events.filter((e) => e.t === 'alert' && e.kind === 'ascendant');
    expect(asc).toHaveLength(2);
    expect(st(w).ascendant).toBe(true);
  });
});

describe('enemy AI', () => {
  it('garrison aggro within 7 of its post, leash 12 from the Nest, return regenerating', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 2 });
    const nest = st(w).nests[0];
    const guard = fake.enemyUnits(w, 'garrison').find((u) => (u.ai as EnemyAI).nestId === nest.id)!;
    const ai = guard.ai as EnemyAI;
    const intruder = fake.spawnUnit(w, 'bowman', PLAYER, ai.postX + 5, ai.postY);
    fake.step(w, 0.6);
    expect(guard.order.type).toBe('attack');
    expect(guard.targetId).toBe(intruder.id);
    // Dragged beyond the leash: walk home and regenerate.
    guard.x = nest.cx + 13;
    guard.y = nest.cy;
    guard.hp = 10;
    fake.step(w, 0.6);
    expect(ai.state).toBe('return');
    expect(guard.order.type).toBe('move');
    fake.step(w, 1);
    expect(guard.hp).toBeGreaterThan(14);
  });

  it('retaliation: below 60% Nest HP the garrison attacks the attacker', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1 });
    const nest = fake.nestBuildings(w)[0];
    const raider = fake.spawnUnit(w, 'courser', PLAYER, nest.x - 4, nest.y + 4);
    fake.dealTrueDamage(w, nest, nest.maxHp * 0.5, raider.id);
    fake.step(w, 0.1);
    const g = fake.enemyUnits(w, 'garrison').filter((u) => (u.ai as EnemyAI).nestId === nest.id);
    expect(g.length).toBeGreaterThan(0);
    for (const u of g) expect(u.targetId).toBe(raider.id);
  });

  it('wave engage priority: bonus target within 4 beats a nearer plain target; chase leash 6', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 2, doctrine: 'hunt' });
    debugForceWave(w, 3, 'hunt');
    for (const u of waveUnits(w, 3)) fake.killEntity(w, u, 0);
    fake.purge(w);
    // Re-use the wave record with a single hand-placed Stagrider.
    const wave = st(w).waves[0] ?? null;
    const rider = fake.spawnUnit(w, 'stagrider', ENEMY, 24, 24);
    rider.ai = makeAI(w, 'wave', 'stagrider', { state: 'advance', postX: 24, postY: 24, wave: 3, waveUid: wave ? wave.uid : 0 });
    if (wave) wave.members.push(rider.id);
    const pike = fake.spawnUnit(w, 'ashpike', PLAYER, 25.5, 24);
    const bow = fake.spawnUnit(w, 'bowman', PLAYER, 27.5, 24);
    fake.step(w, 0.6);
    expect(rider.targetId).toBe(bow.id); // ×2 vs ranged within 4 tiles
    // Chase beyond 6 tiles from the engagement start: give up and ignore it for 5 s.
    rider.x = 24 + 6.5;
    bow.x = 24 + 9;
    pike.x = 2;
    pike.y = 2;
    fake.step(w, 0.6);
    expect(rider.order.type).toBe('attackMove');
    expect((rider.ai as EnemyAI).ignoreId).toBe(bow.id);
  });

  it('blocked enemies attack the building in their way', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1 });
    debugForceWave(w, 1);
    const u = waveUnits(w, 1)[0];
    const wall = fake.spawnBuilding(w, 'cottage', PLAYER, 20, 20);
    u.moveStatus = 'blocked';
    u.blockedBy = wall.id;
    fake.step(w, 0.6);
    expect(u.order.type).toBe('attack');
    expect(u.targetId).toBe(wall.id);
  });
});

describe('Blight', () => {
  it('grows +1 every 20 s and withers player buildings on it (ward stops it)', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1 });
    const nest = st(w).nests[0];
    const before = w.blight.version;
    stepTo(w, 20.1);
    expect(nest.b.nest!.blightRadius).toBe(5);
    expect(w.blight.version).toBeGreaterThan(before);
    const hut = fake.spawnBuilding(w, 'cottage', PLAYER, Math.floor(nest.cx) - 5, Math.floor(nest.cy) - 1);
    fake.step(w, 0.1);
    const hp0 = hut.hp;
    fake.step(w, 3);
    expect(hut.hp).toBeLessThanOrEqual(hp0 - 4);
    expect(hut.hp).toBeGreaterThanOrEqual(hp0 - 8);
    // Kindled Earth: the building wards radius 5.
    w.players[PLAYER].flags.kindled_earth = 1;
    onPlayerBuildingChanged(w);
    const hp1 = hut.hp;
    fake.step(w, 3);
    expect(hut.hp).toBe(hp1);
  });

  it('Thornwake regenerate 1 HP/s on Blight', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1 });
    const g = fake.enemyUnits(w, 'garrison')[0];
    g.hp = g.maxHp - 10;
    fake.step(w, 3);
    expect(g.hp).toBeCloseTo(g.maxHp - 7, 0);
  });
});

describe('Holdfast', () => {
  it('six fixed waves, Great Wave split, cleanup, victory when all wave units die', () => {
    const w = fake.makeWorld({ objective: 'holdfast', depth: 2, size: 48, nests: [{ tx: 38, ty: 8 }, { tx: 8, ty: 38 }] });
    const launches: number[] = [];
    let t = 0;
    while (w.outcome === 'ongoing' && t < 330) {
      fake.step(w, 1);
      t += 1;
      for (const e of w.events) if (e.t === 'waveLaunch') launches.push(Math.round(w.time));
      w.events.length = 0;
      // Break each wave 2 s after launch.
      for (const wave of st(w).waves) {
        if (wave.phase === 'advancing' && w.tick - wave.launchTick >= 40) fake.killAll(w, waveUnits(w, wave.n));
      }
    }
    expect(w.outcome).toBe('victory');
    // Waves 1-5 launch once, the Great Wave launches from both Nests.
    expect(launches).toEqual([60, 105, 150, 195, 240, 285, 285]);
    expect(getEncounterView(w).trackerText).toBe('Waves 6/6');
    const r = getEncounterResult(w)!;
    expect(r.unbroken).toBe(true);
    expect(r.uprooted).toBe(false);
  });

  it('losing a completed building breaks Unbroken; all Nests down is Uprooted', () => {
    const w = fake.makeWorld({ objective: 'holdfast', depth: 1 });
    const hut = fake.spawnBuilding(w, 'cottage', PLAYER, 20, 20);
    fake.killEntity(w, hut, 0);
    for (const n of fake.nestBuildings(w)) fake.killEntity(w, n, 0);
    fake.step(w, 0.2);
    expect(w.outcome).toBe('victory');
    const r = getEncounterResult(w)!;
    expect(r.unbroken).toBe(false);
    expect(r.uprooted).toBe(true);
  });
});

describe('Elite: the Antlered Lord', () => {
  it('waits at a Nest with scaled HP, joins wave 3, victory needs the Lord', () => {
    const w = fake.makeWorld({ objective: 'elite', depth: 4 });
    const lord = w.units.find((u) => u.type === 'antlered_lord')!;
    expect(lord.maxHp).toBe(nobleHp(4));
    expect(lord.ai!.state).toBe('post');
    for (const n of fake.nestBuildings(w)) fake.killEntity(w, n, 0);
    fake.step(w, 0.2);
    expect(w.outcome).toBe('ongoing');
    // Every Nest fell first: it rises and marches.
    expect(st(w).lord!.risen).toBe(true);
    expect(lord.ai!.state === 'advance' || lord.ai!.state === 'engage').toBe(true);
    expect(getEncounterView(w).boss?.name).toBe('The Antlered Lord');
    fake.killEntity(w, lord, 0);
    fake.step(w, 0.2);
    expect(w.outcome).toBe('victory');
    expect(getEncounterResult(w)!.lordSlain).toBe(true);
  });

  it('joins wave 3 and uses Wild Hunt (telegraph, damage, knockback) and summons', () => {
    const w = fake.makeWorld({ objective: 'elite', depth: 3 });
    const lord = w.units.find((u) => u.type === 'antlered_lord')!;
    debugForceWave(w, 3);
    expect(st(w).lord!.joined).toBe(true);
    lord.x = 24;
    lord.y = 24;
    const victim = fake.spawnUnit(w, 'ashpike', PLAYER, 28, 24);
    victim.maxHp = victim.hp = 500;
    fake.step(w, 4.2);
    expect(events(w, 'telegraph').length).toBeGreaterThan(0);
    fake.step(w, 1.5);
    expect(victim.hp).toBeLessThan(500);
    expect(Math.abs(victim.y - 24)).toBeGreaterThan(1);
    fake.step(w, 4);
    expect(fake.enemyUnits(w, 'summon').filter((u) => u.type === 'stagrider').length).toBe(2);
  });
});

describe('Boss: the Briar Regent', () => {
  it('phase 1 warded; Root Heart kills shrink the pool; all Hearts → phase 2', () => {
    const w = fake.makeWorld({ objective: 'boss' });
    const regent = w.units.find((u) => u.type === 'briar_regent')!;
    expect(regent.untargetable).toBe(true);
    expect(regent.maxHp).toBe(regentHp(3));
    expect(getEncounterView(w).trackerText).toMatch(/^Burn the Root Hearts 0\/3 · Wrath [78]:\d\d$/);
    const hearts = fake.nestBuildings(w);
    expect(hearts.every((h) => h.type === 'root_heart')).toBe(true);
    fake.killEntity(w, hearts[0], 0);
    fake.step(w, 0.1);
    expect(regent.maxHp).toBe(regentHp(2));
    fake.killEntity(w, hearts[1], 0);
    fake.killEntity(w, hearts[2], 0);
    fake.step(w, 0.1);
    expect(events(w, 'bossPhase')).toHaveLength(1);
    expect(regent.untargetable).toBe(false);
    expect(regent.maxHp).toBe(3000);
    expect(getEncounterView(w).boss).toMatchObject({ phase: 2, warded: false });
    expect(getEncounterView(w).trackerText).toBe('Slay the Briar Regent');
    fake.killEntity(w, regent, 0);
    fake.step(w, 0.1);
    expect(w.outcome).toBe('victory');
  });

  it('Wrath at 8:00 with Hearts alive; Thorn Lance before that; Court Summons at 75%', () => {
    const w = fake.makeWorld({ objective: 'boss' });
    const regent = w.units.find((u) => u.type === 'briar_regent')!;
    const diver = fake.spawnUnit(w, 'courser', PLAYER, st(w).boss!.throneX - 6, st(w).boss!.throneY);
    diver.maxHp = diver.hp = 10000;
    fake.step(w, 10);
    expect(events(w, 'telegraph').length).toBeGreaterThan(0);
    expect(diver.hp).toBeLessThan(10000);
    fake.killEntity(w, diver, 0);
    // Keep the Hearts alive until 8:00 (kill waves so the pools do not fill).
    while (w.time < 481) {
      fake.step(w, 5);
      fake.killAll(w, fake.enemyUnits(w, 'wave'));
    }
    expect(st(w).boss!.phase).toBe(2);
    expect(st(w).boss!.wrath).toBe(true);
    expect(regent.maxHp).toBe(regentHp(3));
    expect(regent.buffs.some((b) => b.id === 'wrath')).toBe(true);
    regent.hp = regent.maxHp * 0.7;
    fake.step(w, 0.1);
    expect(fake.enemyUnits(w, 'summon').length).toBeGreaterThan(0);
    regent.hp = regent.maxHp * 0.2;
    fake.step(w, 0.1);
    expect(st(w).boss!.enraged).toBe(true);
    expect(st(w).boss!.summonsDone).toBe(3);
  });
});

describe('Caches and Beacons', () => {
  it('a Cache is looted by the first player unit within 1.2 tiles after its guards die', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1, caches: [{ tx: 30, ty: 30, type: 'ruined_cache' }] });
    const lurkers = fake.enemyUnits(w, 'lurker');
    expect(lurkers.length).toBeGreaterThan(0);
    fake.spawnUnit(w, 'courser', PLAYER, 31.5, 30.5);
    fake.step(w, 0.5);
    expect(getEncounterResult(w)!.cachesLooted).toBe(0);
    fake.killAll(w, fake.enemyUnits(w, 'lurker'));
    fake.step(w, 0.5);
    expect(getEncounterResult(w)!.cachesLooted).toBe(1);
    expect(w.players[PLAYER].res.ember).toBe(150);
    expect(getEncounterResult(w)!.plunderCrowns).toBe(15);
    expect(events(w, 'cacheLooted')).toHaveLength(1);
  });

  it('Beacons: dormant until 1:30, capture 10 s, Kindling to 450 wins', () => {
    const w = fake.makeWorld({ objective: 'beacons', depth: 1, beacons: [{ tx: 24, ty: 24 }, { tx: 30, ty: 14 }, { tx: 14, ty: 30 }] });
    for (const u of fake.enemyUnits(w, 'beacon_guard')) fake.killEntity(w, u, 0);
    fake.purge(w);
    fake.spawnUnit(w, 'tiller', PLAYER, 25, 23.6);
    stepTo(w, 80);
    expect(st(w).beacons[0].lit).toBe(false);
    stepTo(w, 100.2);
    expect(st(w).beacons[0].lit).toBe(true);
    expect(w.vision.some((v) => v.tag.startsWith('beacon:'))).toBe(true);
    expect(getEncounterView(w).kindling).toEqual({ value: 0, target: 450 });
    // Keep the waves away from the beacon so Kindling accrues (one stone: 1 point/s).
    while (w.outcome === 'ongoing' && w.time < 580) {
      fake.step(w, 2);
      fake.killAll(w, fake.enemyUnits(w).filter((u) => u.ai?.role === 'wave' || u.ai?.role === 'raid'));
    }
    expect(w.outcome).toBe('victory');
    expect(w.players[PLAYER].res.ember).toBeGreaterThan(80);
  });

  it('enemies uncontested on a lit Beacon snuff it after 8 s', () => {
    const w = fake.makeWorld({ objective: 'beacons', depth: 1, beacons: [{ tx: 24, ty: 24 }] });
    for (const u of fake.enemyUnits(w, 'beacon_guard')) fake.killEntity(w, u, 0);
    fake.purge(w);
    const t = fake.spawnUnit(w, 'tiller', PLAYER, 25, 23.6);
    stepTo(w, 101);
    expect(st(w).beacons[0].lit).toBe(true);
    fake.killEntity(w, t, 0);
    const e = fake.spawnUnit(w, 'briarguard', ENEMY, 25, 25.5);
    e.ai = { role: 'lurker', state: 'post', postX: 25, postY: 25.5, wave: -1 };
    fake.step(w, 8.2);
    expect(st(w).beacons[0].lit).toBe(false);
    expect(w.vision.some((v) => v.tag.startsWith('beacon:'))).toBe(false);
  });
});

describe('stability', () => {
  for (const objective of ['raze', 'holdfast', 'elite', 'beacons', 'boss'] as const) {
    it(`${objective}: 10 simulated minutes at d6 without errors and within caps`, () => {
      const w = fake.makeWorld({
        objective,
        depth: 6,
        modifiers: objective === 'boss' ? [] : ['blood_moon', 'creeping_wake'],
        tier: 3,
        nests: objective === 'boss' ? undefined : [{ tx: 36, ty: 8 }, { tx: 8, ty: 36 }, { tx: 36, ty: 36 }],
        beacons: objective === 'beacons' ? [{ tx: 24, ty: 24 }, { tx: 30, ty: 14 }, { tx: 14, ty: 30 }] : [],
        pickets: objective !== 'holdfast',
        caches: [{ tx: 40, ty: 20, type: 'ruined_cache' }],
      });
      const army = [];
      for (let i = 0; i < 12; i++) army.push(fake.spawnUnit(w, i % 2 ? 'ashpike' : 'bowman', PLAYER, 14 + (i % 4), 14 + Math.floor(i / 4)));
      let maxWave = 0;
      let maxTotal = 0;
      for (let s = 0; s < 600 && w.outcome === 'ongoing'; s++) {
        fake.step(w, 1);
        const pool = fake.enemyUnits(w).filter((u) => ['wave', 'raid', 'summon', 'noble'].includes(u.ai?.role ?? ''));
        maxWave = Math.max(maxWave, pool.length);
        maxTotal = Math.max(maxTotal, fake.enemyUnits(w).length);
        w.events.length = 0;
        getEncounterView(w);
      }
      expect(maxWave).toBeLessThanOrEqual(50);
      expect(maxTotal).toBeLessThanOrEqual(80);
    });
  }
});

describe('director details', () => {
  it('raids (d>=3) launch at wave launch + floor(I/2) and hunt the farthest Tiller', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 3 });
    const near = fake.spawnUnit(w, 'tiller', PLAYER, 10, 10);
    const far = fake.spawnUnit(w, 'tiller', PLAYER, 20, 20);
    void near;
    const T1 = 110 - 12;
    const I = 70 - 6;
    stepTo(w, T1 + Math.floor(I / 2) - 0.2);
    expect(fake.enemyUnits(w, 'raid')).toHaveLength(0);
    stepTo(w, T1 + Math.floor(I / 2) + 0.2);
    const raiders = fake.enemyUnits(w, 'raid');
    expect(value(raiders)).toBe(5);
    expect(raiders.map((u) => u.type).sort()).toEqual(['stagrider', 'thornling', 'thornling']);
    expect(events(w, 'raidLaunch')).toHaveLength(1);
    const raid = st(w).waves.find((x) => x.kind === 'raid')!;
    expect(raid.huntTargetId).toBe(far.id);
  });

  it('no raids below d3 or in Holdfast', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 2 });
    fake.spawnUnit(w, 'tiller', PLAYER, 20, 20);
    stepTo(w, 160);
    expect(events(w, 'raidLaunch')).toHaveLength(0);
    const h = fake.makeWorld({ objective: 'holdfast', depth: 5, nests: [{ tx: 38, ty: 8 }, { tx: 8, ty: 38 }] });
    fake.spawnUnit(h, 'tiller', PLAYER, 20, 20);
    stepTo(h, 140);
    expect(events(h, 'raidLaunch')).toHaveLength(0);
  });

  it('light adaptation: from wave 3, a bow-heavy army draws Stagriders and a Horn note', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 2, doctrine: 'swarm' });
    for (let i = 0; i < 12; i++) fake.spawnUnit(w, 'bowman', PLAYER, 10 + (i % 6) * 0.5, 12 + Math.floor(i / 6));
    stepTo(w, 102 - 30 + 0.2);
    // Wave 1 (and 2) never adapt.
    expect(getEncounterView(w).horn!.wave).toBe(1);
    expect(getEncounterView(w).horn!.notes).not.toContain('The thorns have learned your bows.');
    debugForceWave(w, 3);
    const w3 = st(w).waves.find((x) => x.n === 3)!;
    expect(w3.notes).toContain('The thorns have learned your bows.');
  });

  it('garrisons regenerate 1 value per 10 s, but not while the Nest is Spent', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 4 });
    const nest = st(w).nests[0];
    const full = value(fake.enemyUnits(w, 'garrison').filter((u) => (u.ai as EnemyAI).nestId === nest.id));
    fake.killAll(w, fake.enemyUnits(w, 'garrison').filter((u) => (u.ai as EnemyAI).nestId === nest.id));
    fake.step(w, 25);
    const regrown = value(fake.enemyUnits(w, 'garrison').filter((u) => (u.ai as EnemyAI).nestId === nest.id));
    expect(regrown).toBeGreaterThanOrEqual(1);
    expect(regrown).toBeLessThanOrEqual(3);
    // Spent: no regeneration.
    nest.spent = { wave: 9, launchTick: w.tick, until: w.tick + 20 * 60 };
    const before = value(fake.enemyUnits(w, 'garrison').filter((u) => (u.ai as EnemyAI).nestId === nest.id));
    fake.step(w, 30);
    const after = value(fake.enemyUnits(w, 'garrison').filter((u) => (u.ai as EnemyAI).nestId === nest.id));
    expect(after).toBe(before);
    expect(full).toBeGreaterThan(0);
  });

  it('doctrine targets: Hunt picks the Storehouse with the most Tillers, Siegebreak the nearest tower', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 3 });
    const store = fake.spawnBuilding(w, 'storehouse', PLAYER, 20, 30);
    fake.spawnBuilding(w, 'storehouse', PLAYER, 30, 20);
    for (let i = 0; i < 3; i++) fake.spawnUnit(w, 'tiller', PLAYER, 21 + i * 0.5, 33);
    debugForceWave(w, 2, 'hunt');
    expect(st(w).waves[0].targetId).toBe(store.id);
    expect(st(w).waves[0].targetRule).toBe('doctrine');
    const tower = fake.spawnBuilding(w, 'brazier_tower', PLAYER, 26, 26);
    debugForceWave(w, 3, 'siegebreak');
    expect(st(w).waves[1].targetId).toBe(tower.id);
    debugForceWave(w, 4, 'swarm');
    expect(st(w).waves[2].targetId).toBe(w.hearthId);
  });

  it('tracker texts per objective (§O)', () => {
    expect(getEncounterView(fake.makeWorld({ objective: 'elite', depth: 3 })).trackerText).toBe('Nests 0/2 · Lord 0/1 · Par 6:30');
    const b = fake.makeWorld({ objective: 'beacons', depth: 1, beacons: [{ tx: 24, ty: 24 }] });
    expect(getEncounterView(b).trackerText).toBe('Kindling 0/450');
    const h = fake.makeWorld({ objective: 'holdfast', depth: 1 });
    expect(getEncounterView(h).trackerText).toBe('Waves 0/6');
    const r3 = fake.makeWorld({ objective: 'raze', depth: 5, nests: [{ tx: 36, ty: 8 }, { tx: 8, ty: 36 }, { tx: 36, ty: 36 }] });
    expect(getEncounterView(r3).trackerText).toBe('Nests 0/3 · Par 6:45');
  });

  it('a wave unit leashed by the chase rule resumes its advance; dissolve timer resets on damage', () => {
    const w = fake.makeWorld({ objective: 'raze', depth: 1 });
    debugForceWave(w, 1);
    const u = waveUnits(w, 1)[0];
    fake.step(w, 20);
    fake.dealTrueDamage(w, u, 1, 0);
    fake.step(w, 20);
    expect(u.alive).toBe(true);
    fake.step(w, 11);
    expect(u.alive).toBe(false);
  });
});
