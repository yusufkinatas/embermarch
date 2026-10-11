import { beforeEach, describe, expect, it } from 'vitest';
import { CROWNS, DOCTRINES, MODIFIERS } from '../../src/data';
import type { DoctrineDef } from '../../src/data/types';
import { enterNode, getBriefing, nodeRewardText } from '../../src/run';
import type { DoctrineId, DraftId, PlayerUnitId } from '../../src/sim/types';
import { forceNode, freshRun, metaWith, units, useMemoryStorage } from './helpers';

/** S11 counsel fields, optional until the sim lane lands them. */
type CounselDef = DoctrineDef & { answerCore?: string; answerDrafts?: PlayerUnitId[] };
const DRAFT_UNITS: Record<string, PlayerUnitId> = { draft_shieldwall: 'oathshield', draft_heavy_horse: 'destrier', draft_firecraft: 'brandbow', draft_siegecraft: 'gatebreaker' };

/** The counsel a run with these drafts should see, computed from the doctrine table directly. */
function expectedCounsel(doctrine: DoctrineId, drafts: DraftId[]): string {
  const d = DOCTRINES[doctrine] as CounselDef;
  const have = new Set(drafts.map((x) => DRAFT_UNITS[x]));
  const missing = (d.answerDrafts ?? []).some((u) => !have.has(u));
  return missing ? (d.answerCore ?? d.answer) : d.answer;
}

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
    // Battle 1 has no drafts: the counsel names core units only once S11 adds answerCore.
    expect(b.doctrineAnswer).toBe(expectedCounsel(b.doctrine, []));
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

  it('counsel names drafted units only once the run has them (Spines)', () => {
    const { run, meta } = freshRun();
    const { node } = forceNode(run, meta, 'battle', { battle: { doctrine: 'spines' } });
    const spines = DOCTRINES.spines as CounselDef;
    const bare = getBriefing(run, meta, node.id).doctrineAnswer!;
    expect(bare).toBe(expectedCounsel('spines', []));
    if (spines.answerCore !== undefined && spines.answerDrafts?.length) {
      expect(bare).not.toMatch(/Oathshield|Destrier/);
    } else {
      expect(bare).toBe(spines.answer); // before S11: the full answer
    }
    run.drafts = ['draft_shieldwall', 'draft_heavy_horse'];
    expect(getBriefing(run, meta, node.id).doctrineAnswer).toBe(spines.answer);
    run.profileRunIndex = 3;
    expect(getBriefing(run, meta, node.id).doctrineAnswer).toBeNull();
  });

  it('Your Host counts the real Tillers: Tallow +1, Hearthborn +2, Refugees, Hearth Lore', () => {
    const meta = metaWith(['house_tallow', 'house_grimbrand', 'house_lowmere']);
    const ardent = freshRun({ meta });
    expect(getBriefing(ardent.run, meta, 'start')).toMatchObject({ tillers: 7, coursers: 1 });
    const tallow = freshRun({ meta, house: 'tallow', seed: 2 });
    expect(getBriefing(tallow.run, meta, 'start').tillers).toBe(8);
    tallow.run.boons = ['hearthborn'];
    tallow.run.extraTillers = 1;
    meta.unlocks.push('hearth_lore');
    expect(getBriefing(tallow.run, meta, 'start').tillers).toBe(12);
  });

  it('first march: the start briefing of the first 3 runs shows the wave easing line', () => {
    const { run, meta } = freshRun();
    expect(getBriefing(run, meta, 'start').assists).toEqual(['First march: the Thornwake wakes slowly (waves −15%).']);
    run.profileRunIndex = 2;
    expect(getBriefing(run, meta, 'start').assists).toHaveLength(1);
    run.profileRunIndex = 3;
    expect(getBriefing(run, meta, 'start').assists).toEqual([]);
    run.profileRunIndex = 0;
    const { node } = forceNode(run, meta, 'battle');
    expect(getBriefing(run, meta, node.id).assists).toEqual([]);
  });
});

describe('nodeRewardText (map tooltip and briefing)', () => {
  beforeEach(() => useMemoryStorage());

  it('Elites pay a Rare+ Boon, a Draft and Crowns; the boss ends the march; text matches the briefing', () => {
    const { run, meta } = freshRun();
    const { node } = forceNode(run, meta, 'elite', { battle: { depth: 3, modifiers: ['fortified_nests'] } });
    const elite = nodeRewardText(run, node);
    expect(elite).toMatch(new RegExp(`Rare or better Boon .* then a Draft\\. \\+${CROWNS.eliteBonus} Crowns`));
    expect(elite).toBe(getBriefing(run, meta, node.id).rewardDesc);

    const boss = run.map.nodes[run.map.bossId];
    expect(nodeRewardText(run, boss)).toBe('Slay the Regent and end the march.');
    expect(nodeRewardText(run, boss)).not.toMatch(/Boon/);

    const start = run.map.nodes[run.map.startId];
    expect(nodeRewardText(run, start)).toMatch(/Draft: pick 1 of 3 new unit types/);
    const camp = Object.values(run.map.nodes).find((n) => !n.battle)!;
    expect(nodeRewardText(run, camp)).toBe('');
  });
});

