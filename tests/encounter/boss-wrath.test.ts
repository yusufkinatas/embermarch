/**
 * §I Boss Wrath: phase-1 countdown in the tracker and the view, a 30 s warning, and the Wrath alert.
 */
import { describe, expect, it } from 'vitest';
import { BOSS } from '../../src/data/balance';
import { getEncounterView } from '../../src/sim/encounter';
import { getState } from '../../src/sim/encounter/state';
import { drainEvents } from '../../src/sim/world';
import type { GameEvent, World } from '../../src/sim/types';
import { realWorld, runTo } from './helpers';

type Alert = Extract<GameEvent, { t: 'alert' }>;

describe('boss Wrath', () => {
  it('counts down in phase 1, warns 30 s ahead, then breaks free with +20% damage', () => {
    const w = realWorld({ objective: 'boss', seed: 15 });
    const alerts: Alert[] = [];
    const sfx: string[] = [];
    w.debug.invulnerablePlayer = true;
    // Collect alerts as they happen.
    const keep = (ww: World): void => {
      for (const e of drainEvents(ww)) {
        if (e.t === 'alert') alerts.push(e);
        else if (e.t === 'sfx') sfx.push(e.name);
      }
    };
    runTo(w, 100, keep);
    const v100 = getEncounterView(w);
    expect(v100.trackerText).toBe('Burn the Root Hearts 0/3 · Wrath 6:20');
    expect(v100.boss).toMatchObject({ phase: 1, warded: true, wrath: false });
    expect(v100.boss!.wrathIn).toBeCloseTo(380, 0);

    runTo(w, BOSS.wrathTime - BOSS.wrathWarnLead - 1, keep);
    expect(alerts.some((a) => a.text.includes('Wrath in'))).toBe(false);
    runTo(w, BOSS.wrathTime - BOSS.wrathWarnLead + 0.1, keep);
    const warn = alerts.filter((a) => a.text === 'The Regent stirs. Wrath in 0:30.');
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ kind: 'boss_phase', priority: 'high' });
    expect(sfx).toContain('wave_horn');

    runTo(w, BOSS.wrathTime + 1, keep);
    expect(alerts.filter((a) => a.text.includes('Wrath in'))).toHaveLength(1);
    const st = getState(w)!;
    expect(st.nests.some((n) => n.alive)).toBe(true);
    const v = getEncounterView(w);
    expect(v.boss).toMatchObject({ phase: 2, warded: false, wrath: true, wrathIn: null });
    expect(v.trackerText).toBe('Slay the Briar Regent');
    const wrath = alerts.find((a) => a.text.startsWith('Wrath!'))!;
    expect(wrath.text).toBe(
      `Wrath! The Regent tears free of its Throne: +${BOSS.wrathDamagePct}% damage, and the surviving Root Hearts keep sending waves.`,
    );
  });
});
