/**
 * Blight (§K): per-source radius growth, recede on source death, ward grid (Kindled Earth,
 * Kiln Masons), blighted tiles, and the effects encounter owns (Thornwake regen, building wither).
 */
import { BLIGHT, ENEMY_AI, blightParams } from '../../data/balance';
import { dealTrueDamage } from '../combat';
import { ENEMY, PLAYER, TICK_DT, TICK_RATE, Terrain, type World } from '../types';
import { computeBlightTiles, computeWardGrid, recedeRadius, blightRadiusAt, type BlightCircle, type WardRect } from './formulas';
import { emit } from './geom';
import type { BlightSourceRec, EncRuntime } from './state';

/** Which tiles can carry Blight (everything but water, rock and briar walls). */
export function buildCanBlight(world: World): Uint8Array {
  const n = world.map.w * world.map.h;
  const out = new Uint8Array(n);
  const t = world.map.terrain;
  for (let i = 0; i < n; i++) {
    out[i] = t[i] === Terrain.Water || t[i] === Terrain.Rock || t[i] === Terrain.BriarWall ? 0 : 1;
  }
  return out;
}

export function addBlightSource(world: World, st: EncRuntime, entityId: number, x: number, y: number): BlightSourceRec {
  const p = blightParams(st.objective, st.depth, st.mods.creeping);
  const src: BlightSourceRec = {
    entityId,
    x,
    y,
    start: p.start,
    cap: p.cap,
    interval: p.interval,
    grown: 0,
    radius: p.start,
    receding: false,
    recedeFrom: 0,
    recedeStartTick: -1,
    gone: false,
  };
  st.blight.push(src);
  st.blightDirty = true;
  return src;
}

/** The source died: recede to 0 over 4 s with a ring animation event. */
export function startRecede(world: World, st: EncRuntime, entityId: number): void {
  const src = st.blight.find((s) => s.entityId === entityId && !s.receding);
  if (!src) return;
  src.receding = true;
  src.recedeFrom = src.radius;
  src.recedeStartTick = world.tick;
  emit(world, { t: 'blightRecede', x: src.x, y: src.y, radius: src.radius });
}

export function recomputeBlightTiles(world: World, st: EncRuntime): void {
  const circles: BlightCircle[] = [];
  for (const s of st.blight) if (!s.gone && s.radius > 0) circles.push({ x: s.x, y: s.y, r: s.radius });
  const changed = computeBlightTiles(world.blight.tiles, world.map.w, world.map.h, circles, world.blight.ward, st.canBlight);
  if (changed) world.blight.version++;
  st.blightDirty = false;
}

/** Ward grid from completed player buildings: Kindled Earth radius 5 (all), Kiln Masons radius 3 (towers). */
export function recomputeWard(world: World, st: EncRuntime): void {
  const flags = world.players[PLAYER]?.flags ?? {};
  const kindled = (flags.kindled_earth ?? 0) > 0;
  const kiln = (flags.kiln_masons ?? 0) > 0;
  const rects: WardRect[] = [];
  if (kindled || kiln) {
    for (const b of world.buildings) {
      if (!b.alive || b.owner !== PLAYER || !b.built) continue;
      let r = 0;
      if (kindled) r = BLIGHT.kindledEarthWard;
      if (kiln && b.type === 'brazier_tower') r = Math.max(r, BLIGHT.kilnMasonsWard);
      if (r > 0) rects.push({ tx: b.tx, ty: b.ty, w: b.w, h: b.h, r });
    }
  }
  const before = world.blight.ward.slice();
  computeWardGrid(world.blight.ward, world.map.w, world.map.h, rects);
  let changed = false;
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== world.blight.ward[i]) {
      changed = true;
      break;
    }
  }
  if (changed) world.blight.version++;
  recomputeBlightTiles(world, st);
}

function syncNestRadius(st: EncRuntime, src: BlightSourceRec): void {
  const nest = st.nests.find((n) => n.id === src.entityId);
  if (nest && nest.b.nest) nest.b.nest.blightRadius = src.radius;
}

/** Growth, recede, tile refresh and effects. Call once per tick. */
export function tickBlight(world: World, st: EncRuntime): void {
  for (const s of st.blight) {
    if (s.gone) continue;
    const before = s.radius;
    if (s.receding) {
      s.radius = recedeRadius(s.recedeFrom, (world.tick - s.recedeStartTick) / TICK_RATE);
      if (s.radius <= 0) {
        s.radius = 0;
        s.gone = true;
      }
    } else {
      s.grown += TICK_DT;
      s.radius = blightRadiusAt(s.start, s.cap, s.interval, s.grown);
    }
    if (s.radius !== before) {
      st.blightDirty = true;
      syncNestRadius(st, s);
    }
  }
  if (st.blightDirty) recomputeBlightTiles(world, st);
  applyBlightEffects(world, st);
}

function applyBlightEffects(world: World, st: EncRuntime): void {
  const tiles = world.blight.tiles;
  const w = world.map.w;
  const h = world.map.h;
  // Thornwake regenerate 1 HP/s on Blight.
  const regen = ENEMY_AI.blightRegen * TICK_DT;
  for (const u of world.units) {
    if (!u.alive || u.owner !== ENEMY || u.hp >= u.maxHp) continue;
    const tx = Math.floor(u.x);
    const ty = Math.floor(u.y);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
    if (tiles[ty * w + tx] === 1) u.hp = Math.min(u.maxHp, u.hp + regen);
  }
  // Player buildings reached by Blight wither 2 HP/s (true damage, applied once per second).
  st.witherTimer += TICK_DT;
  if (st.witherTimer < 1 - 1e-9) return;
  st.witherTimer -= 1;
  const victims = [];
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== PLAYER || !b.built) continue;
    if (footprintBlighted(tiles, w, h, b.tx, b.ty, b.w, b.h)) victims.push(b);
  }
  for (const b of victims) if (b.alive) dealTrueDamage(world, b, BLIGHT.buildingWitherHps, 0);
}

export function footprintBlighted(tiles: Uint8Array, w: number, h: number, tx: number, ty: number, fw: number, fh: number): boolean {
  for (let y = ty; y < ty + fh; y++) {
    if (y < 0 || y >= h) continue;
    for (let x = tx; x < tx + fw; x++) {
      if (x >= 0 && x < w && tiles[y * w + x] === 1) return true;
    }
  }
  return false;
}
