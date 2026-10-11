/**
 * Center-screen overlays: the Kindle countdown (3 · 2 · 1 · Kindle!), the victory / defeat banner
 * with rising embers, the active-pause label, and the notice / error line above the bottom panel.
 */
import { TEXT } from '../../data/text';
import { h, setHidden, setText, toggleClass } from '../dom';

export class Countdown {
  readonly el: HTMLDivElement;
  private readonly num: HTMLElement;
  private shown = '';
  private kindledAt = -1;

  constructor(parent: HTMLElement) {
    this.el = h('div', 'bt-countdown bt-hidden', parent);
    this.num = h('div', 'bt-countdown-num', this.el);
  }

  /**
   * countdown = world.countdown (s); now = real time; simTime = world.time. "Kindle!" holds for
   * 1.2 s of real time, but never once the battle clock is past 1.5 s (fast-forward, debug step).
   */
  update(countdown: number, now: number, simTime = 0): void {
    let label = '';
    if (countdown > 0) {
      label = String(Math.max(1, Math.ceil(countdown - 1e-6)));
      this.kindledAt = -1;
    } else if (this.shown !== '' || this.kindledAt >= 0) {
      if (this.kindledAt < 0) this.kindledAt = now;
      label = now - this.kindledAt < 1.2 && simTime < 1.5 ? TEXT.kindle : '';
    }
    if (label !== this.shown) {
      this.shown = label;
      setText(this.num, label);
      toggleClass(this.el, 'kindle', label === TEXT.kindle);
      this.num.classList.remove('pop');
      void this.num.offsetWidth;
      if (label) this.num.classList.add('pop');
    }
    setHidden(this.el, !label);
  }

  /** Begin showing (battle mounted with countdown > 0). */
  reset(): void {
    this.shown = '';
    this.kindledAt = -1;
  }
}

export class Banner {
  readonly el: HTMLDivElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = h('div', 'bt-banner bt-hidden', parent);
    const embers = h('div', 'bt-embers', this.el);
    for (let i = 0; i < 26; i++) {
      const s = h('i', '', embers);
      s.style.setProperty('--x', `${Math.round(Math.random() * 100)}%`);
      s.style.setProperty('--d', `${(1.6 + Math.random() * 2.2).toFixed(2)}s`);
      s.style.setProperty('--delay', `${(Math.random() * 1.6).toFixed(2)}s`);
      s.style.setProperty('--s', `${(0.6 + Math.random() * 0.9).toFixed(2)}`);
    }
    const plate = h('div', 'bt-banner-plate', this.el);
    this.title = h('div', 'bt-banner-title', plate);
    this.sub = h('div', 'bt-banner-sub', plate);
  }

  show(outcome: 'victory' | 'defeat' | 'retreat', sub: string): void {
    setText(this.title, outcome === 'victory' ? 'Victory' : outcome === 'defeat' ? 'Defeat' : 'Retreat');
    setText(this.sub, sub);
    this.el.classList.remove('victory', 'defeat', 'retreat');
    this.el.classList.add(outcome);
    setHidden(this.el, false);
  }

  get visible(): boolean {
    return !this.el.classList.contains('bt-hidden');
  }
}

export class PausedLabel {
  readonly el: HTMLDivElement;
  constructor(parent: HTMLElement) {
    this.el = h('div', 'bt-paused bt-hidden', parent);
    h('div', 'bt-paused-title', this.el, 'Paused');
    h('div', 'bt-paused-sub', this.el, 'Orders are still accepted · F2 to resume');
  }
  update(paused: boolean): void {
    setHidden(this.el, !paused);
  }
}

/** Short-lived message line above the command area (errors red, notices pale). */
export class NoticeLine {
  readonly el: HTMLDivElement;
  private until = 0;

  constructor(parent: HTMLElement) {
    this.el = h('div', 'bt-notice bt-hidden', parent);
  }

  show(text: string, kind: 'error' | 'info', now: number): void {
    setText(this.el, text);
    toggleClass(this.el, 'error', kind === 'error');
    this.el.classList.remove('flash');
    void this.el.offsetWidth;
    this.el.classList.add('flash');
    setHidden(this.el, false);
    this.until = now + (kind === 'error' ? 2.2 : 1.8);
  }

  /** `suppressed`: the victory / defeat banner is up, so the callout must not sit on top of it. */
  update(now: number, suppressed = false): void {
    if (this.until && (now > this.until || suppressed)) {
      this.until = 0;
      setHidden(this.el, true);
    }
  }
}

/** Brief center callout for dramatic beats (Last Stand, the Regent uprooted). */
export class Callout {
  readonly el: HTMLDivElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private until = 0;

  constructor(parent: HTMLElement) {
    this.el = h('div', 'bt-callout bt-hidden', parent);
    this.title = h('div', 'bt-callout-title', this.el);
    this.sub = h('div', 'bt-callout-sub', this.el);
  }

  show(title: string, sub: string, now: number, tone: 'ember' | 'thorn' = 'ember'): void {
    setText(this.title, title);
    setText(this.sub, sub);
    toggleClass(this.el, 'thorn', tone === 'thorn');
    this.el.classList.remove('enter');
    void this.el.offsetWidth;
    this.el.classList.add('enter');
    setHidden(this.el, false);
    this.until = now + 2.6;
  }

  /** `suppressed`: the victory / defeat banner is up, so the callout must not sit on top of it. */
  update(now: number, suppressed = false): void {
    if (this.until && (now > this.until || suppressed)) {
      this.until = 0;
      setHidden(this.el, true);
    }
  }
}
