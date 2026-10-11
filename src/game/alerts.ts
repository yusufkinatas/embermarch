/**
 * Alert feed + screen-edge threat markers (GDD §O "Alerts"). Pure models; the HUD renders them.
 * Times are real (wall-clock) seconds so toasts fade at the same pace at any game speed.
 */
import type { AlertKind } from '../sim/types';

export type AlertTone = 'danger' | 'warn' | 'good' | 'info';

export interface AlertItem {
  id: number;
  kind: AlertKind;
  text: string;
  tone: AlertTone;
  x?: number;
  y?: number;
  /** Real time it was (last) raised. */
  at: number;
  /** Seconds it stays fully visible before fading. */
  ttl: number;
  /** How many times it was raised while visible (shown as ×N). */
  count: number;
}

export const ALERT_MAX = 5;
export const ALERT_TTL = 6;
export const ALERT_FADE = 0.8;
/** Same kind + text within this window refreshes the existing toast instead of stacking. */
export const ALERT_MERGE_WINDOW = 5;

const TONE: Record<AlertKind, AlertTone> = {
  under_attack: 'danger',
  tillers_attacked: 'danger',
  idle_tillers: 'warn',
  pop_capped: 'warn',
  building_complete: 'good',
  research_complete: 'good',
  unit_trained: 'info',
  warden_fallen: 'danger',
  warden_returned: 'good',
  wave_muster: 'warn',
  wave_launch: 'danger',
  wave_broken: 'good',
  raid: 'danger',
  nest_destroyed: 'good',
  beacon_lit: 'good',
  beacon_snuffed: 'danger',
  last_stand: 'danger',
  cache_looted: 'good',
  ascendant: 'danger',
  boss_phase: 'danger',
  info: 'info',
};

export function alertTone(kind: AlertKind): AlertTone {
  return TONE[kind] ?? 'info';
}

/** Alerts that point at a threat get a red screen-edge chevron while off-screen. */
export const THREAT_KINDS: ReadonlySet<AlertKind> = new Set<AlertKind>([
  'under_attack',
  'tillers_attacked',
  'raid',
  'wave_launch',
  'beacon_snuffed',
  'last_stand',
]);

export class AlertFeed {
  items: AlertItem[] = [];
  /** Most recent alert with a world position (Space jumps there). */
  lastPositioned: { x: number; y: number; at: number } | null = null;
  private nextId = 1;

  push(a: { kind: AlertKind; text: string; x?: number; y?: number; priority?: 'low' | 'normal' | 'high' }, now: number): AlertItem | null {
    const text = a.text.trim();
    if (!text) return null;
    if (a.x !== undefined && a.y !== undefined && Number.isFinite(a.x) && Number.isFinite(a.y)) {
      this.lastPositioned = { x: a.x, y: a.y, at: now };
    }
    const existing = this.items.find((it) => it.kind === a.kind && it.text === text && now - it.at < ALERT_MERGE_WINDOW + ALERT_TTL);
    if (existing && now - existing.at < ALERT_MERGE_WINDOW) {
      existing.count++;
      existing.at = now;
      if (a.x !== undefined) existing.x = a.x;
      if (a.y !== undefined) existing.y = a.y;
      return existing;
    }
    const item: AlertItem = {
      id: this.nextId++,
      kind: a.kind,
      text,
      tone: alertTone(a.kind),
      x: a.x,
      y: a.y,
      at: now,
      ttl: a.priority === 'high' ? ALERT_TTL + 3 : a.priority === 'low' ? ALERT_TTL - 2 : ALERT_TTL,
      count: 1,
    };
    this.items.push(item);
    while (this.items.length > ALERT_MAX) this.items.shift();
    return item;
  }

  /** Drop fully faded alerts. Returns true if the list changed. */
  expire(now: number): boolean {
    const before = this.items.length;
    this.items = this.items.filter((it) => now - it.at < it.ttl + ALERT_FADE);
    return this.items.length !== before;
  }

  /** 1 while fresh, fading to 0 over ALERT_FADE after ttl. */
  static opacity(it: AlertItem, now: number): number {
    const age = now - it.at;
    if (age <= it.ttl) return 1;
    return Math.max(0, 1 - (age - it.ttl) / ALERT_FADE);
  }
}

export type MarkerTone = 'threat' | 'spent' | 'muster';

export interface ThreatMarker {
  key: string;
  x: number;
  y: number;
  tone: MarkerTone;
  label: string;
  /** Real time when it disappears. */
  until: number;
  /** Real time it was raised (optional; used for grace periods). */
  since?: number;
}

export const MARKER_MAX = 6;

/** Screen-edge chevrons toward off-screen threats, launching waves and Spent Nests. */
export class ThreatMarkers {
  items: ThreatMarker[] = [];

  /** Add or refresh (by key). */
  set(m: ThreatMarker): void {
    const i = this.items.findIndex((it) => it.key === m.key);
    if (i >= 0) this.items[i] = m;
    else this.items.push(m);
    if (this.items.length > MARKER_MAX) {
      // Keep the newest threats; Spent markers yield first.
      this.items.sort((a, b) => (a.tone === 'spent' ? 0 : 1) - (b.tone === 'spent' ? 0 : 1) || a.until - b.until);
      this.items.splice(0, this.items.length - MARKER_MAX);
    }
  }

  remove(key: string): void {
    this.items = this.items.filter((it) => it.key !== key);
  }

  expire(now: number): void {
    if (this.items.some((it) => it.until <= now)) this.items = this.items.filter((it) => it.until > now);
  }
}

/**
 * Place an edge chevron for a point outside the play rect. Returns null when the point is visible.
 * All values in screen CSS px. `angle` is the direction from the play-area center to the point.
 */
export function edgePlacement(
  sx: number,
  sy: number,
  play: { x0: number; y0: number; x1: number; y1: number },
  inset: number,
): { x: number; y: number; angle: number } | null {
  if (sx >= play.x0 && sx <= play.x1 && sy >= play.y0 && sy <= play.y1) return null;
  const cx = (play.x0 + play.x1) / 2;
  const cy = (play.y0 + play.y1) / 2;
  const dx = sx - cx;
  const dy = sy - cy;
  const angle = Math.atan2(dy, dx);
  const hw = Math.max(1, (play.x1 - play.x0) / 2 - inset);
  const hh = Math.max(1, (play.y1 - play.y0) / 2 - inset);
  const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t, angle };
}
