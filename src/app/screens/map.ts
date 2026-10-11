/**
 * Run Map: header (Crowns, Resolve, Boons, Drafts, Retinue), the 8-column ink map with reachable
 * nodes clickable, hover previews, and a legend.
 */
import type { AppCtx, ScreenHandle } from '../types';
import { NODE_NAMES, REWARD_NAMES } from '../../data/text';
import { h, roman } from '../dom';
import { glyph, MODIFIER_KIND_COLOR, NODE_GLYPH, REWARD_GLYPH } from '../ui/glyphs';
import { runHeader } from '../ui/header';
import { buildMapView } from '../ui/mapView';
import { currentColumn, traveledEdges } from '../logic/runmap';

/** Last traveled edge already drawn in, per run seed (so the ink animates once per step). */
let lastInked = '';

function legend(): HTMLElement {
  const types = (['battle', 'elite', 'event', 'peddler', 'camp', 'boss'] as const).map((t) =>
    h('span', { class: `lg-item lg-${t}` }, glyph(NODE_GLYPH[t]), t === 'boss' ? 'Boss' : NODE_NAMES[t]),
  );
  const rewards = (['boon', 'draft', 'spoils'] as const).map((r) => h('span', { class: 'lg-item lg-reward' }, glyph(REWARD_GLYPH[r]), REWARD_NAMES[r].name));
  const mods = (['negative', 'positive', 'mixed'] as const).map((k) =>
    h('span', { class: 'lg-item' }, h('i', { class: 'lg-dot', style: `border-color:${MODIFIER_KIND_COLOR[k]}` }), k === 'negative' ? 'Hardship' : k === 'positive' ? 'Boon of the land' : 'Mixed'),
  );
  return h(
    'div',
    { class: 'map-legend' },
    h('div', { class: 'lg-group' }, types),
    h('span', { class: 'lg-sep' }),
    h('div', { class: 'lg-group' }, h('span', { class: 'lg-item lg-threat' }, glyph('skull'), 'Threat'), rewards),
    h('span', { class: 'lg-sep' }),
    h('div', { class: 'lg-group' }, mods),
  );
}

export function mountMap(app: AppCtx): ScreenHandle {
  const run = app.run;
  if (!run) {
    queueMicrotask(() => app.go({ screen: 'title' }));
    return { el: h('div', { class: 'scr' }) };
  }
  const header = runHeader(app);
  const reachableNodes = app.guard('reachableNodes', () => app.api.reachableNodes(run)) ?? [];
  const reachable = new Set(reachableNodes.map((n) => n.id));

  const edges = traveledEdges(run);
  const last = edges.length ? `${run.seed}:${edges[edges.length - 1]}` : '';
  const animateEdge = last && last !== lastInked ? edges[edges.length - 1] : null;
  lastInked = last;

  let entering = false;
  const onEnter = (nodeId: string): void => {
    if (entering) return;
    entering = true;
    app.click();
    const entry = app.guard('enterNode', () => app.api.enterNode(run, app.meta, nodeId));
    if (!entry) {
      entering = false;
      return;
    }
    switch (entry.screen) {
      case 'briefing':
        app.go({ screen: 'briefing', briefing: entry.briefing });
        break;
      case 'event':
        app.go({ screen: 'event', event: entry.event });
        break;
      case 'camp':
        app.go({ screen: 'camp' });
        break;
      case 'peddler':
        app.go({ screen: 'peddler' });
        break;
    }
  };

  const view = buildMapView({ run, reachable, animateEdge, tooltips: app.tooltips, onEnter });
  const col = currentColumn(run);
  const total = run.map.columns.length;
  const status =
    reachable.size === 0
      ? 'The road ahead is dark.'
      : run.currentNode && reachable.has(run.currentNode)
        ? 'The Hearthband waits where it stands. Click the glowing stop to continue.'
        : col === 0
        ? 'The Hearthband gathers. March to the first battle.'
        : `Choose where the Hearthband marches next (${reachable.size === 1 ? 'one road' : `${reachable.size} roads`}).`;

  const el = h(
    'div',
    { class: 'scr map-scr' },
    header.el,
    h(
      'div',
      { class: 'map-sub' },
      h('div', { class: 'col', style: 'gap:0' }, h('div', { class: 'eyebrow' }, col === 0 ? 'Setting out' : `Column ${roman(col)} of ${roman(total)}`), h('h1', { class: 'display h2' }, 'The Ember Road')),
      h('div', { class: 'map-status' }, glyph('flame', 'inline-glyph'), status),
    ),
    h('div', { class: 'map-body' }, view.el),
    legend(),
  );

  return {
    el,
    mounted: () => view.mounted(),
    destroy: () => view.destroy(),
    onKey: (e) => {
      if (e.key === 'Escape') {
        app.openSettings();
        return true;
      }
      return false;
    },
  };
}
