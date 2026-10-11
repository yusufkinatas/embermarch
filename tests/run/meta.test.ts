import { beforeEach, describe, expect, it } from 'vitest';
import { META_UNLOCKS, META_UNLOCK_IDS } from '../../src/data';
import {
  availableHouses,
  availableTiers,
  boonInfo,
  buyUnlock,
  canBuyUnlock,
  chooseCamp,
  defaultMeta,
  draftInfo,
  endRun,
  loadMeta,
  markHintSeen,
  newRun,
  nextUnlock,
} from '../../src/run';
import { forceNode, freshRun, metaWith, useMemoryStorage } from './helpers';

describe('meta progression (§N)', () => {
  beforeEach(() => useMemoryStorage());

  it('defaultMeta is a fresh profile', () => {
    const m = defaultMeta();
    expect(m).toMatchObject({ version: 1, renown: 0, unlocks: [], tierUnlocked: 0, hintsSeen: [] });
    expect(m.settings.showHints).toBe(true);
    expect(availableHouses(m)).toEqual(['ardent']);
    expect(availableTiers(m)).toEqual([0]);
  });

  it('buyUnlock spends Renown, respects the Codex chain, and saves', () => {
    const m = metaWith([], 100);
    expect(canBuyUnlock(m, 'codex_2')).toEqual({ ok: false, reason: 'Requires Codex I' });
    expect(buyUnlock(m, 'codex_2')).toBe(false);
    expect(buyUnlock(m, 'codex_1')).toBe(true);
    expect(m.renown).toBe(70);
    expect(canBuyUnlock(m, 'codex_1')).toMatchObject({ ok: false, reason: 'Already unlocked' });
    expect(buyUnlock(m, 'codex_2')).toBe(true);
    expect(buyUnlock(m, 'codex_3')).toBe(true);
    expect(m.renown).toBe(10);
    expect(canBuyUnlock(m, 'house_tallow')).toEqual({ ok: false, reason: 'Requires 40 Renown' });
    expect(loadMeta().unlocks).toEqual(['codex_1', 'codex_2', 'codex_3']);
  });

  it('all unlocks together cost 950 Renown', () => {
    expect(META_UNLOCK_IDS.reduce((a, id) => a + META_UNLOCKS[id].cost, 0)).toBe(950);
  });

  it('Houses: Ardent free; Tallow, Grimbrand, Lowmere through unlocks; locked Houses cannot start a run', () => {
    const m = metaWith(['house_tallow', 'house_lowmere']);
    expect(availableHouses(m)).toEqual(['ardent', 'tallow', 'lowmere']);
    expect(() => newRun(m, { house: 'grimbrand', tier: 0, seed: 1 })).toThrow(/not unlocked/);
    expect(newRun(m, { house: 'lowmere', tier: 0, seed: 1 }).house).toBe('lowmere');
  });

  it('Thornbound tier is clamped to what the profile unlocked; winning at tier k unlocks k + 1', () => {
    const m = metaWith();
    expect(newRun(m, { house: 'ardent', tier: 2, seed: 1 }).tier).toBe(0);
    const run = newRun(m, { house: 'ardent', tier: 0, seed: 2 });
    run.over = 'won';
    expect(endRun(run, m).tierUnlocked).toBe(1);
    expect(availableTiers(m)).toEqual([0, 1]);
    const lower = newRun(m, { house: 'ardent', tier: 0, seed: 3 });
    lower.over = 'won';
    expect(endRun(lower, m).tierUnlocked).toBeNull();
    const t1 = newRun(m, { house: 'ardent', tier: 1, seed: 4 });
    t1.over = 'won';
    expect(endRun(t1, m).tierUnlocked).toBe(2);
    m.tierUnlocked = 3;
    const t3 = newRun(m, { house: 'ardent', tier: 3, seed: 5 });
    t3.over = 'won';
    expect(endRun(t3, m).tierUnlocked).toBeNull();
    expect(m.tierUnlocked).toBe(3);
  });

  it('Fourth Banner: max Resolve 4, starting at 4; Camp Rest heals up to 4', () => {
    const meta = metaWith(['fourth_banner']);
    const { run } = freshRun({ meta });
    expect(run.resolve).toBe(4);
    expect(run.maxResolve).toBe(4);
    run.resolve = 3;
    forceNode(run, meta, 'camp');
    chooseCamp(run, meta, 'rest');
    expect(run.resolve).toBe(4);
  });

  it('endRun on a loss: Renown banked, best depth tracked, run save cleared, no tier', () => {
    const meta = metaWith();
    const { run } = freshRun({ meta });
    run.nodesDone = ['start'];
    run.currentNode = run.map.columns[2][0];
    run.stats.battlesWon = 1;
    run.stats.nodesVisited = 3;
    run.over = 'lost';
    const s = endRun(run, meta);
    expect(s).toMatchObject({ won: false, renownTotal: 25, depthReached: 3, tierUnlocked: null });
    expect(meta.stats.bestDepth).toBe(3);
    expect(meta.stats.totalRenown).toBe(25);
    expect(s.nextUnlock).toEqual({ id: 'codex_1', name: 'Codex I', cost: 30, remaining: 5 });
  });

  it('nextUnlock skips owned and gated entries and picks the cheapest', () => {
    const m = metaWith(['codex_1', 'codex_2', 'codex_3'], 45);
    expect(nextUnlock(m)).toEqual({ id: 'house_tallow', name: 'House Tallow', cost: 40, remaining: 0 });
    m.unlocks = [...META_UNLOCK_IDS];
    expect(nextUnlock(m)).toBeNull();
  });

  it('markHintSeen stores each hint once', () => {
    const m = defaultMeta();
    markHintSeen(m, 'gather');
    markHintSeen(m, 'gather');
    expect(m.hintsSeen).toEqual(['gather']);
    expect(loadMeta().hintsSeen).toEqual(['gather']);
  });

  it('newRun counts runs and the first 3 runs get explicit doctrine answers', () => {
    const meta = metaWith();
    for (let i = 0; i < 4; i++) {
      const run = newRun(meta, { house: 'ardent', tier: 0, seed: 10 + i });
      const { entry } = forceNode(run, meta, 'battle');
      if (entry.screen !== 'briefing') throw new Error('expected briefing');
      if (i < 3) expect(entry.briefing.doctrineAnswer).toBeTruthy();
      else expect(entry.briefing.doctrineAnswer).toBeNull();
    }
    expect(meta.stats.runs).toBe(4);
  });
});

describe('display helpers', () => {
  it('boonInfo and draftInfo read the data tables', () => {
    expect(boonInfo('ember_tithe')).toMatchObject({ name: 'Ember Tithe', rarity: 'Mythic', kind: 'Rule', rarityId: 'M', tagIds: ['Ember', 'Econ'] });
    expect(boonInfo('harvest_songs').tags).toEqual(['Economy']);
    expect(draftInfo('draft_siegecraft')).toMatchObject({ name: 'Siegecraft', units: ['Gatebreaker'], unitIds: ['gatebreaker'] });
  });
});
