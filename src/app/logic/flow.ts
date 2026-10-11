/**
 * Run-flow decisions the screens share (no DOM), kept here so they can be tested against the real
 * run API: settling a finished run before a new one, previewing a battle node from the map, and
 * committing the route only on Begin Battle.
 */
import type { RunApi } from '../api';
import type { BattleSetup, VanguardId } from '../../sim/types';
import type { MetaSave, NodeEntry, RunState, RunSummary } from '../../run/types';

type Api = Pick<RunApi, 'endRun' | 'enterNode' | 'getBriefing' | 'reachableNodes' | 'startBattle'>;

/**
 * Bank a run that ended but never showed its March End (closed or reloaded on Results, or a
 * crash): Renown, win, kills, best depth and the Thornbound unlock. endRun is idempotent per run
 * object (run.summary) and clears the save, so this is safe to call more than once.
 * Returns the summary, or null if there was nothing to settle.
 */
export function settleFinishedRun(api: Pick<RunApi, 'endRun'>, run: RunState | null, meta: MetaSave): RunSummary | null {
  if (!run || !run.over) return null;
  return api.endRun(run, meta);
}

const isBattle = (type: string): boolean => type === 'battle' || type === 'elite' || type === 'boss';

/**
 * Open a reachable node from the map. Battle, Elite and Boss nodes open a preview briefing
 * (getBriefing is pure, so Back changes nothing). Event, Peddler and Camp nodes are entered at
 * once because entering rolls their content.
 */
export function openNode(api: Api, run: RunState, meta: MetaSave, nodeId: string): NodeEntry {
  if (!api.reachableNodes(run).some((n) => n.id === nodeId)) throw new Error(`Node "${nodeId}" is not reachable`);
  const node = run.map.nodes[nodeId];
  if (node && isBattle(node.type)) return { screen: 'briefing', briefing: api.getBriefing(run, meta, nodeId) };
  return api.enterNode(run, meta, nodeId);
}

/**
 * Begin Battle: commit the route to the node (enterNode is a no-op for the current node, as for a
 * legacy save that entered it before previews existed), then build the BattleSetup.
 */
export function beginBattle(api: Api, run: RunState, meta: MetaSave, nodeId: string, vanguard: VanguardId): BattleSetup {
  api.enterNode(run, meta, nodeId);
  return api.startBattle(run, meta, vanguard);
}
