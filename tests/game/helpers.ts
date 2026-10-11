/**
 * Minimal hand-built World fixtures for battle-shell logic tests (no sim-core dependency).
 */
import { Rng } from '../../src/core/rng';
import type {
  BattleSetup,
  Building,
  BuildingId,
  Owner,
  PlayerState,
  ResourceNode,
  Unit,
  UnitClass,
  UnitId,
  World,
} from '../../src/sim/types';
import { UNITS } from '../../src/data/units';
import { BUILDINGS } from '../../src/data/buildings';

export function makeSetup(over: Partial<BattleSetup> = {}): BattleSetup {
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
    unlockedUnits: ['tiller', 'warden', 'ashpike', 'bowman', 'courser'],
    unlockedBuildings: ['hearth', 'cottage', 'storehouse', 'grainplot', 'muster_hall', 'bowyard', 'paddock', 'forgehall', 'brazier_tower'],
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
    showHints: true,
    bonusRes: {},
    ...over,
  };
}

function player(owner: Owner): PlayerState {
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

export function makeWorld(): World {
  const w = 32;
  const h = 32;
  return {
    setup: makeSetup(),
    map: {
      w,
      h,
      biome: 'greenmarch',
      terrain: new Uint8Array(w * h),
      treeAmount: new Uint16Array(w * h),
      variant: new Uint8Array(w * h),
    },
    anchors: {
      hearth: { tx: 4, ty: 4 },
      nests: [],
      nestSpires: [],
      pickets: [],
      resources: [],
      caches: [],
      beacons: [],
      vanguard: {
        muster_hall: { tx: 10, ty: 4 },
        bowyard: { tx: 10, ty: 4 },
        storehouse: { tx: 4, ty: 12 },
        grainplot: { tx: 10, ty: 10 },
      },
      watchtowers: [],
      musterPoints: [],
    },
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
    players: [player(0), player(1), player(2)],
    grid: { w, h, blocked: new Uint8Array(w * h), occupant: new Int32Array(w * h), speedMul: new Float32Array(w * h).fill(1), version: 0 },
    spatial: { cellSize: 4, cols: 8, rows: 8, cells: [] },
    fog: { state: new Uint8Array(w * h).fill(2), version: 0 },
    vision: [],
    blight: { tiles: new Uint8Array(w * h), ward: new Uint16Array(w * h), version: 0 },
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

export function addUnit(world: World, type: UnitId, x: number, y: number, owner: Owner = 0): Unit {
  const def = UNITS[type];
  const id = world.nextId++;
  const u: Unit = {
    id,
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
    cls: def.cls as UnitClass,
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
    lastAttackTick: 0,
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
  };
  world.entities.set(id, u);
  world.units.push(u);
  if (type === 'warden' && owner === 0) world.wardenId = id;
  return u;
}

export function addBuilding(world: World, type: BuildingId, tx: number, ty: number, owner: Owner = 0, built = true): Building {
  const def = BUILDINGS[type];
  const id = world.nextId++;
  const b: Building = {
    id,
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
    built,
    buildProgress: built ? 1 : 0,
    queue: [],
    research: null,
    rally: null,
    attackCooldown: 0,
    targetId: 0,
    lastAttackTick: 0,
    gatherers: 0,
    ripeness: 0,
    nest: null,
    object: null,
  };
  world.entities.set(id, b);
  world.buildings.push(b);
  if (type === 'hearth' && owner === 0) world.hearthId = id;
  return b;
}

export function addThicket(world: World, tx: number, ty: number, amount = 150): ResourceNode {
  const id = world.nextId++;
  const r: ResourceNode = {
    id,
    owner: 2,
    x: tx + 0.5,
    y: ty + 0.5,
    hp: 1,
    maxHp: 1,
    alive: true,
    invulnerable: true,
    untargetable: false,
    bornTick: 0,
    lastDamagedTick: -1,
    lastAttackerId: 0,
    kind: 'resource',
    type: 'thicket',
    resType: 'grain',
    tx,
    ty,
    w: 1,
    h: 1,
    amount,
    initial: 150,
    gatherers: 0,
    maxGatherers: 2,
    contested: false,
  };
  world.entities.set(id, r);
  world.resources.push(r);
  return r;
}

export function kill(world: World, id: number): void {
  const e = world.entities.get(id);
  if (e) e.alive = false;
}
