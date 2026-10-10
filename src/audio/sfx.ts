/** Procedural WebAudio sound effects (no assets). OWNER: mapgen-audio. Must not touch AudioContext at import time. */
import type { AudioSystem } from '../game/types';

export function createAudio(): AudioSystem {
  throw new Error('not implemented');
}

/** Shared app-wide instance (lazy). */
let shared: AudioSystem | null = null;
export function getAudio(): AudioSystem {
  if (!shared) shared = createAudio();
  return shared;
}
