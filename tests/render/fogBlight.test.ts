import { describe, expect, it } from 'vitest';
import { wardEdgeSegments, blightEdgeTiles, fogAlpha, footprintVisible, GhostTracker, writeBlightPixels, writeFogPixels } from '../../src/render/fogBlight';
import { FixtureBuilder } from '../../src/render/devFixture';
import type { BattleSetup, GameMap } from '../../src/sim/types';

function emptyMap(w: number, h: number): GameMap {
  return { w, h, biome: 'greenmarch', terrain: new Uint8Array(w * h), treeAmount: new Uint16Array(w * h), variant: new Uint8Array(w * h) };
}

const setup = { seed: 1, objective: 'raze', biome: 'greenmarch', doctrine: 'swarm' } as unknown as BattleSetup;

describe('Blight overlay helpers', () => {
  it('finds edge tiles only (blighted with a clear 4-neighbour)', () => {
    const w = 5;
    const h = 5;
    const tiles = new Uint8Array(w * h);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) tiles[y * w + x] = 1;
    const edges = Array.from(blightEdgeTiles(tiles, w, h));
    expect(edges).toHaveLength(8);
    expect(edges).not.toContain(2 * w + 2);
  });

  it('treats the map border as non-edge (no tendrils off-map)', () => {
    const tiles = new Uint8Array(4).fill(1);
    expect(blightEdgeTiles(tiles, 2, 2)).toHaveLength(0);
  });

  it('writes #5A1F5E at 45% for blighted tiles', () => {
    const out = new Uint8ClampedArray(8);
    writeBlightPixels(Uint8Array.from([1, 0]), out);
    expect(Array.from(out.slice(0, 4))).toEqual([0x5a, 0x1f, 0x5e, Math.round(0.45 * 255)]);
    expect(out[7]).toBe(0);
  });
});

describe('ward edges', () => {
  it('outlines warded tiles that touch Blight', () => {
    const w = 3;
    const tiles = Uint8Array.from([1, 0, 0, 1, 0, 0, 1, 0, 0]);
    const ward = Uint16Array.from([0, 1, 0, 0, 1, 0, 0, 0, 0]);
    const seg = Array.from(wardEdgeSegments(tiles, ward, w, 3));
    // Tiles (1,0) and (1,1) border the blighted column on their west side.
    expect(seg).toEqual([1, 0, 1, 1, 1, 1, 1, 2]);
  });
});

describe('fog helpers (§A: unexplored 100%, explored 55%)', () => {
  it('maps fog states to alpha', () => {
    expect(fogAlpha(0)).toBe(255);
    expect(fogAlpha(1)).toBe(Math.round(0.55 * 255));
    expect(fogAlpha(2)).toBe(0);
    const out = new Uint8ClampedArray(12);
    writeFogPixels(Uint8Array.from([0, 1, 2]), out);
    expect(Array.from(out.slice(0, 3))).toEqual([0x0b, 0x0a, 0x0f]);
    expect([out[3], out[7], out[11]]).toEqual([255, 140, 0]);
  });

  it('checks footprint visibility, tolerating fractional positions', () => {
    const fog = new Uint8Array(16);
    fog[2 * 4 + 2] = 2;
    expect(footprintVisible(fog, 4, 4, 1, 1, 2, 2)).toBe(true);
    expect(footprintVisible(fog, 4, 4, 0, 0, 2, 2)).toBe(false);
    expect(footprintVisible(fog, 4, 4, 1.5, 1.5, 1, 1)).toBe(true);
    expect(footprintVisible(fog, 4, 4, -3, -3, 2, 2)).toBe(false);
  });
});

describe('ghost tracker (enemy structures persist once seen)', () => {
  it('remembers, persists in fog, refreshes, and forgets dead structures once re-seen', () => {
    const fb = new FixtureBuilder(emptyMap(20, 20), setup);
    const nest = fb.building('thorn_nest', 1, 10, 10, { nest: { index: 0, spent: false, spentUntil: -1, blightRadius: 4, seen: false, musterProgress: 0 } });
    const mine = fb.building('cottage', 0, 2, 2);
    const g = new GhostTracker();
    let vis = false;
    const visible = (): boolean => vis;
    g.update(fb.world, visible);
    expect(g.ghosts.size).toBe(0);
    vis = true;
    g.update(fb.world, visible);
    expect(g.ghosts.has(nest.id)).toBe(true);
    expect(g.ghosts.has(mine.id)).toBe(false);
    // Hidden: the snapshot keeps the last-seen state even if the live building changes.
    vis = false;
    nest.nest!.spent = true;
    g.update(fb.world, visible);
    expect(g.ghosts.get(nest.id)?.spent).toBe(false);
    // Destroyed while unseen: the ghost stays until the spot is seen again.
    nest.alive = false;
    fb.world.buildings = fb.world.buildings.filter((b) => b !== nest);
    fb.world.entities.delete(nest.id);
    g.update(fb.world, visible);
    expect(g.ghosts.has(nest.id)).toBe(true);
    vis = true;
    g.update(fb.world, visible);
    expect(g.ghosts.has(nest.id)).toBe(false);
  });

  it('ghosts structures the encounter marks as seen (Cold Watch-Fire)', () => {
    const fb = new FixtureBuilder(emptyMap(20, 20), setup);
    const nest = fb.building('thorn_nest', 1, 10, 10, { nest: { index: 0, spent: false, spentUntil: -1, blightRadius: 4, seen: true, musterProgress: 0 } });
    const g = new GhostTracker();
    g.update(fb.world, () => false);
    expect(g.ghosts.has(nest.id)).toBe(true);
  });
});
