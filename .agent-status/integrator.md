# Integrator status

## State of the build

- `npx tsc --noEmit`: clean.
- `npx vitest run`: 58 files, 654 tests, all passing (two consecutive runs, the integration tick-budget checks are stable under parallel load).
- `npm run build`: succeeds (673 kB JS, 226 kB gzip).
- `npx playwright test` (stock config: build + preview on 4173): 6/6 passing (e2e/app.spec.ts, e2e/battle.spec.ts).
- Browser checks against `npx vite --port 5190` (stopped afterwards): every scenario ended with a clean console (no `error`, `warning` or `pageerror`).

## Done

### Headless end-to-end battles (`tests/integration/`)
- `bot.ts`: a scripted player that only reads what a player could see and only acts through `issueCommand`. Tillers split over Grain / Timber / Ember by stockpile, Storehouse at the reserved forest site at 0:00, Bowyard ~0:35, an Ember Storehouse, Cottages ahead of the cap, Grainplots before the near Thickets run out, a Forgehall + Ember Edge, Brazier Towers and a Paddock by doctrine (briefing answers: Spines → Coursers, Swarm → spears + bows + towers, ...). Army stages 6 tiles toward the nearest Nest, defends visible wave threats, and runs "defend, then punish": push after a wave breaks (Spent Nest first), travel with move past Pickets, clear defenders, hit the Nest itself (its spires wither with it), go home if the next wave is coming. Uses Rallying Horn and Rally the Hearth. Beacons objective: a squad clears guards and Tillers hold the stones.
- `harness.ts`: runs a real battle (quickBattleSetup + generateMap + createWorld + stepWorld) with the bot, records musters/launches/breaks, hits at the base, closest wave approach, NaN/off-map checks every 0.5 s, pool caps, economy snapshots every 30 s, death attribution and per-tick timings. `BATTLE_LOG=1` prints a summary per battle.
- `battle.test.ts` (10 tests, ~8 s): Raze d1 seeds 2/4/5 (schedule vs T1 + (n-1)·I to 0.2 s, first Tiller 0:10, Tillers 11-14 at 1:00 / 16+ at 2:00 / 19+ at 3:00, 450-1000 resources/min at 3:00-5:00, army ≥ 6 at 3:00 / ≥ 12 at 4:00, waves reach and fight the base, tick avg < 2 ms and p99 < 4 ms, caps ≤ 50/80) and the bot wins ≥ 2 of 3 inside 12 minutes (currently all 3: 6:17-6:32) with a coherent BattleResult; Holdfast d3 seeds 1/2 (fixed schedule 60/105/…/285 s, the Great Wave launches once per living Nest, victory "Waves 6/6"); Noble Hunt d3 (Lord joins wave 3, rides out > 10 tiles and kills player units); Beacons d2 (stones light, Kindling 300/300 victory); Boss (Hearth waves at 100 + 60(n-1) s, Wrath brings phase 2 at exactly 8:00 when no Heart fell); a cross-module hook test (Holdfast "Unbroken" survives a demolition, breaks on a building lost to the Thornwake).
- `run.test.ts` (~7 s): a whole run through the public run API where every battle is real and bot-played: Retinue and Sellswords spawn on the field with the right types and ranks, Boons/Drafts reach the BattleSetup, Crowns/Resolve flow back via finishBattle, events/camps/peddlers resolve, and endRun awards Renown.

### Fixes (cross-module and gameplay)
- `src/sim/behavior.ts`: units preferred over buildings (GDD §F). A unit fighting a structure on its own initiative (idle or attack-move) now switches to an enemy unit entering acquire range, or to whoever just hit it. Before, armies stood plinking a Thornspire for 20+ s while garrison Spinecasters shot them.
- Demolition vs Holdfast "Unbroken": `encounter.onEntityDeath(world, e, killerId, opts?)` gains an optional `opts.demolished` (passed by sim-core `killEntity`), so tearing down your own building no longer loses the +30 Crowns.
- `src/mapgen/kit-seams.ts`: the home Ember Seam avoids every Nest by 12+ tiles when possible (Holdfast Nests are only 17-23 tiles out, and seeds put the home Seam 7 tiles from a Nest, inside garrison aggro and Blight). Sweep: 0/300 home Seams within 12 of a Nest for holdfast, raze and beacons (min 12.0 / 20.4 / 28.9).
- Beacons enabled in runs (`BEACONS_ENABLED = true`, objectives roll 50/25/25) after an end-to-end check: dormant until 1:30, capture in 10 s, Kindling 300 victory at ~3:45 under par, Ember +0.3/s, snuff/contest, waves target the lit stone. The run-map rule checker allows beacons when enabled and the 65/35 distribution test passes `beacons: false` explicitly.
- `src/run/peddler.ts`: Sellsword labels read "3 Rank I Bowmen" (was "Bowmans").

### Fixes (HUD / visual / UX)
- "Kindle!" no longer lingers after a fast-forward or debug step (hidden once the battle clock is past 1.5 s).
- The Last Stand / Regent callout no longer sits on top of the Victory / Defeat banner.
- The "Waves −X%" popup rises toward the Horn but stops below it, so it never covers the wave line.
- Boss bar for the Antlered Lord reads "Hunting" with a Noble tooltip (it said "Enthroned" and "Uprooted. It marches on your Hearth.").
- Quick battles (`?battle=`): the pause menu no longer claims "Your run is saved… −1 Resolve".
- Beacon Stone selection status: "Dormant · wakes in 0:12", "Unlit · keep a unit beside it for 10 s", "Kindling 40%", "Contested", "Lit · being snuffed 30%", "Lit · scoring Kindling and Ember".
- Command card uses the renderer's dedicated icons for research, House abilities, Rally the Hearth, Hawk, commands and demolish (added `EXTRA_ICON_KEYS` to the HUD icon filter; was a lettered glyph fallback).
- Run Setup: the "Sealed" plate on locked Houses no longer covers the House name and motto.
- Retinue screen: cards are centred (a lone veteran sat at the far left).
- Debug API: `__game.renderStats()` returns renderer frame timings.

## Browser verification (Playwright scripts in the scratchpad `integ/`)
- (a) `?battle=raze&depth=1&seed=1`: countdown runs in real time; map, trees, Thickets, Seam, water, fog, units and buildings render; HUD shows resources/pop/clock/Resolve/tracker; box select picks 7 Tillers (military excluded per §O); right-click a Thicket gathers (+140 Grain in 25 s); H then Q queues a Tiller; C + click places a Cottage that completes (+6 pop); the Horn appears at 1:17 ("Wave 1 · 0:29 · N · Small · unscouted"), launches at 1:47; the wave reaches the Hearth and fights (counter popups, edge pulse, alerts); 2× speed advances 6 s in 3 s; `win()` → banner → Results → Title.
- (b) Full app flow (seed 20261010): Title → New Run → Setup → Map → Briefing → battle → win → Results → Draft reward → Retinue → Map (node checked, path inked) → Event (Refugees) → Peddler → Holdfast d4 → Raze d5 (Spoils, 4 options from Creeping Wake) → Noble Hunt d6 (Rare+ Boon then Draft) → Camp (Rest at full Resolve = +30 Crowns) → reload → Continue the March.
- (c) Retreat at 3:05 (−1 Resolve, Retinue pick) → defeat (−1) → defeat at 1 Resolve → "See the March End" → Run Summary (+15 Renown) → Hall of Banners.
- Reload mid-battle → Continue → "The battle was broken off… counts as a Retreat. −1 Resolve, no plunder."
- The bot playing inside the real game: Raze d1 won at 6:37 (rendered nest deaths, Blight recede, Spent markers, rank-ups), Boss at 1280×720 and Noble Hunt at 1920×1080, Beacons capture, a real-time 2× run of 75 s, and a 130-unit stress fight at 1080p (renderer ~8.5 ms/frame in software-rasterized headless Chromium, 0.5-2.6 ms in normal play; sim step with HUD ~0.7 ms).

## Findings for the playtest phase (not changed; balance or design calls)
- Holdfast at low depth can be won AFK: with no input at all, the Hearth + Warden + free Courser survive all six waves at d1 (2/2 seeds) and d2 (3/4 seeds, Hearth left at 466-1076 HP). Lost at d3+.
- Beacons look fast: the bot wins in 3:54-4:22 (GDD typical 4:30-6:00, par 5:30). With 3 stones lit Kindling runs at 3/s.
- Spinecasters (kite, ×1.5 vs infantry) are the top killer of Ashpikes in every bot run; Spines-doctrine battles were the bot's losses. Doctrine answer (Coursers) helps. Generic-AI checks: 6 Ashpikes vs 12 Thornlings wins by only +0.01 to +0.08 (GDD §R says +0.34); 6 Bowmen vs 13 Thornlings +0.40 to +0.51 (GDD +0.50).
- The bot wins Raze d1 in 6:17-8:31 on 6 of 10 seeds (4 stalemates, Hearth intact); GDD typical 4:30-6:00. Most stalls: the last Nest hosts every muster, and by 7:30+ waves grow (Ascendant at 9:00 caps waves at the 50-unit pool).
- Quick battles of the Boss and Elite without a Retinue or Boons are very hard (bot loses both); in a run they come with carried veterans.
- The free Courser is a military survivor, so it can be carried as Retinue every battle (allowed by §B, but it stacks up: 3 "Recruit" Coursers by column 6 in one run).
- Camera clamp keeps a 2-tile dark margin past map edges (a Hearth in a corner sits close to it). By design, but noticeable.

## Contract changes (all additive)
- `src/sim/encounter/index.ts`: `onEntityDeath(world, e, killerId, opts?: { demolished?: boolean })`.
- `src/game/debug.ts`: `DebugTarget.renderStats?()`; `window.__game.renderStats()`.
- `src/run/runmap.ts`: `BEACONS_ENABLED` is now `true` (export unchanged).
- ARCHITECTURE.md updated (hook signature, debug API, tests/integration).

## How to test
- `npx tsc --noEmit && npx vitest run && npm run build && npx playwright test`
- Bot battles with summaries: `BATTLE_LOG=1 npx vitest run tests/integration --silent=false`
- Bot in the browser: `npx vite --port 5190`, open `/?battle=raze&depth=1&seed=2`, then in the console `const { Bot } = await import('/tests/integration/bot.ts'); const b = new Bot(__game.world); setInterval(() => b.update(true), 250); __game.setSpeed(2)`.
- Scratch Playwright drivers (not in the repo): `integ/battle_a.cjs`, `flow_b.cjs`, `flow_c.cjs`, `battle_bot.cjs` (OBJ/DEPTH/SEED/MAXT env), `stress.cjs`, `reload_mid.cjs`, `ui_check.cjs` in the session scratchpad.
