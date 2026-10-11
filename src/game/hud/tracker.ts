/**
 * Objective tracker (top right, GDD §O): tracker text from the encounter view ("Nests 1/2 · Par
 * 4:12", "Kindling 140/300", "Waves 4/6", "Burn the Root Hearts 1/3 · Regent Warded"), the par
 * timer (greys out when missed), battle Crowns, and the Boon tray with tooltips. Modifiers sit
 * under the Boons.
 */
import { BOONS } from '../../data/boons';
import { MODIFIERS } from '../../data/modifiers';
import { OBJECTIVES } from '../../data/objectives';
import { parSeconds } from '../../data/balance';
import { RARITY_NAMES, TAG_NAMES } from '../../data/text';
import { PALETTE } from '../../data/palette';
import { clearChildren, h, setBar, setHidden, setHtml, setText, toggleClass } from '../dom';
import { formatCountdown } from '../format';
import { GLYPHS, TAG_GLYPH } from '../glyphs';
import type { HudContext } from './context';

export class Tracker {
  readonly el: HTMLDivElement;
  private readonly lines: HTMLElement;
  private readonly kindle: HTMLElement;
  private readonly kindleFill: HTMLElement;
  private readonly crowns: HTMLElement;
  private readonly boons: HTMLElement;
  private readonly mods: HTMLElement;
  private linesKey = '';
  private crownsPrev = -1;

  constructor(parent: HTMLElement, private readonly ctx: HudContext) {
    this.el = h('div', 'bt-tracker', parent);
    const card = h('div', 'bt-tracker-card bt-panel', this.el);
    const head = h('div', 'bt-tracker-head', card);
    h('span', 'bt-tracker-obj', head, OBJECTIVES[ctx.setup.objective].name);
    this.crowns = h('span', 'bt-crowns', head);
    ctx.tooltip.bind(this.crowns, () => ({
      title: 'Crowns plundered',
      body: 'Nests, Pickets and Caches pay Crowns. Victory adds the battle reward on top.',
    }));
    this.lines = h('div', 'bt-tracker-lines', card);
    ctx.tooltip.bind(card, () => ({ title: OBJECTIVES[ctx.setup.objective].name, body: OBJECTIVES[ctx.setup.objective].goal, footer: OBJECTIVES[ctx.setup.objective].parDesc ?? undefined }));
    this.kindle = h('div', 'bt-kindle bt-hidden', card);
    this.kindleFill = h('div', 'bt-kindle-fill', this.kindle);
    this.boons = h('div', 'bt-boons', this.el);
    this.mods = h('div', 'bt-mods', this.el);
    this.buildBoons();
    this.buildMods();
  }

  private buildBoons(): void {
    const { setup, tooltip } = this.ctx;
    clearChildren(this.boons);
    for (const id of setup.boons) {
      const def = BOONS[id];
      if (!def) continue;
      const b = h('div', `bt-boon rar-${def.rarity}`, this.boons);
      setHtml(b, GLYPHS[TAG_GLYPH[def.tags[0]] ?? 'ember']);
      tooltip.bind(b, () => ({
        title: def.name,
        color: PALETTE.rarity[def.rarity],
        sub: `${RARITY_NAMES[def.rarity]} · ${def.kind === 'rule' ? 'Rule' : 'Stat'} · ${def.tags.map((t) => TAG_NAMES[t]).join(', ')}`,
        body: def.desc,
      }));
    }
    setHidden(this.boons, setup.boons.length === 0);
  }

  private buildMods(): void {
    const { setup, tooltip } = this.ctx;
    clearChildren(this.mods);
    for (const id of setup.modifiers) {
      const def = MODIFIERS[id];
      if (!def) continue;
      const m = h('div', `bt-mod kind-${def.kind}`, this.mods, def.name);
      tooltip.bind(m, () => ({ title: def.name, sub: 'Modifier', body: def.desc, footer: def.payoffDesc }));
    }
    setHidden(this.mods, setup.modifiers.length === 0);
  }

  update(): void {
    const { view, setup } = this.ctx;
    if (!view) {
      setText(this.lines, OBJECTIVES[setup.objective].goal);
      return;
    }
    const parTotal = parSeconds(setup.objective, view.nests.length);
    const parMissed = parTotal !== null && view.parRemaining === null;
    const segs = view.trackerText.split(' · ').filter(Boolean);
    const hasPar = segs.some((s) => s.startsWith('Par'));
    if (!hasPar && view.parRemaining !== null) segs.push(`Par ${formatCountdown(view.parRemaining)}`);
    else if (!hasPar && parMissed) segs.push('Par missed');
    const key = `${segs.join('|')}#${parMissed}`;
    if (key !== this.linesKey) {
      this.linesKey = key;
      clearChildren(this.lines);
      segs.forEach((s, i) => {
        if (i > 0) h('span', 'bt-sep', this.lines, '·');
        const isPar = s.startsWith('Par');
        const span = h('span', isPar ? 'bt-par' : 'bt-goal', this.lines, s);
        if (isPar) toggleClass(span, 'missed', parMissed || s === 'Par missed');
      });
    }
    if (view.kindling) {
      setHidden(this.kindle, false);
      setBar(this.kindleFill, view.kindling.target > 0 ? view.kindling.value / view.kindling.target : 0);
    } else setHidden(this.kindle, true);
    const c = Math.floor(view.plunderCrowns);
    if (c !== this.crownsPrev) {
      if (this.crownsPrev >= 0 && c > this.crownsPrev) {
        this.crowns.classList.remove('bump');
        void this.crowns.offsetWidth;
        this.crowns.classList.add('bump');
      }
      this.crownsPrev = c;
      setHtml(this.crowns, `${GLYPHS.crown}<b>${c}</b>`);
    }
  }
}
