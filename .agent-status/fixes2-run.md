# Run lane: final fix pass (R1-R8)

## State
- `npx tsc --noEmit`: clean, whole tree (08:21).
- `npx vitest run tests/run tests/app`: 17 files, 156 tests, green.
- Full `npx vitest run` (08:22, twice): 74 files, 820 tests, 1 failure. The failure is `tests/integration/battle.test.ts > Holdfast d3 > seed 1` (bot defeat). That test builds its battle from `quickBattleSetup` + mapgen + sim, and this lane did not touch any of them (`src/run/setup.ts` is unchanged). The sim lane's encounter work is still in progress in the tree (commit rule, Spent distance extra), so the fix belongs there.
- e2e: `e2e/app.spec.ts` (5) and the new `e2e/app-mobile.spec.ts` (3), 8/8 green against a scratch build on port 5313 (a scratch config with the repo testDir and baseURL 5313; `playwright.config.ts` is unchanged).
- `npm run build`: ok. The JS has no `sourceMappingURL` comment. `dist/` holds `og-image.png` (223 KB) and `apple-touch-icon.png` (13.7 KB).

## What changed
- **R1 Phones.**
  - New `src/app/ui/deviceNotice.ts` and `src/app/logic/device.ts`. Styles live in the new `src/styles/notice.css`, sized in px with theme tokens; it reuses `.btn` / `.btn.primary`.
  - App boot shows the notice after the Title in two cases: a coarse pointer with no fine pointer, or min(w,h) < 500 or max(w,h) < 900.
  - Copy: 'Best on a computer' / 'Embermarch is played with a mouse and keyboard'. Copy link uses `navigator.share`, falls back to the clipboard, then to a selectable URL field. A closed share sheet is not an error.
  - 'Turn it sideways' shows in portrait only. The touch line is `TOUCH_CONTROLS_LINE`, with exactly the battle lane's sentence.
  - Focus starts on Continue anyway. Tab and Shift+Tab cycle inside the card. Esc continues. No other key reaches the screen behind.
  - Continue and Esc are remembered under `embermarch.deviceNotice.v1` (guarded). If storage is blocked, the notice still shows and Continue still closes it.
  - The card uses margin:auto, so a card taller than the screen scrolls from its top. Under 500 px tall it switches to a short layout with the buttons side by side.
  - `theme.css`: inside `(pointer: coarse) and (max-width: 959px), (pointer: coarse) and (max-height: 539px)` the root floor drops from 12px to 7px. The same query sets the new `--label-min` token to 0.
  - Audio: `installAudioUnlock(window, …)` calls `getAudio().unlock()` on every pointerdown, pointerup, touchend, click and keydown. Settings are applied once, on the first call.
  - Measured on emulated phones:

    | Device | Root font | Notice card | Begin the March | Begin Battle | AudioContext after one tap |
    |---|---|---|---|---|---|
    | iPhone 15 landscape, WebKit, 734x343 | 7.6px | 620x194 | y 255-283 | y 300-325 | running |
    | Galaxy A55 landscape, Chromium, 1040x480 | 10.7px | 620x194 | y 356-394 | y 422-456 | running |

  - Portrait iPhone 15: the Title logo now fits (x 14-379 of 393). Setup still overflows sideways. The notice tells the visitor to turn the phone.
- **R2 Link preview.**
  - `index.html` gains og:title, og:description, og:type, og:url, og:image (absolute), og:image:type, width, height and alt, plus twitter:card summary_large_image and `<link rel="apple-touch-icon">`.
  - `public/og-image.png` is the Title at 1200x630 from a static build, with the logo fully visible (x 236-964). It is quantised to a 256-colour palette with light Floyd-Steinberg dither: 358 KB down to 223 KB, read by eye, no banding.
  - `public/apple-touch-icon.png` is 180x180: `favicon.svg` at 148 px on #0b0a0f.
- **R3 Caching.** New `vercel.json` with a headers block only: `/assets/(.*)` gets `public, max-age=31536000, immutable`, and `/fonts/(.*)` gets `public, max-age=2592000`. `vite.config.ts` sets `sourcemap: 'hidden'`.
- **R4 Elite modifiers.** `src/run/runmap.ts` adds `ELITE_FORCED_NEGATIVES` (NEGATIVE_MODIFIERS without blood_moon, filtered locally). For an Elite, a second open roll skips negatives once one is held. The forced negative is added only when the rolls hold none. Over 1000 maps (1224 Elites):

  | Metric | Before | After |
  |---|---|---|
  | Elites with 2 or more negatives | 631 (52%) | 0 |
  | Blood Moon on an Elite | 318 | 100 (8%, all from the open roll) |
  | Forced Blood Moon | possible | never |
  | Map generation, 1000 maps | 563 ms | 563 ms |

  Seed 777 c5l3 is now `blood_moon` alone (open roll) with doctrine siegebreak. Before, it was blood_moon + fortified_nests with doctrine spines.
- **R5 Stragglers.** `finishBattle` now settles the Retinue first, then checks for Stragglers. They are granted for a non-boss defeat, or a Retreat with no survivors, when the Retinue is empty and the run is not over. A Retreat with survivors gets its Retinue step and no Stragglers. The note text is unchanged.
- **R6 How to Play.**
  - Shift line now reads "…queues the foundations in order. RMB or Esc cancels."
  - The A › LMB row reads "Attack-move. On an enemy: attack it."
  - Nests & Waves has a new "Who burns Nests." fact with both requested sentences.
  - Tab content is top-aligned: the band above is 0 px on all five tabs at 1600x900 and 1280x720, and no tab scrolls.
  - Step 4 reads "for at least 45 s after its wave breaks (longer for a far Nest)" (interface 4).
- **R7 Results.** New pure `battleStatRows(result)` in `src/app/logic/results.ts`. A boss battle labels the row 'Root Hearts burned'; the other objectives keep 'Nests destroyed'. The sim counts Root Hearts as the boss battle's Nests, so the number is right. The Summary keeps 'Nests burned' because it sums every battle of the run.
- **R8 README.**
  - The A › LMB row reads "Attack-move; on an enemy unit or building, attack it".
  - The Shift + RMB row adds the S1 foundation rule.
  - New "On phones and tablets" note.
  - The Spent line says "at least 45 s … (longer for a far Nest)".
  - The Resolve bullet mentions Stragglers.

## Deviations from the plan (also for the GDD, S10)
- R1: a mouse device in a small window (no coarse-only pointer) gets a 'window' variant: "Best in a larger window / Embermarch is laid out for 1280×720 and up / Enlarge the window or go full screen for the full game." It has no Copy link and no touch line. "Best on a computer" was wrong for a laptop in a small window.
- R1: on small touch screens the 11px label floor (`max(11px, …)`, 15 rules in ui.css / screens.css) becomes `max(var(--label-min), …)`, with --label-min 0 there. With the 11px floor, the run header labels overflowed the header ("CROWNS" was cut off at the top). Desktop is unchanged: --label-min is 11px, checked at 1280x720.
- R4: Blood Moon can still come from an Elite's open roll as its only hardship (8% of Elites). The plan only excluded it from the forced pick.

## Contract changes
None. No edits to the contract files, `src/data/*`, `src/sim/*` or `src/game/*`.
New exports:
- `runmap.ELITE_FORCED_NEGATIVES`
- `app/logic/device`: `deviceNoticeKind`, `wantsDesktopNotice`, `installAudioUnlock`, `AUDIO_UNLOCK_EVENTS`, `DEVICE_NOTICE_KEY`, `TOUCH_CONTROLS_LINE`
- `app/logic/results.battleStatRows`
- `app/ui/deviceNotice`: `needsDesktopNotice`, `showDesktopNotice`

## Tests
- New `tests/run/elite-modifiers.test.ts`:
  - 16,000 `rollModifiers` Elite rolls. Each has exactly one negative, and a Blood Moon on an Elite comes only from the open roll.
  - 1000 maps with no Elite holding 2 negatives.
  - Seed 777 c5l3.
- `tests/run/runmap.test.ts`:
  - An Elite's modifier count is now 1 to (column max + 1). The old rule "column min + 1" no longer holds.
  - Every Elite has exactly one negative.
- `tests/run/results.test.ts`:
  - Retreat with 0 survivors gives 2 Rank I Ashpikes and the note.
  - Retreat with survivors gives none and a Retinue step.
  - A Retreat that spends the last Resolve gives none.
  - The old "no Stragglers after a Retreat" case now passes survivors.
- New `tests/app/device.test.ts`: notice kinds per device and size, the touch sentence, and audio unlock on every gesture.
- New `tests/app/results.test.ts`: boss 'Root Hearts burned', the other objectives keep 'Nests destroyed'.
- New `e2e/app-mobile.spec.ts`:
  - iPhone 15 landscape (WebKit) and Galaxy A55 landscape (Chromium): the notice shows, Continue hides it, it stays hidden after a reload, and New Run → Begin the March → Begin Battle are tapped inside the viewport.
  - Desktop at 1600x900: no notice, root font 20px.

## How to test
- `npx vitest run tests/run tests/app`
- `npx playwright test e2e/app-mobile.spec.ts e2e/app.spec.ts`. WebKit must be installed; the phone tests launch their own browser through the `playwright` fixture.
- Scratch scripts are in `…/scratchpad/r2/fix-run/scripts/` (not in the repo):
  - `mobile.cjs`: phone flow and AudioContext state.
  - `notice.cjs`: portrait, desktop, small window, Tab/Esc, Copy link, blocked storage.
  - `screens.cjs`: How to Play tabs, Results.
  - `og.cjs`: og image and touch icon capture.
  - `pngq.cjs`: palette PNG quantiser.
