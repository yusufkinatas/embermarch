/**
 * Runtime lists of every id in the closed unions of src/sim/types.ts.
 * Each list is derived from a `Record<Union, true>` so the compiler rejects a
 * missing or misspelled id. Useful for iteration (UI lists, tests, sweeps).
 */
import type {
  BiomeId,
  BoonId,
  BuildingId,
  DoctrineId,
  DraftId,
  EnemyBuildingId,
  EnemyUnitId,
  EventId,
  HouseId,
  MetaUnlockId,
  ModifierId,
  NeutralObjectId,
  ObjectiveId,
  PlayerBuildingId,
  PlayerUnitId,
  ResearchId,
  UnitId,
  VanguardId,
} from '../sim/types';

function keysOf<K extends string>(rec: Record<K, true>): K[] {
  return Object.keys(rec) as K[];
}

export const PLAYER_UNIT_IDS: readonly PlayerUnitId[] = keysOf<PlayerUnitId>({
  tiller: true,
  warden: true,
  ashpike: true,
  bowman: true,
  courser: true,
  oathshield: true,
  brandbow: true,
  destrier: true,
  gatebreaker: true,
  outrider: true,
  lampbearer: true,
});

export const ENEMY_UNIT_IDS: readonly EnemyUnitId[] = keysOf<EnemyUnitId>({
  thornling: true,
  briarguard: true,
  spinecaster: true,
  stagrider: true,
  rootbreaker: true,
  gloamwitch: true,
  thornhusk: true,
  antlered_lord: true,
  briar_regent: true,
});

export const UNIT_IDS: readonly UnitId[] = [...PLAYER_UNIT_IDS, ...ENEMY_UNIT_IDS];

export const PLAYER_BUILDING_IDS: readonly PlayerBuildingId[] = keysOf<PlayerBuildingId>({
  hearth: true,
  cottage: true,
  storehouse: true,
  grainplot: true,
  muster_hall: true,
  bowyard: true,
  paddock: true,
  forgehall: true,
  brazier_tower: true,
  siegeyard: true,
});

export const ENEMY_BUILDING_IDS: readonly EnemyBuildingId[] = keysOf<EnemyBuildingId>({
  thorn_nest: true,
  thornspire: true,
  root_heart: true,
  briar_throne: true,
});

export const NEUTRAL_OBJECT_IDS: readonly NeutralObjectId[] = keysOf<NeutralObjectId>({
  ruined_cache: true,
  ancient_cache: true,
  beacon_stone: true,
});

export const BUILDING_IDS: readonly BuildingId[] = [...PLAYER_BUILDING_IDS, ...ENEMY_BUILDING_IDS, ...NEUTRAL_OBJECT_IDS];

export const RESEARCH_IDS: readonly ResearchId[] = keysOf<ResearchId>({
  hearth_watch: true,
  stoked_braziers: true,
  log_sledges: true,
  furrow_rites: true,
  deep_picks: true,
  ash_hafts: true,
  quick_draw: true,
  thunder_charge: true,
  ember_edge: true,
  barbed_heads: true,
  hauberks: true,
});

export const BOON_IDS: readonly BoonId[] = keysOf<BoonId>({
  harvest_songs: true,
  deep_delvers: true,
  laden_packs: true,
  hearthborn: true,
  master_joiners: true,
  pike_discipline: true,
  yew_staves: true,
  swift_coursers: true,
  second_wind: true,
  thornreaper_levy: true,
  spoils_of_the_wake: true,
  baggage_train: true,
  quartermasters: true,
  veterans_oath: true,
  ember_mail: true,
  firebrand: true,
  field_surgeons: true,
  flame_banner: true,
  plunderers: true,
  kiln_masons: true,
  raiders_bounty: true,
  kindled_earth: true,
  flame_hearth: true,
  warlords_gambit: true,
  ember_tithe: true,
});

export const DRAFT_IDS: readonly DraftId[] = keysOf<DraftId>({
  draft_shieldwall: true,
  draft_firecraft: true,
  draft_heavy_horse: true,
  draft_siegecraft: true,
  draft_outriding: true,
  draft_lamplight: true,
});

export const MODIFIER_IDS: readonly ModifierId[] = keysOf<ModifierId>({
  blood_moon: true,
  thick_fog: true,
  bountiful_wilds: true,
  creeping_wake: true,
  ember_famine: true,
  fortified_nests: true,
  swift_hunt: true,
  downpour: true,
  ancient_cache: true,
  old_watchtowers: true,
});

export const EVENT_IDS: readonly EventId[] = keysOf<EventId>({
  refugees_ford: true,
  thorn_smith: true,
  sellsword_company: true,
  cold_watchfire: true,
  hollow_envoy: true,
  wayshrine: true,
});

export const HOUSE_IDS: readonly HouseId[] = keysOf<HouseId>({
  ardent: true,
  tallow: true,
  grimbrand: true,
  lowmere: true,
});

export const META_UNLOCK_IDS: readonly MetaUnlockId[] = keysOf<MetaUnlockId>({
  codex_1: true,
  codex_2: true,
  codex_3: true,
  house_tallow: true,
  outriding: true,
  lamplight: true,
  hawk_eyes: true,
  guild_ties: true,
  house_grimbrand: true,
  seasoned_retinue: true,
  opening_boon: true,
  house_lowmere: true,
  hearth_lore: true,
  fourth_banner: true,
});

export const DOCTRINE_IDS: readonly DoctrineId[] = keysOf<DoctrineId>({
  swarm: true,
  spines: true,
  hunt: true,
  siegebreak: true,
  court: true,
});

export const OBJECTIVE_IDS: readonly ObjectiveId[] = keysOf<ObjectiveId>({
  raze: true,
  holdfast: true,
  beacons: true,
  elite: true,
  boss: true,
});

export const BIOME_IDS: readonly BiomeId[] = keysOf<BiomeId>({
  greenmarch: true,
  fenreach: true,
  ashwood: true,
  heartwood: true,
});

export const VANGUARD_IDS: readonly VanguardId[] = keysOf<VanguardId>({
  muster_hall: true,
  bowyard: true,
  storehouse: true,
});
