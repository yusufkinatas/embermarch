# data agent: done

## Done
All GDD tables transcribed into typed data under `src/data/` (import from `src/data` or the specific file):

- `balance.ts`: every numeric constant, grouped: START, POP, CAPS, GATHER, FLEE, RESOURCE_AMOUNTS, INCOME, BUILD, RALLY_HEARTH,
  VETERANCY, RETINUE, WARDEN, ABILITIES (house abilities + Hawk), STACKING, CLASS_STRUCT_MOD, COMBAT, BURN, PROJECTILE_SPEED,
  ACQUIRE, LAST_STAND, NAV (incl. collision radii), DEPTH, WAVE_MULT, ASCENDANT, HOLDFAST, DIRECTOR, SPENT, ADAPTATION,
  ENEMY_AI, GARRISON, LURKERS, THORNSPIRE, PICKET, RAID, BLIGHT, PAR, BEACONS, RETREAT, RESOLVE, NOBLE, BOSS (BOSS_F etc.),
  OBJECTIVE_ANCHORS, RAZE_NEST_DIST_FRAC, MAPGEN, FAIRNESS_KIT, CACHES, BOSS_MAP, RUN_MAP, OBJECTIVE_WEIGHTS(_NO_BEACONS),
  REWARD_TYPE_WEIGHTS, BIOME_WEIGHTS, MODIFIER_ROLLS, NEGATIVE_MODIFIERS, REWARDS, CROWNS, RENOWN, THORNBOUND_EFFECTS,
  PEDDLER, CAMP, EVENT_NUMBERS, ENEMY_UNLOCK_DEPTH, FORCED_DOCTRINE, MODIFIER_NUMBERS.
  Pure helpers: floorEps, netIncome, buildTime(base, n), rankForKills, wardenRespawn, armorDamage, acquireRadius,
  groupArrivalRadius, depthFactor, firstWaveLaunch, waveInterval, waveBase, waveValue(n,d,N,M), waveLaunchTime, nestFactor,
  nestHp, nestCount, nestsFor(objective,d), garrisonValue, picketValue, cacheGuardValue, ancientCacheGuardValue,
  beaconGuardValue, raidValue, raidLaunchTime, blightCap, blightParams(objective,d,creeping), rootbreakerCap, threatRating,
  holdfastWaveValue, nobleHp, bossWaveValue, regentHp, parSeconds, cacheCount, battleCrownsBase, renownTotal.
- `units.ts` UNITS (11 player + 9 enemy incl. antlered_lord at d3 HP, briar_regent at phase-2 base HP).
- `buildings.ts` BUILDINGS (player/enemy/neutral), BUILD_MENU (Tiller menu order), PRODUCTION_BUILDINGS.
- `resources.ts` RESOURCE_NODES (thicket, tree, ember_seam), SEAM_AMOUNTS.
- `research.ts` RESEARCH (11, Tempers flagged), THUNDER_CHARGE numbers.
- `boons.ts` BOONS (25) + FLAME_HEARTH_REGEN, FIELD_SURGEONS, FLAME_BANNER, BAGGAGE_TRAIN numbers.
- `drafts.ts`, `modifiers.ts`, `events.ts` (choice ids: pay/arm/tithe, bargain/mercy, hire/duel/decline, watch/scavenge,
  accept/cut_down, pray/offer/leave; EventChoiceId type), `houses.ts`, `meta.ts` (META_UNLOCKS, META_UNLOCK_ORDER,
  META_FALLBACKS, THORNBOUND tiers, thornboundFor(tier)), `doctrines.ts`, `biomes.ts`, `objectives.ts` (OBJECTIVES, VANGUARDS),
  `text.ts` (resource/class/rarity/tag names, ALERT_TEXT, TEXT templates, HINTS, CAMP_TEXT, NODE_NAMES, REWARD_NAMES),
  `palette.ts` (PALETTE from §A), `ids.ts` (runtime id lists for every union), `index.ts` barrel.

## Contract changes (additive)
- `src/data/types.ts` MetaUnlockDef: added optional `effects?: Effect[]` (hawk_eyes → flag hawk, hearth_lore → startUnits tiller 1)
  and optional `scope?: 'MUST' | 'SHOULD'`.

## Notes for consumers
- Thorn Nest def HP is the d1 value; use `nestHp(d)` × Fortified (MODIFIER_NUMBERS.fortifiedNestHpMult) × Thornbound II.
- Antlered Lord def HP is d3; use `nobleHp(d)`. Regent def HP is 3000; use `regentHp(heartsAlive)`.
- Gatebreaker/Rootbreaker carry `structMod: 4` (the ×4 vs structures); Gatebreaker `vsBoss: 1.5`.
- Briar Throne and neutral objects are `invulnerable` + `untargetable` (hp 1 placeholder).
- Downpour puts `burn_disabled` in both playerEffects and enemyEffects; range −1 on ranged military + attacking buildings per side.
- Ember Tithe's "Ember costs −15%" is encoded for units and buildings; research costs cannot be targeted by a Selector.
- Grimbrand trainTime pct −25 for ashpike/oathshield (as specified by the task); Retinue min Rank I is RETINUE.grimbrandMinRank (run).
- Elite always has 2 Nests (`nestsFor('elite', d)`).
- Lampbearer: atk 0, cooldown 0, range 0, aura radius 3. Treat cooldown 0 as "does not attack" (Ember Edge could add ATK).

## Known issues
- `PROJECTILE_SPEED.firepot` (7) is not in the GDD; the Firepot uses ABILITIES.firepot.flightTime (1.0 s).
- Antlered Lord / Regent sight (9 / 10) are not in the GDD; chosen values.
- House colors / mottos and event flavor text are original writing (not GDD numbers).

## How to test
- `npx vitest run tests/data` (34 tests: coverage, counts, hotkeys, costs, Effect validity, §C wave/Holdfast/boss tables,
  §G 1v1 checks, §D income, run tables).
- `npx tsc --noEmit 2>&1 | grep -E '^src/data|^tests/data'` (clean).
