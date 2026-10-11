/**
 * Encounter integration with the real mapgen, sim-core and nav (createWorld + stepWorld).
 */
import { describe, expect, it } from 'vitest';
import { firstWaveLaunch, nestFactor, regentHp, waveValue } from '../../src/data/balance';
import { UNITS } from '../../src/data/units';
import { debugForceWave, getEncounterResult, getEncounterView } from '../../src/sim/encounter';
import { getState } from '../../src/sim/encounter/state';
import { computeDamagePacket } from '../../src/sim/combat';
import { killEntity, spawnUnit } from '../../src/sim/entities';
import { spawnProjectile } from '../../src/sim/projectiles';
import { buildBattleResult, stepWorld } from '../../src/sim/world';
import { ENEMY, PLAYER, type Building, type Unit, type World } from '../../src/sim/types';
import { enemies, hearthCenter, realWorld, runTo } from './helpers';

const value = (us: Unit[]) => us.reduce((s, u) => s + (UNITS[u.type].value ?? 0), 0);
const nestsOf = (w: World) => w.buildings.filter((b) => b.alive && (b.type === 'thorn_nest' || b.type === 'root_heart'));

describe('encounter on a real map', () => {
  it('Raze d1: wave 1 musters at T1 − 30, launches at T1 and walks to the Hearth', () => {
    const w = realWorld({ objective: 'raze', depth: 1, seed: 11 });
    const T1 = firstWaveLaunch(1);
    runTo(w, T1 - 30 - 0.2);
    expect(enemies(w, 'wave')).toHaveLength(0);
    runTo(w, T1 - 30 + 0.2);
    const muster = enemies(w, 'wave');
    expect(value(muster)).toBe(waveValue(1, 1));
    expect(getEncounterView(w).horn?.phase).toBe('muster');
    runTo(w, T1 + 0.2);
    expect(getEncounterView(w).horn?.phase).toBe('advancing');
    const h = hearthCenter(w);
    const startD = Math.min(...enemies(w, 'wave').map((u) => Math.hypot(u.x - h.x, u.y - h.y)));
    let closest = startD;
    runTo(w, T1 + 30, (ww) => {
      for (const u of enemies(ww, 'wave')) closest = Math.min(closest, Math.hypot(u.x - h.x, u.y - h.y));
    });
    expect(startD).toBeGreaterThan(15);
    expect(closest).toBeLessThan(8);
  });

  it('a Nest kill sets N and the next wave shrinks', () => {
    const w = realWorld({ objective: 'raze', depth: 2, seed: 12 });
    runTo(w, 1);
    const killer = w.units.find((u) => u.owner === PLAYER && u.type === 'courser')!;
    const nest = nestsOf(w)[0];
    const st = getState(w)!;
    // Kill the Nest that would host wave 1 so the muster lands on the survivor.
    const next = st.nests.find((n) => n.alive)!;
    killEntity(w, w.entities.get(next.id)!, killer.id);
    void nest;
    runTo(w, 2);
    const ev = getEncounterView(w);
    expect(ev.nests.filter((n) => !n.alive)).toHaveLength(1);
    expect(ev.trackerText.startsWith('Nests 1/2')).toBe(true);
    runTo(w, firstWaveLaunch(2) - 30 + 0.2);
    const wave = enemies(w, 'wave').filter((u) => u.ai?.wave === 1);
    expect(value(wave)).toBe(waveValue(1, 2, nestFactor(1, 2)));
    // The dead Nest's Blight recedes to nothing.
    runTo(w, 8);
    const src = st.blight.find((s) => s.entityId === next.id)!;
    expect(src.gone).toBe(true);
  });

  it('Raze victory when every Nest falls; the result carries plunder and par', () => {
    const w = realWorld({ objective: 'raze', depth: 1, seed: 13, modifiers: ['fortified_nests'] });
    runTo(w, 5);
    for (const n of nestsOf(w)) killEntity(w, n, 0);
    runTo(w, 6);
    expect(w.outcome).toBe('victory');
    const r = buildBattleResult(w, 'victory');
    expect(r.nestsDestroyed).toBe(2);
    expect(r.plunderCrowns).toBe(40);
    expect(r.underPar).toBe(true);
  });

  it("a Nest's Thornspires wither 2 s after it dies; Picket spires stay", () => {
    const w = realWorld({ objective: 'raze', depth: 1, seed: 13, modifiers: ['fortified_nests'] });
    runTo(w, 5);
    const st = getState(w)!;
    const nest = st.nests[0];
    expect(nest.spires).toHaveLength(2);
    const pickets = st.pickets.map((p) => p.spireId);
    killEntity(w, w.entities.get(nest.id)!, 0);
    runTo(w, 6.5);
    expect(nest.spires.every((id) => w.entities.get(id)?.alive)).toBe(true);
    runTo(w, 7.5);
    expect(nest.spires.some((id) => w.entities.get(id)?.alive)).toBe(false);
    expect(pickets.every((id) => w.entities.get(id)?.alive)).toBe(true);
  });

  it('Holdfast completes after six waves once every wave unit is dead', () => {
    const w = realWorld({ objective: 'holdfast', depth: 1, seed: 14 });
    w.debug.invulnerablePlayer = true;
    let launches = 0;
    runTo(w, 300, (ww) => {
      for (const e of ww.events) if (e.t === 'waveLaunch') launches++;
      ww.events.length = 0;
      // Break each wave shortly after launch.
      const st = getState(ww)!;
      for (const wave of st.waves) {
        if (wave.phase === 'advancing' && ww.tick - wave.launchTick === 20) {
          for (const id of wave.members) {
            const u = ww.entities.get(id);
            if (u && u.alive) killEntity(ww, u, 0);
          }
        }
      }
    });
    expect(w.outcome).toBe('victory');
    expect(launches).toBeGreaterThanOrEqual(7); // 5 + Great Wave from 2 Nests
    expect(getEncounterView(w).trackerText).toBe('Waves 6/6');
    const r = buildBattleResult(w, 'victory');
    expect(r.unbroken).toBe(true);
  });

  it('boss: Root Hearts down → phase 2, the Regent leaves the Throne and marches', () => {
    const w = realWorld({ objective: 'boss', seed: 15 });
    w.debug.invulnerablePlayer = true;
    runTo(w, 2);
    const regent = w.units.find((u) => u.type === 'briar_regent')!;
    expect(regent.untargetable).toBe(true);
    expect(getEncounterView(w).trackerText).toMatch(/^Burn the Root Hearts 0\/3 · Wrath [78]:\d\d$/);
    for (const n of nestsOf(w)) killEntity(w, n, 0);
    runTo(w, 3);
    expect(getEncounterView(w).boss).toMatchObject({ phase: 2, warded: false });
    expect(regent.untargetable).toBe(false);
    expect(regent.maxHp).toBe(regentHp(0));
    const h = hearthCenter(w);
    const d0 = Math.hypot(regent.x - h.x, regent.y - h.y);
    runTo(w, 25);
    const d1 = Math.hypot(regent.x - h.x, regent.y - h.y);
    expect(d1).toBeLessThan(d0 - 10);
  });

  it('beacons: guarded stones wake at 1:30, light after 10 s, score Kindling and Ember', () => {
    const w = realWorld({ objective: 'beacons', depth: 2, seed: 17 });
    w.debug.invulnerablePlayer = true;
    runTo(w, 1);
    const st = getState(w)!;
    expect(st.beacons).toHaveLength(3);
    expect(enemies(w, 'beacon_guard').length).toBeGreaterThanOrEqual(3);
    const b = st.beacons[0];
    for (const id of b.guards) {
      const g = w.entities.get(id);
      if (g && g.alive) killEntity(w, g, 0);
    }
    const tiller = w.units.find((u) => u.owner === PLAYER && u.type === 'tiller')!;
    tiller.x = tiller.prevX = b.x + 1.6;
    tiller.y = tiller.prevY = b.y;
    // Keep the Tiller parked next to the stone.
    const park = (ww: World) => {
      tiller.x = b.x + 1.6;
      tiller.y = b.y;
      tiller.order = { type: 'hold' };
      tiller.move = null;
      for (const id of b.guards) {
        const g = ww.entities.get(id);
        if (g && g.alive) killEntity(ww, g, 0);
      }
    };
    runTo(w, 89, park);
    expect(b.lit).toBe(false);
    runTo(w, 101, park);
    expect(b.lit).toBe(true);
    const ember0 = w.players[PLAYER].res.ember;
    runTo(w, 131, park);
    // Wave 1 (launch 1:42) marches on the lit Beacon and contests it, so Kindling stalls meanwhile.
    expect(getEncounterView(w).kindling!.value).toBeGreaterThanOrEqual(10);
    expect(w.players[PLAYER].res.ember).toBeGreaterThanOrEqual(ember0 + 8);
    const wave1 = st.waves.find((x) => x.n === 1);
    if (wave1) expect(wave1.targetRule === 'objective' || wave1.targetRule === 'hearth').toBe(true);
    expect(w.vision.some((v) => v.tag === `beacon:${b.id}`)).toBe(true);
  });

  it('elite: the Lord rides with wave 3', () => {
    const w = realWorld({ objective: 'elite', depth: 3, seed: 16 });
    w.debug.invulnerablePlayer = true;
    runTo(w, 1);
    const lord = w.units.find((u) => u.type === 'antlered_lord')!;
    const p0 = { x: lord.x, y: lord.y };
    debugForceWave(w, 3);
    runTo(w, 15);
    expect(getState(w)!.lord!.joined).toBe(true);
    expect(Math.hypot(lord.x - p0.x, lord.y - p0.y)).toBeGreaterThan(5);
  });
});

describe('stability and performance', () => {
  for (const objective of ['raze', 'holdfast', 'elite', 'beacons', 'boss'] as const) {
    it(`${objective} d6: 10 simulated minutes without errors, caps respected, encounter cheap`, () => {
      const w = realWorld({
        objective,
        depth: 6,
        seed: 21,
        tier: 3,
        modifiers: objective === 'boss' ? [] : ['blood_moon', 'creeping_wake'],
      });
      w.debug.invulnerablePlayer = true;
      // A small defending army so fights happen.
      const h = hearthCenter(w);
      for (let i = 0; i < 12; i++) spawnUnit(w, i % 3 === 0 ? 'bowman' : 'ashpike', PLAYER, h.x + 3 + (i % 4) * 0.7, h.y + 3 + Math.floor(i / 4) * 0.7);
      let maxWave = 0;
      let maxTotal = 0;
      let ticks = 0;
      let total = 0;
      let worst = 0;
      while (w.countdown > 0) stepWorld(w);
      while (w.time < 600 && w.outcome === 'ongoing') {
        const t0 = performance.now();
        stepWorld(w);
        const dt = performance.now() - t0;
        total += dt;
        worst = Math.max(worst, dt);
        ticks++;
        if (ticks % 20 === 0) {
          const e = enemies(w);
          maxTotal = Math.max(maxTotal, e.length);
          maxWave = Math.max(maxWave, e.filter((u) => ['wave', 'raid', 'summon', 'noble'].includes(u.ai?.role ?? '')).length);
          getEncounterView(w);
        }
        w.events.length = 0;
      }
      expect(maxWave).toBeLessThanOrEqual(50);
      expect(maxTotal).toBeLessThanOrEqual(80);
      expect(getEncounterResult(w)).not.toBeNull();
      // Whole-sim average tick well under budget (generous for CI noise).
      expect(total / ticks).toBeLessThan(4);
      console.log(`${objective}: ${ticks} ticks, avg ${(total / ticks).toFixed(3)} ms, worst ${worst.toFixed(1)} ms, max enemies ${maxTotal}, max wave pool ${maxWave}, outcome ${w.outcome} @${w.time.toFixed(0)}s`);
    });
  }
});

describe('same-tick outcome: victory is checked before defeat', () => {
  /** A projectile from `src` already touching `target`, so it lands in the next tick's step 7. */
  function lethalShot(w: World, kind: 'arrow' | 'spine', src: Unit, target: Building): void {
    const p = spawnProjectile(w, kind, src, target, target.x, target.y, computeDamagePacket(w, src, target));
    p.x = target.tx - 0.05;
    p.y = target.y;
  }

  for (const spineFirst of [true, false]) {
    it(`Raze: the last Nest and the Hearth fall in the same tick → victory (${spineFirst ? 'Hearth hit first' : 'Nest hit first'})`, () => {
      const w = realWorld({ objective: 'raze', depth: 1, seed: 7 });
      runTo(w, 1);
      const nests = nestsOf(w);
      expect(nests.length).toBeGreaterThanOrEqual(2);
      for (const n of nests.slice(1)) killEntity(w, n, 0);
      stepWorld(w);
      expect(w.outcome).toBe('ongoing');
      const last = nests[0];
      const h = w.entities.get(w.hearthId) as Building;
      last.hp = 1;
      h.hp = 1;
      const bow = spawnUnit(w, 'bowman', PLAYER, last.tx - 3, last.y);
      const caster = spawnUnit(w, 'spinecaster', ENEMY, h.tx - 3, h.y);
      if (spineFirst) lethalShot(w, 'spine', caster, h);
      lethalShot(w, 'arrow', bow, last);
      if (!spineFirst) lethalShot(w, 'spine', caster, h);
      stepWorld(w);
      stepWorld(w);
      expect(last.alive).toBe(false);
      expect(h.alive).toBe(false);
      expect(w.outcome).toBe('victory');
      expect(buildBattleResult(w, 'victory').nestsDestroyed).toBe(nests.length);
    });
  }

  it('Raze: the Hearth falling while a Nest still stands is a defeat', () => {
    const w = realWorld({ objective: 'raze', depth: 1, seed: 7 });
    runTo(w, 1);
    const h = w.entities.get(w.hearthId) as Building;
    h.hp = 1;
    lethalShot(w, 'spine', spawnUnit(w, 'spinecaster', ENEMY, h.tx - 3, h.y), h);
    stepWorld(w);
    stepWorld(w);
    expect(h.alive).toBe(false);
    expect(nestsOf(w).length).toBeGreaterThan(0);
    expect(w.outcome).toBe('defeat');
  });

  it('Boss: the Regent slain earlier in the tick means no Last Stand is spent', () => {
    const w = realWorld({ objective: 'boss', seed: 7 });
    runTo(w, 1);
    const regent = w.entities.get(getState(w)!.boss!.id) as Unit;
    regent.untargetable = false;
    regent.invulnerable = false;
    regent.hp = 1;
    const h = w.entities.get(w.hearthId) as Building;
    h.hp = 1;
    const bow = spawnUnit(w, 'bowman', PLAYER, regent.x - 3, regent.y);
    const caster = spawnUnit(w, 'spinecaster', ENEMY, h.tx - 3, h.y);
    const arrow = spawnProjectile(w, 'arrow', bow, regent, regent.x, regent.y, computeDamagePacket(w, bow, regent));
    arrow.x = regent.x - regent.radius - 0.05;
    arrow.y = regent.y;
    lethalShot(w, 'spine', caster, h);
    stepWorld(w);
    stepWorld(w);
    expect(regent.alive).toBe(false);
    expect(w.lastStandsUsed).toBe(0);
    expect(w.outcome).toBe('victory');
  });
});
