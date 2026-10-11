/**
 * sim-core test fixtures: a hand-built flat GeneratedMap, a default BattleSetup and small helpers.
 */
import { PLAYER_BUILDING_IDS, PLAYER_UNIT_IDS } from '../../src/data/ids';
import { createWorld, stepWorld } from '../../src/sim/world';
import { spawnUnit } from '../../src/sim/entities';
import type {
  BattleSetup,
  Effect,
  GeneratedMap,
  MapAnchors,
  Owner,
  ResourceSpawn,
  Unit,
  UnitId,
  World,
} from '../../src/sim/types';
import { TICK_RATE, Terrain } from '../../src/sim/types';

export interface MapOpts {
  w?: number;
  h?: number;
  /** Forest rectangle (inclusive tile bounds). */
  forest?: { x0: number; y0: number; x1: number; y1: number; amount?: number } | null;
  resources?: ResourceSpawn[];
  anchors?: Partial<MapAnchors>;
}

/**
 * 48×48 grass map. Hearth top-left (6,6) (center 8,8). A forest block east of the Hearth,
 * six Thickets 5-7 tiles from the Hearth and a home Ember Seam ~9 tiles away.
 */
export function flatMap(opts: MapOpts = {}): GeneratedMap {
  const w = opts.w ?? 48;
  const h = opts.h ?? 48;
  const n = w * h;
  const terrain = new Uint8Array(n).fill(Terrain.Grass);
  const treeAmount = new Uint16Array(n);
  const forest = opts.forest === undefined ? { x0: 20, y0: 2, x1: 27, y1: 12, amount: 120 } : opts.forest;
  if (forest) {
    for (let y = forest.y0; y <= forest.y1; y++) {
      for (let x = forest.x0; x <= forest.x1; x++) {
        terrain[y * w + x] = Terrain.Forest;
        treeAmount[y * w + x] = forest.amount ?? 120;
      }
    }
  }
  const resources: ResourceSpawn[] = opts.resources ?? [
    { type: 'thicket', tx: 13, ty: 7, amount: 150 },
    { type: 'thicket', tx: 13, ty: 9, amount: 150 },
    { type: 'thicket', tx: 14, ty: 11, amount: 150 },
    { type: 'thicket', tx: 12, ty: 13, amount: 150 },
    { type: 'thicket', tx: 10, ty: 14, amount: 150 },
    { type: 'thicket', tx: 8, ty: 14, amount: 150 },
    { type: 'ember_seam', tx: 4, ty: 16, amount: 800, home: true },
  ];
  const anchors: MapAnchors = {
    hearth: { tx: 6, ty: 6 },
    nests: [],
    nestSpires: [],
    pickets: [],
    resources,
    caches: [],
    beacons: [],
    vanguard: {
      muster_hall: { tx: 14, ty: 17 },
      bowyard: { tx: 14, ty: 17 },
      storehouse: { tx: 17, ty: 5 },
      grainplot: { tx: 2, ty: 11 },
    },
    watchtowers: [],
    musterPoints: [],
    ...opts.anchors,
  };
  return {
    map: { w, h, biome: 'greenmarch', terrain, treeAmount, variant: new Uint8Array(n) },
    anchors,
    seed: 1,
    attempts: 1,
    usedFallback: false,
  };
}

export function baseSetup(over: Partial<BattleSetup> = {}): BattleSetup {
  return {
    seed: 1,
    nodeId: 'test',
    objective: 'raze',
    biome: 'greenmarch',
    depth: 1,
    isElite: false,
    isBoss: false,
    modifiers: [],
    doctrine: 'swarm',
    tier: 0,
    house: 'ardent',
    vanguard: 'muster_hall',
    unlockedUnits: [...PLAYER_UNIT_IDS],
    unlockedBuildings: [...PLAYER_BUILDING_IDS],
    playerEffects: [],
    enemyEffects: [],
    boons: [],
    metaUnlocks: [],
    retinue: [],
    sellswords: [],
    wardenHpPct: 1,
    resolve: 3,
    waveMult: 1,
    coldWatchfire: false,
    showHints: false,
    bonusRes: {},
    ...over,
  };
}

/** createWorld with skipEncounter and the Kindle countdown already elapsed. */
export function makeWorld(over: Partial<BattleSetup> = {}, mapOpts: MapOpts = {}): World {
  const w = createWorld(baseSetup(over), flatMap(mapOpts), { skipEncounter: true });
  w.countdown = 0;
  return w;
}

export function effects(...lists: Effect[][]): Effect[] {
  return lists.flat();
}

/** Advance the simulation by `seconds` of game time. */
export function step(world: World, seconds: number): void {
  const n = Math.round(seconds * TICK_RATE);
  for (let i = 0; i < n; i++) stepWorld(world);
}

/** Step until `cond` holds or `maxSeconds` pass; returns seconds elapsed (Infinity if never). */
export function stepUntil(world: World, cond: () => boolean, maxSeconds: number): number {
  const n = Math.round(maxSeconds * TICK_RATE);
  for (let i = 0; i < n; i++) {
    if (cond()) return i / TICK_RATE;
    stepWorld(world);
  }
  return cond() ? maxSeconds : Infinity;
}

/** Remove every unit (test arenas). Pop is reset. */
export function clearUnits(world: World): void {
  for (const u of world.units) {
    u.alive = false;
    world.entities.delete(u.id);
  }
  world.units = [];
  world.wardenId = 0;
  world.players[0].pop = 0;
}

export function spawnGroup(world: World, type: UnitId, owner: Owner, n: number, cx: number, cy: number, spacing = 0.8): Unit[] {
  const cols = Math.ceil(Math.sqrt(n));
  const out: Unit[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    out.push(spawnUnit(world, type, owner, cx + (c - (cols - 1) / 2) * spacing, cy + (r - (Math.ceil(n / cols) - 1) / 2) * spacing));
  }
  return out;
}

export function units(world: World, owner: Owner, type?: UnitId): Unit[] {
  return world.units.filter((u) => u.alive && u.owner === owner && (!type || u.type === type));
}

/** Deterministic hash of the gameplay state (positions, HP, orders, resources). */
export function stateHash(world: World): string {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    const s = Number.isFinite(v) ? Math.round(v * 1000) : -1;
    h ^= s & 0xffff;
    h = Math.imul(h, 0x01000193);
    h ^= (s >>> 16) & 0xffff;
    h = Math.imul(h, 0x01000193);
  };
  mix(world.tick);
  for (const u of world.units) {
    mix(u.id);
    mix(u.x);
    mix(u.y);
    mix(u.hp);
    mix(u.order.type.length);
    mix(u.carry?.amount ?? 0);
  }
  for (const b of world.buildings) {
    mix(b.id);
    mix(b.hp);
    mix(b.buildProgress);
    mix(b.queue.length);
  }
  for (const r of world.resources) mix(r.amount);
  const p = world.players[0];
  mix(p.res.grain);
  mix(p.res.timber);
  mix(p.res.ember);
  return (h >>> 0).toString(16);
}
