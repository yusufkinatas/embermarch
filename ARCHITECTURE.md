# EMBERMARCH architecture

Browser RTS roguelike. TypeScript 7 + Vite 8 + Canvas2D (procedural vector art, no image assets) + HTML/CSS UI + WebAudio synth. Vitest for headless tests, Playwright for browser tests.

The design source of truth is `docs/GDD.md` (sections A-R). This file is the engineering contract between modules.

## Layers and dependency rules

```
src/core      rng, math                                   (no deps)
src/data      typed data tables transcribed from the GDD  (imports only sim/types, data/types)
src/sim       deterministic simulation, NO DOM            (core, data)
  sim/nav       grid, A*, flow fields, spatial hash, movement, fog
  sim/encounter wave director, enemy AI, Blight, objectives, Noble, Boss
src/mapgen    procedural battle maps, NO DOM              (core, data, sim/types)
src/run       run map, rewards, events, peddler, meta save (core, data, sim/types; localStorage guarded)
src/render    Canvas2D renderer, icons, minimap, fx       (sim types + read-only sim queries, data)
src/audio     WebAudio synth sfx                           (game/types)
src/game      battle controller, input, HUD, debug API     (everything above)
src/app       screen router + all non-battle screens       (run, game, render/icons, audio)
```

- `src/sim/**` and `src/mapgen/**` and `src/run/**` must never touch `window`, `document`, canvas or audio (run may use `localStorage` only through its guarded storage helper). They must run under Vitest `environment: 'node'`.
- Rendering never mutates the world. The HUD/input mutate the world ONLY through `issueCommand(world, cmd)`.
- All gameplay randomness: `world.rng` or `rng.fork(label)`. Cosmetic randomness (particles): `Math.random`.

## File ownership (one owner per file; do not edit files you do not own)

| Owner (agent) | Files |
|---|---|
| data | `src/data/*.ts` except `src/data/types.ts` (contract) |
| nav | `src/sim/nav/**`, `tests/nav/**` |
| sim-core | `src/sim/{world,entities,orders,combat,stats,queries,commands,behavior,production,economy,abilities,hooks}.ts` and any new `src/sim/*.ts` file, `tests/sim/**` |
| encounter | `src/sim/encounter/**` (incl. `types.ts`, may extend), `tests/encounter/**` |
| mapgen-audio | `src/mapgen/**`, `src/audio/**`, `tests/mapgen/**`, `tests/audio/**` |
| run | `src/run/**` (incl. `types.ts`, may extend), `tests/run/**` |
| render | `src/render/**` (except `camera.ts` which is shared/frozen), `tests/render/**`, `gallery.html` |
| battle-shell | `src/game/**` (except `types.ts` contract), `src/styles/hud.css`, `tests/game/**`, `e2e/battle*.spec.ts` |
| screens | `src/app/**`, `src/main.ts`, `index.html`, `src/styles/*.css` except `hud.css`, `e2e/app*.spec.ts`, `public/**` |

Contract files (`src/sim/types.ts`, `src/data/types.ts`, `src/game/types.ts`, `src/run/types.ts`, `src/sim/encounter/types.ts`, the exported signatures in every stub file) may only be changed ADDITIVELY (new optional fields, new exports, new union members). Re-read a contract file immediately before editing it (others may have edited it), keep edits minimal, and list every contract change in your final report. Never change an exported signature that another module calls.

Each stub file exports functions whose bodies `throw new Error('not implemented')`. The owner replaces bodies and may add exports, helper files and internal state, but keeps the exported names and signatures.

## Coordinates and units

- World unit = 1 tile = 32 px at zoom 1 (`TILE_PX`). Entity `x, y` = center in tiles. Tile index `ty * w + tx`.
- Buildings/resources: top-left `tx, ty`, footprint `w × h`; center `(tx + w/2, ty + h/2)`.
- Ranges are EDGE-TO-EDGE (`nav/geometry.edgeDistance`): unit radius for units, footprint rect for buildings/resources.
- Fixed tick 20 Hz (`TICK_DT = 0.05`). Times in data are seconds; convert with `Math.round(s * TICK_RATE)` when storing ticks.
- Battle clock `world.time` starts after the 3 s Kindle countdown (`world.countdown`).

## Simulation tick (sim-core `stepWorld`)

0. If `countdown > 0`: decrement, update fog, return.
1. `tick++`, `time += TICK_DT`; copy `x/y → prevX/prevY` for units and projectiles.
2. `nav.rebuildSpatial(world)`.
3. `encounter.tickEncounter(world)`: director timers, musters/launches, enemy AI decisions (via `orderUnit`), garrisons, Blight growth/ward/effects, beacons, caches, objectives, Noble/Boss abilities. Sets victory via `endBattle(world, 'victory')`.
4. Production & timers (sim-core): training queues, research, construction is driven by builders in step 5, passive income (Ember Tithe), buff expiry, ability cooldowns, Warden respawn, Rally the Hearth.
5. Unit behaviors (sim-core): burns/regen/auras, then per-order logic (auto-acquire for idle/attack-move/hold player units, attack execution & projectiles, gather/deposit/build/repair, Tiller flee). Behaviors only SET `unit.move` (via `nav.setMove`) — they never move units directly.
6. `nav.stepMovement(world)`: moves units with intents (paths, flow fields, separation, stuck detection), sets `moveStatus`, `blockedBy`.
7. Projectiles fly/impact (`combat.applyPacket`).
8. Building defensive fire (Hearth, Brazier Towers, Thornspires — any building whose def has `attack`, units only).
9. Remove dead entities from the live lists (they stay out of `world.entities` too; keep ids monotonic).
10. Every 4th tick: `nav.updateFog(world)`.
11. Defeat: Hearth destroyed → boss battle with Resolve: Last Stand (sim-core), else `endBattle(world, 'defeat')`.

Enemy AI division of labor: the encounter module decides WHAT enemy units do (it calls `orderUnit(world, u, {type:'attack', targetId})`, `{type:'attackMove', ...}`, `{type:'move', ...}` and may set `u.move` directly with `mode: 'enemy'` flow fields). sim-core executes orders identically for both sides (approach to range, cooldowns, projectiles, damage). For units with `u.ai !== null`, sim-core does NOT run player-style auto-acquire; encounter handles targeting for them (engage priority, leash, retarget every 0.5 s). When an enemy unit's `moveStatus === 'blocked'`, `u.blockedBy` holds the player building id in its way; encounter orders it to attack that building.

## Cross-module hooks

- sim-core `killEntity` → `encounter.onEntityDeath(world, e, killerId, opts?)` (`opts.demolished` for a player demolition, which does not break Holdfast "Unbroken"); Retinue/kill credit, rank-ups, boon hooks (Spoils of the Wake, Plunderers) in sim-core.
- sim-core damage application → `encounter.onEntityDamaged(world, target, attackerId, amount)`.
- sim-core building complete / player building death → `encounter.onPlayerBuildingChanged(world)` (ward recompute).
- Terrain change (tree felled) → `nav.onTerrainChanged(world, tile)` (updates grid, pushes `world.dirtyTiles`).
- Spawning a building/resource → `nav.setFootprint`; removal → `setFootprint(..., 0)`.
- `createWorld` order: map → grid/spatial/fog/blight arrays → players (effects composed) → resources from anchors → Hearth + Vanguard + watchtowers → starting units (7 Tillers + extra, Courser, Warden, Retinue, Sellswords) → explore radius 10 around the Hearth (Cold Watch-Fire: explore all) → `encounter.initEncounter(world)` → initial fog.
- `createWorld(setup, gen, opts?: { skipEncounter?: boolean })` — tests may skip the encounter (no enemies, no objectives).

## Flag ownership (EffectFlag)

| Flag | Implemented by |
|---|---|
| spoils_of_the_wake, firebrand, field_surgeons, flame_banner, plunderers (resources; crowns via `encounter` plunder counter is fine too), raiders_bounty, flame_hearth (regen part; HP/volley via stat effects), ember_tithe, second_wind, home_seam_bonus, hearth_watch, thunder_charge, hawk, burn_disabled | sim-core |
| kiln_masons | sim-core (placement on Blight, 2× build) + encounter (ward radius 3) |
| kindled_earth | encounter (ward radius 5) + nav (ignore Blight slow) + sim-core (ignore Blight gather penalty) |
| baggage_train, veterans_oath | run |

## Modifier ownership (ModifierId)

| Modifier | mapgen | sim-core | encounter | run |
|---|---|---|---|---|
| blood_moon | | | wave/raid value ×1.3 | Crowns ×1.5 |
| thick_fog | | player sight −2 (min 3) via enemyEffects/playerEffects stat | acquire radius 4, Horn 10 s, no composition | +20 Crowns |
| bountiful_wilds | +6 Thickets cluster at 7-10 | | T1 −20 s | |
| creeping_wake | | | Blight every 12 s, cap +3 | reward offers 4 |
| ember_famine | no home Seam, contested 1500 | | | +25 Crowns |
| fortified_nests | | | Nest HP +50%, +1 spire per Nest | plunder ×2 (encounter counts plunder) |
| swift_hunt | | (enemy cavalry speed via enemyEffects) | doctrine = hunt | +20 Crowns |
| downpour | | ranged −1 range (both sides via effects), burn disabled (flag) | spires −1 range | |
| ancient_cache | ancient cache anchor 14-20 tiles | | guard 6+2d, loot +60 Crowns | extra Rare pick |
| old_watchtowers | 2 tower anchors 7-9 tiles toward nearest Nest | spawn 2 built player towers | | |

## Debug / test API (`window.__game`)

Installed by `src/app` at startup (always on; harmless), extended by the battle controller while a battle is mounted:

- App level (screens): `screen(): string` (current screen id: 'title' | 'setup' | 'map' | 'briefing' | 'battle' | 'results' | 'reward' | 'retinue' | 'event' | 'camp' | 'peddler' | 'summary' | 'hall' | 'howto'), `run(): RunState | null`, `meta(): MetaSave`, `newRun(opts?)`, `quickBattle(opts)`.
- Battle level (battle-shell): `world` (getter), `state()` → `{ time, outcome, res, pop, popCap, playerUnits: Record<type,count>, enemyUnits: number, nestsAlive, selection }`, `spawn(type, x, y, team)`, `grant(res)`, `win()`, `lose()`, `setSpeed(n)`, `step(seconds)` (synchronous sim advance), `forceWave(n, doctrine?)`, `issue(cmd)`, `select(ids)`, `reveal()`, `camera`, plus `pause(on?)`, `ended()` and `renderStats()` (renderer frame timings).
- URL params: `?seed=N` (new run seed), `?battle=raze|holdfast|elite|boss|beacons&depth=N&seed=N` (skip straight into a quick battle).

## Testing conventions

- Unit/integration tests: `tests/<module>/*.test.ts` (Vitest, node env). Shared fixtures live in your own module folder (`tests/<module>/helpers.ts`).
- End-to-end headless battles: `tests/integration/` (integrator). `bot.ts` is a scripted player that only uses `issueCommand`; `harness.ts` runs a real battle (mapgen + createWorld + stepWorld) and records waves, combat, economy, NaN checks and tick timings; `battle.test.ts` and `run.test.ts` assert on them (`BATTLE_LOG=1` prints a per-battle summary). The bot also runs inside the browser game: in the dev server, `await import('/tests/integration/bot.ts')` and call `new Bot(__game.world).update(true)` on a timer.
- Typecheck only what you own while others are mid-flight: `npx tsc --noEmit 2>&1 | grep -E '^src/(your/dirs)|^tests/(your-dir)'`.
- Run only your tests: `npx vitest run tests/<module>`.
- Browser checks: `npx vite --port <unique port>` in the background or `npm run build && npx vite preview --port <port>`; Playwright scripts in your scratch dir or `e2e/`. Use a port unique to your agent (nav 5181, sim-core 5182, encounter 5183, mapgen-audio 5184, run 5185, render 5186, battle-shell 5187, screens 5188, integrator 5190). Kill your servers when done.
- When finished, write `.agent-status/<agent>.md` with: done, deferred, contract changes, known issues, how to test.

## Performance budgets

60 fps with 140 units on 64×64 at 1080p. Sim tick ≤ 4 ms. A* ≤ 8 searches/tick. Fog at 5 Hz. Cache terrain/tree/blight/fog canvases; cull off-screen; never use `shadowBlur`/`filter` per frame; particles ≤ 400.

## Style

2-space indent, single quotes, semicolons, `strict` TypeScript, no `any` unless unavoidable (prefer `unknown`). `import type` for type-only imports (verbatimModuleSyntax). No new runtime dependencies without strong reason (only `simplex-noise` is installed).
