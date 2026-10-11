/**
 * Shift+RMB (smart, queue) on an own foundation / damaged building / drop-off with a gathering Tiller.
 * GDD §O: a build or repair queues only behind a current build order or a non-empty queue; a gathering,
 * moving or idle Tiller starts it at once and resumes its gather job afterwards.
 */
import { describe, expect, it } from 'vitest';
import { canPlaceBuilding } from '../../src/sim/queries';
import { issueCommand } from '../../src/sim/world';
import type { PlayerBuildingId, World } from '../../src/sim/types';
import { PLAYER } from '../../src/sim/types';
import { makeWorld, step, stepUntil, units } from './helpers';

function site(w: World, type: PlayerBuildingId, x: number, y: number): { tx: number; ty: number } {
  for (let r = 0; r < 12; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (canPlaceBuilding(w, type, x + dx, y + dy).ok) return { tx: x + dx, ty: y + dy };
  throw new Error('no site');
}

describe('Shift+RMB with a gathering Tiller', () => {
  it('on an unattended foundation: builds at once, then resumes the gather job', () => {
    const w = makeWorld();
    w.debug.revealAll = true;
    const [a, b] = units(w, PLAYER, 'tiller');
    const th = w.resources.find((r) => r.type === 'thicket')!;
    expect(issueCommand(w, { type: 'gather', unitIds: [a.id], target: { kind: 'node', id: th.id } }).ok).toBe(true);
    const s = site(w, 'cottage', 14, 3);
    expect(issueCommand(w, { type: 'build', unitIds: [b.id], building: 'cottage', tx: s.tx, ty: s.ty }).ok).toBe(true);
    const c = w.buildings.filter((x) => x.type === 'cottage').at(-1)!;
    expect(issueCommand(w, { type: 'move', unitIds: [b.id], x: 30, y: 30 }).ok).toBe(true);
    step(w, 3);
    expect(a.order.type).toBe('gather');

    expect(issueCommand(w, { type: 'smart', unitIds: [a.id], x: c.x, y: c.y, targetId: c.id, queue: true }).ok).toBe(true);
    expect(a.order).toMatchObject({ type: 'build', buildingId: c.id });
    expect(a.queue).toHaveLength(0);
    expect(stepUntil(w, () => c.built, 60)).toBeLessThan(60);
    step(w, 1);
    expect(a.order).toMatchObject({ type: 'gather', target: { kind: 'node', id: th.id } });
  });

  it('on a damaged building: repairs at once', () => {
    const w = makeWorld();
    w.debug.revealAll = true;
    const [a] = units(w, PLAYER, 'tiller');
    const th = w.resources.find((r) => r.type === 'thicket')!;
    issueCommand(w, { type: 'gather', unitIds: [a.id], target: { kind: 'node', id: th.id } });
    step(w, 2);
    const hall = w.buildings.find((x) => x.type === 'muster_hall')!;
    hall.hp = hall.maxHp - 100;
    issueCommand(w, { type: 'smart', unitIds: [a.id], x: hall.x, y: hall.y, targetId: hall.id, queue: true });
    expect(a.order).toMatchObject({ type: 'build', buildingId: hall.id });
    expect(stepUntil(w, () => hall.hp >= hall.maxHp, 60)).toBeLessThan(60);
  });

  it('a Tiller already building still queues the next foundation', () => {
    const w = makeWorld();
    w.debug.revealAll = true;
    const [a, b] = units(w, PLAYER, 'tiller');
    const s1 = site(w, 'cottage', 14, 3);
    issueCommand(w, { type: 'build', unitIds: [a.id], building: 'cottage', tx: s1.tx, ty: s1.ty });
    const c1 = w.buildings.filter((x) => x.type === 'cottage').at(-1)!;
    const s2 = site(w, 'cottage', 30, 30);
    issueCommand(w, { type: 'build', unitIds: [b.id], building: 'cottage', tx: s2.tx, ty: s2.ty });
    const c2 = w.buildings.filter((x) => x.type === 'cottage').at(-1)!;
    issueCommand(w, { type: 'smart', unitIds: [a.id], x: c2.x, y: c2.y, targetId: c2.id, queue: true });
    expect(a.order).toMatchObject({ type: 'build', buildingId: c1.id });
    expect(a.queue).toEqual([{ type: 'build', buildingId: c2.id }]);
  });

  it('on a drop-off while gathering and loaded: deposits now', () => {
    const w = makeWorld();
    w.debug.revealAll = true;
    const [a] = units(w, PLAYER, 'tiller');
    const th = w.resources.find((r) => r.type === 'thicket')!;
    issueCommand(w, { type: 'gather', unitIds: [a.id], target: { kind: 'node', id: th.id } });
    step(w, 1);
    a.carry = { type: 'grain', amount: 6 };
    const h = w.buildings.find((x) => x.type === 'hearth')!;
    issueCommand(w, { type: 'smart', unitIds: [a.id], x: h.x, y: h.y, targetId: h.id, queue: true });
    expect(a.order).toMatchObject({ type: 'deposit', buildingId: h.id });
    expect(a.queue).toHaveLength(0);
  });
});
