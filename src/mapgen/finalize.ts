/** Assemble the GameMap + MapAnchors from a finished attempt and validate it (step 8). */
import { FAIRNESS_KIT } from '../data/balance';
import { BIOMES } from '../data/biomes';
import { Terrain } from '../sim/types';
import type { GeneratedMap, MapAnchors } from '../sim/types';
import type { GenCtx, KitReport } from './ctx';
import type { Pt } from './geom';
import { countForestRing } from './place';
import { type ValidationReport, checkMap } from './validate';

export interface MapGenReport {
  kit: KitReport;
  validation: ValidationReport;
  /** Boss map only: lane polylines (Hearth → [bend] → Root Heart → Throne) in tile coordinates. */
  lanes?: Pt[][];
}

export interface MapGenResult {
  gen: GeneratedMap;
  report: MapGenReport;
}

export function finalize(ctx: GenCtx, kit: KitReport, lanes?: Pt[][]): MapGenResult | null {
  const { params } = ctx;
  if (!ctx.hearth || !ctx.vanguard) return null;
  const biome = BIOMES[params.biome];
  const treeAmount = new Uint16Array(ctx.n);
  for (let i = 0; i < ctx.n; i++) if (ctx.terrain[i] === Terrain.Forest) treeAmount[i] = biome.treeAmount;
  const vrng = ctx.rng.fork('variant');
  const variant = new Uint8Array(ctx.n);
  for (let i = 0; i < ctx.n; i++) variant[i] = Math.floor(vrng.next() * 256);

  const v = ctx.vanguard;
  const anchors: MapAnchors = {
    hearth: { tx: ctx.hearth.tx, ty: ctx.hearth.ty },
    nests: ctx.nests.map((n) => ({ tx: n.tx, ty: n.ty })),
    nestSpires: ctx.spires.map((s) => ({ ...s })),
    spareSpires: ctx.spareSpires.map((s) => ({ ...s })),
    pickets: ctx.pickets.map((p) => ({ ...p })),
    resources: ctx.resources.map((r) => ({ ...r })),
    caches: ctx.caches.map((c) => ({ ...c })),
    beacons: ctx.beacons.map((b) => ({ tx: b.tx, ty: b.ty })),
    vanguard: {
      muster_hall: { ...v.military },
      bowyard: { ...v.military },
      storehouse: { ...v.storehouse },
      grainplot: { ...v.grainplot },
    },
    watchtowers: ctx.watchtowers.map((t) => ({ ...t })),
    musterPoints: ctx.musterPoints.map((m) => ({ ...m })),
  };
  if (ctx.throne) anchors.throne = { tx: ctx.throne.tx, ty: ctx.throne.ty };

  const gen: GeneratedMap = {
    map: { w: ctx.w, h: ctx.h, biome: params.biome, terrain: ctx.terrain.slice(), treeAmount, variant },
    anchors,
    seed: params.seed,
    attempts: 1,
    usedFallback: false,
  };
  const F = FAIRNESS_KIT.forest;
  kit.forestRing = countForestRing(ctx.terrain, ctx.w, ctx.h, ctx.hc, F.ringMin, F.ringMax);
  const validation = checkMap(gen, params, kit);
  return { gen, report: { kit, validation, lanes } };
}
