/** Boss map: the hand-authored Heartwood template invariants (GDD §K "Boss template"). */
import { describe, expect, it } from 'vitest';
import { BOSS_MAP } from '../../src/data/balance';
import { BUILDINGS } from '../../src/data/buildings';
import { generateAttempt, generateMapDetailed } from '../../src/mapgen';
import { distToPolyline, pointAlong, polylineLength } from '../../src/mapgen/geom';
import { Terrain } from '../../src/sim/types';
import type { MapGenResult } from '../../src/mapgen';
import { SWEEP_SEEDS, auditMap, sweepParams } from './helpers';

const H = BOSS_MAP.hearthCenter;
const T = BOSS_MAP.throneCenter;
const CORE = BOSS_MAP.laneWidth / 2;
const WALL = CORE + BOSS_MAP.wallThickness;

function templateProblems(res: MapGenResult): string[] {
  const out: string[] = [];
  const { gen, report } = res;
  const { w, h, terrain } = gen.map;
  const a = gen.anchors;
  const lanes = report.lanes ?? [];
  if (lanes.length !== 3) return ['expected 3 lanes'];

  // Plazas and anchors.
  const hc = { x: a.hearth.tx + BUILDINGS.hearth.w / 2, y: a.hearth.ty + BUILDINGS.hearth.h / 2 };
  if (hc.x !== H.x || hc.y !== H.y) out.push('Hearth center');
  if (!a.throne) return [...out, 'no throne'];
  const tc = { x: a.throne.tx + BUILDINGS.briar_throne.w / 2, y: a.throne.ty + BUILDINGS.briar_throne.h / 2 };
  if (Math.hypot(tc.x - T.x, tc.y - T.y) > 1) out.push('Throne center');

  // Root Hearts: 16-22 from the Throne, at -40/0/+40 degrees around the Throne→Hearth axis.
  const axis = Math.atan2(H.y - T.y, H.x - T.x);
  const angles = a.nests
    .map((n) => {
      const c = { x: n.tx + 1.5, y: n.ty + 1.5 };
      const d = Math.hypot(c.x - T.x, c.y - T.y);
      if (d < BOSS_MAP.heartDistMin || d > BOSS_MAP.heartDistMax) out.push(`heart distance ${d.toFixed(1)}`);
      let ang = ((Math.atan2(c.y - T.y, c.x - T.x) - axis) * 180) / Math.PI;
      ang = ((ang + 540) % 360) - 180;
      return ang;
    })
    .sort((x, y) => x - y);
  BOSS_MAP.heartAngles.forEach((want, i) => {
    if (Math.abs(angles[i] - want) > 6) out.push(`heart angle ${angles[i].toFixed(1)} vs ${want}`);
  });

  const inPlaza = (x: number, y: number): boolean =>
    Math.hypot(x - H.x, y - H.y) <= BOSS_MAP.hearthPlaza || Math.hypot(x - T.x, y - T.y) <= BOSS_MAP.thronePlaza;
  let laneBlocked = 0;
  let wallMissing = 0;
  let offLaneOpen = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = terrain[y * w + x];
      if (t === Terrain.Water || t === Terrain.Shallows) out.push(`water at ${x},${y}`);
      const px = x + 0.5;
      const py = y + 0.5;
      const dl = Math.min(...lanes.map((l) => distToPolyline(px, py, l)));
      if (inPlaza(px, py)) {
        if (t !== Terrain.Grass) laneBlocked++;
      } else if (dl <= CORE - 0.1) {
        // Lane cores are 7 wide and open.
        if (t !== Terrain.Grass) laneBlocked++;
      } else if (dl > CORE + 0.1 && dl < WALL - 0.1) {
        // A 3-thick briar band flanks every lane.
        if (t !== Terrain.BriarWall) wallMissing++;
      } else if (dl > WALL + 0.1 && Math.hypot(px - H.x, py - H.y) > 16) {
        // Off-lane fill: forest and rock only.
        if (t !== Terrain.Forest && t !== Terrain.Rock) offLaneOpen++;
      }
    }
  }
  if (laneBlocked) out.push(`${laneBlocked} lane/plaza tiles not grass`);
  if (wallMissing) out.push(`${wallMissing} wall-band tiles not briar`);
  if (offLaneOpen) out.push(`${offLaneOpen} off-lane tiles open`);

  // Pickets guard contested Seams at the midpoints of the two side lanes.
  // Side lanes are [Hearth, bend, Heart, Throne]; the middle lane is [Hearth, Heart, Throne].
  const mids = lanes
    .filter((l) => l.length === 4)
    .map((l) => l.slice(0, 3))
    .map((l) => pointAlong(l, polylineLength(l) / 2));
  if (mids.length !== 2) out.push('expected 2 side lanes');
  for (const p of a.pickets) {
    const near = Math.min(...mids.map((m) => Math.hypot(p.tx + 0.5 - m.x, p.ty + 0.5 - m.y)));
    if (near > 7) out.push(`picket ${near.toFixed(1)} from a side-lane midpoint`);
  }

  // Path bands: nearest Heart 34-40, side Hearts 40-46.
  const paths = report.validation.nestPaths.slice().sort((x, y) => x - y);
  if (!(paths[0] >= BOSS_MAP.nearHeartPath.min && paths[0] <= BOSS_MAP.nearHeartPath.max)) out.push(`near path ${paths[0]}`);
  for (const p of paths.slice(1)) if (!(p >= BOSS_MAP.sideHeartPath.min && p <= BOSS_MAP.sideHeartPath.max)) out.push(`side path ${p}`);
  return out;
}

describe('boss template', () => {
  it(`${SWEEP_SEEDS} seeds: valid, reachable, template invariants hold`, () => {
    for (let i = 0; i < SWEEP_SEEDS; i++) {
      const params = sweepParams('boss', 'heartwood', i);
      const res = generateMapDetailed(params);
      auditMap(res, params);
      expect(templateProblems(res), `seed ${params.seed}`).toEqual([]);
      expect(res.gen.anchors.throne).toBeDefined();
      expect(res.gen.anchors.beacons).toEqual([]);
    }
  }, 120_000);

  it('the fixed fallback layout satisfies the template too', () => {
    let ok = 0;
    for (let sub = 0; sub < 20; sub++) {
      const { result } = generateAttempt({ seed: 99, objective: 'boss', biome: 'heartwood', depth: 7, modifiers: [] }, sub, true);
      if (result && result.report.validation.ok) {
        ok++;
        expect(templateProblems(result)).toEqual([]);
      }
    }
    expect(ok).toBeGreaterThanOrEqual(15);
  });
});
