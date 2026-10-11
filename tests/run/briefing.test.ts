import { beforeEach, describe, expect, it } from 'vitest';
import { DOCTRINES, MODIFIERS } from '../../src/data';
import { enterNode, getBriefing } from '../../src/run';
import { forceNode, freshRun, units, useMemoryStorage } from './helpers';

describe('getBriefing', () => {
  beforeEach(() => useMemoryStorage());

  it('describes the start battle: Raze, Draft reward, par 6:00, all Vanguards', () => {
    const { run, meta } = freshRun();
    const entry = enterNode(run, meta, 'start');
    if (entry.screen !== 'briefing') throw new Error('expected briefing');
    const b = entry.briefing;
    expect(b).toMatchObject({
      nodeId: 'start',
      nodeType: 'battle',
      objective: 'raze',
      objectiveName: 'Raze',
      biome: 'greenmarch',
      biomeName: 'Greenmarch',
      depth: 1,
      threat: 1,
      par: 360,
      reward: 'draft',
      modifiers: [],
      canRetreat: true,
    });
    expect(b.vanguards).toEqual(['muster_hall', 'bowyard', 'storehouse']);
    expect(b.doctrineHint).toBe(DOCTRINES[b.doctrine].hint);
    expect(b.doctrineAnswer).toBe(DOCTRINES[b.doctrine].answer);
    expect(b.rewardDesc).toMatch(/Draft/);
    expect(b.quitCostText).toMatch(/Retreat/);
  });

  it('shows modifiers with payoffs, Elite and Ancient Cache rewards, Retinue and Sellswords', () => {
    const { run, meta } = freshRun();
    run.retinue = units('ashpike', 2, 1, 3);
    run.sellswords = units('courser', 3, 1, 3);
    run.pending.push({ kind: 'blood_moon_next' });
    const { entry } = forceNode(run, meta, 'elite', { battle: { depth: 3, threat: 3, modifiers: ['fortified_nests', 'ancient_cache'] } });
    if (entry.screen !== 'briefing') throw new Error('expected briefing');
    const b = entry.briefing;
    expect(b.nodeType).toBe('elite');
    expect(b.par).toBe(390);
    expect(b.modifiers.map((m) => m.id)).toEqual(['fortified_nests', 'ancient_cache', 'blood_moon']);
    expect(b.modifiers[0]).toEqual({
      id: 'fortified_nests',
      name: MODIFIERS.fortified_nests.name,
      desc: MODIFIERS.fortified_nests.desc,
      payoff: MODIFIERS.fortified_nests.payoffDesc,
      kind: 'negative',
    });
    expect(b.rewardDesc).toMatch(/Rare or better/);
    expect(b.rewardDesc).toMatch(/Ancient Cache/);
    expect(b.retinue).toEqual(units('ashpike', 2, 1, 3));
    expect(b.sellswords).toEqual(units('courser', 3, 1, 3));
  });

  it('boss: no retreat, no par, quit cost restarts at −1 Resolve', () => {
    const { run, meta } = freshRun();
    const { node } = forceNode(run, meta, 'boss');
    const b = getBriefing(run, meta, node.id);
    expect(b).toMatchObject({ nodeType: 'boss', objective: 'boss', canRetreat: false, par: null, depth: 7 });
    expect(b.quitCostText).toMatch(/restarts/);
    run.resolve = 1;
    expect(getBriefing(run, meta, node.id).quitCostText).toMatch(/ends the run/);
  });

  it('Holdfast has no par; Thick Fog adds its payoff text', () => {
    const { run, meta } = freshRun();
    const { node } = forceNode(run, meta, 'battle', { battle: { objective: 'holdfast', modifiers: ['thick_fog'] } });
    const b = getBriefing(run, meta, node.id);
    expect(b.par).toBeNull();
    expect(b.modifiers[0].payoff).toBe(MODIFIERS.thick_fog.payoffDesc);
  });

  it('rejects non-battle nodes', () => {
    const { run, meta } = freshRun();
    const { node } = forceNode(run, meta, 'camp');
    expect(() => getBriefing(run, meta, node.id)).toThrow();
  });
});
