/**
 * Boon and Draft offers (GDD §M "Boon offer rules", §L "Unit drafts").
 *
 * - Rarity per card: normal C 62 / R 30 / M 8, Elite 0 / 75 / 25 (or a fixed rarity).
 * - Within a rarity, weight ×2 when the Boon shares a tag with an owned Boon, the House or a drafted unit.
 * - Only Base Boons and Codex Boons whose Codex entry is unlocked are eligible.
 * - No duplicates within an offer or a run. An exhausted rarity falls to the next lower one, then higher.
 * - First reward offer of a run: if it has no Rule Boon, its last card becomes a random eligible Rule Boon.
 */
import type { Rng } from '../core/rng';
import { BOONS, BOON_IDS, DRAFTS, DRAFT_IDS, HOUSES, REWARDS } from '../data';
import type { BoonTag, Rarity } from '../data';
import type { BoonId, DraftId, MetaUnlockId } from '../sim/types';
import type { MetaSave, RunState } from './types';

export type RarityTable = 'normal' | 'elite' | Rarity;

/** Next rarity to try when one is exhausted: the next lower one, then the next higher. */
export const RARITY_FALLBACK: Record<Rarity, Rarity[]> = {
  C: ['C', 'R', 'M'],
  R: ['R', 'C', 'M'],
  M: ['M', 'R', 'C'],
};

/** Boons the profile can ever be offered: Base + unlocked Codex pools. */
export function boonPool(meta: Pick<MetaSave, 'unlocks'>): BoonId[] {
  return BOON_IDS.filter((id) => {
    const pool = BOONS[id].pool;
    return pool === 'base' || meta.unlocks.includes(pool as MetaUnlockId);
  });
}

/** Pool minus owned Boons minus `exclude`. */
export function eligibleBoons(run: RunState, meta: Pick<MetaSave, 'unlocks'>, exclude: readonly BoonId[] = []): BoonId[] {
  return boonPool(meta).filter((id) => !run.boons.includes(id) && !exclude.includes(id));
}

/** Tags that make a Boon "synergistic": owned Boons, the House and drafted units. */
export function synergyTags(run: RunState): Set<BoonTag> {
  const tags = new Set<BoonTag>();
  for (const b of run.boons) for (const t of BOONS[b].tags) tags.add(t);
  for (const t of HOUSES[run.house].tags) tags.add(t);
  for (const d of run.drafts) for (const t of DRAFTS[d].tags) tags.add(t);
  return tags;
}

export function boonWeight(id: BoonId, tags: ReadonlySet<BoonTag>): number {
  return BOONS[id].tags.some((t) => tags.has(t)) ? REWARDS.synergyMult : 1;
}

function rarityWeights(table: RarityTable): Record<Rarity, number> {
  if (table === 'normal') return REWARDS.rarityNormal;
  if (table === 'elite') return REWARDS.rarityElite;
  return { C: table === 'C' ? 1 : 0, R: table === 'R' ? 1 : 0, M: table === 'M' ? 1 : 0 };
}

export function rollRarity(rng: Rng, table: RarityTable): Rarity {
  const w = rarityWeights(table);
  const keys = (['C', 'R', 'M'] as Rarity[]).filter((r) => w[r] > 0);
  return rng.weighted(keys, (r) => w[r]);
}

/** One synergy-weighted Boon of `rarity` (falling back per RARITY_FALLBACK), or null if none remain. */
export function pickBoon(
  rng: Rng,
  run: RunState,
  meta: Pick<MetaSave, 'unlocks'>,
  rarity: Rarity,
  exclude: readonly BoonId[] = [],
  tags: ReadonlySet<BoonTag> = synergyTags(run),
): BoonId | null {
  const eligible = eligibleBoons(run, meta, exclude);
  for (const r of RARITY_FALLBACK[rarity]) {
    const pool = eligible.filter((id) => BOONS[id].rarity === r);
    if (pool.length) return rng.weighted(pool, (id) => boonWeight(id, tags));
  }
  return null;
}

export interface BoonOfferOptions {
  count: number;
  rarity: RarityTable;
  /** Included first when eligible (e.g. Ember-Tempered Mail at the Thorn-Touched Smith). */
  featured?: BoonId;
  /** First reward offer: guarantee a Rule Boon (replaces the last card). */
  ensureRule?: boolean;
}

/** Roll a Boon offer (no duplicates, synergy-weighted). May hold fewer cards if the pool runs dry. */
export function rollBoonOffer(rng: Rng, run: RunState, meta: Pick<MetaSave, 'unlocks'>, opts: BoonOfferOptions): BoonId[] {
  const tags = synergyTags(run);
  const offer: BoonId[] = [];
  if (opts.featured && eligibleBoons(run, meta).includes(opts.featured) && offer.length < opts.count) {
    offer.push(opts.featured);
  }
  while (offer.length < opts.count) {
    const b = pickBoon(rng, run, meta, rollRarity(rng, opts.rarity), offer, tags);
    if (!b) break;
    offer.push(b);
  }
  if (opts.ensureRule && offer.length > 0 && !offer.some((id) => BOONS[id].kind === 'rule')) {
    const rules = eligibleBoons(run, meta, offer).filter((id) => BOONS[id].kind === 'rule');
    if (rules.length) offer[offer.length - 1] = rng.pick(rules);
  }
  return offer;
}

/** Drafts the run can still take (meta-gated Outriding / Lamplight). */
export function eligibleDrafts(run: RunState, meta: Pick<MetaSave, 'unlocks'>): DraftId[] {
  return DRAFT_IDS.filter((id) => {
    const d = DRAFTS[id];
    return !run.drafts.includes(id) && (d.requiresMeta === null || meta.unlocks.includes(d.requiresMeta));
  });
}

/** Pick up to `count` distinct eligible drafts. */
export function rollDraftOffer(rng: Rng, run: RunState, meta: Pick<MetaSave, 'unlocks'>, count: number): DraftId[] {
  return rng.shuffle(eligibleDrafts(run, meta)).slice(0, count);
}
