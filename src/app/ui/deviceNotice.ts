/**
 * A one-time notice for phones, tablets and very small windows. Embermarch is played with a mouse and
 * keyboard; a touch-only visitor (often opening a link shared in a chat app) is told so, can share or
 * copy the link for later, and may continue anyway. "Continue anyway" (or Esc) is remembered in guarded
 * localStorage. Styles: src/styles/notice.css.
 */
import { h } from '../dom';
import { DEVICE_NOTICE_KEY, TOUCH_CONTROLS_LINE, deviceNoticeKind, type DeviceInfo } from '../logic/device';

function media(query: string, fallback: boolean): boolean {
  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback;
  } catch {
    return fallback;
  }
}

function readDevice(): DeviceInfo {
  return {
    coarse: media('(pointer: coarse)', false),
    fine: media('(any-pointer: fine)', true),
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(DEVICE_NOTICE_KEY) === '1';
  } catch {
    return false; // Blocked storage: show it; the dismissal just won't stick.
  }
}

/** True when this device should see the notice and has not dismissed it before. */
export function needsDesktopNotice(): boolean {
  return deviceNoticeKind(readDevice()) !== null && !dismissed();
}

const COPY = {
  touch: {
    kicker: 'Best on a computer',
    title: 'Embermarch is played with a mouse and keyboard',
    body: 'It is a real-time strategy game: drag to select, right-click to command, hotkeys to build. Open this link on a desktop or laptop for the full game.',
  },
  // A mouse device in a small window: the advice is a bigger window, not another device.
  window: {
    kicker: 'Best in a larger window',
    title: 'Embermarch is laid out for 1280×720 and up',
    body: 'Enlarge the window or go full screen for the full game.',
  },
};

export interface DeviceNoticeHandle {
  el: HTMLElement;
  close(): void;
}

/** Show the notice over everything. `onClose` runs once, after "Continue anyway" or Esc. */
export function showDesktopNotice(host: HTMLElement, onClose: () => void): DeviceNoticeHandle {
  const kind = deviceNoticeKind(readDevice()) ?? 'touch';
  const copy = COPY[kind];
  const url = `${location.origin}${location.pathname}`;
  const share = h('button', { type: 'button', class: 'btn dn-btn dn-share' }, 'Copy link');
  const go = h('button', { type: 'button', class: 'btn primary dn-btn dn-go' }, 'Continue anyway');
  const urlSlot = h('div', { class: 'dn-url-slot' });
  const el = h(
    'div',
    { class: 'device-notice', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dn-title', 'aria-describedby': 'dn-body' },
    h(
      'div',
      { class: 'dn-card' },
      h('div', { class: 'dn-kicker' }, copy.kicker),
      h('h2', { class: 'dn-title', id: 'dn-title' }, copy.title),
      h('p', { class: 'dn-body', id: 'dn-body' }, copy.body),
      kind === 'touch' ? h('p', { class: 'dn-body dn-portrait' }, 'On a phone, turn it sideways to look around.') : null,
      h('div', { class: 'dn-actions' }, kind === 'touch' ? share : null, go),
      urlSlot,
      kind === 'touch' ? h('p', { class: 'dn-touch' }, TOUCH_CONTROLS_LINE) : null,
    ),
  );

  const showUrl = (): void => {
    const input = h('input', { class: 'dn-url', type: 'text', readonly: true, value: url, 'aria-label': 'Link to Embermarch' });
    urlSlot.replaceChildren(input);
    input.focus();
    input.select();
  };
  const toClipboard = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  };
  share.addEventListener('click', async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Embermarch', url });
        share.textContent = 'Link shared';
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return; // The share sheet was closed.
      }
    }
    if (await toClipboard()) share.textContent = 'Link copied';
    else showUrl();
  });

  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    try {
      localStorage.setItem(DEVICE_NOTICE_KEY, '1');
    } catch {
      /* private mode: show it again next time */
    }
    window.removeEventListener('keydown', onKey, true);
    el.remove();
    if (previous?.isConnected) previous.focus({ preventScroll: true });
    onClose();
  };
  // While open, nothing behind the notice sees a key. Esc continues; Tab cycles inside the card.
  function onKey(e: KeyboardEvent): void {
    e.stopImmediatePropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    const focusables = [...el.querySelectorAll<HTMLElement>('button, input')];
    if (e.key === 'Tab' && focusables.length) {
      e.preventDefault();
      const i = focusables.indexOf(document.activeElement as HTMLElement);
      const n = i < 0 ? 0 : (i + (e.shiftKey ? focusables.length - 1 : 1)) % focusables.length;
      focusables[n].focus();
      return;
    }
    // Enter / Space still activate the focused button (default action); other keys do nothing.
    if (!(e.target instanceof Node && el.contains(e.target))) e.preventDefault();
  }
  go.addEventListener('click', close);
  window.addEventListener('keydown', onKey, true);
  host.appendChild(el);
  go.focus({ preventScroll: true });
  return { el, close };
}
