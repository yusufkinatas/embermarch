/**
 * Display helpers for screens (names and descriptions straight from the data tables).
 */
import { BOONS, DRAFTS, RARITY_NAMES, TAG_NAMES, UNITS } from '../data';
import type { BoonTag, Rarity } from '../data';
import type { BoonId, DraftId, PlayerUnitId } from '../sim/types';

export interface BoonInfo {
  name: string;
  desc: string;
  /** 'Common' | 'Rare' | 'Mythic'. */
  rarity: string;
  /** Display tag names, e.g. 'Economy', 'Pike'. */
  tags: string[];
  /** 'Stat' | 'Rule'. */
  kind: string;
  /** Rarity id 'C' | 'R' | 'M' (for colors). */
  rarityId: Rarity;
  tagIds: BoonTag[];
  /** 'base' | 'codex_1' | 'codex_2' | 'codex_3'. */
  pool: string;
}

export function boonInfo(id: BoonId): BoonInfo {
  const b = BOONS[id];
  return {
    name: b.name,
    desc: b.desc,
    rarity: RARITY_NAMES[b.rarity],
    tags: b.tags.map((t) => TAG_NAMES[t]),
    kind: b.kind === 'rule' ? 'Rule' : 'Stat',
    rarityId: b.rarity,
    tagIds: [...b.tags],
    pool: b.pool,
  };
}

export interface DraftInfo {
  name: string;
  desc: string;
  /** Unit display names. */
  units: string[];
  unitIds: PlayerUnitId[];
  tagIds: BoonTag[];
}

export function draftInfo(id: DraftId): DraftInfo {
  const d = DRAFTS[id];
  return {
    name: d.name,
    desc: d.desc,
    units: d.units.map((u) => UNITS[u].name),
    unitIds: [...d.units],
    tagIds: [...d.tags],
  };
}
