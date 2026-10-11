/**
 * Elite modifiers (fix pass 2, R4): an Elite never stacks two hardships, and the negative it is
 * handed on top of its rolls is never Blood Moon.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { NEGATIVE_MODIFIERS } from '../../src/data';
import { generateRunMap } from '../../src/run';
import { ELITE_FORCED_NEGATIVES, rollModifiers } from '../../src/run/runmap';

const negatives = (mods: readonly string[]): string[] => mods.filter((m) => (NEGATIVE_MODIFIERS as readonly string[]).includes(m));

describe('Elite modifiers', () => {
  it('the forced pool is the negative list without Blood Moon', () => {
    expect([...ELITE_FORCED_NEGATIVES].sort()).toEqual(NEGATIVE_MODIFIERS.filter((m) => m !== 'blood_moon').sort());
  });

  it('rollModifiers: an Elite holds exactly one negative, and Blood Moon only ever comes from the open roll', () => {
    let rolledBlood = 0;
    for (let s = 1; s <= 4000; s++) {
      for (const col of [3, 4, 5, 6]) {
        const mods = rollModifiers(new Rng(s * 31 + col), col, true);
        expect(new Set(mods).size).toBe(mods.length);
        expect(negatives(mods)).toHaveLength(1);
        if (mods.includes('blood_moon')) {
          rolledBlood++;
          // The same stream without the Elite rule rolls Blood Moon too: it was not the added negative.
          expect(rollModifiers(new Rng(s * 31 + col), col, false)).toContain('blood_moon');
        }
      }
    }
    expect(rolledBlood).toBeGreaterThan(0);
  });

  it('1000 maps: no Elite carries two negatives', () => {
    const problems: string[] = [];
    let elites = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      for (const n of Object.values(generateRunMap(seed).map.nodes)) {
        if (n.type !== 'elite') continue;
        elites++;
        const neg = negatives(n.battle!.modifiers);
        if (neg.length !== 1) problems.push(`seed ${seed} ${n.id}: ${n.battle!.modifiers.join(' + ')}`);
      }
    }
    expect(elites).toBeGreaterThan(1000);
    expect(problems).toEqual([]);
  });

  it('seed 777: the column V Elite no longer stacks Blood Moon on Fortified Nests', () => {
    const elite = Object.values(generateRunMap(777).map.nodes).find((n) => n.id === 'c5l3');
    expect(elite?.type).toBe('elite');
    const mods = elite!.battle!.modifiers;
    expect(mods.includes('blood_moon') && mods.includes('fortified_nests')).toBe(false);
    expect(negatives(mods)).toHaveLength(1);
  });
});
