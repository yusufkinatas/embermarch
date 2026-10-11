/**
 * Alert toast feed (left edge, GDD §O): at most 5, newest at the bottom, fading out. Clicking a
 * toast with a position jumps the camera there (Space jumps to the latest).
 */
import { AlertFeed, type AlertItem } from '../alerts';
import { h, setStyle, setText } from '../dom';
import type { HudContext } from './context';

export class AlertFeedView {
  readonly el: HTMLDivElement;
  private readonly nodes = new Map<number, { el: HTMLElement; text: HTMLElement; count: HTMLElement; stamp: string }>();

  constructor(parent: HTMLElement, private readonly ctx: HudContext, private readonly feed: AlertFeed) {
    this.el = h('div', 'bt-alerts', parent);
  }

  update(): void {
    const now = this.ctx.now;
    this.feed.expire(now);
    const live = new Set(this.feed.items.map((i) => i.id));
    for (const [id, n] of this.nodes) {
      if (!live.has(id)) {
        n.el.remove();
        this.nodes.delete(id);
      }
    }
    for (const it of this.feed.items) {
      let n = this.nodes.get(it.id);
      if (!n) {
        n = this.create(it);
        this.nodes.set(it.id, n);
      }
      const stamp = `${it.at}`;
      if (n.stamp !== stamp) {
        // Re-raised: pulse again.
        n.stamp = stamp;
        n.el.classList.remove('pulse');
        void n.el.offsetWidth;
        n.el.classList.add('pulse');
      }
      setText(n.text, it.text);
      setText(n.count, it.count > 1 ? `×${it.count}` : '');
      setStyle(n.el, 'opacity', AlertFeed.opacity(it, now).toFixed(2));
    }
    // Keep DOM order = feed order (oldest first).
    let prev: Element | null = null;
    for (const it of this.feed.items) {
      const el = this.nodes.get(it.id)!.el;
      const expected: Element | null = prev ? prev.nextElementSibling : this.el.firstElementChild;
      if (expected !== el) this.el.insertBefore(el, expected);
      prev = el;
    }
  }

  private create(it: AlertItem): { el: HTMLElement; text: HTMLElement; count: HTMLElement; stamp: string } {
    const el = h('div', `bt-alert tone-${it.tone}${it.x !== undefined ? ' has-pos' : ''}`, this.el);
    h('i', 'bt-alert-mark', el);
    const text = h('span', 'bt-alert-text', el);
    const count = h('b', 'bt-alert-count', el);
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (it.x !== undefined && it.y !== undefined) this.ctx.actions.centerOn(it.x, it.y);
    });
    return { el, text, count, stamp: '' };
  }
}
