/**
 * composeStats stacking rules and caps (GDD §L, §Q f) for boons, houses, research and modifiers.
 */
import { describe, expect, it } from 'vitest';
import { BOONS } from '../../src/data/boons';
import { HOUSES } from '../../src/data/houses';
import { MODIFIERS } from '../../src/data/modifiers';
import { RESEARCH } from '../../src/data/research';
import type { Effect } from '../../src/sim/types';
import {
  carryCap,
  composeBuildingStats,
  composeCost,
  composeUnitStats,
  computeFlags,
  costOf,
  flagValue,
  gatherRate,
  hasFlag,
  selectorMatches,
  unitStats,
} from '../../src/sim/stats';
import { UNITS } from '../../src/data/units';
import { makeWorld } from './helpers';

const boon = (...ids: (keyof typeof BOONS)[]): Effect[] => ids.flatMap((id) => BOONS[id].effects);
const research = (...ids: (keyof typeof RESEARCH)[]): Effect[] => ids.flatMap((id) => RESEARCH[id].effects);

describe('selectors', () => {
  it('empty selector matches nothing; criteria are ANDed', () => {
    expect(selectorMatches({}, { kind: 'unit', type: 'ashpike', def: UNITS.ashpike })).toBe(false);
    expect(selectorMatches({ military: true, melee: true }, { kind: 'unit', type: 'ashpike', def: UNITS.ashpike })).toBe(true);
    expect(selectorMatches({ military: true, melee: true }, { kind: 'unit', type: 'bowman', def: UNITS.bowman })).toBe(false);
    expect(selectorMatches({ military: true }, { kind: 'unit', type: 'tiller', def: UNITS.tiller })).toBe(false);
    expect(selectorMatches({ military: true }, { kind: 'unit', type: 'warden', def: UNITS.warden })).toBe(false);
    expect(selectorMatches({ allUnits: true }, { kind: 'unit', type: 'warden', def: UNITS.warden })).toBe(true);
  });
});

describe('composeUnitStats', () => {
  it('base values without effects', () => {
    const s = composeUnitStats([], 'ashpike');
    expect(s).toMatchObject({ hp: 60, atk: 5, cooldown: 1.5, range: 0.7, armor: 1, speed: 2, sight: 6, trainTime: 12, pop: 1 });
    expect(s.cost).toEqual({ grain: 35, timber: 25 });
    expect(s.structMod).toBe(0.7);
  });

  it('flat bonuses add (Ashpike Discipline + Ash-Hardened Hafts)', () => {
    const s = composeUnitStats(effectsOf(boon('pike_discipline'), research('ash_hafts')), 'ashpike');
    expect(s.hp).toBe(60 + 15 + 20);
    expect(s.atk).toBe(6);
    const o = composeUnitStats(effectsOf(boon('pike_discipline'), research('ash_hafts')), 'oathshield');
    expect(o.hp).toBe(125);
    expect(o.armor).toBe(4);
  });

  it('percentages add within a stat before multiplying', () => {
    const eff: Effect[] = [
      { kind: 'stat', sel: { units: ['courser'] }, stat: 'speed', pct: 10 },
      { kind: 'stat', sel: { units: ['courser'] }, stat: 'speed', pct: 20 },
    ];
    expect(composeUnitStats(eff, 'courser').speed).toBeCloseTo(3.3 * 1.3, 6);
    expect(composeUnitStats(boon('swift_coursers'), 'courser').speed).toBeCloseTo(3.3 * 1.15, 6);
  });

  it('train time reduction is capped at 40% (Quartermasters + Grimbrand)', () => {
    const s = composeUnitStats(effectsOf(boon('quartermasters'), HOUSES.grimbrand.effects), 'ashpike');
    expect(s.trainTime).toBeCloseTo(12 * 0.6, 6);
    expect(composeUnitStats(boon('quartermasters'), 'bowman').trainTime).toBeCloseTo(13 * 0.75, 6);
    // Tillers are not military.
    expect(composeUnitStats(boon('quartermasters'), 'tiller').trainTime).toBe(10);
  });

  it('Thornreaper Levy sets values; flats and pcts still stack on the set value', () => {
    const s = composeUnitStats(effectsOf(boon('thornreaper_levy'), boon('pike_discipline'), boon('quartermasters')), 'ashpike');
    expect(s.hp).toBe(65);
    expect(s.trainTime).toBeCloseTo(6, 6);
    expect(s.cost).toEqual({ grain: 26, timber: 15 });
  });

  it('range bonus capped at +2, Downpour −1 applied after the cap', () => {
    const plus2: Effect = { kind: 'stat', sel: { units: ['bowman'] }, stat: 'range', add: 2 };
    expect(composeUnitStats(boon('yew_staves'), 'bowman').range).toBe(7);
    expect(composeUnitStats([...boon('yew_staves'), plus2], 'bowman').range).toBe(8);
    expect(composeUnitStats([...boon('yew_staves'), plus2, ...(MODIFIERS.downpour.playerEffects ?? [])], 'bowman').range).toBe(7);
    // Downpour never touches melee units.
    expect(composeUnitStats(MODIFIERS.downpour.playerEffects ?? [], 'ashpike').range).toBe(0.7);
  });

  it('sight never drops below 3 (Thick Fog)', () => {
    const fog = MODIFIERS.thick_fog.playerEffects ?? [];
    expect(composeUnitStats(fog, 'tiller').sight).toBe(4);
    expect(composeUnitStats(fog, 'gatebreaker').sight).toBe(3);
  });

  it('rank: +15% HP and ATK per rank, Rank III +1 armor', () => {
    const r2 = composeUnitStats([], 'ashpike', 2);
    expect(r2.hp).toBe(78);
    expect(r2.atk).toBeCloseTo(6.5, 6);
    expect(r2.armor).toBe(1);
    const r3 = composeUnitStats([], 'ashpike', 3);
    expect(r3.hp).toBe(Math.round(60 * 1.45));
    expect(r3.armor).toBe(2);
    expect(r3.rankMul).toBeCloseTo(1.45, 6);
  });

  it('structure multiplier overrides (Firebrand 0.4, Raider’s Bounty 0.8)', () => {
    expect(composeUnitStats([], 'bowman').structMod).toBe(0.2);
    expect(composeUnitStats(boon('firebrand'), 'bowman').structMod).toBe(0.4);
    expect(composeUnitStats(boon('firebrand'), 'outrider').structMod).toBe(0.4);
    expect(composeUnitStats([], 'courser').structMod).toBe(0.4);
    expect(composeUnitStats(boon('raiders_bounty'), 'courser').structMod).toBe(0.8);
    expect(composeUnitStats([], 'brandbow').structMod).toBe(0.8);
    expect(composeUnitStats([], 'gatebreaker').structMod).toBe(4);
  });

  it('Tempers and armor boons hit the right units', () => {
    const edge = research('ember_edge');
    expect(composeUnitStats(edge, 'ashpike').atk).toBe(7);
    expect(composeUnitStats(edge, 'warden').atk).toBe(16);
    expect(composeUnitStats(edge, 'bowman').atk).toBe(5);
    expect(composeUnitStats(edge, 'tiller').atk).toBe(3);
    const barbed = research('barbed_heads');
    expect(composeUnitStats(barbed, 'bowman').atk).toBe(7);
    expect(composeUnitStats(barbed, 'outrider').atk).toBe(7);
    expect(composeUnitStats(barbed, 'ashpike').atk).toBe(5);
    const mail = boon('ember_mail');
    expect(composeUnitStats(mail, 'tiller').armor).toBe(1);
    expect(composeUnitStats(mail, 'warden').armor).toBe(4);
    expect(composeUnitStats(research('hauberks'), 'warden').armor).toBe(3);
    expect(composeUnitStats(research('hauberks'), 'bowman').armor).toBe(2);
    expect(composeUnitStats(research('quick_draw'), 'brandbow').cooldown).toBeCloseTo(1.7, 6);
  });

  it("Warlord's Gambit is a damage multiplier for military only", () => {
    expect(composeUnitStats(boon('warlords_gambit'), 'ashpike').damageMul).toBeCloseTo(1.25, 6);
    expect(composeUnitStats(boon('warlords_gambit'), 'warden').damageMul).toBe(1);
  });

  it('Lowmere: Bowmen +10 HP', () => {
    expect(composeUnitStats(HOUSES.lowmere.effects, 'bowman').hp).toBe(45);
  });
});

describe('costs', () => {
  it('percentages apply before flats, rounded, min 0', () => {
    // Tallow +20 T on the Muster Hall, Master Joiners −10% Timber: round(150 × 0.9 + 20) = 155.
    const e = effectsOf(HOUSES.tallow.effects, boon('master_joiners'));
    expect(composeBuildingStats(e, 'muster_hall').cost).toEqual({ timber: 155 });
    // Tallow Grainplot set 35, −10% → 31.5 → 32.
    expect(composeBuildingStats(e, 'grainplot').cost).toEqual({ timber: 32 });
    // Swift Coursers −10 Grain + Quartermasters −15%: round(55 × 0.85 − 10) = 37.
    const c = composeUnitStats(effectsOf(boon('swift_coursers'), boon('quartermasters')), 'courser');
    expect(c.cost).toEqual({ grain: 37, ember: 25 });
    const neg: Effect[] = [{ kind: 'cost', sel: { units: ['tiller'] }, res: 'grain', add: -500 }];
    expect(composeUnitStats(neg, 'tiller').cost).toEqual({});
  });

  it('Ember Tithe −15% Ember on units and buildings; research is untouched', () => {
    const e = boon('ember_tithe');
    expect(composeUnitStats(e, 'courser').cost).toEqual({ grain: 55, ember: 21 });
    expect(composeBuildingStats(e, 'paddock').cost).toEqual({ timber: 150, ember: 34 });
  });

  it('Swift Coursers make the Paddock free of Ember; Lowmere towers cost 0 Ember', () => {
    expect(composeBuildingStats(boon('swift_coursers'), 'paddock').cost).toEqual({ timber: 150 });
    expect(composeBuildingStats(HOUSES.lowmere.effects, 'brazier_tower').cost).toEqual({ timber: 100 });
  });

  it('composeCost leaves untouched resources alone', () => {
    expect(composeCost({ grain: 25, timber: 40 }, [], { kind: 'unit', type: 'bowman', def: UNITS.bowman })).toEqual({ grain: 25, timber: 40 });
  });
});

describe('buildings', () => {
  it('Hearth of the Last Flame: +1200 HP and 3 bolts; Stoked Braziers +3 ATK +1 range', () => {
    const s = composeBuildingStats(effectsOf(boon('flame_hearth'), research('stoked_braziers')), 'hearth');
    expect(s.hp).toBe(3600);
    expect(s.attack).toEqual({ dmg: 13, cooldown: 1.5, range: 8, volley: 3 });
  });

  it('structure range bonus capped at +2 (Lowmere + Stoked + extra), Downpour after cap', () => {
    const extra: Effect = { kind: 'stat', sel: { buildings: ['brazier_tower'] }, stat: 'range', add: 1 };
    const e = effectsOf(HOUSES.lowmere.effects, research('stoked_braziers'), [extra]);
    expect(composeBuildingStats(e, 'brazier_tower').attack?.range).toBe(9);
    expect(composeBuildingStats([...e, ...(MODIFIERS.downpour.playerEffects ?? [])], 'brazier_tower').attack?.range).toBe(8);
    expect(composeBuildingStats(MODIFIERS.downpour.enemyEffects ?? [], 'thornspire').attack?.range).toBe(5);
  });

  it('Master Joiners speeds construction; Kiln Masons builds towers 2× faster', () => {
    expect(composeBuildingStats(boon('master_joiners'), 'cottage').buildTime).toBeCloseTo(12 * (1 - 0.2308), 3);
    expect(composeBuildingStats([], 'brazier_tower', true).buildTime).toBeCloseTo(12.5, 6);
    expect(composeBuildingStats([], 'cottage', true).buildTime).toBe(12);
  });
});

describe('world-level stats', () => {
  it('caches per (owner, type, rank) and uses the owner effect list', () => {
    const w = makeWorld({ playerEffects: boon('pike_discipline'), enemyEffects: MODIFIERS.swift_hunt.enemyEffects ?? [] });
    expect(unitStats(w, 0, 'ashpike').hp).toBe(75);
    expect(unitStats(w, 1, 'ashpike').hp).toBe(60);
    expect(unitStats(w, 1, 'stagrider').speed).toBeCloseTo(3.1 * 1.2, 6);
    expect(unitStats(w, 0, 'ashpike')).toBe(unitStats(w, 0, 'ashpike'));
    expect(costOf(w, 0, 'cottage')).toEqual({ timber: 40 });
  });

  it('gather rates: Harvest Songs, Warlord’s Gambit, Furrow Rites, Deep Picks + Deep Delvers, Blight', () => {
    const w = makeWorld({ playerEffects: effectsOf(boon('harvest_songs'), boon('warlords_gambit'), boon('deep_delvers')) });
    expect(gatherRate(w, 0, 'thicket', false)).toBeCloseTo(1.0 * (1 + 0.12 - 0.25), 6);
    expect(gatherRate(w, 0, 'tree', false)).toBeCloseTo(0.8 * 0.87, 6);
    expect(gatherRate(w, 0, 'ember_seam', false)).toBeCloseTo(0.6 * 0.95, 6);
    expect(gatherRate(w, 0, 'ember_seam', true)).toBeCloseTo(0.6 * 0.95 * 0.6, 6);
    // Harvest Hymn adds into the same percentage sum.
    expect(gatherRate(w, 0, 'thicket', false, 60)).toBeCloseTo(1.0 * (1 + 0.12 - 0.25 + 0.6), 6);
    const w2 = makeWorld({ playerEffects: effectsOf(research('furrow_rites'), research('deep_picks'), boon('kindled_earth')) });
    expect(gatherRate(w2, 0, 'grainplot', false)).toBeCloseTo(0.75, 6);
    expect(gatherRate(w2, 0, 'thicket', false)).toBe(1);
    expect(gatherRate(w2, 0, 'ember_seam', true)).toBeCloseTo(0.75, 6);
  });

  it('carry: Laden Packs +4 all, Log Sledges +5 Timber', () => {
    const w = makeWorld({ playerEffects: effectsOf(boon('laden_packs'), research('log_sledges')) });
    expect(carryCap(w, 0, 'timber')).toBe(19);
    expect(carryCap(w, 0, 'grain')).toBe(14);
  });

  it('flags: values summed, valueless count 1', () => {
    const f = computeFlags(effectsOf(boon('ember_tithe'), boon('deep_delvers'), boon('second_wind')));
    expect(f.ember_tithe).toBeCloseTo(1.2, 6);
    expect(f.home_seam_bonus).toBe(200);
    expect(f.second_wind).toBe(1);
    const w = makeWorld({ playerEffects: boon('ember_tithe') });
    expect(hasFlag(w, 0, 'ember_tithe')).toBe(true);
    expect(flagValue(w, 0, 'ember_tithe')).toBeCloseTo(1.2, 6);
    expect(hasFlag(w, 0, 'hawk')).toBe(false);
  });
});

function effectsOf(...lists: Effect[][]): Effect[] {
  return lists.flat();
}
