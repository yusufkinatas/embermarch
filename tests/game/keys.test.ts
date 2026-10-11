import { afterEach, describe, expect, it } from 'vitest';
import { hotkeyLabel, learnKeyLayout, letterFor, loadKeyboardLayout, resolveKey, setKeyboardLayout, shouldPreventDefault, type KeyInput } from '../../src/game/keys';

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
    expect(resolveKey(k('Backquote'))).toEqual({ type: 'selectWarden', add: false });
    expect(resolveKey(k('Backquote', { shiftKey: true }))).toEqual({ type: 'selectWarden', add: true });
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

describe('hotkey labels follow the keyboard layout (B14)', () => {
  afterEach(() => setKeyboardLayout(null));

  it('without a layout map, labels are the QWERTY letters', () => {
    expect(hotkeyLabel('Z')).toBe('Z');
    expect(hotkeyLabel('Y')).toBe('Y');
    expect(hotkeyLabel('`')).toBe('`');
    expect(hotkeyLabel('− / =')).toBe('− / =');
    expect(letterFor('KeyA')).toBe('A');
  });

  it('QWERTZ: the research key bound to KeyZ is printed as Y (and Siegeyard KeyY as Z)', () => {
    setKeyboardLayout(new Map([['KeyZ', 'y'], ['KeyY', 'z'], ['Backquote', '^']]));
    expect(hotkeyLabel('Z')).toBe('Y');
    expect(hotkeyLabel('Y')).toBe('Z');
    expect(hotkeyLabel('Q')).toBe('Q'); // not in the map: QWERTY fallback
    expect(hotkeyLabel('`')).toBe('^');
    // Bindings stay on e.code: KeyZ still resolves to the 'Z' card letter.
    expect(resolveKey(k('KeyZ'))).toEqual({ type: 'card', letter: 'Z', shift: false });
  });

  it('reads navigator.keyboard.getLayoutMap once; no keyboard API leaves labels unchanged', async () => {
    expect(await loadKeyboardLayout({})).toBe(false);
    expect(hotkeyLabel('A')).toBe('A');
    const azerty = new Map([['KeyA', 'q'], ['KeyQ', 'a'], ['KeyW', 'z'], ['KeyZ', 'w']]);
    expect(await loadKeyboardLayout({ keyboard: { getLayoutMap: async () => azerty } })).toBe(true);
    expect(hotkeyLabel('A')).toBe('Q');
    expect(hotkeyLabel('Q')).toBe('A');
    expect(await loadKeyboardLayout({ keyboard: { getLayoutMap: () => Promise.reject(new Error('denied')) } })).toBe(false);
  });
});

describe('hotkey labels learned from keydown without navigator.keyboard (final fix pass B10)', () => {
  afterEach(() => setKeyboardLayout(null));

  it('QWERTZ: a KeyY keydown typing z swaps the Y/Z labels and maps the speed and Warden keys', () => {
    expect(letterFor('KeyZ')).toBe('Z');
    expect(learnKeyLayout({ code: 'KeyY', key: 'z' })).toBe(true);
    expect(letterFor('KeyZ')).toBe('Y');
    expect(letterFor('KeyY')).toBe('Z');
    expect(hotkeyLabel('Z')).toBe('Y');
    expect(hotkeyLabel('− / =')).toBe('ß / ´');
    expect(hotkeyLabel('`')).toBe('^');
    expect(hotkeyLabel('Q')).toBe('Q');
    // Bindings stay physical.
    expect(resolveKey(k('KeyZ'))).toEqual({ type: 'card', letter: 'Z', shift: false });
  });

  it('AZERTY from KeyQ typing a; a Shift+letter still counts, shifted symbols and modifiers do not', () => {
    expect(learnKeyLayout({ code: 'Digit1', key: '!', shiftKey: true })).toBe(false);
    expect(learnKeyLayout({ code: 'KeyQ', key: 'a', altKey: true })).toBe(false);
    expect(letterFor('KeyA')).toBe('A');
    expect(learnKeyLayout({ code: 'KeyQ', key: 'A', shiftKey: true })).toBe(true);
    expect(hotkeyLabel('A')).toBe('Q');
    expect(hotkeyLabel('Q')).toBe('A');
    expect(hotkeyLabel('W')).toBe('Z');
    expect(hotkeyLabel('M')).toBe(',');
    expect(hotkeyLabel('`')).toBe('²');
  });

  it('QWERTY keydowns change nothing; dead keys are ignored; the Keyboard API map wins', () => {
    expect(learnKeyLayout({ code: 'KeyZ', key: 'z' })).toBe(false);
    expect(learnKeyLayout({ code: 'Equal', key: 'Dead' })).toBe(false);
    expect(hotkeyLabel('− / =')).toBe('− / =');
    expect(letterFor('KeyZ')).toBe('Z');
    setKeyboardLayout(new Map([['KeyZ', 'z']]));
    expect(learnKeyLayout({ code: 'KeyY', key: 'z' })).toBe(false);
    expect(letterFor('KeyY')).toBe('Y');
  });
});
