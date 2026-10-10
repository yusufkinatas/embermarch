/**
 * Encounter-owned state types (wave director, enemy AI, Nests, objectives, boss).
 * OWNER: encounter agent. Other modules may READ the documented fields but must not mutate them.
 * The encounter agent may add fields freely; the fields below are the cross-module contract.
 */
import type { DoctrineId, EnemyUnitId, ObjectiveId } from '../types';

/** Per-enemy-unit AI state (Unit.ai). */
export interface EnemyUnitAI {
  /** 'garrison' | 'picket' | 'lurker' | 'beacon_guard' | 'wave' | 'raid' | 'summon' | 'noble' | 'boss' */
  role: 'garrison' | 'picket' | 'lurker' | 'beacon_guard' | 'wave' | 'raid' | 'summon' | 'noble' | 'boss';
  state: 'muster' | 'advance' | 'engage' | 'return' | 'post' | 'idle';
  /** Post / leash anchor in tiles. */
  postX: number;
  postY: number;
  /** Wave index this unit belongs to (-1 if none). */
  wave: number;
  [key: string]: unknown;
}

/** Thorn Nest / Root Heart state (Building.nest). */
export interface NestState {
  index: number;
  spent: boolean;
  /** Tick when Spent ends (-1 if not spent). */
  spentUntil: number;
  /** Current Blight radius in tiles (for rendering rings / minimap). */
  blightRadius: number;
  /** True once the player has seen it (banner/doctrine reveal). */
  seen: boolean;
  /** 0..1 how close the next muster is (render pulse speed). */
  musterProgress: number;
  [key: string]: unknown;
}

/** Caches, Beacon Stones, Briar Throne (Building.object). */
export interface ObjectState {
  kind: 'cache' | 'beacon' | 'throne';
  /** Cache looted / Beacon lit. */
  done: boolean;
  /** Beacon capture progress 0..1 and lit flag. */
  progress: number;
  lit: boolean;
  [key: string]: unknown;
}

export interface WaveHornView {
  wave: number;
  /** Seconds until launch (negative once advancing). */
  secondsToLaunch: number;
  phase: 'muster' | 'advancing';
  /** Compass direction of the source Nest relative to the Hearth, e.g. "NE". */
  direction: string;
  revealed: boolean;
  composition: { type: EnemyUnitId; count: number }[];
  sizeLabel: 'Small' | 'Medium' | 'Large';
  notes: string[];
  nestId: number;
  /** World position of the muster point (for screen-edge arrows). */
  x: number;
  y: number;
}

/** Read-only summary for the HUD (built on demand by getEncounterView). */
export interface EncounterView {
  objective: ObjectiveId;
  /** e.g. "Nests 1/2 · Par 4:12", "Waves 4/6", "Burn the Root Hearts 1/3 · Regent Warded" */
  trackerText: string;
  /** Seconds left on par (null if no par or missed). */
  parRemaining: number | null;
  horn: WaveHornView | null;
  wavesLaunched: number;
  boss: { name: string; hp: number; maxHp: number; phase: 1 | 2; warded: boolean; enraged: boolean } | null;
  nests: { id: number; x: number; y: number; alive: boolean; spent: boolean; spentRemaining: number; seen: boolean }[];
  ascendantIn: number | null;
  /** Crowns plundered so far this battle. */
  plunderCrowns: number;
  doctrine: DoctrineId;
  doctrineSeen: boolean;
  kindling: { value: number; target: number } | null;
  /** 0..1 dusk tint strength. */
  dusk: number;
  /** Enemy units that should be shown on the minimap regardless of fog (final-wave cleanup). */
  revealedEnemyIds: number[];
}

/** World.encounter. Opaque to other modules except via getEncounterView(). */
export interface EncounterState {
  objective: ObjectiveId;
  doctrine: DoctrineId;
  [key: string]: unknown;
}
