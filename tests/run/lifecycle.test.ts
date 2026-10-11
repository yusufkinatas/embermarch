import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  META_KEY,
  RUN_KEY,
  chooseReward,
  clearRun,
  currentReward,
  defaultMeta,
  enterNode,
  finishBattle,
  loadMeta,
  loadRun,
  reachableNodes,
  resolveInterruptedBattle,
  retinueCap,
  saveMeta,
  setStorageBackend,
  startBattle,
} from '../../src/run';
import type { KeyValueStorage } from '../../src/run';
import { forceNode, freshRun, metaWith, mkResult, units, useMemoryStorage } from './helpers';

describe('storage (§N)', () => {
  afterEach(() => setStorageBackend(null));

  it('round-trips meta and run through the injected storage', () => {
    const mem = useMemoryStorage();
    const meta = metaWith(['codex_1'], 55);
    meta.settings.muted = true;
    saveMeta(meta);
    expect(mem.keys()).toContain(META_KEY);
    expect(loadMeta()).toEqual(meta);

    const { run } = freshRun({ meta });
    expect(mem.keys()).toContain(RUN_KEY);
    expect(loadRun()).toEqual(JSON.parse(JSON.stringify(run)));
    clearRun();
    expect(loadRun()).toBeNull();
  });

  it('resets to defaults on version mismatch or garbage', () => {
    const mem = useMemoryStorage();
    mem.setItem(META_KEY, JSON.stringify({ version: 2, renown: 999 }));
    expect(loadMeta()).toEqual(defaultMeta());
    mem.setItem(META_KEY, '{not json');
    expect(loadMeta()).toEqual(defaultMeta());
    mem.setItem(RUN_KEY, JSON.stringify({ version: 2 }));
    expect(loadRun()).toBeNull();
    mem.setItem(RUN_KEY, JSON.stringify({ version: 1, map: {} }));
    expect(loadRun()).toBeNull();
  });

  it('sanitizes partial meta (unknown unlocks dropped, missing settings defaulted)', () => {
    const mem = useMemoryStorage();
    mem.setItem(META_KEY, JSON.stringify({ version: 1, renown: 12, unlocks: ['codex_1', 'bogus'], settings: { muted: true } }));
    const m = loadMeta();
    expect(m.renown).toBe(12);
    expect(m.unlocks).toEqual(['codex_1']);
    expect(m.settings.muted).toBe(true);
    expect(m.settings.showHints).toBe(true);
    expect(m.stats.runs).toBe(0);
  });

  it('keeps working when storage throws (falls back to memory)', () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    setStorageBackend(broken);
    const meta = metaWith([], 7);
    expect(() => saveMeta(meta)).not.toThrow();
    expect(loadMeta().renown).toBe(7);
    const { run } = freshRun({ meta });
    expect(loadRun()?.seed).toBe(run.seed);
    expect(() => clearRun()).not.toThrow();
    expect(loadRun()).toBeNull();
  });

  it('works with no storage at all (Node: no localStorage)', () => {
    setStorageBackend(null);
    const meta = metaWith([], 3);
    saveMeta(meta);
    expect(loadMeta().renown).toBe(3);
  });
});

describe('run lifecycle (§B)', () => {
  beforeEach(() => useMemoryStorage());

  it('newRun: 3 Resolve, Draft-reward start node reachable, run counter incremented', () => {
    const meta = metaWith();
    const { run } = freshRun({ meta });
    expect(run.resolve).toBe(3);
    expect(run.maxResolve).toBe(3);
    expect(run.profileRunIndex).toBe(0);
    expect(meta.stats.runs).toBe(1);
    expect(reachableNodes(run).map((n) => n.id)).toEqual(['start']);
    expect(currentReward(run)).toBeNull();
    const second = freshRun({ meta, seed: 2 }).run;
    expect(second.profileRunIndex).toBe(1);
  });

  it('enterNode only allows reachable nodes; re-entering the current node is stable', () => {
    const { run, meta } = freshRun();
    const firstCol2 = run.map.columns[1][0];
    expect(() => enterNode(run, meta, firstCol2)).toThrow(/not reachable/);
    const e = enterNode(run, meta, 'start');
    expect(e.screen).toBe('briefing');
    expect(run.stats.nodesVisited).toBe(1);
    expect(enterNode(run, meta, 'start').screen).toBe('briefing');
    expect(run.stats.nodesVisited).toBe(1);
    expect(reachableNodes(run).map((n) => n.id)).toEqual(['start']);
    finishBattle(run, meta, mkResult());
    expect(reachableNodes(run).map((n) => n.id).sort()).toEqual([...run.map.columns[1]].sort());
  });

  it('save/load mid-run reproduces later random rolls (rngState persisted)', () => {
    const { run, meta } = freshRun({ seed: 777 });
    enterNode(run, meta, 'start');
    finishBattle(run, meta, mkResult());
    const loaded = loadRun()!;
    expect(loaded).toEqual(JSON.parse(JSON.stringify(run)));
    const a = chooseReward(run, meta, 0);
    const b = chooseReward(loaded, meta, 0);
    expect(b).toEqual(a);
    expect(loaded.rngState).toBe(run.rngState);
  });

  it('a won battle marks the node done and queues rewards then the Retinue pick', () => {
    const { run, meta } = freshRun();
    enterNode(run, meta, 'start');
    const setup = startBattle(run, meta, 'muster_hall');
    expect(setup.objective).toBe('raze');
    expect(run.battleInProgress).toBe(true);
    expect(loadRun()?.battleInProgress).toBe(true);
    const post = finishBattle(run, meta, mkResult({ survivors: units('bowman', 3, 1, 4) }));
    expect(post.outcome).toBe('victory');
    expect(post.resolveLost).toBe(0);
    expect(run.battleInProgress).toBe(false);
    expect(run.nodesDone).toContain('start');
    expect(run.rewardQueue.map((s) => s.kind)).toEqual(['draft', 'retinue']);
    expect(run.stats.battlesWon).toBe(1);
    expect(run.stats.nestsDestroyed).toBe(2);
    expect(run.stats.kills).toBe(10);
    // finishBattle is idempotent once applied.
    expect(finishBattle(run, meta, mkResult())).toEqual(post);
    expect(run.stats.battlesWon).toBe(1);
  });

  it('Retreat: −1 Resolve, plunder only, Retinue pick from survivors only', () => {
    const { run, meta } = freshRun();
    forceNode(run, meta, 'battle', { battle: { reward: 'boon' } });
    run.sellswords = units('courser', 2, 1, 3);
    const post = finishBattle(run, meta, mkResult({ outcome: 'retreat', plunderCrowns: 15, survivors: units('ashpike', 4) }));
    expect(post.resolveLost).toBe(1);
    expect(run.resolve).toBe(2);
    expect(post.crownsTotal).toBe(15);
    expect(run.sellswords).toEqual([]);
    expect(run.rewardQueue.map((s) => s.kind)).toEqual(['retinue']);
    expect(run.nodesDone).toContain(run.currentNode);
  });

  it('Defeat: −1 Resolve, no reward, Retinue lost, node done; Resolve 0 ends the run', () => {
    const { run, meta } = freshRun();
    run.retinue = units('ashpike', 3, 2, 8);
    run.resolve = 1;
    forceNode(run, meta, 'battle');
    const post = finishBattle(run, meta, mkResult({ outcome: 'defeat', plunderCrowns: 40, survivors: units('bowman', 2) }));
    expect(post.crownsTotal).toBe(0);
    expect(run.retinue).toEqual([]);
    expect(run.rewardQueue).toEqual([]);
    expect(run.resolve).toBe(0);
    expect(post.runOver).toBe(true);
    expect(post.runWon).toBe(false);
    expect(run.over).toBe('lost');
    expect(reachableNodes(run)).toEqual([]);
  });

  it('boss victory wins the run (Last Stands spent are subtracted)', () => {
    const { run, meta } = freshRun();
    forceNode(run, meta, 'boss');
    const post = finishBattle(run, meta, mkResult({ objective: 'boss', regentSlain: true, lastStandsUsed: 2 }));
    expect(post.runWon).toBe(true);
    expect(post.runOver).toBe(true);
    expect(post.resolveLost).toBe(2);
    expect(run.resolve).toBe(1);
    expect(run.over).toBe('won');
    expect(run.rewardQueue).toEqual([]);
  });

  it('boss defeat after spending every Last Stand ends the run', () => {
    const { run, meta } = freshRun();
    forceNode(run, meta, 'boss');
    const post = finishBattle(run, meta, mkResult({ outcome: 'defeat', objective: 'boss', lastStandsUsed: 3 }));
    expect(post.runOver).toBe(true);
    expect(run.over).toBe('lost');
    expect(run.resolve).toBe(0);
  });

  it('boss defeat with Resolve left (no Last Stand applied) restarts the boss at −1 Resolve', () => {
    const { run, meta } = freshRun();
    const { node } = forceNode(run, meta, 'boss');
    const post = finishBattle(run, meta, mkResult({ outcome: 'defeat', objective: 'boss', lastStandsUsed: 0 }));
    expect(post.runOver).toBe(false);
    expect(run.resolve).toBe(2);
    expect(run.nodesDone).not.toContain(node.id);
    expect(reachableNodes(run).map((n) => n.id)).toEqual([node.id]);
  });
});

describe('interrupted battles (§B Autosave)', () => {
  beforeEach(() => useMemoryStorage());

  it('non-boss: counts as a Retreat with 0 plunder and the node-entry Retinue snapshot', () => {
    const { run, meta } = freshRun();
    run.retinue = units('ashpike', 2, 1, 3);
    run.pending.push({ kind: 'cold_watchfire' }, { kind: 'reward_plus_one', picks: 2 });
    run.sellswords = units('bowman', 3, 1, 3);
    const { node } = forceNode(run, meta, 'battle');
    expect(run.retinueSnapshot).toEqual(units('ashpike', 2, 1, 3));
    startBattle(run, meta, 'bowyard');
    run.retinue = []; // simulate a later mutation that must not stick
    const crowns = run.crowns;

    const reloaded = loadRun()!;
    reloaded.retinue = [];
    const msg = resolveInterruptedBattle(reloaded, meta);
    expect(msg).toMatch(/Retreat/);
    expect(reloaded.resolve).toBe(2);
    expect(reloaded.crowns).toBe(crowns);
    expect(reloaded.retinue).toEqual(units('ashpike', 2, 1, 3));
    expect(reloaded.sellswords).toEqual([]);
    expect(reloaded.nodesDone).toContain(node.id);
    expect(reloaded.battleInProgress).toBe(false);
    expect(reloaded.pending).toEqual([{ kind: 'reward_plus_one', picks: 2 }]);
    expect(resolveInterruptedBattle(reloaded, meta)).toBeNull();
    expect(loadRun()?.battleInProgress).toBe(false);
  });

  it('boss: −1 Resolve and the same boss battle (same seed) is fought again; 0 Resolve ends the run', () => {
    const { run, meta } = freshRun();
    const { node } = forceNode(run, meta, 'boss');
    const s1 = startBattle(run, meta, 'muster_hall');
    const msg = resolveInterruptedBattle(run, meta);
    expect(msg).toMatch(/−1 Resolve/);
    expect(run.resolve).toBe(2);
    expect(run.nodesDone).not.toContain(node.id);
    expect(reachableNodes(run).map((n) => n.id)).toEqual([node.id]);
    expect(enterNode(run, meta, node.id).screen).toBe('briefing');
    const s2 = startBattle(run, meta, 'muster_hall');
    expect(s2.seed).toBe(s1.seed);
    expect(s2.resolve).toBe(2);
    run.resolve = 1;
    resolveInterruptedBattle(run, meta);
    expect(run.over).toBe('lost');
  });

  it('a final non-boss interruption at 1 Resolve ends the run', () => {
    const { run, meta } = freshRun();
    run.resolve = 1;
    forceNode(run, meta, 'battle');
    startBattle(run, meta, 'storehouse');
    expect(resolveInterruptedBattle(run, meta)).toMatch(/over/);
    expect(run.over).toBe('lost');
  });
});

describe('Retinue (§B)', () => {
  beforeEach(() => useMemoryStorage());

  const winWith = (survivors: ReturnType<typeof units>, o: { boons?: string[]; unlocks?: string[]; house?: 'ardent' | 'grimbrand' } = {}) => {
    const meta = metaWith(['house_grimbrand', ...((o.unlocks ?? []) as never[])]);
    const { run } = freshRun({ meta, house: o.house });
    run.boons = (o.boons ?? []) as never[];
    forceNode(run, meta, 'battle', { battle: { reward: 'boon' } });
    finishBattle(run, meta, mkResult({ survivors }));
    // Skip the reward to reach the Retinue step.
    while (currentReward(run)?.kind !== 'retinue') chooseReward(run, meta, 'skip');
    return { run, meta, step: currentReward(run)! };
  };

  it('cap is 6 pop, +3 Veteran\'s Oath, +3 Seasoned Retinue', () => {
    const survivors = [...units('ashpike', 8), ...units('destrier', 3)];
    expect(winWith(survivors).step.kind === 'retinue' && winWith(survivors).step).toMatchObject({ capPop: 6 });
    const oath = winWith(survivors, { boons: ['veterans_oath'] });
    expect(oath.step).toMatchObject({ capPop: 9, rankUp: true });
    const both = winWith(survivors, { boons: ['veterans_oath'], unlocks: ['seasoned_retinue'] });
    expect(both.step).toMatchObject({ capPop: 12 });
    expect(retinueCap(both.run, both.meta)).toBe(12);
  });

  it('picks must fit the cap (pop-weighted), extra picks are dropped', () => {
    const survivors = [...units('destrier', 3, 0, 1), ...units('ashpike', 4)];
    const { run, meta } = winWith(survivors);
    // 3 Destriers = 6 pop fills the cap; the Ashpikes no longer fit.
    chooseReward(run, meta, 0, [0, 1, 2, 3, 4]);
    expect(run.retinue).toEqual(units('destrier', 3, 0, 1));
    expect(currentReward(run)).toBeNull();
  });

  it("Veteran's Oath: carried units gain +1 Rank (max III), kills kept consistent", () => {
    const survivors = [{ type: 'ashpike' as const, rank: 0 as const, kills: 1 }, { type: 'bowman' as const, rank: 3 as const, kills: 14 }];
    const { run, meta } = winWith(survivors, { boons: ['veterans_oath'] });
    chooseReward(run, meta, 0, [0, 1]);
    expect(run.retinue).toEqual([
      { type: 'ashpike', rank: 1, kills: 3 },
      { type: 'bowman', rank: 3, kills: 14 },
    ]);
  });

  it('Grimbrand: Retinue spawns at Rank I or higher', () => {
    const meta = metaWith(['house_grimbrand']);
    const { run } = freshRun({ meta, house: 'grimbrand' });
    run.retinue = [{ type: 'ashpike', rank: 0, kills: 0 }, { type: 'courser', rank: 2, kills: 7 }];
    forceNode(run, meta, 'battle');
    const setup = startBattle(run, meta, 'muster_hall');
    expect(setup.retinue).toEqual([
      { type: 'ashpike', rank: 1, kills: 3 },
      { type: 'courser', rank: 2, kills: 7 },
    ]);
    expect(run.retinue[0].rank).toBe(0);
  });

  it('skipping the Retinue step or having no survivors empties the Retinue', () => {
    const { run, meta } = winWith(units('ashpike', 2));
    run.retinue = units('bowman', 2);
    chooseReward(run, meta, 'skip');
    expect(run.retinue).toEqual([]);

    const b = freshRun({ seed: 3 });
    b.run.retinue = units('bowman', 2);
    forceNode(b.run, b.meta, 'battle', { battle: { reward: 'boon' } });
    finishBattle(b.run, b.meta, mkResult({ survivors: [] }));
    expect(b.run.retinue).toEqual([]);
    expect(b.run.rewardQueue.map((s) => s.kind)).toEqual(['boon']);
  });
});
