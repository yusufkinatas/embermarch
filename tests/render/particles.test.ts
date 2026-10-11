import { describe, expect, it } from 'vitest';
import { MAX_PARTICLES, ParticlePool } from '../../src/render/particles';

describe('particle pool (§P: capped at 400)', () => {
  it('never exceeds the cap and recycles the most-expired particle', () => {
    const pool = new ParticlePool();
    expect(MAX_PARTICLES).toBe(400);
    for (let i = 0; i < 1000; i++) pool.spawn({ x: i, y: 0, life: 1 + (i % 7), color: '#fff' });
    expect(pool.count).toBe(400);
  });

  it('expires particles and reuses storage', () => {
    const pool = new ParticlePool(10);
    for (let i = 0; i < 10; i++) pool.spawn({ x: 0, y: 0, life: 0.5, color: '#fff' });
    pool.step(0.6);
    expect(pool.count).toBe(0);
    pool.spawn({ x: 1, y: 2, life: 1, color: '#000' });
    expect(pool.count).toBe(1);
    expect(pool.items[0].x).toBe(1);
  });

  it('integrates velocity, gravity and clamps to the ground', () => {
    const pool = new ParticlePool();
    const p = pool.spawn({ x: 0, y: 0, z: 5, vx: 10, vz: 0, g: 100, life: 2, color: '#fff' });
    pool.step(0.1);
    expect(p.x).toBeCloseTo(1);
    expect(p.z).toBeLessThan(5);
    for (let i = 0; i < 10; i++) pool.step(0.1);
    expect(p.z).toBe(0);
  });

  it('ignores non-positive dt (paused)', () => {
    const pool = new ParticlePool();
    const p = pool.spawn({ x: 0, y: 0, vx: 10, life: 1, color: '#fff' });
    pool.step(0);
    expect(p.x).toBe(0);
    expect(p.life).toBe(1);
  });
});
