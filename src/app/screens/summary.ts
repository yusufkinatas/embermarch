/**
 * Run Summary: won/lost, animated Renown tally, stats, next-unlock progress bar, tier unlocked.
 * Continue -> Hall of Banners -> Title.
 */
import type { AppCtx, ScreenHandle } from '../types';
import type { RunSummary } from '../../run/types';
import { THORNBOUND } from '../../data/meta';
import { countUp, h, roman } from '../dom';
import { divider, glyph } from '../ui/glyphs';
import { EmberField } from '../ui/embers';

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const hrs = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hrs > 0 ? `${hrs}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}

export function mountSummary(app: AppCtx, sum: RunSummary): ScreenHandle {
  const canvas = h('canvas', { class: 'results-canvas' });
  const field = new EmberField(canvas, { mode: sum.won ? 'victory' : 'retreat', count: sum.won ? 150 : 70 });
  const timers: number[] = [];
  const cancels: (() => void)[] = [];

  const lines = h('div', { class: 'renown-lines' });
  sum.renownLines.forEach((l, i) => {
    lines.appendChild(
      h('div', { class: 'cl-row', style: `animation-delay:${0.5 + i * 0.28}s` }, h('span', { class: 'cl-label' }, l.label), h('span', { class: 'cl-amt num' }, `+${l.amount}`)),
    );
  });
  const totalV = h('span', { class: 'num' }, '0');
  const holdV = h('span', { class: 'num' }, String(app.meta.renown));

  const st = sum.stats;
  const stats: [string, string | number][] = [
    ['Battles won', st.battlesWon],
    ['Elites won', st.elitesWon],
    ['Nests burned', st.nestsDestroyed],
    ['Stops on the road', st.nodesVisited],
    ['Thornwake slain', st.kills],
    ['Crowns earned', st.crownsEarned],
    ['Deepest column', sum.depthReached ? roman(sum.depthReached) : '—'],
    ['Time on the road', fmtDuration(st.timePlayed)],
  ];

  const next = sum.nextUnlock;
  const fill = h('i');
  const nextEl = next
    ? h(
        'div',
        { class: 'next-unlock' },
        h('div', { class: 'row' }, h('span', { class: 'label-caps' }, 'Next banner'), h('span', { class: 'spacer' }), h('span', { class: 'small' }, next.remaining === 0 ? h('span', { class: 'good' }, 'Ready to raise!') : `${next.remaining} Renown to go`)),
        h('div', { class: 'nu-name' }, glyph('banner'), next.name, h('span', { class: 'muted small' }, ` · ${next.cost} Renown`)),
        h('div', { class: 'bar lg' }, fill),
      )
    : h('div', { class: 'next-unlock muted small' }, 'Every banner in the Hall is raised.');

  const tierEl =
    sum.tierUnlocked !== null && sum.tierUnlocked > 0
      ? h(
          'div',
          { class: 'tier-unlocked' },
          glyph('tendril'),
          h('div', null, h('div', { class: 'eyebrow' }, 'New challenge'), h('div', { class: 'tu-name' }, `${THORNBOUND[sum.tierUnlocked]?.name ?? `Thornbound ${roman(sum.tierUnlocked)}`} unlocked`)),
        )
      : null;

  const cont = h(
    'button',
    {
      class: 'btn primary lg',
      onclick: () => {
        app.click();
        app.go({ screen: 'hall', from: 'summary' });
      },
    },
    glyph('laurel'),
    'To the Hall of Banners',
  );

  const el = h(
    'div',
    { class: `scr summary-scr ${sum.won ? 'won' : 'lost'}` },
    canvas,
    h(
      'div',
      { class: 'scr-body summary-body' },
      h(
        'div',
        { class: 'scr-title-row' },
        h('span', { class: `crest crest-xl ${sum.won ? '' : 'crest-muted'}` }, glyph(sum.won ? 'throne' : 'banner')),
        h('div', { class: 'eyebrow' }, sum.won ? 'The march is won' : 'The march ends'),
        h('h1', { class: 'display h1 summary-title' }, sum.won ? 'The Briar Throne Burns' : 'The Flame Gutters'),
        divider('wide'),
        h('div', { class: 'small muted italic center' }, sum.won ? 'Hallowmere will remember the Hearthband.' : 'Others will carry the Last Flame. Your deeds are counted in Renown.'),
      ),
      h(
        'div',
        { class: 'summary-grid' },
        h(
          'section',
          { class: 'panel studs res-panel' },
          h('div', { class: 'panel-title' }, glyph('laurel'), 'Renown'),
          lines,
          h('div', { class: 'cl-total' }, h('span', null, 'Earned'), h('span', { class: 'renown-v' }, glyph('laurel'), totalV)),
          h('div', { class: 'row small muted', style: 'margin-top:.3rem' }, 'You now hold', h('b', { class: 'accent' }, holdV), 'Renown.'),
          nextEl,
        ),
        h(
          'section',
          { class: 'panel studs res-panel' },
          h('div', { class: 'panel-title' }, glyph('scroll'), 'Chronicle of the March'),
          h('div', { class: 'stat-grid two' }, stats.map(([k, v]) => h('div', { class: 'stat' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, String(v))))),
          // The tier unlock sits with the Chronicle so the Renown column stops growing.
          tierEl,
        ),
      ),
      h('div', { class: 'res-footer summary-actions' }, cont),
    ),
  );

  return {
    el,
    mounted: () => {
      field.start();
      app.sfx(sum.won ? 'victory' : 'defeat');
      const after = 500 + sum.renownLines.length * 280;
      timers.push(
        window.setTimeout(() => {
          cancels.push(countUp(totalV, sum.renownTotal, 1100));
          if (next) {
            const pct = next.cost > 0 ? Math.max(0, Math.min(1, (next.cost - next.remaining) / next.cost)) : 1;
            fill.style.width = `${(pct * 100).toFixed(1)}%`;
          }
        }, after),
      );
    },
    destroy: () => {
      field.destroy();
      timers.forEach((t) => window.clearTimeout(t));
      cancels.forEach((c) => c());
    },
  };
}
