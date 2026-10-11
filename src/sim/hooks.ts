/**
 * Kill credit, veterancy and boon hooks (onKill, onHit, onStructureDestroyed). OWNER: sim-core.
 *
 * - Kill credit: the killing unit gains a kill; Rank I/II/III at 3/7/12 kills (+15% HP/ATK per rank,
 *   Rank III +1 armor). A rank-up raises current HP proportionally.
 * - Spoils of the Wake: +3 Grain +1 Ember per enemy unit killed by the player.
 * - Plunderers: +100 Grain/Timber/Ember (+10 Crowns, reported in the result) per Nest / Root Heart /
 *   Picket Thornspire destroyed.
 * - Raider's Bounty: +3 Grain per Courser hit on a Nest / Root Heart / Picket Thornspire.
 */
import { INCOME, rankForKills } from '../data/balance';
import { emit } from './alerts';
import { core } from './core';
import { addRes } from './players';
import { hasFlag, unitStats } from './stats';
import type { Building, Entity, Unit, World } from './types';
import { ENEMY, PLAYER } from './types';

/** Set a unit's rank, scaling current HP with the new max. */
export function setRank(world: World, u: Unit, rank: 0 | 1 | 2 | 3): void {
  if (rank === u.rank) return;
  const newMax = unitStats(world, u.owner, u.type, rank).hp;
  const ratio = u.maxHp > 0 ? u.hp / u.maxHp : 1;
  u.rank = rank;
  u.maxHp = newMax;
  u.hp = Math.min(newMax, Math.max(1, ratio * newMax));
  emit(world, { t: 'rankUp', id: u.id, rank, x: u.x, y: u.y });
}

export function creditKill(world: World, killer: Unit): void {
  killer.kills++;
  if (killer.owner !== PLAYER) return;
  const r = rankForKills(killer.kills);
  if (r > killer.rank) setRank(world, killer, r);
}

export function onUnitKilled(world: World, victim: Unit, killerId: number): void {
  const killer = killerId ? world.entities.get(killerId) : undefined;
  if (!killer || killer.owner === victim.owner) return;
  if (killer.kind === 'unit' && killer.alive) creditKill(world, killer);
  if (killer.owner === PLAYER && victim.owner === ENEMY) {
    const p = world.players[PLAYER];
    p.stats.kills++;
    if (hasFlag(world, PLAYER, 'spoils_of_the_wake')) addRes(p, INCOME.spoilsPerKill);
  }
}

/** Thornspire standing on a Picket anchor tile. */
export function isPicketSpire(world: World, b: Building): boolean {
  return b.type === 'thornspire' && core(world).picketTiles.has(b.ty * world.map.w + b.tx);
}

function isNestLike(b: Building): boolean {
  return b.type === 'thorn_nest' || b.type === 'root_heart';
}

export function onStructureDestroyed(world: World, b: Building, _killerId: number): void {
  if (b.owner !== ENEMY) return;
  const c = core(world);
  const nest = isNestLike(b);
  const picket = isPicketSpire(world, b);
  if (nest) c.nestsDestroyed++;
  if (picket) c.picketsDestroyed++;
  if ((nest || picket) && hasFlag(world, PLAYER, 'plunderers')) {
    addRes(world.players[PLAYER], INCOME.plunderersRes);
    c.plundererCrowns += INCOME.plunderersCrowns;
  }
}

/** Called for every landed attack hit (not burns / ability damage). */
export function onHit(world: World, attacker: Entity | undefined, target: Entity): void {
  if (!attacker || attacker.kind !== 'unit' || attacker.owner !== PLAYER) return;
  if (attacker.type !== 'courser' || target.kind !== 'building') return;
  if (!hasFlag(world, PLAYER, 'raiders_bounty')) return;
  if (isNestLike(target) || isPicketSpire(world, target)) {
    world.players[PLAYER].res.grain += INCOME.raidersBountyGrain;
  }
}
