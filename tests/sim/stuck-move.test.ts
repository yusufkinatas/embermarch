/**
 * GDD §F (e): a unit that cannot get any closer to a move goal gives up and goes idle. A move order
 * to a point no unit can stand on (a forest corner) must end, so queued orders run and the unit
 * auto-acquires again, instead of re-issuing the same goal every second forever.
 */
import { describe, expect, it } from 'vitest';
import { spawnUnit } from '../../src/sim/entities';
import { orderUnit } from '../../src/sim/orders';
import { issueCommand } from '../../src/sim/world';
import { ENEMY, PLAYER } from '../../src/sim/types';
import { clearUnits, makeWorld, step, stepUntil } from './helpers';

// flatMap's forest block spans tiles x 20-27, y 2-12: (20.0, 13.0) is its south-west corner point.
const CORNER = { x: 20, y: 13 };

function arena() {
  const w = makeWorld();
  clearUnits(w);
  w.debug.revealAll = true;
  return w;
}

describe('move orders to a point nobody can stand on', () => {
  it('the order ends once nav gives up, and the next queued order runs', () => {
    const w = arena();
    const c = spawnUnit(w, 'courser', PLAYER, 12, 20);
    orderUnit(w, c, { type: 'move', x: CORNER.x, y: CORNER.y });
    orderUnit(w, c, { type: 'move', x: 12, y: 24 }, true);
    const t = stepUntil(w, () => c.order.type === 'move' && Math.hypot(c.x - 12, c.y - 24) < 3, 30);
    expect(t).toBeLessThan(30);
    expect(Math.hypot(c.x - CORNER.x, c.y - CORNER.y)).toBeGreaterThan(3);
    step(w, 10);
    expect(c.order.type).toBe('idle');
    expect(Math.hypot(c.x - 12, c.y - 24)).toBeLessThan(1);
  });

  it('a unit that gave up goes idle and fights an enemy that walks up', () => {
    const w = arena();
    const b = spawnUnit(w, 'ashpike', PLAYER, 12, 20);
    expect(issueCommand(w, { type: 'move', unitIds: [b.id], x: CORNER.x, y: CORNER.y }).ok).toBe(true);
    expect(stepUntil(w, () => b.order.type === 'idle', 30)).toBeLessThan(30);
    const e = spawnUnit(w, 'thornling', ENEMY, b.x - 2.5, b.y + 1.5);
    e.ai = null;
    const hp = e.hp;
    step(w, 4);
    expect(e.hp).toBeLessThan(hp);
  });

  it('a fresh order to a reachable point still walks all the way', () => {
    const w = arena();
    const c = spawnUnit(w, 'courser', PLAYER, 12, 20);
    orderUnit(w, c, { type: 'move', x: CORNER.x, y: CORNER.y });
    expect(stepUntil(w, () => c.order.type === 'idle', 30)).toBeLessThan(30);
    orderUnit(w, c, { type: 'move', x: 30, y: 30 });
    step(w, 1);
    expect(c.order.type).toBe('move');
    expect(stepUntil(w, () => c.order.type === 'idle', 30)).toBeLessThan(30);
    expect(Math.hypot(c.x - 30, c.y - 30)).toBeLessThan(0.3);
  });
});
