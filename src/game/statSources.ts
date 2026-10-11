/**
 * Boosted / reduced unit stats for the selection panel (B10): compares the composed stats
 * (sim-core unitStats) with the base UNITS row, and names the sources that change each stat
 * (Boons, House passive, research, battle modifiers, rank). Pure: no DOM.
 */
import { VETERANCY } from '../data/balance';
import { BOONS } from '../data/boons';
import { HOUSES } from '../data/houses';
import { MODIFIERS } from '../data/modifiers';
import { RESEARCH } from '../data/research';
import { RANK_NAMES } from '../data/text';
import { UNITS } from '../data/units';
import { carryCap, composeUnitStats, unitStats } from '../sim/stats';
import type { Effect, Owner, ResourceType, UnitId, World } from '../sim/types';
import { PLAYER } from '../sim/types';

export type StatKey = 'hp' | 'atk' | 'arm' | 'rng' | 'spd';
export const STAT_KEYS: readonly StatKey[] = ['hp', 'atk', 'arm', 'rng', 'spd'];

export interface StatLine {
  key: StatKey;
  /** Base value from the UNITS table. */
  base: number;
  /** Composed value for this owner, type and rank (what the panel shows). */
  value: number;
  /** 'up' (green), 'down' (red) or '' (unchanged). */
  tone: 'up' | 'down' | '';
  /** "Yew Staves +1", "Rank I +15% damage". */
  sources: string[];
}

interface Source {
  name: string;
  effects: readonly Effect[];
}

const EPS = 0.05;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function signed(v: number): string {
  const r = round1(v);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}`;
}

function pick(s: ReturnType<typeof composeUnitStats>, key: StatKey): number {
  switch (key) {
    case 'hp':
      return s.hp;
    case 'atk':
      return s.atk * s.damageMul;
    case 'arm':
      return s.armor;
    case 'rng':
      return s.range;
    case 'spd':
      return s.speed;
  }
}

/** Named effect sources active for an owner (Boons, House passive, research, battle modifiers). */
export function effectSources(world: World, owner: Owner): Source[] {
  const out: Source[] = [];
  const setup = world.setup;
  if (owner === PLAYER) {
    for (const id of setup.boons ?? []) {
      const b = BOONS[id];
      if (b?.effects?.length) out.push({ name: b.name, effects: b.effects });
    }
    const house = HOUSES[setup.house];
    if (house?.effects?.length) out.push({ name: `House ${house.name}`, effects: house.effects });
  }
  const p = world.players[owner];
  const researched = new Set(p?.researched ?? []);
  if (p?.temper) researched.add(p.temper);
  for (const id of researched) {
    const r = RESEARCH[id];
    if (r?.effects?.length) out.push({ name: r.name, effects: r.effects });
  }
  for (const id of setup.modifiers ?? []) {
    const m = MODIFIERS[id];
    const effects = owner === PLAYER ? m?.playerEffects : m?.enemyEffects;
    if (m && effects?.length) out.push({ name: m.name, effects });
  }
  return out;
}

/** Composed vs base stats for one unit, with the sources behind each change. */
export function unitStatLines(world: World, owner: Owner, type: UnitId, rank: number): Record<StatKey, StatLine> {
  const def = UNITS[type];
  const base: Record<StatKey, number> = { hp: def.hp, atk: def.atk, arm: def.armor, rng: def.range, spd: def.speed };
  let cur: ReturnType<typeof composeUnitStats> | null = null;
  try {
    cur = unitStats(world, owner, type, rank);
  } catch {
    cur = null;
  }
  const plain = composeUnitStats([], type, 0);
  const sources = cur ? effectSources(world, owner) : [];
  const lines = {} as Record<StatKey, StatLine>;
  for (const key of STAT_KEYS) {
    const value = cur ? pick(cur, key) : base[key];
    const diff = round1(value) - round1(base[key]);
    const tone: StatLine['tone'] = diff > EPS ? 'up' : diff < -EPS ? 'down' : '';
    const named: string[] = [];
    if (tone) {
      for (const src of sources) {
        const d = pick(composeUnitStats(src.effects, type, 0), key) - pick(plain, key);
        if (Math.abs(d) > EPS) named.push(`${src.name} ${signed(d)}`);
      }
      if (rank > 0 && key === 'atk') named.push(`${RANK_NAMES[rank]} +${VETERANCY.atkPctPerRank * rank}% damage`);
      if (rank > 0 && key === 'hp') {
        const d = pick(composeUnitStats([], type, rank), 'hp') - pick(plain, 'hp');
        if (Math.abs(d) > EPS) named.push(`${RANK_NAMES[rank]} ${signed(d)}`);
      }
      if (rank >= 3 && key === 'arm') {
        const d = pick(composeUnitStats([], type, rank), 'arm') - pick(plain, 'arm');
        if (Math.abs(d) > EPS) named.push(`${RANK_NAMES[rank]} ${signed(d)}`);
      }
    }
    lines[key] = { key, base: base[key], value, tone, sources: named };
  }
  return lines;
}

/** Carry capacity for a resource with the sources that raise it ("Laden Packs +4"). */
export function carryInfo(world: World, owner: Owner, res: ResourceType): { cap: number; base: number; sources: string[] } {
  let cap = 0;
  try {
    cap = carryCap(world, owner, res);
  } catch {
    cap = 0;
  }
  const sources: string[] = [];
  let added = 0;
  for (const src of effectSources(world, owner)) {
    let add = 0;
    for (const e of src.effects) if (e.kind === 'carry' && (e.res === 'all' || e.res === res)) add += e.add;
    if (add) {
      sources.push(`${src.name} ${signed(add)}`);
      added += add;
    }
  }
  return { cap, base: Math.max(1, cap - added), sources };
}
