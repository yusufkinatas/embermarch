/**
 * Progressive Web App glue: service worker registration, full screen, and the install prompt.
 * Everything is feature-detected and guarded, so unsupported browsers simply see fewer options.
 * - Full screen uses the Fullscreen API (desktop browsers, Android, iPad). On Chromium it also locks
 *   Escape, so Esc keeps working in game (hold Esc to leave full screen), and on touch devices it
 *   locks landscape. Alt+Enter toggles it anywhere.
 * - An installed app (manifest `display: fullscreen`) already runs without browser chrome. iPhone
 *   Safari has no Fullscreen API: "Add to Home Screen" is the way there.
 */

interface WebkitDocument {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface WebkitElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface KeyboardLock {
  lock?: (codes?: string[]) => Promise<void>;
  unlock?: () => void;
}
interface OrientationLock {
  lock?: (orientation: string) => Promise<void>;
}
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const listeners = new Set<() => void>();
let installEvent: InstallPromptEvent | null = null;

function notify(): void {
  for (const fn of listeners) fn();
}

/** Subscribe to full screen / installability changes. Returns an unsubscribe function. */
export function onDisplayChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function media(query: string): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** Running as an installed app (home screen / app window), not in a browser tab. */
export function isInstalledApp(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return media('(display-mode: fullscreen)') || media('(display-mode: standalone)') || nav.standalone === true;
}

export function canFullscreen(): boolean {
  const doc = document as Document & WebkitDocument;
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  const doc = document as Document & WebkitDocument;
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}

/** True on iPhone/iPad Safari outside an installed app (the "Add to Home Screen" hint applies). */
export function isIosBrowser(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return ios && !isInstalledApp();
}

/** Enter full screen (must run inside a user gesture). Resolves false when the browser refuses. */
export async function enterFullscreen(): Promise<boolean> {
  if (isFullscreen()) return true;
  const el = document.documentElement as HTMLElement & WebkitElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
  } catch {
    return false;
  }
  // Keep Esc for the game (Chromium: hold Esc to leave full screen). Lock landscape on phones.
  void (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard?.lock?.(['Escape'])?.catch(() => undefined);
  if (media('(pointer: coarse)')) {
    void (screen.orientation as ScreenOrientation & OrientationLock | undefined)?.lock?.('landscape')?.catch(() => undefined);
  }
  return true;
}

export async function exitFullscreen(): Promise<void> {
  const doc = document as Document & WebkitDocument;
  try {
    if (doc.exitFullscreen && doc.fullscreenElement) await doc.exitFullscreen();
    else if (doc.webkitExitFullscreen && doc.webkitFullscreenElement) await doc.webkitExitFullscreen();
  } catch {
    /* already out */
  }
}

export async function toggleFullscreen(): Promise<boolean> {
  if (isFullscreen()) {
    await exitFullscreen();
    return false;
  }
  return enterFullscreen();
}

/** The browser offered to install the app (Chromium); `promptInstall` shows its dialog. */
export function canInstall(): boolean {
  return installEvent !== null && !isInstalledApp();
}

export async function promptInstall(): Promise<boolean> {
  const ev = installEvent;
  if (!ev) return false;
  installEvent = null;
  notify();
  try {
    await ev.prompt();
    return (await ev.userChoice).outcome === 'accepted';
  } catch {
    return false;
  }
}

let installed = false;

/** Wire the service worker, full screen events and the install prompt. Call once at startup. */
export function installPwa(): void {
  if (installed) return;
  installed = true;

  const onChange = (): void => {
    if (!isFullscreen()) (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard?.unlock?.();
    notify();
  };
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // Offer it from our own button instead of the mini-infobar.
    installEvent = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    notify();
  });

  // Alt+Enter toggles full screen, as in most PC games.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && e.altKey && !e.ctrlKey && !e.metaKey && canFullscreen()) {
      e.preventDefault();
      void toggleFullscreen();
    }
  });

  if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => undefined);
    });
  }
}
