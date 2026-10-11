/**
 * Projectiles (GDD §G): homing arrows (12 t/s), bolts (14), spines (10); ground-targeted Firepot
 * with a fixed flight time. Damage packets are computed at fire time and applied on impact.
 * OWNER: sim-core.
 */
import { PROJECTILE_SPEED, armorDamage } from '../data/balance';
import { applyPacket, armorOf, groundImpact } from './combat';
import { centerOf, core, pointRectDist } from './core';
import type { DamagePacket, Entity, Projectile, ProjectileKind, World } from './types';
import { TICK_DT } from './types';

/** Safety lifetime (s) for projectiles chasing a vanished target. */
const MAX_LIFETIME = 5;

export function spawnProjectile(
  world: World,
  kind: ProjectileKind,
  source: Entity,
  target: Entity | null,
  gx: number,
  gy: number,
  packet: DamagePacket,
  flightTime?: number,
): Projectile {
  const c = centerOf(source);
  const id = world.nextId++;
  let speed = PROJECTILE_SPEED[kind];
  if (flightTime !== undefined && flightTime > 0) {
    speed = Math.max(0.5, Math.hypot(gx - c.x, gy - c.y) / flightTime);
  }
  const p: Projectile = {
    id,
    kind,
    sourceId: source.id,
    owner: source.owner,
    x: c.x,
    y: c.y,
    prevX: c.x,
    prevY: c.y,
    startX: c.x,
    startY: c.y,
    targetId: target ? target.id : 0,
    tx: target ? target.x : gx,
    ty: target ? target.y : gy,
    speed,
    packet,
    alive: true,
  };
  world.projectiles.push(p);
  if (target) {
    const est = armorDamage(packet.raw, armorOf(world, target));
    const c = core(world);
    c.projectileDamage.set(id, est);
    c.pendingDamage.set(target.id, (c.pendingDamage.get(target.id) ?? 0) + est);
  }
  return p;
}

/** A homing projectile landed or lost its target: drop its pending damage. */
function settle(world: World, p: Projectile, targetId: number): void {
  const c = core(world);
  const est = c.projectileDamage.get(p.id);
  if (est === undefined) return;
  c.projectileDamage.delete(p.id);
  const left = (c.pendingDamage.get(targetId) ?? 0) - est;
  if (left > 1e-6) c.pendingDamage.set(targetId, left);
  else c.pendingDamage.delete(targetId);
}

/** Distance from (x, y) to the hittable surface of an entity. */
function surfaceDist(e: Entity, x: number, y: number): number {
  if (e.kind === 'unit') return Math.max(0, Math.hypot(e.x - x, e.y - y) - e.radius);
  return pointRectDist(x, y, e.tx, e.ty, e.w, e.h);
}

export function stepProjectiles(world: World): void {
  for (const p of world.projectiles) {
    if (!p.alive) continue;
    const step = p.speed * TICK_DT;
    if (p.targetId) {
      const t = world.entities.get(p.targetId);
      if (t && t.alive) {
        p.tx = t.x;
        p.ty = t.y;
        const d = surfaceDist(t, p.x, p.y);
        if (d <= step) {
          const toC = Math.hypot(t.x - p.x, t.y - p.y);
          const k = toC > 1e-6 ? Math.min(1, d / toC) : 0;
          p.x += (t.x - p.x) * k;
          p.y += (t.y - p.y) * k;
          p.alive = false;
          settle(world, p, t.id);
          applyPacket(world, p.sourceId, t, p.packet);
          continue;
        }
      } else {
        // Target gone: fly on to its last known position and fizzle.
        settle(world, p, p.targetId);
        p.targetId = 0;
        p.packet = { ...p.packet, raw: 0 };
      }
    }
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= step) {
      p.x = p.tx;
      p.y = p.ty;
      p.alive = false;
      if (p.kind === 'firepot') groundImpact(world, p);
      continue;
    }
    p.x += (dx / dist) * step;
    p.y += (dy / dist) * step;
    if (Math.hypot(p.x - p.startX, p.y - p.startY) > p.speed * MAX_LIFETIME) {
      p.alive = false;
      if (p.targetId) settle(world, p, p.targetId);
    }
  }
}
