/** Procedural WebAudio sound effects (no assets). OWNER: mapgen-audio. Must not touch AudioContext at import time. */
import type { AudioSystem } from '../game/types';
import { AudioEngine } from './engine';

export { eventToCues, selectPitch, isSfxName, SFX_NAMES, SOUNDING_EVENTS } from './cues';
export type { SoundCue } from './cues';
export { AudioEngine, MAX_VOICES, MIN_REPEAT, FALLOFF_TILES } from './engine';

/**
 * Create an audio system. Nothing is allocated until `unlock()` is called from a user gesture;
 * before that `play` / `handleEvents` are no-ops (settings are remembered and applied on unlock).
 */
export function createAudio(): AudioSystem {
  return new AudioEngine();
}

/** Shared app-wide instance (lazy). */
let shared: AudioSystem | null = null;
export function getAudio(): AudioSystem {
  if (!shared) shared = createAudio();
  return shared;
}
