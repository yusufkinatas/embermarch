/** Player fog of war (3 states, updated at 5 Hz). OWNER: nav. */
import { BUILDINGS } from '../../data/buildings';
import { unitStats } from '../stats';
import { Fog, PLAYER } from '../types';
import type { FogState, UnitId, World } from '../types';

let scratch = new Uint8Array(0);

export function createFog(w: number, h: number): FogState {
  return { state: new Uint8Array(w * h), version: 0 };
}

/** Recompute visible tiles from player units/buildings sight + world.vision; keep explored. */
export function updateFog(world: World): void {
  const fog = world.fog;
  const n = world.map.w * world.map.h;
  const state = fog.state;
  expireVision(world);

  if (world.debug?.revealAll) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (state[i] !== Fog.Visible) {
        state[i] = Fog.Visible;
        changed = true;
      }
    }
    if (changed) fog.version++;
    return;
  }

  if (scratch.length < n) scratch = new Uint8Array(n);
  const next = scratch;
  // Everything visible last time decays to explored; sources re-light what they still see.
  for (let i = 0; i < n; i++) next[i] = state[i] === Fog.Visible ? Fog.Explored : state[i];

  const w = world.map.w;
  const h = world.map.h;
  const sightCache = new Map<string, number>();
  for (const u of world.units) {
    if (!u.alive || u.owner !== PLAYER) continue;
    const key = u.type + u.rank;
    let sight = sightCache.get(key);
    if (sight === undefined) {
      sight = unitSight(world, u.type, u.rank);
      sightCache.set(key, sight);
    }
    stamp(next, w, h, u.x, u.y, sight, Fog.Visible);
  }
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== PLAYER) continue;
    const def = BUILDINGS[b.type];
    if (!def || def.sight <= 0) continue;
    stamp(next, w, h, b.tx + b.w / 2, b.ty + b.h / 2, def.sight, Fog.Visible);
  }
  for (const v of world.vision) stamp(next, w, h, v.x, v.y, v.r, Fog.Visible);

  let changed = false;
  for (let i = 0; i < n; i++) {
    if (state[i] !== next[i]) {
      changed = true;
      break;
    }
  }
  if (changed) {
    state.set(next.subarray(0, n));
    fog.version++;
  }
}

/** Mark a circle explored (start area, Cold Watch-Fire full reveal uses r = Infinity). */
export function exploreCircle(world: World, x: number, y: number, r: number): void {
  const fog = world.fog;
  const state = fog.state;
  const w = world.map.w;
  const h = world.map.h;
  let changed = false;
  if (!Number.isFinite(r)) {
    for (let i = 0; i < w * h; i++) {
      if (state[i] === Fog.Unexplored) {
        state[i] = Fog.Explored;
        changed = true;
      }
    }
  } else {
    changed = stamp(state, w, h, x, y, r, Fog.Explored);
  }
  if (changed) fog.version++;
}

/** Composed sight of a player unit type (sim-core stats: research, boons, Thick Fog...). */
function unitSight(world: World, type: UnitId, rank: number): number {
  const s = unitStats(world, PLAYER, type, rank).sight;
  return Number.isFinite(s) && s > 0 ? s : 0;
}

/** Drop vision sources whose `until` tick has passed (-1 = permanent). */
function expireVision(world: World): void {
  const v = world.vision;
  let k = 0;
  for (let i = 0; i < v.length; i++) {
    const s = v[i];
    if (s.until !== -1 && s.until <= world.tick) continue;
    v[k++] = s;
  }
  v.length = k;
}

/**
 * Raise tiles whose centers lie within r of (x, y) to at least `value`. Returns true if any tile changed.
 */
function stamp(buf: Uint8Array, w: number, h: number, x: number, y: number, r: number, value: number): boolean {
  if (!(r > 0)) return false;
  const x0 = Math.max(0, Math.floor(x - r));
  const x1 = Math.min(w - 1, Math.floor(x + r));
  const y0 = Math.max(0, Math.floor(y - r));
  const y1 = Math.min(h - 1, Math.floor(y + r));
  const r2 = r * r;
  let changed = false;
  for (let ty = y0; ty <= y1; ty++) {
    const dy = ty + 0.5 - y;
    const dy2 = dy * dy;
    if (dy2 > r2) continue;
    const row = ty * w;
    for (let tx = x0; tx <= x1; tx++) {
      const dx = tx + 0.5 - x;
      if (dx * dx + dy2 > r2) continue;
      const i = row + tx;
      if (buf[i] < value) {
        buf[i] = value;
        changed = true;
      }
    }
  }
  return changed;
}
