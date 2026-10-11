import { describe, expect, it } from 'vitest';
import { HINT_MIN_SHOW, HintDirector, type HintSnapshot } from '../../src/game/hints';
import { HINTS } from '../../src/data/text';

function snap(over: Partial<HintSnapshot> = {}): HintSnapshot {
  return { time: 0, countdown: 0, timber: 0, pop: 8, popCap: 20, militaryBuildings: 1, nearThicketFrac: 1, ...over };
}

describe('HintDirector', () => {
  it('has a trigger for all 10 GDD hints', () => {
    const d = new HintDirector([], true);
    d.evaluate(snap({ time: 31, timber: 200, pop: 19, nearThicketFrac: 0.2 }));
    const shown = new Set<string>();
    shown.add(d.update(0).current!.id); // 'gather' shows at 0:00, before the first gather order
    d.dismiss();
    for (const s of ['first_gather', 'wave1_muster', 'wave1_launch', 'first_military', 'wave1_broken', 'first_counter_popup'] as const) {
      d.signal(s);
    }
    let now = 1;
    for (let i = 0; i < 20; i++) {
      const { current } = d.update(now);
      if (current) shown.add(current.id);
      d.dismiss();
      now += 1;
    }
    expect([...shown].sort()).toEqual(HINTS.map((h) => h.id).sort());
    expect(shown.size).toBe(10);
  });

  it('shows the gather hint at 0:00 only after the Kindle countdown', () => {
    const d = new HintDirector([], true);
    d.evaluate(snap({ countdown: 2 }));
    expect(d.update(0).current).toBeNull();
    d.evaluate(snap({ countdown: 0 }));
    expect(d.update(0).current?.id).toBe('gather');
  });

  it('skips hints already seen and does nothing when disabled', () => {
    const d = new HintDirector(['gather'], true);
    d.evaluate(snap());
    expect(d.update(0).current).toBeNull();
    const off = new HintDirector([], false);
    off.evaluate(snap());
    off.signal('first_gather');
    expect(off.update(0).current).toBeNull();
  });

  it('each hint shows once; dismiss returns its id', () => {
    const d = new HintDirector([], true);
    d.signal('first_gather');
    expect(d.update(0).current?.id).toBe('train_tiller');
    expect(d.dismiss()).toBe('train_tiller');
    d.signal('first_gather');
    expect(d.update(1).current).toBeNull();
    expect(d.dismiss()).toBeNull();
  });

  it('military building hint needs 0:30, 150 Timber and exactly one military building', () => {
    const d = new HintDirector(['gather'], true);
    d.evaluate(snap({ time: 29, timber: 200 }));
    d.evaluate(snap({ time: 40, timber: 100 }));
    d.evaluate(snap({ time: 40, timber: 200, militaryBuildings: 2 }));
    expect(d.update(0).current).toBeNull();
    d.evaluate(snap({ time: 40, timber: 200, militaryBuildings: 1 }));
    expect(d.update(0).current?.id).toBe('military_building');
  });

  it('cottage hint fires within 2 of the cap, but not at the hard cap', () => {
    const d = new HintDirector(['gather'], true);
    d.evaluate(snap({ pop: 17, popCap: 20 }));
    expect(d.update(0).current).toBeNull();
    d.evaluate(snap({ pop: 58, popCap: 60 }));
    expect(d.update(0).current).toBeNull();
    d.evaluate(snap({ pop: 18, popCap: 20 }));
    expect(d.update(0).current?.id).toBe('cottage');
  });

  it('a queued hint replaces the visible one only after the minimum show time', () => {
    const d = new HintDirector([], true);
    d.signal('first_gather');
    expect(d.update(0).current?.id).toBe('train_tiller');
    d.signal('wave1_muster');
    expect(d.update(HINT_MIN_SHOW - 1).current?.id).toBe('train_tiller');
    const r = d.update(HINT_MIN_SHOW + 0.1);
    expect(r.autoDismissed).toBe('train_tiller');
    expect(r.current?.id).toBe('scout');
  });
});

describe('HintDirector completion', () => {
  it('completing the taught action drops a visible or queued hint and logs it as seen once', () => {
    const d = new HintDirector([], true);
    d.evaluate(snap());
    expect(d.update(0).current?.id).toBe('gather');
    d.signal('first_gather'); // completes 'gather', queues 'train_tiller'
    expect(d.update(0.1).current?.id).toBe('train_tiller');
    expect(d.complete('train_tiller')).toBe(true);
    expect(d.complete('train_tiller')).toBe(false);
    expect(d.update(0.2).current).toBeNull();
    d.complete('cottage'); // never shown, never raised later
    d.evaluate(snap({ pop: 19, popCap: 20 }));
    expect(d.update(0.3).current).toBeNull();
    expect(d.drainSeen()).toEqual(['gather', 'train_tiller', 'cottage']);
    expect(d.drainSeen()).toEqual([]);
  });

  it('dismissed and auto-replaced hints are logged as seen', () => {
    const d = new HintDirector([], true);
    d.signal('first_military');
    d.update(0);
    d.signal('wave1_muster');
    d.update(HINT_MIN_SHOW + 1);
    d.dismiss();
    expect(d.drainSeen()).toEqual(['groups', 'scout']);
  });
});
