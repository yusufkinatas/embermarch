/**
 * Objectives and neutrals: Ruined / Ancient Caches (§J), Beacon Stones (§C, SHOULD), victory
 * conditions per objective (§C), plunder accounting (§M) and the result summary for sim-core.
 */
import { BEACONS, HOLDFAST, INCOME, parSeconds } from '../../data/balance';
import { endBattle } from '../world';
import { ENEMY, PLAYER, TICK_DT, type World } from '../types';
import { plunderCrowns, type PlunderKind } from './formulas';
import { dist, emit, liveUnit, unitEdgeDist } from './geom';
import type { EncRuntime } from './state';
import type { EncounterResult } from './types';

export function addPlunder(world: World, st: EncRuntime, kind: PlunderKind): number {
  const plunderers = (world.players[PLAYER]?.flags?.plunderers ?? 0) > 0;
  const c = plunderCrowns(kind, st.mods.fortified, plunderers);
  st.plunder.crowns += c;
  return c;
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

export function tickCaches(world: World, st: EncRuntime): void {
  if (st.caches.length === 0 || world.tick % 4 !== 0) return;
  for (const c of st.caches) {
    if (c.looted) continue;
    c.guards = c.guards.filter((id) => !!liveUnit(world, id));
    if (c.guards.length > 0) continue;
    let looter = 0;
    for (const u of world.units) {
      if (u.alive && u.owner === PLAYER && unitEdgeDist(u, c.b) <= INCOME.cacheLootRadius) {
        looter = u.id;
        break;
      }
    }
    if (!looter) continue;
    c.looted = true;
    if (c.b.object) c.b.object.done = true;
    const ember = c.ancient ? 0 : INCOME.ruinedCacheEmber;
    const crowns = addPlunder(world, st, c.ancient ? 'ancient' : 'cache');
    if (ember > 0) world.players[PLAYER].res.ember += ember;
    st.plunder.cachesLooted++;
    if (c.ancient) st.plunder.ancientLooted = true;
    emit(world, { t: 'cacheLooted', x: c.x, y: c.y, ember, crowns });
    emit(world, {
      t: 'alert',
      kind: 'cache_looted',
      text: c.ancient ? `Ancient Cache looted. +${crowns} Crowns, and a rare boon awaits.` : `Cache looted. +${ember} Ember, +${crowns} Crowns.`,
      x: c.x,
      y: c.y,
      priority: 'normal',
    });
  }
}

// ---------------------------------------------------------------------------
// Beacons (SHOULD)
// ---------------------------------------------------------------------------

function visionTag(id: number): string {
  return `beacon:${id}`;
}

export function tickBeacons(world: World, st: EncRuntime): void {
  if (st.beacons.length === 0) return;
  const dormant = world.time < BEACONS.dormantUntil;
  for (const b of st.beacons) {
    const obj = b.b.object;
    if (!obj) continue;
    obj.dormant = dormant;
    obj.dormantRemaining = dormant ? BEACONS.dormantUntil - world.time : 0;
    if (dormant) {
      obj.progress = 0;
      continue;
    }
    let playerIn = false;
    let enemyIn = false;
    for (const u of world.units) {
      if (!u.alive) continue;
      if (dist(u.x, u.y, b.x, b.y) > BEACONS.radius) continue;
      if (u.owner === PLAYER) playerIn = true;
      else if (u.owner === ENEMY) enemyIn = true;
      if (playerIn && enemyIn) break;
    }
    if (!b.lit) {
      if (playerIn && !enemyIn) b.capture = Math.min(BEACONS.captureTime, b.capture + TICK_DT);
      else if (!playerIn) b.capture = Math.max(0, b.capture - BEACONS.decayRate * TICK_DT);
      if (b.capture >= BEACONS.captureTime - 1e-9) {
        b.lit = true;
        b.snuff = 0;
        world.vision.push({ x: b.x, y: b.y, r: BEACONS.vision, until: -1, tag: visionTag(b.id) });
        emit(world, { t: 'beacon', id: b.id, lit: true });
        emit(world, { t: 'alert', kind: 'beacon_lit', text: 'A Beacon is lit.', x: b.x, y: b.y, priority: 'normal' });
      }
    } else {
      if (!enemyIn) st.kindling = Math.min(BEACONS.kindlingTarget, st.kindling + BEACONS.kindlingPerSec * TICK_DT);
      b.emberAcc += BEACONS.emberPerSec * TICK_DT;
      if (b.emberAcc >= 1) {
        const whole = Math.floor(b.emberAcc);
        b.emberAcc -= whole;
        world.players[PLAYER].res.ember += whole;
      }
      if (enemyIn && !playerIn) b.snuff += TICK_DT;
      else if (!enemyIn) b.snuff = 0;
      if (b.snuff >= BEACONS.snuffTime - 1e-9) {
        b.lit = false;
        b.capture = 0;
        b.snuff = 0;
        const tag = visionTag(b.id);
        world.vision = world.vision.filter((v) => v.tag !== tag);
        emit(world, { t: 'beacon', id: b.id, lit: false });
        emit(world, { t: 'alert', kind: 'beacon_snuffed', text: 'A Beacon is snuffed.', x: b.x, y: b.y, priority: 'high' });
      }
    }
    obj.lit = b.lit;
    obj.done = b.lit;
    obj.progress = b.lit ? 1 : b.capture / BEACONS.captureTime;
    obj.snuffProgress = b.lit ? b.snuff / BEACONS.snuffTime : 0;
    obj.contested = playerIn && enemyIn;
  }
}

// ---------------------------------------------------------------------------
// Victory
// ---------------------------------------------------------------------------

function nestsCleared(st: EncRuntime): boolean {
  return st.nestsTotal > 0 && st.nests.every((n) => !n.alive);
}

function holdfastSurvived(world: World, st: EncRuntime): boolean {
  if (st.nextN <= HOLDFAST.waves || st.wavesLaunched < HOLDFAST.waves) return false;
  if (st.waves.some((w) => w.phase === 'muster')) return false;
  for (const u of world.units) {
    if (!u.alive || u.owner !== ENEMY || !u.ai) continue;
    const r = u.ai.role;
    if (r === 'wave' || r === 'raid' || r === 'summon') return false;
  }
  return true;
}

export function isVictory(world: World, st: EncRuntime): boolean {
  switch (st.objective) {
    case 'raze':
      return nestsCleared(st);
    case 'holdfast':
      return nestsCleared(st) || holdfastSurvived(world, st);
    case 'beacons':
      return st.kindling >= BEACONS.kindlingTarget - 1e-9 || nestsCleared(st);
    case 'elite':
      return nestsCleared(st) && st.plunder.lordSlain;
    case 'boss':
      return st.plunder.regentSlain;
  }
}

export function checkVictory(world: World, st: EncRuntime): void {
  if (world.outcome !== 'ongoing' || !isVictory(world, st)) return;
  st.victoryTime = world.time;
  endBattle(world, 'victory');
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export function encounterResult(world: World, st: EncRuntime): EncounterResult {
  const par = parSeconds(st.objective, st.nestsTotal);
  const won = world.outcome === 'victory' && st.victoryTime >= 0;
  const holdfast = st.objective === 'holdfast';
  return {
    plunderCrowns: st.plunder.crowns,
    underPar: won && par !== null && st.victoryTime <= par + 1e-6,
    par,
    unbroken: holdfast && !st.buildingLost,
    uprooted: holdfast && nestsCleared(st),
    nestsDestroyed: st.plunder.nestsDestroyed,
    picketsDestroyed: st.plunder.picketsDestroyed,
    cachesLooted: st.plunder.cachesLooted,
    ancientCacheLooted: st.plunder.ancientLooted,
    lordSlain: st.plunder.lordSlain,
    regentSlain: st.plunder.regentSlain,
    wavesLaunched: st.wavesLaunched,
  };
}

