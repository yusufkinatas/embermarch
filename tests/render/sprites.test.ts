import { describe, expect, it } from 'vitest';
import { bucketAngle, buildingSpriteKey, FACING_BUCKETS, facingBucket, resBucket, thicketDots, unitSpriteKey } from '../../src/render/sprites';
import { UNIT_REACH, unitBodyRadius } from '../../src/render/unitArt';
import { BUILDING_MARGIN } from '../../src/render/buildingArt';
import { BUILDING_IDS, UNIT_IDS } from '../../src/data/ids';
import { UNITS } from '../../src/data/units';
import { T } from '../../src/render/shapes';
import type { Owner } from '../../src/sim/types';

describe('facing buckets', () => {
  it('maps angles to 16 buckets with wrap-around', () => {
    expect(FACING_BUCKETS).toBe(16);
    expect(facingBucket(0)).toBe(0);
    expect(facingBucket(Math.PI / 2)).toBe(4);
    expect(facingBucket(Math.PI)).toBe(8);
    expect(facingBucket(-Math.PI / 2)).toBe(12);
    expect(facingBucket(Math.PI * 2)).toBe(0);
    expect(facingBucket(Math.PI * 2 - 0.01)).toBe(0);
    expect(facingBucket(-0.01)).toBe(0);
    expect(facingBucket(Number.NaN)).toBe(0);
  });

  it('round-trips bucket -> angle -> bucket', () => {
    for (let b = 0; b < FACING_BUCKETS; b++) expect(facingBucket(bucketAngle(b))).toBe(b);
  });

  it('quantizes the raster resolution to 0.5 steps in [1, 4]', () => {
    expect(resBucket(0.75)).toBe(1);
    expect(resBucket(1)).toBe(1);
    expect(resBucket(1.01)).toBe(1.5);
    expect(resBucket(1.5)).toBe(1.5);
    expect(resBucket(3)).toBe(3);
    expect(resBucket(9)).toBe(4);
    expect(resBucket(0)).toBe(1);
  });
});

describe('sprite cache keys', () => {
  it('are unique per (type, owner, bucket, flash)', () => {
    const keys = new Set<string>();
    for (const t of UNIT_IDS) for (const o of [0, 1, 2] as Owner[]) for (let b = 0; b < FACING_BUCKETS; b++) {
      keys.add(unitSpriteKey(t, o, b));
      keys.add(unitSpriteKey(t, o, b, true));
    }
    expect(keys.size).toBe(UNIT_IDS.length * 3 * FACING_BUCKETS * 2);
  });

  it('separates building variants', () => {
    const a = buildingSpriteKey('thorn_nest', 1, 3, 3, {});
    const b = buildingSpriteKey('thorn_nest', 1, 3, 3, { spent: true });
    const c = buildingSpriteKey('ruined_cache', 2, 1, 1, { looted: true });
    expect(new Set([a, b, c, buildingSpriteKey('thorn_nest', 0, 3, 3, {})]).size).toBe(4);
  });

  it('thicket dots deplete visually (10 → 1, 0 when empty)', () => {
    expect(thicketDots(150, 150)).toBe(10);
    expect(thicketDots(75, 150)).toBe(5);
    expect(thicketDots(1, 150)).toBe(1);
    expect(thicketDots(0, 150)).toBe(0);
    expect(thicketDots(10, 0)).toBe(0);
  });
});

describe('art tables cover every id', () => {
  it('has a sprite reach for every unit, larger than its body', () => {
    for (const t of UNIT_IDS) {
      expect(UNIT_REACH[t], t).toBeGreaterThan(0);
      expect(UNIT_REACH[t], t).toBeGreaterThanOrEqual(unitBodyRadius(t));
    }
  });

  it('body radii follow §A silhouettes', () => {
    expect(unitBodyRadius('tiller')).toBeCloseTo(0.28 * T);
    expect(unitBodyRadius('warden')).toBeCloseTo(0.35 * T);
    expect(unitBodyRadius('thornhusk')).toBeCloseTo(0.45 * T);
    expect(unitBodyRadius('antlered_lord')).toBeCloseTo(0.6 * T);
    expect(unitBodyRadius('briar_regent')).toBeCloseTo(1.1 * T);
    for (const t of UNIT_IDS) expect(unitBodyRadius(t)).toBeGreaterThanOrEqual(UNITS[t].radius * T * 0.85);
  });

  it('has a margin for every building', () => {
    for (const b of BUILDING_IDS) expect(BUILDING_MARGIN[b], b).toBeDefined();
  });
});
