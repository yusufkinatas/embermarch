/**
 * Tiny DOM helpers for the battle HUD. Writes are diffed against a per-element cache so the
 * 10 Hz HUD refresh never touches the DOM (or forces layout) when nothing changed.
 */

type Cache = Record<string, string>;
const cache = new WeakMap<Element, Cache>();

function cacheOf(el: Element): Cache {
  let c = cache.get(el);
  if (!c) {
    c = {};
    cache.set(el, c);
  }
  return c;
}

/** Create an element with an optional class list, parent and text. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  parent?: Element | null,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

export function setText(el: Element, text: string): void {
  const c = cacheOf(el);
  if (c.text === text) return;
  c.text = text;
  el.textContent = text;
}

export function setStyle(el: HTMLElement | SVGElement, prop: string, value: string): void {
  const c = cacheOf(el);
  const key = `s:${prop}`;
  if (c[key] === value) return;
  c[key] = value;
  el.style.setProperty(prop, value);
}

export function setAttr(el: Element, name: string, value: string | null): void {
  const c = cacheOf(el);
  const key = `a:${name}`;
  const v = value ?? '\u0000';
  if (c[key] === v) return;
  c[key] = v;
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

export function toggleClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function setHidden(el: HTMLElement, hidden: boolean): void {
  toggleClass(el, 'bt-hidden', hidden);
}

/** Set an element's background image to an icon URL (diffed). Empty url clears it. */
export function setBgImage(el: HTMLElement, url: string): void {
  setStyle(el, 'background-image', url ? `url("${url}")` : 'none');
  toggleClass(el, 'has-img', !!url);
}

/** Set innerHTML from trusted, internal markup (glyph SVGs), diffed. */
export function setHtml(el: Element, html: string): void {
  const c = cacheOf(el);
  if (c.html === html) return;
  c.html = html;
  el.innerHTML = html;
}

/** Percentage width style for bars (0..1). */
export function setBar(el: HTMLElement, frac: number): void {
  const f = Number.isFinite(frac) ? Math.max(0, Math.min(1, frac)) : 0;
  setStyle(el, 'transform', `scaleX(${f.toFixed(3)})`);
}

export function clearChildren(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
  cache.delete(el);
}
