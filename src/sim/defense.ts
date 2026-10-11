/**
 * Building defensive fire (GDD §E, §I): Hearth, Brazier Towers and Thornspires fire homing bolts /
 * spines at hostile UNITS only (never structures), `volley` projectiles per shot at distinct targets
 * when available. Ember Volley adds +2 bolts to the Hearth and towers (max 5 Hearth, 3 tower).
 * OWNER: sim-core.
 */
import { ABILITIES } from '../data/balance';
import { BUILDINGS } from '../data/buildings';
import { emit } from './alerts';
import { computeDamagePacket } from './combat';
import { core, doomed, hostile, pointRectDist } from './core';
import { queryUnits } from './nav/spatial';
import { spawnProjectile } from './projectiles';
import { buildingStats } from './stats';
import type { Building, Unit, World } from './types';
import { PLAYER, TICK_DT } from './types';

function volleyCount(world: World, b: Building, base: number): number {
  if (b.owner !== PLAYER || world.tick >= core(world).emberVolleyUntil) return base;
  if (b.type === 'hearth') return Math.min(ABILITIES.emberVolley.maxHearthBolts, base + ABILITIES.emberVolley.extraBolts);
  if (b.type === 'brazier_tower') return Math.min(ABILITIES.emberVolley.maxTowerBolts, base + ABILITIES.emberVolley.extraBolts);
  return base;
}

function edgeDist(b: Building, u: Unit): number {
  return Math.max(0, pointRectDist(u.x, u.y, b.tx, b.ty, b.w, b.h) - u.radius);
}

export function stepDefense(world: World): void {
  for (const b of world.buildings) {
    if (!b.alive || !b.built) continue;
    const def = BUILDINGS[b.type];
    if (!def.attack) continue;
    if (b.attackCooldown > 0) b.attackCooldown = Math.max(0, b.attackCooldown - TICK_DT);
    if (b.attackCooldown > 0) continue;
    const atk = buildingStats(world, b.owner, b.type).attack;
    if (!atk) continue;
    const reach = atk.range + Math.max(b.w, b.h) * 0.75 + 1.5;
    const cands = queryUnits(
      world,
      b.x,
      b.y,
      reach,
      (u) => u.alive && !u.untargetable && hostile(b.owner, u.owner) && edgeDist(b, u) <= atk.range,
    );
    if (cands.length === 0) {
      b.targetId = 0;
      continue;
    }
    // Targets not already doomed by bolts in flight first; then the current target; then nearest.
    cands.sort((a, c) => {
      const da = doomed(world, a) ? 1 : 0;
      const dc = doomed(world, c) ? 1 : 0;
      if (da !== dc) return da - dc;
      if (a.id === b.targetId) return -1;
      if (c.id === b.targetId) return 1;
      return edgeDist(b, a) - edgeDist(b, c) || a.id - c.id;
    });
    const n = volleyCount(world, b, atk.volley);
    for (let i = 0; i < n; i++) {
      const t = cands[i % cands.length];
      spawnProjectile(world, def.attack.projectile, b, t, t.x, t.y, computeDamagePacket(world, b, t));
    }
    const first = cands[0];
    b.targetId = first.id;
    b.lastAttackTick = world.tick;
    b.attackCooldown = atk.cooldown;
    emit(world, {
      t: 'attack',
      attackerId: b.id,
      targetId: first.id,
      x: b.x,
      y: b.y,
      tx: first.x,
      ty: first.y,
      ranged: true,
      projectile: def.attack.projectile,
      unitType: b.type,
    });
  }
}
