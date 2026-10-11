/** The audio module must import and idle safely under Node (no AudioContext at import time). */
import { describe, expect, it } from 'vitest';
import type { World } from '../../src/sim/types';
import { MockAudioContext, installMockAudio } from './mockAudio';

const fakeWorld = { units: [], buildings: [], outcome: 'ongoing', map: { w: 56, h: 56 } } as unknown as World;

describe('audio module in Node', () => {
  it('imports without touching an AudioContext', async () => {
    const uninstall = installMockAudio();
    try {
      const before = MockAudioContext.instances;
      const mod = await import('../../src/audio/sfx');
      expect(typeof mod.createAudio).toBe('function');
      const a = mod.createAudio();
      const shared = mod.getAudio();
      expect(mod.getAudio()).toBe(shared);
      expect(a.muted).toBe(false);
      expect(MockAudioContext.instances).toBe(before);
    } finally {
      uninstall();
    }
  });

  it('play / handleEvents / settings are no-ops before unlock', async () => {
    const { createAudio } = await import('../../src/audio/sfx');
    const a = createAudio();
    expect(() => {
      a.play('wave_horn');
      a.play('chop', { x: 3, y: 4, volume: 0.5, pitch: 1.2 });
      a.handleEvents([{ t: 'victory' }, { t: 'gather', unitId: 1, res: 'timber', source: 'tree', x: 1, y: 1 }], fakeWorld, null);
      a.setListener(10, 10);
      a.setCombatIntensity(1);
      a.setAmbient(true);
      a.setVolume(0.3);
      a.setMuted(true);
    }).not.toThrow();
    expect(a.muted).toBe(true);
    a.setMuted(false);
    expect(a.muted).toBe(false);
  });

  it('unlock without WebAudio (plain Node) stays a silent no-op', async () => {
    const { createAudio } = await import('../../src/audio/sfx');
    const a = createAudio();
    expect(() => a.unlock()).not.toThrow();
    expect(() => a.play('victory')).not.toThrow();
  });
});
