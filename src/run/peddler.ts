/**
 * Peddler (GDD §L "Peddler stock", §N Guild Ties).
 * 3 Boons (one per rarity: 55 / 100 / 175), 1 Draft (90), Restore 1 Resolve (90),
 * 2 Sellsword offers, Reroll Boons (15, +10 per repeat). Guild Ties: prices −15%, +1 Boon.
 */
import type { Rng } from '../core/rng';
import { BOONS, DRAFTS, PEDDLER, RARITY_NAMES, UNITS } from '../data';
import type { Rarity } from '../data';
import type { BoonId } from '../sim/types';
import { eligibleDrafts, pickBoon, synergyTags } from './offers';
import { saveRun } from './persistence';
import type { MetaSave, PeddlerItem, PeddlerStock, RunState } from './types';
import { currentNodeOf, makeUnits, withRng } from './util';

const RARITIES: Rarity[] = ['C', 'R', 'M'];

export function hasGuildTies(meta: MetaSave): boolean {
  return meta.unlocks.includes('guild_ties');
}

/** Price after Guild Ties (−15%, rounded). */
export function peddlerPrice(base: number, meta: MetaSave): number {
  return hasGuildTies(meta) ? Math.round(base * (1 - PEDDLER.guildTiesDiscount)) : base;
}

export function rerollPrice(rerolls: number, meta: MetaSave): number {
  return peddlerPrice(PEDDLER.rerollBase + PEDDLER.rerollStep * rerolls, meta);
}

function boonItem(id: BoonId, meta: MetaSave): PeddlerItem {
  const def = BOONS[id];
  return {
    kind: 'boon',
    boon: id,
    price: peddlerPrice(PEDDLER.boonPrices[def.rarity], meta),
    sold: false,
    label: def.name,
    desc: `${RARITY_NAMES[def.rarity]} ${def.kind === 'rule' ? 'Rule' : 'Stat'} Boon. ${def.desc}`,
  };
}

/**
 * Boon slots: one per rarity, plus one of a random rarity with Guild Ties. An exhausted rarity
 * falls back like reward offers (priced by the Boon's actual rarity).
 */
function rollBoonItems(rng: Rng, run: RunState, meta: MetaSave, slots: Rarity[], exclude: BoonId[]): PeddlerItem[] {
  const tags = synergyTags(run);
  const items: PeddlerItem[] = [];
  const taken = [...exclude];
  for (const r of slots) {
    const id = pickBoon(rng, run, meta, r, taken, tags);
    if (!id) continue;
    taken.push(id);
    items.push(boonItem(id, meta));
  }
  return items;
}

function boonSlots(rng: Rng, meta: MetaSave): Rarity[] {
  const slots = [...RARITIES];
  for (let i = 0; i < (hasGuildTies(meta) ? PEDDLER.guildTiesExtraBoons : 0); i++) slots.push(rng.pick(RARITIES));
  return slots;
}

export function generatePeddlerStock(run: RunState, meta: MetaSave): PeddlerStock {
  return withRng(run, (rng) => {
    const items: PeddlerItem[] = rollBoonItems(rng, run, meta, boonSlots(rng, meta), []);
    const drafts = eligibleDrafts(run, meta);
    if (drafts.length) {
      const d = DRAFTS[rng.pick(drafts)];
      items.push({ kind: 'draft', draft: d.id, price: peddlerPrice(PEDDLER.draftPrice, meta), sold: false, label: `Draft: ${d.name}`, desc: d.desc });
    }
    items.push({
      kind: 'resolve',
      price: peddlerPrice(PEDDLER.resolvePrice, meta),
      sold: false,
      label: 'Restore 1 Resolve',
      desc: 'A night under a roof and a warm meal. +1 Resolve (up to your maximum).',
    });
    const offers = rng.shuffle([...PEDDLER.sellswordOffers]).slice(0, PEDDLER.sellswordSlots);
    for (const o of offers) {
      const name = UNITS[o.unit].name;
      items.push({
        kind: 'sellswords',
        units: makeUnits(o.unit, o.count, o.rank),
        price: peddlerPrice(o.price, meta),
        sold: false,
        label: `${o.count} Rank ${['0', 'I', 'II', 'III'][o.rank]} ${o.count > 1 ? pluralName(name) : name}`,
        desc: `Sellswords: they fight in your next battle on top of the Retinue cap, then may join your Retinue.`,
      });
    }
    return { items, rerollCost: rerollPrice(0, meta), rerolls: 0 };
  });
}

function requirePeddler(run: RunState): PeddlerStock {
  const node = currentNodeOf(run);
  if (!node || node.type !== 'peddler' || !run.peddler) throw new Error('No Peddler here');
  return run.peddler;
}

export function buyPeddlerItem(run: RunState, _meta: MetaSave, index: number): { ok: boolean; reason?: string } {
  const stock = requirePeddler(run);
  const item = stock.items[index];
  if (!item) return { ok: false, reason: 'No such item' };
  if (item.sold) return { ok: false, reason: 'Sold out' };
  if (run.crowns < item.price) return { ok: false, reason: `Requires ${item.price} Crowns` };
  switch (item.kind) {
    case 'boon':
      if (!item.boon || run.boons.includes(item.boon)) return { ok: false, reason: 'Already owned' };
      run.boons.push(item.boon);
      break;
    case 'draft':
      if (!item.draft || run.drafts.includes(item.draft)) return { ok: false, reason: 'Already drafted' };
      run.drafts.push(item.draft);
      break;
    case 'resolve':
      if (run.resolve >= run.maxResolve) return { ok: false, reason: 'Your Resolve is already full' };
      run.resolve += 1;
      break;
    case 'sellswords':
      run.sellswords.push(...(item.units ?? []).map((u) => ({ ...u })));
      break;
    default:
      return { ok: false, reason: 'Not for sale' };
  }
  run.crowns -= item.price;
  item.sold = true;
  saveRun(run);
  return { ok: true };
}

/** Reroll the unsold Boons (cost 15, +10 per repeat; Guild Ties −15%). */
export function rerollPeddler(run: RunState, meta: MetaSave): { ok: boolean; reason?: string } {
  const stock = requirePeddler(run);
  const slots = stock.items.map((it, i) => ({ it, i })).filter(({ it }) => it.kind === 'boon' && !it.sold);
  if (slots.length === 0) return { ok: false, reason: 'No Boons left to reroll' };
  const cost = stock.rerollCost;
  if (run.crowns < cost) return { ok: false, reason: `Requires ${cost} Crowns` };
  const shown = stock.items.filter((it) => it.kind === 'boon' && it.boon).map((it) => it.boon as BoonId);
  withRng(run, (rng) => {
    const tags = synergyTags(run);
    const fresh: BoonId[] = [];
    for (const { it, i } of slots) {
      const rarity = BOONS[it.boon as BoonId].rarity;
      // Prefer Boons not on display; fall back to any eligible one not already rerolled in.
      const id = pickBoon(rng, run, meta, rarity, [...shown, ...fresh], tags) ?? pickBoon(rng, run, meta, rarity, fresh, tags);
      if (!id) continue;
      fresh.push(id);
      stock.items[i] = boonItem(id, meta);
    }
  });
  run.crowns -= cost;
  stock.rerolls = (stock.rerolls ?? 0) + 1;
  stock.rerollCost = rerollPrice(stock.rerolls, meta);
  saveRun(run);
  return { ok: true };
}

/** "Bowman" → "Bowmen", "Ashpike" → "Ashpikes". */
function pluralName(name: string): string {
  if (/man$/.test(name)) return `${name.slice(0, -3)}men`;
  if (/s$/.test(name)) return name;
  return `${name}s`;
}
