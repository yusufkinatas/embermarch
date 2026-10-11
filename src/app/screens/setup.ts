/**
 * Run Setup: House cards (locked Houses show their unlock), Thornbound tier selector, optional seed,
 * Begin -> newRun (the Opening Boon pick, if unlocked, is shown by advance()).
 */
import type { AppCtx, ScreenHandle } from '../types';
import type { HouseId } from '../../sim/types';
import { HOUSES } from '../../data/houses';
import { META_UNLOCKS, THORNBOUND } from '../../data/meta';
import { HOUSE_IDS } from '../../data/ids';
import { RENOWN } from '../../data/balance';
import { h, roman, setChildren } from '../dom';
import { divider, glyph, type GlyphName } from '../ui/glyphs';
import { tagChip } from '../ui/cards';

export const HOUSE_GLYPH: Record<HouseId, GlyphName> = {
  ardent: 'flame',
  tallow: 'wheat',
  grimbrand: 'hammer',
  lowmere: 'tower',
};

export function mountSetup(app: AppCtx): ScreenHandle {
  const available = new Set<HouseId>(app.guard('availableHouses', () => app.api.availableHouses(app.meta)) ?? ['ardent']);
  let house: HouseId = available.has('ardent') ? 'ardent' : ([...available][0] ?? 'ardent');
  const maxTier = Math.max(0, Math.min(THORNBOUND.length - 1, app.meta.tierUnlocked));
  let tier = 0;

  const cards = new Map<HouseId, HTMLElement>();
  const houseRow = h('div', { class: 'house-row' });
  for (const id of HOUSE_IDS) {
    const def = HOUSES[id];
    const locked = !available.has(id);
    const unlock = def.unlock ? META_UNLOCKS[def.unlock] : null;
    const card = h(
      'div',
      {
        class: `house-card ${locked ? 'locked' : 'clickable'}`,
        style: `--house:${def.color}`,
        role: 'button',
        tabindex: locked ? '-1' : '0',
        'aria-disabled': locked ? 'true' : 'false',
      },
      h('div', { class: 'hc-banner' }, h('span', { class: 'hc-emblem' }, glyph(HOUSE_GLYPH[id]))),
      h('div', { class: 'hc-name' }, def.name),
      h('div', { class: 'hc-motto' }, `“${def.motto}”`),
      divider('narrow'),
      // A sealed House shows how to unlock it in place of its ability and passives.
      ...(locked
        ? [
            h(
              'div',
              { class: 'hc-lock' },
              glyph('lock'),
              h('div', null, 'Sealed'),
              h('div', { class: 'tiny' }, unlock ? `Raise “${unlock.name}” in the Hall of Banners · ${unlock.cost} Renown` : 'Locked'),
              unlock && app.meta.renown >= unlock.cost ? h('div', { class: 'tiny good' }, 'You hold enough Renown to raise it now.') : null,
            ),
          ]
        : [
            h(
              'div',
              { class: 'hc-section' },
              h('div', { class: 'label-caps' }, h('span', { class: 'kbd' }, 'Q'), ' Warden ability'),
              h('div', { class: 'hc-ability' }, def.abilityName, h('span', { class: 'hc-cd' }, `${def.abilityCooldown} s`)),
              h('div', { class: 'hc-desc' }, def.abilityDesc),
            ),
            h('div', { class: 'hc-section' }, h('div', { class: 'label-caps' }, 'Passives'), h('div', { class: 'hc-desc' }, def.passiveDesc)),
          ]),
      h('div', { class: 'hc-tags' }, def.tags.map((t) => tagChip(t))),
    );
    if (!locked) {
      const pick = (): void => {
        if (house === id) return;
        app.click();
        house = id;
        paintHouses();
      };
      card.addEventListener('click', pick);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });
    }
    cards.set(id, card);
    houseRow.appendChild(card);
  }
  const paintHouses = (): void => {
    for (const [id, card] of cards) card.classList.toggle('selected', id === house);
  };
  paintHouses();

  // Thornbound tier selector
  const tierSeg = h('div', { class: 'seg' });
  const tierDesc = h('div', { class: 'tier-desc' });
  const paintTier = (): void => {
    setChildren(tierSeg);
    for (const row of THORNBOUND) {
      const locked = row.tier > maxTier;
      const b = h(
        'button',
        {
          class: row.tier === tier ? 'on' : '',
          disabled: locked,
          onclick: () => {
            tier = row.tier;
            app.click();
            paintTier();
          },
        },
        locked ? glyph('lock') : null,
        row.tier === 0 ? 'Unbound' : roman(row.tier),
      );
      if (locked) app.tooltips.attach(b, `Win a march at Thornbound ${roman(row.tier - 1) || 'Unbound'} to unlock.`);
      tierSeg.appendChild(b);
    }
    const lines = THORNBOUND.filter((r) => r.tier > 0 && r.tier <= tier).map((r) => h('li', null, h('b', null, `${roman(r.tier)}. `), r.desc));
    setChildren(
      tierDesc,
      tier === 0 ? h('div', { class: 'muted' }, THORNBOUND[0].desc) : h('ul', { class: 'tier-list' }, lines),
      tier > 0 ? h('div', { class: 'good small' }, `Renown +${Math.round(RENOWN.tierPct * 100 * tier)}%`) : null,
    );
  };
  paintTier();

  // Seed
  const seedInput = h('input', { class: 'input seed-input', type: 'text', inputmode: 'numeric', placeholder: 'Random', maxlength: '10', 'aria-label': 'Seed' });
  if (app.urlSeed !== null) seedInput.value = String(app.urlSeed);
  seedInput.addEventListener('input', () => {
    seedInput.value = seedInput.value.replace(/[^0-9]/g, '');
  });
  const diceBtn = h(
    'button',
    {
      class: 'btn ghost icon-only',
      'aria-label': 'Random seed',
      onclick: () => {
        app.click();
        seedInput.value = String(Math.floor(Math.random() * 1e9));
      },
    },
    glyph('dice'),
  );
  app.tooltips.attach(diceBtn, 'Roll a seed');

  const hasOpening = app.meta.unlocks.includes('opening_boon');
  const begin = h(
    'button',
    {
      class: 'btn primary lg',
      onclick: () => {
        app.click();
        const raw = seedInput.value.trim();
        const seed = raw === '' ? undefined : Number(raw) >>> 0;
        app.startRun({ house, tier, seed });
      },
    },
    glyph('flame'),
    'Begin the March',
  );

  const el = h(
    'div',
    { class: 'scr setup-scr' },
    h(
      'div',
      { class: 'scr-topbar' },
      h(
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
      ),
      h('div', { class: 'scr-title-row' }, h('div', { class: 'eyebrow' }, 'A new march'), h('h1', { class: 'display h1' }, 'Muster the Hearthband')),
      h('div', { class: 'topbar-right' }, h('span', { class: 'chip' }, glyph('laurel'), `${app.meta.renown} Renown`)),
    ),
    h(
      'div',
      { class: 'scr-body setup-body' },
      h('div', { class: 'section-label' }, 'Choose your House'),
      houseRow,
      h(
        'div',
        { class: 'setup-bottom' },
        h(
          'div',
          { class: 'panel panel-pad setup-tier' },
          h('div', { class: 'panel-title' }, glyph('tendril'), 'Thornbound'),
          tierSeg,
          tierDesc,
        ),
        h(
          'div',
          { class: 'panel panel-pad setup-seed' },
          h('div', { class: 'panel-title' }, glyph('dice'), 'Seed'),
          h('div', { class: 'row' }, seedInput, diceBtn),
          h('div', { class: 'tiny muted' }, 'Leave empty for a fresh road. The same seed draws the same map.'),
        ),
        h(
          'div',
          { class: 'setup-begin' },
          hasOpening ? h('div', { class: 'small accent center' }, glyph('sun', 'inline-glyph'), ' Opening Boon: choose 1 of 3 Commons before you set out.') : null,
          begin,
        ),
      ),
    ),
  );

  return {
    el,
    onKey: (e) => {
      if (e.key === 'Escape') {
        app.click();
        app.go({ screen: 'title' });
        return true;
      }
      return false;
    },
  };
}
