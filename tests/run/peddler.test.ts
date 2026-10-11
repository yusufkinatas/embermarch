import { beforeEach, describe, expect, it } from 'vitest';
import { BOONS } from '../../src/data';
import { buyPeddlerItem, enterNode, leaveNode, reachableNodes, rerollPeddler } from '../../src/run';
import type { PeddlerStock } from '../../src/run/types';
import { forceNode, freshRun, metaWith, useMemoryStorage } from './helpers';

function atPeddler(unlocks: Parameters<typeof metaWith>[0] = [], crowns = 1000, seed = 1) {
  const meta = metaWith(unlocks);
  const { run } = freshRun({ meta, seed });
  run.crowns = crowns;
  const { entry, node } = forceNode(run, meta, 'peddler');
  if (entry.screen !== 'peddler') throw new Error('expected peddler');
  return { run, meta, stock: entry.stock, node };
}
const boonItems = (s: PeddlerStock) => s.items.filter((i) => i.kind === 'boon');

describe('Peddler (§L)', () => {
  beforeEach(() => useMemoryStorage());

  it('stocks 3 Boons (one per rarity at 55/100/175), 1 Draft 90, Resolve 90, 2 Sellsword offers', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { stock } = atPeddler([], 0, seed);
      const boons = boonItems(stock);
      expect(boons.map((b) => BOONS[b.boon!].rarity)).toEqual(['C', 'R', 'M']);
      expect(boons.map((b) => b.price)).toEqual([55, 100, 175]);
      expect(stock.items.filter((i) => i.kind === 'draft').map((i) => i.price)).toEqual([90]);
      expect(stock.items.filter((i) => i.kind === 'resolve').map((i) => i.price)).toEqual([90]);
      const ss = stock.items.filter((i) => i.kind === 'sellswords');
      expect(ss).toHaveLength(2);
      expect(new Set(ss.map((i) => i.units![0].type)).size).toBe(2);
      for (const i of ss) {
        const t = i.units![0].type;
        const expected = { ashpike: [2, 35], bowman: [3, 45], courser: [2, 55] }[t as 'ashpike' | 'bowman' | 'courser'];
        expect([i.units!.length, i.price]).toEqual(expected);
        for (const u of i.units!) expect(u.rank).toBe(1);
      }
      expect(stock.rerollCost).toBe(15);
    }
  });

  it('Guild Ties: −15% on every price and +1 Boon', () => {
    const { stock } = atPeddler(['guild_ties'], 0, 4);
    const boons = boonItems(stock);
    expect(boons).toHaveLength(4);
    expect(boons.slice(0, 3).map((b) => b.price)).toEqual([47, 85, 149]);
    expect(new Set(boons.map((b) => b.boon)).size).toBe(4);
    const priceOf = { C: 47, R: 85, M: 149 } as const;
    for (const b of boons) expect(b.price).toBe(priceOf[BOONS[b.boon!].rarity]);
    expect(stock.items.find((i) => i.kind === 'draft')?.price).toBe(77);
    expect(stock.items.find((i) => i.kind === 'resolve')?.price).toBe(77);
    for (const i of stock.items.filter((x) => x.kind === 'sellswords')) {
      expect([30, 38, 47]).toContain(i.price);
    }
    expect(stock.rerollCost).toBe(13);
  });

  it('buys items: Boon, Draft, Resolve (not above max), Sellswords; sold items cannot be rebought', () => {
    const { run, meta, stock } = atPeddler([], 600);
    const bi = stock.items.findIndex((i) => i.kind === 'boon');
    expect(buyPeddlerItem(run, meta, bi)).toEqual({ ok: true });
    expect(run.boons).toEqual([stock.items[bi].boon]);
    expect(run.crowns).toBe(600 - 55);
    expect(buyPeddlerItem(run, meta, bi)).toMatchObject({ ok: false });

    const di = stock.items.findIndex((i) => i.kind === 'draft');
    expect(buyPeddlerItem(run, meta, di).ok).toBe(true);
    expect(run.drafts).toEqual([stock.items[di].draft]);

    const ri = stock.items.findIndex((i) => i.kind === 'resolve');
    expect(buyPeddlerItem(run, meta, ri)).toMatchObject({ ok: false, reason: expect.stringMatching(/full/) });
    run.resolve = 2;
    expect(buyPeddlerItem(run, meta, ri).ok).toBe(true);
    expect(run.resolve).toBe(3);

    const si = stock.items.findIndex((i) => i.kind === 'sellswords');
    expect(buyPeddlerItem(run, meta, si).ok).toBe(true);
    expect(run.sellswords).toEqual(stock.items[si].units);

    run.crowns = 10;
    const mi = stock.items.findIndex((i) => i.kind === 'boon' && !i.sold);
    expect(buyPeddlerItem(run, meta, mi)).toMatchObject({ ok: false, reason: expect.stringMatching(/Crowns/) });
  });

  it('rerolls unsold Boons for 15, +10 per repeat', () => {
    const { run, meta, stock } = atPeddler([], 200);
    const before = boonItems(stock).map((b) => b.boon);
    expect(rerollPeddler(run, meta)).toEqual({ ok: true });
    expect(run.crowns).toBe(185);
    expect(run.peddler!.rerollCost).toBe(25);
    const after = boonItems(run.peddler!).map((b) => b.boon);
    expect(after.map((b) => BOONS[b!].rarity)).toEqual(['C', 'R', 'M']);
    expect(after.some((b, i) => b !== before[i])).toBe(true);
    expect(rerollPeddler(run, meta).ok).toBe(true);
    expect(run.crowns).toBe(160);
    expect(run.peddler!.rerollCost).toBe(35);
    run.crowns = 20;
    expect(rerollPeddler(run, meta)).toMatchObject({ ok: false });
  });

  it('Guild Ties discounts rerolls too', () => {
    const { run, meta } = atPeddler(['guild_ties'], 100);
    rerollPeddler(run, meta);
    expect(run.crowns).toBe(87);
    expect(run.peddler!.rerollCost).toBe(Math.round(25 * 0.85));
  });

  it('stock is stable across re-entry and leaving marks the node done', () => {
    const { run, meta, node, stock } = atPeddler();
    expect(reachableNodes(run).map((n) => n.id)).toEqual([node.id]);
    const again = enterNode(run, meta, node.id);
    expect(again).toEqual({ screen: 'peddler', stock });
    leaveNode(run);
    expect(run.nodesDone).toContain(node.id);
    expect(run.peddler).toBeNull();
    expect(reachableNodes(run).map((n) => n.id)).toEqual(node.next);
  });
});
