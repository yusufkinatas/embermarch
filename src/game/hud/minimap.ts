/**
 * Minimap (160×160, bottom left, GDD §O): drawn by renderer.renderMinimap at ~10 Hz.
 * LMB jumps / drag scrubs the camera, RMB issues a smart move; in attack-move mode LMB attack-moves.
 * The idle-Tiller and Warden buttons sit above it (Warden shows the respawn timer while fallen).
 */
import { PLAYER, TICK_RATE } from '../../sim/types';
import { idleTillers } from '../../sim/queries';
import { h, setBar, setBgImage, setHidden, setHtml, setText, toggleClass } from '../dom';
import { formatCountdown } from '../format';
import { GLYPHS, iconSrc } from '../glyphs';
import type { HudContext } from './context';

/** Minimap canvas CSS size (inside the 160×160 frame). */
export const MINIMAP_PX = 152;

export class Minimap {
  readonly el: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private readonly idleBtn: HTMLButtonElement;
  private readonly idleCount: HTMLElement;
  private readonly wardenBtn: HTMLButtonElement;
  private readonly wardenTimer: HTMLElement;
  private readonly wardenHp: HTMLElement;
  private scrub: number | null = null;
  private failed = false;
  private idleN = 0;

  constructor(parent: HTMLElement, private readonly ctx: HudContext) {
    this.el = h('div', 'bt-minimap-wrap', parent);
    const btns = h('div', 'bt-mini-btns', this.el);

    this.idleBtn = h('button', 'bt-btn bt-mini-btn bt-idle-btn', btns);
    this.idleBtn.type = 'button';
    const idleIc = h('i', 'bt-unit-ic', this.idleBtn);
    setBgImage(idleIc, iconSrc('tiller', PLAYER, 28));
    h('span', 'bt-idle-z', this.idleBtn).innerHTML = GLYPHS.idle;
    this.idleCount = h('b', 'bt-mini-count', this.idleBtn, '0');
    this.idleBtn.addEventListener('click', () => ctx.actions.cycleIdleTiller());
    ctx.tooltip.bind(this.idleBtn, () => ({ title: 'Idle Tillers', hotkey: '.', body: `${this.idleN} idle. Click to cycle through them.` }));

    this.wardenBtn = h('button', 'bt-btn bt-mini-btn bt-warden-btn', btns);
    this.wardenBtn.type = 'button';
    const wIc = h('i', 'bt-unit-ic', this.wardenBtn);
    setBgImage(wIc, iconSrc('warden', PLAYER, 28));
    if (!wIc.classList.contains('has-img')) setHtml(wIc, GLYPHS.hero);
    this.wardenTimer = h('b', 'bt-warden-timer', this.wardenBtn);
    const hpBar = h('div', 'bt-mini-hp', this.wardenBtn);
    this.wardenHp = h('div', 'bt-mini-hp-fill', hpBar);
    this.wardenBtn.addEventListener('click', (e) => ctx.actions.selectWarden(e.shiftKey));
    this.wardenBtn.addEventListener('dblclick', () => {
      const w = ctx.world.entities.get(ctx.world.wardenId);
      if (w && w.alive) ctx.actions.centerOn(w.x, w.y);
    });
    ctx.tooltip.bind(this.wardenBtn, () => {
      const left = this.respawnLeft();
      return { title: 'Warden', hotkey: '`', body: left > 0 ? `Fallen. Returns at the Hearth in ${formatCountdown(left)}.` : 'Click to select, Shift+click to add, double-click to center.' };
    });

    const frame = h('div', 'bt-minimap bt-panel', this.el);
    this.canvas = h('canvas', 'bt-minimap-canvas', frame);
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.resize(1, window.devicePixelRatio || 1);
  }

  resize(scale: number, dpr: number): void {
    const px = Math.round(MINIMAP_PX * scale * dpr);
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
  }

  private toWorld(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const { map } = this.ctx.world;
    const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const fy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    return { x: fx * map.w, y: fy * map.h };
  }

  private onDown(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const { actions, ui } = this.ctx;
    const w = this.toWorld(e);
    if (e.button === 2) {
      if (actions.hasMode()) actions.cancelModes();
      else actions.smartAt(w.x, w.y, e.shiftKey, false);
      return;
    }
    if (e.button !== 0) return;
    if (ui.targeting?.kind === 'attackMove') {
      actions.targetAt(w.x, w.y, e.shiftKey, false);
      return;
    }
    // A map-wide ability (the Hawk) casts where the minimap is clicked instead of jumping the camera.
    if (ui.targeting?.kind === 'ability' && !Number.isFinite(ui.targeting.range)) {
      actions.targetAt(w.x, w.y, e.shiftKey);
      return;
    }
    if (actions.extraMode) {
      actions.targetAt(w.x, w.y, e.shiftKey);
      return;
    }
    actions.centerOn(w.x, w.y);
    this.scrub = e.pointerId;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private onMove(e: PointerEvent): void {
    if (this.scrub !== e.pointerId) return;
    const w = this.toWorld(e);
    this.ctx.actions.centerOn(w.x, w.y);
  }

  private onUp(e: PointerEvent): void {
    if (this.scrub === e.pointerId) {
      this.scrub = null;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  private respawnLeft(): number {
    const { world } = this.ctx;
    const w = world.entities.get(world.wardenId);
    if (w && w.alive) return 0;
    const t = world.players[PLAYER].wardenRespawnTick;
    return t > 0 ? Math.max(0, (t - world.tick) / TICK_RATE) : 0;
  }

  /** ~10 Hz: redraw the minimap and the buttons. */
  update(): void {
    const { world, renderer, camera, ui } = this.ctx;
    try {
      renderer.renderMinimap(this.canvas, world, camera, ui);
    } catch (err) {
      if (!this.failed) console.error('[battle] renderMinimap failed', err);
      this.failed = true; // log once, keep retrying
    }
    try {
      this.idleN = idleTillers(world).length;
    } catch {
      this.idleN = 0;
    }
    setText(this.idleCount, String(this.idleN));
    toggleClass(this.idleBtn, 'none', this.idleN === 0);
    toggleClass(this.idleBtn, 'alert', this.idleN > 0);

    const w = world.entities.get(world.wardenId);
    const alive = !!w && w.alive;
    toggleClass(this.wardenBtn, 'fallen', !alive);
    const left = this.respawnLeft();
    setText(this.wardenTimer, !alive && left > 0 ? formatCountdown(left) : '');
    setHidden(this.wardenTimer, alive);
    const frac = alive && w ? w.hp / w.maxHp : 0;
    setBar(this.wardenHp, frac);
    toggleClass(this.wardenBtn, 'selected', alive && ui.selection.length === 1 && ui.selection[0] === world.wardenId);
  }
}
