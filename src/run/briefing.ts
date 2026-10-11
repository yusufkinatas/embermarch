/**
 * Battle briefing (GDD §O screen flow, §C objectives / par / bonuses, §I doctrines).
 */
import { BIOMES, CROWNS, DOCTRINES, MODIFIERS, OBJECTIVES, REWARDS, REWARD_NAMES, VANGUARD_IDS, nestsFor, parSeconds } from '../data';
import type { Briefing, MetaSave, RunNode, RunState } from './types';
import { effectiveModifiers, retinueForBattle } from './setup';
import { cloneUnits, getNode, isBattleNode } from './util';

/** First 3 runs of a profile name the doctrine answer explicitly (§I). */
export const EXPLICIT_ANSWER_RUNS = 3;

function rewardDesc(run: RunState, node: RunNode, mods: string[]): string {
  const info = node.battle!;
  if (node.type === 'boss') return 'Slay the Briar Regent and end the march.';
  const four = mods.includes('creeping_wake');
  const n = four ? REWARDS.offerSizeBonus : REWARDS.offerSize;
  let text: string;
  if (node.type === 'elite') {
    text = `Elite: a Rare or better Boon (1 of ${n}), then a Draft. +${CROWNS.eliteBonus} Crowns.`;
  } else if (info.reward === 'boon') {
    text = `${REWARD_NAMES.boon.name}: pick 1 of ${n} Boons.`;
  } else if (info.reward === 'draft') {
    text = `${REWARD_NAMES.draft.name}: pick 1 of ${n} new unit types.`;
  } else {
    text = `${REWARD_NAMES.spoils.name}: +${REWARDS.spoilsCrowns} Crowns and pick 1 of ${n} Common Boons.`;
  }
  if (mods.includes('ancient_cache')) text += ' Loot the Ancient Cache for an extra Rare Boon.';
  const plus = run.pending.find((p) => p.kind === 'reward_plus_one');
  if (!four && plus && plus.kind === 'reward_plus_one' && plus.picks > 0) text += ' The Wayshrine adds an option.';
  return text;
}

function quitCost(run: RunState, node: RunNode): string {
  if (node.type === 'boss') {
    return run.resolve <= 1
      ? 'Quitting costs 1 Resolve and ends the run.'
      : 'Quitting restarts the Briar Throne with the same map at −1 Resolve.';
  }
  const end = run.resolve <= 1 ? ' At 1 Resolve this ends the run.' : '';
  return `Quitting counts as a Retreat with no plunder: −1 Resolve, and your Retinue returns as it marched in.${end}`;
}

export function getBriefing(run: RunState, _meta: MetaSave, nodeId: string): Briefing {
  const node = getNode(run, nodeId);
  if (!isBattleNode(node) || !node.battle) throw new Error(`Node ${nodeId} is not a battle`);
  const info = node.battle;
  const obj = OBJECTIVES[info.objective];
  const biome = BIOMES[info.biome];
  const doctrine = DOCTRINES[info.doctrine];
  // A pending Blood Moon applies to whichever battle comes next.
  const mods = run.nodesDone.includes(node.id) ? [...info.modifiers] : effectiveModifiers(run, node);
  return {
    nodeId,
    nodeType: node.type as Briefing['nodeType'],
    objective: info.objective,
    objectiveName: obj.name,
    objectiveDesc: `${obj.goal} ${obj.desc}`,
    biome: info.biome,
    biomeName: biome.name,
    biomeTwist: biome.twist,
    modifiers: mods.map((id) => {
      const m = MODIFIERS[id];
      return { id, name: m.name, desc: m.desc, payoff: m.payoffDesc, kind: m.kind };
    }),
    doctrine: info.doctrine,
    doctrineName: doctrine.name,
    doctrineHint: doctrine.hint,
    doctrineAnswer: run.profileRunIndex < EXPLICIT_ANSWER_RUNS ? doctrine.answer : null,
    depth: info.depth,
    threat: info.threat,
    par: parSeconds(info.objective, nestsFor(info.objective, info.depth)),
    reward: info.reward,
    rewardDesc: rewardDesc(run, node, mods),
    retinue: retinueForBattle(run),
    sellswords: cloneUnits(run.sellswords),
    vanguards: [...VANGUARD_IDS],
    canRetreat: node.type !== 'boss',
    quitCostText: quitCost(run, node),
  };
}
