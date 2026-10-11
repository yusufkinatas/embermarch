import { describe, expect, it } from 'vitest';
import { DOCTRINES, MODIFIERS, NEGATIVE_MODIFIERS } from '../../src/data';
import { BEACONS_ENABLED, generateRunMap, runMapViolations } from '../../src/run';
import type { RunMap } from '../../src/run/types';

const COMBAT = new Set(['battle', 'elite']);

/** Every start→boss path, enumerated explicitly (independent of the generator's DP). */
function allPaths(map: RunMap): string[][] {
  const out: string[][] = [];
  const walk = (id: string, path: string[]) => {
    const p = [...path, id];
    if (id === map.bossId) {
      out.push(p);
      return;
    }
    for (const nx of map.nodes[id].next) walk(nx, p);
  };
  walk(map.startId, []);
  return out;
}

const BIOMES_BY_COL: Record<number, string[]> = {
  1: ['greenmarch'],
  2: ['greenmarch'],
  3: ['greenmarch', 'fenreach'],
  4: ['greenmarch', 'fenreach'],
  5: ['fenreach', 'ashwood'],
  6: ['fenreach', 'ashwood'],
};

/** Independent §B / §K checks. Returns a list of problems. */
function checkMap(map: RunMap): string[] {
  const errs: string[] = [];
  const nodes = Object.values(map.nodes);
  const col = (c: number) => nodes.filter((n) => n.col === c);
  if (nodes.length < 16 || nodes.length > 22) errs.push(`total ${nodes.length}`);
  const mid = nodes.filter((n) => n.col >= 2 && n.col <= 7).length;
  if (mid < 14 || mid > 20) errs.push(`mid ${mid}`);
  for (let c = 2; c <= 7; c++) if (col(c).length < 2 || col(c).length > 4) errs.push(`col ${c} has ${col(c).length}`);
  if (col(1).length !== 1 || col(8).length !== 1) errs.push('ends');

  const start = map.nodes[map.startId];
  if (start.col !== 1 || start.type !== 'battle') errs.push('start type');
  if (start.battle?.objective !== 'raze' || start.battle.reward !== 'draft' || start.battle.modifiers.length !== 0 || start.battle.depth !== 1) {
    errs.push('start battle rules');
  }
  if ([...start.next].sort().join() !== col(2).map((n) => n.id).sort().join()) errs.push('start links');
  const boss = map.nodes[map.bossId];
  if (boss.type !== 'boss' || boss.col !== 8 || boss.battle?.objective !== 'boss' || boss.battle.depth !== 7) errs.push('boss');
  if (boss.battle?.threat !== 5 || boss.battle.modifiers.length || boss.battle.biome !== 'heartwood') errs.push('boss rolls');
  for (const n of col(7)) if (n.next.join() !== map.bossId) errs.push(`${n.id} → boss`);

  // Edges, crossing, adjacency rules.
  for (let c = 2; c <= 6; c++) {
    const edges: [number, number][] = [];
    for (const n of col(c)) {
      for (const nx of n.next) {
        const t = map.nodes[nx];
        if (t.col !== c + 1) errs.push(`edge col skip ${n.id}->${nx}`);
        edges.push([n.lane, t.lane]);
        if (Math.abs(n.lane - t.lane) > 1) errs.push(`long edge ${n.id}->${nx}`);
      }
    }
    for (const [a1, b1] of edges) for (const [a2, b2] of edges) if (a1 < a2 && b1 > b2) errs.push(`cross ${c}`);
  }
  for (const n of nodes) {
    for (const nx of n.next) {
      const t = map.nodes[nx].type;
      if (n.type === 'elite' && t === 'elite') errs.push('elite→elite');
      if (n.type === 'peddler' && t === 'peddler') errs.push('peddler→peddler');
    }
  }

  // Types.
  const elites = nodes.filter((n) => n.type === 'elite');
  if (elites.length < 1 || elites.length > 2) errs.push(`elites ${elites.length}`);
  for (const e of elites) if (e.col < 3 || e.col > 6) errs.push(`elite col ${e.col}`);
  if (!col(2).some((n) => n.type === 'battle')) errs.push('col2 battle');
  for (const n of col(2)) if (n.type !== 'battle' && n.type !== 'event') errs.push(`col2 ${n.type}`);
  for (const n of col(3)) if (n.type === 'camp') errs.push('camp in col 3');
  const c7 = col(7).map((n) => n.type);
  if (!c7.includes('camp') || !c7.includes('peddler') || c7.some((t) => t !== 'camp' && t !== 'peddler')) errs.push('col7');

  // Paths.
  const paths = allPaths(map);
  let eliteFree = false;
  for (const p of paths) {
    const cols26 = p.map((id) => map.nodes[id]).filter((n) => n.col >= 2 && n.col <= 6);
    if (cols26.length !== 5) errs.push('path length');
    const combat = cols26.filter((n) => COMBAT.has(n.type)).length;
    if (combat < 3 || combat > 4) errs.push(`path combat ${combat}`);
    if (!p.some((id) => map.nodes[id].type === 'elite')) eliteFree = true;
  }
  if (!eliteFree) errs.push('no elite-free path');

  // Battle node rolls.
  const seeds = new Set<number>();
  for (const n of nodes) {
    const isBattle = n.type === 'battle' || n.type === 'elite' || n.type === 'boss';
    if (isBattle !== !!n.battle) errs.push(`battle info ${n.id}`);
    if (!n.battle) continue;
    const b = n.battle;
    seeds.add(b.seed);
    if (n.type === 'boss') continue;
    if (b.depth !== n.col) errs.push(`depth ${n.id}`);
    const threat = Math.ceil(b.depth * 0.6) + (n.type === 'elite' ? 1 : 0);
    if (b.threat !== threat) errs.push(`threat ${n.id} ${b.threat} vs ${threat}`);
    if (!BIOMES_BY_COL[n.col].includes(b.biome)) errs.push(`biome ${n.id} ${b.biome}`);
    if (n.type === 'elite' && b.objective !== 'elite') errs.push('elite objective');
    const allowed = BEACONS_ENABLED ? ['raze', 'holdfast', 'beacons'] : ['raze', 'holdfast'];
    if (n.type === 'battle' && n.col > 1 && !allowed.includes(b.objective)) errs.push(`objective ${b.objective}`);
    if (new Set(b.modifiers).size !== b.modifiers.length) errs.push('dup modifiers');
    const extra = n.type === 'elite' ? 1 : 0;
    const maxMods = (n.col <= 4 ? 1 : 2) + extra;
    const minMods = (n.col >= 5 ? 1 : 0) + extra;
    if (n.col === 1 && b.modifiers.length) errs.push('col1 mods');
    if (b.modifiers.length > maxMods || b.modifiers.length < minMods) errs.push(`mods count ${n.id} ${b.modifiers.length}`);
    if (n.type === 'elite' && !b.modifiers.some((m) => NEGATIVE_MODIFIERS.includes(m))) errs.push('elite negative');
    if (DOCTRINES[b.doctrine].fromDepth > b.depth) errs.push(`doctrine ${b.doctrine} at d${b.depth}`);
    if (b.modifiers.includes('swift_hunt') && b.doctrine !== 'hunt') errs.push('swift hunt doctrine');
    if (n.type === 'elite' && b.reward !== 'boon') errs.push('elite reward');
  }
  if (seeds.size !== nodes.filter((n) => n.battle).length) errs.push('node seeds collide');
  return errs;
}

describe('run map generation (§B)', () => {
  it('1000 generated maps satisfy every rule', () => {
    let fallbacks = 0;
    const failures: string[] = [];
    for (let seed = 1; seed <= 1000; seed++) {
      const g = generateRunMap(seed * 7919);
      if (g.typeFallback || g.layoutFallback) fallbacks++;
      const errs = [...checkMap(g.map), ...runMapViolations(g.map)];
      if (errs.length) failures.push(`seed ${seed * 7919}: ${errs.slice(0, 3).join('; ')}`);
    }
    expect(failures).toEqual([]);
    // Rolled assignments should almost always succeed without the fixed fallback pattern.
    expect(fallbacks).toBeLessThan(30);
  });

  it('fallback layout and fallback types also satisfy every rule', () => {
    for (const f of [{ layout: true }, { types: true }, { layout: true, types: true }]) {
      for (let seed = 1; seed <= 50; seed++) {
        const g = generateRunMap(seed, { forceFallback: f });
        expect([...checkMap(g.map), ...runMapViolations(g.map)]).toEqual([]);
      }
    }
    const g = generateRunMap(3, { forceFallback: { layout: true } });
    for (let c = 2; c <= 7; c++) expect(g.map.columns[c - 1]).toHaveLength(3);
  });

  it('is deterministic per seed and varies across seeds', () => {
    expect(JSON.stringify(generateRunMap(42).map)).toBe(JSON.stringify(generateRunMap(42).map));
    expect(JSON.stringify(generateRunMap(42).map)).not.toBe(JSON.stringify(generateRunMap(43).map));
  });

  it('roll distributions follow the §B / §K weights', () => {
    const obj: Record<string, number> = {};
    const reward: Record<string, number> = {};
    let col2Mods = 0;
    let col2Battles = 0;
    let col56Second = 0;
    let col56Battles = 0;
    let fen34 = 0;
    let n34 = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      const { map } = generateRunMap(seed, { beacons: false });
      for (const n of Object.values(map.nodes)) {
        if (n.type !== 'battle' || n.col === 1) continue;
        const b = n.battle!;
        obj[b.objective] = (obj[b.objective] ?? 0) + 1;
        reward[b.reward] = (reward[b.reward] ?? 0) + 1;
        if (n.col === 2) {
          col2Battles++;
          if (b.modifiers.length) col2Mods++;
        }
        if (n.col >= 5) {
          col56Battles++;
          if (b.modifiers.length === 2) col56Second++;
        }
        if (n.col === 3 || n.col === 4) {
          n34++;
          if (b.biome === 'fenreach') fen34++;
        }
      }
    }
    const total = (rec: Record<string, number>) => Object.values(rec).reduce((a, b) => a + b, 0);
    // Integrator: Beacons verified end to end (tests/integration), so the default table includes them.
    expect(BEACONS_ENABLED).toBe(true);
    expect(obj.beacons ?? 0).toBe(0);
    expect(obj.raze / total(obj)).toBeCloseTo(0.65, 1);
    expect(reward.boon / total(reward)).toBeCloseTo(0.55, 1);
    expect(reward.draft / total(reward)).toBeCloseTo(0.25, 1);
    expect(reward.spoils / total(reward)).toBeCloseTo(0.2, 1);
    expect(col2Mods / col2Battles).toBeCloseTo(0.3, 1);
    expect(col56Second / col56Battles).toBeCloseTo(0.3, 1);
    expect(fen34 / n34).toBeCloseTo(0.7, 1);
  });

  it('includes Beacons at 50/25/25 when enabled', () => {
    const obj: Record<string, number> = {};
    for (let seed = 1; seed <= 800; seed++) {
      const { map } = generateRunMap(seed, { beacons: true });
      for (const n of Object.values(map.nodes)) {
        if (n.type === 'battle' && n.col > 1) obj[n.battle!.objective] = (obj[n.battle!.objective] ?? 0) + 1;
      }
    }
    const t = Object.values(obj).reduce((a, b) => a + b, 0);
    expect(obj.raze / t).toBeCloseTo(0.5, 1);
    expect(obj.holdfast / t).toBeCloseTo(0.25, 1);
    expect(obj.beacons / t).toBeCloseTo(0.25, 1);
  });

  it('every modifier can appear and Elites always carry a negative one', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const { map } = generateRunMap(seed);
      for (const n of Object.values(map.nodes)) for (const m of n.battle?.modifiers ?? []) seen.add(m);
    }
    expect([...seen].sort()).toEqual(Object.keys(MODIFIERS).sort());
  });
});
