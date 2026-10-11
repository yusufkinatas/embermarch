/** Spent ribbon wording (B5), boss Wrath label and tracker countdown (B4). Final fix pass. */
import { describe, expect, it } from 'vitest';
import { SPENT_WAVE_NAMED_S, spentNamesWave, spentReading, spentRibbonText, type SpentLabelState } from '../../src/game/hud/horn';
import { WRATH_TIP, bossPhaseLabel } from '../../src/game/hud/bossbar';
import { wrathUrgent } from '../../src/game/hud/tracker';

function fresh(wave = 6, brokeAt = 100): SpentLabelState {
  return { wave, brokeAt, lastLeft: null, refreshed: false };
}

describe('Spent ribbon names the wave only while it is current (B5)', () => {
  it('a ticking timer keeps the wave number until it is 15 s old', () => {
    const st = fresh();
    expect(spentNamesWave(st, 45, 100)).toBe(true);
    expect(spentNamesWave(st, 40, 105)).toBe(true);
    expect(spentNamesWave(st, 31, 100 + SPENT_WAVE_NAMED_S - 0.1)).toBe(true);
    expect(spentNamesWave(st, 30, 100 + SPENT_WAVE_NAMED_S)).toBe(false);
  });

  it('a refreshed timer (a later wave launched) drops the number for good', () => {
    const st = fresh();
    expect(spentNamesWave(st, 40, 101)).toBe(true);
    expect(spentNamesWave(st, 39.5, 101.5)).toBe(true);
    expect(spentNamesWave(st, 78, 102)).toBe(false); // jumped up: refreshed
    expect(spentNamesWave(st, 77, 103)).toBe(false);
    expect(st.refreshed).toBe(true);
  });

  it('no Spent time yet (view not refreshed) does not count as a jump', () => {
    const st = fresh();
    expect(spentNamesWave(st, null, 100)).toBe(true);
    expect(spentNamesWave(st, 45, 100.1)).toBe(true);
    // The stale view still says "not Spent, 0 left": that is no reading (it made a fresh far Nest drop its number).
    const st2 = fresh();
    expect(spentReading({ spent: false, spentRemaining: 0 })).toBeNull();
    expect(spentNamesWave(st2, spentReading({ spent: false, spentRemaining: 0 }), 100)).toBe(true);
    expect(spentNamesWave(st2, spentReading({ spent: true, spentRemaining: 64 }), 100.1)).toBe(true);
    expect(spentReading(undefined)).toBeNull();
  });

  it('texts: wave named, Nest only, view names and Root Hearts', () => {
    expect(spentRibbonText(6, 'SW', '0:38')).toBe('Wave 6 broken. SW Nest Spent 0:38');
    expect(spentRibbonText(null, 'SW', '1:18')).toBe('SW Nest Spent 1:18');
    expect(spentRibbonText(null, 'far NW', '0:23')).toBe('far NW Nest Spent 0:23');
    expect(spentRibbonText(2, 'NE', '0:40', 'Root Heart')).toBe('Wave 2 broken. NE Root Heart Spent 0:40');
    expect(spentRibbonText(null, 'NE', '0:12', 'Root Heart')).toBe('NE Root Heart Spent 0:12');
  });
});

describe('boss Wrath (B4)', () => {
  const base = { name: 'The Briar Regent', hp: 9000, maxHp: 9000, phase: 1 as const, warded: true, enraged: false };

  it('the phase label reads Wrath once the Regent tears free, before Warded / Uprooted', () => {
    expect(bossPhaseLabel(base, true)).toBe('Warded');
    expect(bossPhaseLabel({ ...base, wrath: true }, true)).toBe('Wrath');
    expect(bossPhaseLabel({ ...base, phase: 2, warded: false, wrath: true }, true)).toBe('Wrath');
    expect(bossPhaseLabel({ ...base, phase: 2, warded: false }, true)).toBe('Uprooted');
    expect(bossPhaseLabel({ ...base, warded: false }, false)).toBe('Hunting');
  });

  it('the Wrath tooltip names the time and the bonus from the balance table', () => {
    expect(WRATH_TIP).toBe('Wrath: the Regent tore free at 8:00. +20% damage, and the surviving Root Hearts keep sending waves.');
  });

  it('the tracker countdown turns red in its last minute', () => {
    expect(wrathUrgent('Wrath 7:59')).toBe(false);
    expect(wrathUrgent('Wrath 1:00')).toBe(false);
    expect(wrathUrgent('Wrath 0:59')).toBe(true);
    expect(wrathUrgent('Wrath 2:00', 42)).toBe(true); // the view's number wins
    expect(wrathUrgent('Wrath 0:10', null)).toBe(true);
  });
});
