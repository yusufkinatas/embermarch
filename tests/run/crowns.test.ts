import { beforeEach, describe, expect, it } from 'vitest';
import { CROWNS } from '../../src/data';
import { endRun, finishBattle, loadMeta } from '../../src/run';
import { renownFor } from '../../src/run/meta';
import { battleCrowns, type CrownInput } from '../../src/run/results';
import { forceNode, freshRun, mkResult, useMemoryStorage } from './helpers';

const base: CrownInput = {
  outcome: 'victory',
  depth: 1,
  objective: 'raze',
  modifiers: [],
  isElite: false,
  plunderCrowns: 0,
  underPar: false,
  unbroken: false,
  uprooted: false,
};
const crowns = (o: Partial<CrownInput>) => battleCrowns({ ...base, ...o });
const P = CROWNS.plunder;

describe('battle Crowns (§M)', () => {
  it('matches the typical values: d1 ≈ 85, d4 ≈ 120, d6 ≈ 145', () => {
    // d1 Raze: 2 Nests + 2 Pickets, under par.
    const d1 = crowns({ depth: 1, plunderCrowns: 2 * P.nest + 2 * P.picket, underPar: true });
    expect(d1.total).toBe(24 + 30 + 30);
    expect(Math.abs(d1.total - 85)).toBeLessThanOrEqual(5);
    // d4 Raze: 2 Nests + 2 Pickets + 2 Caches, under par.
    const d4 = crowns({ depth: 4, plunderCrowns: 2 * P.nest + 2 * P.picket + 2 * P.cache, underPar: true });
    expect(d4.total).toBe(36 + 60 + 30);
    expect(Math.abs(d4.total - 120)).toBeLessThanOrEqual(10);
    // d6 Raze: 3 Nests + 2 Pickets + 2 Caches, under par.
    const d6 = crowns({ depth: 6, plunderCrowns: 3 * P.nest + 2 * P.picket + 2 * P.cache, underPar: true });
    expect(d6.total).toBe(44 + 70 + 30);
    expect(Math.abs(d6.total - 145)).toBeLessThanOrEqual(5);
  });

  it('itemizes lines that sum to the total', () => {
    const r = crowns({ depth: 3, plunderCrowns: 25, underPar: true, modifiers: ['thick_fog', 'ember_famine'] });
    expect(r.lines.map((l) => l.label)).toEqual(['Victory (depth 3)', 'Plunder', 'Under par', 'Thick Fog', 'Ember Famine']);
    expect(r.total).toBe(32 + 25 + 30 + 20 + 25);
    expect(r.lines.reduce((a, l) => a + l.amount, 0)).toBe(r.total);
  });

  it('applies Blood Moon ×1.5 after flat bonuses and the Elite +40 after that', () => {
    expect(crowns({ depth: 2, plunderCrowns: 20, modifiers: ['blood_moon'] }).total).toBe(72);
    expect(crowns({ depth: 3, modifiers: ['thick_fog', 'blood_moon'] }).total).toBe(Math.floor((32 + 20) * 1.5));
    const elite = crowns({ depth: 4, objective: 'elite', isElite: true, plunderCrowns: 30, underPar: true, modifiers: ['blood_moon'] });
    expect(elite.total).toBe(Math.floor((36 + 30 + 30) * 1.5) + 40);
    expect(elite.lines.reduce((a, l) => a + l.amount, 0)).toBe(elite.total);
  });

  it('pays Holdfast bonuses only in Holdfast and par only where par exists', () => {
    expect(crowns({ depth: 2, objective: 'holdfast', unbroken: true, uprooted: true, underPar: true }).total).toBe(28 + 30 + 30);
    expect(crowns({ depth: 2, objective: 'raze', unbroken: true, uprooted: true }).total).toBe(28);
    expect(crowns({ depth: 7, objective: 'boss', underPar: true }).total).toBe(48);
  });

  it('Retreat keeps plunder only, defeat pays nothing', () => {
    expect(crowns({ outcome: 'retreat', depth: 5, plunderCrowns: 25, underPar: true, modifiers: ['thick_fog'] }).total).toBe(25);
    expect(crowns({ outcome: 'defeat', depth: 5, plunderCrowns: 25 }).total).toBe(0);
  });
});

describe('finishBattle Crowns', () => {
  beforeEach(() => useMemoryStorage());

  it('adds Spoils +80 and Elite +40 on the results screen', () => {
    const { run, meta } = freshRun();
    forceNode(run, meta, 'battle', { battle: { reward: 'spoils', depth: 2 } });
    const post = finishBattle(run, meta, mkResult({ plunderCrowns: 10 }));
    expect(post.crownLines.at(-1)).toEqual({ label: 'Spoils', amount: 80 });
    expect(post.crownsTotal).toBe(28 + 10 + 80);
    expect(run.crowns).toBe(post.crownsTotal);
    expect(run.stats.crownsEarned).toBe(post.crownsTotal);

    const b = freshRun({ seed: 99 });
    forceNode(b.run, b.meta, 'elite', { battle: { depth: 3 } });
    const e = finishBattle(b.run, b.meta, mkResult({ objective: 'elite' }));
    expect(e.crownsTotal).toBe(32 + 40);
  });

  it('applies a pending Blood Moon (Hollow Envoy) to the next battle Crowns', () => {
    const { run, meta } = freshRun();
    run.pending.push({ kind: 'blood_moon_next' });
    forceNode(run, meta, 'battle', { battle: { depth: 2 } });
    const post = finishBattle(run, meta, mkResult());
    expect(post.crownsTotal).toBe(Math.floor(28 * 1.5));
    expect(run.pending.some((p) => p.kind === 'blood_moon_next')).toBe(false);
  });
});

describe('Renown (§N)', () => {
  beforeEach(() => useMemoryStorage());

  const withStats = (s: Partial<ReturnType<typeof freshRun>['run']['stats']>, tier = 0, won = false) => {
    const { run } = freshRun({ tier });
    Object.assign(run.stats, s);
    run.over = won ? 'won' : 'lost';
    return run;
  };

  it('matches the GDD bands: early loss ≈ 45, mid loss ≈ 100, win ≈ 195', () => {
    const early = renownFor(withStats({ battlesWon: 2, nestsDestroyed: 4, nodesVisited: 3 }));
    expect(early.total).toBe(20 + 8 + 15);
    const mid = renownFor(withStats({ battlesWon: 4, elitesWon: 1, nestsDestroyed: 9, nodesVisited: 6 }));
    expect(mid.total).toBe(40 + 15 + 18 + 30);
    const win = renownFor(withStats({ battlesWon: 6, elitesWon: 1, nestsDestroyed: 14, nodesVisited: 8 }, 0, true));
    expect(win.total).toBe(60 + 15 + 50 + 28 + 40);
    expect(win.total).toBeGreaterThanOrEqual(190);
    expect(win.total).toBeLessThanOrEqual(200);
    expect(win.lines.reduce((a, l) => a + l.amount, 0)).toBe(win.total);
  });

  it('adds +15% per Thornbound tier', () => {
    const r = renownFor(withStats({ battlesWon: 6, elitesWon: 1, nestsDestroyed: 14, nodesVisited: 8 }, 2, true));
    expect(r.total).toBe(Math.floor(193 * 1.3));
    expect(r.lines.reduce((a, l) => a + l.amount, 0)).toBe(r.total);
  });

  it('endRun banks Renown once and unlocks the next tier on a win', () => {
    const { run, meta } = freshRun();
    Object.assign(run.stats, { battlesWon: 6, nestsDestroyed: 10, nodesVisited: 8, kills: 120 });
    run.over = 'won';
    const s = endRun(run, meta);
    expect(s.won).toBe(true);
    expect(s.tierUnlocked).toBe(1);
    expect(meta.tierUnlocked).toBe(1);
    expect(meta.renown).toBe(s.renownTotal);
    expect(meta.stats.wins).toBe(1);
    expect(meta.stats.kills).toBe(120);
    expect(endRun(run, meta)).toBe(s);
    expect(meta.renown).toBe(s.renownTotal);
    expect(loadMeta().renown).toBe(s.renownTotal);
    // Next-unlock progress points at the cheapest available unlock.
    expect(s.nextUnlock?.id).toBe('codex_1');
    expect(s.nextUnlock?.remaining).toBe(Math.max(0, 30 - meta.renown));
  });
});
