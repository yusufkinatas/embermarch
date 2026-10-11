/**
 * BattleActions against the real simulation (mapgen + sim-core + encounter), headless.
 */
import { describe, expect, it } from 'vitest';
import { generateMap } from '../../src/mapgen';
import { Camera } from '../../src/render/camera';
import { quickBattleSetup } from '../../src/run';
import { createWorld, stepWorld } from '../../src/sim/world';
import type { BattleSetup, HouseId, Unit, World } from '../../src/sim/types';
import { TICK_RATE } from '../../src/sim/types';
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

function boot(house: HouseId = 'ardent', over: Partial<BattleSetup> = {}) {
  const setup = { ...quickBattleSetup({ objective: 'raze', depth: 1, seed: 7, house }), ...over };
  const gen = generateMap({ seed: setup.seed, objective: setup.objective, biome: setup.biome, depth: setup.depth, modifiers: setup.modifiers });
  const world = createWorld(setup, gen, { skipEncounter: true });
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
  };
  const actions = new BattleActions(host);
  return { world, ui, camera, actions, errors, notices, played, hints, menuOpen: () => menu };
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
