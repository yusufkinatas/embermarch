/**
 * Counter Wheel overlay (hold Tab, GDD §G / §O): the primary triangle
 * Spears > Cavalry > Ranged > Infantry, the Ember loop and the resist notes.
 */
import { PLAYER, ENEMY } from '../../sim/types';
import { h, setHidden } from '../dom';
import { GLYPHS, iconSrc } from '../glyphs';

interface NodeDef {
  x: number;
  y: number;
  label: string;
  sub: string;
  unit: string;
  foe: string;
  glyph: keyof typeof GLYPHS;
}

function node(n: NodeDef): string {
  const src = iconSrc(n.unit, PLAYER, 64);
  const foe = iconSrc(n.foe, ENEMY, 40);
  const pic = src
    ? `<image href="${src}" x="${n.x - 26}" y="${n.y - 26}" width="52" height="52"/>`
    : `<g transform="translate(${n.x - 15} ${n.y - 15}) scale(1.25)" class="cw-glyph">${GLYPHS[n.glyph].replace(/<\/?svg[^>]*>/g, '')}</g>`;
  const foePic = foe ? `<image href="${foe}" x="${n.x + 18}" y="${n.y + 12}" width="24" height="24" class="cw-foe"/>` : '';
  return `<g class="cw-node">
    <circle cx="${n.x}" cy="${n.y}" r="36" class="cw-ring"/>
    <circle cx="${n.x}" cy="${n.y}" r="31" class="cw-disc"/>
    ${pic}${foePic}
    <text x="${n.x}" y="${n.y + 54}" class="cw-label">${n.label}</text>
    <text x="${n.x}" y="${n.y + 70}" class="cw-sub">${n.sub}</text>
  </g>`;
}

function arc(x1: number, y1: number, x2: number, y2: number, bend: number, label: string): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const cx = mx + nx * bend;
  const cy = my + ny * bend;
  // Trim the ends so arrows stop at the node rings.
  const trim = 46 / len;
  const sx = x1 + dx * trim + nx * bend * 0.35;
  const sy = y1 + dy * trim + ny * bend * 0.35;
  const ex = x2 - dx * trim + nx * bend * 0.35;
  const ey = y2 - dy * trim + ny * bend * 0.35;
  const lx = mx + nx * (bend * 0.55);
  const ly = my + ny * (bend * 0.55);
  return `<path d="M${sx.toFixed(1)} ${sy.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}" class="cw-arrow" marker-end="url(#cw-head)"/>
    <g class="cw-mult"><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="17"/><text x="${lx.toFixed(1)}" y="${(ly + 5).toFixed(1)}">${label}</text></g>`;
}

export class CounterWheel {
  readonly el: HTMLDivElement;
  private built = false;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.el = h('div', 'bt-wheel bt-hidden', parent);
  }

  private build(): void {
    this.built = true;
    const spear: NodeDef = { x: 190, y: 70, label: 'Spears', sub: 'Ashpike · Briarguard', unit: 'ashpike', foe: 'briarguard', glyph: 'infantry' };
    const cav: NodeDef = { x: 320, y: 290, label: 'Cavalry', sub: 'Courser · Stagrider', unit: 'courser', foe: 'stagrider', glyph: 'cavalry' };
    const rng: NodeDef = { x: 60, y: 290, label: 'Ranged', sub: 'Bowman · Spinecaster', unit: 'bowman', foe: 'spinecaster', glyph: 'ranged' };
    const tri = `<svg class="cw-svg" viewBox="0 0 380 380" aria-label="Counter triangle">
      <defs><marker id="cw-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="cw-head"/></marker></defs>
      ${arc(spear.x, spear.y, cav.x, cav.y, -22, '×3')}
      ${arc(cav.x, cav.y, rng.x, rng.y, -22, '×2')}
      ${arc(rng.x, rng.y, spear.x, spear.y, -22, '×2')}
      ${node(spear)}${node(cav)}${node(rng)}
      <text x="190" y="222" class="cw-center">beats</text>
    </svg>`;
    const loopNode = (unit: string, name: string): string => {
      const src = iconSrc(unit, PLAYER, 40);
      return `<span class="cw-loop-unit">${src ? `<img src="${src}" alt=""/>` : ''}<b>${name}</b></span>`;
    };
    const arrow = `<span class="cw-loop-arrow">${GLYPHS.arrowRight}</span>`;
    this.el.innerHTML = `
      <div class="bt-wheel-card bt-panel">
        <div class="bt-wheel-title">Counter Wheel</div>
        <div class="bt-wheel-sub">Arrows point at what each class beats. Counters multiply damage before armor.</div>
        <div class="bt-wheel-body">
          ${tri}
          <div class="bt-wheel-side">
            <div class="cw-h">Ember loop</div>
            <div class="cw-loop">${loopNode('oathshield', 'Oathshield')}${arrow}${loopNode('bowman', 'Archers')}</div>
            <div class="cw-loop">${loopNode('destrier', 'Destrier')}${arrow}${loopNode('oathshield', 'Oathshield')}</div>
            <div class="cw-loop">${loopNode('ashpike', 'Ashpike')}${arrow}${loopNode('destrier', 'Destrier')}</div>
            <div class="cw-h">Resists</div>
            <ul class="cw-notes">
              <li>Oathshield and Thornhusk take <b>×0.5</b> from ranged.</li>
              <li>Gatebreaker and Rootbreaker take <b>×0.25</b> from ranged.</li>
              <li>Spears negate Charge.</li>
              <li>The Warden and the Regent ignore counters.</li>
              <li>Siege deals <b>×4</b> to structures. Archers barely scratch them.</li>
            </ul>
            <div class="cw-legend"><span class="pop counter">×3</span> counter hit <span class="pop resisted">×0.5</span> resisted</div>
          </div>
        </div>
      </div>`;
  }

  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    if (on && !this.built) this.build();
    setHidden(this.el, !on);
  }
}
