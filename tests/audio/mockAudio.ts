/**
 * Minimal WebAudio mock for Node tests. AudioParams record their automation and, like real
 * WebAudio, reject exponential ramps to values <= 0.
 */
export interface ParamEvent {
  type: 'set' | 'linear' | 'exp' | 'target' | 'cancel';
  v: number;
  t: number;
}

export class MockParam {
  value: number;
  events: ParamEvent[] = [];
  inputs: MockNode[] = [];
  constructor(v: number) {
    this.value = v;
  }
  setValueAtTime(v: number, t: number): this {
    this.events.push({ type: 'set', v, t });
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this.events.push({ type: 'linear', v, t });
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    if (!(v > 0)) throw new RangeError(`exponential ramp to ${v}`);
    this.events.push({ type: 'exp', v, t });
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number, t: number, _c: number): this {
    this.events.push({ type: 'target', v, t });
    return this;
  }
  cancelScheduledValues(t: number): this {
    this.events.push({ type: 'cancel', v: this.value, t });
    return this;
  }
}

export class MockNode {
  outputs: (MockNode | MockParam)[] = [];
  readonly ctx: MockAudioContext;
  constructor(ctx: MockAudioContext) {
    this.ctx = ctx;
    ctx.nodes.push(this);
  }
  connect<T extends MockNode | MockParam>(n: T): T {
    this.outputs.push(n);
    if (n instanceof MockParam) n.inputs.push(this);
    return n;
  }
  disconnect(): void {
    this.outputs = [];
  }
}

export class MockSource extends MockNode {
  started = -1;
  stopped = -1;
  start(t = 0): void {
    if (this.started >= 0) throw new Error('started twice');
    this.started = t;
  }
  stop(t = 0): void {
    this.stopped = t;
  }
}

export class MockOsc extends MockSource {
  type = 'sine';
  frequency = new MockParam(440);
  detune = new MockParam(0);
}

export class MockBufferSource extends MockSource {
  buffer: MockBuffer | null = null;
  loop = false;
}

export class MockGain extends MockNode {
  gain = new MockParam(1);
}

export class MockFilter extends MockNode {
  type = 'lowpass';
  frequency = new MockParam(350);
  Q = new MockParam(1);
}

export class MockPanner extends MockNode {
  pan = new MockParam(0);
}

export class MockCompressor extends MockNode {
  threshold = new MockParam(-24);
  knee = new MockParam(30);
  ratio = new MockParam(12);
  attack = new MockParam(0.003);
  release = new MockParam(0.25);
}

export class MockBuffer {
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private readonly data: Float32Array;
  constructor(_ch: number, length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = new Float32Array(length);
  }
  getChannelData(_i: number): Float32Array {
    return this.data;
  }
}

export class MockAudioContext {
  static instances = 0;
  currentTime = 0;
  sampleRate = 4000;
  state: 'running' | 'suspended' = 'running';
  nodes: MockNode[] = [];
  destination: MockNode;
  constructor() {
    MockAudioContext.instances++;
    this.destination = new MockNode(this);
  }
  createOscillator(): MockOsc {
    return new MockOsc(this);
  }
  createGain(): MockGain {
    return new MockGain(this);
  }
  createBiquadFilter(): MockFilter {
    return new MockFilter(this);
  }
  createBufferSource(): MockBufferSource {
    return new MockBufferSource(this);
  }
  createStereoPanner(): MockPanner {
    return new MockPanner(this);
  }
  createDynamicsCompressor(): MockCompressor {
    return new MockCompressor(this);
  }
  createBuffer(ch: number, len: number, rate: number): MockBuffer {
    return new MockBuffer(ch, len, rate);
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
}

/** Install the mock as globalThis.AudioContext; returns an uninstall function. */
export function installMockAudio(): () => void {
  const g = globalThis as unknown as { AudioContext?: unknown };
  const prev = g.AudioContext;
  g.AudioContext = MockAudioContext;
  return () => {
    if (prev === undefined) delete g.AudioContext;
    else g.AudioContext = prev;
  };
}
