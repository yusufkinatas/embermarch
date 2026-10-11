# encounter agent: done

## Done (all GDD MUST scope for the enemy side + the SHOULD items Beacons, raids, light adaptation, Gloamwitch)
`src/sim/encounter/` (17 files, each < 520 lines):

| File | Contents |
|---|---|
| `index.ts` | Public API: initEncounter, tickEncounter, onEntityDeath, onEntityDamaged, onPlayerBuildingChanged, getEncounterView, isBlighted, debugForceWave, isAIControlled, **getEncounterResult** (new). Deferred Nest-death processing (alerts, recede, spire wither, garrison march-out, launch-at-killer, Heart/Lord hooks). |
| `init.ts` | Nests / Root Hearts (depth HP, Fortified ×1.5, Thornbound II ×1.25), spires (+1 per Nest under Fortified), garrisons (4+d, TB III +2; Hearts 16), Pickets (2+d; boss 10), Caches + Lurkers (2+d / Ancient 6+2d), Beacon Stones + guards (2+d), Throne + Regent, Antlered Lord, schedule (T1, Bountiful −20 s, TB III −15 s), initial Blight + ward. Cold Watch-Fire marks Nests/objects seen. Swift Hunt forces Hunt. |
| `director.ts` | Timeline (muster at launch − 30 s, Holdfast fixed schedule + Great Wave split, boss T1 100 / 60 s / 45 s after 8:00, Ascendant 9:00 with 30 s warning), per-tick wave pass (intel, horn, launch, raids, broken), Holdfast cleanup (reveal + ≤ 6 charge), Spent sync, debug waves. |
| `waves.ts` | Muster (25% secondary doctrine, light adaptation +50, garrison overflow above 50% cap joins first, composition by weights / unlock depth / value / Rootbreaker cap, wave pool 50 / total 80 with overflow to waveBank, bank capped at 50% V, BFS spiral spawn r5), intel (unit within 6, any world.vision source = Hawk / lit Beacon), Thick Fog horn at launch − 10 s with no composition, target precedence (lit Beacon → doctrine target → Hearth), launch (Spent 90 s, Lord joins wave 3, raid scheduled at launch + floor(I/2)), raids (Stagriders while ≥ 3 value, then Thornlings; farthest Tiller; 25 s Tiller hunt), wave broken (Spent → 30 s, toast "Wave 3 broken. NE Nest Spent 0:30"). |
| `nests.ts` | N, M, round-robin, Spent mirror into Building.nest, garrison regen (1 value / 10 s, Hearts 15 s, never while Spent, standing cap 30). |
| `ai.ts` | Enemy unit AI, 0.5 s staggered thinks: engage priority (forced/retaliation → bonus target ≤ 4 → attacker in last 3 s → nearest player unit ≤ 6 (Thick Fog 4) → blocking building / building ≤ 2), hysteresis, 6-tile chase leash + 5 s ignore, Rootbreakers buildings-only (≤ 8), standing forces (aggro 7 from post, leash 12 / Lurkers 8, walk home regenerating 5 HP/s), homeless garrison (nearest player entity ≤ 20, else Hearth), dissolve (30 s no damage dealt/taken and < 1 tile moved), cohesion bands (riders / main / siege, slowest advancing member). |
| `blight.ts` | Sources (growth per objective, Creeping Wake, Root Hearts), recede over 4 s + `blightRecede` event, ward grid (Kindled Earth 5 around completed buildings, Kiln Masons 3 around towers), tiles = in radius AND ward 0 (not on water/rock/briar), Thornwake regen 1 HP/s, completed player buildings wither 2 HP/s (dealTrueDamage, once per second). |
| `objectives.ts` | Caches (guards dead + player unit within 1.2 → +150 Ember +15 Crowns; Ancient +60 Crowns), Beacons (dormant to 1:30, 10 s capture, decay, contest, +1 Kindling/s, +0.3 Ember/s, vision 8 via world.vision tag `beacon:<id>`, 8 s snuff), victory per objective, plunder, result. |
| `noble.ts` / `boss.ts` | Antlered Lord (scaled HP, waits at the Nest nearest the map center, abilities wake on damage/leaving, Wild Hunt telegraph + 8-tile dash + 45 dmg + 2-tile side knockback, Summon 2 Stagriders / 40 s max 6 not below 50%, joins wave 3, rises at the last Nest). Briar Regent (phase 1 warded + Thorn Lance, Heart kills shrink the pool, phase 2 at all Hearts dead or 8:00 Wrath, march + 2-tile hits + Hearth engage, Warden retarget, Thornburst, Rootsnare, Court Summons 75/50/25%, Enrage). |
| `view.ts` | getEncounterView: tracker texts per §O ("Nests 1/2 · Par 4:12", "Waves 4/6", "Kindling 140/300", "Burn the Root Hearts 1/3 · Regent Warded", phase 2 "Slay the Briar Regent", Elite "Nests 1/2 · Lord 0/1 · Par 5:12"), Horn (direction, composition when scouted, Small/Medium/Large, notes: Great Wave, adaptation, Riders ahead, Rootbreaker trailing, Lord rides, Ascendant in m:ss), boss bar (Regent, or the Lord once active), Nests, plunder, dusk, kindling, revealedEnemyIds. |
| `formulas.ts` | Pure math (unit-tested). `drive.ts` idempotent order layer. `spawn.ts` pools/AI records. `geom.ts` helpers. `state.ts` runtime types. |

## Contract changes (additive)
- `src/sim/encounter/types.ts`: `EnemyUnitAI.speedCap?: number`, `EnemyUnitAI.noKite?: boolean` (sim-core already reads both); new `EncounterResult` interface.
- `src/sim/encounter/index.ts`: new export `getEncounterResult(world): EncounterResult | null` (sim-core's buildBattleResult already uses it). `plunderCrowns` includes Fortified ×2 and Plunderers +10 per Nest/Picket, so sim-core must not add Plunderers Crowns again when the encounter is on (it doesn't).
- No other contract files touched.

## Notes for other modules
- **run**: Beacons is implemented and verified on real maps (tests/encounter/integration.test.ts "beacons: ..."); `BEACONS_ENABLED` can be flipped on. Blood Moon is applied here from `setup.modifiers`; `setup.waveMult` is used as-is (Envoy × Thornbound I), not re-multiplied.
- **sim-core**: buff data used: `wrath {damagePct: 20}`, `enrage {speedPct: 30, cooldownPct: -25}`, `rooted`. Encounter writes `u.move.speedCap` each tick for advancing wave units (as sim-core's movement.ts expects).
- **render / HUD**: `Building.object` extras: caches `ancient`, `seen`; beacons `dormant`, `dormantRemaining`, `snuffProgress`, `contested`, `seen`. Horn `x,y` is the muster point while mustering and the live wave centroid while advancing. Thick Fog delays the `waveMuster` event and horn alert to launch − 10 s.

## Deferred / design choices (not in the GDD, chosen here)
- Lord: first Wild Hunt 4 s and first summon 8 s after activation. Regent: first Thornburst 6 s, first Rootsnare 4 s after phase 2; Thorn Lance line width 1, runs 1.5 past its target; the Regent holds still during a Thornburst telegraph.
- Picket guards use the garrison radii (aggro 7, leash 12 from the spire); Lurkers / Beacon guards aggro 6, leash 8.
- Raids use M = waveMult × Blood Moon (no Ascendant). Ancient Cache pays its 60 Crowns only (no Ember). Root Hearts pay Nest plunder.
- Blight does not wither unbuilt foundations (keeps Kiln Masons towers buildable on Blight).
- In phase 1 the Regent stands at the Throne center (untargetable + invulnerable); it steps 4.5 tiles toward the Hearth when uprooted.

## Known issues
- None blocking. Balance (e.g. Lord / Regent vs passive armies) is untuned beyond GDD numbers.

## How to test
- `npx vitest run tests/encounter` (99 tests): `formulas.test.ts` (GDD wave / Holdfast / boss tables, schedules, N/M, composition caps, doctrines, adaptation, Spent clock, Blight growth/tiles/ward, plunder, UI helpers), `director.test.ts` (fake sim-core harness `fakeSim.ts`: director timeline, intel, Thick Fog, Cold Watch-Fire, Nest kill N, raze / Holdfast / Elite / boss victory, AI priorities, leash, retaliation, dissolve, Blight wither/ward, caches, beacons, raids, regen, doctrine targets, 10-min stability), `integration.test.ts` (real mapgen + sim-core + nav: waves walk to the Hearth, N, victory + result, spire wither, Holdfast completion, boss phase 2 march, Lord, Beacons, 10 min at d6 for every objective with caps and tick budget; whole sim averages ~0.17 ms/tick).
- `npx tsc --noEmit 2>&1 | grep -E '^src/sim/encounter|^tests/encounter'` (clean).
- Browser: `?battle=raze|holdfast|elite|boss|beacons&depth=N&seed=N`, then `__game.reveal()`, `__game.step(75)`, `__game.forceWave(3, 'hunt')`.
