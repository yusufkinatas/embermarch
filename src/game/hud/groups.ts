/**
 * Control-group slots (GDD §O): a row of 9 above the selection panel. Each shows its number, member
 * count and lead icon. LMB recall, double-click center, RMB assign, Shift+RMB add. This is the
 * always-available path where Ctrl/Alt+digit is swallowed by the browser.
 */
import type { Owner } from '../../sim/types';
import { h, setBgImage, setText, toggleClass } from '../dom';
import { iconSrc } from '../glyphs';
import { groupMembers, leadType } from '../selection';
import type { HudContext } from './context';

interface Slot {
  btn: HTMLButtonElement;
  icon: HTMLElement;
  count: HTMLElement;
  lastClick: number;
}

export class GroupSlots {
  readonly el: HTMLDivElement;
  private readonly slots: Slot[] = [];

  constructor(parent: HTMLElement, private readonly ctx: HudContext) {
    this.el = h('div', 'bt-groups', parent);
    for (let n = 1; n <= 9; n++) {
      const btn = h('button', 'bt-group empty', this.el);
      btn.type = 'button';
      h('span', 'bt-group-n', btn, String(n));
      const icon = h('i', 'bt-unit-ic', btn);
      const count = h('b', 'bt-group-count', btn);
      const slot: Slot = { btn, icon, count, lastClick: 0 };
      this.slots.push(slot);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.button === 2) {
          ctx.actions.groupOp(n, e.shiftKey ? 'add' : 'assign');
          return;
        }
        if (e.button !== 0) return;
        const now = performance.now();
        if (now - slot.lastClick <= 350) {
          ctx.actions.groupOp(n, 'recall');
          ctx.actions.centerGroup(n);
          slot.lastClick = 0;
        } else {
          ctx.actions.groupOp(n, 'recall');
          slot.lastClick = now;
        }
      });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
      ctx.tooltip.bind(btn, () => {
        const m = groupMembers(ctx.world, ctx.ui, n);
        return {
          title: `Group ${n}`,
          hotkey: String(n),
          body: m.length ? `${m.length} member${m.length > 1 ? 's' : ''}.` : 'Empty.',
          footer: 'LMB recall · double-click center · RMB assign · Shift+RMB add',
        };
      });
    }
  }

  update(): void {
    const { world, ui } = this.ctx;
    for (let n = 1; n <= 9; n++) {
      const s = this.slots[n - 1];
      const members = groupMembers(world, ui, n);
      const empty = members.length === 0;
      toggleClass(s.btn, 'empty', empty);
      setText(s.count, empty ? '' : String(members.length));
      const lead = empty ? null : leadType(world, members);
      setBgImage(s.icon, lead ? iconSrc(lead.type, lead.owner as Owner, 26) : '');
      const active = !empty && members.length === ui.selection.length && members.every((id) => ui.selection.includes(id));
      toggleClass(s.btn, 'active', active);
    }
  }
}
