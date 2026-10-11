# Run lane: fix pass (R1-R14)

## State
- `npx tsc --noEmit`: clean (whole tree, at the time of writing).
- `npx vitest run`: 65 files, 745 tests, all green (includes the other lanes' work in progress).
- `e2e/app.spec.ts` against a scratch build on port 5213: 5/5 (3 existing + 2 new).
- Browser checks (scratch Playwright scripts, 1600x900 and 1280x720, screenshots read): map preview flow, map tooltips and legend, briefing, Run Summary (won and lost), header Sellswords, event and camp outcomes, peddler tooltip and toast, retinue with 26 survivors, setup sealed Houses, Hall and title, How to Play, results after a defeat, New Run on a finished run, boss Last Stands on Continue. No HTML text under 11px on title, map, peddler, briefing, setup or hall at 1280x720. Console clean.

## What changed
- **R1** `src/app/logic/flow.ts` `settleFinishedRun`: New Run on a run that is over but never showed its March End banks it with `endRun` (no confirm), toasts "+N Renown", then opens Setup. `AppShell.startRun` does the same before `newRun`. `endRun` stays idempotent through `run.summary`, and it clears the save, so a second copy cannot be banked. The Abandon path for a live run is unchanged.
- **R2** Battle, Elite and Boss nodes open a preview briefing (`openNode`, pure `getBriefing`). Back changes nothing. Begin Battle calls `beginBattle`: `enterNode`, then `startBattle`. Event, Peddler and Camp still commit on click. A legacy save whose current node is an unplayed battle still opens its briefing, and Begin does not double-count it.
- **R3** Run Summary: the body is a scrollable column (`justify-content: safe center`) with a sticky action row. The "New challenge" tier panel moved into the Chronicle column, and the spacing is tighter (smaller crest under `max-height: 800px`). At 1600x900 the button sits at y 815-878. At 1280x720 it sits at y 635-686. The loss summary keeps the same structure.
- **R4** `nodeRewardText(run, node)` in `src/run/briefing.ts`, exported by the run API. The briefing and the map tooltip share it. Elite: "Rare or better Boon (1 of 3), then a Draft. +40 Crowns." Boss: "Slay the Regent and end the march." The tooltip also has a Doctrine row ("Hunt · Hoofprints in the mud.").
- **R5** `src/run/runmap.ts`:
  - Layouts must give a mean of at least 3.6 decisions per path, with no path running through 3 or more single-exit nodes among cols 2-6. The local `LAYOUT_TRIES` is 300.
  - `typesValid` adds `elitesAvoidable`: every node in cols 1-5 that leads to an Elite also has a non-Elite next.
  - An accepted layout whose types cannot be rolled is rerolled like a rejected layout. This keeps typeFallback at 0.
  - The fixed fallback places its col-4 Elite where it can be sidestepped.
  - Results over 1000 seeds:

    | Metric | Before | After |
    |---|---|---|
    | Mean decisions per path | 3.22 | 4.08 |
    | Paths with ≤ 2 decisions | 22% | 1.3% |
    | Branch nodes per map (cols 2-6) | 3.1 | 4.9 |
    | Non-Elite nodes forced into an Elite | 19% | 0% |
    | layoutFallback / typeFallback | | 0% / 0% |

  - Note: maps changed for every seed. On seed 4004, col II is now c2l1, c2l2, c2l3. The R2 check used c2l1, then c2l2.
- **R6** `composeSetup`: the start node (column I) in a profile's first 3 runs gets `waveMult × FIRST_MARCH_WAVE_MULT` (0.85, local to `setup.ts`), on top of Thornbound and Hollow Envoy. The briefing shows a modifier-style row: "First march: The Thornwake wakes slowly (waves −15%)".
- **R7** New field `RunState.bossLastStandsUsed`. `recordLastStands(run, n)` only counts up, only in a boss battle in progress, and saves. The battle screen polls `controller.world.lastStandsUsed` every 500 ms in run boss battles, and once more on destroy. `resolveInterruptedBattle` charges 1 + stands, and 0 Resolve ends the run. `startBattle` and `finishBattle` reset the field. The boss quit text in the briefing mentions the Last Stands.
- **R8** Counsel uses `answerCore` when any `answerDrafts` unit is not unlocked for the run. It reads the S11 fields as optional, and S11 has now landed. Spines in battle 1 no longer names Oathshields or Destriers. "Your Host" uses the new `Briefing.tillers` / `coursers`, counted from the composed `startUnits` effects (Tallow 8, Hearthborn +2, Refugees, Hearth Lore).
- **R9** A window `contextmenu` listener blocks the browser menu on every screen, except in input, textarea and contenteditable.
- **R10** The run header gives Sellswords their own slot ("Sellswords · 3", tooltip "Fight in the next battle only"). Retinue keeps "Retinue · N pop".
- **R11** `EventOutcome` now carries the `boons`, `boonsLost`, `drafts` and `sellswords` a choice changed. Event and Camp outcomes render them: compact Boon cards (name, rarity, kind, tags, text) and Sellsword chips.
- **R12** How to Play Controls:
  - Three aligned columns.
  - `keys()` takes a separator: '+' for chords, '/' for alternatives, '›' for sequences (A › LMB). A legend explains the three.
  - New rows: minimap LMB jump or drag to scrub, minimap RMB move, attack or rally; Shift+1-9; Shift+Q trains 5; Del / Bksp cancels, or demolishes on a second press; LMB / RMB on a queue slot; F2 / Pause; H / ` double-tap to centre; Shift+`.
  - It fits without scrolling at 1280x720.
- **R13** Polish:
  - (a) The retinue list has a visible scrollbar and a "N more below" pill.
  - (b) The event initial is raised instead of floated ("An old watch-fire").
  - (c) Toasts sit at the bottom centre, so they no longer cover the Peddler and Hall titles. Page titles sit directly under the header on every screen, so "below the header" would still cover them.
  - (d) Peddler card tooltips are clamped inside their own card.
  - (e) Results says "N soldiers survived".
  - (f) The Hall shows "Deepest column VIII".
  - (g) Sealed Houses show the unlock hint in place of their hidden ability text, with "You hold enough Renown" when it applies.
  - (h) The map legend has the Raze, Holdfast and Beacons badges and badge-style reward icons.
  - (i) App label fonts are `max(11px, …)`.
- **R14** (a) The first reward offer's last card is always a random eligible Common or Rare Rule (Mythic only if none is left), and the other cards roll as usual. A House tag adds ×2 synergy only while 3+ eligible Boons carry it.
  - First offers with a Mythic, across 2000 walked runs:

    | Fix | Mythic share |
    |---|---|
    | Before | 30% |
    | Swap restricted to C/R Rules only | 17% |
    | With the reserved Rule card | 13.5-13.8% |

  - Ardent's Second Wind is no longer doubled.
  - (b) A non-boss defeat that leaves the Retinue empty (and does not end the run) adds 2 Rank I Ashpike Sellswords, reusing CAMP drillEmpty. `PostBattle.notes` carries "Stragglers rejoin the Hearthband: 2 Rank I Ashpikes fight beside you next battle." and Results shows it.

## Contract changes (all additive)
- `src/run/types.ts`:
  - `RunState.bossLastStandsUsed?`
  - `Briefing.tillers?`, `coursers?`, `assists?`
  - `PostBattle.notes?`
  - `EventOutcome.boons?`, `boonsLost?`, `drafts?`, `sellswords?`
- Run API (`src/run/index.ts`): `recordLastStands(run, n)`, `nodeRewardText(run, node)`.
- Other new run exports:
  - `runmap.elitesAvoidable`
  - `briefing.nodeRewardText`, `briefing.doctrineCounsel`
  - `setup.FIRST_MARCH_WAVE_MULT`, `FIRST_MARCH_RUNS`, `firstMarchEased`, `firstMarchLine`
  - `results.STRAGGLERS_LABEL`
  - `util.pluralName`, `util.unitsLabel`
  - `offers.HOUSE_SYNERGY_MIN_BOONS`
- `offers.synergyTags(run, meta)` now takes `meta`. Its only callers are in `src/run`.
- App-internal: `Tooltips.attach(target, content, opts?)`, `MapViewOptions.rewardText?`, `nodeTooltip(node, rewardText?)`.
- No edits to `src/data/*`, `src/sim/*` or `src/game/*`.

## GDD lines for S14 (sim lane writes them)
- §O / §B: a battle node opens a preview briefing, and the route is committed on Begin Battle. Event, Peddler and Camp commit on click.
- §B Autosave: abandoning the boss battle costs 1 Resolve plus the Last Stands already spent.
- §B / §C: First march: the start battle of a profile's first 3 runs has waves ×0.85, shown in the briefing.
- §B Resolve: Stragglers. After a non-boss defeat that empties the Retinue, 2 Rank I Ashpikes join as Sellswords for the next battle.
- §M Boon offer rules:
  - The first reward offer's last card is always a random eligible Common or Rare Rule Boon (a Mythic Rule only if none remain). This replaces "of any rarity" and "if it rolls no Rule".
  - A House tag gives ×2 only while 3+ eligible Boons carry it.
- §B step 4 and step 5:
  - A layout also needs a mean of at least 3.6 decisions per start→boss path, and no path with 3+ single-exit nodes in a row among cols 2-6 (300 tries).
  - A layout whose types fail 200 rolls is rerolled.
  - Every node in cols 1-5 leading to an Elite also has a non-Elite next.

## Notes for other lanes
- Battle lane: the pause menu's boss quit text (`src/game/hud/pauseMenu.ts`, "restarts this battle at −1 Resolve") could add "plus any Last Stands already spent" to match R7.
- Someone updated `tests/integration/run.test.ts` during this pass (boss time limit 780 s, boss retry keeps the node open). It is green with the new maps.

## How to test
- `npx vitest run tests/run tests/app tests/integration/run.test.ts`
- New test files: `tests/run/runmap-routes.test.ts` (R5 metrics over 1000 seeds), `tests/run/results.test.ts` (Stragglers), `tests/app/flow.test.ts` (R1 and R2 against the real run API).
- Extended test files: `tests/run/{briefing,setup,lifecycle,offers,events}.test.ts`.
- e2e: `e2e/app.spec.ts` adds "no browser context menu..." (R9) and "a battle briefing is a preview..." (R2).
