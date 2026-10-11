/**
 * Soft unit separation (GDD §F d): overlapping units are pushed apart through the spatial hash,
 * at most 0.5 tiles/s per unit. Moving units shove settled ones (the settled unit takes the
 * whole push). Pushes slide along walls and never enter blocked tiles. Also: mild lateral
 * avoidance so movers flow around settled units instead of ploughing through them. OWNER: nav.
 */
import { NAV } from '../../data/balance';
import { TICK_DT } from '../types';
import type { Unit, World } from '../types';
import { slideMove, terrainRadius } from './collision';
import type { Pos } from './collision';
import { forEachUnitNear } from './spatial';

/** Desired gap between bodies. */
const PAD = 0.04;
/** Largest unit radius (Briar Regent 1.1) for neighbour searches. */
const MAX_R = 1.2;

let pushX = new Float64Array(0);
let pushY = new Float64Array(0);
const tmp: Pos = { x: 0, y: 0 };
const indexOf = new Map<number, number>();

function radiusOf(u: Unit): number {
  return u.radius > 0 ? u.radius : 0.3;
}

/** Deterministic split direction for exactly coincident units. */
function splitAngle(a: number, b: number): number {
  return (((a * 92821 + b * 68917) % 360) * Math.PI) / 180;
}

/** moving[i] = 1 if world.units[i] is actively moving this tick. */
export function applySeparation(world: World, moving: Uint8Array): void {
  const units = world.units;
  const n = units.length;
  if (pushX.length < n) {
    pushX = new Float64Array(Math.max(n, 64) * 2);
    pushY = new Float64Array(pushX.length);
  }
  pushX.fill(0, 0, n);
  pushY.fill(0, 0, n);
  indexOf.clear();
  for (let i = 0; i < n; i++) if (units[i].alive) indexOf.set(units[i].id, i);

  for (let ia = 0; ia < n; ia++) {
    const a = units[ia];
    if (!a.alive) continue;
    const ra = radiusOf(a);
    forEachUnitNear(world, a.x, a.y, ra + MAX_R + PAD, (b) => {
      if (b.id <= a.id) return;
      const ib = indexOf.get(b.id);
      if (ib === undefined) return;
      const rb = radiusOf(b);
      const minD = ra + rb + PAD;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) return;
      let d = Math.sqrt(d2);
      if (d < 1e-6) {
        const ang = splitAngle(a.id, b.id);
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        d = 0;
      } else {
        dx /= d;
        dy /= d;
      }
      const overlap = minD - d;
      const am = moving[ia] === 1;
      const bm = moving[ib] === 1;
      let wa: number;
      let wb: number;
      if (am && !bm) {
        wa = 0;
        wb = 1;
      } else if (!am && bm) {
        wa = 1;
        wb = 0;
      } else {
        // Same state: split by "mass" (area), so small units yield to big ones.
        const ma = ra * ra;
        const mb = rb * rb;
        wa = mb / (ma + mb);
        wb = ma / (ma + mb);
      }
      pushX[ia] += dx * overlap * wa;
      pushY[ia] += dy * overlap * wa;
      pushX[ib] -= dx * overlap * wb;
      pushY[ib] -= dy * overlap * wb;
    });
  }

  const cap = NAV.separationMaxPush * TICK_DT;
  const grid = world.grid;
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (!u.alive) continue;
    let px = pushX[i];
    let py = pushY[i];
    const len = Math.hypot(px, py);
    if (len < 1e-5) continue;
    if (len > cap) {
      px *= cap / len;
      py *= cap / len;
    }
    slideMove(grid, u.x, u.y, terrainRadius(u), px, py, tmp);
    u.x = tmp.x;
    u.y = tmp.y;
  }
}

/** Is a unit settled (not actively walking) for shove/avoid purposes? */
export function isSettled(u: Unit): boolean {
  return u.move === null || u.moveStatus !== 'moving';
}

/**
 * Bend a desired unit direction (dx, dy normalized) around settled units just ahead.
 * ignoreId: the unit's target (never avoid what we walk to). Writes the new direction to out.
 */
export function avoidSettled(world: World, u: Unit, dx: number, dy: number, ignoreId: number, out: Pos): void {
  const ru = radiusOf(u);
  let ax = 0;
  let ay = 0;
  forEachUnitNear(world, u.x, u.y, ru + MAX_R + 0.7, (b) => {
    if (b === u || b.id === ignoreId || !isSettled(b)) return;
    const ox = b.x - u.x;
    const oy = b.y - u.y;
    const along = ox * dx + oy * dy;
    if (along <= 0) return;
    const clear = ru + radiusOf(b) + 0.08;
    const reach = clear + 0.6;
    if (along > reach) return;
    const lat = -ox * dy + oy * dx; // offset along the left normal (-dy, dx)
    const alat = Math.abs(lat);
    if (alat >= clear) return;
    const s = (1 - alat / clear) * (1 - along / reach);
    // Steer to the side away from the obstacle (deterministic when dead ahead).
    const side = lat > 1e-6 ? -1 : lat < -1e-6 ? 1 : u.id < b.id ? 1 : -1;
    ax += -dy * side * s;
    ay += dx * side * s;
  });
  if (ax === 0 && ay === 0) {
    out.x = dx;
    out.y = dy;
    return;
  }
  // Prefer the computed side; if terrain stops the body that way try the mirror side; if both
  // are walled, walk straight on (moving units shove settled ones instead).
  const k = 1.2;
  const tr = terrainRadius(u);
  const probe = 0.3;
  for (let pass = 0; pass < 2; pass++) {
    const sgn = pass === 0 ? 1 : -1;
    const nx = dx + ax * k * sgn;
    const ny = dy + ay * k * sgn;
    const len = Math.hypot(nx, ny);
    if (len < 1e-6) continue;
    const ux = nx / len;
    const uy = ny / len;
    slideMove(world.grid, u.x, u.y, tr, ux * probe, uy * probe, tmp);
    const progress = (tmp.x - u.x) * ux + (tmp.y - u.y) * uy;
    if (progress >= probe * 0.6) {
      out.x = ux;
      out.y = uy;
      return;
    }
  }
  out.x = dx;
  out.y = dy;
}
