/**
 * Court Noble (Elite): the Antlered Lord (§I). Waits at the main Nest, joins wave 3, rises at the
 * last Nest if every Nest falls first. Wild Hunt (line telegraph + dash + knockback) and Summon.
 */
import { CAPS, GARRISON, NOBLE, nobleHp } from '../../data/balance';
import { dealAbilityDamage } from '../combat';
import { displaceUnit } from '../nav/movement';
import { TICK_RATE, type Unit, type World } from '../types';
import { beginAdvance, thinkAdvance, thinkPost } from './ai';
import { driveHold } from './drive';
import { dist, emit, liveUnit, pointSegment, spawnSpots } from './geom';
import { THINK_TICKS, countPools, makeAI, spawnEnemy } from './spawn';
import { aiOf, type EncRuntime, type NestRec, type WaveRec } from './state';

const SEC = TICK_RATE;

/** The Lord stands at the Nest nearest the map center. */
export function spawnLord(world: World, st: EncRuntime): void {
  if (st.nests.length === 0) return;
  const mx = world.map.w / 2;
  const my = world.map.h / 2;
  let nest: NestRec = st.nests[0];
  for (const n of st.nests) if (dist(n.cx, n.cy, mx, my) < dist(nest.cx, nest.cy, mx, my)) nest = n;
  const [spot] = spawnSpots(world, nest.musterX, nest.musterY, 1, 4, new Map(), 1);
  const ai = makeAI(world, 'noble', 'antlered_lord', {
    state: 'post',
    postX: spot.x,
    postY: spot.y,
    anchorX: nest.cx,
    anchorY: nest.cy,
    leash: GARRISON.leashRadius,
    aggro: GARRISON.aggroRadius,
    nestId: nest.id,
  });
  const u = spawnEnemy(world, 'antlered_lord', spot.x, spot.y, ai);
  const hp = nobleHp(Math.max(1, st.depth));
  u.maxHp = hp;
  u.hp = hp;
  st.lord = {
    id: u.id,
    nestId: nest.id,
    joined: false,
    active: false,
    risen: false,
    nextHunt: -1,
    nextSummon: -1,
    pending: null,
    summons: [],
  };
}

function activate(world: World, st: EncRuntime): void {
  const lord = st.lord;
  if (!lord || lord.active) return;
  lord.active = true;
  lord.nextHunt = world.tick + 4 * SEC;
  lord.nextSummon = world.tick + 8 * SEC;
}

/** The Lord took damage: its abilities wake up. */
export function onLordDamaged(world: World, st: EncRuntime): void {
  activate(world, st);
}

/** Wave 3 launches: the Lord leaves its Nest and rides with it. */
export function lordJoinWave(world: World, st: EncRuntime, wave: WaveRec): void {
  const lord = st.lord;
  if (!lord || lord.joined) return;
  const u = liveUnit(world, lord.id);
  const ai = u ? aiOf(u) : null;
  if (!u || !ai) return;
  lord.joined = true;
  ai.wave = wave.n;
  ai.waveUid = wave.uid;
  beginAdvance(world, u, ai);
  activate(world, st);
  emit(world, { t: 'alert', kind: 'info', text: 'The Antlered Lord rides with the wave.', x: u.x, y: u.y, priority: 'high' });
}

/** Every Nest fell before the Lord joined a wave: it rises at the last Nest and marches on the Hearth. */
export function lordRise(world: World, st: EncRuntime, last: NestRec): void {
  const lord = st.lord;
  if (!lord || lord.joined) return;
  const u = liveUnit(world, lord.id);
  const ai = u ? aiOf(u) : null;
  if (!u || !ai) return;
  const [spot] = spawnSpots(world, last.cx, last.cy, 1, 5, new Map(), 1);
  u.x = u.prevX = spot.x;
  u.y = u.prevY = spot.y;
  lord.joined = true;
  lord.risen = true;
  ai.waveUid = 0;
  beginAdvance(world, u, ai);
  activate(world, st);
  emit(world, { t: 'alert', kind: 'info', text: 'The Antlered Lord rises from the ashes of the last Nest.', x: spot.x, y: spot.y, priority: 'high' });
  emit(world, { t: 'shake', magnitude: 5, duration: 0.3 });
}

/** Choose a Wild Hunt line: the direction (toward a player unit within 8) that crosses the most units. */
function huntLine(st: EncRuntime, u: Unit): { dx: number; dy: number } | null {
  const L = NOBLE.wildHunt.length;
  const half = NOBLE.wildHunt.width / 2;
  let best: { dx: number; dy: number } | null = null;
  let bestCount = 0;
  let bestDist = Infinity;
  for (const t of st.playerUnits) {
    if (!t.alive) continue;
    const d = dist(u.x, u.y, t.x, t.y);
    if (d > L || d < 0.1) continue;
    const dx = (t.x - u.x) / d;
    const dy = (t.y - u.y) / d;
    let count = 0;
    for (const p of st.playerUnits) {
      if (!p.alive) continue;
      const ps = pointSegment(p.x, p.y, u.x, u.y, u.x + dx * L, u.y + dy * L);
      if (ps.d <= half + p.radius) count++;
    }
    if (count > bestCount || (count === bestCount && d < bestDist)) {
      bestCount = count;
      bestDist = d;
      best = { dx, dy };
    }
  }
  return best;
}

function resolveHunt(world: World, st: EncRuntime, u: Unit): void {
  const lord = st.lord!;
  const tg = lord.pending!;
  lord.pending = null;
  const L = NOBLE.wildHunt.length;
  const half = NOBLE.wildHunt.width / 2;
  const dx = (tg.x2 - tg.x) / L;
  const dy = (tg.y2 - tg.y) / L;
  const victims = st.playerUnits.filter((p) => {
    if (!p.alive) return false;
    return pointSegment(p.x, p.y, tg.x, tg.y, tg.x2, tg.y2).d <= half + p.radius;
  });
  displaceUnit(world, u, tg.x2 - u.x, tg.y2 - u.y);
  for (const p of victims) {
    if (!p.alive) continue;
    dealAbilityDamage(world, p, NOBLE.wildHunt.damage, u.id);
    if (!p.alive) continue;
    // Knock aside, away from the dash line.
    const side = (p.x - tg.x) * dy - (p.y - tg.y) * dx >= 0 ? 1 : -1;
    const nx = dy * side;
    const ny = -dx * side;
    displaceUnit(world, p, nx * NOBLE.wildHunt.knockback, ny * NOBLE.wildHunt.knockback);
    emit(world, { t: 'knockback', id: p.id });
  }
  emit(world, { t: 'shake', magnitude: 4, duration: 0.25 });
  lord.nextHunt = world.tick + Math.round(NOBLE.wildHunt.interval * SEC);
}

function trySummon(world: World, st: EncRuntime, u: Unit): void {
  const lord = st.lord!;
  if (world.tick < lord.nextSummon) return;
  lord.nextSummon = world.tick + Math.round(NOBLE.summon.interval * SEC);
  lord.summons = lord.summons.filter((id) => !!liveUnit(world, id));
  if (u.hp < u.maxHp * NOBLE.summon.minHpPct) return;
  const room = Math.min(NOBLE.summon.count, NOBLE.summon.maxAlive - lord.summons.length);
  if (room <= 0) return;
  const counts = countPools(world);
  const spots = spawnSpots(world, u.x, u.y, room, 3, new Map(), 1);
  for (let i = 0; i < room; i++) {
    if (counts.wave >= CAPS.enemyWave || counts.total >= CAPS.enemyTotal) break;
    const ai = makeAI(world, 'summon', NOBLE.summon.unit, { state: 'advance', postX: spots[i].x, postY: spots[i].y, leaderId: u.id });
    const s = spawnEnemy(world, NOBLE.summon.unit, spots[i].x, spots[i].y, ai);
    beginAdvance(world, s, ai);
    lord.summons.push(s.id);
    counts.wave++;
    counts.total++;
  }
  emit(world, { t: 'ability', name: 'summon', x: u.x, y: u.y, radius: 3, owner: u.owner });
}

export function tickNoble(world: World, st: EncRuntime): void {
  const lord = st.lord;
  if (!lord) return;
  const u = liveUnit(world, lord.id);
  if (!u) return;
  const ai = aiOf(u);
  if (!ai) return;
  if (!lord.active && u.hp < u.maxHp) activate(world, st);

  if (lord.pending) {
    if (world.tick >= lord.pending.fireTick) resolveHunt(world, st, u);
    else {
      driveHold(world, u);
      return;
    }
  }
  if (lord.active) {
    trySummon(world, st, u);
    if (world.tick >= lord.nextHunt) {
      const line = huntLine(st, u);
      if (line) {
        const L = NOBLE.wildHunt.length;
        lord.pending = {
          kind: 'hunt',
          fireTick: world.tick + Math.round(NOBLE.wildHunt.telegraph * SEC),
          x: u.x,
          y: u.y,
          x2: u.x + line.dx * L,
          y2: u.y + line.dy * L,
          radius: 0,
          width: NOBLE.wildHunt.width,
        };
        emit(world, {
          t: 'telegraph',
          shape: 'line',
          x: u.x,
          y: u.y,
          x2: lord.pending.x2,
          y2: lord.pending.y2,
          width: NOBLE.wildHunt.width,
          duration: NOBLE.wildHunt.telegraph,
        });
        driveHold(world, u);
        return;
      }
      lord.nextHunt = world.tick + SEC;
    }
  }

  if (world.tick < ai.nextThink && !(ai.state === 'engage' && u.order.type === 'idle')) return;
  ai.nextThink = world.tick + THINK_TICKS;
  if (!lord.joined) {
    thinkPost(world, st, u, ai);
    return;
  }
  const wave = st.waves.find((w) => w.uid === ai.waveUid) ?? null;
  thinkAdvance(world, st, u, ai, wave);
}

export function lordView(world: World, st: EncRuntime): { name: string; hp: number; maxHp: number; phase: 1 | 2; warded: boolean; enraged: boolean } | null {
  const lord = st.lord;
  if (!lord) return null;
  const u = liveUnit(world, lord.id);
  if (!u || (!lord.active && !lord.joined)) return null;
  return { name: 'The Antlered Lord', hp: u.hp, maxHp: u.maxHp, phase: 1, warded: false, enraged: false };
}

