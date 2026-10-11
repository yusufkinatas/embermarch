/**
 * Alert feed + screen-edge threat markers (GDD §O "Alerts"). Pure models; the HUD renders them.
 * Times are real (wall-clock) seconds so toasts fade at the same pace at any game speed.
 */
import { UNITS } from '../data/units';
import type { AlertKind, Building, UnitId, World } from '../sim/types';
import { PLAYER } from '../sim/types';
import { plural } from './format';

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

  /** `tone` overrides the kind's tone (HUD-made notices use kind 'info' with their own tone). */
  push(a: { kind: AlertKind; text: string; x?: number; y?: number; priority?: 'low' | 'normal' | 'high'; tone?: AlertTone }, now: number): AlertItem | null {
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
      tone: a.tone ?? alertTone(a.kind),
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

  /** Rewrite a live toast in place (aggregated notices): new text / position, raised again now. */
  revise(item: AlertItem, a: { text: string; x?: number; y?: number }, now: number): void {
    if (!this.items.includes(item)) return;
    item.text = a.text;
    item.at = now;
    if (a.x !== undefined && a.y !== undefined && Number.isFinite(a.x) && Number.isFinite(a.y)) {
      item.x = a.x;
      item.y = a.y;
      this.lastPositioned = { x: a.x, y: a.y, at: now };
    }
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

// ---------------------------------------------------------------------------
// Unattended foundations (safety net for abandoned build orders)
// ---------------------------------------------------------------------------

/** Battle seconds a foundation may sit with no Tiller assigned before the notice. */
export const UNATTENDED_AFTER = 15;
/** Battle seconds before the same foundation can raise the notice again. */
export const UNATTENDED_REPEAT = 90;
export const UNATTENDED_TEXT = 'A foundation stands unattended';

/**
 * Tracks own unfinished buildings that no Tiller is working on: no Tiller's current order and no
 * queued order is a build of it. After UNATTENDED_AFTER battle seconds `update` returns it once
 * (then at most every UNATTENDED_REPEAT seconds while it stays unattended).
 */
export class UnattendedFoundations {
  private readonly since = new Map<number, number>();
  private readonly notified = new Map<number, number>();

  update(world: World): Building[] {
    const t = world.time;
    const attended = new Set<number>();
    for (const u of world.units) {
      if (!u.alive || u.owner !== PLAYER || u.type !== 'tiller') continue;
      if (u.order.type === 'build') attended.add(u.order.buildingId);
      for (const q of u.queue) if (q.type === 'build') attended.add(q.buildingId);
    }
    const due: Building[] = [];
    const live = new Set<number>();
    for (const b of world.buildings) {
      if (!b.alive || b.owner !== PLAYER || b.built) continue;
      live.add(b.id);
      if (attended.has(b.id)) {
        this.since.delete(b.id);
        continue;
      }
      const s = this.since.get(b.id);
      if (s === undefined) {
        this.since.set(b.id, t);
        continue;
      }
      if (t - s < UNATTENDED_AFTER) continue;
      const last = this.notified.get(b.id);
      if (last !== undefined && t - last < UNATTENDED_REPEAT) continue;
      this.notified.set(b.id, t);
      due.push(b);
    }
    for (const id of [...this.since.keys()]) if (!live.has(id)) this.since.delete(id);
    for (const id of [...this.notified.keys()]) if (!live.has(id)) this.notified.delete(id);
    return due;
  }
}

// ---------------------------------------------------------------------------
// Units lost (off-screen military deaths, and always the free scout)
// ---------------------------------------------------------------------------

/** Deaths within this many real seconds of a notice join it ("3 soldiers lost"). */
export const LOSS_AGGREGATE = 3;
/** At most one new "lost" notice per this many real seconds. */
export const LOSS_THROTTLE = 5;

export interface LossBatch {
  /** Real time the batch was first shown (or created, while held back by the throttle). */
  start: number;
  counts: Map<UnitId, number>;
  total: number;
  x: number;
  y: number;
}

export type LossUpdate = { kind: 'new' | 'update'; text: string; x: number; y: number };

/** "Courser lost", "2 Bowmen lost", "3 soldiers lost". */
export function lossText(b: Pick<LossBatch, 'counts' | 'total'>): string {
  if (b.counts.size === 1) {
    const [type, n] = [...b.counts][0];
    const name = UNITS[type]?.name ?? type;
    return n === 1 ? `${name} lost` : `${n} ${plural(name, n)} lost`;
  }
  return `${b.total} soldiers lost`;
}

/**
 * Aggregates player unit deaths into notices: the first death shows at once, deaths within
 * LOSS_AGGREGATE s update that notice, and later deaths wait until LOSS_THROTTLE s after it.
 */
export class LossNotices {
  private current: LossBatch | null = null;
  private held: LossBatch | null = null;
  private lastShown = Number.NEGATIVE_INFINITY;
  private dirty = false;

  record(type: UnitId, x: number, y: number, now: number): void {
    const cur = this.current;
    if (cur && now - cur.start <= LOSS_AGGREGATE) {
      add(cur, type, x, y);
      this.dirty = true;
      return;
    }
    if (this.held) add(this.held, type, x, y);
    else this.held = add({ start: now, counts: new Map(), total: 0, x, y }, type, x, y);
  }

  /** What to show now: a new notice, an update of the live one, or nothing. */
  flush(now: number): LossUpdate | null {
    if (this.held && now - this.lastShown >= LOSS_THROTTLE) {
      const b = this.held;
      this.held = null;
      b.start = now;
      this.current = b;
      this.lastShown = now;
      this.dirty = false;
      return { kind: 'new', text: lossText(b), x: b.x, y: b.y };
    }
    if (this.dirty && this.current) {
      this.dirty = false;
      return { kind: 'update', text: lossText(this.current), x: this.current.x, y: this.current.y };
    }
    return null;
  }
}

function add(b: LossBatch, type: UnitId, x: number, y: number): LossBatch {
  b.counts.set(type, (b.counts.get(type) ?? 0) + 1);
  b.total++;
  b.x = x;
  b.y = y;
  return b;
}
