/**
 * One shared floating tooltip. attach(el, content) shows it on hover, positioned beside the
 * pointer and clamped to the viewport.
 */
import { h, setChildren, type Child } from '../dom';

export type TooltipContent = Child | (() => Child);

export interface TooltipOptions {
  /**
   * 'target': keep the tooltip inside the target's horizontal span (no wider than the target), so
   * a card's tooltip never lands on the neighbouring card in a row of cards.
   */
  clamp?: 'target';
}

export class Tooltips {
  private readonly el: HTMLDivElement;
  private current: Element | null = null;
  private clampTo: Element | null = null;

  constructor(host: HTMLElement) {
    this.el = h('div', { class: 'tooltip', role: 'tooltip' });
    host.appendChild(this.el);
  }

  attach(target: Element, content: TooltipContent, opts: TooltipOptions = {}): void {
    target.addEventListener('pointerenter', (e) => this.show(target, content, e as PointerEvent, opts));
    target.addEventListener('pointermove', (e) => {
      if (this.current === target) this.place((e as PointerEvent).clientX, (e as PointerEvent).clientY);
    });
    target.addEventListener('pointerleave', () => {
      if (this.current === target) this.hide();
    });
  }

  show(target: Element, content: TooltipContent, e?: PointerEvent, opts: TooltipOptions = {}): void {
    this.current = target;
    this.clampTo = opts.clamp === 'target' ? target : null;
    this.el.style.maxWidth = this.clampTo ? `${Math.max(160, Math.floor(target.getBoundingClientRect().width) - 8)}px` : '';
    setChildren(this.el, typeof content === 'function' ? content() : content);
    this.el.classList.add('show');
    if (e) this.place(e.clientX, e.clientY);
    else {
      const r = target.getBoundingClientRect();
      this.place(r.right, r.top + r.height / 2);
    }
  }

  hide(): void {
    this.current = null;
    this.clampTo = null;
    this.el.classList.remove('show');
  }

  private place(x: number, y: number): void {
    const pad = 14;
    const w = this.el.offsetWidth;
    const hgt = this.el.offsetHeight;
    let left = x + pad;
    let top = y + pad;
    if (left + w > window.innerWidth - 8) left = x - w - pad;
    if (top + hgt > window.innerHeight - 8) top = y - hgt - pad;
    if (this.clampTo) {
      const r = this.clampTo.getBoundingClientRect();
      left = Math.min(Math.max(left, r.left + 4), r.right - 4 - w);
    }
    this.el.style.left = `${Math.max(8, left)}px`;
    this.el.style.top = `${Math.max(8, top)}px`;
  }
}

/** Helpers to build consistent tooltip bodies. */
export function ttTitle(text: string): HTMLElement {
  return h('div', { class: 'tt-title' }, text);
}
export function ttSub(text: string): HTMLElement {
  return h('div', { class: 'tt-sub' }, text);
}
export function ttRow(label: string, ...value: Child[]): HTMLElement {
  return h('div', { class: 'tt-row' }, h('b', null, label), h('span', null, ...value));
}
export function ttRule(): HTMLElement {
  return h('hr');
}
