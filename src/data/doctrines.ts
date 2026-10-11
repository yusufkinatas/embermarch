/**
 * Thornwake doctrines (GDD §I "Doctrines"). Weights drive wave composition; types below their
 * unlock depth (balance ENEMY_UNLOCK_DEPTH) drop out. Gloamwitch is SHOULD: if cut, its weight
 * goes to the Spinecaster.
 */
import type { DoctrineId } from '../sim/types';
import type { DoctrineDef } from './types';

export const DOCTRINES: Record<DoctrineId, DoctrineDef> = {
  swarm: {
    id: 'swarm',
    name: 'Swarm',
    fromDepth: 1,
    weights: { thornling: 60, briarguard: 20, spinecaster: 20, stagrider: 12, rootbreaker: 10, thornhusk: 10 },
    target: 'hearth',
    hint: 'The thorns are thick and restless.',
    answer: 'Swarm: hold a spear line with Bowmen behind it, and raise towers.',
    icon: 'swarm',
  },
  spines: {
    id: 'spines',
    name: 'Spines',
    fromDepth: 1,
    weights: { spinecaster: 50, briarguard: 25, thornling: 25, gloamwitch: 10, thornhusk: 10 },
    target: 'nearest_military',
    hint: 'Quills litter the road.',
    answer: 'Quills: bring Coursers and Oathshields. Against Thornhusks, bring heavy horse or Ember Edge.',
    icon: 'quill',
  },
  hunt: {
    id: 'hunt',
    name: 'Hunt',
    fromDepth: 2,
    weights: { stagrider: 45, thornling: 35, spinecaster: 20, briarguard: 15 },
    target: 'storehouse_tillers',
    hint: 'Hoofprints in the mud.',
    answer: 'Hoofprints: bring Ashpikes, and guard your Tillers with towers.',
    icon: 'antler',
  },
  siegebreak: {
    id: 'siegebreak',
    name: 'Siegebreak',
    fromDepth: 3,
    weights: { briarguard: 40, spinecaster: 40, rootbreaker: 20, thornhusk: 15, stagrider: 12 },
    target: 'nearest_tower',
    hint: 'Uprooted oaks drag toward your camp.',
    answer: 'Uprooted oaks: bring Coursers, and put melee on the Rootbreakers.',
    icon: 'ram',
  },
  court: {
    id: 'court',
    name: 'Court',
    fromDepth: 4,
    weights: { briarguard: 25, spinecaster: 25, stagrider: 20, gloamwitch: 15, thornhusk: 15, rootbreaker: 10 },
    target: 'hearth',
    hint: 'A crown glints in the briars.',
    answer: 'A crown: field a mixed army and focus the Gloamwitches. Heavy horse or Ember Edge for the Thornhusks.',
    icon: 'crown',
  },
};
