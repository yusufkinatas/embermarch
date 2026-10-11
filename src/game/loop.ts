/**
 * Fixed-step simulation clock with an accumulator (GDD §Q: 20 Hz sim, 60 fps interpolation).
 * Pure logic, no DOM: the battle controller feeds real frame time and reads `alpha`.
 */
import { TICK_DT } from '../sim/types';

/** Discrete game speeds (§O: − / = step through 1×, 1.5×, 2×). */
export const SPEED_STEPS = [1, 1.5, 2] as const;

/** Real-time frame delta clamp (tab switches, debugger pauses). */
export const MAX_FRAME_DT = 0.25;

export function nextSpeed(current: number, dir: -1 | 1): number {
  const idx = SPEED_STEPS.findIndex((s) => Math.abs(s - current) < 1e-6);
  if (idx < 0) {
    // Off-grid (debug setSpeed): move to the nearest step in the requested direction.
    if (dir > 0) return SPEED_STEPS.find((s) => s > current) ?? SPEED_STEPS[SPEED_STEPS.length - 1];
    return [...SPEED_STEPS].reverse().find((s) => s < current) ?? SPEED_STEPS[0];
  }
  const next = Math.min(SPEED_STEPS.length - 1, Math.max(0, idx + dir));
  return SPEED_STEPS[next];
}

export class FixedStepLoop {
  /** Simulated seconds waiting to be stepped. */
  acc = 0;
  speed = 1;
  paused = false;
  /** Total ticks stepped (diagnostics). */
  ticks = 0;
  private slowmo: { factor: number; remaining: number } | null = null;

  constructor(
    private readonly step: () => void,
    readonly tickDt: number = TICK_DT,
    readonly maxStepsPerFrame = 5,
  ) {}

  /** Slow motion for `duration` real seconds. Overlapping requests keep the strongest factor and longest time. */
  addSlowmo(factor: number, duration: number): void {
    if (!(factor > 0) || !(duration > 0)) return;
    if (this.slowmo) {
      this.slowmo.factor = Math.min(this.slowmo.factor, factor);
      this.slowmo.remaining = Math.max(this.slowmo.remaining, duration);
    } else {
      this.slowmo = { factor, remaining: duration };
    }
  }

  get slowmoFactor(): number {
    return this.slowmo ? this.slowmo.factor : 1;
  }

  /**
   * Advance by `realDt` real seconds. Runs at most `maxStepsPerFrame` ticks; any further backlog is
   * dropped so a slow frame never spirals. Returns the number of ticks run.
   */
  advance(realDt: number): number {
    const dt = Math.min(MAX_FRAME_DT, Math.max(0, realDt));
    let scale = this.speed;
    if (this.slowmo) {
      scale *= this.slowmo.factor;
      this.slowmo.remaining -= dt;
      if (this.slowmo.remaining <= 1e-6) this.slowmo = null;
    }
    if (this.paused) return 0;
    this.acc += dt * scale;
    let n = 0;
    // Small epsilon so 3 × (1/60) reliably makes one 0.05 tick despite float drift.
    while (this.acc >= this.tickDt - 1e-9 && n < this.maxStepsPerFrame) {
      this.step();
      this.acc -= this.tickDt;
      n++;
    }
    if (this.acc < 0) this.acc = 0;
    if (n >= this.maxStepsPerFrame && this.acc >= this.tickDt) this.acc %= this.tickDt;
    this.ticks += n;
    return n;
  }

  /** Interpolation factor in [0, 1) between the previous and current tick. */
  get alpha(): number {
    const a = this.acc / this.tickDt;
    return a < 0 ? 0 : a >= 1 ? 0.999 : a;
  }
}
