# Sim lane: final pass bot matrix

Deterministic headless runs (`tests/integration/harness.ts` + `bot.ts`, maxTime 12:00 for bot cells, 8:00 for no-input Holdfast, 12:00 for no-input Raze/Beacons). "Before" is a `git archive HEAD` export (9954224). "After" is the working tree with S1-S9 (other lanes' changes in the tree do not touch the sim; a HEAD + sim-lane-only copy gives the same Raze d2 row).

## Bot, seeds 1-8

| Cell | Before (HEAD) | After | Change |
|---|---|---|---|
| Raze d1 | 6/8, median 6:20 | 6/8, median 6:19 | 0. s7 7:14 → 6:33, s8 7:56 → 6:29 |
| Raze d2 | 4/8, median 6:35 | 3/8, median 6:35 | −1/8 (s7 7:21 → unfinished at 12:00) |
| Holdfast d1 | 7/8, median 5:55 | 7/8, median 5:48 | 0 |
| Holdfast d3 | 5/8, median 6:21 | 5/8, median 6:21 | 0 |
| Beacons d1 | 8/8, median 4:57 | 8/8, median 4:57 | 0 |

HEAD matches the baseline in `verify.md` (6/8, 4/8, 7/8, 5/8, 8/8).

Per seed (W win, L loss, - unfinished at 12:00):

| Cell | Before | After |
|---|---|---|
| Raze d1 | W6:16 W6:20 - W5:46 W6:22 - W7:14 W7:56 | W6:17 W6:25 - W5:46 W6:19 - W6:33 W6:29 |
| Raze d2 | W6:35 - - - - W7:21 W7:21 W6:31 | W6:35 - L11:17 - L11:02 W7:25 - W6:29 |
| Holdfast d1 | L6:26 W5:55 W6:04 W6:14 W5:34 W6:28 W5:17 W5:41 | L6:07 W5:48 W6:04 W6:12 W5:34 W6:35 W5:17 W5:41 |
| Holdfast d3 | W5:57 W6:29 W5:21 L5:50 L5:05 L3:16 W6:26 W6:21 | W6:34 W6:14 W5:39 L5:54 L5:09 L3:16 W6:25 W6:21 |
| Beacons d1 | all W, 4:48-5:28 | all W, 4:48-5:26 |

## Bot, seeds 9-24 (wider sample, same code)

| Cell | Before | After |
|---|---|---|
| Raze d1 | 5/16 | 5/16 |
| Raze d2 | 3/16 | 5/16 |
| Holdfast d1 | 16/16 | 16/16 |
| Holdfast d3 | 6/16 | 5/16 |
| Beacons d1 | 16/16 | 16/16 |

Seeds 1-24 combined: Raze d1 11 → 11, Raze d2 7 → 8, Holdfast d1 23 → 23, Holdfast d3 11 → 10, Beacons d1 24 → 24.

## No input (no orders at all)

| Cell | Before | After |
|---|---|---|
| Holdfast d1 | 0/8 (lost 4:57-6:08) | 0/8 (lost 4:57-6:08) |
| Holdfast d2 | 0/8 (4:56-5:59) | 0/8 (4:56-5:59) |
| Holdfast d3 | 0/8 (3:37-6:11) | 0/8 (3:37-6:14) |
| Raze d1-3 | 0/24 | 0/24 |
| Beacons d1-3 | 0/24 | 0/24 |

## Where the Raze d2 seed 7 change comes from

Bisected on copies of the tree (balance knobs set back one at a time):

| Variant | Raze d2 seeds 1-8 |
|---|---|
| All sim-lane changes | 3/8 |
| Commit rule off (S2) | 3/8 |
| Old adaptation (S5) | 3/8 |
| No Spent distance extra (S3) | 3/8 |
| S3 and S5 both reverted, S2 kept | 4/8 (identical to HEAD) |
| S2, S3 and S5 reverted | 4/8 (identical to HEAD) |

The commit rule alone leaves Raze d2 unchanged. S3 and S5 each change the composition or timing of seed 7 enough to flip a 7:21 bot win into an unfinished game; seeds 9-24 move the other way (3 → 5). This is bot noise, not a trend.

An intermediate version of S2 counted siege time inside the Hearth's range too. It turned Holdfast d3 seed 1 (a bot with no army left, held only because waves wasted time on a tower inside the Hearth's fire) into a loss and broke `battle.test.ts > Holdfast d3 > seed 1`. The final rule counts only outside the Hearth's range (range + 1), which is the stalemate the item describes; Holdfast d3 is back to 5/8.

## Stalemate check (S2)

Raze d1 Spines, seed 927873144. A built Brazier Tower and Muster Hall 10-12 tiles from the Hearth toward the nearest Nest (×10 HP to stand in for a newcomer repairing them), all player military and the Warden killed at 6:00, waves forced at 6:05, 7:05, 8:05:

| | Before | After |
|---|---|---|
| Wave units near the Hearth at 7:00 | 0 (38 on the tower) | 28 |
| First wave unit in Hearth range | 8:33 | 6:01 |
| Hearth at 10:00 | 2394/2400, battle unresolved | Hearth falls at 9:35 |

With normal building HP (×1) the forward buildings fall within about 30 s in both builds and there is no stalemate to break (Hearth falls at 7:43 before, 8:10 after). Units that stand inside the Hearth's fire are not affected by the rule.

## Last Stand against the Regent (S7)

Boss battle, every Root Heart killed at 0:00, only the Regent and the Hearth left (other units removed every tick), seeds 1-3:

| | Before | After |
|---|---|---|
| Regent displacement | 3.0 tiles | 6.0 tiles |
| Next Hearth hit after a Last Stand | 5.7-7.2 s | 7.7-9.2 s |
| Defeat | 4:15-4:19 | 4:19-4:21 |

The Hearth's 5 s invulnerability already covered most of the old 2 s walk back, so the 4 s root plus 6 tiles buys about 1-2.5 s of Hearth time per Last Stand. The army does get a rooted Regent to hit for 4 s. A root of about 8 s (or a root that starts when the invulnerability ends) would buy about 5 s; that would change `LAST_STAND.bossRootTime`, which the plan fixed at 4.

## How to reproduce

Scratch harness (not in the repo): `…/scratchpad/r2/fix-sim/matrix/` (`lib.ts`, one test file per cell, `vitest.config.mjs`, `summary.cjs`).

```
MATRIX_ROOT=<tree> MATRIX_OUT=<out> MATRIX_LABEL=<label> npx vitest run --config <scratch>/matrix/vitest.config.mjs
node <scratch>/matrix/summary.cjs <out> <label>
```

Wider seeds: `matrix3/`; no-input Raze/Beacons: `matrix4/`; probes: `probe/stalemate.test.ts`, `probe/regentls.test.ts`, `probe/hf.test.ts`.
