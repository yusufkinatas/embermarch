/**
 * Results: Victory / Defeat / Retreat banner sweep with rising embers, battle time, Crown lines,
 * stats and the Resolve change. Continue -> reward queue / map / run summary (via advance()).
 */
import type { AppCtx, ScreenHandle } from '../types';
import type { BattleResult } from '../../sim/types';
import type { PostBattle } from '../../run/types';
import { countUp, fmtTime, h, plural } from '../dom';
import { divider, glyph, RESOURCE_GLYPH } from '../ui/glyphs';
import { EmberField } from '../ui/embers';
import { resolvePips } from '../ui/header';

const VICTORY_LINE: Record<BattleResult['objective'], string> = {
  raze: 'The Thorn Nests burn.',
  holdfast: 'The Hearth held against the tide.',
  beacons: 'The Beacons blaze across the hills.',
  elite: 'The Antlered Lord lies still.',
  boss: 'The Briar Regent falls. The Throne burns.',
};

export function mountResults(app: AppCtx, result: BattleResult, post: PostBattle | null, quick: boolean): ScreenHandle {
  const outcome = result.outcome;
  const canvas = h('canvas', { class: 'results-canvas' });
  const field = new EmberField(canvas, { mode: outcome === 'victory' ? 'victory' : outcome === 'defeat' ? 'defeat' : 'retreat', count: outcome === 'victory' ? 150 : 90 });
  const cancels: (() => void)[] = [];
  const timersBanner: number[] = [];

  const title = outcome === 'victory' ? 'Victory' : outcome === 'defeat' ? 'Defeat' : 'Retreat';
  const line =
    outcome === 'victory'
      ? VICTORY_LINE[result.objective]
      : outcome === 'defeat'
        ? 'The Hearth is lost. The Hearthband scatters.'
        : 'The horn sounds the retreat. The Hearthband falls back.';

  const banner = h(
    'div',
    { class: `res-banner out-${outcome}` },
    h('div', { class: 'rb-ribbon' }, h('span', { class: 'rb-tail l' }), h('span', { class: 'rb-text' }, title), h('span', { class: 'rb-tail r' })),
    h('div', { class: 'rb-line' }, line),
    h('div', { class: 'rb-time' }, glyph('hourglass'), `Battle time ${fmtTime(result.time)}`, result.underPar && outcome === 'victory' ? h('span', { class: 'good' }, ' · under par') : null),
  );

  // --- Crowns
  const crownsPanel = h('section', { class: 'panel studs res-panel res-crowns' }, h('div', { class: 'panel-title' }, glyph('crown'), 'Spoils'));
  const lines = post?.crownLines ?? (result.plunderCrowns ? [{ label: 'Plunder', amount: result.plunderCrowns }] : []);
  const total = post?.crownsTotal ?? result.plunderCrowns;
  const table = h('div', { class: 'crown-lines' });
  if (lines.length === 0) table.appendChild(h('div', { class: 'muted small' }, outcome === 'defeat' ? 'No Crowns are won in defeat.' : 'No Crowns this time.'));
  lines.forEach((l, i) => {
    table.appendChild(h('div', { class: 'cl-row', style: `animation-delay:${0.9 + i * 0.12}s` }, h('span', { class: 'cl-label' }, l.label), h('span', { class: 'cl-amt num' }, `+${l.amount}`)));
  });
  const totalV = h('span', { class: 'num' }, '0');
  crownsPanel.append(table, h('div', { class: 'cl-total' }, h('span', null, 'Total'), h('span', { class: 'crowns' }, glyph('crown'), totalV)));

  if (!quick && post && app.run) {
    const run = app.run;
    const lost = post.resolveLost;
    crownsPanel.append(
      h(
        'div',
        { class: 'res-resolve' },
        h('span', { class: 'label-caps' }, 'Resolve'),
        resolvePips(run.resolve, run.maxResolve, lost > 0 ? run.resolve + lost : -1),
        lost > 0 ? h('span', { class: 'bad small' }, `−${lost}`) : h('span', { class: 'muted small' }, 'unshaken'),
      ),
    );
    if (post.runOver)
      crownsPanel.append(h('div', { class: `callout ${post.runWon ? '' : 'bad-callout'}` }, post.runWon ? 'The march is won.' : 'Resolve is spent. The march ends here.'));
  } else if (quick) {
    crownsPanel.append(h('div', { class: 'tiny dim' }, 'Quick battle: no march is attached.'));
  }

  // --- Stats
  const st = result.stats;
  const statRows: [string, string | number][] = [
    ['Thornwake slain', st.kills],
    ['Units trained', st.unitsTrained],
    ['Units lost', st.unitsLost],
    ['Buildings raised', st.buildingsBuilt],
    ['Buildings lost', st.buildingsLost],
    ['Nests destroyed', result.nestsDestroyed],
  ];
  if (result.picketsDestroyed) statRows.push(['Pickets cleared', result.picketsDestroyed]);
  if (result.cachesLooted) statRows.push(['Caches looted', result.cachesLooted + (result.ancientCacheLooted ? ' (Ancient)' : '')]);
  if (result.lastStandsUsed) statRows.push(['Last Stands', result.lastStandsUsed]);
  if (result.objective === 'holdfast' && outcome === 'victory') {
    statRows.push(['Unbroken', result.unbroken ? 'Yes' : 'No']);
    statRows.push(['Uprooted', result.uprooted ? 'Yes' : 'No']);
  }
  const statsPanel = h(
    'section',
    { class: 'panel studs res-panel res-stats' },
    h('div', { class: 'panel-title' }, glyph('scroll'), 'Chronicle'),
    h(
      'div',
      { class: 'stat-grid' },
      statRows.map(([k, v]) => h('div', { class: 'stat' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, String(v)))),
    ),
    h(
      'div',
      { class: 'res-gathered' },
      h('span', { class: 'label-caps' }, 'Gathered'),
      (['grain', 'timber', 'ember'] as const).map((r) => h('span', { class: `cost cost-${r}` }, glyph(RESOURCE_GLYPH[r]), String(Math.round(st.gathered[r])))),
    ),
    result.survivors.length && outcome !== 'defeat'
      ? h('div', { class: 'small muted', style: 'margin-top:.4rem' }, `${plural(result.survivors.length, 'veteran')} survived the field.`)
      : null,
  );

  const runOver = !!post?.runOver;
  const cont = h(
    'button',
    {
      class: 'btn primary lg',
      onclick: () => {
        app.click();
        if (quick || !app.run) app.go({ screen: 'title' });
        else app.advance();
      },
    },
    runOver ? 'See the March End' : quick ? 'Return to Title' : 'Continue',
    glyph('next'),
  );

  const el = h(
    'div',
    { class: `scr results-scr out-${outcome}` },
    canvas,
    banner,
    h('div', { class: 'res-body' }, crownsPanel, statsPanel),
    h('div', { class: 'res-footer' }, divider('narrow'), cont),
  );

  return {
    el,
    mounted: () => {
      field.start();
      // The battle shell already sounded the fanfare; the banner unfurls with a paper flick.
      timersBanner.push(window.setTimeout(() => app.sfx('card_flip'), 150));
      const t = window.setTimeout(() => cancels.push(countUp(totalV, total, 900)), 900 + lines.length * 120);
      cancels.push(() => window.clearTimeout(t));
    },
    destroy: () => {
      field.destroy();
      cancels.forEach((c) => c());
      timersBanner.forEach((t) => window.clearTimeout(t));
    },
    onKey: (e) => {
      if (e.key === 'Enter') {
        cont.click();
        return true;
      }
      return false;
    },
  };
}
