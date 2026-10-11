/**
 * Run map generation (GDD §B "Run structure and run map generation", §K biome/modifier rolls).
 *
 * 8 columns × 4 lanes. Column 1 is the start battle (Raze, Draft reward, no modifiers),
 * columns 2-7 come from 4 random walkers, column 8 is the boss. Battle depth d = column (1-6),
 * the boss is depth 7.
 */
import { Rng, hashString } from '../core/rng';
import {
  BIOME_WEIGHTS,
  DOCTRINES,
  DOCTRINE_IDS,
  FORCED_DOCTRINE,
  MODIFIER_IDS,
  MODIFIER_ROLLS,
  NEGATIVE_MODIFIERS,
  OBJECTIVE_WEIGHTS,
  OBJECTIVE_WEIGHTS_NO_BEACONS,
  REWARD_TYPE_WEIGHTS,
  RUN_MAP,
  threatRating,
} from '../data';
import type { BiomeId, DoctrineId, ModifierId, ObjectiveId } from '../sim/types';
import type { BattleNodeInfo, NodeType, RewardType, RunMap, RunNode } from './types';

/**
 * Beacons objective (SHOULD scope, encounter module). While false, battle objectives roll
 * Raze 65 / Holdfast 35; when true, Raze 50 / Holdfast 25 / Beacons 25. Enabled by the
 * integrator after an end-to-end check (stones wake at 1:30, light, score Kindling, win at 300).
 */
export const BEACONS_ENABLED: boolean = true;

export const START_ID = 'start';
export const BOSS_ID = 'boss';
/** Boss battle depth (the boss uses its own constants; depth 7 for labelling). */
export const BOSS_DEPTH = 7;
/** First and last walker columns. */
const FIRST_MID = 2;
const LAST_MID = RUN_MAP.columns - 1; // 7
/** Last column that holds battles (d = column). */
const LAST_BATTLE_COL = 6;
const BOSS_COL = RUN_MAP.columns; // 8
const CENTER_LANE = (RUN_MAP.lanes - 1) / 2; // 1.5

/**
 * Route-choice rules on top of §B step 4 (run lane, local so RUN_MAP stays the sim lane's).
 * A decision is a node on a path (start..col 6) with 2+ next nodes. The walker layout must give
 * every map a mean of at least 3.6 decisions per start→boss path, and no path may run through
 * more than 2 single-exit nodes in a row among cols 2-6. About 4 in 5 walker layouts fail this,
 * so layouts get a larger try budget than RUN_MAP.layoutTries.
 */
const LAYOUT_TRIES = 300;
const MIN_MEAN_DECISIONS = 3.6;
const MAX_SINGLE_EXIT_RUN = 2;

export function nodeId(col: number, lane: number): string {
  return `c${col}l${lane}`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

interface Layout {
  /** Lanes used per column (columns FIRST_MID..LAST_MID). */
  lanes: Map<number, Set<number>>;
  /** Edges keyed by source column: "a>b" lane pairs to column + 1. */
  edges: Map<number, Set<string>>;
}

const STEPS = [-1, 0, 1] as const;

function emptyLayout(): Layout {
  const lanes = new Map<number, Set<number>>();
  const edges = new Map<number, Set<string>>();
  for (let c = FIRST_MID; c <= LAST_MID; c++) lanes.set(c, new Set());
  for (let c = FIRST_MID; c < LAST_MID; c++) edges.set(c, new Set());
  return { lanes, edges };
}

/** One walker layout (§B steps 1-3). */
function walkLayout(rng: Rng): Layout {
  const L = RUN_MAP.lanes;
  let pos: number[];
  do {
    pos = Array.from({ length: RUN_MAP.walkers }, () => rng.int(0, L - 1));
  } while (new Set(pos).size < 2);
  const layout = emptyLayout();
  for (const l of pos) layout.lanes.get(FIRST_MID)!.add(l);
  for (let c = FIRST_MID; c < LAST_MID; c++) {
    const colEdges = layout.edges.get(c)!;
    for (let w = 0; w < pos.length; w++) {
      const a = pos[w];
      let b = a;
      for (let t = 0; t < RUN_MAP.diagonalRetries; t++) {
        const cand = Math.max(0, Math.min(L - 1, a + rng.pick(STEPS)));
        // A diagonal a→b crosses an existing b→a edge in the same column pair.
        if (cand === a || !colEdges.has(`${cand}>${a}`)) {
          b = cand;
          break;
        }
      }
      colEdges.add(`${a}>${b}`);
      pos[w] = b;
      layout.lanes.get(c + 1)!.add(b);
    }
  }
  return layout;
}

/** Out-degree per node of a layout (key "col:lane"), columns FIRST_MID..LAST_MID. */
function layoutOutDegree(layout: Layout): Map<string, number> {
  const deg = new Map<string, number>();
  for (let c = FIRST_MID; c < LAST_MID; c++) {
    for (const key of layout.edges.get(c)!) {
      const a = key.split('>')[0];
      deg.set(`${c}:${a}`, (deg.get(`${c}:${a}`) ?? 0) + 1);
    }
  }
  for (const l of layout.lanes.get(LAST_MID)!) deg.set(`${LAST_MID}:${l}`, 1); // → boss
  return deg;
}

/**
 * Route choice of a layout: the mean number of decisions per start→boss path (a decision is a
 * node in cols 1-6 with 2+ next; the start always is one) and the longest run of single-exit
 * nodes among cols 2-6 on any path.
 */
function layoutRouteStats(layout: Layout): { meanDecisions: number; maxSingleRun: number } {
  const deg = layoutOutDegree(layout);
  // Forward DP over the DAG: paths reaching a node, decisions summed over those paths (excluding
  // the node itself), and the longest single-exit run ending at the node.
  const paths = new Map<string, number>();
  const decs = new Map<string, number>();
  const run = new Map<string, number>();
  const startDecision = layout.lanes.get(FIRST_MID)!.size >= 2 ? 1 : 0;
  let maxSingleRun = 0;
  for (const l of layout.lanes.get(FIRST_MID)!) {
    paths.set(`${FIRST_MID}:${l}`, 1);
    decs.set(`${FIRST_MID}:${l}`, startDecision);
  }
  for (let c = FIRST_MID; c <= LAST_MID; c++) {
    for (const l of layout.lanes.get(c)!) {
      const k = `${c}:${l}`;
      const single = (deg.get(k) ?? 0) === 1;
      const r = c <= LAST_BATTLE_COL && single ? (run.get(k) ?? 0) + 1 : 0;
      run.set(k, r);
      maxSingleRun = Math.max(maxSingleRun, r);
      if (c === LAST_MID) continue;
      const p = paths.get(k) ?? 0;
      const d = (decs.get(k) ?? 0) + (single ? 0 : p);
      for (const key of layout.edges.get(c)!) {
        const [a, b] = key.split('>').map(Number);
        if (a !== l) continue;
        const nk = `${c + 1}:${b}`;
        paths.set(nk, (paths.get(nk) ?? 0) + p);
        decs.set(nk, (decs.get(nk) ?? 0) + d);
        // run.get(nk) holds the longest run among predecessors until nk itself is visited.
        if (c + 1 <= LAST_BATTLE_COL) run.set(nk, Math.max(run.get(nk) ?? 0, r));
      }
    }
  }
  let totalPaths = 0;
  let totalDecs = 0;
  for (const l of layout.lanes.get(LAST_MID)!) {
    totalPaths += paths.get(`${LAST_MID}:${l}`) ?? 0;
    totalDecs += decs.get(`${LAST_MID}:${l}`) ?? 0;
  }
  return { meanDecisions: totalPaths > 0 ? totalDecs / totalPaths : 0, maxSingleRun };
}

function layoutAccepted(layout: Layout): boolean {
  let total = 0;
  for (const set of layout.lanes.values()) {
    if (set.size < RUN_MAP.minPerColumn) return false;
    total += set.size;
  }
  if (total < RUN_MAP.midNodesMin || total > RUN_MAP.midNodesMax) return false;
  const route = layoutRouteStats(layout);
  return route.meanDecisions >= MIN_MEAN_DECISIONS && route.maxSingleRun <= MAX_SINGLE_EXIT_RUN;
}

/** §B step 4 fallback: 3 lanes, each with a straight edge, plus one diagonal per column pair. */
function fallbackLayout(): Layout {
  const layout = emptyLayout();
  for (let c = FIRST_MID; c <= LAST_MID; c++) for (let l = 0; l < 3; l++) layout.lanes.get(c)!.add(l);
  for (let c = FIRST_MID; c < LAST_MID; c++) {
    const e = layout.edges.get(c)!;
    for (let l = 0; l < 3; l++) e.add(`${l}>${l}`);
    const from = c % 2; // alternate 0→1 and 1→2: never crosses a straight edge
    e.add(`${from}>${from + 1}`);
  }
  return layout;
}

function buildMap(layout: Layout): RunMap {
  const nodes: Record<string, RunNode> = {};
  const columns: string[][] = [];
  const mk = (id: string, col: number, lane: number, type: NodeType): RunNode => {
    const n: RunNode = { id, col, lane, type, next: [], battle: null };
    nodes[id] = n;
    return n;
  };
  const start = mk(START_ID, 1, CENTER_LANE, 'battle');
  columns.push([START_ID]);
  for (let c = FIRST_MID; c <= LAST_MID; c++) {
    const lanes = [...layout.lanes.get(c)!].sort((a, b) => a - b);
    columns.push(lanes.map((l) => mk(nodeId(c, l), c, l, 'battle').id));
  }
  mk(BOSS_ID, BOSS_COL, CENTER_LANE, 'boss');
  columns.push([BOSS_ID]);

  start.next = [...columns[FIRST_MID - 1]];
  for (let c = FIRST_MID; c < LAST_MID; c++) {
    for (const key of layout.edges.get(c)!) {
      const [a, b] = key.split('>').map(Number);
      const from = nodes[nodeId(c, a)];
      const to = nodeId(c + 1, b);
      if (!from.next.includes(to)) from.next.push(to);
    }
  }
  for (const id of columns[LAST_MID - 1]) nodes[id].next = [BOSS_ID];
  for (const n of Object.values(nodes)) n.next.sort((x, y) => nodes[x].lane - nodes[y].lane);
  return { nodes, columns, startId: START_ID, bossId: BOSS_ID };
}

// ---------------------------------------------------------------------------
// Type assignment (§B step 5)
// ---------------------------------------------------------------------------

const isCombat = (t: NodeType): boolean => t === 'battle' || t === 'elite';

/** Min and max combat-node count over all start→boss paths, counting columns 2-6 only. */
export function pathCombatRange(map: RunMap): { min: number; max: number } {
  const lo = new Map<string, number>();
  const hi = new Map<string, number>();
  for (const id of map.columns[FIRST_MID - 1]) {
    const v = isCombat(map.nodes[id].type) ? 1 : 0;
    lo.set(id, v);
    hi.set(id, v);
  }
  for (let c = FIRST_MID; c < LAST_BATTLE_COL; c++) {
    for (const id of map.columns[c - 1]) {
      for (const nx of map.nodes[id].next) {
        const add = isCombat(map.nodes[nx].type) ? 1 : 0;
        lo.set(nx, Math.min(lo.get(nx) ?? Infinity, lo.get(id)! + add));
        hi.set(nx, Math.max(hi.get(nx) ?? -Infinity, hi.get(id)! + add));
      }
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const id of map.columns[LAST_BATTLE_COL - 1]) {
    min = Math.min(min, lo.get(id) ?? Infinity);
    max = Math.max(max, hi.get(id) ?? -Infinity);
  }
  return { min, max };
}

/** True if some start→boss path visits no Elite. */
export function hasEliteFreePath(map: RunMap): boolean {
  let frontier = map.columns[FIRST_MID - 1].filter((id) => map.nodes[id].type !== 'elite');
  for (let c = FIRST_MID; c < LAST_MID; c++) {
    const next = new Set<string>();
    for (const id of frontier) for (const nx of map.nodes[id].next) if (map.nodes[nx].type !== 'elite') next.add(nx);
    frontier = [...next];
    if (frontier.length === 0) return false;
  }
  return frontier.length > 0;
}

/**
 * Every §B rule the generator must satisfy. Returns human-readable violations (empty = valid).
 * Checks structure (counts, crossing edges, links) and node types.
 */
export function runMapViolations(map: RunMap): string[] {
  const v: string[] = [];
  const cols = map.columns;
  if (cols.length !== RUN_MAP.columns) v.push(`expected ${RUN_MAP.columns} columns, got ${cols.length}`);
  if (cols[0]?.length !== 1 || cols[0][0] !== map.startId) v.push('column 1 must hold only the start node');
  if (cols[BOSS_COL - 1]?.length !== 1 || cols[BOSS_COL - 1][0] !== map.bossId) v.push('column 8 must hold only the boss');
  let mid = 0;
  for (let c = FIRST_MID; c <= LAST_MID; c++) {
    const n = cols[c - 1]?.length ?? 0;
    mid += n;
    if (n < RUN_MAP.minPerColumn) v.push(`column ${c} has ${n} nodes`);
    if (n > RUN_MAP.lanes) v.push(`column ${c} has ${n} nodes (> lanes)`);
  }
  if (mid < RUN_MAP.midNodesMin || mid > RUN_MAP.midNodesMax) v.push(`columns 2-7 hold ${mid} nodes`);
  const total = Object.keys(map.nodes).length;
  if (total < RUN_MAP.totalNodesMin || total > RUN_MAP.totalNodesMax) v.push(`map has ${total} nodes`);

  const start = map.nodes[map.startId];
  const boss = map.nodes[map.bossId];
  if (start.type !== 'battle' || start.battle?.objective !== 'raze' || start.battle.reward !== 'draft' || start.battle.modifiers.length) {
    v.push('start must be a Raze battle with a Draft reward and no modifiers');
  }
  if (boss.type !== 'boss' || boss.battle?.objective !== 'boss' || boss.battle.modifiers.length) v.push('boss node malformed');
  if ([...start.next].sort().join() !== [...cols[1]].sort().join()) v.push('start must link to every column-2 node');

  // Edges only go to the next column; every node has an outgoing edge (except the boss) and an incoming one.
  const incoming = new Map<string, number>();
  for (const n of Object.values(map.nodes)) {
    if (n.id !== map.bossId && n.next.length === 0) v.push(`${n.id} has no outgoing edge`);
    for (const nx of n.next) {
      const t = map.nodes[nx];
      if (!t || t.col !== n.col + 1) v.push(`edge ${n.id}→${nx} skips columns`);
      incoming.set(nx, (incoming.get(nx) ?? 0) + 1);
      if (n.type === 'elite' && t?.type === 'elite') v.push(`Elite→Elite edge ${n.id}→${nx}`);
      if (n.type === 'peddler' && t?.type === 'peddler') v.push(`Peddler→Peddler edge ${n.id}→${nx}`);
    }
  }
  for (const n of Object.values(map.nodes)) if (n.id !== map.startId && !incoming.get(n.id)) v.push(`${n.id} unreachable`);
  for (const id of cols[LAST_MID - 1] ?? []) if (map.nodes[id].next.join() !== map.bossId) v.push(`${id} must link to the boss`);

  // No crossing edges between adjacent mid columns.
  for (let c = FIRST_MID; c < LAST_MID; c++) {
    const pairs: [number, number][] = [];
    for (const id of cols[c - 1]) for (const nx of map.nodes[id].next) pairs.push([map.nodes[id].lane, map.nodes[nx].lane]);
    for (const [a1, b1] of pairs)
      for (const [a2, b2] of pairs) if (a1 < a2 && b1 > b2) v.push(`crossing edges in columns ${c}-${c + 1}`);
  }

  // Types per column.
  const allowed: Record<number, NodeType[]> = {
    2: ['battle', 'event'],
    3: ['battle', 'elite', 'event', 'peddler'],
    4: ['battle', 'elite', 'event', 'peddler', 'camp'],
    5: ['battle', 'elite', 'event', 'peddler', 'camp'],
    6: ['battle', 'elite', 'event', 'peddler', 'camp'],
    7: ['camp', 'peddler'],
  };
  let elites = 0;
  for (let c = FIRST_MID; c <= LAST_MID; c++) {
    for (const id of cols[c - 1]) {
      const n = map.nodes[id];
      if (!allowed[c].includes(n.type)) v.push(`${id}: type ${n.type} not allowed in column ${c}`);
      if (n.type === 'elite') elites++;
      const wantsBattle = isCombat(n.type);
      if (wantsBattle !== (n.battle !== null)) v.push(`${id}: battle info mismatch`);
    }
  }
  if (!cols[1].some((id) => map.nodes[id].type === 'battle')) v.push('column 2 needs a Battle');
  if (elites < RUN_MAP.elitesMin || elites > RUN_MAP.elitesMax) v.push(`${elites} Elites`);
  const c7 = cols[LAST_MID - 1].map((id) => map.nodes[id].type);
  if (!c7.includes('camp') || !c7.includes('peddler')) v.push('column 7 needs a Camp and a Peddler');
  const range = pathCombatRange(map);
  if (range.min < RUN_MAP.pathCombatMin || range.max > RUN_MAP.pathCombatMax) {
    v.push(`path combat count ${range.min}-${range.max}`);
  }
  if (!hasEliteFreePath(map)) v.push('no Elite-free path');
  return v;
}

/**
 * True if no node is forced into an Elite: every node in cols 1-5 whose next includes an Elite
 * also has a non-Elite next. With the col-6 → col-7 edges never reaching an Elite, this means an
 * Elite can be sidestepped from every non-Elite node, one step at a time.
 */
export function elitesAvoidable(map: RunMap): boolean {
  for (let c = 1; c < LAST_BATTLE_COL; c++) {
    for (const id of map.columns[c - 1]) {
      const next = map.nodes[id].next.map((nx) => map.nodes[nx].type);
      if (next.includes('elite') && next.every((t) => t === 'elite')) return false;
    }
  }
  return true;
}

/** Type-only subset of the rules (used while rolling types; battle info is not rolled yet). */
function typesValid(map: RunMap): boolean {
  const cols = map.columns;
  if (!cols[1].some((id) => map.nodes[id].type === 'battle')) return false;
  let elites = 0;
  for (let c = FIRST_MID; c <= LAST_MID; c++) {
    for (const id of cols[c - 1]) {
      const n = map.nodes[id];
      if (n.type === 'elite') elites++;
      for (const nx of n.next) {
        const t = map.nodes[nx].type;
        if (n.type === 'elite' && t === 'elite') return false;
        if (n.type === 'peddler' && t === 'peddler') return false;
      }
    }
  }
  if (elites < RUN_MAP.elitesMin || elites > RUN_MAP.elitesMax) return false;
  const c7 = cols[LAST_MID - 1].map((id) => map.nodes[id].type);
  if (!c7.includes('camp') || !c7.includes('peddler')) return false;
  const range = pathCombatRange(map);
  if (range.min < RUN_MAP.pathCombatMin || range.max > RUN_MAP.pathCombatMax) return false;
  return hasEliteFreePath(map) && elitesAvoidable(map);
}

/** §B step 5 fallback: cols 2/4/6 Battles (one col-4 Elite), cols 3/5 alternate Event, Peddler, Camp. */
function fallbackTypes(map: RunMap): void {
  const set = (c: number, f: (i: number) => NodeType) => map.columns[c - 1].forEach((id, i) => (map.nodes[id].type = f(i)));
  set(2, () => 'battle');
  // Camp only appears from column 4 on, so column 3 alternates Event and Peddler.
  set(3, (i) => (['event', 'peddler'] as const)[i % 2]);
  // The col-4 Elite goes where every col-3 node leading to it has another exit, when possible.
  const col4 = map.columns[3];
  const sidestep = col4.findIndex((id) => map.columns[2].every((p) => !map.nodes[p].next.includes(id) || map.nodes[p].next.length > 1));
  const eliteAt = Math.max(0, sidestep);
  set(4, (i) => (i === eliteAt ? 'elite' : 'battle'));
  set(5, (i) => (['event', 'peddler', 'camp'] as const)[i % 3]);
  set(6, () => 'battle');
  set(7, (i) => (['camp', 'peddler'] as const)[i % 2]);
}

/** Up to RUN_MAP.typeAttempts weighted rolls; true once one satisfies typesValid. */
function rollTypes(map: RunMap, rng: Rng): boolean {
  for (let attempt = 0; attempt < RUN_MAP.typeAttempts; attempt++) {
    for (let c = FIRST_MID; c <= LAST_MID; c++) {
      const w = RUN_MAP.weights[c] as Partial<Record<NodeType, number>>;
      const kinds = Object.keys(w) as NodeType[];
      for (const id of map.columns[c - 1]) map.nodes[id].type = rng.weighted(kinds, (k) => w[k] ?? 0);
    }
    if (typesValid(map)) return true;
  }
  return false;
}

function assignTypes(map: RunMap, rng: Rng): boolean {
  if (rollTypes(map, rng)) return true;
  fallbackTypes(map);
  return false;
}

// ---------------------------------------------------------------------------
// Battle node rolls (§B step 6, §K)
// ---------------------------------------------------------------------------

function weightedKey<K extends string>(rng: Rng, weights: Partial<Record<K, number>>): K {
  const keys = Object.keys(weights) as K[];
  return rng.weighted(keys, (k) => weights[k] ?? 0);
}

/** Doctrines available at depth d (fromDepth ≤ d). */
export function doctrinesAt(depth: number): DoctrineId[] {
  return DOCTRINE_IDS.filter((id) => DOCTRINES[id].fromDepth <= depth);
}

/** Primary doctrine: Swift Hunt (FORCED_DOCTRINE) wins, else uniform among those available. */
export function rollDoctrine(rng: Rng, depth: number, modifiers: readonly ModifierId[]): DoctrineId {
  for (const m of modifiers) {
    const forced = FORCED_DOCTRINE[m];
    if (forced) return forced;
  }
  return rng.pick(doctrinesAt(depth));
}

export function rollObjective(rng: Rng, beacons = BEACONS_ENABLED): ObjectiveId {
  return weightedKey(rng, beacons ? OBJECTIVE_WEIGHTS : OBJECTIVE_WEIGHTS_NO_BEACONS);
}

export function rollBiome(rng: Rng, col: number): BiomeId {
  const w = BIOME_WEIGHTS[col] ?? BIOME_WEIGHTS[Math.min(LAST_BATTLE_COL, Math.max(1, col))];
  return weightedKey(rng, w);
}

/** Modifiers for a battle in column `col` (§K). No duplicates; Elites add one negative. */
export function rollModifiers(rng: Rng, col: number, elite: boolean): ModifierId[] {
  const mods: ModifierId[] = [];
  const roll = MODIFIER_ROLLS[col] ?? { first: 0, second: 0 };
  const add = (pool: readonly ModifierId[]) => {
    const left = pool.filter((m) => !mods.includes(m));
    if (left.length) mods.push(rng.pick(left));
  };
  if (roll.first > 0 && rng.chance(roll.first)) {
    add(MODIFIER_IDS);
    if (roll.second > 0 && rng.chance(roll.second)) add(MODIFIER_IDS);
  }
  if (elite) add(NEGATIVE_MODIFIERS);
  return mods;
}

/** Per-node battle seed: stable for a run seed and node id (survives rerolls of other state). */
export function nodeSeed(runSeed: number, id: string): number {
  return hashString(`${runSeed >>> 0}:${id}`);
}

function rollBattleInfo(rng: Rng, runSeed: number, node: RunNode, beacons: boolean): BattleNodeInfo {
  const boss = node.type === 'boss';
  const elite = node.type === 'elite';
  const start = node.col === 1;
  const depth = boss ? BOSS_DEPTH : node.col;
  const objective: ObjectiveId = boss ? 'boss' : elite ? 'elite' : start ? 'raze' : rollObjective(rng, beacons);
  const biome: BiomeId = boss ? 'heartwood' : rollBiome(rng, node.col);
  const modifiers = boss || start ? [] : rollModifiers(rng, node.col, elite);
  // Elite and boss rewards are fixed (§M); the field is informational there.
  const reward: RewardType = start ? 'draft' : boss || elite ? 'boon' : weightedKey(rng, REWARD_TYPE_WEIGHTS);
  const doctrine = rollDoctrine(rng, depth, modifiers);
  return {
    objective,
    biome,
    modifiers,
    reward,
    doctrine,
    threat: threatRating(depth, elite, boss),
    depth,
    seed: nodeSeed(runSeed, node.id),
  };
}

export interface GeneratedRunMap {
  map: RunMap;
  /** No walker layout passed the §B and route-choice checks in LAYOUT_TRIES; the 3-lane template was used. */
  layoutFallback: boolean;
  /** No accepted layout could be typed in RUN_MAP.typeAttempts rolls; the fixed pattern was used. */
  typeFallback: boolean;
}

/** Generate the full run map for a seed (deterministic). */
export function generateRunMap(
  seed: number,
  opts: { beacons?: boolean; /** Tests: force the §B fallbacks. */ forceFallback?: { layout?: boolean; types?: boolean } } = {},
): GeneratedRunMap {
  const rng = new Rng(seed >>> 0).fork('runmap');
  // A walker layout counts only once the type roll also succeeds on it: richer layouts have more
  // paths, so some cannot meet the path combat and Elite rules. Those are rerolled like a
  // rejected layout instead of falling back to the fixed type pattern.
  let map: RunMap | null = null;
  let untyped: RunMap | null = null;
  let typeFallback = false;
  for (let t = 0; t < LAYOUT_TRIES && !map && !opts.forceFallback?.layout; t++) {
    const l = walkLayout(rng);
    if (!layoutAccepted(l)) continue;
    const m = buildMap(l);
    if (opts.forceFallback?.types) {
      fallbackTypes(m);
      typeFallback = true;
      map = m;
    } else if (rollTypes(m, rng)) {
      map = m;
    } else {
      untyped = m;
    }
  }
  const layoutFallback = map === null && untyped === null;
  if (!map && untyped) {
    map = untyped;
    fallbackTypes(map);
    typeFallback = true;
  } else if (!map) {
    map = buildMap(fallbackLayout());
    if (opts.forceFallback?.types) {
      fallbackTypes(map);
      typeFallback = true;
    } else {
      typeFallback = !assignTypes(map, rng);
    }
  }
  const beacons = opts.beacons ?? BEACONS_ENABLED;
  for (const col of map.columns) {
    for (const id of col) {
      const n = map.nodes[id];
      n.battle = n.type === 'battle' || n.type === 'elite' || n.type === 'boss' ? rollBattleInfo(rng, seed, n, beacons) : null;
    }
  }
  return { map, layoutFallback, typeFallback };
}
