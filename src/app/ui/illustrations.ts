/**
 * Woodcut-style SVG plates for events, the camp and the peddler (original silhouette art).
 * viewBox 480 x 190. Static markup only.
 */
import type { EventId } from '../../sim/types';

export type PlateId = EventId | 'camp' | 'peddler';

const W = 480;
const H = 190;

function sky(top: string, mid: string, low: string): string {
  return `<defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset=".6" stop-color="${mid}"/><stop offset="1" stop-color="${low}"/></linearGradient>
  <radialGradient id="fire" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd27a" stop-opacity=".95"/><stop offset=".35" stop-color="#ff6a2b" stop-opacity=".55"/><stop offset="1" stop-color="#ff6a2b" stop-opacity="0"/></radialGradient>
  <radialGradient id="violet" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#d9a8ef" stop-opacity=".7"/><stop offset=".4" stop-color="#7b3fa0" stop-opacity=".35"/><stop offset="1" stop-color="#5a1f5e" stop-opacity="0"/></radialGradient>
  <radialGradient id="pale" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#d8e2e6" stop-opacity=".8"/><stop offset="1" stop-color="#8fa3ad" stop-opacity="0"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#sk)"/>`;
}

function stars(n: number, seed: number): string {
  let s = '';
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 9301 + 49297) % 233280;
    const px = (x / 233280) * W;
    x = (x * 9301 + 49297) % 233280;
    const py = (x / 233280) * H * 0.45;
    s += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${i % 5 === 0 ? 1.1 : 0.7}" fill="#f4e6c1" opacity="${0.25 + (i % 3) * 0.15}"/>`;
  }
  return s;
}

function thornVine(d: string, w = 3): string {
  return `<path d="${d}" fill="none" stroke="#0b070c" stroke-width="${w}" stroke-linecap="round"/>`;
}

function figure(x: number, y: number, s = 1, lantern = false): string {
  return (
    `<g transform="translate(${x} ${y}) scale(${s})" fill="#0b080a">` +
    `<circle cx="0" cy="-26" r="5"/><path d="M-6 -21 L6 -21 L9 0 L-9 0 Z"/>` +
    (lantern ? `<path d="M5 -16 L12 -22" stroke="#0b080a" stroke-width="1.5"/><circle cx="13" cy="-20" r="7" fill="url(#fire)"/><circle cx="13" cy="-20" r="1.8" fill="#ffd27a"/>` : '') +
    `</g>`
  );
}

function rider(x: number, y: number, s = 1): string {
  return (
    `<g transform="translate(${x} ${y}) scale(${s})" fill="#0a070a">` +
    `<ellipse cx="0" cy="-12" rx="16" ry="7"/><path d="M12 -16 L20 -26 L23 -24 L17 -12 Z"/>` +
    `<path d="M-12 -8 L-13 2 M-6 -7 L-6 2 M6 -7 L7 2 M12 -8 L14 2" stroke="#0a070a" stroke-width="2.4"/>` +
    `<circle cx="0" cy="-27" r="4"/><path d="M-4 -24 L4 -24 L5 -15 L-5 -15 Z"/><path d="M3 -30 L3 -46" stroke="#0a070a" stroke-width="1.6"/>` +
    `</g>`
  );
}

const PLATES: Record<PlateId, () => string> = {
  refugees_ford: () =>
    sky('#121019', '#2a2230', '#3a2a22') +
    stars(30, 7) +
    `<circle cx="380" cy="52" r="46" fill="url(#pale)" opacity=".5"/><circle cx="380" cy="52" r="14" fill="#d8e2e6" opacity=".8"/>` +
    `<path d="M0 120 C120 100 240 135 480 112 L480 190 L0 190 Z" fill="#141016"/>` +
    `<path d="M0 142 C140 128 300 160 480 136 L480 166 C300 186 140 156 0 170 Z" fill="#2a5a66" opacity=".75"/>` +
    `<path d="M20 150 C120 142 240 162 400 146" stroke="#8fc3c8" stroke-opacity=".35" stroke-width="1.5" fill="none"/>` +
    `<path d="M60 160 C160 154 260 170 440 156" stroke="#8fc3c8" stroke-opacity=".25" stroke-width="1" fill="none"/>` +
    figure(130, 152, 0.9) + figure(156, 155, 0.75) + figure(178, 152, 0.95, true) + figure(205, 156, 0.7) + figure(226, 154, 0.85) + figure(252, 158, 0.65) +
    `<path d="M0 190 L0 172 C60 166 100 176 160 190 Z" fill="#0b080a"/>` +
    thornVine('M480 120 C450 110 440 90 452 70 M462 104 L474 98 M446 88 L436 80'),
  thorn_smith: () =>
    sky('#140d10', '#2a1512', '#4a2412') +
    `<circle cx="240" cy="118" r="120" fill="url(#fire)" opacity=".55"/>` +
    `<path d="M0 150 L480 150 L480 190 L0 190 Z" fill="#0d090a"/>` +
    `<path d="M196 150 L204 128 L180 128 L176 118 L300 118 L292 128 L270 128 L280 150 Z" fill="#0b0708"/>` +
    `<path d="M206 118 L206 108 L276 108 L292 112 L276 116 L206 116" fill="#0b0708"/>` +
    `<g transform="rotate(-38 296 70)"><rect x="288" y="36" width="5" height="62" fill="#0b0708"/><rect x="276" y="28" width="30" height="13" rx="2" fill="#0b0708"/></g>` +
    `<circle cx="250" cy="104" r="3" fill="#ffd27a"/><circle cx="262" cy="98" r="2" fill="#ffb347"/><circle cx="236" cy="96" r="1.6" fill="#ff8c3a"/><circle cx="270" cy="88" r="1.3" fill="#ffd27a"/>` +
    thornVine('M0 60 C40 70 70 100 90 150 M30 72 L22 62 M58 92 L70 86 M76 120 L64 118', 4) +
    thornVine('M480 40 C430 60 410 100 400 150 M452 54 L460 44 M426 82 L414 78 M408 118 L420 114', 4) +
    `<path d="M150 150 C160 120 175 110 190 120" stroke="#8fd14f" stroke-opacity=".5" stroke-width="2" fill="none"/>`,
  sellsword_company: () =>
    sky('#0f0d14', '#262030', '#3d2a20') +
    stars(24, 3) +
    `<path d="M0 132 C100 110 200 120 300 104 C380 92 430 110 480 104 L480 190 L0 190 Z" fill="#120e12"/>` +
    rider(150, 122, 1) + rider(196, 118, 1.05) + rider(248, 114, 1) + rider(296, 110, 0.95) +
    `<path d="M340 160 L340 50" stroke="#0a070a" stroke-width="4"/>` +
    `<path d="M342 54 L412 58 L394 74 L414 88 L380 92 L368 84 L352 96 L342 92 Z" fill="#7a2418"/>` +
    `<path d="M352 66 L372 68 L362 80 Z" fill="#e8a33d" opacity=".8"/>` +
    `<path d="M0 190 L0 160 C80 150 160 166 240 190 Z" fill="#0a070a"/>`,
  cold_watchfire: () =>
    sky('#0c0e16', '#1a2030', '#2a2a30') +
    stars(60, 11) +
    `<circle cx="90" cy="46" r="30" fill="url(#pale)" opacity=".7"/><circle cx="90" cy="46" r="11" fill="#e6eef0" opacity=".85"/>` +
    `<path d="M0 150 C80 140 160 150 220 146 C300 140 380 150 480 142 L480 190 L0 190 Z" fill="#141820"/>` +
    `<path d="M120 190 C180 120 240 96 300 92 C360 96 420 130 480 160 L480 190 Z" fill="#0b0c10"/>` +
    `<path d="M292 92 L286 70 L314 70 L308 92 Z" fill="#0b0c10"/><path d="M280 70 L320 70 L316 62 L284 62 Z" fill="#0b0c10"/>` +
    `<path d="M296 62 C298 56 302 54 304 50 M304 62 C306 56 310 54 308 48" stroke="#8fa3ad" stroke-opacity=".5" stroke-width="1.5" fill="none"/>` +
    `<path d="M20 160 L60 156 M70 158 L120 152 M140 156 L200 150" stroke="#8fa3ad" stroke-opacity=".25" stroke-width="1"/>`,
  hollow_envoy: () =>
    sky('#100a14', '#24142c', '#2c1820') +
    `<circle cx="240" cy="110" r="110" fill="url(#violet)"/>` +
    `<path d="M0 160 L480 160 L480 190 L0 190 Z" fill="#0d0810"/>` +
    `<path d="M240 52 L262 160 L218 160 Z" fill="#0b070c"/>` +
    `<circle cx="240" cy="48" r="9" fill="#0b070c"/>` +
    `<path d="M228 40 L231 30 L235 38 L240 26 L245 38 L249 30 L252 40 Z" fill="#0b070c" stroke="#8fd14f" stroke-opacity=".8" stroke-width="1"/>` +
    `<circle cx="237" cy="48" r="1.2" fill="#d9a8ef"/><circle cx="243" cy="48" r="1.2" fill="#d9a8ef"/>` +
    `<path d="M262 80 L290 40" stroke="#0b070c" stroke-width="2.4"/><path d="M290 40 L322 46 L314 56 L324 66 L290 62 Z" fill="#e9e2d0" opacity=".85"/>` +
    thornVine('M0 120 C40 120 60 140 70 160 M30 122 L26 112 M54 134 L64 128', 3) +
    thornVine('M480 110 C440 114 420 136 414 160 M452 114 L456 104 M430 132 L420 126', 3),
  wayshrine: () =>
    sky('#120e10', '#2a1c18', '#3a2418') +
    stars(18, 5) +
    `<path d="M0 156 L480 156 L480 190 L0 190 Z" fill="#0e0a0a"/>` +
    `<circle cx="240" cy="126" r="70" fill="url(#fire)" opacity=".6"/>` +
    `<path d="M196 82 L240 54 L284 82 Z" fill="#0b0808"/><rect x="200" y="82" width="80" height="6" fill="#0b0808"/>` +
    `<rect x="206" y="88" width="7" height="68" fill="#0b0808"/><rect x="267" y="88" width="7" height="68" fill="#0b0808"/>` +
    `<path d="M222 140 L258 140 L254 156 L226 156 Z" fill="#0b0808"/>` +
    `<ellipse cx="240" cy="138" rx="14" ry="4" fill="#ff6a2b" opacity=".9"/><circle cx="234" cy="136" r="2" fill="#ffd27a"/><circle cx="245" cy="137" r="1.6" fill="#ffd27a"/>` +
    `<circle cx="150" cy="60" r="1.2" fill="#a8987a" opacity=".6"/><circle cx="320" cy="40" r="1.4" fill="#a8987a" opacity=".5"/><circle cx="360" cy="90" r="1" fill="#a8987a" opacity=".6"/><circle cx="110" cy="110" r="1.2" fill="#a8987a" opacity=".5"/>` +
    `<path d="M120 156 C130 140 150 136 160 156 M330 156 C340 144 356 142 366 156" fill="#0b0808"/>`,
  camp: () =>
    sky('#0e0b12', '#1e1620', '#2e1c14') +
    stars(50, 13) +
    `<circle cx="240" cy="150" r="140" fill="url(#fire)" opacity=".55"/>` +
    `<path d="M0 158 L480 158 L480 190 L0 190 Z" fill="#0d0909"/>` +
    `<path d="M70 158 L110 96 L150 158 Z" fill="#0b0808"/><path d="M104 158 L110 120 L118 158 Z" fill="#2a1a10"/>` +
    `<path d="M330 158 L372 92 L414 158 Z" fill="#0b0808"/><path d="M366 158 L372 118 L380 158 Z" fill="#2a1a10"/>` +
    `<path d="M214 158 L266 146 M214 146 L266 158" stroke="#0b0808" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M240 104 C246 118 258 124 258 138 C258 148 250 154 240 154 C230 154 222 148 222 138 C222 128 230 124 233 116 C234 124 237 128 240 129 C238 120 238 112 240 104 Z" fill="#ff6a2b"/>` +
    `<path d="M240 126 C243 134 249 138 249 145 C249 150 245 153 240 153 C235 153 231 150 231 145 C231 139 237 136 240 126 Z" fill="#ffd27a"/>` +
    figure(180, 158, 0.9) + figure(300, 158, 0.95) +
    `<path d="M420 158 L420 110" stroke="#0b0808" stroke-width="3"/><path d="M421 112 L452 116 L444 126 L452 136 L421 132 Z" fill="#7a3a14"/>`,
  peddler: () =>
    sky('#100d12', '#221a1e', '#33241a') +
    stars(30, 17) +
    `<path d="M0 160 L480 160 L480 190 L0 190 Z" fill="#0d0a0a"/>` +
    `<circle cx="300" cy="120" r="80" fill="url(#fire)" opacity=".4"/>` +
    `<path d="M150 136 L330 136 L330 86 C330 62 300 50 240 50 C180 50 150 62 150 86 Z" fill="#0b0808"/>` +
    `<path d="M170 86 L310 86" stroke="#e8a33d" stroke-opacity=".35" stroke-width="2"/>` +
    `<circle cx="180" cy="148" r="16" fill="none" stroke="#0b0808" stroke-width="5"/><circle cx="300" cy="148" r="16" fill="none" stroke="#0b0808" stroke-width="5"/>` +
    `<path d="M180 148 L180 132 M300 148 L300 132 M164 148 L196 148 M284 148 L316 148" stroke="#0b0808" stroke-width="2.5"/>` +
    `<rect x="140" y="132" width="200" height="8" fill="#0b0808"/>` +
    `<path d="M330 128 L380 120" stroke="#0b0808" stroke-width="3"/><circle cx="386" cy="114" r="10" fill="url(#fire)"/><circle cx="386" cy="114" r="2.4" fill="#ffd27a"/>` +
    `<circle cx="214" cy="112" r="5" fill="#e8c547" opacity=".85"/><circle cx="226" cy="116" r="4" fill="#e8c547" opacity=".7"/><circle cx="252" cy="110" r="5" fill="#5fa8e8" opacity=".6"/>` +
    figure(110, 160, 1, true),
};

export function plate(id: PlateId): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', `0 0 ${W} ${H}`);
  el.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  el.setAttribute('class', 'plate-svg');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = (PLATES[id] ?? PLATES.camp)();
  return el;
}
