import { describe, expect, it } from 'vitest';
import { darken, hpBarColor, lighten, luminance, mix, parseHex, rgba, selectionColor, teamColors, toHex } from '../../src/render/colors';
import { PALETTE } from '../../src/data/palette';

describe('color helpers', () => {
  it('parses #RGB and #RRGGBB', () => {
    expect(parseHex('#E8A33D')).toEqual([0xe8, 0xa3, 0x3d]);
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('000000')).toEqual([0, 0, 0]);
  });

  it('round-trips through toHex and clamps', () => {
    expect(toHex(...parseHex('#7B3FA0'))).toBe('#7B3FA0');
    expect(toHex(300, -5, 127.6)).toBe('#FF0080');
  });

  it('mixes, darkens and lightens', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#102030', '#102030', 0.7)).toBe('#102030');
    // GDD §A: building front face = body darkened 30%.
    expect(darken('#E8A33D', 0.3)).toBe(toHex(0xe8 * 0.7, 0xa3 * 0.7, 0x3d * 0.7));
    expect(lighten('#000000', 1)).toBe('#FFFFFF');
    expect(luminance(lighten('#7B3FA0', 0.3))).toBeGreaterThan(luminance('#7B3FA0'));
  });

  it('formats rgba with clamped alpha', () => {
    expect(rgba('#5A1F5E', 0.45)).toBe('rgba(90,31,94,0.45)');
    expect(rgba('#000000', 2)).toBe('rgba(0,0,0,1)');
  });
});

describe('team palettes (§A)', () => {
  it('uses the GDD hexes for body / trim / outline', () => {
    expect(teamColors(0).body).toBe(PALETTE.player.body);
    expect(teamColors(0).trim).toBe(PALETTE.player.trim);
    expect(teamColors(0).outline).toBe(PALETTE.player.outline);
    expect(teamColors(1).body).toBe(PALETTE.enemy.body);
    expect(teamColors(1).trim).toBe(PALETTE.enemy.thorn);
    expect(teamColors(2).body).toBe(PALETTE.neutral.body);
  });

  it('keeps player amber clearly brighter than enemy violet (readability)', () => {
    expect(luminance(teamColors(0).body) - luminance(teamColors(1).body)).toBeGreaterThan(0.25);
  });

  it('selection rings: green own, red enemy, yellow neutral; HP bars green / red', () => {
    expect(selectionColor(0)).toBe(PALETTE.player.selection);
    const [r1, g1] = parseHex(selectionColor(1));
    expect(r1).toBeGreaterThan(g1 * 2);
    const [r2, g2, b2] = parseHex(selectionColor(2));
    expect(r2).toBeGreaterThan(b2 * 2);
    expect(g2).toBeGreaterThan(b2 * 2);
    expect(hpBarColor(0)).toBe(PALETTE.player.hpBar);
    expect(hpBarColor(1)).toBe(PALETTE.enemy.hpBar);
  });
});
