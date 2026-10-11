/**
 * Per-tick unit status: buff expiry (Rally the Hearth restore), burn ticks, regeneration
 * (Field Surgeons, Lampbearer / Gloamwitch auras, Hearth of the Last Flame) and the speed the
 * movement system uses (composed speed × buffs; 0 while rooted). OWNER: sim-core.
 *
 * Buff.data keys understood by sim-core (encounter may use them too):
 *   atkFlat, atkPct, damagePct, armor, speedPct, attackSpeedPct, cooldownPct, gatherPct.
 * Buff id 'rooted' sets speed to 0 (attacks still allowed).
 */
import { FIELD_SURGEONS, FLAME_HEARTH_REGEN } from '../data/boons';
import { UNITS } from '../data/units';
import { emit } from './alerts';
import { dealTrueDamage } from './combat';
import { buffSum, isMilitaryClass, ticks, ucore } from './core';
import { onRallyEnded } from './abilities';
import { queryUnits } from './nav/spatial';
import { hasFlag, unitStats } from './stats';
import type { Unit, World } from './types';
import { PLAYER, TICK_DT } from './types';

/** Heal accumulated before a 'heal' event is emitted. */
const HEAL_EVENT_AMOUNT = 4;

function heal(world: World, u: Unit, amount: number): void {
  if (amount <= 0 || u.hp >= u.maxHp) return;
  const before = u.hp;
  u.hp = Math.min(u.maxHp, u.hp + amount);
  const uc = ucore(world, u);
  uc.healAcc += u.hp - before;
  if (uc.healAcc >= HEAL_EVENT_AMOUNT) {
    emit(world, { t: 'heal', id: u.id, amount: Math.round(uc.healAcc) });
    uc.healAcc = 0;
  }
}

/** Aura heal rate (HP/s) per unit id for this tick, stacks capped by maxStacks. */
function auraStacks(world: World): Map<number, { n: number; rate: number }> {
  const stacks = new Map<number, { n: number; rate: number }>();
  for (const a of world.units) {
    if (!a.alive) continue;
    const aura = UNITS[a.type].aura;
    if (!aura) continue;
    const near = queryUnits(world, a.x, a.y, aura.radius, (o) => o.alive && o.owner === a.owner);
    for (const o of near) {
      // Lampbearers heal non-siege allies; the Gloamwitch regenerates all Thornwake.
      if (a.owner === PLAYER && o.cls === 'siege') continue;
      const cur = stacks.get(o.id);
      if (!cur) stacks.set(o.id, { n: 1, rate: aura.hps });
      else if (cur.n < aura.maxStacks) {
        cur.n++;
        cur.rate += aura.hps;
      }
    }
  }
  return stacks;
}

function expireBuffs(world: World, u: Unit): void {
  if (u.buffs.length === 0) return;
  let rallyEnded = false;
  const keep = [];
  for (const b of u.buffs) {
    if (b.until > world.tick) keep.push(b);
    else if (b.id === 'rally_hearth') rallyEnded = true;
  }
  if (keep.length !== u.buffs.length) u.buffs = keep;
  if (rallyEnded) onRallyEnded(world, u);
}

function tickBurns(world: World, u: Unit): void {
  if (u.burns.length === 0) return;
  for (const b of u.burns) {
    const dt = Math.min(TICK_DT, b.remaining);
    b.remaining -= TICK_DT;
    if (dt > 0 && u.alive) dealTrueDamage(world, u, b.dps * dt, b.applierId);
  }
  if (u.alive) u.burns = u.burns.filter((b) => b.remaining > 1e-9);
  else u.burns.length = 0;
}

/** Composed speed × buff multipliers; 0 while rooted. Set every tick before movement. */
export function refreshSpeed(world: World, u: Unit): void {
  const base = unitStats(world, u.owner, u.type, u.rank).speed;
  let rooted = false;
  for (const b of u.buffs) if (b.id === 'rooted' && b.until > world.tick) rooted = true;
  u.speed = rooted ? 0 : Math.max(0, base * (1 + buffSum(world, u, 'speedPct') / 100));
}

export function stepStatus(world: World): void {
  const stacks = auraStacks(world);
  const surgeons = hasFlag(world, PLAYER, 'field_surgeons');
  const surgeonDelay = ticks(FIELD_SURGEONS.delay);
  for (const u of world.units) {
    if (!u.alive) continue;
    expireBuffs(world, u);
    tickBurns(world, u);
    if (!u.alive) continue;
    const aura = stacks.get(u.id);
    if (aura) heal(world, u, aura.rate * TICK_DT);
    if (
      surgeons &&
      u.owner === PLAYER &&
      isMilitaryClass(u.cls) &&
      u.cls !== 'siege' &&
      (u.lastDamagedTick < 0 || world.tick - u.lastDamagedTick >= surgeonDelay)
    ) {
      heal(world, u, FIELD_SURGEONS.hps * TICK_DT);
    }
    refreshSpeed(world, u);
  }
  // Hearth of the Last Flame: the Hearth regenerates.
  if (world.hearthId && hasFlag(world, PLAYER, 'flame_hearth')) {
    const h = world.entities.get(world.hearthId);
    if (h && h.alive && h.hp < h.maxHp) h.hp = Math.min(h.maxHp, h.hp + FLAME_HEARTH_REGEN * TICK_DT);
  }
}
