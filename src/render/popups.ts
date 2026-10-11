/**
 * Floating text popups (GDD §G readability, §P juice 2):
 * - counter "×3" (orange) and resisted "×0.5" (grey): at most once per attacker per 1.5 s,
 *   at most 24 on screen;
 * - resource "+10" floats on drop-off (resource color), capped separately.
 * Pure logic; drawing in fx.ts.
 */
import { PALETTE } from '../data/palette';

export const COUNTER_POPUP_MAX = 24;
export const COUNTER_POPUP_THROTTLE = 1.5;
export const FLOAT_TEXT_MAX = 40;

export type PopupKind = 'counter' | 'resisted' | 'float' | 'banner';

export interface Popup {
  kind: PopupKind;
  text: string;
  /** World position in px. */
  x: number;
  y: number;
  color: string;
  born: number;
  life: number;
  /** Rise distance in screen px over the lifetime. */
  rise: number;
  size: number;
}

/** Format a damage multiplier like the GDD: ×3, ×1.5, ×0.5, ×0.25, ×0.2. */
export function formatMult(m: number): string {
  if (!Number.isFinite(m)) return '×?';
  const r = Math.round(m * 100) / 100;
  return '×' + String(r);
}

export class PopupQueue {
  readonly items: Popup[] = [];
  private lastByAttacker = new Map<number, number>();

  /** Counter/resisted popup with per-attacker throttle and on-screen cap. Returns true if shown. */
  addCombat(attackerId: number, kind: 'counter' | 'resisted', mult: number, x: number, y: number, now: number): boolean {
    const last = this.lastByAttacker.get(attackerId);
    if (last !== undefined && now - last < COUNTER_POPUP_THROTTLE) return false;
    let combat = 0;
    let oldest = -1;
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (p.kind === 'counter' || p.kind === 'resisted') {
        combat++;
        if (oldest < 0 || p.born < this.items[oldest].born) oldest = i;
      }
    }
    if (combat >= COUNTER_POPUP_MAX && oldest >= 0) this.items.splice(oldest, 1);
    this.lastByAttacker.set(attackerId, now);
    this.items.push({
      kind,
      text: formatMult(mult),
      x: x + (Math.random() - 0.5) * 8,
      y,
      color: kind === 'counter' ? PALETTE.ui.counter : PALETTE.ui.resisted,
      born: now,
      life: 1.0,
      rise: 22,
      size: kind === 'counter' ? 15 : 12,
    });
    return true;
  }

  /** Generic floating text ("+10", "+150 Ember"); drops the oldest float when over the cap. */
  addFloat(text: string, x: number, y: number, color: string, now: number, size = 13, life = 1.2): void {
    let floats = 0;
    let oldest = -1;
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (p.kind === 'float') {
        floats++;
        if (oldest < 0 || p.born < this.items[oldest].born) oldest = i;
      }
    }
    if (floats >= FLOAT_TEXT_MAX && oldest >= 0) this.items.splice(oldest, 1);
    this.items.push({ kind: 'float', text, x, y, color, born: now, life, rise: 26, size });
  }

  /** Expire old popups and stale throttle entries. */
  step(now: number): void {
    let w = 0;
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (now - p.born < p.life) this.items[w++] = p;
    }
    this.items.length = w;
    if (this.lastByAttacker.size > 256) {
      for (const [id, t] of this.lastByAttacker) if (now - t >= COUNTER_POPUP_THROTTLE) this.lastByAttacker.delete(id);
    }
  }

  countCombat(): number {
    let n = 0;
    for (const p of this.items) if (p.kind === 'counter' || p.kind === 'resisted') n++;
    return n;
  }

  clear(): void {
    this.items.length = 0;
    this.lastByAttacker.clear();
  }
}
