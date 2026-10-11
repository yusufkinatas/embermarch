/**
 * Short UI strings (GDD §A tone: terse and heraldic; §O HUD, alerts, first-run hints).
 */
import type { AlertKind, ResourceType, UnitClass } from '../sim/types';
import type { BoonTag, Rarity } from './types';

export const RESOURCE_NAMES: Record<ResourceType, string> = {
  grain: 'Grain',
  timber: 'Timber',
  ember: 'Ember',
};

export const CLASS_NAMES: Record<UnitClass, string> = {
  worker: 'Worker',
  infantry: 'Infantry',
  ranged: 'Ranged',
  cavalry: 'Cavalry',
  siege: 'Siege',
  hero: 'Hero',
  boss: 'Boss',
};

export const RARITY_NAMES: Record<Rarity, string> = { C: 'Common', R: 'Rare', M: 'Mythic' };

export const TAG_NAMES: Record<BoonTag, string> = {
  Econ: 'Economy',
  Ember: 'Ember',
  Fort: 'Fortification',
  Pike: 'Pike',
  Bow: 'Bow',
  Horse: 'Horse',
  Siege: 'Siege',
  Warden: 'Warden',
  Veteran: 'Veteran',
};

export const RANK_NAMES = ['Recruit', 'Rank I', 'Rank II', 'Rank III'];

/** Default alert texts (§O). Callers may substitute details (direction, wave number, timers). */
export const ALERT_TEXT: Record<AlertKind, string> = {
  under_attack: 'We are under attack.',
  tillers_attacked: 'Tillers under attack.',
  idle_tillers: 'Tillers stand idle.',
  pop_capped: 'Need Cottages.',
  building_complete: 'Construction complete.',
  research_complete: 'Research complete.',
  unit_trained: 'Unit ready.',
  warden_fallen: 'The Warden has fallen.',
  warden_returned: 'The Warden returns.',
  wave_muster: 'The horn sounds.',
  wave_launch: 'The wave advances.',
  wave_broken: 'Wave broken.',
  raid: 'Raiders on the fields.',
  nest_destroyed: 'A Nest burns.',
  beacon_lit: 'A Beacon is lit.',
  beacon_snuffed: 'A Beacon is snuffed.',
  last_stand: 'Last Stand! The Flame endures.',
  cache_looted: 'Cache looted.',
  ascendant: 'The Thornwake ascends.',
  boss_phase: 'The Regent is uprooted.',
  info: '',
};

/** Templated texts (§I, §O). */
export const TEXT = {
  hornMuster: (wave: number, dir: string) => `The horn sounds in the ${dir}. Wave ${wave} gathers.`,
  greatWave: 'The Great Wave gathers.',
  waveBroken: (wave: number, dir: string, spent: string) => `Wave ${wave} broken. ${dir} Nest Spent ${spent}`,
  ascendantSoon: (t: string) => `Ascendant in ${t}`,
  ridersAhead: 'Riders ahead',
  rootbreakerTrailing: 'Rootbreaker trailing',
  adaptation: (what: string) => `The thorns have learned your ${what}.`,
  wavesReduced: (pct: number) => `Waves −${pct}%`,
  kindle: 'Kindle!',
  notEnough: (res: ResourceType) => `Not enough ${RESOURCE_NAMES[res]}`,
  popCapped: 'Population capped',
  needs: (name: string) => `Requires ${name}`,
  temperLocked: 'Another Temper burns in this Forgehall.',
  queueFull: 'Queue full',
  blighted: 'Cannot build on Blight',
  tooCloseEnemy: 'Too close to an enemy structure',
  unexplored: 'Unexplored ground',
  blocked: 'Blocked',
  regentWarded: 'Regent Warded',
};

/** Compass directions used by the Horn (8-way). */
export const COMPASS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;

export interface HintDef {
  id: string;
  trigger: string;
  text: string;
}

/** First-run hints (§O), each shown once (stored in meta.hintsSeen). */
export const HINTS: HintDef[] = [
  { id: 'gather', trigger: 'start', text: 'Drag a box over your Tillers, then right-click a Thicket to gather Grain.' },
  { id: 'train_tiller', trigger: 'first_gather', text: 'Press H to select the Hearth and Q to train more Tillers.' },
  {
    id: 'military_building',
    trigger: 'time>=30 && timber>=150 && militaryBuildings==1',
    text: 'With Tillers selected, press B for a Muster Hall or R for a Bowyard.',
  },
  { id: 'cottage', trigger: 'pop>=popCap-2', text: 'Press C with Tillers selected to build a Cottage (+6 pop).' },
  {
    id: 'scout',
    trigger: 'wave1_muster',
    text: "A wave musters. Get a unit close to its Nest to see what's coming. ` selects your Warden.",
  },
  { id: 'rally', trigger: 'wave1_launch', text: 'Select the Hearth and press V to rally nearby Tillers. It has a long cooldown.' },
  { id: 'grainplot', trigger: 'near_thickets<30%', text: 'Thickets run out. Grainplots (F) feed 2 Tillers forever.' },
  {
    id: 'groups',
    trigger: 'first_military',
    text: 'Ctrl+1 or Alt+1 makes a group, or right-click a group slot. Press 1 to recall it.',
  },
  { id: 'spent', trigger: 'wave1_broken', text: 'That Nest is Spent and takes extra damage for 30 s. A + click to attack-move.' },
  {
    id: 'counters',
    trigger: 'first_counter_popup',
    text: 'Orange ×3 means a counter bonus. Grey means resisted. Hold Tab for the Counter Wheel.',
  },
];

/** Camp choices (§L). */
export const CAMP_TEXT = {
  rest: { label: 'Rest', desc: '+1 Resolve, or +30 Crowns if already at max.' },
  drill: { label: 'Drill', desc: 'Every Retinue unit +1 Rank (max III). With no Retinue, 2 Rank I Ashpikes join as Sellswords.' },
  muster: { label: 'Muster', desc: 'Draft 1 of 3 units. With an empty pool, a random Common Boon instead.' },
};

/** Run-map node type names (§B). */
export const NODE_NAMES = {
  battle: 'Battle',
  elite: 'Elite',
  event: 'Event',
  peddler: 'Peddler',
  camp: 'Camp',
  boss: 'The Briar Throne',
};

/** Reward type names (§B, §M). */
export const REWARD_NAMES = {
  boon: { name: 'Boon', desc: 'Pick 1 of 3 Boons.' },
  draft: { name: 'Draft', desc: 'Pick 1 of 3 new unit types.' },
  spoils: { name: 'Spoils', desc: '+80 Crowns and pick 1 of 3 Common Boons.' },
};
