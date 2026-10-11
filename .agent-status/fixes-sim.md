# Fixes: sim lane

## Fix pass (S1-S14)

- **S1** Bowmen, Outriders, Coursers (and other units with structure multiplier < 0.5) no longer auto-target buildings. Idle and shot by a spire, they step 1.5 tiles out of its range, around trees if the straight-out spot is blocked. Explicit attacks and right-clicks are unchanged (`src/sim/behavior.ts`).
- **S2** Holdfast waves Hbase [8,13,18,25,34,52], own slope 0.06. No-input Holdfast d1-3 now always loses.
- **S3** Spent: 45 s after the break, cap 105 s; hint text derives from `SPENT.afterBroken`.
- **S4** Starting military spawns on the far side of the Hearth from the Tillers; new gather hint. Browser check: a box over the Tillers selects "7 selected · 7 Tillers".
- **S5** Shift-build/repair queues per Tiller only behind a build or a queue; a gathering Tiller starts it now and resumes its job.
- **S6** Kindling 450. **S7** Root Hearts 1200 HP, garrison 12.
- **S8** Last Nest/Regent and Hearth falling in the same tick is a victory; no Last Stand once the Regent fell.
- **S9** Kills from arrows/burns of dead attackers count (stats, Spoils); rank-ups still need a live killer.
- **S10** Free Courser (`Unit.free`) is carried as Retinue only from Rank I.
- **S11** Doctrine counsel starts with the doctrine name; Spines/Court have `answerCore` + `answerDrafts`; scout hint warns about Pickets.
- **S12** Ember Tithe discounts research (`researchCost`; command card shows 85 for Ember Edge); Grimbrand −20% train time; Smith and Firebrand texts.
- **S13** A builder whose source ran out picks the same resource within 10 tiles before idling.
- **S14** GDD synced for all lanes; before/after matrix and contract changes in `.agent-status/sim.md`.
- Test harness: bot skips empty repairs and no longer chases musters at Holdfast Nests; run.test accepts the boss-retry rule when its time cap cuts the boss off.
- Full suite at the end: 65 files, 745 tests green; `tsc --noEmit` clean.
