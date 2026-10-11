/**
 * DEV PAGE (gallery.html): every unit, building and icon for both owners at several sizes, a full sample
 * battle scene rendered by the real renderer (animated by a cosmetic puppet), a perf probe, and — when
 * mapgen + sim-core are available — real generated worlds for every biome.
 *
 * URL params: ?only=scene|units|buildings|icons|real|live  &biome=greenmarch  &zoom=1  &units=140  &paused=1  &w=1280&h=720
 */
import { Camera } from './camera';
import { buildBattleScene, FixtureBuilder, type Scene } from './devFixture';
import { drawIcon, EXTRA_ICON_KEYS, iconUrl } from './icons';
import { CanvasRenderer } from './renderer';
import { T } from './shapes';
import { BUILDINGS } from '../data/buildings';
import { BIOME_IDS, BUILDING_IDS, ENEMY_UNIT_IDS, PLAYER_UNIT_IDS } from '../data/ids';
import { UNITS } from '../data/units';
import { createBattleUIState, type BattleUIState, type IconKind } from '../game/types';
import { Terrain, type BattleSetup, type BiomeId, type BuildingId, type GameMap, type Owner, type UnitId, type World } from '../sim/types';

const params = new URLSearchParams(location.search);
const only = params.get('only');
const dpr = Math.min(2, window.devicePixelRatio || 1);
const root = document.getElementById('gallery') as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function section(id: string, title: string, note?: string): HTMLElement {
  const s = el('section', { id });
  s.append(el('h2', {}, title));
  if (note) s.append(el('div', { class: 'muted' }, note));
  root.append(s);
  return s;
}

function sized(canvas: HTMLCanvasElement, w: number, h: number): void {
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}

function grassMap(w: number, h: number, biome: BiomeId = 'greenmarch'): GameMap {
  const n = w * h;
  const variant = new Uint8Array(n);
  for (let i = 0; i < n; i++) variant[i] = (i * 2654435761) >>> 24;
  return { w, h, biome, terrain: new Uint8Array(n), treeAmount: new Uint16Array(n), variant };
}

function boardSetup(biome: BiomeId): BattleSetup {
  return {
    seed: 1,
    nodeId: 'board',
    objective: 'raze',
    biome,
    depth: 3,
    isElite: false,
    isBoss: false,
    modifiers: [],
    doctrine: 'siegebreak',
    tier: 0,
    house: 'ardent',
    vanguard: 'muster_hall',
    unlockedUnits: [],
    unlockedBuildings: [],
    playerEffects: [],
    enemyEffects: [],
    boons: [],
    metaUnlocks: [],
    retinue: [],
    sellswords: [],
    wardenHpPct: 1,
    resolve: 3,
    waveMult: 1,
    coldWatchfire: false,
    showHints: false,
    bonusRes: {},
  };
}

/** Render a static board world with the real renderer, then draw labels. */
function renderBoard(world: World, zoom: number, labels: { x: number; y: number; text: string }[], ui?: BattleUIState, frames = 3): HTMLCanvasElement {
  const canvas = el('canvas');
  const cssW = Math.round(world.map.w * T * zoom);
  const cssH = Math.round(world.map.h * T * zoom);
  sized(canvas, cssW, cssH);
  const r = new CanvasRenderer(canvas);
  r.resize(cssW, cssH, dpr);
  const cam = new Camera();
  cam.minZoom = 0.25;
  cam.zoom = zoom;
  cam.setViewport(cssW, cssH);
  cam.bottomInset = 0;
  cam.topInset = 0;
  cam.setMapSize(world.map.w, world.map.h);
  cam.x = 0;
  cam.y = 0;
  const state = ui ?? createBattleUIState();
  for (let i = 0; i < frames; i++) r.render(world, cam, state, 0, 1 / 60);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const l of labels) {
    const x = l.x * T * zoom;
    const y = l.y * T * zoom;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10,8,6,0.85)';
    ctx.strokeText(l.text, x, y);
    ctx.fillStyle = '#F4E6C1';
    ctx.fillText(l.text, x, y);
  }
  r.destroy();
  return canvas;
}

// ---------------------------------------------------------------------------
// Sample battle scene
// ---------------------------------------------------------------------------

interface SceneApi {
  scene: Scene;
  renderer: CanvasRenderer;
  cam: Camera;
  ui: BattleUIState;
  perf(seconds?: number): Promise<{ avg: number; p95: number; max: number; fps: number; units: number; frames: number }>;
}

function sceneSection(): SceneApi {
  const s = section('scene', 'Sample battle scene', 'Hand-made World fixture, animated by a cosmetic puppet (not the sim). Drag to pan, wheel to zoom.');
  const controls = el('div', { class: 'controls' });
  const biomeSel = el('select');
  for (const b of BIOME_IDS) biomeSel.append(el('option', { value: b }, b));
  biomeSel.value = params.get('biome') ?? 'greenmarch';
  const zoomSel = el('select');
  for (const z of ['0.75', '1', '1.25', '1.5']) zoomSel.append(el('option', { value: z }, `zoom ${z}`));
  zoomSel.value = params.get('zoom') ?? '1';
  const mk = (label: string, checked: boolean): HTMLInputElement => {
    const l = el('label');
    const i = el('input', { type: 'checkbox' });
    i.checked = checked;
    l.append(i, document.createTextNode(label));
    controls.append(l);
    return i;
  };
  controls.append(biomeSel, zoomSel);
  const animate = mk('animate', params.get('paused') !== '1');
  const reveal = mk('reveal all', false);
  const overlays = mk('UI overlays', true);
  const duskL = el('label');
  const dusk = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: params.get('dusk') ?? '0.35' });
  duskL.append(document.createTextNode('dusk'), dusk);
  controls.append(duskL);
  const perfBtn = el('button', {}, 'Perf 4 s');
  const nestBtn = el('button', {}, 'Nest dies');
  const telBtn = el('button', {}, 'Boss telegraphs');
  const stand = el('button', {}, 'Last Stand');
  controls.append(perfBtn, nestBtn, telBtn, stand);
  s.append(controls);
  const row = el('div', { class: 'row' });
  const canvas = el('canvas', { id: 'scene-canvas' });
  const W = Number(params.get('w') ?? 1280);
  const H = Number(params.get('h') ?? 720);
  sized(canvas, W, H);
  const side = el('div', { class: 'card' });
  const mini = el('canvas', { id: 'minimap' });
  mini.width = 160 * dpr;
  mini.height = 160 * dpr;
  sized(mini, 160, 160);
  const perfOut = el('div', { id: 'perf' }, '');
  side.append(el('div', { class: 'caption' }, 'minimap'), mini, perfOut);
  row.append(canvas, side);
  s.append(row);

  const renderer = new CanvasRenderer(canvas);
  renderer.resize(W, H, dpr);
  const cam = new Camera();
  cam.setViewport(W, H);
  let scene = buildBattleScene({ biome: biomeSel.value as BiomeId, units: Number(params.get('units') ?? 140) });
  const ui = createBattleUIState();
  const setupScene = (): void => {
    scene = buildBattleScene({ biome: biomeSel.value as BiomeId, units: Number(params.get('units') ?? 140) });
    cam.setMapSize(scene.world.map.w, scene.world.map.h);
    cam.zoom = Number(zoomSel.value);
    cam.centerOn(scene.focus.x, scene.focus.y);
    const w = scene.world;
    const army = w.units.filter((u) => u.owner === 0 && u.cls !== 'worker').slice(0, 8);
    const mh = w.buildings.find((b) => b.type === 'muster_hall');
    ui.selection = overlays.checked ? [...army.map((u) => u.id), ...(mh ? [mh.id] : [])] : [];
    const enemy = w.units.find((u) => u.owner === 1 && u.type === 'stagrider');
    ui.hoverId = overlays.checked && enemy ? enemy.id : 0;
    const hearth = w.buildings.find((b) => b.type === 'hearth');
    ui.placement = overlays.checked && hearth ? { building: 'brazier_tower', tx: hearth.tx + 6, ty: hearth.ty - 5, ok: true } : null;
    ui.targeting = overlays.checked ? { kind: 'ability', slot: 'Q', radius: 2, range: 7 } : null;
    ui.mouseWorld = { x: scene.focus.x + 5, y: scene.focus.y - 2 };
    ui.box = overlays.checked ? { x0: 140, y0: 470, x1: 300, y1: 560 } : null;
    w.debug.revealAll = reveal.checked;
  };
  setupScene();
  biomeSel.onchange = setupScene;
  zoomSel.onchange = () => {
    cam.zoom = Number(zoomSel.value);
    cam.centerOn(scene.focus.x, scene.focus.y);
  };
  overlays.onchange = setupScene;
  reveal.onchange = () => (scene.world.debug.revealAll = reveal.checked);
  nestBtn.onclick = () => {
    const w = scene.world;
    const nest = w.buildings.find((b) => b.type === 'thorn_nest' && b.alive);
    if (!nest) return;
    nest.alive = false;
    w.buildings = w.buildings.filter((b) => b !== nest);
    w.entities.delete(nest.id);
    w.events.push({ t: 'death', id: nest.id, kind: 'building', type: 'thorn_nest', owner: 1, x: nest.x, y: nest.y, w: 3, h: 3 });
    w.events.push({ t: 'blightRecede', x: nest.x, y: nest.y, radius: nest.nest?.blightRadius ?? 6 });
    for (let i = 0; i < w.blight.tiles.length; i++) {
      const x = i % w.map.w;
      const y = Math.floor(i / w.map.w);
      if (Math.hypot(x + 0.5 - nest.x, y + 0.5 - nest.y) < 9) w.blight.tiles[i] = 0;
    }
    w.blight.version++;
    w.debug.revealAll = true;
    cam.centerOn(nest.x, nest.y + 3);
  };
  telBtn.onclick = () => {
    const f = scene.focus;
    scene.world.events.push({ t: 'telegraph', shape: 'ring', x: f.x + 2, y: f.y - 1, radius: 4, duration: 1.5 });
    scene.world.events.push({ t: 'telegraph', shape: 'line', x: f.x + 8, y: f.y - 4, x2: f.x - 2, y2: f.y + 1, width: 1.5, duration: 1.2 });
  };
  stand.onclick = () => scene.world.events.push({ t: 'lastStand', x: scene.focus.x, y: scene.focus.y });
  // Drag to pan, wheel to zoom.
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY }));
  window.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    ui.mouseWorld = cam.screenToWorld(e.clientX - r.left, e.clientY - r.top);
    if (!drag) return;
    cam.panBy(drag.x - e.clientX, drag.y - e.clientY);
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      cam.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );

  let last = performance.now();
  let miniAt = 0;
  const samples: number[] = [];
  const intervals: number[] = [];
  let recording = false;
  const frame = (t: number): void => {
    const dt = Math.min(0.1, (t - last) / 1000);
    if (recording) intervals.push(t - last);
    last = t;
    const w = scene.world;
    renderer.debugDusk = Number(dusk.value);
    if (animate.checked) scene.puppet.advance(dt);
    if (w.events.length) renderer.handleEvents(w.events.splice(0), w);
    renderer.render(w, cam, ui, animate.checked ? scene.puppet.alpha : 0, dt);
    if (recording) samples.push(renderer.stats.frameMs);
    if (t - miniAt > 100) {
      miniAt = t;
      renderer.renderMinimap(mini, w, cam, ui);
      if (!recording) perfOut.textContent = `render ${renderer.stats.avgMs.toFixed(2)} ms avg\nunits drawn ${renderer.stats.units}\nparticles ${renderer.stats.particles}\nsprites ${renderer.stats.sprites}\nterrain build ${renderer.stats.terrainMs.toFixed(0)} ms`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  const perf = async (seconds = 4): Promise<{ avg: number; p95: number; max: number; fps: number; units: number; frames: number }> => {
    samples.length = 0;
    intervals.length = 0;
    recording = true;
    await new Promise((r) => setTimeout(r, seconds * 1000));
    recording = false;
    const sorted = [...samples].sort((a, b) => a - b);
    const avg = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const meanInt = intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);
    const res = { avg, p95, max, fps: 1000 / meanInt, units: scene.world.units.length, frames: samples.length };
    perfOut.textContent = `PERF ${seconds}s: avg ${avg.toFixed(2)} ms  p95 ${p95.toFixed(2)}  max ${max.toFixed(2)}\nfps ${res.fps.toFixed(1)}  units ${res.units}`;
    return res;
  };
  perfBtn.onclick = () => void perf(4);
  return {
    get scene() {
      return scene;
    },
    renderer,
    cam,
    ui,
    perf,
  } as SceneApi;
}

// ---------------------------------------------------------------------------
// Unit board
// ---------------------------------------------------------------------------

function unitsSection(): void {
  const s = section('units', 'Units', 'All 20 unit types for both owners, rendered by the real renderer on Greenmarch grass at zoom 0.75 / 1 / 1.5. Bottom rows: animation states.');
  const build = (): { world: World; labels: { x: number; y: number; text: string }[]; ui: BattleUIState } => {
    const map = grassMap(37, 17);
    const fb = new FixtureBuilder(map, boardSetup('greenmarch'));
    const labels: { x: number; y: number; text: string }[] = [];
    const placeRow = (types: readonly UnitId[], owner: Owner, y: number, facing: number): void => {
      let x = 1.2;
      for (const t of types) {
        const big = t === 'briar_regent' ? 3.6 : t === 'antlered_lord' ? 2.6 : UNITS[t].cls === 'cavalry' || UNITS[t].cls === 'siege' ? 2.3 : 2;
        x += big / 2;
        fb.unit(t, owner, x, y, { facing });
        labels.push({ x, y: y + (t === 'briar_regent' ? 1.6 : 0.65), text: UNITS[t].name.replace('The ', '') });
        x += big / 2 + 0.55;
      }
    };
    placeRow(PLAYER_UNIT_IDS, 0, 1.7, 0.5);
    placeRow(ENEMY_UNIT_IDS, 1, 5.2, Math.PI - 0.5);
    placeRow(PLAYER_UNIT_IDS, 1, 8.7, 0.5);
    placeRow(ENEMY_UNIT_IDS, 0, 12.2, Math.PI - 0.5);
    // States row.
    const y = 15.4;
    const st: { t: UnitId; o: Owner; label: string; f?: (u: ReturnType<FixtureBuilder['unit']>) => void }[] = [
      { t: 'tiller', o: 0, label: 'sack', f: (u) => (u.carry = { type: 'grain', amount: 10 }) },
      { t: 'tiller', o: 0, label: 'log', f: (u) => (u.carry = { type: 'timber', amount: 10 }) },
      { t: 'tiller', o: 0, label: 'ember', f: (u) => (u.carry = { type: 'ember', amount: 10 }) },
      { t: 'ashpike', o: 0, label: 'rank I', f: (u) => (u.rank = 1) },
      { t: 'bowman', o: 0, label: 'rank II', f: (u) => (u.rank = 2) },
      { t: 'courser', o: 0, label: 'rank III', f: (u) => (u.rank = 3) },
      { t: 'oathshield', o: 0, label: 'burning', f: (u) => (u.burns = [{ applierId: 0, dps: 2, remaining: 3 }]) },
      { t: 'ashpike', o: 0, label: 'rooted', f: (u) => (u.buffs = [{ id: 'rooted', until: 1e9 }]) },
      { t: 'bowman', o: 0, label: 'horn buff', f: (u) => (u.buffs = [{ id: 'rallying_horn', until: 1e9 }]) },
      { t: 'ashpike', o: 0, label: 'selected', f: (u) => (u.hp = 30) },
      { t: 'briarguard', o: 1, label: 'enemy sel.', f: (u) => (u.hp = 20) },
      { t: 'stagrider', o: 1, label: 'burning', f: (u) => (u.burns = [{ applierId: 0, dps: 2, remaining: 3 }]) },
      { t: 'thornhusk', o: 1, label: 'enrage', f: (u) => (u.buffs = [{ id: 'enrage', until: 1e9 }]) },
      { t: 'briar_regent', o: 1, label: 'warded', f: (u) => (u.untargetable = true) },
    ];
    let x = 1.4;
    const sel: number[] = [];
    for (const e of st) {
      const wdt = e.t === 'briar_regent' ? 3.6 : 2.1;
      x += wdt / 2;
      const u = fb.unit(e.t, e.o, x, e.t === 'briar_regent' ? y - 0.6 : y, { facing: e.o === 0 ? 0.5 : Math.PI - 0.5 });
      e.f?.(u);
      if (e.label.includes('sel')) sel.push(u.id);
      labels.push({ x, y: y + 0.65, text: e.label });
      x += wdt / 2 + 0.3;
    }
    fb.world.fog.state.fill(2);
    fb.world.fog.version++;
    const ui = createBattleUIState();
    ui.selection = sel;
    return { world: fb.world, labels, ui };
  };
  const row = el('div', { class: 'row' });
  for (const z of [0.75, 1, 1.5]) {
    const b = build();
    const card = el('div', { class: 'card' });
    card.append(el('div', { class: 'caption' }, `zoom ${z}`), renderBoard(b.world, z, b.labels, b.ui));
    row.append(card);
  }
  s.append(row);
  // Facings: 8 of the 16 buckets per type, in two rows of four.
  const fRow = el('div', { class: 'row' });
  const map = grassMap(37, 7);
  const fb = new FixtureBuilder(map, boardSetup('greenmarch'));
  const types: UnitId[] = ['ashpike', 'bowman', 'courser', 'destrier', 'gatebreaker', 'briarguard', 'spinecaster', 'stagrider', 'rootbreaker', 'thornling'];
  types.forEach((t, i) => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = 1.2 + (i % 5) * 7.2 + (k % 4) * 1.6;
      const y = 1.1 + Math.floor(i / 5) * 3.2 + (k < 4 ? 0 : 1.5);
      fb.unit(t, UNITS[t].side === 'player' ? 0 : 1, x, y, { facing: a });
    }
  });
  s.append(fRow);
}

// ---------------------------------------------------------------------------
// Building board
// ---------------------------------------------------------------------------

function buildingsSection(): void {
  const s = section('buildings', 'Buildings and resources', 'Player buildings (both owners), Thornwake structures, neutral objects, construction and damage states, resources. Real renderer, zoom 1.');
  const map = grassMap(49, 30);
  const fb = new FixtureBuilder(map, boardSetup('greenmarch'));
  const labels: { x: number; y: number; text: string }[] = [];
  const playerIds: BuildingId[] = ['hearth', 'cottage', 'storehouse', 'grainplot', 'muster_hall', 'bowyard', 'paddock', 'forgehall', 'brazier_tower', 'siegeyard'];
  const placeRow = (ids: readonly BuildingId[], owner: Owner, top: number, extra?: (id: BuildingId, b: ReturnType<FixtureBuilder['building']>) => void): void => {
    let x = 1;
    for (const id of ids) {
      const d = BUILDINGS[id];
      const b = fb.building(id, owner, x, top + Math.floor((4 - d.h) / 2));
      extra?.(id, b);
      labels.push({ x: x + d.w / 2, y: b.ty + d.h + 0.2, text: d.name });
      x += d.w + 2;
    }
  };
  fb.world.players[0].temper = 'barbed_heads';
  placeRow(playerIds, 0, 2, (id, b) => {
    if (id === 'grainplot') b.ripeness = 0.85;
    if (id === 'muster_hall') b.rally = { x: b.x + 2.5, y: b.y + 3.2 };
  });
  placeRow(playerIds, 1, 8, (id, b) => {
    if (id === 'grainplot') b.ripeness = 0.2;
  });
  // Thornwake + neutral row.
  let x = 1;
  const top = 14;
  const add = (id: BuildingId, owner: Owner, label: string, f?: (b: ReturnType<FixtureBuilder['building']>) => void): void => {
    const d = BUILDINGS[id];
    const b = fb.building(id, owner, x, top + Math.max(0, Math.floor((5 - d.h) / 2)));
    f?.(b);
    labels.push({ x: x + d.w / 2, y: b.ty + d.h + 0.2, text: label });
    x += d.w + 2;
  };
  add('thorn_nest', 1, 'Thorn Nest', (b) => (b.nest = { index: 0, spent: false, spentUntil: -1, blightRadius: 4, seen: true, musterProgress: 0.8 }));
  add('thorn_nest', 1, 'Nest (Spent)', (b) => (b.nest = { index: 1, spent: true, spentUntil: 99, blightRadius: 4, seen: true, musterProgress: 0 }));
  add('root_heart', 1, 'Root Heart', (b) => (b.nest = { index: 2, spent: false, spentUntil: -1, blightRadius: 4, seen: true, musterProgress: 0.3 }));
  add('thornspire', 1, 'Thornspire');
  add('briar_throne', 1, 'Briar Throne', (b) => (b.object = { kind: 'throne', done: false, progress: 0, lit: false }));
  add('ruined_cache', 2, 'Ruined Cache', (b) => (b.object = { kind: 'cache', done: false, progress: 0, lit: false }));
  add('ruined_cache', 2, 'looted', (b) => (b.object = { kind: 'cache', done: true, progress: 0, lit: false }));
  add('ancient_cache', 2, 'Ancient Cache', (b) => (b.object = { kind: 'cache', done: false, progress: 0, lit: false }));
  add('beacon_stone', 2, 'Beacon 60%', (b) => (b.object = { kind: 'beacon', done: false, progress: 0.6, lit: false }));
  add('beacon_stone', 2, 'Beacon lit', (b) => (b.object = { kind: 'beacon', done: true, progress: 1, lit: true }));
  // States row.
  x = 1;
  const top2 = 22;
  const add2 = (id: BuildingId, label: string, f: (b: ReturnType<FixtureBuilder['building']>) => void): void => {
    const d = BUILDINGS[id];
    const b = fb.building(id, 0, x, top2 + Math.floor((3 - d.h) / 2));
    f(b);
    labels.push({ x: x + d.w / 2, y: b.ty + d.h + 0.2, text: label });
    x += d.w + 2;
  };
  add2('muster_hall', 'build 10%', (b) => ((b.built = false), (b.buildProgress = 0.1)));
  add2('muster_hall', 'build 55%', (b) => ((b.built = false), (b.buildProgress = 0.55)));
  add2('cottage', 'build 90%', (b) => ((b.built = false), (b.buildProgress = 0.9)));
  add2('storehouse', 'HP 45% smoke', (b) => (b.hp = b.maxHp * 0.45));
  add2('bowyard', 'HP 20% fire', (b) => (b.hp = b.maxHp * 0.2));
  add2('grainplot', 'unripe', (b) => (b.ripeness = 0));
  add2('grainplot', 'ripe', (b) => (b.ripeness = 1));
  add2('brazier_tower', 'selected', () => undefined);
  // Resources.
  let rx = x;
  for (const [amt, label] of [
    [150, 'Thicket'],
    [75, 'half'],
    [12, 'nearly gone'],
  ] as const) {
    fb.resource('thicket', Math.floor(rx), top2 + 1, amt, 150);
    labels.push({ x: Math.floor(rx) + 0.5, y: top2 + 2.2, text: label });
    rx += 2;
  }
  fb.resource('ember_seam', Math.floor(rx), top2 + 0, 800, 800);
  labels.push({ x: Math.floor(rx) + 1, y: top2 + 2.2, text: 'Ember Seam' });
  rx += 3;
  // Trees and rocks for context.
  for (let ty = 26; ty < 30; ty++) for (let tx = 1; tx < 46; tx++) {
    const i = ty * map.w + tx;
    if (tx % 9 < 5) {
      map.terrain[i] = Terrain.Forest;
      map.treeAmount[i] = 120;
    } else if (tx % 9 === 6) map.terrain[i] = Terrain.Rock;
    else if (tx % 9 === 7 && ty > 27) map.terrain[i] = Terrain.Stump;
  }
  fb.world.fog.state.fill(2);
  fb.world.fog.version++;
  const ui = createBattleUIState();
  const tower = fb.world.buildings.filter((b) => b.type === 'brazier_tower').pop();
  const hall = fb.world.buildings.find((b) => b.type === 'muster_hall' && b.owner === 0);
  ui.selection = [tower?.id ?? 0, hall?.id ?? 0];
  const card = el('div', { class: 'card' });
  card.append(renderBoard(fb.world, 1, labels, ui, 4));
  s.append(card);
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function iconsSection(): void {
  const s = section('icons', 'Icons', 'drawIcon / iconUrl for every IconKind (both owners where it matters) at 24 / 32 / 48 / 64 px on the HUD panel color. Last block: extra research / ability / class keys.');
  const kinds: string[] = [...PLAYER_UNIT_IDS, ...ENEMY_UNIT_IDS, ...BUILDING_IDS, 'thicket', 'ember_seam', 'tree', 'grain', 'timber', 'ember', 'crowns', 'resolve', 'renown', 'pop'];
  const sizes = [24, 32, 48, 64];
  const make = (list: string[], owners: Owner[]): HTMLCanvasElement => {
    const cell = 72;
    const itemW = 196;
    const cols = 8;
    const perKind = owners.length;
    const rows = Math.ceil((list.length * perKind) / cols);
    const canvas = el('canvas');
    const W = cols * (itemW + 6) + 16;
    const H = rows * (cell + 14) + 8;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    sized(canvas, W, H);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#1A1612';
    ctx.fillRect(0, 0, W, H);
    let i = 0;
    for (const k of list) {
      for (const o of owners) {
        const cx = (i % cols) * (itemW + 6) + 8;
        const cy = Math.floor(i / cols) * (cell + 14) + 4;
        ctx.fillStyle = '#2A231C';
        ctx.fillRect(cx, cy, itemW, cell);
        let x = cx + 4;
        for (const sz of sizes) {
          drawIcon(ctx, k as IconKind, o, x + sz / 2, cy + cell / 2, sz);
          x += sz + 4;
        }
        ctx.fillStyle = '#A8987A';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'left';
        ctx.fillText(`${k}${owners.length > 1 ? ` (${o})` : ''}`, cx + 2, cy + cell + 10);
        i++;
      }
    }
    return canvas;
  };
  const unitBuildingKinds = kinds.filter((k) => k in UNITS || k in BUILDINGS);
  const other = kinds.filter((k) => !(k in UNITS || k in BUILDINGS));
  const c1 = el('div', { class: 'card' });
  c1.append(make(unitBuildingKinds, [0, 1]));
  const c2 = el('div', { class: 'card' });
  c2.append(make([...other, ...EXTRA_ICON_KEYS], [0]));
  s.append(c1, el('div', { style: 'height:12px' }), c2);
  // iconUrl smoke check (<img> elements).
  const imgs = el('div', { class: 'row card', style: 'margin-top:12px;align-items:center' });
  imgs.append(el('span', { class: 'muted' }, 'iconUrl <img>: '));
  for (const k of ['tiller', 'ashpike', 'bowman', 'courser', 'thorn_nest', 'hearth', 'grain', 'timber', 'ember', 'crowns', 'pop', 'ember_edge', 'rally_hearth', 'cls_cavalry'] as string[]) {
    const img = el('img', { src: iconUrl(k as IconKind, 0, 40), width: '40', height: '40', title: k });
    imgs.append(img);
  }
  s.append(imgs);
}

// ---------------------------------------------------------------------------
// Real generated worlds (mapgen + sim-core)
// ---------------------------------------------------------------------------

async function realSection(): Promise<void> {
  const s = section('real', 'Real generated worlds', 'generateMap + createWorld for each biome (only once the mapgen and sim-core modules are implemented).');
  try {
    const { generateMap } = await import('../mapgen');
    const { createWorld, stepWorld } = await import('../sim/world');
    const row = el('div', { class: 'row' });
    for (const biome of BIOME_IDS) {
      const card = el('div', { class: 'card' });
      try {
        const objective = biome === 'heartwood' ? 'boss' : 'raze';
        const gen = generateMap({ seed: 1234 + biome.length, objective, biome, depth: 3, modifiers: [] });
        const setup: BattleSetup = {
          ...boardSetup(biome),
          objective,
          isBoss: objective === 'boss',
          depth: objective === 'boss' ? 7 : 3,
          unlockedUnits: ['tiller', 'ashpike', 'bowman', 'courser'],
          unlockedBuildings: ['cottage', 'storehouse', 'grainplot', 'muster_hall', 'bowyard', 'paddock', 'forgehall', 'brazier_tower'],
        };
        const world = createWorld(setup, gen);
        for (let i = 0; i < 70; i++) stepWorld(world);
        const canvas = el('canvas');
        const W = 640;
        const H = 400;
        sized(canvas, W, H);
        const r = new CanvasRenderer(canvas);
        r.resize(W, H, dpr);
        const cam = new Camera();
        cam.setViewport(W, H);
        cam.bottomInset = 0;
        cam.topInset = 0;
        cam.setMapSize(world.map.w, world.map.h);
        cam.zoom = 0.75;
        const h = world.anchors.hearth;
        cam.centerOn(h.tx + 4, h.ty + 1);
        const ui = createBattleUIState();
        for (let i = 0; i < 3; i++) r.render(world, cam, ui, 0, 1 / 60);
        const mini = el('canvas');
        mini.width = 200 * dpr;
        mini.height = 200 * dpr;
        sized(mini, 200, 200);
        r.renderMinimap(mini, world, cam, ui);
        const wrap = el('div', { class: 'row' });
        wrap.append(canvas, mini);
        card.append(el('div', { class: 'caption' }, `${biome} · ${objective} · ${world.map.w}×${world.map.h} · ${world.units.length} units`), wrap);
      } catch (err) {
        card.append(el('div', { class: 'muted' }, `${biome}: not available (${(err as Error).message})`));
      }
      row.append(card);
    }
    s.append(row);
  } catch (err) {
    s.append(el('div', { class: 'muted' }, `modules not available: ${(err as Error).message}`));
  }
}


// ---------------------------------------------------------------------------
// Live battle (real mapgen + sim + encounter, real events)
// ---------------------------------------------------------------------------

async function liveSection(): Promise<void> {
  const s = section('live', 'Live battle (real simulation)', 'generateMap + createWorld + stepWorld at 20 Hz, a forced wave against a spawned army, Tillers gathering. Real GameEvents drive the fx. Camera follows the fight.');
  const canvas = el('canvas', { id: 'live-canvas' });
  const W = Number(params.get('w') ?? 1280);
  const H = Number(params.get('h') ?? 720);
  sized(canvas, W, H);
  const mini = el('canvas', { id: 'live-minimap' });
  mini.width = 160 * dpr;
  mini.height = 160 * dpr;
  sized(mini, 160, 160);
  const info = el('div', { id: 'live-info', style: 'font-family:ui-monospace,monospace;white-space:pre;font-size:12px' });
  const row = el('div', { class: 'row' });
  const side = el('div', { class: 'card' });
  side.append(mini, info);
  row.append(canvas, side);
  s.append(row);
  try {
    const { generateMap } = await import('../mapgen');
    const { createWorld, stepWorld, issueCommand, drainEvents } = await import('../sim/world');
    const { spawnUnit } = await import('../sim/entities');
    const { debugForceWave } = await import('../sim/encounter');
    const biome = (params.get('biome') ?? 'greenmarch') as BiomeId;
    const seed = Number(params.get('seed') ?? 11);
    const gen = generateMap({ seed, objective: 'raze', biome, depth: 4, modifiers: [] });
    const setup: BattleSetup = {
      ...boardSetup(biome),
      seed,
      depth: 4,
      house: 'grimbrand',
      unlockedUnits: ['tiller', 'ashpike', 'bowman', 'courser', 'oathshield', 'brandbow', 'destrier'],
      unlockedBuildings: ['cottage', 'storehouse', 'grainplot', 'muster_hall', 'bowyard', 'paddock', 'forgehall', 'brazier_tower'],
    };
    const world = createWorld(setup, gen);
    const hearth = world.buildings.find((b) => b.type === 'hearth');
    if (!hearth) throw new Error('no hearth');
    const nest = world.buildings.find((b) => b.type === 'thorn_nest');
    const dir = nest ? Math.atan2(nest.y - hearth.y, nest.x - hearth.x) : 0;
    // Army 7 tiles out toward the nearest Nest.
    const ax = hearth.x + Math.cos(dir) * 8;
    const ay = hearth.y + Math.sin(dir) * 8;
    const army: number[] = [];
    const types: UnitId[] = ['ashpike', 'ashpike', 'bowman', 'bowman', 'courser', 'oathshield', 'brandbow', 'destrier'];
    for (let i = 0; i < 32; i++) {
      const t = types[i % types.length];
      const u = spawnUnit(world, t, 0, ax + ((i % 6) - 2.5) * 0.9, ay + (Math.floor(i / 6) - 2.5) * 0.9, { silent: true, rank: (i % 7 === 0 ? 2 : 0) as 0 | 2 });
      army.push(u.id);
    }
    // Tillers to the nearest forest / thickets.
    const tillers = world.units.filter((u) => u.type === 'tiller');
    const thickets = world.resources.filter((r) => r.type === 'thicket');
    const forest: number[] = [];
    for (let i = 0; i < world.map.w * world.map.h; i++) if (world.map.terrain[i] === Terrain.Forest) forest.push(i);
    forest.sort((a, b) => Math.hypot((a % world.map.w) - hearth.x, Math.floor(a / world.map.w) - hearth.y) - Math.hypot((b % world.map.w) - hearth.x, Math.floor(b / world.map.w) - hearth.y));
    tillers.forEach((t, i) => {
      if (i % 2 === 0 && forest.length) issueCommand(world, { type: 'gather', unitIds: [t.id], target: { kind: 'tree', tile: forest[i] } });
      else if (thickets.length) issueCommand(world, { type: 'gather', unitIds: [t.id], target: { kind: 'node', id: thickets[i % thickets.length].id } });
    });
    for (let i = 0; i < 20 * 3; i++) stepWorld(world);
    debugForceWave(world, 6, 'swarm');
    issueCommand(world, { type: 'attackMove', unitIds: army, x: ax + Math.cos(dir) * 6, y: ay + Math.sin(dir) * 6 });
    const renderer = new CanvasRenderer(canvas);
    renderer.resize(W, H, dpr);
    const cam = new Camera();
    cam.setViewport(W, H);
    cam.setMapSize(world.map.w, world.map.h);
    cam.zoom = Number(params.get('zoom') ?? 1);
    cam.centerOn(ax, ay);
    const ui = createBattleUIState();
    ui.selection = army.slice(0, 10);
    let acc = 0;
    let last = performance.now();
    let miniAt = 0;
    let events = 0;
    const frame = (t: number): void => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      acc += dt;
      let steps = 0;
      while (acc >= 0.05 && steps < 4) {
        acc -= 0.05;
        stepWorld(world);
        steps++;
      }
      const ev = drainEvents(world);
      events += ev.length;
      renderer.handleEvents(ev, world);
      // Follow the military centroid.
      const mil = world.units.filter((u) => u.owner === 0 && u.cls !== 'worker');
      if (mil.length) {
        const cx = mil.reduce((a, u) => a + u.x, 0) / mil.length;
        const cy = mil.reduce((a, u) => a + u.y, 0) / mil.length;
        const cur = cam.screenToWorld(W / 2, (H - cam.bottomInset + cam.topInset) / 2);
        cam.centerOn(cur.x + (cx - cur.x) * 0.05, cur.y + (cy - cur.y) * 0.05);
      }
      renderer.render(world, cam, ui, Math.min(1, acc / 0.05), dt);
      if (t - miniAt > 100) {
        miniAt = t;
        renderer.renderMinimap(mini, world, cam, ui);
        info.textContent = `t ${world.time.toFixed(1)} s\nunits ${world.units.length}\nprojectiles ${world.projectiles.length}\nevents ${events}\nrender ${renderer.stats.avgMs.toFixed(2)} ms\nparticles ${renderer.stats.particles}`;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    (window as unknown as { __live: unknown }).__live = { world, renderer, cam, ui };
  } catch (err) {
    s.append(el('div', { class: 'muted' }, `live battle unavailable: ${(err as Error).message}`));
  }
}

// ---------------------------------------------------------------------------

root.append(el('h1', {}, 'EMBERMARCH · render gallery'));
root.append(el('div', { class: 'muted' }, `devicePixelRatio ${dpr}. Sections: scene, units, buildings, icons, real. Use ?only=<section>.`));
const api: Partial<SceneApi> & { ready?: boolean } = {};
(window as unknown as { __gallery: typeof api }).__gallery = api;
if (!only || only === 'scene') Object.defineProperties(api, Object.getOwnPropertyDescriptors(sceneSection()));
if (!only || only === 'units') unitsSection();
if (!only || only === 'buildings') buildingsSection();
if (!only || only === 'icons') iconsSection();
if (!only || only === 'real') await realSection();
if (only === 'live') await liveSection();
api.ready = true;
