/**
 * Camp: Rest / Drill / Muster cards, then the outcome and Continue (Muster queues a Draft pick).
 */
import type { AppCtx, ScreenHandle } from '../types';
import { CAMP } from '../../data/balance';
import { CAMP_TEXT } from '../../data/text';
import { DRAFTS } from '../../data/drafts';
import { h, setChildren } from '../dom';
import { divider, glyph, type GlyphName } from '../ui/glyphs';
import { runHeader, resolvePips } from '../ui/header';
import { plate } from '../ui/illustrations';
import { portrait, rankName, unitName } from '../ui/portraits';
import { leaveIfOpen } from './common';

type CampChoice = 'rest' | 'drill' | 'muster';

export function mountCamp(app: AppCtx): ScreenHandle {
  const run = app.run;
  if (!run) {
    queueMicrotask(() => app.go({ screen: 'title' }));
    return { el: h('div', { class: 'scr' }) };
  }
  const header = runHeader(app);
  let chosen = false;

  const restDetail = h(
    'div',
    { class: 'camp-detail col', style: 'gap:.25rem' },
    h('span', { class: 'label-caps' }, 'Resolve'),
    resolvePips(run.resolve, run.maxResolve),
  );
  const drillDetail = h('div', { class: 'camp-detail col', style: 'gap:.3rem;align-items:center' });
  if (run.retinue.length) {
    const row = h('div', { class: 'row wrap', style: 'justify-content:center;gap:.6rem' });
    for (const u of run.retinue.slice(0, 8)) {
      const p = portrait(u.type, { size: 'sm', rank: Math.min(3, u.rank + 1) });
      app.tooltips.attach(p, `${unitName(u.type)}: ${rankName(u.rank)} → ${rankName(Math.min(3, u.rank + 1))}`);
      row.appendChild(p);
    }
    drillDetail.append(row, h('span', { class: 'good small' }, `${run.retinue.length} veterans rise a Rank`));
  } else {
    drillDetail.append(
      h('div', { class: 'row', style: 'gap:.4rem' }, portrait(CAMP.drillEmptyUnit, { size: 'sm', rank: CAMP.drillEmptyRank }), portrait(CAMP.drillEmptyUnit, { size: 'sm', rank: CAMP.drillEmptyRank })),
      h('span', { class: 'good small' }, `${CAMP.drillEmptyCount} ${rankName(CAMP.drillEmptyRank)} ${unitName(CAMP.drillEmptyUnit)}s join as Sellswords`),
    );
  }
  const musterDetail = h(
    'div',
    { class: 'camp-detail col', style: 'gap:.25rem' },
    h('span', { class: 'label-caps' }, 'Drafted so far'),
    h('span', { class: 'small' }, run.drafts.length ? run.drafts.map((d) => DRAFTS[d]?.name ?? d).join(', ') : h('span', { class: 'dim italic' }, 'none yet')),
  );

  const options: { id: CampChoice; icon: GlyphName; detail: HTMLElement }[] = [
    { id: 'rest', icon: 'campfire', detail: restDetail },
    { id: 'drill', icon: 'chevrons', detail: drillDetail },
    { id: 'muster', icon: 'muster', detail: musterDetail },
  ];

  const area = h('div', { class: 'camp-row' });
  const finish = (text: string): void => {
    const cont = h(
      'button',
      {
        class: 'btn primary lg',
        onclick: () => {
          app.click();
          leaveIfOpen(app);
          app.advance();
        },
      },
      'Break camp',
      glyph('next'),
    );
    setChildren(area, h('div', { class: 'event-outcome camp-outcome' }, h('div', { class: 'eo-mark' }, glyph('campfire')), h('p', null, text)), h('div', { class: 'event-actions' }, cont));
  };

  const resolved = app.guard('campOptions', () => app.api.campOptions(run, app.meta)) ?? [];
  for (const o of options) {
    const opt = resolved.find((r) => r.id === o.id);
    const text = { label: opt?.label ?? CAMP_TEXT[o.id].label, desc: opt?.desc ?? CAMP_TEXT[o.id].desc };
    const card = h(
      'div',
      { class: `card camp-card clickable camp-${o.id}`, role: 'button', tabindex: '0' },
      h('span', { class: 'crest crest-lg' }, glyph(o.icon)),
      h('div', { class: 'card-name' }, text.label),
      h('div', { class: 'card-desc center' }, text.desc),
      divider('narrow'),
      o.detail,
    );
    const pick = (): void => {
      if (chosen || !app.run) return;
      chosen = true;
      app.click();
      const out = app.guard('chooseCamp', () => app.api.chooseCamp(app.run!, app.meta, o.id));
      if (!out) {
        chosen = false;
        return;
      }
      header.update();
      finish(out.text);
    };
    card.addEventListener('click', pick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick();
      }
    });
    area.appendChild(card);
  }

  const el = h(
    'div',
    { class: 'scr camp-scr' },
    header.el,
    h(
      'div',
      { class: 'scr-body camp-body' },
      h('div', { class: 'plate plate-wide' }, plate('camp'), h('div', { class: 'plate-title' }, h('div', { class: 'eyebrow' }, 'A night by the fire'), h('h1', { class: 'display h1' }, 'Camp'))),
      h('div', { class: 'small muted center' }, 'The Hearthband rests on the Ember Road. Choose how to spend the night.'),
      area,
    ),
  );
  return { el };
}
