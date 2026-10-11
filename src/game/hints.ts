/**
 * First-run hints (GDD §O). Pure trigger logic: polled conditions (clock, resources, pop) plus
 * one-shot signals from sim events. Each hint shows once; the HUD renders the coach box and
 * reports dismissals through `dismiss()` (→ callbacks.onHintSeen).
 */
import type { HintDef } from '../data/text';
import { HINTS } from '../data/text';
import { POP } from '../data/balance';

export type HintSignal = 'first_gather' | 'wave1_muster' | 'wave1_launch' | 'first_military' | 'wave1_broken' | 'first_counter_popup';

/** Which hint each signal raises. */
const SIGNAL_HINT: Record<HintSignal, string> = {
  first_gather: 'train_tiller',
  wave1_muster: 'scout',
  wave1_launch: 'rally',
  first_military: 'groups',
  wave1_broken: 'spent',
  first_counter_popup: 'counters',
};

export interface HintSnapshot {
  /** Battle clock seconds. */
  time: number;
  /** Kindle countdown remaining. */
  countdown: number;
  timber: number;
  pop: number;
  popCap: number;
  /** Own military production buildings (Muster Hall, Bowyard, Paddock, Siegeyard), foundations included. */
  militaryBuildings: number;
  /** Remaining fraction of the near-Hearth Thickets (null if there were none). */
  nearThicketFrac: number | null;
}

/** Seconds a hint stays before a queued one may replace it. */
export const HINT_MIN_SHOW = 12;

export class HintDirector {
  private readonly done = new Set<string>();
  private readonly queue: HintDef[] = [];
  private shown: { hint: HintDef; at: number } | null = null;
  /** Hints that became seen since the last drainSeen() (to persist via onHintSeen). */
  private seenLog: string[] = [];

  constructor(
    seen: readonly string[],
    readonly enabled: boolean,
    private readonly defs: readonly HintDef[] = HINTS,
  ) {
    for (const id of seen) this.done.add(id);
  }

  /** Raise a hint by id (no-op if seen, queued or showing). */
  raise(id: string): void {
    if (!this.enabled || this.done.has(id)) return;
    if (this.shown?.hint.id === id || this.queue.some((h) => h.id === id)) return;
    const def = this.defs.find((h) => h.id === id);
    if (def) this.queue.push(def);
  }

  signal(s: HintSignal): void {
    if (s === 'first_gather') this.complete('gather');
    this.raise(SIGNAL_HINT[s]);
  }

  /**
   * The player already did what a hint teaches: drop it (visible or queued) and never raise it.
   * Returns true if the hint was not done before (so the caller can persist it as seen).
   */
  complete(id: string): boolean {
    if (!this.enabled || this.done.has(id)) return false;
    this.markDone(id);
    if (this.shown?.hint.id === id) this.shown = null;
    const i = this.queue.findIndex((h) => h.id === id);
    if (i >= 0) this.queue.splice(i, 1);
    return true;
  }

  /** Evaluate polled triggers. */
  evaluate(s: HintSnapshot): void {
    if (!this.enabled) return;
    if (s.countdown <= 0) this.raise('gather');
    if (s.time >= 30 && s.timber >= 150 && s.militaryBuildings === 1) this.raise('military_building');
    if (s.popCap > 0 && s.popCap < POP.hardCap && s.pop >= s.popCap - 2) this.raise('cottage');
    if (s.nearThicketFrac !== null && s.nearThicketFrac < 0.3) this.raise('grainplot');
  }

  /**
   * Advance the coach box. Returns the hint that should be visible now (or null). `now` is real time.
   * A visible hint gives way to a queued one only after HINT_MIN_SHOW seconds (it then counts as seen).
   */
  update(now: number): { current: HintDef | null; autoDismissed: string | null } {
    let autoDismissed: string | null = null;
    if (this.shown && this.queue.length && now - this.shown.at >= HINT_MIN_SHOW) {
      autoDismissed = this.shown.hint.id;
      this.markDone(autoDismissed);
      this.shown = null;
    }
    if (!this.shown && this.queue.length) {
      const next = this.queue.shift()!;
      this.shown = { hint: next, at: now };
    }
    return { current: this.shown?.hint ?? null, autoDismissed };
  }

  get current(): HintDef | null {
    return this.shown?.hint ?? null;
  }

  /** Player dismissed the visible hint. Returns its id (to persist), or null. */
  dismiss(): string | null {
    if (!this.shown) return null;
    const id = this.shown.hint.id;
    this.markDone(id);
    this.shown = null;
    return id;
  }

  /** Ids that became seen (dismissed, completed or replaced) since the last call. */
  drainSeen(): string[] {
    const out = this.seenLog;
    this.seenLog = [];
    return out;
  }

  private markDone(id: string): void {
    if (this.done.has(id)) return;
    this.done.add(id);
    this.seenLog.push(id);
  }

  isDone(id: string): boolean {
    return this.done.has(id);
  }

  get pending(): number {
    return this.queue.length;
  }
}
