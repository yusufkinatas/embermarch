/**
 * Shared card builders: Boons, Drafts and unit stat blocks, plus their tooltip bodies.
 * Display data comes straight from the data tables (single source of truth).
 */
import type { BoonId, DraftId, PlayerUnitId, Cost } from '../../sim/types';
import type { BoonDef, Rarity } from '../../data/types';
import { BOONS } from '../../data/boons';
import { DRAFTS } from '../../data/drafts';
import { UNITS } from '../../data/units';
import { BUILDINGS } from '../../data/buildings';
import { CLASS_NAMES, RARITY_NAMES, TAG_NAMES } from '../../data/text';
import { h, type Child } from '../dom';
import { glyph, RESOURCE_GLYPH, TAG_GLYPH, divider } from './glyphs';
import { portrait } from './portraits';
import { ttRow, ttSub, ttTitle } from './tooltip';

export function boonDef(id: BoonId): BoonDef {
  return BOONS[id];
}

export function rarityOf(id: BoonId): Rarity {
  return BOONS[id]?.rarity ?? 'C';
}

export function kindLabel(kind: 'stat' | 'rule'): string {
  return kind === 'rule' ? 'Rule' : 'Stat';
}

export function tagChip(tag: keyof typeof TAG_GLYPH): HTMLElement {
  return h('span', { class: 'tag' }, glyph(TAG_GLYPH[tag]), TAG_NAMES[tag] ?? tag);
}

/** Round medallion with the Boon's lead tag glyph, ringed in its rarity color. */
export function boonCrest(id: BoonId, size: 'md' | 'lg' = 'lg'): HTMLElement {
  const def = BOONS[id];
  const tag = def?.tags[0] ?? 'Econ';
  return h('span', { class: `crest crest-${size} rarity-${def?.rarity ?? 'C'}` }, glyph(TAG_GLYPH[tag]));
}

export function boonCard(id: BoonId, opts: { compact?: boolean } = {}): HTMLElement {
  const def = BOONS[id];
  return h(
    'div',
    { class: `card boon-card rarity-${def.rarity} ${opts.compact ? 'compact' : ''}`.trim() },
    h('div', { class: 'card-band' }),
    boonCrest(id),
    h('div', { class: 'card-name' }, def.name),
    h(
      'div',
      { class: 'card-meta' },
      h('span', { class: 'rarity-label' }, RARITY_NAMES[def.rarity]),
      h('span', { class: `tag kind-${def.kind}` }, kindLabel(def.kind)),
    ),
    h('div', { class: 'card-tags' }, def.tags.map((t) => tagChip(t))),
    divider('narrow'),
    h('div', { class: 'card-desc' }, def.desc),
  );
}

export function boonTooltip(id: BoonId): Child {
  const def = BOONS[id];
  return [
    ttTitle(def.name),
    ttSub(`${RARITY_NAMES[def.rarity]} · ${kindLabel(def.kind)} · ${def.tags.map((t) => TAG_NAMES[t]).join(', ')}`),
    h('div', null, def.desc),
  ];
}

export function costLine(cost: Cost): HTMLElement {
  const parts: Child[] = [];
  for (const res of ['grain', 'timber', 'ember'] as const) {
    const v = cost[res];
    if (!v) continue;
    parts.push(h('span', { class: `cost cost-${res}` }, glyph(RESOURCE_GLYPH[res]), String(v)));
  }
  if (parts.length === 0) parts.push(h('span', { class: 'dim' }, 'Free'));
  return h('span', { class: 'cost-line' }, parts);
}

export function unitStatBlock(type: PlayerUnitId): HTMLElement {
  const u = UNITS[type];
  const rows: [string, string][] = [
    ['HP', String(u.hp)],
    ['ATK', u.cooldown > 0 ? `${u.atk} / ${u.cooldown}s` : '—'],
    ['Range', u.range >= 1.5 ? String(u.range) : u.aura ? `aura ${u.aura.radius}` : 'Melee'],
    ['Armor', String(u.armor)],
    ['Speed', String(u.speed)],
    ['Pop', String(u.pop)],
  ];
  return h(
    'div',
    { class: 'unit-stats' },
    h(
      'div',
      { class: 'us-head' },
      portrait(type, { size: 'lg' }),
      h(
        'div',
        { class: 'col', style: 'gap:.2rem' },
        h('div', { class: 'us-name' }, u.name),
        h('div', { class: 'us-role' }, `${u.role} · ${CLASS_NAMES[u.cls]}`),
        costLine(u.cost),
      ),
    ),
    h(
      'div',
      { class: 'us-grid' },
      rows.map(([k, v]) => h('div', { class: 'us-cell' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v))),
    ),
    u.strongVs.length || u.weakVs.length
      ? h(
          'div',
          { class: 'us-vs' },
          u.strongVs.length ? h('span', { class: 'good' }, `Strong vs ${u.strongVs.map((c) => CLASS_NAMES[c]).join(', ')}`) : null,
          u.weakVs.length ? h('span', { class: 'bad' }, `Weak vs ${u.weakVs.map((c) => CLASS_NAMES[c]).join(', ')}`) : null,
        )
      : null,
  );
}

export function draftCard(id: DraftId): HTMLElement {
  const d = DRAFTS[id];
  const unlocks: string[] = [...d.units.map((u) => UNITS[u].name), ...d.buildings.map((b) => BUILDINGS[b].name)];
  return h(
    'div',
    { class: 'card draft-card' },
    h('div', { class: 'card-band' }),
    h('div', { class: 'eyebrow center' }, 'Unit Draft'),
    h('div', { class: 'card-name' }, d.name),
    h('div', { class: 'card-sub' }, `Unlocks ${unlocks.join(' + ')}`),
    h('div', { class: 'card-tags' }, d.tags.map((t) => tagChip(t))),
    d.units.map((u) => unitStatBlock(u)),
    h('div', { class: 'card-desc' }, d.desc),
  );
}

export function draftTooltip(id: DraftId): Child {
  const d = DRAFTS[id];
  return [ttTitle(d.name), ttSub(`Draft · ${d.tags.map((t) => TAG_NAMES[t]).join(', ')}`), h('div', null, d.desc)];
}

export function unitTooltip(type: PlayerUnitId, extra?: Child): Child {
  const u = UNITS[type];
  return [
    ttTitle(u.name),
    ttSub(`${u.role} · ${CLASS_NAMES[u.cls]}`),
    h('div', null, u.desc),
    ttRow('Stats', `HP ${u.hp} · ATK ${u.atk} · Armor ${u.armor} · Speed ${u.speed}`),
    u.strongVs.length ? ttRow('Strong', u.strongVs.map((c) => CLASS_NAMES[c]).join(', ')) : null,
    u.weakVs.length ? ttRow('Weak', u.weakVs.map((c) => CLASS_NAMES[c]).join(', ')) : null,
    extra ?? null,
  ];
}

/** Card back face used by the flip-in ceremony. */
export function cardBack(): HTMLElement {
  return h('div', { class: 'card-back' }, h('div', { class: 'cb-sigil' }, glyph('flame')), h('div', { class: 'cb-ring' }));
}
