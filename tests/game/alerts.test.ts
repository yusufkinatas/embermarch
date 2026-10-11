import { describe, expect, it } from 'vitest';
import {
  ALERT_FADE,
  ALERT_MAX,
  ALERT_TTL,
  AlertFeed,
  LOSS_AGGREGATE,
  LOSS_THROTTLE,
  LossNotices,
  ThreatMarkers,
  UNATTENDED_AFTER,
  UNATTENDED_REPEAT,
  UnattendedFoundations,
  edgePlacement,
  lossText,
} from '../../src/game/alerts';
import { addBuilding, addUnit, makeWorld } from './helpers';

describe('AlertFeed', () => {
  it('keeps at most 5 toasts, newest last', () => {
    const f = new AlertFeed();
    for (let i = 0; i < 8; i++) f.push({ kind: 'info', text: `msg ${i}` }, i * 0.1);
    expect(f.items.length).toBe(ALERT_MAX);
    expect(f.items[f.items.length - 1].text).toBe('msg 7');
    expect(f.items[0].text).toBe('msg 3');
  });

  it('merges repeats within the window', () => {
    const f = new AlertFeed();
    f.push({ kind: 'under_attack', text: 'We are under attack.', x: 3, y: 4 }, 0);
    f.push({ kind: 'under_attack', text: 'We are under attack.', x: 5, y: 6 }, 2);
    expect(f.items.length).toBe(1);
    expect(f.items[0].count).toBe(2);
    expect(f.items[0].x).toBe(5);
    expect(f.lastPositioned).toEqual({ x: 5, y: 6, at: 2 });
  });

  it('ignores empty texts and fades out', () => {
    const f = new AlertFeed();
    expect(f.push({ kind: 'info', text: '  ' }, 0)).toBeNull();
    const it = f.push({ kind: 'building_complete', text: 'Construction complete.' }, 0)!;
    expect(AlertFeed.opacity(it, ALERT_TTL - 0.1)).toBe(1);
    expect(AlertFeed.opacity(it, ALERT_TTL + ALERT_FADE / 2)).toBeCloseTo(0.5, 5);
    expect(f.expire(ALERT_TTL + ALERT_FADE + 0.01)).toBe(true);
    expect(f.items.length).toBe(0);
  });
});

describe('ThreatMarkers', () => {
  it('refreshes by key and expires', () => {
    const m = new ThreatMarkers();
    m.set({ key: 'a', x: 1, y: 1, tone: 'threat', label: '', until: 5 });
    m.set({ key: 'a', x: 2, y: 2, tone: 'threat', label: '', until: 6 });
    expect(m.items.length).toBe(1);
    expect(m.items[0].x).toBe(2);
    m.expire(6);
    expect(m.items.length).toBe(0);
  });

  it('caps the count, dropping Spent markers first', () => {
    const m = new ThreatMarkers();
    m.set({ key: 'spent', x: 0, y: 0, tone: 'spent', label: '', until: 100 });
    for (let i = 0; i < 6; i++) m.set({ key: `t${i}`, x: 0, y: 0, tone: 'threat', label: '', until: 10 + i });
    expect(m.items.length).toBe(6);
    expect(m.items.some((it) => it.key === 'spent')).toBe(false);
  });
});

describe('edgePlacement', () => {
  const play = { x0: 0, y0: 32, x1: 1280, y1: 550 };
  it('returns null for visible points', () => {
    expect(edgePlacement(640, 300, play, 30)).toBeNull();
  });
  it('clamps off-screen points to the inset edge', () => {
    const p = edgePlacement(5000, 291, play, 30)!;
    expect(p.x).toBeCloseTo(1250, 3);
    expect(p.y).toBeCloseTo(291, 3);
    expect(p.angle).toBeCloseTo(0, 5);
    const q = edgePlacement(640, -2000, play, 30)!;
    expect(q.y).toBeCloseTo(62, 3);
  });
});

describe('LossNotices (B9: units lost)', () => {
  it('shows the first death at once and folds deaths within 3 s into it', () => {
    const n = new LossNotices();
    n.record('courser', 10, 12, 100);
    expect(n.flush(100)).toEqual({ kind: 'new', text: 'Courser lost', x: 10, y: 12 });
    expect(n.flush(100.5)).toBeNull();
    n.record('bowman', 11, 12, 101);
    n.record('ashpike', 12, 13, 102.5);
    expect(n.flush(102.5)).toEqual({ kind: 'update', text: '3 soldiers lost', x: 12, y: 13 });
  });

  it('throttles new notices to one per 5 s and keeps the held deaths', () => {
    const n = new LossNotices();
    n.record('bowman', 1, 1, 0);
    expect(n.flush(0)?.kind).toBe('new');
    n.record('bowman', 2, 2, LOSS_AGGREGATE + 0.5); // after the aggregation window
    expect(n.flush(LOSS_AGGREGATE + 0.5)).toBeNull(); // throttled
    n.record('bowman', 3, 3, 4.5);
    expect(n.flush(LOSS_THROTTLE - 0.01)).toBeNull();
    expect(n.flush(LOSS_THROTTLE)).toEqual({ kind: 'new', text: '2 Bowmen lost', x: 3, y: 3 });
    expect(n.flush(LOSS_THROTTLE + 10)).toBeNull();
  });

  it('names one type, a count of one type, or soldiers', () => {
    expect(lossText({ counts: new Map([['courser', 1]]), total: 1 })).toBe('Courser lost');
    expect(lossText({ counts: new Map([['ashpike', 2]]), total: 2 })).toBe('2 Ashpikes lost');
    expect(lossText({ counts: new Map([['ashpike', 2], ['bowman', 1]]), total: 3 })).toBe('3 soldiers lost');
  });

  it('AlertFeed.revise rewrites the live toast and the jump target', () => {
    const f = new AlertFeed();
    const it = f.push({ kind: 'info', tone: 'danger', text: 'Courser lost', x: 1, y: 1 }, 0)!;
    expect(it.tone).toBe('danger');
    f.revise(it, { text: '2 soldiers lost', x: 4, y: 5 }, 1);
    expect(f.items).toHaveLength(1);
    expect(f.items[0]).toMatchObject({ text: '2 soldiers lost', x: 4, y: 5, at: 1 });
    expect(f.lastPositioned).toEqual({ x: 4, y: 5, at: 1 });
  });
});

describe('UnattendedFoundations (B1 safety net)', () => {
  it('reports a foundation nobody builds after 15 s, once per stretch', () => {
    const world = makeWorld();
    const tiller = addUnit(world, 'tiller', 5, 5);
    const a = addBuilding(world, 'cottage', 10, 10, 0, false);
    const b = addBuilding(world, 'cottage', 14, 10, 0, false);
    tiller.order = { type: 'build', buildingId: a.id };
    tiller.queue = [{ type: 'build', buildingId: b.id }];
    const u = new UnattendedFoundations();
    for (let t = 0; t <= 30; t += 1) {
      world.time = t;
      expect(u.update(world)).toEqual([]);
    }
    // Stop: both foundations lose their Tiller.
    tiller.order = { type: 'idle' };
    tiller.queue = [];
    world.time = 31;
    expect(u.update(world)).toEqual([]);
    world.time = 31 + UNATTENDED_AFTER - 0.1;
    expect(u.update(world)).toEqual([]);
    world.time = 31 + UNATTENDED_AFTER;
    expect(u.update(world).map((x) => x.id)).toEqual([a.id, b.id]);
    world.time += 10;
    expect(u.update(world)).toEqual([]);
    world.time = 31 + UNATTENDED_AFTER + UNATTENDED_REPEAT;
    expect(u.update(world).length).toBe(2);
  });

  it('ignores built buildings and resets when a Tiller returns', () => {
    const world = makeWorld();
    const tiller = addUnit(world, 'tiller', 5, 5);
    addBuilding(world, 'cottage', 4, 12, 0, true);
    const f = addBuilding(world, 'cottage', 10, 10, 0, false);
    const u = new UnattendedFoundations();
    world.time = 0;
    u.update(world);
    world.time = 10;
    tiller.order = { type: 'build', buildingId: f.id };
    u.update(world);
    tiller.order = { type: 'idle' };
    world.time = 20;
    expect(u.update(world)).toEqual([]);
    world.time = 20 + UNATTENDED_AFTER - 1;
    expect(u.update(world)).toEqual([]); // the clock restarted at 20
    world.time = 20 + UNATTENDED_AFTER;
    expect(u.update(world).map((x) => x.id)).toEqual([f.id]);
  });
});
