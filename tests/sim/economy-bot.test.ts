/**
 * §Q (b) economy bot (simplified): a scripted opening with no combat checks the §R timing bands.
 * Vanguard Muster Hall, Storehouse at the forest edge at 0:00, Tillers queued continuously to 20
 * (rallied onto Thickets, later Grainplots and trees), Cottages when within 3 of the cap.
 */
import { describe, expect, it } from 'vitest';
import { canPlaceBuilding } from '../../src/sim/queries';
import { issueCommand, stepWorld } from '../../src/sim/world';
import type { GatherTarget, PlayerBuildingId, Unit, World } from '../../src/sim/types';
import { PLAYER, TICK_RATE, Terrain } from '../../src/sim/types';
import { makeWorld, units } from './helpers';

function nearestTree(w: World, x: number, y: number): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < w.map.w * w.map.h; i++) {
    if (w.map.terrain[i] !== Terrain.Forest || w.map.treeAmount[i] <= 0) continue;
    const d = Math.hypot((i % w.map.w) + 0.5 - x, Math.floor(i / w.map.w) + 0.5 - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

function place(w: World, type: PlayerBuildingId, near: { x: number; y: number }, builders: Unit[]): boolean {
  for (let r = 0; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = Math.floor(near.x) + dx;
        const ty = Math.floor(near.y) + dy;
        if (!canPlaceBuilding(w, type, tx, ty).ok) continue;
        return issueCommand(w, { type: 'build', unitIds: builders.map((b) => b.id), building: type, tx, ty }).ok;
      }
    }
  }
  return false;
}

describe('economy bot (§R timing bands)', () => {
  it('Tillers: first out at 0:10, about 12 at 1:00, 17-18 at 2:00, 20 by 3:00; near Thickets gone by about 3:00', () => {
    const w = makeWorld({}, { forest: { x0: 20, y0: 2, x1: 30, y1: 20, amount: 120 } });
    w.debug.revealAll = true;
    const p = w.players[PLAYER];
    const hearth = w.buildings.find((b) => b.type === 'hearth')!;
    const thickets = w.resources.filter((r) => r.type === 'thicket');
    const ts = units(w, PLAYER, 'tiller');
    // Opening: 5 on Grain, 2 build the Storehouse then chop.
    ts.slice(0, 5).forEach((t, i) => issueCommand(w, { type: 'gather', unitIds: [t.id], target: { kind: 'node', id: thickets[i % 6].id } }));
    place(w, 'storehouse', { x: 18, y: 9 }, ts.slice(5, 7));
    const tree = nearestTree(w, 18, 9);
    for (const t of ts.slice(5, 7)) issueCommand(w, { type: 'gather', unitIds: [t.id], target: { kind: 'tree', tile: tree }, queue: true });
    issueCommand(w, { type: 'rally', buildingIds: [hearth.id], x: thickets[0].x, y: thickets[0].y, targetId: thickets[0].id });

    let firstOut = Infinity;
    const counts: Record<number, number> = {};
    let trained = 0;
    for (let tick = 1; tick <= 180 * TICK_RATE; tick++) {
      const sec = tick / TICK_RATE;
      const n = units(w, PLAYER, 'tiller').length;
      // Keep the Hearth queue busy up to 20 Tillers.
      if (n + hearth.queue.length < 20 && hearth.queue.length < 2 && p.res.grain >= 50) {
        issueCommand(w, { type: 'train', buildingIds: [hearth.id], unit: 'tiller' });
      }
      // Cottage when close to the cap.
      const building = w.buildings.some((b) => b.type === 'cottage' && !b.built);
      if (!building && p.pop >= p.popCap - 3 && p.res.timber >= 40) {
        const builder = units(w, PLAYER, 'tiller').find((t) => t.order.type === 'gather' && t.order.target.kind === 'tree');
        if (builder) place(w, 'cottage', { x: hearth.x - 4, y: hearth.y + 4 }, [builder]);
      }
      // Idle Tillers (Thickets ran out): build a Grainplot near the Hearth (builders then farm it).
      if (tick % TICK_RATE === 0) {
        for (const t of units(w, PLAYER, 'tiller')) {
          if (t.order.type !== 'idle') continue;
          const plot = w.buildings.find((b) => b.type === 'grainplot' && b.built && b.gatherers < 2);
          if (plot) issueCommand(w, { type: 'gather', unitIds: [t.id], target: { kind: 'plot', id: plot.id } });
          else if (p.res.timber >= 50 && !w.buildings.some((b) => b.type === 'grainplot' && !b.built)) {
            place(w, 'grainplot', { x: hearth.x + 2, y: hearth.y + 6 }, [t]);
          }
        }
      }
      // Newly trained Tillers beyond 12 go to the trees.
      if (p.stats.unitsTrained > trained) {
        trained = p.stats.unitsTrained;
        if (firstOut === Infinity) firstOut = sec;
        const fresh = units(w, PLAYER, 'tiller').pop()!;
        if (n >= 12) {
          const target: GatherTarget = { kind: 'tree', tile: nearestTree(w, 18, 9) };
          issueCommand(w, { type: 'gather', unitIds: [fresh.id], target });
        }
      }
      stepWorld(w);
      if (tick % (60 * TICK_RATE) === 0) counts[sec] = units(w, PLAYER, 'tiller').length;
    }
    expect(firstOut).toBeGreaterThanOrEqual(9.9);
    expect(firstOut).toBeLessThanOrEqual(10.2);
    expect(counts[60]).toBeGreaterThanOrEqual(11);
    expect(counts[60]).toBeLessThanOrEqual(13);
    expect(counts[120]).toBeGreaterThanOrEqual(16);
    expect(counts[180]).toBeGreaterThanOrEqual(19);
    // Everyone is working (no idle Tillers) and Timber flowed through the Storehouse.
    expect(units(w, PLAYER, 'tiller').filter((t) => t.order.type === 'idle').length).toBeLessThanOrEqual(2);
    expect(w.buildings.filter((b) => b.type === 'grainplot').length).toBeGreaterThanOrEqual(1);
    expect(p.stats.gathered.timber).toBeGreaterThan(150);
  });
});
