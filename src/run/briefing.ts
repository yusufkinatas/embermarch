/**
 * Battle briefing (GDD §O screen flow, §C objectives / par / bonuses, §I doctrines).
 */
import { BIOMES, CROWNS, DOCTRINES, MODIFIERS, OBJECTIVES, REWARDS, REWARD_NAMES, START, VANGUARD_IDS, nestsFor, parSeconds } from '../data';
import type { DoctrineDef } from '../data/types';
import type { DoctrineId, Effect, ModifierId, PlayerUnitId } from '../sim/types';
import type { Briefing, MetaSave, RunNode, RunState } from './types';
import { composeSetup, effectiveModifiers, firstMarchEased, firstMarchLine, retinueForBattle, unlockedFor } from './setup';
import { cloneUnits, getNode, isBattleNode } from './util';

/** First 3 runs of a profile name the doctrine answer explicitly (§I). */
export const EXPLICIT_ANSWER_RUNS = 3;

/**
 * Doctrine counsel fields added by the sim lane (S11). Read as optional so this compiles before
 * and after they land: `answerCore` is the answer with core units only, `answerDrafts` the
 * drafted units the full answer names.
 */
type CounselDef = DoctrineDef & { answerCore?: string; answerDrafts?: PlayerUnitId[] };

/** Modifiers as the briefing shows them: a pending Blood Moon applies to whichever battle comes next. */
function briefingMods(run: RunState, node: RunNode): ModifierId[] {
  return run.nodesDone.includes(node.id) ? [...(node.battle?.modifiers ?? [])] : effectiveModifiers(run, node);
}

function rewardDesc(run: RunState, node: RunNode, mods: readonly ModifierId[]): string {
  const info = node.battle!;
  if (node.type === 'boss') return 'Slay the Regent and end the march.';
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

/**
 * What winning a battle node pays, as one line (map tooltip and briefing share it, so they
 * cannot drift): Elites pay a Rare+ Boon, a Draft and Crowns; the boss ends the march.
 */
export function nodeRewardText(run: RunState, node: RunNode): string {
  if (!node.battle) return '';
  return rewardDesc(run, node, briefingMods(run, node));
}

/**
 * Counsel for a doctrine as this run can act on it: the full answer once the run has the
 * drafted units it names, else the core-units answer (S11), else the full answer.
 */
export function doctrineCounsel(run: RunState, doctrine: DoctrineId): string {
  const d = DOCTRINES[doctrine] as CounselDef;
  const units = unlockedFor(run.drafts).units;
  const missing = (d.answerDrafts ?? []).some((u) => !units.includes(u));
  return missing ? (d.answerCore ?? d.answer) : d.answer;
}

function startUnitCount(effects: readonly Effect[], unit: PlayerUnitId): number {
  let n = 0;
  for (const e of effects) if (e.kind === 'startUnits' && e.unit === unit) n += e.count;
  return n;
}

function quitCost(run: RunState, node: RunNode): string {
  if (node.type === 'boss') {
    return run.resolve <= 1
      ? 'Quitting costs 1 Resolve and ends the run.'
      : 'Quitting restarts the Briar Throne with the same map at −1 Resolve, plus any Last Stands already spent.';
  }
  const end = run.resolve <= 1 ? ' At 1 Resolve this ends the run.' : '';
  return `Quitting counts as a Retreat with no plunder: −1 Resolve, and your Retinue returns as it marched in.${end}`;
}

export function getBriefing(run: RunState, meta: MetaSave, nodeId: string): Briefing {
  const node = getNode(run, nodeId);
  if (!isBattleNode(node) || !node.battle) throw new Error(`Node ${nodeId} is not a battle`);
  const info = node.battle;
  const obj = OBJECTIVES[info.objective];
  const biome = BIOMES[info.biome];
  const doctrine = DOCTRINES[info.doctrine];
  const mods = briefingMods(run, node);
  // The host as composeSetup will field it (pure: the run is not touched).
  const effects = composeSetup(run, meta, node, VANGUARD_IDS[0]).playerEffects;
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
    doctrineAnswer: run.profileRunIndex < EXPLICIT_ANSWER_RUNS ? doctrineCounsel(run, info.doctrine) : null,
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
    tillers: START.tillers + startUnitCount(effects, 'tiller'),
    coursers: START.coursers + startUnitCount(effects, 'courser'),
    assists: firstMarchEased(run, node) ? [firstMarchLine()] : [],
  };
}
