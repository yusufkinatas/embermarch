import { beforeEach, describe, expect, it } from 'vitest';
import { BOONS, EVENT_IDS } from '../../src/data';
import {
  campOptions,
  chooseCamp,
  chooseEventOption,
  chooseReward,
  currentEventView,
  currentReward,
  enterNode,
  finishBattle,
  leaveNode,
  reachableNodes,
  startBattle,
} from '../../src/run';
import type { EventView } from '../../src/run/types';
import type { EventId } from '../../src/sim/types';
import { forceNode, freshRun, metaWith, mkResult, units, useMemoryStorage } from './helpers';

function atEvent(event: EventId, setup?: (run: ReturnType<typeof freshRun>['run']) => void, seed = 1) {
  const { run, meta } = freshRun({ seed });
  setup?.(run);
  const { entry, node } = forceNode(run, meta, 'event', { event });
  if (entry.screen !== 'event') throw new Error(`expected event screen, got ${entry.screen}`);
  return { run, meta, view: entry.event, node };
}
const choice = (view: EventView, id: string) => view.choices.find((c) => c.id === id)!;

describe('events (§L)', () => {
  beforeEach(() => useMemoryStorage());

  it('rolls each event at most once per run; exhausted Event nodes become Camps', () => {
    const { run, meta } = freshRun();
    const ids = new Set<EventId>();
    // Visit 6 event nodes by forcing them in turn.
    for (let i = 0; i < 6; i++) {
      const { entry, node } = forceNode(run, meta, 'event');
      expect(entry.screen).toBe('event');
      if (entry.screen === 'event') ids.add(entry.event.id);
      leaveNode(run);
      expect(run.nodesDone).toContain(node.id);
      run.nodesDone = run.nodesDone.filter((id) => id !== node.id);
    }
    expect(ids.size).toBe(6);
    expect(run.eventsSeen.sort()).toEqual([...EVENT_IDS].sort());
    const { entry, node } = forceNode(run, meta, 'event');
    expect(entry.screen).toBe('camp');
    expect(node.type).toBe('camp');
  });

  it('Refugees at the Ford: pay / arm / tithe', () => {
    let s = atEvent('refugees_ford');
    expect(choice(s.view, 'pay')).toMatchObject({ enabled: false });
    s = atEvent('refugees_ford', (r) => (r.crowns = 50));
    expect(choice(s.view, 'pay').enabled).toBe(true);
    chooseEventOption(s.run, s.meta, 'pay');
    expect(s.run.crowns).toBe(10);
    expect(s.run.extraTillers).toBe(1);
    expect(s.run.nodesDone).toContain(s.node.id);
    expect(reachableNodes(s.run).map((n) => n.id)).toEqual(s.node.next);

    s = atEvent('refugees_ford');
    chooseEventOption(s.run, s.meta, 'arm');
    expect(s.run.sellswords).toEqual(units('ashpike', 2, 1, 3));

    s = atEvent('refugees_ford');
    chooseEventOption(s.run, s.meta, 'tithe');
    expect(s.run.crowns).toBe(35);
    expect(s.run.pending).toContainEqual({ kind: 'grain_gather_penalty', pct: -10 });
  });

  it('Thorn-Touched Smith: bargain hidden at 1 Resolve; 2 Rares with Ember-Tempered Mail; mercy', () => {
    let s = atEvent('thorn_smith', (r) => (r.resolve = 1));
    const bargain = choice(s.view, 'bargain');
    expect(bargain.enabled).toBe(false);
    expect(bargain.reason).toMatch(/1 Resolve/);
    expect(() => chooseEventOption(s.run, s.meta, 'bargain')).toThrow();

    s = atEvent('thorn_smith');
    chooseEventOption(s.run, s.meta, 'bargain');
    expect(s.run.resolve).toBe(2);
    const step = currentReward(s.run);
    expect(step?.kind).toBe('boon');
    if (step?.kind === 'boon') {
      expect(step.options).toHaveLength(2);
      expect(step.options[0]).toBe('ember_mail');
      for (const id of step.options) expect(BOONS[id].rarity).toBe('R');
    }
    expect(s.run.firstOfferDone).toBe(false);

    s = atEvent('thorn_smith', (r) => (r.boons = ['ember_mail']));
    chooseEventOption(s.run, s.meta, 'bargain');
    const step2 = currentReward(s.run);
    expect(step2?.kind === 'boon' && step2.options).not.toContain('ember_mail');

    s = atEvent('thorn_smith', (r) => (r.resolve = 2));
    chooseEventOption(s.run, s.meta, 'mercy');
    expect(s.run.resolve).toBe(3);
    s = atEvent('thorn_smith');
    chooseEventOption(s.run, s.meta, 'mercy');
    expect(s.run.resolve).toBe(3);
    expect(s.run.crowns).toBe(30);
  });

  it('Sellsword Company: hire / duel (50% via run RNG) / decline', () => {
    let s = atEvent('sellsword_company', (r) => (r.crowns = 70));
    chooseEventOption(s.run, s.meta, 'hire');
    expect(s.run.crowns).toBe(0);
    expect(s.run.sellswords).toEqual(units('courser', 3, 1, 3));

    let wins = 0;
    let losses = 0;
    for (let seed = 1; seed <= 200; seed++) {
      s = atEvent('sellsword_company', (r) => (r.crowns = 20), seed);
      chooseEventOption(s.run, s.meta, 'duel');
      if (s.run.sellswords.length === 3) {
        wins++;
        expect(s.run.crowns).toBe(20);
      } else {
        losses++;
        expect(s.run.crowns).toBe(0); // −30, min 0
        expect(s.run.pending).toContainEqual({ kind: 'warden_half_hp' });
      }
    }
    expect(wins).toBeGreaterThan(70);
    expect(losses).toBeGreaterThan(70);

    s = atEvent('sellsword_company');
    chooseEventOption(s.run, s.meta, 'decline');
    expect(s.run.sellswords).toEqual([]);
  });

  it('Cold Watch-Fire: watch (next battle explored, wave 1 skipped) or scavenge a Common Boon', () => {
    let s = atEvent('cold_watchfire');
    chooseEventOption(s.run, s.meta, 'watch');
    expect(s.run.pending).toContainEqual({ kind: 'cold_watchfire' });
    s = atEvent('cold_watchfire');
    chooseEventOption(s.run, s.meta, 'scavenge');
    expect(s.run.boons).toHaveLength(1);
    expect(BOONS[s.run.boons[0]].rarity).toBe('C');
  });

  it('Hollow Envoy: a Mythic (Rare if none) and waves +15% for the run; or +25 Crowns and Blood Moon next', () => {
    let s = atEvent('hollow_envoy');
    chooseEventOption(s.run, s.meta, 'accept');
    expect(BOONS[s.run.boons[0]].rarity).toBe('M');
    expect(s.run.waveMult).toBe(1.15);

    s = atEvent('hollow_envoy', (r) => (r.boons = ['flame_hearth', 'ember_tithe']));
    chooseEventOption(s.run, s.meta, 'accept');
    expect(BOONS[s.run.boons[2]].rarity).toBe('R');

    s = atEvent('hollow_envoy');
    chooseEventOption(s.run, s.meta, 'cut_down');
    expect(s.run.crowns).toBe(25);
    expect(s.run.pending).toContainEqual({ kind: 'blood_moon_next' });
  });

  it('Hollow Envoy in column 6: the boss is beyond the Blood Moon (no pending effect, honest text)', () => {
    const { run, meta } = freshRun();
    const id = run.map.columns[5][0];
    const node = run.map.nodes[id];
    node.type = 'event';
    node.battle = null;
    run.currentNode = id;
    run.currentEvent = 'hollow_envoy';
    const view = currentEventView(run, meta)!;
    expect(choice(view, 'cut_down').desc).toMatch(/Briar Throne/);
    const out = chooseEventOption(run, meta, 'cut_down');
    expect(out.text).toMatch(/Heartwood/);
    expect(run.crowns).toBe(25);
    expect(run.pending).toEqual([]);
  });

  it('a pending Blood Moon never reaches the boss battle', () => {
    const { run, meta } = freshRun();
    run.pending.push({ kind: 'blood_moon_next' });
    forceNode(run, meta, 'boss');
    expect(startBattle(run, meta, 'muster_hall').modifiers).toEqual([]);
  });

  it('Wayshrine of Ash: pray (+1 Resolve, lose a random Common) / offer 40 / leave', () => {
    let s = atEvent('wayshrine');
    expect(choice(s.view, 'pray')).toMatchObject({ enabled: false });
    s = atEvent('wayshrine', (r) => {
      r.resolve = 2;
      r.boons = ['harvest_songs', 'baggage_train'];
    });
    chooseEventOption(s.run, s.meta, 'pray');
    expect(s.run.resolve).toBe(3);
    expect(s.run.boons).toEqual(['baggage_train']);

    s = atEvent('wayshrine', (r) => (r.resolve = 2));
    chooseEventOption(s.run, s.meta, 'pray');
    expect(s.run.resolve).toBe(3);

    s = atEvent('wayshrine', (r) => (r.crowns = 45));
    chooseEventOption(s.run, s.meta, 'offer');
    expect(s.run.crowns).toBe(5);
    expect(s.run.pending).toContainEqual({ kind: 'reward_plus_one', picks: 2 });

    s = atEvent('wayshrine');
    expect(chooseEventOption(s.run, s.meta, 'leave').text).toBeTruthy();
    expect(s.run.nodesDone).toContain(s.node.id);
  });

  it('the event view survives a reload and resolves once', () => {
    const s = atEvent('cold_watchfire');
    expect(currentEventView(s.run, s.meta)?.id).toBe('cold_watchfire');
    const again = enterNode(s.run, s.meta, s.node.id);
    expect(again.screen === 'event' && again.event.id).toBe('cold_watchfire');
    chooseEventOption(s.run, s.meta, 'watch');
    expect(currentEventView(s.run, s.meta)).toBeNull();
    expect(chooseEventOption(s.run, s.meta, 'watch').text).toBe('');
    expect(s.run.pending.filter((p) => p.kind === 'cold_watchfire')).toHaveLength(1);
  });

  it('pending event effects reach the next BattleSetup and are consumed by it', () => {
    const { run, meta } = freshRun();
    run.pending.push(
      { kind: 'grain_gather_penalty', pct: -10 },
      { kind: 'cold_watchfire' },
      { kind: 'warden_half_hp' },
      { kind: 'blood_moon_next' },
    );
    forceNode(run, meta, 'battle', { battle: { modifiers: ['thick_fog'] } });
    const setup = startBattle(run, meta, 'muster_hall');
    expect(setup.coldWatchfire).toBe(true);
    expect(setup.wardenHpPct).toBe(0.5);
    expect(setup.modifiers).toEqual(['thick_fog', 'blood_moon']);
    expect(setup.playerEffects).toContainEqual({ kind: 'gather', res: 'grain', pct: -10 });
    finishBattle(run, meta, mkResult());
    expect(run.pending).toEqual([]);
  });
});

describe('Camp (§L)', () => {
  beforeEach(() => useMemoryStorage());

  const atCamp = (setup?: (run: ReturnType<typeof freshRun>['run']) => void) => {
    const { run, meta } = freshRun();
    setup?.(run);
    const { entry, node } = forceNode(run, meta, 'camp');
    expect(entry.screen).toBe('camp');
    return { run, meta, node };
  };

  it('Rest: +1 Resolve, or +30 Crowns at max', () => {
    let c = atCamp((r) => (r.resolve = 1));
    expect(campOptions(c.run, c.meta)[0].desc).toMatch(/\+1 Resolve/);
    chooseCamp(c.run, c.meta, 'rest');
    expect(c.run.resolve).toBe(2);
    expect(c.run.nodesDone).toContain(c.node.id);
    c = atCamp();
    chooseCamp(c.run, c.meta, 'rest');
    expect(c.run.crowns).toBe(30);
    expect(chooseCamp(c.run, c.meta, 'rest').text).toBe('');
    expect(c.run.crowns).toBe(30);
  });

  it('Drill: every Retinue unit +1 Rank (max III); empty Retinue → 2 Rank I Ashpike Sellswords', () => {
    let c = atCamp((r) => (r.retinue = [{ type: 'bowman', rank: 0, kills: 0 }, { type: 'courser', rank: 3, kills: 13 }]));
    chooseCamp(c.run, c.meta, 'drill');
    expect(c.run.retinue).toEqual([
      { type: 'bowman', rank: 1, kills: 3 },
      { type: 'courser', rank: 3, kills: 13 },
    ]);
    c = atCamp();
    expect(campOptions(c.run, c.meta)[1].desc).toMatch(/Sellswords/);
    chooseCamp(c.run, c.meta, 'drill');
    expect(c.run.sellswords).toEqual(units('ashpike', 2, 1, 3));
  });

  it('Muster: a Draft pick of 3; with an empty pool, a random Common Boon', () => {
    let c = atCamp();
    chooseCamp(c.run, c.meta, 'muster');
    const step = currentReward(c.run);
    expect(step?.kind === 'draft' && step.options.length).toBe(3);
    chooseReward(c.run, c.meta, 2);
    expect(c.run.drafts).toHaveLength(1);

    c = atCamp((r) => (r.drafts = ['draft_shieldwall', 'draft_firecraft', 'draft_heavy_horse', 'draft_siegecraft']));
    chooseCamp(c.run, c.meta, 'muster');
    expect(currentReward(c.run)).toBeNull();
    expect(c.run.boons).toHaveLength(1);
    expect(BOONS[c.run.boons[0]].rarity).toBe('C');
  });

  it('Sellswords from a Camp fight the next battle, then join the survivor pool', () => {
    const c = atCamp();
    chooseCamp(c.run, c.meta, 'drill');
    c.run.currentNode = c.node.id;
    const nextId = c.node.next[0];
    const next = c.run.map.nodes[nextId];
    next.type = 'battle';
    next.battle = { objective: 'raze', biome: 'fenreach', modifiers: [], reward: 'boon', doctrine: 'swarm', threat: 2, depth: next.col, seed: 5 };
    enterNode(c.run, c.meta, nextId);
    const setup = startBattle(c.run, c.meta, 'muster_hall');
    expect(setup.sellswords).toEqual(units('ashpike', 2, 1, 3));
    finishBattle(c.run, c.meta, mkResult({ survivors: units('ashpike', 2, 1, 4) }));
    expect(c.run.sellswords).toEqual([]);
    expect(c.run.rewardQueue.at(-1)).toMatchObject({ kind: 'retinue', candidates: units('ashpike', 2, 1, 4) });
  });

  it('meta-free camp works with a default profile too', () => {
    const meta = metaWith();
    const { run } = freshRun({ meta });
    forceNode(run, meta, 'camp');
    expect(campOptions(run, meta).map((o) => o.id)).toEqual(['rest', 'drill', 'muster']);
  });
});
