/**
 * Encounter modifiers (GDD §K). Module ownership of each rule: see ARCHITECTURE.md "Modifier ownership".
 * Only effects expressible as stat/flag Effects are encoded here; the rest is read by id.
 */
import type { ModifierId } from '../sim/types';
import type { ModifierDef } from './types';
import { CROWNS, MODIFIER_NUMBERS } from './balance';

export const MODIFIERS: Record<ModifierId, ModifierDef> = {
  blood_moon: {
    id: 'blood_moon',
    name: 'Blood Moon',
    kind: 'negative',
    desc: 'Wave and raid value ×1.3.',
    payoffDesc: 'Battle Crowns ×1.5.',
    crownsMult: CROWNS.bloodMoonMult,
  },
  thick_fog: {
    id: 'thick_fog',
    name: 'Thick Fog',
    kind: 'negative',
    desc: 'Your sight −2 (min 3). Enemies acquire at 4 tiles. The Horn sounds only 10 s before launch and never shows its makeup.',
    payoffDesc: '+20 Crowns.',
    crownsBonus: 20,
    playerEffects: [{ kind: 'stat', sel: { allUnits: true }, stat: 'sight', add: MODIFIER_NUMBERS.thickFogSight }],
  },
  bountiful_wilds: {
    id: 'bountiful_wilds',
    name: 'Bountiful Wilds',
    kind: 'mixed',
    desc: '+6 Thickets in a second cluster near the Hearth. The first wave comes 20 s sooner.',
    payoffDesc: 'Built in.',
  },
  creeping_wake: {
    id: 'creeping_wake',
    name: 'Creeping Wake',
    kind: 'negative',
    desc: 'Blight grows every 12 s and spreads 3 tiles farther.',
    payoffDesc: 'Reward offers show 4 choices.',
  },
  ember_famine: {
    id: 'ember_famine',
    name: 'Ember Famine',
    kind: 'negative',
    desc: 'No home Ember Seam. Contested Seams hold 1500.',
    payoffDesc: '+25 Crowns.',
    crownsBonus: 25,
  },
  fortified_nests: {
    id: 'fortified_nests',
    name: 'Fortified Nests',
    kind: 'negative',
    desc: 'Nests +50% HP and +1 Thornspire each.',
    payoffDesc: 'Nest plunder ×2.',
  },
  swift_hunt: {
    id: 'swift_hunt',
    name: 'Swift Hunt',
    kind: 'negative',
    desc: 'The primary doctrine is Hunt. Enemy cavalry +20% speed.',
    payoffDesc: '+20 Crowns.',
    crownsBonus: 20,
    enemyEffects: [
      { kind: 'stat', sel: { classes: ['cavalry'] }, stat: 'speed', pct: MODIFIER_NUMBERS.swiftHuntCavalrySpeedPct },
    ],
  },
  downpour: {
    id: 'downpour',
    name: 'Downpour',
    kind: 'neutral',
    desc: 'All ranged attacks (units, Hearth, towers, Thornspires) −1 range. Burn is disabled.',
    payoffDesc: 'None.',
    playerEffects: [
      { kind: 'stat', sel: { military: true, rangedAttack: true }, stat: 'range', add: MODIFIER_NUMBERS.downpourRange },
      { kind: 'stat', sel: { buildings: ['hearth', 'brazier_tower'] }, stat: 'range', add: MODIFIER_NUMBERS.downpourRange },
      { kind: 'flag', flag: 'burn_disabled' },
    ],
    enemyEffects: [
      { kind: 'stat', sel: { military: true, rangedAttack: true }, stat: 'range', add: MODIFIER_NUMBERS.downpourRange },
      { kind: 'stat', sel: { buildings: ['thornspire'] }, stat: 'range', add: MODIFIER_NUMBERS.downpourRange },
      { kind: 'flag', flag: 'burn_disabled' },
    ],
  },
  ancient_cache: {
    id: 'ancient_cache',
    name: 'Ancient Cache',
    kind: 'positive',
    desc: 'An Ancient Cache lies 14-20 tiles from the Hearth, heavily guarded.',
    payoffDesc: '+60 Crowns when looted and an extra Rare Boon pick.',
  },
  old_watchtowers: {
    id: 'old_watchtowers',
    name: 'Old Watchtowers',
    kind: 'positive',
    desc: 'Two Brazier Towers already stand between your Hearth and the nearest Nest.',
    payoffDesc: 'Built in.',
  },
};
