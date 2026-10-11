/**
 * Derived navigation layers, recomputed lazily whenever grid.version changes:
 * - playerBldg: 1 where a PLAYER building occupies the tile (enemy-mode cost-12 tiles)
 * - connected components for 'player' (walkable) and 'enemy' (walkable + player buildings)
 *   passability. With no corner cutting, 8-dir connectivity equals 4-dir connectivity.
 * Keyed by the NavGrid object, so hand-built test worlds work without setup. OWNER: nav.
 */
import { NAV } from '../../data/balance';
import { PLAYER } from '../types';
import type { NavGrid, World } from '../types';

export type NavMode = 'player' | 'enemy';

export interface NavAux {
  version: number;
  playerBldg: Uint8Array;
  compPlayer: Int32Array;
  compEnemy: Int32Array;
  /** Entry cost multiplier per tile (Infinity = impassable) for each mode. */
  weightPlayer: Float32Array;
  weightEnemy: Float32Array;
  /** A footprint id had no entity yet (registered after setFootprint): rebuild once at this tick. */
  retryTick: number;
}

const auxByGrid = new WeakMap<NavGrid, NavAux>();
let bfsQueue = new Int32Array(0);

export function navAux(world: World): NavAux {
  const grid = world.grid;
  const n = grid.w * grid.h;
  let aux = auxByGrid.get(grid);
  if (!aux || aux.playerBldg.length !== n) {
    aux = {
      version: -1,
      playerBldg: new Uint8Array(n),
      compPlayer: new Int32Array(n),
      compEnemy: new Int32Array(n),
      weightPlayer: new Float32Array(n),
      weightEnemy: new Float32Array(n),
      retryTick: -1,
    };
    auxByGrid.set(grid, aux);
  }
  if (aux.version !== grid.version || (aux.retryTick >= 0 && world.tick >= aux.retryTick)) rebuild(world, aux);
  return aux;
}

function rebuild(world: World, aux: NavAux): void {
  const grid = world.grid;
  const n = grid.w * grid.h;
  let missing = false;
  let lastId = 0;
  let lastPlayer = 0;
  for (let i = 0; i < n; i++) {
    const id = grid.occupant[i];
    if (id === 0) {
      aux.playerBldg[i] = 0;
      continue;
    }
    if (id !== lastId) {
      lastId = id;
      const e = world.entities.get(id);
      if (!e) missing = true;
      lastPlayer = e && e.kind === 'building' && e.owner === PLAYER ? 1 : 0;
    }
    aux.playerBldg[i] = lastPlayer;
  }
  for (let i = 0; i < n; i++) {
    const s = grid.speedMul[i];
    const walk = s > 0 && s < 1 ? 1 / s : 1;
    aux.weightPlayer[i] = grid.blocked[i] === 0 ? walk : Infinity;
    aux.weightEnemy[i] = grid.blocked[i] === 0 ? walk : aux.playerBldg[i] === 1 ? NAV.enemyBuildingCost : Infinity;
  }
  label(grid, aux.compPlayer, (i) => grid.blocked[i] === 0);
  label(grid, aux.compEnemy, (i) => grid.blocked[i] === 0 || aux.playerBldg[i] === 1);
  // A footprint registered before its entity: look again once on a later tick (never every call).
  const wasRetry = aux.retryTick >= 0 && aux.version === grid.version;
  aux.version = grid.version;
  aux.retryTick = missing && !wasRetry ? world.tick + 1 : -1;
}

/** Flood-fill 4-connected components of passable tiles; blocked tiles get -1. */
function label(grid: NavGrid, comp: Int32Array, pass: (i: number) => boolean): void {
  const w = grid.w;
  const n = grid.w * grid.h;
  if (bfsQueue.length < n) bfsQueue = new Int32Array(n);
  const q = bfsQueue;
  comp.fill(-2);
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -2) continue;
    if (!pass(s)) {
      comp[s] = -1;
      continue;
    }
    const id = next++;
    let head = 0;
    let tail = 0;
    q[tail++] = s;
    comp[s] = id;
    while (head < tail) {
      const c = q[head++];
      const cx = c % w;
      const cy = (c - cx) / w;
      for (let k = 0; k < 4; k++) {
        let i: number;
        if (k === 0) {
          if (cx === 0) continue;
          i = c - 1;
        } else if (k === 1) {
          if (cx === w - 1) continue;
          i = c + 1;
        } else if (k === 2) {
          if (cy === 0) continue;
          i = c - w;
        } else {
          if (cy === grid.h - 1) continue;
          i = c + w;
        }
        if (comp[i] !== -2) continue;
        if (!pass(i)) {
          comp[i] = -1;
          continue;
        }
        comp[i] = id;
        q[tail++] = i;
      }
    }
  }
}

/** Is tile i passable for the mode (enemy: player buildings count as passable)? */
export function passableIn(grid: NavGrid, aux: NavAux, mode: NavMode, i: number): boolean {
  return grid.blocked[i] === 0 || (mode === 'enemy' && aux.playerBldg[i] === 1);
}

/** Per-tile traversal weight (time cost multiplier) for the mode. */
export function tileWeight(grid: NavGrid, aux: NavAux, mode: NavMode, i: number, enemyBuildingCost: number): number {
  if (mode === 'enemy' && aux.playerBldg[i] === 1) return enemyBuildingCost;
  const s = grid.speedMul[i];
  return s > 0 && s < 1 ? 1 / s : 1;
}

export function componentsFor(aux: NavAux, mode: NavMode): Int32Array {
  return mode === 'enemy' ? aux.compEnemy : aux.compPlayer;
}

export function weightsFor(aux: NavAux, mode: NavMode): Float32Array {
  return mode === 'enemy' ? aux.weightEnemy : aux.weightPlayer;
}
