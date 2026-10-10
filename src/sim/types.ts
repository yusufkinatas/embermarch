/**
 * EMBERMARCH shared simulation contract.
 *
 * Every module (sim core, nav, encounter, mapgen, render, HUD, run layer) codes
 * against these types. Changes must be ADDITIVE (new optional fields / new union
 * members). Never rename or remove a field without coordinating (see ARCHITECTURE.md).
 *
 * Conventions:
 * - World units are TILES. Entity (x, y) is the CENTER in tile coordinates (floats).
 *   Tile (tx, ty) covers [tx, tx+1) x [ty, ty+1). Tile index = ty * map.w + tx.
 * - Buildings/resource nodes have a top-left tile (tx, ty) and footprint (w, h);
 *   their center is (tx + w/2, ty + h/2).
 * - Time is in seconds; the sim advances in fixed ticks of TICK_DT.
 * - All gameplay randomness uses world.rng (or forks of it). Cosmetic randomness may use Math.random.
 */
import type { Rng } from '../core/rng';
import type { EncounterState, EnemyUnitAI, NestState, ObjectState } from './encounter/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;
export const TILE_PX = 32;

export const PLAYER = 0;
export const ENEMY = 1;
export const NEUTRAL = 2;
export type Owner = 0 | 1 | 2;

// ---------------------------------------------------------------------------
// Identifiers (closed unions; data tables in src/data are keyed by these)
// ---------------------------------------------------------------------------

export type ResourceType = 'grain' | 'timber' | 'ember';
export const RESOURCE_TYPES: readonly ResourceType[] = ['grain', 'timber', 'ember'];
export interface ResourceBag {
  grain: number;
  timber: number;
  ember: number;
}
export type Cost = Partial<ResourceBag>;

export type PlayerUnitId =
  | 'tiller'
  | 'warden'
  | 'ashpike'
  | 'bowman'
  | 'courser'
  | 'oathshield'
  | 'brandbow'
  | 'destrier'
  | 'gatebreaker'
  | 'outrider'
  | 'lampbearer';
export type EnemyUnitId =
  | 'thornling'
  | 'briarguard'
  | 'spinecaster'
  | 'stagrider'
  | 'rootbreaker'
  | 'gloamwitch'
  | 'thornhusk'
  | 'antlered_lord'
  | 'briar_regent';
export type UnitId = PlayerUnitId | EnemyUnitId;

export type UnitClass = 'worker' | 'infantry' | 'ranged' | 'cavalry' | 'siege' | 'hero' | 'boss';

export type PlayerBuildingId =
  | 'hearth'
  | 'cottage'
  | 'storehouse'
  | 'grainplot'
  | 'muster_hall'
  | 'bowyard'
  | 'paddock'
  | 'forgehall'
  | 'brazier_tower'
  | 'siegeyard';
export type EnemyBuildingId = 'thorn_nest' | 'thornspire' | 'root_heart' | 'briar_throne';
/** Neutral map objects are modelled as invulnerable, untargetable buildings owned by NEUTRAL. */
export type NeutralObjectId = 'ruined_cache' | 'ancient_cache' | 'beacon_stone';
export type BuildingId = PlayerBuildingId | EnemyBuildingId | NeutralObjectId;

/** Entity-based resource nodes. Trees are NOT entities: they are forest tiles (see GameMap.treeAmount). */
export type ResourceNodeId = 'thicket' | 'ember_seam';

export type ResearchId =
  | 'hearth_watch'
  | 'stoked_braziers'
  | 'log_sledges'
  | 'furrow_rites'
  | 'deep_picks'
  | 'ash_hafts'
  | 'quick_draw'
  | 'thunder_charge'
  | 'ember_edge'
  | 'barbed_heads'
  | 'hauberks';

export type BoonId =
  | 'harvest_songs'
  | 'deep_delvers'
  | 'laden_packs'
  | 'hearthborn'
  | 'master_joiners'
  | 'pike_discipline'
  | 'yew_staves'
  | 'swift_coursers'
  | 'second_wind'
  | 'thornreaper_levy'
  | 'spoils_of_the_wake'
  | 'baggage_train'
  | 'quartermasters'
  | 'veterans_oath'
  | 'ember_mail'
  | 'firebrand'
  | 'field_surgeons'
  | 'flame_banner'
  | 'plunderers'
  | 'kiln_masons'
  | 'raiders_bounty'
  | 'kindled_earth'
  | 'flame_hearth'
  | 'warlords_gambit'
  | 'ember_tithe';

export type DraftId =
  | 'draft_shieldwall'
  | 'draft_firecraft'
  | 'draft_heavy_horse'
  | 'draft_siegecraft'
  | 'draft_outriding'
  | 'draft_lamplight';

export type ModifierId =
  | 'blood_moon'
  | 'thick_fog'
  | 'bountiful_wilds'
  | 'creeping_wake'
  | 'ember_famine'
  | 'fortified_nests'
  | 'swift_hunt'
  | 'downpour'
  | 'ancient_cache'
  | 'old_watchtowers';

export type EventId =
  | 'refugees_ford'
  | 'thorn_smith'
  | 'sellsword_company'
  | 'cold_watchfire'
  | 'hollow_envoy'
  | 'wayshrine';

export type HouseId = 'ardent' | 'tallow' | 'grimbrand' | 'lowmere';

export type MetaUnlockId =
  | 'codex_1'
  | 'codex_2'
  | 'codex_3'
  | 'house_tallow'
  | 'outriding'
  | 'lamplight'
  | 'hawk_eyes'
  | 'guild_ties'
  | 'house_grimbrand'
  | 'seasoned_retinue'
  | 'opening_boon'
  | 'house_lowmere'
  | 'hearth_lore'
  | 'fourth_banner';

export type DoctrineId = 'swarm' | 'spines' | 'hunt' | 'siegebreak' | 'court';
export type ObjectiveId = 'raze' | 'holdfast' | 'beacons' | 'elite' | 'boss';
export type BiomeId = 'greenmarch' | 'fenreach' | 'ashwood' | 'heartwood';
export type VanguardId = 'muster_hall' | 'bowyard' | 'storehouse';

export type ProjectileKind = 'arrow' | 'fire_arrow' | 'bolt' | 'spine' | 'firepot';

// ---------------------------------------------------------------------------
// Effects (boons, houses, research, meta, modifiers) -> composeStats()
// ---------------------------------------------------------------------------

/** Which entities an effect applies to. All present criteria must match (AND). Empty selector matches nothing. */
export interface Selector {
  units?: UnitId[];
  buildings?: BuildingId[];
  classes?: UnitClass[];
  /** infantry | ranged | cavalry | siege (excludes worker, hero, boss). */
  military?: boolean;
  /** base range < 1.5 tiles. Combine with military. */
  melee?: boolean;
  /** base range >= 1.5 tiles (has a projectile). Combine with military. */
  rangedAttack?: boolean;
  allUnits?: boolean;
  allBuildings?: boolean;
}

export type StatKey =
  | 'hp'
  | 'atk'
  /** Multiplier on all outgoing damage (pct only), e.g. Warlord's Gambit +25%. */
  | 'damage'
  | 'cooldown'
  | 'range'
  | 'armor'
  | 'speed'
  | 'sight'
  | 'trainTime'
  | 'buildTime'
  /** Structure multiplier override (use `set`). */
  | 'structMod'
  /** Bolts per volley for Hearth / towers (use `add`). */
  | 'volley';

/**
 * Special-rule flags. Each is implemented by exactly one owner module (see ARCHITECTURE.md "Flag ownership").
 */
export type EffectFlag =
  | 'spoils_of_the_wake' // +3 grain +1 ember per enemy unit killed (sim-core)
  | 'baggage_train' // run layer carries unspent resources (run)
  | 'veterans_oath' // run layer: retinue cap +3, +1 rank when carried (run)
  | 'firebrand' // bowman/outrider hits apply burn 2/s 3s (sim-core)
  | 'field_surgeons' // military (non-siege) undamaged 5s regen 2 hp/s (sim-core)
  | 'flame_banner' // allies within 5 tiles of Warden +15% ATK (sim-core)
  | 'plunderers' // +100 G/T/E on Nest or Picket destroyed (+10 crowns via result) (sim-core)
  | 'kiln_masons' // towers on blight, build 2x, ward radius 3 (sim-core placement/build; encounter ward)
  | 'raiders_bounty' // courser hit on Nest/Picket spire +3 grain (sim-core)
  | 'kindled_earth' // buildings ward 5; player ignores blight slow/gather penalty (encounter ward, nav/sim-core penalties)
  | 'flame_hearth' // Hearth +1200 HP, regen 6/s, 3 bolts (stat effects + regen flag) (sim-core)
  | 'ember_tithe' // +1.2 ember/s passive (sim-core)
  | 'second_wind' // Warden ability CD -30%, respawn 25 + 5/death (sim-core)
  | 'home_seam_bonus' // value: extra Ember on home seam (sim-core createWorld)
  | 'hearth_watch' // Rally the Hearth CD 120, duration 25 (sim-core)
  | 'thunder_charge' // courser charge x1.5, destrier charge x2.5 (sim-core)
  | 'hawk' // Warden gains Hawk ability on W (sim-core)
  | 'burn_disabled'; // Downpour (sim-core)

export type Effect =
  | { kind: 'stat'; sel: Selector; stat: StatKey; add?: number; pct?: number; set?: number }
  | { kind: 'cost'; sel: Selector; res?: ResourceType; add?: number; pct?: number; set?: number }
  /** Gather-rate change in percent. source narrows to a node kind (e.g. 'grainplot'). */
  | { kind: 'gather'; res: ResourceType | 'all'; source?: 'thicket' | 'tree' | 'ember_seam' | 'grainplot'; pct: number }
  | { kind: 'carry'; res: ResourceType | 'all'; add: number }
  | { kind: 'startRes'; res: Cost }
  | { kind: 'startUnits'; unit: PlayerUnitId; count: number }
  | { kind: 'popCap'; add: number }
  | { kind: 'flag'; flag: EffectFlag; value?: number };

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

export const Terrain = {
  Grass: 0,
  Shallows: 1,
  Water: 2,
  Rock: 3,
  /** Tree tile; GameMap.treeAmount > 0. Becomes Stump when depleted. */
  Forest: 4,
  Stump: 5,
  BriarWall: 6,
} as const;
export type TerrainType = (typeof Terrain)[keyof typeof Terrain];

export interface GameMap {
  w: number;
  h: number;
  biome: BiomeId;
  /** TerrainType per tile. */
  terrain: Uint8Array;
  /** Timber remaining per tile (only meaningful for Forest tiles). */
  treeAmount: Uint16Array;
  /** Cosmetic per-tile variation 0..255 (grass shade, tree shape). Not gameplay. */
  variant: Uint8Array;
}

export interface TilePos {
  tx: number;
  ty: number;
}

export interface ResourceSpawn {
  type: ResourceNodeId;
  tx: number;
  ty: number;
  amount: number;
  /** Contested seams sit toward Nests (and may have a Picket). */
  contested?: boolean;
  /** True for the single home Ember Seam. */
  home?: boolean;
}

export interface PicketSpawn {
  /** Thornspire tile (1x1). */
  tx: number;
  ty: number;
  /** Index into anchors.resources of the seam it guards. */
  seamIndex: number;
}

/** Placement anchors produced by mapgen; createWorld/initEncounter turn these into entities. */
export interface MapAnchors {
  /** Top-left tile of the 4x4 Hearth. */
  hearth: TilePos;
  /** Top-left tiles of 3x3 Thorn Nests (or Root Hearts on the boss map). */
  nests: TilePos[];
  /** Thornspires guarding Nests (1x1), each with the index of its Nest. */
  nestSpires: (TilePos & { nestIndex: number })[];
  pickets: PicketSpawn[];
  resources: ResourceSpawn[];
  caches: (TilePos & { type: 'ruined_cache' | 'ancient_cache' })[];
  /** Top-left tiles of 2x2 Beacon Stones (Beacons objective only). */
  beacons: TilePos[];
  /** Vanguard building sites (top-left tiles), already validated as placeable. */
  vanguard: {
    muster_hall: TilePos;
    bowyard: TilePos;
    storehouse: TilePos;
    grainplot: TilePos;
  };
  /** Old Watchtowers modifier: top-left tiles of 2x2 player Brazier Towers. */
  watchtowers: TilePos[];
  /** Boss map only. */
  throne?: TilePos;
  /** Muster point per Nest (tile center coords, 3 tiles in front of the Nest toward the Hearth). */
  musterPoints: { x: number; y: number }[];
}

export interface MapGenParams {
  seed: number;
  objective: ObjectiveId;
  biome: BiomeId;
  depth: number;
  modifiers: ModifierId[];
}

export interface GeneratedMap {
  map: GameMap;
  anchors: MapAnchors;
  seed: number;
  attempts: number;
  usedFallback: boolean;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface EntityBase {
  id: number;
  owner: Owner;
  /** Center position in tiles. */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Cannot take damage (Briar Throne, caches, beacons, Last Stand window). */
  invulnerable: boolean;
  /** Cannot be selected as an attack target (phase-1 Regent, neutral objects). */
  untargetable: boolean;
  bornTick: number;
  /** Tick of last damage taken (-1 if never). */
  lastDamagedTick: number;
  /** Entity id of the last attacker (0 if none). */
  lastAttackerId: number;
}

export interface BurnInstance {
  applierId: number;
  dps: number;
  remaining: number;
}

export interface Buff {
  id: 'rallying_horn' | 'harvest_hymn' | 'rally_hearth' | 'rooted' | 'enrage' | 'last_stand' | string;
  /** Tick at which the buff expires. */
  until: number;
  /** Free-form numbers (e.g. atkPct, speedPct). */
  data?: Record<string, number>;
}

export type GatherTarget = { kind: 'node'; id: number } | { kind: 'tree'; tile: number } | { kind: 'plot'; id: number };

/**
 * Orders are the shared vocabulary between commands, the enemy AI and unit behaviors.
 * The optional fields after `type` are internal execution state owned by sim-core.
 */
export type Order =
  | { type: 'idle' }
  | { type: 'move'; x: number; y: number }
  | { type: 'attackMove'; x: number; y: number }
  | { type: 'attack'; targetId: number; /** internal */ chaseFromX?: number; chaseFromY?: number }
  | { type: 'gather'; target: GatherTarget; /** internal */ phase?: 'toNode' | 'gathering' | 'toDropoff'; dropoffId?: number; waitTimer?: number }
  | { type: 'deposit'; buildingId: number }
  /** Construct a foundation or repair a damaged own building. */
  | { type: 'build'; buildingId: number }
  | { type: 'hold' }
  | { type: 'flee'; x: number; y: number; resumeAt?: number };

export type OrderType = Order['type'];

/** Movement intent set by behaviors; consumed by the nav movement system. */
export interface MoveIntent {
  /** Goal point (tile coords). For entity targets this is refreshed from the target each tick. */
  x: number;
  y: number;
  /** Follow this entity (goal = its position / nearest footprint point). 0 = none. */
  targetId: number;
  /** Arrive when edge-to-edge distance to the target entity (or distance to point) <= range. */
  range: number;
  /**
   * 'player' pathing treats all buildings as blocked. 'enemy' pathing uses flow costs where player
   * buildings cost 12 and are reported via unit.blockedBy when the next tile is a building.
   */
  mode: 'player' | 'enemy';
  /** Optional shared flow-field key for group orders (same goal). */
  flowKey?: string;
  /** Speed cap for cohesion bands (tiles/s); 0 = none. */
  speedCap?: number;
}

export type MoveStatus = 'none' | 'moving' | 'arrived' | 'unreachable' | 'stuck' | 'blocked';

export interface PathState {
  /** Waypoints in tile-center coordinates. */
  waypoints: { x: number; y: number }[];
  index: number;
  /** Flow field key if following a flow field instead of waypoints. */
  flowKey?: string;
  goalX: number;
  goalY: number;
  /** Tick the path was computed (for repath throttling). */
  tick: number;
}

export interface Unit extends EntityBase {
  kind: 'unit';
  type: UnitId;
  cls: UnitClass;
  radius: number;
  /** Position at the start of the current tick (render interpolation). */
  prevX: number;
  prevY: number;
  /** Facing angle in radians (0 = +x). */
  facing: number;
  /** Velocity in tiles/s from the last tick (render / animation). */
  vx: number;
  vy: number;
  /**
   * Current max speed in tiles/s, set by sim-core every tick BEFORE movement
   * (composed stat × buff multipliers; 0 while rooted). Nav multiplies by terrain/Blight factors.
   */
  speed: number;

  order: Order;
  /** Shift-queued orders (max 8). */
  queue: Order[];
  move: MoveIntent | null;
  moveStatus: MoveStatus;
  /** Building id blocking an 'enemy'-mode path (0 = none). */
  blockedBy: number;
  path: PathState | null;
  /** Stuck detection bookkeeping (nav-owned). */
  stuck: { checkX: number; checkY: number; timer: number; repaths: number; windowTimer: number };

  /** Current attack target (0 = none). */
  targetId: number;
  /** Seconds until the next attack is ready. */
  attackCooldown: number;
  /** Tick of the last attack swing/shot (render animation). */
  lastAttackTick: number;
  /** Tiles moved since last stop/attack (Charge). */
  movedSinceAttack: number;
  /** Idle-spot for auto-acquire leash (set when unit goes idle). */
  homeX: number;
  homeY: number;

  carry: { type: ResourceType; amount: number } | null;
  /** Remembered gather job for resume after deposit/flee/rally. */
  job: GatherTarget | null;

  kills: number;
  rank: 0 | 1 | 2 | 3;
  burns: BurnInstance[];
  buffs: Buff[];
  /** True if this unit came from the Retinue/Sellswords. */
  carried: boolean;
  /** Enemy-AI state (owned by the encounter module); null for player units. */
  ai: EnemyUnitAI | null;
}

export interface TrainQueueItem {
  unit: PlayerUnitId;
  /** Seconds of progress made. */
  progress: number;
  /** Total train time (composed) captured when training starts. */
  total: number;
  /** Cost paid (refund on cancel). */
  paid: Cost;
}

export interface RallyPoint {
  x: number;
  y: number;
  targetId?: number;
  tile?: number;
}

export interface Building extends EntityBase {
  kind: 'building';
  type: BuildingId;
  tx: number;
  ty: number;
  w: number;
  h: number;
  built: boolean;
  /** 0..1 construction progress. */
  buildProgress: number;
  /** Seconds of work done on construction (for rate calc). */
  queue: TrainQueueItem[];
  research: { id: ResearchId; progress: number; total: number; paid: Cost } | null;
  rally: RallyPoint | null;
  /** Defensive fire state (Hearth, Brazier Tower, Thornspire). */
  attackCooldown: number;
  targetId: number;
  lastAttackTick: number;
  /** Number of Tillers currently working (Grainplot). */
  gatherers: number;
  /** Cumulative Grainplot "ripeness" 0..1 for rendering. */
  ripeness: number;
  /** Encounter-owned state for Nests / Root Hearts. */
  nest: NestState | null;
  /** Encounter-owned state for caches / beacons / throne. */
  object: ObjectState | null;
}

export interface ResourceNode extends EntityBase {
  kind: 'resource';
  type: ResourceNodeId;
  resType: ResourceType;
  tx: number;
  ty: number;
  w: number;
  h: number;
  amount: number;
  initial: number;
  gatherers: number;
  maxGatherers: number;
  contested: boolean;
}

export type Entity = Unit | Building | ResourceNode;

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  /** Attacker entity id (may be dead by impact). */
  sourceId: number;
  owner: Owner;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  startX: number;
  startY: number;
  /** Homing target (0 for ground-targeted). */
  targetId: number;
  /** Ground target / last known target position. */
  tx: number;
  ty: number;
  speed: number;
  /** Damage packet computed at fire time; applied on impact. */
  packet: DamagePacket;
  alive: boolean;
}

export interface DamagePacket {
  /** Raw damage before armor (already includes counters/structMod/resist/charge/spent/rank/pcts). */
  raw: number;
  /** Combined counter multiplier for popups (>1 counter, <1 resisted). */
  mult: number;
  attackKind: 'melee' | 'ranged';
  burn?: { dps: number; duration: number };
  splash?: { radius: number; edge: number };
  /** Units only (Hearth/towers/spires). */
  unitsOnly?: boolean;
  /** Structures only (siege). */
  structuresOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export interface PlayerState {
  owner: Owner;
  res: ResourceBag;
  pop: number;
  popCap: number;
  researched: ResearchId[];
  /** Temper chosen this battle (locks the other two). */
  temper: ResearchId | null;
  unlockedUnits: PlayerUnitId[];
  unlockedBuildings: PlayerBuildingId[];
  /** Composed effects for this owner (from setup + completed research). */
  effects: Effect[];
  /** Flags present in `effects` (value = sum of flag values, or 1 if valueless). Recomputed with effects. */
  flags: Partial<Record<EffectFlag, number>>;
  /** Rally the Hearth: tick when ready / tick when active effect ends. */
  rallyReadyTick: number;
  rallyUntilTick: number;
  /** Warden ability cooldowns: tick when ready. */
  abilityReadyTick: { Q: number; W: number };
  /** Warden respawn: tick when the Warden returns, or -1 if alive. */
  wardenRespawnTick: number;
  wardenDeaths: number;
  stats: {
    gathered: ResourceBag;
    unitsTrained: number;
    unitsLost: number;
    kills: number;
    buildingsBuilt: number;
    buildingsLost: number;
  };
  /** Next tick at which the "pop capped" alert may fire again. */
  popAlertTick: number;
}

// ---------------------------------------------------------------------------
// Fog / vision
// ---------------------------------------------------------------------------

export const Fog = { Unexplored: 0, Explored: 1, Visible: 2 } as const;

export interface FogState {
  /** Fog per tile for the player: 0 unexplored, 1 explored, 2 visible. */
  state: Uint8Array;
  /** Increments whenever state changes (renderer redraw trigger). */
  version: number;
}

/** Extra temporary vision (Hawk, lit Beacons). */
export interface VisionSource {
  x: number;
  y: number;
  r: number;
  /** Tick when it expires (-1 = permanent until removed). */
  until: number;
  tag: string;
}

// ---------------------------------------------------------------------------
// Blight (owned by encounter; read by nav/sim-core/render)
// ---------------------------------------------------------------------------

export interface BlightState {
  /** 1 if the tile is currently blighted. */
  tiles: Uint8Array;
  /** Ward counters per tile (Kindled Earth, Kiln Masons). */
  ward: Uint16Array;
  /** Increments on any change (renderer redraw trigger). */
  version: number;
}

// ---------------------------------------------------------------------------
// Battle setup / result (run layer <-> sim)
// ---------------------------------------------------------------------------

export interface CarriedUnit {
  type: PlayerUnitId;
  rank: 0 | 1 | 2 | 3;
  kills: number;
}

export interface BattleSetup {
  seed: number;
  /** Run-map node id (for labelling and seeds). */
  nodeId: string;
  objective: ObjectiveId;
  biome: BiomeId;
  /** Battle depth d (1-6). The boss uses its own constants; depth is 7 there. */
  depth: number;
  isElite: boolean;
  isBoss: boolean;
  modifiers: ModifierId[];
  /** Primary doctrine (rolled by the run layer so the briefing can show it). */
  doctrine: DoctrineId;
  /** Thornbound tier 0-3. */
  tier: number;
  house: HouseId;
  vanguard: VanguardId;
  unlockedUnits: PlayerUnitId[];
  unlockedBuildings: PlayerBuildingId[];
  /** Everything that modifies the player (boons, house passives, meta, events, player-side modifiers). */
  playerEffects: Effect[];
  /** Enemy-side stat effects (Swift Hunt cavalry speed, Downpour range, ...). */
  enemyEffects: Effect[];
  boons: BoonId[];
  metaUnlocks: MetaUnlockId[];
  retinue: CarriedUnit[];
  sellswords: CarriedUnit[];
  /** 1 normally; 0.5 after losing the Sellsword duel. */
  wardenHpPct: number;
  /** Resolve available for Last Stand (boss only). */
  resolve: number;
  /** Extra run-level wave multiplier M (Hollow Envoy x1.15, Thornbound I x1.1 already multiplied in). */
  waveMult: number;
  /** Cold Watch-Fire: terrain explored, objectives ghosted, wave 1 never launches. */
  coldWatchfire: boolean;
  /** UI help: show first-run hints / explicit doctrine answers. */
  showHints: boolean;
  /** Extra starting resources from Baggage Train etc. (added on top of balance start + startRes effects). */
  bonusRes: Cost;
}

export interface BattleResult {
  outcome: 'victory' | 'defeat' | 'retreat';
  /** Battle clock seconds at the end. */
  time: number;
  objective: ObjectiveId;
  depth: number;
  /** Crowns plundered during the battle (Nests, Pickets, Caches, Plunderers). */
  plunderCrowns: number;
  underPar: boolean;
  /** Holdfast bonuses. */
  unbroken: boolean;
  uprooted: boolean;
  nestsDestroyed: number;
  picketsDestroyed: number;
  cachesLooted: number;
  ancientCacheLooted: boolean;
  lordSlain: boolean;
  regentSlain: boolean;
  /** Resolve spent on Last Stand during this battle. */
  lastStandsUsed: number;
  /** Surviving military units (Retinue candidates), excluding Tillers and the Warden. */
  survivors: CarriedUnit[];
  /** Unspent resources at the end (Baggage Train). */
  unspent: ResourceBag;
  stats: PlayerState['stats'];
}

// ---------------------------------------------------------------------------
// Commands (player input -> sim). issueCommand returns a CommandResult.
// ---------------------------------------------------------------------------

export type Command =
  /** Right-click smart command, resolved by sim-core against the target under the cursor. */
  | { type: 'smart'; unitIds: number[]; x: number; y: number; targetId?: number; queue?: boolean }
  | { type: 'move'; unitIds: number[]; x: number; y: number; queue?: boolean }
  | { type: 'attackMove'; unitIds: number[]; x: number; y: number; queue?: boolean }
  | { type: 'attack'; unitIds: number[]; targetId: number; queue?: boolean }
  | { type: 'gather'; unitIds: number[]; target: GatherTarget; queue?: boolean }
  /** Place a foundation (pays cost) and assign the given Tillers. */
  | { type: 'build'; unitIds: number[]; building: PlayerBuildingId; tx: number; ty: number; queue?: boolean }
  /** Help construct or repair an own building. */
  | { type: 'repair'; unitIds: number[]; targetId: number; queue?: boolean }
  | { type: 'stop'; unitIds: number[] }
  | { type: 'hold'; unitIds: number[] }
  /** Train at the shortest queue among buildingIds. count > 1 queues several (Shift = 5). */
  | { type: 'train'; buildingIds: number[]; unit: PlayerUnitId; count?: number }
  | { type: 'cancelTrain'; buildingId: number; index: number }
  | { type: 'research'; buildingId: number; research: ResearchId }
  | { type: 'cancelResearch'; buildingId: number }
  | { type: 'rally'; buildingIds: number[]; x: number; y: number; targetId?: number; tile?: number }
  /** Cancel a foundation (refund 100% before work, 50% after) or demolish a building. */
  | { type: 'demolish'; buildingId: number }
  /** V: Rally the Hearth. */
  | { type: 'rallyHearth' }
  /** Warden ability. Q = House ability, W = Hawk. Point-targeted abilities pass x/y. */
  | { type: 'ability'; slot: 'Q' | 'W'; x?: number; y?: number };

export interface CommandResult {
  ok: boolean;
  /** Player-facing reason when !ok, e.g. "Not enough Timber", "Population capped". */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Events (sim -> render / audio / HUD). Pushed to world.events; the battle
// controller drains them once per frame.
// ---------------------------------------------------------------------------

export type AlertKind =
  | 'under_attack'
  | 'tillers_attacked'
  | 'idle_tillers'
  | 'pop_capped'
  | 'building_complete'
  | 'research_complete'
  | 'unit_trained'
  | 'warden_fallen'
  | 'warden_returned'
  | 'wave_muster'
  | 'wave_launch'
  | 'wave_broken'
  | 'raid'
  | 'nest_destroyed'
  | 'beacon_lit'
  | 'beacon_snuffed'
  | 'last_stand'
  | 'cache_looted'
  | 'ascendant'
  | 'boss_phase'
  | 'info';

export type GameEvent =
  | { t: 'attack'; attackerId: number; targetId: number; x: number; y: number; tx: number; ty: number; ranged: boolean; projectile?: ProjectileKind; unitType?: UnitId | BuildingId }
  | { t: 'hit'; targetId: number; attackerId: number; x: number; y: number; damage: number; mult: number; popup: 'counter' | 'resisted' | null; targetOwner: Owner; isStructure: boolean }
  | { t: 'death'; id: number; kind: 'unit' | 'building'; type: UnitId | BuildingId; owner: Owner; x: number; y: number; w?: number; h?: number }
  | { t: 'spawn'; id: number; type: UnitId; owner: Owner; x: number; y: number }
  | { t: 'trained'; id: number; type: PlayerUnitId; x: number; y: number }
  | { t: 'placed'; id: number; type: BuildingId; owner: Owner }
  | { t: 'built'; id: number; type: BuildingId; owner: Owner; x: number; y: number }
  | { t: 'researched'; research: ResearchId; buildingId: number }
  | { t: 'dropoff'; unitId: number; res: ResourceType; amount: number; x: number; y: number }
  | { t: 'gather'; unitId: number; res: ResourceType; source: 'thicket' | 'tree' | 'ember_seam' | 'grainplot'; x: number; y: number }
  | { t: 'treeFelled'; tile: number }
  | { t: 'rankUp'; id: number; rank: number; x: number; y: number }
  | { t: 'alert'; kind: AlertKind; text: string; x?: number; y?: number; priority?: 'low' | 'normal' | 'high' }
  | { t: 'command'; kind: 'move' | 'attack' | 'gather' | 'build' | 'rally' | 'attackMove'; x: number; y: number; targetId?: number }
  | { t: 'ability'; name: string; x: number; y: number; radius: number; owner: Owner }
  | { t: 'telegraph'; shape: 'line' | 'ring'; x: number; y: number; x2?: number; y2?: number; radius?: number; width?: number; duration: number }
  | { t: 'knockback'; id: number }
  | { t: 'burn'; id: number }
  | { t: 'heal'; id: number; amount: number }
  | { t: 'waveMuster'; wave: number; nestId: number; x: number; y: number }
  | { t: 'waveLaunch'; wave: number; nestId: number; x: number; y: number }
  | { t: 'waveBroken'; wave: number; nestId: number }
  | { t: 'raidLaunch'; x: number; y: number }
  | { t: 'nestDestroyed'; id: number; x: number; y: number; wavePct: number }
  | { t: 'blightRecede'; x: number; y: number; radius: number }
  | { t: 'bossPhase'; phase: number }
  | { t: 'lastStand'; x: number; y: number }
  | { t: 'cacheLooted'; x: number; y: number; ember: number; crowns: number }
  | { t: 'beacon'; id: number; lit: boolean }
  | { t: 'shake'; magnitude: number; duration: number }
  | { t: 'slowmo'; factor: number; duration: number }
  | { t: 'sfx'; name: string; x?: number; y?: number }
  | { t: 'victory' }
  | { t: 'defeat' };

// ---------------------------------------------------------------------------
// Navigation grid / spatial index (nav-owned implementations)
// ---------------------------------------------------------------------------

export interface NavGrid {
  w: number;
  h: number;
  /** 1 = impassable terrain or static entity footprint. */
  blocked: Uint8Array;
  /** Static entity id occupying the tile (building / resource node), 0 if none. */
  occupant: Int32Array;
  /** Movement speed multiplier per tile from terrain (shallows 0.6, else 1). */
  speedMul: Float32Array;
  /** Increments whenever blocked/occupant changes (invalidates paths & flow fields). */
  version: number;
}

export interface SpatialHash {
  cellSize: number;
  cols: number;
  rows: number;
  /** Unit ids per cell (rebuilt every tick). */
  cells: number[][];
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export interface World {
  setup: BattleSetup;
  map: GameMap;
  anchors: MapAnchors;
  tick: number;
  /** Battle clock in seconds (starts after the Kindle countdown). */
  time: number;
  /** Kindle countdown seconds remaining (3 at start). Sim does not advance gameplay while > 0. */
  countdown: number;
  rng: Rng;
  nextId: number;
  entities: Map<number, Entity>;
  /** Live lists (dead entities are removed at end of tick). Order is stable (spawn order). */
  units: Unit[];
  buildings: Building[];
  resources: ResourceNode[];
  projectiles: Projectile[];
  players: [PlayerState, PlayerState, PlayerState];
  grid: NavGrid;
  spatial: SpatialHash;
  fog: FogState;
  vision: VisionSource[];
  blight: BlightState;
  encounter: EncounterState;
  /** Tile indices whose terrain changed this frame (tree felled). Renderer consumes & clears. */
  dirtyTiles: number[];
  events: GameEvent[];
  outcome: 'ongoing' | 'victory' | 'defeat';
  /** Last Stand uses this battle. */
  lastStandsUsed: number;
  /** Hearth entity id (0 if destroyed). */
  hearthId: number;
  /** Warden entity id (0 if fallen). */
  wardenId: number;
  /** Debug toggles. */
  debug: { revealAll: boolean; invulnerablePlayer: boolean };
}
