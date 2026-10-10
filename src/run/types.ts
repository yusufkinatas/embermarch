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

export type RewardStep =
  | { kind: 'boon'; title: string; options: BoonId[]; skipCrowns: number }
  | { kind: 'draft'; title: string; options: DraftId[]; skipCrowns: number }
  | { kind: 'retinue'; title: string; candidates: CarriedUnit[]; capPop: number };

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
}

export interface EventView {
  id: EventId;
  title: string;
  text: string;
  choices: { id: string; label: string; desc: string; enabled: boolean; reason?: string }[];
}

export interface EventOutcome {
  text: string;
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
