/**
 * Pause menu (Esc, GDD §O / §B): Resume, Settings (volume, mute, edge pan), Sound the Retreat
 * (from 3:00, never in the boss battle; confirm) and Quit to Title (shows its Resolve cost).
 */
import { RETREAT } from '../../data/balance';
import { OBJECTIVES } from '../../data/objectives';
import type { BattleSetup, World } from '../../sim/types';
import { getEncounterView } from '../../sim/encounter';
import { clearChildren, h, setHidden, setText, toggleClass } from '../dom';
import { formatClock, formatCountdown } from '../format';

export interface MenuSettings {
  volume: number;
  muted: boolean;
  edgePan: boolean;
}

export interface PauseMenuHost {
  readonly world: World;
  readonly setup: BattleSetup;
  resume(): void;
  retreat(): void;
  quit(): void;
  settings(): MenuSettings;
  applySettings(s: Partial<MenuSettings>): void;
}

/** Retreat availability (§B: from 3:00, never in the boss battle). */
export function retreatState(world: World, setup: BattleSetup): { ok: boolean; reason?: string } {
  if (setup.isBoss || setup.objective === 'boss') return { ok: false, reason: 'There is no retreat from the Briar Throne.' };
  if (world.outcome !== 'ongoing') return { ok: false, reason: 'The battle is decided.' };
  if (world.time < RETREAT.availableFrom) {
    return { ok: false, reason: `The horns cannot sound before ${formatClock(RETREAT.availableFrom)} (${formatCountdown(RETREAT.availableFrom - world.time)} left).` };
  }
  return { ok: true };
}

/** Quick battles (?battle=, dev page) carry no run, so quitting costs nothing. */
function isQuickBattle(setup: BattleSetup): boolean {
  return setup.nodeId.startsWith('quick-');
}

/** One-line cost of quitting, shown under the Quit button. */
export function quitCostShort(setup: BattleSetup): string {
  if (isQuickBattle(setup)) return 'A quick battle: no march is at stake.';
  return setup.isBoss || setup.objective === 'boss'
    ? 'Your run is saved. Continuing restarts this battle at −1 Resolve.'
    : 'Your run is saved. Continuing counts as a Retreat: −1 Resolve.';
}

/** Setup-dependent cost of quitting mid-battle (§B Autosave). */
export function quitCostText(setup: BattleSetup): string {
  if (isQuickBattle(setup)) return 'This is a quick battle with no march attached. Quitting simply returns to the title.';
  if (setup.isBoss || setup.objective === 'boss') {
    return 'When you continue, this battle restarts with the same seed at −1 Resolve. At 0 Resolve the run ends.';
  }
  return 'When you continue, this battle counts as a Retreat: −1 Resolve, no plundered Crowns, and your Retinue as it was when you entered.';
}

export class PauseMenu {
  readonly el: HTMLDivElement;
  private readonly panel: HTMLElement;
  private open_ = false;
  private retreatBtn: HTMLButtonElement | null = null;
  private retreatNote: HTMLElement | null = null;
  private view: 'main' | 'settings' | 'retreat' | 'quit' = 'main';

  constructor(parent: HTMLElement, private readonly host: PauseMenuHost) {
    this.el = h('div', 'bt-menu-backdrop bt-hidden', parent);
    this.panel = h('div', 'bt-menu bt-panel', this.el);
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.target === this.el) this.host.resume();
    });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('wheel', (e) => e.stopPropagation());
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    this.open_ = true;
    setHidden(this.el, false);
    this.show('main');
  }

  close(): void {
    this.open_ = false;
    setHidden(this.el, true);
  }

  /** Esc inside a sub-view returns to the main view first. Returns true if handled. */
  back(): boolean {
    if (this.open_ && this.view !== 'main') {
      this.show('main');
      return true;
    }
    return false;
  }

  /** ~10 Hz while open: keep the Retreat countdown live. */
  update(): void {
    if (!this.open_ || this.view !== 'main' || !this.retreatBtn || !this.retreatNote) return;
    const st = retreatState(this.host.world, this.host.setup);
    this.retreatBtn.disabled = !st.ok;
    toggleClass(this.retreatBtn, 'disabled', !st.ok);
    setText(this.retreatNote, st.ok ? '−1 Resolve. Keep plundered Crowns and choose a Retinue from the survivors.' : st.reason ?? '');
  }

  private show(view: PauseMenu['view']): void {
    this.view = view;
    clearChildren(this.panel);
    this.retreatBtn = null;
    this.retreatNote = null;
    if (view === 'main') this.buildMain();
    else if (view === 'settings') this.buildSettings();
    else if (view === 'retreat') this.buildRetreat();
    else this.buildQuit();
  }

  private heading(title: string, sub?: string): void {
    h('div', 'bt-menu-title', this.panel, title);
    if (sub) h('div', 'bt-menu-sub', this.panel, sub);
    h('div', 'bt-menu-rule', this.panel);
  }

  private button(label: string, cls: string, onClick: () => void, note?: string): { btn: HTMLButtonElement; note: HTMLElement | null } {
    const wrap = h('div', 'bt-menu-item', this.panel);
    const btn = h('button', `bt-btn bt-menu-btn ${cls}`, wrap, label);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      if (!btn.disabled) onClick();
    });
    const n = note !== undefined ? h('div', 'bt-menu-note', wrap, note) : null;
    return { btn, note: n };
  }

  private buildMain(): void {
    const { world, setup } = this.host;
    this.heading('Paused', `${OBJECTIVES[setup.objective].name} · ${formatClock(world.time)}`);
    this.button('Resume', 'primary', () => this.host.resume());
    this.button('Settings', '', () => this.show('settings'));
    const r = this.button('Sound the Retreat', 'warn', () => this.show('retreat'), '');
    this.retreatBtn = r.btn;
    this.retreatNote = r.note;
    this.button('Quit to Title', 'danger', () => this.show('quit'), quitCostShort(setup));
    this.update();
    queueMicrotask(() => this.panel.querySelector<HTMLButtonElement>('.bt-menu-btn.primary')?.focus());
  }

  private buildSettings(): void {
    const s = this.host.settings();
    this.heading('Settings');
    const vol = h('label', 'bt-setting', this.panel);
    h('span', 'bt-setting-k', vol, 'Sound volume');
    const slider = h('input', 'bt-slider', vol);
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(s.volume * 100));
    const volVal = h('span', 'bt-setting-v', vol, `${slider.value}%`);
    slider.addEventListener('input', () => {
      setText(volVal, `${slider.value}%`);
      this.host.applySettings({ volume: Number(slider.value) / 100 });
    });
    const toggle = (label: string, value: boolean, apply: (v: boolean) => void): void => {
      const row = h('label', 'bt-setting', this.panel);
      h('span', 'bt-setting-k', row, label);
      const cb = h('input', 'bt-check', row);
      cb.type = 'checkbox';
      cb.checked = value;
      cb.addEventListener('change', () => apply(cb.checked));
    };
    toggle('Mute', s.muted, (v) => this.host.applySettings({ muted: v }));
    toggle('Edge panning', s.edgePan, (v) => this.host.applySettings({ edgePan: v }));
    h('div', 'bt-menu-rule', this.panel);
    this.button('Back', 'primary', () => this.show('main'));
  }

  private buildRetreat(): void {
    const { world, setup } = this.host;
    let crowns = 0;
    try {
      crowns = Math.floor(getEncounterView(world).plunderCrowns);
    } catch {
      /* view optional */
    }
    this.heading('Sound the Retreat?');
    h(
      'p',
      'bt-menu-text',
      this.panel,
      `The Hearthband falls back. You lose 1 Resolve, keep the ${crowns} Crowns plundered so far, and choose a Retinue from the survivors.`,
    );
    const row = h('div', 'bt-menu-row', this.panel);
    const yes = h('button', 'bt-btn bt-menu-btn warn', row, 'Sound the Retreat');
    yes.type = 'button';
    yes.addEventListener('click', () => {
      if (retreatState(world, setup).ok) this.host.retreat();
      else this.show('main');
    });
    const no = h('button', 'bt-btn bt-menu-btn', row, 'Stand and fight');
    no.type = 'button';
    no.addEventListener('click', () => this.show('main'));
  }

  private buildQuit(): void {
    this.heading('Quit to Title?');
    h('p', 'bt-menu-text', this.panel, quitCostText(this.host.setup));
    const row = h('div', 'bt-menu-row', this.panel);
    const yes = h('button', 'bt-btn bt-menu-btn danger', row, 'Quit to Title');
    yes.type = 'button';
    yes.addEventListener('click', () => this.host.quit());
    const no = h('button', 'bt-btn bt-menu-btn', row, 'Cancel');
    no.type = 'button';
    no.addEventListener('click', () => this.show('main'));
  }
}
