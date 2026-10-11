/**
 * Event and alert helpers with throttling (GDD §O alerts, §P feedback). OWNER: sim-core.
 */
import { ALERT_TEXT } from '../data/text';
import { core, ticks } from './core';
import type { AlertKind, GameEvent, World } from './types';

export function emit(world: World, ev: GameEvent): void {
  world.events.push(ev);
}

/** Throttle windows in seconds (§O). */
export const ALERT_THROTTLE = {
  underAttack: 10,
  tillersAttacked: 10,
  idleTillers: 15,
  /** Areas for "under attack" throttling are cells of this size (tiles). */
  areaSize: 12,
};

/**
 * Returns true (and arms the throttle) if `key` may fire now. `seconds` is the minimum gap.
 */
export function throttle(world: World, key: string, seconds: number): boolean {
  const c = core(world);
  const ready = c.alertReady.get(key) ?? -Infinity;
  if (world.tick < ready) return false;
  c.alertReady.set(key, world.tick + ticks(seconds));
  return true;
}

export function alert(
  world: World,
  kind: AlertKind,
  opts: { text?: string; x?: number; y?: number; priority?: 'low' | 'normal' | 'high' } = {},
): void {
  const ev: GameEvent = { t: 'alert', kind, text: opts.text ?? ALERT_TEXT[kind] };
  if (opts.x !== undefined && opts.y !== undefined) {
    ev.x = opts.x;
    ev.y = opts.y;
  }
  if (opts.priority) ev.priority = opts.priority;
  world.events.push(ev);
}

/** Area key for per-area throttling. */
export function areaKey(x: number, y: number): string {
  const s = ALERT_THROTTLE.areaSize;
  return `${Math.floor(x / s)},${Math.floor(y / s)}`;
}
