/**
 * Command card (bottom right, 5×2, GDD §O) built from sim-core's commandCard(world, selection).
 * Each button: hotkey letter, icon, cost line with resource icons (red when unaffordable), a
 * tooltip with the disabled reason, and a cooldown / progress overlay.
 */
import { RESEARCH } from '../../data/research';
import type { HouseId, ResearchId, ResourceType } from '../../sim/types';
import { PLAYER } from '../../sim/types';
import type { CommandOption } from '../../sim/queries';
import { clearChildren, h, setBgImage, setHtml, setStyle, setText, toggleClass } from '../dom';
import { costEntries, formatSeconds } from '../format';
import { GLYPHS, iconSrc, isIconKind, optionGlyph, type GlyphName } from '../glyphs';
import type { HudContext } from './context';

const HOUSE_GLYPH: Record<HouseId, GlyphName> = { ardent: 'horn', tallow: 'hymn', grimbrand: 'firepot', lowmere: 'volley' };

/** Basic unit orders the HUD adds in free slots (sim-core's card covers builds and abilities). */
interface LocalOrder {
  kind: 'order';
  id: 'attackMove' | 'stop' | 'hold';
  label: string;
  hotkey: string;
  tooltip: string;
  slot: number;
}

type CardItem = CommandOption | LocalOrder;

const LOCAL_ORDERS: Omit<LocalOrder, 'slot'>[] = [
  { kind: 'order', id: 'stop', label: 'Stop', hotkey: 'S', tooltip: 'Drop the current order and stand ready.' },
  { kind: 'order', id: 'hold', label: 'Hold Ground', hotkey: 'G', tooltip: 'Never move. Attack enemies that come within range.' },
  { kind: 'order', id: 'attackMove', label: 'Attack-Move', hotkey: 'A', tooltip: 'Then click: march there and fight everything on the way.' },
];

/** Free bottom-row slots, right to left, get Stop, Hold, Attack-Move (Tillers only have room for Stop). */
function withLocalOrders(opts: CommandOption[], hasUnits: boolean): CardItem[] {
  if (!hasUnits) return opts;
  const used = new Set(opts.map((o) => o.slot));
  const items: CardItem[] = [...opts];
  let slot = 9;
  for (const o of LOCAL_ORDERS) {
    while (slot >= 5 && used.has(slot)) slot--;
    if (slot < 5) break;
    items.push({ ...o, slot });
    used.add(slot);
  }
  return items;
}

interface SlotView {
  btn: HTMLButtonElement;
  icon: HTMLElement;
  key: HTMLElement;
  cost: HTMLElement;
  cd: HTMLElement;
  cdText: HTMLElement;
  badge: HTMLElement;
  costKey: string;
  iconKey: string;
}

export class CommandCard {
  readonly el: HTMLDivElement;
  private readonly slots: SlotView[] = [];
  private options: CardItem[] = [];

  constructor(parent: HTMLElement, private readonly ctx: HudContext) {
    this.el = h('div', 'bt-card bt-panel', parent);
    for (let i = 0; i < 10; i++) {
      const btn = h('button', 'bt-cmd empty', this.el);
      btn.type = 'button';
      const icon = h('i', 'bt-cmd-ic', btn);
      const key = h('span', 'bt-cmd-key', btn);
      const badge = h('span', 'bt-cmd-badge', btn);
      const cost = h('div', 'bt-cmd-cost', btn);
      const cd = h('div', 'bt-cmd-cd', btn);
      const cdText = h('span', 'bt-cmd-cd-text', btn);
      const slot: SlotView = { btn, icon, key, cost, cd, cdText, badge, costKey: '', iconKey: '' };
      this.slots.push(slot);
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        const opt = this.options.find((o) => o.slot === i);
        if (!opt) return;
        if (opt.kind === 'order') this.runOrder(opt.id);
        else ctx.actions.executeOption(opt, e.shiftKey);
      });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
      ctx.tooltip.bind(btn, () => {
        const opt = this.options.find((o) => o.slot === i);
        if (!opt) return null;
        if (opt.kind === 'order') return { title: opt.label, hotkey: opt.hotkey, body: opt.tooltip, footer: opt.id === 'attackMove' ? 'Shift+click queues it.' : undefined };
        const res = ctx.world.players[PLAYER].res;
        const short = costEntries(opt.cost)
          .filter((c) => res[c.res] < c.amount)
          .map((c) => c.res);
        return {
          title: opt.label,
          hotkey: opt.hotkey,
          cost: opt.cost,
          short,
          body: opt.tooltip,
          reason: opt.enabled ? undefined : opt.reason,
          footer: opt.kind === 'train' ? 'Shift: queue 5' : opt.kind === 'build' ? 'Shift: keep placing' : opt.cooldown ? `Ready in ${formatSeconds(opt.cooldown)} s` : undefined,
        };
      });
    }
  }

  update(): void {
    const { world, ui } = this.ctx;
    this.options = withLocalOrders(this.ctx.actions.card(), this.ctx.actions.selectedUnits().length > 0);
    const res = world.players[PLAYER].res;
    const queued = this.queuedCounts();
    for (let i = 0; i < 10; i++) {
      const s = this.slots[i];
      const opt = this.options.find((o) => o.slot === i);
      toggleClass(s.btn, 'empty', !opt);
      toggleClass(s.btn, 'order', false);
      if (!opt) {
        setText(s.key, '');
        this.setIcon(s, '', '');
        if (s.costKey) {
          clearChildren(s.cost);
          s.costKey = '';
        }
        setStyle(s.cd, '--p', '0');
        setText(s.cdText, '');
        setText(s.badge, '');
        toggleClass(s.btn, 'disabled', false);
        toggleClass(s.btn, 'active', false);
        continue;
      }
      setText(s.key, opt.hotkey);
      if (opt.kind === 'order') {
        this.fillOrder(s, opt);
        continue;
      }
      this.setIcon(s, opt.icon, opt.kind === 'ability' && opt.id === 'house_ability' ? GLYPHS[HOUSE_GLYPH[this.ctx.setup.house]] : this.glyphFor(opt));
      const entries = costEntries(opt.cost);
      const shortMask = entries.map((c) => (res[c.res] < c.amount ? '1' : '0')).join('');
      const costKey = `${entries.map((c) => `${c.res}${c.amount}`).join(',')}#${shortMask}`;
      if (costKey !== s.costKey) {
        s.costKey = costKey;
        clearChildren(s.cost);
        for (const c of entries) {
          const item = h('span', `bt-cost-item res-${c.res}${res[c.res] < c.amount ? ' short' : ''}`, s.cost);
          const ic = h('i', 'bt-res-ic', item);
          setBgImage(ic, iconSrc(c.res as ResourceType, PLAYER, 12));
          h('span', '', item, String(c.amount));
        }
      }
      toggleClass(s.btn, 'disabled', !opt.enabled);
      toggleClass(s.btn, 'unaffordable', shortMask.includes('1'));
      const prog = opt.progress ?? 0;
      setStyle(s.cd, '--p', String(Math.max(0, Math.min(1, prog))));
      toggleClass(s.cd, 'on', prog > 0 && prog < 1);
      setText(s.cdText, opt.cooldown && opt.cooldown > 0 ? formatSeconds(opt.cooldown) : '');
      setText(s.badge, opt.kind === 'train' && queued.get(opt.id) ? String(queued.get(opt.id)) : '');
      const active =
        (opt.kind === 'build' && ui.placement?.building === opt.id) ||
        (opt.kind === 'ability' && ui.targeting?.kind === 'ability' && ((opt.id === 'hawk' && ui.targeting.slot === 'W') || (opt.id === 'house_ability' && ui.targeting.slot === 'Q')));
      toggleClass(s.btn, 'active', active);
    }
  }

  private fillOrder(s: SlotView, o: LocalOrder): void {
    this.setIcon(s, '', GLYPHS[o.id]);
    if (s.costKey) {
      clearChildren(s.cost);
      s.costKey = '';
    }
    toggleClass(s.btn, 'disabled', false);
    toggleClass(s.btn, 'unaffordable', false);
    setStyle(s.cd, '--p', '0');
    toggleClass(s.cd, 'on', false);
    setText(s.cdText, '');
    setText(s.badge, '');
    toggleClass(s.btn, 'active', o.id === 'attackMove' && this.ctx.ui.targeting?.kind === 'attackMove');
    toggleClass(s.btn, 'order', true);
  }

  private runOrder(id: LocalOrder['id']): void {
    const a = this.ctx.actions;
    if (id === 'stop') a.stop();
    else if (id === 'hold') a.hold();
    else a.startAttackMove();
  }

  private glyphFor(opt: CommandOption): string {
    if (opt.kind === 'research' && RESEARCH[opt.id as ResearchId]?.temper) return GLYPHS.temper;
    return GLYPHS[optionGlyph(opt.kind, opt.id)];
  }

  private setIcon(s: SlotView, icon: string, glyph: string): void {
    const key = `${icon}|${glyph}`;
    if (key === s.iconKey) return;
    s.iconKey = key;
    const src = icon && isIconKind(icon) ? iconSrc(icon, PLAYER, 40) : '';
    setBgImage(s.icon, src);
    setHtml(s.icon, src ? '' : glyph);
  }

  private queuedCounts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const b of this.ctx.actions.selectedBuildings()) for (const q of b.queue) m.set(q.unit, (m.get(q.unit) ?? 0) + 1);
    return m;
  }
}
