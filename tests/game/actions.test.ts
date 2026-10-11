/**
 * BattleActions against the real simulation (mapgen + sim-core + encounter), headless.
 */
import { describe, expect, it } from 'vitest';
import { generateMap } from '../../src/mapgen';
import { Camera } from '../../src/render/camera';
import { quickBattleSetup } from '../../src/run';
import { createWorld, stepWorld } from '../../src/sim/world';
import type { BattleSetup, Building, HouseId, Unit, World } from '../../src/sim/types';
import { TICK_RATE, Terrain } from '../../src/sim/types';
import { BattleActions, type ActionHost } from '../../src/game/actions';
import { AlertFeed } from '../../src/game/alerts';
import { HintDirector } from '../../src/game/hints';
import { createBattleUIState, type AudioSystem, type SfxName } from '../../src/game/types';

function fakeAudio(played: SfxName[]): AudioSystem {
  let muted = false;
  return {
    unlock() {},
    play(name) {
      played.push(name);
    },
    handleEvents() {},
    setListener() {},
    setCombatIntensity() {},
    setVolume() {},
    setMuted(m) {
      muted = m;
    },
    get muted() {
      return muted;
    },
    setAmbient() {},
  };
}

function boot(house: HouseId = 'ardent', over: Partial<BattleSetup> = {}, opts: { encounter?: boolean } = {}) {
  const setup = { ...quickBattleSetup({ objective: 'raze', depth: 1, seed: 7, house }), ...over };
  const gen = generateMap({ seed: setup.seed, objective: setup.objective, biome: setup.biome, depth: setup.depth, modifiers: setup.modifiers });
  const world = createWorld(setup, gen, { skipEncounter: !opts.encounter });
  const ui = createBattleUIState();
  const camera = new Camera();
  camera.setMapSize(world.map.w, world.map.h);
  camera.setViewport(1280, 720);
  const hearth = world.entities.get(world.hearthId)!;
  camera.centerOn(hearth.x, hearth.y);
  const errors: string[] = [];
  const notices: string[] = [];
  const played: SfxName[] = [];
  let menu = false;
  let invalidations = 0;
  const hints = new HintDirector([], true);
  const host: ActionHost = {
    world,
    ui,
    camera,
    setup,
    audio: fakeAudio(played),
    alerts: new AlertFeed(),
    hints,
    error: (m) => errors.push(m),
    notice: (m) => notices.push(m),
    menuOpen: () => menu,
    openMenu: () => {
      menu = true;
    },
    closeMenu: () => {
      menu = false;
    },
    ended: () => false,
    onMuteChanged() {},
    invalidateHud: () => {
      invalidations++;
    },
  };
  const actions = new BattleActions(host);
  return { world, ui, camera, actions, errors, notices, played, hints, menuOpen: () => menu, invalidations: () => invalidations };
}

/** First valid placement spot for a building around the Hearth (ghost re-checked via updatePlacement). */
function findSpot(world: World, ui: ReturnType<typeof createBattleUIState>, actions: BattleActions, from = 4, avoid: { x: number; y: number }[] = []): { x: number; y: number } | null {
  const hearth = world.entities.get(world.hearthId)!;
  for (let r = from; r < 14; r++) {
    for (let a = 0; a < 24; a++) {
      const x = hearth.x + Math.cos((a / 24) * Math.PI * 2) * r;
      const y = hearth.y + Math.sin((a / 24) * Math.PI * 2) * r;
      if (avoid.some((p) => Math.hypot(p.x - x, p.y - y) < 5)) continue;
      actions.updatePlacement(x, y);
      if (ui.placement?.ok) return { x, y };
    }
  }
  return null;
}

/** A grass tile next to a forest tile with Timber, plus that tree tile (explored, near the Hearth). */
function forestEdge(world: World): { tree: number; tx: number; ty: number; gx: number; gy: number; far: { x: number; y: number } } {
  const { map } = world;
  const hearth = world.entities.get(world.hearthId)!;
  let best: { tree: number; tx: number; ty: number; gx: number; gy: number; d: number } | null = null;
  for (let ty = 1; ty < map.h - 1; ty++) {
    for (let tx = 1; tx < map.w - 1; tx++) {
      const tile = ty * map.w + tx;
      if (map.terrain[tile] !== Terrain.Forest || map.treeAmount[tile] <= 0) continue;
      // Grass directly east, with open grass for 3 more tiles (no other forest within reach of the click).
      const open = [1, 2, 3, 4].every((k) => map.terrain[ty * map.w + tx + k] === Terrain.Grass && map.terrain[(ty - 1) * map.w + tx + k] === Terrain.Grass && map.terrain[(ty + 1) * map.w + tx + k] === Terrain.Grass);
      if (!open) continue;
      const d = Math.hypot(tx - hearth.x, ty - hearth.y);
      if (!best || d < best.d) best = { tree: tile, tx, ty, gx: tx + 1, gy: ty, d };
    }
  }
  if (!best) throw new Error('no forest edge');
  return { ...best, far: { x: best.tx + 3.5, y: best.ty + 0.5 } };
}

function step(world: World, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) stepWorld(world);
}

function own(world: World, type: string): Unit[] {
  return world.units.filter((u) => u.alive && u.owner === 0 && u.type === type);
}

function bbox(units: Unit[], pad = 0.6): [number, number, number, number] {
  const xs = units.map((u) => u.x);
  const ys = units.map((u) => u.y);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

describe('BattleActions on a real battle', () => {
  it('box select prefers military + Warden; Tillers only without them', () => {
    const { world, ui, actions } = boot();
    const everyone = world.units.filter((u) => u.owner === 0);
    actions.boxSelect(...bbox(everyone), false);
    const types = new Set(ui.selection.map((id) => (world.entities.get(id) as Unit).type));
    expect(types.has('tiller')).toBe(false);
    expect(types.has('warden')).toBe(true);
    const tillers = own(world, 'tiller');
    // A box around a single Tiller only.
    const t = tillers[0];
    actions.boxSelect(t.x - 0.2, t.y - 0.2, t.x + 0.2, t.y + 0.2, false);
    expect(ui.selection).toEqual([t.id]);
  });

  it('right-click a Thicket with Tillers gathers Grain', () => {
    const { world, ui, actions, hints } = boot();
    const hearth = world.entities.get(world.hearthId)!;
    const thicket = world.resources
      .filter((r) => r.type === 'thicket')
      .sort((a, b) => Math.hypot(a.x - hearth.x, a.y - hearth.y) - Math.hypot(b.x - hearth.x, b.y - hearth.y))[0];
    const tillers = own(world, 'tiller').slice(0, 2);
    actions.setSelection(tillers.map((u) => u.id));
    expect(ui.selection.length).toBe(2);
    actions.smartAt(thicket.x, thicket.y, false);
    expect(tillers.every((u) => u.order.type === 'gather')).toBe(true);
    hints.evaluate({ time: 0, countdown: 3, timber: 0, pop: 0, popCap: 20, militaryBuildings: 1, nearThicketFrac: 1 });
    expect(hints.update(0).current?.id).toBe('train_tiller');
    const before = world.players[0].stats.gathered.grain;
    step(world, 35);
    expect(world.players[0].stats.gathered.grain).toBeGreaterThan(before);
  });

  it('H then Q trains a Tiller; Shift+Q queues up to 5', () => {
    const { world, actions } = boot();
    const hearth = world.buildings.find((b) => b.id === world.hearthId)!;
    const grain = world.players[0].res.grain;
    actions.selectHearth();
    expect(actions.cardKey('Q', false)).toBe(true);
    expect(hearth.queue.length).toBe(1);
    expect(world.players[0].res.grain).toBe(grain - 50);
    actions.cardKey('Q', true);
    expect(hearth.queue.length).toBe(5);
  });

  it('C with Tillers enters placement; LMB places a Cottage; Shift keeps placing', () => {
    const { world, ui, actions } = boot();
    const tillers = own(world, 'tiller').slice(0, 3);
    actions.setSelection(tillers.map((u) => u.id));
    expect(actions.cardKey('C', false)).toBe(true);
    expect(ui.placement?.building).toBe('cottage');
    const hearth = world.entities.get(world.hearthId)!;
    let spot: { x: number; y: number } | null = null;
    for (let r = 4; r < 12 && !spot; r++) {
      for (let a = 0; a < 16 && !spot; a++) {
        const x = hearth.x + Math.cos((a / 16) * Math.PI * 2) * r;
        const y = hearth.y + Math.sin((a / 16) * Math.PI * 2) * r;
        actions.updatePlacement(x, y);
        if (ui.placement?.ok) spot = { x, y };
      }
    }
    expect(spot).not.toBeNull();
    const timber = world.players[0].res.timber;
    actions.placeAt(spot!.x, spot!.y, true);
    expect(world.buildings.some((b) => b.type === 'cottage' && !b.built)).toBe(true);
    expect(world.players[0].res.timber).toBe(timber - 40);
    expect(ui.placement).not.toBeNull(); // Shift keeps placing
    actions.cancelModes();
    expect(ui.placement).toBeNull();
    expect(tillers.some((u) => u.order.type === 'build')).toBe(true);
  });

  it('Warden Q: Ardent fires at once, Grimbrand enters ground targeting', () => {
    const a = boot('ardent');
    a.actions.selectWarden();
    expect(a.actions.cardKey('Q', false)).toBe(true);
    expect(a.ui.targeting).toBeNull();
    expect(a.world.players[0].abilityReadyTick.Q).toBeGreaterThan(a.world.tick);

    const g = boot('grimbrand');
    g.actions.selectWarden();
    g.actions.cardKey('Q', false);
    expect(g.ui.targeting).toMatchObject({ kind: 'ability', slot: 'Q', radius: 2, range: 7 });
    const w = g.world.entities.get(g.world.wardenId)!;
    g.actions.targetAt(w.x + 3, w.y, false);
    expect(g.ui.targeting).toBeNull();
    expect(g.world.players[0].abilityReadyTick.Q).toBeGreaterThan(g.world.tick);
  });

  it('A then click attack-moves; S stops; G holds', () => {
    const { world, ui, actions } = boot();
    const courser = own(world, 'courser')[0];
    actions.setSelection([courser.id]);
    actions.startAttackMove();
    expect(ui.targeting).toEqual({ kind: 'attackMove' });
    actions.targetAt(courser.x + 5, courser.y, false);
    expect(ui.targeting).toBeNull();
    expect(courser.order.type).toBe('attackMove');
    actions.stop();
    expect(courser.order.type).toBe('idle');
    actions.hold();
    expect(courser.order.type).toBe('hold');
  });

  it('Esc chain: cancel mode, then deselect, then pause menu', () => {
    const { world, ui, actions, menuOpen } = boot();
    actions.setSelection([own(world, 'courser')[0].id]);
    actions.startAttackMove();
    actions.escape();
    expect(ui.targeting).toBeNull();
    expect(ui.selection.length).toBe(1);
    actions.escape();
    expect(ui.selection.length).toBe(0);
    actions.escape();
    expect(menuOpen()).toBe(true);
    actions.escape();
    expect(menuOpen()).toBe(false);
  });

  it('control groups assign / recall; idle Tiller cycling; select all military', () => {
    const { world, ui, actions, camera } = boot();
    const courser = own(world, 'courser')[0];
    actions.setSelection([courser.id]);
    actions.groupOp(2, 'assign');
    actions.deselect();
    actions.groupOp(2, 'recall');
    expect(ui.selection).toEqual([courser.id]);
    actions.cycleIdleTiller();
    const first = ui.selection[0];
    expect((world.entities.get(first) as Unit).type).toBe('tiller');
    const cx = camera.x;
    actions.cycleIdleTiller();
    expect(ui.selection[0]).not.toBe(first);
    expect(Number.isFinite(cx)).toBe(true);
    actions.selectAllMilitary();
    expect(ui.selection).toContain(courser.id);
  });

  it('Delete cancels a foundation at once and needs a second press for built buildings', () => {
    const { world, ui, actions, notices } = boot();
    const muster = world.buildings.find((b) => b.owner === 0 && b.type === 'muster_hall')!;
    actions.setSelection([muster.id]);
    actions.demolishSelected();
    expect(muster.alive).toBe(true);
    expect(notices.some((n) => n.includes('Delete again'))).toBe(true);
    actions.demolishSelected();
    step(world, 0.1);
    expect(muster.alive).toBe(false);
    expect(ui.selection.length).toBe(1); // pruned by the controller each frame, not here
  });

  it('disabled options report their reason instead of acting', () => {
    const { world, actions, errors } = boot();
    world.players[0].res.grain = 0;
    actions.selectHearth();
    actions.cardKey('Q', false);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/Grain/);
  });
});

describe('battle-lane fixes (BattleActions)', () => {
  it('B1: T+click, then Shift+C + Shift+click queues the Cottage behind the tower; both complete', () => {
    const { world, ui, actions } = boot();
    world.debug.revealAll = true;
    world.players[0].res = { grain: 500, timber: 500, ember: 200 };
    const tiller = own(world, 'tiller')[0];
    actions.setSelection([tiller.id]);
    expect(actions.cardKey('T', false)).toBe(true);
    expect(ui.placement?.building).toBe('brazier_tower');
    const a = findSpot(world, ui, actions)!;
    actions.placeAt(a.x, a.y, false);
    expect(ui.placement).toBeNull();
    const tower = world.buildings.find((b) => b.type === 'brazier_tower' && b.owner === 0 && !b.built)!;
    expect(tiller.order).toMatchObject({ type: 'build', buildingId: tower.id });

    expect(actions.cardKey('C', true)).toBe(true);
    const c = findSpot(world, ui, actions, 4, [a])!;
    actions.placeAt(c.x, c.y, true);
    const cottage = world.buildings.find((b) => b.type === 'cottage' && b.owner === 0 && !b.built)!;
    expect(cottage).toBeDefined();
    expect(tiller.order).toMatchObject({ type: 'build', buildingId: tower.id });
    expect(tiller.queue).toEqual([{ type: 'build', buildingId: cottage.id }]);
    actions.cancelModes();

    step(world, 90);
    expect((world.entities.get(tower.id) as Building).built).toBe(true);
    expect((world.entities.get(cottage.id) as Building).built).toBe(true);
  });

  it('B1: a first Shift-placement by a gathering Tiller still starts the build at once', () => {
    const { world, ui, actions } = boot();
    const hearth = world.entities.get(world.hearthId)!;
    const thicket = world.resources.filter((r) => r.type === 'thicket').sort((p, q) => Math.hypot(p.x - hearth.x, p.y - hearth.y) - Math.hypot(q.x - hearth.x, q.y - hearth.y))[0];
    const tiller = own(world, 'tiller')[0];
    actions.setSelection([tiller.id]);
    actions.smartAt(thicket.x, thicket.y, false);
    expect(tiller.order.type).toBe('gather');
    actions.cardKey('C', true);
    const c = findSpot(world, ui, actions)!;
    actions.placeAt(c.x, c.y, true);
    expect(tiller.order.type).toBe('build');
    expect(tiller.queue.length).toBe(0);
  });

  it('B3: changing speed while paused keeps the pause and says so', () => {
    const { ui, actions, notices } = boot();
    actions.togglePause();
    expect(ui.paused).toBe(true);
    actions.setSpeed(2);
    expect(ui.speed).toBe(2);
    expect(ui.paused).toBe(true);
    expect(notices.at(-1)).toBe('Speed 2× · still paused');
    actions.stepSpeed(-1);
    expect(ui.paused).toBe(true);
    expect(notices.at(-1)).toBe('Speed 1.5× · still paused');
    actions.togglePause();
    expect(ui.paused).toBe(false);
    expect(ui.speed).toBe(1.5);
  });

  it('B4: a right-click on grass 0.4 tiles from a tree gathers it; open grass still moves', () => {
    const { world, actions } = boot();
    world.debug.revealAll = true;
    const edge = forestEdge(world);
    const tillers = own(world, 'tiller').slice(0, 2);
    const courser = own(world, 'courser')[0];
    actions.setSelection([...tillers.map((u) => u.id), courser.id]);
    // 0.4 tiles east of the tree tile's right edge, on grass.
    actions.smartAt(edge.tx + 1.4, edge.ty + 0.5, false);
    for (const u of tillers) {
      expect(u.order.type).toBe('gather');
      const t = (u.order as { target: { kind: string; tile?: number } }).target;
      expect(t.kind).toBe('tree');
    }
    expect(['move', 'idle']).toContain(courser.order.type);
    if (courser.order.type === 'move') expect(courser.order.x).toBeCloseTo(edge.tx + 1.4, 3);

    actions.setSelection(tillers.map((u) => u.id));
    actions.smartAt(edge.far.x, edge.far.y, false);
    for (const u of tillers) expect(u.order.type).toBe('move');
  });

  it('B4: canopyTreeAt picks the overhung tree within reach only', () => {
    const { world, actions } = boot();
    world.debug.revealAll = true;
    const edge = forestEdge(world);
    expect(actions.canopyTreeAt(edge.tx + 1.4, edge.ty + 0.5)).toBe(edge.tree);
    expect(actions.canopyTreeAt(edge.tx + 1.7, edge.ty + 0.5)).toBeNull();
  });

  it('B7: every selection change asks the HUD to repaint', () => {
    const { world, actions, invalidations } = boot();
    const before = invalidations();
    actions.selectWarden();
    actions.selectHearth();
    expect(invalidations()).toBe(before + 2);
    expect(world.hearthId).toBeGreaterThan(0);
  });

  it("B8: ',' then Shift+` adds the Warden to the army; ` alone selects only the Warden", () => {
    const { world, ui, actions } = boot();
    actions.selectAllMilitary();
    const army = ui.selection.filter((id) => id !== world.wardenId);
    // Box-style "all military" includes the Warden already; drop it to model the tester's selection.
    actions.setSelection(army);
    expect(ui.selection).not.toContain(world.wardenId);
    actions.selectWarden(true);
    expect(ui.selection).toEqual([...army, world.wardenId]);
    actions.selectWarden(false);
    expect(ui.selection).toEqual([world.wardenId]);
  });

  it('B8: double-tap ` still centres on the Warden (with or without Shift)', () => {
    const { world, camera, actions, ui } = boot();
    const w = world.entities.get(world.wardenId)!;
    camera.centerOn(w.x, w.y); // expected (clamped) camera position
    const want = { x: camera.x, y: camera.y };
    camera.centerOn(world.map.w - 5, world.map.h - 5);
    expect(Math.hypot(camera.x - want.x, camera.y - want.y)).toBeGreaterThan(3);
    actions.selectWarden(true);
    actions.selectWarden(true);
    expect(ui.selection).toContain(world.wardenId);
    expect(camera.x).toBeCloseTo(want.x, 5);
    expect(camera.y).toBeCloseTo(want.y, 5);
  });

  it('B12b: releasing Shift after queued attack-move waypoints ends the mode', () => {
    const { world, ui, actions } = boot();
    const courser = own(world, 'courser')[0];
    actions.setSelection([courser.id]);
    actions.startAttackMove();
    actions.shiftReleased();
    expect(ui.targeting).toEqual({ kind: 'attackMove' }); // nothing queued yet: still armed
    actions.targetAt(courser.x + 4, courser.y, true);
    actions.targetAt(courser.x + 6, courser.y + 2, true);
    expect(ui.targeting).toEqual({ kind: 'attackMove' });
    actions.shiftReleased();
    expect(ui.targeting).toBeNull();
    expect(courser.order.type).toBe('attackMove');
    expect(courser.queue.length).toBe(1);
  });
});

describe('final fix pass: A-click on an enemy is a direct attack (B1)', () => {
  it('A then click on an enemy Nest issues an attack on it for every selected unit', () => {
    const { world, ui, actions, played } = boot('ardent', {}, { encounter: true });
    world.debug.revealAll = true;
    const nest = world.buildings.find((b) => b.alive && b.owner === 1 && b.type === 'thorn_nest');
    expect(nest).toBeTruthy();
    const army = [...own(world, 'courser'), ...own(world, 'warden')];
    expect(army.length).toBeGreaterThanOrEqual(2);
    actions.setSelection(army.map((u) => u.id));
    actions.startAttackMove();
    actions.targetAt(nest!.x, nest!.y, false);
    expect(ui.targeting).toBeNull();
    for (const u of army) {
      expect(u.order.type).toBe('attack');
      expect((u.order as { targetId: number }).targetId).toBe(nest!.id);
    }
    expect(played).toContain('acknowledge');
  });

  it('a ground click still attack-moves; Shift queues the direct attack as a waypoint', () => {
    const { world, ui, actions } = boot('ardent', {}, { encounter: true });
    world.debug.revealAll = true;
    const nest = world.buildings.find((b) => b.alive && b.owner === 1 && b.type === 'thorn_nest')!;
    const courser = own(world, 'courser')[0];
    actions.setSelection([courser.id]);
    actions.startAttackMove();
    actions.targetAt(courser.x + 4, courser.y, true);
    expect(courser.order.type).toBe('attackMove');
    actions.targetAt(nest.x, nest.y, true);
    expect(ui.targeting).toEqual({ kind: 'attackMove' });
    expect(courser.queue.map((o) => o.type)).toEqual(['attack']);
    expect((courser.queue[0] as { targetId: number }).targetId).toBe(nest.id);
  });

  it('minimap A-clicks (allowTarget false) stay attack-moves even over a Nest', () => {
    const { world, actions } = boot('ardent', {}, { encounter: true });
    world.debug.revealAll = true;
    const nest = world.buildings.find((b) => b.alive && b.owner === 1 && b.type === 'thorn_nest')!;
    const courser = own(world, 'courser')[0];
    actions.setSelection([courser.id]);
    actions.startAttackMove();
    actions.targetAt(nest.x, nest.y, false, false);
    expect(courser.order.type).toBe('attackMove');
  });

  it('an unexplored Nest is not picked: the click attack-moves', () => {
    const { world, actions } = boot('ardent', {}, { encounter: true });
    const nest = world.buildings.find((b) => b.alive && b.owner === 1 && b.type === 'thorn_nest')!;
    const courser = own(world, 'courser')[0];
    actions.setSelection([courser.id]);
    actions.startAttackMove();
    actions.targetAt(nest.x, nest.y, false);
    expect(courser.order.type).toBe('attackMove');
  });
});
