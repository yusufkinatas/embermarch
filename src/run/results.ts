/**
 * Battle results (GDD §M Crowns and rewards, §B Resolve / Retinue / Run end).
 */
import { CAMP, CROWNS, MODIFIERS, REWARDS, floorEps } from '../data';
import type { BattleResult, ModifierId, ObjectiveId } from '../sim/types';
import { saveRun } from './persistence';
import { boonStep, draftStep, materializeHead, retinueStep } from './rewards';
import { baggageFrom, effectiveModifiers } from './setup';
import type { CrownLine, MetaSave, PostBattle, RewardStep, RunNode, RunState } from './types';
import { cloneUnits, consumeBattlePending, currentNodeOf, isBattleNode, makeUnits, markDone, unitsLabel } from './util';

const PAR_OBJECTIVES: readonly ObjectiveId[] = ['raze', 'elite', 'beacons'];

/** Results line for the Sellswords granted after a defeat that empties the Retinue. */
export const STRAGGLERS_LABEL = 'Stragglers rejoin the Hearthband';

export interface CrownInput {
  outcome: BattleResult['outcome'];
  depth: number;
  objective: ObjectiveId;
  modifiers: readonly ModifierId[];
  isElite: boolean;
  plunderCrowns: number;
  underPar: boolean;
  unbroken: boolean;
  uprooted: boolean;
}

/**
 * Crowns for a battle (§M): victory = 20 + 4d + plunder + par/Holdfast bonuses + flat modifier
 * bonuses, ×1.5 under Blood Moon, then +40 for an Elite. Retreat keeps plunder only. Defeat 0.
 */
export function battleCrowns(c: CrownInput): { lines: CrownLine[]; total: number } {
  const lines: CrownLine[] = [];
  const plunder = Math.max(0, Math.round(c.plunderCrowns));
  if (c.outcome === 'defeat') return { lines, total: 0 };
  if (c.outcome === 'retreat') {
    if (plunder > 0) lines.push({ label: 'Plunder (retreat)', amount: plunder });
    return { lines, total: plunder };
  }
  lines.push({ label: `Victory (depth ${c.depth})`, amount: CROWNS.base + CROWNS.perDepth * c.depth });
  if (plunder > 0) lines.push({ label: 'Plunder', amount: plunder });
  if (c.underPar && PAR_OBJECTIVES.includes(c.objective)) lines.push({ label: 'Under par', amount: CROWNS.parBonus });
  if (c.objective === 'holdfast') {
    if (c.unbroken) lines.push({ label: 'Unbroken', amount: CROWNS.unbroken });
    if (c.uprooted) lines.push({ label: 'Uprooted', amount: CROWNS.uprooted });
  }
  let mult = 1;
  for (const m of c.modifiers) {
    const def = MODIFIERS[m];
    if (def.crownsBonus) lines.push({ label: def.name, amount: def.crownsBonus });
    if (def.crownsMult) mult *= def.crownsMult;
  }
  let total = lines.reduce((s, l) => s + l.amount, 0);
  if (mult !== 1) {
    const boosted = floorEps(total * mult);
    const names = c.modifiers.filter((m) => MODIFIERS[m].crownsMult).map((m) => MODIFIERS[m].name);
    lines.push({ label: `${names.join(', ')} ×${mult}`, amount: boosted - total });
    total = boosted;
  }
  if (c.isElite) {
    lines.push({ label: 'Elite bonus', amount: CROWNS.eliteBonus });
    total += CROWNS.eliteBonus;
  }
  return { lines, total };
}

/** Reward steps for a won battle node (§M "Reward screen"), before the Retinue step. */
function rewardSteps(node: RunNode, mods: ModifierId[], result: BattleResult): RewardStep[] {
  const info = node.battle!;
  const bonusOption = mods.includes('creeping_wake');
  const steps: RewardStep[] = [];
  if (node.type === 'elite') {
    steps.push(boonStep('Elite reward', { source: 'reward', rarity: 'elite', bonusOption }));
    steps.push(draftStep('Elite reward: draft a unit', { source: 'reward', bonusOption }));
  } else if (info.reward === 'draft') {
    steps.push(draftStep('Draft a unit', { source: 'reward', bonusOption }));
  } else if (info.reward === 'spoils') {
    steps.push(boonStep('Spoils of battle', { source: 'reward', rarity: 'C', bonusOption }, 'Choose a Common Boon'));
  } else {
    steps.push(boonStep('Choose a Boon', { source: 'reward', rarity: 'normal', bonusOption }));
  }
  if (mods.includes('ancient_cache') && result.ancientCacheLooted) {
    steps.push(boonStep('Ancient Cache', { source: 'reward', rarity: 'R', bonusOption }, 'An extra Rare Boon'));
  }
  return steps;
}

/**
 * Apply a battle result: Crowns, Resolve, stats, pending effects consumed, node done, reward queue
 * (victory: rewards then Retinue; retreat: Retinue), run-over detection. Saves.
 */
export function finishBattle(run: RunState, meta: MetaSave, result: BattleResult): PostBattle {
  const node = currentNodeOf(run);
  if (!node || !isBattleNode(node) || !node.battle) throw new Error('finishBattle: the current node is not a battle');
  if (!run.battleInProgress && run.lastBattle && run.nodesDone.includes(node.id)) return run.lastBattle;

  const boss = node.type === 'boss';
  const elite = node.type === 'elite';
  // Retreat is impossible in the boss battle; treat a stray one as a defeat.
  const outcome: BattleResult['outcome'] = boss && result.outcome === 'retreat' ? 'defeat' : result.outcome;
  const mods = effectiveModifiers(run, node);

  const crowns = battleCrowns({
    outcome,
    depth: node.battle.depth,
    objective: node.battle.objective,
    modifiers: mods,
    isElite: elite,
    plunderCrowns: result.plunderCrowns,
    underPar: result.underPar,
    unbroken: result.unbroken,
    uprooted: result.uprooted,
  });
  const lines = crowns.lines;
  let total = crowns.total;
  if (outcome === 'victory' && !boss && !elite && node.battle.reward === 'spoils') {
    lines.push({ label: 'Spoils', amount: REWARDS.spoilsCrowns });
    total += REWARDS.spoilsCrowns;
  }
  run.crowns += total;

  const s = run.stats;
  s.crownsEarned += total;
  s.nestsDestroyed += Math.max(0, result.nestsDestroyed);
  s.kills += Math.max(0, result.stats?.kills ?? 0);
  s.timePlayed += Math.max(0, result.time);

  // Sellswords fought in this battle; survivors are part of result.survivors.
  run.sellswords = [];
  consumeBattlePending(run);

  let resolveLost = 0;
  let runWon = false;
  let bossRetry = false;
  if (outcome === 'victory') {
    s.battlesWon++;
    if (elite) s.elitesWon++;
    resolveLost = boss ? Math.max(0, result.lastStandsUsed) : 0;
    runWon = boss;
  } else if (outcome === 'retreat') {
    resolveLost = 1;
  } else {
    run.retinue = [];
    if (boss) {
      resolveLost = Math.max(0, result.lastStandsUsed);
      // The sim spends Resolve on Last Stand before a boss defeat. If some is left anyway,
      // fall back to the Autosave rule: restart the boss at −1 Resolve.
      if (run.resolve - resolveLost > 0) {
        resolveLost += 1;
        bossRetry = true;
      }
    } else {
      resolveLost = 1;
    }
  }
  resolveLost = Math.min(resolveLost, run.resolve);
  run.resolve -= resolveLost;

  let runOver = false;
  if (runWon) {
    run.over = 'won';
    runOver = true;
  } else if (run.resolve <= 0) {
    run.over = 'lost';
    runOver = true;
  }

  if (!bossRetry || runOver) markDone(run, node.id);
  run.battleInProgress = false;
  run.bossLastStandsUsed = 0;

  const notes: string[] = [];
  if (!runOver) {
    if (run.boons.includes('baggage_train')) run.pending.push({ kind: 'baggage', res: baggageFrom(result.unspent) });
    const survivors = cloneUnits(result.survivors ?? []);
    if (outcome === 'victory') run.rewardQueue.push(...rewardSteps(node, mods, result));
    if (outcome === 'victory' || outcome === 'retreat') {
      if (survivors.length > 0) run.rewardQueue.push(retinueStep(survivors));
      else run.retinue = [];
    }
    // Stragglers: a lost battle, or a Retreat with no soldier left standing, empties the Retinue.
    // Like Camp Drill on an empty Retinue, a few soldiers find their way back, so the next battle
    // (often a forced Elite) is not hopeless. Checked after the Retinue is settled above.
    const carried = outcome === 'retreat' ? survivors : [];
    if (!boss && outcome !== 'victory' && carried.length === 0 && run.retinue.length === 0) {
      run.sellswords.push(...makeUnits(CAMP.drillEmptyUnit, CAMP.drillEmptyCount, CAMP.drillEmptyRank));
      notes.push(`${STRAGGLERS_LABEL}: ${unitsLabel(CAMP.drillEmptyUnit, CAMP.drillEmptyCount, CAMP.drillEmptyRank)} fight beside you next battle.`);
    }
    materializeHead(run, meta);
  }

  const post: PostBattle = { outcome, crownsTotal: total, crownLines: lines, resolveLost, runOver, runWon };
  if (notes.length) post.notes = notes;
  run.lastBattle = post;
  saveRun(run);
  return post;
}
