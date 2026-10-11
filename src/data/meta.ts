/**
 * Meta-progression (GDD §N): Renown unlocks and Thornbound tiers.
 * Renown formula constants live in balance.ts (RENOWN, renownTotal).
 */
import type { MetaUnlockId } from '../sim/types';
import type { MetaUnlockDef } from './types';
import { RETINUE, THORNBOUND_EFFECTS } from './balance';

export const META_UNLOCKS: Record<MetaUnlockId, MetaUnlockDef> = {
  codex_1: {
    id: 'codex_1',
    name: 'Codex I',
    cost: 30,
    desc: "Adds Kiln Masons and Raider's Bounty to the Boon pool.",
    requires: null,
    scope: 'MUST',
  },
  codex_2: {
    id: 'codex_2',
    name: 'Codex II',
    cost: 30,
    desc: 'Adds Thornreaper Levy and Spoils of the Wake to the Boon pool.',
    requires: 'codex_1',
    scope: 'MUST',
  },
  codex_3: {
    id: 'codex_3',
    name: 'Codex III',
    cost: 30,
    desc: "Adds Kindled Earth and Warlord's Gambit to the Boon pool.",
    requires: 'codex_2',
    scope: 'MUST',
  },
  house_tallow: {
    id: 'house_tallow',
    name: 'House Tallow',
    cost: 40,
    desc: 'House Tallow becomes a starting option: Harvest Hymn and a stronger economy.',
    requires: null,
    scope: 'MUST',
  },
  outriding: {
    id: 'outriding',
    name: 'Outriding',
    cost: 50,
    desc: 'Adds the Outrider (horse archer) to the Draft pool.',
    requires: null,
    scope: 'SHOULD',
  },
  lamplight: {
    id: 'lamplight',
    name: 'Lamplight',
    cost: 50,
    desc: 'Adds the Lampbearer (healer) to the Draft pool.',
    requires: null,
    scope: 'SHOULD',
  },
  hawk_eyes: {
    id: 'hawk_eyes',
    name: 'Hawk Eyes',
    cost: 60,
    desc: 'The Warden gains Hawk (W): reveal radius 7 anywhere for 6 s, cooldown 50 s. Counts as eyes on a muster point.',
    requires: null,
    effects: [{ kind: 'flag', flag: 'hawk' }],
    scope: 'MUST',
  },
  guild_ties: {
    id: 'guild_ties',
    name: 'Guild Ties',
    cost: 70,
    desc: 'Peddler prices −15% and +1 Boon in stock.',
    requires: null,
    scope: 'MUST',
  },
  house_grimbrand: {
    id: 'house_grimbrand',
    name: 'House Grimbrand',
    cost: 70,
    desc: 'House Grimbrand becomes a starting option: Firepot and veteran retinues.',
    requires: null,
    scope: 'SHOULD',
  },
  seasoned_retinue: {
    id: 'seasoned_retinue',
    name: 'Seasoned Retinue',
    cost: 80,
    desc: `Retinue cap +${RETINUE.seasonedRetinueBonus} pop.`,
    requires: null,
    scope: 'MUST',
  },
  opening_boon: {
    id: 'opening_boon',
    name: 'Opening Boon',
    cost: 90,
    desc: 'Pick 1 of 3 Common Boons at the start of each run.',
    requires: null,
    scope: 'MUST',
  },
  house_lowmere: {
    id: 'house_lowmere',
    name: 'House Lowmere',
    cost: 100,
    desc: 'House Lowmere becomes a starting option: Ember Volley and cheap towers.',
    requires: null,
    scope: 'SHOULD',
  },
  hearth_lore: {
    id: 'hearth_lore',
    name: 'Hearth Lore',
    cost: 110,
    desc: '+1 starting Tiller in every battle.',
    requires: null,
    effects: [{ kind: 'startUnits', unit: 'tiller', count: 1 }],
    scope: 'MUST',
  },
  fourth_banner: {
    id: 'fourth_banner',
    name: 'Fourth Banner',
    cost: 140,
    desc: 'Max Resolve 4, and runs start at 4.',
    requires: null,
    scope: 'MUST',
  },
};

/** Display order in the Hall of Banners (GDD table order). */
export const META_UNLOCK_ORDER: MetaUnlockId[] = [
  'codex_1',
  'codex_2',
  'codex_3',
  'house_tallow',
  'outriding',
  'lamplight',
  'hawk_eyes',
  'guild_ties',
  'house_grimbrand',
  'seasoned_retinue',
  'opening_boon',
  'house_lowmere',
  'hearth_lore',
  'fourth_banner',
];

/** Fallback unlocks if the SHOULD features are cut (§N). */
export const META_FALLBACKS: Partial<Record<MetaUnlockId, { name: string; desc: string }>> = {
  outriding: { name: 'War Chest', desc: '+40 starting Crowns.' },
  lamplight: { name: 'Stout Heart', desc: 'Hearth +20% HP.' },
};

export interface ThornboundTierDef {
  tier: number;
  name: string;
  /** Added difficulty at this tier (tiers stack). */
  desc: string;
  /** Wave multiplier contribution (1 = none). */
  waveMult: number;
  /** Nest and Root Heart HP multiplier contribution (1 = none). */
  nestHpMult: number;
  /** T1 delta in seconds (0 = none). */
  t1Delta: number;
  /** Nest garrison value added (0 = none). */
  garrisonAdd: number;
}

/** Thornbound tiers (§N). Win at tier k to unlock k + 1. Each tier stacks and adds +15% Renown. */
export const THORNBOUND: ThornboundTierDef[] = [
  { tier: 0, name: 'Unbound', desc: 'The standard march.', waveMult: 1, nestHpMult: 1, t1Delta: 0, garrisonAdd: 0 },
  {
    tier: 1,
    name: 'Thornbound I',
    desc: 'Waves +10%.',
    waveMult: THORNBOUND_EFFECTS.waveMult,
    nestHpMult: 1,
    t1Delta: 0,
    garrisonAdd: 0,
  },
  {
    tier: 2,
    name: 'Thornbound II',
    desc: 'Nests and Root Hearts +25% HP.',
    waveMult: 1,
    nestHpMult: THORNBOUND_EFFECTS.nestHpMult,
    t1Delta: 0,
    garrisonAdd: 0,
  },
  {
    tier: 3,
    name: 'Thornbound III',
    desc: 'First wave 15 s sooner. Nest garrisons +2 value.',
    waveMult: 1,
    nestHpMult: 1,
    t1Delta: THORNBOUND_EFFECTS.t1Delta,
    garrisonAdd: THORNBOUND_EFFECTS.garrisonAdd,
  },
];

/** Cumulative Thornbound effects for a tier (0-3): all rows up to and including `tier`. */
export function thornboundFor(tier: number): { waveMult: number; nestHpMult: number; t1Delta: number; garrisonAdd: number } {
  let waveMult = 1;
  let nestHpMult = 1;
  let t1Delta = 0;
  let garrisonAdd = 0;
  for (const row of THORNBOUND) {
    if (row.tier > tier) break;
    waveMult *= row.waveMult;
    nestHpMult *= row.nestHpMult;
    t1Delta += row.t1Delta;
    garrisonAdd += row.garrisonAdd;
  }
  return { waveMult, nestHpMult, t1Delta, garrisonAdd };
}
