# run agent: done

## Done (src/run/**, tests/run/**)
Every exported signature in `src/run/index.ts` is implemented. The index is a thin facade over:

| File | What |
|---|---|
| `storage.ts` | Guarded localStorage (probe + try/catch on every access). In-memory fallback for missing, blocked or quota-full storage. Keys `embermarch.meta.v1` / `embermarch.run.v1`. `setStorageBackend()` + `MemoryStorage` for tests. |
| `persistence.ts` | `defaultMeta`, `loadMeta`/`saveMeta` (sanitized: version mismatch or garbage gives defaults, unknown unlocks dropped, missing settings defaulted), `loadRun`/`saveRun`/`clearRun` (structural validation). |
| `runmap.ts` | §B generator: 4 walkers, crossing rule with 10 retries, accepts 14-20 nodes in cols 2-7 (≥2 each), 50 tries then the 3-lane fallback. Type assignment: 200 attempts with every rule, then the fixed fallback. Battle rolls: objective (Raze 65 / Holdfast 35, or 50/25/25 when `BEACONS_ENABLED`), biome by column, modifiers (no dupes, Elite +1 negative), reward 55/25/20, doctrine available at depth (Swift Hunt forces Hunt), threat, per-node seed `hash(runSeed:nodeId)`. Start = Raze/Draft/no modifiers, boss = depth 7 Heartwood. `runMapViolations(map)` checks every rule. |
| `offers.ts` | §M Boon offers: 62/30/8 or 0/75/25 rarity per card, synergy ×2 (owned Boons, House and drafted-unit tags), Base + unlocked Codex, no dupes, exhausted rarity falls lower then higher, first-offer Rule guarantee. Draft pool with meta gating (Outriding, Lamplight). |
| `rewards.ts` | Reward queue. Steps are rolled lazily at the head of the queue, so earlier picks shape later offers. The head is always rolled before saving. Creeping Wake and Wayshrine give 4 options. An empty Draft pool gives a Boon pick. Skip pays +15. Retinue step: cap 6/+3 Oath/+3 Seasoned, pop-weighted; over-cap picks are dropped; Veteran's Oath +1 Rank. |
| `setup.ts` | `startBattle` / `quickBattleSetup`. Core units + drafts, core buildings (+ Siegeyard with Siegecraft). Player effects: House + Boons + meta (Hearth Lore, Hawk Eyes) + Refugee Tillers + modifier player effects + the pending Grain penalty. Enemy effects from modifiers. `waveMult` = Envoy × Thornbound I. Pending Blood Moon, Cold Watch-Fire, half-HP Warden and Baggage `bonusRes` applied. Grimbrand Retinue ≥ Rank I. |
| `results.ts` | `finishBattle`. Itemized Crowns: 20+4d, plunder, par, Unbroken/Uprooted, flat modifier bonuses, ×1.5 Blood Moon, then +40 Elite. Spoils +80. Retreat keeps plunder only; defeat pays 0. Resolve: −1 on defeat or retreat; boss subtracts `lastStandsUsed`. Run-over detection, reward + Retinue queue, Baggage Train carry-over, stats. Idempotent once applied. |
| `events.ts` | All 6 events with exact outcomes and enabled/reason per choice (Smith bargain disabled below 2 Resolve; duel 50% via run RNG). Camp Rest/Drill/Muster with resolved descriptions. |
| `peddler.ts` | Stock: one Boon per rarity at 55/100/175, Draft 90, Resolve 90, 2 distinct Sellsword offers. Reroll 15 +10 per repeat. Guild Ties: −15% on everything (rerolls too) and +1 Boon. |
| `meta.ts` | Unlock chain and Renown costs, Houses, tiers (win at tier k unlocks k+1), `renownFor` with lines and the Thornbound multiplier, idempotent `endRun` with next-unlock progress, `markHintSeen`. |
| `lifecycle.ts` | `newRun` (Fourth Banner gives 4/4, Opening Boon queues a Common pick, `profileRunIndex`), `reachableNodes`, `enterNode` (autosave, Retinue snapshot, event roll without repeats then Camp, Peddler stock; re-entering the current node is stable), `leaveNode`, `resolveInterruptedBattle`. |
| `briefing.ts`, `display.ts` | `getBriefing` (doctrine answer for a profile's first 3 runs, par, reward text, quit-cost text, canRetreat=false for the boss), `boonInfo`, `draftInfo`. |

All randomness goes through the run RNG (`rngState` in RunState). A reloaded run rolls identically.

## Contract changes (all additive, all in `src/run/types.ts` / `src/run/index.ts`, files I own)
- `RewardStep`: optional `subtitle` on every kind. Optional `spec?: OfferSpec` on boon and draft steps. Optional `rankUp?` and `rolled?` on retinue steps. New exported `OfferSpec`.
- `PeddlerStock.rerolls?: number`. `RunState.summary?: RunSummary`, `RunState.lastBattle?: PostBattle`. New `CampOption` type.
- New exports from `src/run`: `BEACONS_ENABLED`, `generateRunMap`, `runMapViolations`, `MemoryStorage`, `setStorageBackend`, `META_KEY`, `RUN_KEY`, `KeyValueStorage`, `BoonInfo`, `DraftInfo`, `availableTiers`, `markHintSeen`, `nextUnlock`, `currentEventView`, `campOptions`.
- `boonInfo` additionally returns `rarityId`, `tagIds`, `pool`. `draftInfo` additionally returns `unitIds`, `tagIds`. Still assignable to the original return types.
- `NewRunOptions` is now a type re-export from `lifecycle.ts`, same shape.
- No edits to `sim/types.ts`, `data/types.ts`, `game/types.ts` or `encounter/types.ts`.

## Decisions / known issues
- `BEACONS_ENABLED = false` (as instructed). Encounter has Beacons code in progress. Flip the flag once Beacons is verified.
- Boss battles never get modifiers, which matches the encounter (`modsOf([])` for the boss). A pending Blood Moon therefore never reaches the boss. The Hollow Envoy's "Cut him down" text says so when only the boss lies ahead, and no pending effect is added.
- Wayshrine "Pray" is disabled at full Resolve (the GDD is silent; otherwise it would cost a Boon for nothing).
- Boss defeat with Resolve still left (the sim did not apply Last Stand) falls back to the Autosave rule: −1 Resolve and restart the boss.
- An interrupted non-boss battle restores the node-entry Retinue and drops that battle's Sellswords and pending effects. The boss restart keeps them.
- Ranking a carried unit up (Oath, Drill, Grimbrand, Sellswords) raises `kills` to that rank's threshold, so kill-derived ranks stay consistent. Sim-core only raises ranks, never lowers them.
- An event node becomes a Camp by mutating `node.type = 'camp'` once all 6 events are used.
- `enterNode` silently resolves a leftover `battleInProgress` as a safety net. The app should call `resolveInterruptedBattle` on Continue to show its message (it already does).
- `showHints` = `settings.showHints && (first 3 runs || some hint unseen)`.
- Ashwood +100 Grain is applied by sim-core (`players.ts`), not via `bonusRes`.
- Outriding/Lamplight are real Draft unlocks (SHOULD path). The War Chest/Stout Heart fallbacks are not implemented because sim/render implement the units.

## How to test
- `npx vitest run tests/run`: 106 tests, ~0.8 s. Covers 1000 maps with every §B rule (paths enumerated independently), forced fallbacks, roll distributions, offer rules, the Crowns §M typical values and Renown bands, storage (throwing, missing, version mismatch), save/load determinism, interrupted battles, Retinue cap and rank-ups, all event outcomes, Camp, Peddler pricing incl. Guild Ties, BattleSetup per House and meta unlock, and a 200-run fuzz through the public API with random reloads.
- `npx tsc --noEmit 2>&1 | grep -E '^src/run|^tests/run'` is clean, also with `--noUnusedLocals --noUnusedParameters`.
- Browser: checked on port 5185 by importing `/src/run/index.ts` in a page. The run and meta keys are written, and after a reload the interrupted battle resolves as a Retreat.
