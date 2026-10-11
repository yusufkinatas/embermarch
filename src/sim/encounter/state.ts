/**
 * Encounter runtime state (world.encounter after initEncounter). Internal to src/sim/encounter;
 * other modules use getEncounterView() / getEncounterResult().
 */
import type { Rng } from '../../core/rng';
import type { Building, DoctrineId, EnemyUnitId, ObjectiveId, Unit, World } from '../types';
import type { SpentClock, WaveSchedule } from './formulas';
import type { EncounterState, EnemyUnitAI } from './types';

export type Band = 'riders' | 'main' | 'siege';
export type Role = EnemyUnitAI['role'];

/** Full per-unit AI record stored in Unit.ai (extends the cross-module contract). */
export interface EnemyAI extends EnemyUnitAI {
  /** Home Nest (garrison) or source Nest (wave); 0 if none. */
  nestId: number;
  /** Leash anchor and radii (standing forces and mustering waves). */
  anchorX: number;
  anchorY: number;
  leash: number;
  aggro: number;
  value: number;
  band: Band;
  /** Where the current engagement started (wave chase leash). NaN = not engaged. */
  engageX: number;
  engageY: number;
  /** Target to ignore until `ignoreUntil` (tick) after a chase leash. */
  ignoreId: number;
  ignoreUntil: number;
  /** Retaliation / "attack the killer" target and its expiry tick. */
  forcedId: number;
  forcedUntil: number;
  /** Dissolve bookkeeping: last damage dealt tick, idle anchor and since-tick. */
  lastDealtTick: number;
  idleX: number;
  idleY: number;
  idleSince: number;
  /** Next tick at which the unit re-thinks (0.5 s cadence, staggered). */
  nextThink: number;
  /** Raid: tick until which raiders hunt Tillers (-1 = not started yet, -2 = done). */
  huntUntil: number;
  /** Summons: unit id they follow (Lord / Regent). */
  leaderId: number;
  /** WaveRec.uid of the wave / raid this unit belongs to (0 = none). */
  waveUid: number;
  /** Advance goal entity for units without a wave (homeless garrison). */
  goalId: number;
}

export interface NestRec {
  id: number;
  b: Building;
  index: number;
  kind: 'nest' | 'heart';
  cx: number;
  cy: number;
  musterX: number;
  musterY: number;
  alive: boolean;
  /** Compass direction from the Hearth, e.g. "NE". */
  dir: string;
  garrisonCap: number;
  garrison: number[];
  /** Seconds accumulated toward the next value point. */
  regenTimer: number;
  regenInterval: number;
  /** Value points banked toward the next regenerated guard. */
  regenBank: number;
  /** Pre-rolled next regenerated type. */
  regenNext: EnemyUnitId | null;
  spires: number[];
  spent: SpentClock;
  /** Retaliation throttle tick. */
  retaliateTick: number;
  diedTick: number;
}

export interface WaveRec {
  /** Unique id (several records can share n for the Great Wave). */
  uid: number;
  n: number;
  kind: 'wave' | 'raid';
  nestId: number;
  dir: string;
  musterX: number;
  musterY: number;
  members: number[];
  initialCount: number;
  doctrine: DoctrineId;
  musterTick: number;
  /** Scheduled launch time (battle seconds). */
  launchAt: number;
  launchTick: number;
  /** Battle time at which the Horn becomes visible (Thick Fog: launch − 10 s). */
  hornAt: number;
  announced: boolean;
  phase: 'muster' | 'advancing' | 'broken';
  revealed: boolean;
  great: boolean;
  /** Current wave goal entity (0 = Hearth fallback). */
  targetId: number;
  targetRule: 'objective' | 'doctrine' | 'hearth' | 'killer' | 'tiller';
  notes: string[];
  brokenTick: number;
  /** Cohesion caps per band (tiles/s, 0 = none). */
  caps: Record<Band, number>;
  /** Raid: farthest-Tiller target at launch. */
  huntTargetId: number;
}

export interface BlightSourceRec {
  entityId: number;
  x: number;
  y: number;
  start: number;
  cap: number;
  interval: number;
  /** Seconds of growth so far. */
  grown: number;
  radius: number;
  receding: boolean;
  recedeFrom: number;
  recedeStartTick: number;
  gone: boolean;
}

export interface PicketRec {
  spireId: number;
  x: number;
  y: number;
  guards: number[];
  cleared: boolean;
}

export interface CacheRec {
  id: number;
  b: Building;
  ancient: boolean;
  x: number;
  y: number;
  guards: number[];
  looted: boolean;
}

export interface BeaconRec {
  id: number;
  b: Building;
  x: number;
  y: number;
  guards: number[];
  lit: boolean;
  /** Capture progress seconds (0..captureTime). */
  capture: number;
  snuff: number;
  emberAcc: number;
}

export interface Telegraph {
  kind: 'hunt' | 'lance' | 'burst' | 'snare';
  fireTick: number;
  x: number;
  y: number;
  x2: number;
  y2: number;
  radius: number;
  width: number;
}

export interface LordState {
  id: number;
  nestId: number;
  joined: boolean;
  active: boolean;
  risen: boolean;
  nextHunt: number;
  nextSummon: number;
  pending: Telegraph | null;
  summons: number[];
}

export interface BossState {
  id: number;
  throneId: number;
  throneX: number;
  throneY: number;
  phase: 1 | 2;
  wrath: boolean;
  enraged: boolean;
  nextLance: number;
  nextBurst: number;
  nextSnare: number;
  /** Telegraphs waiting to fire (a Thornburst holds the Regent in place). */
  pending: Telegraph[];
  summonsDone: number;
  wardenReadyTick: number;
  wardenChase: { x: number; y: number } | null;
}

export interface Plunder {
  crowns: number;
  nestsDestroyed: number;
  picketsDestroyed: number;
  cachesLooted: number;
  ancientLooted: boolean;
  lordSlain: boolean;
  regentSlain: boolean;
}

export interface PendingDeath {
  kind: 'nest';
  nestId: number;
  killerId: number;
  /** "Waves −X%" popup value. */
  wavePct: number;
}

export interface EncMods {
  bloodMoon: boolean;
  thickFog: boolean;
  bountiful: boolean;
  creeping: boolean;
  fortified: boolean;
  swiftHunt: boolean;
  ancientCache: boolean;
}

export interface EncRuntime extends EncounterState {
  ready: true;
  objective: ObjectiveId;
  doctrine: DoctrineId;
  depth: number;
  rng: Rng;
  mods: EncMods;
  tier: { nestHpMult: number; t1Delta: number; garrisonAdd: number };
  coldWatchfire: boolean;
  doctrineSeen: boolean;
  hearthX: number;
  hearthY: number;

  nests: NestRec[];
  nestsTotal: number;

  schedule: WaveSchedule | null;
  /** Next wave index to muster (1-based). */
  nextN: number;
  /** Launch time of wave nextN (battle seconds). */
  nextLaunch: number;
  /** Round-robin cursor over anchor indices. */
  rotation: number;
  waves: WaveRec[];
  waveUid: number;
  waveBank: number;
  wavesLaunched: number;
  /** Raid launch times still pending (battle seconds). */
  raids: number[];
  ascendant: boolean;
  ascendantWarned: boolean;
  /** Holdfast: Great Wave launched; cleanup mode. */
  cleanup: boolean;
  revealed: number[];

  blight: BlightSourceRec[];
  canBlight: Uint8Array;
  blightDirty: boolean;
  witherTimer: number;

  pickets: PicketRec[];
  caches: CacheRec[];
  beacons: BeaconRec[];
  kindling: number;

  lord: LordState | null;
  boss: BossState | null;

  plunder: Plunder;
  buildingLost: boolean;
  pendingDeaths: PendingDeath[];
  /** Spires that wither at a tick: [spireId, tick]. */
  withering: [number, number][];
  victoryTime: number;
  /** Per-tick caches. */
  playerUnits: Unit[];
}

/** The runtime state, or null if initEncounter has not run (skipEncounter worlds). */
export function getState(world: World): EncRuntime | null {
  const e = world.encounter as Partial<EncRuntime> | undefined;
  return e && e.ready === true ? (e as EncRuntime) : null;
}

export function aiOf(u: Unit): EnemyAI | null {
  return (u.ai as EnemyAI | null) ?? null;
}
