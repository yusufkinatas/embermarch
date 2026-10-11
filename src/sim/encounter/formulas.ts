/**
 * Pure encounter math (no world access): wave values and schedules, doctrine weights, wave and
 * standing composition, light adaptation, the Spent clock, Blight radius/tiles/ward grids,
 * plunder and small UI formatters. Everything here is unit-tested in tests/encounter.
 */
import type { Rng } from '../../core/rng';
import {
  ADAPTATION,
  ASCENDANT,
  BLIGHT,
  BOSS,
  CROWNS,
  DIRECTOR,
  ENEMY_UNLOCK_DEPTH,
  GARRISON,
  HOLDFAST,
  INCOME,
  MODIFIER_NUMBERS,
  SPENT,
  WAVE_MULT,
  bossWaveValue,
  firstWaveLaunch,
  floorEps,
  holdfastWaveValue,
  rootbreakerCap,
  waveInterval,
  waveValue,
} from '../../data/balance';
import { DOCTRINES } from '../../data/doctrines';
import { COMPASS } from '../../data/text';
import { UNITS } from '../../data/units';
import type { DoctrineId, EnemyUnitId, ObjectiveId, UnitClass } from '../types';

// ---------------------------------------------------------------------------
// Wave value and multipliers
// ---------------------------------------------------------------------------

/** Enemy unit types that waves and standing forces can be built from (Noble and Regent excluded). */
export const POOL_TYPES: readonly EnemyUnitId[] = [
  'thornling',
  'briarguard',
  'spinecaster',
  'stagrider',
  'rootbreaker',
  'gloamwitch',
  'thornhusk',
];

/** Wave value of an enemy unit type (data table). */
export function unitValue(type: EnemyUnitId): number {
  return UNITS[type].value ?? 0;
}

export function isAscendantObjective(objective: ObjectiveId): boolean {
  return ASCENDANT.objectives.includes(objective);
}

/**
 * M = product of active multipliers. `runMult` is setup.waveMult (Hollow Envoy, Thornbound I
 * already multiplied in by the run layer); Blood Moon and Ascendant are applied here.
 */
export function waveMultiplier(runMult: number, bloodMoon: boolean, ascendant: boolean): number {
  return (runMult > 0 ? runMult : 1) * (bloodMoon ? WAVE_MULT.bloodMoon : 1) * (ascendant ? WAVE_MULT.ascendant : 1);
}

/** Wave value for any objective. N is the Nest factor, M the multiplier, hearts the living Root Hearts (boss). */
export function waveValueFor(objective: ObjectiveId, n: number, d: number, N: number, M: number, heartsAlive = 0): number {
  if (objective === 'holdfast') return holdfastWaveValue(n, d, N, M);
  if (objective === 'boss') return bossWaveValue(n, heartsAlive, M);
  return waveValue(n, d, N, M);
}

/** Bank carried into a wave: capped at 50% of V, the excess is discarded. */
export function cappedBank(bank: number, V: number): number {
  return Math.max(0, Math.min(bank, V * DIRECTOR.waveBankCap));
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export interface WaveSchedule {
  /** Launch time of the first wave (s). */
  t1: number;
  /** Interval between launches before `switchTime`. */
  interval: number;
  /** Battle time at which the interval changes (Ascendant 9:00, boss Wrath 8:00), or null. */
  switchTime: number | null;
  /** Interval from `switchTime` on. */
  interval2: number;
}

/** Raze / Beacons / Elite timeline: T1 = 110 − 4d (+ Thornbound III, Bountiful Wilds), I = 70 − 2d. */
export function standardSchedule(d: number, opts: { t1Delta?: number; bountiful?: boolean; ascendant?: boolean } = {}): WaveSchedule {
  const t1 = firstWaveLaunch(d) + (opts.t1Delta ?? 0) + (opts.bountiful ? MODIFIER_NUMBERS.bountifulT1Delta : 0);
  return {
    t1,
    interval: waveInterval(d),
    switchTime: opts.ascendant === false ? null : ASCENDANT.time,
    interval2: ASCENDANT.interval,
  };
}

/** Boss timeline: T1 100 s, interval 60 s, 45 s after 8:00. Thornbound III still pulls T1 in. */
export function bossSchedule(t1Delta = 0): WaveSchedule {
  return { t1: BOSS.t1 + t1Delta, interval: BOSS.interval, switchTime: BOSS.wrathTime, interval2: BOSS.wrathInterval };
}

/**
 * Next launch after a launch at `last`. A gap that straddles the switch time is cut short so the
 * next wave arrives no later than max(switchTime, last + interval2).
 */
export function nextLaunchAfter(s: WaveSchedule, last: number): number {
  if (s.switchTime === null) return last + s.interval;
  if (last >= s.switchTime - 1e-6) return last + s.interval2;
  const t = last + s.interval;
  if (t <= s.switchTime + 1e-6) return t;
  return Math.min(t, Math.max(s.switchTime, last + s.interval2));
}

/** First `count` launch times of a schedule. */
export function launchTimes(s: WaveSchedule, count: number): number[] {
  const out: number[] = [];
  let t = s.t1;
  for (let i = 0; i < count; i++) {
    out.push(t);
    t = nextLaunchAfter(s, t);
  }
  return out;
}

/** Holdfast launch time of wave n (1-based). */
export function holdfastLaunch(n: number): number {
  return HOLDFAST.launchTimes[Math.max(0, Math.min(HOLDFAST.launchTimes.length - 1, n - 1))];
}

/** Split a Great Wave value evenly across k Nests (remainder to the first ones). */
export function splitValue(V: number, k: number): number[] {
  if (k <= 0) return [];
  const base = Math.floor(V / k);
  const rest = V - base * k;
  return Array.from({ length: k }, (_, i) => base + (i < rest ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Doctrines and weights
// ---------------------------------------------------------------------------

export const DOCTRINE_ORDER: readonly DoctrineId[] = ['swarm', 'spines', 'hunt', 'siegebreak', 'court'];

export function isUnlocked(type: EnemyUnitId, d: number): boolean {
  const from = ENEMY_UNLOCK_DEPTH[type];
  return from !== undefined && from <= d;
}

/** Doctrines available at depth d. */
export function doctrinesAvailable(d: number): DoctrineId[] {
  return DOCTRINE_ORDER.filter((id) => DOCTRINES[id].fromDepth <= d);
}

/** Primary doctrine for a battle: Swift Hunt forces Hunt; an unavailable roll falls back to Swarm. */
export function resolvePrimaryDoctrine(rolled: DoctrineId, d: number, swiftHunt: boolean): DoctrineId {
  if (swiftHunt) return 'hunt';
  return DOCTRINES[rolled] && DOCTRINES[rolled].fromDepth <= d ? rolled : 'swarm';
}

export type WeightEntry = readonly [EnemyUnitId, number];

/** Wave weights for a doctrine at depth d; types below their unlock depth drop out. `extra` adds weight (adaptation). */
export function doctrineWeights(doctrine: DoctrineId, d: number, extra?: Partial<Record<EnemyUnitId, number>>): WeightEntry[] {
  const w = DOCTRINES[doctrine].weights;
  const out: WeightEntry[] = [];
  for (const t of POOL_TYPES) {
    if (!isUnlocked(t, d)) continue;
    const weight = (w[t] ?? 0) + (extra?.[t] ?? 0);
    if (weight > 0) out.push([t, weight]);
  }
  return out;
}

/** Is a type allowed in standing forces (value >= 2, no siege, standing-eligible)? */
export function isStandingType(type: EnemyUnitId): boolean {
  const def = UNITS[type];
  return !!def.standingEligible && (def.value ?? 0) >= GARRISON.minStandingValue && def.cls !== 'siege';
}

/** Standing-force weights: the doctrine's standing-eligible, unlocked types (fallback Briarguard + Spinecaster). */
export function standingWeights(doctrine: DoctrineId, d: number): WeightEntry[] {
  const out = doctrineWeights(doctrine, d).filter(([t]) => isStandingType(t));
  if (out.length > 0) return out;
  return [
    ['briarguard', 1],
    ['spinecaster', 1],
  ];
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export interface Composition {
  types: EnemyUnitId[];
  /** Budget that could not be spent (discarded by the director). */
  leftover: number;
}

/**
 * Wave composition (§I "Composition" step 3): while budget >= 1, pick an eligible type by weight.
 * Eligible = unlocked at d (already filtered in weights), value fits the budget, Rootbreaker cap.
 * `rootbreakers` is the number already in the wave (e.g. never from garrisons, but kept general).
 */
export function composeWave(rng: Rng, budget: number, weights: readonly WeightEntry[], d: number, rootbreakers = 0): Composition {
  const types: EnemyUnitId[] = [];
  const cap = rootbreakerCap(d);
  let roots = rootbreakers;
  let left = budget;
  while (left >= 1) {
    const eligible = weights.filter(([t, w]) => w > 0 && unitValue(t) <= left + 1e-9 && (t !== 'rootbreaker' || roots < cap));
    if (eligible.length === 0) break;
    const [t] = rng.weighted(eligible, (e) => e[1]);
    types.push(t);
    left -= unitValue(t);
    if (t === 'rootbreaker') roots++;
  }
  return { types, leftover: left };
}

/** Standing composition: value >= 2 types only, a remainder under 2 is discarded. */
export function composeStanding(rng: Rng, value: number, weights: readonly WeightEntry[]): Composition {
  const pool = weights.filter(([t]) => isStandingType(t));
  const types: EnemyUnitId[] = [];
  let left = value;
  while (left >= GARRISON.minStandingValue) {
    const eligible = pool.filter(([t, w]) => w > 0 && unitValue(t) <= left + 1e-9);
    if (eligible.length === 0) break;
    const [t] = rng.weighted(eligible, (e) => e[1]);
    types.push(t);
    left -= unitValue(t);
  }
  return { types, leftover: left };
}

/** Raid composition: Stagriders while at least 3 value remains, then Thornlings. */
export function composeRaid(value: number): EnemyUnitId[] {
  const out: EnemyUnitId[] = [];
  let left = value;
  const stag = unitValue('stagrider');
  while (left >= stag) {
    out.push('stagrider');
    left -= stag;
  }
  while (left >= 1) {
    out.push('thornling');
    left -= 1;
  }
  return out;
}

/** Sum of wave values. */
export function totalValue(types: readonly EnemyUnitId[]): number {
  let v = 0;
  for (const t of types) v += unitValue(t);
  return v;
}

// ---------------------------------------------------------------------------
// Light adaptation (SHOULD)
// ---------------------------------------------------------------------------

export interface Adaptation {
  cls: UnitClass;
  counter: EnemyUnitId;
  /** Word for "The thorns have learned your ___." */
  word: string;
}

const ADAPT_WORD: Partial<Record<UnitClass, string>> = { ranged: 'bows', infantry: 'spears', cavalry: 'horses' };

/**
 * If the player has >= 6 military units and >= 40% share a class (ranged, infantry, cavalry),
 * the counter type gains weight. Ranged-heavy is countered by Stagriders (Thornlings at d1).
 */
export function adaptationFor(classCounts: Partial<Record<UnitClass, number>>, military: number, d: number): Adaptation | null {
  if (military < ADAPTATION.minMilitary) return null;
  let best: UnitClass | null = null;
  let bestShare = 0;
  for (const cls of ['ranged', 'infantry', 'cavalry'] as UnitClass[]) {
    const share = (classCounts[cls] ?? 0) / military;
    if (share >= ADAPTATION.shareThreshold - 1e-9 && share > bestShare) {
      best = cls;
      bestShare = share;
    }
  }
  if (!best) return null;
  let counter = ADAPTATION.counters[best];
  if (!counter) return null;
  if (best === 'ranged' && !isUnlocked(counter, d)) counter = ADAPTATION.rangedCounterD1;
  if (!isUnlocked(counter, d)) return null;
  return { cls: best, counter, word: ADAPT_WORD[best] ?? 'ways' };
}

// ---------------------------------------------------------------------------
// Spent clock (§I "Spent")
// ---------------------------------------------------------------------------

export interface SpentClock {
  /** Wave whose launch made the Nest Spent (-1 = none). */
  wave: number;
  launchTick: number;
  /** Tick at which Spent ends (-1 when not spent). */
  until: number;
}

export const NOT_SPENT: SpentClock = { wave: -1, launchTick: -1, until: -1 };

/** A Nest launches wave `wave`: Spent until 90 s after launch unless the wave breaks first. */
export function spentOnLaunch(wave: number, tick: number, tickRate: number): SpentClock {
  return { wave, launchTick: tick, until: tick + Math.round(SPENT.maxFromLaunch * tickRate) };
}

/**
 * Wave `wave` broke at `tick`. If it is the wave that made the Nest Spent and the 90 s cap has not
 * passed, Spent ends 30 s after the break.
 */
export function spentOnBroken(c: SpentClock, wave: number, tick: number, tickRate: number): SpentClock {
  if (c.wave !== wave || c.until < 0 || tick >= c.until) return c;
  return { ...c, until: tick + Math.round(SPENT.afterBroken * tickRate) };
}

export function spentActive(c: SpentClock, tick: number): boolean {
  return c.until >= 0 && tick < c.until;
}

// ---------------------------------------------------------------------------
// Blight
// ---------------------------------------------------------------------------

/** Radius of a growing source after `elapsed` seconds. */
export function blightRadiusAt(start: number, cap: number, interval: number, elapsed: number): number {
  if (elapsed <= 0) return Math.min(start, cap);
  return Math.min(cap, start + floorEps(elapsed / interval));
}

/** Radius while receding from `from` to 0 over BLIGHT.recedeTime seconds. */
export function recedeRadius(from: number, elapsed: number, duration: number = BLIGHT.recedeTime): number {
  if (elapsed >= duration) return 0;
  return Math.max(0, from * (1 - elapsed / duration));
}

export interface BlightCircle {
  x: number;
  y: number;
  r: number;
}

/**
 * Blight tiles: a tile is blighted when its center lies within the radius of a living source AND
 * its ward count is 0 AND it can carry Blight (`canBlight[tile] === 1`, null = all tiles).
 * Writes into `out` and returns true if anything changed.
 */
export function computeBlightTiles(
  out: Uint8Array,
  w: number,
  h: number,
  circles: readonly BlightCircle[],
  ward: Uint16Array | null,
  canBlight: Uint8Array | null,
): boolean {
  const next = new Uint8Array(w * h);
  for (const c of circles) {
    if (c.r <= 0) continue;
    const r2 = c.r * c.r;
    const x0 = Math.max(0, Math.floor(c.x - c.r - 1));
    const x1 = Math.min(w - 1, Math.ceil(c.x + c.r + 1));
    const y0 = Math.max(0, Math.floor(c.y - c.r - 1));
    const y1 = Math.min(h - 1, Math.ceil(c.y + c.r + 1));
    for (let ty = y0; ty <= y1; ty++) {
      const dy = ty + 0.5 - c.y;
      for (let tx = x0; tx <= x1; tx++) {
        const dx = tx + 0.5 - c.x;
        if (dx * dx + dy * dy > r2 + 1e-9) continue;
        const i = ty * w + tx;
        if (ward && ward[i] > 0) continue;
        if (canBlight && canBlight[i] === 0) continue;
        next[i] = 1;
      }
    }
  }
  let changed = false;
  for (let i = 0; i < next.length; i++) {
    if (out[i] !== next[i]) {
      changed = true;
      out[i] = next[i];
    }
  }
  return changed;
}

export interface WardRect {
  tx: number;
  ty: number;
  w: number;
  h: number;
  /** Ward radius measured from the footprint edge (tile centers). */
  r: number;
}

/** Ward counts: each warding footprint adds 1 to every tile whose center is within r of the footprint. */
export function computeWardGrid(out: Uint16Array, w: number, h: number, rects: readonly WardRect[]): void {
  out.fill(0);
  for (const b of rects) {
    if (b.r <= 0) continue;
    const x0 = Math.max(0, Math.floor(b.tx - b.r));
    const x1 = Math.min(w - 1, Math.ceil(b.tx + b.w + b.r));
    const y0 = Math.max(0, Math.floor(b.ty - b.r));
    const y1 = Math.min(h - 1, Math.ceil(b.ty + b.h + b.r));
    const r2 = b.r * b.r;
    for (let ty = y0; ty <= y1; ty++) {
      const cy = ty + 0.5;
      const dy = cy < b.ty ? b.ty - cy : cy > b.ty + b.h ? cy - (b.ty + b.h) : 0;
      for (let tx = x0; tx <= x1; tx++) {
        const cx = tx + 0.5;
        const dx = cx < b.tx ? b.tx - cx : cx > b.tx + b.w ? cx - (b.tx + b.w) : 0;
        if (dx * dx + dy * dy <= r2 + 1e-9) out[ty * w + tx]++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Plunder (§M)
// ---------------------------------------------------------------------------

export type PlunderKind = 'nest' | 'picket' | 'cache' | 'ancient';

/** Crowns for a plunder source. Fortified Nests double Nest plunder; Plunderers adds +10 per Nest or Picket. */
export function plunderCrowns(kind: PlunderKind, fortified: boolean, plunderers: boolean): number {
  switch (kind) {
    case 'nest':
      return CROWNS.plunder.nest * (fortified ? CROWNS.plunder.nestFortifiedMult : 1) + (plunderers ? INCOME.plunderersCrowns : 0);
    case 'picket':
      return CROWNS.plunder.picket + (plunderers ? INCOME.plunderersCrowns : 0);
    case 'cache':
      return CROWNS.plunder.cache;
    case 'ancient':
      return CROWNS.plunder.ancientCache;
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/** 8-way compass direction of (toX, toY) seen from (fromX, fromY). Screen y grows downward. */
export function compassDir(fromX: number, fromY: number, toX: number, toY: number): string {
  const a = Math.atan2(toY - fromY, toX - fromX);
  const idx = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return COMPASS[idx];
}

/** Horn size label: Small < 8, Medium 8-19, Large >= 20 units. */
export function sizeLabel(count: number): 'Small' | 'Medium' | 'Large' {
  if (count >= DIRECTOR.hornLargeAt) return 'Large';
  if (count >= DIRECTOR.hornMediumAt) return 'Medium';
  return 'Small';
}

/** m:ss (never negative). */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** Percentage drop of wave size when N goes from `before` to `after` (relative to full strength). */
export function wavePctDrop(before: number, after: number): number {
  return Math.round((before - after) * 100);
}
