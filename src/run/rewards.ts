/**
 * Reward queue (GDD §M "Reward screen", §B "Retinue").
 *
 * Steps are queued with an OfferSpec and rolled lazily when they reach the head of the queue,
 * so an earlier pick (ownership, synergy, Veteran's Oath) shapes the next one. The head step is
 * always rolled before the run is saved, so `currentReward` is stable across reloads.
 */
import { REWARDS } from '../data';
import type { BoonId, CarriedUnit } from '../sim/types';
import { eligibleDrafts, pickBoon, rollBoonOffer, rollDraftOffer } from './offers';
import { saveRun } from './persistence';
import type { MetaSave, OfferSpec, RewardStep, RunState } from './types';
import { addCrowns, findPending, popOf, rankedUp, retinueCapFor, unitPop, withRng } from './util';

type BoonStep = Extract<RewardStep, { kind: 'boon' }>;
type DraftStep = Extract<RewardStep, { kind: 'draft' }>;
type RetinueStep = Extract<RewardStep, { kind: 'retinue' }>;

const RARITY_SUBTITLE: Record<NonNullable<OfferSpec['rarity']>, string | undefined> = {
  normal: undefined,
  elite: 'Rare or better',
  C: 'Common Boons',
  R: 'Rare Boons',
  M: 'Mythic Boons',
};

export function boonStep(title: string, spec: Omit<OfferSpec, 'rolled'>, subtitle?: string): BoonStep {
  return {
    kind: 'boon',
    title,
    options: [],
    skipCrowns: REWARDS.skipCrowns,
    subtitle: subtitle ?? RARITY_SUBTITLE[spec.rarity ?? 'normal'],
    spec: { ...spec, rolled: false },
  };
}

export function draftStep(title: string, spec: Omit<OfferSpec, 'rolled' | 'rarity' | 'featured'>, subtitle?: string): DraftStep {
  return {
    kind: 'draft',
    title,
    options: [],
    skipCrowns: REWARDS.skipCrowns,
    subtitle: subtitle ?? 'Pick a new unit type for the rest of the run',
    spec: { ...spec, rolled: false },
  };
}

export function retinueStep(candidates: CarriedUnit[], title = 'Choose your Retinue'): RetinueStep {
  return { kind: 'retinue', title, candidates, capPop: 0, rolled: false };
}

/** Number of options for a pick: 3, or 4 under Creeping Wake / the Wayshrine offering. */
function offerSize(run: RunState, spec: OfferSpec, base: number): number {
  if (spec.size !== undefined) return spec.size;
  if (spec.source !== 'reward' && spec.source !== 'camp') return base;
  if (spec.bonusOption) return REWARDS.offerSizeBonus;
  const plus = findPending(run, 'reward_plus_one');
  if (plus && plus.picks > 0) {
    plus.picks--;
    if (plus.picks <= 0) run.pending = run.pending.filter((p) => p !== plus);
    return REWARDS.offerSizeBonus;
  }
  return base;
}

/** Roll the head step if needed. Empty offers are resolved automatically. */
export function materializeHead(run: RunState, meta: MetaSave): void {
  for (let guard = 0; guard < 16; guard++) {
    const step = run.rewardQueue[0];
    if (!step) return;
    if (step.kind === 'retinue') {
      if (!step.rolled) {
        step.capPop = retinueCapFor(run, meta);
        step.rankUp = run.boons.includes('veterans_oath');
        step.subtitle = `Up to ${step.capPop} pop carry into the next battle${step.rankUp ? ' at +1 Rank' : ''}.`;
        step.rolled = true;
      }
      return;
    }
    const spec = step.spec;
    if (!spec || spec.rolled) return;

    if (step.kind === 'draft') {
      if (eligibleDrafts(run, meta).length === 0) {
        // Empty Draft pool: a Boon pick instead (§L "Unit drafts").
        run.rewardQueue[0] = boonStep(
          'Choose a Boon',
          { source: spec.source, bonusOption: spec.bonusOption, rarity: 'normal' },
          'No new units remain to draft',
        );
        continue;
      }
      const size = offerSize(run, spec, REWARDS.draftOfferSize);
      step.options = withRng(run, (rng) => rollDraftOffer(rng, run, meta, size));
      spec.rolled = true;
      return;
    }

    const size = offerSize(run, spec, REWARDS.offerSize);
    const ensureRule = spec.source === 'reward' && !run.firstOfferDone;
    const options = withRng(run, (rng) =>
      rollBoonOffer(rng, run, meta, { count: size, rarity: spec.rarity ?? 'normal', featured: spec.featured, ensureRule }),
    );
    if (options.length > 0) {
      step.options = options;
      spec.rolled = true;
      if (spec.source === 'reward') run.firstOfferDone = true;
      return;
    }
    // Every eligible Boon is owned: pay the skip value and move on.
    addCrowns(run, step.skipCrowns);
    run.rewardQueue.shift();
  }
}

export function currentReward(run: RunState): RewardStep | null {
  return run.rewardQueue[0] ?? null;
}

/** Push a step; if it lands at the head, roll it now. */
export function queueStep(run: RunState, meta: MetaSave, step: RewardStep): void {
  run.rewardQueue.push(step);
  materializeHead(run, meta);
}

/** Grant a random Common Boon (Cold Watch-Fire scavenge, Camp Muster with an empty pool). */
export function grantRandomBoon(run: RunState, meta: MetaSave, rarity: 'C' | 'R' | 'M'): BoonId | null {
  const id = withRng(run, (rng) => pickBoon(rng, run, meta, rarity));
  if (id) run.boons.push(id);
  return id;
}

export function chooseReward(run: RunState, meta: MetaSave, choice: number | 'skip', picks?: number[]): RewardStep | null {
  materializeHead(run, meta);
  const step = run.rewardQueue[0];
  if (!step) return null;
  if (step.kind === 'retinue') {
    const chosen: CarriedUnit[] = [];
    const used = new Set<number>();
    let pop = 0;
    for (const i of choice === 'skip' ? [] : (picks ?? [])) {
      if (!Number.isInteger(i) || i < 0 || i >= step.candidates.length || used.has(i)) continue;
      const u = step.candidates[i];
      const p = unitPop(u.type);
      if (pop + p > step.capPop) continue;
      used.add(i);
      pop += p;
      chosen.push(step.rankUp ? rankedUp(u, 1) : { ...u });
    }
    run.retinue = chosen;
  } else if (choice === 'skip') {
    addCrowns(run, step.skipCrowns);
  } else {
    if (!Number.isInteger(choice) || choice < 0 || choice >= step.options.length) {
      throw new Error(`Invalid reward choice ${choice} (${step.options.length} options)`);
    }
    if (step.kind === 'boon') {
      const id = step.options[choice];
      if (!run.boons.includes(id)) run.boons.push(id);
    } else {
      const id = step.options[choice];
      if (!run.drafts.includes(id)) run.drafts.push(id);
    }
  }
  run.rewardQueue.shift();
  materializeHead(run, meta);
  saveRun(run);
  return currentReward(run);
}

export function retinueCap(run: RunState, meta: MetaSave): number {
  return retinueCapFor(run, meta);
}

/** Helper for UIs: does a selection of candidate indexes fit the cap? */
export function retinuePicksFit(step: RetinueStep, picks: readonly number[]): boolean {
  const units = picks.map((i) => step.candidates[i]).filter((u): u is CarriedUnit => !!u);
  return new Set(picks).size === picks.length && units.length === picks.length && popOf(units) <= step.capPop;
}
