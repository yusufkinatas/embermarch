/**
 * Background layers on the music bus (ducked under the horn):
 * - combat drums: a 2-drum synth loop at 100 BPM, gain follows the combat intensity and fades out
 *   over 4 s once it drops to 0 (GDD §P, SHOULD);
 * - ambient wind: looping filtered noise with slow filter / level drift (SHOULD).
 */
import { drumHit } from './recipes';

const BPM = 100;
const EIGHTH = 60 / BPM / 2;
const LOOKAHEAD = 0.35;
const TICK_MS = 100;
const FADE_OUT = 4;
const DRUM_LEVEL = 0.55;

/** One bar of eighths: [low drum velocity, high drum velocity]. */
const PATTERN: [number, number][] = [
  [1, 0],
  [0, 0],
  [0, 0.8],
  [0.45, 0],
  [0.9, 0],
  [0, 0.35],
  [0, 0.8],
  [0.35, 0.3],
];

export class MusicLayer {
  private readonly ac: AudioContext;
  private readonly bus: AudioNode;
  private readonly noise: AudioBuffer;
  private readonly drumGain: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBeat = 0;
  private step = 0;
  private level = 0;
  private stopAt = 0;
  private wind: { src: AudioBufferSourceNode; gain: GainNode; lfos: OscillatorNode[] } | null = null;

  constructor(ac: AudioContext, bus: AudioNode, noise: AudioBuffer) {
    this.ac = ac;
    this.bus = bus;
    this.noise = noise;
    this.drumGain = ac.createGain();
    this.drumGain.gain.value = 0;
    this.drumGain.connect(bus);
  }

  /** Combat intensity 0..1. */
  setCombat(target: number): void {
    const v = Math.max(0, Math.min(1, target));
    if (Math.abs(v - this.level) < 0.05 && (v > 0) === this.level > 0) return;
    const now = this.ac.currentTime;
    const g = this.drumGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (v > 0) {
      g.linearRampToValueAtTime(v * DRUM_LEVEL, now + (this.level > 0 ? 0.6 : 1.2));
      this.stopAt = Infinity;
      if (!this.timer) this.startScheduler();
    } else {
      g.linearRampToValueAtTime(0, now + FADE_OUT);
      this.stopAt = now + FADE_OUT + 0.2;
    }
    this.level = v;
  }

  private startScheduler(): void {
    this.nextBeat = this.ac.currentTime + 0.05;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  private schedule(): void {
    const now = this.ac.currentTime;
    if (now > this.stopAt) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    // Skip ahead if the tab was throttled.
    if (this.nextBeat < now - 0.2) this.nextBeat = now + 0.05;
    while (this.nextBeat < now + LOOKAHEAD) {
      const [low, high] = PATTERN[this.step % PATTERN.length];
      const v = { ac: this.ac, out: this.drumGain, t: this.nextBeat, pitch: 1 + (Math.random() - 0.5) * 0.02, noise: this.noise };
      if (low > 0) drumHit(v, 72, 0.5 * low);
      if (high > 0) drumHit(v, 148, 0.32 * high);
      this.nextBeat += EIGHTH;
      this.step++;
    }
  }

  setAmbient(on: boolean): void {
    const now = this.ac.currentTime;
    if (on && !this.wind) {
      const src = this.ac.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const lp = this.ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 480;
      lp.Q.value = 0.6;
      const gain = this.ac.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.06, now + 2.5);
      // Slow gusts: filter sweep and level drift.
      const lfo1 = this.ac.createOscillator();
      lfo1.frequency.value = 0.07;
      const d1 = this.ac.createGain();
      d1.gain.value = 260;
      lfo1.connect(d1);
      d1.connect(lp.frequency);
      const lfo2 = this.ac.createOscillator();
      lfo2.frequency.value = 0.13;
      const d2 = this.ac.createGain();
      d2.gain.value = 0.02;
      lfo2.connect(d2);
      d2.connect(gain.gain);
      src.connect(lp);
      lp.connect(gain);
      gain.connect(this.bus);
      src.start(now);
      lfo1.start(now);
      lfo2.start(now);
      this.wind = { src, gain, lfos: [lfo1, lfo2] };
    } else if (!on && this.wind) {
      const w = this.wind;
      this.wind = null;
      w.gain.gain.cancelScheduledValues(now);
      w.gain.gain.setValueAtTime(w.gain.gain.value, now);
      w.gain.gain.linearRampToValueAtTime(0, now + 1.5);
      w.src.stop(now + 1.6);
      for (const l of w.lfos) l.stop(now + 1.6);
    }
  }

  get ambientOn(): boolean {
    return this.wind !== null;
  }

  get drumsActive(): boolean {
    return this.timer !== null;
  }
}
