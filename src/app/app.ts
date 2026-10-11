/** Screen router + all non-battle screens. OWNER: screens. */
import '../styles/ui.css';
import '../styles/screens.css';
import '../styles/map.css';
import '../styles/ceremony.css';
import { BattleController } from '../game/battle';
import { getAudio } from '../audio/sfx';
import type { SfxName } from '../game/types';
import type { HouseId, ObjectiveId } from '../sim/types';
import type { MetaSave, RunState } from '../run/types';
import { realRunApi, type RunApi } from './api';
import type { AppCtx, BattleFactory, ConfirmOptions, Route, ScreenHandle, ScreenId } from './types';
import { h, type Child } from './dom';
import { Tooltips } from './ui/tooltip';
import { Overlays, type ModalHandle } from './ui/overlay';
import { openSettings } from './ui/settings';
import { mountScreen } from './screens';

type QuickBattleOpts = Parameters<RunApi['quickBattleSetup']>[0];

const OBJECTIVES_OK: readonly ObjectiveId[] = ['raze', 'holdfast', 'elite', 'boss', 'beacons'];

export interface AppDeps {
  api: RunApi;
  battleFactory: BattleFactory;
}

interface GameApiObject {
  [key: string]: unknown;
}

function gameObject(): GameApiObject {
  const w = window as unknown as { __game?: GameApiObject };
  if (!w.__game || typeof w.__game !== 'object') w.__game = {};
  return w.__game;
}

function parseIntParam(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

export class AppShell implements AppCtx {
  readonly api: RunApi;
  readonly battleFactory: BattleFactory;
  meta!: MetaSave;
  run: RunState | null = null;
  readonly tooltips: Tooltips;
  readonly overlays: Overlays;
  urlSeed: number | null = null;

  private readonly host: HTMLElement;
  private current: ScreenHandle | null = null;
  private currentId: ScreenId = 'title';
  private audioUnlocked = false;
  /** Guards endRun from being applied twice for the same run. */
  private endingRun: RunState | null = null;

  constructor(
    private readonly root: HTMLElement,
    deps: AppDeps,
  ) {
    this.api = deps.api;
    this.battleFactory = deps.battleFactory;
    root.classList.add('app-root');
    this.host = h('div', { class: 'screen-host' });
    const overlayHost = h('div', { class: 'overlay-host' });
    root.append(this.host, overlayHost);
    this.tooltips = new Tooltips(overlayHost);
    this.overlays = new Overlays(overlayHost);
  }

  get screen(): ScreenId {
    return this.currentId;
  }

  /** Load saves, install listeners and the debug API, and show the first screen. */
  boot(params: URLSearchParams = new URLSearchParams(window.location.search)): void {
    document.documentElement.classList.add('ui-scaled');
    try {
      this.meta = this.api.loadMeta();
    } catch (err) {
      this.fatal('The save could not be read.', err);
      return;
    }
    this.run = this.guard('loadRun', () => this.api.loadRun()) ?? null;
    this.urlSeed = parseIntParam(params.get('seed'));

    this.installGameApi();
    this.installInput();

    const battle = params.get('battle');
    if (battle && (OBJECTIVES_OK as readonly string[]).includes(battle)) {
      const depth = parseIntParam(params.get('depth')) ?? undefined;
      const seed = this.urlSeed ?? undefined;
      this.quickBattle({ objective: battle as ObjectiveId, depth, seed });
      return;
    }
    this.go({ screen: 'title' });
  }

  // ------------------------------------------------------------------ routing

  go(route: Route): void {
    this.tooltips.hide();
    this.overlays.closeAll();
    const prev = this.current;
    this.current = null;
    if (prev) {
      try {
        prev.destroy?.();
      } catch (err) {
        console.error('[app] screen destroy failed', err);
      }
      prev.el.remove();
    }
    this.currentId = route.screen;
    document.documentElement.classList.toggle('ui-scaled', route.screen !== 'battle');
    let handle: ScreenHandle;
    try {
      handle = mountScreen(this, route);
    } catch (err) {
      console.error(`[app] failed to mount ${route.screen}`, err);
      handle = this.errorScreen(`The ${route.screen} screen failed to open.`, err);
    }
    this.current = handle;
    this.host.appendChild(handle.el);
    handle.el.dataset.screen = route.screen;
    this.root.dataset.screen = route.screen;
    try {
      handle.mounted?.();
    } catch (err) {
      console.error(`[app] ${route.screen} mounted() failed`, err);
    }
    if (route.screen !== 'battle') this.installGameApi();
  }

  advance(): void {
    const run = this.run;
    if (!run) {
      this.go({ screen: 'title' });
      return;
    }
    if (run.over) {
      this.finishRun();
      return;
    }
    const step = this.guard('currentReward', () => this.api.currentReward(run));
    if (step) {
      this.go({ screen: step.kind === 'retinue' ? 'retinue' : 'reward' });
      return;
    }
    this.go({ screen: 'map' });
  }

  resume(): void {
    const run = this.run;
    if (!run) {
      this.go({ screen: 'title' });
      return;
    }
    if (run.over) {
      this.finishRun();
      return;
    }
    if (this.guard('currentReward', () => this.api.currentReward(run))) {
      this.advance();
      return;
    }
    const nodeId = run.currentNode;
    const node = nodeId ? run.map.nodes[nodeId] : null;
    if (node && nodeId && !run.nodesDone.includes(nodeId)) {
      if (node.type === 'battle' || node.type === 'elite' || node.type === 'boss') {
        const briefing = this.guard('getBriefing', () => this.api.getBriefing(run, this.meta, nodeId));
        if (briefing) {
          this.go({ screen: 'briefing', briefing });
          return;
        }
      } else if (node.type === 'camp') {
        this.go({ screen: 'camp' });
        return;
      } else if (node.type === 'peddler' && run.peddler) {
        this.go({ screen: 'peddler' });
        return;
      } else if (node.type === 'event') {
        const event = this.guard('currentEventView', () => this.api.currentEventView(run, this.meta));
        if (event) {
          this.go({ screen: 'event', event });
          return;
        }
      }
    }
    this.go({ screen: 'map' });
  }

  private finishRun(): void {
    const run = this.run;
    if (!run || this.endingRun === run) return;
    this.endingRun = run;
    const summary = this.guard('endRun', () => this.api.endRun(run, this.meta));
    this.run = null;
    if (summary) this.go({ screen: 'summary', summary });
    else this.go({ screen: 'title' });
  }

  startRun(opts: { house: HouseId; tier: number; seed?: number }): void {
    const run = this.guard('newRun', () => this.api.newRun(this.meta, opts));
    if (!run) return;
    this.run = run;
    this.endingRun = null;
    this.advance();
  }

  quickBattle(opts: QuickBattleOpts): void {
    const setup = this.guard('quickBattleSetup', () => this.api.quickBattleSetup(opts));
    if (!setup) {
      this.go({ screen: 'title' });
      return;
    }
    this.go({ screen: 'battle', setup, quick: true });
  }

  // ------------------------------------------------------------------ services

  click(): void {
    this.sfx('ui_click');
  }

  sfx(name: SfxName, volume?: number): void {
    try {
      getAudio().play(name, volume === undefined ? undefined : { volume });
    } catch {
      /* audio unavailable */
    }
  }

  persistMeta(): void {
    this.guard('saveMeta', () => this.api.saveMeta(this.meta));
  }

  applySettings(): void {
    try {
      const audio = getAudio();
      audio.setVolume(this.meta.settings.sfxVolume);
      audio.setMuted(this.meta.settings.muted);
    } catch {
      /* audio unavailable */
    }
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    this.overlays.toast(text, kind);
  }

  confirm(opts: ConfirmOptions): Promise<boolean> {
    return this.overlays.confirm(opts, () => this.click());
  }

  alert(title: string, text: string): Promise<void> {
    return this.overlays.alert(title, text, () => this.click());
  }

  modal(content: Child, opts?: { cls?: string; onEscape?: () => void }): ModalHandle {
    return this.overlays.open(content, opts);
  }

  openSettings(): void {
    this.click();
    openSettings(this);
  }

  guard<T>(label: string, fn: () => T): T | undefined {
    try {
      return fn();
    } catch (err) {
      console.error(`[app] ${label} failed`, err);
      this.toast(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, 'bad');
      return undefined;
    }
  }

  // ------------------------------------------------------------------ internals

  private installInput(): void {
    const unlock = (): void => {
      if (this.audioUnlocked) return;
      this.audioUnlocked = true;
      try {
        getAudio().unlock();
      } catch {
        /* audio unavailable */
      }
      this.applySettings();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    window.addEventListener('keydown', (e) => {
      if (this.currentId === 'battle') return;
      if (e.key === 'Escape' && this.overlays.escape()) {
        e.preventDefault();
        return;
      }
      if (this.overlays.hasModal) return;
      if (this.current?.onKey?.(e)) e.preventDefault();
    });
  }

  /** window.__game app-level API. Re-applied after battles in case the battle shell replaced the object. */
  private installGameApi(): void {
    const g = gameObject();
    g.screen = (): ScreenId => this.currentId;
    g.run = (): RunState | null => this.run;
    g.meta = (): MetaSave => this.meta;
    g.newRun = (opts: { house?: HouseId; tier?: number; seed?: number } = {}): RunState | null => {
      this.startRun({ house: opts.house ?? 'ardent', tier: opts.tier ?? 0, seed: opts.seed ?? this.urlSeed ?? undefined });
      return this.run;
    };
    g.quickBattle = (opts: QuickBattleOpts): void => this.quickBattle(opts);
  }

  private errorScreen(message: string, err: unknown): ScreenHandle {
    const el = h(
      'div',
      { class: 'scr' },
      h(
        'div',
        { class: 'panel studs panel-pad err-panel col' },
        h('h2', { class: 'display h2' }, 'The road is lost'),
        h('p', null, message),
        h('p', { class: 'small dim' }, err instanceof Error ? err.message : String(err)),
        h('div', { class: 'row', style: 'justify-content:center' }, h('button', { class: 'btn primary', onclick: () => this.go({ screen: 'title' }) }, 'Return to Title')),
      ),
    );
    return { el };
  }

  private fatal(message: string, err: unknown): void {
    console.error('[app] fatal', err);
    const el = h(
      'div',
      { class: 'scr' },
      h(
        'div',
        { class: 'panel studs panel-pad err-panel col' },
        h('h2', { class: 'display h2' }, 'Embermarch could not start'),
        h('p', null, message),
        h('p', { class: 'small dim' }, err instanceof Error ? err.message : String(err)),
      ),
    );
    this.host.appendChild(el);
  }
}

/** Real battle controller factory. */
const realBattleFactory: BattleFactory = (root, setup, callbacks, opts) => new BattleController(root, setup, callbacks, opts);

export function createApp(root: HTMLElement): void {
  const params = new URLSearchParams(window.location.search);
  if (import.meta.env.DEV && params.has('dev')) {
    void import('./dev/gallery').then((m) => m.runGallery(root, params));
    return;
  }
  const app = new AppShell(root, { api: realRunApi, battleFactory: realBattleFactory });
  app.boot(params);
}
