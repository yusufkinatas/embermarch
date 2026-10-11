/**
 * Damage pipeline (GDD §G). OWNER: sim-core.
 *
 *   mult = bonus[attacker][target.class]   (1 vs hero/boss, except vsBoss e.g. Gatebreaker 1.5)
 *        × structMod(attacker)             (only vs structures)
 *        × resist[target][attackKind]
 *   raw  = (ATK + flat) × (1 + ΣatkPct) × (1 + 0.15·rank) × damageMul × mult × charge × spent
 *   dmg  = max(1, round(raw × 10 / (10 + armor)))
 *
 * Dynamic modifiers read from buffs (Buff.data keys): atkFlat, atkPct, damagePct, armor.
 * Banner of the Last Flame adds +15 atkPct to player units within 5 tiles of the Warden.
 */
import { BURN, COMBAT, SPENT, armorDamage } from '../data/balance';
import { FLAME_BANNER } from '../data/boons';
import { BUILDINGS } from '../data/buildings';
import { THUNDER_CHARGE } from '../data/research';
import { UNITS } from '../data/units';
import { ALERT_THROTTLE, alert, areaKey, emit, throttle } from './alerts';
import { buffSum, centerOf, core, hostile, pointRectDist, ticks, ucore } from './core';
import * as encounter from './encounter';
import { onHit } from './hooks';
import { killEntity } from './entities';
import { onTillerDamaged } from './economy';
import { lastStandAvailable, triggerLastStand } from './abilities';
import { buildingStats, hasFlag, unitStats } from './stats';
import { isEntitySeen, isEntityVisible } from './vision';
import type { Building, DamagePacket, Entity, Owner, Projectile, Unit, World } from './types';
import { PLAYER } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Current armor of an entity (composed + rank + buffs). */
export function armorOf(world: World, e: Entity): number {
  if (e.kind === 'unit') return unitStats(world, e.owner, e.type, e.rank).armor + buffSum(world, e, 'armor');
  if (e.kind === 'building') return buildingStats(world, e.owner, e.type).armor;
  return 0;
}

function isRangedUnit(u: Unit): boolean {
  return UNITS[u.type].range >= COMBAT.rangedThreshold;
}

/** Charge multiplier for this hit (1 if none). */
export function chargeMult(world: World, u: Unit, target: Entity): number {
  const def = UNITS[u.type];
  let mult = def.charge?.mult ?? 1;
  let minDist = def.charge?.minDist ?? THUNDER_CHARGE.courserMinDist;
  if (u.owner === PLAYER && hasFlag(world, u.owner, 'thunder_charge')) {
    if (u.type === 'courser') {
      mult = THUNDER_CHARGE.courserMult;
      minDist = THUNDER_CHARGE.courserMinDist;
    } else if (u.type === 'destrier') {
      mult = THUNDER_CHARGE.destrierMult;
    }
  }
  if (mult <= 1 || u.movedSinceAttack < minDist) return 1;
  if (target.kind === 'unit' && UNITS[target.type].negatesCharge) return 1;
  return mult;
}

function flameBannerPct(world: World, u: Unit): number {
  if (u.owner !== PLAYER || u.type === 'warden' || !hasFlag(world, PLAYER, 'flame_banner')) return 0;
  const w = world.wardenId ? world.entities.get(world.wardenId) : undefined;
  if (!w || !w.alive || w.kind !== 'unit') return 0;
  const dx = w.x - u.x;
  const dy = w.y - u.y;
  return dx * dx + dy * dy <= FLAME_BANNER.radius * FLAME_BANNER.radius ? FLAME_BANNER.atkPct / 100 : 0;
}

/** Counter multiplier (bonus × structMod × resist) of a unit attacker against a target. */
export function counterMult(world: World, attacker: Unit, target: Entity): number {
  const def = UNITS[attacker.type];
  const kind = isRangedUnit(attacker) ? 'ranged' : 'melee';
  let mult = 1;
  if (target.kind === 'unit') {
    const tcls = target.cls;
    if (tcls === 'boss') mult = def.vsBoss ?? 1;
    else if (tcls !== 'hero') mult = def.bonus[tcls] ?? 1;
    mult *= UNITS[target.type].resist?.[kind] ?? 1;
  } else if (target.kind === 'building') {
    mult = unitStats(world, attacker.owner, attacker.type, attacker.rank).structMod;
  }
  return mult;
}

/** Build the damage packet for attacker hitting target right now (counters, structMod, resist, charge, spent, rank...). */
export function computeDamagePacket(world: World, attacker: Entity, target: Entity): DamagePacket {
  const spent = target.kind === 'building' && target.nest?.spent ? SPENT.damageMult : 1;
  if (attacker.kind === 'building') {
    const atk = buildingStats(world, attacker.owner, attacker.type).attack;
    const resist = target.kind === 'unit' ? (UNITS[target.type].resist?.ranged ?? 1) : 1;
    return { raw: (atk?.dmg ?? 0) * resist * spent, mult: resist, attackKind: 'ranged', unitsOnly: true };
  }
  if (attacker.kind !== 'unit') return { raw: 0, mult: 1, attackKind: 'melee' };
  const u = attacker;
  const def = UNITS[u.type];
  const st = unitStats(world, u.owner, u.type, u.rank);
  const mult = counterMult(world, u, target);
  const flat = st.atkFlat + buffSum(world, u, 'atkFlat');
  const pct = st.atkPct + buffSum(world, u, 'atkPct') / 100 + flameBannerPct(world, u);
  const dmgMul = st.damageMul + buffSum(world, u, 'damagePct') / 100;
  const charge = chargeMult(world, u, target);
  const raw = Math.max(0, flat) * Math.max(0, 1 + pct) * st.rankMul * Math.max(0, dmgMul) * mult * charge * spent;
  const packet: DamagePacket = { raw, mult, attackKind: isRangedUnit(u) ? 'ranged' : 'melee' };
  let burn = def.burn;
  if (!burn && u.owner === PLAYER && (u.type === 'bowman' || u.type === 'outrider') && hasFlag(world, PLAYER, 'firebrand')) {
    burn = { dps: BURN.dps, duration: BURN.duration };
  }
  if (burn && !hasFlag(world, u.owner, 'burn_disabled')) packet.burn = { dps: burn.dps, duration: burn.duration };
  if (def.splash) packet.splash = { radius: def.splash.radius, edge: def.splash.edge };
  if (def.structuresOnly) packet.structuresOnly = true;
  return packet;
}

/** Can `attacker` legally attack `target` (owner, alive, targetable, structuresOnly/unitsOnly rules, visibility for player)? */
export function canAttack(world: World, attacker: Entity, target: Entity): boolean {
  if (!attacker.alive || !target.alive || target.kind === 'resource') return false;
  if (!hostile(attacker.owner, target.owner) || target.untargetable) return false;
  if (attacker.kind === 'building') return target.kind === 'unit' && !!BUILDINGS[attacker.type].attack;
  if (attacker.kind !== 'unit') return false;
  const def = UNITS[attacker.type];
  if (def.cooldown <= 0) return false;
  if (def.structuresOnly && target.kind === 'unit' && target.cls !== 'boss') return false;
  if (attacker.owner === PLAYER) {
    if (target.kind === 'unit' ? !isEntityVisible(world, target) : !isEntitySeen(world, target)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Damage application
// ---------------------------------------------------------------------------

interface DamageOpts {
  /** Emit a 'hit' event (attacks and ability damage; not burn ticks). */
  hitEvent: boolean;
  /** Counter multiplier for the popup (1 = none). */
  mult: number;
}

function popupFor(world: World, attackerId: number, mult: number): 'counter' | 'resisted' | null {
  if (Math.abs(mult - 1) < 1e-6) return null;
  const attacker = attackerId ? world.entities.get(attackerId) : undefined;
  if (attacker && attacker.kind === 'unit') {
    const uc = ucore(world, attacker);
    if (world.tick < uc.popupReadyTick) return null;
    uc.popupReadyTick = world.tick + ticks(COMBAT.popupThrottle);
  } else if (!throttle(world, `popup:${attackerId}`, COMBAT.popupThrottle)) {
    return null;
  }
  return mult > 1 ? 'counter' : 'resisted';
}

function underAttackAlerts(world: World, target: Entity, attacker: Entity | undefined): void {
  if (target.owner !== PLAYER || (attacker && !hostile(attacker.owner, PLAYER))) return;
  if (target.kind === 'unit' && target.type === 'tiller') {
    if (throttle(world, `tillers:${areaKey(target.x, target.y)}`, ALERT_THROTTLE.tillersAttacked)) {
      alert(world, 'tillers_attacked', { x: target.x, y: target.y });
    }
    return;
  }
  if (throttle(world, `attack:${areaKey(target.x, target.y)}`, ALERT_THROTTLE.underAttack)) {
    const hearth = target.kind === 'building' && target.type === 'hearth';
    alert(world, 'under_attack', {
      text: hearth ? 'The Hearth is under attack!' : undefined,
      x: target.x,
      y: target.y,
      priority: hearth ? 'high' : 'normal',
    });
  }
}

/** Shared HP reduction: hit event, bookkeeping, hooks, Last Stand interception, death. */
function damageEntity(world: World, target: Entity, amount: number, attackerId: number, opts: DamageOpts): number {
  if (!target.alive || target.kind === 'resource' || amount <= 0) return 0;
  if (target.invulnerable) return 0;
  if (world.debug.invulnerablePlayer && target.owner === PLAYER) return 0;
  const attacker = attackerId ? world.entities.get(attackerId) : undefined;
  target.hp -= amount;
  target.lastDamagedTick = world.tick;
  target.lastAttackerId = attackerId;
  if (opts.hitEvent) {
    emit(world, {
      t: 'hit',
      targetId: target.id,
      attackerId,
      x: target.x,
      y: target.y,
      damage: amount,
      mult: opts.mult,
      popup: popupFor(world, attackerId, opts.mult),
      targetOwner: target.owner,
      isStructure: target.kind === 'building',
    });
    onHit(world, attacker, target);
  }
  underAttackAlerts(world, target, attacker);
  if (target.kind === 'unit' && target.type === 'tiller' && target.owner === PLAYER) {
    onTillerDamaged(world, target, attackerId);
  }
  if (core(world).encounterOn) encounter.onEntityDamaged(world, target, attackerId, amount);
  if (target.hp <= 0 && target.alive) {
    if (target.kind === 'building' && target.id === world.hearthId && lastStandAvailable(world)) {
      triggerLastStand(world, target);
      return amount;
    }
    killEntity(world, target, attackerId);
  }
  return amount;
}

/** Splash targets: entities owned by the primary target's owner within radius of its center. */
function applySplash(world: World, attackerId: number, primary: Entity, packet: DamagePacket): void {
  const s = packet.splash;
  if (!s || s.radius <= 0) return;
  const c = centerOf(primary);
  const owner = primary.owner;
  const hits: Entity[] = [];
  if (!packet.structuresOnly) {
    for (const u of world.units) {
      if (u === primary || !u.alive || u.owner !== owner || u.untargetable) continue;
      const d = Math.hypot(u.x - c.x, u.y - c.y) - u.radius;
      if (d <= s.radius) hits.push(u);
    }
  }
  if (!packet.unitsOnly) {
    for (const b of world.buildings) {
      if (b === primary || !b.alive || b.owner !== owner || b.untargetable) continue;
      if (pointRectDist(c.x, c.y, b.tx, b.ty, b.w, b.h) <= s.radius) hits.push(b);
    }
  }
  for (const e of hits) {
    const d =
      e.kind === 'unit'
        ? Math.max(0, Math.hypot(e.x - c.x, e.y - c.y) - e.radius)
        : pointRectDist(c.x, c.y, (e as Building).tx, (e as Building).ty, (e as Building).w, (e as Building).h);
    const f = 1 - (1 - s.edge) * Math.min(1, d / s.radius);
    const dmg = armorDamage(packet.raw * f, armorOf(world, e));
    damageEntity(world, e, dmg, attackerId, { hitEvent: true, mult: 1 });
  }
}

/**
 * Apply a packet to a target: armor (dmg = max(1, round(raw*10/(10+armor)))), burn, splash,
 * hit event + popups, lastDamaged bookkeeping, encounter.onEntityDamaged, death via killEntity.
 * Returns damage dealt to the primary target.
 */
export function applyPacket(world: World, attackerId: number, target: Entity, packet: DamagePacket): number {
  if (!target.alive || target.kind === 'resource') return 0;
  if (packet.unitsOnly && target.kind !== 'unit') return 0;
  if (packet.structuresOnly && target.kind === 'unit' && target.cls !== 'boss') return 0;
  const dmg = armorDamage(packet.raw, armorOf(world, target));
  const dealt = damageEntity(world, target, dmg, attackerId, { hitEvent: true, mult: packet.mult });
  if (packet.burn && target.kind === 'unit' && target.alive) {
    applyBurn(world, target, attackerId, packet.burn.dps, packet.burn.duration);
  }
  applySplash(world, attackerId, target, packet);
  return dealt;
}

/**
 * Ability / scripted damage (boss abilities, Last Stand, Firepot impact). Armor applies; counters do not.
 * Returns damage dealt.
 */
export function dealAbilityDamage(world: World, target: Entity, raw: number, sourceId: number): number {
  if (!target.alive || target.kind === 'resource') return 0;
  return damageEntity(world, target, armorDamage(raw, armorOf(world, target)), sourceId, { hitEvent: true, mult: 1 });
}

/** True damage that ignores armor (burn ticks, wither). */
export function dealTrueDamage(world: World, target: Entity, amount: number, sourceId: number): number {
  return damageEntity(world, target, amount, sourceId, { hitEvent: false, mult: 1 });
}

function burnDisabled(world: World, a: Owner, b: Owner): boolean {
  return hasFlag(world, a, 'burn_disabled') || hasFlag(world, b, 'burn_disabled');
}

/** Add/refresh a burn instance (max 3 appliers per target). Units only. */
export function applyBurn(world: World, target: Unit, applierId: number, dps: number, duration: number): void {
  if (target.kind !== 'unit' || !target.alive || dps <= 0 || duration <= 0) return;
  const applier = applierId ? world.entities.get(applierId) : undefined;
  if (burnDisabled(world, target.owner, applier ? applier.owner : target.owner)) return;
  const own = target.burns.find((b) => b.applierId === applierId);
  if (own) {
    own.remaining = Math.max(own.remaining, duration);
    own.dps = Math.max(own.dps, dps);
  } else if (target.burns.length < BURN.maxInstances) {
    target.burns.push({ applierId, dps, remaining: duration });
  } else {
    let weakest = target.burns[0];
    for (const b of target.burns) if (b.remaining < weakest.remaining) weakest = b;
    if (weakest.remaining >= duration) return;
    weakest.applierId = applierId;
    weakest.dps = dps;
    weakest.remaining = duration;
  }
  emit(world, { t: 'burn', id: target.id });
}

// ---------------------------------------------------------------------------
// Ground impacts (Firepot)
// ---------------------------------------------------------------------------

/** Ground-targeted impact: ability damage (armor applies) with falloff + burn on units, to entities hostile to `owner`. */
export function groundImpact(world: World, p: Projectile): void {
  const s = p.packet.splash ?? { radius: 0.5, edge: 1 };
  const hits: Entity[] = [];
  for (const u of world.units) {
    if (!u.alive || !hostile(p.owner, u.owner) || u.untargetable) continue;
    if (Math.hypot(u.x - p.tx, u.y - p.ty) - u.radius <= s.radius) hits.push(u);
  }
  if (!p.packet.unitsOnly) {
    for (const b of world.buildings) {
      if (!b.alive || !hostile(p.owner, b.owner) || b.untargetable) continue;
      if (pointRectDist(p.tx, p.ty, b.tx, b.ty, b.w, b.h) <= s.radius) hits.push(b);
    }
  }
  for (const e of hits) {
    const d =
      e.kind === 'unit'
        ? Math.max(0, Math.hypot(e.x - p.tx, e.y - p.ty) - e.radius)
        : pointRectDist(p.tx, p.ty, (e as Building).tx, (e as Building).ty, (e as Building).w, (e as Building).h);
    const f = 1 - (1 - s.edge) * Math.min(1, d / Math.max(1e-6, s.radius));
    dealAbilityDamage(world, e, p.packet.raw * f, p.sourceId);
    if (p.packet.burn && e.kind === 'unit' && e.alive) {
      applyBurn(world, e, p.sourceId, p.packet.burn.dps, p.packet.burn.duration);
    }
  }
}
