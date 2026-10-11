# Battle lane: FIX phase (B1-B14)

## State
- `npx tsc --noEmit`: clean (whole project, at the end of this pass).
- `npx vitest run`: 65 files, 744 tests, all passing. `tests/game` is now 11 files, 101 tests.
- Battle e2e against a scratch preview build (port 5212, stopped afterwards): `e2e/battle.spec.ts` 3/3 and the new `e2e/battle-fixes.spec.ts` 5/5. The five new specs all fail on a HEAD baseline build.
- Browser checks (headless Chromium, 1600x900 and 1280x720, plus 1000x700, 1920x1080 and 2560x1440): screenshots read and judged by eye. No console errors or warnings in any scenario.

## What changed
- **B1 Shift-placement queues.** `actions.placeAt` sends `queue: shift && (placedThisSession || tillers.some(u => u.order.type === 'build' || u.queue.length > 0))`, as agreed with sim S5. Safety net: `UnattendedFoundations` (alerts.ts) tracks own foundations that no Tiller order or queued build targets. After 15 battle seconds it raises one amber toast, "A foundation stands unattended", with a position (Space jumps there) and a minimap ping. It repeats at most every 90 s per foundation.
- **B2 Pause indicator.** The centre "PAUSED" label is gone. An amber pill, "Paused · F2 to resume", sits right of the clock inside the top bar. Its tooltip reads "Orders are still accepted" and clicking it resumes. A thin amber inner border frames the playfield (pointer-events: none). The countdown numeral and "Kindle!" are hidden while paused or while the menu is open.
- **B3 Speed buttons keep the pause.** Changing speed while paused shows "Speed 2× · still paused". The `−`/`=` keys show the same notice.
- **B4 Forest gather.** `cursorFor` returns 'gather' over a tree tile when Tillers are selected. A right-click with no entity under it, on a tile that is not a tree, picks the nearest explored tree tile within 0.6 tiles and issues `gather {kind:'tree'}` to the Tillers. Any non-Tillers in the selection move to the click point.
- **B5 Wave Horn.** The full callout shows for 6 s when a wave musters, and for 4 s again on launch or once scouted. After that it collapses to one line ("Wave 3 · 0:21 · N · Medium" or inline icons), measured at 32 px tall at 1600x900. The body is about 75% opaque and lets clicks through. The doctrine badge, the "unscouted" tag and the unit icons keep their tooltips. Edge markers whose chevron or label would overlap the measured Horn / Spent ribbon / boss bar / coach column move down below it (`clearOfRect`). The Spent marker reads "Spent 0:38 · 31 tiles", measured from the Hearth.
- **B6 Double-click.** A double-click now needs the same unit, or two clicks within 6 px of each other, on top of the existing time, type and owner checks (`isDoubleClick`).
- **B7 Command card.** On pointerdown and in tooltips the card resolves the slot's option at event time. `setSelection` also calls the new optional `ActionHost.invalidateHud`.
- **B8 Shift+`.** `resolveKey` returns `{type:'selectWarden', add: shiftKey}`, and `selectWarden(add)` toggles the Warden into the selection. Double-tap still centres. Shift+click on the minimap Warden button does the same.
- **B9 Units lost.** Player deaths that are not Tillers or the Warden become a notice when they happen off-screen. The free scout (`Unit.free`, or a non-carried starting Courser, or any Courser in the first 2 min) always gets one. Deaths are aggregated for 3 s ("Courser lost", "2 Bowmen lost", "3 soldiers lost"), new notices are throttled to one per 5 s, and each notice is positioned for Space and pings the minimap. Model: `LossNotices`. `AlertFeed.push` gained an optional `tone`, and there is a new `AlertFeed.revise`.
- **B10 Boon effects.** New `src/game/statSources.ts`. HP, ATK, ARM, RNG and SPD are compared with the base `UNITS` row: raised values show green, lowered values red, and HP gets a ▲/▼ mark on its bar. Stat tooltips list the base value and each source (Boons, House passive, research, battle modifiers, "Rank I +15% damage"). Tillers read "carrying 11/14 Grain", and a tooltip names the carry sources, e.g. "Laden Packs +4".
- **B11 Camera and large screens.** New `BattleCamera`, a subclass in src/game, so `camera.ts` is untouched. It remembers the last `centerOn` target, and `resize()` re-centres on that target, or on the playfield centre after a pan. The HUD scale cap went from 1.3 to 1.6. Start zoom is `clamp(viewH/900, 1, 1.4)`, and `maxZoom` is 1.8 when viewH > 1200. Layout at 1600x900 and 1280x720 is identical to HEAD; I compared HUD rects and camera values.
- **B12 Input polish.** `reset()` (window blur) clears `pointer.inside`. Releasing Shift after queued attack-move waypoints ends the mode (`actions.shiftReleased`). With the Hawk armed (range Infinity), a minimap click casts it instead of moving the camera.
- **B13 HUD nits.** (a) Buttons with three costs get class `cost3`: smaller icon and costs on two lines. (b) Every HUD font under 11 px now uses `max(calc(11px / var(--s)), Npx)`. The HUD regions are `transform: scale(var(--s))`, so on screen this is `max(11, N·s)`: 11 px at 1280x720 and unchanged at 1600x900 and up. The literal `max(11px, calc(var(--s)*N))` from the brief would double-scale inside those regions. Edge-marker labels use `max(11px, calc(11px * var(--s)))` because they are not in a scaled region. A 1280x720 audit (all visible `.bt-hud` text across several states) finds nothing under 11 px. (c) Selection-panel strings now read `SPENT.damageMult` and `BEACONS.captureTime`. The grep for hardcoded '30 s' / '300' in src/game and src/render comes back clean (Kindling already came from the encounter view).
- **B14 Layout-aware hotkey labels.** New `setKeyboardLayout`, `letterFor`, `hotkeyLabel` and `loadKeyboardLayout` in keys.ts. The battle loads `navigator.keyboard.getLayoutMap()` once on start. Command-card badges and all tooltip hotkeys use the printed key (QWERTZ: the Z research badge reads Y). Bindings stay on `e.code`, and hint strings in data/text.ts were left alone.

## Contract changes
- None to contract files (`src/game/types.ts` untouched).
- Additive exported API in lane files: `ActionHost.invalidateHud?()`, `CANOPY_REACH`, `BattleActions.selectWarden(add?)`, `shiftReleased()`, `isTreeTile()`, `canopyTreeAt()`; `KeyAction.selectWarden.add?`, keys.ts layout helpers; alerts.ts `UnattendedFoundations`, `LossNotices`, `lossText`, `AlertFeed.revise`, `push({tone?})`; input.ts `isDoubleClick`, `DOUBLE_CLICK_SLOP_PX`, public `cursorFor`; hud.ts `HUD_SCALE_MAX`, `startZoom`, `maxZoomFor`; horn.ts `HORN_CALLOUT_S`, `HORN_LAUNCH_S`; edgeArrows.ts `clearOfRect`; new modules `battleCamera.ts` and `statSources.ts`.
- `BattleController.camera` is now a `BattleCamera` (a `Camera` subclass). The type is wider, nothing is removed.

## Behaviour changes others should know
- The HUD scale at 1920x1080 is now 1.5, up from 1.3, and the start zoom there is 1.2. This follows from raising the cap to 1.6. `tests/game/menu.test.ts` was updated to the new intended values (1.5 at 1080p, 1.6 at 1440p).
- Clicking a speed button no longer unpauses.

## GDD lines for S14 (sim lane writes docs/GDD.md)
- B1: "Shift-placing a building queues it behind the Tillers' current build work, even in a new placement session; Tillers that are gathering, moving or idle start it at once." Optional: the unattended-foundation notice under Alerts.
- B8: "Shift+` adds the Warden to the current selection." This goes in the controls table next to H / `.
- Optional: speed buttons keep active pause (B3); HUD scales up to 1.6 at 2560x1440 with a larger start zoom (B11); hotkey labels follow the keyboard layout (B14); "units lost" alert for off-screen deaths and the scout (B9).

## Known issues / notes
- At 2560x1440 the only dark strip left is the camera clamp's 2-tile margin next to a corner Hearth. That margin is by design and appears at every resolution.
- Two edge markers pointing the same way can still overlap each other (e.g. a wave chevron and an unlabelled under-attack chevron). This predates the fix and was not in scope.

## How to test
- `npx vitest run tests/game`: actions (B1 queue and both builds complete, B3, B4, B7, B8, B12b), keys (B8, B14), alerts (B9 aggregation and throttle, unattended foundations), input (B4 cursor, B6, B12a), statSources (B10), layout (B11 scale/zoom/resize focus, B5 marker clamp).
- e2e: build into a scratch dir, `npx vite preview --outDir <dir> --port 5212 --strictPort`, then run Playwright with a config whose baseURL is that port and testMatch is `battle.*\.spec\.ts`.
