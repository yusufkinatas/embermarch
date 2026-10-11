/**
 * Device checks and gesture wiring the shell needs on phones and tablets (no DOM beyond EventTarget).
 */

/** Pointer and viewport facts the desktop notice is decided on. */
export interface DeviceInfo {
  /** `(pointer: coarse)`: the primary pointer is a finger. */
  coarse: boolean;
  /** `(any-pointer: fine)`: some pointer (mouse, trackpad, pen) is precise. */
  fine: boolean;
  width: number;
  height: number;
}

/** localStorage key that remembers "Continue anyway". */
export const DEVICE_NOTICE_KEY = 'embermarch.deviceNotice.v1';

/** The line the battle's touch input implements (tap select, tap ground to command, drag to pan). */
export const TOUCH_CONTROLS_LINE = 'On touch: tap to select, tap the ground to move or attack, drag to pan.';

/**
 * Which notice a device gets: 'touch' for a touch-first device with no fine pointer (phones, tablets),
 * 'window' for a mouse device whose viewport is too small for the 1280x720 layout (shorter side under
 * 500 px, or longer side under 900 px), else null.
 */
export function deviceNoticeKind(d: DeviceInfo): 'touch' | 'window' | null {
  if (d.coarse && !d.fine) return 'touch';
  const small = Math.min(d.width, d.height) < 500 || Math.max(d.width, d.height) < 900;
  return small ? 'window' : null;
}

export function wantsDesktopNotice(d: DeviceInfo): boolean {
  return deviceNoticeKind(d) !== null;
}

/**
 * Events that may resume a suspended AudioContext. A touch `pointerdown` is not a user activation on
 * iOS or Android, so the context stays suspended unless a later `pointerup`, `touchend` or `click`
 * also resumes it.
 */
export const AUDIO_UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

/**
 * Call `unlock` on every gesture event (capture phase, passive). `unlock` must be cheap and idempotent:
 * it resumes a suspended context and does nothing while one is running. Returns an uninstaller.
 */
export function installAudioUnlock(target: EventTarget, unlock: () => void): () => void {
  const handler = (): void => unlock();
  for (const type of AUDIO_UNLOCK_EVENTS) target.addEventListener(type, handler, { capture: true, passive: true });
  return () => {
    for (const type of AUDIO_UNLOCK_EVENTS) target.removeEventListener(type, handler, { capture: true });
  };
}
