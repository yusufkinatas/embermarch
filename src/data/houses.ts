/**
 * Houses (GDD §N). Warden ability on Q, passives as Effects. Ability numbers live in
 * balance.ts ABILITIES. Grimbrand's Retinue-rank passive is applied by the run module
 * (RETINUE.grimbrandMinRank).
 */
import type { HouseId } from '../sim/types';
import type { HouseDef } from './types';
import { ABILITIES } from './balance';

export const HOUSES: Record<HouseId, HouseDef> = {
  ardent: {
    id: 'ardent',
    name: 'House Ardent',
    motto: 'The flame goes first.',
    abilityName: 'Rallying Horn',
    abilityDesc: 'Allies within 6 tiles gain +25% attack speed and +15% move speed for 8 s.',
    abilityCooldown: ABILITIES.rallyingHorn.cooldown,
    abilityTargeted: false,
    passiveDesc: '+50 Timber at battle start.',
    effects: [{ kind: 'startRes', res: { timber: 50 } }],
    tags: ['Warden'],
    unlock: null,
    color: '#E8A33D',
  },
  tallow: {
    id: 'tallow',
    name: 'House Tallow',
    motto: 'Many hands, full granaries.',
    abilityName: 'Harvest Hymn',
    abilityDesc: 'Tillers within 8 tiles gather +60% for 15 s.',
    abilityCooldown: ABILITIES.harvestHymn.cooldown,
    abilityTargeted: false,
    passiveDesc: '+1 starting Tiller. Grainplots cost 35 Timber. Muster Hall, Bowyard and Paddock cost +20 Timber.',
    effects: [
      { kind: 'startUnits', unit: 'tiller', count: 1 },
      { kind: 'cost', sel: { buildings: ['grainplot'] }, res: 'timber', set: 35 },
      { kind: 'cost', sel: { buildings: ['muster_hall', 'bowyard', 'paddock'] }, res: 'timber', add: 20 },
    ],
    tags: ['Econ'],
    unlock: 'house_tallow',
    color: '#E8C547',
  },
  grimbrand: {
    id: 'grimbrand',
    name: 'House Grimbrand',
    motto: 'Iron and pitch.',
    abilityName: 'Firepot',
    abilityDesc: 'Hurl a firepot up to 7 tiles: 50 damage in radius 2 plus burn 3/s for 4 s.',
    abilityCooldown: ABILITIES.firepot.cooldown,
    abilityTargeted: true,
    passiveDesc: 'Muster Hall trains 25% faster. Retinue units start at Rank I or higher. Grain gathering −10%.',
    effects: [
      { kind: 'stat', sel: { units: ['ashpike', 'oathshield'] }, stat: 'trainTime', pct: -25 },
      { kind: 'gather', res: 'grain', pct: -10 },
    ],
    tags: ['Pike', 'Warden'],
    unlock: 'house_grimbrand',
    color: '#B5482E',
  },
  lowmere: {
    id: 'lowmere',
    name: 'House Lowmere',
    motto: 'Hold the wall, light the sky.',
    abilityName: 'Ember Volley',
    abilityDesc: 'The Hearth and Brazier Towers fire +2 bolts per volley for 10 s.',
    abilityCooldown: ABILITIES.emberVolley.cooldown,
    abilityTargeted: false,
    passiveDesc: 'Brazier Towers cost no Ember and get +1 range. Bowmen +10 HP.',
    effects: [
      { kind: 'cost', sel: { buildings: ['brazier_tower'] }, res: 'ember', set: 0 },
      { kind: 'stat', sel: { buildings: ['brazier_tower'] }, stat: 'range', add: 1 },
      { kind: 'stat', sel: { units: ['bowman'] }, stat: 'hp', add: 10 },
    ],
    tags: ['Fort', 'Bow'],
    unlock: 'house_lowmere',
    color: '#5FA8E8',
  },
};
