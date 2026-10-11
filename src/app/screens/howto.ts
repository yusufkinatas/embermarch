/**
 * How to Play: controls (GDD §O), the Counter Wheel (SVG), an economy primer, the Nest / Spent loop,
 * and the march itself.
 */
import type { AppCtx, ScreenHandle } from '../types';
import type { PlayerUnitId } from '../../sim/types';
import { START, POP, SPENT, RESOLVE, RETINUE } from '../../data/balance';
import { UNITS } from '../../data/units';
import { h, s, setChildren, type Child } from '../dom';
import { divider, glyph, RESOURCE_GLYPH, type GlyphName } from '../ui/glyphs';
import { portraitUrl } from '../ui/portraits';

type Tab = 'controls' | 'counters' | 'economy' | 'nests' | 'march';

const CONTROLS: [string[], string][] = [
  [['LMB', 'Drag'], 'Select / box-select. Military and the Warden take priority over Tillers.'],
  [['Shift', 'LMB'], 'Add to or remove from the selection'],
  [['Dbl-click'], 'Select all of that type on screen'],
  [['RMB'], 'Smart command: move, attack, gather, build / repair, rally'],
  [['Shift', 'RMB'], 'Queue orders (up to 8)'],
  [['A', 'LMB'], 'Attack-move'],
  [['S'], 'Stop'],
  [['G'], 'Hold ground'],
  [['Ctrl', '1-9'], 'Make a group (or Alt+1-9, or RMB a group slot)'],
  [['1-9'], 'Recall a group (double-tap centers)'],
  [['H'], 'Select the Hearth'],
  [['`'], 'Select the Warden'],
  [['.'], 'Cycle idle Tillers'],
  [[','], 'Select all military'],
  [['Space'], 'Jump to the latest alert'],
  [['Q', 'W', 'E'], 'Train (building) / Warden abilities'],
  [['Z', 'X', 'C'], 'Research or Temper'],
  [['V'], 'Rally the Hearth'],
  [['Tab'], 'Hold for the Counter Wheel'],
  [['F2'], 'Pause (orders still allowed)'],
  [['−', '='], 'Slower / faster (1×, 1.5×, 2×)'],
  [['M'], 'Mute'],
  [['Esc'], 'Cancel, deselect, then the pause menu'],
  [['Arrows', 'Edge', 'MMB'], 'Pan the camera'],
  [['Wheel'], 'Zoom'],
];

const BUILD_KEYS: [string, string][] = [
  ['C', 'Cottage'],
  ['E', 'Storehouse'],
  ['F', 'Grainplot'],
  ['B', 'Muster Hall'],
  ['R', 'Bowyard'],
  ['P', 'Paddock'],
  ['N', 'Forgehall'],
  ['T', 'Brazier Tower'],
  ['Y', 'Siegeyard'],
];

function keys(k: string[]): HTMLElement {
  return h(
    'span',
    { class: 'keys' },
    k.map((x, i) => [i > 0 ? h('span', { class: 'plus' }, '+') : null, h('span', { class: 'kbd' }, x)]),
  );
}

function controlsTab(): Child {
  const half = Math.ceil(CONTROLS.length / 2);
  const table = (rows: [string[], string][]): HTMLElement =>
    h('table', { class: 'ctrl-table' }, h('tbody', null, rows.map(([k, d]) => h('tr', null, h('td', { class: 'ck' }, keys(k)), h('td', null, d)))));
  return h(
    'div',
    { class: 'howto-cols' },
    h('div', { class: 'col' }, table(CONTROLS.slice(0, half))),
    h(
      'div',
      { class: 'col' },
      table(CONTROLS.slice(half)),
      h('div', { class: 'panel-title', style: 'margin-top:.6rem' }, glyph('hammer'), 'With Tillers selected'),
      h('div', { class: 'build-keys' }, BUILD_KEYS.map(([k, n]) => h('span', { class: 'bk' }, h('span', { class: 'kbd' }, k), n))),
      h('div', { class: 'tiny muted' }, 'Shift keeps placing. RMB or Esc cancels.'),
    ),
  );
}

// ------------------------------------------------------------------ Counter Wheel

function wheelNode(x: number, y: number, unit: PlayerUnitId, label: string, sub: string, r = 46, labelAbove = false): SVGGElement {
  const g = s('g', { class: 'cw-node', transform: `translate(${x} ${y})` });
  g.appendChild(s('circle', { r: r + 6, class: 'cw-ring' }));
  g.appendChild(s('circle', { r, class: 'cw-disc' }));
  g.appendChild(s('image', { href: portraitUrl(unit, 0, 96), x: -r * 0.78, y: -r * 0.78, width: r * 1.56, height: r * 1.56 }));
  const ly = labelAbove ? -r - 30 : r + 26;
  g.appendChild(s('text', { y: ly, class: 'cw-label', 'text-anchor': 'middle' }, label));
  g.appendChild(s('text', { y: ly + 17, class: 'cw-sub', 'text-anchor': 'middle' }, sub));
  return g;
}

function arc(from: { x: number; y: number }, to: { x: number; y: number }, bend: number, mult: string, cls: string, trim = 62): SVGGElement {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const a = { x: from.x + ux * trim, y: from.y + uy * trim };
  const b = { x: to.x - ux * trim, y: to.y - uy * trim };
  const mx = (a.x + b.x) / 2 - uy * bend;
  const my = (a.y + b.y) / 2 + ux * bend;
  const g = s('g', { class: `cw-arc ${cls}` });
  g.appendChild(s('path', { d: `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`, 'marker-end': `url(#cw-head-${cls})` }));
  const lx = (a.x + 2 * mx + b.x) / 4;
  const ly = (a.y + 2 * my + b.y) / 4;
  g.appendChild(s('circle', { cx: lx, cy: ly, r: 19, class: 'cw-badge' }));
  g.appendChild(s('text', { x: lx, y: ly + 5, 'text-anchor': 'middle', class: 'cw-mult' }, mult));
  return g;
}

function counterWheel(): SVGSVGElement {
  const svg = s('svg', { class: 'counter-wheel', viewBox: '0 0 780 480' });
  svg.innerHTML =
    '<defs>' +
    '<marker id="cw-head-primary" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#ff8c1a"/></marker>' +
    '<marker id="cw-head-ember" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#c99a52"/></marker>' +
    '</defs>' +
    '<text x="190" y="26" text-anchor="middle" class="cw-title">Primary triangle</text>' +
    '<text x="585" y="26" text-anchor="middle" class="cw-title">Ember loop</text>' +
    '<path d="M390 46 V456" stroke="#6b4f2a" stroke-opacity=".5" stroke-dasharray="3 6"/>';
  // Primary triangle: spears beat cavalry, cavalry beats ranged, ranged beats infantry.
  const P = { spear: { x: 190, y: 110 }, horse: { x: 325, y: 340 }, bow: { x: 55, y: 340 } };
  svg.appendChild(arc(P.spear, P.horse, -24, '×3', 'primary'));
  svg.appendChild(arc(P.horse, P.bow, -24, '×2', 'primary'));
  svg.appendChild(arc(P.bow, P.spear, -24, '×2', 'primary'));
  svg.appendChild(wheelNode(P.spear.x, P.spear.y, 'ashpike', 'Spears', 'Ashpike'));
  svg.appendChild(wheelNode(P.horse.x, P.horse.y, 'courser', 'Cavalry', 'Courser'));
  svg.appendChild(wheelNode(P.bow.x, P.bow.y, 'bowman', 'Ranged', 'Bowman'));
  // Ember loop: Ashpikes beat Destriers, Destriers beat Oathshields, Oathshields beat archers, archers beat Ashpikes.
  const E = { pike: { x: 480, y: 150 }, destrier: { x: 690, y: 150 }, shield: { x: 690, y: 345 }, bow: { x: 480, y: 345 } };
  svg.appendChild(arc(E.pike, E.destrier, 0, 'beats', 'ember', 54));
  svg.appendChild(arc(E.destrier, E.shield, 0, 'beats', 'ember', 54));
  svg.appendChild(arc(E.shield, E.bow, 0, '½', 'ember', 54));
  svg.appendChild(arc(E.bow, E.pike, 0, '×2', 'ember', 54));
  svg.appendChild(wheelNode(E.pike.x, E.pike.y, 'ashpike', 'Ashpike', 'negates Charge', 40, true));
  svg.appendChild(wheelNode(E.destrier.x, E.destrier.y, 'destrier', 'Destrier', 'heavy horse', 40, true));
  svg.appendChild(wheelNode(E.shield.x, E.shield.y, 'oathshield', 'Oathshield', 'half damage from arrows', 40));
  svg.appendChild(wheelNode(E.bow.x, E.bow.y, 'bowman', 'Bowman', 'archer', 40));
  return svg;
}

function countersTab(): Child {
  return h(
    'div',
    { class: 'howto-cols wheel-cols' },
    h('div', { class: 'wheel-wrap' }, counterWheel()),
    h(
      'div',
      { class: 'col howto-notes' },
      h('p', null, h('b', null, 'Spears beat Cavalry (×3). Cavalry beats Ranged (×2). Ranged beats Infantry (×2).'), ' Each arrow points at the unit being beaten.'),
      h('p', null, 'The Ember loop adds the drafted units: Ashpikes beat Destriers, Destriers ride down Oathshields, and Oathshields shrug off arrows.'),
      h('p', null, 'An orange ', h('b', { class: 'counter' }, '×3'), ' popup marks a counter hit. A grey ', h('b', { class: 'muted' }, '×0.5'), ' marks a resisted hit.'),
      h('p', null, 'Oathshields and Thornhusks take half damage from arrows. Rams and Rootbreakers shrug off arrows almost entirely.'),
      h('p', null, 'Siege deals ×4 to structures. Archers barely scratch them (×0.2). Counter bonuses never apply against the Warden or the Briar Regent.'),
      h('p', null, 'Armor has diminishing returns: 1 armor is −9% damage, 3 is −23%, 5 is −33%.'),
      h('p', { class: 'muted small' }, 'Hold ', h('span', { class: 'kbd' }, 'Tab'), ' in battle to see the Counter Wheel.'),
    ),
  );
}

// ------------------------------------------------------------------ Economy

function resCol(icon: GlyphName, cls: string, name: string, lines: Child[]): HTMLElement {
  return h('div', { class: `res-col ${cls}` }, h('span', { class: 'crest crest-lg' }, glyph(icon)), h('div', { class: 'res-name' }, name), h('ul', null, lines.map((l) => h('li', null, l))));
}

function economyTab(): Child {
  const tiller = UNITS.tiller;
  return h(
    'div',
    { class: 'col', style: 'gap:.8rem' },
    h(
      'div',
      { class: 'res-cols' },
      resCol(RESOURCE_GLYPH.grain, 'grain', 'Grain', ['Feeds every unit.', 'Thickets near the Hearth run out in about three minutes.', 'Grainplots (F, Timber) feed 2 Tillers forever.']),
      resCol(RESOURCE_GLYPH.timber, 'timber', 'Timber', ['Builds everything and buys bows.', 'Trees deplete and the forest recedes.', 'A Storehouse near the treeline shortens every trip.']),
      resCol(RESOURCE_GLYPH.ember, 'ember', 'Ember', ['Buys quality units, towers, Tempers and research.', 'Rich Seams lie toward the Nests, under guard.', 'Blight swallows Seams as the battle goes on.']),
    ),
    h(
      'div',
      { class: 'howto-facts' },
      h('div', null, h('b', null, 'Every Tiller is a choice. '), `Each battle starts with ${START.tillers} Tillers and ${START.res.grain} Grain, ${START.res.timber} Timber, ${START.res.ember} Ember. A Tiller costs ${tiller.cost.grain} Grain and trains in ${tiller.trainTime} s.`),
      h('div', null, h('b', null, 'Population. '), `The Hearth gives +${POP.hearth} and each Cottage +${POP.cottage}, up to ${POP.hardCap}. Training waits while you are capped.`),
      h('div', null, h('b', null, 'Drop-off. '), 'The Hearth and every Storehouse accept all resources. Tillers flee when struck, then return to work.'),
      h('div', null, h('b', null, 'Rally the Hearth (V). '), 'Nearby Tillers drop their loads and fight for a short while. Long cooldown.'),
    ),
  );
}

// ------------------------------------------------------------------ Nest loop

function nestsTab(): Child {
  const steps: [GlyphName, string, string][] = [
    ['nest', 'Muster', 'The horn sounds 30 s before a wave launches. Units gather in front of a Nest.'],
    ['sun', 'Scout', 'Get any unit within 6 tiles of the muster point to see the wave’s makeup on the Horn.'],
    ['swords', 'Break the wave', 'Hold your line. Counter what you saw. The Hearth and towers fire on anything in range.'],
    ['hourglass', 'Strike while Spent', `A Nest that launched is Spent: it takes ×${SPENT.damageMult} damage and its guard stops regrowing, until ${SPENT.afterBroken} s after its wave breaks.`],
    ['torch', 'Burn the Nest', 'Every Nest that falls shrinks the waves and pulls its Blight back.'],
  ];
  return h(
    'div',
    { class: 'col', style: 'gap:.8rem' },
    h(
      'ol',
      { class: 'nest-loop' },
      steps.map(([g, t, d], i) => h('li', { class: 'nl-step' }, h('span', { class: 'nl-num' }, String(i + 1)), h('span', { class: 'crest crest-md' }, glyph(g)), h('div', { class: 'nl-title' }, t), h('div', { class: 'nl-desc' }, d))),
    ),
    h(
      'div',
      { class: 'howto-facts' },
      h('div', null, h('b', null, 'Defend, then punish. '), 'Pushing into a Nest that just launched is the strongest move in the game. Its garrison is thin and its walls are soft.'),
      h('div', null, h('b', null, 'Blight. '), 'Violet Blight spreads from each Nest. It slows your units, blocks building and withers structures it reaches.'),
      h('div', null, h('b', null, 'Doctrines. '), 'Each battle the Thornwake favours a doctrine. The briefing hints at it; a Nest’s banner shows it once seen.'),
    ),
  );
}

function marchTab(): Child {
  return h(
    'div',
    { class: 'howto-facts march' },
    h('div', null, h('b', null, 'The Ember Road. '), 'Eight columns from the Greenmarch to the Heartwood. Choose battles, events, camps and the Peddler on the way to the Briar Throne.'),
    h('div', null, h('b', null, 'Resolve. '), `You start with ${RESOLVE.start}. Losing a battle or Sounding the Retreat costs 1. At 0 the march ends. In the final battle, Resolve buys a Last Stand.`),
    h('div', null, h('b', null, 'Retinue. '), `After a victory or Retreat, carry up to ${RETINUE.baseCap} pop of surviving veterans into the next battle. They keep their Rank (3, 7 and 12 kills).`),
    h('div', null, h('b', null, 'Boons and Drafts. '), 'Boons bend your economy and army for the whole march. Rule Boons change how you play. Drafts unlock new unit types.'),
    h('div', null, h('b', null, 'Crowns. '), 'Won in battle and from plunder. Spend them at the Peddler and on events.'),
    h('div', null, h('b', null, 'Renown. '), 'Every march earns Renown, even a lost one. Raise banners in the Hall of Banners to unlock Houses, Codex Boons and more.'),
  );
}

export function mountHowTo(app: AppCtx): ScreenHandle {
  const tabs: [Tab, string, GlyphName][] = [
    ['controls', 'Controls', 'hammer'],
    ['counters', 'Counter Wheel', 'swords'],
    ['economy', 'Economy', 'wheat'],
    ['nests', 'Nests & Waves', 'nest'],
    ['march', 'The March', 'banner'],
  ];
  let tab: Tab = 'controls';
  const content = h('div', { class: 'howto-content scroll' });
  const tabBar = h('div', { class: 'howto-tabs' });
  const render = (): void => {
    setChildren(
      tabBar,
      tabs.map(([id, label, g]) =>
        h(
          'button',
          {
            class: `howto-tab ${id === tab ? 'on' : ''}`,
            onclick: () => {
              if (tab === id) return;
              app.click();
              tab = id;
              render();
            },
          },
          glyph(g),
          label,
        ),
      ),
    );
    setChildren(content, tab === 'controls' ? controlsTab() : tab === 'counters' ? countersTab() : tab === 'economy' ? economyTab() : tab === 'nests' ? nestsTab() : marchTab());
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
    { class: 'scr howto-scr' },
    h(
      'div',
      { class: 'scr-topbar' },
      back,
      h('div', { class: 'scr-title-row' }, h('div', { class: 'eyebrow' }, 'The Warden’s Primer'), h('h1', { class: 'display h1' }, 'How to Play')),
      h('div', { class: 'topbar-right' }),
    ),
    h('div', { class: 'howto-body' }, tabBar, h('div', { class: 'panel studs howto-panel' }, content), divider('narrow')),
  );
  return {
    el,
    onKey: (e) => {
      if (e.key === 'Escape') {
        back.click();
        return true;
      }
      const i = tabs.findIndex(([id]) => id === tab);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const n = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        tab = tabs[n][0];
        app.click();
        render();
        return true;
      }
      return false;
    },
  };
}
