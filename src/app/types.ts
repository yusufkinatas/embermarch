/**
 * App-internal types: routes, screen handles and the context every screen receives.
 * OWNER: screens. Not a cross-module contract.
 */
import type { BattleCallbacks, BattleControllerLike, BattleOptions, SfxName } from '../game/types';
import type { BattleResult, BattleSetup } from '../sim/types';
import type { Briefing, EventView, MetaSave, PostBattle, RunState, RunSummary } from '../run/types';
import type { RunApi } from './api';
import type { Tooltips } from './ui/tooltip';

export type ScreenId =
  | 'title'
  | 'setup'
  | 'map'
  | 'briefing'
  | 'battle'
  | 'results'
  | 'reward'
  | 'retinue'
  | 'event'
  | 'camp'
  | 'peddler'
  | 'summary'
  | 'hall'
  | 'howto';

export type Route =
  | { screen: 'title' }
  | { screen: 'setup' }
  | { screen: 'map' }
  | { screen: 'briefing'; briefing: Briefing }
  /** quick = standalone battle (URL param / debug API), no run attached. */
  | { screen: 'battle'; setup: BattleSetup; quick: boolean }
  | { screen: 'results'; result: BattleResult; post: PostBattle | null; quick: boolean }
  | { screen: 'reward' }
  | { screen: 'retinue' }
  | { screen: 'event'; event: EventView }
  | { screen: 'camp' }
  | { screen: 'peddler' }
  | { screen: 'summary'; summary: RunSummary }
  | { screen: 'hall'; from?: 'title' | 'summary' }
  | { screen: 'howto' };

export interface ScreenHandle {
  el: HTMLElement;
  /** Called once the element is attached to the document (measure / start animations). */
  mounted?(): void;
  /** Called when the screen is unmounted (stop animations, remove listeners). */
  destroy?(): void;
  /** Keyboard handler while this screen is active (after modals). Return true if handled. */
  onKey?(e: KeyboardEvent): boolean;
}

export interface ConfirmOptions {
  title: string;
  text: string;
  ok?: string;
  cancel?: string;
  danger?: boolean;
}

export type BattleFactory = (
  root: HTMLElement,
  setup: BattleSetup,
  callbacks: BattleCallbacks,
  opts: BattleOptions,
) => BattleControllerLike;

/** Everything a screen may use. Screens never touch window.__game or the router internals. */
export interface AppCtx {
  readonly api: RunApi;
  readonly battleFactory: BattleFactory;
  meta: MetaSave;
  run: RunState | null;
  readonly tooltips: Tooltips;
  /** Seed from ?seed=N (prefills Run Setup). */
  readonly urlSeed: number | null;
  readonly screen: ScreenId;
  go(route: Route): void;
  /** Route to the right place after a run step: summary if over, pending reward, else the map. */
  advance(): void;
  /** Resume a loaded run (Continue): in-progress node screen, pending reward, or the map. */
  resume(): void;
  /** Play ui_click. */
  click(): void;
  sfx(name: SfxName, volume?: number): void;
  persistMeta(): void;
  /** Apply meta.settings to the audio system. */
  applySettings(): void;
  toast(text: string, kind?: 'info' | 'good' | 'bad'): void;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  alert(title: string, text: string): Promise<void>;
  openSettings(): void;
  /** Open a modal dialog with arbitrary content. */
  modal(content: import('./dom').Child, opts?: { cls?: string; onEscape?: () => void }): { el: HTMLElement; close(): void };
  /** Start a new run and route into it. */
  startRun(opts: { house: import('../sim/types').HouseId; tier: number; seed?: number }): void;
  /** Run fn; on exception show a toast and log. Returns undefined on failure. */
  guard<T>(label: string, fn: () => T): T | undefined;
}
