/**
 * Building placement rules (GDD §E) and spawn-tile search (GDD §D). OWNER: sim-core.
 *
 * Placement: footprint inside the map, explored, all Grass/Stump, no static occupant, not Blighted
 * (Brazier Towers allowed with Kiln Masons), and at least 3 tiles from any enemy structure.
 * Spawn: nearest free walkable tile found by BFS outward from the building edge (max 6 tiles).
 */
import { BUILD } from '../data/balance';
import { BUILDINGS } from '../data/buildings';
import { TEXT } from '../data/text';
import { rectRectDist } from './core';
import { hasFlag } from './stats';
import { isTileExplored } from './vision';
import type { PlayerBuildingId, Unit, World } from './types';
import { ENEMY, PLAYER, Terrain } from './types';

export interface PlacementResult {
  ok: boolean;
  reason?: string;
  tiles: boolean[];
}

export function checkPlacement(world: World, type: PlayerBuildingId, tx: number, ty: number): PlacementResult {
  const def = BUILDINGS[type];
  const { w, h } = def;
  const mw = world.map.w;
  const mh = world.map.h;
  const tiles: boolean[] = new Array(w * h).fill(true);
  const blightOk = type === 'brazier_tower' && hasFlag(world, PLAYER, 'kiln_masons');
  const enemies = world.buildings.filter((b) => b.alive && b.owner === ENEMY);
  let reason: string | undefined;
  const fail = (i: number, r: string): void => {
    tiles[i] = false;
    if (!reason) reason = r;
  };
  // Reasons are reported in a stable priority order (bounds, fog, terrain, blight, enemy).
  const reasons: string[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const i = dy * w + dx;
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= mw || y >= mh) {
        tiles[i] = false;
        reasons.push('0Out of bounds');
        continue;
      }
      const t = y * mw + x;
      if (!isTileExplored(world, x, y)) {
        tiles[i] = false;
        reasons.push(`1${TEXT.unexplored}`);
        continue;
      }
      const ter = world.map.terrain[t];
      if ((ter !== Terrain.Grass && ter !== Terrain.Stump) || world.grid.occupant[t] !== 0 || world.grid.blocked[t] !== 0) {
        tiles[i] = false;
        reasons.push(`2${TEXT.blocked}`);
        continue;
      }
      if (!blightOk && world.blight.tiles[t] === 1) {
        tiles[i] = false;
        reasons.push(`3${TEXT.blighted}`);
        continue;
      }
      for (const b of enemies) {
        if (rectRectDist(x, y, 1, 1, b.tx, b.ty, b.w, b.h) < BUILD.minDistFromEnemyStructure) {
          fail(i, TEXT.tooCloseEnemy);
          reasons.push(`4${TEXT.tooCloseEnemy}`);
          break;
        }
      }
    }
  }
  if (reasons.length) {
    reasons.sort();
    reason = reasons[0].slice(1);
  }
  return { ok: reasons.length === 0, reason, tiles };
}

function unitNear(world: World, x: number, y: number, r: number, skip?: Unit): boolean {
  for (const u of world.units) {
    if (!u.alive || u === skip) continue;
    if (Math.abs(u.x - x) < r && Math.abs(u.y - y) < r) return true;
  }
  return false;
}

function freeTile(world: World, tile: number): boolean {
  return world.grid.blocked[tile] === 0 && world.grid.occupant[tile] === 0;
}

/**
 * Nearest free walkable tile center around a footprint, BFS outward from its edge (max `maxR` tiles).
 * Tiles whose center is within 0.45 of a unit are taken. Ring-1 tiles are ordered by distance to the
 * preferred point (rally point) so units appear on that side.
 */
export function findSpawnTile(
  world: World,
  rect: { tx: number; ty: number; w: number; h: number },
  maxR: number,
  prefX?: number,
  prefY?: number,
  skip?: Unit,
  /** Candidate tile centres to pass over (e.g. next to the starting Tillers). */
  avoid?: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  const mw = world.map.w;
  const mh = world.map.h;
  const dist = new Map<number, number>();
  let frontier: number[] = [];
  const inRect = (x: number, y: number): boolean => x >= rect.tx && y >= rect.ty && x < rect.tx + rect.w && y < rect.ty + rect.h;
  for (let y = rect.ty - 1; y <= rect.ty + rect.h; y++) {
    for (let x = rect.tx - 1; x <= rect.tx + rect.w; x++) {
      if (inRect(x, y) || x < 0 || y < 0 || x >= mw || y >= mh) continue;
      const t = y * mw + x;
      if (!freeTile(world, t)) continue;
      dist.set(t, 1);
      frontier.push(t);
    }
  }
  const cx = rect.tx + rect.w / 2;
  const cy = rect.ty + rect.h / 2;
  const px = prefX ?? cx;
  const py = prefY ?? cy + rect.h;
  const keyOf = (t: number): number => {
    const x = t % mw;
    const y = (t - x) / mw;
    return Math.hypot(x + 0.5 - px, y + 0.5 - py) * 1000 + t / (mw * mh);
  };
  for (let ring = 1; ring <= maxR && frontier.length; ring++) {
    frontier.sort((a, b) => keyOf(a) - keyOf(b));
    for (const t of frontier) {
      const x = t % mw;
      const y = (t - x) / mw;
      if (avoid && avoid(x + 0.5, y + 0.5)) continue;
      if (!unitNear(world, x + 0.5, y + 0.5, 0.45, skip)) return { x: x + 0.5, y: y + 0.5 };
    }
    const next: number[] = [];
    for (const t of frontier) {
      const x = t % mw;
      const y = (t - x) / mw;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= mw || ny >= mh || inRect(nx, ny)) continue;
          const nt = ny * mw + nx;
          if (dist.has(nt) || !freeTile(world, nt)) continue;
          dist.set(nt, ring + 1);
          next.push(nt);
        }
      }
    }
    frontier = next;
  }
  return null;
}

/** Placing a foundation instantly moves any unit inside its footprint to the nearest free tile. */
export function displaceUnitsFrom(world: World, rect: { tx: number; ty: number; w: number; h: number }): void {
  for (const u of world.units) {
    if (!u.alive) continue;
    const inside = u.x > rect.tx - u.radius && u.y > rect.ty - u.radius && u.x < rect.tx + rect.w + u.radius && u.y < rect.ty + rect.h + u.radius;
    if (!inside) continue;
    const spot = findSpawnTile(world, rect, 8, u.x, u.y, u);
    if (!spot) continue;
    u.x = spot.x;
    u.y = spot.y;
    u.prevX = spot.x;
    u.prevY = spot.y;
  }
}

/** Requirement text for a building ("Requires a Muster Hall or Bowyard"), or undefined if met. */
export function buildingRequirementReason(world: World, type: PlayerBuildingId): string | undefined {
  const req = BUILDINGS[type].requires;
  if (!req || req.length === 0) return undefined;
  const have = (id: PlayerBuildingId): boolean =>
    world.buildings.some((b) => b.alive && b.built && b.owner === PLAYER && b.type === id);
  if (req.some((group) => group.every(have))) return undefined;
  const names = req.map((g) => g.map((id) => BUILDINGS[id].name).join(' + '));
  return TEXT.needs(`a ${names.join(' or ')}`);
}
