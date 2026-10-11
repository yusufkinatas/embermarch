/**
 * Battle-shell dev harness (battle.html): mounts a quick battle without the app shell.
 * URL params: ?battle=raze|holdfast|elite|boss|beacons &depth=N &seed=N &house=ardent|tallow|grimbrand|lowmere
 *             &mods=blood_moon,thick_fog &boons=harvest_songs,... &hints=0
 * Test hooks: window.__battleResult (set by onEnd), window.__battleQuit (set by onQuitToTitle).
 */
import '../styles/theme.css';
import { HOUSES } from '../data/houses';
import { BOON_IDS, HOUSE_IDS, MODIFIER_IDS, OBJECTIVE_IDS } from '../data/ids';
import { OBJECTIVES } from '../data/objectives';
import { quickBattleSetup } from '../run';
import type { BattleResult, BattleSetup, BoonId, HouseId, ModifierId, ObjectiveId } from '../sim/types';
import { BattleController } from './battle';
import { h } from './dom';

type DevWindow = Window & { __battleResult?: BattleResult | null; __battleQuit?: boolean; __battle?: BattleController };

const params = new URLSearchParams(location.search);

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function list<T extends string>(value: string | null, allowed: readonly T[]): T[] {
  if (!value) return [];
  return value.split(',').filter((v): v is T => (allowed as readonly string[]).includes(v));
}

function readSetup(): BattleSetup {
  const objective = pick<ObjectiveId>(params.get('battle') ?? params.get('objective'), OBJECTIVE_IDS, 'raze');
  const depth = objective === 'boss' ? 7 : Math.max(1, Math.min(6, Number(params.get('depth')) || 1));
  const seed = Number(params.get('seed')) || 7;
  const house = pick<HouseId>(params.get('house'), HOUSE_IDS, 'ardent');
  const modifiers = list<ModifierId>(params.get('mods'), MODIFIER_IDS);
  const boons = list<BoonId>(params.get('boons'), BOON_IDS);
  try {
    return quickBattleSetup({ objective, depth, seed, house, modifiers, boons });
  } catch (err) {
    console.warn('[dev] quickBattleSetup unavailable, using a local setup', err);
    return fallbackSetup(objective, depth, seed, house, modifiers, boons);
  }
}

function fallbackSetup(objective: ObjectiveId, depth: number, seed: number, house: HouseId, modifiers: ModifierId[], boons: BoonId[]): BattleSetup {
  return {
    seed,
    nodeId: 'dev',
    objective,
    biome: objective === 'boss' ? 'heartwood' : 'greenmarch',
    depth,
    isElite: objective === 'elite',
    isBoss: objective === 'boss',
    modifiers,
    doctrine: 'swarm',
    tier: 0,
    house,
    vanguard: 'muster_hall',
    unlockedUnits: ['tiller', 'warden', 'ashpike', 'bowman', 'courser'],
    unlockedBuildings: ['hearth', 'cottage', 'storehouse', 'grainplot', 'muster_hall', 'bowyard', 'paddock', 'forgehall', 'brazier_tower'],
    playerEffects: [...HOUSES[house].effects],
    enemyEffects: [],
    boons,
    metaUnlocks: [],
    retinue: [],
    sellswords: [],
    wardenHpPct: 1,
    resolve: 3,
    waveMult: 1,
    coldWatchfire: false,
    showHints: true,
    bonusRes: {},
  };
}

const root = document.getElementById('battle') ?? document.body;
const w = window as DevWindow;
const hintsSeen: string[] = [];
let controller: BattleController | null = null;

function showEnd(result: BattleResult): void {
  const box = h('div', 'dev-end', root);
  const card = h('div', 'dev-end-card', box);
  h('div', 'dev-end-title', card, result.outcome.toUpperCase());
  h(
    'div',
    'dev-end-body',
    card,
    `${OBJECTIVES[result.objective].name} · ${Math.floor(result.time)} s · plunder ${result.plunderCrowns} · survivors ${result.survivors.length}`,
  );
  const again = h('button', 'dev-end-btn', card, 'Fight again');
  again.addEventListener('click', () => {
    box.remove();
    mount();
  });
}

function mount(): void {
  controller?.destroy();
  w.__battleResult = null;
  w.__battleQuit = false;
  const setup = readSetup();
  document.title = `Embermarch · ${OBJECTIVES[setup.objective].name} d${setup.depth}`;
  controller = new BattleController(
    root,
    setup,
    {
      onEnd: (result) => {
        w.__battleResult = result;
        console.info('[dev] battle ended', result);
        showEnd(result);
      },
      onQuitToTitle: () => {
        w.__battleQuit = true;
        controller?.destroy();
        controller = null;
        mount();
      },
      onHintSeen: (id) => {
        if (!hintsSeen.includes(id)) hintsSeen.push(id);
      },
    },
    { debug: true, hintsSeen, showHints: params.get('hints') !== '0' },
  );
  w.__battle = controller;
  controller.start();
}

const style = document.createElement('style');
style.textContent = `
  #battle { position: fixed; inset: 0; }
  .dev-end { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 50; background: rgba(0,0,0,.6); }
  .dev-end-card { background: #1a1612; border: 1px solid #a8783a; border-radius: 8px; padding: 20px 28px; text-align: center; color: #f4e6c1; font-family: var(--font-body); }
  .dev-end-title { font-family: var(--font-display); font-size: 28px; letter-spacing: .12em; color: #ffd27a; }
  .dev-end-body { margin: 8px 0 14px; color: #a8987a; }
  .dev-end-btn { font-family: var(--font-display); font-size: 14px; padding: 8px 16px; background: #3b2a16; color: #ffd27a; border: 1px solid #e8a33d; border-radius: 4px; cursor: pointer; }
`;
document.head.appendChild(style);

mount();
