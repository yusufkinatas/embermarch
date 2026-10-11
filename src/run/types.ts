/**
 * Run layer + meta-progression types. OWNER: run agent (may add fields).
 * Screens (src/app) consume these.
 */
import type {
  BiomeId,
  BoonId,
  CarriedUnit,
  DoctrineId,
  DraftId,
  EventId,
  HouseId,
  MetaUnlockId,
  ModifierId,
  ObjectiveId,
  ResourceBag,
  VanguardId,
} from '../sim/types';

export type NodeType = 'battle' | 'elite' | 'event' | 'peddler' | 'camp' | 'boss';
export type RewardType = 'boon' | 'draft' | 'spoils';

export interface BattleNodeInfo {
  objective: ObjectiveId;
  biome: BiomeId;
  modifiers: ModifierId[];
  reward: RewardType;
  doctrine: DoctrineId;
  /** 1-5 skulls. */
  threat: number;
  /** Battle depth d (column index 1-6; boss 7). */
  depth: number;
  seed: number;
}

export interface RunNode {
  /** e.g. "c3l1" (column 3, lane 1). Boss: "boss". */
  id: string;
  /** 1..8 */
  col: number;
  /** 0..3 (layout lane; boss/start use 1.5 for centering). */
  lane: number;
  type: NodeType;
  /** Ids of nodes in the next column this node connects to. */
  next: string[];
  battle: BattleNodeInfo | null;
}

export interface RunMap {
  nodes: Record<string, RunNode>;
  /** Node ids per column, index 0 = column 1. */
  columns: string[][];
  startId: string;
  bossId: string;
}

export type PendingEffect =
  | { kind: 'grain_gather_penalty'; pct: number }
  | { kind: 'cold_watchfire' }
  | { kind: 'blood_moon_next' }
  | { kind: 'warden_half_hp' }
  | { kind: 'baggage'; res: ResourceBag }
  | { kind: 'reward_plus_one'; picks: number };

export interface RunStats {
  battlesWon: number;
  elitesWon: number;
  nestsDestroyed: number;
  nodesVisited: number;
  kills: number;
  crownsEarned: number;
  timePlayed: number;
}

/**
 * How a queued Boon/Draft pick rolls its options. Options are rolled lazily when the step reaches
 * the head of the queue, so an earlier pick (synergy, ownership) shapes the next offer.
 */
export interface OfferSpec {
  /** 'reward' = post-battle reward (first-offer Rule guarantee, +1 option effects apply). */
  source: 'reward' | 'event' | 'camp' | 'opening';
  /** Boon rarity table: 'normal' 62/30/8, 'elite' 0/75/25, or every card of one rarity. */
  rarity?: 'normal' | 'elite' | 'C' | 'R' | 'M';
  /** Fixed option count (ignores +1 option effects). */
  size?: number;
  /** Creeping Wake: this battle's reward offers show one more option. */
  bonusOption?: boolean;
  /** Boon included first if eligible (Thorn-Touched Smith: Ember-Tempered Mail). */
  featured?: BoonId;
  /** True once `options` have been rolled. */
  rolled: boolean;
}

export type RewardStep =
  | {
      kind: 'boon';
      title: string;
      options: BoonId[];
      skipCrowns: number;
      /** Short line under the title, e.g. "Rare or better". */
      subtitle?: string;
      spec?: OfferSpec;
    }
  | {
      kind: 'draft';
      title: string;
      options: DraftId[];
      skipCrowns: number;
      subtitle?: string;
      spec?: OfferSpec;
    }
  | {
      kind: 'retinue';
      title: string;
      candidates: CarriedUnit[];
      capPop: number;
      subtitle?: string;
      /** Veteran's Oath: picked units gain +1 Rank (max III) when carried. */
      rankUp?: boolean;
      /** True once capPop / rankUp have been computed (at the head of the queue). */
      rolled?: boolean;
    };

export interface PeddlerItem {
  kind: 'boon' | 'draft' | 'resolve' | 'sellswords' | 'reroll';
  boon?: BoonId;
  draft?: DraftId;
  units?: CarriedUnit[];
  price: number;
  sold: boolean;
  label: string;
  desc: string;
}

export interface PeddlerStock {
  items: PeddlerItem[];
  rerollCost: number;
  /** Rerolls bought at this Peddler (cost 15 + 10 per repeat, before Guild Ties). */
  rerolls?: number;
}

export interface RunState {
  version: 1;
  seed: number;
  map: RunMap;
  /** Last entered node (null before the first). */
  currentNode: string | null;
  nodesDone: string[];
  house: HouseId;
  tier: number;
  boons: BoonId[];
  drafts: DraftId[];
  crowns: number;
  resolve: number;
  maxResolve: number;
  retinue: CarriedUnit[];
  sellswords: CarriedUnit[];
  pending: PendingEffect[];
  eventsSeen: EventId[];
  /** Event rolled for the current event node (stable across reloads). */
  currentEvent: EventId | null;
  firstOfferDone: boolean;
  battleInProgress: boolean;
  /** Snapshot of retinue at node entry (for interrupted-battle resolution). */
  retinueSnapshot: CarriedUnit[];
  /** Pending post-battle / camp / event reward picks, shown in order. */
  rewardQueue: RewardStep[];
  /** Peddler stock for the current peddler node. */
  peddler: PeddlerStock | null;
  /** +1 starting Tiller per Refugees choice. */
  extraTillers: number;
  /** Run-level wave multiplier from Hollow Envoy (1 or 1.15). */
  waveMult: number;
  rngState: number;
  stats: RunStats;
  /** Set when the run has ended. */
  over: null | 'won' | 'lost';
  /** How many runs this profile had started when this run began (first-3-runs hints). */
  profileRunIndex: number;
  /** Set by endRun (makes endRun idempotent: Renown is awarded once). */
  summary?: RunSummary;
  /** Result of the last finishBattle (lets the Results screen survive a reload). */
  lastBattle?: PostBattle;
  /**
   * Last Stands spent so far in the boss battle in progress (recorded by the battle screen).
   * An abandoned boss battle charges them on Continue on top of the −1 Resolve. Reset by
   * startBattle and finishBattle.
   */
  bossLastStandsUsed?: number;
}

/** Camp choice as shown on the Camp screen. */
export interface CampOption {
  id: 'rest' | 'drill' | 'muster';
  label: string;
  /** Description resolved for the current run state (e.g. Drill with an empty Retinue). */
  desc: string;
}

export interface Settings {
  sfxVolume: number;
  muted: boolean;
  edgePan: boolean;
  /** Camera pan speed multiplier. */
  panSpeed: number;
  showHints: boolean;
}

export interface MetaSave {
  version: 1;
  renown: number;
  unlocks: MetaUnlockId[];
  /** Highest Thornbound tier selectable (0 = none unlocked beyond base). */
  tierUnlocked: number;
  stats: { runs: number; wins: number; kills: number; bestDepth: number; totalRenown: number };
  hintsSeen: string[];
  settings: Settings;
}

export interface Briefing {
  nodeId: string;
  nodeType: 'battle' | 'elite' | 'boss';
  objective: ObjectiveId;
  objectiveName: string;
  objectiveDesc: string;
  biome: BiomeId;
  biomeName: string;
  biomeTwist: string;
  modifiers: { id: ModifierId; name: string; desc: string; payoff: string; kind: string }[];
  doctrine: DoctrineId;
  doctrineName: string;
  doctrineHint: string;
  /** Explicit counter answer (first 3 runs of a profile), else null. */
  doctrineAnswer: string | null;
  depth: number;
  threat: number;
  /** Par in seconds (null if none). */
  par: number | null;
  reward: RewardType;
  rewardDesc: string;
  retinue: CarriedUnit[];
  sellswords: CarriedUnit[];
  vanguards: VanguardId[];
  canRetreat: boolean;
  /** Resolve cost text for quitting mid-battle. */
  quitCostText: string;
  /** Tillers that take the field: the common start plus House, Boon, meta and Refugee extras. */
  tillers?: number;
  /** Coursers that take the field (the free scout plus any extras). */
  coursers?: number;
  /** Run-level easing shown like a modifier, e.g. the first-march wave reduction. */
  assists?: string[];
}

export interface CrownLine {
  label: string;
  amount: number;
}

export interface PostBattle {
  outcome: 'victory' | 'defeat' | 'retreat';
  crownsTotal: number;
  crownLines: CrownLine[];
  resolveLost: number;
  /** True if this result ended the run (Resolve 0 or the Regent slain). */
  runOver: boolean;
  runWon: boolean;
  /** Extra lines for the Results screen (e.g. Stragglers after a defeat). */
  notes?: string[];
}

export interface EventView {
  id: EventId;
  title: string;
  text: string;
  choices: { id: string; label: string; desc: string; enabled: boolean; reason?: string }[];
}

export interface EventOutcome {
  text: string;
  /** Boons the choice granted (shown as cards). */
  boons?: BoonId[];
  /** Boons the choice took away. */
  boonsLost?: BoonId[];
  /** Drafts the choice granted. */
  drafts?: DraftId[];
  /** Sellswords the choice added for the next battle. */
  sellswords?: CarriedUnit[];
}

export interface RunSummary {
  won: boolean;
  renownLines: CrownLine[];
  renownTotal: number;
  stats: RunStats;
  depthReached: number;
  /** Next unlock the player can work toward, with remaining Renown needed (0 = affordable now). */
  nextUnlock: { id: MetaUnlockId; name: string; cost: number; remaining: number } | null;
  tierUnlocked: number | null;
}

export type NodeEntry =
  | { screen: 'briefing'; briefing: Briefing }
  | { screen: 'event'; event: EventView }
  | { screen: 'camp' }
  | { screen: 'peddler'; stock: PeddlerStock };
