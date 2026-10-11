/**
 * BattleSetup composition (run layer → sim). GDD §B (carried state), §C (common start), §K modifiers,
 * §L Boons/Drafts/Events, §N Houses/meta/Thornbound.
 */
import { Rng, randomSeed } from '../core/rng';
import {
  BAGGAGE_TRAIN,
  BOONS,
  DRAFTS,
  HINTS,
  HOUSES,
  META_UNLOCKS,
  MODIFIERS,
  RESOLVE,
  RETINUE,
  VANGUARD_IDS,
  thornboundFor,
} from '../data';
import type {
  BattleSetup,
  BoonId,
  CarriedUnit,
  Cost,
  DraftId,
  Effect,
  HouseId,
  MetaUnlockId,
  ModifierId,
  ObjectiveId,
  PlayerBuildingId,
  PlayerUnitId,
  ResourceBag,
  VanguardId,
} from '../sim/types';
import { BOSS_DEPTH, rollBiome, rollDoctrine } from './runmap';
import { saveRun } from './persistence';
import type { MetaSave, RunNode, RunState } from './types';
import { CORE_BUILDINGS, CORE_UNITS, atLeastRank, cloneUnits, currentNodeOf, findPending, isBattleNode } from './util';

/** Units and buildings unlocked by the core set plus drafts. */
export function unlockedFor(drafts: readonly DraftId[]): { units: PlayerUnitId[]; buildings: PlayerBuildingId[] } {
  const units = [...CORE_UNITS];
  const buildings = [...CORE_BUILDINGS];
  for (const d of drafts) {
    for (const u of DRAFTS[d].units) if (!units.includes(u)) units.push(u);
    for (const b of DRAFTS[d].buildings) if (!buildings.includes(b)) buildings.push(b);
  }
  return { units, buildings };
}

export function modifierEffects(mods: readonly ModifierId[]): { player: Effect[]; enemy: Effect[] } {
  const player: Effect[] = [];
  const enemy: Effect[] = [];
  for (const m of mods) {
    player.push(...(MODIFIERS[m].playerEffects ?? []));
    enemy.push(...(MODIFIERS[m].enemyEffects ?? []));
  }
  return { player, enemy };
}

export function boonEffects(boons: readonly BoonId[]): Effect[] {
  return boons.flatMap((b) => BOONS[b].effects);
}

export function metaEffects(unlocks: readonly MetaUnlockId[]): Effect[] {
  return unlocks.flatMap((u) => META_UNLOCKS[u].effects ?? []);
}

/**
 * Node modifiers plus a pending Blood Moon (Hollow Envoy "Cut him down").
 * The boss battle never has modifiers (§K), so a pending Blood Moon does not reach it.
 */
export function effectiveModifiers(run: RunState, node: RunNode): ModifierId[] {
  if (node.type === 'boss') return [];
  const mods = [...(node.battle?.modifiers ?? [])];
  if (findPending(run, 'blood_moon_next') && !mods.includes('blood_moon')) mods.push('blood_moon');
  return mods;
}

/** Retinue as it will spawn (Grimbrand: Rank I or higher). */
export function retinueForBattle(run: RunState): CarriedUnit[] {
  const units = cloneUnits(run.retinue);
  return run.house === 'grimbrand' ? units.map((u) => atLeastRank(u, RETINUE.grimbrandMinRank)) : units;
}

/** Baggage Train carry-over from unspent resources: 50% (max 250 each), at least +75 Ember. */
export function baggageFrom(unspent: ResourceBag): ResourceBag {
  const half = (v: number) => Math.min(BAGGAGE_TRAIN.maxEach, Math.floor(Math.max(0, v) * BAGGAGE_TRAIN.fraction));
  return {
    grain: half(unspent.grain),
    timber: half(unspent.timber),
    ember: Math.max(BAGGAGE_TRAIN.minEmber, half(unspent.ember)),
  };
}

/** True while the profile still needs onboarding help (first 3 runs or unseen hints). */
export function showHintsFor(run: RunState, meta: MetaSave): boolean {
  if (!meta.settings.showHints) return false;
  return run.profileRunIndex < 3 || HINTS.some((h) => !meta.hintsSeen.includes(h.id));
}

/** The BattleSetup for a run battle node (pure: does not mutate the run). */
export function composeSetup(run: RunState, meta: MetaSave, node: RunNode, vanguard: VanguardId): BattleSetup {
  const info = node.battle;
  if (!info) throw new Error(`Node ${node.id} is not a battle`);
  const modifiers = effectiveModifiers(run, node);
  const mod = modifierEffects(modifiers);
  const { units, buildings } = unlockedFor(run.drafts);

  const playerEffects: Effect[] = [...HOUSES[run.house].effects, ...boonEffects(run.boons), ...metaEffects(meta.unlocks)];
  if (run.extraTillers > 0) playerEffects.push({ kind: 'startUnits', unit: 'tiller', count: run.extraTillers });
  playerEffects.push(...mod.player);
  for (const p of run.pending) if (p.kind === 'grain_gather_penalty') playerEffects.push({ kind: 'gather', res: 'grain', pct: p.pct });

  const bonusRes: Cost = {};
  const bag = findPending(run, 'baggage');
  if (bag) {
    bonusRes.grain = bag.res.grain;
    bonusRes.timber = bag.res.timber;
    bonusRes.ember = bag.res.ember;
  }

  return {
    seed: info.seed,
    nodeId: node.id,
    objective: info.objective,
    biome: info.biome,
    depth: info.depth,
    isElite: node.type === 'elite',
    isBoss: node.type === 'boss',
    modifiers,
    doctrine: info.doctrine,
    tier: run.tier,
    house: run.house,
    vanguard,
    unlockedUnits: units,
    unlockedBuildings: buildings,
    playerEffects,
    enemyEffects: mod.enemy,
    boons: [...run.boons],
    metaUnlocks: [...meta.unlocks],
    retinue: retinueForBattle(run),
    sellswords: cloneUnits(run.sellswords),
    wardenHpPct: findPending(run, 'warden_half_hp') ? 0.5 : 1,
    resolve: run.resolve,
    waveMult: run.waveMult * thornboundFor(run.tier).waveMult,
    coldWatchfire: !!findPending(run, 'cold_watchfire'),
    showHints: showHintsFor(run, meta),
    bonusRes,
  };
}

/** startBattle: build the setup for the current battle node, set battleInProgress, save. */
export function startBattle(run: RunState, meta: MetaSave, vanguard: VanguardId): BattleSetup {
  if (run.over) throw new Error('The run is over');
  const node = currentNodeOf(run);
  if (!node || !isBattleNode(node)) throw new Error('The current node is not a battle');
  if (run.nodesDone.includes(node.id)) throw new Error(`Battle ${node.id} is already done`);
  if (!VANGUARD_IDS.includes(vanguard)) throw new Error(`Unknown Vanguard "${vanguard}"`);
  const setup = composeSetup(run, meta, node, vanguard);
  run.battleInProgress = true;
  saveRun(run);
  return setup;
}

export interface QuickBattleOptions {
  objective: ObjectiveId;
  depth?: number;
  seed?: number;
  house?: HouseId;
  modifiers?: ModifierId[];
  boons?: BoonId[];
  drafts?: DraftId[];
  vanguard?: VanguardId;
}

const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** Standalone BattleSetup without a run (dev URL params, tests, debug API). Deterministic for a seed. */
export function quickBattleSetup(opts: QuickBattleOptions): BattleSetup {
  const seed = (opts.seed ?? randomSeed()) >>> 0;
  const boss = opts.objective === 'boss';
  const depth = boss ? BOSS_DEPTH : Math.max(1, Math.min(6, Math.floor(opts.depth ?? 1)));
  const rng = new Rng(seed).fork('quick');
  const modifiers = boss ? [] : uniq(opts.modifiers ?? []);
  const biome = boss ? 'heartwood' : rollBiome(rng, depth);
  const doctrine = rollDoctrine(rng, depth, modifiers);
  const house = opts.house ?? 'ardent';
  const boons = uniq(opts.boons ?? []);
  const drafts = uniq(opts.drafts ?? []);
  const { units, buildings } = unlockedFor(drafts);
  const mod = modifierEffects(modifiers);
  return {
    seed,
    nodeId: `quick-${opts.objective}-d${depth}`,
    objective: opts.objective,
    biome,
    depth,
    isElite: opts.objective === 'elite',
    isBoss: boss,
    modifiers,
    doctrine,
    tier: 0,
    house,
    vanguard: opts.vanguard ?? 'muster_hall',
    unlockedUnits: units,
    unlockedBuildings: buildings,
    playerEffects: [...HOUSES[house].effects, ...boonEffects(boons), ...mod.player],
    enemyEffects: mod.enemy,
    boons,
    metaUnlocks: [],
    retinue: [],
    sellswords: [],
    wardenHpPct: 1,
    resolve: RESOLVE.start,
    waveMult: 1,
    coldWatchfire: false,
    showHints: false,
    bonusRes: {},
  };
}
