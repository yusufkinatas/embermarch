/**
 * Peddler: stock grid with prices, Buy, Reroll Boons, Leave. Crowns shown in the header.
 */
import type { AppCtx, ScreenHandle } from '../types';
import type { PeddlerItem } from '../../run/types';
import { BOONS } from '../../data/boons';
import { DRAFTS } from '../../data/drafts';
import { RARITY_NAMES } from '../../data/text';
import { h, setChildren, type Child } from '../dom';
import { glyph } from '../ui/glyphs';
import { runHeader, crownsEl } from '../ui/header';
import { plate } from '../ui/illustrations';
import { portrait, rankName, unitPlural } from '../ui/portraits';
import { boonCrest, boonTooltip, draftTooltip, kindLabel, unitTooltip } from '../ui/cards';
import { leaveIfOpen } from './common';

function itemVisual(item: PeddlerItem): HTMLElement {
  if (item.kind === 'boon' && item.boon) return boonCrest(item.boon, 'md');
  if (item.kind === 'draft' && item.draft) {
    const d = DRAFTS[item.draft];
    return h('div', { class: 'pi-portraits' }, d.units.map((u) => portrait(u, { size: 'md' })));
  }
  if (item.kind === 'sellswords' && item.units?.length) {
    return h(
      'div',
      { class: 'pi-portraits stacked' },
      item.units.slice(0, 3).map((u) => portrait(u.type, { size: 'md', rank: u.rank })),
    );
  }
  if (item.kind === 'resolve') return h('span', { class: 'crest crest-md crest-resolve' }, glyph('flame'));
  return h('span', { class: 'crest crest-md' }, glyph('dice'));
}

function itemMeta(item: PeddlerItem): Child {
  if (item.kind === 'boon' && item.boon) {
    const def = BOONS[item.boon];
    return h('div', { class: `pi-meta rarity-text-${def.rarity}` }, `${RARITY_NAMES[def.rarity]} Boon · ${kindLabel(def.kind)}`);
  }
  if (item.kind === 'draft') return h('div', { class: 'pi-meta' }, 'Unit Draft');
  if (item.kind === 'sellswords' && item.units?.length) {
    const u = item.units[0];
    return h('div', { class: 'pi-meta' }, `Sellswords · ${rankName(u.rank)}`);
  }
  if (item.kind === 'resolve') return h('div', { class: 'pi-meta' }, 'Resolve');
  return null;
}

function itemName(item: PeddlerItem): string {
  if (item.kind === 'sellswords' && item.units?.length) {
    const u = item.units[0];
    return `${item.units.length} ${unitPlural(u.type, item.units.length)}`;
  }
  return item.label;
}

export function mountPeddler(app: AppCtx): ScreenHandle {
  const run = app.run;
  if (!run || !run.peddler) {
    queueMicrotask(() => app.advance());
    return { el: h('div', { class: 'scr' }) };
  }
  const header = runHeader(app);
  const grid = h('div', { class: 'peddler-grid' });
  const rerollBtn = h('button', { class: 'btn' });
  const purse = h('div', { class: 'peddler-purse' });

  const render = (): void => {
    const r = app.run;
    const stock = r?.peddler;
    if (!r || !stock) return;
    setChildren(purse, h('span', { class: 'label-caps' }, 'Your purse'), crownsEl(r.crowns));
    setChildren(grid);
    stock.items.forEach((item, index) => {
      if (item.kind === 'reroll') return;
      const affordable = r.crowns >= item.price;
      const pointless = item.kind === 'resolve' && r.resolve >= r.maxResolve;
      const buy = h(
        'button',
        { class: `btn sm ${item.sold ? 'ghost' : 'primary'}`, disabled: item.sold || !affordable || pointless },
        item.sold ? 'Sold' : pointless ? 'Full' : 'Buy',
      );
      if (pointless && !item.sold) app.tooltips.attach(buy, 'Your Resolve is already full.');
      const card = h(
        'div',
        { class: `card peddler-item kind-${item.kind} ${item.sold ? 'sold' : ''} ${item.boon ? `rarity-${BOONS[item.boon]?.rarity ?? 'C'}` : ''}`.trim() },
        h('div', { class: 'pi-visual' }, itemVisual(item)),
        h('div', { class: 'pi-name' }, itemName(item)),
        itemMeta(item),
        h('div', { class: 'pi-desc' }, item.boon ? BOONS[item.boon]?.desc ?? item.desc : item.desc),
        h(
          'div',
          { class: 'pi-foot' },
          h('span', { class: `crowns price ${affordable || item.sold ? '' : 'short'}` }, glyph('crown'), String(item.price)),
          buy,
        ),
        item.sold ? h('div', { class: 'pi-sold-stamp' }, 'Sold') : null,
      );
      if (item.boon) app.tooltips.attach(card, () => boonTooltip(item.boon!));
      else if (item.draft) {
        const d = DRAFTS[item.draft];
        app.tooltips.attach(card, () => [draftTooltip(item.draft!), d.units[0] ? unitTooltip(d.units[0]) : null]);
      } else if (item.units?.length) app.tooltips.attach(card, () => unitTooltip(item.units![0].type));
      if (!item.sold && !affordable && !pointless) app.tooltips.attach(buy, `You need ${item.price - r.crowns} more Crowns.`);
      buy.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!app.run) return;
        app.click();
        const res = app.guard('buyPeddlerItem', () => app.api.buyPeddlerItem(app.run!, app.meta, index));
        if (!res) return;
        if (!res.ok) {
          app.sfx('ui_error');
          app.toast(res.reason ?? 'The Peddler shakes his head.', 'bad');
          return;
        }
        app.toast(`Bought: ${item.label}`, 'good');
        header.update();
        render();
      });
      grid.appendChild(card);
    });
    const canReroll = r.crowns >= stock.rerollCost;
    rerollBtn.disabled = !canReroll;
    rerollBtn.replaceChildren(glyph('dice'), 'Reroll Boons', h('span', { class: 'crowns small' }, glyph('crown'), String(stock.rerollCost)));
  };

  rerollBtn.addEventListener('click', () => {
    if (!app.run) return;
    app.click();
    const res = app.guard('rerollPeddler', () => app.api.rerollPeddler(app.run!, app.meta));
    if (!res) return;
    if (!res.ok) {
      app.sfx('ui_error');
      app.toast(res.reason ?? 'Not enough Crowns.', 'bad');
      return;
    }
    app.sfx('card_flip');
    header.update();
    render();
    grid.classList.remove('reshuffle');
    void grid.offsetWidth;
    grid.classList.add('reshuffle');
  });

  const leave = h(
    'button',
    {
      class: 'btn primary',
      onclick: () => {
        app.click();
        leaveIfOpen(app);
        app.advance();
      },
    },
    'Leave',
    glyph('next'),
  );

  render();
  const el = h(
    'div',
    { class: 'scr peddler-scr' },
    header.el,
    h(
      'div',
      { class: 'scr-body peddler-body' },
      h(
        'div',
        { class: 'peddler-top' },
        h('div', { class: 'plate plate-small' }, plate('peddler')),
        h(
          'div',
          { class: 'col', style: 'gap:.3rem' },
          h('div', { class: 'eyebrow' }, 'A wagon by the road'),
          h('h1', { class: 'display h1' }, 'The Peddler'),
          h('div', { class: 'small muted italic' }, '“Boons, banners, brave fools for hire. Crowns only, Warden.”'),
        ),
        h('span', { class: 'spacer' }),
        purse,
      ),
      grid,
      h('div', { class: 'peddler-actions' }, rerollBtn, h('span', { class: 'spacer' }), leave),
    ),
  );
  return { el };
}
