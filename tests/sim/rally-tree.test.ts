/**
 * Hearth rally on a tree (GDD §E): a new Tiller rallied to a felled tree, or to a canopy tile, on a busy
 * lumber line still finds a tree instead of walking to the rally point and idling.
 */
import { describe, expect, it } from 'vitest';
import { GATHER } from '../../src/data/balance';
import { core } from '../../src/sim/core';
import { fellTree } from '../../src/sim/economy';
import { issueCommand } from '../../src/sim/world';
import type { Unit, World } from '../../src/sim/types';
import { PLAYER, Terrain } from '../../src/sim/types';

const isLiveTree = (w: World, t: number): boolean => w.map.terrain[t] === Terrain.Forest && w.map.treeAmount[t] > 0;
import { makeWorld, stepUntil, units } from './helpers';

/** Put every live tree within r of (cx, cy) at the gatherer cap (a busy lumber line). */
function crowdTrees(w: World, cx: number, cy: number, r: number): void {
  const tg = core(w).treeGatherers;
  for (let y = 0; y < w.map.h; y++)
    for (let x = 0; x < w.map.w; x++) {
      const t = y * w.map.w + x;
      if (isLiveTree(w, t) && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) tg[t] = GATHER.maxGatherers.tree;
    }
}

function trainTiller(w: World): Unit {
  const h = w.buildings.find((b) => b.type === 'hearth')!;
  const before = new Set(units(w, PLAYER, 'tiller').map((u) => u.id));
  w.players[PLAYER].res.grain = 500;
  expect(issueCommand(w, { type: 'train', buildingIds: [h.id], unit: 'tiller' }).ok).toBe(true);
  let nu: Unit | undefined;
  stepUntil(w, () => !!(nu = units(w, PLAYER, 'tiller').find((u) => !before.has(u.id))), 30);
  expect(nu).toBeDefined();
  return nu!;
}

describe('Hearth rally on trees', () => {
  it('rally tree felled and every tree near it at the cap: the new Tiller still gathers a tree', () => {
    const w = makeWorld();
    w.debug.revealAll = true;
    const h = w.buildings.find((b) => b.type === 'hearth')!;
    const tile = 8 * w.map.w + 20;
    expect(issueCommand(w, { type: 'rally', buildingIds: [h.id], x: 20.5, y: 8.5, tile }).ok).toBe(true);
    fellTree(w, tile);
    crowdTrees(w, 20.5, 8.5, 12);
    const nu = trainTiller(w);
    expect(nu.order.type).toBe('gather');
    expect(nu.order.type === 'gather' && nu.order.target.kind).toBe('tree');
  });

  it('a canopy rally tile (grass next to the forest) with crowded trees also gathers', () => {
    const w = makeWorld();
    w.debug.revealAll = true;
    const h = w.buildings.find((b) => b.type === 'hearth')!;
    const tile = 8 * w.map.w + 19;
    expect(isLiveTree(w, tile)).toBe(false);
    expect(issueCommand(w, { type: 'rally', buildingIds: [h.id], x: 19.5, y: 8.5, tile }).ok).toBe(true);
    crowdTrees(w, 19.5, 8.5, 12);
    const nu = trainTiller(w);
    expect(nu.order.type === 'gather' && nu.order.target.kind).toBe('tree');
  });

  it('with no live tree within 10 tiles the Tiller walks to the rally point', () => {
    const w = makeWorld({}, { forest: { x0: 40, y0: 40, x1: 44, y1: 44 } });
    w.debug.revealAll = true;
    const h = w.buildings.find((b) => b.type === 'hearth')!;
    expect(issueCommand(w, { type: 'rally', buildingIds: [h.id], x: 20.5, y: 8.5, tile: 8 * w.map.w + 20 }).ok).toBe(true);
    const nu = trainTiller(w);
    expect(nu.order.type).toBe('move');
  });
});
