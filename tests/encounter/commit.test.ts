/**
 * Wave commit rule (§I "Unit AI"): wave units that spend ENEMY_AI.commitAfter on a player building
 * other than their wave goal, with no player army within 8 tiles, commit and march on the goal
 * (normally the Hearth). A returning player army within 8 tiles resets the commitment.
 */
import { describe, expect, it } from 'vitest';
import { ENEMY_AI } from '../../src/data/balance';
import { debugForceWave } from '../../src/sim/encounter';
import { centerOf, spawnSpots } from '../../src/sim/encounter/geom';
import { aiOf, getState } from '../../src/sim/encounter/state';
import { killEntity, spawnBuilding, spawnUnit } from '../../src/sim/entities';
import { canPlaceBuilding } from '../../src/sim/queries';
import { stepWorld } from '../../src/sim/world';
import { PLAYER, TICK_RATE, Terrain, type Building, type Unit, type World } from '../../src/sim/types';
import { enemies, hearthCenter, realWorld, runTo } from './helpers';

const MILITARY = new Set(['infantry', 'ranged', 'cavalry', 'siege', 'hero']);

function stepFor(w: World, seconds: number): void {
  const n = Math.round(seconds * TICK_RATE);
  for (let i = 0; i < n && w.outcome === 'ongoing'; i++) stepWorld(w);
}

/** Open grass around a footprint, so the wave can walk around the hall (it never blocks the path). */
function openGround(w: World, tx: number, ty: number, size: number, margin: number): boolean {
  for (let y = ty - margin; y < ty + size + margin; y++)
    for (let x = tx - margin; x < tx + size + margin; x++) {
      if (x < 0 || y < 0 || x >= w.map.w || y >= w.map.h || w.map.terrain[y * w.map.w + x] !== Terrain.Grass) return false;
    }
  return true;
}

/** A built, very sturdy Muster Hall about 12 tiles from the Hearth toward the nearest Nest, on open ground. */
function forwardHall(w: World): Building {
  const h = hearthCenter(w);
  const st = getState(w)!;
  const nest = [...st.nests].sort((a, b) => Math.hypot(a.cx - h.x, a.cy - h.y) - Math.hypot(b.cx - h.x, b.cy - h.y))[0];
  const d = Math.hypot(nest.cx - h.x, nest.cy - h.y);
  const ux = (nest.cx - h.x) / d;
  const uy = (nest.cy - h.y) / d;
  for (let r = 0; r < 10; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const tx = Math.round(h.x + ux * 12) + dx;
        const ty = Math.round(h.y + uy * 12) + dy;
        if (!canPlaceBuilding(w, 'muster_hall', tx, ty).ok || !openGround(w, tx, ty, 3, 3)) continue;
        const b = spawnBuilding(w, 'muster_hall', PLAYER, tx, ty, { built: true });
        b.maxHp *= 20;
        b.hp = b.maxHp;
        return b;
      }
  throw new Error('no site for the forward hall');
}

/** Kill the player's army and Warden, force a Spines wave and drop it beside the hall. */
function siegeSetup(seed: number): { w: World; hall: Building; wave: Unit[] } {
  const w = realWorld({ objective: 'raze', depth: 1, doctrine: 'spines', seed });
  w.debug.revealAll = true;
  runTo(w, 1);
  for (const u of w.units) if (u.alive && u.owner === PLAYER && MILITARY.has(u.cls)) killEntity(w, u, 0);
  const hall = forwardHall(w);
  debugForceWave(w, 1, 'spines');
  const wave = enemies(w, 'wave');
  const c = centerOf(hall);
  const spots = spawnSpots(w, c.x, c.y, wave.length, 3, new Map());
  wave.forEach((u, i) => {
    u.x = u.prevX = spots[i].x;
    u.y = u.prevY = spots[i].y;
    u.move = null;
    const ai = aiOf(u)!;
    ai.idleX = u.x;
    ai.idleY = u.y;
  });
  return { w, hall, wave };
}

const dHearth = (w: World, u: Unit): number => {
  const h = hearthCenter(w);
  return Math.hypot(u.x - h.x, u.y - h.y);
};

describe('wave commit rule', () => {
  it('with no player army near, wave units leave a forward building for the Hearth after commitAfter', () => {
    const { w, hall, wave } = siegeSetup(7);
    stepFor(w, 5);
    const onHall = wave.filter((u) => u.alive && u.order.type === 'attack' && u.order.targetId === hall.id);
    expect(onHall.length).toBeGreaterThan(wave.length / 2);
    expect(onHall.every((u) => !aiOf(u)!.committed)).toBe(true);
    // Not yet: the clock needs commitAfter seconds.
    stepFor(w, ENEMY_AI.commitAfter - 8);
    expect(wave.filter((u) => u.alive && aiOf(u)!.committed)).toHaveLength(0);
    stepFor(w, 6);
    const alive = wave.filter((u) => u.alive);
    expect(alive.filter((u) => aiOf(u)!.committed).length).toBeGreaterThan(alive.length / 2);
    expect(alive.filter((u) => u.order.type === 'attack' && u.order.targetId === hall.id).length).toBeLessThan(alive.length / 4);
    // About 30 s after committing they are at the Hearth.
    const h = w.entities.get(w.hearthId)!;
    const hp0 = h.hp;
    stepFor(w, 30);
    const nearHearth = wave.filter((u) => u.alive && dHearth(w, u) <= 9);
    expect(nearHearth.length).toBeGreaterThan(0);
    stepFor(w, 15);
    expect(h.hp < hp0 || w.outcome !== 'ongoing').toBe(true);
  });

  it('a player army within 8 tiles resets the commitment and the wave fights it', () => {
    const { w, wave } = siegeSetup(7);
    stepFor(w, ENEMY_AI.commitAfter + 5);
    const committed = wave.filter((u) => u.alive && aiOf(u)!.committed);
    expect(committed.length).toBeGreaterThan(0);
    const lead = committed[0];
    const army = [0, 1, 2, 3, 4, 5].map((i) => spawnUnit(w, 'ashpike', PLAYER, lead.x + (i % 3) - 1, lead.y + Math.floor(i / 3) + 1.5));
    stepFor(w, 1.5);
    expect(aiOf(lead)!.committed).toBe(false);
    const armyIds = new Set(army.map((u) => u.id));
    const fighting = wave.filter((u) => u.alive && u.order.type === 'attack' && armyIds.has(u.order.targetId));
    expect(fighting.length).toBeGreaterThan(0);
  });

  it('the Warden alone pauses the clock but does not reset a committed unit', () => {
    const { w, wave } = siegeSetup(7);
    stepFor(w, ENEMY_AI.commitAfter + 5);
    const lead = wave.find((u) => u.alive && aiOf(u)!.committed)!;
    expect(lead).toBeDefined();
    const warden = w.units.find((u) => u.alive && u.owner === PLAYER && u.type === 'warden');
    const hero = warden ?? spawnUnit(w, 'warden', PLAYER, lead.x + 2, lead.y);
    hero.x = hero.prevX = lead.x + 2;
    hero.y = hero.prevY = lead.y;
    stepFor(w, 1);
    expect(aiOf(lead)!.committed).toBe(true);
  });
});
