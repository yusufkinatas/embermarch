/**
 * Player state: creation, effect composition, population and resource accounting. OWNER: sim-core.
 */
import { BUILDINGS } from '../data/buildings';
import { POP, START } from '../data/balance';
import { RESEARCH } from '../data/research';
import { RESOURCE_NAMES } from '../data/text';
import { computeFlags, invalidateStats } from './stats';
import type { BattleSetup, Cost, Effect, Owner, PlayerState, ResourceBag, World } from './types';
import { ENEMY, NEUTRAL, PLAYER, RESOURCE_TYPES } from './types';

function emptyBag(): ResourceBag {
  return { grain: 0, timber: 0, ember: 0 };
}

function baseEffects(setup: BattleSetup, owner: Owner): Effect[] {
  if (owner === PLAYER) return [...setup.playerEffects];
  if (owner === ENEMY) return [...setup.enemyEffects];
  return [];
}

function newPlayer(setup: BattleSetup, owner: Owner): PlayerState {
  const effects = baseEffects(setup, owner);
  const res = emptyBag();
  if (owner === PLAYER) {
    res.grain = START.res.grain;
    res.timber = START.res.timber;
    res.ember = START.res.ember;
    if (setup.biome === 'ashwood') res.grain += START.ashwoodBonusGrain;
    for (const e of effects) {
      if (e.kind !== 'startRes') continue;
      for (const r of RESOURCE_TYPES) res[r] += e.res[r] ?? 0;
    }
    for (const r of RESOURCE_TYPES) res[r] += setup.bonusRes[r] ?? 0;
  }
  return {
    owner,
    res,
    pop: 0,
    popCap: 0,
    researched: [],
    temper: null,
    unlockedUnits: owner === PLAYER ? [...setup.unlockedUnits] : [],
    unlockedBuildings: owner === PLAYER ? [...setup.unlockedBuildings] : [],
    effects,
    flags: computeFlags(effects),
    rallyReadyTick: 0,
    rallyUntilTick: 0,
    abilityReadyTick: { Q: 0, W: 0 },
    wardenRespawnTick: -1,
    wardenDeaths: 0,
    stats: {
      gathered: emptyBag(),
      unitsTrained: 0,
      unitsLost: 0,
      kills: 0,
      buildingsBuilt: 0,
      buildingsLost: 0,
    },
    popAlertTick: 0,
  };
}

/** Player, enemy and neutral states with effects composed from the setup. */
export function createPlayerStates(setup: BattleSetup): [PlayerState, PlayerState, PlayerState] {
  return [newPlayer(setup, PLAYER), newPlayer(setup, ENEMY), newPlayer(setup, NEUTRAL)];
}

/** Rebuild an owner's effect list (setup + completed research) and flags; invalidates the stat cache. */
export function recomposeEffects(world: World, owner: Owner): void {
  const p = world.players[owner];
  const effects = baseEffects(world.setup, owner);
  for (const id of p.researched) effects.push(...RESEARCH[id].effects);
  p.effects = effects;
  p.flags = computeFlags(effects);
  invalidateStats(world);
}

/** Pop cap = Σ completed building pop bonuses + popCap effects, hard cap 60. */
export function recomputePopCap(world: World): void {
  const p = world.players[PLAYER];
  let cap = 0;
  for (const b of world.buildings) {
    if (!b.alive || !b.built || b.owner !== PLAYER) continue;
    cap += BUILDINGS[b.type].popBonus ?? 0;
  }
  for (const e of p.effects) if (e.kind === 'popCap') cap += e.add;
  p.popCap = Math.max(0, Math.min(POP.hardCap, cap));
}

export function canPay(p: PlayerState, cost: Cost): boolean {
  for (const r of RESOURCE_TYPES) if ((cost[r] ?? 0) > p.res[r] + 1e-9) return false;
  return true;
}

/** First missing resource, as a player-facing reason ("Not enough Timber"), or undefined. */
export function missingReason(p: PlayerState, cost: Cost): string | undefined {
  for (const r of RESOURCE_TYPES) if ((cost[r] ?? 0) > p.res[r] + 1e-9) return `Not enough ${RESOURCE_NAMES[r]}`;
  return undefined;
}

export function pay(p: PlayerState, cost: Cost): void {
  for (const r of RESOURCE_TYPES) p.res[r] -= cost[r] ?? 0;
}

export function refund(p: PlayerState, cost: Cost, fraction = 1): void {
  for (const r of RESOURCE_TYPES) p.res[r] += Math.floor((cost[r] ?? 0) * fraction + 1e-6);
}

export function addRes(p: PlayerState, cost: Cost): void {
  for (const r of RESOURCE_TYPES) p.res[r] += cost[r] ?? 0;
}
