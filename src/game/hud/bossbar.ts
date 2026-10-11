/** Boss HP bar (below the Horn, GDD §O / §I): name, phase, Warded shimmer, Enraged state. */
import { h, setBar, setHidden, setText, toggleClass } from '../dom';
import type { HudContext } from './context';

/** The bar also shows the Antlered Lord (Noble Hunt), which has no Throne phases. */
function isRegent(name: string): boolean {
  return /regent/i.test(name);
}

export class BossBar {
  readonly el: HTMLDivElement;
  private readonly name: HTMLElement;
  private readonly phase: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly lag: HTMLElement;
  private readonly hp: HTMLElement;
  private lagFrac = 1;

  constructor(parent: HTMLElement, private readonly ctx: HudContext) {
    this.el = h('div', 'bt-boss bt-hidden', parent);
    const head = h('div', 'bt-boss-head', this.el);
    this.name = h('span', 'bt-boss-name', head);
    this.phase = h('span', 'bt-boss-phase', head);
    const bar = h('div', 'bt-boss-bar', this.el);
    this.lag = h('div', 'bt-boss-lag', bar);
    this.fill = h('div', 'bt-boss-fill', bar);
    this.hp = h('div', 'bt-boss-hp', bar);
    ctx.tooltip.bind(this.el, () => {
      const b = ctx.view?.boss;
      if (!b) return null;
      if (!isRegent(b.name)) {
        return {
          title: b.name,
          body: 'A Court Noble riding with the Thornwake. Its Wild Hunt dashes through your line, and it calls Stagriders while above half health.',
          footer: 'It is cavalry: Ashpikes deal ×3 to it.',
        };
      }
      return {
        title: b.name,
        body: b.warded
          ? 'Warded on the Throne. Burn the Root Hearts: each one strips 1500 HP from its strength.'
          : 'Uprooted. It marches on your Hearth.',
        footer: b.enraged ? 'Enraged: faster, and its abilities come quicker.' : undefined,
      };
    });
  }

  update(): void {
    const b = this.ctx.view?.boss ?? null;
    setHidden(this.el, !b);
    if (!b) return;
    setText(this.name, b.name);
    const regent = isRegent(b.name);
    setText(this.phase, b.warded ? 'Warded' : b.enraged ? 'Enraged' : !regent ? 'Hunting' : b.phase === 2 ? 'Uprooted' : 'Enthroned');
    const frac = b.maxHp > 0 ? b.hp / b.maxHp : 0;
    setBar(this.fill, frac);
    this.lagFrac = frac > this.lagFrac ? frac : this.lagFrac + (frac - this.lagFrac) * 0.15;
    setBar(this.lag, this.lagFrac);
    setText(this.hp, b.warded ? 'Warded' : `${Math.ceil(b.hp)} / ${Math.ceil(b.maxHp)}`);
    toggleClass(this.el, 'warded', b.warded);
    toggleClass(this.el, 'enraged', b.enraged);
  }
}
