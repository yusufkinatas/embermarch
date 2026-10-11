# Embermarch

An original browser real-time strategy roguelike. Kindle a Hearth, send Tillers to Grain, Timber and Ember, raise an army, read the coming wave, break it, and burn the Thorn Nests while they are Spent. Between battles, march a branching road, draft new unit types, take Boons, carry a Retinue of veterans, and finally burn the Briar Throne.

See `docs/GDD.md` (design, the source of truth) and `ARCHITECTURE.md` (engineering contract).

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

Title → New Run → pick a House → Begin the March. A fresh profile starts with House Ardent.

URL shortcuts: `?seed=N` fixes the seed of the next new run. `?battle=raze|holdfast|beacons|elite|boss&depth=1-6&seed=N` jumps straight into a quick battle.

## How a run works

- **The road.** A run is a map of 8 columns: battles, Elites, Events, Peddlers and Camps, ending at the Boss. Hover a node to see its objective, doctrine and reward. Opening a battle's Briefing is only a preview: the route commits when you press Begin Battle.
- **A battle.** You start with a Hearth, one Vanguard building of your choice, 7 Tillers, a scout Courser and the Warden. Gather, build, and train counters: spears beat cavalry, cavalry beats ranged, ranged beats infantry. Waves muster at the Thorn Nests (the Horn shows when and where). Scout a muster to see its makeup, break the wave at your base, then strike: a Nest that launched its wave is **Spent**: it takes ×1.5 damage for at least 45 s after that wave breaks (longer for a far Nest).
- **Objectives.** Raze (burn every Nest), Holdfast (survive 6 waves), Beacons (light the stones to 450 Kindling), Elite (also slay the Antlered Lord) and the Boss (burn 3 Root Hearts, then slay the Briar Regent).
- **Rewards.** Boons (passives and rule changes), Drafts (new unit types for the rest of the run), Spoils (Crowns plus a Common Boon), and a Retinue of surviving veterans (up to 6 pop) who keep their Rank. Crowns buy from the Peddler.
- **Resolve** is the run's lives (3). A lost battle or a Retreat costs 1. If it leaves you with no soldiers, 2 Ashpike Stragglers join the next battle. In the boss battle, Resolve buys Last Stands. At 0 the march ends.
- **Renown.** Every run, won or lost, earns Renown to spend in the Hall of Banners on Houses, Codex Boons and options. Winning unlocks the next Thornbound difficulty tier.

## Controls

Keys bind to physical key positions; hotkey labels follow your keyboard layout (QWERTZ, AZERTY).

| Input | Action |
|---|---|
| LMB / drag | Select / box-select. Military and the Warden take priority over Tillers. |
| Shift + LMB | Add to or remove from the selection |
| Double-click | Select all units of that type on screen |
| RMB | Smart command: move, attack, gather, build / repair, deposit, rally (with a building selected) |
| Shift + RMB | Queue orders (up to 8). On a foundation, a gathering Tiller starts it at once, then goes back to gathering. |
| A › LMB | Attack-move; on an enemy unit or building, attack it |
| S / G | Stop / Hold ground |
| Ctrl + 1-9 (or Alt + 1-9, or RMB a group slot) | Make a group |
| Shift + 1-9 | Add the selection to a group |
| 1-9 | Recall a group (double-tap centres) |
| H / ` | Select the Hearth / the Warden (double-tap centres). Shift + ` adds the Warden to the selection. |
| . / , | Cycle idle Tillers / select all military |
| Space | Jump to the latest alert |
| C E F B R P N T Y (Tillers selected) | Cottage, Storehouse, Grainplot, Muster Hall, Bowyard, Paddock, Forgehall, Brazier Tower, Siegeyard. Shift keeps placing and queues the foundations. |
| Q / W / E (building selected) | Train. Shift + Q trains 5. |
| Z / X / C (building selected) | Research or Temper |
| V | Rally the Hearth |
| Q / W (Warden selected) | House ability / Hawk |
| Del / Backspace | Cancel a foundation; press twice to demolish |
| LMB / RMB on a queue slot | Cancel that unit |
| Tab (hold) | Counter Wheel |
| F2 / Pause | Pause. Orders are still accepted. |
| − / = | Slower / faster (1×, 1.5×, 2×) |
| M | Mute |
| Esc | Cancel, deselect, then the pause menu (Retreat from 3:00, Quit) |
| Arrows / screen edge / MMB drag | Pan |
| Wheel | Zoom |
| Minimap LMB / drag / RMB | Jump the camera / scrub / move, attack or rally there |

### On phones and tablets

Embermarch is made for a mouse and keyboard, and a phone or tablet first shows a notice saying so (Continue anyway is remembered). On touch: tap to select, tap the ground to move or attack, drag to pan. Hold a phone sideways so the menus fit the screen.

## Develop

```bash
npm test           # vitest: sim, nav, mapgen, run layer, HUD logic, bot-played battles (tests/integration)
npm run typecheck
npm run build
npm run e2e        # playwright (builds and serves on 4173)
```

`BATTLE_LOG=1 npx vitest run tests/integration --silent=false` prints a summary of each bot-played battle. In the browser, `window.__game` exposes a debug API (`screen()`, `run()`, `quickBattle(opts)`, and in battle `state()`, `spawn`, `step`, `forceWave`, `win()` and more); see `ARCHITECTURE.md`.
