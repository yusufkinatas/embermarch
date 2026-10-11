/**
 * In-battle research (GDD §H). Resets every battle, one at a time per building.
 * Tempers (Forgehall) are mutually exclusive per battle.
 */
import type { ResearchId } from '../sim/types';
import type { ResearchDef } from './types';

export const RESEARCH: Record<ResearchId, ResearchDef> = {
  hearth_watch: {
    id: 'hearth_watch',
    name: 'Hearth Watch',
    building: 'hearth',
    hotkey: 'Z',
    cost: { grain: 75, timber: 50 },
    time: 25,
    effects: [{ kind: 'flag', flag: 'hearth_watch' }],
    desc: 'Rally the Hearth cooldown 180 → 120 s, duration 15 → 25 s.',
  },
  stoked_braziers: {
    id: 'stoked_braziers',
    name: 'Stoked Braziers',
    building: 'hearth',
    hotkey: 'X',
    cost: { timber: 100, ember: 75 },
    time: 35,
    effects: [
      { kind: 'stat', sel: { buildings: ['hearth', 'brazier_tower'] }, stat: 'atk', add: 3 },
      { kind: 'stat', sel: { buildings: ['hearth', 'brazier_tower'] }, stat: 'range', add: 1 },
    ],
    desc: 'Hearth and Brazier Towers +3 ATK and +1 range.',
  },
  log_sledges: {
    id: 'log_sledges',
    name: 'Log Sledges',
    building: 'storehouse',
    hotkey: 'Z',
    cost: { grain: 75, timber: 75 },
    time: 25,
    effects: [{ kind: 'carry', res: 'timber', add: 5 }],
    desc: 'Tillers carry +5 Timber.',
  },
  furrow_rites: {
    id: 'furrow_rites',
    name: 'Furrow Rites',
    building: 'storehouse',
    hotkey: 'X',
    cost: { grain: 50, timber: 100 },
    time: 30,
    effects: [{ kind: 'gather', res: 'grain', source: 'grainplot', pct: 25 }],
    desc: 'Grainplot gathering +25%.',
  },
  deep_picks: {
    id: 'deep_picks',
    name: 'Deep Picks',
    building: 'storehouse',
    hotkey: 'C',
    cost: { grain: 100, timber: 75 },
    time: 30,
    effects: [{ kind: 'gather', res: 'ember', pct: 25 }],
    desc: 'Ember gathering +25%.',
  },
  ash_hafts: {
    id: 'ash_hafts',
    name: 'Ash-Hardened Hafts',
    building: 'muster_hall',
    hotkey: 'Z',
    cost: { grain: 100, ember: 40 },
    time: 25,
    effects: [
      { kind: 'stat', sel: { units: ['ashpike'] }, stat: 'hp', add: 20 },
      { kind: 'stat', sel: { units: ['oathshield'] }, stat: 'armor', add: 1 },
    ],
    desc: 'Ashpikes +20 HP. Oathshields +1 armor.',
  },
  quick_draw: {
    id: 'quick_draw',
    name: 'Quick Draw',
    building: 'bowyard',
    hotkey: 'Z',
    cost: { grain: 75, timber: 75 },
    time: 25,
    effects: [{ kind: 'stat', sel: { units: ['bowman', 'brandbow'] }, stat: 'cooldown', pct: -15 }],
    desc: 'Bowman and Brandbow attack cooldown −15%.',
  },
  thunder_charge: {
    id: 'thunder_charge',
    name: 'Thunder Charge',
    building: 'paddock',
    hotkey: 'Z',
    cost: { grain: 100, ember: 75 },
    time: 30,
    effects: [{ kind: 'flag', flag: 'thunder_charge' }],
    desc: 'Coursers gain Charge ×1.5. Destrier Charge rises to ×2.5.',
  },
  ember_edge: {
    id: 'ember_edge',
    name: 'Temper: Ember Edge',
    building: 'forgehall',
    hotkey: 'Z',
    cost: { grain: 100, ember: 100 },
    time: 40,
    temper: true,
    effects: [
      { kind: 'stat', sel: { military: true, melee: true }, stat: 'atk', add: 2 },
      { kind: 'stat', sel: { units: ['warden'] }, stat: 'atk', add: 2 },
    ],
    desc: 'Melee military and the Warden +2 ATK. Locks the other Tempers.',
  },
  barbed_heads: {
    id: 'barbed_heads',
    name: 'Temper: Barbed Heads',
    building: 'forgehall',
    hotkey: 'X',
    cost: { timber: 75, ember: 100 },
    time: 40,
    temper: true,
    effects: [{ kind: 'stat', sel: { military: true, rangedAttack: true }, stat: 'atk', add: 2 }],
    desc: 'Ranged military +2 ATK. Locks the other Tempers.',
  },
  hauberks: {
    id: 'hauberks',
    name: 'Temper: Hardened Hauberks',
    building: 'forgehall',
    hotkey: 'C',
    cost: { grain: 150, ember: 100 },
    time: 45,
    temper: true,
    effects: [{ kind: 'stat', sel: { military: true }, stat: 'armor', add: 2 }],
    desc: 'All military +2 armor. Locks the other Tempers.',
  },
};

/** Thunder Charge numbers (flag implemented by sim-core). */
export const THUNDER_CHARGE = { courserMult: 1.5, courserMinDist: 3, destrierMult: 2.5 };
