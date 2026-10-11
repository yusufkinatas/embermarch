/**
 * Small pure formatting helpers for the battle HUD (no DOM).
 */
import { COMPASS } from '../data/text';
import type { Cost, ResourceType } from '../sim/types';
import { RESOURCE_TYPES } from '../sim/types';

/** Battle clock "m:ss" (floors; negative shows 0:00). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds + 1e-6));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** Countdown "m:ss" that rounds up (0.2 s left still reads 0:01). */
export function formatCountdown(seconds: number): string {
  return formatClock(Math.ceil(Math.max(0, seconds) - 1e-6));
}

/** Short seconds label for cooldown overlays: "12", "3", "0.5" → "1". */
export function formatSeconds(seconds: number): string {
  return String(Math.max(0, Math.ceil(seconds - 1e-6)));
}

/** 8-way compass direction from one point to another (screen y grows southwards). */
export function compassDir(fromX: number, fromY: number, toX: number, toY: number): string {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === 0) return '';
  const a = Math.atan2(dy, dx);
  const idx = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return COMPASS[idx];
}

export interface CostEntry {
  res: ResourceType;
  amount: number;
}

/** Non-zero cost components in canonical order (Grain, Timber, Ember). */
export function costEntries(cost: Cost): CostEntry[] {
  const out: CostEntry[] = [];
  for (const res of RESOURCE_TYPES) {
    const v = cost[res];
    if (v && v > 0) out.push({ res, amount: Math.round(v) });
  }
  return out;
}

/** Normalize a wave reduction to whole percent: 0.3 → 30, 30 → 30. */
export function normalizePct(v: number): number {
  const pct = Math.abs(v) <= 1 ? v * 100 : v;
  return Math.round(Math.abs(pct));
}

/** Per-minute income label: "+42/min". */
export function formatRate(perMin: number): string {
  const v = Math.round(perMin);
  return `${v >= 0 ? '+' : ''}${v}/min`;
}

/** English plural for unit names: Bowman → Bowmen, Tiller → Tillers. */
export function plural(name: string, n: number): string {
  if (n === 1) return name;
  if (/man$/.test(name)) return `${name.slice(0, -3)}men`;
  if (/s$/.test(name)) return name;
  return `${name}s`;
}
