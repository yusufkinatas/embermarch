/**
 * HUD glyphs: small inline SVG symbols (classes, Boon tags, command actions, UI chrome) plus a
 * guarded wrapper around the renderer's procedural icon cache. Glyphs use `currentColor`.
 */
import type { BoonTag } from '../data/types';
import { BUILDING_IDS, UNIT_IDS } from '../data/ids';
import { EXTRA_ICON_KEYS, iconUrl } from '../render/icons';
import type { IconKind } from './types';
import type { Owner, UnitClass } from '../sim/types';

const svg = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${extra}>${body}</svg>`;

const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const GLYPHS = {
  // Unit classes (Strong / Weak vs, Counter Wheel)
  infantry: svg(`<path fill="currentColor" d="M12 1.5l3.2 5.3h-2.1V22h-2.2V6.8H8.8z"/><path ${STROKE} d="M8 11h8"/>`),
  ranged: svg(`<path ${STROKE} d="M7 3c7 3 7 15 0 18"/><path ${STROKE} stroke-width="1.4" d="M7 3v18"/><path ${STROKE} d="M4 12h15m-3-3l3 3-3 3"/>`),
  cavalry: svg(`<path fill="currentColor" d="M5 21V11a7 7 0 0 1 14 0v10h-3.4V11a3.6 3.6 0 0 0-7.2 0v10z"/><circle cx="7" cy="18" r=".9" fill="#1a1612"/><circle cx="17" cy="18" r=".9" fill="#1a1612"/>`),
  siege: svg(`<path fill="currentColor" d="M2.5 9h13.5l5.5 3.5-5.5 3.5H2.5z"/><circle cx="6" cy="19" r="2.2" fill="currentColor"/><circle cx="13" cy="19" r="2.2" fill="currentColor"/>`),
  worker: svg(`<path fill="currentColor" d="M4 4.5h11l2.5 3.5H4z"/><path fill="currentColor" d="M9 8h2.4v13.5H9z"/>`),
  hero: svg(`<path fill="currentColor" d="M3 19l1.2-12 4.8 5 3-7.5 3 7.5 4.8-5L21 19z"/><path fill="currentColor" d="M3 20.5h18V22H3z"/>`),
  boss: svg(`<path fill="currentColor" d="M2 20l1.8-13 4.2 5 1.6-8 2.4 6 2.4-6 1.6 8 4.2-5L22 20z"/>`),
  // Boon tags
  econ: svg(`<path ${STROKE} d="M12 22V7"/><path fill="currentColor" d="M12 7c-2-1-3-3-2.5-5 2 .7 3 2.6 2.5 5zm0 0c2-1 3-3 2.5-5-2 .7-3 2.6-2.5 5zM12 12c-2.4-.6-4-2.4-4-4.6 2.3.3 4 2.2 4 4.6zm0 0c2.4-.6 4-2.4 4-4.6-2.3.3-4 2.2-4 4.6zM12 17c-2.4-.6-4-2.4-4-4.6 2.3.3 4 2.2 4 4.6zm0 0c2.4-.6 4-2.4 4-4.6-2.3.3-4 2.2-4 4.6z"/>`),
  ember: svg(`<path fill="currentColor" d="M12 1.5c1.2 4.2 6.5 6.4 6.5 12.5a6.5 6.5 0 0 1-13 0c0-3.2 1.8-5.3 3.2-6.4.1 2.1 1.1 3.3 2.2 3.5-.4-3.6.1-6.8 1.1-9.6z"/>`),
  fort: svg(`<path fill="currentColor" d="M4 22V9h2.5V5.5H9V9h1.8V5.5h2.4V9H15V5.5h2.5V9H20v13h-5.3v-5a2.7 2.7 0 0 0-5.4 0v5z"/>`),
  veteran: svg(`<path fill="currentColor" d="M3.5 10.5L12 5l8.5 5.5v3.2L12 8.2l-8.5 5.5zM3.5 17.3L12 11.8l8.5 5.5v3.2L12 15l-8.5 5.5z"/>`),
  // Commands / abilities
  research: svg(`<path ${STROKE} d="M6 3h10.5A2.5 2.5 0 0 1 19 5.5V21H7.5A2.5 2.5 0 0 1 5 18.5V4z"/><path ${STROKE} d="M9 8h6.5M9 12h6.5M9 16h4"/>`),
  temper: svg(`<path fill="currentColor" d="M3 7h13.5c.3 2.8 2.2 4 4.5 4.2V14h-6.2l2 4.5H6.8l2-4.5H6.2C5.4 10.6 3.6 9.6 3 7z"/>`),
  rally: svg(`<path fill="currentColor" d="M5 2.5h2.2V22H5z"/><path fill="currentColor" d="M7.2 3.5H19l-3.2 4.2 3.2 4.3H7.2z"/>`),
  demolish: svg(`<path fill="currentColor" d="M3 6.5l5-3.5 3 2.2-1.6 1.6 10.9 10.9-2.2 2.2L7.2 9 5.6 10.6z"/><path ${STROKE} d="M15 4l5 5M20 4l-5 5"/>`),
  horn: svg(`<path fill="currentColor" d="M2.5 9.5L15 4v16L2.5 14.5z"/><path ${STROKE} d="M18 8.5a5 5 0 0 1 0 7M20.5 6a8.5 8.5 0 0 1 0 12"/>`),
  hymn: svg(`<path fill="currentColor" d="M9 18.5A2.8 2.8 0 1 1 7.6 16V4.5l11-2.5v13.3a2.8 2.8 0 1 1-1.6-2.5V6.2L9 8z"/>`),
  firepot: svg(`<path fill="currentColor" d="M6 11h12a6 6 0 0 1-12 0zM9 9h6V7.5H9z"/><path fill="currentColor" d="M12 1c.8 2 2.5 2.6 2.5 4.4A2.5 2.5 0 0 1 9.5 5.4c0-1 .5-1.6 1-2 .1.9.6 1.4 1 1.4-.2-1.4 0-2.6.5-3.8z"/>`),
  volley: svg(`<path ${STROKE} d="M3 20L19 4m-6 0h6v6M3 14l9-9M9 20l9-9"/>`),
  hawk: svg(`<path fill="currentColor" d="M1.5 12C5.5 5.5 18.5 5.5 22.5 12c-4 6.5-17 6.5-21 0z"/><circle cx="12" cy="12" r="3.4" fill="#1a1612"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>`),
  rallyHearth: svg(`<path fill="currentColor" d="M12 2c1 3.4 5 5 5 9.6a5 5 0 0 1-10 0c0-2.4 1.4-4 2.4-4.8.1 1.6.9 2.5 1.7 2.7-.3-2.8.1-5.3.9-7.5z"/><path ${STROKE} d="M3 21h18M6 21v-3M18 21v-3"/>`),
  attackMove: svg(`<path ${STROKE} d="M4 20L20 4M14 4h6v6M4 4l6 6"/>`),
  stop: svg(`<path fill="currentColor" d="M8.2 2.5h7.6l5.7 5.7v7.6l-5.7 5.7H8.2l-5.7-5.7V8.2z"/><path fill="#1a1612" d="M7 10.8h10v2.4H7z"/>`),
  hold: svg(`<path fill="currentColor" d="M12 2l8 3.2v6.3c0 5-3.4 8.8-8 10.5-4.6-1.7-8-5.5-8-10.5V5.2z"/><path fill="#1a1612" d="M11 7h2v9h-2zM8 12h8v2H8z"/>`),
  // UI chrome
  pause: svg(`<path fill="currentColor" d="M6 4h4.2v16H6zM13.8 4H18v16h-4.2z"/>`),
  play: svg(`<path fill="currentColor" d="M7 4l13 8-13 8z"/>`),
  menu: svg(`<path fill="currentColor" d="M3 5h18v2.4H3zM3 10.8h18v2.4H3zM3 16.6h18V19H3z"/>`),
  crown: svg(`<path fill="currentColor" d="M3 18l1.2-11 4.6 4.4L12 4l3.2 7.4L19.8 7 21 18z"/><path fill="currentColor" d="M3 19.4h18V21H3z"/>`),
  resolve: svg(`<path fill="currentColor" d="M12 2l8 4v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6z"/>`),
  idle: svg(`<path fill="currentColor" d="M13 3h7v1.8l-4.4 5H20V12h-7v-1.8l4.4-5H13zM4 12h5v1.4L6 17h3v1.6H4v-1.4l3-3.6H4z"/>`),
  close: svg(`<path ${STROKE} d="M6 6l12 12M18 6L6 18"/>`),
  arrowRight: svg(`<path ${STROKE} d="M3 12h16m-6-6l6 6-6 6"/>`),
} as const;

export type GlyphName = keyof typeof GLYPHS;

export const CLASS_GLYPH: Record<UnitClass, GlyphName> = {
  worker: 'worker',
  infantry: 'infantry',
  ranged: 'ranged',
  cavalry: 'cavalry',
  siege: 'siege',
  hero: 'hero',
  boss: 'boss',
};

export const TAG_GLYPH: Record<BoonTag, GlyphName> = {
  Econ: 'econ',
  Ember: 'ember',
  Fort: 'fort',
  Pike: 'infantry',
  Bow: 'ranged',
  Horse: 'cavalry',
  Siege: 'siege',
  Warden: 'hero',
  Veteran: 'veteran',
};

const ICON_KINDS = new Set<string>([
  ...UNIT_IDS,
  ...BUILDING_IDS,
  // Research, abilities (ability_<house>), commands and class badges drawn by render/icons.
  ...EXTRA_ICON_KEYS,
  'thicket',
  'ember_seam',
  'tree',
  'grain',
  'timber',
  'ember',
  'crowns',
  'resolve',
  'renown',
  'pop',
]);

export function isIconKind(s: string): s is IconKind {
  return ICON_KINDS.has(s);
}

const failed = new Set<string>();

/**
 * Renderer icon as a data URL, or '' when the icon module is unavailable (the HUD then shows a
 * glyph fallback). Never throws.
 */
export function iconSrc(kind: string, owner: Owner, size: number): string {
  if (!isIconKind(kind)) return '';
  const key = `${kind}:${owner}:${size}`;
  if (failed.has(key)) return '';
  try {
    return iconUrl(kind, owner, size) || '';
  } catch {
    failed.add(key);
    return '';
  }
}

/** Glyph for a command-card option without a renderer icon. */
export function optionGlyph(kind: string, id: string): GlyphName {
  if (id === 'rally_hearth') return 'rallyHearth';
  if (id === 'hawk') return 'hawk';
  if (kind === 'demolish') return 'demolish';
  if (kind === 'rally') return 'rally';
  if (kind === 'research') return 'research';
  return 'horn';
}
