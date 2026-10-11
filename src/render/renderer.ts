/**
 * Canvas2D battle renderer. OWNER: render.
 *
 * Frame order: terrain surface (ground + trees/rocks) → water shimmer → Blight → live gathered trees → ground fx
 * (decals, rings, command markers) → selection rings / rally lines → y-sorted entities (shadows, corpses,
 * resources, buildings, ghosts, units) → projectiles → air fx (particles, shockwaves, telegraphs) → fog →
 * dusk tint → HP bars, placement ghost, targeting → screen fx (popups, flashes) → box select.
 */
import type { Ctx2D } from './canvas';
import { EntityPainter } from './entityDraw';
import { BlightLayer, FogLayer, footprintVisible, GhostTracker } from './fogBlight';
import { FxSystem } from './fx';
import { Minimap } from './minimap';
import { Overlays } from './overlays';
import { drawProjectiles, ProjectileTracker } from './projectiles';
import { T } from './shapes';
import { SpriteCache } from './sprites';
import { TerrainLayers, type ViewRect } from './terrain';
import type { Camera } from './camera';
import { BIOMES } from '../data/biomes';
import { PALETTE } from '../data/palette';
import type { BattleUIState, Renderer } from '../game/types';
import { getEncounterView } from '../sim/encounter';
import type { GameEvent, World } from '../sim/types';

export interface RenderStats {
  /** Milliseconds spent in the last render() call. */
  frameMs: number;
  /** Exponential moving average of frameMs. */
  avgMs: number;
  units: number;
  particles: number;
  sprites: number;
  /** Milliseconds spent building the terrain caches for the current world. */
  terrainMs: number;
}

const BG = '#0B0A0F';

export class CanvasRenderer implements Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: Ctx2D;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private world: World | null = null;
  private terrain: TerrainLayers | null = null;
  private blight: BlightLayer | null = null;
  private fog: FogLayer | null = null;
  private readonly ghosts = new GhostTracker();
  readonly sprites = new SpriteCache();
  readonly fx: FxSystem;
  private readonly painter: EntityPainter;
  private readonly overlays: Overlays;
  private readonly minimap = new Minimap();
  private readonly projectiles = new ProjectileTracker();
  private clock = 0;
  private encAt = -10;
  private dusk = 0;
  private revealed: Set<number> = new Set();
  private readonly liveScratch = new Set<number>();
  private destroyed = false;
  readonly stats: RenderStats = { frameMs: 0, avgMs: 0, units: 0, particles: 0, sprites: 0, terrainMs: 0 };
  /** Dev: per-stage timings (ms) of the last frame when `profile` is on. */
  profile = false;
  readonly stages: Record<string, number> = {};
  private mark(name: string, t: number): number {
    const now = performance.now();
    if (this.profile) this.stages[name] = (this.stages[name] ?? 0) * 0.9 + (now - t) * 0.1;
    return now;
  }
  /** Dev/gallery override for the dusk tint strength (null = use the encounter view). */
  debugDusk: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.fx = new FxSystem(
      this.sprites,
      () => this.terrain,
      (id) => this.painter.snapshots.get(id),
      (x, y) => this.tileVisible(x, y),
    );
    this.painter = new EntityPainter(this.sprites, this.fx);
    this.overlays = new Overlays(this.sprites);
    this.cssW = canvas.clientWidth || canvas.width;
    this.cssH = canvas.clientHeight || canvas.height;
  }

  // -------------------------------------------------------------------------
  // Renderer interface
  // -------------------------------------------------------------------------

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    const d = Math.max(0.5, Math.min(4, dpr || 1));
    const rebuildProps = this.terrain !== null && propsResFor(d) !== this.terrain.propsRes;
    this.dpr = d;
    this.canvas.width = Math.max(1, Math.round(this.cssW * d));
    this.canvas.height = Math.max(1, Math.round(this.cssH * d));
    if (rebuildProps && this.world) {
      const live = new Set(this.terrain?.liveTrees ?? []);
      this.terrain = new TerrainLayers(this.world.map, propsResFor(d));
      this.terrain.setLiveTrees(live);
    }
  }

  render(world: World, cam: Camera, ui: BattleUIState, alpha: number, frameDt: number): void {
    if (this.destroyed) return;
    const t0 = performance.now();
    if (world !== this.world) this.setupWorld(world);
    const terrain = this.terrain;
    if (!terrain) return;
    const real = Math.max(0, Math.min(0.25, Number.isFinite(frameDt) ? frameDt : 0));
    const dt = ui.paused ? 0 : real;
    this.clock += real;
    this.fx.step(dt);
    this.syncWorld(world);
    let tm = this.mark('sync', t0);

    const ctx = this.ctx;
    const dpr = this.dpr;
    const zoom = cam.zoom;
    const k = zoom * dpr;
    this.sprites.setScale(k);
    const [shx, shy] = this.fx.shakeOffset();
    // Background.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // World transform: world px → device px.
    const ox = (-cam.x * T * zoom + shx) * dpr;
    const oy = (-cam.y * T * zoom + shy) * dpr;
    ctx.setTransform(k, 0, 0, k, ox, oy);
    ctx.imageSmoothingEnabled = true;
    const vr = cam.visibleRect();
    const view: ViewRect = { x0: Math.floor(vr.x0), y0: Math.floor(vr.y0), x1: Math.ceil(vr.x1), y1: Math.ceil(vr.y1) };
    const map = world.map;
    const revealAll = !!world.debug?.revealAll;

    // Map border shadow (a stroke, not a fill: the surface covers the interior).
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 12;
    ctx.strokeRect(-6, -6, map.w * T + 12, map.h * T + 12);
    this.drawLayer(ctx, terrain.surface, terrain.propsRes, view, map.w, map.h);
    tm = this.mark('surface', tm);
    terrain.drawShimmer(ctx, this.clock, view);
    tm = this.mark('shimmer', tm);
    if (this.blight) this.blight.draw(ctx, world.blight.tiles, view, this.clock);
    tm = this.mark('blight', tm);
    const treeInitial = BIOMES[map.biome]?.treeAmount ?? 120;
    terrain.drawLiveTrees(ctx, this.fx.now, treeInitial, view);
    tm = this.mark('liveTrees', tm);
    this.fx.drawGround(ctx);
    tm = this.mark('fxGround', tm);

    // Entities (collect visible units first so rings can be drawn underneath).
    const frame = { ctx, world, now: this.clock, dt, alpha, view, revealAll };
    this.painter.collect(frame, this.ghosts.ghosts.values());
    tm = this.mark('collect', tm);
    this.overlays.drawRings(ctx, world, ui, this.painter.drawnUnits, this.painter.drawnBuildings, this.clock);
    tm = this.mark('rings', tm);
    this.painter.draw(frame);
    tm = this.mark('entities', tm);
    drawProjectiles(ctx, world, alpha, this.sprites, this.clock);
    tm = this.mark('projectiles', tm);
    this.fx.drawAir(ctx);
    tm = this.mark('fxAir', tm);

    // Fog of war.
    if (!revealAll && this.fog) this.fog.draw(ctx);
    tm = this.mark('fog', tm);

    // Dusk tint (multiply).
    if (this.dusk > 0.001) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = Math.min(1, this.dusk) * PALETTE.dusk.maxAlpha;
      ctx.fillStyle = PALETTE.dusk.color;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.setTransform(k, 0, 0, k, ox, oy);
    }

    // World-space UI.
    tm = this.mark('dusk', tm);
    this.overlays.drawBars(ctx, world, ui, this.painter.drawnUnits, this.painter.drawnBuildings);
    tm = this.mark('bars', tm);
    this.overlays.drawPlacement(ctx, world, ui, this.clock);
    this.overlays.drawTargeting(ctx, world, ui, this.clock);

    // Screen-space fx and UI.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = T * zoom;
    this.fx.drawScreen(ctx, this.cssW, this.cssH, (wx, wy) => [(wx / T - cam.x) * scale + shx, (wy / T - cam.y) * scale + shy]);
    this.overlays.drawBox(ctx, ui);
    this.mark('ui', tm);

    const ms = performance.now() - t0;
    this.stats.frameMs = ms;
    this.stats.avgMs = this.stats.avgMs === 0 ? ms : this.stats.avgMs * 0.92 + ms * 0.08;
    this.stats.units = this.painter.drawnUnits.length;
    this.stats.particles = this.fx.particles.count;
    this.stats.sprites = this.sprites.size;
  }

  handleEvents(events: GameEvent[], world: World): void {
    if (this.destroyed || events.length === 0) return;
    if (world !== this.world) this.setupWorld(world);
    this.fx.handle(events, world);
  }

  renderMinimap(canvas: HTMLCanvasElement, world: World, cam: Camera, ui: BattleUIState): void {
    if (this.destroyed) return;
    if (world !== this.world) this.setupWorld(world);
    this.syncLayers(world);
    this.minimap.render(
      canvas,
      world,
      cam,
      {
        drawFog: this.fog ? (c, x, y, w, h) => this.fog?.drawFit(c, x, y, w, h) : null,
        blight: this.blight?.canvas ?? null,
        blightAny: this.blight?.any ?? false,
      },
      this.ghosts.ghosts.values(),
      this.revealed,
      this.fx.pings,
      this.fx.now,
    );
    void ui;
  }

  destroy(): void {
    this.destroyed = true;
    this.sprites.clear();
    this.fx.reset();
    this.painter.reset();
    this.ghosts.clear();
    this.terrain = null;
    this.blight = null;
    this.fog = null;
    this.world = null;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private setupWorld(world: World): void {
    this.world = world;
    this.terrain = new TerrainLayers(world.map, propsResFor(this.dpr));
    this.stats.terrainMs = this.terrain.buildMs;
    this.blight = new BlightLayer(world.map.w, world.map.h);
    this.fog = new FogLayer(world.map.w, world.map.h);
    this.ghosts.clear();
    this.fx.reset();
    this.painter.reset();
    this.projectiles.reset();
    this.minimap.invalidate();
    this.encAt = -10;
    this.dusk = 0;
    this.revealed = new Set();
    // Felled-tree tiles queued before the first frame are already reflected in the terrain array.
    world.dirtyTiles.length = 0;
  }

  private tileVisible(x: number, y: number): boolean {
    const w = this.world;
    if (!w) return false;
    if (w.debug?.revealAll) return true;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= w.map.w || ty >= w.map.h) return false;
    return w.fog.state[ty * w.map.w + tx] === 2;
  }

  private syncLayers(world: World): void {
    this.blight?.sync(world);
    this.fog?.sync(world);
  }

  private syncWorld(world: World): void {
    const terrain = this.terrain;
    if (!terrain) return;
    // Felled trees → stumps (renderer consumes & clears world.dirtyTiles per the contract).
    if (world.dirtyTiles.length > 0) {
      for (const t of world.dirtyTiles) terrain.redrawTile(t);
      world.dirtyTiles.length = 0;
      this.minimap.invalidate();
    }
    this.syncLayers(world);
    // Remembered structures.
    const fog = world.fog.state;
    const mw = world.map.w;
    const mh = world.map.h;
    this.ghosts.update(world, (b) => footprintVisible(fog, mw, mh, b.tx, b.ty, b.w, b.h));
    this.fx.diedStructures.length = 0;
    // Trees being gathered are drawn live (shrink + shake).
    const live = this.liveScratch;
    live.clear();
    for (const u of world.units) {
      if (u.owner !== 0 || !u.alive || u.order.type !== 'gather' || u.order.target.kind !== 'tree') continue;
      const tile = u.order.target.tile;
      const ph = u.order.phase;
      if (ph === 'gathering' || (ph === undefined && Math.hypot(u.x - ((tile % mw) + 0.5), u.y - (Math.floor(tile / mw) + 0.5)) < 1.7)) live.add(tile);
    }
    terrain.setLiveTrees(live);
    // Projectile impacts (Firepot decals etc.).
    this.projectiles.sync(world, (kind, x, y) => this.fx.projectileImpact(kind, x * T, y * T));
    // Encounter view (dusk, revealed final-wave enemies) at ~4 Hz.
    if (this.clock - this.encAt > 0.25) {
      this.encAt = this.clock;
      try {
        const v = getEncounterView(world);
        this.dusk = Number.isFinite(v.dusk) ? Math.max(0, Math.min(1, v.dusk)) : 0;
        this.revealed = new Set(v.revealedEnemyIds ?? []);
      } catch {
        this.dusk = 0;
        this.revealed = new Set();
      }
    }
    if (this.debugDusk !== null) this.dusk = this.debugDusk;
  }

  /** Draw the visible part of a cached map-sized layer. */
  private drawLayer(ctx: Ctx2D, layer: HTMLCanvasElement, res: number, view: ViewRect, mw: number, mh: number): void {
    const x0 = Math.max(0, view.x0 - 1);
    const y0 = Math.max(0, view.y0 - 1);
    const x1 = Math.min(mw, view.x1 + 1);
    const y1 = Math.min(mh, view.y1 + 1);
    if (x1 <= x0 || y1 <= y0) return;
    const sx = x0 * T * res;
    const sy = y0 * T * res;
    const sw = Math.min(layer.width - sx, (x1 - x0) * T * res);
    const sh = Math.min(layer.height - sy, (y1 - y0) * T * res);
    if (sw <= 0 || sh <= 0) return;
    ctx.drawImage(layer, sx, sy, sw, sh, x0 * T, y0 * T, sw / res, sh / res);
  }
}

/** Props canvas resolution for a device pixel ratio (crisp trees at max zoom without huge memory). */
export function propsResFor(dpr: number): number {
  return dpr >= 1.5 ? 2 : 1.5;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  return new CanvasRenderer(canvas);
}
