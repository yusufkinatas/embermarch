/**
 * Phones and tablets: when the desktop notice shows, and which gestures re-try the audio unlock.
 */
import { describe, expect, it } from 'vitest';
import { AUDIO_UNLOCK_EVENTS, TOUCH_CONTROLS_LINE, deviceNoticeKind, installAudioUnlock, wantsDesktopNotice } from '../../src/app/logic/device';

const desk = { coarse: false, fine: true };
const phone = { coarse: true, fine: false };

describe('wantsDesktopNotice', () => {
  it('desktops at common sizes see no notice', () => {
    for (const [width, height] of [
      [1600, 900],
      [1440, 900],
      [1280, 720],
      [1920, 1080],
      [1024, 768],
    ])
      expect(wantsDesktopNotice({ ...desk, width, height })).toBe(false);
  });

  it('touch-only devices see it at any size, phones in either orientation', () => {
    expect(wantsDesktopNotice({ ...phone, width: 393, height: 659 })).toBe(true); // iPhone 15
    expect(wantsDesktopNotice({ ...phone, width: 734, height: 343 })).toBe(true); // iPhone 15 landscape
    expect(wantsDesktopNotice({ ...phone, width: 1040, height: 480 })).toBe(true); // Galaxy A55 landscape
    expect(wantsDesktopNotice({ ...phone, width: 1366, height: 1024 })).toBe(true); // iPad Pro, no trackpad
  });

  it('a touch screen with a trackpad or mouse is a computer unless it is small', () => {
    expect(wantsDesktopNotice({ coarse: true, fine: true, width: 1366, height: 1024 })).toBe(false);
    expect(wantsDesktopNotice({ coarse: true, fine: true, width: 1100, height: 480 })).toBe(true);
  });

  it('small windows see it: shorter side under 500 px or longer side under 900 px', () => {
    expect(wantsDesktopNotice({ ...desk, width: 1400, height: 499 })).toBe(true);
    expect(wantsDesktopNotice({ ...desk, width: 899, height: 700 })).toBe(true);
    expect(wantsDesktopNotice({ ...desk, width: 900, height: 500 })).toBe(false);
  });

  it('phones get the touch notice; a mouse in a small window gets the window notice', () => {
    expect(deviceNoticeKind({ ...phone, width: 734, height: 343 })).toBe('touch');
    expect(deviceNoticeKind({ ...phone, width: 1366, height: 1024 })).toBe('touch');
    expect(deviceNoticeKind({ ...desk, width: 860, height: 600 })).toBe('window');
    expect(deviceNoticeKind({ coarse: true, fine: true, width: 1100, height: 480 })).toBe('window');
    expect(deviceNoticeKind({ ...desk, width: 1600, height: 900 })).toBeNull();
  });

  it('the touch line matches the battle lane sentence', () => {
    expect(TOUCH_CONTROLS_LINE).toBe('On touch: tap to select, tap the ground to move or attack, drag to pan.');
  });
});

describe('installAudioUnlock', () => {
  it('re-tries on every gesture, including the ones that count as a user activation on touch', () => {
    const target = new EventTarget();
    let calls = 0;
    const off = installAudioUnlock(target, () => calls++);
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown', 'pointerdown']) target.dispatchEvent(new Event(type));
    expect(calls).toBe(6);
    expect(AUDIO_UNLOCK_EVENTS).toEqual(expect.arrayContaining(['pointerup', 'touchend', 'click']));
    off();
    target.dispatchEvent(new Event('click'));
    expect(calls).toBe(6);
  });
});
