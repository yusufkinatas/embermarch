/**
 * Run layer + meta progression public API. OWNER: run agent.
 * Pure logic + localStorage persistence (all storage access wrapped in try/catch; works with no storage).
 * Screens (src/app) call ONLY these functions to drive the run.
 *
 * Typical flow (GDD §O):
 *   Title → Continue: run = loadRun(); msg = resolveInterruptedBattle(run, meta); if run.over → endRun;
 *     else if currentReward(run) show it; else re-enter an unfinished current node or show the Run Map
 *   Run Map: reachableNodes(run) → enterNode(run, meta, id) → NodeEntry screen
 *   Briefing → startBattle(run, meta, vanguard) → battle → finishBattle(run, meta, result) → Results (PostBattle)
 *   → while (currentReward(run)) chooseReward(...) → Run Map, or endRun(run, meta) when run.over
 */
import type { BattleResult, BattleSetup, BoonId, DraftId, HouseId, MetaUnlockId, VanguardId } from '../sim/types';
import * as briefing from './briefing';
import * as display from './display';
import * as events from './events';
import * as lifecycle from './lifecycle';
import * as metaMod from './meta';
import * as peddler from './peddler';
import * as persistence from './persistence';
import * as results from './results';
import * as rewards from './rewards';
import * as setup from './setup';
import type {
  Briefing,
  CampOption,
  EventOutcome,
  EventView,
  MetaSave,
  NodeEntry,
  PostBattle,
  RewardStep,
  RunNode,
  RunState,
  RunSummary,
} from './types';
import { retinueCapFor } from './util';

export { BEACONS_ENABLED, generateRunMap, runMapViolations } from './runmap';
export { MemoryStorage, setStorageBackend, META_KEY, RUN_KEY } from './storage';
export type { KeyValueStorage } from './storage';
export type { BoonInfo, DraftInfo } from './display';

// ---- Meta -----------------------------------------------------------------
export function loadMeta(): MetaSave {
  return persistence.loadMeta();
}
export function saveMeta(meta: MetaSave): void {
  persistence.saveMeta(meta);
}
export function defaultMeta(): MetaSave {
  return persistence.defaultMeta();
}
export function canBuyUnlock(meta: MetaSave, id: MetaUnlockId): { ok: boolean; reason?: string } {
  return metaMod.canBuyUnlock(meta, id);
}
/** Spend Renown; saves meta. Returns false if not allowed. */
export function buyUnlock(meta: MetaSave, id: MetaUnlockId): boolean {
  return metaMod.buyUnlock(meta, id);
}
export function availableHouses(meta: MetaSave): HouseId[] {
  return metaMod.availableHouses(meta);
}
/** Thornbound tiers selectable for a new run (0..meta.tierUnlocked). */
export function availableTiers(meta: MetaSave): number[] {
  return metaMod.availableTiers(meta);
}
/** Record a dismissed first-run hint (saves meta). */
export function markHintSeen(meta: MetaSave, id: string): void {
  metaMod.markHintSeen(meta, id);
}
/** Cheapest unlock the profile can work toward (Hall of Banners progress bar). */
export function nextUnlock(meta: MetaSave): RunSummary['nextUnlock'] {
  return metaMod.nextUnlock(meta);
}

// ---- Run lifecycle --------------------------------------------------------
export type { NewRunOptions } from './lifecycle';
/** Create + save a new run (increments meta.stats.runs). If Opening Boon is unlocked, rewardQueue starts with a Common pick. */
export function newRun(meta: MetaSave, opts: lifecycle.NewRunOptions): RunState {
  return lifecycle.newRun(meta, opts);
}
export function loadRun(): RunState | null {
  return persistence.loadRun();
}
export function saveRun(run: RunState): void {
  persistence.saveRun(run);
}
export function clearRun(): void {
  persistence.clearRun();
}
/**
 * On Continue: if battleInProgress, resolve per GDD §B Autosave (non-boss = Retreat with 0 plunder; boss = -1 Resolve restart).
 * Returns a message to show, or null if nothing happened.
 */
export function resolveInterruptedBattle(run: RunState, meta: MetaSave): string | null {
  return lifecycle.resolveInterruptedBattle(run, meta);
}

// ---- Map / nodes ----------------------------------------------------------
/** Nodes the player may enter next (column 1 start node at run start). */
export function reachableNodes(run: RunState): RunNode[] {
  return lifecycle.reachableNodes(run);
}
/** Enter a node (must be reachable): sets currentNode, autosaves, returns the screen to show. */
export function enterNode(run: RunState, meta: MetaSave, nodeId: string): NodeEntry {
  return lifecycle.enterNode(run, meta, nodeId);
}
export function getBriefing(run: RunState, meta: MetaSave, nodeId: string): Briefing {
  return briefing.getBriefing(run, meta, nodeId);
}
/** Build the BattleSetup for the current battle node, set battleInProgress, save. */
export function startBattle(run: RunState, meta: MetaSave, vanguard: VanguardId): BattleSetup {
  return setup.startBattle(run, meta, vanguard);
}
/**
 * Apply a battle result: Crowns, Resolve, stats, pending effects consumed, node done,
 * rewardQueue filled (victory: rewards then retinue; retreat: retinue), run over detection. Saves.
 */
export function finishBattle(run: RunState, meta: MetaSave, result: BattleResult): PostBattle {
  return results.finishBattle(run, meta, result);
}

// ---- Rewards ----------------------------------------------------------------
export function currentReward(run: RunState): RewardStep | null {
  return rewards.currentReward(run);
}
/**
 * Resolve the current reward step. For boon/draft: index of the chosen option or 'skip' (+skipCrowns).
 * For retinue: `picks` = indexes into candidates (must fit capPop). Saves. Returns the next step or null.
 */
export function chooseReward(run: RunState, meta: MetaSave, choice: number | 'skip', picks?: number[]): RewardStep | null {
  return rewards.chooseReward(run, meta, choice, picks);
}
export function retinueCap(run: RunState, meta: MetaSave): number {
  return retinueCapFor(run, meta);
}

// ---- Non-battle nodes ---------------------------------------------------------
/** The event at the current node (for re-rendering after a reload), or null. */
export function currentEventView(run: RunState, meta: MetaSave): EventView | null {
  return events.currentEventView(run, meta);
}
export function chooseEventOption(run: RunState, meta: MetaSave, choiceId: string): EventOutcome {
  return events.chooseEventOption(run, meta, choiceId);
}
/** Camp choices with descriptions resolved for the current run state. */
export function campOptions(run: RunState, meta: MetaSave): CampOption[] {
  return events.campOptions(run, meta);
}
/** Camp: 'rest' | 'drill' | 'muster' (muster pushes a draft RewardStep). Marks node done. */
export function chooseCamp(run: RunState, meta: MetaSave, choice: 'rest' | 'drill' | 'muster'): EventOutcome {
  return events.chooseCamp(run, meta, choice);
}
export function buyPeddlerItem(run: RunState, meta: MetaSave, index: number): { ok: boolean; reason?: string } {
  return peddler.buyPeddlerItem(run, meta, index);
}
export function rerollPeddler(run: RunState, meta: MetaSave): { ok: boolean; reason?: string } {
  return peddler.rerollPeddler(run, meta);
}
/** Leave the current non-battle node (marks it done). */
export function leaveNode(run: RunState): void {
  lifecycle.leaveNode(run);
}

// ---- End ----------------------------------------------------------------------
/** Compute Renown, update meta (renown, stats, tier unlock), clear the run save. */
export function endRun(run: RunState, meta: MetaSave): RunSummary {
  return metaMod.endRun(run, meta);
}

// ---- Quick battles (dev / tests) ---------------------------------------------------
/** Standalone BattleSetup without a run (used by ?battle= URL param, tests and the debug API). */
export function quickBattleSetup(opts: {
  objective: import('../sim/types').ObjectiveId;
  depth?: number;
  seed?: number;
  house?: HouseId;
  modifiers?: import('../sim/types').ModifierId[];
  boons?: BoonId[];
  drafts?: DraftId[];
  vanguard?: VanguardId;
}): BattleSetup {
  return setup.quickBattleSetup(opts);
}

// ---- Display helpers ------------------------------------------------------------
export function boonInfo(id: BoonId): { name: string; desc: string; rarity: string; tags: string[]; kind: string } & display.BoonInfo {
  return display.boonInfo(id);
}
export function draftInfo(id: DraftId): { name: string; desc: string; units: string[] } & display.DraftInfo {
  return display.draftInfo(id);
}
