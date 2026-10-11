/**
 * Small shared helpers for the run layer: the run RNG, carried units, node lookups.
 */
import { Rng } from '../core/rng';
import { RESOLVE, RETINUE, UNITS, VETERANCY } from '../data';
import type { BoonId, CarriedUnit, PlayerBuildingId, PlayerUnitId } from '../sim/types';
import type { MetaSave, PendingEffect, RunNode, RunState } from './types';

/** Core units available in every battle (§F "Unlocked by: Core"). */
export const CORE_UNITS: readonly PlayerUnitId[] = ['tiller', 'warden', 'ashpike', 'bowman', 'courser'];
/** Core buildings (§E). The Siegeyard comes with the Siegecraft draft. */
export const CORE_BUILDINGS: readonly PlayerBuildingId[] = [
  'hearth',
  'cottage',
  'storehouse',
  'grainplot',
  'muster_hall',
  'bowyard',
  'paddock',
  'forgehall',
  'brazier_tower',
];

/** Run `fn` with the run RNG and write the advanced state back (reloads stay deterministic). */
export function withRng<T>(run: RunState, fn: (rng: Rng) => T): T {
  const rng = new Rng(1);
  rng.setState(run.rngState);
  const out = fn(rng);
  run.rngState = rng.getState();
  return out;
}

export function clampRank(r: number): 0 | 1 | 2 | 3 {
  return Math.max(0, Math.min(VETERANCY.maxRank, Math.floor(r))) as 0 | 1 | 2 | 3;
}

/** Kills needed to hold a rank (keeps `rank` and kill-derived rank consistent in the sim). */
export function killsForRank(rank: number): number {
  return rank <= 0 ? 0 : VETERANCY.thresholds[Math.min(rank, VETERANCY.maxRank) - 1];
}

/** Copy of a unit raised to at least `rank` (kills raised to that rank's threshold). */
export function atLeastRank(u: CarriedUnit, rank: number): CarriedUnit {
  const r = clampRank(Math.max(u.rank, rank));
  return { type: u.type, rank: r, kills: Math.max(u.kills, killsForRank(r)) };
}

/** Copy of a unit with +n ranks (max III). */
export function rankedUp(u: CarriedUnit, n: number): CarriedUnit {
  return atLeastRank(u, u.rank + n);
}

export function makeUnits(type: PlayerUnitId, count: number, rank: number): CarriedUnit[] {
  const r = clampRank(rank);
  return Array.from({ length: count }, () => ({ type, rank: r, kills: killsForRank(r) }));
}

export function unitPop(type: PlayerUnitId): number {
  return UNITS[type].pop;
}

export function popOf(units: readonly CarriedUnit[]): number {
  let p = 0;
  for (const u of units) p += unitPop(u.type);
  return p;
}

export function cloneUnits(units: readonly CarriedUnit[]): CarriedUnit[] {
  return units.map((u) => ({ type: u.type, rank: u.rank, kills: u.kills }));
}

export function hasBoon(run: RunState, id: BoonId): boolean {
  return run.boons.includes(id);
}

/** Retinue cap in pop: 6, +3 Veteran's Oath, +3 Seasoned Retinue (max 12). */
export function retinueCapFor(run: RunState, meta: MetaSave): number {
  let cap = RETINUE.baseCap;
  if (run.boons.includes('veterans_oath')) cap += RETINUE.veteransOathBonus;
  if (meta.unlocks.includes('seasoned_retinue')) cap += RETINUE.seasonedRetinueBonus;
  return Math.min(RETINUE.maxCap, cap);
}

export function maxResolveFor(meta: MetaSave): number {
  return meta.unlocks.includes('fourth_banner') ? RESOLVE.fourthBannerMax : RESOLVE.max;
}

export function getNode(run: RunState, nodeId: string): RunNode {
  const n = run.map.nodes[nodeId];
  if (!n) throw new Error(`Unknown run node "${nodeId}"`);
  return n;
}

export function currentNodeOf(run: RunState): RunNode | null {
  return run.currentNode ? (run.map.nodes[run.currentNode] ?? null) : null;
}

export function isBattleNode(n: RunNode): boolean {
  return n.type === 'battle' || n.type === 'elite' || n.type === 'boss';
}

/** True if a Battle or Elite (not the boss) can still be reached after the current node. */
export function nonBossBattleAhead(run: RunState): boolean {
  const cur = currentNodeOf(run);
  let frontier = cur ? cur.next : [run.map.startId];
  const seen = new Set<string>();
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      const n = run.map.nodes[id];
      if (!n) continue;
      if (n.type === 'battle' || n.type === 'elite') return true;
      next.push(...n.next);
    }
    frontier = next;
  }
  return false;
}

export function markDone(run: RunState, nodeId: string): void {
  if (!run.nodesDone.includes(nodeId)) run.nodesDone.push(nodeId);
}

export function findPending<K extends PendingEffect['kind']>(
  run: RunState,
  kind: K,
): Extract<PendingEffect, { kind: K }> | undefined {
  return run.pending.find((p) => p.kind === kind) as Extract<PendingEffect, { kind: K }> | undefined;
}

/** Pending effects consumed by the next battle (everything except reward_plus_one). */
export function consumeBattlePending(run: RunState): void {
  run.pending = run.pending.filter((p) => p.kind === 'reward_plus_one');
}

export function addCrowns(run: RunState, amount: number): void {
  run.crowns = Math.max(0, run.crowns + Math.round(amount));
}
