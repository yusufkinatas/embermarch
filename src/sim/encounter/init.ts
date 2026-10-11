/**
 * initEncounter: build world.encounter and place every enemy / neutral structure and standing
 * force from world.anchors (§C, §I, §J, §K boss template), plus the initial Blight and ward grid.
 */
import {
  BOSS,
  DEPTH,
  GARRISON,
  LURKERS,
  MODIFIER_NUMBERS,
  THORNSPIRE,
  ancientCacheGuardValue,
  beaconGuardValue,
  cacheGuardValue,
  garrisonValue,
  nestHp,
  picketValue,
} from '../../data/balance';
import { thornboundFor } from '../../data/meta';
import { spawnBuilding } from '../entities';
import { ENEMY, NEUTRAL, type EnemyUnitId, type ModifierId, type World } from '../types';
import { addBlightSource, buildCanBlight, recomputeWard } from './blight';
import { composeGarrison } from './nests';
import { bossSchedule, compassDir, composeStanding, isAscendantObjective, resolvePrimaryDoctrine, standardSchedule, standingWeights } from './formulas';
import { centerOf, dist, hearth, isWalkableTile } from './geom';
import { spawnRegent } from './boss';
import { spawnLord } from './noble';
import { spawnStandingGroup } from './spawn';
import type { EncMods, EncRuntime, NestRec } from './state';
import { NOT_SPENT } from './formulas';

function modsOf(list: readonly ModifierId[]): EncMods {
  const has = (m: ModifierId) => list.includes(m);
  return {
    bloodMoon: has('blood_moon'),
    thickFog: has('thick_fog'),
    bountiful: has('bountiful_wilds'),
    creeping: has('creeping_wake'),
    fortified: has('fortified_nests'),
    swiftHunt: has('swift_hunt'),
    ancientCache: has('ancient_cache'),
  };
}

function standingTypes(st: EncRuntime, value: number): EnemyUnitId[] {
  return composeStanding(st.rng, value, standingWeights(st.doctrine, Math.min(st.depth, 7))).types;
}

/** A free 1×1 tile 2.6-4 tiles from a Nest center for an extra Thornspire. */
function extraSpireTile(world: World, st: EncRuntime, nest: NestRec): { tx: number; ty: number } | null {
  const cands: { tx: number; ty: number }[] = [];
  const occ = world.grid?.occupant;
  const R = THORNSPIRE.placeRadius;
  for (let ty = Math.floor(nest.cy - R); ty <= Math.ceil(nest.cy + R); ty++) {
    for (let tx = Math.floor(nest.cx - R); tx <= Math.ceil(nest.cx + R); tx++) {
      const d = dist(tx + 0.5, ty + 0.5, nest.cx, nest.cy);
      if (d < 2.6 || d > R) continue;
      if (!isWalkableTile(world, tx, ty)) continue;
      if (occ && occ[ty * world.map.w + tx] !== 0) continue;
      if (dist(tx + 0.5, ty + 0.5, nest.musterX, nest.musterY) < 2.5) continue;
      let clash = false;
      for (const id of nest.spires) {
        const s = world.entities.get(id);
        if (s && s.kind === 'building' && Math.abs(s.tx - tx) <= 1 && Math.abs(s.ty - ty) <= 1) clash = true;
      }
      if (!clash) cands.push({ tx, ty });
    }
  }
  return cands.length > 0 ? st.rng.pick(cands) : null;
}

export function initEncounter(world: World): void {
  const setup = world.setup;
  const objective = setup.objective;
  const isBoss = objective === 'boss';
  const depth = isBoss ? 7 : Math.max(1, Math.min(DEPTH.maxDepth, setup.depth));
  const mods = isBoss ? modsOf([]) : modsOf(setup.modifiers);
  const tb = thornboundFor(setup.tier);
  const h = hearth(world);
  const hc = h ? centerOf(h) : { x: world.anchors.hearth.tx + 2, y: world.anchors.hearth.ty + 2 };

  const st: EncRuntime = {
    ready: true,
    objective,
    doctrine: resolvePrimaryDoctrine(setup.doctrine, Math.min(depth, 7), mods.swiftHunt),
    depth,
    rng: world.rng.fork('encounter'),
    mods,
    tier: { nestHpMult: tb.nestHpMult, t1Delta: tb.t1Delta, garrisonAdd: tb.garrisonAdd },
    coldWatchfire: !!setup.coldWatchfire,
    doctrineSeen: !!setup.coldWatchfire,
    hearthX: hc.x,
    hearthY: hc.y,
    nests: [],
    nestsTotal: 0,
    schedule: null,
    nextN: 1,
    nextLaunch: Infinity,
    rotation: 0,
    waves: [],
    waveUid: 0,
    waveBank: 0,
    wavesLaunched: 0,
    raids: [],
    ascendant: false,
    ascendantWarned: false,
    cleanup: false,
    revealed: [],
    blight: [],
    canBlight: buildCanBlight(world),
    blightDirty: true,
    witherTimer: 0,
    pickets: [],
    caches: [],
    beacons: [],
    kindling: 0,
    lord: null,
    boss: null,
    plunder: { crowns: 0, nestsDestroyed: 0, picketsDestroyed: 0, cachesLooted: 0, ancientLooted: false, lordSlain: false, regentSlain: false },
    buildingLost: false,
    pendingDeaths: [],
    withering: [],
    victoryTime: -1,
    playerUnits: [],
  };
  world.encounter = st;
  const used = new Map<number, number>();
  const anchors = world.anchors;

  // Nests / Root Hearts.
  anchors.nests.forEach((p, i) => {
    const b = spawnBuilding(world, isBoss ? 'root_heart' : 'thorn_nest', ENEMY, p.tx, p.ty);
    const baseHp = isBoss ? BOSS.heartHp : nestHp(depth) * (mods.fortified ? MODIFIER_NUMBERS.fortifiedNestHpMult : 1);
    b.maxHp = Math.round(baseHp * tb.nestHpMult);
    b.hp = b.maxHp;
    const c = centerOf(b);
    let mp = anchors.musterPoints[i];
    if (!mp) {
      const dx = hc.x - c.x;
      const dy = hc.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      mp = { x: c.x + (dx / len) * 4.5, y: c.y + (dy / len) * 4.5 };
    }
    b.nest = { index: i, spent: false, spentUntil: -1, blightRadius: 0, seen: st.coldWatchfire, musterProgress: 0 };
    const rec: NestRec = {
      id: b.id,
      b,
      index: i,
      kind: isBoss ? 'heart' : 'nest',
      cx: c.x,
      cy: c.y,
      musterX: mp.x,
      musterY: mp.y,
      alive: true,
      dir: compassDir(hc.x, hc.y, c.x, c.y),
      garrisonCap: isBoss ? BOSS.heartGarrisonValue : garrisonValue(depth) + tb.garrisonAdd,
      garrison: [],
      regenTimer: 0,
      regenInterval: isBoss ? BOSS.heartGarrisonRegenInterval : GARRISON.regenInterval,
      regenBank: 0,
      regenNext: null,
      spires: [],
      spent: { ...NOT_SPENT },
      retaliateTick: 0,
      diedTick: -1,
    };
    st.nests.push(rec);
    const src = addBlightSource(world, st, b.id, c.x, c.y);
    b.nest.blightRadius = src.radius;
  });
  st.nestsTotal = st.nests.length;

  // Thornspires (1 per Nest, +1 under Fortified Nests).
  for (const s of anchors.nestSpires) {
    const nest = st.nests[s.nestIndex];
    if (!nest) continue;
    const b = spawnBuilding(world, 'thornspire', ENEMY, s.tx, s.ty);
    nest.spires.push(b.id);
  }
  const wantSpires = THORNSPIRE.perNest + (mods.fortified ? THORNSPIRE.fortifiedExtra : 0);
  for (const nest of st.nests) {
    let guard = 0;
    while (nest.spires.length < wantSpires && guard++ < 4) {
      const t = extraSpireTile(world, st, nest);
      if (!t) break;
      nest.spires.push(spawnBuilding(world, 'thornspire', ENEMY, t.tx, t.ty).id);
    }
  }

  // Garrisons.
  for (const nest of st.nests) {
    const types = composeGarrison(st, nest.garrisonCap);
    nest.garrison = spawnStandingGroup(world, st, {
      role: 'garrison',
      types,
      cx: nest.cx,
      cy: nest.cy,
      ringR: 3.2,
      leash: GARRISON.leashRadius,
      aggro: GARRISON.aggroRadius,
      nestId: nest.id,
      used,
    });
  }

  // Bramble Pickets (Thornspire + guard).
  const pv = isBoss ? BOSS.picketGuardValue : picketValue(depth);
  for (const p of anchors.pickets) {
    const spire = spawnBuilding(world, 'thornspire', ENEMY, p.tx, p.ty);
    const c = centerOf(spire);
    const guards = spawnStandingGroup(world, st, {
      role: 'picket',
      types: standingTypes(st, pv),
      cx: c.x,
      cy: c.y,
      ringR: 1.8,
      leash: GARRISON.leashRadius,
      aggro: GARRISON.aggroRadius,
      used,
    });
    st.pickets.push({ spireId: spire.id, x: c.x, y: c.y, guards, cleared: false });
  }

  // Caches guarded by Lurkers.
  for (const cpos of anchors.caches) {
    const ancient = cpos.type === 'ancient_cache';
    const b = spawnBuilding(world, cpos.type, NEUTRAL, cpos.tx, cpos.ty);
    b.object = { kind: 'cache', done: false, progress: 0, lit: false, ancient, seen: st.coldWatchfire };
    const c = centerOf(b);
    const value = ancient ? ancientCacheGuardValue(depth) : cacheGuardValue(depth);
    const guards = spawnStandingGroup(world, st, {
      role: 'lurker',
      types: standingTypes(st, value),
      cx: c.x,
      cy: c.y,
      ringR: 1.8,
      leash: LURKERS.leash,
      aggro: LURKERS.leash - 2,
      used,
    });
    st.caches.push({ id: b.id, b, ancient, x: c.x, y: c.y, guards, looted: false });
  }

  // Beacon Stones (Beacons objective).
  if (objective === 'beacons') {
    for (const bp of anchors.beacons) {
      const b = spawnBuilding(world, 'beacon_stone', NEUTRAL, bp.tx, bp.ty);
      b.object = { kind: 'beacon', done: false, progress: 0, lit: false, dormant: true, seen: st.coldWatchfire };
      const c = centerOf(b);
      const guards = spawnStandingGroup(world, st, {
        role: 'beacon_guard',
        types: standingTypes(st, beaconGuardValue(depth)),
        cx: c.x,
        cy: c.y,
        ringR: 2.2,
        leash: LURKERS.leash,
        aggro: LURKERS.leash - 2,
        used,
      });
      st.beacons.push({ id: b.id, b, x: c.x, y: c.y, guards, lit: false, capture: 0, snuff: 0, emberAcc: 0 });
    }
  }

  // Boss: Briar Throne + Regent. Elite: the Antlered Lord.
  if (isBoss && anchors.throne) {
    const throne = spawnBuilding(world, 'briar_throne', ENEMY, anchors.throne.tx, anchors.throne.ty);
    throne.object = { kind: 'throne', done: false, progress: 0, lit: false };
    spawnRegent(world, st, throne);
  }
  if (objective === 'elite') spawnLord(world, st);

  // Wave timeline.
  if (objective === 'holdfast') {
    st.schedule = null;
  } else if (isBoss) {
    st.schedule = bossSchedule(tb.t1Delta);
  } else {
    st.schedule = standardSchedule(depth, { t1Delta: tb.t1Delta, bountiful: mods.bountiful, ascendant: isAscendantObjective(objective) });
  }
  if (st.schedule) st.nextLaunch = st.schedule.t1;

  // Initial Blight and ward grid.
  recomputeWard(world, st);
}
