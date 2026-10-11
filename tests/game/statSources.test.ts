/** Boon effects shown in the selection panel (B10). */
import { describe, expect, it } from 'vitest';
import { generateMap } from '../../src/mapgen';
import { quickBattleSetup } from '../../src/run';
import { createWorld } from '../../src/sim/world';
import { carryInfo, unitStatLines } from '../../src/game/statSources';

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
