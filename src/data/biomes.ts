/**
 * Biomes (GDD §K table, palettes from §A). Column probabilities: balance.ts BIOME_WEIGHTS.
 * Biome-specific fairness-kit tweaks: balance.ts FAIRNESS_KIT / START.ashwoodBonusGrain.
 */
import type { BiomeId } from '../sim/types';
import type { BiomeDef } from './types';
import { RESOURCE_AMOUNTS } from './balance';

export const BIOMES: Record<BiomeId, BiomeDef> = {
  greenmarch: {
    id: 'greenmarch',
    name: 'Greenmarch',
    water: 0.1,
    forest: 0.24,
    rock: 0.02,
    treeAmount: RESOURCE_AMOUNTS.tree,
    twist: 'Open fields. +2 outer Thickets.',
    palette: {
      grassA: '#5E8C3A',
      grassB: '#6A9A44',
      forest: '#2F5A2A',
      forestHi: '#437A36',
      water: '#2F6E8E',
      shallows: '#4F93A8',
      rock: '#77716A',
      /** Tree trunk. */
      extra: '#4A3423',
    },
  },
  fenreach: {
    id: 'fenreach',
    name: 'Fenreach',
    water: 0.22,
    forest: 0.16,
    rock: 0,
    treeAmount: RESOURCE_AMOUNTS.tree,
    twist: 'Lakes rimmed with Shallows (×0.6 speed) and carved fords.',
    palette: {
      grassA: '#4E7552',
      grassB: '#587F5B',
      forest: '#2B4D3D',
      forestHi: '#3B6650',
      water: '#2A5A66',
      shallows: '#3E7C80',
      rock: '#6A6F66',
      /** Reeds. */
      extra: '#8A9A4E',
    },
  },
  ashwood: {
    id: 'ashwood',
    name: 'Ashwood',
    water: 0.04,
    forest: 0.36,
    rock: 0.05,
    treeAmount: RESOURCE_AMOUNTS.treeAshwood,
    twist: 'Trees hold 90 Timber. 4 near Thickets instead of 6. +100 starting Grain.',
    palette: {
      grassA: '#6D6955',
      grassB: '#77735E',
      forest: '#3A3A2E',
      forestHi: '#504E3E',
      water: '#3A5560',
      shallows: '#50707A',
      rock: '#5A5550',
      /** Ember glints. */
      extra: '#FF7A2F',
    },
  },
  heartwood: {
    id: 'heartwood',
    name: 'Heartwood',
    water: 0.06,
    forest: 0.3,
    rock: 0.03,
    treeAmount: RESOURCE_AMOUNTS.tree,
    twist: 'Briar walls funnel three lanes to the Briar Throne.',
    palette: {
      grassA: '#4A3F4E',
      grassB: '#544858',
      forest: '#2A2234',
      forestHi: '#3E3249',
      water: '#2E3F5A',
      shallows: '#45597A',
      rock: '#4F4855',
      /** Briar wall (thorn ticks #8FD14F). */
      extra: '#5B2E4A',
    },
  },
};

/** Heartwood briar-wall thorn tick color (§A). */
export const BRIAR_THORN_COLOR = '#8FD14F';
