/**
 * Procedural animated backdrop: layered hills, briar silhouettes, a hearth glow and rising embers.
 * Cosmetic only (Math.random). The static layers are cached on an offscreen canvas and rebuilt
 * on resize; each frame draws one image, a glow and at most ~160 additive sprites.
 */

export type EmberMode = 'title' | 'victory' | 'defeat' | 'retreat' | 'ambient';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  violet: boolean;
  phase: number;
  sway: number;
}

export interface EmberOptions {
  mode: EmberMode;
  /** Draw the hills / briar backdrop (title). Otherwise the canvas is transparent. */
  scenery?: boolean;
  /** Particle budget at 1280x720 (scaled by area). */
  count?: number;
}

const MAX_DPR = 1.5;

function makeSprite(inner: string, mid: string, size = 48): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.18, mid);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export class EmberField {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly staticLayer = document.createElement('canvas');
  private readonly emberSprite = makeSprite('rgba(255,236,190,1)', 'rgba(255,128,40,0.75)');
  private readonly violetSprite = makeSprite('rgba(232,190,255,0.9)', 'rgba(150,70,190,0.55)');
  private readonly ashSprite = makeSprite('rgba(210,200,190,0.8)', 'rgba(120,110,100,0.4)');
  private particles: Particle[] = [];
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private t = 0;
  private readonly ro: ResizeObserver;
  private running = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: EmberOptions,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number): void => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (!document.hidden) this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy(): void {
    this.stop();
    this.ro.disconnect();
    this.particles = [];
  }

  private budget(): number {
    const base = this.opts.count ?? (this.opts.mode === 'title' ? 130 : 110);
    const area = (this.w * this.h) / (1280 * 720);
    return Math.max(30, Math.min(170, Math.round(base * Math.sqrt(Math.max(0.2, area)))));
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && this.canvas.width === Math.round(w * this.dpr)) return;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.staticLayer.width = this.canvas.width;
    this.staticLayer.height = this.canvas.height;
    if (this.opts.scenery) this.paintScenery();
    if (this.particles.length === 0) {
      const n = this.budget();
      for (let i = 0; i < n; i++) this.particles.push(this.spawn(true));
    }
  }

  // ---------------------------------------------------------------- scenery

  private paintScenery(): void {
    const g = this.staticLayer.getContext('2d')!;
    const { w, h } = this;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0c0911');
    sky.addColorStop(0.45, '#151019');
    sky.addColorStop(0.72, '#2a1712');
    sky.addColorStop(1, '#1a0f0b');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    // dim stars
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h * 0.45;
      g.fillStyle = `rgba(244,230,193,${0.08 + Math.random() * 0.25})`;
      g.fillRect(x, y, Math.random() < 0.15 ? 1.6 : 1, 1);
    }

    // violet blight glow on the eastern horizon
    const vg = g.createRadialGradient(w * 0.82, h * 0.6, 0, w * 0.82, h * 0.6, w * 0.45);
    vg.addColorStop(0, 'rgba(160,79,184,0.32)');
    vg.addColorStop(0.5, 'rgba(90,31,94,0.14)');
    vg.addColorStop(1, 'rgba(90,31,94,0)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);

    // warm glow on the western road
    const wg = g.createRadialGradient(w * 0.5, h * 1.02, 0, w * 0.5, h * 1.02, h * 0.75);
    wg.addColorStop(0, 'rgba(255,120,40,0.32)');
    wg.addColorStop(0.45, 'rgba(160,60,20,0.12)');
    wg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = wg;
    g.fillRect(0, 0, w, h);

    this.ridge(g, h * 0.62, h * 0.06, '#1b1320', 0.004, 3);
    this.briarCrown(g, w * 0.83, h * 0.6, h * 0.16);
    this.ridge(g, h * 0.7, h * 0.07, '#140e15', 0.006, 4);
    this.keep(g, w * 0.16, h * 0.66, h * 0.11);
    this.road(g);
    this.ridge(g, h * 0.82, h * 0.05, '#0d090d', 0.009, 5);

    // foreground briars framing the corners
    g.save();
    g.lineCap = 'round';
    for (let i = 0; i < 7; i++) this.vine(g, -20 + Math.random() * w * 0.22, h + 10, -Math.PI / 2 + 0.3 + Math.random() * 0.5, h * (0.3 + Math.random() * 0.25), 7 + Math.random() * 4);
    for (let i = 0; i < 7; i++) this.vine(g, w + 20 - Math.random() * w * 0.22, h + 10, -Math.PI / 2 - 0.3 - Math.random() * 0.5, h * (0.3 + Math.random() * 0.25), 7 + Math.random() * 4);
    for (let i = 0; i < 4; i++) this.vine(g, w * (0.82 + Math.random() * 0.2), -10, Math.PI / 2 + 0.4 + Math.random() * 0.4, h * (0.18 + Math.random() * 0.14), 5);
    for (let i = 0; i < 3; i++) this.vine(g, w * Math.random() * 0.14, -10, Math.PI / 2 - 0.5 - Math.random() * 0.3, h * (0.14 + Math.random() * 0.1), 4.5);
    g.restore();
  }

  private ridge(g: CanvasRenderingContext2D, base: number, amp: number, color: string, freq: number, octaves: number): void {
    const { w, h } = this;
    const seeds = Array.from({ length: octaves }, () => Math.random() * 1000);
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w + 8; x += 8) {
      let y = 0;
      let a = 1;
      let f = freq;
      for (let o = 0; o < octaves; o++) {
        y += Math.sin(x * f + seeds[o]) * a;
        a *= 0.5;
        f *= 2.1;
      }
      g.lineTo(x, base - y * amp);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  }

  /** A jagged briar mass rising on the horizon (the Heartwood). */
  private briarCrown(g: CanvasRenderingContext2D, cx: number, base: number, height: number): void {
    g.save();
    g.fillStyle = '#1d1222';
    g.beginPath();
    const width = height * 2.6;
    g.moveTo(cx - width / 2, base);
    const spikes = 26;
    for (let i = 0; i <= spikes; i++) {
      const t = i / spikes;
      const x = cx - width / 2 + t * width;
      const env = Math.sin(t * Math.PI);
      const tall = env * height * (0.55 + Math.random() * 0.45) * (i % 2 === 0 ? 1 : 0.55);
      g.lineTo(x, base - tall);
    }
    g.lineTo(cx + width / 2, base);
    g.closePath();
    g.fill();
    // throne spire
    g.beginPath();
    g.moveTo(cx - height * 0.12, base - height * 0.5);
    g.lineTo(cx, base - height * 1.25);
    g.lineTo(cx + height * 0.12, base - height * 0.5);
    g.fill();
    g.restore();
  }

  /** Ruined keep silhouette with a single lit window. */
  private keep(g: CanvasRenderingContext2D, x: number, base: number, s: number): void {
    g.save();
    g.fillStyle = '#120d12';
    g.fillRect(x - s * 0.18, base - s, s * 0.36, s);
    for (let i = 0; i < 3; i++) g.fillRect(x - s * 0.18 + i * s * 0.14, base - s - s * 0.08, s * 0.08, s * 0.08);
    g.fillRect(x - s * 0.5, base - s * 0.48, s * 0.34, s * 0.48);
    g.fillRect(x + s * 0.16, base - s * 0.62, s * 0.26, s * 0.62);
    g.fillStyle = 'rgba(255,160,70,0.85)';
    g.fillRect(x - s * 0.03, base - s * 0.7, s * 0.06, s * 0.1);
    g.restore();
  }

  /** The Ember Road winding toward the horizon. */
  private road(g: CanvasRenderingContext2D): void {
    const { w, h } = this;
    g.save();
    const grad = g.createLinearGradient(0, h, 0, h * 0.66);
    grad.addColorStop(0, 'rgba(120,70,40,0.35)');
    grad.addColorStop(1, 'rgba(120,70,40,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(w * 0.36, h);
    g.bezierCurveTo(w * 0.48, h * 0.86, w * 0.6, h * 0.78, w * 0.66, h * 0.7);
    g.lineTo(w * 0.675, h * 0.7);
    g.bezierCurveTo(w * 0.64, h * 0.8, w * 0.6, h * 0.88, w * 0.62, h);
    g.closePath();
    g.fill();
    g.restore();
  }

  /** A thorny vine: a wandering stroke that thins out, with triangular thorns. */
  private vine(g: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, width: number): void {
    const steps = 26;
    const seg = length / steps;
    let a = angle;
    let px = x;
    let py = y;
    const bend = (Math.random() - 0.5) * 0.18;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      a += bend + (Math.random() - 0.5) * 0.22;
      const nx = px + Math.cos(a) * seg;
      const ny = py + Math.sin(a) * seg;
      const wdt = Math.max(0.8, width * (1 - t * 0.85));
      g.strokeStyle = '#0a070b';
      g.lineWidth = wdt;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(nx, ny);
      g.stroke();
      if (i % 2 === 1 && i < steps - 2) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const ta = a + side * (Math.PI / 2 - 0.5);
        const tl = wdt * 1.6 + 3;
        g.fillStyle = '#0a070b';
        g.beginPath();
        g.moveTo(nx + Math.cos(a) * wdt * 0.6, ny + Math.sin(a) * wdt * 0.6);
        g.lineTo(nx - Math.cos(a) * wdt * 0.6, ny - Math.sin(a) * wdt * 0.6);
        g.lineTo(nx + Math.cos(ta) * tl, ny + Math.sin(ta) * tl);
        g.closePath();
        g.fill();
      }
      if (i === Math.floor(steps * 0.45) && Math.random() < 0.7) {
        this.vine(g, nx, ny, a + (Math.random() < 0.5 ? -0.8 : 0.8), length * 0.35, wdt * 0.7);
      }
      px = nx;
      py = ny;
    }
  }

  // ---------------------------------------------------------------- particles

  private spawn(initial: boolean): Particle {
    const { w, h } = this;
    const mode = this.opts.mode;
    const violet = mode === 'defeat' ? Math.random() < 0.7 : mode === 'title' ? Math.random() < 0.14 : false;
    const ash = mode === 'defeat' && !violet;
    let x: number;
    let y: number;
    let vx: number;
    let vy: number;
    if (violet && mode === 'title') {
      x = w * (0.6 + Math.random() * 0.4);
      y = h * (0.35 + Math.random() * 0.4);
      vx = -6 - Math.random() * 10;
      vy = -4 + Math.random() * 6;
    } else if (mode === 'defeat') {
      x = Math.random() * w;
      y = -10;
      vx = -6 + Math.random() * 12;
      vy = 10 + Math.random() * 18;
    } else {
      const centered = mode === 'title' ? Math.random() < 0.65 : Math.random() < 0.35;
      x = centered ? w * (0.5 + (Math.random() - 0.5) * 0.45) : Math.random() * w;
      y = h + 10;
      vx = (Math.random() - 0.5) * 14;
      vy = -(26 + Math.random() * (mode === 'victory' ? 70 : 46));
    }
    const max = violet ? 6 + Math.random() * 6 : 4 + Math.random() * 6;
    const p: Particle = {
      x,
      y,
      vx,
      vy,
      life: 0,
      max,
      size: (violet ? 10 : ash ? 7 : 7) + Math.random() * (mode === 'victory' ? 14 : 10),
      violet,
      phase: Math.random() * Math.PI * 2,
      sway: 6 + Math.random() * 18,
    };
    if (initial) {
      const adv = Math.random() * max;
      p.life = adv;
      p.x += p.vx * adv;
      p.y += p.vy * adv;
    }
    return p;
  }

  private frame(dt: number): void {
    const g = this.ctx;
    const { w, h } = this;
    this.t += dt;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (this.opts.scenery) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(this.staticLayer, 0, 0);
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      // flickering hearth glow
      const flick = 0.75 + Math.sin(this.t * 2.3) * 0.08 + Math.sin(this.t * 7.1) * 0.05 + Math.sin(this.t * 13.7) * 0.03;
      const gg = g.createRadialGradient(w * 0.5, h * 1.05, 0, w * 0.5, h * 1.05, h * 0.55);
      gg.addColorStop(0, `rgba(255,150,60,${0.32 * flick})`);
      gg.addColorStop(0.5, `rgba(200,80,30,${0.12 * flick})`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gg;
      g.fillRect(0, 0, w, h);
    }

    const budget = this.budget();
    while (this.particles.length < budget) this.particles.push(this.spawn(false));
    if (this.particles.length > budget) this.particles.length = budget;

    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max || p.y < -40 || p.y > h + 40 || p.x < -60 || p.x > w + 60) {
        this.particles[i] = this.spawn(false);
        continue;
      }
      p.x += (p.vx + Math.sin(this.t * 1.3 + p.phase) * p.sway * 0.4) * dt;
      p.y += p.vy * dt;
      if (!p.violet) p.vy *= 1 - 0.06 * dt;
      const k = p.life / p.max;
      const fade = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      const twinkle = 0.65 + 0.35 * Math.sin(this.t * 9 + p.phase * 3);
      g.globalAlpha = Math.max(0, fade * twinkle * (p.violet ? 0.55 : 0.9));
      const sz = p.size * (p.violet ? 1 : 1 - k * 0.5);
      const sprite = p.violet ? this.violetSprite : this.opts.mode === 'defeat' ? this.ashSprite : this.emberSprite;
      g.drawImage(sprite, p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}
