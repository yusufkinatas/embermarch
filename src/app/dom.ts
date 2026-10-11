/**
 * Tiny DOM builder and formatting helpers for the screens (no framework).
 */

export type Child = Node | string | number | null | undefined | false | Child[];

export interface Attrs {
  class?: string;
  style?: string;
  title?: string;
  dataset?: Record<string, string>;
  /** Any other attribute (string / number / boolean) or on<event> handler. */
  [key: string]: unknown;
}

function appendChildren(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

function applyAttrs(el: Element, attrs: Attrs | null | undefined): void {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.setAttribute('class', String(v));
    else if (k === 'dataset') {
      for (const [dk, dv] of Object.entries(v as Record<string, string>)) (el as HTMLElement).dataset[dk] = dv;
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
}

/** Create an HTML element: h('div', { class: 'panel', onclick: fn }, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  appendChildren(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element. */
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs);
  appendChildren(el, children);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Replace all children of el. */
export function setChildren(el: Element, ...children: Child[]): void {
  clear(el);
  appendChildren(el, children);
}

/** m:ss */
export function fmtTime(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds + 1e-6));
  const m = Math.floor(t / 60);
  const s2 = t % 60;
  return `${m}:${s2 < 10 ? '0' : ''}${s2}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export function roman(n: number): string {
  return ROMAN[n] ?? String(n);
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}

/** Animate a number counting up inside el. Returns a cancel function. */
export function countUp(el: HTMLElement, to: number, ms = 900, from = 0, format: (n: number) => string = (n) => String(n)): () => void {
  const start = performance.now();
  let raf = 0;
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = format(Math.round(from + (to - from) * e));
    if (t < 1) raf = requestAnimationFrame(step);
  };
  el.textContent = format(from);
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/** Deterministic small hash of a string (layout jitter). */
export function hashStr(str: string): number {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) {
    x ^= str.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}
