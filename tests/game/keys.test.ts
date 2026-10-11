import { describe, expect, it } from 'vitest';
import { resolveKey, shouldPreventDefault, type KeyInput } from '../../src/game/keys';

function k(code: string, mods: Partial<KeyInput> = {}): KeyInput {
  return { code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods };
}

describe('resolveKey (GDD §O, bound on e.code)', () => {
  it('maps global letters', () => {
    expect(resolveKey(k('KeyA'))).toEqual({ type: 'attackMove' });
    expect(resolveKey(k('KeyS'))).toEqual({ type: 'stop' });
    expect(resolveKey(k('KeyG'))).toEqual({ type: 'hold' });
    expect(resolveKey(k('KeyH'))).toEqual({ type: 'selectHearth' });
    expect(resolveKey(k('KeyM'))).toEqual({ type: 'mute' });
  });

  it('routes context letters to the command card with shift', () => {
    expect(resolveKey(k('KeyQ'))).toEqual({ type: 'card', letter: 'Q', shift: false });
    expect(resolveKey(k('KeyQ', { shiftKey: true }))).toEqual({ type: 'card', letter: 'Q', shift: true });
    for (const l of ['C', 'E', 'F', 'B', 'R', 'P', 'N', 'T', 'Y', 'W', 'Z', 'X', 'V']) {
      expect(resolveKey(k(`Key${l}`))).toEqual({ type: 'card', letter: l, shift: false });
    }
  });

  it('maps control groups', () => {
    expect(resolveKey(k('Digit3'))).toEqual({ type: 'group', n: 3, op: 'recall' });
    expect(resolveKey(k('Digit3', { ctrlKey: true }))).toEqual({ type: 'group', n: 3, op: 'assign' });
    expect(resolveKey(k('Digit3', { altKey: true }))).toEqual({ type: 'group', n: 3, op: 'assign' });
    expect(resolveKey(k('Digit3', { shiftKey: true }))).toEqual({ type: 'group', n: 3, op: 'add' });
    expect(resolveKey(k('Digit0'))).toBeNull();
  });

  it('maps special keys', () => {
    expect(resolveKey(k('Backquote'))).toEqual({ type: 'selectWarden' });
    expect(resolveKey(k('Period'))).toEqual({ type: 'idleTiller' });
    expect(resolveKey(k('Comma'))).toEqual({ type: 'allMilitary' });
    expect(resolveKey(k('Space'))).toEqual({ type: 'jumpAlert' });
    expect(resolveKey(k('Tab'))).toEqual({ type: 'counterWheel' });
    expect(resolveKey(k('F2'))).toEqual({ type: 'pause' });
    expect(resolveKey(k('Pause'))).toEqual({ type: 'pause' });
    expect(resolveKey(k('Minus'))).toEqual({ type: 'speed', dir: -1 });
    expect(resolveKey(k('Equal'))).toEqual({ type: 'speed', dir: 1 });
    expect(resolveKey(k('Delete'))).toEqual({ type: 'delete' });
    expect(resolveKey(k('Backspace'))).toEqual({ type: 'delete' });
    expect(resolveKey(k('Escape'))).toEqual({ type: 'escape' });
  });

  it('leaves Cmd/Ctrl browser shortcuts alone', () => {
    expect(resolveKey(k('KeyR', { metaKey: true }))).toBeNull();
    expect(resolveKey(k('KeyR', { ctrlKey: true }))).toBeNull();
  });

  it('prevents defaults for Space/Tab/Backquote/F2 and group assigns', () => {
    for (const code of ['Space', 'Tab', 'Backquote', 'F2']) {
      expect(shouldPreventDefault(k(code), resolveKey(k(code)))).toBe(true);
    }
    const alt1 = k('Digit1', { altKey: true });
    expect(shouldPreventDefault(alt1, resolveKey(alt1))).toBe(true);
    const cmdR = k('KeyR', { metaKey: true });
    expect(shouldPreventDefault(cmdR, resolveKey(cmdR))).toBe(false);
  });
});
