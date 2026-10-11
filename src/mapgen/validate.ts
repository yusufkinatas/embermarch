/**
 * Step 8 validation, computed purely from a GeneratedMap (independent of generation state)
 * so the generator and the tests share one source of truth.
 */
import {
  BEACONS,
  BOSS_MAP,
  CACHES,
  FAIRNESS_KIT,
  MAPGEN,
  OBJECTIVE_ANCHORS,
  THORNSPIRE,
  cacheCount,
  nestsFor,
} from '../data/balance';
import { BUILDINGS } from '../data/buildings';
import { RESOURCE_NODES, SEAM_AMOUNTS } from '../data/resources';
import { Terrain } from '../sim/types';
import type { GeneratedMap, MapGenParams, TilePos } from '../sim/types';
import type { KitReport } from './ctx';
import { isWalkableTerrain } from './ctx';
import { type Pt, angleDiff, rectCenter } from './geom';
import { astar, edgeRing, floodFill, smoothedLength } from './paths';

export interface AnchorFoot {
  label: string;
  tx: number;
  ty: number;
  w: number;
  h: number;
}

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  /** Walking distance (A* path, string-pulled) from the Hearth center to each Nest center (Infinity if unreachable). */
  nestPaths: number[];
  reachableTrees: number;
  walkableFrac: number;
  forestRing: number;
}

const B = BUILDINGS;

/** Every footprint described by the anchors (the Bowyard shares the Muster Hall site). */
export function anchorFootprints(gen: GeneratedMap): AnchorFoot[] {
  const a = gen.anchors;
  const out: AnchorFoot[] = [];
  const add = (label: string, p: TilePos, w: number, h: number): void => {
    out.push({ label, tx: p.tx, ty: p.ty, w, h });
  };
  add('hearth', a.hearth, B.hearth.w, B.hearth.h);
  const nestDef = gen.map.w === BOSS_MAP.size && a.throne ? B.root_heart : B.thorn_nest;
  a.nests.forEach((n, i) => add(`nest${i}`, n, nestDef.w, nestDef.h));
  a.nestSpires.forEach((s, i) => add(`spire${i}`, s, B.thornspire.w, B.thornspire.h));
  (a.spareSpires ?? []).forEach((s, i) => add(`spareSpire${i}`, s, B.thornspire.w, B.thornspire.h));
  a.pickets.forEach((p, i) => add(`picket${i}`, p, B.thornspire.w, B.thornspire.h));
  a.resources.forEach((r, i) => add(`${r.type}${i}`, r, RESOURCE_NODES[r.type].w, RESOURCE_NODES[r.type].h));
  a.caches.forEach((c, i) => add(`${c.type}${i}`, c, B[c.type].w, B[c.type].h));
  a.beacons.forEach((b, i) => add(`beacon${i}`, b, B.beacon_stone.w, B.beacon_stone.h));
  add('vanguard_military', a.vanguard.muster_hall, Math.max(B.muster_hall.w, B.bowyard.w), Math.max(B.muster_hall.h, B.bowyard.h));
  add('vanguard_storehouse', a.vanguard.storehouse, B.storehouse.w, B.storehouse.h);
  add('vanguard_grainplot', a.vanguard.grainplot, B.grainplot.w, B.grainplot.h);
  a.watchtowers.forEach((t, i) => add(`watchtower${i}`, t, B.brazier_tower.w, B.brazier_tower.h));
  if (a.throne) add('throne', a.throne, B.briar_throne.w, B.briar_throne.h);
  return out;
}

export function footCenter(f: { tx: number; ty: number; w: number; h: number }): Pt {
  return rectCenter(f.tx, f.ty, f.w, f.h);
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance of c from the map edge opposite the one the Hearth sits on (Beacons objective). */
export function farEdgeDistance(hc: Pt, S: number, c: Pt): number {
  const dx = hc.x - S / 2;
  const dy = hc.y - S / 2;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? S - c.y : c.y;
  return dx < 0 ? S - c.x : c.x;
}

/** Reachable timber: tiles of 4-connected forest components that touch a reachable tile. */
export function reachableTrees(terrain: Uint8Array, w: number, h: number, reach: Uint8Array): number {
  const n = w * h;
  const comp = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const touches: boolean[] = [];
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (terrain[s] !== Terrain.Forest || comp[s] >= 0) continue;
    const id = sizes.length;
    sizes.push(0);
    touches.push(false);
    comp[s] = id;
    stack.push(s);
    while (stack.length) {
      const cur = stack.pop() as number;
      sizes[id]++;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const nb = [cx > 0 ? cur - 1 : -1, cx < w - 1 ? cur + 1 : -1, cy > 0 ? cur - w : -1, cy < h - 1 ? cur + w : -1];
      for (const j of nb) {
        if (j < 0) continue;
        if (reach[j]) touches[id] = true;
        if (terrain[j] === Terrain.Forest && comp[j] < 0) {
          comp[j] = id;
          stack.push(j);
        }
      }
    }
  }
  let total = 0;
  for (let i = 0; i < sizes.length; i++) if (touches[i]) total += sizes[i];
  return total;
}

/** Validate a generated map against GDD §K steps 3-8 and the fairness kit. */
export function checkMap(gen: GeneratedMap, params: MapGenParams, kit?: KitReport): ValidationReport {
  const errors: string[] = [];
  const err = (m: string): void => {
    errors.push(m);
  };
  const rule = OBJECTIVE_ANCHORS[params.objective];
  const boss = params.objective === 'boss';
  const { map, anchors: a } = gen;
  const { w, h } = map;
  const n = w * h;
  const report: ValidationReport = { ok: false, errors, nestPaths: [], reachableTrees: 0, walkableFrac: 0, forestRing: 0 };
  if (w !== rule.size || h !== rule.size) err(`map size ${w}x${h} != ${rule.size}`);
  if (map.terrain.length !== n || map.treeAmount.length !== n || map.variant.length !== n) err('array sizes');

  // Footprints: inside the map, on grass, no overlaps.
  const feet = anchorFootprints(gen);
  const occ = new Int32Array(n);
  feet.forEach((f, k) => {
    for (let y = f.ty; y < f.ty + f.h; y++) {
      for (let x = f.tx; x < f.tx + f.w; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) {
          err(`${f.label} outside the map`);
          return;
        }
        const i = y * w + x;
        if (occ[i]) err(`${f.label} overlaps ${feet[occ[i] - 1].label}`);
        occ[i] = k + 1;
        const t = map.terrain[i];
        if (t !== Terrain.Grass && t !== Terrain.Stump) err(`${f.label} not on grass (terrain ${t})`);
      }
    }
  });
  if (errors.length) return report;

  // Reachability from the Hearth.
  const passable = (i: number): boolean => occ[i] === 0 && isWalkableTerrain(map.terrain[i]);
  const hearth = feet[0];
  const reach = floodFill(w, h, passable, edgeRing(w, h, hearth.tx, hearth.ty, hearth.w, hearth.h));
  for (const f of feet.slice(1)) {
    if (!edgeRing(w, h, f.tx, f.ty, f.w, f.h).some((i) => reach[i])) err(`${f.label} unreachable`);
  }
  if (a.musterPoints.length !== a.nests.length) err('muster point count');
  a.musterPoints.forEach((m, k) => {
    const i = Math.floor(m.y) * w + Math.floor(m.x);
    if (!reach[i]) err(`muster${k} unreachable`);
    const nest = feet.find((f) => f.label === `nest${k}`);
    if (nest) {
      const d = dist(m, footCenter(nest));
      if (d < 3.5 || d > 6.5) err(`muster${k} distance ${d.toFixed(1)} from its Nest`);
    }
  });

  // Hearth → Nest path lengths.
  const hc = footCenter(hearth);
  const start = Math.floor(hc.y) * w + Math.floor(hc.x);
  const nestFeet = feet.filter((f) => /^nest\d+$/.test(f.label));
  for (const nf of nestFeet) {
    const nc = footCenter(nf);
    const goal = Math.floor(nc.y) * w + Math.floor(nc.x);
    const hid = 1;
    const nid = feet.indexOf(nf) + 1;
    const open = (i: number): boolean => i >= 0 && i < n && (occ[i] === hid || occ[i] === nid || passable(i));
    const res = astar({
      w,
      h,
      start,
      isGoal: (i) => i === goal,
      hx: goal % w,
      hy: Math.floor(goal / w),
      noCornerCut: true,
      cost: (i) => (open(i) ? 1 : Infinity),
    });
    report.nestPaths.push(res ? smoothedLength(w, h, res.path, open, hc, nc) : Infinity);
  }
  const sortedPaths = report.nestPaths.slice().sort((x, y) => x - y);
  if (boss) {
    const [near, ...side] = sortedPaths;
    if (!(near >= BOSS_MAP.nearHeartPath.min && near <= BOSS_MAP.nearHeartPath.max)) err(`near Heart path ${near.toFixed(1)}`);
    for (const p of side) {
      if (!(p >= BOSS_MAP.sideHeartPath.min && p <= BOSS_MAP.sideHeartPath.max)) err(`side Heart path ${p.toFixed(1)}`);
    }
  } else if (sortedPaths.length) {
    const p = sortedPaths[0];
    if (!(p >= rule.pathMin && p <= rule.pathMax)) err(`nearest Nest path ${p.toFixed(1)} not in ${rule.pathMin}-${rule.pathMax}`);
  }

  // Timber, walkability, forest ring.
  report.reachableTrees = reachableTrees(map.terrain, w, h, reach);
  if (report.reachableTrees < rule.minReachableTrees) err(`reachable trees ${report.reachableTrees} < ${rule.minReachableTrees}`);
  let walk = 0;
  for (let i = 0; i < n; i++) if (isWalkableTerrain(map.terrain[i])) walk++;
  report.walkableFrac = walk / n;
  if (!boss && report.walkableFrac < MAPGEN.minWalkableFrac) err(`walkable ${(report.walkableFrac * 100).toFixed(0)}%`);
  const F = FAIRNESS_KIT.forest;
  let ring = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (map.terrain[y * w + x] !== Terrain.Forest) continue;
      const d = Math.hypot(x + 0.5 - hc.x, y + 0.5 - hc.y);
      if (d >= F.ringMin && d <= F.ringMax) ring++;
    }
  }
  report.forestRing = ring;
  if (ring < F.minTiles) err(`forest ring ${ring} < ${F.minTiles}`);
  for (let i = 0; i < n; i++) {
    const want = map.terrain[i] === Terrain.Forest;
    if (want !== map.treeAmount[i] > 0) {
      err('treeAmount does not match forest tiles');
      break;
    }
  }

  checkAnchors(gen, params, feet, hc, err);
  if (kit) checkKit(gen, params, kit, hc, err);
  report.ok = errors.length === 0;
  return report;
}

/** Objective-specific anchor rules (§K step 3, §C, §J, modifiers). */
function checkAnchors(gen: GeneratedMap, params: MapGenParams, feet: AnchorFoot[], hc: Pt, err: (m: string) => void): void {
  const a = gen.anchors;
  const rule = OBJECTIVE_ANCHORS[params.objective];
  const S = rule.size;
  const boss = params.objective === 'boss';
  const mods = new Set(params.modifiers);
  const nests = feet.filter((f) => /^nest\d+$/.test(f.label));
  const nestCenters = nests.map(footCenter);
  const wantNests = boss ? BOSS_MAP.heartAngles.length : nestsFor(params.objective, params.depth);
  if (nests.length !== wantNests) err(`nest count ${nests.length} != ${wantNests}`);

  // Hearth placement.
  if (boss) {
    if (hc.x !== BOSS_MAP.hearthCenter.x || hc.y !== BOSS_MAP.hearthCenter.y) err('boss Hearth center');
  } else if (rule.hearth === 'corner') {
    const ix = Math.min(hc.x, S - hc.x);
    const iy = Math.min(hc.y, S - hc.y);
    if (ix < rule.hearthInsetMin || ix > rule.hearthInsetMax || iy < rule.hearthInsetMin || iy > rule.hearthInsetMax) err('Hearth corner inset');
  } else if (rule.hearth === 'center') {
    if (hc.x !== S / 2 || hc.y !== S / 2) err('Hearth not centered');
  } else if (rule.hearth === 'edge_mid') {
    const onEdge =
      (hc.x === S / 2 && (hc.y === rule.hearthInsetMin || hc.y === S - rule.hearthInsetMin)) ||
      (hc.y === S / 2 && (hc.x === rule.hearthInsetMin || hc.x === S - rule.hearthInsetMin));
    if (!onEdge) err('Hearth not at an edge midpoint');
  }

  // Nests.
  if (!boss) {
    nestCenters.forEach((c, i) => {
      const d = dist(c, hc);
      if (d < rule.nestDistMin - 1e-6 || d > rule.nestDistMax + 1e-6) err(`nest${i} distance ${d.toFixed(1)}`);
      const nf = nests[i];
      if (nf.tx < rule.nestBorder || nf.ty < rule.nestBorder || nf.tx + nf.w > S - rule.nestBorder || nf.ty + nf.h > S - rule.nestBorder) {
        err(`nest${i} too close to the border`);
      }
      for (let j = 0; j < i; j++) if (dist(c, nestCenters[j]) < rule.nestMinApart) err(`nests ${j},${i} too close`);
      if (rule.nestFarEdge !== undefined && farEdgeDistance(hc, S, c) > rule.nestFarEdge) err(`nest${i} not on the far edge`);
    });
  } else {
    const tc = a.throne ? footCenter({ ...a.throne, w: B.briar_throne.w, h: B.briar_throne.h }) : null;
    if (!tc) err('boss throne missing');
    else {
      nestCenters.forEach((c, i) => {
        const d = Math.hypot(c.x - BOSS_MAP.throneCenter.x, c.y - BOSS_MAP.throneCenter.y);
        if (d < BOSS_MAP.heartDistMin - 1 || d > BOSS_MAP.heartDistMax + 1) err(`heart${i} distance ${d.toFixed(1)} from the Throne`);
      });
      if (dist(tc, BOSS_MAP.throneCenter) > 1) err('throne center');
    }
  }

  // Spires: exactly one per Nest within 4 tiles; spares likewise.
  const spireCheck = (list: (TilePos & { nestIndex: number })[], label: string): void => {
    for (let k = 0; k < nests.length; k++) {
      const mine = list.filter((s) => s.nestIndex === k);
      if (mine.length !== 1) err(`${label} count for nest${k}: ${mine.length}`);
      for (const s of mine) {
        const d = dist({ x: s.tx + 0.5, y: s.ty + 0.5 }, nestCenters[k]);
        if (d > THORNSPIRE.placeRadius + 1e-6) err(`${label} ${d.toFixed(1)} from nest${k}`);
      }
    }
  };
  spireCheck(a.nestSpires, 'spire');
  spireCheck(a.spareSpires ?? [], 'spareSpire');

  // Seams and Pickets.
  const famine = mods.has('ember_famine');
  const homes = a.resources.filter((r) => r.type === 'ember_seam' && r.home);
  const contested = a.resources.filter((r) => r.type === 'ember_seam' && r.contested);
  if (homes.length !== (famine ? 0 : 1)) err(`home seam count ${homes.length}`);
  for (const r of homes) {
    const d = dist(footCenter({ ...r, w: 2, h: 2 }), hc);
    if (d < FAIRNESS_KIT.homeSeam.min || d > FAIRNESS_KIT.homeSeam.max) err(`home seam distance ${d.toFixed(1)}`);
    if (r.amount !== SEAM_AMOUNTS.home) err('home seam amount');
  }
  if (contested.length !== rule.contestedSeams) err(`contested seams ${contested.length} != ${rule.contestedSeams}`);
  for (const r of contested) {
    if (r.amount !== (famine ? SEAM_AMOUNTS.contestedFamine : SEAM_AMOUNTS.contested)) err('contested seam amount');
    const c = footCenter({ ...r, w: 2, h: 2 });
    if (params.objective === 'holdfast') {
      const d = dist(c, hc);
      if (d < FAIRNESS_KIT.holdfastSeam.min || d > FAIRNESS_KIT.holdfastSeam.max) err(`holdfast seam distance ${d.toFixed(1)}`);
      if (nestCenters.some((nc) => dist(nc, c) < FAIRNESS_KIT.holdfastSeam.minFromNest)) err('holdfast seam too close to a Nest');
    } else if (!boss) {
      const dn = Math.min(...nestCenters.map((nc) => dist(nc, c)));
      if (dn < 10 || dn > 16) err(`contested seam ${dn.toFixed(1)} from its Nest`);
    }
  }
  if (a.pickets.length !== rule.pickets) err(`pickets ${a.pickets.length} != ${rule.pickets}`);
  for (const p of a.pickets) {
    const r = a.resources[p.seamIndex];
    if (!r || !r.contested) err('picket seamIndex does not point at a contested seam');
    else if (dist({ x: p.tx + 0.5, y: p.ty + 0.5 }, footCenter({ ...r, w: 2, h: 2 })) > 4) err('picket too far from its seam');
  }

  // Caches.
  const ruined = a.caches.filter((c) => c.type === 'ruined_cache');
  const ancient = a.caches.filter((c) => c.type === 'ancient_cache');
  const wantRuined = rule.caches ? cacheCount(params.depth) : 0;
  const wantAncient = rule.caches && mods.has('ancient_cache') ? 1 : 0;
  if (ruined.length !== wantRuined) err(`ruined caches ${ruined.length} != ${wantRuined}`);
  if (ancient.length !== wantAncient) err(`ancient caches ${ancient.length} != ${wantAncient}`);
  for (const c of a.caches) {
    const cc = { x: c.tx + 0.5, y: c.ty + 0.5 };
    const d = dist(cc, hc);
    if (c.type === 'ruined_cache' && d < CACHES.minFromHearth) err(`cache ${d.toFixed(1)} from the Hearth`);
    if (c.type === 'ancient_cache' && (d < CACHES.ancient.minFromHearth || d > CACHES.ancient.maxFromHearth)) err(`ancient cache ${d.toFixed(1)}`);
    if (nestCenters.some((nc) => dist(nc, cc) < CACHES.minFromNest)) err('cache too close to a Nest');
  }

  // Beacons.
  const wantBeacons = params.objective === 'beacons' ? BEACONS.count : 0;
  if (a.beacons.length !== wantBeacons) err(`beacons ${a.beacons.length} != ${wantBeacons}`);
  const bc = a.beacons.map((b) => footCenter({ ...b, w: 2, h: 2 }));
  bc.forEach((c, i) => {
    const d = dist(c, hc);
    if (d < BEACONS.minDist || d > BEACONS.maxDist) err(`beacon${i} distance ${d.toFixed(1)}`);
    for (let j = 0; j < i; j++) if (dist(c, bc[j]) < BEACONS.minApart) err(`beacons ${j},${i} too close`);
  });

  // Vanguard sites (validity = grass + no overlap, already checked) and Watchtowers.
  const V = FAIRNESS_KIT.vanguard;
  const v = a.vanguard;
  if (v.bowyard.tx !== v.muster_hall.tx || v.bowyard.ty !== v.muster_hall.ty) err('bowyard site differs from muster hall site');
  const nearest = nestCenters.length ? nestCenters.reduce((p, c) => (dist(c, hc) < dist(p, hc) ? c : p)) : hc;
  const nestDir = Math.atan2(nearest.y - hc.y, nearest.x - hc.x);
  const mil = footCenter({ ...v.muster_hall, w: 3, h: 3 });
  const dm = dist(mil, hc);
  if (dm < V.militaryMin || dm > V.militaryMax) err(`military site distance ${dm.toFixed(1)}`);
  if (Math.abs(angleDiff(Math.atan2(mil.y - hc.y, mil.x - hc.x), nestDir)) > Math.PI / 2) err('military site does not face the nearest Nest');
  const ds = dist(footCenter({ ...v.storehouse, w: 2, h: 2 }), hc);
  if (ds < V.storehouseMin || ds > V.storehouseMax) err(`storehouse site distance ${ds.toFixed(1)}`);
  const dg = dist(footCenter({ ...v.grainplot, w: 2, h: 2 }), hc);
  if (dg < V.grainplotMin || dg > V.grainplotMax) err(`grainplot site distance ${dg.toFixed(1)}`);
  const wantTowers = mods.has('old_watchtowers') ? FAIRNESS_KIT.watchtowers.count : 0;
  if (a.watchtowers.length !== wantTowers) err(`watchtowers ${a.watchtowers.length} != ${wantTowers}`);
  for (const t of a.watchtowers) {
    const c = footCenter({ ...t, w: 2, h: 2 });
    const d = dist(c, hc);
    if (d < FAIRNESS_KIT.watchtowers.min || d > FAIRNESS_KIT.watchtowers.max) err(`watchtower distance ${d.toFixed(1)}`);
    if (Math.abs(angleDiff(Math.atan2(c.y - hc.y, c.x - hc.x), nestDir)) > Math.PI / 2) err('watchtower not toward the nearest Nest');
  }
}

/** Fairness-kit counts and distance bands (needs the generator's kit report). */
function checkKit(gen: GeneratedMap, params: MapGenParams, kit: KitReport, hc: Pt, err: (m: string) => void): void {
  const res = gen.anchors.resources;
  const K = FAIRNESS_KIT;
  const thicketAt = (i: number): Pt | null => (res[i] && res[i].type === 'thicket' ? { x: res[i].tx + 0.5, y: res[i].ty + 0.5 } : null);
  const band = (idx: number[], min: number, max: number, label: string): void => {
    for (const i of idx) {
      const c = thicketAt(i);
      if (!c) {
        err(`${label}: resource ${i} is not a thicket`);
        continue;
      }
      const d = dist(c, hc);
      if (d < min - 1e-6 || d > max + 1e-6) err(`${label} thicket at ${d.toFixed(1)}`);
    }
  };
  const nearCount = params.biome === 'ashwood' ? K.nearThickets.ashwoodCount : K.nearThickets.count;
  if (kit.nearThickets.length !== nearCount) err(`near thickets ${kit.nearThickets.length} != ${nearCount}`);
  band(kit.nearThickets, K.nearThickets.min, K.nearThickets.max, 'near');
  const outerCount = K.outerThickets.count + (params.biome === 'greenmarch' ? K.outerThickets.greenmarchBonus : 0);
  if (kit.outerThickets.length !== outerCount) err(`outer thickets ${kit.outerThickets.length} != ${outerCount}`);
  band(kit.outerThickets, K.outerThickets.min, K.outerThickets.max, 'outer');
  if (kit.midClusters.length !== K.midThicketClusters.count) err('mid clusters count');
  for (const cl of kit.midClusters) {
    if (cl.length !== K.midThicketClusters.size) err('mid cluster size');
    const pts = cl.map(thicketAt).filter((p): p is Pt => p !== null);
    for (const p of pts) for (const q of pts) if (dist(p, q) > 4) err('mid cluster not compact');
  }
  const wantB = params.modifiers.includes('bountiful_wilds') ? K.bountiful.count : 0;
  if (kit.bountiful.length !== wantB) err(`bountiful thickets ${kit.bountiful.length} != ${wantB}`);
  band(kit.bountiful, K.bountiful.min, K.bountiful.max, 'bountiful');
  const thickets = res.filter((r) => r.type === 'thicket').length;
  const listed = kit.nearThickets.length + kit.outerThickets.length + kit.bountiful.length + kit.midClusters.reduce((s, c) => s + c.length, 0);
  if (thickets !== listed) err(`thicket total ${thickets} != kit ${listed}`);
}
