# nav agent: done

## Done (GDD §F movement spec a-g, §K passability, Q MUST items)
All stub exports implemented with real logic; split into small modules under `src/sim/nav/`:

| File | What |
|---|---|
| `grid.ts` | `createNavGrid` (Water/Rock/BriarWall/Forest-with-timber blocked, Shallows speedMul 0.6), `setFootprint` (occupant + blocked, clears back to terrain, bumps version), `onTerrainChanged` (Forest with treeAmount<=0 becomes Stump, pushes `world.dirtyTiles` once, bumps version). Extra: `terrainBlocked`, `terrainSpeed`, `tileAt`, `tileClamped`. |
| `layers.ts` | Lazily derived per grid version: player-building layer, per-mode weights (enemy: player building = 12, shallows = 1/0.6), connected components per mode (O(1) reachability). |
| `pathfinding.ts` | A*: typed arrays, generation stamps, binary heap, octile heuristic, 8-dir, no corner cutting, `goalRect` (any walkable tile around a footprint), unreachable goals redirect to the reachable tile with the lowest heuristic (components, no full-map flood), `maxNodes` guard (best partial path), enemy mode (player buildings cost 12; other statics still walls), string pulling with a thick walkable LOS. Extra: `findPathEx` (`{waypoints, reached, tiles}`), `isReachable`, `nearestPassableTile`. ~0.06 ms avg / 0.7 ms max on 64x64 with obstacles. |
| `flowfield.ts` | Multi-source Dijkstra (8-dir, no corner cutting) cached by (mode, key); rebuilt on grid.version change, at most once per 0.5 s per key; subset goal requests reuse the field; new goals rebuild at once; LRU 48 / idle 30 s eviction. `flowStep` follows the Dijkstra predecessor (cost + step x weight, so units never dive into a cheap-to-leave building tile). ~0.46 ms per 64x64 build. Extra: `flowNextTile`, `flowFieldNeedsBuild`, `peekFlowField`, `releaseFlowField`, `flowFieldBuildCount`. |
| `spatial.ts` | Uniform hash (cell 2) rebuilt every tick, `queryUnits`, `nearestUnit` (ring search, early exit, deterministic ties). Extra: `forEachUnitNear` (no allocation). |
| `geometry.ts` | `distToEntity`, `edgeDistance` (circle/rect/rect-rect), `closestPointOn`. Extra: `distToRectXY`, `footprintOf`. |
| `movement.ts` (+ `steering.ts`, `collision.ts`, `separation.ts`, `placement.ts`, `state.ts`) | `stepMovement`: effective goal (target edge, footprint approach point), arrival, A* budget 8/tick with FIFO queue (queued units steer straight if in LOS), flow fields for `flowKey` groups and enemy-mode goals > 12 tiles (auto key `~t<id>` / `~p<tile>`), direct final approach in thick LOS, lookahead steering, speed = unit.speed capped by speedCap, x terrain x Blight (player x0.8 unless `kindled_earth`), soft separation (<= 0.5 tiles/s, movers shove settled units), lateral avoidance of settled units (wall-aware), static collision (axis sweeps, sliding, corner nudge so units line up with 1-tile gaps), enemy `blocked` + `blockedBy`, stuck detection (< 0.15 tiles/1 s -> repath; after 3 repaths in 6 s -> `stuck`, intent cleared), group arrival 0.5 + 0.35 sqrt(n), vx/vy/facing. `setMove`, `displaceUnit` (0.25 steps, stops at walls, no diagonal squeeze), `findFreeSpot`, `formationSlots`. |
| `fog.ts` | 3-state fog from player units (`unitStats(world, 0, type, rank).sight`, cached per type+rank per update), player buildings incl. foundations (BuildingDef sight from the center) and `world.vision` (expired entries removed: `until !== -1 && until <= tick`). Version bumps only on change. `exploreCircle` (r = Infinity explores all), `debug.revealAll`. |

## Behavior notes for consumers
- `setMove` stores a COPY of the intent. Mutating `unit.move` in place is fine (encounter does mode/speedCap). Path and stuck state reset only when the goal moves > 0.5 tiles (point goals) or targetId changes, whether through setMove or by direct assignment.
- Arrival: target intents `edgeDistance <= range` (no hysteresis, so nav "arrived" implies in range). Point goals within `max(range, 0.1)`, plus contact arrival (touching a settled friendly closer to the goal, within 1 tile; within 0.5 + 0.35 sqrt(n) for units sharing flowKey AND goal point), plus 0.35 hysteresis once arrived.
- A point goal inside a blocked tile is a footprint goal: the static entity there, else the 1x1 tile (trees). Arrival when unit-edge to footprint <= max(range, 0.3).
- `unreachable`: standing at the reachable tile closest to the goal; retried automatically when grid.version changes (moving targets every 1 s).
- `stuck`: unit.move cleared. Re-issuing the same goal within 6 s keeps the counters, so it gives up again after 1 s.
- `blocked` (enemy mode only): the next tile is a player building that is not the intent's target; `blockedBy` = its id; re-evaluated every tick.
- Idle units whose center is inside a blocked tile stay put (the enthroned Briar Regent on its dais); units with an intent walk out first.
- `findFreeSpot`: nearest tile center without static occupant and without a unit center within 0.55 (linear scan, so same-tick spawns never share a tile). Restricted to the start tile's walkable component when the start tile is walkable (never hops across water).
- `formationSlots(units, fromX, fromY, toX, toY, world?)`: slots[i] belongs to units[i]; melee front, ranged/support behind, workers and siege last; rows perpendicular to the move direction, spacing max(0.8, 2r + 0.05); slots on blocked or cut-off tiles move to the nearest free walkable tile in the goal's component.

## Contract changes (additive only)
- `formationSlots` gained an optional trailing `world?: World` parameter (sim-core already passes it). Without it, the movement system's last world is used when the units belong to it.
- New exports only (listed above). No edits to `src/sim/types.ts` or any other contract file.

## Known issues / limits
- Flow-field groups travel in a column through chokepoints (Dijkstra paths merge; the GDD caps separation at 0.5 tiles/s). They fan out at the destination.
- Soft separation lets a mover overlap settled units for a moment while shoving them (GDD §F d "units never block the grid").
- Terrain collision boxes are capped at 0.45 tiles, so the Lord (0.6) and the Regent (1.1) fit 1-tile corridors and overlap scenery slightly.
- Blight affects speed only, not path costs.

## Performance (measured)
- A*: 0.06 ms avg, 0.7 ms max (64x64, 25% obstacles). Flow field build: 0.46 ms.
- stepMovement with 140 units on 64x64: 0.37 ms/tick.
- Whole sim tick in real battles (raze, holdfast, elite, beacons, boss; forced waves, army orders): 0.09-0.16 ms avg, p99 < 0.5 ms. 0 units stuck, 0 movers inside walls across 15 x 300 s probes.

## How to test
- `npx vitest run tests/nav` (71 tests, about 1.2 s): grid/geometry/spatial, A* (no corner cutting, walls, fallback, goalRect, enemy cost 12, shallows, budget guard, 200-search perf), flow fields (monotonic, debounce and rebuild after grid change, enemy cost, footprint goals), movement (arrival, targets, trees, resources, unreachable and retry, felled-tree shortcut, building placed on path, groups, A* budget, enemy blocked/flow/detour, gaps, separation, shove, stuck and window, displacement, findFreeSpot, formation, perf), fog, plus `integration.test.ts` (real raze/holdfast battles via mapgen + sim-core + encounter).
- `npx tsc --noEmit 2>&1 | grep -E '^src/sim/nav|^tests/nav'` (clean).
