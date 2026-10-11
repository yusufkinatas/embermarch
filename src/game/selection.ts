/**
 * Selection and control-group rules (GDD §O). Pure logic over World + BattleUIState, no DOM.
 *
 * Invariant: a selection holds own units, OR own buildings of a single type, OR exactly one
 * foreign entity (enemy / neutral / resource) shown for inspection only.
 */
import type { Building, Entity, Unit, World } from '../sim/types';
import { PLAYER } from '../sim/types';
import type { BattleUIState } from './types';

export type SelectionKind = 'none' | 'units' | 'buildings' | 'foreign';

export interface SelectionInfo {
  kind: SelectionKind;
  units: Unit[];
  buildings: Building[];
  /** The inspected foreign entity (kind 'foreign'). */
  foreign: Entity | null;
}

export function liveEntity(world: World, id: number): Entity | undefined {
  const e = id ? world.entities.get(id) : undefined;
  return e && e.alive ? e : undefined;
}

export function isOwnUnit(e: Entity | undefined | null): e is Unit {
  return !!e && e.kind === 'unit' && e.owner === PLAYER && e.alive;
}

export function isOwnBuilding(e: Entity | undefined | null): e is Building {
  return !!e && e.kind === 'building' && e.owner === PLAYER && e.alive;
}

/** Military in the §O sense: everything except Tillers (the Warden counts). */
export function isArmyUnit(u: Unit): boolean {
  return u.cls !== 'worker';
}

export function classifySelection(world: World, ids: readonly number[]): SelectionInfo {
  const info: SelectionInfo = { kind: 'none', units: [], buildings: [], foreign: null };
  for (const id of ids) {
    const e = liveEntity(world, id);
    if (!e) continue;
    if (isOwnUnit(e)) info.units.push(e);
    else if (isOwnBuilding(e)) info.buildings.push(e);
    else if (!info.foreign) info.foreign = e;
  }
  if (info.units.length) info.kind = 'units';
  else if (info.buildings.length) info.kind = 'buildings';
  else if (info.foreign) info.kind = 'foreign';
  return info;
}

/**
 * Box-select priority: military and the Warden first; Tillers only when no military is in the box.
 * Only own living units are kept.
 */
export function prioritizeBox(units: readonly Unit[]): Unit[] {
  const own = units.filter((u) => u.alive && u.owner === PLAYER);
  const army = own.filter(isArmyUnit);
  return army.length > 0 ? army : own;
}

/**
 * Sanitize a raw id list into a valid selection: own units win; else own buildings of the first
 * building's type; else a single foreign entity.
 */
export function normalizeSelection(world: World, ids: readonly number[]): number[] {
  const info = classifySelection(world, ids);
  const seen = new Set<number>();
  const out: number[] = [];
  const push = (id: number): void => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  if (info.kind === 'units') info.units.forEach((u) => push(u.id));
  else if (info.kind === 'buildings') {
    const type = info.buildings[0].type;
    info.buildings.filter((b) => b.type === type).forEach((b) => push(b.id));
  } else if (info.kind === 'foreign' && info.foreign) push(info.foreign.id);
  return out;
}

export type CombineMode = 'replace' | 'add' | 'toggle';

/**
 * Merge a pick into the current selection.
 * - replace: the pick becomes the selection.
 * - add (Shift+drag): add the pick; if every picked id is already selected, remove them instead.
 * - toggle (Shift+click): flip membership of the picked ids.
 * When the pick is incompatible with the current selection (units vs buildings vs other type),
 * the pick replaces it.
 */
export function combineSelection(world: World, current: readonly number[], picked: readonly number[], mode: CombineMode): number[] {
  const pick = normalizeSelection(world, picked);
  if (mode === 'replace' || pick.length === 0) return mode === 'replace' ? pick : normalizeSelection(world, current);
  const cur = normalizeSelection(world, current);
  if (cur.length === 0) return pick;
  if (!compatible(world, cur, pick)) return pick;
  const curSet = new Set(cur);
  if (mode === 'add') {
    const allIn = pick.every((id) => curSet.has(id));
    if (allIn) return cur.filter((id) => !pick.includes(id));
    return [...cur, ...pick.filter((id) => !curSet.has(id))];
  }
  // toggle
  const out = cur.slice();
  for (const id of pick) {
    const i = out.indexOf(id);
    if (i >= 0) out.splice(i, 1);
    else out.push(id);
  }
  return out;
}

function compatible(world: World, a: readonly number[], b: readonly number[]): boolean {
  const ia = classifySelection(world, a);
  const ib = classifySelection(world, b);
  if (ia.kind !== ib.kind) return false;
  if (ia.kind === 'units') return true;
  if (ia.kind === 'buildings') return ia.buildings[0].type === ib.buildings[0].type;
  return false; // foreign selections are single-entity
}

/** Own units (or own buildings) of the same type as `ref` whose centers lie in the given world rect. */
export function sameTypeInRect(world: World, ref: Entity, rect: { x0: number; y0: number; x1: number; y1: number }): number[] {
  const inRect = (x: number, y: number): boolean => x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
  if (isOwnUnit(ref)) {
    return world.units.filter((u) => isOwnUnit(u) && u.type === ref.type && inRect(u.x, u.y)).map((u) => u.id);
  }
  if (isOwnBuilding(ref)) {
    return world.buildings
      .filter((b) => isOwnBuilding(b) && b.type === ref.type && inRect(b.tx + b.w / 2, b.ty + b.h / 2))
      .map((b) => b.id);
  }
  return [ref.id];
}

/** Remove dead (or otherwise invalid) ids from the selection and every group. Returns true if anything changed. */
export function pruneSelection(world: World, ui: BattleUIState, keep?: (e: Entity) => boolean): boolean {
  let changed = false;
  const ok = (id: number): boolean => {
    const e = liveEntity(world, id);
    return !!e && (!keep || keep(e));
  };
  if (ui.selection.length) {
    const next = ui.selection.filter(ok);
    if (next.length !== ui.selection.length) {
      ui.selection = next;
      changed = true;
    }
  }
  for (let g = 1; g < ui.groups.length; g++) {
    const grp = ui.groups[g];
    if (!grp.length) continue;
    const next = grp.filter((id) => {
      const e = liveEntity(world, id);
      return !!e && (isOwnUnit(e) || isOwnBuilding(e));
    });
    if (next.length !== grp.length) {
      ui.groups[g] = next;
      changed = true;
    }
  }
  return changed;
}

/** Ids that may be stored in a control group: own units, or own buildings of one type. */
export function groupableIds(world: World, ids: readonly number[]): number[] {
  const info = classifySelection(world, ids);
  if (info.kind === 'units') return info.units.map((u) => u.id);
  if (info.kind === 'buildings') return info.buildings.map((b) => b.id);
  return [];
}

export function assignGroup(world: World, ui: BattleUIState, n: number, ids: readonly number[]): boolean {
  if (n < 1 || n > 9) return false;
  const g = groupableIds(world, ids);
  if (!g.length) return false;
  ui.groups[n] = g;
  return true;
}

/** Shift+digit: add the selection to the group (respecting the units-or-buildings invariant). */
export function addToGroup(world: World, ui: BattleUIState, n: number, ids: readonly number[]): boolean {
  if (n < 1 || n > 9) return false;
  const add = groupableIds(world, ids);
  if (!add.length) return false;
  const base = groupMembers(world, ui, n);
  // Adding is idempotent for groups; an incompatible kind (units vs buildings) replaces the group.
  ui.groups[n] = base.length && compatible(world, base, add) ? [...base, ...add.filter((id) => !base.includes(id))] : add;
  return true;
}

export function groupMembers(world: World, ui: BattleUIState, n: number): number[] {
  return (ui.groups[n] ?? []).filter((id) => {
    const e = liveEntity(world, id);
    return !!e && (isOwnUnit(e) || isOwnBuilding(e));
  });
}

/** Mean position of the live entities (tiles), or null. */
export function centroid(world: World, ids: readonly number[]): { x: number; y: number } | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const id of ids) {
    const e = liveEntity(world, id);
    if (!e) continue;
    sx += e.x;
    sy += e.y;
    n++;
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

/** Next idle Tiller after `lastId` in a stable order (wraps). */
export function nextInCycle<T extends { id: number }>(items: readonly T[], lastId: number): T | null {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => a.id - b.id);
  return sorted.find((u) => u.id > lastId) ?? sorted[0];
}

/** Most common unit type among ids (ties: higher pop / earlier id). Used for the group lead icon. */
export function leadType(world: World, ids: readonly number[]): { type: string; owner: number } | null {
  const counts = new Map<string, number>();
  let owner = PLAYER as number;
  for (const id of ids) {
    const e = liveEntity(world, id);
    if (!e || e.kind === 'resource') continue;
    owner = e.owner;
    counts.set(e.type, (counts.get(e.type) ?? 0) + (e.kind === 'unit' && e.cls === 'worker' ? 0.5 : 1));
  }
  let best: string | null = null;
  let bestN = -1;
  for (const [t, n] of counts) {
    if (n > bestN) {
      best = t;
      bestN = n;
    }
  }
  return best ? { type: best, owner } : null;
}
