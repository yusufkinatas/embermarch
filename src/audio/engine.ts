/**
 * WebAudio engine implementing AudioSystem. The AudioContext is created lazily in unlock()
 * (never at import time) so the module imports cleanly under Node; before unlock every call
 * is a cheap no-op apart from storing settings.
 *
 * Graph: voices → sfxBus ─┐
 *        horns  → hornBus ─┼→ master (volume / mute) → compressor → destination
 *        drums, wind → musicBus ─┘
 * sfxBus and musicBus duck under the horn. At most 8 SFX voices play at once (lowest priority /
 * oldest is stolen), the same sound plays at most once per 60 ms, and positional sounds fall off
 * with distance from the listener (silent at 30 tiles) and pan left/right.
 */
import type { Camera } from '../render/camera';
import type { AudioSystem, SfxName } from '../game/types';
import type { GameEvent, World } from '../sim/types';
import { ENEMY, PLAYER } from '../sim/types';
import { type SoundCue, eventToCues } from './cues';
import { MusicLayer } from './music';
import { RECIPES } from './recipes';

export const MAX_VOICES = 8;
/** Same sound at most once per this many seconds (GDD §P). */
export const MIN_REPEAT = 0.06;
/** Gain reaches 0 at this distance (tiles) from the listener. */
export const FALLOFF_TILES = 30;

/** Longer per-sound throttles for the noisiest streams (gathering, hits) and one-shot cues. */
const REPEAT: Partial<Record<SfxName, number>> = {
  chop: 0.14,
  mine: 0.16,
  harvest: 0.18,
  dropoff: 0.1,
  thorn_hit: 0.08,
  melee_hit: 0.07,
  bow_loose: 0.07,
  death_thorn: 0.08,
  acknowledge: 0.12,
  boss_slam: 0.3,
  boss_telegraph: 0.25,
  // One-shot cues: simultaneous musters (Great Wave) give one horn, and the jingle plays once even
  // when both the sim event and the battle shell request it.
  wave_horn: 1,
  wave_broken: 0.5,
  raid_alert: 0.8,
  nest_destroyed: 0.5,
  victory: 3,
  defeat: 3,
};

/** Voice priority: higher steals lower when all 8 voices are busy. */
const PRIORITY: Partial<Record<SfxName, number>> = {
  wave_horn: 4,
  wave_broken: 4,
  raid_alert: 4,
  victory: 4,
  defeat: 4,
  nest_destroyed: 3,
  boss_slam: 3,
  boss_telegraph: 3,
  beacon_lit: 3,
  beacon_snuffed: 3,
  building_destroyed: 2,
  build_complete: 2,
  unit_trained: 2,
  research_complete: 2,
  rank_up: 2,
  ui_click: 2,
  ui_error: 2,
  select: 2,
  acknowledge: 2,
  card_flip: 2,
  chop: 0,
  mine: 0,
  harvest: 0,
  dropoff: 0,
};

/** Played on the undimmed horn bus and duck everything else. */
const HORNS = new Set<SfxName>(['wave_horn', 'wave_broken', 'raid_alert']);
/** Heard everywhere (no distance falloff) even when they carry a position; still panned. */
const GLOBAL = new Set<SfxName>(['wave_horn', 'wave_broken', 'raid_alert', 'nest_destroyed', 'victory', 'defeat', 'beacon_lit', 'beacon_snuffed']);
/** Musical cues keep their pitch; everything else gets a slight random detune. */
const TUNED = new Set<SfxName>(['victory', 'defeat', 'build_complete', 'unit_trained', 'research_complete', 'rank_up', 'beacon_lit', 'beacon_snuffed', 'dropoff', 'acknowledge', 'select']);

const DUCK_LEVEL = 0.4;

interface Voice {
  name: SfxName;
  end: number;
  priority: number;
  gain: GainNode;
  pan: StereoPannerNode | null;
}

type AudioCtor = new () => AudioContext;

function audioContextCtor(): AudioCtor | null {
  const g = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class AudioEngine implements AudioSystem {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private hornBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private music: MusicLayer | null = null;
  private voices: Voice[] = [];
  private last = new Map<SfxName, number>();
  private listener = { x: 0, y: 0 };
  private volume = 0.8;
  private mutedFlag = false;
  private ambientWanted = false;
  private combatExplicitAt = -Infinity;
  private nextAutoCombat = 0;
  private duckUntil = 0;

  get muted(): boolean {
    return this.mutedFlag;
  }

  /** True once an AudioContext exists (after a successful unlock). */
  get ready(): boolean {
    return this.ac !== null;
  }

  /** SFX voices still sounding (debug / tests). */
  get voiceCount(): number {
    const now = this.ac ? this.ac.currentTime : 0;
    return this.voices.filter((v) => v.end > now).length;
  }

  /** Current listener position in tiles (debug / tests). */
  get listenerPos(): { x: number; y: number } {
    return { ...this.listener };
  }

  unlock(): void {
    if (this.ac) {
      if (this.ac.state === 'suspended') this.ac.resume().catch(() => undefined);
      return;
    }
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    let ac: AudioContext;
    try {
      ac = new Ctor();
    } catch {
      return;
    }
    this.ac = ac;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(ac.destination);
    this.master = ac.createGain();
    this.master.gain.value = this.mutedFlag ? 0 : this.volume;
    this.master.connect(comp);
    this.sfxBus = ac.createGain();
    this.hornBus = ac.createGain();
    this.musicBus = ac.createGain();
    this.sfxBus.connect(this.master);
    this.hornBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.noiseBuf = makeNoise(ac);
    this.music = new MusicLayer(ac, this.musicBus, this.noiseBuf);
    if (this.ambientWanted) this.music.setAmbient(true);
    if (ac.state === 'suspended') ac.resume().catch(() => undefined);
  }

  play(name: SfxName, opts?: { x?: number; y?: number; volume?: number; pitch?: number }): void {
    this.playCue({ name, ...opts });
  }

  /** Play one cue (distance falloff, throttle, voice cap). */
  playCue(cue: SoundCue): void {
    const ac = this.ac;
    if (!ac || !this.sfxBus || !this.hornBus || !this.noiseBuf || this.mutedFlag) return;
    const recipe = RECIPES[cue.name];
    if (!recipe) return;
    const now = ac.currentTime;
    const prev = this.last.get(cue.name);
    if (prev !== undefined && now - prev < (REPEAT[cue.name] ?? MIN_REPEAT)) return;

    let gain = cue.volume ?? 1;
    let pan = 0;
    if (cue.x !== undefined && cue.y !== undefined) {
      const dx = cue.x - this.listener.x;
      const dy = cue.y - this.listener.y;
      if (!GLOBAL.has(cue.name)) {
        const f = 1 - Math.hypot(dx, dy) / FALLOFF_TILES;
        if (f <= 0) return;
        gain *= Math.pow(f, 1.3);
      }
      pan = Math.max(-0.75, Math.min(0.75, dx / 20)) * (GLOBAL.has(cue.name) ? 0.5 : 1);
    }
    if (gain < 0.01) return;

    const priority = PRIORITY[cue.name] ?? 1;
    this.voices = this.voices.filter((v) => v.end > now);
    if (this.voices.length >= MAX_VOICES) {
      let victim = -1;
      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i];
        if (v.priority > priority) continue;
        if (victim < 0 || v.priority < this.voices[victim].priority || (v.priority === this.voices[victim].priority && v.end < this.voices[victim].end)) victim = i;
      }
      if (victim < 0 || (this.voices[victim].priority === priority && priority < 2)) return;
      this.stopVoice(this.voices[victim], now);
      this.voices.splice(victim, 1);
    }
    this.last.set(cue.name, now);

    const vg = ac.createGain();
    vg.gain.value = gain;
    let panNode: StereoPannerNode | null = null;
    const bus = HORNS.has(cue.name) ? this.hornBus : this.sfxBus;
    if (pan !== 0 && typeof ac.createStereoPanner === 'function') {
      panNode = ac.createStereoPanner();
      panNode.pan.value = pan;
      vg.connect(panNode);
      panNode.connect(bus);
    } else {
      vg.connect(bus);
    }
    const detune = TUNED.has(cue.name) ? 1 : 1 + (Math.random() - 0.5) * 0.07;
    const start = now + 0.005;
    const dur = recipe({ ac, out: vg, t: start, pitch: (cue.pitch ?? 1) * detune, noise: this.noiseBuf });
    const end = start + dur + 0.08;
    const voice: Voice = { name: cue.name, end, priority, gain: vg, pan: panNode };
    this.voices.push(voice);
    setTimeout(() => this.release(voice), Math.ceil((end - now) * 1000) + 60);
    if (HORNS.has(cue.name)) this.duck(now, dur);
  }

  handleEvents(events: GameEvent[], world: World, cam: Camera | null): void {
    if (!this.ac) return;
    if (cam) {
      const playH = cam.viewH - cam.bottomInset - cam.topInset;
      this.setListener(cam.x + cam.viewW / 2 / cam.scale, cam.y + (cam.topInset + playH / 2) / cam.scale);
    }
    for (const ev of events) {
      for (const cue of eventToCues(ev, world, events)) this.playCue(cue);
    }
    this.autoCombat(world);
  }

  setListener(x: number, y: number): void {
    this.listener.x = x;
    this.listener.y = y;
  }

  setCombatIntensity(v: number): void {
    if (this.ac) this.combatExplicitAt = this.ac.currentTime;
    this.music?.setCombat(v);
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    this.applyMaster();
  }

  setMuted(m: boolean): void {
    this.mutedFlag = m;
    this.applyMaster();
  }

  setAmbient(on: boolean): void {
    this.ambientWanted = on;
    this.music?.setAmbient(on);
  }

  private applyMaster(): void {
    if (!this.ac || !this.master) return;
    const now = this.ac.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(this.mutedFlag ? 0 : this.volume, now + 0.08);
  }

  /** Duck SFX and music under a horn for its duration, then recover. */
  private duck(now: number, dur: number): void {
    const until = now + dur;
    this.duckUntil = Math.max(this.duckUntil, until);
    for (const bus of [this.sfxBus, this.musicBus]) {
      if (!bus) continue;
      const g = bus.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.setTargetAtTime(DUCK_LEVEL, now, 0.06);
      g.setTargetAtTime(1, this.duckUntil, 0.3);
    }
  }

  private stopVoice(v: Voice, now: number): void {
    const g = v.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + 0.02);
    setTimeout(() => this.release(v), 60);
  }

  private release(v: Voice): void {
    try {
      v.gain.disconnect();
      v.pan?.disconnect();
    } catch {
      // already disconnected
    }
  }

  /**
   * Fallback combat-drum driver (GDD §P: 5+ enemies within 12 tiles of any player building)
   * used only while the battle shell is not calling setCombatIntensity itself.
   */
  private autoCombat(world: World): void {
    const ac = this.ac;
    if (!ac || !this.music || ac.currentTime - this.combatExplicitAt < 3) return;
    if (ac.currentTime < this.nextAutoCombat) return;
    this.nextAutoCombat = ac.currentTime + 0.5;
    const units = world?.units;
    const buildings = world?.buildings;
    if (!Array.isArray(units) || !Array.isArray(buildings) || world.outcome !== 'ongoing') {
      this.music.setCombat(0);
      return;
    }
    let near = 0;
    for (const u of units) {
      if (!u.alive || u.owner !== ENEMY) continue;
      for (const b of buildings) {
        if (!b.alive || b.owner !== PLAYER) continue;
        const dx = Math.max(b.tx - u.x, 0, u.x - (b.tx + b.w));
        const dy = Math.max(b.ty - u.y, 0, u.y - (b.ty + b.h));
        if (dx * dx + dy * dy <= 144) {
          near++;
          break;
        }
      }
      if (near >= 25) break;
    }
    this.music.setCombat(near >= 5 ? Math.min(1, 0.6 + (near - 5) / 25) : 0);
  }
}

/** One cached 2 s white-noise buffer shared by every noise recipe. */
function makeNoise(ac: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ac.sampleRate * 2);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
