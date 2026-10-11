/**
 * Minimal fake of the sim-core / nav functions the encounter module calls, so the director, AI
 * state machine and objectives can be tested in isolation (no movement, no combat). Units only
 * move when a test moves them. Test files wire it in with vi.mock(...) factories that import this.
 */
import { Rng } from '../../src/core/rng';
import { BUILDINGS } from '../../src/data/buildings';
import { UNITS } from '../../src/data/units';
import { armorDamage } from '../../src/data/balance';
import {
  ENEMY,
  NEUTRAL,
  PLAYER,
  TICK_DT,
  Terrain,
  type BattleSetup,
  type Building,
  type BuildingId,
  type DoctrineId,
  type Entity,
  type MapAnchors,
  type ModifierId,
  type ObjectiveId,
  type Order,
  type Owner,
  type PlayerState,
  type Unit,
  type UnitId,
  type World,
} from '../../src/sim/types';

export const hooks: {
  onDeath: (w: World, e: Entity, killerId: number) => void;
  onDamaged: (w: World, t: Entity, attackerId: number, amount: number) => void;
  tick: (w: World) => void;
  init: (w: World) => void;
} = {
  onDeath: () => {},
  onDamaged: () => {},
  tick: () => {},
  init: () => {},
};

function setFoot(world: World, b: { tx: number; ty: number; w: number; h: number }, id: number): void {
  for (let y = b.ty; y < b.ty + b.h; y++) {
    for (let x = b.tx; x < b.tx + b.w; x++) {
      if (x < 0 || y < 0 || x >= world.map.w || y >= world.map.h) continue;
      const i = y * world.map.w + x;
      world.grid.blocked[i] = id ? 1 : 0;
      world.grid.occupant[i] = id;
    }
  }
  world.grid.version++;
}

export function spawnUnit(world: World, type: UnitId, owner: Owner, x: number, y: number): Unit {
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
    stuck: { checkX: 0, checkY: 0, timer: 0, repaths: 0, windowTimer: 0 },
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
  };
  world.entities.set(u.id, u);
  world.units.push(u);
  return u;
}

export function spawnBuilding(world: World, type: BuildingId, owner: Owner, tx: number, ty: number, opts?: { built?: boolean }): Building {
  const def = BUILDINGS[type];
  const b: Building = {
    id: world.nextId++,
    owner,
    x: tx + def.w / 2,
    y: ty + def.h / 2,
    hp: def.hp,
    maxHp: def.hp,
    alive: true,
    invulnerable: !!def.invulnerable,
    untargetable: !!def.untargetable,
    bornTick: world.tick,
    lastDamagedTick: -1,
    lastAttackerId: 0,
    kind: 'building',
    type,
    tx,
    ty,
    w: def.w,
    h: def.h,
    built: opts?.built ?? true,
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
  };
  world.entities.set(b.id, b);
  world.buildings.push(b);
  setFoot(world, b, b.id);
  return b;
}

export function killEntity(world: World, e: Entity, killerId: number): void {
  if (!e.alive) return;
  e.alive = false;
  e.hp = 0;
  world.events.push({ t: 'death', id: e.id, kind: e.kind === 'unit' ? 'unit' : 'building', type: e.type as UnitId, owner: e.owner, x: e.x, y: e.y });
  if (e.kind === 'building') setFoot(world, e, 0);
  if (e.kind === 'building' && e.id === world.hearthId) world.hearthId = 0;
  hooks.onDeath(world, e, killerId);
}

export function damage(world: World, target: Entity, amount: number, attackerId: number): number {
  if (!target.alive || target.invulnerable) return 0;
  target.hp -= amount;
  target.lastDamagedTick = world.tick;
  target.lastAttackerId = attackerId;
  hooks.onDamaged(world, target, attackerId, amount);
  if (target.hp <= 0) killEntity(world, target, attackerId);
  return amount;
}

export function dealAbilityDamage(world: World, target: Entity, raw: number, sourceId: number): number {
  const armor = target.kind === 'unit' ? UNITS[target.type].armor : target.kind === 'building' ? BUILDINGS[target.type].armor : 0;
  return damage(world, target, armorDamage(raw, armor), sourceId);
}

export function dealTrueDamage(world: World, target: Entity, amount: number, sourceId: number): number {
  return damage(world, target, amount, sourceId);
}

export function orderUnit(world: World, u: Unit, order: Order): void {
  u.order = { ...order } as Order;
  u.queue = [];
  u.targetId = order.type === 'attack' ? order.targetId : 0;
  u.move = null;
}

export function stopUnit(world: World, u: Unit): void {
  u.order = { type: 'idle' };
  u.queue = [];
  u.move = null;
  u.targetId = 0;
}

export function endBattle(world: World, outcome: 'victory' | 'defeat'): void {
  if (world.outcome !== 'ongoing') return;
  world.outcome = outcome;
  world.events.push({ t: outcome });
}

export function displaceUnit(world: World, u: Unit, dx: number, dy: number): void {
  u.x += dx;
  u.y += dy;
}

export const entitiesMock = { spawnUnit, spawnBuilding, killEntity };
export const ordersMock = { orderUnit, stopUnit };
export const combatMock = { dealAbilityDamage, dealTrueDamage };
export const worldMock = { endBattle };
export const movementMock = { displaceUnit };

// ---------------------------------------------------------------------------
// World fixture
// ---------------------------------------------------------------------------

function player(owner: Owner): PlayerState {
  return {
    owner,
    res: { grain: 0, timber: 0, ember: 0 },
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

export interface FixtureOpts {
  objective?: ObjectiveId;
  depth?: number;
  modifiers?: ModifierId[];
  doctrine?: DoctrineId;
  tier?: number;
  coldWatchfire?: boolean;
  waveMult?: number;
  size?: number;
  nests?: { tx: number; ty: number }[];
  pickets?: boolean;
  caches?: { tx: number; ty: number; type: 'ruined_cache' | 'ancient_cache' }[];
  beacons?: { tx: number; ty: number }[];
  flags?: PlayerState['flags'];
  seed?: number;
  /** Skip calling hooks.init (the encounter). */
  skipInit?: boolean;
}

export function makeWorld(o: FixtureOpts = {}): World {
  const objective = o.objective ?? 'raze';
  const size = o.size ?? (objective === 'boss' ? 64 : 48);
  const n = size * size;
  const isBoss = objective === 'boss';
  const hearthTile = isBoss ? { tx: 8, ty: size - 12 } : { tx: 6, ty: 6 };
  const nests = o.nests ?? (isBoss ? [{ tx: 30, ty: 12 }, { tx: 44, ty: 26 }, { tx: 38, ty: 30 }] : [{ tx: 36, ty: 8 }, { tx: 8, ty: 36 }]);
  const hc = { x: hearthTile.tx + 2, y: hearthTile.ty + 2 };
  const anchors: MapAnchors = {
    hearth: hearthTile,
    nests,
    nestSpires: nests.map((p, i) => ({ tx: p.tx - 2, ty: p.ty + 1, nestIndex: i })),
    pickets: o.pickets ? [{ tx: 24, ty: 14, seamIndex: 0 }, { tx: 14, ty: 24, seamIndex: 1 }] : [],
    resources: [],
    caches: o.caches ?? [],
    beacons: o.beacons ?? [],
    vanguard: { muster_hall: { tx: 12, ty: 6 }, bowyard: { tx: 12, ty: 6 }, storehouse: { tx: 6, ty: 12 }, grainplot: { tx: 3, ty: 12 } },
    watchtowers: [],
    throne: isBoss ? { tx: 48, ty: 8 } : undefined,
    musterPoints: nests.map((p) => {
      const cx = p.tx + 1.5;
      const cy = p.ty + 1.5;
      const dx = hc.x - cx;
      const dy = hc.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      return { x: cx + (dx / len) * 4.5, y: cy + (dy / len) * 4.5 };
    }),
  };
  const setup: BattleSetup = {
    seed: o.seed ?? 1,
    nodeId: 'test',
    objective,
    biome: isBoss ? 'heartwood' : 'greenmarch',
    depth: isBoss ? 7 : (o.depth ?? 1),
    isElite: objective === 'elite',
    isBoss,
    modifiers: o.modifiers ?? [],
    doctrine: o.doctrine ?? 'swarm',
    tier: o.tier ?? 0,
    house: 'ardent',
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
    waveMult: o.waveMult ?? 1,
    coldWatchfire: !!o.coldWatchfire,
    showHints: false,
    bonusRes: {},
  };
  const world = {
    setup,
    map: { w: size, h: size, biome: setup.biome, terrain: new Uint8Array(n).fill(Terrain.Grass), treeAmount: new Uint16Array(n), variant: new Uint8Array(n) },
    anchors,
    tick: 0,
    time: 0,
    countdown: 0,
    rng: new Rng(o.seed ?? 1),
    nextId: 1,
    entities: new Map(),
    units: [],
    buildings: [],
    resources: [],
    projectiles: [],
    players: [player(PLAYER), player(ENEMY), player(NEUTRAL)],
    grid: { w: size, h: size, blocked: new Uint8Array(n), occupant: new Int32Array(n), speedMul: new Float32Array(n).fill(1), version: 0 },
    spatial: { cellSize: 4, cols: 1, rows: 1, cells: [] },
    fog: { state: new Uint8Array(n), version: 0 },
    vision: [],
    blight: { tiles: new Uint8Array(n), ward: new Uint16Array(n), version: 0 },
    encounter: { objective, doctrine: setup.doctrine },
    dirtyTiles: [],
    events: [],
    outcome: 'ongoing',
    lastStandsUsed: 0,
    hearthId: 0,
    wardenId: 0,
    debug: { revealAll: false, invulnerablePlayer: false },
  } as unknown as World;
  world.players[PLAYER].flags = o.flags ?? {};
  const h = spawnBuilding(world, 'hearth', PLAYER, hearthTile.tx, hearthTile.ty);
  h.maxHp = h.hp = 100000;
  world.hearthId = h.id;
  if (!o.skipInit) hooks.init(world);
  return world;
}

/** Advance the fake sim by `seconds`: tick, time, encounter tick, purge dead. */
export function step(world: World, seconds: number): void {
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) {
    if (world.outcome !== 'ongoing') return;
    world.tick++;
    world.time = world.tick * TICK_DT;
    for (const u of world.units) {
      u.prevX = u.x;
      u.prevY = u.y;
    }
    hooks.tick(world);
    purge(world);
  }
}

export function purge(world: World): void {
  world.units = world.units.filter((u) => u.alive);
  world.buildings = world.buildings.filter((b) => b.alive);
  for (const [id, e] of world.entities) if (!e.alive) world.entities.delete(id);
}

export function enemyUnits(world: World, role?: string): Unit[] {
  return world.units.filter((u) => u.alive && u.owner === ENEMY && (!role || u.ai?.role === role));
}

export function nestBuildings(world: World): Building[] {
  return world.buildings.filter((b) => b.alive && (b.type === 'thorn_nest' || b.type === 'root_heart'));
}

export function killAll(world: World, units: Unit[], killerId = 0): void {
  for (const u of units) killEntity(world, u, killerId);
  purge(world);
}
