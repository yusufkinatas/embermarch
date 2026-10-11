/**
 * Procedural battle-map generation (GDD §K). OWNER: mapgen. Pure, deterministic, no DOM.
 *
 * Pipeline per attempt (seed = hash(params.seed, attempt)):
 *  1-2 noise terrain (water / shallows / forest / rock by quantile, forest automaton, lone water removed)
 *  3   anchors: Hearth, Nests, Beacons per the objective table
 *  4   clearings     5 corridors (A* with terrain costs, 3 wide)
 *      muster points + Nest spires
 *  6   fairness kit (forest ring, Vanguard sites, Watchtowers, Thickets, Seams, Pickets, Caches)
 *  7   connectivity (carve to anything unreachable)
 *  8   validation; on failure retry (attempt + 1, up to 20), then the fallback template.
 * The boss uses the hand-authored Heartwood template (boss.ts) through the same steps 6-8.
 */
import { Rng } from '../core/rng';
import { MAPGEN, OBJECTIVE_ANCHORS } from '../data/balance';
import { BIOMES } from '../data/biomes';
import type { GeneratedMap, MapGenParams } from '../sim/types';
import { carveCorridors, clearAnchors, placeBeacons, placeHearth, placeMusterAndSpires, placeNests } from './anchors';
import { bossAttempt } from './boss';
import { GenCtx } from './ctx';
import { type MapGenResult, finalize } from './finalize';
import { connectAndSettle, midAnchorHoldfast, midAnchorOpen, placeCorridorSeams, placeFairnessKit, placeHoldfastSeam } from './kit';
import { fallbackTerrain, noiseTerrain } from './terrain';

export { mapToAscii, ASCII_LEGEND } from './ascii';
export { checkMap, anchorFootprints } from './validate';
export type { ValidationReport, AnchorFoot } from './validate';
export type { MapGenResult, MapGenReport } from './finalize';
export type { KitReport } from './ctx';

/** Sub-attempts on the fallback template before giving up (the open template virtually always passes). */
const FALLBACK_TRIES = 64;

function standardAttempt(params: MapGenParams, rng: Rng, fallback: boolean, onFail: (ctx: GenCtx) => void): MapGenResult | null {
  const rule = OBJECTIVE_ANCHORS[params.objective];
  const S = rule.size;
  const ctx = new GenCtx(params, rule, S, rng);
  const res = runStandard(ctx, fallback);
  if (!res) onFail(ctx);
  return res;
}

function runStandard(ctx: GenCtx, fallback: boolean): MapGenResult | null {
  const { params, rule, rng } = ctx;
  const S = rule.size;
  ctx.terrain.set(fallback ? fallbackTerrain(S, S) : noiseTerrain(rng, S, S, BIOMES[params.biome]));
  const edge = placeHearth(ctx);
  if (!placeNests(ctx, edge, fallback ? rule.pathMin : 0)) return ctx.fail('nests');
  if (params.objective === 'beacons' && !placeBeacons(ctx)) return ctx.fail('beacons');
  clearAnchors(ctx);
  if (!carveCorridors(ctx)) return ctx.fail('corridors');
  if (!placeMusterAndSpires(ctx)) return ctx.fail('muster points / spires');
  const kit = placeFairnessKit(ctx, {
    contested: params.objective === 'holdfast' ? placeHoldfastSeam : placeCorridorSeams,
    midAnchor: rule.hearth === 'center' ? midAnchorHoldfast : midAnchorOpen,
    caches: rule.caches,
  });
  if (!kit) return null;
  const carves = connectAndSettle(ctx);
  if (carves === null) return null;
  kit.connectCarves = carves;
  return finalize(ctx, kit) ?? ctx.fail('finalize');
}

function attempt(params: MapGenParams, rng: Rng, fallback: boolean, trace?: (reason: string) => void): MapGenResult | null {
  const onFail = (ctx: GenCtx): void => {
    if (trace) trace(ctx.failReason || 'unknown');
  };
  const res = params.objective === 'boss' ? bossAttempt(params, rng, fallback, onFail) : standardAttempt(params, rng, fallback, onFail);
  if (res && !res.report.validation.ok && trace) trace(`invalid: ${res.report.validation.errors.join('; ')}`);
  return res;
}

/**
 * Debug / test helper: run one generation attempt (index `a`, or the fallback template with
 * sub-index `a`) and report why it failed.
 */
export function generateAttempt(params: MapGenParams, a: number, fallback = false): { result: MapGenResult | null; failure: string } {
  let failure = '';
  const rng = new Rng(fallback ? `mapgen:${params.seed >>> 0}:fallback:${a}` : `mapgen:${params.seed >>> 0}:${a}`);
  const result = attempt(params, rng, fallback, (r) => {
    failure = r;
  });
  return { result, failure };
}

/** Generate a map plus the generator's kit / validation report (tests, debug tools). */
export function generateMapDetailed(params: MapGenParams): MapGenResult {
  const seed = params.seed >>> 0;
  let last: MapGenResult | null = null;
  for (let a = 0; a < MAPGEN.maxAttempts; a++) {
    const res = attempt(params, new Rng(`mapgen:${seed}:${a}`), false);
    if (res) last = res;
    if (res && res.report.validation.ok) {
      res.gen.attempts = a + 1;
      return res;
    }
  }
  for (let sub = 0; sub < FALLBACK_TRIES; sub++) {
    const res = attempt(params, new Rng(`mapgen:${seed}:fallback:${sub}`), true);
    if (!res) continue;
    res.gen.attempts = MAPGEN.maxAttempts;
    res.gen.usedFallback = true;
    last = res;
    if (res.report.validation.ok) return res;
  }
  if (last) return last;
  throw new Error(`mapgen: could not generate ${params.objective}/${params.biome} seed ${seed}`);
}

export function generateMap(params: MapGenParams): GeneratedMap {
  return generateMapDetailed(params).gen;
}
