/**
 * Battle controller: owns the World, fixed-step loop, renderer, HUD, input, audio and the
 * window.__game debug API while a battle is mounted. OWNER: battle-shell.
 */
import type { BattleCallbacks, BattleControllerLike, BattleOptions } from './types';
import type { BattleSetup, World } from '../sim/types';

export class BattleController implements BattleControllerLike {
  readonly world!: World;
  readonly setup: BattleSetup;

  constructor(root: HTMLElement, setup: BattleSetup, callbacks: BattleCallbacks, opts?: BattleOptions) {
    this.setup = setup;
    throw new Error('not implemented');
  }

  start(): void {
    throw new Error('not implemented');
  }

  destroy(): void {
    throw new Error('not implemented');
  }
}
