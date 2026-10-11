import { describe, expect, it } from 'vitest';
import { FixedStepLoop, nextSpeed } from '../../src/game/loop';
import { TICK_DT } from '../../src/sim/types';

function counter(): { loop: FixedStepLoop; ticks: () => number } {
  let n = 0;
  const loop = new FixedStepLoop(() => {
    n++;
  });
  return { loop, ticks: () => n };
}

describe('FixedStepLoop', () => {
  it('runs 20 ticks per simulated second at 60 fps', () => {
    const { loop, ticks } = counter();
    for (let i = 0; i < 60; i++) loop.advance(1 / 60);
    expect(ticks()).toBe(20);
  });

  it('scales with speed', () => {
    const { loop, ticks } = counter();
    loop.speed = 2;
    for (let i = 0; i < 60; i++) loop.advance(1 / 60);
    expect(ticks()).toBe(40);
    loop.speed = 1.5;
    for (let i = 0; i < 60; i++) loop.advance(1 / 60);
    expect(ticks()).toBe(70);
  });

  it('does not step while paused', () => {
    const { loop, ticks } = counter();
    loop.paused = true;
    for (let i = 0; i < 60; i++) loop.advance(1 / 60);
    expect(ticks()).toBe(0);
    loop.paused = false;
    loop.advance(0.1);
    expect(ticks()).toBe(2);
  });

  it('caps catch-up at 5 ticks per frame and drops the backlog', () => {
    const { loop, ticks } = counter();
    expect(loop.advance(0.25)).toBe(5);
    expect(ticks()).toBe(5);
    expect(loop.acc).toBeLessThan(TICK_DT);
    // Huge frame deltas are clamped too.
    loop.speed = 2;
    expect(loop.advance(10)).toBe(5);
    expect(loop.acc).toBeLessThan(TICK_DT);
  });

  it('exposes an interpolation alpha in [0,1)', () => {
    const { loop } = counter();
    loop.advance(TICK_DT * 0.5);
    expect(loop.alpha).toBeCloseTo(0.5, 5);
    loop.advance(TICK_DT * 0.5);
    expect(loop.alpha).toBeLessThan(0.01);
  });

  it('applies slowmo for its real-time duration only', () => {
    const { loop, ticks } = counter();
    loop.addSlowmo(0.5, 0.4);
    expect(loop.slowmoFactor).toBe(0.5);
    for (let i = 0; i < 24; i++) loop.advance(1 / 60); // 0.4 s real at half speed = 0.2 s sim
    expect(ticks()).toBe(4);
    expect(loop.slowmoFactor).toBe(1);
    // Overlapping slowmo keeps the strongest factor.
    loop.addSlowmo(0.5, 1);
    loop.addSlowmo(0.3, 0.2);
    expect(loop.slowmoFactor).toBe(0.3);
  });
});

describe('nextSpeed', () => {
  it('steps through 1, 1.5, 2 and clamps', () => {
    expect(nextSpeed(1, 1)).toBe(1.5);
    expect(nextSpeed(1.5, 1)).toBe(2);
    expect(nextSpeed(2, 1)).toBe(2);
    expect(nextSpeed(2, -1)).toBe(1.5);
    expect(nextSpeed(1, -1)).toBe(1);
  });
  it('recovers from off-grid debug speeds', () => {
    expect(nextSpeed(4, -1)).toBe(2);
    expect(nextSpeed(4, 1)).toBe(2);
    expect(nextSpeed(0.5, 1)).toBe(1);
    expect(nextSpeed(1.2, 1)).toBe(1.5);
  });
});
