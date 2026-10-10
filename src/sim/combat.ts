/**
 * Damage pipeline (GDD §G). OWNER: sim-core.
 */
import type { DamagePacket, Entity, Unit, World } from './types';

/** Build the damage packet for attacker hitting target right now (counters, structMod, resist, charge, spent, rank...). */
export function computeDamagePacket(world: World, attacker: Entity, target: Entity): DamagePacket {
  throw new Error('not implemented');
}

/**
 * Apply a packet to a target: armor (dmg = max(1, round(raw*10/(10+armor)))), burn, splash,
 * hit event + popups, lastDamaged bookkeeping, encounter.onEntityDamaged, death via killEntity.
 * Returns damage dealt to the primary target.
 */
export function applyPacket(world: World, attackerId: number, target: Entity, packet: DamagePacket): number {
  throw new Error('not implemented');
}

/**
 * Ability / scripted damage (boss abilities, Last Stand, Firepot impact). Armor applies; counters do not.
 * Returns damage dealt.
 */
export function dealAbilityDamage(world: World, target: Entity, raw: number, sourceId: number): number {
  throw new Error('not implemented');
}

/** True damage that ignores armor (burn ticks, wither). */
export function dealTrueDamage(world: World, target: Entity, amount: number, sourceId: number): number {
  throw new Error('not implemented');
}

/** Add/refresh a burn instance (max 3 appliers per target). Units only. */
export function applyBurn(world: World, target: Unit, applierId: number, dps: number, duration: number): void {
  throw new Error('not implemented');
}

/** Can `attacker` legally attack `target` (owner, alive, targetable, structuresOnly/unitsOnly rules, visibility for player)? */
export function canAttack(world: World, attacker: Entity, target: Entity): boolean {
  throw new Error('not implemented');
}
