/**
 * Runs a full battle headlessly: real mapgen + createWorld + stepWorld, driven by the scripted Bot.
 * Records waves, combat at the base, economy snapshots, NaN checks and per-tick timings.
 */
import { generateMap } from '../../src/mapgen';
import { quickBattleSetup } from '../../src/run';
import { getEncounterView } from '../../src/sim/encounter';
import { buildBattleResult, createWorld, drainEvents, stepWorld } from '../../src/sim/world';
import type { BattleResult, ModifierId, ObjectiveId, ResourceBag, World } from '../../src/sim/types';
import { ENEMY, PLAYER, TICK_RATE } from '../../src/sim/types';
import { Bot, census, type BotConfig } from './bot';

export interface BattleRunOpts {
  objective: ObjectiveId;
  depth?: number;
  seed: number;
  maxTime: number;
  modifiers?: ModifierId[];
  bot?: Partial<BotConfig>;
  /** Called after every tick. */
  each?: (w: World) => void;
}

export interface Snapshot {
  t: number;
  tillers: number;
  army: number;
  enemies: number;
  pop: number;
  popCap: number;
  res: ResourceBag;
  gathered: ResourceBag;
}

export interface BattleRun {
  world: World;
  bot: Bot;
  result: BattleResult;
  musters: { wave: number; t: number }[];
  launches: { wave: number; t: number }[];
  broken: { wave: number; t: number }[];
  /** Enemy hits landed on player entities within 12 tiles of the Hearth. */
  baseHits: number;
  /** Player hits landed on enemy units. */
  playerHits: number;
  /** Closest any wave unit came to the Hearth center. */
  closestWave: number;
  snapshots: Snapshot[];
  nanAt: string | null;
  maxEnemies: number;
  maxWavePool: number;
  tickMs: { avg: number; p99: number; max: number; ticks: number };
  nestDeaths: number[];
  events: Record<string, number>;
  /** Battle time of the first unit trained (null if none). */
  firstTrained: number | null;
  /** Telegraph / bossPhase / lastStand style events seen, by type. */
  bossPhases: { phase: number; t: number }[];
  /** Player unit deaths by the type of the last enemy that hit them. */
  deathsBy: Record<string, number>;
  /** Enemy unit deaths by the type of the last player entity that hit them. */
  killsBy: Record<string, number>;
}

export function runBattle(o: BattleRunOpts): BattleRun {
  const setup = quickBattleSetup({ objective: o.objective, depth: o.depth, seed: o.seed, modifiers: o.modifiers });
  const gen = generateMap({ seed: setup.seed, objective: setup.objective, biome: setup.biome, depth: setup.depth, modifiers: setup.modifiers });
  const world = createWorld(setup, gen);
  const bot = new Bot(world, o.bot);
  const run: Omit<BattleRun, 'result' | 'tickMs'> = {
    world,
    bot,
    musters: [],
    launches: [],
    broken: [],
    baseHits: 0,
    playerHits: 0,
    closestWave: Infinity,
    snapshots: [],
    nanAt: null,
    maxEnemies: 0,
    maxWavePool: 0,
    nestDeaths: [],
    events: {},
    deathsBy: {},
    killsBy: {},
    firstTrained: null,
    bossPhases: [],
  };
  const lastHit = new Map<number, string>();
  const h0 = world.entities.get(world.hearthId)!;
  const hx = h0.x;
  const hy = h0.y;
  const times: number[] = [];
  while (world.countdown > 0) stepWorld(world);
  drainEvents(world);
  let nextSnap = 30;
  while (world.outcome === 'ongoing' && world.time < o.maxTime) {
    bot.update();
    const t0 = performance.now();
    stepWorld(world);
    times.push(performance.now() - t0);
    o.each?.(world);
    for (const ev of drainEvents(world)) {
      bot.onEvent(ev);
      run.events[ev.t] = (run.events[ev.t] ?? 0) + 1;
      if (ev.t === 'waveMuster') run.musters.push({ wave: ev.wave, t: world.time });
      else if (ev.t === 'waveLaunch') run.launches.push({ wave: ev.wave, t: world.time });
      else if (ev.t === 'waveBroken') run.broken.push({ wave: ev.wave, t: world.time });
      else if (ev.t === 'nestDestroyed') run.nestDeaths.push(world.time);
      else if (ev.t === 'trained') run.firstTrained ??= world.time;
      else if (ev.t === 'bossPhase') run.bossPhases.push({ phase: ev.phase, t: world.time });
      else if (ev.t === 'death' && ev.kind === 'unit') {
        const by = lastHit.get(ev.id) ?? 'none';
        const bag = ev.owner === PLAYER ? run.deathsBy : run.killsBy;
        const key = ev.owner === PLAYER ? `${ev.type}<-${by}` : `${by}->${ev.type}`;
        bag[key] = (bag[key] ?? 0) + 1;
        lastHit.delete(ev.id);
      } else if (ev.t === 'hit') {
        const atk = world.entities.get(ev.attackerId);
        if (atk) lastHit.set(ev.targetId, atk.kind === 'unit' || atk.kind === 'building' ? atk.type : '?');
        if (ev.targetOwner === PLAYER && atk && atk.owner === ENEMY && Math.hypot(ev.x - hx, ev.y - hy) <= 12) run.baseHits++;
        if (ev.targetOwner === ENEMY && !ev.isStructure) run.playerHits++;
      }
    }
    if (world.tick % 10 === 0) {
      let enemies = 0;
      let pool = 0;
      for (const u of world.units) {
        if (!Number.isFinite(u.x) || !Number.isFinite(u.y) || !Number.isFinite(u.hp) || !Number.isFinite(u.vx) || !Number.isFinite(u.vy)) {
          run.nanAt ??= `${u.type}#${u.id} at t=${world.time.toFixed(2)}: (${u.x}, ${u.y}) hp ${u.hp}`;
        }
        if (u.x < 0 || u.y < 0 || u.x > world.map.w || u.y > world.map.h) run.nanAt ??= `${u.type}#${u.id} off-map (${u.x}, ${u.y})`;
        if (!u.alive || u.owner !== ENEMY) continue;
        enemies++;
        const role = u.ai?.role;
        if (role === 'wave' || role === 'raid' || role === 'summon' || role === 'noble') pool++;
        if (role === 'wave') run.closestWave = Math.min(run.closestWave, Math.hypot(u.x - hx, u.y - hy));
      }
      for (const p of world.projectiles) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) run.nanAt ??= `projectile ${p.kind} NaN at t=${world.time.toFixed(2)}`;
      }
      run.maxEnemies = Math.max(run.maxEnemies, enemies);
      run.maxWavePool = Math.max(run.maxWavePool, pool);
    }
    if (world.tick % (5 * TICK_RATE) === 0) getEncounterView(world);
    if (world.time >= nextSnap) {
      nextSnap += 30;
      const p = world.players[PLAYER];
      run.snapshots.push({
        t: Math.round(world.time),
        tillers: bot.tillers().length,
        army: bot.army().length,
        enemies: world.units.filter((u) => u.alive && u.owner === ENEMY).length,
        pop: p.pop,
        popCap: p.popCap,
        res: { grain: Math.floor(p.res.grain), timber: Math.floor(p.res.timber), ember: Math.floor(p.res.ember) },
        gathered: { grain: Math.floor(p.stats.gathered.grain), timber: Math.floor(p.stats.gathered.timber), ember: Math.floor(p.stats.gathered.ember) },
      });
    }
  }
  const sorted = [...times].sort((a, b) => a - b);
  const result = buildBattleResult(world, world.outcome === 'ongoing' ? 'retreat' : world.outcome);
  return {
    ...run,
    result,
    tickMs: {
      avg: times.reduce((s, x) => s + x, 0) / Math.max(1, times.length),
      p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      ticks: times.length,
    },
  };
}

export function summarize(r: BattleRun): string {
  const w = r.world;
  const lines = [
    `${w.setup.objective} d${w.setup.depth} seed ${w.setup.seed} (${w.setup.biome}, ${w.setup.doctrine}): ${w.outcome} at ${fmt(w.time)}`,
    `  tick ms avg ${r.tickMs.avg.toFixed(3)} p99 ${r.tickMs.p99.toFixed(2)} max ${r.tickMs.max.toFixed(1)} over ${r.tickMs.ticks}`,
    `  musters ${r.musters.map((m) => `${m.wave}@${fmt(m.t)}`).join(' ')}`,
    `  launches ${r.launches.map((m) => `${m.wave}@${fmt(m.t)}`).join(' ')}`,
    `  broken ${r.broken.map((m) => `${m.wave}@${fmt(m.t)}`).join(' ')}`,
    `  nest deaths ${r.nestDeaths.map(fmt).join(' ')}; baseHits ${r.baseHits}; playerHits ${r.playerHits}; closest wave ${r.closestWave.toFixed(1)}`,
    `  maxEnemies ${r.maxEnemies} maxWavePool ${r.maxWavePool}; result plunder ${r.result.plunderCrowns} nests ${r.result.nestsDestroyed} underPar ${r.result.underPar}`,
    `  player ${JSON.stringify(census(w, PLAYER))} enemy ${JSON.stringify(census(w, ENEMY))}`,
    `  stats ${JSON.stringify(w.players[PLAYER].stats)}`,
    `  deathsBy ${JSON.stringify(r.deathsBy)}`,
    `  killsBy ${JSON.stringify(r.killsBy)}`,
    `  bot: ${r.bot.stats.commands} cmds, pushes ${r.bot.stats.pushes}, defends ${r.bot.stats.defends}, failed ${JSON.stringify(r.bot.stats.failed)}`,
    ...r.snapshots.map(
      (s) =>
        `  ${fmt(s.t)} T${s.tillers} A${s.army} E${s.enemies} pop ${s.pop}/${s.popCap} res ${s.res.grain}/${s.res.timber}/${s.res.ember} gathered ${s.gathered.grain}/${s.gathered.timber}/${s.gathered.ember}`,
    ),
    `  log: ${r.bot.stats.log.join(' | ')}`,
  ];
  return lines.join('\n');
}

export function fmt(t: number): string {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}
