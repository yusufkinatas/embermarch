/** Hand-built World fixtures for nav tests (no sim-core / encounter needed). */
import { Rng } from '../../src/core/rng';
import { BUILDINGS } from '../../src/data/buildings';
import { UNITS } from '../../src/data/units';
import { createFog } from '../../src/sim/nav/fog';
import { createNavGrid, setFootprint } from '../../src/sim/nav/grid';
import { setMove, stepMovement } from '../../src/sim/nav/movement';
import { createSpatialHash, rebuildSpatial } from '../../src/sim/nav/spatial';
import { Terrain } from '../../src/sim/types';
import type {
  BattleSetup,
  Building,
  BuildingId,
  GameMap,
  MapAnchors,
  MoveIntent,
  Owner,
  PlayerState,
  ResourceNode,
  ResourceNodeId,
  Unit,
  UnitId,
  World,
} from '../../src/sim/types';

/**
 * ASCII map: '.' grass, '#' rock, '~' water, ',' shallows, 'T' forest (120 timber),
 * 's' stump, 'B' briar wall. Rows are y, columns x.
 */
export function mapFromAscii(rows: string[]): GameMap {
  const h = rows.length;
  const w = rows[0].length;
  const terrain = new Uint8Array(w * h);
  const treeAmount = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x] ?? '.';
      const i = y * w + x;
      switch (ch) {
        case '#':
          terrain[i] = Terrain.Rock;
          break;
        case '~':
          terrain[i] = Terrain.Water;
          break;
        case ',':
          terrain[i] = Terrain.Shallows;
          break;
        case 'T':
          terrain[i] = Terrain.Forest;
          treeAmount[i] = 120;
          break;
        case 's':
          terrain[i] = Terrain.Stump;
          break;
        case 'B':
          terrain[i] = Terrain.BriarWall;
          break;
        default:
          terrain[i] = Terrain.Grass;
      }
    }
  }
  return { w, h, biome: 'greenmarch', terrain, treeAmount, variant: new Uint8Array(w * h) };
}

export function openMap(w: number, h: number): GameMap {
  return mapFromAscii(Array.from({ length: h }, () => '.'.repeat(w)));
}

function playerState(owner: Owner): PlayerState {
  return {
    owner,
    res: { grain: 0, timber: 0, ember: 0 },
    pop: 0,
    popCap: 0,
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
    stats: {
      gathered: { grain: 0, timber: 0, ember: 0 },
      unitsTrained: 0,
      unitsLost: 0,
      kills: 0,
      buildingsBuilt: 0,
      buildingsLost: 0,
    },
    popAlertTick: 0,
  };
}

export function makeWorld(mapOrRows: GameMap | string[]): World {
  const map = Array.isArray(mapOrRows) ? mapFromAscii(mapOrRows) : mapOrRows;
  const n = map.w * map.h;
  return {
    setup: { seed: 1, objective: 'raze', depth: 1 } as unknown as BattleSetup,
    map,
    anchors: {} as unknown as MapAnchors,
    tick: 0,
    time: 0,
    countdown: 0,
    rng: new Rng(1),
    nextId: 1,
    entities: new Map(),
    units: [],
    buildings: [],
    resources: [],
    projectiles: [],
    players: [playerState(0), playerState(1), playerState(2)],
    grid: createNavGrid(map),
    spatial: createSpatialHash(map.w, map.h),
    fog: createFog(map.w, map.h),
    vision: [],
    blight: { tiles: new Uint8Array(n), ward: new Uint16Array(n), version: 0 },
    encounter: { objective: 'raze', doctrine: 'swarm' },
    dirtyTiles: [],
    events: [],
    outcome: 'ongoing',
    lastStandsUsed: 0,
    hearthId: 0,
    wardenId: 0,
    debug: { revealAll: false, invulnerablePlayer: false },
  };
}

export function addUnit(world: World, type: UnitId, owner: Owner, x: number, y: number, over: Partial<Unit> = {}): Unit {
  const def = UNITS[type];
  const u: Unit = {
    id: world.nextId++,
    owner,
    x,
    y,
    hp: def.hp,
    maxHp: def.hp,
    alive: true,
    invulnerable: false,
    untargetable: false,
    bornTick: world.tick,
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
    lastAttackTick: -1,
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
    ...over,
  };
  world.entities.set(u.id, u);
  world.units.push(u);
  return u;
}

export function addBuilding(world: World, type: BuildingId, owner: Owner, tx: number, ty: number, over: Partial<Building> = {}): Building {
  const def = BUILDINGS[type];
  const b: Building = {
    id: world.nextId++,
    owner,
    x: tx + def.w / 2,
    y: ty + def.h / 2,
    hp: def.hp,
    maxHp: def.hp,
    alive: true,
    invulnerable: false,
    untargetable: false,
    bornTick: world.tick,
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
    lastAttackTick: -1,
    gatherers: 0,
    ripeness: 0,
    nest: null,
    object: null,
    ...over,
  };
  world.entities.set(b.id, b);
  world.buildings.push(b);
  setFootprint(world, b.tx, b.ty, b.w, b.h, b.id);
  return b;
}

export function addResource(world: World, type: ResourceNodeId, tx: number, ty: number, size = type === 'thicket' ? 1 : 2): ResourceNode {
  const r: ResourceNode = {
    id: world.nextId++,
    owner: 2,
    x: tx + size / 2,
    y: ty + size / 2,
    hp: 1,
    maxHp: 1,
    alive: true,
    invulnerable: true,
    untargetable: false,
    bornTick: world.tick,
    lastDamagedTick: -1,
    lastAttackerId: 0,
    kind: 'resource',
    type,
    resType: type === 'thicket' ? 'grain' : 'ember',
    tx,
    ty,
    w: size,
    h: size,
    amount: 150,
    initial: 150,
    gatherers: 0,
    maxGatherers: 2,
    contested: false,
  };
  world.entities.set(r.id, r);
  world.resources.push(r);
  setFootprint(world, tx, ty, size, size, r.id);
  return r;
}

export function intent(x: number, y: number, over: Partial<MoveIntent> = {}): MoveIntent {
  return { x, y, targetId: 0, range: 0, mode: 'player', ...over };
}

/** Order a point move through the public API. */
export function moveTo(world: World, u: Unit, x: number, y: number, over: Partial<MoveIntent> = {}): void {
  setMove(world, u, intent(x, y, over));
}

/** Advance the nav part of the sim tick (spatial rebuild + movement) n times. */
export function run(world: World, ticks: number, each?: () => void): void {
  for (let k = 0; k < ticks; k++) {
    world.tick++;
    world.time += 0.05;
    for (const u of world.units) {
      u.prevX = u.x;
      u.prevY = u.y;
    }
    rebuildSpatial(world);
    stepMovement(world);
    each?.();
  }
}

/** Run until pred() is true (or the tick limit); returns ticks used, or -1 on timeout. */
export function runUntil(world: World, maxTicks: number, pred: () => boolean): number {
  for (let k = 0; k < maxTicks; k++) {
    run(world, 1);
    if (pred()) return k + 1;
  }
  return -1;
}

/** Is any part of the unit's terrain box (half-size min(r, 0.45)) inside a blocked tile? */
export function overlapsBlocked(world: World, u: Unit): boolean {
  const r = Math.min(u.radius, 0.45) - 1e-6;
  const g = world.grid;
  for (let ty = Math.floor(u.y - r); ty <= Math.floor(u.y + r); ty++) {
    for (let tx = Math.floor(u.x - r); tx <= Math.floor(u.x + r); tx++) {
      if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return true;
      if (g.blocked[ty * g.w + tx] !== 0) return true;
    }
  }
  return false;
}

export function tileOf(world: World, x: number, y: number): number {
  return Math.floor(y) * world.grid.w + Math.floor(x);
}

/** Deterministic pseudo-random map with scattered rock blobs (keeps a border ring open). */
export function randomObstacleMap(w: number, h: number, seed: number, density = 0.22): GameMap {
  const rng = new Rng(seed);
  const rows: string[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => '.'));
  const blobs = Math.floor((w * h * density) / 6);
  for (let b = 0; b < blobs; b++) {
    const cx = rng.int(1, w - 2);
    const cy = rng.int(1, h - 2);
    const len = rng.int(2, 8);
    const horiz = rng.chance(0.5);
    for (let k = 0; k < len; k++) {
      const x = horiz ? cx + k : cx;
      const y = horiz ? cy : cy + k;
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1) rows[y][x] = rng.chance(0.15) ? 'T' : '#';
    }
  }
  return mapFromAscii(rows.map((r) => r.join('')));
}
