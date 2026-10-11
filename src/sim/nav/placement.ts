/** Free-spot search (spawns, displacement, formation fix-ups) and role-sorted formation slots. OWNER: nav. */
import { UNITS } from '../../data/units';
import type { Unit, World } from '../types';
import { navAux } from './layers';

/** A tile counts as occupied by a unit when a unit center is within this distance of its center. */
const UNIT_CLEAR = 0.55;
/** Nominal slot spacing (tiles); widened for big units. */
export const FORMATION_SPACING = 0.8;

export interface FreeSpotOpts {
  /** Tiles that must not be returned (already handed out). */
  taken?: Set<number>;
  /** Ignore units (only terrain + static occupants matter). */
  ignoreUnits?: boolean;
  /**
   * Restrict to this walkable component (player mode). Default: the component of the start tile
   * when it is walkable (never hop across water), else unrestricted.
   */
  component?: number;
}

/**
 * Nearest (Euclidean, to the tile center) walkable tile without a static occupant and without
 * units within maxR of (x, y), scanning square rings outward. Returns the tile center or null.
 */
export function findFreeSpotImpl(
  world: World,
  x: number,
  y: number,
  maxR: number,
  opts: FreeSpotOpts = {},
): { x: number; y: number; tile: number } | null {
  const grid = world.grid;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const aux = navAux(world);
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let comp = opts.component;
  if (comp === undefined) {
    const inside = cx >= 0 && cy >= 0 && cx < grid.w && cy < grid.h;
    comp = inside && grid.blocked[cy * grid.w + cx] === 0 ? aux.compPlayer[cy * grid.w + cx] : -1;
  }
  const near: Unit[] = [];
  if (!opts.ignoreUnits) {
    const lim = maxR + 2;
    for (const u of world.units) {
      if (u.alive && Math.abs(u.x - x) <= lim && Math.abs(u.y - y) <= lim) near.push(u);
    }
  }
  const R = Math.ceil(maxR) + 1;
  let best = -1;
  let bestD = Infinity;
  for (let r = 0; r <= R; r++) {
    if (r - 0.5 > bestD) break;
    for (let ty = cy - r; ty <= cy + r; ty++) {
      if (ty < 0 || ty >= grid.h) continue;
      const edgeRow = ty === cy - r || ty === cy + r;
      for (let tx = cx - r; tx <= cx + r; tx += edgeRow ? 1 : 2 * r) {
        if (tx < 0 || tx >= grid.w) continue;
        const i = ty * grid.w + tx;
        if (grid.blocked[i] !== 0 || grid.occupant[i] !== 0) continue;
        if (comp >= 0 && aux.compPlayer[i] !== comp) continue;
        if (opts.taken && opts.taken.has(i)) continue;
        const px = tx + 0.5;
        const py = ty + 0.5;
        const d = Math.hypot(px - x, py - y);
        if (d > maxR || d >= bestD) continue;
        let free = true;
        for (const u of near) {
          if (Math.abs(u.x - px) < UNIT_CLEAR && Math.abs(u.y - py) < UNIT_CLEAR && Math.hypot(u.x - px, u.y - py) < UNIT_CLEAR) {
            free = false;
            break;
          }
        }
        if (!free) continue;
        best = i;
        bestD = d;
        if (r === 0) break;
      }
    }
  }
  if (best < 0) return null;
  return { x: (best % grid.w) + 0.5, y: Math.floor(best / grid.w) + 0.5, tile: best };
}

/** 0 = melee front line, 1 = ranged / support behind, 2 = workers and siege at the back. */
function roleOf(u: Unit): number {
  if (u.cls === 'worker' || u.cls === 'siege') return 2;
  const def = UNITS[u.type];
  if (u.cls === 'ranged' || (def !== undefined && def.range >= 1.5)) return 1;
  return 0;
}

/**
 * Role-sorted formation slots centered on (toX, toY), rows perpendicular to the move direction:
 * melee in front, ranged behind, workers/siege last. slots[i] belongs to units[i]. Units are
 * assigned to rows by how far forward they already are and to columns by their lateral position
 * (minimises crossing). With a world, slots on blocked tiles (or cut off from the goal) move to
 * the nearest free walkable tile.
 */
export function formationSlotsImpl(
  units: Unit[],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  world: World | null,
): { x: number; y: number }[] {
  const n = units.length;
  if (n === 0) return [];
  let dx = toX - fromX;
  let dy = toY - fromY;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    dx = 1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }
  const px = -dy;
  const py = dx;
  let maxR = 0;
  for (const u of units) maxR = Math.max(maxR, u.radius || 0);
  const spacing = Math.max(FORMATION_SPACING, 2 * maxR + 0.05);
  const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n * 2))));

  // Rows, front to back.
  const rows: number[][] = [];
  for (let role = 0; role <= 2; role++) {
    const members: number[] = [];
    for (let i = 0; i < n; i++) if (roleOf(units[i]) === role) members.push(i);
    members.sort((a, b) => {
      const fa = (units[a].x - fromX) * dx + (units[a].y - fromY) * dy;
      const fb = (units[b].x - fromX) * dx + (units[b].y - fromY) * dy;
      return fb - fa || units[a].id - units[b].id;
    });
    for (let k = 0; k < members.length; k += cols) rows.push(members.slice(k, k + cols));
  }

  const out: { x: number; y: number }[] = new Array(n);
  const R = rows.length;
  for (let k = 0; k < R; k++) {
    const row = rows[k];
    row.sort((a, b) => {
      const la = (units[a].x - fromX) * px + (units[a].y - fromY) * py;
      const lb = (units[b].x - fromX) * px + (units[b].y - fromY) * py;
      return la - lb || units[a].id - units[b].id;
    });
    const fwd = ((R - 1) / 2 - k) * spacing;
    const m = row.length;
    for (let j = 0; j < m; j++) {
      const lat = (j - (m - 1) / 2) * spacing;
      out[row[j]] = { x: toX + dx * fwd + px * lat, y: toY + dy * fwd + py * lat };
    }
  }
  if (world) fixSlots(world, out, toX, toY);
  return out;
}

function fixSlots(world: World, slots: { x: number; y: number }[], toX: number, toY: number): void {
  const grid = world.grid;
  const aux = navAux(world);
  const gtx = Math.floor(toX);
  const gty = Math.floor(toY);
  const gInside = gtx >= 0 && gty >= 0 && gtx < grid.w && gty < grid.h;
  const gTile = gInside ? gty * grid.w + gtx : -1;
  const goalComp = gTile >= 0 && grid.blocked[gTile] === 0 ? aux.compPlayer[gTile] : -1;
  const taken = new Set<number>();
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const tx = Math.floor(s.x);
    const ty = Math.floor(s.y);
    const inside = tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h;
    const t = inside ? ty * grid.w + tx : -1;
    const ok = t >= 0 && grid.blocked[t] === 0 && (goalComp < 0 || aux.compPlayer[t] === goalComp);
    if (ok) continue;
    const spot = findFreeSpotImpl(world, s.x, s.y, 5, { taken, ignoreUnits: true, component: goalComp });
    if (spot) {
      taken.add(spot.tile);
      slots[i] = { x: spot.x, y: spot.y };
    } else {
      slots[i] = { x: toX, y: toY };
    }
  }
}
