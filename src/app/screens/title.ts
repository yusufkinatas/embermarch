/**
 * Title: animated ember/briar backdrop, Continue (with run info), New Run, Hall of Banners,
 * How to Play, Settings.
 */
import type { AppCtx, ScreenHandle } from '../types';
import { HOUSES } from '../../data/houses';
import { THORNBOUND } from '../../data/meta';
import { h, roman } from '../dom';
import { divider, glyph, type GlyphName } from '../ui/glyphs';
import { EmberField } from '../ui/embers';
import { resolvePips } from '../ui/header';
import { settleFinishedRun } from '../logic/flow';

function menuButton(label: string, icon: GlyphName, onclick: () => void, opts: { primary?: boolean; sub?: HTMLElement | null; badge?: string } = {}): HTMLButtonElement {
  return h(
    'button',
    { class: `title-btn ${opts.primary ? 'primary' : ''}`.trim(), onclick },
    h('span', { class: 'tb-icon' }, glyph(icon)),
    h('span', { class: 'tb-text' }, h('span', { class: 'tb-label' }, label), opts.sub ?? null),
    opts.badge ? h('span', { class: 'tb-badge' }, opts.badge) : null,
  );
}

export function mountTitle(app: AppCtx): ScreenHandle {
  const canvas = h('canvas', { class: 'title-canvas' });
  const field = new EmberField(canvas, { mode: 'title', scenery: true });
  const run = app.run;

  const onContinue = async (): Promise<void> => {
    app.click();
    const r = app.run;
    if (!r) return;
    const msg = app.guard('resolveInterruptedBattle', () => app.api.resolveInterruptedBattle(r, app.meta));
    if (msg) await app.alert('The battle was broken off', msg);
    app.resume();
  };

  const onNew = async (): Promise<void> => {
    app.click();
    const r = app.run;
    if (r && r.over) {
      // The march ended but its March End never showed (closed on Results, reload, crash):
      // bank it now, or newRun would overwrite the save and its Renown would be lost.
      const summary = app.guard('endRun', () => settleFinishedRun(app.api, r, app.meta));
      app.run = null;
      if (summary) app.toast(`Your last march is counted. +${summary.renownTotal} Renown.`, 'good');
    } else if (r) {
      const ok = await app.confirm({
        title: 'Abandon the march?',
        text: `Your march with ${HOUSES[r.house].name} ends here. Renown for the road already walked is still earned.`,
        ok: 'Abandon march',
        danger: true,
      });
      if (!ok) return;
      const summary = app.guard('endRun', () => app.api.endRun(r, app.meta));
      app.run = null;
      if (summary) app.toast(`The march ends. +${summary.renownTotal} Renown.`, 'info');
    }
    app.go({ screen: 'setup' });
  };

  const items: HTMLElement[] = [];
  if (run) {
    const node = run.currentNode ? run.map.nodes[run.currentNode] : null;
    const where = node ? `Column ${roman(node.col)} of ${roman(run.map.columns.length)}` : "At the road's start";
    const sub = h(
      'span',
      { class: 'tb-sub' },
      h('span', null, HOUSES[run.house].name),
      run.tier > 0 ? h('span', null, THORNBOUND[run.tier]?.name ?? '') : null,
      h('span', null, where),
      resolvePips(run.resolve, run.maxResolve),
      h('span', { class: 'crowns num' }, glyph('crown'), String(run.crowns)),
    );
    items.push(menuButton(run.over ? 'See the March End' : 'Continue the March', 'flame', () => void onContinue(), { primary: true, sub }));
  }
  items.push(menuButton('New Run', 'banner', () => void onNew(), { primary: !run }));
  items.push(
    menuButton(
      'Hall of Banners',
      'laurel',
      () => {
        app.click();
        app.go({ screen: 'hall', from: 'title' });
      },
      { badge: `${app.meta.renown} Renown` },
    ),
  );
  items.push(
    menuButton('How to Play', 'scroll', () => {
      app.click();
      app.go({ screen: 'howto' });
    }),
  );
  items.push(menuButton('Settings', 'gear', () => app.openSettings()));

  const stats = app.meta.stats;
  const el = h(
    'div',
    { class: 'scr title-scr' },
    canvas,
    h(
      'div',
      { class: 'title-wrap' },
      h('div', { class: 'eyebrow title-eyebrow' }, 'The Last Flame of Hallowmere'),
      h('h1', { class: 'title-logo' }, h('span', { class: 'tl-main' }, 'Embermarch'), h('span', { class: 'tl-glow', 'aria-hidden': 'true' }, 'Embermarch')),
      divider('wide'),
      h('div', { class: 'title-tagline' }, 'Carry the flame east. Break the Thornwake. Burn the Briar Throne.'),
      h('nav', { class: 'title-menu' }, items),
    ),
    h(
      'footer',
      { class: 'title-footer' },
      h(
        'span',
        null,
        `Marches ${stats.runs} · Victories ${stats.wins} · Deepest column ${stats.bestDepth ? roman(stats.bestDepth) : '—'} · Renown earned ${stats.totalRenown}`,
      ),
      h('span', { class: 'dim' }, 'v0.1 · a heraldic RTS roguelike'),
    ),
  );

  return {
    el,
    mounted: () => {
      field.start();
    },
    destroy: () => field.destroy(),
  };
}
