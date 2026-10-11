/**
 * Top bar (32 px, GDD §O): Grain / Timber / Ember with income per minute on hover, Pop x/cap,
 * battle clock, Resolve pips, speed / pause / menu buttons.
 */
import { RESOLVE } from '../../data/balance';
import { RESOURCE_NAMES } from '../../data/text';
import type { ResourceBag, ResourceType, World } from '../../sim/types';
import { PLAYER, RESOURCE_TYPES } from '../../sim/types';
import { h, setBgImage, setHtml, setText, toggleClass } from '../dom';
import { formatClock, formatRate } from '../format';
import { GLYPHS, iconSrc } from '../glyphs';
import { SPEED_STEPS } from '../loop';
import type { HudContext } from './context';

/** Rolling income: samples cumulative gathered totals once per battle second. */
export class IncomeTracker {
  private samples: { t: number; g: ResourceBag }[] = [];

  sample(world: World): void {
    const t = Math.floor(world.time);
    const last = this.samples[this.samples.length - 1];
    if (last && last.t === t) return;
    const g = world.players[PLAYER].stats.gathered;
    this.samples.push({ t, g: { grain: g.grain, timber: g.timber, ember: g.ember } });
    while (this.samples.length > 62) this.samples.shift();
  }

  /** Resources per minute over the last 60 s (extrapolated early on). */
  perMinute(res: ResourceType): number {
    const n = this.samples.length;
    if (n < 2) return 0;
    const a = this.samples[0];
    const b = this.samples[n - 1];
    const dt = b.t - a.t;
    if (dt <= 0) return 0;
    return ((b.g[res] - a.g[res]) / dt) * 60;
  }
}

export interface TopBarCallbacks {
  openMenu(): void;
}

export class TopBar {
  readonly el: HTMLDivElement;
  private readonly res: Record<ResourceType, { val: HTMLElement; ic: HTMLElement; box: HTMLElement }>;
  private readonly popVal: HTMLElement;
  private readonly popBox: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly resolveBox: HTMLElement;
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly pauseBtn: HTMLButtonElement;
  private readonly income = new IncomeTracker();
  private resolveKey = '';
  private flashUntil: Partial<Record<ResourceType, number>> = {};

  constructor(parent: HTMLElement, private readonly ctx: HudContext, cb: TopBarCallbacks) {
    this.el = h('div', 'bt-top bt-panel-strip', parent);
    const left = h('div', 'bt-top-left', this.el);
    const res = {} as Record<ResourceType, { val: HTMLElement; ic: HTMLElement; box: HTMLElement }>;
    for (const r of RESOURCE_TYPES) {
      const box = h('div', `bt-res res-${r}`, left);
      const ic = h('i', 'bt-res-ic', box);
      setBgImage(ic, iconSrc(r, PLAYER, 20));
      const val = h('span', 'bt-res-val', box, '0');
      res[r] = { val, ic, box };
      ctx.tooltip.bind(box, () => ({
        title: RESOURCE_NAMES[r],
        body: `${formatRate(this.income.perMinute(r))} gathered over the last minute.`,
        footer: r === 'ember' ? 'Ember buys quality units, towers and Tempers.' : undefined,
      }));
    }
    this.res = res;
    this.popBox = h('div', 'bt-res bt-pop', left);
    const popIc = h('i', 'bt-res-ic bt-pop-ic', this.popBox);
    setBgImage(popIc, iconSrc('pop', PLAYER, 20));
    this.popVal = h('span', 'bt-res-val', this.popBox, '0/20');
    ctx.tooltip.bind(this.popBox, () => {
      const p = ctx.world.players[PLAYER];
      return {
        title: 'Population',
        body: `${Math.floor(p.pop)} of ${p.popCap}. The Hearth gives 20, each Cottage 6, up to 60.`,
        reason: p.pop >= p.popCap && p.popCap < 60 ? 'Population capped. Build Cottages (C).' : undefined,
      };
    });

    const mid = h('div', 'bt-top-mid', this.el);
    this.clock = h('div', 'bt-clock', mid, '0:00');
    ctx.tooltip.bind(this.clock, () => ({ title: 'Battle clock', body: 'Starts after the Kindle countdown.' }));

    const right = h('div', 'bt-top-right', this.el);
    this.resolveBox = h('div', 'bt-resolve', right);
    ctx.tooltip.bind(this.resolveBox, () => ({
      title: 'Resolve',
      body: ctx.setup.isBoss
        ? 'Last Stand: if the Hearth would fall, spend 1 Resolve to restore it at 40% HP.'
        : 'Losing a battle or Sounding the Retreat costs 1 Resolve. At 0 the run ends.',
    }));
    const speeds = h('div', 'bt-speed', right);
    for (const s of SPEED_STEPS) {
      const b = h('button', 'bt-btn bt-speed-btn', speeds, `${s}×`);
      b.type = 'button';
      b.addEventListener('click', () => {
        ctx.actions.setSpeed(s);
        ctx.ui.paused = false;
      });
      ctx.tooltip.bind(b, () => ({ title: `Speed ${s}×`, hotkey: '− / =' }));
      this.speedBtns.push(b);
    }
    this.pauseBtn = h('button', 'bt-btn bt-icon-btn', right);
    this.pauseBtn.type = 'button';
    this.pauseBtn.setAttribute('aria-label', 'Pause');
    this.pauseBtn.addEventListener('click', () => ctx.actions.togglePause());
    ctx.tooltip.bind(this.pauseBtn, () => ({
      title: ctx.ui.paused ? 'Resume' : 'Pause',
      hotkey: 'F2',
      body: 'Active pause: you can still give orders.',
    }));
    const menuBtn = h('button', 'bt-btn bt-icon-btn', right);
    menuBtn.type = 'button';
    menuBtn.setAttribute('aria-label', 'Menu');
    setHtml(menuBtn, GLYPHS.menu);
    menuBtn.addEventListener('click', () => cb.openMenu());
    ctx.tooltip.bind(menuBtn, () => ({ title: 'Menu', hotkey: 'Esc' }));
  }

  /** Cheap per-frame text (diffed). */
  updateFast(): void {
    const { world, ui } = this.ctx;
    const p = world.players[PLAYER];
    const now = this.ctx.now;
    for (const r of RESOURCE_TYPES) {
      const v = Math.floor(p.res[r] + 1e-6);
      const slot = this.res[r];
      const prev = slot.val.textContent;
      setText(slot.val, String(v));
      if (prev !== null && prev !== '' && Number(prev) < v) this.flashUntil[r] = now + 0.35;
      toggleClass(slot.box, 'gain', (this.flashUntil[r] ?? 0) > now);
    }
    setText(this.popVal, `${Math.floor(p.pop + 1e-6)}/${p.popCap}`);
    toggleClass(this.popBox, 'capped', p.pop >= p.popCap && p.popCap < 60);
    setText(this.clock, formatClock(world.time));
    setHtml(this.pauseBtn, ui.paused ? GLYPHS.play : GLYPHS.pause);
    toggleClass(this.pauseBtn, 'active', ui.paused);
  }

  /** 10 Hz refresh. */
  update(): void {
    const { world, setup, ui } = this.ctx;
    this.income.sample(world);
    this.speedBtns.forEach((b, i) => toggleClass(b, 'active', Math.abs(SPEED_STEPS[i] - ui.speed) < 1e-6));
    const max = Math.max(setup.metaUnlocks.includes('fourth_banner') ? RESOLVE.fourthBannerMax : RESOLVE.max, setup.resolve);
    const cur = Math.max(0, setup.resolve - world.lastStandsUsed);
    const key = `${cur}/${max}`;
    if (key !== this.resolveKey) {
      this.resolveKey = key;
      let html = '';
      for (let i = 0; i < max; i++) html += `<span class="bt-pip${i < cur ? ' on' : ''}">${GLYPHS.resolve}</span>`;
      setHtml(this.resolveBox, html);
    }
  }
}
