/**
 * Plays whole runs through the public API with random (seeded) choices and random reloads.
 * Guards the screen flow invariants the app relies on.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { BOONS, DRAFTS, UNITS } from '../../src/data';
import {
  buyPeddlerItem,
  campOptions,
  chooseCamp,
  chooseEventOption,
  chooseReward,
  currentReward,
  endRun,
  enterNode,
  finishBattle,
  loadRun,
  leaveNode,
  newRun,
  reachableNodes,
  rerollPeddler,
  resolveInterruptedBattle,
  startBattle,
} from '../../src/run';
import type { RunState } from '../../src/run/types';
import type { CarriedUnit, PlayerUnitId } from '../../src/sim/types';
import { metaWith, mkResult, useMemoryStorage } from './helpers';

function randomSurvivors(rng: Rng, allowed: PlayerUnitId[]): CarriedUnit[] {
  const military = allowed.filter((u) => u !== 'tiller' && u !== 'warden');
  return Array.from({ length: rng.int(0, 9) }, () => {
    const kills = rng.int(0, 14);
    return { type: rng.pick(military), rank: (kills >= 12 ? 3 : kills >= 7 ? 2 : kills >= 3 ? 1 : 0) as 0 | 1 | 2 | 3, kills };
  });
}

function checkInvariants(run: RunState): void {
  expect(run.resolve).toBeGreaterThanOrEqual(0);
  expect(run.resolve).toBeLessThanOrEqual(run.maxResolve);
  expect(run.crowns).toBeGreaterThanOrEqual(0);
  expect(new Set(run.boons).size).toBe(run.boons.length);
  expect(new Set(run.drafts).size).toBe(run.drafts.length);
  for (const b of run.boons) expect(BOONS[b]).toBeTruthy();
  for (const d of run.drafts) expect(DRAFTS[d]).toBeTruthy();
  const head = currentReward(run);
  if (head && head.kind !== 'retinue') {
    expect(head.options.length).toBeGreaterThan(0);
    for (const o of head.options as string[]) expect(run.boons.includes(o as never) || run.drafts.includes(o as never)).toBe(false);
  }
  for (const u of run.retinue) expect(UNITS[u.type]).toBeTruthy();
}

describe('full-run fuzz', () => {
  beforeEach(() => useMemoryStorage());

  it('200 random runs reach an end with consistent state', () => {
    let won = 0;
    let lost = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rng = new Rng(seed * 31);
      const meta = metaWith(
        rng.chance(0.5) ? ['codex_1', 'codex_2', 'codex_3', 'guild_ties', 'opening_boon', 'seasoned_retinue', 'outriding', 'lamplight'] : [],
      );
      meta.unlocks.push('house_grimbrand');
      let run = newRun(meta, { house: rng.pick(['ardent', 'grimbrand'] as const), tier: 0, seed });
      let steps = 0;
      while (!run.over) {
        if (++steps > 400) throw new Error(`run ${seed} did not finish`);
        checkInvariants(run);
        if (rng.chance(0.15)) {
          run = loadRun()!;
          resolveInterruptedBattle(run, meta);
          if (run.over) break;
        }
        const step = currentReward(run);
        if (step) {
          if (step.kind === 'retinue') {
            const picks = rng.shuffle(step.candidates.map((_, i) => i));
            chooseReward(run, meta, 0, picks);
            expect(run.retinue.reduce((a, u) => a + UNITS[u.type].pop, 0)).toBeLessThanOrEqual(step.capPop);
          } else {
            chooseReward(run, meta, rng.chance(0.1) ? 'skip' : rng.int(0, step.options.length - 1));
          }
          continue;
        }
        const options = reachableNodes(run);
        expect(options.length).toBeGreaterThan(0);
        const node = rng.pick(options);
        const entry = enterNode(run, meta, node.id);
        if (entry.screen === 'briefing') {
          const setup = startBattle(run, meta, rng.pick(['muster_hall', 'bowyard', 'storehouse'] as const));
          if (rng.chance(0.1)) {
            // Quit to Title mid-battle, then Continue: the interrupted battle resolves (§B Autosave).
            run = loadRun()!;
            expect(run.battleInProgress).toBe(true);
            const resolveBefore = run.resolve;
            expect(resolveInterruptedBattle(run, meta)).toBeTruthy();
            expect(run.resolve).toBe(resolveBefore - 1);
            continue;
          }
          const roll = rng.next();
          const outcome = node.type === 'boss' ? (roll < 0.6 ? 'victory' : 'defeat') : roll < 0.8 ? 'victory' : roll < 0.9 ? 'retreat' : 'defeat';
          finishBattle(
            run,
            meta,
            mkResult({
              outcome,
              objective: setup.objective,
              depth: setup.depth,
              plunderCrowns: rng.int(0, 60),
              underPar: rng.chance(0.5),
              nestsDestroyed: rng.int(0, 3),
              ancientCacheLooted: setup.modifiers.includes('ancient_cache') && rng.chance(0.5),
              lastStandsUsed: node.type === 'boss' && outcome === 'defeat' ? run.resolve : 0,
              survivors: randomSurvivors(rng, setup.unlockedUnits),
              unspent: { grain: rng.int(0, 600), timber: rng.int(0, 600), ember: rng.int(0, 300) },
            }),
          );
        } else if (entry.screen === 'event') {
          const enabled = entry.event.choices.filter((c) => c.enabled);
          chooseEventOption(run, meta, rng.pick(enabled).id);
        } else if (entry.screen === 'camp') {
          chooseCamp(run, meta, rng.pick(campOptions(run, meta)).id);
        } else {
          for (let i = 0; i < 3; i++) {
            if (rng.chance(0.3)) rerollPeddler(run, meta);
            buyPeddlerItem(run, meta, rng.int(0, entry.stock.items.length - 1));
          }
          leaveNode(run);
        }
      }
      checkInvariants(run);
      const summary = endRun(run, meta);
      if (summary.won) won++;
      else lost++;
      expect(summary.renownTotal).toBeGreaterThan(0);
      expect(loadRun()).toBeNull();
    }
    expect(won).toBeGreaterThan(0);
    expect(lost).toBeGreaterThan(0);
  });
});
