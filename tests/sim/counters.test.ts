/**
 * GDD §Q (a) counter tests: equal-cost groups spawn 8 tiles apart (front rows), attack-move into each other and
 * fight for 60 s. The R-table winner must win at least 5 of 6 seeds with a 30% mean HP edge. Enemy-side units are spawned with
 * ai = null so sim-core's generic auto-acquire drives them. The expected winner plays the player side
 * on 3 seeds and the enemy side on the other 3, so fog / side asymmetries cannot decide the result.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { spawnUnit } from '../../src/sim/entities';
import { orderUnit } from '../../src/sim/orders';
import type { Owner, Unit, UnitId, World } from '../../src/sim/types';
import { ENEMY, PLAYER } from '../../src/sim/types';
import { clearUnits, makeWorld, step } from './helpers';

interface Side {
  type: UnitId;
  n: number;
}

/**
 * Spawn a block whose FRONT row sits at frontX, rows extending away from the enemy (dir = +1 / -1).
 */
function spawnSide(w: World, rng: Rng, side: Side, owner: Owner, frontX: number, cy: number, dir: number): Unit[] {
  const out: Unit[] = [];
  const cols = Math.ceil(Math.sqrt(side.n));
  for (let i = 0; i < side.n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = frontX + dir * r * 0.9 + rng.range(-0.2, 0.2);
    const y = cy + (c - (cols - 1) / 2) * 0.9 + rng.range(-0.2, 0.2);
    out.push(spawnUnit(w, side.type, owner, x, y));
  }
  return out;
}

/** Returns the HP fraction left on the winning side (positive = `a` won, negative = `b` won). */
function fight(a: Side, b: Side, seed: number, aIsPlayer: boolean): number {
  const w = makeWorld({ seed });
  clearUnits(w);
  const rng = new Rng(seed * 7919 + 13);
  const y = 34;
  const ownerA: Owner = aIsPlayer ? PLAYER : ENEMY;
  const ownerB: Owner = aIsPlayer ? ENEMY : PLAYER;
  // Front rows 8 tiles apart.
  const xa = aIsPlayer ? 20 : 28;
  const xb = aIsPlayer ? 28 : 20;
  const ua = spawnSide(w, rng, a, ownerA, xa, y, Math.sign(xa - xb));
  const ub = spawnSide(w, rng, b, ownerB, xb, y, Math.sign(xb - xa));
  for (const u of ua) orderUnit(w, u, { type: 'attackMove', x: xb, y });
  for (const u of ub) orderUnit(w, u, { type: 'attackMove', x: xa, y });
  step(w, 60);
  const hpA = ua.filter((u) => u.alive).reduce((s, u) => s + u.hp / u.maxHp, 0) / ua.length;
  const hpB = ub.filter((u) => u.alive).reduce((s, u) => s + u.hp / u.maxHp, 0) / ub.length;
  return hpA > 0 && hpB === 0 ? hpA : hpB > 0 && hpA === 0 ? -hpB : hpA - hpB;
}

const MATCHUPS: [Side, Side][] = [
  [{ type: 'ashpike', n: 12 }, { type: 'courser', n: 9 }],
  [{ type: 'courser', n: 9 }, { type: 'bowman', n: 11 }],
  [{ type: 'bowman', n: 11 }, { type: 'ashpike', n: 12 }],
  [{ type: 'oathshield', n: 9 }, { type: 'bowman', n: 11 }],
  [{ type: 'destrier', n: 6 }, { type: 'oathshield', n: 9 }],
  [{ type: 'ashpike', n: 12 }, { type: 'destrier', n: 6 }],
  [{ type: 'courser', n: 9 }, { type: 'brandbow', n: 8 }],
];

describe('counter tests (equal cost, 6 seeds)', () => {
  for (const [winner, loser] of MATCHUPS) {
    it(`${winner.n} ${winner.type} beat ${loser.n} ${loser.type}`, () => {
      const results: number[] = [];
      for (let seed = 1; seed <= 6; seed++) results.push(fight(winner, loser, seed, seed <= 3));
      const wins = results.filter((r) => r > 0).length;
      const msg = `results ${results.map((r) => r.toFixed(2)).join(', ')}`;
      expect(wins, msg).toBeGreaterThanOrEqual(5);
      // R table: each counter wins with at least a 30% HP edge (mean over seeds).
      expect(results.reduce((s, r) => s + r, 0) / results.length, msg).toBeGreaterThanOrEqual(0.3);
    });
  }
});
