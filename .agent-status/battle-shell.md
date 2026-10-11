# battle-shell: done

## Done
Battle controller, all battle input, the in-battle HUD, first-run hints, the debug API, a dev page, unit/integration tests and a Playwright smoke. Verified in the browser against the real mapgen, sim-core, encounter, render and audio modules.

| File | What |
|---|---|
| `src/game/battle.ts` | `BattleController(root, setup, callbacks, opts)`: generateMap → createWorld → renderer, audio (silent fallback if audio init throws), HUD, input, camera centered on the Hearth. rAF fixed-step loop, events drained once per frame (renderer, audio, HUD; slowmo events), outcome watcher (banner + sfx, `onEnd(buildBattleResult)` after 2.5 s while the sim runs at 0.4×), pause menu (Retreat from 3:00 and never in the boss battle, Quit to Title with its Resolve cost), settings, combat-drum intensity, audio listener, resize/HUD scale, `destroy()` (listeners, DOM, rAF, `__game` functions). Each subsystem call is guarded: an error is logged once and the loop keeps running. |
| `src/game/loop.ts` | `FixedStepLoop`: accumulator, speed 1/1.5/2, active pause, slowmo, max 5 ticks/frame (backlog dropped), interpolation alpha. |
| `src/game/actions.ts` | `BattleActions`: every intent (selection rules, smart / attack-move / stop / hold, command-card execution, placement ghost + build, Firepot/Hawk targeting, rally point mode, demolish (Delete twice for completed buildings; foundations at once), queue/research cancel, groups, Hearth/Warden/idle Tiller/military selection, alert jump, Esc chain, pause, speed, mute, Counter Wheel). World changes only via `issueCommand`. |
| `src/game/input.ts` | Pointer + keyboard plumbing (e.code bindings, preventDefault rules), box drag with pointer capture, double-click select of the type on screen, MMB drag, arrows, 8 px edge pan (toggleable), wheel zoom at cursor, hover id + cursor styles. |
| `src/game/keys.ts`, `selection.ts`, `alerts.ts`, `hints.ts`, `format.ts` | Pure, node-tested logic: key map, selection invariant (units OR one building type; military + Warden priority in boxes), groups, alert feed (≤ 5, merge, fade), edge markers, hint triggers for all 10 §O hints, formatting. |
| `src/game/hud/*` | Top bar (resources + income/min tooltip, pop, clock, Resolve pips, speed/pause/menu), Wave Horn (title/timer/direction, composition icons or size label, notes, doctrine badge, "Waves −X%" popup, ticking Spent banners), boss bar (Warded shimmer, Enraged), objective tracker (segments, par greys when missed, Kindling bar, Crowns, Boon tray and modifiers with tooltips), minimap + idle-Tiller/Warden buttons (respawn timer), 9 group slots, selection panel (unit / group up to 30 / building with 5-slot queue, research, rally / foreign entity and resource info), 5×2 command card (hotkey, cost icons red when short, disabled reason, cooldown sweep, queued badge, plus Attack-Move/Stop/Hold in free slots), alert feed, edge chevrons (threat red, Spent amber, muster violet; launch chevron follows the live wave), coach box, Counter Wheel (SVG triangle + Ember loop + resist notes), Kindle countdown, victory/defeat/retreat banner with embers, active-pause label, notice/error line, Last Stand / Regent-uprooted callout, tooltip. DOM writes are diffed; heavy widgets refresh at 10 Hz. |
| `src/game/debug.ts` | `window.__game` battle functions merged into the existing object: `world`, `ui`, `camera` (getters), `state()`, `spawn`, `grant`, `win`, `lose`, `setSpeed`, `step(seconds)` (synchronous), `forceWave`, `issue`, `select`, `reveal`, plus `pause(on)` and `ended()`. Removed on destroy. |
| `src/game/dev.ts`, `battle.html` | Dev page: `/battle.html?battle=raze|holdfast|elite|boss|beacons&depth=N&seed=N&house=…&mods=a,b&boons=a,b&hints=0`. Sets `window.__battleResult` on end. |
| `src/styles/hud.css` | Heraldic dark/bronze HUD, Cinzel headings, custom SVG cursors, scales with `--s` (1 at 1280×720 → 1.3 at 1080p). |

## Contract changes (additive, `src/game/types.ts`)
- `BattleCallbacks.onSettingsChange?(settings: { sfxVolume?; muted?; edgePan? })`: pause-menu settings changes (for meta.settings).
- `BattleOptions.sfxVolume?: number` and `BattleOptions.muted?: boolean`: initial audio settings.

## Notes for other modules
- **screens**: the app can pass `sfxVolume` / `muted` from `meta.settings` and persist `onSettingsChange`. Hints are shown only if `(opts.showHints ?? true) && setup.showHints`. `onHintSeen` also fires for hints the player made obsolete by doing the action (e.g. placing a Cottage marks `cottage` seen).
- **render**: reads `ui.selection`, `ui.hoverId`, `ui.box`, `ui.placement` (tx/ty/ok from `canPlaceBuilding`, re-checked ~10 Hz), `ui.targeting` (attackMove / ability with radius and range; Hawk range is `Infinity`), `ui.showCounterWheel` (the HUD draws the wheel itself). The minimap canvas is 152×152 CSS px inside a 160×160 frame, backing store = 152 × HUD scale × dpr.
- **audio**: `unlock()` runs on every pointer/key gesture and at start only when `navigator.userActivation.isActive`. The shell also plays `select`, `acknowledge`, `ui_click`, `ui_error`, `victory`/`defeat` (relying on the 60 ms same-sound throttle when events also map them).

## Deferred / known issues
- In headless Chromium on this (loaded) machine rAF runs at ~15 fps even on a blank page; profiling shows HUD work ≈ 0.25 ms/frame and the shell is not the bottleneck.
- Vite dev HMR reloads the page whenever other agents edit files; for browser checks I ran a no-watch Vite config from my scratchpad.
- Selection panel for several buildings of one type shows the first building's queue and research (commands go to all; train picks the shortest queue).
- Beacons objective UI is basic (tracker text + Kindling bar + Beacon status line) since `BEACONS_ENABLED` is false in run.

## How to test
- `npx vitest run tests/game`: 66 tests (loop, selection/groups, keys, alerts/markers/edge placement, hints incl. completion, format, menu rules, debug `state()`, and `BattleActions` against the real mapgen + sim: box select priority, Thicket gather, H/Q training, C placement, Warden Q for Ardent and Grimbrand targeting, attack-move/stop/hold, Esc chain, groups, idle Tillers, demolish, disabled reasons).
- `npx tsc --noEmit 2>&1 | grep -E '^src/game|^tests/game|^e2e/battle'` is clean (also with `--noUnusedLocals --noUnusedParameters`).
- e2e: `e2e/battle.spec.ts` (3 tests: select/gather/train/build/win; pause menu + Counter Wheel + Retreat; groups/speed/pause/zoom/arrow pan/minimap/rally/double-click). Default path is the app route `/?battle=raze&seed=7&depth=1`; set `BATTLE_PATH='/battle.html?battle=raze&seed=7'` for the dev page and `BATTLE_SHOTS=<dir>` to save stage screenshots. Both paths pass against a dev server on port 5187.
- Manual: `npx vite --port 5187` then open `/battle.html?battle=raze&seed=7` (or `?battle=boss`).
