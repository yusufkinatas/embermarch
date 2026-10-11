/** Boon effects shown in the selection panel (B10). */
import { describe, expect, it } from 'vitest';
import { generateMap } from '../../src/mapgen';
import { quickBattleSetup } from '../../src/run';
import { createWorld } from '../../src/sim/world';
import { carryInfo, structureNote, unitStatLines } from '../../src/game/statSources';

function world(boons: string[]) {
  const setup = quickBattleSetup({ objective: 'raze', depth: 1, seed: 3, boons: boons as never });
  const gen = generateMap({ seed: setup.seed, objective: setup.objective, biome: setup.biome, depth: setup.depth, modifiers: setup.modifiers });
  return createWorld(setup, gen, { skipEncounter: true });
}

describe('unitStatLines / carryInfo', () => {
  it('Yew Staves: Bowman range is raised and named; other stats unchanged', () => {
    const w = world(['yew_staves', 'laden_packs']);
    const l = unitStatLines(w, 0, 'bowman', 0);
    expect(l.rng.tone).toBe('up');
    expect(l.rng.value).toBe(l.rng.base + 1);
    expect(l.rng.sources).toEqual(['Yew Staves +1']);
    expect(l.arm.tone).toBe('');
    expect(l.spd.tone).toBe('');
  });

  it('an unboosted unit has no tones', () => {
    const w = world([]);
    const l = unitStatLines(w, 0, 'ashpike', 0);
    for (const k of ['hp', 'atk', 'arm', 'rng', 'spd'] as const) expect(l[k].tone).toBe('');
  });

  it('rank raises ATK and names the rank', () => {
    const w = world([]);
    const l = unitStatLines(w, 0, 'ashpike', 1);
    expect(l.atk.tone).toBe('up');
    expect(l.atk.sources).toContain('Rank I +15% damage');
  });

  it('Laden Packs: carry cap +4 with its source', () => {
    const plain = carryInfo(world([]), 0, 'grain');
    const laden = carryInfo(world(['laden_packs']), 0, 'grain');
    expect(laden.cap).toBe(plain.cap + 4);
    expect(laden.base).toBe(plain.cap);
    expect(laden.sources).toEqual(['Laden Packs +4']);
    expect(plain.sources).toEqual([]);
  });
});

describe('structureNote: damage to buildings in Strong / Weak vs (final fix pass B6)', () => {
  it('Bowman ×0.2 and Courser ×0.4 are weak vs buildings; Gatebreaker ×4 is strong', () => {
    const w = world([]);
    expect(structureNote(w, 0, 'bowman', 0)).toEqual({ kind: 'weak', mult: 0.2, text: 'Barely damages buildings ×0.2' });
    expect(structureNote(w, 0, 'courser', 0)).toMatchObject({ kind: 'weak', mult: 0.4 });
    expect(structureNote(w, 0, 'gatebreaker', 0)).toEqual({ kind: 'strong', mult: 4, text: 'Tears down buildings ×4' });
  });

  it('Ashpike ×0.7, Warden ×0.8 and Tiller ×0.5 get no entry', () => {
    const w = world([]);
    expect(structureNote(w, 0, 'ashpike', 0)).toBeNull();
    expect(structureNote(w, 0, 'warden', 0)).toBeNull();
    expect(structureNote(w, 0, 'tiller', 0)).toBeNull();
  });

  it('reads the composed multiplier: a Boon that raises Courser structure damage removes the entry', () => {
    expect(structureNote(world([]), 0, 'courser', 0)?.kind).toBe('weak');
    // Raider's Bounty sets Courser structure damage to ×0.8.
    expect(structureNote(world(['raiders_bounty']), 0, 'courser', 0)).toBeNull();
  });
});
