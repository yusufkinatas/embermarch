/**
 * Pure Retinue selection helpers (no DOM).
 */
import type { CarriedUnit } from '../../sim/types';
import { UNITS } from '../../data/units';

export function unitPop(u: CarriedUnit): number {
  return UNITS[u.type]?.pop ?? 1;
}

export function popOf(candidates: readonly CarriedUnit[], picks: Iterable<number>): number {
  let sum = 0;
  for (const i of picks) {
    const u = candidates[i];
    if (u) sum += unitPop(u);
  }
  return sum;
}

/**
 * Greedy "best veterans" pick: highest rank first, then kills, then cheaper pop, filling up to cap.
 * Returns candidate indexes in ascending order.
 */
export function bestPicks(candidates: readonly CarriedUnit[], cap: number): number[] {
  const order = candidates
    .map((u, i) => ({ u, i }))
    .sort((a, b) => b.u.rank - a.u.rank || b.u.kills - a.u.kills || unitPop(a.u) - unitPop(b.u) || a.i - b.i);
  const picks: number[] = [];
  let pop = 0;
  for (const { u, i } of order) {
    const p = unitPop(u);
    if (pop + p <= cap) {
      picks.push(i);
      pop += p;
    }
  }
  return picks.sort((a, b) => a - b);
}

/** Whether toggling candidate i on keeps the pick within the cap. */
export function canAdd(candidates: readonly CarriedUnit[], picks: ReadonlySet<number>, i: number, cap: number): boolean {
  if (picks.has(i)) return true;
  return popOf(candidates, picks) + unitPop(candidates[i]) <= cap;
}
