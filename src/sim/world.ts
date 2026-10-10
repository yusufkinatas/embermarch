/**
 * World creation and the fixed-step tick. OWNER: sim-core.
 *
 * Tick order (stepWorld):
 *  0. if countdown > 0: countdown -= TICK_DT, update fog, return
 *  1. tick++, time += TICK_DT; copy x/y -> prevX/prevY for all units and projectiles
 *  2. nav.rebuildSpatial(world)
 *  3. encounter.tickEncounter(world)        (director, enemy AI orders, blight, objectives)
 *  4. production: training queues, research, passive income, abilities/buffs expiry, Warden respawn
 *  5. unit behaviors (sim-core): status (burn/regen/buffs), order execution -> sets unit.move / attacks
 *  6. nav.stepMovement(world)               (paths, flow fields, separation, stuck detection)
 *  7. projectiles
 *  8. building defensive fire (Hearth, towers, Thornspires)
 *  9. remove dead entities from live lists
 * 10. every 4th tick: nav.updateFog(world)
 * 11. outcome checks (defeat when the Hearth dies unless Last Stand; victory is set by encounter)
 */
import type { BattleResult, BattleSetup, Command, CommandResult, GameEvent, GeneratedMap, World } from './types';

export function createWorld(setup: BattleSetup, gen: GeneratedMap, opts?: { skipEncounter?: boolean }): World {
  throw new Error('not implemented');
}

export function stepWorld(world: World): void {
  throw new Error('not implemented');
}

export function issueCommand(world: World, cmd: Command): CommandResult {
  throw new Error('not implemented');
}

/** Take and clear all pending events. */
export function drainEvents(world: World): GameEvent[] {
  const ev = world.events;
  world.events = [];
  return ev;
}

/** Build the run-layer result. outcome 'retreat' is used by Sound the Retreat. */
export function buildBattleResult(world: World, outcome: BattleResult['outcome']): BattleResult {
  throw new Error('not implemented');
}

/** Force the outcome (debug win()/lose(), encounter objectives). Emits victory/defeat events once. */
export function endBattle(world: World, outcome: 'victory' | 'defeat'): void {
  throw new Error('not implemented');
}
