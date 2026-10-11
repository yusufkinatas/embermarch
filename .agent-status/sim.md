# Sim lane (fix pass)

## State

- `npx tsc --noEmit`: clean (whole repo, end of pass).
- `npx vitest run`: 65 files, 745 tests, all green (whole repo, includes the other lanes' work in the tree at that moment).
- My lane: tests/sim, nav, encounter, data, mapgen, integration: 30 files, 399 tests green.

## Items

| Id | Outcome | Notes |
|---|---|---|
| S1 | fixed | Units with an effective structMod below 0.5 (Bowman, Outrider, Courser, Firebrand Bowmen, Destrier 0.4) skip structures in idle, attack-move and hold scans, in the overkill swap and in melee retarget. Enemy units with `ai !== null` are unchanged. If no unit target is found and a structure shot the unit within 1 s, or a firing structure targets a friendly unit while this unit stands in its range, the idle unit steps 1.5 tiles outside the range and makes that its idle spot. It tries the straight line first, then directions fanned out to ±120° that are walkable and have a clear straight walk. A browser check on Raze d1 seed 3207855854 showed the straight-line version stalling at the range edge behind trees. That case is now a regression test. |
| S2 | fixed | Hbase is [8, 13, 18, 25, 34, 52] and `HOLDFAST.fSlope` is 0.06. New test: Holdfast d1-3, seeds 1-4, no input, never a victory. |
| S3 | fixed | Spent now ends 45 s after the break, capped at 105 s from launch. The hint reads `SPENT.afterBroken`. No hardcoded 30/90 remained in the encounter code; only comments mentioned them, and those are updated. |
| S4 | fixed | Tillers keep the "below the Hearth" spawn. The free Courser, the Warden, extra non-Tiller units, the Retinue and Sellswords prefer the far side (`hearth.ty - 2`). The gather hint is updated. |
| S5 | fixed | `queue` for build/repair means: queue only behind a current build order or a non-empty queue. |
| S6 | fixed | Kindling target is now 450. |
| S7 | fixed | Root Heart HP is 1200 and its garrison value 12. |
| S8 | fixed | `checkVictoryNow` runs before the defeat check at step 11. Last Stand is skipped when the victory condition is already met that tick. |
| S9 | fixed | Kill credit now follows the attacker's owner. Arrows, splash, burns and Firepot impacts from dead attackers still count `stats.kills` and Spoils. Rank-ups still need a live killer. |
| S10 | fixed | `Unit.free` is set on the free Courser. `buildBattleResult` skips it until it reaches Rank I. |
| S11 | fixed | Every doctrine answer starts with its name. Spines and Court gain `answerCore` and `answerDrafts`. The scout hint warns about Pickets. |
| S12 | fixed | `researchCost()` applies Ember Tithe's −15% to research Ember. It is used by `startResearch` and `researchOptions`; in the browser Ember Edge showed 85 and charged 85. Grimbrand train time goes from −25 to −20 (Ashpike 9.6 s). Smith and Firebrand texts fixed. |
| S13 | fixed | `resumeAfterWork` falls back to the same resource within 10 tiles of the remembered source before going idle, and clears the job when it finds nothing. |
| S14 | fixed | GDD synced (lines listed below). Before/after matrix below. |

## Contract changes (all additive)

- `src/sim/types.ts`: `BurnInstance.applierOwner?: Owner`, `Unit.free?: boolean`.
- `src/data/types.ts`: `DoctrineDef.answerCore?: string`, `DoctrineDef.answerDrafts?: PlayerUnitId[]`.
- New or optional parameters on existing exports:
  - `behavior.acquireTarget(world, u, radius, exclude?, structures = true)`
  - `combat.applyPacket(..., ownerHint?)`, `dealAbilityDamage(..., ownerHint?)`, `dealTrueDamage(..., ownerHint?)`, `applyBurn(..., ownerHint?)`
  - `entities.KillOpts.killerOwner?`, `SpawnUnitOpts.free?`
  - `hooks.onUnitKilled(world, victim, killerId, killerOwner?)`
- New exports:
  - `behavior.autoTargetsStructures`
  - `encounter.checkVictoryNow(world)`, `encounter.victoryConditionMet(world)`
  - `stats.researchCost(world, owner, id)`
  - `data/boons.EMBER_TITHE_COST_PCT`
- New balance keys: `ACQUIRE.autoStructureMinMod` (0.5), `ACQUIRE.structureStepOut` (1.5), `HOLDFAST.fSlope` (0.06), `GATHER.resumeSearchRadius` (10).
- Changed values: `HOLDFAST.hbase`, `SPENT.afterBroken` 45, `SPENT.maxFromLaunch` 105, `BEACONS.kindlingTarget` 450, `BOSS.heartHp` 1200, `BOSS.heartGarrisonValue` 12, Grimbrand trainTime pct −20.
- Hint texts in `src/data/text.ts` changed: gather, scout, spent.

## Test assertions changed (intended new numbers)

- Holdfast tables in `tests/encounter/formulas.test.ts` and `tests/data/data.test.ts`.
- Spent clock tests now use 45/105. The director test expects "Spent 0:45".
- Beacons: 450 in director.test (the loop runs to 580 s), the tracker shows 'Kindling 0/450', and battle.test expects 450/450 and time > 250 s.
- `tests/integration/run.test.ts`: the boss gets a 780 s cap instead of 540. A boss "defeat" made up at the time limit with Resolve left is now accepted as the run layer's boss retry (node stays open). The bot used to lose the boss outright; after S1 it holds past 9:00, which exposed the fabricated result.
- Bot (`tests/integration/bot.ts`), orders only, no rule weakened:
  - It no longer issues repair with an empty Tiller list (23 failed commands on Holdfast d3 seed 2 tripped the 10% failure check).
  - It no longer treats a wave still mustering at its Nest (more than 10 tiles from the Hearth) as a home threat. In Holdfast it used to march into the Nest's spire and garrison at 0:30.

## Matrix (seeds 1-8; before = HEAD export, after = this tree)

W/L/U = wins / losses / unfinished at the cap (bot: Raze and Beacons 12 min, Holdfast 8 min).

| Cell | Before | After |
|---|---|---|
| No input, Raze d1/d2/d3 | 0/8 wins each | 0/8 each |
| No input, Holdfast d1/d2/d3 | **7/8, 5/8, 1/8 wins** | **0/8 each** |
| No input, Beacons d1/d2/d3 | 0/8 each | 0/8 each |
| Bot Raze d1 | 5/0/3, median 6:33 | 6/0/2, median 6:20 |
| Bot Raze d2 | 2/2/4, median 6:30 | 4/0/4, median 6:31 |
| Bot Holdfast d1 | 8/0, median 5:15 | 7/1, median 5:55 |
| Bot Holdfast d2 | 8/0, median 5:30 | 7/1, median 6:06 |
| Bot Holdfast d3 | 5/3, median 5:50 | 5/3, median 6:21 |
| Bot Beacons d1 | 8/0, median 4:00 | 8/0, median 4:57 |
| Bot Beacons d2 | 8/0, median 4:01 | 8/0, median 4:58 |

Acceptance holds: no no-input wins at d1-3; Raze d1 6/8 (≥ 5); Holdfast d1 7/8 (≥ 7); Beacons d1 8/8 with a 4:57 median (4:30-5:30). The Holdfast d3 test (seeds 1/2) wins at 5:57 and 6:29.

Bot Holdfast d3 is near 50% (12 seeds: 6/12) whether or not S1 and S4 are in, and the lead's "6/8" was a small sample. With the bot staging clamped 15 tiles from Nests, d1-2 went to 12/12 but d3 dropped to 4/12, so I did not keep the clamp.

## GDD lines written (S14)

- §B: First march (×0.85, R6), free Courser at Rank I+ (S10), Stragglers (R14), Briefing preview committing on Begin Battle (R2), same-tick victory (S8).
- §C: start layout (S4), Kindling 450 (S6), Holdfast formula and table (S2).
- §D: builders resume a nearby source (S13).
- §F: no structure auto-targeting below ×0.5 plus step-out (S1).
- §I: Root Heart 1200/12 (S7), Spent 45/105 with toast 0:45 (S3), doctrine counsel naming and the core variant (S11).
- §L: Firebrand, Ember Tithe and Grimbrand rows (S12).
- §O: Shift-build queues (S5/B1), Shift+` adds the Warden (B8), hints #1/#5/#9, tracker 140/450, Briefing preview in the screen flow.
- §R: real-AI Thornling/Spinecaster numbers, no-input and bot rows.
- Revision notes: a "Fix pass" block.

## How to test

- `npx vitest run tests/sim tests/encounter tests/data tests/integration`
- The matrix runner lives outside the repo, at `<scratchpad>/pt/fix-sim/matrix/`. It uses its own Vitest config with `root` set to the repo; `MATRIX_ROOT` picks the tree.
