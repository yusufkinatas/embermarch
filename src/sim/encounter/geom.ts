/**
 * Small geometry and world-query helpers private to the encounter module.
 * (Edge distances mirror nav/geometry semantics: unit radius for units, footprint rect otherwise.)
 */
import { PLAYER, Terrain, type Building, type Entity, type Unit, type World } from '../types';

export function centerOf(e: Entity): { x: number; y: number } {
  if (e.kind === 'unit') return { x: e.x, y: e.y };
  return { x: e.tx + e.w / 2, y: e.ty + e.h / 2 };
}

/** Distance from a point to an entity's edge (0 inside). */
export function distToEntity(x: number, y: number, e: Entity): number {
  if (e.kind === 'unit') return Math.max(0, Math.hypot(e.x - x, e.y - y) - e.radius);
  const cx = x < e.tx ? e.tx : x > e.tx + e.w ? e.tx + e.w : x;
  const cy = y < e.ty ? e.ty : y > e.ty + e.h ? e.ty + e.h : y;
  return Math.hypot(x - cx, y - cy);
}

/** Edge-to-edge distance from a unit to an entity. */
export function unitEdgeDist(u: Unit, e: Entity): number {
  return Math.max(0, distToEntity(u.x, u.y, e) - u.radius);
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Distance from point P to segment AB, and the projection parameter t in [0, 1]. */
export function pointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(px - (ax + vx * t), py - (ay + vy * t)), t };
}

export function isPlayerTarget(e: Entity | undefined): e is Entity {
  return !!e && e.alive && e.owner === PLAYER && !e.untargetable && e.kind !== 'resource';
}

export function liveEntity(world: World, id: number): Entity | undefined {
  if (!id) return undefined;
  const e = world.entities.get(id);
  return e && e.alive ? e : undefined;
}

export function liveUnit(world: World, id: number): Unit | undefined {
  const e = liveEntity(world, id);
  return e && e.kind === 'unit' ? e : undefined;
}

export function liveBuilding(world: World, id: number): Building | undefined {
  const e = liveEntity(world, id);
  return e && e.kind === 'building' ? e : undefined;
}

export function hearth(world: World): Building | undefined {
  return liveBuilding(world, world.hearthId);
}

export function tileIndex(world: World, x: number, y: number): number {
  const tx = Math.max(0, Math.min(world.map.w - 1, Math.floor(x)));
  const ty = Math.max(0, Math.min(world.map.h - 1, Math.floor(y)));
  return ty * world.map.w + tx;
}

export function isWalkableTile(world: World, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= world.map.w || ty >= world.map.h) return false;
  const i = ty * world.map.w + tx;
  if (world.grid && world.grid.blocked) return world.grid.blocked[i] === 0;
  const t = world.map.terrain[i];
  return t === Terrain.Grass || t === Terrain.Shallows || t === Terrain.Stump;
}

/** Is a (non-player) point visible to the player right now? */
export function isPointVisible(world: World, x: number, y: number): boolean {
  if (world.debug?.revealAll) return true;
  const fog = world.fog?.state;
  if (!fog) return false;
  return fog[tileIndex(world, x, y)] === 2;
}

/** Any tile of a footprint visible to the player? */
export function isFootprintVisible(world: World, b: Building): boolean {
  if (world.debug?.revealAll) return true;
  const fog = world.fog?.state;
  if (!fog) return false;
  const w = world.map.w;
  for (let ty = b.ty; ty < b.ty + b.h; ty++) {
    for (let tx = b.tx; tx < b.tx + b.w; tx++) {
      if (tx >= 0 && ty >= 0 && tx < w && ty < world.map.h && fog[ty * w + tx] === 2) return true;
    }
  }
  return false;
}

/**
 * Free spawn spots around (x, y): BFS over walkable tiles within `maxR`, nearest first, at most
 * `perTile` units per tile with small sub-tile offsets. `used` carries occupancy across calls.
 */
export function spawnSpots(world: World, x: number, y: number, count: number, maxR: number, used: Map<number, number>, perTile = 2): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const w = world.map.w;
  const h = world.map.h;
  const sx = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const sy = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const seen = new Set<number>();
  const queue: number[] = [];
  const push = (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return;
    const i = ty * w + tx;
    if (seen.has(i)) return;
    if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) > maxR + 0.75) return;
    seen.add(i);
    queue.push(i);
  };
  push(sx, sy);
  // If the start tile is blocked (e.g. inside a footprint) still expand through it.
  const offsets = [
    [0.5, 0.5],
    [0.25, 0.75],
    [0.75, 0.25],
  ];
  for (let qi = 0; qi < queue.length && out.length < count; qi++) {
    const i = queue[qi];
    const tx = i % w;
    const ty = (i - tx) / w;
    if (isWalkableTile(world, tx, ty)) {
      let n = used.get(i) ?? 0;
      while (n < perTile && out.length < count) {
        const o = offsets[n % offsets.length];
        out.push({ x: tx + o[0], y: ty + o[1] });
        n++;
      }
      used.set(i, n);
    }
    push(tx + 1, ty);
    push(tx - 1, ty);
    push(tx, ty + 1);
    push(tx, ty - 1);
    push(tx + 1, ty + 1);
    push(tx - 1, ty - 1);
    push(tx + 1, ty - 1);
    push(tx - 1, ty + 1);
  }
  // Overflow: stack on the nearest walkable spots found (separation will spread them).
  let k = 0;
  while (out.length < count && out.length > 0) {
    const base = out[k % out.length];
    out.push({ x: base.x + ((k % 3) - 1) * 0.15, y: base.y + (((k / 3) | 0) % 3 - 1) * 0.15 });
    k++;
  }
  if (out.length === 0) for (let i = 0; i < count; i++) out.push({ x, y });
  return out;
}

/** Emit a world event. */
export function emit(world: World, ev: World['events'][number]): void {
  world.events.push(ev);
}
