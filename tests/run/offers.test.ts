import { beforeEach, describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { BOONS, BOON_IDS, DRAFT_IDS } from '../../src/data';
import type { Rarity } from '../../src/data';
import { chooseReward, currentReward, finishBattle } from '../../src/run';
import { boonPool, eligibleDrafts, pickBoon, rollBoonOffer, rollRarity } from '../../src/run/offers';
import type { RewardStep } from '../../src/run/types';
import type { BoonId } from '../../src/sim/types';
import { forceNode, freshRun, metaWith, mkResult, units, useMemoryStorage } from './helpers';

const ALL_CODEX = metaWith(['codex_1', 'codex_2', 'codex_3']);
const rarityOf = (id: BoonId): Rarity => BOONS[id].rarity;
const byRarity = (r: Rarity) => BOON_IDS.filter((id) => rarityOf(id) === r);

function boonOptions(step: RewardStep | null): BoonId[] {
  if (!step || step.kind !== 'boon') throw new Error(`expected a boon step, got ${step?.kind}`);
  return step.options;
}

describe('Boon offers (§M)', () => {
  beforeEach(() => useMemoryStorage());

  it('rolls rarity 62/30/8 normally and 0/75/25 for Elites', () => {
    const rng = new Rng(7);
    const n = 20000;
    const count = (table: 'normal' | 'elite') => {
      const c: Record<Rarity, number> = { C: 0, R: 0, M: 0 };
      for (let i = 0; i < n; i++) c[rollRarity(rng, table)]++;
      return c;
    };
    const normal = count('normal');
    expect(normal.C / n).toBeCloseTo(0.62, 1);
    expect(normal.R / n).toBeCloseTo(0.3, 1);
    expect(normal.M / n).toBeCloseTo(0.08, 1);
    const elite = count('elite');
    expect(elite.C).toBe(0);
    expect(elite.R / n).toBeCloseTo(0.75, 1);
    expect(elite.M / n).toBeCloseTo(0.25, 1);
  });

  it('only offers Base and unlocked Codex Boons, never duplicates or owned Boons', () => {
    const { run } = freshRun();
    run.boons = ['harvest_songs', 'baggage_train', 'flame_hearth'];
    const rng = new Rng(3);
    const seen = new Set<BoonId>();
    for (let i = 0; i < 2000; i++) {
      const offer = rollBoonOffer(rng, run, metaWith(), { count: 4, rarity: 'normal' });
      expect(new Set(offer).size).toBe(offer.length);
      expect(offer).toHaveLength(4);
      for (const id of offer) {
        expect(run.boons).not.toContain(id);
        expect(BOONS[id].pool).toBe('base');
        seen.add(id);
      }
    }
    expect(seen.size).toBe(boonPool(metaWith()).length - 3);
    expect(boonPool(metaWith(['codex_1'])).filter((b) => BOONS[b].pool !== 'base').sort()).toEqual(['kiln_masons', 'raiders_bounty']);
    expect(boonPool(ALL_CODEX)).toHaveLength(25);
  });

  it('an exhausted rarity falls to the next lower one, then the next higher', () => {
    const { run } = freshRun();
    const rng = new Rng(11);
    run.boons = byRarity('R');
    for (let i = 0; i < 200; i++) expect(rarityOf(pickBoon(rng, run, ALL_CODEX, 'R')!)).toBe('C');
    run.boons = [...byRarity('R'), ...byRarity('C')];
    for (let i = 0; i < 50; i++) expect(rarityOf(pickBoon(rng, run, ALL_CODEX, 'R')!)).toBe('M');
    run.boons = byRarity('M');
    for (let i = 0; i < 200; i++) expect(rarityOf(pickBoon(rng, run, ALL_CODEX, 'M')!)).toBe('R');
    run.boons = [...byRarity('C')];
    for (let i = 0; i < 200; i++) expect(rarityOf(pickBoon(rng, run, ALL_CODEX, 'C')!)).toBe('R');
    run.boons = [...BOON_IDS];
    expect(pickBoon(rng, run, ALL_CODEX, 'C')).toBeNull();
  });

  it('weights synergy ×2 (owned Boons, House and drafted unit tags)', () => {
    const { run } = freshRun({ house: 'ardent' }); // Warden tag
    run.boons = ['pike_discipline']; // Pike tag
    run.drafts = ['draft_siegecraft']; // Siege tag
    const rng = new Rng(5);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 30000; i++) {
      const id = pickBoon(rng, run, metaWith(), 'C')!;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    // Commons in the base pool, minus owned pike_discipline: 8. Synergy: second_wind (Warden).
    const ratio = counts.second_wind / counts.laden_packs;
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.3);
    const rareCounts: Record<string, number> = {};
    for (let i = 0; i < 30000; i++) {
      const id = pickBoon(rng, run, metaWith(), 'R')!;
      rareCounts[id] = (rareCounts[id] ?? 0) + 1;
    }
    // plunderers carries Siege (drafted Siegecraft), ember_mail carries Pike (owned), field_surgeons neither.
    expect(rareCounts.plunderers / rareCounts.field_surgeons).toBeGreaterThan(1.7);
    expect(rareCounts.ember_mail / rareCounts.field_surgeons).toBeGreaterThan(1.7);
  });

  it('the first reward Boon offer of a run always holds a Rule Boon', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const { run, meta } = freshRun({ seed });
      forceNode(run, meta, 'battle', { battle: { reward: 'boon' } });
      finishBattle(run, meta, mkResult());
      const opts = boonOptions(currentReward(run));
      expect(opts).toHaveLength(3);
      expect(opts.some((id) => BOONS[id].kind === 'rule')).toBe(true);
      expect(run.firstOfferDone).toBe(true);
    }
  });

  it('the Opening Boon is a Common pick and does not use up the first-offer guarantee', () => {
    const meta = metaWith(['opening_boon']);
    for (let seed = 1; seed <= 40; seed++) {
      const { run } = freshRun({ meta, seed });
      const opts = boonOptions(currentReward(run));
      expect(opts).toHaveLength(3);
      for (const id of opts) expect(rarityOf(id)).toBe('C');
      expect(run.firstOfferDone).toBe(false);
    }
  });
});

describe('reward queue per node type (§M)', () => {
  beforeEach(() => useMemoryStorage());

  it('Boon node: 1 of 3, then Retinue; skip pays +15', () => {
    const { run, meta } = freshRun();
    forceNode(run, meta, 'battle', { battle: { reward: 'boon' } });
    finishBattle(run, meta, mkResult({ survivors: units('ashpike', 2) }));
    expect(run.rewardQueue.map((s) => s.kind)).toEqual(['boon', 'retinue']);
    const crowns = run.crowns;
    const next = chooseReward(run, meta, 'skip');
    expect(run.crowns).toBe(crowns + 15);
    expect(next?.kind).toBe('retinue');
  });

  it('Draft node: 1 of 3 drafts; an empty pool gives a Boon pick instead', () => {
    const { run, meta } = freshRun();
    forceNode(run, meta, 'battle', { battle: { reward: 'draft' } });
    finishBattle(run, meta, mkResult());
    const step = currentReward(run)!;
    expect(step.kind).toBe('draft');
    if (step.kind === 'draft') {
      expect(step.options).toHaveLength(3);
      for (const d of step.options) expect(['draft_outriding', 'draft_lamplight']).not.toContain(d);
    }
    chooseReward(run, meta, 0);
    expect(run.drafts).toHaveLength(1);

    const b = freshRun({ seed: 2 });
    b.run.drafts = ['draft_shieldwall', 'draft_firecraft', 'draft_heavy_horse', 'draft_siegecraft'];
    forceNode(b.run, b.meta, 'battle', { battle: { reward: 'draft' } });
    finishBattle(b.run, b.meta, mkResult());
    expect(boonOptions(currentReward(b.run))).toHaveLength(3);
  });

  it('Outriding and Lamplight drafts need their meta unlocks', () => {
    const { run } = freshRun();
    expect(eligibleDrafts(run, metaWith())).toHaveLength(4);
    expect(eligibleDrafts(run, metaWith(['outriding'])).sort()).toContain('draft_outriding');
    expect(eligibleDrafts(run, metaWith(['outriding', 'lamplight']))).toHaveLength(DRAFT_IDS.length);
  });

  it('Spoils node: Commons only (after the first offer)', () => {
    const { run, meta } = freshRun();
    run.firstOfferDone = true;
    forceNode(run, meta, 'battle', { battle: { reward: 'spoils' } });
    finishBattle(run, meta, mkResult());
    for (const id of boonOptions(currentReward(run))) expect(rarityOf(id)).toBe('C');
  });

  it('Elite: a Rare+ Boon pick, then a Draft pick', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { run, meta } = freshRun({ seed });
      run.firstOfferDone = true;
      forceNode(run, meta, 'elite', { battle: { depth: 4 } });
      finishBattle(run, meta, mkResult({ objective: 'elite' }));
      expect(run.rewardQueue.map((s) => s.kind)).toEqual(['boon', 'draft']);
      for (const id of boonOptions(currentReward(run))) expect(rarityOf(id)).not.toBe('C');
      expect(chooseReward(run, meta, 0)?.kind).toBe('draft');
    }
  });

  it('Ancient Cache looted: an extra Rare pick; Creeping Wake: offers show 4', () => {
    const { run, meta } = freshRun();
    run.firstOfferDone = true;
    forceNode(run, meta, 'battle', { battle: { reward: 'boon', modifiers: ['ancient_cache', 'creeping_wake'] } });
    finishBattle(run, meta, mkResult({ ancientCacheLooted: true }));
    expect(run.rewardQueue.map((s) => s.kind)).toEqual(['boon', 'boon']);
    expect(boonOptions(currentReward(run))).toHaveLength(4);
    const next = chooseReward(run, meta, 1);
    const rare = boonOptions(next);
    expect(rare).toHaveLength(4);
    for (const id of rare) expect(rarityOf(id)).toBe('R');
    expect(rare).not.toContain(run.boons[0]);

    const b = freshRun({ seed: 5 });
    forceNode(b.run, b.meta, 'battle', { battle: { reward: 'boon', modifiers: ['ancient_cache'] } });
    finishBattle(b.run, b.meta, mkResult({ ancientCacheLooted: false }));
    expect(b.run.rewardQueue).toHaveLength(1);
  });

  it('Wayshrine offering: the next 2 reward picks show 4 options', () => {
    const { run, meta } = freshRun();
    run.pending.push({ kind: 'reward_plus_one', picks: 2 });
    forceNode(run, meta, 'elite', { battle: { depth: 3 } });
    finishBattle(run, meta, mkResult({ objective: 'elite' }));
    expect(boonOptions(currentReward(run))).toHaveLength(4);
    const draft = chooseReward(run, meta, 0);
    expect(draft?.kind === 'draft' && draft.options.length).toBe(4);
    expect(run.pending.some((p) => p.kind === 'reward_plus_one')).toBe(false);
  });

  it('a Draft converted to a Boon pick (empty pool) spends only one Wayshrine charge', () => {
    const { run, meta } = freshRun();
    run.drafts = ['draft_shieldwall', 'draft_firecraft', 'draft_heavy_horse', 'draft_siegecraft'];
    run.pending.push({ kind: 'reward_plus_one', picks: 2 });
    forceNode(run, meta, 'battle', { battle: { reward: 'draft' } });
    finishBattle(run, meta, mkResult());
    expect(boonOptions(currentReward(run))).toHaveLength(4);
    expect(run.pending).toContainEqual({ kind: 'reward_plus_one', picks: 1 });
  });

  it('later offers see earlier picks (no duplicate Boons in a run)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { run, meta } = freshRun({ seed });
      run.firstOfferDone = true;
      forceNode(run, meta, 'battle', { battle: { reward: 'boon', modifiers: ['ancient_cache'] } });
      finishBattle(run, meta, mkResult({ ancientCacheLooted: true }));
      const first = boonOptions(currentReward(run));
      const pickIdx = first.findIndex((id) => rarityOf(id) === 'R');
      if (pickIdx < 0) continue;
      const picked = first[pickIdx];
      const second = boonOptions(chooseReward(run, meta, pickIdx));
      expect(second).not.toContain(picked);
    }
  });
});
