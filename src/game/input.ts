/**
 * Battle input plumbing (GDD §O controls table): pointer events on the battle canvas, keyboard on
 * the window, edge / arrow / MMB panning, wheel zoom, hover tracking and cursor styles.
 * All intents are executed by BattleActions.
 */
import type { Camera } from '../render/camera';
import type { Entity, World } from '../sim/types';
import { ENEMY, PLAYER } from '../sim/types';
import type { BattleActions } from './actions';
import { DOUBLE_CLICK_MS } from './actions';
import { learnKeyLayout, PAN_KEYS, resolveKey, shouldPreventDefault, type KeyAction } from './keys';
import { classifySelection } from './selection';
import type { BattleUIState } from './types';

export const EDGE_PX = 8;
export const DRAG_THRESHOLD_PX = 5;
/** A one-finger touch that moves further than this (CSS px) pans instead of tapping. */
export const TOUCH_PAN_PX = 10;
/** Base pan speed in CSS px per second (× panSpeed). */
export const PAN_SPEED = 900;

export interface InputHost {
  readonly world: World;
  readonly ui: BattleUIState;
  readonly camera: Camera;
  readonly actions: BattleActions;
  /** Pan settings (live; the pause menu toggles edge pan). */
  edgePan(): boolean;
  panSpeed(): number;
  /** Modal UI open: ignore world input and edge pan. */
  modalOpen(): boolean;
  /** First user gesture: unlock audio. */
  gesture(): void;
  /** Hotkey labels changed (keyboard layout learned from a keydown): refresh badges and tooltips. */
  layoutChanged?(): void;
}

export type Cursor = 'default' | 'select' | 'attack' | 'gather' | 'build' | 'target' | 'place' | 'pan';

export class BattleInput {
  private drag: { pointerId: number; sx: number; sy: number; moved: boolean; shift: boolean } | null = null;
  private mmb: { pointerId: number; x: number; y: number } | null = null;
  /**
   * Touch (phones, tablets): one finger pans; a tap selects own things or commands the selection
   * ("tap to select, tap the ground to move or attack, drag to pan"). Two fingers pinch-zoom.
   */
  private touch: { pointerId: number; x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
  /** Active touch points (client px) for the pinch. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; mx: number; my: number } | null = null;
  /** Safari trackpad pinch (gesture events): the cumulative scale already applied. */
  private gestureScale = 1;
  private readonly keysDown = new Set<string>();
  /** Pointer position in canvas CSS px; inside = over the window. */
  private pointer = { x: -1, y: -1, inside: false, overCanvas: false };
  /** Last plain click on an entity (double-click = same unit or same spot, same type and owner, in time). */
  private lastClick: { at: number; id: number; x: number; y: number; type: string; owner: number } | null = null;
  private cursor: Cursor | '' = '';
  private hoverDirty = true;
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly root: HTMLElement,
    private readonly host: InputHost,
  ) {}

  attach(): void {
    const c = this.canvas;
    this.setCursor('default');
    this.listen(c, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent));
    this.listen(c, 'pointermove', (e) => this.onPointerMove(e as PointerEvent));
    this.listen(c, 'pointerup', (e) => this.onPointerUp(e as PointerEvent));
    this.listen(c, 'pointercancel', (e) => this.onPointerCancel(e as PointerEvent));
    this.listen(c, 'pointerenter', () => {
      this.pointer.overCanvas = true;
    });
    this.listen(c, 'pointerleave', () => {
      this.pointer.overCanvas = false;
      this.host.ui.hoverId = 0;
    });
    this.listen(c, 'wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });
    // A trackpad pinch over a HUD panel arrives as a Ctrl+wheel: never let it zoom the page.
    this.listen(this.root, 'wheel', (e) => {
      if ((e as WheelEvent).ctrlKey) e.preventDefault();
    }, { passive: false });
    // Desktop Safari sends trackpad pinches as gesture events (iOS too, beside the touch pointers):
    // zoom the camera instead of the whole page.
    this.listen(document, 'gesturestart', (e) => this.onGesture(e, true), { passive: false });
    this.listen(document, 'gesturechange', (e) => this.onGesture(e, false), { passive: false });
    this.listen(document, 'gestureend', (e) => e.preventDefault(), { passive: false });
    this.listen(c, 'auxclick', (e) => e.preventDefault());
    this.listen(this.root, 'contextmenu', (e) => e.preventDefault());
    this.listen(window, 'keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    this.listen(window, 'keyup', (e) => this.onKeyUp(e as KeyboardEvent));
    this.listen(window, 'blur', () => this.reset());
    this.listen(window, 'pointermove', (e) => {
      const pe = e as PointerEvent;
      // A finger is not a resting pointer: it must never trigger edge pan.
      if (pe.pointerType === 'touch') return;
      const r = this.canvas.getBoundingClientRect();
      this.pointer.x = pe.clientX - r.left;
      this.pointer.y = pe.clientY - r.top;
      this.pointer.inside = true;
    });
    this.listen(document, 'pointerleave', () => {
      this.pointer.inside = false;
    });
    this.listen(document.documentElement, 'mouseleave', () => {
      this.pointer.inside = false;
    });
    this.listen(document, 'visibilitychange', () => {
      if (document.hidden) this.reset();
    });
  }

  detach(): void {
    for (const f of this.off) f();
    this.off.length = 0;
    this.reset();
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.off.push(() => target.removeEventListener(type, fn, opts));
  }

  /** Clear held state (window blur, tab hidden, menu opened). */
  reset(): void {
    this.keysDown.clear();
    // A pointer resting at a screen edge while the window loses focus must not keep panning;
    // the next pointermove marks it inside again.
    this.pointer.inside = false;
    this.host.ui.showCounterWheel = false;
    this.host.ui.box = null;
    this.drag = null;
    this.mmb = null;
    this.touch = null;
    this.touches.clear();
    this.pinch = null;
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    const { camera } = this.host;
    let dx = 0;
    let dy = 0;
    if (!this.host.modalOpen()) {
      for (const code of this.keysDown) {
        const p = PAN_KEYS[code];
        if (p) {
          dx += p.dx;
          dy += p.dy;
        }
      }
      if (this.host.edgePan() && this.pointer.inside && !this.drag && !this.mmb && !this.touches.size) {
        const w = camera.viewW;
        const h = camera.viewH;
        const { x, y } = this.pointer;
        if (x >= 0 && x <= EDGE_PX) dx -= 1;
        else if (x >= w - EDGE_PX && x <= w + 1) dx += 1;
        if (y >= 0 && y <= EDGE_PX) dy -= 1;
        else if (y >= h - EDGE_PX && y <= h + 1) dy += 1;
      }
    }
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      const speed = PAN_SPEED * this.host.panSpeed() * dt;
      camera.panBy((dx / len) * speed, (dy / len) * speed);
      this.hoverDirty = true;
    }
    if (this.hoverDirty && this.pointer.overCanvas) this.updateWorldPointer();
  }

  /** Recompute hover + world mouse (camera moved or 10 Hz refresh). */
  refreshHover(): void {
    this.hoverDirty = true;
  }

  private updateWorldPointer(): void {
    this.hoverDirty = false;
    const { ui, camera, actions } = this.host;
    const w = camera.screenToWorld(this.pointer.x, this.pointer.y);
    ui.mouseWorld = { x: w.x, y: w.y };
    if (ui.placement) actions.updatePlacement(w.x, w.y);
    const e = this.drag?.moved ? null : actions.pick(w.x, w.y);
    ui.hoverId = e ? e.id : 0;
    this.setCursor(this.cursorFor(e));
  }

  /** Cursor for the hovered entity (or the tile under ui.mouseWorld when nothing is hovered). */
  cursorFor(hover: Entity | null): Cursor {
    const { ui, actions } = this.host;
    if (this.mmb) return 'pan';
    if (ui.placement) return 'place';
    if (ui.targeting || actions.extraMode) return 'target';
    if (this.drag?.moved) return 'default';
    const info = classifySelection(this.host.world, ui.selection);
    if (!hover) {
      // Forest tiles are not entities: show the sickle over trees when Tillers could gather them.
      const m = ui.mouseWorld;
      if (info.kind === 'units' && info.units.some((u) => u.type === 'tiller') && actions.isTreeTile(m.x, m.y)) return 'gather';
      return 'default';
    }
    if (info.kind === 'units') {
      if (hover.owner === ENEMY && !hover.untargetable) return 'attack';
      const tillers = info.units.some((u) => u.type === 'tiller');
      if (tillers && hover.kind === 'resource') return 'gather';
      if (tillers && hover.kind === 'building' && hover.owner === PLAYER) {
        if (!hover.built || hover.hp < hover.maxHp) return 'build';
        if (hover.type === 'grainplot') return 'gather';
      }
    }
    return 'select';
  }

  private setCursor(c: Cursor): void {
    if (c === this.cursor) return;
    if (this.cursor) this.canvas.classList.remove(`cur-${this.cursor}`);
    this.canvas.classList.add(`cur-${c}`);
    this.cursor = c;
  }

  // ---------------------------------------------------------------------------
  // Pointer
  // ---------------------------------------------------------------------------

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown(e: PointerEvent): void {
    this.host.gesture();
    if (this.host.modalOpen()) return;
    const p = this.local(e);
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    const { ui, actions, camera } = this.host;
    const w = camera.screenToWorld(p.x, p.y);
    ui.mouseWorld = { x: w.x, y: w.y };
    if (e.pointerType === 'touch' && this.touchDown(e)) return;
    if (e.button === 0) {
      if (ui.placement) {
        actions.placeAt(w.x, w.y, e.shiftKey);
        return;
      }
      if (ui.targeting || actions.extraMode) {
        actions.targetAt(w.x, w.y, e.shiftKey);
        return;
      }
      this.drag = { pointerId: e.pointerId, sx: p.x, sy: p.y, moved: false, shift: e.shiftKey };
      this.capture(e.pointerId);
      return;
    }
    if (e.button === 2) {
      e.preventDefault();
      if (this.drag) return;
      if (actions.hasMode()) {
        actions.cancelModes();
        return;
      }
      actions.smartAt(w.x, w.y, e.shiftKey);
      return;
    }
    if (e.button === 1) {
      e.preventDefault();
      this.mmb = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      this.capture(e.pointerId);
      this.setCursor('pan');
    }
  }

  /**
   * Touch pointer down with no placement / targeting mode: start a pan-or-tap (one finger) or a
   * pinch (second finger). Returns false to let a mode (placing, A-targeting) take the tap as a click.
   */
  private touchDown(e: PointerEvent): boolean {
    const { ui, actions } = this.host;
    if (e.button !== 0) return false;
    if (!this.touches.size && (ui.placement || ui.targeting || actions.extraMode)) return false;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.capture(e.pointerId);
    if (this.touches.size === 1) {
      this.touch = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
      return true;
    }
    // A second finger: pinch. The first finger's tap is cancelled.
    if (this.touch) this.touch.moved = true;
    this.pinch = this.pinchState();
    return true;
  }

  /** Distance and midpoint (client px) of the first two touch points. */
  private pinchState(): { dist: number; mx: number; my: number } | null {
    const pts = [...this.touches.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  private touchMove(e: PointerEvent): void {
    const { camera } = this.host;
    const pt = this.touches.get(e.pointerId);
    if (!pt) return;
    pt.x = e.clientX;
    pt.y = e.clientY;
    if (this.pinch) {
      const next = this.pinchState();
      if (!next) return;
      const r = this.canvas.getBoundingClientRect();
      camera.panBy(this.pinch.mx - next.mx, this.pinch.my - next.my);
      camera.zoomAt(next.dist / this.pinch.dist, next.mx - r.left, next.my - r.top);
      this.pinch = next;
      this.hoverDirty = true;
      return;
    }
    const t = this.touch;
    if (!t || t.pointerId !== e.pointerId) return;
    if (!t.moved && Math.hypot(e.clientX - t.sx, e.clientY - t.sy) > TOUCH_PAN_PX) t.moved = true;
    if (t.moved) {
      camera.panBy(t.x - e.clientX, t.y - e.clientY);
      this.hoverDirty = true;
    }
    t.x = e.clientX;
    t.y = e.clientY;
  }

  private touchUp(e: PointerEvent): void {
    this.touches.delete(e.pointerId);
    this.release(e.pointerId);
    this.pointer.inside = false;
    if (this.pinch) {
      // Lifting one finger of a pinch ends it; the remaining finger does nothing until lifted.
      if (this.touches.size < 2) this.pinch = null;
      if (this.touch?.pointerId === e.pointerId) this.touch = null;
      return;
    }
    const t = this.touch;
    if (!t || t.pointerId !== e.pointerId) return;
    this.touch = null;
    if (t.moved) return;
    this.tapAt(this.local(e));
  }

  /** A touch tap: own unit or building → select it (double-tap: all of the type); elsewhere → command the selection. */
  private tapAt(p: { x: number; y: number }): void {
    const { ui, actions, camera, world } = this.host;
    const w = camera.screenToWorld(p.x, p.y);
    ui.mouseWorld = { x: w.x, y: w.y };
    const hit = actions.pick(w.x, w.y);
    const own = !!hit && hit.owner === PLAYER;
    const haveOwn = ui.selection.some((id) => world.entities.get(id)?.owner === PLAYER);
    if (!own && haveOwn) {
      actions.smartAt(w.x, w.y, false);
      this.lastClick = null;
    } else {
      const now = performance.now();
      const dbl = isDoubleClick(this.lastClick, hit, p, now);
      actions.clickSelect(w.x, w.y, false, dbl);
      this.lastClick = hit && hit.kind !== 'resource' && !dbl ? { at: now, id: hit.id, x: p.x, y: p.y, type: hit.type, owner: hit.owner } : null;
    }
    this.hoverDirty = true;
  }

  /** Safari gesture events (trackpad or touch pinch): no page zoom; the camera zooms instead. */
  private onGesture(e: Event, start: boolean): void {
    e.preventDefault();
    const g = e as Event & { scale?: number; clientX?: number; clientY?: number };
    if (start) this.gestureScale = 1;
    const scale = typeof g.scale === 'number' && g.scale > 0 ? g.scale : 1;
    const factor = scale / this.gestureScale;
    this.gestureScale = scale;
    // Touch pinches are handled from the pointers; gesture events then only block the page zoom.
    if (start || this.touches.size || this.host.modalOpen() || !Number.isFinite(factor)) return;
    const r = this.canvas.getBoundingClientRect();
    const x = Number.isFinite(g.clientX) ? g.clientX! - r.left : this.pointer.x;
    const y = Number.isFinite(g.clientY) ? g.clientY! - r.top : this.pointer.y;
    this.host.camera.zoomAt(factor, x, y);
    this.hoverDirty = true;
  }

  private capture(id: number): void {
    try {
      this.canvas.setPointerCapture(id);
    } catch {
      /* synthetic events may not be capturable */
    }
  }

  private release(id: number): void {
    try {
      if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    } catch {
      /* ignore */
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.touches.has(e.pointerId)) {
      this.touchMove(e);
      return;
    }
    if (e.pointerType === 'touch') return;
    const p = this.local(e);
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    this.pointer.inside = true;
    this.pointer.overCanvas = true;
    const { ui, camera } = this.host;
    if (this.mmb && e.pointerId === this.mmb.pointerId) {
      camera.panBy(this.mmb.x - e.clientX, this.mmb.y - e.clientY);
      this.mmb.x = e.clientX;
      this.mmb.y = e.clientY;
    }
    if (this.drag && e.pointerId === this.drag.pointerId) {
      if (!this.drag.moved && Math.hypot(p.x - this.drag.sx, p.y - this.drag.sy) > DRAG_THRESHOLD_PX) this.drag.moved = true;
      if (this.drag.moved) ui.box = { x0: this.drag.sx, y0: this.drag.sy, x1: p.x, y1: p.y };
    }
    this.updateWorldPointer();
  }

  private onPointerUp(e: PointerEvent): void {
    // Touch: pointerdown is not a user activation (pointerup is), so unlock audio here too.
    this.host.gesture();
    const { ui, actions, camera } = this.host;
    if (this.touches.has(e.pointerId)) {
      this.touchUp(e);
      this.hoverDirty = true;
      return;
    }
    if (this.mmb && e.pointerId === this.mmb.pointerId && e.button === 1) {
      this.release(e.pointerId);
      this.mmb = null;
      this.hoverDirty = true;
      return;
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId || e.button !== 0) return;
    this.release(e.pointerId);
    this.drag = null;
    ui.box = null;
    const p = this.local(e);
    const shift = e.shiftKey || d.shift;
    if (d.moved) {
      const a = camera.screenToWorld(Math.min(d.sx, p.x), Math.min(d.sy, p.y));
      const b = camera.screenToWorld(Math.max(d.sx, p.x), Math.max(d.sy, p.y));
      actions.boxSelect(a.x, a.y, b.x, b.y, shift);
      this.lastClick = null;
    } else {
      const w = camera.screenToWorld(p.x, p.y);
      const now = performance.now();
      const hit = actions.pick(w.x, w.y);
      const dbl = isDoubleClick(this.lastClick, hit, p, now);
      actions.clickSelect(w.x, w.y, shift, dbl);
      this.lastClick = hit && hit.kind !== 'resource' && !dbl ? { at: now, id: hit.id, x: p.x, y: p.y, type: hit.type, owner: hit.owner } : null;
    }
    this.hoverDirty = true;
  }

  private onPointerCancel(e: PointerEvent): void {
    if (this.touches.delete(e.pointerId)) {
      if (this.touch?.pointerId === e.pointerId) this.touch = null;
      if (this.touches.size < 2) this.pinch = null;
    }
    if (this.drag?.pointerId === e.pointerId) {
      this.drag = null;
      this.host.ui.box = null;
    }
    if (this.mmb?.pointerId === e.pointerId) this.mmb = null;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (this.host.modalOpen()) return;
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const delta = Math.max(-240, Math.min(240, e.deltaY * unit));
    this.host.camera.zoomAt(Math.exp(-delta * 0.0015), p.x, p.y);
    this.hoverDirty = true;
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) && e.code !== 'Escape') return;
    this.host.gesture();
    // Safari / Firefox have no Keyboard API: learn QWERTZ / AZERTY labels from what the keys type.
    if (learnKeyLayout(e)) this.host.layoutChanged?.();
    const action = resolveKey(e);
    if (shouldPreventDefault(e, action) || PAN_KEYS[e.code]) e.preventDefault();
    if (PAN_KEYS[e.code]) {
      this.keysDown.add(e.code);
      return;
    }
    if (!action) return;
    if (this.host.modalOpen() && action.type !== 'escape' && action.type !== 'pause' && action.type !== 'mute') return;
    if (e.repeat && !repeatable(action)) return;
    this.exec(action);
    this.hoverDirty = true;
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.code);
    if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.host.actions.shiftReleased();
    if (e.code === 'Tab') {
      e.preventDefault();
      this.host.actions.setCounterWheel(false);
    }
  }

  private exec(a: KeyAction): void {
    const { actions } = this.host;
    switch (a.type) {
      case 'escape':
        actions.escape();
        return;
      case 'attackMove':
        actions.startAttackMove();
        return;
      case 'stop':
        actions.stop();
        return;
      case 'hold':
        actions.hold();
        return;
      case 'group':
        actions.groupOp(a.n, a.op);
        return;
      case 'selectHearth':
        actions.selectHearth();
        return;
      case 'selectWarden':
        actions.selectWarden(!!a.add);
        return;
      case 'idleTiller':
        actions.cycleIdleTiller();
        return;
      case 'allMilitary':
        actions.selectAllMilitary();
        return;
      case 'jumpAlert':
        actions.jumpToAlert();
        return;
      case 'counterWheel':
        actions.setCounterWheel(true);
        return;
      case 'pause':
        actions.togglePause();
        return;
      case 'speed':
        actions.stepSpeed(a.dir);
        return;
      case 'mute':
        actions.toggleMute();
        return;
      case 'delete':
        actions.demolishSelected();
        return;
      case 'card':
        // A build hotkey while placing switches the ghost (startPlacement resets the mode).
        actions.cardKey(a.letter, a.shift);
        return;
    }
  }
}

/** Max distance (CSS px) between two clicks on different units of one type to count as a double-click. */
export const DOUBLE_CLICK_SLOP_PX = 6;

/**
 * A second click is a double-click only on the same unit, or on (almost) the same spot, with the
 * same type and owner, within DOUBLE_CLICK_MS. Two quick clicks on two different Tillers select them
 * one at a time (or add with Shift) instead of every Tiller on screen.
 */
export function isDoubleClick(
  last: { at: number; id: number; x: number; y: number; type: string; owner: number } | null,
  hit: { id: number; kind: string; type: string; owner: number } | null,
  p: { x: number; y: number },
  now: number,
): boolean {
  if (!hit || !last || hit.kind === 'resource') return false;
  if (now - last.at > DOUBLE_CLICK_MS) return false;
  if (last.type !== hit.type || last.owner !== hit.owner) return false;
  return hit.id === last.id || Math.hypot(p.x - last.x, p.y - last.y) <= DOUBLE_CLICK_SLOP_PX;
}

function repeatable(a: KeyAction): boolean {
  return a.type === 'speed';
}
