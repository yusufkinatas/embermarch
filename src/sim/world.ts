/**
 * World creation and the fixed-step tick. OWNER: sim-core.
 *
 * Tick order (stepWorld):
 *  0. if countdown > 0: countdown -= TICK_DT, update fog, return
 *  1. tick++, time += TICK_DT; copy x/y -> prevX/prevY for all units and projectiles
 *  2. nav.rebuildSpatial(world)
 *  3. encounter.tickEncounter(world)        (director, enemy AI orders, blight, objectives)
 *  4. production: training queues, research, passive income, abilities/buffs expiry, Warden respawn
 *  5. unit behaviors (sim-core): status (burn/regen/buffs), order execution -> sets unit.move / attacks
 *  6. nav.stepMovement(world)               (paths, flow fields, separation, stuck detection)
 *  7. projectiles
 *  8. building defensive fire (Hearth, towers, Thornspires)
 *  9. remove dead entities from live lists
 * 10. every 4th tick: nav.updateFog(world)
 * 11. outcome checks (defeat when the Hearth dies unless Last Stand; victory is set by encounter)
 */
import { START, parSeconds } from '../data/balance';
import { Rng, hashString } from '../core/rng';
import { stepAbilities } from './abilities';
import { emit } from './alerts';
import { afterMovement, stepBehaviors } from './behavior';
import { issueCommandImpl } from './commands';
import { core, isMilitaryClass } from './core';
import { stepDefense } from './defense';
import * as encounter from './encounter';
import { applyConstruction, passiveIncome } from './economy';
import { spawnBuilding, spawnResource, spawnUnit } from './entities';
import { createNavGrid } from './nav/grid';
import { exploreCircle, createFog, updateFog } from './nav/fog';
import { stepMovement } from './nav/movement';
import { createSpatialHash, rebuildSpatial } from './nav/spatial';
import { findSpawnTile } from './placement';
import { createPlayerStates, recomputePopCap } from './players';
import { stepProduction } from './production';
import { stepProjectiles } from './projectiles';
import { flagValue } from './stats';
import { stepStatus } from './status';
import type {
  BattleResult,
  BattleSetup,
  Building,
  CarriedUnit,
  Command,
  CommandResult,
  GameEvent,
  GameMap,
  GeneratedMap,
  PlayerUnitId,
  World,
} from './types';
import { ENEMY, PLAYER, TICK_DT } from './types';

function cloneMap(m: GameMap): GameMap {
  return {
    w: m.w,
    h: m.h,
    biome: m.biome,
    terrain: m.terrain.slice(),
    treeAmount: m.treeAmount.slice(),
    variant: m.variant,
  };
}

/** Starting units placed in rings around the Hearth (no unit overlap). */
function placeAround(world: World, hearth: Building, type: PlayerUnitId, opts: { rank?: 0 | 1 | 2 | 3; kills?: number; carried?: boolean; hpPct?: number }): void {
  const spot = findSpawnTile(world, hearth, 10) ?? { x: hearth.x, y: hearth.y + hearth.h / 2 + 0.5 };
  spawnUnit(world, type, PLAYER, spot.x, spot.y, opts);
}

export function createWorld(setup: BattleSetup, gen: GeneratedMap, opts?: { skipEncounter?: boolean }): World {
  // map -> grid / spatial / fog / blight arrays -> players (effects composed)
  const map = cloneMap(gen.map);
  const grid = createNavGrid(map);
  const spatial = createSpatialHash(map.w, map.h);
  const fog = createFog(map.w, map.h);
  const blight = { tiles: new Uint8Array(map.w * map.h), ward: new Uint16Array(map.w * map.h), version: 0 };
  const players = createPlayerStates(setup);
  const world: World = {
    setup,
    map,
    anchors: gen.anchors,
    tick: 0,
    time: 0,
    countdown: START.countdown,
    rng: new Rng(hashString(`battle:${setup.seed}:${setup.nodeId}`)),
    nextId: 1,
    entities: new Map(),
    units: [],
    buildings: [],
    resources: [],
    projectiles: [],
    players,
    grid,
    spatial,
    fog,
    vision: [],
    blight,
    encounter: { objective: setup.objective, doctrine: setup.doctrine },
    dirtyTiles: [],
    events: [],
    outcome: 'ongoing',
    lastStandsUsed: 0,
    hearthId: 0,
    wardenId: 0,
    debug: { revealAll: false, invulnerablePlayer: false },
  };
  const c = core(world);
  c.creating = true;

  // Resources from anchors (home Seam bonus from Deep Delvers).
  const homeBonus = flagValue(world, PLAYER, 'home_seam_bonus');
  for (const r of gen.anchors.resources) {
    spawnResource(world, r.type, r.tx, r.ty, r.amount + (r.home ? homeBonus : 0), r.contested);
  }

  // Hearth + Vanguard + Old Watchtowers.
  const hearth = spawnBuilding(world, 'hearth', PLAYER, gen.anchors.hearth.tx, gen.anchors.hearth.ty);
  const v = gen.anchors.vanguard;
  if (setup.vanguard === 'storehouse') {
    spawnBuilding(world, 'storehouse', PLAYER, v.storehouse.tx, v.storehouse.ty);
    spawnBuilding(world, 'grainplot', PLAYER, v.grainplot.tx, v.grainplot.ty);
  } else {
    const site = v[setup.vanguard];
    spawnBuilding(world, setup.vanguard, PLAYER, site.tx, site.ty);
  }
  if (setup.modifiers.includes('old_watchtowers')) {
    for (const t of gen.anchors.watchtowers) spawnBuilding(world, 'brazier_tower', PLAYER, t.tx, t.ty);
  }
  recomputePopCap(world);

  // Starting units: Tillers (+ startUnits effects), the free Courser, the Warden, Retinue, Sellswords.
  const extra = new Map<PlayerUnitId, number>();
  for (const e of world.players[PLAYER].effects) {
    if (e.kind === 'startUnits') extra.set(e.unit, (extra.get(e.unit) ?? 0) + e.count);
  }
  const tillers = START.tillers + (extra.get('tiller') ?? 0);
  extra.delete('tiller');
  for (let i = 0; i < tillers; i++) placeAround(world, hearth, 'tiller', {});
  for (let i = 0; i < START.coursers; i++) placeAround(world, hearth, 'courser', {});
  placeAround(world, hearth, 'warden', { hpPct: setup.wardenHpPct });
  for (const [type, n] of extra) for (let i = 0; i < n; i++) placeAround(world, hearth, type, {});
  const carried = (list: CarriedUnit[]): void => {
    for (const cu of list) placeAround(world, hearth, cu.type, { rank: cu.rank, kills: cu.kills, carried: true });
  };
  carried(setup.retinue);
  carried(setup.sellswords);

  // Explore around the Hearth (Cold Watch-Fire: everything).
  exploreCircle(world, hearth.x, hearth.y, setup.coldWatchfire ? Infinity : START.exploreRadius);

  if (!opts?.skipEncounter) {
    encounter.initEncounter(world);
    c.encounterOn = true;
  }
  c.creating = false;
  updateFog(world);
  return world;
}

function removeDead(world: World): void {
  let dead = false;
  for (const u of world.units) if (!u.alive) dead = true;
  if (dead) {
    const c = core(world);
    world.units = world.units.filter((u) => {
      if (u.alive) return true;
      world.entities.delete(u.id);
      c.units.delete(u.id);
      return false;
    });
  }
  if (world.buildings.some((b) => !b.alive)) {
    const c = core(world);
    world.buildings = world.buildings.filter((b) => {
      if (b.alive) return true;
      world.entities.delete(b.id);
      c.spawnRetry.delete(b.id);
      c.foundationPaid.delete(b.id);
      return false;
    });
  }
  if (world.resources.some((r) => !r.alive)) {
    world.resources = world.resources.filter((r) => {
      if (r.alive) return true;
      world.entities.delete(r.id);
      return false;
    });
  }
  if (world.projectiles.some((p) => !p.alive)) world.projectiles = world.projectiles.filter((p) => p.alive);
}

export function stepWorld(world: World): void {
  // 0. Kindle countdown.
  if (world.countdown > 0) {
    const before = Math.ceil(world.countdown / TICK_DT - 1e-6);
    world.countdown = Math.max(0, world.countdown - TICK_DT);
    if (before % 4 === 0 || world.countdown <= 0) updateFog(world);
    return;
  }
  if (world.outcome !== 'ongoing') return;
  const c = core(world);

  // 1. Clock and interpolation snapshots.
  world.tick++;
  world.time += TICK_DT;
  for (const u of world.units) {
    u.prevX = u.x;
    u.prevY = u.y;
  }
  for (const p of world.projectiles) {
    p.prevX = p.x;
    p.prevY = p.y;
  }

  // 2. Spatial hash.
  rebuildSpatial(world);

  // 3. Encounter.
  if (c.encounterOn) encounter.tickEncounter(world);

  // 4. Production and timers.
  stepProduction(world);
  passiveIncome(world);
  stepAbilities(world);

  // 5. Unit status and behaviors; construction applies the builders registered this tick.
  stepStatus(world);
  stepBehaviors(world);
  applyConstruction(world);

  // 6. Movement.
  stepMovement(world);
  afterMovement(world);

  // 7. Projectiles.
  stepProjectiles(world);

  // 8. Building defensive fire.
  stepDefense(world);

  // 9. Remove the dead.
  removeDead(world);

  // 10. Fog at 5 Hz.
  if (world.tick % 4 === 0) updateFog(world);

  // 11. Defeat.
  if (world.outcome === 'ongoing') {
    const h = world.hearthId ? world.entities.get(world.hearthId) : undefined;
    if (!h || !h.alive) endBattle(world, 'defeat');
  }
}

export function issueCommand(world: World, cmd: Command): CommandResult {
  return issueCommandImpl(world, cmd);
}

/** Take and clear all pending events. */
export function drainEvents(world: World): GameEvent[] {
  const ev = world.events;
  world.events = [];
  return ev;
}

/** Build the run-layer result. outcome 'retreat' is used by Sound the Retreat. */
export function buildBattleResult(world: World, outcome: BattleResult['outcome']): BattleResult {
  const c = core(world);
  const p = world.players[PLAYER];
  const victory = outcome === 'victory';
  const enc = c.encounterOn ? encounter.getEncounterResult(world) : null;
  const survivors: CarriedUnit[] = [];
  for (const u of world.units) {
    if (!u.alive || u.owner !== PLAYER || !isMilitaryClass(u.cls)) continue;
    survivors.push({ type: u.type as PlayerUnitId, rank: u.rank, kills: u.kills });
  }
  const base = {
    outcome,
    time: world.time,
    objective: world.setup.objective,
    depth: world.setup.depth,
    lastStandsUsed: world.lastStandsUsed,
    survivors,
    unspent: { grain: Math.floor(p.res.grain), timber: Math.floor(p.res.timber), ember: Math.floor(p.res.ember) },
    stats: {
      gathered: { ...p.stats.gathered },
      unitsTrained: p.stats.unitsTrained,
      unitsLost: p.stats.unitsLost,
      kills: p.stats.kills,
      buildingsBuilt: p.stats.buildingsBuilt,
      buildingsLost: p.stats.buildingsLost,
    },
  };
  if (enc) {
    return {
      ...base,
      plunderCrowns: enc.plunderCrowns,
      underPar: victory && enc.underPar,
      unbroken: victory && enc.unbroken,
      uprooted: victory && enc.uprooted,
      nestsDestroyed: enc.nestsDestroyed,
      picketsDestroyed: enc.picketsDestroyed,
      cachesLooted: enc.cachesLooted,
      ancientCacheLooted: enc.ancientCacheLooted,
      lordSlain: enc.lordSlain,
      regentSlain: enc.regentSlain,
    };
  }
  // No encounter (tests): sim-core's own bookkeeping.
  const nestsTotal = world.anchors.nests.length;
  const par = parSeconds(world.setup.objective, nestsTotal);
  const holdfast = world.setup.objective === 'holdfast';
  const nestsAlive = world.buildings.some((b) => b.alive && b.owner === ENEMY && (b.type === 'thorn_nest' || b.type === 'root_heart'));
  return {
    ...base,
    plunderCrowns: c.plundererCrowns,
    underPar: victory && par !== null && world.time <= par,
    unbroken: victory && holdfast && p.stats.buildingsLost === 0,
    uprooted: victory && holdfast && nestsTotal > 0 && !nestsAlive,
    nestsDestroyed: c.nestsDestroyed,
    picketsDestroyed: c.picketsDestroyed,
    cachesLooted: 0,
    ancientCacheLooted: false,
    lordSlain: c.lordSlain,
    regentSlain: c.regentSlain,
  };
}

/** Force the outcome (debug win()/lose(), encounter objectives). Emits victory/defeat events once. */
export function endBattle(world: World, outcome: 'victory' | 'defeat'): void {
  if (world.outcome !== 'ongoing') return;
  world.outcome = outcome;
  emit(world, outcome === 'victory' ? { t: 'victory' } : { t: 'defeat' });
}
