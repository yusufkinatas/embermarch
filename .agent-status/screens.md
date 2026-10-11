# screens agent: done

## Done
The app shell and every non-battle screen, wired to the real run API and BattleController. All 14 screens plus the Settings modal are implemented and checked visually at 1280×720, 1440×900 and 1920×1080.

**Shell (`src/app/app.ts`)**
- `createApp(root)` builds an `AppShell` with the router, global state (`meta = loadMeta()`, `run = loadRun()`), tooltips, modals and toasts.
- `advance()` routes after any run step: summary if over, then a pending reward or Retinue pick, else the map. `resume()` handles Continue: it re-opens an unfinished briefing, event (`currentEventView`), camp or peddler.
- `endRun` is guarded so it is applied once.
- `window.__game` app API: `screen()`, `run()`, `meta()`, `newRun(opts?)`, `quickBattle(opts)`. The functions are merged into the shared object and re-applied after each battle (the battle shell merges and removes its own keys).
- URL params: `?seed=N` prefills Run Setup and `__game.newRun()`. `?battle=raze|holdfast|elite|boss|beacons&depth=N&seed=N` goes through `quickBattleSetup` to the battle, then Results, then Title.
- `audio.unlock()` runs on the first pointer or key gesture, then the settings are applied. Every button plays `ui_click`.
- Layout is in rem on an 80×45rem canvas. `html.ui-scaled` sets font-size to `min(1.25vw, 2.22vh)`, clamped. The class is removed while a battle is mounted, so the HUD sees 16px.

**Screens (`src/app/screens/*`)**
- **Title**: procedural ember/briar canvas (hills, Heartwood briar crown, keep, road, thorn vines, flickering hearth glow, rising embers, violet motes). Continue shows House, column, Resolve and Crowns, then calls `resolveInterruptedBattle` and shows the message. New Run (asks before abandoning a run in progress), Hall, How to Play, Settings.
- **Run Setup**: 4 House cards (ability, cooldown, passives, tags; locked Houses show their Hall unlock and cost). Thornbound selector up to `meta.tierUnlocked` with cumulative effects and the Renown bonus. Seed field with dice. Opening Boon note. Begin.
- **Run Map**: 8 columns on a canvas backdrop with biome washes and procedural ink doodles, seeded per run.
  - SVG nodes with type glyphs, objective sigil, threat skulls, modifier pips colored by kind, reward badge, and a done seal.
  - Edges are hand-inked polylines (wobble baked into the geometry, no SVG filters). Traveled edges are ember ink, and the newest one draws in as animated ink.
  - Reachable nodes pulse and are clickable, including the current node after Back from a briefing. The current node pulses ember.
  - Hover tooltips preview objective, biome and twist, modifiers with payoffs, reward and threat. Region labels, compass, legend.
- **Run header** (map and node screens): House pennant and tier, Crowns, Resolve pips, Boons tray (rarity rings, tooltips, +N overflow), drafted units, Retinue and Sellswords with rank chevrons, Settings, Quit.
- **Briefing**: objective crest, name and description, threat, par, reward, biome and twist, doctrine glyph and hint (plus the "Counsel" answer when provided), modifiers with payoffs, Retinue and Sellswords chips, Vanguard pick (3 cards with building portraits), quit-cost and retreat notes, Begin Battle / Back.
- **Battle**: mounts `BattleController` with `hintsSeen`, `showHints`, `edgePan`, `panSpeed`, `sfxVolume`, `muted`. Callbacks:
  - `onEnd`: `finishBattle`, then Results.
  - `onQuitToTitle`: Title.
  - `onHintSeen`: `markHintSeen`.
  - `onSettingsChange`: persists to `meta.settings`.
  - An error panel appears if the battle cannot start.
- **Results**: ribbon banner sweep for Victory, Defeat or Retreat, with rising embers (violet ash on defeat). Battle time, under-par note, itemized Crown lines with a count-up total, Resolve pips with a lost-pip animation, chronicle stats, gathered resources, run-over callout. Continue goes on through `advance()`.
- **Reward**: cards flip in, staggered, with `card_flip` sfx and a rarity-glow bloom (Mythic pulses).
  - Boon cards: crest, name, rarity, Stat or Rule tag, synergy tags, description.
  - Draft cards: unit portrait, stats, cost, strong/weak.
  - Subtitle from the step, Skip for +N Crowns, keys 1-4 and Enter.
- **Retinue**: candidates sorted by rank and kills, with portraits, chevrons, kills and pop. Pop meter against the cap. Best veterans / Clear. Over-cap clicks shake with a reason. Veteran's Oath note. Confirm.
- **Event**: woodcut SVG plate per event, drop-cap text, choice buttons (disabled ones show the reason), outcome panel, Continue.
- **Camp**: plate and Rest / Drill / Muster cards with run-resolved descriptions (`campOptions`). Each card shows context: Resolve pips, the units that rank up, or the drafts taken so far.
- **Peddler**: plate, purse, stock grid (boon crests, draft and sellsword portraits, rarity rings, prices shown red when unaffordable, sold stamp). Buy, Reroll Boons (cost shown), Leave. "Restore Resolve" is disabled at full Resolve.
- **Run Summary**: won or lost crest and title, Renown lines that tally in, earned total count-up, "you now hold", next-unlock progress bar, Thornbound tier-unlocked callout, chronicle, then Hall of Banners.
- **Hall of Banners**: all 14 unlocks as pennant cards in GDD order, with Codex chain connectors. States: Raised, affordable (Raise + cost, glowing), Need N more, Sealed (requires X). A raise flashes and plays `rank_up`. Side panels list Houses, Thornbound tiers and the record.
- **How to Play**: five tabs (←/→ keys).
  - Controls table from GDD §O, plus build keys.
  - Counter Wheel SVG: the primary triangle and an Ember loop of Ashpike → Destrier → Oathshield → Bowman → Ashpike, with unit portraits.
  - Economy primer.
  - Nest/Spent 5-step loop.
  - The march.
- **Settings modal**: effects volume, mute, edge pan, pan speed, hints, and reset progress (with a confirm that clears meta and run).

**Assets and styles**
- Self-hosted Cinzel and Alegreya Sans woff2 files (Latin and Latin-ext) in `public/fonts`, with `OFL.txt`. The Google Fonts `@import` is gone, so the game works offline.
- `public/favicon.svg`. `index.html` now has a description, theme-color, font preloads and an initial `ui-scaled` class.
- Styles: `src/styles/theme.css` (tokens; all existing tokens kept, new ones added), `fonts.css`, `ui.css` (components), `screens.css`, `map.css`, `ceremony.css` (flip, banner sweep, ink, glows, reduced-motion fallbacks).

**Dev-only gallery** (`src/app/dev/gallery.ts`, loaded only under `import.meta.env.DEV` with `?dev=<screen>`)
- Drives the real run API on `MemoryStorage`, so the real save is untouched, and pokes run state to reach any screen.
- Screens: `title|setup|map|briefing|results|reward|retinue|event|camp|peddler|summary|hall|howto|opening|settings|battle`.
- Parameters: `&steps=N`, `&outcome=defeat|retreat`, `&ev=<eventId>`, `&won=1`, `&renown=`, `&unlocks=`, `&tier=`.
- Verified absent from the production bundle.

## Deferred / not done
- No music. Ambient and combat drums belong to audio and battle.
- No key rebinding (deferred in the GDD).
- The Settings modal does not expose `setAmbient`.

## Contract changes
None. I changed no contract file. I consume these additions made by others: `BattleCallbacks.onSettingsChange`, `BattleOptions.sfxVolume` and `muted` (battle-shell), and `currentEventView`, `campOptions`, `markHintSeen`, `RewardStep.subtitle` and `rankUp` (run).

## Known issues and notes
- `theme.css` no longer `@import`s Google Fonts. It imports the local `fonts.css`. Token names are unchanged for `hud.css`.
- Peddler sellsword labels from the run layer read "3 Rank I Bowmans". The Peddler screen composes its own name ("3 Bowmen"). The run agent may want to fix `peddler.ts` labels.
- Running `npx vite` in this shared tree triggers HMR full reloads whenever anyone saves a file. For stable screenshots I used a scratch Vite config with `server.hmr: false`.
- Headless Chromium throttles rAF on static pages, so fps probes there are misleading. A Chromium trace of the run map showed about 0.7 ms/frame of paint and raster at 1080p.

## How to test
- Unit: `npx vitest run tests/app` (10 tests: map layout and determinism, ink paths, region labels, traveled path and node states over a real walked run, Retinue cap and greedy picks, formatting).
- Typecheck: `npx tsc --noEmit 2>&1 | grep -E '^src/(app|main)|^tests/app|^e2e/app'` is clean, also with `--noUnusedLocals --noUnusedParameters`.
- E2E: `npx playwright test e2e/app.spec.ts` (stock config: build + preview on 4173). 3 tests:
  - Full flow: Title, New Run, Setup, Map, start node, Briefing (Vanguard pick), battle mounts, `__game.win()`, Results, Draft pick, Retinue, Map with progress, then reload and Continue.
  - Hall, How to Play and Settings.
  - `?battle=raze` to Results to Title.
  - Screenshots go to `test-results/app/*.png`.
- Visual: `npx vite --port 5188 --strictPort`, then open `http://localhost:5188/?dev=map&steps=3` (or any gallery screen), or `/` for the real flow, or `/?battle=elite&depth=4&seed=9`.
