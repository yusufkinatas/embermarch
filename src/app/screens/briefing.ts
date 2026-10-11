/**
 * Briefing: objective, biome + twist, modifiers with payoffs, doctrine hint (+ explicit answer),
 * threat, par, reward, Retinue + Sellswords, Vanguard pick, Begin Battle / Back.
 */
import type { AppCtx, ScreenHandle } from '../types';
import type { Briefing } from '../../run/types';
import type { VanguardId } from '../../sim/types';
import { VANGUARDS } from '../../data/objectives';
import { MODIFIERS } from '../../data/modifiers';
import { START } from '../../data/balance';
import { NODE_NAMES } from '../../data/text';
import { fmtTime, h, roman } from '../dom';
import { DOCTRINE_GLYPH, MODIFIER_GLYPH, MODIFIER_KIND_COLOR, OBJECTIVE_GLYPH, REWARD_GLYPH, divider, glyph } from '../ui/glyphs';
import { runHeader } from '../ui/header';
import { portrait, unitChip } from '../ui/portraits';

const VANGUARD_ICON: Record<VanguardId, 'muster_hall' | 'bowyard' | 'storehouse'> = {
  muster_hall: 'muster_hall',
  bowyard: 'bowyard',
  storehouse: 'storehouse',
};

function skullRow(n: number): HTMLElement {
  const wrap = h('span', { class: 'skulls lg' });
  for (let i = 0; i < 5; i++) wrap.appendChild(glyph('skull', i < n ? '' : 'off'));
  return wrap;
}

export function mountBriefing(app: AppCtx, b: Briefing): ScreenHandle {
  const run = app.run;
  const header = run ? runHeader(app) : null;
  const vanguards = b.vanguards.length ? b.vanguards : (['muster_hall', 'bowyard', 'storehouse'] as VanguardId[]);
  let vanguard: VanguardId = vanguards[0];
  let starting = false;

  // --- left: the battle
  const objective = h(
    'div',
    { class: 'brief-objective' },
    h('span', { class: `crest crest-xl ${b.nodeType === 'boss' ? 'crest-boss' : b.nodeType === 'elite' ? 'crest-elite' : ''}` }, glyph(OBJECTIVE_GLYPH[b.objective])),
    h(
      'div',
      { class: 'col', style: 'gap:.2rem;min-width:0' },
      h('div', { class: 'eyebrow' }, `${NODE_NAMES[b.nodeType] ?? b.nodeType}${b.nodeType === 'boss' ? '' : ` · Column ${roman(b.depth)}`} · Depth ${b.depth}`),
      h('h1', { class: 'display h1 brief-title' }, b.objectiveName),
      h('div', { class: 'brief-desc' }, b.objectiveDesc),
    ),
  );

  const facts = h(
    'div',
    { class: 'brief-facts' },
    h('div', { class: 'fact' }, h('span', { class: 'label-caps' }, 'Threat'), skullRow(b.threat)),
    h('div', { class: 'fact' }, h('span', { class: 'label-caps' }, 'Par'), h('span', { class: 'fact-v' }, b.par === null ? '—' : fmtTime(b.par))),
    h(
      'div',
      { class: 'fact' },
      h('span', { class: 'label-caps' }, 'Reward'),
      h('span', { class: 'fact-v reward-v' }, glyph(REWARD_GLYPH[b.reward]), h('span', null, b.rewardDesc)),
    ),
  );

  const biome = h(
    'div',
    { class: 'brief-card' },
    h('div', { class: 'panel-title' }, glyph('bush'), 'Biome'),
    h('div', { class: 'bc-head' }, b.biomeName),
    h('div', { class: 'small muted' }, b.biomeTwist),
  );

  const doctrine = h(
    'div',
    { class: 'brief-card doctrine-card' },
    h('div', { class: 'panel-title' }, glyph('nest'), 'Thornwake Doctrine'),
    h('div', { class: 'row' }, h('span', { class: 'crest crest-md crest-enemy' }, glyph(DOCTRINE_GLYPH[b.doctrine])), h('div', { class: 'quote doctrine-hint' }, `“${b.doctrineHint}”`)),
    b.doctrineAnswer
      ? h('div', { class: 'callout answer' }, h('span', { class: 'label-caps' }, 'Counsel'), h('div', null, b.doctrineAnswer))
      : h('div', { class: 'tiny dim' }, 'Scout a Nest while a wave musters to read its makeup.'),
  );

  const mods = h('div', { class: 'brief-mods' });
  if (b.modifiers.length === 0) mods.appendChild(h('div', { class: 'muted small' }, 'No modifiers. The road is as it seems.'));
  for (const m of b.modifiers) {
    const def = MODIFIERS[m.id];
    const color = MODIFIER_KIND_COLOR[def?.kind ?? m.kind] ?? '#a8987a';
    mods.appendChild(
      h(
        'div',
        { class: 'mod-row', style: `--mk:${color}` },
        h('span', { class: 'mod-icon' }, glyph(MODIFIER_GLYPH[m.id])),
        h(
          'div',
          { class: 'col', style: 'gap:.1rem' },
          h('div', { class: 'mod-name' }, m.name),
          h('div', { class: 'small' }, m.desc),
          m.payoff && m.payoff !== 'None.' ? h('div', { class: 'small good' }, `Payoff: ${m.payoff}`) : null,
        ),
      ),
    );
  }

  const left = h(
    'section',
    { class: 'panel studs brief-left' },
    objective,
    facts,
    divider('wide'),
    h('div', { class: 'brief-grid' }, biome, doctrine),
    h('div', { class: 'panel-title', style: 'margin-top:.4rem' }, glyph('moon'), 'Modifiers'),
    mods,
  );

  // --- right: the host
  const host = h('div', { class: 'brief-host' });
  const base = h(
    'div',
    { class: 'host-base small muted' },
    `The Hearth, ${START.tillers} Tillers, ${START.coursers} Courser and the Warden take the field.`,
  );
  host.appendChild(base);
  const carried = h('div', { class: 'host-units' });
  for (const u of b.retinue) carried.appendChild(unitChip(u));
  for (const u of b.sellswords) carried.appendChild(unitChip(u, { sellsword: true }));
  if (b.retinue.length === 0 && b.sellswords.length === 0) carried.appendChild(h('div', { class: 'small dim italic' }, 'No veterans march with you yet.'));
  host.appendChild(carried);

  const vgCards = new Map<VanguardId, HTMLElement>();
  const vgRow = h('div', { class: 'vanguard-row' });
  for (const id of vanguards) {
    const def = VANGUARDS[id];
    const card = h(
      'div',
      { class: 'card vanguard-card clickable', role: 'button', tabindex: '0' },
      portrait(VANGUARD_ICON[id], { size: 'lg' }),
      h('div', { class: 'vg-name' }, def.name),
      h('div', { class: 'vg-desc' }, def.desc),
    );
    const pick = (): void => {
      if (vanguard === id) return;
      vanguard = id;
      app.click();
      paint();
    };
    card.addEventListener('click', pick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick();
      }
    });
    vgCards.set(id, card);
    vgRow.appendChild(card);
  }
  const paint = (): void => {
    for (const [id, c] of vgCards) c.classList.toggle('selected', id === vanguard);
  };
  paint();

  const begin = h(
    'button',
    {
      class: 'btn primary lg begin-btn',
      onclick: () => {
        if (starting || !app.run) return;
        starting = true;
        app.click();
        const setup = app.guard('startBattle', () => app.api.startBattle(app.run!, app.meta, vanguard));
        if (!setup) {
          starting = false;
          return;
        }
        app.go({ screen: 'battle', setup, quick: false });
      },
    },
    glyph('swords'),
    'Begin Battle',
  );
  const back = h(
    'button',
    {
      class: 'btn ghost',
      onclick: () => {
        app.click();
        app.go({ screen: 'map' });
      },
    },
    glyph('back'),
    'Back',
  );

  const right = h(
    'section',
    { class: 'panel studs brief-right' },
    h('div', { class: 'panel-title' }, glyph('people'), 'Your Host'),
    host,
    h('div', { class: 'panel-title', style: 'margin-top:.5rem' }, glyph('tower'), 'Vanguard'),
    h('div', { class: 'tiny muted', style: 'margin:-.3rem 0 .4rem' }, 'One building stands ready when the Hearth is kindled.'),
    vgRow,
    h('div', { class: 'spacer' }),
    h('div', { class: 'brief-notes tiny muted' }, b.canRetreat ? 'Sound the Retreat from 3:00 (−1 Resolve, keep plunder and survivors).' : 'There is no retreat from this battle.', ' ', b.quitCostText),
    h('div', { class: 'brief-actions' }, back, begin),
  );

  const el = h('div', { class: 'scr briefing-scr' }, header?.el ?? null, h('div', { class: 'brief-body' }, left, right));
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
