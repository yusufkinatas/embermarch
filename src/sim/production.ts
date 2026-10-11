/**
 * Production (GDD §D, §E, §H): 5-slot training queues (cost paid on queue, 100% refund on cancel),
 * pop check when training starts (the head holds at the cap; "Need Cottages" at most every 15 s),
 * spawning on the nearest free tile around the building (retry each second), rally points,
 * research one at a time per building with the Forgehall Temper lock, demolition refunds.
 * OWNER: sim-core.
 */
import { BUILD, POP } from '../data/balance';
import { BUILDINGS } from '../data/buildings';
import { RESEARCH } from '../data/research';
import { TEXT } from '../data/text';
import { UNITS } from '../data/units';
import { alert, emit } from './alerts';
import { resolveTarget } from './claims';
import { core, ticks } from './core';
import { getBuilding, getEntity, killEntity, spawnUnit } from './entities';
import { rallyTreeTarget } from './economy';
import { orderUnit } from './orders';
import { findSpawnTile } from './placement';
import { canPay, missingReason, pay, recomposeEffects, refund } from './players';
import { buildingStats, researchCost, unitStats } from './stats';
import type { Building, CommandResult, PlayerUnitId, ResearchId, TrainQueueItem, Unit, World } from './types';
import { PLAYER, TICK_DT } from './types';

const ok: CommandResult = { ok: true };
function fail(reason: string): CommandResult {
  return { ok: false, reason };
}

/** Pop held by queue heads that already started training. */
export function reservedPop(world: World): number {
  let n = 0;
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== PLAYER) continue;
    const head = b.queue[0];
    if (head && head.total > 0) n += UNITS[head.unit].pop;
  }
  return n;
}

function hasBuilt(world: World, type: string): boolean {
  return world.buildings.some((b) => b.alive && b.built && b.owner === PLAYER && b.type === type);
}

/** Why `unit` cannot be queued at `b` right now (ignores cost), or undefined. */
export function trainBlockReason(world: World, b: Building, unit: PlayerUnitId): string | undefined {
  if (!b.alive || b.owner !== PLAYER) return 'Unavailable';
  if (!b.built) return 'Under construction';
  if (!(BUILDINGS[b.type].trains ?? []).includes(unit)) return 'Cannot train here';
  const p = world.players[PLAYER];
  if (!p.unlockedUnits.includes(unit)) return 'Not drafted';
  for (const req of UNITS[unit].requires ?? []) {
    if (!hasBuilt(world, req)) return TEXT.needs(`a ${BUILDINGS[req].name}`);
  }
  if (b.queue.length >= BUILD.queueSize) return TEXT.queueFull;
  return undefined;
}

/** Train at the shortest queue among buildingIds; count > 1 queues several. */
export function queueTraining(world: World, buildingIds: number[], unit: PlayerUnitId, count = 1): CommandResult {
  const p = world.players[PLAYER];
  const candidates = buildingIds
    .map((id) => getBuilding(world, id))
    .filter((b): b is Building => !!b && b.owner === PLAYER);
  if (candidates.length === 0) return fail('No building selected');
  let queued = 0;
  let lastReason: string | undefined;
  for (let i = 0; i < Math.max(1, count); i++) {
    let best: Building | null = null;
    for (const b of candidates) {
      const r = trainBlockReason(world, b, unit);
      if (r) {
        lastReason = r;
        continue;
      }
      if (!best || b.queue.length < best.queue.length) best = b;
    }
    if (!best) break;
    const cost = unitStats(world, PLAYER, unit).cost;
    const miss = missingReason(p, cost);
    if (miss) {
      lastReason = miss;
      break;
    }
    pay(p, cost);
    best.queue.push({ unit, progress: 0, total: 0, paid: { ...cost } });
    queued++;
  }
  return queued > 0 ? ok : fail(lastReason ?? 'Cannot train');
}

export function cancelTraining(world: World, buildingId: number, index: number): CommandResult {
  const b = getBuilding(world, buildingId);
  if (!b || b.owner !== PLAYER) return fail('No building selected');
  const item = b.queue[index];
  if (!item) return fail('Nothing to cancel');
  b.queue.splice(index, 1);
  refund(world.players[PLAYER], item.paid, BUILD.queueCancelRefund);
  if (index === 0) core(world).spawnRetry.delete(b.id);
  return ok;
}

/** Why research `id` cannot start at `b` (ignores cost), or undefined. */
export function researchBlockReason(world: World, b: Building, id: ResearchId): string | undefined {
  const def = RESEARCH[id];
  const p = world.players[PLAYER];
  if (!b.alive || b.owner !== PLAYER || b.type !== def.building) return 'Cannot research here';
  if (!b.built) return 'Under construction';
  if (p.researched.includes(id)) return 'Already researched';
  if (def.temper && p.temper && p.temper !== id) return `Temper chosen: ${RESEARCH[p.temper].name.replace('Temper: ', '')}`;
  for (const o of world.buildings) {
    if (o.alive && o.owner === PLAYER && o.research?.id === id) return o === b ? 'In progress' : 'In progress elsewhere';
  }
  if (b.research) return `Researching ${RESEARCH[b.research.id].name}`;
  return undefined;
}

export function startResearch(world: World, buildingId: number, id: ResearchId): CommandResult {
  const b = getBuilding(world, buildingId);
  if (!b) return fail('No building selected');
  const r = researchBlockReason(world, b, id);
  if (r) return fail(r);
  const p = world.players[PLAYER];
  const cost = researchCost(world, PLAYER, id);
  if (!canPay(p, cost)) return fail(missingReason(p, cost) ?? 'Cannot afford');
  pay(p, cost);
  b.research = { id, progress: 0, total: RESEARCH[id].time, paid: { ...cost } };
  if (RESEARCH[id].temper) p.temper = id;
  return ok;
}

export function cancelResearch(world: World, buildingId: number): CommandResult {
  const b = getBuilding(world, buildingId);
  if (!b || b.owner !== PLAYER) return fail('No building selected');
  if (!b.research) return fail('Nothing to cancel');
  const p = world.players[PLAYER];
  refund(p, b.research.paid, 1);
  if (RESEARCH[b.research.id].temper && p.temper === b.research.id) p.temper = null;
  b.research = null;
  return ok;
}

/** Re-apply composed max HP to live entities after effects changed (research). */
function refreshMaxHp(world: World): void {
  for (const u of world.units) {
    if (!u.alive || u.owner !== PLAYER) continue;
    const m = unitStats(world, PLAYER, u.type, u.rank).hp;
    if (m !== u.maxHp) {
      u.hp = Math.max(1, Math.min(m, u.hp + (m - u.maxHp)));
      u.maxHp = m;
    }
  }
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== PLAYER) continue;
    const m = buildingStats(world, PLAYER, b.type).hp;
    if (m !== b.maxHp) {
      b.hp = Math.max(1, Math.min(m, b.hp + (m - b.maxHp)));
      b.maxHp = m;
    }
  }
}

function completeResearch(world: World, b: Building): void {
  const r = b.research;
  if (!r) return;
  const p = world.players[PLAYER];
  b.research = null;
  if (!p.researched.includes(r.id)) p.researched.push(r.id);
  recomposeEffects(world, PLAYER);
  refreshMaxHp(world);
  emit(world, { t: 'researched', research: r.id, buildingId: b.id });
  alert(world, 'research_complete', { text: `${RESEARCH[r.id].name} complete.`, x: b.x, y: b.y, priority: 'low' });
}

/** Send a freshly trained unit to the building's rally point. */
function applyRally(world: World, b: Building, u: Unit): void {
  const r = b.rally;
  if (!r) return;
  if (u.type === 'tiller') {
    const t = r.targetId ? getEntity(world, r.targetId) : undefined;
    if (t && t.alive) {
      if (t.kind === 'resource' && resolveTarget(world, { kind: 'node', id: t.id })) {
        orderUnit(world, u, { type: 'gather', target: { kind: 'node', id: t.id } });
        return;
      }
      if (t.kind === 'building' && t.owner === PLAYER) {
        if (t.type === 'grainplot' && t.built) {
          orderUnit(world, u, { type: 'gather', target: { kind: 'plot', id: t.id } });
          return;
        }
        if (!t.built || t.hp < t.maxHp) {
          orderUnit(world, u, { type: 'build', buildingId: t.id });
          return;
        }
      }
    }
    if (r.tile !== undefined) {
      const tree = rallyTreeTarget(world, u, r.tile);
      if (tree) {
        orderUnit(world, u, { type: 'gather', target: tree });
        return;
      }
    }
  }
  orderUnit(world, u, { type: 'move', x: r.x, y: r.y });
}

function trySpawn(world: World, b: Building, item: TrainQueueItem): boolean {
  const c = core(world);
  const retry = c.spawnRetry.get(b.id);
  if (retry !== undefined && world.tick < retry) return false;
  const spot = findSpawnTile(world, b, POP.spawnSearchRadius, b.rally?.x, b.rally?.y);
  if (!spot) {
    c.spawnRetry.set(b.id, world.tick + ticks(POP.spawnRetryInterval));
    return false;
  }
  c.spawnRetry.delete(b.id);
  const u = spawnUnit(world, item.unit, PLAYER, spot.x, spot.y);
  u.facing = Math.atan2(spot.y - b.y, spot.x - b.x);
  world.players[PLAYER].stats.unitsTrained++;
  emit(world, { t: 'trained', id: u.id, type: item.unit, x: u.x, y: u.y });
  applyRally(world, b, u);
  return true;
}

export function stepProduction(world: World): void {
  const p = world.players[PLAYER];
  let reserved = reservedPop(world);
  for (const b of world.buildings) {
    if (!b.alive || !b.built || b.owner !== PLAYER) continue;
    const head = b.queue[0];
    if (head) {
      if (head.total === 0) {
        const need = UNITS[head.unit].pop;
        if (p.pop + reserved + need > p.popCap) {
          if (world.tick >= p.popAlertTick) {
            p.popAlertTick = world.tick + ticks(POP.alertInterval);
            alert(world, 'pop_capped', { x: b.x, y: b.y });
          }
        } else {
          head.total = Math.max(TICK_DT, unitStats(world, PLAYER, head.unit).trainTime);
          reserved += need;
        }
      }
      if (head.total > 0) {
        if (head.progress < head.total) head.progress = Math.min(head.total, head.progress + TICK_DT);
        if (head.progress >= head.total - 1e-9 && trySpawn(world, b, head)) {
          b.queue.shift();
          reserved -= UNITS[head.unit].pop;
        }
      }
    }
    if (b.research) {
      b.research.progress = Math.min(b.research.total, b.research.progress + TICK_DT);
      if (b.research.progress >= b.research.total - 1e-9) completeResearch(world, b);
    }
  }
}

export function setRally(world: World, buildingIds: number[], x: number, y: number, targetId?: number, tile?: number): CommandResult {
  let n = 0;
  for (const id of buildingIds) {
    const b = getBuilding(world, id);
    if (!b || b.owner !== PLAYER) continue;
    b.rally = { x, y };
    if (targetId) b.rally.targetId = targetId;
    if (tile !== undefined) b.rally.tile = tile;
    n++;
  }
  if (!n) return fail('No building selected');
  emit(world, { t: 'command', kind: 'rally', x, y, targetId });
  return ok;
}

/** Cancel a foundation (100% before work, 50% after) or demolish a building (queue/research refunded). */
export function demolish(world: World, buildingId: number): CommandResult {
  const b = getBuilding(world, buildingId);
  if (!b || b.owner !== PLAYER) return fail('No building selected');
  if (b.type === 'hearth') return fail('The Hearth cannot be demolished');
  const p = world.players[PLAYER];
  const c = core(world);
  if (!b.built) {
    const paid = c.foundationPaid.get(b.id) ?? buildingStats(world, PLAYER, b.type).cost;
    refund(p, paid, b.buildProgress > 0 ? BUILD.refundAfterWork : BUILD.refundBeforeWork);
    c.foundationPaid.delete(b.id);
  }
  for (const item of b.queue) refund(p, item.paid, 1);
  if (b.research) {
    refund(p, b.research.paid, 1);
    if (RESEARCH[b.research.id].temper && p.temper === b.research.id) p.temper = null;
  }
  b.queue.length = 0;
  b.research = null;
  killEntity(world, b, 0, { demolished: true });
  return ok;
}
