/**
 * Resource nodes (GDD §D). Trees are forest tiles, not entities; their def is here for rates/amounts.
 * Grainplots are buildings (see BUILDINGS.grainplot.gather).
 */
import type { ResourceNodeId } from '../sim/types';
import type { ResourceNodeDef } from './types';
import { GATHER, RESOURCE_AMOUNTS } from './balance';

export const RESOURCE_NODES: Record<ResourceNodeId | 'tree', ResourceNodeDef> = {
  thicket: {
    id: 'thicket',
    name: 'Thicket',
    res: 'grain',
    amount: RESOURCE_AMOUNTS.thicket,
    rate: GATHER.rates.thicket,
    maxGatherers: GATHER.maxGatherers.thicket,
    w: 1,
    h: 1,
  },
  tree: {
    id: 'tree',
    name: 'Tree',
    res: 'timber',
    /** Ashwood: RESOURCE_AMOUNTS.treeAshwood (90). */
    amount: RESOURCE_AMOUNTS.tree,
    rate: GATHER.rates.tree,
    maxGatherers: GATHER.maxGatherers.tree,
    w: 1,
    h: 1,
  },
  ember_seam: {
    id: 'ember_seam',
    name: 'Ember Seam',
    res: 'ember',
    /** Home Seam amount. Contested: RESOURCE_AMOUNTS.contestedSeam (1000, 1500 under Ember Famine). */
    amount: RESOURCE_AMOUNTS.homeSeam,
    rate: GATHER.rates.ember_seam,
    maxGatherers: GATHER.maxGatherers.ember_seam,
    w: 2,
    h: 2,
  },
};

/** Home / contested Seam amounts (re-exported for mapgen convenience). */
export const SEAM_AMOUNTS = {
  home: RESOURCE_AMOUNTS.homeSeam,
  contested: RESOURCE_AMOUNTS.contestedSeam,
  contestedFamine: RESOURCE_AMOUNTS.contestedSeamFamine,
};
