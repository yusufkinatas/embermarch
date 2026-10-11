/**
 * Entity lifecycle. OWNER: sim-core.
 * Spawning registers the entity in world.entities + the typed live list, and (for static
 * entities) marks the nav grid footprint via nav/grid.setFootprint.
 */
import { BUILDINGS } from '../data/buildings';
import { wardenRespawn } from '../data/balance';
import { RESEARCH } from '../data/research';
import { RESOURCE_NODES } from '../data/resources';
import { UNITS } from '../data/units';
import { alert, emit } from './alerts';
import { releaseClaim } from './claims';
import { core, ticks, ucore } from './core';
import * as encounter from './encounter';
import { onStructureDestroyed, onUnitKilled } from './hooks';
import { setFootprint } from './nav/grid';
import { recomputePopCap } from './players';
import { buildingStats, hasFlag, unitStats } from './stats';
import type {
  Building,
  BuildingId,
  Entity,
  Owner,
  ResourceNode,
  ResourceNodeId,
  Unit,
  UnitId,
  World,
} from './types';
import { PLAYER } from './types';

export interface SpawnUnitOpts {
  rank?: 0 | 1 | 2 | 3;
  kills?: number;
  /** Came from Retinue/Sellswords. */
  carried?: boolean;
  /** Override max HP multiplier (e.g. Warden 50% after the duel) - applies to current hp only. */
  hpPct?: number;
  /** Do not count toward pop (pre-placed units still count toward pop but ignore the cap). */
  silent?: boolean;
}

export function spawnUnit(world: World, type: UnitId, owner: Owner, x: number, y: number, opts?: SpawnUnitOpts): Unit {
  const def = UNITS[type];
  const rank = opts?.rank ?? 0;
  const st = unitStats(world, owner, type, rank);
  const hp = Math.max(1, Math.round(st.hp * (opts?.hpPct ?? 1)));
  const id = world.nextId++;
  const u: Unit = {
    id,
    owner,
    x,
    y,
    hp,
    maxHp: st.hp,
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
    facing: owner === PLAYER ? -Math.PI / 4 : (3 * Math.PI) / 4,
    vx: 0,
    vy: 0,
    speed: st.speed,
    order: { type: 'idle' },
    queue: [],
    move: null,
    moveStatus: 'none',
    blockedBy: 0,
    path: null,
    stuck: { checkX: x, checkY: y, timer: 0, repaths: 0, windowTimer: 0 },
    targetId: 0,
    attackCooldown: 0,
    lastAttackTick: -1000,
    movedSinceAttack: 0,
    homeX: x,
    homeY: y,
    carry: null,
    job: null,
    kills: opts?.kills ?? 0,
    rank,
    burns: [],
    buffs: [],
    carried: opts?.carried ?? false,
    ai: null,
  };
  world.entities.set(id, u);
  world.units.push(u);
  const uc = ucore(world, u);
  uc.noPop = !!opts?.silent;
  uc.nextScanTick = world.tick + (id % 4);
  if (owner === PLAYER) {
    if (!uc.noPop) world.players[PLAYER].pop += def.pop;
    if (type === 'warden') world.wardenId = id;
  }
  if (!core(world).creating) emit(world, { t: 'spawn', id, type, owner, x, y });
  return u;
}

export interface SpawnBuildingOpts {
  /** Pre-built (true) or a foundation (false). Default true. */
  built?: boolean;
}

/** Foundations start at this fraction of max HP and gain the rest with progress. */
export const FOUNDATION_HP = 0.1;

export function spawnBuilding(world: World, type: BuildingId, owner: Owner, tx: number, ty: number, opts?: SpawnBuildingOpts): Building {
  const def = BUILDINGS[type];
  const built = opts?.built ?? true;
  const st = buildingStats(world, owner, type);
  const id = world.nextId++;
  const b: Building = {
    id,
    owner,
    x: tx + def.w / 2,
    y: ty + def.h / 2,
    hp: built ? st.hp : Math.max(1, Math.round(st.hp * FOUNDATION_HP)),
    maxHp: st.hp,
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
    built,
    buildProgress: built ? 1 : 0,
    queue: [],
    research: null,
    rally: null,
    attackCooldown: 0,
    targetId: 0,
    lastAttackTick: -1000,
    gatherers: 0,
    ripeness: 0,
    nest: null,
    object: null,
  };
  world.entities.set(id, b);
  world.buildings.push(b);
  setFootprint(world, tx, ty, def.w, def.h, id);
  if (owner === PLAYER) {
    if (type === 'hearth') world.hearthId = id;
    if (built) recomputePopCap(world);
  }
  return b;
}

export function spawnResource(world: World, type: ResourceNodeId, tx: number, ty: number, amount: number, contested?: boolean): ResourceNode {
  const def = RESOURCE_NODES[type];
  const id = world.nextId++;
  const r: ResourceNode = {
    id,
    owner: 2,
    x: tx + def.w / 2,
    y: ty + def.h / 2,
    hp: 1,
    maxHp: 1,
    alive: true,
    invulnerable: true,
    untargetable: true,
    bornTick: world.tick,
    lastDamagedTick: -1,
    lastAttackerId: 0,
    kind: 'resource',
    type,
    resType: def.res,
    tx,
    ty,
    w: def.w,
    h: def.h,
    amount,
    initial: amount,
    gatherers: 0,
    maxGatherers: def.maxGatherers,
    contested: !!contested,
  };
  world.entities.set(id, r);
  world.resources.push(r);
  setFootprint(world, tx, ty, def.w, def.h, id);
  return r;
}

export function getEntity(world: World, id: number): Entity | undefined {
  return id ? world.entities.get(id) : undefined;
}

export function getUnit(world: World, id: number): Unit | undefined {
  const e = getEntity(world, id);
  return e && e.kind === 'unit' && e.alive ? e : undefined;
}

export function getBuilding(world: World, id: number): Building | undefined {
  const e = getEntity(world, id);
  return e && e.kind === 'building' && e.alive ? e : undefined;
}

/** Live resource node by id. */
export function getResource(world: World, id: number): ResourceNode | undefined {
  const e = getEntity(world, id);
  return e && e.kind === 'resource' && e.alive ? e : undefined;
}

export interface KillOpts {
  /** Player demolition: not counted as a building lost. */
  demolished?: boolean;
}

/**
 * Kill an entity now: marks !alive, emits a death event, frees footprint/pop, calls
 * encounter.onEntityDeath and boon hooks. Physical removal from lists happens at end of tick.
 */
export function killEntity(world: World, e: Entity, killerId: number, opts?: KillOpts): void {
  if (!e.alive) return;
  e.alive = false;
  e.hp = 0;
  const c = core(world);
  if (e.kind === 'unit') {
    releaseClaim(world, e);
    e.move = null;
    e.queue.length = 0;
    e.targetId = 0;
    const uc = ucore(world, e);
    uc.savedOrder = null;
    uc.savedQueue = null;
    if (e.owner === PLAYER) {
      const p = world.players[PLAYER];
      if (!uc.noPop) p.pop = Math.max(0, p.pop - UNITS[e.type].pop);
      p.stats.unitsLost++;
      if (e.type === 'warden' && world.wardenId === e.id) {
        world.wardenId = 0;
        const delay = wardenRespawn(p.wardenDeaths, hasFlag(world, PLAYER, 'second_wind'));
        p.wardenDeaths++;
        p.wardenRespawnTick = world.tick + ticks(delay);
        alert(world, 'warden_fallen', {
          text: `The Warden has fallen. Returns in ${Math.round(delay)} s.`,
          x: e.x,
          y: e.y,
          priority: 'high',
        });
      }
    }
    if (e.type === 'antlered_lord') c.lordSlain = true;
    if (e.type === 'briar_regent') c.regentSlain = true;
    emit(world, { t: 'death', id: e.id, kind: 'unit', type: e.type, owner: e.owner, x: e.x, y: e.y });
    onUnitKilled(world, e, killerId);
  } else if (e.kind === 'building') {
    setFootprint(world, e.tx, e.ty, e.w, e.h, 0);
    if (e.owner === PLAYER) {
      const p = world.players[PLAYER];
      if (e.built && !opts?.demolished) p.stats.buildingsLost++;
      if (e.research && RESEARCH[e.research.id].temper && p.temper === e.research.id) p.temper = null;
      e.queue.length = 0;
      e.research = null;
      if (e.id === world.hearthId) world.hearthId = 0;
      recomputePopCap(world);
    }
    emit(world, {
      t: 'death',
      id: e.id,
      kind: 'building',
      type: e.type,
      owner: e.owner,
      x: e.x,
      y: e.y,
      w: e.w,
      h: e.h,
    });
    onStructureDestroyed(world, e, killerId);
    if (e.owner === PLAYER && e.built && c.encounterOn) encounter.onPlayerBuildingChanged(world);
  } else {
    setFootprint(world, e.tx, e.ty, e.w, e.h, 0);
    e.amount = 0;
  }
  if (c.encounterOn) encounter.onEntityDeath(world, e, killerId, opts);
}
