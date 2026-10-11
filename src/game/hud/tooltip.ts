/**
 * Single floating tooltip for the battle HUD. Targets bind a content builder; the tooltip
 * re-renders while visible (10 Hz) so cooldowns and affordability stay live.
 */
import { RESOURCE_NAMES } from '../../data/text';
import type { Cost, ResourceType } from '../../sim/types';
import { h, setBgImage, setHidden } from '../dom';
import { costEntries } from '../format';
import { iconSrc } from '../glyphs';

export interface TipContent {
  title: string;
  /** Small caps line under the title (role, rarity, tags). */
  sub?: string;
  hotkey?: string;
  cost?: Cost;
  /** Resources the player cannot afford (shown red). */
  short?: ResourceType[];
  body?: string;
  /** Extra lines (stats etc.). */
  lines?: string[];
  /** Red reason line (disabled commands). */
  reason?: string;
  /** Muted footer (e.g. "Shift: queue 5"). */
  footer?: string;
  /** Accent color for the title (rarity). */
  color?: string;
}

type Builder = () => TipContent | null;

export class Tooltip {
  readonly el: HTMLDivElement;
  private target: HTMLElement | null = null;
  private builder: Builder | null = null;
  private key = '';
  private readonly bound = new WeakMap<HTMLElement, Builder>();

  constructor(parent: HTMLElement) {
    this.el = h('div', 'bt-tooltip bt-hidden', parent);
    this.el.setAttribute('role', 'tooltip');
  }

  /** Attach a content builder to an element (pointer hover shows it). Re-binding replaces the builder. */
  bind(target: HTMLElement, builder: Builder): void {
    const first = !this.bound.has(target);
    this.bound.set(target, builder);
    if (!first) {
      if (this.target === target) {
        this.builder = builder;
        this.refresh();
      }
      return;
    }
    target.addEventListener('pointerenter', () => this.show(target));
    target.addEventListener('pointerleave', () => {
      if (this.target === target) this.hide();
    });
    target.addEventListener('pointerdown', () => {
      // Keep the tip but refresh after the click changed state.
      if (this.target === target) queueMicrotask(() => this.refresh());
    });
  }

  show(target: HTMLElement): void {
    const b = this.bound.get(target);
    if (!b) return;
    this.target = target;
    this.builder = b;
    this.key = '';
    this.refresh();
  }

  hide(): void {
    this.target = null;
    this.builder = null;
    this.key = '';
    setHidden(this.el, true);
  }

  /** Rebuild content if visible (cheap when unchanged). */
  refresh(): void {
    if (!this.target || !this.builder) return;
    if (!this.target.isConnected) {
      this.hide();
      return;
    }
    const c = this.builder();
    if (!c) {
      setHidden(this.el, true);
      this.key = '';
      return;
    }
    const key = JSON.stringify(c);
    if (key !== this.key) {
      this.key = key;
      this.render(c);
    }
    setHidden(this.el, false);
    this.position();
  }

  private render(c: TipContent): void {
    const el = this.el;
    el.textContent = '';
    // sim-core tooltips are multi-line and often repeat the label on the first line
    // ("Tiller: Worker"): drop the repeat and promote the role to the sub line.
    let sub = c.sub;
    const lines = (c.body ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length && (lines[0] === c.title || lines[0].startsWith(`${c.title}: `))) {
      const first = lines.shift()!;
      if (!sub && first !== c.title) sub = first.slice(c.title.length + 2);
    }
    const head = h('div', 'bt-tip-head', el);
    const title = h('span', 'bt-tip-title', head, c.title);
    if (c.color) title.style.color = c.color;
    if (c.hotkey) h('kbd', 'bt-kbd', head, c.hotkey);
    if (sub) h('div', 'bt-tip-sub', el, sub);
    const cost = c.cost ? costEntries(c.cost) : [];
    if (cost.length) {
      const row = h('div', 'bt-tip-cost', el);
      for (const { res, amount } of cost) {
        const item = h('span', `bt-cost-item res-${res}${c.short?.includes(res) ? ' short' : ''}`, row);
        const ic = h('i', 'bt-res-ic', item);
        setBgImage(ic, iconSrc(res, 0, 16));
        h('span', '', item, `${amount}`);
        item.title = RESOURCE_NAMES[res];
      }
    }
    if (lines.length) {
      const body = h('div', 'bt-tip-body', el);
      lines.forEach((l, i) => h('div', i === 0 ? '' : 'bt-tip-line', body, l));
    }
    if (c.lines?.length) {
      const ul = h('div', 'bt-tip-lines', el);
      for (const l of c.lines) h('div', '', ul, l);
    }
    if (c.reason) h('div', 'bt-tip-reason', el, c.reason);
    if (c.footer) h('div', 'bt-tip-footer', el, c.footer);
  }

  private position(): void {
    if (!this.target) return;
    const r = this.target.getBoundingClientRect();
    const tw = this.el.offsetWidth;
    const th = this.el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = r.top < vh / 2;
    let x = r.left + r.width / 2 - tw / 2;
    let y = below ? r.bottom + 8 : r.top - th - 8;
    x = Math.max(8, Math.min(vw - tw - 8, x));
    y = Math.max(8, Math.min(vh - th - 8, y));
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}
