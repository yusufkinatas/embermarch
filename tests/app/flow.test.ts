/**
 * Screen flow decisions against the real run API: New Run on a finished run banks it, battle
 * nodes preview before the route is committed, Begin Battle commits.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as api from '../../src/run';
import { MemoryStorage, chooseReward, currentReward, defaultMeta, enterNode, finishBattle, loadRun, newRun, reachableNodes, saveRun, setStorageBackend, startBattle } from '../../src/run';
import type { MetaSave, RunState } from '../../src/run/types';
import type { BattleResult } from '../../src/sim/types';
import { beginBattle, openNode, settleFinishedRun } from '../../src/app/logic/flow';

function victory(): BattleResult {
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
    stats: { gathered: { grain: 0, timber: 0, ember: 0 }, unitsTrained: 0, unitsLost: 0, kills: 12, buildingsBuilt: 0, buildingsLost: 0 },
  };
}

function drain(run: RunState, meta: MetaSave): void {
  for (let i = 0; i < 8 && currentReward(run); i++) {
    const s = currentReward(run)!;
    chooseReward(run, meta, s.kind === 'retinue' ? 0 : 'skip', s.kind === 'retinue' ? [] : undefined);
  }
}

/** A run whose start battle is won, with two column-2 battle nodes to choose from. */
function atColumnTwo(seed = 4004): { run: RunState; meta: MetaSave; a: string; b: string } {
  const meta = defaultMeta();
  const run = newRun(meta, { house: 'ardent', tier: 0, seed });
  enterNode(run, meta, 'start');
  startBattle(run, meta, 'muster_hall');
  finishBattle(run, meta, victory());
  drain(run, meta);
  const [a, b] = run.map.columns[1];
  for (const id of [a, b]) {
    const n = run.map.nodes[id];
    n.type = 'battle';
    n.battle = { objective: 'raze', biome: 'greenmarch', modifiers: [], reward: 'boon', doctrine: 'swarm', threat: 2, depth: 2, seed: 4000 + n.lane };
  }
  return { run, meta, a, b };
}

describe('New Run on a finished run (R1)', () => {
  beforeEach(() => setStorageBackend(new MemoryStorage()));

  it('banks Renown, the win and the Thornbound unlock of a run whose summary never showed, once', () => {
    const meta = defaultMeta();
    const live = newRun(meta, { house: 'ardent', tier: 0, seed: 77 });
    live.over = 'won';
    live.stats.battlesWon = 6;
    live.stats.nodesVisited = 9;
    live.nodesDone = [...live.map.columns.flat()].slice(0, 9);
    saveRun(live);
    // Closed on Results, reloaded: the saved run is over with no summary.
    const run = loadRun()!;
    expect(run.over).toBe('won');
    expect(run.summary).toBeUndefined();
    const before = { renown: meta.renown, wins: meta.stats.wins, tier: meta.tierUnlocked };
    expect(before).toEqual({ renown: 0, wins: 0, tier: 0 });

    const summary = settleFinishedRun(api, run, meta)!;
    expect(summary.won).toBe(true);
    expect(summary.renownTotal).toBeGreaterThan(0);
    expect(meta.renown).toBe(summary.renownTotal);
    expect(meta.stats.wins).toBe(1);
    expect(meta.tierUnlocked).toBe(1);
    expect(summary.tierUnlocked).toBe(1);
    expect(loadRun()).toBeNull(); // the save is cleared, so no second copy can be banked

    // Title's New Run and AppShell.startRun may both settle the same run: nothing is paid twice.
    expect(settleFinishedRun(api, run, meta)).toBe(summary);
    expect(meta.renown).toBe(summary.renownTotal);
    expect(meta.stats.wins).toBe(1);

    // ...and the new run starts from the banked profile.
    const next = newRun(meta, { house: 'ardent', tier: 1, seed: 78 });
    expect(next.tier).toBe(1);
    expect(next.profileRunIndex).toBe(1);
  });

  it('leaves live runs (Abandon asks first) and empty slots alone', () => {
    const meta = defaultMeta();
    const live = newRun(meta, { house: 'ardent', tier: 0, seed: 5 });
    expect(settleFinishedRun(api, live, meta)).toBeNull();
    expect(settleFinishedRun(api, null, meta)).toBeNull();
    expect(meta.renown).toBe(0);
    expect(loadRun()?.seed).toBe(5);
  });
});

describe('battle briefing preview (R2)', () => {
  beforeEach(() => setStorageBackend(new MemoryStorage()));

  it('previewing node A changes nothing; node B stays reachable and enterable', () => {
    const { run, meta, a, b } = atColumnTwo();
    const snapshot = JSON.stringify({ cur: run.currentNode, done: run.nodesDone, visited: run.stats.nodesVisited, snap: run.retinueSnapshot });
    const saved = JSON.stringify(loadRun());

    const entry = openNode(api, run, meta, a);
    expect(entry.screen).toBe('briefing');
    if (entry.screen === 'briefing') expect(entry.briefing.nodeId).toBe(a);
    expect(run.currentNode).toBe('start');
    expect(JSON.stringify({ cur: run.currentNode, done: run.nodesDone, visited: run.stats.nodesVisited, snap: run.retinueSnapshot })).toBe(snapshot);
    expect(JSON.stringify(loadRun())).toBe(saved);
    expect(reachableNodes(run).map((n) => n.id)).toEqual(expect.arrayContaining([a, b]));

    // Back, then march to B instead: Begin Battle commits the route and starts the battle.
    expect(openNode(api, run, meta, b).screen).toBe('briefing');
    const setup = beginBattle(api, run, meta, b, 'bowyard');
    expect(setup.nodeId).toBe(b);
    expect(setup.vanguard).toBe('bowyard');
    expect(run.currentNode).toBe(b);
    expect(run.battleInProgress).toBe(true);
    expect(run.stats.nodesVisited).toBe(2);
    expect(loadRun()?.currentNode).toBe(b);
    expect(reachableNodes(run).map((n) => n.id)).toEqual([b]);
    expect(() => openNode(api, run, meta, a)).toThrow(/not reachable/);
  });

  it('a legacy save that already entered a battle opens its briefing and begins without double counting', () => {
    const { run, meta, a } = atColumnTwo(5005);
    enterNode(run, meta, a); // the old map click committed on open
    expect(run.stats.nodesVisited).toBe(2);
    expect(openNode(api, run, meta, a).screen).toBe('briefing');
    beginBattle(api, run, meta, a, 'muster_hall');
    expect(run.stats.nodesVisited).toBe(2);
    expect(run.battleInProgress).toBe(true);
  });

  it('Event, Peddler and Camp nodes still commit on open (entering rolls their content)', () => {
    const { run, meta, a } = atColumnTwo(6006);
    const n = run.map.nodes[a];
    n.type = 'camp';
    n.battle = null;
    expect(openNode(api, run, meta, a).screen).toBe('camp');
    expect(run.currentNode).toBe(a);
    expect(run.stats.nodesVisited).toBe(2);
  });
});
