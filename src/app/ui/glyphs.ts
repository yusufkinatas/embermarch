/**
 * Original heraldic SVG glyphs for the screens (24x24 viewBox, colored by currentColor).
 * Inner details use translucent black so a glyph reads on any tint.
 */
import type { BoonTag } from '../../data/types';
import type { DoctrineId, ModifierId, ObjectiveId, ResourceType } from '../../sim/types';
import type { NodeType, RewardType } from '../../run/types';

const DARK = 'fill="#000" fill-opacity=".42"';

function starPath(cx: number, cy: number, n: number, r1: number, r2: number, rotDeg = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = ((rotDeg + (i * 180) / n) * Math.PI) / 180;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

function gearPath(): string {
  const teeth = 8;
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const w = (Math.PI * 2) / teeth;
    const seq: [number, number][] = [
      [a0 - w * 0.5, 7.2],
      [a0 - w * 0.22, 7.6],
      [a0 - w * 0.16, 10],
      [a0 + w * 0.16, 10],
      [a0 + w * 0.22, 7.6],
    ];
    for (const [a, r] of seq) pts.push(`${(12 + Math.cos(a) * r).toFixed(2)} ${(12 + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

function laurel(): string {
  let out = '';
  for (const side of [-1, 1]) {
    out += `<path d="M12 20.5 C${12 + side * 7} 18 ${12 + side * 8.5} 11 ${12 + side * 6} 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`;
    for (let i = 0; i < 5; i++) {
      const t = i / 4.6;
      const y = 19 - t * 14;
      const x = 12 + side * (5.2 + Math.sin(t * Math.PI) * 2.6 - t * 1.2);
      const rot = side * (40 - t * 30);
      out += `<ellipse cx="${(x + side * 1.4).toFixed(2)}" cy="${y.toFixed(2)}" rx="1.1" ry="2.3" transform="rotate(${rot.toFixed(1)} ${(x + side * 1.4).toFixed(2)} ${y.toFixed(2)})"/>`;
    }
  }
  return `<g fill="currentColor">${out}</g>`;
}

function wheat(): string {
  let g = '<path d="M12 22 V6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>';
  for (let i = 0; i < 4; i++) {
    const y = 17 - i * 3.4;
    g += `<ellipse cx="9.5" cy="${y}" rx="1.5" ry="2.7" transform="rotate(-38 9.5 ${y})"/>`;
    g += `<ellipse cx="14.5" cy="${y}" rx="1.5" ry="2.7" transform="rotate(38 14.5 ${y})"/>`;
  }
  g += '<ellipse cx="12" cy="4.2" rx="1.4" ry="2.5"/>';
  return `<g fill="currentColor">${g}</g>`;
}

const FLAME_D =
  'M12 2.5 C13 6 17.5 8 17.5 13.5 C17.5 17.6 15 21 12 21 C9 21 6.5 17.6 6.5 13.8 C6.5 10.6 8.4 9.2 9.4 7.6 C9.6 9.6 10.4 10.8 11.4 11.2 C11 8.2 11 5.2 12 2.5 Z';
const FLAME_CORE = 'M12 12 C13 14 14.5 14.8 14.5 17 C14.5 18.6 13.4 19.6 12 19.6 C10.6 19.6 9.5 18.6 9.5 17.2 C9.5 15.6 11 14.6 12 12 Z';

const TOWER =
  '<path d="M6.5 21 L7.5 10 L16.5 10 L17.5 21 Z" fill="currentColor"/><path d="M5.5 10 V4.5 H8.2 V6.6 H10.6 V4.5 H13.4 V6.6 H15.8 V4.5 H18.5 V10 Z" fill="currentColor"/>' +
  `<path d="M10.4 21 V16.8 a1.6 1.6 0 0 1 3.2 0 V21 Z" ${DARK}/><rect x="11.2" y="11.6" width="1.6" height="2.6" ${DARK}/>`;

const CHEST =
  '<path d="M3.5 10.5 H20.5 V19.6 C20.5 20.1 20.1 20.5 19.6 20.5 H4.4 C3.9 20.5 3.5 20.1 3.5 19.6 Z" fill="currentColor"/>' +
  '<path d="M3.5 9.5 C3.5 6 6 4.2 12 4.2 C18 4.2 20.5 6 20.5 9.5 Z" fill="currentColor"/>' +
  `<rect x="10.5" y="8.6" width="3" height="4.2" rx=".6" ${DARK}/><path d="M3.5 13.6 H20.5" stroke="#000" stroke-opacity=".35" stroke-width="1"/>`;

const ANTLERS =
  '<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M10 14 C8 11 6.2 8.6 5.2 3.6"/><path d="M7.2 9.6 L3.2 8.2"/><path d="M6 6.2 L8.2 2.8"/>' +
  '<path d="M14 14 C16 11 17.8 8.6 18.8 3.6"/><path d="M16.8 9.6 L20.8 8.2"/><path d="M18 6.2 L15.8 2.8"/></g>' +
  `<path d="M8.8 13 L15.2 13 L14.2 18.6 L12 21.6 L9.8 18.6 Z" fill="currentColor"/><circle cx="10.6" cy="15.2" r=".9" ${DARK}/><circle cx="13.4" cy="15.2" r=".9" ${DARK}/>`;

const CROWN =
  '<path d="M3 8 L7.5 12 L12 4.5 L16.5 12 L21 8 L19 18 L5 18 Z" fill="currentColor"/><rect x="5" y="19" width="14" height="2.2" rx=".6" fill="currentColor"/>' +
  `<circle cx="12" cy="14" r="1.5" ${DARK}/><circle cx="8" cy="15" r="1" ${DARK}/><circle cx="16" cy="15" r="1" ${DARK}/>`;

const BANNER =
  '<path d="M6 3 V21.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="6" cy="2.6" r="1.4" fill="currentColor"/>' +
  `<path d="M6.9 4.2 H19.5 L16.8 8.8 L19.5 13.4 H6.9 Z" fill="currentColor"/><path d="M10.6 6.6 L12 8.8 L10.6 11 L9.2 8.8 Z" ${DARK}/>`;

const GLYPHS = {
  swords:
    '<path d="M3 3 L6.4 4.1 L15.7 13.4 L13.4 15.7 L4.1 6.4 Z" fill="currentColor"/><path d="M21 3 L17.6 4.1 L8.3 13.4 L10.6 15.7 L19.9 6.4 Z" fill="currentColor"/>' +
    '<g stroke="currentColor" stroke-linecap="round"><path d="M12.4 17.6 L17.6 12.4" stroke-width="2.2"/><path d="M11.6 17.6 L6.4 12.4" stroke-width="2.2"/><path d="M15.6 15.6 L19 19" stroke-width="2.1"/><path d="M8.4 15.6 L5 19" stroke-width="2.1"/></g>' +
    '<circle cx="20" cy="20" r="1.7" fill="currentColor"/><circle cx="4" cy="20" r="1.7" fill="currentColor"/>',
  antlers: ANTLERS,
  event:
    '<path d="M8.6 8.8 C8.6 6.4 10.2 4.6 12.3 4.6 C14.6 4.6 16.2 6.2 16.2 8.3 C16.2 10.4 14.6 11.2 13.5 11.9 C12.6 12.5 12.3 13.1 12.3 14.3 V15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>' +
    '<circle cx="12.3" cy="19" r="1.75" fill="currentColor"/>',
  purse:
    '<path d="M8.2 8.2 H15.8 C17.8 10.4 19.2 13.6 19.2 16.4 C19.2 19.6 16.4 21 12 21 C7.6 21 4.8 19.6 4.8 16.4 C4.8 13.6 6.2 10.4 8.2 8.2 Z" fill="currentColor"/>' +
    '<path d="M8.8 7.8 L7 3.8 L12 5.6 L17 3.8 L15.2 7.8 Z" fill="currentColor"/>' +
    `<path d="M8 8 H16" stroke="#000" stroke-opacity=".4" stroke-width="1.1"/><circle cx="12" cy="15" r="2.6" ${DARK}/><circle cx="12" cy="15" r="1.2" fill="currentColor"/>`,
  campfire:
    `<path d="${FLAME_D}" fill="currentColor" transform="translate(2.4 -1.2) scale(.8)"/>` +
    '<path d="M4 20.5 L20 16.4 M4 16.4 L20 20.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
  throne:
    '<path d="M7 3 L7 12.6 L17 12.6 L17 3 L15.2 5.6 L13.6 2.4 L12 5.2 L10.4 2.4 L8.8 5.6 Z" fill="currentColor"/>' +
    '<rect x="5" y="12.8" width="14" height="3.2" rx=".7" fill="currentColor"/>' +
    '<path d="M6.6 16 V21 M17.4 16 V21 M4.4 10.5 V15.5 M19.6 10.5 V15.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    `<path d="M12 7 L13 8.6 L12 10.2 L11 8.6 Z" ${DARK}/>`,
  skull:
    '<path d="M12 3 C7.6 3 4.5 6 4.5 10.2 C4.5 12.8 5.8 14.6 7.5 15.6 V18.5 C7.5 19.3 8.2 20 9 20 H15 C15.8 20 16.5 19.3 16.5 18.5 V15.6 C18.2 14.6 19.5 12.8 19.5 10.2 C19.5 6 16.4 3 12 3 Z" fill="currentColor"/>' +
    '<circle cx="9" cy="11" r="2.15" fill="#000" fill-opacity=".72"/><circle cx="15" cy="11" r="2.15" fill="#000" fill-opacity=".72"/>' +
    '<path d="M12 13.4 L13 15.3 H11 Z" fill="#000" fill-opacity=".72"/><path d="M10.5 17.3 V20 M13.5 17.3 V20" stroke="#000" stroke-opacity=".55" stroke-width=".9"/>',
  crown: CROWN,
  flame: `<path d="${FLAME_D}" fill="currentColor"/><path d="${FLAME_CORE}" fill="#fff" fill-opacity=".42"/>`,
  sun: `<path d="${starPath(12, 12, 8, 10.5, 5.6)}" fill="currentColor"/><circle cx="12" cy="12" r="3.6" ${DARK}/><circle cx="12" cy="12" r="2" fill="currentColor"/>`,
  star4: `<path d="${starPath(12, 12, 4, 10.5, 3.4)}" fill="currentColor"/>`,
  banner: BANNER,
  chest: CHEST,
  lock:
    '<rect x="5" y="10.5" width="14" height="10.5" rx="1.6" fill="currentColor"/><path d="M8 10.5 V7.6 a4 4 0 0 1 8 0 V10.5" fill="none" stroke="currentColor" stroke-width="2.3"/>' +
    `<circle cx="12" cy="15" r="1.6" ${DARK}/><rect x="11.3" y="15.4" width="1.4" height="3" ${DARK}/>`,
  check: '<path d="M4.8 12.6 L9.8 17.6 L19.4 6.6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  back: '<path d="M14.5 5 L7.5 12 L14.5 19" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  next: '<path d="M9.5 5 L16.5 12 L9.5 19" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  gear: `<path d="${gearPath()}" fill="currentColor"/><circle cx="12" cy="12" r="3.2" ${DARK}/>`,
  scroll:
    '<path d="M6 4 H17 C18.7 4 19.5 5 19.5 6.2 V18 C19.5 19.4 18.6 20.2 17.4 20.2 H7.8 C9 19.6 9.4 18.6 9.4 17.6 V6.6 C9.4 5.2 8 4 6 4 Z" fill="currentColor"/>' +
    '<path d="M6 4 C4.6 4 3.8 5 3.8 6.1 C3.8 7.4 4.8 8.2 6.2 8.2 H9.4" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M11.6 8.6 H17 M11.6 11.4 H17 M11.6 14.2 H15.6" stroke="#000" stroke-opacity=".42" stroke-width="1.2" stroke-linecap="round"/>',
  laurel: laurel(),
  wheat: wheat(),
  log:
    '<path d="M4.6 9 H17.6 C19.6 9 21 10.8 21 13 C21 15.2 19.6 17 17.6 17 H4.6 Z" fill="currentColor"/><ellipse cx="4.6" cy="13" rx="2.6" ry="4" fill="currentColor"/>' +
    `<ellipse cx="4.6" cy="13" rx="1.6" ry="2.6" ${DARK}/><path d="M9 11 H15 M10.5 15 H17" stroke="#000" stroke-opacity=".35" stroke-width="1" stroke-linecap="round"/>`,
  tower: TOWER,
  spear:
    '<path d="M4 20.5 L16 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M21 3 L19.2 9.8 L16.8 7.6 L14.2 5.2 Z" fill="currentColor"/>' +
    '<path d="M13.8 8.6 L15.8 10.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  bow:
    '<path d="M7.5 3 C15.5 6 15.5 18 7.5 21" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M7.5 3 V21" stroke="currentColor" stroke-width=".9"/>' +
    '<path d="M3.5 12 H18" stroke="currentColor" stroke-width="1.5"/><path d="M21 12 L17 9.8 V14.2 Z" fill="currentColor"/><path d="M3.5 12 L5.4 10.4 M3.5 12 L5.4 13.6" stroke="currentColor" stroke-width="1.1"/>',
  horseshoe:
    '<path d="M6.5 3.6 V10.8 C6.5 16 9 19.6 12 19.6 C15 19.6 17.5 16 17.5 10.8 V3.6" fill="none" stroke="currentColor" stroke-width="3.6"/>' +
    `<circle cx="6.5" cy="6.4" r=".75" ${DARK}/><circle cx="6.7" cy="10.4" r=".75" ${DARK}/><circle cx="17.5" cy="6.4" r=".75" ${DARK}/><circle cx="17.3" cy="10.4" r=".75" ${DARK}/>`,
  ram:
    '<path d="M3.5 8.4 L9.6 4.4 L15.6 8.4 Z" fill="currentColor"/><rect x="4" y="8.6" width="11.6" height="6.6" rx="1" fill="currentColor"/><path d="M15.6 9.2 L21 11.9 L15.6 14.6 Z" fill="currentColor"/>' +
    `<circle cx="7.2" cy="17.4" r="2.3" fill="currentColor"/><circle cx="12.6" cy="17.4" r="2.3" fill="currentColor"/><circle cx="7.2" cy="17.4" r=".8" ${DARK}/><circle cx="12.6" cy="17.4" r=".8" ${DARK}/>`,
  helm:
    '<path d="M5 13 C5 7.6 8 4.4 12 4.4 C16 4.4 19 7.6 19 13 V19.6 H14.4 V14.4 H9.6 V19.6 H5 Z" fill="currentColor"/>' +
    '<path d="M12 4.6 C12.6 2.6 15 1.6 17.6 2.2 C15.8 3 14.8 4 14.4 5.6" fill="currentColor"/>' +
    `<path d="M7.4 11.4 H16.6 V12.6 H7.4 Z" ${DARK}/>`,
  chevrons:
    '<path d="M4.6 10 L12 4.6 L19.4 10 V13.2 L12 7.8 L4.6 13.2 Z" fill="currentColor"/><path d="M4.6 16.4 L12 11 L19.4 16.4 V19.6 L12 14.2 L4.6 19.6 Z" fill="currentColor"/>',
  moon: '<path d="M14.6 3.2 A9 9 0 1 0 20.8 15.4 A7.2 7.2 0 1 1 14.6 3.2 Z" fill="currentColor"/><path d="M18.4 6.2 C19.6 8 19.9 9.2 19.2 10 C18.5 10.8 17.4 10.2 17.4 9 C17.4 8.2 17.8 7.4 18.4 6.2 Z" fill="currentColor"/>',
  fog: '<path d="M3 8 C6 6 8 10 12 8 C16 6 18 10 21 8 M3 13 C6 11 8 15 12 13 C16 11 18 15 21 13 M5 18 C8 16 10 20 13 18 C16 16 17.5 19.5 19.5 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  bush:
    '<circle cx="8.2" cy="13.4" r="4.6" fill="currentColor"/><circle cx="15.8" cy="13.4" r="4.6" fill="currentColor"/><circle cx="12" cy="9.4" r="5" fill="currentColor"/><rect x="4" y="13.4" width="16" height="5.6" rx="2.8" fill="currentColor"/>' +
    `<circle cx="9.4" cy="9.6" r="1" ${DARK}/><circle cx="14" cy="8.4" r="1" ${DARK}/><circle cx="7" cy="14.4" r="1" ${DARK}/><circle cx="12.4" cy="13.4" r="1" ${DARK}/><circle cx="16.8" cy="14.6" r="1" ${DARK}/>`,
  tendril:
    '<path d="M3.5 20 C6 20 8 18.4 8.6 15.4 C9.4 11.6 12.6 10.4 15 11.6 C17.4 12.8 17.6 16 15.4 16.8 C13.6 17.4 12.4 15.6 13.4 14.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '<path d="M10.4 7.6 C12.4 5 16 4 19.6 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '<path d="M6.6 17.6 L5 15.4 M9.2 13.2 L7.4 11.6 M14 5.6 L13.4 3.4 M17.4 4.6 L18 2.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  famine: `<path d="${FLAME_D}" fill="currentColor" fill-opacity=".9"/><path d="M4 4 L20 20" stroke="#120f0c" stroke-width="4" stroke-linecap="round"/><path d="M4 4 L20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  shield:
    '<path d="M12 2.6 L20 5.6 V11 C20 16 16.6 19.8 12 21.6 C7.4 19.8 4 16 4 11 V5.6 Z" fill="currentColor"/>' +
    `<path d="M12 6.4 L16.6 8.2 V11.4 C16.6 14.4 14.8 16.8 12 18 Z" ${DARK}/>`,
  hunt:
    '<g transform="translate(3 1) scale(.82)">' +
    ANTLERS +
    '</g><path d="M2 16 H6.5 M2 19.4 H8 M2 12.6 H4.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  rain:
    '<path d="M6.6 13 C4.4 13 3 11.6 3 9.8 C3 8 4.4 6.6 6.4 6.6 C6.8 4.4 8.8 3 11.2 3 C13.8 3 15.8 4.8 16.2 7 C18.8 7 21 8.6 21 10.2 C21 11.8 19.6 13 17.6 13 Z" fill="currentColor"/>' +
    '<path d="M7.6 15.6 L6.2 19.4 M12 15.6 L10.6 19.4 M16.4 15.6 L15 19.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  cachestar: CHEST + `<path d="${starPath(18.6, 4.6, 4, 4, 1.3)}" fill="currentColor"/>`,
  nest:
    '<path d="M2.6 20 C4.4 13 7.6 9.4 12 9.4 C16.4 9.4 19.6 13 21.4 20 Z" fill="currentColor"/>' +
    '<path d="M6.4 12.6 L4.2 8.4 L8.4 10.6 M12 9.6 L12 4 L13.4 9.6 M17.6 12.6 L19.8 8.4 L15.6 10.6" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
    `<ellipse cx="12" cy="16.4" rx="3" ry="2.2" ${DARK}/>`,
  torch:
    `<path d="${FLAME_D}" fill="currentColor" transform="translate(4.4 -1.4) scale(.64)"/><path d="M10 13.4 H14 L13 21.6 H11 Z" fill="currentColor"/>` +
    `<path d="M9.6 13.4 H14.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  stones:
    '<rect x="3" y="9" width="4" height="11" rx="1.2" fill="currentColor"/><rect x="10" y="5" width="4" height="15" rx="1.2" fill="currentColor"/><rect x="17" y="9" width="4" height="11" rx="1.2" fill="currentColor"/>' +
    '<path d="M2 20.6 H22" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="2.6" r="1.6" fill="currentColor"/>',
  swarm: `<path d="${starPath(8, 9, 5, 4.6, 1.9)}" fill="currentColor"/><path d="${starPath(16.4, 8, 5, 3.6, 1.5)}" fill="currentColor"/><path d="${starPath(12, 16.4, 5, 4.4, 1.8)}" fill="currentColor"/><path d="${starPath(5, 18, 5, 2.6, 1.1)}" fill="currentColor"/><path d="${starPath(19.4, 17, 5, 2.8, 1.2)}" fill="currentColor"/>`,
  quill:
    '<path d="M4 20 C8 14 13 8.4 20.6 3.4 C18 9.4 13.6 14.4 6.2 20.8 Z" fill="currentColor"/><path d="M5.2 19.6 L14.6 9.4" stroke="#000" stroke-opacity=".4" stroke-width="1"/>' +
    '<path d="M3.4 12.6 L8 13.6 M5.6 8 L10 10.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  info: '<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="7.6" r="1.4" fill="currentColor"/><path d="M12 10.8 V17.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  hearth:
    `<path d="M3.6 20.6 C3.6 15.6 7.4 12.6 12 12.6 C16.6 12.6 20.4 15.6 20.4 20.6 Z" fill="currentColor"/><path d="${FLAME_D}" fill="currentColor" transform="translate(5.4 -.6) scale(.55)"/>` +
    `<path d="M7.6 20.6 V17.4 M12 20.6 V16.4 M16.4 20.6 V17.4" stroke="#000" stroke-opacity=".4" stroke-width="1.2"/>`,
  people:
    '<circle cx="8" cy="7.4" r="3" fill="currentColor"/><path d="M2.6 20 C2.6 15 5 12 8 12 C11 12 13.4 15 13.4 20 Z" fill="currentColor"/>' +
    '<circle cx="16.6" cy="8.6" r="2.6" fill="currentColor"/><path d="M12.6 20 C12.8 16 14.4 13.4 16.6 13.4 C18.8 13.4 21.2 16 21.2 20 Z" fill="currentColor"/>',
  hammer:
    '<path d="M4 20 L13 11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M10.6 6.2 L15 2 L22 9 L17.8 13.2 L15.8 11.2 L14.2 12.8 L11.2 9.8 L12.8 8.2 Z" fill="currentColor"/>',
  dice:
    '<rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="currentColor"/>' +
    `<circle cx="8" cy="8" r="1.6" ${DARK}/><circle cx="16" cy="16" r="1.6" ${DARK}/><circle cx="12" cy="12" r="1.6" ${DARK}/><circle cx="16" cy="8" r="1.6" ${DARK}/><circle cx="8" cy="16" r="1.6" ${DARK}/>`,
  hourglass:
    '<path d="M6 3 H18 M6 21 H18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7.4 3.6 H16.6 C16.6 8 13.4 10 12 12 C10.6 10 7.4 8 7.4 3.6 Z M12 12 C13.4 14 16.6 16 16.6 20.4 H7.4 C7.4 16 10.6 14 12 12 Z" fill="currentColor"/>',
  door: '<path d="M5 21 V5 C5 3.8 5.8 3 7 3 H17 C18.2 3 19 3.8 19 5 V21" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 21 V6 H16 V21" fill="currentColor"/><circle cx="14" cy="13.6" r="1" fill="#000" fill-opacity=".5"/>',
  skip: '<path d="M5 5 L12.5 12 L5 19 Z M12 5 L19.5 12 L12 19 Z" fill="currentColor"/>',
  muster:
    '<path d="M5 21 V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5.8 4 H14 L12 7.4 L14 10.8 H5.8 Z" fill="currentColor"/>' +
    '<path d="M12 21 V8.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12.8 9.4 H21 L19 12.8 L21 16.2 H12.8 Z" fill="currentColor"/>',
} as const;

export type GlyphName = keyof typeof GLYPHS;

export function glyphMarkup(name: GlyphName): string {
  return GLYPHS[name];
}

/** Create an inline SVG glyph element. */
export function glyph(name: GlyphName, cls = 'glyph'): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('class', cls);
  el.innerHTML = GLYPHS[name];
  return el;
}

// ---- semantic mappings -------------------------------------------------------------

export const NODE_GLYPH: Record<NodeType, GlyphName> = {
  battle: 'swords',
  elite: 'antlers',
  event: 'event',
  peddler: 'purse',
  camp: 'campfire',
  boss: 'throne',
};

export const REWARD_GLYPH: Record<RewardType, GlyphName> = {
  boon: 'sun',
  draft: 'banner',
  spoils: 'chest',
};

export const TAG_GLYPH: Record<BoonTag, GlyphName> = {
  Econ: 'wheat',
  Ember: 'flame',
  Fort: 'tower',
  Pike: 'spear',
  Bow: 'bow',
  Horse: 'horseshoe',
  Siege: 'ram',
  Warden: 'helm',
  Veteran: 'chevrons',
};

export const MODIFIER_GLYPH: Record<ModifierId, GlyphName> = {
  blood_moon: 'moon',
  thick_fog: 'fog',
  bountiful_wilds: 'bush',
  creeping_wake: 'tendril',
  ember_famine: 'famine',
  fortified_nests: 'shield',
  swift_hunt: 'hunt',
  downpour: 'rain',
  ancient_cache: 'cachestar',
  old_watchtowers: 'tower',
};

export const OBJECTIVE_GLYPH: Record<ObjectiveId, GlyphName> = {
  raze: 'torch',
  holdfast: 'shield',
  beacons: 'stones',
  elite: 'antlers',
  boss: 'throne',
};

export const DOCTRINE_GLYPH: Record<DoctrineId, GlyphName> = {
  swarm: 'swarm',
  spines: 'quill',
  hunt: 'hunt',
  siegebreak: 'ram',
  court: 'crown',
};

export const RESOURCE_GLYPH: Record<ResourceType, GlyphName> = {
  grain: 'wheat',
  timber: 'log',
  ember: 'flame',
};

/** Modifier kind -> CSS color. */
export const MODIFIER_KIND_COLOR: Record<string, string> = {
  positive: '#6fd06f',
  negative: '#d9443b',
  mixed: '#e8a33d',
  neutral: '#a8987a',
};

/** Chevron (rank) mark used by unit chips. */
export function chevron(): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 20 9');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<path d="M1 7.4 L10 1.2 L19 7.4 L19 8.8 L10 4.4 L1 8.8 Z" fill="currentColor"/>';
  return el;
}

/** Ornamental divider: fading rules, diamonds and a central flame. */
export function divider(cls = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `divider ${cls}`.trim();
  el.setAttribute('aria-hidden', 'true');
  const left = document.createElement('i');
  const right = document.createElement('i');
  right.className = 'r';
  const mid = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mid.setAttribute('viewBox', '0 0 72 18');
  mid.innerHTML =
    '<path d="M0 9 L6 5 L12 9 L6 13 Z M60 9 L66 5 L72 9 L66 13 Z" fill="currentColor"/>' +
    '<path d="M16 9 H28 M44 9 H56" stroke="currentColor" stroke-width="1" stroke-opacity=".7"/>' +
    '<path d="M36 1.2 C37.5 4.3 40.6 5.6 40.6 9.8 C40.6 13 38.5 16.4 36 16.4 C33.5 16.4 31.4 13 31.4 10 C31.4 7.5 32.9 6.4 33.7 5.2 C33.9 6.9 34.5 7.7 35.4 8.1 C35 5.8 35.2 3.5 36 1.2 Z" fill="#ff8c3a"/>' +
    '<path d="M36 8.4 C36.8 10 38 10.6 38 12.4 C38 13.8 37.1 14.8 36 14.8 C34.9 14.8 34 13.8 34 12.6 C34 11.2 35.2 10.4 36 8.4 Z" fill="#ffd27a"/>';
  el.append(left, mid, right);
  return el;
}
