/**
 * Selection panel (bottom center, GDD §O):
 * - single unit: portrait, name, HP, ATK / armor / range / speed, rank chevrons, Strong/Weak class
 *   icons, carried load, current order, active effects
 * - group: up to 30 type-grouped icons with HP bars (click sub-selects, Shift-click removes,
 *   Ctrl-click keeps that type)
 * - building: HP, build progress, 5-slot queue with progress (click cancels), research, rally
 * - foreign entities (enemy, neutral objects, resources): read-only info
 */
import { BUILDINGS } from '../../data/buildings';
import { PLAYER_UNIT_IDS } from '../../data/ids';
import { RESEARCH } from '../../data/research';
import { RESOURCE_NODES } from '../../data/resources';
import { CLASS_NAMES, RANK_NAMES, RESOURCE_NAMES } from '../../data/text';
import { UNITS } from '../../data/units';
import { buildingStats, unitStats } from '../../sim/stats';
import type { Building, Entity, ResourceNode, Unit, UnitClass, World } from '../../sim/types';
import { ENEMY, PLAYER } from '../../sim/types';
import { clearChildren, h, setBar, setBgImage, setHidden, setHtml, setText, toggleClass } from '../dom';
import { formatCountdown, plural } from '../format';
import { CLASS_GLYPH, GLYPHS, iconSrc } from '../glyphs';
import { classifySelection } from '../selection';
import type { HudContext } from './context';

const MAX_CELLS = 30;

type Mode = 'empty' | 'unit' | 'group' | 'building' | 'resource';

function entityName(e: Entity): string {
  if (e.kind === 'unit') return UNITS[e.type]?.name ?? e.type;
  if (e.kind === 'building') return BUILDINGS[e.type]?.name ?? e.type;
  return RESOURCE_NODES[e.type]?.name ?? e.type;
}

function resOfGather(world: World, u: Unit): string {
  if (u.order.type !== 'gather') return '';
  const t = u.order.target;
  if (t.kind === 'tree') return RESOURCE_NAMES.timber;
  if (t.kind === 'plot') return RESOURCE_NAMES.grain;
  const n = world.entities.get(t.id);
  return n && n.kind === 'resource' ? RESOURCE_NAMES[n.resType] : 'resources';
}

/** Human-readable current order. */
export function orderText(world: World, u: Unit): string {
  const o = u.order;
  switch (o.type) {
    case 'idle':
      return u.cls === 'worker' ? 'Idle' : 'Standing ready';
    case 'move':
      return 'Moving';
    case 'attackMove':
      return 'Attack-moving';
    case 'attack': {
      const t = world.entities.get(o.targetId);
      return t ? `Attacking ${entityName(t)}` : 'Attacking';
    }
    case 'gather': {
      const res = resOfGather(world, u);
      if (o.phase === 'toDropoff') return `Hauling ${res}`;
      if (o.phase === 'toNode') return `Heading to gather ${res}`;
      return `Gathering ${res}`;
    }
    case 'deposit':
      return 'Hauling to a drop-off';
    case 'build': {
      const b = world.entities.get(o.buildingId);
      if (b && b.kind === 'building') return b.built ? `Repairing the ${BUILDINGS[b.type].name}` : `Building a ${BUILDINGS[b.type].name}`;
      return 'Building';
    }
    case 'hold':
      return 'Holding ground';
    case 'flee':
      return 'Fleeing to safety';
    default:
      return '';
  }
}

const BUFF_NAMES: Record<string, string> = {
  rallying_horn: 'Rallying Horn',
  harvest_hymn: 'Harvest Hymn',
  rally_hearth: 'Rallied',
  rooted: 'Rooted',
  enrage: 'Enraged',
  last_stand: 'Last Stand',
};

function classIcons(classes: UnitClass[]): string {
  return classes.map((c) => `<span class="bt-cls" title="${CLASS_NAMES[c]}">${GLYPHS[CLASS_GLYPH[c]]}</span>`).join('');
}

function setPortrait(el: HTMLElement, type: string, owner: number): void {
  setBgImage(el, iconSrc(type, owner as 0 | 1 | 2, 64));
  if (!el.classList.contains('has-img')) setText(el, type.slice(0, 2).toUpperCase());
  else setText(el, '');
}

interface UnitView {
  portrait: HTMLElement;
  rank: HTMLElement;
  name: HTMLElement;
  role: HTMLElement;
  hpFill: HTMLElement;
  hpText: HTMLElement;
  order: HTMLElement;
  stats: Record<'atk' | 'arm' | 'rng' | 'spd', HTMLElement>;
  kills: HTMLElement;
  strong: HTMLElement;
  weak: HTMLElement;
  effects: HTMLElement;
}

interface BuildingView {
  portrait: HTMLElement;
  count: HTMLElement;
  name: HTMLElement;
  hpFill: HTMLElement;
  hpText: HTMLElement;
  status: HTMLElement;
  progressWrap: HTMLElement;
  progressFill: HTMLElement;
  queueRow: HTMLElement;
  queue: { btn: HTMLButtonElement; icon: HTMLElement; fill: HTMLElement }[];
  research: { btn: HTMLButtonElement; icon: HTMLElement; fill: HTMLElement; label: HTMLElement };
  rally: HTMLElement;
}

interface Cell {
  id: number;
  btn: HTMLButtonElement;
  fill: HTMLElement;
}

export class SelectionPanel {
  readonly el: HTMLDivElement;
  private key = '';
  private unitView: UnitView | null = null;
  private bView: BuildingView | null = null;
  private cells: Cell[] = [];
  private summary: HTMLElement | null = null;
  private resView: { name: HTMLElement; fill: HTMLElement; text: HTMLElement; status: HTMLElement; portrait: HTMLElement } | null = null;

  constructor(parent: HTMLElement, private readonly ctx: HudContext) {
    this.el = h('div', 'bt-selection bt-panel', parent);
    this.build('empty', []);
  }

  update(): void {
    const { world, ui } = this.ctx;
    const info = classifySelection(world, ui.selection);
    let mode: Mode = 'empty';
    let ids: number[] = [];
    if (info.kind === 'units') {
      ids = info.units.map((u) => u.id);
      mode = ids.length === 1 ? 'unit' : 'group';
    } else if (info.kind === 'buildings') {
      ids = info.buildings.map((b) => b.id);
      mode = 'building';
    } else if (info.kind === 'foreign' && info.foreign) {
      ids = [info.foreign.id];
      mode = info.foreign.kind === 'unit' ? 'unit' : info.foreign.kind === 'building' ? 'building' : 'resource';
    }
    const key = `${mode}:${mode === 'group' ? ids.join(',') : ids[0] ?? ''}`;
    if (key !== this.key) {
      this.key = key;
      this.build(mode, ids);
    }
    if (mode === 'unit') this.fillUnit(world.entities.get(ids[0]) as Unit);
    else if (mode === 'group') this.fillGroup(info.units);
    else if (mode === 'building') this.fillBuilding(info.kind === 'buildings' ? info.buildings : [world.entities.get(ids[0]) as Building]);
    else if (mode === 'resource') this.fillResource(world.entities.get(ids[0]) as ResourceNode);
  }

  private build(mode: Mode, ids: number[]): void {
    clearChildren(this.el);
    this.unitView = null;
    this.bView = null;
    this.cells = [];
    this.summary = null;
    this.resView = null;
    this.el.dataset.mode = mode;
    if (mode === 'empty') this.buildEmpty();
    else if (mode === 'unit') this.buildUnit();
    else if (mode === 'group') this.buildGroup(ids);
    else if (mode === 'building') this.buildBuilding();
    else this.buildResource();
  }

  private buildEmpty(): void {
    const box = h('div', 'bt-sel-empty', this.el);
    h('div', 'bt-sel-empty-crest', box).innerHTML = GLYPHS.ember;
    const t = h('div', 'bt-sel-empty-text', box);
    h('div', 'bt-sel-empty-title', t, 'No selection');
    h('div', 'bt-sel-empty-hint', t, 'Click or drag a box to select. H selects the Hearth, ` the Warden, . an idle Tiller.');
  }

  // ---------------------------------------------------------------------------
  // Single unit
  // ---------------------------------------------------------------------------

  private buildUnit(): void {
    const root = h('div', 'bt-sel-unit', this.el);
    const pw = h('div', 'bt-portrait-wrap', root);
    const portrait = h('div', 'bt-portrait', pw);
    const rank = h('div', 'bt-rank', pw);
    const info = h('div', 'bt-sel-info', root);
    const nameRow = h('div', 'bt-sel-name-row', info);
    const name = h('div', 'bt-sel-name', nameRow);
    const role = h('div', 'bt-sel-role', info);
    const hp = h('div', 'bt-hpbar', info);
    const hpFill = h('div', 'bt-hpbar-fill', hp);
    const hpText = h('div', 'bt-hpbar-text', hp);
    const order = h('div', 'bt-sel-order', info);
    const effects = h('div', 'bt-sel-effects', info);

    const side = h('div', 'bt-sel-side', root);
    const statsBox = h('div', 'bt-stats', side);
    const mk = (label: string, tip: string): HTMLElement => {
      const s = h('div', 'bt-stat', statsBox);
      h('span', 'bt-stat-k', s, label);
      const v = h('span', 'bt-stat-v', s);
      this.ctx.tooltip.bind(s, () => ({ title: tip }));
      return v;
    };
    const stats = {
      atk: mk('ATK', 'Attack damage per hit'),
      arm: mk('ARM', 'Armor: each point reduces damage with diminishing returns'),
      rng: mk('RNG', 'Range in tiles, edge to edge'),
      spd: mk('SPD', 'Speed in tiles per second'),
    };
    const kills = h('div', 'bt-kills', side);
    const counters = h('div', 'bt-counters', side);
    const sRow = h('div', 'bt-counter-row strong', counters);
    h('span', 'bt-counter-k', sRow, 'Strong vs');
    const strong = h('span', 'bt-counter-v', sRow);
    const wRow = h('div', 'bt-counter-row weak', counters);
    h('span', 'bt-counter-k', wRow, 'Weak vs');
    const weak = h('span', 'bt-counter-v', wRow);
    this.unitView = { portrait, rank, name, role, hpFill, hpText, order, stats, kills, strong, weak, effects };
  }

  private fillUnit(u: Unit | undefined): void {
    const v = this.unitView;
    if (!v || !u) return;
    const { world } = this.ctx;
    const def = UNITS[u.type];
    setPortrait(v.portrait, u.type, u.owner);
    toggleClass(v.portrait, 'enemy', u.owner === ENEMY);
    setHtml(v.rank, u.rank > 0 ? Array.from({ length: u.rank }, () => '<i></i>').join('') : '');
    toggleClass(v.rank, 'gold', u.rank >= 3);
    setText(v.name, def.name);
    const rankName = u.rank > 0 ? ` · ${RANK_NAMES[u.rank]}` : '';
    const cls = CLASS_NAMES[u.cls];
    const role = def.role === cls ? cls : `${def.role} · ${cls}`;
    setText(v.role, `${role}${rankName}${u.carried ? ' · Retinue' : ''}`);
    setBar(v.hpFill, u.hp / u.maxHp);
    toggleClass(v.hpFill, 'enemy', u.owner === ENEMY);
    toggleClass(v.hpFill, 'low', u.hp / u.maxHp < 0.35);
    setText(v.hpText, `${Math.ceil(u.hp)} / ${Math.ceil(u.maxHp)}`);

    let orderLine = u.owner === PLAYER ? orderText(world, u) : u.ai ? aiStateText(u) : '';
    if (u.carry && u.carry.amount > 0) orderLine += `${orderLine ? ' · ' : ''}carrying ${Math.floor(u.carry.amount)} ${RESOURCE_NAMES[u.carry.type]}`;
    setText(v.order, orderLine);

    let atk = def.atk;
    let arm = def.armor;
    let rng = def.range;
    let spd = def.speed;
    let mul = 1;
    try {
      const s = unitStats(world, u.owner, u.type, u.rank);
      atk = s.atk;
      arm = s.armor;
      rng = s.range;
      spd = s.speed;
      mul = s.damageMul;
    } catch {
      /* base stats */
    }
    const atkVal = Math.round(atk * mul * 10) / 10;
    setText(v.stats.atk, def.cooldown > 0 ? String(atkVal) : '—');
    setText(v.stats.arm, String(Math.round(arm * 10) / 10));
    setText(v.stats.rng, def.aura ? `aura ${def.aura.radius}` : String(Math.round(rng * 10) / 10));
    setText(v.stats.spd, spd.toFixed(1));
    setText(v.kills, u.kills > 0 || u.owner === PLAYER ? `Kills ${u.kills}` : '');
    setHtml(v.strong, def.strongVs.length ? classIcons(def.strongVs) : '<em>—</em>');
    setHtml(v.weak, def.weakVs.length ? classIcons(def.weakVs) : '<em>—</em>');

    const fx: string[] = [];
    for (const b of u.buffs) if (b.until > world.tick) fx.push(BUFF_NAMES[b.id] ?? b.id);
    if (u.burns.length) fx.push('Burning');
    setHtml(v.effects, fx.map((f) => `<span class="bt-chip">${f}</span>`).join(''));
  }

  // ---------------------------------------------------------------------------
  // Group
  // ---------------------------------------------------------------------------

  private buildGroup(ids: number[]): void {
    const { world, actions } = this.ctx;
    const units = ids.map((id) => world.entities.get(id)).filter((e): e is Unit => !!e && e.kind === 'unit');
    const order = (t: string): number => {
      const i = (PLAYER_UNIT_IDS as readonly string[]).indexOf(t);
      return i < 0 ? 99 : i === 0 ? 50 : i; // Tillers after the army
    };
    units.sort((a, b) => order(a.type) - order(b.type) || a.id - b.id);
    const root = h('div', 'bt-sel-group', this.el);
    const head = h('div', 'bt-sel-group-head', root);
    this.summary = h('div', 'bt-sel-summary', head);
    const grid = h('div', 'bt-sel-grid', root);
    for (const u of units.slice(0, MAX_CELLS)) {
      const btn = h('button', 'bt-cell', grid);
      btn.type = 'button';
      const ic = h('i', 'bt-unit-ic', btn);
      setBgImage(ic, iconSrc(u.type, u.owner, 32));
      if (!ic.classList.contains('has-img')) ic.textContent = u.type.slice(0, 2);
      if (u.rank > 0) h('span', `bt-cell-rank r${u.rank}`, btn);
      const bar = h('div', 'bt-cell-hp', btn);
      const fill = h('div', 'bt-cell-hp-fill', bar);
      btn.addEventListener('click', (e) => {
        if (e.shiftKey) actions.removeFromSelection(u.id);
        else if (e.ctrlKey || e.metaKey) actions.keepType(u.type);
        else actions.subSelect(u.id);
      });
      this.ctx.tooltip.bind(btn, () => {
        const cur = world.entities.get(u.id);
        if (!cur || cur.kind !== 'unit' || !cur.alive) return null;
        return {
          title: UNITS[cur.type].name,
          sub: cur.rank > 0 ? RANK_NAMES[cur.rank] : undefined,
          body: `${Math.ceil(cur.hp)} / ${Math.ceil(cur.maxHp)} HP · ${orderText(world, cur)}`,
          footer: 'Click: select · Shift: remove · Ctrl: keep this type',
        };
      });
      this.cells.push({ id: u.id, btn, fill });
    }
    if (units.length > MAX_CELLS) h('div', 'bt-cell more', grid, `+${units.length - MAX_CELLS}`);
  }

  private fillGroup(units: Unit[]): void {
    const { world } = this.ctx;
    for (const c of this.cells) {
      const u = world.entities.get(c.id);
      const frac = u && u.alive ? u.hp / u.maxHp : 0;
      setBar(c.fill, frac);
      toggleClass(c.fill, 'low', frac < 0.35);
    }
    if (this.summary) {
      const counts = new Map<string, number>();
      for (const u of units) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
      const parts = [...counts].map(([t, n]) => `${n} ${plural(UNITS[t as Unit['type']].name, n)}`);
      setText(this.summary, `${units.length} selected · ${parts.join(', ')}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Building
  // ---------------------------------------------------------------------------

  private buildBuilding(): void {
    const root = h('div', 'bt-sel-bld', this.el);
    const pw = h('div', 'bt-portrait-wrap', root);
    const portrait = h('div', 'bt-portrait bld', pw);
    const count = h('div', 'bt-portrait-count', pw);
    const info = h('div', 'bt-sel-info', root);
    const name = h('div', 'bt-sel-name', info);
    const hp = h('div', 'bt-hpbar', info);
    const hpFill = h('div', 'bt-hpbar-fill', hp);
    const hpText = h('div', 'bt-hpbar-text', hp);
    const status = h('div', 'bt-sel-order', info);
    const progressWrap = h('div', 'bt-progress bt-hidden', info);
    const progressFill = h('div', 'bt-progress-fill', progressWrap);

    const side = h('div', 'bt-bld-side', root);
    const queueRow = h('div', 'bt-queue', side);
    const queue: BuildingView['queue'] = [];
    for (let i = 0; i < 5; i++) {
      const btn = h('button', 'bt-qslot empty', queueRow);
      btn.type = 'button';
      const icon = h('i', 'bt-unit-ic', btn);
      const bar = h('div', 'bt-qslot-bar', btn);
      const fill = h('div', 'bt-qslot-fill', bar);
      const cancel = (e: Event): void => {
        e.preventDefault();
        e.stopPropagation();
        const b = this.primaryBuilding();
        if (b && i < b.queue.length) this.ctx.actions.cancelTrain(b.id, i);
      };
      btn.addEventListener('click', cancel);
      btn.addEventListener('contextmenu', cancel);
      this.ctx.tooltip.bind(btn, () => {
        const b = this.primaryBuilding();
        const item = b?.queue[i];
        if (!item) return null;
        return {
          title: UNITS[item.unit].name,
          body: i === 0 ? `Training · ${Math.floor((item.progress / Math.max(0.001, item.total)) * 100)}%` : `Queued #${i + 1}`,
          footer: 'Click or right-click to cancel (full refund).',
        };
      });
      queue.push({ btn, icon, fill });
    }
    const rbtn = h('button', 'bt-research-slot bt-hidden', side);
    rbtn.type = 'button';
    const ricon = h('i', 'bt-unit-ic', rbtn);
    setHtml(ricon, GLYPHS.research);
    const rlabel = h('span', 'bt-research-label', rbtn);
    const rbar = h('div', 'bt-qslot-bar', rbtn);
    const rfill = h('div', 'bt-qslot-fill', rbar);
    const cancelR = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      const b = this.primaryBuilding();
      if (b?.research) this.ctx.actions.cancelResearch(b.id);
    };
    rbtn.addEventListener('click', cancelR);
    rbtn.addEventListener('contextmenu', cancelR);
    this.ctx.tooltip.bind(rbtn, () => {
      const r = this.primaryBuilding()?.research;
      if (!r) return null;
      return { title: RESEARCH[r.id].name, body: RESEARCH[r.id].desc, footer: 'Click to cancel (full refund).' };
    });
    const rally = h('div', 'bt-rally bt-hidden', side);
    setHtml(rally, `${GLYPHS.rally}<span>Rally set</span>`);
    this.bView = {
      portrait,
      count,
      name,
      hpFill,
      hpText,
      status,
      progressWrap,
      progressFill,
      queueRow,
      queue,
      research: { btn: rbtn, icon: ricon, fill: rfill, label: rlabel },
      rally,
    };
  }

  private primaryBuilding(): Building | null {
    const info = classifySelection(this.ctx.world, this.ctx.ui.selection);
    if (info.kind === 'buildings') return info.buildings[0];
    if (info.foreign && info.foreign.kind === 'building') return info.foreign;
    return null;
  }

  private fillBuilding(blds: Building[]): void {
    const v = this.bView;
    const b = blds[0];
    if (!v || !b) return;
    const { world } = this.ctx;
    const def = BUILDINGS[b.type];
    setPortrait(v.portrait, b.type, b.owner);
    toggleClass(v.portrait, 'enemy', b.owner === ENEMY);
    setText(v.count, blds.length > 1 ? `×${blds.length}` : '');
    setText(v.name, def.name);
    const own = b.owner === PLAYER;
    const showHp = !b.invulnerable || b.type === 'hearth';
    setHidden(v.hpFill.parentElement as HTMLElement, !showHp);
    setBar(v.hpFill, b.hp / b.maxHp);
    toggleClass(v.hpFill, 'enemy', b.owner === ENEMY);
    toggleClass(v.hpFill, 'low', b.hp / b.maxHp < 0.35);
    setText(v.hpText, `${Math.ceil(b.hp)} / ${Math.ceil(b.maxHp)}`);

    // Status line + progress
    let status = '';
    let progress: number | null = null;
    if (!b.built && own) {
      status = `Under construction · ${Math.floor(b.buildProgress * 100)}%`;
      progress = b.buildProgress;
    } else if (b.nest) {
      const n = this.ctx.view?.nests.find((x) => x.id === b.id);
      status = b.nest.spent ? `Spent · takes ×1.5 damage${n ? ` · ${formatCountdown(n.spentRemaining)}` : ''}` : 'Mustering the Thornwake';
      if (!b.nest.spent) progress = b.nest.musterProgress;
    } else if (b.object) {
      const o = b.object;
      if (o.kind === 'beacon') status = beaconStatus(o);
      else if (o.kind === 'cache') status = o.done ? 'Looted' : 'Guarded. Clear the guards, then touch it.';
      else status = 'The Briar Throne';
      if (o.kind === 'beacon' && !o.lit && o.progress > 0) progress = o.progress;
    } else if (own) {
      const parts: string[] = [];
      if (b.queue.length) parts.push(`Training ${UNITS[b.queue[0].unit].name}`);
      if (b.research) parts.push(`Researching ${RESEARCH[b.research.id].name}`);
      status = parts.join(' · ') || (def.trains?.length || def.research?.length ? 'Idle' : def.desc);
      try {
        const s = buildingStats(world, b.owner, b.type);
        if (s.attack) status += `${status ? ' · ' : ''}${s.attack.dmg} dmg, range ${s.attack.range}`;
      } catch {
        /* optional */
      }
    } else {
      status = def.desc;
    }
    setText(v.status, status);
    setHidden(v.progressWrap, progress === null);
    if (progress !== null) setBar(v.progressFill, progress);

    // Queue
    const showQueue = own && b.built && !!def.trains?.length;
    setHidden(v.queueRow, !showQueue);
    if (showQueue) {
      for (let i = 0; i < 5; i++) {
        const slot = v.queue[i];
        const item = b.queue[i];
        toggleClass(slot.btn, 'empty', !item);
        setBgImage(slot.icon, item ? iconSrc(item.unit, PLAYER, 32) : '');
        setBar(slot.fill, item && i === 0 ? item.progress / Math.max(0.001, item.total) : 0);
      }
    }
    const r = own ? b.research : null;
    setHidden(v.research.btn, !r);
    if (r) {
      setText(v.research.label, RESEARCH[r.id].name);
      setBar(v.research.fill, r.progress / Math.max(0.001, r.total));
    }
    setHidden(v.rally, !(own && b.rally));
  }

  // ---------------------------------------------------------------------------
  // Resource node
  // ---------------------------------------------------------------------------

  private buildResource(): void {
    const root = h('div', 'bt-sel-unit', this.el);
    const pw = h('div', 'bt-portrait-wrap', root);
    const portrait = h('div', 'bt-portrait', pw);
    const info = h('div', 'bt-sel-info', root);
    const name = h('div', 'bt-sel-name', info);
    const bar = h('div', 'bt-hpbar res', info);
    const fill = h('div', 'bt-hpbar-fill', bar);
    const text = h('div', 'bt-hpbar-text', bar);
    const status = h('div', 'bt-sel-order', info);
    this.resView = { name, fill, text, status, portrait };
  }

  private fillResource(r: ResourceNode | undefined): void {
    const v = this.resView;
    if (!v || !r) return;
    setPortrait(v.portrait, r.type, 2);
    setText(v.name, `${RESOURCE_NODES[r.type].name}${r.contested ? ' (contested)' : ''}`);
    setBar(v.fill, r.initial > 0 ? r.amount / r.initial : 0);
    toggleClass(v.fill, `res-${r.resType}`, true);
    setText(v.text, `${Math.floor(r.amount)} ${RESOURCE_NAMES[r.resType]}`);
    setText(v.status, `${r.gatherers} / ${r.maxGatherers} Tillers gathering`);
  }
}

function aiStateText(u: Unit): string {
  const ai = u.ai;
  if (!ai) return '';
  const role: Record<string, string> = {
    garrison: 'Nest garrison',
    picket: 'Picket guard',
    lurker: 'Lurker',
    beacon_guard: 'Beacon guard',
    wave: ai.wave >= 0 ? `Wave ${ai.wave}` : 'Wave',
    raid: 'Raider',
    summon: 'Summoned',
    noble: 'Court Noble',
    boss: 'The Regent',
  };
  const st: Record<string, string> = { muster: 'mustering', advance: 'advancing', engage: 'engaging', return: 'returning', post: 'on post', idle: 'idle' };
  return `${role[ai.role] ?? ai.role} · ${st[ai.state] ?? ai.state}`;
}

/** Beacon Stone status line (encounter publishes dormant / contested / snuff progress on the object). */
function beaconStatus(o: { lit: boolean; progress: number; [key: string]: unknown }): string {
  const num = (k: string): number => (typeof o[k] === 'number' ? (o[k] as number) : 0);
  if (o['dormant'] === true) return `Dormant · wakes in ${formatCountdown(num('dormantRemaining'))}`;
  if (o.lit) {
    const snuff = num('snuffProgress');
    return snuff > 0 ? `Lit · being snuffed ${Math.floor(snuff * 100)}%` : 'Lit · scoring Kindling and Ember';
  }
  if (o['contested'] === true) return 'Contested · drive the Thornwake off';
  if (o.progress > 0) return `Kindling · ${Math.floor(o.progress * 100)}%`;
  return 'Unlit · keep a unit beside it for 10 s';
}
