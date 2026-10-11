/**
 * Run header bar: House, Crowns, Resolve pips, Boons tray, drafted units, Retinue and Sellswords,
 * plus Settings / Quit buttons. Call update() after anything that changes the run.
 */
import type { AppCtx } from '../types';
import type { RunState } from '../../run/types';
import { HOUSES } from '../../data/houses';
import { DRAFTS } from '../../data/drafts';
import { UNITS } from '../../data/units';
import { THORNBOUND } from '../../data/meta';
import { BOONS } from '../../data/boons';
import { h, setChildren, type Child } from '../dom';
import { glyph, TAG_GLYPH } from './glyphs';
import { portrait, rankName, unitName } from './portraits';
import { boonTooltip, draftTooltip, unitTooltip } from './cards';
import { ttRule, ttSub, ttTitle } from './tooltip';

export function crownsEl(n: number): HTMLElement {
  return h('span', { class: 'crowns num' }, glyph('crown'), h('span', { class: 'cv' }, String(n)));
}

export function resolvePips(resolve: number, max: number, lostFrom = -1): HTMLElement {
  const wrap = h('span', { class: 'pips', title: `Resolve ${resolve} / ${max}` });
  for (let i = 0; i < max; i++) {
    const lost = lostFrom >= 0 && i >= resolve && i < lostFrom;
    wrap.appendChild(glyph('flame', `pip ${i < resolve ? '' : 'empty'} ${lost ? 'lost' : ''}`.trim()));
  }
  return wrap;
}

export function retinuePop(run: RunState): number {
  return run.retinue.reduce((sum, u) => sum + (UNITS[u.type]?.pop ?? 1), 0);
}

export interface RunHeader {
  el: HTMLElement;
  update(): void;
}

export function runHeader(app: AppCtx, opts: { onQuit?: () => void } = {}): RunHeader {
  const el = h('header', { class: 'run-header' });

  const update = (): void => {
    app.tooltips.hide();
    const run = app.run;
    if (!run) {
      setChildren(el);
      return;
    }
    const house = HOUSES[run.house];
    const tierName = run.tier > 0 ? THORNBOUND[run.tier]?.name ?? `Thornbound ${run.tier}` : 'Unbound';

    const houseEl = h(
      'div',
      { class: 'rh-house', style: `--house:${house.color}` },
      h('span', { class: 'pennant' }, glyph('flame')),
      h('div', { class: 'col', style: 'gap:0' }, h('span', { class: 'hn' }, house.name), h('span', { class: 'hs' }, tierName)),
    );
    app.tooltips.attach(houseEl, () => [
      ttTitle(house.name),
      ttSub(house.motto),
      h('div', null, h('b', null, `${house.abilityName}: `), house.abilityDesc),
      h('div', { class: 'muted', style: 'margin-top:.25rem' }, house.passiveDesc),
    ]);

    const crowns = h('div', { class: 'rh-group' }, h('span', { class: 'label-caps' }, 'Crowns'), crownsEl(run.crowns));
    app.tooltips.attach(crowns, [ttTitle('Crowns'), h('div', null, 'Spent at the Peddler and on events. Earned by winning battles and plundering.')]);

    const resolve = h('div', { class: 'rh-group' }, h('span', { class: 'label-caps' }, 'Resolve'), resolvePips(run.resolve, run.maxResolve));
    app.tooltips.attach(resolve, [
      ttTitle(`Resolve ${run.resolve} / ${run.maxResolve}`),
      h('div', null, 'Losing a battle or Sounding the Retreat costs 1 Resolve. At 0 the march ends. In the final battle, Resolve buys a Last Stand.'),
    ]);

    const boons = h('div', { class: 'rh-tray' });
    if (run.boons.length === 0) boons.appendChild(h('span', { class: 'rh-empty' }, 'none yet'));
    const BOON_MAX = 7;
    for (const id of run.boons.slice(0, BOON_MAX)) {
      const def = BOONS[id];
      if (!def) continue;
      const pip = h('span', { class: `boon-pip rarity-${def.rarity}` }, glyph(TAG_GLYPH[def.tags[0] ?? 'Econ']));
      app.tooltips.attach(pip, () => boonTooltip(id));
      boons.appendChild(pip);
    }
    if (run.boons.length > BOON_MAX) {
      const more = h('span', { class: 'chip' }, `+${run.boons.length - BOON_MAX}`);
      app.tooltips.attach(more, () => run.boons.slice(BOON_MAX).map((id) => h('div', null, BOONS[id]?.name ?? id)));
      boons.appendChild(more);
    }
    const boonGroup = h('div', { class: 'rh-group' }, h('span', { class: 'label-caps' }, `Boons · ${run.boons.length}`), boons);

    const drafts = h('div', { class: 'rh-tray' });
    if (run.drafts.length === 0) drafts.appendChild(h('span', { class: 'rh-empty' }, 'none yet'));
    for (const id of run.drafts) {
      const d = DRAFTS[id];
      if (!d) continue;
      const lead = d.units[0];
      const p = portrait(lead, { size: 'sm' });
      app.tooltips.attach(p, () => [draftTooltip(id), ttRule(), unitTooltip(lead)]);
      drafts.appendChild(p);
    }
    const draftGroup = h('div', { class: 'rh-group' }, h('span', { class: 'label-caps' }, 'Drafts'), drafts);

    const ret = h('div', { class: 'rh-tray' });
    const all = [...run.retinue.map((u) => ({ u, sell: false })), ...run.sellswords.map((u) => ({ u, sell: true }))];
    if (all.length === 0) ret.appendChild(h('span', { class: 'rh-empty' }, 'none'));
    const shown = all.slice(0, 5);
    for (const { u, sell } of shown) {
      const p = portrait(u.type, { size: 'sm', rank: u.rank });
      if (sell) p.classList.add('sellsword');
      ret.appendChild(p);
    }
    if (all.length > shown.length) ret.appendChild(h('span', { class: 'chip' }, `+${all.length - shown.length}`));
    const retGroup = h('div', { class: 'rh-group' }, h('span', { class: 'label-caps' }, `Retinue · ${retinuePop(run)} pop`), ret);
    app.tooltips.attach(retGroup, () => retinueTooltip(run));

    const settingsBtn = h('button', { class: 'btn ghost icon-only', 'aria-label': 'Settings', onclick: () => app.openSettings() }, glyph('gear'));
    app.tooltips.attach(settingsBtn, 'Settings');
    const quitBtn = h(
      'button',
      {
        class: 'btn ghost icon-only',
        'aria-label': 'Quit to Title',
        onclick: () => {
          app.click();
          if (opts.onQuit) opts.onQuit();
          else app.go({ screen: 'title' });
        },
      },
      glyph('door'),
    );
    app.tooltips.attach(quitBtn, 'Quit to Title (the march is saved)');

    setChildren(
      el,
      houseEl,
      h('span', { class: 'rh-sep' }),
      crowns,
      h('span', { class: 'rh-sep' }),
      resolve,
      h('span', { class: 'rh-sep' }),
      boonGroup,
      h('span', { class: 'rh-sep' }),
      draftGroup,
      h('span', { class: 'rh-sep' }),
      retGroup,
      h('span', { class: 'spacer' }),
      h('div', { class: 'rh-actions' }, settingsBtn, quitBtn),
    );
  };
  update();
  return { el, update };
}

function retinueTooltip(run: RunState): Child {
  const rows: Child[] = [ttTitle('Retinue'), ttSub(`${retinuePop(run)} pop carried`)];
  if (run.retinue.length === 0) rows.push(h('div', { class: 'muted' }, 'No veterans march with you yet. Survivors of a victory or a Retreat may join.'));
  for (const u of run.retinue) rows.push(h('div', null, `${unitName(u.type)} · ${rankName(u.rank)} · ${u.kills} kills`));
  if (run.sellswords.length) {
    rows.push(ttRule(), ttSub('Sellswords (next battle)'));
    for (const u of run.sellswords) rows.push(h('div', null, `${unitName(u.type)} · ${rankName(u.rank)}`));
  }
  return rows;
}
