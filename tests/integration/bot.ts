/**
 * A scripted "player" for headless end-to-end battles. It only reads the world the way a player
 * could (own entities, visible enemies, explored trees) and changes it only through issueCommand.
 *
 * Plan:
 * - Economy: Tillers split over Grain (near Thickets, then Grainplots), Timber (trees nearest a
 *   drop-off) and Ember (the home Seam); the Hearth trains Tillers up to `tillerTarget`.
 * - Build order: Storehouse at the forest-edge Vanguard site at 0:00, Bowyard at about 0:40, a
 *   Storehouse by the home Seam, Cottages ahead of the pop cap, Grainplots once Thickets run low.
 * - Army: Ashpikes and Bowmen continuously, rallied to a staging point toward the nearest Nest.
 *   Visible threats near the base get attack-moved. Once the army reaches `attackAt` it gathers
 *   and pushes the nearest Nest (Spent ones first), then the next; it falls back below
 *   `retreatBelow`.
 */
import { BUILDINGS } from '../../src/data/buildings';
import { UNITS } from '../../src/data/units';
import { getEncounterView } from '../../src/sim/encounter';
import { canPlaceBuilding, isEntityVisible, playerMilitary } from '../../src/sim/queries';
import { costOf } from '../../src/sim/stats';
import type {
  Building,
  Command,
  Cost,
  GatherTarget,
  PlayerBuildingId,
  PlayerUnitId,
  ResourceNode,
  ResourceType,
  Unit,
  World,
} from '../../src/sim/types';
import { ENEMY, PLAYER, TICK_RATE, Terrain } from '../../src/sim/types';
import { issueCommand } from '../../src/sim/world';

export interface BotConfig {
  tillerTarget: number;
  /** Army size (military units + Warden) that starts a push. */
  attackAt: number;
  /** A push falls back to the staging point below this many units. */
  retreatBelow: number;
  /** Think cadence in ticks. */
  thinkTicks: number;
  /** Push Nests at all (false = turtle). */
  push: boolean;
  /** Override the doctrine-based army mix (weights by unit). */
  mix?: Partial<Record<'ashpike' | 'bowman' | 'courser', number>>;
}

/** Army mix per doctrine, following the briefing answers (GDD §I "Readable answer"). */
const MIX: Record<string, Record<'ashpike' | 'bowman' | 'courser', number>> = {
  swarm: { ashpike: 3, bowman: 2, courser: 0 },
  spines: { ashpike: 1, bowman: 1, courser: 2 },
  hunt: { ashpike: 3, bowman: 1, courser: 0 },
  siegebreak: { ashpike: 1, bowman: 1, courser: 2 },
  court: { ashpike: 1, bowman: 1, courser: 1 },
};
const TRAINER: Record<'ashpike' | 'bowman' | 'courser', PlayerBuildingId> = {
  ashpike: 'muster_hall',
  bowman: 'bowyard',
  courser: 'paddock',
};
/** Brazier Towers per doctrine. */
const TOWERS: Record<string, number> = { swarm: 2, spines: 1, hunt: 2, siegebreak: 0, court: 1 };

export const DEFAULT_BOT: BotConfig = {
  tillerTarget: 20,
  attackAt: 15,
  retreatBelow: 6,
  thinkTicks: 10,
  push: true,
};

type Job = 'grain' | 'timber' | 'ember';
type Mode = 'build' | 'gather' | 'push' | 'retreat';

export interface BotStats {
  commands: number;
  failed: Record<string, number>;
  pushes: number;
  defends: number;
  mode: Mode;
  log: string[];
}

const ENEMY_STRUCTURES = new Set(['thorn_nest', 'root_heart', 'thornspire']);

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(us: { x: number; y: number }[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const u of us) {
    x += u.x;
    y += u.y;
  }
  return { x: x / Math.max(1, us.length), y: y / Math.max(1, us.length) };
}

function targetKey(t: GatherTarget): string {
  return t.kind === 'tree' ? `t:${t.tile}` : `${t.kind}:${t.id}`;
}

export class Bot {
  readonly cfg: BotConfig;
  readonly stats: BotStats = { commands: 0, failed: {}, pushes: 0, defends: 0, mode: 'build', log: [] };
  private pushTarget = 0;
  /** Unit ids committed to the current push (reinforcements stay home). */
  private pushGroup = new Set<number>();
  private pushPhase: 'travel' | 'assault' = 'travel';
  private pushPhaseTick = 0;
  private pushPoint = { x: 0, y: 0 };
  private lastArmyOrderTick = -1000;
  private nextRebalance = 0;
  private emberStorePlaced = false;
  private timberStorePlaced = false;
  private researched = false;
  private tempered = false;
  private hornTick = -1000;
  private rallied = false;
  /** Battle time of the last wave break (push window). */
  lastBroken = -1000;
  readonly mix: Record<'ashpike' | 'bowman' | 'courser', number>;

  constructor(
    readonly world: World,
    cfg: Partial<BotConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_BOT, ...cfg };
    this.mix = { ...(MIX[world.setup.doctrine] ?? MIX.court), ...(cfg.mix ?? {}) };
  }

  /** The harness forwards drained events so the bot can react like a player reading alerts. */
  onEvent(ev: { t: string }): void {
    if (ev.t === 'waveBroken') this.lastBroken = this.world.time;
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private issue(cmd: Command, why: string): boolean {
    const r = issueCommand(this.world, cmd);
    this.stats.commands++;
    if (!r.ok) {
      const key = `${cmd.type}: ${r.reason ?? '?'}`;
      this.stats.failed[key] = (this.stats.failed[key] ?? 0) + 1;
    } else if (why) this.note(why);
    return r.ok;
  }

  private note(msg: string): void {
    const t = this.world.time;
    this.stats.log.push(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} ${msg}`);
  }

  get hearth(): Building | undefined {
    const h = this.world.entities.get(this.world.hearthId);
    return h && h.kind === 'building' && h.alive ? h : undefined;
  }

  private own(): Unit[] {
    return this.world.units.filter((u) => u.alive && u.owner === PLAYER);
  }

  tillers(): Unit[] {
    return this.own().filter((u) => u.type === 'tiller' && !this.isKeeper(u.id));
  }

  private isKeeper(id: number): boolean {
    for (const k of this.beaconKeepers?.values() ?? []) if (k === id) return true;
    return false;
  }

  /** Military units plus the Warden (minus the Beacon squad). */
  army(): Unit[] {
    const out = playerMilitary(this.world);
    const w = this.world.entities.get(this.world.wardenId);
    if (w && w.kind === 'unit' && w.alive) out.push(w);
    return this.beaconSquad?.size ? out.filter((u) => !this.beaconSquad.has(u.id)) : out;
  }

  private ownBuildings(type?: PlayerBuildingId): Building[] {
    return this.world.buildings.filter((b) => b.alive && b.owner === PLAYER && (!type || b.type === type));
  }

  private res(): Record<ResourceType, number> {
    return this.world.players[PLAYER].res;
  }

  private canPay(cost: Cost, reserve: Partial<Record<ResourceType, number>> = {}): boolean {
    const r = this.res();
    return (['grain', 'timber', 'ember'] as const).every((k) => r[k] - (reserve[k] ?? 0) >= (cost[k] ?? 0));
  }

  private nestsAlive(): Building[] {
    return this.world.buildings.filter((b) => b.alive && b.owner === ENEMY && (b.type === 'thorn_nest' || b.type === 'root_heart'));
  }

  private visibleEnemies(): Unit[] {
    return this.world.units.filter((u) => u.alive && u.owner === ENEMY && !u.untargetable && isEntityVisible(this.world, u));
  }

  private blighted(x: number, y: number): boolean {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return this.world.blight.tiles[ty * this.world.map.w + tx] === 1;
  }

  /** Point `d` tiles from the Hearth toward the nearest living Nest (the army's staging point). */
  staging(d = 6): { x: number; y: number } {
    const h = this.hearth;
    const a = this.world.anchors.hearth;
    const hx = h ? h.x : a.tx + 2;
    const hy = h ? h.y : a.ty + 2;
    const nests = this.nestsAlive();
    let tx = this.world.map.w / 2;
    let ty = this.world.map.h / 2;
    let best = Infinity;
    for (const n of nests) {
      const dd = Math.hypot(n.x - hx, n.y - hy);
      if (dd < best) {
        best = dd;
        tx = n.x;
        ty = n.y;
      }
    }
    const len = Math.hypot(tx - hx, ty - hy) || 1;
    return { x: hx + ((tx - hx) / len) * d, y: hy + ((ty - hy) / len) * d };
  }

  // -------------------------------------------------------------------------
  // Main
  // -------------------------------------------------------------------------

  /** Think on the cadence tick (or now, with force: browser drivers that skip ticks). */
  update(force = false): void {
    const w = this.world;
    if (w.countdown > 0 || w.outcome !== 'ongoing') return;
    if (!force && w.tick % this.cfg.thinkTicks !== 0) return;
    if (!this.hearth) return;
    this.economy();
    this.buildings();
    this.production();
    this.armyControl();
    if (w.setup.objective === 'beacons') this.beacons();
  }

  // -------------------------------------------------------------------------
  // Beacons objective: a squad clears the guards, a Tiller holds the stone.
  // -------------------------------------------------------------------------

  private beaconSquad = new Set<number>();
  private beaconKeepers = new Map<number, number>();

  private beacons(): void {
    const w = this.world;
    if (w.time < 75) return;
    const h = this.hearth!;
    const stones = w.buildings
      .filter((b) => b.alive && b.type === 'beacon_stone')
      .sort((a, b) => dist(a, h) - dist(b, h));
    if (!stones.length) return;
    // Squad: the Warden, the free Courser and the first few soldiers (topped up to 6).
    for (const id of this.beaconSquad) {
      const u = w.entities.get(id);
      if (!u || !u.alive) this.beaconSquad.delete(id);
    }
    for (const u of this.army()) {
      if (this.beaconSquad.size >= 6) break;
      if (!this.pushGroup.has(u.id)) this.beaconSquad.add(u.id);
    }
    const squad = [...this.beaconSquad].map((id) => w.entities.get(id) as Unit);
    // Target: the nearest stone that is not lit yet, else the nearest one to guard.
    const lit = (b: Building) => !!b.object && b.object.lit;
    const tgt = stones.find((b) => !lit(b)) ?? stones[0];
    if (w.tick % (3 * TICK_RATE) === 0) {
      const idle = squad.filter((u) => u.targetId === 0 && dist(u, tgt) > 3);
      this.order(idle, 'attackMove', tgt.x, tgt.y + 2, '');
    }
    // One Tiller per stone the squad has cleared (no guard within 6 tiles).
    for (const b of stones) {
      const guarded = this.visibleEnemies().some((e) => dist(e, b) <= 6);
      const keeperId = this.beaconKeepers.get(b.id);
      const keeper = keeperId ? (w.entities.get(keeperId) as Unit | undefined) : undefined;
      if (keeper && keeper.alive) {
        if (keeper.order.type === 'idle' && dist(keeper, b) > 2.2) this.issue({ type: 'move', unitIds: [keeper.id], x: b.x + 1.6, y: b.y }, '');
        continue;
      }
      if (guarded || (b !== tgt && !lit(b))) continue;
      const t = this.tillers()
        .filter((u) => ![...this.beaconKeepers.values()].includes(u.id) && !u.carry)
        .sort((a, c) => dist(a, b) - dist(c, b))[0];
      if (t && this.issue({ type: 'move', unitIds: [t.id], x: b.x + 1.6, y: b.y }, `keeper to Beacon #${b.id}`)) this.beaconKeepers.set(b.id, t.id);
    }
  }

  // -------------------------------------------------------------------------
  // Economy
  // -------------------------------------------------------------------------

  private jobOf(u: Unit): Job | 'build' | 'idle' | 'busy' {
    const o = u.order;
    if (o.type === 'build') return 'build';
    const t = o.type === 'gather' ? o.target : u.job;
    if (t) {
      if (t.kind === 'tree') return 'timber';
      if (t.kind === 'plot') return 'grain';
      const n = this.world.entities.get(t.id);
      if (n && n.kind === 'resource') return n.resType;
    }
    if (o.type === 'idle' && u.queue.length === 0) return 'idle';
    return 'busy';
  }

  /** Worker split, steered by stockpiles the way a player reads the top bar. */
  private wanted(n: number): Record<Job, number> {
    const r = this.res();
    let ember = n >= 9 ? 2 : 0;
    if (this.mix.courser > 0 && n >= 14 && r.ember < 150) ember = 3;
    if (r.ember > 300) ember = Math.min(ember, 1);
    if (r.ember > 600) ember = 0;
    const rest = n - ember;
    let share = 0.55;
    if (r.grain > r.timber + 150) share = 0.45;
    else if (r.timber > r.grain + 150) share = 0.65;
    const grain = Math.round(rest * share);
    return { grain, timber: rest - grain, ember };
  }

  private targetCounts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const u of this.tillers()) {
      const t = u.order.type === 'gather' ? u.order.target : u.job;
      if (!t) continue;
      const k = targetKey(t);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }

  private dropoffs(): Building[] {
    return this.ownBuildings().filter((b) => b.built && BUILDINGS[b.type].dropoff);
  }

  private dropDist(x: number, y: number): number {
    let best = Infinity;
    for (const b of this.dropoffs()) best = Math.min(best, dist(b, { x, y }) - Math.max(b.w, b.h) / 2);
    return best;
  }

  private enemyStructureNear(x: number, y: number, r: number): boolean {
    return this.world.buildings.some((b) => b.alive && b.owner === ENEMY && ENEMY_STRUCTURES.has(b.type) && dist(b, { x, y }) < r);
  }

  private pickGrain(counts: Map<string, number>): GatherTarget | null {
    let best: ResourceNode | null = null;
    let bd = Infinity;
    for (const r of this.world.resources) {
      if (!r.alive || r.type !== 'thicket' || r.amount <= 0) continue;
      if ((counts.get(`node:${r.id}`) ?? 0) >= r.maxGatherers) continue;
      if (this.blighted(r.x, r.y) || this.enemyStructureNear(r.x, r.y, 12)) continue;
      const d = this.dropDist(r.x, r.y);
      if (d > 14) continue;
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    if (best) return { kind: 'node', id: best.id };
    for (const b of this.ownBuildings('grainplot')) {
      if (!b.built) continue;
      if ((counts.get(`plot:${b.id}`) ?? 0) >= 2) continue;
      return { kind: 'plot', id: b.id };
    }
    return null;
  }

  private pickEmber(counts: Map<string, number>): GatherTarget | null {
    let best: ResourceNode | null = null;
    let bd = Infinity;
    for (const r of this.world.resources) {
      if (!r.alive || r.type !== 'ember_seam' || r.amount <= 0) continue;
      if ((counts.get(`node:${r.id}`) ?? 0) >= r.maxGatherers) continue;
      if (this.blighted(r.x, r.y) || this.enemyStructureNear(r.x, r.y, 8)) continue;
      if (r.contested && this.nestsAlive().some((n) => dist(n, r) < 18)) continue;
      const d = this.dropDist(r.x, r.y);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    return best ? { kind: 'node', id: best.id } : null;
  }

  private pickTree(counts: Map<string, number>): GatherTarget | null {
    const w = this.world;
    const W = w.map.w;
    const drops = this.dropoffs();
    if (!drops.length) return null;
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < W * w.map.h; i++) {
      if (w.map.terrain[i] !== Terrain.Forest || w.map.treeAmount[i] <= 0) continue;
      if (w.fog.state[i] === 0) continue;
      if ((counts.get(`t:${i}`) ?? 0) >= 2) continue;
      const tx = i % W;
      const ty = (i - tx) / W;
      // Needs an open neighbour (an edge tree).
      let open = false;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= w.map.h) continue;
        if (!w.grid.blocked[ny * W + nx]) open = true;
      }
      if (!open) continue;
      if (w.blight.tiles[i]) continue;
      let d = Infinity;
      for (const b of drops) d = Math.min(d, dist(b, { x: tx + 0.5, y: ty + 0.5 }));
      if (this.enemyStructureNear(tx + 0.5, ty + 0.5, 12)) continue;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best >= 0 ? { kind: 'tree', tile: best } : null;
  }

  private pick(job: Job, counts: Map<string, number>): GatherTarget | null {
    return job === 'grain' ? this.pickGrain(counts) : job === 'ember' ? this.pickEmber(counts) : this.pickTree(counts);
  }

  private assign(u: Unit, job: Job, counts: Map<string, number>): boolean {
    const order: Job[] = [job, ...(['grain', 'timber', 'ember'] as Job[]).filter((j) => j !== job)];
    for (const j of order) {
      const t = this.pick(j, counts);
      if (!t) continue;
      if (this.issue({ type: 'gather', unitIds: [u.id], target: t }, '')) {
        const k = targetKey(t);
        counts.set(k, (counts.get(k) ?? 0) + 1);
        return true;
      }
    }
    return false;
  }

  private economy(): void {
    const ts = this.tillers();
    const counts = this.targetCounts();
    const want = this.wanted(ts.length);
    const have: Record<Job, number> = { grain: 0, timber: 0, ember: 0 };
    const idle: Unit[] = [];
    for (const u of ts) {
      const j = this.jobOf(u);
      if (j === 'idle') idle.push(u);
      else if (j === 'grain' || j === 'timber' || j === 'ember') have[j]++;
    }
    for (const u of idle) {
      const job = (['ember', 'grain', 'timber'] as Job[]).sort((a, b) => have[a] - want[a] - (have[b] - want[b]))[0];
      if (this.assign(u, job, counts)) have[job]++;
      else if (this.res().timber >= 50 && !this.ownBuildings('grainplot').some((b) => !b.built)) {
        // Nothing to gather nearby: farm.
        this.placeNear('grainplot', this.hearth!, 4, 9, [u]);
      }
    }
    // Rebalance one Tiller every 5 s.
    if (this.world.time >= this.nextRebalance) {
      this.nextRebalance = this.world.time + 5;
      const jobs: Job[] = ['grain', 'timber', 'ember'];
      const over = jobs.filter((j) => have[j] - want[j] >= 2).sort((a, b) => have[b] - want[b] - (have[a] - want[a]))[0];
      const under = jobs.filter((j) => want[j] - have[j] >= 1).sort((a, b) => want[b] - have[b] - (want[a] - have[a]))[0];
      if (over && under) {
        const mover = ts.find((u) => this.jobOf(u) === over && !u.carry);
        if (mover && this.pick(under, counts)) this.assign(mover, under, counts);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Buildings
  // -------------------------------------------------------------------------

  /** Spiral search for a valid site whose 1-tile border is free of other static entities. */
  findSite(type: PlayerBuildingId, cx: number, cy: number, minR = 0, maxR = 12, from?: { x: number; y: number }): { tx: number; ty: number } | null {
    const w = this.world;
    const def = BUILDINGS[type];
    const W = w.map.w;
    const H = w.map.h;
    const ox = Math.round(cx - def.w / 2);
    const oy = Math.round(cy - def.h / 2);
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = ox + dx;
          const ty = oy + dy;
          if (from && Math.hypot(tx + def.w / 2 - from.x, ty + def.h / 2 - from.y) < minR) continue;
          if (!canPlaceBuilding(w, type, tx, ty).ok) continue;
          let ok = true;
          let blockedRing = 0;
          let ring = 0;
          for (let y = ty - 1; y <= ty + def.h && ok; y++) {
            for (let x = tx - 1; x <= tx + def.w; x++) {
              if (x >= tx && x < tx + def.w && y >= ty && y < ty + def.h) continue;
              ring++;
              if (x < 0 || y < 0 || x >= W || y >= H) {
                blockedRing++;
                continue;
              }
              const i = y * W + x;
              if (w.grid.occupant[i] !== 0) {
                ok = false;
                break;
              }
              if (w.grid.blocked[i]) blockedRing++;
            }
          }
          if (!ok || blockedRing > ring / 3) continue;
          return { tx, ty };
        }
      }
    }
    return null;
  }

  private placeNear(type: PlayerBuildingId, near: { x: number; y: number }, minR: number, maxR: number, builders: Unit[], why = ''): boolean {
    if (!builders.length) return false;
    if (!this.canPay(costOf(this.world, PLAYER, type))) return false;
    const h = this.hearth;
    const site = this.findSite(type, near.x, near.y, minR, maxR, h ? { x: h.x, y: h.y } : undefined);
    if (!site) {
      this.stats.failed[`site:${type}`] = (this.stats.failed[`site:${type}`] ?? 0) + 1;
      return false;
    }
    return this.issue({ type: 'build', unitIds: builders.map((b) => b.id), building: type, tx: site.tx, ty: site.ty }, why || `place ${type}`);
  }

  /** Tillers to pull onto a construction job: prefer Timber workers without a load. */
  private builders(n: number, near: { x: number; y: number }): Unit[] {
    const ts = this.tillers().filter((u) => {
      const j = this.jobOf(u);
      return j === 'timber' || j === 'grain' || j === 'idle';
    });
    ts.sort((a, b) => (a.carry ? 1 : 0) - (b.carry ? 1 : 0) || dist(a, near) - dist(b, near));
    return ts.slice(0, n);
  }

  private foundations(type: PlayerBuildingId): Building[] {
    return this.ownBuildings(type).filter((b) => !b.built);
  }

  private buildings(): void {
    const w = this.world;
    const h = this.hearth!;
    const p = w.players[PLAYER];
    const t = w.time;
    const res = this.res();

    // Unattended foundations: send a builder.
    for (const b of this.ownBuildings()) {
      if (b.built) continue;
      const working = this.tillers().some((u) => u.order.type === 'build' && u.order.buildingId === b.id);
      const bs = working ? [] : this.builders(1, b);
      if (bs.length) this.issue({ type: 'repair', unitIds: bs.map((u) => u.id), targetId: b.id }, '');
    }

    // Timber Storehouse at the reserved forest-edge site.
    if (!this.timberStorePlaced) {
      const site = w.anchors.vanguard.storehouse;
      const existing = this.ownBuildings('storehouse').length > 0;
      if (existing) this.timberStorePlaced = true;
      else if (res.timber >= 100) {
        const bs = this.builders(2, { x: site.tx + 1, y: site.ty + 1 });
        if (canPlaceBuilding(w, 'storehouse', site.tx, site.ty).ok) {
          this.timberStorePlaced = this.issue({ type: 'build', unitIds: bs.map((u) => u.id), building: 'storehouse', tx: site.tx, ty: site.ty }, 'Storehouse (forest)');
        } else this.timberStorePlaced = this.placeNear('storehouse', { x: site.tx + 1, y: site.ty + 1 }, 0, 6, bs, 'Storehouse (forest, moved)');
      }
    }

    // Military buildings.
    const mh = this.ownBuildings('muster_hall');
    const by = this.ownBuildings('bowyard');
    const stage = this.staging(7);
    if (t >= 35 && !by.length && res.timber >= 130 + 40) {
      this.placeNear('bowyard', mh[0] ?? stage, 0, 10, this.builders(2, stage), 'Bowyard');
    }
    if (t >= 60 && !mh.length && res.timber >= 150) {
      this.placeNear('muster_hall', by[0] ?? stage, 0, 10, this.builders(2, stage), 'Muster Hall');
    }
    if (this.mix.courser > 0 && t >= 75 && !this.ownBuildings('paddock').length && this.canPay({ timber: 150 + 30, ember: 40 })) {
      this.placeNear('paddock', mh[0] ?? by[0] ?? stage, 0, 10, this.builders(2, stage), 'Paddock');
    }
    const towers = this.ownBuildings('brazier_tower').length;
    const wantTowers = TOWERS[w.setup.doctrine] ?? 1;
    if (t >= 100 && towers < wantTowers && !this.foundations('brazier_tower').length && this.canPay({ timber: 100 + 60, ember: 25 })) {
      const spot = this.staging(4 + towers);
      this.placeNear('brazier_tower', spot, 0, 6, this.builders(2, spot), 'Brazier Tower');
    }

    // Ember Storehouse next to the home Seam.
    if (!this.emberStorePlaced && t >= 50 && res.timber >= 100) {
      const seam = w.resources.find((r) => r.alive && r.type === 'ember_seam' && !r.contested);
      if (!seam) this.emberStorePlaced = true;
      else if (this.dropDist(seam.x, seam.y) <= 4) this.emberStorePlaced = true;
      else this.emberStorePlaced = this.placeNear('storehouse', seam, 0, 4, this.builders(2, seam), 'Storehouse (ember)');
    }

    // Cottages ahead of the cap.
    const queued = this.ownBuildings().reduce((s, b) => s + b.queue.length, 0);
    const building = this.foundations('cottage').length;
    if (p.popCap < 60 && p.pop + Math.min(queued, 3) >= p.popCap - 3 && building < (p.popCap >= 32 ? 2 : 1) && res.timber >= 40) {
      const away = this.staging(-7);
      this.placeNear('cottage', away, 4, 12, this.builders(1, away), 'Cottage');
    }

    // Grainplots once the near Thickets run low.
    const thicketGrain = w.resources.filter((r) => r.alive && r.type === 'thicket' && this.dropDist(r.x, r.y) <= 14).reduce((s, r) => s + r.amount, 0);
    const plots = this.ownBuildings('grainplot').length;
    const grainers = this.tillers().filter((u) => this.jobOf(u) === 'grain').length;
    const thicketSlots = w.resources.filter((r) => r.alive && r.type === 'thicket' && r.amount > 60 && this.dropDist(r.x, r.y) <= 14).length * 2;
    if (thicketGrain < 600 && plots * 2 + thicketSlots < grainers + 2 && plots < 8 && this.foundations('grainplot').length < 2 && res.timber >= 50 + 10) {
      this.placeNear('grainplot', h, 4, 10, this.builders(1, h), 'Grainplot');
    }

    // Ember sink: Forgehall and a Temper.
    const fh = this.ownBuildings('forgehall');
    if (t >= 150 && !fh.length && (mh.length || by.length) && this.canPay({ timber: 120 + 40, ember: 50 })) {
      this.placeNear('forgehall', mh[0] ?? by[0], 0, 10, this.builders(2, h), 'Forgehall');
    }
    if (fh.length && fh[0].built && !this.tempered && this.canPay({ grain: 100, ember: 100 }, { grain: 40 })) {
      this.tempered = this.issue({ type: 'research', buildingId: fh[0].id, research: 'ember_edge' }, 'Temper: Ember Edge');
    }

    // One research once the army exists.
    if (!this.researched && mh.length && mh[0].built && this.army().length >= 10 && this.canPay({ grain: 100, ember: 40 }, { grain: 60 })) {
      this.researched = this.issue({ type: 'research', buildingId: mh[0].id, research: 'ash_hafts' }, 'research Ash-Hardened Hafts');
    }
  }

  // -------------------------------------------------------------------------
  // Production
  // -------------------------------------------------------------------------

  private production(): void {
    const w = this.world;
    const p = w.players[PLAYER];
    const h = this.hearth!;
    const ts = this.tillers().length;
    const queuedTillers = h.queue.filter((q) => q.unit === 'tiller').length;
    const wantTillers = ts + queuedTillers < this.cfg.tillerTarget;
    if (wantTillers && h.queue.length < 2 && this.canPay(costOf(w, PLAYER, 'tiller'))) {
      this.issue({ type: 'train', buildingIds: [h.id], unit: 'tiller' }, '');
    }
    if (p.pop >= p.popCap) return;
    // Keep Grain for Tillers while still growing the economy.
    const reserve = wantTillers ? { grain: 50 } : {};
    const stage = this.staging(6);
    // Pick the unit type furthest below its share of the mix.
    const have: Record<string, number> = { ashpike: 0, bowman: 0, courser: 0 };
    for (const u of this.army()) if (u.type in have) have[u.type]++;
    for (const b of this.ownBuildings()) for (const q of b.queue) if (q.unit in have) have[q.unit]++;
    const total = Math.max(1, have.ashpike + have.bowman + have.courser);
    const wsum = this.mix.ashpike + this.mix.bowman + this.mix.courser;
    const kinds = (['ashpike', 'bowman', 'courser'] as const)
      .filter((k) => this.mix[k] > 0)
      .sort((a, b) => have[a] / total - this.mix[a] / wsum - (have[b] / total - this.mix[b] / wsum));
    for (const unit of kinds) {
      for (const b of this.ownBuildings(TRAINER[unit])) {
        if (!b.built) continue;
        if (!b.rally || dist(b.rally, stage) > 3) this.issue({ type: 'rally', buildingIds: [b.id], x: stage.x, y: stage.y }, '');
        if (b.queue.length >= 2) continue;
        if (!this.canPay(costOf(w, PLAYER, unit), reserve)) continue;
        this.issue({ type: 'train', buildingIds: [b.id], unit }, '');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Army
  // -------------------------------------------------------------------------

  /**
   * Visible enemy units threatening the base: wave / raid / summon / Noble units near the Hearth,
   * any own building or a Tiller. Standing guards (garrisons, Pickets, Lurkers) only count when
   * they are right on top of a building, so the army never chases guards walking home.
   */
  threats(): Unit[] {
    const h = this.hearth!;
    const blds = this.ownBuildings();
    const ts = this.tillers();
    return this.visibleEnemies().filter((e) => {
      const standing = !!e.ai && (e.ai.role === 'garrison' || e.ai.role === 'picket' || e.ai.role === 'lurker' || e.ai.role === 'beacon_guard');
      if (standing) return blds.some((b) => dist(e, b) <= Math.max(b.w, b.h) / 2 + 2);
      // A wave still mustering stands at its Nest (Holdfast Nests are only 17-23 tiles out): wait
      // for it at home instead of marching into the Nest's spire and garrison.
      if (e.ai?.state === 'muster') return dist(e, h) <= 10;
      if (dist(e, h) <= 15) return true;
      return blds.some((b) => dist(e, b) <= 8) || ts.some((t) => dist(e, t) <= 5);
    });
  }

  private order(units: Unit[], cmd: 'attackMove' | 'move', x: number, y: number, why: string): void {
    if (!units.length) return;
    this.issue({ type: cmd, unitIds: units.map((u) => u.id), x, y }, why);
  }

  /** The Wave Horn as the HUD shows it. */
  private horn(): { phase: 'muster' | 'advancing'; secondsToLaunch: number; nestId: number } | null {
    return getEncounterView(this.world).horn;
  }

  private armyControl(): void {
    const w = this.world;
    let army = this.army();
    const h = this.hearth!;
    const threats = this.threats();
    const stage = this.staging(6);
    const every = (s: number) => w.tick - this.lastArmyOrderTick >= s * TICK_RATE;
    let c = centroid(army);
    const armyFar = army.length > 0 && dist(c, h) > 18;

    // Defend: hit the closest threat with everyone not already fighting.
    const target = this.pushTarget ? w.entities.get(this.pushTarget) : undefined;
    const nestNearlyDead = !!target && target.alive && target.hp < target.maxHp * 0.4;
    const homeValue = armyValue(threats.filter((e) => dist(e, h) <= 14));
    const pushing = this.stats.mode === 'push' || this.stats.mode === 'gather';
    const hearthLow = h.hp < h.maxHp * 0.5;
    // While pushing, the Hearth, towers and Rally the Hearth hold the base unless it is really in danger.
    const nestHalf = !!target && target.alive && target.hp < target.maxHp * 0.6;
    if (threats.length && (!pushing || hearthLow || (homeValue >= 16 && !nestHalf && !nestNearlyDead))) {
      if (pushing) this.note(`abort push: ${threats.length} threats (value ${homeValue}) at home`);
      this.stats.mode = 'build';
      this.pushTarget = 0;
      if (every(2)) {
        const tc = centroid(threats);
        const near = threats.reduce((a, b) => (dist(a, h) < dist(b, h) ? a : b));
        const free = army.filter((u) => u.targetId === 0 || armyFar);
        // Never chase further than 18 tiles from the Hearth.
        let gx = near.x * 0.7 + tc.x * 0.3;
        let gy = near.y * 0.7 + tc.y * 0.3;
        const gd = Math.hypot(gx - h.x, gy - h.y);
        if (gd > 18) {
          gx = h.x + ((gx - h.x) / gd) * 18;
          gy = h.y + ((gy - h.y) / gd) * 18;
        }
        this.order(free, 'attackMove', gx, gy, '');
        this.stats.defends++;
        this.lastArmyOrderTick = w.tick;
        this.hornIfFighting(army, threats);
      }
      return;
    }
    // Rally the Hearth when the base is swarmed and the army is away.
    if (threats.filter((e) => dist(e, h) <= 9).length >= 5 && armyFar && !this.rallied) {
      this.rallied = this.issue({ type: 'rallyHearth' }, 'Rally the Hearth');
    }

    if (!this.cfg.push) {
      if (every(4)) {
        const idle = army.filter((u) => u.targetId === 0 && dist(u, stage) > 5);
        this.order(idle, 'attackMove', stage.x, stage.y, '');
        this.lastArmyOrderTick = w.tick;
      }
      return;
    }

    const horn = this.horn();
    switch (this.stats.mode) {
      case 'build': {
        // Defend, then punish: go right after a wave breaks, unless the next one is about to launch.
        const window = w.time - this.lastBroken <= 25;
        const quiet = !horn || (horn.phase === 'muster' && horn.secondsToLaunch > 22);
        const lastNest = this.nestsAlive().length === 1;
        // The last Nest hosts every muster, so its push meets a fresh wave: bring more.
        const need = this.cfg.attackAt + (lastNest ? 8 : 0);
        if (this.nestsAlive().length && quiet && ((army.length >= need && window) || army.length >= need + 6)) {
          this.stats.mode = 'gather';
          this.note(`gather army (${army.length}${window ? ', wave broken' : ''})`);
        } else if (every(4)) {
          const stray = army.filter((u) => u.targetId === 0 && dist(u, stage) > 6);
          this.order(stray, 'attackMove', stage.x, stage.y, '');
          this.lastArmyOrderTick = w.tick;
        }
        return;
      }
      case 'gather': {
        const near = army.filter((u) => dist(u, stage) <= 7).length;
        if (near >= army.length * 0.75 || every(15)) {
          this.stats.mode = 'push';
          this.stats.pushes++;
          this.pushTarget = 0;
          this.pushGroup = new Set(army.map((u) => u.id));
          this.note(`push with ${army.length}`);
        } else if (every(3)) {
          this.order(army.filter((u) => dist(u, stage) > 7), 'move', stage.x, stage.y, '');
          this.lastArmyOrderTick = w.tick;
        }
        return;
      }
      case 'push': {
        army = army.filter((u) => this.pushGroup.has(u.id));
        c = centroid(army);
        if (army.length < this.cfg.retreatBelow) {
          this.stats.mode = 'retreat';
          this.note(`retreat (${army.length} left)`);
          this.order(army, 'move', stage.x, stage.y, '');
          this.lastArmyOrderTick = w.tick;
          return;
        }
        const nests = this.nestsAlive();
        if (!nests.length) return;
        let tgt = this.pushTarget ? w.entities.get(this.pushTarget) : undefined;
        if (!tgt || !tgt.alive) {
          // A Nest just fell: go home if a wave is on its way, else take the next one.
          if (this.pushTarget && horn && (horn.phase === 'advancing' || horn.secondsToLaunch < 15)) {
            this.note('nest down, wave coming: return');
            this.stats.mode = 'retreat';
            this.pushTarget = 0;
            this.order(army, 'attackMove', stage.x, stage.y, '');
            this.lastArmyOrderTick = w.tick;
            return;
          }
          // Spent Nests first, then the closest to the Hearth.
          const sorted = [...nests].sort((a, b) => (a.nest?.spent ? 0 : 1) - (b.nest?.spent ? 0 : 1) || dist(a, h) - dist(b, h));
          tgt = sorted[0];
          this.pushTarget = tgt.id;
          this.pushPhase = 'travel';
          this.pushPhaseTick = w.tick;
          this.note(`target Nest #${tgt.id}${(tgt as Building).nest?.spent ? ' (Spent)' : ''}`);
          // Travel to a point 8 tiles short of the Nest on the Hearth side, walking past Pickets.
          const len = dist(h, tgt) || 1;
          this.pushPoint = { x: tgt.x + ((h.x - tgt.x) / len) * 8, y: tgt.y + ((h.y - tgt.y) / len) * 8 };
          this.order(army, 'move', this.pushPoint.x, this.pushPoint.y, '');
          this.lastArmyOrderTick = w.tick;
          return;
        }
        if (!every(2)) return;
        this.lastArmyOrderTick = w.tick;
        const enemiesNear = this.visibleEnemies().filter((e) => dist(e, c) <= 9);
        this.hornIfFighting(army, enemiesNear);
        const fighters = enemiesNear.filter((e) => !e.ai || (e.ai.role !== 'picket' && e.ai.role !== 'lurker'));
        if (this.pushPhase === 'travel') {
          const arrived = army.filter((u) => dist(u, this.pushPoint) <= 5).length >= army.length * 0.7;
          if (arrived || fighters.length || w.tick - this.pushPhaseTick > 30 * TICK_RATE) {
            this.pushPhase = 'assault';
            this.note(`assault #${tgt.id}${fighters.length ? ` (engaged by ${fighters.length})` : ''}`);
            this.order(army, 'attackMove', tgt.x, tgt.y, '');
          } else {
            // Re-send anyone who stopped short.
            this.order(army.filter((u) => u.order.type === 'idle' && dist(u, this.pushPoint) > 5), 'move', this.pushPoint.x, this.pushPoint.y, '');
          }
          return;
        }
        // Assault: fight defending units, then hit the Nest itself (its spires wither with it).
        const defenders = this.visibleEnemies().filter((e) => dist(e, c) <= 8);
        if (defenders.length) {
          const foe = defenders.reduce((a, b) => (dist(a, c) < dist(b, c) ? a : b));
          const free = army.filter((u) => {
            const t = u.targetId ? w.entities.get(u.targetId) : undefined;
            return !t || t.kind !== 'unit';
          });
          this.order(free, 'attackMove', foe.x, foe.y, '');
        } else {
          const lazy = army.filter((u) => !(u.order.type === 'attack' && u.targetId === tgt!.id));
          if (lazy.length) this.issue({ type: 'attack', unitIds: lazy.map((u) => u.id), targetId: tgt.id }, '');
        }
        return;
      }
      case 'retreat': {
        if (dist(c, stage) <= 6 || every(15)) this.stats.mode = 'build';
        return;
      }
    }
  }

  private hornIfFighting(army: Unit[], enemies: Unit[]): void {
    const w = this.world;
    if (enemies.length < 3 || w.tick - this.hornTick < 10 * TICK_RATE) return;
    const warden = w.entities.get(w.wardenId);
    if (!warden || warden.kind !== 'unit' || !warden.alive) return;
    const close = army.filter((u) => dist(u, warden) <= 6).length;
    if (close < 4 || !enemies.some((e) => dist(e, warden) <= 8)) return;
    this.hornTick = w.tick;
    this.issue({ type: 'ability', slot: 'Q', x: warden.x, y: warden.y }, '');
  }
}

/** Unit counts by type for logs. */
export function census(world: World, owner: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of world.units) if (u.alive && u.owner === owner) out[u.type] = (out[u.type] ?? 0) + 1;
  return out;
}

export function armyValue(units: Unit[]): number {
  return units.reduce((s, u) => s + (UNITS[u.type].value ?? 0), 0);
}
