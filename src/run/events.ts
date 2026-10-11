/**
 * Events and Camp (GDD §L "Events", "Camp"). Six events, no repeats within a run; an Event node
 * becomes a Camp once all are used. Outcomes use EVENT_NUMBERS / CAMP from balance.ts.
 */
import { BOONS, CAMP, CAMP_TEXT, EVENTS, EVENT_IDS, EVENT_NUMBERS, MODIFIERS } from '../data';
import type { EventChoiceId } from '../data';
import type { EventId } from '../sim/types';
import { eligibleBoons, eligibleDrafts } from './offers';
import { saveRun } from './persistence';
import { boonStep, draftStep, grantRandomBoon, queueStep } from './rewards';
import type { CampOption, EventOutcome, EventView, MetaSave, RunState } from './types';
import { addCrowns, currentNodeOf, makeUnits, markDone, nonBossBattleAhead, rankedUp, withRng } from './util';

const E = EVENT_NUMBERS;

/** Pick an unseen event for the current node (null when all six were used). */
export function rollEvent(run: RunState): EventId | null {
  const unseen = EVENT_IDS.filter((id) => !run.eventsSeen.includes(id));
  if (unseen.length === 0) return null;
  return withRng(run, (rng) => rng.pick(unseen));
}

const boonName = (id: string): string => BOONS[id as keyof typeof BOONS]?.name ?? id;

type ChoiceView = EventView['choices'][number];

function choiceState(run: RunState, meta: MetaSave, event: EventId, choice: string): { enabled: boolean; reason?: string } {
  const need = (crowns: number) => (run.crowns >= crowns ? { enabled: true } : { enabled: false, reason: `Requires ${crowns} Crowns` });
  switch (`${event}.${choice}`) {
    case 'refugees_ford.pay':
      return need(E.refugees_ford.payCrowns);
    case 'thorn_smith.bargain': {
      if (run.resolve < E.thorn_smith.minResolve) return { enabled: false, reason: 'Hidden at 1 Resolve: you cannot spare it.' };
      if (eligibleBoons(run, meta).length === 0) return { enabled: false, reason: 'The smith has nothing left to forge for you.' };
      return { enabled: true };
    }
    case 'sellsword_company.hire':
      return need(E.sellsword_company.hireCrowns);
    case 'cold_watchfire.scavenge':
      return eligibleBoons(run, meta).length ? { enabled: true } : { enabled: false, reason: 'Nothing of use remains.' };
    case 'wayshrine.pray':
      return run.resolve < run.maxResolve ? { enabled: true } : { enabled: false, reason: 'Your Resolve is already full.' };
    case 'wayshrine.offer':
      return need(E.wayshrine.offerCrowns);
    default:
      return { enabled: true };
  }
}

export function eventView(run: RunState, meta: MetaSave, id: EventId): EventView {
  const def = EVENTS[id];
  const choices: ChoiceView[] = def.choices.map((c) => ({ id: c.id, label: c.label, desc: c.desc, ...choiceState(run, meta, id, c.id) }));
  const cut = choices.find((c) => c.id === 'cut_down');
  if (id === 'hollow_envoy' && cut && !nonBossBattleAhead(run)) {
    cut.desc = `+${E.hollow_envoy.cutDownCrowns} Crowns. Only the Briar Throne lies ahead, beyond the Blood Moon's reach.`;
  }
  return { id, title: def.title, text: def.text, choices };
}

/** View of the event at the current node (null if none / already resolved). */
export function currentEventView(run: RunState, meta: MetaSave): EventView | null {
  const node = currentNodeOf(run);
  if (!node || node.type !== 'event' || !run.currentEvent || run.nodesDone.includes(node.id)) return null;
  return eventView(run, meta, run.currentEvent);
}

function resolveUp(run: RunState, n: number): void {
  run.resolve = Math.min(run.maxResolve, run.resolve + n);
}

/** Apply an event choice. Marks the node done. Invalid or disabled choices throw. */
export function chooseEventOption(run: RunState, meta: MetaSave, choiceId: string): EventOutcome {
  const node = currentNodeOf(run);
  if (!node || node.type !== 'event') throw new Error('The current node is not an event');
  if (run.nodesDone.includes(node.id) || !run.currentEvent) return { text: '' };
  const event = run.currentEvent;
  if (!EVENTS[event].choices.some((c) => c.id === choiceId)) throw new Error(`Unknown choice "${choiceId}" for ${event}`);
  const state = choiceState(run, meta, event, choiceId);
  if (!state.enabled) throw new Error(state.reason ?? 'Choice unavailable');

  const text = applyEventChoice(run, meta, event, choiceId as EventChoiceId);
  markDone(run, node.id);
  run.currentEvent = null;
  saveRun(run);
  return { text };
}

function applyEventChoice(run: RunState, meta: MetaSave, event: EventId, choice: EventChoiceId): string {
  switch (`${event}.${choice}`) {
    // --- Refugees at the Ford
    case 'refugees_ford.pay':
      addCrowns(run, -E.refugees_ford.payCrowns);
      run.extraTillers += E.refugees_ford.extraTillers;
      return 'The families walk behind the Flame. One more Tiller joins every battle.';
    case 'refugees_ford.arm':
      run.sellswords.push(...makeUnits(E.refugees_ford.armUnit, E.refugees_ford.armCount, E.refugees_ford.armRank));
      return `You hand out spears. ${E.refugees_ford.armCount} Rank I Ashpikes march with you next battle.`;
    case 'refugees_ford.tithe':
      addCrowns(run, E.refugees_ford.titheCrowns);
      run.pending.push({ kind: 'grain_gather_penalty', pct: E.refugees_ford.titheGrainGatherPct });
      return `+${E.refugees_ford.titheCrowns} Crowns. Word spreads; next battle your Grain gathering is ${E.refugees_ford.titheGrainGatherPct}%.`;

    // --- The Thorn-Touched Smith
    case 'thorn_smith.bargain':
      run.resolve = Math.max(0, run.resolve - E.thorn_smith.resolveCost);
      queueStep(
        run,
        meta,
        boonStep(
          "The Smith's craft",
          { source: 'event', rarity: 'R', size: E.thorn_smith.rareOptions, featured: E.thorn_smith.featuredBoon },
          'Choose 1 of 2 Rare Boons',
        ),
      );
      return 'The hammer falls on thorn-wrought steel. Something of you stays in the forge.';
    case 'thorn_smith.mercy':
      if (run.resolve < run.maxResolve) {
        resolveUp(run, E.thorn_smith.mercyResolve);
        return `You cut him free of the briar. +${E.thorn_smith.mercyResolve} Resolve.`;
      }
      addCrowns(run, E.thorn_smith.mercyCrownsAtMax);
      return `You cut him free of the briar. He presses a purse into your hand: +${E.thorn_smith.mercyCrownsAtMax} Crowns.`;

    // --- Sellsword Company
    case 'sellsword_company.hire': {
      const n = E.sellsword_company;
      addCrowns(run, -n.hireCrowns);
      run.sellswords.push(...makeUnits(n.hireUnit, n.hireCount, n.hireRank));
      return `${n.hireCount} Rank I Coursers ride with you next battle.`;
    }
    case 'sellsword_company.duel': {
      const n = E.sellsword_company;
      const won = withRng(run, (rng) => rng.chance(n.duelWinChance));
      if (won) {
        run.sellswords.push(...makeUnits(n.hireUnit, n.hireCount, n.hireRank));
        return `The captain yields. ${n.hireCount} Rank I Coursers ride with you next battle, free.`;
      }
      addCrowns(run, -n.duelLossCrowns);
      run.pending.push({ kind: 'warden_half_hp' });
      return `The captain's blade finds its mark. −${n.duelLossCrowns} Crowns, and the Warden starts the next battle at half HP.`;
    }
    case 'sellsword_company.decline':
      return 'You ride on. The riders watch you go.';

    // --- Cold Watch-Fire
    case 'cold_watchfire.watch':
      run.pending.push({ kind: 'cold_watchfire' });
      return 'You keep watch through the night. Next battle the land lies open and the first wave never comes.';
    case 'cold_watchfire.scavenge': {
      const id = grantRandomBoon(run, meta, 'C');
      return id ? `Among the ashes: ${boonName(id)}.` : 'The camp holds nothing of use.';
    }

    // --- The Hollow Envoy
    case 'hollow_envoy.accept': {
      const id = grantRandomBoon(run, meta, 'M');
      run.waveMult = E.hollow_envoy.waveMult;
      const gift = id ? `The Court's gift: ${boonName(id)}.` : 'The gift crumbles to ash.';
      return `${gift} The Thornwake knows your scent: all waves +${Math.round((E.hollow_envoy.waveMult - 1) * 100)}% for the rest of the run.`;
    }
    case 'hollow_envoy.cut_down':
      addCrowns(run, E.hollow_envoy.cutDownCrowns);
      if (!nonBossBattleAhead(run)) return `+${E.hollow_envoy.cutDownCrowns} Crowns. The moon reddens, but the Heartwood keeps its own sky.`;
      run.pending.push({ kind: 'blood_moon_next' });
      return `+${E.hollow_envoy.cutDownCrowns} Crowns. The moon reddens: your next battle gains ${MODIFIERS.blood_moon.name}.`;

    // --- Wayshrine of Ash
    case 'wayshrine.pray': {
      resolveUp(run, E.wayshrine.prayResolve);
      const commons = run.boons.filter((b) => BOONS[b].rarity === 'C');
      if (commons.length === 0) return `+${E.wayshrine.prayResolve} Resolve. The shrine asks nothing of you.`;
      const lost = withRng(run, (rng) => rng.pick(commons));
      run.boons = run.boons.filter((b) => b !== lost);
      return `+${E.wayshrine.prayResolve} Resolve. The coals take ${boonName(lost)} as their due.`;
    }
    case 'wayshrine.offer':
      addCrowns(run, -E.wayshrine.offerCrowns);
      {
        const p = run.pending.find((x) => x.kind === 'reward_plus_one');
        if (p && p.kind === 'reward_plus_one') p.picks += E.wayshrine.offerPicks;
        else run.pending.push({ kind: 'reward_plus_one', picks: E.wayshrine.offerPicks });
      }
      return `The coals flare. Your next ${E.wayshrine.offerPicks} reward picks show ${E.wayshrine.offerOptions} options.`;
    case 'wayshrine.leave':
      return 'You walk on.';
    default:
      throw new Error(`Unhandled event choice ${event}.${choice}`);
  }
}

// ---------------------------------------------------------------------------
// Camp
// ---------------------------------------------------------------------------

export function campOptions(run: RunState, meta: MetaSave): CampOption[] {
  const rest =
    run.resolve < run.maxResolve ? `+${CAMP.restResolve} Resolve.` : `Resolve is full: +${CAMP.restCrownsAtMax} Crowns instead.`;
  const drill =
    run.retinue.length > 0
      ? 'Every Retinue unit +1 Rank (max III).'
      : `No Retinue: ${CAMP.drillEmptyCount} Rank I Ashpikes join as Sellswords.`;
  const muster =
    eligibleDrafts(run, meta).length > 0 ? 'Draft 1 of 3 new unit types.' : 'No units left to draft: a random Common Boon instead.';
  return [
    { id: 'rest', label: CAMP_TEXT.rest.label, desc: rest },
    { id: 'drill', label: CAMP_TEXT.drill.label, desc: drill },
    { id: 'muster', label: CAMP_TEXT.muster.label, desc: muster },
  ];
}

export function chooseCamp(run: RunState, meta: MetaSave, choice: 'rest' | 'drill' | 'muster'): EventOutcome {
  const node = currentNodeOf(run);
  if (!node || node.type !== 'camp') throw new Error('The current node is not a Camp');
  if (run.nodesDone.includes(node.id)) return { text: '' };
  let text: string;
  if (choice === 'rest') {
    if (run.resolve < run.maxResolve) {
      resolveUp(run, CAMP.restResolve);
      text = `The Hearthband rests by the fire. +${CAMP.restResolve} Resolve.`;
    } else {
      addCrowns(run, CAMP.restCrownsAtMax);
      text = `Rested and resolute. You trade the spare day for +${CAMP.restCrownsAtMax} Crowns.`;
    }
  } else if (choice === 'drill') {
    if (run.retinue.length > 0) {
      run.retinue = run.retinue.map((u) => rankedUp(u, CAMP.drillRanks));
      text = 'Your veterans drill until dusk. Every Retinue unit gains a Rank.';
    } else {
      run.sellswords.push(...makeUnits(CAMP.drillEmptyUnit, CAMP.drillEmptyCount, CAMP.drillEmptyRank));
      text = `With no veterans to drill, ${CAMP.drillEmptyCount} Rank I Ashpikes take up the spear as Sellswords.`;
    }
  } else if (choice === 'muster') {
    if (eligibleDrafts(run, meta).length > 0) {
      queueStep(run, meta, draftStep('Muster', { source: 'camp' }));
      text = 'Recruits gather at the fire. Choose who joins the march.';
    } else {
      const id = grantRandomBoon(run, meta, 'C');
      text = id ? `No new recruits come. You find ${boonName(id)} instead.` : 'No new recruits come.';
    }
  } else {
    throw new Error(`Unknown camp choice "${choice as string}"`);
  }
  markDone(run, node.id);
  saveRun(run);
  return { text };
}
