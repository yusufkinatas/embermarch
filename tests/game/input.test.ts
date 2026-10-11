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
import { BattleInput, DOUBLE_CLICK_SLOP_PX, TOUCH_PAN_PX, isDoubleClick } from '../../src/game/input';
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
  const canvas = {
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }),
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => false,
  } as unknown as HTMLCanvasElement;
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

/** Drive the private pointer handlers with plain event objects (no DOM). */
function pointers(input: BattleInput) {
  const h = input as unknown as Record<'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel', (e: Partial<PointerEvent>) => void>;
  const ev = (pointerId: number, x: number, y: number, pointerType = 'touch', button = 0): Partial<PointerEvent> => ({
    pointerId,
    pointerType,
    button,
    clientX: x,
    clientY: y,
    shiftKey: false,
    preventDefault() {},
  });
  return {
    down: (id: number, x: number, y: number, type = 'touch') => h.onPointerDown(ev(id, x, y, type)),
    move: (id: number, x: number, y: number, type = 'touch') => h.onPointerMove(ev(id, x, y, type)),
    up: (id: number, x: number, y: number, type = 'touch') => h.onPointerUp(ev(id, x, y, type)),
    cancel: (id: number) => h.onPointerCancel(ev(id, 0, 0)),
    tap(id: number, x: number, y: number) {
      this.down(id, x, y);
      this.up(id, x, y);
    },
  };
}

describe('touch: tap to select, tap the ground to move or attack, drag to pan (final fix pass B2)', () => {
  it('a tap on a Tiller selects it; a tap on open ground moves it', () => {
    const { world, ui, camera, input } = boot();
    const p = pointers(input);
    const tiller = world.units.find((u) => u.alive && u.owner === 0 && u.type === 'tiller')!;
    const s = camera.worldToScreen(tiller.x, tiller.y);
    p.tap(1, s.x, s.y);
    expect(ui.selection).toEqual([tiller.id]);
    // Find open ground about 2 tiles away that picks nothing.
    const actions = (input as unknown as { host: { actions: BattleActions } }).host.actions;
    let goal: { x: number; y: number } | null = null;
    for (let a = 0; a < 16 && !goal; a++) {
      const x = tiller.x + Math.cos((a / 16) * Math.PI * 2) * 2;
      const y = tiller.y + Math.sin((a / 16) * Math.PI * 2) * 2;
      const t = world.map.terrain[Math.floor(y) * world.map.w + Math.floor(x)];
      if (t === Terrain.Grass && !actions.pick(x, y)) goal = { x, y };
    }
    expect(goal).not.toBeNull();
    const g = camera.worldToScreen(goal!.x, goal!.y);
    p.tap(2, g.x, g.y);
    expect(ui.selection).toEqual([tiller.id]); // still selected
    expect(tiller.order.type).toBe('move');
  });

  it('a one-finger drag pans the camera and neither selects nor commands', () => {
    const { world, ui, camera, input, actions } = boot();
    camera.centerOn(world.map.w / 2, world.map.h / 2);
    const tiller = world.units.find((u) => u.alive && u.owner === 0 && u.type === 'tiller')!;
    actions.setSelection([tiller.id], false);
    const before = tiller.order.type;
    const p = pointers(input);
    const x0 = camera.x;
    const y0 = camera.y;
    p.down(1, 600, 400);
    p.move(1, 600 - TOUCH_PAN_PX / 2, 400); // under the threshold: no pan yet
    expect(camera.x).toBe(x0);
    for (let i = 1; i <= 10; i++) p.move(1, 600 - i * 15, 400 - i * 6);
    p.up(1, 450, 340);
    // The finger moved 150 px; the first 5 px (under the pan threshold) are not applied.
    expect(camera.x - x0).toBeCloseTo((150 - TOUCH_PAN_PX / 2) / camera.scale, 2);
    expect(camera.x - x0).toBeGreaterThan(4);
    expect(camera.y).toBeGreaterThan(y0);
    expect(ui.selection).toEqual([tiller.id]);
    expect(ui.box).toBeNull();
    expect(tiller.order.type).toBe(before);
  });

  it('two fingers pinch-zoom around their midpoint; lifting them never taps', () => {
    const { world, ui, camera, input } = boot();
    camera.zoom = 1;
    camera.centerOn(world.map.w / 2, world.map.h / 2);
    const p = pointers(input);
    p.down(1, 600, 400);
    p.down(2, 700, 400);
    p.move(2, 760, 400);
    p.move(1, 540, 400);
    expect(camera.zoom).toBeGreaterThan(1.2);
    p.up(1, 540, 400);
    p.up(2, 760, 400);
    expect(ui.selection).toEqual([]);
  });

  it('pointercancel clears the touch: a later lift does nothing', () => {
    const { world, ui, camera, input } = boot();
    const p = pointers(input);
    const tiller = world.units.find((u) => u.alive && u.owner === 0 && u.type === 'tiller')!;
    const s = camera.worldToScreen(tiller.x, tiller.y);
    p.down(1, s.x, s.y);
    p.cancel(1);
    p.up(1, s.x, s.y);
    expect(ui.selection).toEqual([]);
  });

  it('a mouse drag still box-selects (desktop unchanged)', () => {
    const { world, ui, camera, input } = boot();
    const p = pointers(input);
    const tillers = world.units.filter((u) => u.alive && u.owner === 0 && u.type === 'tiller');
    const xs = tillers.map((u) => camera.worldToScreen(u.x, u.y));
    const x0 = Math.min(...xs.map((q) => q.x)) - 20;
    const y0 = Math.min(...xs.map((q) => q.y)) - 20;
    const x1 = Math.max(...xs.map((q) => q.x)) + 20;
    const y1 = Math.max(...xs.map((q) => q.y)) + 20;
    const cx = camera.x;
    p.down(1, x0, y0, 'mouse');
    p.move(1, x1, y1, 'mouse');
    expect(ui.box).not.toBeNull();
    p.up(1, x1, y1, 'mouse');
    expect(camera.x).toBe(cx);
    expect(ui.selection.length).toBeGreaterThanOrEqual(tillers.length);
  });
});
