# Release verification (after the sim / battle / run fix pass)

Status: **green**. The tree type-checks, every test suite passes twice, the build succeeds, and all e2e tests pass. The game was played from the Title screen with real mouse and keyboard to Raze victories, including one on the final build. Two integration problems turned up during play; both are fixed and covered by tests.

## Checks (final tree)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` (run twice) | 66 files, 751 tests passed, both runs (was 65 / 745 before this pass) |
| `npm run build` | ok, 697 kB JS / 234 kB gzip |
| `npx playwright test` | 13 / 13 passed (app 5, battle 3, battle-fixes 5), before and after my changes |
| Bot matrix, seeds 1-8 (deterministic, before vs after my movement fix) | identical win counts: Raze d1 6/8, Raze d2 4/8, Holdfast d1 7/8, Holdfast d3 5/8, Beacons d1 8/8 (about 5:00). Only 3 finish times moved by 2-18 s. |

## Fixed in this pass

1. **Move orders to a point nobody can stand on never ended** (`src/sim/movement.ts`, `src/sim/core.ts`, `src/sim/orders.ts`). Example: a point on a forest corner. Nav declared the unit `stuck` and cleared its intent, but the move behavior re-issued the same goal on the next tick before checking for arrival, so the unit cycled `moving`/`stuck` forever. Its queued orders never ran, and because it was still in a `move` order it never auto-acquired, so it would not defend itself. GDD §F (e) says the unit goes idle. Fix: a player unit does not re-issue a point goal that nav just gave up on in the same order, so `moveDone` / `moveFailed` see the give-up. A new order always tries its goal at least once. Encounter-driven enemy units are untouched. Found with a staged Courser loop on Raze d3 seed 5 (it stuck at (50.6, 53.0) for 70 s). Covered by `tests/sim/stuck-move.test.ts` (3 tests, all fail before the fix). The bot matrix confirms balance is unchanged.
2. **Edge-marker labels were clipped at the side edges** (`src/game/hud/edgeArrows.ts`, `src/styles/hud.css`). This is a B5 follow-up: the new distance suffix makes "Spent 0:17 · 36 tiles" wider than the 34 px edge inset, so the label ran off screen ("Spent 0:17 · 36 ti"). New pure `labelShift` estimates the width from the text length (no per-frame layout reads) and shifts the label inside the viewport through a `--lx` CSS variable. Tests are in `tests/game/layout.test.ts` (3 new). Browser check at 1280x720: the label spans x 1188-1268 of 1280. The 1600x900 economy showcase shows the label at the right edge fully visible.
3. **Pause-menu boss quit text** (`src/game/hud/pauseMenu.ts`) now says Continuing also costs any Last Stands already spent, matching R7 (flagged by the run lane).
4. **Stale "Kindling 140/300" doc comment** in `src/game/hud/tracker.ts` is now 450 (flagged by the sim lane, S6).
5. **README.md**: Play section, a short "How a run works" and a Controls table that matches How to Play and the GDD.

## Real-input playtest

A headed Chromium (about 120 fps) runs a static build served by `vite preview` on port 5220. A scripted player reads the screen-equivalent state: own units, explored terrain, visible enemies. Every order is a real mouse click, drag, wheel or key press: box and double-click selection, right-click gather / rally / attack, build hotkeys plus a click on a green ghost, `,` and `Shift+\`` army selection, `A` plus a click or a minimap click for attack-moves, `=` `=` for 2× speed. No `win()`, `issue()` or `spawn()` was used in these runs. Each run starts from Title, New Run, Setup, Map, Briefing (Muster Hall Vanguard), then the battle.

| Run | Seed / first battle | Build | Result |
|---|---|---|---|
| 1 | 20261011, Raze d1, Spines | before fix | **Victory 5:38**, under par. 44 slain, 23 lost, 2 Nests. Then Draft reward (Firecraft), Retinue (6), map, Event (Cold Watch-Fire). |
| 2 | 4004, Raze d1, Swarm | before fix | Defeat 11:03. Results showed "Stragglers rejoin: 2 Rank I Ashpikes" (R14b). Second node Raze d2: defeat 9:46. |
| 3 | 4004, tuned driver | before fix | **Victory 6:18**, then Event. |
| 4 | 20261011, tuned driver | final | Defeat 11:59 |
| 5 | 20261011, run 1's driver | final | Defeat 12:20 |
| 6 | 20261011, farms + hold push | final | Defeat 12:30 (one Nest razed at 5:23) |
| 7 | 4004, run 3's driver | final | **Victory 5:34**, under par, Total 79. 43 slain, 17 lost. Then Draft reward, Retinue, map, R2 preview check, Event. |

The losses come from my scripted player, not the game. It runs out of Grain when the Thickets empty (up to 1,056 Timber banked, 5 idle Tillers), pulls pushes home when four raiders reach the base (once with the Nest at 5 HP), and fields Ashpikes and Bowmen against Spines where the counsel asks for Coursers. The deterministic bot matrix above shows the movement fix leaves outcomes unchanged. Every run's console was clean: no errors, warnings or pageerrors.

## Fixed items spot-checked in the browser

| Item | Evidence |
|---|---|
| S4 | A box over the Tillers selects exactly 7 Tillers (8 of 8 battles, including one with Stragglers on the field) |
| B6 | Double-click on a Tiller selects 7 Tillers (8 of 8) |
| B8 | `,` then `Shift+\`` adds the Warden (9 → 10) |
| R6 / R8 / S11 | The first briefing shows "First march (waves −15%)". Spines counsel names only core units: "Spines: bring Coursers … research Ember Edge at the Forgehall." |
| R2 | Previewing a battle node and pressing Back keeps currentNode `start`, nodes done 1, and 4 / 4 roads clickable. A sibling node reads "Click to march here." |
| R4 | The Elite tooltip says "Elite: a Rare or better Boon (1 of 4), then a Draft. +40 Crowns." plus a Doctrine row. The Boss tooltip says "Slay the Regent and end the march." |
| R11 | Cold Watch-Fire "Scavenge" shows a Gained card (Hearthborn, Common, Stat, Economy, "+2 starting Tillers.") |
| R3 | Won-run Summary with a Thornbound I unlock: the button sits at y 760-824 of 900 |
| R13 | Retinue "6 more below" pill, raised drop cap "An old watch-fire", objective badges in the legend |
| B2 / B3 | Pill "Paused · F2 to resume" at y 7-32. Clicking 2× while paused: time 0.50 → 0.50 over 3 s, speed 2. F2 resumes at 2×. |
| B5 | Horn collapses from 70 px to 32 px ("Wave 1 · Advancing · SW · ×4 · ×1", pointer-events none). The Spent marker shows its distance. |
| B9 | "Courser lost" notice when the scout dies off-screen |
| B10 | Bowman RNG 7 in green (class `up`), tooltip "Base 6 / Yew Staves +1". Tiller panel reads "carrying 5/14 Grain" with Laden Packs. |
| S12 | Forgehall card with Ember Tithe: Z / X / C show 85 Ember (Z 100 Grain / 85 Ember) |
| S3 | The Spent counsel hint and the ribbon both use 45 s |

## Showcase (1600x900, every frame viewed)

`/private/tmp/claude-502/-Users-openclaw-projects-roguelike-rts/33e6e381-d844-4c62-b192-2f2929a293b9/scratchpad/pt/verify/showcase/`

01 title, 02 run map mid-run (column IV, inked route), 03 briefing (Spines, First march), 04 early economy (2:31, real input, final build), 05 wave fight at the base with ×1.5 counters and a Rank I promotion (staged: quickBattle Raze d3 plus spawned buildings and army; Tillers ordered with real input), 06 razing a Spent Nest (real input, final build), 07 Boss: a 26-unit host burning a Root Heart under the Briar Regent bar (staged: spawned army and Cottages, attack-move by real input), 08 Draft reward, 09 Victory results (run 7, final build), 10 Hall of Banners.

## Remaining issues (not changed)

- Stuck point goals now end the order for player units only. Encounter-driven enemy units keep the old retry loop. Changing that would touch wave behavior and balance.
- The edge-label fit uses an estimated glyph width calibrated for Alegreya Sans (about 3.8 px per character at 11 px, 4.4 used). If the web font fails to load, the wider fallback font could still clip a long label by a few px.
- A newcomer who never builds Grainplots runs out of Grain around 3:30-4:30, and the Ascendant wave at 9:00 then ends the battle. The Counsel hint "Thickets run out. Grainplots (F) feed 2 Tillers forever." does appear. This is by design but harsh.
- The scout Counsel text renders as "… contested Seams. ` selects your Warden." The leading bare backquote reads oddly (text as specified in S11).
- Carried from the lanes: the camera clamp's 2-tile dark margin at corner Hearths; two same-direction edge chevrons can overlap; some HUD text renders under 11 px below 1280x720; a bottom toast can briefly cover the Hall's bottom row; bot Holdfast d3 is about 50%; stepped-out Bowmen stop 0.3-1 tile short of the 1.5-tile margin; Destrier (structure multiplier 0.4) no longer auto-targets buildings.

## How to reproduce

Scratch drivers live in `…/scratchpad/pt/verify/scripts/` (not in the repo):

- `play.cjs`: Title → battle → reward → map → node. Env: `SEED`, `TUNED=1|2`, `VISIT=battle`, `PLAY2=1`.
- `spot.cjs`: R2, R4, R11, B2, B3, B5, B10 and S12.
- `walk.cjs`: a full run to the Summary and the Hall.
- `scene.cjs`: staged showcase scenes (`SCENE=boss|base`).
- `label-check.cjs`: edge-label fit.
- `matrix/`: before / after bot matrix (scratch Vitest config, `TREE=<repo or base copy>`).

Serve a build with `npx vite build --outDir <scratch>/dist && npx vite preview --outDir <scratch>/dist --port 5220 --strictPort`.
