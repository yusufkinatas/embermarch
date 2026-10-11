/**
 * Fixed-capacity particle pool (GDD §P: particles use Math.random and are capped at 400).
 * Pure data + stepping; drawing lives in fx.ts.
 */

export const MAX_PARTICLES = 400;

export type ParticleKind = 'dot' | 'square' | 'smoke' | 'dust' | 'spark' | 'mote' | 'chip' | 'flame' | 'leaf';

export interface Particle {
  kind: ParticleKind;
  /** Ground position (world px). */
  x: number;
  y: number;
  /** Height above ground (world px, drawn as y - z). */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Gravity on z (px/s², positive pulls down). */
  g: number;
  /** Linear drag per second (0 = none). */
  drag: number;
  life: number;
  max: number;
  size: number;
  /** Size growth per second. */
  grow: number;
  color: string;
  /** Additive blending (sparks, embers, motes). */
  add: boolean;
  alpha: number;
}

export interface ParticleSpec {
  kind?: ParticleKind;
  x: number;
  y: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  g?: number;
  drag?: number;
  life: number;
  size?: number;
  grow?: number;
  color: string;
  add?: boolean;
  alpha?: number;
}

export class ParticlePool {
  readonly cap: number;
  readonly items: Particle[] = [];
  private free: Particle[] = [];

  constructor(cap = MAX_PARTICLES) {
    this.cap = cap;
  }

  get count(): number {
    return this.items.length;
  }

  /** Spawn a particle; when full, the oldest-progress particle is recycled. Returns the particle. */
  spawn(s: ParticleSpec): Particle {
    let p: Particle;
    if (this.items.length >= this.cap) {
      // Recycle the particle closest to death.
      let best = 0;
      let bestFrac = -1;
      for (let i = 0; i < this.items.length; i++) {
        const q = this.items[i];
        const frac = 1 - q.life / q.max;
        if (frac > bestFrac) {
          bestFrac = frac;
          best = i;
        }
      }
      p = this.items[best];
    } else {
      p = this.free.pop() ?? ({} as Particle);
      this.items.push(p);
    }
    p.kind = s.kind ?? 'dot';
    p.x = s.x;
    p.y = s.y;
    p.z = s.z ?? 0;
    p.vx = s.vx ?? 0;
    p.vy = s.vy ?? 0;
    p.vz = s.vz ?? 0;
    p.g = s.g ?? 0;
    p.drag = s.drag ?? 0;
    p.life = s.life;
    p.max = s.life;
    p.size = s.size ?? 2;
    p.grow = s.grow ?? 0;
    p.color = s.color;
    p.add = s.add ?? false;
    p.alpha = s.alpha ?? 1;
    return p;
  }

  step(dt: number): void {
    if (dt <= 0) return;
    const items = this.items;
    let w = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.free.push(p);
        continue;
      }
      if (p.drag > 0) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
        p.vz *= k;
      }
      p.vz -= p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz = 0;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
      p.size = Math.max(0.2, p.size + p.grow * dt);
      items[w++] = p;
    }
    items.length = w;
  }

  clear(): void {
    for (const p of this.items) this.free.push(p);
    this.items.length = 0;
  }
}
