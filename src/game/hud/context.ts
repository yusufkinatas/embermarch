/** Shared read context for HUD widgets. */
import type { Camera } from '../../render/camera';
import type { EncounterView } from '../../sim/encounter/types';
import type { BattleSetup, World } from '../../sim/types';
import type { BattleActions } from '../actions';
import type { BattleUIState, Renderer } from '../types';
import type { Tooltip } from './tooltip';

export interface HudContext {
  readonly world: World;
  readonly ui: BattleUIState;
  readonly camera: Camera;
  readonly setup: BattleSetup;
  readonly actions: BattleActions;
  readonly tooltip: Tooltip;
  readonly renderer: Renderer;
  /** Latest encounter view (refreshed ~10 Hz); null when unavailable. */
  view: EncounterView | null;
  /** Real (wall-clock) time in seconds. */
  now: number;
  /** HUD scale factor (1 at 1280×720). */
  scale: number;
}
