# mapgen-audio agent: done

## Done

### Task A: procedural battle maps (`src/mapgen/**`)
`generateMap(params)` implements GDD §K steps 1-9, deterministic from `params.seed` (attempt seed = hash(seed, attempt); one `createNoise2D` per layer with forked seeds; no `Math.random`).

- **Terrain** (`terrain.ts`): 2-octave simplex fields for water, forest and rock, with quantile thresholds (exact water, shallows +4 points, rock), 2-pass forest automaton (>= 5 of 8), and lone-water removal. The automaton erodes thin forest, so the pre-smoothing forest quantile is bisected until the smoothed coverage matches the biome share (within 2%).
- **Anchors** (`anchors.ts`):
  - raze/elite: random corner, center 9-12 from both edges. Nests 0.5S-0.85S, >= 12 apart, >= 6 from the border.
  - holdfast: exact center, Nests 17-23.
  - beacons: random edge midpoint inset 9, Nests within 14 of the far edge, 3 Beacon Stones 15-24 out and >= 12 apart.
  - Clearings: Hearth 7, Nests 4, Beacons, Pickets and Caches 3.
  - 3-wide A* corridors (grass 1 / shallows 2 / forest 4 / rock and water 8). Forest and rock become grass, water becomes shallows.
  - Muster point 3 tiles in front of each Nest along its corridor. 1 Thornspire plus 1 *spare* spire site within 4 tiles of each Nest.
- **Fairness kit** (`kit.ts` orchestrator, `kit-sites.ts`, `kit-thickets.ts`, `kit-seams.ts`):
  - Forest ring >= 60 in 6-14 (stamps discs r3-4 at 8-11, topped up again after connectivity carving).
  - Vanguard sites: Muster Hall/Bowyard 6-8 facing the nearest Nest, Storehouse at the nearest forest edge 6-12, Grainplot 4-6.
  - Old Watchtowers 7-9 toward the nearest Nest.
  - Near cluster of 6 Thickets (Ashwood 4) at 4-7. Outer Thickets 3 (+2 Greenmarch) at 9-13. Home Seam at 8-11 (none under Ember Famine). Bountiful cluster of 6 at 7-10.
  - Contested Seams: raze/elite/beacons place 2 on the corridors of the 2 nearest Nests, 11-15 corridor tiles out, offset 2-4. holdfast places 1 at 12-16, >= 10 from Nests. Seams hold 1000, or 1500 under Ember Famine.
  - Pickets (raze/elite/boss), 2 mid-map clusters of 3, Caches (1, or 2 at d >= 4; >= 20 from the Hearth and >= 10 from Nests) plus the Ancient Cache at 14-20.
  - Every footprint is on grass, inside the map, keeps a 1-tile gap, and never covers a corridor centerline or muster disc.
- **Connectivity / validation** (`connect.ts`, `validate.ts`):
  - BFS from the Hearth, carving 3-wide corridors to anything unreachable.
  - `checkMap()` validates the nearest-Nest path at 30-50 (holdfast 17-30), reachable trees >= 300 (holdfast 200), walkable >= 50%, every footprint and muster point reachable, no overlaps, every kit count and distance band, and every objective and modifier rule.
  - Path length is the A* path string-pulled to line-of-sight (true walking distance; raw octile overstates by up to 8%).
  - Retries attempt+1 up to 20, then the fallback template (border band + 3 discs).
- **Boss** (`boss.ts`): the Heartwood template.
  - Hearth plaza (10,54) r8, Throne plaza (50,14) r6. Root Hearts 16-22 from the Throne at -40/0/+40 degrees.
  - Three 7-wide lanes. Side lanes fan out at the Hearth and bend after 10-13 tiles, so they separate early yet keep their path band (near Heart 34-40, side Hearts 40-46).
  - 3-thick briar walls, off-lane forest/rock only (no water). Contested Seams with Pickets at the side-lane midpoints.
- Tree amounts per biome (120, Ashwood 90). Variant bytes 0-255.
- Debug: `mapToAscii(gen, {legend})`, `generateMapDetailed()` (returns the kit report, validation report and boss lanes), `generateAttempt()` (one attempt with its failure reason), `checkMap()`, `anchorFootprints()`.
- Polish: Old Watchtowers prefer sites out of reach of Nest garrisons and Beacon guards. Picket Seams, Caches and Beacon Stones prefer spots outside tower range, so nothing fights at 0:00 when an alternative exists.
- Numbers: about 1.1 attempts per map and about 10 ms per map (56x56). 0 fallbacks in sweeps (the fallback is exercised by its own tests).

### Task B: procedural audio (`src/audio/**`)
`createAudio()` / `getAudio()` return an `AudioEngine` (`engine.ts`).
- AudioContext is created lazily in `unlock()`, never at import, and the module imports fine under Node. Before unlock every call is a no-op, but volume and mute are remembered.
- Signal graph: master gain, then compressor, then destination. sfxBus and musicBus duck to 0.4 under the horn; horns play on their own bus.
- Voices: max 8 (lower priority / oldest is stolen; horns, victory and nest booms win). The same sound plays at most once per 60 ms, with longer throttles for gather/hit streams and one-shot cues (one horn for simultaneous musters, one victory jingle).
- Position: linear-ish falloff to 0 at 30 tiles from the listener (camera play-area center), plus stereo pan.
- One cached 2 s white-noise buffer through BiquadFilters.
- `recipes.ts`: a recipe for every SfxName per the §P table, with soft envelopes and a slight random detune on non-musical cues. Each was verified in Chromium's OfflineAudioContext: no NaN, silent head and tail, peaks <= 0.71 before the compressor.
- `cues.ts`: the `eventToCues()` mapping, exported and tested:
  - attack: bow_loose (arrows, and spines pitched low), bolt_fire (Hearth/tower bolts, firepot), melee_hit.
  - hit on Thornwake: thorn_hit. Gather: chop / mine / harvest. treeFelled: a low chop.
  - dropoff, placed: build_hammer. built: build_complete. trained, researched.
  - death: death_player / death_thorn / building_destroyed (Nest deaths defer to nestDestroyed: nest_destroyed).
  - waveMuster: wave_horn. waveBroken, raidLaunch: raid_alert. beacon: lit / snuffed. telegraph: boss_telegraph.
  - bossPhase, or a shake >= 8 px: boss_slam (not when a Nest died the same frame).
  - lastStand, rankUp, cacheLooted, command: acknowledge. Player ability: a sparkle. 'sfx' passes through. victory / defeat.
  - Also `selectPitch(cls)` for the HUD's select blip.
- `music.ts` (SHOULD): 2-drum synth loop at 100 BPM driven by `setCombatIntensity`, fading over 4 s, using a lookahead scheduler. Ambient filtered-noise wind bed with slow gusts (`setAmbient`). If the shell stops calling `setCombatIntensity` for 3 s, the engine falls back to computing it (5+ enemies within 12 tiles of a player building).

## Deferred
- None of the MUST/SHOULD items for mapgen or audio.
- Not done: separate Holdfast-specific fallback statistics beyond the sweep assertion (fallback rate <= 5% per objective x biome; observed 0%).

## Contract changes (additive)
- `src/sim/types.ts` `MapAnchors`: new optional `spareSpires?: (TilePos & { nestIndex: number })[]`. It holds one validated, reachable, reserved 1x1 spire site per Nest (within 4 tiles). The encounter currently finds Fortified Nests' +1 spire with `extraSpireTile()`. **Suggestion for encounter:** use `anchors.spareSpires` first; those tiles are guaranteed free and never block a corridor or muster point.

## Known issues
- Beacons + Old Watchtowers: the stones (15-24 tiles) can leave no tower site 7-9 tiles out that is beyond guard reach. On such seeds a tower trades shots with a Beacon guard at 0:00 (the towers win). The same rarely happens with a Raze Picket whose Nest sits at about 28 tiles.
- The muster point is 4.5 tiles from the Nest center (3 tiles past its edge) along the corridor, so it may be up to about 1 tile off the straight Nest→Hearth line where the corridor curves.
- The battle shell does not yet play `select`. `selectPitch(cls)` is exported for it.

## How to test
- `npx vitest run tests/mapgen tests/audio` (about 4 s; 91 tests: 37 mapgen + 54 audio). 100 seeds per objective x biome (raze/elite/holdfast/beacons x greenmarch/fenreach/ashwood, random modifiers, d1-6) plus 100 boss seeds. Each map is audited by an independent checker in `tests/mapgen/helpers.ts`.
- Full GDD §R sweep: `MAPGEN_SWEEP=full npx vitest run tests/mapgen` (500 seeds each, about 18 s). Or set `MAPGEN_SEEDS=n`.
- Debug a map: `import { generateMapDetailed, mapToAscii } from 'src/mapgen'`, then `console.log(mapToAscii(generateMapDetailed(params).gen, { legend: true }))`.
- Audio in a browser: `getAudio().unlock(); getAudio().play('wave_horn')`. Every recipe renders cleanly in an OfflineAudioContext (checked with a Playwright script during development).
