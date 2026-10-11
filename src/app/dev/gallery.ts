/**
 * DEV-ONLY screen gallery (loaded via dynamic import behind import.meta.env.DEV and ?dev=<screen>).
 * Drives the real run API on an in-memory storage backend so the real save is never touched, then
 * pokes run state where needed to reach a specific screen. Never bundled into production.
 *
 *   ?dev=title|setup|map|briefing|results|reward|retinue|event|camp|peddler|summary|hall|howto|battle
 *   &steps=N        nodes to auto-walk first (map, briefing, results...)
 *   &outcome=defeat results for a defeat / retreat
 *   &ev=<eventId>   which event to show
 *   &renown=N&unlocks=a,b&tier=N  meta fixture
 *   &won=1          summary for a won run
 */
import { AppShell } from '../app';
import { realRunApi } from '../api';
import { BattleController } from '../../game/battle';
import { MemoryStorage, setStorageBackend } from '../../run';
import type { MetaSave, RunState } from '../../run/types';
import type { BattleResult, EventId, MetaUnlockId } from '../../sim/types';
import { bestPicks } from '../logic/retinue';
import type { BattleFactory } from '../types';

const api = realRunApi;

function num(v: string | null, d: number): number {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

export function fixtureResult(objective: BattleResult['objective'], depth: number, outcome: BattleResult['outcome'] = 'victory'): BattleResult {
  return {
    outcome,
    time: outcome === 'retreat' ? 214 : 338,
    objective,
    depth,
    plunderCrowns: outcome === 'defeat' ? 0 : 25,
    underPar: outcome === 'victory',
    unbroken: true,
    uprooted: false,
    nestsDestroyed: outcome === 'victory' ? 2 : 1,
    picketsDestroyed: 1,
    cachesLooted: 1,
    ancientCacheLooted: false,
    lordSlain: objective === 'elite' && outcome === 'victory',
    regentSlain: objective === 'boss' && outcome === 'victory',
    lastStandsUsed: 0,
    survivors:
      outcome === 'defeat'
        ? []
        : [
            { type: 'ashpike', rank: 3, kills: 13 },
            { type: 'bowman', rank: 2, kills: 8 },
            { type: 'ashpike', rank: 1, kills: 4 },
            { type: 'courser', rank: 1, kills: 3 },
            { type: 'ashpike', rank: 0, kills: 1 },
            { type: 'bowman', rank: 0, kills: 0 },
            { type: 'oathshield', rank: 1, kills: 5 },
          ],
    unspent: { grain: 120, timber: 80, ember: 30 },
    stats: { gathered: { grain: 1450, timber: 1320, ember: 410 }, unitsTrained: 21, unitsLost: 7, kills: 64, buildingsBuilt: 9, buildingsLost: 1 },
  };
}

function resolveRewards(run: RunState, meta: MetaSave): void {
  for (let guard = 0; guard < 10; guard++) {
    const s = api.currentReward(run);
    if (!s) return;
    if (s.kind === 'retinue') api.chooseReward(run, meta, 0, bestPicks(s.candidates, s.capPop));
    else api.chooseReward(run, meta, 0);
  }
}

function playBattle(run: RunState, meta: MetaSave, outcome: BattleResult['outcome'] = 'victory'): ReturnType<typeof api.finishBattle> {
  const node = run.map.nodes[run.currentNode!];
  api.startBattle(run, meta, 'muster_hall');
  return api.finishBattle(run, meta, fixtureResult(node.battle!.objective, node.battle!.depth, outcome));
}

/** Enter the first reachable node and resolve it completely. */
function walkOne(run: RunState, meta: MetaSave): void {
  const next = api.reachableNodes(run)[0];
  if (!next) return;
  const entry = api.enterNode(run, meta, next.id);
  if (entry.screen === 'briefing') playBattle(run, meta);
  else if (entry.screen === 'event') {
    const c = entry.event.choices.find((x) => x.enabled);
    if (c) api.chooseEventOption(run, meta, c.id);
  } else if (entry.screen === 'camp') api.chooseCamp(run, meta, 'rest');
  else api.leaveNode(run);
  resolveRewards(run, meta);
}

/** Force the run to stand at a fresh node of the given type in column 2+. */
function forceNode(run: RunState, type: 'event' | 'camp' | 'peddler'): string {
  const col = run.map.columns[2] ?? run.map.columns[1];
  const id = col[0];
  const node = run.map.nodes[id];
  node.type = type;
  node.battle = null;
  run.nodesDone = [run.map.startId, run.map.columns[1][0]];
  run.currentNode = id;
  return id;
}

export function runGallery(root: HTMLElement, params: URLSearchParams): void {
  setStorageBackend(new MemoryStorage());
  const meta = api.defaultMeta();
  meta.renown = num(params.get('renown'), 85);
  meta.unlocks = (params.get('unlocks') ?? 'codex_1,house_tallow,opening_boon').split(',').filter(Boolean) as MetaUnlockId[];
  meta.tierUnlocked = num(params.get('tier'), 1);
  meta.stats = { runs: 4, wins: 0, kills: 512, bestDepth: 4, totalRenown: 310 };
  api.saveMeta(meta);

  const screen = params.get('dev') ?? 'title';
  const needsRun = !['setup', 'hall', 'howto', 'battle', 'settings'].includes(screen) || params.has('run');
  let run: RunState | null = null;
  if (needsRun) {
    run = api.newRun(meta, { house: (params.get('house') as RunState['house']) ?? 'ardent', tier: 0, seed: num(params.get('seed'), 4242) });
    if (screen !== 'opening') resolveRewards(run, meta);
    if (params.get('rich') !== '0') {
      run.crowns = 165;
      run.boons = ['harvest_songs', 'firebrand', 'flame_hearth', 'veterans_oath'];
      run.drafts = ['draft_shieldwall', 'draft_heavy_horse'];
      run.retinue = [
        { type: 'ashpike', rank: 2, kills: 8 },
        { type: 'bowman', rank: 1, kills: 4 },
        { type: 'courser', rank: 0, kills: 1 },
      ];
      run.sellswords = [{ type: 'ashpike', rank: 1, kills: 3 }];
    }
    const steps = num(params.get('steps'), screen === 'map' ? 3 : 0);
    for (let i = 0; i < steps; i++) walkOne(run, meta);
    api.saveRun(run);
  }

  const factory: BattleFactory = (r, s, c, o) => new BattleController(r, s, c, o);
  const app = new AppShell(root, { api, battleFactory: factory });
  const bootParams = new URLSearchParams();
  app.boot(bootParams);
  const live = app.run;
  const outcome = (params.get('outcome') as BattleResult['outcome'] | null) ?? 'victory';

  switch (screen) {
    case 'title':
      return;
    case 'setup':
    case 'hall':
    case 'howto':
      app.go({ screen });
      return;
    case 'map':
      app.go({ screen: 'map' });
      return;
    case 'opening':
      app.advance();
      return;
    case 'settings':
      app.openSettings();
      return;
    case 'briefing': {
      if (!live) return;
      for (let i = 0; i < 8; i++) {
        const r = api.reachableNodes(live);
        const battle = r.find((n) => n.type === 'battle' || n.type === 'elite' || n.type === 'boss');
        if (battle) {
          const entry = api.enterNode(live, meta, battle.id);
          if (entry.screen === 'briefing') app.go({ screen: 'briefing', briefing: entry.briefing });
          return;
        }
        walkOne(live, meta);
      }
      return;
    }
    case 'results':
    case 'reward':
    case 'retinue': {
      if (!live) return;
      const target = api.reachableNodes(live).find((n) => n.battle) ?? api.reachableNodes(live)[0];
      api.enterNode(live, meta, target.id);
      const node = live.map.nodes[target.id];
      const setup = api.startBattle(live, meta, 'muster_hall');
      void setup;
      const result = fixtureResult(node.battle!.objective, node.battle!.depth, outcome);
      const post = api.finishBattle(live, meta, result);
      if (screen === 'results') {
        app.go({ screen: 'results', result, post, quick: false });
        return;
      }
      if (screen === 'retinue') {
        for (let g = 0; g < 6; g++) {
          const s = api.currentReward(live);
          if (!s || s.kind === 'retinue') break;
          api.chooseReward(live, meta, 0);
        }
      }
      app.advance();
      return;
    }
    case 'event': {
      if (!live) return;
      const id = forceNode(live, 'event');
      live.currentEvent = (params.get('ev') as EventId | null) ?? 'thorn_smith';
      const entry = api.enterNode(live, meta, id);
      if (entry.screen === 'event') app.go({ screen: 'event', event: entry.event });
      return;
    }
    case 'camp': {
      if (!live) return;
      forceNode(live, 'camp');
      app.go({ screen: 'camp' });
      return;
    }
    case 'peddler': {
      if (!live) return;
      const id = forceNode(live, 'peddler');
      live.peddler = null;
      api.enterNode(live, meta, id);
      app.go({ screen: 'peddler' });
      return;
    }
    case 'summary': {
      if (!live) return;
      live.stats.battlesWon = 4;
      live.stats.elitesWon = 1;
      live.stats.nestsDestroyed = 9;
      live.stats.kills = 287;
      live.stats.crownsEarned = 512;
      live.stats.timePlayed = 2290;
      live.over = params.get('won') ? 'won' : 'lost';
      app.advance();
      return;
    }
    case 'battle':
      app.quickBattle({ objective: (params.get('objective') as BattleResult['objective'] | null) ?? 'raze', depth: num(params.get('depth'), 1), seed: num(params.get('seed'), 7) });
      return;
  }
}
