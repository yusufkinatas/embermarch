/**
 * Hall of Banners: every meta unlock as a banner card (owned / affordable / locked), buy buttons,
 * Renown total, Houses and Thornbound tiers.
 */
import type { AppCtx, ScreenHandle } from '../types';
import type { MetaUnlockId } from '../../sim/types';
import { META_UNLOCKS, META_UNLOCK_ORDER, THORNBOUND } from '../../data/meta';
import { HOUSES } from '../../data/houses';
import { HOUSE_IDS } from '../../data/ids';
import { h, roman, setChildren } from '../dom';
import { glyph, type GlyphName } from '../ui/glyphs';
import { HOUSE_GLYPH } from './setup';

const UNLOCK_GLYPH: Record<MetaUnlockId, GlyphName> = {
  codex_1: 'scroll',
  codex_2: 'scroll',
  codex_3: 'scroll',
  house_tallow: 'wheat',
  outriding: 'horseshoe',
  lamplight: 'flame',
  hawk_eyes: 'sun',
  guild_ties: 'purse',
  house_grimbrand: 'hammer',
  seasoned_retinue: 'chevrons',
  opening_boon: 'star4',
  house_lowmere: 'tower',
  hearth_lore: 'hearth',
  fourth_banner: 'banner',
};

const UNLOCK_GROUP: Record<MetaUnlockId, string> = {
  codex_1: 'Codex',
  codex_2: 'Codex',
  codex_3: 'Codex',
  house_tallow: 'House',
  house_grimbrand: 'House',
  house_lowmere: 'House',
  outriding: 'Draft',
  lamplight: 'Draft',
  hawk_eyes: 'Warden',
  seasoned_retinue: 'Retinue',
  hearth_lore: 'Hearth',
  guild_ties: 'Road',
  opening_boon: 'Road',
  fourth_banner: 'Resolve',
};

export function mountHall(app: AppCtx, from: 'title' | 'summary'): ScreenHandle {
  const renownV = h('span', { class: 'num' });
  const grid = h('div', { class: 'hall-grid' });
  const side = h('aside', { class: 'hall-side' });

  const render = (): void => {
    const meta = app.meta;
    renownV.textContent = String(meta.renown);
    setChildren(grid);
    for (const id of META_UNLOCK_ORDER) {
      const def = META_UNLOCKS[id];
      const owned = meta.unlocks.includes(id);
      const check = owned ? { ok: false } : (app.guard('canBuyUnlock', () => app.api.canBuyUnlock(meta, id)) ?? { ok: false, reason: '' });
      const reqMissing = !!def.requires && !meta.unlocks.includes(def.requires);
      const state = owned ? 'owned' : check.ok ? 'affordable' : reqMissing ? 'sealed' : 'locked';
      const short = Math.max(0, def.cost - meta.renown);
      const buy = h(
        'button',
        { class: `btn sm ${check.ok ? 'primary' : 'ghost'}`, disabled: !check.ok },
        check.ok ? 'Raise' : `Need ${short} more`,
        h('span', { class: 'hb-cost' }, glyph('laurel'), String(def.cost)),
      );
      if (!check.ok && check.reason) app.tooltips.attach(buy, check.reason);
      buy.addEventListener('click', () => {
        app.click();
        const ok = app.guard('buyUnlock', () => app.api.buyUnlock(app.meta, id));
        if (ok) {
          app.sfx('rank_up');
          app.toast(`${def.name} is raised in the Hall.`, 'good');
          render();
          grid.querySelector(`[data-unlock="${id}"]`)?.classList.add('just-raised');
        } else {
          app.sfx('ui_error');
        }
      });
      const foot = owned
        ? h('span', { class: 'hb-state good' }, glyph('check'), 'Raised')
        : reqMissing
          ? h('span', { class: 'hb-state' }, glyph('lock'), `Requires ${META_UNLOCKS[def.requires!].name}`)
          : buy;
      const card = h(
        'div',
        { class: `hall-banner st-${state} ${def.requires ? 'chained' : ''}`, dataset: { unlock: id } },
        h('div', { class: 'hb-pennant' }, glyph(UNLOCK_GLYPH[id])),
        h('div', { class: 'hb-body' }, h('div', { class: 'hb-group' }, UNLOCK_GROUP[id]), h('div', { class: 'hb-name' }, def.name), h('div', { class: 'hb-desc' }, def.desc)),
        h('div', { class: 'hb-foot' }, foot),
      );
      grid.appendChild(card);
    }

    // side panel: Houses, Thornbound, record
    const houses = h('div', { class: 'side-list' });
    for (const hid of HOUSE_IDS) {
      const def = HOUSES[hid];
      const open = !def.unlock || meta.unlocks.includes(def.unlock);
      const row = h(
        'div',
        { class: `side-row ${open ? '' : 'locked'}`, style: `--house:${def.color}` },
        h('span', { class: 'side-pennant' }, glyph(HOUSE_GLYPH[hid])),
        h('div', { class: 'col', style: 'gap:0' }, h('span', { class: 'side-name' }, def.name), h('span', { class: 'tiny muted' }, `${def.abilityName} · ${def.tags.join(', ')}`)),
        h('span', { class: 'spacer' }),
        open ? glyph('check', 'side-ok') : glyph('lock', 'side-lock'),
      );
      app.tooltips.attach(row, () => [h('div', { class: 'tt-title' }, def.name), h('div', { class: 'tt-sub' }, def.motto), h('div', null, def.abilityDesc), h('div', { class: 'muted' }, def.passiveDesc)]);
      houses.appendChild(row);
    }
    const tiers = h('div', { class: 'side-list' });
    for (const row of THORNBOUND.slice(1)) {
      const open = row.tier <= meta.tierUnlocked;
      tiers.appendChild(
        h(
          'div',
          { class: `side-row ${open ? '' : 'locked'}` },
          h('span', { class: 'side-tier' }, roman(row.tier)),
          h('div', { class: 'col', style: 'gap:0' }, h('span', { class: 'side-name' }, row.name), h('span', { class: 'tiny muted' }, row.desc)),
          h('span', { class: 'spacer' }),
          open ? glyph('check', 'side-ok') : glyph('lock', 'side-lock'),
        ),
      );
    }
    const s = meta.stats;
    setChildren(
      side,
      h('section', { class: 'panel panel-pad' }, h('div', { class: 'panel-title' }, glyph('banner'), 'Houses'), houses),
      h(
        'section',
        { class: 'panel panel-pad' },
        h('div', { class: 'panel-title' }, glyph('tendril'), 'Thornbound'),
        h('div', { class: 'tiny muted', style: 'margin:-.2rem 0 .35rem' }, 'Win a march at a tier to unlock the next. Tiers stack; each adds +15% Renown.'),
        tiers,
      ),
      h(
        'section',
        { class: 'panel panel-pad' },
        h('div', { class: 'panel-title' }, glyph('scroll'), 'Record'),
        h(
          'div',
          { class: 'stat-grid two' },
          [
            ['Marches', s.runs],
            ['Victories', s.wins],
            ['Slain', s.kills],
            ['Deepest', s.bestDepth || '—'],
            ['Renown earned', s.totalRenown],
          ].map(([k, v]) => h('div', { class: 'stat' }, h('span', { class: 'k' }, String(k)), h('span', { class: 'v' }, String(v)))),
        ),
      ),
    );
  };
  render();

  const back = h(
    'button',
    {
      class: 'btn ghost sm',
      onclick: () => {
        app.click();
        app.go({ screen: 'title' });
      },
    },
    glyph('back'),
    'Title',
  );

  const el = h(
    'div',
    { class: 'scr hall-scr' },
    h(
      'div',
      { class: 'scr-topbar' },
      back,
      h(
        'div',
        { class: 'scr-title-row' },
        h('div', { class: 'eyebrow' }, from === 'summary' ? 'Spend the Renown of your march' : 'Meta progression'),
        h('h1', { class: 'display h1' }, 'Hall of Banners'),
      ),
      h('div', { class: 'topbar-right' }, h('div', { class: 'renown-total' }, glyph('laurel'), renownV, h('span', { class: 'label-caps' }, 'Renown'))),
    ),
    h('div', { class: 'hall-body' }, h('div', { class: 'hall-main scroll' }, grid), side),
  );
  return {
    el,
    onKey: (e) => {
      if (e.key === 'Escape') {
        back.click();
        return true;
      }
      return false;
    },
  };
}
