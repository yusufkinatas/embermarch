/**
 * Run map view: a procedural parchment-dark canvas backdrop (region washes, ink doodles) under an SVG
 * of ink-path edges and heraldic nodes. The newest traveled edge draws in as animated ink.
 */
import type { RunNode, RunState } from '../../run/types';
import type { BiomeId } from '../../sim/types';
import { OBJECTIVES } from '../../data/objectives';
import { BIOMES } from '../../data/biomes';
import { MODIFIERS } from '../../data/modifiers';
import { DOCTRINES } from '../../data/doctrines';
import { NODE_NAMES, REWARD_NAMES } from '../../data/text';
import { CAMP_TEXT } from '../../data/text';
import { h, s, roman, type Child } from '../dom';
import {
  MAP_VB,
  columnRegions,
  edgeKey,
  inkEdgePath,
  nodePos,
  nodeState,
  regionSpans,
  traveledEdges,
  type NodeState,
} from '../logic/runmap';
import { glyph, glyphMarkup, MODIFIER_GLYPH, MODIFIER_KIND_COLOR, NODE_GLYPH, OBJECTIVE_GLYPH, REWARD_GLYPH } from './glyphs';
import type { Tooltips } from './tooltip';
import { ttRow, ttRule, ttSub, ttTitle } from './tooltip';

export interface MapViewOptions {
  run: RunState;
  reachable: ReadonlySet<string>;
  /** Edge key to animate as fresh ink (null = none). */
  animateEdge: string | null;
  tooltips: Tooltips;
  onEnter(nodeId: string): void;
  /** What winning a battle node pays (the run API's nodeRewardText, shared with the briefing). */
  rewardText?(nodeId: string): string;
}

export interface MapView {
  el: HTMLElement;
  mounted(): void;
  destroy(): void;
}

const REGION_COLOR: Record<BiomeId | 'road', string> = {
  greenmarch: '#5E8C3A',
  fenreach: '#2A6A70',
  ashwood: '#7A6E55',
  heartwood: '#6B2E5A',
  road: '#8a6236',
};
const REGION_NAME: Record<BiomeId | 'road', string> = {
  greenmarch: 'Greenmarch',
  fenreach: 'Fenreach',
  ashwood: 'Ashwood',
  heartwood: 'Heartwood',
  road: 'The Last Road',
};

const TYPE_STYLE: Record<RunNode['type'], { ring: string; icon: string; r: number }> = {
  battle: { ring: '#a8783a', icon: '#f4e6c1', r: 33 },
  elite: { ring: '#b8442f', icon: '#ff9f80', r: 35 },
  event: { ring: '#8a7a5a', icon: '#e9d9b0', r: 29 },
  peddler: { ring: '#b8963a', icon: '#e8c547', r: 29 },
  camp: { ring: '#c06a2a', icon: '#ffb347', r: 29 },
  boss: { ring: '#8a3fa8', icon: '#e2b4f4', r: 46 },
};

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ------------------------------------------------------------------ tooltip

export function nodeTooltip(node: RunNode, rewardText?: string): Child {
  const b = node.battle;
  if (!b || node.type === 'event' || node.type === 'peddler' || node.type === 'camp') {
    const text =
      node.type === 'event'
        ? 'Something waits on the road. Choices carry costs and rewards.'
        : node.type === 'peddler'
          ? 'A travelling Peddler. Spend Crowns on Boons, Drafts, Resolve and Sellswords.'
          : node.type === 'camp'
            ? `${CAMP_TEXT.rest.label}, ${CAMP_TEXT.drill.label} or ${CAMP_TEXT.muster.label}: a night by the fire.`
            : '';
    return [ttTitle(NODE_NAMES[node.type]), ttSub(`Column ${roman(node.col)}`), h('div', null, text)];
  }
  const obj = OBJECTIVES[b.objective];
  const biome = BIOMES[b.biome];
  const doctrine = DOCTRINES[b.doctrine];
  const reward = REWARD_NAMES[b.reward];
  const skulls = h('span', { class: 'skulls' });
  for (let i = 0; i < 5; i++) skulls.appendChild(glyph('skull', i < b.threat ? '' : 'off'));
  const rows: Child[] = [
    ttTitle(node.type === 'boss' ? NODE_NAMES.boss : `${NODE_NAMES[node.type]}: ${obj.name}`),
    ttSub(`Column ${roman(node.col)} · Depth ${b.depth}`),
    h('div', null, obj.goal),
    ttRule(),
    ttRow('Biome', h('span', null, h('b', null, biome.name), ' · ', h('span', { class: 'muted' }, biome.twist))),
  ];
  if (b.modifiers.length === 0) rows.push(ttRow('Modifiers', h('span', { class: 'muted' }, 'None')));
  for (const m of b.modifiers) {
    const def = MODIFIERS[m];
    rows.push(
      ttRow(
        'Modifier',
        h(
          'span',
          null,
          h('b', { style: `color:${MODIFIER_KIND_COLOR[def.kind]}` }, def.name),
          ' · ',
          def.desc,
          def.payoffDesc && def.payoffDesc !== 'None.' ? h('span', { class: 'good' }, ` ${def.payoffDesc}`) : null,
        ),
      ),
    );
  }
  rows.push(ttRow('Doctrine', h('span', null, h('b', null, doctrine.name), ' · ', h('span', { class: 'muted' }, doctrine.hint))));
  // Elites pay a Rare+ Boon then a Draft, and the boss ends the march: say so, as the briefing does.
  const pays = rewardText ?? (node.type === 'battle' ? `${reward.name}: ${reward.desc}` : '');
  if (pays) rows.push(ttRow('Reward', h('span', null, pays)));
  rows.push(ttRow('Threat', skulls));
  return rows;
}

// ------------------------------------------------------------------ backdrop

function paintBackdrop(canvas: HTMLCanvasElement, run: RunState, positions: Map<string, { x: number; y: number }>): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const sc = canvas.width / MAP_VB.w;
  g.setTransform(sc, 0, 0, sc, 0, 0);
  const W = MAP_VB.w;
  const H = MAP_VB.h;
  const rnd = mulberry(run.seed ^ 0x5eed);
  const cols = run.map.columns.length;
  const regions = columnRegions(run.map);

  g.fillStyle = '#1b140e';
  g.fillRect(0, 0, W, H);

  // region washes
  const wash = g.createLinearGradient(0, 0, W, 0);
  regions.forEach((r, i) => {
    const x = (i + 0.5) / cols;
    wash.addColorStop(Math.min(1, Math.max(0, x)), rgba(REGION_COLOR[r], 0.2));
  });
  g.fillStyle = wash;
  g.fillRect(0, 0, W, H);

  // parchment light pool
  const pool = g.createRadialGradient(W * 0.45, H * 0.48, 40, W * 0.45, H * 0.5, W * 0.62);
  pool.addColorStop(0, 'rgba(120,92,58,0.22)');
  pool.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = pool;
  g.fillRect(0, 0, W, H);

  // grain
  for (let i = 0; i < 4200; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const light = rnd() < 0.4;
    g.fillStyle = light ? `rgba(233,217,176,${0.02 + rnd() * 0.04})` : `rgba(0,0,0,${0.06 + rnd() * 0.12})`;
    g.fillRect(x, y, 1 + rnd() * 1.6, 1 + rnd() * 1.6);
  }

  const nodePts = [...positions.values()];
  const clear = (x: number, y: number, r: number): boolean => nodePts.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 > r * r);
  const colX = (c: number): number => 110 + ((c - 1) * (W - 220)) / Math.max(1, cols - 1);
  const ink = 'rgba(12,8,5,0.42)';
  const hi = 'rgba(233,217,176,0.08)';

  const tree = (x: number, y: number, r: number): void => {
    g.fillStyle = ink;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = hi;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(x - r * 0.15, y - r * 0.15, r * 0.75, Math.PI * 1.05, Math.PI * 1.7);
    g.stroke();
    g.strokeStyle = ink;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x, y + r);
    g.lineTo(x, y + r + 4);
    g.stroke();
  };
  const deadTree = (x: number, y: number, s2: number): void => {
    g.strokeStyle = ink;
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, y + s2);
    g.lineTo(x, y - s2);
    g.moveTo(x, y - s2 * 0.2);
    g.lineTo(x - s2 * 0.6, y - s2 * 0.8);
    g.moveTo(x, y - s2 * 0.45);
    g.lineTo(x + s2 * 0.55, y - s2 * 0.95);
    g.stroke();
  };
  const marsh = (x: number, y: number): void => {
    g.strokeStyle = 'rgba(160,200,200,0.1)';
    g.lineWidth = 1.4;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      const yy = y + k * 6;
      g.moveTo(x - 16, yy);
      g.quadraticCurveTo(x - 8, yy - 4, x, yy);
      g.quadraticCurveTo(x + 8, yy + 4, x + 16, yy);
      g.stroke();
    }
    g.strokeStyle = ink;
    g.lineWidth = 1.4;
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.moveTo(x + 22 + k * 3, y + 10);
      g.lineTo(x + 22 + k * 5, y - 4 - Math.abs(k) * -3);
      g.stroke();
    }
  };
  const hill = (x: number, y: number, w: number): void => {
    g.strokeStyle = ink;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x - w, y);
    g.quadraticCurveTo(x, y - w * 0.8, x + w, y);
    g.stroke();
    g.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      const hx = x - w * 0.2 + k * w * 0.18;
      g.beginPath();
      g.moveTo(hx, y - w * 0.32 + k * 2);
      g.lineTo(hx + 4, y - 2);
      g.stroke();
    }
  };
  const thorns = (x: number, y: number, len: number): void => {
    g.strokeStyle = 'rgba(40,12,40,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    let px = x;
    let py = y;
    g.moveTo(px, py);
    let a = rnd() * Math.PI * 2;
    for (let k = 0; k < 8; k++) {
      a += (rnd() - 0.5) * 1.2;
      const nx = px + Math.cos(a) * len / 8;
      const ny = py + Math.sin(a) * len / 8;
      g.lineTo(nx, ny);
      px = nx;
      py = ny;
    }
    g.stroke();
    g.fillStyle = 'rgba(143,209,79,0.12)';
    g.fillRect(px - 1, py - 1, 2.4, 2.4);
  };

  regions.forEach((r, i) => {
    const cx = colX(i + 1);
    const tries = 26;
    for (let k = 0; k < tries; k++) {
      const x = cx + (rnd() - 0.5) * (W / cols) * 1.05;
      const y = 70 + rnd() * (H - 150);
      if (!clear(x, y, 74)) continue;
      const pick = rnd();
      if (r === 'greenmarch') {
        if (pick < 0.65) {
          const n = 2 + Math.floor(rnd() * 4);
          for (let t = 0; t < n; t++) tree(x + (rnd() - 0.5) * 34, y + (rnd() - 0.5) * 22, 5 + rnd() * 4);
        } else hill(x, y, 18 + rnd() * 16);
      } else if (r === 'fenreach') {
        if (pick < 0.55) marsh(x, y);
        else tree(x, y, 5 + rnd() * 3);
      } else if (r === 'ashwood') {
        if (pick < 0.6) deadTree(x, y, 8 + rnd() * 6);
        else {
          g.fillStyle = `rgba(255,106,43,${0.12 + rnd() * 0.18})`;
          g.beginPath();
          g.arc(x, y, 1.4 + rnd() * 1.4, 0, Math.PI * 2);
          g.fill();
        }
      } else if (r === 'heartwood') {
        thorns(x, y, 40 + rnd() * 40);
      } else if (pick < 0.5) hill(x, y, 14 + rnd() * 10);
    }
  });

  // vignette
  const vig = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);
}

// ------------------------------------------------------------------ SVG

function compass(x: number, y: number): SVGGElement {
  const g = s('g', { class: 'map-compass', transform: `translate(${x} ${y})` });
  g.innerHTML =
    '<circle r="30" fill="none" stroke="currentColor" stroke-width="1" stroke-opacity=".5"/>' +
    '<circle r="24" fill="none" stroke="currentColor" stroke-width=".6" stroke-opacity=".4" stroke-dasharray="2 4"/>' +
    '<path d="M0 -38 L6 0 L0 38 L-6 0 Z" fill="currentColor" fill-opacity=".45"/>' +
    '<path d="M-38 0 L0 -6 L38 0 L0 6 Z" fill="currentColor" fill-opacity=".3"/>' +
    '<path d="M0 -38 L6 0 L0 0 Z" fill="currentColor" fill-opacity=".8"/>' +
    '<text y="-44" text-anchor="middle" font-size="13">N</text><text x="48" y="5" text-anchor="middle" font-size="13">E</text>';
  return g;
}

function nodeGroup(
  node: RunNode,
  state: NodeState,
  clickable: boolean,
  pos: { x: number; y: number },
  ids: { fill: string; boss: string; core: string },
): SVGGElement {
  const st = TYPE_STYLE[node.type];
  const R = st.r;
  const g = s('g', {
    class: `rn rn-${node.type} st-${state} ${clickable ? 'clickable' : ''}`.trim(),
    transform: `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`,
    style: `--ring:${st.ring};--icon:${st.icon}`,
    'data-node': node.id,
  });

  if (state === 'current') {
    g.appendChild(s('circle', { class: 'rn-ember', r: R + 30, fill: `url(#${ids.core})` }));
  }
  if (clickable) {
    g.appendChild(s('circle', { class: 'rn-beckon', r: R + 10, fill: 'none' }));
  }
  g.appendChild(s('circle', { class: 'rn-shadow', r: R + 4, cy: 4 }));
  g.appendChild(s('circle', { class: 'rn-disc', r: R, fill: `url(#${node.type === 'boss' ? ids.boss : ids.fill})` }));
  g.appendChild(s('circle', { class: 'rn-inner', r: R - 6 }));
  const iconSize = node.type === 'boss' ? 50 : R * 1.1;
  const icon = s('svg', { class: 'rn-icon', x: -iconSize / 2, y: -iconSize / 2, width: iconSize, height: iconSize, viewBox: '0 0 24 24' });
  icon.innerHTML = glyphMarkup(NODE_GLYPH[node.type]);
  g.appendChild(icon);

  const b = node.battle;
  if (b && (node.type === 'battle' || node.type === 'elite' || node.type === 'boss')) {
    // objective sigil (small, top-left) for non-boss battles
    if (node.type !== 'boss') {
      const og = s('g', { class: 'rn-obj', transform: `translate(${-R * 0.78} ${-R * 0.72})` });
      og.appendChild(s('circle', { r: 11 }));
      const oi = s('svg', { x: -8, y: -8, width: 16, height: 16, viewBox: '0 0 24 24' });
      oi.innerHTML = glyphMarkup(OBJECTIVE_GLYPH[b.objective]);
      og.appendChild(oi);
      g.appendChild(og);
    }
    // threat skulls
    const n = Math.max(0, Math.min(5, b.threat));
    const sk = s('g', { class: 'rn-skulls', transform: `translate(0 ${R + 15})` });
    const w = 15;
    for (let i = 0; i < n; i++) {
      const si = s('svg', { x: -((n * w) / 2) + i * w, y: -7.5, width: 15, height: 15, viewBox: '0 0 24 24' });
      si.innerHTML = glyphMarkup('skull');
      sk.appendChild(si);
    }
    g.appendChild(sk);
    // modifier pips
    if (b.modifiers.length) {
      const pg = s('g', { class: 'rn-mods', transform: `translate(0 ${-R - 13})` });
      b.modifiers.forEach((m, i) => {
        const def = MODIFIERS[m];
        const cx = (i - (b.modifiers.length - 1) / 2) * 22;
        pg.appendChild(s('circle', { cx, r: 9.5, fill: '#120d09', stroke: MODIFIER_KIND_COLOR[def.kind], 'stroke-width': 2 }));
        const mi = s('svg', { x: cx - 6.5, y: -6.5, width: 13, height: 13, viewBox: '0 0 24 24', style: `color:${MODIFIER_KIND_COLOR[def.kind]}` });
        mi.innerHTML = glyphMarkup(MODIFIER_GLYPH[m]);
        pg.appendChild(mi);
      });
      g.appendChild(pg);
    }
    // reward badge
    if (node.type !== 'boss') {
      const rg = s('g', { class: `rn-reward rw-${b.reward}`, transform: `translate(${R * 0.76} ${R * 0.7})` });
      rg.appendChild(s('circle', { r: 12 }));
      const ri = s('svg', { x: -8.5, y: -8.5, width: 17, height: 17, viewBox: '0 0 24 24' });
      ri.innerHTML = glyphMarkup(REWARD_GLYPH[b.reward]);
      rg.appendChild(ri);
      g.appendChild(rg);
    }
  }

  if (state === 'done') {
    const seal = s('g', { class: 'rn-seal', transform: `translate(${R * 0.7} ${-R * 0.7})` });
    seal.appendChild(s('circle', { r: 10 }));
    const ci = s('svg', { x: -7, y: -7, width: 14, height: 14, viewBox: '0 0 24 24' });
    ci.innerHTML = glyphMarkup('check');
    seal.appendChild(ci);
    g.appendChild(seal);
  }
  g.appendChild(s('circle', { class: 'rn-hit', r: R + 14 }));
  return g;
}

export function buildMapView(opts: MapViewOptions): MapView {
  const { run, reachable } = opts;
  const cols = run.map.columns.length;
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of Object.values(run.map.nodes)) positions.set(node.id, nodePos(node, cols));

  const uid = Math.floor(Math.random() * 1e9).toString(36);
  const ids = { fill: `nf-${uid}`, boss: `bf-${uid}`, core: `ec-${uid}` };

  const svg = s('svg', { class: 'map-svg', viewBox: `0 0 ${MAP_VB.w} ${MAP_VB.h}`, preserveAspectRatio: 'xMidYMid meet' });
  svg.innerHTML =
    `<defs>` +
    `<radialGradient id="${ids.fill}" cx="50%" cy="36%" r="70%"><stop offset="0" stop-color="#3d3024"/><stop offset=".7" stop-color="#1d1610"/><stop offset="1" stop-color="#120d09"/></radialGradient>` +
    `<radialGradient id="${ids.boss}" cx="50%" cy="36%" r="70%"><stop offset="0" stop-color="#4a2a52"/><stop offset=".7" stop-color="#221326"/><stop offset="1" stop-color="#140a16"/></radialGradient>` +
    `<radialGradient id="${ids.core}"><stop offset="0" stop-color="#ffd27a" stop-opacity=".95"/><stop offset=".3" stop-color="#ff6a2b" stop-opacity=".55"/><stop offset=".65" stop-color="#ff6a2b" stop-opacity=".16"/><stop offset="1" stop-color="#ff6a2b" stop-opacity="0"/></radialGradient>` +
    `</defs>`;

  // column numerals + region names
  const labels = s('g', { class: 'map-labels' });
  for (let c = 1; c <= cols; c++) {
    const x = 110 + ((c - 1) * (MAP_VB.w - 220)) / Math.max(1, cols - 1);
    labels.appendChild(s('text', { class: 'map-colnum', x, y: 46, 'text-anchor': 'middle' }, roman(c)));
  }
  const colW = (MAP_VB.w - 220) / Math.max(1, cols - 1);
  for (const span of regionSpans(columnRegions(run.map))) {
    const x0 = 110 + (span.from - 1) * colW;
    const x1 = 110 + (span.to - 1) * colW;
    const name = REGION_NAME[span.region].toUpperCase();
    // Fit the label inside its columns: shrink the tracking first, then the size.
    const avail = (span.to - span.from + 1) * colW - 28;
    let fs = 21;
    let ls = Math.min(0.5, avail / (name.length * fs) - 0.74);
    if (ls < 0.12) {
      ls = 0.12;
      fs = Math.min(21, avail / (name.length * (0.74 + ls)));
    }
    labels.appendChild(
      s('text', { class: 'map-region', x: (x0 + x1) / 2, y: MAP_VB.h - 26, 'text-anchor': 'middle', style: `font-size:${fs.toFixed(1)}px;letter-spacing:${ls.toFixed(2)}em` }, name),
    );
  }
  svg.appendChild(labels);
  svg.appendChild(compass(64, MAP_VB.h - 92));

  // edges
  const traveled = new Set(traveledEdges(run));
  const animate = opts.animateEdge && traveled.has(opts.animateEdge) ? opts.animateEdge : null;
  const edgesUnder = s('g', { class: 'map-edges' });
  const edgesTop = s('g', { class: 'map-edges-top' });
  const edgesLive = s('g', { class: 'map-edges-live' });
  const edgeEls = new Map<string, SVGPathElement>();
  let animPath: SVGPathElement | null = null;
  const cur = run.currentNode;
  for (const node of Object.values(run.map.nodes)) {
    const a = positions.get(node.id)!;
    for (const nextId of node.next) {
      const b = positions.get(nextId);
      if (!b) continue;
      const key = edgeKey(node.id, nextId);
      const d = inkEdgePath(a, b, key);
      const isTraveled = traveled.has(key);
      const isChoice = cur === node.id && reachable.has(nextId);
      if (isTraveled) {
        edgesTop.appendChild(s('path', { class: 'edge-under', d }));
        const p = s('path', { class: `edge traveled ${key === animate ? 'ink-draw' : ''}`.trim(), d });
        if (key === animate) animPath = p;
        edgesTop.appendChild(p);
        edgeEls.set(key, p);
      } else {
        const p = s('path', { class: `edge ${isChoice ? 'choice' : ''}`.trim(), d });
        (isChoice ? edgesLive : edgesUnder).appendChild(p);
        edgeEls.set(key, p);
      }
    }
  }
  svg.appendChild(edgesUnder);
  svg.appendChild(edgesTop);
  svg.appendChild(edgesLive);

  // nodes
  const nodesG = s('g', { class: 'map-nodes' });
  const nodeEls = new Map<string, SVGGElement>();
  const ordered = Object.values(run.map.nodes).sort((p, q) => p.col - q.col);
  for (const node of ordered) {
    const state = nodeState(run, node, reachable);
    const clickable = reachable.has(node.id);
    const g = nodeGroup(node, state, clickable, positions.get(node.id)!, ids);
    if (clickable) {
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', `Enter ${NODE_NAMES[node.type]}`);
      g.addEventListener('click', () => opts.onEnter(node.id));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          opts.onEnter(node.id);
        }
      });
    }
    g.addEventListener('pointerenter', () => {
      if (cur) edgeEls.get(edgeKey(cur, node.id))?.classList.add('hl');
    });
    g.addEventListener('pointerleave', () => {
      if (cur) edgeEls.get(edgeKey(cur, node.id))?.classList.remove('hl');
    });
    opts.tooltips.attach(g, () => {
      const body = nodeTooltip(node, node.battle ? opts.rewardText?.(node.id) : undefined);
      const hint =
        clickable
          ? h('div', { class: 'tt-hint accent' }, state === 'current' ? 'The Hearthband is here. Click to continue.' : 'Click to march here.')
          : state === 'current'
            ? h('div', { class: 'tt-hint accent' }, 'The Hearthband is here.')
            : state === 'done'
              ? h('div', { class: 'tt-hint muted' }, 'Already walked.')
              : null;
      return [body, hint];
    });
    nodeEls.set(node.id, g);
    nodesG.appendChild(g);
  }
  svg.appendChild(nodesG);

  // backdrop canvas + stage sizing
  const canvas = h('canvas', { class: 'map-backdrop' });
  const stage = h('div', { class: 'map-stage' }, canvas, svg);
  const frame = h('div', { class: 'map-frame' }, stage);

  let lastW = 0;
  const layout = (): void => {
    const r = frame.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const aspect = MAP_VB.w / MAP_VB.h;
    let w = r.width;
    let hgt = w / aspect;
    if (hgt > r.height) {
      hgt = r.height;
      w = hgt * aspect;
    }
    stage.style.width = `${Math.floor(w)}px`;
    stage.style.height = `${Math.floor(hgt)}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.floor(w * dpr);
    if (Math.abs(cw - lastW) > 2) {
      lastW = cw;
      canvas.width = cw;
      canvas.height = Math.floor(hgt * dpr);
      paintBackdrop(canvas, run, positions);
    }
  };
  const ro = new ResizeObserver(() => layout());

  return {
    el: frame,
    mounted: () => {
      ro.observe(frame);
      layout();
      if (animPath) {
        const len = animPath.getTotalLength();
        animPath.style.setProperty('--len', `${len.toFixed(1)}`);
        animPath.classList.add('go');
        const target = cur ? nodeEls.get(cur) : null;
        target?.classList.add('arrive');
      }
    },
    destroy: () => ro.disconnect(),
  };
}
