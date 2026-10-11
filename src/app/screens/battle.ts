/**
 * Battle: mounts the BattleController (src/game/battle.ts) full-screen and wires its callbacks:
 * onEnd -> finishBattle -> Results; onQuitToTitle -> Title; onHintSeen -> meta.hintsSeen.
 */
import type { AppCtx, ScreenHandle } from '../types';
import type { BattleCallbacks, BattleControllerLike } from '../../game/types';
import type { BattleResult, BattleSetup } from '../../sim/types';
import type { PostBattle } from '../../run/types';
import { h } from '../dom';

export function mountBattle(app: AppCtx, setup: BattleSetup, quick: boolean): ScreenHandle {
  const el = h('div', { class: 'battle-root' });
  let controller: BattleControllerLike | null = null;
  let ended = false;
  /** Set once the battle reported its result; finishBattle then accounts for Last Stands itself. */
  let finished = false;
  let standsTimer = 0;

  // Boss battle: keep the run's count of spent Last Stands current, so quitting and continuing
  // charges them (the sim spends Resolve only inside the battle world).
  const recordStands = (): void => {
    const run = app.run;
    if (finished || quick || !setup.isBoss || !run || !run.battleInProgress || !controller) return;
    const used = controller.world.lastStandsUsed;
    if (used > (run.bossLastStandsUsed ?? 0)) app.guard('recordLastStands', () => app.api.recordLastStands(run, used));
  };

  const onEnd = (result: BattleResult): void => {
    if (ended) return;
    ended = true;
    finished = true;
    // Leave the controller's frame before tearing it down.
    window.setTimeout(() => {
      let post: PostBattle | null = null;
      if (!quick && app.run) post = app.guard('finishBattle', () => app.api.finishBattle(app.run!, app.meta, result)) ?? null;
      app.go({ screen: 'results', result, post, quick });
    }, 0);
  };

  const callbacks: BattleCallbacks = {
    onEnd,
    onQuitToTitle: () => {
      if (ended) return;
      ended = true;
      window.setTimeout(() => app.go({ screen: 'title' }), 0);
    },
    onHintSeen: (id: string) => {
      if (app.meta.hintsSeen.includes(id)) return;
      app.guard('markHintSeen', () => app.api.markHintSeen(app.meta, id));
    },
    onSettingsChange: (s) => {
      const settings = app.meta.settings;
      if (s.sfxVolume !== undefined) settings.sfxVolume = s.sfxVolume;
      if (s.muted !== undefined) settings.muted = s.muted;
      if (s.edgePan !== undefined) settings.edgePan = s.edgePan;
      app.persistMeta();
    },
  };

  const showError = (err: unknown): void => {
    console.error('[app] battle failed to start', err);
    el.replaceChildren(
      h(
        'div',
        { class: 'scr' },
        h(
          'div',
          { class: 'panel studs panel-pad err-panel col' },
          h('h2', { class: 'display h2' }, 'The Hearth would not kindle'),
          h('p', null, 'The battle could not be started.'),
          h('p', { class: 'small dim' }, err instanceof Error ? err.message : String(err)),
          h(
            'div',
            { class: 'row', style: 'justify-content:center' },
            h('button', { class: 'btn primary', onclick: () => (quick || !app.run ? app.go({ screen: 'title' }) : app.go({ screen: 'map' })) }, quick ? 'Return to Title' : 'Return to the Map'),
          ),
        ),
      ),
    );
    document.documentElement.classList.add('ui-scaled');
  };

  return {
    el,
    mounted: () => {
      try {
        controller = app.battleFactory(el, setup, callbacks, {
          debug: import.meta.env.DEV,
          hintsSeen: [...app.meta.hintsSeen],
          showHints: app.meta.settings.showHints,
          edgePan: app.meta.settings.edgePan,
          panSpeed: app.meta.settings.panSpeed,
          sfxVolume: app.meta.settings.sfxVolume,
          muted: app.meta.settings.muted,
        });
        controller.start();
        if (!quick && setup.isBoss) standsTimer = window.setInterval(recordStands, 500);
      } catch (err) {
        try {
          controller?.destroy();
        } catch {
          /* ignore */
        }
        controller = null;
        showError(err);
      }
    },
    destroy: () => {
      if (standsTimer) window.clearInterval(standsTimer);
      try {
        recordStands(); // a Last Stand in the last half second before quitting still counts
      } catch {
        /* the world may already be torn down */
      }
      try {
        controller?.destroy();
      } catch (err) {
        console.error('[app] battle destroy failed', err);
      }
      controller = null;
    },
  };
}
