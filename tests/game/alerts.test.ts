import { describe, expect, it } from 'vitest';
import { ALERT_FADE, ALERT_MAX, ALERT_TTL, AlertFeed, ThreatMarkers, edgePlacement } from '../../src/game/alerts';

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
