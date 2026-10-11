/**
 * Battle objectives (GDD §C). Par numbers: balance.ts PAR / parSeconds(); map anchors:
 * balance.ts OBJECTIVE_ANCHORS.
 */
import type { ObjectiveId, VanguardId } from '../sim/types';
import { BEACONS, HOLDFAST, PAR } from './balance';

export interface ObjectiveDef {
  id: ObjectiveId;
  name: string;
  /** One-line goal for the briefing / tracker. */
  goal: string;
  desc: string;
  /** Par rule text for the briefing (null = none). */
  parDesc: string | null;
  /** Bonus rule text (par / Holdfast bonuses / Elite). */
  bonusDesc: string;
  /** Typical duration text. */
  typical: string;
  scope: 'MUST' | 'SHOULD';
}

export const OBJECTIVES: Record<ObjectiveId, ObjectiveDef> = {
  raze: {
    id: 'raze',
    name: 'Raze',
    goal: 'Destroy every Thorn Nest.',
    desc: 'The Nests send waves at your Hearth. Break each wave, then strike the Nest while it is Spent.',
    parDesc: `Par 6:00, +0:45 per Nest above 2. +${PAR.bonusCrowns} Crowns under par.`,
    bonusDesc: `+${PAR.bonusCrowns} Crowns under par.`,
    typical: '4:30-7:30',
    scope: 'MUST',
  },
  holdfast: {
    id: 'holdfast',
    name: 'Holdfast',
    goal: `Survive ${HOLDFAST.waves} waves, or destroy every Nest.`,
    desc: 'Your Hearth stands at the center of the map. Six waves come, ending in the Great Wave. No raids, no Pickets.',
    parDesc: null,
    bonusDesc: `Unbroken: +${HOLDFAST.unbrokenCrowns} Crowns if no completed building is lost. Uprooted: +${HOLDFAST.uprootedCrowns} Crowns for destroying every Nest.`,
    typical: '5:30-6:30',
    scope: 'MUST',
  },
  beacons: {
    id: 'beacons',
    name: 'Beacons',
    goal: `Fill the Kindling meter to ${BEACONS.kindlingTarget}, or destroy every Nest.`,
    desc: 'Three Beacon Stones wake at 1:30. Hold them lit to score Kindling and Ember.',
    parDesc: `Par 5:30. +${PAR.bonusCrowns} Crowns under par.`,
    bonusDesc: `+${PAR.bonusCrowns} Crowns under par.`,
    typical: '4:30-6:00',
    scope: 'SHOULD',
  },
  elite: {
    id: 'elite',
    name: 'Noble Hunt',
    goal: 'Destroy every Nest and slay the Antlered Lord.',
    desc: 'A Court Noble rides with the Thornwake. It joins the third wave, dashing through your line and calling Stagriders.',
    parDesc: `Par 6:30. +${PAR.bonusCrowns} Crowns under par.`,
    bonusDesc: `+40 Crowns Elite bonus, +${PAR.bonusCrowns} under par.`,
    typical: '6:00-7:30',
    scope: 'MUST',
  },
  boss: {
    id: 'boss',
    name: 'The Briar Throne',
    goal: 'Slay the Briar Regent.',
    desc: 'Burn the three Root Hearts to strip the Regent of its ward and its strength, then face it as it marches on your Hearth.',
    parDesc: null,
    bonusDesc: 'Retreat is impossible. Last Stand spends Resolve to save the Hearth.',
    typical: '8:00-9:30',
    scope: 'MUST',
  },
};

/** Vanguard choices (§C). */
export const VANGUARDS: Record<VanguardId, { name: string; desc: string }> = {
  muster_hall: { name: 'Muster Hall', desc: 'Start with a Muster Hall facing the nearest Nest.' },
  bowyard: { name: 'Bowyard', desc: 'Start with a Bowyard facing the nearest Nest.' },
  storehouse: { name: 'Storehouse + Grainplot', desc: 'Start with a Storehouse at the forest edge and a Grainplot near the Hearth.' },
};
