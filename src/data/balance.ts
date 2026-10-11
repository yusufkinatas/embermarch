/**
 * EMBERMARCH balance constants and depth formulas, transcribed from docs/GDD.md.
 *
 * Every gameplay number lives here or in a sibling data table (units.ts, buildings.ts, ...).
 * Pure data plus tiny pure formula helpers. No world access, no randomness.
 *
 * Conventions (GDD preamble):
 * - Distances in tiles, speeds in tiles/s, times in seconds.
 * - `d` is battle depth (column index of a battle node, 1-6). The boss uses BOSS constants.
 * - Floors use `Math.floor(x + 1e-6)` to avoid float drift (see `floorEps`).
 * - Percent values are written as percentages (15 = +15%) when they feed an Effect, and as
 *   multipliers (1.5) when they are applied directly by a module.
 */
import type {
  BiomeId,
  Cost,
  DoctrineId,
  EnemyUnitId,
  ModifierId,
  ObjectiveId,
  PlayerUnitId,
  ResourceBag,
  UnitClass,
} from '../sim/types';

/** GDD preamble: floors use Math.floor(x + 1e-6). */
export const FLOOR_EPS = 1e-6;
export function floorEps(x: number): number {
  return Math.floor(x + FLOOR_EPS);
}

// ===========================================================================
// Battle start (§C "Common start", §K Ashwood twist)
// ===========================================================================

export const START = {
  /** 250 Grain / 300 Timber / 75 Ember. */
  res: { grain: 250, timber: 300, ember: 75 } as ResourceBag,
  tillers: 7,
  /** 1 free Courser scout per battle. */
  coursers: 1,
  /** Explored radius around the Hearth center at battle start. */
  exploreRadius: 10,
  /** "Kindle!" countdown before the battle clock starts. */
  countdown: 3,
  /** Ashwood twist: +100 starting Grain. */
  ashwoodBonusGrain: 100,
};

// ===========================================================================
// Population and engine caps (§D)
// ===========================================================================

export const POP = {
  hearth: 20,
  cottage: 6,
  /** Hard cap on pop cap. */
  hardCap: 60,
  /** "Need Cottages" alert fires at most this often (s). */
  alertInterval: 15,
  /** New units spawn on the nearest free tile within this BFS radius of the building edge... */
  spawnSearchRadius: 6,
  /** ...else retry every this many seconds. */
  spawnRetryInterval: 1,
};

/** Engine unit caps (§D "Engine caps"). */
export const CAPS = {
  playerPop: 60,
  /** Garrisons, Picket guards, Lurkers, Beacon guards. */
  enemyStanding: 30,
  /** Waves, raids, Noble and Court summons, the Noble itself. */
  enemyWave: 50,
  enemyTotal: 80,
};

// ===========================================================================
// Gathering (§D)
// ===========================================================================

export type GatherSource = 'thicket' | 'tree' | 'ember_seam' | 'grainplot';

export const GATHER = {
  /** Base carry per trip (all resources). */
  carry: 10,
  tillerSpeed: 2.2,
  /** Gather rate per Tiller per second. */
  rates: { thicket: 1.0, tree: 0.8, ember_seam: 0.6, grainplot: 0.6 } as Record<GatherSource, number>,
  maxGatherers: { thicket: 2, tree: 2, ember_seam: 6, grainplot: 2 } as Record<GatherSource, number>,
  /** Drop-off overhead per trip in the net-income formula (s). */
  dropoffOverhead: 0.3,
  /** A Tiller standing on Blight gathers at this multiplier. */
  blightMul: 0.6,
  /** Full node: try the same resource within this radius... */
  fullNodeSearchRadius: 8,
  /** ...else wait this long and retry once, then go idle. */
  fullNodeWait: 3,
  fullNodeRetries: 1,
  /** Depleted node: seek the same resource within this radius, else idle. */
  depletedSearchRadius: 8,
  /** A builder whose remembered source ran out while it built looks this far for the same resource. */
  resumeSearchRadius: 10,
};

/** Tiller flee rules (§D). */
export const FLEE = {
  /** Flee to the nearest drop-off with no enemy within this radius of it (else the Hearth). */
  dropoffClearRadius: 6,
  /** Resume the job after this many seconds with no enemy within `resumeClearRadius`. */
  resumeDelay: 8,
  resumeClearRadius: 8,
};

/** Net income per Tiller with walking (§D): carry / (carry/rate + 2·dist/speed + 0.3). */
export function netIncome(carry: number, rate: number, dist: number, speed = GATHER.tillerSpeed): number {
  return carry / (carry / rate + (2 * dist) / speed + GATHER.dropoffOverhead);
}

/** Resource node amounts (§D, §K). */
export const RESOURCE_AMOUNTS = {
  thicket: 150,
  tree: 120,
  treeAshwood: 90,
  homeSeam: 800,
  contestedSeam: 1000,
  /** Ember Famine: contested Seams hold 1500. */
  contestedSeamFamine: 1500,
};

/** Other income (§D, §C). */
export const INCOME = {
  ruinedCacheEmber: 150,
  ruinedCacheCrowns: 15,
  /** Distance a player unit must reach to loot a cleared Cache. */
  cacheLootRadius: 1.2,
  litBeaconEmberPerSec: 0.3,
  /** Ember Tithe passive (also the flag value). */
  emberTithePerSec: 1.2,
  /** Spoils of the Wake per enemy unit killed. */
  spoilsPerKill: { grain: 3, ember: 1 } as Cost,
  /** Plunderers per Nest or Picket destroyed. */
  plunderersRes: { grain: 100, timber: 100, ember: 100 } as Cost,
  plunderersCrowns: 10,
  /** Raider's Bounty: Grain per Courser hit on a Nest or Picket spire. */
  raidersBountyGrain: 3,
  /** Deep Delvers: extra Ember on the home Seam. */
  deepDelversHomeSeam: 200,
};

// ===========================================================================
// Buildings (§E)
// ===========================================================================

export const BUILD = {
  maxBuilders: 4,
  /** Cancel refund before any work / after work started / destroyed foundation. */
  refundBeforeWork: 1,
  refundAfterWork: 0.5,
  refundDestroyedFoundation: 0,
  repairHpPerSec: 8,
  maxRepairers: 4,
  /** Production queue slots per building. Cost paid on queue, cancel refunds 100%. */
  queueSize: 5,
  queueCancelRefund: 1,
  /** Shift+train queues this many. */
  shiftTrainCount: 5,
  /** Placement: at least this far from any enemy structure. */
  minDistFromEnemyStructure: 3,
  defaultArmor: 3,
  /** Kiln Masons: Brazier Towers build this many times faster. */
  kilnMasonsBuildMul: 2,
  /** Blight withers player buildings at this rate (HP/s). */
  blightWitherHps: 2,
};

/** Build time with n builders (max 4): base × 3/(n+2). n=1 → base. */
export function buildTime(base: number, builders: number): number {
  const n = Math.max(1, Math.min(BUILD.maxBuilders, builders));
  return (base * 3) / (n + 2);
}

/** Rally the Hearth (§E Hearth, Hearth Watch research §H). */
export const RALLY_HEARTH = {
  radius: 8,
  atk: 2,
  armor: 1,
  /** Rallied Tillers auto-fight enemies within this radius. */
  fightRadius: 5,
  duration: 15,
  cooldown: 180,
  /** With Hearth Watch. */
  watchCooldown: 120,
  watchDuration: 25,
  hotkey: 'V',
};

// ===========================================================================
// Units, veterancy, Warden, Retinue (§B, §F)
// ===========================================================================

export const VETERANCY = {
  /** Kills needed for Rank I, II, III. */
  thresholds: [3, 7, 12],
  maxRank: 3,
  /** Per rank: +15% max HP and +15% ATK. */
  hpPctPerRank: 15,
  atkPctPerRank: 15,
  /** Rank III: +1 armor and a gold banner. */
  rank3Armor: 1,
};

/** Rank for a kill count (0-3). */
export function rankForKills(kills: number): 0 | 1 | 2 | 3 {
  const t = VETERANCY.thresholds;
  if (kills >= t[2]) return 3;
  if (kills >= t[1]) return 2;
  if (kills >= t[0]) return 1;
  return 0;
}

export const RETINUE = {
  /** Retinue cap in pop. */
  baseCap: 6,
  veteransOathBonus: 3,
  seasonedRetinueBonus: 3,
  maxCap: 12,
  /** Veteran's Oath: carried units gain +1 rank (max III). */
  veteransOathRanks: 1,
  /** Grimbrand passive: Retinue units start at Rank I or higher. */
  grimbrandMinRank: 1,
};

export const WARDEN = {
  respawnBase: 45,
  respawnPerDeath: 15,
  /** Second Wind. */
  secondWindRespawnBase: 25,
  secondWindRespawnPerDeath: 5,
  /** Second Wind: ability cooldown −30%. */
  secondWindCooldownPct: -30,
};

/** Respawn delay after the Warden's `priorDeaths`-th death this battle (0 for the first death). */
export function wardenRespawn(priorDeaths: number, secondWind: boolean): number {
  return secondWind
    ? WARDEN.secondWindRespawnBase + WARDEN.secondWindRespawnPerDeath * priorDeaths
    : WARDEN.respawnBase + WARDEN.respawnPerDeath * priorDeaths;
}

/** House abilities (Q) and Hawk (W). §N. */
export const ABILITIES = {
  rallyingHorn: { radius: 6, attackSpeedPct: 25, moveSpeedPct: 15, duration: 8, cooldown: 45 },
  harvestHymn: { radius: 8, gatherPct: 60, duration: 15, cooldown: 50 },
  firepot: { range: 7, flightTime: 1.0, radius: 2, damage: 50, burnDps: 3, burnDuration: 4, cooldown: 30, fireDecal: 5 },
  emberVolley: { extraBolts: 2, duration: 10, cooldown: 60, maxHearthBolts: 5, maxTowerBolts: 3 },
  hawk: { radius: 7, duration: 6, cooldown: 50 },
};

// ===========================================================================
// Stat stacking (§L "Stacking rules")
// ===========================================================================

export const STACKING = {
  /** Train time can drop at most 40%. */
  maxTrainTimeReduction: 0.4,
  /** Range bonuses capped at +2 for units and +2 for structures. */
  maxUnitRangeBonus: 2,
  maxStructureRangeBonus: 2,
  /** Hearth bolts per volley (3 with Hearth of the Last Flame via volley +2). */
  hearthVolley: 1,
  towerVolley: 1,
  /** Thick Fog: sight never drops below this. */
  minSight: 3,
};

// ===========================================================================
// Combat (§F behavior, §G damage)
// ===========================================================================

/** Structure multiplier by attacker class (§G). Units override with UnitDef.structMod. */
export const CLASS_STRUCT_MOD: Record<UnitClass, number> = {
  worker: 0.5,
  infantry: 0.7,
  hero: 0.8,
  cavalry: 0.4,
  ranged: 0.2,
  siege: 1.0,
  boss: 2.0,
};

export const COMBAT = {
  /** dmg = max(1, round(raw × armorK / (armorK + armor))). */
  armorK: 10,
  minDamage: 1,
  /** Per-rank multiplier on damage: (1 + 0.15 × rank). */
  rankDamagePerRank: 0.15,
  /** Spent Nest / Root Heart takes ×1.5. */
  spentMult: 1.5,
  /** Range threshold: >= 1.5 tiles is a ranged (projectile) attack. */
  rangedThreshold: 1.5,
  /** Counter popups: at most once per attacker per 1.5 s, at most 24 on screen. */
  popupThrottle: 1.5,
  maxPopups: 24,
};

/** Armor reduction (§G): max(1, round(raw × 10 / (10 + armor))). */
export function armorDamage(raw: number, armor: number): number {
  return Math.max(COMBAT.minDamage, Math.round((raw * COMBAT.armorK) / (COMBAT.armorK + Math.max(0, armor))));
}

export const BURN = {
  /** Brandbow / Firebrand burn. */
  dps: 2,
  duration: 3,
  /** Firepot burn. */
  firepotDps: 3,
  firepotDuration: 4,
  /** Max burn instances per target (different appliers). */
  maxInstances: 3,
};

/** Projectile speeds in tiles/s (§G). Firepot is ground-targeted with a fixed flight time. */
export const PROJECTILE_SPEED = {
  arrow: 12,
  fire_arrow: 12,
  bolt: 14,
  spine: 10,
  /** Unused for travel (firepot uses ABILITIES.firepot.flightTime); kept for completeness. */
  firepot: 7,
};

/** Player unit auto-acquire (§F "Behavior"). */
export const ACQUIRE = {
  /** Idle military acquire the nearest visible enemy within 6 tiles. */
  radius: 6,
  /** Ranged units: max(range + 1, 6). */
  rangedExtra: 1,
  /** Chase up to 10 tiles from the idle spot, then return. */
  leash: 10,
  /** A melee unit that cannot reach its target for 1.5 s retargets within 3 tiles. */
  meleeRetargetTime: 1.5,
  meleeRetargetRadius: 3,
  /** Shift-queued orders cap. */
  maxQueuedOrders: 8,
  /**
   * Units whose structure multiplier is below this (Bowman 0.2, Outrider 0.2, Courser 0.4) never pick
   * a structure on their own initiative: only an explicit attack order sends them at a building.
   */
  autoStructureMinMod: 0.5,
  /** Such an idle unit shot by a structure steps this many tiles outside the structure's range. */
  structureStepOut: 1.5,
};

/** Auto-acquire radius for a unit with the given (composed) range. */
export function acquireRadius(range: number): number {
  return range >= COMBAT.rangedThreshold ? Math.max(range + ACQUIRE.rangedExtra, ACQUIRE.radius) : ACQUIRE.radius;
}

/** Last Stand (§B, boss battle only). */
export const LAST_STAND = {
  resolveCost: 1,
  hearthHpPct: 0.4,
  invulnerableTime: 5,
  radius: 6,
  damage: 150,
  knockback: 3,
  /** Rally the Hearth triggers for free, ignoring cooldown. */
  freeRally: true,
};

// ===========================================================================
// Movement and pathing (§F "Movement and pathing", §K passability)
// ===========================================================================

export const NAV = {
  /** Orders for this many units or more share one flow field. */
  flowFieldMinGroup: 4,
  flowFieldMaxCells: 4096,
  /** Max A* searches per tick. */
  astarPerTick: 8,
  /** Soft separation max push (tiles/s). */
  separationMaxPush: 0.5,
  /** Stuck: moved less than 0.15 tiles in 1.0 s while pathing → repath. */
  stuckDist: 0.15,
  stuckTime: 1.0,
  /** After 3 repaths within 6 s → idle. */
  stuckMaxRepaths: 3,
  stuckWindow: 6,
  /** Group arrival within 0.5 + 0.35·√n tiles of the goal. */
  arrivalBase: 0.5,
  arrivalPerSqrtN: 0.35,
  /** Forced displacement (knockback, dashes) steps. */
  displacementStep: 0.25,
  /** Flow-field invalidation debounce on grid changes (s). */
  flowDebounce: 0.5,
  /** Terrain speed multipliers. */
  shallowsSpeed: 0.6,
  /** Player units on Blight. Enemy units ×1. */
  blightPlayerSpeed: 0.8,
  /** Enemy flow-field cost of a player building tile. */
  enemyBuildingCost: 12,
  /** Collision radii (§F, §A). */
  radius: { default: 0.3, warden: 0.35, cavalry: 0.4, siege: 0.45, thornhusk: 0.45, lord: 0.6, regent: 1.1 },
};

/** Group arrival radius for n units. */
export function groupArrivalRadius(n: number): number {
  return NAV.arrivalBase + NAV.arrivalPerSqrtN * Math.sqrt(Math.max(1, n));
}

// ===========================================================================
// Depth scaling (§C)
// ===========================================================================

/** Depth factor F(d) = 1 + 0.12(d−1). */
export const DEPTH = {
  fSlope: 0.12,
  t1Base: 110,
  t1PerDepth: 4,
  intervalBase: 70,
  intervalPerDepth: 2,
  /** Horn and spawn at launch − 30 s. */
  musterLead: 30,
  nestHpBase: 800,
  nestHpPerDepth: 100,
  /** Nests per battle: 2 at d≤4, 3 at d≥5 (Raze, Holdfast, Beacons). Elite always 2. */
  thirdNestFromDepth: 5,
  garrisonBase: 4,
  picketBase: 2,
  cacheGuardBase: 2,
  ancientCacheGuardBase: 6,
  ancientCacheGuardPerDepth: 2,
  beaconGuardBase: 2,
  raidBase: 2,
  raidFromDepth: 3,
  blightCapBase: 10,
  maxDepth: 6,
};

export function depthFactor(d: number): number {
  return 1 + DEPTH.fSlope * (d - 1);
}
/** First wave launch T1 = 110 − 4d (s). */
export function firstWaveLaunch(d: number): number {
  return DEPTH.t1Base - DEPTH.t1PerDepth * d;
}
/** Wave interval I = 70 − 2d (s). */
export function waveInterval(d: number): number {
  return DEPTH.intervalBase - DEPTH.intervalPerDepth * d;
}
/** Base wave value before multipliers: 6 + 4n + 0.5n². */
export function waveBase(n: number): number {
  return 6 + 4 * n + 0.5 * n * n;
}
/**
 * Wave value V(n,d) = floor((6 + 4n + 0.5n²) × F(d) × N × M) (Raze, Beacons, Elite).
 * @param n wave index (1-based)
 * @param N nest factor (see nestFactor), 1 when all Nests alive
 * @param M product of active multipliers (see WAVE_MULT), 1 if none
 */
export function waveValue(n: number, d: number, N = 1, M = 1): number {
  return floorEps(waveBase(n) * depthFactor(d) * N * M);
}
/** Launch time of wave n (1-based) before Ascendant, ignoring modifiers: T1 + (n−1)·I. */
export function waveLaunchTime(n: number, d: number): number {
  return firstWaveLaunch(d) + (n - 1) * waveInterval(d);
}
/** N = 0.4 + 0.6 × nestsAlive / nestsTotal. */
export function nestFactor(alive: number, total: number): number {
  if (total <= 0) return 1;
  return 0.4 + (0.6 * alive) / total;
}
/** Thorn Nest HP = 800 + 100(d−1) (before Fortified Nests / Thornbound II). */
export function nestHp(d: number): number {
  return DEPTH.nestHpBase + DEPTH.nestHpPerDepth * (d - 1);
}
/** Nests per battle for Raze, Holdfast and Beacons. Elite always has 2 (see OBJECTIVE_ANCHORS). */
export function nestCount(d: number): number {
  return d >= DEPTH.thirdNestFromDepth ? 3 : 2;
}
/** Nest garrison value 4 + d (Thornbound III adds +2, see THORNBOUND_EFFECTS). */
export function garrisonValue(d: number): number {
  return DEPTH.garrisonBase + d;
}
/** Bramble Picket guard value 2 + d. */
export function picketValue(d: number): number {
  return DEPTH.picketBase + d;
}
/** Ruined Cache Lurker guard value 2 + d. */
export function cacheGuardValue(d: number): number {
  return DEPTH.cacheGuardBase + d;
}
/** Ancient Cache guard value 6 + 2d. */
export function ancientCacheGuardValue(d: number): number {
  return DEPTH.ancientCacheGuardBase + DEPTH.ancientCacheGuardPerDepth * d;
}
/** Beacon Stone Lurker guard value 2 + d. */
export function beaconGuardValue(d: number): number {
  return DEPTH.beaconGuardBase + d;
}
/** Raid value 2 + d (raids only at d≥3; returns 0 below). */
export function raidValue(d: number): number {
  return d >= DEPTH.raidFromDepth ? DEPTH.raidBase + d : 0;
}
/** Blight cap radius for Raze/Beacons/Elite: 10 + d. Use blightParams() for every objective. */
export function blightCap(d: number): number {
  return DEPTH.blightCapBase + d;
}
/** Max Rootbreakers per wave: 1 + floor(d/4). */
export function rootbreakerCap(d: number): number {
  return 1 + floorEps(d / 4);
}
/** Node threat skulls (§B): ceil(d × 0.6), +1 for an Elite, boss 5, max 5. */
export function threatRating(d: number, elite: boolean, boss = false): number {
  if (boss) return 5;
  return Math.min(5, Math.ceil(d * 0.6 - FLOOR_EPS) + (elite ? 1 : 0));
}

/** Run-level / battle wave multipliers M (§C). Multiply the active ones. */
export const WAVE_MULT = {
  bloodMoon: 1.3,
  hollowEnvoy: 1.15,
  thornboundI: 1.1,
  ascendant: 1.5,
};

/** Ascendant soft clock (§C). Not in Holdfast or the boss. */
export const ASCENDANT = {
  time: 540,
  interval: 35,
  mult: 1.5,
  /** Horn announces it this far ahead. */
  warnLead: 30,
  objectives: ['raze', 'beacons', 'elite'] as ObjectiveId[],
};

/** Holdfast waves (§C). */
export const HOLDFAST = {
  /** Raised so a Hearth and Warden alone never hold all six waves at d1-3 (§R, fix pass). */
  hbase: [8, 13, 18, 25, 34, 52],
  /** Holdfast's own depth slope: F_H(d) = 1 + 0.06(d − 1). d6 stays within +3% of the old curve. */
  fSlope: 0.06,
  launchTimes: [60, 105, 150, 195, 240, 285],
  musterLead: 30,
  waves: 6,
  /** Wave 6 (Great Wave) is split evenly across all living Nests. */
  greatWave: 6,
  /** When the final wave launches, remaining wave units are revealed; at or below this count they charge the Hearth. */
  cleanupChargeCount: 6,
  /** Unbroken / Uprooted Crown bonuses. */
  unbrokenCrowns: 30,
  uprootedCrowns: 30,
};

/** Holdfast wave value floor(Hbase[n] × (1 + 0.06(d − 1)) × N × M), n is 1-based (1-6). */
export function holdfastWaveValue(n: number, d: number, N = 1, M = 1): number {
  const base = HOLDFAST.hbase[Math.max(0, Math.min(HOLDFAST.hbase.length - 1, n - 1))];
  return floorEps(base * (1 + HOLDFAST.fSlope * (d - 1)) * N * M);
}

// ===========================================================================
// Wave director (§I)
// ===========================================================================

export const DIRECTOR = {
  /** Muster point sits this many tiles in front of the Nest, toward the Hearth. */
  musterOffset: 3,
  /** Muster spawns land in a BFS spiral up to this radius. */
  spawnRadius: 5,
  /** waveBank is capped at 50% of V; excess discarded. */
  waveBankCap: 0.5,
  /** Garrison units above 50% of the garrison cap (by value) join the mustering wave. */
  garrisonJoinFraction: 0.5,
  /** Intel: a player unit within 6 tiles of the muster point reveals composition. */
  intelRadius: 6,
  /** Horn size labels: Small < 8, Medium 8-19, Large >= 20 units. */
  hornMediumAt: 8,
  hornLargeAt: 20,
  /** Each wave: 25% chance of a random available secondary doctrine. */
  secondaryDoctrineChance: 0.25,
  /** Dissolve: a wave/raid unit idle (no damage dealt/taken, < 1 tile moved) for 30 s dissolves. */
  dissolveTime: 30,
  dissolveDist: 1,
  /** Waves rotate round-robin among living Nests. Hunt target search radius around Storehouses. */
  huntStorehouseRadius: 8,
};

/** Spent Nests (§I). */
export const SPENT = {
  damageMult: 1.5,
  /** Spent ends 45 s after the wave breaks (time to walk out and clear the garrison)... */
  afterBroken: 45,
  /** ...or 105 s after launch if the wave is still alive. */
  maxFromLaunch: 105,
};

/** Light adaptation (§I, SHOULD). */
export const ADAPTATION = {
  minMilitary: 6,
  shareThreshold: 0.4,
  weightBonus: 50,
  /** Counter type per dominant player class (Thornling instead of Stagrider at d1). */
  counters: {
    ranged: 'stagrider',
    infantry: 'spinecaster',
    cavalry: 'briarguard',
  } as Partial<Record<UnitClass, EnemyUnitId>>,
  rangedCounterD1: 'thornling' as EnemyUnitId,
};

/** Enemy unit AI (§I "Unit AI"). */
export const ENEMY_AI = {
  /** Engage priority 1: a target it has a bonus against within 4 tiles. */
  bonusTargetRadius: 4,
  /** Priority 2: whoever hit it in the last 3 s. */
  recentAttackerWindow: 3,
  /** Priority 3: nearest player unit within 6 tiles (4 under Thick Fog). */
  acquireRadius: 6,
  acquireRadiusFog: 4,
  /** Priority 4: a player building blocking its path or within 2 tiles. */
  buildingRadius: 2,
  /** Rootbreakers: nearest building within 8 tiles, else path target. */
  rootbreakerBuildingRadius: 8,
  retargetInterval: 0.5,
  /** Wave units chase at most 6 tiles from the engagement start, then ignore that target for 5 s. */
  chaseLeash: 6,
  ignoreTime: 5,
  /** Thornwake units regenerate 1 HP/s on Blight. */
  blightRegen: 1,
};

/** Nest garrisons (§I "Garrisons"). */
export const GARRISON = {
  /** Regenerates 1 value per 10 s up to the cap (not while Spent). */
  regenValue: 1,
  regenInterval: 10,
  aggroRadius: 7,
  leashRadius: 12,
  /** Leashing guards walk home regenerating 5 HP/s. */
  leashRegenHps: 5,
  /** When a Nest falls below 60% HP its garrison (and a mustering wave) attack the attacker. */
  retaliationHpPct: 0.6,
  /** When a Nest dies, its garrison attack-moves to the nearest player unit/building within 20 tiles, else the Hearth. */
  nestDeathSearchRadius: 20,
  /** Standing forces: types with value >= 2, no siege; a remainder < 2 is discarded. */
  minStandingValue: 2,
};

/** Lurkers guarding Caches and Beacons (§J). */
export const LURKERS = {
  leash: 8,
};

/** Thornspires and Pickets (§C, §I). */
export const THORNSPIRE = {
  hp: 400,
  perNest: 1,
  /** Fortified Nests: +1 Thornspire per Nest. */
  fortifiedExtra: 1,
  /** Withers 2 s after its Nest dies. */
  witherDelay: 2,
  /** Placed within 4 tiles of its Nest or Picket post. */
  placeRadius: 4,
};

export const PICKET = {
  /** Pickets per Raze/Elite map (on the contested Seams). Boss: 2 with guards of BOSS.picketGuardValue. */
  count: 2,
  crowns: 5,
};

/** Raids (§I, SHOULD; d≥3, Raze/Beacons/Elite only). */
export const RAID = {
  fromDepth: 3,
  objectives: ['raze', 'beacons', 'elite'] as ObjectiveId[],
  /** Stagriders while at least 3 value remains, then Thornlings. */
  stagriderMinValue: 3,
  /** Raiders attack-move toward Tillers within 8 tiles for 25 s, then join the Hearth push. */
  tillerHuntRadius: 8,
  huntDuration: 25,
};

/** Raid launch time for a wave launched at `waveLaunch` with interval I: launch + floor(I/2). */
export function raidLaunchTime(waveLaunch: number, interval: number): number {
  return waveLaunch + floorEps(interval / 2);
}

// ===========================================================================
// Blight (§K)
// ===========================================================================

export const BLIGHT = {
  startRadius: 4,
  /** Raze, Beacons, Elite: +1 every 20 s up to 10 + d. */
  growthInterval: 20,
  /** Holdfast: +1 every 25 s up to radius 8. */
  holdfastInterval: 25,
  holdfastCap: 8,
  /** Root Hearts: +1 every 10 s up to radius 12. */
  rootHeartInterval: 10,
  rootHeartCap: 12,
  /** Creeping Wake: grows every 12 s and its cap rises by 3. */
  creepingInterval: 12,
  creepingCapBonus: 3,
  /** When the source dies, Blight recedes to 0 over 4 s. */
  recedeTime: 4,
  playerSpeedMul: 0.8,
  gatherMul: 0.6,
  enemyRegen: 1,
  buildingWitherHps: 2,
  /** Ward radii. */
  kindledEarthWard: 5,
  kilnMasonsWard: 3,
};

/** Blight growth parameters for a source. */
export function blightParams(
  objective: ObjectiveId,
  d: number,
  creepingWake: boolean,
): { start: number; cap: number; interval: number } {
  let cap: number;
  let interval: number;
  if (objective === 'boss') {
    cap = BLIGHT.rootHeartCap;
    interval = BLIGHT.rootHeartInterval;
  } else if (objective === 'holdfast') {
    cap = BLIGHT.holdfastCap;
    interval = BLIGHT.holdfastInterval;
  } else {
    cap = blightCap(d);
    interval = BLIGHT.growthInterval;
  }
  if (creepingWake && objective !== 'boss') {
    cap += BLIGHT.creepingCapBonus;
    interval = BLIGHT.creepingInterval;
  }
  return { start: BLIGHT.startRadius, cap, interval };
}

// ===========================================================================
// Objectives (§C)
// ===========================================================================

export const PAR = {
  /** Raze: 6:00 + 0:45 per Nest above 2. */
  razeBase: 360,
  razePerExtraNest: 45,
  elite: 390,
  beacons: 330,
  bonusCrowns: 30,
};

/** Par in seconds for an objective (null when the objective has none). */
export function parSeconds(objective: ObjectiveId, nests: number): number | null {
  switch (objective) {
    case 'raze':
      return PAR.razeBase + PAR.razePerExtraNest * Math.max(0, nests - 2);
    case 'elite':
      return PAR.elite;
    case 'beacons':
      return PAR.beacons;
    default:
      return null;
  }
}

/** Beacon rules (§C, SHOULD). */
export const BEACONS = {
  count: 3,
  dormantUntil: 90,
  captureTime: 10,
  radius: 2.5,
  /** Progress decays at 1 s/s when empty. */
  decayRate: 1,
  kindlingPerSec: 1,
  /** 450 (was 300): the bot won at a median 4:00, far under par 5:30. */
  kindlingTarget: 450,
  emberPerSec: 0.3,
  vision: 8,
  snuffTime: 8,
  minDist: 15,
  maxDist: 24,
  minApart: 12,
};

/** Retreat (§B). */
export const RETREAT = {
  availableFrom: 180,
  resolveCost: 1,
};

export const RESOLVE = {
  start: 3,
  max: 3,
  /** Fourth Banner: max 4, starting at 4. */
  fourthBannerMax: 4,
  defeatCost: 1,
};

// ===========================================================================
// Noble (§I "Court Noble") and Boss (§I "Boss")
// ===========================================================================

export const NOBLE = {
  /** Antlered Lord HP at d3; scales × (1 + 0.1(d − 3)). */
  hpD3: 2400,
  hpSlope: 0.1,
  /** Joins wave 3. */
  joinsWave: 3,
  wildHunt: { interval: 25, telegraph: 1.2, length: 8, width: 1.5, damage: 45, knockback: 2 },
  summon: { interval: 40, count: 2, unit: 'stagrider' as EnemyUnitId, maxAlive: 6, minHpPct: 0.5 },
  eliteCrowns: 40,
};

export function nobleHp(d: number): number {
  return Math.round(NOBLE.hpD3 * (1 + NOBLE.hpSlope * (d - 3)));
}

/** Briar Regent and the boss battle (§I "Boss", §K boss template). Named constants, never a formula in d. */
export const BOSS = {
  BOSS_F: 1.5,
  t1: 100,
  interval: 60,
  /** Wrath at 8:00: phase 2 starts, surviving Hearts keep spawning waves, Regent +20% damage. */
  wrathTime: 480,
  wrathDamagePct: 20,
  wrathInterval: 45,
  hearts: 3,
  /** 1200 HP and garrison 12 (were 1400 / 16): a run-like army burned only 1 of 3 Hearts before Wrath. */
  heartHp: 1200,
  heartGarrisonValue: 12,
  heartGarrisonRegenInterval: 15,
  /** Each Heart destroyed removes 1500 HP from the phase-2 pool. */
  phase2HpBase: 3000,
  phase2HpPerHeart: 1500,
  armor: 5,
  atk: 40,
  splash: { radius: 1.5, edge: 0.5 },
  cooldown: 2.2,
  range: 1.2,
  structMod: 2.0,
  vsSiege: 2,
  speed: 1.6,
  /** Hits anything within 2 tiles on the march. */
  marchHitRadius: 2,
  /** Retargets the Warden within 6 tiles at most once per 15 s; drops it after chasing 6 tiles. */
  wardenRetargetRadius: 6,
  wardenRetargetCooldown: 15,
  wardenChase: 6,
  thornLance: { interval: 8, range: 10, telegraph: 1.2, damage: 60 },
  thornburst: { interval: 16, telegraph: 1.5, radius: 4, damage: 50, vsSiege: 2, knockback: 1 },
  rootsnare: { interval: 12, range: 9, radius: 2.5, telegraph: 1.2, duration: 3 },
  courtSummons: { hpThresholds: [0.75, 0.5, 0.25], value: 25, types: ['briarguard', 'spinecaster', 'thornhusk'] as EnemyUnitId[] },
  enrage: { hpPct: 0.25, speedPct: 30, cooldownPct: -25 },
  picketGuardValue: 10,
};

/** Boss wave value floor((6 + 4n + 0.5n²) × BOSS_F × (0.4 + 0.2 × heartsAlive) × M). */
export function bossWaveValue(n: number, heartsAlive: number, M = 1): number {
  return floorEps(waveBase(n) * BOSS.BOSS_F * (0.4 + 0.2 * heartsAlive) * M);
}
/** Regent phase-2 HP: 3000 + 1500 × heartsAlive. */
export function regentHp(heartsAlive: number): number {
  return BOSS.phase2HpBase + BOSS.phase2HpPerHeart * heartsAlive;
}

// ===========================================================================
// Map generation (§K)
// ===========================================================================

export interface ObjectiveAnchorRule {
  size: number;
  hearth: 'corner' | 'center' | 'edge_mid' | 'template';
  /** Corner: Hearth center 9-12 from both edges. Edge midpoint: inset 9. */
  hearthInsetMin: number;
  hearthInsetMax: number;
  /** Nest distance from the Hearth center (absolute tiles; raze uses 0.5S-0.85S). */
  nestDistMin: number;
  nestDistMax: number;
  nestMinApart: number;
  nestBorder: number;
  /** Beacons: Nests at y >= S − 14 (the far edge). */
  nestFarEdge?: number;
  /** Fixed Nest count (elite) or null for nestCount(d). */
  fixedNests: number | null;
  contestedSeams: number;
  pickets: number;
  caches: boolean;
  /** Path from the Hearth to the nearest Nest (validation). */
  pathMin: number;
  pathMax: number;
  minReachableTrees: number;
}

/** Per-objective anchor table (§K step 3, validation step 8). */
export const OBJECTIVE_ANCHORS: Record<ObjectiveId, ObjectiveAnchorRule> = {
  raze: {
    size: 56, hearth: 'corner', hearthInsetMin: 9, hearthInsetMax: 12,
    nestDistMin: 28, nestDistMax: 47.6, nestMinApart: 12, nestBorder: 6, fixedNests: null,
    contestedSeams: 2, pickets: 2, caches: true, pathMin: 30, pathMax: 50, minReachableTrees: 300,
  },
  elite: {
    size: 56, hearth: 'corner', hearthInsetMin: 9, hearthInsetMax: 12,
    nestDistMin: 28, nestDistMax: 47.6, nestMinApart: 12, nestBorder: 6, fixedNests: 2,
    contestedSeams: 2, pickets: 2, caches: true, pathMin: 30, pathMax: 50, minReachableTrees: 300,
  },
  holdfast: {
    size: 48, hearth: 'center', hearthInsetMin: 0, hearthInsetMax: 0,
    nestDistMin: 17, nestDistMax: 23, nestMinApart: 12, nestBorder: 6, fixedNests: null,
    contestedSeams: 1, pickets: 0, caches: true, pathMin: 17, pathMax: 30, minReachableTrees: 200,
  },
  beacons: {
    size: 56, hearth: 'edge_mid', hearthInsetMin: 9, hearthInsetMax: 9,
    nestDistMin: 0, nestDistMax: 999, nestMinApart: 12, nestBorder: 6, nestFarEdge: 14, fixedNests: null,
    contestedSeams: 2, pickets: 0, caches: true, pathMin: 30, pathMax: 50, minReachableTrees: 300,
  },
  boss: {
    size: 64, hearth: 'template', hearthInsetMin: 0, hearthInsetMax: 0,
    nestDistMin: 16, nestDistMax: 22, nestMinApart: 0, nestBorder: 0, fixedNests: 3,
    contestedSeams: 2, pickets: 2, caches: false, pathMin: 34, pathMax: 46, minReachableTrees: 0,
  },
};

/** Raze/Elite Nest distance as a fraction of map size S (0.5S-0.85S). */
export const RAZE_NEST_DIST_FRAC = { min: 0.5, max: 0.85 };

/** Nests for a battle (objective + depth). */
export function nestsFor(objective: ObjectiveId, d: number): number {
  const fixed = OBJECTIVE_ANCHORS[objective].fixedNests;
  return fixed ?? nestCount(d);
}

export const MAPGEN = {
  /** Noise: 0.65·N(x/14, y/14) + 0.35·N(x/6, y/6). */
  noiseScaleA: 14,
  noiseScaleB: 6,
  noiseWeightA: 0.65,
  noiseWeightB: 0.35,
  /** Shallows: the next 4 percentile points above the water threshold. */
  shallowsBand: 0.04,
  /** Forest cellular automaton: 2 passes, forest if >= 5 of 8 neighbours. */
  forestCaPasses: 2,
  forestCaThreshold: 5,
  /** Clearing radii (grass). */
  clearHearth: 7,
  clearNest: 4,
  clearSmall: 3,
  /** Corridors: 3 wide, A* costs. */
  corridorWidth: 3,
  corridorCost: { grass: 1, shallows: 2, forest: 4, rock: 8, water: 8 },
  /** Validation retries before the fallback template. */
  maxAttempts: 20,
  minWalkableFrac: 0.5,
  fallback: { borderBand: 3, discRadius: 4, discs: [[0.3, 0.7], [0.7, 0.3], [0.5, 0.5]] as [number, number][] },
};

/** Fairness kit (§K step 6, §D placement). Distances from the Hearth center. */
export const FAIRNESS_KIT = {
  nearThickets: { count: 6, ashwoodCount: 4, min: 4, max: 7 },
  outerThickets: { count: 3, greenmarchBonus: 2, min: 9, max: 13 },
  homeSeam: { min: 8, max: 11 },
  forest: { minTiles: 60, ringMin: 6, ringMax: 14, stampRadiusMin: 3, stampRadiusMax: 4, stampMin: 8, stampMax: 11 },
  /** Contested Seams: on the corridor to one of the two nearest Nests, 11-15 corridor tiles from it, offset 2-4 sideways. */
  contestedSeam: { fromNestMin: 11, fromNestMax: 15, offsetMin: 2, offsetMax: 4 },
  /** Holdfast: 1 unguarded Seam 12-16 from the Hearth and >= 10 from every Nest. */
  holdfastSeam: { min: 12, max: 16, minFromNest: 10 },
  midThicketClusters: { count: 2, size: 3 },
  /** Bountiful Wilds: +6 Thickets in a second cluster at 7-10. */
  bountiful: { count: 6, min: 7, max: 10 },
  /** Vanguard sites (§C). */
  vanguard: {
    militaryMin: 6, militaryMax: 8,
    storehouseMin: 6, storehouseMax: 12,
    grainplotMin: 4, grainplotMax: 6,
  },
  /** Old Watchtowers: 2 towers 7-9 tiles toward the nearest Nest. */
  watchtowers: { count: 2, min: 7, max: 9 },
};

/** Caches (§J). */
export const CACHES = {
  /** 1 per map, 2 at d≥4. */
  count: 1,
  countFromD4: 2,
  extraFromDepth: 4,
  minFromHearth: 20,
  minFromNest: 10,
  ancient: { minFromHearth: 14, maxFromHearth: 20, crowns: 60, thornhuskFromDepth: 5 },
};

export function cacheCount(d: number): number {
  return d >= CACHES.extraFromDepth ? CACHES.countFromD4 : CACHES.count;
}

/** Boss template (Heartwood 64×64, §K). */
export const BOSS_MAP = {
  size: 64,
  hearthCenter: { x: 10, y: 54 },
  hearthPlaza: 8,
  throneCenter: { x: 50, y: 14 },
  thronePlaza: 6,
  heartDistMin: 16,
  heartDistMax: 22,
  /** Degrees around the Throne-to-Hearth axis. */
  heartAngles: [-40, 0, 40],
  nearHeartPath: { min: 34, max: 40 },
  sideHeartPath: { min: 40, max: 46 },
  laneWidth: 7,
  wallThickness: 3,
};

// ===========================================================================
// Run map (§B) and battle node rolls (§B, §K)
// ===========================================================================

export type NodeKind = 'battle' | 'elite' | 'event' | 'peddler' | 'camp';

export const RUN_MAP = {
  columns: 8,
  lanes: 4,
  walkers: 4,
  totalNodesMin: 16,
  totalNodesMax: 22,
  /** Cols 2-7 must hold 14-20 nodes, every column >= 2. */
  midNodesMin: 14,
  midNodesMax: 20,
  minPerColumn: 2,
  diagonalRetries: 10,
  layoutTries: 50,
  typeAttempts: 200,
  /** Every start-to-boss path has 3-4 combat nodes among cols 2-6. */
  pathCombatMin: 3,
  pathCombatMax: 4,
  elitesMin: 1,
  elitesMax: 2,
  eliteColumns: [3, 4, 5, 6],
  /** Node type weights by column (1-based). Col 1 is a Raze battle with a Draft reward; col 8 is the boss. */
  weights: {
    2: { battle: 60, event: 40 },
    3: { battle: 50, elite: 14, event: 18, peddler: 10 },
    4: { battle: 50, elite: 14, event: 18, peddler: 10, camp: 8 },
    5: { battle: 50, elite: 14, event: 18, peddler: 10, camp: 8 },
    6: { battle: 50, elite: 14, event: 18, peddler: 10, camp: 8 },
    7: { camp: 50, peddler: 50 },
  } as Record<number, Partial<Record<NodeKind, number>>>,
};

/** Objective roll weights (§B). Elites use the Elite layout. */
export const OBJECTIVE_WEIGHTS: Partial<Record<ObjectiveId, number>> = { raze: 50, holdfast: 25, beacons: 25 };
/** Used if Beacons is cut (SHOULD). */
export const OBJECTIVE_WEIGHTS_NO_BEACONS: Partial<Record<ObjectiveId, number>> = { raze: 65, holdfast: 35 };

/** Reward type weights (§B). Col 1 is always a Draft. */
export const REWARD_TYPE_WEIGHTS = { boon: 55, draft: 25, spoils: 20 };

/** Biome probabilities by column (§K). Col 7 has no battles; the boss is Heartwood. */
export const BIOME_WEIGHTS: Record<number, Partial<Record<BiomeId, number>>> = {
  1: { greenmarch: 100 },
  2: { greenmarch: 100 },
  3: { greenmarch: 30, fenreach: 70 },
  4: { greenmarch: 30, fenreach: 70 },
  5: { fenreach: 40, ashwood: 60 },
  6: { fenreach: 40, ashwood: 60 },
  8: { heartwood: 100 },
};

/** Modifier roll chances by column (§K): chance of a first and of a second modifier. */
export const MODIFIER_ROLLS: Record<number, { first: number; second: number }> = {
  1: { first: 0, second: 0 },
  2: { first: 0.3, second: 0 },
  3: { first: 0.6, second: 0 },
  4: { first: 0.6, second: 0 },
  5: { first: 1, second: 0.3 },
  6: { first: 1, second: 0.3 },
};

/** Elite: +1 extra modifier from this negative list. No duplicates; the boss has none. */
export const NEGATIVE_MODIFIERS: ModifierId[] = [
  'blood_moon',
  'thick_fog',
  'creeping_wake',
  'ember_famine',
  'fortified_nests',
  'swift_hunt',
];

// ===========================================================================
// Rewards, Crowns, Renown (§M, §N)
// ===========================================================================

export type RarityKey = 'C' | 'R' | 'M';

export const REWARDS = {
  /** Boon rarity weights per card. */
  rarityNormal: { C: 62, R: 30, M: 8 } as Record<RarityKey, number>,
  rarityElite: { C: 0, R: 75, M: 25 } as Record<RarityKey, number>,
  /** ×2 weight for a Boon sharing a tag with an owned Boon, the House or a drafted unit. */
  synergyMult: 2,
  offerSize: 3,
  /** Creeping Wake / Wayshrine offering: 4 options. */
  offerSizeBonus: 4,
  skipCrowns: 15,
  spoilsCrowns: 80,
  /** Draft offers: pick 1 of 3. */
  draftOfferSize: 3,
};

export const CROWNS = {
  /** Victory: 20 + 4d. */
  base: 20,
  perDepth: 4,
  eliteBonus: 40,
  parBonus: 30,
  unbroken: 30,
  uprooted: 30,
  bloodMoonMult: 1.5,
  plunder: { nest: 10, nestFortifiedMult: 2, picket: 5, cache: 15, ancientCache: 60 },
};

export function battleCrownsBase(d: number): number {
  return CROWNS.base + CROWNS.perDepth * d;
}

export const RENOWN = {
  battleWon: 10,
  eliteWon: 15,
  regentSlain: 50,
  /** Per Nest and Root Heart destroyed. */
  nestDestroyed: 2,
  nodeVisited: 5,
  /** × (1 + 0.15 × Thornbound tier). */
  tierPct: 0.15,
};

export function renownTotal(p: { battlesWon: number; elitesWon: number; regentSlain: boolean; nests: number; nodes: number; tier: number }): number {
  const raw =
    RENOWN.battleWon * p.battlesWon +
    RENOWN.eliteWon * p.elitesWon +
    (p.regentSlain ? RENOWN.regentSlain : 0) +
    RENOWN.nestDestroyed * p.nests +
    RENOWN.nodeVisited * p.nodes;
  return floorEps(raw * (1 + RENOWN.tierPct * p.tier));
}

/** Thornbound tier effects (§N), cumulative: tier k applies every row <= k. */
export const THORNBOUND_EFFECTS = {
  maxTier: 3,
  /** I: waves ×1.1. */
  waveMult: 1.1,
  /** II: Nests and Root Hearts +25% HP. */
  nestHpMult: 1.25,
  /** III: T1 −15 s, Nest garrisons +2 value. */
  t1Delta: -15,
  garrisonAdd: 2,
};

// ===========================================================================
// Peddler, Camp, Events (§L)
// ===========================================================================

export interface SellswordOffer {
  unit: PlayerUnitId;
  count: number;
  rank: 0 | 1 | 2 | 3;
  price: number;
}

export const PEDDLER = {
  boonPrices: { C: 55, R: 100, M: 175 } as Record<RarityKey, number>,
  draftPrice: 90,
  resolvePrice: 90,
  sellswordOffers: [
    { unit: 'ashpike', count: 2, rank: 1, price: 35 },
    { unit: 'bowman', count: 3, rank: 1, price: 45 },
    { unit: 'courser', count: 2, rank: 1, price: 55 },
  ] as SellswordOffer[],
  sellswordSlots: 2,
  rerollBase: 15,
  rerollStep: 10,
  /** Guild Ties: prices −15% and +1 Boon in stock (random rarity). */
  guildTiesDiscount: 0.15,
  guildTiesExtraBoons: 1,
};

export const CAMP = {
  restResolve: 1,
  restCrownsAtMax: 30,
  drillRanks: 1,
  /** Empty Retinue: 2 Rank I Ashpikes as Sellswords instead. */
  drillEmptyUnit: 'ashpike' as PlayerUnitId,
  drillEmptyCount: 2,
  drillEmptyRank: 1 as 0 | 1 | 2 | 3,
};

/** Event outcome numbers (§L Events). Outcomes are applied by the run module. */
export const EVENT_NUMBERS = {
  refugees_ford: {
    payCrowns: 40,
    extraTillers: 1,
    armUnit: 'ashpike' as PlayerUnitId,
    armCount: 2,
    armRank: 1 as 0 | 1 | 2 | 3,
    titheCrowns: 35,
    /** Next battle Grain gather −10%. */
    titheGrainGatherPct: -10,
  },
  thorn_smith: {
    /** Bargain hidden at 1 Resolve. */
    minResolve: 2,
    resolveCost: 1,
    rareOptions: 2,
    /** Ember-Tempered Mail is one of the options if unowned. */
    featuredBoon: 'ember_mail' as const,
    mercyResolve: 1,
    mercyCrownsAtMax: 30,
  },
  sellsword_company: {
    hireCrowns: 70,
    hireUnit: 'courser' as PlayerUnitId,
    hireCount: 3,
    hireRank: 1 as 0 | 1 | 2 | 3,
    duelWinChance: 0.5,
    duelLossCrowns: 30,
    duelLossWardenHpPct: 0.5,
  },
  cold_watchfire: {},
  hollow_envoy: {
    waveMult: 1.15,
    cutDownCrowns: 25,
  },
  wayshrine: {
    prayResolve: 1,
    offerCrowns: 40,
    offerPicks: 2,
    offerOptions: 4,
  },
};

// ===========================================================================
// Doctrine targeting (§I)
// ===========================================================================

/** Enemy types and their unlock depth (§C "Enemy types available"). */
export const ENEMY_UNLOCK_DEPTH: Partial<Record<EnemyUnitId, number>> = {
  thornling: 1,
  briarguard: 1,
  spinecaster: 1,
  stagrider: 2,
  rootbreaker: 3,
  gloamwitch: 4,
  thornhusk: 5,
};

/** Swift Hunt forces the primary doctrine (§K). */
export const FORCED_DOCTRINE: Partial<Record<ModifierId, DoctrineId>> = { swift_hunt: 'hunt' };

/** Modifier-specific encounter numbers (§K). */
export const MODIFIER_NUMBERS = {
  bloodMoonWaveMult: 1.3,
  thickFogSight: -2,
  thickFogHornLead: 10,
  bountifulT1Delta: -20,
  fortifiedNestHpMult: 1.5,
  swiftHuntCavalrySpeedPct: 20,
  downpourRange: -1,
};
