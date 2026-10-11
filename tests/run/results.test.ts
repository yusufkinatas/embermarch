/**
 * finishBattle extras: Stragglers after a defeat that empties the Retinue.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { enterNode, finishBattle, getBriefing, startBattle } from '../../src/run';
import { STRAGGLERS_LABEL } from '../../src/run/results';
import { forceNode, freshRun, mkResult, units, useMemoryStorage } from './helpers';

describe('Stragglers (defeat with an empty Retinue)', () => {
  beforeEach(() => useMemoryStorage());

  it('a non-boss defeat leaves 2 Rank I Ashpike Sellswords for the next battle, with a Results line', () => {
    const { run, meta } = freshRun();
    run.retinue = units('bowman', 3, 2, 8);
    const { node } = forceNode(run, meta, 'battle', { battle: { depth: 2 } });
    startBattle(run, meta, 'muster_hall');
    const post = finishBattle(run, meta, mkResult({ outcome: 'defeat' }));
    expect(run.resolve).toBe(2);
    expect(run.retinue).toEqual([]);
    expect(run.sellswords).toEqual(units('ashpike', 2, 1, 3));
    expect(post.notes).toEqual([`${STRAGGLERS_LABEL}: 2 Rank I Ashpikes fight beside you next battle.`]);

    // They march into the next battle and are spent there.
    const next = run.map.nodes[node.next[0]];
    next.type = 'battle';
    next.battle = { ...node.battle!, seed: 99, depth: next.col };
    enterNode(run, meta, next.id);
    expect(getBriefing(run, meta, next.id).sellswords).toEqual(units('ashpike', 2, 1, 3));
    expect(startBattle(run, meta, 'muster_hall').sellswords).toEqual(units('ashpike', 2, 1, 3));
    const won = finishBattle(run, meta, mkResult({ outcome: 'victory' }));
    expect(won.notes).toBeUndefined();
    expect(run.sellswords).toEqual([]);
  });

  it('no Stragglers when the defeat ends the run, after a victory or Retreat, or in the boss battle', () => {
    const last = freshRun();
    last.run.resolve = 1;
    forceNode(last.run, last.meta, 'battle');
    startBattle(last.run, last.meta, 'muster_hall');
    const over = finishBattle(last.run, last.meta, mkResult({ outcome: 'defeat' }));
    expect(over.runOver).toBe(true);
    expect(over.notes).toBeUndefined();
    expect(last.run.sellswords).toEqual([]);

    const retreat = freshRun({ seed: 3 });
    forceNode(retreat.run, retreat.meta, 'battle');
    startBattle(retreat.run, retreat.meta, 'muster_hall');
    expect(finishBattle(retreat.run, retreat.meta, mkResult({ outcome: 'retreat' })).notes).toBeUndefined();
    expect(retreat.run.sellswords).toEqual([]);

    const boss = freshRun({ seed: 4 });
    forceNode(boss.run, boss.meta, 'boss');
    startBattle(boss.run, boss.meta, 'muster_hall');
    const post = finishBattle(boss.run, boss.meta, mkResult({ outcome: 'defeat', objective: 'boss', depth: 7 }));
    expect(post.notes).toBeUndefined();
    expect(boss.run.sellswords).toEqual([]);
  });
});
