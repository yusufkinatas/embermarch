/**
 * DEV ONLY (gallery / perf): a hand-made World fixture that exercises every renderer feature, plus a
 * cosmetic "puppet" stepper that moves units and emits events so the scene animates. This is not the
 * simulation and is never imported by the game.
 */
import { createNoise2D } from 'simplex-noise';
import { Rng } from '../core/rng';
import { BIOMES } from '../data/biomes';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import {
  TICK_DT,
  Terrain,
  type BattleSetup,
  type BiomeId,
  type Building,
  type BuildingId,
  type DoctrineId,
  type GameEvent,
  type GameMap,
  type Owner,
  type PlayerState,
  type Projectile,
  type ProjectileKind,
  type ResourceNode,
  type ResourceNodeId,
  type Unit,
  type UnitId,
  type World,
} from '../sim/types';

export interface FixtureOptions {
  biome?: BiomeId;
  size?: number;
  seed?: number;
  /** Approximate total unit count (player + enemy). */
  units?: number;
  doctrine?: DoctrineId;
}

function playerState(owner: Owner): PlayerState {
  return {
    owner,
    res: { grain: 250, timber: 300, ember: 75 },
    pop: 0,
    popCap: 20,
    researched: [],
    temper: null,
    unlockedUnits: [],
    unlockedBuildings: [],
    effects: [],
    flags: {},
    rallyReadyTick: 0,
    rallyUntilTick: 0,
    abilityReadyTick: { Q: 0, W: 0 },
    wardenRespawnTick: -1,
    wardenDeaths: 0,
    stats: { gathered: { grain: 0, timber: 0, ember: 0 }, unitsTrained: 0, unitsLost: 0, kills: 0, buildingsBuilt: 0, buildingsLost: 0 },
    popAlertTick: 0,
  };
}

function setupFor(biome: BiomeId, seed: number, doctrine: DoctrineId): BattleSetup {
  return {
    seed,
    nodeId: 'gallery',
    objective: biome === 'heartwood' ? 'boss' : 'raze',
    biome,
    depth: 3,
    isElite: false,
    isBoss: biome === 'heartwood',
    modifiers: [],
    doctrine,
    tier: 0,
    house: 'grimbrand',
    vanguard: 'muster_hall',
    unlockedUnits: [],
    unlockedBuildings: [],
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
  };
}

/** Procedural fixture terrain (cosmetic noise, clearings around key sites). */
function makeMap(biome: BiomeId, size: number, seed: number, clear: { x: number; y: number; r: number }[]): GameMap {
  const rng = new Rng(seed);
  const n1 = createNoise2D(() => rng.next());
  const n2 = createNoise2D(() => rng.next());
  const n3 = createNoise2D(() => rng.next());
  const def = BIOMES[biome];
  const w = size;
  const h = size;
  const terrain = new Uint8Array(w * h);
  const treeAmount = new Uint16Array(w * h);
  const variant = new Uint8Array(w * h);
  const waterCut = -0.62 + def.water * 1.6;
  const forestCut = 0.62 - def.forest * 1.15;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      variant[i] = Math.floor(rng.next() * 256);
      let c = 1e9;
      for (const k of clear) c = Math.min(c, Math.hypot(x + 0.5 - k.x, y + 0.5 - k.y) - k.r);
      const wn = 0.65 * n1(x / 14, y / 14) + 0.35 * n1(x / 6, y / 6);
      const fn = 0.65 * n2(x / 14, y / 14) + 0.35 * n2(x / 6, y / 6);
      const rn = 0.6 * n3(x / 9, y / 9) + 0.4 * n3(x / 4, y / 4);
      let t: number = Terrain.Grass;
      if (c > 0) {
        if (wn < waterCut) t = Terrain.Water;
        else if (wn < waterCut + 0.09) t = Terrain.Shallows;
        else if (fn > forestCut) t = Terrain.Forest;
        else if (rn > 0.86 - def.rock * 2) t = Terrain.Rock;
      }
      terrain[i] = t;
      if (t === Terrain.Forest) treeAmount[i] = def.treeAmount;
    }
  }
  if (biome === 'heartwood') {
    // Two diagonal briar-wall bands, 3 thick, with gaps.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d1 = Math.abs(x - y - 10);
        const d2 = Math.abs(x - y + 14);
        let c = 1e9;
        for (const k of clear) c = Math.min(c, Math.hypot(x + 0.5 - k.x, y + 0.5 - k.y) - k.r);
        if ((d1 <= 1 || d2 <= 1) && c > 2 && (x + y) % 23 > 4) {
          terrain[y * w + x] = Terrain.BriarWall;
          treeAmount[y * w + x] = 0;
        }
      }
    }
  }
  return { w, h, biome, terrain, treeAmount, variant };
}

export class FixtureBuilder {
  readonly world: World;
  private nextId = 1;

  constructor(map: GameMap, setup: BattleSetup) {
    const n = map.w * map.h;
    this.world = {
      setup,
      map,
      anchors: {
        hearth: { tx: 0, ty: 0 },
        nests: [],
        nestSpires: [],
        pickets: [],
        resources: [],
        caches: [],
        beacons: [],
        vanguard: { muster_hall: { tx: 0, ty: 0 }, bowyard: { tx: 0, ty: 0 }, storehouse: { tx: 0, ty: 0 }, grainplot: { tx: 0, ty: 0 } },
        watchtowers: [],
        musterPoints: [],
      },
      tick: 0,
      time: 0,
      countdown: 0,
      rng: new Rng(setup.seed),
      nextId: 1,
      entities: new Map(),
      units: [],
      buildings: [],
      resources: [],
      projectiles: [],
      players: [playerState(0), playerState(1), playerState(2)],
      grid: { w: map.w, h: map.h, blocked: new Uint8Array(n), occupant: new Int32Array(n), speedMul: new Float32Array(n).fill(1), version: 0 },
      spatial: { cellSize: 4, cols: Math.ceil(map.w / 4), rows: Math.ceil(map.h / 4), cells: [] },
      fog: { state: new Uint8Array(n), version: 1 },
      vision: [],
      blight: { tiles: new Uint8Array(n), ward: new Uint16Array(n), version: 1 },
      encounter: { objective: setup.objective, doctrine: setup.doctrine },
      dirtyTiles: [],
      events: [],
      outcome: 'ongoing',
      lastStandsUsed: 0,
      hearthId: 0,
      wardenId: 0,
      debug: { revealAll: false, invulnerablePlayer: false },
    };
  }

  private id(): number {
    const id = this.nextId++;
    this.world.nextId = this.nextId;
    return id;
  }

  /** Clear terrain under a footprint so entities sit on grass. */
  clearRect(tx: number, ty: number, w: number, h: number): void {
    const m = this.world.map;
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      m.terrain[y * m.w + x] = Terrain.Grass;
      m.treeAmount[y * m.w + x] = 0;
    }
  }

  unit(type: UnitId, owner: Owner, x: number, y: number, extra: Partial<Unit> = {}): Unit {
    const def = UNITS[type];
    const u: Unit = {
      id: this.id(),
      owner,
      x,
      y,
      hp: def.hp,
      maxHp: def.hp,
      alive: true,
      invulnerable: false,
      untargetable: false,
      bornTick: 0,
      lastDamagedTick: -1,
      lastAttackerId: 0,
      kind: 'unit',
      type,
      cls: def.cls,
      radius: def.radius,
      prevX: x,
      prevY: y,
      facing: 0,
      vx: 0,
      vy: 0,
      speed: def.speed,
      order: { type: 'idle' },
      queue: [],
      move: null,
      moveStatus: 'none',
      blockedBy: 0,
      path: null,
      stuck: { checkX: x, checkY: y, timer: 0, repaths: 0, windowTimer: 0 },
      targetId: 0,
      attackCooldown: 0,
      lastAttackTick: -100,
      movedSinceAttack: 0,
      homeX: x,
      homeY: y,
      carry: null,
      job: null,
      kills: 0,
      rank: 0,
      burns: [],
      buffs: [],
      carried: false,
      ai: null,
      ...extra,
    };
    this.world.units.push(u);
    this.world.entities.set(u.id, u);
    if (type === 'warden' && owner === 0) this.world.wardenId = u.id;
    return u;
  }

  building(type: BuildingId, owner: Owner, tx: number, ty: number, extra: Partial<Building> = {}): Building {
    const def = BUILDINGS[type];
    this.clearRect(tx, ty, def.w, def.h);
    const b: Building = {
      id: this.id(),
      owner,
      x: tx + def.w / 2,
      y: ty + def.h / 2,
      hp: def.hp,
      maxHp: def.hp,
      alive: true,
      invulnerable: !!def.invulnerable,
      untargetable: !!def.untargetable,
      bornTick: 0,
      lastDamagedTick: -1,
      lastAttackerId: 0,
      kind: 'building',
      type,
      tx,
      ty,
      w: def.w,
      h: def.h,
      built: true,
      buildProgress: 1,
      queue: [],
      research: null,
      rally: null,
      attackCooldown: 0,
      targetId: 0,
      lastAttackTick: -100,
      gatherers: 0,
      ripeness: 0,
      nest: null,
      object: null,
      ...extra,
    };
    this.world.buildings.push(b);
    this.world.entities.set(b.id, b);
    if (type === 'hearth' && owner === 0) this.world.hearthId = b.id;
    const g = this.world.grid;
    for (let y = ty; y < ty + def.h; y++) for (let x = tx; x < tx + def.w; x++) {
      g.blocked[y * g.w + x] = 1;
      g.occupant[y * g.w + x] = b.id;
    }
    return b;
  }

  resource(type: ResourceNodeId, tx: number, ty: number, amount: number, initial: number): ResourceNode {
    const w = type === 'ember_seam' ? 2 : 1;
    this.clearRect(tx, ty, w, w);
    const r: ResourceNode = {
      id: this.id(),
      owner: 2,
      x: tx + w / 2,
      y: ty + w / 2,
      hp: 1,
      maxHp: 1,
      alive: true,
      invulnerable: true,
      untargetable: false,
      bornTick: 0,
      lastDamagedTick: -1,
      lastAttackerId: 0,
      kind: 'resource',
      type,
      resType: type === 'thicket' ? 'grain' : 'ember',
      tx,
      ty,
      w,
      h: w,
      amount,
      initial,
      gatherers: 0,
      maxGatherers: type === 'thicket' ? 2 : 6,
      contested: false,
    };
    this.world.resources.push(r);
    this.world.entities.set(r.id, r);
    return r;
  }

  projectile(kind: ProjectileKind, owner: Owner, from: { x: number; y: number }, to: { x: number; y: number }, targetId: number, progress: number): Projectile {
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;
    const p: Projectile = {
      id: this.id(),
      kind,
      sourceId: 0,
      owner,
      x,
      y,
      prevX: x,
      prevY: y,
      startX: from.x,
      startY: from.y,
      targetId,
      tx: to.x,
      ty: to.y,
      speed: kind === 'bolt' ? 14 : kind === 'spine' ? 10 : kind === 'firepot' ? 7 : 12,
      packet: { raw: 5, mult: 1, attackKind: 'ranged' },
      alive: true,
    };
    this.world.projectiles.push(p);
    return p;
  }

  /** Mark Blight tiles in a radius around a point (only walkable tiles). */
  blight(cx: number, cy: number, r: number): void {
    const { map, blight } = this.world;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
      const t = map.terrain[y * map.w + x];
      if (t === Terrain.Grass || t === Terrain.Shallows || t === Terrain.Stump) blight.tiles[y * map.w + x] = 1;
    }
    blight.version++;
  }
}

/** Recompute fog from player sight (cosmetic approximation of the nav fog). Returns true on change. */
export function recomputeFog(world: World, exploredBase?: Uint8Array): boolean {
  const { map, fog } = world;
  const next = new Uint8Array(map.w * map.h);
  for (let i = 0; i < next.length; i++) next[i] = fog.state[i] === 0 ? 0 : 1;
  if (exploredBase) for (let i = 0; i < next.length; i++) if (exploredBase[i]) next[i] = Math.max(next[i], 1);
  const stamp = (cx: number, cy: number, r: number): void => {
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(map.h - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(map.w - 1, Math.ceil(cx + r)); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) next[y * map.w + x] = 2;
      }
    }
  };
  for (const u of world.units) if (u.alive && u.owner === 0) stamp(u.x, u.y, UNITS[u.type].sight);
  for (const b of world.buildings) if (b.alive && b.owner === 0) stamp(b.x, b.y, BUILDINGS[b.type].sight + Math.max(b.w, b.h) / 2);
  let changed = false;
  for (let i = 0; i < next.length; i++) if (next[i] !== fog.state[i]) {
    changed = true;
    break;
  }
  if (changed) {
    fog.state.set(next);
    fog.version++;
  }
  return changed;
}

export interface Scene {
  world: World;
  /** Camera focus (tiles). */
  focus: { x: number; y: number };
  puppet: Puppet;
}

/**
 * The sample battle: Hearth base in the south-west, a clash mid-map, two Nests (one Spent, one remembered
 * as a ghost), Blight, resources, a cache, beacons, construction, projectiles in flight.
 */
export function buildBattleScene(opts: FixtureOptions = {}): Scene {
  const biome = opts.biome ?? 'greenmarch';
  const size = opts.size ?? 64;
  const seed = opts.seed ?? 7;
  const doctrine = opts.doctrine ?? 'hunt';
  const hearth = { tx: 7, ty: size - 15 };
  const nestA = { tx: size - 18, ty: 9 };
  const nestB = { tx: size - 12, ty: Math.floor(size * 0.5) };
  const clash = { x: size * 0.45, y: size * 0.55 };
  const clear = [
    { x: hearth.tx + 2, y: hearth.ty + 2, r: 11 },
    { x: nestA.tx + 1.5, y: nestA.ty + 1.5, r: 6 },
    { x: nestB.tx + 1.5, y: nestB.ty + 1.5, r: 5 },
    { x: clash.x, y: clash.y, r: 9 },
    { x: (hearth.tx + clash.x) / 2, y: (hearth.ty + clash.y) / 2, r: 4 },
    { x: (nestA.tx + clash.x) / 2, y: (nestA.ty + clash.y) / 2, r: 4 },
  ];
  const map = makeMap(biome, size, seed, clear);
  const fb = new FixtureBuilder(map, setupFor(biome, seed, doctrine));
  const w = fb.world;
  const rnd = new Rng(seed + 99);
  const R = (a: number, b: number): number => rnd.range(a, b);

  // --- Player base.
  const H = fb.building('hearth', 0, hearth.tx, hearth.ty);
  fb.building('cottage', 0, hearth.tx - 3, hearth.ty - 3);
  fb.building('cottage', 0, hearth.tx + 5, hearth.ty + 4);
  fb.building('storehouse', 0, hearth.tx + 9, hearth.ty - 6, { hp: 260 });
  fb.building('grainplot', 0, hearth.tx - 3, hearth.ty + 2, { ripeness: 0.35, gatherers: 2 });
  fb.building('grainplot', 0, hearth.tx - 3, hearth.ty + 5, { ripeness: 0.9 });
  const mh = fb.building('muster_hall', 0, hearth.tx + 6, hearth.ty - 1, { rally: { x: hearth.tx + 13, y: hearth.ty - 4 } });
  fb.building('bowyard', 0, hearth.tx + 1, hearth.ty - 5);
  fb.building('paddock', 0, hearth.tx + 10, hearth.ty + 2, { hp: 380 });
  fb.building('forgehall', 0, hearth.tx - 4, hearth.ty - 8);
  w.players[0].temper = 'ember_edge';
  fb.building('brazier_tower', 0, hearth.tx + 14, hearth.ty - 10);
  fb.building('siegeyard', 0, hearth.tx + 2, hearth.ty - 9, { built: false, buildProgress: 0.55, hp: 500 });
  fb.building('cottage', 0, hearth.tx + 13, hearth.ty + 6, { built: false, buildProgress: 0.15, hp: 60 });
  // --- Resources.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const tx = Math.round(hearth.tx + 2 + Math.cos(a) * 5.5) - (i === 2 ? 1 : 0);
    const ty = Math.round(hearth.ty + 2 + Math.sin(a) * 5.5);
    if (map.terrain[ty * map.w + tx] === Terrain.Grass && !w.grid.blocked[ty * map.w + tx]) fb.resource('thicket', tx, ty, [150, 120, 80, 40, 15, 150][i], 150);
  }
  fb.resource('thicket', hearth.tx + 15, hearth.ty - 2, 90, 150);
  fb.resource('thicket', hearth.tx + 16, hearth.ty - 1, 150, 150);
  const seamHome = fb.resource('ember_seam', hearth.tx + 16, hearth.ty + 2, 620, 800);
  const seamContested = fb.resource('ember_seam', Math.floor(clash.x + 6), Math.floor(clash.y - 10), 1000, 1000);
  fb.resource('ember_seam', nestB.tx - 5, nestB.ty + 6, 40, 1000);
  // --- Enemy structures.
  const nest1 = fb.building('thorn_nest', 1, nestA.tx, nestA.ty, {
    hp: 700,
    maxHp: 1000,
    nest: { index: 0, spent: false, spentUntil: -1, blightRadius: 8, seen: true, musterProgress: 0.6 },
  });
  fb.building('thornspire', 1, nestA.tx - 3, nestA.ty + 4);
  const nest2 = fb.building('thorn_nest', 1, nestB.tx, nestB.ty, {
    hp: 420,
    maxHp: 1000,
    nest: { index: 1, spent: true, spentUntil: 9999, blightRadius: 6, seen: true, musterProgress: 0 },
  });
  fb.building('thornspire', 1, nestB.tx + 4, nestB.ty - 2);
  fb.blight(nestA.tx + 1.5, nestA.ty + 1.5, 8);
  fb.blight(nestB.tx + 1.5, nestB.ty + 1.5, 6);
  // --- Neutral objects.
  fb.building('ruined_cache', 2, Math.floor(clash.x - 9), Math.floor(clash.y + 9), { object: { kind: 'cache', done: false, progress: 0, lit: false } });
  fb.building('ancient_cache', 2, Math.floor(clash.x + 3), Math.floor(clash.y + 12), { object: { kind: 'cache', done: true, progress: 0, lit: false } });
  fb.building('beacon_stone', 2, Math.floor(clash.x - 2), Math.floor(clash.y - 12), { object: { kind: 'beacon', done: true, progress: 1, lit: true } });
  fb.building('beacon_stone', 2, hearth.tx + 20, hearth.ty - 14, { object: { kind: 'beacon', done: false, progress: 0.55, lit: false } });

  // --- Units.
  const total = opts.units ?? 140;
  const playerShare = Math.round(total * 0.48);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd.next() * arr.length)];
  const warden = fb.unit('warden', 0, clash.x - 3, clash.y + 1, { facing: 0, buffs: [{ id: 'rallying_horn', until: 1e9 }] });
  warden.hp = 260;
  // Tillers at work.
  const tillers: Unit[] = [];
  const nTill = Math.min(20, Math.round(playerShare * 0.3));
  for (let i = 0; i < nTill; i++) {
    const job = i % 4;
    let x = hearth.tx + 2 + R(-4, 6);
    let y = hearth.ty + 2 + R(-6, 4);
    const u = fb.unit('tiller', 0, x, y, { facing: R(0, Math.PI * 2) });
    if (job === 0) u.carry = { type: 'grain', amount: 10 };
    else if (job === 1) u.carry = { type: 'timber', amount: 10 };
    else if (job === 2) u.carry = { type: 'ember', amount: 10 };
    tillers.push(u);
    void x;
    void y;
  }
  // Some Tillers chopping the nearest forest tiles.
  const forestNear: number[] = [];
  for (let y = hearth.ty - 12; y < hearth.ty + 10; y++) for (let x = hearth.tx - 8; x < hearth.tx + 22; x++) {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
    const i = y * map.w + x;
    if (map.terrain[i] !== Terrain.Forest) continue;
    const nb = [i - 1, i + 1, i - map.w, i + map.w];
    if (nb.some((j) => j >= 0 && j < map.w * map.h && map.terrain[j] === Terrain.Grass && !w.grid.blocked[j])) forestNear.push(i);
  }
  for (let k = 0; k < Math.min(4, forestNear.length, tillers.length); k++) {
    const tile = forestNear[Math.floor((k * forestNear.length) / 4)];
    const tx = tile % map.w;
    const ty = Math.floor(tile / map.w);
    const nb = [
      [tx - 1, ty],
      [tx + 1, ty],
      [tx, ty - 1],
      [tx, ty + 1],
    ].find(([x, y]) => map.terrain[y * map.w + x] === Terrain.Grass);
    if (!nb) continue;
    const u = tillers[k];
    u.x = u.prevX = nb[0] + 0.5;
    u.y = u.prevY = nb[1] + 0.5;
    u.facing = Math.atan2(ty - nb[1], tx - nb[0]);
    u.carry = { type: 'timber', amount: 4 };
    u.order = { type: 'gather', target: { kind: 'tree', tile }, phase: 'gathering' };
    map.treeAmount[tile] = 40 + k * 20;
  }
  // Ember Tillers at the home seam.
  for (let k = 0; k < 3 && 4 + k < tillers.length; k++) {
    const u = tillers[4 + k];
    u.x = u.prevX = seamHome.tx - 0.5 + k * 1.2;
    u.y = u.prevY = seamHome.ty + 2.6;
    u.facing = -Math.PI / 2;
    u.carry = { type: 'ember', amount: 6 };
    u.order = { type: 'gather', target: { kind: 'node', id: seamHome.id }, phase: 'gathering' };
  }
  void seamContested;
  // Player army (mid-map, facing north-east).
  const army: UnitId[] = ['ashpike', 'ashpike', 'ashpike', 'bowman', 'bowman', 'courser', 'oathshield', 'brandbow', 'destrier', 'gatebreaker', 'outrider', 'lampbearer'];
  const nArmy = playerShare - nTill - 1;
  for (let i = 0; i < nArmy; i++) {
    const type = army[i % army.length];
    const ranged = UNITS[type].range >= 1.5;
    const x = clash.x - (ranged ? 5 : 2.5) + R(-2.5, 2.5);
    const y = clash.y + R(-4.5, 4.5) + (ranged ? 1.5 : 0);
    const u = fb.unit(type, 0, x, y, { facing: R(-0.9, 0.2) });
    u.rank = (i % 9 === 0 ? 3 : i % 5 === 0 ? 2 : i % 4 === 0 ? 1 : 0) as 0 | 1 | 2 | 3;
    if (i % 3 === 0) u.hp = Math.round(u.maxHp * R(0.25, 0.9));
    if (i % 11 === 2) u.burns = [{ applierId: 0, dps: 2, remaining: 3 }];
    if (i % 13 === 5) u.buffs = [{ id: 'rooted', until: 1e9 }];
    if (type === 'gatebreaker') {
      u.x = u.prevX = nestB.tx - 1.2 - i * 0.05;
      u.y = u.prevY = nestB.ty + 2.5;
      u.facing = 0;
    }
  }
  // Enemy wave.
  const enemyTypes: UnitId[] = ['thornling', 'thornling', 'thornling', 'briarguard', 'spinecaster', 'stagrider', 'thornhusk', 'gloamwitch', 'rootbreaker'];
  const nEnemy = total - playerShare;
  for (let i = 0; i < nEnemy; i++) {
    const type = i === 0 ? 'antlered_lord' : enemyTypes[i % enemyTypes.length];
    const ranged = UNITS[type].range >= 1.5;
    const x = clash.x + (ranged ? 5.5 : 2.5) + R(-2.5, 3);
    const y = clash.y + R(-5, 5) - (ranged ? 1.5 : 0);
    const u = fb.unit(type, 1, x, y, { facing: Math.PI + R(-0.6, 0.6) });
    if (i % 3 === 1) u.hp = Math.round(u.maxHp * R(0.2, 0.8));
    if (i % 10 === 3) u.burns = [{ applierId: 0, dps: 2, remaining: 3 }];
    if (i === 0) {
      u.x = u.prevX = clash.x + 6;
      u.y = u.prevY = clash.y - 3;
    }
  }
  // A garrison picket near the far Nest (in fog: should not be drawn).
  for (let i = 0; i < 4; i++) fb.unit(pick(['briarguard', 'spinecaster'] as UnitId[]), 1, nestA.tx + 1 + R(-2, 3), nestA.ty + 4 + R(0, 2), { facing: Math.PI / 2 });

  // --- Projectiles in flight across the clash.
  const players = w.units.filter((u) => u.owner === 0 && u.cls !== 'worker');
  const enemies = w.units.filter((u) => u.owner === 1);
  for (let i = 0; i < 14; i++) {
    const a = pick(players);
    const b = pick(enemies);
    fb.projectile(i % 4 === 0 ? 'fire_arrow' : 'arrow', 0, a, b, b.id, R(0.1, 0.9));
    const c = pick(enemies);
    const d = pick(players);
    if (i % 2 === 0) fb.projectile('spine', 1, c, d, d.id, R(0.1, 0.9));
  }
  const tower = w.buildings.find((b) => b.type === 'brazier_tower');
  if (tower) fb.projectile('bolt', 0, tower, { x: tower.x + 5, y: tower.y + 3 }, 0, 0.5);
  fb.projectile('bolt', 0, H, { x: H.x + 6, y: H.y - 2 }, 0, 0.35);
  fb.projectile('firepot', 0, warden, { x: clash.x + 4, y: clash.y + 1 }, 0, 0.45);

  // --- Fog: explored south-west half + the area around the Spent Nest (remembered), visible from sight.
  const base = new Uint8Array(map.w * map.h);
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (x + (map.h - y) < map.w * 1.05) base[y * map.w + x] = 1;
    if (Math.hypot(x - nestB.tx, y - nestB.ty) < 8) base[y * map.w + x] = 1;
  }
  recomputeFog(w, base);
  void nest1;
  void nest2;
  void mh;
  const puppet = new Puppet(w, base, clash);
  return { world: w, focus: { x: clash.x - 4, y: clash.y + 2 }, puppet };
}

/**
 * Cosmetic animator for the fixture: wanders units around their posts, swings attacks, flies projectiles,
 * and emits a stream of representative GameEvents (hits with counter popups, drop-offs, gathering,
 * deaths and replacements, commands, felled trees, building completion).
 */
export class Puppet {
  private rng = new Rng(4242);
  private posts = new Map<number, { x: number; y: number }>();
  private eventTimer = 0;
  private fogTimer = 0;
  tickAcc = 0;

  constructor(
    private readonly world: World,
    private readonly exploredBase: Uint8Array,
    private readonly clash: { x: number; y: number },
  ) {
    for (const u of world.units) this.posts.set(u.id, { x: u.x, y: u.y });
  }

  /** Advance by real seconds; returns the events produced (also left in world.events). */
  advance(dt: number): GameEvent[] {
    const out: GameEvent[] = [];
    this.tickAcc += dt;
    while (this.tickAcc >= TICK_DT) {
      this.tickAcc -= TICK_DT;
      this.tick(out);
    }
    return out;
  }

  /** Interpolation alpha for rendering. */
  get alpha(): number {
    return this.tickAcc / TICK_DT;
  }

  private tick(out: GameEvent[]): void {
    const w = this.world;
    const rng = this.rng;
    w.tick++;
    w.time += TICK_DT;
    for (const u of w.units) {
      u.prevX = u.x;
      u.prevY = u.y;
    }
    for (const p of w.projectiles) {
      p.prevX = p.x;
      p.prevY = p.y;
    }
    // Units drift around their posts, facing their movement; fighters face the enemy and swing.
    for (const u of w.units) {
      if (!u.alive) continue;
      const post = this.posts.get(u.id);
      if (!post) continue;
      const working = u.order.type === 'gather';
      const fighting = u.cls !== 'worker' && Math.abs(u.x - this.clash.x) < 9 && Math.abs(u.y - this.clash.y) < 8;
      if (!working) {
        const t = w.tick * TICK_DT;
        const gx = post.x + Math.sin(t * 0.35 + u.id) * (u.cls === 'worker' ? 3 : 0.9);
        const gy = post.y + Math.cos(t * 0.3 + u.id * 1.7) * (u.cls === 'worker' ? 2.2 : 0.7);
        const dx = gx - u.x;
        const dy = gy - u.y;
        const d = Math.hypot(dx, dy);
        const sp = Math.min(u.speed * 0.45, d / TICK_DT) * TICK_DT;
        if (d > 0.05) {
          u.x += (dx / d) * sp;
          u.y += (dy / d) * sp;
          u.vx = (dx / d) * (sp / TICK_DT);
          u.vy = (dy / d) * (sp / TICK_DT);
          if (!fighting) u.facing = Math.atan2(dy, dx);
        } else {
          u.vx = 0;
          u.vy = 0;
        }
      }
      if (fighting) {
        u.facing = u.owner === 0 ? -0.35 + Math.sin(u.id) * 0.3 : Math.PI - 0.35 + Math.sin(u.id) * 0.3;
        if (rng.next() < 0.025) {
          u.lastAttackTick = w.tick;
          if (rng.next() < 0.35) out.push({ t: 'attack', attackerId: u.id, targetId: 0, x: u.x, y: u.y, tx: u.x + Math.cos(u.facing) * 0.8, ty: u.y + Math.sin(u.facing) * 0.8, ranged: UNITS[u.type].range >= 1.5 });
        }
      } else if (working && rng.next() < 0.03) {
        u.lastAttackTick = w.tick;
        const target = u.order.type === 'gather' ? u.order.target : null;
        out.push({ t: 'gather', unitId: u.id, res: target?.kind === 'tree' ? 'timber' : 'ember', source: target?.kind === 'tree' ? 'tree' : 'ember_seam', x: u.x, y: u.y });
        if (target?.kind === 'tree') {
          const m = w.map;
          m.treeAmount[target.tile] = Math.max(0, m.treeAmount[target.tile] - 2);
          if (m.treeAmount[target.tile] === 0 && m.terrain[target.tile] === Terrain.Forest) {
            m.terrain[target.tile] = Terrain.Stump;
            w.dirtyTiles.push(target.tile);
            out.push({ t: 'treeFelled', tile: target.tile });
            u.order = { type: 'idle' };
          }
        }
      }
    }
    // Projectiles fly straight to their target and respawn.
    for (const p of w.projectiles) {
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * TICK_DT * (p.kind === 'firepot' ? 0.6 : 1);
      if (d <= step) {
        p.alive = false;
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
    }
    const before = w.projectiles.length;
    w.projectiles = w.projectiles.filter((p) => p.alive);
    for (let i = w.projectiles.length; i < before; i++) this.respawnProjectile();
    // Nests muster cycle; Grainplots ripen; construction advances.
    for (const b of w.buildings) {
      if (b.nest && !b.nest.spent) b.nest.musterProgress = (b.nest.musterProgress + TICK_DT / 20) % 1;
      if (b.type === 'grainplot' && b.gatherers > 0) b.ripeness = (b.ripeness + TICK_DT / 15) % 1.05;
      if (!b.built) {
        b.buildProgress += TICK_DT / 25;
        if (b.buildProgress >= 1) {
          b.buildProgress = 0.02;
          out.push({ t: 'built', id: b.id, type: b.type, owner: b.owner, x: b.x, y: b.y });
        }
      }
    }
    this.eventTimer -= TICK_DT;
    if (this.eventTimer <= 0) {
      this.eventTimer = 0.12;
      this.randomEvents(out);
    }
    this.fogTimer -= TICK_DT;
    if (this.fogTimer <= 0) {
      this.fogTimer = 0.25;
      recomputeFog(w, this.exploredBase);
    }
    w.events.push(...out);
  }

  private respawnProjectile(): void {
    const w = this.world;
    const rng = this.rng;
    const players = w.units.filter((u) => u.alive && u.owner === 0 && u.cls !== 'worker' && Math.abs(u.x - this.clash.x) < 9);
    const enemies = w.units.filter((u) => u.alive && u.owner === 1 && Math.abs(u.x - this.clash.x) < 10);
    if (players.length === 0 || enemies.length === 0) return;
    const fromPlayer = rng.next() < 0.6;
    const a = fromPlayer ? rng.pick(players) : rng.pick(enemies);
    const b = fromPlayer ? rng.pick(enemies) : rng.pick(players);
    const kind: ProjectileKind = fromPlayer ? (rng.next() < 0.25 ? 'fire_arrow' : rng.next() < 0.1 ? 'bolt' : 'arrow') : 'spine';
    w.projectiles.push({
      id: w.nextId++,
      kind,
      sourceId: a.id,
      owner: a.owner,
      x: a.x,
      y: a.y,
      prevX: a.x,
      prevY: a.y,
      startX: a.x,
      startY: a.y,
      targetId: b.id,
      tx: b.x,
      ty: b.y,
      speed: kind === 'spine' ? 10 : 12,
      packet: { raw: 5, mult: 1, attackKind: 'ranged' },
      alive: true,
    });
  }

  private randomEvents(out: GameEvent[]): void {
    const w = this.world;
    const rng = this.rng;
    const fighters = w.units.filter((u) => u.alive && u.cls !== 'worker' && Math.abs(u.x - this.clash.x) < 9 && Math.abs(u.y - this.clash.y) < 8);
    if (fighters.length > 0) {
      for (let k = 0; k < 3; k++) {
        const t = rng.pick(fighters);
        const atk = rng.pick(fighters.filter((f) => f.owner !== t.owner).concat(t));
        const r = rng.next();
        const popup = r < 0.25 ? 'counter' : r < 0.4 ? 'resisted' : null;
        const mult = popup === 'counter' ? rng.pick([2, 3, 1.5]) : popup === 'resisted' ? rng.pick([0.5, 0.25, 0.2]) : 1;
        out.push({ t: 'hit', targetId: t.id, attackerId: atk.id, x: t.x, y: t.y, damage: 4 + rng.int(0, 12), mult, popup, targetOwner: t.owner, isStructure: false });
        t.hp = Math.max(1, t.hp - 3);
      }
    }
    if (rng.next() < 0.12) {
      const till = w.units.find((u) => u.type === 'tiller' && u.carry && u.order.type !== 'gather' && rng.next() < 0.3);
      if (till && till.carry) out.push({ t: 'dropoff', unitId: till.id, res: till.carry.type, amount: 10, x: till.x, y: till.y });
    }
    if (rng.next() < 0.05 && fighters.length > 20) {
      // A death and a replacement so the count stays stable.
      const v = rng.pick(fighters.filter((f) => f.type !== 'warden' && f.type !== 'antlered_lord'));
      if (v) {
        out.push({ t: 'death', id: v.id, kind: 'unit', type: v.type, owner: v.owner, x: v.x, y: v.y });
        v.alive = false;
        w.units = w.units.filter((u) => u !== v);
        w.entities.delete(v.id);
        const post = this.posts.get(v.id) ?? { x: v.x, y: v.y };
        const n: Unit = { ...v, id: w.nextId++, alive: true, hp: v.maxHp, burns: [], buffs: [], x: post.x + (v.owner === 0 ? -3 : 3), y: post.y, prevX: post.x, prevY: post.y };
        w.units.push(n);
        w.entities.set(n.id, n);
        this.posts.set(n.id, post);
        if (v.owner === 0 && rng.next() < 0.3) out.push({ t: 'rankUp', id: n.id, rank: 2, x: n.x, y: n.y });
      }
    }
    if (rng.next() < 0.04) {
      const kinds = ['move', 'attack', 'gather', 'attackMove', 'rally'] as const;
      const kind = rng.pick(kinds);
      out.push({ t: 'command', kind, x: this.clash.x + rng.range(-6, 2), y: this.clash.y + rng.range(-3, 5) });
    }
  }
}
