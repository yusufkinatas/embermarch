/**
 * Enemy spawning helpers: AI records, pool accounting (standing 30 / wave 50 / total 80),
 * standing groups on posts around an anchor.
 */
import { CAPS, ENEMY_AI, GARRISON } from '../../data/balance';
import { UNITS } from '../../data/units';
import { spawnUnit } from '../entities';
import { ENEMY, TICK_RATE, type EnemyUnitId, type Unit, type World } from '../types';
import { spawnSpots } from './geom';
import type { Band, EncRuntime, EnemyAI, Role } from './state';

export const THINK_TICKS = Math.max(1, Math.round(ENEMY_AI.retargetInterval * TICK_RATE));

const WAVE_POOL: ReadonlySet<Role> = new Set<Role>(['wave', 'raid', 'summon', 'noble']);
const STANDING: ReadonlySet<Role> = new Set<Role>(['garrison', 'picket', 'lurker', 'beacon_guard']);

export function isWavePoolRole(role: Role): boolean {
  return WAVE_POOL.has(role);
}
export function isStandingRole(role: Role): boolean {
  return STANDING.has(role);
}

export interface PoolCounts {
  wave: number;
  standing: number;
  total: number;
}

/** Alive enemy units by pool. */
export function countPools(world: World): PoolCounts {
  const c: PoolCounts = { wave: 0, standing: 0, total: 0 };
  for (const u of world.units) {
    if (!u.alive || u.owner !== ENEMY) continue;
    c.total++;
    const role = u.ai?.role;
    if (!role) continue;
    if (WAVE_POOL.has(role)) c.wave++;
    else if (STANDING.has(role)) c.standing++;
  }
  return c;
}

export function canSpawnWave(c: PoolCounts): boolean {
  return c.wave < CAPS.enemyWave && c.total < CAPS.enemyTotal;
}
export function canSpawnStanding(c: PoolCounts): boolean {
  return c.standing < CAPS.enemyStanding && c.total < CAPS.enemyTotal;
}

export function bandOf(type: EnemyUnitId): Band {
  if (type === 'stagrider' || type === 'antlered_lord') return 'riders';
  if (UNITS[type].cls === 'siege') return 'siege';
  return 'main';
}

export interface AIOpts {
  state?: EnemyAI['state'];
  postX: number;
  postY: number;
  anchorX?: number;
  anchorY?: number;
  leash?: number;
  aggro?: number;
  wave?: number;
  nestId?: number;
  leaderId?: number;
  waveUid?: number;
}

export function makeAI(world: World, role: Role, type: EnemyUnitId, o: AIOpts): EnemyAI {
  return {
    role,
    state: o.state ?? 'post',
    postX: o.postX,
    postY: o.postY,
    wave: o.wave ?? -1,
    speedCap: 0,
    noKite: false,
    nestId: o.nestId ?? 0,
    anchorX: o.anchorX ?? o.postX,
    anchorY: o.anchorY ?? o.postY,
    leash: o.leash ?? GARRISON.leashRadius,
    aggro: o.aggro ?? GARRISON.aggroRadius,
    value: UNITS[type].value ?? 0,
    band: bandOf(type),
    engageX: NaN,
    engageY: NaN,
    ignoreId: 0,
    ignoreUntil: -1,
    forcedId: 0,
    forcedUntil: -1,
    lastDealtTick: -1,
    idleX: o.postX,
    idleY: o.postY,
    idleSince: world.tick,
    nextThink: world.tick,
    huntUntil: -1,
    leaderId: o.leaderId ?? 0,
    waveUid: o.waveUid ?? 0,
    goalId: 0,
    siegeTicks: 0,
    siegeTick: -1,
    committed: false,
  };
}

/** Spawn an enemy unit with an AI record. */
export function spawnEnemy(world: World, type: EnemyUnitId, x: number, y: number, ai: EnemyAI): Unit {
  const u = spawnUnit(world, type, ENEMY, x, y);
  ai.idleX = u.x;
  ai.idleY = u.y;
  ai.idleSince = world.tick;
  ai.nextThink = world.tick + (u.id % THINK_TICKS);
  u.ai = ai;
  u.homeX = ai.postX;
  u.homeY = ai.postY;
  return u;
}

export interface StandingGroupOpts {
  role: Role;
  types: EnemyUnitId[];
  /** Ring center (anchor) and post ring radius. */
  cx: number;
  cy: number;
  ringR: number;
  leash: number;
  aggro: number;
  nestId?: number;
  used: Map<number, number>;
}

/** Spawn a standing group on posts spread around an anchor. Skips units over the standing/total caps. */
export function spawnStandingGroup(world: World, st: EncRuntime, g: StandingGroupOpts): number[] {
  const ids: number[] = [];
  const n = g.types.length;
  if (n === 0) return ids;
  const counts = countPools(world);
  const a0 = st.rng.next() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    if (!canSpawnStanding(counts)) break;
    const a = a0 + (i / n) * Math.PI * 2;
    const px = g.cx + Math.cos(a) * g.ringR;
    const py = g.cy + Math.sin(a) * g.ringR;
    const [spot] = spawnSpots(world, px, py, 1, 3, g.used, 1);
    const type = g.types[i];
    const ai = makeAI(world, g.role, type, {
      state: 'post',
      postX: spot.x,
      postY: spot.y,
      anchorX: g.cx,
      anchorY: g.cy,
      leash: g.leash,
      aggro: g.aggro,
      nestId: g.nestId,
    });
    const u = spawnEnemy(world, type, spot.x, spot.y, ai);
    ids.push(u.id);
    counts.standing++;
    counts.total++;
  }
  return ids;
}
