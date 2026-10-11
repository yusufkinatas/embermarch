# EMBERMARCH: Game Design Document v1.1 (implementation-final, revised)

## Provenance (v1.0 proposal judgement, kept for traceability)

| Criterion (1-10) | P1 Strategic | P2 Roguelike | P3 Scope |
|---|---|---|---|
| Strategic RTS feel | **9** (scouting gates wave intel, Nest-kill shrinks waves, Blight pressure, hero, raids) | 7 (good objectives, weaker economy tension) | 7 (solid but plain) |
| Roguelike replayability | 7 | **9** (synergy tags, archetypes, objective-aware routing) | 6 |
| Feasibility / polish risk (10 = safest) | 6 | 5 (10 units, 4 objectives, 3 warlords, burdens, rifts, aspects, dual armor) | **9** (data-driven, deterministic AI, flow fields, build order) |
| Originality / IP safety | **8** (single diminishing armor, Blight, doctrines) | 6 (melee/missile dual armor reads too close to the reference genre) | 7 (also dual armor) |
| Coherence | **9** | 7 | 8 |
| **Total** | **39** | 34 | 37 |

**Decision (v1.0).** P1 is the backbone: setting, economy shape, single-armor damage formula, Blight, a doctrine-driven wave director with scout-gated intel, the Warden hero, Houses and the boss. From P2 come synergy-tagged Boons, node previews and Retreat that saves veterans. From P3 come the Beacon meter, the free starting scout, the short worker name "Tiller", fairness stamps, the Raze-first build order, the flow-field and debug-API architecture, and headless counter tests.

**v1.1** applies the feasibility and game-feel critiques. The changes are listed in the Revision notes at the end. All numbers were re-checked with the scratch economy and combat sims (section R).

All distances are in tiles (1 tile = 32 px at zoom 1). Speeds are tiles/s and times are seconds unless marked m:ss. **"d" is battle depth, the column index of a battle node (1-6).** Column 7 holds no battles. The boss (column 8) uses its own named constants (`BOSS_F` and so on), never a formula in d. Every number lives in `src/data/balance.ts` and its sibling data files. Floors use `Math.floor(x + 1e-6)` to avoid float drift.

## A. Title, setting, pitch, tone, visual identity

**Title:** EMBERMARCH

**Setting.** The kingdom of Hallowmere has fallen to the **Thornwake**, a living briar-blight driven by the **Hollow Court**: nobles hollowed out and crowned in thorn. One flame of the royal hearth survives. This **Last Flame** is carried in a lantern, and wherever it touches earth a **Hearth** kindles. You are a **Warden** of a surviving House. You lead the **Hearthband** east along the Ember Road, through the Greenmarch, the Fenreach and the Ashwood, to burn the **Briar Throne** in the Heartwood and destroy the **Briar Regent**.

**Pitch.** Embermarch is a 35-44 minute real-time strategy roguelike. Each stop on a branching road is a 4-7 minute battle, and the final battle runs about 9. You kindle a Hearth with one Vanguard building already standing. You send Tillers to Grain, Timber and Ember and raise Ashpikes, Bowmen and Coursers. You push a rider close to a Thorn Nest to read the coming wave, break the wave, then strike the Nest while it is Spent. Between battles you draft new unit types, take Boons that bend your economy and army (some change the rules outright), and carry a Retinue of veterans forward. Losing costs Resolve. Every run earns Renown, which unlocks Houses, Codex Boons and options.

**Pillars.**
1. **Every Tiller is a choice.** One more worker now is one fewer spear when the horn sounds.
2. **Scouting pays.** You see a wave's makeup only if a unit gets close to its muster point, inside the Nest's guard.
3. **Defend, then punish.** A Nest that just launched a wave is Spent and takes extra damage. Every Nest that falls shrinks the waves and pulls its Blight back.
4. **Rewards bend build orders without replacing them,** and some Boons change the rules.

**Tone.** Storybook-grim and hopeful. Warm firelight against cold violet blight. UI text is terse and heraldic ("The horn sounds in the north-east.").

### Palette (hex)

| Group | Token | Hex |
|---|---|---|
| Player (Hearthband) | body / trim / outline | #E8A33D / #F4E6C1 / #2B1D0E |
| | Warden flame accent | #FFD27A |
| | selection ring / player HP bar | #7BE07F / #6FD06F |
| Enemy (Thornwake) | body / thorn accent / outline | #7B3FA0 / #8FD14F / #1E0F24 |
| | enemy HP bar | #D9443B |
| | Spent Nest tint | #A8987A at 60% over body |
| Neutral objects (Caches, Beacon Stones) | body / accent / outline | #8FA3AD / #D8E2E6 / #24313A |
| Shadows | unit drop shadow | rgba(0,0,0,0.30) |
| Resources | Grain / Timber / Ember | #E8C547 / #8B5A2B / #FF6A2B (Ember glow #FFB347) |
| Resource nodes | thicket bush / grain dots | #3E6B2E / #E8C547 |
| | Grainplot furrows, unripe to ripe | #B8963A to #E8C547 |
| | Ember Seam rock / cracks | #3A302C / #FF6A2B |
| Blight overlay | fill (45% alpha) / tendrils | #5A1F5E / #A04FB8 |
| Blight ward (Kindled Earth, Kiln Masons) | ward ring edge | #FFB347 at 20% alpha |
| Projectiles | arrow / Hearth and tower bolt / spine / Firepot + fire | #F4E6C1 / #FFB347 / #8FD14F / #3A2A1A + #FF6A2B |
| UI | panel / panel-light / border / text / muted | #1A1612 / #2A231C / #6B4F2A / #F4E6C1 / #A8987A |
| | accent / danger / good / counter popup / resisted popup | #E8A33D / #D9443B / #6FD06F / #FF8C1A / #A8987A |
| | rarity Common / Rare / Mythic | #B9A58A / #5FA8E8 / #E8A33D |
| Fog | unexplored / explored-not-visible | #0B0A0F at 100% / at 55% |
| Dusk tint | multiply overlay, 0% rising to 25% alpha as waves escalate | #2A3A6A |

| Biome | grass A / B | forest canopy / highlight | water / shallows | rock | extra |
|---|---|---|---|---|---|
| Greenmarch | #5E8C3A / #6A9A44 | #2F5A2A / #437A36 | #2F6E8E / #4F93A8 | #77716A | trunk #4A3423 |
| Fenreach | #4E7552 / #587F5B | #2B4D3D / #3B6650 | #2A5A66 / #3E7C80 | #6A6F66 | reeds #8A9A4E |
| Ashwood | #6D6955 / #77735E | #3A3A2E / #504E3E | #3A5560 / #50707A | #5A5550 | ember glints #FF7A2F |
| Heartwood | #4A3F4E / #544858 | #2A2234 / #3E3249 | #2E3F5A / #45597A | #4F4855 | briar wall #5B2E4A with #8FD14F thorns |

**Render style.** Top-down with a slight 3/4 look.
- Units get a drop-shadow ellipse offset 3 px down and are about 0.6 tiles across.
- Buildings get a darker front face (bottom 25% of the footprint, body color darkened 30%) under a lighter roof shape.
- Grass uses a two-tone checker blended with noise.

### Silhouettes (simple shapes, team-colored)

| Entity | Shape |
|---|---|
| Tiller | Small circle r0.28 with a cream hat dot. Shows a carried sack (yellow), log (brown) or ember chunk (orange) when loaded. |
| Warden | Circle r0.35, amber cloak triangle behind, 3-spike gold flame crown, short banner pole |
| Ashpike | Circle plus a long spear line 0.9 tiles forward with a triangle tip |
| Oathshield | Circle plus a tall rectangular shield 0.5 wide in front |
| Bowman | Circle with a hood triangle and a bow arc on one side |
| Brandbow | Bowman silhouette with an orange bow arc and a flickering flame dot at the arrow tip |
| Courser | Horse ellipse 0.7×0.35 with a small rider circle |
| Destrier | Larger ellipse 0.9×0.45 with barding stripes and a lance line |
| Outrider (SHOULD) | Courser ellipse plus a bow arc |
| Gatebreaker | Box 0.9×0.6 with 4 wheel dots and a pointed iron head |
| Lampbearer (SHOULD) | Circle plus a pole with a glowing lantern (radial gradient) |
| Thornling | Small 5-point spiky star, violet with green tips |
| Briarguard | Circle plus a jagged thorn spear |
| Spinecaster | Hunched teardrop with 3 quill lines on its back |
| Stagrider | Ellipse plus branching antler lines |
| Rootbreaker | Big rounded trunk rectangle with root tendrils dragging behind |
| Gloamwitch (SHOULD) | Tall robe triangle plus a floating green orb |
| Thornhusk | Big circle r0.45 with bark-plate polygons and spikes |
| Antlered Lord | r0.6 Stagrider with a thorn crown |
| Briar Regent | r1.1 circle with a 7-spike crown and 4 sweeping thorn arms |
| Hearth (4×4) | Round stone base, 4 short pillars, animated central flame with a pulsing glow |
| Cottage (2×2) | Square with a peaked thatch roof |
| Storehouse (2×2) | Rectangle with a flat roof and 2 crates |
| Grainplot (2×2) | Low fenced square with furrow stripes that ripen while worked |
| Muster Hall (3×3) | Long hall with a crossed-spears banner |
| Bowyard (3×3) | Open yard with a concentric target |
| Paddock (3×3) | Fence rectangle with a horseshoe emblem |
| Forgehall (3×3) | Dark roof and a chimney with an ember glow. The chosen Temper's icon shows on the roof. |
| Brazier Tower (2×2) | Square base with a tall post and a fire bowl drawn elevated |
| Siegeyard (3×3) | Timber frame with a crane-arm line |
| Thorn Nest (3×3) | Twisted thorn mound with a pulsing violet core and the doctrine banner icon above it. While Spent it greys, droops and its banner tilts. |
| Thornspire (1×1) | Tall jagged spike with a glowing green tip. Crumbles when it withers. |
| Root Heart (3×3) | Larger Nest with a red-violet heartbeat pulse |
| Briar Throne (5×5) | Thorn dais |
| Briar wall (boss map) | Impassable 3-thick band of #5B2E4A with thorn ticks |
| Beacon Stone (2×2, SHOULD) | Ring of 5 standing stones. Flickers while dormant and holds a flame when lit. |
| Ruined Cache (1×1) | Broken chest with a gold glint |
| Tree | Dark canopy circle with a highlight. Becomes a stump when depleted. |
| Thicket | Round bush with yellow dots |
| Ember Seam (2×2) | Dark rocks with glowing cracks |

## B. Run structure and run map generation

**Shape.** One act with 8 columns, drawn left to right, and 4 lanes (0-3).

| Column | Nodes | Types |
|---|---|---|
| 1 | 1 | Battle: Raze, no modifiers. Reward is a Draft. In a profile's first 3 runs its waves are ×0.85 ("First march", through M). |
| 2 | 2-4 | Battle 60, Event 40 (at least 1 Battle) |
| 3-6 | 2-4 each | Battle 50, Elite 14, Event 18, Peddler 10, Camp 8 (Camp only from col 4) |
| 7 | 2-4 | Camp 50, Peddler 50. At least 1 of each. |
| 8 | 1 | Boss: The Briar Throne |

The map has 16-22 nodes in total.

**Generation algorithm.**
1. Start 4 walkers in col 2 at `rng.int(0,3)` each. Reroll until col 2 has at least 2 distinct lanes.
2. For cols 2 to 6, each walker steps to `lane + pick(-1,0,+1)`, clamped to 0..3. A diagonal step is rejected if it would cross an existing edge in the same column pair (a→a+1 together with a+1→a). Retry up to 10 times, then step straight (straight never crosses).
3. Nodes are the union of visited (col, lane) cells and edges are the union of steps. Col 1 links to every col-2 node, and every col-7 node links to the boss.
4. Accept the layout if cols 2-7 hold 14-20 nodes and every column has 2 or more. Otherwise reroll (50 tries), then fall back to 3 lanes, each with a straight edge plus one diagonal per column.
5. **Type assignment.** Up to 200 attempts by the weights above, subject to:
   - every start-to-boss path has 3 or 4 combat nodes (Battle or Elite) among its 5 nodes in cols 2-6
   - the map has 1-2 Elites, all in cols 3-6
   - no Elite→Elite edge and no Peddler→Peddler edge
   - at least one path avoids every Elite
   - col 7 holds at least 1 Camp and 1 Peddler

   Fallback: cols 2, 4 and 6 are Battles (one col-4 node becomes an Elite) and cols 3 and 5 alternate Event, Peddler and Camp.
6. **Battle node rolls.**
   - **Objective:** Raze 50, Holdfast 25, Beacons 25. If Beacons is cut (SHOULD), use Raze 65, Holdfast 35. Elites use the Elite layout.
   - **Biome:** see §K.
   - **Modifiers:** see §K.
   - **Reward type:** Boon 55, Draft 25, Spoils 20. Col 1 is always a Draft.
   - **Node icon:** shows objective, modifier pips, reward icon and a threat rating of 1-5 skulls. Threat is `ceil(d × 0.6)`, +1 for an Elite, and the boss is 5.

**Typical path:** 5-6 battles including the boss, plus 2-3 non-combat nodes. Battle 1 takes about 5:00, 3-4 mid battles take 5:30-7:00 each, the boss about 8:45, and non-combat nodes plus screens about 4-5 min. That totals **35-44 min**.

**Carried within a run:** Boons, Drafts (unlocked unit types), Crowns, Resolve, Retinue, Sellswords, pending event effects.

**Reset every battle:** buildings, resources, research and Tempers, all non-Retinue units, map, fog.

**Retinue.**
- After a victory or a Retreat, choose surviving military units (not Tillers or the Warden) up to the **Retinue cap**: 6 pop, +3 with Veteran's Oath, +3 with Seasoned Retinue, so 12 at most.
- The free scout Courser each battle starts with is a Retinue candidate only once it has reached Rank I. Trained Coursers always are.
- They spawn beside the Hearth next battle, keep their Rank and kills, and count toward pop.

**Sellswords.** Units gained from events, Camp Drill (empty Retinue), Stragglers or the Peddler spawn in the next battle on top of the Retinue cap. After that battle they join the survivor pool for the normal Retinue pick.

**Stragglers.** After a non-boss defeat that leaves the Retinue empty, 2 Rank I Ashpikes join the next battle as Sellswords. The Results screen says so.

**Veterancy.**
- Rank I at 3 kills, Rank II at 7, Rank III at 12. Max Rank III.
- Each Rank gives +15% max HP and +15% ATK.
- Rank III also gives +1 armor and a gold banner.

**Resolve** starts at 3 (max 3, or 4 with Fourth Banner).
- **Losing a non-boss battle** (Hearth destroyed): −1 Resolve, no reward, Retinue lost (Stragglers, below, refill an empty one). The node is marked done and you continue from it.
- **Same tick.** If the last Nest (or the Regent) and the Hearth fall in the same tick, the battle is a victory. A Last Stand is not spent once the Regent has fallen.
- **Sound the Retreat** (pause menu, from 3:00, never in the boss battle): −1 Resolve. You keep the Crowns plundered so far, pick a Retinue from survivors, and the node is marked done.
- **Last Stand** (boss battle only): when the Hearth would be destroyed and Resolve is at least 1, spend 1 Resolve. The Hearth returns at 40% HP and is invulnerable for 5 s. Enemies within 6 tiles take 150 damage and a 3-tile knockback. Rally the Hearth triggers for free, ignoring its cooldown.
- **Run ends.** You win by slaying the Briar Regent. You lose when Resolve hits 0 outside the boss battle, or when the Hearth falls in the boss battle at 0 Resolve.

**Briefing preview.** Opening a battle node's Briefing is only a preview: Back returns to the map with nothing spent. The route commits when the player presses Begin Battle.

**Autosave.**
- The run state is saved on entering every node, including the Retinue snapshot, Sellswords and pending effects.
- Starting a battle sets `battleInProgress`.
- On Continue with `battleInProgress` set:
  - **Non-boss battle:** counts as a Retreat with 0 plunder (−1 Resolve, the Retinue is the node-entry snapshot, the node is marked done).
  - **Boss battle:** restarts with the same seed at −1 Resolve, and the run is over at 0.
- The Quit dialog states this cost.

## C. Battle types

**Common start (all battles):**
- Pre-built Hearth plus the **Vanguard** building, 7 Tillers, 1 Courser (scout), the Warden, the Retinue and any Sellswords.
- Tillers stand below the Hearth. The Courser, the Warden, the Retinue and Sellswords stand on the far side, so a box over the Tillers selects only Tillers.
- **250 Grain / 300 Timber / 75 Ember**, pop cap 20, explored radius 10 around the Hearth.
- A 3 s "Kindle!" countdown runs before the clock starts.
- **Defeat:** the Hearth is destroyed (except Last Stand in the boss battle). The Warden's death is never defeat.

**Vanguard pick.** On the Briefing the player picks one pre-built building. The doctrine hint is visible while choosing.

| Vanguard | Placement (reserved by the map generator, §K) |
|---|---|
| Muster Hall | 6-8 tiles from the Hearth center, on the side facing the nearest Nest |
| Bowyard | Same site as the Muster Hall option |
| Storehouse + 1 Grainplot | Storehouse at the nearest forest edge 6-12 tiles from the Hearth. Grainplot 4-6 tiles from the Hearth. |

| Objective | id | Map | Enemy setup | Victory | Par / bonus | Typical |
|---|---|---|---|---|---|---|
| **Raze** | raze | 56×56. Hearth in a random corner, center 9-12 tiles from both edges. | Nests: 2 (d≤4) or 3 (d≥5). 1 Thornspire per Nest. 2 Bramble Pickets on the contested Seams. Caches per §J. | All Nests destroyed | Par 6:00 + 0:45 per Nest above 2. +30 Crowns under par. | 4:30-7:30 |
| **Holdfast** | holdfast | 48×48. Hearth at the exact map center. | 2 Nests (3 at d≥5), 17-23 tiles from the Hearth and at least 12 apart. 1 Thornspire each. 1 unguarded contested Seam 12-16 tiles from the Hearth and at least 10 from every Nest. No Pickets, no raids, no Ascendant. | Survive 6 waves (all launched and every wave unit dead, garrisons don't count), **or** destroy all Nests | "Unbroken": +30 Crowns if no completed building is lost. "Uprooted": +30 Crowns. | 5:30-6:30 |
| **Beacons** (SHOULD) | beacons | 56×56. Hearth at an edge midpoint, inset 9. | 3 Beacon Stones 15-24 tiles from the Hearth and at least 12 apart, each guarded by 2 + d value of Lurkers. 2 Nests (3 at d≥5) along the far edge. 2 contested Seams, no Pickets. | Kindling meter reaches **450**, **or** all Nests destroyed | Par 5:30. +30 Crowns. | 4:30-6:00 |
| **Noble Hunt** (Elite) | elite | 56×56, Raze layout | 2 Nests plus the Antlered Lord (§I) and +1 negative modifier. 1 Thornspire per Nest, 2 Pickets. | All Nests destroyed **and** the Lord slain | Par 6:30. +40 Crowns Elite bonus, +30 under par. | 6:00-7:30 |
| **Briar Throne** (Boss) | boss | 64×64 hand-authored template (§K). Hearth SW, Throne NE. | 3 Root Hearts, the Regent, 2 Pickets, no modifiers | Slay the Briar Regent | none | 8:00-9:30 |

**Beacon rules** (SHOULD, with the Beacons objective).
- **Dormant.** Beacons are dormant until 1:30. The stones flicker and show a countdown.
- **Capture.** A Beacon lights after 10 s with at least 1 player unit (Tillers count) within 2.5 tiles of its center and no enemy inside. Progress pauses while contested and decays at 1 s/s when empty.
- **Lit Beacon.** It scores +1 Kindling point/s while no enemy is within 2.5 tiles. It also gives +0.3 Ember/s and vision radius 8, and it is invulnerable. Kindling never decays.
- **Target.** The meter needs **450** (raised from 300: the bot won at a median 4:00, far under par). With all 3 stones lit from 1:40 that is 4:10 at the earliest.
- **Snuffing.** Enemies standing uncontested inside for 8 s snuff it. A snuffed Beacon resets to neutral with 0 capture progress.
- **Blight.** Beacons ignore Blight and are always capturable.

**Holdfast waves.**
- Launch at 60, 105, 150, 195, 240 and 285 s. Each musters 30 s earlier.
- Value `floor(Hbase[n] × F_H(d) × N × M)` with `Hbase = [8, 13, 18, 25, 34, 52]` and Holdfast's own depth slope `F_H(d) = 1 + 0.06(d − 1)`. N applies here too.
- The Hearth (range 7) and the respawning Warden alone must never hold all six waves: with no input Holdfast is lost at d1-3.
- Wave 6 is the **Great Wave**. It is split evenly across all living Nests and its muster announcement is called out ("The Great Wave gathers.").
- **Cleanup.** When wave 6 launches, every remaining wave unit is revealed on the minimap and attack-moves to the Hearth. When 6 or fewer remain, they charge the Hearth, ignoring kiting and leash.

| d | Holdfast wave 1 | 2 | 3 | 4 | 5 | 6 (Great) |
|---|---|---|---|---|---|---|
| 1 | 8 | 13 | 18 | 25 | 34 | 52 |
| 2 | 8 | 13 | 19 | 26 | 36 | 55 |
| 3 | 8 | 14 | 20 | 28 | 38 | 58 |
| 4 | 9 | 15 | 21 | 29 | 40 | 61 |
| 5 | 9 | 16 | 22 | 31 | 42 | 64 |
| 6 | 10 | 16 | 23 | 32 | 44 | 67 |

**Depth scaling** (Raze, Beacons and Elite waves. Structure and garrison rows apply to every objective).

| Quantity | Formula | d1 / d4 / d6 |
|---|---|---|
| Depth factor F(d) | 1 + 0.12(d−1) | 1.00 / 1.36 / 1.60 |
| First wave launch T1 | 110 − 4d s | 106 / 94 / 86 |
| Wave interval I | 70 − 2d s | 68 / 62 / 58 |
| Muster lead | Horn and spawn at launch − 30 s | |
| Wave value V(n,d) | floor((6 + 4n + 0.5n²) × F(d) × N × M) | see below |
| Nest HP | 800 + 100(d−1) | 800 / 1100 / 1300 |
| Nests per battle (Raze, Holdfast, Beacons) | 2 at d≤4, 3 at d≥5 | 2 / 2 / 3 |
| Thornspire | 400 HP. 1 per Nest (2 under Fortified Nests). Withers 2 s after its Nest dies. | |
| Nest garrison value | 4 + d, regenerating 1 value per 10 s (not while Spent) | 5 / 8 / 10 |
| Picket guard value | 2 + d, no regeneration | 3 / 6 / 8 |
| Cache guard (Lurkers) value | 2 + d, no regeneration | 3 / 6 / 8 |
| Raid value (SHOULD, d≥3) | 2 + d | n/a / 6 / 8 |
| Blight cap (Raze, Beacons, Elite) | radius 10 + d, growing +1 every 20 s from radius 4 | 11 / 14 / 16 |
| Enemy types available | Thornling, Briarguard, Spinecaster d1. Stagrider d2. Rootbreaker d3. Gloamwitch d4. Thornhusk d5. | |

**N** = 0.4 + 0.6 × nestsAlive / nestsTotal, in every objective. With 2 Nests the first kill sets N to 0.7. With 3 Nests the kills set it to 0.8, then 0.6.

**M** is the product of active multipliers:
- Blood Moon ×1.3
- Hollow Envoy ×1.15
- Thornbound I ×1.1
- Ascendant ×1.5

**Wave values V(n,d) at launch time** (all Nests alive, M = 1). Waves continue past wave 6 until the battle ends.

| d | wave 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| 1 | 10 @1:46 | 16 @2:54 | 22 @4:02 | 30 @5:10 | 38 @6:18 | 48 @7:26 | 58 @8:34 |
| 2 | 11 @1:42 | 17 @2:48 | 25 @3:54 | 33 @5:00 | 43 @6:06 | 53 @7:12 | 65 @8:18 |
| 3 | 13 @1:38 | 19 @2:42 | 27 @3:46 | 37 @4:50 | 47 @5:54 | 59 @6:58 | 72 @8:02 |
| 4 | 14 @1:34 | 21 @2:36 | 30 @3:38 | 40 @4:40 | 52 @5:42 | 65 @6:44 | 79 @7:46 |
| 5 | 15 @1:30 | 23 @2:30 | 33 @3:30 | 44 @4:30 | 56 @5:30 | 71 @6:30 | 86 @7:30 |
| 6 | 16 @1:26 | 25 @2:24 | 36 @3:22 | 48 @4:20 | 61 @5:18 | 76 @6:16 | 93 @7:14 |

One value is roughly 30 player resources. A Thornling is 1 value, and a Briarguard (the equivalent of an Ashpike) is 2.

**Ascendant (soft clock).** At 9:00 in Raze, Beacons and Elite battles, the interval drops to 35 s and wave value gains ×1.5. The Horn announces it 30 s ahead.

## D. Economy

**Resources.**
- **Grain** feeds every unit. It comes from finite Thickets early and from infinite Grainplots that cost Timber.
- **Timber** builds everything and buys bows. Trees deplete and the forest recedes.
- **Ember** is scarce. It buys quality units, towers, Tempers and most research. The rich Seams sit toward the Nests, under guard, and the Blight swallows them as the battle goes on.

| Node | id | Yields | Amount | Gather rate | Max gatherers | Placement |
|---|---|---|---|---|---|---|
| Thicket (1×1, impassable) | thicket | Grain | 150 | 1.0/s | 2 | 6 in one cluster at 4-7 tiles from the Hearth (Ashwood 4). 3 outer at 9-13 tiles (Greenmarch +2). 2 more clusters of 3 mid-map. |
| Grainplot (2×2 building, impassable) | grainplot | Grain | infinite | 0.6/s | 2 | Player-built, 50 Timber |
| Tree (forest tile) | tree | Timber | 120 (Ashwood 90) | 0.8/s | 2 | At least 60 forest tiles 6-14 tiles from the Hearth. A depleted tree becomes a passable stump. |
| Ember Seam (2×2, impassable) | ember_seam | Ember | 800 home / 1000 contested | 0.6/s | 6 | 1 home Seam at 8-11 tiles. Contested Seams per §K. |

**Gathering rules.**
- **Carry and speed.** Carry is 10 (+5 Timber with Log Sledges, +4 all with Laden Packs). Tiller speed is 2.2.
- **Drop-off.** The Hearth and every Storehouse accept everything. A loaded Tiller re-picks the nearest drop-off at the start of each return trip, then resumes automatically.
- **Full node.** If a node is full, the Tiller tries the same resource within 8 tiles. Otherwise it waits 3 s and retries once, then goes idle and raises the idle alert.
- **Depleted node.** Tillers seek the same resource within 8 tiles, else go idle and raise the idle alert. A Tiller that finishes a build or repair and finds its remembered source gone looks for the same resource within 10 tiles of it first.
- **Building on the way.** A build or repair order keeps the Tiller's gather job; it goes back to it when the work is done (§O Shift-build).
- **Blight.** A Tiller standing on Blight gathers at ×0.6.
- **Flee.** A Tiller that takes damage while not rallied and not under an explicit attack order flees. It runs to the nearest drop-off with no enemy within 6 tiles of it (else the Hearth). It resumes its job after 8 s with no enemy within 8 tiles of it.
- **Rally the Hearth** saves each affected Tiller's job and restores it when the effect expires.

**Net income** per Tiller, with walking: `carry / (carry/rate + 2·dist/2.2 + 0.3)`.

| Job | Distance to drop-off | Net/s | Net/min |
|---|---|---|---|
| Thicket | 5 | 0.67 | 40 |
| Timber, no Storehouse | 8 | 0.50 | 30 |
| Timber with a Storehouse | 3.5 | 0.63 | 38 |
| Ember, no Storehouse | 9 | 0.40 | 24 |
| Ember with a Storehouse | 2.5 | 0.52 | 31 |
| Grainplot | 3 | 0.51 | 30 |
| Ember with a Storehouse, Seam on Blight | 2.5 | 0.33 | 20 |

Twenty Tillers yield about 650-700 resources/min.

**Population.**
- The Hearth gives +20 and each Cottage +6, with a **hard cap of 60**.
- Pre-placed units (starting units, Retinue, Sellswords) ignore the cap. Training is blocked while pop is at or above the cap.
- At the cap, the head of each queue holds without consuming time and resumes automatically when pop frees. The "Need Cottages" alert fires at most every 15 s.
- New units appear on the nearest free tile, found by a BFS from the building edge. If none is free within 6 tiles, they retry each second.

**Engine caps.**
- Player pop: 60.
- Enemy standing pool (garrisons, Picket guards, Lurkers, Beacon guards): 30 units.
- Enemy wave pool (waves, raids, Noble and Court summons, the Noble itself): 50 units.
- Enemy total: 80 units.
- There are no neutral units. The worst case is 140 units plus the Warden.

**Other income.**
- **Ruined Cache:** +150 Ember and +15 Crowns.
- **Lit Beacon:** +0.3 Ember/s.
- **Boons:** Ember Tithe, Spoils of the Wake, Plunderers, Raider's Bounty, Baggage Train (§L).

## E. Buildings

Rules:
- **Build time** with n builders (max 4) is `base × 3/(n+2)`.
- **Cost** is paid when you place the foundation. Cancelling (Delete or Backspace) refunds 100% before work starts and 50% after. A destroyed foundation refunds nothing.
- **Displacement.** Placing a foundation instantly moves any unit inside it to the nearest free tile.
- **Repair** is free: 8 HP/s per Tiller, max 4 repairers.
- **Placement.** The footprint must be explored, entirely grass or stump, free of Blight and resources, and at least 3 tiles from any enemy structure. Buildings may touch each other. Forward building is otherwise allowed. Exception: with Kiln Masons, Brazier Towers may sit on Blight.
- **Production queue** holds 5 slots. Cost is paid on queue and cancelling refunds 100%. Pop is checked when training starts.
- **Rally.** RMB sets the rally point. Rallying on a resource sends new Tillers to gather it.
- **Pathing.** Every building, including Grainplots and foundations, is impassable to everyone. Enemy flow fields treat player buildings as cost 12 and attack them (§I).
- **Armor** is 3 unless listed otherwise.
- **Defensive fire.** Hearth and tower bolts are ranged projectiles with no class bonuses. They target enemy units only, never structures.

| Building | id | Cost | HP | Armor | Size | Build (s) | Function | Trains (key) / Research (key) | Requires | Tiller hotkey | Sight | Attack |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Hearth | hearth | pre-placed | 2400 | 3 | 4×4 | n/a | Drop-off, +20 pop. **Rally the Hearth (V):** Tillers within 8 tiles get +2 ATK and +1 armor and auto-fight enemies within 5 tiles for 15 s. They drop their carried load, then resume their jobs. Cooldown 180 s. | Tiller (Q), Lampbearer (W, SHOULD) / Hearth Watch (Z), Stoked Braziers (X) | n/a | H selects it | 9 | 10 dmg, 1.5 s, range 7, units only |
| Cottage | cottage | 40 T | 300 | 1 | 2×2 | 12 | +6 pop | n/a | none | C | 4 | n/a |
| Storehouse | storehouse | 100 T | 600 | 3 | 2×2 | 18 | Drop-off for all resources | Log Sledges (Z), Furrow Rites (X), Deep Picks (C) | none | E | 5 | n/a |
| Grainplot | grainplot | 50 T | 200 | 1 | 2×2 | 10 | Infinite Grain for 2 Tillers, impassable | n/a | none | F | 3 | n/a |
| Muster Hall | muster_hall | 150 T | 1000 | 3 | 3×3 | 30 | Infantry | Ashpike (Q), Oathshield (W) / Ash-Hardened Hafts (Z) | none | B | 6 | n/a |
| Bowyard | bowyard | 130 T | 900 | 3 | 3×3 | 28 | Archers | Bowman (Q), Brandbow (W) / Quick Draw (Z) | none | R | 6 | n/a |
| Paddock | paddock | 150 T, 40 E | 900 | 3 | 3×3 | 32 | Cavalry | Courser (Q), Destrier (W), Outrider (E, SHOULD) / Thunder Charge (Z) | none | P | 6 | n/a |
| Forgehall | forgehall | 120 T, 50 E | 1000 | 3 | 3×3 | 30 | One Temper per battle (§H). Needed before Brandbow and Destrier can be trained. | Ember Edge (Z), Barbed Heads (X), Hardened Hauberks (C) | Muster Hall or Bowyard | N | 6 | n/a |
| Brazier Tower | brazier_tower | 100 T, 25 E | 650 | 3 | 2×2 | 25 | Defense | n/a | none | T | 10 | 12 dmg, 1.4 s, range 7, units only |
| Siegeyard | siegeyard | 180 T, 60 E | 900 | 3 | 3×3 | 35 | Siege | Gatebreaker (Q) | Forgehall + Siegecraft draft | Y | 6 | n/a |

## F. Player units

Speed is in tiles/s. Range is measured edge to edge. Collision radius is 0.3 (0.35 Warden, 0.4 cavalry, 0.45 siege).

| Unit | id | Role / class | Cost | Train (s) | HP | ATK | CD (s) | Range | Armor | Speed | Sight | Pop | Bonuses and traits | Trained at (key) | Unlocked by | Scope |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tiller | tiller | Worker / worker | 50 G | 10 | 40 | 3 | 1.5 | 0.5 | 0 | 2.2 | 6 | 1 | Gathers, builds, repairs. Never auto-attacks unless rallied. Flees when hit (§D). | Hearth (Q) | Core | MUST |
| Warden | warden | Hero / hero | n/a | respawn 45 + 15 per prior death this battle | 400 | 14 | 1.2 | 0.6 | 3 | 2.4 | 9 | 0 | House ability (Q). Counter bonuses never apply against it. Respawns at the Hearth. | Starts at Hearth | Core | MUST |
| Ashpike | ashpike | Spear / infantry | 35 G, 25 T | 12 | 60 | 5 | 1.5 | 0.7 | 1 | 2.0 | 6 | 1 | **×3 vs cavalry**, negates Charge | Muster Hall (Q) | Core | MUST |
| Bowman | bowman | Archer / ranged | 25 G, 40 T | 13 | 35 | 5 | 1.7 | 6 | 0 | 2.0 | 8 | 1 | **×2 vs infantry** | Bowyard (Q) | Core | MUST |
| Courser | courser | Light horse / cavalry | 55 G, 25 E | 15 | 85 | 6 | 1.5 | 0.5 | 1 | 3.3 | 9 | 1 | **×2 vs ranged and siege**, ×1.5 vs worker | Paddock (Q) | Core (1 free per battle) | MUST |
| Oathshield | oathshield | Heavy foot / infantry | 50 G, 30 E | 16 | 110 | 8 | 1.6 | 0.6 | 3 | 1.7 | 6 | 1 | Takes ×0.5 from ranged attacks | Muster Hall (W) | Draft: Shieldwall | MUST |
| Brandbow | brandbow | Fire archer / ranged | 25 G, 35 T, 25 E | 16 | 40 | 6 | 2.0 | 7 | 0 | 1.9 | 9 | 1 | ×1.5 vs infantry. Structure multiplier 0.8 (override). Burn 2/s for 3 s on units. Outranges Thornspires. | Bowyard (W), needs Forgehall | Draft: Firecraft | MUST |
| Destrier | destrier | Heavy horse / cavalry | 75 G, 50 E | 20 | 180 | 13 | 1.8 | 0.6 | 3 | 2.9 | 7 | 2 | Charge ×2 on the first hit after moving at least 3 tiles. ×1.5 vs ranged. | Paddock (W), needs Forgehall | Draft: Heavy Horse | MUST |
| Gatebreaker | gatebreaker | Ram / siege | 120 T, 40 E | 22 | 260 | 30 | 3.0 | 0.6 | 2 | 1.3 | 4 | 2 | Attacks structures only (×4) and the Regent (×1.5). Takes ×0.25 from ranged. RMB on an enemy unit is a move order. | Siegeyard (Q) | Draft: Siegecraft | MUST |
| Outrider | outrider | Horse archer / cavalry | 50 G, 35 T, 20 E | 16 | 75 | 5 | 1.5 | 5 | 0 | 3.1 | 9 | 1 | ×2 vs siege, ×1.5 vs worker, ×1.25 vs infantry. Structure multiplier 0.2 (override). Auto-kite (below). | Paddock (E) | Draft: Outriding (meta) | SHOULD |
| Lampbearer | lampbearer | Healer / ranged | 40 G, 30 T, 10 E | 14 | 45 | 0 | n/a | aura 3 | 0 | 2.0 | 8 | 1 | Heals allied non-siege units 2 HP/s within 3 tiles (max 2 Lampbearer stacks). Reuses the Gloamwitch aura code. | Hearth (W) | Draft: Lamplight (meta) | SHOULD |

**Behavior.**
- **Auto-acquire.** Idle military units acquire the nearest visible enemy within 6 tiles (ranged units: max(range + 1, 6)). They prefer units over buildings, chase up to 10 tiles from their idle spot, then return.
- **No structure auto-targeting below ×0.5.** Units whose structure multiplier is below 0.5 (Bowman 0.2, Outrider 0.2, Courser 0.4, Firebrand Bowmen 0.4) never pick a structure on their own (idle, attack-move or Hold). Only an explicit attack order or a right-click sends them at a building. When such a unit is idle and a structure fires at it (or at a friendly unit while it stands in range) with no enemy unit to fight, it steps 1.5 tiles outside that structure's range, along the structure-to-unit line, and makes that its new idle spot.
- **Attack-move** uses the same acquisition while moving.
- **Hold** never moves. **Move** ignores enemies.
- **Melee retarget.** A melee unit that cannot reach its target for 1.5 s retargets the nearest enemy within 3 tiles.
- **Outrider auto-kite** (SHOULD). When an enemy melee unit comes within 2.5 tiles, the Outrider steps back 2 tiles (cooldown 2 s), except on Hold. It reuses the Spinecaster kite code.
- **Formation.** At the destination, groups use a role-sorted offset: melee in front, ranged behind.

**Movement and pathing (MUST, the main bug-risk area).**
- **(a) Group orders.** Any order for 4 or more units builds one Dijkstra flow field from the goal (at most 4096 cells, under 1 ms), shared by the group. A* (octile, binary heap, at most 8 requests per tick) is used only for single units, small groups and Tiller trips.
- **(b) Unreachable goal.** Path to the reachable tile with the lowest heuristic to the goal.
- **(c) No corner cutting.** No diagonal step when either orthogonal neighbour is blocked.
- **(d) Soft separation.** Units never block the grid. Separation runs through the spatial hash with a max push of 0.5 tiles/s, and moving units shove idle ones.
- **(e) Stuck detection.** A unit that moves less than 0.15 tiles in 1.0 s while pathing repaths. After 3 repaths in 6 s it goes idle.
- **(f) Group arrival** happens within 0.5 + 0.35·√n tiles of the goal.
- **(g) Forced displacement.** Knockback and dashes move in 0.25-tile steps and stop at the last walkable tile.

## G. Damage formula and counters

```
mult = bonus[attacker][target.class]     // 1 if none. vs hero and boss always 1,
                                         // except Gatebreaker vs Regent = 1.5
     × structMod(attacker)               // only vs structures: unitDef.structMod ?? classStructMod[class]
     × resist[target][attackKind]        // attackKind = 'ranged' for projectiles, else 'melee'
raw  = (ATK + flatAtk) × (1 + ΣatkPct) × (1 + 0.15 × rank) × mult × charge × spent
dmg  = max(1, round(raw × 10 / (10 + armor)))   // armor = base + flat bonuses (+1 at Rank III)
                                                // spent = 1.5 when the target is a Spent Nest or Root Heart
```

- **Armor** has diminishing returns: 1 = −9%, 3 = −23%, 5 = −33%.
- **Burn** deals true damage that ignores armor (2/s for 3 s, Firepot 3/s for 4 s).
  - It hits units only, never structures.
  - A target holds up to 3 burn instances from different appliers. An applier refreshes its own instance.
  - The applier whose tick kills gets the credit.
- **Splash** applies falloff to raw damage per target.
- **Charge** does not apply against spear units (Ashpike, Briarguard).
- **Projectiles.**
  - Arrows (12 tiles/s), bolts (14) and spines (10) home on their target. Spinecasters and Gloamwitches fire spines.
  - The Firepot is ground-targeted and can be dodged.

**classStructMod:** worker 0.5, infantry 0.7, hero 0.8, cavalry 0.4, ranged 0.2, siege 1.0, boss 2.0.

**Overrides:** Brandbow 0.8, Outrider 0.2, Courser 0.8 with Raider's Bounty, Bowman and Outrider 0.4 with Firebrand Arrows.

**Resist:** Oathshield and Thornhusk take ×0.5 from ranged. Gatebreaker and Rootbreaker take ×0.25 from ranged.

**Counter matrix** (the multiplier before structMod and resist. The structure column already includes structMod):

| Attacker | worker | infantry | ranged | cavalry | siege | hero / boss | structure |
|---|---|---|---|---|---|---|---|
| Tiller | 1 | 1 | 1 | 1 | 1 | 1 | 0.5 |
| Warden | 1 | 1 | 1 | 1 | 1 | 1 | 0.8 |
| Ashpike / Briarguard | 1 | 1 | 1 | **3** | 1 | 1 | 0.7 |
| Oathshield / Thornling / Thornhusk | 1 | 1 | 1 | 1 | 1 | 1 | 0.7 |
| Bowman | 1 | **2** | 1 | 1 | 1 | 1 | 0.2 |
| Spinecaster | 1 | **1.5** | 1 | 1 | 1 | 1 | 0.2 |
| Gloamwitch | 1 | 1 | 1 | 1 | 1 | 1 | 0.2 |
| Brandbow | 1 | 1.5 | 1 | 1 | 1 | 1 | 0.8 (burn on units only) |
| Courser / Stagrider / Antlered Lord | 1.5 | 1 | **2** | 1 | **2** | 1 | 0.4 |
| Destrier | 1 | 1 | 1.5 | 1 | 1 | 1 | 0.4 |
| Outrider | 1.5 | 1.25 | 1 | 1 | 2 | 1 | 0.2 |
| Gatebreaker / Rootbreaker | n/a | n/a | n/a | n/a | n/a | n/a (Gatebreaker vs Regent 1.5) | **4.0** |
| Briar Regent | 1 | 1 | 1 | 1 | 2 | 1 | 2.0 |
| Hearth / Brazier Tower / Thornspire | 1 | 1 | 1 | 1 | 1 | 1 | n/a (units only) |

The Antlered Lord is class cavalry, so Ashpikes deal ×3 to it under the normal rule. Only the Warden (hero) and the Regent (boss) are exempt from counters.

**Primary triangle:** Spears beat Cavalry (×3), Cavalry beats Ranged (×2), Ranged beats Infantry (×2).

**Ember loop:** Oathshields beat archers. Destriers beat Oathshields. Ashpikes beat Destriers.

**Readability.**
- A counter hit pops an orange "×3" style number.
- A resisted hit (Oathshield, Thornhusk, siege, or a low structure multiplier) pops a grey "×0.5" / "×0.25" / "×0.2".
- Popups appear at most once per attacker per 1.5 s, with at most 24 on screen.
- Every tooltip shows Strong vs / Weak vs class icons, and holding Tab shows the Counter Wheel overlay.

**Verified 1v1 checks.**
- **Ashpike vs Courser:** 14 per hit, so the Courser (85 HP) dies to the 7th hit (9.0 s). The Courser deals 5 per hit and needs 12.
- **Courser vs Bowman:** 12 per hit, 3 hits. The Bowman deals 5 per hit and needs 17.
- **2 Ashpikes vs 1 Destrier:** each side deals 12 per hit (Charge negated). The pikes win, with one survivor at about 20% HP.
- **Thornling breakpoints (24 HP):** a Bowman needs 3 hits, or 2 with Barbed Heads. An Ashpike needs 5, or 4 with Ashpike Discipline or Ember Edge.
- **Gatebreaker:** 92 per hit vs a Nest (30.7 DPS), 30 per hit vs the Regent (10 DPS).

## H. In-battle research (resets every battle, one at a time per building)

| id | Name | Building (key) | Cost | Time (s) | Effect |
|---|---|---|---|---|---|
| hearth_watch | Hearth Watch | Hearth (Z) | 75 G, 50 T | 25 | Rally the Hearth cooldown 180 → 120 s, duration 15 → 25 s |
| stoked_braziers | Stoked Braziers | Hearth (X) | 100 T, 75 E | 35 | Hearth and Brazier Towers +3 ATK, +1 range |
| log_sledges | Log Sledges | Storehouse (Z) | 75 G, 75 T | 25 | Timber carry +5 |
| furrow_rites | Furrow Rites | Storehouse (X) | 50 G, 100 T | 30 | Grainplot gather +25% |
| deep_picks | Deep Picks | Storehouse (C) | 100 G, 75 T | 30 | Ember gather +25% |
| ash_hafts | Ash-Hardened Hafts | Muster Hall (Z) | 100 G, 40 E | 25 | Ashpike +20 HP, Oathshield +1 armor |
| quick_draw | Quick Draw | Bowyard (Z) | 75 G, 75 T | 25 | Bowman and Brandbow cooldown −15% |
| thunder_charge | Thunder Charge | Paddock (Z) | 100 G, 75 E | 30 | Coursers gain Charge ×1.5. Destrier Charge rises to ×2.5. |
| ember_edge | Temper: Ember Edge | Forgehall (Z) | 100 G, 100 E | 40 | Melee military and the Warden +2 ATK |
| barbed_heads | Temper: Barbed Heads | Forgehall (X) | 75 T, 100 E | 40 | Ranged military +2 ATK |
| hauberks | Temper: Hardened Hauberks | Forgehall (C) | 150 G, 100 E | 45 | All military +2 armor |

**Temper rule.** The Forgehall holds one Temper per battle. Starting one locks the other two. Cancelling refunds 100% and unlocks them again. The locked buttons explain why they are disabled.

## I. Enemy faction: the Thornwake

| Unit | id | Class | Value | HP | ATK | CD | Range | Armor | Speed | Sight | Traits | Standing-eligible | From d | Scope |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Thornling | thornling | infantry | 1 | 24 | 3 | 1.3 | 0.5 | 0 | 2.3 | 5 | Swarm filler | no | 1 | MUST |
| Briarguard | briarguard | infantry | 2 | 60 | 5 | 1.5 | 0.7 | 1 | 1.9 | 6 | ×3 vs cavalry, negates Charge | yes | 1 | MUST |
| Spinecaster | spinecaster | ranged | 2 | 34 | 5 | 1.8 | 5.5 | 0 | 1.9 | 7 | ×1.5 vs infantry. Fires spines. Kites: steps back 1.5 tiles when melee comes within 2 (cooldown 3 s). | yes | 1 | MUST |
| Stagrider | stagrider | cavalry | 3 | 95 | 7 | 1.5 | 0.5 | 1 | 3.1 | 8 | ×2 vs ranged and siege, ×1.5 vs worker | yes | 2 | MUST |
| Rootbreaker | rootbreaker | siege | 5 | 300 | 30 | 3.0 | 0.7 | 3 | 1.1 | 5 | Structures only, ×4. Takes ×0.25 from ranged. Max 1 + floor(d/4) per wave. | no | 3 | MUST |
| Gloamwitch | gloamwitch | ranged | 4 | 50 | 5 | 2.0 | 5 | 0 | 1.8 | 8 | Fires spines. Thornwake within 4 tiles regenerate 2 HP/s (max 2 stacks). | yes | 4 | SHOULD (if cut, its weight goes to Spinecaster) |
| Thornhusk | thornhusk | infantry | 6 | 200 | 12 | 1.8 | 0.7 | 3 | 1.6 | 6 | Takes ×0.5 from ranged | yes | 5 | MUST |

| Structure | id | HP | Armor | Size | Notes |
|---|---|---|---|---|---|
| Thorn Nest | thorn_nest | 800 + 100(d−1) | 3 | 3×3 | Spawns waves and garrison. Source of Blight. Sight 8. Becomes Spent after each launch. Plunder +10 Crowns. |
| Thornspire | thornspire | 400 | 3 | 1×1 | 8 dmg, 1.6 s, range 6, sight 8, units only. Placed within 4 tiles of its Nest or Picket post. Withers 2 s after its Nest dies. |
| Bramble Picket | (Thornspire + guard) | n/a | n/a | n/a | Cleared when its Thornspire dies (+5 Crowns). The guard of 2 + d value stays until killed. |
| Root Heart (boss) | root_heart | 1200 | 3 | 3×3 | Boss Nest. 1 Thornspire, garrison 12 value (regenerates 1 per 15 s), Blight +1 every 10 s up to radius 12. Spent rules apply. |
| Briar Throne (boss) | briar_throne | invulnerable | n/a | 5×5 | Impassable dais |

**Enemy pools.**
- **Standing forces** (garrisons, Picket guards, Lurkers, Beacon guards) use only standing-eligible types: value 2 or more, no siege. A remainder under 2 is discarded. A standing spawn that would exceed 30 units is skipped.
- **Wave-pool units** (waves, raids, Noble summons, Court Summons, Nobles) are capped at 50 alive. Overflow goes to `waveBank` (see Composition).

### Wave director

**Timeline.**
- Muster begins at **launch − 30 s**. The Wave Horn appears, V is computed with the current N and M, and units spawn at the muster point (3 tiles in front of the Nest, toward the Hearth).
- Spawns land on free tiles in a BFS spiral, max radius 5.
- Waves rotate round-robin among living Nests and skip dead ones.

**Composition.**
1. Budget = V + `waveBank`. The bank is capped at 50% of V and any excess is discarded.
2. Garrison units above 50% of the garrison cap (by value) leave their posts and join the wave first. Their value is subtracted from the budget.
3. While budget ≥ 1, pick an eligible type by doctrine weights, spawn it and subtract its value. A type is eligible if it is unlocked at d, its value fits the budget, and the Rootbreaker cap is respected.
4. If the wave pool hits 50 alive, the remainder goes to `waveBank` for the next wave.

**Intel.**
- A wave's composition is revealed if, on any tick of its muster, one of these covers the muster point:
  - a player unit within 6 tiles of it
  - a Hawk reveal
  - a lit Beacon's vision
- Because garrison posts surround the Nest, a scout must enter guard aggro to peek.
- Once revealed, unit icons with counts stay on the Horn until the wave is broken.
- Otherwise the Horn shows Small (< 8 units), Medium (8-19) or Large (20 or more).
- Under Thick Fog the Horn appears only 10 s before launch and never shows composition.

**Nest dies during muster.** The wave launches immediately and attacks the killer.

**Spent.**
- **Start.** When a Nest launches a wave it becomes Spent.
- **Effects.** It takes ×1.5 damage and its garrison does not regenerate. Its banner greys and it pulses on the minimap.
- **End.** Spent ends 45 s after that wave is broken (every member dead or dissolved), or 105 s after launch if the wave is still alive then. The 45 s covers walking 25-35 tiles out and clearing the garrison.
- **Feedback.** When the wave breaks, a horn sting plays and a toast reads "Wave 3 broken. NE Nest Spent 0:45", with a screen-edge arrow toward the Spent Nest.

**Movement (cohesion).** While advancing, a wave moves in three speed bands. Each band moves at the speed of its slowest member:
- riders (Stagriders)
- main body (every other non-siege unit)
- siege (Rootbreakers), which paths separately

Members in Engage use their own speed. The Horn notes "Riders ahead" or "Rootbreaker trailing".

**Target precedence.**
1. The objective target (Beacons: the lit Beacon nearest the Nest).
2. The doctrine target.
3. The Hearth.

After reaching or destroying its target, a wave attack-moves to the Hearth.

**Dissolve.** In every objective, a wave or raid unit that deals no damage, takes no damage and moves less than 1 tile for 30 s dissolves.

**Doctrines.**
- Each battle rolls one primary doctrine from those available at its depth.
- It shows as the Nest banner icon once a Nest is seen, and as a briefing hint. For a profile's first 3 runs the briefing also names the answer ("Hunt: bring Ashpikes, and guard your Tillers with towers.").
- The answer always starts with the doctrine name. When it names a drafted unit the run has not unlocked (Oathshield, Destrier), the briefing shows a core-units answer instead ("Spines: bring Coursers to run down the Spinecasters. Against Thornhusks, research Ember Edge at the Forgehall.").
- Each wave has a 25% chance to roll a random available secondary doctrine instead.
- Types below their unlock depth drop out of the weights.

| Doctrine | id | From d | Weights | Wave target | Briefing hint | Readable answer |
|---|---|---|---|---|---|---|
| Swarm | swarm | 1 | Thornling 60, Briarguard 20, Spinecaster 20, Stagrider 12, Rootbreaker 10, Thornhusk 10 | Hearth | "The thorns are thick and restless." | Spear line + Bowmen, towers |
| Spines | spines | 1 | Spinecaster 50, Briarguard 25, Thornling 25, Gloamwitch 10, Thornhusk 10 | Nearest player military unit at launch, then Hearth | "Quills litter the road." | Coursers, Oathshields; Destriers or Ember Edge for Thornhusks (core: Coursers, Ember Edge) |
| Hunt | hunt | 2 | Stagrider 45, Thornling 35, Spinecaster 20, Briarguard 15 | Storehouse with the most Tillers within 8 tiles, else the farthest Tiller from the Hearth, else Hearth | "Hoofprints in the mud." | Ashpikes, towers |
| Siegebreak | siegebreak | 3 | Briarguard 40, Spinecaster 40, Rootbreaker 20, Thornhusk 15, Stagrider 12 | Nearest Brazier Tower, else Hearth | "Uprooted oaks drag toward your camp." | Coursers, melee on the Rootbreakers |
| Court | court | 4 | Briarguard 25, Spinecaster 25, Stagrider 20, Gloamwitch 15, Thornhusk 15, Rootbreaker 10 | Hearth | "A crown glints in the briars." | Mixed army, focus the Gloamwitches; Destriers or Ember Edge for Thornhusks (core: Ember Edge) |

**Light adaptation** (SHOULD).
- At muster, if the player has 6 or more military units and at least 40% of them share a class, the counter type gets +50 weight.
- The Horn announces it, for example "The thorns have learned your bows."
- Counter types:
  - ranged-heavy → Stagrider (Thornling at d1)
  - infantry-heavy → Spinecaster
  - cavalry-heavy → Briarguard

**Unit AI (enemy).**
- **States:** Muster → Advance (attack-move along a flow field to the target) → Engage → Advance.
- **Engage priority:**
  1. A target it has a bonus against within 4 tiles.
  2. Whoever hit it in the last 3 s.
  3. The nearest player unit within 6 tiles (4 under Thick Fog).
  4. A player building blocking its path or within 2 tiles.
  - Rootbreakers only target buildings: the nearest within 8 tiles, else their path target.
- **Retargeting** happens every 0.5 s. A wave unit chases at most 6 tiles from where the engagement started, then resumes its advance and ignores that target for 5 s.
- **Player buildings** cost 12 in enemy flow fields. An enemy whose next tile is a building attacks it, so buildings are attacked, never walked through.

**Garrisons.**
- Each Nest has a standing guard (value 4 + d, standing-eligible types by doctrine weights). It regenerates 1 value per 10 s up to the cap, except while Spent.
- Guards aggro within 7 tiles of their post and leash at 12 tiles from the Nest. On leash they walk home and regenerate 5 HP/s.
- **Retaliation.** When a Nest falls below 60% HP, its garrison and any wave mustering there attack the attacker.
- When a Nest dies, its garrison attack-moves to the nearest player unit or building within 20 tiles, else the Hearth. It still counts as standing.

**Raids** (SHOULD, d≥3, Raze, Beacons and Elite only).
- Launch at each wave's launch + floor(I/2).
- Value 2 + d: Stagriders while at least 3 value remains, then Thornlings.
- Target: the farthest Tiller from the Hearth at launch. Raiders attack-move toward Tillers within 8 tiles for 25 s, then join the Hearth push.
- Raids count toward the wave pool and play the raid_alert horn.

### Court Noble (Elite): the Antlered Lord

- HP scales by `× (1 + 0.1(d − 3))`.
- The Lord waits at the main Nest and joins wave 3. If every Nest falls first, it rises at the last Nest's position and marches on the Hearth.
- Its abilities start only after it leaves the Nest or takes damage. It uses normal class counters.

| Noble | id | Class | HP (d3) | ATK | CD | Range | Armor | Speed | Abilities |
|---|---|---|---|---|---|---|---|---|---|
| The Antlered Lord | antlered_lord | cavalry | 2400 | 24 | 1.4 | 0.6 | 4 | 3.0 | **Wild Hunt** every 25 s: a 1.2 s line telegraph (8 long, 1.5 wide), then an 8-tile dash dealing 45 to every player unit in the line and knocking them 2 tiles aside (stepped). **Summon** 2 Stagriders every 40 s, max 6 summons alive, no summons below 50% HP. |

### Boss: the Briar Regent (`briar_regent`, class boss, radius 1.1)

**Phase 1, Enthroned.**
- The Regent stands on the Throne and is **untargetable**, shown with a "Warded" shield shimmer. The tracker reads "Burn the Root Hearts 0/3 · Regent Warded".
- **Thorn Lance** every 8 s: hits a player unit within 10 tiles of the Throne with a 1.2 s line telegraph, then 60 damage. It punishes early dives.
- 3 Root Hearts stand 16-22 tiles from the Throne (§K).
- **Waves:**
  - T1 100 s, interval 60 s. Value `floor((6 + 4n + 0.5n²) × BOSS_F × (0.4 + 0.2 × heartsAlive) × M)` with `BOSS_F = 1.5`, always using the actual heartsAlive.
  - Waves spawn round-robin at living Hearts, else at the Throne edge.
  - With 3 Hearts: 15, 24, 33, 45, 57, 72, 87 at 1:40, 2:40, 3:40 and so on.
- **Heart kills.** Each Heart destroyed removes 1500 HP from the Regent's phase-2 pool.

**Phase 2, Uprooted.**
- **Trigger:** all Hearts dead, or 8:00. At 8:00 this is **Wrath**: surviving Hearts keep spawning waves and the Regent deals +20% damage.
- **Stats:** HP `3000 + 1500 × heartsAlive`. Armor 5. ATK 40 with splash radius 1.5 (50% at the edge). CD 2.2. Range 1.2. Structure multiplier 2.0, ×2 vs siege. Speed 1.6.
- **Behavior:**
  - Marches on the Hearth by flow field and hits anything within 2 tiles on the way.
  - Retargets the Warden if it comes within 6 tiles, at most once per 15 s, and drops it after chasing 6 tiles.
- **Thornburst** every 16 s: a 1.5 s red ring telegraph (radius 4), then 50 damage to player units and buildings (×2 vs siege) with a 1-tile stepped knockback.
- **Rootsnare** every 12 s: targets the densest player group within 9 tiles (radius 2.5). After a 1.2 s telegraph it roots for 3 s. Rooted units can still attack.
- **Court Summons** at 75%, 50% and 25% HP: a 25-value guard (Briarguard, Spinecaster, Thornhusk) appears around it.
- **Enrage** below 25%: +30% speed, −25% cooldowns.
- **Waves** continue with the actual heartsAlive. After 8:00 the interval is 45 s.
- A boss HP bar sits top center.
- Retreat is disabled in this battle. Last Stand applies (§B).

## J. Neutrals

| Neutral | Rule |
|---|---|
| Ruined Cache (`ruined_cache`) | 1 per map (2 at d≥4). It sits in a side pocket at least 20 tiles from the Hearth and at least 10 from Nests. It is guarded by 2 + d value of Lurkers: Thornwake standing units with leash 8 that never join waves. After the guards die, the first player unit within 1.2 tiles of it gets +150 Ember and +15 Crowns. The Cache is impassable. |
| Ancient Cache (modifier) | Placed like a Ruined Cache but 14-20 tiles from the Hearth. Guarded by 6 + 2d value (Thornhusk eligible from d5). Reward per §K. |
| Beacon Stone (SHOULD) | Neutral object until lit. See §C. |

There are no neutral units, no wildlife and no neutral aggression in the slice.

## K. Procedural map generation, biomes, modifiers

**Battle map algorithm.** Seed = `hash(runSeed, nodeId, attempt)`, with `Rng` from `src/core/rng.ts` feeding `simplex-noise`.
1. **Noise.** Three independent 2-octave fields: water (wN), forest (fN) and rock (rN), each `0.65·N(x/14, y/14) + 0.35·N(x/6, y/6)`.
2. **Thresholds are quantiles**, so coverage is exact.
   - Water: wN below the biome water percentile.
   - Shallows: the next 4 percentile points above it.
   - Forest: fN above `1 − forest%`.
   - Rock: rN above `1 − rock%`.
   - Everything else is grass.
   - Run two cellular-automaton passes on forest (a tile is forest if at least 5 of its 8 neighbours are), then remove single-tile water.
3. **Anchors** from the per-objective table in `balance.ts`:

| Objective | Size | Hearth | Nests | Other anchors |
|---|---|---|---|---|
| raze | 56 | Random corner, center 9-12 from both edges | 2 (3 at d≥5), 0.5S-0.85S from the Hearth, at least 12 apart, at least 6 from the border | Caches |
| elite | 56 | As raze | 2, as raze. The Lord stands at the Nest nearest the map center. | Caches |
| holdfast | 48 | Exact center | 2 (3 at d≥5), 17-23 from the Hearth, at least 12 apart, at least 6 from the border | Caches |
| beacons | 56 | Edge midpoint, inset 9 | 2 (3 at d≥5), at y ≥ S−14 (the far edge), at least 12 apart | 3 Beacons 15-24 from the Hearth, at least 12 apart |
| boss | 64 | Template | Template | Template |

4. **Clearing.** Grass within radius 7 of the Hearth center, 4 around Nests and Root Hearts, and 3 around Beacons, Pickets and Caches.
5. **Corridors.** Carve a 3-wide corridor from the Hearth to each Nest along an A* path with costs grass 1, shallows 2, forest 4, rock 8, water 8. Forest and rock become grass. Water becomes shallows, which creates natural fords.
6. **Fairness kit** (on grass, outside footprints, distances from the Hearth center, with per-objective overrides):
   - 6 Thickets in one cluster at 4-7 tiles (Ashwood 4).
   - 3 outer Thickets at 9-13 tiles (Greenmarch +2).
   - A home Ember Seam at 8-11 tiles (none under Ember Famine).
   - At least 60 forest tiles in the 6-14 ring. If short, stamp forest discs of radius 3-4 at 8-11 tiles until satisfied.
   - **Contested Seams:**
     - raze, elite, beacons: 2, each on the corridor to one of the two nearest Nests, 11-15 corridor tiles from that Nest, offset 2-4 tiles sideways. Raze and elite add a Picket at each. Beacons has none.
     - holdfast: 1 at 12-16 tiles from the Hearth and at least 10 from every Nest, no Picket.
   - 2 mid-map Thicket clusters of 3.
   - Caches as in §J.
   - Reserve the Vanguard sites (§C).
7. **Connectivity.** BFS from the Hearth over walkable tiles. Every Nest edge, Seam, Thicket, Beacon, Cache, Picket and Vanguard site must be reachable. Otherwise carve a corridor as in step 5.
8. **Validation.**
   - Path from the Hearth to the nearest Nest: 30-50 tiles (holdfast 17-30).
   - Reachable trees: at least 300 (holdfast at least 200). A tree counts as reachable if its forest component touches a reachable tile.
   - Walkable tiles: at least 50%.
   - All key points reachable and every Vanguard site valid.

   On failure, retry with attempt + 1, up to 20 times. Then use the **fallback template**: all grass, a forest band 3 wide around the border, and forest discs of radius 4 at (0.3, 0.7), (0.7, 0.3) and (0.5, 0.5) scaled. Then run steps 3-9 with the same anchor table (clearing overrides any disc under the Hearth).
9. **Finish.** Place garrisons, Pickets, Lurkers and initial Blight. Pre-render the ground canvas and the tree canvas.

**Passability.**

| Tile or object | Player units | Enemy units | Speed |
|---|---|---|---|
| Grass, stump | walk | walk | ×1 |
| Shallows | walk | walk | ×0.6 |
| Blight (overlay on walkable tiles) | walk | walk | player ×0.8, enemy ×1 |
| Water, rock, tree, briar wall | blocked | blocked | |
| Thicket, Ember Seam, Cache, Beacon Stone | blocked | blocked | |
| Player buildings, Grainplots, foundations | blocked | flow cost 12, attacked when next | |
| Enemy structures | blocked | blocked | |

**Boss template (Heartwood, 64×64).**
- **Layout.** The Hearth center is at (10, 54) inside a plaza of radius 8. The Throne center is at (50, 14) inside a plaza of radius 6.
- **Root Hearts** sit 16-22 tiles from the Throne at −40°, 0° and +40° around the Throne-to-Hearth axis. The nearest is 34-40 path tiles from the Hearth and the side Hearts are 40-46.
- **Lanes.** Three lane polylines run from the Hearth plaza to each Root Heart and on to the Throne plaza. Lanes are 7 wide and separated by briar walls 3 thick.
- **Off-lane fill.** Noise places only forest and rock off-lane, never water.
- **Pickets** guard contested Seams at the midpoints of the two side lanes, with guards of 10 value.
- **Fairness kit.** Steps 6-7 still apply around the Hearth.

| Biome | id | Columns | Water | Forest | Rock | Twist |
|---|---|---|---|---|---|---|
| Greenmarch | greenmarch | 1-2 always. 3-4 at 30%. | 10% | 24% | 2% | Open fields, +2 outer Thickets |
| Fenreach | fenreach | 3-4 at 70%. 5-6 at 40%. | 22% | 16% | 0% | Lakes with Shallows rims (×0.6 speed), carved fords |
| Ashwood | ashwood | 5-6 at 60%. Col 7 is non-combat. | 4% | 36% | 5% | Trees hold 90 Timber. Near Thickets 4 instead of 6. +100 starting Grain. |
| Heartwood | heartwood | Boss | 6% | 30% | 3% | Hand-authored template with briar walls funnelling 3 lanes (above) |

**Blight.**
- Each Nest starts with Blight radius 4.
- **Growth:**
  - Raze, Beacons and Elite: +1 every 20 s up to radius 10 + d.
  - Holdfast: +1 every 25 s up to radius 8.
  - Root Hearts: +1 every 10 s up to radius 12.
- **Effects:**
  - Player units move ×0.8 on Blight, cannot build on it, and Tillers gather ×0.6 on it.
  - Thornwake units regenerate 1 HP/s on Blight.
  - A player building that Blight reaches withers at 2 HP/s.
- When the source dies, its Blight recedes to 0 over 4 s with a ring animation.
- **Ward.** A tile is blighted when a living source is within its current radius **and** `wardCount[tile] == 0`.
  - `wardCount` is recomputed when a warding building completes or dies.
  - Kindled Earth: every completed player building wards radius 5.
  - Kiln Masons: every Brazier Tower wards radius 3.
- Contested Seams sit 11-15 tiles from their Nest, so Blight swallows those within the cap between about 2:20 and 3:40. Killing the Nest frees them.

**Encounter modifiers.**
- Col 1: none. Col 2: 30% chance of one. Cols 3-4: 60% chance of one. Cols 5-6: one, plus a 30% chance of a second.
- Elite: +1 extra modifier from the negative list.
- No duplicates. The boss has none.

| id | Modifier | Kind | Exact effect | Payoff |
|---|---|---|---|---|
| blood_moon | Blood Moon | − | Wave and raid value ×1.3 | Battle Crowns ×1.5 |
| thick_fog | Thick Fog | − | Player sight −2 (min 3). Enemy acquire radius 4 instead of 6. The Wave Horn appears only 10 s before launch and never shows composition. | +20 Crowns |
| bountiful_wilds | Bountiful Wilds | ± | +6 Thickets (second cluster at 7-10 tiles). T1 −20 s. | Built in |
| creeping_wake | Creeping Wake | − | Blight grows every 12 s and its cap rises by 3 | Reward offers 4 choices |
| ember_famine | Ember Famine | − | No home Ember Seam. Contested Seams hold 1500. | +25 Crowns |
| fortified_nests | Fortified Nests | − | Nests +50% HP and +1 Thornspire each | Nest plunder ×2 |
| swift_hunt | Swift Hunt | − | Primary doctrine is Hunt. Enemy cavalry +20% speed. | +20 Crowns |
| downpour | Downpour | neutral | All ranged attacks (units, Hearth, towers, spires) −1 range, applied after caps. Burn disabled. | none |
| ancient_cache | Ancient Cache | + | An Ancient Cache (§J) guarded by 6 + 2d value | +60 Crowns and an extra Rare Boon pick after the battle |
| old_watchtowers | Old Watchtowers | + | 2 player-owned Brazier Towers stand 7-9 tiles from the Hearth toward the nearest Nest | Built in |

## L. Boons, drafts, events, non-battle nodes

**Boons.**
- Boons are unique per run and applied via `composeStats()` plus hooks.
- Tags drive synergy weighting (§M).
- **Kind:** "Stat" means a number change. "Rule" means a Boon that changes how you play.
- **Pool:** "Base" Boons are always available. "Codex" Boons are unlocked by meta Codex entries (§N).

| # | id | Name | Rarity | Tags | Kind | Pool | Effect | System |
|---|---|---|---|---|---|---|---|---|
| 1 | harvest_songs | Harvest Songs | C | Econ | Stat | Base | Grain and Timber gather +12% | Economy |
| 2 | deep_delvers | Deep Delvers | C | Econ, Ember | Stat | Base | Ember gather +20%, home Seam +200 | Economy |
| 3 | laden_packs | Laden Packs | C | Econ | Stat | Base | Carry +4 | Economy |
| 4 | hearthborn | Hearthborn | C | Econ | Stat | Base | +2 starting Tillers | Start state |
| 5 | master_joiners | Master Joiners | C | Fort, Econ | Stat | Base | Build speed +30%, building Timber costs −10% | Buildings |
| 6 | pike_discipline | Ashpike Discipline | C | Pike | Stat | Base | Ashpike and Oathshield +15 HP, +1 ATK | Units |
| 7 | yew_staves | Yew Staves | C | Bow | Stat | Base | Bowman, Brandbow and Outrider +1 range | Units |
| 8 | swift_coursers | Swift Coursers | C | Horse | Stat | Base | Coursers +15% speed and −10 Grain cost. Paddock costs 0 Ember. | Units |
| 9 | second_wind | Second Wind | C | Warden | Stat | Base | Warden ability cooldown −30%. Respawn 25 s + 5 s per prior death (instead of 45 + 15). | Hero |
| 10 | thornreaper_levy | Thornreaper Levy | C | Pike | Rule | Codex II | Ashpikes cost 30 G and 15 T, train in 8 s and have 50 HP | Units |
| 11 | spoils_of_the_wake | Spoils of the Wake | C | Econ | Rule | Codex II | Each enemy unit killed gives +3 Grain and +1 Ember | Economy |
| 12 | baggage_train | Baggage Train | R | Econ | Rule | Base | 50% of unspent resources at battle end (max 250 each) are added to the next battle's start, with at least +75 Ember | Run economy |
| 13 | quartermasters | Quartermasters | R | Pike, Bow, Horse | Stat | Base | Military train time −25%, military Grain costs −15% | Production |
| 14 | veterans_oath | Veteran's Oath | R | Veteran | Rule | Base | Retinue cap +3 pop. Retinue units gain +1 Rank when carried (max III). | Retinue |
| 15 | ember_mail | Ember-Tempered Mail | R | Pike, Horse | Stat | Base | All units +1 armor | Combat |
| 16 | firebrand | Firebrand Arrows | R | Bow, Ember | Rule | Base | Bowman and Outrider hits apply burn (2/s, 3 s) and deal double damage to buildings (structure multiplier 0.4, still below the 0.5 auto-target line, §F) | Combat |
| 17 | field_surgeons | Field Surgeons | R | Veteran | Stat | Base | Military (not siege) undamaged for 5 s regenerate 2 HP/s | Combat |
| 18 | flame_banner | Banner of the Last Flame | R | Warden | Stat | Base | Allies within 5 tiles of the Warden +15% ATK | Hero |
| 19 | plunderers | Plunderers | R | Horse, Siege | Rule | Base | Each Nest or Picket destroyed gives +100 Grain, Timber and Ember, and +10 Crowns | Economy |
| 20 | kiln_masons | Kiln Masons | R | Fort | Rule | Codex I | Brazier Towers can be built on Blight, build 2× faster, and ward Blight within 3 tiles | Blight / Defense |
| 21 | raiders_bounty | Raider's Bounty | R | Horse | Rule | Codex I | Courser structure multiplier 0.8. Each Courser hit on a Nest or Picket gives +3 Grain. | Economy / Combat |
| 22 | kindled_earth | Kindled Earth | M | Fort, Ember | Rule | Codex III | Your completed buildings ward Blight within 5 tiles. Your units ignore the Blight slow and the Blight gather penalty. | Blight |
| 23 | flame_hearth | Hearth of the Last Flame | M | Fort | Stat | Base | Hearth +1200 HP, regenerates 6 HP/s, fires 3 bolts per volley | Defense |
| 24 | warlords_gambit | Warlord's Gambit | M | Pike, Bow, Horse | Rule | Codex III | Military +25% damage, Tiller gather −25% | Combat / Economy |
| 25 | ember_tithe | Ember Tithe | M | Ember, Econ | Rule | Base | +1.2 Ember/s passive. Ember costs −15% (units, buildings and research; the command card shows the discounted cost). | Economy |

**Stacking rules** (all in `composeStats()`, unit-tested):
- Percentage bonuses add within a stat before multiplying. Flat bonuses add.
- Percentage cost changes apply before flat ones. Costs round to the nearest integer, min 0.
- Train time can drop at most 40%.
- Range bonuses are capped at +2 for units and +2 for structures.
- The Hearth fires 1 bolt per volley, or 3 with Hearth of the Last Flame. Ember Volley adds +2 bolts to the Hearth and towers while active (max 5 Hearth, 3 tower).

**Unit drafts.** Pick 1 of 3 eligible. Fewer are shown if the pool is smaller, and an empty pool gives a Boon pick instead.

| Draft id | Name | Unlocks | Prerequisite | Tags | Scope |
|---|---|---|---|---|---|
| draft_shieldwall | Shieldwall | Oathshield | none | Pike | MUST |
| draft_firecraft | Firecraft | Brandbow | none (training needs a Forgehall) | Bow, Ember | MUST |
| draft_heavy_horse | Heavy Horse | Destrier | none (training needs a Forgehall) | Horse | MUST |
| draft_siegecraft | Siegecraft | Siegeyard + Gatebreaker | none | Siege | MUST |
| draft_outriding | Outriding | Outrider | meta unlock | Horse, Bow | SHOULD |
| draft_lamplight | Lamplight | Lampbearer | meta unlock | Veteran | SHOULD |

**Events.** There are 6, with no repeats within a run. An Event node becomes a Camp once all are used.

| id | Event | Choices and outcomes |
|---|---|---|
| refugees_ford | Refugees at the Ford | (A) Pay 40 Crowns: +1 starting Tiller for the rest of the run. (B) Arm them: 2 Rank I Ashpikes join as Sellswords. (C) Take a tithe: +35 Crowns, next battle Grain gather −10%. |
| thorn_smith | The Thorn-Touched Smith | (A) Hidden at 1 Resolve. Lose 1 Resolve and pick 1 of 2 Rare Boons (Ember-Tempered Mail is one of them if unowned). (B) Grant mercy: +1 Resolve (+30 Crowns if at max). |
| sellsword_company | Sellsword Company | (A) Pay 70 Crowns: 3 Rank I Coursers join as Sellswords. (B) The Warden duels the captain: 50% they join free, otherwise −30 Crowns (min 0) and the Warden starts the next battle at 50% HP. (C) Decline. |
| cold_watchfire | Cold Watch-Fire | (A) The next battle starts with terrain explored and every Nest, Picket, Cache and Beacon shown as a ghost, and its wave 1 never launches. (B) Scavenge: a random Common Boon. |
| hollow_envoy | The Hollow Envoy | (A) A random unlocked Mythic Boon (a Rare if none remain), but all waves +15% for the rest of the run. (B) Cut him down: +25 Crowns, and the next battle gains Blood Moon. |
| wayshrine | Wayshrine of Ash | (A) +1 Resolve and lose a random Common Boon (nothing if none). (B) Offer 40 Crowns: the next 2 reward picks show 4 options. (C) Leave. |

**Camp** (pick one):
- **Rest:** +1 Resolve, or +30 Crowns if already at max.
- **Drill:** every Retinue unit +1 Rank (max III). With an empty Retinue, gain 2 Rank I Ashpikes as Sellswords instead.
- **Muster:** a Draft pick of 1 of 3. With an empty pool, a random Common Boon instead.

**Peddler stock:**
- 3 Boons, one per rarity: Common 55, Rare 100, Mythic 175 Crowns.
- 1 Draft: 90.
- Restore 1 Resolve: 90.
- 2 Sellsword offers drawn from: 2 Rank I Ashpikes for 35, 3 Rank I Bowmen for 45, 2 Rank I Coursers for 55.
- Reroll Boons: 15, +10 per repeat.
- Guild Ties (meta): all prices −15% and +1 Boon in stock (random rarity).

## M. Battle rewards

**Crowns on victory** = `20 + 4d` + plunder + par and Holdfast bonuses + flat modifier bonuses, then ×1.5 under Blood Moon. An Elite adds +40.
- **Plunder:** Nest 10 (×2 under Fortified Nests), Picket 5, Cache 15, Ancient Cache 60.
- **Bonuses:** par +30, Holdfast "Unbroken" +30, Holdfast "Uprooted" +30.
- **Typical:** d1 about 85, d4 about 120, d6 about 145. A run earns about 550-650 Crowns.

**Reward screen**, after Results and before Retinue:
- **Boon node:** pick 1 of 3.
- **Draft node:** pick 1 of 3 units.
- **Spoils node:** +80 Crowns, and pick 1 of 3 Commons.
- **Elite:** a Rare+ Boon pick, then a Draft pick.
- **Ancient Cache:** an extra Rare pick.
- Any pick may be skipped for +15 Crowns.

**Boon offer rules.**
- Rarity per card: normal C 62 / R 30 / M 8. Elite 0 / 75 / 25.
- Within a rarity, weight is ×2 if the Boon shares a tag with an owned Boon, the House or a drafted unit.
- Only Base and unlocked Codex Boons are eligible.
- No duplicates within an offer or a run. An exhausted rarity falls to the next lower one, then the next higher.
- **First reward Boon offer of a run:** if it rolls no Rule Boon, its last card is replaced by a random eligible Rule Boon of any rarity.

**Defeat:** no Crowns or reward. **Retreat:** keep plunder Crowns only.

## N. Meta-progression (localStorage)

**Renown per run:**
- `10 × battles won + 15 × Elites won + 50 if the Regent died + 2 × Nests and Root Hearts destroyed + 5 × nodes visited`, then × `(1 + 0.15 × Thornbound tier)`.
- An early loss earns about 40-55, a mid loss about 90-110, a win about 190-200.
- The Run Summary shows a progress bar to the next affordable unlock.

| id | Unlock | Cost | Effect | Scope |
|---|---|---|---|---|
| codex_1 | Codex I | 30 | Adds Kiln Masons and Raider's Bounty to the Boon pool | MUST |
| codex_2 | Codex II | 30 | Adds Thornreaper Levy and Spoils of the Wake (requires Codex I) | MUST |
| codex_3 | Codex III | 30 | Adds Kindled Earth and Warlord's Gambit (requires Codex II) | MUST |
| house_tallow | House Tallow | 40 | House option | MUST |
| outriding | Outriding | 50 | Outrider added to the Draft pool | SHOULD (fallback: War Chest, +40 starting Crowns) |
| lamplight | Lamplight | 50 | Lampbearer added to the Draft pool | SHOULD (fallback: Stout Heart, Hearth +20% HP) |
| hawk_eyes | Hawk Eyes | 60 | Warden gains **Hawk** (W): reveals radius 7 at any point for 6 s, cooldown 50 s. Counts as eyes on a muster point. | MUST |
| guild_ties | Guild Ties | 70 | Peddler prices −15%, +1 Boon in stock (random rarity) | MUST |
| house_grimbrand | House Grimbrand | 70 | House option | SHOULD (removed if cut) |
| seasoned_retinue | Seasoned Retinue | 80 | Retinue cap +3 pop | MUST |
| opening_boon | Opening Boon | 90 | Pick 1 of 3 Commons at run start | MUST |
| house_lowmere | House Lowmere | 100 | House option | SHOULD (removed if cut) |
| hearth_lore | Hearth Lore | 110 | +1 starting Tiller | MUST |
| fourth_banner | Fourth Banner | 140 | Max Resolve 4, starting at 4 | MUST |

The total is 950 Renown, about 9-10 runs. The cheap Codex entries give at least one unlock per run for the first 5 runs.

| House | id | Warden ability (Q) | Passives | Tags | Scope |
|---|---|---|---|---|---|
| Ardent (free) | ardent | **Rallying Horn:** allies within 6 tiles get +25% attack speed and +15% move speed for 8 s. Cooldown 45 s. | +50 Timber at battle start | Warden | MUST |
| Tallow | tallow | **Harvest Hymn:** Tillers within 8 tiles gather +60% for 15 s. Cooldown 50 s. | +1 starting Tiller. Grainplots cost 35 T. Muster Hall, Bowyard and Paddock cost +20 T. | Econ | MUST |
| Grimbrand | grimbrand | **Firepot:** ground target within 7 tiles, 1.0 s flight, radius 2, 50 damage plus burn 3/s for 4 s. Cooldown 30 s. | Muster Hall trains 25% faster (train time ×1/1.25, so −20%: Ashpike 9.6 s). Retinue units start at Rank I or higher. Grain gather −10%. | Pike, Warden | SHOULD |
| Lowmere | lowmere | **Ember Volley:** Hearth and Brazier Towers fire +2 bolts per volley for 10 s. Cooldown 60 s. | Brazier Towers cost 0 Ember and get +1 range. Bowmen +10 HP. | Fort, Bow | SHOULD |

**Thornbound tiers.** Win at tier k to unlock k + 1. Each tier stacks and adds +15% Renown.

| Tier | Added difficulty |
|---|---|
| I | Waves +10% |
| II | Nests and Root Hearts +25% HP |
| III | T1 −15 s, Nest garrisons +2 value |

**Storage.**
- `embermarch.meta.v1`: `{version, renown, unlocks[], tierUnlocked, stats{runs, wins, kills}, hintsSeen[], settings}`.
- `embermarch.run.v1`: `{version, seed, map, currentNode, nodesDone[], house, tier, boons[], drafts[], crowns, resolve, maxResolve, retinue[{type, rank, kills}], sellswords[{type, rank}], pending[], eventsSeen[], firstOfferDone, battleInProgress, rngState}`.
- Every read and write is wrapped in try/catch, and a version mismatch resets to defaults.

## O. Controls, HUD, screen flow, onboarding

| Input | Action |
|---|---|
| LMB / drag | Select / box select (units only). Military and the Warden take priority, and Tillers are selected only when no military is in the box. Clicking a building selects it. A selection holds units, or buildings of a single type, never both. |
| Shift+LMB / Shift+drag | Add to or remove from the selection |
| Double-click | Select all own units (or buildings) of that type on screen |
| RMB | Smart command, read from `pointerdown` button 2. Ground → move. Enemy → attack (Gatebreaker: move). Resource → gather (Tillers). Own unfinished or damaged building → build or repair. Drop-off → deposit. With a building selected → rally point. |
| Shift+RMB | Queue a move, attack-move or build order (max 8 queued). A build or repair queues only behind a current build order or a non-empty queue: a gathering, moving or idle Tiller starts it at once, keeps its gather job and returns to it afterwards. |
| A, then LMB | Attack-move |
| S / G | Stop / Hold ground |
| 1-9 | Recall group. Double-tap (≤ 300 ms) centers the camera. |
| Ctrl+1-9 or Alt+1-9 | Assign group where the browser allows it |
| Group slots (HUD) | LMB recall, double-click center, RMB assign, Shift+RMB add. This is the always-available path. |
| Shift+1-9 | Add to group |
| H / ` (backquote) | Select the Hearth / the Warden. Double-tap centers. Shift+` adds the Warden to the current selection. |
| . / , | Cycle idle Tillers (centers the camera) / select all military |
| Space | Jump to the latest alert |
| Tillers selected | C Cottage, E Storehouse, F Grainplot, B Muster Hall, R Bowyard, P Paddock, N Forgehall, T Brazier Tower, Y Siegeyard. Shift keeps placing, and Shift-placement always queues: the first foundation starts at once (a gathering Tiller starts it immediately) and later ones follow in order. RMB or Esc cancels. |
| Building selected | Q / W / E train (Shift+key queues 5, and with several same-type buildings selected each press goes to the shortest queue). Z / X / C research or Temper. V Rally the Hearth. Delete or Backspace cancels or demolishes. RMB on a queue slot cancels it. |
| Warden in selection | Q House ability (Firepot enters target mode). W Hawk (if unlocked). |
| Tab (hold) | Counter Wheel overlay |
| F2, Pause key, or HUD pause button | Active pause (orders allowed) |
| − / = | Slower / faster, stepping through 1×, 1.5× and 2× |
| M | Mute |
| Esc | Cancel mode, then deselect, then pause menu (Resume, Settings, Sound the Retreat from 3:00 and never in the boss, Quit to Title with its Resolve cost shown) |
| Arrows, screen edge (8 px), MMB drag | Pan |
| Wheel | Zoom 0.75-1.5× |
| Minimap LMB / drag / RMB | Jump camera / scrub / smart move order |

Keys bind on `e.code`. `preventDefault` is called on `contextmenu`, Space, Tab, Backquote and F2.

**HUD** (designed for 1280×720 and up, scales).
- **Top bar (32 px):** Grain, Timber, Ember with income/min on hover, Pop x/cap, battle clock, Resolve pips.
- **Wave Horn (top center):** "Wave 3 · 0:24 · NE" plus unit icons or a size label. A note line shows "Riders ahead", "Rootbreaker trailing", "The thorns have learned your bows" or "Ascendant in 0:30". When a Nest falls, a "Waves −30%" (or −20%) popup rises from the Horn.
- **Objective tracker (top right):** one of
  - "Nests 1/2 · Par 4:12" (the par timer ticks and greys out when missed)
  - "Kindling 140/450"
  - "Waves 4/6"
  - "Burn the Root Hearts 1/3 · Regent Warded"

  It also shows battle Crowns and the menu button.
- **Boss bar:** below the Horn.
- **Bottom panel (170 px):**
  - **Minimap (160×160, left):** fog, Blight, pings, Spent Nest pulses, revealed final-wave units, camera frame.
  - **Group slots:** a row of 9 above the selection panel, each showing its count and lead icon.
  - **Selection panel (center):**
    - Single unit: portrait, stats, rank chevrons, Strong/Weak icons.
    - Group: up to 30 type-grouped icons with HP, click to sub-select.
    - Building: HP and the 5-slot queue.
  - **Command card (right):** 5×2 grid. Each button shows its hotkey letter and cost, turns red when unaffordable, and has a tooltip with the reason when disabled.
  - **Idle-Tiller button and Warden button** above the minimap. The Warden button shows the respawn timer while the Warden is fallen.
- **Alerts:** a left-edge toast feed, red screen-edge chevrons toward off-screen threats, minimap pings. Alert types:
  - wave mustering, wave broken (with Spent timer), Warden fallen
  - under attack, Tillers under attack, idle Tillers
  - pop capped (max every 15 s), building or research complete
  - Nest destroyed, Beacon lit or snuffed, Last Stand
- **Boon tray:** top right under the tracker, with tooltips.

**Screen flow.**
```
Title ─ Continue ──────────────────────────────▶ Run Map (an interrupted battle resolves per §B Autosave)
      ─ New Run ─▶ Run Setup (House, Thornbound tier, seed, Opening Boon) ─▶ Run Map
      ─ Hall of Banners (unlocks, progress bar) ─▶ Title
      ─ How to Play (controls + Counter Wheel) ─▶ Title
Run Map ─▶ Battle/Elite/Boss node ─▶ Briefing (a preview: objective, biome, modifiers, doctrine hint
           [+ explicit answer for the first 3 runs], Retinue, par, reward, Vanguard pick;
           Back returns to the map, Begin Battle commits the route) ─▶ Battle ─▶ Results
              win      ─▶ Reward pick(s) ─▶ Retinue pick ─▶ Run Map
              retreat  ─▶ Resolve −1 ─▶ Retinue pick ─▶ Run Map | Run Over
              loss     ─▶ Resolve −1 ─▶ Run Map | Run Over   (node marked done either way)
        ─▶ Event / Camp / Peddler screen ─▶ Run Map
Boss win / Run Over ─▶ Run Summary (stats, Renown tally, next-unlock bar) ─▶ Hall of Banners ─▶ Title
```

**First-run hints.** A coach box at top center, dismissed on click, each shown once (stored in `hintsSeen`).

| # | Trigger | Hint |
|---|---|---|
| 1 | 0:00 | "Double-click a Tiller to select every Tiller on screen (or drag a box over them), then right-click a Thicket to gather Grain." |
| 2 | First gather order | "Press H to select the Hearth and Q to train more Tillers." |
| 3 | Clock ≥ 0:30, Timber ≥ 150 and only one military building | "With Tillers selected, press B for a Muster Hall or R for a Bowyard." |
| 4 | Pop within 2 of the cap | "Press C with Tillers selected to build a Cottage (+6 pop)." |
| 5 | Wave 1 mustering | "A wave musters. Get a unit close to its Nest to see what's coming, but Bramble Pickets guard the contested Seams. ` selects your Warden." |
| 6 | Wave 1 launched | "Select the Hearth and press V to rally nearby Tillers. It has a long cooldown." |
| 7 | Near Thickets below 30% | "Thickets run out. Grainplots (F) feed 2 Tillers forever." |
| 8 | First military unit trained | "Ctrl+1 or Alt+1 makes a group, or right-click a group slot. Press 1 to recall it." |
| 9 | Wave 1 broken | "That Nest is Spent and takes extra damage for 45 s after its wave breaks. Select your army, press A and click the Nest." (the number reads `SPENT.afterBroken`) |
| 10 | First counter popup | "Orange ×3 means a counter bonus. Grey means resisted. Hold Tab for the Counter Wheel." |

## P. Juice and SFX

**Visual juice** (ordered by priority. Items 1-6 are MUST, 7-11 SHOULD):
1. **Commands and hits.** Green ripple for move, red X for attack, amber hammer for build or gather.
2. **Impact and numbers.** Hit flash (white, 60 ms) and 2 px recoil. Orange counter popups and grey resisted popups (throttled per §G). Floating "+10" on drop-off in the resource color.
3. **Gathering.** Wood chips, grain motes, ember sparks. Tillers visibly carry their load. Gathered trees shrink as they deplete (only trees being gathered animate). Grainplots ripen.
4. **Buildings.** Scaffold lines fill in with progress, with a dust ring on completion. Smoke below 50% HP and fire below 25%. Collapse shrinks the building, throws dust and leaves a rubble decal, with a 4 px, 250 ms shake.
5. **Hearth and Nests.** The Hearth glow pulses. Nests pulse faster as their muster nears, and grey and droop while Spent.
6. **Blight and Nest death.**
   - Blight is drawn on a 1 px-per-tile canvas scaled up, redrawn on each radius change, with animated noise tendrils on edge tiles only.
   - Nest death: shockwave ring, Blight recedes, 6 px shake, 0.4 s at 0.5× speed, the "Waves −X%" popup.
7. **Projectiles.** Arrows arc with a shadow and a short trail. The Firepot arcs and leaves a 5 s fire decal. Burn shows small flames.
8. **Deaths.** Thornwake units dissolve into violet motes. Player units topple and fade over 1.2 s.
9. **Dusk and launch.** The dusk tint rises with the wave index. A red edge pulse and arrow mark each wave launch.
10. **Boss.** Telegraphs as expanding red rings and lines, 0.3 s slow-motion and a flash on phase change and Last Stand.
11. **Ceremony.** Rank-up sparkle plus a chevron. Reward cards flip in with a rarity glow. The run-map path draws in as animated ink with a pulsing ember on the current node. A victory banner sweeps in with rising embers.

Particles use `Math.random` (outside the simulation RNG) and are capped at 400.

**SFX.**
- WebAudio synth, max 8 voices, the same sound at most once per 60 ms.
- Gain falls off with distance from the camera center (0 at 30 tiles).
- Music and SFX duck under the horn.

| Event | Recipe | Scope |
|---|---|---|
| ui_click / ui_error | 1 kHz sine tick 20 ms / 120 Hz square buzz 150 ms | MUST |
| select | Triangle blip, pitch by class (worker high, siege low) | MUST |
| acknowledge | Second triangle blip a third above select | SHOULD |
| chop | Bandpassed noise burst (1.2 kHz) | MUST |
| mine | 1200 Hz square ping with fast decay | MUST |
| harvest | Highpassed noise swish | SHOULD |
| dropoff | Soft two-note sine coin | MUST |
| build_hammer / build_complete | Noise tap / three-note major arpeggio | SHOULD / MUST |
| unit_trained / research_complete | Two-note triangle chime / rising fifth chime | SHOULD |
| bow_loose | Noise sweep from high to low, 120 ms | MUST |
| bolt_fire | Sine glide from 600 to 300 Hz | SHOULD |
| melee_hit | Detuned squares plus a noise clang | MUST |
| thorn_hit | Short crunchy filtered noise | SHOULD |
| death_player / death_thorn | Low thud / crackle dissolve | SHOULD / MUST |
| building_destroyed | 60 Hz sine drop plus noise | SHOULD |
| nest_destroyed | Deep sine pitch-drop boom plus shimmer | MUST |
| wave_horn | Lowpassed sawtooth sweeping 110 to 220 Hz with vibrato | MUST |
| wave_broken | wave_horn recipe, 0.4 s, pitched up a fifth | MUST |
| raid_alert | Fast double horn | SHOULD |
| beacon_lit / snuffed | Rising / falling chime | SHOULD |
| boss_telegraph / boss_slam | Rising whine / sub thump plus noise | SHOULD |
| rank_up / card_flip | Sparkle arpeggio / paper flick noise | SHOULD |
| victory / defeat | Major arpeggio / falling minor line | MUST |
| combat_drums | 2-drum synth loop at 100 BPM while 5+ enemies are within 12 tiles of any player building, fading 4 s after the last leaves | SHOULD |
| ambient | Looping filtered-noise wind bed | SHOULD |

## Q. Scope

**MUST (vertical slice), in this build order:**
1. **Core simulation:**
   - 20 Hz fixed step and the tile map with the passability table.
   - A* (octile, binary heap, at most 8 requests per tick, no corner cutting, nearest-reachable fallback). Shared Dijkstra flow fields for group orders and waves.
   - Spatial hash with soft separation, and stuck detection.
   - Fog with 3 states at 5 Hz.
   - Units with state machines. Gather, build, repair, train, rally.
   - Projectiles, burn instances, and the damage formula via `composeStats()`.
2. **Buildings:** Hearth, Cottage, Storehouse, Grainplot, Muster Hall, Bowyard, Paddock, Forgehall (Tempers), Brazier Tower.
3. **Units:** Tiller, Warden (Ardent and Tallow abilities), Ashpike, Bowman, Courser.
4. **Enemy:**
   - Units: Thornling, Briarguard, Spinecaster, Stagrider, Rootbreaker, Thornhusk.
   - Structures: Nest, Thornspire, Picket.
   - Wave director: pools, doctrines, muster intel, Spent, `waveBank`, cohesion bands, cleanup and dissolve.
   - Garrisons with retaliation. Blight with the ward grid.
5. **Raze**, playable end to end with the Vanguard pick, HUD, group slots, minimap, controls and alerts.
6. **Run layer:**
   - Run map, Briefing, Results.
   - Boons: all 25, with Codex gating.
   - Drafts: Oathshield, Brandbow, Destrier, Siegecraft with Siegeyard and Gatebreaker.
   - Retinue and Sellswords, Resolve, Retreat, Crowns.
7. **Holdfast** and **Elite** with the Antlered Lord.
8. **Boss:** both phases, plus Last Stand.
9. **Nodes and content:** Events (6), Camp, Peddler, modifiers (10), research (11 including Tempers).
10. **Meta:**
    - Renown and the MUST unlocks (Codex I-III, Tallow, Hawk Eyes, Guild Ties, Seasoned Retinue, Opening Boon, Hearth Lore, Fourth Banner).
    - Houses Ardent and Tallow, Thornbound I-III.
    - Hall of Banners and saves.
11. **Juice and feedback:** juice items 1-6, the 15 MUST SFX, first-run hints, explicit briefing answers for the first 3 runs.

**SHOULD** (build in this order after the MUST list. If behind, cut from the bottom):
1. Beacons objective and Beacon Stones.
2. Houses Grimbrand (Firepot targeting) and Lowmere.
3. Raids.
4. Gloamwitch (if cut, its weight goes to Spinecaster).
5. Light adaptation.
6. Outrider and Lampbearer with their meta unlocks (fallback unlocks per §N).
7. Combat drum loop and the remaining SFX.
8. Juice items 7-11.

**DEFERRED:**
- Multiplayer, naval, a second enemy faction, enemy economy AI.
- Garrisoning, walls and gates, formations beyond the role-sorted offset, patrol, elevation.
- Mid-battle saves, replays or a command-stream recorder.
- Key rebinding, touch or gamepad, localization, daily seeds, achievements, music tracks.
- Weeping Matron or any second Noble, artillery units, a neutral unit team, Thornbound IV-V, siege research.

**Implementation notes.**
- **Determinism.** Seeded generation and the fixed-step simulation are deterministic. All gameplay randomness comes from `Rng.fork(label)`. Rendering interpolates at 60 fps.
- **Data and pipeline.**
  - Data lives in `src/data/{balance,units,buildings,research,boons,modifiers,events,meta}.ts`. Objective anchor tables and kit overrides live in `balance.ts`.
  - Stats are composed in one `composeStats(base, research, temper, boons, house, meta, rank)` that applies the §L stacking rules.
  - Hooks: `onBattleStart`, `onKill`, `onHit`, `onStructureDestroyed`, `onTick1s`, `onAttack`.
- **Rendering and caching.**
  - Ground lives on one cached canvas and trees on a second cached canvas, redrawn per depleted tile.
  - Blight and fog use 1-pixel-per-tile canvases scaled up.
  - Enemy structures persist as ghosts once seen.
  - Flow fields are invalidated on grid changes, debounced 0.5 s.
  - Off-screen entities are culled.
- **Debug API.** `window.__game` with `state()`, `spawn(type, x, y, team)`, `grant(res)`, `win()`, `lose()`, `setSpeed(n)`, `step(seconds)`, `setDepth(d)`, `forceWave(n, d, doctrine)` and `seed`.
- **Tests** (Vitest headless runner plus one Playwright smoke):
  - (a) **Counter tests.** Equal-cost groups spawn 8 tiles apart, then `step(60)`. The R-table winner must win at least 5 of 6 seeds.
  - (b) **Economy bot.** A scripted build order with no combat checks the R timing bands.
  - (c) **Wave survival.** Fixed armies face `forceWave(n, d, doctrine)` for the R wave rows.
  - (d) **Siege.** 15 mixed units against one d4 Nest with no garrison must take 35-50 s.
  - (e) **Generator sweeps.** 500 seeds per objective and biome, and 1000 run maps.
  - (f) **composeStats.** Unit tests for every stacking rule and cap.
  - (g) **Playwright smoke.** Title, Run Setup, Briefing, Battle, select, gather, train, `win()`, Reward, Retinue, Run Map.

## R. Balance targets and sanity checks

Sources:
- **Economy figures** come from the scratch economy bot. Setup: Vanguard Muster Hall, Storehouse at 0:00, Bowyard placed at 0:50, a second Storehouse at 1:20, Tillers queued continuously to a cap of 20, automatic Cottages and Grainplots, continuous military production.
- **Fight results** come from the scratch 2D group-combat sim, 6 seeds per matchup.
- These are design estimates. The engine tests in §Q are the gate.

| Check | Target (sim result) |
|---|---|
| First Tiller out | 0:10 |
| First Ashpike (Vanguard Muster Hall) | 0:12 |
| Tillers | 12 at 1:00, 17-18 at 2:00, 20 by 2:40 |
| Trained army, including the free Courser, excluding Retinue | 3:00 about 9, 4:00 about 17, 5:00 about 23, 6:00 about 29. Sim: 9 / 17 / 23 / 29 with a Muster Hall Vanguard, 9 / 18 / 24 / 30 with a Storehouse Vanguard. |
| Near Thickets (900 Grain) | Exhausted about 3:05-3:10. 4-6 Grainplots by 5:00. |
| Ember | About 90/min with 3 Ember Tillers and a Storehouse, about 430 by 5:00. It funds a Paddock, a Forgehall, one Temper and 4-6 Coursers or towers. |
| Wave-to-army ratio (wave value × 30 / bot army resources at launch, waves 3+) | d1 about 0.6, d4 about 0.9, d6 about 1.2. Sim: d1 0.57-0.66, d4 0.86-0.92, d6 1.12-1.27. The Retinue, Boons, towers, the Hearth, the Warden, Spent windows and Nest kills (N to 0.7 or 0.8) cover the gap. The real threat is splitting the army between defense and the push. |
| d1 wave 1 (value 10 at 1:46) | Warden + Courser alone win 6/6 (+0.55). With 3 Ashpikes, +0.79. |
| d1 wave 3 (value 22 at 4:02) vs half the bot army (5 Ashpike, 3 Bowman, Courser, Warden) | Player wins 6/6 (+0.67 to +0.69) against Swarm and Spines |
| d4 wave 4 (value 40 at 4:40) vs the full bot army at home | Player wins 6/6 (+0.66 to +0.77) across Swarm, Spines and Hunt mixes |
| d6 wave 4 (value 48 at 4:20) vs the bot army | No Retinue: 6/6 (+0.35 to +0.62). With a 6-pop Rank I Retinue: 6/6 (+0.60 to +0.76). |
| Counter wins, equal-cost groups | Each counter wins at least 5/6 seeds with at least a 30% HP edge. Sim: Ashpike > Courser +0.78, Courser > Bowman +0.77, Bowman > Ashpike +0.37, Oathshield > Bowman +0.74, Destrier > Oathshield +0.45, Ashpike > Destrier +0.40, Courser > Brandbow +0.78. |
| Thornling after the nerf | Equal cost: 6 Bowmen beat 13 Thornlings (+0.50) and 6 Ashpikes beat 12 Thornlings (+0.34). Swarm is no longer the strongest doctrine. In the engine with the real enemy AI, 6 Ashpikes beat 12 Thornlings by +0.22, and Spinecasters are not over-tuned (6 Ashpikes beat 6 Spinecasters by +0.37). |
| Thornhusk answer | 3 Destriers beat 2 Thornhusks (+0.70). Ashpikes trade even (3/6). Bowmen lose (−0.55). The Spines and Court briefings hint "bring heavy horse or Ember Edge". |
| Nest siege | 15 mixed units (7 Ashpike, 5 Bowman, 2 Courser, Warden) deal about 27 structure DPS: a d1 Nest falls in 30 s, d4 in 41 s, d6 in 48 s, and ×1.5 faster while Spent. 2 Gatebreakers (30.7 DPS each) take a d4 Nest in 18 s. |
| Raze chop time | Total Nest HP is d1 1600, d4 2200, d6 3900. The bot army deals 32 structure DPS at 4:00 and 49 at 6:00. Pure chop time at 6:00 is 32 s / 45 s / 79 s (53 s if every Nest is hit while Spent). |
| Antlered Lord (2400 HP at d3, abilities off) | 16 units + Warden kill it in about 35 s. With Wild Hunt and summons the target is 50-70 s. |
| Boss phase 2 | 24 units + Warden kill a 3000 HP Regent in about 70 s, and 4500 HP in about 110 s (sim, no splash). Gatebreakers deal 10 DPS each to it. |
| Blight | The cap is reached at 2:20 (d1), 3:20 (d4) and 4:00 (d6). Contested Seams within the cap are swallowed between 2:20 and 3:40. |
| Battle durations (median) | d1 Raze 4:30-6:00. d4 Raze 5:30-6:30. d5-6 Raze 6:00-7:30. Holdfast 5:30-6:30. Beacons 4:30-6:00. Elite 6:00-7:30. Boss 8:00-9:30. |
| No input (fix pass) | With no orders at all, Raze, Holdfast and Beacons are lost at d1-3 (0 wins over seeds 1-8). |
| Engine bot (fix pass, seeds 1-8) | Raze d1 6/8 (median 6:19), d2 5/8. Holdfast d1 7/8 (5:55), d2 7/8, d3 5/8. Beacons d1-2 8/8 (median 4:57-4:58). The bot is a scripted player in `tests/integration/bot.ts`; the matrix is in `.agent-status/sim.md`. |
| Run length | 35-44 min with 5-6 battles |
| Crowns | d1 about 85, d4 about 120, d6 about 145. A run earns 550-650. |
| Renown | Early loss about 45, mid loss about 100, win about 195. At least 1 unlock per run for the first 5 runs. |
| Entity caps | Player pop ≤ 60, standing ≤ 30, wave pool ≤ 50, enemies ≤ 80 |
| Performance | 60 fps with 140 units on 64×64 at 1080p. Simulation tick ≤ 4 ms. |
| Generation | 500-seed sweep per objective and biome: 100% pass validation or fallback, with 0 unreachable key points. Holdfast anchors succeed without fallback in at least 95% of seeds. 1000 run maps pass all path rules. |

**Tuning knobs** (in this order): F(d) slope (0.12), interval I, Nest HP, garrison value, Spent multiplier (1.5), Tiller gather rates, and Thornling HP and value.

---

## Revision notes

**Feasibility critiques applied**
- **F1 (pools).** Enemies now use separate pools: standing (30), wave (50) and total (80), with no neutral units. Standing values were cut: garrison 4+d, Picket 2+d, Lurkers 2+d, Ancient Cache 6+2d. Standing forces use only value-2+ non-siege types. `waveBank` is capped at 50% of the next wave.
- **F2 / GF3 (structure HP).** Nest HP is now 800+100(d−1), between F2's 700 and GF3's 900. Thornspires are 400 HP, 1 per Nest, and wither when their Nest dies (GF3). The third Nest comes at d≥5 everywhere (F2/F18). Raze par is 6:00 + 0:45 per extra Nest. Ascendant moves to 9:00, a compromise between 11:00 and 8:00.
- **F3 (anchors).** Added a per-objective anchor table and kit overrides. Holdfast's Hearth is exactly at the center with Nests 17-23 tiles away, 1 unguarded Seam, no Pickets and no raids. N now applies in Holdfast.
- **F4 (scope).** Beacons, Grimbrand and Lowmere moved to SHOULD. Cut outright: Pitch Thrower, Pitchworks, Stakewall, Lost Levy, Weeping Matron, Thornbound IV-V and Iron-Shod Rams. Juice 1-6 and 15 SFX are MUST.
- **F5 / F6 / F23 (engine specs).** Added the full movement spec, the generation order (corridors before the kit), a passability table, the reachable-tree rule, a hand-authored boss template and rendering caches.
- **F7 (damage pipeline).** Added a `structMod` override field. Towers, the Hearth and Thornspires target units only. Burn is defined (up to 3 appliers, units only). Gloamwitches fire spines. Nobles use normal counters. The bank is renamed `waveBank`.
- **F8 (IP distance).**
  - The Field became the Grainplot (2×2, impassable, 2 Tillers).
  - Trees hold 120 Timber.
  - The Forgehall offers mutually exclusive Tempers.
  - Broad Axes became Log Sledges (carry +5) and Woven Baskets became Hearth Watch.
  - The Paddock has no prerequisite.
- **F9-F12 and F14-F22.** All adopted: deadlock cleanup and dissolve, boss fixes, wave timing and target precedence, input fixes with HUD group slots, economy edge cases, stacking caps in `composeStats()`, Retinue and Sellsword rules, run-flow anti-save-scum, dead-number cleanup (d is 1-6, `BOSS_F`), placement rules, objective gaps, the 4-tile bonus-target rule and Thick Fog semantics.
- **F13 (tests).** The "Standard bot" win rates were replaced with counter, economy-timing, wave-survival, siege, sweep, `composeStats()` and Playwright smoke tests. `setDepth` and `forceWave` were added to the debug API.

**Game-feel critiques applied**
- **GF1 (opening).** Each battle now starts with 7 Tillers, 250/300/75 resources, a 10 s Tiller and a Vanguard building pick. T1 = 110−4d and I = 70−2d. The Hearth gives +20 pop so the larger start and Retinue fit.
- **GF2 (Beacons).** Beacons are dormant until 1:30 and guarded, the meter needs 300, and lit Beacons give 0.3 Ember/s.
- **GF4 (boss).** Gatebreakers deal ×1.5 to the Regent, and the Regent deals ×2 to siege. Root Hearts have 1400 HP, a 16-value garrison and 1 spire. Wrath comes at 8:00, and phase-2 HP is 3000 + 1500 × heartsAlive.
- **GF5 (Thornling and waves).** The Thornling nerf and the 6+4n+0.5n² wave base were adopted.
- **GF6 (Rally).** Rally the Hearth gives +2 ATK and +1 armor for 15 s, radius 8, cooldown 180 s, and drops carried loads.
- **GF7 (Spent).** Spent Nests are implemented. They stay Spent until 30 s after their wave breaks (max 90 s from launch), and the mustering Nest's garrison joins the wave.
- **GF9 (doctrines).** Added Stagrider weight to Swarm and Siegebreak and Briarguard weight to Hunt. Stronger light adaptation is kept as SHOULD.
- **GF10 (Blight).** The Blight cap is 10+d, growing every 20 s. Contested Seams sit 11-15 tiles from their Nest. Gather on Blight is ×0.6.
- **GF11 (feedback).** Wave-broken beat, Waves −X% popup, grey resisted popups, boss tracker text and explicit briefing answers are MUST. The drum loop is SHOULD.
- **GF12 (Resolve).** Last Stand added. Retreat unlocks at 3:00.
- **GF13 (boss map).** The boss map is 64×64 and the Regent moves at 1.6.
- **GF15-GF16 (unit and tower tuning).** Courser HP 85 and ATK 6. Towers cost 100T/25E, deal 12 and fire every 1.4 s. The Hearth deals 10. Lowmere towers cost 0 Ember.
- **GF17 (Brandbow).** Brandbow structure multiplier 0.8 with stacking burn. The Outrider gets auto-kite and range 5.
- **GF18 (Boon variety).** Harvest Songs merge. Hedgehog Drill and Stout Towers cut. Four Rule Boons added, and the first offer guarantees a Rule Boon.
- **GF19 (meta).** Renown per node, new costs, Stockpiles deleted, Codex I-III, and the next-unlock bar.
- **GF20-GF25.** Holdfast cleanup and Nest HP ×1.0. Boon outlier fixes. Cold Watch-Fire buff. Retinue cap 6 at +15% per Rank with a Rank III armor bonus. Escalating Warden respawn. Spoils is now 80 Crowns plus 1 of 3 Commons.

**Rejected or modified, and why**
- **F4, delete Outrider and Lampbearer.** Kept as SHOULD #6. They reuse the Spinecaster kite and Gloamwitch aura code and are the only Draft-pool growth. Fallback unlocks are defined.
- **F4, replace Kindled Earth with Ember Ward.** Rejected. The ward grid is needed for Kiln Masons anyway, so Kindled Earth costs almost nothing extra and stays a real rule-changer.
- **F4, delete light adaptation and Thornbound III.** Adaptation is kept as SHOULD because it is a few lines and answers GF9. Tier III is kept but redefined so it no longer depends on the SHOULD raids.
- **F16, Retinue max 10.** Changed to 12 (6 base, +3 Oath, +3 Seasoned) to honor GF23's larger base. The Hearth's +20 pop absorbs it.
- **F8, building categories map 1:1.** Building set kept. Separate infantry, archer and cavalry buildings are a genre convention. Names and the Forgehall's function are original. Only the Paddock prerequisite was removed.
- **GF1, "20 Tillers by 2:10".** The sim reaches 18 at 2:10 and 20 by about 2:40, and R states the measured band.
- **GF3, 3 Nests only at d≥6, Ascendant 8:00, Nest 900+75(d−1).** Replaced by the F2/GF3 midpoint above, so d5 also escalates and slow-but-reasonable d6 battles are not punished.
- **GF4, BOSS_F 1.4.** Set to 1.5 because the faster opening and the bigger Retinue make players stronger at the boss.
- **GF5, ratio targets 0.9 / 1.1 / 1.25.** Retargeted to bot ratios of 0.6 / 0.9 / 1.2. The new opening inflates the army, and these values keep a clear depth curve. Defended waves are meant to be won. The pressure comes from splitting the army.
- **GF8, player sight limited to 3 tiles into Blight.** Rejected because of its fog and targeting complexity (it breaks ranged auto-acquire against garrisons). It was replaced by "a unit within 6 tiles of the muster point", which forces the same dive into guard aggro. The 30 s muster was adopted.
- **GF13, Hearts 10-16 tiles from the Throne.** This contradicts its own 32-40 path-tile target on 64×64. Hearts were moved to 16-22 tiles on a fan around the Throne, which meets the path target and stays outside Thorn Lance range.
- **GF14, pause every 10 tiles to re-form.** Rejected. The slowest-member speed bands (riders, main body, siege) give cohesion without stop-start motion and keep Hunt and Swift Hunt fast.
- **GF17, Pitch Thrower target lead.** Moot, because the Pitch Thrower was cut for scope and IP distance.
- **GF20, each Nest kill cancels its share of waves.** Replaced by the global N factor: one formula, and Pillar 3 holds in every objective.
- **GF21, extra Kindled Earth clauses (+15% ATK on Blight).** Rejected. It adds a per-attack terrain check, and ward plus penalty immunity is already Mythic-strong.
- **GF22, Thorn-Touched Smith.** Modified. The Resolve cost replaces the Blight cost and the reward becomes a pick of 2 Rares, so both options are real.
- **GF25, Lord takes ×2 from spears.** Rejected for F7's uniform counter rule. HP was raised to 2400 instead, and summons stop below 50%.
- **GF18, cut Second Wind.** Kept and reworked, because GF24's escalating respawn gives it a purpose and the Warden tag needs a second Boon.
- **GF11f, grey "0" on the Warded Regent.** Moot, because the phase-1 Regent is untargetable (F10).
- **GF2, Beacon guards 3+2d.** Set to 2+d to fit the F1 standing pool.

**Other changes**
- **Holdfast Hbase** was raised to [6, 10, 14, 19, 26, 40] so Holdfast keeps pace with the faster opening.
- **Peddler prices** rose about 10% because par is now +30 and Spoils +80.
- **Old Watchtowers** is a new positive modifier replacing Lost Levy, so 10 modifiers remain without a neutral team. It only pre-places 2 player towers.

**Fix pass (playtest findings)**
- **Holdfast** waves rose to Hbase [8, 13, 18, 25, 34, 52] with their own slope 0.06 (d1 +30%, d6 within +3% of before), because the Hearth and Warden alone held all six waves at d1-2.
- **Spent** lasts 45 s after the break (cap 105 s from launch), because walking out and clearing the garrison used up the old 30 s window.
- **Beacons** need 450 Kindling (was 300).
- **Root Hearts** have 1200 HP and a 12-value garrison (were 1400 and 16): a run-like army burned only 1 of 3 Hearts before Wrath.
- **Bowmen, Outriders and Coursers** no longer auto-target structures and step out of a firing spire's range (§F).
- **Starting units** split around the Hearth so box-selecting the Tillers works (§C), and the free scout Courser is carried as Retinue only from Rank I (§B).
- **Same-tick outcome**: victory is checked before defeat (§B).
- **Kill credit** counts arrows and burns from attackers that died before they landed (stats, Spoils of the Wake); rank-ups still need a live killer.
- **Shift-build** follows AoE2: a gathering Tiller starts the first queued build at once (§O).
- **Builders** whose gather source ran out during the build pick the same resource within 10 tiles before going idle (§D).

**Evidence scripts**
- `/private/tmp/claude-502/-Users-openclaw-projects-roguelike-rts/33e6e381-d844-4c62-b192-2f2929a293b9/scratchpad/rev/econ3.py`
- `/private/tmp/claude-502/-Users-openclaw-projects-roguelike-rts/33e6e381-d844-4c62-b192-2f2929a293b9/scratchpad/rev/combat3.py`
- `/private/tmp/claude-502/-Users-openclaw-projects-roguelike-rts/33e6e381-d844-4c62-b192-2f2929a293b9/scratchpad/rev/tables3.py`