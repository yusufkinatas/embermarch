# sim-core agent: done

## Done (src/sim/*.ts except nav/ and encounter/, tests/sim/**)

| File | What |
|---|---|
| `world.ts` | `createWorld` in the ARCHITECTURE order (map clone -> grid/spatial/fog/blight -> players -> resources (+Deep Delvers home Seam) -> Hearth + Vanguard (+Grainplot) + Old Watchtowers -> 7 Tillers + startUnits effects, Courser, Warden (wardenHpPct), Retinue, Sellswords -> explore r10 (Cold Watch-Fire: all) -> `initEncounter` unless `skipEncounter` -> fog). `stepWorld` with the documented 0-11 tick order. `issueCommand`, `drainEvents`, `buildBattleResult` (uses `encounter.getEncounterResult` for plunder/par/Holdfast/caches; own counters when the encounter is skipped), `endBattle` (once). |
| `stats.ts` | `composeUnitStats` / `composeBuildingStats` / `composeCost` (pure) + cached `unitStats` / `buildingStats` per (owner,type,rank), `costOf`, `gatherRate` (+ optional `extraPct` for Harvest Hymn), `carryCap`, `hasFlag`, `flagValue`, `computeFlags`, `invalidateStats`. §L: (set ?? base + Σadd) × (1 + Σpct); cost pct before flat, rounded, min 0; train time Σpct floored at −40%; positive range adds capped +2 (units and structures), negative range (Downpour) after the cap; sight ≥ 3; rank ×(1+0.15r) HP/ATK, Rank III +1 armor; structMod `set` overrides; volley adds; Kiln Masons halves tower build time. |
| `players.ts` | Player states from the setup (start res 250/300/75 + Ashwood +100 Grain + startRes effects + bonusRes), effect/flag recomposition after research, pop cap (Hearth 20, Cottage 6, popCap effects, hard cap 60), pay/refund helpers. |
| `entities.ts` | `spawnUnit` / `spawnBuilding` (foundations start at 10% HP) / `spawnResource`, getters, `killEntity` (pop, claims, Warden death + respawn timer + alert, kill credit, Spoils, Plunderers, Nest/Picket counters, footprint, `encounter.onEntityDeath`, `onPlayerBuildingChanged`). Optional 4th arg `{ demolished }`. |
| `orders.ts` | `orderUnit` (replace or queue, max 8), `stopUnit`, `startOrder`, `completeOrder`. |
| `behavior.ts` | Per-order execution for both sides: idle auto-acquire (6 tiles, ranged max(range+1,6), units before buildings, visible only for the player, retaliation), 10-tile leash + walk back (and a walk back to the idle spot after any auto-engagement), attack-move (leash from engage point), hold, move, explicit attack, melee retarget after 1.5 s without closing in (nearest enemy within 3), kite (Spinecaster/Outrider, not on Hold/Move, skipped when `ai.noKite`), Charge bookkeeping (resets after 1 s still), ranged overkill avoidance (skip targets doomed by projectiles in flight). `ai !== null` units: no auto-acquire, idle keeps encounter-set movement, orders execute normally. `ai === null` enemies attack the building in `blockedBy`. |
| `economy.ts` | Tiller gather loop (slots held for the whole job; nearest drop-off re-picked per trip; full node -> same resource within 8, else 3 s wait then idle + alert; depleted -> within 8 else idle + alert; trees per tile with a typed-array gatherer count, felled -> Stump + `nav.onTerrainChanged` + `treeFelled`; Blight ×0.6 unless Kindled Earth; Grainplot ripeness), deposit, build (base×3/(n+2), ≤4 builders, foundation HP grows), repair (8 HP/s, ≤4), completion (pop cap, alert, `built`, encounter ward hook, builders resume their job or farm the new Grainplot), flee (§D) with job resume, Ember Tithe income. |
| `combat.ts` | §G packet (counters, never vs hero/boss except vsBoss, structMod, resist, rank, ATK pct incl. Flame Banner / buffs, damage pct, Charge + Thunder Charge, Spent ×1.5), armor formula, min 1, splash falloff, burn (3 appliers, refresh, units only, `burn_disabled`, kill credit to the burner), hit events with throttled counter / resisted popups, under-attack / Tillers-attacked alerts, Raider's Bounty, Last Stand interception, `dealAbilityDamage`, `dealTrueDamage`, `applyBurn`, `canAttack`, `groundImpact` (Firepot). |
| `projectiles.ts` | Homing arrows 12 / bolts 14 / spines 10 tiles/s, fizzle when the target dies, ground-targeted Firepot with fixed flight time, pending-damage bookkeeping. |
| `defense.ts` | Hearth / Brazier Tower / Thornspire fire (units only), volley count (Flame Hearth 3, Ember Volley +2, max 5/3), prefers non-doomed targets. |
| `production.ts` | 5-slot queues (paid on queue, 100% cancel refund, shortest queue across selected buildings), pop check when training starts (head holds at cap, "Need Cottages" ≤ every 15 s via `popAlertTick`), spawn by BFS from the building edge toward the rally point (retry every 1 s), rally (point / resource / tree / Grainplot / foundation), research one at a time + Temper lock (cancel unlocks), research HP bonuses applied to living units, demolish/cancel refunds (100% before work, 50% after; queue + research refunded). |
| `abilities.ts` | Q per House (Rallying Horn, Harvest Hymn, Firepot ≤7 tiles 1 s flight, Ember Volley), W Hawk (flag `hawk`, `world.vision` r7 6 s), Second Wind −30% cooldowns, Warden respawn at the Hearth (45+15/death or 25+5), Rally the Hearth (save/restore jobs, drop loads, +2 ATK +1 armor, fight within 5, Hearth Watch 120/25), Last Stand (boss only: 40% HP, invulnerable 5 s, 150 + 3-tile knockback within 6, free Rally). |
| `status.ts` | Buff expiry (Rally restore), burn ticks, Lampbearer / Gloamwitch auras (max 2 stacks), Field Surgeons, Hearth of the Last Flame regen, `unit.speed` = composed × (1+Σ speedPct), 0 while rooted. |
| `placement.ts` | `checkPlacement` (explored, Grass/Stump, no occupant, no Blight except Kiln Masons towers, ≥3 tiles from enemy structures, in bounds; per-tile ghost flags), spawn-tile BFS, foundation displacement, building requirement reasons. |
| `commands.ts` | Every `Command`: smart RMB (§O: enemy -> attack, Gatebreaker -> move, resource/tree/Grainplot -> gather, own unfinished/damaged -> build/repair, drop-off with load -> deposit, else formation move with a shared flow key for ≥4 units), move/attackMove/attack/gather/build/repair/stop/hold/train/cancelTrain/research/cancelResearch/rally/demolish/rallyHearth/ability, player-facing reasons, `command` feedback events. A direct command cancels saved rally/flee orders. |
| `queries.ts` | `pickEntityAt` (fog-aware), `unitsInRect`, `trainOptions`, `researchOptions`, `buildOptions`, `commandCard` (stable slots/hotkeys, cost, enabled + reason, tooltip with Strong/Weak vs, cooldown/progress), `canPlaceBuilding`, `canAfford`, fog queries, `idleTillers`, `playerMilitary`, `buildingName`, `unitTooltip`. |
| `core.ts`, `claims.ts`, `hooks.ts`, `alerts.ts`, `vision.ts`, `movement.ts` | Private per-world state (WeakMap), gather slots, kill credit / rank-ups / boon hooks, alert throttling, fog helpers, `setMove` wrapper that keeps encounter speed caps. |

### Command card layout
5×2 grid, slots 0-4 top row, 5-9 bottom row. Buildings: Q/W/E train -> 0/1/2, Z/X/C research -> 5/6/7, V Rally the Hearth -> 8, demolish/cancel -> 9 (hotkey `'Del'`). Tillers: C,E,F,B,R,P,N,T,Y -> 0-8 (BUILD_MENU order, locked buildings omitted, slots stable). Warden in the selection: Q -> 0, W Hawk -> 1. `progress` = completed fraction (research progress or cooldown recovery), `cooldown` = seconds remaining.

### Buff.data keys read by sim-core
`atkFlat`, `atkPct`, `damagePct`, `armor`, `speedPct`, `attackSpeedPct`, `cooldownPct`, `gatherPct`; buff id `rooted` sets speed 0. (Encounter's wrath / enrage / rootsnare already use these.)

### Alerts emitted
under_attack (≤10 s per 12-tile area; Hearth text + high priority), tillers_attacked (≤10 s per area), idle_tillers (≤15 s), pop_capped (≤15 s), building_complete, research_complete, warden_fallen (with respawn time), warden_returned, last_stand.

## Deferred
- No `unit_trained` alert (would spam the toast feed); the `trained` event carries it.
- Alerts are not suppressed when the attacked area is on screen (the HUD can filter by camera).

## Contract changes (all additive, files I own)
- `stats.ts`: `UnitStats` gains `atkFlat`, `atkPct`, `rankMul`; `gatherRate` gains optional `extraPct`; new exports `composeUnitStats`, `composeBuildingStats`, `composeCost`, `selectorMatches`, `gatherPct`, `computeFlags`.
- `entities.ts`: `killEntity` optional 4th arg `KillOpts { demolished? }`; new `getResource`, `FOUNDATION_HP`.
- `combat.ts`: new `armorOf`, `chargeMult`, `counterMult`, `groundImpact`.
- `queries.ts`: new `unitTooltip`, `DEMOLISH_HOTKEY`.
- No edits to `sim/types.ts`, `data/types.ts`, `game/types.ts`, `run/types.ts`, `encounter/types.ts`.
- `Order.flee.resumeAt` is a tick number.

## Known issues
- Demolishing a completed building reaches `encounter.onEntityDeath`, which marks Holdfast "Unbroken" lost (sim-core's own `buildingsLost` excludes demolitions).
- Starting units are placed by a BFS ring around the Hearth (south side first); purely cosmetic.

## How to test
- `npx vitest run tests/sim` (114 tests in 11 files, about 3.5 s): composeStats rules and caps (§Q f), §G verified 1v1 numbers, counters (§Q a, 6 seeds, all 7 R-table matchups ≥5/6 with ≥30% mean HP edge), siege (§Q d: d4 Nest in about 42 s), Gatebreakers, Spent, economy rates vs §D, slots / full / depleted / trees / Blight, construction formula, refunds, repair, placement, flee, training / pop cap / rally / research / Temper, abilities, Warden respawn, Rally the Hearth, Last Stand, commands / command card / queries, an economy bot vs §R bands, determinism hash, a 140-unit perf test (about 0.6 ms/tick, worst about 3 ms), and a cross-module smoke with real mapgen + encounter for every objective.
- `npx tsc --noEmit 2>&1 | grep -E '^src/sim/[a-z]+\.ts|^tests/sim'` (clean, also with --noUnusedLocals).
- Browser: `npx vite --port 5182`, open `/?battle=raze&depth=1&seed=3`, drive with `window.__game.issue(...)` / `step(...)`.
