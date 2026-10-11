/**
 * Run events (GDD §L "Events"). Six, no repeats within a run. Outcomes are implemented by the
 * run module using EVENT_NUMBERS from balance.ts. Choice ids are stable API for the run module.
 */
import type { EventId } from '../sim/types';
import type { EventDef } from './types';
import { EVENT_NUMBERS as N } from './balance';

export const EVENTS: Record<EventId, EventDef> = {
  refugees_ford: {
    id: 'refugees_ford',
    title: 'Refugees at the Ford',
    text: 'A column of Hallowmere families waits at the river crossing, thorn-scratched and hungry. They ask to walk behind the Flame.',
    choices: [
      {
        id: 'pay',
        label: `Feed them (${N.refugees_ford.payCrowns} Crowns)`,
        desc: `+${N.refugees_ford.extraTillers} starting Tiller for the rest of the run.`,
      },
      {
        id: 'arm',
        label: 'Arm them',
        desc: `${N.refugees_ford.armCount} Rank I Ashpikes join as Sellswords.`,
      },
      {
        id: 'tithe',
        label: 'Take a tithe',
        desc: `+${N.refugees_ford.titheCrowns} Crowns. Next battle Grain gathering ${N.refugees_ford.titheGrainGatherPct}%.`,
      },
    ],
  },
  thorn_smith: {
    id: 'thorn_smith',
    title: 'The Thorn-Touched Smith',
    text: 'A smith works a forge half-swallowed by briar. Thorns grow through his arms, yet his hammer is steady. He offers his craft, for a price.',
    choices: [
      {
        id: 'bargain',
        label: 'Strike a bargain',
        desc: `Lose ${N.thorn_smith.resolveCost} Resolve. Pick 1 of ${N.thorn_smith.rareOptions} Rare Boons. Hidden at 1 Resolve.`,
      },
      {
        id: 'mercy',
        label: 'Grant mercy',
        desc: `+${N.thorn_smith.mercyResolve} Resolve (+${N.thorn_smith.mercyCrownsAtMax} Crowns if already at max).`,
      },
    ],
  },
  sellsword_company: {
    id: 'sellsword_company',
    title: 'Sellsword Company',
    text: 'A band of riders under a torn banner blocks the road. Their captain names a price, or offers a duel.',
    choices: [
      {
        id: 'hire',
        label: `Hire them (${N.sellsword_company.hireCrowns} Crowns)`,
        desc: `${N.sellsword_company.hireCount} Rank I Coursers join as Sellswords.`,
      },
      {
        id: 'duel',
        label: 'The Warden duels the captain',
        desc: `Even odds: they join free, or you lose ${N.sellsword_company.duelLossCrowns} Crowns and the Warden starts the next battle at half HP.`,
      },
      { id: 'decline', label: 'Decline', desc: 'Ride on.' },
    ],
  },
  cold_watchfire: {
    id: 'cold_watchfire',
    title: 'Cold Watch-Fire',
    text: 'An old watch-fire sits on a hill above the road, long cold. From here the land ahead lies open.',
    choices: [
      {
        id: 'watch',
        label: 'Keep watch',
        desc: 'Next battle: terrain explored, every Nest, Picket, Cache and Beacon shown, and its first wave never comes.',
      },
      { id: 'scavenge', label: 'Scavenge the camp', desc: 'Gain a random Common Boon.' },
    ],
  },
  hollow_envoy: {
    id: 'hollow_envoy',
    title: 'The Hollow Envoy',
    text: 'A hollowed noble in a crown of thorn waits under a white flag. He offers a gift from the Court.',
    choices: [
      {
        id: 'accept',
        label: 'Accept the gift',
        desc: 'Gain a random Mythic Boon (a Rare if none remain). All waves +15% for the rest of the run.',
      },
      {
        id: 'cut_down',
        label: 'Cut him down',
        desc: `+${N.hollow_envoy.cutDownCrowns} Crowns. The next battle gains Blood Moon.`,
      },
    ],
  },
  wayshrine: {
    id: 'wayshrine',
    title: 'Wayshrine of Ash',
    text: 'A roadside shrine still holds a few warm coals. Pilgrims once left offerings here.',
    choices: [
      {
        id: 'pray',
        label: 'Pray',
        desc: `+${N.wayshrine.prayResolve} Resolve. Lose a random Common Boon.`,
      },
      {
        id: 'offer',
        label: `Make an offering (${N.wayshrine.offerCrowns} Crowns)`,
        desc: `The next ${N.wayshrine.offerPicks} reward picks show ${N.wayshrine.offerOptions} options.`,
      },
      { id: 'leave', label: 'Leave', desc: 'Walk on.' },
    ],
  },
};

/** Typed choice ids per event (for the run module's switch statements). */
export type EventChoiceId =
  | 'pay'
  | 'arm'
  | 'tithe'
  | 'bargain'
  | 'mercy'
  | 'hire'
  | 'duel'
  | 'decline'
  | 'watch'
  | 'scavenge'
  | 'accept'
  | 'cut_down'
  | 'pray'
  | 'offer'
  | 'leave';
