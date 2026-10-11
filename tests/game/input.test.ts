/**
 * BattleInput logic that does not need a real DOM: cursor choice (B4), double-click rule (B6) and
 * edge pan after a window blur (B12a). The canvas is a stub; listeners are never attached.
 */
import { describe, expect, it } from 'vitest';
import { generateMap } from '../../src/mapgen';
import { Camera } from '../../src/render/camera';
import { quickBattleSetup } from '../../src/run';
import { createWorld } from '../../src/sim/world';
import type { Unit } from '../../src/sim/types';
import { Terrain } from '../../src/sim/types';
import { BattleActions } from '../../src/game/actions';
import { AlertFeed } from '../../src/game/alerts';
import { HintDirector } from '../../src/game/hints';
import { BattleInput, DOUBLE_CLICK_SLOP_PX, isDoubleClick } from '../../src/game/input';
import { DOUBLE_CLICK_MS } from '../../src/game/actions';
import { createBattleUIState, type AudioSystem } from '../../src/game/types';

const silent: AudioSystem = {
  unlock() {},
  play() {},
  handleEvents() {},
  setListener() {},
  setCombatIntensity() {},
  setVolume() {},
  setMuted() {},
  muted: false,
  setAmbient() {},
};

function boot() {
  const setup = quickBattleSetup({ objective: 'raze', depth: 1, seed: 7 });
  const gen = generateMap({ seed: setup.seed, objective: setup.objective, biome: setup.biome, depth: setup.depth, modifiers: setup.modifiers });
  const world = createWorld(setup, gen, { skipEncounter: true });
  world.debug.revealAll = true;
  const ui = createBattleUIState();
  const camera = new Camera();
  camera.setMapSize(world.map.w, world.map.h);
  camera.setViewport(1280, 720);
  const hearth = world.entities.get(world.hearthId)!;
  camera.centerOn(hearth.x, hearth.y);
  const actions = new BattleActions({
    world,
    ui,
    camera,
    setup,
    audio: silent,
    alerts: new AlertFeed(),
    hints: new HintDirector([], false),
    error() {},
    notice() {},
    menuOpen: () => false,
    openMenu() {},
    closeMenu() {},
    ended: () => false,
    onMuteChanged() {},
  });
  const canvas = { classList: { add() {}, remove() {} } } as unknown as HTMLCanvasElement;
  const input = new BattleInput(canvas, {} as HTMLElement, {
    world,
    ui,
    camera,
    actions,
    edgePan: () => true,
    panSpeed: () => 1,
    modalOpen: () => false,
    gesture() {},
  });
  return { world, ui, camera, actions, input };
}

describe('cursor over forest (B4)', () => {
  it("shows 'gather' over a tree tile with Tillers selected, 'default' with only military", () => {
    const { world, ui, actions, input } = boot();
    const { map } = world;
    let tile = -1;
    for (let i = 0; i < map.w * map.h && tile < 0; i++) if (map.terrain[i] === Terrain.Forest && map.treeAmount[i] > 0) tile = i;
    expect(tile).toBeGreaterThanOrEqual(0);
    ui.mouseWorld = { x: (tile % map.w) + 0.5, y: Math.floor(tile / map.w) + 0.5 };
    const own = (t: string): Unit[] => world.units.filter((u) => u.alive && u.owner === 0 && u.type === t);
    actions.setSelection([own('tiller')[0].id]);
    expect(input.cursorFor(null)).toBe('gather');
    actions.setSelection([own('courser')[0].id]);
    expect(input.cursorFor(null)).toBe('default');
    actions.setSelection([own('tiller')[0].id]);
    ui.mouseWorld = { x: NaN, y: NaN };
    expect(input.cursorFor(null)).toBe('default');
  });
});

describe('double-click rule (B6)', () => {
  const a = { id: 1, kind: 'unit' as const, type: 'tiller', owner: 0 };
  const b = { id: 2, kind: 'unit' as const, type: 'tiller', owner: 0 };
  const last = { at: 1000, id: 1, x: 100, y: 100, type: 'tiller', owner: 0 };

  it('two clicks on the same unit within the window are a double-click', () => {
    expect(isDoubleClick(last, a, { x: 104, y: 98 }, 1000 + DOUBLE_CLICK_MS - 1)).toBe(true);
    expect(isDoubleClick(last, a, { x: 140, y: 98 }, 1200)).toBe(true); // the unit walked: same id
    expect(isDoubleClick(last, a, { x: 100, y: 100 }, 1000 + DOUBLE_CLICK_MS + 1)).toBe(false);
  });

  it('a click on another unit of the type 96 px away is not', () => {
    expect(isDoubleClick(last, b, { x: 196, y: 100 }, 1250)).toBe(false);
    expect(isDoubleClick(last, b, { x: 100 + DOUBLE_CLICK_SLOP_PX, y: 100 }, 1100)).toBe(true); // same spot, overlapping units
  });

  it('type, owner and resources still matter', () => {
    expect(isDoubleClick(last, { ...a, type: 'courser' }, { x: 100, y: 100 }, 1100)).toBe(false);
    expect(isDoubleClick(last, { ...a, owner: 1 }, { x: 100, y: 100 }, 1100)).toBe(false);
    expect(isDoubleClick(last, { ...a, kind: 'resource' }, { x: 100, y: 100 }, 1100)).toBe(false);
    expect(isDoubleClick(null, a, { x: 100, y: 100 }, 1100)).toBe(false);
  });
});

describe('edge pan after window blur (B12a)', () => {
  it('reset() stops a pointer resting at the screen edge from panning', () => {
    const { world, camera, input } = boot();
    camera.centerOn(world.map.w / 2, world.map.h / 2);
    const priv = input as unknown as { pointer: { x: number; y: number; inside: boolean; overCanvas: boolean } };
    priv.pointer = { x: 2, y: 300, inside: true, overCanvas: false };
    const x0 = camera.x;
    input.update(0.1);
    expect(camera.x).toBeLessThan(x0); // edge pan works while inside
    const x1 = camera.x;
    input.reset(); // window blur
    input.update(0.1);
    input.update(0.1);
    expect(camera.x).toBe(x1);
  });
});
