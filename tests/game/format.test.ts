import { describe, expect, it } from 'vitest';
import { compassDir, costEntries, formatClock, formatCountdown, formatRate, normalizePct, plural } from '../../src/game/format';

describe('format helpers', () => {
  it('formats the battle clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59.99)).toBe('0:59');
    expect(formatClock(61)).toBe('1:01');
    expect(formatClock(600)).toBe('10:00');
    expect(formatClock(-5)).toBe('0:00');
  });

  it('countdowns round up', () => {
    expect(formatCountdown(0.2)).toBe('0:01');
    expect(formatCountdown(24)).toBe('0:24');
    expect(formatCountdown(0)).toBe('0:00');
  });

  it('computes 8-way compass directions with y growing south', () => {
    expect(compassDir(0, 0, 10, 0)).toBe('E');
    expect(compassDir(0, 0, 10, -10)).toBe('NE');
    expect(compassDir(0, 0, 0, -10)).toBe('N');
    expect(compassDir(0, 0, -10, -10)).toBe('NW');
    expect(compassDir(0, 0, -10, 0)).toBe('W');
    expect(compassDir(0, 0, -10, 10)).toBe('SW');
    expect(compassDir(0, 0, 0, 10)).toBe('S');
    expect(compassDir(0, 0, 10, 10)).toBe('SE');
  });

  it('lists non-zero cost entries in canonical order', () => {
    expect(costEntries({ ember: 25, grain: 55 })).toEqual([
      { res: 'grain', amount: 55 },
      { res: 'ember', amount: 25 },
    ]);
    expect(costEntries({})).toEqual([]);
  });

  it('normalizes wave reduction percentages', () => {
    expect(normalizePct(0.3)).toBe(30);
    expect(normalizePct(30)).toBe(30);
    expect(normalizePct(-0.2)).toBe(20);
  });

  it('formats rates', () => {
    expect(formatRate(41.6)).toBe('+42/min');
    expect(formatRate(0)).toBe('+0/min');
  });

  it('pluralizes unit names', () => {
    expect(plural('Bowman', 2)).toBe('Bowmen');
    expect(plural('Tiller', 3)).toBe('Tillers');
    expect(plural('Ashpike', 1)).toBe('Ashpike');
  });
});
