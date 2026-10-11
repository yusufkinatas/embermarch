/**
 * getEncounterView: read-only HUD summary (§O tracker texts, Wave Horn, boss bar, Nests, dusk).
 */
import { ASCENDANT, BEACONS, HOLDFAST, parSeconds } from '../../data/balance';
import { TEXT } from '../../data/text';
import { TICK_RATE, type EnemyUnitId, type World } from '../types';
import { bossView } from './boss';
import { fmtClock, isAscendantObjective, sizeLabel, spentActive } from './formulas';
import { liveUnit } from './geom';
import { lordView } from './noble';
import type { EncRuntime, WaveRec } from './state';
import type { EncounterView, WaveHornView } from './types';

export function ascendantIn(world: World, st: EncRuntime): number | null {
  if (!isAscendantObjective(st.objective) || st.ascendant) return null;
  const left = ASCENDANT.time - world.time;
  return left <= ASCENDANT.warnLead && left > 0 ? left : null;
}

export function parRemaining(world: World, st: EncRuntime): number | null {
  const par = parSeconds(st.objective, st.nestsTotal);
  if (par === null) return null;
  const left = par - world.time;
  return left > 0 ? left : null;
}

export function trackerText(world: World, st: EncRuntime): string {
  const destroyed = st.nests.filter((n) => !n.alive).length;
  const total = st.nestsTotal;
  const parText = () => `Par ${fmtClock(parRemaining(world, st) ?? 0)}`;
  switch (st.objective) {
    case 'raze':
      return `Nests ${destroyed}/${total} · ${parText()}`;
    case 'elite':
      return `Nests ${destroyed}/${total} · Lord ${st.plunder.lordSlain ? 1 : 0}/1 · ${parText()}`;
    case 'holdfast':
      return `Waves ${Math.min(st.wavesLaunched, HOLDFAST.waves)}/${HOLDFAST.waves}`;
    case 'beacons':
      return `Kindling ${Math.floor(st.kindling)}/${BEACONS.kindlingTarget}`;
    case 'boss':
      if (st.boss && st.boss.phase === 2) return 'Slay the Briar Regent';
      return `Burn the Root Hearts ${destroyed}/${total} · ${TEXT.regentWarded}`;
  }
}

function pickHornWaves(world: World, st: EncRuntime): WaveRec[] {
  const visible = st.waves.filter((w) => w.kind === 'wave' && w.phase !== 'broken' && (w.phase === 'advancing' || world.time + 1e-6 >= w.hornAt));
  if (visible.length === 0) return [];
  const mustering = visible.filter((w) => w.phase === 'muster').sort((a, b) => a.launchAt - b.launchAt);
  const lead = mustering.length > 0 ? mustering[0] : visible.filter((w) => w.phase === 'advancing').sort((a, b) => b.launchTick - a.launchTick)[0];
  if (!lead) return [];
  if (!lead.great) return [lead];
  return visible.filter((w) => w.great && w.n === lead.n && w.phase === lead.phase);
}

function hornView(world: World, st: EncRuntime): WaveHornView | null {
  const ws = pickHornWaves(world, st);
  if (ws.length === 0) return null;
  const lead = ws[0];
  const counts = new Map<EnemyUnitId, number>();
  let alive = 0;
  let sx = 0;
  let sy = 0;
  for (const w of ws) {
    for (const id of w.members) {
      const u = liveUnit(world, id);
      if (!u) continue;
      alive++;
      sx += u.x;
      sy += u.y;
      const t = u.type as EnemyUnitId;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const revealed = !st.mods.thickFog && ws.some((w) => w.revealed);
  const composition = revealed
    ? [...counts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count)
    : [];
  const notes: string[] = [];
  if (lead.great && lead.phase === 'muster') notes.push(TEXT.greatWave);
  for (const w of ws) for (const n of w.notes) if (!notes.includes(n)) notes.push(n);
  if (revealed) {
    const riders = counts.get('stagrider') ?? 0;
    const main = alive - riders - (counts.get('rootbreaker') ?? 0);
    if (riders > 0 && main > 0) notes.push(TEXT.ridersAhead);
    if ((counts.get('rootbreaker') ?? 0) > 0) notes.push(TEXT.rootbreakerTrailing);
  }
  if (st.lord && st.lord.joined && !st.lord.risen) {
    const lordUnit = liveUnit(world, st.lord.id);
    if (lordUnit && lordUnit.ai && lordUnit.ai.wave === lead.n) notes.push('The Antlered Lord rides');
  }
  const asc = ascendantIn(world, st);
  if (asc !== null) notes.push(TEXT.ascendantSoon(fmtClock(asc)));
  const advancing = lead.phase === 'advancing';
  const secondsToLaunch = advancing ? -((world.tick - lead.launchTick) / TICK_RATE) : lead.launchAt - world.time;
  return {
    wave: lead.n,
    secondsToLaunch,
    phase: advancing ? 'advancing' : 'muster',
    direction: lead.dir,
    revealed,
    composition,
    sizeLabel: sizeLabel(alive),
    notes,
    nestId: lead.nestId,
    x: advancing && alive > 0 ? sx / alive : lead.musterX,
    y: advancing && alive > 0 ? sy / alive : lead.musterY,
  };
}

export function buildView(world: World, st: EncRuntime): EncounterView {
  const tick = world.tick;
  const denom = st.objective === 'holdfast' ? HOLDFAST.waves : 8;
  return {
    objective: st.objective,
    trackerText: trackerText(world, st),
    parRemaining: parRemaining(world, st),
    horn: hornView(world, st),
    wavesLaunched: st.wavesLaunched,
    boss: bossView(world, st) ?? lordView(world, st),
    nests: st.nests.map((n) => {
      const spent = n.alive && spentActive(n.spent, tick);
      return {
        id: n.id,
        x: n.cx,
        y: n.cy,
        alive: n.alive,
        spent,
        spentRemaining: spent ? (n.spent.until - tick) / TICK_RATE : 0,
        seen: !!n.b.nest?.seen,
      };
    }),
    ascendantIn: ascendantIn(world, st),
    plunderCrowns: st.plunder.crowns,
    doctrine: st.doctrine,
    doctrineSeen: st.doctrineSeen,
    kindling: st.objective === 'beacons' ? { value: Math.floor(st.kindling), target: BEACONS.kindlingTarget } : null,
    dusk: Math.max(0, Math.min(1, st.wavesLaunched / denom)),
    revealedEnemyIds: st.cleanup ? st.revealed.slice() : [],
  };
}
