/**
 * Boss: the Briar Regent (§I). Phase 1 Enthroned (warded, Thorn Lance), Root Heart kills strip
 * 1500 HP from the phase-2 pool, phase 2 Uprooted at all Hearts dead or 8:00 (Wrath), march on the
 * Hearth, Warden retarget, Thornburst, Rootsnare, Court Summons, Enrage.
 */
import { BOSS, CAPS, regentHp } from '../../data/balance';
import { UNITS } from '../../data/units';
import { dealAbilityDamage } from '../combat';
import { displaceUnit } from '../nav/movement';
import { PLAYER, TICK_RATE, type Building, type Unit, type World } from '../types';
import { beginAdvance } from './ai';
import { driveAdvance, driveAttack, driveHold } from './drive';
import { composeWave, fmtClock, type WeightEntry } from './formulas';
import { centerOf, dist, distToEntity, emit, hearth, liveBuilding, liveUnit, pointSegment, spawnSpots, unitEdgeDist } from './geom';
import { THINK_TICKS, countPools, makeAI, spawnEnemy } from './spawn';
import { aiOf, type EncRuntime, type Telegraph } from './state';
import type { EncounterView } from './types';

const SEC = TICK_RATE;
const FOREVER = 1e9;
const LANCE_WIDTH = 1;
/** The Thorn Lance line runs this far past its target (dodge by stepping aside, not back). */
const LANCE_OVERSHOOT = 1.5;
/** Within this edge distance of the Hearth the Regent attacks it directly. */
const HEARTH_ENGAGE = 6;

export function spawnRegent(world: World, st: EncRuntime, throne: Building): void {
  const c = centerOf(throne);
  const ai = makeAI(world, 'boss', 'briar_regent', { state: 'post', postX: c.x, postY: c.y, leash: 1e9, aggro: 0 });
  const u = spawnEnemy(world, 'briar_regent', c.x, c.y, ai);
  const hearts = st.nests.filter((n) => n.alive).length;
  u.maxHp = regentHp(hearts);
  u.hp = u.maxHp;
  u.untargetable = true;
  u.invulnerable = true;
  st.boss = {
    id: u.id,
    throneId: throne.id,
    throneX: c.x,
    throneY: c.y,
    phase: 1,
    wrath: false,
    wrathWarned: false,
    enraged: false,
    nextLance: world.tick + Math.round(BOSS.thornLance.interval * SEC),
    nextBurst: -1,
    nextSnare: -1,
    pending: [],
    summonsDone: 0,
    wardenReadyTick: 0,
    wardenChase: null,
  };
}

function heartsAlive(st: EncRuntime): number {
  return st.nests.filter((n) => n.alive).length;
}

/** A Root Heart burned: the phase-2 pool shrinks by 1500; all Hearts down → Uprooted. */
export function onHeartDestroyed(world: World, st: EncRuntime): void {
  const boss = st.boss;
  if (!boss) return;
  const u = liveUnit(world, boss.id);
  if (!u) return;
  if (boss.phase === 1) {
    u.maxHp = regentHp(heartsAlive(st));
    u.hp = u.maxHp;
    if (heartsAlive(st) === 0) enterPhase2(world, st, false);
    return;
  }
  // Wrath: the pool is always 3000 + 1500 × hearts still alive (idempotent if several die at once).
  const target = regentHp(heartsAlive(st));
  const delta = u.maxHp - target;
  if (delta <= 0) return;
  u.maxHp = target;
  u.hp = Math.max(1, Math.min(u.maxHp, u.hp - delta));
}

function enterPhase2(world: World, st: EncRuntime, wrath: boolean): void {
  const boss = st.boss!;
  const u = liveUnit(world, boss.id);
  if (!u) return;
  boss.phase = 2;
  boss.wrath = wrath;
  u.untargetable = false;
  u.invulnerable = false;
  u.maxHp = regentHp(heartsAlive(st));
  u.hp = u.maxHp;
  // Step off the Throne toward the Hearth.
  const h = hearth(world);
  const hx = h ? centerOf(h).x : st.hearthX;
  const hy = h ? centerOf(h).y : st.hearthY;
  const dx = hx - boss.throneX;
  const dy = hy - boss.throneY;
  const len = Math.hypot(dx, dy) || 1;
  const [spot] = spawnSpots(world, boss.throneX + (dx / len) * 4.5, boss.throneY + (dy / len) * 4.5, 1, 4, new Map(), 1);
  u.x = u.prevX = spot.x;
  u.y = u.prevY = spot.y;
  if (wrath) u.buffs.push({ id: 'wrath', until: FOREVER, data: { damagePct: BOSS.wrathDamagePct } });
  boss.nextBurst = world.tick + 6 * SEC;
  boss.nextSnare = world.tick + 4 * SEC;
  boss.pending = [];
  const ai = aiOf(u);
  if (ai) beginAdvance(world, u, ai);
  emit(world, { t: 'bossPhase', phase: 2 });
  emit(world, { t: 'slowmo', factor: 0.3, duration: 0.3 });
  emit(world, { t: 'shake', magnitude: 8, duration: 0.5 });
  emit(world, {
    t: 'alert',
    kind: 'boss_phase',
    text: wrath
      ? `Wrath! The Regent tears free of its Throne: +${BOSS.wrathDamagePct}% damage, and the surviving Root Hearts keep sending waves.`
      : 'The Regent is uprooted.',
    x: u.x,
    y: u.y,
    priority: 'high',
  });
}

function cdMul(st: EncRuntime): number {
  return st.boss?.enraged ? 1 + BOSS.enrage.cooldownPct / 100 : 1;
}

function dmgMul(st: EncRuntime): number {
  return st.boss?.wrath ? 1 + BOSS.wrathDamagePct / 100 : 1;
}

function playerBuildingsNear(world: World, x: number, y: number, r: number): Building[] {
  const out: Building[] = [];
  for (const b of world.buildings) if (b.alive && b.owner === PLAYER && distToEntity(x, y, b) <= r) out.push(b);
  return out;
}

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

function castLance(world: World, st: EncRuntime, u: Unit): void {
  const boss = st.boss!;
  const throne = liveBuilding(world, boss.throneId);
  let target: Unit | null = null;
  let bestD = Infinity;
  for (const p of st.playerUnits) {
    if (!p.alive) continue;
    const dThrone = throne ? distToEntity(p.x, p.y, throne) : dist(p.x, p.y, boss.throneX, boss.throneY);
    if (dThrone > BOSS.thornLance.range) continue;
    const d = dist(u.x, u.y, p.x, p.y);
    if (d < bestD) {
      bestD = d;
      target = p;
    }
  }
  if (!target) {
    boss.nextLance = world.tick + SEC;
    return;
  }
  const d = Math.max(0.1, bestD);
  const ext = d + LANCE_OVERSHOOT;
  const tg: Telegraph = {
    kind: 'lance',
    fireTick: world.tick + Math.round(BOSS.thornLance.telegraph * SEC),
    x: u.x,
    y: u.y,
    x2: u.x + ((target.x - u.x) / d) * ext,
    y2: u.y + ((target.y - u.y) / d) * ext,
    radius: 0,
    width: LANCE_WIDTH,
  };
  boss.pending.push(tg);
  emit(world, { t: 'telegraph', shape: 'line', x: tg.x, y: tg.y, x2: tg.x2, y2: tg.y2, width: LANCE_WIDTH, duration: BOSS.thornLance.telegraph });
  boss.nextLance = world.tick + Math.round(BOSS.thornLance.interval * SEC);
}

function castBurst(world: World, st: EncRuntime, u: Unit): boolean {
  const boss = st.boss!;
  const r = BOSS.thornburst.radius;
  const anyone = st.playerUnits.some((p) => p.alive && dist(p.x, p.y, u.x, u.y) <= r + 1) || playerBuildingsNear(world, u.x, u.y, r).length > 0;
  if (!anyone) {
    boss.nextBurst = world.tick + SEC;
    return false;
  }
  const tg: Telegraph = {
    kind: 'burst',
    fireTick: world.tick + Math.round(BOSS.thornburst.telegraph * SEC),
    x: u.x,
    y: u.y,
    x2: u.x,
    y2: u.y,
    radius: r,
    width: 0,
  };
  boss.pending.push(tg);
  emit(world, { t: 'telegraph', shape: 'ring', x: u.x, y: u.y, radius: r, duration: BOSS.thornburst.telegraph });
  boss.nextBurst = world.tick + Math.round(BOSS.thornburst.interval * cdMul(st) * SEC);
  return true;
}

function castSnare(world: World, st: EncRuntime, u: Unit): void {
  const boss = st.boss!;
  const R = BOSS.rootsnare.radius;
  let best: Unit | null = null;
  let bestCount = 0;
  let bestD = Infinity;
  const near = st.playerUnits.filter((p) => p.alive && dist(p.x, p.y, u.x, u.y) <= BOSS.rootsnare.range);
  for (const p of near) {
    let count = 0;
    for (const q of near) if (dist(p.x, p.y, q.x, q.y) <= R) count++;
    const d = dist(p.x, p.y, u.x, u.y);
    if (count > bestCount || (count === bestCount && d < bestD)) {
      best = p;
      bestCount = count;
      bestD = d;
    }
  }
  if (!best) {
    boss.nextSnare = world.tick + SEC;
    return;
  }
  const tg: Telegraph = {
    kind: 'snare',
    fireTick: world.tick + Math.round(BOSS.rootsnare.telegraph * SEC),
    x: best.x,
    y: best.y,
    x2: best.x,
    y2: best.y,
    radius: R,
    width: 0,
  };
  boss.pending.push(tg);
  emit(world, { t: 'telegraph', shape: 'ring', x: tg.x, y: tg.y, radius: R, duration: BOSS.rootsnare.telegraph });
  boss.nextSnare = world.tick + Math.round(BOSS.rootsnare.interval * cdMul(st) * SEC);
}

function resolve(world: World, st: EncRuntime, u: Unit, tg: Telegraph): void {
  if (tg.kind === 'lance') {
    for (const p of st.playerUnits) {
      if (!p.alive) continue;
      if (pointSegment(p.x, p.y, tg.x, tg.y, tg.x2, tg.y2).d <= LANCE_WIDTH / 2 + p.radius) {
        dealAbilityDamage(world, p, BOSS.thornLance.damage, u.id);
      }
    }
    emit(world, { t: 'shake', magnitude: 3, duration: 0.15 });
    return;
  }
  if (tg.kind === 'burst') {
    const r = tg.radius;
    const mul = dmgMul(st);
    for (const p of st.playerUnits) {
      if (!p.alive || dist(p.x, p.y, tg.x, tg.y) > r + p.radius) continue;
      const raw = BOSS.thornburst.damage * mul * (p.cls === 'siege' ? BOSS.thornburst.vsSiege : 1);
      dealAbilityDamage(world, p, raw, u.id);
      if (!p.alive) continue;
      const d = dist(tg.x, tg.y, p.x, p.y) || 1;
      displaceUnit(world, p, ((p.x - tg.x) / d) * BOSS.thornburst.knockback, ((p.y - tg.y) / d) * BOSS.thornburst.knockback);
      emit(world, { t: 'knockback', id: p.id });
    }
    for (const b of playerBuildingsNear(world, tg.x, tg.y, r)) dealAbilityDamage(world, b, BOSS.thornburst.damage * mul, u.id);
    emit(world, { t: 'shake', magnitude: 6, duration: 0.3 });
    return;
  }
  // Rootsnare: root for 3 s (rooted units can still attack).
  const until = world.tick + Math.round(BOSS.rootsnare.duration * SEC);
  for (const p of st.playerUnits) {
    if (!p.alive || dist(p.x, p.y, tg.x, tg.y) > tg.radius + p.radius) continue;
    p.buffs = p.buffs.filter((b) => b.id !== 'rooted');
    p.buffs.push({ id: 'rooted', until });
  }
}

function courtSummons(world: World, st: EncRuntime, u: Unit): void {
  const boss = st.boss!;
  const th = BOSS.courtSummons.hpThresholds;
  while (boss.summonsDone < th.length && u.hp <= u.maxHp * th[boss.summonsDone]) {
    boss.summonsDone++;
    const weights: WeightEntry[] = BOSS.courtSummons.types.map((t) => [t, 1] as const);
    const comp = composeWave(st.rng, BOSS.courtSummons.value, weights, 7);
    const counts = countPools(world);
    const spots = spawnSpots(world, u.x, u.y, comp.types.length, 4, new Map(), 1);
    comp.types.forEach((type, i) => {
      if (counts.wave >= CAPS.enemyWave || counts.total >= CAPS.enemyTotal) return;
      const ai = makeAI(world, 'summon', type, { state: 'advance', postX: spots[i].x, postY: spots[i].y, leaderId: u.id });
      const s = spawnEnemy(world, type, spots[i].x, spots[i].y, ai);
      beginAdvance(world, s, ai);
      counts.wave++;
      counts.total++;
    });
    emit(world, { t: 'ability', name: 'court_summons', x: u.x, y: u.y, radius: 4, owner: u.owner });
    emit(world, { t: 'alert', kind: 'boss_phase', text: 'The Court answers the Regent.', x: u.x, y: u.y, priority: 'high' });
  }
}

// ---------------------------------------------------------------------------
// Movement / targeting (phase 2)
// ---------------------------------------------------------------------------

function thinkMarch(world: World, st: EncRuntime, u: Unit): void {
  const boss = st.boss!;
  const tick = world.tick;
  const warden = liveUnit(world, world.wardenId);
  if (boss.wardenChase) {
    if (!warden || dist(u.x, u.y, boss.wardenChase.x, boss.wardenChase.y) > BOSS.wardenChase) boss.wardenChase = null;
    else return driveAttack(world, u, warden.id);
  }
  if (warden && tick >= boss.wardenReadyTick && dist(u.x, u.y, warden.x, warden.y) <= BOSS.wardenRetargetRadius) {
    boss.wardenChase = { x: u.x, y: u.y };
    boss.wardenReadyTick = tick + Math.round(BOSS.wardenRetargetCooldown * SEC);
    return driveAttack(world, u, warden.id);
  }
  // Hits anything within 2 tiles on the way.
  let best: { id: number; d: number } | null = null;
  for (const p of st.playerUnits) {
    if (!p.alive || p.untargetable) continue;
    const d = unitEdgeDist(u, p);
    if (d <= BOSS.marchHitRadius && (!best || d < best.d)) best = { id: p.id, d };
  }
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== PLAYER) continue;
    const d = unitEdgeDist(u, b);
    if (d <= BOSS.marchHitRadius && (!best || d < best.d)) best = { id: b.id, d };
  }
  if (u.order.type === 'attack') {
    const cur = u.order.targetId;
    const e = world.entities.get(cur);
    if (e && e.alive && e.owner === PLAYER && unitEdgeDist(u, e) <= BOSS.marchHitRadius + 0.5) return;
  }
  if (best) return driveAttack(world, u, best.id);
  if (u.blockedBy && liveBuilding(world, u.blockedBy)) return driveAttack(world, u, u.blockedBy);
  const h = hearth(world);
  if (!h) return driveHold(world, u);
  // Close in: an attack order lets sim-core walk the Regent into swing range of the Hearth.
  if (unitEdgeDist(u, h) <= HEARTH_ENGAGE) return driveAttack(world, u, h.id);
  const c = centerOf(h);
  driveAdvance(world, u, c.x, c.y, 0);
}

export function tickBoss(world: World, st: EncRuntime): void {
  const boss = st.boss;
  if (!boss) return;
  const u = liveUnit(world, boss.id);
  if (!u) return;
  if (boss.phase === 1 && !boss.wrathWarned && world.time + 1e-6 >= BOSS.wrathTime - BOSS.wrathWarnLead) {
    boss.wrathWarned = true;
    if (heartsAlive(st) > 0 && world.time < BOSS.wrathTime) {
      emit(world, { t: 'alert', kind: 'boss_phase', text: `The Regent stirs. Wrath in ${fmtClock(BOSS.wrathTime - world.time)}.`, x: u.x, y: u.y, priority: 'high' });
      emit(world, { t: 'sfx', name: 'wave_horn' });
    }
  }
  if (boss.phase === 1 && world.time + 1e-6 >= BOSS.wrathTime) enterPhase2(world, st, heartsAlive(st) > 0);

  // Fire due telegraphs.
  if (boss.pending.length > 0) {
    const due = boss.pending.filter((t) => world.tick >= t.fireTick);
    if (due.length > 0) {
      boss.pending = boss.pending.filter((t) => world.tick < t.fireTick);
      for (const t of due) resolve(world, st, u, t);
    }
  }

  if (boss.phase === 1) {
    if (world.tick >= boss.nextLance && !boss.pending.some((t) => t.kind === 'lance')) castLance(world, st, u);
    if (u.order.type !== 'idle' || u.move) driveHold(world, u);
    return;
  }

  if (!boss.enraged && u.hp < u.maxHp * BOSS.enrage.hpPct) {
    boss.enraged = true;
    u.buffs.push({ id: 'enrage', until: FOREVER, data: { speedPct: BOSS.enrage.speedPct, cooldownPct: BOSS.enrage.cooldownPct } });
    emit(world, { t: 'alert', kind: 'boss_phase', text: 'The Regent is enraged!', x: u.x, y: u.y, priority: 'high' });
    emit(world, { t: 'shake', magnitude: 5, duration: 0.3 });
  }
  courtSummons(world, st, u);

  const bursting = boss.pending.some((t) => t.kind === 'burst');
  if (!bursting && world.tick >= boss.nextBurst && castBurst(world, st, u)) {
    driveHold(world, u);
    return;
  }
  if (world.tick >= boss.nextSnare && !boss.pending.some((t) => t.kind === 'snare')) castSnare(world, st, u);
  if (bursting) {
    driveHold(world, u);
    return;
  }
  const ai = aiOf(u);
  if (!ai) return;
  if (world.tick < ai.nextThink && u.order.type !== 'idle') return;
  ai.nextThink = world.tick + THINK_TICKS;
  thinkMarch(world, st, u);
}

/** Seconds until Wrath while the Regent is still Enthroned (phase 1), else null. */
export function wrathIn(world: World, st: EncRuntime): number | null {
  if (!st.boss || st.boss.phase !== 1) return null;
  return Math.max(0, BOSS.wrathTime - world.time);
}

export function bossView(world: World, st: EncRuntime): NonNullable<EncounterView['boss']> | null {
  const boss = st.boss;
  if (!boss) return null;
  const u = liveUnit(world, boss.id);
  const common = { name: UNITS.briar_regent.name, phase: boss.phase, enraged: boss.enraged, wrath: boss.wrath, wrathIn: wrathIn(world, st) };
  if (!u) return { ...common, hp: 0, maxHp: 1, warded: false };
  return { ...common, hp: u.hp, maxHp: u.maxHp, warded: boss.phase === 1 };
}
