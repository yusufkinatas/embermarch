/**
 * Shared fixtures for run-layer tests: in-memory storage, results, and node forcing.
 */
import { EVENT_IDS } from '../../src/data';
import { MemoryStorage, defaultMeta, enterNode, newRun, setStorageBackend } from '../../src/run';
import type { BattleNodeInfo, MetaSave, NodeEntry, NodeType, RunNode, RunState } from '../../src/run/types';
import type { BattleResult, CarriedUnit, EventId, HouseId, MetaUnlockId } from '../../src/sim/types';

export function useMemoryStorage(): MemoryStorage {
  const mem = new MemoryStorage();
  setStorageBackend(mem);
  return mem;
}

export function metaWith(unlocks: MetaUnlockId[] = [], renown = 0): MetaSave {
  const m = defaultMeta();
  m.unlocks = [...unlocks];
  m.renown = renown;
  return m;
}

export function freshRun(opts: { meta?: MetaSave; house?: HouseId; tier?: number; seed?: number } = {}): { run: RunState; meta: MetaSave } {
  const meta = opts.meta ?? metaWith(['house_tallow', 'house_grimbrand', 'house_lowmere']);
  if (opts.tier) meta.tierUnlocked = Math.max(meta.tierUnlocked, opts.tier);
  const run = newRun(meta, { house: opts.house ?? 'ardent', tier: opts.tier ?? 0, seed: opts.seed ?? 12345 });
  return { run, meta };
}

export function mkResult(o: Partial<BattleResult> = {}): BattleResult {
  return {
    outcome: 'victory',
    time: 300,
    objective: 'raze',
    depth: 1,
    plunderCrowns: 0,
    underPar: false,
    unbroken: false,
    uprooted: false,
    nestsDestroyed: 2,
    picketsDestroyed: 0,
    cachesLooted: 0,
    ancientCacheLooted: false,
    lordSlain: false,
    regentSlain: false,
    lastStandsUsed: 0,
    survivors: [],
    unspent: { grain: 0, timber: 0, ember: 0 },
    stats: {
      gathered: { grain: 0, timber: 0, ember: 0 },
      unitsTrained: 0,
      unitsLost: 0,
      kills: 10,
      buildingsBuilt: 0,
      buildingsLost: 0,
    },
    ...o,
  };
}

export function units(type: CarriedUnit['type'], n: number, rank: 0 | 1 | 2 | 3 = 0, kills = 0): CarriedUnit[] {
  return Array.from({ length: n }, () => ({ type, rank, kills }));
}

export function battleInfo(o: Partial<BattleNodeInfo> = {}): BattleNodeInfo {
  return {
    objective: 'raze',
    biome: 'greenmarch',
    modifiers: [],
    reward: 'boon',
    doctrine: 'swarm',
    threat: 2,
    depth: 2,
    seed: 777,
    ...o,
  };
}

/**
 * Put the run right after the start node and turn a column-2 node into the requested type,
 * then enter it. For 'event', `event` picks which event is rolled.
 */
export function forceNode(
  run: RunState,
  meta: MetaSave,
  type: NodeType,
  o: { battle?: Partial<BattleNodeInfo>; event?: EventId } = {},
): { node: RunNode; entry: NodeEntry } {
  if (!run.nodesDone.includes(run.map.startId)) run.nodesDone.push(run.map.startId);
  run.currentNode = run.map.startId;
  const id = run.map.nodes[run.map.startId].next[0];
  const node = run.map.nodes[id];
  node.type = type;
  node.battle = type === 'battle' || type === 'elite' || type === 'boss' ? battleInfo({ depth: node.col, ...o.battle }) : null;
  if (type === 'elite' && node.battle) node.battle.objective = o.battle?.objective ?? 'elite';
  if (type === 'boss' && node.battle) {
    node.battle.objective = 'boss';
    node.battle.depth = 7;
  }
  if (type === 'event' && o.event) run.eventsSeen = EVENT_IDS.filter((e) => e !== o.event);
  const entry = enterNode(run, meta, id);
  return { node, entry };
}
