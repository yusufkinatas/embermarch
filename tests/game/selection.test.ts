import { describe, expect, it } from 'vitest';
import {
  addToGroup,
  assignGroup,
  centroid,
  classifySelection,
  combineSelection,
  groupMembers,
  leadType,
  nextInCycle,
  normalizeSelection,
  prioritizeBox,
  pruneSelection,
  sameTypeInRect,
} from '../../src/game/selection';
import { createBattleUIState } from '../../src/game/types';
import { addBuilding, addThicket, addUnit, kill, makeWorld } from './helpers';

describe('box-select priority', () => {
  it('prefers military and the Warden over Tillers', () => {
    const w = makeWorld();
    const t1 = addUnit(w, 'tiller', 5, 5);
    const t2 = addUnit(w, 'tiller', 6, 5);
    const pike = addUnit(w, 'ashpike', 7, 5);
    const warden = addUnit(w, 'warden', 8, 5);
    const picked = prioritizeBox([t1, t2, pike, warden]).map((u) => u.id);
    expect(picked).toEqual([pike.id, warden.id]);
  });

  it('selects Tillers only when no military is in the box', () => {
    const w = makeWorld();
    const t1 = addUnit(w, 'tiller', 5, 5);
    const t2 = addUnit(w, 'tiller', 6, 5);
    expect(prioritizeBox([t1, t2]).map((u) => u.id)).toEqual([t1.id, t2.id]);
  });

  it('ignores enemy and dead units', () => {
    const w = makeWorld();
    const t1 = addUnit(w, 'tiller', 5, 5);
    const foe = addUnit(w, 'thornling', 6, 5, 1);
    const dead = addUnit(w, 'ashpike', 6, 6);
    kill(w, dead.id);
    expect(prioritizeBox([t1, foe, dead]).map((u) => u.id)).toEqual([t1.id]);
  });
});

describe('selection invariant', () => {
  it('never mixes units and buildings; units win', () => {
    const w = makeWorld();
    const hearth = addBuilding(w, 'hearth', 4, 4);
    const t = addUnit(w, 'tiller', 5, 5);
    expect(normalizeSelection(w, [hearth.id, t.id])).toEqual([t.id]);
  });

  it('keeps buildings of a single type', () => {
    const w = makeWorld();
    const a = addBuilding(w, 'cottage', 10, 10);
    const b = addBuilding(w, 'storehouse', 14, 10);
    const c = addBuilding(w, 'cottage', 18, 10);
    expect(normalizeSelection(w, [a.id, b.id, c.id])).toEqual([a.id, c.id]);
  });

  it('a foreign entity is selected alone', () => {
    const w = makeWorld();
    const foe = addUnit(w, 'thornling', 6, 5, 1);
    const th = addThicket(w, 2, 2);
    expect(normalizeSelection(w, [foe.id, th.id])).toEqual([foe.id]);
    expect(classifySelection(w, [foe.id]).kind).toBe('foreign');
  });

  it('shift+click toggles membership', () => {
    const w = makeWorld();
    const a = addUnit(w, 'ashpike', 5, 5);
    const b = addUnit(w, 'bowman', 6, 5);
    let sel = combineSelection(w, [a.id], [b.id], 'toggle');
    expect(sel).toEqual([a.id, b.id]);
    sel = combineSelection(w, sel, [a.id], 'toggle');
    expect(sel).toEqual([b.id]);
  });

  it('shift+drag adds, or removes when all are already selected', () => {
    const w = makeWorld();
    const a = addUnit(w, 'ashpike', 5, 5);
    const b = addUnit(w, 'bowman', 6, 5);
    const c = addUnit(w, 'courser', 7, 5);
    let sel = combineSelection(w, [a.id], [b.id, c.id], 'add');
    expect(sel).toEqual([a.id, b.id, c.id]);
    sel = combineSelection(w, sel, [b.id, c.id], 'add');
    expect(sel).toEqual([a.id]);
  });

  it('an incompatible pick replaces the selection', () => {
    const w = makeWorld();
    const a = addUnit(w, 'ashpike', 5, 5);
    const cot = addBuilding(w, 'cottage', 10, 10);
    const store = addBuilding(w, 'storehouse', 14, 10);
    expect(combineSelection(w, [a.id], [cot.id], 'toggle')).toEqual([cot.id]);
    expect(combineSelection(w, [cot.id], [store.id], 'toggle')).toEqual([store.id]);
  });
});

describe('double-click same type on screen', () => {
  it('selects own units of the type inside the rect', () => {
    const w = makeWorld();
    const a = addUnit(w, 'ashpike', 5, 5);
    const b = addUnit(w, 'ashpike', 9, 9);
    addUnit(w, 'ashpike', 30, 30); // off screen
    addUnit(w, 'bowman', 6, 6);
    addUnit(w, 'briarguard', 6, 7, 1);
    expect(sameTypeInRect(w, a, { x0: 0, y0: 0, x1: 20, y1: 20 })).toEqual([a.id, b.id]);
  });
});

describe('pruning and groups', () => {
  it('removes dead ids from the selection and groups', () => {
    const w = makeWorld();
    const ui = createBattleUIState();
    const a = addUnit(w, 'ashpike', 5, 5);
    const b = addUnit(w, 'bowman', 6, 5);
    ui.selection = [a.id, b.id];
    assignGroup(w, ui, 1, [a.id, b.id]);
    kill(w, a.id);
    expect(pruneSelection(w, ui)).toBe(true);
    expect(ui.selection).toEqual([b.id]);
    expect(ui.groups[1]).toEqual([b.id]);
    expect(pruneSelection(w, ui)).toBe(false);
  });

  it('assign / add / recall', () => {
    const w = makeWorld();
    const ui = createBattleUIState();
    const a = addUnit(w, 'ashpike', 5, 5);
    const b = addUnit(w, 'bowman', 6, 5);
    const foe = addUnit(w, 'thornling', 7, 5, 1);
    expect(assignGroup(w, ui, 3, [a.id, foe.id])).toBe(true);
    expect(ui.groups[3]).toEqual([a.id]);
    expect(addToGroup(w, ui, 3, [b.id])).toBe(true);
    expect(addToGroup(w, ui, 3, [b.id])).toBe(true);
    expect(groupMembers(w, ui, 3)).toEqual([a.id, b.id]);
    expect(assignGroup(w, ui, 4, [foe.id])).toBe(false);
    expect(assignGroup(w, ui, 0, [a.id])).toBe(false);
  });

  it('computes centroid and lead type', () => {
    const w = makeWorld();
    const a = addUnit(w, 'ashpike', 4, 4);
    const b = addUnit(w, 'ashpike', 8, 8);
    const t = addUnit(w, 'tiller', 6, 6);
    expect(centroid(w, [a.id, b.id])).toEqual({ x: 6, y: 6 });
    expect(leadType(w, [t.id, a.id, b.id])?.type).toBe('ashpike');
    expect(centroid(w, [])).toBeNull();
  });

  it('cycles idle Tillers in id order and wraps', () => {
    const items = [{ id: 7 }, { id: 3 }, { id: 5 }];
    expect(nextInCycle(items, 0)?.id).toBe(3);
    expect(nextInCycle(items, 3)?.id).toBe(5);
    expect(nextInCycle(items, 7)?.id).toBe(3);
    expect(nextInCycle([], 0)).toBeNull();
  });
});
