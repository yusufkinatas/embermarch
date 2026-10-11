/** GameEvent → sound mapping (GDD §P). */
import { describe, expect, it } from 'vitest';
import { SFX_NAMES, SOUNDING_EVENTS, eventToCues, isSfxName, selectPitch } from '../../src/audio/sfx';
import type { SfxName } from '../../src/game/types';
import type { GameEvent, World } from '../../src/sim/types';

const world = { map: { w: 56, h: 56 } } as unknown as World;
const names = (ev: GameEvent, batch?: GameEvent[]): SfxName[] => eventToCues(ev, world, batch).map((c) => c.name);

const atk = (o: Partial<Extract<GameEvent, { t: 'attack' }>>): GameEvent => ({ t: 'attack', attackerId: 1, targetId: 2, x: 5, y: 6, tx: 7, ty: 8, ranged: false, ...o });
const death = (o: Partial<Extract<GameEvent, { t: 'death' }>>): GameEvent => ({ t: 'death', id: 3, kind: 'unit', type: 'ashpike', owner: 0, x: 1, y: 1, ...o });

/** One representative event per sounding event type. */
const SAMPLES: GameEvent[] = [
  atk({ ranged: true, projectile: 'arrow', unitType: 'bowman' }),
  { t: 'hit', targetId: 2, attackerId: 1, x: 3, y: 3, damage: 5, mult: 1, popup: null, targetOwner: 1, isStructure: false },
  { t: 'gather', unitId: 1, res: 'timber', source: 'tree', x: 2, y: 2 },
  { t: 'treeFelled', tile: 57 },
  { t: 'dropoff', unitId: 1, res: 'grain', amount: 10, x: 2, y: 2 },
  { t: 'placed', id: 9, type: 'cottage', owner: 0 },
  { t: 'built', id: 9, type: 'cottage', owner: 0, x: 4, y: 4 },
  { t: 'trained', id: 10, type: 'ashpike', x: 4, y: 4 },
  { t: 'researched', research: 'quick_draw', buildingId: 9 },
  death({}),
  { t: 'nestDestroyed', id: 4, x: 30, y: 30, wavePct: 30 },
  { t: 'waveMuster', wave: 1, nestId: 4, x: 30, y: 30 },
  { t: 'waveBroken', wave: 1, nestId: 4 },
  { t: 'raidLaunch', x: 20, y: 20 },
  { t: 'beacon', id: 5, lit: true },
  { t: 'telegraph', shape: 'ring', x: 10, y: 10, radius: 4, duration: 1.5 },
  { t: 'bossPhase', phase: 2 },
  { t: 'shake', magnitude: 10, duration: 0.4 },
  { t: 'lastStand', x: 10, y: 54 },
  { t: 'rankUp', id: 3, rank: 1, x: 2, y: 2 },
  { t: 'cacheLooted', x: 40, y: 40, ember: 150, crowns: 15 },
  { t: 'command', kind: 'move', x: 3, y: 3 },
  { t: 'ability', name: 'firepot', x: 3, y: 3, radius: 2, owner: 0 },
  { t: 'sfx', name: 'card_flip' },
  { t: 'victory' },
  { t: 'defeat' },
];

/** Sounds triggered directly by the UI through play(), not by sim events. */
const UI_ONLY: SfxName[] = ['ui_click', 'ui_error', 'select'];

describe('eventToCues', () => {
  it('covers every sounding event type and only emits valid SfxNames', () => {
    const covered = new Set(SAMPLES.map((e) => e.t));
    for (const t of SOUNDING_EVENTS) expect(covered.has(t), t).toBe(true);
    for (const ev of SAMPLES) {
      const cues = eventToCues(ev, world, SAMPLES.filter((e) => e.t !== 'nestDestroyed' && e.t !== 'bossPhase' && e.t !== 'lastStand'));
      expect(cues.length, ev.t).toBeGreaterThan(0);
      for (const c of cues) expect(isSfxName(c.name), c.name).toBe(true);
    }
  });

  it('every SfxName is reachable from an event or the UI', () => {
    const reached = new Set<SfxName>(UI_ONLY);
    const extra: GameEvent[] = [
      atk({ ranged: true, projectile: 'bolt', unitType: 'hearth' }),
      atk({ unitType: 'ashpike' }),
      { t: 'gather', unitId: 1, res: 'ember', source: 'ember_seam', x: 2, y: 2 },
      { t: 'gather', unitId: 1, res: 'grain', source: 'thicket', x: 2, y: 2 },
      death({ owner: 1, type: 'thornling' }),
      death({ kind: 'building', type: 'cottage', owner: 0 }),
      { t: 'beacon', id: 5, lit: false },
    ];
    for (const ev of [...SAMPLES, ...extra]) for (const n of names(ev)) reached.add(n);
    for (const n of SFX_NAMES) expect(reached.has(n), n).toBe(true);
  });

  it('attacks: bows, bolts, spines and melee', () => {
    expect(names(atk({ ranged: true, projectile: 'arrow' }))).toEqual(['bow_loose']);
    expect(names(atk({ ranged: true, projectile: 'fire_arrow' }))).toEqual(['bow_loose']);
    expect(names(atk({ ranged: true, projectile: 'bolt', unitType: 'brazier_tower' }))).toEqual(['bolt_fire']);
    const spine = eventToCues(atk({ ranged: true, projectile: 'spine', unitType: 'spinecaster' }));
    expect(spine[0].name).toBe('bow_loose');
    expect(spine[0].pitch).toBeLessThan(1);
    expect(names(atk({ unitType: 'briarguard' }))).toEqual(['melee_hit']);
    expect(eventToCues(atk({}))[0]).toMatchObject({ x: 5, y: 6 });
  });

  it('hits: crunch on Thornwake targets only', () => {
    const hit = (targetOwner: 0 | 1): GameEvent => ({ t: 'hit', targetId: 2, attackerId: 1, x: 3, y: 3, damage: 5, mult: 1, popup: null, targetOwner, isStructure: false });
    expect(names(hit(1))).toEqual(['thorn_hit']);
    expect(names(hit(0))).toEqual([]);
  });

  it('gathering: chop / mine / harvest by source', () => {
    const g = (source: 'tree' | 'ember_seam' | 'thicket' | 'grainplot'): SfxName[] =>
      names({ t: 'gather', unitId: 1, res: 'grain', source, x: 1, y: 1 });
    expect(g('tree')).toEqual(['chop']);
    expect(g('ember_seam')).toEqual(['mine']);
    expect(g('thicket')).toEqual(['harvest']);
    expect(g('grainplot')).toEqual(['harvest']);
  });

  it('deaths by side and kind; Nest deaths defer to nestDestroyed', () => {
    expect(names(death({ owner: 0 }))).toEqual(['death_player']);
    expect(names(death({ owner: 1, type: 'thornling' }))).toEqual(['death_thorn']);
    expect(names(death({ kind: 'building', type: 'storehouse', owner: 0 }))).toEqual(['building_destroyed']);
    expect(names(death({ kind: 'building', type: 'thornspire', owner: 1 }))).toEqual(['building_destroyed']);
    expect(names(death({ kind: 'building', type: 'thorn_nest', owner: 1 }))).toEqual([]);
    expect(names({ t: 'nestDestroyed', id: 4, x: 1, y: 1, wavePct: 30 })).toEqual(['nest_destroyed']);
  });

  it('director and boss cues', () => {
    expect(names({ t: 'waveMuster', wave: 2, nestId: 4, x: 1, y: 1 })).toEqual(['wave_horn']);
    expect(names({ t: 'waveBroken', wave: 2, nestId: 4 })).toEqual(['wave_broken']);
    expect(names({ t: 'raidLaunch', x: 1, y: 1 })).toEqual(['raid_alert']);
    expect(names({ t: 'beacon', id: 1, lit: true })).toEqual(['beacon_lit']);
    expect(names({ t: 'beacon', id: 1, lit: false })).toEqual(['beacon_snuffed']);
    expect(names({ t: 'telegraph', shape: 'line', x: 1, y: 1, x2: 5, y2: 5, width: 1.5, duration: 1.2 })).toEqual(['boss_telegraph']);
    expect(names({ t: 'bossPhase', phase: 2 })).toContain('boss_slam');
    expect(names({ t: 'shake', magnitude: 4, duration: 0.25 })).toEqual([]);
    const shake: GameEvent = { t: 'shake', magnitude: 12, duration: 0.3 };
    expect(names(shake)).toEqual(['boss_slam']);
    // A shake that accompanies a Nest death is already covered by its boom.
    expect(names(shake, [shake, { t: 'nestDestroyed', id: 1, x: 1, y: 1, wavePct: 20 }])).toEqual([]);
  });

  it('player feedback: build, train, research, rank, end of battle', () => {
    expect(names({ t: 'built', id: 1, type: 'bowyard', owner: 0, x: 1, y: 1 })).toEqual(['build_complete']);
    expect(names({ t: 'built', id: 1, type: 'thornspire', owner: 1, x: 1, y: 1 })).toEqual([]);
    expect(names({ t: 'placed', id: 1, type: 'cottage', owner: 0 })).toEqual(['build_hammer']);
    expect(names({ t: 'trained', id: 1, type: 'bowman', x: 1, y: 1 })).toEqual(['unit_trained']);
    expect(names({ t: 'researched', research: 'hauberks', buildingId: 1 })).toEqual(['research_complete']);
    expect(names({ t: 'rankUp', id: 1, rank: 2, x: 1, y: 1 })).toEqual(['rank_up']);
    expect(names({ t: 'victory' })).toEqual(['victory']);
    expect(names({ t: 'defeat' })).toEqual(['defeat']);
  });

  it("'sfx' events pass valid names through and drop unknown ones", () => {
    expect(eventToCues({ t: 'sfx', name: 'ui_error', x: 4, y: 5 })).toEqual([{ name: 'ui_error', x: 4, y: 5 }]);
    expect(eventToCues({ t: 'sfx', name: 'not_a_sound' })).toEqual([]);
  });

  it('silent events stay silent', () => {
    const quiet: GameEvent[] = [
      { t: 'spawn', id: 1, type: 'thornling', owner: 1, x: 1, y: 1 },
      { t: 'knockback', id: 1 },
      { t: 'burn', id: 1 },
      { t: 'heal', id: 1, amount: 2 },
      { t: 'blightRecede', x: 1, y: 1, radius: 4 },
      { t: 'slowmo', factor: 0.5, duration: 0.4 },
      { t: 'alert', kind: 'info', text: 'x' },
    ];
    for (const ev of quiet) expect(eventToCues(ev, world), ev.t).toEqual([]);
  });

  it('select pitch: workers high, siege low', () => {
    expect(selectPitch('worker')).toBeGreaterThan(selectPitch('infantry'));
    expect(selectPitch('siege')).toBeLessThan(selectPitch('infantry'));
  });
});
