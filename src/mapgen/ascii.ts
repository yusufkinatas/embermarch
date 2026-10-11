/** Debug helper: render a generated map as ASCII (one char per tile). */
import { Terrain } from '../sim/types';
import type { GeneratedMap } from '../sim/types';
import { anchorFootprints } from './validate';

const TERRAIN_CHAR: Record<number, string> = {
  [Terrain.Grass]: '.',
  [Terrain.Shallows]: ',',
  [Terrain.Water]: '~',
  [Terrain.Rock]: '^',
  [Terrain.Forest]: 'T',
  [Terrain.Stump]: '_',
  [Terrain.BriarWall]: '#',
};

/** Legend for `mapToAscii`. */
export const ASCII_LEGEND: Readonly<Record<string, string>> = {
  '.': 'grass',
  ',': 'shallows',
  '~': 'water',
  '^': 'rock',
  T: 'forest',
  _: 'stump',
  '#': 'briar wall',
  H: 'Hearth',
  N: 'Thorn Nest / Root Heart',
  s: 'Nest Thornspire',
  ':': 'spare spire site',
  p: 'Picket Thornspire',
  E: 'home Ember Seam',
  X: 'contested Ember Seam',
  t: 'Thicket',
  c: 'Ruined Cache',
  A: 'Ancient Cache',
  B: 'Beacon Stone',
  M: 'Muster Hall / Bowyard site',
  S: 'Storehouse site',
  G: 'Grainplot site',
  W: 'Old Watchtower',
  R: 'Briar Throne',
  '*': 'muster point',
};

function footChar(label: string, gen: GeneratedMap): string {
  if (label === 'hearth') return 'H';
  if (label === 'throne') return 'R';
  if (label.startsWith('nest')) return 'N';
  if (label.startsWith('spareSpire')) return ':';
  if (label.startsWith('spire')) return 's';
  if (label.startsWith('picket')) return 'p';
  if (label.startsWith('thicket')) return 't';
  if (label.startsWith('ember_seam')) {
    const r = gen.anchors.resources[Number(label.slice('ember_seam'.length))];
    return r && r.contested ? 'X' : 'E';
  }
  if (label.startsWith('ruined_cache')) return 'c';
  if (label.startsWith('ancient_cache')) return 'A';
  if (label.startsWith('beacon')) return 'B';
  if (label === 'vanguard_military') return 'M';
  if (label === 'vanguard_storehouse') return 'S';
  if (label === 'vanguard_grainplot') return 'G';
  if (label.startsWith('watchtower')) return 'W';
  return '?';
}

export function mapToAscii(gen: GeneratedMap, opts: { legend?: boolean } = {}): string {
  const { w, h, terrain } = gen.map;
  const grid: string[][] = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) row.push(TERRAIN_CHAR[terrain[y * w + x]] ?? '?');
    grid.push(row);
  }
  for (const f of anchorFootprints(gen)) {
    const ch = footChar(f.label, gen);
    for (let y = f.ty; y < f.ty + f.h; y++) {
      for (let x = f.tx; x < f.tx + f.w; x++) if (grid[y] && x >= 0 && x < w) grid[y][x] = ch;
    }
  }
  for (const m of gen.anchors.musterPoints) {
    const y = Math.floor(m.y);
    const x = Math.floor(m.x);
    if (grid[y] && x >= 0 && x < w) grid[y][x] = '*';
  }
  const body = grid.map((r) => r.join('')).join('\n');
  if (!opts.legend) return body;
  const legend = Object.entries(ASCII_LEGEND)
    .map(([k, v]) => `${k} ${v}`)
    .join(' | ');
  return `${body}\n${legend}`;
}
