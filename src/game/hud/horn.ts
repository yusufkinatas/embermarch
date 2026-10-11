/**
 * Wave Horn (top center, GDD §O / §I): "Wave 3 · 0:24 · NE", composition icons with counts (when
 * scouted) or a size label, a note line, the doctrine banner once seen, Spent banners after a wave
 * breaks ("Wave 3 broken. NE Nest Spent 0:30") and the rising "Waves −30%" popup when a Nest falls.
 */
import { DOCTRINES } from '../../data/doctrines';
import { TEXT } from '../../data/text';
import { UNITS } from '../../data/units';
import type { WaveHornView } from '../../sim/encounter/types';
import { ENEMY } from '../../sim/types';
import { clearChildren, h, setBgImage, setHidden, setHtml, setText, toggleClass } from '../dom';
import { compassDir, formatCountdown } from '../format';
import { GLYPHS, iconSrc } from '../glyphs';
import type { HudContext } from './context';
import type { TipContent } from './tooltip';

interface SpentBanner {
  nestId: number;
  wave: number;
  dir: string;
  el: HTMLElement;
  text: HTMLElement;
  bornAt: number;
}

/** Real seconds the full Horn callout shows when a wave starts mustering. */
export const HORN_CALLOUT_S = 6;
/** Real seconds it re-expands when the wave launches or gets scouted. */
export const HORN_LAUNCH_S = 4;

const DOCTRINE_GLYPH: Record<string, keyof typeof GLYPHS> = {
  swarm: 'infantry',
  quill: 'ranged',
  spines: 'ranged',
  hunt: 'cavalry',
  hoof: 'cavalry',
  siegebreak: 'siege',
  siege: 'siege',
  court: 'boss',
  crown: 'boss',
};

export class WaveHorn {
  readonly el: HTMLDivElement;
  private readonly plate: HTMLElement;
  private readonly doctrine: HTMLElement;
  private readonly title: HTMLElement;
  private readonly comp: HTMLElement;
  private readonly notes: HTMLElement;
  private readonly popups: HTMLElement;
  private readonly spentBox: HTMLElement;
  private compKey = '';
  private spent: SpentBanner[] = [];
  private lastWave = -1;
  private lastPhase = '';
  private lastRevealed = false;
  /** Real time until which the Horn shows its full callout; afterwards it collapses to one line. */
  private expandedUntil = 0;

  constructor(parent: HTMLElement, private readonly ctx: HudContext) {
    this.el = h('div', 'bt-horn-wrap', parent);
    this.plate = h('div', 'bt-horn bt-hidden', this.el);
    this.doctrine = h('div', 'bt-horn-doctrine bt-hidden', this.plate);
    const main = h('div', 'bt-horn-main', this.plate);
    this.title = h('div', 'bt-horn-title', main);
    this.comp = h('div', 'bt-horn-comp', main);
    this.notes = h('div', 'bt-horn-notes', main);
    this.popups = h('div', 'bt-horn-popups', this.el);
    this.spentBox = h('div', 'bt-spent-list', this.el);
    // The plate lets clicks through to the battlefield; the small tags keep their tooltips.
    ctx.tooltip.bind(this.comp, () => this.tip());
    ctx.tooltip.bind(this.doctrine, () => {
      const v = ctx.view;
      if (!v) return null;
      const d = DOCTRINES[v.doctrine];
      return { title: `Doctrine: ${d.name}`, body: d.hint, footer: ctx.setup.showHints ? d.answer : undefined };
    });
  }

  private tip(): TipContent | null {
    const horn = this.ctx.view?.horn;
    if (!horn) return null;
    return {
      title: `Wave ${horn.wave}`,
      body: horn.revealed
        ? 'Scouted: its makeup is known until the wave is broken.'
        : 'Get a unit within 6 tiles of the muster point (or use the Hawk) to read its makeup.',
      footer: horn.phase === 'muster' ? 'Mustering. It launches when the timer runs out.' : 'Advancing on your lines.',
    };
  }

  /** True while the full (multi-line) callout shows: the first seconds of a muster, launch or scouting. */
  get expanded(): boolean {
    return this.ctx.now < this.expandedUntil;
  }

  update(): void {
    const v = this.ctx.view;
    const horn = v?.horn ?? null;
    if (!horn) {
      this.lastPhase = '';
      this.lastRevealed = false;
    }
    const ascSoon = v && v.ascendantIn !== null && v.ascendantIn <= 30 && v.ascendantIn > 0 ? v.ascendantIn : null;
    setHidden(this.plate, !horn && ascSoon === null);
    if (v) {
      const showDoc = v.doctrineSeen;
      setHidden(this.doctrine, !showDoc);
      if (showDoc) {
        const d = DOCTRINES[v.doctrine];
        setHtml(this.doctrine, `${GLYPHS[DOCTRINE_GLYPH[d.icon] ?? DOCTRINE_GLYPH[d.id] ?? 'boss']}<span>${d.name}</span>`);
      }
    }
    if (horn) this.renderHorn(horn, ascSoon);
    else if (ascSoon !== null) {
      setText(this.title, 'The Thornwake stirs');
      this.setComp('');
      setText(this.notes, TEXT.ascendantSoon(formatCountdown(ascSoon)));
      setHidden(this.notes, false);
      toggleClass(this.plate, 'collapsed', false);
      toggleClass(this.plate, 'advancing', false);
      toggleClass(this.plate, 'great', false);
    }
    this.updateSpent();
  }

  private renderHorn(horn: WaveHornView, ascSoon: number | null): void {
    const great = this.ctx.setup.objective === 'holdfast' && horn.wave === 6;
    const name = great ? 'The Great Wave' : `Wave ${horn.wave}`;
    const timer = horn.phase === 'muster' ? formatCountdown(horn.secondsToLaunch) : 'Advancing';
    const parts = [name, timer];
    if (horn.direction) parts.push(horn.direction);
    setText(this.title, parts.join(' · '));
    toggleClass(this.plate, 'advancing', horn.phase === 'advancing');
    toggleClass(this.plate, 'great', great);
    const now = this.ctx.now;
    if (horn.wave !== this.lastWave) {
      this.lastWave = horn.wave;
      this.plate.classList.remove('sounding');
      void this.plate.offsetWidth; // restart the entry animation
      this.plate.classList.add('sounding');
      this.expandedUntil = now + HORN_CALLOUT_S;
    } else if (horn.phase !== this.lastPhase && this.lastPhase !== '') {
      this.expandedUntil = Math.max(this.expandedUntil, now + HORN_LAUNCH_S);
    } else if (horn.revealed && !this.lastRevealed) {
      this.expandedUntil = Math.max(this.expandedUntil, now + HORN_LAUNCH_S);
    }
    this.lastPhase = horn.phase;
    this.lastRevealed = horn.revealed;
    const collapsed = !this.expanded;
    toggleClass(this.plate, 'collapsed', collapsed);
    if (horn.revealed && horn.composition.length) {
      const key = horn.composition.map((c) => `${c.type}:${c.count}`).join('|');
      if (key !== this.compKey) {
        this.compKey = key;
        clearChildren(this.comp);
        for (const c of horn.composition) {
          const item = h('span', 'bt-horn-unit', this.comp);
          const ic = h('i', 'bt-unit-ic', item);
          setBgImage(ic, iconSrc(c.type, ENEMY, 24));
          if (!ic.classList.contains('has-img')) ic.textContent = UNITS[c.type].name.slice(0, 2);
          h('b', '', item, `×${c.count}`);
          item.title = UNITS[c.type].name;
        }
      }
    } else {
      this.setComp(`<span class="bt-horn-size">${horn.sizeLabel}</span><span class="bt-horn-unscouted">unscouted</span>`);
    }
    const notes = horn.notes.slice();
    if (ascSoon !== null && !notes.some((n) => n.startsWith('Ascendant'))) notes.push(TEXT.ascendantSoon(formatCountdown(ascSoon)));
    setText(this.notes, notes.join(' · '));
    // Collapsed: one line (title · size or icons); the notes return with the next callout.
    setHidden(this.notes, notes.length === 0 || collapsed);
  }

  private setComp(html: string): void {
    if (this.compKey === `html:${html}`) return;
    this.compKey = `html:${html}`;
    setHtml(this.comp, html);
  }

  /** "Waves −30%" rising from the Horn when a Nest falls. */
  popup(pct: number): void {
    if (!(pct > 0)) return;
    const el = h('div', 'bt-horn-pop', this.popups, TEXT.wavesReduced(pct));
    el.addEventListener('animationend', () => el.remove());
    window.setTimeout(() => el.remove(), 4000);
  }

  /** A wave broke: show a ticking Spent banner until the Nest recovers. */
  addSpent(nestId: number, wave: number): void {
    const dir = this.nestDir(nestId);
    const existing = this.spent.find((s) => s.nestId === nestId);
    if (existing) {
      existing.wave = wave;
      existing.bornAt = this.ctx.now;
      return;
    }
    const el = h('div', 'bt-spent', this.spentBox);
    h('span', 'bt-spent-ic', el).innerHTML = GLYPHS.ember;
    const text = h('span', '', el);
    this.spent.push({ nestId, wave, dir, el, text, bornAt: this.ctx.now });
    while (this.spent.length > 2) this.spent.shift()!.el.remove();
    this.updateSpent();
  }

  nestDir(nestId: number): string {
    const { world } = this.ctx;
    const nest = world.entities.get(nestId);
    const hearth = world.entities.get(world.hearthId);
    const hx = hearth ? hearth.x : world.anchors.hearth.tx + 2;
    const hy = hearth ? hearth.y : world.anchors.hearth.ty + 2;
    const n = nest ?? this.ctx.view?.nests.find((x) => x.id === nestId);
    return n ? compassDir(hx, hy, n.x, n.y) : '';
  }

  private updateSpent(): void {
    const v = this.ctx.view;
    this.spent = this.spent.filter((s) => {
      const n = v?.nests.find((x) => x.id === s.nestId);
      // Before the view reports Spent we keep the banner briefly (events can precede the view refresh).
      const alive = n ? n.alive && (n.spent || this.ctx.now - s.bornAt < 1) : this.ctx.now - s.bornAt < 6;
      if (!alive) {
        s.el.remove();
        return false;
      }
      const left = n ? formatCountdown(n.spentRemaining) : '';
      setText(s.text, TEXT.waveBroken(s.wave, s.dir, left).replace(/\s+/g, ' ').trim());
      return true;
    });
  }
}
