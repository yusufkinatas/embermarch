/**
 * Results Chronicle rows (no DOM): the boss battle counts Root Hearts, every other battle Nests.
 */
import { describe, expect, it } from 'vitest';
import type { BattleResult } from '../../src/sim/types';
import { battleStatRows } from '../../src/app/logic/results';

function result(o: Partial<BattleResult>): BattleResult {
  return {
    outcome: 'defeat',
    time: 420,
    objective: 'raze',
    depth: 3,
    plunderCrowns: 0,
    underPar: false,
    unbroken: false,
    uprooted: false,
    nestsDestroyed: 1,
    picketsDestroyed: 0,
    cachesLooted: 0,
    ancientCacheLooted: false,
    lordSlain: false,
    regentSlain: false,
    lastStandsUsed: 0,
    survivors: [],
    unspent: { grain: 0, timber: 0, ember: 0 },
    stats: { gathered: { grain: 0, timber: 0, ember: 0 }, unitsTrained: 4, unitsLost: 6, kills: 12, buildingsBuilt: 2, buildingsLost: 1 },
    ...o,
  };
}

const labels = (r: BattleResult): string[] => battleStatRows(r).map(([k]) => k);

describe('battleStatRows', () => {
  it('the boss battle reports Root Hearts burned, not Nests', () => {
    const rows = battleStatRows(result({ objective: 'boss', depth: 7, nestsDestroyed: 2, lastStandsUsed: 1 }));
    expect(rows).toContainEqual(['Root Hearts burned', 2]);
    expect(rows.map(([k]) => k)).not.toContain('Nests destroyed');
    expect(rows).toContainEqual(['Last Stands', 1]);
  });

  it('Raze, Holdfast, Beacons and Elite keep Nests destroyed', () => {
    for (const objective of ['raze', 'holdfast', 'beacons', 'elite'] as const) {
      expect(battleStatRows(result({ objective }))).toContainEqual(['Nests destroyed', 1]);
      expect(labels(result({ objective }))).not.toContain('Root Hearts burned');
    }
  });

  it('a Holdfast victory adds Unbroken and Uprooted', () => {
    expect(labels(result({ objective: 'holdfast', outcome: 'victory', unbroken: true }))).toEqual(expect.arrayContaining(['Unbroken', 'Uprooted']));
    expect(labels(result({ objective: 'holdfast', outcome: 'defeat' }))).not.toContain('Unbroken');
  });
});
