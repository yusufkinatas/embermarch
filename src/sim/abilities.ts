/**
 * Warden abilities (GDD §N): House ability on Q (Rallying Horn, Harvest Hymn, Firepot, Ember Volley),
 * Hawk on W (flag hawk), Second Wind cooldowns, Warden respawn at the Hearth; Rally the Hearth (§E);
 * Last Stand (§B, boss battle only). OWNER: sim-core.
 */
import { ABILITIES, LAST_STAND, RALLY_HEARTH, WARDEN } from '../data/balance';
import { HOUSES } from '../data/houses';
import { alert, emit } from './alerts';
import { dealAbilityDamage } from './combat';
import { addBuff, centerOf, core, hasBuff, pointRectDist, ticks, ucore } from './core';
import { restoreSaved } from './economy';
import { getBuilding, spawnUnit } from './entities';
import { releaseClaim } from './claims';
import { startOrder } from './orders';
import { displaceUnit } from './nav/movement';
import { findSpawnTile } from './placement';
import { spawnProjectile } from './projectiles';
import { hasFlag } from './stats';
import type { Building, CommandResult, Unit, World } from './types';
import { ENEMY, PLAYER } from './types';

const ok: CommandResult = { ok: true };
function fail(reason: string): CommandResult {
  return { ok: false, reason };
}

function cdMul(world: World): number {
  return hasFlag(world, PLAYER, 'second_wind') ? 1 + WARDEN.secondWindCooldownPct / 100 : 1;
}

/** Full cooldown (s) of a Warden ability slot after Second Wind. */
export function abilityCooldown(world: World, slot: 'Q' | 'W'): number {
  const base = slot === 'Q' ? HOUSES[world.setup.house].abilityCooldown : ABILITIES.hawk.cooldown;
  return base * cdMul(world);
}

export function warden(world: World): Unit | undefined {
  const w = world.wardenId ? world.entities.get(world.wardenId) : undefined;
  return w && w.alive && w.kind === 'unit' ? w : undefined;
}

function playerUnitsNear(world: World, x: number, y: number, r: number, pred: (u: Unit) => boolean): Unit[] {
  const out: Unit[] = [];
  for (const u of world.units) {
    if (!u.alive || u.owner !== PLAYER || !pred(u)) continue;
    if (Math.hypot(u.x - x, u.y - y) <= r) out.push(u);
  }
  return out;
}

/** Warden ability. Q = House ability, W = Hawk. Point-targeted abilities pass x/y. */
export function useAbility(world: World, slot: 'Q' | 'W', x?: number, y?: number): CommandResult {
  const p = world.players[PLAYER];
  const w = warden(world);
  if (!w) return fail('The Warden has fallen');
  if (world.tick < p.abilityReadyTick[slot]) {
    return fail(`Ready in ${Math.ceil((p.abilityReadyTick[slot] - world.tick) / 20)} s`);
  }
  if (slot === 'W') {
    if (!hasFlag(world, PLAYER, 'hawk')) return fail('Hawk is not unlocked');
    if (x === undefined || y === undefined) return fail('Choose a point');
    const hx = Math.max(0, Math.min(world.map.w, x));
    const hy = Math.max(0, Math.min(world.map.h, y));
    world.vision.push({ x: hx, y: hy, r: ABILITIES.hawk.radius, until: world.tick + ticks(ABILITIES.hawk.duration), tag: 'hawk' });
    p.abilityReadyTick.W = world.tick + ticks(abilityCooldown(world, 'W'));
    emit(world, { t: 'ability', name: 'hawk', x: hx, y: hy, radius: ABILITIES.hawk.radius, owner: PLAYER });
    return ok;
  }
  const house = world.setup.house;
  if (house === 'ardent') {
    const a = ABILITIES.rallyingHorn;
    const until = world.tick + ticks(a.duration);
    for (const u of playerUnitsNear(world, w.x, w.y, a.radius, () => true)) {
      addBuff(u, 'rallying_horn', until, { attackSpeedPct: a.attackSpeedPct, speedPct: a.moveSpeedPct });
    }
    emit(world, { t: 'ability', name: 'rallying_horn', x: w.x, y: w.y, radius: a.radius, owner: PLAYER });
  } else if (house === 'tallow') {
    const a = ABILITIES.harvestHymn;
    const until = world.tick + ticks(a.duration);
    for (const u of playerUnitsNear(world, w.x, w.y, a.radius, (o) => o.type === 'tiller')) {
      addBuff(u, 'harvest_hymn', until, { gatherPct: a.gatherPct });
    }
    emit(world, { t: 'ability', name: 'harvest_hymn', x: w.x, y: w.y, radius: a.radius, owner: PLAYER });
  } else if (house === 'grimbrand') {
    const a = ABILITIES.firepot;
    if (x === undefined || y === undefined) return fail('Choose a target');
    if (Math.hypot(x - w.x, y - w.y) > a.range + 1e-6) return fail('Out of range');
    spawnProjectile(
      world,
      'firepot',
      w,
      null,
      x,
      y,
      {
        raw: a.damage,
        mult: 1,
        attackKind: 'ranged',
        splash: { radius: a.radius, edge: 1 },
        burn: hasFlag(world, PLAYER, 'burn_disabled') ? undefined : { dps: a.burnDps, duration: a.burnDuration },
      },
      a.flightTime,
    );
    w.facing = Math.atan2(y - w.y, x - w.x);
    w.lastAttackTick = world.tick;
    emit(world, { t: 'ability', name: 'firepot', x, y, radius: a.radius, owner: PLAYER });
  } else {
    const a = ABILITIES.emberVolley;
    core(world).emberVolleyUntil = world.tick + ticks(a.duration);
    const h = world.hearthId ? getBuilding(world, world.hearthId) : undefined;
    emit(world, { t: 'ability', name: 'ember_volley', x: h?.x ?? w.x, y: h?.y ?? w.y, radius: 0, owner: PLAYER });
  }
  p.abilityReadyTick.Q = world.tick + ticks(abilityCooldown(world, 'Q'));
  return ok;
}

// ---------------------------------------------------------------------------
// Rally the Hearth
// ---------------------------------------------------------------------------

export function rallyHearthTimes(world: World): { cooldown: number; duration: number } {
  const watch = hasFlag(world, PLAYER, 'hearth_watch');
  return {
    cooldown: watch ? RALLY_HEARTH.watchCooldown : RALLY_HEARTH.cooldown,
    duration: watch ? RALLY_HEARTH.watchDuration : RALLY_HEARTH.duration,
  };
}

/** V: Tillers within 8 tiles of the Hearth drop their loads, get +2 ATK/+1 armor and fight within 5 tiles. */
export function rallyHearth(world: World, free = false): CommandResult {
  const h = world.hearthId ? getBuilding(world, world.hearthId) : undefined;
  if (!h) return fail('The Hearth has fallen');
  const p = world.players[PLAYER];
  if (!free && world.tick < p.rallyReadyTick) {
    return fail(`Rally the Hearth ready in ${Math.ceil((p.rallyReadyTick - world.tick) / 20)} s`);
  }
  const { cooldown, duration } = rallyHearthTimes(world);
  if (!free) p.rallyReadyTick = world.tick + ticks(cooldown);
  const until = world.tick + ticks(duration);
  p.rallyUntilTick = Math.max(p.rallyUntilTick, until);
  for (const u of world.units) {
    if (!u.alive || u.owner !== PLAYER || u.type !== 'tiller') continue;
    if (pointRectDist(u.x, u.y, h.tx, h.ty, h.w, h.h) > RALLY_HEARTH.radius) continue;
    const uc = ucore(world, u);
    if (!hasBuff(world, u, 'rally_hearth')) {
      // A fleeing Tiller keeps the order it had before it fled.
      if (u.order.type !== 'flee') {
        uc.savedOrder = u.order.type === 'idle' || u.order.type === 'hold' ? null : u.order;
        uc.savedQueue = u.queue.length ? [...u.queue] : null;
      }
      u.queue.length = 0;
      u.carry = null;
      releaseClaim(world, u);
      startOrder(world, u, { type: 'idle' });
    }
    addBuff(u, 'rally_hearth', until, { atkFlat: RALLY_HEARTH.atk, armor: RALLY_HEARTH.armor });
  }
  emit(world, { t: 'ability', name: 'rally_hearth', x: h.x, y: h.y, radius: RALLY_HEARTH.radius, owner: PLAYER });
  return ok;
}

/** Called when a Tiller's rally buff expires: resume the saved job. */
export function onRallyEnded(world: World, u: Unit): void {
  if (!u.alive) return;
  if (u.order.type !== 'idle') return;
  u.targetId = 0;
  restoreSaved(world, u);
}

// ---------------------------------------------------------------------------
// Last Stand
// ---------------------------------------------------------------------------

export function lastStandAvailable(world: World): boolean {
  const boss = world.setup.isBoss || world.setup.objective === 'boss';
  return boss && world.setup.resolve - world.lastStandsUsed >= LAST_STAND.resolveCost;
}

/** The Hearth would fall: spend 1 Resolve, restore it to 40% HP, invulnerable 5 s, blast enemies, free Rally. */
export function triggerLastStand(world: World, h: Building): void {
  world.lastStandsUsed += LAST_STAND.resolveCost;
  h.hp = Math.max(1, Math.round(h.maxHp * LAST_STAND.hearthHpPct));
  h.invulnerable = true;
  core(world).hearthInvulnUntil = world.tick + ticks(LAST_STAND.invulnerableTime);
  const c = centerOf(h);
  const victims = world.units.filter(
    (u) => u.alive && u.owner === ENEMY && pointRectDist(u.x, u.y, h.tx, h.ty, h.w, h.h) - u.radius <= LAST_STAND.radius,
  );
  for (const u of victims) {
    dealAbilityDamage(world, u, LAST_STAND.damage, h.id);
    if (!u.alive) continue;
    let dx = u.x - c.x;
    let dy = u.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    dx = (dx / len) * LAST_STAND.knockback;
    dy = (dy / len) * LAST_STAND.knockback;
    displaceUnit(world, u, dx, dy);
    emit(world, { t: 'knockback', id: u.id });
  }
  rallyHearth(world, true);
  emit(world, { t: 'lastStand', x: c.x, y: c.y });
  emit(world, { t: 'shake', magnitude: 8, duration: 0.5 });
  emit(world, { t: 'slowmo', factor: 0.5, duration: 0.6 });
  alert(world, 'last_stand', { x: c.x, y: c.y, priority: 'high' });
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

export function stepAbilities(world: World): void {
  const p = world.players[PLAYER];
  const c = core(world);
  // Hawk (and other timed) vision sources expire.
  if (world.vision.length) {
    const keep = world.vision.filter((v) => v.until < 0 || v.until > world.tick);
    if (keep.length !== world.vision.length) world.vision = keep;
  }
  // Last Stand invulnerability window.
  if (c.hearthInvulnUntil && world.tick >= c.hearthInvulnUntil) {
    c.hearthInvulnUntil = 0;
    const h = world.hearthId ? getBuilding(world, world.hearthId) : undefined;
    if (h) h.invulnerable = false;
  }
  // Warden respawn at the Hearth.
  if (p.wardenRespawnTick >= 0 && world.tick >= p.wardenRespawnTick && !world.wardenId) {
    const h = world.hearthId ? getBuilding(world, world.hearthId) : undefined;
    if (!h) return;
    const spot = findSpawnTile(world, h, 6);
    if (!spot) {
      p.wardenRespawnTick = world.tick + ticks(1);
      return;
    }
    const w = spawnUnit(world, 'warden', PLAYER, spot.x, spot.y);
    p.wardenRespawnTick = -1;
    alert(world, 'warden_returned', { x: w.x, y: w.y });
  }
}
