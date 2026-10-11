/**
 * Battle HUD root (GDD §O): builds the overlay DOM, routes drained sim events to alerts / markers /
 * horn / hints, and refreshes widgets (cheap text every frame, everything else at ~10 Hz with
 * diffed writes).
 */
import { BOSS } from '../../data/balance';
import { getEncounterView } from '../../sim/encounter';
import type { AlertKind, GameEvent, PlayerBuildingId, UnitId, World } from '../../sim/types';
import { PLAYER } from '../../sim/types';
import { AlertFeed, LossNotices, THREAT_KINDS, ThreatMarkers, UNATTENDED_TEXT, UnattendedFoundations, type AlertItem } from '../alerts';
import { h, toggleClass } from '../dom';
import { formatCountdown, normalizePct } from '../format';
import type { HintDirector } from '../hints';
import { AlertFeedView } from './alertFeed';
import { BossBar } from './bossbar';
import { CoachBox } from './coach';
import { CommandCard } from './commandCard';
import type { HudContext } from './context';
import { CounterWheel } from './counterWheel';
import { EdgeArrows } from './edgeArrows';
import { GroupSlots } from './groups';
import { WaveHorn } from './horn';
import { Minimap } from './minimap';
import { Banner, Callout, Countdown, NoticeLine, PausedLabel } from './overlays';
import { PauseMenu, type PauseMenuHost } from './pauseMenu';
import { SelectionPanel } from './selectionPanel';
import { TopBar } from './topbar';
import { Tooltip } from './tooltip';
import { Tracker } from './tracker';

export const TOP_BAR_PX = 32;
export const BOTTOM_PANEL_PX = 170;
const SLOW_INTERVAL = 0.1;

const MILITARY_BUILDINGS: ReadonlySet<PlayerBuildingId> = new Set<PlayerBuildingId>(['muster_hall', 'bowyard', 'paddock', 'siegeyard']);

/** Largest HUD scale (2560×1440 and up). */
export const HUD_SCALE_MAX = 1.6;

/** Smallest HUD scale: 0.85 on desktop sizes, 0.6 on phones (shortest side under 500 px). */
export const HUD_SCALE_MIN = 0.85;
export const HUD_SCALE_PHONE = 0.6;

/**
 * HUD scale for a viewport: 1 at 1280×720, growing with the viewport to 1.6 at 2560×1440 and up.
 * Phones (landscape iPhone 734×343) go down to 0.6 so the bottom panel leaves room for the field.
 */
export function hudScale(w: number, hgt: number): number {
  const s = Math.min(w / 1280, hgt / 720);
  const min = Math.min(w, hgt) < 500 ? HUD_SCALE_PHONE : HUD_SCALE_MIN;
  return Math.max(min, Math.min(HUD_SCALE_MAX, s));
}

/** Default camera zoom for a viewport height: 1 up to 900 px, growing to 1.4 at 1260 px and up. */
export function startZoom(viewH: number): number {
  return Math.max(1, Math.min(1.4, viewH / 900));
}

/** Camera max zoom: tall viewports (2560×1440) may zoom in further. */
export function maxZoomFor(viewH: number): number {
  return viewH > 1200 ? 1.8 : 1.5;
}

/** The free scout Courser is reported lost even on screen during the opening (GDD §B scout). */
const SCOUT_WINDOW = 120;

export interface HudHooks {
  /** The bottom of the top HUD band (top bar + tracker / Horn / boss bar) moved, in CSS px. */
  topBand?(px: number): void;
  openMenu(): void;
  dismissHint(): void;
  /** A hint became seen (dismissed, completed by the player's action, or replaced). */
  hintSeen(id: string): void;
}

export class Hud {
  readonly el: HTMLDivElement;
  readonly tooltip: Tooltip;
  readonly alerts: AlertFeed;
  readonly markers = new ThreatMarkers();
  readonly menu: PauseMenu;
  readonly banner: Banner;
  readonly minimap: Minimap;
  private readonly ctx: HudContext;
  private readonly top: TopBar;
  private readonly horn: WaveHorn;
  private readonly boss: BossBar;
  private readonly coach: CoachBox;
  private readonly tracker: Tracker;
  private readonly alertView: AlertFeedView;
  private readonly arrows: EdgeArrows;
  private readonly groups: GroupSlots;
  private readonly selection: SelectionPanel;
  private readonly card: CommandCard;
  private readonly wheel: CounterWheel;
  private readonly countdown: Countdown;
  private readonly paused: PausedLabel;
  private readonly notice: NoticeLine;
  private readonly callout: Callout;
  private slowAcc = SLOW_INTERVAL;
  private viewFailed = false;
  private readonly topCenter: HTMLElement;
  private topBandPx = -1;
  private readonly unattended = new UnattendedFoundations();
  private readonly losses = new LossNotices();
  private lossItem: AlertItem | null = null;
  /** The free Courser(s) present at battle start (not carried Retinue). */
  private readonly scoutIds = new Set<number>();
  /** Near-Hearth Thickets at battle start (grainplot hint). */
  private readonly nearThickets: { ids: number[]; total: number };

  constructor(
    parent: HTMLElement,
    ctx: Omit<HudContext, 'tooltip' | 'view' | 'now' | 'scale'>,
    private readonly hints: HintDirector,
    alerts: AlertFeed,
    menuHost: PauseMenuHost,
    private readonly hooks: HudHooks,
  ) {
    this.el = h('div', 'bt-hud', parent);
    this.tooltip = new Tooltip(this.el);
    this.alerts = alerts;
    this.ctx = { ...ctx, tooltip: this.tooltip, view: null, now: 0, scale: 1 };
    const c = this.ctx;

    this.arrows = new EdgeArrows(this.el, c, this.markers);
    this.top = new TopBar(this.el, c, { openMenu: () => hooks.openMenu() });
    const topCenter = h('div', 'bt-topcenter', this.el);
    this.topCenter = topCenter;
    this.horn = new WaveHorn(topCenter, c);
    this.boss = new BossBar(topCenter, c);
    this.coach = new CoachBox(topCenter, () => hooks.dismissHint());
    this.tracker = new Tracker(this.el, c);
    this.alertView = new AlertFeedView(this.el, c, alerts);

    const bottom = h('div', 'bt-bottom', this.el);
    this.minimap = new Minimap(bottom, c);
    const center = h('div', 'bt-center', bottom);
    this.groups = new GroupSlots(center, c);
    this.selection = new SelectionPanel(center, c);
    this.notice = new NoticeLine(center);
    this.card = new CommandCard(bottom, c);

    this.wheel = new CounterWheel(this.el);
    this.countdown = new Countdown(this.el);
    this.paused = new PausedLabel(this.el);
    this.callout = new Callout(this.el);
    this.banner = new Banner(this.el);
    this.menu = new PauseMenu(this.el, menuHost);
    // The tooltip floats above everything.
    this.el.appendChild(this.tooltip.el);

    this.nearThickets = this.collectNearThickets(ctx.world);
    // The free scout (Unit.free, sim S10); a starting Courser that is not carried Retinue counts too.
    for (const u of ctx.world.units) {
      if (u.alive && u.owner === PLAYER && (u.free === true || (u.type === 'courser' && !u.carried))) this.scoutIds.add(u.id);
    }
  }

  get context(): HudContext {
    return this.ctx;
  }

  /** Apply the HUD scale (CSS var) for a viewport size; returns the scale. */
  layout(w: number, hgt: number, dpr: number): number {
    const s = hudScale(w, hgt);
    this.ctx.scale = s;
    this.el.style.setProperty('--s', s.toFixed(3));
    // Phones (scale under the desktop floor): compact command-card costs and top-column widths.
    toggleClass(this.el, 'phone', s < HUD_SCALE_MIN);
    this.minimap.resize(s, dpr);
    this.measureTopBand();
    return s;
  }

  /**
   * Measure the bottom of the top HUD band: the objective tracker column (top right: the card plus the
   * Boon and modifier rows under it), which also reaches below the collapsed Horn. The battle camera
   * lets a pan bring the map's top rows out from under it (B7). The coach card and the Horn callout
   * come and go, so they are left out (a moving clamp would make the view jump on the next pan).
   */
  measureTopBand(): void {
    const r = this.tracker.el.getBoundingClientRect();
    if (!(r.height > 0)) return;
    const px = Math.round(r.bottom - this.el.getBoundingClientRect().top);
    if (Math.abs(px - this.topBandPx) < 1) return;
    this.topBandPx = px;
    this.hooks.topBand?.(px);
  }

  error(msg: string, now: number): void {
    this.notice.show(msg, 'error', now);
  }

  info(msg: string, now: number): void {
    this.notice.show(msg, 'info', now);
  }

  /** Per-frame refresh; heavy widgets throttle to ~10 Hz. */
  update(dt: number, now: number, menuOpen: boolean): void {
    const c = this.ctx;
    c.now = now;
    this.top.updateFast();
    this.arrows.update();
    const pausedNow = c.ui.paused && !menuOpen && c.world.outcome === 'ongoing';
    this.countdown.update(c.world.countdown, now, c.world.time, c.ui.paused || menuOpen);
    this.paused.update(pausedNow);
    this.top.setPaused(pausedNow);
    this.wheel.setVisible(c.ui.showCounterWheel && !menuOpen);
    this.notice.update(now);
    this.callout.update(now, this.banner.visible);
    this.arrows.setLabelsHidden(this.callout.visible || this.banner.visible);
    this.slowAcc += dt;
    if (this.slowAcc >= SLOW_INTERVAL) {
      this.slowAcc = 0;
      this.slowUpdate(now);
    }
  }

  /** Force the next frame to run the 10 Hz refresh (after a debug step or selection change). */
  invalidate(): void {
    this.slowAcc = SLOW_INTERVAL;
  }

  private slowUpdate(now: number): void {
    const c = this.ctx;
    try {
      c.view = getEncounterView(c.world);
    } catch (err) {
      c.view = null;
      if (!this.viewFailed) console.error('[battle] getEncounterView failed', err);
      this.viewFailed = true; // log once, keep retrying
    }
    this.top.update();
    this.horn.update();
    this.boss.update();
    this.tracker.update();
    this.minimap.update();
    this.groups.update();
    this.selection.update();
    this.card.update();
    this.updateUnattended(now);
    this.flushLosses(now);
    this.alertView.update();
    this.menu.update();
    this.updateMarkers();
    this.arrows.setAvoid(this.topCenterRect());
    this.measureTopBand();
    this.updateHints(now);
    this.tooltip.refresh();
  }

  private updateHints(now: number): void {
    const { world } = this.ctx;
    const p = world.players[PLAYER];
    let military = 0;
    for (const b of world.buildings) if (b.alive && b.owner === PLAYER && MILITARY_BUILDINGS.has(b.type as PlayerBuildingId)) military++;
    this.hints.evaluate({
      time: world.time,
      countdown: world.countdown,
      timber: p.res.timber,
      pop: p.pop,
      popCap: p.popCap,
      militaryBuildings: military,
      nearThicketFrac: this.nearThicketFrac(world),
    });
    const { current } = this.hints.update(now);
    for (const id of this.hints.drainSeen()) this.hooks.hintSeen(id);
    this.coach.show(world.outcome === 'ongoing' ? current : null);
  }

  /** Refresh after a hint was dismissed. */
  refreshHint(now: number): void {
    const { current } = this.hints.update(now);
    for (const id of this.hints.drainSeen()) this.hooks.hintSeen(id);
    this.coach.show(current);
  }

  private collectNearThickets(world: World): { ids: number[]; total: number } {
    const hearth = world.entities.get(world.hearthId);
    const hx = hearth ? hearth.x : world.anchors.hearth.tx + 2;
    const hy = hearth ? hearth.y : world.anchors.hearth.ty + 2;
    const ids: number[] = [];
    let total = 0;
    for (const r of world.resources) {
      if (r.type !== 'thicket' || !r.alive) continue;
      if (Math.hypot(r.x - hx, r.y - hy) <= 8.5) {
        ids.push(r.id);
        total += r.initial;
      }
    }
    return { ids, total };
  }

  private nearThicketFrac(world: World): number | null {
    if (!this.nearThickets.total) return null;
    let left = 0;
    for (const id of this.nearThickets.ids) {
      const r = world.entities.get(id);
      if (r && r.alive && r.kind === 'resource') left += r.amount;
    }
    return left / this.nearThickets.total;
  }

  private updateMarkers(): void {
    const v = this.ctx.view;
    if (!v) return;
    // The Horn reports the live wave centroid while advancing: the launch chevron follows it.
    const horn = v.horn;
    if (horn && horn.phase === 'advancing') {
      const m = this.markers.items.find((x) => x.key === `wave:${horn.wave}`);
      if (m) {
        m.x = horn.x;
        m.y = horn.y;
      }
    }
    for (const m of this.markers.items.slice()) {
      if (!m.key.startsWith('spent:')) continue;
      const id = Number(m.key.slice(6));
      const n = v.nests.find((x) => x.id === id);
      // Grace period: the waveBroken event can arrive before the view reports the Nest as Spent.
      const age = this.ctx.now - (m.since ?? 0);
      if (n && (!n.alive || !n.spent) && age > 2) this.markers.remove(m.key);
      else if (n && n.spent) m.label = `Spent ${formatCountdown(n.spentRemaining)} · ${this.tilesFromHearth(n.x, n.y)} tiles`;
    }
  }

  /** Whole tiles from the Hearth centre to a point (Spent marker distance). */
  private tilesFromHearth(x: number, y: number): number {
    const { world } = this.ctx;
    const hearth = world.entities.get(world.hearthId);
    const hx = hearth ? hearth.x : world.anchors.hearth.tx + 2;
    const hy = hearth ? hearth.y : world.anchors.hearth.ty + 2;
    return Math.round(Math.hypot(x - hx, y - hy));
  }

  /** Top-centre column (Horn, Spent ribbon, boss bar, coach) in HUD-local CSS px, or null when empty. */
  private topCenterRect(): { x0: number; y0: number; x1: number; y1: number } | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const base = this.el.getBoundingClientRect();
    // Measure the visible pieces (the column itself spans the widest child, even if hidden).
    for (const el of this.topCenter.querySelectorAll<HTMLElement>('.bt-horn, .bt-spent, .bt-boss, .bt-coach')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      x0 = Math.min(x0, r.left - base.left);
      y0 = Math.min(y0, r.top - base.top);
      x1 = Math.max(x1, r.right - base.left);
      y1 = Math.max(y1, r.bottom - base.top);
    }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
  }

  /** Is a world point inside the visible playfield (between the top bar and the bottom panel)? */
  private onScreen(x: number, y: number): boolean {
    const cam = this.ctx.camera;
    const p = cam.worldToScreen(x, y);
    return p.x >= 0 && p.x <= cam.viewW && p.y >= cam.topInset && p.y <= cam.viewH - cam.bottomInset;
  }

  /** Minimap ping through the renderer's alert-ping path. */
  private ping(x: number, y: number, kind: AlertKind): void {
    try {
      this.ctx.renderer.handleEvents([{ t: 'alert', kind, text: '', x, y }], this.ctx.world);
    } catch {
      /* pings are cosmetic */
    }
  }

  /** Foundations nobody is building: one notice each after 15 s (Space jumps there). */
  private updateUnattended(now: number): void {
    const { world } = this.ctx;
    if (world.outcome !== 'ongoing' || world.countdown > 0) return;
    for (const b of this.unattended.update(world)) {
      this.alerts.push({ kind: 'info', tone: 'warn', text: UNATTENDED_TEXT, x: b.x, y: b.y }, now);
      this.ping(b.x, b.y, 'info');
    }
  }

  /** A player soldier died: off-screen, or the free scout in the opening, becomes a "lost" notice. */
  private onUnitDeath(id: number, type: UnitId, x: number, y: number, now: number): void {
    const { world } = this.ctx;
    if (world.outcome !== 'ongoing' || type === 'tiller' || type === 'warden') return;
    const scout = this.scoutIds.has(id) || (type === 'courser' && world.time <= SCOUT_WINDOW);
    this.scoutIds.delete(id);
    if (!scout && this.onScreen(x, y)) return;
    this.losses.record(type, x, y, now);
  }

  private flushLosses(now: number): void {
    const u = this.losses.flush(now);
    if (!u) return;
    if (u.kind === 'update' && this.lossItem && this.alerts.items.includes(this.lossItem)) {
      this.alerts.revise(this.lossItem, u, now);
    } else {
      this.lossItem = this.alerts.push({ kind: 'info', tone: 'danger', text: u.text, x: u.x, y: u.y }, now);
    }
    this.ping(u.x, u.y, 'under_attack');
  }

  /** Route drained sim events. `now` is real time. */
  handleEvents(events: GameEvent[], now: number): void {
    const c = this.ctx;
    for (const ev of events) {
      switch (ev.t) {
        case 'alert': {
          this.alerts.push(ev, now);
          if (THREAT_KINDS.has(ev.kind) && ev.x !== undefined && ev.y !== undefined) {
            this.markers.set({ key: `alert:${ev.kind}`, x: ev.x, y: ev.y, tone: 'threat', label: '', until: now + 7 });
          }
          break;
        }
        case 'waveMuster':
          if (ev.wave === 1) this.hints.signal('wave1_muster');
          this.markers.set({ key: `muster:${ev.nestId}`, x: ev.x, y: ev.y, tone: 'muster', label: `Wave ${ev.wave}`, until: now + 6 });
          break;
        case 'waveLaunch':
          if (ev.wave === 1) this.hints.signal('wave1_launch');
          this.markers.remove(`muster:${ev.nestId}`);
          this.markers.set({ key: `wave:${ev.wave}`, x: ev.x, y: ev.y, tone: 'threat', label: `Wave ${ev.wave}`, until: now + 10 });
          break;
        case 'raidLaunch':
          this.markers.set({ key: 'raid', x: ev.x, y: ev.y, tone: 'threat', label: 'Raid', until: now + 8 });
          break;
        case 'waveBroken': {
          if (ev.wave === 1) this.hints.signal('wave1_broken');
          this.markers.remove(`wave:${ev.wave}`);
          this.horn.addSpent(ev.nestId, ev.wave);
          const nest = c.world.entities.get(ev.nestId) ?? c.view?.nests.find((n) => n.id === ev.nestId);
          if (nest) this.markers.set({ key: `spent:${ev.nestId}`, x: nest.x, y: nest.y, tone: 'spent', label: 'Spent', until: now + 90, since: now });
          break;
        }
        case 'nestDestroyed':
          this.horn.popup(normalizePct(ev.wavePct));
          this.markers.remove(`spent:${ev.id}`);
          break;
        case 'trained':
          if (ev.type !== 'tiller') this.hints.signal('first_military');
          break;
        case 'death':
          if (ev.kind === 'unit' && ev.owner === PLAYER) this.onUnitDeath(ev.id, ev.type as UnitId, ev.x, ev.y, now);
          break;
        case 'hit':
          if (ev.popup === 'counter') this.hints.signal('first_counter_popup');
          break;
        case 'command':
          if (ev.kind === 'gather') this.hints.signal('first_gather');
          break;
        case 'lastStand':
          this.callout.show('Last Stand', 'The Flame endures. −1 Resolve', now);
          break;
        case 'bossPhase':
          if (ev.phase === 2) {
            // At 8:00 with Root Hearts standing the Regent tears free in Wrath instead of being uprooted.
            let wrath = false;
            try {
              wrath = !!(getEncounterView(c.world).boss as { wrath?: boolean } | null)?.wrath;
            } catch {
              wrath = false;
            }
            if (wrath) this.callout.show('Wrath', `The Regent tears free. +${BOSS.wrathDamagePct}% damage.`, now, 'thorn');
            else this.callout.show('The Regent Uprooted', 'It marches on your Hearth.', now, 'thorn');
          }
          break;
        default:
          break;
      }
    }
    this.flushLosses(now);
  }
}
