/**
 * Meta and run saves (GDD §N "Storage"): `embermarch.meta.v1` and `embermarch.run.v1`.
 * Every read/write is guarded (storage.ts); a version mismatch or malformed save resets to defaults.
 */
import { META_UNLOCK_IDS, THORNBOUND_EFFECTS } from '../data';
import type { MetaUnlockId } from '../sim/types';
import { META_KEY, RUN_KEY, readJson, removeKey, writeJson } from './storage';
import type { MetaSave, RunState, Settings } from './types';

export function defaultSettings(): Settings {
  return { sfxVolume: 0.7, muted: false, edgePan: true, panSpeed: 1, showHints: true };
}

export function defaultMeta(): MetaSave {
  return {
    version: 1,
    renown: 0,
    unlocks: [],
    tierUnlocked: 0,
    stats: { runs: 0, wins: 0, kills: 0, bestDepth: 0, totalRenown: 0 },
    hintsSeen: [],
    settings: defaultSettings(),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

/** Coerce parsed JSON into a MetaSave (unknown fields dropped, missing fields defaulted). */
export function sanitizeMeta(raw: unknown): MetaSave {
  const def = defaultMeta();
  if (!isObj(raw) || raw.version !== 1) return def;
  const unlocks = Array.isArray(raw.unlocks)
    ? [...new Set(raw.unlocks.filter((u): u is MetaUnlockId => META_UNLOCK_IDS.includes(u as MetaUnlockId)))]
    : [];
  const st = isObj(raw.stats) ? raw.stats : {};
  const se = isObj(raw.settings) ? raw.settings : {};
  return {
    version: 1,
    renown: Math.max(0, Math.floor(num(raw.renown, 0))),
    unlocks,
    tierUnlocked: Math.max(0, Math.min(THORNBOUND_EFFECTS.maxTier, Math.floor(num(raw.tierUnlocked, 0)))),
    stats: {
      runs: Math.max(0, num(st.runs, 0)),
      wins: Math.max(0, num(st.wins, 0)),
      kills: Math.max(0, num(st.kills, 0)),
      bestDepth: Math.max(0, num(st.bestDepth, 0)),
      totalRenown: Math.max(0, num(st.totalRenown, 0)),
    },
    hintsSeen: Array.isArray(raw.hintsSeen) ? raw.hintsSeen.filter((h): h is string => typeof h === 'string') : [],
    settings: {
      sfxVolume: Math.max(0, Math.min(1, num(se.sfxVolume, def.settings.sfxVolume))),
      muted: bool(se.muted, def.settings.muted),
      edgePan: bool(se.edgePan, def.settings.edgePan),
      panSpeed: Math.max(0.25, Math.min(4, num(se.panSpeed, def.settings.panSpeed))),
      showHints: bool(se.showHints, def.settings.showHints),
    },
  };
}

export function loadMeta(): MetaSave {
  return sanitizeMeta(readJson(META_KEY));
}

export function saveMeta(meta: MetaSave): void {
  writeJson(META_KEY, meta);
}

/** Structural check of a parsed run save. Returns the run (with defaults for newer optional fields) or null. */
export function sanitizeRun(raw: unknown): RunState | null {
  if (!isObj(raw) || raw.version !== 1) return null;
  const map = raw.map;
  if (!isObj(map) || !isObj(map.nodes) || !Array.isArray(map.columns) || typeof map.startId !== 'string') return null;
  const required: [string, string][] = [
    ['seed', 'number'],
    ['house', 'string'],
    ['tier', 'number'],
    ['crowns', 'number'],
    ['resolve', 'number'],
    ['maxResolve', 'number'],
    ['rngState', 'number'],
    ['firstOfferDone', 'boolean'],
    ['battleInProgress', 'boolean'],
  ];
  for (const [k, t] of required) if (typeof raw[k] !== t) return null;
  const arrays = ['nodesDone', 'boons', 'drafts', 'retinue', 'sellswords', 'pending', 'eventsSeen', 'rewardQueue'];
  for (const k of arrays) if (!Array.isArray(raw[k])) return null;
  if (raw.currentNode !== null && (typeof raw.currentNode !== 'string' || !(raw.currentNode in map.nodes))) return null;
  const run = raw as unknown as RunState;
  // Defaults for fields that older saves of this version may lack.
  run.retinueSnapshot = Array.isArray(raw.retinueSnapshot) ? run.retinueSnapshot : [...run.retinue];
  run.currentEvent = typeof raw.currentEvent === 'string' ? run.currentEvent : null;
  run.peddler = isObj(raw.peddler) ? run.peddler : null;
  run.extraTillers = num(raw.extraTillers, 0);
  run.waveMult = num(raw.waveMult, 1);
  run.over = raw.over === 'won' || raw.over === 'lost' ? raw.over : null;
  run.profileRunIndex = num(raw.profileRunIndex, 0);
  const st = isObj(raw.stats) ? raw.stats : {};
  run.stats = {
    battlesWon: num(st.battlesWon, 0),
    elitesWon: num(st.elitesWon, 0),
    nestsDestroyed: num(st.nestsDestroyed, 0),
    nodesVisited: num(st.nodesVisited, 0),
    kills: num(st.kills, 0),
    crownsEarned: num(st.crownsEarned, 0),
    timePlayed: num(st.timePlayed, 0),
  };
  return run;
}

export function loadRun(): RunState | null {
  return sanitizeRun(readJson(RUN_KEY));
}

export function saveRun(run: RunState): void {
  writeJson(RUN_KEY, run);
}

export function clearRun(): void {
  removeKey(RUN_KEY);
}
