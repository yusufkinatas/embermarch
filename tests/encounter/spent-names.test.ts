/**
 * §I Spent distance extra and Nest names: far Nests stay Spent longer after a break, two Nests in
 * one compass bucket are "near" / "far", and boss alerts name the Root Heart.
 */
import { describe, expect, it } from 'vitest';
import { SPENT } from '../../src/data/balance';
import { generateMap } from '../../src/mapgen';
import { quickBattleSetup } from '../../src/run';
import { getEncounterView } from '../../src/sim/encounter';
import { spentExtra } from '../../src/sim/encounter/formulas';
import { aiOf, getState, type NestRec } from '../../src/sim/encounter/state';
import { launchWave, musterWave } from '../../src/sim/encounter/waves';
import { killEntity } from '../../src/sim/entities';
import { createWorld, drainEvents, stepWorld } from '../../src/sim/world';
import type { GameEvent, ObjectiveId, World } from '../../src/sim/types';

function quickWorld(objective: ObjectiveId, depth: number, seed: number): World {
  const setup = quickBattleSetup({ objective, depth, seed });
  const gen = generateMap({ seed: setup.seed, objective: setup.objective, biome: setup.biome, depth: setup.depth, modifiers: setup.modifiers });
  const w = createWorld(setup, gen);
  while (w.countdown > 0) stepWorld(w);
  return w;
}

/** Muster and launch a wave at `nest`, then kill it: returns the alerts of the break tick. */
function launchAndBreak(w: World, nest: NestRec, n: number): Extract<GameEvent, { t: 'alert' }>[] {
  const st = getState(w)!;
  const wave = musterWave(w, st, nest, n, 6, w.time, { forced: true });
  launchWave(w, st, wave, 0, true);
  for (let i = 0; i < 20 * 20; i++) stepWorld(w);
  drainEvents(w);
  for (const id of wave.members) {
    const u = w.entities.get(id);
    if (u && u.alive) killEntity(w, u, 0);
  }
  stepWorld(w);
  return drainEvents(w).filter((e): e is Extract<GameEvent, { t: 'alert' }> => e.t === 'alert');
}

describe('Spent distance extra and Nest names', () => {
  it('Raze d2 seed 23: the 44-tile Nest is "far SW" and stays Spent about 1:04 after its wave breaks', () => {
    const w = quickWorld('raze', 2, 23);
    const st = getState(w)!;
    const dirs = st.nests.map((n) => n.dir).sort();
    expect(dirs).toEqual(['far SW', 'near SW']);
    const far = st.nests.find((n) => n.dir === 'far SW')!;
    const d = Math.hypot(far.cx - st.hearthX, far.cy - st.hearthY);
    expect(d).toBeGreaterThan(43);
    expect(far.spentExtra).toBeCloseTo(spentExtra(d), 6);
    // The view carries the same names.
    expect(getEncounterView(w).nests.map((n) => n.dir).sort()).toEqual(['far SW', 'near SW']);

    const alerts = launchAndBreak(w, far, 1);
    const broken = alerts.find((a) => a.kind === 'wave_broken')!;
    // 45 s + 19.3 s distance extra (64.3 s, shown rounded up).
    expect(broken.text).toBe('Wave 1 broken. far SW Nest Spent 1:05');
    const view = getEncounterView(w).nests.find((n) => n.id === far.id)!;
    expect(view.spent).toBe(true);
    expect(view.spentRemaining).toBeGreaterThan(SPENT.afterBroken + 18);
    expect(view.spentRemaining).toBeLessThanOrEqual(SPENT.afterBroken + 20);
  });

  it('the Horn and launch alerts use the disambiguated name', () => {
    const w = quickWorld('raze', 2, 23);
    const st = getState(w)!;
    const near = st.nests.find((n) => n.dir === 'near SW')!;
    drainEvents(w);
    const wave = musterWave(w, st, near, 1, 6, w.time, { forced: true });
    launchWave(w, st, wave, 0, true);
    const texts = drainEvents(w)
      .filter((e): e is Extract<GameEvent, { t: 'alert' }> => e.t === 'alert')
      .map((a) => a.text);
    expect(texts).toContain('The horn sounds in the near SW. Wave 1 gathers.');
    expect(texts).toContain('Wave 1 advances from the near SW.');
    expect(getEncounterView(w).horn?.direction).toBe('near SW');
  });

  it('boss: the wave-broken alert names the Root Heart, and the three Hearts have distinct names', () => {
    const w = quickWorld('boss', 7, 3);
    const st = getState(w)!;
    const names = st.nests.map((n) => n.dir);
    expect(new Set(names).size).toBe(3);
    const heart = st.nests[0];
    // Keep the Regent out of the fight while the test wave lives.
    const regent = w.entities.get(st.boss!.id)!;
    expect(regent.kind === 'unit' && aiOf(regent)).toBeTruthy();
    const alerts = launchAndBreak(w, heart, 2);
    const broken = alerts.find((a) => a.kind === 'wave_broken')!;
    expect(broken.text).toMatch(new RegExp(`^Wave 2 broken\\. ${heart.dir} Root Heart Spent \\d:\\d\\d$`));
  });
});
