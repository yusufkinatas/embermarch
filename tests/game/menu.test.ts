import { describe, expect, it } from 'vitest';
import { quitCostText, retreatState } from '../../src/game/hud/pauseMenu';
import { hudScale } from '../../src/game/hud/hud';
import { battleState } from '../../src/game/debug';
import { createBattleUIState } from '../../src/game/types';
import { addBuilding, addUnit, makeSetup, makeWorld } from './helpers';

describe('Sound the Retreat availability (§B)', () => {
  it('unlocks at 3:00 and never in the boss battle', () => {
    const w = makeWorld();
    w.time = 179.9;
    expect(retreatState(w, w.setup).ok).toBe(false);
    expect(retreatState(w, w.setup).reason).toMatch(/3:00/);
    w.time = 180;
    expect(retreatState(w, w.setup).ok).toBe(true);
    const boss = makeSetup({ objective: 'boss', isBoss: true, depth: 7 });
    expect(retreatState(w, boss).ok).toBe(false);
    expect(retreatState(w, boss).reason).toMatch(/Briar Throne/);
  });

  it('is unavailable once the battle is decided', () => {
    const w = makeWorld();
    w.time = 300;
    w.outcome = 'victory';
    expect(retreatState(w, w.setup).ok).toBe(false);
  });
});

describe('Quit to Title cost text (§B Autosave)', () => {
  it('describes the Retreat cost outside the boss and the restart cost at the boss', () => {
    expect(quitCostText(makeSetup())).toMatch(/Retreat.*−1 Resolve/);
    expect(quitCostText(makeSetup({ objective: 'boss', isBoss: true }))).toMatch(/restarts.*−1 Resolve/);
  });
});

describe('HUD scale', () => {
  it('is 1 at 1280×720, grows with the viewport to 1.6 at 1440p (B11) and shrinks a little below 720p', () => {
    expect(hudScale(1280, 720)).toBe(1);
    expect(hudScale(1920, 1080)).toBe(1.5);
    expect(hudScale(2560, 1440)).toBe(1.6);
    expect(hudScale(3840, 2160)).toBe(1.6);
    expect(hudScale(1600, 900)).toBe(1.25);
    expect(hudScale(1024, 600)).toBe(0.85);
  });
});

describe('__game.state()', () => {
  it('reports resources, unit counts, Nests and the selection', () => {
    const w = makeWorld();
    addBuilding(w, 'hearth', 4, 4);
    addUnit(w, 'tiller', 5, 5);
    addUnit(w, 'tiller', 6, 5);
    const pike = addUnit(w, 'ashpike', 7, 5);
    addUnit(w, 'thornling', 20, 20, 1);
    addBuilding(w, 'thorn_nest', 20, 22, 1);
    const ui = createBattleUIState();
    ui.selection = [pike.id];
    const s = battleState(w, ui);
    expect(s.playerUnits).toEqual({ tiller: 2, ashpike: 1 });
    expect(s.enemyUnits).toBe(1);
    expect(s.nestsAlive).toBe(1);
    expect(s.res).toEqual({ grain: 250, timber: 300, ember: 75 });
    expect(s.selection).toEqual([pike.id]);
    expect(s.outcome).toBe('ongoing');
  });
});
