/** Engine behaviour against a WebAudio mock: recipes, voice cap, throttle, falloff, ducking, settings. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AudioEngine, FALLOFF_TILES, MAX_VOICES, SFX_NAMES } from '../../src/audio/sfx';
import { RECIPES } from '../../src/audio/recipes';
import type { World } from '../../src/sim/types';
import { MockAudioContext, MockBuffer, MockGain, MockParam, MockSource, installMockAudio } from './mockAudio';

let uninstall: () => void = () => undefined;
beforeEach(() => {
  uninstall = installMockAudio();
});
afterEach(() => uninstall());

function ctxOf(e: AudioEngine): MockAudioContext {
  return (e as unknown as { ac: MockAudioContext }).ac;
}

describe('recipes', () => {
  it('exist for every SfxName', () => {
    expect(Object.keys(RECIPES).sort()).toEqual([...SFX_NAMES].sort());
  });

  for (const name of SFX_NAMES) {
    it(`${name}: schedules click-free envelopes and stops every source`, () => {
      const ac = new MockAudioContext();
      const out = ac.createGain();
      const noise = new MockBuffer(1, 8000, 4000);
      const start = 1;
      const dur = RECIPES[name]({ ac: ac as unknown as BaseAudioContext, out: out as unknown as AudioNode, t: start, pitch: 1, noise: noise as unknown as AudioBuffer });
      expect(dur).toBeGreaterThan(0);
      expect(dur).toBeLessThan(3);
      const sources = ac.nodes.filter((n): n is MockSource => n instanceof MockSource);
      expect(sources.length).toBeGreaterThan(0);
      for (const s of sources) {
        expect(s.started).toBeGreaterThanOrEqual(start);
        expect(s.stopped).toBeGreaterThan(s.started);
        expect(s.stopped).toBeLessThanOrEqual(start + dur + 0.1);
      }
      // Amplitude envelopes (gains feeding audio, not modulation) start and end silent.
      const envs = ac.nodes.filter((n): n is MockGain => n instanceof MockGain && n !== out && n.gain.events.length > 0 && !n.outputs.some((o) => o instanceof MockParam));
      expect(envs.length).toBeGreaterThan(0);
      for (const g of envs) {
        const ev = g.gain.events;
        expect(ev[0].v, `${name} envelope start`).toBeLessThanOrEqual(0.001);
        expect(ev[ev.length - 1].v, `${name} envelope end`).toBeLessThanOrEqual(0.001);
        expect(ev[ev.length - 1].t).toBeLessThanOrEqual(start + dur + 0.05);
        for (let i = 1; i < ev.length; i++) expect(ev[i].t).toBeGreaterThanOrEqual(ev[i - 1].t);
        expect(Math.max(...ev.map((e) => e.v))).toBeLessThanOrEqual(0.7);
      }
    });
  }
});

describe('AudioEngine', () => {
  const world = { units: [], buildings: [], outcome: 'ongoing', map: { w: 56, h: 56 } } as unknown as World;

  it('creates the AudioContext lazily, once, in unlock()', () => {
    const before = MockAudioContext.instances;
    const e = new AudioEngine();
    expect(MockAudioContext.instances).toBe(before);
    e.play('victory');
    expect(MockAudioContext.instances).toBe(before);
    e.unlock();
    e.unlock();
    expect(MockAudioContext.instances).toBe(before + 1);
    expect(e.ready).toBe(true);
  });

  it('limits voices to 8 and lets important sounds steal', () => {
    const e = new AudioEngine();
    e.unlock();
    const names = SFX_NAMES.filter((n) => n !== 'wave_horn');
    for (const n of names) e.play(n);
    expect(e.voiceCount).toBe(MAX_VOICES);
    e.play('wave_horn');
    expect(e.voiceCount).toBe(MAX_VOICES);
    const voices = (e as unknown as { voices: { name: string }[] }).voices;
    expect(voices.some((v) => v.name === 'wave_horn')).toBe(true);
  });

  it('plays the same sound at most once per 60 ms', () => {
    const e = new AudioEngine();
    e.unlock();
    const ac = ctxOf(e);
    e.play('ui_click');
    e.play('ui_click');
    expect(e.voiceCount).toBe(1);
    ac.currentTime += 0.03;
    e.play('ui_click');
    expect(e.voiceCount).toBe(1);
    ac.currentTime += 0.04;
    e.play('ui_click');
    expect(e.voiceCount).toBe(2);
  });

  it('falls off with distance from the listener (silent at 30 tiles)', () => {
    const e = new AudioEngine();
    e.unlock();
    e.setListener(10, 10);
    e.play('death_player', { x: 10 + FALLOFF_TILES + 0.5, y: 10 });
    expect(e.voiceCount).toBe(0);
    e.play('death_player', { x: 20, y: 10 });
    expect(e.voiceCount).toBe(1);
    const v = (e as unknown as { voices: { gain: MockGain }[] }).voices[0];
    expect(v.gain.gain.value).toBeCloseTo(Math.pow(1 - 10 / FALLOFF_TILES, 1.3), 5);
  });

  it('ducks SFX and music under the horn', () => {
    const e = new AudioEngine();
    e.unlock();
    e.play('wave_horn');
    const sfxBus = (e as unknown as { sfxBus: MockGain }).sfxBus;
    const targets = sfxBus.gain.events.filter((ev) => ev.type === 'target').map((ev) => ev.v);
    expect(targets[0]).toBeLessThan(0.5);
    expect(targets[targets.length - 1]).toBe(1);
  });

  it('mute silences new sounds; volume applies to the master gain', () => {
    const e = new AudioEngine();
    e.setVolume(0.5);
    e.unlock();
    const master = (e as unknown as { master: MockGain }).master;
    expect(master.gain.value).toBe(0.5);
    e.setMuted(true);
    expect(e.muted).toBe(true);
    e.play('victory');
    expect(e.voiceCount).toBe(0);
    expect(master.gain.events.at(-1)?.v).toBe(0);
    e.setMuted(false);
    e.play('victory');
    expect(e.voiceCount).toBe(1);
  });

  it('handleEvents maps sim events and follows the camera', () => {
    const e = new AudioEngine();
    e.unlock();
    const cam = { x: 0, y: 0, zoom: 1, scale: 32, viewW: 1280, viewH: 720, bottomInset: 170, topInset: 32 };
    e.handleEvents([{ t: 'waveMuster', wave: 1, nestId: 1, x: 40, y: 40 }, { t: 'victory' }], world, cam as never);
    expect(e.listenerPos.x).toBeCloseTo(20);
    expect(e.voiceCount).toBe(2);
  });

  it('drives the combat drums and ambient bed', () => {
    const e = new AudioEngine();
    e.unlock();
    e.setAmbient(true);
    e.setCombatIntensity(1);
    const music = (e as unknown as { music: { ambientOn: boolean; drumsActive: boolean } }).music;
    expect(music.ambientOn).toBe(true);
    expect(music.drumsActive).toBe(true);
    e.setCombatIntensity(0);
    e.setAmbient(false);
    expect(music.ambientOn).toBe(false);
  });
});
