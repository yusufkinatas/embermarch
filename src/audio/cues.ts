/**
 * Pure mapping from sim GameEvents to sound cues (no WebAudio, safe under Node).
 * The engine applies distance falloff, throttling and the voice cap on top of this.
 */
import type { SfxName } from '../game/types';
import type { GameEvent, UnitClass, World } from '../sim/types';
import { ENEMY, PLAYER } from '../sim/types';

export const SFX_NAMES: readonly SfxName[] = [
  'ui_click',
  'ui_error',
  'select',
  'acknowledge',
  'chop',
  'mine',
  'harvest',
  'dropoff',
  'build_hammer',
  'build_complete',
  'unit_trained',
  'research_complete',
  'bow_loose',
  'bolt_fire',
  'melee_hit',
  'thorn_hit',
  'death_player',
  'death_thorn',
  'building_destroyed',
  'nest_destroyed',
  'wave_horn',
  'wave_broken',
  'raid_alert',
  'beacon_lit',
  'beacon_snuffed',
  'boss_telegraph',
  'boss_slam',
  'rank_up',
  'card_flip',
  'victory',
  'defeat',
];

const SFX_SET = new Set<string>(SFX_NAMES);

export function isSfxName(s: string): s is SfxName {
  return SFX_SET.has(s);
}

export interface SoundCue {
  name: SfxName;
  /** World position (tiles) for distance falloff and panning; omitted = heard everywhere. */
  x?: number;
  y?: number;
  /** Volume multiplier (default 1). */
  volume?: number;
  /** Playback pitch multiplier (default 1). */
  pitch?: number;
}

/** Pitch for the `select` blip by unit class (worker high, siege low; GDD §P). */
export function selectPitch(cls: UnitClass): number {
  switch (cls) {
    case 'worker':
      return 1.5;
    case 'ranged':
      return 1.2;
    case 'infantry':
      return 1;
    case 'hero':
      return 1.12;
    case 'cavalry':
      return 0.85;
    case 'siege':
      return 0.66;
    case 'boss':
      return 0.6;
  }
}

/** Shake magnitude (px) at or above which a shake counts as a boss slam. */
export const SLAM_SHAKE = 8;

const pos = (x: number, y: number): { x: number; y: number } => ({ x, y });

/**
 * Sounds for one event. `batch` is the whole frame's event list (to avoid doubling a slam on a
 * shake that accompanies a Nest death or a boss phase change).
 */
export function eventToCues(ev: GameEvent, world?: World | null, batch?: readonly GameEvent[]): SoundCue[] {
  switch (ev.t) {
    case 'attack': {
      if (ev.ranged) {
        switch (ev.projectile) {
          case 'bolt':
            return [{ name: 'bolt_fire', ...pos(ev.x, ev.y), volume: 0.8 }];
          case 'firepot':
            return [{ name: 'bolt_fire', ...pos(ev.x, ev.y), pitch: 0.55 }];
          case 'spine':
            return [{ name: 'bow_loose', ...pos(ev.x, ev.y), pitch: 0.72, volume: 0.8 }];
          case 'fire_arrow':
            return [{ name: 'bow_loose', ...pos(ev.x, ev.y), pitch: 0.9 }];
          default:
            return [{ name: 'bow_loose', ...pos(ev.x, ev.y) }];
        }
      }
      const heavy = ev.unitType === 'rootbreaker' || ev.unitType === 'gatebreaker' || ev.unitType === 'thornhusk' || ev.unitType === 'briar_regent';
      return [{ name: 'melee_hit', ...pos(ev.x, ev.y), pitch: heavy ? 0.7 : 1 }];
    }
    case 'hit':
      // Impacts on Thornwake flesh crunch; impacts on the player are covered by the swing sound.
      if (ev.targetOwner === ENEMY) return [{ name: 'thorn_hit', ...pos(ev.x, ev.y), volume: ev.isStructure ? 0.6 : 0.85, pitch: ev.isStructure ? 0.8 : 1 }];
      return [];
    case 'gather': {
      const name: SfxName = ev.source === 'tree' ? 'chop' : ev.source === 'ember_seam' ? 'mine' : 'harvest';
      return [{ name, ...pos(ev.x, ev.y), volume: 0.7 }];
    }
    case 'treeFelled': {
      if (!world) return [{ name: 'chop', pitch: 0.55, volume: 0.6 }];
      const tx = ev.tile % world.map.w;
      const ty = Math.floor(ev.tile / world.map.w);
      return [{ name: 'chop', ...pos(tx + 0.5, ty + 0.5), pitch: 0.55 }];
    }
    case 'dropoff':
      return [{ name: 'dropoff', ...pos(ev.x, ev.y), volume: 0.55, pitch: ev.res === 'ember' ? 1.12 : ev.res === 'timber' ? 0.94 : 1 }];
    case 'placed':
      return ev.owner === PLAYER ? [{ name: 'build_hammer' }] : [];
    case 'built':
      return ev.owner === PLAYER ? [{ name: 'build_complete', volume: 0.85 }] : [];
    case 'trained':
      return [{ name: 'unit_trained', volume: 0.7 }];
    case 'researched':
      return [{ name: 'research_complete' }];
    case 'death': {
      if (ev.kind === 'unit') {
        if (ev.owner === PLAYER) return [{ name: 'death_player', ...pos(ev.x, ev.y) }];
        const big = ev.type === 'antlered_lord' || ev.type === 'briar_regent' || ev.type === 'thornhusk' || ev.type === 'rootbreaker';
        return [{ name: 'death_thorn', ...pos(ev.x, ev.y), pitch: big ? 0.7 : 1, volume: big ? 1 : 0.8 }];
      }
      // Nest / Root Heart deaths have their own `nestDestroyed` boom.
      if (ev.type === 'thorn_nest' || ev.type === 'root_heart') return [];
      if (ev.type === 'thornspire') return [{ name: 'building_destroyed', ...pos(ev.x, ev.y), pitch: 1.4, volume: 0.7 }];
      return [{ name: 'building_destroyed', ...pos(ev.x, ev.y) }];
    }
    case 'nestDestroyed':
      return [{ name: 'nest_destroyed' }];
    case 'waveMuster':
      return [{ name: 'wave_horn', x: ev.x, y: ev.y, volume: 1 }];
    case 'waveBroken':
      return [{ name: 'wave_broken' }];
    case 'raidLaunch':
      return [{ name: 'raid_alert', x: ev.x, y: ev.y }];
    case 'beacon':
      return [{ name: ev.lit ? 'beacon_lit' : 'beacon_snuffed' }];
    case 'telegraph':
      return [{ name: 'boss_telegraph', ...pos(ev.x, ev.y) }];
    case 'bossPhase':
      return [{ name: 'boss_slam', volume: 1.1 }, { name: 'wave_horn', pitch: 0.75 }];
    case 'shake': {
      if (ev.magnitude < SLAM_SHAKE) return [];
      if (batch && batch.some((e) => e.t === 'nestDestroyed' || e.t === 'bossPhase' || e.t === 'lastStand')) return [];
      return [{ name: 'boss_slam', volume: Math.min(1.2, ev.magnitude / 10) }];
    }
    case 'lastStand':
      return [{ name: 'boss_slam' }, { name: 'rank_up', pitch: 0.8 }];
    case 'rankUp':
      return [{ name: 'rank_up', ...pos(ev.x, ev.y) }];
    case 'cacheLooted':
      return [{ name: 'dropoff', ...pos(ev.x, ev.y), pitch: 1.25 }, { name: 'rank_up', ...pos(ev.x, ev.y), volume: 0.7 }];
    case 'command':
      return [{ name: 'acknowledge', volume: 0.6 }];
    case 'ability':
      return ev.owner === PLAYER ? [{ name: 'rank_up', ...pos(ev.x, ev.y), pitch: 0.75 }] : [];
    case 'sfx':
      return isSfxName(ev.name) ? [{ name: ev.name, ...(ev.x !== undefined && ev.y !== undefined ? pos(ev.x, ev.y) : {}) }] : [];
    case 'victory':
      return [{ name: 'victory' }];
    case 'defeat':
      return [{ name: 'defeat' }];
    default:
      return [];
  }
}

/** Every event type that produces a sound (for tests / docs). */
export const SOUNDING_EVENTS: readonly GameEvent['t'][] = [
  'attack',
  'hit',
  'gather',
  'treeFelled',
  'dropoff',
  'placed',
  'built',
  'trained',
  'researched',
  'death',
  'nestDestroyed',
  'waveMuster',
  'waveBroken',
  'raidLaunch',
  'beacon',
  'telegraph',
  'bossPhase',
  'shake',
  'lastStand',
  'rankUp',
  'cacheLooted',
  'command',
  'ability',
  'sfx',
  'victory',
  'defeat',
];
