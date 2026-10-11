/**
 * sim-core private state and small shared helpers. OWNER: sim-core.
 *
 * Everything sim-core needs to remember that is not part of the shared World contract lives
 * here, keyed by the World object (WeakMap), so the contract stays minimal and other modules
 * never depend on it. State is created lazily, so worlds built by hand (tests) work too.
 */
import type {
  Entity,
  GatherTarget,
  MoveIntent,
  Order,
  Owner,
  Unit,
  UnitClass,
  World,
} from './types';
import { TICK_RATE } from './types';
import type { BuildingStats, UnitStats } from './stats';

/** Per-unit bookkeeping owned by sim-core. */
export interface UnitCore {
  /** Spawned silently: does not count toward pop. */
  noPop: boolean;
  /** Fractional gather progress (whole units are moved from the source to the load). */
  gatherAcc: number;
  /** Gather slot held by this unit (released on order change / death). */
  claim: GatherTarget | null;
  /** Order (and queue) saved by Rally the Hearth or flee, restored afterwards. */
  savedOrder: Order | null;
  savedQueue: Order[] | null;
  /** Walking back to the idle spot after a leash break (ignores enemies). */
  returning: boolean;
  /** Seconds the unit has failed to close in on its melee target. */
  noReachTime: number;
  lastTargetDist: number;
  /** Kite: tick when the next step-back is allowed / tick until the current step-back ends. */
  kiteReadyTick: number;
  kitingUntil: number;
  /** Seconds without moving (Charge resets after 1 s still). */
  stillTime: number;
  /** Full-node wait state for the gather loop. */
  waitRetried: boolean;
  /** Next tick on which this unit scans for targets. */
  nextScanTick: number;
  /** Next tick a counter / resisted popup may show for this attacker. */
  popupReadyTick: number;
  /** Heal accumulated since the last heal event. */
  healAcc: number;
  /** Tick of the last retarget by the melee unreachable rule (avoid thrash). */
  lastRetargetTick: number;
  /** Attack-move: point where the current engagement began (leash anchor). */
  engageX: number;
  engageY: number;
  /** Shared flow-field key of the current group move order (undefined = single-unit pathing). */
  flowKey: string | undefined;
  /** Tick the movement intent was last changed (nav status is stale until movement ran after it). */
  moveSetTick: number;
  /** Last point goal handed to nav in the current order (nav clears unit.move when it gives up on it). */
  lastPointGoal: MoveIntent | null;
  /** Last live gather source (position + kind), used to seek a replacement once it is depleted. */
  lastSource: { x: number; y: number; source: 'thicket' | 'tree' | 'ember_seam' | 'grainplot' } | null;
}

export interface CoreState {
  units: Map<number, UnitCore>;
  unitStats: Map<string, UnitStats>;
  buildingStats: Map<string, BuildingStats>;
  /** Gatherers per tree tile (max 2). */
  treeGatherers: Uint8Array;
  /** Builders (construction) and repairers counted this tick, by building id. */
  builders: Map<number, number>;
  repairers: Map<number, number>;
  /** Throttle bookkeeping: key -> next tick allowed. */
  alertReady: Map<string, number>;
  /** Cost paid for each player foundation (cancel refunds). */
  foundationPaid: Map<number, import('./types').Cost>;
  /** Next tick a finished queue head may retry spawning (no free tile), by building id. */
  spawnRetry: Map<number, number>;
  /** Ember Volley active until this tick. */
  emberVolleyUntil: number;
  /** Encounter module initialised (false with skipEncounter). */
  encounterOn: boolean;
  /** Last Stand invulnerability window end tick for the Hearth (0 = none). */
  hearthInvulnUntil: number;
  /** Battle bookkeeping for the result. */
  nestsDestroyed: number;
  picketsDestroyed: number;
  lordSlain: boolean;
  regentSlain: boolean;
  plundererCrowns: number;
  /** True while createWorld runs (suppresses spawn events). */
  creating: boolean;
  /** Tile index set of Picket Thornspire anchors (Plunderers, Raider's Bounty). */
  picketTiles: Set<number>;
  /** Expected damage of projectiles in flight, by target id (ranged overkill avoidance). */
  pendingDamage: Map<number, number>;
  /** Expected damage carried by each homing projectile, by projectile id. */
  projectileDamage: Map<number, number>;
}

const STATE = new WeakMap<World, CoreState>();

export function core(world: World): CoreState {
  let s = STATE.get(world);
  if (!s) {
    const n = world.map ? world.map.w * world.map.h : 0;
    s = {
      units: new Map(),
      unitStats: new Map(),
      buildingStats: new Map(),
      treeGatherers: new Uint8Array(n),
      builders: new Map(),
      repairers: new Map(),
      alertReady: new Map(),
      foundationPaid: new Map(),
      spawnRetry: new Map(),
      emberVolleyUntil: 0,
      encounterOn: false,
      hearthInvulnUntil: 0,
      nestsDestroyed: 0,
      picketsDestroyed: 0,
      lordSlain: false,
      regentSlain: false,
      plundererCrowns: 0,
      creating: false,
      picketTiles: new Set(),
      pendingDamage: new Map(),
      projectileDamage: new Map(),
    };
    if (world.anchors && world.map) {
      for (const p of world.anchors.pickets) s.picketTiles.add(p.ty * world.map.w + p.tx);
    }
    STATE.set(world, s);
  }
  return s;
}

export function newUnitCore(): UnitCore {
  return {
    noPop: false,
    gatherAcc: 0,
    claim: null,
    savedOrder: null,
    savedQueue: null,
    returning: false,
    noReachTime: 0,
    lastTargetDist: Infinity,
    kiteReadyTick: 0,
    kitingUntil: 0,
    stillTime: 0,
    waitRetried: false,
    nextScanTick: 0,
    popupReadyTick: 0,
    healAcc: 0,
    lastRetargetTick: -1000,
    engageX: 0,
    engageY: 0,
    flowKey: undefined,
    moveSetTick: -1,
    lastPointGoal: null,
    lastSource: null,
  };
}

export function ucore(world: World, u: Unit): UnitCore {
  const c = core(world);
  let s = c.units.get(u.id);
  if (!s) {
    s = newUnitCore();
    c.units.set(u.id, s);
  }
  return s;
}

/** Seconds -> ticks (rounded). */
export function ticks(seconds: number): number {
  return Math.round(seconds * TICK_RATE);
}

export const MILITARY_CLASSES: readonly UnitClass[] = ['infantry', 'ranged', 'cavalry', 'siege'];

export function isMilitaryClass(cls: UnitClass): boolean {
  return cls === 'infantry' || cls === 'ranged' || cls === 'cavalry' || cls === 'siege';
}

/** Two owners are hostile when they differ and neither is neutral. */
export function hostile(a: Owner, b: Owner): boolean {
  return a !== b && a !== 2 && b !== 2;
}

/** Damage already on its way to a target (homing projectiles in flight). */
export function pendingDamage(world: World, targetId: number): number {
  return core(world).pendingDamage.get(targetId) ?? 0;
}

/** Will projectiles already in flight kill this entity? */
export function doomed(world: World, e: Entity): boolean {
  return pendingDamage(world, e.id) >= e.hp;
}

/** Center of any entity. */
export function centerOf(e: Entity): { x: number; y: number } {
  if (e.kind === 'unit') return { x: e.x, y: e.y };
  return { x: e.tx + e.w / 2, y: e.ty + e.h / 2 };
}

/** Distance from a point to an axis-aligned rect (0 inside). */
export function pointRectDist(px: number, py: number, rx: number, ry: number, rw: number, rh: number): number {
  const cx = px < rx ? rx : px > rx + rw ? rx + rw : px;
  const cy = py < ry ? ry : py > ry + rh ? ry + rh : py;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Edge-to-edge distance between two axis-aligned rects (0 if overlapping). */
export function rectRectDist(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): number {
  const dx = Math.max(0, bx - (ax + aw), ax - (bx + bw));
  const dy = Math.max(0, by - (ay + ah), ay - (by + bh));
  return Math.sqrt(dx * dx + dy * dy);
}

/** Has the unit got an active buff with this id? */
export function hasBuff(world: World, u: Unit, id: string): boolean {
  for (const b of u.buffs) if (b.id === id && b.until > world.tick) return true;
  return false;
}

/** Sum of a numeric buff field over active buffs. */
export function buffSum(world: World, u: Unit, key: string): number {
  let s = 0;
  for (const b of u.buffs) {
    if (b.until <= world.tick || !b.data) continue;
    const v = b.data[key];
    if (typeof v === 'number') s += v;
  }
  return s;
}

/** Add or refresh a buff (same id refreshes `until` and data). */
export function addBuff(u: Unit, id: string, until: number, data?: Record<string, number>): void {
  for (const b of u.buffs) {
    if (b.id === id) {
      b.until = Math.max(b.until, until);
      if (data) b.data = data;
      return;
    }
  }
  u.buffs.push({ id, until, data });
}
