/**
 * Run lifecycle: new run, node navigation, autosave and interrupted battles (GDD §B).
 */
import { Rng, randomSeed } from '../core/rng';
import { THORNBOUND_EFFECTS } from '../data';
import { getBriefing } from './briefing';
import { currentEventView, eventView, rollEvent } from './events';
import { availableHouses } from './meta';
import { generatePeddlerStock } from './peddler';
import { saveMeta, saveRun } from './persistence';
import { boonStep, queueStep } from './rewards';
import { generateRunMap } from './runmap';
import type { HouseId } from '../sim/types';
import type { MetaSave, NodeEntry, RunNode, RunState } from './types';
import { cloneUnits, consumeBattlePending, currentNodeOf, getNode, isBattleNode, markDone, maxResolveFor } from './util';

export interface NewRunOptions {
  house: HouseId;
  /** Thornbound tier 0..meta.tierUnlocked */
  tier: number;
  seed?: number;
}

/** Create + save a new run (increments meta.stats.runs). Opening Boon queues a Common pick. */
export function newRun(meta: MetaSave, opts: NewRunOptions): RunState {
  if (!availableHouses(meta).includes(opts.house)) throw new Error(`House "${opts.house}" is not unlocked`);
  const seed = (opts.seed ?? randomSeed()) >>> 0;
  const tier = Math.max(0, Math.min(meta.tierUnlocked, THORNBOUND_EFFECTS.maxTier, Math.floor(opts.tier || 0)));
  const maxResolve = maxResolveFor(meta);
  const run: RunState = {
    version: 1,
    seed,
    map: generateRunMap(seed).map,
    currentNode: null,
    nodesDone: [],
    house: opts.house,
    tier,
    boons: [],
    drafts: [],
    crowns: 0,
    resolve: maxResolve,
    maxResolve,
    retinue: [],
    sellswords: [],
    pending: [],
    eventsSeen: [],
    currentEvent: null,
    firstOfferDone: false,
    battleInProgress: false,
    retinueSnapshot: [],
    rewardQueue: [],
    peddler: null,
    extraTillers: 0,
    waveMult: 1,
    rngState: new Rng(seed).fork('run').getState(),
    stats: { battlesWon: 0, elitesWon: 0, nestsDestroyed: 0, nodesVisited: 0, kills: 0, crownsEarned: 0, timePlayed: 0 },
    over: null,
    profileRunIndex: meta.stats.runs,
  };
  if (meta.unlocks.includes('opening_boon')) {
    queueStep(run, meta, boonStep('Opening Boon', { source: 'opening', rarity: 'C' }, 'Choose a Common Boon to begin the march'));
  }
  meta.stats.runs += 1;
  saveMeta(meta);
  saveRun(run);
  return run;
}

/** Nodes the player may enter next (column 1 start node at run start). */
export function reachableNodes(run: RunState): RunNode[] {
  if (run.over) return [];
  const cur = currentNodeOf(run);
  if (!cur) return [run.map.nodes[run.map.startId]];
  if (!run.nodesDone.includes(cur.id)) return [cur];
  return cur.next.map((id) => run.map.nodes[id]).filter((n): n is RunNode => !!n);
}

/**
 * On Continue: if battleInProgress, resolve per §B Autosave (non-boss = Retreat with 0 plunder;
 * boss = −1 Resolve and restart with the same seed). Returns a message, or null if nothing happened.
 */
export function resolveInterruptedBattle(run: RunState, _meta: MetaSave): string | null {
  if (!run.battleInProgress) return null;
  const node = currentNodeOf(run);
  run.battleInProgress = false;
  if (!node || !isBattleNode(node)) {
    saveRun(run);
    return null;
  }
  // Last Stands spent before quitting are paid too, or quitting would refund them.
  const stands = node.type === 'boss' ? Math.max(0, Math.floor(run.bossLastStandsUsed ?? 0)) : 0;
  run.resolve = Math.max(0, run.resolve - 1 - stands);
  run.bossLastStandsUsed = 0;
  let msg: string;
  if (node.type === 'boss') {
    msg =
      stands > 0
        ? `The battle for the Briar Throne was abandoned. −${1 + stands} Resolve (1 for leaving the field, ${stands} for the Last Stand${stands > 1 ? 's' : ''} already spent).`
        : 'The battle for the Briar Throne was abandoned. −1 Resolve.';
    if (run.resolve <= 0) {
      run.over = 'lost';
      markDone(run, node.id);
      msg += ' The Last Flame gutters out. The march is over.';
    } else {
      msg += ' The Hearthband regroups before the Throne.';
    }
  } else {
    // Counts as a Retreat with no plunder: the Retinue is the node-entry snapshot.
    run.retinue = cloneUnits(run.retinueSnapshot);
    run.sellswords = [];
    consumeBattlePending(run);
    markDone(run, node.id);
    msg = 'The battle was abandoned and counts as a Retreat. −1 Resolve, no plunder.';
    if (run.resolve <= 0) {
      run.over = 'lost';
      msg += ' The Last Flame gutters out. The march is over.';
    }
  }
  saveRun(run);
  return msg;
}

/**
 * The battle screen reports Last Stands as the boss battle spends them, so an abandoned boss
 * battle can charge them on Continue. Only counts up, only while a boss battle is in progress.
 */
export function recordLastStands(run: RunState, used: number): void {
  if (!run.battleInProgress) return;
  const node = currentNodeOf(run);
  if (!node || node.type !== 'boss') return;
  const n = Math.max(0, Math.floor(used));
  if (n <= (run.bossLastStandsUsed ?? 0)) return;
  run.bossLastStandsUsed = n;
  saveRun(run);
}

function entryFor(run: RunState, meta: MetaSave, node: RunNode): NodeEntry {
  if (isBattleNode(node)) return { screen: 'briefing', briefing: getBriefing(run, meta, node.id) };
  if (node.type === 'event') {
    const view = currentEventView(run, meta) ?? (run.currentEvent ? eventView(run, meta, run.currentEvent) : null);
    if (view) return { screen: 'event', event: view };
    return { screen: 'camp' };
  }
  if (node.type === 'peddler') {
    if (!run.peddler) run.peddler = generatePeddlerStock(run, meta);
    return { screen: 'peddler', stock: run.peddler };
  }
  return { screen: 'camp' };
}

/** Enter a node (must be reachable): sets currentNode, autosaves, returns the screen to show. */
export function enterNode(run: RunState, meta: MetaSave, nodeId: string): NodeEntry {
  if (run.battleInProgress) resolveInterruptedBattle(run, meta);
  if (run.over) throw new Error('The run is over');
  if (!reachableNodes(run).some((n) => n.id === nodeId)) throw new Error(`Node "${nodeId}" is not reachable`);
  const node = getNode(run, nodeId);
  if (run.currentNode !== nodeId) {
    run.currentNode = nodeId;
    run.retinueSnapshot = cloneUnits(run.retinue);
    run.stats.nodesVisited += 1;
    run.currentEvent = null;
    run.peddler = null;
    if (node.type === 'event') {
      const ev = rollEvent(run);
      if (ev) {
        run.currentEvent = ev;
        run.eventsSeen.push(ev);
      } else {
        node.type = 'camp'; // §L: an Event node becomes a Camp once all six are used.
      }
    } else if (node.type === 'peddler') {
      run.peddler = generatePeddlerStock(run, meta);
    }
  }
  const entry = entryFor(run, meta, node);
  saveRun(run);
  return entry;
}

/** Leave the current non-battle node (marks it done). */
export function leaveNode(run: RunState): void {
  const node = currentNodeOf(run);
  if (!node || isBattleNode(node)) return;
  markDone(run, node.id);
  run.currentEvent = null;
  run.peddler = null;
  saveRun(run);
}
