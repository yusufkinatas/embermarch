/**
 * Battle-level window.__game debug / test API (ARCHITECTURE.md "Debug / test API"). Merged into
 * any existing window.__game object (the app installs app-level functions) and removed on destroy.
 */
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import type { Camera } from '../render/camera';
import { debugForceWave } from '../sim/encounter';
import { spawnBuilding, spawnUnit } from '../sim/entities';
import { updateFog } from '../sim/nav/fog';
import type { BuildingId, Command, CommandResult, Cost, Owner, UnitId, World } from '../sim/types';
import { ENEMY, NEUTRAL, PLAYER, RESOURCE_TYPES } from '../sim/types';
import { endBattle, issueCommand } from '../sim/world';
import type { BattleUIState } from './types';

export interface DebugTarget {
  readonly world: World;
  readonly ui: BattleUIState;
  readonly camera: Camera;
  /** Synchronous sim advance (ticks + event processing). */
  debugStep(seconds: number): void;
  /** Select ids (normalized). */
  debugSelect(ids: number[]): void;
  /** True once callbacks.onEnd has fired. */
  isEnded(): boolean;
  /** Renderer frame stats (frameMs, avgMs, units, particles...), if the renderer exposes them. */
  renderStats?(): unknown;
}

export interface BattleState {
  time: number;
  countdown: number;
  outcome: World['outcome'];
  res: { grain: number; timber: number; ember: number };
  pop: number;
  popCap: number;
  playerUnits: Record<string, number>;
  enemyUnits: number;
  nestsAlive: number;
  selection: number[];
}

type GameApi = Record<string, unknown>;

function gameObject(): GameApi {
  const w = window as unknown as { __game?: GameApi };
  if (!w.__game || typeof w.__game !== 'object') w.__game = {};
  return w.__game;
}

function teamOf(team: unknown): Owner {
  if (team === 1 || team === 'enemy' || team === 'thorn') return ENEMY;
  if (team === 2 || team === 'neutral') return NEUTRAL;
  return PLAYER;
}

export function battleState(world: World, ui: BattleUIState): BattleState {
  const p = world.players[PLAYER];
  const playerUnits: Record<string, number> = {};
  let enemyUnits = 0;
  for (const u of world.units) {
    if (!u.alive) continue;
    if (u.owner === PLAYER) playerUnits[u.type] = (playerUnits[u.type] ?? 0) + 1;
    else if (u.owner === ENEMY) enemyUnits++;
  }
  let nestsAlive = 0;
  for (const b of world.buildings) if (b.alive && (b.type === 'thorn_nest' || b.type === 'root_heart')) nestsAlive++;
  return {
    time: world.time,
    countdown: world.countdown,
    outcome: world.outcome,
    res: { grain: p.res.grain, timber: p.res.timber, ember: p.res.ember },
    pop: p.pop,
    popCap: p.popCap,
    playerUnits,
    enemyUnits,
    nestsAlive,
    selection: ui.selection.slice(),
  };
}

/** Install the battle-level functions. Returns an uninstaller that removes exactly what was added. */
export function installDebugApi(t: DebugTarget): () => void {
  const g = gameObject();
  const added: string[] = [];
  const def = (name: string, value: unknown): void => {
    Object.defineProperty(g, name, { value, configurable: true, enumerable: true, writable: true });
    added.push(name);
  };
  const getter = (name: string, get: () => unknown): void => {
    Object.defineProperty(g, name, { get, configurable: true, enumerable: true });
    added.push(name);
  };

  getter('world', () => t.world);
  getter('ui', () => t.ui);
  getter('camera', () => t.camera);
  def('state', () => battleState(t.world, t.ui));
  def('spawn', (type: string, x: number, y: number, team?: unknown): number => {
    const owner = teamOf(team);
    if (type in UNITS) return spawnUnit(t.world, type as UnitId, owner, x, y).id;
    if (type in BUILDINGS) return spawnBuilding(t.world, type as BuildingId, owner, Math.floor(x), Math.floor(y)).id;
    throw new Error(`Unknown type: ${type}`);
  });
  def('grant', (res: Cost | number): void => {
    const bag = t.world.players[PLAYER].res;
    for (const r of RESOURCE_TYPES) {
      const v = typeof res === 'number' ? res : res[r];
      if (v) bag[r] = Math.max(0, bag[r] + v);
    }
  });
  def('win', (): void => endBattle(t.world, 'victory'));
  def('lose', (): void => endBattle(t.world, 'defeat'));
  def('setSpeed', (n: number): void => {
    if (Number.isFinite(n) && n > 0) t.ui.speed = Math.min(16, n);
  });
  def('step', (seconds: number): void => t.debugStep(seconds));
  def('forceWave', (n: number, doctrine?: string): void => debugForceWave(t.world, n, doctrine));
  def('issue', (cmd: Command): CommandResult => issueCommand(t.world, cmd));
  def('select', (ids: number[]): number[] => {
    t.debugSelect(ids);
    return t.ui.selection.slice();
  });
  def('reveal', (on = true): void => {
    t.world.debug.revealAll = on;
    try {
      updateFog(t.world);
    } catch {
      /* fog refreshes on the next 5 Hz update */
    }
  });
  def('pause', (on = true): void => {
    t.ui.paused = on;
  });
  def('ended', (): boolean => t.isEnded());
  def('renderStats', (): unknown => t.renderStats?.() ?? null);

  return () => {
    const obj = (window as unknown as { __game?: GameApi }).__game;
    if (!obj) return;
    for (const k of added) delete obj[k];
  };
}
