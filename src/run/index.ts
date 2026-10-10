/**
 * Run layer + meta progression public API. OWNER: run agent.
 * Pure logic + localStorage persistence (all storage access wrapped in try/catch; works with no storage).
 * Screens (src/app) call ONLY these functions to drive the run.
 */
import type { BattleResult, BattleSetup, BoonId, DraftId, HouseId, MetaUnlockId, VanguardId } from '../sim/types';
import type {
  Briefing,
  EventOutcome,
  MetaSave,
  NodeEntry,
  PostBattle,
  RewardStep,
  RunNode,
  RunState,
  RunSummary,
} from './types';

// ---- Meta -----------------------------------------------------------------
export function loadMeta(): MetaSave {
  throw new Error('not implemented');
}
export function saveMeta(meta: MetaSave): void {
  throw new Error('not implemented');
}
export function defaultMeta(): MetaSave {
  throw new Error('not implemented');
}
export function canBuyUnlock(meta: MetaSave, id: MetaUnlockId): { ok: boolean; reason?: string } {
  throw new Error('not implemented');
}
/** Spend Renown; saves meta. Returns false if not allowed. */
export function buyUnlock(meta: MetaSave, id: MetaUnlockId): boolean {
  throw new Error('not implemented');
}
export function availableHouses(meta: MetaSave): HouseId[] {
  throw new Error('not implemented');
}

// ---- Run lifecycle --------------------------------------------------------
export interface NewRunOptions {
  house: HouseId;
  /** Thornbound tier 0..meta.tierUnlocked */
  tier: number;
  seed?: number;
}
/** Create + save a new run (increments meta.stats.runs). If Opening Boon is unlocked, rewardQueue starts with a Common pick. */
export function newRun(meta: MetaSave, opts: NewRunOptions): RunState {
  throw new Error('not implemented');
}
export function loadRun(): RunState | null {
  throw new Error('not implemented');
}
export function saveRun(run: RunState): void {
  throw new Error('not implemented');
}
export function clearRun(): void {
  throw new Error('not implemented');
}
/**
 * On Continue: if battleInProgress, resolve per GDD §B Autosave (non-boss = Retreat with 0 plunder; boss = -1 Resolve restart).
 * Returns a message to show, or null if nothing happened.
 */
export function resolveInterruptedBattle(run: RunState, meta: MetaSave): string | null {
  throw new Error('not implemented');
}

// ---- Map / nodes ----------------------------------------------------------
/** Nodes the player may enter next (column 1 start node at run start). */
export function reachableNodes(run: RunState): RunNode[] {
  throw new Error('not implemented');
}
/** Enter a node (must be reachable): sets currentNode, autosaves, returns the screen to show. */
export function enterNode(run: RunState, meta: MetaSave, nodeId: string): NodeEntry {
  throw new Error('not implemented');
}
export function getBriefing(run: RunState, meta: MetaSave, nodeId: string): Briefing {
  throw new Error('not implemented');
}
/** Build the BattleSetup for the current battle node, set battleInProgress, save. */
export function startBattle(run: RunState, meta: MetaSave, vanguard: VanguardId): BattleSetup {
  throw new Error('not implemented');
}
/**
 * Apply a battle result: Crowns, Resolve, stats, pending effects consumed, node done,
 * rewardQueue filled (victory: rewards then retinue; retreat: retinue), run over detection. Saves.
 */
export function finishBattle(run: RunState, meta: MetaSave, result: BattleResult): PostBattle {
  throw new Error('not implemented');
}

// ---- Rewards ----------------------------------------------------------------
export function currentReward(run: RunState): RewardStep | null {
  throw new Error('not implemented');
}
/**
 * Resolve the current reward step. For boon/draft: index of the chosen option or 'skip' (+skipCrowns).
 * For retinue: `picks` = indexes into candidates (must fit capPop). Saves. Returns the next step or null.
 */
export function chooseReward(run: RunState, meta: MetaSave, choice: number | 'skip', picks?: number[]): RewardStep | null {
  throw new Error('not implemented');
}
export function retinueCap(run: RunState, meta: MetaSave): number {
  throw new Error('not implemented');
}

// ---- Non-battle nodes ---------------------------------------------------------
export function chooseEventOption(run: RunState, meta: MetaSave, choiceId: string): EventOutcome {
  throw new Error('not implemented');
}
/** Camp: 'rest' | 'drill' | 'muster' (muster pushes a draft RewardStep). Marks node done. */
export function chooseCamp(run: RunState, meta: MetaSave, choice: 'rest' | 'drill' | 'muster'): EventOutcome {
  throw new Error('not implemented');
}
export function buyPeddlerItem(run: RunState, meta: MetaSave, index: number): { ok: boolean; reason?: string } {
  throw new Error('not implemented');
}
export function rerollPeddler(run: RunState, meta: MetaSave): { ok: boolean; reason?: string } {
  throw new Error('not implemented');
}
/** Leave the current non-battle node (marks it done). */
export function leaveNode(run: RunState): void {
  throw new Error('not implemented');
}

// ---- End ----------------------------------------------------------------------
/** Compute Renown, update meta (renown, stats, tier unlock), clear the run save. */
export function endRun(run: RunState, meta: MetaSave): RunSummary {
  throw new Error('not implemented');
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
  throw new Error('not implemented');
}

// ---- Display helpers ------------------------------------------------------------
export function boonInfo(id: BoonId): { name: string; desc: string; rarity: string; tags: string[]; kind: string } {
  throw new Error('not implemented');
}
export function draftInfo(id: DraftId): { name: string; desc: string; units: string[] } {
  throw new Error('not implemented');
}
