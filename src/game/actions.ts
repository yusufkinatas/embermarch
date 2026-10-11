/**
 * BattleActions: every player intent (selection, commands, modes, groups, camera jumps, toggles).
 * Keyboard, mouse, HUD buttons, minimap and the debug API all go through here, and the world is
 * mutated ONLY via issueCommand (ARCHITECTURE.md).
 */
import { ABILITIES } from '../data/balance';
import { BUILDINGS } from '../data/buildings';
import { HOUSES } from '../data/houses';
import type { Camera } from '../render/camera';
import { idleTillers, isTileExplored, pickEntityAt, playerMilitary, canPlaceBuilding, commandCard, unitsInRect, type CommandOption } from '../sim/queries';
import type { BattleSetup, Building, Command, CommandResult, Entity, PlayerBuildingId, PlayerUnitId, ResearchId, Unit, World } from '../sim/types';
import { ENEMY, PLAYER, TICK_RATE, Terrain } from '../sim/types';
import { issueCommand } from '../sim/world';
import type { AlertFeed } from './alerts';
import { formatCountdown } from './format';
import type { HintDirector } from './hints';
import {
  addToGroup,
  assignGroup,
  centroid,
  classifySelection,
  combineSelection,
  groupMembers,
  isOwnBuilding,
  isOwnUnit,
  nextInCycle,
  normalizeSelection,
  prioritizeBox,
  sameTypeInRect,
} from './selection';
import type { AudioSystem, BattleUIState, SfxName } from './types';
import { nextSpeed } from './loop';

export const DOUBLE_TAP_MS = 300;
export const DOUBLE_CLICK_MS = 350;
const DEMOLISH_CONFIRM_MS = 1600;

export interface ActionHost {
  readonly world: World;
  readonly ui: BattleUIState;
  readonly camera: Camera;
  readonly setup: BattleSetup;
  readonly audio: AudioSystem;
  readonly alerts: AlertFeed;
  readonly hints: HintDirector;
  /** Red error line + ui_error. */
  error(msg: string): void;
  /** Neutral notice line. */
  notice(msg: string): void;
  menuOpen(): boolean;
  openMenu(): void;
  closeMenu(): void;
  /** Battle over (banner showing): ignore orders. */
  ended(): boolean;
  /** Settings changed by a hotkey (mute). */
  onMuteChanged(muted: boolean): void;
  /** Ask the HUD to run its 10 Hz refresh on the next frame (selection changed). */
  invalidateHud?(): void;
}

/** Tillers reach a tree tile whose canopy overhangs the click point within this many tiles. */
export const CANOPY_REACH = 0.6;

/** Internal input modes not representable in BattleUIState.targeting. */
export type ExtraMode = null | { kind: 'rally' };

/** Placing these buildings means the player already learned the matching first-run hint. */
const PLACEMENT_HINTS: Partial<Record<PlayerBuildingId, string>> = {
  cottage: 'cottage',
  grainplot: 'grainplot',
  muster_hall: 'military_building',
  bowyard: 'military_building',
  paddock: 'military_building',
};

const CLASS_PITCH: Record<string, number> = { worker: 1.25, infantry: 1, ranged: 1.1, cavalry: 0.9, siege: 0.75, hero: 0.85, boss: 0.7 };

export class BattleActions {
  /** Rally-point targeting (from the command card). */
  extraMode: ExtraMode = null;
  /** True while the current placement session already placed one foundation (Shift keeps placing). */
  private placedThisSession = false;
  /** True once a Shift-queued attack-move was issued in the current attack-move mode. */
  private queuedAttackMove = false;
  private lastTap: { key: string; at: number } = { key: '', at: 0 };
  private lastIdleId = 0;
  private demolishArm: { ids: string; at: number } | null = null;

  constructor(private readonly host: ActionHost) {}

  private get world(): World {
    return this.host.world;
  }
  private get ui(): BattleUIState {
    return this.host.ui;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  issue(cmd: Command, silent = false): CommandResult {
    if (this.host.ended()) return { ok: false, reason: 'The battle is over' };
    let res: CommandResult;
    try {
      res = issueCommand(this.world, cmd);
    } catch (err) {
      console.error('[battle] issueCommand failed', err);
      res = { ok: false, reason: 'Command failed' };
    }
    if (!res.ok && !silent) this.host.error(res.reason ?? 'Cannot do that');
    return res;
  }

  private play(name: SfxName, opts?: { pitch?: number; volume?: number }): void {
    try {
      this.host.audio.play(name, opts);
    } catch {
      /* audio is optional */
    }
  }

  /** Own living units in the selection. */
  selectedUnits(): Unit[] {
    return classifySelection(this.world, this.ui.selection).units;
  }

  selectedBuildings(): Building[] {
    return classifySelection(this.world, this.ui.selection).buildings;
  }

  selectedTillers(): Unit[] {
    return this.selectedUnits().filter((u) => u.type === 'tiller');
  }

  private doubleTap(key: string): boolean {
    const now = performance.now();
    const dbl = this.lastTap.key === key && now - this.lastTap.at <= DOUBLE_TAP_MS;
    this.lastTap = dbl ? { key: '', at: 0 } : { key, at: now };
    return dbl;
  }

  /** Replace the selection (normalized) and play the select blip. */
  setSelection(ids: readonly number[], sound = true): void {
    const next = normalizeSelection(this.world, ids);
    this.ui.selection = next;
    this.cancelModes();
    // The command card must never act on the previous selection's options (B7).
    this.host.invalidateHud?.();
    if (sound && next.length) {
      const e = this.world.entities.get(next[0]);
      const cls = e && e.kind === 'unit' ? e.cls : 'infantry';
      this.play('select', { pitch: CLASS_PITCH[cls] ?? 1 });
    }
  }

  centerOn(x: number, y: number): void {
    this.host.camera.centerOn(x, y);
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  /** LMB click at a world point. `dbl` = double-click (select all of type on screen). */
  clickSelect(wx: number, wy: number, shift: boolean, dbl: boolean): Entity | null {
    const e = this.pick(wx, wy);
    if (!e) {
      if (!shift && this.ui.selection.length) this.setSelection([], false);
      return null;
    }
    let ids: number[];
    if (dbl && (isOwnUnit(e) || isOwnBuilding(e))) {
      ids = sameTypeInRect(this.world, e, this.host.camera.visibleRect());
      this.setSelection(shift ? combineSelection(this.world, this.ui.selection, ids, 'add') : ids);
      return e;
    }
    ids = [e.id];
    this.setSelection(combineSelection(this.world, this.ui.selection, ids, shift ? 'toggle' : 'replace'));
    return e;
  }

  /** Box select in world coordinates. */
  boxSelect(x0: number, y0: number, x1: number, y1: number, shift: boolean): void {
    let units: Unit[] = [];
    try {
      units = unitsInRect(this.world, x0, y0, x1, y1);
    } catch (err) {
      console.error('[battle] unitsInRect failed', err);
    }
    const ids = prioritizeBox(units).map((u) => u.id);
    if (!ids.length) {
      if (!shift) this.setSelection([], false);
      return;
    }
    this.setSelection(shift ? combineSelection(this.world, this.ui.selection, ids, 'add') : ids);
  }

  /** Select-panel helpers: sub-select one / remove one / keep a type. */
  subSelect(id: number): void {
    this.setSelection([id]);
  }
  removeFromSelection(id: number): void {
    this.setSelection(
      this.ui.selection.filter((x) => x !== id),
      false,
    );
  }
  keepType(type: string): void {
    this.setSelection(this.selectedUnits().filter((u) => u.type === type).map((u) => u.id));
  }

  deselect(): void {
    this.setSelection([], false);
  }

  selectHearth(): void {
    const id = this.world.hearthId;
    const e = id ? this.world.entities.get(id) : undefined;
    if (!e || !e.alive) {
      this.host.error('The Hearth has fallen');
      return;
    }
    const dbl = this.doubleTap('hearth');
    this.setSelection([id]);
    if (dbl) this.centerOn(e.x, e.y);
  }

  /** ` selects the Warden; Shift+` toggles the Warden in the current selection (like Shift+LMB). */
  selectWarden(add = false): void {
    const id = this.world.wardenId;
    const e = id ? this.world.entities.get(id) : undefined;
    if (!e || !e.alive) {
      const p = this.world.players[PLAYER];
      const left = p.wardenRespawnTick > 0 ? (p.wardenRespawnTick - this.world.tick) / TICK_RATE : 0;
      this.host.error(left > 0 ? `The Warden returns in ${formatCountdown(left)}` : 'The Warden has fallen');
      return;
    }
    const dbl = this.doubleTap('warden');
    if (add) {
      // A double-tap centres without toggling the Warden back out of the selection.
      if (!dbl || !this.ui.selection.includes(id)) this.setSelection(combineSelection(this.world, this.ui.selection, [id], 'toggle'));
    } else this.setSelection([id]);
    if (dbl) this.centerOn(e.x, e.y);
  }

  cycleIdleTiller(): void {
    let idle: Unit[] = [];
    try {
      idle = idleTillers(this.world);
    } catch (err) {
      console.error('[battle] idleTillers failed', err);
    }
    const next = nextInCycle(idle, this.lastIdleId);
    if (!next) {
      this.host.notice('No idle Tillers');
      return;
    }
    this.lastIdleId = next.id;
    this.setSelection([next.id]);
    this.centerOn(next.x, next.y);
  }

  selectAllMilitary(): void {
    let army: Unit[] = [];
    try {
      army = playerMilitary(this.world);
    } catch (err) {
      console.error('[battle] playerMilitary failed', err);
    }
    if (!army.length) {
      this.host.notice('No military units');
      return;
    }
    this.setSelection(army.map((u) => u.id));
  }

  // ---------------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------------

  groupOp(n: number, op: 'recall' | 'assign' | 'add'): void {
    if (op === 'assign') {
      if (assignGroup(this.world, this.ui, n, this.ui.selection)) {
        this.host.notice(`Group ${n} set`);
        this.play('ui_click');
        this.host.hints.complete('groups');
      } else this.host.error('Select your units or buildings first');
      return;
    }
    if (op === 'add') {
      if (addToGroup(this.world, this.ui, n, this.ui.selection)) {
        this.host.notice(`Added to group ${n}`);
        this.play('ui_click');
      } else this.host.error('Select your units or buildings first');
      return;
    }
    const members = groupMembers(this.world, this.ui, n);
    if (!members.length) return;
    const dbl = this.doubleTap(`g${n}`);
    this.setSelection(members);
    if (dbl) this.centerGroup(n);
  }

  centerGroup(n: number): void {
    const c = centroid(this.world, groupMembers(this.world, this.ui, n));
    if (c) this.centerOn(c.x, c.y);
  }

  jumpToAlert(): void {
    const a = this.host.alerts.lastPositioned;
    if (!a) {
      this.host.notice('No recent alerts');
      return;
    }
    this.centerOn(a.x, a.y);
  }

  // ---------------------------------------------------------------------------
  // Unit commands
  // ---------------------------------------------------------------------------

  /** RMB smart command (units) or rally (buildings) at a world point. */
  smartAt(wx: number, wy: number, queue: boolean, allowTarget = true): void {
    const info = classifySelection(this.world, this.ui.selection);
    const target = allowTarget ? this.pick(wx, wy) : null;
    if (info.kind === 'units') {
      const ids = info.units.map((u) => u.id);
      const tillers = info.units.filter((u) => u.type === 'tiller');
      // Canopy art overhangs the grass around a forest: a right-click just outside a tree still gathers it.
      const canopy = !target && tillers.length && !this.isTreeTile(wx, wy) ? this.canopyTreeAt(wx, wy) : null;
      if (canopy !== null) {
        const res = this.issue({ type: 'gather', unitIds: tillers.map((u) => u.id), target: { kind: 'tree', tile: canopy }, queue });
        const others = info.units.filter((u) => u.type !== 'tiller').map((u) => u.id);
        if (res.ok && others.length) this.issue({ type: 'move', unitIds: others, x: wx, y: wy, queue }, true);
        if (res.ok) {
          this.play('acknowledge');
          this.host.hints.signal('first_gather');
        }
        return;
      }
      const res = this.issue({ type: 'smart', unitIds: ids, x: wx, y: wy, targetId: target ? target.id : undefined, queue });
      if (res.ok) {
        this.play('acknowledge');
        const hasTiller = info.units.some((u) => u.type === 'tiller');
        if (hasTiller && (target?.kind === 'resource' || this.isForest(wx, wy) || (target?.kind === 'building' && target.type === 'grainplot'))) {
          this.host.hints.signal('first_gather');
        }
      }
      return;
    }
    if (info.kind === 'buildings') this.rallyAt(wx, wy, target);
  }

  rallyAt(wx: number, wy: number, target: Entity | null = this.pick(wx, wy)): void {
    const blds = this.selectedBuildings();
    if (!blds.length) return;
    const tile = this.isForest(wx, wy) ? Math.floor(wy) * this.world.map.w + Math.floor(wx) : undefined;
    const res = this.issue({
      type: 'rally',
      buildingIds: blds.map((b) => b.id),
      x: wx,
      y: wy,
      targetId: target && target.id !== blds[0].id ? target.id : undefined,
      tile,
    });
    if (res.ok) this.play('acknowledge');
  }

  attackMoveAt(wx: number, wy: number, queue: boolean): void {
    const units = this.selectedUnits();
    if (!units.length) return;
    const res = this.issue({ type: 'attackMove', unitIds: units.map((u) => u.id), x: wx, y: wy, queue });
    if (res.ok) this.play('acknowledge');
  }

  /**
   * A › click: on a visible enemy unit or a seen enemy building, a direct attack on it (Bowmen and
   * Coursers never auto-target buildings, so an attack-move would leave them idle beside a Nest);
   * anywhere else an attack-move to the point.
   */
  attackAt(wx: number, wy: number, queue: boolean): void {
    const hit = this.pick(wx, wy);
    if (!hit || hit.kind === 'resource' || hit.owner !== ENEMY || hit.untargetable) {
      this.attackMoveAt(wx, wy, queue);
      return;
    }
    const units = this.selectedUnits();
    if (!units.length) return;
    const res = this.issue({ type: 'attack', unitIds: units.map((u) => u.id), targetId: hit.id, queue });
    if (res.ok) this.play('acknowledge');
  }

  stop(): void {
    const units = this.selectedUnits();
    if (!units.length) return;
    if (this.issue({ type: 'stop', unitIds: units.map((u) => u.id) }).ok) this.play('acknowledge');
  }

  hold(): void {
    const units = this.selectedUnits();
    if (!units.length) return;
    if (this.issue({ type: 'hold', unitIds: units.map((u) => u.id) }).ok) this.play('acknowledge');
  }

  // ---------------------------------------------------------------------------
  // Command card
  // ---------------------------------------------------------------------------

  /** Current command card for the selection ([] for foreign or empty selections). */
  card(): CommandOption[] {
    const info = classifySelection(this.world, this.ui.selection);
    if (info.kind !== 'units' && info.kind !== 'buildings') return [];
    try {
      return commandCard(this.world, this.ui.selection);
    } catch (err) {
      console.error('[battle] commandCard failed', err);
      return [];
    }
  }

  /** Hotkey letter pressed: run the matching command-card option. Returns true if one matched. */
  cardKey(letter: string, shift: boolean): boolean {
    const opt = this.card().find((o) => o.hotkey.toUpperCase() === letter);
    if (!opt) return false;
    this.executeOption(opt, shift);
    return true;
  }

  executeOption(opt: CommandOption, shift: boolean): void {
    if (this.host.ended()) return;
    if (!opt.enabled) {
      this.host.error(opt.reason ?? `${opt.label} is unavailable`);
      return;
    }
    if (opt.id === 'rally_hearth') {
      if (this.issue({ type: 'rallyHearth' }).ok) {
        this.play('acknowledge');
        this.host.hints.complete('rally');
      }
      return;
    }
    switch (opt.kind) {
      case 'train': {
        const unit = opt.id as PlayerUnitId;
        const ids = this.selectedBuildings()
          .filter((b) => b.built && (BUILDINGS[b.type].trains ?? []).includes(unit))
          .map((b) => b.id);
        if (!ids.length) return;
        if (this.issue({ type: 'train', buildingIds: ids, unit, count: shift ? 5 : 1 }).ok) {
          this.play('ui_click');
          if (unit === 'tiller') this.host.hints.complete('train_tiller');
        }
        return;
      }
      case 'research': {
        const research = opt.id as ResearchId;
        const blds = this.selectedBuildings().filter((b) => b.built && (BUILDINGS[b.type].research ?? []).includes(research));
        const b = blds.find((x) => !x.research) ?? blds[0];
        if (!b) return;
        if (this.issue({ type: 'research', buildingId: b.id, research }).ok) this.play('ui_click');
        return;
      }
      case 'build':
        this.startPlacement(opt.id as PlayerBuildingId);
        return;
      case 'ability':
        this.ability(opt.id);
        return;
      case 'rally':
        this.cancelModes();
        this.extraMode = { kind: 'rally' };
        this.host.notice('Click to set the rally point');
        return;
      case 'demolish':
        this.demolishSelected();
        return;
      default:
        return;
    }
  }

  private ability(id: string): void {
    if (id === 'hawk') {
      this.cancelModes();
      this.ui.targeting = { kind: 'ability', slot: 'W', radius: ABILITIES.hawk.radius, range: Number.POSITIVE_INFINITY };
      return;
    }
    const house = HOUSES[this.host.setup.house];
    if (house?.abilityTargeted) {
      this.cancelModes();
      const fp = ABILITIES.firepot;
      this.ui.targeting = { kind: 'ability', slot: 'Q', radius: fp.radius, range: fp.range };
      return;
    }
    if (this.issue({ type: 'ability', slot: 'Q' }).ok) this.play('acknowledge');
  }

  /** Delete / Backspace: cancel foundations at once; demolishing a completed building needs a second press. */
  demolishSelected(): void {
    const blds = this.selectedBuildings();
    if (!blds.length) return;
    const foundations = blds.filter((b) => !b.built);
    const built = blds.filter((b) => b.built && b.type !== 'hearth');
    for (const b of foundations) this.issue({ type: 'demolish', buildingId: b.id });
    if (!built.length) {
      if (!foundations.length) this.host.error('The Hearth cannot be torn down');
      return;
    }
    const key = built.map((b) => b.id).join(',');
    const now = performance.now();
    if (this.demolishArm && this.demolishArm.ids === key && now - this.demolishArm.at <= DEMOLISH_CONFIRM_MS) {
      this.demolishArm = null;
      for (const b of built) this.issue({ type: 'demolish', buildingId: b.id });
      return;
    }
    this.demolishArm = { ids: key, at: now };
    const name = BUILDINGS[built[0].type].name;
    this.host.notice(`Press Delete again to tear down the ${name}${built.length > 1 ? 's' : ''}`);
  }

  cancelTrain(buildingId: number, index: number): void {
    if (this.issue({ type: 'cancelTrain', buildingId, index }).ok) this.play('ui_click');
  }

  cancelResearch(buildingId: number): void {
    if (this.issue({ type: 'cancelResearch', buildingId }).ok) this.play('ui_click');
  }

  // ---------------------------------------------------------------------------
  // Modes: placement, targeting
  // ---------------------------------------------------------------------------

  hasMode(): boolean {
    return !!this.ui.placement || !!this.ui.targeting || !!this.extraMode;
  }

  cancelModes(): void {
    this.ui.placement = null;
    this.ui.targeting = null;
    this.extraMode = null;
    this.placedThisSession = false;
    this.queuedAttackMove = false;
  }

  /**
   * Shift released: an attack-move mode that already queued Shift+click waypoints ends, so the next
   * plain left-click selects again instead of issuing one more attack-move.
   */
  shiftReleased(): void {
    if (this.ui.targeting?.kind === 'attackMove' && this.queuedAttackMove) this.cancelModes();
  }

  startAttackMove(): void {
    if (!this.selectedUnits().length) return;
    this.cancelModes();
    this.ui.targeting = { kind: 'attackMove' };
  }

  startPlacement(type: PlayerBuildingId): void {
    if (!this.selectedTillers().length) {
      this.host.error('Select Tillers to build');
      return;
    }
    this.cancelModes();
    this.ui.placement = { building: type, tx: 0, ty: 0, ok: false };
    const m = this.ui.mouseWorld;
    if (Number.isFinite(m.x)) this.updatePlacement(m.x, m.y);
  }

  /** Re-check the ghost at a world point (pointer move and ~10 Hz while placing). */
  updatePlacement(wx: number, wy: number): void {
    const p = this.ui.placement;
    if (!p) return;
    const def = BUILDINGS[p.building];
    const tx = Math.round(wx - def.w / 2);
    const ty = Math.round(wy - def.h / 2);
    let ok = false;
    let reason: string | undefined;
    try {
      const chk = canPlaceBuilding(this.world, p.building, tx, ty);
      ok = chk.ok;
      reason = chk.reason;
    } catch (err) {
      reason = 'Cannot place here';
    }
    this.ui.placement = { building: p.building, tx, ty, ok, reason };
  }

  placeAt(wx: number, wy: number, shift: boolean): void {
    const p = this.ui.placement;
    if (!p) return;
    this.updatePlacement(wx, wy);
    const cur = this.ui.placement!;
    if (!cur.ok) {
      this.host.error(cur.reason ?? 'Cannot build there');
      return;
    }
    const tillers = this.selectedTillers();
    if (!tillers.length) {
      this.host.error('Select Tillers to build');
      this.cancelModes();
      return;
    }
    // Shift-placing queues behind work the Tillers already have: a later foundation in this session,
    // or a build order from an earlier session (T+click, then Shift+C + Shift+click must not abandon
    // the first foundation). A gathering, moving or idle Tiller starts the build now.
    const queue = shift && (this.placedThisSession || tillers.some((u) => u.order.type === 'build' || u.queue.length > 0));
    const res = this.issue({
      type: 'build',
      unitIds: tillers.map((u) => u.id),
      building: cur.building,
      tx: cur.tx,
      ty: cur.ty,
      queue,
    });
    if (!res.ok) return;
    this.play('acknowledge');
    const taught = PLACEMENT_HINTS[cur.building];
    if (taught) this.host.hints.complete(taught);
    if (shift) {
      this.placedThisSession = true;
      this.updatePlacement(wx, wy);
    } else {
      this.cancelModes();
    }
  }

  /** LMB while a targeting mode is active. `allowTarget` false (minimap): A-clicks stay attack-moves. */
  targetAt(wx: number, wy: number, shift: boolean, allowTarget = true): void {
    if (this.extraMode?.kind === 'rally') {
      this.rallyAt(wx, wy);
      this.extraMode = null;
      return;
    }
    const t = this.ui.targeting;
    if (!t) return;
    if (t.kind === 'attackMove') {
      if (allowTarget) this.attackAt(wx, wy, shift);
      else this.attackMoveAt(wx, wy, shift);
      if (!shift) this.cancelModes();
      else this.queuedAttackMove = true;
      return;
    }
    const res = this.issue({ type: 'ability', slot: t.slot, x: wx, y: wy });
    if (res.ok) {
      this.play('acknowledge');
      this.ui.targeting = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Escape chain, toggles
  // ---------------------------------------------------------------------------

  /** Esc: cancel mode → close menu → deselect → open the pause menu. */
  escape(): void {
    if (this.host.menuOpen()) {
      this.host.closeMenu();
      return;
    }
    if (this.hasMode()) {
      this.cancelModes();
      return;
    }
    if (this.ui.selection.length) {
      this.deselect();
      return;
    }
    this.host.openMenu();
  }

  togglePause(): void {
    if (this.host.menuOpen()) {
      this.host.closeMenu();
      return;
    }
    this.ui.paused = !this.ui.paused;
    this.play('ui_click');
  }

  /** Speed buttons: change the speed and keep the pause state (AoE2 behaviour). */
  setSpeed(s: number): void {
    const changed = s !== this.ui.speed;
    this.ui.speed = s;
    if (this.ui.paused) this.host.notice(`Speed ${s}× · still paused`);
    else if (changed) this.host.notice(`Speed ${s}×`);
  }

  stepSpeed(dir: -1 | 1): void {
    const next = nextSpeed(this.ui.speed, dir);
    if (next !== this.ui.speed) {
      this.ui.speed = next;
      this.host.notice(this.ui.paused ? `Speed ${next}× · still paused` : `Speed ${next}×`);
    }
  }

  toggleMute(): void {
    const a = this.host.audio;
    try {
      a.setMuted(!a.muted);
      this.host.onMuteChanged(a.muted);
      this.host.notice(a.muted ? 'Sound off' : 'Sound on');
    } catch {
      /* audio optional */
    }
  }

  setCounterWheel(on: boolean): void {
    this.ui.showCounterWheel = on;
    if (on) this.host.hints.complete('counters');
  }

  // ---------------------------------------------------------------------------
  // Picking
  // ---------------------------------------------------------------------------

  pick(wx: number, wy: number): Entity | null {
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
    try {
      return pickEntityAt(this.world, wx, wy);
    } catch {
      return null;
    }
  }

  isForest(wx: number, wy: number): boolean {
    const { map } = this.world;
    const tx = Math.floor(wx);
    const ty = Math.floor(wy);
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
    return map.terrain[ty * map.w + tx] === Terrain.Forest;
  }

  /** A forest tile that still has Timber (what the sim's smart command gathers). */
  isTreeTile(wx: number, wy: number): boolean {
    if (!this.isForest(wx, wy)) return false;
    const { map } = this.world;
    return map.treeAmount[Math.floor(wy) * map.w + Math.floor(wx)] > 0;
  }

  /**
   * Nearest explored tree tile (Timber left) whose tile rect lies within CANOPY_REACH of a point,
   * or null. Used for right-clicks on the canopy overhang just outside a forest.
   */
  canopyTreeAt(wx: number, wy: number): number | null {
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
    const { map } = this.world;
    const cx = Math.floor(wx);
    const cy = Math.floor(wy);
    let best: number | null = null;
    let bestD = CANOPY_REACH;
    for (let ty = cy - 1; ty <= cy + 1; ty++) {
      for (let tx = cx - 1; tx <= cx + 1; tx++) {
        if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
        const tile = ty * map.w + tx;
        if (map.terrain[tile] !== Terrain.Forest || map.treeAmount[tile] <= 0) continue;
        let explored = true;
        try {
          explored = isTileExplored(this.world, tx, ty);
        } catch {
          /* fog unavailable: allow */
        }
        if (!explored) continue;
        const dx = Math.max(tx - wx, 0, wx - (tx + 1));
        const dy = Math.max(ty - wy, 0, wy - (ty + 1));
        const d = Math.hypot(dx, dy);
        if (d <= bestD) {
          bestD = d;
          best = tile;
        }
      }
    }
    return best;
  }
}

