/**
 * Meta progression (GDD §N): Renown, unlocks, Houses, Thornbound tiers, Run Summary.
 */
import { HOUSES, HOUSE_IDS, META_UNLOCKS, META_UNLOCK_ORDER, RENOWN, THORNBOUND_EFFECTS, renownTotal } from '../data';
import type { HouseId, MetaUnlockId } from '../sim/types';
import { clearRun, saveMeta } from './persistence';
import type { CrownLine, MetaSave, RunState, RunSummary } from './types';

export function canBuyUnlock(meta: MetaSave, id: MetaUnlockId): { ok: boolean; reason?: string } {
  const def = META_UNLOCKS[id];
  if (!def) return { ok: false, reason: 'Unknown unlock' };
  if (meta.unlocks.includes(id)) return { ok: false, reason: 'Already unlocked' };
  if (def.requires && !meta.unlocks.includes(def.requires)) {
    return { ok: false, reason: `Requires ${META_UNLOCKS[def.requires].name}` };
  }
  if (meta.renown < def.cost) return { ok: false, reason: `Requires ${def.cost} Renown` };
  return { ok: true };
}

/** Spend Renown; saves meta. Returns false if not allowed. */
export function buyUnlock(meta: MetaSave, id: MetaUnlockId): boolean {
  if (!canBuyUnlock(meta, id).ok) return false;
  meta.renown -= META_UNLOCKS[id].cost;
  meta.unlocks.push(id);
  saveMeta(meta);
  return true;
}

/** Ardent is free; Tallow / Grimbrand / Lowmere need their unlock. */
export function availableHouses(meta: MetaSave): HouseId[] {
  return HOUSE_IDS.filter((h) => {
    const u = HOUSES[h].unlock;
    return u === null || meta.unlocks.includes(u);
  });
}

/** Thornbound tiers selectable for a new run (0..tierUnlocked). */
export function availableTiers(meta: MetaSave): number[] {
  return Array.from({ length: Math.min(THORNBOUND_EFFECTS.maxTier, meta.tierUnlocked) + 1 }, (_, i) => i);
}

export function markHintSeen(meta: MetaSave, id: string): void {
  if (!meta.hintsSeen.includes(id)) {
    meta.hintsSeen.push(id);
    saveMeta(meta);
  }
}

/** Renown for a run (§N) with itemized lines. */
export function renownFor(run: RunState): { lines: CrownLine[]; total: number } {
  const s = run.stats;
  const regent = run.over === 'won';
  const lines: CrownLine[] = [];
  const add = (label: string, amount: number) => {
    if (amount > 0) lines.push({ label, amount });
  };
  add(`Battles won (${s.battlesWon} × ${RENOWN.battleWon})`, s.battlesWon * RENOWN.battleWon);
  add(`Elites won (${s.elitesWon} × ${RENOWN.eliteWon})`, s.elitesWon * RENOWN.eliteWon);
  add('The Briar Regent slain', regent ? RENOWN.regentSlain : 0);
  add(`Nests burned (${s.nestsDestroyed} × ${RENOWN.nestDestroyed})`, s.nestsDestroyed * RENOWN.nestDestroyed);
  add(`Nodes visited (${s.nodesVisited} × ${RENOWN.nodeVisited})`, s.nodesVisited * RENOWN.nodeVisited);
  const total = renownTotal({
    battlesWon: s.battlesWon,
    elitesWon: s.elitesWon,
    regentSlain: regent,
    nests: s.nestsDestroyed,
    nodes: s.nodesVisited,
    tier: run.tier,
  });
  const raw = lines.reduce((a, l) => a + l.amount, 0);
  if (total !== raw) lines.push({ label: `Thornbound ${'I'.repeat(run.tier)} (+${Math.round(RENOWN.tierPct * 100 * run.tier)}%)`, amount: total - raw });
  return { lines, total };
}

/** Deepest column the run reached (1-8). */
export function depthReached(run: RunState): number {
  let d = 0;
  for (const id of [...run.nodesDone, ...(run.currentNode ? [run.currentNode] : [])]) {
    d = Math.max(d, run.map.nodes[id]?.col ?? 0);
  }
  return d;
}

/** The cheapest unowned unlock whose prerequisite is met (ties: Hall of Banners order). */
export function nextUnlock(meta: MetaSave): RunSummary['nextUnlock'] {
  let best: MetaUnlockId | null = null;
  for (const id of META_UNLOCK_ORDER) {
    const def = META_UNLOCKS[id];
    if (meta.unlocks.includes(id)) continue;
    if (def.requires && !meta.unlocks.includes(def.requires)) continue;
    if (best === null || def.cost < META_UNLOCKS[best].cost) best = id;
  }
  if (!best) return null;
  const def = META_UNLOCKS[best];
  return { id: best, name: def.name, cost: def.cost, remaining: Math.max(0, def.cost - meta.renown) };
}

/** Compute Renown, update meta (renown, stats, tier unlock), clear the run save. Idempotent per run. */
export function endRun(run: RunState, meta: MetaSave): RunSummary {
  if (run.summary) return run.summary;
  const won = run.over === 'won';
  const renown = renownFor(run);
  meta.renown += renown.total;
  meta.stats.totalRenown += renown.total;
  meta.stats.kills += run.stats.kills;
  if (won) meta.stats.wins += 1;
  const depth = depthReached(run);
  meta.stats.bestDepth = Math.max(meta.stats.bestDepth, depth);
  let tierUnlocked: number | null = null;
  if (won && run.tier >= meta.tierUnlocked && meta.tierUnlocked < THORNBOUND_EFFECTS.maxTier) {
    meta.tierUnlocked = Math.min(THORNBOUND_EFFECTS.maxTier, run.tier + 1);
    tierUnlocked = meta.tierUnlocked;
  }
  saveMeta(meta);
  clearRun();
  if (!run.over) run.over = 'lost';
  const summary: RunSummary = {
    won,
    renownLines: renown.lines,
    renownTotal: renown.total,
    stats: { ...run.stats },
    depthReached: depth,
    nextUnlock: nextUnlock(meta),
    tierUnlocked,
  };
  run.summary = summary;
  return summary;
}
