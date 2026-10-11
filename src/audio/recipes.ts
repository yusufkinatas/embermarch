/**
 * Synth recipes for every SfxName (GDD §P table). Each recipe schedules its nodes on `v.out`
 * starting at `v.t` and returns its duration in seconds. Envelopes always start and end near
 * zero (no clicks); every oscillator / buffer source is stopped after its envelope ends.
 */
import type { SfxName } from '../game/types';

export interface VoiceCtx {
  ac: BaseAudioContext;
  /** Per-voice input node (gain → pan → bus). */
  out: AudioNode;
  /** Start time (AudioContext seconds). */
  t: number;
  /** Pitch multiplier (includes the random detune). */
  pitch: number;
  /** Shared white-noise buffer. */
  noise: AudioBuffer;
}

export type Recipe = (v: VoiceCtx) => number;

const SILENT = 0.0001;

/** Linear attack to `peak`, exponential decay to silence at `t0 + dur`. */
function adEnv(p: AudioParam, t0: number, attack: number, peak: number, dur: number): void {
  p.setValueAtTime(SILENT, t0);
  p.linearRampToValueAtTime(peak, t0 + attack);
  p.exponentialRampToValueAtTime(SILENT, t0 + Math.max(dur, attack + 0.01));
}

/** Attack / hold / release envelope for sustained sounds (horns, pads). */
function ahrEnv(p: AudioParam, t0: number, attack: number, peak: number, hold: number, release: number): void {
  p.setValueAtTime(SILENT, t0);
  p.linearRampToValueAtTime(peak, t0 + attack);
  p.setValueAtTime(peak, t0 + attack + hold);
  p.exponentialRampToValueAtTime(SILENT, t0 + attack + hold + release);
}

interface FilterSpec {
  type: BiquadFilterType;
  f: number;
  /** Sweep target frequency (exponential over the sound's duration). */
  f2?: number;
  q?: number;
}

function makeFilter(v: VoiceCtx, spec: FilterSpec, t0: number, dur: number): BiquadFilterNode {
  const flt = v.ac.createBiquadFilter();
  flt.type = spec.type;
  flt.Q.value = spec.q ?? 0.8;
  flt.frequency.setValueAtTime(spec.f, t0);
  if (spec.f2 !== undefined) flt.frequency.exponentialRampToValueAtTime(spec.f2, t0 + dur);
  return flt;
}

interface ToneSpec {
  type: OscillatorType;
  /** Frequency in Hz (multiplied by the voice pitch). */
  f: number;
  /** Glide target frequency. */
  f2?: number;
  /** Glide time (defaults to the duration). */
  glide?: number;
  at?: number;
  dur: number;
  peak: number;
  attack?: number;
  detune?: number;
  filter?: FilterSpec;
  vibrato?: { rate: number; depth: number; delay?: number };
}

function tone(v: VoiceCtx, s: ToneSpec): void {
  const { ac } = v;
  const t0 = v.t + (s.at ?? 0);
  const osc = ac.createOscillator();
  osc.type = s.type;
  osc.frequency.setValueAtTime(s.f * v.pitch, t0);
  if (s.f2 !== undefined) osc.frequency.exponentialRampToValueAtTime(s.f2 * v.pitch, t0 + (s.glide ?? s.dur));
  if (s.detune) osc.detune.value = s.detune;
  const g = ac.createGain();
  adEnv(g.gain, t0, s.attack ?? 0.004, s.peak, s.dur);
  let node: AudioNode = osc;
  if (s.filter) {
    const flt = makeFilter(v, s.filter, t0, s.dur);
    osc.connect(flt);
    node = flt;
  }
  node.connect(g);
  g.connect(v.out);
  let lfo: OscillatorNode | null = null;
  if (s.vibrato) {
    lfo = ac.createOscillator();
    lfo.frequency.value = s.vibrato.rate;
    const depth = ac.createGain();
    depth.gain.setValueAtTime(0, t0);
    depth.gain.linearRampToValueAtTime(s.vibrato.depth * v.pitch, t0 + (s.vibrato.delay ?? 0.05) + 0.1);
    lfo.connect(depth);
    depth.connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(t0 + s.dur + 0.05);
  }
  osc.start(t0);
  osc.stop(t0 + s.dur + 0.05);
}

interface NoiseSpec {
  at?: number;
  dur: number;
  peak: number;
  attack?: number;
  filter: FilterSpec;
  /** Optional second filter in series (band shaping). */
  filter2?: FilterSpec;
}

function noise(v: VoiceCtx, s: NoiseSpec): void {
  const { ac } = v;
  const t0 = v.t + (s.at ?? 0);
  const src = ac.createBufferSource();
  src.buffer = v.noise;
  const maxOff = Math.max(0, v.noise.duration - s.dur - 0.1);
  const flt = makeFilter(v, { ...s.filter, f: s.filter.f * v.pitch, f2: s.filter.f2 !== undefined ? s.filter.f2 * v.pitch : undefined }, t0, s.dur);
  const g = ac.createGain();
  adEnv(g.gain, t0, s.attack ?? 0.003, s.peak, s.dur);
  src.connect(flt);
  let node: AudioNode = flt;
  if (s.filter2) {
    const f2 = makeFilter(v, s.filter2, t0, s.dur);
    flt.connect(f2);
    node = f2;
  }
  node.connect(g);
  g.connect(v.out);
  src.start(t0, Math.random() * maxOff);
  src.stop(t0 + s.dur + 0.05);
}

/** Lowpassed detuned sawtooth horn sweeping base → top with vibrato (wave_horn family). */
function horn(v: VoiceCtx, o: { at?: number; base: number; top: number; sweep: number; attack: number; hold: number; release: number; peak: number }): number {
  const { ac } = v;
  const t0 = v.t + (o.at ?? 0);
  const total = o.attack + o.hold + o.release;
  const g = ac.createGain();
  ahrEnv(g.gain, t0, o.attack, o.peak, o.hold, o.release);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.1;
  lp.frequency.setValueAtTime(520, t0);
  lp.frequency.linearRampToValueAtTime(1150, t0 + Math.min(total, o.sweep + 0.2));
  lp.connect(g);
  g.connect(v.out);
  const lfo = ac.createOscillator();
  lfo.frequency.value = 5.3;
  const depth = ac.createGain();
  depth.gain.setValueAtTime(0, t0);
  depth.gain.linearRampToValueAtTime(3.2 * v.pitch * (o.base / 110), t0 + Math.min(0.5, total * 0.6));
  lfo.connect(depth);
  for (const [det, level] of [[-7, 1], [7, 1], [0, 0.55]] as const) {
    const osc = ac.createOscillator();
    osc.type = level < 1 ? 'triangle' : 'sawtooth';
    const mult = level < 1 ? 0.5 : 1;
    osc.frequency.setValueAtTime(o.base * v.pitch * mult, t0);
    osc.frequency.exponentialRampToValueAtTime(o.top * v.pitch * mult, t0 + o.sweep);
    osc.detune.value = det;
    depth.connect(osc.frequency);
    const lv = ac.createGain();
    lv.gain.value = level;
    osc.connect(lv);
    lv.connect(lp);
    osc.start(t0);
    osc.stop(t0 + total + 0.05);
  }
  lfo.start(t0);
  lfo.stop(t0 + total + 0.05);
  return (o.at ?? 0) + total;
}

/** A soft bell-like note: triangle + quiet sine octave. */
function chime(v: VoiceCtx, f: number, at: number, dur: number, peak: number): void {
  tone(v, { type: 'triangle', f, at, dur, peak, attack: 0.006 });
  tone(v, { type: 'sine', f: f * 2, at, dur: dur * 0.6, peak: peak * 0.25, attack: 0.004 });
}

/** One synth tom: sine with a falling pitch plus a short lowpassed noise skin. */
export function drumHit(v: VoiceCtx, f: number, peak: number): number {
  tone(v, { type: 'sine', f, f2: f * 0.5, glide: 0.14, dur: 0.32, peak, attack: 0.003 });
  noise(v, { dur: 0.07, peak: peak * 0.35, filter: { type: 'lowpass', f: 900 } });
  return 0.35;
}

// Note frequencies.
const C4 = 261.63;
const D4 = 293.66;
const E4 = 329.63;
const F4 = 349.23;
const G4 = 392.0;
const A3 = 220.0;
const A4 = 440.0;
const B5 = 987.77;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880.0;
const C6 = 1046.5;
const E6 = 1318.51;
const G6 = 1567.98;
const C7 = 2093.0;

export const RECIPES: Record<SfxName, Recipe> = {
  ui_click: (v) => {
    tone(v, { type: 'sine', f: 1000, dur: 0.03, peak: 0.22, attack: 0.002 });
    return 0.04;
  },
  ui_error: (v) => {
    tone(v, { type: 'square', f: 120, dur: 0.16, peak: 0.1, attack: 0.006, filter: { type: 'lowpass', f: 900 } });
    tone(v, { type: 'square', f: 123, dur: 0.16, peak: 0.05, attack: 0.006, filter: { type: 'lowpass', f: 700 } });
    return 0.18;
  },
  select: (v) => {
    tone(v, { type: 'triangle', f: 660, f2: 700, dur: 0.075, peak: 0.2, attack: 0.003 });
    return 0.09;
  },
  acknowledge: (v) => {
    tone(v, { type: 'triangle', f: 660, dur: 0.06, peak: 0.15, attack: 0.003 });
    tone(v, { type: 'triangle', f: 831.6, at: 0.055, dur: 0.08, peak: 0.16, attack: 0.003 });
    return 0.15;
  },
  chop: (v) => {
    noise(v, { dur: 0.08, peak: 0.45, attack: 0.002, filter: { type: 'bandpass', f: 1200, q: 2.2 } });
    tone(v, { type: 'sine', f: 190, f2: 120, dur: 0.07, peak: 0.22, attack: 0.002 });
    return 0.1;
  },
  mine: (v) => {
    tone(v, { type: 'square', f: 1200, dur: 0.11, peak: 0.07, attack: 0.001, filter: { type: 'lowpass', f: 3600 } });
    tone(v, { type: 'sine', f: 2400, dur: 0.07, peak: 0.05, attack: 0.001 });
    noise(v, { dur: 0.03, peak: 0.1, filter: { type: 'highpass', f: 4000 } });
    return 0.13;
  },
  harvest: (v) => {
    noise(v, { dur: 0.16, peak: 0.2, attack: 0.05, filter: { type: 'highpass', f: 2400, f2: 4200, q: 0.7 } });
    return 0.18;
  },
  dropoff: (v) => {
    tone(v, { type: 'sine', f: B5, dur: 0.09, peak: 0.16, attack: 0.003 });
    tone(v, { type: 'sine', f: E6, at: 0.07, dur: 0.24, peak: 0.16, attack: 0.003 });
    tone(v, { type: 'triangle', f: E6 / 2, at: 0.07, dur: 0.16, peak: 0.04 });
    return 0.32;
  },
  build_hammer: (v) => {
    noise(v, { dur: 0.05, peak: 0.4, attack: 0.002, filter: { type: 'bandpass', f: 900, q: 1.4 } });
    tone(v, { type: 'sine', f: 150, f2: 90, dur: 0.08, peak: 0.25, attack: 0.002 });
    return 0.1;
  },
  build_complete: (v) => {
    chime(v, C5, 0, 0.3, 0.16);
    chime(v, E5, 0.09, 0.3, 0.16);
    chime(v, G5, 0.18, 0.6, 0.17);
    return 0.8;
  },
  unit_trained: (v) => {
    chime(v, G5, 0, 0.18, 0.13);
    chime(v, C6, 0.11, 0.32, 0.14);
    return 0.45;
  },
  research_complete: (v) => {
    chime(v, C5, 0, 0.3, 0.14);
    tone(v, { type: 'sine', f: G5, at: 0.14, dur: 0.7, peak: 0.14, attack: 0.01, vibrato: { rate: 5, depth: 4, delay: 0.2 } });
    tone(v, { type: 'triangle', f: G5, at: 0.14, dur: 0.5, peak: 0.06 });
    return 0.86;
  },
  bow_loose: (v) => {
    noise(v, { dur: 0.12, peak: 0.42, attack: 0.004, filter: { type: 'bandpass', f: 4200, f2: 500, q: 2 } });
    tone(v, { type: 'triangle', f: 260, f2: 200, dur: 0.06, peak: 0.06, attack: 0.002 });
    return 0.14;
  },
  bolt_fire: (v) => {
    tone(v, { type: 'sine', f: 600, f2: 300, glide: 0.15, dur: 0.17, peak: 0.2, attack: 0.004 });
    noise(v, { dur: 0.06, peak: 0.07, filter: { type: 'bandpass', f: 1500, q: 1.2 } });
    return 0.19;
  },
  melee_hit: (v) => {
    tone(v, { type: 'square', f: 330, dur: 0.09, peak: 0.06, attack: 0.001, filter: { type: 'lowpass', f: 2200 } });
    tone(v, { type: 'square', f: 330, detune: 30, dur: 0.09, peak: 0.06, attack: 0.001, filter: { type: 'lowpass', f: 2000 } });
    noise(v, { dur: 0.06, peak: 0.18, attack: 0.001, filter: { type: 'highpass', f: 2800 } });
    noise(v, { dur: 0.05, peak: 0.16, attack: 0.001, filter: { type: 'bandpass', f: 600, q: 1 } });
    return 0.11;
  },
  thorn_hit: (v) => {
    noise(v, { dur: 0.06, peak: 0.42, attack: 0.002, filter: { type: 'bandpass', f: 1700, q: 2.8 } });
    tone(v, { type: 'square', f: 95, dur: 0.05, peak: 0.07, attack: 0.002, filter: { type: 'lowpass', f: 600 } });
    return 0.08;
  },
  death_player: (v) => {
    tone(v, { type: 'sine', f: 110, f2: 48, dur: 0.32, peak: 0.32, attack: 0.004 });
    noise(v, { dur: 0.18, peak: 0.25, filter: { type: 'lowpass', f: 350 } });
    return 0.35;
  },
  death_thorn: (v) => {
    for (let k = 0; k < 5; k++) {
      noise(v, { at: k * 0.055 + Math.random() * 0.03, dur: 0.035, peak: 0.2 - k * 0.03, attack: 0.002, filter: { type: 'highpass', f: 2200 + Math.random() * 1200 } });
    }
    tone(v, { type: 'triangle', f: 720, f2: 260, dur: 0.36, peak: 0.05, attack: 0.01 });
    return 0.4;
  },
  building_destroyed: (v) => {
    tone(v, { type: 'sine', f: 60, f2: 32, dur: 0.75, peak: 0.45, attack: 0.01 });
    noise(v, { dur: 0.65, peak: 0.3, attack: 0.01, filter: { type: 'lowpass', f: 900, f2: 250 } });
    noise(v, { at: 0.16, dur: 0.3, peak: 0.12, filter: { type: 'bandpass', f: 1400, q: 1 } });
    return 0.8;
  },
  nest_destroyed: (v) => {
    tone(v, { type: 'sine', f: 95, f2: 28, dur: 1.3, peak: 0.55, attack: 0.008 });
    noise(v, { dur: 0.9, peak: 0.3, attack: 0.008, filter: { type: 'lowpass', f: 700, f2: 120 } });
    [G6, C7, E6 * 2].forEach((f, i) => {
      tone(v, { type: 'triangle', f, at: 0.15 + i * 0.1, dur: 1.0, peak: 0.045, attack: 0.04, vibrato: { rate: 6, depth: 8 } });
    });
    return 1.4;
  },
  wave_horn: (v) => horn(v, { base: 110, top: 220, sweep: 0.9, attack: 0.25, hold: 1.0, release: 0.45, peak: 0.22 }),
  wave_broken: (v) => horn(v, { base: 165, top: 330, sweep: 0.18, attack: 0.06, hold: 0.19, release: 0.15, peak: 0.2 }),
  raid_alert: (v) => {
    horn(v, { base: 147, top: 220, sweep: 0.12, attack: 0.04, hold: 0.12, release: 0.08, peak: 0.2 });
    return horn(v, { at: 0.28, base: 147, top: 220, sweep: 0.12, attack: 0.04, hold: 0.12, release: 0.1, peak: 0.2 });
  },
  beacon_lit: (v) => {
    chime(v, E5, 0, 0.45, 0.12);
    chime(v, A5, 0.1, 0.45, 0.12);
    chime(v, E6, 0.2, 0.7, 0.12);
    return 0.92;
  },
  beacon_snuffed: (v) => {
    chime(v, E6, 0, 0.35, 0.1);
    chime(v, B5, 0.12, 0.35, 0.1);
    chime(v, E5, 0.24, 0.4, 0.1);
    tone(v, { type: 'sine', f: 493.88, at: 0.36, dur: 0.6, peak: 0.1, attack: 0.01 });
    return 0.98;
  },
  boss_telegraph: (v) => {
    tone(v, {
      type: 'sawtooth',
      f: 280,
      f2: 900,
      glide: 0.9,
      dur: 1.0,
      peak: 0.3,
      attack: 0.3,
      filter: { type: 'bandpass', f: 600, f2: 1600, q: 2.5 },
      vibrato: { rate: 9, depth: 12, delay: 0.1 },
    });
    return 1.05;
  },
  boss_slam: (v) => {
    tone(v, { type: 'sine', f: 70, f2: 32, dur: 0.55, peak: 0.6, attack: 0.004 });
    noise(v, { dur: 0.4, peak: 0.35, attack: 0.003, filter: { type: 'lowpass', f: 650 } });
    noise(v, { dur: 0.08, peak: 0.1, filter: { type: 'highpass', f: 3000 } });
    return 0.6;
  },
  rank_up: (v) => {
    [C6, E6, G6, C7].forEach((f, i) => tone(v, { type: 'triangle', f, at: i * 0.05, dur: 0.22, peak: 0.09, attack: 0.003 }));
    noise(v, { at: 0.05, dur: 0.25, peak: 0.025, attack: 0.05, filter: { type: 'highpass', f: 6000 } });
    return 0.4;
  },
  card_flip: (v) => {
    noise(v, { dur: 0.05, peak: 0.32, attack: 0.003, filter: { type: 'bandpass', f: 2800, q: 0.9 } });
    noise(v, { at: 0.035, dur: 0.04, peak: 0.15, attack: 0.003, filter: { type: 'bandpass', f: 3600, q: 0.9 } });
    return 0.09;
  },
  victory: (v) => {
    [C4, E4, G4, C5, E5].forEach((f, i) => chime(v, f, i * 0.13, i === 4 ? 1.5 : 0.45, 0.15));
    for (const f of [C4, G4, C5]) tone(v, { type: 'sine', f, at: 0.55, dur: 1.6, peak: 0.05, attack: 0.25 });
    return 2.2;
  },
  defeat: (v) => {
    [A4, F4, D4, A3].forEach((f, i) => {
      const last = i === 3;
      tone(v, { type: 'triangle', f, at: i * 0.3, dur: last ? 1.5 : 0.5, peak: 0.14, attack: 0.02, filter: { type: 'lowpass', f: 1500 } });
      tone(v, { type: 'sine', f: f / 2, at: i * 0.3, dur: last ? 1.5 : 0.45, peak: 0.07, attack: 0.02 });
    });
    return 2.45;
  },
};
