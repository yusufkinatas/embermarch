/**
 * Battle controller: owns the World, fixed-step loop, renderer, HUD, input, audio and the
 * window.__game debug API while a battle is mounted. OWNER: battle-shell.
 *
 * Frame order: input pan → fixed-step sim (accumulator, speed, active pause, slowmo, ≤ 5 ticks)
 * → drain events once (renderer, audio, HUD) → outcome check → prune selection → render with
 * interpolation alpha → HUD refresh.
 */
import '../styles/hud.css';
import { OBJECTIVES } from '../data/objectives';
import { generateMap } from '../mapgen';
import { getAudio } from '../audio/sfx';
import { createRenderer } from '../render/renderer';
import { isEntityVisible } from '../sim/queries';
import type { BattleResult, BattleSetup, Entity, World } from '../sim/types';
import { ENEMY, PLAYER, TICK_RATE } from '../sim/types';
import { buildBattleResult, createWorld, drainEvents, stepWorld } from '../sim/world';
import { BattleActions, type ActionHost } from './actions';
import { BattleCamera } from './battleCamera';
import { AlertFeed } from './alerts';
import { installDebugApi } from './debug';
import { h } from './dom';
import { HintDirector } from './hints';
import { loadKeyboardLayout } from './keys';
import { BOTTOM_PANEL_PX, Hud, maxZoomFor, startZoom, TOP_BAR_PX } from './hud/hud';
import type { MenuSettings } from './hud/pauseMenu';
import { BattleInput } from './input';
import { FixedStepLoop } from './loop';
import { isOwnBuilding, isOwnUnit, pruneSelection } from './selection';
import type { AudioSystem, BattleCallbacks, BattleControllerLike, BattleOptions, BattleUIState, Renderer } from './types';
import { createBattleUIState } from './types';

/** Seconds the victory / defeat banner shows before callbacks.onEnd. */
export const END_DELAY = 2.5;
/** Seconds the Retreat banner shows before callbacks.onEnd. */
export const RETREAT_DELAY = 1.2;
/** Sim speed while the end banner shows (dramatic slow-down). */
const END_SPEED = 0.4;


const VICTORY_TEXT: Record<string, string> = {
  raze: 'The Nests burn.',
  holdfast: 'The Hearth holds.',
  beacons: 'The Beacons blaze.',
  elite: 'The Antlered Lord is slain.',
  boss: 'The Briar Regent is slain.',
};

/** Silent audio stand-in if the audio module fails to initialise (the battle must still run). */
function silentAudio(): AudioSystem {
  let muted = false;
  return {
    unlock() {},
    play() {},
    handleEvents() {},
    setListener() {},
    setCombatIntensity() {},
    setVolume() {},
    setMuted(m: boolean) {
      muted = m;
    },
    get muted() {
      return muted;
    },
    setAmbient() {},
  };
}

export class BattleController implements BattleControllerLike {
  readonly world: World;
  readonly setup: BattleSetup;
  readonly ui: BattleUIState;
  readonly camera: BattleCamera;
  readonly actions: BattleActions;
  private readonly callbacks: BattleCallbacks;
  private readonly container: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: Renderer;
  private readonly audio: AudioSystem;
  private readonly hud: Hud;
  private readonly input: BattleInput;
  private readonly loop: FixedStepLoop;
  private readonly alerts = new AlertFeed();
  private readonly hints: HintDirector;
  private readonly settings: MenuSettings & { panSpeed: number };
  private raf = 0;
  private lastFrame = 0;
  private started = false;
  private destroyed = false;
  private menuIsOpen = false;
  private pausedBeforeMenu = false;
  private endResult: BattleResult | null = null;
  private endAt = 0;
  private endFired = false;
  private retreating = false;
  private frameNo = 0;
  private combatAcc = 0;
  private uninstallDebug: (() => void) | null = null;
  private resizeObs: ResizeObserver | null = null;
  private readonly errorsLogged = new Set<string>();
  private readonly onWindowResize = (): void => this.resize();

  constructor(root: HTMLElement, setup: BattleSetup, callbacks: BattleCallbacks, opts: BattleOptions = {}) {
    this.setup = setup;
    this.callbacks = callbacks;

    const gen = generateMap({
      seed: setup.seed,
      objective: setup.objective,
      biome: setup.biome,
      depth: setup.depth,
      modifiers: setup.modifiers,
    });
    this.world = createWorld(setup, gen);
    this.ui = createBattleUIState();
    this.camera = new BattleCamera();
    this.camera.setMapSize(this.world.map.w, this.world.map.h);

    this.container = h('div', 'bt-root', root);
    this.container.tabIndex = -1;
    this.canvas = h('canvas', 'bt-canvas', this.container);
    this.renderer = createRenderer(this.canvas);

    let audio: AudioSystem;
    try {
      audio = getAudio();
    } catch (err) {
      console.error('[battle] audio unavailable', err);
      audio = silentAudio();
    }
    this.audio = audio;
    this.settings = {
      volume: opts.sfxVolume ?? 0.8,
      muted: opts.muted ?? this.safe('audio', () => audio.muted) ?? false,
      edgePan: opts.edgePan ?? true,
      panSpeed: opts.panSpeed ?? 1,
    };
    this.safe('audio', () => {
      audio.setVolume(this.settings.volume);
      audio.setMuted(this.settings.muted);
    });

    // Both the player's setting and the run's decision (first runs / unseen hints) must allow hints.
    this.hints = new HintDirector(opts.hintsSeen ?? [], (opts.showHints ?? true) && setup.showHints);
    this.actions = new BattleActions(this.actionHost());
    this.hud = new Hud(
      this.container,
      { world: this.world, ui: this.ui, camera: this.camera, setup, actions: this.actions, renderer: this.renderer },
      this.hints,
      this.alerts,
      {
        world: this.world,
        setup,
        resume: () => this.closeMenu(),
        retreat: () => this.soundRetreat(),
        quit: () => this.quitToTitle(),
        settings: () => ({ volume: this.settings.volume, muted: this.settings.muted, edgePan: this.settings.edgePan }),
        applySettings: (s) => this.applySettings(s),
      },
      {
        topBand: (px) => {
          this.camera.topBand = px;
        },
        openMenu: () => this.openMenu(),
        dismissHint: () => this.dismissHint(),
        hintSeen: (id) => this.safe('onHintSeen', () => this.callbacks.onHintSeen?.(id)),
      },
    );
    this.input = new BattleInput(this.canvas, this.container, {
      world: this.world,
      ui: this.ui,
      camera: this.camera,
      actions: this.actions,
      edgePan: () => this.settings.edgePan,
      panSpeed: () => this.settings.panSpeed,
      modalOpen: () => this.menuIsOpen || this.endResult !== null,
      // Called on pointerdown, keydown and pointerup (a touch pointerdown is not a user activation).
      gesture: () => this.safe('audio', () => this.audio.unlock()),
      layoutChanged: () => this.hud.invalidate(),
    });
    this.loop = new FixedStepLoop(() => this.tick());

    this.resize();
    // Large screens start closer so the map fills the view (no black side bars at 2560×1440).
    this.camera.zoom = Math.min(this.camera.maxZoom, Math.max(this.camera.minZoom, startZoom(this.camera.viewH)));
    this.centerOnHearth();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;
    this.input.attach();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(this.container);
    }
    window.addEventListener('resize', this.onWindowResize);
    this.uninstallDebug = installDebugApi({
      world: this.world,
      ui: this.ui,
      camera: this.camera,
      debugStep: (s) => this.debugStep(s),
      debugSelect: (ids) => this.actions.setSelection(ids, false),
      isEnded: () => this.endFired,
      renderStats: () => {
        const r = this.renderer as Renderer & { stats?: Record<string, number> };
        return r.stats ? { ...r.stats } : null;
      },
    });
    this.safe('audio', () => {
      this.audio.setAmbient(true);
      // Mounted from a click (Begin battle)? Then the AudioContext may start now; else on the first gesture.
      const act = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
      if (act?.isActive) this.audio.unlock();
    });
    this.container.focus({ preventScroll: true });
    // Hotkey labels follow the player's keyboard layout (QWERTZ / AZERTY); bindings stay on e.code.
    void loadKeyboardLayout().then((ok) => {
      if (ok && !this.destroyed) this.hud.invalidate();
    });
    this.lastFrame = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.resizeObs?.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    this.uninstallDebug?.();
    this.uninstallDebug = null;
    this.safe('renderer.destroy', () => this.renderer.destroy());
    this.safe('audio', () => {
      this.audio.setCombatIntensity(0);
      this.audio.setAmbient(false);
    });
    this.container.remove();
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  private readonly frame = (t: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastFrame ? Math.min(0.25, Math.max(0, (t - this.lastFrame) / 1000)) : 1 / 60;
    this.lastFrame = t;
    const now = t / 1000;
    this.frameNo++;

    this.safe('input', () => this.input.update(dt));

    const ending = this.endResult !== null;
    this.loop.speed = this.ui.speed * (ending ? END_SPEED : 1);
    this.loop.paused = (this.ui.paused && !ending) || this.menuIsOpen || this.retreating || this.endFired;
    this.safe('step', () => this.loop.advance(dt));

    this.processEvents(now, true);
    this.checkOutcome(now);
    this.prune();
    if (this.ui.placement && this.frameNo % 6 === 0) {
      const m = this.ui.mouseWorld;
      if (Number.isFinite(m.x)) this.actions.updatePlacement(m.x, m.y);
    }
    if (this.frameNo % 6 === 0) this.input.refreshHover();

    this.safe('render', () => this.renderer.render(this.world, this.camera, this.ui, this.loop.alpha, dt));
    this.safe('hud', () => this.hud.update(dt, now, this.menuIsOpen));
    this.updateAudio(dt);

    if (this.endResult && !this.endFired && now >= this.endAt) this.fireEnd();
  };

  private tick(): void {
    stepWorld(this.world);
  }

  private processEvents(now: number, withAudio: boolean): void {
    const events = drainEvents(this.world);
    if (!events.length) return;
    this.safe('renderer.handleEvents', () => this.renderer.handleEvents(events, this.world));
    if (withAudio) this.safe('audio.handleEvents', () => this.audio.handleEvents(events, this.world, this.camera));
    this.safe('hud.handleEvents', () => this.hud.handleEvents(events, now));
    for (const ev of events) if (ev.t === 'slowmo') this.loop.addSlowmo(ev.factor, ev.duration);
  }

  private checkOutcome(now: number): void {
    if (this.endResult || this.world.outcome === 'ongoing') return;
    const outcome = this.world.outcome;
    this.endResult = this.buildResult(outcome);
    this.endAt = now + END_DELAY;
    this.actions.cancelModes();
    this.closeMenu(true);
    this.ui.paused = false;
    this.ui.box = null;
    this.hud.banner.show(outcome, outcome === 'victory' ? VICTORY_TEXT[this.setup.objective] ?? OBJECTIVES[this.setup.objective].goal : 'The Hearth has fallen.');
    this.safe('audio', () => this.audio.play(outcome === 'victory' ? 'victory' : 'defeat'));
  }

  private buildResult(outcome: BattleResult['outcome']): BattleResult {
    try {
      return buildBattleResult(this.world, outcome);
    } catch (err) {
      console.error('[battle] buildBattleResult failed; reporting a minimal result', err);
      const p = this.world.players[PLAYER];
      return {
        outcome,
        time: this.world.time,
        objective: this.setup.objective,
        depth: this.setup.depth,
        plunderCrowns: 0,
        underPar: false,
        unbroken: false,
        uprooted: false,
        nestsDestroyed: 0,
        picketsDestroyed: 0,
        cachesLooted: 0,
        ancientCacheLooted: false,
        lordSlain: false,
        regentSlain: false,
        lastStandsUsed: this.world.lastStandsUsed,
        survivors: [],
        unspent: { ...p.res },
        stats: p.stats,
      };
    }
  }

  private fireEnd(): void {
    if (this.endFired || !this.endResult) return;
    this.endFired = true;
    const result = this.endResult;
    this.safe('onEnd', () => this.callbacks.onEnd(result));
  }

  /** Drop dead ids (and foreign entities that slipped into fog) from the selection and groups. */
  private prune(): void {
    pruneSelection(this.world, this.ui, (e: Entity) => isOwnUnit(e) || isOwnBuilding(e) || this.visible(e));
    if (this.ui.hoverId) {
      const e = this.world.entities.get(this.ui.hoverId);
      if (!e || !e.alive) this.ui.hoverId = 0;
    }
  }

  private visible(e: Entity): boolean {
    if (e.kind === 'resource') return true;
    try {
      return isEntityVisible(this.world, e);
    } catch {
      return true;
    }
  }

  private updateAudio(dt: number): void {
    const c = this.camera;
    const playH = c.viewH - c.bottomInset - c.topInset;
    const cx = c.x + c.viewW / 2 / c.scale;
    const cy = c.y + (c.topInset + playH / 2) / c.scale;
    this.safe('audio', () => this.audio.setListener(cx, cy));
    this.combatAcc += dt;
    if (this.combatAcc < 0.5) return;
    this.combatAcc = 0;
    // Combat drums: 5+ enemies within 12 tiles of any player building (§P).
    const blds = this.world.buildings.filter((b) => b.alive && b.owner === PLAYER);
    let n = 0;
    for (const u of this.world.units) {
      if (n >= 5) break;
      if (!u.alive || u.owner !== ENEMY) continue;
      if (blds.some((b) => Math.hypot(b.x - u.x, b.y - u.y) <= 12 + Math.max(b.w, b.h) / 2)) n++;
    }
    this.safe('audio', () => this.audio.setCombatIntensity(n >= 5 && this.world.outcome === 'ongoing' ? 1 : 0));
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  private resize(): void {
    if (this.destroyed) return;
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const hgt = Math.max(1, this.container.clientHeight || window.innerHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.safe('renderer.resize', () => this.renderer.resize(w, hgt, dpr));
    // Keep what the player looks at in view (setViewport alone keeps the top-left world point).
    const c = this.camera;
    const focus = c.focusPoint();
    const s = this.hud.layout(w, hgt, dpr);
    c.topInset = Math.round(TOP_BAR_PX * s);
    c.bottomInset = Math.round(BOTTOM_PANEL_PX * s);
    c.maxZoom = maxZoomFor(hgt);
    if (c.zoom > c.maxZoom) c.zoom = c.maxZoom;
    c.setViewport(w, hgt);
    c.centerOn(focus.x, focus.y);
  }

  private centerOnHearth(): void {
    const hearth = this.world.entities.get(this.world.hearthId);
    const a = this.world.anchors.hearth;
    this.camera.centerOn(hearth ? hearth.x : a.tx + 2, hearth ? hearth.y : a.ty + 2);
  }

  // ---------------------------------------------------------------------------
  // Menu, retreat, quit, settings, hints
  // ---------------------------------------------------------------------------

  private openMenu(): void {
    if (this.menuIsOpen || this.endResult) return;
    this.menuIsOpen = true;
    this.pausedBeforeMenu = this.ui.paused;
    this.ui.paused = true;
    this.actions.cancelModes();
    this.input.reset();
    this.hud.menu.open();
    this.safe('audio', () => this.audio.play('ui_click'));
  }

  /** Close the pause menu. Without `force`, Esc / Resume first step back from a sub-view. */
  private closeMenu(force = false): void {
    if (!this.menuIsOpen) return;
    if (!force && this.hud.menu.back()) return;
    this.menuIsOpen = false;
    this.ui.paused = this.pausedBeforeMenu;
    this.hud.menu.close();
    this.container.focus({ preventScroll: true });
  }

  private soundRetreat(): void {
    if (this.endResult) return;
    const result = this.buildResult('retreat');
    this.menuIsOpen = false;
    this.hud.menu.close();
    this.retreating = true;
    this.endResult = result;
    this.endAt = performance.now() / 1000 + RETREAT_DELAY;
    this.hud.banner.show('retreat', 'The Hearthband falls back.');
    this.safe('audio', () => this.audio.play('wave_broken'));
  }

  private quitToTitle(): void {
    this.menuIsOpen = false;
    this.hud.menu.close();
    this.safe('onQuitToTitle', () => this.callbacks.onQuitToTitle());
  }

  private applySettings(s: Partial<MenuSettings>): void {
    if (s.volume !== undefined) {
      this.settings.volume = s.volume;
      this.safe('audio', () => this.audio.setVolume(s.volume!));
    }
    if (s.muted !== undefined) {
      this.settings.muted = s.muted;
      this.safe('audio', () => this.audio.setMuted(s.muted!));
    }
    if (s.edgePan !== undefined) this.settings.edgePan = s.edgePan;
    this.safe('onSettingsChange', () =>
      this.callbacks.onSettingsChange?.({ sfxVolume: s.volume, muted: s.muted, edgePan: s.edgePan }),
    );
  }

  private dismissHint(): void {
    this.hints.dismiss();
    this.hud.refreshHint(performance.now() / 1000);
    this.safe('audio', () => this.audio.play('ui_click'));
  }

  private actionHost(): ActionHost {
    const self = this; // getters keep the host live without copying references
    return {
      get world() {
        return self.world;
      },
      get ui() {
        return self.ui;
      },
      get camera() {
        return self.camera;
      },
      get setup() {
        return self.setup;
      },
      get audio() {
        return self.audio;
      },
      get alerts() {
        return self.alerts;
      },
      get hints() {
        return self.hints;
      },
      error: (msg) => {
        this.hud?.error(msg, performance.now() / 1000);
        this.safe('audio', () => this.audio.play('ui_error'));
      },
      notice: (msg) => this.hud?.info(msg, performance.now() / 1000),
      menuOpen: () => this.menuIsOpen,
      openMenu: () => this.openMenu(),
      closeMenu: () => this.closeMenu(),
      ended: () => this.endResult !== null,
      onMuteChanged: (m) => {
        this.settings.muted = m;
        this.safe('onSettingsChange', () => this.callbacks.onSettingsChange?.({ muted: m }));
      },
      invalidateHud: () => this.hud?.invalidate(),
    };
  }

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------

  /** Synchronous sim advance for tests (__game.step). Events reach renderer + HUD, not audio. */
  debugStep(seconds: number): void {
    const n = Math.max(0, Math.round(seconds * TICK_RATE));
    const now = performance.now() / 1000;
    for (let i = 0; i < n; i++) {
      stepWorld(this.world);
      if (this.world.events.length > 4000) this.processEvents(now, false);
    }
    this.processEvents(now, false);
    this.checkOutcome(now);
    this.prune();
    this.hud.invalidate();
  }

  /** Run fn, logging each distinct failure once (one broken subsystem must not stop the loop). */
  private safe<T>(label: string, fn: () => T): T | undefined {
    try {
      return fn();
    } catch (err) {
      const key = `${label}:${err instanceof Error ? err.message : String(err)}`;
      if (!this.errorsLogged.has(key)) {
        this.errorsLogged.add(key);
        console.error(`[battle] ${label} failed`, err);
      }
      return undefined;
    }
  }
}

