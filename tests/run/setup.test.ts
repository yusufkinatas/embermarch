import { beforeEach, describe, expect, it } from 'vitest';
import { BOONS, DOCTRINES, HINTS, HOUSES, MODIFIERS } from '../../src/data';
import { enterNode, finishBattle, quickBattleSetup, startBattle } from '../../src/run';
import type { Effect, HouseId, MetaUnlockId } from '../../src/sim/types';
import { forceNode, freshRun, metaWith, mkResult, useMemoryStorage } from './helpers';

const ALL_HOUSES: MetaUnlockId[] = ['house_tallow', 'house_grimbrand', 'house_lowmere'];

function setupFor(o: { house?: HouseId; unlocks?: MetaUnlockId[]; tier?: number; prep?: (r: ReturnType<typeof freshRun>['run']) => void } = {}) {
  const meta = metaWith([...ALL_HOUSES, ...(o.unlocks ?? [])]);
  const { run } = freshRun({ meta, house: o.house, tier: o.tier });
  o.prep?.(run);
  const { node } = forceNode(run, meta, 'battle', { battle: { depth: 2, seed: 4242 } });
  return { setup: startBattle(run, meta, 'bowyard'), run, meta, node };
}
const startTillers = (effects: Effect[]) =>
  effects.reduce((n, e) => (e.kind === 'startUnits' && e.unit === 'tiller' ? n + e.count : n), 0);

describe('startBattle → BattleSetup', () => {
  beforeEach(() => useMemoryStorage());

  it('copies node rolls and run state', () => {
    const { setup, run } = setupFor();
    expect(setup).toMatchObject({
      seed: 4242,
      objective: 'raze',
      depth: 2,
      isElite: false,
      isBoss: false,
      house: 'ardent',
      vanguard: 'bowyard',
      tier: 0,
      resolve: 3,
      waveMult: 1,
      wardenHpPct: 1,
      coldWatchfire: false,
      bonusRes: {},
    });
    expect(setup.nodeId).toBe(run.currentNode);
    expect(setup.unlockedUnits.sort()).toEqual(['ashpike', 'bowman', 'courser', 'tiller', 'warden']);
    expect(setup.unlockedBuildings).not.toContain('siegeyard');
    expect(setup.unlockedBuildings).toHaveLength(9);
    expect(run.battleInProgress).toBe(true);
  });

  it.each(['ardent', 'tallow', 'grimbrand', 'lowmere'] as HouseId[])('applies House %s effects', (house) => {
    const { setup } = setupFor({ house });
    for (const e of HOUSES[house].effects) expect(setup.playerEffects).toContainEqual(e);
    expect(startTillers(setup.playerEffects)).toBe(house === 'tallow' ? 1 : 0);
  });

  it('applies meta unlocks: Hearth Lore +1 Tiller, Hawk Eyes flag', () => {
    const { setup } = setupFor({ unlocks: ['hearth_lore', 'hawk_eyes', 'codex_1', 'guild_ties'] });
    expect(startTillers(setup.playerEffects)).toBe(1);
    expect(setup.playerEffects).toContainEqual({ kind: 'flag', flag: 'hawk' });
    expect(setup.metaUnlocks).toContain('hearth_lore');
    const none = setupFor();
    expect(none.setup.playerEffects.some((e) => e.kind === 'flag' && e.flag === 'hawk')).toBe(false);
  });

  it('adds Boon effects, Refugee Tillers, Drafted units and the Siegeyard', () => {
    const { setup } = setupFor({
      house: 'tallow',
      unlocks: ['hearth_lore'],
      prep: (r) => {
        r.boons = ['hearthborn', 'quartermasters', 'veterans_oath'];
        r.drafts = ['draft_siegecraft', 'draft_shieldwall'];
        r.extraTillers = 2;
      },
    });
    for (const b of ['hearthborn', 'quartermasters', 'veterans_oath'] as const) {
      for (const e of BOONS[b].effects) expect(setup.playerEffects).toContainEqual(e);
    }
    // Tallow 1 + Hearth Lore 1 + Hearthborn 2 + Refugees 2.
    expect(startTillers(setup.playerEffects)).toBe(6);
    expect(setup.unlockedUnits).toEqual(expect.arrayContaining(['gatebreaker', 'oathshield']));
    expect(setup.unlockedBuildings).toContain('siegeyard');
    expect(setup.boons).toEqual(['hearthborn', 'quartermasters', 'veterans_oath']);
  });

  it('splits modifier effects between the player and the enemy', () => {
    const meta = metaWith();
    const { run } = freshRun({ meta });
    forceNode(run, meta, 'battle', { battle: { modifiers: ['thick_fog', 'swift_hunt', 'downpour'] } });
    const setup = startBattle(run, meta, 'muster_hall');
    for (const e of MODIFIERS.thick_fog.playerEffects!) expect(setup.playerEffects).toContainEqual(e);
    for (const e of MODIFIERS.downpour.playerEffects!) expect(setup.playerEffects).toContainEqual(e);
    for (const e of MODIFIERS.swift_hunt.enemyEffects!) expect(setup.enemyEffects).toContainEqual(e);
    for (const e of MODIFIERS.downpour.enemyEffects!) expect(setup.enemyEffects).toContainEqual(e);
    expect(setup.enemyEffects).toHaveLength(MODIFIERS.swift_hunt.enemyEffects!.length + MODIFIERS.downpour.enemyEffects!.length);
  });

  it('wave multiplier: Thornbound I ×1.1 (tier ≥ 1) and Hollow Envoy ×1.15', () => {
    expect(setupFor({ tier: 1 }).setup.waveMult).toBeCloseTo(1.1);
    expect(setupFor({ tier: 3 }).setup.waveMult).toBeCloseTo(1.1);
    expect(setupFor({ tier: 2, prep: (r) => (r.waveMult = 1.15) }).setup.waveMult).toBeCloseTo(1.265);
    expect(setupFor({ tier: 2 }).setup.tier).toBe(2);
  });

  it('first march: the start node has waves ×0.85 in the first 3 runs of a profile, on top of Thornbound', () => {
    const at = (profileRunIndex: number, tier = 0) => {
      const meta = metaWith();
      meta.tierUnlocked = 3;
      const { run } = freshRun({ meta, tier });
      run.profileRunIndex = profileRunIndex;
      enterNode(run, meta, 'start');
      return startBattle(run, meta, 'muster_hall').waveMult;
    };
    for (const i of [0, 1, 2]) expect(at(i)).toBeCloseTo(0.85);
    for (const i of [3, 4, 10]) expect(at(i)).toBe(1);
    expect(at(0, 1)).toBeCloseTo(1.1 * 0.85);
    expect(at(5, 1)).toBeCloseTo(1.1);
    // Any other node keeps the normal multiplier, even in the first run.
    const meta = metaWith();
    const { run } = freshRun({ meta });
    expect(run.profileRunIndex).toBe(0);
    forceNode(run, meta, 'battle', { battle: { objective: 'raze', depth: 2 } });
    expect(startBattle(run, meta, 'muster_hall').waveMult).toBe(1);
  });

  it('Baggage Train carries 50% of unspent (max 250 each, at least +75 Ember) into bonusRes', () => {
    const meta = metaWith();
    const { run } = freshRun({ meta });
    run.boons = ['baggage_train'];
    const { node } = forceNode(run, meta, 'battle', { battle: { reward: 'spoils' } });
    startBattle(run, meta, 'muster_hall');
    finishBattle(run, meta, mkResult({ unspent: { grain: 900, timber: 101, ember: 40 } }));
    expect(run.pending).toContainEqual({ kind: 'baggage', res: { grain: 250, timber: 50, ember: 75 } });
    // Next battle: the carried resources arrive as bonusRes, then the next carry replaces them.
    const next = run.map.nodes[node.next[0]];
    next.type = 'battle';
    next.battle = { ...node.battle!, seed: 9, depth: next.col };
    run.rewardQueue = [];
    expect(enterNode(run, meta, next.id).screen).toBe('briefing');
    const setup = startBattle(run, meta, 'storehouse');
    expect(setup.bonusRes).toEqual({ grain: 250, timber: 50, ember: 75 });
    finishBattle(run, meta, mkResult({ outcome: 'retreat', unspent: { grain: 0, timber: 0, ember: 0 } }));
    expect(run.pending.filter((p) => p.kind === 'baggage')).toEqual([{ kind: 'baggage', res: { grain: 0, timber: 0, ember: 75 } }]);
  });

  it('showHints follows the setting, the first 3 runs and unseen hints', () => {
    const { run, meta, setup } = setupFor();
    expect(setup.showHints).toBe(true);
    meta.settings.showHints = false;
    expect(startBattle(run, meta, 'bowyard').showHints).toBe(false);
    meta.settings.showHints = true;
    run.profileRunIndex = 5;
    meta.hintsSeen = HINTS.map((h) => h.id);
    expect(startBattle(run, meta, 'bowyard').showHints).toBe(false);
    meta.hintsSeen.pop();
    expect(startBattle(run, meta, 'bowyard').showHints).toBe(true);
  });

  it('refuses to start outside a battle node', () => {
    const meta = metaWith();
    const { run } = freshRun({ meta });
    expect(() => startBattle(run, meta, 'muster_hall')).toThrow();
    forceNode(run, meta, 'camp');
    expect(() => startBattle(run, meta, 'muster_hall')).toThrow();
  });
});

describe('quickBattleSetup', () => {
  it('has sensible defaults: depth 1, Ardent, Muster Hall, doctrine available at depth', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = quickBattleSetup({ objective: 'raze', seed });
      expect(s).toMatchObject({ depth: 1, house: 'ardent', vanguard: 'muster_hall', objective: 'raze', modifiers: [], tier: 0, resolve: 3 });
      expect(DOCTRINES[s.doctrine].fromDepth).toBeLessThanOrEqual(1);
      expect(s.biome).toBe('greenmarch');
      expect(s.playerEffects).toEqual(HOUSES.ardent.effects);
    }
    expect(quickBattleSetup({ objective: 'raze', seed: 5 })).toEqual(quickBattleSetup({ objective: 'raze', seed: 5 }));
  });

  it('handles elite, boss, modifiers, boons and drafts', () => {
    const boss = quickBattleSetup({ objective: 'boss', seed: 1, depth: 3 });
    expect(boss).toMatchObject({ isBoss: true, depth: 7, biome: 'heartwood', modifiers: [] });
    const elite = quickBattleSetup({ objective: 'elite', depth: 4, seed: 2, modifiers: ['swift_hunt'], house: 'lowmere' });
    expect(elite).toMatchObject({ isElite: true, depth: 4, doctrine: 'hunt', house: 'lowmere' });
    expect(elite.enemyEffects).toEqual(MODIFIERS.swift_hunt.enemyEffects);
    const q = quickBattleSetup({ objective: 'holdfast', depth: 9, seed: 3, boons: ['flame_hearth'], drafts: ['draft_firecraft'] });
    expect(q.depth).toBe(6);
    expect(q.unlockedUnits).toContain('brandbow');
    expect(q.playerEffects).toEqual(expect.arrayContaining(BOONS.flame_hearth.effects));
  });
});
