/**
 * Color palette (GDD §A "Palette"). Biome terrain colors live in biomes.ts.
 */
export const PALETTE = {
  player: {
    body: '#E8A33D',
    trim: '#F4E6C1',
    outline: '#2B1D0E',
    wardenFlame: '#FFD27A',
    selection: '#7BE07F',
    hpBar: '#6FD06F',
  },
  enemy: {
    body: '#7B3FA0',
    thorn: '#8FD14F',
    outline: '#1E0F24',
    hpBar: '#D9443B',
    /** Drawn at 60% over the body while Spent. */
    spentTint: '#A8987A',
    spentTintAlpha: 0.6,
  },
  neutral: { body: '#8FA3AD', accent: '#D8E2E6', outline: '#24313A' },
  shadow: 'rgba(0,0,0,0.30)',
  resource: {
    grain: '#E8C547',
    timber: '#8B5A2B',
    ember: '#FF6A2B',
    emberGlow: '#FFB347',
    thicketBush: '#3E6B2E',
    thicketDots: '#E8C547',
    grainplotUnripe: '#B8963A',
    grainplotRipe: '#E8C547',
    seamRock: '#3A302C',
    seamCracks: '#FF6A2B',
  },
  blight: { fill: '#5A1F5E', fillAlpha: 0.45, tendril: '#A04FB8', wardEdge: '#FFB347', wardAlpha: 0.2 },
  projectile: {
    arrow: '#F4E6C1',
    fire_arrow: '#FF6A2B',
    bolt: '#FFB347',
    spine: '#8FD14F',
    firepot: '#3A2A1A',
    fire: '#FF6A2B',
  },
  ui: {
    panel: '#1A1612',
    panelLight: '#2A231C',
    border: '#6B4F2A',
    text: '#F4E6C1',
    muted: '#A8987A',
    accent: '#E8A33D',
    danger: '#D9443B',
    good: '#6FD06F',
    counter: '#FF8C1A',
    resisted: '#A8987A',
  },
  rarity: { C: '#B9A58A', R: '#5FA8E8', M: '#E8A33D' },
  fog: { color: '#0B0A0F', unexploredAlpha: 1, exploredAlpha: 0.55 },
  /** Multiply overlay, 0% rising to 25% alpha as waves escalate. */
  dusk: { color: '#2A3A6A', maxAlpha: 0.25 },
};
