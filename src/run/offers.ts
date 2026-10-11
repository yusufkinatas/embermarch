/**
 * Boon and Draft offers (GDD §M "Boon offer rules", §L "Unit drafts").
 *
 * - Rarity per card: normal C 62 / R 30 / M 8, Elite 0 / 75 / 25 (or a fixed rarity).
 * - Within a rarity, weight ×2 when the Boon shares a tag with an owned Boon, a drafted unit or the
 *   House. A House tag counts only while 3+ eligible Boons carry it, so a House with one or two
 *   matching Boons (Ardent: Second Wind) does not see them in most offers.
 * - Only Base Boons and Codex Boons whose Codex entry is unlocked are eligible.
 * - No duplicates within an offer or a run. An exhausted rarity falls to the next lower one, then higher.
 * - First reward offer of a run: its last card is always a random eligible Common or Rare Rule
 *   Boon (a Mythic Rule only when no other Rule is left); the other cards roll as usual.
 */
import type { Rng } from '../core/rng';
import { BOONS, BOON_IDS, DRAFTS, DRAFT_IDS, HOUSES, REWARDS } from '../data';
import type { BoonTag, Rarity } from '../data';
import type { BoonId, DraftId, MetaUnlockId } from '../sim/types';
import type { MetaSave, RunState } from './types';

export type RarityTable = 'normal' | 'elite' | Rarity;

/** A House tag adds synergy weight only while at least this many eligible Boons carry it. */
export const HOUSE_SYNERGY_MIN_BOONS = 3;

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

/**
 * Tags that make a Boon "synergistic": owned Boons, drafted units, and House tags shared by at
 * least HOUSE_SYNERGY_MIN_BOONS eligible Boons.
 */
export function synergyTags(run: RunState, meta: Pick<MetaSave, 'unlocks'>): Set<BoonTag> {
  const tags = new Set<BoonTag>();
  for (const b of run.boons) for (const t of BOONS[b].tags) tags.add(t);
  for (const d of run.drafts) for (const t of DRAFTS[d].tags) tags.add(t);
  const eligible = eligibleBoons(run, meta);
  for (const t of HOUSES[run.house].tags) {
    if (eligible.filter((id) => BOONS[id].tags.includes(t)).length >= HOUSE_SYNERGY_MIN_BOONS) tags.add(t);
  }
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
  tags: ReadonlySet<BoonTag> = synergyTags(run, meta),
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
  /** First reward offer: the last card is a Common or Rare Rule Boon. */
  ensureRule?: boolean;
}

/** Roll a Boon offer (no duplicates, synergy-weighted). May hold fewer cards if the pool runs dry. */
export function rollBoonOffer(rng: Rng, run: RunState, meta: Pick<MetaSave, 'unlocks'>, opts: BoonOfferOptions): BoonId[] {
  const tags = synergyTags(run, meta);
  const offer: BoonId[] = [];
  if (opts.featured && eligibleBoons(run, meta).includes(opts.featured) && offer.length < opts.count) {
    offer.push(opts.featured);
  }
  // First reward offer: the last card is reserved for a Common or Rare Rule (a Mythic Rule only
  // when no other is left). The guarantee teaches a Rule; it should not hand out a Mythic.
  const reserve = opts.ensureRule && opts.count > 0 ? 1 : 0;
  while (offer.length < opts.count - reserve) {
    const b = pickBoon(rng, run, meta, rollRarity(rng, opts.rarity), offer, tags);
    if (!b) break;
    offer.push(b);
  }
  if (reserve) {
    const rules = eligibleBoons(run, meta, offer).filter((id) => BOONS[id].kind === 'rule');
    const modest = rules.filter((id) => BOONS[id].rarity !== 'M');
    const pool = modest.length ? modest : rules;
    const last = pool.length ? rng.pick(pool) : pickBoon(rng, run, meta, rollRarity(rng, opts.rarity), offer, tags);
    if (last) offer.push(last);
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
