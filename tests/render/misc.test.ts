import { describe, expect, it } from 'vitest';
import { hasIconArt, EXTRA_ICON_KEYS } from '../../src/render/icons';
import { showHpBar, placementTiles } from '../../src/render/overlays';
import { arcHeight, flightProgress } from '../../src/render/projectiles';
import { mapNoiseSeed, tileClass } from '../../src/render/terrain';
import { terrainMinimapColor } from '../../src/render/minimap';
import { propsResFor } from '../../src/render/renderer';
import { buildBattleScene } from '../../src/render/devFixture';
import { BUILDING_IDS, HOUSE_IDS, RESEARCH_IDS, UNIT_IDS } from '../../src/data/ids';
import { BIOMES } from '../../src/data/biomes';
import { Terrain, type GameMap, type UnitClass } from '../../src/sim/types';
import { T } from '../../src/render/shapes';

describe('icons', () => {
  it('has art for every IconKind', () => {
    const kinds = [...UNIT_IDS, ...BUILDING_IDS, 'thicket', 'ember_seam', 'tree', 'grain', 'timber', 'ember', 'crowns', 'resolve', 'renown', 'pop'];
    for (const k of kinds) expect(hasIconArt(k), k).toBe(true);
  });

  it('has art for research, House abilities (as emitted by the command card) and unit classes', () => {
    for (const r of RESEARCH_IDS) expect(hasIconArt(r), r).toBe(true);
    for (const h of HOUSE_IDS) expect(hasIconArt(`ability_${h}`), h).toBe(true);
    const classes: UnitClass[] = ['worker', 'infantry', 'ranged', 'cavalry', 'siege', 'hero', 'boss'];
    for (const c of classes) expect(hasIconArt(`cls_${c}`), c).toBe(true);
    for (const k of ['rally_hearth', 'house_ability', 'hawk', 'rally', 'demolish', 'stop', 'hold', 'attack_move']) expect(EXTRA_ICON_KEYS).toContain(k);
    expect(hasIconArt('no_such_icon')).toBe(false);
  });
});

describe('overlays', () => {
  it('shows HP bars when damaged, selected or hovered, never for invulnerable objects', () => {
    const e = { hp: 50, maxHp: 50, invulnerable: false, untargetable: false };
    expect(showHpBar(e, false, false)).toBe(false);
    expect(showHpBar(e, true, false)).toBe(true);
    expect(showHpBar(e, false, true)).toBe(true);
    expect(showHpBar({ ...e, hp: 49 }, false, false)).toBe(true);
    expect(showHpBar({ hp: 1, maxHp: 1, invulnerable: true, untargetable: true }, true, true)).toBe(false);
  });

  it('placement ghost tiles come from canPlaceBuilding or fall back to ok', () => {
    const { world } = buildBattleScene({ units: 10 });
    const tiles = placementTiles(world, { building: 'brazier_tower', tx: 2, ty: 2, ok: true });
    expect(tiles).toHaveLength(4);
    const big = placementTiles(world, { building: 'hearth', tx: 0, ty: 0, ok: false });
    expect(big).toHaveLength(16);
  });
});

describe('projectile arcs', () => {
  it('arrows and Firepots arc, bolts fly flat', () => {
    expect(arcHeight('arrow', 6)).toBeGreaterThan(0);
    expect(arcHeight('firepot', 6)).toBeGreaterThan(arcHeight('arrow', 6));
    expect(arcHeight('bolt', 6)).toBe(0);
    expect(arcHeight('arrow', 100)).toBeLessThanOrEqual(1.5 * T);
  });

  it('measures flight progress toward a moving target', () => {
    expect(flightProgress(0, 0, 0, 0, 10, 0)).toBe(0);
    expect(flightProgress(0, 0, 5, 0, 10, 0)).toBeCloseTo(0.5);
    expect(flightProgress(0, 0, 10, 0, 10, 0)).toBe(1);
    expect(flightProgress(3, 3, 3, 3, 3, 3)).toBe(1);
  });
});

describe('terrain + minimap helpers', () => {
  const map: GameMap = { w: 4, h: 4, biome: 'fenreach', terrain: new Uint8Array(16), treeAmount: new Uint16Array(16), variant: new Uint8Array(16).map((_, i) => i * 17) };

  it('classifies terrain for blending', () => {
    expect(tileClass(Terrain.Forest)).toBe(tileClass(Terrain.Stump));
    expect(tileClass(Terrain.Water)).not.toBe(tileClass(Terrain.Shallows));
    expect(tileClass(Terrain.Grass)).toBe(0);
  });

  it('derives a stable cosmetic noise seed from the map', () => {
    expect(mapNoiseSeed(map)).toBe(mapNoiseSeed({ ...map }));
    const other = { ...map, variant: map.variant.map((v) => 255 - v) };
    expect(mapNoiseSeed(other)).not.toBe(mapNoiseSeed(map));
  });

  it('minimap colors use the biome palette', () => {
    const pal = BIOMES.fenreach.palette;
    expect(terrainMinimapColor(map, Terrain.Water, 0)).toBe(pal.water);
    expect(terrainMinimapColor(map, Terrain.Shallows, 0)).toBe(pal.shallows);
    expect(terrainMinimapColor(map, Terrain.Rock, 0)).toBe(pal.rock);
    expect([pal.grassA, pal.grassB]).toContain(terrainMinimapColor(map, Terrain.Grass, 3));
    expect(terrainMinimapColor({ ...map, biome: 'heartwood' }, Terrain.BriarWall, 0)).toBe(BIOMES.heartwood.palette.extra);
  });

  it('chooses a crisp props resolution per DPR', () => {
    expect(propsResFor(1)).toBe(1.5);
    expect(propsResFor(2)).toBe(2);
  });
});

describe('dev fixture (gallery / perf scene)', () => {
  it('builds a ~140 unit battle with every structure kind the renderer animates', () => {
    const { world, puppet } = buildBattleScene({ units: 140 });
    expect(world.units.length).toBeGreaterThanOrEqual(138);
    expect(world.units.length).toBeLessThanOrEqual(150);
    const types = new Set(world.buildings.map((b) => b.type));
    for (const t of ['hearth', 'thorn_nest', 'thornspire', 'ruined_cache', 'beacon_stone', 'forgehall', 'grainplot'] as const) expect(types.has(t), t).toBe(true);
    expect(world.projectiles.length).toBeGreaterThan(5);
    let events = 0;
    for (let i = 0; i < 40; i++) events += puppet.advance(0.05).length;
    expect(events).toBeGreaterThan(0);
    expect(world.tick).toBeGreaterThan(0);
  });
});
