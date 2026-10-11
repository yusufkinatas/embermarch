import { describe, expect, it } from 'vitest';
import { COUNTER_POPUP_MAX, COUNTER_POPUP_THROTTLE, FLOAT_TEXT_MAX, formatMult, PopupQueue } from '../../src/render/popups';
import { PALETTE } from '../../src/data/palette';

describe('combat popups (§G readability)', () => {
  it('formats multipliers like the GDD', () => {
    expect(formatMult(3)).toBe('×3');
    expect(formatMult(1.5)).toBe('×1.5');
    expect(formatMult(0.5)).toBe('×0.5');
    expect(formatMult(0.25)).toBe('×0.25');
    expect(formatMult(0.2)).toBe('×0.2');
    expect(formatMult(1 / 3)).toBe('×0.33');
  });

  it('colors counter orange and resisted grey', () => {
    const q = new PopupQueue();
    q.addCombat(1, 'counter', 3, 0, 0, 0);
    q.addCombat(2, 'resisted', 0.5, 0, 0, 0);
    expect(q.items[0].color).toBe(PALETTE.ui.counter);
    expect(q.items[1].color).toBe(PALETTE.ui.resisted);
  });

  it('shows at most one popup per attacker per 1.5 s', () => {
    const q = new PopupQueue();
    expect(q.addCombat(7, 'counter', 3, 0, 0, 10)).toBe(true);
    expect(q.addCombat(7, 'counter', 3, 0, 0, 10.5)).toBe(false);
    expect(q.addCombat(7, 'resisted', 0.5, 0, 0, 10 + COUNTER_POPUP_THROTTLE - 0.01)).toBe(false);
    expect(q.addCombat(8, 'counter', 2, 0, 0, 10.5)).toBe(true);
    expect(q.addCombat(7, 'counter', 3, 0, 0, 10 + COUNTER_POPUP_THROTTLE)).toBe(true);
  });

  it('never has more than 24 combat popups on screen (oldest replaced)', () => {
    const q = new PopupQueue();
    for (let i = 0; i < 60; i++) q.addCombat(100 + i, 'counter', 3, 0, 0, i * 0.001);
    expect(q.countCombat()).toBe(COUNTER_POPUP_MAX);
    expect(COUNTER_POPUP_MAX).toBe(24);
    // The newest survives.
    expect(q.items.some((p) => Math.abs(p.born - 59 * 0.001) < 1e-9)).toBe(true);
  });

  it('caps floating resource text separately and expires popups', () => {
    const q = new PopupQueue();
    for (let i = 0; i < 100; i++) q.addFloat('+10', 0, 0, '#fff', 0);
    expect(q.items.length).toBe(FLOAT_TEXT_MAX);
    q.addCombat(1, 'counter', 3, 0, 0, 0);
    q.step(5);
    expect(q.items.length).toBe(0);
  });
});
