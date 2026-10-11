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
import { PAN_KEYS, resolveKey, shouldPreventDefault, type KeyAction } from './keys';
import { classifySelection } from './selection';
import type { BattleUIState } from './types';

export const EDGE_PX = 8;
export const DRAG_THRESHOLD_PX = 5;
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
}

type Cursor = 'default' | 'select' | 'attack' | 'gather' | 'build' | 'target' | 'place' | 'pan';

export class BattleInput {
  private drag: { pointerId: number; sx: number; sy: number; moved: boolean; shift: boolean } | null = null;
  private mmb: { pointerId: number; x: number; y: number } | null = null;
  private readonly keysDown = new Set<string>();
  /** Pointer position in canvas CSS px; inside = over the window. */
  private pointer = { x: -1, y: -1, inside: false, overCanvas: false };
  private lastClick: { at: number; type: string; owner: number } | null = null;
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
    this.listen(c, 'auxclick', (e) => e.preventDefault());
    this.listen(this.root, 'contextmenu', (e) => e.preventDefault());
    this.listen(window, 'keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    this.listen(window, 'keyup', (e) => this.onKeyUp(e as KeyboardEvent));
    this.listen(window, 'blur', () => this.reset());
    this.listen(window, 'pointermove', (e) => {
      const pe = e as PointerEvent;
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
    this.host.ui.showCounterWheel = false;
    this.host.ui.box = null;
    this.drag = null;
    this.mmb = null;
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
      if (this.host.edgePan() && this.pointer.inside && !this.drag && !this.mmb) {
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

  private cursorFor(hover: Entity | null): Cursor {
    const { ui, actions } = this.host;
    if (this.mmb) return 'pan';
    if (ui.placement) return 'place';
    if (ui.targeting || actions.extraMode) return 'target';
    if (this.drag?.moved) return 'default';
    if (!hover) return 'default';
    const info = classifySelection(this.host.world, ui.selection);
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
    const { ui, actions, camera } = this.host;
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
      const dbl =
        !!hit && !!this.lastClick && now - this.lastClick.at <= DOUBLE_CLICK_MS && hit.kind !== 'resource' && this.lastClick.type === hit.type && this.lastClick.owner === hit.owner;
      actions.clickSelect(w.x, w.y, shift, dbl);
      this.lastClick = hit && hit.kind !== 'resource' && !dbl ? { at: now, type: hit.type, owner: hit.owner } : null;
    }
    this.hoverDirty = true;
  }

  private onPointerCancel(e: PointerEvent): void {
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
        actions.selectWarden();
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

function repeatable(a: KeyAction): boolean {
  return a.type === 'speed';
}
