/**
 * Transient effects driven by sim events (GDD §P juice list): command markers, impacts, counter popups,
 * drop-off floats, gather particles, building complete/collapse, Nest shockwaves, deaths, rank-ups,
 * telegraphs, fire decals, Blight recede rings, screen flashes, edge pulses and screen shake.
 *
 * Time base: `now` is the FX clock in seconds (advances with frameDt, frozen while paused).
 * Positions are world px unless noted.
 */
import type { Ctx2D } from './canvas';
import { RES_TEXT_COLOR, rgba } from './colors';
import { ParticlePool, type ParticleSpec } from './particles';
import { PopupQueue } from './popups';
import { circlePath, hash01, T, TAU } from './shapes';
import type { SpriteCache } from './sprites';
import type { TerrainLayers } from './terrain';
import { unitBodyRadius } from './unitArt';
import { ABILITIES, BLIGHT } from '../data/balance';
import { BUILDINGS } from '../data/buildings';
import { PALETTE } from '../data/palette';
import type { BuildingId, GameEvent, Owner, ProjectileKind, UnitId, World } from '../sim/types';

export interface UnitSnapshot {
  type: UnitId;
  owner: Owner;
  facing: number;
  x: number;
  y: number;
}

interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  born: number;
  life: number;
  color: string;
  width: number;
  /** Squash for ground rings (ry = r * squash). */
  squash: number;
  air: boolean;
}

type MarkerKind = 'move' | 'attackMove' | 'attack' | 'build' | 'gather' | 'rally' | 'slash';
interface Marker {
  kind: MarkerKind;
  x: number;
  y: number;
  born: number;
  life: number;
  a: number;
}

interface FireDecal {
  x: number;
  y: number;
  r: number;
  born: number;
  life: number;
}

interface Corpse {
  type: UnitId;
  owner: Owner;
  x: number;
  y: number;
  facing: number;
  born: number;
  dissolve: boolean;
  dir: number;
}

interface Collapse {
  type: BuildingId;
  owner: Owner;
  tx: number;
  ty: number;
  w: number;
  h: number;
  born: number;
}

interface Telegraph {
  shape: 'line' | 'ring';
  x: number;
  y: number;
  x2: number;
  y2: number;
  radius: number;
  width: number;
  born: number;
  duration: number;
}

interface Flash {
  color: string;
  born: number;
  life: number;
  alpha: number;
}

interface Shake {
  mag: number;
  born: number;
  dur: number;
}

export interface Ping {
  x: number;
  y: number;
  born: number;
  color: string;
}

interface UnitFx {
  flashUntil: number;
  rx: number;
  ry: number;
  recoilAt: number;
}

const DUST = '#A8916A';
const COLLAPSE_TIME = 0.7;
const TOPPLE_TIME = 1.2;
const DISSOLVE_TIME = 0.5;
const PING_LIFE = 3;

export class FxSystem {
  now = 0;
  readonly particles = new ParticlePool();
  readonly popups = new PopupQueue();
  readonly rings: Ring[] = [];
  readonly markers: Marker[] = [];
  readonly fires: FireDecal[] = [];
  readonly corpses: Corpse[] = [];
  readonly collapses: Collapse[] = [];
  readonly telegraphs: Telegraph[] = [];
  readonly flashes: Flash[] = [];
  readonly edgePulses: Flash[] = [];
  readonly shakes: Shake[] = [];
  readonly pings: Ping[] = [];
  private readonly unitFx = new Map<number, UnitFx>();
  /** Structures that died (ghost tracker forgets them). */
  readonly diedStructures: number[] = [];

  constructor(
    private readonly sprites: SpriteCache,
    private readonly terrain: () => TerrainLayers | null,
    private readonly snapshot: (id: number) => UnitSnapshot | undefined,
    private readonly tileVisible: (x: number, y: number) => boolean,
  ) {}

  reset(): void {
    this.particles.clear();
    this.popups.clear();
    for (const arr of [this.rings, this.markers, this.fires, this.corpses, this.collapses, this.telegraphs, this.flashes, this.edgePulses, this.shakes, this.pings]) arr.length = 0;
    this.unitFx.clear();
    this.diedStructures.length = 0;
  }

  // -------------------------------------------------------------------------
  // Stepping
  // -------------------------------------------------------------------------

  step(dt: number): void {
    this.now += dt;
    this.particles.step(dt);
    this.popups.step(this.now);
    const now = this.now;
    prune(this.rings, (r) => now - r.born < r.life);
    prune(this.markers, (m) => now - m.born < m.life);
    prune(this.fires, (f) => now - f.born < f.life);
    prune(this.corpses, (c) => now - c.born < (c.dissolve ? DISSOLVE_TIME : TOPPLE_TIME));
    prune(this.collapses, (c) => now - c.born < COLLAPSE_TIME);
    prune(this.telegraphs, (t) => now - t.born < t.duration + 0.3);
    prune(this.flashes, (f) => now - f.born < f.life);
    prune(this.edgePulses, (f) => now - f.born < f.life);
    prune(this.shakes, (s) => now - s.born < s.dur);
    prune(this.pings, (p) => now - p.born < PING_LIFE);
    if (this.unitFx.size > 64) for (const [id, u] of this.unitFx) if (now > u.flashUntil + 0.5 && now > u.recoilAt + 0.5) this.unitFx.delete(id);
    // Burning ground from Firepots keeps sparking.
    for (const f of this.fires) {
      if (Math.random() < dt * 10) {
        const a = Math.random() * TAU;
        const d = Math.random() * f.r;
        this.spawn({ kind: 'flame', x: f.x + Math.cos(a) * d, y: f.y + Math.sin(a) * d * 0.8, vz: 18 + Math.random() * 14, life: 0.5, size: 2.4, grow: -2.5, color: '#FF8A2E', add: true });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Unit animation state
  // -------------------------------------------------------------------------

  /** 0..1 hit-flash strength for a unit (white 60 ms). */
  flashOf(id: number): number {
    const u = this.unitFx.get(id);
    if (!u) return 0;
    const left = u.flashUntil - this.now;
    return left > 0 ? Math.min(1, left / 0.06) : 0;
  }

  /** Recoil offset in world px (2 px away from the attacker, 120 ms). */
  recoilOf(id: number): [number, number] {
    const u = this.unitFx.get(id);
    if (!u) return [0, 0];
    const age = this.now - u.recoilAt;
    if (age < 0 || age > 0.12) return [0, 0];
    const k = Math.sin((age / 0.12) * Math.PI) * 2;
    return [u.rx * k, u.ry * k];
  }

  // -------------------------------------------------------------------------
  // Spawning helpers
  // -------------------------------------------------------------------------

  spawn(s: ParticleSpec): void {
    this.particles.spawn(s);
  }

  burst(x: number, y: number, n: number, color: string, opts: Partial<ParticleSpec> & { speed?: number; up?: number } = {}): void {
    const speed = opts.speed ?? 40;
    const up = opts.up ?? 30;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.particles.spawn({
        kind: opts.kind ?? 'dot',
        x: x + (Math.random() - 0.5) * 4,
        y: y + (Math.random() - 0.5) * 4,
        z: opts.z ?? 4,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v * 0.7,
        vz: up * (0.5 + Math.random()),
        g: opts.g ?? 120,
        drag: opts.drag ?? 1.5,
        life: (opts.life ?? 0.6) * (0.7 + Math.random() * 0.6),
        size: (opts.size ?? 2) * (0.7 + Math.random() * 0.6),
        grow: opts.grow ?? 0,
        color,
        add: opts.add ?? false,
        alpha: opts.alpha ?? 1,
      });
    }
  }

  ring(x: number, y: number, r0: number, r1: number, life: number, color: string, width = 2, air = false, squash = 0.72): void {
    if (this.rings.length > 80) this.rings.shift();
    this.rings.push({ x, y, r0, r1, born: this.now, life, color, width, squash, air });
  }

  addShake(mag: number, dur: number): void {
    this.shakes.push({ mag, born: this.now, dur: Math.max(0.05, dur) });
  }

  /** Current screen-shake offset in CSS px. */
  shakeOffset(): [number, number] {
    let amp = 0;
    for (const s of this.shakes) {
      const k = 1 - (this.now - s.born) / s.dur;
      if (k > 0) amp = Math.max(amp, s.mag * k);
    }
    if (amp <= 0.01) return [0, 0];
    const a = Math.random() * TAU;
    return [Math.cos(a) * amp, Math.sin(a) * amp];
  }

  addPing(x: number, y: number, color: string): void {
    if (this.pings.length >= 8) this.pings.shift();
    this.pings.push({ x, y, born: this.now, color });
  }

  /** Projectile reached its end (spawn impact fx; Firepot leaves a fire decal). */
  projectileImpact(kind: ProjectileKind, x: number, y: number): void {
    switch (kind) {
      case 'arrow':
        this.burst(x, y, 2, '#CDB98F', { size: 1.5, speed: 25, up: 20, life: 0.35 });
        break;
      case 'fire_arrow':
        this.burst(x, y, 4, '#FF8A2E', { kind: 'spark', size: 1.6, speed: 40, up: 30, life: 0.4, add: true });
        break;
      case 'bolt':
        this.burst(x, y, 5, '#FFB347', { kind: 'spark', size: 1.8, speed: 50, up: 35, life: 0.45, add: true });
        break;
      case 'spine':
        this.burst(x, y, 3, PALETTE.enemy.thorn, { kind: 'square', size: 1.6, speed: 35, up: 25, life: 0.4 });
        break;
      case 'firepot': {
        const r = ABILITIES.firepot.radius * T;
        this.burst(x, y, 26, '#FF7A2F', { kind: 'flame', size: 3.5, speed: 90, up: 60, life: 0.6, add: true, grow: -3 });
        this.burst(x, y, 10, '#4A4440', { kind: 'smoke', size: 6, speed: 30, up: 30, g: -10, life: 1.2, grow: 8, alpha: 0.5 });
        this.ring(x, y, 4, r, 0.35, '#FFB347', 3);
        this.fires.push({ x, y, r: r * 0.85, born: this.now, life: ABILITIES.firepot.fireDecal });
        this.addShake(3, 0.2);
        const terrain = this.terrain();
        if (terrain) {
          terrain.paintGround(x - r, y - r, r * 2, r * 2, (g) => {
            const grad = g.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, 'rgba(30,20,14,0.55)');
            grad.addColorStop(0.7, 'rgba(30,20,14,0.25)');
            grad.addColorStop(1, 'rgba(30,20,14,0)');
            g.fillStyle = grad;
            g.beginPath();
            g.ellipse(x, y, r, r * 0.8, 0, 0, TAU);
            g.fill();
          });
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  handle(events: readonly GameEvent[], world: World): void {
    for (const e of events) {
      try {
        this.handleOne(e, world);
      } catch {
        // A malformed event must never break rendering.
      }
    }
  }

  private visibleAt(x: number, y: number): boolean {
    return this.tileVisible(x, y);
  }

  private handleOne(e: GameEvent, world: World): void {
    const now = this.now;
    switch (e.t) {
      case 'command': {
        const kind: MarkerKind = e.kind === 'attackMove' ? 'attackMove' : e.kind;
        let x = e.x;
        let y = e.y;
        if (e.targetId) {
          const t = world.entities.get(e.targetId);
          if (t) {
            x = t.x;
            y = t.y;
          }
        }
        if (this.markers.length > 24) this.markers.shift();
        this.markers.push({ kind, x: x * T, y: y * T, born: now, life: kind === 'rally' ? 0.9 : kind === 'build' || kind === 'gather' ? 0.7 : 0.55, a: 0 });
        break;
      }
      case 'attack': {
        if (!e.ranged && this.visibleAt(e.tx, e.ty)) {
          if (this.markers.length > 40) return;
          this.markers.push({ kind: 'slash', x: e.tx * T, y: e.ty * T - 6, born: now, life: 0.16, a: Math.atan2(e.ty - e.y, e.tx - e.x) });
        }
        break;
      }
      case 'hit': {
        const target = world.entities.get(e.targetId);
        const visible = e.targetOwner === 0 || this.visibleAt(e.x, e.y);
        if (target && target.kind === 'unit') {
          const fx = this.unitFx.get(e.targetId) ?? { flashUntil: 0, rx: 0, ry: 0, recoilAt: -10 };
          fx.flashUntil = now + 0.06;
          const atk = world.entities.get(e.attackerId);
          if (atk) {
            const dx = target.x - atk.x;
            const dy = target.y - atk.y;
            const d = Math.hypot(dx, dy) || 1;
            fx.rx = dx / d;
            fx.ry = dy / d;
            fx.recoilAt = now;
          }
          this.unitFx.set(e.targetId, fx);
        }
        if (!visible) break;
        const px = e.x * T;
        const py = e.y * T;
        const n = Math.min(5, 1 + Math.floor(e.damage / 8));
        if (e.isStructure) {
          this.burst(px, py, n + 1, DUST, { kind: 'square', size: 2, speed: 35, up: 30, life: 0.5 });
        } else if (e.targetOwner === 1) {
          this.burst(px, py, n, '#B47BD0', { kind: 'square', size: 1.8, speed: 40, up: 30, life: 0.4 });
          this.burst(px, py, 1, PALETTE.enemy.thorn, { kind: 'square', size: 1.6, speed: 30, up: 30, life: 0.35 });
        } else {
          this.burst(px, py, n, '#FFE3A6', { kind: 'spark', size: 1.6, speed: 45, up: 25, life: 0.3, add: true });
        }
        if (e.popup) this.popups.addCombat(e.attackerId, e.popup, e.mult, px, py - 14, now);
        break;
      }
      case 'death': {
        const px = e.x * T;
        const py = e.y * T;
        const visible = e.owner === 0 || this.visibleAt(e.x, e.y);
        if (e.kind === 'unit') {
          if (!visible) break;
          const snap = this.snapshot(e.id);
          const type = e.type as UnitId;
          const dissolve = e.owner !== 0;
          if (this.corpses.length > 60) this.corpses.shift();
          this.corpses.push({ type, owner: e.owner, x: px, y: py, facing: snap?.facing ?? 0, born: now, dissolve, dir: Math.random() < 0.5 ? -1 : 1 });
          if (dissolve) {
            const r = unitBodyRadius(type);
            const n = Math.min(18, 6 + Math.round(r / 3));
            for (let i = 0; i < n; i++) {
              this.spawn({ kind: 'mote', x: px + (Math.random() - 0.5) * r * 2, y: py + (Math.random() - 0.5) * r * 1.4, z: 2 + Math.random() * 8, vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 8, vz: 18 + Math.random() * 26, g: -8, drag: 1.2, life: 0.9 + Math.random() * 0.7, size: 1.4 + Math.random() * 1.6, color: Math.random() < 0.75 ? '#B06AD8' : PALETTE.enemy.thorn, add: true });
            }
          } else {
            this.burst(px, py + 4, 4, DUST, { kind: 'dust', size: 3, speed: 18, up: 8, life: 0.6, grow: 5, alpha: 0.55 });
          }
        } else {
          const type = e.type as BuildingId;
          const def = BUILDINGS[type];
          const w = e.w ?? def?.w ?? 1;
          const h = e.h ?? def?.h ?? 1;
          const tx = e.x - w / 2;
          const ty = e.y - h / 2;
          this.diedStructures.push(e.id);
          if (!visible) break;
          this.collapses.push({ type, owner: e.owner, tx, ty, w, h, born: now });
          const isNest = type === 'thorn_nest' || type === 'root_heart';
          // Dust thrown along the footprint.
          const n = Math.min(26, 8 + w * h * 2);
          for (let i = 0; i < n; i++) {
            const bx = (tx + Math.random() * w) * T;
            const by = (ty + h * (0.5 + Math.random() * 0.5)) * T;
            this.spawn({ kind: 'dust', x: bx, y: by, z: 4, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.3) * 30, vz: 15 + Math.random() * 25, g: 30, drag: 1.8, life: 0.9 + Math.random() * 0.6, size: 4 + Math.random() * 4, grow: 9, color: isNest ? '#6A4A6E' : DUST, alpha: 0.6 });
          }
          if (isNest) {
            this.ring(px, py, 6, 6.5 * T, 0.7, '#E8D2F2', 4, true, 0.75);
            this.ring(px, py, 4, 4.5 * T, 0.55, '#B06AD8', 3, true, 0.75);
            this.addShake(6, 0.4);
            for (let i = 0; i < 28; i++) {
              const a = Math.random() * TAU;
              const v = 40 + Math.random() * 80;
              this.spawn({ kind: 'mote', x: px, y: py, z: 10, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, vz: 20 + Math.random() * 40, g: 20, drag: 1.4, life: 1 + Math.random() * 0.8, size: 2 + Math.random() * 2, color: Math.random() < 0.6 ? '#B06AD8' : PALETTE.enemy.thorn, add: true });
            }
          } else {
            this.addShake(type === 'thornspire' ? 2 : 4, 0.25);
          }
          this.paintRubble(type, tx, ty, w, h, isNest);
        }
        break;
      }
      case 'built': {
        const b = world.entities.get(e.id);
        const def = BUILDINGS[e.type];
        const w = b && b.kind === 'building' ? b.w : def?.w ?? 2;
        const h = b && b.kind === 'building' ? b.h : def?.h ?? 2;
        const cx = (b ? b.x : e.x) * T;
        const cy = (b ? b.y : e.y) * T;
        const R = Math.max(w, h) * T * 0.62;
        if (e.owner !== 0 && !this.visibleAt(cx / T, cy / T)) break;
        this.ring(cx, cy + h * T * 0.2, R * 0.6, R * 1.25, 0.6, '#D8C49A', 3);
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * TAU;
          this.spawn({ kind: 'dust', x: cx + Math.cos(a) * R * 0.8, y: cy + h * T * 0.2 + Math.sin(a) * R * 0.6, z: 2, vx: Math.cos(a) * 30, vy: Math.sin(a) * 20, vz: 10, g: 20, drag: 2, life: 0.8, size: 4, grow: 7, color: '#C8B48A', alpha: 0.55 });
        }
        this.burst(cx, cy - 10, 8, '#FFE3A6', { kind: 'spark', size: 1.8, speed: 30, up: 50, g: 40, life: 0.8, add: true });
        break;
      }
      case 'placed': {
        const b = world.entities.get(e.id);
        if (b && e.owner === 0) this.burst(b.x * T, b.y * T + 6, 6, DUST, { kind: 'dust', size: 3, speed: 25, up: 10, life: 0.6, grow: 6, alpha: 0.5 });
        break;
      }
      case 'trained': {
        this.burst(e.x * T, e.y * T + 4, 5, '#E8D9B0', { kind: 'dust', size: 2.5, speed: 22, up: 10, life: 0.5, grow: 5, alpha: 0.6 });
        this.ring(e.x * T, e.y * T + 3, 3, 14, 0.35, PALETTE.player.selection, 1.5);
        break;
      }
      case 'spawn': {
        if (e.owner === 1 && this.visibleAt(e.x, e.y)) this.burst(e.x * T, e.y * T + 3, 5, '#8A4AB0', { kind: 'dust', size: 2.5, speed: 20, up: 12, life: 0.5, grow: 5, alpha: 0.6 });
        break;
      }
      case 'dropoff': {
        if (e.amount > 0) this.popups.addFloat(`+${Math.round(e.amount)}`, e.x * T, e.y * T - 16, RES_TEXT_COLOR[e.res], now);
        break;
      }
      case 'gather': {
        const px = e.x * T;
        const py = e.y * T;
        if (e.source === 'tree') {
          let tile = -1;
          const u = world.entities.get(e.unitId);
          if (u && u.kind === 'unit' && u.order.type === 'gather' && u.order.target.kind === 'tree') tile = u.order.target.tile;
          let cx = px;
          let cy = py;
          if (tile >= 0) {
            cx = ((tile % world.map.w) + 0.5) * T;
            cy = (Math.floor(tile / world.map.w) + 0.5) * T;
            this.terrain()?.shakeAt.set(tile, now);
          }
          const mx = (px + cx) / 2;
          const my = (py + cy) / 2;
          this.burst(mx, my, 3, '#C99560', { kind: 'chip', size: 2, speed: 45, up: 40, life: 0.5 });
          if (Math.random() < 0.4) this.burst(cx, cy - 8, 1, '#5E8C3A', { kind: 'leaf', size: 2.2, speed: 15, up: 10, g: 10, life: 1.2 });
        } else if (e.source === 'ember_seam') {
          this.burst(px, py - 2, 4, '#FF8A3D', { kind: 'spark', size: 1.6, speed: 50, up: 45, life: 0.45, add: true });
        } else {
          this.burst(px, py - 2, 3, PALETTE.resource.grain, { kind: 'mote', size: 1.6, speed: 18, up: 28, g: 20, life: 0.8, add: true, alpha: 0.85 });
        }
        break;
      }
      case 'treeFelled': {
        const cx = ((e.tile % world.map.w) + 0.5) * T;
        const cy = (Math.floor(e.tile / world.map.w) + 0.5) * T;
        this.burst(cx, cy, 8, '#C99560', { kind: 'chip', size: 2.2, speed: 55, up: 45, life: 0.6 });
        this.burst(cx, cy - 8, 6, '#5E8C3A', { kind: 'leaf', size: 2.4, speed: 30, up: 25, g: 12, life: 1.4 });
        break;
      }
      case 'rankUp': {
        const px = e.x * T;
        const py = e.y * T;
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * TAU;
          this.spawn({ kind: 'spark', x: px, y: py, z: 12, vx: Math.cos(a) * 45, vy: Math.sin(a) * 30, vz: 30, g: 60, drag: 2, life: 0.8, size: 2, color: i % 2 ? '#FFD27A' : '#FFF4D0', add: true });
        }
        this.ring(px, py, 4, 20, 0.45, '#FFD27A', 2);
        const numeral = ['', 'I', 'II', 'III'][e.rank] ?? '';
        this.popups.addFloat(`Rank ${numeral}`, px, py - 22, '#FFD27A', now, 12, 1.4);
        break;
      }
      case 'alert': {
        if (e.x !== undefined && e.y !== undefined) {
          const danger = e.kind === 'under_attack' || e.kind === 'tillers_attacked' || e.kind === 'wave_launch' || e.kind === 'raid' || e.kind === 'warden_fallen' || e.kind === 'beacon_snuffed';
          const good = e.kind === 'building_complete' || e.kind === 'nest_destroyed' || e.kind === 'beacon_lit' || e.kind === 'cache_looted' || e.kind === 'wave_broken';
          this.addPing(e.x, e.y, danger ? PALETTE.ui.danger : good ? PALETTE.ui.good : PALETTE.ui.accent);
        }
        break;
      }
      case 'ability': {
        const px = e.x * T;
        const py = e.y * T;
        const color = e.owner === 0 ? '#FFD27A' : '#B06AD8';
        if (e.radius > 0) {
          this.ring(px, py, 6, e.radius * T, 0.6, color, 3);
          this.ring(px, py, 4, e.radius * T * 0.7, 0.45, color, 2);
        }
        this.burst(px, py - 6, 10, color, { kind: 'spark', size: 2, speed: 40, up: 50, g: 40, life: 0.7, add: true });
        break;
      }
      case 'telegraph': {
        if (this.telegraphs.length > 24) this.telegraphs.shift();
        this.telegraphs.push({ shape: e.shape, x: e.x * T, y: e.y * T, x2: (e.x2 ?? e.x) * T, y2: (e.y2 ?? e.y) * T, radius: (e.radius ?? 2) * T, width: (e.width ?? 1.5) * T, born: now, duration: Math.max(0.1, e.duration) });
        break;
      }
      case 'knockback': {
        const u = world.entities.get(e.id);
        if (u) this.burst(u.x * T, u.y * T + 4, 4, DUST, { kind: 'dust', size: 3, speed: 20, up: 6, life: 0.5, grow: 6, alpha: 0.5 });
        break;
      }
      case 'heal': {
        const u = world.entities.get(e.id);
        if (u && Math.random() < 0.5) this.spawn({ kind: 'mote', x: u.x * T + (Math.random() - 0.5) * 10, y: u.y * T, z: 8, vz: 22, g: -4, life: 0.8, size: 1.8, color: '#9BF29F', add: true });
        break;
      }
      case 'waveMuster': {
        if (this.visibleAt(e.x, e.y)) this.burst(e.x * T, e.y * T, 12, '#8A4AB0', { kind: 'dust', size: 4, speed: 35, up: 15, life: 0.8, grow: 8, alpha: 0.55 });
        break;
      }
      case 'waveLaunch':
        this.edgePulses.push({ color: PALETTE.ui.danger, born: now, life: 1.3, alpha: 0.5 });
        break;
      case 'raidLaunch':
        this.edgePulses.push({ color: PALETTE.ui.danger, born: now, life: 0.9, alpha: 0.32 });
        break;
      case 'blightRecede': {
        const px = e.x * T;
        const py = e.y * T;
        const R = Math.max(1, e.radius) * T;
        // Contracting violet edge over the recede time, plus a quick cleansing wave.
        this.rings.push({ x: px, y: py, r0: R, r1: 0, born: now, life: BLIGHT.recedeTime, color: '#A04FB8', width: 3, squash: 1, air: false });
        this.ring(px, py, 8, R, 0.9, PALETTE.blight.wardEdge, 4, false, 1);
        break;
      }
      case 'bossPhase':
        this.flashes.push({ color: '#B06AD8', born: now, life: 0.5, alpha: 0.45 });
        this.addShake(8, 0.5);
        break;
      case 'lastStand': {
        this.flashes.push({ color: '#FFF1C8', born: now, life: 0.6, alpha: 0.7 });
        this.ring(e.x * T, e.y * T, 10, 7 * T, 0.8, '#FFD27A', 5, true);
        this.addShake(5, 0.35);
        break;
      }
      case 'cacheLooted': {
        const px = e.x * T;
        const py = e.y * T;
        this.burst(px, py - 6, 18, '#F2C14E', { kind: 'spark', size: 2.2, speed: 55, up: 60, g: 80, life: 0.9, add: true });
        this.ring(px, py, 4, 26, 0.5, '#F2C14E', 2);
        if (e.ember > 0) this.popups.addFloat(`+${e.ember} Ember`, px, py - 20, RES_TEXT_COLOR.ember, now, 13, 1.6);
        if (e.crowns > 0) this.popups.addFloat(`+${e.crowns} Crowns`, px, py - 6, '#F2C14E', now, 12, 1.6);
        break;
      }
      case 'beacon': {
        const b = world.entities.get(e.id);
        if (!b) break;
        const px = b.x * T;
        const py = b.y * T;
        if (e.lit) {
          this.burst(px, py - 6, 20, '#FF9A2E', { kind: 'flame', size: 3, speed: 40, up: 70, g: 20, life: 0.8, add: true, grow: -2 });
          this.ring(px, py, 6, 3 * T, 0.6, '#FFB347', 3);
        } else {
          this.burst(px, py - 6, 10, '#5A5560', { kind: 'smoke', size: 5, speed: 15, up: 25, g: -10, life: 1.2, grow: 8, alpha: 0.5 });
        }
        break;
      }
      case 'shake':
        this.addShake(Math.min(14, e.magnitude), e.duration);
        break;
      default:
        break;
    }
  }

  private paintRubble(type: BuildingId, tx: number, ty: number, w: number, h: number, thorny: boolean): void {
    const terrain = this.terrain();
    if (!terrain) return;
    const x0 = tx * T;
    const y0 = ty * T;
    const W = w * T;
    const H = h * T;
    const seed = Math.floor(tx * 131 + ty * 17);
    terrain.paintGround(x0 - 12, y0 - 12, W + 24, H + 24, (g) => {
      const cx = x0 + W / 2;
      const cy = y0 + H / 2;
      const R = Math.max(W, H) * 0.55;
      const grad = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
      grad.addColorStop(0, thorny ? 'rgba(40,20,44,0.55)' : 'rgba(40,30,22,0.45)');
      grad.addColorStop(0.7, thorny ? 'rgba(40,20,44,0.3)' : 'rgba(40,30,22,0.22)');
      grad.addColorStop(1, 'rgba(40,30,22,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(cx, cy, R, R * (H / Math.max(W, H)) * 0.95, 0, 0, TAU);
      g.fill();
      const n = Math.min(40, 6 + w * h * 3);
      for (let i = 0; i < n; i++) {
        const px = x0 + W * (0.1 + hash01(i, seed) * 0.8);
        const py = y0 + H * (0.12 + hash01(seed, i) * 0.8);
        const s = 2 + hash01(i, seed, 3) * 4;
        g.fillStyle = thorny ? (i % 3 === 0 ? '#4A2A50' : '#2E1A30') : i % 3 === 0 ? '#8C8577' : i % 3 === 1 ? '#6E4A2A' : '#5E584F';
        g.fillRect(px - s / 2, py - s / 2, s, s * 0.8);
      }
      if (thorny) {
        g.strokeStyle = '#3A2240';
        g.lineWidth = 2;
        for (let i = 0; i < 5; i++) {
          const px = x0 + W * (0.2 + hash01(i, seed, 9) * 0.6);
          const py = y0 + H * (0.2 + hash01(seed, i, 9) * 0.6);
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(px + (hash01(i, 4) - 0.5) * 18, py + (hash01(i, 5) - 0.5) * 12);
          g.stroke();
        }
      }
    });
    void type;
  }

  // -------------------------------------------------------------------------
  // Drawing (world transform active unless noted)
  // -------------------------------------------------------------------------

  /** Ground-level fx under entities: fire decals, ground rings, command markers. */
  drawGround(ctx: Ctx2D): void {
    const now = this.now;
    // Fire decals (Firepot burning ground).
    for (const f of this.fires) {
      const age = now - f.born;
      const k = Math.min(1, age / 0.2) * Math.min(1, (f.life - age) / 0.8);
      const glow = this.sprites.glow('#FF6A2B');
      ctx.globalAlpha = 0.45 * k;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glow.canvas, f.x - f.r * 1.2, f.y - f.r, f.r * 2.4, f.r * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      // Small flame tongues around the area.
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + f.born;
        const d = f.r * (0.25 + 0.55 * hash01(i, Math.floor(f.born * 10)));
        const fx = f.x + Math.cos(a) * d;
        const fy = f.y + Math.sin(a) * d * 0.75;
        const flick = 0.75 + 0.25 * Math.sin(now * 14 + i * 2.1);
        const s = 7 * k * flick;
        ctx.beginPath();
        ctx.moveTo(fx - s * 0.35, fy);
        ctx.quadraticCurveTo(fx - s * 0.3, fy - s * 0.7, fx, fy - s * 1.2);
        ctx.quadraticCurveTo(fx + s * 0.3, fy - s * 0.7, fx + s * 0.35, fy);
        ctx.closePath();
        ctx.fillStyle = i % 2 ? '#FF7A2F' : '#FFB347';
        ctx.fill();
      }
    }
    // Ground rings.
    for (const r of this.rings) {
      if (r.air) continue;
      this.drawRing(ctx, r);
    }
    // Command markers.
    for (const m of this.markers) this.drawMarker(ctx, m);
  }

  private drawRing(ctx: Ctx2D, r: Ring): void {
    const t = (this.now - r.born) / r.life;
    if (t < 0 || t > 1) return;
    const e = 1 - (1 - t) * (1 - t);
    const rad = r.r0 + (r.r1 - r.r0) * (r.r1 >= r.r0 ? e : t);
    if (rad <= 0.5) return;
    const alpha = r.r1 >= r.r0 ? 1 - t : Math.min(1, (1 - t) * 3);
    ctx.beginPath();
    ctx.ellipse(r.x, r.y, rad, rad * r.squash, 0, 0, TAU);
    ctx.strokeStyle = rgba(r.color, alpha);
    ctx.lineWidth = r.width * (r.r1 >= r.r0 ? 1 - t * 0.5 : 1);
    ctx.stroke();
  }

  private drawMarker(ctx: Ctx2D, m: Marker): void {
    const t = (this.now - m.born) / m.life;
    if (t < 0 || t > 1) return;
    const a = 1 - t;
    switch (m.kind) {
      case 'move':
      case 'attackMove': {
        const color = m.kind === 'move' ? PALETTE.player.selection : '#FF5A4A';
        for (const k of [0, 0.35]) {
          const tt = t - k;
          if (tt < 0) continue;
          const r = 3 + tt * 15;
          ctx.beginPath();
          ctx.ellipse(m.x, m.y, r, r * 0.6, 0, 0, TAU);
          ctx.strokeStyle = rgba(color, a * (1 - k));
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.ellipse(m.x, m.y, 2.5, 1.6, 0, 0, TAU);
        ctx.fillStyle = rgba(color, a);
        ctx.fill();
        break;
      }
      case 'attack': {
        const s = 8 * (1.25 - t * 0.4);
        ctx.lineCap = 'round';
        ctx.lineWidth = 4.2;
        ctx.strokeStyle = rgba('#2A0A08', a * 0.8);
        ctx.beginPath();
        ctx.moveTo(m.x - s, m.y - s * 0.7);
        ctx.lineTo(m.x + s, m.y + s * 0.7);
        ctx.moveTo(m.x + s, m.y - s * 0.7);
        ctx.lineTo(m.x - s, m.y + s * 0.7);
        ctx.stroke();
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = rgba('#FF4A3A', a);
        ctx.stroke();
        break;
      }
      case 'build':
      case 'gather': {
        // Amber hammer bouncing down.
        const bounce = Math.abs(Math.sin(t * Math.PI * 2)) * 8 * (1 - t);
        const x = m.x;
        const y = m.y - 10 - bounce;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-0.5 + Math.sin(t * Math.PI * 2) * 0.35);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#2B1D0E';
        ctx.fillRect(-1.8, -2, 3.6, 13);
        ctx.fillStyle = '#C08A4A';
        ctx.fillRect(-1, -1.5, 2, 12);
        ctx.fillStyle = '#2B1D0E';
        ctx.fillRect(-6.5, -6, 13, 6.5);
        ctx.fillStyle = PALETTE.ui.accent;
        ctx.fillRect(-5.5, -5, 11, 4.5);
        ctx.restore();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.ellipse(m.x, m.y, 4 + t * 8, (4 + t * 8) * 0.6, 0, 0, TAU);
        ctx.strokeStyle = rgba(PALETTE.ui.accent, a * 0.8);
        ctx.lineWidth = 1.6;
        ctx.stroke();
        break;
      }
      case 'rally': {
        const rise = Math.min(1, t * 4);
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#2B1D0E';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x, m.y - 18 * rise);
        ctx.stroke();
        ctx.fillStyle = PALETTE.player.body;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y - 18 * rise);
        ctx.lineTo(m.x + 11, m.y - 14 * rise);
        ctx.lineTo(m.x, m.y - 10 * rise);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.ellipse(m.x, m.y, 3 + t * 12, (3 + t * 12) * 0.6, 0, 0, TAU);
        ctx.strokeStyle = rgba(PALETTE.player.body, a);
        ctx.lineWidth = 1.8;
        ctx.stroke();
        break;
      }
      case 'slash': {
        ctx.beginPath();
        ctx.arc(m.x, m.y, 8, m.a - 1.1 + t * 0.8, m.a + 0.2 + t * 0.8);
        ctx.strokeStyle = `rgba(255,248,230,${(a * 0.85).toFixed(3)})`;
        ctx.lineWidth = 2 * a + 0.5;
        ctx.stroke();
        break;
      }
    }
  }

  /** Dying units (topple + fade, dissolve) — drawn with the entity layer. */
  drawCorpses(ctx: Ctx2D): void {
    const now = this.now;
    for (const c of this.corpses) {
      const age = now - c.born;
      const s = this.sprites.unit(c.type, c.owner, c.facing);
      if (c.dissolve) {
        const k = age / DISSOLVE_TIME;
        ctx.globalAlpha = Math.max(0, 1 - k);
        const sy = 1 - 0.45 * k;
        ctx.drawImage(s.canvas, c.x - s.ox, c.y - s.oy * sy + (1 - sy) * 8, s.w, s.h * sy);
      } else {
        const tip = Math.min(1, age / 0.35);
        const ang = c.dir * (Math.PI / 2) * (tip * tip);
        const alpha = age < 0.5 ? 1 : Math.max(0, 1 - (age - 0.5) / (TOPPLE_TIME - 0.5));
        const r = unitBodyRadius(c.type);
        ctx.save();
        ctx.translate(c.x, c.y + r);
        ctx.rotate(ang);
        ctx.globalAlpha = alpha;
        ctx.drawImage(s.canvas, -s.ox, -r - s.oy, s.w, s.h);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    for (const c of this.collapses) {
      const k = (now - c.born) / COLLAPSE_TIME;
      const s = this.sprites.building(c.type, c.owner, c.w, c.h);
      const scale = 1 - 0.3 * k;
      const W = s.w * scale;
      const H = s.h * scale;
      const bx = c.tx * T + (c.w * T) / 2;
      const by = (c.ty + c.h) * T + 6 * k;
      const jx = (Math.random() - 0.5) * 2 * (1 - k);
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.drawImage(s.canvas, bx - (s.ox + (c.w * T) / 2) * scale + jx, by - (s.oy + c.h * T) * scale, W, H);
      ctx.globalAlpha = 1;
    }
  }

  /** Air-level fx above entities: particles, air rings, telegraphs. */
  drawAir(ctx: Ctx2D): void {
    const now = this.now;
    // Telegraphs.
    for (const tg of this.telegraphs) {
      const age = now - tg.born;
      const p = Math.min(1, age / tg.duration);
      const done = age > tg.duration;
      const pulse = 0.65 + 0.35 * Math.sin(now * 18);
      if (tg.shape === 'ring') {
        const R = tg.radius;
        ctx.beginPath();
        ctx.ellipse(tg.x, tg.y, R, R * 0.8, 0, 0, TAU);
        ctx.fillStyle = done ? `rgba(255,90,60,${(0.45 * (1 - (age - tg.duration) / 0.3)).toFixed(3)})` : 'rgba(217,68,59,0.12)';
        ctx.fill();
        if (!done) {
          ctx.beginPath();
          ctx.ellipse(tg.x, tg.y, R * p, R * p * 0.8, 0, 0, TAU);
          ctx.fillStyle = 'rgba(217,68,59,0.22)';
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(tg.x, tg.y, R, R * 0.8, 0, 0, TAU);
          ctx.strokeStyle = `rgba(255,80,60,${pulse.toFixed(3)})`;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
      } else {
        const dx = tg.x2 - tg.x;
        const dy = tg.y2 - tg.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * (tg.width / 2);
        const ny = (dx / len) * (tg.width / 2);
        const band = (k: number): void => {
          ctx.beginPath();
          ctx.moveTo(tg.x + nx, tg.y + ny);
          ctx.lineTo(tg.x + dx * k + nx, tg.y + dy * k + ny);
          ctx.lineTo(tg.x + dx * k - nx, tg.y + dy * k - ny);
          ctx.lineTo(tg.x - nx, tg.y - ny);
          ctx.closePath();
        };
        // Dash lane (the Antlered Lord's Wild Hunt): a filled, pulsing band about 35% opaque with an
        // arrowhead at the far end, outlined dark-then-bright so it reads on dark Ashwood ground.
        const ux = dx / len;
        const uy = dy / len;
        const head = (): void => {
          const hw = tg.width * 0.95;
          const hl = Math.min(len * 0.45, tg.width * 1.3);
          const bx = tg.x2 - ux * hl;
          const by = tg.y2 - uy * hl;
          ctx.beginPath();
          ctx.moveTo(tg.x2 + ux * hl * 0.1, tg.y2 + uy * hl * 0.1);
          ctx.lineTo(bx - uy * hw, by + ux * hw);
          ctx.lineTo(bx + uy * hw, by - ux * hw);
          ctx.closePath();
        };
        if (done) {
          band(1);
          ctx.fillStyle = `rgba(255,90,60,${(0.55 * (1 - (age - tg.duration) / 0.3)).toFixed(3)})`;
          ctx.fill();
        } else {
          band(1);
          ctx.fillStyle = `rgba(232,62,44,${(0.22 + 0.16 * pulse).toFixed(3)})`;
          ctx.fill();
          band(p);
          ctx.fillStyle = 'rgba(255,120,70,0.3)';
          ctx.fill();
          head();
          ctx.fillStyle = `rgba(255,96,64,${(0.45 + 0.35 * pulse).toFixed(3)})`;
          ctx.fill();
          for (const [w, c] of [
            [4.5, 'rgba(30,6,4,0.55)'],
            [2.2, `rgba(255,150,110,${pulse.toFixed(3)})`],
          ] as const) {
            ctx.lineWidth = w;
            ctx.strokeStyle = c;
            band(1);
            ctx.stroke();
            head();
            ctx.stroke();
          }
        }
      }
    }
    // Air rings (shockwaves).
    for (const r of this.rings) if (r.air) this.drawRing(ctx, r);
    // Particles: normal then additive.
    const items = this.particles.items;
    for (let pass = 0; pass < 2; pass++) {
      const add = pass === 1;
      if (add) ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < items.length; i++) {
        const p = items[i];
        if (p.add !== add) continue;
        const lifeK = p.life / p.max;
        let alpha = p.alpha * (lifeK < 0.5 ? lifeK * 2 : 1);
        if (p.kind === 'smoke' || p.kind === 'dust') alpha = p.alpha * lifeK;
        if (alpha <= 0.01) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        const y = p.y - p.z;
        const s = p.size;
        if (p.kind === 'smoke' || p.kind === 'dust') {
          const puff = this.sprites.puff(p.color);
          ctx.drawImage(puff.canvas, p.x - s * 1.4, y - s * 1.4, s * 2.8, s * 2.8);
        } else if (p.kind === 'flame' || p.kind === 'mote') {
          const g = this.sprites.glow(p.color);
          ctx.drawImage(g.canvas, p.x - s * 1.8, y - s * 1.8, s * 3.6, s * 3.6);
        } else if (p.kind === 'dot') {
          ctx.beginPath();
          circlePath(ctx, p.x, y, s);
          ctx.fill();
        } else if (p.kind === 'leaf') {
          ctx.fillRect(p.x - s, y - s * 0.5, s * 2, s);
        } else {
          ctx.fillRect(p.x - s / 2, y - s / 2, s, s);
        }
      }
      ctx.globalAlpha = 1;
      if (add) ctx.globalCompositeOperation = 'source-over';
    }
  }

  /**
   * Screen-space fx (identity transform scaled by dpr): popups, flashes, edge pulses.
   * `toScreen` maps world px to CSS px.
   */
  drawScreen(ctx: Ctx2D, cssW: number, cssH: number, toScreen: (wx: number, wy: number) => [number, number]): void {
    const now = this.now;
    // Popups.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const p of this.popups.items) {
      const t = (now - p.born) / p.life;
      if (t < 0 || t > 1) continue;
      const [sx, sy0] = toScreen(p.x, p.y);
      if (sx < -40 || sy0 < -40 || sx > cssW + 40 || sy0 > cssH + 40) continue;
      const sy = sy0 - p.rise * (1 - (1 - t) * (1 - t));
      const pop = t < 0.12 ? 1 + (1 - t / 0.12) * 0.45 : 1;
      const alpha = t > 0.7 ? (1 - t) / 0.3 : 1;
      const size = Math.round(p.size * pop);
      ctx.font = `800 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(20,12,6,0.9)';
      ctx.strokeText(p.text, sx, sy);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, sx, sy);
    }
    ctx.globalAlpha = 1;
    // Wave-launch red edge pulse.
    for (const f of this.edgePulses) {
      const t = (now - f.born) / f.life;
      const a = f.alpha * Math.sin(Math.min(1, t) * Math.PI);
      if (a <= 0.01) continue;
      const g = ctx.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.35, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.72);
      g.addColorStop(0, rgba(f.color, 0));
      g.addColorStop(1, rgba(f.color, a));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cssW, cssH);
    }
    // Full-screen flashes (Last Stand, boss phase).
    for (const f of this.flashes) {
      const t = (now - f.born) / f.life;
      const a = f.alpha * (1 - t);
      if (a <= 0.01) continue;
      ctx.fillStyle = rgba(f.color, a);
      ctx.fillRect(0, 0, cssW, cssH);
    }
  }
}

function prune<X>(arr: X[], keep: (x: X) => boolean): void {
  let w = 0;
  for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[w++] = arr[i];
  arr.length = w;
}
