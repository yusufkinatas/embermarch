/**
 * Data-table definitions. Values live in sibling files (units.ts, buildings.ts, ...)
 * and are transcribed from docs/GDD.md. Pure data: no logic, no DOM.
 */
import type {
  BiomeId,
  BoonId,
  BuildingId,
  Cost,
  DoctrineId,
  DraftId,
  Effect,
  EnemyUnitId,
  EventId,
  HouseId,
  MetaUnlockId,
  ModifierId,
  PlayerBuildingId,
  PlayerUnitId,
  ProjectileKind,
  ResearchId,
  ResourceNodeId,
  ResourceType,
  UnitClass,
  UnitId,
} from '../sim/types';

export interface UnitDef {
  id: UnitId;
  name: string;
  /** One-line role, e.g. "Spear / anti-cavalry". */
  role: string;
  cls: UnitClass;
  side: 'player' | 'enemy';
  cost: Cost;
  /** Seconds. 0 for enemy units. */
  trainTime: number;
  hp: number;
  atk: number;
  /** Attack cooldown seconds (0 = does not attack). */
  cooldown: number;
  /** Edge-to-edge attack range in tiles. >= 1.5 means ranged (fires `projectile`). */
  range: number;
  armor: number;
  speed: number;
  sight: number;
  pop: number;
  /** Collision radius in tiles. */
  radius: number;
  /** Counter multipliers vs target class (missing = 1). Never applied vs hero/boss (except explicit `vsBoss`). */
  bonus: Partial<Record<UnitClass, number>>;
  /** Multiplier vs boss class (Gatebreaker 1.5 vs the Regent). */
  vsBoss?: number;
  /** Structure multiplier override (else classStructMod[cls]). */
  structMod?: number;
  /** Incoming damage multipliers by attack kind (Oathshield ranged 0.5). */
  resist?: { ranged?: number; melee?: number };
  projectile?: ProjectileKind;
  splash?: { radius: number; edge: number };
  burn?: { dps: number; duration: number };
  /** Charge: damage multiplier on the first hit after moving >= minDist tiles. */
  charge?: { mult: number; minDist: number };
  /** Spear units negate Charge. */
  negatesCharge?: boolean;
  /** Attacks structures only (siege). */
  structuresOnly?: boolean;
  /** Kite: step back `dist` tiles when an enemy melee unit is within `trigger` tiles (cooldown seconds). */
  kite?: { trigger: number; dist: number; cooldown: number };
  /** Heal / regen aura (Lampbearer heals allies, Gloamwitch regenerates Thornwake). */
  aura?: { radius: number; hps: number; maxStacks: number };
  /** Player units: where trained, command-card hotkey, building prerequisites. */
  trainedAt?: PlayerBuildingId;
  hotkey?: string;
  /** All of these buildings must exist (completed) to train. */
  requires?: PlayerBuildingId[];
  /** Enemy units: wave value, standing-eligible, first depth available. */
  value?: number;
  standingEligible?: boolean;
  fromDepth?: number;
  /** Short tooltip text. */
  desc: string;
  /** Classes this unit is strong / weak against (tooltips, Counter Wheel). */
  strongVs: UnitClass[];
  weakVs: UnitClass[];
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  side: 'player' | 'enemy' | 'neutral';
  cost: Cost;
  hp: number;
  armor: number;
  w: number;
  h: number;
  /** Base build time in seconds (0 = pre-placed only). */
  buildTime: number;
  sight: number;
  /** Defensive fire (units only). */
  attack?: { dmg: number; cooldown: number; range: number; projectile: ProjectileKind };
  popBonus?: number;
  /** Accepts resource drop-off. */
  dropoff?: boolean;
  trains?: PlayerUnitId[];
  research?: ResearchId[];
  /** Any-of prerequisite groups: each inner array is AND, outer is OR. e.g. [['muster_hall'],['bowyard']]. */
  requires?: PlayerBuildingId[][];
  /** Tiller build-menu hotkey. */
  hotkey?: string;
  /** Grainplot-style infinite gathering. */
  gather?: { res: ResourceType; rate: number; maxGatherers: number };
  invulnerable?: boolean;
  untargetable?: boolean;
  desc: string;
}

export interface ResourceNodeDef {
  id: ResourceNodeId | 'tree';
  name: string;
  res: ResourceType;
  /** Default amount (mapgen may override, e.g. contested seams, Ashwood trees). */
  amount: number;
  /** Gather rate per Tiller per second. */
  rate: number;
  maxGatherers: number;
  w: number;
  h: number;
}

export interface ResearchDef {
  id: ResearchId;
  name: string;
  building: PlayerBuildingId;
  hotkey: string;
  cost: Cost;
  time: number;
  /** Forgehall Temper (mutually exclusive per battle). */
  temper?: boolean;
  effects: Effect[];
  desc: string;
}

export type BoonTag = 'Econ' | 'Ember' | 'Fort' | 'Pike' | 'Bow' | 'Horse' | 'Siege' | 'Warden' | 'Veteran';
export type Rarity = 'C' | 'R' | 'M';

export interface BoonDef {
  id: BoonId;
  name: string;
  rarity: Rarity;
  tags: BoonTag[];
  kind: 'stat' | 'rule';
  pool: 'base' | 'codex_1' | 'codex_2' | 'codex_3';
  desc: string;
  effects: Effect[];
}

export interface DraftDef {
  id: DraftId;
  name: string;
  units: PlayerUnitId[];
  buildings: PlayerBuildingId[];
  /** Meta unlock required for the draft to be in the pool (null = always). */
  requiresMeta: MetaUnlockId | null;
  tags: BoonTag[];
  desc: string;
}

export interface ModifierDef {
  id: ModifierId;
  name: string;
  kind: 'positive' | 'negative' | 'mixed' | 'neutral';
  desc: string;
  payoffDesc: string;
  /** Flat Crowns added on victory. */
  crownsBonus?: number;
  /** Multiplier on battle Crowns. */
  crownsMult?: number;
  /** Player-side effects applied via setup.playerEffects. */
  playerEffects?: Effect[];
  /** Enemy-side effects applied via setup.enemyEffects. */
  enemyEffects?: Effect[];
}

export interface EventChoiceDef {
  id: string;
  label: string;
  desc: string;
}

export interface EventDef {
  id: EventId;
  title: string;
  text: string;
  choices: EventChoiceDef[];
}

export interface HouseDef {
  id: HouseId;
  name: string;
  motto: string;
  abilityName: string;
  abilityDesc: string;
  abilityCooldown: number;
  /** Ground-targeted ability (Firepot). */
  abilityTargeted: boolean;
  passiveDesc: string;
  effects: Effect[];
  tags: BoonTag[];
  /** Meta unlock required (null = free). */
  unlock: MetaUnlockId | null;
  /** Primary banner color for UI accents. */
  color: string;
}

export interface MetaUnlockDef {
  id: MetaUnlockId;
  name: string;
  cost: number;
  desc: string;
  requires: MetaUnlockId | null;
  /** Player effects granted every battle while owned (e.g. Hawk Eyes flag, Hearth Lore +1 Tiller). */
  effects?: Effect[];
  /** GDD scope: SHOULD unlocks have a fallback if the feature is cut. */
  scope?: 'MUST' | 'SHOULD';
}

export interface DoctrineDef {
  id: DoctrineId;
  name: string;
  fromDepth: number;
  weights: Partial<Record<EnemyUnitId, number>>;
  /** Wave target rule id interpreted by the encounter module. */
  target: 'hearth' | 'nearest_military' | 'storehouse_tillers' | 'nearest_tower';
  hint: string;
  answer: string;
  /** Short icon glyph name for banners. */
  icon: string;
}

export interface BiomeDef {
  id: BiomeId;
  name: string;
  /** Coverage fractions 0..1. */
  water: number;
  forest: number;
  rock: number;
  treeAmount: number;
  twist: string;
  palette: {
    grassA: string;
    grassB: string;
    forest: string;
    forestHi: string;
    water: string;
    shallows: string;
    rock: string;
    extra: string;
  };
}
