/**
 * Coach and counsel texts (GDD §O hints, §I doctrine counsel, §M Drafts).
 */
import { describe, expect, it } from 'vitest';
import { SPENT } from '../../src/data/balance';
import { DOCTRINES } from '../../src/data/doctrines';
import { DRAFTS } from '../../src/data/drafts';
import { HINTS, TEXT } from '../../src/data/text';

const hint = (id: string): string => HINTS.find((h) => h.id === id)!.text;

describe('coach texts', () => {
  it('the Spent hint says right-click, reads SPENT.afterBroken and names who burns Nests', () => {
    const t = hint('spent');
    expect(t).toContain(`at least ${SPENT.afterBroken} s`);
    expect(t).toContain('right-click the Nest');
    expect(t).toContain('Ashpikes and the Warden burn it');
    expect(t).not.toContain('press A and click');
  });

  it('no hint shows a bare backquote key; the scout hint points to the Warden button', () => {
    for (const h of HINTS) expect(h.text, h.id).not.toMatch(/`/);
    expect(hint('scout')).toContain('The Warden button beside the minimap selects your Warden.');
  });

  it('the first-gather hint warns the scout about Bramble Pickets', () => {
    expect(hint('train_tiller')).toMatch(/Scout with your Courser, but keep clear of the purple spires: Bramble Pickets guard the Seams\.$/);
  });

  it('wave-broken alert names the structure (Root Heart in the boss battle)', () => {
    expect(TEXT.waveBroken(2, 'NW', '0:45')).toBe('Wave 2 broken. NW Nest Spent 0:45');
    expect(TEXT.waveBroken(3, 'NE', '1:02', 'Root Heart')).toBe('Wave 3 broken. NE Root Heart Spent 1:02');
  });
});

describe('doctrine counsel', () => {
  it('Spines and Siegebreak name an answer for the Briarguards as well as the Spinecasters', () => {
    const core = DOCTRINES.spines.answerCore!;
    expect(core).toContain('Coursers run down the Spinecasters');
    expect(core).toContain('Ashpikes in front stop the Briarguards');
    expect(DOCTRINES.spines.answer).toContain('Briarguards');
    expect(DOCTRINES.siegebreak.answer).toBe('Siegebreak: Coursers for the Spinecasters, Ashpikes for the Briarguards, and melee on the Rootbreakers.');
  });

  it('every Draft whose building chain needs a Forgehall says so', () => {
    for (const id of ['draft_firecraft', 'draft_heavy_horse', 'draft_siegecraft'] as const) {
      expect(DRAFTS[id].desc, id).toMatch(/Needs a Forgehall\.$/);
    }
  });
});
