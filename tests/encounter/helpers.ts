/**
 * Real-world fixtures for encounter integration tests (real mapgen + sim-core + nav).
 */
import { generateMap } from '../../src/mapgen';
import { createWorld, stepWorld } from '../../src/sim/world';
import {
  ENEMY,
  PLAYER,
  type BattleSetup,
  type DoctrineId,
  type GeneratedMap,
  type ModifierId,
  type ObjectiveId,
  type Unit,
  type World,
} from '../../src/sim/types';

export interface RealOpts {
  objective?: ObjectiveId;
  depth?: number;
  modifiers?: ModifierId[];
  doctrine?: DoctrineId;
  tier?: number;
  seed?: number;
  coldWatchfire?: boolean;
  waveMult?: number;
}

export function makeSetup(o: RealOpts = {}): BattleSetup {
  const objective = o.objective ?? 'raze';
  const isBoss = objective === 'boss';
  return {
    seed: o.seed ?? 7,
    nodeId: `enc-${objective}`,
    objective,
    biome: isBoss ? 'heartwood' : 'greenmarch',
    depth: isBoss ? 7 : (o.depth ?? 1),
    isElite: objective === 'elite',
    isBoss,
    modifiers: o.modifiers ?? [],
    doctrine: o.doctrine ?? 'swarm',
    tier: o.tier ?? 0,
    house: 'ardent',
    vanguard: 'muster_hall',
    unlockedUnits: ['tiller', 'ashpike', 'bowman', 'courser'],
    unlockedBuildings: ['cottage', 'storehouse', 'grainplot', 'muster_hall', 'bowyard', 'paddock', 'forgehall', 'brazier_tower'],
    playerEffects: [],
    enemyEffects: [],
    boons: [],
    metaUnlocks: [],
    retinue: [],
    sellswords: [],
    wardenHpPct: 1,
    resolve: 3,
    waveMult: o.waveMult ?? 1,
    coldWatchfire: !!o.coldWatchfire,
    showHints: false,
    bonusRes: {},
  };
}

const mapCache = new Map<string, GeneratedMap>();

export function realWorld(o: RealOpts = {}): World {
  const setup = makeSetup(o);
  const key = `${setup.objective}|${setup.depth}|${setup.seed}|${setup.modifiers.join(',')}`;
  let gen = mapCache.get(key);
  if (!gen) {
    gen = generateMap({ seed: setup.seed, objective: setup.objective, biome: setup.biome, depth: setup.depth, modifiers: setup.modifiers });
    mapCache.set(key, gen);
  }
  return createWorld(setup, gen);
}

/** Advance until the battle clock reaches t (runs the Kindle countdown first). */
export function runTo(world: World, t: number, each?: (w: World) => void): void {
  let guard = 0;
  while ((world.countdown > 0 || world.time < t) && world.outcome === 'ongoing' && guard++ < 200000) {
    stepWorld(world);
    if (each) each(world);
  }
}

export function enemies(world: World, role?: string): Unit[] {
  return world.units.filter((u) => u.alive && u.owner === ENEMY && (!role || u.ai?.role === role));
}

export function playerUnits(world: World): Unit[] {
  return world.units.filter((u) => u.alive && u.owner === PLAYER);
}

export function hearthCenter(world: World): { x: number; y: number } {
  const h = world.entities.get(world.hearthId);
  if (!h || h.kind !== 'building') return { x: world.anchors.hearth.tx + 2, y: world.anchors.hearth.ty + 2 };
  return { x: h.tx + h.w / 2, y: h.ty + h.h / 2 };
}
