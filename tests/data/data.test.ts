import { describe, expect, it } from 'vitest';
import type { Cost, Effect, EffectFlag, Selector, StatKey, UnitClass } from '../../src/sim/types';
import {
  ACQUIRE,
  BIOMES,
  BIOME_IDS,
  BIOME_WEIGHTS,
  BOONS,
  BOON_IDS,
  BOSS,
  BUILDINGS,
  BUILDING_IDS,
  BUILD_MENU,
  CLASS_STRUCT_MOD,
  DOCTRINES,
  DOCTRINE_IDS,
  DRAFTS,
  DRAFT_IDS,
  ENEMY_UNIT_IDS,
  ENEMY_UNLOCK_DEPTH,
  EVENTS,
  EVENT_IDS,
  HOLDFAST,
  HOUSES,
  HOUSE_IDS,
  META_UNLOCKS,
  META_UNLOCK_IDS,
  META_UNLOCK_ORDER,
  MODIFIERS,
  MODIFIER_IDS,
  MODIFIER_ROLLS,
  NEGATIVE_MODIFIERS,
  OBJECTIVES,
  OBJECTIVE_ANCHORS,
  OBJECTIVE_IDS,
  PLAYER_BUILDING_IDS,
  PLAYER_UNIT_IDS,
  RESEARCH,
  RESEARCH_IDS,
  RESOURCE_NODES,
  RUN_MAP,
  UNITS,
  UNIT_IDS,
  acquireRadius,
  armorDamage,
  blightCap,
  blightParams,
  bossWaveValue,
  buildTime,
  cacheCount,
  cacheGuardValue,
  ancientCacheGuardValue,
  depthFactor,
  firstWaveLaunch,
  garrisonValue,
  holdfastWaveValue,
  nestCount,
  nestFactor,
  nestHp,
  nestsFor,
  netIncome,
  nobleHp,
  parSeconds,
  picketValue,
  raidLaunchTime,
  raidValue,
  rankForKills,
  regentHp,
  renownTotal,
  rootbreakerCap,
  thornboundFor,
  threatRating,
  wardenRespawn,
  waveInterval,
  waveLaunchTime,
  waveValue,
} from '../../src/data';

const STAT_KEYS: StatKey[] = [
  'hp', 'atk', 'damage', 'cooldown', 'range', 'armor', 'speed', 'sight', 'trainTime', 'buildTime', 'structMod', 'volley',
];
const FLAGS: EffectFlag[] = [
  'spoils_of_the_wake', 'baggage_train', 'veterans_oath', 'firebrand', 'field_surgeons', 'flame_banner', 'plunderers',
  'kiln_masons', 'raiders_bounty', 'kindled_earth', 'flame_hearth', 'ember_tithe', 'second_wind', 'home_seam_bonus',
  'hearth_watch', 'thunder_charge', 'hawk', 'burn_disabled',
];
const CLASSES: UnitClass[] = ['worker', 'infantry', 'ranged', 'cavalry', 'siege', 'hero', 'boss'];
const RES = ['grain', 'timber', 'ember'];

function expectKeyedTable(table: Record<string, { id: string }>, ids: readonly string[]): void {
  expect(Object.keys(table).sort()).toEqual([...ids].sort());
  for (const [k, v] of Object.entries(table)) expect(v.id).toBe(k);
}

function expectCostOk(cost: Cost, label: string): void {
  for (const [res, v] of Object.entries(cost)) {
    expect(RES, label).toContain(res);
    expect(v, `${label} ${res}`).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(v), label).toBe(true);
  }
}

function checkSelector(sel: Selector, label: string): void {
  const keys = Object.keys(sel).filter((k) => sel[k as keyof Selector] !== undefined);
  expect(keys.length, `${label}: empty selector matches nothing`).toBeGreaterThan(0);
  for (const u of sel.units ?? []) expect(UNIT_IDS, label).toContain(u);
  for (const b of sel.buildings ?? []) expect(BUILDING_IDS, label).toContain(b);
  for (const c of sel.classes ?? []) expect(CLASSES, label).toContain(c);
}

function checkEffect(e: Effect, label: string): void {
  switch (e.kind) {
    case 'stat':
      checkSelector(e.sel, label);
      expect(STAT_KEYS, label).toContain(e.stat);
      expect(e.add !== undefined || e.pct !== undefined || e.set !== undefined, label).toBe(true);
      break;
    case 'cost':
      checkSelector(e.sel, label);
      if (e.res) expect(RES, label).toContain(e.res);
      expect(e.add !== undefined || e.pct !== undefined || e.set !== undefined, label).toBe(true);
      if (e.set !== undefined) expect(e.set).toBeGreaterThanOrEqual(0);
      break;
    case 'gather':
      expect([...RES, 'all'], label).toContain(e.res);
      if (e.source) expect(['thicket', 'tree', 'ember_seam', 'grainplot'], label).toContain(e.source);
      break;
    case 'carry':
      expect([...RES, 'all'], label).toContain(e.res);
      break;
    case 'startRes':
      expectCostOk(e.res, label);
      break;
    case 'startUnits':
      expect(PLAYER_UNIT_IDS, label).toContain(e.unit);
      expect(e.count).toBeGreaterThan(0);
      break;
    case 'popCap':
      break;
    case 'flag':
      expect(FLAGS, label).toContain(e.flag);
      break;
  }
}

function allEffects(): [string, Effect][] {
  const out: [string, Effect][] = [];
  for (const b of Object.values(BOONS)) for (const e of b.effects) out.push([`boon ${b.id}`, e]);
  for (const r of Object.values(RESEARCH)) for (const e of r.effects) out.push([`research ${r.id}`, e]);
  for (const h of Object.values(HOUSES)) for (const e of h.effects) out.push([`house ${h.id}`, e]);
  for (const m of Object.values(META_UNLOCKS)) for (const e of m.effects ?? []) out.push([`meta ${m.id}`, e]);
  for (const m of Object.values(MODIFIERS)) {
    for (const e of m.playerEffects ?? []) out.push([`modifier ${m.id} player`, e]);
    for (const e of m.enemyEffects ?? []) out.push([`modifier ${m.id} enemy`, e]);
  }
  return out;
}

describe('table coverage', () => {
  it('every id in each union has an entry keyed by its id', () => {
    expectKeyedTable(UNITS, UNIT_IDS);
    expectKeyedTable(BUILDINGS, BUILDING_IDS);
    expectKeyedTable(RESEARCH, RESEARCH_IDS);
    expectKeyedTable(BOONS, BOON_IDS);
    expectKeyedTable(DRAFTS, DRAFT_IDS);
    expectKeyedTable(MODIFIERS, MODIFIER_IDS);
    expectKeyedTable(EVENTS, EVENT_IDS);
    expectKeyedTable(HOUSES, HOUSE_IDS);
    expectKeyedTable(META_UNLOCKS, META_UNLOCK_IDS);
    expectKeyedTable(DOCTRINES, DOCTRINE_IDS);
    expectKeyedTable(BIOMES, BIOME_IDS);
    expectKeyedTable(OBJECTIVES, OBJECTIVE_IDS);
    expectKeyedTable(RESOURCE_NODES, ['thicket', 'tree', 'ember_seam']);
  });

  it('has the GDD counts', () => {
    expect(PLAYER_UNIT_IDS).toHaveLength(11);
    expect(ENEMY_UNIT_IDS).toHaveLength(9);
    expect(BOON_IDS).toHaveLength(25);
    expect(RESEARCH_IDS).toHaveLength(11);
    expect(EVENT_IDS).toHaveLength(6);
    expect(MODIFIER_IDS).toHaveLength(10);
    expect(META_UNLOCK_IDS).toHaveLength(14);
    expect(DRAFT_IDS).toHaveLength(6);
    expect(new Set(META_UNLOCK_ORDER)).toEqual(new Set(META_UNLOCK_IDS));
  });

  it('player units are player-side and enemy units enemy-side', () => {
    for (const id of PLAYER_UNIT_IDS) expect(UNITS[id].side).toBe('player');
    for (const id of ENEMY_UNIT_IDS) expect(UNITS[id].side).toBe('enemy');
    for (const id of PLAYER_BUILDING_IDS) expect(BUILDINGS[id].side).toBe('player');
  });
});

describe('costs and stats', () => {
  it('costs are non-negative', () => {
    for (const u of Object.values(UNITS)) expectCostOk(u.cost, u.id);
    for (const b of Object.values(BUILDINGS)) expectCostOk(b.cost, b.id);
    for (const r of Object.values(RESEARCH)) expectCostOk(r.cost, r.id);
  });

  it('unit stats are sane', () => {
    for (const u of Object.values(UNITS)) {
      expect(u.hp, u.id).toBeGreaterThan(0);
      expect(u.speed, u.id).toBeGreaterThan(0);
      expect(u.radius, u.id).toBeGreaterThan(0);
      for (const c of Object.keys(u.bonus)) expect(CLASSES).toContain(c);
      if (u.range >= 1.5) expect(u.projectile, `${u.id} is ranged and needs a projectile`).toBeDefined();
      if (u.side === 'enemy' && u.id !== 'antlered_lord' && u.id !== 'briar_regent') {
        expect(u.value, u.id).toBeGreaterThan(0);
        expect(u.fromDepth, u.id).toBe(ENEMY_UNLOCK_DEPTH[u.id as keyof typeof ENEMY_UNLOCK_DEPTH]);
      }
    }
  });

  it('collision radii follow §F', () => {
    expect(UNITS.tiller.radius).toBe(0.3);
    expect(UNITS.warden.radius).toBe(0.35);
    expect(UNITS.courser.radius).toBe(0.4);
    expect(UNITS.stagrider.radius).toBe(0.4);
    expect(UNITS.gatebreaker.radius).toBe(0.45);
    expect(UNITS.rootbreaker.radius).toBe(0.45);
    expect(UNITS.thornhusk.radius).toBe(0.45);
    expect(UNITS.antlered_lord.radius).toBe(0.6);
    expect(UNITS.briar_regent.radius).toBe(1.1);
  });

  it('standing-eligible types have value >= 2 and are not siege', () => {
    for (const id of ENEMY_UNIT_IDS) {
      const u = UNITS[id];
      if (u.standingEligible) {
        expect(u.value ?? 0, id).toBeGreaterThanOrEqual(2);
        expect(u.cls, id).not.toBe('siege');
      }
    }
  });
});

describe('hotkeys and production links', () => {
  it('train hotkeys are unique per building and consistent with trainedAt', () => {
    for (const b of Object.values(BUILDINGS)) {
      const keys = (b.trains ?? []).map((u) => {
        expect(UNITS[u].trainedAt, `${u} trainedAt`).toBe(b.id);
        return UNITS[u].hotkey;
      });
      for (const k of keys) expect(k, `${b.id} train hotkey`).toMatch(/^[QWE]$/);
      expect(new Set(keys).size, `${b.id} train hotkeys`).toBe(keys.length);
    }
    for (const id of PLAYER_UNIT_IDS) {
      const u = UNITS[id];
      if (id === 'warden') continue;
      expect(u.trainedAt, id).toBeDefined();
      expect(BUILDINGS[u.trainedAt!].trains, id).toContain(id);
    }
  });

  it('research hotkeys are unique per building and consistent with building lists', () => {
    for (const b of Object.values(BUILDINGS)) {
      const keys = (b.research ?? []).map((r) => {
        expect(RESEARCH[r].building, r).toBe(b.id);
        return RESEARCH[r].hotkey;
      });
      for (const k of keys) expect(k).toMatch(/^[ZXC]$/);
      expect(new Set(keys).size, `${b.id} research hotkeys`).toBe(keys.length);
    }
    for (const r of Object.values(RESEARCH)) expect(BUILDINGS[r.building].research, r.id).toContain(r.id);
  });

  it('Tiller build menu hotkeys are unique and cover buildable player buildings', () => {
    const keys = BUILD_MENU.map((b) => BUILDINGS[b].hotkey);
    expect(keys).toEqual(['C', 'E', 'F', 'B', 'R', 'P', 'N', 'T', 'Y']);
    expect(new Set(keys).size).toBe(keys.length);
    for (const id of PLAYER_BUILDING_IDS) {
      if (id === 'hearth') expect(BUILDINGS[id].hotkey).toBeUndefined();
      else expect(BUILD_MENU).toContain(id);
    }
  });

  it('prerequisites reference player buildings', () => {
    expect(BUILDINGS.forgehall.requires).toEqual([['muster_hall'], ['bowyard']]);
    expect(BUILDINGS.siegeyard.requires).toEqual([['forgehall']]);
    expect(UNITS.brandbow.requires).toEqual(['forgehall']);
    expect(UNITS.destrier.requires).toEqual(['forgehall']);
  });

  it('tempers are exactly the Forgehall research', () => {
    const tempers = Object.values(RESEARCH).filter((r) => r.temper).map((r) => r.id).sort();
    expect(tempers).toEqual(['barbed_heads', 'ember_edge', 'hauberks']);
  });
});

describe('effects', () => {
  it('every Effect references valid ids, stat keys and flags', () => {
    const effects = allEffects();
    expect(effects.length).toBeGreaterThan(40);
    for (const [label, e] of effects) checkEffect(e, label);
  });

  it('encodes key boons per the task examples', () => {
    expect(BOONS.master_joiners.effects[0]).toEqual({ kind: 'stat', sel: { allBuildings: true }, stat: 'buildTime', pct: -23.08 });
    expect(BOONS.ember_tithe.effects).toContainEqual({ kind: 'flag', flag: 'ember_tithe', value: 1.2 });
    expect(BOONS.deep_delvers.effects).toContainEqual({ kind: 'flag', flag: 'home_seam_bonus', value: 200 });
    expect(BOONS.firebrand.effects).toContainEqual({ kind: 'stat', sel: { units: ['bowman', 'outrider'] }, stat: 'structMod', set: 0.4 });
  });

  it('boon pools match the Codex table', () => {
    const pools = Object.fromEntries(Object.values(BOONS).map((b) => [b.id, b.pool]));
    expect(pools.kiln_masons).toBe('codex_1');
    expect(pools.raiders_bounty).toBe('codex_1');
    expect(pools.thornreaper_levy).toBe('codex_2');
    expect(pools.spoils_of_the_wake).toBe('codex_2');
    expect(pools.kindled_earth).toBe('codex_3');
    expect(pools.warlords_gambit).toBe('codex_3');
    const rarities = Object.values(BOONS).reduce<Record<string, number>>((acc, b) => ((acc[b.rarity] = (acc[b.rarity] ?? 0) + 1), acc), {});
    expect(rarities).toEqual({ C: 11, R: 10, M: 4 });
  });

  it('drafts and houses reference valid content', () => {
    for (const d of Object.values(DRAFTS)) {
      for (const u of d.units) expect(PLAYER_UNIT_IDS).toContain(u);
      for (const b of d.buildings) expect(PLAYER_BUILDING_IDS).toContain(b);
      if (d.requiresMeta) expect(META_UNLOCK_IDS).toContain(d.requiresMeta);
    }
    for (const h of Object.values(HOUSES)) if (h.unlock) expect(META_UNLOCK_IDS).toContain(h.unlock);
    expect(HOUSES.ardent.unlock).toBeNull();
  });

  it('meta unlocks total 950 Renown with the Codex chain', () => {
    expect(Object.values(META_UNLOCKS).reduce((s, m) => s + m.cost, 0)).toBe(950);
    expect(META_UNLOCKS.codex_2.requires).toBe('codex_1');
    expect(META_UNLOCKS.codex_3.requires).toBe('codex_2');
  });

  it('events have 2-3 unique choices', () => {
    for (const ev of Object.values(EVENTS)) {
      expect(ev.choices.length).toBeGreaterThanOrEqual(2);
      expect(ev.choices.length).toBeLessThanOrEqual(3);
      expect(new Set(ev.choices.map((c) => c.id)).size).toBe(ev.choices.length);
    }
  });

  it('modifiers: negative list matches kinds', () => {
    const neg = MODIFIER_IDS.filter((m) => MODIFIERS[m].kind === 'negative').sort();
    expect(neg).toEqual([...NEGATIVE_MODIFIERS].sort());
  });

  it('doctrine weights reference wave-eligible enemy types', () => {
    for (const d of Object.values(DOCTRINES)) {
      for (const id of Object.keys(d.weights)) expect(Object.keys(ENEMY_UNLOCK_DEPTH)).toContain(id);
    }
    expect(DOCTRINES.hunt.fromDepth).toBe(2);
    expect(DOCTRINES.siegebreak.fromDepth).toBe(3);
    expect(DOCTRINES.court.fromDepth).toBe(4);
  });

  it('doctrine counsel: names the doctrine, and has a core-units variant when it names drafted units', () => {
    const drafted = [...new Set(Object.values(DRAFTS).flatMap((d) => d.units))];
    // "Bowman" also matches "Bowmen", "Oathshield" matches "Oathshields".
    const named = (text: string) => drafted.filter((u) => text.includes(UNITS[u].name.replace(/man$/, 'm')));
    expect(named('Coursers, Ashpikes and Bowmen')).toEqual([]);
    expect(named('Oathshields and Destriers').sort()).toEqual(['destrier', 'oathshield']);
    for (const d of Object.values(DOCTRINES)) {
      expect(d.answer.startsWith(`${d.name}:`), d.id).toBe(true);
      const inAnswer = named(d.answer);
      if (inAnswer.length === 0) {
        expect(d.answerCore, d.id).toBeUndefined();
        continue;
      }
      expect(d.answerCore, d.id).toBeDefined();
      expect(d.answerCore!.startsWith(`${d.name}:`), d.id).toBe(true);
      expect(named(d.answerCore!), d.id).toEqual([]);
      expect([...(d.answerDrafts ?? [])].sort(), d.id).toEqual([...inAnswer].sort());
    }
    // Ember Edge is a Forgehall Temper: both are core (no Draft).
    expect(RESEARCH.ember_edge.building).toBe('forgehall');
    expect(Object.values(DRAFTS).some((d) => d.buildings.includes('forgehall'))).toBe(false);
  });
});

describe('depth formulas (§C)', () => {
  it('depth table rows d1 / d4 / d6', () => {
    expect([1, 4, 6].map(depthFactor).map((f) => +f.toFixed(2))).toEqual([1, 1.36, 1.6]);
    expect([1, 4, 6].map(firstWaveLaunch)).toEqual([106, 94, 86]);
    expect([1, 4, 6].map(waveInterval)).toEqual([68, 62, 58]);
    expect([1, 4, 6].map(nestHp)).toEqual([800, 1100, 1300]);
    expect([1, 4, 6].map(nestCount)).toEqual([2, 2, 3]);
    expect([1, 4, 6].map(garrisonValue)).toEqual([5, 8, 10]);
    expect([1, 4, 6].map(picketValue)).toEqual([3, 6, 8]);
    expect([1, 4, 6].map(cacheGuardValue)).toEqual([3, 6, 8]);
    expect([1, 4, 6].map(raidValue)).toEqual([0, 6, 8]);
    expect([1, 4, 6].map(blightCap)).toEqual([11, 14, 16]);
    expect(ancientCacheGuardValue(3)).toBe(12);
    expect([1, 3, 4, 6].map(cacheCount)).toEqual([1, 1, 2, 2]);
    expect([3, 4, 6].map(rootbreakerCap)).toEqual([1, 2, 2]);
  });

  it('wave value table V(n,d) with launch times', () => {
    const table: Record<number, [number, string][]> = {
      1: [[10, '1:46'], [16, '2:54'], [22, '4:02'], [30, '5:10'], [38, '6:18'], [48, '7:26'], [58, '8:34']],
      2: [[11, '1:42'], [17, '2:48'], [25, '3:54'], [33, '5:00'], [43, '6:06'], [53, '7:12'], [65, '8:18']],
      3: [[13, '1:38'], [19, '2:42'], [27, '3:46'], [37, '4:50'], [47, '5:54'], [59, '6:58'], [72, '8:02']],
      4: [[14, '1:34'], [21, '2:36'], [30, '3:38'], [40, '4:40'], [52, '5:42'], [65, '6:44'], [79, '7:46']],
      5: [[15, '1:30'], [23, '2:30'], [33, '3:30'], [44, '4:30'], [56, '5:30'], [71, '6:30'], [86, '7:30']],
      6: [[16, '1:26'], [25, '2:24'], [36, '3:22'], [48, '4:20'], [61, '5:18'], [76, '6:16'], [93, '7:14']],
    };
    const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    for (const [d, row] of Object.entries(table)) {
      row.forEach(([v, t], i) => {
        expect(waveValue(i + 1, +d), `V(${i + 1},${d})`).toBe(v);
        expect(mmss(waveLaunchTime(i + 1, +d)), `T(${i + 1},${d})`).toBe(t);
      });
    }
  });

  it('nest factor N and multipliers', () => {
    expect(nestFactor(2, 2)).toBeCloseTo(1);
    expect(nestFactor(1, 2)).toBeCloseTo(0.7);
    expect(nestFactor(2, 3)).toBeCloseTo(0.8);
    expect(nestFactor(1, 3)).toBeCloseTo(0.6);
    expect(waveValue(3, 1, 1, 1.3)).toBe(29);
  });

  it('Holdfast table', () => {
    const table = [
      [8, 13, 18, 25, 34, 52],
      [8, 13, 19, 26, 36, 55],
      [8, 14, 20, 28, 38, 58],
      [9, 15, 21, 29, 40, 61],
      [9, 16, 22, 31, 42, 64],
      [10, 16, 23, 32, 44, 67],
    ];
    table.forEach((row, di) => row.forEach((v, n) => expect(holdfastWaveValue(n + 1, di + 1), `H(${n + 1},${di + 1})`).toBe(v)));
    expect(HOLDFAST.launchTimes).toEqual([60, 105, 150, 195, 240, 285]);
  });

  it('boss waves with 3 Hearts', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => bossWaveValue(n, 3))).toEqual([15, 24, 33, 45, 57, 72, 87]);
    expect(regentHp(3)).toBe(7500);
    expect(regentHp(0)).toBe(3000);
    expect(BOSS.BOSS_F).toBe(1.5);
  });

  it('noble, threat, par, nests, blight params, raids', () => {
    expect(nobleHp(3)).toBe(2400);
    expect(nobleHp(5)).toBe(2880);
    expect([1, 2, 3, 4, 5, 6].map((d) => threatRating(d, false))).toEqual([1, 2, 2, 3, 3, 4]);
    expect(threatRating(6, true)).toBe(5);
    expect(threatRating(1, false, true)).toBe(5);
    expect(parSeconds('raze', 2)).toBe(360);
    expect(parSeconds('raze', 3)).toBe(405);
    expect(parSeconds('elite', 2)).toBe(390);
    expect(parSeconds('beacons', 3)).toBe(330);
    expect(parSeconds('holdfast', 2)).toBeNull();
    expect(nestsFor('elite', 6)).toBe(2);
    expect(nestsFor('raze', 5)).toBe(3);
    expect(blightParams('raze', 4, false)).toEqual({ start: 4, cap: 14, interval: 20 });
    expect(blightParams('holdfast', 4, false)).toEqual({ start: 4, cap: 8, interval: 25 });
    expect(blightParams('raze', 4, true)).toEqual({ start: 4, cap: 17, interval: 12 });
    expect(blightParams('boss', 7, false)).toEqual({ start: 4, cap: 12, interval: 10 });
    expect(raidLaunchTime(106, 68)).toBe(140);
    expect(OBJECTIVE_ANCHORS.holdfast.size).toBe(48);
  });
});

describe('combat checks (§G verified 1v1)', () => {
  const hit = (a: keyof typeof UNITS, b: keyof typeof UNITS) => {
    const A = UNITS[a];
    const B = UNITS[b];
    const mult = B.cls === 'hero' || B.cls === 'boss' ? 1 : (A.bonus[B.cls] ?? 1);
    return armorDamage(A.atk * mult, B.armor);
  };

  it('primary counters', () => {
    expect(hit('ashpike', 'courser')).toBe(14);
    expect(hit('courser', 'ashpike')).toBe(5);
    expect(hit('courser', 'bowman')).toBe(12);
    expect(hit('bowman', 'courser')).toBe(5);
    expect(hit('ashpike', 'destrier')).toBe(12);
    expect(hit('destrier', 'ashpike')).toBe(12);
  });

  it('Thornling breakpoints', () => {
    const hp = UNITS.thornling.hp;
    expect(Math.ceil(hp / hit('bowman', 'thornling'))).toBe(3);
    expect(Math.ceil(hp / armorDamage((UNITS.bowman.atk + 2) * 2, 0))).toBe(2);
    expect(Math.ceil(hp / hit('ashpike', 'thornling'))).toBe(5);
    expect(Math.ceil(hp / armorDamage(UNITS.ashpike.atk + 1, 0))).toBe(4);
  });

  it('Gatebreaker vs Nest and Regent', () => {
    const gb = UNITS.gatebreaker;
    expect(armorDamage(gb.atk * (gb.structMod ?? CLASS_STRUCT_MOD.siege), 3)).toBe(92);
    expect(armorDamage(gb.atk * (gb.vsBoss ?? 1), BOSS.armor)).toBe(30);
  });

  it('auto-acquire radius', () => {
    expect(acquireRadius(0.7)).toBe(ACQUIRE.radius);
    expect(acquireRadius(6)).toBe(7);
    expect(acquireRadius(5)).toBe(6);
  });
});

describe('economy and run tables', () => {
  it('net income matches the §D table', () => {
    expect(netIncome(10, 1.0, 5)).toBeCloseTo(0.67, 2);
    expect(netIncome(10, 0.8, 8)).toBeCloseTo(0.5, 1);
    expect(netIncome(10, 0.6, 2.5)).toBeCloseTo(0.52, 2);
  });

  it('build time, veterancy, respawn, renown, thornbound', () => {
    expect(buildTime(30, 1)).toBe(30);
    expect(buildTime(30, 4)).toBe(15);
    expect(buildTime(30, 9)).toBe(15);
    expect([0, 2, 3, 6, 7, 11, 12, 40].map(rankForKills)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(wardenRespawn(0, false)).toBe(45);
    expect(wardenRespawn(2, false)).toBe(75);
    expect(wardenRespawn(1, true)).toBe(30);
    expect(renownTotal({ battlesWon: 6, elitesWon: 1, regentSlain: true, nests: 13, nodes: 8, tier: 0 })).toBe(191);
    expect(thornboundFor(3)).toEqual({ waveMult: 1.1, nestHpMult: 1.25, t1Delta: -15, garrisonAdd: 2 });
    expect(thornboundFor(0)).toEqual({ waveMult: 1, nestHpMult: 1, t1Delta: 0, garrisonAdd: 0 });
  });

  it('weight tables sum to 100', () => {
    for (const w of Object.values(BIOME_WEIGHTS)) expect(Object.values(w).reduce((a, b) => a + (b ?? 0), 0)).toBe(100);
    const col7 = RUN_MAP.weights[7];
    expect(Object.values(col7).reduce((a, b) => a + (b ?? 0), 0)).toBe(100);
    expect(RUN_MAP.weights[3].camp).toBeUndefined();
    expect(MODIFIER_ROLLS[1].first).toBe(0);
    expect(MODIFIER_ROLLS[5]).toEqual({ first: 1, second: 0.3 });
  });

  it('biomes carry full palettes and coverage', () => {
    for (const b of Object.values(BIOMES)) {
      for (const c of Object.values(b.palette)) expect(c).toMatch(/^#[0-9A-F]{6}$/i);
      expect(b.water + b.forest + b.rock).toBeLessThan(1);
    }
    expect(BIOMES.ashwood.treeAmount).toBe(90);
  });
});
