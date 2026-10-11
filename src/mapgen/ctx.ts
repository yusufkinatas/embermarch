/**
 * Mutable state shared by the generation steps of one attempt.
 * The final GameMap / MapAnchors are assembled from it in `finalize.ts`.
 */
import type { Rng } from '../core/rng';
import type { ObjectiveAnchorRule } from '../data/balance';
import { Terrain } from '../sim/types';
import type { MapGenParams, PicketSpawn, ResourceSpawn, TilePos } from '../sim/types';
import type { Pt } from './geom';

/** Every footprint kind mapgen places or reserves. */
export type FootKind =
  | 'hearth'
  | 'nest'
  | 'spire'
  | 'spare_spire'
  | 'picket'
  | 'seam'
  | 'thicket'
  | 'cache'
  | 'beacon'
  | 'military'
  | 'storehouse'
  | 'grainplot'
  | 'watchtower'
  | 'throne';

export interface Foot {
  kind: FootKind;
  tx: number;
  ty: number;
  w: number;
  h: number;
}

/** Reserve bits (per tile). */
export const RES_CENTERLINE = 1; // corridor / lane centerline: never covered by a footprint
export const RES_MUSTER = 2; // keep-clear disc around a muster point
export const RES_CORRIDOR = 4; // any carved corridor tile (3-wide band): never re-forested
export const RES_PROTECT = 8; // anchor clearings: never re-forested

/** Which resources/kit pieces ended up where (indices into anchors.resources). Used by tests and debug. */
export interface KitReport {
  nearThickets: number[];
  outerThickets: number[];
  midClusters: number[][];
  bountiful: number[];
  /** Index of the home Ember Seam, -1 under Ember Famine. */
  homeSeam: number;
  contested: number[];
  /** Forest tiles in the 6-14 ring around the Hearth (after generation). */
  forestRing: number;
  /** Forest discs stamped to satisfy the ring rule. */
  stamps: number;
  /** Connectivity corridors carved in step 7. */
  connectCarves: number;
}

export function isWalkableTerrain(t: number): boolean {
  return t === Terrain.Grass || t === Terrain.Shallows || t === Terrain.Stump;
}

export class GenCtx {
  readonly params: MapGenParams;
  readonly rule: ObjectiveAnchorRule;
  readonly rng: Rng;
  readonly w: number;
  readonly h: number;
  readonly n: number;
  readonly terrain: Uint8Array;
  /** Footprint occupancy: index + 1 into `feet`, 0 = free. */
  readonly occ: Int32Array;
  readonly reserve: Uint8Array;
  readonly feet: Foot[] = [];

  /** Hearth center (tile-corner coordinates, the Hearth is 4×4). */
  hc: Pt = { x: 0, y: 0 };
  hearth: Foot | null = null;
  nests: Foot[] = [];
  beacons: Foot[] = [];
  throne: Foot | null = null;
  /** Centerline tile indices from the Hearth to Nest i. */
  corridors: number[][] = [];
  musterPoints: Pt[] = [];
  spires: (TilePos & { nestIndex: number })[] = [];
  spareSpires: (TilePos & { nestIndex: number })[] = [];
  resources: ResourceSpawn[] = [];
  pickets: PicketSpawn[] = [];
  caches: (TilePos & { type: 'ruined_cache' | 'ancient_cache' })[] = [];
  watchtowers: TilePos[] = [];
  vanguard: { military: TilePos; storehouse: TilePos; grainplot: TilePos } | null = null;
  /** Anchor clearing discs (center, radius) protected from forest stamping. */
  protectedDiscs: { x: number; y: number; r: number }[] = [];
  /** Why this attempt was abandoned (debug / tests). */
  failReason = '';

  /** Record why the attempt failed and return null (for `return ctx.fail('...')`). */
  fail(reason: string): null {
    this.failReason = reason;
    return null;
  }

  constructor(params: MapGenParams, rule: ObjectiveAnchorRule, size: number, rng: Rng) {
    this.params = params;
    this.rule = rule;
    this.rng = rng;
    this.w = size;
    this.h = size;
    this.n = size * size;
    this.terrain = new Uint8Array(this.n);
    this.occ = new Int32Array(this.n);
    this.reserve = new Uint8Array(this.n);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Terrain walkable and no footprint. */
  walkable(i: number): boolean {
    return this.occ[i] === 0 && isWalkableTerrain(this.terrain[i]);
  }

  footAt(i: number): Foot | null {
    const o = this.occ[i];
    return o > 0 ? this.feet[o - 1] : null;
  }

  /** Index of the Nest closest (straight line) to the Hearth center. */
  nearestNestIndex(): number {
    let best = -1;
    let bd = Infinity;
    this.nests.forEach((n, i) => {
      const d = Math.hypot(n.tx + n.w / 2 - this.hc.x, n.ty + n.h / 2 - this.hc.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** Angle from the Hearth center toward the nearest Nest. */
  nearestNestAngle(): number {
    const i = this.nearestNestIndex();
    if (i < 0) return 0;
    const n = this.nests[i];
    return Math.atan2(n.ty + n.h / 2 - this.hc.y, n.tx + n.w / 2 - this.hc.x);
  }
}
