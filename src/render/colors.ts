/**
 * Color helpers and team palettes for the renderer (GDD §A palette). Pure functions, no DOM.
 */
import { PALETTE } from '../data/palette';
import type { Owner } from '../sim/types';

export type RGB = [number, number, number];

const hexCache = new Map<string, RGB>();

/** Parse '#RGB' or '#RRGGBB' into an [r, g, b] triple (0-255). */
export function parseHex(hex: string): RGB {
  const hit = hexCache.get(hex);
  if (hit) return hit;
  let h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  const rgb: RGB = Number.isNaN(n) ? [255, 0, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  hexCache.set(hex, rgb);
  return rgb;
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

export function toHex(r: number, g: number, b: number): string {
  const n = (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);
  return '#' + n.toString(16).padStart(6, '0').toUpperCase();
}

/** CSS rgba() string from a hex color and alpha 0..1. */
export function rgba(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex);
  const alpha = Math.round(Math.max(0, Math.min(1, a)) * 1000) / 1000;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Linear blend of two hex colors (t = 0 → a, t = 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return toHex(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t);
}

/** Multiply the color toward black by `amt` (0.3 = 30% darker). */
export function darken(hex: string, amt: number): string {
  const [r, g, b] = parseHex(hex);
  const k = 1 - amt;
  return toHex(r * k, g * k, b * k);
}

/** Blend the color toward white by `amt`. */
export function lighten(hex: string, amt: number): string {
  return mix(hex, '#FFFFFF', amt);
}

/** Mix RGB triples into a provided output (no allocation; used by per-pixel terrain code). */
export function mixRgbInto(out: RGB, a: RGB, b: RGB, t: number): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

/** Relative luminance 0..1 (sRGB approximation; used by tests for readability checks). */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export interface TeamColors {
  owner: Owner;
  body: string;
  /** Trim / accent (player cream, enemy thorn green, neutral pale). */
  trim: string;
  outline: string;
  /** Secondary accent (Warden flame for the player, thorn green for the enemy). */
  accent: string;
  /** Body darkened 30% (building front faces, horse bodies). */
  dark: string;
  /** Body lightened (highlights). */
  light: string;
  /** Deep shade for big shapes (horses, roofs in shadow). */
  deep: string;
  /** Selection ring color for this owner. */
  ring: string;
  /** HP bar fill for this owner. */
  hp: string;
  /** Metal / weapon color tuned to the team. */
  metal: string;
  /** Wood / shaft color tuned to the team. */
  wood: string;
}

function makeTeam(owner: Owner, body: string, trim: string, outline: string, accent: string, ring: string, hp: string, metal: string, wood: string): TeamColors {
  return {
    owner,
    body,
    trim,
    outline,
    accent,
    dark: darken(body, 0.3),
    light: lighten(body, 0.35),
    deep: darken(body, 0.5),
    ring,
    hp,
    metal,
    wood,
  };
}

export const TEAM: Record<Owner, TeamColors> = {
  0: makeTeam(0, PALETTE.player.body, PALETTE.player.trim, PALETTE.player.outline, PALETTE.player.wardenFlame, PALETTE.player.selection, PALETTE.player.hpBar, '#D9D4C7', '#7A5230'),
  1: makeTeam(1, PALETTE.enemy.body, PALETTE.enemy.thorn, PALETTE.enemy.outline, PALETTE.enemy.thorn, '#E0524A', PALETTE.enemy.hpBar, '#B9C7A0', '#4A2E3E'),
  2: makeTeam(2, PALETTE.neutral.body, PALETTE.neutral.accent, PALETTE.neutral.outline, '#F2C14E', '#E8D25A', '#E8D25A', '#D8E2E6', '#6B5A48'),
};

export function teamColors(owner: Owner): TeamColors {
  return TEAM[owner] ?? TEAM[2];
}

/** Selection ring color: green own, red enemy, yellow neutral (§O / task spec). */
export function selectionColor(owner: Owner): string {
  return owner === 0 ? PALETTE.player.selection : owner === 1 ? '#E0524A' : '#E8D25A';
}

/** HP bar fill: player green, enemy red, neutral pale yellow. */
export function hpBarColor(owner: Owner): string {
  return owner === 0 ? PALETTE.player.hpBar : owner === 1 ? PALETTE.enemy.hpBar : '#E8D25A';
}

/** Resource colors (§A Resources). */
export const RES_COLOR = {
  grain: PALETTE.resource.grain,
  timber: PALETTE.resource.timber,
  ember: PALETTE.resource.ember,
} as const;

/** Floating "+10" text color per resource; Timber's brown is lifted so it reads on grass. */
export const RES_TEXT_COLOR = {
  grain: '#F2D45C',
  timber: '#D9A066',
  ember: '#FF8A4A',
} as const;
