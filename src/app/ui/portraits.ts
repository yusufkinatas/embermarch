/**
 * Unit / building portraits for DOM screens. Uses the renderer's procedural iconUrl and falls back
 * to a simple heraldic roundel if the renderer is unavailable.
 */
import { iconUrl } from '../../render/icons';
import type { IconKind } from '../../game/types';
import { PLAYER, type CarriedUnit, type Owner } from '../../sim/types';
import { UNITS } from '../../data/units';
import { BUILDINGS } from '../../data/buildings';
import { RANK_NAMES } from '../../data/text';
import { h } from '../dom';
import { chevron } from './glyphs';

const cache = new Map<string, string>();

function fallbackUrl(kind: IconKind, owner: Owner): string {
  const unit = (UNITS as Record<string, { name: string } | undefined>)[kind];
  const bld = (BUILDINGS as Record<string, { name: string } | undefined>)[kind];
  const name = unit?.name ?? bld?.name ?? String(kind);
  const letter = name.replace(/^The /, '').charAt(0).toUpperCase();
  const body = owner === PLAYER ? '#E8A33D' : owner === 1 ? '#7B3FA0' : '#8FA3AD';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="34" r="22" fill="#2B1D0E"/><circle cx="32" cy="32" r="21" fill="${body}" stroke="#2B1D0E" stroke-width="3"/>` +
    `<text x="32" y="41" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="26" fill="#2B1D0E">${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Data URL for a portrait, cached. Never throws. */
export function portraitUrl(kind: IconKind, owner: Owner = PLAYER, size = 64): string {
  const key = `${kind}|${owner}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let url: string;
  try {
    url = iconUrl(kind, owner, size);
    if (typeof url !== 'string' || url.length === 0) throw new Error('empty icon');
  } catch {
    url = fallbackUrl(kind, owner);
    // Do not cache the fallback forever: the renderer may finish loading later in dev.
    return url;
  }
  cache.set(key, url);
  return url;
}

export function portrait(kind: IconKind, opts: { size?: 'sm' | 'md' | 'lg'; rank?: number; owner?: Owner } = {}): HTMLElement {
  const size = opts.size ?? 'md';
  const px = size === 'lg' ? 96 : size === 'sm' ? 48 : 64;
  const rank = opts.rank ?? 0;
  const el = h(
    'span',
    { class: `portrait ${size === 'md' ? '' : size} ${rank >= 3 ? 'rank-3' : ''}`.trim() },
    h('img', { src: portraitUrl(kind, opts.owner ?? PLAYER, px), alt: '', draggable: 'false' }),
  );
  if (rank > 0) el.appendChild(rankChevrons(rank));
  return el;
}

export function rankChevrons(rank: number): HTMLElement {
  const wrap = h('span', { class: `chevrons ${rank >= 3 ? 'r3' : ''}`.trim() });
  for (let i = 0; i < rank; i++) wrap.appendChild(chevron());
  return wrap;
}

export function unitName(type: string): string {
  return (UNITS as Record<string, { name: string } | undefined>)[type]?.name ?? type;
}

/** "Bowman" -> "Bowmen", "Ashpike" -> "Ashpikes". */
export function unitPlural(type: string, n: number): string {
  const name = unitName(type);
  if (n === 1) return name;
  return name.endsWith('man') ? `${name.slice(0, -3)}men` : `${name}s`;
}

export function rankName(rank: number): string {
  return RANK_NAMES[rank] ?? `Rank ${rank}`;
}

/** Compact chip for a carried unit: portrait, name, rank and kills. */
export function unitChip(u: CarriedUnit, opts: { sellsword?: boolean } = {}): HTMLElement {
  return h(
    'span',
    { class: `unit-chip ${opts.sellsword ? 'sellsword' : ''}`.trim() },
    portrait(u.type, { size: 'sm', rank: u.rank }),
    h(
      'span',
      { class: 'meta' },
      h('span', { class: 'name' }, unitName(u.type)),
      h('span', { class: 'sub' }, `${rankName(u.rank)} · ${u.kills} ${u.kills === 1 ? 'kill' : 'kills'}${opts.sellsword ? ' · Sellsword' : ''}`),
    ),
  );
}
