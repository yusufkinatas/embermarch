/**
 * A whole run, headless: the run layer drives node choices and rewards, and every battle is real
 * (mapgen + createWorld + stepWorld) and played by the bot. Checks that what the run carries
 * (Retinue, Sellswords, Boons, Drafts, House, Resolve) actually reaches each battle's world, and
 * that each BattleResult flows back into Crowns, Resolve and the next node.
 */
import { describe, expect, it } from 'vitest';
import { generateMap } from '../../src/mapgen';
import {
  MemoryStorage,
  chooseCamp,
  chooseEventOption,
  chooseReward,
  currentReward,
  defaultMeta,
  endRun,
  enterNode,
  finishBattle,
  leaveNode,
  newRun,
  reachableNodes,
  setStorageBackend,
  startBattle,
} from '../../src/run';
import type { RunState } from '../../src/run/types';
import type { BattleResult, BattleSetup, World } from '../../src/sim/types';
import { PLAYER } from '../../src/sim/types';
import { buildBattleResult, createWorld, drainEvents, stepWorld } from '../../src/sim/world';
import { Bot } from './bot';

interface BattleLog {
  node: string;
  objective: string;
  depth: number;
  outcome: BattleResult['outcome'];
  time: number;
  crowns: number;
  retinueIn: number;
  carriedOnField: number;
}

/** Play one battle with the bot; Sound the Retreat if it is still undecided at the time limit. */
function playBattle(setup: BattleSetup, maxTime: number): { world: World; result: BattleResult; carriedAtStart: { type: string; rank: number }[] } {
  const gen = generateMap({ seed: setup.seed, objective: setup.objective, biome: setup.biome, depth: setup.depth, modifiers: setup.modifiers });
  const world = createWorld(setup, gen);
  const carriedAtStart = world.units.filter((u) => u.owner === PLAYER && u.carried).map((u) => ({ type: u.type, rank: u.rank }));
  const bot = new Bot(world);
  while (world.countdown > 0) stepWorld(world);
  while (world.outcome === 'ongoing' && world.time < maxTime) {
    bot.update();
    stepWorld(world);
    for (const ev of drainEvents(world)) bot.onEvent(ev);
  }
  const outcome: BattleResult['outcome'] = world.outcome === 'ongoing' ? (setup.isBoss ? 'defeat' : 'retreat') : world.outcome;
  return { world, result: buildBattleResult(world, outcome), carriedAtStart };
}

function drainRewards(run: RunState, meta: ReturnType<typeof defaultMeta>): void {
  for (let guard = 0; guard < 10; guard++) {
    const step = currentReward(run);
    if (!step) return;
    if (step.kind === 'retinue') {
      // Greedy: highest rank first, within the pop cap.
      const order = step.candidates.map((c, i) => ({ c, i })).sort((a, b) => b.c.rank - a.c.rank || b.c.kills - a.c.kills);
      const picks: number[] = [];
      let pop = 0;
      for (const { c, i } of order) {
        const p = c.type === 'destrier' || c.type === 'gatebreaker' ? 2 : 1;
        if (pop + p > step.capPop) continue;
        pop += p;
        picks.push(i);
      }
      chooseReward(run, meta, 0, picks);
    } else chooseReward(run, meta, step.options.length ? 0 : 'skip');
  }
  throw new Error('reward queue did not drain');
}

describe('a full run with real battles', () => {
  it('carries Retinue, Boons and Drafts into each battle and ends with a summary', () => {
    setStorageBackend(new MemoryStorage());
    const meta = defaultMeta();
    const run = newRun(meta, { house: 'ardent', tier: 0, seed: 4242 });
    const battles: BattleLog[] = [];
    const visited: string[] = [];
    for (let step = 0; step < 12 && !run.over; step++) {
      drainRewards(run, meta);
      if (run.over) break;
      const options = reachableNodes(run);
      expect(options.length).toBeGreaterThan(0);
      // Prefer a non-battle node every other step, so events / camps / peddlers get exercised.
      const calm = options.find((n) => n.type === 'event' || n.type === 'camp' || n.type === 'peddler');
      const node = step % 2 === 1 && calm ? calm : options.find((n) => n.type === 'battle') ?? options[0];
      visited.push(`${node.col}:${node.type}`);
      const entry = enterNode(run, meta, node.id);
      if (entry.screen === 'briefing') {
        const retinueIn = run.retinue.length + run.sellswords.length;
        const boons = [...run.boons];
        const setup = startBattle(run, meta, 'muster_hall');
        expect(run.battleInProgress).toBe(true);
        expect(setup.boons).toEqual(boons);
        expect(setup.retinue.length + setup.sellswords.length).toBe(retinueIn);
        for (const d of run.drafts) {
          if (d === 'draft_shieldwall') expect(setup.unlockedUnits).toContain('oathshield');
          if (d === 'draft_siegecraft') expect(setup.unlockedBuildings).toContain('siegeyard');
        }
        const { world, result, carriedAtStart } = playBattle(setup, setup.isBoss ? 540 : 660);
        // Every carried unit spawned on the field with its type and rank.
        const want = [...setup.retinue, ...setup.sellswords].map((c) => `${c.type}:${c.rank}`).sort();
        expect(carriedAtStart.map((c) => `${c.type}:${c.rank}`).sort()).toEqual(want);
        for (const u of world.units) {
          expect(Number.isFinite(u.x) && Number.isFinite(u.y)).toBe(true);
        }
        const crownsBefore = run.crowns;
        const post = finishBattle(run, meta, result);
        expect(run.battleInProgress).toBe(false);
        expect(run.nodesDone).toContain(node.id);
        expect(post.outcome).toBe(result.outcome);
        expect(run.crowns - crownsBefore).toBe(post.crownsTotal);
        if (result.outcome === 'victory') expect(post.crownsTotal).toBeGreaterThan(0);
        else expect(post.resolveLost).toBeGreaterThanOrEqual(1);
        battles.push({
          node: node.id,
          objective: setup.objective,
          depth: setup.depth,
          outcome: result.outcome,
          time: Math.round(result.time),
          crowns: post.crownsTotal,
          retinueIn,
          carriedOnField: carriedAtStart.length,
        });
      } else if (entry.screen === 'event') {
        const choice = entry.event.choices.find((c) => c.enabled)!;
        expect(chooseEventOption(run, meta, choice.id).text.length).toBeGreaterThan(0);
      } else if (entry.screen === 'camp') {
        expect(chooseCamp(run, meta, 'rest').text.length).toBeGreaterThan(0);
      } else {
        leaveNode(run);
      }
    }
    const summary = endRun(run, meta);
    const msg = JSON.stringify({ visited, battles, over: run.over, resolve: run.resolve, crowns: run.crowns, boons: run.boons, drafts: run.drafts }, null, 1);
    expect(battles.length, msg).toBeGreaterThanOrEqual(3);
    expect(battles.some((b) => b.outcome === 'victory'), msg).toBe(true);
    // Veterans picked after a victory march into a later battle.
    expect(battles.some((b) => b.retinueIn > 0 && b.carriedOnField > 0), msg).toBe(true);
    expect(summary.renownTotal, msg).toBeGreaterThan(0);
    expect(meta.renown).toBe(summary.renownTotal);
    expect(run.boons.length + run.drafts.length, msg).toBeGreaterThan(0);
  });
});
