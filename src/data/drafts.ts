/**
 * Unit drafts (GDD §L "Unit drafts"). Pick 1 of 3 eligible; an empty pool gives a Boon pick instead.
 */
import type { DraftId } from '../sim/types';
import type { DraftDef } from './types';

export const DRAFTS: Record<DraftId, DraftDef> = {
  draft_shieldwall: {
    id: 'draft_shieldwall',
    name: 'Shieldwall',
    units: ['oathshield'],
    buildings: [],
    requiresMeta: null,
    tags: ['Pike'],
    desc: 'Unlocks the Oathshield at the Muster Hall: heavy foot that shrugs off arrows.',
  },
  draft_firecraft: {
    id: 'draft_firecraft',
    name: 'Firecraft',
    units: ['brandbow'],
    buildings: [],
    requiresMeta: null,
    tags: ['Bow', 'Ember'],
    desc: 'Unlocks the Brandbow at the Bowyard: burning arrows that outrange Thornspires. Needs a Forgehall.',
  },
  draft_heavy_horse: {
    id: 'draft_heavy_horse',
    name: 'Heavy Horse',
    units: ['destrier'],
    buildings: [],
    requiresMeta: null,
    tags: ['Horse'],
    desc: 'Unlocks the Destrier at the Paddock: armored cavalry with a crushing Charge. Needs a Forgehall.',
  },
  draft_siegecraft: {
    id: 'draft_siegecraft',
    name: 'Siegecraft',
    units: ['gatebreaker'],
    buildings: ['siegeyard'],
    requiresMeta: null,
    tags: ['Siege'],
    desc: 'Unlocks the Siegeyard and the Gatebreaker: a ram that tears down Nests.',
  },
  draft_outriding: {
    id: 'draft_outriding',
    name: 'Outriding',
    units: ['outrider'],
    buildings: [],
    requiresMeta: 'outriding',
    tags: ['Horse', 'Bow'],
    desc: 'Unlocks the Outrider at the Paddock: a horse archer that steps back from melee.',
  },
  draft_lamplight: {
    id: 'draft_lamplight',
    name: 'Lamplight',
    units: ['lampbearer'],
    buildings: [],
    requiresMeta: 'lamplight',
    tags: ['Veteran'],
    desc: 'Unlocks the Lampbearer at the Hearth: heals nearby allies.',
  },
};
