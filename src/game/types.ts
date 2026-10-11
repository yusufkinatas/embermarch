/**
 * Presentation-layer contracts shared by the battle shell (controller, input, HUD),
 * the renderer and audio.
 */
import type { Camera } from '../render/camera';
import type {
  BattleResult,
  BattleSetup,
  BuildingId,
  GameEvent,
  HouseId,
  PlayerBuildingId,
  ResearchId,
  ResourceNodeId,
  UnitClass,
  UnitId,
  World,
} from '../sim/types';

/** UI state owned by the battle shell; read by the renderer each frame. */
export interface BattleUIState {
  /** Selected entity ids (units, or buildings of a single type). */
  selection: number[];
  /** Entity under the cursor (0 = none). */
  hoverId: number;
  /** Box-select rectangle in screen CSS px (null when not dragging). */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Building placement ghost. */
  placement: { building: PlayerBuildingId; tx: number; ty: number; ok: boolean; reason?: string } | null;
  /** Targeting mode (cursor changes, ability radius preview). */
  targeting: null | { kind: 'attackMove' } | { kind: 'ability'; slot: 'Q' | 'W'; radius: number; range: number };
  /** Control groups 0-9 (index 0 unused). */
  groups: number[][];
  /** Tab held: Counter Wheel overlay. */
  showCounterWheel: boolean;
  /** Mouse position in world tiles (NaN when outside canvas). */
  mouseWorld: { x: number; y: number };
  paused: boolean;
  /** Game speed multiplier (1, 1.5, 2). */
  speed: number;
}

export function createBattleUIState(): BattleUIState {
  return {
    selection: [],
    hoverId: 0,
    box: null,
    placement: null,
    targeting: null,
    groups: Array.from({ length: 10 }, () => []),
    showCounterWheel: false,
    mouseWorld: { x: NaN, y: NaN },
    paused: false,
    speed: 1,
  };
}

/**
 * Extra icon keys drawn by render/icons.ts (additive): research, abilities and commands, unit classes
 * (Strong vs / Weak vs). 'house_ability' is a generic flame; ability_<houseId> (as emitted by sim/queries
 * commandCard) aliases the per-House ability icons.
 */
export type ExtraIconKind =
  | ResearchId
  | 'rally_hearth'
  | 'house_ability'
  | 'ability_horn'
  | 'ability_hymn'
  | 'ability_firepot'
  | 'ability_volley'
  | `ability_${HouseId}`
  | 'hawk'
  | 'rally'
  | 'demolish'
  | 'stop'
  | 'hold'
  | 'attack_move'
  | `cls_${UnitClass}`;

/** Anything that can be drawn as an icon/portrait. */
export type IconKind = UnitId | BuildingId | ResourceNodeId | 'tree' | 'grain' | 'timber' | 'ember' | 'crowns' | 'resolve' | 'renown' | 'pop' | ExtraIconKind;

export interface Renderer {
  /** Resize the backing store (CSS px + devicePixelRatio). */
  resize(cssW: number, cssH: number, dpr: number): void;
  /**
   * Draw one frame. alpha in [0,1) interpolates unit positions between prev and current tick.
   * frameDt is real seconds since the last frame (for fx animation).
   */
  render(world: World, cam: Camera, ui: BattleUIState, alpha: number, frameDt: number): void;
  /** Feed drained sim events to spawn particles, popups, shakes, markers. */
  handleEvents(events: GameEvent[], world: World): void;
  /** Draw the minimap into the given canvas (called ~10x per second by the HUD). */
  renderMinimap(canvas: HTMLCanvasElement, world: World, cam: Camera, ui: BattleUIState): void;
  destroy(): void;
}

export type SfxName =
  | 'ui_click'
  | 'ui_error'
  | 'select'
  | 'acknowledge'
  | 'chop'
  | 'mine'
  | 'harvest'
  | 'dropoff'
  | 'build_hammer'
  | 'build_complete'
  | 'unit_trained'
  | 'research_complete'
  | 'bow_loose'
  | 'bolt_fire'
  | 'melee_hit'
  | 'thorn_hit'
  | 'death_player'
  | 'death_thorn'
  | 'building_destroyed'
  | 'nest_destroyed'
  | 'wave_horn'
  | 'wave_broken'
  | 'raid_alert'
  | 'beacon_lit'
  | 'beacon_snuffed'
  | 'boss_telegraph'
  | 'boss_slam'
  | 'rank_up'
  | 'card_flip'
  | 'victory'
  | 'defeat';

export interface AudioSystem {
  /** Create/resume the AudioContext (call from a user gesture). Safe to call repeatedly. */
  unlock(): void;
  /** Play a sound. If (x, y) world coords and a listener are given, gain falls off with distance. */
  play(name: SfxName, opts?: { x?: number; y?: number; volume?: number; pitch?: number }): void;
  /** Map sim events to sounds (throttled). */
  handleEvents(events: GameEvent[], world: World, cam: Camera | null): void;
  /** Listener position for distance falloff (camera center, tiles). */
  setListener(x: number, y: number): void;
  /** Combat drum intensity 0..1 (SHOULD). */
  setCombatIntensity(v: number): void;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  readonly muted: boolean;
  /** Ambient bed on/off. */
  setAmbient(on: boolean): void;
}

export interface BattleCallbacks {
  /** Battle ended by victory, defeat or Sound the Retreat. */
  onEnd(result: BattleResult): void;
  /** Player chose Quit to Title mid-battle (run stays battleInProgress). */
  onQuitToTitle(): void;
  /** A first-run hint was dismissed (persist to meta.hintsSeen). */
  onHintSeen?(id: string): void;
  /** The player changed settings in the in-battle pause menu (persist to meta.settings). */
  onSettingsChange?(settings: { sfxVolume?: number; muted?: boolean; edgePan?: boolean }): void;
}

export interface BattleOptions {
  debug?: boolean;
  /** Hint ids already seen (skip them). */
  hintsSeen?: string[];
  showHints?: boolean;
  edgePan?: boolean;
  panSpeed?: number;
  /** Initial SFX volume 0..1 (meta.settings.sfxVolume). */
  sfxVolume?: number;
  /** Initial mute state (meta.settings.muted). */
  muted?: boolean;
}

/** Shape of the battle controller (implemented in src/game/battle.ts). */
export interface BattleControllerLike {
  start(): void;
  destroy(): void;
  readonly world: World;
  readonly setup: BattleSetup;
}
