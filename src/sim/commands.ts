/**
 * Player commands -> orders (GDD §O). issueCommand is the only way the HUD / input mutate the world.
 * Every command returns a CommandResult with a player-facing reason on failure, and successful unit
 * commands emit a 'command' feedback event (ripple / X / hammer). OWNER: sim-core.
 *
 * Smart (RMB): enemy -> attack (Gatebreaker: move); resource / tree / own Grainplot -> Tillers gather;
 * own unfinished or damaged building -> Tillers build / repair; drop-off with a loaded Tiller ->
 * deposit; anything else -> move (formation for groups).
 */
import { NAV } from '../data/balance';
import { BUILDINGS } from '../data/buildings';
import { useAbility, rallyHearth } from './abilities';
import { emit } from './alerts';
import { resolveTarget } from './claims';
import { canAttack } from './combat';
import { core, hostile, ucore } from './core';
import { getBuilding, getEntity, spawnBuilding } from './entities';
import { isDropoff, normaliseTreeTarget } from './economy';
import { orderUnit, stopUnit } from './orders';
import { formationSlots } from './nav/movement';
import { checkPlacement, buildingRequirementReason, displaceUnitsFrom } from './placement';
import { missingReason, pay } from './players';
import {
  cancelResearch,
  cancelTraining,
  demolish,
  queueTraining,
  setRally,
  startResearch,
} from './production';
import { pickEntityAt } from './queries';
import { costOf } from './stats';
import { isTileExplored } from './vision';
import type { Command, CommandResult, Entity, GatherTarget, Order, Unit, World } from './types';
import { PLAYER, Terrain } from './types';

const ok: CommandResult = { ok: true };
function fail(reason: string): CommandResult {
  return { ok: false, reason };
}

function ownUnits(world: World, ids: number[]): Unit[] {
  const out: Unit[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = world.entities.get(id);
    if (e && e.kind === 'unit' && e.alive && e.owner === PLAYER) out.push(e);
  }
  return out;
}

/** A direct player command overrides any saved (rally / flee) order and leash return. */
function directCommand(world: World, u: Unit, keepJob: boolean): void {
  const uc = ucore(world, u);
  uc.savedOrder = null;
  uc.savedQueue = null;
  uc.returning = false;
  uc.flowKey = undefined;
  if (!keepJob) u.job = null;
}

function clampToMap(world: World, x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(0.5, Math.min(world.map.w - 0.5, x)),
    y: Math.max(0.5, Math.min(world.map.h - 0.5, y)),
  };
}

/** Move / attack-move a group with formation slots (melee front, ranged behind); flow field for >= 4 units. */
function groupMove(world: World, units: Unit[], x: number, y: number, kind: 'move' | 'attackMove', queue: boolean): void {
  if (units.length === 0) return;
  const p = clampToMap(world, x, y);
  if (units.length === 1) {
    directCommand(world, units[0], false);
    orderUnit(world, units[0], { type: kind, x: p.x, y: p.y }, queue);
    return;
  }
  let cx = 0;
  let cy = 0;
  for (const u of units) {
    cx += u.x;
    cy += u.y;
  }
  cx /= units.length;
  cy /= units.length;
  const slots = formationSlots(units, cx, cy, p.x, p.y, world);
  const flowKey = units.length >= NAV.flowFieldMinGroup ? `grp:${world.tick}:${Math.floor(p.x)},${Math.floor(p.y)}` : undefined;
  units.forEach((u, i) => {
    const s = clampToMap(world, slots[i]?.x ?? p.x, slots[i]?.y ?? p.y);
    directCommand(world, u, false);
    orderUnit(world, u, { type: kind, x: s.x, y: s.y }, queue);
    if (!queue) ucore(world, u).flowKey = flowKey;
  });
}

function treeTileAt(world: World, x: number, y: number): number | null {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= world.map.w || ty >= world.map.h) return null;
  const tile = ty * world.map.w + tx;
  if (world.map.terrain[tile] !== Terrain.Forest || world.map.treeAmount[tile] <= 0) return null;
  return isTileExplored(world, tx, ty) ? tile : null;
}

function gatherTargetOf(e: Entity | null, tile: number | null): GatherTarget | null {
  if (e && e.kind === 'resource' && e.alive) return { kind: 'node', id: e.id };
  if (e && e.kind === 'building' && e.owner === PLAYER && e.type === 'grainplot' && e.built) return { kind: 'plot', id: e.id };
  if (!e && tile !== null) return { kind: 'tree', tile };
  return null;
}

function smart(world: World, cmd: Extract<Command, { type: 'smart' }>): CommandResult {
  const units = ownUnits(world, cmd.unitIds);
  if (units.length === 0) return fail('No units selected');
  const queue = !!cmd.queue;
  let target: Entity | null = cmd.targetId ? (getEntity(world, cmd.targetId) ?? null) : pickEntityAt(world, cmd.x, cmd.y);
  if (target && !target.alive) target = null;
  const tile = target ? null : treeTileAt(world, cmd.x, cmd.y);

  // Enemy target: attack with everything that can; Gatebreakers (and non-attackers) move there.
  if (target && hostile(target.owner, PLAYER)) {
    const movers: Unit[] = [];
    let attacked = 0;
    for (const u of units) {
      if (canAttack(world, u, target)) {
        directCommand(world, u, false);
        orderUnit(world, u, { type: 'attack', targetId: target.id }, queue);
        attacked++;
      } else movers.push(u);
    }
    groupMove(world, movers, cmd.x, cmd.y, 'move', queue);
    emit(world, { t: 'command', kind: attacked ? 'attack' : 'move', x: target.x, y: target.y, targetId: target.id });
    return ok;
  }

  const tillers = units.filter((u) => u.type === 'tiller');
  const others = units.filter((u) => u.type !== 'tiller');
  let gt = gatherTargetOf(target, tile);
  if (gt && gt.kind === 'tree' && tillers.length) gt = normaliseTreeTarget(world, tillers[0], gt.tile);

  // Own building: build / repair / deposit for Tillers.
  if (target && target.kind === 'building' && target.owner === PLAYER && tillers.length) {
    const b = target;
    const needsWork = !b.built || b.hp < b.maxHp;
    if (needsWork) {
      for (const u of tillers) {
        directCommand(world, u, true);
        orderUnit(world, u, { type: 'build', buildingId: b.id }, queue);
      }
      groupMove(world, others, cmd.x, cmd.y, 'move', queue);
      emit(world, { t: 'command', kind: 'build', x: b.x, y: b.y, targetId: b.id });
      return ok;
    }
    if (!gt && isDropoff(b)) {
      const movers = [...others];
      for (const u of tillers) {
        if (u.carry && u.carry.amount > 0) {
          directCommand(world, u, true);
          orderUnit(world, u, { type: 'deposit', buildingId: b.id }, queue);
        } else movers.push(u);
      }
      groupMove(world, movers, cmd.x, cmd.y, 'move', queue);
      emit(world, { t: 'command', kind: 'gather', x: b.x, y: b.y, targetId: b.id });
      return ok;
    }
  }

  if (gt && tillers.length) {
    for (const u of tillers) {
      directCommand(world, u, true);
      orderUnit(world, u, { type: 'gather', target: gt }, queue);
    }
    groupMove(world, others, cmd.x, cmd.y, 'move', queue);
    const r = resolveTarget(world, gt);
    emit(world, { t: 'command', kind: 'gather', x: r?.x ?? cmd.x, y: r?.y ?? cmd.y, targetId: target?.id });
    return ok;
  }

  groupMove(world, units, cmd.x, cmd.y, 'move', queue);
  emit(world, { t: 'command', kind: 'move', x: cmd.x, y: cmd.y });
  return ok;
}

function build(world: World, cmd: Extract<Command, { type: 'build' }>): CommandResult {
  const p = world.players[PLAYER];
  const def = BUILDINGS[cmd.building];
  if (!def || def.side !== 'player' || cmd.building === 'hearth') return fail('Cannot build that');
  if (!p.unlockedBuildings.includes(cmd.building)) return fail('Not unlocked');
  const tillers = ownUnits(world, cmd.unitIds).filter((u) => u.type === 'tiller');
  if (tillers.length === 0) return fail('Select Tillers to build');
  const req = buildingRequirementReason(world, cmd.building);
  if (req) return fail(req);
  const place = checkPlacement(world, cmd.building, cmd.tx, cmd.ty);
  if (!place.ok) return fail(place.reason ?? 'Cannot build here');
  const cost = costOf(world, PLAYER, cmd.building);
  const miss = missingReason(p, cost);
  if (miss) return fail(miss);
  pay(p, cost);
  const b = spawnBuilding(world, cmd.building, PLAYER, cmd.tx, cmd.ty, { built: false });
  core(world).foundationPaid.set(b.id, { ...cost });
  displaceUnitsFrom(world, b);
  emit(world, { t: 'placed', id: b.id, type: b.type, owner: PLAYER });
  for (const u of tillers) {
    directCommand(world, u, true);
    orderUnit(world, u, { type: 'build', buildingId: b.id }, !!cmd.queue);
  }
  emit(world, { t: 'command', kind: 'build', x: b.x, y: b.y, targetId: b.id });
  return ok;
}

function unitOrder(world: World, ids: number[], order: Order, queue: boolean, keepJob: boolean): number {
  let n = 0;
  for (const u of ownUnits(world, ids)) {
    directCommand(world, u, keepJob);
    orderUnit(world, u, order, queue);
    n++;
  }
  return n;
}

export function issueCommandImpl(world: World, cmd: Command): CommandResult {
  if (world.outcome !== 'ongoing') return fail('The battle is over');
  switch (cmd.type) {
    case 'smart':
      return smart(world, cmd);
    case 'move':
    case 'attackMove': {
      const units = ownUnits(world, cmd.unitIds);
      if (!units.length) return fail('No units selected');
      groupMove(world, units, cmd.x, cmd.y, cmd.type, !!cmd.queue);
      emit(world, { t: 'command', kind: cmd.type, x: cmd.x, y: cmd.y });
      return ok;
    }
    case 'attack': {
      const t = getEntity(world, cmd.targetId);
      if (!t || !t.alive) return fail('No target');
      const units = ownUnits(world, cmd.unitIds);
      if (!units.length) return fail('No units selected');
      const movers: Unit[] = [];
      let n = 0;
      for (const u of units) {
        if (canAttack(world, u, t)) {
          directCommand(world, u, false);
          orderUnit(world, u, { type: 'attack', targetId: t.id }, !!cmd.queue);
          n++;
        } else movers.push(u);
      }
      if (!n && !hostile(t.owner, PLAYER)) return fail('Cannot attack that');
      // Units that cannot hit this target (Gatebreakers vs units) move to it instead.
      groupMove(world, movers, t.x, t.y, 'move', !!cmd.queue);
      emit(world, { t: 'command', kind: n ? 'attack' : 'move', x: t.x, y: t.y, targetId: t.id });
      return ok;
    }
    case 'gather': {
      const tillers = ownUnits(world, cmd.unitIds).filter((u) => u.type === 'tiller');
      if (!tillers.length) return fail('Select Tillers to gather');
      let target: GatherTarget | null = cmd.target;
      if (target.kind === 'tree') target = normaliseTreeTarget(world, tillers[0], target.tile);
      const r = target ? resolveTarget(world, target) : null;
      if (!target || !r) return fail('Nothing to gather there');
      for (const u of tillers) {
        directCommand(world, u, true);
        orderUnit(world, u, { type: 'gather', target }, !!cmd.queue);
      }
      emit(world, { t: 'command', kind: 'gather', x: r.x, y: r.y, targetId: target.kind === 'tree' ? undefined : target.id });
      return ok;
    }
    case 'build':
      return build(world, cmd);
    case 'repair': {
      const b = getBuilding(world, cmd.targetId);
      if (!b || b.owner !== PLAYER) return fail('Nothing to repair');
      if (b.built && b.hp >= b.maxHp) return fail('Not damaged');
      const tillers = ownUnits(world, cmd.unitIds).filter((u) => u.type === 'tiller');
      if (!tillers.length) return fail('Select Tillers to repair');
      for (const u of tillers) {
        directCommand(world, u, true);
        orderUnit(world, u, { type: 'build', buildingId: b.id }, !!cmd.queue);
      }
      emit(world, { t: 'command', kind: 'build', x: b.x, y: b.y, targetId: b.id });
      return ok;
    }
    case 'stop': {
      const units = ownUnits(world, cmd.unitIds);
      if (!units.length) return fail('No units selected');
      for (const u of units) {
        directCommand(world, u, false);
        stopUnit(world, u);
      }
      return ok;
    }
    case 'hold':
      return unitOrder(world, cmd.unitIds, { type: 'hold' }, false, false) ? ok : fail('No units selected');
    case 'train':
      return queueTraining(world, cmd.buildingIds, cmd.unit, cmd.count ?? 1);
    case 'cancelTrain':
      return cancelTraining(world, cmd.buildingId, cmd.index);
    case 'research':
      return startResearch(world, cmd.buildingId, cmd.research);
    case 'cancelResearch':
      return cancelResearch(world, cmd.buildingId);
    case 'rally':
      return setRally(world, cmd.buildingIds, cmd.x, cmd.y, cmd.targetId, cmd.tile);
    case 'demolish':
      return demolish(world, cmd.buildingId);
    case 'rallyHearth':
      return rallyHearth(world);
    case 'ability':
      return useAbility(world, cmd.slot, cmd.x, cmd.y);
  }
  return fail('Unknown command');
}
